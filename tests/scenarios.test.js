const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { defaultTestServer } = require('./helpers/setup');
const { CUITS, VARIABLES_BCRA, BANCOS_CHEQUES, SERIES_INDEC } = require('./helpers/fixtures');

describe('Tier 4: Real-World End-to-End Application Scenarios', () => {
  before(async () => {
    await defaultTestServer.start();
  });

  after(async () => {
    await defaultTestServer.stop();
  });

  // Escenario 1: Flujo completo de arranque y renderizado de Dashboard inicial
  it('4.1. Escenario 1: Arranque del cliente y carga concurrente del Dashboard Principal', async () => {
    // 1. Cliente descarga archivos del bundle SPA
    const [resHtml, resCss, resJs] = await Promise.all([
      defaultTestServer.get('/'),
      defaultTestServer.get('/style.css'),
      defaultTestServer.get('/app.js')
    ]);

    assert.equal(resHtml.status, 200, 'HTML principal cargado');
    assert.equal(resCss.status, 200, 'CSS cargado');
    assert.equal(resJs.status, 200, 'JS cargado');

    // 2. Cliente ejecuta las consultas de inicialización de paneles
    const [resMonetarias, resDolares, resBonos] = await Promise.all([
      defaultTestServer.get('/api/monetarias'),
      defaultTestServer.get('/api/mercado-dolarapi/dolares'),
      defaultTestServer.get('/api/byma/panel/public-bonds')
    ]);

    assert.equal(resMonetarias.status, 200, 'Catálogo monetario disponible');
    assert.equal(resDolares.status, 200, 'Cotizaciones de dólares disponibles');
    assert.equal(resBonos.status, 200, 'Panel de bonos disponible');

    // Verificar que los datos son suficientes para hidratar los KPIs
    const variables = resMonetarias.data?.results || (Array.isArray(resMonetarias.data) ? resMonetarias.data : []);
    assert.ok(variables.length > 0, 'Debe haber variables para alimentar los KPIs');
  });

  // Escenario 2: Exploración de Panel Macroeconómico e Inflación
  it('4.2. Escenario 2: Análisis Macroeconómico (INDEC IPC, EMAE y ArgentinaDatos UVA)', async () => {
    const [resIpc, resEmae, resUva] = await Promise.all([
      defaultTestServer.get(`/api/indec/series?ids=${SERIES_INDEC.IPC_NACIONAL_NIVEL_GENERAL}&limit=12`),
      defaultTestServer.get(`/api/indec/series?ids=${SERIES_INDEC.EMAE}&limit=12`),
      defaultTestServer.get('/api/argentinadatos/finanzas/indices/uva')
    ]);

    assert.equal(resIpc.status, 200, 'IPC INDEC OK');
    assert.equal(resEmae.status, 200, 'EMAE INDEC OK');
    assert.equal(resUva.status, 200, 'UVA OK');

    assert.ok(resIpc.data, 'Debe contener datos de IPC');
    assert.ok(resEmae.data, 'Debe contener datos de EMAE');
    assert.ok(resUva.data, 'Debe contener datos de UVA');
  });

  // Escenario 3: Consulta Integral de CUIT (Central de Deudores + Cheques)
  it('4.3. Escenario 3: Diagnóstico Crediticio Integral de CUIT', async () => {
    // 1. Consulta Central de Deudores
    const resDeuda = await defaultTestServer.get(`/api/bcra-deudores/Deudas/${CUITS.AFIP}`);
    assert.ok([200, 503].includes(resDeuda.status), 'Central de deudores responde 200 o 503 (mantenimiento)');

    // 2. Consulta Cheques Denunciados para la entidad Banco Nación (011)
    const resCheque = await defaultTestServer.get(`/api/bcra-cheques/denunciados/${BANCOS_CHEQUES.NACION}/99887766`);
    assert.equal(resCheque.status, 200, 'Cheques denunciados responde 200');

    // Verificar que ambas respuestas permiten armar la ficha de antecedentes del contribuyente
    assert.ok(resDeuda.data, 'Datos crediticios disponibles');
    assert.ok(resCheque.data, 'Datos de cheques disponibles');
  });

  // Escenario 4: Filtrado Cronológico y Consulta de Metodología de Serie
  it('4.4. Escenario 4: Inspección profunda de Variable Monetaria con Metodología y Rango', async () => {
    const varId = VARIABLES_BCRA.RESERVAS;
    const desde = '2026-01-01';
    const hasta = '2026-06-30';

    const [resSerie, resMetodologia] = await Promise.all([
      defaultTestServer.get(`/api/monetarias/${varId}?desde=${desde}&hasta=${hasta}`),
      defaultTestServer.get('/api/metodologia')
    ]);

    assert.equal(resSerie.status, 200, 'Serie histórica obtenida');
    assert.equal(resMetodologia.status, 200, 'Metodología obtenida');

    // Validación de que la serie y la nota técnica están disponibles para exportación/gráfico
    assert.ok(resSerie.data, 'La serie histórica no debe estar vacía');
    assert.ok(resMetodologia.data, 'La metodología no debe estar vacía');
  });

  // Escenario 5: Concurrencia Multi-pestaña
  it('4.5. Escenario 5: Concurrencia de Múltiples Pestañas en Paralelo', async () => {
    const pestanas = [
      defaultTestServer.get('/api/monetarias'),
      defaultTestServer.get('/api/bcra-cambiarias/Cotizaciones'),
      defaultTestServer.get('/api/bcra-transparencia/PlazosFijos'),
      defaultTestServer.get('/api/bcra-transparencia/PaquetesProductos'),
      defaultTestServer.get('/api/bcra-transparencia/Prestamos/Personales'),
      defaultTestServer.get('/api/mercado-dolarapi/dolares')
    ];

    const resultados = await Promise.all(pestanas);
    for (const [idx, res] of resultados.entries()) {
      assert.equal(res.status, 200, `La pestaña índice ${idx} debe responder HTTP 200 bajo concurrencia`);
      assert.ok(res.data, `La pestaña índice ${idx} debe tener contenido no vacío`);
    }
  });
});
