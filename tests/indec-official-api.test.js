/**
 * tests/indec-official-api.test.js
 * Suite integral y dedicada de pruebas automatizadas para la integración oficial de APIs de INDEC.
 * Valida:
 * 1. Contrato matricial de 5 series requerido por tabIndec.js
 * 2. Estructura y nombres de metadatos (frecuencia / indice_tiempo + series)
 * 3. Invariantes numéricos y cálculos matemáticos (val * 100, núcleo, RIPTE > 0, EMAE)
 * 4. Filtrado por fechas (start_date y end_date)
 * 5. Paginación y control de cantidad (limit)
 * 6. Resiliencia a congelamiento y timeouts (> 5000ms)
 * 7. Resiliencia a errores HTTP de upstream (500, 502, 503, 404)
 * 8. Resiliencia a corte inmediato de red (ECONNREFUSED < 500ms)
 * 9. Cabeceras y políticas de caché (X-Cache MISS, HIT, BYPASS)
 * 10. Hidratación automática de RIPTE (158.1_REPTE_0_0_5) desde el snapshot persistente
 * 11. Soporte de autenticación oficial con token (INDEC_API_TOKEN) y degradación ante 401
 */

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { TestServer } = require('./helpers/setup');
const httpClient = require('../services/httpClient');
const { cacheService } = require('../services/cacheService');

describe('INDEC Official API & Time Series Integration Suite', () => {
  let testServer;
  const INDEC_FRONTEND_IDS = '145.3_INGNACUAL_DICI_M_38,148.3_INUCLEONAL_DICI_M_19,158.1_REPTE_0_0_5,143.3_NO_PR_2004_A_31,143.3_NO_PR_2004_A_21';

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
  // 1. CONTRATO MATRICIAL DE LAS 5 SERIES Y METADATOS
  // =========================================================================
  describe('1. Contrato de 5 Series Oficiales y Metadatos para tabIndec.js', () => {
    it('1.1. Debe entregar matriz con 6 columnas (fecha + 5 series) y HTTP 200', async () => {
      const res = await testServer.get(`/api/indec/series?ids=${encodeURIComponent(INDEC_FRONTEND_IDS)}&limit=1000`);

      assert.equal(res.status, 200, 'Debe responder HTTP 200');
      assert.ok(res.data, 'El cuerpo no debe ser nulo');
      assert.ok(Array.isArray(res.data.data), 'data debe ser un arreglo matricial');
      assert.ok(Array.isArray(res.data.meta), 'meta debe ser un arreglo descriptivo');

      // Validar dimensiones de columnas en cada fila
      assert.ok(res.data.data.length > 0, 'data debe contener al menos 1 observación');
      for (const row of res.data.data) {
        assert.equal(row.length, 6, 'Cada tupla debe poseer fecha + 5 columnas');
        assert.match(row[0], /^\d{4}-\d{2}(-\d{2})?$/, 'La posición 0 debe ser una fecha ISO válida');
      }
    });

    it('1.2. Metadatos deben contener información de las series solicitadas', async () => {
      const res = await testServer.get(`/api/indec/series?ids=${encodeURIComponent(INDEC_FRONTEND_IDS)}&limit=10`);

      assert.equal(res.status, 200);
      assert.equal(res.data.meta.length, 6, 'meta debe contener exactamente 6 descriptores');

      // En la respuesta oficial, meta[0] describe índice temporal o frecuencia del dataset
      const firstMeta = res.data.meta[0];
      assert.ok(firstMeta.frequency || firstMeta.field?.id === 'indice_tiempo', 'meta[0] describe índice temporal o frecuencia');

      const expectedSeries = INDEC_FRONTEND_IDS.split(',');
      const seriesMeta = res.data.meta.slice(1);
      for (let i = 0; i < expectedSeries.length; i++) {
        assert.equal(seriesMeta[i].field?.id, expectedSeries[i], `meta[${i + 1}] debe mapear a ${expectedSeries[i]}`);
        assert.ok(seriesMeta[i].field?.description || seriesMeta[i].dataset?.title, 'Cada serie debe incluir descripción o dataset');
      }
    });
  });

  // =========================================================================
  // 2. INVARIANTES NUMÉRICOS Y CÁLCULOS MATEMÁTICOS DE CLIENTE
  // =========================================================================
  describe('2. Invariantes Numéricos y Compatibilidad Aritmética', () => {
    it('2.1. Las series deben proveer valores numéricos no-NaN aptos para cálculos de frontend', async () => {
      const res = await testServer.get(`/api/indec/series?ids=${encodeURIComponent(INDEC_FRONTEND_IDS)}&start_date=2024-01-01&limit=24`);
      assert.equal(res.status, 200);

      const rows = res.data.data;
      assert.ok(rows.length >= 12, 'Debe proveer al menos 12 períodos para acumulación interanual');

      // 1. IPC Mensual: decimal fraccionario (ej. 0.06 = 6.0%)
      const ipcValues = rows.map(r => r[1]).filter(v => v !== null && v !== undefined);
      assert.ok(ipcValues.length > 0, 'Debe contener valores válidos de IPC mensual');
      for (const val of ipcValues) {
        assert.equal(typeof val, 'number', 'Valor IPC mensual debe ser número');
        assert.ok(!isNaN(val), 'Valor IPC no debe ser NaN');
        const pct = val * 100;
        assert.ok(pct >= -20 && pct <= 100, `Variación porcentual coherente: ${pct}%`);
      }

      // 2. Inflación Núcleo: nivel índice positivo para cálculo de tasa ((act - prev) / prev) * 100
      const nucleoValues = rows.map(r => r[2]).filter(v => v !== null && v !== undefined);
      assert.ok(nucleoValues.length > 0, 'Debe contener valores de núcleo');
      for (const val of nucleoValues) {
        assert.equal(typeof val, 'number');
        assert.ok(val > 0, 'Nivel índice de núcleo debe ser positivo');
      }

      // 3. Salarios RIPTE: salario nominal en moneda corriente > $10.000
      const ripteValues = rows.map(r => r[3]).filter(v => v !== null && v !== undefined);
      assert.ok(ripteValues.length > 0, 'Debe contener valores de RIPTE');
      for (const val of ripteValues) {
        assert.equal(typeof val, 'number');
        assert.ok(val > 10000, 'Salario RIPTE debe ser representativo (> $10.000)');
      }

      // 4. EMAE Actividad Original: índice mayor a cero
      const emaeValues = rows.map(r => r[5]).filter(v => v !== null && v !== undefined);
      assert.ok(emaeValues.length > 0, 'Debe contener valores de EMAE');
      for (const val of emaeValues) {
        assert.equal(typeof val, 'number');
        assert.ok(val > 0, 'EMAE debe ser positivo');
      }
    });
  });

  // =========================================================================
  // 3. FILTRADO TEMPORAL Y CONTROL DE LÍMITES
  // =========================================================================
  describe('3. Filtros Cronológicos (start_date / end_date) y Paginación (limit)', () => {
    it('3.1. Debe filtrar observaciones dentro del rango temporal start_date y end_date', async () => {
      const startDate = '2024-01-01';
      const endDate = '2024-12-31';
      const res = await testServer.get(`/api/indec/series?ids=145.3_INGNACUAL_DICI_M_38&start_date=${startDate}&end_date=${endDate}`);

      assert.equal(res.status, 200);
      assert.ok(res.data.data.length > 0, 'Debe retornar filas en 2024');
      for (const row of res.data.data) {
        assert.ok(row[0] >= startDate, `Fecha ${row[0]} debe ser >= ${startDate}`);
        assert.ok(row[0] <= endDate, `Fecha ${row[0]} debe ser <= ${endDate}`);
      }
    });

    it('3.2. Parámetro limit debe acotar la cantidad de observaciones devueltas', async () => {
      const res = await testServer.get(`/api/indec/series?ids=145.3_INGNACNAL_DICI_M_15&limit=5`);

      assert.equal(res.status, 200);
      assert.equal(res.data.data.length, 5, 'Debe limitar a exactamente 5 registros devueltos');
      assert.ok(res.data.count >= 5, 'count debe reflejar las observaciones disponibles (>= 5)');
    });
  });

  // =========================================================================
  // 4. RESILIENCIA, CORTES Y TIMEOUTS DE RED
  // =========================================================================
  describe('4. Resiliencia ante Errores de Red y Timeout', () => {
    it('4.1. Conmuta a contingencia ante corte abrupto de red (ECONNREFUSED < 500ms)', async () => {
      const originalGet = httpClient.get;
      httpClient.get = async function (url, config, options) {
        if (typeof url === 'string' && (url.includes('apis.datos.gob.ar') || url.includes('indec.gob.ar'))) {
          const err = new Error('Conexión rechazada por firewall o caída total');
          err.code = 'ECONNREFUSED';
          throw err;
        }
        return originalGet.call(this, url, config, options);
      };

      const start = performance.now();
      try {
        const res = await testServer.get(`/api/indec/series?ids=${encodeURIComponent(INDEC_FRONTEND_IDS)}&limit=10`);
        const duration = performance.now() - start;

        assert.equal(res.status, 200, 'Debe responder HTTP 200 con fallback');
        assert.strictEqual(res.data.isFallback, true, 'isFallback debe ser true');
        assert.strictEqual(res.data.cached, true, 'cached debe ser true');
        assert.ok(duration < 500, `Latencia inmediata debe ser menor a 500ms (obtenido ${duration.toFixed(1)}ms)`);
        assert.equal(res.data.data.length, 10, 'Debe respetar limit=10');
      } finally {
        httpClient.get = originalGet;
      }
    });

    it('4.2. Tolerancia a errores HTTP del upstream (500, 502, 503, 404)', async () => {
      const errorStatuses = [500, 502, 503, 404];

      for (const errStatus of errorStatuses) {
        cacheService.clear();
        const originalGet = httpClient.get;
        httpClient.get = async function (url, config, options) {
          if (typeof url === 'string' && (url.includes('apis.datos.gob.ar') || url.includes('indec.gob.ar'))) {
            const err = new Error(`Upstream HTTP ${errStatus} Error`);
            err.response = { status: errStatus };
            throw err;
          }
          return originalGet.call(this, url, config, options);
        };

        try {
          const res = await testServer.get(`/api/indec/series?ids=145.3_INGNACUAL_DICI_M_38&limit=4`);
          assert.equal(res.status, 200, `Debe entregar fallback ante error ${errStatus}`);
          assert.strictEqual(res.data.isFallback, true);
          assert.equal(res.data.data.length, 4);
        } finally {
          httpClient.get = originalGet;
        }
      }
    });

    it('4.3. Tolerancia a timeout del socket externo (> 5000ms)', async () => {
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
        const res = await testServer.get(`/api/indec/series?ids=145.3_INGNACNAL_DICI_M_15&limit=6`);
        assert.equal(res.status, 200);
        assert.strictEqual(res.data.isFallback, true);
        assert.equal(res.data.data.length, 6);
      } finally {
        httpClient.get = originalGet;
      }
    });
  });

  // =========================================================================
  // 5. CACHÉ HTTP (X-Cache MISS, HIT, BYPASS)
  // =========================================================================
  describe('5. Gestión de Caché HTTP y Cabeceras X-Cache', () => {
    it('5.1. Primera llamada genera X-Cache: MISS y segunda X-Cache: HIT', async () => {
      const query = `/api/indec/series?ids=145.3_INGNACNAL_DICI_M_15&limit=3`;

      const res1 = await testServer.get(query);
      assert.equal(res1.status, 200);
      assert.equal(res1.headers.get('x-cache'), 'MISS');

      const res2 = await testServer.get(query);
      assert.equal(res2.status, 200);
      assert.equal(res2.headers.get('x-cache'), 'HIT');
      assert.strictEqual(res2.data.cached, true);
    });

    it('5.2. Parámetro ?nocache=true fuerza bypass de caché', async () => {
      const query = `/api/indec/series?ids=145.3_INGNACNAL_DICI_M_15&limit=3`;
      await testServer.get(query); // Llenar caché

      const resBypass = await testServer.get(`${query}&nocache=true`);
      assert.equal(resBypass.status, 200);
      assert.equal(resBypass.headers.get('x-cache'), 'BYPASS');
    });
  });

  // =========================================================================
  // 6. HIDRATACIÓN AUTOMÁTICA DE RIPTE
  // =========================================================================
  describe('6. Hidratación de RIPTE (158.1_REPTE_0_0_5)', () => {
    it('6.1. Hidrata valores nulos devueltos por upstream con datos del snapshot oficial', async () => {
      const originalGet = httpClient.get;

      // Simular que el upstream responde con datos válidos pero columna RIPTE en null
      httpClient.get = async function (url, config, options) {
        if (typeof url === 'string' && url.includes('apis.datos.gob.ar')) {
          return {
            status: 200,
            data: {
              data: [
                ['2023-01-01', 0.060, null],
                ['2023-02-01', 0.066, null]
              ],
              meta: [
                { field: { id: 'indice_tiempo', description: 'Tiempo' } },
                { field: { id: '145.3_INGNACUAL_DICI_M_38', description: 'IPC' } },
                { field: { id: '158.1_REPTE_0_0_5', description: 'RIPTE' } }
              ],
              count: 2,
              params: { ids: '145.3_INGNACUAL_DICI_M_38,158.1_REPTE_0_0_5' }
            }
          };
        }
        return originalGet.call(this, url, config, options);
      };

      try {
        const res = await testServer.get('/api/indec/series?ids=145.3_INGNACUAL_DICI_M_38,158.1_REPTE_0_0_5');
        assert.equal(res.status, 200);
        assert.equal(res.data.data.length, 2);

        // Los valores de la columna RIPTE (índice 2) deben haber sido hidratados
        const ripteRow0 = res.data.data[0][2];
        const ripteRow1 = res.data.data[1][2];

        assert.equal(ripteRow0, 205342, 'Fila 1 de RIPTE debe hidratarse con 205342');
        assert.equal(ripteRow1, 218450, 'Fila 2 de RIPTE debe hidratarse con 218450');
      } finally {
        httpClient.get = originalGet;
      }
    });

    it('6.2. Consulta de serie RIPTE aislada cuando upstream entrega vacío debe usar fallback', async () => {
      const originalGet = httpClient.get;

      // Upstream abierto devuelve data: [] y count: 0 para RIPTE
      httpClient.get = async function (url, config, options) {
        if (typeof url === 'string' && url.includes('apis.datos.gob.ar')) {
          return {
            status: 200,
            data: {
              data: [],
              meta: [{ field: { id: 'indice_tiempo' } }, { field: { id: '158.1_REPTE_0_0_5' } }],
              count: 0
            }
          };
        }
        return originalGet.call(this, url, config, options);
      };

      try {
        const res = await testServer.get('/api/indec/series?ids=158.1_REPTE_0_0_5&limit=5');
        assert.equal(res.status, 200);
        assert.strictEqual(res.data.isFallback, true);
        assert.equal(res.data.data.length, 5);
        for (const row of res.data.data) {
          assert.ok(row[1] > 10000, 'Valores de RIPTE presentes en fallback');
        }
      } finally {
        httpClient.get = originalGet;
      }
    });
  });

  // =========================================================================
  // 7. AUTENTICACIÓN CON TOKEN OFICIAL (INDEC_API_TOKEN) Y MODO ZERO-TOKEN
  // =========================================================================
  describe('7. Soporte para INDEC_API_TOKEN y Degradación Armónica', () => {
    it('7.1. Si INDEC_API_TOKEN está presente, inyecta Authorization: Bearer <token>', async () => {
      const originalGet = httpClient.get;
      const testToken = 'jwt-oficial-indec-token-12345';
      process.env.INDEC_API_TOKEN = testToken;

      let capturedAuthHeader = null;
      let capturedUrl = null;

      httpClient.get = async function (url, config, options) {
        if (typeof url === 'string' && url.includes('indec.gob.ar')) {
          capturedUrl = url;
          capturedAuthHeader = config?.headers?.Authorization;
          return {
            status: 200,
            data: [
              { periodo: '2024-01-01', valor: 20.6 },
              { periodo: '2024-02-01', valor: 13.2 }
            ]
          };
        }
        return originalGet.call(this, url, config, options);
      };

      try {
        const res = await testServer.get('/api/indec/series?ids=145.3_INGNACUAL_DICI_M_38');
        assert.equal(res.status, 200);
        assert.equal(capturedAuthHeader, `Bearer ${testToken}`, 'Debe inyectar header Bearer con el token');
        assert.ok(capturedUrl.includes('indec.gob.ar'));

        // Valida que la respuesta relacional de api.indec.gob.ar fue normalizada a matricial
        assert.ok(Array.isArray(res.data.data));
        assert.equal(res.data.data.length, 2);
        assert.equal(res.data.data[0][0], '2024-01-01');
        assert.equal(res.data.data[0][1], 20.6);
      } finally {
        delete process.env.INDEC_API_TOKEN;
        httpClient.get = originalGet;
      }
    });

    it('7.2. Degeneración armónica ante token inválido o revocado (401/403) conmutando a API abierta', async () => {
      const originalGet = httpClient.get;
      process.env.INDEC_API_TOKEN = 'token-expirado-invalido';

      let openApiCalled = false;

      httpClient.get = async function (url, config, options) {
        if (typeof url === 'string' && url.includes('api.indec.gob.ar')) {
          const err = new Error('Request failed with status code 401');
          err.response = { status: 401 };
          throw err;
        }
        if (typeof url === 'string' && url.includes('apis.datos.gob.ar')) {
          openApiCalled = true;
          return {
            status: 200,
            data: {
              data: [['2024-01-01', 0.206]],
              meta: [{ field: { id: 'indice_tiempo' } }, { field: { id: '145.3_INGNACUAL_DICI_M_38' } }],
              count: 1
            }
          };
        }
        return originalGet.call(this, url, config, options);
      };

      try {
        const res = await testServer.get('/api/indec/series?ids=145.3_INGNACUAL_DICI_M_38');
        assert.equal(res.status, 200);
        assert.strictEqual(openApiCalled, true, 'Debe haber conmutado a la API abierta tras el 401 de la directa');
        assert.equal(res.data.data[0][0], '2024-01-01');
      } finally {
        delete process.env.INDEC_API_TOKEN;
        httpClient.get = originalGet;
      }
    });

    it('7.3. Modo Zero-Token: opera fluidamente sin variables de entorno configuradas', async () => {
      delete process.env.INDEC_API_TOKEN;
      const res = await testServer.get(`/api/indec/series?ids=145.3_INGNACNAL_DICI_M_15&limit=4`);
      assert.equal(res.status, 200);
      assert.ok(Array.isArray(res.data.data));
      assert.equal(res.data.data.length, 4);
    });
  });
});
