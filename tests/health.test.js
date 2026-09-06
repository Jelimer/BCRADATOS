const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { defaultTestServer } = require('./helpers/setup');

describe('Tier 1: Health & Static Infrastructure Tests', () => {
  before(async () => {
    await defaultTestServer.start();
  });

  after(async () => {
    await defaultTestServer.stop();
  });

  it('1.1. Servidor Express arranca y responde en puerto efímero', async () => {
    assert.ok(defaultTestServer.port > 0, 'El puerto debe ser mayor a 0');
    assert.match(defaultTestServer.baseUrl, /^http:\/\/127\.0\.0\.1:\d+$/, 'La URL base debe ser local');
  });

  it('1.2. Entrega del archivo principal SPA (public/index.html)', async () => {
    const res = await defaultTestServer.get('/');
    assert.equal(res.status, 200, 'El endpoint raíz debe responder HTTP 200');
    assert.ok(typeof res.data === 'string', 'La respuesta debe ser texto HTML');
    assert.ok(res.data.toLowerCase().includes('<!doctype html>'), 'Debe contener la declaración doctype');
    assert.ok(
      res.data.includes('BCRA') || res.data.includes('Financiero') || res.data.includes('Dashboard'),
      'Debe contener elementos del Portal Financiero'
    );
  });

  it('1.3. Entrega de hoja de estilos (public/style.css)', async () => {
    const res = await defaultTestServer.get('/style.css');
    assert.equal(res.status, 200, 'style.css debe responder HTTP 200');
    assert.ok(typeof res.data === 'string', 'El contenido de CSS debe ser texto');
    assert.ok(res.data.length > 50, 'El archivo CSS no debe estar vacío');
  });

  it('1.4. Entrega del script cliente SPA (public/app.js)', async () => {
    const res = await defaultTestServer.get('/app.js');
    assert.equal(res.status, 200, 'app.js debe responder HTTP 200');
    assert.ok(typeof res.data === 'string', 'El contenido de JS debe ser texto');
    assert.ok(res.data.length > 100, 'El archivo JS no debe estar vacío');
  });

  it('1.5. Configuración de middleware CORS en cabeceras de respuesta', async () => {
    const res = await defaultTestServer.get('/');
    const allowOrigin = res.headers.get('access-control-allow-origin');
    assert.ok(allowOrigin === '*' || allowOrigin !== null, 'Debe incluir cabecera CORS');
  });

  it('1.6. Redirección y fallback de rutas no existentes a la SPA (public/index.html)', async () => {
    const res = await defaultTestServer.get('/ruta-aleatoria-inexistente-spa');
    assert.equal(res.status, 200, 'Las rutas SPA no encontradas deben redirigir a index.html con 200');
    assert.ok(typeof res.data === 'string', 'Debe entregar el contenido HTML');
    assert.ok(res.data.toLowerCase().includes('<!doctype html>'), 'Debe retornar index.html');
  });

  it('1.7. Soporte para solicitudes JSON y validación de Content-Type', async () => {
    const res = await defaultTestServer.get('/api/monetarias');
    const contentType = res.headers.get('content-type') || '';
    assert.ok(contentType.includes('application/json'), 'Los endpoints de API deben devolver JSON');
  });
});
