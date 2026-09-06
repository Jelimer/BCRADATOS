/**
 * Fixtures y constantes de referencia para la suite de pruebas
 */
module.exports = {
  // CUITs de prueba
  CUITS: {
    AFIP: '30500010912', // CUIT institucional con historial bancario
    YPF: '30546689979', // CUIT corporativo
    SIN_DEUDA: '20300000001', // CUIT de prueba sin deudas en BCRA (404 en upstream)
    INVALIDO_LONGITUD: '12345', // CUIT corto inválido
    INVALIDO_ALFANUMERICO: '20ABCDE0001' // CUIT con letras
  },

  // Variables monetarias clave del BCRA v4.0
  VARIABLES_BCRA: {
    RESERVAS: 1, // Reservas Internacionales
    TIPO_CAMBIO_OFICIAL: 4, // Tipo de Cambio Minorista
    TASA_POLITICA_MONETARIA: 6, // Tasa de Política Monetaria
    BASE_MONETARIA: 15, // Base Monetaria
    DEPOSITOS_PLAZO_FIJO: 27 // Depósitos a plazo fijo
  },

  // Tickers de bonos soberanos BYMA
  TICKERS_BYMA: {
    AL30: 'AL30',
    AL30_24HS: 'AL30 24HS',
    GD30: 'GD30',
    GD30_24HS: 'GD30 24HS',
    AL30D: 'AL30D'
  },

  // Códigos de monedas oficiales BCRA
  MONEDAS_BCRA: {
    USD: 'USD',
    EUR: 'EUR',
    BRL: 'BRL'
  },

  // Entidades bancarias de prueba para cheques
  BANCOS_CHEQUES: {
    NACION: '011',
    GALICIA: '007',
    PROVINCIA: '014',
    SANTANDER: '072'
  },

  // Series de tiempo INDEC
  SERIES_INDEC: {
    IPC_NACIONAL_NIVEL_GENERAL: '145.3_INGNACNAL_DICI_M_15',
    IPC_NUCLEO: '145.3_INGNACEO_DICI_M_12',
    EMAE: '143.3_NO_PR_2004_A_21',
    RIPTE: '148.3_INIVELNAL_DICI_M_26'
  },

  // Casas de Dólar en DolarApi
  CASAS_DOLAR: [
    'oficial',
    'blue',
    'bolsa',
    'contadoconliqui',
    'mayorista',
    'tarjeta',
    'cripto'
  ]
};
