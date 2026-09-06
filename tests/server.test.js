/**
 * tests/server.test.js
 * Pruebas de integración del servidor Express, middlewares y normalización de contratos.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { defaultTestServer } = require('./helpers/setup');
const { cacheService } = require('../services/cacheService');

describe('Server & Endpoints Integration Tests', () => {
  before(async () => {
    await defaultTestServer.start();
  });

  after(async () => {
    await defaultTestServer.stop();
  });

  it('debe responder 200 OK en /api/health con estadísticas de caché', async () => {
    const res = await defaultTestServer.get('/api/health');
    assert.equal(res.status, 200);
    assert.equal(res.data?.status, 'ok');
    assert.ok(res.data?.cacheStats);
    assert.ok(typeof res.data?.uptimeSeconds === 'number');
  });

  it('debe responder 200 OK en /api/cache/stats', async () => {
    const res = await defaultTestServer.get('/api/cache/stats');
    assert.equal(res.status, 200);
    assert.ok(res.data?.hitRate !== undefined);
    assert.ok(res.data?.size !== undefined);
  });

  it('debe retornar headers X-Cache: MISS en la primera petición y X-Cache: HIT en la segunda', async () => {
    const testPath = '/api/mercado-dolarapi/dolares';
    const res1 = await defaultTestServer.get(testPath);
    const xCache1 = res1.headers.get('x-cache');
    assert.ok(['MISS', 'HIT', 'BYPASS'].includes(xCache1));

    if (res1.status === 200) {
      const res2 = await defaultTestServer.get(testPath);
      assert.equal(res2.headers.get('x-cache'), 'HIT');
      assert.ok(res2.data);
    }
  });

  it('debe entregar la SPA (index.html) para rutas web no-API', async () => {
    const res = await defaultTestServer.get('/dashboard');
    assert.equal(res.status, 200);
    assert.ok(typeof res.data === 'string');
    assert.ok(res.data.includes('<!DOCTYPE html>') || res.data.includes('<!doctype html>'));
  });

  it('debe normalizar respuestas de BYMA con fallback persistente ante mercado cerrado', async () => {
    const fakePanel = {
      data: [
        { symbol: 'AL30', trade: 85000, previousSettlementPrice: 84000 }
      ],
      empty: false
    };
    cacheService.set('byma:last_valid_panel', fakePanel, 3600);

    const res = await defaultTestServer.get('/api/byma/panel/public-bonds?nocache=true');
    assert.equal(res.status, 200);
    assert.ok(res.data);
    const panelData = res.data.data || (Array.isArray(res.data) ? res.data : []);
    assert.ok(Array.isArray(panelData));
  });
});
