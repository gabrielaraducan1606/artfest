// src/components/FloatingHub/assistantPromptScheduler.js
//
// Logica de PROGRAMARE a mesajului speech-bubble de lângă bula
// Asistentului (FloatingHub.jsx) - extrasă ca modul PUR (fără React,
// fără DOM direct - storage/ceas/scheduler injectabile), testabilă cu
// `node --test`, la fel ca restul modulelor pure din proiect.
//
// FRECVENȚĂ (audit 2026, cerință explicită de business):
//   - prima apariție: ~4,5s de la intrarea pe homepage;
//   - dacă userul o ignoră (nu deschide Asistentul, nu dă dismiss),
//     poate reapărea după 60-90s (interval, ales aleator la fiecare
//     afișare - "aproximativ", nu o valoare fixă);
//   - maximum 3 apariții pe sesiune;
//   - dacă userul deschide Asistentul (oricând, chiar dacă îl închide
//     ulterior) - NU mai apare deloc, tot restul sesiunii;
//   - dacă userul dă dismiss manual (×) - cooldown mai lung
//     (implicit 4 minute) înainte de o eventuală reapariție ulterioară,
//     tot sub limita de 3 apariții.
//
// STARE - păstrată STRICT prin accessorii injectați (sessionStorage în
// FloatingHub.jsx, NU localStorage):
//   - `getShownCount`/`incrementShownCount` - câte apariții reale au
//     avut loc deja în sesiune;
//   - `getNextEligibleAt`/`setNextEligibleAt` - timestamp (ms) - cel
//     mai devreme moment la care poate avea loc URMĂTOAREA apariție
//     (folosit doar de la a 2-a apariție încolo; prima foloseşte
//     mereu `firstDelayMs` de la intrarea pe homepage);
//   - `getEverOpened` - a deschis userul Asistentul, VREODATĂ, în
//     această sesiune (setat din FloatingHub.jsx la `open === true`).
//
// BUG-UL VECHI (reparat anterior, audit 2026) NU se repetă aici: nu
// există nicio stare suplimentară de tip "am încercat deja o dată" în
// afara stării descrise mai sus - `sync()` rămâne idempotent, apelabil
// oricând (inclusiv la navigare away/back repetată), anulează mereu
// timer-ul anterior și decide din nou, strict pe baza stării curente.

export const DEFAULT_FIRST_DELAY_MS = 4500;
export const DEFAULT_MIN_REAPPEAR_MS = 60000;
export const DEFAULT_MAX_REAPPEAR_MS = 90000;
export const DEFAULT_DISMISS_COOLDOWN_MS = 240000; // 4 minute
export const DEFAULT_MAX_APPEARANCES = 3;

/**
 * @param {object} params
 * @param {number} [params.firstDelayMs]
 * @param {number} [params.minReappearMs]
 * @param {number} [params.maxReappearMs]
 * @param {number} [params.dismissCooldownMs]
 * @param {number} [params.maxAppearances]
 * @param {() => number} params.getShownCount
 * @param {() => void} params.incrementShownCount
 * @param {() => number|null} params.getNextEligibleAt
 * @param {(timestamp: number) => void} params.setNextEligibleAt
 * @param {() => boolean} params.getEverOpened
 * @param {() => void} params.onShow - apelat la fiecare apariție reală.
 * @param {() => number} [params.now] - injectabil pentru teste.
 * @param {() => number} [params.random] - injectabil (0..1) pentru teste.
 * @param {typeof setTimeout} [params.setTimeoutFn]
 * @param {typeof clearTimeout} [params.clearTimeoutFn]
 */
export function createAssistantPromptScheduler({
  firstDelayMs = DEFAULT_FIRST_DELAY_MS,
  minReappearMs = DEFAULT_MIN_REAPPEAR_MS,
  maxReappearMs = DEFAULT_MAX_REAPPEAR_MS,
  dismissCooldownMs = DEFAULT_DISMISS_COOLDOWN_MS,
  maxAppearances = DEFAULT_MAX_APPEARANCES,
  getShownCount,
  incrementShownCount,
  getNextEligibleAt,
  setNextEligibleAt,
  getEverOpened,
  onShow,
  now = () => Date.now(),
  random = Math.random,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
}) {
  let timerId = null;
  let lastState = { isHomepage: false, open: false };

  function cancel() {
    if (timerId !== null) {
      clearTimeoutFn(timerId);
      timerId = null;
    }
  }

  function pickReappearDelayMs() {
    const span = Math.max(0, maxReappearMs - minReappearMs);
    return minReappearMs + Math.round(random() * span);
  }

  /*
   * Anulează orice timer anterior și decide DIN NOU, de la zero,
   * strict pe baza `lastState` (ultimele isHomepage/open primite prin
   * `sync()`) + starea persistată. Apelată atât din `sync()` (la
   * schimbarea rutei/panoului), cât și din PROPRIUL callback de
   * afișare (auto-reprogramare - vezi mai jos, necesar ca fereastra
   * de 60-90s să fie respectată chiar dacă userul rămâne continuu pe
   * homepage, fără nicio schimbare de rută care să retrigger-uiască
   * efectul React).
   */
  function evaluate() {
    cancel();

    const { isHomepage, open } = lastState;
    if (!isHomepage || open || getEverOpened()) return;

    const shownCount = getShownCount();
    if (shownCount >= maxAppearances) return;

    const delayMs =
      shownCount === 0
        ? firstDelayMs
        : Math.max(0, (getNextEligibleAt() ?? 0) - now());

    timerId = setTimeoutFn(() => {
      timerId = null;
      incrementShownCount();
      setNextEligibleAt(now() + pickReappearDelayMs());
      onShow();
      // auto-reprogramare imediată pentru eventuala apariție următoare
      // (respectă oricum maxAppearances/nextEligibleAt/everOpened mai
      // sus) - fără asta, fereastra de 60-90s nu s-ar mai verifica
      // niciodată dacă userul nu schimbă ruta.
      evaluate();
    }, delayMs);
  }

  function sync({ isHomepage, open }) {
    lastState = { isHomepage, open };
    evaluate();
  }

  /*
   * Dismiss manual (×) - cooldown MAI LUNG decât reapariția normală
   * (implicit 4 minute), suprascriind orice fereastră scurtă deja
   * programată, apoi reprogramează imediat cu noua valoare.
   */
  function registerDismiss() {
    setNextEligibleAt(now() + dismissCooldownMs);
    evaluate();
  }

  return { sync, cancel, registerDismiss };
}
