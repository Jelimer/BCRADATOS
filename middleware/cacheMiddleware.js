/**
 * middleware/cacheMiddleware.js
 * Middleware de Express para caché transparente en memoria con TTL granular.
 */

const { cacheService } = require('../services/cacheService');

/**
 * Genera la clave de caché a partir de la petición HTTP.
 * @param {import('express').Request} req 
 * @returns {string}
 */
function defaultKeyGenerator(req) {
  // Construir una clave unívoca basada en método, path original y query params ordenados
  const queryKeys = Object.keys(req.query || {}).sort();
  const queryString = queryKeys.length > 0
    ? '?' + queryKeys.map(k => `${encodeURIComponent(k)}=${encodeURIComponent(req.query[k])}`).join('&')
    : '';

  return `${req.method}:${req.baseUrl || ''}${req.path}${queryString}`;
}

/**
 * Middleware factory para caché en memoria.
 * @param {number|string} [ttlInput=300] TTL en segundos o nombre de preset ('CATALOG', 'LIVE_MARKET', etc.)
 * @param {Object} [options] Opciones adicionales
 * @param {Function} [options.keyGenerator] Función personalizada para generar la clave
 * @param {Function} [options.condition] Función que retorna false si no se debe cachear la petición
 * @param {boolean} [options.injectCachedProperty=true] Inyectar `cached: true/false` en objetos JSON
 * @returns {import('express').RequestHandler}
 */
function cacheMiddleware(ttlInput = 300, options = {}) {
  // Resolver TTL a partir de número o preset de cacheService
  let ttlSeconds = 300;
  if (typeof ttlInput === 'number' && ttlInput > 0) {
    ttlSeconds = ttlInput;
  } else if (typeof ttlInput === 'string' && cacheService.TTL[ttlInput]) {
    ttlSeconds = cacheService.TTL[ttlInput];
  }

  const keyGen = options.keyGenerator || defaultKeyGenerator;
  const condition = options.condition || (() => true);
  const injectCachedProperty = options.injectCachedProperty !== false;

  return function (req, res, next) {
    // Solo cachear peticiones GET (o métodos explícitamente permitidos)
    if (req.method !== 'GET' && !options.allowNonGet) {
      res.setHeader('X-Cache', 'BYPASS');
      return next();
    }

    // Verificar si la condición personalizada se cumple
    if (!condition(req)) {
      res.setHeader('X-Cache', 'BYPASS');
      return next();
    }

    // Permitir bypass explícito con query param ?nocache=true o header Cache-Control: no-cache
    const bypassRequested = req.query.nocache === 'true' ||
      req.headers['cache-control'] === 'no-cache' ||
      req.headers['pragma'] === 'no-cache';

    const cacheKey = keyGen(req);

    if (!bypassRequested) {
      const entry = cacheService.getEntry(cacheKey);
      if (entry) {
        // CACHE HIT
        res.setHeader('X-Cache', 'HIT');
        res.setHeader('X-Cache-TTL', entry.ttlRemaining);
        res.setHeader('X-Cache-Key', cacheKey);

        let data = entry.value;

        // Si es un objeto JSON plano, marcar "cached": true
        if (injectCachedProperty && data && typeof data === 'object' && !Array.isArray(data)) {
          data = {
            ...data,
            cached: true,
            cachedAt: new Date(entry.createdAt).toISOString()
          };
        }

        return res.json(data);
      }
    }

    // CACHE MISS
    res.setHeader('X-Cache', bypassRequested ? 'BYPASS' : 'MISS');
    res.setHeader('X-Cache-Key', cacheKey);

    // Interceptar res.json para almacenar la respuesta antes de emitirla
    const originalJson = res.json.bind(res);

    res.json = function (body) {
      // Solo guardar en caché respuestas exitosas (200 / 2xx) que no contengan error explícito
      if (res.statusCode >= 200 && res.statusCode < 300 && (!body || body.error !== true)) {
        cacheService.set(cacheKey, body, ttlSeconds);
      }

      // Si el cuerpo es un objeto, asegurar indicador cached: false si corresponde
      let outputBody = body;
      if (injectCachedProperty && outputBody && typeof outputBody === 'object' && !Array.isArray(outputBody)) {
        if (outputBody.cached === undefined) {
          outputBody = {
            ...outputBody,
            cached: false
          };
        }
      }

      return originalJson(outputBody);
    };

    next();
  };
}

module.exports = {
  cacheMiddleware,
  defaultKeyGenerator
};
