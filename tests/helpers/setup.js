const http = require('node:http');
const app = require('../../server');

/**
 * Helper para inicializar y gestionar el servidor de pruebas en un puerto efímero.
 */
class TestServer {
  constructor() {
    this.server = null;
    this.baseUrl = '';
    this.port = 0;
  }

  async start() {
    if (this.server) return this;

    return new Promise((resolve, reject) => {
      this.server = app.listen(0, '127.0.0.1', () => {
        const address = this.server.address();
        this.port = address.port;
        this.baseUrl = `http://127.0.0.1:${this.port}`;
        resolve(this);
      });

      this.server.on('error', (err) => {
        reject(err);
      });
    });
  }

  async stop() {
    if (!this.server) return;

    return new Promise((resolve) => {
      if (typeof this.server.closeAllConnections === 'function') {
        this.server.closeAllConnections();
      }
      this.server.close(() => {
        this.server = null;
        resolve();
      });
    });
  }

  async request(path, options = {}) {
    if (!this.server) {
      await this.start();
    }

    const url = path.startsWith('http') ? path : `${this.baseUrl}${path.startsWith('/') ? '' : '/'}${path}`;
    const timeout = options.timeout || 30000;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const headers = {
      'Accept': 'application/json, text/html, */*',
      ...(options.headers || {})
    };

    try {
      const startTime = performance.now();
      const res = await fetch(url, {
        method: options.method || 'GET',
        headers,
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: controller.signal
      });
      const durationMs = performance.now() - startTime;

      let data = null;
      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        try {
          data = await res.json();
        } catch (e) {
          data = null;
        }
      } else {
        data = await res.text();
      }

      return {
        status: res.status,
        headers: res.headers,
        data,
        durationMs,
        ok: res.ok
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async get(path, options = {}) {
    return this.request(path, { ...options, method: 'GET' });
  }

  async post(path, body, options = {}) {
    return this.request(path, {
      ...options,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {})
      },
      body
    });
  }
}

// Instancia singleton por defecto para simplificar los tests
const defaultTestServer = new TestServer();

module.exports = {
  TestServer,
  defaultTestServer
};
