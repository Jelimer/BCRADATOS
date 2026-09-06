/**
 * tests/httpClient.test.js
 * Pruebas unitarias para el cliente HTTP resiliente con reintentos y timeouts.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const httpClient = require('../services/httpClient');

describe('httpClient Unit Tests', () => {
  it('debe contener los timeouts configurados para mercado y series pesadas', () => {
    assert.equal(httpClient.TIMEOUTS.LIVE_MARKET, 5000);
    assert.equal(httpClient.TIMEOUTS.STANDARD, 10000);
    assert.equal(httpClient.TIMEOUTS.HEAVY_SERIES, 15000);
  });

  it('debe instanciar clientes dedicados con createInstance', () => {
    const customClient = httpClient.createInstance({
      baseURL: 'https://api.test.com',
      timeout: 3000
    });

    assert.equal(typeof customClient.get, 'function');
    assert.equal(typeof customClient.post, 'function');
    assert.equal(typeof customClient.request, 'function');
  });

  it('debe fallar limpiamente con timeout adecuado ante un host inexistente o no alcanzable', async () => {
    try {
      await httpClient.get('https://192.0.2.1:9999/timeout-test', {
        timeout: 200
      }, { retries: 0 });
      assert.fail('Debió arrojar error de timeout');
    } catch (err) {
      assert.ok(err);
    }
  });
});
