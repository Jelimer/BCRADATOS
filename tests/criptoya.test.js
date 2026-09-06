/**
 * tests/criptoya.test.js
 * Suite de pruebas de integración, validación de contratos y caché para endpoints de CriptoYa y Finanzas.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { defaultTestServer } = require('./helpers/setup');
const { cacheService } = require('../services/cacheService');
const schemaValidator = require('../services/schemaValidator');

describe('CriptoYa & Finanzas Proxy Endpoints, Contracts & Cache Suite', () => {
  before(async () => {
    // Inicializar servidor de pruebas efímero
    await defaultTestServer.start();

    // Precargar snapshots de contingencia en cacheService para blindar pruebas ante caídas upstream
    const mockDolarSnapshot = schemaValidator.normalizeDolarData({
      oficial: { price: 1050, ask: 1060, bid: 1040, variation: 0.1, timestamp: 1725400000 },
      blue: { price: 1350, ask: 1360, bid: 1340, variation: -0.5, timestamp: 1725400000 },
      mep: { price: 1280, ask: 1285, bid: 1275, variation: 0.2, timestamp: 1725400000 },
      ccl: { price: 1290, ask: 1295, bid: 1285, variation: 0.3, timestamp: 1725400000 },
      cripto: { price: 1310, ask: 1315, bid: 1305, variation: 0.0, timestamp: 1725400000 },
      tarjeta: { price: 1680, ask: 1680, bid: 1680, variation: 0.0, timestamp: 1725400000 },
      mayorista: { price: 980, ask: 982, bid: 978, variation: 0.05, timestamp: 1725400000 }
    });
    cacheService.set('criptoya:last_valid_dolar', mockDolarSnapshot, 86400);

    const mockCriptoSnapshot = schemaValidator.normalizeCriptoData({
      lemoncash: { ask: 1320, totalAsk: 1325, bid: 1300, totalBid: 1295, time: 1725400000 },
      fiwind: { ask: 1315, totalAsk: 1318, bid: 1305, totalBid: 1302, time: 1725400000 },
      buenbit: { ask: 1330, totalAsk: 1332, bid: 1290, totalBid: 1288, time: 1725400000 }
    }, 'USDT/ARS');
    cacheService.set('criptoya:last_valid_cripto:usdt:ars', mockCriptoSnapshot, 86400);

    const mockBancosSnapshot = schemaValidator.normalizeBancosData({
      bna: { ask: 1060, totalAsk: 1060, bid: 1020, totalBid: 1020, time: 1725400000 },
      galicia: { ask: 1075, totalAsk: 1075, bid: 1015, totalBid: 1015, time: 1725400000 },
      bbva: { ask: 1070, totalAsk: 1070, bid: 1020, totalBid: 1020, time: 1725400000 }
    });
    cacheService.set('criptoya:last_valid_bancos', mockBancosSnapshot, 86400);

    const mockRendimientosSnapshot = schemaValidator.normalizeRendimientosData([
      { entidad: 'mercadopago', apy: 37.5, moneda: 'ARS', fecha: '2026-09-03' },
      { entidad: 'lemoncash', apy: 41.0, moneda: 'ARS', fecha: '2026-09-03' },
      { entidad: 'naranjax', apy: 42.0, moneda: 'ARS', bonusThreshold: 500000, fecha: '2026-09-03' }
    ]);
    cacheService.set('finanzas:last_valid_rendimientos', mockRendimientosSnapshot, 86400);
    cacheService.set('finanzas:last_valid_rendimientos:ARS', mockRendimientosSnapshot, 86400);

    const mockIndicadoresSnapshot = schemaValidator.normalizeIndicadoresData(
      { value: 1150.25, time: 1725400000 },
      { value: 48.62, time: 1725400000 }
    );
    cacheService.set('criptoya:last_valid_indicadores', mockIndicadoresSnapshot, 86400);
  });

  after(async () => {
    await defaultTestServer.stop();
    cacheService.clear();
  });

  // ============================================================================
  // 1. ENDPOINT /api/criptoya/dolar
  // ============================================================================
  describe('1. Endpoint /api/criptoya/dolar (Cotizaciones Unificadas y Brechas)', () => {
    it('1.1. Debe responder HTTP 200 con cabecera Content-Type application/json', async () => {
      const res = await defaultTestServer.get('/api/criptoya/dolar');
      assert.equal(res.status, 200, 'Debe responder con código HTTP 200');
      assert.ok(
        res.headers.get('content-type')?.includes('application/json'),
        'La cabecera Content-Type debe ser application/json'
      );
      assert.ok(res.data, 'El cuerpo de la respuesta no debe estar vacío');
    });

    it('1.2. Contrato de esquema: debe contener cotizaciones completas con valores numéricos finitos y positivos', async () => {
      const res = await defaultTestServer.get('/api/criptoya/dolar');
      const data = res.data?.results || res.data;
      assert.ok(data && typeof data === 'object', 'results debe ser un objeto');

      const tiposEsperados = ['oficial', 'blue', 'mep', 'ccl', 'cripto', 'tarjeta'];
      for (const tipo of tiposEsperados) {
        assert.ok(data[tipo], `Debe incluir la cotización de ${tipo}`);
        const item = data[tipo];
        assert.ok(typeof item === 'object', `${tipo} debe ser un objeto`);
        assert.ok(typeof item.precio === 'number' && Number.isFinite(item.precio) && item.precio >= 0, `${tipo}.precio debe ser un número finito no negativo`);
        assert.ok(typeof item.compra === 'number' && Number.isFinite(item.compra) && item.compra >= 0, `${tipo}.compra debe ser un número finito no negativo`);
        assert.ok(typeof item.venta === 'number' && Number.isFinite(item.venta) && item.venta >= 0, `${tipo}.venta debe ser un número finito no negativo`);
        assert.ok(typeof item.variacion === 'number' && Number.isFinite(item.variacion), `${tipo}.variacion debe ser un número finito`);
      }

      // Validar que las cotizaciones fundamentales de mercado en vivo sean estrictamente positivas
      for (const principal of ['oficial', 'blue']) {
        const item = data[principal];
        assert.ok(item.precio > 0, `${principal}.precio debe ser estrictamente positivo`);
        assert.ok(item.compra > 0, `${principal}.compra debe ser estrictamente positivo`);
        assert.ok(item.venta > 0, `${principal}.venta debe ser estrictamente positivo`);
      }

      if (data.cripto && data.cripto.precio > 0) {
        assert.ok(Number.isFinite(data.cripto.precio) && data.cripto.precio > 0);
      }
    });

    it('1.3. Contrato de cálculo: debe incluir brechas cambiarias relativas al dólar oficial', async () => {
      const res = await defaultTestServer.get('/api/criptoya/dolar');
      const data = res.data?.results || res.data;
      assert.ok(data.brechas, 'Debe contener el objeto brechas');

      const { blueVsOficial, mepVsOficial, cclVsOficial, criptoVsOficial } = data.brechas;
      for (const [nombre, brecha] of Object.entries({ blueVsOficial, mepVsOficial, cclVsOficial, criptoVsOficial })) {
        assert.ok(
          typeof brecha === 'number' && Number.isFinite(brecha),
          `La brecha ${nombre} debe ser un número finito válido (obtenido: ${brecha})`
        );
      }
    });

    it('1.4. Caché: la segunda petición debe resolverse con X-Cache: HIT y cabecera X-Cache-TTL positiva', async () => {
      const res1 = await defaultTestServer.get('/api/criptoya/dolar');
      assert.equal(res1.status, 200);

      const res2 = await defaultTestServer.get('/api/criptoya/dolar');
      assert.equal(res2.status, 200);
      assert.equal(res2.headers.get('x-cache'), 'HIT', 'Debe marcar HIT en la segunda petición');
      const ttl = Number(res2.headers.get('x-cache-ttl'));
      assert.ok(!isNaN(ttl) && ttl > 0, `X-Cache-TTL debe ser mayor a 0 (obtenido: ${ttl})`);
      assert.ok(res2.durationMs < 150, `La respuesta en caché debe ser veloz (<150ms, tardó: ${res2.durationMs}ms)`);
    });
  });

  // ============================================================================
  // 2. ENDPOINT /api/criptoya/cripto/:coin?/:fiat?
  // ============================================================================
  describe('2. Endpoint /api/criptoya/cripto/:coin?/:fiat? (Cotizaciones Cripto & Arbitraje)', () => {
    it('2.1. Debe responder HTTP 200 para par USDT/ARS con estructura de arbitraje', async () => {
      const res = await defaultTestServer.get('/api/criptoya/cripto/usdt/ars');
      assert.equal(res.status, 200);
      assert.ok(res.data, 'Debe devolver datos');
      assert.equal(res.data.pair, 'USDT/ARS', 'El par debe ser USDT/ARS');
      assert.ok(Array.isArray(res.data.results), 'results debe ser un arreglo de exchanges');
    });

    it('2.2. Contrato de exchanges: cada exchange debe tener compra/venta numérica finita y spread coherente', async () => {
      const res = await defaultTestServer.get('/api/criptoya/cripto/usdt/ars');
      const exchanges = res.data.results;
      assert.ok(exchanges.length > 0, 'Debe incluir al menos un exchange con cotización');

      for (const item of exchanges) {
        assert.ok(typeof item.exchange === 'string' && item.exchange.length > 0, 'exchange debe ser un string no vacío');
        assert.ok(typeof item.compra === 'number' && Number.isFinite(item.compra) && item.compra >= 0, 'compra debe ser número finito >= 0');
        assert.ok(typeof item.compraTotal === 'number' && Number.isFinite(item.compraTotal) && item.compraTotal >= 0, 'compraTotal debe ser número finito >= 0');
        assert.ok(typeof item.venta === 'number' && Number.isFinite(item.venta) && item.venta >= 0, 'ventaTotal debe ser número finito >= 0');
        assert.ok(typeof item.ventaTotal === 'number' && Number.isFinite(item.ventaTotal) && item.ventaTotal >= 0, 'ventaTotal debe ser número finito >= 0');
      }
    });

    it('2.3. Contrato de arbitraje: debe calcular métricas de mejor compra, mejor venta y spread porcentual', async () => {
      const res = await defaultTestServer.get('/api/criptoya/cripto/usdt/ars');
      const { arbitraje } = res.data;
      assert.ok(arbitraje && typeof arbitraje === 'object', 'arbitraje debe ser un objeto');
      assert.ok(typeof arbitraje.spreadPorcentaje === 'number' && Number.isFinite(arbitraje.spreadPorcentaje), 'spreadPorcentaje debe ser un número finito');
      assert.ok(typeof arbitraje.oportunidad === 'boolean', 'oportunidad debe ser un booleano');

      if (arbitraje.mejorCompra) {
        assert.ok(typeof arbitraje.mejorCompra.exchange === 'string');
        assert.ok(typeof arbitraje.mejorCompra.precioTotal === 'number' && arbitraje.mejorCompra.precioTotal > 0);
      }
      if (arbitraje.mejorVenta) {
        assert.ok(typeof arbitraje.mejorVenta.exchange === 'string');
        assert.ok(typeof arbitraje.mejorVenta.precioTotal === 'number' && arbitraje.mejorVenta.precioTotal > 0);
      }
    });

    it('2.4. Caché: la segunda petición debe retornar X-Cache: HIT', async () => {
      const res1 = await defaultTestServer.get('/api/criptoya/cripto/usdt/ars');
      assert.equal(res1.status, 200);

      const res2 = await defaultTestServer.get('/api/criptoya/cripto/usdt/ars');
      assert.equal(res2.status, 200);
      assert.equal(res2.headers.get('x-cache'), 'HIT');
    });
  });

  // ============================================================================
  // 3. ENDPOINT /api/criptoya/bancos
  // ============================================================================
  describe('3. Endpoint /api/criptoya/bancos (Cotizaciones de Dólar Minorista por Banco)', () => {
    it('3.1. Debe responder HTTP 200 con lista de entidades bancarias y promedios generales', async () => {
      const res = await defaultTestServer.get('/api/criptoya/bancos');
      assert.equal(res.status, 200);
      assert.ok(Array.isArray(res.data.results), 'results debe ser un arreglo de bancos');
      assert.ok(res.data.promedio && typeof res.data.promedio === 'object', 'Debe incluir promedios');
    });

    it('3.2. Contrato de bancos: nombres formateados, precios finitos y spreads no negativos', async () => {
      const res = await defaultTestServer.get('/api/criptoya/bancos');
      const bancos = res.data.results;
      assert.ok(bancos.length > 0, 'Debe incluir entidades bancarias');

      for (const b of bancos) {
        assert.ok(typeof b.codigo === 'string' && b.codigo.length > 0, 'codigo de banco debe ser string');
        assert.ok(typeof b.nombre === 'string' && b.nombre.length > 0, 'nombre de banco debe ser string');
        assert.ok(typeof b.compra === 'number' && Number.isFinite(b.compra) && b.compra >= 0, 'compra debe ser número finito >= 0');
        assert.ok(typeof b.venta === 'number' && Number.isFinite(b.venta) && b.venta >= 0, 'venta debe ser número finito >= 0');
        assert.ok(typeof b.spread === 'number' && Number.isFinite(b.spread) && b.spread >= 0, 'spread debe ser número finito >= 0');
      }

      const { promedio } = res.data;
      assert.ok(typeof promedio.compra === 'number' && Number.isFinite(promedio.compra) && promedio.compra >= 0, 'promedio.compra finito');
      assert.ok(typeof promedio.venta === 'number' && Number.isFinite(promedio.venta) && promedio.venta >= 0, 'promedio.venta finito');
    });

    it('3.3. Caché: la segunda petición debe retornar X-Cache: HIT', async () => {
      const res = await defaultTestServer.get('/api/criptoya/bancos');
      assert.equal(res.status, 200);

      const hit = await defaultTestServer.get('/api/criptoya/bancos');
      assert.equal(hit.status, 200);
      assert.equal(hit.headers.get('x-cache'), 'HIT');
    });
  });

  // ============================================================================
  // 4. ENDPOINT /api/finanzas/rendimientos
  // ============================================================================
  describe('4. Endpoint /api/finanzas/rendimientos (Cuentas Remuneradas Fintech & Tasas)', () => {
    it('4.1. Debe responder HTTP 200 y entregar lista de cuentas remuneradas fintech', async () => {
      const res = await defaultTestServer.get('/api/finanzas/rendimientos');
      assert.equal(res.status, 200);
      assert.ok(Array.isArray(res.data.results), 'results debe ser un arreglo de billeteras');
    });

    it('4.2. Contrato de rendimientos: tasas APY porcentuales normalizadas en rango financiero coherente', async () => {
      const res = await defaultTestServer.get('/api/finanzas/rendimientos');
      const rendimientos = res.data.results;
      assert.ok(rendimientos.length > 0, 'Debe incluir al menos una entidad financiera o fintech');

      for (const item of rendimientos) {
        assert.ok(typeof item.entidad === 'string' && item.entidad.length > 0, 'entidad debe ser un string');
        assert.ok(typeof item.nombre === 'string' && item.nombre.length > 0, 'nombre amigable debe ser un string');
        assert.ok(typeof item.moneda === 'string' && item.moneda.length > 0, 'moneda debe ser un string');
        assert.ok(
          typeof item.apy === 'number' && Number.isFinite(item.apy) && item.apy >= 0 && item.apy <= 500,
          `APY debe ser un valor porcentual financiero razonable (0-500%), obtenido: ${item.apy}`
        );
        assert.ok(
          typeof item.rendimientoMensual === 'number' && Number.isFinite(item.rendimientoMensual) && item.rendimientoMensual >= 0,
          'rendimientoMensual debe ser un número finito >= 0'
        );
        assert.ok(typeof item.fecha === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(item.fecha), 'fecha debe estar en formato ISO YYYY-MM-DD');
      }
    });

    it('4.3. Filtro por moneda: ?moneda=ARS debe retornar solo entidades en pesos argentinos', async () => {
      const res = await defaultTestServer.get('/api/finanzas/rendimientos?moneda=ARS');
      assert.equal(res.status, 200);
      assert.equal(res.data.moneda, 'ARS');
      for (const item of res.data.results) {
        assert.equal(item.moneda, 'ARS', 'Cada entidad debe operar en ARS');
      }
    });

    it('4.4. Caché: persistencia con TTL y X-Cache: HIT en consultas sucesivas', async () => {
      const res1 = await defaultTestServer.get('/api/finanzas/rendimientos');
      assert.equal(res1.status, 200);

      const res2 = await defaultTestServer.get('/api/finanzas/rendimientos');
      assert.equal(res2.status, 200);
      assert.equal(res2.headers.get('x-cache'), 'HIT');
    });
  });

  // ============================================================================
  // 5. ENDPOINT /api/criptoya/indicadores
  // ============================================================================
  describe('5. Endpoint /api/criptoya/indicadores (Indicadores UVA y CER Consolidados)', () => {
    it('5.1. Debe responder HTTP 200 y entregar valores de UVA y CER', async () => {
      const res = await defaultTestServer.get('/api/criptoya/indicadores');
      assert.equal(res.status, 200);
      assert.ok(res.data.results, 'Debe incluir el objeto results');
    });

    it('5.2. Contrato de indicadores: UVA y CER con valores finitos positivos y fechas válidas', async () => {
      const res = await defaultTestServer.get('/api/criptoya/indicadores');
      const { uva, cer } = res.data.results;

      assert.ok(uva && typeof uva === 'object', 'results.uva debe ser un objeto');
      assert.ok(typeof uva.valor === 'number' && Number.isFinite(uva.valor) && uva.valor > 0, 'uva.valor debe ser un número finito > 0');
      assert.ok(typeof uva.fecha === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(uva.fecha), 'uva.fecha debe ser formato YYYY-MM-DD');

      assert.ok(cer && typeof cer === 'object', 'results.cer debe ser un objeto');
      assert.ok(typeof cer.valor === 'number' && Number.isFinite(cer.valor) && cer.valor > 0, 'cer.valor debe ser un número finito > 0');
      assert.ok(typeof cer.fecha === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(cer.fecha), 'cer.fecha debe ser formato YYYY-MM-DD');
    });

    it('5.3. Caché: segunda petición retorna X-Cache: HIT con cabecera TTL positiva', async () => {
      const res1 = await defaultTestServer.get('/api/criptoya/indicadores');
      assert.equal(res1.status, 200);

      const res2 = await defaultTestServer.get('/api/criptoya/indicadores');
      assert.equal(res2.status, 200);
      assert.equal(res2.headers.get('x-cache'), 'HIT');
      const ttl = Number(res2.headers.get('x-cache-ttl'));
      assert.ok(!isNaN(ttl) && ttl > 0, 'X-Cache-TTL debe ser positivo');
    });
  });
});
