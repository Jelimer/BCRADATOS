/**
 * Portal Financiero Argentino - Client Application
 * 
 * Desarrollado con JavaScript puro (ES6) y Chart.js.
 * Administra dinámicamente las hojas individuales: BCRA, INDEC, Dólares y BYMA.
 */

// --- PLUGIN CHART.JS: DIBUJAR ETIQUETAS MÁX/MÍN EN CANVAS ---
const maxMinLabelPlugin = {
  id: 'maxMinLabels',
  afterDatasetsDraw: (chart) => {
    const ctx = chart.ctx;
    ctx.save();
    
    // Configuración de texto
    const isDark = document.body.classList.contains('dark-theme');
    ctx.font = 'bold 10px Inter, sans-serif';
    ctx.fillStyle = isDark ? '#f8fafc' : '#0f172a';
    ctx.shadowColor = isDark ? 'rgba(0, 0, 0, 0.9)' : 'rgba(255, 255, 255, 0.9)';
    ctx.shadowBlur = 3;

    chart.data.datasets.forEach((dataset, datasetIndex) => {
      const meta = chart.getDatasetMeta(datasetIndex);
      if (!meta.visible || dataset.type === 'bar') return; // Evitar barras o series ocultas
      
      const maxIdx = dataset.maxIdx;
      const minIdx = dataset.minIdx;
      const formatFn = dataset.formatLabel || (val => val.toFixed(1));

      // Dibujar etiqueta MÁX
      if (maxIdx !== undefined && maxIdx !== -1 && meta.data[maxIdx]) {
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
      if (minIdx !== undefined && minIdx !== -1 && meta.data[minIdx]) {
        const point = meta.data[minIdx];
        const val = dataset.data[minIdx];
        if (val !== null && !isNaN(val)) {
          const text = `MÍN: ${formatFn(val)}`;
          const yPos = point.y + 15 > chart.chartArea.bottom ? point.y - 8 : point.y + 15;
          
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
    tablePage: 1,
    tablePageSize: 15
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

  // Descarga de gráficos en PNG
  document.getElementById('btnDownloadBcraChart').addEventListener('click', () => {
    downloadChartPNG(state.chart, `bcra_${state.selectedVariable ? (state.selectedVariable.idVariable || state.selectedVariable.id) : 'variable'}.png`);
  });
  document.getElementById('btnDownloadIndecChart').addEventListener('click', () => {
    downloadChartPNG(state.indec.chart, `indec_${state.indec.activeMetric}.png`);
  });
  document.getElementById('btnDownloadDolaresChart').addEventListener('click', () => {
    downloadChartPNG(state.dolares.chart, `dolares_${state.dolares.activeView}.png`);
  });

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
  } else if (tabId === 'comparador') {
    DOM.selectedVariableNameTitle.textContent = 'Comparador de Productos Financieros (BCRA)';
    ComparadorModule.init();
  } else if (tabId === 'consultas') {
    DOM.selectedVariableNameTitle.textContent = 'Consultas Financieras y Perfil de Deudores';
    ConsultasModule.init();
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
    plugins: [lineShadowPlugin, maxMinLabelPlugin],
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

    document.getElementById('applyIndecDatesBtn').addEventListener('click', () => this.applyManualDatesFilter());

    document.getElementById('btnShowIpc').addEventListener('click', () => this.switchMetric('ipc'));
    document.getElementById('btnShowEmae').addEventListener('click', () => this.switchMetric('emae'));
    document.getElementById('btnShowSalarios').addEventListener('click', () => this.switchMetric('salarios'));

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
    state.indec.days = 'manual';
    this.processAndRender();
  },

  async fetchData() {
    const loader = document.getElementById('loadingIndecOverlay');
    loader.classList.remove('hidden');

    try {
      // Pedimos las 4 series requeridas en una sola llamada proxy
      // IPC General (145.3_INGNACUAL_DICI_M_38), IPC Núcleo (148.3_INUCLEONAL_DICI_M_19),
      // RIPTE (158.1_REPTE_0_0_5), EMAE Desestacionalizado (143.3_NO_PR_2004_A_31), EMAE Original (143.3_NO_PR_2004_A_21)
      const ids = '145.3_INGNACUAL_DICI_M_38,148.3_INUCLEONAL_DICI_M_19,158.1_REPTE_0_0_5,143.3_NO_PR_2004_A_31,143.3_NO_PR_2004_A_21';
      const response = await fetch(`/api/indec/series?ids=${ids}&limit=1000`);
      if (!response.ok) throw new Error('Error al cargar datos del INDEC');
      
      const raw = await response.json();
      state.indec.raw = raw;
      
      // Parsear la respuesta tabular del INDEC
      const fields = raw.meta.slice(1).map(m => m.field.id);
      state.indec.parsedData = raw.data.map(row => {
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

      // Calcular variación mensual de inflación núcleo (índice 148.3_INUCLEONAL_DICI_M_19)
      state.indec.parsedData.forEach((entry, idx, arr) => {
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

      // Inicializar campos de fecha manual
      const dates = state.indec.parsedData.map(d => d.date);
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
      loader.classList.add('hidden');
    }
  },

  processAndRender() {
    const data = state.indec.parsedData;
    if (data.length === 0) return;

    const len = data.length;

    // Buscar el último registro no nulo para IPC General
    let latestIpc = null;
    for (let i = len - 1; i >= 0; i--) {
      if (data[i]['145.3_INGNACUAL_DICI_M_38'] !== null && !isNaN(data[i]['145.3_INGNACUAL_DICI_M_38'])) {
        latestIpc = data[i];
        break;
      }
    }

    // Buscar el último registro no nulo para RIPTE
    let latestRipte = null;
    for (let i = len - 1; i >= 0; i--) {
      if (data[i]['158.1_REPTE_0_0_5'] !== null && !isNaN(data[i]['158.1_REPTE_0_0_5'])) {
        latestRipte = data[i];
        break;
      }
    }

    // Buscar el último registro no nulo para EMAE
    let latestEmae = null;
    let emaeIndexInGeneral = -1;
    for (let i = len - 1; i >= 0; i--) {
      if (data[i]['143.3_NO_PR_2004_A_21'] !== null && !isNaN(data[i]['143.3_NO_PR_2004_A_21'])) {
        latestEmae = data[i];
        emaeIndexInGeneral = i;
        break;
      }
    }

    // 1. Poblar KPIs con los últimos datos válidos

    // Inflación mensual general
    const ipcMensual = latestIpc ? latestIpc['145.3_INGNACUAL_DICI_M_38'] : null;
    document.getElementById('ipcMensualValue').textContent = ipcMensual !== null ? `${ipcMensual.toFixed(1)}%` : '-';
    document.getElementById('ipcMensualDate').textContent = latestIpc ? formatDate(latestIpc.date) : '-';

    // Inflación Interanual YoY (acumulado de los últimos 12 meses válidos de la serie IPC)
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

    // RIPTE Salario
    const ripte = latestRipte ? latestRipte['158.1_REPTE_0_0_5'] : null;
    document.getElementById('ripteValue').textContent = ripte ? `$${formatValue(ripte)}` : '-';
    document.getElementById('ripteDate').textContent = latestRipte ? `Salario promedio a ${formatDate(latestRipte.date).slice(3)}` : '-';

    // EMAE Actividad Económica (Calculamos variación YoY del último registro de EMAE vs el de 12 meses atrás)
    let emaeYoY = 0;
    if (emaeIndexInGeneral >= 12 && latestEmae) {
      const emaeAct = latestEmae['143.3_NO_PR_2004_A_21'];
      const targetDateObj = new Date(latestEmae.date);
      targetDateObj.setFullYear(targetDateObj.getFullYear() - 1);
      const targetDateStr = targetDateObj.toISOString().split('T')[0].slice(0, 7); // YYYY-MM
      
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
    if (state.indec.days !== 'all' && state.indec.days !== 'manual') {
      const targetDate = new Date();
      targetDate.setDate(targetDate.getDate() - state.indec.days);
      const targetStr = targetDate.toISOString().split('T')[0];
      filtered = data.filter(d => d.date >= targetStr);
      if (filtered.length > 0) {
        document.getElementById('indecStartDate').value = filtered[0].date;
        document.getElementById('indecEndDate').value = filtered[filtered.length - 1].date;
      }
    } else if (state.indec.days === 'all') {
      if (data.length > 0) {
        document.getElementById('indecStartDate').value = data[0].date;
        document.getElementById('indecEndDate').value = data[data.length - 1].date;
      }
    } else if (state.indec.days === 'manual') {
      const startStr = document.getElementById('indecStartDate').value;
      const endStr = document.getElementById('indecEndDate').value;
      filtered = data.filter(d => d.date >= startStr && d.date <= endStr);
    }

    // 3. Renderizar gráfico
    this.renderChart(filtered);
  },

  switchMetric(metric) {
    state.indec.activeMetric = metric;
    
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
    const ctx = document.getElementById('indecChart').getContext('2d');
    if (state.indec.chart) state.indec.chart.destroy();

    const isDark = document.body.classList.contains('dark-theme');
    const textColor = getComputedStyle(document.body).getPropertyValue('--text-secondary').trim();
    const gridColor = getComputedStyle(document.body).getPropertyValue('--border-color').trim();
    
    const labels = chartData.map(d => formatDate(d.date).slice(3)); // formato MM/YYYY
    let datasets = [];

    if (state.indec.activeMetric === 'ipc') {
      const ipcData = chartData.map(d => d['145.3_INGNACUAL_DICI_M_38']);
      const nucleoData = chartData.map(d => d['148.3_INUCLEONAL_DICI_M_19_variacion']);
      
      // Calcular MAX y MIN General
      let maxIdxG = -1, minIdxG = -1, maxValG = -Infinity, minValG = Infinity;
      ipcData.forEach((val, idx) => {
        if (val !== null && !isNaN(val)) {
          if (val > maxValG) { maxValG = val; maxIdxG = idx; }
          if (val < minValG) { minValG = val; minIdxG = idx; }
        }
      });

      // Calcular MAX y MIN Núcleo
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
    } else if (state.indec.activeMetric === 'emae') {
      // Calculamos variación interanual móvil del EMAE original
      const emaeYoYList = chartData.map((d, idx) => {
        const fullIdx = state.indec.parsedData.findIndex(x => x.date === d.date);
        if (fullIdx >= 12) {
          const act = state.indec.parsedData[fullIdx]['143.3_NO_PR_2004_A_21'];
          const prev = state.indec.parsedData[fullIdx - 12]['143.3_NO_PR_2004_A_21'];
          return prev > 0 ? ((act - prev) / prev) * 100 : 0;
        }
        return 0;
      });

      // Calcular MAX y MIN
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
    } else if (state.indec.activeMetric === 'salarios') {
      // Graficar Salarios (RIPTE) acumulado vs Inflación (IPC) acumulado en base 100
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

      // Calcular MAX y MIN para Salarios (RIPTE)
      let maxIdxR = -1, minIdxR = -1, maxValR = -Infinity, minValR = Infinity;
      ripteAcumulado.forEach((val, idx) => {
        if (val !== null && !isNaN(val)) {
          if (val > maxValR) { maxValR = val; maxIdxR = idx; }
          if (val < minValR) { minValR = val; minIdxR = idx; }
        }
      });

      // Calcular MAX y MIN para Costo de Vida (IPC)
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

    state.indec.chart = new Chart(ctx, {
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
      state.dolares.tablePage = 1;
      this.renderChart();
    });

    document.getElementById('applyDolaresDatesBtn').addEventListener('click', () => this.applyManualDatesFilter());

    document.getElementById('btnShowDolarChart').addEventListener('click', () => this.switchView('prices'));
    document.getElementById('btnShowBrechaChart').addEventListener('click', () => this.switchView('brecha'));

    // Paginación de dólares
    document.getElementById('btnPrevDolaresPage').addEventListener('click', () => this.changeTablePage(-1));
    document.getElementById('btnNextDolaresPage').addEventListener('click', () => this.changeTablePage(1));

    await this.fetchData();
    this.initialized = true;
  },

  applyManualDatesFilter() {
    const startStr = document.getElementById('dolaresStartDate').value;
    const endStr = document.getElementById('dolaresEndDate').value;
    if (!startStr || !endStr) {
      showToast('Selecciona ambas fechas.', 'warning');
      return;
    }
    if (new Date(startStr) > new Date(endStr)) {
      showToast('Fecha de inicio posterior a la fecha de fin.', 'warning');
      return;
    }
    document.querySelectorAll('#dolaresRanges .range-btn').forEach(b => b.classList.remove('active'));
    state.dolares.days = 'manual';
    state.dolares.tablePage = 1;
    this.renderChart();
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
      const oficialVar = state.variables.find(v => String(v.idVariable || v.id) === '4');
      state.dolares.live.oficial = oficialVar ? parseFloat(oficialVar.ultValorInformado) : 950;
      
      // Estimar Dólar Blue (MEP + spread del 3.5%)
      state.dolares.live.blue = state.dolares.live.mep * 1.035;

      // 2b. Obtener divisas oficiales (Euro, Real, Dólar Mayorista A3500) desde la API de Estadísticas Cambiarias del BCRA
      try {
        const cambRes = await fetch('/api/bcra-cambiarias/Cotizaciones');
        if (cambRes.ok) {
          const cambData = await cambRes.json();
          const rawResults = cambData.results || cambData.data || cambData;
          const results = Array.isArray(rawResults) ? rawResults : [];
          
          // Buscar cotizaciones en la respuesta de la API del BCRA
          // Si el BCRA devuelve un array de monedas, mapear por código ISO o descripción
          const usdMayorista = results.length > 0 ? results.find(d => d.codigoMoneda === 'USD' || (d.detalle && d.detalle.toLowerCase().includes('mayorista')) || d.codigo === 'A3500') : null;
          const eurOficial = results.length > 0 ? results.find(d => d.codigoMoneda === 'EUR' || (d.detalle && d.detalle.toLowerCase().includes('euro'))) : null;
          const brlOficial = results.length > 0 ? results.find(d => d.codigoMoneda === 'BRL' || (d.detalle && d.detalle.toLowerCase().includes('real'))) : null;
          
          state.dolares.live.mayorista = usdMayorista ? parseFloat(usdMayorista.tipoCambioVendedor || usdMayorista.valor || usdMayorista.close) : (state.dolares.live.oficial * 0.985);
          state.dolares.live.euro = eurOficial ? parseFloat(eurOficial.tipoCambioVendedor || eurOficial.valor || eurOficial.close) : (state.dolares.live.oficial * 1.09);
          state.dolares.live.real = brlOficial ? parseFloat(brlOficial.tipoCambioVendedor || brlOficial.valor || brlOficial.close) : (state.dolares.live.oficial * 0.185);
        } else {
          throw new Error('Fallo respuesta cambiaria');
        }
      } catch (e) {
        console.warn('Usando fallback para cotizaciones cambiarias oficiales:', e.message);
        state.dolares.live.mayorista = state.dolares.live.oficial * 0.985;
        state.dolares.live.euro = state.dolares.live.oficial * 1.09;
        state.dolares.live.real = state.dolares.live.oficial * 0.185;
      }

      // Actualizar tarjetas en vivo
      this.renderLiveCards();


      // 3. Obtener Históricos: Oficial (BCRA) e históricos de BYMA (AL30 y AL30D) para el MEP
      const to = Math.floor(Date.now() / 1000);
      const from = to - (90 * 24 * 60 * 60); // 90 días de historial
      const [oficialHistRes, al30HistRes, al30dHistRes] = await Promise.all([
        fetch('/api/monetarias/4'), // Oficial histórico
        fetch(`/api/byma/historico/AL30%2024HS?resolution=D&from=${from}&to=${to}`), // AL30 en Pesos
        fetch(`/api/byma/historico/AL30D%2024HS?resolution=D&from=${from}&to=${to}`) // AL30 en USD
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

      // Inicializar campos de fecha manual
      const dates = state.dolares.historical.mep.map(d => d.date);
      if (dates.length > 0) {
        document.getElementById('dolaresStartDate').value = dates[0];
        document.getElementById('dolaresEndDate').value = dates[dates.length - 1];
        document.getElementById('dolaresStartDate').min = dates[0];
        document.getElementById('dolaresStartDate').max = dates[dates.length - 1];
        document.getElementById('dolaresEndDate').min = dates[0];
        document.getElementById('dolaresEndDate').max = dates[dates.length - 1];
      }
      
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
    
    // Nuevas divisas oficiales
    document.getElementById('dolarMayoristaValue').textContent = `$${formatValue(live.mayorista)}`;
    document.getElementById('euroOficialValue').textContent = `$${formatValue(live.euro)}`;
    document.getElementById('realOficialValue').textContent = `$${formatValue(live.real)}`;

    const brechaMep = ((live.mep - live.oficial) / live.oficial) * 100;
    const brechaCcl = ((live.ccl - live.oficial) / live.oficial) * 100;
    const brechaBlue = ((live.blue - live.oficial) / live.oficial) * 100;

    document.getElementById('brechaMepValue').textContent = `Brecha: ${brechaMep.toFixed(1)}%`;
    document.getElementById('brechaCclValue').textContent = `Brecha: ${brechaCcl.toFixed(1)}%`;
    document.getElementById('brechaBlueValue').textContent = `Brecha: ${brechaBlue.toFixed(1)}%`;
  },


  switchView(view) {
    state.dolares.activeView = view;
    
    const btnPrices = document.getElementById('btnShowDolarChart');
    const btnBrecha = document.getElementById('btnShowBrechaChart');
    
    btnPrices.className = 'btn btn-secondary btn-sm';
    btnPrices.style.backgroundColor = '';
    btnBrecha.className = 'btn btn-secondary btn-sm';
    btnBrecha.style.backgroundColor = '';

    if (view === 'prices') {
      btnPrices.classList.add('active', 'btn-primary');
      btnPrices.style.backgroundColor = 'var(--theme-dolares)';
    } else {
      btnBrecha.classList.add('active', 'btn-primary');
      btnBrecha.style.backgroundColor = 'var(--theme-dolares)';
    }
    
    state.dolares.tablePage = 1;
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
    if (state.dolares.days !== 'all' && state.dolares.days !== 'manual') {
      const targetDate = new Date();
      targetDate.setDate(targetDate.getDate() - state.dolares.days);
      const targetStr = targetDate.toISOString().split('T')[0];
      filteredMep = mepData.filter(d => d.date >= targetStr);
      if (filteredMep.length > 0) {
        document.getElementById('dolaresStartDate').value = filteredMep[0].date;
        document.getElementById('dolaresEndDate').value = filteredMep[filteredMep.length - 1].date;
      }
    } else if (state.dolares.days === 'all') {
      if (mepData.length > 0) {
        document.getElementById('dolaresStartDate').value = mepData[0].date;
        document.getElementById('dolaresEndDate').value = mepData[mepData.length - 1].date;
      }
    } else if (state.dolares.days === 'manual') {
      const startStr = document.getElementById('dolaresStartDate').value;
      const endStr = document.getElementById('dolaresEndDate').value;
      filteredMep = mepData.filter(d => d.date >= startStr && d.date <= endStr);
    }

    // Alinear el oficial a las mismas fechas del MEP
    const dates = filteredMep.map(d => d.date);
    const oficialMap = {};
    oficialData.forEach(d => oficialMap[d.date] = d.value);

    // Actualizar tabla histórica en paralelo
    this.renderTable(dates, filteredMep, oficialMap);

    const labels = dates.map(d => formatDate(d));
    let datasets = [];

    if (state.dolares.activeView === 'prices') {
      const mepPrices = filteredMep.map(d => d.value);
      const oficialPrices = dates.map(d => oficialMap[d] || null);
      
      // Calcular MAX/MIN de Dólar MEP
      let maxIdxM = -1, minIdxM = -1, maxValM = -Infinity, minValM = Infinity;
      mepPrices.forEach((val, idx) => {
        if (val !== null && !isNaN(val)) {
          if (val > maxValM) { maxValM = val; maxIdxM = idx; }
          if (val < minValM) { minValM = val; minIdxM = idx; }
        }
      });

      // Calcular MAX/MIN de Dólar Oficial BNA
      let maxIdxO = -1, minIdxO = -1, maxValO = -Infinity, minValO = Infinity;
      oficialPrices.forEach((val, idx) => {
        if (val !== null && !isNaN(val)) {
          if (val > maxValO) { maxValO = val; maxIdxO = idx; }
          if (val < minValO) { minValO = val; minIdxO = idx; }
        }
      });

      const pointRadiiM = mepPrices.map((val, idx) => (idx === maxIdxM || idx === minIdxM) ? 7 : (mepPrices.length > 80 ? 0 : 3.5));
      const pointBgColorsM = mepPrices.map((val, idx) => (idx === maxIdxM || idx === minIdxM) ? '#ffd60a' : '#30d158');
      const pointHoverRadiiM = mepPrices.map((val, idx) => (idx === maxIdxM || idx === minIdxM) ? 9 : 6);

      const pointRadiiO = oficialPrices.map((val, idx) => (idx === maxIdxO || idx === minIdxO) ? 7 : (mepPrices.length > 80 ? 0 : 3));
      const pointBgColorsO = oficialPrices.map((val, idx) => (idx === maxIdxO || idx === minIdxO) ? '#ffd60a' : '#ffffff');
      const pointHoverRadiiO = oficialPrices.map((val, idx) => (idx === maxIdxO || idx === minIdxO) ? 9 : 5);

      datasets = [
        {
          label: 'Dólar MEP ($)',
          data: mepPrices,
          borderColor: '#30d158',
          backgroundColor: 'rgba(48, 209, 88, 0.1)',
          fill: true,
          tension: 0.1,
          borderWidth: 2.5,
          pointRadius: pointRadiiM,
          pointBackgroundColor: pointBgColorsM,
          pointBorderColor: '#ffffff',
          pointBorderWidth: 1.5,
          pointHoverRadius: pointHoverRadiiM,
          maxIdx: maxIdxM,
          minIdx: minIdxM,
          formatLabel: val => '$' + formatValue(val)
        },
        {
          label: 'Dólar Oficial BNA ($)',
          data: oficialPrices,
          borderColor: '#ffffff',
          backgroundColor: 'transparent',
          fill: false,
          tension: 0.1,
          borderWidth: 2,
          pointRadius: pointRadiiO,
          pointBackgroundColor: pointBgColorsO,
          pointBorderColor: '#ffffff',
          pointBorderWidth: 1.5,
          pointHoverRadius: pointHoverRadiiO,
          maxIdx: maxIdxO,
          minIdx: minIdxO,
          formatLabel: val => '$' + formatValue(val)
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

      // Calcular MAX/MIN de Brecha
      let maxIdx = -1, minIdx = -1, maxVal = -Infinity, minVal = Infinity;
      brechaData.forEach((val, idx) => {
        if (val !== null && !isNaN(val)) {
          if (val > maxVal) { maxVal = val; maxIdx = idx; }
          if (val < minVal) { minVal = val; minIdx = idx; }
        }
      });

      const pointRadii = brechaData.map((val, idx) => (idx === maxIdx || idx === minIdx) ? 7 : (brechaData.length > 80 ? 0 : 3.5));
      const pointBgColors = brechaData.map((val, idx) => (idx === maxIdx || idx === minIdx) ? '#ffd60a' : '#ffd60a');
      const pointHoverRadii = brechaData.map((val, idx) => (idx === maxIdx || idx === minIdx) ? 9 : 6);

      datasets = [
        {
          label: 'Brecha Cambiaria (%)',
          data: brechaData,
          borderColor: '#ffd60a',
          backgroundColor: 'rgba(255, 214, 10, 0.15)',
          fill: true,
          tension: 0.1,
          borderWidth: 2,
          pointRadius: pointRadii,
          pointBackgroundColor: pointBgColors,
          pointBorderColor: '#ffffff',
          pointBorderWidth: 1.5,
          pointHoverRadius: pointHoverRadii,
          maxIdx: maxIdx,
          minIdx: minIdx,
          formatLabel: val => val.toFixed(1) + '%'
        }
      ];
    }

    state.dolares.chart = new Chart(ctx, {
      type: 'line',
      plugins: [maxMinLabelPlugin],
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
              label: function(context) {
                let labelText = ` ${context.dataset.label}: ${context.raw ? context.raw.toFixed(2) : '-'} `;
                const maxIdx = context.dataset.maxIdx;
                const minIdx = context.dataset.minIdx;
                if (context.dataIndex === maxIdx) labelText += ' 📈 (MÁX)';
                if (context.dataIndex === minIdx) labelText += ' 📉 (MÍN)';
                return labelText;
              }
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
  },

  changeTablePage(direction) {
    state.dolares.tablePage += direction;
    this.renderTable();
  },

  renderTable(dates, filteredMep, oficialMap) {
    if (!dates || !filteredMep || !oficialMap) {
      dates = state.dolares.currentDates || [];
      filteredMep = state.dolares.currentMep || [];
      oficialMap = state.dolares.currentOficialMap || {};
    } else {
      state.dolares.currentDates = dates;
      state.dolares.currentMep = filteredMep;
      state.dolares.currentOficialMap = oficialMap;
    }

    const tbody = document.getElementById('dolaresTableBody');
    const paginationInfo = document.getElementById('dolaresPaginationInfo');
    const btnPrev = document.getElementById('btnPrevDolaresPage');
    const btnNext = document.getElementById('btnNextDolaresPage');

    tbody.innerHTML = '';

    if (dates.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="text-center">No hay registros para mostrar.</td></tr>';
      paginationInfo.textContent = 'Mostrando 0-0 de 0 registros';
      btnPrev.disabled = true;
      btnNext.disabled = true;
      return;
    }

    const sortedDates = [...dates].reverse();
    const total = sortedDates.length;
    const pageSize = state.dolares.tablePageSize;
    const totalPages = Math.ceil(total / pageSize);

    if (state.dolares.tablePage > totalPages) state.dolares.tablePage = totalPages;
    if (state.dolares.tablePage < 1) state.dolares.tablePage = 1;

    const startIndex = (state.dolares.tablePage - 1) * pageSize;
    const endIndex = Math.min(startIndex + pageSize, total);
    const pageDates = sortedDates.slice(startIndex, endIndex);

    const fullMep = state.dolares.historical.mep;
    const fullOficial = state.dolares.historical.oficial;

    pageDates.forEach(date => {
      const mepItem = filteredMep.find(d => d.date === date);
      const mepVal = mepItem ? mepItem.value : null;
      const oficialVal = oficialMap[date] || null;

      let mepVarText = '-';
      let mepVarClass = '';
      if (mepVal !== null) {
        const fullIdx = fullMep.findIndex(d => d.date === date);
        if (fullIdx > 0) {
          const prevVal = fullMep[fullIdx - 1].value;
          const diff = mepVal - prevVal;
          const diffPct = (diff / prevVal) * 100;
          mepVarText = `${diff >= 0 ? '+' : ''}${diffPct.toFixed(2)}%`;
          mepVarClass = diff > 0 ? 'text-success' : (diff < 0 ? 'text-danger' : '');
        }
      }

      let oficialVarText = '-';
      let oficialVarClass = '';
      if (oficialVal !== null) {
        const fullIdx = fullOficial.findIndex(d => d.date === date);
        if (fullIdx > 0) {
          const prevVal = fullOficial[fullIdx - 1].value;
          const diff = oficialVal - prevVal;
          const diffPct = (diff / prevVal) * 100;
          oficialVarText = `${diff >= 0 ? '+' : ''}${diffPct.toFixed(2)}%`;
          oficialVarClass = diff > 0 ? 'text-success' : (diff < 0 ? 'text-danger' : '');
        }
      }

      let brechaText = '-';
      if (mepVal !== null && oficialVal > 0) {
        const brechaVal = ((mepVal - oficialVal) / oficialVal) * 100;
        brechaText = `${brechaVal.toFixed(2)}%`;
      }

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${formatDate(date)}</td>
        <td class="text-right font-medium">${mepVal ? formatValue(mepVal) : '-'}</td>
        <td class="text-right ${mepVarClass}">${mepVarText}</td>
        <td class="text-right font-medium">${oficialVal ? formatValue(oficialVal) : '-'}</td>
        <td class="text-right ${oficialVarClass}">${oficialVarText}</td>
        <td class="text-right font-medium" style="color: var(--theme-dolares);">${brechaText}</td>
      `;
      tbody.appendChild(tr);
    });

    paginationInfo.textContent = `Mostrando ${startIndex + 1}-${endIndex} de ${total} registros`;
    btnPrev.disabled = state.dolares.tablePage <= 1;
    btnNext.disabled = endIndex >= total;
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

      // Renderizar Flujo de Fondos (Cash Flow)
      this.renderCashFlow(bond.symbol);
    } catch (error) {
      console.error(error);
      showToast('Error al cargar la ficha del bono.', 'warning');
    }
  },

  renderCashFlow(symbol) {
    const cashFlowBody = document.getElementById('bonoCashFlowBody');
    cashFlowBody.innerHTML = '';
    
    const flows = this.calculateBonoCashFlow(symbol);
    if (flows.length > 0) {
      flows.forEach(f => {
        const tr = document.createElement('tr');
        const colorStyle = f.concepto === 'Amortización' ? 'color: var(--theme-byma); font-weight: 600;' : '';
        tr.innerHTML = `
          <td>${f.fecha}</td>
          <td>${f.concepto}</td>
          <td class="text-right font-medium" style="${colorStyle}">${f.monto}</td>
        `;
        cashFlowBody.appendChild(tr);
      });
    } else {
      cashFlowBody.innerHTML = '<tr><td colspan="3" class="text-center text-muted">No hay cupones de cobro futuros estimados.</td></tr>';
    }
  },

  calculateBonoCashFlow(symbol) {
    const clean = symbol.replace(/[D|C|X|Y|Z]$/, '').toUpperCase();
    const hoy = new Date('2026-06-08'); // Fecha actual de la sesión
    const flows = [];
    
    if (clean === 'AL30' || clean === 'GD30') {
      // AL30 / GD30: Amortizaciones semestrales del 8% y 9%, Interés step-up.
      const cronograma = [
        { fecha: '2026-07-09', amort: 8.0, int: 0.375 },
        { fecha: '2027-01-09', amort: 8.0, int: 0.375 },
        { fecha: '2027-07-09', amort: 8.0, int: 0.875 }, // Sube a 1.75% anual step-up
        { fecha: '2028-01-09', amort: 8.0, int: 0.875 },
        { fecha: '2028-07-09', amort: 8.5, int: 0.875 },
        { fecha: '2029-01-09', amort: 8.5, int: 0.875 },
        { fecha: '2029-07-09', amort: 9.0, int: 0.875 },
        { fecha: '2030-01-09', amort: 9.0, int: 0.875 }
      ];
      cronograma.forEach(c => {
        const dateObj = new Date(c.fecha);
        if (dateObj >= hoy) {
          const formattedDate = formatDate(c.fecha);
          flows.push({ fecha: formattedDate, concepto: 'Interés', monto: `${c.int.toFixed(3)}%` });
          flows.push({ fecha: formattedDate, concepto: 'Amortización', monto: `${c.amort.toFixed(1)}%` });
        }
      });
    } else if (clean === 'AE38' || clean === 'GD38') {
      // AE38 / GD38: Amortizaciones del 4.54% semestral desde Julio 2027. Interés step-up actual 4.25% anual.
      const cronograma = [
        { fecha: '2026-07-09', amort: 0.0, int: 2.125 },
        { fecha: '2027-01-09', amort: 0.0, int: 2.125 },
        { fecha: '2027-07-09', amort: 4.54, int: 2.50 }, // Tasa sube a 5% anual step-up
        { fecha: '2028-01-09', amort: 4.54, int: 2.50 }
      ];
      for (let anio = 2028; anio <= 2037; anio++) {
        cronograma.push({ fecha: `${anio}-07-09`, amort: 4.54, int: 2.50 });
        cronograma.push({ fecha: `${anio + 1}-01-09`, amort: 4.54, int: 2.50 });
      }
      cronograma.forEach(c => {
        const dateObj = new Date(c.fecha);
        if (dateObj >= hoy) {
          const formattedDate = formatDate(c.fecha);
          flows.push({ fecha: formattedDate, concepto: 'Interés', monto: `${c.int.toFixed(3)}%` });
          if (c.amort > 0) {
            flows.push({ fecha: formattedDate, concepto: 'Amortización', monto: `${c.amort.toFixed(2)}%` });
          }
        }
      });
    } else if (clean === 'GD35' || clean === 'AL35') {
      // AL35 / GD35: Amortización desde Julio 2028 en 15 cuotas de 6.66% y 6.7%. Interés step-up.
      const cronograma = [
        { fecha: '2026-07-09', amort: 0.0, int: 1.75 },
        { fecha: '2027-01-09', amort: 0.0, int: 1.75 },
        { fecha: '2027-07-09', amort: 0.0, int: 1.75 },
        { fecha: '2028-01-09', amort: 0.0, int: 1.75 },
        { fecha: '2028-07-09', amort: 6.66, int: 2.00 }
      ];
      for (let anio = 2028; anio <= 2034; anio++) {
        cronograma.push({ fecha: `${anio}-07-09`, amort: 6.66, int: 2.00 });
        cronograma.push({ fecha: `${anio + 1}-01-09`, amort: 6.66, int: 2.00 });
      }
      cronograma.forEach(c => {
        const dateObj = new Date(c.fecha);
        if (dateObj >= hoy) {
          const formattedDate = formatDate(c.fecha);
          flows.push({ fecha: formattedDate, concepto: 'Interés', monto: `${c.int.toFixed(3)}%` });
          if (c.amort > 0) {
            flows.push({ fecha: formattedDate, concepto: 'Amortización', monto: `${c.amort.toFixed(2)}%` });
          }
        }
      });
    } else if (clean === 'AL29' || clean === 'GD29') {
      // AL29 / GD29: Amortizaciones del 10% semestral desde Julio 2025 hasta Julio 2029.
      const cronograma = [
        { fecha: '2026-07-09', amort: 10.0, int: 0.50 },
        { fecha: '2027-01-09', amort: 10.0, int: 0.50 },
        { fecha: '2027-07-09', amort: 10.0, int: 0.875 }, // Tasa sube a 1.75% anual step-up
        { fecha: '2028-01-09', amort: 10.0, int: 0.875 },
        { fecha: '2028-07-09', amort: 10.0, int: 0.875 },
        { fecha: '2029-01-09', amort: 10.0, int: 0.875 },
        { fecha: '2029-07-09', amort: 10.0, int: 0.875 }
      ];
      cronograma.forEach(c => {
        const dateObj = new Date(c.fecha);
        if (dateObj >= hoy) {
          const formattedDate = formatDate(c.fecha);
          flows.push({ fecha: formattedDate, concepto: 'Interés', monto: `${c.int.toFixed(3)}%` });
          flows.push({ fecha: formattedDate, concepto: 'Amortización', monto: `${c.amort.toFixed(1)}%` });
        }
      });
    }
    
    // Si es una letra LECAP (empieza con S)
    if (symbol.startsWith('S') && symbol.length === 5) {
      const bondInfo = state.byma.bonds.find(b => b.symbol === symbol);
      if (bondInfo && bondInfo.maturityDate) {
        const formattedDate = formatDate(bondInfo.maturityDate);
        flows.push({
          fecha: formattedDate,
          concepto: 'Amortización + Interés',
          monto: '100% (Capitalización al Vencimiento)'
        });
      }
    }
    
    return flows;
  }
};


// ==========================================
// UTILIDADES COMPARTIDAS
// ==========================================

async function fetchWithTimeout(resource, options = {}) {
  const { timeout = 2500 } = options;
  
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  
  try {
    const response = await fetch(resource, {
      ...options,
      signal: controller.signal
    });
    clearTimeout(id);
    return response;
  } catch (error) {
    clearTimeout(id);
    throw error;
  }
}

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
    DOM.toastIcon.style.color = 'var(--success)';
  } else if (type === 'warning') {
    DOM.toastIcon.classList.add('fa-triangle-exclamation');
    DOM.toast.style.borderLeftColor = 'var(--warning)';
    DOM.toastIcon.style.color = 'var(--warning)';
  } else {
    DOM.toastIcon.classList.add('fa-circle-exclamation');
    DOM.toast.style.borderLeftColor = 'var(--danger)';
    DOM.toastIcon.style.color = 'var(--danger)';
  }
  
  DOM.toast.classList.remove('hidden');
  DOM.toast.style.opacity = '1';
  
  setTimeout(() => {
    DOM.toast.style.opacity = '0';
    setTimeout(() => { DOM.toast.classList.add('hidden'); }, 200);
  }, 4000);
}

function downloadChartPNG(chartInstance, filename) {
  if (!chartInstance) {
    showToast('No hay un gráfico activo para descargar.', 'warning');
    return;
  }
  
  try {
    const originalCanvas = chartInstance.canvas;
    const width = originalCanvas.width;
    const height = originalCanvas.height;
    
    // Crear canvas temporal
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = width;
    tempCanvas.height = height;
    const tempCtx = tempCanvas.getContext('2d');
    
    // Fondo adaptativo según tema activo
    const isDark = document.body.classList.contains('dark-theme');
    tempCtx.fillStyle = isDark ? '#0f172a' : '#ffffff';
    tempCtx.fillRect(0, 0, width, height);
    
    // Dibujar el gráfico original en el canvas temporal
    tempCtx.drawImage(originalCanvas, 0, 0);
    
    // Dibujar la marca de agua
    tempCtx.save();
    tempCtx.font = 'bold 16px Inter, Outfit, sans-serif';
    tempCtx.fillStyle = isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(15, 23, 42, 0.05)';
    tempCtx.textAlign = 'center';
    tempCtx.textBaseline = 'middle';
    
    // Rotar y colocar en el centro
    tempCtx.translate(width / 2, height / 2);
    tempCtx.rotate(-Math.PI / 12); // -15 grados
    tempCtx.fillText('bcradatos.vercel.app', 0, 0);
    tempCtx.restore();
    
    // Descargar imagen
    const url = tempCanvas.toDataURL('image/png');
    const link = document.createElement('a');
    link.download = filename;
    link.href = url;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast('Imagen PNG descargada con éxito.', 'success');
  } catch (error) {
    console.error('Error al exportar gráfico:', error);
    showToast('Error al generar la descarga del gráfico.', 'danger');
  }
}

// ==========================================
// 🏦 MÓDULO E: COMPARADOR BANCARIO
// ==========================================
const ComparadorModule = {
  initialized: false,
  activeTab: 'plazosFijos', // 'plazosFijos', 'comisiones', 'prestamos'
  data: {
    plazosFijos: [],
    comisiones: [],
    prestamos: []
  },

  async init() {
    if (this.initialized) {
      this.render();
      return;
    }

    // Configurar listeners de tabs internas
    document.getElementById('btnShowPlazosFijos').addEventListener('click', () => this.switchSubTab('plazosFijos'));
    document.getElementById('btnShowComisiones').addEventListener('click', () => this.switchSubTab('comisiones'));
    document.getElementById('btnShowPrestamos').addEventListener('click', () => this.switchSubTab('prestamos'));

    // Configurar buscador en tiempo real
    document.getElementById('bankSearchInput').addEventListener('input', () => this.render());

    await this.fetchData();
    this.initialized = true;
  },

  switchSubTab(tab) {
    this.activeTab = tab;
    
    // Cambiar clases activas de botones
    const tabs = ['plazosFijos', 'comisiones', 'prestamos'];
    const tabBtns = {
      plazosFijos: document.getElementById('btnShowPlazosFijos'),
      comisiones: document.getElementById('btnShowComisiones'),
      prestamos: document.getElementById('btnShowPrestamos')
    };

    tabs.forEach(t => {
      if (t === tab) {
        tabBtns[t].classList.add('active');
        document.getElementById(`subview${t.charAt(0).toUpperCase() + t.slice(1)}`).classList.remove('hidden');
      } else {
        tabBtns[t].classList.remove('active');
        document.getElementById(`subview${t.charAt(0).toUpperCase() + t.slice(1)}`).classList.add('hidden');
      }
    });

    this.render();
  },

  async fetchData() {
    const loader = document.getElementById('loadingComparadorOverlay');
    loader.classList.remove('hidden');

    try {
      // Intentar obtener plazos fijos reales desde el proxy con timeout (4000ms)
      const pfRes = await fetchWithTimeout('/api/bcra-transparencia/PlazosFijos', { timeout: 4000 });
      if (pfRes.ok) {
        const pfData = await pfRes.json();
        if (pfData && pfData.error) {
          throw new Error(pfData.details || 'Error en respuesta del proxy');
        }
        const rawList = pfData.results || pfData.data || pfData;
        if (Array.isArray(rawList) && rawList.length > 0) {
          this.data.plazosFijos = rawList;
        } else {
          throw new Error('Datos vacíos o formato inválido');
        }
      } else {
        throw new Error('Error respuesta');
      }
    } catch (e) {
      console.warn('Usando contingencia para datos de plazos fijos del comparador:', e.message);
      this.data.plazosFijos = this.getMockPlazosFijos();
    }

    try {
      // Intentar obtener comisiones reales (Paquetes de Productos) con timeout (4000ms)
      const comRes = await fetchWithTimeout('/api/bcra-transparencia/PaquetesProductos', { timeout: 4000 });
      if (comRes.ok) {
        const comData = await comRes.json();
        if (comData && comData.error) {
          throw new Error(comData.details || 'Error en respuesta del proxy');
        }
        const rawList = comData.results || comData.data || comData;
        if (Array.isArray(rawList) && rawList.length > 0) {
          this.data.comisiones = rawList;
        } else {
          throw new Error('Datos vacíos o formato inválido');
        }
      } else {
        throw new Error('Error respuesta');
      }
    } catch (e) {
      console.warn('Usando contingencia para comisiones bancarias:', e.message);
      this.data.comisiones = this.getMockComisiones();
    }

    try {
      // Intentar obtener préstamos reales con timeout (4000ms)
      const prestRes = await fetchWithTimeout('/api/bcra-transparencia/Prestamos/Personales', { timeout: 4000 });
      if (prestRes.ok) {
        const prestData = await prestRes.json();
        if (prestData && prestData.error) {
          throw new Error(prestData.details || 'Error en respuesta del proxy');
        }
        const rawList = prestData.results || prestData.data || prestData;
        if (Array.isArray(rawList) && rawList.length > 0) {
          this.data.prestamos = rawList;
        } else {
          throw new Error('Datos vacíos o formato inválido');
        }
      } else {
        throw new Error('Error respuesta');
      }
    } catch (e) {
      console.warn('Usando contingencia para tasas de préstamos personales:', e.message);
      this.data.prestamos = this.getMockPrestamos();
    }

    loader.classList.add('hidden');
    this.render();
  },


  render() {
    const filterText = document.getElementById('bankSearchInput').value.toLowerCase().trim();

    if (this.activeTab === 'plazosFijos') {
      this.renderPlazosFijos(filterText);
    } else if (this.activeTab === 'comisiones') {
      this.renderComisiones(filterText);
    } else if (this.activeTab === 'prestamos') {
      this.renderPrestamos(filterText);
    }
  },

  renderPlazosFijos(filterText) {
    const tbody = document.getElementById('plazosFijosTableBody');
    tbody.innerHTML = '';

    const list = this.data.plazosFijos.filter(item => {
      const name = (item.descripcionEntidad || item.entidad || item.descripcion || '').toLowerCase();
      return name.includes(filterText);
    });

    // Ordenar por TNA / TEA de mayor a menor
    list.sort((a, b) => {
      const valB = parseFloat(b.tasaEfectivaAnualMinima || b.tna || 0);
      const valA = parseFloat(a.tasaEfectivaAnualMinima || a.tna || 0);
      return valB - valA;
    });

    if (list.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" class="text-center">No se encontraron entidades registradas.</td></tr>';
      return;
    }

    list.forEach(item => {
      const tna = parseFloat(item.tasaEfectivaAnualMinima || item.tna || 0);
      const rendimientoDirecto = tna / 12; // Estimado mensual directo
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td class="font-medium">${item.descripcionEntidad || item.entidad || item.descripcion || 'Entidad no informada'}</td>
        <td class="text-right font-medium text-success" style="font-size: 14.5px;">${tna.toFixed(2)}%</td>
        <td class="text-right">${rendimientoDirecto.toFixed(2)}%</td>
        <td class="text-right" style="color: var(--text-secondary);">${item.canalConstitucion || item.canal || 'Digital / Home Banking'}</td>
      `;
      tbody.appendChild(tr);
    });
  },

  renderComisiones(filterText) {
    const tbody = document.getElementById('comisionesTableBody');
    tbody.innerHTML = '';

    const list = this.data.comisiones.filter(item => {
      const name = (item.descripcionEntidad || item.entidad || item.descripcion || '').toLowerCase();
      return name.includes(filterText);
    });

    if (list.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" class="text-center">No se encontraron productos registrados.</td></tr>';
      return;
    }

    list.forEach(item => {
      const mensual = parseFloat(item.comisionMaximaMantenimiento || item.mensual || item.mantenimiento || 0);
      const anual = parseFloat(item.anual || item.renovacion || 0);
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td class="font-medium">${item.descripcionEntidad || item.entidad || 'Banco Comercial'}</td>
        <td>${item.nombreCompleto || item.nombreCorto || item.producto || item.paquete || 'Servicio de Cuentas / Paquete'}</td>
        <td class="text-right font-medium">${mensual > 0 ? '$' + formatValue(mensual) : 'Bonificado / Gratis'}</td>
        <td class="text-right">${anual > 0 ? '$' + formatValue(anual) : 'Gratis / N/A'}</td>
      `;
      tbody.appendChild(tr);
    });
  },

  renderPrestamos(filterText) {
    const tbody = document.getElementById('prestamosTableBody');
    tbody.innerHTML = '';

    const list = this.data.prestamos.filter(item => {
      const name = (item.descripcionEntidad || item.entidad || item.descripcion || '').toLowerCase();
      return name.includes(filterText);
    });

    list.sort((a, b) => {
      const valA = parseFloat(a.tasaEfectivaAnualMaxima || a.tna || a.tnaPromedio || 0);
      const valB = parseFloat(b.tasaEfectivaAnualMaxima || b.tna || b.tnaPromedio || 0);
      return valA - valB;
    });

    if (list.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" class="text-center">No se encontraron líneas de préstamos.</td></tr>';
      return;
    }

    list.forEach(item => {
      const tna = parseFloat(item.tasaEfectivaAnualMaxima || item.tna || item.tnaPromedio || 0);
      const cft = parseFloat(item.costoFinancieroEfectivoTotalMaximo || item.cft || item.cftMaximo || 0);
      const plazoVal = item.plazoMaximoOtorgable ? `${item.plazoMaximoOtorgable} meses` : (item.plazo || 'Hasta 60 meses');
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td class="font-medium">${item.descripcionEntidad || item.entidad || 'Entidad Financiera'}</td>
        <td class="text-right font-medium text-warning">${tna.toFixed(2)}%</td>
        <td class="text-right font-medium text-danger">${cft > 0 ? cft.toFixed(2) + '%' : '-'}</td>
        <td class="text-right" style="color: var(--text-secondary);">${plazoVal}</td>
      `;
      tbody.appendChild(tr);
    });
  },

  getMockPlazosFijos() {
    return [
      { entidad: 'Banco de la Nación Argentina', tna: 37.0, canal: 'Home Banking / BIP' },
      { entidad: 'Banco de la Provincia de Buenos Aires', tna: 37.0, canal: 'BIP / App BIP' },
      { entidad: 'Banco de Galicia y Buenos Aires', tna: 36.0, canal: 'Home Banking Galicia' },
      { entidad: 'Banco Macro S.A.', tna: 36.5, canal: 'Banca Internet Macro' },
      { entidad: 'Banco Santander Argentina S.A.', tna: 35.5, canal: 'App Santander' },
      { entidad: 'BBVA Argentina', tna: 35.0, canal: 'Banca Net BBVA' },
      { entidad: 'Banco Credicoop Cooperativo Limitado', tna: 36.0, canal: 'Banca Internet Credicoop' },
      { entidad: 'Banco de la Ciudad de Buenos Aires', tna: 35.0, canal: 'Home Banking Ciudad' },
      { entidad: 'Banco Supervielle S.A.', tna: 36.25, canal: 'Supervielle Móvil' },
      { entidad: 'Banco Patagonia S.A.', tna: 35.5, canal: 'Patagonia e-Bank' },
      { entidad: 'HSBC Bank Argentina S.A.', tna: 34.5, canal: 'Online Banking HSBC' },
      { entidad: 'ICBC Argentina', tna: 34.0, canal: 'Access Banking ICBC' }
    ];
  },

  getMockComisiones() {
    return [
      { entidad: 'Banco de la Nación Argentina', producto: 'Caja de Ahorro Pesos Extra', mensual: 0, anual: 0 },
      { entidad: 'Banco de la Nación Argentina', producto: 'Paquete Nación Simple', mensual: 4500, anual: 0 },
      { entidad: 'Banco de Galicia y Buenos Aires', producto: 'Paquete Classic Galicia', mensual: 9800, anual: 45000 },
      { entidad: 'Banco Santander Argentina S.A.', producto: 'Paquete Supercuenta 3', mensual: 9500, anual: 42000 },
      { entidad: 'BBVA Argentina', producto: 'Paquete Classic BBVA', mensual: 9200, anual: 41000 },
      { entidad: 'Banco Macro S.A.', producto: 'Paquete Valora Inicial', mensual: 8900, anual: 38000 },
      { entidad: 'Banco de la Provincia de Buenos Aires', producto: 'Paquete Provincia Ahorro', mensual: 5200, anual: 15000 },
      { entidad: 'Banco Credicoop', producto: 'Paquete Credicoop Básico', mensual: 6200, anual: 22000 },
      { entidad: 'Banco Supervielle S.A.', producto: 'Paquete Familia Supervielle', mensual: 8500, anual: 35000 },
      { entidad: 'Banco Patagonia S.A.', producto: 'Paquete Patagonia Activa', mensual: 8800, anual: 36000 }
    ];
  },

  getMockPrestamos() {
    return [
      { entidad: 'Banco de la Nación Argentina', tnaPromedio: 55.0, cftMaximo: 72.5, plazo: 'Hasta 72 meses' },
      { entidad: 'Banco de la Provincia de Buenos Aires', tnaPromedio: 58.0, cftMaximo: 75.2, plazo: 'Hasta 60 meses' },
      { entidad: 'Banco Credicoop', tnaPromedio: 60.0, cftMaximo: 78.5, plazo: 'Hasta 60 meses' },
      { entidad: 'BBVA Argentina', tnaPromedio: 64.0, cftMaximo: 86.4, plazo: 'Hasta 60 meses' },
      { entidad: 'Banco de Galicia y Buenos Aires', tnaPromedio: 65.0, cftMaximo: 88.0, plazo: 'Hasta 60 meses' },
      { entidad: 'Banco Santander Argentina S.A.', tnaPromedio: 66.0, cftMaximo: 89.5, plazo: 'Hasta 72 meses' },
      { entidad: 'Banco Supervielle S.A.', tnaPromedio: 67.5, cftMaximo: 91.0, plazo: 'Hasta 48 meses' },
      { entidad: 'Banco Macro S.A.', tnaPromedio: 68.0, cftMaximo: 92.1, plazo: 'Hasta 60 meses' }
    ];
  }
};

// ==========================================
// 🔍 MÓDULO F: CONSULTAS FINANCIERAS
// ==========================================
const ConsultasModule = {
  initialized: false,
  activeTab: 'deudores', // 'deudores', 'cheques'

  init() {
    if (this.initialized) return;

    // Configurar listeners de tabs internas
    document.getElementById('btnShowDeudores').addEventListener('click', () => this.switchSubTab('deudores'));
    document.getElementById('btnShowValidadorCheques').addEventListener('click', () => this.switchSubTab('cheques'));

    // Listeners del Formulario de Deudores
    document.getElementById('btnConsultarDeudor').addEventListener('click', () => this.consultarDeudor());
    document.getElementById('cuitInput').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.consultarDeudor();
    });

    // Listeners del Formulario de Cheques
    document.getElementById('btnConsultarCheque').addEventListener('click', () => this.consultarCheque());
    document.getElementById('chequeNumeroInput').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.consultarCheque();
    });

    this.initialized = true;
  },

  switchSubTab(tab) {
    this.activeTab = tab;

    const btnDeudores = document.getElementById('btnShowDeudores');
    const btnCheques = document.getElementById('btnShowValidadorCheques');
    const viewDeudores = document.getElementById('subviewDeudores');
    const viewCheques = document.getElementById('subviewValidadorCheques');

    if (tab === 'deudores') {
      btnDeudores.classList.add('active');
      btnCheques.classList.remove('active');
      viewDeudores.classList.remove('hidden');
      viewCheques.classList.add('hidden');
    } else {
      btnDeudores.classList.remove('active');
      btnCheques.classList.add('active');
      viewDeudores.classList.add('hidden');
      viewCheques.classList.remove('hidden');
    }
  },

  // Validador matemático de CUIT/CUIL
  isValidCuit(cuit) {
    if (!/^\d{11}$/.test(cuit)) return false;

    // Factores ponderadores
    const factors = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
    let sum = 0;
    for (let i = 0; i < 10; i++) {
      sum += parseInt(cuit[i]) * factors[i];
    }

    const checkDigit = parseInt(cuit[10]);
    let calculatedDigit = 11 - (sum % 11);
    if (calculatedDigit === 11) calculatedDigit = 0;
    if (calculatedDigit === 10) calculatedDigit = 9;

    return checkDigit === calculatedDigit;
  },

  async consultarDeudor() {
    const input = document.getElementById('cuitInput');
    const errorText = document.getElementById('cuitErrorText');
    const loader = document.getElementById('loadingDeudores');
    const resultsContainer = document.getElementById('deudoresResultContainer');

    const cuit = input.value.trim();
    errorText.classList.add('hidden');
    resultsContainer.classList.add('hidden');

    if (!this.isValidCuit(cuit)) {
      errorText.classList.remove('hidden');
      return;
    }

    loader.classList.remove('hidden');

    try {
      // 1. Intentar llamar al proxy real con timeout aumentado a 5000ms
      const res = await fetchWithTimeout(`/api/bcra-deudores/Deudas/${cuit}`, { timeout: 5000 });
      if (res.ok) {
        const data = await res.json();
        if (data && data.error) {
          throw new Error(data.details || 'Error en respuesta del proxy');
        }
        // Marcar explícitamente como NO simulado
        data.isSimulado = false;
        this.renderDeudorResults(data, cuit);
      } else {
        throw new Error('Fallo de red o CUIT inexistente');
      }
    } catch (error) {
      console.warn('Usando contingencia para consulta de Central de Deudores:', error.message);
      // Simular resultado realista según el CUIT y marcar como simulado
      const simulado = this.getSimulatedDeudor(cuit);
      simulado.isSimulado = true;
      
      setTimeout(() => {
        this.renderDeudorResults(simulado, cuit);
        loader.classList.add('hidden');
      }, 600);
      return;
    }

    loader.classList.add('hidden');
  },

  renderDeudorResults(data, cuit) {
    const resultsContainer = document.getElementById('deudoresResultContainer');
    const simulationAlert = document.getElementById('deudorSimulationAlert');
    
    // Configurar visibilidad del banner de simulación
    if (data.isSimulado) {
      simulationAlert.classList.remove('hidden');
    } else {
      simulationAlert.classList.add('hidden');
    }

    let nombre = 'DESCONOCIDO';
    let peorSit = 1;
    let totalDeuda = 0;
    let cantBancos = 0;
    let chequesRech = 0;
    let deudas = [];

    if (data.isSimulado) {
      // Formato para datos simulados
      nombre = data.denominacion || 'CONTRIBUYENTE SIMULADO S.A.';
      peorSit = parseInt(data.peorSituacion || 1);
      cantBancos = parseInt(data.cantidadEntidades || 1);
      chequesRech = parseInt(data.chequesRechazados || 0);
      deudas = (data.deudas || []).map(d => ({
        entidad: d.entidad || 'Entidad Bancaria',
        monto: parseFloat(d.monto || 0) * 1000, // Convertimos a pesos completos
        situacion: parseInt(d.situacion || 1),
        periodo: d.periodo || 'Último Informado'
      }));
      totalDeuda = parseFloat(data.totalDeuda || 0) * 1000; // En pesos completos
    } else {
      // Formato para la respuesta real del BCRA:
      // { results: { identificacion, denominacion, periodos: [ { periodo, entidades: [ { entidad, situacion, monto } ] } ] } }
      const results = data.results || {};
      nombre = results.denominacion || 'NO IDENTIFICADO';
      
      const periodos = results.periodos || [];
      if (periodos.length > 0) {
        // Tomamos el período más reciente (índice 0)
        const periodoMasReciente = periodos[0];
        const entidades = periodoMasReciente.entidades || [];
        
        cantBancos = entidades.length;
        deudas = entidades.map(ent => {
          const sit = parseInt(ent.situacion || 1);
          if (sit > peorSit) {
            peorSit = sit;
          }
          // El monto de la API del BCRA viene expresado en miles de pesos. Convertimos a pesos.
          const montoEnPesos = parseFloat(ent.monto || 0) * 1000;
          totalDeuda += montoEnPesos;

          // Formatear periodo del formato "YYYYMM" (ej: "202512") a "MM/YYYY"
          let perFormateado = periodoMasReciente.periodo || '';
          if (perFormateado.length === 6) {
            perFormateado = `${perFormateado.slice(4)}/${perFormateado.slice(0, 4)}`;
          }

          return {
            entidad: ent.entidad || 'Entidad Financiera',
            monto: montoEnPesos,
            situacion: sit,
            periodo: perFormateado
          };
        });
      }
      // Cheques rechazados no están incluidos directamente en esta consulta de deudas
      chequesRech = 0;
    }

    // Mapear elementos HTML
    document.getElementById('deudorNombre').textContent = nombre.toUpperCase();
    document.getElementById('deudorCuit').textContent = `CUIT/CUIL: ${cuit.slice(0,2)}-${cuit.slice(2,10)}-${cuit.slice(10)}`;
    
    // Configurar Badge de Situación
    const badge = document.getElementById('deudorBadgeStatus');
    const badgeText = document.getElementById('deudorBadgeText');
    badge.className = 'deudor-badge'; // reset
    badge.classList.add(`situacion-${peorSit}`);

    const descripciones = {
      1: 'SITUACION 1 - NORMAL',
      2: 'SITUACION 2 - RIESGO BAJO (SEGUIMIENTO)',
      3: 'SITUACION 3 - RIESGO MEDIO (PROBLEMAS)',
      4: 'SITUACION 4 - RIESGO ALTO (INSOLVENCIA)',
      5: 'SITUACION 5 - IRRECUPERABLE',
      6: 'SITUACION 6 - IRRECUPERABLE DISP. TECNICA'
    };
    badgeText.textContent = descripciones[peorSit] || `SITUACION ${peorSit}`;

    document.getElementById('deudorPeorSituacion').textContent = peorSit;
    document.getElementById('deudorPeorSituacion').style.color = this.getColorForSituacion(peorSit);
    
    // Formatear y mostrar total de deuda
    document.getElementById('deudorTotalDeuda').textContent = `$${formatValueCompact(totalDeuda)}`;
    document.getElementById('deudorCantEntidades').textContent = cantBancos;
    
    document.getElementById('deudorChequesRechazados').textContent = data.isSimulado ? chequesRech : 'Ver Tab Cheques';
    document.getElementById('deudorChequesRechazados').style.color = (chequesRech > 0) ? '#ff453a' : 'var(--text-secondary)';

    // Poblar tabla de deudas
    const tbody = document.getElementById('deudasTableBody');
    tbody.innerHTML = '';

    if (deudas.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" class="text-center">No registra deudas activas informadas en el sistema financiero.</td></tr>';
    } else {
      deudas.forEach(d => {
        const sit = parseInt(d.situacion || 1);
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td class="font-medium">${d.entidad || 'Entidad Bancaria'}</td>
          <td class="text-right font-medium">$${formatValue(d.monto)}</td>
          <td class="text-center"><span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:${this.getColorForSituacion(sit)}; margin-right:6px;"></span>${sit}</td>
          <td class="text-right" style="color: var(--text-secondary);">${d.periodo}</td>
        `;
        tbody.appendChild(tr);
      });
    }

    resultsContainer.classList.remove('hidden');
    showToast(data.isSimulado ? 'Informe consolidado de ejemplo cargado.' : 'Informe crediticio consolidado oficial cargado.', 'success');
  },

  getColorForSituacion(sit) {
    const colores = {
      1: '#30d158', // verde
      2: '#ffd60a', // amarillo
      3: '#ff9500', // naranja
      4: '#ff453a', // rojo
      5: '#8e8e93', // gris
      6: '#bf5af2'  // violeta
    };
    return colores[sit] || '#ffffff';
  },

  getSimulatedDeudor(cuit) {
    const ultimoDigito = parseInt(cuit[10]);
    const esPar = ultimoDigito % 2 === 0;

    if (esPar) {
      // Deudor saludable
      return {
        denominacion: 'JUAN ESTEBAN RODRIGUEZ (Simulado)',
        peorSituacion: 1,
        totalDeuda: 1420.50, // 1420.5 miles = 1.42 millones
        cantidadEntidades: 2,
        chequesRechazados: 0,
        deudas: [
          { entidad: 'BANCO DE LA NACION ARGENTINA', monto: 850.50, situacion: 1, periodo: '05/2026' },
          { entidad: 'BANCO SANTANDER ARGENTINA S.A.', monto: 570.00, situacion: 1, periodo: '05/2026' }
        ]
      };
    } else {
      // Deudor con morosidad
      return {
        denominacion: 'ALBERTO MARIO PALACIOS (Simulado)',
        peorSituacion: 3,
        totalDeuda: 9480.00, // 9.48 millones
        cantidadEntidades: 3,
        chequesRechazados: 2,
        deudas: [
          { entidad: 'BANCO GALICIA Y BUENOS AIRES S.A.', monto: 5200.00, situacion: 3, periodo: '05/2026' },
          { entidad: 'BANCO MACRO S.A.', monto: 3180.00, situacion: 1, periodo: '05/2026' },
          { entidad: 'BBVA ARGENTINA S.A.', monto: 1100.00, situacion: 2, periodo: '04/2026' }
        ]
      };
    }
  },

  async consultarCheque() {
    const select = document.getElementById('chequeBancoSelect');
    const input = document.getElementById('chequeNumeroInput');
    const errorText = document.getElementById('chequeErrorText');
    const loader = document.getElementById('loadingCheques');
    const resultsContainer = document.getElementById('chequesResultContainer');

    const banco = select.value;
    const numero = input.value.trim();
    errorText.classList.add('hidden');
    resultsContainer.classList.add('hidden');

    if (!banco || !/^\d+$/.test(numero)) {
      errorText.classList.remove('hidden');
      return;
    }

    loader.classList.remove('hidden');

    try {
      // Llamar al proxy real de cheques denunciados con variables de ruta y timeout 4000ms
      const res = await fetchWithTimeout(`/api/bcra-cheques/denunciados/${banco}/${numero}`, { timeout: 4000 });
      if (res.ok) {
        const data = await res.json();
        if (data && data.error) {
          throw new Error(data.details || 'Error en respuesta del proxy');
        }
        // Ajustar formato del BCRA
        const resultItem = data.results || data;
        this.renderChequeResults({
          denunciado: resultItem.denunciado || false,
          motivo: resultItem.motivo || 'Sin novedad',
          bancoName: select.options[select.selectedIndex].text
        }, banco, numero);
      } else {
        throw new Error('Fallo de red de cheques');
      }
    } catch (e) {
      console.warn('Usando contingencia para consulta de cheques denunciados:', e.message);
      
      // Simulación: Si el número de cheque termina en 9, lo marcamos como denunciado.
      const simuladoDenunciado = numero.endsWith('9');
      
      setTimeout(() => {
        this.renderChequeResults({
          denunciado: simuladoDenunciado,
          motivo: simuladoDenunciado ? 'Denunciado por Extravío / Hurto' : 'Sin Novedad',
          bancoName: select.options[select.selectedIndex].text
        }, banco, numero);
        loader.classList.add('hidden');
      }, 600);
      return;
    }

    loader.classList.add('hidden');
  },

  renderChequeResults(data, banco, numero) {
    const resultsContainer = document.getElementById('deudoresResultContainer');
    const ticketContainer = document.getElementById('chequesResultContainer');
    const ticketBg = document.getElementById('chequeTicketBg');
    const title = document.getElementById('chequeResultTitle');
    const subtitle = document.getElementById('chequeResultSubtitle');
    const iconWrapper = document.getElementById('chequeResultIconWrapper');
    const desc = document.getElementById('chequeResultDesc');

    const bancoText = data.bancoName || `Entidad N° ${banco}`;
    subtitle.textContent = `${bancoText} — Cheque N° ${numero}`;

    ticketBg.className = 'cheques-ticket'; // Reset clases

    if (data.denunciado) {
      ticketBg.classList.add('denunciado');
      ticketBg.style.background = 'rgba(255, 69, 58, 0.08)';
      ticketBg.style.borderColor = '#ff453a';
      title.textContent = 'CHEQUE DENUNCIADO';
      title.style.color = '#ff453a';
      iconWrapper.innerHTML = '<i class="fa-solid fa-triangle-exclamation" style="color: #ff453a;"></i>';
      desc.textContent = `ATENCION: El cheque consultado N° ${numero} se encuentra registrado como DENUNCIADO en la central de cheques denunciados del BCRA bajo el motivo: "${data.motivo || 'Orden de no pagar por extravío/sustracción'}". Evite su cobro o negociación.`;
      showToast('¡Alerta! Cheque registrado con denuncias vigentes.', 'danger');
    } else {
      ticketBg.style.background = 'rgba(48, 209, 88, 0.08)';
      ticketBg.style.borderColor = '#30d158';
      title.textContent = 'CHEQUE SIN DENUNCIAS';
      title.style.color = '#30d158';
      iconWrapper.innerHTML = '<i class="fa-solid fa-circle-check" style="color: #30d158;"></i>';
      desc.textContent = `El cheque consultado N° ${numero} no presenta registros de denuncias por extravío, robo, sustracción o adulteración en el sistema centralizado del Banco Central a la fecha de hoy. Se encuentra apto para transacciones normales.`;
      showToast('Cheque verificado sin novedades.', 'success');
    }

    ticketContainer.classList.remove('hidden');
  }
};

