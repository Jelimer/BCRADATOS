/**
 * tests/challenger_indec_adversarial.test.js
 * Suite Adversarial de Verificación Empírica de Contratos, Caché y Resiliencia en Cascada para INDEC.
 * 
 * Verificaciones requeridas:
 * 1. Simulación estricta del parser client-side de tabIndec.js contra /api/indec/series (en vivo, mock y fallback).
 * 2. Comprobación de invariantes de contrato frontend: row[0], raw.meta, raw.data, raw.count, raw.params, sin throws en map/sort/parseFloat.
 * 3. Comprobación exhaustiva de caché: X-Cache HIT vs MISS, TTL, e invariancia del orden de query params.
 * 4. Simulación de cascada de fallback JWT: cuando INDEC_API_TOKEN retorna 401, 403, timeout o error de red,
 *    el servidor degrada transparentemente a la API abierta o snapshot sin interrupción ni excepciones.
 */

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { TestServer } = require('./helpers/setup');
const httpClient = require('../services/httpClient');
const { cacheService } = require('../services/cacheService');
const { defaultKeyGenerator } = require('../middleware/cacheMiddleware');

/**
 * Réplica exacta de la lógica de procesamiento de tabIndec.js (líneas 100-128 y 152-258).
 * Valida que la respuesta de /api/indec/series sea consumida sin excepciones por el cliente web.
 * @param {object} raw Respuesta JSON de /api/indec/series
 */
function simulateTabIndecParsing(raw) {
  assert.ok(raw !== null && typeof raw === 'object', 'raw no debe ser nulo');
  assert.ok(Array.isArray(raw.data), 'raw.data debe ser un Array matricial');
  assert.ok(Array.isArray(raw.meta), 'raw.meta debe ser un Array de descriptores');
  assert.equal(typeof raw.count, 'number', 'raw.count debe ser numérico');
  assert.ok(raw.params && typeof raw.params === 'object', 'raw.params debe ser un objeto');

  // tabIndec.js línea 100
  const fields = raw.meta.slice(1).map((m, idx) => {
    assert.ok(m, `meta[${idx + 1}] no debe ser nulo`);
    assert.ok(m.field, `meta[${idx + 1}] debe contener propiedad field`);
    assert.ok(typeof m.field.id === 'string' && m.field.id.length > 0, `meta[${idx + 1}].field.id debe ser un string válido`);
    return m.field.id;
  });

  // tabIndec.js líneas 101-111
  const parsedData = raw.data.map((row, rowIdx) => {
    assert.ok(Array.isArray(row), `Fila ${rowIdx} debe ser un Array`);
    const entry = { date: row[0] };
    assert.ok(row[0] === undefined || typeof row[0] === 'string' || row[0] === null, `row[0] fecha debe ser string o null`);

    fields.forEach((fid, index) => {
      let val = parseFloat(row[index + 1]);
      if (fid === '145.3_INGNACUAL_DICI_M_38' && val !== null && !isNaN(val)) {
        val = val * 100;
      }
      entry[fid] = val;
    });
    return entry;
  }).filter(e => e.date).sort((a, b) => a.date.localeCompare(b.date));

  // tabIndec.js líneas 114-127: Inflación núcleo mensual
  parsedData.forEach((entry, idx, arr) => {
    if (idx === 0) {
      entry['148.3_INUCLEONAL_DICI_M_19_variacion'] = null;
    } else {
      const prev = arr[idx - 1];
      const valPrev = prev['148.3_INUCLEONAL_DICI_M_19'];
      const valAct = entry['148.3_INUCLEONAL_DICI_M_19'];
      if (valPrev > 0 && valAct > 0) {
        entry['148.3_INUCLEONAL_DICI_M_19_variacion'] = ((valAct - valPrev) / valPrev) * 100;
      } else {
        entry['148.3_INUCLEONAL_DICI_M_19_variacion'] = null;
      }
    }
  });

  // tabIndec.js líneas 152-258: KPIs y transformaciones de gráficos
  const len = parsedData.length;
  let latestIpc = null;
  let latestRipte = null;
  let latestEmae = null;
  let emaeIndexInGeneral = -1;
  let ipcAnualVal = 0;
  const ipcAcumulado = [];
  const ripteAcumulado = [];

  if (len > 0) {
    for (let i = len - 1; i >= 0; i--) {
      if (parsedData[i]['145.3_INGNACUAL_DICI_M_38'] !== null && !isNaN(parsedData[i]['145.3_INGNACUAL_DICI_M_38'])) {
        latestIpc = parsedData[i];
        break;
      }
    }

    for (let i = len - 1; i >= 0; i--) {
      if (parsedData[i]['158.1_REPTE_0_0_5'] !== null && !isNaN(parsedData[i]['158.1_REPTE_0_0_5'])) {
        latestRipte = parsedData[i];
        break;
      }
    }

    for (let i = len - 1; i >= 0; i--) {
      if (parsedData[i]['143.3_NO_PR_2004_A_21'] !== null && !isNaN(parsedData[i]['143.3_NO_PR_2004_A_21'])) {
        latestEmae = parsedData[i];
        emaeIndexInGeneral = i;
        break;
      }
    }

    let validIpcMonths = [];
    for (let i = len - 1; i >= 0; i--) {
      const val = parsedData[i]['145.3_INGNACUAL_DICI_M_38'];
      if (val !== null && !isNaN(val)) {
        validIpcMonths.unshift(val);
        if (validIpcMonths.length === 12) break;
      }
    }
    if (validIpcMonths.length === 12) {
      let acum = 1;
      validIpcMonths.forEach(tasa => {
        acum *= (1 + tasa / 100);
      });
      ipcAnualVal = (acum - 1) * 100;
    }

    let baseIpc = 100;
    parsedData.forEach((d, idx) => {
      if (idx === 0) {
        ipcAcumulado.push(100);
        ripteAcumulado.push(100);
      } else {
        const tasaIpc = d['145.3_INGNACUAL_DICI_M_38'] || 0;
        baseIpc *= (1 + tasaIpc / 100);
        ipcAcumulado.push(baseIpc);

        const ripteActual = d['158.1_REPTE_0_0_5'];
        const ripteBaseVal = parsedData[0]['158.1_REPTE_0_0_5'];
        const ripteIdx = ripteBaseVal > 0 ? (ripteActual / ripteBaseVal) * 100 : 100;
        ripteAcumulado.push(ripteIdx);
      }
    });
  }

  return {
    fields,
    parsedData,
    latestIpc,
    latestRipte,
    latestEmae,
    emaeIndexInGeneral,
    ipcAnualVal,
    ipcAcumulado,
    ripteAcumulado
  };
}

describe('Challenger Indec 2: Empirical Adversarial Contract, Cache & Resilience Verification', () => {
  let testServer;
  const FRONTEND_IDS = '145.3_INGNACUAL_DICI_M_38,148.3_INUCLEONAL_DICI_M_19,158.1_REPTE_0_0_5,143.3_NO_PR_2004_A_31,143.3_NO_PR_2004_A_21';

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
  // 1. VALIDACIÓN EMPÍRICA DE CONTRATOS CLIENTE-SERVIDOR (tabIndec.js)
  // =========================================================================
  describe('1. Contratos Client-Server e Invariantes tabIndec.js', () => {
    it('1.1. Simulación exitosa de tabIndec.js sobre respuesta en vivo / fallback del servidor', async () => {
      const res = await testServer.get(`/api/indec/series?ids=${encodeURIComponent(FRONTEND_IDS)}&limit=1000`);
      assert.equal(res.status, 200);

      const parsed = simulateTabIndecParsing(res.data);
      assert.equal(parsed.fields.length, 5, 'Debe procesar las 5 series requeridas por el frontend');
      assert.ok(parsed.parsedData.length > 0, 'Debe generar parsedData con al menos 1 observación');

      // Validar invariantes de KPIs
      assert.ok(parsed.latestIpc !== null, 'latestIpc no debe ser nulo');
      assert.ok(parsed.latestRipte !== null, 'latestRipte no debe ser nulo');
      assert.ok(parsed.latestEmae !== null, 'latestEmae no debe ser nulo');
      assert.ok(parsed.latestRipte['158.1_REPTE_0_0_5'] > 10000, 'Salario RIPTE debe ser representativo (> 10000)');

      // Validar arrays de gráficos Base 100
      assert.equal(parsed.ipcAcumulado.length, parsed.parsedData.length);
      assert.equal(parsed.ripteAcumulado.length, parsed.parsedData.length);
      assert.equal(parsed.ipcAcumulado[0], 100);
      assert.equal(parsed.ripteAcumulado[0], 100);
    });

    it('1.2. Simulación de tabIndec.js contra contingencia forzada getFallbackIndecData', async () => {
      const originalGet = httpClient.get;
      httpClient.get = async function () {
        const err = new Error('Corte total upstream inducido para test');
        err.code = 'ENOTFOUND';
        throw err;
      };

      try {
        const res = await testServer.get(`/api/indec/series?ids=${encodeURIComponent(FRONTEND_IDS)}&limit=39`);
        assert.equal(res.status, 200);
        assert.strictEqual(res.data.isFallback, true);

        const parsed = simulateTabIndecParsing(res.data);
        assert.equal(parsed.parsedData.length, 39, 'El snapshot persistente posee 39 observaciones');
        assert.ok(parsed.ipcAnualVal > 0, 'Acumulado 12 meses debe ser un valor positivo coherente');
      } finally {
        httpClient.get = originalGet;
      }
    });

    it('1.3. Simulación de tabIndec.js ante respuesta PostgREST/Relacional normalizada', async () => {
      const originalGet = httpClient.get;
      process.env.INDEC_API_TOKEN = 'token-test-jwt-adversarial';

      httpClient.get = async function (url) {
        if (typeof url === 'string' && url.includes('indec.gob.ar')) {
          return {
            status: 200,
            data: [
              { fecha: '2024-01-01', valor: 0.206 },
              { fecha: '2024-02-01', valor: 0.132 }
            ]
          };
        }
        return originalGet.apply(this, arguments);
      };

      try {
        const res = await testServer.get('/api/indec/series?ids=145.3_INGNACUAL_DICI_M_38');
        assert.equal(res.status, 200);

        const parsed = simulateTabIndecParsing(res.data);
        assert.equal(parsed.fields.length, 1);
        assert.equal(parsed.fields[0], '145.3_INGNACUAL_DICI_M_38');
        assert.equal(parsed.parsedData.length, 2);
        // Multiplicación automática por 100 para IPC con tolerancia IEEE-754
        assert.ok(Math.abs(parsed.parsedData[0]['145.3_INGNACUAL_DICI_M_38'] - 20.6) < 1e-6);
        assert.ok(Math.abs(parsed.parsedData[1]['145.3_INGNACUAL_DICI_M_38'] - 13.2) < 1e-6);
      } finally {
        delete process.env.INDEC_API_TOKEN;
        httpClient.get = originalGet;
      }
    });

    it('1.4. Resistencia a datos parciales o vacíos sin arrojar TypeError en sort o map', async () => {
      const emptyRaw = {
        data: [],
        meta: [
          { field: { id: 'indice_tiempo', description: 'Índice de tiempo' } },
          { field: { id: '145.3_INGNACUAL_DICI_M_38', description: 'IPC' } }
        ],
        count: 0,
        params: {}
      };

      assert.doesNotThrow(() => {
        const parsed = simulateTabIndecParsing(emptyRaw);
        assert.equal(parsed.parsedData.length, 0);
      }, 'tabIndec no debe arrojar excepción ante dataset vacío');
    });
  });

  // =========================================================================
  // 2. COMPORTAMIENTO AVANZADO DE CACHÉ (HIT, MISS, TTL Y ORDEN DE PARÁMETROS)
  // =========================================================================
  describe('2. Verificación de Comportamiento de Caché', () => {
    it('2.1. Invariancia del orden de parámetros: idéntica clave y X-Cache: HIT independiente del orden', async () => {
      const q1 = `/api/indec/series?ids=145.3_INGNACUAL_DICI_M_38&limit=10&start_date=2024-01-01`;
      const q2 = `/api/indec/series?limit=10&start_date=2024-01-01&ids=145.3_INGNACUAL_DICI_M_38`;
      const q3 = `/api/indec/series?start_date=2024-01-01&ids=145.3_INGNACUAL_DICI_M_38&limit=10`;

      // 1. Primera consulta: Cache MISS
      const res1 = await testServer.get(q1);
      assert.equal(res1.status, 200);
      assert.equal(res1.headers.get('x-cache'), 'MISS');
      const key1 = res1.headers.get('x-cache-key');
      assert.ok(key1, 'Debe incluir header X-Cache-Key');

      // 2. Segunda consulta (mismos parámetros, distinto orden): Cache HIT
      const res2 = await testServer.get(q2);
      assert.equal(res2.status, 200);
      assert.equal(res2.headers.get('x-cache'), 'HIT');
      const key2 = res2.headers.get('x-cache-key');
      assert.equal(key2, key1, 'La clave generada debe ser idéntica independiente del orden de los params');
      assert.strictEqual(res2.data.cached, true);

      // 3. Tercera consulta (otra permutación): Cache HIT
      const res3 = await testServer.get(q3);
      assert.equal(res3.status, 200);
      assert.equal(res3.headers.get('x-cache'), 'HIT');
      assert.equal(res3.headers.get('x-cache-key'), key1);
    });

    it('2.2. Expiración de TTL y recarga posterior a la expiración', async () => {
      const query = `/api/indec/series?ids=145.3_INGNACUAL_DICI_M_38&limit=5`;

      // Generar entrada en caché
      const res1 = await testServer.get(query);
      assert.equal(res1.headers.get('x-cache'), 'MISS');
      const cacheKey = res1.headers.get('x-cache-key');

      // Verificar que la entrada existe y tiene TTL de HISTORICAL_SERIES (3600s)
      const entryBefore = cacheService.getEntry(cacheKey);
      assert.ok(entryBefore !== null, 'Entrada debe existir en memoria');
      assert.ok(entryBefore.ttlRemaining > 3500 && entryBefore.ttlRemaining <= 3600);

      // Simular expiración de TTL alterando expiresAt
      const rawEntry = cacheService.store.get(cacheKey);
      rawEntry.expiresAt = Date.now() - 1000; // Expirada hace 1s

      // Siguiente petición debe detectar expiración y generar MISS
      const resExpired = await testServer.get(query);
      assert.equal(resExpired.status, 200);
      assert.equal(resExpired.headers.get('x-cache'), 'MISS', 'Tras expiración debe arrojar MISS');
    });

    it('2.3. Verificación de clave unívoca con defaultKeyGenerator', () => {
      const reqA = { method: 'GET', baseUrl: '', path: '/api/indec/series', query: { b: '2', a: '1', c: '3' } };
      const reqB = { method: 'GET', baseUrl: '', path: '/api/indec/series', query: { c: '3', a: '1', b: '2' } };

      const keyA = defaultKeyGenerator(reqA);
      const keyB = defaultKeyGenerator(reqB);

      assert.equal(keyA, keyB);
      assert.equal(keyA, 'GET:/api/indec/series?a=1&b=2&c=3');
    });
  });

  // =========================================================================
  // 3. SIMULACIÓN DE RESILIENCIA EN CASCADA CON TOKEN JWT Y ERRORES UPSTREAM
  // =========================================================================
  describe('3. Cascada de Fallback Resiliente ante Fallos de Token y Upstream', () => {
    it('3.1. Token JWT con 401 Unauthorized degrada fluidamente a API abierta', async () => {
      process.env.INDEC_API_TOKEN = 'token-falso-o-revocado';
      const originalGet = httpClient.get;
      let openApiReached = false;

      httpClient.get = async function (url, config, options) {
        if (typeof url === 'string' && url.includes('api.indec.gob.ar')) {
          const err = new Error('HTTP 401 Unauthorized');
          err.response = { status: 401 };
          throw err;
        }
        if (typeof url === 'string' && url.includes('apis.datos.gob.ar')) {
          openApiReached = true;
          return {
            status: 200,
            data: {
              data: [['2024-01-01', 0.206]],
              meta: [{ field: { id: 'indice_tiempo' } }, { field: { id: '145.3_INGNACUAL_DICI_M_38' } }],
              count: 1
            }
          };
        }
        return originalGet.apply(this, arguments);
      };

      try {
        const res = await testServer.get('/api/indec/series?ids=145.3_INGNACUAL_DICI_M_38');
        assert.equal(res.status, 200);
        assert.strictEqual(openApiReached, true, 'Debe haber conmutado a la API abierta');
        assert.equal(res.data.data.length, 1);
      } finally {
        delete process.env.INDEC_API_TOKEN;
        httpClient.get = originalGet;
      }
    });

    it('3.2. Token JWT con 403 Forbidden degrada fluidamente a API abierta', async () => {
      process.env.INDEC_API_TOKEN = 'token-sin-permisos';
      const originalGet = httpClient.get;
      let openApiReached = false;

      httpClient.get = async function (url, config, options) {
        if (typeof url === 'string' && url.includes('api.indec.gob.ar')) {
          const err = new Error('HTTP 403 Forbidden');
          err.response = { status: 403 };
          throw err;
        }
        if (typeof url === 'string' && url.includes('apis.datos.gob.ar')) {
          openApiReached = true;
          return {
            status: 200,
            data: {
              data: [['2024-01-01', 0.206]],
              meta: [{ field: { id: 'indice_tiempo' } }, { field: { id: '145.3_INGNACUAL_DICI_M_38' } }],
              count: 1
            }
          };
        }
        return originalGet.apply(this, arguments);
      };

      try {
        const res = await testServer.get('/api/indec/series?ids=145.3_INGNACUAL_DICI_M_38');
        assert.equal(res.status, 200);
        assert.strictEqual(openApiReached, true);
      } finally {
        delete process.env.INDEC_API_TOKEN;
        httpClient.get = originalGet;
      }
    });

    it('3.3. Falla total en cascada: Directa falla (401) Y Abierta falla (ECONNREFUSED) -> entrega Snapshot contingente', async () => {
      process.env.INDEC_API_TOKEN = 'token-falla-ambos';
      const originalGet = httpClient.get;

      httpClient.get = async function (url, config, options) {
        if (typeof url === 'string' && url.includes('api.indec.gob.ar')) {
          const err = new Error('Directa 401');
          err.response = { status: 401 };
          throw err;
        }
        if (typeof url === 'string' && url.includes('apis.datos.gob.ar')) {
          const err = new Error('Corte total de red');
          err.code = 'ECONNREFUSED';
          throw err;
        }
        return originalGet.apply(this, arguments);
      };

      try {
        const res = await testServer.get(`/api/indec/series?ids=${encodeURIComponent(FRONTEND_IDS)}&limit=10`);
        assert.equal(res.status, 200, 'Debe entregar HTTP 200 con fallback');
        assert.strictEqual(res.data.isFallback, true, 'isFallback debe ser true');
        assert.strictEqual(res.data.cached, true, 'cached debe ser true');
        assert.equal(res.data.data.length, 10, 'Debe acotar a limit=10');

        // Validar compatibilidad total con tabIndec.js
        const parsed = simulateTabIndecParsing(res.data);
        assert.equal(parsed.fields.length, 5);
        assert.equal(parsed.parsedData.length, 10);
      } finally {
        delete process.env.INDEC_API_TOKEN;
        httpClient.get = originalGet;
      }
    });

    it('3.4. Timeout en Directa (> 5000ms) Y Timeout en Abierta -> entrega Snapshot sin bloqueo de proceso', async () => {
      process.env.INDEC_API_TOKEN = 'token-timeout';
      const originalGet = httpClient.get;

      httpClient.get = async function (url, config, options) {
        const err = new Error('timeout of 5000ms exceeded');
        err.code = 'ECONNABORTED';
        throw err;
      };

      try {
        const res = await testServer.get(`/api/indec/series?ids=${encodeURIComponent(FRONTEND_IDS)}&limit=5`);
        assert.equal(res.status, 200);
        assert.strictEqual(res.data.isFallback, true);
        assert.equal(res.data.data.length, 5);
      } finally {
        delete process.env.INDEC_API_TOKEN;
        httpClient.get = originalGet;
      }
    });
  });
});
