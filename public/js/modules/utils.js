/**
 * utils.js
 * Utilidades puras de formateo, validación, debounce y descargas.
 */

/**
 * Formatea un número como moneda argentina (es-AR) con dos decimales.
 * @param {number|null} value 
 * @returns {string}
 */
export function formatValue(value) {
  if (value === null || value === undefined || isNaN(value)) return '-';
  return new Intl.NumberFormat('es-AR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value);
}

/**
 * Formatea un número de forma compacta (K, M, M.M., B).
 * @param {number|null} value 
 * @returns {string}
 */
export function formatValueCompact(value) {
  if (value === null || value === undefined || isNaN(value)) return '-';
  const abs = Math.abs(value);
  if (abs >= 1.0e+12) return (value / 1.0e+12).toFixed(1) + ' B';
  if (abs >= 1.0e+9) return (value / 1.0e+9).toFixed(1) + ' M.M.';
  if (abs >= 1.0e+6) return (value / 1.0e+6).toFixed(1) + ' M';
  if (abs >= 1.0e+3) return (value / 1.0e+3).toFixed(1) + ' K';
  return formatValue(value);
}

/**
 * Convierte una fecha ISO (YYYY-MM-DD) a formato latinoamericano (DD/MM/YYYY).
 * @param {string|null} dateString 
 * @returns {string}
 */
export function formatDate(dateString) {
  if (!dateString) return '-';
  const parts = String(dateString).split('T')[0].split('-');
  if (parts.length !== 3) return String(dateString);
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

/**
 * Helper de retardo para optimización de eventos de input en buscadores.
 * @param {Function} func 
 * @param {number} [wait=150] 
 * @returns {Function}
 */
export function debounce(func, wait = 150) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

/**
 * Validador estricto de CUIT/CUIL mediante el algoritmo ponderador Módulo 11 de AFIP.
 * @param {string} cuit 
 * @returns {boolean}
 */
export function isValidCuit(cuit) {
  const cleanCuit = String(cuit || '').replace(/\D/g, '');
  if (cleanCuit.length !== 11) return false;

  const factors = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    sum += parseInt(cleanCuit[i], 10) * factors[i];
  }

  const checkDigit = parseInt(cleanCuit[10], 10);
  let calculatedDigit = 11 - (sum % 11);
  if (calculatedDigit === 11) calculatedDigit = 0;
  if (calculatedDigit === 10) calculatedDigit = 9;

  return checkDigit === calculatedDigit;
}

/**
 * Genera y descarga un archivo en el navegador mediante Blob URL,
 * liberando la memoria con URL.revokeObjectURL.
 * @param {string|Blob} content 
 * @param {string} filename 
 * @param {string} [mimeType='text/plain;charset=utf-8;'] 
 */
export function downloadBlob(content, filename, mimeType = 'text/plain;charset=utf-8;') {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
