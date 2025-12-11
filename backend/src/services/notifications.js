// backend/src/services/notifications.js
import { prisma } from "../db.js";

/**
 * Creează o notificare pentru un user (client).
 */
export async function createUserNotification(userId, data) {
  if (!userId) return null;

  return prisma.notification.create({
    data: {
      userId,
      vendorId: null,
      ...data, // type, title, body, link, etc.
    },
  });
}

/**
 * Creează o notificare pentru vendor (user-ul din dashboard).
 */
export async function createVendorNotification(vendorId, data) {
  const vendor = await prisma.vendor.findUnique({
    where: { id: vendorId },
    select: { id: true, userId: true },
  });

  if (!vendor) throw new Error("vendor_not_found");

  return prisma.notification.create({
    data: {
      userId: vendor.userId, // user-ul care folosește dashboard-ul vendor
      vendorId: vendor.id,
      ...data,
    },
  });
}

/* ============================================================
   🔔 HELPERI – NOTIFICĂRI CĂTRE USER PENTRU COMENZI
============================================================ */

/**
 * Notifică userul când vendorul schimbă statusul unui shipment/comenzi.
 * vendorUiStatus = "new" | "preparing" | "confirmed" | "fulfilled" | "cancelled"
 */
export async function notifyUserOnOrderStatusChange(orderId, vendorUiStatus) {
  const o = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      userId: true,
      total: true,
      currency: true,
    },
  });

  if (!o || !o.userId) return null;

  const totalNumber = Number(o.total || 0);
  const totalStr = `${totalNumber.toFixed(2)} ${o.currency || "RON"}`;

  let title;
  let body;

  switch (vendorUiStatus) {
    case "new":
      title = `Comanda ta #${o.id} a fost înregistrată`;
      body =
        `Comanda ta în valoare de ${totalStr} a ajuns la furnizor. ` +
        `Vei primi notificări pe parcursul procesării.`;
      break;
    case "preparing":
      title = `Comanda #${o.id} este în pregătire`;
      body = `Furnizorul pregătește produsele pentru expediere.`;
      break;
    case "confirmed":
      title = `Comanda #${o.id} este pregătită pentru livrare`;
      body =
        `Comanda ta în valoare de ${totalStr} e pregătită pentru curier sau ridicare. ` +
        `Verifică detaliile în pagina comenzii.`;
      break;
    case "fulfilled":
      title = `Comanda #${o.id} a fost livrată`;
      body =
        `Comanda ta a fost marcată ca livrată. Sperăm să te bucuri de produse! ` +
        `Ne poți lăsa și un review.`;
      break;
    case "cancelled":
      title = `Comanda #${o.id} a fost anulată de furnizor`;
      body =
        `Comanda ta în valoare de ${totalStr} a fost anulată de furnizor. ` +
        `Dacă ai întrebări, te rugăm să contactezi suportul.`;
      break;
    default:
      title = `Status actualizat pentru comanda #${o.id}`;
      body = `Statusul comenzii tale a fost actualizat de către furnizor.`;
  }

  return createUserNotification(o.userId, {
    type: "order",
    title,
    body,
    link: `/comanda/${o.id}`,
  });
}

/**
 * Notifică userul când vendorul emite / salvează o factură pentru comanda lui.
 */
export async function notifyUserOnInvoiceIssued(orderId, invoiceId) {
  const [order, invoice] = await Promise.all([
    prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, userId: true, total: true, currency: true },
    }),
    prisma.invoice.findUnique({
      where: { id: invoiceId },
      select: { id: true, number: true },
    }),
  ]);

  if (!order || !order.userId) return null;

  const totalNumber = Number(order.total || 0);
  const totalStr = `${totalNumber.toFixed(2)} ${order.currency || "RON"}`;

  const invNo = invoice?.number || "factură";

  return createUserNotification(order.userId, {
    type: "invoice",
    title: `Ai o factură nouă pentru comanda #${order.id}`,
    body: `Factura ${invNo} a fost emisă pentru comanda ta în valoare de ${totalStr}.`,
    link: `/comanda/${order.id}`,
  });
}

/**
 * Notifică userul când vendorul programează ridicarea coletului / generează AWB.
 */
export async function notifyUserOnShipmentPickupScheduled(orderId, shipmentId) {
  const [order, shipment] = await Promise.all([
    prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, userId: true },
    }),
    prisma.shipment.findUnique({
      where: { id: shipmentId },
      select: {
        awb: true,
        trackingUrl: true,
        courierProvider: true,
        courierService: true,
      },
    }),
  ]);

  if (!order || !order.userId) return null;

  const awb = shipment?.awb || null;
  const courier =
    shipment?.courierProvider || shipment?.courierService || "curier";
  const hasTracking = !!shipment?.trackingUrl;

  let body = `Comanda ta a fost predată către ${courier}.`;
  if (awb) body += ` AWB: ${awb}.`;
  if (hasTracking)
    body += ` Poți urmări livrarea în pagina comenzii sau în linkul de tracking.`;

  return createUserNotification(order.userId, {
    type: "shipping",
    title: `Coletul pentru comanda #${order.id} este în drum spre tine`,
    body,
    link: `/comanda/${order.id}`,
  });
}

/* ============================================================
   🔔 NOTIFICĂRI – TICHHETE DE SUPORT (USER FINAL)
============================================================ */

/**
 * Notifică userul când primește un răspuns nou la tichetul său.
 */
export async function notifyUserOnSupportReply(ticketId, options = {}) {
  const { messagePreview = "" } = options;

  const ticket = await prisma.supportTicket.findUnique({
    where: { id: ticketId },
    select: {
      id: true,
      subject: true,
      requesterId: true,
      audience: true,
    },
  });

  if (!ticket || !ticket.requesterId) return null;
  if (ticket.audience !== "USER") return null; // doar tichetele de user final

  const subject = ticket.subject || "tichet de suport";

  let body = `Ai primit un răspuns nou la tichetul tău "${subject}".`;
  if (messagePreview) {
    const trimmed = messagePreview.trim();
    if (trimmed) {
      const short =
        trimmed.length > 120
          ? trimmed.slice(0, 117).trimEnd() + "..."
          : trimmed;
      body += `\n\n„${short}”`;
    }
  }

  return createUserNotification(ticket.requesterId, {
    type: "support",
    title: `Răspuns nou la tichetul tău`,
    body,
    // 👇 ducem userul direct în pagina de suport, cu tichetul deschis
    link: `/account/support/tickets/${ticket.id}`,
  });
}

/**
 * Notifică userul când i se schimbă statusul tichetului.
 * newStatus = "OPEN" | "PENDING" | "CLOSED"
 */
export async function notifyUserOnSupportStatusChange(ticketId, newStatus) {
  const ticket = await prisma.supportTicket.findUnique({
    where: { id: ticketId },
    select: {
      id: true,
      subject: true,
      requesterId: true,
      audience: true,
    },
  });

  if (!ticket || !ticket.requesterId) return null;
  if (ticket.audience !== "USER") return null;

  const subject = ticket.subject || "tichet de suport";
  const statusUc = String(newStatus || "").toUpperCase();

  let title = `Status actualizat pentru tichetul tău`;
  let body = `Statusul tichetului "${subject}" a fost actualizat.`;

  if (statusUc === "OPEN") {
    title = `Tichetul tău a fost redeschis`;
    body = `Tichetul "${subject}" a fost redeschis de echipa de suport.`;
  } else if (statusUc === "PENDING") {
    title = `Tichetul tău este în curs de soluționare`;
    body = `Tichetul "${subject}" este în lucru la echipa de suport.`;
  } else if (statusUc === "CLOSED") {
    title = `Tichetul tău a fost închis`;
    body = `Tichetul "${subject}" a fost marcat ca rezolvat/închis. Dacă mai ai întrebări, poți deschide un tichet nou.`;
  }

  return createUserNotification(ticket.requesterId, {
    type: "support",
    title,
    body,
    link: `/account/support/tickets/${ticket.id}`,
  });
}

/**
 * Notifică userul când primește un mesaj nou în inbox (de la vendor).
 * Primește întregul thread (cu vendor.displayName) ca să nu mai facă alt query.
 */
export async function notifyUserOnInboxMessage(thread, messageBody) {
  if (!thread || !thread.userId) return null;

  const trimmed = String(messageBody || "").trim();
  const short =
    trimmed.length > 140 ? trimmed.slice(0, 137).trimEnd() + "..." : trimmed;

  return createUserNotification(thread.userId, {
    type: "message",
    title: `Mesaj nou de la ${thread.vendor?.displayName || "magazin"}`,
    body: short || "Ai primit un mesaj nou în conversația cu magazinul.",
    // 👉 adaptează ruta dacă la tine în frontend e altfel
    link: `/cont/mesaje?threadId=${thread.id}`,
  });
}
