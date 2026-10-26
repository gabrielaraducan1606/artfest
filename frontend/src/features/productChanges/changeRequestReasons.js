// src/features/productChanges/changeRequestReasons.js

/*
 * „Modificări solicitate” la produse - motivele rapide (aceleași coduri ca
 * în backend/src/services/productChangeRequest.js) și etichetele de stare
 * folosite în Admin și pe pagina vendorului.
 */

export const CHANGE_REQUEST_REASONS = [
  { code: "ADD_VARIANTS", label: "Adaugă variante" },
  { code: "COMPLETE_DESCRIPTION", label: "Completează descrierea" },
  { code: "FIX_CATEGORY", label: "Corectează categoria" },
  { code: "COMPLETE_MATERIAL_DIMENSIONS", label: "Completează materialul / dimensiunile" },
  { code: "CONFIGURE_PERSONALIZATION", label: "Configurează personalizarea" },
  { code: "CHECK_ORDER_MODE", label: "Verifică modul de comandă" },
  { code: "COMPLETE_MISSING_INFO", label: "Completează informațiile lipsă" },
  { code: "OTHER", label: "Alt motiv" },
];

export const CHANGE_REQUEST_NOTE_MAX = 2000;

// stage = changeRequest.stage din API (CHANGES_REQUESTED | REREVIEW) sau moderationStatus
export function getChangeStageMeta(stage) {
  switch (String(stage || "PENDING").toUpperCase()) {
    case "CHANGES_REQUESTED":
      return { label: "Necesită modificări", tone: "warning" };
    case "REREVIEW":
      return { label: "De reverificat", tone: "info" };
    case "APPROVED":
      return { label: "Aprobat", tone: "success" };
    case "REJECTED":
      return { label: "Respins", tone: "danger" };
    case "PENDING":
    default:
      return { label: "În verificare", tone: "info" };
  }
}

export function vendorChangesPath(productId) {
  return `/vendor/products/${encodeURIComponent(productId)}/modificari`;
}

/*
 * „Întreabă Asistentul Artfest” de pe pagina de modificări - task pentru
 * VendorAssistant (același canal ca CONTACT_INFO_FIX). Asistentul primește
 * produsul, motivele și observația și le pune în mesajul propus vendorului.
 */
export const PRODUCT_CHANGES_TASK = "PRODUCT_CHANGES_HELP";

export function buildProductChangesPrompt({ title, reasonLabels = [], note = "" }) {
  return [
    `Am primit modificări solicitate pentru produsul „${title || "produs"}”.`,
    reasonLabels.length ? `Ce trebuie modificat: ${reasonLabels.join(", ")}.` : "",
    note ? `Observația Artfest: „${note}”.` : "",
    "Cum fac aceste modificări?",
  ]
    .filter(Boolean)
    .join(" ");
}
