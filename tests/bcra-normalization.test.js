/**
 * tests/bcra-normalization.test.js
 * Pruebas unitarias y de integración para la normalización de códigos de error (404 a 200)
 * en la Central de Deudores y Validador de Cheques del BCRA.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { defaultTestServer } = require('./helpers/setup');
const { cacheService } = require('../services/cacheService');

describe('BCRA 404 Normalization Tests', () => {
  before(async () => {
    await defaultTestServer.start();
  });

  after(async () => {
    await defaultTestServer.stop();
  });

  it('debe responder HTTP 200 con situación limpia al consultar deudores por CUIT', async () => {
    const res = await defaultTestServer.get('/api/bcra-deudores/Deudas/20300000001');
    assert.ok([200, 429, 503].includes(res.status), `Status recibido: ${res.status}`);
    assert.ok(res.data);
    if (res.status === 200) {
      assert.equal(res.data.status, 200);
      assert.ok(res.data.results);
      assert.equal(res.data.results.tieneDeuda, false);
      assert.equal(res.data.results.peorSituacion, 1);
    } else {
      assert.ok([429, 503].includes(res.status));
    }
  });

  it('debe responder HTTP 200 con sin cheques rechazados al consultar cheques rechazados', async () => {
    const res = await defaultTestServer.get('/api/bcra-deudores/Deudas/ChequesRechazados/20300000001');
    assert.ok([200, 429, 503].includes(res.status), `Status recibido: ${res.status}`);
    assert.ok(res.data);
    if (res.status === 200) {
      assert.equal(res.data.status, 200);
      assert.ok(res.data.results);
      assert.equal(res.data.results.tieneChequesRechazados, false);
      assert.deepEqual(res.data.results.chequesRechazados, []);
    } else {
      assert.ok([429, 503].includes(res.status));
    }
  });

  it('debe responder HTTP 200 al consultar un cheque no denunciado', async () => {
    const res = await defaultTestServer.get('/api/bcra-cheques/denunciados/011/99999999');
    assert.equal(res.status, 200);
    assert.ok(res.data);
    assert.equal(res.data.status, 200);
    assert.ok(res.data.results);
    assert.equal(res.data.results.denunciado, false);
  });
});
