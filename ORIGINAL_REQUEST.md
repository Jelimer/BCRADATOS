# Original User Request

## Initial Request — 2026-08-27T12:21:49Z

Auditoría integral, resolución de problemas de conectividad con APIs externas (BCRA, INDEC, DolarApi, ArgentinaDatos, BYMA) y optimización técnica de arquitectura y rendimiento en backend y frontend.

Working directory: C:\Users\jelim\.gemini\antigravity\scratch\bcra-monetarias
Integrity mode: development

## Requirements

### R1. Diagnóstico, actualización y resiliencia de APIs externas
Verificar y actualizar la totalidad de los servicios y proxies externos integrados en el proyecto (BCRA Estadísticas Monetarias v4.0, Cambiarias v1.0, Transparencia, Central de Deudores, Cheques; INDEC Series de Tiempo; BYMA Bonos e Históricos; DolarApi; y ArgentinaDatos). Corregir desajustes en rutas, formatos de respuesta (objetos vs arreglos) o encabezados, implementando contingencias ante indisponibilidad o fallos upstream.

### R2. Optimización de rendimiento, código y arquitectura
Refactorizar y optimizar tanto el servidor Express (`server.js`) como la aplicación cliente (`public/app.js`), reduciendo código repetitivo o monolítico, agregando mecanismos de caché en memoria o control de reintentos para consultas pesadas a APIs externas, y optimizando la carga y rendering de datos históricos extensos en gráficos y tablas sin perder funcionalidades visuales existentes.

### R3. Automatización de pruebas y verificación programática
Implementar una suite de pruebas automatizadas ejecutable mediante `npm test` que valide la conectividad, códigos de estado HTTP y contratos de datos de cada ruta proxy del servidor, garantizando que el sistema sea verificable de forma reproducible.

## Acceptance Criteria

### Conectividad y Contratos de APIs
- [ ] Todos los endpoints proxy (`/api/monetarias`, `/api/monetarias/:id`, `/api/metodologia`, `/api/indec/series`, `/api/mercado/live/:tipo`, `/api/byma/...`, `/api/bcra-cambiarias/...`, `/api/bcra-transparencia/...`, `/api/bcra-deudores/...`, `/api/bcra-cheques/...`, `/api/mercado-dolarapi/...`, `/api/argentinadatos/...`) responden con status HTTP 200 y esquemas de datos válidos con servicios upstream activos.
- [ ] La consulta histórica de variables del BCRA (`/api/monetarias/:id`) extrae y entrega correctamente la serie cronológica (`detalle` con fecha y valor) respetando los límites y paginación de la API oficial v4.0.
- [ ] Se gestionan respuestas de contingencia controladas y no bloqueantes (códigos y mensajes descriptivos) cuando alguna fuente externa rechaza peticiones o está fuera de servicio.

### Rendimiento y Calidad
- [ ] El servidor Express inicia en el puerto configurado sin excepciones no capturadas ni advertencias de dependencias obsoletas críticas.
- [ ] Se implementa un mecanismo de caché en el backend para endpoints de catálogo y series históricas con baja frecuencia de cambio, reduciendo la latencia y previniendo bloqueos por rate-limiting de las APIs oficiales.
- [ ] La aplicación frontend (`public/app.js`) carga sin errores en consola y conserva al 100% las vistas operativas: tablero BCRA con KPIs y gráficos, INDEC, panel de Dólares con cálculo de brechas, bonos BYMA, comparador multivariable y consultas de deudores/cheques.

### Verificación y Pruebas
- [ ] El comando `npm test` está configurado en `package.json` y ejecuta exitosamente una suite de pruebas automatizadas que reporta el estado de salud de cada módulo y endpoint.
- [ ] Se incluye un reporte final de auditoría técnica documentando el estado previo, las optimizaciones aplicadas y los resultados de las pruebas.

## Follow-up — 2026-09-04T02:56:02Z

Investigación de versiones y endpoints más recientes de APIs financieras argentinas, integración de nuevas fuentes vigentes de alto valor, modularización arquitectónica del frontend (desacople de app.js en ESM) y validación estricta de esquemas de datos.

Working directory: C:\Users\jelim\.gemini\antigravity\scratch\bcra-monetarias
Integrity mode: development

## Requirements

### R1. Relevamiento e integración de APIs financieras avanzadas y vigentes
Investigar y verificar la vigencia de los endpoints oficiales del BCRA (identificando si existen nuevas versiones o rutas activas complementarias) y evaluar la integración de nuevas APIs de alto valor para el ecosistema financiero argentino (ej. CriptoYa para cotizaciones de dólar cripto / arbitrajes, o tasas del sistema financiero adicionales), asegurando contratos estables, control de reintentos y caché LRU en el backend.

### R2. Modularización y modernización de la arquitectura frontend
Reestructurar el código cliente monolítico (`public/app.js`) en módulos ESM modernos y desacoplados por dominio (servicios de API, estado global, utilidades de Chart.js y controladores de cada tab: BCRA, INDEC, Dólares, BYMA, Comparador y Consultas), asegurando carga eficiente, cero regresiones visuales y preservando la interfaz 100% en español.

### R3. Validación robusta de contratos de datos
Incorporar mecanismos de validación y sanitización para las respuestas de las APIs externas, previniendo fallos por cambios sutiles de esquema en proveedores upstream o valores nulos imprevistos.

### R4. Ampliación y ejecución de la suite de pruebas automatizadas
Actualizar y extender la suite de pruebas de `npm test` con el runner nativo de Node.js, garantizando la cobertura de los nuevos endpoints, la validación de esquemas y la carga limpia de los módulos frontend.

## Acceptance Criteria

### Integración de APIs y Resiliencia
- [ ] Los nuevos endpoints proxy de APIs vigentes investigadas se encuentran operativos en el servidor Express con políticas de caché y fallbacks controlados.
- [ ] Se verifica que todos los endpoints existentes y nuevos respondan con HTTP 200 y datos estructurados válidos.

### Modularización y Frontend
- [ ] El archivo monolítico de frontend es descompuesto en módulos ESM limpios y legibles dentro de `public/` (ej. `public/js/modules/...`), mejorando la mantenibilidad.
- [ ] Todas las vistas (tablero BCRA, panel INDEC, Dólares con brechas, bonos BYMA, comparador multivariable y deudores) funcionan al 100% sin errores ni excepciones en consola.

### Validación y Calidad
- [ ] Las respuestas de APIs cuentan con filtros y validaciones para evitar inconsistencias en el renderizado de gráficos y tablas.
- [ ] El comando `npm test` ejecuta con éxito la suite completa ampliada, logrando un 100% de pruebas aprobadas sin fallos (Exit Code 0).
- [ ] Se genera o actualiza la documentación técnica en el repositorio detallando las nuevas APIs incorporadas, la nueva estructura modular y las mejoras implementadas.



## Follow-up — 2026-10-09T17:59:24Z

Auditoría integral 360°, optimización de rendimiento y verificación profunda de resiliencia y estabilidad del proyecto bcra-monetarias (backend Express, frontend modular SPA y proxies de APIs financieras argentinas).

Working directory: C:\Users\jelim\.gemini\antigravity\scratch\bcra-monetarias
Integrity mode: development

## Requirements

### R1. Auditoría, resiliencia y contratos de APIs financieras en backend
Verificar y auditar de forma integral todos los servicios proxy integrados en el backend (BCRA Estadísticas Monetarias v4.0, Cambiarias v1.0, Transparencia, Central de Deudores, Cheques; INDEC Series de Tiempo; BYMA Bonos e Históricos con fallback persistente 24/7; DolarApi; ArgentinaDatos; y CriptoYa). Identificar posibles cuellos de botella, timeouts innecesarios o inconsistencias en manejo de errores, asegurando que ante fallas temporales o fuera de horario bursátil el sistema mantenga alta disponibilidad sin excepciones no controladas.

### R2. Optimización de rendimiento, tiempos de respuesta y renderizado en frontend
Analizar el código modular del cliente (`public/js/modules/`) y sus interacciones con Chart.js y el DOM. Optimizar los ciclos de renderizado de gráficos, la destrucción y reutilización de instancias de canvas, la paginación y ordenamiento de tablas extensas, garantizando una experiencia fluida, libre de memory leaks y con cero advertencias o excepciones en la consola del navegador.

### R3. Eficiencia en gestión de caché, compresión y consumo de recursos
Revisar las políticas de TTL y estrategias de almacenamiento en caché en memoria (`services/cacheService.js` y `middleware/cacheMiddleware.js`), optimizando el hit rate para series históricas pesadas, asegurando encabezados `X-Cache` consistentes y verificando que la compresión gzip/deflate opere eficientemente en payloads grandes.

### R4. Verificación programática, cobertura de tests y reporte de auditoría
Ejecutar, consolidar y validar la suite completa de pruebas automatizadas (`npm test`), asegurando que todos los tests pasen exitosamente con 0 fallos. Elaborar un reporte técnico actualizado documentando los hallazgos identificados, las optimizaciones aplicadas y los indicadores de rendimiento resultantes.

## Acceptance Criteria

### Estabilidad y Contratos de APIs
- [ ] Todos los endpoints proxy (`/api/monetarias`, `/api/monetarias/:id`, `/api/byma/...`, `/api/indec/series`, `/api/bcra-cambiarias/...`, `/api/bcra-deudores/...`, `/api/bcra-cheques/...`, `/api/mercado-dolarapi/...`, `/api/argentinadatos/...`, `/api/byma/indicadores`) responden con códigos HTTP controlados (200 OK en operación normal o fallbacks estructurados) y esquemas válidos.
- [ ] La resiliencia 24/7 de BYMA y Central de Deudores entrega datos coherentes y nunca deja pantallas en blanco o tablas vacías fuera de horario bancario/bursátil.

### Rendimiento y Calidad de Frontend
- [ ] Los 6 módulos visuales (BCRA, INDEC, Dólares y Brechas, Bonos BYMA, Comparador Bancario y Consultas de Deudores/Cheques) cargan sin errores en consola y mantienen la interfaz 100% en español.
- [ ] La navegación e interacción con gráficos Chart.js (cambio de rangos temporales, métricas y tooltips) responde con fluidez sin retardo perceptible ni fugas de memoria.

### Eficiencia y Verificación
- [ ] El servidor Express inicia en el puerto configurado de manera estable, registrando estadísticas de caché saludables con hit rate medible y tiempos de respuesta reducidos para consultas recurrentes.
- [ ] El comando `npm test` se ejecuta sin errores (Exit Code 0), aprobando el 100% de los casos de prueba de forma reproducible.
- [ ] Se incluye o actualiza un informe técnico detallando las verificaciones realizadas, optimizaciones implementadas y el estado operativo final del sistema.
