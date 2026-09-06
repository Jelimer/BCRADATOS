/**
 * middleware/errorHandler.js
 * Manejador centralizado de errores y respuestas de contingencia normalizadas.
 */

/**
 * Middleware central de captura de errores para Express.
 * @param {any} err 
 * @param {import('express').Request} req 
 * @param {import('express').Response} res 
 * @param {import('express').NextFunction} next 
 */
function errorHandler(err, req, res, next) {
  const statusCode = err.status || err.statusCode || err.response?.status || 500;
  const message = err.customMessage || err.message || 'Error interno del servidor o proveedor externo';
  const details = err.response?.data || err.details || err.code || null;

  console.error(`[ErrorHandler] ${req.method} ${req.originalUrl} - Status: ${statusCode} - Mensaje: ${message}`);

  res.status(statusCode).json({
    error: true,
    status: statusCode,
    message,
    details: typeof details === 'string' ? details : (details ? JSON.stringify(details) : undefined),
    path: req.originalUrl,
    timestamp: new Date().toISOString()
  });
}

/**
 * Helper para formatear errores de proveedores externos en controladores.
 * @param {any} error 
 * @param {string} contextMessage 
 * @returns {{ status: number, body: Object }}
 */
function formatUpstreamError(error, contextMessage) {
  const status = error.response?.status || 502;
  const details = error.response?.data || error.message;

  return {
    status,
    body: {
      error: true,
      status,
      message: contextMessage,
      details: typeof details === 'object' ? details : { message: String(details) },
      timestamp: new Date().toISOString()
    }
  };
}

module.exports = {
  errorHandler,
  formatUpstreamError
};
