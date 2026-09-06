/**
 * charts.js
 * Fábrica y utilidades de Chart.js, plugins de canvas, gestión centralizada de temas
 * y exportación gráfica en alta resolución con marca de agua.
 */

import { formatValue, formatValueCompact } from './utils.js';

// Conjunto de instancias activas para sincronización unificada de temas
const activeCharts = new Set();

/**
 * Registra una instancia activa de Chart.js para su gestión transversal.
 * @param {Object} chart 
 */
export function registerChart(chart) {
  if (chart) activeCharts.add(chart);
}

/**
 * Desregistra y destruye una instancia de Chart.js si existe.
 * @param {Object} chart 
 */
export function unregisterChart(chart) {
  if (chart) {
    activeCharts.delete(chart);
    if (typeof chart.destroy === 'function') {
      chart.destroy();
    }
  }
}

/**
 * Plugin de Chart.js para dibujar etiquetas de MÁX y MÍN sobre los puntos extremos del canvas.
 */
export const maxMinLabelPlugin = {
  id: 'maxMinLabels',
  afterDatasetsDraw: (chart) => {
    const ctx = chart.ctx;
    ctx.save();

    const isDark = document.body.classList.contains('dark-theme');
    ctx.font = 'bold 10px Inter, sans-serif';
    ctx.fillStyle = isDark ? '#f8fafc' : '#0f172a';
    ctx.shadowColor = isDark ? 'rgba(0, 0, 0, 0.9)' : 'rgba(255, 255, 255, 0.9)';
    ctx.shadowBlur = 3;

    chart.data.datasets.forEach((dataset, datasetIndex) => {
      const meta = chart.getDatasetMeta(datasetIndex);
      if (!meta.visible || dataset.type === 'bar') return;

      const maxIdx = dataset.maxIdx;
      const minIdx = dataset.minIdx;
      const formatFn = dataset.formatLabel || (val => formatValue(val));

      // Dibujar etiqueta MÁX
      if (maxIdx !== undefined && maxIdx !== -1 && meta.data && meta.data[maxIdx]) {
        const point = meta.data[maxIdx];
        const val = dataset.data[maxIdx];
        if (val !== null && !isNaN(val)) {
          const text = `MÁX: ${formatFn(val)}`;
          const yPos = point.y - 8 < 15 ? point.y + 15 : point.y - 8;
          const textWidth = ctx.measureText(text).width;
          let xPos = point.x + 8;
          let align = 'left';
          if (point.x + 8 + textWidth > chart.width - 12) {
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
        if (val !== null && !isNaN(val)) {
          const text = `MÍN: ${formatFn(val)}`;
          const yPos = point.y + 15 > (chart.chartArea ? chart.chartArea.bottom : 300) ? point.y - 8 : point.y + 15;
          const textWidth = ctx.measureText(text).width;
          let xPos = point.x + 8;
          let align = 'left';
          if (point.x + 8 + textWidth > chart.width - 12) {
            xPos = point.x - 8;
            align = 'right';
          }
          ctx.textAlign = align;
          ctx.fillText(text, xPos, yPos);
        }
      }
    });
    ctx.restore();
  }
};

/**
 * Plugin de Chart.js para dar efecto de resplandor (glow) neón a las series de líneas.
 */
export const lineShadowPlugin = {
  id: 'lineShadow',
  beforeDatasetsDraw: (chart) => {
    if (chart.config.type !== 'line') return;
    const ctx = chart.ctx;
    ctx.save();
    const primaryColor = getComputedStyle(document.body).getPropertyValue('--primary').trim() || '#e31775';
    ctx.shadowColor = primaryColor;
    ctx.shadowBlur = 12;
    ctx.shadowOffsetY = 4;
  },
  afterDatasetsDraw: (chart) => {
    if (chart.config.type === 'line') {
      chart.ctx.restore();
    }
  }
};

/**
 * Actualiza el tema visual (colores de ejes, grids y tooltips) en todos los gráficos activos.
 * @param {boolean} isDark 
 */
export function updateChartThemeAll(isDark) {
  const textColor = isDark ? '#94a3b8' : '#64748b';
  const gridColor = isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.06)';

  for (const chart of activeCharts) {
    if (!chart || !chart.options) continue;

    if (chart.options.scales) {
      if (chart.options.scales.x) {
        if (chart.options.scales.x.ticks) chart.options.scales.x.ticks.color = textColor;
        if (chart.options.scales.x.grid) chart.options.scales.x.grid.color = gridColor;
      }
      if (chart.options.scales.y) {
        if (chart.options.scales.y.ticks) chart.options.scales.y.ticks.color = textColor;
        if (chart.options.scales.y.grid) chart.options.scales.y.grid.color = gridColor;
      }
    }

    if (chart.options.plugins && chart.options.plugins.tooltip) {
      chart.options.plugins.tooltip.backgroundColor = isDark ? '#0f172a' : '#ffffff';
      chart.options.plugins.tooltip.titleColor = isDark ? '#f8fafc' : '#0f172a';
      chart.options.plugins.tooltip.bodyColor = isDark ? '#94a3b8' : '#64748b';
      chart.options.plugins.tooltip.borderColor = gridColor;
    }

    chart.update('none');
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

    const isDark = document.body.classList.contains('dark-theme');
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
