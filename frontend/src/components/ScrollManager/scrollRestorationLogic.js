// src/components/ScrollManager/scrollRestorationLogic.js
//
// Logica PURĂ de scroll restoration (fără React/DOM direct - storage
// și scheduler injectabile), testabilă cu `node --test`, la fel ca
// restul modulelor pure din proiect (ex. collectionCards.js,
// assistantPromptScheduler.js). Componenta React care leagă asta de
// browser e ScrollManager.jsx.

export const SCROLL_STORAGE_PREFIX = "scroll:";

/**
 * Cheia de sessionStorage pentru o rută - include query string-ul,
 * ca `/produse?occasionTag=wedding` să aibă o poziție SEPARATĂ de
 * `/produse` simplu. Exemplu: "scroll:/produse?occasionTag=wedding".
 */
export function buildScrollKey(pathname, search) {
  return `${SCROLL_STORAGE_PREFIX}${pathname}${search || ""}`;
}

export function readScrollPosition(storage, key) {
  try {
    const raw = storage.getItem(key);
    if (raw == null) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : null;
  } catch {
    // storage indisponibil (mod privat etc.) - fără poziție salvată,
    // nu blocăm navigarea
    return null;
  }
}

export function writeScrollPosition(storage, key, y) {
  try {
    const n = Number(y);
    if (!Number.isFinite(n)) return;
    storage.setItem(key, String(Math.max(0, Math.round(n))));
  } catch {
    // storage indisponibil - degradăm silențios
  }
}

/**
 * Decide dacă navigarea CURENTĂ trebuie tratată ca Back/Forward
 * (restaurare) sau ca navigare normală/reload/redirect (sus).
 *
 * De ce nu ne bazăm STRICT pe `navigationType` (POP/PUSH/REPLACE, din
 * react-router `useNavigationType`): la PRIMUL render după o încărcare
 * COMPLETĂ a paginii (reload SAU intrare directă pe URL), react-router
 * își inițializează intern history-ul cu action = "POP" necondiționat
 * - nu poate distinge, din propriile date, un reload de un back/forward
 * real (asta era o cauză posibilă de restaurare greșită la refresh).
 *
 * Pentru ACEST caz (`isFirstRun: true`), folosim semnalul AUTORITAR al
 * browserului - Navigation Timing API
 * (`performance.getEntriesByType("navigation")[0].type`):
 *   "reload"       -> NU restaurăm (refresh - punctul A);
 *   "navigate"     -> NU restaurăm (intrare directă pe URL / link extern);
 *   "back_forward" -> restaurăm (back/forward real, prima randare a filei).
 *
 * Pentru toate navigările ULTERIOARE din aceeași sesiune SPA,
 * `navigationType` e deja instrumentat corect de react-router (POP =
 * Back/Forward real, PUSH = navigare normală, REPLACE = redirect) -
 * îl folosim direct, fără nicio ambiguitate.
 */
export function resolveShouldRestore({
  navigationType,
  isFirstRun,
  navigationTimingType,
}) {
  if (!isFirstRun) {
    return navigationType === "POP";
  }

  if (navigationTimingType === "back_forward") return true;
  if (
    navigationTimingType === "reload" ||
    navigationTimingType === "navigate" ||
    navigationTimingType === "prerender"
  ) {
    return false;
  }

  // Navigation Timing indisponibil (browser vechi/context restrictiv) -
  // fallback pe navigationType; ambiguu DOAR pentru prima randare.
  return navigationType === "POP";
}

/**
 * Așteaptă (bounded) ca `predicate()` să devină true, verificând din
 * nou la fiecare "tick" programat prin `schedule` (de regulă
 * requestAnimationFrame) - apoi apelează `onSettle()` O SINGURĂ DATĂ,
 * fie la succes, fie la epuizarea încercărilor (`maxAttempts`). Fără
 * bucle infinite, fără acțiuni vizibile repetate.
 */
export function waitUntilReady({
  predicate,
  onSettle,
  schedule,
  maxAttempts = 30,
}) {
  let attempts = 0;

  function tick() {
    attempts += 1;
    if (predicate() || attempts >= maxAttempts) {
      onSettle();
      return;
    }
    schedule(tick);
  }

  schedule(tick);
}
