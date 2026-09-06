/**
 * state.js
 * Almacén de estado reactivo y cliente de caché en memoria con TTL.
 */

/**
 * Caché en memoria del cliente con expiración por TTL y Map nativo.
 */
export const clientCache = {
  store: new Map(),

  /**
   * Obtiene un elemento de la caché si no ha expirado.
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
    return entry.data;
  },

  /**
   * Guarda un elemento en la caché con tiempo de vida determinado.
   * @param {string} key 
   * @param {any} data 
   * @param {number} [ttlMs=300000] Por defecto 5 minutos
   */
  set(key, data, ttlMs = 5 * 60 * 1000) {
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
    favorites: JSON.parse(localStorage.getItem('favorites') || '[]')
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
    searchQuery: ''
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
