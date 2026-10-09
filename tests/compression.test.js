const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const zlib = require('node:zlib');
const { defaultTestServer } = require('./helpers/setup');

/**
 * Realiza una solicitud HTTP directa para inspeccionar con fidelidad binaria
 * las cabeceras de transporte (Content-Encoding, Content-Length) y los buffers crudos.
 * @param {string} baseUrl
 * @param {string} path
 * @param {Record<string, string>} headers
 * @returns {Promise<{ statusCode: number, headers: http.IncomingHttpHeaders, rawBuffer: Buffer, contentEncoding: string|undefined }>}
 */
function requestRaw(baseUrl, path, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const req = http.request(url, {
      method: 'GET',
      headers: {
        'Accept': '*/*',
        ...headers
      }
    }, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const rawBuffer = Buffer.concat(chunks);
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          rawBuffer,
          contentEncoding: res.headers['content-encoding']
        });
      });
    });

    req.on('error', reject);
    req.end();
  });
}

describe('Tier 3: HTTP Compression Middleware Tests (Gzip/Deflate)', () => {
  before(async () => {
    await defaultTestServer.start();
  });

  after(async () => {
    await defaultTestServer.stop();
  });

  it('3.1. Respuestas mayores a 1.024 bytes con Accept-Encoding: gzip deben comprimirse con gzip', async () => {
    // Solicitud a la SPA raíz (index.html es > 70KB)
    const res = await requestRaw(defaultTestServer.baseUrl, '/', {
      'Accept-Encoding': 'gzip'
    });

    assert.equal(res.statusCode, 200, 'Debe responder HTTP 200');
    assert.equal(res.contentEncoding, 'gzip', 'La cabecera Content-Encoding debe ser gzip');
    assert.ok(res.rawBuffer.length > 0, 'El cuerpo comprimido no debe estar vacío');

    // Descomprimir el buffer y verificar que sea HTML válido
    const decompressed = zlib.gunzipSync(res.rawBuffer).toString('utf-8');
    assert.ok(decompressed.toLowerCase().includes('<!doctype html>'), 'El contenido descomprimido debe ser el HTML original');
    assert.ok(
      res.rawBuffer.length < decompressed.length,
      `El payload comprimido (${res.rawBuffer.length} B) debe ser significativamente menor al original (${decompressed.length} B)`
    );
  });

  it('3.2. Archivos estáticos grandes (/style.css) con Accept-Encoding: gzip deben comprimirse', async () => {
    const res = await requestRaw(defaultTestServer.baseUrl, '/style.css', {
      'Accept-Encoding': 'gzip'
    });

    assert.equal(res.statusCode, 200);
    assert.equal(res.contentEncoding, 'gzip');

    const decompressed = zlib.gunzipSync(res.rawBuffer).toString('utf-8');
    assert.ok(decompressed.length > 1024, 'El archivo CSS original debe superar 1KB');
    assert.ok(res.rawBuffer.length < decompressed.length, 'La compresión debe reducir el tamaño en bytes');
  });

  it('3.3. Respuestas menores a 1.024 bytes (/api/health) NO deben comprimirse aunque se solicite gzip', async () => {
    const res = await requestRaw(defaultTestServer.baseUrl, '/api/health', {
      'Accept-Encoding': 'gzip'
    });

    assert.equal(res.statusCode, 200);
    assert.equal(res.contentEncoding, undefined, 'No debe comprimirse payloads por debajo del umbral de 1.024 bytes');

    // Debe ser un JSON plano legible directamente sin descompresión
    const json = JSON.parse(res.rawBuffer.toString('utf-8'));
    assert.equal(json.status, 'ok');
  });

  it('3.4. Cabecera x-no-compression: true debe inhibir la compresión incluso para payloads > 1.024 bytes', async () => {
    const res = await requestRaw(defaultTestServer.baseUrl, '/', {
      'Accept-Encoding': 'gzip',
      'x-no-compression': 'true'
    });

    assert.equal(res.statusCode, 200);
    assert.equal(
      res.contentEncoding,
      undefined,
      'La presencia de x-no-compression debe desactivar la compresión HTTP'
    );

    // Debe ser directamente el HTML sin comprimir
    const body = res.rawBuffer.toString('utf-8');
    assert.ok(body.toLowerCase().includes('<!doctype html>'), 'Debe entregarse en texto plano sin comprimir');
  });

  it('3.5. Solicitudes sin cabecera Accept-Encoding deben recibir el contenido en texto plano', async () => {
    const res = await requestRaw(defaultTestServer.baseUrl, '/');

    assert.equal(res.statusCode, 200);
    assert.equal(res.contentEncoding, undefined, 'Sin Accept-Encoding no debe aplicarse compresión');
    const body = res.rawBuffer.toString('utf-8');
    assert.ok(body.toLowerCase().includes('<!doctype html>'));
  });

  it('3.6. Soporte de compresión Deflate para clientes que solicitan Accept-Encoding: deflate', async () => {
    const res = await requestRaw(defaultTestServer.baseUrl, '/', {
      'Accept-Encoding': 'deflate'
    });

    assert.equal(res.statusCode, 200);
    assert.equal(res.contentEncoding, 'deflate', 'Debe soportar compresión deflate');

    const decompressed = zlib.inflateSync(res.rawBuffer).toString('utf-8');
    assert.ok(decompressed.toLowerCase().includes('<!doctype html>'));
    assert.ok(res.rawBuffer.length < decompressed.length);
  });
});
