/**
 * server.js
 * Servidor Proxy Financiero y Orquestador de APIs para bcra-monetarias
 */

const express = require('express');
const cors = require('cors');
const compression = require('compression');
const path = require('path');

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

// Servir archivos estáticos del frontend
app.use(express.static(path.join(__dirname, 'public')));

// Base URLs de proveedores externos
const BCRA_MONETARIAS_BASE = 'https://api.bcra.gob.ar/estadisticas/v4.0';
const BCRA_CAMBIARIAS_BASE = 'https://api.bcra.gob.ar/estadisticascambiarias/v1.0';
const BCRA_TRANSPARENCIA_BASE = 'https://api.bcra.gob.ar/transparencia/v1.0';
const BCRA_DEUDORES_BASE = 'https://api.bcra.gob.ar/centraldedeudores/v1.0';
const BCRA_CHEQUES_BASE = 'https://api.bcra.gob.ar/cheques/v1.0';
const INDEC_SERIES_BASE = 'https://apis.datos.gob.ar/series/api/series';
const DATA912_BASE = 'https://data912.com/live';
const BYMA_BASE = 'https://open.bymadata.com.ar/vanoms-be-core/rest/api/bymadata/free';
const DOLARAPI_BASE = 'https://dolarapi.com/v1';
const ARGENTINADATOS_BASE = 'https://api.argentinadatos.com/v1';
const CRIPTOYA_BASE = 'https://criptoya.com/api';

// Claves para persistencia de fallback de paneles y contingencias fuera de horario
const BYMA_FALLBACK_CACHE_KEY = 'byma:last_valid_panel';
const CRIPTOYA_FALLBACK_DOLAR_KEY = 'criptoya:last_valid_dolar';
const CRIPTOYA_FALLBACK_BANCOS_KEY = 'criptoya:last_valid_bancos';
const CRIPTOYA_FALLBACK_INDICADORES_KEY = 'criptoya:last_valid_indicadores';
const FINANZAS_FALLBACK_RENDIMIENTOS_KEY = 'finanzas:last_valid_rendimientos';

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
          // Ordenar cronológicamente (de más antiguo a más reciente)
          item.detalle.sort((a, b) => (a.fecha || '').localeCompare(b.fecha || ''));
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

// Series macroeconómicas de INDEC (TTL: 1h)
app.get('/api/indec/series', cacheMiddleware('HISTORICAL_SERIES'), async (req, res, next) => {
  try {
    const response = await httpClient.get(INDEC_SERIES_BASE, {
      params: req.query,
      timeout: httpClient.TIMEOUTS.HEAVY_SERIES
    });
    res.json(response.data);
  } catch (error) {
    console.error('[INDEC] Error en series:', error.message);
    const { status, body } = formatUpstreamError(error, 'Error al obtener datos de series de INDEC');
    res.status(status).json(body);
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

    // Si BYMA retorna data vacía (fuera de horario de mercado), intentar servir el último panel guardado
    const cachedPanel = cacheService.get(BYMA_FALLBACK_CACHE_KEY);
    if (cachedPanel && Array.isArray(cachedPanel.data) && cachedPanel.data.length > 0) {
      console.log('[BYMA] Mercado cerrado o sin operaciones activas. Entregando último panel válido en caché.');
      return res.json({
        ...cachedPanel,
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

    // Intentar entregar panel en caché ante error upstream
    const cachedPanel = cacheService.get(BYMA_FALLBACK_CACHE_KEY);
    if (cachedPanel && Array.isArray(cachedPanel.data) && cachedPanel.data.length > 0) {
      console.log('[BYMA] Error upstream. Entregando último panel de contingencia en caché.');
      return res.json({
        ...cachedPanel,
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
  // Sanitizar símbolo: remover sufijos como ' 24HS', 'D', 'C' si es necesario
  const cleanSymbol = symbol ? symbol.replace(/\s+(24HS|CI|48HS|72HS)$/i, '').trim() : '';

  try {
    const response = await httpClient.post(
      `${BYMA_BASE}/bnown/fichatecnica/especies/general`,
      { symbol: cleanSymbol },
      {
        timeout: httpClient.TIMEOUTS.LIVE_MARKET,
        headers: { 'Content-Type': 'application/json' }
      }
    );
    res.json(response.data);
  } catch (error) {
    console.error(`[BYMA] Error en ficha técnica ${symbol}:`, error.message);
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

  const params = {
    resolution: 'D',
    from: oneYearAgoUnix,
    to: nowUnix,
    ...req.query,
    symbol
  };

  try {
    const response = await httpClient.get(`${BYMA_BASE}/chart/historical-series/history`, {
      params,
      timeout: httpClient.TIMEOUTS.LIVE_MARKET
    });
    res.json(response.data);
  } catch (error) {
    console.error(`[BYMA] Error en histórico ${symbol}:`, error.message);
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

// Proxy para Central de Deudores con normalización de HTTP 404 a situación limpia (TTL: 5m)
app.use('/api/bcra-deudores', cacheMiddleware('IDENTIFIER_QUERY'), async (req, res, next) => {
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
    const isChequesRechazados = req.path.includes('/ChequesRechazados');
    const pathParts = req.path.split('/').filter(Boolean);
    const identifier = pathParts[pathParts.length - 1] || '0';

    // Normalización de 404 del BCRA ("No se encontró datos" = situación impecable sin deuda / sin cheques)
    if (upstreamStatus === 404) {
      if (isChequesRechazados) {
        return res.json({
          status: 200,
          results: {
            identificacion: Number(identifier) || identifier,
            denominacion: "CONTRIBUYENTE CONSULTADO",
            chequesRechazados: [],
            tieneChequesRechazados: false,
            mensaje: "No se registran cheques rechazados para la identificación ingresada."
          }
        });
      }

      // Consulta de Deudas regular o histórica
      return res.json({
        status: 200,
        results: {
          identificacion: Number(identifier) || identifier,
          denominacion: "CONTRIBUYENTE CONSULTADO",
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
    const status = upstreamStatus || 502;
    res.status(status).json({
      status,
      results: {
        identificacion: Number(identifier) || identifier,
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
app.get('/api/criptoya/bancos', cacheMiddleware(60), async (req, res) => {
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
app.get('/api/criptoya/indicadores', cacheMiddleware(3600), async (req, res) => {
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
