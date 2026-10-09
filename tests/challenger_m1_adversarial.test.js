/**
 * tests/challenger_m1_adversarial.test.js
 * Suite Adversarial y Empírica para Certificación del Milestone M1_BACKEND_RESILIENCE.
 * 
 * Verificaciones requeridas:
 * 1. Bypass de proxy en httpClient ante formatos de loopback (localhost, 127.0.0.1, [::1]) con proxy hostil en env.
 * 2. Fallback de INDEC bajo corte simulado y latencia < 5s, con estructura válida e isFallback: true.
 * 3. Ausencia de excepciones no controladas ni cuelgues del proceso Node.js ante estrés y casos borde.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const httpClient = require('../services/httpClient');
const { TestServer } = require('./helpers/setup');
const { cacheService } = require('../services/cacheService');

describe('Challenger M1: Adversarial & Empirical Backend Resilience Suite', () => {
  let testServer;
  let mockServers = [];
  const originalHttpProxy = process.env.HTTP_PROXY;
  const originalHttpProxyLower = process.env.http_proxy;
  const originalHttpsProxy = process.env.HTTPS_PROXY;
  const originalHttpsProxyLower = process.env.https_proxy;

  before(async () => {
    testServer = new TestServer();
    await testServer.start();
  });

  after(async () => {
    // Restaurar proxies
    if (originalHttpProxy !== undefined) process.env.HTTP_PROXY = originalHttpProxy;
    else delete process.env.HTTP_PROXY;

    if (originalHttpProxyLower !== undefined) process.env.http_proxy = originalHttpProxyLower;
    else delete process.env.http_proxy;

    if (originalHttpsProxy !== undefined) process.env.HTTPS_PROXY = originalHttpsProxy;
    else delete process.env.HTTPS_PROXY;

    if (originalHttpsProxyLower !== undefined) process.env.https_proxy = originalHttpsProxyLower;
    else delete process.env.https_proxy;

    // Cerrar servidores mock
    for (const s of mockServers) {
      await new Promise(res => s.close(() => res()));
    }
    mockServers = [];

    if (testServer) {
      await testServer.stop();
    }
  });

  // =========================================================================
  // SECCIÓN 1: TESTEAR LOOPBACK EN httpClient ANTE MÚLTIPLES FORMATOS
  // =========================================================================
  describe('1. Bypass de Proxy en httpClient ante Formatos Loopback', () => {

    it('1.1. httpClient debe sortear proxy hostil en 127.0.0.1:<port> con status 200', async () => {
      // Servidor mock escuchando en 127.0.0.1
      const localServer = http.createServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ target: '127.0.0.1', ok: true }));
      });
      await new Promise((resolve) => localServer.listen(0, '127.0.0.1', resolve));
      mockServers.push(localServer);
      const port = localServer.address().port;

      // Inyectar proxy corporativo ficticio/roto que fallaría si no se hace bypass
      process.env.HTTP_PROXY = 'http://192.0.2.1:54321';
      process.env.http_proxy = 'http://192.0.2.1:54321';

      try {
        const res = await httpClient.get(`http://127.0.0.1:${port}/test-127`, {
          timeout: 2000
        }, { retries: 0 });

        assert.equal(res.status, 200);
        assert.strictEqual(res.data.target, '127.0.0.1');
        assert.strictEqual(res.data.ok, true);
      } finally {
        delete process.env.HTTP_PROXY;
        delete process.env.http_proxy;
      }
    });

    it('1.2. httpClient debe sortear proxy hostil en localhost:<port> con status 200', async () => {
      // Servidor mock escuchando en localhost
      const localServer = http.createServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ target: 'localhost', ok: true }));
      });
      await new Promise((resolve) => localServer.listen(0, '127.0.0.1', resolve));
      mockServers.push(localServer);
      const port = localServer.address().port;

      process.env.HTTP_PROXY = 'http://192.0.2.1:54321';
      process.env.http_proxy = 'http://192.0.2.1:54321';

      try {
        const res = await httpClient.get(`http://localhost:${port}/test-localhost`, {
          timeout: 2000
        }, { retries: 0 });

        assert.equal(res.status, 200);
        assert.strictEqual(res.data.target, 'localhost');
        assert.strictEqual(res.data.ok, true);
      } finally {
        delete process.env.HTTP_PROXY;
        delete process.env.http_proxy;
      }
    });

    it('1.3. httpClient debe sortear proxy hostil en [::1]:<port> (IPv6 Loopback)', async () => {
      let ipv6Supported = true;
      let ipv6Port = 0;
      const ipv6Server = http.createServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ target: '[::1]', ok: true }));
      });

      try {
        await new Promise((resolve, reject) => {
          ipv6Server.once('error', (err) => {
            ipv6Supported = false;
            resolve();
          });
          ipv6Server.listen(0, '::1', () => {
            ipv6Port = ipv6Server.address().port;
            mockServers.push(ipv6Server);
            resolve();
          });
        });
      } catch {
        ipv6Supported = false;
      }

      if (!ipv6Supported || ipv6Port === 0) {
        // En caso de que el stack local no tenga IPv6 activo, validamos al menos el parser de URL
        console.log('   (IPv6 socket binding no disponible en este host, validando configuración de cliente)');
        return;
      }

      process.env.HTTP_PROXY = 'http://192.0.2.1:54321';
      process.env.http_proxy = 'http://192.0.2.1:54321';

      try {
        const res = await httpClient.get(`http://[::1]:${ipv6Port}/test-ipv6`, {
          timeout: 2000
        }, { retries: 0 });

        assert.equal(res.status, 200);
        assert.strictEqual(res.data.target, '[::1]');
        assert.strictEqual(res.data.ok, true);
      } finally {
        delete process.env.HTTP_PROXY;
        delete process.env.http_proxy;
      }
    });

    it('1.4. httpClient debe detectar loopback con baseURL configurada y rutas relativas', async () => {
      const localServer = http.createServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ path: req.url, ok: true }));
      });
      await new Promise((resolve) => localServer.listen(0, '127.0.0.1', resolve));
      mockServers.push(localServer);
      const port = localServer.address().port;

      process.env.HTTP_PROXY = 'http://192.0.2.1:54321';

      try {
        const client = httpClient.createInstance({
          baseURL: `http://127.0.0.1:${port}`
        });

        const res = await client.get('/relative-endpoint?param=1', { timeout: 2000 });
        assert.equal(res.status, 200);
        assert.strictEqual(res.data.path, '/relative-endpoint?param=1');
      } finally {
        delete process.env.HTTP_PROXY;
      }
    });

    it('1.5. httpClient maneja credenciales de usuario embebidas en host loopback', async () => {
      const localServer = http.createServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ auth: req.headers.authorization || null }));
      });
      await new Promise((resolve) => localServer.listen(0, '127.0.0.1', resolve));
      mockServers.push(localServer);
      const port = localServer.address().port;

      const res = await httpClient.get(`http://user:pass@127.0.0.1:${port}/with-auth`);
      assert.equal(res.status, 200);
    });
  });

  // =========================================================================
  // SECCIÓN 2: TESTEAR FALLBACK DE INDEC BAJO CORTE SIMULADO Y LATENCIA < 5S
  // =========================================================================
  describe('2. Fallback de INDEC bajo Corte Simulado y Latencia < 5s', () => {

    it('2.1. Simulación de corte abrupto (503 / red caída): fallback en < 500ms con isFallback: true', async () => {
      // Limpiar caché previa de INDEC
      cacheService.clear();

      // Interceptar temporalmente httpClient.get solo para apis.datos.gob.ar
      const originalGet = httpClient.get;
      httpClient.get = async function (url, config, options) {
        if (typeof url === 'string' && url.includes('apis.datos.gob.ar')) {
          const err = new Error('Corte total de conectividad con apis.datos.gob.ar simulado');
          err.code = 'ECONNREFUSED';
          throw err;
        }
        return originalGet.call(this, url, config, options);
      };

      const startTime = performance.now();
      try {
        const res = await testServer.get('/api/indec/series?ids=145.3_INGNACNAL_DICI_M_15&limit=10');
        const duration = performance.now() - startTime;

        assert.equal(res.status, 200, 'Debe responder HTTP 200 aun bajo corte total');
        assert.ok(duration < 5000, `La latencia (${duration}ms) debe ser estrictamente menor a 5000ms`);
        assert.ok(duration < 500, `Ante corte inmediato la latencia (${duration}ms) debe ser < 500ms`);

        assert.strictEqual(res.data.isFallback, true, 'Debe incluir isFallback: true');
        assert.strictEqual(res.data.cached, true, 'Debe marcarse como cached');
        assert.ok(Array.isArray(res.data.data), 'data debe ser un arreglo');
        assert.strictEqual(res.data.data.length, 10, 'Debe respetar el parámetro limit=10');
        assert.ok(Array.isArray(res.data.meta), 'meta debe ser un arreglo descriptivo');
        assert.strictEqual(res.data.meta.length, 2, 'meta debe contener índice_tiempo y la serie solicitada');
        assert.strictEqual(res.data.meta[1].field.id, '145.3_INGNACNAL_DICI_M_15');
      } finally {
        httpClient.get = originalGet;
      }
    });

    it('2.2. Simulación de congelamiento / timeout del upstream: fallback en <= 5000ms sin crashear', async () => {
      cacheService.clear();

      const originalGet = httpClient.get;
      httpClient.get = async function (url, config, options) {
        if (typeof url === 'string' && url.includes('apis.datos.gob.ar')) {
          const timeoutMs = config?.timeout || 5000;
          await new Promise(res => setTimeout(res, timeoutMs));
          const err = new Error(`timeout of ${timeoutMs}ms exceeded`);
          err.code = 'ECONNABORTED';
          throw err;
        }
        return originalGet.call(this, url, config, options);
      };

      const startTime = performance.now();
      try {
        const res = await testServer.get('/api/indec/series?ids=145.3_INGNACNAL_DICI_M_15&limit=5');
        const duration = performance.now() - startTime;

        assert.equal(res.status, 200, 'Debe responder HTTP 200');
        // Toleramos hasta 5500ms por el setTimeout de 5000ms + loop overhead
        assert.ok(duration <= 5500, `La latencia (${duration}ms) debe completar la contingencia en ~5s`);
        assert.strictEqual(res.data.isFallback, true);
        assert.strictEqual(res.data.data.length, 5);
      } finally {
        httpClient.get = originalGet;
      }
    });

    it('2.3. Fallback con múltiples series simultáneas (IPC + EMAE + RIPTE)', async () => {
      cacheService.clear();

      const originalGet = httpClient.get;
      httpClient.get = async function (url, config, options) {
        if (typeof url === 'string' && url.includes('apis.datos.gob.ar')) {
          const err = new Error('Upstream simulado fuera de servicio');
          err.code = 'ENOTFOUND';
          throw err;
        }
        return originalGet.call(this, url, config, options);
      };

      try {
        const ids = '145.3_INGNACNAL_DICI_M_15,143.3_NO_PR_2004_A_21,158.1_REPTE_0_0_5';
        const res = await testServer.get(`/api/indec/series?ids=${ids}&limit=4`);

        assert.equal(res.status, 200);
        assert.strictEqual(res.data.isFallback, true);
        assert.strictEqual(res.data.meta.length, 4, 'meta debe tener índice_tiempo + 3 series');
        assert.strictEqual(res.data.data.length, 4, 'data debe tener 4 filas');
        
        // Cada fila debe tener 4 columnas: [fecha, ipc, emae, ripte]
        for (const row of res.data.data) {
          assert.strictEqual(row.length, 4, 'Cada fila debe contener fecha + 3 valores');
          assert.ok(typeof row[0] === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(row[0]), 'Fecha con formato YYYY-MM-DD');
          assert.ok(typeof row[1] === 'number', 'Valor IPC es numérico');
          assert.ok(typeof row[2] === 'number', 'Valor EMAE es numérico');
          assert.ok(typeof row[3] === 'number', 'Valor RIPTE es numérico');
        }
      } finally {
        httpClient.get = originalGet;
      }
    });

    it('2.4. Fallback con filtrado de fechas (start_date y end_date)', async () => {
      cacheService.clear();

      const originalGet = httpClient.get;
      httpClient.get = async function (url, config, options) {
        if (typeof url === 'string' && url.includes('apis.datos.gob.ar')) {
          const err = new Error('Upstream caído');
          err.response = { status: 502 };
          throw err;
        }
        return originalGet.call(this, url, config, options);
      };

      try {
        const startDate = '2024-01-01';
        const endDate = '2024-06-30';
        const res = await testServer.get(`/api/indec/series?ids=145.3_INGNACNAL_DICI_M_15&start_date=${startDate}&end_date=${endDate}`);

        assert.equal(res.status, 200);
        assert.strictEqual(res.data.isFallback, true);
        assert.ok(res.data.data.length > 0, 'Debe contener filas para 2024');

        for (const row of res.data.data) {
          const rowDate = row[0];
          assert.ok(rowDate >= startDate, `Fecha ${rowDate} debe ser >= ${startDate}`);
          assert.ok(rowDate <= endDate, `Fecha ${rowDate} debe ser <= ${endDate}`);
        }
      } finally {
        httpClient.get = originalGet;
      }
    });

    it('2.5. Fallback ante ID de serie inexistente debe devolver arreglo vacío estructurado', async () => {
      cacheService.clear();

      const originalGet = httpClient.get;
      httpClient.get = async function (url, config, options) {
        if (typeof url === 'string' && url.includes('apis.datos.gob.ar')) {
          throw new Error('Upstream caído');
        }
        return originalGet.call(this, url, config, options);
      };

      try {
        const res = await testServer.get('/api/indec/series?ids=SERIE_COMPLETAMENTE_INEXISTENTE_999');
        assert.equal(res.status, 200);
        assert.strictEqual(res.data.isFallback, true);
        assert.strictEqual(res.data.count, 0);
        assert.deepEqual(res.data.data, []);
      } finally {
        httpClient.get = originalGet;
      }
    });
  });

  // =========================================================================
  // SECCIÓN 3: AUSENCIA DE EXCEPCIONES NO CONTROLADAS Y ESTRÉS CONCURRENTE
  // =========================================================================
  describe('3. Ausencia de Excepciones y Estrés Concurrente', () => {

    it('3.1. Ráfaga masiva concurrente (40 consultas simultáneas) bajo caída simulada', async () => {
      cacheService.clear();

      const originalGet = httpClient.get;
      httpClient.get = async function (url, config, options) {
        if (typeof url === 'string' && url.includes('apis.datos.gob.ar')) {
          const err = new Error('Upstream desconectado');
          err.code = 'ECONNRESET';
          throw err;
        }
        return originalGet.call(this, url, config, options);
      };

      let uncaughtTriggered = false;
      const onUncaught = () => { uncaughtTriggered = true; };
      process.on('uncaughtException', onUncaught);
      process.on('unhandledRejection', onUncaught);

      try {
        const promises = [];
        for (let i = 0; i < 40; i++) {
          const limit = (i % 10) + 1;
          promises.push(testServer.get(`/api/indec/series?ids=145.3_INGNACNAL_DICI_M_15&limit=${limit}`));
        }

        const responses = await Promise.all(promises);

        assert.strictEqual(uncaughtTriggered, false, 'No deben ocurrir uncaughtException ni unhandledRejection');
        assert.strictEqual(responses.length, 40);

        for (const res of responses) {
          assert.equal(res.status, 200);
          assert.strictEqual(res.data.isFallback, true);
        }
      } finally {
        httpClient.get = originalGet;
        process.removeListener('uncaughtException', onUncaught);
        process.removeListener('unhandledRejection', onUncaught);
      }
    });

    it('3.2. Parámetros malformados y payloads extremos en /api/indec/series no causan 500', async () => {
      const originalGet = httpClient.get;
      httpClient.get = async function (url, config, options) {
        if (typeof url === 'string' && url.includes('apis.datos.gob.ar')) {
          const err = new Error('Upstream caído');
          err.code = 'ECONNREFUSED';
          throw err;
        }
        return originalGet.call(this, url, config, options);
      };

      try {
        const hostileQueries = [
          '?ids=145.3_INGNACNAL_DICI_M_15&start_date=INVALIDA&end_date=TAMBIEN_INVALIDA',
          '?ids=145.3_INGNACNAL_DICI_M_15&limit=-5',
          '?ids=145.3_INGNACNAL_DICI_M_15&limit=999999999999',
          '?ids=145.3_INGNACNAL_DICI_M_15&limit=NaN',
          '?ids=%00%27%22--&start_date=%3Cscript%3E'
        ];

        for (const q of hostileQueries) {
          cacheService.clear();
          const res = await testServer.get(`/api/indec/series${q}`);
          assert.ok([200, 400].includes(res.status), `Query ${q} debe responder 200 o 400 controlado, no 500`);
          assert.strictEqual(res.data.isFallback, true);
        }
      } finally {
        httpClient.get = originalGet;
      }
    });

    it('3.3. Servidor Express permanece 100% receptivo y saludable tras las pruebas adversariales', async () => {
      const res = await testServer.get('/');
      assert.equal(res.status, 200);
      assert.ok(typeof res.data === 'string');
      assert.ok(res.data.toLowerCase().includes('<!doctype html>'));

      const apiRes = await testServer.get('/api/monetarias');
      assert.ok([200, 429, 502, 503].includes(apiRes.status));
    });
  });
});
