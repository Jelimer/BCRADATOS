const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 3000;

// Agente HTTPS para ignorar certificados SSL no válidos de BYMA
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

// Habilitar CORS y JSON parser
app.use(cors());
app.use(express.json());

// Servir archivos estáticos del frontend
app.use(express.static(path.join(__dirname, 'public')));

// Base URL de la API v4.0 del BCRA
const BCRA_API_BASE = 'https://api.bcra.gob.ar/estadisticas/v4.0';

// Configurar cliente de Axios con headers para evitar bloqueos
const client = axios.create({
  baseURL: BCRA_API_BASE,
  timeout: 15000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8'
  }
});

// ==========================================
// 1. ENDPOINTS PROXY - BCRA
// ==========================================

// Obtener todas las variables
app.get('/api/monetarias', async (req, res) => {
  try {
    console.log('Obteniendo catálogo de variables monetarias...');
    const response = await client.get('/monetarias');
    res.json(response.data);
  } catch (error) {
    console.error('Error obteniendo variables monetarias:', error.message);
    res.status(error.response?.status || 500).json({
      error: 'Error al obtener datos del catálogo del BCRA',
      details: error.message
    });
  }
});

// Obtener el detalle histórico de una variable específica
app.get('/api/monetarias/:id', async (req, res) => {
  const { id } = req.params;
  try {
    console.log(`Obteniendo datos de la variable ID: ${id} con parámetros:`, req.query);
    const response = await client.get(`/Monetarias/${id}`, { params: req.query });
    res.json(response.data);
  } catch (error) {
    console.error(`Error obteniendo variable ${id}:`, error.message);
    res.status(error.response?.status || 500).json({
      error: `Error al obtener datos históricos de la variable ${id}`,
      details: error.message
    });
  }
});

// Obtener metodología
app.get('/api/metodologia', async (req, res) => {
  try {
    console.log('Obteniendo metodología...');
    const response = await client.get('/Metodologia');
    res.json(response.data);
  } catch (error) {
    console.error('Error obteniendo metodologías:', error.message);
    res.status(error.response?.status || 500).json({
      error: 'Error al obtener la metodología del BCRA',
      details: error.message
    });
  }
});

// ==========================================
// 2. ENDPOINT PROXY - INDEC (Series de Tiempo)
// ==========================================
app.get('/api/indec/series', async (req, res) => {
  try {
    console.log('Consultando series de INDEC:', req.query.ids);
    const response = await axios.get('https://apis.datos.gob.ar/series/api/series', {
      params: req.query,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });
    res.json(response.data);
  } catch (error) {
    console.error('Error en INDEC Proxy:', error.message);
    res.status(error.response?.status || 500).json({
      error: 'Error al obtener datos del INDEC',
      details: error.message
    });
  }
});

// ==========================================
// 3. ENDPOINTS PROXY - MERCADO LIVE (Data912)
// ==========================================
app.get('/api/mercado/live/:tipo', async (req, res) => {
  const { tipo } = req.params;
  try {
    console.log(`Obteniendo mercado live de tipo: ${tipo}...`);
    const response = await axios.get(`https://data912.com/live/${tipo}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });
    res.json(response.data);
  } catch (error) {
    console.error(`Error en Mercado Live Proxy (${tipo}):`, error.message);
    res.status(error.response?.status || 500).json({
      error: `Error al obtener cotizaciones en vivo para ${tipo}`,
      details: error.message
    });
  }
});

// ==========================================
// 4. ENDPOINTS PROXY - BYMA
// ==========================================
const BYMA_BASE = 'https://open.bymadata.com.ar/vanoms-be-core/rest/api/bymadata/free';

// Obtener panel de bonos públicos
app.get('/api/byma/panel/public-bonds', async (req, res) => {
  try {
    console.log('Obteniendo panel de bonos de BYMA...');
    const response = await axios.post(`${BYMA_BASE}/public-bonds`, { page_size: 5000 }, {
      httpsAgent,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json'
      }
    });
    res.json(response.data);
  } catch (error) {
    console.error('Error BYMA public-bonds:', error.message);
    res.status(error.response?.status || 500).json({
      error: 'Error al obtener panel de bonos de BYMA',
      details: error.message
    });
  }
});

// Obtener ficha técnica de un bono
app.get('/api/byma/bond-info/:symbol', async (req, res) => {
  const { symbol } = req.params;
  try {
    console.log(`Obteniendo ficha técnica de BYMA para bono: ${symbol}...`);
    const response = await axios.post(`${BYMA_BASE}/bnown/fichatecnica/especies/general`, { symbol }, {
      httpsAgent,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json'
      }
    });
    res.json(response.data);
  } catch (error) {
    console.error(`Error BYMA bond-info ${symbol}:`, error.message);
    res.status(error.response?.status || 500).json({
      error: `Error al obtener la ficha técnica del bono ${symbol} de BYMA`,
      details: error.message
    });
  }
});

// Obtener histórico OHLCV de BYMA
app.get('/api/byma/historico/:symbol', async (req, res) => {
  const { symbol } = req.params;
  try {
    console.log(`Obteniendo históricos de BYMA para: ${symbol}...`, req.query);
    const response = await axios.get(`${BYMA_BASE}/chart/historical-series/history`, {
      params: { ...req.query, symbol },
      httpsAgent,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });
    res.json(response.data);
  } catch (error) {
    console.error(`Error BYMA histórico ${symbol}:`, error.message);
    res.status(error.response?.status || 500).json({
      error: `Error al obtener datos históricos de BYMA para ${symbol}`,
      details: error.message
    });
  }
});

// ==========================================
// FALLBACK Y EJECUCIÓN
// ==========================================

// Redirigir cualquier otra ruta no encontrada a la SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Iniciar el servidor local si se ejecuta directamente
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`==================================================`);
    console.log(` Servidor Proxy Financiero corriendo en: ${PORT}`);
    console.log(` URL Local: http://localhost:${PORT}`);
    console.log(`==================================================`);
  });
}

module.exports = app;
