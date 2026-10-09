/**
 * tests/frontend-esm.test.js
 * Suite de pruebas de integridad arquitectónica, análisis sintáctico estático y resolución de grafos para Frontend ESM.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const PUBLIC_DIR = path.resolve(__dirname, '../public');
const MODULES_DIR = path.resolve(PUBLIC_DIR, 'js/modules');

/**
 * Obtiene recursivamente todos los archivos .js dentro de un directorio.
 * @param {string} dir Directorio de búsqueda
 * @returns {string[]} Lista de rutas absolutas a archivos JavaScript
 */
function getAllJsFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  let files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files = files.concat(getAllJsFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      files.push(fullPath);
    }
  }
  return files;
}

/**
 * Extrae todos los especificadores de importación y re-exportación de un código fuente ESM.
 * @param {string} code Código fuente JavaScript
 * @returns {string[]} Lista de especificadores
 */
function extractImportSpecifiers(code) {
  const specifiers = [];
  const importExportRegex = /(?:import\s+(?:[\w*\s{},]*\s+from\s+)?['"]([^'"]+)['"]|export\s+(?:[\w*\s{},]*\s+from\s+)['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\))/g;
  let match;
  while ((match = importExportRegex.exec(code)) !== null) {
    const specifier = match[1] || match[2] || match[3];
    if (specifier) {
      specifiers.push(specifier);
    }
  }
  return specifiers;
}

describe('Frontend ESM Architecture & Static Integrity Suite', () => {
  // ============================================================================
  // 1. VALIDACIÓN SINTÁCTICA ESTÁTICA SIN NAVEGADOR
  // ============================================================================
  it('1. Todos los módulos JavaScript en public/ y public/js/modules/ deben tener sintaxis ESM nativa válida', () => {
    const jsFiles = [
      path.join(PUBLIC_DIR, 'app.js'),
      ...getAllJsFiles(MODULES_DIR)
    ].filter(f => fs.existsSync(f));

    assert.ok(jsFiles.length >= 2, 'Deben existir app.js y los módulos de dominio');

    for (const file of jsFiles) {
      const code = fs.readFileSync(file, 'utf8');
      const relPath = path.relative(PUBLIC_DIR, file).replace(/\\/g, '/');

      // Verificación estática con V8 (--input-type=module --check vía stdin)
      const checkResult = spawnSync(process.execPath, ['--input-type=module', '--check'], {
        input: code,
        encoding: 'utf8'
      });

      assert.equal(
        checkResult.status,
        0,
        `Error de sintaxis ESM detectado en public/${relPath}:\n${checkResult.stderr}`
      );
    }
  });

  // ============================================================================
  // 2. EXTENSIONES EXPLÍCITAS Y RESOLUCIÓN FÍSICA EN DISCO
  // ============================================================================
  it('2. Todas las importaciones y exportaciones relativas deben incluir extensión .js explícita y existir físicamente', () => {
    const jsFiles = [
      path.join(PUBLIC_DIR, 'app.js'),
      ...getAllJsFiles(MODULES_DIR)
    ].filter(f => fs.existsSync(f));

    for (const file of jsFiles) {
      const code = fs.readFileSync(file, 'utf8');
      const fileDir = path.dirname(file);
      const relCaller = path.relative(PUBLIC_DIR, file).replace(/\\/g, '/');
      const specifiers = extractImportSpecifiers(code);

      for (const specifier of specifiers) {
        if (specifier.startsWith('./') || specifier.startsWith('../')) {
          // Aserción 1: Extensión .js obligatoria en navegadores para ESM nativo
          assert.ok(
            specifier.endsWith('.js'),
            `En "${relCaller}": La importación "${specifier}" debe incluir extensión explícita ".js"`
          );

          // Aserción 2: Existencia física en el sistema de archivos
          const resolvedPath = path.resolve(fileDir, specifier);
          assert.ok(
            fs.existsSync(resolvedPath),
            `En "${relCaller}": El archivo importado "${specifier}" no existe en la ruta física ${resolvedPath}`
          );

          // Aserción 3: Seguridad de contención dentro del directorio public/ (sin path traversal)
          const normPublic = path.normalize(PUBLIC_DIR);
          const normResolved = path.normalize(resolvedPath);
          assert.ok(
            normResolved.startsWith(normPublic),
            `En "${relCaller}": La importación "${specifier}" escapa del directorio public/`
          );
        }
      }
    }
  });

  // ============================================================================
  // 3. ANÁLISIS DE GRAFOS Y PREVENCIÓN DE CICLOS (DAG ACÍCLICO)
  // ============================================================================
  it('3. El grafo de dependencias de módulos ESM debe ser un DAG acíclico sin ciclos ni referencias circulares', () => {
    const jsFiles = [
      path.join(PUBLIC_DIR, 'app.js'),
      ...getAllJsFiles(MODULES_DIR)
    ].filter(f => fs.existsSync(f));

    // Construcción del grafo dirigido G = (V, E)
    const graph = new Map();
    for (const file of jsFiles) {
      const code = fs.readFileSync(file, 'utf8');
      const fileDir = path.dirname(file);
      const specifiers = extractImportSpecifiers(code);
      const deps = [];

      for (const specifier of specifiers) {
        if (specifier.startsWith('./') || specifier.startsWith('../')) {
          const resolved = path.resolve(fileDir, specifier);
          deps.push(resolved);
        }
      }
      graph.set(file, deps);
    }

    // Algoritmo DFS de 3 colores: 0 = unvisited (blanco), 1 = visiting (gris), 2 = visited (negro)
    const state = new Map();
    for (const node of graph.keys()) {
      state.set(node, 0);
    }

    function dfs(node, currentStack = []) {
      state.set(node, 1);
      currentStack.push(node);

      const neighbors = graph.get(node) || [];
      for (const neighbor of neighbors) {
        if (!graph.has(neighbor)) continue;

        if (state.get(neighbor) === 1) {
          const cycleTrace = currentStack
            .concat(neighbor)
            .map(p => path.relative(PUBLIC_DIR, p).replace(/\\/g, '/'))
            .join(' -> ');
          throw new Error(`Ciclo de dependencias circulares perjudicial detectado en frontend ESM: ${cycleTrace}`);
        }

        if (state.get(neighbor) === 0) {
          dfs(neighbor, currentStack);
        }
      }

      currentStack.pop();
      state.set(node, 2);
    }

    for (const node of graph.keys()) {
      if (state.get(node) === 0) {
        dfs(node, []);
      }
    }
  });

  // ============================================================================
  // 4. INTEGRACIÓN EN INDEX.HTML CON TYPE="MODULE"
  // ============================================================================
  it('4. public/index.html debe cargar el orquestador frontend con <script type="module" src="app.js"></script>', () => {
    const htmlPath = path.join(PUBLIC_DIR, 'index.html');
    assert.ok(fs.existsSync(htmlPath), 'public/index.html debe existir');
    const html = fs.readFileSync(htmlPath, 'utf8');

    // Comprobar presencia de etiqueta script con type="module"
    const moduleScriptRegex = /<script\s+[^>]*type=["']module["'][^>]*src=["']([^"']+)["'][^>]*>/i;
    const match = moduleScriptRegex.exec(html);

    assert.ok(
      match,
      'public/index.html debe incluir una etiqueta <script type="module" src="..."> para cargar el punto de entrada ESM'
    );

    const scriptSrc = match[1];
    const scriptPath = path.resolve(PUBLIC_DIR, scriptSrc);
    assert.ok(
      fs.existsSync(scriptPath),
      `El script módulo referenciado en index.html ("${scriptSrc}") debe existir físicamente en ${scriptPath}`
    );
  });

  // ============================================================================
  // 5. RETROCOMPATIBILIDAD CON TESTS EXISTENTES (CLIENTCACHE Y DEBOUNCE)
  // ============================================================================
  it('5. public/app.js debe exponer o exportar clientCache y debounce para satisfacer tests preexistentes de Tier 5', () => {
    const appJsPath = path.join(PUBLIC_DIR, 'app.js');
    assert.ok(fs.existsSync(appJsPath), 'public/app.js debe existir');
    const content = fs.readFileSync(appJsPath, 'utf8');

    assert.ok(
      content.includes('clientCache'),
      'public/app.js debe contener la exportación o referencia a clientCache'
    );
    assert.ok(
      content.includes('debounce'),
      'public/app.js debe contener la exportación o referencia a debounce'
    );
  });

  // ============================================================================
  // 6. VERIFICACIÓN DE MÓDULOS DE DOMINIO REQUERIDOS
  // ============================================================================
  it('6. Deben existir todos los módulos de dominio fundamentales en public/js/modules/', () => {
    const expectedModules = [
      'api.js',
      'state.js',
      'utils.js',
      'charts.js',
      'ui.js',
      'tabBcra.js',
      'tabIndec.js',
      'tabDolares.js',
      'tabByma.js',
      'tabComparador.js',
      'tabConsultas.js'
    ];

    for (const mod of expectedModules) {
      const modPath = path.join(MODULES_DIR, mod);
      assert.ok(fs.existsSync(modPath), `El módulo ${mod} debe existir en public/js/modules/`);
    }
  });

  // ============================================================================
  // 7. IDEMPOTENCIA DE INICIALIZACIÓN EN TABBCRA.JS (M2)
  // ============================================================================
  it('7. tabBcra.js debe implementar cláusula de guarda de idempotencia en init()', () => {
    const tabBcraPath = path.join(MODULES_DIR, 'tabBcra.js');
    assert.ok(fs.existsSync(tabBcraPath), 'tabBcra.js debe existir');
    const content = fs.readFileSync(tabBcraPath, 'utf8');

    // Comprobar presencia de guarda if (this.initialized) return; en init()
    const initMatch = /init\s*\(\)\s*\{([^}]+)\}/.exec(content);
    assert.ok(initMatch, 'tabBcra.js debe tener un método init()');
    assert.match(
      initMatch[1],
      /if\s*\(\s*this\.initialized\s*\)\s*return\s*;?/,
      'tabBcra.init() debe comenzar con la cláusula de guarda "if (this.initialized) return;"'
    );
  });

  // ============================================================================
  // 8. CICLO DE VIDA IN-PLACE DE CHART.JS Y SOPORTE DE TEMAS EN TABBYMA.JS (M2)
  // ============================================================================
  it('8. tabByma.js debe importar registerChart/unregisterChart, actualizar in-place y soportar temas adaptativos', () => {
    const tabBymaPath = path.join(MODULES_DIR, 'tabByma.js');
    assert.ok(fs.existsSync(tabBymaPath), 'tabByma.js debe existir');
    const content = fs.readFileSync(tabBymaPath, 'utf8');

    // Importación de registerChart y unregisterChart
    assert.match(
      content,
      /import\s+{[^}]*registerChart[^}]*}\s+from\s+['"]\.\/charts\.js['"]/,
      'tabByma.js debe importar registerChart desde ./charts.js'
    );
    assert.match(
      content,
      /import\s+{[^}]*unregisterChart[^}]*}\s+from\s+['"]\.\/charts\.js['"]/,
      'tabByma.js debe importar unregisterChart desde ./charts.js'
    );

    // Actualización in-place sin parpadeo de canvas
    assert.match(
      content,
      /appState\.byma\.chart\.update\(['"]active['"]\)/,
      'tabByma.js debe reutilizar la instancia existente llamando a appState.byma.chart.update("active")'
    );

    // Registro en activeCharts
    assert.match(
      content,
      /registerChart\(appState\.byma\.chart\)/,
      'tabByma.js debe registrar la instancia creada llamando a registerChart(appState.byma.chart)'
    );

    // Detección de tema oscuro/claro
    assert.match(
      content,
      /dark-theme/,
      'tabByma.js debe consultar document.body.classList.contains("dark-theme") para estilos adaptativos'
    );
  });

  // ============================================================================
  // 9. LÍMITE DE CAPACIDAD (MAX_ENTRIES), PODA Y DESALOJO LRU EN CLIENTCACHE (M2)
  // ============================================================================
  it('9. clientCache en state.js debe implementar límite de capacidad maxEntries, poda preventiva y desalojo LRU', async () => {
    const stateFileUrl = `file://${path.resolve(MODULES_DIR, 'state.js').replace(/\\/g, '/')}`;
    const { clientCache } = await import(stateFileUrl);

    assert.ok(clientCache, 'clientCache debe exportarse en state.js');
    assert.equal(typeof clientCache.maxEntries, 'number', 'maxEntries debe ser numérico');
    assert.ok(clientCache.maxEntries >= 50, 'maxEntries debe tener un umbral razonable');
    assert.equal(typeof clientCache.prune, 'function', 'clientCache debe implementar el método prune()');

    // Limpiar para test aislado
    clientCache.clear();
    const originalMax = clientCache.maxEntries;

    try {
      // Configurar límite pequeño de prueba: 4 entradas
      clientCache.maxEntries = 4;

      // 1. Inserción dentro del límite
      clientCache.set('k1', 'val1');
      clientCache.set('k2', 'val2');
      clientCache.set('k3', 'val3');
      clientCache.set('k4', 'val4');
      assert.equal(clientCache.size(), 4, 'Debe almacenar 4 entradas');

      // 2. Acceder a k1 para marcarla como recientemente usada (LRU)
      const v1 = clientCache.get('k1');
      assert.equal(v1, 'val1');

      // 3. Insertar k5: debe desalojar la más antigua no usada (k2, ya que k1 fue accedida)
      clientCache.set('k5', 'val5');
      assert.equal(clientCache.size(), 4, 'No debe superar maxEntries');
      assert.equal(clientCache.get('k2'), null, 'k2 debió ser desalojada');
      assert.equal(clientCache.get('k1'), 'val1', 'k1 debe conservarse por acceso reciente LRU');
      assert.equal(clientCache.get('k5'), 'val5', 'k5 debe estar presente');

      // 4. Poda preventiva de entradas expiradas
      clientCache.set('k_exp', 'expirado', -1000); // Ya expirada
      assert.equal(clientCache.get('k_exp'), null, 'Entrada expirada no debe retornarse');

      clientCache.set('k_exp2', 'expirado2', -1000);
      const purged = clientCache.prune();
      assert.ok(purged >= 1, 'prune() debe eliminar al menos una entrada expirada');
    } finally {
      clientCache.maxEntries = originalMax;
      clientCache.clear();
    }
  });
});
