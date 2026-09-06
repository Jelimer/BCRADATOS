/**
 * tests/challenger_empirical.test.js
 * Suite Adversarial y Empírica para validación exhaustiva de M1_BACKEND.
 * 
 * Verifica:
 * 1. Casos de borde en services/schemaValidator.js (comas, nulos, NaN, fechas, negativos).
 * 2. Contratos y tipos de datos en endpoints proxy (/api/criptoya/*, /api/finanzas/*).
 * 3. Resiliencia y estabilidad del servidor Express sin excepciones no capturadas.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const schema = require('../services/schemaValidator');
const { defaultTestServer } = require('./helpers/setup');
const { cacheService } = require('../services/cacheService');

describe('Empirical Challenger: Schema Validator & Proxy Endpoints (M1_BACKEND)', () => {

  // =========================================================================
  // 1. CASOS DE BORDE EN services/schemaValidator.js
  // =========================================================================
  describe('1. services/schemaValidator.js - Casos de Borde', () => {

    describe('sanitizeNumber()', () => {
      it('debe procesar números finitos positivos, negativos y cero', () => {
        assert.strictEqual(schema.sanitizeNumber(1234.56), 1234.56);
        assert.strictEqual(schema.sanitizeNumber(-42.5), -42.5);
        assert.strictEqual(schema.sanitizeNumber(0), 0);
        assert.strictEqual(schema.sanitizeNumber(-0) === 0, true);
      });

      it('debe manejar strings con coma como separador decimal y espacios', () => {
        assert.strictEqual(schema.sanitizeNumber('1234,56'), 1234.56);
        assert.strictEqual(schema.sanitizeNumber(' -42,50 '), -42.5);
        assert.strictEqual(schema.sanitizeNumber('0,00'), 0);
      });

      it('debe retornar defaultVal ante null, undefined, NaN, Infinity y -Infinity', () => {
        assert.strictEqual(schema.sanitizeNumber(null), 0);
        assert.strictEqual(schema.sanitizeNumber(undefined), 0);
        assert.strictEqual(schema.sanitizeNumber(NaN), 0);
        assert.strictEqual(schema.sanitizeNumber(Infinity), 0);
        assert.strictEqual(schema.sanitizeNumber(-Infinity), 0);
        assert.strictEqual(schema.sanitizeNumber(null, 99.9), 99.9);
        assert.strictEqual(schema.sanitizeNumber(NaN, -1), -1);
      });

      it('debe proteger contra strings no numéricas, cadenas vacías o basura', () => {
        assert.strictEqual(schema.sanitizeNumber('abc'), 0);
        assert.strictEqual(schema.sanitizeNumber(''), 0);
        assert.strictEqual(schema.sanitizeNumber('   '), 0);
        assert.strictEqual(schema.sanitizeNumber('NaN'), 0);
        assert.strictEqual(schema.sanitizeNumber('Infinity'), 0);
        assert.strictEqual(schema.sanitizeNumber('12px'), 0);
      });

      it('debe manejar tipos no primitivos u objetos y documentar coerción de arrays', () => {
        assert.strictEqual(schema.sanitizeNumber({}), 0);
        assert.strictEqual(schema.sanitizeNumber([]), 0);
        assert.strictEqual(schema.sanitizeNumber([100]), 100);
        // Quirk empírico documentado: String([1, 2]) es '1,2' y .replace(',', '.') lo convierte en 1.2
        assert.strictEqual(schema.sanitizeNumber([1, 2]), 1.2);
        // Quirk empírico documentado: separadores de miles producen NaN -> 0
        assert.strictEqual(schema.sanitizeNumber('1.250,50'), 0);
        assert.strictEqual(schema.sanitizeNumber('1,250.50'), 0);
      });
    });

    describe('normalizePercentage()', () => {
      it('debe convertir fracciones decimales a escala 0-100', () => {
        assert.strictEqual(schema.normalizePercentage(0.174), 17.4);
        assert.strictEqual(schema.normalizePercentage(0.05), 5);
        assert.strictEqual(schema.normalizePercentage(0.999), 99.9);
      });

      it('debe preservar porcentajes que ya están en escala porcentual', () => {
        assert.strictEqual(schema.normalizePercentage(45.5), 45.5);
        assert.strictEqual(schema.normalizePercentage(100), 100);
        assert.strictEqual(schema.normalizePercentage(150), 150);
      });

      it('debe manejar tasas negativas fraccionarias y enteras', () => {
        assert.strictEqual(schema.normalizePercentage(-0.05), -5);
        assert.strictEqual(schema.normalizePercentage(-12.5), -12.5);
      });

      it('debe manejar cadenas con comas', () => {
        assert.strictEqual(schema.normalizePercentage('0,35'), 35);
        assert.strictEqual(schema.normalizePercentage('42,75'), 42.75);
      });

      it('debe retornar 0 ante valores nulos o inválidos', () => {
        assert.strictEqual(schema.normalizePercentage(null), 0);
        assert.strictEqual(schema.normalizePercentage(undefined), 0);
        assert.strictEqual(schema.normalizePercentage(NaN), 0);
        assert.strictEqual(schema.normalizePercentage('invalido'), 0);
        assert.strictEqual(schema.normalizePercentage(0), 0);
      });
    });

    describe('sanitizeDate()', () => {
      const todayIso = new Date().toISOString().split('T')[0];

      it('debe aceptar fechas válidas en string ISO', () => {
        assert.strictEqual(schema.sanitizeDate('2026-03-15'), '2026-03-15');
        assert.strictEqual(schema.sanitizeDate('2025-12-31T23:59:59Z'), '2025-12-31');
      });

      it('debe convertir timestamps Unix en segundos y en milisegundos', () => {
        // 1700000000 -> 2023-11-14T22:13:20.000Z
        assert.strictEqual(schema.sanitizeDate(1700000000), '2023-11-14');
        assert.strictEqual(schema.sanitizeDate(1700000000000), '2023-11-14');
        assert.strictEqual(schema.sanitizeDate('1700000000'), '2023-11-14');
      });

      it('debe retornar fallback o fecha de hoy ante valores inválidos o vacíos', () => {
        assert.strictEqual(schema.sanitizeDate(null), todayIso);
        assert.strictEqual(schema.sanitizeDate(undefined), todayIso);
        assert.strictEqual(schema.sanitizeDate('FECHA_INVALIDA'), todayIso);
        assert.strictEqual(schema.sanitizeDate('FECHA_INVALIDA', '2024-01-01'), '2024-01-01');
        assert.strictEqual(schema.sanitizeDate(-500, '2024-01-01'), '2024-01-01');
        assert.strictEqual(schema.sanitizeDate(0, '2024-01-01'), '2024-01-01');
      });
    });

    describe('safeArray() y safeObject()', () => {
      it('safeArray retorna el arreglo si es Array, de lo contrario []', () => {
        assert.deepStrictEqual(schema.safeArray([1, 2]), [1, 2]);
        assert.deepStrictEqual(schema.safeArray([]), []);
        assert.deepStrictEqual(schema.safeArray(null), []);
        assert.deepStrictEqual(schema.safeArray(undefined), []);
        assert.deepStrictEqual(schema.safeArray({}), []);
        assert.deepStrictEqual(schema.safeArray('texto'), []);
        assert.deepStrictEqual(schema.safeArray(123), []);
      });

      it('safeObject retorna el objeto si es plain Object, de lo contrario {}', () => {
        assert.deepStrictEqual(schema.safeObject({ a: 1 }), { a: 1 });
        assert.deepStrictEqual(schema.safeObject({}), {});
        assert.deepStrictEqual(schema.safeObject(null), {});
        assert.deepStrictEqual(schema.safeObject(undefined), {});
        assert.deepStrictEqual(schema.safeObject([1, 2]), {});
        assert.deepStrictEqual(schema.safeObject('texto'), {});
        assert.deepStrictEqual(schema.safeObject(123), {});
      });
    });

    describe('normalizeDolarData()', () => {
      it('debe normalizar payload completo con cálculo de brechas', () => {
        const mockRaw = {
          oficial: { price: 1000, bid: 980, ask: 1020, variation: 0.5, timestamp: 1700000000 },
          blue: { price: 1200, bid: 1180, ask: 1220, variation: -0.2, timestamp: 1700000000 },
          mep: { price: 1100, bid: 1090, ask: 1110, variation: 0.1, timestamp: 1700000000 },
          ccl: { price: 1150, bid: 1140, ask: 1160, variation: 0.3, timestamp: 1700000000 },
          cripto: { price: 1180, bid: 1170, ask: 1190, variation: 0, timestamp: 1700000000 },
          tarjeta: { price: 1600, bid: 1600, ask: 1600, variation: 0, timestamp: 1700000000 },
          mayorista: { price: 990, bid: 985, ask: 995, variation: 0.4, timestamp: 1700000000 }
        };

        const result = schema.normalizeDolarData(mockRaw);
        assert.ok(result.oficial && result.blue && result.mep && result.brechas);
        assert.strictEqual(result.oficial.precio, 1000);
        assert.strictEqual(result.blue.precio, 1200);
        // Brecha blue: (1200 - 1000) / 1000 * 100 = 20%
        assert.strictEqual(result.brechas.blueVsOficial, 20);
        // Brecha mep: (1100 - 1000) / 1000 * 100 = 10%
        assert.strictEqual(result.brechas.mepVsOficial, 10);
      });

      it('debe tolerar payload vacío sin arrojar excepciones ni NaN', () => {
        const result = schema.normalizeDolarData({});
        assert.ok(result.oficial);
        assert.strictEqual(result.oficial.precio, 0);
        assert.strictEqual(result.oficial.compra, 0);
        assert.strictEqual(result.oficial.venta, 0);
        assert.strictEqual(result.brechas.blueVsOficial, 0);
        assert.strictEqual(result.brechas.mepVsOficial, 0);
        assert.strictEqual(Number.isNaN(result.brechas.blueVsOficial), false);
      });

      it('debe tolerar valores null o no-objetos', () => {
        const result = schema.normalizeDolarData(null);
        assert.ok(result.oficial);
        assert.strictEqual(result.oficial.precio, 0);
        assert.strictEqual(result.brechas.blueVsOficial, 0);
      });
    });

    describe('normalizeCriptoData()', () => {
      it('debe normalizar cotizaciones por exchange y calcular arbitraje', () => {
        const mockRaw = {
          lemoncash: { ask: 1200, totalAsk: 1205, bid: 1180, totalBid: 1175, time: 1700000000 },
          buenbit: { ask: 1220, totalAsk: 1225, bid: 1210, totalBid: 1208, time: 1700000000 },
          ripio: { ask: 1210, totalAsk: 1212, bid: 1190, totalBid: 1188, time: 1700000000 }
        };

        const result = schema.normalizeCriptoData(mockRaw, 'usdt/ars');
        assert.strictEqual(result.pair, 'USDT/ARS');
        assert.strictEqual(result.results.length, 3);
        // Mejor compra debe ser lemoncash (1205)
        assert.strictEqual(result.arbitraje.mejorCompra.exchange, 'lemoncash');
        assert.strictEqual(result.arbitraje.mejorCompra.precioTotal, 1205);
        // Mejor venta debe ser buenbit (1208)
        assert.strictEqual(result.arbitraje.mejorVenta.exchange, 'buenbit');
        assert.strictEqual(result.arbitraje.mejorVenta.precioTotal, 1208);
        // Arbitraje: comprar a 1205 en lemon, vender a 1208 en buenbit -> spread > 0
        assert.ok(result.arbitraje.spreadPorcentaje > 0);
        assert.strictEqual(result.arbitraje.oportunidad, true);
      });

      it('debe omitir exchanges con cotizaciones nulas o no operativas', () => {
        const mockRaw = {
          exchangeMuerto: { ask: 0, totalAsk: 0, bid: 0, totalBid: 0, time: 0 },
          exchangeValido: { ask: 1200, totalAsk: 1200, bid: 1180, totalBid: 1180, time: 1700000000 }
        };

        const result = schema.normalizeCriptoData(mockRaw);
        assert.strictEqual(result.results.length, 1);
        assert.strictEqual(result.results[0].exchange, 'exchangeValido');
      });

      it('debe tolerar payload vacío sin arrojar excepciones', () => {
        const result = schema.normalizeCriptoData({});
        assert.strictEqual(result.results.length, 0);
        assert.strictEqual(result.arbitraje.mejorCompra, null);
        assert.strictEqual(result.arbitraje.mejorVenta, null);
        assert.strictEqual(result.arbitraje.oportunidad, false);
      });
    });

    describe('normalizeBancosData()', () => {
      it('debe normalizar bancos, resolver nombres y calcular promedios', () => {
        const mockRaw = {
          bna: { ask: 1050, bid: 1010, time: 1700000000 },
          galicia: { ask: 1060, bid: 1020, time: 1700000000 }
        };

        const result = schema.normalizeBancosData(mockRaw);
        assert.strictEqual(result.results.length, 2);
        assert.strictEqual(result.results[0].nombre, 'Banco Galicia'); // Orden alfabético
        assert.strictEqual(result.results[1].nombre, 'Banco Nación');
        // Promedios: compra (1010 + 1020)/2 = 1015, venta (1050 + 1060)/2 = 1055
        assert.strictEqual(result.promedio.compra, 1015);
        assert.strictEqual(result.promedio.venta, 1055);
      });

      it('debe tolerar bancos desconocidos asignando nombre amigable capitalizado', () => {
        const mockRaw = {
          banco_fantasma: { ask: 1000, bid: 950, time: 1700000000 }
        };
        const result = schema.normalizeBancosData(mockRaw);
        assert.strictEqual(result.results.length, 1);
        assert.strictEqual(result.results[0].nombre, 'Banco_fantasma');
      });

      it('debe tolerar payload vacío', () => {
        const result = schema.normalizeBancosData({});
        assert.strictEqual(result.results.length, 0);
        assert.strictEqual(result.promedio.compra, 0);
        assert.strictEqual(result.promedio.venta, 0);
      });
    });

    describe('normalizeRendimientosData()', () => {
      it('debe normalizar rendimientos fintech, calcular rendimiento mensual y ordenar por APY desc', () => {
        const mockRaw = [
          { entidad: 'mercadopago', apy: 0.36, fecha: '2026-03-01', moneda: 'ARS' },
          { entidad: 'naranjax', apy: 0.42, fecha: '2026-03-01', moneda: 'ARS', bonusThreshold: 500000, bonusValue: 0.05 },
          { entidad: 'belo', apy: 0.04, fecha: '2026-03-01', moneda: 'USDT' }
        ];

        const result = schema.normalizeRendimientosData(mockRaw);
        assert.strictEqual(result.length, 3);
        // NaranjaX tiene mayor APY (42%) -> debe ser el primero
        assert.strictEqual(result[0].entidad, 'naranjax');
        assert.strictEqual(result[0].nombre, 'Naranja X');
        assert.strictEqual(result[0].apy, 42);
        assert.strictEqual(result[0].rendimientoMensual, 3.5); // 42 / 12 = 3.5
        assert.strictEqual(result[0].topeBonificado, 500000);
        assert.strictEqual(result[0].bonoApy, 5);

        // MercadoPago segundo (36%)
        assert.strictEqual(result[1].entidad, 'mercadopago');
        assert.strictEqual(result[1].apy, 36);
        assert.strictEqual(result[1].rendimientoMensual, 3);
      });

      it('debe filtrar por moneda correctamente', () => {
        const mockRaw = [
          { entidad: 'mercadopago', apy: 0.36, moneda: 'ARS' },
          { entidad: 'belo', apy: 0.04, moneda: 'USDT' }
        ];

        const resultArs = schema.normalizeRendimientosData(mockRaw, 'ARS');
        assert.strictEqual(resultArs.length, 1);
        assert.strictEqual(resultArs[0].moneda, 'ARS');

        const resultUsdt = schema.normalizeRendimientosData(mockRaw, 'USDT');
        assert.strictEqual(resultUsdt.length, 1);
        assert.strictEqual(resultUsdt[0].moneda, 'USDT');
      });

      it('debe tolerar array vacío o null', () => {
        assert.deepStrictEqual(schema.normalizeRendimientosData([]), []);
        assert.deepStrictEqual(schema.normalizeRendimientosData(null), []);
      });
    });

    describe('normalizeIndicadoresData()', () => {
      it('debe estructurar UVA y CER con valores finitos y fechas', () => {
        const mockUva = { value: 1250.5, time: 1700000000 };
        const mockCer = { value: 890.3, time: 1700000000 };

        const result = schema.normalizeIndicadoresData(mockUva, mockCer);
        assert.strictEqual(result.uva.valor, 1250.5);
        assert.strictEqual(result.uva.fecha, '2023-11-14');
        assert.strictEqual(result.cer.valor, 890.3);
        assert.strictEqual(result.cer.fecha, '2023-11-14');
      });

      it('debe tolerar entradas vacías', () => {
        const result = schema.normalizeIndicadoresData({}, {});
        assert.strictEqual(result.uva.valor, 0);
        assert.strictEqual(result.cer.valor, 0);
        assert.ok(typeof result.uva.fecha === 'string');
      });
    });
  });

  // =========================================================================
  // 2. PRUEBAS EMPÍRICAS DE ENDPOINTS PROXY EN server.js
  // =========================================================================
  describe('2. Endpoints Proxy CriptoYa y Finanzas en server.js', () => {
    before(async () => {
      await defaultTestServer.start();
    });

    after(async () => {
      cacheService.clear();
      await defaultTestServer.stop();
    });

    it('2.1. GET /api/criptoya/dolar responde con HTTP 200 o 502 controlado y contrato normalizado', async () => {
      const res = await defaultTestServer.get('/api/criptoya/dolar');
      assert.ok([200, 502].includes(res.status), `Status debe ser 200 o 502, recibido: ${res.status}`);
      assert.ok(res.data, 'Debe devolver un cuerpo de respuesta');
      assert.ok(res.data.results, 'Debe incluir results');

      const r = res.data.results;
      assert.ok(r.oficial && r.blue && r.mep && r.ccl && r.cripto && r.brechas);
      assert.ok(typeof r.oficial.precio === 'number' && Number.isFinite(r.oficial.precio));
      assert.ok(typeof r.brechas.blueVsOficial === 'number' && Number.isFinite(r.brechas.blueVsOficial));
      assert.ok(!Number.isNaN(r.brechas.blueVsOficial));
    });

    it('2.2. GET /api/criptoya/dolar debe servirse desde memoria caché en peticiones subsecuentes', async () => {
      const res = await defaultTestServer.get('/api/criptoya/dolar');
      if (res.status === 200) {
        assert.equal(res.headers.get('x-cache'), 'HIT');
      }
    });

    it('2.3. GET /api/criptoya/cripto/:coin/:fiat responde con contrato seguro y estructura de arbitraje', async () => {
      const res = await defaultTestServer.get('/api/criptoya/cripto/usdt/ars');
      assert.ok([200, 502].includes(res.status));
      assert.ok(res.data);
      assert.strictEqual(res.data.pair, 'USDT/ARS');
      assert.ok(Array.isArray(res.data.results));
      assert.ok(res.data.arbitraje && typeof res.data.arbitraje === 'object');
      assert.ok(typeof res.data.arbitraje.oportunidad === 'boolean');
      assert.ok(typeof res.data.arbitraje.spreadPorcentaje === 'number');

      // Si hay resultados de exchanges, verificar sus tipos numéricos
      for (const ex of res.data.results) {
        assert.ok(typeof ex.exchange === 'string');
        assert.ok(Number.isFinite(ex.compraTotal));
        assert.ok(Number.isFinite(ex.ventaTotal));
        assert.ok(!Number.isNaN(ex.compraTotal));
      }
    });

    it('2.4. GET /api/criptoya/bancos responde con resultados de bancos y promedios seguros', async () => {
      const res = await defaultTestServer.get('/api/criptoya/bancos');
      assert.ok([200, 502].includes(res.status));
      assert.ok(res.data);
      assert.ok(Array.isArray(res.data.results));
      assert.ok(res.data.promedio && typeof res.data.promedio === 'object');
      assert.ok(Number.isFinite(res.data.promedio.compra));
      assert.ok(Number.isFinite(res.data.promedio.venta));

      for (const b of res.data.results) {
        assert.ok(typeof b.nombre === 'string');
        assert.ok(Number.isFinite(b.compra));
        assert.ok(Number.isFinite(b.venta));
        assert.ok(Number.isFinite(b.spread));
        assert.ok(!Number.isNaN(b.spread));
      }
    });

    it('2.5. GET /api/finanzas/rendimientos responde con lista ordenada de billeteras remuneradas', async () => {
      const res = await defaultTestServer.get('/api/finanzas/rendimientos');
      assert.ok([200, 502].includes(res.status));
      assert.ok(res.data);
      assert.ok(Array.isArray(res.data.results));

      let prevApy = Infinity;
      for (const item of res.data.results) {
        assert.ok(typeof item.entidad === 'string');
        assert.ok(typeof item.nombre === 'string');
        assert.ok(Number.isFinite(item.apy));
        assert.ok(Number.isFinite(item.rendimientoMensual));
        assert.ok(!Number.isNaN(item.apy));
        // Verificar orden descendente
        assert.ok(item.apy <= prevApy + 0.001, `Debe estar ordenado desc por APY: ${item.apy} <= ${prevApy}`);
        prevApy = item.apy;
      }
    });

    it('2.6. GET /api/finanzas/rendimientos?moneda=ars filtra correctamente por moneda', async () => {
      const res = await defaultTestServer.get('/api/finanzas/rendimientos?moneda=ars');
      assert.ok([200, 502].includes(res.status));
      assert.ok(res.data);
      assert.strictEqual(res.data.moneda, 'ARS');
      assert.ok(Array.isArray(res.data.results));
      for (const item of res.data.results) {
        assert.strictEqual(item.moneda, 'ARS');
      }
    });

    it('2.7. GET /api/criptoya/indicadores entrega UVA y CER consolidados', async () => {
      const res = await defaultTestServer.get('/api/criptoya/indicadores');
      assert.ok([200, 502].includes(res.status));
      assert.ok(res.data);
      assert.ok(res.data.results);
      assert.ok(res.data.results.uva);
      assert.ok(res.data.results.cer);
      assert.ok(Number.isFinite(res.data.results.uva.valor));
      assert.ok(Number.isFinite(res.data.results.cer.valor));
      assert.ok(!Number.isNaN(res.data.results.uva.valor));
      assert.ok(!Number.isNaN(res.data.results.cer.valor));
    });

    it('2.8. Robustez del servidor ante rutas espurias y parámetros corruptos', async () => {
      const badCoins = ['../etc/passwd', 'null', 'undefined', '%00', '12345678901234567890'];
      for (const coin of badCoins) {
        const res = await defaultTestServer.get(`/api/criptoya/cripto/${coin}/ars`);
        assert.ok([200, 400, 404, 502].includes(res.status), `Status inesperado: ${res.status}`);
        assert.ok(res.data, 'No debe colapsar');
      }
    });
  });
});
