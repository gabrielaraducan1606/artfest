// src/components/AIAssistant/contactInfo/contactInfoFixFlow.js

/*
 * Fluxul „Corectează cu ajutorul asistentului” pentru date de contact
 * externe în textele publice ale vânzătorului. Modul PUR (testabil în
 * node): construiește task-ul trimis Asistentului, propunerea de
 * rescriere și cererea de salvare - fără rețea și fără DOM.
 *
 * Regulile de detecție + rescrierea sunt EXCLUSIV cele din validatorul
 * central backend/src/lib/contactInfoGuard.js (import relativ, ca
 * utils/optionLabels.js) - nicio a doua implementare.
 *
 * Două surse:
 * - FORM   = o salvare tocmai blocată dintr-un formular deschis: varianta
 *            aprobată se pune ÎNAPOI în formular (vendorul salvează din
 *            nou - alte modificări nesalvate din formular nu se pierd);
 * - STORED = conținut vechi (notificare / audit): varianta aprobată se
 *            salvează prin endpointul EXISTENT al entității.
 * În ambele cazuri, nimic nu se schimbă fără click-ul explicit al
 * vendorului pe „Aplică varianta propusă”.
 */

import {
  CONTACT_INFO_ERROR_CODE,
  hasContactInfo,
  suggestContactFreeRewrite,
} from "../../../../../backend/src/lib/contactInfoGuard.js";

export const CONTACT_FIX_TASK = "CONTACT_INFO_FIX";
export const VENDOR_ASSISTANT_TASK_EVENT = "artfest:vendor-assistant-task";
export const CONTACT_FIX_APPLY_EVENT = "artfest:contact-fix-apply";
export const CONTACT_FIX_CTA_LABEL = "Corectează cu ajutorul asistentului";

export const CONTACT_FIX_CHOICES = Object.freeze({
  APPLY: "Aplică varianta propusă",
  MANUAL: "Editez manual",
  SKIP: "Sari peste",
});

export function isContactInfoError(error) {
  return error?.data?.error === CONTACT_INFO_ERROR_CODE &&
    Array.isArray(error?.data?.issues) &&
    error.data.issues.length > 0;
}

function toItem(issue, source) {
  return {
    entityType: issue.entityType,
    entityId: issue.entityId ?? null,
    entityName: issue.entityName || null,
    field: issue.field,
    fieldLabel: issue.fieldLabel || issue.field,
    fragments: Array.isArray(issue.fragments) ? issue.fragments : [],
    message: issue.message || "",
    text: typeof issue.text === "string" ? issue.text : "",
    source,
  };
}

// task din eroarea 422 a unei salvări blocate (contextul vine de la
// server - entitate, câmp, fragment, motiv - nu e inventat în client)
export function buildTaskFromError(error) {
  if (!isContactInfoError(error)) return null;

  return {
    task: CONTACT_FIX_TASK,
    source: "FORM",
    items: error.data.issues.map((i) => toItem(i, "FORM")),
  };
}

// task din lista LIVE (GET /api/vendors/contact-info/issues)
export function buildTaskFromIssues(issues = []) {
  return {
    task: CONTACT_FIX_TASK,
    source: "STORED",
    items: (Array.isArray(issues) ? issues : []).map((i) => toItem(i, "STORED")),
  };
}

// link din notificare: asistentul își încarcă singur lista live
export function buildTaskFromDeepLink() {
  return { task: CONTACT_FIX_TASK, source: "STORED", fetchIssues: true, items: [] };
}

export function proposeFix(item) {
  const original = String(item?.text || "");
  const suggestion = suggestContactFreeRewrite(original);

  return {
    original,
    suggestion,
    clean: !hasContactInfo(suggestion),
  };
}

export function describeItem(item, proposal, position, total) {
  const where =
    item.entityType === "STORE"
      ? `${item.entityName || "Magazinul tău"} - ${item.fieldLabel}`
      : `„${item.entityName || "Produs"}” - ${item.fieldLabel}`;

  return [
    total > 1 ? `(${position}/${total}) ${where}` : where,
    "",
    `Am găsit: ${item.fragments.join(", ") || "date de contact externe"}.`,
    "Pe Artfest, clienții te contactează prin mesageria platformei, așa că textul public nu poate conține date de contact externe.",
    "",
    "Varianta propusă (fără date de contact, cu același mesaj comercial):",
    proposal.suggestion,
    "",
    item.source === "FORM"
      ? "Dacă o aplici, o pun în formular - apoi verifică și apasă Salvează."
      : "Nu salvez nimic până nu alegi „Aplică varianta propusă”.",
  ].join("\n");
}

/*
 * Cererea de aplicare - DOAR cu confirmarea explicită a vendorului și
 * DOAR pentru un text fără date de contact (reverificat cu același
 * validator central). null = nu se aplică nimic.
 */
export function buildApplyRequest(item, confirmedText, { confirmed = false } = {}) {
  const text = String(confirmedText ?? "").trim();

  if (!confirmed || !item || !text || hasContactInfo(text)) return null;

  if (item.source === "FORM") {
    return {
      kind: "APPLY_TO_FORM",
      event: CONTACT_FIX_APPLY_EVENT,
      detail: {
        entityType: item.entityType,
        entityId: item.entityId,
        field: item.field,
        text,
      },
    };
  }

  if (!item.entityId) return null;

  if (item.entityType === "PRODUCT") {
    return {
      kind: "HTTP",
      url: `/api/vendors/products/${encodeURIComponent(item.entityId)}`,
      method: "PUT",
      body: { [item.field]: text },
    };
  }

  if (item.entityType === "STORE") {
    return {
      kind: "HTTP",
      url: `/api/vendors/vendor-services/${encodeURIComponent(item.entityId)}/profile`,
      method: "PUT",
      body: { [item.field]: text },
    };
  }

  return null;
}

export function openVendorAssistantTask(task, target = typeof window !== "undefined" ? window : null) {
  if (!target || !task) return false;

  target.dispatchEvent(new CustomEvent(VENDOR_ASSISTANT_TASK_EVENT, { detail: task }));
  return true;
}
