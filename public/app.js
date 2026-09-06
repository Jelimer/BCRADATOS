/**
 * Portal Financiero Argentino - Orquestador Raíz ESM
 * 
 * Arquitectura modular desacoplada por dominio.
 * Administra el enrutamiento SPA, ciclo de vida de los controladores,
 * navegación adaptativa y sincronización de temas.
 */

// ============================================================================
// EXPORTACIONES MANDATORIAS PARA RETROCOMPATIBILIDAD CON LA SUITE DE PRUEBAS
// ============================================================================
export { clientCache } from './js/modules/state.js';
export { debounce } from './js/modules/utils.js';

// Importación de módulos y controladores
import { appState } from './js/modules/state.js';
import { initTheme, toggleTheme } from './js/modules/ui.js';
import { tabBcra } from './js/modules/tabBcra.js';
import { tabIndec } from './js/modules/tabIndec.js';
import { tabDolares } from './js/modules/tabDolares.js';
import { tabByma } from './js/modules/tabByma.js';
import { tabComparador } from './js/modules/tabComparador.js';
import { tabConsultas } from './js/modules/tabConsultas.js';

/**
 * Enrutador SPA para alternar entre las 6 hojas y vistas temáticas.
 * @param {string} tabId Identificador de tab ('bcra', 'indec', 'dolares', 'byma', 'comparador', 'consultas')
 */
export function switchNavigationTab(tabId) {
  appState.activeTab = tabId;

  // Actualizar menú lateral
  document.querySelectorAll('.nav-tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-tab') === tabId);
  });

  // Mostrar / Ocultar subpanel del catálogo de variables en el sidebar
  const bcraSubpanel = document.getElementById('bcraSubpanel');
  if (bcraSubpanel) {
    bcraSubpanel.classList.toggle('hidden', tabId !== 'bcra');
  }

  // Alternar paneles de vista
  document.querySelectorAll('.view-panel').forEach(panel => {
    panel.classList.add('hidden');
    panel.classList.remove('active');
  });

  const targetView = document.getElementById(`view${tabId.charAt(0).toUpperCase() + tabId.slice(1)}`);
  if (targetView) {
    targetView.classList.remove('hidden');
    targetView.classList.add('active');
  }

  // Actualizar título en Top-bar y activar controlador correspondiente
  const titleEl = document.getElementById('selectedVariableNameTitle');

  if (tabId === 'bcra') {
    if (titleEl) {
      titleEl.textContent = appState.bcra.selectedVariable
        ? (appState.bcra.selectedVariable.descripcion || 'Estadísticas Monetarias')
        : 'Estadísticas Monetarias (BCRA)';
    }
    tabBcra.init();
  } else if (tabId === 'indec') {
    if (titleEl) titleEl.textContent = 'Inflación y Actividad Económica (INDEC)';
    tabIndec.init();
  } else if (tabId === 'dolares') {
    if (titleEl) titleEl.textContent = 'Mercado Cambiario y Cotizaciones del Dólar';
    tabDolares.init();
  } else if (tabId === 'byma') {
    if (titleEl) titleEl.textContent = 'Títulos y Bonos Soberanos (BYMA)';
    tabByma.init();
  } else if (tabId === 'comparador') {
    if (titleEl) titleEl.textContent = 'Comparador de Productos Financieros (BCRA)';
    tabComparador.init();
  } else if (tabId === 'consultas') {
    if (titleEl) titleEl.textContent = 'Consultas Financieras y Perfil de Deudores';
    tabConsultas.init();
  }
}

/**
 * Configura los event listeners globales de navegación, sidebar y tema.
 */
function setupGlobalEventListeners() {
  const sidebar = document.getElementById('sidebar');
  const toggleSidebarBtn = document.getElementById('toggleSidebarBtn');
  const closeSidebarBtn = document.getElementById('closeSidebarBtn');
  const themeToggleBtn = document.getElementById('themeToggleBtn');

  // Sidebar Móvil
  if (toggleSidebarBtn && sidebar) {
    toggleSidebarBtn.addEventListener('click', () => {
      sidebar.classList.add('active');
      toggleSidebarBtn.setAttribute('aria-expanded', 'true');
    });
  }

  if (closeSidebarBtn && sidebar && toggleSidebarBtn) {
    closeSidebarBtn.addEventListener('click', () => {
      sidebar.classList.remove('active');
      toggleSidebarBtn.setAttribute('aria-expanded', 'false');
    });
  }

  // Alternancia de Tema (Oscuro / Claro)
  if (themeToggleBtn) {
    themeToggleBtn.addEventListener('click', toggleTheme);
  }

  // Navegación por pestañas principales (6 tabs)
  document.querySelectorAll('.nav-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tabId = btn.getAttribute('data-tab');
      if (tabId) {
        switchNavigationTab(tabId);
        if (window.innerWidth <= 992 && sidebar && toggleSidebarBtn) {
          sidebar.classList.remove('active');
          toggleSidebarBtn.setAttribute('aria-expanded', 'false');
        }
      }
    });
  });
}

// Inicialización en DOMContentLoaded
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  setupGlobalEventListeners();
  switchNavigationTab('bcra');
});
