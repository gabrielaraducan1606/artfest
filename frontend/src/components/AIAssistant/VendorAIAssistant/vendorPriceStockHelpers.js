// src/components/AIAssistant/VendorAIAssistant/vendorPriceStockHelpers.js
//
// Helper PUR pentru fluxul restrâns "Preț și stoc" al Asistentului
// vendor (audit 2026-09-23). Extras STRICT din VendorAssistant.jsx
// (.jsx, nu poate fi importat de Node fără transformare JSX) ca să
// poată fi testat direct cu `node --test`.
//
// Nu inventează un model nou de disponibilitate - etichetele de mai
// jos corespund EXACT enum-ului deja validat de backend
// (vendorProductRoutes.js: READY/MADE_TO_ORDER/PREORDER/SOLD_OUT).

export const AVAILABILITY_LABELS = {
  READY: "în stoc",
  MADE_TO_ORDER: "la comandă",
  PREORDER: "precomandă",
  SOLD_OUT: "stoc epuizat",
};

/**
 * Text scurt pentru "Disponibilitate actuală: ..." - folosește DOAR
 * ce vine deja din lista lean de produse (buildEditProductChoices,
 * VendorAssistant.jsx: availability + stock) - nicio interogare
 * suplimentară doar pentru acest text.
 */
export function describeAvailability(preview) {
  const availability = String(
    preview?.availability || ""
  ).toUpperCase();

  const label =
    AVAILABILITY_LABELS[availability] || "necunoscută";

  const stock =
    preview?.stock != null
      ? ` (stoc afișat: ${preview.stock})`
      : "";

  return `${label}${stock}`;
}
