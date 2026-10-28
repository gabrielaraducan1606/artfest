// backend/src/services/productReviewRequest.js

/*
 * „Trimite la verificare Artfest” - vendorul cere VOLUNTAR ajutorul unui
 * om (nu e obligatoriu pentru publicare). Fără schemă nouă:
 *
 *   - Product.aiModeration.reviewRequest: solicitarea curentă
 *     { id, status OPEN|RESOLVED, note, requestedAt, ... }. aiModeration e
 *     expus doar adminului; vendorul proprietar primește doar rezumatul
 *     (summarizeReviewRequest), niciodată în listările publice;
 *   - Notification.meta (kind "product_review_requested"): notificarea
 *     adminilor, o singură dată per solicitare (dedupeKey cu id-ul ei).
 *
 * NU schimbă moderationStatus: PENDING / CHANGES_REQUESTED / APPROVED
 * rămân ale moderării. Moderarea AI nu o închide niciodată: o auto-aprobare
 * ulterioară doar o marchează (aiApprovedAt), solicitarea rămâne OPEN în
 * Admin până acționează un om (carryReviewRequestOverModeration). „Cere modificări” din Admin închide solicitarea și
 * continuă în workflow-ul existent (services/productChangeRequest.js).
 */

import crypto from "node:crypto";

export const REVIEW_REQUEST_NOTE_MAX = 1000;

export const REVIEW_REQUEST_STATUS = Object.freeze({
  OPEN: "OPEN",
  RESOLVED: "RESOLVED",
});

// cum s-a închis: aceleași acțiuni ca în Admin
export const REVIEW_REQUEST_RESOLUTIONS = Object.freeze(["APPROVED", "CHANGES_REQUESTED", "REJECTED"]);

function baseAiModeration(aiModeration) {
  return aiModeration && typeof aiModeration === "object" && !Array.isArray(aiModeration)
    ? aiModeration
    : {};
}

export function createReviewRequest({ note, vendorUserId, now = new Date() }) {
  return {
    id: crypto.randomUUID(),
    status: REVIEW_REQUEST_STATUS.OPEN,
    note: String(note || "").trim().slice(0, REVIEW_REQUEST_NOTE_MAX),
    requestedAt: now.toISOString(),
    requestedByUserId: vendorUserId || null,
    resolvedAt: null,
    resolvedByUserId: null,
    resolution: null,
  };
}

export function getReviewRequest(product) {
  const request = baseAiModeration(product?.aiModeration).reviewRequest;
  return request && typeof request === "object" && request.id ? request : null;
}

export function isReviewRequestOpen(product) {
  return getReviewRequest(product)?.status === REVIEW_REQUEST_STATUS.OPEN;
}

// filtrul Admin „Verificare solicitată de vendor” (căutare în Json, fără coloană)
export const OPEN_REVIEW_REQUEST_WHERE = Object.freeze({
  aiModeration: { path: ["reviewRequest", "status"], equals: REVIEW_REQUEST_STATUS.OPEN },
});

// rezumat pentru vendorul proprietar / Admin (fără id-urile utilizatorilor)
export function summarizeReviewRequest(product) {
  const request = getReviewRequest(product);
  if (!request) return null;

  return {
    id: request.id,
    open: request.status === REVIEW_REQUEST_STATUS.OPEN,
    note: request.note || "",
    requestedAt: request.requestedAt || null,
    resolvedAt: request.resolvedAt || null,
    resolution: request.resolution || null,
    // aprobat automat de AI după solicitare - verificarea umană e încă cerută
    aiApprovedAt: request.aiApprovedAt || null,
  };
}

/*
 * Solicitarea peste o analiză AI nouă: se păstrează neschimbată (status,
 * notă, date). Dacă AI-ul auto-aprobă cât timp e deschisă, se notează doar
 * momentul (aiApprovedAt) - Adminul vede că produsul e public, dar omul
 * nu l-a verificat încă.
 */
export function carryReviewRequestOverModeration(reviewRequest, { decision, now = new Date() } = {}) {
  if (!reviewRequest?.id) return undefined;
  if (reviewRequest.status === REVIEW_REQUEST_STATUS.OPEN && decision === "AUTO_APPROVE") {
    return { ...reviewRequest, aiApprovedAt: now.toISOString() };
  }
  return reviewRequest;
}

export function withReviewRequest(aiModeration, reviewRequest) {
  return { ...baseAiModeration(aiModeration), reviewRequest };
}

/*
 * Adminul a aprobat / a cerut modificări / a respins -> solicitarea se
 * închide (rămâne pe produs ca ultima solicitare). Primește aiModeration
 * deja calculat (ex. după resolveChangeRequestPatch), ca să compună cele
 * două închideri. Fără solicitare deschisă -> undefined (neatins).
 */
export function resolveReviewRequestPatch(aiModeration, { resolution, adminUserId = null, now = new Date() }) {
  const request = baseAiModeration(aiModeration).reviewRequest;
  if (!request?.id || request.status !== REVIEW_REQUEST_STATUS.OPEN) return undefined;

  return withReviewRequest(aiModeration, {
    ...request,
    status: REVIEW_REQUEST_STATUS.RESOLVED,
    resolvedAt: now.toISOString(),
    resolvedByUserId: adminUserId,
    resolution: REVIEW_REQUEST_RESOLUTIONS.includes(resolution) ? resolution : null,
  });
}

/*
 * De ce nu se poate trimite acum (null = se poate). O solicitare deja
 * deschisă NU e o eroare - ruta răspunde idempotent („Verificare solicitată”).
 */
export function reviewRequestBlocker({ awaitingVendorChanges = false } = {}) {
  if (awaitingVendorChanges) {
    return {
      error: "change_request_open",
      message:
        "Artfest ți-a cerut deja modificări pentru acest produs. Fă modificările și apasă „Am făcut modificările”.",
    };
  }
  return null;
}

export function reviewRequestNotificationKey(requestId, adminUserId) {
  return `product_review_requested:${requestId}:${adminUserId}`;
}
