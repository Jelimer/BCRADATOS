const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { defaultTestServer } = require('./helpers/setup');

describe('Comparador de Préstamos Hipotecarios UVA (/api/transparencia/hipotecarios)', () => {
  before(async () => {
    await defaultTestServer.start();
  });

  after(async () => {
    await defaultTestServer.stop();
  });

  it('Debe responder HTTP 200 con la estructura oficial del comparador hipotecario', async () => {
    const res = await defaultTestServer.get('/api/transparencia/hipotecarios');
    assert.equal(res.status, 200, 'Debe responder status 200');
    assert.ok(res.data, 'Debe contener un cuerpo de respuesta');
    assert.equal(res.data.status, 200, 'El status interno debe ser 200');
    assert.ok(Array.isArray(res.data.results), 'results debe ser un arreglo');
    assert.ok(res.data.results.length >= 10, 'Debe incluir al menos 10 entidades bancarias activas');
    assert.ok(res.data.valorUvaReferencia > 1000, 'Debe incluir un valor de UVA de referencia realista');
  });

  it('Cada entidad bancaria debe poseer todos los campos financieros y requisitos exigidos', async () => {
    const res = await defaultTestServer.get('/api/transparencia/hipotecarios');
    const bancos = res.data.results;

    bancos.forEach(banco => {
      assert.ok(typeof banco.id === 'string' && banco.id.length > 0, 'Debe tener id');
      assert.ok(typeof banco.entidad === 'string' && banco.entidad.length > 0, 'Debe tener nombre de entidad');
      assert.ok(typeof banco.linea === 'string' && banco.linea.length > 0, 'Debe tener nombre de línea');
      assert.ok(typeof banco.tnaClientes === 'number' && banco.tnaClientes > 0 && banco.tnaClientes < 20, 'TNA Clientes debe ser un número coherente');
      assert.ok(typeof banco.tnaNoClientes === 'number' && banco.tnaNoClientes >= banco.tnaClientes, 'TNA No Clientes debe ser mayor o igual a clientes');
      assert.ok([20, 25, 30].includes(banco.plazoMaxAnos), 'Plazo máximo debe ser entre 20 y 30 años');
      assert.ok(banco.ltvMax >= 70 && banco.ltvMax <= 100, 'Financiación LTV debe estar entre 70% y 100%');
      assert.ok(banco.relacionCuotaIngreso >= 25 && banco.relacionCuotaIngreso <= 30, 'Relación cuota/ingreso debe ser del 25% al 30%');
      assert.ok(typeof banco.antiguedadDependencia === 'string', 'Debe detallar antigüedad laboral en relación de dependencia');
      assert.ok(typeof banco.codeudores === 'string', 'Debe detallar requisitos de codeudores');
      assert.ok(typeof banco.edadLimite === 'string', 'Debe detallar edad límite');
      assert.ok(typeof banco.destinos === 'string', 'Debe detallar destinos del crédito');
    });
  });

  it('Debe incluir bancos clave del sistema financiero argentino', async () => {
    const res = await defaultTestServer.get('/api/transparencia/hipotecarios');
    const bancos = res.data.results;
    const ids = bancos.map(b => b.id);

    assert.ok(ids.includes('bna'), 'Debe incluir Banco Nación');
    assert.ok(ids.includes('hipotecario'), 'Debe incluir Banco Hipotecario');
    assert.ok(ids.includes('ciudad'), 'Debe incluir Banco Ciudad');
    assert.ok(ids.includes('santander'), 'Debe incluir Banco Santander');
    assert.ok(ids.includes('galicia'), 'Debe incluir Banco Galicia');
    assert.ok(ids.includes('bbva'), 'Debe incluir Banco BBVA');
    assert.ok(ids.includes('macro'), 'Debe incluir Banco Macro');
    assert.ok(ids.includes('bancor'), 'Debe incluir Bancor');
  });
});
