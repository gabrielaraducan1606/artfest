// Reguli de afișare pentru evidența GPSR din Admin (pure, testabile).

export const GPSR_STATUS_TONE = Object.freeze({
  VALID: "ok",
  RECONFIRM: "warn",
  MISSING: "bad",
  UNRECORDED: "neutral",
  INCOMPLETE: "bad",
});

export const ADMIN_GPSR_FILTER_OPTIONS = Object.freeze([
  { value: "", label: "GPSR: toate" },
  { value: "incomplete", label: "GPSR incomplet" },
  { value: "missing", label: "Confirmare lipsă / neînregistrată" },
  { value: "reconfirm", label: "Reconfirmare necesară" },
  { value: "confirmed", label: "Confirmare înregistrată" },
  { value: "help", label: "Solicitare ajutor" },
]);

const SOURCE_LABELS = { smart_listing: "Smart Listing", product_modal: "Editor produs", catalog: "Catalog", other: "altă sursă" };

export function gpsrSourceLabel(source) {
  return SOURCE_LABELS[source] || "—";
}

export function formatGpsrDate(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("ro-RO", { dateStyle: "medium", timeStyle: "short" });
}
