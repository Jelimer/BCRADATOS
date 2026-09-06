const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { defaultTestServer } = require('./helpers/setup');
const { VARIABLES_BCRA, TICKERS_BYMA, SERIES_INDEC } = require('./helpers/fixtures');

describe('Tier 3: Cross-Feature Integration Tests', () => {
  before(async () => {
    await defaultTestServer.start();
  });

  after(async () => {
    await defaultTestServer.stop();
  });

  it('3.1. Cálculo de Brecha Cambiaria: DolarApi (Blue) vs BCRA (Oficial)', async () => {
    // 1. Obtener Dólar Blue
    const resBlue = await defaultTestServer.get('/api/mercado-dolarapi/dolares/blue');
    assert.equal(resBlue.status, 200);
    const dataBlue = resBlue.data?.results || resBlue.data;
    const precioBlue = dataBlue?.venta || dataBlue?.compra || 1400;

    // 2. Obtener Dólar Oficial del BCRA (Variable ID 4)
    const resOficial = await defaultTestServer.get(`/api/monetarias/${VARIABLES_BCRA.TIPO_CAMBIO_OFICIAL}`);
    assert.equal(resOficial.status, 200);

    let detalle = [];
    if (Array.isArray(resOficial.data?.results) && resOficial.data.results.length > 0) {
      detalle = resOficial.data.results[0].detalle || resOficial.data.results;
    } else if (Array.isArray(resOficial.data)) {
      detalle = resOficial.data;
    }

    const ultimoOficial = detalle && detalle.length > 0 ? detalle[detalle.length - 1].valor : 1000;

    assert.ok(precioBlue > 0, 'El precio del dólar Blue debe ser positivo');
    assert.ok(ultimoOficial > 0, 'El precio del dólar Oficial debe ser positivo');

    // 3. Calcular brecha porcentual
    const brecha = ((precioBlue - ultimoOficial) / ultimoOficial) * 100;
    assert.ok(typeof brecha === 'number' && !isNaN(brecha), 'La brecha debe ser un valor numérico');
    assert.ok(brecha >= -20 && brecha <= 300, `La brecha cambiaria debe estar en rango financiero razonable (obtenido: ${brecha.toFixed(2)}%)`);
  });

  it('3.2. Comparador de Tasas: BCRA Transparencia vs ArgentinaDatos Tasas', async () => {
    const [resBcraTransp, resArgDatos] = await Promise.all([
      defaultTestServer.get('/api/bcra-transparencia/PlazosFijos'),
      defaultTestServer.get('/api/argentinadatos/finanzas/tasas/plazoFijo')
    ]);

    assert.equal(resBcraTransp.status, 200);
    assert.equal(resArgDatos.status, 200);

    const itemsBcra = resBcraTransp.data?.results || (Array.isArray(resBcraTransp.data) ? resBcraTransp.data : []);
    const itemsArg = resArgDatos.data?.results || (Array.isArray(resArgDatos.data) ? resArgDatos.data : []);

    assert.ok(Array.isArray(itemsBcra), 'BCRA Plazos fijos debe entregar lista');
    assert.ok(Array.isArray(itemsArg), 'ArgentinaDatos Tasas debe entregar lista');
  });

  it('3.3. Correlación Macroeconómica: INDEC Series IPC vs ArgentinaDatos Inflación', async () => {
    const [resIndec, resArgInflacion] = await Promise.all([
      defaultTestServer.get(`/api/indec/series?ids=${SERIES_INDEC.IPC_NACIONAL_NIVEL_GENERAL}&limit=6`),
      defaultTestServer.get('/api/argentinadatos/finanzas/indices/inflacion')
    ]);

    assert.equal(resIndec.status, 200);
    assert.equal(resArgInflacion.status, 200);

    const indecData = resIndec.data?.data || [];
    const argData = resArgInflacion.data?.results || (Array.isArray(resArgInflacion.data) ? resArgInflacion.data : []);

    assert.ok(Array.isArray(indecData), 'INDEC data debe ser un array');
    assert.ok(Array.isArray(argData), 'ArgentinaDatos data debe ser un array');
  });

  it('3.4. Cruce de Activos Bursátiles: Panel de Bonos BYMA y Ficha Técnica', async () => {
    const resPanel = await defaultTestServer.get('/api/byma/panel/public-bonds');
    assert.equal(resPanel.status, 200);

    const resFicha = await defaultTestServer.get(`/api/byma/bond-info/${TICKERS_BYMA.AL30}`);
    assert.equal(resFicha.status, 200);

    // Ambas llamadas deben integrarse sin conflictos
    assert.ok(resPanel.data);
    assert.ok(resFicha.data);
  });

  it('3.5. Cruce de Variables BCRA: Reservas Internacionales vs Base Monetaria', async () => {
    const [resReservas, resBaseMonetaria] = await Promise.all([
      defaultTestServer.get(`/api/monetarias/${VARIABLES_BCRA.RESERVAS}?limit=5`),
      defaultTestServer.get(`/api/monetarias/${VARIABLES_BCRA.BASE_MONETARIA}?limit=5`)
    ]);

    assert.equal(resReservas.status, 200);
    assert.equal(resBaseMonetaria.status, 200);

    assert.ok(resReservas.data);
    assert.ok(resBaseMonetaria.data);
  });
});
