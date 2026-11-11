// src/features/smartListing/smartListingPreview.js
//
// Previzualizarea Smart Listing, DOAR pentru Admin (nu are magazin), doar în
// `vite dev`. Vânzătorii folosesc formularul real, fără nimic din acest fișier.
// Formularul se poate parcurge, dar NU încarcă fișiere, NU apelează AI-ul,
// NU creează produse și NU trimite tichete.
//
// Două niveluri de protecție:
//   1. serviciile formularului sunt înlocuite cu variante locale, fără rețea;
//   2. cât timp pagina e deschisă, browserul refuză orice scriere către
//      server (inclusiv din componentele reutilizate: video, Editorul avansat).

import { useSyncExternalStore } from "react";

export const PREVIEW_STORE_SLUG = "previzualizare-locala";
export const PREVIEW_STORE_NAME = "Magazin demonstrativ";
export const PREVIEW_BLOCKED_MESSAGE = "Previzualizare: acțiunea este dezactivată, nimic nu se trimite către server.";

export class SmartListingPreviewBlocked extends Error {
  constructor(message = PREVIEW_BLOCKED_MESSAGE) {
    super(message);
    this.name = "SmartListingPreviewBlocked";
    this.code = "preview_blocked";
  }
}

/* ---------------- servicii locale ---------------- */

/** Răspunde local doar la lista de magazine; orice altceva e refuzat, fără rețea. */
export function createPreviewApi() {
  return async function previewApi(path) {
    if (String(path).startsWith("/api/vendors/me/services")) {
      return {
        items: [
          {
            type: { code: "products" },
            title: PREVIEW_STORE_NAME,
            profile: { slug: PREVIEW_STORE_SLUG, displayName: PREVIEW_STORE_NAME },
          },
        ],
      };
    }
    throw new SmartListingPreviewBlocked();
  };
}

/** Datele producătorului țin doar în memorie, ca la prima completare. */
export function createPreviewGpsr() {
  const empty = { name: "", address: "", email: "" };
  let state = { status: "ready", saved: empty, complete: false, draft: { ...empty }, saveError: "" };
  const listeners = new Set();
  const setState = (patch) => {
    state = { ...state, ...patch };
    listeners.forEach((listener) => listener());
  };
  const subscribe = (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };

  return {
    useState: () => useSyncExternalStore(subscribe, () => state, () => state),
    startEditing: () => setState({ draft: { ...state.saved }, saveError: "" }),
    updateDraft: (patch) => setState({ draft: { ...(state.draft || empty), ...patch }, saveError: "" }),
    cancelEditing: () => setState({ draft: { ...empty }, saveError: "" }),
    saveIfNeeded: async () => ({ saved: false }),
  };
}

export function createPreviewServices() {
  const blockedUpload = async () => {
    throw new SmartListingPreviewBlocked();
  };
  return {
    api: createPreviewApi(),
    uploadImage: blockedUpload,
    compressImage: async (file) => file,
    gpsr: createPreviewGpsr(),
    storage: null, // fără ciornă salvată
    onProductSaved: () => {},
  };
}

/* ---------------- blocarea scrierilor în browser ---------------- */

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function pathOf(url) {
  try {
    return new URL(String(url), "http://localhost").pathname;
  } catch {
    return String(url);
  }
}

/** Doar citiri + menținerea sesiunii; orice altă scriere e refuzată. */
export function isPreviewRequestAllowed(method, url) {
  if (READ_METHODS.has(String(method || "GET").toUpperCase())) return true;
  return pathOf(url).startsWith("/api/auth/");
}

/**
 * Instalează blocarea pe `fetch` și `XMLHttpRequest`.
 * @returns {() => void} scoate blocarea (la închiderea paginii)
 */
export function installPreviewNetworkGuard(target = globalThis) {
  const originalFetch = target.fetch;
  const Xhr = target.XMLHttpRequest;
  const originalOpen = Xhr?.prototype?.open;
  const originalSend = Xhr?.prototype?.send;

  if (originalFetch) {
    target.fetch = function guardedFetch(input, init) {
      const method = init?.method || input?.method || "GET";
      const url = input?.url || input;
      if (!isPreviewRequestAllowed(method, url)) {
        console.info(`[Smart Listing - previzualizare] blocat: ${method} ${pathOf(url)}`);
        return Promise.reject(new SmartListingPreviewBlocked());
      }
      return originalFetch.call(this ?? target, input, init);
    };
  }

  if (originalOpen && originalSend) {
    Xhr.prototype.open = function guardedOpen(method, url, ...rest) {
      this.__slPreviewAllowed = isPreviewRequestAllowed(method, url);
      return originalOpen.call(this, method, url, ...rest);
    };
    Xhr.prototype.send = function guardedSend(...args) {
      if (this.__slPreviewAllowed === false) throw new SmartListingPreviewBlocked();
      return originalSend.apply(this, args);
    };
  }

  return function removePreviewNetworkGuard() {
    if (originalFetch) target.fetch = originalFetch;
    if (originalOpen && originalSend) {
      Xhr.prototype.open = originalOpen;
      Xhr.prototype.send = originalSend;
    }
  };
}
