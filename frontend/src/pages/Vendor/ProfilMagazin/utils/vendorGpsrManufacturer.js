// src/pages/Vendor/ProfilMagazin/utils/vendorGpsrManufacturer.js

/*
 * GPSR „Eu sunt producătorul”: datele PUBLICE ale producătorului se
 * completează O SINGURĂ DATĂ, la nivel de vendor (Vendor.gpsrManufacturer*,
 * GET/PUT /api/vendors/me/gpsr-manufacturer), și se folosesc automat pentru
 * toate produsele la care vendorul este producătorul.
 *
 * Stare comună (un singur GET per sesiune) pentru toate editoarele de
 * produs: secțiunea GPSR o afișează/editează, verificarea de publicare o
 * citește, iar salvarea produsului (useProductEditorController) salvează
 * întâi ciorna, dacă există. Ciorna NU stă în formularul produsului, ca să
 * nu-l marcheze „modificat” și să nu ajungă în payload-ul produsului.
 */

import { useEffect, useSyncExternalStore } from "react";
import { api } from "../../../../lib/api";
import { validateGpsrManufacturerContact } from "../../../../../../backend/src/lib/gpsrCompliance.js";

const EMPTY_CONTACT = Object.freeze({ name: "", address: "", email: "" });

let state = {
  status: "idle", // idle | loading | ready | error
  saved: EMPTY_CONTACT,
  complete: false,
  // null = nu se editează; obiect = formular deschis (prima completare / „Modifică”)
  draft: null,
  saveError: "",
};

const listeners = new Set();

function setState(patch) {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
}

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function contactFromResponse(data) {
  const manufacturer = data?.manufacturer || {};
  return {
    name: manufacturer.name || "",
    address: manufacturer.address || "",
    email: manufacturer.email || "",
  };
}

let inflight = null;

export function loadVendorGpsrManufacturer({ force = false } = {}) {
  if (inflight) return inflight;
  if (!force && (state.status === "ready" || state.status === "loading")) {
    return Promise.resolve(state);
  }

  setState({ status: "loading" });

  inflight = api("/api/vendors/me/gpsr-manufacturer")
    .then((data) => {
      const saved = contactFromResponse(data);
      setState({
        status: "ready",
        saved,
        complete: !!data?.complete,
        // fără date complete -> formularul de primă completare (gol, fără precompletare)
        draft: data?.complete ? null : state.draft || { ...EMPTY_CONTACT },
      });
      return state;
    })
    .catch(() => {
      setState({ status: "error" });
      return state;
    })
    .finally(() => {
      inflight = null;
    });

  return inflight;
}

export function useVendorGpsrManufacturer({ enabled = true } = {}) {
  const snapshot = useSyncExternalStore(subscribe, () => state, () => state);

  useEffect(() => {
    if (enabled) loadVendorGpsrManufacturer();
  }, [enabled]);

  return snapshot;
}

/* ---------- editare ---------- */

export function startEditingVendorGpsr() {
  setState({ draft: { ...state.saved }, saveError: "" });
}

export function cancelEditingVendorGpsr() {
  // la prima completare nu există „anulare” - formularul rămâne gol
  setState({ draft: state.complete ? null : { ...EMPTY_CONTACT }, saveError: "" });
}

export function updateVendorGpsrDraft(patch) {
  setState({ draft: { ...(state.draft || EMPTY_CONTACT), ...patch }, saveError: "" });
}

function sameContact(a, b) {
  return (
    String(a?.name || "").trim() === String(b?.name || "").trim() &&
    String(a?.address || "").trim() === String(b?.address || "").trim() &&
    String(a?.email || "").trim() === String(b?.email || "").trim()
  );
}

/**
 * Datele cu care se verifică produsul înainte de publicare: ciorna (dacă
 * vendorul completează/modifică acum - va fi salvată odată cu produsul),
 * altfel datele salvate. `null` = încă necunoscut (se încarcă / eroare).
 * Forma = cheile Vendor din backend (gpsrCompliance.isGpsrComplete).
 */
export function vendorGpsrForCheck(snapshot = state) {
  if (snapshot.status !== "ready") return null;
  const contact = snapshot.draft || snapshot.saved;
  return {
    gpsrManufacturerName: contact.name,
    gpsrManufacturerAddress: contact.address,
    gpsrManufacturerEmail: contact.email,
  };
}

/**
 * Apelat la salvarea produsului cu „Eu sunt producătorul = Da”: salvează
 * întâi datele centrale, dacă vendorul le-a completat / modificat acum.
 * Aruncă o eroare cu mesaj clar dacă datele nu sunt valide sau salvarea
 * eșuează - atunci produsul NU se salvează.
 */
export async function saveVendorGpsrDraftIfNeeded() {
  const draft = state.draft;
  if (!draft) return { saved: false };
  if (state.complete && sameContact(draft, state.saved)) {
    setState({ draft: null });
    return { saved: false };
  }

  // formular necompletat deloc: nimic de salvat (un produs deja publicat se
  // poate salva cu avertizare; unul nou e oprit de verificarea de publicare)
  if (sameContact(draft, EMPTY_CONTACT)) return { saved: false };

  const check = validateGpsrManufacturerContact(draft);
  if (!check.ok) {
    setState({ saveError: check.message });
    throw new Error(`Datele producătorului: ${check.message}`);
  }

  try {
    const data = await api("/api/vendors/me/gpsr-manufacturer", {
      method: "PUT",
      body: check.value,
    });

    setState({
      status: "ready",
      saved: contactFromResponse(data),
      complete: !!data?.complete,
      draft: null,
      saveError: "",
    });

    return { saved: true, autoApprovedProductIds: data?.autoApprovedProductIds || [] };
  } catch (error) {
    const message =
      error?.data?.message || error?.message || "Nu am putut salva datele producătorului.";
    setState({ saveError: message });
    throw new Error(`Datele producătorului: ${message}`);
  }
}
