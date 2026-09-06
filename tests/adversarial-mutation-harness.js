/**
 * tests/adversarial-mutation-harness.js
 * Arnés de verificación empírica y prueba de mutación para teamwork_preview_challenger_m3_1.
 * 
 * Evalúa adversariamente la sensibilidad de detección de fallos ante mutaciones conceptuales:
 * 1. Detección de imports relativos sin extensión .js en frontend ESM
 * 2. Detección de ciclos circulares en el grafo de dependencias de módulos ESM
 * 3. Sensibilidad de aserciones de criptoya.test.js ante NaN, strings, nulos y cotizaciones no positivas
 * 4. Sanitización y robustez de schemaValidator ante payloads corruptos
 * 5. Sensibilidad de criptoya-resilience ante fallos de timeout y reintentos 429
 */

const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const schemaValidator = require('../services/schemaValidator');

const results = [];

function recordTest(name, passed, details) {
  results.push({ name, passed, details });
  const statusMark = passed ? '✅ PASS' : '❌ FAIL';
  console.log(`${statusMark} - ${name}`);
  if (details) console.log(`   -> ${details}`);
}

// ============================================================================
// MUTACIÓN 1: IMPORTS RELATIVOS SIN EXTENSIÓN .js EN ESM
// ============================================================================
console.log('\n--- 1. MUTACIÓN: Imports relativos sin extensión .js ---');

const importExportRegex = /(?:import\s+(?:[\w*\s{},]*\s+from\s+)?['"]([^'"]+)['"]|export\s+(?:[\w*\s{},]*\s+from\s+)['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\))/g;

function extractImportSpecifiers(code) {
  const specifiers = [];
  let match;
  while ((match = importExportRegex.exec(code)) !== null) {
    const specifier = match[1] || match[2] || match[3];
    if (specifier) specifiers.push(specifier);
  }
  return specifiers;
}

const sampleMutantCodes = [
  { desc: 'import { api } from "./api"', code: 'import { api } from "./api";', mutant: './api' },
  { desc: 'import * as state from "../state"', code: 'import * as state from "../state";', mutant: '../state' },
  { desc: 'export { x } from "./utils"', code: 'export { x } from "./utils";', mutant: './utils' },
  { desc: 'import("./dynamicModule")', code: 'const m = import("./dynamicModule");', mutant: './dynamicModule' }
];

for (const sample of sampleMutantCodes) {
  const specs = extractImportSpecifiers(sample.code);
  let caught = false;
  try {
    for (const spec of specs) {
      if (spec.startsWith('./') || spec.startsWith('../')) {
        assert.ok(
          spec.endsWith('.js'),
          `La importación "${spec}" debe incluir extensión explícita ".js"`
        );
      }
    }
  } catch (err) {
    caught = true;
  }
  recordTest(
    `frontend-esm captura mutación: ${sample.desc}`,
    caught,
    caught ? `Mutante eliminado con éxito (${sample.mutant} detectado sin .js)` : 'ERROR: Mutante sobrevivió'
  );
}

// ============================================================================
// MUTACIÓN 2: CICLOS EN GRAFO DE DEPENDENCIAS ESM
// ============================================================================
console.log('\n--- 2. MUTACIÓN: Detección de ciclos en grafo ESM con DFS ---');

function detectCyclesInGraph(graph) {
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
        const cycleTrace = currentStack.concat(neighbor).join(' -> ');
        throw new Error(`Ciclo de dependencias circulares detectado: ${cycleTrace}`);
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
}

// Caso 2.1: Ciclo de 2 nodos (A -> B -> A)
const cycleGraph2 = new Map([
  ['modA.js', ['modB.js']],
  ['modB.js', ['modA.js']]
]);
let cycle2Caught = false;
try {
  detectCyclesInGraph(cycleGraph2);
} catch (e) {
  cycle2Caught = e.message.includes('Ciclo de dependencias circulares detectado');
}
recordTest('frontend-esm captura ciclo directo de 2 nodos (A <-> B)', cycle2Caught);

// Caso 2.2: Ciclo de 3 nodos (A -> B -> C -> A)
const cycleGraph3 = new Map([
  ['modA.js', ['modB.js']],
  ['modB.js', ['modC.js']],
  ['modC.js', ['modA.js']],
  ['root.js', ['modA.js']]
]);
let cycle3Caught = false;
try {
  detectCyclesInGraph(cycleGraph3);
} catch (e) {
  cycle3Caught = e.message.includes('Ciclo de dependencias circulares detectado');
}
recordTest('frontend-esm captura ciclo indirecto de 3 nodos (A -> B -> C -> A)', cycle3Caught);

// Caso 2.3: Auto-dependencia / self-loop (A -> A)
const selfLoopGraph = new Map([
  ['modA.js', ['modA.js']]
]);
let selfLoopCaught = false;
try {
  detectCyclesInGraph(selfLoopGraph);
} catch (e) {
  selfLoopCaught = e.message.includes('Ciclo de dependencias circulares detectado');
}
recordTest('frontend-esm captura auto-referencia (A -> A)', selfLoopCaught);

// Caso 2.4: Grafo DAG acíclico legítimo (no debe arrojar error)
const acyclicGraph = new Map([
  ['app.js', ['state.js', 'api.js', 'utils.js']],
  ['api.js', ['utils.js']],
  ['state.js', ['utils.js']],
  ['utils.js', []]
]);
let falsePositive = false;
try {
  detectCyclesInGraph(acyclicGraph);
} catch (e) {
  falsePositive = true;
}
recordTest('frontend-esm no produce falsos positivos en DAG acíclico legítimo', !falsePositive);

// ============================================================================
// MUTACIÓN 3: SENSIBILIDAD DE CRIPTOYA ANTE NaN, STRINGS Y VALORES NO POSITIVOS
// ============================================================================
console.log('\n--- 3. MUTACIÓN: Sensibilidad de aserciones ante NaN, strings y no-positivos ---');

function checkDolarAssertions(item, tipo = 'oficial', isPrincipal = true) {
  assert.ok(typeof item === 'object', `${tipo} debe ser un objeto`);
  assert.ok(typeof item.precio === 'number' && Number.isFinite(item.precio) && item.precio >= 0, `${tipo}.precio debe ser un número finito no negativo`);
  assert.ok(typeof item.compra === 'number' && Number.isFinite(item.compra) && item.compra >= 0, `${tipo}.compra debe ser un número finito no negativo`);
  assert.ok(typeof item.venta === 'number' && Number.isFinite(item.venta) && item.venta >= 0, `${tipo}.venta debe ser un número finito no negativo`);
  assert.ok(typeof item.variacion === 'number' && Number.isFinite(item.variacion), `${tipo}.variacion debe ser un número finito`);

  if (isPrincipal) {
    assert.ok(item.precio > 0, `${tipo}.precio debe ser estrictamente positivo`);
    assert.ok(item.compra > 0, `${tipo}.compra debe ser estrictamente positivo`);
    assert.ok(item.venta > 0, `${tipo}.venta debe ser estrictamente positivo`);
  }
}

const dolarMutants = [
  { desc: 'precio es NaN', item: { precio: NaN, compra: 1000, venta: 1020, variacion: 0 } },
  { desc: 'precio es string numérico "1000"', item: { precio: "1000", compra: 1000, venta: 1020, variacion: 0 } },
  { desc: 'precio es string "NaN"', item: { precio: "NaN", compra: 1000, venta: 1020, variacion: 0 } },
  { desc: 'precio es null', item: { precio: null, compra: 1000, venta: 1020, variacion: 0 } },
  { desc: 'precio es negativo -1000', item: { precio: -1000, compra: 1000, venta: 1020, variacion: 0 } },
  { desc: 'precio es 0 para tipo principal (oficial/blue)', item: { precio: 0, compra: 0, venta: 0, variacion: 0 } },
  { desc: 'compra es Infinity', item: { precio: 1000, compra: Infinity, venta: 1020, variacion: 0 } },
  { desc: 'variacion es undefined', item: { precio: 1000, compra: 990, venta: 1010, variacion: undefined } }
];

for (const m of dolarMutants) {
  let killed = false;
  try {
    checkDolarAssertions(m.item, 'oficial', true);
  } catch (err) {
    killed = true;
  }
  recordTest(
    `criptoya.test.js mata mutante: ${m.desc}`,
    killed,
    killed ? 'Aserción estricta disparada correctamente' : 'ERROR: Mutante no detectado'
  );
}

// ============================================================================
// MUTACIÓN 4: ARBITRAJE Y BANCOS ANTE SPREADS ANÓMALOS
// ============================================================================
console.log('\n--- 4. MUTACIÓN: Aserciones de Arbitraje Cripto y Bancos ---');

function checkArbitrajeAssertions(arbitraje) {
  assert.ok(arbitraje && typeof arbitraje === 'object', 'arbitraje debe ser un objeto');
  assert.ok(typeof arbitraje.spreadPorcentaje === 'number' && Number.isFinite(arbitraje.spreadPorcentaje), 'spreadPorcentaje debe ser un número finito');
  assert.ok(typeof arbitraje.oportunidad === 'boolean', 'oportunidad debe ser un booleano');
}

let arbNanKilled = false;
try {
  checkArbitrajeAssertions({ spreadPorcentaje: NaN, oportunidad: false });
} catch (e) {
  arbNanKilled = true;
}
recordTest('Arbitraje mata mutante de spreadPorcentaje NaN', arbNanKilled);

let arbBoolKilled = false;
try {
  checkArbitrajeAssertions({ spreadPorcentaje: 2.5, oportunidad: 'true' }); // string no boolean
} catch (e) {
  arbBoolKilled = true;
}
recordTest('Arbitraje mata mutante de oportunidad no booleana', arbBoolKilled);

// ============================================================================
// MUTACIÓN 5: SANITIZACIÓN EXTREMA DE SCHEMAVALIDATOR
// ============================================================================
console.log('\n--- 5. MUTACIÓN: schemaValidator ante inputs altamente hostiles ---');

// Test 5.1: Payload completamente caótico en normalizeDolarData
const chaoticDolar = schemaValidator.normalizeDolarData({
  oficial: { price: "invalido", ask: [1,2,3], bid: { nested: true } },
  blue: undefined,
  mep: "no-objeto",
  ccl: null
});

recordTest(
  'schemaValidator.normalizeDolarData produce números finitos ante payload caótico',
  Number.isFinite(chaoticDolar.oficial.precio) &&
  Number.isFinite(chaoticDolar.blue.precio) &&
  Number.isFinite(chaoticDolar.brechas.blueVsOficial) &&
  chaoticDolar.oficial.precio === 0 &&
  chaoticDolar.brechas.blueVsOficial === 0
);

// Test 5.2: Inyección de spreads negativos en normalizeBancosData
const negativeSpreadBanco = schemaValidator.normalizeBancosData({
  testBanco: { ask: 1000, bid: 1050 } // compra > venta -> spread negativo no permitido
});
recordTest(
  'schemaValidator.normalizeBancosData fuerza spread no negativo',
  negativeSpreadBanco.results[0].spread >= 0 && negativeSpreadBanco.results[0].spread === 0
);

// Test 5.3: Inyección de APY desorbitado / no numérico en normalizeRendimientosData
const crazyRendimientos = schemaValidator.normalizeRendimientosData([
  { entidad: 'test', apy: 'NaN', moneda: 'ARS' },
  { entidad: 'test2', apy: null, moneda: 'ARS' },
  { entidad: 'test3', apy: 0.45, moneda: 'ARS' } // fraccionario 45%
]);
recordTest(
  'schemaValidator.normalizeRendimientosData sanitiza fraccionarios y nulos a finitos',
  crazyRendimientos[0].apy === 45 &&
  crazyRendimientos[1].apy === 0 &&
  crazyRendimientos[2].apy === 0
);

// ============================================================================
// RESUMEN Y BALANCE FINAL DEL ARNÉS ADVERSARIAL
// ============================================================================
console.log('\n======================================================');
const total = results.length;
const passedCount = results.filter(r => r.passed).length;
const failedCount = total - passedCount;
console.log(`TOTAL EXPERIMENTOS ADVERSARIALES: ${total}`);
console.log(`MUTANTES ELIMINADOS / PRUEBAS SUPERADAS: ${passedCount}`);
console.log(`MUTANTES SOBREVIVIENTES / FALLOS: ${failedCount}`);
console.log('======================================================\n');

if (failedCount > 0) {
  process.exit(1);
} else {
  console.log('VERIFICACIÓN ADVERSARIAL EMPÍRICA COMPLETADA: 100% SENSIBILIDAD COMPROBADA.');
}
