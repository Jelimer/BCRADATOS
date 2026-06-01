const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Habilitar CORS
app.use(cors());

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

// Endpoint proxy para obtener todas las variables
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

// Endpoint proxy para obtener el detalle histórico de una variable específica
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

// Endpoint proxy para metodología
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

// Redirigir cualquier otra ruta no encontrada a la SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`==================================================`);
  console.log(` Servidor Proxy BCRA corriendo en puerto: ${PORT}`);
  console.log(` URL Local: http://localhost:${PORT}`);
  console.log(`==================================================`);
});
