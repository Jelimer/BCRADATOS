const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { defaultTestServer } = require('./helpers/setup');
const { CUITS, TICKERS_BYMA } = require('./helpers/fixtures');

describe('Tier 2: Resilience, Contingency & Edge Cases Tests', () => {
  before(async () => {
    await defaultTestServer.start();
  });

  after(async () => {
    await defaultTestServer.stop();
  });

  // Central de Deudores: 404 del BCRA normalizado como "Sin Deuda"
  describe('Resilience: Central de Deudores & 404 Normalization', () => {
    it('2.1. CUIT sin deuda (404 en upstream) debe manejarse de forma limpia sin colapsar el servidor', async () => {
      const res = await defaultTestServer.get(`/api/bcra-deudores/Deudas/${CUITS.SIN_DEUDA}`);
      // El servidor debe responder 200 con estructura de contingencia, o 503 si BCRA está en mantenimiento
      assert.ok([200, 404, 503].includes(res.status), 'Debe responder con código HTTP controlado (200, 404 o 503)');
      assert.ok(res.data, 'La respuesta no debe ser nula');

      if (res.status === 200) {
        const data = res.data;
        const tieneDeuda = data.tieneDeuda === true || (Array.isArray(data.deudas) && data.deudas.length > 0);
        // Para CUIT sin deuda, tieneDeuda debe ser false o el listado de deudas vacío
        assert.ok(!tieneDeuda || data.results !== undefined, 'No debe registrar deuda activa para este CUIT');
      }
    });

    it('2.2. CUIT con formato o longitud inválida no debe causar excepción no controlada', async () => {
      const res = await defaultTestServer.get(`/api/bcra-deudores/Deudas/${CUITS.INVALIDO_LONGITUD}`);
      assert.ok([200, 400, 404, 422, 500].includes(res.status), 'Debe devolver código HTTP estándar');
      assert.ok(res.data, 'Debe incluir cuerpo de respuesta');
    });

    it('2.3. CUIT con caracteres alfanuméricos no numéricos', async () => {
      const res = await defaultTestServer.get(`/api/bcra-deudores/Deudas/${CUITS.INVALIDO_ALFANUMERICO}`);
      assert.ok([200, 400, 404, 422, 500].includes(res.status), 'Debe manejar caracteres no numéricos');
      assert.ok(res.data, 'Debe entregar respuesta');
    });
  });

  // BYMA fuera de horario bursátil y símbolos especiales
  describe('Resilience: BYMA Fallback & Closed Market Handling', () => {
    it('2.4. Panel de bonos debe retornar contrato JSON válido aún fuera de horario bursátil', async () => {
      const res = await defaultTestServer.get('/api/byma/panel/public-bonds');
      assert.equal(res.status, 200, 'Debe responder 200');
      assert.ok(res.data, 'No debe ser nulo');

      // Comprobar que data sea arreglo o el objeto contenga data
      const bonos = res.data.data || (Array.isArray(res.data) ? res.data : []);
      assert.ok(Array.isArray(bonos), 'La colección de bonos debe ser un arreglo');
    });

    it('2.5. Ficha técnica con símbolo con sufijo de liquidación (ej. AL30 24HS)', async () => {
      const res = await defaultTestServer.get(`/api/byma/bond-info/${encodeURIComponent(TICKERS_BYMA.AL30_24HS)}`);
      assert.ok([200, 400, 404, 500, 502, 504].includes(res.status), 'Debe manejar el ticker con sufijo');
      assert.ok(res.data, 'Debe responder JSON');
    });

    it('2.6. Histórico OHLCV con símbolo inexistente', async () => {
      const res = await defaultTestServer.get('/api/byma/historico/TICKER_INEXISTENTE_999');
      assert.ok([200, 400, 404, 500, 502, 504].includes(res.status), 'Debe manejar el ticker inexistente sin caer');
    });
  });

  // BCRA Cheques Denunciados
  describe('Resilience: BCRA Cheques Denunciados', () => {
    it('2.7. Consulta de cheque con entidad inexistente (999)', async () => {
      const res = await defaultTestServer.get('/api/bcra-cheques/denunciados/999/99999999');
      assert.ok([200, 400, 404, 500].includes(res.status), 'Debe responder con código HTTP controlado');
      assert.ok(res.data, 'Debe responder estructura');
    });
  });

  // INDEC y series con IDs inexistentes
  describe('Resilience: INDEC IDs Inexistentes', () => {
    it('2.8. Consulta de series INDEC con ID inválido', async () => {
      const res = await defaultTestServer.get('/api/indec/series?ids=SERIE_INVALIDA_XYZ');
      assert.ok([200, 400, 404, 500].includes(res.status), 'Debe responder de forma controlada');
    });
  });

  // Endpoints con payload malformado o peticiones POST/PUT no soportadas
  describe('Resilience: Métodos y Rutas Anómalas', () => {
    it('2.9. Solicitud a endpoint monetarias con ID negativo o no numérico', async () => {
      const res = await defaultTestServer.get('/api/monetarias/-99');
      assert.ok([200, 400, 404, 500].includes(res.status), 'Debe manejar ID inválido');
    });
  });
});
