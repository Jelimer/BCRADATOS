/**
 * tests/adversarial-challenger-m2-1-cache.js
 * Arnés de estrés adversarial empírico especializado para clientCache.has y claves/valores límite (nulls, falsy, exóticos).
 * 
 * Diseñado por challenger_m2_1 para auditar exhaustivamente la corrección de clientCache.has en state.js.
 */

const assert = require('node:assert/strict');
const path = require('node:path');

const results = [];

function recordTest(suite, name, passed, details) {
  results.push({ suite, name, passed, details });
  const status = passed ? 'PASS' : 'FAIL';
  console.log(`[${status}] ${suite} :: ${name}`);
  if (details) {
    console.log(`       Detalle: ${details}`);
  }
}

async function run() {
  console.log('='.repeat(80));
  console.log('ADVERSARIAL STRESS HARNESS — clientCache.has & Edge Cases (challenger_m2_1)');
  console.log('='.repeat(80));

  const statePath = path.resolve(__dirname, '../public/js/modules/state.js');
  const stateUrl = `file://${statePath.replace(/\\/g, '/')}`;
  const { clientCache } = await import(stateUrl);

  assert.ok(clientCache, 'clientCache debe exportarse desde state.js');

  // =========================================================================
  // 1. DISCRIMINACIÓN ESTRICTA DE VALORES FALSY Y NULOS EN .has()
  // =========================================================================
  console.log('\n--- 1. Discriminación Estricta de Valores Falsy y Nulos en .has() ---');
  {
    clientCache.clear();

    const falsyValues = [
      { desc: 'null', val: null },
      { desc: 'undefined', val: undefined },
      { desc: 'false', val: false },
      { desc: '0', val: 0 },
      { desc: '-0', val: -0 },
      { desc: '0n (BigInt)', val: 0n },
      { desc: '"" (string vacío)', val: '' },
      { desc: 'NaN', val: NaN }
    ];

    let allFalsyPassed = true;
    for (let i = 0; i < falsyValues.length; i++) {
      const { desc, val } = falsyValues[i];
      const key = `falsy_${i}`;

      // Antes de insertar, has() debe ser false
      if (clientCache.has(key) !== false) {
        allFalsyPassed = false;
        console.error(`Error: has("${key}") dio true antes de inserción`);
      }

      clientCache.set(key, val, 60000);

      // Tras insertar, has() DEBE ser true, incluso si el valor almacenado es null, false, 0, "", NaN, undefined
      const hasKey = clientCache.has(key);
      const retrieved = clientCache.get(key);

      const valueMatches = Object.is(retrieved, val);
      if (!hasKey || !valueMatches) {
        allFalsyPassed = false;
        console.error(`Error en falsy ${desc}: has()=${hasKey}, retrieved=${retrieved}, valueMatches=${valueMatches}`);
      }
    }

    recordTest(
      '1. Falsy Values',
      'clientCache.has() retorna true para todos los valores falsy (null, undefined, false, 0, "", NaN)',
      allFalsyPassed,
      `Evaluados: ${falsyValues.length} tipos falsy. Todos pasaron: ${allFalsyPassed}`
    );

    // Clave inexistente nunca debe dar true
    const nonexistentPassed = clientCache.has('definitely_nonexistent_key_xyz') === false &&
                              clientCache.has('') === false &&
                              clientCache.has(null) === false &&
                              clientCache.has(undefined) === false;

    recordTest(
      '1. Falsy Values',
      'clientCache.has() retorna false estrictamente para claves no registradas',
      nonexistentPassed,
      `Claves no registradas evaluadas correctamente: ${nonexistentPassed}`
    );
  }

  // =========================================================================
  // 2. CLAVES EXÓTICAS Y LÍMITE (Null, Undefined, Emojis, Symbols, Prototipos)
  // =========================================================================
  console.log('\n--- 2. Claves Exóticas y Límite ---');
  {
    clientCache.clear();

    const symKey = Symbol('adversarialSymbol');
    const objKey = { id: 'complex_object_key', tag: 'bcra' };
    const arrKey = [1, 2, 'tres'];

    const exoticKeys = [
      { key: null, val: 'valor con clave null', desc: 'Clave primitiva null' },
      { key: undefined, val: 'valor con clave undefined', desc: 'Clave primitiva undefined' },
      { key: 0, val: 'valor con clave número 0', desc: 'Clave primitiva número 0' },
      { key: -0, val: 'valor con clave número -0', desc: 'Clave primitiva número -0' },
      { key: false, val: 'valor con clave booleana false', desc: 'Clave primitiva false' },
      { key: '', val: 'valor con clave cadena vacía', desc: 'Clave cadena vacía ""' },
      { key: NaN, val: 'valor con clave NaN', desc: 'Clave NaN' },
      { key: symKey, val: 'valor con clave Symbol', desc: 'Clave Symbol' },
      { key: objKey, val: 'valor con clave Objeto', desc: 'Clave Objeto por referencia' },
      { key: arrKey, val: 'valor con clave Arreglo', desc: 'Clave Arreglo por referencia' },
      { key: '__proto__', val: 'no contamina prototipo', desc: 'Clave protegida __proto__' },
      { key: 'constructor', val: 'constructor safe', desc: 'Clave constructor' },
      { key: 'toString', val: 'toString safe', desc: 'Clave toString' },
      { key: 'valueOf', val: 'valueOf safe', desc: 'Clave valueOf' },
      { key: 'hasOwnProperty', val: 'hasOwnProperty safe', desc: 'Clave hasOwnProperty' },
      { key: '📈_🇦🇷_DÓLAR_BLUE_💵_2026', val: 'emoji unicode seguro', desc: 'Clave Emojis y Unicode' },
      { key: 'null\0byte\0injection', val: 'null byte payload', desc: 'Clave con bytes nulos \\0' },
      { key: '\u202Ereversed_bidi_text', val: 'bidi text', desc: 'Clave con texto bidireccional' },
      { key: 'K'.repeat(50000), val: 'clave de 50.000 caracteres', desc: 'Clave gigante (50KB)' }
    ];

    let allExoticPassed = true;
    for (const item of exoticKeys) {
      clientCache.set(item.key, item.val, 60000);

      const has = clientCache.has(item.key);
      const val = clientCache.get(item.key);

      if (!has || val !== item.val) {
        allExoticPassed = false;
        console.error(`Fallo en clave exótica: ${item.desc} (has=${has}, val=${val})`);
      }
    }

    recordTest(
      '2. Exotic Keys',
      'Manejo impecable de claves no estándar (null, undefined, 0, NaN, Symbol, Object, Prototype)',
      allExoticPassed,
      `Claves evaluadas: ${exoticKeys.length}, Aprobadas: ${allExoticPassed ? exoticKeys.length : 0}`
    );

    // Combinación letal: Clave null con valor null, Clave undefined con valor undefined
    clientCache.set(null, null, 60000);
    clientCache.set(undefined, undefined, 60000);

    const nullNullPassed = clientCache.has(null) === true && clientCache.get(null) === null;
    const undefUndefPassed = clientCache.has(undefined) === true && clientCache.get(undefined) === undefined;

    recordTest(
      '2. Exotic Keys',
      'Combinación extrema: clave null con valor null y clave undefined con valor undefined',
      nullNullPassed && undefUndefPassed,
      `null/null: ${nullNullPassed}, undefined/undefined: ${undefUndefPassed}`
    );
  }

  // =========================================================================
  // 3. TTL, EXPIRACIÓN TEMPORAL Y PODA REACTIVA EN .has()
  // =========================================================================
  console.log('\n--- 3. TTL, Expiración Temporal y Poda Reactiva en .has() ---');
  {
    clientCache.clear();

    // 1. Clave con TTL negativo ya expirada
    clientCache.set('expired_neg', 'neg_val', -100);
    const hasExpiredNeg = clientCache.has('expired_neg');
    const storeHasNeg = clientCache.store.has('expired_neg');

    recordTest(
      '3. TTL Expiration',
      '.has() en clave con TTL negativo retorna false y purga la entrada de this.store',
      hasExpiredNeg === false && storeHasNeg === false,
      `has: ${hasExpiredNeg}, store.has tras llamada: ${storeHasNeg}`
    );

    // 2. Clave con TTL = 0
    clientCache.set('expired_zero', 'zero_val', 0);
    // Esperar 2ms para asegurar Date.now() > expiresAt
    await new Promise(r => setTimeout(r, 5));
    const hasExpiredZero = clientCache.has('expired_zero');
    const storeHasZero = clientCache.store.has('expired_zero');

    recordTest(
      '3. TTL Expiration',
      '.has() en clave con TTL = 0 retorna false tras expirar',
      hasExpiredZero === false && storeHasZero === false,
      `has: ${hasExpiredZero}, store.has tras llamada: ${storeHasZero}`
    );

    // 3. Transición temporal activa: de vigente (true) a expirada (false)
    clientCache.set('short_lived', 'viva', 30); // 30ms de vida
    const hasInitial = clientCache.has('short_lived');
    assert.equal(hasInitial, true, 'Debe estar viva inmediatamente');

    await new Promise(r => setTimeout(r, 45)); // esperar a que expire
    const hasAfterExpiry = clientCache.has('short_lived');
    const storeAfterExpiry = clientCache.store.has('short_lived');

    recordTest(
      '3. TTL Expiration',
      '.has() transiciona limpiamente de true a false tras expirar el TTL y elimina la entrada',
      hasInitial === true && hasAfterExpiry === false && storeAfterExpiry === false,
      `has inicial: ${hasInitial}, has posterior: ${hasAfterExpiry}, purgado en store: ${!storeAfterExpiry}`
    );
  }

  // =========================================================================
  // 4. PRESERVACIÓN DEL ORDEN LRU ANTE LLAMADAS A .has()
  // =========================================================================
  console.log('\n--- 4. Preservación del Orden LRU ante Llamadas a .has() ---');
  {
    clientCache.clear();

    // Insertar claves k1, k2, k3
    clientCache.set('k1', 'val1');
    clientCache.set('k2', 'val2');
    clientCache.set('k3', 'val3');

    const initialOrder = [...clientCache.store.keys()];
    assert.deepEqual(initialOrder, ['k1', 'k2', 'k3']);

    // Llamar a .has('k1') varias veces. has() es una operación de consulta (read-only respecto a LRU).
    // A diferencia de .get('k1'), .has() NO debe reordenar ni alterar la cola LRU.
    clientCache.has('k1');
    clientCache.has('k1');
    clientCache.has('k2');

    const orderAfterHas = [...clientCache.store.keys()];
    const orderPreserved = JSON.stringify(initialOrder) === JSON.stringify(orderAfterHas);

    recordTest(
      '4. LRU Order Preservation',
      '.has() no muta el orden de acceso LRU en entradas vigentes',
      orderPreserved,
      `Orden inicial: ${initialOrder.join(',')} -> Orden post-has: ${orderAfterHas.join(',')}`
    );

    // Ahora confirmar que .get('k1') SÍ promueve k1 al final
    clientCache.get('k1');
    const orderAfterGet = [...clientCache.store.keys()];
    const getPromoted = JSON.stringify(orderAfterGet) === JSON.stringify(['k2', 'k3', 'k1']);

    recordTest(
      '4. LRU Order Preservation',
      '.get() sí promueve a MRU al final de la cola (contraste correcto con has)',
      getPromoted,
      `Orden post-get: ${orderAfterGet.join(',')}`
    );
  }

  // =========================================================================
  // 5. FUZZING ADVERSARIAL DE ALTA DENSIDAD (25.000 OPERACIONES)
  // =========================================================================
  console.log('\n--- 5. Fuzzing Adversarial de Alta Densidad (25.000 operaciones) ---');
  {
    clientCache.clear();
    const NUM_OPS = 25000;
    const testKeyPool = [
      'key_norm_1', 'key_norm_2', 'null', null, 'undefined', undefined,
      0, false, '', NaN, '__proto__', 'constructor', 'emoji_🔥',
      ...Array.from({ length: 40 }, (_, i) => `dynamic_key_${i}`)
    ];

    const testValuePool = [
      null, undefined, 0, false, '', NaN, 'string_val',
      { data: 123 }, [1, 2, 3], () => {}
    ];

    let errors = 0;
    let sizeViolations = 0;
    let consistencyViolations = 0;

    const start = performance.now();

    for (let op = 0; op < NUM_OPS; op++) {
      const action = Math.random();
      const key = testKeyPool[Math.floor(Math.random() * testKeyPool.length)];

      try {
        if (action < 0.40) {
          // 40% set con valores arbitrarios y TTL variable
          const val = testValuePool[Math.floor(Math.random() * testValuePool.length)];
          const ttl = Math.random() < 0.15 ? -50 : (Math.random() < 0.3 ? 50 : 60000);
          clientCache.set(key, val, ttl);
        } else if (action < 0.75) {
          // 35% has
          const has = clientCache.has(key);
          const entry = clientCache.store.get(key);
          // Invariante de coherencia: si has es true, entry debe existir y Date.now() <= entry.expiresAt
          if (has) {
            if (!entry || Date.now() > entry.expiresAt) {
              consistencyViolations++;
            }
          } else {
            // si has es false, entry no debe existir o debe haber estado expirado
            if (entry && Date.now() <= entry.expiresAt) {
              consistencyViolations++;
            }
          }
        } else if (action < 0.90) {
          // 15% get
          clientCache.get(key);
        } else if (action < 0.95) {
          // 5% delete
          clientCache.delete(key);
        } else {
          // 5% prune
          clientCache.prune();
        }

        if (clientCache.size() > 200) {
          sizeViolations++;
        }
      } catch (err) {
        errors++;
        console.error(`Error en op ${op}:`, err);
      }
    }

    const duration = performance.now() - start;
    const fuzzPassed = errors === 0 && sizeViolations === 0 && consistencyViolations === 0;

    recordTest(
      '5. Adversarial Fuzzing',
      '25.000 operaciones mixtas con claves exóticas, nulos y valores límite con 0 inconsistencias',
      fuzzPassed,
      `Duración: ${duration.toFixed(2)} ms (${Math.round((NUM_OPS / duration) * 1000)} ops/s), Errores: ${errors}, Violaciones tamaño: ${sizeViolations}, Violaciones coherencia: ${consistencyViolations}`
    );
  }

  // =========================================================================
  // 6. RESUMEN Y EVALUACIÓN FINAL
  // =========================================================================
  console.log('\n' + '='.repeat(80));
  console.log('RESUMEN DE RESULTADOS — challenger_m2_1');
  console.log('='.repeat(80));

  const total = results.length;
  const passed = results.filter(r => r.passed).length;
  const failed = total - passed;

  console.log(`Total Pruebas: ${total}`);
  console.log(`Aprobadas:     ${passed}`);
  console.log(`Falladas:      ${failed}`);
  console.log(`Porcentaje:    ${((passed / total) * 100).toFixed(1)}%`);

  if (failed > 0) {
    console.error(`\n❌ VEREDICTO FORMAL: REJECTED (${failed} fallos detectados)`);
    process.exitCode = 1;
  } else {
    console.log(`\n✅ VEREDICTO FORMAL: CONFIRMED (100% de pruebas empíricas aprobadas)`);
  }
}

run().catch(err => {
  console.error('Fallo crítico en el arnés:', err);
  process.exit(1);
});
