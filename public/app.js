/**
 * Portal Financiero Argentino - Client Application
 * 
 * Desarrollado con JavaScript puro (ES6) y Chart.js.
 * Administra dinámicamente las hojas individuales: BCRA, INDEC, Dólares y BYMA.
 */

// --- ESTADO GLOBAL DE LA APLICACIÓN ---
const state = {
  activeTab: 'bcra',      // Pestaña activa principal: 'bcra', 'indec', 'dolares', 'byma'
  
  // Módulo BCRA
  variables: [],          // Catálogo completo de variables
  filteredVariables: [],  // Variables filtradas por el buscador
  selectedVariable: null, // Variable seleccionada actualmente
  historicalData: [],     // Datos históricos completos de la variable activa
  filteredData: [],       // Datos históricos filtrados por rango de fecha
  methodologies: [],      // Catálogo de metodologías técnicas
  chart: null,            // Instancia activa de Chart.js
  chartType: 'line',      // Tipo de gráfico: 'line' o 'bar'
  currentTab: 'tabChart', // Tab activa: 'tabChart' o 'tabTable'
  tablePage: 1,           // Página actual de la tabla de datos
  tablePageSize: 15,      // Registros por página en la tabla
  kpiPeriodDays: 30,      // Período activo de rendimiento KPI (30, 90, 180, 365)
  favorites: JSON.parse(localStorage.getItem('favorites') || '[]'), // Variables favoritas persistidas
  
  // Módulo INDEC
  indec: {
    raw: null,            // Respuesta en bruto de la API
    parsedData: [],       // Datos procesados
    chart: null,          // Instancia de Chart.js de INDEC
    activeMetric: 'ipc',  // Métrica activa del gráfico: 'ipc', 'emae', 'salarios'
    days: 365,            // Rango de días seleccionado
  },

  // Módulo DÓLARES
  dolares: {
    live: { oficial: 0, mep: 0, ccl: 0, blue: 0 },
    historical: { oficial: [], mep: [], dates: [] },
    chart: null,
    activeView: 'prices', // Vista del gráfico: 'prices' o 'brecha'
    days: 90,
  },

  // Módulo BYMA
  byma: {
    bonds: [],            // Listado de bonos del panel público
    selectedBond: null,   // Bono seleccionado para ficha técnica
    searchQuery: '',      // Filtro de búsqueda de bonos
  }
};

// --- ELEMENTOS DEL DOM ---
const DOM = {
  // Sidebar y Navegación
  sidebar: document.getElementById('sidebar'),
  toggleSidebarBtn: document.getElementById('toggleSidebarBtn'),
  closeSidebarBtn: document.getElementById('closeSidebarBtn'),
  bcraSubpanel: document.getElementById('bcraSubpanel'),
  
  // Catálogo BCRA
  variableSearch: document.getElementById('variableSearch'),
  variablesList: document.getElementById('variablesList'),
  loadingVariables: document.getElementById('loadingVariables'),
  errorVariables: document.getElementById('errorVariables'),
  retryVariablesBtn: document.getElementById('retryVariablesBtn'),

  // Tema
  themeToggleBtn: document.getElementById('themeToggleBtn'),

  // Viewport
  dashboardViewport: document.getElementById('dashboardViewport'),
  selectedVariableNameTitle: document.getElementById('selectedVariableNameTitle'),

  // Toast
  toast: document.getElementById('toast'),
  toastIcon: document.getElementById('toastIcon'),
  toastMessage: document.getElementById('toastMessage')
};

// --- ELEMENTOS DOM: MÓDULO BCRA ---
const DOM_BCRA = {
  welcomeScreen: document.getElementById('welcomeScreen'),
  dashboardContent: document.getElementById('dashboardContent'),
  startBtn: document.getElementById('startBtn'),
  loadingDataOverlay: document.getElementById('loadingDataOverlay'),
  loadingDataText: document.getElementById('loadingDataText'),
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
};

// --- INICIALIZACIÓN ---
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  setupEventListeners();
  switchNavigationTab('bcra'); // Iniciar por defecto en BCRA
  fetchCatalog();
  fetchMethodologies();
});

// --- SISTEMA DE TEMAS (Oscuro / Claro) ---
function initTheme() {
  const savedTheme = localStorage.getItem('theme');
  if (savedTheme === 'light') {
    document.body.classList.remove('dark-theme');
  } else {
    document.body.classList.add('dark-theme');
  }
}

function toggleTheme() {
  const isDark = document.body.classList.toggle('dark-theme');
  localStorage.setItem('theme', isDark ? 'dark' : 'light');
  
  // Actualizar gráficos activos
  if (state.activeTab === 'bcra' && state.chart) updateChartTheme();
  if (state.activeTab === 'indec' && state.indec.chart) IndecModule.updateChartTheme();
  if (state.activeTab === 'dolares' && state.dolares.chart) DolaresModule.updateChartTheme();
}

// --- SETUP EVENT LISTENERS (GLOBAL & ROUTING) ---
function setupEventListeners() {
  // Sidebar Toggles (Móvil)
  DOM.toggleSidebarBtn.addEventListener('click', () => DOM.sidebar.classList.add('active'));
  DOM.closeSidebarBtn.addEventListener('click', () => DOM.sidebar.classList.remove('active'));
  
  DOM_BCRA.startBtn.addEventListener('click', () => {
    if (window.innerWidth <= 992) {
      DOM.sidebar.classList.add('active');
    }
  });

  // Tema
  DOM.themeToggleBtn.addEventListener('click', toggleTheme);

  // Navegación por Pestañas (Hoja Individual)
  document.querySelectorAll('.nav-tab-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const tabId = btn.closest('.nav-tab-btn').getAttribute('data-tab');
      switchNavigationTab(tabId);
      if (window.innerWidth <= 992) {
        DOM.sidebar.classList.remove('active');
      }
    });
  });

  // --- Event Listeners BCRA ---
  DOM.variableSearch.addEventListener('input', handleVariableSearch);
  DOM.retryVariablesBtn.addEventListener('click', fetchCatalog);
  DOM_BCRA.quickRanges.addEventListener('click', handleQuickRangeClick);
  DOM_BCRA.applyDatesBtn.addEventListener('click', applyManualDatesFilter);
  DOM_BCRA.exportCsvBtn.addEventListener('click', exportToCsv);
  DOM_BCRA.chartTypeSelector.addEventListener('click', handleChartTypeClick);
  DOM_BCRA.btnTabChart.addEventListener('click', () => switchTab('tabChart'));
  DOM_BCRA.btnTabTable.addEventListener('click', () => switchTab('tabTable'));
  DOM_BCRA.prevPageBtn.addEventListener('click', () => changeTablePage(-1));
  DOM_BCRA.nextPageBtn.addEventListener('click', () => changeTablePage(1));

  const periodPills = document.getElementById('kpiPeriodPills');
  if (periodPills) {
    periodPills.addEventListener('click', (e) => {
      const btn = e.target.closest('.pill-btn');
      if (!btn) return;
      document.querySelectorAll('.kpi-period-pills .pill-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.kpiPeriodDays = parseInt(btn.getAttribute('data-days'));
      calculateVariationKPI();
    });
  }
}

// --- SWITCH NAVIGATION TAB (SPA ROUTER) ---
function switchNavigationTab(tabId) {
  state.activeTab = tabId;

  // Actualizar menú lateral
  document.querySelectorAll('.nav-tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-tab') === tabId);
  });

  // Mostrar / Ocultar subpanel del catálogo de variables en el sidebar
  DOM.bcraSubpanel.classList.toggle('hidden', tabId !== 'bcra');

  // Alternar vistas
  document.querySelectorAll('.view-panel').forEach(panel => {
    panel.classList.add('hidden');
  });
  document.getElementById(`view${tabId.charAt(0).toUpperCase() + tabId.slice(1)}`).classList.remove('hidden');

  // Cambiar título en Top-bar y cargar datos si es necesario
  if (tabId === 'bcra') {
    DOM.selectedVariableNameTitle.textContent = state.selectedVariable ? (state.selectedVariable.descripcion || 'Estadísticas Monetarias') : 'Estadísticas Monetarias (BCRA)';
  } else if (tabId === 'indec') {
    DOM.selectedVariableNameTitle.textContent = 'Inflación y Actividad Económica (INDEC)';
    IndecModule.init();
  } else if (tabId === 'dolares') {
    DOM.selectedVariableNameTitle.textContent = 'Mercado Cambiario y Cotizaciones del Dólar';
    DolaresModule.init();
  } else if (tabId === 'byma') {
    DOM.selectedVariableNameTitle.textContent = 'Títulos y Bonos Soberanos (BYMA)';
    BymaModule.init();
  }
}

// ==========================================
// 🏦 MÓDULO A: BANCO CENTRAL (BCRA)
// ==========================================

// Obtener catálogo
async function fetchCatalog() {
  DOM.loadingVariables.classList.remove('hidden');
  DOM.errorVariables.classList.add('hidden');
  DOM.variablesList.innerHTML = '';

  try {
    const response = await fetch('/api/monetarias');
    if (!response.ok) throw new Error('Error de red');
    const result = await response.json();
    state.variables = Array.isArray(result) ? result : (result.results || result.data || []);
    state.filteredVariables = [...state.variables];
    renderVariablesList();
  } catch (error) {
    console.error('Error cargando variables:', error);
    DOM.errorVariables.classList.remove('hidden');
    showToast('Error al conectar con la API de estadísticas.', 'danger');
  } finally {
    DOM.loadingVariables.classList.add('hidden');
  }
}

// Obtener metodologías
async function fetchMethodologies() {
  try {
    const response = await fetch('/api/metodologia');
    if (response.ok) {
      const result = await response.json();
      state.methodologies = Array.isArray(result) ? result : (result.results || result.data || []);
    }
  } catch (error) {
    console.warn('No se pudo cargar la metodología técnica:', error);
  }
}

// Cargar histórico de variable seleccionada
async function fetchHistoricalData(idVariable) {
  showDataLoader(true, 'Consultando datos históricos en la API del BCRA...');
  try {
    const response = await fetch(`/api/monetarias/${idVariable}`);
    if (!response.ok) throw new Error('Error al obtener datos históricos');
    const result = await response.json();
    
    let rawData = [];
    if (result && result.results && Array.isArray(result.results)) {
      rawData = result.results[0].detalle || result.results;
    } else {
      rawData = Array.isArray(result) ? result : (result.data || []);
    }
    
    state.historicalData = rawData.map(item => ({
      date: item.fecha,
      value: parseFloat(item.valor)
    })).filter(item => item.date && !isNaN(item.value))
       .sort((a, b) => a.date.localeCompare(b.date));

    if (state.historicalData.length === 0) {
      showToast('No se encontraron registros históricos.', 'warning');
      DOM_BCRA.welcomeScreen.classList.remove('hidden');
      DOM_BCRA.dashboardContent.classList.add('hidden');
    } else {
      DOM_BCRA.welcomeScreen.classList.add('hidden');
      DOM_BCRA.dashboardContent.classList.remove('hidden');
      
      const dates = state.historicalData.map(d => d.date);
      DOM_BCRA.startDate.value = dates[0];
      DOM_BCRA.endDate.value = dates[dates.length - 1];
      
      resetQuickRangeButtons();
      document.querySelector('#quickRanges [data-days="all"]').classList.add('active');
      
      state.filteredData = [...state.historicalData];
      updateDashboard();
      showToast('Datos históricos actualizados.', 'success');
    }
  } catch (error) {
    console.error(error);
    showToast('Error al descargar históricos de la variable.', 'danger');
  } finally {
    showDataLoader(false);
  }
}

function renderVariablesList() {
  DOM.variablesList.innerHTML = '';
  if (state.filteredVariables.length === 0) {
    DOM.variablesList.innerHTML = '<li class="no-results">No se encontraron variables.</li>';
    return;
  }
  
  const favoritesList = state.filteredVariables.filter(v => state.favorites.includes(String(v.idVariable || v.id || v.codigo)));
  const othersList = state.filteredVariables.filter(v => !state.favorites.includes(String(v.idVariable || v.id || v.codigo)));
  
  function renderItem(v) {
    const li = document.createElement('li');
    const id = String(v.idVariable || v.id || v.codigo);
    const desc = v.descripcion || v.name;
    
    const textSpan = document.createElement('span');
    textSpan.textContent = `${id} - ${desc}`;
    textSpan.style.flex = '1';
    textSpan.style.lineHeight = '1.4';
    textSpan.style.fontSize = '12.5px';
    
    const starIcon = document.createElement('i');
    const isFav = state.favorites.includes(id);
    starIcon.className = isFav ? 'fa-solid fa-star fav-icon active' : 'fa-regular fa-star fav-icon';
    starIcon.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleFavorite(id);
    });
    
    li.style.display = 'flex';
    li.style.alignItems = 'flex-start';
    li.style.justifyContent = 'space-between';
    li.style.gap = '8px';
    li.style.padding = '10px 14px';
    
    li.appendChild(textSpan);
    li.appendChild(starIcon);
    li.setAttribute('data-id', id);
    
    if (state.selectedVariable && String(state.selectedVariable.idVariable || state.selectedVariable.id) === id) {
      li.classList.add('active');
    }
    
    li.addEventListener('click', () => handleVariableSelect(v));
    DOM.variablesList.appendChild(li);
  }
  
  if (favoritesList.length > 0) {
    const favHeader = document.createElement('li');
    favHeader.className = 'list-section-header';
    favHeader.innerHTML = '<i class="fa-solid fa-star" style="color: #f59e0b;"></i> Favoritos';
    DOM.variablesList.appendChild(favHeader);
    favoritesList.forEach(v => renderItem(v));
  }
  
  if (othersList.length > 0) {
    const othersHeader = document.createElement('li');
    othersHeader.className = 'list-section-header';
    othersHeader.innerHTML = '<i class="fa-solid fa-chart-simple"></i> Conceptos';
    if (favoritesList.length > 0) othersHeader.style.marginTop = '16px';
    DOM.variablesList.appendChild(othersHeader);
    othersList.forEach(v => renderItem(v));
  }
}

function toggleFavorite(id) {
  const idStr = String(id);
  const index = state.favorites.indexOf(idStr);
  if (index === -1) {
    state.favorites.push(idStr);
    showToast('Variable agregada a favoritos.', 'success');
  } else {
    state.favorites.splice(index, 1);
    showToast('Variable eliminada de favoritos.', 'success');
  }
  localStorage.setItem('favorites', JSON.stringify(state.favorites));
  renderVariablesList();
}

function handleVariableSearch(e) {
  const query = e.target.value.toLowerCase().trim();
  state.filteredVariables = query 
    ? state.variables.filter(v => String(v.idVariable || v.id || '').toLowerCase().includes(query) || String(v.descripcion || '').toLowerCase().includes(query))
    : [...state.variables];
  renderVariablesList();
}

function handleVariableSelect(variable) {
  state.selectedVariable = variable;
  document.querySelectorAll('.variables-list li').forEach(li => {
    li.classList.toggle('active', li.getAttribute('data-id') === String(variable.idVariable || variable.id));
  });
  if (window.innerWidth <= 992) DOM.sidebar.classList.remove('active');
  DOM.selectedVariableNameTitle.textContent = variable.descripcion || `Variable ${variable.idVariable}`;
  fetchHistoricalData(variable.idVariable || variable.id);
}

function updateDashboard() {
  if (state.filteredData.length === 0) return;
  calculateKPIs();
  renderChart();
  state.tablePage = 1;
  renderTable();
  renderMethodology();
}

function calculateKPIs() {
  const data = state.filteredData;
  const len = data.length;
  const latest = data[len - 1];
  DOM_BCRA.latestValue.textContent = formatValue(latest.value);
  DOM_BCRA.latestDate.textContent = formatDate(latest.date);
  calculateVariationKPI();
  
  let max = data[0], min = data[0];
  for (let i = 1; i < len; i++) {
    if (data[i].value > max.value) max = data[i];
    if (data[i].value < min.value) min = data[i];
  }
  DOM_BCRA.maxValue.textContent = formatValue(max.value);
  DOM_BCRA.maxDate.textContent = formatDate(max.date);
  DOM_BCRA.minValue.textContent = formatValue(min.value);
  DOM_BCRA.minDate.textContent = formatDate(min.date);
}

function calculateVariationKPI() {
  const data = state.filteredData;
  const len = data.length;
  let changeVal = 0, changePct = 0;
  
  if (len > 1) {
    const latestDateObj = new Date(data[len - 1].date);
    const targetDateObj = new Date(latestDateObj);
    targetDateObj.setDate(targetDateObj.getDate() - state.kpiPeriodDays);
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
  
  DOM_BCRA.changeValue.textContent = (changeVal >= 0 ? '+' : '') + formatValue(changeVal);
  DOM_BCRA.changePercent.textContent = (changeVal >= 0 ? '+' : '') + changePct.toFixed(2) + '%';
  
  DOM_BCRA.kpiChangeIconWrapper.className = 'kpi-icon-wrapper';
  if (changeVal > 0) {
    DOM_BCRA.kpiChangeIconWrapper.classList.add('change-color', 'positive');
    DOM_BCRA.kpiChangeIcon.className = 'fa-solid fa-arrow-up';
  } else if (changeVal < 0) {
    DOM_BCRA.kpiChangeIconWrapper.classList.add('change-color', 'negative');
    DOM_BCRA.kpiChangeIcon.className = 'fa-solid fa-arrow-down';
  } else {
    DOM_BCRA.kpiChangeIconWrapper.classList.add('change-color');
    DOM_BCRA.kpiChangeIcon.className = 'fa-solid fa-minus';
  }
}

function renderChart() {
  const ctx = document.getElementById('monetaryChart').getContext('2d');
  if (state.chart) state.chart.destroy();
  
  const isDark = document.body.classList.contains('dark-theme');
  const primaryColor = getComputedStyle(document.body).getPropertyValue('--primary').trim();
  const textColor = getComputedStyle(document.body).getPropertyValue('--text-secondary').trim();
  const gridColor = getComputedStyle(document.body).getPropertyValue('--border-color').trim();
  
  const labels = state.filteredData.map(d => formatDate(d.date));
  const datasetValues = state.filteredData.map(d => d.value);
  
  let maxIdx = -1, minIdx = -1, maxVal = -Infinity, minVal = Infinity;
  state.filteredData.forEach((d, idx) => {
    if (d.value > maxVal) { maxVal = d.value; maxIdx = idx; }
    if (d.value < minVal) { minVal = d.value; minIdx = idx; }
  });
  
  const pointRadii = datasetValues.map((val, idx) => (idx === maxIdx || idx === minIdx) ? 7 : (datasetValues.length > 80 ? 0 : 3.5));
  const pointBgColors = datasetValues.map((val, idx) => (idx === maxIdx || idx === minIdx) ? '#ffd60a' : primaryColor);
  const pointBorderColors = datasetValues.map(() => '#ffffff');
  const pointHoverRadii = datasetValues.map((val, idx) => (idx === maxIdx || idx === minIdx) ? 9 : 6);
  const pointBorderWidths = datasetValues.map((val, idx) => (idx === maxIdx || idx === minIdx) ? 2.5 : 1);
  
  let bgGradient = primaryColor;
  if (state.chartType === 'line') {
    const gradient = ctx.createLinearGradient(0, 0, 0, 350);
    gradient.addColorStop(0, isDark ? 'rgba(244, 63, 94, 0.4)' : 'rgba(227, 23, 117, 0.4)');
    gradient.addColorStop(1, isDark ? 'rgba(244, 63, 94, 0.0)' : 'rgba(227, 23, 117, 0.0)');
    bgGradient = gradient;
  }
  
  const lineShadowPlugin = {
    id: 'lineShadow',
    beforeDatasetsDraw: (chart) => {
      if (chart.config.type !== 'line') return;
      const ctx = chart.ctx;
      ctx.save();
      ctx.shadowColor = primaryColor;
      ctx.shadowBlur = 12;
      ctx.shadowOffsetY = 4;
    },
    afterDatasetsDraw: (chart) => { chart.ctx.restore(); }
  };
  
  state.chart = new Chart(ctx, {
    type: state.chartType,
    plugins: [lineShadowPlugin],
    data: {
      labels: labels,
      datasets: [{
        label: state.selectedVariable ? (state.selectedVariable.descripcion || 'Valor') : 'Valor',
        data: datasetValues,
        borderColor: primaryColor,
        backgroundColor: bgGradient,
        borderWidth: state.chartType === 'line' ? 2.5 : 1,
        fill: state.chartType === 'line',
        pointRadius: pointRadii,
        pointHoverRadius: pointHoverRadii,
        pointBackgroundColor: pointBgColors,
        pointBorderColor: pointBorderColors,
        pointBorderWidth: pointBorderWidths,
        tension: 0.15
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
}

function updateChartTheme() {
  if (!state.chart) return;
  const isDark = document.body.classList.contains('dark-theme');
  const primaryColor = getComputedStyle(document.body).getPropertyValue('--primary').trim();
  const textColor = getComputedStyle(document.body).getPropertyValue('--text-secondary').trim();
  const gridColor = getComputedStyle(document.body).getPropertyValue('--border-color').trim();
  
  const ctx = document.getElementById('monetaryChart').getContext('2d');
  let bgGradient = primaryColor;
  if (state.chartType === 'line') {
    const gradient = ctx.createLinearGradient(0, 0, 0, 350);
    gradient.addColorStop(0, isDark ? 'rgba(244, 63, 94, 0.4)' : 'rgba(227, 23, 117, 0.4)');
    gradient.addColorStop(1, isDark ? 'rgba(244, 63, 94, 0.0)' : 'rgba(227, 23, 117, 0.0)');
    bgGradient = gradient;
  }
  
  state.chart.data.datasets[0].borderColor = primaryColor;
  state.chart.data.datasets[0].backgroundColor = bgGradient;
  state.chart.options.scales.x.ticks.color = textColor;
  state.chart.options.scales.y.ticks.color = textColor;
  state.chart.options.scales.y.grid.color = gridColor;
  state.chart.update('none');
}

function renderTable() {
  const startIndex = (state.tablePage - 1) * state.tablePageSize;
  const endIndex = Math.min(startIndex + state.tablePageSize, state.filteredData.length);
  const sortedDataForTable = [...state.filteredData].reverse();
  const pageData = sortedDataForTable.slice(startIndex, endIndex);
  
  DOM_BCRA.tableBody.innerHTML = '';
  if (pageData.length === 0) {
    DOM_BCRA.tableBody.innerHTML = '<tr><td colspan="3" class="text-center">No hay registros para mostrar.</td></tr>';
    updatePaginationControls(0, 0, 0);
    return;
  }
  
  pageData.forEach(item => {
    const tr = document.createElement('tr');
    const originalIndex = state.filteredData.findIndex(d => d.date === item.date);
    let varText = '-', varClass = '';
    
    if (originalIndex > 0) {
      const prev = state.filteredData[originalIndex - 1];
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
    DOM_BCRA.tableBody.appendChild(tr);
  });
  updatePaginationControls(startIndex + 1, endIndex, state.filteredData.length);
}

function updatePaginationControls(start, end, total) {
  DOM_BCRA.paginationInfo.textContent = `Mostrando ${start}-${end} de ${total} registros`;
  DOM_BCRA.prevPageBtn.disabled = state.tablePage <= 1;
  DOM_BCRA.nextPageBtn.disabled = end >= total;
}

function changeTablePage(direction) {
  state.tablePage += direction;
  renderTable();
}

function renderMethodology() {
  DOM_BCRA.variableDescriptionBody.innerHTML = '';
  if (!state.selectedVariable) return;
  
  const idVar = state.selectedVariable.idVariable || state.selectedVariable.id;
  const method = state.methodologies.find(m => String(m.idVariable || m.id || m.codigoVariable) === String(idVar));
  
  if (method) {
    DOM_BCRA.variableDescriptionBody.innerHTML = `
      <p><strong>Descripción Técnica:</strong> ${method.descripcion || 'Sin descripción metodológica cargada.'}</p>
      <p><strong>Periodicidad:</strong> ${method.periodicidad || 'Diaria/Mensual según variable.'}</p>
      ${method.observaciones ? `<p><strong>Observaciones:</strong> ${method.observaciones}</p>` : ''}
    `;
  } else {
    DOM_BCRA.variableDescriptionBody.innerHTML = `
      <p>Esta variable monetaria corresponde al código identificador <strong>${idVar}</strong> dentro del sistema del Banco Central de la República Argentina (BCRA).</p>
      <ul>
        <li><strong>Identificador:</strong> Variable ${idVar}</li>
        <li><strong>Nombre Oficial:</strong> ${state.selectedVariable.descripcion || 'No especificado'}</li>
        <li><strong>Frecuencia de actualización estimada:</strong> ${detectPeriodicidad(state.selectedVariable.descripcion || '')}</li>
        <li><strong>Origen de datos:</strong> Base de datos de Estadísticas Monetarias del BCRA (API v4.0).</li>
      </ul>
    `;
  }
}

function detectPeriodicidad(desc) {
  const d = desc.toLowerCase();
  if (d.includes('mensual')) return 'Mensual';
  if (d.includes('anual')) return 'Anual';
  if (d.includes('semanal')) return 'Semanal';
  return 'Diaria (Días hábiles)';
}

function handleQuickRangeClick(e) {
  const btn = e.target.closest('.range-btn');
  if (!btn) return;
  resetQuickRangeButtons();
  btn.classList.add('active');
  
  const days = btn.getAttribute('data-days');
  const len = state.historicalData.length;
  if (len === 0) return;
  
  if (days === 'all') {
    state.filteredData = [...state.historicalData];
    DOM_BCRA.startDate.value = state.historicalData[0].date;
    DOM_BCRA.endDate.value = state.historicalData[len - 1].date;
  } else {
    const numDays = parseInt(days);
    const endDateObj = new Date(state.historicalData[len - 1].date);
    const startDateObj = new Date(endDateObj);
    startDateObj.setDate(startDateObj.getDate() - numDays);
    
    const startStr = startDateObj.toISOString().split('T')[0];
    const endStr = endDateObj.toISOString().split('T')[0];
    DOM_BCRA.startDate.value = startStr;
    DOM_BCRA.endDate.value = endStr;
    state.filteredData = state.historicalData.filter(d => d.date >= startStr && d.date <= endStr);
  }
  updateDashboard();
}

function resetQuickRangeButtons() {
  document.querySelectorAll('#quickRanges .range-btn').forEach(btn => btn.classList.remove('active'));
}

function applyManualDatesFilter() {
  const startStr = DOM_BCRA.startDate.value;
  const endStr = DOM_BCRA.endDate.value;
  if (!startStr || !endStr) {
    showToast('Selecciona ambas fechas.', 'warning');
    return;
  }
  if (new Date(startStr) > new Date(endStr)) {
    showToast('Fecha de inicio posterior a la fecha de fin.', 'warning');
    return;
  }
  resetQuickRangeButtons();
  state.filteredData = state.historicalData.filter(d => d.date >= startStr && d.date <= endStr);
  if (state.filteredData.length === 0) showToast('No existen registros en ese período.', 'warning');
  updateDashboard();
}

function handleChartTypeClick(e) {
  const btn = e.target.closest('.chart-style-btn');
  if (!btn) return;
  document.querySelectorAll('#chartTypeSelector .chart-style-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  state.chartType = btn.getAttribute('data-type');
  renderChart();
}

function switchTab(tabId) {
  state.currentTab = tabId;
  DOM_BCRA.btnTabChart.classList.toggle('active', tabId === 'tabChart');
  DOM_BCRA.btnTabTable.classList.toggle('active', tabId === 'tabTable');
  document.getElementById('tabChart').classList.toggle('active', tabId === 'tabChart');
  document.getElementById('tabTable').classList.toggle('active', tabId === 'tabTable');
}

function exportToCsv() {
  if (state.filteredData.length === 0) return;
  const varId = state.selectedVariable ? (state.selectedVariable.idVariable || state.selectedVariable.id) : 'variable';
  const varDesc = state.selectedVariable ? state.selectedVariable.descripcion : 'Estadistica';
  let csvContent = `ID Variable: ${varId}\nDescripcion: ${varDesc}\nFecha;Valor\n`;
  state.filteredData.forEach(d => {
    csvContent += `${d.date};${String(d.value).replace('.', ',')}\n`;
  });
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `bcra_${varId}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}


// ==========================================
// 📊 MÓDULO B: INFLACIÓN Y ACTIVIDAD (INDEC)
// ==========================================
const IndecModule = {
  initialized: false,
  
  async init() {
    if (this.initialized) return;
    
    // Configurar event listeners de INDEC
    document.getElementById('indecRanges').addEventListener('click', (e) => {
      const btn = e.target.closest('.range-btn');
      if (!btn) return;
      document.querySelectorAll('#indecRanges .range-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.indec.days = btn.getAttribute('data-days') === 'all' ? 'all' : parseInt(btn.getAttribute('data-days'));
      this.processAndRender();
    });

    document.getElementById('btnShowIpc').addEventListener('click', () => this.switchMetric('ipc'));
    document.getElementById('btnShowEmae').addEventListener('click', () => this.switchMetric('emae'));
    document.getElementById('btnShowSalarios').addEventListener('click', () => this.switchMetric('salarios'));

    await this.fetchData();
    this.initialized = true;
  },

  async fetchData() {
    const loader = document.getElementById('loadingIndecOverlay');
    loader.classList.remove('hidden');

    try {
      // Pedimos las 4 series requeridas en una sola llamada proxy
      // IPC General (145.3_INGNACUAL_DICI_M_38), IPC Núcleo (145.3_INGNACNCLO_DICI_M_18),
      // RIPTE (158.1_REPTE_0_0_5), EMAE Desestacionalizado (143.3_DESESTACIOEMAE_M_28), EMAE Original (143.3_NO_SENS_EMAE_M_28)
      const ids = '145.3_INGNACUAL_DICI_M_38,145.3_INGNACNCLO_DICI_M_18,158.1_REPTE_0_0_5,143.3_DESESTACIOEMAE_M_28,143.3_NO_SENS_EMAE_M_28';
      const response = await fetch(`/api/indec/series?ids=${ids}&limit=1000`);
      if (!response.ok) throw new Error('Error al cargar datos del INDEC');
      
      const raw = await response.json();
      state.indec.raw = raw;
      
      // Parsear la respuesta tabular del INDEC
      // data: [ [fecha, val1, val2, val3, val4, val5], ... ]
      const fields = raw.meta.slice(1).map(m => m.field.id);
      state.indec.parsedData = raw.data.map(row => {
        const entry = { date: row[0] };
        fields.forEach((fid, index) => {
          entry[fid] = parseFloat(row[index + 1]);
        });
        return entry;
      }).filter(e => e.date).sort((a, b) => a.date.localeCompare(b.date));

      this.processAndRender();
      showToast('Datos del INDEC cargados con éxito.', 'success');
    } catch (error) {
      console.error(error);
      showToast('Error al descargar datos macroeconómicos.', 'danger');
    } finally {
      loader.classList.add('hidden');
    }
  },

  processAndRender() {
    const data = state.indec.parsedData;
    if (data.length === 0) return;

    // 1. Poblar KPIs con la última fecha
    const len = data.length;
    const latest = data[len - 1];

    // Inflación mensual general
    const ipcMensual = latest['145.3_INGNACUAL_DICI_M_38'];
    document.getElementById('ipcMensualValue').textContent = (ipcMensual !== undefined) ? `${ipcMensual.toFixed(1)}%` : '-';
    document.getElementById('ipcMensualDate').textContent = formatDate(latest.date);

    // Inflación Interanual YoY (Capitalizando las tasas de los últimos 12 meses)
    let ipcAnualVal = 0;
    if (len >= 12) {
      let acum = 1;
      for (let i = len - 12; i < len; i++) {
        const tasa = data[i]['145.3_INGNACUAL_DICI_M_38'] || 0;
        acum *= (1 + tasa / 100);
      }
      ipcAnualVal = (acum - 1) * 100;
    }
    document.getElementById('ipcAnualValue').textContent = ipcAnualVal > 0 ? `${ipcAnualVal.toFixed(1)}%` : '-';
    document.getElementById('ipcAnualDate').textContent = `Acumulado 12 Meses`;

    // RIPTE Salario
    const ripte = latest['158.1_REPTE_0_0_5'];
    document.getElementById('ripteValue').textContent = ripte ? `$${formatValue(ripte)}` : '-';
    document.getElementById('ripteDate').textContent = `Salario promedio a ${formatDate(latest.date).slice(3)}`;

    // EMAE Actividad Económica (Calculamos variación YoY vs 12 meses atrás)
    let emaeYoY = 0;
    if (len >= 13) {
      const emaeAct = latest['143.3_NO_SENS_EMAE_M_28'];
      const emaePrev = data[len - 13]['143.3_NO_SENS_EMAE_M_28'];
      if (emaePrev > 0) {
        emaeYoY = ((emaeAct - emaePrev) / emaePrev) * 100;
      }
    }
    document.getElementById('emaeValue').textContent = (emaeYoY >= 0 ? '+' : '') + emaeYoY.toFixed(1) + '%';

    // 2. Filtrar por rango
    let filtered = [...data];
    if (state.indec.days !== 'all') {
      const targetDate = new Date();
      targetDate.setDate(targetDate.getDate() - state.indec.days);
      const targetStr = targetDate.toISOString().split('T')[0];
      filtered = data.filter(d => d.date >= targetStr);
    }

    // 3. Renderizar gráfico
    this.renderChart(filtered);
  },

  switchMetric(metric) {
    state.indec.activeMetric = metric;
    
    document.getElementById('btnShowIpc').className = 'btn btn-secondary btn-sm';
    document.getElementById('btnShowEmae').className = 'btn btn-secondary btn-sm';
    document.getElementById('btnShowSalarios').className = 'btn btn-secondary btn-sm';

    if (metric === 'ipc') {
      document.getElementById('btnShowIpc').classList.add('active', 'btn-primary');
      document.getElementById('btnShowIpc').style.backgroundColor = 'var(--theme-indec)';
    } else if (metric === 'emae') {
      document.getElementById('btnShowEmae').classList.add('active', 'btn-primary');
      document.getElementById('btnShowEmae').style.backgroundColor = 'var(--theme-indec)';
    } else {
      document.getElementById('btnShowSalarios').classList.add('active', 'btn-primary');
      document.getElementById('btnShowSalarios').style.backgroundColor = 'var(--theme-indec)';
    }

    this.processAndRender();
  },

  renderChart(chartData) {
    const ctx = document.getElementById('indecChart').getContext('2d');
    if (state.indec.chart) state.indec.chart.destroy();

    const isDark = document.body.classList.contains('dark-theme');
    const textColor = getComputedStyle(document.body).getPropertyValue('--text-secondary').trim();
    const gridColor = getComputedStyle(document.body).getPropertyValue('--border-color').trim();
    
    const labels = chartData.map(d => formatDate(d.date).slice(3)); // formato MM/YYYY
    let datasets = [];

    if (state.indec.activeMetric === 'ipc') {
      datasets = [
        {
          label: 'Inflación Mensual General (%)',
          data: chartData.map(d => d['145.3_INGNACUAL_DICI_M_38']),
          borderColor: '#bf5af2',
          backgroundColor: 'rgba(191, 90, 242, 0.15)',
          fill: true,
          tension: 0.15,
          borderWidth: 2
        },
        {
          label: 'Inflación Núcleo (%)',
          data: chartData.map(d => d['145.3_INGNACNCLO_DICI_M_18']),
          borderColor: '#f43f5e',
          borderDash: [5, 5],
          backgroundColor: 'transparent',
          fill: false,
          tension: 0.15,
          borderWidth: 1.5
        }
      ];
    } else if (state.indec.activeMetric === 'emae') {
      // Calculamos variación interanual móvil del EMAE original
      const emaeYoYList = chartData.map((d, idx) => {
        const fullIdx = state.indec.parsedData.findIndex(x => x.date === d.date);
        if (fullIdx >= 12) {
          const act = state.indec.parsedData[fullIdx]['143.3_NO_SENS_EMAE_M_28'];
          const prev = state.indec.parsedData[fullIdx - 12]['143.3_NO_SENS_EMAE_M_28'];
          return prev > 0 ? ((act - prev) / prev) * 100 : 0;
        }
        return 0;
      });

      datasets = [
        {
          label: 'Crecimiento de la Actividad Económica (EMAE YoY %)',
          data: emaeYoYList,
          borderColor: '#ffd60a',
          backgroundColor: 'rgba(255, 214, 10, 0.2)',
          fill: true,
          type: 'bar',
          borderWidth: 1
        }
      ];
    } else if (state.indec.activeMetric === 'salarios') {
      // Graficar Salarios (RIPTE) acumulado vs Inflación (IPC) acumulado en base 100
      // Normalizamos el primer mes del dataset seleccionado a base 100
      let baseIpc = 100;
      let baseRipte = 100;

      const ipcAcumulado = [];
      const ripteAcumulado = [];

      chartData.forEach((d, idx) => {
        if (idx === 0) {
          ipcAcumulado.push(100);
          ripteAcumulado.push(100);
        } else {
          // El IPC general es variación mensual, capitalizamos el índice
          const tasaIpc = d['145.3_INGNACUAL_DICI_M_38'] || 0;
          baseIpc *= (1 + tasaIpc / 100);
          ipcAcumulado.push(baseIpc);

          // RIPTE es un salario nominal, calculamos su índice relativo al primer mes
          const ripteActual = d['158.1_REPTE_0_0_5'];
          const ripteBaseVal = chartData[0]['158.1_REPTE_0_0_5'];
          const ripteIdx = ripteBaseVal > 0 ? (ripteActual / ripteBaseVal) * 100 : 100;
          ripteAcumulado.push(ripteIdx);
        }
      });

      datasets = [
        {
          label: 'Evolución de Salarios RIPTE (Base 100)',
          data: ripteAcumulado,
          borderColor: '#00f0ff',
          backgroundColor: 'transparent',
          fill: false,
          tension: 0.1,
          borderWidth: 2.5
        },
        {
          label: 'Evolución del Costo de Vida IPC (Base 100)',
          data: ipcAcumulado,
          borderColor: '#bf5af2',
          backgroundColor: 'transparent',
          fill: false,
          tension: 0.1,
          borderWidth: 2.5
        }
      ];
    }

    state.indec.chart = new Chart(ctx, {
      type: 'line',
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
  },

  updateChartTheme() {
    if (!state.indec.chart) return;
    const textColor = getComputedStyle(document.body).getPropertyValue('--text-secondary').trim();
    const gridColor = getComputedStyle(document.body).getPropertyValue('--border-color').trim();
    state.indec.chart.options.scales.x.ticks.color = textColor;
    state.indec.chart.options.scales.y.ticks.color = textColor;
    state.indec.chart.options.scales.y.grid.color = gridColor;
    state.indec.chart.options.plugins.legend.labels.color = textColor;
    state.indec.chart.update('none');
  }
};


// ==========================================
// 💵 MÓDULO C: DÓLARES Y BRECHAS (Mercado)
// ==========================================
const DolaresModule = {
  initialized: false,
  
  async init() {
    if (this.initialized) return;

    // Rango rápido de dólares
    document.getElementById('dolaresRanges').addEventListener('click', (e) => {
      const btn = e.target.closest('.range-btn');
      if (!btn) return;
      document.querySelectorAll('#dolaresRanges .range-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.dolares.days = btn.getAttribute('data-days') === 'all' ? 'all' : parseInt(btn.getAttribute('data-days'));
      this.renderChart();
    });

    document.getElementById('btnShowDolarChart').addEventListener('click', () => this.switchView('prices'));
    document.getElementById('btnShowBrechaChart').addEventListener('click', () => this.switchView('brecha'));

    await this.fetchData();
    this.initialized = true;
  },

  async fetchData() {
    const loader = document.getElementById('loadingDolaresOverlay');
    loader.classList.remove('hidden');

    try {
      // 1. Obtener Dólar MEP y CCL en vivo desde Data912
      const [mepRes, cclRes] = await Promise.all([
        fetch('/api/mercado/live/mep'),
        fetch('/api/mercado/live/ccl')
      ]);

      const mepRaw = mepRes.ok ? await mepRes.json() : 0;
      const cclRaw = cclRes.ok ? await cclRes.json() : 0;

      const getPrice = (data) => {
        if (typeof data === 'number') return data;
        if (typeof data === 'string') return parseFloat(data);
        if (Array.isArray(data) && data.length > 0) return getPrice(data[0]);
        if (data && typeof data === 'object') return parseFloat(data.price || data.valor || data.value || data.close || 0);
        return 0;
      };

      state.dolares.live.mep = getPrice(mepRaw) || 1200; // fallback si falla
      state.dolares.live.ccl = getPrice(cclRaw) || 1240;

      // 2. Obtener Dólar Oficial actual (Variable 4 del BCRA)
      // Como ya tenemos el catálogo de variables, podemos buscar el último valor de la variable 4
      const oficialVar = state.variables.find(v => String(v.idVariable || v.id) === '4');
      state.dolares.live.oficial = oficialVar ? parseFloat(oficialVar.ultValorInformado) : 950;
      
      // Estimar Dólar Blue (MEP + spread del 3.5%)
      state.dolares.live.blue = state.dolares.live.mep * 1.035;

      // Actualizar tarjetas en vivo
      this.renderLiveCards();

      // 3. Obtener Históricos: Oficial (BCRA) e históricos de BYMA (AL30 y AL30D) para el MEP
      const [oficialHistRes, al30HistRes, al30dHistRes] = await Promise.all([
        fetch('/api/monetarias/4'), // Oficial histórico
        fetch('/api/byma/historico/AL30%2024HS?resolution=D'), // AL30 en Pesos
        fetch('/api/byma/historico/AL30D%2024HS?resolution=D') // AL30 en USD
      ]);

      const oficialHist = oficialHistRes.ok ? await oficialHistRes.json() : {};
      const al30Hist = al30HistRes.ok ? await al30HistRes.json() : {};
      const al30dHist = al30dHistRes.ok ? await al30dHistRes.json() : {};

      // Procesar Oficial Histórico
      let rawOficial = [];
      if (oficialHist && oficialHist.results && Array.isArray(oficialHist.results)) {
        rawOficial = oficialHist.results[0].detalle || oficialHist.results;
      } else {
        rawOficial = Array.isArray(oficialHist) ? oficialHist : (oficialHist.data || []);
      }
      
      const parsedOficial = rawOficial.map(item => ({
        date: item.fecha,
        value: parseFloat(item.valor)
      })).filter(item => item.date && !isNaN(item.value));

      // Calcular MEP Histórico dividiendo cierres de AL30 / AL30D por fecha
      const parsedMep = [];
      if (al30Hist && al30Hist.t && al30dHist && al30dHist.t) {
        const al30dMap = {};
        al30dHist.t.forEach((ts, idx) => {
          al30dMap[ts] = al30dHist.c[idx];
        });

        al30Hist.t.forEach((ts, idx) => {
          const pes = al30Hist.c[idx];
          const usd = al30dMap[ts];
          if (pes && usd && usd > 0) {
            const dateStr = new Date(ts * 1000).toISOString().split('T')[0];
            parsedMep.push({
              date: dateStr,
              value: pes / usd
            });
          }
        });
      }

      // Sincronizar series por fecha
      state.dolares.historical.oficial = parsedOficial;
      state.dolares.historical.mep = parsedMep.sort((a,b) => a.date.localeCompare(b.date));
      
      this.renderChart();
      showToast('Cotizaciones y brecha cambiaria actualizadas.', 'success');
    } catch (error) {
      console.error(error);
      showToast('Error al obtener cotizaciones del mercado.', 'danger');
    } finally {
      loader.classList.add('hidden');
    }
  },

  renderLiveCards() {
    const live = state.dolares.live;

    document.getElementById('dolarOficialValue').textContent = `$${formatValue(live.oficial)}`;
    document.getElementById('dolarMepValue').textContent = `$${formatValue(live.mep)}`;
    document.getElementById('dolarCclValue').textContent = `$${formatValue(live.ccl)}`;
    document.getElementById('dolarBlueValue').textContent = `$${formatValue(live.blue)}`;

    const brechaMep = ((live.mep - live.oficial) / live.oficial) * 100;
    const brechaCcl = ((live.ccl - live.oficial) / live.oficial) * 100;
    const brechaBlue = ((live.blue - live.oficial) / live.oficial) * 100;

    document.getElementById('brechaMepValue').textContent = `Brecha: ${brechaMep.toFixed(1)}%`;
    document.getElementById('brechaCclValue').textContent = `Brecha: ${brechaCcl.toFixed(1)}%`;
    document.getElementById('brechaBlueValue').textContent = `Brecha: ${brechaBlue.toFixed(1)}%`;
  },

  switchView(view) {
    state.dolares.activeView = view;
    document.getElementById('btnShowDolarChart').classList.toggle('active', view === 'prices');
    document.getElementById('btnShowBrechaChart').classList.toggle('active', view === 'brecha');
    this.renderChart();
  },

  renderChart() {
    const ctx = document.getElementById('dolaresChart').getContext('2d');
    if (state.dolares.chart) state.dolares.chart.destroy();

    const isDark = document.body.classList.contains('dark-theme');
    const textColor = getComputedStyle(document.body).getPropertyValue('--text-secondary').trim();
    const gridColor = getComputedStyle(document.body).getPropertyValue('--border-color').trim();

    // Cruzar e integrar históricos de los últimos N días
    const mepData = state.dolares.historical.mep;
    const oficialData = state.dolares.historical.oficial;

    if (mepData.length === 0 || oficialData.length === 0) return;

    // Filtrar por rango
    let filteredMep = [...mepData];
    if (state.dolares.days !== 'all') {
      const targetDate = new Date();
      targetDate.setDate(targetDate.getDate() - state.dolares.days);
      const targetStr = targetDate.toISOString().split('T')[0];
      filteredMep = mepData.filter(d => d.date >= targetStr);
    }

    // Alinear el oficial a las mismas fechas del MEP
    const dates = filteredMep.map(d => d.date);
    const oficialMap = {};
    oficialData.forEach(d => oficialMap[d.date] = d.value);

    const labels = dates.map(d => formatDate(d));
    let datasets = [];

    if (state.dolares.activeView === 'prices') {
      datasets = [
        {
          label: 'Dólar MEP ($)',
          data: filteredMep.map(d => d.value),
          borderColor: '#30d158',
          backgroundColor: 'rgba(48, 209, 88, 0.1)',
          fill: true,
          tension: 0.1,
          borderWidth: 2.5
        },
        {
          label: 'Dólar Oficial BNA ($)',
          data: dates.map(d => oficialMap[d] || null),
          borderColor: '#ffffff',
          backgroundColor: 'transparent',
          fill: false,
          tension: 0.1,
          borderWidth: 2
        }
      ];
    } else {
      // Calcular brecha diaria
      const brechaData = filteredMep.map(d => {
        const oficialPrice = oficialMap[d.date];
        if (oficialPrice > 0) {
          return ((d.value - oficialPrice) / oficialPrice) * 100;
        }
        return null;
      });

      datasets = [
        {
          label: 'Brecha Cambiaria (%)',
          data: brechaData,
          borderColor: '#ffd60a',
          backgroundColor: 'rgba(255, 214, 10, 0.15)',
          fill: true,
          tension: 0.1,
          borderWidth: 2
        }
      ];
    }

    state.dolares.chart = new Chart(ctx, {
      type: 'line',
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: true, labels: { color: textColor } },
          tooltip: {
            backgroundColor: isDark ? '#0f172a' : '#ffffff',
            titleColor: isDark ? '#f8fafc' : '#0f172a',
            bodyColor: isDark ? '#94a3b8' : '#64748b',
            borderColor: gridColor,
            borderWidth: 1,
            callbacks: {
              label: context => ` ${context.dataset.label}: ${context.raw ? context.raw.toFixed(2) : '-'} `
            }
          }
        },
        scales: {
          x: { grid: { display: false }, ticks: { color: textColor, maxTicksLimit: 10 } },
          y: { grid: { color: gridColor }, ticks: { color: textColor } }
        }
      }
    });
  },

  updateChartTheme() {
    if (!state.dolares.chart) return;
    const textColor = getComputedStyle(document.body).getPropertyValue('--text-secondary').trim();
    const gridColor = getComputedStyle(document.body).getPropertyValue('--border-color').trim();
    state.dolares.chart.options.scales.x.ticks.color = textColor;
    state.dolares.chart.options.scales.y.ticks.color = textColor;
    state.dolares.chart.options.scales.y.grid.color = gridColor;
    state.dolares.chart.options.plugins.legend.labels.color = textColor;
    state.dolares.chart.update('none');
  }
};


// ==========================================
// 📈 MÓDULO D: BONOS Y LETRAS (BYMA)
// ==========================================
const BymaModule = {
  initialized: false,

  async init() {
    if (this.initialized) return;

    // Buscador local en la tabla
    document.getElementById('bymaSearchInput').addEventListener('input', (e) => {
      state.byma.searchQuery = e.target.value.toUpperCase().trim();
      this.renderTable();
    });

    await this.fetchPanel();
    this.initialized = true;
  },

  async fetchPanel() {
    const loader = document.getElementById('loadingBymaOverlay');
    loader.classList.remove('hidden');

    try {
      const response = await fetch('/api/byma/panel/public-bonds');
      if (!response.ok) throw new Error('Error al cargar panel de BYMA');
      const result = await response.json();
      
      // La API de BYMA devuelve `{ data: [...] }`
      state.byma.bonds = result.data || result;
      this.renderTable();
      showToast('Panel de bonos de BYMA cargado.', 'success');
    } catch (error) {
      console.error(error);
      showToast('Error al conectar con BYMA.', 'danger');
    } finally {
      loader.classList.add('hidden');
    }
  },

  renderTable() {
    const tbody = document.getElementById('bymaTableBody');
    tbody.innerHTML = '';

    // Filtrar especies de interés del mercado secundario (Soberanos en pesos y dólares MEP, y LECAPs)
    // Especies líderes: AL30, AL30D, GD30, GD30D, AE38, AE38D, GD35, GD35D y LECAPs (comienzan con S)
    const curados = ['AL30', 'AL30D', 'GD30', 'GD30D', 'AE38', 'AE38D', 'GD35', 'GD35D', 'AL29', 'AL29D'];
    
    let filtered = state.byma.bonds.filter(b => {
      // Filtrar por plazo de liquidación estándar 24hs (T+1)
      if (b.settlementType !== '2') return false;

      const sym = b.symbol;
      // Filtrar por búsqueda si existe
      if (state.byma.searchQuery) {
        return sym.includes(state.byma.searchQuery);
      }
      // Si no hay búsqueda, mostrar los curados más las especies que empiecen con S (LECAPs con volumen)
      return curados.includes(sym) || (sym.startsWith('S') && sym.length === 5 && b.volume > 0);
    });

    // Ordenar: Alfabéticamente por símbolo
    filtered.sort((a,b) => a.symbol.localeCompare(b.symbol));

    if (filtered.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" class="text-center">No se encontraron especies.</td></tr>';
      return;
    }

    filtered.forEach(b => {
      const tr = document.createElement('tr');
      const varPct = (b.imbalance || 0) * 100;
      const varClass = varPct > 0 ? 'text-success' : (varPct < 0 ? 'text-danger' : '');
      const varText = varPct !== 0 ? `${varPct > 0 ? '+' : ''}${varPct.toFixed(2)}%` : '0.00%';

      tr.innerHTML = `
        <td class="font-bold" style="color: var(--text-primary);">${b.symbol}</td>
        <td class="text-right font-medium">${formatValue(b.trade)}</td>
        <td class="text-right ${varClass}">${varText}</td>
        <td class="text-right text-muted">${formatValueCompact(b.volumeAmount)}</td>
      `;

      if (state.byma.selectedBond && state.byma.selectedBond.symbol === b.symbol) {
        tr.classList.add('active');
      }

      tr.addEventListener('click', () => this.handleSelectBond(b, tr));
      tbody.appendChild(tr);
    });
  },

  async handleSelectBond(bond, rowElement) {
    state.byma.selectedBond = bond;
    
    // UI active row
    document.querySelectorAll('#bymaTableBody tr').forEach(r => r.classList.remove('active'));
    rowElement.classList.add('active');

    // Cargar ficha técnica desde el backend
    document.getElementById('bymaNoSelection').classList.add('hidden');
    const dataContainer = document.getElementById('bymaBonoData');
    dataContainer.classList.add('hidden');
    
    // Título superior
    document.getElementById('bymaBonoName').textContent = bond.symbol;
    document.getElementById('bymaBonoDesc').textContent = 'Consultando ficha técnica...';

    try {
      // Remover sufijo D de settlement de moneda para pedir la ficha técnica general del bono
      const cleanSymbol = bond.symbol.replace(/[D|C|X|Y|Z]$/, '');
      const response = await fetch(`/api/byma/bond-info/${cleanSymbol}`);
      if (!response.ok) throw new Error('Ficha técnica no encontrada');
      
      const result = await response.json();
      const info = (result.data && result.data.length > 0) ? result.data[0] : null;

      if (info) {
        document.getElementById('bymaBonoDesc').textContent = info.denominacion || 'Título Público';
        document.getElementById('bonoIsin').textContent = info.codigoIsin || '-';
        document.getElementById('bonoMoneda').textContent = info.moneda || '-';
        document.getElementById('bonoLey').textContent = info.ley || '-';
        document.getElementById('bonoEmisor').textContent = info.emisor || '-';
        document.getElementById('bonoMontoNominal').textContent = formatValueCompact(info.montoNominal);
        document.getElementById('bonoMontoResidual').textContent = info.montoResidual ? `${(info.montoResidual * 100).toFixed(2)}%` : '-';
        
        document.getElementById('bonoAmortizacion').textContent = info.formaAmortizacion || 'Al vencimiento (Bullet).';
        document.getElementById('bonoInteres').textContent = info.interes || 'Esquema de cupones no especificado.';
        
        dataContainer.classList.remove('hidden');
      } else {
        document.getElementById('bymaBonoDesc').textContent = 'Información general';
        document.getElementById('bonoIsin').textContent = '-';
        document.getElementById('bonoMoneda').textContent = bond.denominationCcy || '-';
        document.getElementById('bonoLey').textContent = '-';
        document.getElementById('bonoEmisor').textContent = '-';
        document.getElementById('bonoMontoNominal').textContent = '-';
        document.getElementById('bonoMontoResidual').textContent = '-';
        document.getElementById('bonoAmortizacion').textContent = 'Al vencimiento (Bullet).';
        document.getElementById('bonoInteres').textContent = 'Esquema de cupones no disponible.';
        dataContainer.classList.remove('hidden');
      }
    } catch (error) {
      console.error(error);
      showToast('Error al cargar la ficha del bono.', 'warning');
    }
  }
};


// ==========================================
// UTILIDADES COMPARTIDAS
// ==========================================

function formatValue(value) {
  if (isNaN(value) || value === null) return '-';
  return new Intl.NumberFormat('es-AR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value);
}

function formatValueCompact(value) {
  if (value === null || isNaN(value)) return '-';
  if (Math.abs(value) >= 1.0e+12) return (value / 1.0e+12).toFixed(1) + ' B';
  if (Math.abs(value) >= 1.0e+9) return (value / 1.0e+9).toFixed(1) + ' M.M.';
  if (Math.abs(value) >= 1.0e+6) return (value / 1.0e+6).toFixed(1) + ' M';
  if (Math.abs(value) >= 1.0e+3) return (value / 1.0e+3).toFixed(1) + ' K';
  return formatValue(value);
}

function formatDate(dateString) {
  if (!dateString) return '-';
  const parts = dateString.split('-');
  if (parts.length !== 3) return dateString;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

function showDataLoader(show, text = 'Cargando...') {
  if (show) {
    DOM_BCRA.loadingDataText.textContent = text;
    DOM_BCRA.loadingDataOverlay.classList.remove('hidden');
  } else {
    DOM_BCRA.loadingDataOverlay.classList.add('hidden');
  }
}

function showToast(message, type = 'success') {
  DOM.toastMessage.textContent = message;
  DOM.toastIcon.className = 'fa-solid toast-icon';
  if (type === 'success') {
    DOM.toastIcon.classList.add('fa-circle-check');
    DOM.toast.style.borderLeftColor = 'var(--success)';
  } else if (type === 'warning') {
    DOM.toastIcon.classList.add('fa-triangle-exclamation');
    DOM.toast.style.borderLeftColor = 'var(--warning)';
  } else {
    DOM.toastIcon.classList.add('fa-circle-exclamation');
    DOM.toast.style.borderLeftColor = 'var(--danger)';
  }
  
  DOM.toast.classList.remove('hidden');
  DOM.toast.style.opacity = '1';
  
  setTimeout(() => {
    DOM.toast.style.opacity = '0';
    setTimeout(() => { DOM.toast.classList.add('hidden'); }, 200);
  }, 4000);
}
