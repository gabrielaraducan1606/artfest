// backend/src/jobs/returnVendorReminderJob.js

import { prisma as defaultPrisma } from "../db.js";
import * as notifications from "../services/notifications.js";
import * as mailer from "../lib/mailer.js";
import { returnReasonLabel, RETURN_REASONS } from "../services/returnRequestRules.js";

/*
 * Cereri de retur NEW la care vânzătorul nu a răspuns:
 *  - după 48h: reminder vânzătorului (notificare + email), o singură dată;
 *  - după 72h: notificare Admin „retur care necesită atenție”, o singură dată.
 *
 * IMPORTANT:
 * - DOAR citește ReturnRequest - nu schimbă statusul, NU acceptă și NU
 *   respinge nimic automat. Clientul vede în continuare „așteaptă
 *   răspunsul vânzătorului”.
 * - Deduplicare STRICT prin `dedupeKey` @unique din Notification (pre-check
 *   + P2002 în createVendorNotification / createUserNotification), ca
 *   quotePriceReminderJob.js - fără câmpuri noi.
 * - „NEW de la” = updatedAt (o cerere redeschisă din Admin pornește din nou
 *   de la momentul redeschiderii); dedupeKey e per cerere, deci remindere
 *   nu se repetă la infinit.
 */

export const VENDOR_REMINDER_HOURS = 48;
export const ADMIN_ESCALATION_HOURS = 72;

const HOUR = 60 * 60 * 1000;

const REASON_KIND_LABELS = {
  WITHDRAWAL: "Retragere fără motiv",
  CONFORMITY: "Neconformitate",
};

async function alreadyNotified(db, dedupeKey) {
  const existing = await db.notification.findUnique({ where: { dedupeKey }, select: { id: true } });
  return Boolean(existing);
}

async function remindVendor({ db, rr }) {
  const dedupeKey = `return_vendor_reminder:${rr.id}`;
  if (await alreadyNotified(db, dedupeKey)) return false;

  const orderLabel = rr.order?.orderNumber || rr.orderId;

  const result = await notifications.createVendorNotification(rr.vendorId, {
    dedupeKey,
    type: "order",
    title: `Cerere de retur fără răspuns - comanda #${orderLabel}`,
    body: "Clientul așteaptă răspunsul tău de peste 48 de ore. Deschide comanda pentru a accepta returul, a cere informații sau a-l respinge.",
    link: `/vendor/orders/${rr.orderId}`,
    meta: { kind: "return_vendor_reminder", returnRequestId: rr.id, orderId: rr.orderId },
  });

  // null = deja existentă (P2002) -> fără email duplicat
  if (!result) return false;

  const to = rr.vendor?.email || rr.vendor?.user?.email;

  if (to && typeof mailer.sendVendorReturnRequestedEmail === "function") {
    await mailer
      .sendVendorReturnRequestedEmail({
        to,
        vendorName: rr.vendor?.displayName,
        orderNumber: orderLabel,
        items: (rr.items || []).map((i) => ({ title: i.title, qty: i.qty })),
        reasonLabel: returnReasonLabel(rr.reasonCode),
        reasonKindLabel: REASON_KIND_LABELS[RETURN_REASONS[rr.reasonCode]?.kind] || "",
        link: `/vendor/orders/${rr.orderId}`,
        orderId: rr.orderId,
        reminder: true,
      })
      .catch((error) => console.error(`[returnVendorReminderJob] email failed for ${rr.id}:`, error?.message || error));
  }

  return true;
}

async function escalateToAdmins({ db, rr, admins }) {
  let created = 0;
  const orderLabel = rr.order?.orderNumber || rr.orderId;

  for (const admin of admins) {
    const dedupeKey = `return_admin_escalation:${rr.id}:${admin.id}`;
    if (await alreadyNotified(db, dedupeKey)) continue;

    const result = await notifications.createUserNotification(admin.id, {
      dedupeKey,
      type: "system",
      title: `Retur care necesită atenție - comanda #${orderLabel}`,
      body: `Vânzătorul ${rr.vendor?.displayName || ""} nu a răspuns de peste 72 de ore la o cerere de retur. Cererea NU a fost acceptată sau respinsă automat.`,
      link: "/admin?tab=returns",
      meta: { kind: "return_admin_escalation", returnRequestId: rr.id, orderId: rr.orderId, vendorId: rr.vendorId },
    });

    if (result) created += 1;
  }

  return created;
}

export async function runReturnVendorReminderJob({ db = defaultPrisma, now = new Date() } = {}) {
  const reminderBefore = new Date(now.getTime() - VENDOR_REMINDER_HOURS * HOUR);
  const escalationBefore = new Date(now.getTime() - ADMIN_ESCALATION_HOURS * HOUR);

  const pending = await db.returnRequest.findMany({
    where: { status: "NEW", updatedAt: { lte: reminderBefore } },
    orderBy: { updatedAt: "asc" },
    // plasă de siguranță; cele deja notificate sunt sărite prin dedupeKey
    take: 200,
    select: {
      id: true,
      orderId: true,
      vendorId: true,
      reasonCode: true,
      updatedAt: true,
      order: { select: { orderNumber: true } },
      vendor: { select: { displayName: true, email: true, user: { select: { email: true } } } },
      items: { select: { title: true, qty: true } },
    },
  });

  if (!pending.length) {
    console.log("[returnVendorReminderJob] 0 pending return requests");
    return { reminders: 0, escalations: 0 };
  }

  const needsEscalation = pending.filter((rr) => new Date(rr.updatedAt) <= escalationBefore);

  const admins = needsEscalation.length
    ? await db.user.findMany({ where: { role: "ADMIN", status: "ACTIVE" }, select: { id: true }, take: 50 })
    : [];

  let reminders = 0;
  let escalations = 0;

  for (const rr of pending) {
    try {
      if (await remindVendor({ db, rr })) reminders += 1;

      if (new Date(rr.updatedAt) <= escalationBefore) {
        escalations += await escalateToAdmins({ db, rr, admins });
      }
    } catch (error) {
      console.error(`[returnVendorReminderJob] failed for ${rr.id}:`, error?.message || error);
    }
  }

  console.log(
    `[returnVendorReminderJob] ${reminders} vendor reminders, ${escalations} admin escalations (${pending.length} pending checked)`
  );

  return { reminders, escalations };
}
