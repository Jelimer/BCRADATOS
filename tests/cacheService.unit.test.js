const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { CacheService, cacheService: singletonCache } = require('../services/cacheService');

describe('Tier 3: CacheService In-Memory Isolated Unit Tests', () => {

  it('3.1. Presets de TTL formalizados en cacheService.TTL', () => {
    // Presets requeridos específicamente por M3
    assert.equal(singletonCache.TTL.BANCOS, 60, 'TTL de BANCOS debe ser 60 segundos');
    assert.equal(singletonCache.TTL.INDICADORES, 3600, 'TTL de INDICADORES debe ser 3600 segundos (1 hora)');
    assert.equal(singletonCache.TTL.FINANZAS, 1800, 'TTL de FINANZAS debe ser 1800 segundos (30 minutos)');

    // Presets canónicos del catálogo y series
    assert.equal(singletonCache.TTL.CATALOG, 86400, 'TTL de CATALOG debe ser 86400 segundos (24 horas)');
    assert.equal(singletonCache.TTL.HISTORICAL_SERIES, 3600, 'TTL de HISTORICAL_SERIES debe ser 3600 segundos');
    assert.equal(singletonCache.TTL.TRANSPARENCY, 1800, 'TTL de TRANSPARENCY debe ser 1800 segundos');
    assert.equal(singletonCache.TTL.LIVE_MARKET, 30, 'TTL de LIVE_MARKET debe ser 30 segundos');
    assert.equal(singletonCache.TTL.IDENTIFIER_QUERY, 300, 'TTL de IDENTIFIER_QUERY debe ser 300 segundos');
    assert.equal(singletonCache.TTL.FALLBACK_PERSISTENT, 604800, 'TTL de FALLBACK_PERSISTENT debe ser 7 días');
  });

  it('3.2. Capacidad máxima de 2.000 entradas y desalojo LRU estricto O(1)', () => {
    const cache = new CacheService({ maxEntries: 2000, cleanupIntervalMs: 0 });

    try {
      // 1. Llenar la caché hasta su capacidad exacta de 2.000 entradas
      for (let i = 0; i < 2000; i++) {
        cache.set(`key_${i}`, `val_${i}`, 600);
      }

      assert.equal(cache.store.size, 2000, 'La caché debe tener exactamente 2.000 elementos');
      assert.equal(cache.stats.evictions, 0, 'No debe haber desalojos antes de superar maxEntries');

      // 2. Acceder a key_0 para actualizar su uso (LRU).
      // Al ser accedida, key_0 se mueve al final del Map (más recientemente usada),
      // convirtiendo a key_1 en la entrada más antigua (LRU).
      const val0 = cache.get('key_0');
      assert.equal(val0, 'val_0');

      // 3. Insertar la entrada 2.001 (supera capacidad)
      cache.set('key_2000', 'val_2000', 600);

      assert.equal(cache.store.size, 2000, 'La capacidad máxima debe mantenerse en 2.000');
      assert.equal(cache.stats.evictions, 1, 'Debe registrarse exactamente 1 desalojo');

      // 4. Verificar que key_1 fue desalojada (era la LRU) y key_0 sobrevivió
      assert.equal(cache.has('key_1'), false, 'key_1 debe haber sido desalojada por ser la LRU');
      assert.equal(cache.has('key_0'), true, 'key_0 debe conservarse al haber sido refrescada por acceso');
      assert.equal(cache.has('key_2000'), true, 'La nueva clave insertada debe estar presente');
    } finally {
      cache.destroy();
    }
  });

  it('3.3. Ordenamiento LRU mediante getEntry() preserva elementos consultados recientemente', () => {
    const cache = new CacheService({ maxEntries: 3, cleanupIntervalMs: 0 });

    try {
      cache.set('alpha', 'A', 600);
      cache.set('beta', 'B', 600);
      cache.set('gamma', 'C', 600);

      assert.equal(cache.store.size, 3);

      // Acceder a 'alpha' utilizando getEntry() (método empleado por Express cacheMiddleware)
      const entryAlpha = cache.getEntry('alpha');
      assert.ok(entryAlpha);
      assert.equal(entryAlpha.value, 'A');

      // Insertar un cuarto elemento 'delta'
      cache.set('delta', 'D', 600);

      assert.equal(cache.store.size, 3);
      assert.equal(cache.stats.evictions, 1);

      // 'beta' debe haber sido desalojado (era el menos recientemente usado tras consultar alpha)
      assert.equal(cache.has('beta'), false, 'beta debe ser desalojado por LRU');
      assert.equal(cache.has('alpha'), true, 'alpha debe preservarse gracias a getEntry()');
      assert.equal(cache.has('gamma'), true);
      assert.equal(cache.has('delta'), true);
    } finally {
      cache.destroy();
    }
  });

  it('3.4. Sincronización de estadísticas (hits, misses, expirations) en getEntry()', () => {
    const cache = new CacheService({ cleanupIntervalMs: 0 });

    try {
      // Intento de lectura de clave inexistente debe registrar miss
      const noEntry = cache.getEntry('inexistente');
      assert.equal(noEntry, null);
      assert.equal(cache.stats.misses, 1);
      assert.equal(cache.stats.hits, 0);

      // Insertar una clave válida
      cache.set('clave_activa', { foo: 'bar' }, 120);

      // Primera lectura con hit
      const entry1 = cache.getEntry('clave_activa');
      assert.ok(entry1);
      assert.deepEqual(entry1.value, { foo: 'bar' });
      assert.equal(entry1.hits, 1);
      assert.equal(cache.stats.hits, 1);
      assert.ok(entry1.ttlRemaining > 0 && entry1.ttlRemaining <= 120);

      // Segunda lectura con hit consecutivo
      const entry2 = cache.getEntry('clave_activa');
      assert.ok(entry2);
      assert.equal(entry2.hits, 2);
      assert.equal(cache.stats.hits, 2);
    } finally {
      cache.destroy();
    }
  });

  it('3.5. Método purgeExpired() y remoción precisa de caducados', async () => {
    const cache = new CacheService({ cleanupIntervalMs: 0 });

    try {
      // Insertar 2 elementos con TTL mínimo de 1 segundo
      cache.set('expira_1', 'dato_1', 1);
      cache.set('expira_2', 'dato_2', 1);
      // Insertar 1 elemento con TTL largo
      cache.set('permanente', 'dato_3', 3600);

      assert.equal(cache.store.size, 3);

      // Esperar 1.100 ms para garantizar expiración de los 2 primeros
      await new Promise(resolve => setTimeout(resolve, 1100));

      const purgados = cache.purgeExpired();
      assert.equal(purgados, 2, 'Deben haberse purgado exactamente 2 entradas');
      assert.equal(cache.stats.expirations, 2, 'stats.expirations debe reflejar los 2 purgados');

      assert.equal(cache.has('expira_1'), false);
      assert.equal(cache.has('expira_2'), false);
      assert.equal(cache.has('permanente'), true);
      assert.equal(cache.store.size, 1);
    } finally {
      cache.destroy();
    }
  });

  it('3.6. Cálculo preciso de hitRate porcentual ante secuencias de hits y misses', () => {
    const cache = new CacheService({ cleanupIntervalMs: 0 });

    try {
      // Estado inicial vacío
      assert.equal(cache.getStats().hitRate, '0%');

      // 1 Miss -> total=1, hits=0 -> 0%
      cache.get('clave_fantasma');
      assert.equal(cache.getStats().hitRate, '0%');

      // Insertar elemento
      cache.set('item', 'valor', 60);

      // 1 Hit vía get() -> total=2, hits=1 -> 50%
      cache.get('item');
      assert.equal(cache.getStats().hitRate, '50%');

      // 1 Hit vía getEntry() -> total=3, hits=2 -> 66.67%
      cache.getEntry('item');
      assert.equal(cache.getStats().hitRate, '66.67%');

      // 1 Hit adicional vía get() -> total=4, hits=3 -> 75%
      cache.get('item');
      assert.equal(cache.getStats().hitRate, '75%');

      // 1 Hit adicional vía get() -> total=5, hits=4 -> 80%
      cache.get('item');
      assert.equal(cache.getStats().hitRate, '80%');

      // Estructura completa de getStats()
      const stats = cache.getStats();
      assert.equal(stats.hits, 4);
      assert.equal(stats.misses, 1);
      assert.equal(stats.sets, 1);
      assert.equal(stats.size, 1);
      assert.equal(stats.maxEntries, 2000);
      assert.ok(Array.isArray(stats.keys));
      assert.equal(stats.keys[0], 'item');
    } finally {
      cache.destroy();
    }
  });

  it('3.7. Operatividad completa de métodos has(), delete(), clear() y destroy()', () => {
    const cache = new CacheService({ cleanupIntervalMs: 0 });

    // has()
    cache.set('clave_x', 999, 100);
    assert.equal(cache.has('clave_x'), true);
    assert.equal(cache.has('clave_y'), false);

    // delete()
    assert.equal(cache.delete('clave_x'), true);
    assert.equal(cache.stats.deletes, 1);
    assert.equal(cache.has('clave_x'), false);
    assert.equal(cache.delete('clave_x'), false, 'Eliminar clave inexistente retorna false');

    // clear()
    cache.set('a', 1);
    cache.set('b', 2);
    assert.equal(cache.store.size, 2);
    cache.clear();
    assert.equal(cache.store.size, 0);

    // destroy()
    cache.set('c', 3);
    assert.equal(cache.store.size, 1);
    cache.destroy();
    assert.equal(cache.store.size, 0);
  });
});
