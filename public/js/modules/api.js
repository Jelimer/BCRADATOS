/**
 * api.js
 * Servicios de consumo HTTP para todos los endpoints proxy del servidor.
 * Incorpora timeout configurable, abort controller y normalización de errores.
 */

/**
 * Realiza un fetch con límite de tiempo (timeout) por AbortController.
 * @param {string} resource 
 * @param {RequestInit & { timeout?: number }} [options={}] 
 * @returns {Promise<Response>}
 */
export async function fetchWithTimeout(resource, options = {}) {
  const { timeout = 10000, ...fetchOptions } = options;
  const controller = new AbortController();
  const timerId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(resource, {
      ...fetchOptions,
      signal: controller.signal
    });
    clearTimeout(timerId);
    return response;
  } catch (error) {
    clearTimeout(timerId);
    throw error;
  }
}

/**
 * Helper interno para parsear respuesta JSON o arrojar error descriptivo.
 * @private
 */
async function parseJsonResponse(res, errorMessage = 'Error en respuesta de API') {
  if (!res.ok) {
    let errorDetail = `${res.status} ${res.statusText}`;
    try {
      const errJson = await res.json();
      if (errJson && (errJson.message || errJson.details || errJson.error)) {
        errorDetail = errJson.message || errJson.details || errJson.error;
      }
    } catch (_) {}
    throw new Error(`${errorMessage}: ${errorDetail}`);
  }
  return await res.json();
}

// ==========================================
// 1. ENDPOINTS BCRA MONETARIAS Y METODOLOGÍA
// ==========================================

export async function fetchBcraCatalog() {
  const res = await fetchWithTimeout('/api/monetarias', { timeout: 12000 });
  const data = await parseJsonResponse(res, 'Error al obtener catálogo del BCRA');
  return Array.isArray(data) ? data : (data.results || data.data || []);
}

export async function fetchBcraMethodology() {
  const res = await fetchWithTimeout('/api/metodologia', { timeout: 8000 });
  const data = await parseJsonResponse(res, 'Error al obtener metodología técnica del BCRA');
  return Array.isArray(data) ? data : (data.results || data.data || []);
}

export async function fetchBcraHistorical(idVariable) {
  const res = await fetchWithTimeout(`/api/monetarias/${idVariable}`, { timeout: 15000 });
  const result = await parseJsonResponse(res, 'Error al obtener datos históricos del BCRA');
  
  let rawData = [];
  if (result && result.results && Array.isArray(result.results)) {
    rawData = result.results[0].detalle || result.results;
  } else {
    rawData = Array.isArray(result) ? result : (result.data || []);
  }

  return rawData
    .map(item => ({
      date: item.fecha,
      value: parseFloat(item.valor)
    }))
    .filter(item => item.date && !isNaN(item.value))
    .sort((a, b) => a.date.localeCompare(b.date));
}

// ==========================================
// 2. ENDPOINTS INDEC
// ==========================================

export async function fetchIndecSeries(ids, limit = 1000) {
  const url = `/api/indec/series?ids=${encodeURIComponent(ids)}&limit=${limit}`;
  const res = await fetchWithTimeout(url, { timeout: 15000 });
  return await parseJsonResponse(res, 'Error al consultar series del INDEC');
}

// ==========================================
// 3. ENDPOINTS MERCADO CAMBIARIO Y COTIZACIONES
// ==========================================

export async function fetchMercadoLive(tipo) {
  const res = await fetchWithTimeout(`/api/mercado/live/${tipo}`, { timeout: 6000 });
  return await parseJsonResponse(res, `Error al obtener cotización en vivo de ${tipo}`);
}

export async function fetchDolarBlueLive() {
  const res = await fetchWithTimeout('/api/mercado-dolarapi/dolares/blue', { timeout: 6000 });
  return await parseJsonResponse(res, 'Error al consultar cotización de Dólar Blue');
}

export async function fetchDivisasCambiarias() {
  const res = await fetchWithTimeout('/api/bcra-cambiarias/Cotizaciones', { timeout: 8000 });
  return await parseJsonResponse(res, 'Error al consultar cotizaciones cambiarias del BCRA');
}

export async function fetchDolarBlueHistorical() {
  const res = await fetchWithTimeout('/api/argentinadatos/cotizaciones/dolares/blue', { timeout: 10000 });
  return await parseJsonResponse(res, 'Error al consultar histórico de Dólar Blue');
}

// ==========================================
// 4. ENDPOINTS BYMA
// ==========================================

export async function fetchBymaPanel() {
  const res = await fetchWithTimeout('/api/byma/panel/public-bonds', { timeout: 10000 });
  const data = await parseJsonResponse(res, 'Error al consultar panel de bonos en BYMA');
  return Array.isArray(data) ? data : (data.data || data.results || []);
}

export async function fetchBymaBondInfo(symbol) {
  const res = await fetchWithTimeout(`/api/byma/bond-info/${encodeURIComponent(symbol)}`, { timeout: 10000 });
  return await parseJsonResponse(res, `Error al consultar ficha del bono ${symbol}`);
}

export async function fetchBymaHistorical(symbol, from, to) {
  const url = `/api/byma/historico/${encodeURIComponent(symbol)}?resolution=D&from=${from}&to=${to}`;
  const res = await fetchWithTimeout(url, { timeout: 12000 });
  return await parseJsonResponse(res, `Error al consultar histórico de ${symbol}`);
}

// ==========================================
// 5. ENDPOINTS COMPARADOR (RÉGIMEN DE TRANSPARENCIA BCRA)
// ==========================================

export async function fetchPlazosFijos() {
  const res = await fetchWithTimeout('/api/bcra-transparencia/PlazosFijos', { timeout: 15000 });
  return await parseJsonResponse(res, 'Error al consultar plazos fijos en BCRA');
}

export async function fetchComisiones() {
  const res = await fetchWithTimeout('/api/bcra-transparencia/PaquetesProductos', { timeout: 15000 });
  return await parseJsonResponse(res, 'Error al consultar comisiones en BCRA');
}

export async function fetchPrestamos() {
  const res = await fetchWithTimeout('/api/bcra-transparencia/Prestamos/Personales', { timeout: 15000 });
  return await parseJsonResponse(res, 'Error al consultar préstamos en BCRA');
}

// ==========================================
// 6. ENDPOINTS CONSULTAS FINANCIERAS (DEUDORES / CHEQUES)
// ==========================================

export async function fetchDeudas(cuit) {
  const cleanCuit = String(cuit || '').replace(/\D/g, '');
  const res = await fetchWithTimeout(`/api/bcra-deudores/Deudas/${cleanCuit}`, { timeout: 20000 });
  return await parseJsonResponse(res, `Error al consultar central de deudores para CUIT ${cleanCuit}`);
}

export async function fetchDeudasHistoricas(cuit) {
  const cleanCuit = String(cuit || '').replace(/\D/g, '');
  const res = await fetchWithTimeout(`/api/bcra-deudores/Deudas/Historicas/${cleanCuit}`, { timeout: 20000 });
  return await parseJsonResponse(res, `Error al consultar historial crediticio de 24 meses para CUIT ${cleanCuit}`);
}

export async function fetchChequeDenunciado(banco, numero) {
  const res = await fetchWithTimeout(`/api/bcra-cheques/denunciados/${encodeURIComponent(banco)}/${encodeURIComponent(numero)}`, { timeout: 15000 });
  return await parseJsonResponse(res, `Error al consultar cheque ${numero}`);
}

// ==========================================
// 7. ENDPOINTS CRIPTOYA Y RENDIMIENTOS FINTECH
// ==========================================

export async function fetchCriptoYaDolar() {
  const res = await fetchWithTimeout('/api/criptoya/dolar', { timeout: 8000 });
  return await parseJsonResponse(res, 'Error al obtener cotizaciones de dólar en CriptoYa');
}

export async function fetchCriptoYaCripto(coin = 'usdt', fiat = 'ars') {
  const res = await fetchWithTimeout(`/api/criptoya/cripto/${coin}/${fiat}`, { timeout: 8000 });
  return await parseJsonResponse(res, `Error al obtener cotizaciones cripto de ${coin}/${fiat}`);
}

export async function fetchCriptoYaBancos() {
  const res = await fetchWithTimeout('/api/criptoya/bancos', { timeout: 8000 });
  return await parseJsonResponse(res, 'Error al consultar cotizaciones bancarias de CriptoYa');
}

export async function fetchFinanzasRendimientos(moneda = 'ARS') {
  const url = moneda ? `/api/finanzas/rendimientos?moneda=${encodeURIComponent(moneda)}` : '/api/finanzas/rendimientos';
  const res = await fetchWithTimeout(url, { timeout: 12000 });
  return await parseJsonResponse(res, 'Error al obtener rendimientos fintech');
}
