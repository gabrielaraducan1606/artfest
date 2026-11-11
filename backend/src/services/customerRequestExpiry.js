// backend/src/services/customerRequestExpiry.js
//
// Expirarea cererilor publice (CustomerRequest) - SURSA UNICĂ DE ADEVĂR.
//
// La creare: expiresAt = acum + 30 de zile (customerRequestsRoutes.js, neschimbat).
// Când expiresAt <= acum, o cerere încă OPEN devine persistent EXPIRED.
// ACCEPTED / CANCELLED (și orice alt status) NU se ating niciodată.
//
// Tranziția e LAZY (fără cron):
//   - lista publică rulează sweepExpiredCustomerRequests() - un singur
//     updateMany condiționat, cel mult o dată pe minut per proces;
//   - detaliul / trimiterea unei oferte expiră punctual cererea citită
//     (expireCustomerRequestIfDue), ca o cerere expirată să nu apară
//     niciodată ca OPEN, chiar între două treceri ale listei.
// updateMany are condiția status = OPEN + expiresAt <= acum, deci o cerere
// se schimbă o singură dată (fără update-uri repetate) și e sigur la apeluri
// concurente. Expirarea e DOAR schimbare de status: nicio notificare, niciun email.

import { prisma as defaultDb } from "../db.js";

export const CUSTOMER_REQUEST_SWEEP_INTERVAL_MS = 60_000;

/** Cererea e OPEN, dar termenul a trecut (deci trebuie să devină EXPIRED). */
export function isCustomerRequestDue(request, now = new Date()) {
  if (!request || request.status !== "OPEN" || !request.expiresAt) return false;
  return new Date(request.expiresAt).getTime() <= now.getTime();
}

/** Cererea nu mai primește oferte din cauza expirării (persistată sau încă nemarcată). */
export function isCustomerRequestExpired(request, now = new Date()) {
  return request?.status === "EXPIRED" || isCustomerRequestDue(request, now);
}

/** Filtrul Prisma pentru cererile active (lista publică): OPEN și neexpirate. */
export function activeCustomerRequestWhere(now = new Date()) {
  return {
    status: "OPEN",
    OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
  };
}

const dueWhere = (now) => ({ status: "OPEN", expiresAt: { lte: now } });

/**
 * Expiră punctual cererea citită, dacă e cazul.
 * @returns {Promise<Object>} cererea cu statusul corect (EXPIRED dacă a expirat)
 */
export async function expireCustomerRequestIfDue(request, { db = defaultDb, now = new Date() } = {}) {
  if (!isCustomerRequestDue(request, now)) return request;
  try {
    await db.customerRequest.updateMany({ where: { id: request.id, ...dueWhere(now) }, data: { status: "EXPIRED" } });
  } catch (error) {
    // scrierea poate eșua temporar; cererea e oricum tratată ca expirată în răspuns
    console.error("[customer-requests] expire failed:", request.id, error?.message || error);
  }
  return { ...request, status: "EXPIRED" };
}

/**
 * Trecere globală (lista publică), limitată la o dată pe `intervalMs`.
 * Nu aruncă: o eroare nu blochează lista (care filtrează oricum după expiresAt).
 */
export function createCustomerRequestExpirySweeper({ db = defaultDb, intervalMs = CUSTOMER_REQUEST_SWEEP_INTERVAL_MS, now = () => new Date() } = {}) {
  let lastRunAt = -Infinity;
  let inflight = null;

  return async function sweepExpiredCustomerRequests({ force = false } = {}) {
    const at = now();
    if (inflight) return inflight;
    if (!force && at.getTime() - lastRunAt < intervalMs) return { skipped: true, count: 0 };
    lastRunAt = at.getTime();
    inflight = (async () => {
      try {
        const { count } = await db.customerRequest.updateMany({ where: dueWhere(at), data: { status: "EXPIRED" } });
        return { skipped: false, count };
      } catch (error) {
        console.error("[customer-requests] expiry sweep failed:", error?.message || error);
        return { skipped: false, count: 0, failed: true };
      } finally {
        inflight = null;
      }
    })();
    return inflight;
  };
}

export const sweepExpiredCustomerRequests = createCustomerRequestExpirySweeper();
