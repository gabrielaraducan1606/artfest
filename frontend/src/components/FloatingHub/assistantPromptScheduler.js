// src/components/FloatingHub/assistantPromptScheduler.js
//
// Logica de PROGRAMARE a mesajului speech-bubble de lângă bula
// Asistentului (FloatingHub.jsx) - extrasă ca modul PUR (fără React,
// fără DOM direct - `setTimeout`/`clearTimeout` injectabile), ca să
// poată fi testată cu `node --test`, la fel ca restul modulelor pure
// din proiect (ex. collectionCards.js).
//
// BUG REPARAT (audit 2026) - varianta anterioară ținea o stare
// suplimentară de tip "am încercat deja o dată să programez" (un
// `useRef` separat de sessionStorage). O tentativă ÎNTRERUPTĂ (user
// pleacă de pe homepage, sau deschide Asistentul, ÎNAINTE ca delay-ul
// să expire) anula timer-ul, dar acel flag rămânea `true` PENTRU
// TOATĂ DURATA DE VIAȚĂ A COMPONENTEI (FloatingHub nu se demontează
// la navigare, fiind randat din AppLayout.jsx, în afara <Outlet/>) -
// deci mesajul nu mai putea fi reprogramat NICIODATĂ în acea filă,
// deși nu fusese afișat efectiv niciodată (sessionStorage rămânea gol).
//
// Fix: NICIO stare suplimentară de tip "am încercat" - `sync()` e
// idempotent, apelabil oricând, decide STRICT pe baza stării curente
// (isHomepage, open) + sessionStorage (`getAlreadyShown`, singura
// sursă de adevăr pentru "a fost deja AFIȘAT"). O tentativă întreruptă
// nu "consumă" nimic - la revenire pe homepage (sau la închiderea
// panoului), `sync()` reprogramează normal.

/**
 * @param {object} params
 * @param {number} params.delayMs - întârzierea înainte de afișare.
 * @param {() => boolean} params.getAlreadyShown - citește dacă mesajul
 *   a fost deja AFIȘAT în sesiunea curentă (sessionStorage).
 * @param {() => void} params.markShown - marchează afișarea (scris
 *   STRICT în momentul afișării reale, niciodată mai devreme).
 * @param {() => void} params.onShow - apelat când expiră delay-ul și
 *   chiar trebuie afișat mesajul (ex. setState React).
 * @param {typeof setTimeout} [params.setTimeoutFn]
 * @param {typeof clearTimeout} [params.clearTimeoutFn]
 */
export function createAssistantPromptScheduler({
  delayMs,
  getAlreadyShown,
  markShown,
  onShow,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
}) {
  let timerId = null;

  function cancel() {
    if (timerId !== null) {
      clearTimeoutFn(timerId);
      timerId = null;
    }
  }

  /**
   * Re-evaluează dacă trebuie (re)programat un timer - apelată din
   * efectul React la montare și la fiecare schimbare a lui `isHomepage`
   * / `open` (vezi FloatingHub.jsx, dependințele efectului).
   *
   * Anulează întotdeauna orice timer anterior, apoi decide din nou,
   * de la zero - fără nicio memorie a încercărilor anterioare în
   * afara sessionStorage (`getAlreadyShown`).
   */
  function sync({ isHomepage, open }) {
    cancel();

    if (!isHomepage || open || getAlreadyShown()) {
      return;
    }

    timerId = setTimeoutFn(() => {
      timerId = null;
      markShown();
      onShow();
    }, delayMs);
  }

  return { sync, cancel };
}
