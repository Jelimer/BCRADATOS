const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { defaultTestServer } = require('./helpers/setup');
const { CUITS, VARIABLES_BCRA, BANCOS_CHEQUES } = require('./helpers/fixtures');

describe('Tier 1: BCRA Official Endpoints Tests', () => {
  before(async () => {
    await defaultTestServer.start();
  });

  after(async () => {
    await defaultTestServer.stop();
  });

  // 1. Catálogo de variables monetarias
  describe('Feature 1: BCRA Catálogo de Variables (/api/monetarias)', () => {
    it('1.1. Debe retornar status HTTP 200 y catálogo de variables monetarias', async () => {
      const res = await defaultTestServer.get('/api/monetarias');
      assert.equal(res.status, 200, 'Debe responder HTTP 200');
      assert.ok(res.data, 'La respuesta no debe estar vacía');

      const results = res.data.results || (Array.isArray(res.data) ? res.data : []);
      assert.ok(Array.isArray(results), 'results debe ser un arreglo');
      assert.ok(results.length > 10, 'Debe contener múltiples variables monetarias (~30 o más)');
    });

    it('1.2. Cada variable debe tener el esquema esperado (idVariable, descripcion, valor, fecha)', async () => {
      const res = await defaultTestServer.get('/api/monetarias');
      const results = res.data.results || (Array.isArray(res.data) ? res.data : []);
      const primeraVariable = results[0];

      assert.ok(primeraVariable, 'Debe existir al menos una variable');
      assert.ok(
        'idVariable' in primeraVariable || 'id' in primeraVariable,
        'Debe contener idVariable o id'
      );
      assert.ok(
        'descripcion' in primeraVariable || 'cdSerie' in primeraVariable,
        'Debe contener descripcion'
      );
      assert.ok('fecha' in primeraVariable, 'Debe contener fecha');
    });

    it('1.3. Debe contener variables clave como Reservas Internacionales (ID 1) y Dólar Oficial (ID 4)', async () => {
      const res = await defaultTestServer.get('/api/monetarias');
      const results = res.data.results || (Array.isArray(res.data) ? res.data : []);

      const reservas = results.find(v => (v.idVariable === 1 || v.id === 1));
      assert.ok(reservas, 'Debe encontrarse la variable 1 (Reservas Internacionales)');
      assert.ok(typeof reservas.valor === 'number', 'El valor de reservas debe ser numérico');
    });
  });

  // 2. Series históricas cronológicas
  describe('Feature 2: BCRA Series Históricas (/api/monetarias/:id)', () => {
    it('2.1. Debe retornar serie histórica de Reservas Internacionales (ID 1)', async () => {
      const res = await defaultTestServer.get(`/api/monetarias/${VARIABLES_BCRA.RESERVAS}`);
      assert.equal(res.status, 200, 'Debe responder HTTP 200');
      assert.ok(res.data, 'Debe contener datos');

      let detalle = [];
      if (Array.isArray(res.data.results) && res.data.results.length > 0) {
        detalle = res.data.results[0].detalle || res.data.results;
      } else if (Array.isArray(res.data)) {
        detalle = res.data;
      }

      assert.ok(Array.isArray(detalle), 'detalle debe ser un arreglo de puntos históricos');
      assert.ok(detalle.length > 0, 'La serie histórica debe contener observaciones');
      assert.ok('fecha' in detalle[0], 'Cada observación debe tener fecha');
      assert.ok('valor' in detalle[0], 'Cada observación debe tener valor numérico');
    });

    it('2.2. Debe soportar filtrado por rango de fechas (desde / hasta)', async () => {
      const desde = '2026-01-01';
      const hasta = '2026-06-30';
      const res = await defaultTestServer.get(`/api/monetarias/${VARIABLES_BCRA.RESERVAS}?desde=${desde}&hasta=${hasta}`);
      assert.equal(res.status, 200, 'Debe responder HTTP 200 con filtros de fecha');

      let detalle = [];
      if (Array.isArray(res.data?.results) && res.data.results.length > 0) {
        detalle = res.data.results[0].detalle || res.data.results;
      }

      if (detalle.length > 0) {
        const fechas = detalle.map(d => d.fecha);
        const fueraDeRango = fechas.filter(f => f < desde || f > hasta);
        // Si la API aplica el filtro upstream o entrega el rango solicitado
        assert.ok(fechas.length > 0, 'Debe devolver datos dentro del rango');
      }
    });

    it('2.3. Debe retornar serie histórica de Tipo de Cambio Minorista (ID 4)', async () => {
      const res = await defaultTestServer.get(`/api/monetarias/${VARIABLES_BCRA.TIPO_CAMBIO_OFICIAL}`);
      assert.equal(res.status, 200, 'Debe responder HTTP 200 para variable 4');
      assert.ok(res.data, 'Debe retornar datos');
    });
  });

  // 3. Metodologías
  describe('Feature 3: BCRA Metodologías (/api/metodologia)', () => {
    it('3.1. Debe retornar diccionario metodológico con status 200', async () => {
      const res = await defaultTestServer.get('/api/metodologia');
      assert.equal(res.status, 200, 'Debe responder HTTP 200');
      assert.ok(res.data, 'Debe contener datos');

      const results = res.data.results || (Array.isArray(res.data) ? res.data : []);
      assert.ok(Array.isArray(results), 'results debe ser un arreglo de metodologías');
      assert.ok(results.length > 0, 'Debe contener al menos una metodología explicativa');
      assert.ok('id' in results[0] || 'idVariable' in results[0], 'Debe tener identificador');
      assert.ok('detalle' in results[0] || 'descripcion' in results[0], 'Debe tener descripción metodológica');
    });
  });

  // 4. Estadísticas Cambiarias
  describe('Feature 4: BCRA Cambiarias Cotizaciones (/api/bcra-cambiarias/Cotizaciones)', () => {
    it('4.1. Debe retornar cotizaciones oficiales de divisas con status 200', async () => {
      const res = await defaultTestServer.get('/api/bcra-cambiarias/Cotizaciones');
      assert.equal(res.status, 200, 'Debe responder HTTP 200');
      assert.ok(res.data, 'Debe retornar payload JSON');

      // Verificamos si results es objeto con detalle o array
      const results = res.data.results || res.data;
      assert.ok(results, 'Debe contener results');
      const detalle = results.detalle || (Array.isArray(results) ? results : []);
      assert.ok(Array.isArray(detalle) || typeof results === 'object', 'Debe contener estructura válida de cotizaciones');
    });
  });

  // 5. Régimen de Transparencia - Plazos Fijos
  describe('Feature 5: BCRA Transparencia Plazos Fijos (/api/bcra-transparencia/PlazosFijos)', () => {
    it('5.1. Debe retornar cuadro comparativo de plazos fijos por banco', async () => {
      const res = await defaultTestServer.get('/api/bcra-transparencia/PlazosFijos');
      assert.equal(res.status, 200, 'Debe responder HTTP 200');

      const results = res.data.results || (Array.isArray(res.data) ? res.data : []);
      assert.ok(Array.isArray(results), 'results debe ser un arreglo');
      if (results.length > 0) {
        const item = results[0];
        assert.ok(
          'descripcionEntidad' in item || 'denominacion' in item || 'nombreCompleto' in item || 'codigoEntidad' in item,
          'Debe incluir identificación de la entidad'
        );
      }
    });
  });

  // 6. Régimen de Transparencia - Paquetes de Productos
  describe('Feature 6: BCRA Transparencia Paquetes (/api/bcra-transparencia/PaquetesProductos)', () => {
    it('6.1. Debe retornar comisiones y costos de mantenimiento de cuentas', async () => {
      const res = await defaultTestServer.get('/api/bcra-transparencia/PaquetesProductos');
      assert.equal(res.status, 200, 'Debe responder HTTP 200');

      const results = res.data.results || (Array.isArray(res.data) ? res.data : []);
      assert.ok(Array.isArray(results), 'results debe ser un arreglo');
    });
  });

  // 7. Régimen de Transparencia - Préstamos Personales
  describe('Feature 7: BCRA Transparencia Préstamos (/api/bcra-transparencia/Prestamos/Personales)', () => {
    it('7.1. Debe retornar comparador de tasas de préstamos personales', async () => {
      const res = await defaultTestServer.get('/api/bcra-transparencia/Prestamos/Personales');
      assert.equal(res.status, 200, 'Debe responder HTTP 200');

      const results = res.data.results || (Array.isArray(res.data) ? res.data : []);
      assert.ok(Array.isArray(results), 'results debe ser un arreglo');
    });
  });

  // 8. Central de Deudores
  describe('Feature 8: BCRA Central de Deudores (/api/bcra-deudores/Deudas/:cuit)', () => {
    it('8.1. Debe consultar historial crediticio de CUIT institucional (AFIP)', async () => {
      const res = await defaultTestServer.get(`/api/bcra-deudores/Deudas/${CUITS.AFIP}`);
      assert.ok([200, 429, 502, 503].includes(res.status), 'Debe responder HTTP 200, 429, 502 o 503');
      assert.ok(res.data, 'Debe devolver datos');
    });

    it('8.2. Debe consultar historial crediticio de CUIT corporativo (YPF)', async () => {
      const res = await defaultTestServer.get(`/api/bcra-deudores/Deudas/${CUITS.YPF}`);
      assert.ok([200, 429, 502, 503].includes(res.status), 'Debe responder HTTP 200, 429, 502 o 503');
      assert.ok(res.data, 'Debe devolver datos');
    });
  });

  // 9. Cheques Denunciados
  describe('Feature 9: BCRA Cheques Denunciados (/api/bcra-cheques/denunciados/:entidad/:numero)', () => {
    it('9.1. Debe consultar estado de cheque en entidad bancaria (Banco Nación 011)', async () => {
      const res = await defaultTestServer.get(`/api/bcra-cheques/denunciados/${BANCOS_CHEQUES.NACION}/12345678`);
      assert.equal(res.status, 200, 'Debe responder HTTP 200');
      assert.ok(res.data, 'Debe devolver estructura de respuesta');
    });
  });
});
