/**
 * tests/indec-adversarial-stress.test.js
 * Adversarial and Empirical Stress Test Suite for INDEC API Integration.
 * 
 * Executed by challenger_indec_1 to stress-test:
 * 1. Extreme & hostile query parameters (special characters, SQLi, XSS, nulls, 100 invalid IDs, arrays).
 * 2. Date range boundary edge cases (start_date > end_date, future, ancient, malformed, array pollution).
 * 3. Concurrency stress: 30 concurrent requests verifying zero crashes, stability, and heap safety.
 * 4. Fallback latency check: network failure (< 500ms) and upstream timeout (> 5000ms) with valid snapshot.
 * 5. RIPTE hydration verification: numerical invariants, non-NaN/non-null hydration under corrupted upstream.
 */

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { TestServer } = require('./helpers/setup');
const httpClient = require('../services/httpClient');
const { cacheService } = require('../services/cacheService');

describe('Adversarial INDEC Stress & Robustness Suite (challenger_indec_1)', () => {
  let testServer;
  const VALID_FRONTEND_IDS = '145.3_INGNACUAL_DICI_M_38,148.3_INUCLEONAL_DICI_M_19,158.1_REPTE_0_0_5,143.3_NO_PR_2004_A_31,143.3_NO_PR_2004_A_21';

  before(async () => {
    testServer = new TestServer();
    await testServer.start();
  });

  after(async () => {
    await testServer.stop();
    cacheService.clear();
  });

  beforeEach(() => {
    cacheService.clear();
  });

  // =========================================================================
  // 1. EXTREME & HOSTILE QUERY PARAMETERS
  // =========================================================================
  describe('1. Extreme & Hostile Query Parameters', () => {
    it('1.1. Inyección de caracteres hostiles, XSS y SQLi en "ids" no deben tirar el servidor ni crashear', async () => {
      const hostileVectors = [
        '<script>alert("xss")</script>',
        "' OR '1'='1' --",
        '${process.exit(1)}',
        '!@#$%^&*()_+~|}{[]:;?><',
        '../../../../etc/passwd',
        '📈🔥💥💣',
        '%00%0a%0d'
      ];

      for (const vector of hostileVectors) {
        const res = await testServer.get(`/api/indec/series?ids=${encodeURIComponent(vector)}&nocache=true`);
        assert.equal(res.status, 200, `Debe responder 200 para vector: ${vector}`);
        assert.ok(res.data, 'La respuesta no debe ser nula');
        assert.ok(Array.isArray(res.data.data), 'data debe ser un array');
        assert.ok(Array.isArray(res.data.meta), 'meta debe ser un array');
      }
    });

    it('1.2. Parámetro "ids" vacío, nulo o con comas consecutivas arbitrarias', async () => {
      const edgeCases = [
        '',
        'null',
        'undefined',
        ',,,,,',
        ',,,145.3_INGNACUAL_DICI_M_38,,,   ,148.3_INUCLEONAL_DICI_M_19,,,,',
        '   145.3_INGNACUAL_DICI_M_38  ,  148.3_INUCLEONAL_DICI_M_19   '
      ];

      for (const idsVal of edgeCases) {
        const res = await testServer.get(`/api/indec/series?ids=${encodeURIComponent(idsVal)}&nocache=true`);
        assert.equal(res.status, 200);
        assert.ok(res.data && Array.isArray(res.data.data), 'data debe ser un array válido');
      }
    });

    it('1.3. Consulta con 100 IDs inexistentes en una sola petición', async () => {
      const fakeIds = Array.from({ length: 100 }, (_, i) => `non_existent_series_xyz_${i}`).join(',');
      const res = await testServer.get(`/api/indec/series?ids=${encodeURIComponent(fakeIds)}&nocache=true`);
      
      assert.equal(res.status, 200);
      assert.ok(Array.isArray(res.data.data));
      assert.equal(res.data.data.length, 0, 'Para 100 IDs inexistentes debe retornar data vacía');
      assert.equal(res.data.count, 0);
    });

    it('1.4. Valores extremos y hostiles en "limit" (negativo, cero, NaN, string)', async () => {
      const hostileLimits = ['-10', '0', 'not_a_number', '99999999999999', 'Infinity', 'NaN'];

      for (const lim of hostileLimits) {
        const res = await testServer.get(`/api/indec/series?ids=145.3_INGNACNAL_DICI_M_15&limit=${encodeURIComponent(lim)}&nocache=true`);
        assert.equal(res.status, 200, `Debe responder 200 para limit=${lim}`);
        assert.ok(Array.isArray(res.data.data));
      }
    });

    it('1.5. Contaminación de parámetros HTTP (ids como array duplicado ?ids=a&ids=b)', async () => {
      const res = await testServer.get(`/api/indec/series?ids=145.3_INGNACUAL_DICI_M_38&ids=148.3_INUCLEONAL_DICI_M_19&nocache=true`);
      assert.equal(res.status, 200);
      assert.ok(Array.isArray(res.data.data));
      assert.ok(Array.isArray(res.data.meta));
    });
  });

  // =========================================================================
  // 2. CASOS BORDE EN RANGOS DE FECHA
  // =========================================================================
  describe('2. Date Range Boundary Edge Cases', () => {
    it('2.1. start_date posterior a end_date (start_date > end_date)', async () => {
      const res = await testServer.get('/api/indec/series?ids=145.3_INGNACNAL_DICI_M_15&start_date=2025-12-31&end_date=2024-01-01&nocache=true');
      assert.equal(res.status, 200);
      assert.ok(Array.isArray(res.data.data));
      assert.equal(res.data.data.length, 0, 'data debe estar vacía para rango invertido');
      assert.equal(res.data.count, 0);
    });

    it('2.2. Fechas en el futuro lejano (2099-01-01)', async () => {
      const res = await testServer.get('/api/indec/series?ids=145.3_INGNACNAL_DICI_M_15&start_date=2099-01-01&end_date=2150-12-31&nocache=true');
      assert.equal(res.status, 200);
      assert.ok(Array.isArray(res.data.data));
      assert.equal(res.data.data.length, 0, 'data debe estar vacía para fechas en el futuro');
    });

    it('2.3. Fechas en el pasado remoto (1800-01-01)', async () => {
      const res = await testServer.get('/api/indec/series?ids=145.3_INGNACNAL_DICI_M_15&start_date=1800-01-01&end_date=1850-01-01&nocache=true');
      assert.equal(res.status, 200);
      assert.ok(Array.isArray(res.data.data));
      assert.equal(res.data.data.length, 0, 'data debe estar vacía para fechas anteriores al dataset');
    });

    it('2.4. Fechas ISO malformadas, meses 99 o cadenas no-fecha', async () => {
      const malformedDates = [
        'not-a-date',
        '2024-99-99',
        '2024/01/01',
        'invalid-iso-string',
        '9999999999'
      ];

      for (const d of malformedDates) {
        const res = await testServer.get(`/api/indec/series?ids=145.3_INGNACNAL_DICI_M_15&start_date=${encodeURIComponent(d)}&nocache=true`);
        assert.equal(res.status, 200, `Debe manejar fecha malformada: ${d}`);
        assert.ok(Array.isArray(res.data.data));
      }
    });

    it('2.5. Contaminación de parámetros en fechas (?start_date=a&start_date=b)', async () => {
      const res = await testServer.get('/api/indec/series?ids=145.3_INGNACNAL_DICI_M_15&start_date=2024-01-01&start_date=2024-06-01&nocache=true');
      assert.equal(res.status, 200);
      assert.ok(Array.isArray(res.data.data));
    });
  });

  // =========================================================================
  // 3. CONCURRENCY STRESS: 30 PETICIONES CONCURRENTES
  // =========================================================================
  describe('3. Concurrency Stress (30 Concurrent Requests)', () => {
    it('3.1. Ráfaga de 30 peticiones concurrentes con parámetros variados y bypass de caché', async () => {
      const initialMem = process.memoryUsage().heapUsed;
      const queries = [
        `/api/indec/series?ids=${encodeURIComponent(VALID_FRONTEND_IDS)}&limit=12&nocache=true`,
        `/api/indec/series?ids=145.3_INGNACNAL_DICI_M_15&limit=24&nocache=true`,
        `/api/indec/series?ids=158.1_REPTE_0_0_5&start_date=2024-01-01&nocache=true`,
        `/api/indec/series?ids=invalid_id_concurrency&nocache=true`,
        `/api/indec/series?ids=${encodeURIComponent(VALID_FRONTEND_IDS)}&limit=5&nocache=true`
      ];

      const promises = [];
      for (let i = 0; i < 30; i++) {
        const q = queries[i % queries.length] + `&rnd=${i}_${Date.now()}`;
        promises.push(testServer.get(q));
      }

      const results = await Promise.all(promises);

      // Todas las peticiones deben resolver exitosamente con HTTP 200
      assert.equal(results.length, 30);
      for (let i = 0; i < results.length; i++) {
        assert.equal(results[i].status, 200, `Petición concurrente #${i + 1} debe ser 200`);
        assert.ok(results[i].data, `Petición concurrente #${i + 1} debe retornar body`);
        assert.ok(Array.isArray(results[i].data.data), `Petición concurrente #${i + 1} data debe ser array`);
      }

      // Validar salud del servidor tras la ráfaga
      const healthRes = await testServer.get('/api/health');
      assert.equal(healthRes.status, 200);
      assert.equal(healthRes.data.status, 'ok');

      // Validar estabilidad de memoria: heap delta < 50MB
      const finalMem = process.memoryUsage().heapUsed;
      const memDeltaMb = (finalMem - initialMem) / (1024 * 1024);
      assert.ok(memDeltaMb < 50, `Crecimiento de memoria controlado (${memDeltaMb.toFixed(2)} MB < 50 MB)`);
    });
  });

  // =========================================================================
  // 4. FALLBACK LATENCY & RESILIENCE CHECK
  // =========================================================================
  describe('4. Fallback Latency & Upstream Resilience Check', () => {
    it('4.1. Fallo de red inmediato (ECONNREFUSED) entrega snapshot en < 500ms con isFallback: true', async () => {
      const originalGet = httpClient.get;
      httpClient.get = async function (url, config, options) {
        if (typeof url === 'string' && (url.includes('apis.datos.gob.ar') || url.includes('indec.gob.ar'))) {
          const err = new Error('Simulated network disconnection');
          err.code = 'ECONNREFUSED';
          throw err;
        }
        return originalGet.call(this, url, config, options);
      };

      const start = performance.now();
      try {
        const res = await testServer.get(`/api/indec/series?ids=${encodeURIComponent(VALID_FRONTEND_IDS)}&limit=10&nocache=true`);
        const elapsed = performance.now() - start;

        assert.equal(res.status, 200);
        assert.strictEqual(res.data.isFallback, true);
        assert.strictEqual(res.data.cached, true);
        assert.ok(elapsed < 500, `Debe responder de forma casi instantánea (< 500ms), tardó ${elapsed.toFixed(1)}ms`);
        assert.equal(res.data.data.length, 10);
      } finally {
        httpClient.get = originalGet;
      }
    });

    it('4.2. Timeout upstream de 5000ms conmute ordenadamente a contingencia snapshot', async () => {
      const originalGet = httpClient.get;
      httpClient.get = async function (url, config, options) {
        if (typeof url === 'string' && (url.includes('apis.datos.gob.ar') || url.includes('indec.gob.ar'))) {
          const err = new Error('timeout of 5000ms exceeded');
          err.code = 'ECONNABORTED';
          throw err;
        }
        return originalGet.call(this, url, config, options);
      };

      try {
        const res = await testServer.get(`/api/indec/series?ids=${encodeURIComponent(VALID_FRONTEND_IDS)}&limit=5&nocache=true`);
        assert.equal(res.status, 200);
        assert.strictEqual(res.data.isFallback, true);
        assert.equal(res.data.data.length, 5);
        assert.ok(Array.isArray(res.data.meta));
        assert.equal(res.data.meta.length, 6);
      } finally {
        httpClient.get = originalGet;
      }
    });

    it('4.3. Si se piden IDs inexistentes durante corte/fallback, retorna estructura limpia sin romper', async () => {
      const originalGet = httpClient.get;
      httpClient.get = async function (url, config, options) {
        if (typeof url === 'string' && (url.includes('apis.datos.gob.ar') || url.includes('indec.gob.ar'))) {
          const err = new Error('Upstream unavailable');
          err.code = 'ENOTFOUND';
          throw err;
        }
        return originalGet.call(this, url, config, options);
      };

      try {
        const res = await testServer.get('/api/indec/series?ids=fake_serie_123&nocache=true');
        assert.equal(res.status, 200);
        assert.strictEqual(res.data.isFallback, true);
        assert.equal(res.data.data.length, 0);
        assert.equal(res.data.count, 0);
      } finally {
        httpClient.get = originalGet;
      }
    });
  });

  // =========================================================================
  // 5. RIPTE HYDRATION & NUMERICAL INVARIANTS
  // =========================================================================
  describe('5. RIPTE Hydration & Numerical Invariants', () => {
    it('5.1. Columna RIPTE (158.1_REPTE_0_0_5) nunca debe contener undefined, null o NaN', async () => {
      const res = await testServer.get(`/api/indec/series?ids=${encodeURIComponent(VALID_FRONTEND_IDS)}&start_date=2023-01-01&limit=36&nocache=true`);
      assert.equal(res.status, 200);
      assert.ok(res.data.data.length > 0);

      // Localizar índice de columna de RIPTE
      const ripteColIdx = res.data.meta.findIndex(m => m.field?.id === '158.1_REPTE_0_0_5');
      assert.ok(ripteColIdx > 0, 'La columna RIPTE debe estar presente en meta');

      for (const row of res.data.data) {
        const ripteVal = row[ripteColIdx];
        assert.notStrictEqual(ripteVal, undefined, `RIPTE en ${row[0]} no debe ser undefined`);
        assert.notStrictEqual(ripteVal, null, `RIPTE en ${row[0]} no debe ser null`);
        assert.equal(typeof ripteVal, 'number', `RIPTE en ${row[0]} debe ser number`);
        assert.ok(!isNaN(ripteVal), `RIPTE en ${row[0]} no debe ser NaN`);
        assert.ok(ripteVal > 50000, `RIPTE nominal en ${row[0]} debe ser coherente (> 50.000 ARS, valor=${ripteVal})`);
      }
    });

    it('5.2. Hidratación resiliente ante upstream que retorna valores NaN o null en RIPTE', async () => {
      const originalGet = httpClient.get;
      httpClient.get = async function (url, config, options) {
        if (typeof url === 'string' && url.includes('apis.datos.gob.ar')) {
          return {
            status: 200,
            data: {
              data: [
                ['2023-01-01', 0.060, null],
                ['2023-02-01', 0.066, NaN],
                ['2023-03-01', 0.077, undefined]
              ],
              meta: [
                { field: { id: 'indice_tiempo', description: 'Tiempo' } },
                { field: { id: '145.3_INGNACUAL_DICI_M_38', description: 'IPC' } },
                { field: { id: '158.1_REPTE_0_0_5', description: 'RIPTE' } }
              ],
              count: 3,
              params: { ids: '145.3_INGNACUAL_DICI_M_38,158.1_REPTE_0_0_5' }
            }
          };
        }
        return originalGet.call(this, url, config, options);
      };

      try {
        const res = await testServer.get('/api/indec/series?ids=145.3_INGNACUAL_DICI_M_38,158.1_REPTE_0_0_5&nocache=true');
        assert.equal(res.status, 200);
        assert.equal(res.data.data.length, 3);

        for (let i = 0; i < 3; i++) {
          const val = res.data.data[i][2];
          assert.equal(typeof val, 'number', `Fila ${i} hidratada debe ser number`);
          assert.ok(!isNaN(val), `Fila ${i} hidratada no debe ser NaN`);
          assert.ok(val > 0, `Fila ${i} hidratada debe ser mayor a 0`);
        }

        assert.equal(res.data.data[0][2], 205342);
        assert.equal(res.data.data[1][2], 218450);
        assert.equal(res.data.data[2][2], 239120);
      } finally {
        httpClient.get = originalGet;
      }
    });

    it('5.3. Hidratación compatible con fechas en formato YYYY-MM en el upstream', async () => {
      const originalGet = httpClient.get;
      httpClient.get = async function (url, config, options) {
        if (typeof url === 'string' && url.includes('apis.datos.gob.ar')) {
          return {
            status: 200,
            data: {
              data: [
                ['2023-05', 0.078, null],
                ['2023-06', 0.060, null]
              ],
              meta: [
                { field: { id: 'indice_tiempo', description: 'Tiempo' } },
                { field: { id: '145.3_INGNACUAL_DICI_M_38', description: 'IPC' } },
                { field: { id: '158.1_REPTE_0_0_5', description: 'RIPTE' } }
              ],
              count: 2,
              params: {}
            }
          };
        }
        return originalGet.call(this, url, config, options);
      };

      try {
        const res = await testServer.get('/api/indec/series?ids=145.3_INGNACUAL_DICI_M_38,158.1_REPTE_0_0_5&nocache=true');
        assert.equal(res.status, 200);
        assert.equal(res.data.data[0][2], 285430, 'Debe hidratar mayo 2023 con 285430');
        assert.equal(res.data.data[1][2], 309870, 'Debe hidratar junio 2023 con 309870');
      } finally {
        httpClient.get = originalGet;
      }
    });
  });
});
