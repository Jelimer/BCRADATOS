# Infraestructura de Pruebas Automatizadas — BCRADATOS / Portal Financiero Argentino

**Versión del Test Runner:** Node.js v22.18.0 Native Test Runner (`node:test`, `node:assert/strict`)  
**Directorio de Pruebas:** `tests/`  
**Estado:** Totalmente Operativo y Modular

---

## 1. Arquitectura y Principios de Diseño

La suite de pruebas fue diseñada para ofrecer máxima velocidad, reproducibilidad e independencia, sin añadir dependencias frágiles ni acoplamientos innecesarios:

1. **Motor Nativo Node.js v22 (`node:test`):** No requiere frameworks pesados externos (como Jest o Mocha), ejecutándose directamente sobre el runtime estándar de Node.js con soporte nativo de subtests, suites `describe`/`it`, hooks `before`/`after` y reportes TAP/spec.
2. **Aislamiento por Puerto Efímero:** El helper `TestServer` (`tests/helpers/setup.js`) levanta la aplicación Express (`server.js`) en un socket local con puerto dinámico asignado por el SO (`app.listen(0, '127.0.0.1')`), evitando colisiones de puertos (como el 3000) con instancias en desarrollo o producción.
3. **Peticiones HTTP Nativas con `fetch` y AbortController:** Las solicitudes de prueba utilizan el cliente `fetch` global de Node.js con control de timeout por petición mediante `AbortController` (evitando cuelgues o bloqueos de sockets).
4. **Constantes y Fixtures Centralizadas:** `tests/helpers/fixtures.js` provee CUITs institucionales y de prueba (AFIP, YPF, CUIT sin deuda 404), códigos de monedas, IDs de series INDEC y variables monetarias.

---

## 2. Comandos de Ejecución

### Ejecutar toda la suite completa:
```bash
node --test tests/**/*.test.js
```
o (mediante `npm test`):
```bash
npm test
```

### Ejecutar por módulo / Tier individual:
```bash
# Tier 1: Salud del servidor, estáticos y middlewares
node --test tests/health.test.js

# Tier 1: Endpoints oficiales del BCRA (Monetarias, Cambiarias, Transparencia, Deudores, Cheques)
node --test tests/bcra.test.js

# Tier 1: Proxies de INDEC, BYMA, DolarApi, ArgentinaDatos y Data912
node --test tests/proxies.test.js

# Tier 2: Caché en memoria, latencia e invariancia
node --test tests/cache.test.js

# Tier 2: Resiliencia, contingencias y manejo de 404/400
node --test tests/resilience.test.js

# Tier 3: Integración y combinaciones cross-feature
node --test tests/cross_feature.test.js

# Tier 4: Escenarios de aplicación end-to-end
node --test tests/scenarios.test.js
```

---

## 3. Estructura del Directorio de Pruebas

```
tests/
├── helpers/
│   ├── setup.js              # Inicializador de servidor Express en puerto efímero con cliente fetch
│   └── fixtures.js           # CUITs de prueba, IDs de variables BCRA, tickers BYMA y series INDEC
├── health.test.js            # Tier 1: Arranque, estáticos (HTML/CSS/JS), CORS, SPA fallback
├── bcra.test.js              # Tier 1: Endpoints BCRA (Features 1 a 9)
├── proxies.test.js           # Tier 1: Proxies externos (Features 10 a 14)
├── cache.test.js             # Tier 2: Caché en memoria, latencia <5ms e idempotencia (Feature 15)
├── resilience.test.js        # Tier 2: Resiliencia, 404 como sin deuda, timeouts, mercado cerrado (Feature 16)
├── cross_feature.test.js     # Tier 3: Cruces cross-feature (Brechas, comparador de tasas, correlaciones)
└── scenarios.test.js         # Tier 4: Escenarios de usuario completos (E2E del Portal)
```

---

## 4. Matriz de Cobertura de los 4 Tiers y Feature Inventory

| Tier | Archivo de Prueba | Casos | Features Cubiertas |
|---|---|---|---|
| **Tier 1: Feature Coverage** | `tests/health.test.js` | 7 | Servidor Express, Estáticos (`index.html`, `style.css`, `app.js`), CORS, SPA fallback, Content-Type JSON. |
| **Tier 1: Feature Coverage** | `tests/bcra.test.js` | 10 | Features 1 a 9: Catálogo de Variables, Series Históricas, Metodología, Cotizaciones Cambiarias, Plazos Fijos, Paquetes Productos, Préstamos Personales, Central de Deudores, Cheques Denunciados. |
| **Tier 1: Feature Coverage** | `tests/proxies.test.js` | 8 | Features 10 a 14: INDEC Series de Tiempo, BYMA Panel de Bonos, BYMA Ficha Técnica, BYMA Histórico OHLCV, DolarApi Casas en Vivo, ArgentinaDatos Dólares/Inflación/UVA, Data912 Live MEP. |
| **Tier 2: Boundary & Performance** | `tests/cache.test.js` | 5 | Feature 15: Integridad de datos en hits repetidos, latencia en consultas consecutivas, segmentación por query params, ráfagas concurrentes. |
| **Tier 2: Boundary & Resilience** | `tests/resilience.test.js` | 9 | Features 8, 11, 16, 17: Normalización de 404 del BCRA ("Sin Deuda"), validación de CUITs malformados, contingencia de BYMA fuera de horario, símbolos con sufijos, IDs inválidos. |
| **Tier 3: Cross-Feature Integration** | `tests/cross_feature.test.js` | 5 | Integración DolarApi + BCRA (Brecha cambiaria), BCRA Transparencia + ArgentinaDatos (Tasas), INDEC + ArgentinaDatos (IPC), BYMA Panel + Ficha Técnica, Reservas + Base Monetaria. |
| **Tier 4: Real-World Scenarios** | `tests/scenarios.test.js` | 5 | Carga inicial completa del Dashboard, Navegación Macroeconómica, Diagnóstico Crediticio Integral de CUIT, Exploración con Filtros y Metodología, Concurrencia Multi-Pestaña. |

**Total de Casos de Prueba Implementados:** **49 tests**.

---

## 5. Guía de Extensión

Para añadir nuevos tests a la suite:
1. Importar `describe`, `it`, `before`, `after` desde `node:test` y `assert` desde `node:assert/strict`.
2. Utilizar `defaultTestServer` de `./helpers/setup`:
   ```javascript
   const { describe, it, before, after } = require('node:test');
   const assert = require('node:assert/strict');
   const { defaultTestServer } = require('./helpers/setup');

   describe('Nueva Suite de Prueba', () => {
     before(async () => await defaultTestServer.start());
     after(async () => await defaultTestServer.stop());

     it('Debe consultar nuevo endpoint', async () => {
       const res = await defaultTestServer.get('/api/nuevo-endpoint');
       assert.equal(res.status, 200);
       assert.ok(res.data);
     });
   });
   ```
