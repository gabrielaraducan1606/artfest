// backend/src/services/productChangeRequest.js

/*
 * „Modificări solicitate” la produse (Admin -> Vendor -> Admin), DOAR pe
 * câmpurile existente - fără schemă nouă:
 *
 *   - Product.moderationStatus / moderationMessage: statusul și textul
 *     solicitării (motive + observații), ca înainte;
 *   - Product.aiModeration.changeRequest: solicitarea CURENTĂ (motive,
 *     observații, confirmarea vendorului, închiderea). aiModeration e
 *     expus doar adminului; vendorul proprietar primește doar rezumatul
 *     (summarizeChangeRequest), niciodată în listările publice;
 *   - Notification.meta (kind "product_moderation"): istoricul - o
 *     notificare per solicitare / aprobare / respingere.
 *
 * Stări (fără status nou în enum):
 *   CHANGES_REQUESTED - solicitare deschisă, vendorul are de lucru;
 *   REREVIEW          - vendorul a confirmat („De reverificat”), PENDING;
 *   restul            - statusul de moderare existent.
 */

import crypto from "node:crypto";

// aceleași coduri/etichete ca în frontend
// (features/productChanges/changeRequestReasons.js)
export const CHANGE_REQUEST_REASONS = Object.freeze({
  ADD_VARIANTS: "Adaugă variante",
  COMPLETE_DESCRIPTION: "Completează descrierea",
  FIX_CATEGORY: "Corectează categoria",
  COMPLETE_MATERIAL_DIMENSIONS: "Completează materialul / dimensiunile",
  CONFIGURE_PERSONALIZATION: "Configurează personalizarea",
  CHECK_ORDER_MODE: "Verifică modul de comandă",
  COMPLETE_MISSING_INFO: "Completează informațiile lipsă",
  OTHER: "Alt motiv",
});

export const CHANGE_REQUEST_NOTE_MAX = 2000;

export function normalizeReasons(input) {
  const list = Array.isArray(input) ? input : [];
  const codes = list
    .map((code) => String(code || "").trim().toUpperCase())
    .filter((code) => Object.prototype.hasOwnProperty.call(CHANGE_REQUEST_REASONS, code));

  return [...new Set(codes)];
}

export function reasonLabels(codes) {
  return normalizeReasons(codes).map((code) => CHANGE_REQUEST_REASONS[code]);
}

// textul salvat în moderationMessage (citit de ecranele existente)
export function buildChangeRequestMessage({ reasons, note }) {
  const lines = reasonLabels(reasons).map((label) => `• ${label}`);
  const cleanNote = String(note || "").trim();

  return [lines.join("\n"), cleanNote].filter(Boolean).join("\n\n");
}

export function createChangeRequest({ reasons, note, hideProduct, adminUserId, now = new Date() }) {
  return {
    id: crypto.randomUUID(),
    reasons: normalizeReasons(reasons),
    note: String(note || "").trim().slice(0, CHANGE_REQUEST_NOTE_MAX),
    hideProduct: hideProduct === true,
    requestedAt: now.toISOString(),
    requestedByUserId: adminUserId || null,
    confirmedAt: null,
    resolvedAt: null,
    resolution: null,
  };
}

export function getChangeRequest(product) {
  const changeRequest = product?.aiModeration?.changeRequest;

  return changeRequest && typeof changeRequest === "object" && changeRequest.id
    ? changeRequest
    : null;
}

function isOpen(changeRequest) {
  return Boolean(changeRequest && !changeRequest.resolvedAt);
}

/*
 * Solicitare deschisă, încă neconfirmată de vendor. Cât timp produsul e
 * CHANGES_REQUESTED în starea asta, editările vendorului NU îl retrimit
 * automat la verificare (vezi updateProduct) - retrimiterea e butonul
 * „Am făcut modificările”.
 */
export function isAwaitingVendorChanges(product) {
  const changeRequest = getChangeRequest(product);

  return isOpen(changeRequest) && !changeRequest.confirmedAt;
}

export function getChangeRequestStage(product) {
  const status = String(product?.moderationStatus || "PENDING").toUpperCase();
  const changeRequest = getChangeRequest(product);

  if (isOpen(changeRequest) && ["CHANGES_REQUESTED", "PENDING", "APPROVED"].includes(status)) {
    return changeRequest.confirmedAt ? "REREVIEW" : "CHANGES_REQUESTED";
  }

  return status;
}

// rezumat pentru vendorul proprietar / lista admin (fără id-ul adminului)
export function summarizeChangeRequest(product) {
  const changeRequest = getChangeRequest(product);
  if (!changeRequest) return null;

  return {
    id: changeRequest.id,
    stage: getChangeRequestStage(product),
    open: isOpen(changeRequest),
    reasons: normalizeReasons(changeRequest.reasons),
    reasonLabels: reasonLabels(changeRequest.reasons),
    note: changeRequest.note || "",
    hideProduct: changeRequest.hideProduct === true,
    requestedAt: changeRequest.requestedAt || null,
    confirmedAt: changeRequest.confirmedAt || null,
    resolvedAt: changeRequest.resolvedAt || null,
    resolution: changeRequest.resolution || null,
  };
}

function baseAiModeration(aiModeration) {
  return aiModeration && typeof aiModeration === "object" && !Array.isArray(aiModeration)
    ? aiModeration
    : {};
}

export function withChangeRequest(aiModeration, changeRequest) {
  return { ...baseAiModeration(aiModeration), changeRequest };
}

/*
 * Aprobare / respingere de admin -> solicitarea curentă se închide
 * (rămâne pe produs ca ultimă solicitare; istoricul e în notificări).
 * Fără solicitare deschisă, aiModeration rămâne neatins (undefined).
 */
export function resolveChangeRequestPatch(product, resolution, now = new Date()) {
  const changeRequest = getChangeRequest(product);
  if (!isOpen(changeRequest)) return undefined;

  return withChangeRequest(product.aiModeration, {
    ...changeRequest,
    resolvedAt: now.toISOString(),
    resolution,
  });
}

export function changeRequestNotificationKey(productId, requestId) {
  return `product_moderation:CHANGES_REQUESTED:${productId}:${requestId}`;
}

/*
 * Istoricul din notificările vendorului pentru produs (kind
 * "product_moderation"). Include și notificările mai vechi, de dinainte
 * de motive (au doar `message`). Confirmarea vendorului e scrisă pe
 * notificarea solicitării (meta.confirmedAt).
 */
export async function buildChangeRequestHistory(db, { vendorId, product }) {
  if (!vendorId || !product?.id) return [];

  const rows = await db.notification.findMany({
    where: {
      vendorId,
      meta: { path: ["productId"], equals: product.id },
    },
    orderBy: { createdAt: "asc" },
    take: 100,
    select: { createdAt: true, meta: true },
  });

  const events = [];
  const seenRequests = new Set();

  for (const row of rows) {
    const meta = row.meta || {};
    if (meta.kind !== "product_moderation") continue;

    const status = String(meta.status || "").toUpperCase();

    if (status === "CHANGES_REQUESTED") {
      if (meta.requestId) seenRequests.add(meta.requestId);

      events.push({
        type: "REQUESTED",
        at: row.createdAt,
        reasonLabels: reasonLabels(meta.reasons),
        note: meta.requestId ? meta.note || "" : meta.message || "",
      });

      if (meta.confirmedAt) {
        events.push({ type: "CONFIRMED", at: meta.confirmedAt });
      }
    } else if (status === "APPROVED") {
      events.push({ type: "APPROVED", at: row.createdAt });
    } else if (status === "REJECTED") {
      events.push({ type: "REJECTED", at: row.createdAt, note: meta.message || "" });
    }
  }

  // solicitarea curentă rămâne vizibilă chiar dacă notificarea ei a fost ștearsă
  const current = getChangeRequest(product);

  if (current && !seenRequests.has(current.id)) {
    events.push({
      type: "REQUESTED",
      at: current.requestedAt,
      reasonLabels: reasonLabels(current.reasons),
      note: current.note || "",
    });

    if (current.confirmedAt) {
      events.push({ type: "CONFIRMED", at: current.confirmedAt });
    }
  }

  return events.sort((a, b) => new Date(a.at) - new Date(b.at));
}

export function vendorChangeRequestPath(productId) {
  return `/vendor/products/${encodeURIComponent(productId)}/modificari`;
}
