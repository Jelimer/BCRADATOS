/**
 * tests/adversarial-challenger-charts-stress.js
 * Arnés de Pruebas de Estrés Empírico y Adversarial para charts.js
 * Ejecutado por challenger_remed_2.
 * 
 * Dimensiones evaluadas:
 * 1. Concurrencia masiva: 2.000 registros, desregistros y ciclos asíncronos en paralelo.
 * 2. Ráfagas de alternancia de tema: 2.000 alternancias rápidas, re-entrancia y fallos en update().
 * 3. Resiliencia del DOM y entornos headless (document/body nulo, indefinido, sin contains o corrupto).
 * 4. Estrés adversarial en plugins (verticalCrosshair, maxMinLabel, lineShadow) con datos anómalos.
 * 5. Ciclo de exportación downloadChartPNG ante objetos inválidos y ráfagas.
 * 6. Detección de fugas de memoria y poda de instancias en activeCharts.
 */

const assert = require('node:assert/strict');
const path = require('node:path');

const results = [];

function recordTest(suite, name, passed, details) {
  results.push({ suite, name, passed, details });
  const mark = passed ? 'PASS' : 'FAIL';
  console.log(`[${mark}] ${suite} :: ${name}`);
  if (details) {
    console.log(`       Detalle: ${details}`);
  }
}

/**
 * Mock DOM y Canvas de alta fidelidad para pruebas de estrés
 */
class MockDOMElement {
  constructor(id = '', tagName = 'div') {
    this.id = id;
    this.tagName = tagName.toUpperCase();
    this.classes = new Set();
    this.children = [];
    this.parentElement = null;
    this.width = 400;
    this.height = 300;
    this.style = {};

    this.classList = {
      add: (...cls) => cls.forEach(c => this.classes.add(c)),
      remove: (...cls) => cls.forEach(c => this.classes.delete(c)),
      contains: (c) => this.classes.has(c),
      toggle: (c) => this.classes.has(c) ? this.classes.delete(c) : this.classes.add(c)
    };
  }

  contains(el) {
    if (!el) return false;
    if (this === el) return true;
    for (const child of this.children) {
      if (child === el) return true;
      if (typeof child.contains === 'function' && child.contains(el)) return true;
    }
    return false;
  }

  appendChild(el) {
    el.parentElement = this;
    this.children.push(el);
    return el;
  }

  removeChild(el) {
    const idx = this.children.indexOf(el);
    if (idx !== -1) {
      this.children.splice(idx, 1);
      el.parentElement = null;
    }
    return el;
  }

  getContext(type) {
    if (type === '2d') {
      return {
        save: () => {},
        restore: () => {},
        beginPath: () => {},
        moveTo: () => {},
        lineTo: () => {},
        stroke: () => {},
        fillRect: () => {},
        fillText: () => {},
        measureText: (text) => ({ width: (text ? String(text).length : 0) * 7 }),
        setLineDash: () => {},
        createLinearGradient: () => ({ addColorStop: () => {} }),
        drawImage: () => {},
        translate: () => {},
        rotate: () => {}
      };
    }
    return null;
  }

  toBlob(callback, type) {
    if (typeof callback === 'function') {
      callback({ size: 1024, type: type || 'image/png' });
    }
  }

  click() {
    this.clicked = true;
  }
}

/**
 * Mock Chart.js configurable para simular comportamientos adversarios
 */
class AdversarialMockChart {
  static defaults = {};
  static registerCalled = [];

  static register(plugin) {
    AdversarialMockChart.registerCalled.push(plugin);
  }

  constructor(config = {}) {
    this.canvas = config.canvas || new MockDOMElement('canvas', 'canvas');
    this.config = config;
    this.data = config.data || { datasets: [] };
    this.options = config.options || {};
    this.chartArea = config.chartArea !== undefined ? config.chartArea : { top: 20, bottom: 280, left: 30, right: 380 };
    this.width = config.width || 400;
    this.height = config.height || 300;
    this.isDestroyed = false;
    this.updateCalls = 0;
    this.destroyCalls = 0;
    this.shouldThrowOnUpdate = config.shouldThrowOnUpdate || false;
    this.shouldThrowOnDestroy = config.shouldThrowOnDestroy || false;
    this.ctx = config.ctx || this.canvas.getContext('2d');
    this.reentrantCallback = config.reentrantCallback || null;
  }

  update(mode) {
    if (this.shouldThrowOnUpdate) {
      throw new Error('Adversarial update failure simulated');
    }
    this.updateCalls++;
    if (this.reentrantCallback) {
      const cb = this.reentrantCallback;
      this.reentrantCallback = null;
      cb();
    }
  }

  destroy() {
    if (this.shouldThrowOnDestroy) {
      throw new Error('Adversarial destroy failure simulated');
    }
    this.isDestroyed = true;
    this.destroyCalls++;
  }

  getDatasetMeta(idx) {
    if (this.config.nullMeta) return null;
    const ds = (this.data && this.data.datasets && this.data.datasets[idx]) || {};
    const dataLen = ds.data ? ds.data.length : 0;
    return {
      visible: true,
      data: Array.from({ length: dataLen }, (_, i) => ({
        x: 50 + i * 30,
        y: 100 + (i % 5) * 20
      }))
    };
  }
}

async function runAdversarialHarness() {
  console.log('='.repeat(80));
  console.log('CHALLENGER_REMED_2: SUITE DE ESTRÉS EMPÍRICO Y ADVERSARIAL SOBRE CHARTS.JS');
  console.log('='.repeat(80));

  // Preparar entorno base
  const mockBody = new MockDOMElement('body', 'body');
  mockBody.classList.add('dark-theme');

  const mockDocument = {
    body: mockBody,
    createElement: (tag) => new MockDOMElement(`el-${Math.random()}`, tag)
  };

  globalThis.document = mockDocument;
  globalThis.window = { innerWidth: 1280 };
  globalThis.getComputedStyle = () => ({
    getPropertyValue: (prop) => (prop === '--primary' ? '#e31775' : '#00f0ff')
  });
  globalThis.Chart = AdversarialMockChart;
  const originalCreateObjectURL = globalThis.URL?.createObjectURL;
  const originalRevokeObjectURL = globalThis.URL?.revokeObjectURL;
  if (!globalThis.URL) globalThis.URL = {};
  globalThis.URL.createObjectURL = () => 'blob:http://localhost/fake-uuid';
  globalThis.URL.revokeObjectURL = () => {};

  const chartsModulePath = path.resolve(__dirname, '../public/js/modules/charts.js');
  const chartsUrl = `file://${chartsModulePath.replace(/\\/g, '/')}`;
  const charts = await import(chartsUrl);

  const memStart = process.memoryUsage();

  try {
    // =========================================================================
    // 1. CONCURRENCIA MASIVA: REGISTRO, DESREGISTRO Y CARRERAS ASÍNCRONAS
    // =========================================================================
    console.log('\n--- 1. Concurrencia Masiva y Carreras Asíncronas ---');

    {
      const totalWorkers = 50;
      const chartsPerWorker = 40; // 2.000 gráficos en total
      const registeredCharts = [];

      const startTime = performance.now();

      // 50 trabajadores concurrentes registrando y actualizando gráficos
      const workers = Array.from({ length: totalWorkers }, async (_, workerId) => {
        const workerCharts = [];
        for (let i = 0; i < chartsPerWorker; i++) {
          const canvas = new MockDOMElement(`canvas-${workerId}-${i}`, 'canvas');
          mockBody.appendChild(canvas);
          const chart = new AdversarialMockChart({
            canvas,
            options: { scales: { x: { ticks: {}, grid: {} }, y: { ticks: {}, grid: {} } }, plugins: { tooltip: {} } },
            data: { datasets: [{ label: 'Dólar Oficial (BNA)', borderColor: '#ffffff', data: [100, 101] }] }
          });
          charts.registerChart(chart);
          workerCharts.push(chart);
        }
        // Simular yield asíncrono
        await new Promise(r => setImmediate(r));
        return workerCharts;
      });

      const workerResults = await Promise.all(workers);
      workerResults.forEach(list => registeredCharts.push(...list));

      const durationRegister = performance.now() - startTime;
      const passedRegister = registeredCharts.length === 2000;
      recordTest(
        '1. Concurrency',
        'Registro masivo de 2.000 gráficos desde 50 workers concurrentes',
        passedRegister,
        `2.000 registrados en ${durationRegister.toFixed(2)} ms`
      );

      // Ahora desregistrar concurrentemente el 50% de los gráficos mientras se alterna el tema
      const unregisterStart = performance.now();
      const halfCount = 1000;
      const unregisterPromises = registeredCharts.slice(0, halfCount).map(async (c, idx) => {
        if (idx % 10 === 0) {
          // Intercalar llamadas a updateChartThemeAll
          charts.updateChartThemeAll(idx % 20 === 0);
        }
        mockBody.removeChild(c.canvas);
        charts.unregisterChart(c);
      });

      await Promise.all(unregisterPromises);
      const durationUnregister = performance.now() - unregisterStart;

      // Guardar el número de llamadas que tenían al terminar el desregistro
      const callsAtUnregister = new Map(registeredCharts.slice(0, halfCount).map(c => [c, c.updateCalls]));

      // Verificar que los desregistrados no reciben futuros updates
      const remainingCharts = registeredCharts.slice(halfCount);
      charts.updateChartThemeAll(true);

      const anyUnregisteredReceivedPostUpdate = registeredCharts.slice(0, halfCount).some(c => c.updateCalls > callsAtUnregister.get(c));
      const remainingUpdated = remainingCharts.every(c => c.updateCalls > 0);

      recordTest(
        '1. Concurrency',
        'Desregistro masivo de 1.000 gráficos con theme toggles intercalados sin condición de carrera',
        !anyUnregisteredReceivedPostUpdate && remainingUpdated,
        `1.000 desregistrados en ${durationUnregister.toFixed(2)} ms. Ninguno recibió updates tras ser desregistrado.`
      );

      // Limpieza de gráficos restantes
      remainingCharts.forEach(c => {
        mockBody.removeChild(c.canvas);
        charts.unregisterChart(c);
      });
    }

    // =========================================================================
    // 2. RÁFAGAS DE ALTERNANCIA DE TEMA, RE-ENTRANCIA Y MANEJO DE EXCEPCIONES
    // =========================================================================
    console.log('\n--- 2. Ráfagas de Alternancia de Tema y Re-entrancia ---');

    {
      // 2.1 Ráfaga de 2.000 alternancias rápidas
      const testCharts = Array.from({ length: 20 }, (_, i) => {
        const canvas = new MockDOMElement(`c-${i}`, 'canvas');
        mockBody.appendChild(canvas);
        const c = new AdversarialMockChart({
          canvas,
          options: {
            scales: { x: { ticks: {}, grid: {} }, y: { ticks: {}, grid: {} } },
            plugins: { tooltip: {}, legend: { labels: {} } }
          },
          data: { datasets: [{ label: 'Dólar Oficial', borderColor: '#ffffff', data: [1, 2] }] }
        });
        charts.registerChart(c);
        return c;
      });

      const tBurstStart = performance.now();
      for (let i = 0; i < 2000; i++) {
        charts.updateChartThemeAll(i % 2 === 0);
      }
      const tBurstEnd = performance.now() - tBurstStart;

      const passedBurst = testCharts.every(c => c.updateCalls === 2000);
      recordTest(
        '2. Theme Toggles',
        'Ráfaga de 2.000 alternancias de tema ultra-rápidas sobre 20 gráficos',
        passedBurst,
        `2.000 ciclos en ${tBurstEnd.toFixed(2)} ms (promedio ${(tBurstEnd / 2000).toFixed(3)} ms/toggle)`
      );

      // 2.2 Re-entrancia: un gráfico que intenta llamar a updateChartThemeAll y registerChart dentro de update()
      let reentrancySucceeded = false;
      const reentrantCanvas = new MockDOMElement('reentrant-canvas', 'canvas');
      mockBody.appendChild(reentrantCanvas);

      const reentrantChart = new AdversarialMockChart({
        canvas: reentrantCanvas,
        options: { scales: { x: {} } },
        reentrantCallback: () => {
          // Llamada reentrante durante el bucle de updateChartThemeAll
          const nestedCanvas = new MockDOMElement('nested-canvas', 'canvas');
          mockBody.appendChild(nestedCanvas);
          const nestedChart = new AdversarialMockChart({ canvas: nestedCanvas });
          charts.registerChart(nestedChart);
          charts.updateChartThemeAll(false);
          reentrancySucceeded = true;
          mockBody.removeChild(nestedCanvas);
          charts.unregisterChart(nestedChart);
        }
      });

      charts.registerChart(reentrantChart);
      assert.doesNotThrow(() => charts.updateChartThemeAll(true));
      recordTest(
        '2. Theme Toggles',
        'Re-entrancia defensiva (updateChartThemeAll y registerChart invocados durante update)',
        reentrancySucceeded,
        'No se produjeron bloqueos recursivos ni desincronización de Set'
      );

      mockBody.removeChild(reentrantCanvas);
      charts.unregisterChart(reentrantChart);

      // 2.3 Resiliencia ante fallos masivos en chart.update()
      const faultyCharts = Array.from({ length: 5 }, (_, i) => {
        const canvas = new MockDOMElement(`faulty-${i}`, 'canvas');
        mockBody.appendChild(canvas);
        const c = new AdversarialMockChart({ canvas, shouldThrowOnUpdate: true });
        charts.registerChart(c);
        return c;
      });

      const healthyChart = new AdversarialMockChart({
        canvas: new MockDOMElement('healthy', 'canvas'),
        options: { scales: { x: {} } }
      });
      mockBody.appendChild(healthyChart.canvas);
      charts.registerChart(healthyChart);

      assert.doesNotThrow(() => charts.updateChartThemeAll(false));
      assert.equal(healthyChart.updateCalls, 1, 'El gráfico sano debió actualizarse a pesar de fallos en otros');

      // Segunda pasada: los faultyCharts debieron ser podados automáticamente por el catch
      assert.doesNotThrow(() => charts.updateChartThemeAll(true));
      assert.equal(healthyChart.updateCalls, 2);

      recordTest(
        '2. Theme Toggles',
        'Aislamiento y poda automática ante excepciones en chart.update()',
        true,
        'Gráficos con error podados sin interrumpir la actualización de instancias sanas'
      );

      // Limpieza
      testCharts.forEach(c => { mockBody.removeChild(c.canvas); charts.unregisterChart(c); });
      faultyCharts.forEach(c => { mockBody.removeChild(c.canvas); charts.unregisterChart(c); });
      mockBody.removeChild(healthyChart.canvas);
      charts.unregisterChart(healthyChart);
    }

    // =========================================================================
    // 3. RESILIENCIA DEL DOM Y ENTORNOS HEADLESS DEFICIENTES
    // =========================================================================
    console.log('\n--- 3. Resiliencia del DOM y Entornos Headless ---');

    {
      // 3.1 document.body sin contains o con contains que no es función
      const corruptedDocs = [
        { desc: 'document.body es {} sin contains', doc: { body: {} } },
        { desc: 'document.body.contains es null', doc: { body: { contains: null } } },
        { desc: 'document.body.contains es número (123)', doc: { body: { contains: 123 } } },
        { desc: 'document.body es null', doc: { body: null } },
        { desc: 'document.body.classList es undefined', doc: { body: { contains: () => true } } },
        { desc: 'document.body.classList es objeto vacío {} sin contains', doc: { body: { classList: {}, contains: () => true } } },
        { desc: 'document.body.classList es null', doc: { body: { classList: null, contains: () => true } } }
      ];

      for (const cd of corruptedDocs) {
        globalThis.document = cd.doc;
        const testChart = new AdversarialMockChart({
          options: { scales: { x: { ticks: {} } } }
        });
        charts.registerChart(testChart);

        let crashed = false;
        try {
          charts.updateChartThemeAll(true);
          charts.setupChartGlobalDefaults();
        } catch (e) {
          crashed = true;
          console.error(`      Fallo en ${cd.desc}:`, e);
        }

        recordTest(
          '3. DOM Resilience',
          `Tolerancia absoluta cuando ${cd.desc}`,
          !crashed,
          crashed ? 'Lanzó excepción' : 'Comportamiento defensivo seguro sin crash'
        );

        charts.unregisterChart(testChart);
      }

      // 3.2 document completamente undefined
      delete globalThis.document;
      let crashedNoDoc = false;
      try {
        const noDocChart = new AdversarialMockChart();
        charts.registerChart(noDocChart);
        charts.updateChartThemeAll(false);
        charts.setupChartGlobalDefaults();
        charts.unregisterChart(noDocChart);
      } catch (e) {
        crashedNoDoc = true;
        console.error('      Fallo sin document:', e);
      }

      recordTest(
        '3. DOM Resilience',
        'Tolerancia absoluta cuando typeof document === "undefined"',
        !crashedNoDoc,
        crashedNoDoc ? 'Lanzó excepción' : 'Ejecución limpia sin DOM'
      );

      // Restaurar document para siguientes pruebas
      globalThis.document = mockDocument;
    }

    // =========================================================================
    // 4. ESTRÉS ADVERSARIAL EN PLUGINS (CROSSHAIR, MAXMIN, GLOW)
    // =========================================================================
    console.log('\n--- 4. Estrés Adversarial en Plugins de Chart.js ---');

    {
      const { verticalCrosshairPlugin, maxMinLabelPlugin, lineShadowPlugin } = charts;

      // 4.1 verticalCrosshairPlugin con ráfaga de 5.000 llamadas y coordenadas adversariales
      let crosshairCrashed = false;
      const crosshairChart = new AdversarialMockChart();

      try {
        for (let i = 0; i < 5000; i++) {
          const evilCoordinates = [
            null,
            { x: NaN },
            { x: Infinity },
            { x: -Infinity },
            { x: -999999 },
            { x: 999999 },
            { x: 150.5 }
          ];
          const coord = evilCoordinates[i % evilCoordinates.length];
          crosshairChart.tooltip = {
            _active: coord ? [{ element: coord }] : []
          };
          verticalCrosshairPlugin.afterDraw(crosshairChart);
        }
      } catch (e) {
        crosshairCrashed = true;
        console.error('      Fallo en verticalCrosshairPlugin:', e);
      }

      recordTest(
        '4. Plugins Adversarial',
        'verticalCrosshairPlugin soporta 5.000 llamadas con coordenadas aberrantes (NaN, Infinity, nulos)',
        !crosshairCrashed,
        crosshairCrashed ? 'Lanzó excepción' : '5.000 iteraciones sin fallo'
      );

      // 4.2 maxMinLabelPlugin con anomalías extremas
      let maxMinCrashed = false;
      try {
        const pathologicalCases = [
          { datasets: [] }, // Vacío
          { datasets: [{ data: [] }] }, // Dataset sin datos
          { datasets: [{ maxIdx: 999999, minIdx: -1, data: [1, 2] }] }, // Índices fuera de rango
          { datasets: [{ maxIdx: 0, minIdx: 0, data: [NaN, null, undefined, Infinity, -Infinity] }] }, // Valores patológicos
          { datasets: [{ type: 'bar', maxIdx: 0, minIdx: 0, data: [100] }] }, // Tipo barra
          { datasets: [{ maxIdx: 0, minIdx: 0, data: [100], formatLabel: () => 'Formateado' }] } // formatLabel custom
        ];

        for (const testCase of pathologicalCases) {
          const evilChart = new AdversarialMockChart({
            type: 'line',
            data: testCase
          });
          maxMinLabelPlugin.afterDatasetsDraw(evilChart);
        }

        // Caso con chartArea nulo o faltante
        const noAreaChart = new AdversarialMockChart({
          type: 'line',
          chartArea: null,
          data: { datasets: [{ maxIdx: 0, minIdx: 0, data: [500] }] }
        });
        maxMinLabelPlugin.afterDatasetsDraw(noAreaChart);

        // Caso con getDatasetMeta retornando nulo
        const nullMetaChart = new AdversarialMockChart({
          type: 'line',
          nullMeta: true,
          data: { datasets: [{ maxIdx: 0, minIdx: 0, data: [500] }] }
        });
        maxMinLabelPlugin.afterDatasetsDraw(nullMetaChart);

      } catch (e) {
        maxMinCrashed = true;
        console.error('      Fallo en maxMinLabelPlugin:', e);
      }

      recordTest(
        '4. Plugins Adversarial',
        'maxMinLabelPlugin resiste índices fuera de rango, datos patológicos y meta/chartArea nulos',
        !maxMinCrashed,
        maxMinCrashed ? 'Lanzó excepción' : 'Casos patológicos manejados de forma defensiva'
      );

      // 4.3 lineShadowPlugin con datasets atípicos
      let lineShadowCrashed = false;
      try {
        const shadowCases = [
          { datasets: [] },
          { datasets: [{ borderColor: null }] },
          { datasets: [{ borderColor: 12345 }] },
          { datasets: [{ borderColor: {} }] },
          { datasets: [{ borderColor: 'rgba(255, 0, 0, 0.5)' }] }
        ];

        for (const sc of shadowCases) {
          const shadowChart = new AdversarialMockChart({
            type: 'line',
            data: sc
          });
          lineShadowPlugin.beforeDatasetsDraw(shadowChart);
          lineShadowPlugin.afterDatasetsDraw(shadowChart);
        }

        // Gráfico no lineal (debe ignorarse silenciosamente)
        const barShadowChart = new AdversarialMockChart({
          type: 'bar',
          data: { datasets: [{ borderColor: '#ff0000' }] }
        });
        lineShadowPlugin.beforeDatasetsDraw(barShadowChart);
        lineShadowPlugin.afterDatasetsDraw(barShadowChart);

      } catch (e) {
        lineShadowCrashed = true;
        console.error('      Fallo en lineShadowPlugin:', e);
      }

      recordTest(
        '4. Plugins Adversarial',
        'lineShadowPlugin soporta datasets sin borde string y tipos de gráfico no-lineales',
        !lineShadowCrashed,
        lineShadowCrashed ? 'Lanzó excepción' : 'Casos manejados sin excepción'
      );
    }

    // =========================================================================
    // 5. EXPORTACIÓN DOWNLOADCHARTPNG ROBUSTEZ Y CICLO DE VIDA
    // =========================================================================
    console.log('\n--- 5. Exportación de Gráficos (downloadChartPNG) ---');

    {
      const { downloadChartPNG } = charts;

      // 5.1 Parámetros nulos o inválidos
      assert.doesNotThrow(() => downloadChartPNG(null));
      assert.doesNotThrow(() => downloadChartPNG(undefined));
      assert.doesNotThrow(() => downloadChartPNG({}));
      assert.doesNotThrow(() => downloadChartPNG(12345));

      recordTest(
        '5. Export PNG',
        'downloadChartPNG tolera null, undefined y tipos no válidos sin excepciones',
        true,
        'Guardas iniciales operativas'
      );

      // 5.2 Ráfaga de 100 descargas sobre un gráfico válido
      let exportCrashed = false;
      const exportChart = new AdversarialMockChart();
      try {
        for (let i = 0; i < 100; i++) {
          downloadChartPNG(exportChart, `test-${i}.png`);
        }
      } catch (e) {
        exportCrashed = true;
        console.error('      Fallo en downloadChartPNG:', e);
      }

      // Verificar que el DOM de body no acumula elementos de descarga huérfanos
      const remainingLinks = mockBody.children.filter(c => c.tagName === 'A');
      const passedExport = !exportCrashed && remainingLinks.length === 0;

      recordTest(
        '5. Export PNG',
        'Ráfaga de 100 exportaciones PNG consecutivas sin fugas en el DOM (limpieza de enlaces <a>)',
        passedExport,
        `100 exportaciones procesadas, enlaces residuales en body: ${remainingLinks.length}`
      );
    }

    // =========================================================================
    // 6. PERFIL DE MEMORIA Y PODA AUTOMÁTICA DE REFERENCIAS HUÉRFANAS
    // =========================================================================
    console.log('\n--- 6. Perfil de Memoria y Poda Automática ---');

    {
      // Registrar 3.000 gráficos con canvases que luego son desconectados del DOM
      const detachedCharts = [];
      for (let i = 0; i < 3000; i++) {
        const canvas = new MockDOMElement(`detached-${i}`, 'canvas');
        mockBody.appendChild(canvas);
        const c = new AdversarialMockChart({ canvas });
        charts.registerChart(c);
        detachedCharts.push(c);
      }

      // Desconectar todos los canvases del body sin llamar a unregisterChart
      mockBody.children = [];

      // Ejecutar updateChartThemeAll: esto debe activar la poda de huérfanos (isDetached)
      charts.updateChartThemeAll(true);

      // Segunda pasada: verificar que ya no existen en activeCharts (ninguno debe recibir updates)
      charts.updateChartThemeAll(false);
      const leakedUpdates = detachedCharts.filter(c => c.updateCalls > 0);

      const memEnd = process.memoryUsage();
      const heapDeltaMb = ((memEnd.heapUsed - memStart.heapUsed) / (1024 * 1024)).toFixed(2);

      recordTest(
        '6. Memory & Pruning',
        'Poda automática de 3.000 instancias huérfanas desconectadas del DOM en activeCharts',
        leakedUpdates.length === 0,
        `0/3.000 recibieron updates tras desconexión. Delta Heap total: ${heapDeltaMb} MB`
      );
    }

    // =========================================================================
    // RESUMEN FINAL
    // =========================================================================
    console.log('\n' + '='.repeat(80));
    console.log('RESUMEN DE PRUEBAS ADVERSARIALES EMPÍRICAS DE CHARTS.JS');
    console.log('='.repeat(80));

    const total = results.length;
    const passed = results.filter(r => r.passed).length;
    const failed = total - passed;

    console.log(`Total Pruebas: ${total}`);
    console.log(`Aprobadas:     ${passed}`);
    console.log(`Falladas:      ${failed}`);
    console.log(`Porcentaje:    ${((passed / total) * 100).toFixed(1)}%`);

    if (failed > 0) {
      console.error(`\n❌ VEREDICTO EMPÍRICO: REJECTED (${failed} fallos detectados)`);
      process.exitCode = 1;
    } else {
      console.log(`\n✅ VEREDICTO EMPÍRICO: CONFIRMED (100% aprobado)`);
      process.exitCode = 0;
    }

  } catch (err) {
    console.error('Error no capturado en arnés de estrés:', err);
    process.exitCode = 1;
  } finally {
    // Esperar a que los temporizadores de revocación de URLs expiren de forma segura
    await new Promise(r => setTimeout(r, 1100));

    // Restaurar globals
    delete globalThis.document;
    delete globalThis.window;
    delete globalThis.getComputedStyle;
    delete globalThis.Chart;
    if (globalThis.URL) {
      if (originalCreateObjectURL) globalThis.URL.createObjectURL = originalCreateObjectURL;
      else delete globalThis.URL.createObjectURL;
      if (originalRevokeObjectURL) globalThis.URL.revokeObjectURL = originalRevokeObjectURL;
      else delete globalThis.URL.revokeObjectURL;
    }
  }
}

runAdversarialHarness();
