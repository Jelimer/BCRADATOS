/**
 * services/schemaValidator.js
 * Módulo de validación, sanitización y normalización de contratos de datos financieros.
 * Blindaje contra cambios imprevistos en respuestas upstream, valores nulos y formatos numéricos heterogéneos.
 */

/**
 * Diccionario de nombres normalizados de entidades bancarias argentinas.
 */
const NOMBRES_BANCOS = {
  bna: 'Banco Nación',
  galicia: 'Banco Galicia',
  bbva: 'Banco BBVA',
  santander: 'Banco Santander',
  macro: 'Banco Macro',
  ciudad: 'Banco Ciudad',
  bapro: 'Banco Provincia',
  icbc: 'Banco ICBC',
  comafi: 'Banco Comafi',
  supervielle: 'Banco Supervielle',
  brubank: 'Brubank',
  patagonia: 'Banco Patagonia',
  piano: 'Banco Piano',
  hipotecario: 'Banco Hipotecario',
  bind: 'Banco Industrial',
  itau: 'Banco Itaú',
  hsbc: 'Banco HSBC',
  reba: 'Reba',
  credicoop: 'Banco Credicoop',
  bancor: 'Banco de Córdoba',
  chaco: 'Nuevo Banco del Chaco',
  santafe: 'Banco de Santa Fe',
  san_juan: 'Banco de San Juan',
  entre_rios: 'Banco de Entre Ríos',
  santa_cruz: 'Banco de Santa Cruz'
};

/**
 * Diccionario de nombres amigables de billeteras virtuales y fintechs argentinas.
 */
const NOMBRES_FINTECH = {
  lemoncash: 'Lemon Cash',
  fiwind: 'Fiwind',
  letsbit: "Let'sBit",
  belo: 'Belo',
  mercadopago: 'Mercado Pago',
  personalpay: 'Personal Pay',
  naranjax: 'Naranja X',
  naranja: 'Naranja X',
  uala: 'Ualá',
  nexo: 'Nexo',
  ripio: 'Ripio',
  satoshitango: 'Satoshi Tango',
  buenbit: 'Buenbit',
  decrypto: 'Decrypto',
  prex: 'Prex',
  tiendacrypto: 'Tienda Crypto',
  cocos: 'Cocos Capital',
  clarin: 'Clave',
  astropay: 'AstroPay'
};

// ==========================================
// 1. UTILIDADES PURAS DE SANITIZACIÓN
// ==========================================

/**
 * Convierte un valor arbitrario a número finito válido.
 * Maneja cadenas con comas o puntos decimales y protege contra NaN e Infinity.
 * 
 * @param {any} val - Valor de entrada
 * @param {number} [defaultVal=0] - Valor por defecto si no es convertible
 * @returns {number}
 */
function sanitizeNumber(val, defaultVal = 0) {
  if (val === null || val === undefined) return defaultVal;
  if (typeof val === 'number') {
    return Number.isFinite(val) ? val : defaultVal;
  }
  const cleanStr = String(val).trim().replace(',', '.');
  const num = Number(cleanStr);
  return Number.isFinite(num) ? num : defaultVal;
}

/**
 * Normaliza valores porcentuales asegurando escala de 0 a 100%.
 * Detecta si el valor viene expresado como fracción decimal (ej. 0.174 -> 17.4%).
 * 
 * @param {any} val - Valor porcentual
 * @param {number} [defaultVal=0] - Fallback numérico
 * @returns {number}
 */
function normalizePercentage(val, defaultVal = 0) {
  const num = sanitizeNumber(val, defaultVal);
  if (num === 0) return 0;
  // Si el valor absoluto está entre 0 y 1 (excluyentes), asumimos escala fraccionaria decimal
  const normalized = (Math.abs(num) > 0 && Math.abs(num) < 1) ? num * 100 : num;
  return Number(normalized.toFixed(2));
}

/**
 * Sanitiza y normaliza fechas a formato estándar ISO YYYY-MM-DD.
 * Soporta timestamps Unix en segundos o milisegundos y strings de fecha.
 * 
 * @param {any} val - Fecha o timestamp
 * @param {string|null} [fallbackDate=null] - Fecha por defecto
 * @returns {string} Fecha en formato YYYY-MM-DD
 */
function sanitizeDate(val, fallbackDate = null) {
  const now = new Date();
  const defaultIso = now.toISOString().split('T')[0];

  if (!val) {
    return fallbackDate || defaultIso;
  }

  // Si es timestamp numérico o string puramente numérico
  if (typeof val === 'number' || (typeof val === 'string' && /^\d+$/.test(val.trim()))) {
    const num = Number(val);
    if (!Number.isFinite(num) || num <= 0) {
      return fallbackDate || defaultIso;
    }
    // Si tiene menos de 10 u 11 dígitos, son segundos Unix; si no, milisegundos
    const ms = num < 10000000000 ? num * 1000 : num;
    const d = new Date(ms);
    if (!isNaN(d.getTime())) {
      return d.toISOString().split('T')[0];
    }
  }

  // Si es formato de fecha string
  const d = new Date(val);
  if (!isNaN(d.getTime())) {
    return d.toISOString().split('T')[0];
  }

  return fallbackDate || defaultIso;
}

/**
 * Garantiza que la salida sea un Array seguro.
 * 
 * @param {any} val 
 * @returns {Array}
 */
function safeArray(val) {
  return Array.isArray(val) ? val : [];
}

/**
 * Garantiza que la salida sea un Objeto plano seguro.
 * 
 * @param {any} val 
 * @returns {Object}
 */
function safeObject(val) {
  return (val && typeof val === 'object' && !Array.isArray(val)) ? val : {};
}

// ==========================================
// 2. NORMALIZADORES DE ESQUEMAS FINANCIEROS
// ==========================================

/**
 * Extrae y sanitiza un nodo individual de cotización de dólar.
 * @private
 */
function extractDolarItem(rawItem) {
  const item = safeObject(rawItem);
  const precio = sanitizeNumber(item.price !== undefined ? item.price : (item.ask || item.bid || 0));
  const compra = sanitizeNumber(item.bid !== undefined ? item.bid : (item.price || item.ask || 0));
  const venta = sanitizeNumber(item.ask !== undefined ? item.ask : (item.price || item.bid || 0));
  const variacion = sanitizeNumber(item.variation, 0);
  const timestamp = sanitizeNumber(item.timestamp, 0);

  return {
    compra,
    venta,
    precio: precio || venta || compra,
    variacion,
    timestamp
  };
}

/**
 * Calcula la brecha porcentual entre dos cotizaciones.
 * @private
 */
function calcBrecha(precio, precioBase) {
  if (!precioBase || precioBase <= 0) return 0;
  return Number((((precio - precioBase) / precioBase) * 100).toFixed(2));
}

/**
 * Normaliza las cotizaciones de dólares de CriptoYa y calcula brechas cambiarias relativas al oficial.
 * 
 * @param {Object} rawDolar - Payload bruto devuelto por CriptoYa
 * @returns {Object} Contrato normalizado de dólar con brechas
 */
function normalizeDolarData(rawDolar) {
  const data = safeObject(rawDolar);

  const oficial = extractDolarItem(data.oficial);
  const blue = extractDolarItem(data.blue);
  const mep = extractDolarItem(data.mep);
  const ccl = extractDolarItem(data.ccl);
  const cripto = extractDolarItem(data.cripto);
  const tarjeta = extractDolarItem(data.tarjeta);
  const mayorista = extractDolarItem(data.mayorista);

  const oficialRef = oficial.precio || oficial.venta || 0;

  const brechas = {
    blueVsOficial: calcBrecha(blue.precio, oficialRef),
    mepVsOficial: calcBrecha(mep.precio, oficialRef),
    cclVsOficial: calcBrecha(ccl.precio, oficialRef),
    criptoVsOficial: calcBrecha(cripto.precio, oficialRef)
  };

  return {
    oficial,
    blue,
    mep,
    ccl,
    cripto,
    tarjeta,
    mayorista,
    brechas
  };
}

/**
 * Normaliza las cotizaciones cripto por exchange y detecta la mejor oportunidad de arbitraje.
 * 
 * @param {Object} rawExchanges - Diccionario de exchanges de CriptoYa
 * @param {string} [pair='USDT/ARS'] - Par analizado
 * @returns {Object} Objeto con pair, lista normalizada de results y métricas de arbitraje
 */
function normalizeCriptoData(rawExchanges, pair = 'USDT/ARS') {
  const exchangesObj = safeObject(rawExchanges);
  const results = [];

  let mejorCompra = null; // Menor compraTotal (dónde comprar más barato)
  let mejorVenta = null;  // Mayor ventaTotal (dónde vender más caro)

  for (const [exchangeKey, rawData] of Object.entries(exchangesObj)) {
    if (!rawData || typeof rawData !== 'object') continue;

    const compra = sanitizeNumber(rawData.ask);
    const compraTotal = sanitizeNumber(rawData.totalAsk !== undefined ? rawData.totalAsk : rawData.ask);
    const venta = sanitizeNumber(rawData.bid);
    const ventaTotal = sanitizeNumber(rawData.totalBid !== undefined ? rawData.totalBid : rawData.bid);
    const timestamp = sanitizeNumber(rawData.time);

    // Solo incluir exchanges con datos numéricos operativos mayores a 0
    if (compraTotal <= 0 && ventaTotal <= 0) continue;

    const exchangeResult = {
      exchange: exchangeKey,
      compra,
      compraTotal,
      venta,
      ventaTotal,
      timestamp
    };

    results.push(exchangeResult);

    // Evaluar mejor compra (mínimo totalAsk > 0)
    if (compraTotal > 0) {
      if (!mejorCompra || compraTotal < mejorCompra.precioTotal) {
        mejorCompra = {
          exchange: exchangeKey,
          precioTotal: compraTotal
        };
      }
    }

    // Evaluar mejor venta (máximo totalBid > 0)
    if (ventaTotal > 0) {
      if (!mejorVenta || ventaTotal > mejorVenta.precioTotal) {
        mejorVenta = {
          exchange: exchangeKey,
          precioTotal: ventaTotal
        };
      }
    }
  }

  // Ordenar resultados por compraTotal ascendente para visualización inmediata
  results.sort((a, b) => a.compraTotal - b.compraTotal);

  // Calcular métricas de arbitraje
  let spreadPorcentaje = 0;
  let oportunidad = false;

  if (mejorCompra && mejorVenta && mejorCompra.precioTotal > 0) {
    spreadPorcentaje = Number(
      (((mejorVenta.precioTotal - mejorCompra.precioTotal) / mejorCompra.precioTotal) * 100).toFixed(2)
    );
    oportunidad = spreadPorcentaje > 0 && mejorCompra.exchange !== mejorVenta.exchange;
  }

  return {
    pair: String(pair).toUpperCase(),
    results,
    arbitraje: {
      mejorCompra,
      mejorVenta,
      spreadPorcentaje,
      oportunidad
    }
  };
}

/**
 * Normaliza las cotizaciones de dólar minorista por banco y calcula promedios generales.
 * 
 * @param {Object} rawBancos - Diccionario de cotizaciones de bancos de CriptoYa
 * @returns {Object} Objeto con results y promedios generales de compra y venta
 */
function normalizeBancosData(rawBancos) {
  const bancosObj = safeObject(rawBancos);
  const results = [];

  let sumaCompra = 0;
  let conteoCompra = 0;
  let sumaVenta = 0;
  let conteoVenta = 0;

  for (const [codigoRaw, rawData] of Object.entries(bancosObj)) {
    if (!rawData || typeof rawData !== 'object') continue;

    const codigo = codigoRaw.toLowerCase();
    const compra = sanitizeNumber(rawData.bid !== undefined ? rawData.bid : rawData.totalBid);
    const venta = sanitizeNumber(rawData.ask !== undefined ? rawData.ask : rawData.totalAsk);
    const timestamp = sanitizeNumber(rawData.time);

    // Omitir si no tiene cotizaciones válidas
    if (compra <= 0 && venta <= 0) continue;

    const spread = Number(Math.max(0, venta - compra).toFixed(2));
    const nombre = NOMBRES_BANCOS[codigo] || (codigo.charAt(0).toUpperCase() + codigo.slice(1));

    results.push({
      codigo,
      nombre,
      compra,
      venta,
      spread,
      timestamp
    });

    if (compra > 0) {
      sumaCompra += compra;
      conteoCompra++;
    }
    if (venta > 0) {
      sumaVenta += venta;
      conteoVenta++;
    }
  }

  // Ordenar alfabéticamente por nombre de banco
  results.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));

  const promedio = {
    compra: conteoCompra > 0 ? Number((sumaCompra / conteoCompra).toFixed(2)) : 0,
    venta: conteoVenta > 0 ? Number((sumaVenta / conteoVenta).toFixed(2)) : 0
  };

  return {
    results,
    promedio
  };
}

/**
 * Normaliza la lista de rendimientos y cuentas remuneradas de ArgentinaDatos.
 * 
 * @param {Array} rawRendimientos - Lista de rendimientos devuelta por ArgentinaDatos
 * @param {string|null} [filterMoneda=null] - Filtro opcional por moneda (ARS, USDT, etc.)
 * @returns {Array} Lista de rendimientos normalizados y ordenados por APY descendente
 */
function normalizeRendimientosData(rawRendimientos, filterMoneda = null) {
  const items = safeArray(rawRendimientos);
  const filterUpper = filterMoneda ? String(filterMoneda).trim().toUpperCase() : null;

  const results = [];

  for (const item of items) {
    if (!item || typeof item !== 'object') continue;

    const moneda = (item.moneda || 'ARS').toUpperCase();
    if (filterUpper && moneda !== filterUpper) {
      continue;
    }

    const entidadKey = String(item.entidad || '').toLowerCase().trim();
    const apy = normalizePercentage(item.apy);
    const rendimientoMensual = Number((apy / 12).toFixed(2));
    const nombre = NOMBRES_FINTECH[entidadKey] || (entidadKey ? entidadKey.toUpperCase() : 'Fintech');
    const fecha = sanitizeDate(item.fecha);

    const normItem = {
      entidad: entidadKey,
      nombre,
      moneda,
      apy,
      rendimientoMensual,
      topeBonificado: (item.bonusThreshold !== undefined && item.bonusThreshold !== null)
        ? sanitizeNumber(item.bonusThreshold)
        : null,
      fecha
    };

    if (item.bonusValue !== undefined && item.bonusValue !== null) {
      normItem.bonoApy = normalizePercentage(item.bonusValue);
    }

    results.push(normItem);
  }

  // Ordenar por APY descendente (mayor rendimiento primero)
  results.sort((a, b) => b.apy - a.apy);

  return results;
}

/**
 * Normaliza los indicadores diarios (UVA y CER) agrupándolos en un contrato único.
 * 
 * @param {Object} uvaRaw - Datos de UVA de CriptoYa
 * @param {Object} cerRaw - Datos de CER de CriptoYa
 * @returns {Object}
 */
function normalizeIndicadoresData(uvaRaw, cerRaw) {
  const uva = safeObject(uvaRaw);
  const cer = safeObject(cerRaw);

  const uvaValor = sanitizeNumber(uva.value);
  const uvaTimestamp = sanitizeNumber(uva.time);
  const uvaFecha = sanitizeDate(uvaTimestamp || uva.date);

  const cerValor = sanitizeNumber(cer.value);
  const cerTimestamp = sanitizeNumber(cer.time);
  const cerFecha = sanitizeDate(cerTimestamp || cer.date);

  return {
    uva: {
      valor: uvaValor,
      timestamp: uvaTimestamp,
      fecha: uvaFecha
    },
    cer: {
      valor: cerValor,
      timestamp: cerTimestamp,
      fecha: cerFecha
    }
  };
}

module.exports = {
  sanitizeNumber,
  normalizePercentage,
  sanitizeDate,
  safeArray,
  safeObject,
  normalizeDolarData,
  normalizeCriptoData,
  normalizeBancosData,
  normalizeRendimientosData,
  normalizeIndicadoresData
};
