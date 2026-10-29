/**
 * charts.js
 * Fábrica y utilidades de Chart.js, plugins de canvas, gestión centralizada de temas
 * y exportación gráfica en alta resolución con marca de agua.
 */

import { formatValue, formatValueCompact } from './utils.js';

// Conjunto de instancias activas para sincronización unificada de temas
const activeCharts = new Set();

/**
 * Plugin de retícula vertical (crosshair / vertical guide) sobre el punto activo al hacer hover.
 */
export const verticalCrosshairPlugin = {
  id: 'verticalCrosshair',
  afterDraw: (chart) => {
    if (chart.tooltip?._active?.length) {
      const activePoint = chart.tooltip._active[0];
      if (!activePoint?.element) return;
      const ctx = chart.ctx;
      const x = activePoint.element.x;
      const topY = chart.chartArea ? chart.chartArea.top : 0;
      const bottomY = chart.chartArea ? chart.chartArea.bottom : (chart.height || 300);
      const isDark = Boolean(typeof document !== 'undefined' && document.body?.classList?.contains?.('dark-theme'));

      ctx.save();
      ctx.beginPath();
      ctx.moveTo(x, topY);
      ctx.lineTo(x, bottomY);
      ctx.lineWidth = 1;
      ctx.strokeStyle = isDark ? 'rgba(255, 255, 255, 0.25)' : 'rgba(0, 0, 0, 0.15)';
      ctx.setLineDash([4, 4]);
      ctx.stroke();
      ctx.restore();
    }
  }
};

/**
 * Inicializa valores por defecto globales en Chart.js para consistencia estética transversal.
 */
export function setupChartGlobalDefaults() {
  if (typeof Chart === 'undefined') return;

  if (!Chart.defaults) Chart.defaults = {};
  if (!Chart.defaults.font) Chart.defaults.font = {};
  if (!Chart.defaults.plugins) Chart.defaults.plugins = {};
  if (!Chart.defaults.plugins.tooltip) Chart.defaults.plugins.tooltip = {};

  const isDark = Boolean(typeof document !== 'undefined' && document.body?.classList?.contains?.('dark-theme'));
  const textColor = isDark ? '#94a3b8' : '#64748b';
  const gridColor = isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.06)';

  Chart.defaults.font.family = "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
  Chart.defaults.font.size = 12;
  Chart.defaults.color = textColor;
  Chart.defaults.responsive = true;
  Chart.defaults.maintainAspectRatio = false;

  // Tooltips por defecto elegantes y estilizados
  Chart.defaults.plugins.tooltip.backgroundColor = isDark ? '#0f172a' : '#ffffff';
  Chart.defaults.plugins.tooltip.titleColor = isDark ? '#f8fafc' : '#0f172a';
  Chart.defaults.plugins.tooltip.bodyColor = isDark ? '#94a3b8' : '#64748b';
  Chart.defaults.plugins.tooltip.borderColor = gridColor;
  Chart.defaults.plugins.tooltip.borderWidth = 1;
  Chart.defaults.plugins.tooltip.padding = 12;
  Chart.defaults.plugins.tooltip.cornerRadius = 8;
  Chart.defaults.plugins.tooltip.boxPadding = 6;
  Chart.defaults.plugins.tooltip.usePointStyle = true;

  if (typeof Chart.register === 'function') {
    try {
      Chart.register(verticalCrosshairPlugin);
    } catch (e) {
      // Ignorar si ya estaba registrado
    }
  }
}

// Inicialización de valores predeterminados globales
setupChartGlobalDefaults();

/**
 * Registra una instancia activa de Chart.js para su gestión transversal.
 * @param {Object} chart 
 */
export function registerChart(chart) {
  if (chart) {
    activeCharts.add(chart);
    // Sincronizar colores de dataset según el tema activo al registrar
    const isDark = Boolean(typeof document !== 'undefined' && document.body?.classList?.contains?.('dark-theme'));
    if (!isDark && chart.data?.datasets && Array.isArray(chart.data.datasets)) {
      let updated = false;
      chart.data.datasets.forEach(ds => {
        if (ds.label && ds.label.includes('Oficial') && (ds.borderColor === '#ffffff' || ds.borderColor === '#f8fafc')) {
          ds.borderColor = '#0f172a';
          updated = true;
        }
      });
      if (updated && typeof chart.update === 'function') {
        try { chart.update('none'); } catch (e) {}
      }
    }
  }
}

/**
 * Desregistra y destruye una instancia de Chart.js si existe.
 * @param {Object} chart 
 */
export function unregisterChart(chart) {
  if (chart) {
    activeCharts.delete(chart);
    if (typeof chart.destroy === 'function') {
      try {
        chart.destroy();
      } catch (e) {
        // Ignorar si ya fue destruido
      }
    }
  }
}

/**
 * Plugin de Chart.js para dibujar etiquetas de MÁX y MÍN sobre los puntos extremos del canvas.
 * Desactivado automáticamente en gráficos de barras o series secundarias para evitar solapamientos.
 */
export const maxMinLabelPlugin = {
  id: 'maxMinLabels',
  afterDatasetsDraw: (chart) => {
    // Si el gráfico raíz es de barras, no dibujar etiquetas de extremos
    if (chart.config?.type === 'bar') return;

    const ctx = chart.ctx;
    ctx.save();

    const isDark = Boolean(typeof document !== 'undefined' && document.body?.classList?.contains?.('dark-theme'));
    ctx.font = 'bold 10px Inter, sans-serif';
    ctx.fillStyle = isDark ? '#f8fafc' : '#0f172a';
    ctx.shadowColor = isDark ? 'rgba(0, 0, 0, 0.9)' : 'rgba(255, 255, 255, 0.9)';
    ctx.shadowBlur = 3;

    if (chart.data?.datasets && Array.isArray(chart.data.datasets)) {
      chart.data.datasets.forEach((dataset, datasetIndex) => {
        const meta = typeof chart.getDatasetMeta === 'function' ? chart.getDatasetMeta(datasetIndex) : null;
        if (!meta || !meta.visible || dataset.type === 'bar') return;

        // En gráficos multi-serie, solo mostrar extremos en dataset primario o si está habilitado explícitamente
        if (chart.data.datasets.length > 1 && dataset.showMaxMin !== true && datasetIndex !== 0) return;

        const maxIdx = dataset.maxIdx;
        const minIdx = dataset.minIdx;
        const formatFn = dataset.formatLabel || (val => formatValue(val));
        const chartBottom = chart.chartArea ? chart.chartArea.bottom : (chart.height ? chart.height - 20 : 300);
        const chartTop = chart.chartArea ? chart.chartArea.top : 20;

        // Dibujar etiqueta MÁX
        if (maxIdx !== undefined && maxIdx !== -1 && meta.data && meta.data[maxIdx]) {
          const point = meta.data[maxIdx];
          const val = dataset.data[maxIdx];
          if (val !== null && val !== undefined && !isNaN(val)) {
            const text = `MÁX: ${formatFn(val)}`;
            const yPos = Math.max(chartTop + 14, point.y - 8);
            const textWidth = ctx.measureText ? ctx.measureText(text).width : 50;
            let xPos = point.x + 8;
            let align = 'left';
            if (point.x + 8 + textWidth > (chart.width || 400) - 12) {
              xPos = point.x - 8;
              align = 'right';
            }
            ctx.textAlign = align;
            ctx.fillText(text, xPos, yPos);
          }
        }

        // Dibujar etiqueta MÍN
        if (minIdx !== undefined && minIdx !== -1 && meta.data && meta.data[minIdx]) {
          const point = meta.data[minIdx];
          const val = dataset.data[minIdx];
          if (val !== null && val !== undefined && !isNaN(val)) {
            const text = `MÍN: ${formatFn(val)}`;
            const yPos = Math.min(chartBottom - 6, point.y + 15);
            const textWidth = ctx.measureText ? ctx.measureText(text).width : 50;
            let xPos = point.x + 8;
            let align = 'left';
            if (point.x + 8 + textWidth > (chart.width || 400) - 12) {
              xPos = point.x - 8;
              align = 'right';
            }
            ctx.textAlign = align;
            ctx.fillText(text, xPos, yPos);
          }
        }
      });
    }
    ctx.restore();
  }
};

/**
 * Plugin de Chart.js para dar efecto de resplandor (glow) neón armónico a las series de líneas.
 */
export const lineShadowPlugin = {
  id: 'lineShadow',
  beforeDatasetsDraw: (chart) => {
    if (chart.config?.type !== 'line') return;
    const ctx = chart.ctx;
    ctx.save();
    const firstDs = chart.data?.datasets?.[0];
    const dsColor = (firstDs && typeof firstDs.borderColor === 'string')
      ? firstDs.borderColor
      : ((typeof document !== 'undefined' && document.body && typeof getComputedStyle === 'function' && getComputedStyle(document.body)?.getPropertyValue?.('--primary')?.trim?.()) || '#e31775');
    ctx.shadowColor = dsColor;
    ctx.shadowBlur = 10;
    ctx.shadowOffsetY = 3;
  },
  afterDatasetsDraw: (chart) => {
    if (chart.config?.type === 'line') {
      chart.ctx.restore();
    }
  }
};

/**
 * Actualiza el tema visual (colores de ejes, grids, leyendas y tooltips) en todos los gráficos activos.
 * @param {boolean} isDark 
 */
export function updateChartThemeAll(isDark) {
  const textColor = isDark ? '#94a3b8' : '#64748b';
  const gridColor = isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.06)';

  for (const chart of [...activeCharts]) {
    // Poda de referencias huérfanas o destruidas
    const isDetached = Boolean(chart?.canvas && typeof document !== 'undefined' && typeof document.body?.contains === 'function' && !document.body.contains(chart.canvas));
    if (!chart || chart.isDestroyed || isDetached) {
      activeCharts.delete(chart);
      continue;
    }

    if (chart.options?.scales) {
      if (chart.options.scales.x) {
        if (chart.options.scales.x.ticks) chart.options.scales.x.ticks.color = textColor;
        if (chart.options.scales.x.grid) chart.options.scales.x.grid.color = gridColor;
      }
      if (chart.options.scales.y) {
        if (chart.options.scales.y.ticks) chart.options.scales.y.ticks.color = textColor;
        if (chart.options.scales.y.grid) chart.options.scales.y.grid.color = gridColor;
      }
    }

    if (chart.options?.plugins) {
      if (chart.options.plugins.tooltip) {
        chart.options.plugins.tooltip.backgroundColor = isDark ? '#0f172a' : '#ffffff';
        chart.options.plugins.tooltip.titleColor = isDark ? '#f8fafc' : '#0f172a';
        chart.options.plugins.tooltip.bodyColor = isDark ? '#94a3b8' : '#64748b';
        chart.options.plugins.tooltip.borderColor = gridColor;
      }
      if (chart.options.plugins.legend?.labels) {
        chart.options.plugins.legend.labels.color = textColor;
      }
    }

    // Actualizar colores dependientes del tema en datasets (ej. Dólar Oficial)
    if (chart.data?.datasets && Array.isArray(chart.data.datasets)) {
      chart.data.datasets.forEach(ds => {
        if (ds.label && ds.label.includes('Oficial')) {
          if (ds.borderColor === '#ffffff' || ds.borderColor === '#0f172a' || ds.borderColor === '#1e293b' || ds.borderColor === '#f8fafc') {
            ds.borderColor = isDark ? '#ffffff' : '#0f172a';
          }
        }
      });
    }

    try {
      if (typeof chart.update === 'function') {
        chart.update('none');
      }
    } catch (e) {
      activeCharts.delete(chart);
    }
  }
}

/**
 * Exporta un gráfico de Chart.js como archivo PNG en alta calidad con marca de agua y fondo adaptativo.
 * @param {Object} chartInstance 
 * @param {string} filename 
 */
export function downloadChartPNG(chartInstance, filename = 'grafico.png') {
  if (!chartInstance) {
    return;
  }

  try {
    const originalCanvas = chartInstance.canvas;
    const width = originalCanvas.width;
    const height = originalCanvas.height;

    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = width;
    tempCanvas.height = height;
    const tempCtx = tempCanvas.getContext('2d');

    const isDark = Boolean(typeof document !== 'undefined' && document.body?.classList?.contains?.('dark-theme'));
    tempCtx.fillStyle = isDark ? '#0f172a' : '#ffffff';
    tempCtx.fillRect(0, 0, width, height);

    tempCtx.drawImage(originalCanvas, 0, 0);

    // Marca de agua
    tempCtx.save();
    tempCtx.font = 'bold 16px Inter, Outfit, sans-serif';
    tempCtx.fillStyle = isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(15, 23, 42, 0.05)';
    tempCtx.textAlign = 'center';
    tempCtx.textBaseline = 'middle';
    tempCtx.translate(width / 2, height / 2);
    tempCtx.rotate(-Math.PI / 12);
    tempCtx.fillText('bcradatos.vercel.app', 0, 0);
    tempCtx.restore();

    tempCanvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.download = filename;
      link.href = url;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, 'image/png');
  } catch (err) {
    console.error('Error al exportar gráfico a PNG:', err);
  }
}
