export function createLRU(limit = 50) {
  const map = new Map();
  return {
    get(key) {
      if (!map.has(key)) return undefined;
      const val = map.get(key);
      map.delete(key);
      map.set(key, val);
      return val;
    },
    set(key, val) {
      if (map.has(key)) map.delete(key);
      map.set(key, val);
      if (map.size > limit) {
        const firstKey = map.keys().next().value;
        map.delete(firstKey);
      }
    },
    has: (k) => map.has(k),
    clear: () => map.clear(),
  };
}
