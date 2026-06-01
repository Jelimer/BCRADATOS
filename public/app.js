/**
 * BCRA Estadísticas Monetarias Dashboard Client
 * 
 * Desarrollado con JavaScript puro (ES6) y Chart.js.
 */

// --- ESTADO GLOBAL DE LA APLICACIÓN ---
const state = {
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
};

// --- ELEMENTOS DEL DOM ---
const DOM = {
  // Sidebar
  sidebar: document.getElementById('sidebar'),
  toggleSidebarBtn: document.getElementById('toggleSidebarBtn'),
  closeSidebarBtn: document.getElementById('closeSidebarBtn'),
  variableSearch: document.getElementById('variableSearch'),
  variablesList: document.getElementById('variablesList'),
  loadingVariables: document.getElementById('loadingVariables'),
  errorVariables: document.getElementById('errorVariables'),
  retryVariablesBtn: document.getElementById('retryVariablesBtn'),

  // Tema
  themeToggleBtn: document.getElementById('themeToggleBtn'),

  // Viewport / Contenedores
  dashboardViewport: document.getElementById('dashboardViewport'),
  welcomeScreen: document.getElementById('welcomeScreen'),
  dashboardContent: document.getElementById('dashboardContent'),
  startBtn: document.getElementById('startBtn'),
  loadingDataOverlay: document.getElementById('loadingDataOverlay'),
  loadingDataText: document.getElementById('loadingDataText'),
  selectedVariableNameTitle: document.getElementById('selectedVariableNameTitle'),

  // KPIs
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

  // Controles
  quickRanges: document.getElementById('quickRanges'),
  startDate: document.getElementById('startDate'),
  endDate: document.getElementById('endDate'),
  applyDatesBtn: document.getElementById('applyDatesBtn'),
  exportCsvBtn: document.getElementById('exportCsvBtn'),

  // Tabs e interfaz del gráfico
  btnTabChart: document.getElementById('btnTabChart'),
  btnTabTable: document.getElementById('btnTabTable'),
  chartTypeSelector: document.getElementById('chartTypeSelector'),
  tableBody: document.getElementById('tableBody'),
  paginationInfo: document.getElementById('paginationInfo'),
  prevPageBtn: document.getElementById('prevPageBtn'),
  nextPageBtn: document.getElementById('nextPageBtn'),
  variableDescriptionBody: document.getElementById('variableDescriptionBody'),

  // Toast
  toast: document.getElementById('toast'),
  toastIcon: document.getElementById('toastIcon'),
  toastMessage: document.getElementById('toastMessage')
};

// --- INICIALIZACIÓN ---
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  setupEventListeners();
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
  
  // Si hay un gráfico activo, lo actualizamos para adaptar los colores
  if (state.chart) {
    updateChartTheme();
  }
}

// --- SETUP EVENT LISTENERS ---
function setupEventListeners() {
  // Sidebar Toggles (Móvil)
  DOM.toggleSidebarBtn.addEventListener('click', () => DOM.sidebar.classList.add('active'));
  DOM.closeSidebarBtn.addEventListener('click', () => DOM.sidebar.classList.remove('active'));
  DOM.startBtn.addEventListener('click', () => {
    if (window.innerWidth <= 992) {
      DOM.sidebar.classList.add('active');
    }
  });

  // Tema
  DOM.themeToggleBtn.addEventListener('click', toggleTheme);

  // Buscador de variables
  DOM.variableSearch.addEventListener('input', handleVariableSearch);

  // Reintentar catálogo si falla
  DOM.retryVariablesBtn.addEventListener('click', fetchCatalog);

  // Filtros de fecha rápidos
  DOM.quickRanges.addEventListener('click', handleQuickRangeClick);

  // Filtro de fechas manual
  DOM.applyDatesBtn.addEventListener('click', applyManualDatesFilter);

  // Exportación
  DOM.exportCsvBtn.addEventListener('click', exportToCsv);

  // Selector de estilo de gráfico (Línea / Barra)
  DOM.chartTypeSelector.addEventListener('click', handleChartTypeClick);

  // Tabs (Gráfico / Tabla)
  DOM.btnTabChart.addEventListener('click', () => switchTab('tabChart'));
  DOM.btnTabTable.addEventListener('click', () => switchTab('tabTable'));

  // Paginación de Tabla
  DOM.prevPageBtn.addEventListener('click', () => changeTablePage(-1));
  DOM.nextPageBtn.addEventListener('click', () => changeTablePage(1));

  // Recalcular rendimiento del KPI según el período seleccionado
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

// --- CONSULTAS API (FETCH) ---

// Obtener todas las variables del catálogo
async function fetchCatalog() {
  DOM.loadingVariables.classList.remove('hidden');
  DOM.errorVariables.classList.add('hidden');
  DOM.variablesList.innerHTML = '';

  try {
    const response = await fetch('/api/monetarias');
    if (!response.ok) throw new Error('Respuesta de red incorrecta');
    
    const result = await response.json();
    
    // Validar estructura de respuesta del BCRA v4
    // Habitualmente la respuesta tiene la forma { results: [...] } o es directamente un array
    state.variables = Array.isArray(result) ? result : (result.results || result.data || []);
    state.filteredVariables = [...state.variables];
    
    renderVariablesList();
    showToast('Catálogo de variables cargado con éxito.', 'success');
  } catch (error) {
    console.error('Error cargando variables:', error);
    DOM.errorVariables.classList.remove('hidden');
    showToast('Error al conectar con la API de estadísticas.', 'danger');
  } finally {
    DOM.loadingVariables.classList.add('hidden');
  }
}

// Obtener metodologías técnicas
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

// Obtener datos históricos de la variable seleccionada
async function fetchHistoricalData(idVariable) {
  showDataLoader(true, 'Consultando datos históricos en la API del BCRA...');
  
  try {
    const response = await fetch(`/api/monetarias/${idVariable}`);
    if (!response.ok) throw new Error('Error al obtener datos históricos');
    
    const result = await response.json();
    
    // Extraer array de datos. El detalle histórico del BCRA v4 está dentro de result.results[0].detalle
    let rawData = [];
    if (result && result.results && Array.isArray(result.results)) {
      if (result.results[0] && Array.isArray(result.results[0].detalle)) {
        rawData = result.results[0].detalle;
      } else {
        rawData = result.results;
      }
    } else if (Array.isArray(result)) {
      rawData = result;
    } else {
      rawData = result.data || [];
    }
    
    // Procesar datos, filtrar nulos/inválidos y ordenarlos por fecha ascendente de manera alfabética
    state.historicalData = rawData.map(item => ({
      date: item.fecha, // formato YYYY-MM-DD
      value: parseFloat(item.valor)
    })).filter(item => item.date && !isNaN(item.value))
       .sort((a, b) => a.date.localeCompare(b.date));

    if (state.historicalData.length === 0) {
      showToast('No se encontraron registros históricos para esta variable.', 'warning');
      // Mostrar pantalla de bienvenida
      DOM.welcomeScreen.classList.remove('hidden');
      DOM.dashboardContent.classList.add('hidden');
    } else {
      // Activar dashboard
      DOM.welcomeScreen.classList.add('hidden');
      DOM.dashboardContent.classList.remove('hidden');
      
      // Resetear filtros de fecha a los extremos del dataset
      const dates = state.historicalData.map(d => d.date);
      DOM.startDate.value = dates[0];
      DOM.endDate.value = dates[dates.length - 1];
      
      // Aplicar rango completo inicialmente
      resetQuickRangeButtons();
      document.querySelector('[data-days="all"]').classList.add('active');
      
      state.filteredData = [...state.historicalData];
      
      // Renderizar todo
      updateDashboard();
      showToast('Datos históricos actualizados.', 'success');
    }
  } catch (error) {
    console.error('Error obteniendo historial:', error);
    showToast('Error al descargar los datos históricos de la variable.', 'danger');
  } finally {
    showDataLoader(false);
  }
}

// --- RENDERIZADO Y CONTROL DE COMPONENTES ---

// Renderizar la lista de variables en la barra lateral
function renderVariablesList() {
  DOM.variablesList.innerHTML = '';
  
  if (state.filteredVariables.length === 0) {
    DOM.variablesList.innerHTML = '<li class="no-results">No se encontraron variables.</li>';
    return;
  }
  
  // Separar favoritos y no favoritos
  const favoritesList = state.filteredVariables.filter(v => {
    const id = String(v.idVariable || v.id || v.codigo);
    return state.favorites.includes(id);
  });
  
  const othersList = state.filteredVariables.filter(v => {
    const id = String(v.idVariable || v.id || v.codigo);
    return !state.favorites.includes(id);
  });
  
  // Función auxiliar para renderizar un item individual
  function renderItem(v) {
    const li = document.createElement('li');
    const id = String(v.idVariable || v.id || v.codigo);
    const desc = v.descripcion || v.name;
    
    // Crear el contenedor de texto (permitiendo saltos de línea para ver el nombre completo)
    const textSpan = document.createElement('span');
    textSpan.textContent = `${id} - ${desc}`;
    textSpan.style.flex = '1';
    textSpan.style.lineHeight = '1.4';
    textSpan.style.fontSize = '12.5px';
    textSpan.style.paddingRight = '4px';
    
    // Crear la estrella de favoritos
    const starIcon = document.createElement('i');
    const isFav = state.favorites.includes(id);
    starIcon.className = isFav ? 'fa-solid fa-star fav-icon active' : 'fa-regular fa-star fav-icon';
    starIcon.title = isFav ? 'Quitar de favoritos' : 'Agregar a favoritos';
    starIcon.style.marginTop = '2px'; // Alinear con la primera línea de texto
    
    // Evento de clic en la estrella (detiene propagación)
    starIcon.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleFavorite(id);
    });
    
    // Configurar flex y alineación
    li.style.display = 'flex';
    li.style.alignItems = 'flex-start';
    li.style.justifyContent = 'space-between';
    li.style.gap = '8px';
    li.style.padding = '10px 14px';
    
    li.appendChild(textSpan);
    li.appendChild(starIcon);
    
    li.setAttribute('data-id', id);
    li.setAttribute('role', 'option');
    
    if (state.selectedVariable && String(state.selectedVariable.idVariable || state.selectedVariable.id) === id) {
      li.classList.add('active');
    }
    
    li.addEventListener('click', () => handleVariableSelect(v));
    DOM.variablesList.appendChild(li);
  }
  
  // 1. Renderizar sección de Favoritos si existen
  if (favoritesList.length > 0) {
    const favHeader = document.createElement('li');
    favHeader.className = 'list-section-header';
    favHeader.innerHTML = '<i class="fa-solid fa-star" style="color: #f59e0b;"></i> Favoritos';
    DOM.variablesList.appendChild(favHeader);
    
    favoritesList.forEach(v => renderItem(v));
  }
  
  // 2. Renderizar sección de Todas las Variables
  if (othersList.length > 0) {
    const othersHeader = document.createElement('li');
    othersHeader.className = 'list-section-header';
    othersHeader.innerHTML = '<i class="fa-solid fa-chart-simple"></i> Conceptos';
    if (favoritesList.length > 0) {
      othersHeader.style.marginTop = '16px';
    }
    DOM.variablesList.appendChild(othersHeader);
    
    othersList.forEach(v => renderItem(v));
  }
}

// Alternar favoritos y persistir en localStorage
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

// Búsqueda interactiva de variables en el catálogo
function handleVariableSearch(e) {
  const query = e.target.value.toLowerCase().trim();
  
  if (!query) {
    state.filteredVariables = [...state.variables];
  } else {
    state.filteredVariables = state.variables.filter(v => {
      const id = String(v.idVariable || v.id || '').toLowerCase();
      const desc = String(v.descripcion || '').toLowerCase();
      return id.includes(query) || desc.includes(query);
    });
  }
  
  renderVariablesList();
}

// Selección de variable
function handleVariableSelect(variable) {
  state.selectedVariable = variable;
  
  // Actualizar UI de la barra lateral
  document.querySelectorAll('.variables-list li').forEach(li => {
    const id = li.getAttribute('data-id');
    const varId = String(variable.idVariable || variable.id);
    if (id === varId) {
      li.classList.add('active');
    } else {
      li.classList.remove('active');
    }
  });

  // Cerrar sidebar en dispositivos móviles al seleccionar
  if (window.innerWidth <= 992) {
    DOM.sidebar.classList.remove('active');
  }

  // Nombre en top bar
  DOM.selectedVariableNameTitle.textContent = variable.descripcion || `Variable ${variable.idVariable}`;

  // Cargar datos
  fetchHistoricalData(variable.idVariable || variable.id);
}

// --- CÁLCULO DE MÉTRICAS Y ACTUALIZACIÓN ---

function updateDashboard() {
  if (state.filteredData.length === 0) return;
  
  // 1. Calcular KPIs
  calculateKPIs();
  
  // 2. Renderizar Gráfico
  renderChart();
  
  // 3. Renderizar Tabla (Reiniciar a página 1)
  state.tablePage = 1;
  renderTable();
  
  // 4. Mostrar Metodología
  renderMethodology();
}

function calculateKPIs() {
  const data = state.filteredData;
  const len = data.length;
  
  // Último valor
  const latest = data[len - 1];
  DOM.latestValue.textContent = formatValue(latest.value);
  DOM.latestDate.textContent = formatDate(latest.date);
  
  // Calcular rendimiento según período seleccionado
  calculateVariationKPI();
  
  // Máximo Histórico en el rango seleccionado
  let max = data[0];
  let min = data[0];
  
  for (let i = 1; i < len; i++) {
    if (data[i].value > max.value) max = data[i];
    if (data[i].value < min.value) min = data[i];
  }
  
  DOM.maxValue.textContent = formatValue(max.value);
  DOM.maxDate.textContent = formatDate(max.date);
  DOM.minValue.textContent = formatValue(min.value);
  DOM.minDate.textContent = formatDate(min.date);
}

function calculateVariationKPI() {
  const data = state.filteredData;
  const len = data.length;
  let changeVal = 0;
  let changePct = 0;
  
  if (len > 1) {
    // Buscar el registro más cercano a N días naturales atrás
    const latestDateObj = new Date(data[len - 1].date);
    const targetDateObj = new Date(latestDateObj);
    targetDateObj.setDate(targetDateObj.getDate() - state.kpiPeriodDays);
    const targetDateStr = targetDateObj.toISOString().split('T')[0];
    
    // Buscar de atrás hacia adelante el primer registro cuya fecha sea menor o igual
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
  
  DOM.changeValue.textContent = (changeVal >= 0 ? '+' : '') + formatValue(changeVal);
  DOM.changePercent.textContent = (changeVal >= 0 ? '+' : '') + changePct.toFixed(2) + '%';
  
  // Aplicar clases de color según la tendencia del cambio
  DOM.kpiChangeIconWrapper.className = 'kpi-icon-wrapper';
  if (changeVal > 0) {
    DOM.kpiChangeIconWrapper.classList.add('change-color', 'positive');
    DOM.kpiChangeIcon.className = 'fa-solid fa-arrow-up';
  } else if (changeVal < 0) {
    DOM.kpiChangeIconWrapper.classList.add('change-color', 'negative');
    DOM.kpiChangeIcon.className = 'fa-solid fa-arrow-down';
  } else {
    DOM.kpiChangeIconWrapper.classList.add('change-color');
    DOM.kpiChangeIcon.className = 'fa-solid fa-minus';
  }
}

// --- RENDERIZADO DEL GRÁFICO (Chart.js) ---

function renderChart() {
  const ctx = document.getElementById('monetaryChart').getContext('2d');
  
  // Destruir gráfico previo si existe
  if (state.chart) {
    state.chart.destroy();
  }
  
  const labels = state.filteredData.map(d => formatDate(d.date));
  const datasetValues = state.filteredData.map(d => d.value);
  
  const isDark = document.body.classList.contains('dark-theme');
  const primaryColor = getComputedStyle(document.body).getPropertyValue('--primary').trim();
  const textColor = getComputedStyle(document.body).getPropertyValue('--text-secondary').trim();
  const gridColor = getComputedStyle(document.body).getPropertyValue('--border-color').trim();
  
  // Crear Gradiente debajo de la curva (solo para gráfico de línea)
  let bgGradient = primaryColor;
  if (state.chartType === 'line') {
    const gradient = ctx.createLinearGradient(0, 0, 0, 350);
    gradient.addColorStop(0, isDark ? 'rgba(244, 63, 94, 0.4)' : 'rgba(227, 23, 117, 0.4)');
    gradient.addColorStop(1, isDark ? 'rgba(244, 63, 94, 0.0)' : 'rgba(227, 23, 117, 0.0)');
    bgGradient = gradient;
  }
  
  // Plugin custom para dibujar sombra de neón debajo de la línea
  const lineShadowPlugin = {
    id: 'lineShadow',
    beforeDatasetsDraw: (chart) => {
      if (chart.config.type !== 'line') return;
      const ctx = chart.ctx;
      ctx.save();
      const primaryColor = getComputedStyle(document.body).getPropertyValue('--primary').trim();
      ctx.shadowColor = primaryColor;
      ctx.shadowBlur = 12;
      ctx.shadowOffsetY = 4;
    },
    afterDatasetsDraw: (chart) => {
      chart.ctx.restore();
    }
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
        pointRadius: datasetValues.length > 80 ? 0 : 3,
        pointHoverRadius: 6,
        pointBackgroundColor: primaryColor,
        pointBorderColor: '#ffffff',
        pointHoverBackgroundColor: primaryColor,
        pointHoverBorderColor: '#ffffff',
        tension: 0.15 // Suavizado de la línea
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: false // No mostrar leyenda, el título ya es descriptivo
        },
        tooltip: {
          mode: 'index',
          intersect: false,
          backgroundColor: isDark ? '#1e293b' : '#ffffff',
          titleColor: isDark ? '#f8fafc' : '#0f172a',
          bodyColor: isDark ? '#94a3b8' : '#64748b',
          borderColor: gridColor,
          borderWidth: 1,
          padding: 12,
          boxPadding: 6,
          titleFont: {
            family: 'Outfit',
            size: 13,
            weight: 'bold'
          },
          bodyFont: {
            family: 'Inter',
            size: 12
          },
          callbacks: {
            label: function(context) {
              return ' Valor: ' + formatValue(context.raw);
            }
          }
        }
      },
      scales: {
        x: {
          grid: {
            display: false
          },
          ticks: {
            color: textColor,
            font: {
              family: 'Inter',
              size: 10
            },
            maxTicksLimit: window.innerWidth < 600 ? 5 : 10
          }
        },
        y: {
          grid: {
            color: gridColor
          },
          ticks: {
            color: textColor,
            font: {
              family: 'Inter',
              size: 10
            },
            callback: function(value) {
              return formatValueCompact(value);
            }
          }
        }
      },
      interaction: {
        mode: 'nearest',
        axis: 'x',
        intersect: false
      }
    }
  });
}

// Actualizar colores del gráfico de forma dinámica al cambiar de tema
function updateChartTheme() {
  if (!state.chart) return;
  
  const isDark = document.body.classList.contains('dark-theme');
  const primaryColor = getComputedStyle(document.body).getPropertyValue('--primary').trim();
  const textColor = getComputedStyle(document.body).getPropertyValue('--text-secondary').trim();
  const gridColor = getComputedStyle(document.body).getPropertyValue('--border-color').trim();
  
  // Re-crear gradiente
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
  state.chart.data.datasets[0].pointBackgroundColor = primaryColor;
  
  state.chart.options.scales.x.ticks.color = textColor;
  state.chart.options.scales.y.ticks.color = textColor;
  state.chart.options.scales.y.grid.color = gridColor;
  
  state.chart.options.plugins.tooltip.backgroundColor = isDark ? '#1e293b' : '#ffffff';
  state.chart.options.plugins.tooltip.titleColor = isDark ? '#f8fafc' : '#0f172a';
  state.chart.options.plugins.tooltip.bodyColor = isDark ? '#94a3b8' : '#64748b';
  state.chart.options.plugins.tooltip.borderColor = gridColor;
  
  state.chart.update('none'); // Actualización suave sin animación total
}

// --- RENDERIZADO DE LA TABLA (PAGINADA) ---

function renderTable() {
  const startIndex = (state.tablePage - 1) * state.tablePageSize;
  const endIndex = Math.min(startIndex + state.tablePageSize, state.filteredData.length);
  
  // Clonamos y revertimos para mostrar los registros más recientes primero en la tabla
  const sortedDataForTable = [...state.filteredData].reverse();
  const pageData = sortedDataForTable.slice(startIndex, endIndex);
  
  DOM.tableBody.innerHTML = '';
  
  if (pageData.length === 0) {
    DOM.tableBody.innerHTML = '<tr><td colspan="3" class="text-center">No hay registros para mostrar.</td></tr>';
    updatePaginationControls(0, 0, 0);
    return;
  }
  
  pageData.forEach((item, index) => {
    const tr = document.createElement('tr');
    
    // Calcular variación diaria con respecto al anterior del historial general
    const originalIndex = state.filteredData.findIndex(d => d.date === item.date);
    let varText = '-';
    let varClass = '';
    
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
    DOM.tableBody.appendChild(tr);
  });
  
  updatePaginationControls(startIndex + 1, endIndex, state.filteredData.length);
}

function updatePaginationControls(start, end, total) {
  DOM.paginationInfo.textContent = `Mostrando ${start}-${end} de ${total} registros`;
  
  DOM.prevPageBtn.disabled = state.tablePage <= 1;
  DOM.nextPageBtn.disabled = end >= total;
}

function changeTablePage(direction) {
  state.tablePage += direction;
  renderTable();
}

// --- RENDERIZADO DE METODOLOGÍA ---

function renderMethodology() {
  DOM.variableDescriptionBody.innerHTML = '';
  
  if (!state.selectedVariable) return;
  
  const idVar = state.selectedVariable.idVariable || state.selectedVariable.id;
  
  // Buscar metodología que corresponda
  // La API de metodologías de estadísticas del BCRA v4 usualmente asocia metodologías con variables
  const method = state.methodologies.find(m => 
    String(m.idVariable || m.id || m.codigoVariable) === String(idVar)
  );
  
  if (method) {
    DOM.variableDescriptionBody.innerHTML = `
      <p><strong>Descripción Técnica:</strong> ${method.descripcion || 'Sin descripción metodológica cargada.'}</p>
      <p><strong>Periodicidad:</strong> ${method.periodicidad || 'Diaria/Mensual según variable.'}</p>
      ${method.observaciones ? `<p><strong>Observaciones:</strong> ${method.observaciones}</p>` : ''}
    `;
  } else {
    // Si no hay metodología explícita cargada, construimos una por defecto con los metadatos de la variable
    const periodicidad = detectPeriodicidad(state.selectedVariable.descripcion || '');
    DOM.variableDescriptionBody.innerHTML = `
      <p>Esta variable monetaria corresponde al código identificador <strong>${idVar}</strong> dentro del sistema del Banco Central de la República Argentina (BCRA).</p>
      <ul>
        <li><strong>Identificador:</strong> Variable ${idVar}</li>
        <li><strong>Nombre Oficial:</strong> ${state.selectedVariable.descripcion || 'No especificado'}</li>
        <li><strong>Frecuencia de actualización estimada:</strong> ${periodicidad}</li>
        <li><strong>Origen de datos:</strong> Base de datos de Estadísticas Monetarias del BCRA (API v4.0).</li>
      </ul>
      <p>Las cifras publicadas reflejan la información provista oficialmente por la entidad financiera a la fecha de consulta.</p>
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

// --- FILTROS Y CONTROLES ---

// Manejar clics de rangos de fechas rápidos (1M, 3M, 1A, etc.)
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
    DOM.startDate.value = state.historicalData[0].date;
    DOM.endDate.value = state.historicalData[len - 1].date;
  } else {
    const numDays = parseInt(days);
    const endDateObj = new Date(state.historicalData[len - 1].date);
    const startDateObj = new Date(endDateObj);
    startDateObj.setDate(startDateObj.getDate() - numDays);
    
    const startStr = startDateObj.toISOString().split('T')[0];
    const endStr = endDateObj.toISOString().split('T')[0];
    
    DOM.startDate.value = startStr;
    DOM.endDate.value = endStr;
    
    state.filteredData = state.historicalData.filter(d => d.date >= startStr && d.date <= endStr);
  }
  
  updateDashboard();
}

function resetQuickRangeButtons() {
  document.querySelectorAll('.range-btn').forEach(btn => btn.classList.remove('active'));
}

// Aplicar rango de fechas ingresadas de forma manual
function applyManualDatesFilter() {
  const startStr = DOM.startDate.value;
  const endStr = DOM.endDate.value;
  
  if (!startStr || !endStr) {
    showToast('Por favor, selecciona ambas fechas.', 'warning');
    return;
  }
  
  if (new Date(startStr) > new Date(endStr)) {
    showToast('La fecha de inicio no puede ser posterior a la fecha de fin.', 'warning');
    return;
  }
  
  resetQuickRangeButtons();
  
  state.filteredData = state.historicalData.filter(d => d.date >= startStr && d.date <= endStr);
  
  if (state.filteredData.length === 0) {
    showToast('No existen registros para el período seleccionado.', 'warning');
  }
  
  updateDashboard();
}

// Manejar selector de tipo de gráfico (Línea / Barras)
function handleChartTypeClick(e) {
  const btn = e.target.closest('.chart-style-btn');
  if (!btn) return;
  
  document.querySelectorAll('.chart-style-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  
  state.chartType = btn.getAttribute('data-type');
  renderChart();
}

// Intercambiar Tabs de visualización
function switchTab(tabId) {
  state.currentTab = tabId;
  
  // Actualizar botones
  DOM.btnTabChart.classList.toggle('active', tabId === 'tabChart');
  DOM.btnTabTable.classList.toggle('active', tabId === 'tabTable');
  
  // Actualizar paneles
  document.getElementById('tabChart').classList.toggle('active', tabId === 'tabChart');
  document.getElementById('tabTable').classList.toggle('active', tabId === 'tabTable');
}

// --- EXPORTACIÓN A CSV ---

function exportToCsv() {
  if (state.filteredData.length === 0) {
    showToast('No hay datos disponibles para exportar.', 'warning');
    return;
  }
  
  const varId = state.selectedVariable ? (state.selectedVariable.idVariable || state.selectedVariable.id) : 'variable';
  const varDesc = state.selectedVariable ? state.selectedVariable.descripcion : 'Estadistica Monetaria';
  
  let csvContent = `ID Variable: ${varId}\r\n`;
  csvContent += `Descripcion: ${varDesc}\r\n`;
  csvContent += `Exportado el: ${new Date().toLocaleDateString('es-AR')}\r\n\r\n`;
  csvContent += 'Fecha;Valor\r\n';
  
  state.filteredData.forEach(d => {
    // Usar punto y coma para compatibilidad directa con Excel en español, y formatear el decimal
    const valString = String(d.value).replace('.', ',');
    csvContent += `${d.date};${valString}\r\n`;
  });
  
  // Descarga del archivo
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  
  link.setAttribute('href', url);
  link.setAttribute('download', `bcra_variable_${varId}_${DOM.startDate.value}_al_${DOM.endDate.value}.csv`);
  link.style.visibility = 'hidden';
  
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  
  showToast('Archivo CSV exportado exitosamente.', 'success');
}

// --- UTILIDADES ---

// Formatear números en pesos (o genérico en español)
function formatValue(value) {
  if (isNaN(value)) return '-';
  return new Intl.NumberFormat('es-AR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value);
}

// Formato compacto para las etiquetas del eje Y del gráfico
function formatValueCompact(value) {
  if (Math.abs(value) >= 1.0e+12) {
    return (value / 1.0e+12).toFixed(1) + ' B'; // Billones
  }
  if (Math.abs(value) >= 1.0e+9) {
    return (value / 1.0e+9).toFixed(1) + ' M.M.'; // Miles de millones
  }
  if (Math.abs(value) >= 1.0e+6) {
    return (value / 1.0e+6).toFixed(1) + ' M'; // Millones
  }
  if (Math.abs(value) >= 1.0e+3) {
    return (value / 1.0e+3).toFixed(1) + ' K'; // Miles
  }
  return value;
}

// Formatear fecha (YYYY-MM-DD a DD/MM/YYYY)
function formatDate(dateString) {
  if (!dateString) return '-';
  const parts = dateString.split('-');
  if (parts.length !== 3) return dateString;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

// Mostrar / Ocultar indicador de carga principal del dashboard
function showDataLoader(show, text = 'Cargando...') {
  if (show) {
    DOM.loadingDataText.textContent = text;
    DOM.loadingDataOverlay.classList.remove('hidden');
  } else {
    DOM.loadingDataOverlay.classList.add('hidden');
  }
}

// Mostrar alerta Toast en pantalla
function showToast(message, type = 'success') {
  DOM.toastMessage.textContent = message;
  
  // Icono según tipo
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
  
  // Mostrar
  DOM.toast.classList.remove('hidden');
  DOM.toast.style.opacity = '1';
  
  // Ocultar automáticamente en 4 segundos
  setTimeout(() => {
    DOM.toast.style.opacity = '0';
    setTimeout(() => {
      DOM.toast.classList.add('hidden');
    }, 200);
  }, 4000);
}
