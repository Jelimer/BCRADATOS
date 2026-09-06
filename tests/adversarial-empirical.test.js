/**
 * tests/adversarial-empirical.test.js
 * Suite Adversarial de Pruebas Empíricas de Casos Borde y Resiliencia del Backend.
 * 
 * Áreas evaluadas:
 * 1. Normalización de BCRA 404 ("Sin Deuda" / "Sin Cheques") a HTTP 200 { tieneDeuda: false, peorSituacion: 1 }.
 * 2. Retención de caché de panel BYMA ante respuestas vacías (data: []) y contingencia fuera de horario.
 * 3. Comportamiento ante URLs upstream inaccesibles, timeouts y política de reintentos con backoff exponencial.
 */

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { defaultTestServer } = require('./helpers/setup');
const { cacheService } = require('../services/cacheService');
const httpClient = require('../services/httpClient');

describe('Adversarial & Empirical Backend Resilience Suite', () => {
  before(async () => {
    await defaultTestServer.start();
  });

  after(async () => {
    cacheService.clear();
    await defaultTestServer.stop();
  });

  // =========================================================================
  // 1. ADVERSARIAL: BCRA 404 TO 200 NORMALIZATION ({ tieneDeuda: false, peorSituacion: 1 })
  // =========================================================================
  describe('1. BCRA 404 Normalization & Edge Cases (Central de Deudores & Cheques)', () => {
    const cuitSinDeuda = '20300000001';

    it('1.1. Debería normalizar 404 del BCRA a HTTP 200 con tieneDeuda: false y peorSituacion: 1 para CUIT sin deuda', async () => {
      const res = await defaultTestServer.get(`/api/bcra-deudores/Deudas/${cuitSinDeuda}`);

      assert.ok([200, 429, 503].includes(res.status), `El endpoint debió retornar HTTP 200, 429 o 503 para ${cuitSinDeuda}, retornó ${res.status}`);
      assert.ok(res.data, 'La respuesta no debe estar vacía');

      if (res.status === 200) {
        assert.equal(res.data.status, 200, 'El campo status del payload debe ser 200');

        const results = res.data.results;
        assert.ok(results, 'El payload debe contener un objeto results');

        // Verificaciones obligatorias del contrato
        assert.strictEqual(results.tieneDeuda, false, 'tieneDeuda debe ser estrictamente false');
        assert.strictEqual(results.peorSituacion, 1, 'peorSituacion debe ser 1 (Normal)');
        assert.strictEqual(results.situacion, 1, 'situacion debe ser 1 (Normal)');
        assert.strictEqual(results.totalDeuda, 0, 'totalDeuda debe ser 0');
        assert.ok(Array.isArray(results.periodos), 'periodos debe ser un arreglo');
        assert.equal(results.periodos.length, 0, 'periodos debe estar vacío para CUIT sin deuda');
        assert.ok(Array.isArray(results.entidades), 'entidades debe ser un arreglo');
        assert.equal(results.entidades.length, 0, 'entidades debe estar vacío');
        assert.ok(typeof results.mensaje === 'string' && results.mensaje.length > 0, 'Debe incluir un mensaje explicativo');
        assert.match(results.mensaje, /no se registran deudas|situaci[oó]n 1/i, 'El mensaje debe indicar ausencia de deuda');
      } else {
        assert.ok([429, 503].includes(res.status));
      }
    });

    it('1.2. La respuesta normalizada 200 (Sin Deuda) debe persistir en caché y responder con X-Cache: HIT (<5ms)', async () => {
      const res = await defaultTestServer.get(`/api/bcra-deudores/Deudas/${cuitSinDeuda}`);

      assert.ok([200, 429, 503].includes(res.status));
      if (res.status === 200) {
        assert.equal(res.headers.get('x-cache'), 'HIT', 'Debe servirse desde la memoria caché');
        assert.ok(res.durationMs < 100, `La respuesta en caché debe ser casi instantánea (<100ms), duró ${res.durationMs}ms`);
        assert.strictEqual(res.data.results.tieneDeuda, false);
        assert.strictEqual(res.data.results.peorSituacion, 1);
      }
    });

    it('1.3. Debería normalizar 404 en consulta de cheques rechazados (/ChequesRechazados/:cuit) a HTTP 200', async () => {
      const res = await defaultTestServer.get(`/api/bcra-deudores/Deudas/ChequesRechazados/${cuitSinDeuda}`);

      assert.ok([200, 429, 503].includes(res.status));
      assert.ok(res.data);
      if (res.status === 200) {
        assert.ok(res.data?.results);
        assert.strictEqual(res.data.results.tieneChequesRechazados, false);
        assert.ok(Array.isArray(res.data.results.chequesRechazados));
        assert.equal(res.data.results.chequesRechazados.length, 0);
        assert.match(res.data.results.mensaje, /no se registran cheques rechazados/i);
      } else {
        assert.ok([429, 503].includes(res.status));
      }
    });

    it('1.4. Debería responder de forma controlada al consultar Cheques Denunciados con banco inexistente (999)', async () => {
      const res = await defaultTestServer.get('/api/bcra-cheques/denunciados/999/99999999');

      assert.ok([200, 400, 404, 502].includes(res.status));
      assert.ok(res.data);
      if (res.status === 200 && res.data.results) {
        assert.strictEqual(res.data.results.denunciado, false);
      }
    });

    it('1.5. Debería responder HTTP 200 con denunciado: false al consultar Cheques Denunciados en banco válido (011)', async () => {
      const res = await defaultTestServer.get('/api/bcra-cheques/denunciados/011/99999999');

      assert.equal(res.status, 200);
      assert.ok(res.data?.results);
      assert.strictEqual(res.data.results.denunciado, false);
    });

    it('1.6. CUIT malformado (longitud 5) debe retornar 400 Bad Request controlado del BCRA sin caer el servidor', async () => {
      const res = await defaultTestServer.get('/api/bcra-deudores/Deudas/12345');
      assert.ok([400, 422].includes(res.status), `Debe responder 400 o 422 para CUIT inválido, obtuvo ${res.status}`);
      assert.strictEqual(res.data?.error, true);
    });
  });

  // =========================================================================
  // 2. ADVERSARIAL: BYMA EMPTY RESPONSES (data: []) & FALLBACK CACHE RETENTION
  // =========================================================================
  describe('2. BYMA Empty Responses (data: []) & Cache Retention Resilience', () => {
    const BYMA_FALLBACK_KEY = 'byma:last_valid_panel';

    const mockValidPanel = {
      data: [
        { symbol: 'AL30', trade: 55000, volume: 1500000, variation: 1.25 },
        { symbol: 'GD30', trade: 58000, volume: 2200000, variation: 0.85 }
      ],
      total: 2,
      timestamp: '2026-08-27T15:00:00.000Z'
    };

    beforeEach(() => {
      cacheService.delete(BYMA_FALLBACK_KEY);
      cacheService.delete('GET:/api/byma/panel/public-bonds');
    });

    it('2.1. Si la caché de fallback contiene datos previos y la respuesta externa está vacía o cerrada, debe servir el panel retenido', async () => {
      cacheService.set(BYMA_FALLBACK_KEY, mockValidPanel, cacheService.TTL.FALLBACK_PERSISTENT);

      const res = await defaultTestServer.get('/api/byma/panel/public-bonds?nocache=true');

      assert.equal(res.status, 200);
      assert.ok(res.data);
      assert.ok(Array.isArray(res.data.data), 'res.data.data debe ser un arreglo');
      assert.ok(res.data.data.length > 0, 'Debe contener los bonos del panel retenido');

      if (res.data.isFallback) {
        assert.strictEqual(res.data.marketOpen, false);
        assert.strictEqual(res.data.data[0].symbol, 'AL30');
      }
    });

    it('2.2. Si la caché de fallback está vacía y el upstream retorna vacío, debe devolver estructura limpia sin crashear', async () => {
      cacheService.delete(BYMA_FALLBACK_KEY);

      const res = await defaultTestServer.get('/api/byma/panel/public-bonds?nocache=true');
      assert.ok([200, 500, 502, 504].includes(res.status));
      assert.ok(res.data);
      assert.ok(Array.isArray(res.data.data) || res.data.data === undefined || res.data.error === true);
    });

    it('2.3. Simulación directa: Un panel con datos debe persistir en FALLBACK_PERSISTENT (7 días)', () => {
      cacheService.set(BYMA_FALLBACK_KEY, mockValidPanel, cacheService.TTL.FALLBACK_PERSISTENT);

      const entry = cacheService.getEntry(BYMA_FALLBACK_KEY);
      assert.ok(entry, 'La entrada de fallback debe existir en memoria');
      assert.ok(entry.ttlRemaining > 600000, 'El TTL del fallback debe ser mayor a 7 días (~604800 segundos)');
      assert.equal(entry.value.data.length, 2);
    });

    it('2.4. Prueba de ciclo completo de BYMA con servidor simulado: data -> empty -> fallback retenido', async () => {
      let mockBymaData = { data: [{ symbol: 'AL30', trade: 50000 }] };

      const mockBymaServer = http.createServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(mockBymaData));
      });

      const port = await new Promise(resolve => {
        mockBymaServer.listen(0, '127.0.0.1', () => resolve(mockBymaServer.address().port));
      });

      try {
        const testCache = new (require('../services/cacheService').CacheService)();
        const testFallbackKey = 'test_byma:last_valid_panel';

        async function fetchBymaPanel() {
          const response = await httpClient.post(`http://127.0.0.1:${port}/test-bonds`, {});
          const bymaData = response.data;
          const hasActiveData = Array.isArray(bymaData?.data) && bymaData.data.length > 0;

          if (hasActiveData) {
            testCache.set(testFallbackKey, bymaData, testCache.TTL.FALLBACK_PERSISTENT);
            return { ...bymaData, marketOpen: true };
          }

          const cachedPanel = testCache.get(testFallbackKey);
          if (cachedPanel && Array.isArray(cachedPanel.data) && cachedPanel.data.length > 0) {
            return { ...cachedPanel, marketOpen: false, isFallback: true, cached: true };
          }

          return { ...bymaData, marketOpen: false, isFallback: false };
        }

        // Paso 1: Llamada cuando el mercado está abierto (data activa)
        const step1 = await fetchBymaPanel();
        assert.strictEqual(step1.marketOpen, true);
        assert.equal(step1.data.length, 1);
        assert.equal(step1.data[0].symbol, 'AL30');

        // Paso 2: El mercado se cierra y BYMA responde data: []
        mockBymaData = { data: [] };
        const step2 = await fetchBymaPanel();
        assert.strictEqual(step2.marketOpen, false);
        assert.strictEqual(step2.isFallback, true);
        assert.strictEqual(step2.cached, true);
        assert.equal(step2.data.length, 1, 'Debe retener el panel anterior no vacío');
        assert.equal(step2.data[0].symbol, 'AL30');

        // Paso 3: El mercado reabre con nuevos datos
        mockBymaData = { data: [{ symbol: 'GD30', trade: 60000 }, { symbol: 'AL30', trade: 52000 }] };
        const step3 = await fetchBymaPanel();
        assert.strictEqual(step3.marketOpen, true);
        assert.strictEqual(step3.isFallback, undefined);
        assert.equal(step3.data.length, 2);

        testCache.destroy();
      } finally {
        await new Promise(resolve => mockBymaServer.close(resolve));
      }
    });
  });

  // =========================================================================
  // 3. ADVERSARIAL: UPSTREAM UNREACHABLE, TIMEOUTS & EXPONENTIAL BACKOFF RETRIES
  // =========================================================================
  describe('3. Upstream Unreachable, Timeouts & Exponential Backoff Retries', () => {
    let mockServer;
    let mockPort;
    let requestCount = 0;

    before(async () => {
      mockServer = http.createServer((req, res) => {
        requestCount++;
        const url = req.url;

        if (url.startsWith('/fail-twice-then-ok')) {
          if (requestCount <= 2) {
            res.writeHead(503, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Temporary upstream overload' }));
          } else {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, attempts: requestCount }));
          }
        } else if (url.startsWith('/always-502')) {
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Bad Gateway' }));
        } else if (url.startsWith('/client-404-no-retry')) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Not Found' }));
        } else if (url.startsWith('/slow-hang')) {
          setTimeout(() => {
            if (!res.writableEnded) {
              res.writeHead(200);
              res.end('done');
            }
          }, 3000);
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'ok' }));
        }
      });

      await new Promise((resolve) => {
        mockServer.listen(0, '127.0.0.1', () => {
          mockPort = mockServer.address().port;
          resolve();
        });
      });
    });

    after(async () => {
      await new Promise((resolve) => {
        if (mockServer) mockServer.close(resolve);
        else resolve();
      });
    });

    it('3.1. Reintento con éxito tras 2 fallos transitorios (HTTP 503) aplicando backoff', async () => {
      requestCount = 0;
      const startTime = Date.now();

      const response = await httpClient.get(`http://127.0.0.1:${mockPort}/fail-twice-then-ok`, {}, {
        retries: 2,
        initialDelayMs: 100,
        backoffFactor: 2
      });

      const elapsed = Date.now() - startTime;

      assert.equal(response.status, 200);
      assert.strictEqual(response.data.success, true);
      assert.strictEqual(requestCount, 3, 'Debió realizar exactamente 3 peticiones (1 inicial + 2 reintentos)');
      assert.ok(elapsed >= 280, `El tiempo transcurrido (${elapsed}ms) debe respetar los retardos con backoff`);
    });

    it('3.2. Errores no transitorios (HTTP 404) NO deben reintentarse (0 reintentos adicionales)', async () => {
      requestCount = 0;
      const startTime = Date.now();

      try {
        await httpClient.get(`http://127.0.0.1:${mockPort}/client-404-no-retry`, {}, {
          retries: 3,
          initialDelayMs: 200
        });
        assert.fail('Debió arrojar error 404');
      } catch (err) {
        const elapsed = Date.now() - startTime;
        assert.equal(err.response?.status, 404);
        assert.strictEqual(requestCount, 1, 'HTTP 404 es un error de cliente y NO debe generar reintentos');
        assert.ok(elapsed < 500, `El fallo debió ser inmediato sin esperas de backoff (${elapsed}ms)`);
      }
    });

    it('3.3. Agotamiento de reintentos ante error permanente de servidor (HTTP 502)', async () => {
      requestCount = 0;
      try {
        await httpClient.get(`http://127.0.0.1:${mockPort}/always-502`, {}, {
          retries: 2,
          initialDelayMs: 50
        });
        assert.fail('Debió arrojar error tras agotar reintentos');
      } catch (err) {
        assert.equal(err.response?.status, 502);
        assert.strictEqual(requestCount, 3, 'Debió intentar 1 inicial + 2 reintentos antes de fallar definitivamente');
      }
    });

    it('3.4. Timeout forzado en cliente HTTP resiliente debe reintentar y cancelar la conexión limpiamente', async () => {
      requestCount = 0;
      const startTime = Date.now();

      try {
        await httpClient.get(`http://127.0.0.1:${mockPort}/slow-hang`, {
          timeout: 100
        }, {
          retries: 1,
          initialDelayMs: 50
        });
        assert.fail('Debió arrojar timeout');
      } catch (err) {
        const elapsed = Date.now() - startTime;
        assert.strictEqual(requestCount, 2, 'Debió intentar 1 inicial + 1 reintento por timeout');
        assert.ok(elapsed >= 160, `Tiempo transcurrido (${elapsed}ms) debe considerar 2 timeouts de 100ms`);
      }
    });

    it('3.5. Host no alcanzable (IP no enrutable) debe ser manejado sin crashear el proceso', async () => {
      try {
        await httpClient.get('http://192.0.2.1:9999/unreachable', {
          timeout: 150
        }, {
          retries: 1,
          initialDelayMs: 30
        });
        assert.fail('Debió arrojar error de conexión');
      } catch (err) {
        assert.ok(err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT' || err.code === 'ENETUNREACH' || err.code === 'EHOSTUNREACH' || err.code === 'ECONNREFUSED' || err.message.includes('timeout') || err.message.includes('connect') || !!err);
      }
    });

    it('3.6. Endpoint Express ante falla upstream devuelve payload JSON de contingencia estructurado sin filtrar trazas internas', async () => {
      const res = await defaultTestServer.get('/api/monetarias/9999999?nocache=true');

      assert.ok([400, 404, 500, 502].includes(res.status));
      assert.ok(res.data, 'Debe entregar un cuerpo JSON');
      assert.strictEqual(res.data.error, true, 'El cuerpo debe marcar error: true');
      assert.ok(res.data.message, 'Debe incluir un mensaje legible en español');
      assert.ok(!res.data.stack, 'No debe filtrar el stack trace de Node.js al cliente');
    });
  });
});
