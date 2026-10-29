/**
 * tests/challenger_opt_1_1_stress.test.js
 * Suite Empírica de Estrés Adversarial para Milestone 1 (M1_VISUAL_CHARTS).
 * 
 * Verificaciones cubiertas:
 * 1. formatValueCompact: casos de borde (0, negativos, nulos, undefined, NaN, miles, millones, miles de millones, billones).
 *    Asegura formato con coma decimal es-AR.
 * 2. setupChartGlobalDefaults: llamadas rápidas, objetos nulos, temas claro/oscuro, mocks incompletos de Chart.js.
 * 3. registerChart / unregisterChart: objetos nulos, doble destrucción, llamadas concurrentes, actualización de colores de tema.
 * 4. updateChartThemeAll: ráfaga de 500 alternancias, poda de instancias destruidas o huérfanas, manejo defensivo ante excepciones.
 * 5. Plugins de Chart.js: verticalCrosshairPlugin, maxMinLabelPlugin, lineShadowPlugin ante datos anómalos y tipos bar/line.
 * 6. Integridad de CSS y HTML: tokens alias, sintaxis RGBA válida, min-height de KPIs y ausencia de estilos inline bloqueantes.
 */

const { describe, it, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PUBLIC_DIR = path.resolve(__dirname, '../public');
const MODULES_DIR = path.resolve(PUBLIC_DIR, 'js/modules');

/**
 * Mock DOM Element para pruebas sin navegador
 */
class MockElement {
  constructor(id = '', tagName = 'div') {
    this.id = id;
    this.tagName = tagName.toUpperCase();
    this.classes = new Set();
    this.attributes = new Map();
    this.listeners = new Map();
    this.style = {};
    this.innerHTML = '';
    this.textContent = '';
    this.children = [];
    this.parentElement = null;
    this.width = 400;
    this.height = 300;

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
    return this.children.includes(el);
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
        measureText: (text) => ({ width: text.length * 7 }),
        setLineDash: () => {},
        createLinearGradient: () => ({ addColorStop: () => {} })
      };
    }
    return null;
  }
}

/**
 * Mock de Chart.js configurable
 */
class MockChart {
  static defaults = {};
  static registerCalled = [];

  static register(plugin) {
    MockChart.registerCalled.push(plugin);
  }

  constructor(ctx, config = {}) {
    this.ctx = ctx || (new MockElement('canvas', 'canvas')).getContext('2d');
    this.config = config;
    this.data = config.data || { datasets: [] };
    this.options = config.options || {};
    this.chartArea = { top: 20, bottom: 280, left: 30, right: 380 };
    this.width = 400;
    this.height = 300;
    this.isDestroyed = false;
    this.updateCalls = 0;
    this.destroyCalls = 0;
    this.canvas = new MockElement('canvas', 'canvas');
    if (globalThis.document?.body?.children) {
      globalThis.document.body.children.push(this.canvas);
    }
  }

  update(mode) {
    if (this.shouldThrowOnUpdate) throw new Error('Simulated update error');
    this.updateCalls++;
  }

  destroy() {
    if (this.shouldThrowOnDestroy) throw new Error('Simulated destroy error');
    this.isDestroyed = true;
    this.destroyCalls++;
  }

  getDatasetMeta(idx) {
    const ds = this.data.datasets[idx] || {};
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

describe('Challenger Opt 1.1: Empirical Stress & Adversarial Suite for M1', () => {
  let utilsModule;
  let chartsModule;
  let mockBody;
  let mockDocument;

  before(async () => {
    mockBody = new MockElement('body', 'body');
    mockBody.classList.add('dark-theme');

    mockDocument = {
      body: mockBody,
      createElement: (tag) => new MockElement(`el-${Math.random()}`, tag)
    };

    // Registrar en globalThis
    globalThis.document = mockDocument;
    globalThis.window = { innerWidth: 1200 };
    globalThis.getComputedStyle = () => ({
      getPropertyValue: (prop) => (prop === '--primary' ? '#e31775' : '#00f0ff')
    });
    globalThis.Chart = MockChart;

    const utilsUrl = `file://${path.resolve(MODULES_DIR, 'utils.js').replace(/\\/g, '/')}`;
    const chartsUrl = `file://${path.resolve(MODULES_DIR, 'charts.js').replace(/\\/g, '/')}`;

    utilsModule = await import(utilsUrl);
    chartsModule = await import(chartsUrl);
  });

  after(() => {
    delete globalThis.document;
    delete globalThis.window;
    delete globalThis.getComputedStyle;
    delete globalThis.Chart;
  });

  // =========================================================================
  // 1. FORMATVALUECOMPACT EMPIRICAL EDGE-CASES & ES-AR LOCALE
  // =========================================================================
  describe('1. formatValueCompact Edge-Cases & Locale es-AR Formatting', () => {
    it('1.1. Debe manejar nulos, indefinidos, NaN y strings no numéricos retornando "-"', () => {
      const { formatValueCompact } = utilsModule;
      assert.equal(formatValueCompact(null), '-');
      assert.equal(formatValueCompact(undefined), '-');
      assert.equal(formatValueCompact(NaN), '-');
      assert.equal(formatValueCompact('texto'), '-');
      assert.equal(formatValueCompact({}), '-');
    });

    it('1.2. Cero debe formatearse estrictamente con coma decimal "0,00" sin sufijo', () => {
      const { formatValueCompact } = utilsModule;
      const res = formatValueCompact(0);
      assert.equal(res, '0,00');
      assert.ok(!res.includes('.'), 'No debe contener punto decimal');
    });

    it('1.3. Valores inferiores a 1.000 (positivos y negativos) deben usar formatValue con coma decimal', () => {
      const { formatValueCompact } = utilsModule;
      assert.equal(formatValueCompact(500), '500,00');
      assert.equal(formatValueCompact(-100), '-100,00');
      assert.equal(formatValueCompact(999.9), '999,90');
      assert.equal(formatValueCompact(-999.9), '-999,90');
    });

    it('1.4. Valores en miles (1.000 a < 1.000.000) deben formatearse con sufijo "K" y coma decimal es-AR', () => {
      const { formatValueCompact } = utilsModule;
      const res1500 = formatValueCompact(1500);
      assert.equal(res1500, '1,5 K');
      assert.ok(!res1500.includes('.'), 'Debe usar coma decimal, no punto');

      const resNeg = formatValueCompact(-1500);
      assert.equal(resNeg, '-1,5 K');

      const resBoundaryLow = formatValueCompact(1000);
      assert.equal(resBoundaryLow, '1,0 K');

      const resBoundaryHigh = formatValueCompact(999999);
      assert.equal(resBoundaryHigh, '1.000,0 K');
    });

    it('1.5. Valores en millones (1.000.000 a < 1.000.000.000) deben formatearse con sufijo "M" y coma decimal', () => {
      const { formatValueCompact } = utilsModule;
      const res15M = formatValueCompact(1500000);
      assert.equal(res15M, '1,5 M');
      assert.ok(!res15M.includes('.'), 'Debe usar coma decimal, no punto');

      const resNegM = formatValueCompact(-1500000);
      assert.equal(resNegM, '-1,5 M');

      const res500M = formatValueCompact(500000000);
      assert.equal(res500M, '500,0 M');
    });

    it('1.6. Valores en miles de millones (>= 1.000.000.000 y < 1e12) deben formatearse con sufijo "M.M."', () => {
      const { formatValueCompact } = utilsModule;
      const res25MM = formatValueCompact(2500000000);
      assert.equal(res25MM, '2,5 M.M.');

      const resNegMM = formatValueCompact(-2500000000);
      assert.equal(resNegMM, '-2,5 M.M.');
    });

    it('1.7. Valores en billones (>= 1e12) deben formatearse con sufijo "B"', () => {
      const { formatValueCompact } = utilsModule;
      const res35B = formatValueCompact(3500000000000);
      assert.equal(res35B, '3,5 B');

      const resNegB = formatValueCompact(-3500000000000);
      assert.equal(resNegB, '-3,5 B');
    });
  });

  // =========================================================================
  // 2. SETUPCHARTGLOBALDEFAULTS & ROBUSTNESS
  // =========================================================================
  describe('2. setupChartGlobalDefaults Stress & Edge Conditions', () => {
    it('2.1. Debe tolerar ejecución cuando Chart es undefined sin arrojar excepciones', () => {
      const { setupChartGlobalDefaults } = chartsModule;
      const savedChart = globalThis.Chart;
      delete globalThis.Chart;
      try {
        assert.doesNotThrow(() => setupChartGlobalDefaults());
      } finally {
        globalThis.Chart = savedChart;
      }
    });

    it('2.2. Debe tolerar objetos Chart con defaults incompletos o vacíos', () => {
      const { setupChartGlobalDefaults } = chartsModule;
      const minimalChart = {};
      globalThis.Chart = minimalChart;
      try {
        setupChartGlobalDefaults();
        assert.ok(minimalChart.defaults);
        assert.ok(minimalChart.defaults.font);
        assert.ok(minimalChart.defaults.plugins.tooltip);
        assert.equal(minimalChart.defaults.plugins.tooltip.cornerRadius, 8);
        assert.equal(minimalChart.defaults.font.size, 12);
      } finally {
        globalThis.Chart = MockChart;
      }
    });

    it('2.3. Debe adaptarse al tema claro vs oscuro correctamente', () => {
      const { setupChartGlobalDefaults } = chartsModule;
      // Tema oscuro
      mockBody.classList.add('dark-theme');
      setupChartGlobalDefaults();
      assert.equal(MockChart.defaults.plugins.tooltip.backgroundColor, '#0f172a');
      assert.equal(MockChart.defaults.plugins.tooltip.titleColor, '#f8fafc');

      // Tema claro
      mockBody.classList.remove('dark-theme');
      setupChartGlobalDefaults();
      assert.equal(MockChart.defaults.plugins.tooltip.backgroundColor, '#ffffff');
      assert.equal(MockChart.defaults.plugins.tooltip.titleColor, '#0f172a');

      // Restaurar oscuro
      mockBody.classList.add('dark-theme');
    });

    it('2.4. Resistencia a ráfaga de 1000 llamadas consecutivas sin degradación ni fugas', () => {
      const { setupChartGlobalDefaults } = chartsModule;
      const t0 = performance.now();
      for (let i = 0; i < 1000; i++) {
        if (i % 2 === 0) mockBody.classList.add('dark-theme');
        else mockBody.classList.remove('dark-theme');
        setupChartGlobalDefaults();
      }
      const elapsed = performance.now() - t0;
      assert.ok(elapsed < 200, `1000 llamadas deben ejecutarse en <200ms (obtenido: ${elapsed}ms)`);
      mockBody.classList.add('dark-theme');
    });
  });

  // =========================================================================
  // 3. REGISTERCHART & UNREGISTERCHART DEFENSIVE RESILIENCE
  // =========================================================================
  describe('3. registerChart & unregisterChart Defensive Resilience', () => {
    it('3.1. Debe tolerar null, undefined o primitivos sin arrojar excepciones', () => {
      const { registerChart, unregisterChart } = chartsModule;
      assert.doesNotThrow(() => registerChart(null));
      assert.doesNotThrow(() => registerChart(undefined));
      assert.doesNotThrow(() => registerChart(123));
      assert.doesNotThrow(() => unregisterChart(null));
      assert.doesNotThrow(() => unregisterChart(undefined));
      assert.doesNotThrow(() => unregisterChart('fake'));
    });

    it('3.2. Sincronización inmediata de color de Dólar Oficial al registrar en modo claro', () => {
      const { registerChart } = chartsModule;
      mockBody.classList.remove('dark-theme'); // Modo claro

      const chart = new MockChart(null, {
        data: {
          datasets: [
            { label: 'Dólar Oficial (BNA)', borderColor: '#ffffff', data: [100, 105] }
          ]
        }
      });

      registerChart(chart);
      assert.equal(chart.data.datasets[0].borderColor, '#0f172a', 'El borde blanco debe convertirse a oscuro en tema claro');
      assert.equal(chart.updateCalls, 1, 'Debe invocar update() al corregir el color');

      mockBody.classList.add('dark-theme');
    });

    it('3.3. Doble unregister y manejo de destroy() defectuoso que lanza excepción', () => {
      const { registerChart, unregisterChart } = chartsModule;
      const faultyChart = new MockChart();
      faultyChart.shouldThrowOnDestroy = true;

      registerChart(faultyChart);
      // No debe propagar la excepción lanzada por destroy()
      assert.doesNotThrow(() => unregisterChart(faultyChart));
      // Segunda llamada idempotente
      assert.doesNotThrow(() => unregisterChart(faultyChart));
    });
  });

  // =========================================================================
  // 4. UPDATECHARTTHEMEALL CONCURRENCY, PRUNING & STRESS
  // =========================================================================
  describe('4. updateChartThemeAll Concurrency, Pruning & Rapid Stress', () => {
    it('4.1. Debe podar automáticamente gráficos marcados como isDestroyed', () => {
      const { registerChart, updateChartThemeAll } = chartsModule;
      const chart1 = new MockChart();
      const chartDestroyed = new MockChart();
      chartDestroyed.isDestroyed = true;

      registerChart(chart1);
      registerChart(chartDestroyed);

      // Ejecutar cambio de tema
      updateChartThemeAll(true);

      // chart1 debe haberse actualizado, chartDestroyed no debe recibir update
      assert.equal(chart1.updateCalls, 1);
      assert.equal(chartDestroyed.updateCalls, 0);
    });

    it('4.2. Debe podar gráficos cuyo update() arroje error sin interrumpir a los demás', () => {
      const { registerChart, updateChartThemeAll } = chartsModule;
      const chartHealthy1 = new MockChart();
      const chartFailing = new MockChart();
      chartFailing.shouldThrowOnUpdate = true;
      const chartHealthy2 = new MockChart();

      registerChart(chartHealthy1);
      registerChart(chartFailing);
      registerChart(chartHealthy2);

      assert.doesNotThrow(() => updateChartThemeAll(false));

      assert.equal(chartHealthy1.updateCalls, 1);
      assert.equal(chartHealthy2.updateCalls, 1);

      // Segunda llamada: el chartFailing ya fue podado y no afecta
      assert.doesNotThrow(() => updateChartThemeAll(true));
      assert.equal(chartHealthy1.updateCalls, 2);
      assert.equal(chartHealthy2.updateCalls, 2);
    });

    it('4.3. Ráfaga de 500 alternancias de tema ultrarrápidas sobre múltiples gráficos', () => {
      const { registerChart, updateChartThemeAll, unregisterChart } = chartsModule;
      const charts = Array.from({ length: 10 }, () => new MockChart(null, {
        options: {
          scales: { x: { ticks: {}, grid: {} }, y: { ticks: {}, grid: {} } },
          plugins: { tooltip: {}, legend: { labels: {} } }
        },
        data: {
          datasets: [{ label: 'Dólar Oficial', borderColor: '#ffffff', data: [1, 2, 3] }]
        }
      }));

      charts.forEach(c => registerChart(c));

      const t0 = performance.now();
      for (let i = 0; i < 500; i++) {
        updateChartThemeAll(i % 2 === 0);
      }
      const elapsed = performance.now() - t0;
      assert.ok(elapsed < 500, `500 actualizaciones masivas deben completarse en <500ms (obtenido: ${elapsed}ms)`);

      // Limpieza
      charts.forEach(c => unregisterChart(c));
    });

    it('4.4. Debe podar automáticamente gráficos cuyo canvas no esté contenido en el DOM', () => {
      const { registerChart, updateChartThemeAll, unregisterChart } = chartsModule;
      const attachedChart = new MockChart();
      const detachedChart = new MockChart();
      // Desconectar canvas del DOM
      mockBody.children = mockBody.children.filter(c => c !== detachedChart.canvas);

      registerChart(attachedChart);
      registerChart(detachedChart);

      updateChartThemeAll(true);

      assert.equal(attachedChart.updateCalls, 1);
      assert.equal(detachedChart.updateCalls, 0, 'Gráfico desconectado no debe recibir update');

      unregisterChart(attachedChart);
      unregisterChart(detachedChart);
    });
  });

  // =========================================================================
  // 5. PLUGINS DE CHART.JS ADVERSARIAL STRESS
  // =========================================================================
  describe('5. Chart.js Plugins Adversarial Stress (Crosshair, MaxMin, Glow)', () => {
    it('5.1. verticalCrosshairPlugin no debe fallar con tooltip inactivo o element nulo', () => {
      const { verticalCrosshairPlugin } = chartsModule;
      const chart = new MockChart();
      chart.tooltip = {};
      assert.doesNotThrow(() => verticalCrosshairPlugin.afterDraw(chart));

      chart.tooltip = { _active: [] };
      assert.doesNotThrow(() => verticalCrosshairPlugin.afterDraw(chart));

      chart.tooltip = { _active: [{ element: null }] };
      assert.doesNotThrow(() => verticalCrosshairPlugin.afterDraw(chart));

      chart.tooltip = { _active: [{ element: { x: 150 } }] };
      assert.doesNotThrow(() => verticalCrosshairPlugin.afterDraw(chart));
    });

    it('5.2. maxMinLabelPlugin debe ignorar gráficos de barra en raíz o dataset y no lanzar errores', () => {
      const { maxMinLabelPlugin } = chartsModule;
      // Caso 1: raíz es 'bar'
      const barChart = new MockChart(null, { type: 'bar' });
      assert.doesNotThrow(() => maxMinLabelPlugin.afterDatasetsDraw(barChart));

      // Caso 2: dataset es 'bar'
      const lineChartWithBarDataset = new MockChart(null, {
        type: 'line',
        data: {
          datasets: [
            { type: 'bar', maxIdx: 0, minIdx: 1, data: [100, 20] }
          ]
        }
      });
      assert.doesNotThrow(() => maxMinLabelPlugin.afterDatasetsDraw(lineChartWithBarDataset));
    });

    it('5.3. maxMinLabelPlugin maneja puntos extremos en bordes y valores NaN/null sin desbordar', () => {
      const { maxMinLabelPlugin } = chartsModule;
      const chart = new MockChart(null, {
        type: 'line',
        data: {
          datasets: [
            {
              label: 'Serie 1',
              maxIdx: 0,
              minIdx: 1,
              data: [NaN, null] // Datos anómalos
            }
          ]
        }
      });
      assert.doesNotThrow(() => maxMinLabelPlugin.afterDatasetsDraw(chart));

      // Caso con valores válidos en el borde derecho
      const chartBorder = new MockChart(null, {
        type: 'line',
        data: {
          datasets: [
            {
              label: 'Serie Borde',
              maxIdx: 0,
              minIdx: 0,
              data: [1500]
            }
          ]
        }
      });
      // Simular coordenadas cerca del borde derecho
      chartBorder.getDatasetMeta = () => ({
        visible: true,
        data: [{ x: 395, y: 25 }] // Muy cerca del borde derecho (400) y superior (20)
      });
      assert.doesNotThrow(() => maxMinLabelPlugin.afterDatasetsDraw(chartBorder));
    });

    it('5.4. lineShadowPlugin aplica color dinámico del dataset en lugar de color fijo', () => {
      const { lineShadowPlugin } = chartsModule;
      let appliedShadowColor = null;
      const mockCtx = {
        save: () => {},
        restore: () => {},
        set shadowColor(val) { appliedShadowColor = val; },
        get shadowColor() { return appliedShadowColor; }
      };

      const chart = new MockChart(mockCtx, {
        type: 'line',
        data: {
          datasets: [{ borderColor: '#16a34a' }]
        }
      });

      lineShadowPlugin.beforeDatasetsDraw(chart);
      assert.equal(appliedShadowColor, '#16a34a', 'Debe usar el borderColor del dataset');
      assert.doesNotThrow(() => lineShadowPlugin.afterDatasetsDraw(chart));
    });
  });

  // =========================================================================
  // 6. INTEGRIDAD ESTÁTICA DE CSS Y MAQUETACIÓN
  // =========================================================================
  describe('6. Integridad de CSS, Tokens y Maquetación Responsiva', () => {
    const cssPath = path.resolve(PUBLIC_DIR, 'style.css');
    const htmlPath = path.resolve(PUBLIC_DIR, 'index.html');
    const cssContent = fs.readFileSync(cssPath, 'utf8');
    const htmlContent = fs.readFileSync(htmlPath, 'utf8');

    it('6.1. Tokens alias --text-main y --bg-card deben estar definidos en :root y dark-theme', () => {
      assert.ok(cssContent.includes('--text-main: var(--text-primary);'), 'Debe definir token alias --text-main');
      assert.ok(cssContent.includes('--bg-card: var(--card-bg);'), 'Debe definir token alias --bg-card');
    });

    it('6.2. Colores temáticos en modo claro deben tener contraste WCAG AA mejorado', () => {
      assert.ok(cssContent.includes('--theme-bcra: #0284c7'), 'BCRA tema claro debe ser accesible');
      assert.ok(cssContent.includes('--theme-byma: #d97706'), 'BYMA tema claro debe ser accesible');
      assert.ok(cssContent.includes('--theme-dolares: #16a34a'), 'Dólares tema claro debe ser accesible');
    });

    it('6.3. .loading-overlay no debe contener sintaxis RGBA inválida con var() hex', () => {
      assert.ok(!cssContent.includes('rgba(var(--bg-primary)'), 'No debe tener sintaxis rota rgba(var(--bg-primary))');
      assert.ok(!cssContent.includes('rgba(var(--primary), 0.02)'), 'No debe tener sintaxis rota rgba(var(--primary))');
    });

    it('6.4. .kpi-card debe incluir min-height para uniformidad vertical', () => {
      assert.ok(cssContent.includes('min-height: 94px;'), '.kpi-card debe tener min-height: 94px');
    });

    it('6.5. .chart-wrapper debe definir alturas responsivas para desktop, tablet y mobile', () => {
      assert.ok(cssContent.includes('.chart-wrapper'), 'Debe definir clase .chart-wrapper');
      assert.ok(cssContent.includes('@media (max-width: 992px)'), 'Debe contener media query tablet');
      assert.ok(cssContent.includes('@media (max-width: 600px)'), 'Debe contener media query mobile');
    });

    it('6.6. index.html no debe contener height: 520px inline en el contenedor del gráfico INDEC', () => {
      assert.ok(!htmlContent.includes('style="height: 520px;"'), 'No debe contener estilo inline 520px');
      assert.ok(htmlContent.includes('chart-wrapper-indec'), 'Debe utilizar la clase chart-wrapper-indec');
    });
  });
});
