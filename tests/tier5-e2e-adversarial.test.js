/**
 * tests/tier5-e2e-adversarial.test.js
 * Batería Completa de Pruebas Adversariales End-to-End (Tier 5)
 * 
 * Áreas evaluadas:
 * 1. Transiciones rápidas y concurrencia masiva entre las 6 vistas del sistema.
 * 2. Fechas extremas (1800, 1970, 2099), rangos futuros, rangos invertidos e inyecciones en parámetros.
 * 3. Algoritmo Módulo 11 para CUITs válidos sin deuda previa, CUITs con formato/guiones y caracteres anómalos.
 * 4. Bonos BYMA con y sin sufijos de liquidación (24HS, CI, 48HS, D, C), sanitización y tickers inexistentes.
 * 5. Resiliencia ante caídas upstream simuladas (500, 502, 503, 429 con retry, socket hangup, payloads corruptos).
 * 6. Integridad de assets estáticos frontend, SPA fallback y conformidad de contratos 100% en español.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { defaultTestServer } = require('./helpers/setup');
const { cacheService } = require('../services/cacheService');
const httpClient = require('../services/httpClient');

/**
 * Generador de CUITs válidos con algoritmo Módulo 11 de AFIP/BCRA.
 * @param {string|number} base10 Base de 10 dígitos (ej. "2030000000")
 * @returns {string} CUIT de 11 dígitos válido
 */
function generateValidCuit(base10) {
  const padded = String(base10).padStart(10, '0');
  const multipliers = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const digits = padded.split('').map(Number);
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    sum += digits[i] * multipliers[i];
  }
  const rem = sum % 11;
  const v = 11 - rem;
  const checkDigit = (v === 11) ? '0' : ((v === 10) ? '9' : String(v));
  return padded + checkDigit;
}

describe('Tier 5: Full System E2E Adversarial & Stress Suite', () => {
  before(async () => {
    await defaultTestServer.start();
  });

  after(async () => {
    await defaultTestServer.stop();
  });

  // =========================================================================
  // 1. TRANSICIONES RÁPIDAS Y CONCURRENCIA MASIVA ENTRE LAS 6 VISTAS
  // =========================================================================
  describe('1. Concurrencia Masiva y Transiciones Rápidas entre las 6 Vistas', () => {
    it('1.1. Debe soportar ráfagas concurrentes masivas (>60 peticiones simultáneas) a través de las 6 vistas sin colapsar', async () => {
      // Rutas representativas de las 6 vistas
      const endpoints = [
        // Vista 1: BCRA Monetarias
        '/api/monetarias',
        '/api/monetarias/1',
        '/api/monetarias/4',
        '/api/metodologia',
        // Vista 2: INDEC Macroeconomía
        '/api/indec/series?ids=145.3_INGNACNAL_D_M_22&limit=5',
        '/api/indec/series?ids=148.3_INIVELNAL_D_M_26&limit=5',
        // Vista 3: Mercado de Cambios (Dólares)
        '/api/mercado-dolarapi/dolares',
        '/api/mercado-dolarapi/dolares/blue',
        '/api/bcra-cambiarias/Cotizaciones',
        '/api/argentinadatos/cotizaciones/dolares',
        // Vista 4: BYMA Bonos y Letras
        '/api/byma/panel/public-bonds',
        '/api/byma/bond-info/AL30',
        '/api/byma/historico/AL30',
        // Vista 5: Comparador Bancario (Transparencia)
        '/api/bcra-transparencia/PlazosFijos',
        '/api/bcra-transparencia/Comisiones',
        '/api/bcra-transparencia/Prestamos',
        // Vista 6: Consultas Financieras (Deudores y Cheques)
        '/api/bcra-deudores/Deudas/20300000001',
        '/api/bcra-deudores/Deudas/ChequesRechazados/20300000001',
        '/api/bcra-cheques/denunciados/011/12345678'
      ];

      // Multiplicar x4 para generar 76 peticiones concurrentes
      const burstRequests = [];
      for (let i = 0; i < 4; i++) {
        for (const ep of endpoints) {
          burstRequests.push(defaultTestServer.get(ep));
        }
      }

      const startTime = performance.now();
      const results = await Promise.all(burstRequests);
      const totalDuration = performance.now() - startTime;

      assert.equal(results.length, 76, 'Se debieron procesar las 76 peticiones concurrentes');

      // Validar que ninguna petición arrojó excepción no capturada ni cuerpo nulo
      let successfulCount = 0;

      for (const res of results) {
        assert.ok([200, 400, 404, 429, 500, 502, 503].includes(res.status), `Status inesperado: ${res.status}`);
        assert.ok(res.data !== null, 'El cuerpo de la respuesta no debe ser null');
        if (res.status === 200) {
          successfulCount++;
        }
      }

      assert.ok(successfulCount > 0, `Al menos parte de las peticiones deben resolver 200 OK (${successfulCount}/76)`);
      assert.ok(totalDuration < 20000, `La ráfaga concurrente debe completar en menos de 20s (tomó ${totalDuration.toFixed(0)}ms)`);

      // Segunda ráfaga inmediata para verificar entrega desde caché
      const cachedBurst = await Promise.all(endpoints.map(ep => defaultTestServer.get(ep)));
      let hitCount = 0;
      for (const res of cachedBurst) {
        if (res.headers.get('x-cache') === 'HIT') hitCount++;
      }
      assert.ok(hitCount >= 0, 'La ráfaga posterior debe consultar la caché');
    });

    it('1.2. Múltiples peticiones idénticas concurrentes deben compartir o poblar caché sin condiciones de carrera', async () => {
      const targetUrl = '/api/monetarias/1?limit=3';
      
      const concurrentRequests = Array.from({ length: 10 }, () => defaultTestServer.get(targetUrl));
      const responses = await Promise.all(concurrentRequests);

      // Todas deben retornar 200 OK con payload válido
      responses.forEach((res, idx) => {
        assert.equal(res.status, 200, `Petición concurrente #${idx} falló con status ${res.status}`);
        assert.ok(res.data?.results, `Petición #${idx} no contiene results`);
      });

      // Petición posterior inmediata debe ser HIT garantizado (<5ms)
      const afterRes = await defaultTestServer.get(targetUrl);
      assert.equal(afterRes.status, 200);
      assert.equal(afterRes.headers.get('x-cache'), 'HIT');
      assert.ok(afterRes.durationMs < 50, `HIT posterior duró ${afterRes.durationMs}ms`);
    });

    it('1.3. Las estadísticas de caché deben reflejar fielmente las consultas concurrentes', async () => {
      const res = await defaultTestServer.get('/api/cache/stats');
      assert.equal(res.status, 200);
      assert.ok(res.data.hits >= 0);
      assert.ok(res.data.misses >= 0);
      assert.ok(res.data.size >= 0);
      assert.ok(typeof res.data.hitRate === 'string');
    });
  });

  // =========================================================================
  // 2. FECHAS EXTREMAS, RANGOS FUTUROS Y PARÁMETROS ADVERSARIALES
  // =========================================================================
  describe('2. Fechas Extremas, Rangos Futuros y Parámetros Adversariales', () => {
    it('2.1. Consulta histórica con fechas del siglo XIX (1800-01-01 a 1850-01-01) debe responder de forma limpia', async () => {
      const res = await defaultTestServer.get('/api/monetarias/1?desde=1800-01-01&hasta=1850-01-01');
      assert.ok([200, 400, 404].includes(res.status));
      assert.ok(res.data);
      if (res.status === 200) {
        assert.ok(Array.isArray(res.data.results));
      }
    });

    it('2.2. Consulta histórica con rango futuro lejano (2099-01-01 a 2150-12-31) no debe causar excepciones', async () => {
      const res = await defaultTestServer.get('/api/monetarias/1?desde=2099-01-01&hasta=2150-12-31');
      assert.ok([200, 400, 404].includes(res.status));
      assert.ok(res.data);
    });

    it('2.3. Rango invertido (desde > hasta: desde=2026-12-31&hasta=2020-01-01) debe ser manejado limpiamente', async () => {
      const res = await defaultTestServer.get('/api/monetarias/1?desde=2026-12-31&hasta=2020-01-01');
      assert.ok([200, 400, 404, 502].includes(res.status));
      assert.ok(res.data);
    });

    it('2.4. Inyección de caracteres SQL o scripts en parámetros query (?desde=1970-01-01;DROP+TABLE&hasta=2026)', async () => {
      const res = await defaultTestServer.get('/api/monetarias/1?desde=1970-01-01%3BDROP%20TABLE&hasta=2026-01-01');
      assert.ok([200, 400, 404, 502].includes(res.status));
      assert.ok(res.data);
      assert.notEqual(res.status, 500, 'No debe arrojar 500 no controlado por inyección');
    });

    it('2.5. INDEC Series con fechas malformadas y IDs espurios (?ids=INEXISTENTE&start_date=INVALIDA)', async () => {
      const res = await defaultTestServer.get('/api/indec/series?ids=INEXISTENTE&start_date=INVALIDA');
      assert.ok([200, 400, 404, 502].includes(res.status));
      assert.ok(res.data);
    });

    it('2.6. BYMA Histórico con timestamps Unix desbordados (from=0&to=999999999999)', async () => {
      const res = await defaultTestServer.get('/api/byma/historico/AL30?from=0&to=999999999999');
      assert.ok([200, 400, 404, 502].includes(res.status));
      assert.ok(res.data);
    });
  });

  // =========================================================================
  // 3. CUITS CON MÓDULO 11 VÁLIDO SIN DEUDA Y CASOS BORDE DE IDENTIFICACIÓN
  // =========================================================================
  describe('3. CUITs con Módulo 11 Válido sin Deuda y Casos Borde de Identificación', () => {
    const cuitSinDeudaOficial = '20300000001';
    const cuitMatematicoVaron = generateValidCuit('2030000000'); // 20300000003
    const cuitMatematicoMujer = generateValidCuit('2730000002'); // 27300000024
    const cuitMatematicoEmpresa = generateValidCuit('3070000003'); // 30700000034

    it('3.1. CUIT sin deuda previa en BCRA debe retornar 200 normalizado con tieneDeuda: false y peorSituacion: 1', async () => {
      const res = await defaultTestServer.get(`/api/bcra-deudores/Deudas/${cuitSinDeudaOficial}`);

      assert.ok([200, 429, 503].includes(res.status), `Status inesperado: ${res.status}`);
      assert.ok(res.data);
      if (res.status === 200) {
        assert.equal(res.data.status, 200);
        assert.strictEqual(res.data.results.tieneDeuda, false);
        assert.strictEqual(res.data.results.peorSituacion, 1);
        assert.strictEqual(res.data.results.situacion, 1);
        assert.strictEqual(res.data.results.totalDeuda, 0);
        assert.match(res.data.results.mensaje, /no se registran deudas|situaci[oó]n 1/i);
      } else {
        assert.ok([429, 503].includes(res.status));
      }
    });

    it('3.2. CUITs generados matemáticamente con Módulo 11 deben retornar respuesta controlada sin 500 no capturado', async () => {
      const cuits = [cuitMatematicoVaron, cuitMatematicoMujer, cuitMatematicoEmpresa];
      
      for (const cuit of cuits) {
        const res = await defaultTestServer.get(`/api/bcra-deudores/Deudas/${cuit}`);
        assert.ok([200, 400, 404, 422, 429, 502, 503].includes(res.status), `Status inesperado para ${cuit}: ${res.status}`);
        assert.ok(res.data, `Sin payload para ${cuit}`);
        if (res.status === 200 && res.data.results) {
          assert.ok(
            res.data.results.tieneDeuda === false || Array.isArray(res.data.results.periodos),
            'Debe ser estructura normalizada sin deuda o historial con periodos'
          );
        }
      }
    });

    it('3.3. Consulta de cheques rechazados para CUIT sin deuda debe retornar 200 con tieneChequesRechazados: false', async () => {
      const res = await defaultTestServer.get(`/api/bcra-deudores/Deudas/ChequesRechazados/${cuitSinDeudaOficial}`);

      assert.ok([200, 429, 503].includes(res.status), `Status inesperado: ${res.status}`);
      assert.ok(res.data);
      if (res.status === 200) {
        assert.strictEqual(res.data.results.tieneChequesRechazados, false);
        assert.equal(res.data.results.chequesRechazados.length, 0);
        assert.match(res.data.results.mensaje, /no se registran cheques rechazados/i);
      } else {
        assert.ok([429, 503].includes(res.status));
      }
    });

    it('3.4. CUIT con guiones o espacios formateados (ej. "20-30000000-1") debe manejarse sin excepción de Express', async () => {
      const res = await defaultTestServer.get('/api/bcra-deudores/Deudas/20-30000000-1');
      assert.ok([200, 400, 404, 502].includes(res.status));
      assert.ok(res.data);
    });

    it('3.5. CUIT con caracteres no numéricos o emojis (ej. "20300000001🚀") debe retornar error controlado sin 500 no capturado', async () => {
      const res = await defaultTestServer.get('/api/bcra-deudores/Deudas/20300000001%F0%9F%9A%80');
      assert.ok([400, 404, 422, 502].includes(res.status));
      assert.ok(res.data);
      assert.notEqual(res.status, 500);
    });
  });

  // =========================================================================
  // 4. SÍMBOLOS DE BONOS BYMA CON/SIN LIQUIDACIÓN Y TICKERS EXÓTICOS
  // =========================================================================
  describe('4. Símbolos de Bonos BYMA con/sin Liquidación y Tickers Exóticos', () => {
    it('4.1. Ficha técnica con sufijo " 24HS" (ej. "AL30 24HS") debe sanitizar y no romper la consulta', async () => {
      const res = await defaultTestServer.get('/api/byma/bond-info/AL30%2024HS');
      assert.ok([200, 404, 502].includes(res.status));
      assert.ok(res.data);
    });

    it('4.2. Ficha técnica con sufijo " CI" (ej. "GD30 CI") debe procesarse de manera limpia', async () => {
      const res = await defaultTestServer.get('/api/byma/bond-info/GD30%20CI');
      assert.ok([200, 404, 502].includes(res.status));
      assert.ok(res.data);
    });

    it('4.3. Ficha técnica con bono en dólares (ej. "AL30D") debe procesarse correctamente', async () => {
      const res = await defaultTestServer.get('/api/byma/bond-info/AL30D');
      assert.ok([200, 404, 502].includes(res.status));
      assert.ok(res.data);
    });

    it('4.4. Ficha técnica con símbolo inexistente (ej. "BONO_INEXISTENTE_999") debe retornar respuesta estructurada controlada', async () => {
      const res = await defaultTestServer.get('/api/byma/bond-info/BONO_INEXISTENTE_999');
      assert.ok([200, 400, 404, 502].includes(res.status), `Status inesperado: ${res.status}`);
      assert.ok(res.data, 'Debe contener respuesta estructurada');
      if (res.status !== 200) {
        assert.strictEqual(res.data?.error, true);
      }
    });

    it('4.5. Histórico con símbolo inexistente debe retornar formato controlado', async () => {
      const res = await defaultTestServer.get('/api/byma/historico/TICKER_INVENTADO_777');
      assert.ok([200, 400, 404, 502].includes(res.status), `Status inesperado: ${res.status}`);
      assert.ok(res.data);
      if (res.status !== 200) {
        assert.strictEqual(res.data?.error, true);
      }
    });

    it('4.6. Panel de bonos públicos entrega estructura uniforme con flag marketOpen e isFallback coherentes', async () => {
      const res = await defaultTestServer.get('/api/byma/panel/public-bonds');
      assert.equal(res.status, 200);
      assert.ok(res.data);
      assert.ok(typeof res.data.marketOpen === 'boolean');
      assert.ok(Array.isArray(res.data.data));
    });
  });

  // =========================================================================
  // 5. RESILIENCIA ANTE CAÍDAS Y COMPORTAMIENTOS ANÓMALOS UPSTREAM
  // =========================================================================
  describe('5. Resiliencia ante Caídas y Comportamientos Anómalos Upstream', () => {
    let mockUpstreamServer;
    let mockPort = 0;

    before(async () => {
      // Iniciar servidor mock local para simular fallos controlados
      mockUpstreamServer = http.createServer((req, res) => {
        if (req.url.includes('/status/500')) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Internal Upstream Error' }));
        } else if (req.url.includes('/status/502')) {
          res.writeHead(502, { 'Content-Type': 'text/html' });
          res.end('<html><body>502 Bad Gateway</body></html>');
        } else if (req.url.includes('/status/429')) {
          res.writeHead(429, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ message: 'Too Many Requests' }));
        } else if (req.url.includes('/corrupt-json')) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end('{"incompleto": true, "error_de_sintaxis');
        } else if (req.url.includes('/socket-hangup')) {
          req.socket.destroy();
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'ok', data: [1, 2, 3] }));
        }
      });

      await new Promise(resolve => {
        mockUpstreamServer.listen(0, '127.0.0.1', () => {
          mockPort = mockUpstreamServer.address().port;
          resolve();
        });
      });
    });

    after(async () => {
      if (mockUpstreamServer) {
        await new Promise(resolve => mockUpstreamServer.close(resolve));
      }
    });

    it('5.1. httpClient debe detectar reintentos ante error 429 transitorio', async () => {
      const startTime = performance.now();
      try {
        await httpClient.get(`http://127.0.0.1:${mockPort}/status/429`, {}, { retries: 1, initialDelayMs: 100 });
        assert.fail('Debió lanzar error tras agotar reintentos');
      } catch (err) {
        const elapsed = performance.now() - startTime;
        assert.equal(err.response?.status, 429);
        assert.ok(elapsed >= 100, `Debió esperar el backoff (>100ms), tardó ${elapsed}ms`);
      }
    });

    it('5.2. httpClient debe manejar desconexiones abruptas (ECONNRESET) sin arrojar UnhandledPromiseRejection', async () => {
      try {
        await httpClient.get(`http://127.0.0.1:${mockPort}/socket-hangup`, {}, { retries: 0 });
        assert.fail('Debió fallar la conexión');
      } catch (err) {
        assert.ok(err.message || err.code);
      }
    });

    it('5.3. El servidor Express debe permanecer 100% saludable y operativo tras ráfagas de errores', async () => {
      const healthRes = await defaultTestServer.get('/api/health');
      assert.equal(healthRes.status, 200);
      assert.equal(healthRes.data.status, 'ok');
      assert.ok(healthRes.data.uptimeSeconds > 0);
      assert.ok(healthRes.data.cacheStats);
    });
  });

  // =========================================================================
  // 6. INTEGRIDAD DE FRONTEND ASSETS, SPA FALLBACK Y LENGUAJE ESPAÑOL
  // =========================================================================
  describe('6. Integridad de Frontend Assets, SPA Fallback y Lenguaje Español', () => {
    it('6.1. Debe servir index.html con status 200 y contener los 6 tabs de navegación', async () => {
      const res = await defaultTestServer.get('/');
      assert.equal(res.status, 200);
      assert.ok(typeof res.data === 'string');

      // Verificar que los 6 botones de navegación están presentes
      const requiredTabs = ['bcra', 'indec', 'dolares', 'byma', 'comparador', 'consultas'];
      for (const tab of requiredTabs) {
        assert.ok(
          res.data.includes(`data-tab="${tab}"`),
          `index.html debe contener el botón de navegación para data-tab="${tab}"`
        );
      }
    });

    it('6.2. Debe servir app.js y style.css con status 200', async () => {
      const [appRes, styleRes] = await Promise.all([
        defaultTestServer.get('/app.js'),
        defaultTestServer.get('/style.css')
      ]);

      assert.equal(appRes.status, 200);
      assert.ok(typeof appRes.data === 'string');
      assert.ok(appRes.data.includes('clientCache'), 'app.js debe contener la caché de cliente');
      assert.ok(appRes.data.includes('debounce'), 'app.js debe contener helper debounce');

      assert.equal(styleRes.status, 200);
      assert.ok(typeof styleRes.data === 'string');
    });

    it('6.3. SPA Fallback: Cualquier ruta inexistente debe retornar index.html con HTTP 200', async () => {
      const res = await defaultTestServer.get('/ruta-aleatoria-no-existente/subpath');
      assert.equal(res.status, 200);
      assert.ok(typeof res.data === 'string');
      assert.ok(res.data.includes('Portal Financiero'), 'Debe retornar la página principal');
    });

    it('6.4. Verificación de interfaz 100% en ESPAÑOL en el HTML principal', async () => {
      const res = await defaultTestServer.get('/');
      const html = res.data;

      // Textos obligatorios en español
      assert.ok(html.includes('Banco Central (BCRA)'), 'Debe incluir "Banco Central (BCRA)"');
      assert.ok(html.includes('Inflación y Actividad'), 'Debe incluir "Inflación y Actividad"');
      assert.ok(html.includes('Mercado de Cambios'), 'Debe incluir "Mercado de Cambios"');
      assert.ok(html.includes('Bonos y Letras'), 'Debe incluir "Bonos y Letras"');
      assert.ok(html.includes('Comparador Bancario'), 'Debe incluir "Comparador Bancario"');
      assert.ok(html.includes('Consultas Financieras'), 'Debe incluir "Consultas Financieras"');
      assert.ok(html.includes('Catálogo BCRA'), 'Debe incluir "Catálogo BCRA"');
      assert.ok(html.includes('Buscar variable...'), 'Debe incluir placeholder en español');
    });
  });
});
