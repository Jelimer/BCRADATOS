const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { defaultTestServer } = require('./helpers/setup');
const { SERIES_INDEC, TICKERS_BYMA } = require('./helpers/fixtures');

describe('Tier 1: External Proxies & Market Endpoints Tests', () => {
  before(async () => {
    await defaultTestServer.start();
  });

  after(async () => {
    await defaultTestServer.stop();
  });

  // Feature 10: INDEC Series de Tiempo
  describe('Feature 10: INDEC Series de Tiempo (/api/indec/series)', () => {
    it('10.1. Debe obtener serie del IPC Nacional (145.3_INGNACNAL_DICI_M_15)', async () => {
      const res = await defaultTestServer.get(`/api/indec/series?ids=${SERIES_INDEC.IPC_NACIONAL_NIVEL_GENERAL}&limit=12`);
      assert.equal(res.status, 200, 'INDEC debe responder HTTP 200');
      assert.ok(res.data, 'Debe devolver datos');

      if (res.data.data) {
        assert.ok(Array.isArray(res.data.data), 'data debe ser un arreglo de observaciones');
        if (res.data.data.length > 0) {
          const row = res.data.data[0];
          assert.ok(Array.isArray(row), 'Cada observación debe ser una tupla [fecha, valor]');
          assert.ok(typeof row[0] === 'string', 'El primer elemento es la fecha');
        }
      }
    });

    it('10.2. Debe incluir metadatos de las series solicitadas', async () => {
      const res = await defaultTestServer.get(`/api/indec/series?ids=${SERIES_INDEC.EMAE}&limit=5`);
      assert.equal(res.status, 200, 'Debe responder HTTP 200 para serie EMAE');
      if (res.data?.meta) {
        assert.ok(Array.isArray(res.data.meta), 'meta debe ser un arreglo');
      }
    });
  });

  // Feature 11, 12: BYMA Bonos, Ficha Técnica e Históricos
  describe('Features 11 & 12: BYMA Panel de Bonos y Fichas Técnicas', () => {
    it('11.1. Debe consultar el panel de bonos públicos (/api/byma/panel/public-bonds)', async () => {
      const res = await defaultTestServer.get('/api/byma/panel/public-bonds');
      assert.equal(res.status, 200, 'BYMA public-bonds debe responder HTTP 200');
      assert.ok(res.data, 'Debe devolver payload');
      assert.ok('data' in res.data || Array.isArray(res.data), 'Debe contener data');
    });

    it('12.1. Debe consultar ficha técnica de especie AL30 (/api/byma/bond-info/:symbol)', async () => {
      const res = await defaultTestServer.get(`/api/byma/bond-info/${TICKERS_BYMA.AL30}`);
      assert.equal(res.status, 200, 'BYMA bond-info debe responder HTTP 200');
      assert.ok(res.data, 'Debe devolver ficha');
      if (res.data.data && res.data.data.length > 0) {
        const info = res.data.data[0];
        assert.ok('ley' in info || 'denominacion' in info || 'emisor' in info || 'codigoIsin' in info, 'Debe incluir campos técnicos');
      }
    });

    it('12.2. Debe consultar serie histórica OHLCV (/api/byma/historico/:symbol)', async () => {
      const res = await defaultTestServer.get(`/api/byma/historico/${encodeURIComponent(TICKERS_BYMA.AL30_24HS)}?resolution=D`);
      assert.ok([200, 502, 503].includes(res.status), `BYMA histórico debe responder HTTP 200 o contingencia controlada (502/503), recibido: ${res.status}`);
      assert.ok(res.data, 'Debe retornar objeto');
      if (res.status === 200) {
        if (res.data.s === 'ok') {
          assert.ok(Array.isArray(res.data.t), 't (timestamps) debe ser un array');
          assert.ok(Array.isArray(res.data.c), 'c (cierres) debe ser un array');
        } else if (res.data.s === 'no_data') {
          assert.equal(res.data.s, 'no_data', 'Debe indicar ausencia de datos válida');
        }
      } else {
        assert.ok(res.data.error === true || typeof res.data.message === 'string', 'Debe retornar objeto de error/contingencia esperado');
      }
    });

    it('12.3. Debe consultar indicadores macro de bonos y mercado (/api/byma/indicadores)', async () => {
      const res = await defaultTestServer.get('/api/byma/indicadores');
      assert.equal(res.status, 200, 'BYMA indicadores debe responder HTTP 200');
      assert.ok(res.data, 'Debe devolver datos de indicadores');
      assert.ok('riesgoPais' in res.data, 'Debe incluir objeto riesgoPais');
      assert.ok('mepAl30' in res.data, 'Debe incluir cotización implícita de MEP AL30');
      assert.ok(typeof res.data.mepAl30 === 'number', 'mepAl30 debe ser numérico');
    });
  });

  // Feature 13: DolarApi en Vivo
  describe('Feature 13: DolarApi Dólares en Vivo (/api/mercado-dolarapi/dolares)', () => {
    it('13.1. Debe listar todas las casas de cotización de dólar', async () => {
      const res = await defaultTestServer.get('/api/mercado-dolarapi/dolares');
      assert.equal(res.status, 200, 'DolarApi debe responder HTTP 200');

      const data = res.data.results || res.data;
      if (Array.isArray(data)) {
        assert.ok(data.length >= 3, 'Debe contener al menos Oficial, Blue y MEP/Bolsa');
        const blue = data.find(d => d.casa === 'blue');
        if (blue) {
          assert.ok(typeof blue.compra === 'number' || typeof blue.venta === 'number', 'Valores de compra/venta numéricos');
        }
      }
    });

    it('13.2. Debe consultar cotización específica del Dólar Blue (/api/mercado-dolarapi/dolares/blue)', async () => {
      const res = await defaultTestServer.get('/api/mercado-dolarapi/dolares/blue');
      assert.equal(res.status, 200, 'DolarApi Blue debe responder HTTP 200');
      const data = res.data.results || res.data;
      if (data && typeof data === 'object' && !Array.isArray(data)) {
        assert.equal(data.casa, 'blue', 'La casa debe ser blue');
      }
    });
  });

  // Feature 14: ArgentinaDatos Series Históricas
  describe('Feature 14: ArgentinaDatos Históricos (/api/argentinadatos/...)', () => {
    it('14.1. Debe retornar serie histórica de Dólar Blue', async () => {
      const res = await defaultTestServer.get('/api/argentinadatos/cotizaciones/dolares/blue');
      assert.equal(res.status, 200, 'ArgentinaDatos debe responder HTTP 200');

      const data = res.data.results || res.data;
      if (Array.isArray(data)) {
        assert.ok(data.length > 10, 'Debe contener registros históricos');
        const item = data[data.length - 1];
        assert.ok('fecha' in item, 'Debe contener fecha');
        assert.ok('compra' in item || 'venta' in item, 'Debe contener precios');
      }
    });

    it('14.2. Debe retornar serie histórica de Inflación IPC', async () => {
      const res = await defaultTestServer.get('/api/argentinadatos/finanzas/indices/inflacion');
      assert.equal(res.status, 200, 'ArgentinaDatos Inflación debe responder HTTP 200');
      const data = res.data.results || res.data;
      if (Array.isArray(data)) {
        assert.ok(data.length > 0, 'Debe contener registros mensuales de inflación');
      }
    });

    it('14.3. Debe retornar serie histórica de UVA', async () => {
      const res = await defaultTestServer.get('/api/argentinadatos/finanzas/indices/uva');
      assert.equal(res.status, 200, 'ArgentinaDatos UVA debe responder HTTP 200');
      const data = res.data.results || res.data;
      if (Array.isArray(data)) {
        assert.ok(data.length > 0, 'Debe contener registros de UVA');
      }
    });
  });

  // Mercado en vivo Data912
  describe('Feature Mercado Live: Data912 (/api/mercado/live/:tipo)', () => {
    it('Debe consultar cotizaciones de mercado en vivo para MEP', async () => {
      const res = await defaultTestServer.get('/api/mercado/live/mep');
      assert.ok([200, 429, 502, 503].includes(res.status), `Data912 MEP debe responder HTTP 200 o contingencia controlada (429/502/503), recibido: ${res.status}`);
      assert.ok(res.data, 'Debe retornar datos');
    });
  });
});
