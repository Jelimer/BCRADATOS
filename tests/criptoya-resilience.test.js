/**
 * tests/criptoya-resilience.test.js
 * Suite de pruebas de resiliencia, contingencias, caídas de red upstream y robustez de validación para CriptoYa.
 */

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const httpClient = require('../services/httpClient');
const { cacheService } = require('../services/cacheService');
const schemaValidator = require('../services/schemaValidator');

describe('CriptoYa Resilience, Contingency & Fallback Suite', () => {
  let mockServer;
  let mockPort;
  let mockHandler = null;

  before(async () => {
    // Servidor HTTP local efímero para simular respuestas anómalas de red
    mockServer = http.createServer((req, res) => {
      if (mockHandler) {
        mockHandler(req, res);
      } else {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: true, message: 'Upstream error no controlado' }));
      }
    });

    await new Promise(resolve => {
      mockServer.listen(0, '127.0.0.1', () => {
        mockPort = mockServer.address().port;
        resolve();
      });
    });
  });

  after(async () => {
    if (mockServer) {
      mockServer.closeAllConnections?.();
      await new Promise(resolve => mockServer.close(resolve));
    }
    cacheService.clear();
  });

  beforeEach(() => {
    mockHandler = null;
  });

  // ============================================================================
  // 1. SIMULACIÓN DE CÓDIGOS DE ERROR HTTP UPSTREAM (500, 502, 503)
  // ============================================================================
  describe('1. Respuestas de Error HTTP Upstream (500, 502, 503)', () => {
    it('1.1. Upstream 500: httpClient debe capturar el error y rechazar con status 500 controlado', async () => {
      mockHandler = (req, res) => {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Internal Server Error en CriptoYa' }));
      };

      try {
        await httpClient.get(`http://127.0.0.1:${mockPort}/api/dolar`, {}, { retries: 1, initialDelayMs: 20 });
        assert.fail('Debió arrojar error de upstream');
      } catch (err) {
        assert.ok(err.response, 'Debe adjuntar objeto de respuesta en el error');
        assert.equal(err.response.status, 500, 'El status capturado debe ser 500');
      }
    });

    it('1.2. Upstream 502 / 503: httpClient debe propagar error estructurado sin colapsar el proceso', async () => {
      mockHandler = (req, res) => {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Service Unavailable' }));
      };

      try {
        await httpClient.get(`http://127.0.0.1:${mockPort}/api/bancos`, {}, { retries: 1, initialDelayMs: 20 });
        assert.fail('Debió arrojar error de upstream');
      } catch (err) {
        assert.equal(err.response?.status, 503);
      }
    });
  });

  // ============================================================================
  // 2. SIMULACIÓN DE RATE LIMITING (HTTP 429) Y REINTENTOS CON BACKOFF
  // ============================================================================
  describe('2. Rate Limiting (HTTP 429) y Recuperación Automática', () => {
    it('2.1. httpClient debe reintentar automáticamente tras HTTP 429 y recuperarse al segundo intento', async () => {
      let callCount = 0;
      mockHandler = (req, res) => {
        callCount++;
        if (callCount === 1) {
          res.writeHead(429, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Too Many Requests' }));
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, call: callCount }));
        }
      };

      const response = await httpClient.get(
        `http://127.0.0.1:${mockPort}/api/dolar`,
        {},
        { retries: 2, initialDelayMs: 30 }
      );

      assert.equal(callCount, 2, 'Debió haber ejecutado exactamente 2 llamadas (1 fallo + 1 reintento exitoso)');
      assert.equal(response.status, 200);
      assert.equal(response.data.success, true);
    });
  });

  // ============================================================================
  // 3. CONTROL DE RETARDOS Y TIMEOUTS CONTROLADOS
  // ============================================================================
  describe('3. Timeouts y Slow-Hang Protection', () => {
    it('3.1. httpClient debe abortar la petición tras expirar el timeout configurado', async () => {
      mockHandler = (req, res) => {
        // Simular respuesta colgada que tarda 300ms
        setTimeout(() => {
          if (!res.writableEnded) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ delayed: true }));
          }
        }, 300);
      };

      try {
        await httpClient.get(
          `http://127.0.0.1:${mockPort}/slow-call`,
          { timeout: 50 },
          { retries: 0 }
        );
        assert.fail('Debió arrojar error por timeout');
      } catch (err) {
        assert.ok(
          err.code === 'ECONNABORTED' || err.name === 'AbortError' || err.message.includes('timeout') || err.message.includes('aborted'),
          `Error esperado de timeout, recibido: ${err.message}`
        );
      }
    });
  });

  // ============================================================================
  // 4. POLÍTICAS DE FALLBACK Y RESCATE DE SNAPSHOTS EN CACHE SERVICE
  // ============================================================================
  describe('4. Rescate de Snapshots de Contingencia en CacheService', () => {
    it('4.1. Fallback de Dólar: Si upstream falla, el snapshot persistente provee datos válidos para la SPA', () => {
      const fallbackKey = 'criptoya:last_valid_dolar';
      const fakeSnapshot = {
        oficial: { precio: 1050, compra: 1040, venta: 1060 },
        blue: { precio: 1350, compra: 1340, venta: 1360 },
        brechas: { blueVsOficial: 28.57 }
      };

      cacheService.set(fallbackKey, fakeSnapshot, 3600);
      const retrieved = cacheService.get(fallbackKey);

      assert.ok(retrieved, 'Debe rescatar el snapshot de caché');
      assert.equal(retrieved.blue.precio, 1350);
      assert.equal(retrieved.brechas.blueVsOficial, 28.57);
    });

    it('4.2. Fallback de Bancos: Snapshot provee cotizaciones minoristas de respaldo', () => {
      const fallbackKey = 'criptoya:last_valid_bancos';
      const fakeSnapshot = {
        results: [
          { codigo: 'bna', nombre: 'Banco Nación', compra: 1020, venta: 1060, spread: 40 }
        ],
        promedio: { compra: 1020, venta: 1060 }
      };

      cacheService.set(fallbackKey, fakeSnapshot, 3600);
      const retrieved = cacheService.get(fallbackKey);

      assert.ok(retrieved && Array.isArray(retrieved.results));
      assert.equal(retrieved.results[0].codigo, 'bna');
      assert.equal(retrieved.promedio.venta, 1060);
    });

    it('4.3. Fallback de Rendimientos: Snapshot provee ranking de billeteras remuneradas de contingencia', () => {
      const fallbackKey = 'finanzas:last_valid_rendimientos';
      const fakeSnapshot = [
        { entidad: 'mercadopago', nombre: 'Mercado Pago', apy: 37.5, moneda: 'ARS' }
      ];

      cacheService.set(fallbackKey, fakeSnapshot, 3600);
      const retrieved = cacheService.get(fallbackKey);

      assert.ok(Array.isArray(retrieved));
      assert.equal(retrieved[0].entidad, 'mercadopago');
      assert.equal(retrieved[0].apy, 37.5);
    });

    it('4.4. Fallback de Indicadores: Snapshot provee UVA y CER ante corte de servicio', () => {
      const fallbackKey = 'criptoya:last_valid_indicadores';
      const fakeSnapshot = {
        uva: { valor: 1150.25, fecha: '2026-09-04' },
        cer: { valor: 48.62, fecha: '2026-09-04' }
      };

      cacheService.set(fallbackKey, fakeSnapshot, 3600);
      const retrieved = cacheService.get(fallbackKey);

      assert.ok(retrieved.uva && retrieved.cer);
      assert.equal(retrieved.uva.valor, 1150.25);
      assert.equal(retrieved.cer.valor, 48.62);
    });
  });

  // ============================================================================
  // 5. ROBUSTEZ Y SANITIZACIÓN DE SCHEMAVALIDATOR ANTE DATOS CORRUPTOS O NULOS
  // ============================================================================
  describe('5. Robustez de schemaValidator ante Payloads Corruptos y Casos Borde', () => {
    it('5.1. normalizeDolarData debe tolerar null, undefined y propiedades ausentes sin arrojar excepciones', () => {
      const emptyResult = schemaValidator.normalizeDolarData(null);
      assert.ok(emptyResult && typeof emptyResult === 'object');
      assert.ok(emptyResult.oficial && typeof emptyResult.oficial.precio === 'number');
      assert.equal(emptyResult.oficial.precio, 0);
      assert.ok(emptyResult.brechas && typeof emptyResult.brechas.blueVsOficial === 'number');
      assert.equal(emptyResult.brechas.blueVsOficial, 0);

      const corruptResult = schemaValidator.normalizeDolarData({
        blue: { ask: 'NaN', bid: null, price: 'invalido' },
        oficial: { price: 1000 }
      });
      assert.ok(Number.isFinite(corruptResult.blue.precio));
      assert.ok(Number.isFinite(corruptResult.blue.compra));
      assert.ok(Number.isFinite(corruptResult.blue.venta));
      assert.equal(corruptResult.oficial.precio, 1000);
    });

    it('5.2. normalizeCriptoData debe descartar exchanges con valores no numéricos y calcular arbitraje sin fallar', () => {
      const corruptExchanges = {
        bad1: null,
        bad2: { ask: -50, bid: 0 },
        bad3: 'no es un objeto',
        valid1: { ask: 1320, totalAsk: 1325, bid: 1300, totalBid: 1295, time: 1725400000 },
        valid2: { ask: 1315, totalAsk: 1318, bid: 1305, totalBid: 1302, time: 1725400000 }
      };

      const norm = schemaValidator.normalizeCriptoData(corruptExchanges, 'USDT/ARS');
      assert.equal(norm.pair, 'USDT/ARS');
      assert.equal(norm.results.length, 2, 'Solo debe incluir los 2 exchanges válidos');
      assert.ok(norm.arbitraje.mejorCompra);
      assert.equal(norm.arbitraje.mejorCompra.exchange, 'valid2', 'Menor compraTotal debe ser valid2 (1318)');
      assert.equal(norm.arbitraje.mejorVenta.exchange, 'valid2', 'Mayor ventaTotal debe ser valid2 (1302)');
      assert.ok(Number.isFinite(norm.arbitraje.spreadPorcentaje));
    });

    it('5.3. normalizeBancosData debe manejar entradas vacías o corruptas sin generar NaN en promedios', () => {
      const emptyBancos = schemaValidator.normalizeBancosData({});
      assert.ok(Array.isArray(emptyBancos.results));
      assert.equal(emptyBancos.results.length, 0);
      assert.equal(emptyBancos.promedio.compra, 0);
      assert.equal(emptyBancos.promedio.venta, 0);

      const corruptBancos = schemaValidator.normalizeBancosData({
        bna: { ask: 1060, bid: 1020 },
        invalido: { ask: 'abc', bid: null }
      });
      assert.equal(corruptBancos.results.length, 1);
      assert.equal(corruptBancos.results[0].codigo, 'bna');
      assert.equal(corruptBancos.results[0].nombre, 'Banco Nación');
      assert.equal(corruptBancos.results[0].spread, 40);
      assert.equal(corruptBancos.promedio.compra, 1020);
      assert.equal(corruptBancos.promedio.venta, 1060);
    });

    it('5.4. normalizeRendimientosData debe sanitizar porcentajes fraccionarios y filtrar por moneda limpiamente', () => {
      const raw = [
        { entidad: 'lemoncash', apy: 0.41, moneda: 'ars', fecha: '2026-09-01' }, // Escala fraccionaria (0.41 -> 41%)
        { entidad: 'mercadopago', apy: 37.5, moneda: 'ARS', fecha: null },
        { entidad: 'nexo', apy: 12.0, moneda: 'USDT', fecha: 1725400000 },
        null
      ];

      const arsOnly = schemaValidator.normalizeRendimientosData(raw, 'ARS');
      assert.equal(arsOnly.length, 2, 'Debe contener solo las 2 entidades en ARS');
      assert.equal(arsOnly[0].entidad, 'lemoncash');
      assert.equal(arsOnly[0].apy, 41.0, '0.41 debe normalizarse a 41.0%');
      assert.equal(arsOnly[0].nombre, 'Lemon Cash');
      assert.equal(arsOnly[1].entidad, 'mercadopago');
      assert.equal(arsOnly[1].apy, 37.5);

      const all = schemaValidator.normalizeRendimientosData(raw);
      assert.equal(all.length, 3, 'Debe incluir las 3 entidades válidas');
    });

    it('5.5. normalizeIndicadoresData debe producir contratos seguros ante entradas nulas o numéricas', () => {
      const resNull = schemaValidator.normalizeIndicadoresData(null, null);
      assert.equal(resNull.uva.valor, 0);
      assert.equal(resNull.cer.valor, 0);
      assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(resNull.uva.fecha));

      const resValid = schemaValidator.normalizeIndicadoresData(
        { value: '1150.75', time: 1725400000 },
        { value: '48.90', time: 1725400000 }
      );
      assert.equal(resValid.uva.valor, 1150.75);
      assert.equal(resValid.cer.valor, 48.9);
      assert.ok(Number.isFinite(resValid.uva.timestamp));
      assert.ok(Number.isFinite(resValid.cer.timestamp));
    });
  });
});
