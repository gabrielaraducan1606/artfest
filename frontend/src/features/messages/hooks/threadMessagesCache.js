// frontend/src/features/messages/hooks/threadMessagesCache.js
//
// Cache in-memory, shared la nivel de modul, pentru mesajele UNUI thread -
// completează messageThreadsCache.js (care ține lista de threads), nu-l
// înlocuiește și nu duplică formatul lui.
//
// Cheia e `base` - exact ce întoarce `buildEndpoint(threadId)` la fiecare
// apelant (MiniThread, UserMessages, Vendor Messages) - deja include
// rolul/modul (customer vs vendor-to-vendor au baze diferite) + threadId,
// deci nicio hartă de roluri hardcodată aici, la fel ca la threads-list.
//
// Fiecare intrare ține exact contractul pe care îl expunea deja
// useThreadMessages: items (mesajele), hasMoreOlder, threadMeta,
// quoteRequest, peerLastReadAt - plus loadedAt/error/inFlight (fetch-ul
// curent de "ultimele mesaje")/inFlightOlder (fetch-ul curent de
// loadOlder, guard separat)/listeners/pollTimer/lastAccess (pt. LRU).
//
// Important: fetch-urile GET de aici NU marchează niciodată threadul ca
// citit - asta ar strica badge-urile de unread doar din prefetch/hover.
// Marcarea "citit" (PATCH /read) e o funcție separată (markThreadRead),
// apelată explicit DOAR din locurile care reprezintă o vizualizare reală
// (subscribeThread - folosit de useThreadMessages, adică threadul e chiar
// deschis) - niciodată din prefetchThreadMessages.
import { api } from "../../../lib/api";
import { dispatchMessagesChanged } from "../utils/messageFormatters";

const TTL_MS = 20000; // aceeași fereastră ca la threads-list
const POLL_MS = 8000; // neschimbat față de useThreadMessages original
const MAX_CACHED_THREADS = 8;

const cache = new Map();

function getOrCreateEntry(base) {
  let entry = cache.get(base);
  if (!entry) {
    entry = {
      items: [],
      hasMoreOlder: false,
      threadMeta: null,
      quoteRequest: null,
      peerLastReadAt: null,
      loadedAt: 0,
      error: null,
      inFlight: null,
      inFlightOlder: null,
      listeners: new Set(),
      pollTimer: null,
      lastAccess: Date.now(),
    };
    cache.set(base, entry);
    evictIfNeeded();
  }
  entry.lastAccess = Date.now();
  return entry;
}

// LRU simplu: nu evacuăm niciodată o intrare cu listeners activi (thread
// chiar deschis acum) - doar cele "reci", cele mai vechi după lastAccess.
function evictIfNeeded() {
  if (cache.size <= MAX_CACHED_THREADS) return;

  const evictable = [...cache.entries()]
    .filter(([, entry]) => entry.listeners.size === 0)
    .sort((a, b) => a[1].lastAccess - b[1].lastAccess);

  while (cache.size > MAX_CACHED_THREADS && evictable.length) {
    const [key] = evictable.shift();
    cache.delete(key);
  }
}

function notify(base) {
  const entry = cache.get(base);
  if (!entry) return;
  for (const listener of entry.listeners) listener(entry);
}

function lastRealId(items) {
  for (let i = items.length - 1; i >= 0; i--) {
    const id = items[i]?.id;
    if (id && !String(id).startsWith("local_")) return id;
  }
  return null;
}

function dedupeAppend(prev, incoming) {
  const seen = new Set(prev.map((m) => m.id));
  const fresh = incoming.filter((m) => !seen.has(m.id));
  return fresh.length ? [...prev, ...fresh] : prev;
}

function dedupePrepend(prev, incoming) {
  const seen = new Set(prev.map((m) => m.id));
  const fresh = incoming.filter((m) => !seen.has(m.id));
  return fresh.length ? [...fresh, ...prev] : prev;
}

export function getEntry(base) {
  return cache.get(base) || null;
}

export function isFresh(base) {
  const entry = cache.get(base);
  if (!entry || !entry.loadedAt) return false;
  return Date.now() - entry.loadedAt < TTL_MS;
}

// GET "ultimele N mesaje", ÎNLOCUIEȘTE items complet - identic cu vechiul
// reload(). Necesar (nu doar "adaugă mai noi") pentru cazul send-success:
// mesajul optimist local_... trebuie să dispară, iar un simplu append nu
// l-ar elimina niciodată (id diferit de al mesajului real din răspuns).
async function runFetchReplace(entry, base, pageSize) {
  try {
    const data = await api(`${base}/messages?limit=${pageSize}`);
    entry.items = Array.isArray(data?.items) ? data.items : [];
    entry.threadMeta = data?.threadMeta || null;
    entry.quoteRequest = data?.quoteRequest || null;
    entry.hasMoreOlder = Boolean(data?.hasMoreOlder);
    entry.peerLastReadAt = data?.peerLastReadAt || null;
    entry.error = null;
    entry.loadedAt = Date.now();
  } catch (e) {
    entry.error = e?.message || "Eroare la încărcarea mesajelor";
  } finally {
    notify(base);
  }
}

// GET doar mesaje mai noi decât ultimul id real cunoscut, APPEND-dedupe -
// identic cu vechiul pollLatest(). Păstrează orice istoric extins prin
// loadOlder (nu suprascrie items complet) - de-aia mount-ul unui thread
// deja cache-uit NU pierde paginile încărcate manual într-o sesiune.
async function runFetchNewer(entry, base, pageSize) {
  const cursor = lastRealId(entry.items);
  if (!cursor) return runFetchReplace(entry, base, pageSize);

  try {
    const data = await api(`${base}/messages?limit=${pageSize}&after=${encodeURIComponent(cursor)}`);
    const incoming = Array.isArray(data?.items) ? data.items : [];
    if (incoming.length) entry.items = dedupeAppend(entry.items, incoming);
    entry.threadMeta = data?.threadMeta || null;
    entry.quoteRequest = data?.quoteRequest || null;
    entry.peerLastReadAt = data?.peerLastReadAt || null;
    entry.error = null;
    entry.loadedAt = Date.now();
  } catch (e) {
    // cursor invalid server-side (rar) - recuperare prin reload complet,
    // fără eroare vizibilă, la fel ca înainte.
    if (e?.status === 400) return runFetchReplace(entry, base, pageSize);
    entry.error = e?.message || "Eroare la încărcarea mesajelor";
  } finally {
    notify(base);
  }
}

// GET-only, fără efect de "citit". Deduplichează cereri paralele pt.
// ACELAȘI base - prefetch, hover, poll și mount pot cere simultan, dar
// primesc toate aceeași promisiune dacă una e deja în zbor.
export function ensureFreshLatest(base, { pageSize = 50 } = {}) {
  const entry = getOrCreateEntry(base);
  if (entry.inFlight) return entry.inFlight;

  const run = entry.items.length
    ? runFetchNewer(entry, base, pageSize)
    : runFetchReplace(entry, base, pageSize);

  entry.inFlight = run.finally(() => {
    entry.inFlight = null;
  });
  return entry.inFlight;
}

// Prefetch discret - respectă TTL (nu refetch-uiește un thread deja
// fresh doar pentru că userul a mai trecut cu mouse-ul peste el).
export function prefetchThreadMessages(base, opts) {
  if (isFresh(base)) return;
  ensureFreshLatest(base, opts);
}

// Reload explicit, FORȚAT (folosit de reload() expus din hook - ex. după
// send success, ca să înlocuiască mesajul optimist cu cel real). Așteaptă
// orice fetch deja în zbor (nu pornește un al doilea request paralel),
// apoi face mereu un GET complet, indiferent de ce avea deja cache-ul.
export async function reloadThreadLatest(base, { pageSize = 50 } = {}) {
  const entry = getOrCreateEntry(base);
  if (entry.inFlight) await entry.inFlight.catch(() => {});

  const run = runFetchReplace(entry, base, pageSize);
  entry.inFlight = run.finally(() => {
    entry.inFlight = null;
  });
  return entry.inFlight;
}

// loadOlder - guard separat de "latest" (operații independente, pot
// coexista). Prepend-dedupe, actualizează hasMoreOlder.
export async function loadOlderThreadPage(base, { pageSize = 50 } = {}) {
  const entry = getOrCreateEntry(base);
  if (entry.inFlightOlder) return entry.inFlightOlder;

  const oldestId = entry.items.length ? entry.items[0].id : null;
  if (!oldestId) return { appended: 0 };

  const run = (async () => {
    try {
      const data = await api(`${base}/messages?limit=${pageSize}&before=${encodeURIComponent(oldestId)}`);
      const incoming = Array.isArray(data?.items) ? data.items : [];
      let appended = 0;
      if (incoming.length) {
        const next = dedupePrepend(entry.items, incoming);
        appended = next.length - entry.items.length;
        entry.items = next;
      }
      entry.hasMoreOlder = Boolean(data?.hasMoreOlder);
      return { appended };
    } catch (e) {
      entry.error = e?.message || "Eroare la încărcarea mesajelor mai vechi";
      return { appended: 0 };
    } finally {
      notify(base);
    }
  })();

  entry.inFlightOlder = run.finally(() => {
    entry.inFlightOlder = null;
  });
  return entry.inFlightOlder;
}

// PATCH /read - complet separat de GET. Apelată DOAR pt. o vizualizare
// reală (subscribeThread), niciodată din prefetch.
export async function markThreadRead(base) {
  try {
    await api(`${base}/read`, { method: "PATCH" });
    dispatchMessagesChanged();
  } catch {
    // best-effort, ca înainte - o eroare la marcarea "citit" nu trebuie
    // să arate ca o eroare de încărcare a mesajelor.
  }
}

// Update optimist local (mesaj trimis/retry) - propagat la toți
// consumatorii aceluiași thread (ex. dacă din greșeală ar fi montat de
// două ori simultan).
export function setThreadItems(base, updater) {
  const entry = getOrCreateEntry(base);
  entry.items = typeof updater === "function" ? updater(entry.items) : updater;
  notify(base);
}

// Un hook activ (thread chiar deschis) se abonează cât e montat. Fiecare
// abonare (nu doar prima) declanșează imediat un check de prospețime +
// marcare "citit" - un thread redeschis trebuie marcat citit ACUM, nu la
// următorul tick de poll. Primul abonat pentru un `base` pornește poll-ul
// comun de 8s; ultimul care se dezabonează îl oprește - dacă MiniThread
// (ținut montat în fundal) și pagina completă au același thread deschis
// simultan, împart UN SINGUR poll, nu unul fiecare.
export function subscribeThread(base, listener, opts) {
  const entry = getOrCreateEntry(base);
  entry.listeners.add(listener);

  ensureFreshLatest(base, opts).then(() => markThreadRead(base));

  if (!entry.pollTimer) {
    entry.pollTimer = setInterval(() => {
      ensureFreshLatest(base, opts).then(() => markThreadRead(base));
    }, POLL_MS);
  }

  return function unsubscribe() {
    entry.listeners.delete(listener);
    if (entry.listeners.size === 0 && entry.pollTimer) {
      clearInterval(entry.pollTimer);
      entry.pollTimer = null;
    }
  };
}

// La messages:changed: dacă evenimentul identifică threadId (extensie
// aditivă în dispatchMessagesChanged - vezi messageFormatters.js), doar
// ACEL thread e marcat stale + reîmprospătat dacă are abonați activi.
// Fără threadId (ex. dispatch-ul vechi, fără detail, din AiAssistant.jsx)
// - fallback sigur: toate intrările sunt marcate stale.
function invalidate(threadIdOrAll) {
  for (const [base, entry] of cache.entries()) {
    // `base` e mereu `${apiBase}/(vendor-)threads/${threadId}`, fără query
    // string - ultimul segment e chiar threadId-ul.
    if (threadIdOrAll !== undefined && base.split("/").pop() !== String(threadIdOrAll)) continue;
    entry.loadedAt = 0;
    if (entry.listeners.size > 0) {
      ensureFreshLatest(base).then(() => markThreadRead(base));
    }
  }
}

function handleMessagesChanged(event) {
  invalidate(event?.detail?.threadId);
}

if (typeof window !== "undefined") {
  window.addEventListener("messages:changed", handleMessagesChanged);
}
