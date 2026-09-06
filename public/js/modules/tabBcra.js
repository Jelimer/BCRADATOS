/**
 * tabBcra.js
 * Controlador de la pestaña de Estadísticas Monetarias del BCRA:
 * Catálogo interactivo de variables, favoritos, KPIs dinámicos, series temporales,
 * gráfico reactivo (línea/barra), tabla paginada y exportación a CSV.
 */

import { fetchBcraCatalog, fetchBcraMethodology, fetchBcraHistorical } from './api.js';
import { clientCache, appState } from './state.js';
import { formatValue, formatValueCompact, formatDate, debounce, downloadBlob } from './utils.js';
import { maxMinLabelPlugin, lineShadowPlugin, registerChart, downloadChartPNG } from './charts.js';
import { showToast, showDataLoader } from './ui.js';

export const tabBcra = {
  initialized: false,

  // Cache de referencias al DOM del módulo BCRA
  dom: {},

  init() {
    this.cacheDomElements();
    this.setupEventListeners();
    this.fetchCatalog();
    this.fetchMethodologies();
    this.initialized = true;
  },

  cacheDomElements() {
    this.dom = {
      sidebar: document.getElementById('sidebar'),
      toggleSidebarBtn: document.getElementById('toggleSidebarBtn'),
      variableSearch: document.getElementById('variableSearch'),
      variablesList: document.getElementById('variablesList'),
      loadingVariables: document.getElementById('loadingVariables'),
      errorVariables: document.getElementById('errorVariables'),
      retryVariablesBtn: document.getElementById('retryVariablesBtn'),
      selectedVariableNameTitle: document.getElementById('selectedVariableNameTitle'),
      welcomeScreen: document.getElementById('welcomeScreen'),
      dashboardContent: document.getElementById('dashboardContent'),
      startBtn: document.getElementById('startBtn'),
      latestValue: document.getElementById('latestValue'),
      latestDate: document.getElementById('latestDate'),
      changeValue: document.getElementById('changeValue'),
      changePercent: document.getElementById('changePercent'),
      kpiChangeIconWrapper: document.getElementById('kpiChangeIconWrapper'),
      kpiChangeIcon: document.getElementById('kpiChangeIcon'),
      maxValue: document.getElementById('maxValue'),
      maxDate: document.getElementById('maxDate'),
      minValue: document.getElementById('minValue'),
      minDate: document.getElementById('minDate'),
      quickRanges: document.getElementById('quickRanges'),
      startDate: document.getElementById('startDate'),
      endDate: document.getElementById('endDate'),
      applyDatesBtn: document.getElementById('applyDatesBtn'),
      exportCsvBtn: document.getElementById('exportCsvBtn'),
      btnTabChart: document.getElementById('btnTabChart'),
      btnTabTable: document.getElementById('btnTabTable'),
      chartTypeSelector: document.getElementById('chartTypeSelector'),
      tableBody: document.getElementById('tableBody'),
      paginationInfo: document.getElementById('paginationInfo'),
      prevPageBtn: document.getElementById('prevPageBtn'),
      nextPageBtn: document.getElementById('nextPageBtn'),
      variableDescriptionBody: document.getElementById('variableDescriptionBody'),
      btnDownloadBcraChart: document.getElementById('btnDownloadBcraChart'),
      kpiPeriodPills: document.getElementById('kpiPeriodPills')
    };
  },

  setupEventListeners() {
    if (!this.dom.variablesList) return;

    // Buscador con debounce de 150ms
    this.dom.variableSearch.addEventListener('input', debounce((e) => this.handleVariableSearch(e), 150));

    // Delegación de eventos para la lista de variables (evita crear miles de listeners anónimos)
    this.dom.variablesList.addEventListener('click', (e) => {
      const star = e.target.closest('.fav-icon');
      if (star) {
        e.stopPropagation();
        const li = star.closest('li[data-id]');
        if (li) {
          const id = li.getAttribute('data-id');
          this.toggleFavorite(id);
        }
        return;
      }
      const li = e.target.closest('li[data-id]');
      if (li) {
        const id = li.getAttribute('data-id');
        const v = appState.bcra.variables.find(item => String(item.idVariable || item.id || item.codigo) === id);
        if (v) this.handleVariableSelect(v);
      }
    });

    if (this.dom.retryVariablesBtn) {
      this.dom.retryVariablesBtn.addEventListener('click', () => this.fetchCatalog());
    }

    if (this.dom.startBtn) {
      this.dom.startBtn.addEventListener('click', () => {
        if (window.innerWidth <= 992 && this.dom.sidebar && this.dom.toggleSidebarBtn) {
          this.dom.sidebar.classList.add('active');
          this.dom.toggleSidebarBtn.setAttribute('aria-expanded', 'true');
        }
      });
    }

    if (this.dom.quickRanges) {
      this.dom.quickRanges.addEventListener('click', (e) => this.handleQuickRangeClick(e));
    }

    if (this.dom.applyDatesBtn) {
      this.dom.applyDatesBtn.addEventListener('click', () => this.applyManualDatesFilter());
    }

    if (this.dom.exportCsvBtn) {
      this.dom.exportCsvBtn.addEventListener('click', () => this.exportToCsv());
    }

    if (this.dom.chartTypeSelector) {
      this.dom.chartTypeSelector.addEventListener('click', (e) => this.handleChartTypeClick(e));
    }

    if (this.dom.btnTabChart) {
      this.dom.btnTabChart.addEventListener('click', () => this.switchSubTab('tabChart'));
    }

    if (this.dom.btnTabTable) {
      this.dom.btnTabTable.addEventListener('click', () => this.switchSubTab('tabTable'));
    }

    if (this.dom.prevPageBtn) {
      this.dom.prevPageBtn.addEventListener('click', () => this.changeTablePage(-1));
    }

    if (this.dom.nextPageBtn) {
      this.dom.nextPageBtn.addEventListener('click', () => this.changeTablePage(1));
    }

    if (this.dom.btnDownloadBcraChart) {
      this.dom.btnDownloadBcraChart.addEventListener('click', () => {
        const vId = appState.bcra.selectedVariable 
          ? (appState.bcra.selectedVariable.idVariable || appState.bcra.selectedVariable.id)
          : 'variable';
        downloadChartPNG(appState.bcra.chart, `bcra_${vId}.png`);
      });
    }

    if (this.dom.kpiPeriodPills) {
      this.dom.kpiPeriodPills.addEventListener('click', (e) => {
        const btn = e.target.closest('.pill-btn');
        if (!btn) return;
        document.querySelectorAll('#kpiPeriodPills .pill-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        appState.bcra.kpiPeriodDays = parseInt(btn.getAttribute('data-days'), 10);
        this.calculateVariationKPI();
      });
    }
  },

  async fetchCatalog() {
    const cached = clientCache.get('bcra_catalog');
    if (cached && cached.length > 0) {
      appState.bcra.variables = cached;
      appState.bcra.filteredVariables = [...cached];
      this.renderVariablesList();
      return;
    }

    if (this.dom.loadingVariables) this.dom.loadingVariables.classList.remove('hidden');
    if (this.dom.errorVariables) this.dom.errorVariables.classList.add('hidden');
    if (this.dom.variablesList) this.dom.variablesList.innerHTML = '';

    try {
      const list = await fetchBcraCatalog();
      appState.bcra.variables = list;
      appState.bcra.filteredVariables = [...list];
      clientCache.set('bcra_catalog', list, 10 * 60 * 1000);
      this.renderVariablesList();
    } catch (error) {
      console.error('Error cargando variables del BCRA:', error);
      if (this.dom.errorVariables) this.dom.errorVariables.classList.remove('hidden');
      showToast('Error al conectar con la API de estadísticas.', 'danger');
    } finally {
      if (this.dom.loadingVariables) this.dom.loadingVariables.classList.add('hidden');
    }
  },

  async fetchMethodologies() {
    const cached = clientCache.get('bcra_methodologies');
    if (cached) {
      appState.bcra.methodologies = cached;
      return;
    }
    try {
      const data = await fetchBcraMethodology();
      appState.bcra.methodologies = data;
      clientCache.set('bcra_methodologies', data, 30 * 60 * 1000);
    } catch (error) {
      console.warn('No se pudo cargar la metodología técnica:', error.message);
    }
  },

  async fetchHistoricalData(idVariable) {
    const cacheKey = `bcra_history_${idVariable}`;
    const cachedData = clientCache.get(cacheKey);

    if (cachedData && cachedData.length > 0) {
      appState.bcra.historicalData = cachedData;
      this.dom.welcomeScreen.classList.add('hidden');
      this.dom.dashboardContent.classList.remove('hidden');

      const dates = appState.bcra.historicalData.map(d => d.date);
      this.dom.startDate.value = dates[0];
      this.dom.endDate.value = dates[dates.length - 1];

      this.resetQuickRangeButtons();
      const allBtn = document.querySelector('#quickRanges [data-days="all"]');
      if (allBtn) allBtn.classList.add('active');

      appState.bcra.filteredData = [...appState.bcra.historicalData];
      this.updateDashboard();
      return;
    }

    showDataLoader(true, 'Consultando datos históricos en la API del BCRA...');
    try {
      const data = await fetchBcraHistorical(idVariable);
      appState.bcra.historicalData = data;

      if (appState.bcra.historicalData.length === 0) {
        showToast('No se encontraron registros históricos.', 'warning');
        this.dom.welcomeScreen.classList.remove('hidden');
        this.dom.dashboardContent.classList.add('hidden');
      } else {
        clientCache.set(cacheKey, appState.bcra.historicalData, 5 * 60 * 1000);
        this.dom.welcomeScreen.classList.add('hidden');
        this.dom.dashboardContent.classList.remove('hidden');

        const dates = appState.bcra.historicalData.map(d => d.date);
        this.dom.startDate.value = dates[0];
        this.dom.endDate.value = dates[dates.length - 1];

        this.resetQuickRangeButtons();
        const allBtn = document.querySelector('#quickRanges [data-days="all"]');
        if (allBtn) allBtn.classList.add('active');

        appState.bcra.filteredData = [...appState.bcra.historicalData];
        this.updateDashboard();
        showToast('Datos históricos actualizados.', 'success');
      }
    } catch (error) {
      console.error(error);
      showToast('Error al descargar históricos de la variable.', 'danger');
    } finally {
      showDataLoader(false);
    }
  },

  renderVariablesList() {
    if (!this.dom.variablesList) return;
    this.dom.variablesList.innerHTML = '';

    if (appState.bcra.filteredVariables.length === 0) {
      this.dom.variablesList.innerHTML = '<li class="no-results">No se encontraron variables.</li>';
      return;
    }

    const favorites = appState.bcra.favorites || [];
    const favoritesList = appState.bcra.filteredVariables.filter(v => favorites.includes(String(v.idVariable || v.id || v.codigo)));
    const othersList = appState.bcra.filteredVariables.filter(v => !favorites.includes(String(v.idVariable || v.id || v.codigo)));

    const renderItem = (v) => {
      const li = document.createElement('li');
      const id = String(v.idVariable || v.id || v.codigo);
      const desc = v.descripcion || v.name || '';

      const textSpan = document.createElement('span');
      textSpan.textContent = `${id} - ${desc}`;
      textSpan.style.flex = '1';
      textSpan.style.lineHeight = '1.4';
      textSpan.style.fontSize = '12.5px';

      const starIcon = document.createElement('i');
      const isFav = favorites.includes(id);
      starIcon.className = isFav ? 'fa-solid fa-star fav-icon active' : 'fa-regular fa-star fav-icon';

      li.style.display = 'flex';
      li.style.alignItems = 'flex-start';
      li.style.justifyContent = 'space-between';
      li.style.gap = '8px';
      li.style.padding = '10px 14px';

      li.appendChild(textSpan);
      li.appendChild(starIcon);
      li.setAttribute('data-id', id);

      if (appState.bcra.selectedVariable && String(appState.bcra.selectedVariable.idVariable || appState.bcra.selectedVariable.id) === id) {
        li.classList.add('active');
      }

      this.dom.variablesList.appendChild(li);
    };

    if (favoritesList.length > 0) {
      const favHeader = document.createElement('li');
      favHeader.className = 'list-section-header';
      favHeader.innerHTML = '<i class="fa-solid fa-star" style="color: #f59e0b;"></i> Favoritos';
      this.dom.variablesList.appendChild(favHeader);
      favoritesList.forEach(v => renderItem(v));
    }

    if (othersList.length > 0) {
      const othersHeader = document.createElement('li');
      othersHeader.className = 'list-section-header';
      othersHeader.innerHTML = '<i class="fa-solid fa-chart-simple"></i> Conceptos';
      if (favoritesList.length > 0) othersHeader.style.marginTop = '16px';
      this.dom.variablesList.appendChild(othersHeader);
      othersList.forEach(v => renderItem(v));
    }
  },

  toggleFavorite(id) {
    const idStr = String(id);
    const favs = appState.bcra.favorites;
    const index = favs.indexOf(idStr);
    if (index === -1) {
      favs.push(idStr);
      showToast('Variable agregada a favoritos.', 'success');
    } else {
      favs.splice(index, 1);
      showToast('Variable eliminada de favoritos.', 'success');
    }
    localStorage.setItem('favorites', JSON.stringify(favs));
    this.renderVariablesList();
  },

  handleVariableSearch(e) {
    const query = e.target.value.toLowerCase().trim();
    appState.bcra.filteredVariables = query
      ? appState.bcra.variables.filter(v =>
          String(v.idVariable || v.id || '').toLowerCase().includes(query) ||
          String(v.descripcion || '').toLowerCase().includes(query)
        )
      : [...appState.bcra.variables];
    this.renderVariablesList();
  },

  handleVariableSelect(variable) {
    appState.bcra.selectedVariable = variable;
    document.querySelectorAll('.variables-list li').forEach(li => {
      li.classList.toggle('active', li.getAttribute('data-id') === String(variable.idVariable || variable.id));
    });

    if (window.innerWidth <= 992 && this.dom.sidebar && this.dom.toggleSidebarBtn) {
      this.dom.sidebar.classList.remove('active');
      this.dom.toggleSidebarBtn.setAttribute('aria-expanded', 'false');
    }

    if (this.dom.selectedVariableNameTitle) {
      this.dom.selectedVariableNameTitle.textContent = variable.descripcion || `Variable ${variable.idVariable}`;
    }

    this.fetchHistoricalData(variable.idVariable || variable.id);
  },

  updateDashboard() {
    if (appState.bcra.filteredData.length === 0) return;
    this.calculateKPIs();
    this.renderChart();
    appState.bcra.tablePage = 1;
    this.renderTable();
    this.renderMethodology();
  },

  calculateKPIs() {
    const data = appState.bcra.filteredData;
    const len = data.length;
    const latest = data[len - 1];

    this.dom.latestValue.textContent = formatValue(latest.value);
    this.dom.latestDate.textContent = formatDate(latest.date);
    this.calculateVariationKPI();

    let max = data[0];
    let min = data[0];
    for (let i = 1; i < len; i++) {
      if (data[i].value > max.value) max = data[i];
      if (data[i].value < min.value) min = data[i];
    }

    this.dom.maxValue.textContent = formatValue(max.value);
    this.dom.maxDate.textContent = formatDate(max.date);
    this.dom.minValue.textContent = formatValue(min.value);
    this.dom.minDate.textContent = formatDate(min.date);
  },

  calculateVariationKPI() {
    const data = appState.bcra.filteredData;
    const len = data.length;
    let changeVal = 0;
    let changePct = 0;

    if (len > 1) {
      const latestDateObj = new Date(data[len - 1].date);
      const targetDateObj = new Date(latestDateObj);
      targetDateObj.setDate(targetDateObj.getDate() - appState.bcra.kpiPeriodDays);
      const targetDateStr = targetDateObj.toISOString().split('T')[0];

      let prevData = data[0];
      for (let i = len - 1; i >= 0; i--) {
        if (data[i].date <= targetDateStr) {
          prevData = data[i];
          break;
        }
      }

      const latest = data[len - 1];
      changeVal = latest.value - prevData.value;
      changePct = prevData.value !== 0 ? (changeVal / prevData.value) * 100 : 0;
    }

    this.dom.changeValue.textContent = (changeVal >= 0 ? '+' : '') + formatValue(changeVal);
    this.dom.changePercent.textContent = (changeVal >= 0 ? '+' : '') + changePct.toFixed(2) + '%';

    this.dom.kpiChangeIconWrapper.className = 'kpi-icon-wrapper';
    if (changeVal > 0) {
      this.dom.kpiChangeIconWrapper.classList.add('change-color', 'positive');
      this.dom.kpiChangeIcon.className = 'fa-solid fa-arrow-up';
    } else if (changeVal < 0) {
      this.dom.kpiChangeIconWrapper.classList.add('change-color', 'negative');
      this.dom.kpiChangeIcon.className = 'fa-solid fa-arrow-down';
    } else {
      this.dom.kpiChangeIconWrapper.classList.add('change-color');
      this.dom.kpiChangeIcon.className = 'fa-solid fa-minus';
    }
  },

  renderChart() {
    const canvas = document.getElementById('monetaryChart');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const isDark = document.body.classList.contains('dark-theme');
    const primaryColor = getComputedStyle(document.body).getPropertyValue('--primary').trim() || '#e31775';
    const textColor = isDark ? '#94a3b8' : '#64748b';
    const gridColor = isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.06)';

    const labels = appState.bcra.filteredData.map(d => formatDate(d.date));
    const datasetValues = appState.bcra.filteredData.map(d => d.value);

    let maxIdx = -1;
    let minIdx = -1;
    let maxVal = -Infinity;
    let minVal = Infinity;

    appState.bcra.filteredData.forEach((d, idx) => {
      if (d.value > maxVal) { maxVal = d.value; maxIdx = idx; }
      if (d.value < minVal) { minVal = d.value; minIdx = idx; }
    });

    const pointRadii = datasetValues.map((val, idx) => (idx === maxIdx || idx === minIdx) ? 7 : (datasetValues.length > 80 ? 0 : 3.5));
    const pointBgColors = datasetValues.map((val, idx) => (idx === maxIdx || idx === minIdx) ? '#ffd60a' : primaryColor);
    const pointBorderColors = datasetValues.map(() => '#ffffff');
    const pointHoverRadii = datasetValues.map((val, idx) => (idx === maxIdx || idx === minIdx) ? 9 : 6);
    const pointBorderWidths = datasetValues.map((val, idx) => (idx === maxIdx || idx === minIdx) ? 2.5 : 1);

    let bgGradient = primaryColor;
    if (appState.bcra.chartType === 'line') {
      const gradient = ctx.createLinearGradient(0, 0, 0, 350);
      gradient.addColorStop(0, isDark ? 'rgba(244, 63, 94, 0.4)' : 'rgba(227, 23, 117, 0.4)');
      gradient.addColorStop(1, isDark ? 'rgba(244, 63, 94, 0.0)' : 'rgba(227, 23, 117, 0.0)');
      bgGradient = gradient;
    }

    if (appState.bcra.chart && appState.bcra.chart.config.type === appState.bcra.chartType) {
      appState.bcra.chart.data.labels = labels;
      const ds = appState.bcra.chart.data.datasets[0];
      ds.label = appState.bcra.selectedVariable ? (appState.bcra.selectedVariable.descripcion || 'Valor') : 'Valor';
      ds.data = datasetValues;
      ds.borderColor = primaryColor;
      ds.backgroundColor = bgGradient;
      ds.borderWidth = appState.bcra.chartType === 'line' ? 2.5 : 1;
      ds.fill = appState.bcra.chartType === 'line';
      ds.pointRadius = pointRadii;
      ds.pointHoverRadius = pointHoverRadii;
      ds.pointBackgroundColor = pointBgColors;
      ds.pointBorderColor = pointBorderColors;
      ds.pointBorderWidth = pointBorderWidths;
      ds.maxIdx = maxIdx;
      ds.minIdx = minIdx;
      ds.formatLabel = val => formatValue(val);
      appState.bcra.chart.update('active');
      return;
    }

    if (appState.bcra.chart) {
      appState.bcra.chart.destroy();
    }

    appState.bcra.chart = new Chart(ctx, {
      type: appState.bcra.chartType,
      plugins: [lineShadowPlugin, maxMinLabelPlugin],
      data: {
        labels: labels,
        datasets: [{
          label: appState.bcra.selectedVariable ? (appState.bcra.selectedVariable.descripcion || 'Valor') : 'Valor',
          data: datasetValues,
          borderColor: primaryColor,
          backgroundColor: bgGradient,
          borderWidth: appState.bcra.chartType === 'line' ? 2.5 : 1,
          fill: appState.bcra.chartType === 'line',
          pointRadius: pointRadii,
          pointHoverRadius: pointHoverRadii,
          pointBackgroundColor: pointBgColors,
          pointBorderColor: pointBorderColors,
          pointBorderWidth: pointBorderWidths,
          tension: 0.15,
          maxIdx: maxIdx,
          minIdx: minIdx,
          formatLabel: val => formatValue(val)
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            mode: 'index',
            intersect: false,
            backgroundColor: isDark ? '#0f172a' : '#ffffff',
            titleColor: isDark ? '#f8fafc' : '#0f172a',
            bodyColor: isDark ? '#94a3b8' : '#64748b',
            borderColor: gridColor,
            borderWidth: 1,
            padding: 12,
            callbacks: {
              label: function(context) {
                let valText = ' Valor: ' + formatValue(context.raw);
                if (context.dataIndex === maxIdx) valText += ' 📈 (MÁX)';
                if (context.dataIndex === minIdx) valText += ' 📉 (MÍN)';
                return valText;
              }
            }
          }
        },
        scales: {
          x: { grid: { display: false }, ticks: { color: textColor, maxTicksLimit: window.innerWidth < 600 ? 5 : 10 } },
          y: { grid: { color: gridColor }, ticks: { color: textColor, callback: value => formatValueCompact(value) } }
        }
      }
    });

    registerChart(appState.bcra.chart);
  },

  renderTable() {
    const startIndex = (appState.bcra.tablePage - 1) * appState.bcra.tablePageSize;
    const endIndex = Math.min(startIndex + appState.bcra.tablePageSize, appState.bcra.filteredData.length);
    const sortedDataForTable = [...appState.bcra.filteredData].reverse();
    const pageData = sortedDataForTable.slice(startIndex, endIndex);

    this.dom.tableBody.innerHTML = '';
    if (pageData.length === 0) {
      this.dom.tableBody.innerHTML = '<tr><td colspan="3" class="text-center">No hay registros para mostrar.</td></tr>';
      this.updatePaginationControls(0, 0, 0);
      return;
    }

    const totalLen = appState.bcra.filteredData.length;
    pageData.forEach((item, pageIdx) => {
      const tr = document.createElement('tr');
      const originalIndex = totalLen - 1 - (startIndex + pageIdx);
      let varText = '-';
      let varClass = '';

      if (originalIndex > 0 && originalIndex < totalLen) {
        const prev = appState.bcra.filteredData[originalIndex - 1];
        const diff = item.value - prev.value;
        const diffPct = prev.value !== 0 ? (diff / prev.value) * 100 : 0;
        varText = `${diff >= 0 ? '+' : ''}${diffPct.toFixed(2)}%`;
        varClass = diff > 0 ? 'text-success' : (diff < 0 ? 'text-danger' : '');
      }

      tr.innerHTML = `
        <td>${formatDate(item.date)}</td>
        <td class="text-right font-medium">${formatValue(item.value)}</td>
        <td class="text-right ${varClass}">${varText}</td>
      `;
      this.dom.tableBody.appendChild(tr);
    });

    this.updatePaginationControls(startIndex + 1, endIndex, appState.bcra.filteredData.length);
  },

  updatePaginationControls(start, end, total) {
    this.dom.paginationInfo.textContent = `Mostrando ${start}-${end} de ${total} registros`;
    this.dom.prevPageBtn.disabled = appState.bcra.tablePage <= 1;
    this.dom.nextPageBtn.disabled = end >= total;
  },

  changeTablePage(direction) {
    appState.bcra.tablePage += direction;
    this.renderTable();
  },

  renderMethodology() {
    this.dom.variableDescriptionBody.innerHTML = '';
    if (!appState.bcra.selectedVariable) return;

    const idVar = appState.bcra.selectedVariable.idVariable || appState.bcra.selectedVariable.id;
    const method = appState.bcra.methodologies.find(m => String(m.idVariable || m.id || m.codigoVariable) === String(idVar));

    if (method) {
      this.dom.variableDescriptionBody.innerHTML = `
        <p><strong>Descripción Técnica:</strong> ${method.descripcion || 'Sin descripción metodológica cargada.'}</p>
        <p><strong>Periodicidad:</strong> ${method.periodicidad || 'Diaria/Mensual según variable.'}</p>
        ${method.observaciones ? `<p><strong>Observaciones:</strong> ${method.observaciones}</p>` : ''}
      `;
    } else {
      this.dom.variableDescriptionBody.innerHTML = `
        <p>Esta variable monetaria corresponde al código identificador <strong>${idVar}</strong> dentro del sistema del Banco Central de la República Argentina (BCRA).</p>
        <ul>
          <li><strong>Identificador:</strong> Variable ${idVar}</li>
          <li><strong>Nombre Oficial:</strong> ${appState.bcra.selectedVariable.descripcion || 'No especificado'}</li>
          <li><strong>Frecuencia de actualización estimada:</strong> ${this.detectPeriodicidad(appState.bcra.selectedVariable.descripcion || '')}</li>
          <li><strong>Origen de datos:</strong> Base de datos de Estadísticas Monetarias del BCRA (API v4.0).</li>
        </ul>
      `;
    }
  },

  detectPeriodicidad(desc) {
    const d = desc.toLowerCase();
    if (d.includes('mensual')) return 'Mensual';
    if (d.includes('anual')) return 'Anual';
    if (d.includes('semanal')) return 'Semanal';
    return 'Diaria (Días hábiles)';
  },

  handleQuickRangeClick(e) {
    const btn = e.target.closest('.range-btn');
    if (!btn) return;
    this.resetQuickRangeButtons();
    btn.classList.add('active');

    const days = btn.getAttribute('data-days');
    const len = appState.bcra.historicalData.length;
    if (len === 0) return;

    if (days === 'all') {
      appState.bcra.filteredData = [...appState.bcra.historicalData];
      this.dom.startDate.value = appState.bcra.historicalData[0].date;
      this.dom.endDate.value = appState.bcra.historicalData[len - 1].date;
    } else {
      const numDays = parseInt(days, 10);
      const endDateObj = new Date(appState.bcra.historicalData[len - 1].date);
      const startDateObj = new Date(endDateObj);
      startDateObj.setDate(startDateObj.getDate() - numDays);

      const startStr = startDateObj.toISOString().split('T')[0];
      const endStr = endDateObj.toISOString().split('T')[0];
      this.dom.startDate.value = startStr;
      this.dom.endDate.value = endStr;
      appState.bcra.filteredData = appState.bcra.historicalData.filter(d => d.date >= startStr && d.date <= endStr);
    }
    this.updateDashboard();
  },

  resetQuickRangeButtons() {
    document.querySelectorAll('#quickRanges .range-btn').forEach(btn => btn.classList.remove('active'));
  },

  applyManualDatesFilter() {
    const startStr = this.dom.startDate.value;
    const endStr = this.dom.endDate.value;
    if (!startStr || !endStr) {
      showToast('Selecciona ambas fechas.', 'warning');
      return;
    }
    if (new Date(startStr) > new Date(endStr)) {
      showToast('Fecha de inicio posterior a la fecha de fin.', 'warning');
      return;
    }
    this.resetQuickRangeButtons();
    appState.bcra.filteredData = appState.bcra.historicalData.filter(d => d.date >= startStr && d.date <= endStr);
    if (appState.bcra.filteredData.length === 0) showToast('No existen registros en ese período.', 'warning');
    this.updateDashboard();
  },

  handleChartTypeClick(e) {
    const btn = e.target.closest('.chart-style-btn');
    if (!btn) return;
    document.querySelectorAll('#chartTypeSelector .chart-style-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    appState.bcra.chartType = btn.getAttribute('data-type');
    this.renderChart();
  },

  switchSubTab(tabId) {
    appState.bcra.currentTab = tabId;
    this.dom.btnTabChart.classList.toggle('active', tabId === 'tabChart');
    this.dom.btnTabTable.classList.toggle('active', tabId === 'tabTable');
    document.getElementById('tabChart').classList.toggle('active', tabId === 'tabChart');
    document.getElementById('tabTable').classList.toggle('active', tabId === 'tabTable');
  },

  exportToCsv() {
    if (appState.bcra.filteredData.length === 0) return;
    const varId = appState.bcra.selectedVariable 
      ? (appState.bcra.selectedVariable.idVariable || appState.bcra.selectedVariable.id)
      : 'variable';
    const varDesc = appState.bcra.selectedVariable ? appState.bcra.selectedVariable.descripcion : 'Estadística';
    let csvContent = `ID Variable: ${varId}\nDescripcion: ${varDesc}\nFecha;Valor\n`;
    appState.bcra.filteredData.forEach(d => {
      csvContent += `${d.date};${String(d.value).replace('.', ',')}\n`;
    });
    downloadBlob(csvContent, `bcra_${varId}.csv`, 'text/csv;charset=utf-8;');
  }
};
