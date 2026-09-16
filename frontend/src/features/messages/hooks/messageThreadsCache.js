// frontend/src/features/messages/hooks/messageThreadsCache.js
//
// Cache simplu, in-memory, shared la nivel de modul (un singur Map, nu un
// al doilea sistem de state / nu React Query/SWR) - folosit de
// useMessageThreads pentru toți consumatorii lui (MiniMessages din
// FloatingHub, pagina User/Messages, pagina Vendor/Mesaje).
//
// Cheia cache-ului e chiar URL-ul rezolvat (deja include rol + mod +
// scope/filtre/căutare - vezi buildUrl la fiecare apelant), deci
// USER / VENDOR CUSTOMER / VENDOR_TO_VENDOR / orice combinație de
// filtre nu se amestecă niciodată între ele - fiecare URL distinct are
// propria intrare, fără nicio hartă de roluri hardcodată aici.
//
// Per URL se ține: items, loadedAt (pt. TTL stale-while-revalidate),
// error, promisiunea in-flight curentă (deduplichează cereri paralele -
// prefetch idle + hover + click pe același URL => UN SINGUR request),
// setul de listeners (hook-urile montate acum pe acel URL) și UN SINGUR
// interval de poll de 15s per URL - pornit doar cât există >=1 listener,
// oprit la ultimul unsubscribe. Dacă MiniMessages (ținut montat în
// fundal după prima deschidere) și pagina completă /cont/mesaje sunt
// montate simultan pe același URL, împart același interval - nu
// pornesc două poll-uri independente pentru aceeași listă.
import { api } from "../../../lib/api";

const TTL_MS = 20000; // 15-30s cerut; poll-ul de 15s (neschimbat) ține cache-ul practic mereu fresh cât există un listener activ
const POLL_MS = 15000; // identic cu polling-ul existent în useMessageThreads - nu s-a schimbat cadența

const cache = new Map();

function getOrCreateEntry(url) {
  let entry = cache.get(url);
  if (!entry) {
    entry = {
      items: [],
      loadedAt: 0,
      error: null,
      inFlight: null,
      listeners: new Set(),
      pollTimer: null,
    };
    cache.set(url, entry);
  }
  return entry;
}

function notify(url) {
  const entry = cache.get(url);
  if (!entry) return;
  for (const listener of entry.listeners) listener(entry);
}

export function getCachedEntry(url) {
  return cache.get(url) || null;
}

export function isFresh(url) {
  const entry = cache.get(url);
  if (!entry || !entry.loadedAt) return false;
  return Date.now() - entry.loadedAt < TTL_MS;
}

// Pornește (sau reutilizează) fetch-ul pt. `url`. Dacă un request pentru
// exact același URL e deja in-flight, se întoarce ACEEAȘI promisiune -
// nu pornește un al doilea request identic. `force` ignoră TTL-ul (folosit
// de reload() manual, de poll și de invalidarea la messages:changed).
export function requestThreads(url, { force = false } = {}) {
  const entry = getOrCreateEntry(url);

  if (entry.inFlight) return entry.inFlight;
  if (!force && isFresh(url)) return Promise.resolve(entry);

  const promise = api(url)
    .then((data) => {
      entry.items = data?.items || [];
      entry.error = null;
      entry.loadedAt = Date.now();
    })
    .catch((e) => {
      entry.error = e?.message || "Eroare la încărcarea conversațiilor";
    })
    .finally(() => {
      entry.inFlight = null;
      notify(url);
    });

  entry.inFlight = promise;
  return promise;
}

// Prefetch discret - nu forțează dacă deja fresh sau deja in-flight (deci
// idle prefetch + hover prefetch + un click imediat, pe același URL, se
// leagă toate de aceeași cerere).
export function prefetchThreads(url) {
  requestThreads(url, { force: false });
}

// Update optimist local (ex. archive/delete thread în pagina completă),
// propagat la TOȚI consumatorii aceluiași URL - fără asta, mutația ar
// rămâne izolată în state-ul unei singure componente montate și celelalte
// (ex. MiniMessages ținut montat în fundal) ar rămâne cu lista veche.
export function setCachedItems(url, updater) {
  const entry = getOrCreateEntry(url);
  entry.items = typeof updater === "function" ? updater(entry.items) : updater;
  notify(url);
}

// Un hook se abonează la un URL cât e montat. Primul abonat pentru acel
// URL pornește poll-ul de 15s, ultimul care se dezabonează îl oprește.
export function subscribeThreads(url, listener) {
  const entry = getOrCreateEntry(url);
  entry.listeners.add(listener);

  if (!entry.pollTimer) {
    entry.pollTimer = setInterval(() => {
      requestThreads(url, { force: true });
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

// La orice eveniment care schimbă mesajele (send, mark-as-read, thread
// nou etc. - reutilizează evenimentul existent `messages:changed`,
// dispatchMessagesChanged() din messageFormatters.js) - tot cache-ul e
// marcat stale; URL-urile cu listeners activi acum se reîmprospătează
// imediat, restul rămân servibile instant (stale) la următoarea montare
// și se reîmprospătează atunci în fundal - nicio listă nu rămâne blocată
// cu date vechi la nesfârșit.
function invalidateAll() {
  for (const [url, entry] of cache.entries()) {
    entry.loadedAt = 0;
    if (entry.listeners.size > 0) {
      requestThreads(url, { force: true });
    }
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("messages:changed", invalidateAll);
}
