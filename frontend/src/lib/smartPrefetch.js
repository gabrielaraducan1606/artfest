// src/lib/smartPrefetch.js
//
// Serviciu central de predictive prefetch, reutilizabil pe orice rută
// publică frecventă (ProductDetails, Store/Profile,
// CustomerRequestDetails, Collections, Campaign etc). Nu e legat de
// React - React Router-ul e conectat prin hook-urile din
// `src/hooks/useSmartPrefetch.js`.
//
// Reguli tari, valabile indiferent de pagina care îl folosește:
// - max N prefetch-uri simultane (nu saturăm rețeaua/serverul);
// - fiecare cheie (chunk/date/imagine) e prefetched o singură dată
//   per sesiune de tab - Set/Map în memorie, dispar la refresh
//   complet, la fel cum se comportă și `productSummary` din
//   navigation state;
// - respectă navigator.connection (saveData / effectiveType);
// - triggerele de intenție directă (hover/focus/touchstart) au
//   prioritate față de cele automate (vizibilitate/idle) în coada
//   internă de execuție.
//
// Serviciul nu decide SINGUR ce e "sigur" de prefetched - e
// responsabilitatea fiecărei pagini publice să-l folosească doar
// unde are sens. Nu-l apelăm din pagini admin/vendor/checkout sau
// pentru date private.

const MAX_CONCURRENT = 3;

let activeCount = 0;
const queue = [];

// Dedup per sesiune de tab (Set în memorie - dispare la refresh).
const seenKeys = new Set();

// Date reale prefetched, gata de folosit ca stare inițială instant.
// NU e o sursă finală - consumatorul trebuie să revalideze oricum.
const dataCache = new Map();

// Doar pentru estimarea de bytes prefetched (măsurare, secțiunea 9) -
// ținem urls-urile concrete ca să le căutăm în Resource Timing API.
const prefetchedUrls = [];

const stats = {
  chunkRequests: 0,
  dataRequests: 0,
  imageRequests: 0,
  cacheHits: 0,
  cacheMisses: 0,
  skippedByConnection: 0,
};

function getConnection() {
  if (typeof navigator === "undefined") return null;
  return (
    navigator.connection ||
    navigator.mozConnection ||
    navigator.webkitConnection ||
    null
  );
}

/*
 * "full"    - orice tip de prefetch e permis;
 * "minimal" - doar prefetch declanșat de intenție directă (hover/
 *             focus/touchstart) - fără prefetch automat pe
 *             vizibilitate sau idle time;
 * "off"     - niciun prefetch, nici măcar la intenție directă.
 */
export function getPrefetchLevel() {
  const conn = getConnection();
  if (!conn) return "full";
  if (conn.saveData) return "minimal";
  const type = conn.effectiveType;
  if (type === "2g" || type === "slow-2g") return "off";
  if (type === "3g") return "minimal";
  return "full";
}

function isAllowed(mode) {
  const level = getPrefetchLevel();
  if (level === "off") return false;
  if (level === "minimal" && mode === "auto") return false;
  return true;
}

function runNext() {
  if (activeCount >= MAX_CONCURRENT) return;
  const job = queue.shift();
  if (!job) return;
  activeCount++;
  job().finally(() => {
    activeCount--;
    runNext();
  });
}

// mode "intent" (hover/focus/touchstart) sare la începutul cozii -
// e aproape sigur că userul deschide pagina, deci merită să treacă
// înaintea unor prefetch-uri "auto" încă neexecutate.
function schedule(fn, mode) {
  if (mode === "intent") {
    queue.unshift(fn);
  } else {
    queue.push(fn);
  }
  runNext();
}

function toPromise(fn, mode) {
  return new Promise((resolve) => {
    schedule(
      () =>
        Promise.resolve()
          .then(fn)
          .catch(() => {})
          .finally(resolve),
      mode
    );
  });
}

export function productPrefetchKey(id) {
  return `product:${id}`;
}

/**
 * Prefetch pentru chunk-ul unei rute lazy (React.lazy).
 * @param {string} key cheie unică de dedup, ex. productPrefetchKey(id)
 * @param {() => Promise} importFn ex. () => import("../pages/.../ProductDetails")
 */
export function prefetchChunk(key, importFn, { mode = "intent" } = {}) {
  if (!key || !importFn) return;
  const dedupKey = `chunk:${key}`;
  if (seenKeys.has(dedupKey)) return;
  if (!isAllowed(mode)) {
    stats.skippedByConnection++;
    return;
  }
  seenKeys.add(dedupKey);
  stats.chunkRequests++;
  toPromise(importFn, mode);
}

/**
 * Prefetch pentru datele reale ale paginii (API). Rezultatul e pus
 * în cache-ul de sesiune și poate fi citit cu `getPrefetchedData`.
 * @param {string} key
 * @param {() => Promise<any>} fetchFn
 * @param {{ mode?: 'intent'|'auto', url?: string }} options `url` e
 *   folosit DOAR pentru estimarea de bytes (măsurare), nu declanșează
 *   el însuși request-ul.
 */
export function prefetchData(key, fetchFn, { mode = "intent", url } = {}) {
  if (!key || !fetchFn) return;
  const dedupKey = `data:${key}`;
  if (seenKeys.has(dedupKey)) return;
  if (!isAllowed(mode)) {
    stats.skippedByConnection++;
    return;
  }
  seenKeys.add(dedupKey);
  stats.dataRequests++;
  if (url) prefetchedUrls.push({ url, kind: "data" });

  toPromise(async () => {
    const data = await fetchFn();
    dataCache.set(key, data);
  }, mode);
}

/**
 * Prefetch pentru o imagine (de regulă imaginea principală a
 * cardului/paginii). La intenție directă (hover/focus/touch) cerem
 * fetchPriority "high" din partea browserului.
 */
export function prefetchImage(url, { mode = "intent" } = {}) {
  if (!url) return;
  const dedupKey = `img:${url}`;
  if (seenKeys.has(dedupKey)) return;
  if (!isAllowed(mode)) {
    stats.skippedByConnection++;
    return;
  }
  seenKeys.add(dedupKey);
  stats.imageRequests++;
  prefetchedUrls.push({ url, kind: "image" });

  toPromise(
    () =>
      new Promise((resolve) => {
        const img = new Image();
        img.decoding = "async";
        if (mode === "intent" && "fetchPriority" in img) {
          img.fetchPriority = "high";
        }
        img.onload = resolve;
        img.onerror = resolve;
        img.src = url;
      }),
    mode
  );
}

/**
 * Citește datele reale prefetched pentru o cheie, dacă există.
 * Contribuie la statistica de cache hit/miss (secțiunea 9). NU
 * garantează date la zi - consumatorul trebuie să revalideze din API.
 */
export function getPrefetchedData(key) {
  const entry = dataCache.get(key);
  if (entry !== undefined) {
    stats.cacheHits++;
    return entry;
  }
  stats.cacheMisses++;
  return null;
}

function estimatePrefetchedBytes() {
  if (
    typeof performance === "undefined" ||
    typeof performance.getEntriesByType !== "function"
  ) {
    return null;
  }
  try {
    const resourceEntries = performance.getEntriesByType("resource");
    let bytes = 0;
    let matched = 0;
    for (const { url } of prefetchedUrls) {
      const entry = resourceEntries.find((e) => e.name === url);
      if (entry && typeof entry.transferSize === "number") {
        bytes += entry.transferSize;
        matched++;
      }
    }
    // Best-effort: transferSize poate fi 0 pentru resurse
    // cross-origin fără Timing-Allow-Origin, sau resursa poate să nu
    // mai apară deloc dacă buffer-ul de resource timing s-a golit.
    return { bytes, matched, total: prefetchedUrls.length };
  } catch {
    return null;
  }
}

export function getSmartPrefetchStats() {
  return {
    ...stats,
    activeCount,
    queued: queue.length,
    connectionLevel: getPrefetchLevel(),
    estimatedBytes: estimatePrefetchedBytes(),
  };
}

if (typeof window !== "undefined" && import.meta.env?.DEV) {
  // Inspectare manuală din consolă: window.__smartPrefetchStats()
  window.__smartPrefetchStats = getSmartPrefetchStats;
}
