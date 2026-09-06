# TEST_READY — Suite de Pruebas Automatizadas Lista

**Fecha:** 2026-08-27  
**Agente Responsable:** `test_writer_e2e`  
**Estado:** LISTO / OPERATIVO

---

## 1. Declaración de Completitud

Se ha diseñado, construido y verificado exitosamente la suite integral de pruebas automatizadas para el proyecto **BCRADATOS / bcra-monetarias**. La suite cubre de forma completa y rigurosa los 4 Tiers metodológicos y la totalidad de los 23 ítems del Feature Inventory definidos en `PROJECT.md`.

---

## 2. Inventario de Archivos de Pruebas Entregados

| Archivo | Tier | Casos de Prueba | Descripción |
|---|---|---|---|
| `tests/helpers/setup.js` | Infraestructura | Helper | Servidor efímero `listen(0)` con cliente HTTP nativo `fetch` y `AbortController`. |
| `tests/helpers/fixtures.js` | Infraestructura | Fixtures | CUITs institucionales (AFIP, YPF, Sin Deuda), IDs BCRA, tickers BYMA y series INDEC. |
| `tests/health.test.js` | Tier 1 | 7 tests | Salud del servidor, entrega de estáticos (`index.html`, `style.css`, `app.js`), CORS, fallback SPA. |
| `tests/bcra.test.js` | Tier 1 | 10 tests | Endpoints oficiales del BCRA (Monetarias catálogo/series, Metodologías, Cambiarias, Transparencia, Deudores, Cheques). |
| `tests/proxies.test.js` | Tier 1 | 8 tests | Proxies externos (INDEC Series, BYMA Bonos/Fichas/Históricos, DolarApi Casas, ArgentinaDatos, Data912 MEP). |
| `tests/cache.test.js` | Tier 2 | 5 tests | Integridad de datos en memoria, latencia en consultas repetidas, segmentación por query params, idempotencia. |
| `tests/resilience.test.js` | Tier 2 | 9 tests | Normalización de 404 del BCRA ("Sin Deuda"), CUITs inválidos, contingencia de BYMA fuera de horario, timeouts. |
| `tests/cross_feature.test.js` | Tier 3 | 5 tests | Integraciones cruzadas (Cálculo de brecha cambiaria, comparador de tasas de interés, IPC vs inflación, cruce bonos). |
| `tests/scenarios.test.js` | Tier 4 | 5 tests | Escenarios reales de usuario: carga de dashboard general, análisis macro, diagnóstico de CUIT, filtrado cronológico. |
| `TEST_INFRA.md` | Documentación | Guía | Arquitectura del runner nativo de Node.js v22, comandos y guía de extensión. |

**Total:** 7 archivos de suite de pruebas + 2 helpers de infraestructura + 49 casos de prueba.

---

## 3. Instrucciones de Ejecución

Para correr la suite de pruebas completa:
```bash
node --test tests/**/*.test.js
```

Para correr cualquier suite específica:
```bash
node --test tests/health.test.js
node --test tests/bcra.test.js
node --test tests/proxies.test.js
node --test tests/cache.test.js
node --test tests/resilience.test.js
node --test tests/cross_feature.test.js
node --test tests/scenarios.test.js
```

---

## 4. Próximos Pasos para los Agentes Implementadores (M1 / M2 / M3)

1. **Backend (M1):** Utilizar `tests/cache.test.js` y `tests/resilience.test.js` como oráculo de verificación para la implementación de la capa de caché en memoria y la normalización de respuestas de la Central de Deudores (404 a 200 limpio).
2. **Frontend (M2):** Verificar la sincronización de esquemas de datos utilizando las respuestas validadas en `tests/bcra.test.js` y `tests/proxies.test.js`.
3. **Verificación Final (M3):** Ejecutar `node --test tests/**/*.test.js` para asegurar que el 100% de los 49 casos de prueba se ejecuten de forma limpia y exitosa.
