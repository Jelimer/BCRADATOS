/**
 * services/httpClient.js
 * Cliente HTTP unificado con timeouts diferenciados, reintentos con exponential backoff
 * y agente HTTPS inseguro aislado exclusivamente para BYMA.
 */

const axios = require('axios');
const https = require('https');

// Agente HTTPS dedicado con rechazo SSL desactivado ÚNICAMENTE para el host de BYMA
const bymaHttpsAgent = new https.Agent({
  rejectUnauthorized: false,
  keepAlive: true
});

// Agente HTTPS seguro por defecto para el resto de los proveedores
const secureHttpsAgent = new https.Agent({
  rejectUnauthorized: true,
  keepAlive: true
});

// Constantes de Timeouts en milisegundos
const TIMEOUTS = {
  LIVE_MARKET: 5000,    // 5 segundos para cotizaciones en vivo y mercado rápido
  STANDARD: 10000,      // 10 segundos por defecto
  HEAVY_SERIES: 15000   // 15 segundos para series históricas pesadas (INDEC, BCRA, ArgentinaDatos)
};

// Encabezados HTTP estándar para emular cliente navegador y prevenir bloqueos
const DEFAULT_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8'
};

/**
 * Determina si una URL pertenece al dominio de BYMA.
 * @param {string} url 
 * @returns {boolean}
 */
function isBymaUrl(url) {
  if (!url) return false;
  return url.includes('open.bymadata.com.ar') || url.includes('bymadata.com.ar');
}

/**
 * Determina si una URL apunta a loopback local (localhost, 127.0.0.1, ::1).
 * @param {string} url 
 * @returns {boolean}
 */
function isLoopbackUrl(url) {
  if (!url) return false;
  try {
    const hasScheme = /^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(url);
    if (!hasScheme) {
      return url.includes('localhost') || url.includes('127.0.0.1') || url.includes('::1');
    }
    const parsed = new URL(url);
    const hostname = parsed.hostname.replace(/^\[|\]$/g, '');
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
  } catch {
    return url.includes('localhost') || url.includes('127.0.0.1') || url.includes('::1');
  }
}

/**
 * Determina si un error es transitorio y califica para reintento automático.
 * @param {any} error 
 * @returns {boolean}
 */
function isRetryableError(error) {
  if (!error) return false;

  // Errores de red o timeout
  if (error.code) {
    const retryableCodes = ['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ERR_NETWORK'];
    if (retryableCodes.includes(error.code)) {
      return true;
    }
  }

  // Timeout de Axios
  if (error.message && (error.message.includes('timeout') || error.message.includes('socket hang up'))) {
    return true;
  }

  // Errores de servidor upstream transitorios (429 Too Many Requests, 502 Bad Gateway, 503 Service Unavailable, 504 Gateway Timeout)
  if (error.response && [429, 502, 503, 504].includes(error.response.status)) {
    return true;
  }

  return false;
}

/**
 * Pausa la ejecución por el tiempo indicado en ms.
 * @param {number} ms 
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Ejecuta una petición HTTP con reintentos y backoff exponencial.
 * @param {import('axios').AxiosRequestConfig} config 
 * @param {Object} [options]
 * @param {number} [options.retries=1] Cantidad de reintentos
 * @param {number} [options.initialDelayMs=300] Demora inicial en ms
 * @param {number} [options.backoffFactor=2] Factor multiplicador de retardo
 * @returns {Promise<import('axios').AxiosResponse>}
 */
async function executeRequest(config, options = {}) {
  const maxRetries = typeof options.retries === 'number' ? options.retries : 1;
  const initialDelay = options.initialDelayMs || 300;
  const factor = options.backoffFactor || 2;

  // Asignar agente HTTPS aislado solo para BYMA
  const fullUrl = (config.baseURL ? config.baseURL + (config.url || '') : config.url) || '';
  const isByma = isBymaUrl(fullUrl);
  const isLoopback = isLoopbackUrl(fullUrl);

  const requestConfig = {
    ...config,
    headers: {
      ...DEFAULT_HEADERS,
      ...(config.headers || {})
    },
    httpsAgent: isByma ? bymaHttpsAgent : (config.httpsAgent || secureHttpsAgent),
    timeout: config.timeout || TIMEOUTS.STANDARD,
    ...(isLoopback ? { proxy: false } : {})
  };

  let attempt = 0;
  let lastError;

  while (attempt <= maxRetries) {
    try {
      const response = await axios(requestConfig);
      return response;
    } catch (err) {
      lastError = err;
      attempt++;

      if (attempt <= maxRetries && isRetryableError(err)) {
        // Calcular demora con backoff exponencial y jitter aleatorio (10-50ms)
        const delay = initialDelay * Math.pow(factor, attempt - 1) + Math.floor(Math.random() * 50);
        console.warn(`[httpClient] Reintento ${attempt}/${maxRetries} para ${fullUrl} tras error (${err.message}). Esperando ${delay}ms...`);
        await sleep(delay);
      } else {
        break;
      }
    }
  }

  throw lastError;
}

const httpClient = {
  TIMEOUTS,

  /**
   * Realiza una petición GET.
   * @param {string} url 
   * @param {import('axios').AxiosRequestConfig} [config] 
   * @param {Object} [options] 
   * @returns {Promise<import('axios').AxiosResponse>}
   */
  get(url, config = {}, options = {}) {
    return executeRequest({ ...config, method: 'GET', url }, options);
  },

  /**
   * Realiza una petición POST.
   * @param {string} url 
   * @param {any} [data] 
   * @param {import('axios').AxiosRequestConfig} [config] 
   * @param {Object} [options] 
   * @returns {Promise<import('axios').AxiosResponse>}
   */
  post(url, data = {}, config = {}, options = {}) {
    return executeRequest({ ...config, method: 'POST', url, data }, options);
  },

  /**
   * Realiza una petición genérica.
   * @param {import('axios').AxiosRequestConfig} config 
   * @param {Object} [options] 
   * @returns {Promise<import('axios').AxiosResponse>}
   */
  request(config, options = {}) {
    return executeRequest(config, options);
  },

  /**
   * Crea una instancia de Axios vinculada con configuración predeterminada.
   * @param {import('axios').AxiosRequestConfig} defaultAxiosConfig 
   * @param {Object} [defaultRetryOptions] 
   */
  createInstance(defaultAxiosConfig = {}, defaultRetryOptions = {}) {
    return {
      get: (url, config = {}, options = {}) =>
        executeRequest({ ...defaultAxiosConfig, ...config, method: 'GET', url }, { ...defaultRetryOptions, ...options }),
      post: (url, data, config = {}, options = {}) =>
        executeRequest({ ...defaultAxiosConfig, ...config, method: 'POST', url, data }, { ...defaultRetryOptions, ...options }),
      request: (config = {}, options = {}) =>
        executeRequest({ ...defaultAxiosConfig, ...config }, { ...defaultRetryOptions, ...options })
    };
  }
};

module.exports = httpClient;
