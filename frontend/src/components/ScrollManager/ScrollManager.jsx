// src/components/ScrollManager/ScrollManager.jsx
//
// Înlocuiește vechiul ScrollToTop.jsx (care doar făcea `scrollTo(0,0)`
// necondiționat la fiecare schimbare de `pathname`, ignorând complet
// hash-ul și navigarea Back/Forward). Montat o singură dată, lângă
// rădăcina router-ului (App.jsx), la fel ca predecesorul.
//
// Responsabilități:
//   1. Navigare normală (PUSH) / redirect (REPLACE) -> mereu sus.
//   2. Back/Forward (POP) -> restaurează scrollY salvat pentru ruta
//      (pathname + query string) la care se revine.
//   3. Hash/deep-link explicit (#id) -> scrollIntoView pe elementul
//      respectiv, indiferent de tipul navigării.
//   4. Salvează CONTINUU poziția rutei curente în sessionStorage, cât
//      timp userul stă pe ea - reutilizat de (2) la revenire.
//
// Logica de DECIZIE (ce înseamnă "e chiar un back/forward", cheile de
// storage, așteptarea conținutului async) e extrasă în
// scrollRestorationLogic.js - modul pur, testat separat cu
// `node --test`. Fișierul ăsta e doar "sârma" către window/document.
//
// `history.scrollRestoration = "manual"` se setează în main.jsx (cât
// mai devreme posibil, înainte ca React să apuce să monteze ceva) -
// ASTA elimină cauza saltului la refresh (browserul nu mai încearcă
// din proprie inițiativă să restaureze o poziție veche, memorată
// pentru acea intrare din history) - vezi comentariul din main.jsx.

import { useEffect, useRef } from "react";
import { useLocation, useNavigationType } from "react-router-dom";

import {
  buildScrollKey,
  readScrollPosition,
  writeScrollPosition,
  resolveShouldRestore,
  waitUntilReady,
} from "./scrollRestorationLogic.js";

const RESTORE_TOLERANCE_PX = 2;

function getMaxScrollY() {
  const doc = document.documentElement;
  return Math.max(0, doc.scrollHeight - window.innerHeight);
}

function getNavigationTimingType() {
  try {
    if (typeof performance?.getEntriesByType === "function") {
      const entry = performance.getEntriesByType("navigation")[0];
      if (entry?.type) return entry.type;
    }
    // fallback legacy (Navigation Timing Level 1, deprecat dar mai
    // larg suportat) - doar dacă API-ul modern nu există
    if (performance?.navigation) {
      const TYPE_RELOAD = 1;
      const TYPE_BACK_FORWARD = 2;
      if (performance.navigation.type === TYPE_RELOAD) return "reload";
      if (performance.navigation.type === TYPE_BACK_FORWARD) return "back_forward";
      return "navigate";
    }
  } catch {
    // ignorăm - resolveShouldRestore are fallback pentru `null`
  }
  return null;
}

export default function ScrollManager() {
  const location = useLocation();
  const navigationType = useNavigationType(); // "POP" | "PUSH" | "REPLACE"

  const currentKeyRef = useRef(
    buildScrollKey(location.pathname, location.search)
  );
  const isFirstRunRef = useRef(true);

  /*
   * Salvează CONTINUU poziția de scroll a rutei curente, cât timp
   * userul stă pe ea - singura metodă robustă de a prinde poziția
   * "de dinainte de plecare", indiferent CUM pleacă (Back, click pe
   * link, navigate() programatic). Un singur listener, montat o
   * dată - citește mereu cheia curentă din ref (actualizată de
   * efectul de mai jos), nu o valoare "înghețată" la momentul montării.
   */
  useEffect(() => {
    let ticking = false;

    function onScroll() {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(() => {
        writeScrollPosition(
          window.sessionStorage,
          currentKeyRef.current,
          window.scrollY
        );
        ticking = false;
      });
    }

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const previousKey = currentKeyRef.current;
    const nextKey = buildScrollKey(location.pathname, location.search);

    /*
     * Plasă de siguranță: salvăm poziția rutei ANTERIOARE chiar acum,
     * înainte de a comuta cheia curentă - listener-ul de scroll de
     * mai sus acoperă aproape tot, dar dacă userul a navigat FĂRĂ
     * niciun eveniment de scroll intermediar, tot salvăm ultima
     * valoare cunoscută.
     */
    if (previousKey !== nextKey) {
      writeScrollPosition(window.sessionStorage, previousKey, window.scrollY);
    }
    currentKeyRef.current = nextKey;

    /*
     * Hash/deep-link explicit - prioritate, indiferent de tipul
     * navigării (ex. #cereri-clienti din CustomerRequestsSection.jsx).
     */
    if (location.hash) {
      const id = location.hash.replace(/^#/, "");

      if (id) {
        waitUntilReady({
          predicate: () => Boolean(document.getElementById(id)),
          onSettle: () => {
            document.getElementById(id)?.scrollIntoView({ block: "start" });
          },
          schedule: window.requestAnimationFrame.bind(window),
        });
        return undefined;
      }
    }

    const shouldRestore = resolveShouldRestore({
      navigationType,
      isFirstRun: isFirstRunRef.current,
      navigationTimingType: isFirstRunRef.current
        ? getNavigationTimingType()
        : null,
    });
    isFirstRunRef.current = false;

    if (shouldRestore) {
      const savedY = readScrollPosition(window.sessionStorage, nextKey) ?? 0;

      if (savedY <= 0) {
        window.scrollTo(0, 0);
        return undefined;
      }

      waitUntilReady({
        predicate: () => getMaxScrollY() >= savedY - RESTORE_TOLERANCE_PX,
        onSettle: () => {
          window.scrollTo(0, Math.min(savedY, getMaxScrollY()));
        },
        schedule: window.requestAnimationFrame.bind(window),
      });
      return undefined;
    }

    // navigare normală (PUSH) sau redirect (REPLACE) - mereu sus,
    // niciodată restaurare (punctele B și D)
    window.scrollTo(0, 0);
    return undefined;
  }, [location.pathname, location.search, location.hash, navigationType]);

  return null;
}
