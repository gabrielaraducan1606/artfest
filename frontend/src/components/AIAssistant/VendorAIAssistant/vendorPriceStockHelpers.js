// src/components/AIAssistant/VendorAIAssistant/vendorPriceStockHelpers.js
//
// Helper PUR pentru fluxul restrâns "Preț și stoc" al Asistentului
// vendor (audit 2026-09-23). Extras STRICT din VendorAssistant.jsx
// (.jsx, nu poate fi importat de Node fără transformare JSX) ca să
// poată fi testat direct cu `node --test`.
//
// AVAILABILITY_LABELS (audit corectare label-uri canonice, 2026-09-23):
// reexportat DOAR din sursa unică ../../../utils/optionLabels.js - nu
// mai există aici o a doua declarație (cerință explicită: o singură
// mapare de disponibilitate reutilizată peste tot în frontend).
// Etichetele corespund EXACT enum-ului deja validat de backend
// (vendorProductRoutes.js: READY/MADE_TO_ORDER/PREORDER/SOLD_OUT).
import { AVAILABILITY_LABELS } from "../../../utils/optionLabels.js";

export { AVAILABILITY_LABELS };

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
