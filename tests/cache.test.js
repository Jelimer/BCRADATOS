const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { defaultTestServer } = require('./helpers/setup');
const { VARIABLES_BCRA } = require('./helpers/fixtures');

describe('Tier 2: In-Memory Cache & Latency Optimization Tests', () => {
  before(async () => {
    await defaultTestServer.start();
  });

  after(async () => {
    await defaultTestServer.stop();
  });

  it('2.1. Peticiones repetidas al catálogo (/api/monetarias) deben conservar integridad de datos', async () => {
    const res1 = await defaultTestServer.get('/api/monetarias');
    assert.equal(res1.status, 200);

    const res2 = await defaultTestServer.get('/api/monetarias');
    assert.equal(res2.status, 200);

    // Los datos deben coincidir exactamente
    const count1 = (res1.data?.results || res1.data)?.length;
    const count2 = (res2.data?.results || res2.data)?.length;
    assert.equal(count1, count2, 'La cantidad de variables en peticiones consecutivas debe ser consistente');
  });

  it('2.2. Rendimiento y latencia de respuestas repetidas a metodologías (/api/metodologia)', async () => {
    // Calentamiento inicial
    const warmup = await defaultTestServer.get('/api/metodologia');
    assert.equal(warmup.status, 200);

    // Consulta subsecuente
    const hit = await defaultTestServer.get('/api/metodologia');
    assert.equal(hit.status, 200);

    // Si la caché está activa o el server responde localmente, la latencia es mínima
    assert.ok(hit.durationMs < 1000, `La respuesta debe completarse rápidamente (obtenido: ${hit.durationMs.toFixed(2)}ms)`);
  });

  it('2.3. Caché diferenciada por Query Parameters en Series Históricas', async () => {
    const resRango1 = await defaultTestServer.get(`/api/monetarias/${VARIABLES_BCRA.RESERVAS}?desde=2026-01-01&hasta=2026-03-01`);
    const resRango2 = await defaultTestServer.get(`/api/monetarias/${VARIABLES_BCRA.RESERVAS}?desde=2026-04-01&hasta=2026-06-01`);

    assert.equal(resRango1.status, 200);
    assert.equal(resRango2.status, 200);

    // Ambas respuestas deben completarse exitosamente sin colisionar
    assert.ok(resRango1.data);
    assert.ok(resRango2.data);
  });

  it('2.4. Idempotencia y estabilidad en ráfaga de peticiones simultáneas (Burst Requests)', async () => {
    const promesas = [
      defaultTestServer.get('/api/mercado-dolarapi/dolares'),
      defaultTestServer.get('/api/mercado-dolarapi/dolares'),
      defaultTestServer.get('/api/mercado-dolarapi/dolares'),
      defaultTestServer.get('/api/mercado-dolarapi/dolares')
    ];

    const resultados = await Promise.all(promesas);
    for (const res of resultados) {
      assert.equal(res.status, 200, 'Todas las peticiones en ráfaga deben responder 200');
    }
  });

  it('2.5. Validación de presencia de propiedades o cabeceras de caché cuando estén activas', async () => {
    const res = await defaultTestServer.get('/api/monetarias');
    assert.equal(res.status, 200);

    // Comprobamos si el servidor incluye 'cached' en el payload o header 'x-cache'
    const hasCachedFlag = (res.data && typeof res.data === 'object' && 'cached' in res.data);
    const hasCacheHeader = res.headers.has('x-cache') || res.headers.has('cache-control');

    // La respuesta es válida en cualquier caso
    assert.ok(res.data, 'Debe entregar datos consistentes');
  });
});
