# Project: bcra-monetarias — Portal Financiero y Macroeconómico Argentino

## Architecture

El proyecto es una plataforma web integral full-stack de alto rendimiento compuesta por:

1. **Backend (Node.js / Express):**
   - Servidor proxy y orquestador de APIs externas para sortear restricciones de CORS, aplicar políticas de resiliencia, control de timeouts, reintentos con backoff exponencial con jitter y normalización de contratos JSON.
   - Integración de fuentes oficiales y de mercado: BCRA (Monetarias v4.0, Cambiarias v1.0, Régimen de Transparencia, Central de Deudores v1.0, Cheques Denunciados v1.0), INDEC Series de Tiempo, BYMA Open API (Bonos y Fichas Técnicas), DolarApi v1, ArgentinaDatos y CriptoYa.
   - Módulo de validación y sanitización estricta de contratos en `services/schemaValidator.js` (`sanitizeNumber`, `normalizePercentage`, `sanitizeDate`, `safeArray`, `safeObject`, `normalizeDolarData`, `normalizeCriptoData`, `normalizeBancosData`, `normalizeRendimientosData`, `normalizeIndicadoresData`), blindando la plataforma contra cambios de esquema upstream, nulos y tipos heterogéneos.
   - Endpoints proxy financieros avanzados incorporados:
     - `GET /api/criptoya/dolar`: cotizaciones unificadas (oficial, blue, mep, ccl, cripto, tarjeta, mayorista) con cálculo automático de brechas cambiarias relativas al oficial.
     - `GET /api/criptoya/cripto/:coin?/:fiat?`: cotizaciones por exchange y motor de cálculo de mejor arbitraje (compra más barata vs venta más cara y spread porcentual).
     - `GET /api/criptoya/bancos`: cotizaciones minoristas de compra/venta por entidad bancaria en tiempo real y promedios generales del sistema.
     - `GET /api/finanzas/rendimientos`: tasas APY, rendimientos mensuales estimados y topes bonificados de billeteras virtuales y stablecoins (ArgentinaDatos).
     - `GET /api/criptoya/indicadores`: consolidación concurrente resiliente de coeficientes UVA y CER.
   - Capa de caché LRU en memoria en backend (`services/cacheService.js` y `middleware/cacheMiddleware.js`) con capacidad para 2.000 entradas, desalojo estricto $O(1)$, purga periódica cada 60s y políticas de expiración (TTL) diferenciadas por volatilidad del dato:
     - `LIVE_MARKET` (30s): cotizaciones vivas de dólar y cripto.
     - `BANCOS` (60s): cotizaciones bancarias minoristas.
     - `IDENTIFIER_QUERY` (300s / 5m): consultas por CUIT de deudores y cheques.
     - `TRANSPARENCY` / `FINANZAS` (1.800s / 30m): plazos fijos, comisiones, préstamos y rendimientos fintech.
     - `HISTORICAL_SERIES` / `INDICADORES` (3.600s / 1h): series históricas de BCRA, INDEC y coeficientes UVA/CER.
     - `CATALOG` (86.400s / 24h): catálogo de variables y metodologías del BCRA.
     - `FALLBACK_PERSISTENT` (604.800s / 7 días): snapshots en memoria para continuidad operativa ante caídas o fuera de horario (BYMA y CriptoYa).
   - Inyección de cabeceras de trazabilidad: `X-Cache: HIT/MISS/BYPASS`, `X-Cache-TTL` y `X-Cache-Key`.
   - Manejo robusto de contingencias y códigos HTTP upstream (normalización de HTTP 404 del BCRA tratado como situación limpia "Sin Deuda" / "Sin cheques rechazados").
   - Compresión HTTP Gzip/Brotli, rate limiting y aislamiento estricto de agente HTTPS inseguro exclusivamente para el dominio de BYMA (`open.bymadata.com.ar`).

2. **Frontend (SPA ESM Modular Nativo / Chart.js / CSS Tokens):**
   - Single Page Application desacoplada en 12 módulos ESM modernos e independientes bajo `public/js/modules/`:
     - `api.js`: Cliente de servicios HTTP, llamadas a endpoints proxy, timeouts y manejo centralizado de errores.
     - `state.js`: Estado reactivo global (`appState`) y almacén de caché en memoria del cliente (`clientCache`).
     - `utils.js`: Formateadores de moneda y fechas, formato compacto, `debounce` (150ms), validador CUIT por módulo 11, descarga y revocación de Blob URLs.
     - `charts.js`: Fábrica y gestión del ciclo de vida reactivo de Chart.js (`chart.update()`), plugins visuales personalizados (`maxMinLabelPlugin`, `lineShadowPlugin`) y soporte de temas claro/oscuro.
     - `ui.js`: Notificaciones toast, spinners/loaders y selector dinámico de tema.
     - `tabBcra.js`: Controlador de estadísticas monetarias del BCRA (catálogo de ~1.000 variables, series cronológicas, KPIs, gráficos interactivos).
     - `tabIndec.js`: Controlador macroeconómico del INDEC (IPC Nacional, IPC Núcleo, EMAE, RIPTE, Salario vs Inflación base 100).
     - `tabDolares.js`: Controlador del mercado cambiario (Dólar Oficial, Blue, MEP, CCL, Cripto, Mayorista, Tarjeta, tabla de bancos y cálculo de brechas).
     - `tabByma.js`: Controlador de títulos y bonos soberanos BYMA (cotizaciones en vivo, fichas técnicas, flujos de fondos y fallback fuera de horario bursátil).
     - `tabComparador.js`: Comparador de productos financieros (tasas de plazo fijo del BCRA, comisiones, préstamos y tabla de rendimientos APY fintech de ArgentinaDatos).
     - `tabConsultas.js`: Consultas crediticias (Central de Deudores del BCRA con semáforo de riesgo 1 a 6 y validador de cheques denunciados).
     - `tabCripto.js`: Submódulo de integración de CriptoYa (dólar cripto en pestaña Dólares, arbitraje de exchanges y billeteras remuneradas en Comparador).
   - Orquestador raíz en `public/app.js` exportando explícitamente `clientCache` y `debounce` para retrocompatibilidad total con la suite de pruebas automatizadas.
   - Rendimiento cliente optimizado: caché `clientCache` (`Map` con TTL), ciclo de vida reactivo in-place en Chart.js (cero destrucción de canvas, cero flickering), delegación de eventos, debounce en inputs de búsqueda y algoritmos de tabla $O(1)$.
   - Prevención de fugas de memoria con liberación inmediata de Blob URLs (`URL.revokeObjectURL`).
   - 100% de la interfaz de usuario, leyendas, tooltips, tablas, botones y reportes en idioma ESPAÑOL.

3. **Suite de Pruebas Automatizadas (`npm test`):**
   - Ejecución nativa con el motor `node:test` y `node:assert/strict` de Node.js v22 (sin dependencias frágiles externas).
   - Cobertura ampliada a 222 tests en 76 suites de pruebas con 100% de éxito (Exit Code 0) y cero regresiones.
   - Abarca verificación de salud y rutas base, políticas de caché LRU O(1), contratos del BCRA, proxies externos (INDEC, BYMA, DolarApi, ArgentinaDatos), nuevos endpoints CriptoYa y Finanzas, esquemas en `schemaValidator.js`, contingencia y fallbacks ante caídas, snapshots persistentes 24/7, análisis estático ESM sin navegador, detección de ciclos circulares DFS en módulos frontend, pruebas de compresión HTTP (gzip, deflate, bypass), pruebas unitarias puras de `CacheService`, combinaciones cross-feature y pruebas adversariales de estrés.

---

## Feature Inventory

| # | Feature | Description | Milestone | Status |
|---|---------|-------------|-----------|--------|
| 1 | BCRA Monetarias: Catálogo de Variables | Consulta y renderizado de ~1000 variables con filtrado, favoritos y KPIs | M1, M2 | **DONE** |
| 2 | BCRA Monetarias: Series Históricas | Descarga cronológica de datos con paginación, gráficos interactivos y cálculo de rendimientos | M1, M2 | **DONE** |
| 3 | BCRA Monetarias: Metodologías | Notas técnicas y explicaciones conceptuales de cálculo de variables | M1, M2 | **DONE** |
| 4 | BCRA Cambiarias: Cotizaciones Oficiales | Cotizaciones diarias oficiales de divisas internacionales (EUR, USD, BRL) corrigiendo esquema de objeto `{ fecha, detalle: [] }` | M1, M2 | **DONE** |
| 5 | BCRA Transparencia: Plazos Fijos | Comparativa de tasas TNA y rendimiento mensual online por banco | M1, M2 | **DONE** |
| 6 | BCRA Transparencia: Comisiones y Paquetes | Cuadro comparativo de costos de mantenimiento de cuentas y tarjetas | M1, M2 | **DONE** |
| 7 | BCRA Transparencia: Préstamos Personales | Comparador de tasas TNA, TEA y CFT máximo por entidad bancaria | M1, M2 | **DONE** |
| 8 | BCRA Deudores: Consulta Crediticia | Consulta por CUIT con validación módulo 11, semáforo 1-6 y normalización de HTTP 404 ("Sin deuda") | M1, M2 | **DONE** |
| 9 | BCRA Cheques: Validador Denuncias | Verificación de cheques denunciados por robo/extravío/adulteración con normalización de HTTP 404 | M1, M2 | **DONE** |
| 10 | INDEC Series: IPC, Núcleo, EMAE, RIPTE | Extracción y visualización de series macroeconómicas y base 100 Salario vs Inflación | M1, M2 | **DONE** |
| 11 | BYMA Bonos: Panel en Tiempo Real | Cotizaciones de bonos soberanos y letras con soporte fuera de horario bursátil y fallback persistente (7 días) | M1, M2 | **DONE** |
| 12 | BYMA Ficha Técnica & Cash Flow | Ficha de emisión (ley, ISIN, amortización) y proyección de flujo de fondos con sanitización de tickers | M1, M2 | **DONE** |
| 13 | DolarApi & Dólares en Vivo | Cotizaciones en vivo de Dólar Oficial, Blue (compra/venta), MEP, CCL, Mayorista y Tarjeta | M1, M2 | **DONE** |
| 14 | ArgentinaDatos: Series Históricas | Series históricas de dólar, inflación mensual/interanual, UVA y depósitos 30 días | M1, M2 | **DONE** |
| 15 | Backend: Caché en Memoria con TTL | Caché LRU con TTL granular (catálogos 24h, series 1h, transparencia 30m, deudores 5m, mercado 30s) | M1, M1_BACKEND | **DONE** |
| 16 | Backend: Resiliencia, Timeouts y Reintentos | Timeouts uniformes (5s - 15s), reintentos exponenciales con jitter y manejo homogéneo de errores | M1, M1_BACKEND | **DONE** |
| 17 | Backend: Seguridad y Optimización | Aislamiento SSL para BYMA, compresión Gzip/Brotli, rate limiting y sanitización | M1, M1_BACKEND | **DONE** |
| 18 | Frontend: Caché en Cliente (`Map`) | Caché en memoria en el cliente para navegación instantánea (0 ms) entre vistas visitadas | M2, M2_FRONTEND | **DONE** |
| 19 | Frontend: Ciclo de Vida Chart.js | Actualización reactiva in-place `chart.update()` sin destrucción innecesaria de canvas | M2, M2_FRONTEND | **DONE** |
| 20 | Frontend: Delegación de Eventos & Debounce | Event delegation en listas, debounce de 150ms en inputs y optimización $O(1)$ en tablas históricas | M2, M2_FRONTEND | **DONE** |
| 21 | Frontend: Memory Leak Prevention | Revocación inmediata de Blob URLs tras descargas de CSV y PNG | M2, M2_FRONTEND | **DONE** |
| 22 | Testing: Suite Automatizada Base | Suite inicial de 110 pruebas automatizadas en `tests/` ejecutable vía `npm test` | E2E_TRACK, M3 | **DONE** |
| 23 | Reporte de Auditoría Técnica Inicial | Documentación exhaustiva del estado previo, optimizaciones aplicadas y métricas iniciales | M4 | **DONE** |
| 24 | Backend: Endpoints Proxy CriptoYa | Integración de `/api/criptoya/dolar`, `/api/criptoya/cripto/:coin?/:fiat?`, `/api/criptoya/bancos` e `/api/criptoya/indicadores` con caché LRU y fallbacks persistentes (7 días) | M1_BACKEND | **DONE** |
| 25 | Backend: Rendimientos Fintech & Tasas | Integración de `/api/finanzas/rendimientos` para cuentas remuneradas y billeteras (Mercado Pago, Belo, Lemon, etc.) | M1_BACKEND | **DONE** |
| 26 | Backend: Validación y Sanitización de Contratos | Módulo `services/schemaValidator.js` para números finitos, porcentajes, fechas ISO y contención de nulos | M1_BACKEND | **DONE** |
| 27 | Frontend: Arquitectura Modular ESM | Desacople de `public/app.js` en 12 módulos ESM bajo `public/js/modules/` con carga por `<script type="module">` | M2_FRONTEND | **DONE** |
| 28 | Frontend: Integración Visual CriptoYa | Tarjetas de Dólar Cripto en Mercado Cambiario, tabla de Billeteras Remuneradas en Comparador y cotizaciones bancarias 100% en español | M2_FRONTEND | **DONE** |
| 29 | Testing: Suites Ampliadas y Verificación E2E | Implementación de `tests/criptoya.test.js`, `tests/frontend-esm.test.js`, `tests/criptoya-resilience.test.js` y tests empíricos alcanzando 184 tests exitosos (Exit Code 0) | M3_TESTS | **DONE** |
| 30 | Documentación: Actualización Técnica Integral | Actualización exhaustiva de `PROJECT.md` y `AUDIT_REPORT.md` reflejando las nuevas fuentes, arquitectura ESM y compuertas aprobadas | M4_DOCS | **DONE** |
| 31 | Backend: Desactivación de proxy para loopback local | Detección determinística de loopback (`127.0.0.1`, `localhost`, `::1`) en `httpClient.js` con `{ proxy: false }` para evitar errores 400 por `HTTP_PROXY` | M1_BACKEND_RESILIENCE | **DONE** |
| 32 | Backend: Snapshot de contingencia y timeout INDEC | Resiliencia 24/7 con `data/indec_series_snapshot.json` (39 períodos, 10 series) y timeout preventivo de 5s en `server.js` | M1_BACKEND_RESILIENCE | **DONE** |
| 33 | Backend: Tolerancia ante HTTP 502 del BCRA en Deudores | Normalización controlada a HTTP 200 limpio sin deuda o propagación estructurada ante fallas 502/429 upstream | M1_BACKEND_RESILIENCE | **DONE** |
| 34 | Frontend: Idempotencia en tabBcra.js | Cláusula de guarda `if (this.initialized) return;` en `tabBcra.init()` evitando duplicación de event listeners | M2_FRONTEND_PERF | **DONE** |
| 35 | Frontend: Ciclo de vida in-place y temas en tabByma.js | Actualización in-place con `chart.update('active')`, registro en `activeCharts` y soporte reactivo de temas claro/oscuro | M2_FRONTEND_PERF | **DONE** |
| 36 | Frontend: Poda preventiva y límite LRU en clientCache | Límite de 200 entradas (`maxEntries`), reordenamiento LRU en `.get()` y poda preventiva en `state.js` | M2_FRONTEND_PERF | **DONE** |
| 37 | Backend: Sincronización LRU y métricas en cacheService | `getEntry()` incrementa hits/misses y reposiciona claves en el Map para desalojo estricto LRU $O(1)$ | M3_CACHE_COMPRESSION | **DONE** |
| 38 | Backend: Presets TTL en cacheService | Incorporación de presets oficiales `BANCOS: 60`, `INDICADORES: 3600`, `FINANZAS: 1800` en `this.TTL` | M3_CACHE_COMPRESSION | **DONE** |
| 39 | Testing: Suites de compresión HTTP y unitarios de caché | `tests/compression.test.js` (gzip >1KB, sin compresión <1KB, bypass `x-no-compression`, deflate) y `tests/cacheService.unit.test.js` (LRU 2.000, purga, hitRate) | M3_CACHE_COMPRESSION | **DONE** |
| 40 | Verificación E2E y Certificación Final v2.6.0-PROD | Certificación de 222 tests en 76 suites (Exit Code 0), actualización de AUDIT_REPORT.md y PROJECT.md | M4_E2E_VERIFICATION_REPORT | **DONE** |

---

## Milestones

| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| **E2E_TRACK** | E2E Testing Suite Track | Creación de infraestructura de pruebas y casos Tiers 1-4 en `tests/` con runner nativo `node:test` | none | **DONE** |
| **M1** | Backend Refactor & Resiliency | Caché en memoria con TTL, timeouts/retries, corrección de esquemas y códigos de error (404), compresión, seguridad SSL BYMA | none | **DONE** |
| **M2** | Frontend Performance & Schema Sync | Caché de cliente en Map, optimización Chart.js, delegación de eventos, debounce, corrección esquema cambiarias y deudores, 100% español | M1 | **DONE** |
| **M3** | Final Verification & Adversarial Hardening | Pase del 100% de la suite de tests E2E y hardening adversarial con Challenger (110 tests aprobados) | E2E_TRACK, M1, M2 | **DONE** |
| **M1_BACKEND** | Backend APIs & Schema Validation | Implementar `services/schemaValidator.js`, endpoints proxy CriptoYa/Finanzas en `server.js`, caché LRU y contingencias | none | **DONE** |
| **M2_FRONTEND** | Frontend ESM Modularization & UI | Desacoplar `public/app.js` en 12 módulos ESM en `public/js/modules/`, cargar `<script type="module">`, integrar vistas de cripto/rendimientos | M1_BACKEND | **DONE** |
| **M3_TESTS** | Test Suite Expansion & E2E Verification | Implementar suites de pruebas de CriptoYa, resiliencia y análisis estático ESM, validando 184 tests en `npm test` con Exit Code 0 | M1_BACKEND, M2_FRONTEND | **DONE** |
| **M4_DOCS** | Technical Audit Report & Release Integration | Actualización integral de `AUDIT_REPORT.md` y `PROJECT.md`, certificación de contratos y reporte final | M3_TESTS | **DONE** |
| **M1_BACKEND_RESILIENCE** | Backend Resilience & APIs (v2.6) | httpClient loopback proxy fix, INDEC timeout 5s con snapshot persistente, tolerancia 502 del BCRA | none | **DONE** |
| **M2_FRONTEND_PERF** | Frontend Performance & Lifecycle (v2.6) | Idempotencia en tabBcra, ciclo in-place en Chart.js de BYMA con sincronización de temas, poda LRU en clientCache (200) | none | **DONE** |
| **M3_CACHE_COMPRESSION** | Cache LRU & HTTP Compression (v2.6) | Sincronización de hits/misses y LRU en cacheService.getEntry, TTLs BANCOS/INDICADORES/FINANZAS, suites de compresión y caché unitaria | M1_BACKEND_RESILIENCE | **DONE** |
| **M4_E2E_VERIFICATION_REPORT** | E2E Verification & Audit Release (v2.6.0-PROD) | Certificación de 222 tests en 76 suites (100% pass, Exit Code 0), actualización exhaustiva de AUDIT_REPORT.md y PROJECT.md | M1_BACKEND_RESILIENCE, M2_FRONTEND_PERF, M3_CACHE_COMPRESSION | **DONE** |

---

## Code Layout

```
bcra-monetarias/
├── server.js                      # Servidor Express, proxies (BCRA, INDEC, BYMA, DolarApi, CriptoYa, Finanzas)
├── package.json                   # Dependencias y script "test": "node --test tests/**/*.test.js"
├── data/
│   ├── byma_bonds_snapshot.json   # Snapshot de contingencia 24/7 para bonos BYMA fuera de horario bursátil
│   └── indec_series_snapshot.json # Snapshot persistente de 39 períodos cronológicos para 10 series INDEC
├── services/
│   ├── cacheService.js            # Gestor de caché LRU en memoria con TTL granular, sincronización O(1) y snapshots
│   ├── httpClient.js              # Cliente HTTP con timeouts, reintentos con backoff, bypass proxy loopback y agente SSL
│   └── schemaValidator.js         # Validación, sanitización y normalización de contratos financieros
├── middleware/
│   ├── cacheMiddleware.js         # Middleware de caché Express transparente con cabeceras X-Cache
│   └── errorHandler.js            # Manejo centralizado de contingencias y respuestas no bloqueantes
├── public/
│   ├── index.html                 # SPA 100% en español con <script type="module" src="app.js"></script>
│   ├── style.css                  # Variables de tema oscuro/claro, layout responsivo y componentes CriptoYa
│   ├── app.js                     # Orquestador raíz ESM con exportación retrocompatible de clientCache y debounce
│   └── js/
│       └── modules/
│           ├── api.js             # Servicios de llamada HTTP a endpoints proxy con control de timeouts
│           ├── state.js           # Almacén de estado reactivo global (appState) y clientCache Map con poda LRU (200)
│           ├── charts.js          # Fábrica Chart.js, actualización reactiva in-place, activeCharts y plugins de diseño
│           ├── utils.js           # Formateadores, debounce (150ms), validador CUIT módulo 11, Blob downloader
│           ├── ui.js              # Notificaciones toast, spinners de carga y alternancia de tema claro/oscuro
│           ├── tabBcra.js         # Controlador de Tab BCRA (guarda de inicialización idempotente, catálogo, KPIs)
│           ├── tabIndec.js        # Controlador de Tab INDEC (inflación, actividad, base 100)
│           ├── tabDolares.js      # Controlador de Tab Dólares y Mercado Cambiario (oficial, blue, mep, ccl, bancos)
│           ├── tabByma.js         # Controlador de Tab BYMA (actualización in-place de canvas, temas, flujos y fallback)
│           ├── tabComparador.js   # Controlador de Tab Comparador (plazos fijos BCRA y rendimientos fintech)
│           ├── tabConsultas.js    # Controlador de Tab Consultas (Central de Deudores resiliente 502 y validador de Cheques)
│           └── tabCripto.js       # Submódulo para componentes CriptoYa, arbitraje y billeteras remuneradas
├── tests/
│   ├── helpers/                   # Setup de servidor efímero y fixtures de prueba
│   ├── health.test.js             # Verificación de servidor, rutas base y middlewares
│   ├── cache.test.js              # Validación de TTL, hits/misses y respuesta ultrarrápida en memoria
│   ├── bcra.test.js               # Tests de endpoints BCRA (Monetarias, Cambiarias, Transparencia, Deudores, Cheques)
│   ├── proxies.test.js            # Tests de INDEC, BYMA, DolarApi, ArgentinaDatos y contingencias
│   ├── cross_feature.test.js      # Combinaciones cross-feature (tasas, brechas, bonos)
│   ├── scenarios.test.js          # Escenarios de usuario completos y navegación multitab
│   ├── adversarial-empirical.test.js # Pruebas empíricas adversariales de 404, BYMA y reintentos
│   ├── tier5-e2e-adversarial.test.js # Pruebas adversariales Tier 5 completas
│   ├── bcra-normalization.test.js # Validación matemática de CUITs y normalización 404
│   ├── server.test.js             # Rutas de salud, estadísticas de caché y cabeceras
│   ├── httpClient.test.js         # Timeouts, backoff exponencial, bypass proxy local y aislamiento SSL
│   ├── resilience.test.js         # Resiliencia general ante caídas de proveedores upstream
│   ├── criptoya.test.js           # Tests de contratos, esquemas, bancos y arbitraje CriptoYa
│   ├── criptoya-resilience.test.js # Tests de contingencia, fallbacks por snapshot y timeout en CriptoYa
│   ├── frontend-esm.test.js       # Verificación estática de sintaxis ESM, detección de ciclos DFS, idempotencia y poda
│   ├── challenger_empirical.test.js # Batería de validación empírica y stress testing
│   ├── compression.test.js        # Validación de compresión HTTP Gzip, Deflate y bypass x-no-compression
│   └── cacheService.unit.test.js  # Pruebas unitarias puras de CacheService (LRU O(1), TTL, purga, hitRate)
├── AUDIT_REPORT.md                # Reporte técnico integral de auditoría, optimización y certificación v2.6.0-PROD
└── PROJECT.md                     # Documento maestro de arquitectura y especificación
```

---

## Interface Contracts

### 1. Backend ↔ Frontend Contract: Series Temporales (BCRA)
```json
{
  "status": 200,
  "results": [
    {
      "idVariable": 1,
      "descripcion": "Reservas Internacionales del BCRA",
      "detalle": [
        { "fecha": "2026-08-24", "valor": 50776.0 }
      ]
    }
  ],
  "cached": true,
  "timestamp": "2026-08-27T12:00:00.000Z"
}
```

### 2. Backend ↔ Frontend Contract: Central de Deudores (Normalización 404 / 200)
- Si el CUIT no tiene deuda registrada en el BCRA (upstream responde HTTP 404):
```json
{
  "status": 200,
  "results": {
    "identificacion": 20300000001,
    "denominacion": "CONTRIBUYENTE CONSULTADO",
    "periodos": [],
    "tieneDeuda": false,
    "peorSituacion": 1,
    "situacion": 1,
    "totalDeuda": 0,
    "entidades": [],
    "chequesRechazados": [],
    "mensaje": "No se registran deudas en el sistema financiero (Situación 1 Normal)."
  }
}
```

### 3. Backend ↔ Frontend Contract: Cotizaciones Cambiarias Oficiales (BCRA)
```json
{
  "status": 200,
  "results": {
    "fecha": "2026-08-27",
    "detalle": [
      { "codigoMoneda": "USD", "descripcion": "Dólar Estadounidense", "tipoPase": 1, "tipoCotizacion": 1350.50 }
    ]
  }
}
```

### 4. Backend ↔ Frontend Contract: CriptoYa Dólar Unificado y Brechas (`/api/criptoya/dolar`)
```json
{
  "status": 200,
  "results": {
    "oficial": { "compra": 1330.00, "venta": 1370.00, "precio": 1370.00, "variacion": 0.15, "timestamp": 1725410000 },
    "blue": { "compra": 1420.00, "venta": 1440.00, "precio": 1440.00, "variacion": -0.35, "timestamp": 1725410000 },
    "mep": { "compra": 1395.20, "venta": 1398.50, "precio": 1398.50, "variacion": 0.40, "timestamp": 1725410000 },
    "ccl": { "compra": 1405.10, "venta": 1409.80, "precio": 1409.80, "variacion": 0.22, "timestamp": 1725410000 },
    "cripto": { "compra": 1430.00, "venta": 1445.00, "precio": 1445.00, "variacion": 0.10, "timestamp": 1725410000 },
    "tarjeta": { "compra": 1330.00, "venta": 1781.00, "precio": 1781.00, "variacion": 0.15, "timestamp": 1725410000 },
    "mayorista": { "compra": 1345.00, "venta": 1348.00, "precio": 1348.00, "variacion": 0.05, "timestamp": 1725410000 },
    "brechas": {
      "blueVsOficial": 5.11,
      "mepVsOficial": 2.08,
      "cclVsOficial": 2.91,
      "criptoVsOficial": 5.47
    }
  },
  "cached": true,
  "timestamp": "2026-09-04T04:00:00.000Z"
}
```

### 5. Backend ↔ Frontend Contract: CriptoYa Arbitraje Cripto (`/api/criptoya/cripto/:coin?/:fiat?`)
```json
{
  "status": 200,
  "results": {
    "pair": "USDT/ARS",
    "results": [
      { "exchange": "fiwind", "compra": 1425.10, "compraTotal": 1425.10, "venta": 1410.00, "ventaTotal": 1410.00, "timestamp": 1725410000 },
      { "exchange": "lemoncash", "compra": 1432.50, "compraTotal": 1432.50, "venta": 1428.00, "ventaTotal": 1428.00, "timestamp": 1725410000 },
      { "exchange": "belo", "compra": 1435.00, "compraTotal": 1435.00, "venta": 1429.50, "ventaTotal": 1429.50, "timestamp": 1725410000 }
    ],
    "arbitraje": {
      "mejorCompra": { "exchange": "fiwind", "precioTotal": 1425.10 },
      "mejorVenta": { "exchange": "belo", "precioTotal": 1429.50 },
      "spreadPorcentaje": 0.31,
      "oportunidad": true
    }
  },
  "cached": true,
  "timestamp": "2026-09-04T04:00:00.000Z"
}
```

### 6. Backend ↔ Frontend Contract: CriptoYa Cotizaciones Bancarias (`/api/criptoya/bancos`)
```json
{
  "status": 200,
  "results": {
    "results": [
      { "codigo": "bna", "nombre": "Banco Nación", "compra": 1330.00, "venta": 1370.00, "spread": 40.00, "timestamp": 1725410000 },
      { "codigo": "galicia", "nombre": "Banco Galicia", "compra": 1335.00, "venta": 1375.00, "spread": 40.00, "timestamp": 1725410000 },
      { "codigo": "santander", "nombre": "Banco Santander", "compra": 1332.00, "venta": 1372.00, "spread": 40.00, "timestamp": 1725410000 }
    ],
    "promedio": {
      "compra": 1332.33,
      "venta": 1372.33
    }
  },
  "cached": true,
  "timestamp": "2026-09-04T04:00:00.000Z"
}
```

### 7. Backend ↔ Frontend Contract: Rendimientos Fintech ArgentinaDatos (`/api/finanzas/rendimientos`)
```json
{
  "status": 200,
  "results": [
    {
      "entidad": "naranjax",
      "nombre": "Naranja X",
      "moneda": "ARS",
      "apy": 42.00,
      "rendimientoMensual": 3.50,
      "topeBonificado": 600000,
      "bonoApy": 45.00,
      "fecha": "2026-09-04"
    },
    {
      "entidad": "mercadopago",
      "nombre": "Mercado Pago",
      "moneda": "ARS",
      "apy": 37.50,
      "rendimientoMensual": 3.13,
      "topeBonificado": null,
      "fecha": "2026-09-04"
    },
    {
      "entidad": "belo",
      "nombre": "Belo",
      "moneda": "ARS",
      "apy": 36.80,
      "rendimientoMensual": 3.07,
      "topeBonificado": null,
      "fecha": "2026-09-04"
    }
  ],
  "cached": true,
  "timestamp": "2026-09-04T04:00:00.000Z"
}
```

### 8. Backend ↔ Frontend Contract: Indicadores UVA y CER (`/api/criptoya/indicadores`)
```json
{
  "status": 200,
  "results": {
    "uva": {
      "valor": 1284.50,
      "timestamp": 1725410000,
      "fecha": "2026-09-04"
    },
    "cer": {
      "valor": 482.30,
      "timestamp": 1725410000,
      "fecha": "2026-09-04"
    }
  },
  "cached": true,
  "timestamp": "2026-09-04T04:00:00.000Z"
}
```

---
*Fin de PROJECT.md*
