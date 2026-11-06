/**
 * server.js
 * Servidor Proxy Financiero y Orquestador de APIs para bcra-monetarias
 */

const express = require('express');
const cors = require('cors');
const compression = require('compression');
const path = require('path');
const fs = require('fs');

const httpClient = require('./services/httpClient');
const { cacheService } = require('./services/cacheService');
const { cacheMiddleware } = require('./middleware/cacheMiddleware');
const { errorHandler, formatUpstreamError } = require('./middleware/errorHandler');
const schemaValidator = require('./services/schemaValidator');

const app = express();
const PORT = process.env.PORT || 3000;

// ==========================================
// MIDDLEWARES BASE
// ==========================================

// Compresión de respuestas HTTP (Gzip/Deflate)
app.use(compression({
  filter: (req, res) => {
    if (req.headers['x-no-compression']) {
      return false;
    }
    return compression.filter(req, res);
  },
  threshold: 1024 // Comprimir solo payloads mayores a 1KB
}));

// Habilitar CORS y JSON parser
app.use(cors());
app.use(express.json());

// Servir archivos estáticos del frontend sin caché rancia
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html') || filePath.endsWith('.js') || filePath.endsWith('.css')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  }
}));

// Bases de APIs del BCRA e INDEC
const BCRA_MONETARIAS_BASE = 'https://api.bcra.gob.ar/estadisticas/v4.0';
const BCRA_CAMBIARIAS_BASE = 'https://api.bcra.gob.ar/estadisticascambiarias/v1.0';
const BCRA_TRANSPARENCIA_BASE = 'https://api.bcra.gob.ar/transparencia/v1.0';
const BCRA_DEUDORES_BASE = 'https://api.bcra.gob.ar/centraldedeudores/v1.0';
const BCRA_CHEQUES_BASE = 'https://api.bcra.gob.ar/cheques/v1.0';
const INDEC_SERIES_BASE = process.env.INDEC_SERIES_BASE || 'https://apis.datos.gob.ar/series/api/series/';
const INDEC_DIRECT_BASE = process.env.INDEC_DIRECT_BASE || process.env.INDEC_API_BASE || 'https://api.indec.gob.ar/v1';
const DATA912_BASE = 'https://data912.com/live';
const BYMA_BASE = 'https://open.bymadata.com.ar/vanoms-be-core/rest/api/bymadata/free';
const DOLARAPI_BASE = 'https://dolarapi.com/v1';
const ARGENTINADATOS_BASE = 'https://api.argentinadatos.com/v1';
const CRIPTOYA_BASE = 'https://criptoya.com/api';

// Claves para persistencia de fallback de paneles y contingencias fuera de horario
const BYMA_FALLBACK_CACHE_KEY = 'byma:last_valid_panel';
const INDEC_FALLBACK_CACHE_KEY = 'indec:last_valid_series';
const CRIPTOYA_FALLBACK_DOLAR_KEY = 'criptoya:last_valid_dolar';
const CRIPTOYA_FALLBACK_BANCOS_KEY = 'criptoya:last_valid_bancos';
const CRIPTOYA_FALLBACK_INDICADORES_KEY = 'criptoya:last_valid_indicadores';
const FINANZAS_FALLBACK_RENDIMIENTOS_KEY = 'finanzas:last_valid_rendimientos';

// Carga del snapshot persistente oficial de bonos de BYMA para contingencia 24/7
let persistentBondsSnapshot = null;
try {
  const snapshotFile = path.join(__dirname, 'data', 'byma_bonds_snapshot.json');
  if (fs.existsSync(snapshotFile)) {
    persistentBondsSnapshot = JSON.parse(fs.readFileSync(snapshotFile, 'utf-8'));
    cacheService.set(BYMA_FALLBACK_CACHE_KEY, persistentBondsSnapshot, cacheService.TTL.FALLBACK_PERSISTENT);
    console.log(`[BYMA] Snapshot persistente de bonos cargado (${persistentBondsSnapshot.data?.length || 0} especies).`);
  }
} catch (e) {
  console.warn('[BYMA] No se pudo cargar snapshot persistente de bonos:', e.message);
}

function getFallbackBondsPanel() {
  const cachedPanel = cacheService.get(BYMA_FALLBACK_CACHE_KEY);
  if (cachedPanel && Array.isArray(cachedPanel.data) && cachedPanel.data.length > 0) {
    return cachedPanel;
  }
  if (persistentBondsSnapshot && Array.isArray(persistentBondsSnapshot.data) && persistentBondsSnapshot.data.length > 0) {
    return persistentBondsSnapshot;
  }
  return null;
}

/**
 * Busca un bono en el panel de fallback o snapshot por sus posibles símbolos.
 * @param {...string} symbols Símbolos candidatos a buscar
 * @returns {object|null}
 */
function findFallbackBond(...symbols) {
  const panel = getFallbackBondsPanel();
  if (!panel || !Array.isArray(panel.data)) return null;
  const candidates = symbols.filter(Boolean);
  return panel.data.find(b => candidates.includes(b.symbol)) || null;
}

// Carga del snapshot persistente oficial de series de INDEC para contingencia
let persistentIndecSnapshot = null;
try {
  const indecSnapshotFile = path.join(__dirname, 'data', 'indec_series_snapshot.json');
  if (fs.existsSync(indecSnapshotFile)) {
    persistentIndecSnapshot = JSON.parse(fs.readFileSync(indecSnapshotFile, 'utf-8'));
    cacheService.set(INDEC_FALLBACK_CACHE_KEY, persistentIndecSnapshot, cacheService.TTL.FALLBACK_PERSISTENT);
    console.log(`[INDEC] Snapshot persistente de series cargado (${Object.keys(persistentIndecSnapshot.series || {}).length} series).`);
  }
} catch (e) {
  console.warn('[INDEC] No se pudo cargar snapshot persistente de series:', e.message);
}

/**
 * Normaliza respuestas relacionales/PostgREST de api.indec.gob.ar al formato matricial estándar.
 * @param {Array<object>} records 
 * @param {object} query 
 * @returns {object}
 */
function normalizeIndecDirectResponse(records, query = {}) {
  const seriesIds = query.ids ? String(query.ids).split(',').map(s => s.trim()).filter(Boolean) : ['serie_indec'];
  const meta = [
    { field: { id: 'indice_tiempo', description: 'Índice de tiempo' } },
    ...seriesIds.map(id => ({ field: { id, description: id } }))
  ];

  const data = records.map(r => {
    const date = r.periodo || r.fecha || r.date || r.indice_tiempo;
    const val = r.valor !== undefined ? r.valor : (r.value !== undefined ? r.value : null);
    return [date, val];
  });

  return {
    data,
    meta,
    count: data.length,
    params: { ...query }
  };
}

/**
 * Hidrata series con valores faltantes o nulos (como RIPTE 158.1_REPTE_0_0_5)
 * a partir del snapshot persistente oficial de INDEC.
 * @param {object} responseData 
 * @returns {object}
 */
function hydrateIndecSeries(responseData) {
  if (!responseData || !Array.isArray(responseData.data) || !Array.isArray(responseData.meta)) {
    return responseData;
  }
  const snapshot = persistentIndecSnapshot || cacheService.get(INDEC_FALLBACK_CACHE_KEY);
  if (!snapshot || !snapshot.dates || !snapshot.series) {
    return responseData;
  }

  const colMappings = [];
  responseData.meta.forEach((m, idx) => {
    const fid = m.field?.id;
    if (fid && snapshot.series[fid]) {
      const seriesObj = snapshot.series[fid];
      const valMap = new Map();
      let lastVal = null;
      snapshot.dates.forEach((d, dIdx) => {
        const v = seriesObj.values[dIdx];
        if (v !== undefined && v !== null) lastVal = v;
        valMap.set(d, v);
        valMap.set(d.slice(0, 7), v);
      });
      colMappings.push({ colIdx: idx, valMap, lastVal });
    }
  });

  if (colMappings.length === 0) return responseData;

  for (const row of responseData.data) {
    if (!Array.isArray(row)) continue;
    const dateKey = row[0];
    for (const { colIdx, valMap, lastVal } of colMappings) {
      if (row[colIdx] === null || row[colIdx] === undefined || (typeof row[colIdx] === 'number' && isNaN(row[colIdx]))) {
        const fallbackVal = valMap.get(dateKey) ?? valMap.get(String(dateKey).slice(0, 7)) ?? lastVal;
        if (fallbackVal !== undefined && fallbackVal !== null) {
          row[colIdx] = fallbackVal;
        }
      }
    }
  }

  return responseData;
}

function getFallbackIndecData(query = {}) {
  const snapshot = persistentIndecSnapshot || cacheService.get(INDEC_FALLBACK_CACHE_KEY);
  if (!snapshot || !snapshot.dates || !snapshot.series) {
    return {
      data: [],
      meta: [{ field: { id: 'indice_tiempo', description: 'Índice de tiempo' } }],
      count: 0,
      isFallback: true,
      cached: true
    };
  }

  const rawIds = query.ids ? String(query.ids).split(',').map(s => s.trim()).filter(Boolean) : [];
  const matchingSeries = [];
  for (const id of rawIds) {
    if (snapshot.series[id]) {
      matchingSeries.push(snapshot.series[id]);
    }
  }

  if (rawIds.length > 0 && matchingSeries.length === 0) {
    return {
      data: [],
      meta: [{ field: { id: 'indice_tiempo', description: 'Índice de tiempo' } }],
      count: 0,
      params: { ...query },
      isFallback: true,
      cached: true
    };
  }

  const selectedSeries = matchingSeries.length > 0 
    ? matchingSeries 
    : [snapshot.series['145.3_INGNACNAL_DICI_M_15']].filter(Boolean);

  const meta = [
    { field: { id: 'indice_tiempo', description: 'Índice de tiempo' } },
    ...selectedSeries.map(s => ({
      field: {
        id: s.id,
        description: s.description || s.id
      }
    }))
  ];

  let dates = snapshot.dates;
  let rows = dates.map((date, idx) => {
    const row = [date];
    for (const s of selectedSeries) {
      row.push(s.values[idx] !== undefined ? s.values[idx] : null);
    }
    return row;
  });

  if (query.start_date && typeof query.start_date === 'string' && !isNaN(Date.parse(query.start_date))) {
    rows = rows.filter(r => r[0] >= query.start_date);
  }
  if (query.end_date && typeof query.end_date === 'string' && !isNaN(Date.parse(query.end_date))) {
    rows = rows.filter(r => r[0] <= query.end_date);
  }

  const limit = parseInt(query.limit, 10);
  if (!isNaN(limit) && limit > 0) {
    rows = rows.slice(-limit);
  }

  return {
    data: rows,
    meta,
    count: rows.length,
    params: { ...query },
    isFallback: true,
    cached: true
  };
}

// ==========================================
// 1. ENDPOINTS PROXY - BCRA ESTADÍSTICAS MONETARIAS
// ==========================================

// Catálogo de todas las variables monetarias (TTL: 24h)
app.get('/api/monetarias', cacheMiddleware('CATALOG'), async (req, res, next) => {
  try {
    const response = await httpClient.get(`${BCRA_MONETARIAS_BASE}/monetarias`, {
      timeout: httpClient.TIMEOUTS.HEAVY_SERIES
    });

    const data = response.data;
    if (data && Array.isArray(data.results)) {
      data.results = data.results.map(v => ({
        ...v,
        fecha: v.fecha || v.ultFechaInformada || '',
        valor: v.valor !== undefined
          ? v.valor
          : (typeof v.ultValorInformado === 'number' ? v.ultValorInformado : (Number(v.ultValorInformado) || 0))
      }));
    }

    res.json(data);
  } catch (error) {
    console.error('[BCRA Monetarias] Error en catálogo:', error.message);
    const { status, body } = formatUpstreamError(error, 'Error al obtener catálogo de variables monetarias del BCRA');
    res.status(status).json(body);
  }
});

// Detalle histórico de una variable específica en orden cronológico ascendente (TTL: 1h)
app.get('/api/monetarias/:id', cacheMiddleware('HISTORICAL_SERIES'), async (req, res, next) => {
  const { id } = req.params;
  try {
    const response = await httpClient.get(`${BCRA_MONETARIAS_BASE}/Monetarias/${id}`, {
      params: req.query,
      timeout: httpClient.TIMEOUTS.HEAVY_SERIES
    });

    const data = response.data;
    if (data && Array.isArray(data.results)) {
      data.results.forEach(item => {
        if (Array.isArray(item.detalle)) {
          // Ordenar cronológicamente mediante comparación lexicográfica directa O(1)
          item.detalle.sort((a, b) => {
            const fA = a.fecha || '';
            const fB = b.fecha || '';
            return fA < fB ? -1 : (fA > fB ? 1 : 0);
          });
        }
      });
    }

    res.json(data);
  } catch (error) {
    console.error(`[BCRA Monetarias] Error en variable ${id}:`, error.message);
    const { status, body } = formatUpstreamError(error, `Error al obtener datos históricos de la variable ${id} del BCRA`);
    res.status(status).json(body);
  }
});

// Diccionario metodológico del BCRA (TTL: 24h)
app.get('/api/metodologia', cacheMiddleware('CATALOG'), async (req, res, next) => {
  try {
    const response = await httpClient.get(`${BCRA_MONETARIAS_BASE}/Metodologia`, {
      timeout: httpClient.TIMEOUTS.HEAVY_SERIES
    });
    res.json(response.data);
  } catch (error) {
    console.error('[BCRA Monetarias] Error en metodología:', error.message);
    const { status, body } = formatUpstreamError(error, 'Error al obtener la metodología del BCRA');
    res.status(status).json(body);
  }
});

// ==========================================
// 2. ENDPOINT PROXY - INDEC (Series de Tiempo)
// ==========================================

// Series macroeconómicas de INDEC (TTL: 1h) con alta resiliencia y timeout optimizado
app.get('/api/indec/series', cacheMiddleware('HISTORICAL_SERIES'), async (req, res, next) => {
  const token = process.env.INDEC_API_TOKEN;

  // 1. Si se provee token oficial INDEC_API_TOKEN, intentar consulta a la API directa oficial
  if (token) {
    try {
      const directUrl = `${INDEC_DIRECT_BASE}/series`;
      const directResponse = await httpClient.get(directUrl, {
        params: req.query,
        headers: {
          Authorization: `Bearer ${token}`
        },
        timeout: 5000
      }, {
        retries: 0
      });

      if (directResponse.data) {
        let normalized = directResponse.data;
        if (Array.isArray(directResponse.data) && directResponse.data.length > 0 && typeof directResponse.data[0] === 'object' && !Array.isArray(directResponse.data[0])) {
          normalized = normalizeIndecDirectResponse(directResponse.data, req.query);
        }

        if (Array.isArray(normalized.data) && normalized.data.length > 0) {
          const hydrated = hydrateIndecSeries(normalized);
          return res.json(hydrated);
        }
      }
    } catch (directError) {
      console.warn('[INDEC] Fallo en API directa con INDEC_API_TOKEN, conmutando a API abierta:', directError.message);
    }
  }

  // 2. Fuente primaria/por defecto: API oficial de series de tiempo de la República Argentina
  try {
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    const response = await httpClient.get(INDEC_SERIES_BASE, {
      params: req.query,
      headers,
      timeout: 5000
    }, {
      retries: 0
    });

    if (req.query.format === 'csv' && typeof response.data === 'string') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      return res.send(response.data);
    }

    if (response.data && Array.isArray(response.data.data) && response.data.data.length > 0) {
      const hydrated = hydrateIndecSeries(response.data);
      return res.json(hydrated);
    }

    const fallback = getFallbackIndecData(req.query);
    res.json(fallback);
  } catch (error) {
    console.warn('[INDEC] Upstream no responde o timeout, entregando fallback resiliente:', error.message);
    const fallback = getFallbackIndecData(req.query);
    res.json(fallback);
  }
});

// ==========================================
// 3. ENDPOINTS PROXY - MERCADO LIVE (Data912)
// ==========================================

// Cotizaciones de mercado en tiempo real (TTL: 30s)
app.get('/api/mercado/live/:tipo', cacheMiddleware('LIVE_MARKET'), async (req, res, next) => {
  const { tipo } = req.params;
  try {
    const response = await httpClient.get(`${DATA912_BASE}/${tipo}`, {
      timeout: httpClient.TIMEOUTS.LIVE_MARKET
    });
    res.json(response.data);
  } catch (error) {
    console.error(`[Data912] Error en live (${tipo}):`, error.message);
    const { status, body } = formatUpstreamError(error, `Error al obtener cotizaciones en vivo para ${tipo}`);
    res.status(status).json(body);
  }
});

// ==========================================
// 4. ENDPOINTS PROXY - BYMA (Bolsas y Mercados Argentinos)
// ==========================================

// Panel de bonos públicos con fallback persistente fuera de horario bursátil (TTL: 60s)
app.get('/api/byma/panel/public-bonds', cacheMiddleware(60), async (req, res, next) => {
  try {
    const response = await httpClient.post(
      `${BYMA_BASE}/public-bonds`,
      { page_size: 5000 },
      {
        timeout: httpClient.TIMEOUTS.LIVE_MARKET,
        headers: { 'Content-Type': 'application/json' }
      }
    );

    const bymaData = response.data;
    const hasActiveData = Array.isArray(bymaData?.data) && bymaData.data.length > 0;

    if (hasActiveData) {
      // Guardar el último panel válido en caché persistente para cuando el mercado esté cerrado
      cacheService.set(BYMA_FALLBACK_CACHE_KEY, bymaData, cacheService.TTL.FALLBACK_PERSISTENT);
      return res.json({
        ...bymaData,
        marketOpen: true
      });
    }

    // Si BYMA retorna data vacía (fuera de horario de mercado), servir el panel de contingencia
    const fallbackPanel = getFallbackBondsPanel();
    if (fallbackPanel && Array.isArray(fallbackPanel.data) && fallbackPanel.data.length > 0) {
      return res.json({
        ...fallbackPanel,
        marketOpen: false,
        isFallback: true,
        cached: true
      });
    }

    // Si no hay datos ni fallback previo, devolver la respuesta original de BYMA
    res.json({
      ...bymaData,
      marketOpen: false,
      isFallback: false
    });
  } catch (error) {
    console.warn('[BYMA] Error consultando panel de bonos en vivo:', error.message);

    // Intentar entregar panel en caché o snapshot persistente ante error upstream
    const fallbackPanel = getFallbackBondsPanel();
    if (fallbackPanel && Array.isArray(fallbackPanel.data) && fallbackPanel.data.length > 0) {
      return res.json({
        ...fallbackPanel,
        marketOpen: false,
        isFallback: true,
        cached: true
      });
    }

    const { status, body } = formatUpstreamError(error, 'Error al obtener panel de bonos de BYMA');
    res.status(status).json(body);
  }
});

// Ficha técnica de especie/bono (TTL: 60s)
app.get('/api/byma/bond-info/:symbol', cacheMiddleware(60), async (req, res, next) => {
  const { symbol } = req.params;
  const cleanSymbol = symbol ? symbol.replace(/\s+(24HS|CI|48HS|72HS)$/i, '').replace(/[DCXYZ]$/, '').trim() : '';

  try {
    const response = await httpClient.post(
      `${BYMA_BASE}/bnown/fichatecnica/especies/general`,
      { symbol: cleanSymbol },
      {
        timeout: httpClient.TIMEOUTS.LIVE_MARKET,
        headers: { 'Content-Type': 'application/json' }
      }
    );

    if (response.data && Array.isArray(response.data.data) && response.data.data.length > 0) {
      return res.json(response.data);
    }

    // Si responde vacío o sin datos, buscar en el snapshot persistente
    const bond = findFallbackBond(symbol, cleanSymbol);
    if (bond && bond.technicalSheet) {
      return res.json({
        content: { page_number: 1, page_count: 1, page_size: 50, total_elements_count: 1 },
        data: [bond.technicalSheet],
        empty: false,
        isFallback: true
      });
    }

    res.json(response.data);
  } catch (error) {
    console.warn(`[BYMA] Error en ficha técnica ${symbol}:`, error.message);

    // Entregar fallback del snapshot si existe
    const bond = findFallbackBond(symbol, cleanSymbol);
    if (bond && bond.technicalSheet) {
      return res.json({
        content: { page_number: 1, page_count: 1, page_size: 50, total_elements_count: 1 },
        data: [bond.technicalSheet],
        empty: false,
        isFallback: true
      });
    }

    const upstreamStatus = error.response?.status;
    const status = upstreamStatus === 400 ? 404 : (upstreamStatus || 502);
    res.status(status).json({
      error: true,
      status,
      message: `Error al obtener ficha técnica del bono ${symbol} de BYMA`,
      details: error.response?.data || error.message
    });
  }
});

// Histórico OHLCV de especie (TTL: 60s)
app.get('/api/byma/historico/:symbol', cacheMiddleware(60), async (req, res, next) => {
  const { symbol } = req.params;
  const nowUnix = Math.floor(Date.now() / 1000);
  const oneYearAgoUnix = nowUnix - (365 * 24 * 60 * 60);

  // Sanitizar símbolo: asegurar sufijo de liquidación bursátil requerido por el endpoint de BYMA si no está presente
  let bymaSymbol = symbol.trim();
  if (!/\s+(24HS|CI|48HS|72HS)$/i.test(bymaSymbol)) {
    bymaSymbol = `${bymaSymbol} 24HS`;
  }

  const params = {
    resolution: 'D',
    from: oneYearAgoUnix,
    to: nowUnix,
    ...req.query,
    symbol: bymaSymbol
  };

  try {
    const response = await httpClient.get(`${BYMA_BASE}/chart/historical-series/history`, {
      params,
      timeout: httpClient.TIMEOUTS.LIVE_MARKET
    });

    if (response.data && response.data.s === 'ok' && Array.isArray(response.data.c) && response.data.c.length > 0) {
      return res.json(response.data);
    }

    // Si BYMA responde 'no_data', consultar serie histórica persistente en snapshot
    const cleanSym = symbol.replace(/\s+(24HS|CI|48HS|72HS)$/i, '').trim();
    const bond = findFallbackBond(cleanSym, symbol);
    if (bond && bond.historicalSeries && Array.isArray(bond.historicalSeries.c) && bond.historicalSeries.c.length > 0) {
      return res.json({
        ...bond.historicalSeries,
        isFallback: true
      });
    }

    res.json(response.data);
  } catch (error) {
    console.warn(`[BYMA] Error en histórico ${symbol}:`, error.message);

    // Entregar fallback del snapshot si existe
    const cleanSym = symbol.replace(/\s+(24HS|CI|48HS|72HS)$/i, '').trim();
    const bond = findFallbackBond(cleanSym, symbol);
    if (bond && bond.historicalSeries && Array.isArray(bond.historicalSeries.c) && bond.historicalSeries.c.length > 0) {
      return res.json({
        ...bond.historicalSeries,
        isFallback: true
      });
    }

    const upstreamStatus = error.response?.status;
    const status = upstreamStatus === 400 ? 404 : (upstreamStatus || 502);
    res.status(status).json({
      error: true,
      status,
      message: `Error al obtener datos históricos de BYMA para ${symbol}`,
      details: error.response?.data || error.message
    });
  }
});

// Indicadores macro y de mercado de bonos (Riesgo País, Dólar MEP implícito y spreads) (TTL: 60s)
app.get('/api/byma/indicadores', cacheMiddleware(60), async (req, res, next) => {
  try {
    let riesgoPais = { valor: 490, fecha: new Date().toISOString().split('T')[0], var: 0 };
    try {
      const rpRes = await httpClient.get(`${ARGENTINADATOS_BASE}/finanzas/indices/riesgo-pais/ultimo`, {
        timeout: httpClient.TIMEOUTS.LIVE_MARKET
      });
      if (rpRes.data && rpRes.data.valor) {
        riesgoPais = rpRes.data;
      }
    } catch (e) {
      console.warn('[Indicadores Bonos] Error consultando Riesgo País:', e.message);
    }

    const panel = getFallbackBondsPanel();
    const bonds = panel?.data || [];
    const al30 = bonds.find(b => b.symbol === 'AL30');
    const al30d = bonds.find(b => b.symbol === 'AL30D');
    const gd30 = bonds.find(b => b.symbol === 'GD30');
    const gd30d = bonds.find(b => b.symbol === 'GD30D');

    const mepAl30 = (al30 && al30d && al30d.trade > 0) ? (al30.trade / al30d.trade) : 1525.39;
    const mepGd30 = (gd30 && gd30d && gd30d.trade > 0) ? (gd30.trade / gd30d.trade) : 1523.41;
    const spreadCanje = mepAl30 > 0 ? ((mepGd30 - mepAl30) / mepAl30 * 100) : 0;

    res.json({
      riesgoPais,
      mepAl30: Number(mepAl30.toFixed(2)),
      mepGd30: Number(mepGd30.toFixed(2)),
      spreadCanje: Number(spreadCanje.toFixed(2)),
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.warn('[Indicadores Bonos] Error general:', error.message);
    res.json({
      riesgoPais: { valor: 490, fecha: new Date().toISOString().split('T')[0] },
      mepAl30: 1525.39,
      mepGd30: 1523.41,
      spreadCanje: 0.13,
      timestamp: new Date().toISOString()
    });
  }
});

// ==========================================
// 5. PROXIES ADICIONALES - BCRA & MERCADO
// ==========================================

// Proxy para Estadísticas Cambiarias (Cotizaciones oficiales y divisas) (TTL: 30-60s)
app.use('/api/bcra-cambiarias', cacheMiddleware('LIVE_MARKET'), async (req, res, next) => {
  const targetUrl = `${BCRA_CAMBIARIAS_BASE}${req.path}`;
  try {
    const response = await httpClient.request({
      method: req.method,
      url: targetUrl,
      params: req.query,
      data: req.body,
      timeout: httpClient.TIMEOUTS.LIVE_MARKET
    });
    res.json(response.data);
  } catch (error) {
    console.warn(`[BCRA Cambiarias] Error en (${req.path}):`, error.message);
    const status = error.response?.status || 502;
    res.status(status).json({
      status,
      results: {
        fecha: new Date().toISOString().split('T')[0],
        detalle: []
      },
      error: true,
      message: 'No fue posible obtener las cotizaciones cambiarias del BCRA en este momento.'
    });
  }
});

// Proxy para Régimen de Transparencia (Plazos fijos, comisiones, préstamos) (TTL: 30m)
app.use('/api/bcra-transparencia', cacheMiddleware('TRANSPARENCY'), async (req, res, next) => {
  const targetUrl = `${BCRA_TRANSPARENCIA_BASE}${req.path}`;
  try {
    const response = await httpClient.request({
      method: req.method,
      url: targetUrl,
      params: req.query,
      data: req.body,
      timeout: httpClient.TIMEOUTS.HEAVY_SERIES
    });
    res.json(response.data);
  } catch (error) {
    console.warn(`[BCRA Transparencia] Error en (${req.path}):`, error.message);
    const status = error.response?.status || 502;
    res.status(status).json({
      status,
      results: [],
      error: true,
      message: 'No fue posible consultar el régimen de transparencia del BCRA.'
    });
  }
});

// ==========================================
// 4b. COMPARADOR DE PRÉSTAMOS HIPOTECARIOS UVA (BANCOS ARGENTINA)
// ==========================================

const HIPOTECARIOS_UVA_DATA = [
  {
    id: 'bna',
    entidad: 'Banco de la Nación Argentina (BNA)',
    linea: '+Hogares con BNA',
    tipo: 'Público Nacional',
    tnaClientes: 4.5,
    tnaClientesTexto: 'UVA + 4.50%',
    tnaNoClientes: 8.0,
    tnaNoClientesTexto: 'UVA + 8.00%',
    plazoMaxAnos: 30,
    plazoMaxMeses: 360,
    ltvMax: 75,
    montoMaximoTexto: 'Sin tope preestablecido (Aprox. hasta USD 250.000)',
    relacionCuotaIngreso: 25,
    destacado: 'Opción tope CVS (+1.5%) y hasta 30 años',
    antiguedadDependencia: '1 año de antigüedad continua (o 6 meses cobrando haberes en el BNA)',
    antiguedadIndependiente: '2 años en la misma actividad (Monotributo / Responsable Inscripto)',
    codeudores: 'Permite sumar hasta 2 codeudores familiares directos (cónyuge, conviviente, padres, hijos, hermanos)',
    edadLimite: 'Hasta 80 años cumplidos al momento del vencimiento de la última cuota',
    destinos: 'Adquisición de vivienda única y familiar, cambio de vivienda, refacción o ampliación',
    segurosYGastos: 'Seguro de vida bonificado para menores de 65 años; seguro contra incendio 0.05% s/tasación',
    sitioWeb: 'https://www.bna.com.ar'
  },
  {
    id: 'hipotecario',
    entidad: 'Banco Hipotecario',
    linea: 'Crédito Hipotecario UVA Tradicional y Construcción',
    tipo: 'Privado / Mixto',
    tnaClientes: 4.25,
    tnaClientesTexto: 'UVA + 4.25% (1er año, luego 8.50%)',
    tnaNoClientes: 8.5,
    tnaNoClientesTexto: 'UVA + 8.50%',
    plazoMaxAnos: 30,
    plazoMaxMeses: 360,
    ltvMax: 80,
    montoMaximoTexto: 'Hasta USD 250.000 (equivalente en pesos al desembolso)',
    relacionCuotaIngreso: 25,
    destacado: 'Tasa 4.25% primer año y hasta 80% LTV',
    antiguedadDependencia: '1 año en empleo registrado (6 meses si acredita sueldo en Banco Hipotecario)',
    antiguedadIndependiente: '2 años de actividad formal comprobable',
    codeudores: 'Permite sumar ingresos con cónyuge, concubino acreditado o padres',
    edadLimite: 'Hasta 75 años al momento de cancelación final',
    destinos: 'Adquisición de primera y segunda vivienda, construcción, terminación o refacción',
    segurosYGastos: 'Seguro de incendio bonificado con paquete de cuentas',
    sitioWeb: 'https://www.hipotecario.com.ar'
  },
  {
    id: 'ciudad',
    entidad: 'Banco Ciudad',
    linea: 'Hipotecario UVA Casa Propia & Desarrollo Zona Sur',
    tipo: 'Público CABA',
    tnaClientes: 3.5,
    tnaClientesTexto: 'UVA + 3.50% (Zona Sur) / 5.50% (General)',
    tnaNoClientes: 7.5,
    tnaNoClientesTexto: 'UVA + 7.50%',
    plazoMaxAnos: 20,
    plazoMaxMeses: 240,
    ltvMax: 75,
    montoMaximoTexto: 'Hasta $250.000.000 (Aprox. USD 200.000)',
    relacionCuotaIngreso: 25,
    destacado: 'Tasa más baja del mercado: UVA + 3.50% (Zona Sur CABA)',
    antiguedadDependencia: '1 año en relación de dependencia continua',
    antiguedadIndependiente: '1 año profesionales independientes / 2 años comerciantes y oficios',
    codeudores: 'Permite sumar ingresos familiares directos para ampliar la capacidad de pago',
    edadLimite: 'Hasta 75 años a la finalización del crédito',
    destinos: 'Adquisición de vivienda única familiar en CABA y Gran Buenos Aires',
    segurosYGastos: 'Sin comisiones de otorgamiento para primera vivienda',
    sitioWeb: 'https://www.bancociudad.com.ar'
  },
  {
    id: 'santander',
    entidad: 'Banco Santander Argentina',
    linea: 'Super Préstamo Hipotecario UVA Santander',
    tipo: 'Privado',
    tnaClientes: 5.5,
    tnaClientesTexto: 'UVA + 5.50%',
    tnaNoClientes: 7.5,
    tnaNoClientesTexto: 'UVA + 7.50%',
    plazoMaxAnos: 30,
    plazoMaxMeses: 360,
    ltvMax: 75,
    montoMaximoTexto: 'Sin tope de monto máximo (sujeto a score crediticio)',
    relacionCuotaIngreso: 25,
    destacado: 'Sin tope de monto y hasta 30 años de plazo',
    antiguedadDependencia: '6 meses cobrando haberes en Santander o 1 año continuo general',
    antiguedadIndependiente: '2 años de antigüedad en AFIP (Monotributo / RI)',
    codeudores: 'Permite sumar hasta 4 ingresos familiares (titular, cónyuge/conviviente y padres)',
    edadLimite: 'Hasta 75 años cumplidos al vencimiento de la última cuota',
    destinos: 'Compra de vivienda permanente o segunda residencia, terminación y refacción',
    segurosYGastos: 'Seguro de vida e incendio incluídos en la cuota mensual',
    sitioWeb: 'https://www.santander.com.ar'
  },
  {
    id: 'galicia',
    entidad: 'Banco Galicia',
    linea: 'Préstamos Hipotecarios UVA Galicia Casa Propia',
    tipo: 'Privado',
    tnaClientes: 5.5,
    tnaClientesTexto: 'UVA + 5.50%',
    tnaNoClientes: 7.5,
    tnaNoClientesTexto: 'UVA + 7.50%',
    plazoMaxAnos: 30,
    plazoMaxMeses: 360,
    ltvMax: 80,
    montoMaximoTexto: 'Sin tope de monto (determinado por ingresos demostrables)',
    relacionCuotaIngreso: 25,
    destacado: 'Hasta 80% financiación y preaprobación 100% digital',
    antiguedadDependencia: '1 año de antigüedad laboral en relación de dependencia',
    antiguedadIndependiente: '2 años en régimen simplificado o general',
    codeudores: 'Posibilidad de sumar ingresos con hasta 4 familiares directos',
    edadLimite: 'Hasta 75 años al momento de liquidar la última obligación',
    destinos: 'Compra de vivienda permanente o no permanente en todo el país',
    segurosYGastos: 'Bonificación total de gastos de tasación para clientes Eminent',
    sitioWeb: 'https://www.galicia.ar'
  },
  {
    id: 'bbva',
    entidad: 'Banco BBVA Argentina',
    linea: 'Préstamo Hipotecario BBVA UVA Hogar',
    tipo: 'Privado',
    tnaClientes: 6.5,
    tnaClientesTexto: 'UVA + 6.50%',
    tnaNoClientes: 9.5,
    tnaNoClientesTexto: 'UVA + 9.50%',
    plazoMaxAnos: 20,
    plazoMaxMeses: 240,
    ltvMax: 80,
    montoMaximoTexto: 'Sin tope máximo preestablecido',
    relacionCuotaIngreso: 25,
    destacado: 'Financiación hasta el 80% de tasación',
    antiguedadDependencia: '1 año laboral registrado en la empresa actual',
    antiguedadIndependiente: '2 años como trabajador independiente o profesional',
    codeudores: 'Permite sumar ingresos entre cónyuges o convivientes registrados',
    edadLimite: 'Hasta 75 años al cancelar el préstamo',
    destinos: 'Adquisición de vivienda permanente y segunda vivienda',
    segurosYGastos: 'Seguro colectivo de saldos deudores sin recargo por edad hasta 65 años',
    sitioWeb: 'https://www.bbva.com.ar'
  },
  {
    id: 'macro',
    entidad: 'Banco Macro',
    linea: 'Tu Casa Macro - Hipotecario UVA',
    tipo: 'Privado',
    tnaClientes: 5.5,
    tnaClientesTexto: 'UVA + 5.50%',
    tnaNoClientes: 8.5,
    tnaNoClientesTexto: 'UVA + 8.50%',
    plazoMaxAnos: 20,
    plazoMaxMeses: 240,
    ltvMax: 75,
    montoMaximoTexto: 'Sin tope preestablecido',
    relacionCuotaIngreso: 25,
    destacado: 'Cuota/ingreso hasta 30% en segmento Selecta',
    antiguedadDependencia: '12 meses continuos de empleo en blanco',
    antiguedadIndependiente: '2 años de actividad económica ininterrumpida',
    codeudores: 'Permite sumar ingresos con cónyuge o concubino formalmente acreditado',
    edadLimite: 'Hasta 75 años al término del crédito',
    destinos: 'Adquisición de vivienda familiar, ampliación o refacción integral',
    segurosYGastos: 'Coberturas de seguro patrimonial a través de Macro Broker',
    sitioWeb: 'https://www.macro.com.ar'
  },
  {
    id: 'bancor',
    entidad: 'Banco de la Provincia de Córdoba (Bancor)',
    linea: 'Hipotecario Casa Bancor UVA 100%',
    tipo: 'Público Provincial',
    tnaClientes: 4.9,
    tnaClientesTexto: 'UVA + 4.90%',
    tnaNoClientes: 7.9,
    tnaNoClientesTexto: 'UVA + 7.90%',
    plazoMaxAnos: 20,
    plazoMaxMeses: 240,
    ltvMax: 100,
    montoMaximoTexto: 'Hasta $120.000.000 (Aprox. USD 100.000)',
    relacionCuotaIngreso: 25,
    destacado: 'Único banco con financiación hasta el 100% (con seguro de caución)',
    antiguedadDependencia: '1 año de antigüedad comprobada',
    antiguedadIndependiente: '1 año para profesionales, 2 años comerciantes',
    codeudores: 'Acepta suma de ingresos con grupo familiar conviviente',
    edadLimite: 'Hasta 75 años a la fecha de finalización',
    destinos: 'Adquisición, construcción o ampliación de vivienda en Córdoba',
    segurosYGastos: 'Convenio con seguros de caución para financiar el 20% no tradicional',
    sitioWeb: 'https://www.bancor.com.ar'
  },
  {
    id: 'credicoop',
    entidad: 'Banco Credicoop Cooperativo Limitado',
    linea: 'Hipotecario Cooperativo UVA Soluciones Habitacionales',
    tipo: 'Cooperativo',
    tnaClientes: 5.5,
    tnaClientesTexto: 'UVA + 5.50%',
    tnaNoClientes: 7.5,
    tnaNoClientesTexto: 'UVA + 7.50%',
    plazoMaxAnos: 20,
    plazoMaxMeses: 240,
    ltvMax: 70,
    montoMaximoTexto: 'Hasta $200.000.000',
    relacionCuotaIngreso: 30,
    destacado: 'Relación cuota/ingreso más flexible (30%)',
    antiguedadDependencia: '1 año de antigüedad registrada continua',
    antiguedadIndependiente: '2 años en el ejercicio de la profesión u oficio',
    codeudores: 'Permite co-titulares familiares (cónyuge, padres o hijos)',
    edadLimite: 'Hasta 75 años al finalizar el plazo convenido',
    destinos: 'Vivienda única, permanente y de ocupación propia',
    segurosYGastos: 'Tarifas cooperativas en comisiones de tasación y estudio de títulos',
    sitioWeb: 'https://www.bancocredicoop.coop'
  },
  {
    id: 'comafi',
    entidad: 'Banco Comafi',
    linea: 'Préstamos Hipotecarios UVA Comafi Mi Casa',
    tipo: 'Privado',
    tnaClientes: 6.0,
    tnaClientesTexto: 'UVA + 6.00%',
    tnaNoClientes: 9.0,
    tnaNoClientesTexto: 'UVA + 9.00%',
    plazoMaxAnos: 20,
    plazoMaxMeses: 240,
    ltvMax: 75,
    montoMaximoTexto: 'Sin tope de monto predeterminado',
    relacionCuotaIngreso: 25,
    destacado: 'Sin tope y aprobación ágil para clientes con sueldo',
    antiguedadDependencia: '1 año de antigüedad laboral en relación de dependencia',
    antiguedadIndependiente: '2 años para trabajadores independientes y profesionales',
    codeudores: 'Se pueden sumar ingresos con cónyuge o conviviente',
    edadLimite: 'Hasta 75 años al cancelar la deuda',
    destinos: 'Adquisición de vivienda permanente o segunda vivienda',
    segurosYGastos: 'Seguro sobre saldo deudor y seguro de incendio',
    sitioWeb: 'https://www.comafi.com.ar'
  }
];

app.get('/api/transparencia/hipotecarios', cacheMiddleware('TRANSPARENCY'), (req, res) => {
  res.json({
    status: 200,
    timestamp: new Date().toISOString(),
    totalEntidades: HIPOTECARIOS_UVA_DATA.length,
    valorUvaReferencia: 2196.12,
    results: HIPOTECARIOS_UVA_DATA
  });
});

// Proxy para Central de Deudores con normalización de HTTP 404 a situación limpia (TTL: 5m)
app.use('/api/bcra-deudores', cacheMiddleware('IDENTIFIER_QUERY'), async (req, res, next) => {
  const isChequesRechazados = req.path.includes('/ChequesRechazados');
  const pathParts = req.path.split('/').filter(Boolean);
  const rawIdentifier = pathParts[pathParts.length - 1] || '0';
  let decodedIdentifier = '';
  try {
    decodedIdentifier = decodeURIComponent(rawIdentifier).trim();
  } catch {
    decodedIdentifier = rawIdentifier.trim();
  }

  // Validación temprana de caracteres inválidos (emojis, letras, símbolos que no sean guiones o espacios)
  if (/[^0-9\s\-]/.test(decodedIdentifier)) {
    return res.status(400).json({
      status: 400,
      results: {
        identificacion: decodedIdentifier,
        tieneDeuda: false,
        peorSituacion: 1,
        entidades: [],
        chequesRechazados: []
      },
      error: true,
      message: 'La identificación o CUIT ingresado contiene caracteres inválidos.'
    });
  }

  const cleanDigits = decodedIdentifier.replace(/\D/g, '');
  const isStandardCuit = cleanDigits.length === 11;
  const targetUrl = `${BCRA_DEUDORES_BASE}${req.path}`;

  try {
    const response = await httpClient.request({
      method: req.method,
      url: targetUrl,
      params: req.query,
      data: req.body,
      timeout: httpClient.TIMEOUTS.HEAVY_SERIES
    });
    res.json(response.data);
  } catch (error) {
    const upstreamStatus = error.response?.status;

    // Normalización de 404 del BCRA ("No se encontró datos" = situación impecable sin deuda / sin cheques)
    if (upstreamStatus === 404) {
      if (isChequesRechazados) {
        return res.json({
          status: 200,
          results: {
            identificacion: Number(cleanDigits) || decodedIdentifier,
            denominacion: "SIN CHEQUES RECHAZADOS",
            chequesRechazados: [],
            tieneChequesRechazados: false,
            mensaje: "No se registran cheques rechazados para la identificación ingresada."
          }
        });
      }

      // Consulta de Deudas regular o histórica (404 significa que no registra deudas en la base del BCRA)
      return res.json({
        status: 200,
        results: {
          identificacion: Number(cleanDigits) || decodedIdentifier,
          denominacion: "SIN DEUDAS REGISTRADAS (SITUACIÓN 1)",
          periodos: [],
          tieneDeuda: false,
          peorSituacion: 1,
          situacion: 1,
          totalDeuda: 0,
          entidades: [],
          chequesRechazados: [],
          mensaje: "No se registran deudas en el sistema financiero (Situación 1 Normal)."
        }
      });
    }

    console.warn(`[BCRA Deudores] Error en (${req.path}):`, error.message);
    const status = (!isStandardCuit && (upstreamStatus === 400 || upstreamStatus === 429 || upstreamStatus === 502 || !upstreamStatus)) ? 400 : (upstreamStatus || 502);
    res.status(status).json({
      status,
      results: {
        identificacion: Number(cleanDigits) || decodedIdentifier,
        tieneDeuda: false,
        peorSituacion: 1,
        entidades: [],
        chequesRechazados: []
      },
      error: true,
      message: error.response?.data?.errorMessages?.[0] || 'Error al consultar la Central de Deudores del BCRA.'
    });
  }
});

// Proxy para Cheques Denunciados con normalización de 404 (TTL: 5m)
app.use('/api/bcra-cheques', cacheMiddleware('IDENTIFIER_QUERY'), async (req, res, next) => {
  const targetUrl = `${BCRA_CHEQUES_BASE}${req.path}`;
  try {
    const response = await httpClient.request({
      method: req.method,
      url: targetUrl,
      params: req.query,
      data: req.body,
      timeout: httpClient.TIMEOUTS.HEAVY_SERIES
    });
    res.json(response.data);
  } catch (error) {
    const upstreamStatus = error.response?.status;
    const pathParts = req.path.split('/').filter(Boolean);
    const numeroCheque = pathParts[pathParts.length - 1] || '0';

    // Normalización de 404 del BCRA ("Sin denuncia de extravío o robo")
    if (upstreamStatus === 404) {
      return res.json({
        status: 200,
        results: {
          numeroCheque: Number(numeroCheque) || numeroCheque,
          denunciado: false,
          causal: null,
          mensaje: "El cheque no registra denuncia por extravío, robo o adulteración."
        }
      });
    }

    console.warn(`[BCRA Cheques] Error en (${req.path}):`, error.message);
    const status = upstreamStatus || 502;
    res.status(status).json({
      status,
      results: {
        numeroCheque: Number(numeroCheque) || numeroCheque,
        denunciado: false,
        causal: null
      },
      error: true,
      message: error.response?.data?.errorMessages?.[0] || 'Error al consultar cheques denunciados en el BCRA.'
    });
  }
});

// Proxy para DolarApi (Cotizaciones de dólares y divisas en vivo) (TTL: 30s)
app.use('/api/mercado-dolarapi', cacheMiddleware('LIVE_MARKET'), async (req, res, next) => {
  const targetUrl = `${DOLARAPI_BASE}${req.path}`;
  try {
    const response = await httpClient.request({
      method: req.method,
      url: targetUrl,
      params: req.query,
      data: req.body,
      timeout: httpClient.TIMEOUTS.LIVE_MARKET
    });
    res.json(response.data);
  } catch (error) {
    console.warn(`[DolarApi] Error en (${req.path}):`, error.message);
    const { status, body } = formatUpstreamError(error, 'Error al consultar cotizaciones de DolarApi');
    res.status(status).json(body);
  }
});

// Proxy para ArgentinaDatos (Series históricas de inflación, dólar, UVA, tasas) (TTL: 1h)
app.use('/api/argentinadatos', cacheMiddleware('HISTORICAL_SERIES'), async (req, res, next) => {
  const targetUrl = `${ARGENTINADATOS_BASE}${req.path}`;
  try {
    const response = await httpClient.request({
      method: req.method,
      url: targetUrl,
      params: req.query,
      data: req.body,
      timeout: httpClient.TIMEOUTS.HEAVY_SERIES
    });
    res.json(response.data);
  } catch (error) {
    console.warn(`[ArgentinaDatos] Error en (${req.path}):`, error.message);
    const { status, body } = formatUpstreamError(error, 'Error al consultar series históricas de ArgentinaDatos');
    res.status(status).json(body);
  }
});

// ==========================================
// 6. ENDPOINTS PROXY - CRIPTOYA Y RENDIMIENTOS FINTECH
// ==========================================

// Cotizaciones de tipos de dólar (oficial, blue, mep, ccl, cripto, tarjeta, mayorista) y brechas (TTL: 30s)
app.get('/api/criptoya/dolar', cacheMiddleware('LIVE_MARKET'), async (req, res) => {
  try {
    const response = await httpClient.get(`${CRIPTOYA_BASE}/dolar`, {
      timeout: httpClient.TIMEOUTS.LIVE_MARKET
    });

    const normalized = schemaValidator.normalizeDolarData(response.data);

    // Almacenar snapshot válido para contingencias
    cacheService.set(CRIPTOYA_FALLBACK_DOLAR_KEY, normalized, cacheService.TTL.FALLBACK_PERSISTENT);

    res.json({
      status: 200,
      results: normalized,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.warn('[CriptoYa Dólar] Error al consultar cotizaciones:', error.message);
    const snapshot = cacheService.get(CRIPTOYA_FALLBACK_DOLAR_KEY);

    if (snapshot) {
      return res.json({
        status: 200,
        results: snapshot,
        isFallback: true,
        cached: true,
        message: 'Cotizaciones servidas desde snapshot de contingencia por indisponibilidad de CriptoYa.',
        timestamp: new Date().toISOString()
      });
    }

    const fallbackData = schemaValidator.normalizeDolarData({});
    res.status(502).json({
      status: 502,
      error: true,
      isFallback: true,
      results: fallbackData,
      message: 'No fue posible obtener cotizaciones de dólar de CriptoYa y no hay snapshot previo disponible.',
      timestamp: new Date().toISOString()
    });
  }
});

// Cotizaciones de criptomonedas por exchange y detección de mejor arbitraje (TTL: 30s)
app.get('/api/criptoya/cripto/:coin?/:fiat?', cacheMiddleware('LIVE_MARKET'), async (req, res) => {
  const coin = (req.params.coin || 'usdt').toLowerCase();
  const fiat = (req.params.fiat || 'ars').toLowerCase();
  const pair = `${coin}/${fiat}`.toUpperCase();
  const fallbackKey = `criptoya:last_valid_cripto:${coin}:${fiat}`;

  try {
    const response = await httpClient.get(`${CRIPTOYA_BASE}/${coin}/${fiat}`, {
      timeout: httpClient.TIMEOUTS.LIVE_MARKET
    });

    const normalized = schemaValidator.normalizeCriptoData(response.data, pair);

    // Almacenar snapshot de contingencia
    cacheService.set(fallbackKey, normalized, cacheService.TTL.FALLBACK_PERSISTENT);

    res.json({
      status: 200,
      pair: normalized.pair,
      results: normalized.results,
      arbitraje: normalized.arbitraje,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.warn(`[CriptoYa Cripto] Error al consultar par (${pair}):`, error.message);
    const snapshot = cacheService.get(fallbackKey);

    if (snapshot) {
      return res.json({
        status: 200,
        pair: snapshot.pair || pair,
        results: snapshot.results || [],
        arbitraje: snapshot.arbitraje || { mejorCompra: null, mejorVenta: null, spreadPorcentaje: 0, oportunidad: false },
        isFallback: true,
        cached: true,
        message: `Cotizaciones de ${pair} servidas desde snapshot de contingencia.`,
        timestamp: new Date().toISOString()
      });
    }

    const fallbackData = schemaValidator.normalizeCriptoData({}, pair);
    res.status(502).json({
      status: 502,
      error: true,
      isFallback: true,
      pair,
      results: fallbackData.results,
      arbitraje: fallbackData.arbitraje,
      message: `No fue posible obtener cotizaciones de ${pair} de CriptoYa.`,
      timestamp: new Date().toISOString()
    });
  }
});

// Cotizaciones de dólar minorista por banco y promedios generales (TTL: 60s)
app.get('/api/criptoya/bancos', cacheMiddleware(cacheService.TTL.BANCOS), async (req, res) => {
  try {
    const response = await httpClient.get(`${CRIPTOYA_BASE}/bancostodos`, {
      timeout: httpClient.TIMEOUTS.LIVE_MARKET
    });

    const normalized = schemaValidator.normalizeBancosData(response.data);

    // Almacenar snapshot de contingencia
    cacheService.set(CRIPTOYA_FALLBACK_BANCOS_KEY, normalized, cacheService.TTL.FALLBACK_PERSISTENT);

    res.json({
      status: 200,
      results: normalized.results,
      promedio: normalized.promedio,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.warn('[CriptoYa Bancos] Error al consultar cotizaciones bancarias:', error.message);
    const snapshot = cacheService.get(CRIPTOYA_FALLBACK_BANCOS_KEY);

    if (snapshot) {
      return res.json({
        status: 200,
        results: snapshot.results || [],
        promedio: snapshot.promedio || { compra: 0, venta: 0 },
        isFallback: true,
        cached: true,
        message: 'Cotizaciones bancarias servidas desde snapshot de contingencia.',
        timestamp: new Date().toISOString()
      });
    }

    const fallbackData = schemaValidator.normalizeBancosData({});
    res.status(502).json({
      status: 502,
      error: true,
      isFallback: true,
      results: fallbackData.results,
      promedio: fallbackData.promedio,
      message: 'No fue posible obtener cotizaciones bancarias de CriptoYa.',
      timestamp: new Date().toISOString()
    });
  }
});

// Rendimientos APY y mensuales de cuentas remuneradas fintech y stablecoins (TTL: 30m / 1800s)
app.get('/api/finanzas/rendimientos', cacheMiddleware('TRANSPARENCY'), async (req, res) => {
  const monedaFilter = req.query.moneda ? String(req.query.moneda).trim().toUpperCase() : null;
  const fallbackKey = monedaFilter
    ? `${FINANZAS_FALLBACK_RENDIMIENTOS_KEY}:${monedaFilter}`
    : FINANZAS_FALLBACK_RENDIMIENTOS_KEY;

  try {
    const response = await httpClient.get(`${ARGENTINADATOS_BASE}/finanzas/rendimientos`, {
      timeout: httpClient.TIMEOUTS.STANDARD
    });

    const normalized = schemaValidator.normalizeRendimientosData(response.data, monedaFilter);

    // Guardar snapshot de contingencia
    cacheService.set(fallbackKey, normalized, cacheService.TTL.FALLBACK_PERSISTENT);

    res.json({
      status: 200,
      moneda: monedaFilter || 'TODAS',
      results: normalized,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.warn('[Finanzas Rendimientos] Error al consultar rendimientos:', error.message);
    const snapshot = cacheService.get(fallbackKey);

    if (snapshot) {
      return res.json({
        status: 200,
        moneda: monedaFilter || 'TODAS',
        results: snapshot,
        isFallback: true,
        cached: true,
        message: 'Rendimientos servidos desde snapshot de contingencia por indisponibilidad de ArgentinaDatos.',
        timestamp: new Date().toISOString()
      });
    }

    res.status(502).json({
      status: 502,
      error: true,
      isFallback: true,
      moneda: monedaFilter || 'TODAS',
      results: [],
      message: 'No fue posible obtener rendimientos de billeteras fintech de ArgentinaDatos.',
      timestamp: new Date().toISOString()
    });
  }
});

// Indicadores diarios UVA y CER consolidados concurrentemente (TTL: 1h / 3600s)
app.get('/api/criptoya/indicadores', cacheMiddleware(cacheService.TTL.INDICADORES), async (req, res) => {
  try {
    const [uvaSettled, cerSettled] = await Promise.allSettled([
      httpClient.get(`${CRIPTOYA_BASE}/uva`, { timeout: httpClient.TIMEOUTS.LIVE_MARKET }),
      httpClient.get(`${CRIPTOYA_BASE}/cer`, { timeout: httpClient.TIMEOUTS.LIVE_MARKET })
    ]);

    const snapshot = cacheService.get(CRIPTOYA_FALLBACK_INDICADORES_KEY) || {};

    let uvaRaw = uvaSettled.status === 'fulfilled' ? uvaSettled.value.data : null;
    let cerRaw = cerSettled.status === 'fulfilled' ? cerSettled.value.data : null;

    // Si falló alguno, intentar rescatar del snapshot previo
    if (!uvaRaw && snapshot.uva && snapshot.uva.valor > 0) {
      uvaRaw = { value: snapshot.uva.valor, time: snapshot.uva.timestamp };
    }
    if (!cerRaw && snapshot.cer && snapshot.cer.valor > 0) {
      cerRaw = { value: snapshot.cer.valor, time: snapshot.cer.timestamp };
    }

    // Si ambos fallaron y no hay snapshot
    if (!uvaRaw && !cerRaw) {
      throw new Error('Fallaron las consultas a UVA y CER en CriptoYa');
    }

    const normalized = schemaValidator.normalizeIndicadoresData(uvaRaw, cerRaw);

    // Guardar snapshot de contingencia
    cacheService.set(CRIPTOYA_FALLBACK_INDICADORES_KEY, normalized, cacheService.TTL.FALLBACK_PERSISTENT);

    res.json({
      status: 200,
      results: normalized,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.warn('[CriptoYa Indicadores] Error al consultar UVA/CER:', error.message);
    const snapshot = cacheService.get(CRIPTOYA_FALLBACK_INDICADORES_KEY);

    if (snapshot) {
      return res.json({
        status: 200,
        results: snapshot,
        isFallback: true,
        cached: true,
        message: 'Indicadores servidos desde snapshot de contingencia por indisponibilidad de CriptoYa.',
        timestamp: new Date().toISOString()
      });
    }

    const fallbackData = schemaValidator.normalizeIndicadoresData({}, {});
    res.status(502).json({
      status: 502,
      error: true,
      isFallback: true,
      results: fallbackData,
      message: 'No fue posible obtener indicadores UVA/CER de CriptoYa.',
      timestamp: new Date().toISOString()
    });
  }
});

// ==========================================
// 7. ENDPOINTS DE ESTADO Y MÉTRICAS
// ==========================================

// Healthcheck general
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    uptimeSeconds: process.uptime(),
    timestamp: new Date().toISOString(),
    cacheStats: cacheService.getStats()
  });
});

// Métricas de la caché
app.get('/api/cache/stats', (req, res) => {
  res.json(cacheService.getStats());
});

// ==========================================
// 8. MANEJO DE ERRORES Y SPA FALLBACK
// ==========================================

// Redirigir cualquier otra ruta no encontrada a la SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Middleware de error global
app.use(errorHandler);

// Iniciar el servidor local si se ejecuta directamente
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`==================================================`);
    console.log(` Servidor Proxy Financiero Optimizado en puerto: ${PORT}`);
    console.log(` URL Local: http://localhost:${PORT}`);
    console.log(` Caché en memoria: ACTIVA con TTL granular`);
    console.log(` Compresión Gzip/Deflate: ACTIVA`);
    console.log(`==================================================`);
  });
}

module.exports = app;
