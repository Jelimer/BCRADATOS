/**
 * tabIndec.js
 * Controlador de la pestaña de Inflación y Actividad Económica (INDEC):
 * IPC mensual general, núcleo, inflación interanual acumulada (YoY 12 meses),
 * salarios estables RIPTE, estimador mensual de actividad EMAE y gráfico
 * multi-métrica con base 100 Salario vs Inflación.
 */

import { fetchIndecSeries } from './api.js';
import { clientCache, appState } from './state.js';
import { formatValue, formatDate } from './utils.js';
import { maxMinLabelPlugin, registerChart, downloadChartPNG } from './charts.js';
import { showToast } from './ui.js';

export const tabIndec = {
  initialized: false,

  async init() {
    if (this.initialized) return;

    // Configurar event listeners de INDEC
    const indecRanges = document.getElementById('indecRanges');
    if (indecRanges) {
      indecRanges.addEventListener('click', (e) => {
        const btn = e.target.closest('.range-btn');
        if (!btn) return;
        document.querySelectorAll('#indecRanges .range-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        appState.indec.days = btn.getAttribute('data-days') === 'all' ? 'all' : parseInt(btn.getAttribute('data-days'), 10);
        this.processAndRender();
      });
    }

    const applyDatesBtn = document.getElementById('applyIndecDatesBtn');
    if (applyDatesBtn) {
      applyDatesBtn.addEventListener('click', () => this.applyManualDatesFilter());
    }

    const btnIpc = document.getElementById('btnShowIpc');
    const btnEmae = document.getElementById('btnShowEmae');
    const btnSalarios = document.getElementById('btnShowSalarios');

    if (btnIpc) btnIpc.addEventListener('click', () => this.switchMetric('ipc'));
    if (btnEmae) btnEmae.addEventListener('click', () => this.switchMetric('emae'));
    if (btnSalarios) btnSalarios.addEventListener('click', () => this.switchMetric('salarios'));

    const btnDownload = document.getElementById('btnDownloadIndecChart');
    if (btnDownload) {
      btnDownload.addEventListener('click', () => {
        downloadChartPNG(appState.indec.chart, `indec_${appState.indec.activeMetric}.png`);
      });
    }

    await this.fetchData();
    this.initialized = true;
  },

  applyManualDatesFilter() {
    const startStr = document.getElementById('indecStartDate').value;
    const endStr = document.getElementById('indecEndDate').value;
    if (!startStr || !endStr) {
      showToast('Selecciona ambas fechas.', 'warning');
      return;
    }
    if (new Date(startStr) > new Date(endStr)) {
      showToast('Fecha de inicio posterior a la fecha de fin.', 'warning');
      return;
    }
    document.querySelectorAll('#indecRanges .range-btn').forEach(b => b.classList.remove('active'));
    appState.indec.days = 'manual';
    this.processAndRender();
  },

  async fetchData() {
    const cached = clientCache.get('indec_series_data');
    if (cached) {
      appState.indec.raw = cached.raw;
      appState.indec.parsedData = cached.parsedData;
      const dates = appState.indec.parsedData.map(d => d.date);
      if (dates.length > 0) {
        document.getElementById('indecStartDate').value = dates[0];
        document.getElementById('indecEndDate').value = dates[dates.length - 1];
        document.getElementById('indecStartDate').min = dates[0];
        document.getElementById('indecStartDate').max = dates[dates.length - 1];
        document.getElementById('indecEndDate').min = dates[0];
        document.getElementById('indecEndDate').max = dates[dates.length - 1];
      }
      this.processAndRender();
      return;
    }

    const loader = document.getElementById('loadingIndecOverlay');
    if (loader) loader.classList.remove('hidden');

    try {
      const ids = '145.3_INGNACUAL_DICI_M_38,148.3_INUCLEONAL_DICI_M_19,158.1_REPTE_0_0_5,143.3_NO_PR_2004_A_31,143.3_NO_PR_2004_A_21';
      const raw = await fetchIndecSeries(ids, 1000);
      appState.indec.raw = raw;

      const fields = raw.meta.slice(1).map(m => m.field.id);
      appState.indec.parsedData = raw.data.map(row => {
        const entry = { date: row[0] };
        fields.forEach((fid, index) => {
          let val = parseFloat(row[index + 1]);
          if (fid === '145.3_INGNACUAL_DICI_M_38' && val !== null && !isNaN(val)) {
            val = val * 100;
          }
          entry[fid] = val;
        });
        return entry;
      }).filter(e => e.date).sort((a, b) => a.date.localeCompare(b.date));

      // Calcular variación mensual de inflación núcleo
      appState.indec.parsedData.forEach((entry, idx, arr) => {
        if (idx === 0) {
          entry['148.3_INUCLEONAL_DICI_M_19_variacion'] = null;
        } else {
          const prev = arr[idx - 1];
          const valPrev = prev['148.3_INUCLEONAL_DICI_M_19'];
          const valAct = entry['148.3_INUCLEONAL_DICI_M_19'];
          if (valPrev > 0 && valAct > 0) {
            entry['148.3_INUCLEONAL_DICI_M_19_variacion'] = ((valAct - valPrev) / valPrev) * 100;
          } else {
            entry['148.3_INUCLEONAL_DICI_M_19_variacion'] = null;
          }
        }
      });

      clientCache.set('indec_series_data', { raw: appState.indec.raw, parsedData: appState.indec.parsedData }, 10 * 60 * 1000);

      const dates = appState.indec.parsedData.map(d => d.date);
      if (dates.length > 0) {
        document.getElementById('indecStartDate').value = dates[0];
        document.getElementById('indecEndDate').value = dates[dates.length - 1];
        document.getElementById('indecStartDate').min = dates[0];
        document.getElementById('indecStartDate').max = dates[dates.length - 1];
        document.getElementById('indecEndDate').min = dates[0];
        document.getElementById('indecEndDate').max = dates[dates.length - 1];
      }

      this.processAndRender();
      showToast('Datos del INDEC cargados con éxito.', 'success');
    } catch (error) {
      console.error(error);
      showToast('Error al descargar datos macroeconómicos.', 'danger');
    } finally {
      if (loader) loader.classList.add('hidden');
    }
  },

  processAndRender() {
    const data = appState.indec.parsedData;
    if (data.length === 0) return;

    const len = data.length;

    let latestIpc = null;
    for (let i = len - 1; i >= 0; i--) {
      if (data[i]['145.3_INGNACUAL_DICI_M_38'] !== null && !isNaN(data[i]['145.3_INGNACUAL_DICI_M_38'])) {
        latestIpc = data[i];
        break;
      }
    }

    let latestRipte = null;
    for (let i = len - 1; i >= 0; i--) {
      if (data[i]['158.1_REPTE_0_0_5'] !== null && !isNaN(data[i]['158.1_REPTE_0_0_5'])) {
        latestRipte = data[i];
        break;
      }
    }

    let latestEmae = null;
    let emaeIndexInGeneral = -1;
    for (let i = len - 1; i >= 0; i--) {
      if (data[i]['143.3_NO_PR_2004_A_21'] !== null && !isNaN(data[i]['143.3_NO_PR_2004_A_21'])) {
        latestEmae = data[i];
        emaeIndexInGeneral = i;
        break;
      }
    }

    // 1. Poblar KPIs
    const ipcMensual = latestIpc ? latestIpc['145.3_INGNACUAL_DICI_M_38'] : null;
    document.getElementById('ipcMensualValue').textContent = ipcMensual !== null ? `${ipcMensual.toFixed(1)}%` : '-';
    document.getElementById('ipcMensualDate').textContent = latestIpc ? formatDate(latestIpc.date) : '-';

    let ipcAnualVal = 0;
    let validIpcMonths = [];
    for (let i = len - 1; i >= 0; i--) {
      const val = data[i]['145.3_INGNACUAL_DICI_M_38'];
      if (val !== null && !isNaN(val)) {
        validIpcMonths.unshift(val);
        if (validIpcMonths.length === 12) break;
      }
    }
    if (validIpcMonths.length === 12) {
      let acum = 1;
      validIpcMonths.forEach(tasa => {
        acum *= (1 + tasa / 100);
      });
      ipcAnualVal = (acum - 1) * 100;
    }
    document.getElementById('ipcAnualValue').textContent = ipcAnualVal > 0 ? `${ipcAnualVal.toFixed(1)}%` : '-';
    document.getElementById('ipcAnualDate').textContent = `Acumulado 12 Meses`;

    const ripte = latestRipte ? latestRipte['158.1_REPTE_0_0_5'] : null;
    document.getElementById('ripteValue').textContent = ripte ? `$${formatValue(ripte)}` : '-';
    document.getElementById('ripteDate').textContent = latestRipte ? `Salario promedio a ${formatDate(latestRipte.date).slice(3)}` : '-';

    let emaeYoY = 0;
    if (emaeIndexInGeneral >= 12 && latestEmae) {
      const emaeAct = latestEmae['143.3_NO_PR_2004_A_21'];
      const targetDateObj = new Date(latestEmae.date);
      targetDateObj.setFullYear(targetDateObj.getFullYear() - 1);
      const targetDateStr = targetDateObj.toISOString().split('T')[0].slice(0, 7);

      let emaePrevObj = null;
      for (let i = emaeIndexInGeneral - 1; i >= 0; i--) {
        if (data[i].date.startsWith(targetDateStr)) {
          emaePrevObj = data[i];
          break;
        }
      }
      const emaePrev = emaePrevObj ? emaePrevObj['143.3_NO_PR_2004_A_21'] : data[emaeIndexInGeneral - 12]['143.3_NO_PR_2004_A_21'];
      if (emaePrev > 0) {
        emaeYoY = ((emaeAct - emaePrev) / emaePrev) * 100;
      }
    }
    document.getElementById('emaeValue').textContent = emaeYoY !== 0 ? (emaeYoY >= 0 ? '+' : '') + emaeYoY.toFixed(1) + '%' : '-';
    if (latestEmae) {
      document.getElementById('emaeDate').textContent = `Var. Interanual a ${formatDate(latestEmae.date).slice(3)}`;
    }

    // 2. Filtrar por rango
    let filtered = [...data];
    if (appState.indec.days !== 'all' && appState.indec.days !== 'manual') {
      const targetDate = new Date();
      targetDate.setDate(targetDate.getDate() - appState.indec.days);
      const targetStr = targetDate.toISOString().split('T')[0];
      filtered = data.filter(d => d.date >= targetStr);
      if (filtered.length > 0) {
        document.getElementById('indecStartDate').value = filtered[0].date;
        document.getElementById('indecEndDate').value = filtered[filtered.length - 1].date;
      }
    } else if (appState.indec.days === 'all') {
      if (data.length > 0) {
        document.getElementById('indecStartDate').value = data[0].date;
        document.getElementById('indecEndDate').value = data[data.length - 1].date;
      }
    } else if (appState.indec.days === 'manual') {
      const startStr = document.getElementById('indecStartDate').value;
      const endStr = document.getElementById('indecEndDate').value;
      filtered = data.filter(d => d.date >= startStr && d.date <= endStr);
    }

    // 3. Renderizar gráfico
    this.renderChart(filtered);
  },

  switchMetric(metric) {
    appState.indec.activeMetric = metric;

    const btnIpc = document.getElementById('btnShowIpc');
    const btnEmae = document.getElementById('btnShowEmae');
    const btnSalarios = document.getElementById('btnShowSalarios');

    btnIpc.className = 'btn btn-secondary btn-sm';
    btnIpc.style.backgroundColor = '';
    btnEmae.className = 'btn btn-secondary btn-sm';
    btnEmae.style.backgroundColor = '';
    btnSalarios.className = 'btn btn-secondary btn-sm';
    btnSalarios.style.backgroundColor = '';

    if (metric === 'ipc') {
      btnIpc.classList.add('active', 'btn-primary');
      btnIpc.style.backgroundColor = 'var(--theme-indec)';
    } else if (metric === 'emae') {
      btnEmae.classList.add('active', 'btn-primary');
      btnEmae.style.backgroundColor = 'var(--theme-indec)';
    } else {
      btnSalarios.classList.add('active', 'btn-primary');
      btnSalarios.style.backgroundColor = 'var(--theme-indec)';
    }

    this.processAndRender();
  },

  renderChart(chartData) {
    const canvas = document.getElementById('indecChart');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const isDark = document.body.classList.contains('dark-theme');
    const textColor = isDark ? '#94a3b8' : '#64748b';
    const gridColor = isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.06)';

    const labels = chartData.map(d => formatDate(d.date).slice(3));
    let datasets = [];

    if (appState.indec.activeMetric === 'ipc') {
      const ipcData = chartData.map(d => d['145.3_INGNACUAL_DICI_M_38']);
      const nucleoData = chartData.map(d => d['148.3_INUCLEONAL_DICI_M_19_variacion']);

      let maxIdxG = -1, minIdxG = -1, maxValG = -Infinity, minValG = Infinity;
      ipcData.forEach((val, idx) => {
        if (val !== null && !isNaN(val)) {
          if (val > maxValG) { maxValG = val; maxIdxG = idx; }
          if (val < minValG) { minValG = val; minIdxG = idx; }
        }
      });

      let maxIdxN = -1, minIdxN = -1, maxValN = -Infinity, minValN = Infinity;
      nucleoData.forEach((val, idx) => {
        if (val !== null && !isNaN(val)) {
          if (val > maxValN) { maxValN = val; maxIdxN = idx; }
          if (val < minValN) { minValN = val; minIdxN = idx; }
        }
      });

      const pointRadiiG = ipcData.map((val, idx) => (idx === maxIdxG || idx === minIdxG) ? 7 : (ipcData.length > 80 ? 0 : 3.5));
      const pointBgColorsG = ipcData.map((val, idx) => (idx === maxIdxG || idx === minIdxG) ? '#ffd60a' : '#bf5af2');
      const pointHoverRadiiG = ipcData.map((val, idx) => (idx === maxIdxG || idx === minIdxG) ? 9 : 6);

      const pointRadiiN = nucleoData.map((val, idx) => (idx === maxIdxN || idx === minIdxN) ? 7 : (nucleoData.length > 80 ? 0 : 3));
      const pointBgColorsN = nucleoData.map((val, idx) => (idx === maxIdxN || idx === minIdxN) ? '#ffd60a' : '#f43f5e');
      const pointHoverRadiiN = nucleoData.map((val, idx) => (idx === maxIdxN || idx === minIdxN) ? 9 : 5);

      datasets = [
        {
          label: 'Inflación Mensual General (%)',
          data: ipcData,
          borderColor: '#bf5af2',
          backgroundColor: 'rgba(191, 90, 242, 0.15)',
          fill: true,
          tension: 0.15,
          borderWidth: 2,
          pointRadius: pointRadiiG,
          pointBackgroundColor: pointBgColorsG,
          pointBorderColor: '#ffffff',
          pointBorderWidth: 1.5,
          pointHoverRadius: pointHoverRadiiG,
          maxIdx: maxIdxG,
          minIdx: minIdxG,
          formatLabel: val => val.toFixed(1) + '%'
        },
        {
          label: 'Inflación Núcleo (%)',
          data: nucleoData,
          borderColor: '#f43f5e',
          borderDash: [5, 5],
          backgroundColor: 'transparent',
          fill: false,
          tension: 0.15,
          borderWidth: 1.5,
          pointRadius: pointRadiiN,
          pointBackgroundColor: pointBgColorsN,
          pointBorderColor: '#ffffff',
          pointBorderWidth: 1.5,
          pointHoverRadius: pointHoverRadiiN,
          maxIdx: maxIdxN,
          minIdx: minIdxN,
          formatLabel: val => val.toFixed(1) + '%'
        }
      ];
    } else if (appState.indec.activeMetric === 'emae') {
      const emaeYoYList = chartData.map((d) => {
        const fullIdx = appState.indec.parsedData.findIndex(x => x.date === d.date);
        if (fullIdx >= 12) {
          const act = appState.indec.parsedData[fullIdx]['143.3_NO_PR_2004_A_21'];
          const prev = appState.indec.parsedData[fullIdx - 12]['143.3_NO_PR_2004_A_21'];
          return prev > 0 ? ((act - prev) / prev) * 100 : 0;
        }
        return 0;
      });

      let maxIdx = -1, minIdx = -1, maxVal = -Infinity, minVal = Infinity;
      emaeYoYList.forEach((val, idx) => {
        if (val !== null && !isNaN(val)) {
          if (val > maxVal) { maxVal = val; maxIdx = idx; }
          if (val < minVal) { minVal = val; minIdx = idx; }
        }
      });

      const barBgColors = emaeYoYList.map((val, idx) => (idx === maxIdx || idx === minIdx) ? '#ffd60a' : 'rgba(255, 214, 10, 0.2)');
      const barBorderColors = emaeYoYList.map((val, idx) => (idx === maxIdx || idx === minIdx) ? '#ffd60a' : '#ffd60a');

      datasets = [
        {
          label: 'Crecimiento de la Actividad Económica (EMAE YoY %)',
          data: emaeYoYList,
          borderColor: barBorderColors,
          backgroundColor: barBgColors,
          fill: true,
          type: 'bar',
          borderWidth: 1.5,
          maxIdx: maxIdx,
          minIdx: minIdx,
          formatLabel: val => val.toFixed(1) + '%'
        }
      ];
    } else if (appState.indec.activeMetric === 'salarios') {
      let baseIpc = 100;
      let baseRipte = 100;

      const ipcAcumulado = [];
      const ripteAcumulado = [];

      chartData.forEach((d, idx) => {
        if (idx === 0) {
          ipcAcumulado.push(100);
          ripteAcumulado.push(100);
        } else {
          const tasaIpc = d['145.3_INGNACUAL_DICI_M_38'] || 0;
          baseIpc *= (1 + tasaIpc / 100);
          ipcAcumulado.push(baseIpc);

          const ripteActual = d['158.1_REPTE_0_0_5'];
          const ripteBaseVal = chartData[0]['158.1_REPTE_0_0_5'];
          const ripteIdx = ripteBaseVal > 0 ? (ripteActual / ripteBaseVal) * 100 : 100;
          ripteAcumulado.push(ripteIdx);
        }
      });

      let maxIdxR = -1, minIdxR = -1, maxValR = -Infinity, minValR = Infinity;
      ripteAcumulado.forEach((val, idx) => {
        if (val !== null && !isNaN(val)) {
          if (val > maxValR) { maxValR = val; maxIdxR = idx; }
          if (val < minValR) { minValR = val; minIdxR = idx; }
        }
      });

      let maxIdxI = -1, minIdxI = -1, maxValI = -Infinity, minValI = Infinity;
      ipcAcumulado.forEach((val, idx) => {
        if (val !== null && !isNaN(val)) {
          if (val > maxValI) { maxValI = val; maxIdxI = idx; }
          if (val < minValI) { minValI = val; minIdxI = idx; }
        }
      });

      const pointRadiiR = ripteAcumulado.map((val, idx) => (idx === maxIdxR || idx === minIdxR) ? 7 : (ripteAcumulado.length > 80 ? 0 : 3.5));
      const pointBgColorsR = ripteAcumulado.map((val, idx) => (idx === maxIdxR || idx === minIdxR) ? '#ffd60a' : '#00f0ff');
      const pointHoverRadiiR = ripteAcumulado.map((val, idx) => (idx === maxIdxR || idx === minIdxR) ? 9 : 6);

      const pointRadiiI = ipcAcumulado.map((val, idx) => (idx === maxIdxI || idx === minIdxI) ? 7 : (ipcAcumulado.length > 80 ? 0 : 3.5));
      const pointBgColorsI = ipcAcumulado.map((val, idx) => (idx === maxIdxI || idx === minIdxI) ? '#ffd60a' : '#bf5af2');
      const pointHoverRadiiI = ipcAcumulado.map((val, idx) => (idx === maxIdxI || idx === minIdxI) ? 9 : 6);

      datasets = [
        {
          label: 'Evolución de Salarios RIPTE (Base 100)',
          data: ripteAcumulado,
          borderColor: '#00f0ff',
          backgroundColor: 'transparent',
          fill: false,
          tension: 0.1,
          borderWidth: 2.5,
          pointRadius: pointRadiiR,
          pointBackgroundColor: pointBgColorsR,
          pointBorderColor: '#ffffff',
          pointBorderWidth: 1.5,
          pointHoverRadius: pointHoverRadiiR,
          maxIdx: maxIdxR,
          minIdx: minIdxR,
          formatLabel: val => val.toFixed(1)
        },
        {
          label: 'Evolución del Costo de Vida IPC (Base 100)',
          data: ipcAcumulado,
          borderColor: '#bf5af2',
          backgroundColor: 'transparent',
          fill: false,
          tension: 0.1,
          borderWidth: 2.5,
          pointRadius: pointRadiiI,
          pointBackgroundColor: pointBgColorsI,
          pointBorderColor: '#ffffff',
          pointBorderWidth: 1.5,
          pointHoverRadius: pointHoverRadiiI,
          maxIdx: maxIdxI,
          minIdx: minIdxI,
          formatLabel: val => val.toFixed(1)
        }
      ];
    }

    if (appState.indec.chart) {
      appState.indec.chart.data.labels = labels;
      appState.indec.chart.data.datasets = datasets;
      appState.indec.chart.update('active');
      return;
    }

    appState.indec.chart = new Chart(ctx, {
      type: 'line',
      plugins: [maxMinLabelPlugin],
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: true, labels: { color: textColor, font: { family: 'Inter', size: 11 } } },
          tooltip: {
            backgroundColor: isDark ? '#0f172a' : '#ffffff',
            titleColor: isDark ? '#f8fafc' : '#0f172a',
            bodyColor: isDark ? '#94a3b8' : '#64748b',
            borderColor: gridColor,
            borderWidth: 1,
          }
        },
        scales: {
          x: { grid: { display: false }, ticks: { color: textColor } },
          y: { grid: { color: gridColor }, ticks: { color: textColor } }
        }
      }
    });

    registerChart(appState.indec.chart);
  }
};
