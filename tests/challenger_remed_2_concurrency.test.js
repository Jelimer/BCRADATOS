/**
 * tests/challenger_remed_2_concurrency.test.js
 * Suite Automatizada de Concurrencia y Alternancia Rápida de Temas para charts.js
 * Creada por challenger_remed_2.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

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

class ConcurrencyMockChart {
  static defaults = {};
  static registerCalled = [];

  static register(plugin) {
    ConcurrencyMockChart.registerCalled.push(plugin);
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

describe('Challenger Remed 2: Charts.js High-Concurrency & Rapid Theme Toggles', () => {
  let charts;
  let mockBody;
  let mockDocument;
  let originalCreateObjectURL;
  let originalRevokeObjectURL;

  before(async () => {
    mockBody = new MockDOMElement('body', 'body');
    mockBody.classList.add('dark-theme');

    mockDocument = {
      body: mockBody,
      createElement: (tag) => new MockDOMElement(`el-${Math.random()}`, tag)
    };

    globalThis.document = mockDocument;
    globalThis.window = { innerWidth: 1280 };
    globalThis.getComputedStyle = () => ({
      getPropertyValue: (prop) => (prop === '--primary' ? '#e31775' : '#00f0ff')
    });
    globalThis.Chart = ConcurrencyMockChart;

    originalCreateObjectURL = globalThis.URL?.createObjectURL;
    originalRevokeObjectURL = globalThis.URL?.revokeObjectURL;
    if (!globalThis.URL) globalThis.URL = {};
    globalThis.URL.createObjectURL = () => 'blob:http://localhost/fake-uuid';
    globalThis.URL.revokeObjectURL = () => {};

    const chartsModulePath = path.resolve(__dirname, '../public/js/modules/charts.js');
    const chartsUrl = `file://${chartsModulePath.replace(/\\/g, '/')}`;
    charts = await import(chartsUrl);
  });

  after(async () => {
    await new Promise(r => setTimeout(r, 1100));
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
  });

  describe('1. Alta Concurrencia de Ciclo de Vida', () => {
    it('1.1. 1.000 registros y desregistros concurrentes desde múltiples tareas asíncronas', async () => {
      const totalWorkers = 25;
      const chartsPerWorker = 40; // 1.000 gráficos
      const registered = [];

      const workers = Array.from({ length: totalWorkers }, async (_, wId) => {
        const batch = [];
        for (let i = 0; i < chartsPerWorker; i++) {
          const canvas = new MockDOMElement(`cv-${wId}-${i}`, 'canvas');
          mockBody.appendChild(canvas);
          const chart = new ConcurrencyMockChart({
            canvas,
            options: { scales: { x: { ticks: {} } } }
          });
          charts.registerChart(chart);
          batch.push(chart);
        }
        await new Promise(r => setImmediate(r));
        return batch;
      });

      const batches = await Promise.all(workers);
      batches.forEach(b => registered.push(...b));
      assert.equal(registered.length, 1000);

      // Desregistro concurrente con theme toggles
      const unregisterPromises = registered.slice(0, 500).map(async (c, idx) => {
        if (idx % 10 === 0) charts.updateChartThemeAll(idx % 2 === 0);
        mockBody.removeChild(c.canvas);
        charts.unregisterChart(c);
      });
      await Promise.all(unregisterPromises);

      const callsAtUnregister = new Map(registered.slice(0, 500).map(c => [c, c.updateCalls]));
      charts.updateChartThemeAll(true);

      const anyUpdatedPost = registered.slice(0, 500).some(c => c.updateCalls > callsAtUnregister.get(c));
      assert.strictEqual(anyUpdatedPost, false, 'Ningún gráfico desregistrado debe recibir updates');

      // Limpieza restante
      registered.slice(500).forEach(c => {
        mockBody.removeChild(c.canvas);
        charts.unregisterChart(c);
      });
    });
  });

  describe('2. Ráfagas de Alternancia Rápida de Temas y Re-entrancia', () => {
    it('2.1. 1.000 alternancias sincrónicas ultra-rápidas no saturan ni desincronizan las instancias', () => {
      const activeList = Array.from({ length: 10 }, (_, i) => {
        const canvas = new MockDOMElement(`t-${i}`, 'canvas');
        mockBody.appendChild(canvas);
        const c = new ConcurrencyMockChart({
          canvas,
          options: { scales: { x: { ticks: {} }, y: { ticks: {} } }, plugins: { tooltip: {} } }
        });
        charts.registerChart(c);
        return c;
      });

      for (let i = 0; i < 1000; i++) {
        charts.updateChartThemeAll(i % 2 === 0);
      }

      assert.ok(activeList.every(c => c.updateCalls === 1000));
      activeList.forEach(c => { mockBody.removeChild(c.canvas); charts.unregisterChart(c); });
    });

    it('2.2. Re-entrancia: llamadas a updateChartThemeAll dentro de update() no causan Deadlock ni Recursión Infinita', () => {
      let nestedExecuted = false;
      const reCanvas = new MockDOMElement('re-canvas', 'canvas');
      mockBody.appendChild(reCanvas);

      const reChart = new ConcurrencyMockChart({
        canvas: reCanvas,
        reentrantCallback: () => {
          charts.updateChartThemeAll(false);
          nestedExecuted = true;
        }
      });

      charts.registerChart(reChart);
      assert.doesNotThrow(() => charts.updateChartThemeAll(true));
      assert.strictEqual(nestedExecuted, true);

      mockBody.removeChild(reCanvas);
      charts.unregisterChart(reChart);
    });

    it('2.3. Poda inmediata cuando un chart lanza excepción en update() protegiendo a los demás', () => {
      const failingChart = new ConcurrencyMockChart({
        canvas: new MockDOMElement('failing', 'canvas'),
        shouldThrowOnUpdate: true
      });
      const okChart = new ConcurrencyMockChart({
        canvas: new MockDOMElement('ok', 'canvas'),
        options: { scales: { x: {} } }
      });

      mockBody.appendChild(failingChart.canvas);
      mockBody.appendChild(okChart.canvas);

      charts.registerChart(failingChart);
      charts.registerChart(okChart);

      assert.doesNotThrow(() => charts.updateChartThemeAll(false));
      assert.strictEqual(okChart.updateCalls, 1);

      // Segunda pasada: failingChart ya fue podado
      assert.doesNotThrow(() => charts.updateChartThemeAll(true));
      assert.strictEqual(okChart.updateCalls, 2);

      mockBody.removeChild(failingChart.canvas);
      mockBody.removeChild(okChart.canvas);
      charts.unregisterChart(okChart);
    });
  });

  describe('3. Poda Automática de Canvases Huérfanos', () => {
    it('3.1. Gráficos desconectados del DOM se podan de activeCharts sin fugas de memoria', () => {
      const orphans = Array.from({ length: 50 }, (_, i) => {
        const canvas = new MockDOMElement(`orphan-${i}`, 'canvas');
        mockBody.appendChild(canvas);
        const c = new ConcurrencyMockChart({ canvas });
        charts.registerChart(c);
        return c;
      });

      // Desconectar todos del DOM
      mockBody.children = [];

      // Activar poda en updateChartThemeAll
      charts.updateChartThemeAll(true);

      // Segunda pasada para comprobar que están completamente desvinculados
      charts.updateChartThemeAll(false);
      assert.strictEqual(orphans.every(c => c.updateCalls === 0), true);
    });
  });
});
