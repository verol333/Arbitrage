// Sémaphore concurrentiel + cache mémoire TTL utilisés par toutes les couches proxy.
export function createSemaphore(maxConcurrency) {
  let active = 0;
  const queue = [];
  const runNext = () => {
    if (active >= maxConcurrency || queue.length === 0) return;
    active++;
    const { fn, resolve, reject } = queue.shift();
    Promise.resolve()
      .then(fn)
      .then((v) => resolve(v), (e) => reject(e))
      .finally(() => { active--; runNext(); });
  };
  return (fn) => new Promise((resolve, reject) => { queue.push({ fn, resolve, reject }); runNext(); });
}

export function createTtlCache(ttlMs) {
  const store = new Map();
  return {
    get(key) {
      const hit = store.get(key);
      if (!hit) return undefined;
      if (Date.now() - hit.ts > ttlMs) { store.delete(key); return undefined; }
      return hit.value;
    },
    set(key, value) { store.set(key, { ts: Date.now(), value }); },
    invalidate(key) { store.delete(key); },
    clear() { store.clear(); },
  };
}
