// src/pages/Admin/AdminMarketing/complianceGate.js
//
// Logică PURĂ (fără React) pentru secțiunea „Conformitate” din Admin →
// Influenceri: etichete / tonuri badge, acțiunile permise pe status și
// filtrele listei. Sursa stării: backend services/influencerComplianceGate.js
// (status calculat acolo - frontendul doar afișează).

export const COMPLIANCE_STATUS_META = Object.freeze({
  NOT_REQUIRED: { label: "Nu e necesar", tone: "neutral" },
  PENDING: { label: "În așteptare", tone: "warning" },
  COMPLETED: { label: "Completat", tone: "success" },
  REJECTED: { label: "Respins", tone: "danger" },
  CANCELLED: { label: "Anulat", tone: "danger" },
  EXPIRED: { label: "Expirat", tone: "danger" },
});

export const COMPLIANCE_TYPE_LABELS = Object.freeze({
  MINOR_PARENTAL_CONSENT: "Acord părinte / tutore (minor)",
});

export const COMPLIANCE_RELATIONSHIP_LABELS = Object.freeze({
  PARENT: "Părinte",
  LEGAL_GUARDIAN: "Tutore legal",
});

/** Dată + oră în ora României (indiferent de fusul orar al browserului). */
export function formatComplianceDateTime(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("ro-RO", {
    timeZone: "Europe/Bucharest",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

/**
 * Sumarul ultimului gate din drawer, ca listă [eticheta, valoare].
 * Acord parental: „Completat de” = părintele/tutorele din răspuns (nu
 * userul influencerului care a trimis formularul). Fără email/telefon -
 * acelea rămân doar în „Vezi răspunsul”.
 */
export function complianceSummaryFields(gate) {
  if (!gate) return [];
  const fmt = formatComplianceDateTime;
  const rows = [["Tip gate", COMPLIANCE_TYPE_LABELS[gate.type] || gate.type]];
  const response = gate.hasResponse
    ? [
        ["Completat la", fmt(gate.completedAt || gate.acceptedAt)],
        ["Completat de", gate.completedBy || "—"],
        ["Relație", COMPLIANCE_RELATIONSHIP_LABELS[gate.completedByRelationship] || "—"],
      ]
    : [];
  const version = ["Versiune document", gate.acceptedDocumentVersion || gate.requiredDocumentVersion || "—"];

  switch (gate.status) {
    case "PENDING":
      rows.push(["Trimis la", fmt(gate.sentAt)], ["Expiră la", fmt(gate.expiresAt)], version);
      break;
    case "COMPLETED":
      rows.push(...response, version);
      if (gate.guardianConfirmationSentAt) {
        rows.push(["Confirmare trimisă părintelui", fmt(gate.guardianConfirmationSentAt)]);
      }
      break;
    case "REJECTED":
      rows.push(...response, version, ["Respins la", fmt(gate.rejectedAt)]);
      if (gate.rejectionReason) rows.push(["Motivul respingerii", gate.rejectionReason]);
      break;
    case "CANCELLED":
      rows.push(["Trimis la", fmt(gate.sentAt)], ["Anulat la", fmt(gate.cancelledAt)], version);
      break;
    case "EXPIRED":
      rows.push(["Trimis la", fmt(gate.sentAt)], ["Expirat la", fmt(gate.expiresAt)], version);
      break;
    default:
      break;
  }
  return rows;
}

/** Istoricul gate-urilor: status + datele relevante; părintele doar dacă există răspuns. */
export function complianceHistoryRows(history = []) {
  const fmt = formatComplianceDateTime;
  return history.map((g) => {
    const details = [`Trimis: ${fmt(g.sentAt)}`];
    if (g.completedAt) details.push(`Completat: ${fmt(g.completedAt)}`);
    if (g.rejectedAt) details.push(`Respins: ${fmt(g.rejectedAt)}`);
    if (g.cancelledAt) details.push(`Anulat: ${fmt(g.cancelledAt)}`);
    if (g.hasResponse && g.completedBy) details.push(`De: ${g.completedBy}`);
    return { id: g.id, status: g.status, label: complianceStatusMeta(g.status).label, details };
  });
}

export function complianceStatusMeta(status) {
  return COMPLIANCE_STATUS_META[status] || COMPLIANCE_STATUS_META.NOT_REQUIRED;
}

export const COMPLIANCE_PAYOUTS_BLOCKED_MESSAGE = "Plăți blocate până la finalizarea conformității.";

/** Doar COMPLETED (sau niciun gate) deblochează plățile - oglindă a backendului. */
export function compliancePayoutsBlocked(status) {
  return ["PENDING", "REJECTED", "CANCELLED", "EXPIRED"].includes(status);
}

/**
 * Butoanele din drawer, în funcție de statusul ultimului gate.
 * CANCELLED / REJECTED / EXPIRED rămân blocate - deblocarea doar printr-un
 * gate nou completat („Retrimite” / „Trimite gate”).
 */
export function complianceActions({ status, hasResponse = false, enabled = true } = {}) {
  const view = hasResponse ? ["viewResponse"] : [];
  if (!enabled) return view;
  switch (status) {
    case "PENDING":
      return ["resend", "cancel"];
    case "COMPLETED":
      return ["viewResponse", "reject", "resend"];
    case "REJECTED":
    case "CANCELLED":
    case "EXPIRED":
      return ["resend", ...view];
    default:
      return ["send"];
  }
}

export const COMPLIANCE_FILTERS = Object.freeze([
  { value: "", label: "Toate" },
  { value: "required", label: "Conformitate necesară" },
  { value: "pending", label: "În așteptare" },
  { value: "completed", label: "Completată" },
]);

/** Filtrul listei: „necesară” = orice gate care nu e COMPLETED. */
export function matchesComplianceFilter(item, filter) {
  if (!filter) return true;
  const status = item?.compliance?.status || "NOT_REQUIRED";
  if (filter === "required") return status !== "NOT_REQUIRED" && status !== "COMPLETED";
  if (filter === "pending") return status === "PENDING";
  if (filter === "completed") return status === "COMPLETED";
  return true;
}
