// src/utils/gpsrConfirmationRule.js
//
// Când cere formularul (ProductModal) declarația GPSR - aceeași regulă ca pe
// server (backend/src/lib/gpsrDeclaration.js + vendorProductRoutes):
//   - produs NOU trimis spre publicare (vizibil)                        -> da
//   - produs existent: date producător / siguranță schimbate             -> da (reconfirmare)
//   - produs existent creat după activarea fluxului (gpsrDeclaration.required)
//     cu declarație lipsă / depășită (MISSING / RECONFIRM), salvat vizibil -> da
//   - produs creat înainte de activare (UNRECORDED), editări obișnuite     -> nu
//   - editări minore (preț, stoc, text, poze) cu declarație validă      -> nu
//   - salvare privată (inactiv / ascuns)                                -> nu
// `editingProduct.gpsrDeclaration` vine din GET /api/vendors/products/:id. Dacă lipsește
// (necunoscut), se păstrează regula de dinainte pentru un produs care devine vizibil.
// Serverul rămâne autoritatea (409 dacă lipsește); aici doar afișăm bifa la timp.

export const GPSR_RELEVANT_FIELDS = Object.freeze([
  "isOwnManufacturer",
  "manufacturerName",
  "manufacturerAddress",
  "manufacturerEmail",
  "manufacturerInEU",
  "responsiblePersonName",
  "responsiblePersonAddress",
  "responsiblePersonEmail",
  "safetyWarnings",
  "isForChildren",
]);

function norm(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "1" : "0";
  return String(value).trim().replace(/\s+/g, " ").toLowerCase();
}

function isVisible(p) {
  return p?.isActive !== false && !p?.isHidden;
}

/** Datele centrale ale producătorului sunt modificate acum (ciornă diferită de cele salvate)? */
export function centralGpsrChanged(state) {
  const draft = state?.draft;
  if (!draft) return false;
  const fields = ["name", "address", "email"];
  if (fields.every((f) => !norm(draft[f]))) return false;
  const saved = state?.saved || {};
  return fields.some((f) => norm(draft[f]) !== norm(saved[f]));
}

export function gpsrConfirmationRule({ form, editingProduct = null, vendorGpsrState = null }) {
  if (!isVisible(form)) return { required: false, reason: "" };
  if (!editingProduct) return { required: true, reason: "" };

  const changed = GPSR_RELEVANT_FIELDS.some((key) => norm(form?.[key]) !== norm(editingProduct?.[key]));
  const central = form?.isOwnManufacturer === true && centralGpsrChanged(vendorGpsrState);
  if (changed || central) {
    return {
      required: true,
      reason: "Ai modificat datele producătorului sau informațiile de siguranță: confirmă din nou înainte de salvare.",
    };
  }

  // starea declarației de pe server: cerută doar produselor create după activarea fluxului
  const declaration = editingProduct?.gpsrDeclaration;
  if (declaration && typeof declaration === "object") {
    if (declaration.required === true && declaration.status === "RECONFIRM") {
      return {
        required: true,
        reason: "Datele producătorului sau informarea GPSR s-au schimbat de la ultima confirmare: confirmă din nou înainte de salvare.",
      };
    }
    if (declaration.required === true && declaration.status === "MISSING") {
      return { required: true, reason: "Produsul nu are încă declarația GPSR: confirmă informațiile înainte de salvare." };
    }
    // produs vechi (UNRECORDED), declarație validă sau date incomplete: fără bifă nouă
    return { required: false, reason: "" };
  }

  // stare necunoscută: regula de dinainte (serverul decide oricum la salvare)
  if (!isVisible(editingProduct)) {
    return { required: true, reason: "Produsul devine vizibil public: confirmă informațiile GPSR." };
  }
  return { required: false, reason: "" };
}
