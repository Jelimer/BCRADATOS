/**
 * tests/adversarial-challenger-m1-2.js
 * Arnés de verificación empírica y estrés adversarial para challenger_m1_2.
 * 
 * Verificaciones:
 * 1. Resiliencia de Central de Deudores ante CUITs malformados, inyecciones y caracteres espurios.
 * 2. Normalización de HTTP 404 simulado del BCRA (sin deuda previa) a HTTP 200 con estructura crediticia limpia.
 * 3. Contingencia 24/7 ante fallos simulados del BCRA (502, 429, 503, timeout, desconexión de socket).
 * 4. Ráfagas concurrentes (50 y 100 peticiones en caché y en bypass nocache) evaluando latencias (min, avg, p95, max), memoria y estabilidad.
 * 5. Verificación de salud y estabilidad de API post-estrés.
 */

const assert = require('node:assert/strict');
const http = require('node:http');
const { TestServer } = require('./helpers/setup');
const httpClient = require('../services/httpClient');
const { cacheService } = require('../services/cacheService');

const results = [];

function recordTest(suite, name, passed, details) {
  results.push({ suite, name, passed, details });
  const mark = passed ? 'PASS' : 'FAIL';
  console.log(`[${mark}] ${suite} :: ${name}`);
  if (details) {
    console.log(`       Detalle: ${details}`);
  }
}

async function run() {
  console.log('='.repeat(80));
  console.log('EMERGING ADVERSARIAL HARNESS — challenger_m1_2 (M1_BACKEND_RESILIENCE)');
  console.log('='.repeat(80));

  const testServer = new TestServer();
  await testServer.start();
  console.log(`Servidor de pruebas inicializado en ${testServer.baseUrl}`);

  const originalRequest = httpClient.request;

  try {
    // =========================================================================
    // 1. CUITS MALFORMADOS, CARACTERES ESPURIOS E INYECCIONES
    // =========================================================================
    console.log('\n--- 1. CUITs Malformados, Caracteres Espurios e Inyecciones ---');

    const malformedCases = [
      {
        desc: 'CUIT con emojis (20300000001🚀)',
        url: '/api/bcra-deudores/Deudas/20300000001%F0%9F%9A%80',
        expectedStatus: 400
      },
      {
        desc: 'CUIT con caracteres alfabéticos (20ABC000001)',
        url: '/api/bcra-deudores/Deudas/20ABC000001',
        expectedStatus: 400
      },
      {
        desc: 'CUIT con símbolos no permitidos (20$30@00!01)',
        url: '/api/bcra-deudores/Deudas/20$30@00!01',
        expectedStatus: 400
      },
      {
        desc: 'Inyección SQL en CUIT (20\' OR 1=1--)',
        url: '/api/bcra-deudores/Deudas/20%27%20OR%201=1--',
        expectedStatus: 400
      },
      {
        desc: 'Inyección XSS en CUIT (<script>alert(1)</script>)',
        url: '/api/bcra-deudores/Deudas/%3Cscript%3Ealert(1)%3C%2Fscript%3E',
        expectedStatus: 400
      },
      {
        desc: 'Cheques Rechazados con CUIT alfabético (20XYZ000001)',
        url: '/api/bcra-deudores/Deudas/ChequesRechazados/20XYZ000001',
        expectedStatus: 400
      },
      {
        desc: 'CUIT con longitud inválida corta (12345)',
        url: '/api/bcra-deudores/Deudas/12345',
        expectedStatus: 400
      },
      {
        desc: 'CUIT con longitud inválida extremadamente larga (203000000019999999)',
        url: '/api/bcra-deudores/Deudas/203000000019999999',
        expectedStatus: 400
      }
    ];

    for (const testCase of malformedCases) {
      cacheService.clear();
      const res = await testServer.get(testCase.url);
      const passed = res.status === testCase.expectedStatus && res.data && res.data.error === true;
      const details = `Status: ${res.status} (esperado ${testCase.expectedStatus}), Error: ${res.data?.error}, Msg: ${res.data?.message}`;
      recordTest('1. Malformed CUITs', testCase.desc, passed, details);
    }

    // Caso de CUIT con guiones o espacios estándar ("20-30000000-1" o "20 30000000 1")
    {
      cacheService.clear();
      const res = await testServer.get('/api/bcra-deudores/Deudas/20-30000000-1?nocache=true');
      const passed = [200, 400, 404, 502].includes(res.status) && res.status !== 500;
      const details = `Status: ${res.status}, Sanitizado sin 500 no capturado`;
      recordTest('1. Malformed CUITs', 'CUIT con guiones estándar (20-30000000-1) manejado sin 500', passed, details);
    }

    // =========================================================================
    // 2. SIMULACIÓN DE 404 UPSTREAM (CUIT SIN ANTECEDENTES NI DEUDA)
    // =========================================================================
    console.log('\n--- 2. Simulación de 404 Upstream (Sin deuda registrada) ---');

    // 2.1 Deudas con 404 simulado
    httpClient.request = async (config) => {
      const error = new Error('Request failed with status code 404');
      error.response = {
        status: 404,
        data: { status: 404, errorMessages: ['No se encontraron datos'] }
      };
      throw error;
    };

    {
      cacheService.clear();
      const res = await testServer.get('/api/bcra-deudores/Deudas/20300000001?nocache=true');
      const d = res.data;
      const passed = res.status === 200 &&
        d.status === 200 &&
        d.results &&
        d.results.tieneDeuda === false &&
        d.results.peorSituacion === 1 &&
        d.results.situacion === 1 &&
        d.results.totalDeuda === 0 &&
        Array.isArray(d.results.entidades) && d.results.entidades.length === 0 &&
        Array.isArray(d.results.chequesRechazados) && d.results.chequesRechazados.length === 0 &&
        d.isFallback === false;

      const details = `Status: ${res.status}, tieneDeuda: ${d.results?.tieneDeuda}, peorSituacion: ${d.results?.peorSituacion}, totalDeuda: ${d.results?.totalDeuda}, isFallback: ${d.isFallback}`;
      recordTest('2. 404 Upstream Normalization', 'Deudas con upstream 404 debe entregar 200 con estructura crediticia limpia', passed, details);
    }

    // 2.2 Cheques Rechazados con 404 simulado
    {
      cacheService.clear();
      const res = await testServer.get('/api/bcra-deudores/Deudas/ChequesRechazados/20300000001?nocache=true');
      const d = res.data;
      const passed = res.status === 200 &&
        d.status === 200 &&
        d.results &&
        d.results.tieneChequesRechazados === false &&
        Array.isArray(d.results.chequesRechazados) && d.results.chequesRechazados.length === 0 &&
        d.isFallback === false;

      const details = `Status: ${res.status}, tieneChequesRechazados: ${d.results?.tieneChequesRechazados}, chequesRechazados: len(${d.results?.chequesRechazados?.length}), isFallback: ${d.isFallback}`;
      recordTest('2. 404 Upstream Normalization', 'ChequesRechazados con upstream 404 debe entregar 200 con sin cheques', passed, details);
    }

    // =========================================================================
    // 3. SIMULACIÓN DE FALLAS UPSTREAM DEL BCRA (502, 429, 503, TIMEOUT, SOCKET)
    // =========================================================================
    console.log('\n--- 3. Simulación de Fallas Upstream del BCRA (502, 429, 503, Timeout, Socket) ---');

    // 3.1 502 Bad Gateway
    httpClient.request = async (config) => {
      const error = new Error('Request failed with status code 502');
      error.response = { status: 502, data: { errorMessages: ['Bad Gateway'] } };
      throw error;
    };

    {
      cacheService.clear();
      const res = await testServer.get('/api/bcra-deudores/Deudas/20300000001?nocache=true');
      const d = res.data;
      const passed = res.status === 200 &&
        d.status === 200 &&
        d.isFallback === true &&
        d.results?.tieneDeuda === false &&
        d.results?.peorSituacion === 1;

      const details = `Status: ${res.status}, isFallback: ${d.isFallback}, tieneDeuda: ${d.results?.tieneDeuda}, peorSituacion: ${d.results?.peorSituacion}`;
      recordTest('3. Upstream Failures Simulation', '502 Bad Gateway simulado en Deudas entrega 200 con isFallback: true', passed, details);
    }

    // 3.2 429 Too Many Requests (Rate limiting upstream)
    httpClient.request = async (config) => {
      const error = new Error('Request failed with status code 429');
      error.response = { status: 429, data: { errorMessages: ['Too Many Requests'] } };
      throw error;
    };

    {
      cacheService.clear();
      const res = await testServer.get('/api/bcra-deudores/Deudas/20300000001?nocache=true');
      const d = res.data;
      const passed = res.status === 200 &&
        d.status === 200 &&
        d.isFallback === true &&
        d.results?.tieneDeuda === false;

      const details = `Status: ${res.status}, isFallback: ${d.isFallback}, tieneDeuda: ${d.results?.tieneDeuda}`;
      recordTest('3. Upstream Failures Simulation', '429 Rate Limit simulado en Deudas entrega 200 con isFallback: true', passed, details);
    }

    // 3.3 503 Service Unavailable
    httpClient.request = async (config) => {
      const error = new Error('Request failed with status code 503');
      error.response = { status: 503, data: { errorMessages: ['Service Unavailable'] } };
      throw error;
    };

    {
      cacheService.clear();
      const res = await testServer.get('/api/bcra-deudores/Deudas/20300000001?nocache=true');
      const d = res.data;
      const passed = res.status === 200 &&
        d.status === 200 &&
        d.isFallback === true &&
        d.results?.tieneDeuda === false;

      const details = `Status: ${res.status}, isFallback: ${d.isFallback}, tieneDeuda: ${d.results?.tieneDeuda}`;
      recordTest('3. Upstream Failures Simulation', '503 Service Unavailable simulado entrega 200 con isFallback: true', passed, details);
    }

    // 3.4 Socket Timeout (ETIMEDOUT)
    httpClient.request = async (config) => {
      const error = new Error('timeout of 15000ms exceeded');
      error.code = 'ETIMEDOUT';
      throw error;
    };

    {
      cacheService.clear();
      const res = await testServer.get('/api/bcra-deudores/Deudas/20300000001?nocache=true');
      const d = res.data;
      const passed = res.status === 200 &&
        d.status === 200 &&
        d.isFallback === true &&
        d.results?.tieneDeuda === false;

      const details = `Status: ${res.status}, isFallback: ${d.isFallback}, tieneDeuda: ${d.results?.tieneDeuda}`;
      recordTest('3. Upstream Failures Simulation', 'ETIMEDOUT simulado entrega 200 con isFallback: true', passed, details);
    }

    // 3.5 Cheques Rechazados ante fallo 502
    httpClient.request = async (config) => {
      const error = new Error('Request failed with status code 502');
      error.response = { status: 502, data: {} };
      throw error;
    };

    {
      cacheService.clear();
      const res = await testServer.get('/api/bcra-deudores/Deudas/ChequesRechazados/20300000001?nocache=true');
      const d = res.data;
      const passed = res.status === 200 &&
        d.status === 200 &&
        d.isFallback === true &&
        d.results?.tieneChequesRechazados === false &&
        Array.isArray(d.results?.chequesRechazados);

      const details = `Status: ${res.status}, isFallback: ${d.isFallback}, tieneCheques: ${d.results?.tieneChequesRechazados}`;
      recordTest('3. Upstream Failures Simulation', 'ChequesRechazados ante 502 entrega 200 con isFallback: true', passed, details);
    }

    // 3.6 Upstream 502 ante CUIT no estándar (ej. 5 dígitos) debe responder 400 controlado sin crashear
    httpClient.request = async (config) => {
      const error = new Error('Request failed with status code 502');
      error.response = { status: 502, data: {} };
      throw error;
    };

    {
      cacheService.clear();
      const res = await testServer.get('/api/bcra-deudores/Deudas/12345?nocache=true');
      const passed = res.status === 400 && res.data?.error === true;
      const details = `Status: ${res.status}, Error: ${res.data?.error}`;
      recordTest('3. Upstream Failures Simulation', 'Upstream 502 con CUIT no estándar retorna 400 controlado', passed, details);
    }

    // Restaurar httpClient.request original
    httpClient.request = originalRequest;

    // =========================================================================
    // 4. RÁFAGAS CONCURRENTES Y EVALUACIÓN DE ESTRÉS
    // =========================================================================
    console.log('\n--- 4. Ráfagas Concurrentes y Evaluación de Estrés ---');

    const memoryBefore = process.memoryUsage();

    // Helper para medir latencias de ráfagas
    async function executeBurst(concurrency, label, customEndpoints) {
      console.log(`Ejecutando ráfaga de ${concurrency} peticiones concurrentes (${label})...`);
      const endpoints = customEndpoints || [
        '/api/bcra-deudores/Deudas/20300000001',
        '/api/bcra-deudores/Deudas/ChequesRechazados/20300000001',
        '/api/bcra-deudores/Deudas/20-30000000-1',
        '/api/bcra-deudores/Deudas/20ABC000001',
        '/api/health'
      ];

      const promises = [];
      const latencies = [];
      const statuses = {};

      const start = performance.now();

      for (let i = 0; i < concurrency; i++) {
        const url = endpoints[i % endpoints.length];
        const reqStart = performance.now();
        promises.push(
          testServer.get(url).then(res => {
            const reqDuration = performance.now() - reqStart;
            latencies.push(reqDuration);
            statuses[res.status] = (statuses[res.status] || 0) + 1;
            return res;
          })
        );
      }

      const results = await Promise.all(promises);
      const totalDuration = performance.now() - start;

      latencies.sort((a, b) => a - b);
      const min = latencies[0].toFixed(2);
      const max = latencies[latencies.length - 1].toFixed(2);
      const avg = (latencies.reduce((a, b) => a + b, 0) / latencies.length).toFixed(2);
      const p50 = latencies[Math.floor(latencies.length * 0.50)].toFixed(2);
      const p95 = latencies[Math.floor(latencies.length * 0.95)].toFixed(2);

      const has500 = Object.keys(statuses).some(s => Number(s) >= 500);

      console.log(`   Resultados Ráfaga (${concurrency} reqs):`);
      console.log(`     Duración total: ${totalDuration.toFixed(2)} ms`);
      console.log(`     Latencia min: ${min} ms, avg: ${avg} ms, p50: ${p50} ms, p95: ${p95} ms, max: ${max} ms`);
      console.log(`     Distribución status:`, JSON.stringify(statuses));

      return {
        concurrency,
        totalDuration,
        min,
        avg,
        p50,
        p95,
        max,
        statuses,
        has500
      };
    }

    // 4.1 Ráfaga de 50 peticiones
    const burst50 = await executeBurst(50, 'Burst 50 concurrente mixto');
    const passed50 = !burst50.has500 && (burst50.statuses[200] || 0) > 0;
    recordTest('4. Concurrency & Stress', 'Ráfaga de 50 peticiones concurrentes completada sin errores 500', passed50,
      `Min: ${burst50.min}ms, Avg: ${burst50.avg}ms, p95: ${burst50.p95}ms, Max: ${burst50.max}ms`);

    // 4.2 Ráfaga de 100 peticiones
    const burst100 = await executeBurst(100, 'Burst 100 concurrente mixto');
    const passed100 = !burst100.has500 && (burst100.statuses[200] || 0) > 0;
    recordTest('4. Concurrency & Stress', 'Ráfaga de 100 peticiones concurrentes completada sin errores 500', passed100,
      `Min: ${burst100.min}ms, Avg: ${burst100.avg}ms, p95: ${burst100.p95}ms, Max: ${burst100.max}ms`);

    // 4.3 Ráfaga de 50 peticiones con upstream simulado fallando (502) y nocache=true para estresar fallback dinámico
    httpClient.request = async (config) => {
      const err = new Error('502 Bad Gateway Simulado');
      err.response = { status: 502, data: {} };
      throw err;
    };

    const uniqueEndpointsNocache = Array.from({ length: 50 }, (_, i) => 
      `/api/bcra-deudores/Deudas/203000000${String(i).padStart(2, '0')}?nocache=true`
    );

    const burstFallback = await executeBurst(50, 'Burst 50 concurrente 502 con nocache', uniqueEndpointsNocache);
    const passedBurstFallback = !burstFallback.has500 && burstFallback.statuses[200] === 50;
    recordTest('4. Concurrency & Stress', 'Ráfaga de 50 peticiones concurrentes con upstream 502 entrega 100% 200 fallback', passedBurstFallback,
      `200s: ${burstFallback.statuses[200]}/50, Min: ${burstFallback.min}ms, Avg: ${burstFallback.avg}ms, Max: ${burstFallback.max}ms`);

    httpClient.request = originalRequest;

    // =========================================================================
    // 5. SALUD Y MEMORIA POST-ESTRÉS
    // =========================================================================
    console.log('\n--- 5. Salud y Estabilidad Post-Estrés ---');

    const memoryAfter = process.memoryUsage();
    const heapDiffMb = ((memoryAfter.heapUsed - memoryBefore.heapUsed) / (1024 * 1024)).toFixed(2);

    // Verificación de endpoint de healthcheck JSON
    const healthRes = await testServer.get('/api/health');
    const isHealthOk = healthRes.status === 200 && healthRes.data?.status === 'ok' && typeof healthRes.data?.uptimeSeconds === 'number';

    // Verificación de SPA fallback ante rutas inexistentes
    const spaRes = await testServer.get('/ruta-inexistente-spa');
    const isSpaOk = spaRes.status === 200 && typeof spaRes.data === 'string' && spaRes.data.includes('Portal Financiero Argentino');

    // Verificación de salud funcional de API de mercado / bonos
    const apiRes = await testServer.get('/api/byma/panel/public-bonds');
    const isApiHealthy = apiRes.status === 200 && apiRes.data && Array.isArray(apiRes.data.data);

    const isSystemHealthy = isHealthOk && isSpaOk && isApiHealthy;

    recordTest('5. Post-Stress Health', 'Infraestructura HTTP y API proxy 100% operativas tras ráfagas', isSystemHealthy,
      `Health Status: ${healthRes.data?.status}, SPA Fallback: 200, API BYMA Bonos: ${apiRes.data?.data?.length} items, Heap Delta: ${heapDiffMb} MB`);

    // =========================================================================
    // RESUMEN
    // =========================================================================
    console.log('\n' + '='.repeat(80));
    console.log('RESUMEN DE PRUEBAS ADVERSARIALES EMPÍRICAS');
    console.log('='.repeat(80));

    const total = results.length;
    const passed = results.filter(r => r.passed).length;
    const failed = total - passed;

    console.log(`Total Pruebas: ${total}`);
    console.log(`Aprobadas:     ${passed}`);
    console.log(`Falladas:      ${failed}`);
    console.log(`Porcentaje:    ${((passed / total) * 100).toFixed(1)}%`);

    if (failed > 0) {
      console.error(`\n❌ VEREDICTO PRELIMINAR: REJECT (${failed} fallos detectados)`);
      process.exitCode = 1;
    } else {
      console.log(`\n✅ VEREDICTO PRELIMINAR: APPROVE (100% aprobado)`);
    }

  } finally {
    httpClient.request = originalRequest;
    await testServer.stop();
  }
}

run().catch(err => {
  console.error('Error fatal durante ejecución de arnés adversarial:', err);
  process.exit(1);
});
