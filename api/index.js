/**
 * api/index.js
 * Entrypoint serverless para despliegue en Vercel.
 * Exporta la aplicación Express configurada en server.js.
 */

const app = require('../server');

module.exports = app;
