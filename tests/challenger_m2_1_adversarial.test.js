/**
 * tests/challenger_m2_1_adversarial.test.js
 * Suite Adversarial y de Verificación Empírica Estricta para challenger_m2_1 (M2_FRONTEND_PERF).
 * 
 * Verificaciones empíricas requeridas:
 * 1. Idempotencia estricta en tabBcra.init() ante invocaciones repetidas y ráfagas (0 listeners duplicados).
 * 2. Ciclo de vida in-place de Chart.js en tabByma.js ante cambios sucesivos de especies y rangos temporales (reutilización de canvas con update('active')).
 * 3. Reactividad y sincronización de temas claro/oscuro en el gráfico de BYMA (updateChartThemeAll).
 * 4. Resistencia ante conmutación rápida entre pestañas en SPA (cero fugas de memoria).
 */

const { describe, it, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const PUBLIC_DIR = path.resolve(__dirname, '../public');
const MODULES_DIR = path.resolve(PUBLIC_DIR, 'js/modules');

/**
 * Clase mock de elemento DOM con capacidades completas de escucha y despacho de eventos.
 */
class MockElement {
  constructor(id = '', tagName = 'div') {
    this.id = id;
    this.tagName = tagName.toUpperCase();
    this.classes = new Set();
    this.attributes = new Map();
    this.listeners = new Map(); // eventName -> Array<{ fn, count }>
    this.totalListenerAttachments = 0;
    this.style = {};
    this.innerHTML = '';
    this.textContent = '';
    this.value = '';
    this.children = [];
    this.parentElement = null;

    this.classList = {
      add: (...cls) => cls.forEach(c => this.classes.add(c)),
      remove: (...cls) => cls.forEach(c => this.classes.delete(c)),
      contains: (c) => this.classes.has(c),
      toggle: (c) => this.classes.has(c) ? this.classes.delete(c) : this.classes.add(c)
    };
  }

  setAttribute(k, v) {
    this.attributes.set(k, String(v));
  }

  getAttribute(k) {
    return this.attributes.get(k) || null;
  }

  addEventListener(eventName, handler) {
    if (!this.listeners.has(eventName)) {
      this.listeners.set(eventName, []);
    }
    this.listeners.get(eventName).push(handler);
    this.totalListenerAttachments++;
  }

  dispatchEvent(eventName, eventObj = {}) {
    const list = this.listeners.get(eventName) || [];
    const event = {
      type: eventName,
      target: this,
      currentTarget: this,
      stopPropagation: () => {},
      preventDefault: () => {},
      ...eventObj
    };
    for (const fn of list) {
      fn(event);
    }
  }

  closest(selector) {
    if (selector.startsWith('#')) {
      return this.id === selector.slice(1) ? this : null;
    }
    if (selector.startsWith('.')) {
      return this.classList.contains(selector.slice(1)) ? this : null;
    }
    if (selector.startsWith('button[data-')) {
      const attrName = selector.match(/button\[(data-[^=\]]+)/)?.[1];
      if (attrName && this.attributes.has(attrName)) return this;
    }
    if (selector.startsWith('tr[data-')) {
      const attrName = selector.match(/tr\[(data-[^=\]]+)/)?.[1];
      if (attrName && this.attributes.has(attrName)) return this;
    }
    return this;
  }

  querySelector(selector) {
    const res = this.querySelectorAll(selector);
    return res.length > 0 ? res[0] : null;
  }

  querySelectorAll(selector) {
    const matched = [];
    if (selector.includes('.pill-btn')) {
      matched.push(...this.children.filter(c => c.classList.contains('pill-btn')));
    }
    if (selector.includes('button')) {
      matched.push(...this.children.filter(c => c.tagName === 'BUTTON'));
    }
    if (selector.includes('[data-days="all"]')) {
      matched.push(...this.children.filter(c => c.getAttribute('data-days') === 'all'));
    }
    return matched;
  }

  getContext(type) {
    if (type === '2d') {
      return {
        createLinearGradient: () => ({
          addColorStop: () => {}
        }),
        save: () => {},
        restore: () => {},
        measureText: () => ({ width: 50 }),
        fillText: () => {}
      };
    }
    return null;
  }
}

/**
 * Mock de Chart.js con instrumentación completa del ciclo de vida.
 */
class MockChart {
  static instances = [];
  static constructorCalls = 0;

  constructor(ctx, config) {
    MockChart.constructorCalls++;
    this.ctx = ctx;
    this.config = config;
    this.data = config.data || { labels: [], datasets: [{ data: [] }] };
    this.options = config.options || {};
    this.destroyCalls = 0;
    this.updateCalls = [];
    MockChart.instances.push(this);
  }

  update(mode) {
    this.updateCalls.push(mode);
  }

  destroy() {
    this.destroyCalls++;
    const idx = MockChart.instances.indexOf(this);
    if (idx !== -1) {
      MockChart.instances.splice(idx, 1);
    }
  }

  getDatasetMeta() {
    return { visible: true, data: [] };
  }
}

describe('Challenger M2: Verificación Adversarial Empírica de Rendimiento Frontend', () => {
  let domRegistry = new Map();
  let mockBody;
  let mockDocument;
  let tabBcraModule;
  let tabBymaModule;
  let chartsModule;
  let stateModule;

  before(async () => {
    // Configuración del entorno DOM global
    mockBody = new MockElement('body', 'body');
    mockBody.classList.add('dark-theme');

    mockDocument = {
      body: mockBody,
      getElementById: (id) => {
        if (!domRegistry.has(id)) {
          const el = new MockElement(id, id.toLowerCase().includes('canvas') || id.toLowerCase().includes('chart') ? 'canvas' : 'div');
          domRegistry.set(id, el);
        }
        return domRegistry.get(id);
      },
      querySelector: (sel) => {
        if (sel.includes('quickRanges')) {
          const qr = mockDocument.getElementById('quickRanges');
          return qr.querySelector(sel);
        }
        return new MockElement('generic-query', 'div');
      },
      querySelectorAll: (sel) => {
        if (sel.includes('#kpiPeriodPills')) {
          const kp = mockDocument.getElementById('kpiPeriodPills');
          return kp.querySelectorAll(sel);
        }
        return [];
      },
      createElement: (tag) => new MockElement(`el-${Math.random()}`, tag)
    };

    globalThis.document = mockDocument;
    globalThis.window = {
      innerWidth: 1200,
      addEventListener: () => {}
    };
    globalThis.getComputedStyle = () => ({
      getPropertyValue: () => '#e31775'
    });
    globalThis.Chart = MockChart;

    // Importación dinámica de módulos ESM
    const tabBcraUrl = `file://${path.resolve(MODULES_DIR, 'tabBcra.js').replace(/\\/g, '/')}`;
    const tabBymaUrl = `file://${path.resolve(MODULES_DIR, 'tabByma.js').replace(/\\/g, '/')}`;
    const chartsUrl = `file://${path.resolve(MODULES_DIR, 'charts.js').replace(/\\/g, '/')}`;
    const stateUrl = `file://${path.resolve(MODULES_DIR, 'state.js').replace(/\\/g, '/')}`;

    tabBcraModule = await import(tabBcraUrl);
    tabBymaModule = await import(tabBymaUrl);
    chartsModule = await import(chartsUrl);
    stateModule = await import(stateUrl);
  });

  after(() => {
    delete globalThis.document;
    delete globalThis.window;
    delete globalThis.getComputedStyle;
    delete globalThis.Chart;
  });

  beforeEach(() => {
    MockChart.instances = [];
    MockChart.constructorCalls = 0;
  });

  // =========================================================================
  // SECCIÓN 1: IDEMPOTENCIA ESTRICTA EN TABBCRA.INIT()
  // =========================================================================
  describe('1. Idempotencia Estricta en tabBcra.init()', () => {
    it('1.1. Invocaciones repetidas y masivas (100x) a tabBcra.init() no deben duplicar ningún event listener en el DOM', async () => {
      const { tabBcra } = tabBcraModule;
      const { appState } = stateModule;

      // Reset de estado
      tabBcra.initialized = false;
      domRegistry.clear();

      // Configurar elementos esenciales del módulo BCRA en el DOM
      const elementsToCheck = [
        'variableSearch',
        'variablesList',
        'retryVariablesBtn',
        'startBtn',
        'quickRanges',
        'applyDatesBtn',
        'exportCsvBtn',
        'chartTypeSelector',
        'btnTabChart',
        'btnTabTable',
        'prevPageBtn',
        'nextPageBtn',
        'btnDownloadBcraChart',
        'kpiPeriodPills'
      ];

      for (const id of elementsToCheck) {
        mockDocument.getElementById(id);
      }

      // Preparar pill-btn hijos
      const kpiPills = mockDocument.getElementById('kpiPeriodPills');
      const pill1 = new MockElement('pill1', 'button');
      pill1.classList.add('pill-btn');
      pill1.setAttribute('data-days', '30');
      kpiPills.children.push(pill1);

      // Primera inicialización oficial
      tabBcra.init();

      assert.equal(tabBcra.initialized, true, 'tabBcra debe marcar initialized = true');

      // Medir la cantidad inicial de listeners adjuntados por elemento
      const initialAttachmentCounts = new Map();
      let initialTotalListeners = 0;

      for (const id of elementsToCheck) {
        const el = mockDocument.getElementById(id);
        const count = el.totalListenerAttachments;
        initialAttachmentCounts.set(id, count);
        initialTotalListeners += count;
        assert.ok(count >= 1, `El elemento ${id} debió recibir al menos 1 listener en la primera carga`);
      }

      assert.equal(initialTotalListeners, 14, 'Deben haberse registrado exactamente 14 listeners en el DOM');

      // STRESS HARNESS ADVERSARIAL: Invocar 100 veces consecutivas tabBcra.init()
      for (let i = 0; i < 100; i++) {
        tabBcra.init();
      }

      // Verificar que ningún elemento haya recibido listeners adicionales
      let postStressTotalListeners = 0;
      for (const id of elementsToCheck) {
        const el = mockDocument.getElementById(id);
        const currentCount = el.totalListenerAttachments;
        const initialCount = initialAttachmentCounts.get(id);
        postStressTotalListeners += currentCount;

        assert.equal(
          currentCount,
          initialCount,
          `Fuga de listeners detectada en #${id}: tenía ${initialCount} y ahora tiene ${currentCount} tras 100 llamadas`
        );
      }

      assert.equal(
        postStressTotalListeners,
        initialTotalListeners,
        'La cantidad total de listeners en el DOM debe ser estrictamente idéntica (idempotencia perfecta)'
      );
    });

    it('1.2. Al despachar un evento de clic sobre botones del DOM, el manejador debe ejecutarse exactamente 1 vez (sin llamadas acumuladas)', () => {
      const { tabBcra } = tabBcraModule;
      const { appState } = stateModule;

      tabBcra.initialized = true;

      const btnTabTable = mockDocument.getElementById('btnTabTable');
      let tableSubTabSwitched = 0;

      // Reemplazar temporalmente switchSubTab para espiar ejecuciones
      const origSwitch = tabBcra.switchSubTab;
      tabBcra.switchSubTab = (tab) => {
        if (tab === 'tabTable') tableSubTabSwitched++;
      };

      try {
        // Despachar 1 evento click
        btnTabTable.dispatchEvent('click');

        assert.equal(
          tableSubTabSwitched,
          1,
          'El manejador de switchSubTab debe haberse ejecutado exactamente 1 vez'
        );
      } finally {
        tabBcra.switchSubTab = origSwitch;
      }
    });
  });

  // =========================================================================
  // SECCIÓN 2: CICLO DE VIDA IN-PLACE DE CHART.JS EN TABBYMA.JS
  // =========================================================================
  describe('2. Ciclo de Vida In-Place de Chart.js en tabByma.js', () => {
    it('2.1. loadAndRenderChart debe instanciar Chart y registrarlo en activeCharts en la primera llamada', async () => {
      const { tabByma } = tabBymaModule;
      const { appState, clientCache } = stateModule;

      appState.byma.chart = null;

      const mockBondAL30 = {
        symbol: 'AL30D',
        denominationCcy: 'USD',
        historicalSeries: {
          s: 'ok',
          t: [1700000000, 1700086400, 1700172800, 1700259200, 1700345600, 1700432000],
          c: [55.2, 56.1, 55.8, 57.0, 58.3, 59.1]
        }
      };

      clientCache.set(`byma_hist_${mockBondAL30.symbol}`, mockBondAL30.historicalSeries);

      // Mockear canvas
      mockDocument.getElementById('bymaBonoChart');

      await tabByma.loadAndRenderChart(mockBondAL30);

      assert.equal(MockChart.constructorCalls, 1, 'Debe llamar al constructor de Chart exactamente 1 vez');
      assert.ok(appState.byma.chart, 'appState.byma.chart no debe ser nulo');
      assert.equal(appState.byma.chart.destroyCalls, 0, 'No debe destruir la instancia creada');

      // Verificar que es bono USD
      assert.equal(appState.byma.chart.data.datasets[0].borderColor, '#0a84ff');
      assert.match(appState.byma.chart.data.datasets[0].label, /USD/);
    });

    it('2.2. Cambio sucesivo de bono a Pesos (TX26) debe mutar in-place con update("active") SIN destruir ni recrear Chart', async () => {
      const { tabByma } = tabBymaModule;
      const { appState, clientCache } = stateModule;

      const initialChartInstance = appState.byma.chart;
      assert.ok(initialChartInstance, 'Debe haber una instancia previa');

      const mockBondTX26 = {
        symbol: 'TX26',
        denominationCcy: 'ARS',
        historicalSeries: {
          s: 'ok',
          t: [1700000000, 1700086400, 1700172800, 1700259200, 1700345600, 1700432000],
          c: [1200.0, 1220.5, 1215.0, 1250.0, 1280.0, 1300.0]
        }
      };

      clientCache.set(`byma_hist_${mockBondTX26.symbol}`, mockBondTX26.historicalSeries);

      await tabByma.loadAndRenderChart(mockBondTX26);

      // Aserciones empíricas de preservación in-place
      assert.equal(
        MockChart.constructorCalls,
        0,
        'NO se debe haber ejecutado new Chart() adicional (reutilización in-place)'
      );
      assert.equal(
        initialChartInstance.destroyCalls,
        0,
        'NO se debe haber ejecutado chart.destroy() al cambiar de bono'
      );
      assert.equal(
        appState.byma.chart,
        initialChartInstance,
        'La referencia del objeto Chart en appState debe ser exactamente la misma instancia en memoria'
      );

      // Verificación de llamada a update("active")
      assert.ok(
        initialChartInstance.updateCalls.includes('active'),
        'Debe haber ejecutado chart.update("active") para animación suave sin flicker'
      );

      // Verificación de mutación de datos y estilos en el dataset
      assert.equal(
        initialChartInstance.data.datasets[0].borderColor,
        '#30d158',
        'El color debe haberse actualizado in-place a verde (#30d158) para bonos en pesos'
      );
      assert.match(
        initialChartInstance.data.datasets[0].label,
        /ARS/,
        'La etiqueta debe reflejar ARS'
      );
      assert.deepEqual(
        initialChartInstance.data.datasets[0].data,
        mockBondTX26.historicalSeries.c,
        'Los datos numéricos del dataset deben coincidir con la serie del nuevo bono'
      );
    });

    it('2.3. Cambio sucesivo de rango temporal (30 días vs all) debe mutar in-place con update("active") sin destruir el canvas', async () => {
      const { tabByma } = tabBymaModule;
      const { appState, clientCache } = stateModule;

      const chartInstance = appState.byma.chart;
      const initialUpdateCount = chartInstance.updateCalls.length;

      const mockBond = {
        symbol: 'TX26',
        denominationCcy: 'ARS',
        historicalSeries: {
          s: 'ok',
          t: Array.from({ length: 80 }, (_, i) => 1700000000 + i * 86400),
          c: Array.from({ length: 80 }, (_, i) => 1000 + i * 5)
        }
      };

      clientCache.set(`byma_hist_${mockBond.symbol}`, mockBond.historicalSeries);

      // Cambiar rango a 30 días
      appState.byma.chartRange = '30';
      await tabByma.loadAndRenderChart(mockBond);

      assert.equal(MockChart.constructorCalls, 0, 'Constructor count no debe variar (0 new Chart)');
      assert.equal(chartInstance.destroyCalls, 0, 'Destroy no debe haberse ejecutado');
      assert.ok(
        chartInstance.data.datasets[0].data.length <= 25,
        'Los datos deben haber sido recortados in-place según el rango temporal seleccionado'
      );
      assert.ok(
        chartInstance.updateCalls.length > initialUpdateCount,
        'Debe haber ejecutado chart.update()'
      );
      assert.equal(
        chartInstance.updateCalls[chartInstance.updateCalls.length - 1],
        'active',
        'El modo de actualización debe seguir siendo "active"'
      );
    });

    it('2.4. Ante ausencia de datos históricos válidos, debe desregistrar y destruir limpiamente el gráfico', async () => {
      const { tabByma } = tabBymaModule;
      const { appState, clientCache } = stateModule;

      const chartInstance = appState.byma.chart;
      assert.ok(chartInstance, 'Debe haber un chart activo');

      const mockEmptyBond = {
        symbol: 'VACIO',
        denominationCcy: 'USD',
        historicalSeries: { s: 'ok', c: [] } // Serie vacía
      };

      clientCache.set(`byma_hist_${mockEmptyBond.symbol}`, mockEmptyBond.historicalSeries);

      await tabByma.loadAndRenderChart(mockEmptyBond);

      assert.equal(chartInstance.destroyCalls, 1, 'Debe invocar destroy() limpiamente al no haber datos');
      assert.equal(appState.byma.chart, null, 'appState.byma.chart debe resetearse a null');
    });
  });

  // =========================================================================
  // SECCIÓN 3: REACTIVIDAD DE TEMAS CLARO/OSCURO EN EL GRÁFICO DE BYMA
  // =========================================================================
  describe('3. Reactividad y Sincronización de Temas Claro/Oscuro', () => {
    it('3.1. updateChartThemeAll debe sincronizar colores de ejes y tooltips en la instancia de BYMA', async () => {
      const { tabByma } = tabBymaModule;
      const { appState, clientCache } = stateModule;
      const { updateChartThemeAll } = chartsModule;

      // Crear nuevo chart en tema oscuro
      mockBody.classList.add('dark-theme');
      const bond = {
        symbol: 'AL30',
        denominationCcy: 'USD',
        historicalSeries: {
          s: 'ok',
          t: [1700000000, 1700086400],
          c: [50, 52]
        }
      };

      clientCache.set(`byma_hist_${bond.symbol}`, bond.historicalSeries);

      await tabByma.loadAndRenderChart(bond);
      const chart = appState.byma.chart;
      assert.ok(chart, 'Chart debe crearse y registrarse');

      // 1. Alternar a tema claro
      updateChartThemeAll(false);

      assert.equal(
        chart.options.scales.x.ticks.color,
        '#64748b',
        'El texto del eje X debe actualizarse a #64748b en tema claro'
      );
      assert.equal(
        chart.options.scales.x.grid.color,
        'rgba(0, 0, 0, 0.06)',
        'La cuadrícula X debe actualizarse a rgba(0, 0, 0, 0.06) en tema claro'
      );
      assert.equal(
        chart.options.scales.y.ticks.color,
        '#64748b',
        'El texto del eje Y debe actualizarse a #64748b en tema claro'
      );
      assert.equal(
        chart.options.scales.y.grid.color,
        'rgba(0, 0, 0, 0.06)',
        'La cuadrícula Y debe actualizarse a rgba(0, 0, 0, 0.06) en tema claro'
      );
      assert.equal(
        chart.options.plugins.tooltip.backgroundColor,
        '#ffffff',
        'El fondo del tooltip debe ser blanco en tema claro'
      );
      assert.ok(
        chart.updateCalls.includes('none'),
        'Debe actualizarse con modo "none" para evitar animaciones molestas de tema'
      );

      // 2. Comprobar que una mutación in-place posterior conserva los colores de tema claro
      const bond2 = {
        symbol: 'AL30D',
        denominationCcy: 'USD',
        historicalSeries: {
          s: 'ok',
          t: [1700000000, 1700086400, 1700172800],
          c: [50, 52, 54]
        }
      };
      clientCache.set(`byma_hist_${bond2.symbol}`, bond2.historicalSeries);
      await tabByma.loadAndRenderChart(bond2);

      assert.equal(
        chart.options.scales.x.ticks.color,
        '#64748b',
        'Mutación in-place no debe sobreescribir los colores de ejes en tema claro'
      );
      assert.equal(
        chart.options.scales.x.grid.color,
        'rgba(0, 0, 0, 0.06)',
        'Mutación in-place debe preservar cuadrícula en tema claro'
      );

      // 3. Alternar a tema oscuro
      updateChartThemeAll(true);

      assert.equal(
        chart.options.scales.x.ticks.color,
        '#94a3b8',
        'El texto del eje X debe volver a #94a3b8 en tema oscuro'
      );
      assert.equal(
        chart.options.scales.x.grid.color,
        'rgba(255, 255, 255, 0.08)',
        'La cuadrícula X debe volver a rgba(255, 255, 255, 0.08) en tema oscuro'
      );
      assert.equal(
        chart.options.plugins.tooltip.backgroundColor,
        '#0f172a',
        'El fondo del tooltip debe volver a #0f172a en tema oscuro'
      );
    });
  });

  // =========================================================================
  // SECCIÓN 4: ESTRÉS DE CONMUTACIÓN DE PESTAÑAS SPA (ROBUST RUNTIME)
  // =========================================================================
  describe('4. Estrés de Navegación Rápida SPA', () => {
    it('4.1. Alternancia ráfaga (50x) entre tabBcra.init() y tabByma.init() no produce excepciones ni colapso de listeners', async () => {
      const { tabBcra } = tabBcraModule;
      const { tabByma } = tabBymaModule;
      const { clientCache } = stateModule;

      clientCache.set('bcra_catalog', [{ idVariable: 1, descripcion: 'Test' }]);
      clientCache.set('bcra_methodologies', {});
      clientCache.set('byma_panel_public', []);
      clientCache.set('byma_indicadores', {});

      for (let i = 0; i < 50; i++) {
        tabBcra.init();
        await tabByma.init();
      }

      assert.equal(tabBcra.initialized, true);
      assert.equal(tabByma.initialized, true);
    });
  });
});
