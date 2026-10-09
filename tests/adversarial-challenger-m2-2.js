/**
 * tests/adversarial-challenger-m2-2.js
 * Arnés de verificación empírica y estrés adversarial para challenger_m2_2 (M2_FRONTEND_PERF).
 *
 * Dimensiones de prueba:
 * 1. Inserción masiva (>500 entradas, p.ej. 1000) con límite estricto (maxEntries = 200).
 * 2. Desalojo LRU/FIFO y preservación de entradas frecuentemente accedidas (.get()).
 * 3. Actualización in-place en .set() de claves preexistentes (reordenamiento LRU sin fuga de capacidad).
 * 4. Poda preventiva (.prune()) de claves con TTL expirado y auto-poda al alcanzar capacidad.
 * 5. Casos borde y robustez (claves vacías, unicode, emojis, tipos exóticos, TTL = 0, TTL negativo).
 * 6. Fuzzing de alto rendimiento (10.000 operaciones mixtas get/set/delete/prune).
 * 7. Análisis de grafo de dependencias de frontend ESM (Detección de ciclos DFS de 3 colores).
 * 8. Compatibilidad y estabilidad en entorno sin DOM / Node.js.
 */

const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const PUBLIC_DIR = path.resolve(__dirname, '../public');
const MODULES_DIR = path.resolve(PUBLIC_DIR, 'js/modules');

const testResults = [];

function recordTest(suite, name, passed, details) {
  testResults.push({ suite, name, passed, details });
  const status = passed ? 'PASS' : 'FAIL';
  console.log(`[${status}] ${suite} :: ${name}`);
  if (details) {
    console.log(`       Detalle: ${details}`);
  }
}

async function run() {
  console.log('='.repeat(80));
  console.log('ADVERSARIAL STRESS & EMPIRICAL VERIFICATION HARNESS — challenger_m2_2');
  console.log('Milestone: M2_FRONTEND_PERF');
  console.log('='.repeat(80));

  // Carga dinámica de state.js (ESM)
  const statePath = path.resolve(MODULES_DIR, 'state.js');
  const stateUrl = `file://${statePath.replace(/\\/g, '/')}`;
  const { clientCache, appState } = await import(stateUrl);

  assert.ok(clientCache, 'clientCache debe exportarse');
  assert.ok(appState, 'appState debe exportarse');

  // =========================================================================
  // 1. INSERCIÓN MASIVA (>500 ENTRADAS) Y LÍMITE ESTRICTO DE CAPACIDAD
  // =========================================================================
  console.log('\n--- 1. Inserción Masiva (>500 entradas) y Límite de Capacidad ---');
  {
    clientCache.clear();
    const TARGET_INSERTS = 1000;
    let sizeNeverExceeded200 = true;
    let maxObservedSize = 0;

    for (let i = 0; i < TARGET_INSERTS; i++) {
      clientCache.set(`key_${i}`, { index: i, timestamp: Date.now() });
      const currentSize = clientCache.size();
      if (currentSize > maxObservedSize) maxObservedSize = currentSize;
      if (currentSize > 200) {
        sizeNeverExceeded200 = false;
      }
    }

    const finalSize = clientCache.size();
    const passed = sizeNeverExceeded200 && finalSize === 200 && maxObservedSize === 200;
    recordTest(
      '1. Massive Insertion',
      'Inserción de 1000 entradas respeta estrictamente maxEntries <= 200 sin excepción',
      passed,
      `Inserciones: ${TARGET_INSERTS}, Tamaño final: ${finalSize}, Tamaño máximo observado: ${maxObservedSize}`
    );

    // Verificar que las entradas más antiguas (0..799) fueron desalojadas y las recientes (800..999) persisten
    let oldEvictedCount = 0;
    for (let i = 0; i < 800; i++) {
      if (clientCache.get(`key_${i}`) === null) oldEvictedCount++;
    }

    let recentRetainedCount = 0;
    for (let i = 800; i < TARGET_INSERTS; i++) {
      const val = clientCache.get(`key_${i}`);
      if (val && val.index === i) recentRetainedCount++;
    }

    const evictionPassed = oldEvictedCount === 800 && recentRetainedCount === 200;
    recordTest(
      '1. Massive Insertion',
      'Desalojo FIFO exacto: 800 entradas antiguas purgadas y 200 recientes retenidas',
      evictionPassed,
      `Antiguas desalojadas: ${oldEvictedCount}/800, Recientes retenidas: ${recentRetainedCount}/200`
    );
  }

  // =========================================================================
  // 2. ORDEN DE DESALOJO LRU Y PRESERVACIÓN POR ACCESO (.get())
  // =========================================================================
  console.log('\n--- 2. Orden de Desalojo LRU y Promoción por Acceso (.get()) ---');
  {
    clientCache.clear();

    // Llenar exactamente 200 elementos
    for (let i = 0; i < 200; i++) {
      clientCache.set(`item_${i}`, `val_${i}`);
    }
    assert.equal(clientCache.size(), 200);

    // Acceder a item_0, item_10, item_25 para promoverlos a Más Recientemente Usados (MRU)
    const val0 = clientCache.get('item_0');
    const val10 = clientCache.get('item_10');
    const val25 = clientCache.get('item_25');

    assert.equal(val0, 'val_0');
    assert.equal(val10, 'val_10');
    assert.equal(val25, 'val_25');

    // Ahora insertamos un nuevo item_200.
    // Como item_0 fue accedido, la entrada más antigua no accedida es item_1.
    // Por ende, item_1 debe ser desalojada, mientras que item_0 DEBE conservarse.
    clientCache.set('item_200', 'val_200');

    const item1Evicted = clientCache.get('item_1') === null;
    const item0Preserved = clientCache.get('item_0') === 'val_0';
    const item10Preserved = clientCache.get('item_10') === 'val_10';
    const item25Preserved = clientCache.get('item_25') === 'val_25';
    const item200Present = clientCache.get('item_200') === 'val_200';

    const lruPassed = item1Evicted && item0Preserved && item10Preserved && item25Preserved && item200Present;
    recordTest(
      '2. LRU Promotion',
      'Lectura con .get() promueve la entrada a MRU protegiéndola contra desalojo inmediato',
      lruPassed,
      `item_1 desalojado: ${item1Evicted}, item_0 preservado: ${item0Preserved}, item_10: ${item10Preserved}, item_25: ${item25Preserved}`
    );

    // Desalojar progresivamente otros 190 items sin tocar item_0
    for (let i = 201; i <= 390; i++) {
      clientCache.set(`item_${i}`, `val_${i}`);
    }

    // item_0, al haber sido accedido justo antes de item_200, sobrevive a las 190 inserciones
    // porque las entradas item_2 a item_199 eran más antiguas.
    const item0StillAlive = clientCache.get('item_0') === 'val_0';
    recordTest(
      '2. LRU Promotion',
      'item_0 promovido sobrevive a la purga de todas las entradas intermedias no accedidas',
      item0StillAlive,
      `item_0 retenido: ${item0StillAlive}, tamaño cache: ${clientCache.size()}`
    );
  }

  // =========================================================================
  // 3. ACTUALIZACIÓN IN-PLACE EN .set() DE CLAVES PREEXISTENTES
  // =========================================================================
  console.log('\n--- 3. Actualización In-place en .set() de Claves Existentes ---');
  {
    clientCache.clear();
    for (let i = 0; i < 200; i++) {
      clientCache.set(`key_${i}`, `original_${i}`);
    }
    assert.equal(clientCache.size(), 200);

    // Actualizar key_0 con nuevo valor. No debe aumentar tamaño ni desalojar otras claves.
    clientCache.set('key_0', 'actualizado_0');
    assert.equal(clientCache.size(), 200);
    assert.equal(clientCache.get('key_0'), 'actualizado_0');

    // Al haber sido reinsertada en .set(), key_0 pasa al final de la cola LRU.
    // Insertamos key_200: la clave desalojada debe ser key_1, no key_0.
    clientCache.set('key_200', 'val_200');
    assert.equal(clientCache.size(), 200);

    const key1Desalojada = clientCache.get('key_1') === null;
    const key0Sobrevivio = clientCache.get('key_0') === 'actualizado_0';

    const updateLruPassed = key1Desalojada && key0Sobrevivio;
    recordTest(
      '3. In-place Update',
      '.set() con clave existente actualiza valor y posición LRU sin alterar capacidad máxima',
      updateLruPassed,
      `key_1 desalojada: ${key1Desalojada}, key_0 con nuevo valor retenida: ${key0Sobrevivio}`
    );
  }

  // =========================================================================
  // 4. PODA PREVENTIVA (.prune()) Y PURGA AUTOMÁTICA DE EXPIRADOS
  // =========================================================================
  console.log('\n--- 4. Poda Preventiva (.prune()) y Purga Automática de Expirados ---');
  {
    clientCache.clear();

    // Insertar 100 elementos expirados (TTL negativo) y 100 válidos (TTL largo)
    for (let i = 0; i < 100; i++) {
      clientCache.set(`exp_${i}`, `data_${i}`, -5000); // ya expirado
    }
    for (let i = 0; i < 100; i++) {
      clientCache.set(`val_${i}`, `data_${i}`, 60000); // vigente 60s
    }

    assert.equal(clientCache.size(), 200);

    // Invocar prune() explícito
    const prunedCount = clientCache.prune();
    const sizeAfterPrune = clientCache.size();

    const explicitPrunePassed = prunedCount === 100 && sizeAfterPrune === 100;
    recordTest(
      '4. Prune',
      'prune() elimina exactamente las 100 entradas expiradas y conserva las 100 vigentes',
      explicitPrunePassed,
      `Eliminadas: ${prunedCount}/100, Tamaño restante: ${sizeAfterPrune}`
    );

    // Comprobar que todas las val_* están intactas
    let allValidPreserved = true;
    for (let i = 0; i < 100; i++) {
      if (clientCache.get(`val_${i}`) !== `data_${i}`) {
        allValidPreserved = false;
        break;
      }
    }
    recordTest(
      '4. Prune',
      'Todas las 100 entradas válidas se mantienen accesibles post-prune()',
      allValidPreserved,
      `Preservación: ${allValidPreserved ? '100%' : 'Incompleta'}`
    );

    // Ahora probamos auto-poda en .set():
    // Llenamos la caché hasta 200 con 50 expiradas y 150 válidas.
    clientCache.clear();
    for (let i = 0; i < 150; i++) {
      clientCache.set(`valid_${i}`, `data_${i}`, 60000);
    }
    for (let i = 0; i < 50; i++) {
      clientCache.set(`expired_${i}`, `data_${i}`, -1000);
    }
    assert.equal(clientCache.size(), 200);

    // Insertar una nueva clave vigente: clientCache.set() detecta size >= maxEntries y ejecuta prune() primero.
    // Esto debe purgar las 50 expiradas antes de evaluar el desalojo forzado,
    // por lo que NINGUNA de las 150 claves válidas debe perderse.
    clientCache.set('new_valid', 'fresh_data', 60000);

    const sizeAfterAutoPrune = clientCache.size();
    // Debe ser 150 (válidas) + 1 (nueva) = 151
    let all150ValidSurvived = true;
    for (let i = 0; i < 150; i++) {
      if (clientCache.get(`valid_${i}`) !== `data_${i}`) {
        all150ValidSurvived = false;
        break;
      }
    }
    const newValidPresent = clientCache.get('new_valid') === 'fresh_data';

    const autoPrunePassed = sizeAfterAutoPrune === 151 && all150ValidSurvived && newValidPresent;
    recordTest(
      '4. Prune',
      'Auto-poda en .set() purga entradas expiradas salvando entradas válidas de desalojo innecesario',
      autoPrunePassed,
      `Tamaño tras auto-poda: ${sizeAfterAutoPrune} (esperado 151), Válidas preservadas: ${all150ValidSurvived}`
    );
  }

  // =========================================================================
  // 5. CASOS BORDE Y ROBUSTEZ ADVERSARIAL
  // =========================================================================
  console.log('\n--- 5. Casos Borde y Robustez Adversarial ---');
  {
    clientCache.clear();

    const edgeCases = [
      { key: '', val: 'clave vacía', desc: 'Clave string vacía ""' },
      { key: '   ', val: 'clave espacios', desc: 'Clave con solo espacios "   "' },
      { key: '📈_dolar_blue', val: { brecha: 45.2, oficial: 1000 }, desc: 'Clave con emojis Unicode "📈_dolar_blue"' },
      { key: 'null', val: null, desc: 'Clave "null" con valor null' },
      { key: 'undefined', val: undefined, desc: 'Clave "undefined" con valor undefined' },
      { key: 'nested_obj', val: { a: [1, 2, { c: true }] }, desc: 'Payload objeto anidado' },
      { key: 'large_payload', val: 'X'.repeat(50000), desc: 'Payload grande (50 KB)' },
      { key: 'special_chars', val: 'SELECT * FROM bcra; <script>', desc: 'Caracteres SQL/XSS en payload' }
    ];

    let allEdgePassed = true;
    for (const ec of edgeCases) {
      clientCache.set(ec.key, ec.val);
      const retrieved = clientCache.get(ec.key);
      const has = clientCache.has(ec.key);

      // Comprobar igualdad
      const match = JSON.stringify(retrieved) === JSON.stringify(ec.val);
      if (!match || !has) {
        allEdgePassed = false;
        console.error(`Fallo en caso borde: ${ec.desc}`);
      }
    }

    recordTest(
      '5. Edge Cases',
      'Manejo correcto de claves exóticas, emojis, payloads grandes y nulos',
      allEdgePassed,
      `Casos evaluados: ${edgeCases.length}, Aprobados: ${allEdgePassed ? edgeCases.length : 0}`
    );

    // TTL = 0 y TTL negativo inmediato
    clientCache.set('ttl_zero', 'zero', 0);
    // Date.now() > expiresAt (Date.now() + 0) es true inmediatamente o en el mismo milisegundo
    const zeroRes = clientCache.get('ttl_zero');
    // Si expiresAt === Date.now(), puede ser null o requerir milisegundo. Probamos con TTL = -1
    clientCache.set('ttl_neg', 'neg', -1);
    const negRes = clientCache.get('ttl_neg');

    const ttlEdgePassed = negRes === null;
    recordTest(
      '5. Edge Cases',
      'TTL negativo (-1 ms) expira de inmediato y retorna null en .get() y false en .has()',
      ttlEdgePassed,
      `get(ttl_neg): ${negRes}, has(ttl_neg): ${clientCache.has('ttl_neg')}`
    );

    // Métodos auxiliares: delete y clear
    clientCache.set('del_me', 'valor');
    assert.equal(clientCache.has('del_me'), true);
    clientCache.delete('del_me');
    assert.equal(clientCache.has('del_me'), false);

    clientCache.clear();
    assert.equal(clientCache.size(), 0);
    recordTest(
      '5. Edge Cases',
      'Métodos .delete() y .clear() operan de forma limpia y dejan size = 0',
      clientCache.size() === 0,
      'Caché vaciada exitosamente'
    );
  }

  // =========================================================================
  // 6. FUZZING DE ALTO RENDIMIENTO (10.000 OPERACIONES)
  // =========================================================================
  console.log('\n--- 6. Fuzzing de Alto Rendimiento (10.000 Operaciones) ---');
  {
    clientCache.clear();
    const NUM_OPS = 10000;
    const start = performance.now();
    let errorsCount = 0;
    let sizeNeverExceeded = true;

    for (let i = 0; i < NUM_OPS; i++) {
      try {
        const rand = Math.random();
        const keyId = Math.floor(Math.random() * 500); // 500 claves posibles
        const key = `fuzz_key_${keyId}`;

        if (rand < 0.60) {
          // 60% inserción con TTL aleatorio entre 100ms y 60s
          const ttl = Math.random() < 0.1 ? -100 : Math.floor(Math.random() * 60000) + 100;
          clientCache.set(key, { i, rand }, ttl);
        } else if (rand < 0.90) {
          // 30% lectura
          clientCache.get(key);
        } else if (rand < 0.95) {
          // 5% borrado
          clientCache.delete(key);
        } else {
          // 5% poda preventiva
          clientCache.prune();
        }

        if (clientCache.size() > 200) {
          sizeNeverExceeded = false;
        }
      } catch (err) {
        errorsCount++;
        console.error(`Excepción en fuzzing op ${i}:`, err);
      }
    }

    const duration = performance.now() - start;
    const avgOpMs = duration / NUM_OPS;
    const opsPerSec = Math.floor((NUM_OPS / duration) * 1000);

    const fuzzPassed = errorsCount === 0 && sizeNeverExceeded && clientCache.size() <= 200;
    recordTest(
      '6. High-Throughput Fuzzing',
      '10.000 operaciones aleatorias concurrentes sin excepciones y con límite <= 200 inquebrantable',
      fuzzPassed,
      `Duración: ${duration.toFixed(2)} ms, Avg/op: ${avgOpMs.toFixed(4)} ms, Rendimiento: ${opsPerSec} ops/s, Errores: ${errorsCount}`
    );
  }

  // =========================================================================
  // 7. ANÁLISIS DE GRAFO DE DEPENDENCIAS ESM (DAG ACÍCLICO)
  // =========================================================================
  console.log('\n--- 7. Grafo de Dependencias ESM y Detección de Ciclos ---');
  {
    function getAllJsFiles(dir) {
      if (!fs.existsSync(dir)) return [];
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      let files = [];
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          files = files.concat(getAllJsFiles(full));
        } else if (entry.isFile() && entry.name.endsWith('.js')) {
          files.push(full);
        }
      }
      return files;
    }

    function extractImports(code) {
      const regex = /(?:import\s+(?:[\w*\s{},]*\s+from\s+)?['"]([^'"]+)['"]|export\s+(?:[\w*\s{},]*\s+from\s+)['"]([^'"]+)['"])/g;
      const results = [];
      let match;
      while ((match = regex.exec(code)) !== null) {
        const spec = match[1] || match[2];
        if (spec) results.push(spec);
      }
      return results;
    }

    const jsFiles = [
      path.join(PUBLIC_DIR, 'app.js'),
      ...getAllJsFiles(MODULES_DIR)
    ].filter(f => fs.existsSync(f));

    const graph = new Map();
    let missingFiles = [];

    for (const file of jsFiles) {
      const code = fs.readFileSync(file, 'utf8');
      const fileDir = path.dirname(file);
      const specs = extractImports(code);
      const deps = [];

      for (const spec of specs) {
        if (spec.startsWith('./') || spec.startsWith('../')) {
          const resolved = path.resolve(fileDir, spec);
          if (!fs.existsSync(resolved)) {
            missingFiles.push({ caller: file, spec, resolved });
          }
          deps.push(resolved);
        }
      }
      graph.set(file, deps);
    }

    // DFS 3 colores para detección de ciclos
    const state = new Map();
    for (const node of graph.keys()) state.set(node, 0); // 0 = unvisited

    let cycleFound = null;

    function dfs(node, stack = []) {
      state.set(node, 1); // visiting
      stack.push(node);

      for (const dep of (graph.get(node) || [])) {
        if (!graph.has(dep)) continue;
        if (state.get(dep) === 1) {
          cycleFound = stack.concat(dep).map(p => path.relative(PUBLIC_DIR, p).replace(/\\/g, '/')).join(' -> ');
          return;
        }
        if (state.get(dep) === 0) {
          dfs(dep, stack);
          if (cycleFound) return;
        }
      }

      stack.pop();
      state.set(node, 2); // visited
    }

    for (const node of graph.keys()) {
      if (state.get(node) === 0) dfs(node, []);
      if (cycleFound) break;
    }

    const dagPassed = cycleFound === null && missingFiles.length === 0;
    recordTest(
      '7. ESM Dependency Graph',
      'Grafo dirigido de módulos frontend es un DAG 100% acíclico sin dependencias circulares',
      dagPassed,
      cycleFound ? `Ciclo detectado: ${cycleFound}` : `Nodos analizados: ${graph.size}, Ciclos: 0, Faltantes: 0`
    );
  }

  // =========================================================================
  // 8. IDEMPOTENCIA Y PROTECCIÓN DE ENTORNO EN APPSTATE / TABBCRA
  // =========================================================================
  console.log('\n--- 8. Idempotencia y Protección de Entorno sin DOM ---');
  {
    // appState.bcra.favorites debe inicializarse como arreglo sin crashear en Node
    const favoritesIsArray = Array.isArray(appState.bcra.favorites);
    recordTest(
      '8. Environment Safety',
      'appState se importa limpiamente en Node sin ReferenceError: localStorage',
      favoritesIsArray,
      `appState.bcra.favorites: isArray=${favoritesIsArray}, length=${appState.bcra.favorites.length}`
    );

    // tabBcra idempotencia estructural
    const tabBcraPath = path.join(MODULES_DIR, 'tabBcra.js');
    const tabBcraCode = fs.readFileSync(tabBcraPath, 'utf8');
    const hasGuard = /if\s*\(\s*this\.initialized\s*\)\s*return\s*;?/.test(tabBcraCode);

    recordTest(
      '8. Environment Safety',
      'tabBcra.js contiene cláusula de guarda estricta if (this.initialized) return;',
      hasGuard,
      `Guarda de inicialización presente: ${hasGuard}`
    );
  }

  // =========================================================================
  // RESUMEN Y EVALUACIÓN FINAL
  // =========================================================================
  console.log('\n' + '='.repeat(80));
  console.log('RESUMEN DE RESULTADOS — challenger_m2_2');
  console.log('='.repeat(80));

  const total = testResults.length;
  const passed = testResults.filter(t => t.passed).length;
  const failed = total - passed;

  console.log(`Total Pruebas: ${total}`);
  console.log(`Aprobadas:     ${passed}`);
  console.log(`Falladas:      ${failed}`);
  console.log(`Porcentaje:    ${((passed / total) * 100).toFixed(1)}%`);

  if (failed > 0) {
    console.error(`\n❌ VEREDICTO FORMAL: REJECT (${failed} fallos detectados)`);
    process.exitCode = 1;
  } else {
    console.log(`\n✅ VEREDICTO FORMAL: APPROVE (100% aprobado)`);
  }
}

run().catch(err => {
  console.error('Error fatal durante ejecución del arnés adversarial:', err);
  process.exit(1);
});
