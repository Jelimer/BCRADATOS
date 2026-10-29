/**
 * tests/challenger_m2_1_cache.test.js
 * Suite automatizada para npm test: Verificación empírica adversarial de clientCache.has, nulos y casos borde.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

describe('Tier 2.1: Adversarial clientCache.has & Edge Cases Verification', async () => {
  const statePath = path.resolve(__dirname, '../public/js/modules/state.js');
  const stateUrl = `file://${statePath.replace(/\\/g, '/')}`;
  const { clientCache } = await import(stateUrl);

  it('2.1.1. clientCache.has() distingue correctamente claves con valor null/undefined de claves inexistentes', () => {
    clientCache.clear();

    assert.equal(clientCache.has('key_null'), false, 'Clave no insertada debe dar false');
    assert.equal(clientCache.get('key_null'), null, 'Clave no insertada get() retorna null');

    clientCache.set('key_null', null, 60000);
    assert.equal(clientCache.has('key_null'), true, 'Clave con valor null DEBE dar true en has()');
    assert.equal(clientCache.get('key_null'), null, 'Clave con valor null retorna null en get()');

    clientCache.set('key_undefined', undefined, 60000);
    assert.equal(clientCache.has('key_undefined'), true, 'Clave con valor undefined DEBE dar true en has()');
    assert.equal(clientCache.get('key_undefined'), undefined, 'Clave con valor undefined retorna undefined');
  });

  it('2.1.2. clientCache.has() retorna true para todos los valores falsy (0, -0, false, "", NaN)', () => {
    clientCache.clear();
    const falsy = [0, -0, false, '', NaN];

    for (let i = 0; i < falsy.length; i++) {
      const k = `falsy_${i}`;
      clientCache.set(k, falsy[i], 60000);
      assert.equal(clientCache.has(k), true, `has() debe ser true para falsy index ${i}`);
      assert.ok(Object.is(clientCache.get(k), falsy[i]), `get() debe retornar exactamente el valor falsy index ${i}`);
    }
  });

  it('2.1.3. Manejo de claves exóticas (null, undefined, 0, false, empty string, symbols, __proto__)', () => {
    clientCache.clear();
    const sym = Symbol('test_sym');

    clientCache.set(null, 'val_null', 60000);
    clientCache.set(undefined, 'val_undefined', 60000);
    clientCache.set(0, 'val_zero', 60000);
    clientCache.set(false, 'val_false', 60000);
    clientCache.set('', 'val_empty', 60000);
    clientCache.set(sym, 'val_sym', 60000);
    clientCache.set('__proto__', 'val_proto', 60000);

    assert.equal(clientCache.has(null), true);
    assert.equal(clientCache.get(null), 'val_null');

    assert.equal(clientCache.has(undefined), true);
    assert.equal(clientCache.get(undefined), 'val_undefined');

    assert.equal(clientCache.has(0), true);
    assert.equal(clientCache.get(0), 'val_zero');

    assert.equal(clientCache.has(false), true);
    assert.equal(clientCache.get(false), 'val_false');

    assert.equal(clientCache.has(''), true);
    assert.equal(clientCache.get(''), 'val_empty');

    assert.equal(clientCache.has(sym), true);
    assert.equal(clientCache.get(sym), 'val_sym');

    assert.equal(clientCache.has('__proto__'), true);
    assert.equal(clientCache.get('__proto__'), 'val_proto');
  });

  it('2.1.4. Expiración de TTL y poda automática en .has()', async () => {
    clientCache.clear();

    // TTL negativo
    clientCache.set('exp_neg', 'val', -50);
    assert.equal(clientCache.has('exp_neg'), false, 'TTL negativo debe retornar false en has()');
    assert.equal(clientCache.store.has('exp_neg'), false, 'Entrada expirada debe ser eliminada del store');

    // TTL corto
    clientCache.set('exp_short', 'val', 25);
    assert.equal(clientCache.has('exp_short'), true, 'Entrada vigente retorna true');
    await new Promise(r => setTimeout(r, 35));
    assert.equal(clientCache.has('exp_short'), false, 'Tras expirar el TTL, has() retorna false');
    assert.equal(clientCache.store.has('exp_short'), false, 'Y se elimina de this.store');
  });

  it('2.1.5. Invariante: .has() no muta el orden de acceso LRU', () => {
    clientCache.clear();
    clientCache.set('a', 1);
    clientCache.set('b', 2);
    clientCache.set('c', 3);

    const initialKeys = [...clientCache.store.keys()];
    clientCache.has('a');
    clientCache.has('a');
    clientCache.has('b');

    assert.deepEqual([...clientCache.store.keys()], initialKeys, 'has() no debe alterar orden LRU');

    clientCache.get('a');
    assert.deepEqual([...clientCache.store.keys()], ['b', 'c', 'a'], 'get() sí actualiza orden LRU');
  });
});
