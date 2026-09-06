/**
 * services/cacheService.js
 * Gestor de caché en memoria con TTL granular, desalojo LRU y estadísticas.
 */

class CacheService {
  /**
   * @param {Object} options
   * @param {number} [options.defaultTTL=300] TTL por defecto en segundos (5 min)
   * @param {number} [options.maxEntries=2000] Capacidad máxima de entradas en memoria
   * @param {number} [options.cleanupIntervalMs=60000] Intervalo de purga automática de expirados
   */
  constructor(options = {}) {
    this.defaultTTL = options.defaultTTL || 300;
    this.maxEntries = options.maxEntries || 2000;
    this.cleanupIntervalMs = options.cleanupIntervalMs || 60000;

    /** @type {Map<string, { value: any, expiresAt: number, createdAt: number, hits: number }>} */
    this.store = new Map();

    this.stats = {
      hits: 0,
      misses: 0,
      sets: 0,
      deletes: 0,
      evictions: 0,
      expirations: 0
    };

    // Preconfiguración estándar de TTLs en segundos
    this.TTL = {
      CATALOG: 86400,          // 24 horas (/api/monetarias, /api/metodologia)
      HISTORICAL_SERIES: 3600, // 1 hora (/api/monetarias/:id, /api/indec/series, /api/argentinadatos/...)
      TRANSPARENCY: 1800,      // 30 minutos (/api/bcra-transparencia/*)
      LIVE_MARKET: 30,         // 30 segundos (/api/mercado-dolarapi/*, /api/mercado/live/:tipo, /api/byma/*, /api/bcra-cambiarias/Cotizaciones)
      IDENTIFIER_QUERY: 300,   // 5 minutos (/api/bcra-deudores/*, /api/bcra-cheques/*)
      FALLBACK_PERSISTENT: 604800 // 7 días (para paneles de contingencia fuera de horario)
    };

    // Iniciar timer de limpieza periódica de entradas expiradas
    if (this.cleanupIntervalMs > 0) {
      this.cleanupTimer = setInterval(() => {
        this.purgeExpired();
      }, this.cleanupIntervalMs);

      // Evitar que el timer bloquee la finalización del proceso de Node.js
      if (this.cleanupTimer.unref) {
        this.cleanupTimer.unref();
      }
    }
  }

  /**
   * Obtiene un valor de la caché.
   * @param {string} key 
   * @returns {any|null}
   */
  get(key) {
    if (!this.store.has(key)) {
      this.stats.misses++;
      return null;
    }

    const entry = this.store.get(key);
    const now = Date.now();

    if (entry.expiresAt <= now) {
      this.store.delete(key);
      this.stats.misses++;
      this.stats.expirations++;
      return null;
    }

    entry.hits++;
    this.stats.hits++;

    // Mover al final del Map para comportamiento LRU (actualizar orden de uso)
    this.store.delete(key);
    this.store.set(key, entry);

    return entry.value;
  }

  /**
   * Guarda un valor en la caché con un TTL específico en segundos.
   * @param {string} key 
   * @param {any} value 
   * @param {number} [ttlSeconds] 
   */
  set(key, value, ttlSeconds) {
    const ttl = (typeof ttlSeconds === 'number' && ttlSeconds > 0)
      ? ttlSeconds
      : this.defaultTTL;

    const now = Date.now();
    const expiresAt = now + (ttl * 1000);

    // Si ya existe la clave, eliminarla primero para actualizar posición LRU
    if (this.store.has(key)) {
      this.store.delete(key);
    } else if (this.store.size >= this.maxEntries) {
      // Desalojar la entrada más antigua (primer elemento del Map)
      const oldestKey = this.store.keys().next().value;
      if (oldestKey !== undefined) {
        this.store.delete(oldestKey);
        this.stats.evictions++;
      }
    }

    this.store.set(key, {
      value,
      expiresAt,
      createdAt: now,
      hits: 0
    });

    this.stats.sets++;
  }

  /**
   * Verifica si una clave existe y no ha expirado.
   * @param {string} key 
   * @returns {boolean}
   */
  has(key) {
    if (!this.store.has(key)) return false;
    const entry = this.store.get(key);
    if (entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      this.stats.expirations++;
      return false;
    }
    return true;
  }

  /**
   * Obtiene información detallada de una entrada en caché (TTL restante, fecha creación).
   * @param {string} key 
   * @returns {{ value: any, ttlRemaining: number, createdAt: number, hits: number } | null}
   */
  getEntry(key) {
    if (!this.store.has(key)) return null;
    const entry = this.store.get(key);
    const now = Date.now();
    if (entry.expiresAt <= now) {
      this.store.delete(key);
      this.stats.expirations++;
      return null;
    }
    return {
      value: entry.value,
      ttlRemaining: Math.max(0, Math.ceil((entry.expiresAt - now) / 1000)),
      createdAt: entry.createdAt,
      hits: entry.hits
    };
  }

  /**
   * Elimina una clave de la caché.
   * @param {string} key 
   * @returns {boolean}
   */
  delete(key) {
    if (this.store.has(key)) {
      this.store.delete(key);
      this.stats.deletes++;
      return true;
    }
    return false;
  }

  /**
   * Limpia toda la caché y resetea las entradas.
   */
  clear() {
    this.store.clear();
  }

  /**
   * Purga todas las entradas que hayan expirado.
   * @returns {number} Cantidad de entradas eliminadas
   */
  purgeExpired() {
    const now = Date.now();
    let purged = 0;
    for (const [key, entry] of this.store.entries()) {
      if (entry.expiresAt <= now) {
        this.store.delete(key);
        this.stats.expirations++;
        purged++;
      }
    }
    return purged;
  }

  /**
   * Retorna métricas de rendimiento y estado de la caché.
   * @returns {Object}
   */
  getStats() {
    const totalRequests = this.stats.hits + this.stats.misses;
    const hitRate = totalRequests > 0
      ? Number(((this.stats.hits / totalRequests) * 100).toFixed(2))
      : 0;

    return {
      ...this.stats,
      size: this.store.size,
      maxEntries: this.maxEntries,
      hitRate: `${hitRate}%`,
      keys: Array.from(this.store.keys())
    };
  }

  /**
   * Cierra el servicio y detiene el timer de limpieza.
   */
  destroy() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }
    this.clear();
  }
}

// Instancia singleton por defecto
const defaultCacheService = new CacheService();

module.exports = {
  CacheService,
  cacheService: defaultCacheService
};
