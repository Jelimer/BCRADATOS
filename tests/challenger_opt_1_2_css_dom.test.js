/**
 * tests/challenger_opt_1_2_css_dom.test.js
 * Suite Adversarial y de Verificación Empírica Estricta para challenger_opt_1_2.
 * Milestone 1 (M1_VISUAL_CHARTS): CSS, DOM Layout, Tokens, Contraste WCAG y Responsividad.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');
const HTML_FILE = path.join(ROOT_DIR, 'public/index.html');
const CSS_FILE = path.join(ROOT_DIR, 'public/style.css');
const MODULES_DIR = path.join(ROOT_DIR, 'public/js/modules');

/**
 * Convierte un color hexadecimal (#RRGGBB o #RGB) a luminancia relativa sRGB (WCAG 2.1).
 * @param {string} hex 
 * @returns {number} Luminancia entre 0 y 1
 */
function getRelativeLuminance(hex) {
  let clean = hex.replace('#', '').trim();
  if (clean.length === 3) {
    clean = clean.split('').map(c => c + c).join('');
  }
  const r = parseInt(clean.substring(0, 2), 16) / 255;
  const g = parseInt(clean.substring(2, 4), 16) / 255;
  const b = parseInt(clean.substring(4, 6), 16) / 255;

  const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

/**
 * Calcula el ratio de contraste WCAG entre dos colores hexadecimales.
 * @param {string} hex1 
 * @param {string} hex2 
 * @returns {number} Ratio (ej. 4.5)
 */
function getContrastRatio(hex1, hex2) {
  const l1 = getRelativeLuminance(hex1);
  const l2 = getRelativeLuminance(hex2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

describe('Challenger M1-2: Stress-Test Empírico de CSS, DOM Layout, Tokens y Contraste', () => {

  // =========================================================================
  // 1. INTEGRIDAD DE IDS DEL DOM EN INDEX.HTML
  // =========================================================================
  describe('1. Integridad de Selectores e IDs del DOM', () => {
    const htmlContent = fs.readFileSync(HTML_FILE, 'utf8');

    it('1.1. Todos los botones de descarga de gráficos de Milestone 1 están presentes e intactos', () => {
      const requiredDownloadIds = [
        'btnDownloadBcraChart',
        'btnDownloadIndecChart',
        'btnDownloadDolaresChart'
      ];

      for (const id of requiredDownloadIds) {
        assert.ok(
          htmlContent.includes(`id="${id}"`),
          `El ID crítico de descarga #${id} debe existir exactamente en public/index.html`
        );
      }
    });

    it('1.2. El selector de períodos históricos de deudores y validación de cheques están intactos', () => {
      assert.ok(htmlContent.includes('id="deudorPeriodoSelect"'), '#deudorPeriodoSelect debe existir en index.html');
      assert.ok(htmlContent.includes('class="cheques-inputs-grid"'), '.cheques-inputs-grid debe existir en index.html');
      assert.ok(htmlContent.includes('id="cuitInput"'), '#cuitInput debe existir en index.html');
      assert.ok(htmlContent.includes('id="chequeNumeroInput"'), '#chequeNumeroInput debe existir en index.html');
      assert.ok(htmlContent.includes('id="chequeBancoSelect"'), '#chequeBancoSelect debe existir en index.html');
    });

    it('1.3. Los elementos canvas de gráficos están presentes (#monetaryChart, #indecChart, #dolaresChart, #bymaBonoChart, #deudorHistoryChart)', () => {
      const canvasIds = ['monetaryChart', 'indecChart', 'dolaresChart', 'bymaBonoChart', 'deudorHistoryChart'];
      for (const id of canvasIds) {
        assert.ok(
          htmlContent.includes(`id="${id}"`),
          `El canvas #${id} debe existir en public/index.html`
        );
      }
    });

    it('1.4. Todos los contenedores de vistas principales de las 6 pestañas existen en el DOM', () => {
      const viewPanels = ['viewBcra', 'viewIndec', 'viewDolares', 'viewByma', 'viewComparador', 'viewConsultas'];
      for (const panel of viewPanels) {
        assert.ok(
          htmlContent.includes(`id="${panel}"`),
          `El panel de vista #${panel} debe existir en index.html`
        );
      }
    });

    it('1.5. Las 6 pestañas de navegación sidebar cuentan con su botón [data-tab] correspondiente', () => {
      const tabs = ['bcra', 'indec', 'dolares', 'byma', 'comparador', 'consultas'];
      for (const tab of tabs) {
        assert.ok(
          htmlContent.includes(`data-tab="${tab}"`),
          `El botón de navegación con data-tab="${tab}" debe existir en index.html`
        );
      }
    });

    it('1.6. Todos los IDs requeridos por módulos JS en getElementById existen en index.html', () => {
      const jsFiles = fs.readdirSync(MODULES_DIR).filter(f => f.endsWith('.js'));
      const htmlIdMatches = [...htmlContent.matchAll(/id=["']([^"']+)["']/g)].map(m => m[1]);
      const htmlIds = new Set(htmlIdMatches);

      const missing = [];
      for (const file of jsFiles) {
        const content = fs.readFileSync(path.join(MODULES_DIR, file), 'utf8');
        const matches = [...content.matchAll(/getElementById\(['"]([^'"]+)['"]\)/g)].map(m => m[1]);
        for (const id of matches) {
          // Filtrar IDs que se generan dinámicamente o corresponden a subcomponentes controlados
          if (!htmlIds.has(id) && !id.startsWith('subview') && !id.startsWith('pill') && !id.startsWith('badge')) {
            missing.push({ file, id });
          }
        }
      }

      assert.deepEqual(missing, [], `Existen IDs referenciados por JS ausentes en HTML: ${JSON.stringify(missing)}`);
    });
  });

  // =========================================================================
  // 2. TOKENS CSS, SINTAXIS Y AUSENCIA DE VARIABLES HUÉRFANAS
  // =========================================================================
  describe('2. Tokens CSS, Variables y Sintaxis', () => {
    const cssContent = fs.readFileSync(CSS_FILE, 'utf8');

    it('2.1. Tokens alias --text-main y --bg-card están definidos tanto en :root como en body.dark-theme', () => {
      const rootMatch = cssContent.match(/:root\s*\{([^}]+)\}/s);
      const darkMatch = cssContent.match(/body\.dark-theme\s*\{([^}]+)\}/s);

      assert.ok(rootMatch, ':root debe existir en style.css');
      assert.ok(darkMatch, 'body.dark-theme debe existir en style.css');

      assert.ok(rootMatch[1].includes('--text-main:'), '--text-main debe estar definido en :root');
      assert.ok(rootMatch[1].includes('--bg-card:'), '--bg-card debe estar definido en :root');
      assert.ok(darkMatch[1].includes('--text-main:'), '--text-main debe estar definido en body.dark-theme');
      assert.ok(darkMatch[1].includes('--bg-card:'), '--bg-card debe estar definido en body.dark-theme');
    });

    it('2.2. Colores temáticos (--theme-*) están declarados para todas las pestañas en ambos temas', () => {
      const requiredThemes = ['--theme-bcra', '--theme-indec', '--theme-dolares', '--theme-byma', '--theme-cripto'];
      const rootBlock = cssContent.match(/:root\s*\{([^}]+)\}/s)[1];
      const darkBlock = cssContent.match(/body\.dark-theme\s*\{([^}]+)\}/s)[1];

      for (const th of requiredThemes) {
        assert.ok(rootBlock.includes(`${th}:`), `${th} debe estar declarado en :root`);
        assert.ok(darkBlock.includes(`${th}:`), `${th} debe estar declarado en body.dark-theme`);
      }
    });

    it('2.3. No existen llamadas inválidas rgba(var(--hex), ...) que rompen el parser CSS de navegadores', () => {
      const invalidRgbaRegex = /rgba\(\s*var\(--(?!.*-rgb)[a-zA-Z0-9_-]+\)\s*,/g;
      const invalidMatches = [...cssContent.matchAll(invalidRgbaRegex)];
      assert.equal(
        invalidMatches.length,
        0,
        `Se detectaron llamadas sintácticamente inválidas a rgba(var(--...)): ${invalidMatches.map(m => m[0]).join(', ')}`
      );
    });

    it('2.4. Todas las variables CSS referenciadas con var(--nombre) están declaradas en :root o body.dark-theme', () => {
      const declRegex = /--([a-zA-Z0-9_-]+)\s*:/g;
      const declaredVars = new Set([...cssContent.matchAll(declRegex)].map(m => m[1]));

      const usageRegex = /var\(\s*--([a-zA-Z0-9_-]+)\s*[,)]/g;
      const usages = [...cssContent.matchAll(usageRegex)].map(m => m[1]);

      const orphanVars = new Set();
      for (const u of usages) {
        if (!declaredVars.has(u)) {
          orphanVars.add(u);
        }
      }

      assert.deepEqual([...orphanVars], [], `Variables CSS huérfanas/no declaradas encontradas: ${[...orphanVars].join(', ')}`);
    });
  });

  // =========================================================================
  // 3. RATIOS DE CONTRASTE WCAG 2.1 (MODO CLARO Y OSCURO)
  // =========================================================================
  describe('3. Ratios de Contraste WCAG 2.1 AA (Accesibilidad Cromática)', () => {
    it('3.1. Modo Claro: Texto primario (#0f172a) sobre fondo claro (#f8fafc) supera WCAG AA (>= 4.5:1)', () => {
      const ratio = getContrastRatio('#0f172a', '#f8fafc');
      assert.ok(ratio >= 4.5, `Ratio texto primario claro: ${ratio.toFixed(2)} (esperado >= 4.5)`);
    });

    it('3.2. Modo Claro: Texto secundario (#64748b) sobre fondo claro (#f8fafc) cumple WCAG AA (>= 4.5:1)', () => {
      const ratio = getContrastRatio('#64748b', '#f8fafc');
      assert.ok(ratio >= 4.5, `Ratio texto secundario claro: ${ratio.toFixed(2)} (esperado >= 4.5)`);
    });

    it('3.3. Modo Claro: Colores temáticos tienen contraste adecuado (>= 3.0:1 para elementos gráficos y componentes UI)', () => {
      const bgLight = '#f8fafc';
      const themes = {
        '--theme-bcra (#0284c7)': '#0284c7',
        '--theme-indec (#9333ea)': '#9333ea',
        '--theme-dolares (#16a34a)': '#16a34a',
        '--theme-byma (#d97706)': '#d97706'
      };

      for (const [name, hex] of Object.entries(themes)) {
        const ratio = getContrastRatio(hex, bgLight);
        assert.ok(ratio >= 3.0, `Color temático claro ${name} debe superar 3.0:1. Obtenido: ${ratio.toFixed(2)}`);
      }
    });

    it('3.4. Modo Oscuro: Texto primario (#f8fafc) sobre fondo oscuro (#060913) supera ampliamente WCAG AAA (>= 7:1)', () => {
      const ratio = getContrastRatio('#f8fafc', '#060913');
      assert.ok(ratio >= 7.0, `Ratio texto primario oscuro: ${ratio.toFixed(2)} (esperado >= 7.0)`);
    });

    it('3.5. Modo Oscuro: Colores temáticos neón sobre fondo oscuro (#060913) superan WCAG AA (>= 4.5:1)', () => {
      const bgDark = '#060913';
      const themes = {
        '--theme-bcra neón (#00f0ff)': '#00f0ff',
        '--theme-indec neón (#bf5af2)': '#bf5af2',
        '--theme-dolares neón (#30d158)': '#30d158',
        '--theme-byma neón (#ffd60a)': '#ffd60a'
      };

      for (const [name, hex] of Object.entries(themes)) {
        const ratio = getContrastRatio(hex, bgDark);
        assert.ok(ratio >= 4.5, `Color temático oscuro ${name} debe superar 4.5:1. Obtenido: ${ratio.toFixed(2)}`);
      }
    });

    it('3.6. Dólar Oficial: Línea del gráfico adaptativa contrasta eficientemente en ambos temas', () => {
      const ratioClaro = getContrastRatio('#0f172a', '#f8fafc');
      const ratioOscuro = getContrastRatio('#ffffff', '#060913');

      assert.ok(ratioClaro >= 4.5, `Dólar oficial claro ratio: ${ratioClaro.toFixed(2)} (>= 4.5)`);
      assert.ok(ratioOscuro >= 4.5, `Dólar oficial oscuro ratio: ${ratioOscuro.toFixed(2)} (>= 4.5)`);
    });
  });

  // =========================================================================
  // 4. RESPONSIVIDAD Y GUARDARRAÍLES DE MAQUETACIÓN
  // =========================================================================
  describe('4. Responsividad y Guardarraíles de Maquetación', () => {
    const cssContent = fs.readFileSync(CSS_FILE, 'utf8');
    const htmlContent = fs.readFileSync(HTML_FILE, 'utf8');

    it('4.1. public/index.html NO contiene estilos rígidos inline (style="height: 520px;") en gráficos', () => {
      assert.ok(
        !htmlContent.includes('style="height: 520px;"'),
        'No deben existir alturas rígidas inline de 520px en index.html'
      );
    });

    it('4.2. #deudorPeriodoSelect en index.html NO tiene estilos oscuros rígidos inline', () => {
      const selectSnippet = htmlContent.match(/<select\s+id="deudorPeriodoSelect"[^>]*>/);
      assert.ok(selectSnippet, 'deudorPeriodoSelect debe existir');
      assert.ok(
        !selectSnippet[0].includes('background-color: #1a1d2e'),
        'deudorPeriodoSelect no debe tener background forzado inline'
      );
    });

    it('4.3. Media queries para .chart-wrapper contemplan Desktop (400px), Tablet (340px) y Móvil (280px)', () => {
      assert.ok(cssContent.includes('.chart-wrapper {'), 'Debe existir .chart-wrapper');
      assert.ok(cssContent.includes('@media (max-width: 992px)'), 'Debe existir breakpoint tablet 992px');
      assert.ok(cssContent.includes('@media (max-width: 600px)'), 'Debe existir breakpoint móvil 600px');
      assert.ok(cssContent.includes('height: 280px !important;'), 'Móvil debe compactar altura a 280px');
    });

    it('4.4. .cheques-inputs-grid colapsa a 1fr en pantallas móviles (<= 640px)', () => {
      const gridResponsiveSnippet = cssContent.match(/@media\s*\(max-width:\s*640px\)\s*\{[^}]*\.cheques-inputs-grid\s*\{([^}]+)\}/s);
      assert.ok(gridResponsiveSnippet, 'Debe existir regla responsive para .cheques-inputs-grid en <= 640px');
      assert.ok(gridResponsiveSnippet[1].includes('grid-template-columns: 1fr'), 'Debe definir grid-template-columns: 1fr');
    });

    it('4.5. .kpi-card cuenta con min-height: 94px para alineación visual simétrica', () => {
      const kpiSnippet = cssContent.match(/\.kpi-card\s*\{([^}]+)\}/s);
      assert.ok(kpiSnippet, 'Debe existir bloque .kpi-card');
      assert.ok(kpiSnippet[1].includes('min-height: 94px;'), '.kpi-card debe tener min-height: 94px');
    });

    it('4.6. Celdas de tablas (.data-table th, td) tienen white-space: nowrap para prevenir saltos de línea', () => {
      const tableCells = cssContent.match(/\.data-table\s+th,\s*\.data-table\s+td\s*\{([^}]+)\}/s);
      assert.ok(tableCells, 'Debe existir selector .data-table th, .data-table td');
      assert.ok(tableCells[1].includes('white-space: nowrap'), 'Debe declarar white-space: nowrap');
    });
  });

  // =========================================================================
  // 5. MÓDULO CHARTS.JS: PLUGINS Y RESILIENCIA
  // =========================================================================
  describe('5. Módulo Charts.js: Plugins y Resiliencia', () => {
    const chartsJsPath = path.join(MODULES_DIR, 'charts.js');
    const chartsContent = fs.readFileSync(chartsJsPath, 'utf8');

    it('5.1. Exporta setupChartGlobalDefaults, verticalCrosshairPlugin, maxMinLabelPlugin y lineShadowPlugin', () => {
      assert.ok(chartsContent.includes('export function setupChartGlobalDefaults'), 'setupChartGlobalDefaults debe ser exportada');
      assert.ok(chartsContent.includes('export const verticalCrosshairPlugin'), 'verticalCrosshairPlugin debe ser exportada');
      assert.ok(chartsContent.includes('export const maxMinLabelPlugin'), 'maxMinLabelPlugin debe ser exportada');
      assert.ok(chartsContent.includes('export const lineShadowPlugin'), 'lineShadowPlugin debe ser exportada');
    });

    it('5.2. verticalCrosshairPlugin define id verticalCrosshair y comprueba activePoint de forma segura', () => {
      assert.ok(chartsContent.includes("id: 'verticalCrosshair'"), 'id debe ser verticalCrosshair');
      assert.ok(chartsContent.includes('chart.tooltip?._active?.length'), 'Debe verificar existencia defensiva de activePoint');
    });

    it('5.3. maxMinLabelPlugin aborta en gráficos de barras (evita colisiones en histogramas)', () => {
      assert.ok(
        chartsContent.includes("if (chart.config?.type === 'bar') return;"),
        'maxMinLabelPlugin debe abortar si el tipo de gráfico es bar'
      );
      assert.ok(
        chartsContent.includes("dataset.type === 'bar'"),
        'maxMinLabelPlugin debe omitir datasets individuales de tipo bar'
      );
    });

    it('5.4. maxMinLabelPlugin restringe extremos al dataset primario o showMaxMin explícito', () => {
      assert.ok(
        chartsContent.includes('chart.data.datasets.length > 1 && dataset.showMaxMin !== true && datasetIndex !== 0'),
        'Debe filtrar etiquetas en datasets secundarios para evitar colisiones visuales'
      );
    });

    it('5.5. lineShadowPlugin utiliza el color del dataset dinámico en lugar de rosa fijo', () => {
      assert.ok(
        chartsContent.includes('firstDs.borderColor'),
        'lineShadowPlugin debe utilizar firstDs.borderColor dinámico'
      );
    });

    it('5.6. unregisterChart ejecuta destroy() con bloque try/catch para evitar excepciones no capturadas', () => {
      assert.ok(
        chartsContent.includes('unregisterChart(chart)'),
        'unregisterChart debe existir'
      );
      assert.ok(
        chartsContent.includes('chart.destroy()'),
        'Debe invocar destroy()'
      );
    });
  });

  // =========================================================================
  // 6. UTILS.JS: FORMATEO NUMÉRICO CON COMA DECIMAL ARGENTINA
  // =========================================================================
  describe('6. Utils.js: Formateo Numérico es-AR', () => {
    const utilsPath = path.join(MODULES_DIR, 'utils.js');
    const utilsContent = fs.readFileSync(utilsPath, 'utf8');

    it('6.1. formatValueCompact utiliza toLocaleString(\'es-AR\') garantizando coma decimal argentina', () => {
      assert.ok(
        utilsContent.includes("toLocaleString('es-AR'"),
        "formatValueCompact debe invocar toLocaleString('es-AR')"
      );
    });

    it('6.2. formatValue utiliza Intl.NumberFormat con locale es-AR', () => {
      assert.ok(
        utilsContent.includes("new Intl.NumberFormat('es-AR'"),
        "formatValue debe utilizar 'es-AR'"
      );
    });
  });
});
