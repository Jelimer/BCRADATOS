/**
 * ui.js
 * Interfaz de usuario: sistema de notificaciones toast, spinners/loaders
 * y gestión del tema visual (oscuro / claro).
 */

import { updateChartThemeAll } from './charts.js';

/**
 * Muestra una notificación emergente tipo toast accesible.
 * @param {string} message 
 * @param {'success'|'warning'|'danger'} [type='success'] 
 */
export function showToast(message, type = 'success') {
  const toast = document.getElementById('toast');
  const toastMessage = document.getElementById('toastMessage');
  const toastIcon = document.getElementById('toastIcon');

  if (!toast || !toastMessage || !toastIcon) return;

  toastMessage.textContent = message;
  toastIcon.className = 'fa-solid toast-icon';

  if (type === 'success') {
    toastIcon.classList.add('fa-circle-check');
    toast.style.borderLeftColor = 'var(--success)';
    toastIcon.style.color = 'var(--success)';
  } else if (type === 'warning') {
    toastIcon.classList.add('fa-triangle-exclamation');
    toast.style.borderLeftColor = 'var(--warning)';
    toastIcon.style.color = 'var(--warning)';
  } else {
    toastIcon.classList.add('fa-circle-exclamation');
    toast.style.borderLeftColor = 'var(--danger)';
    toastIcon.style.color = 'var(--danger)';
  }

  toast.classList.remove('hidden');
  toast.style.opacity = '1';

  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => {
      toast.classList.add('hidden');
    }, 200);
  }, 4000);
}

/**
 * Muestra u oculta la pantalla de carga (overlay) de la vista activa de datos.
 * @param {boolean} show 
 * @param {string} [text='Cargando datos...'] 
 */
export function showDataLoader(show, text = 'Cargando datos...') {
  const overlay = document.getElementById('loadingDataOverlay');
  const overlayText = document.getElementById('loadingDataText');

  if (overlay) {
    if (show) {
      if (overlayText) overlayText.textContent = text;
      overlay.classList.remove('hidden');
    } else {
      overlay.classList.add('hidden');
    }
  }
}

/**
 * Inicializa el tema visual a partir de la preferencia guardada en localStorage o sistema.
 */
export function initTheme() {
  const savedTheme = localStorage.getItem('theme');
  if (savedTheme === 'light') {
    document.body.classList.remove('dark-theme');
  } else {
    document.body.classList.add('dark-theme');
  }
}

/**
 * Alterna entre tema oscuro y claro, actualizando localStorage y los gráficos activos.
 * @returns {boolean} true si el tema resultante es oscuro
 */
export function toggleTheme() {
  const isDark = document.body.classList.toggle('dark-theme');
  localStorage.setItem('theme', isDark ? 'dark' : 'light');
  updateChartThemeAll(isDark);
  return isDark;
}
