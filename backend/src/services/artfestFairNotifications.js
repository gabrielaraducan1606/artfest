// backend/src/services/artfestFairNotifications.js
//
// Notificări în aplicație pentru înscrierile la Târgul Artfest, prin serviciul
// comun (services/notifications.js): DOAR in-app, fără email.
//
//   - cerere nouă (SUBMITTED)  -> fiecare ADMIN activ; link direct la înscriere;
//   - participare aprobată     -> vendorul înscrierii; link la pagina târgului.
//
// Se apelează DUPĂ commit-ul tranzacției (nu există notificare pentru o
// operație eșuată). dedupeKey @unique => retry / dublu click / reîncărcare nu
// creează duplicate. O eroare la notificare nu anulează înscrierea / aprobarea.

import { prisma } from "../db.js";
import { ARTFEST_FAIR_VENDOR_PATH } from "../config/artfestFair.js";
import { createUserNotification, createVendorNotification } from "./notifications.js";

export const ADMIN_REGISTRATION_LINK = (registrationId) =>
  `/admin?tab=artfestFair&registration=${encodeURIComponent(registrationId)}`;

async function storeNameFor(db, vendorId) {
  const [vendor, service] = await Promise.all([
    db.vendor.findUnique({ where: { id: vendorId }, select: { displayName: true } }),
    db.vendorService.findFirst({
      where: { vendorId },
      select: { title: true, profile: { select: { displayName: true } } },
    }),
  ]);
  return service?.profile?.displayName || vendor?.displayName || service?.title || "Un vânzător";
}

/*
 * Cerere nouă de participare. Cheia include momentul trimiterii: o
 * reînscriere după retragere e o cerere nouă (notificare nouă), iar aceeași
 * cerere nu poate genera două notificări.
 */
export async function notifyAdminsRegistrationSubmitted({ registration, db = prisma }) {
  try {
    const [admins, storeName] = await Promise.all([
      db.user.findMany({ where: { role: "ADMIN", status: "ACTIVE" }, select: { id: true }, take: 50 }),
      storeNameFor(db, registration.vendorId),
    ]);
    const submittedAt = new Date(registration.submittedAt).toISOString();
    await Promise.all(
      admins.map((admin) =>
        createUserNotification(admin.id, {
          dedupeKey: `artfest_fair_registration_submitted:${registration.id}:${submittedAt}:${admin.id}`,
          type: "system",
          title: "Cerere nouă pentru Târgul Artfest",
          body: `${storeName} a trimis o cerere de participare la Târgul Artfest.`,
          link: ADMIN_REGISTRATION_LINK(registration.id),
          meta: { kind: "artfest_fair_registration_submitted", registrationId: registration.id, vendorId: registration.vendorId },
        }).catch((error) => {
          console.error("[artfestFair] notificare admin:", error?.message || error);
          return null;
        })
      )
    );
  } catch (error) {
    console.error("[artfestFair] notificări cerere nouă:", error?.message || error);
  }
}

/*
 * Participare aprobată. Cheia include evenimentul de aprobare: o reaprobare
 * (după respingere) e o decizie nouă, iar aceeași aprobare nu dublează.
 */
export async function notifyVendorRegistrationApproved({ registration, approvalEventId }) {
  try {
    await createVendorNotification(registration.vendorId, {
      dedupeKey: `artfest_fair_registration_approved:${registration.id}:${approvalEventId}`,
      type: "system",
      title: "Participarea ta la Târgul Artfest a fost aprobată.",
      body: "Cererea ta de participare a fost acceptată. Poți începe pregătirea inventarului pentru târg.",
      link: ARTFEST_FAIR_VENDOR_PATH,
      meta: { kind: "artfest_fair_registration_approved", registrationId: registration.id },
    });
  } catch (error) {
    console.error("[artfestFair] notificare aprobare:", error?.message || error);
  }
}

/* ===================== Sumarul zilnic al vânzărilor (vendor) ===================== */

// „1 produs”, „7 produse”, „20 de produse”
export function productsCountText(n) {
  if (n === 1) return "1 produs";
  const rest = n % 100;
  return n === 0 || (rest >= 1 && rest <= 19) ? `${n} produse` : `${n} de produse`;
}

function lei(cents) {
  return `${(cents / 100).toFixed(2).replace(".", ",")} lei`;
}

function dayTitle(date) {
  const [y, m, d] = date.split("-").map(Number);
  const label = new Intl.DateTimeFormat("ro-RO", { day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d)));
  return `Vânzări la Târgul Artfest · ${label}`;
}

export const dailySalesDedupeKey = (fairId, vendorId, localDate) => `artfest_fair_daily_sales:${fairId}:${vendorId}:${localDate}`;

export const dailySalesLink = (localDate) => `${ARTFEST_FAIR_VENDOR_PATH}?date=${localDate}#vanzari`;

/*
 * Maximum O notificare pe vendor / zi locală (Europe/Bucharest) / târg.
 * După fiecare vânzare: pentru fiecare vendor din vânzare se recalculează
 * sumarul zilei vânzării din liniile vânzărilor (valorile de la vânzare;
 * retururile / anulările ulterioare NU rescriu retroactiv sumarul - apar în
 * raportul zilei returului) și se creează sau se actualizează notificarea
 * cu cheia fair + vendor + zi. Doar in-app, fără email.
 *
 * Recalcularea + scrierea rulează sub un lock pe cheie, deci două vânzări
 * simultane nu pot lăsa în urmă un sumar vechi. O eroare aici nu anulează
 * vânzarea (se apelează după commit).
 */
export async function notifyVendorsDailySales({ saleId, db = prisma }) {
  try {
    const { localDayRange, todayLocal } = await import("./artfestFairReportsService.js");
    const sale = await db.artfestFairSale.findUnique({ where: { id: saleId }, select: { id: true, fairId: true, soldAt: true } });
    if (!sale) return [];
    const localDate = todayLocal(new Date(sale.soldAt));
    const range = localDayRange(localDate);
    const vendorIds = [...new Set((await db.artfestFairSaleLine.findMany({ where: { saleId: sale.id }, select: { vendorId: true } })).map((l) => l.vendorId))].sort();
    const out = [];
    for (const vendorId of vendorIds) {
      try {
        out.push(await upsertDailySummary({ db, fairId: sale.fairId, vendorId, localDate, range }));
      } catch (error) {
        console.error("[artfestFair] notificare zilnică vânzări:", error?.message || error);
      }
    }
    return out;
  } catch (error) {
    console.error("[artfestFair] notificări zilnice vânzări:", error?.message || error);
    return [];
  }
}

async function upsertDailySummary({ db, fairId, vendorId, localDate, range }) {
  const dedupeKey = dailySalesDedupeKey(fairId, vendorId, localDate);
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${dedupeKey}))`;
    const vendor = await tx.vendor.findUnique({ where: { id: vendorId }, select: { id: true, userId: true } });
    if (!vendor) return null;
    const sales = await tx.artfestFairSale.findMany({
      where: { fairId, soldAt: { gte: range.start, lt: range.end } },
      select: { id: true },
    });
    const lines = sales.length
      ? await tx.artfestFairSaleLine.findMany({
          where: { saleId: { in: sales.map((s) => s.id) }, vendorId },
          select: { saleId: true, quantity: true, lineGrossCents: true, vendorNetCents: true },
        })
      : [];
    const units = lines.reduce((s, l) => s + l.quantity, 0);
    const vendorNetCents = lines.reduce((s, l) => s + l.vendorNetCents, 0);
    const grossCents = lines.reduce((s, l) => s + l.lineGrossCents, 0);
    const salesCount = new Set(lines.map((l) => l.saleId)).size;
    if (!units) return null;

    const data = {
      type: "system",
      title: dayTitle(localDate),
      body: `Astăzi ai vândut ${productsCountText(units)} la Târgul Artfest. Net estimat: ${lei(vendorNetCents)}. Încasat pentru produsele tale: ${lei(grossCents)}.`,
      link: dailySalesLink(localDate),
      meta: { kind: "artfest_fair_daily_sales", fairId, vendorId, localDate, units, salesCount, vendorNetCents, grossCents },
    };
    const existing = await tx.notification.findUnique({ where: { dedupeKey } });
    if (existing) {
      // aceeași notificare, actualizată; redevine necitită și urcă în listă
      return tx.notification.update({ where: { dedupeKey }, data: { ...data, readAt: null, archived: false, createdAt: new Date() } });
    }
    return tx.notification.create({ data: { ...data, dedupeKey, userId: vendor.userId, vendorId: vendor.id } });
  }, { timeout: 30_000, maxWait: 10_000 });
}
