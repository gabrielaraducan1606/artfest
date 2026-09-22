// Logică PURĂ pentru tabelul unitar de documente juridice din Admin
// (fără React, testabilă cu `node --test`).
//
// Rulare teste: node --test src/pages/Admin/AdminDesktop/tabs/legal/legalDocumentsView.test.js

export const STATUS_LABELS = {
  NOT_PUBLISHED: "Nepublicat în DB",
  UP_TO_DATE: "La zi",
  DRAFT_AVAILABLE: "Draft disponibil",
  REACCEPTANCE_REQUESTED: "Reacceptare cerută",
  REACCEPTANCE_OVERDUE: "Reacceptare depășită",
  INFORMATIONAL: "Informativ",
};

export const STATUS_TONES = {
  NOT_PUBLISHED: "muted",
  UP_TO_DATE: "ok",
  DRAFT_AVAILABLE: "info",
  REACCEPTANCE_REQUESTED: "warn",
  REACCEPTANCE_OVERDUE: "danger",
  INFORMATIONAL: "muted",
};

export const AUDIENCE_LABELS = {
  USER: "Clienți",
  VENDOR: "Vânzători",
  INFLUENCER: "Influenceri",
};

export function statusLabel(status) {
  return STATUS_LABELS[status] || status || "—";
}

export function statusTone(status) {
  return STATUS_TONES[status] || "muted";
}

export function audienceLabel(audience) {
  return AUDIENCE_LABELS[audience] || audience || "—";
}

/** "v2 (2.0.0), v3 (3.0.0)" sau "—" */
export function formatDrafts(row) {
  const drafts = row?.draftVersions || [];

  if (!drafts.length) return "—";

  return drafts
    .map((d) => `v${d.manifestVersion}${d.policyVersion ? ` (${d.policyVersion})` : ""}`)
    .join(", ");
}

/** Fișiere v* existente pe disc, dar neînregistrate în manifest (nu se pot publica). */
export function formatUnregistered(row) {
  const files = row?.unregisteredFiles || [];

  return files.length ? files.map((n) => `v${n}`).join(", ") : "";
}

/** Versiunile din manifest care se pot publica (încărcabile), cu marcaj pentru cea activă. */
export function buildPublishOptions(row) {
  return (row?.manifestVersions || [])
    .filter((v) => v.loadable && v.policyVersion)
    .map((v) => ({
      value: String(v.policyVersion),
      manifestVersion: v.manifestVersion,
      label: `v${v.manifestVersion} (${v.policyVersion})${v.isPublished ? " — publicată acum" : ""}`,
      isPublished: Boolean(v.isPublished),
      title: v.title || "",
    }));
}

/** Versiunea preselectată la publicare: primul draft, altfel prima nepublicată. */
export function defaultPublishVersion(row) {
  const options = buildPublishOptions(row);
  const draft = (row?.draftVersions || []).find((d) => d.loadable !== false && d.policyVersion);

  if (draft) return String(draft.policyVersion);

  return options.find((o) => !o.isPublished)?.value || options[0]?.value || "";
}

export function canPublishRow(row) {
  return Boolean(row?.actions?.canPublish) && buildPublishOptions(row).length > 0;
}

export function canRequestRow(row) {
  return Boolean(row?.actions?.canRequestReacceptance);
}

/** Câți conturi ar primi acum cererea (nu au acceptat versiunea publicată). */
export function pendingOnPublished(row) {
  return Math.max(0, Number(row?.stats?.notOnPublished ?? 0));
}

export function defaultReacceptanceForm(row) {
  const label = row?.label || "documentul";
  const version = row?.published?.version || "";

  return {
    requiresAction: true,
    deadlineAt: "",
    title: "Actualizare documente legale",
    message: `Am actualizat ${label} (versiunea ${version}). Te rugăm să consulți și să accepți noua versiune.`,
    emailEnabled: true,
    emailSubject: `Actualizare: ${label}`,
    emailBody: `Am actualizat ${label} (versiunea ${version}).\n\nTe rugăm să accesezi contul Artfest pentru a consulta și a accepta noua versiune.`,
  };
}

export function validateReacceptanceForm(form) {
  const errors = [];

  if (!String(form.title || "").trim()) errors.push("Titlul notificării este obligatoriu.");
  if (!String(form.message || "").trim()) errors.push("Mesajul notificării este obligatoriu.");

  if (form.deadlineAt) {
    const date = new Date(form.deadlineAt);

    if (Number.isNaN(date.getTime())) errors.push("Termenul-limită este invalid.");
    else if (date.getTime() < Date.now() - 24 * 60 * 60 * 1000) {
      errors.push("Termenul-limită nu poate fi în trecut.");
    }
  }

  if (form.emailEnabled) {
    if (!String(form.emailSubject || "").trim()) errors.push("Subiectul emailului este obligatoriu.");
    if (!String(form.emailBody || "").trim()) errors.push("Textul emailului este obligatoriu.");
  }

  return errors;
}

/** Corpul cererii către POST /api/admin/legal/documents/request-reacceptance. */
export function buildReacceptancePayload(row, form) {
  return {
    catalogId: row.catalogId,
    audience: row.audience,
    version: String(row.published?.version || ""),
    requiresAction: form.requiresAction !== false,
    deadlineAt: form.deadlineAt ? new Date(form.deadlineAt).toISOString() : null,
    inApp: {
      title: String(form.title || "").trim(),
      message: String(form.message || "").trim(),
    },
    email: form.emailEnabled
      ? {
          enabled: true,
          subject: String(form.emailSubject || "").trim(),
          body: String(form.emailBody || ""),
        }
      : null,
  };
}

export function buildPublishPayload(row, version) {
  return { catalogId: row.catalogId, version: String(version || "") };
}

/** Rândurile tabelului, în ordinea afișării (documente contractuale întâi, cookies la final). */
export function sortCatalogRows(rows = []) {
  return [...rows].sort((a, b) => {
    if (a.informational !== b.informational) return a.informational ? 1 : -1;

    return 0; // păstrăm ordinea din registry (deja logică)
  });
}

/** Rezumat pentru banner-ul de sus. */
export function summarizeCatalog(rows = []) {
  const summary = { open: 0, overdue: 0, drafts: 0, notPublished: 0 };

  for (const row of rows) {
    if (row.status === "REACCEPTANCE_REQUESTED") summary.open += 1;
    if (row.status === "REACCEPTANCE_OVERDUE") {
      summary.open += 1;
      summary.overdue += 1;
    }
    if (row.status === "DRAFT_AVAILABLE") summary.drafts += 1;
    if (row.status === "NOT_PUBLISHED") summary.notPublished += 1;
  }

  return summary;
}

/** Textul de rezultat după cerere. */
export function describeRequestResult(result) {
  if (!result) return "";

  const parts = [
    `Cererea a fost creată pentru ${result.targetCount ?? 0} conturi`,
    `notificări in-app: ${result.createdCount ?? 0}`,
  ];

  if (result.emailRequested) {
    parts.push("emailul (tranzacțional) a fost pus la trimis");
  }

  return `${parts.join("; ")}.`;
}
