/**
 * state.js
 * Almacén de estado reactivo y cliente de caché en memoria con TTL.
 */

/**
 * Caché en memoria del cliente con expiración por TTL, límite de capacidad y poda preventiva.
 */
export const clientCache = {
  store: new Map(),
  maxEntries: 200,

  /**
   * Poda preventiva de entradas expiradas en la caché.
   * @returns {number} Cantidad de entradas eliminadas
   */
  prune() {
    const now = Date.now();
    let removed = 0;
    for (const [key, entry] of this.store) {
      if (now > entry.expiresAt) {
        this.store.delete(key);
        removed++;
      }
    }
    return removed;
  },

  /**
   * Obtiene un elemento de la caché si no ha expirado.
   * Mantiene el orden de acceso (LRU) reinsertando la entrada.
   * @param {string} key 
   * @returns {any|null}
   */
  get(key) {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    // Refrescar orden de acceso (LRU)
    this.store.delete(key);
    this.store.set(key, entry);
    return entry.data;
  },

  /**
   * Guarda un elemento en la caché con tiempo de vida determinado.
   * Si se alcanza maxEntries, ejecuta poda preventiva de expirados y desalojo LRU de los más antiguos.
   * @param {string} key 
   * @param {any} data 
   * @param {number} [ttlMs=300000] Por defecto 5 minutos
   */
  set(key, data, ttlMs = 5 * 60 * 1000) {
    // Si la clave ya existía, eliminarla para actualizar su posición en la cola de desalojo
    if (this.store.has(key)) {
      this.store.delete(key);
    }

    // Poda preventiva si alcanzamos el umbral de capacidad
    if (this.store.size >= this.maxEntries) {
      this.prune();
    }

    // Si aún supera o iguala la capacidad tras purgar expirados, desalojar la más antigua (FIFO/LRU)
    while (this.store.size >= this.maxEntries) {
      const oldestKey = this.store.keys().next().value;
      if (oldestKey === undefined) break;
      this.store.delete(oldestKey);
    }

    this.store.set(key, {
      data,
      expiresAt: Date.now() + ttlMs
    });
  },

  /**
   * Verifica si una clave está presente y vigente.
   * @param {string} key 
   * @returns {boolean}
   */
  has(key) {
    return this.get(key) !== null;
  },

  /**
   * Elimina una clave de la caché.
   * @param {string} key 
   */
  delete(key) {
    this.store.delete(key);
  },

  /**
   * Vacía la totalidad de la caché en memoria.
   */
  clear() {
    this.store.clear();
  },

  /**
   * Retorna el número de entradas actualmente almacenadas.
   * @returns {number}
   */
  size() {
    return this.store.size;
  }
};

/**
 * Estado global de la aplicación dividido por dominio/pestaña.
 */
export const appState = {
  activeTab: 'bcra', // 'bcra', 'indec', 'dolares', 'byma', 'comparador', 'consultas'

  // Módulo BCRA
  bcra: {
    variables: [],
    filteredVariables: [],
    selectedVariable: null,
    historicalData: [],
    filteredData: [],
    methodologies: [],
    chart: null,
    chartType: 'line',
    currentTab: 'tabChart',
    tablePage: 1,
    tablePageSize: 15,
    kpiPeriodDays: 30,
    favorites: typeof localStorage !== 'undefined' ? JSON.parse(localStorage.getItem('favorites') || '[]') : []
  },

  // Módulo INDEC
  indec: {
    raw: null,
    parsedData: [],
    chart: null,
    activeMetric: 'ipc', // 'ipc', 'emae', 'salarios'
    days: 365
  },

  // Módulo DÓLARES Y MERCADO DE CAMBIOS
  dolares: {
    live: {
      oficial: 0,
      mep: 0,
      ccl: 0,
      blue: 0,
      blueCompra: 0,
      blueVenta: 0,
      mayorista: 0,
      euro: 0,
      real: 0,
      cripto: 0,
      brechas: {}
    },
    historical: {
      oficial: [],
      mep: [],
      blue: [],
      dates: []
    },
    chart: null,
    activeView: 'prices', // 'prices' o 'brecha'
    days: 90,
    tablePage: 1,
    tablePageSize: 15
  },

  // Módulo BYMA
  byma: {
    bonds: [],
    selectedBond: null,
    searchQuery: '',
    category: 'all', // 'all', 'soberano_usd', 'soberano_cer', 'lecap'
    chart: null,
    chartRange: '6M', // '1M', '3M', '6M', '1A', 'all'
    marketOpen: false,
    isFallback: false,
    indicadores: null
  },

  // Módulo COMPARADOR BANCARIO
  comparador: {
    activeTab: 'plazosFijos', // 'plazosFijos', 'comisiones', 'prestamos', 'cuentasRemuneradas'
    plazosFijos: [],
    comisiones: [],
    prestamos: [],
    cuentasRemuneradas: []
  },

  // Módulo CONSULTAS (Deudores y Cheques)
  consultas: {
    activeTab: 'deudores', // 'deudores', 'cheques'
    deudorCache: null,
    chequeCache: null
  },

  // Módulo CRIPTOYA / FINTECH
  cripto: {
    dolarCripto: null,
    rendimientos: [],
    bancos: []
  }
};
