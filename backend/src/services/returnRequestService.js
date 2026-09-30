// backend/src/services/returnRequestService.js

/*
 * Flux de RETUR gestionat de vânzător, STRICT peste structura existentă:
 * ReturnRequest / ReturnRequestItem, statusurile existente
 * (ReturnRequestStatus), threadurile de mesaje existente
 * (ensureUserVendorThread) și notificările existente.
 *
 * Fără schimbări Prisma (fără statusuri / coloane noi) și fără logică
 * financiară: refundul NU e făcut aici - cazurile care cer bani înapoi
 * sunt semnalate adminului, care folosește fluxurile existente.
 *
 * Regulile (statusuri, tranziții, produse personalizate) sunt în
 * ./returnRequestRules.js (modul pur).
 *
 * Motivul respingerii, informațiile cerute și instrucțiunile nu au coloane
 * dedicate: sunt mesaje automate în threadul comenzii, etichetate prin
 * Message.clientMessageId = "return:<id>:<ACȚIUNE>:<timestamp>", ca să poată
 * fi reafișate lângă cerere (ultimul răspuns al vânzătorului).
 */

import { prisma as defaultPrisma } from "../db.js";
// namespace (rezolvate la apel): rutele care importă acest serviciu pot fi
// testate cu mock-uri parțiale ale acestor module, fără erori la import
import * as orderMessaging from "./orderMessaging.js";
import * as notifications from "./notifications.js";
import * as mailer from "../lib/mailer.js";
import { createGuestReturnAccessToken } from "../lib/guestReturnAccessToken.js";

const ensureUserVendorThread = (args) => orderMessaging.ensureUserVendorThread(args);
const createUserNotification = (userId, data) => notifications.createUserNotification(userId, data);
import {
  RETURN_STATUS_INFO,
  RETURN_REASONS,
  allowedVendorActions,
  planVendorReturnAction,
  returnReasonLabel,
} from "./returnRequestRules.js";

export {
  RETURN_STATUS_INFO,
  VENDOR_RETURN_ACTIONS,
  NO_FAULT_REASONS,
  RETURN_REASONS,
  PERSONALIZATION,
  allowedVendorActions,
  planVendorReturnAction,
  classifyPersonalization,
  combinePersonalization,
  checkPersonalizedReturn,
  vendorNewReturnNotificationBody,
} from "./returnRequestRules.js";

export class ReturnFlowError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/* =========================================================
   Mesaje în threadul comenzii
========================================================= */

const returnTag = (returnRequestId, action) =>
  `return:${returnRequestId}:${action}:${Date.now()}`;

function shortId(id) {
  return String(id || "").slice(-6).toUpperCase();
}

function formatItems(items = []) {
  return items.map((i) => `• ${i.title} × ${i.qty}`).join("\n");
}

async function returnAddressText(db, rr) {
  const shipment = await db.shipment.findUnique({
    where: { id: rr.originalShipmentId },
    select: {
      service: { select: { profile: { select: { address: true, phone: true, displayName: true } } } },
      vendor: { select: { displayName: true, address: true, phone: true } },
    },
  });

  const profile = shipment?.service?.profile;
  const address = profile?.address || shipment?.vendor?.address || null;
  const phone = profile?.phone || shipment?.vendor?.phone || null;
  const name = profile?.displayName || shipment?.vendor?.displayName || null;

  if (!address) return null;

  // date pentru retur, trimise DOAR clientului, în conversația privată a comenzii
  return [
    "Adresa de retur:",
    [name, address].filter(Boolean).join(", "),
    phone ? `Telefon pentru curier: ${phone}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

export async function buildVendorActionMessage({ db, rr, action, text }) {
  const header = `Cererea de retur #${shortId(rr.id)}`;

  // Adresa de retur se comunică DOAR aici, după acceptare.
  if (action === "accept") {
    const address = await returnAddressText(db, rr);

    return [
      `${header}: returul a fost acceptat. Acum poți pregăti produsul pentru expediere folosind instrucțiunile de mai jos.`,
      "",
      "Produse:",
      formatItems(rr.items),
      "",
      text ? `Instrucțiunile vânzătorului:\n${text}` : "Ambalează produsul în siguranță (ideal în ambalajul original).",
      address ? `\n${address}` : "\nVânzătorul îți va comunica aici adresa de retur.",
      "",
      "Notează pe colet numărul comenzii și păstrează dovada expedierii. Pentru orice întrebare, răspunde direct în această conversație.",
    ].join("\n");
  }

  if (action === "request_info") {
    return `${header}: este nevoie de informații suplimentare.\n\n${
      text || "Îți vom scrie în această conversație ce detalii sunt necesare."
    }\n\nRăspunde în această conversație. Te rugăm să nu expediezi încă produsul.`;
  }

  if (action === "reject") {
    return `${header} a fost respinsă.${
      text ? `\n\nMotiv: ${text}` : ""
    }\n\nDacă nu ești de acord, răspunde în această conversație sau contactează echipa Artfest din secțiunea Suport.`;
  }

  if (action === "received") {
    return `${header}: vânzătorul a primit produsul înapoi.${text ? `\n\n${text}` : ""}\n\nRambursarea se procesează separat; vei fi informat când este efectuată.`;
  }

  // setate doar din Admin (colet prin curier / redeschidere)
  if (action === "pickup") {
    return `${header}: returul a fost acceptat, iar coletul de retur este preluat prin curier. Vei fi contactat pentru ridicare.${
      text ? `\n\n${text}` : ""
    }`;
  }

  if (action === "reopen") {
    return `${header} a fost redeschisă și așteaptă răspunsul vânzătorului. Te rugăm să nu expediezi încă produsul.${
      text ? `\n\n${text}` : ""
    }`;
  }

  return text ? `${header}\n\n${text}` : header;
}

/*
 * Comenzile guest nu au cont: folosim un thread existent de tip "vizitator"
 * (MessageThread.userId = null, legat de comandă, cu datele de contact ale
 * comenzii) - vânzătorul îl vede în inbox-ul lui, clientul îl vede și îi
 * răspunde din pagina guest securizată. Fără câmpuri noi.
 */
export async function ensureGuestReturnThread({ db = defaultPrisma, vendorId, orderId, order }) {
  const existing = await db.messageThread.findFirst({
    where: { vendorId, orderId, userId: null },
    select: { id: true },
  });

  if (existing) return existing;

  const address = order?.shippingAddress || {};

  return db.messageThread.create({
    data: {
      vendorId,
      orderId,
      userId: null,
      contactName: order?.customerName || address.name || null,
      contactEmail: order?.customerEmail || address.email || null,
      contactPhone: order?.customerPhone || address.phone || null,
      archived: false,
      archivedByUser: false,
    },
    select: { id: true },
  });
}

async function postThreadMessage({ db, rr, order, vendorName, body, tag }) {
  const thread = rr.userId
    ? await ensureUserVendorThread({
        userId: rr.userId,
        vendorId: rr.vendorId,
        orderId: rr.orderId,
        shippingAddress: order?.shippingAddress,
      })
    : await ensureGuestReturnThread({ db, vendorId: rr.vendorId, orderId: rr.orderId, order });

  const msg = await db.message.create({
    data: {
      threadId: thread.id,
      vendorId: rr.vendorId,
      body,
      authorType: "VENDOR",
      authorName: vendorName || "Vânzător",
      clientMessageId: tag,
    },
  });

  await db.messageThread.update({
    where: { id: thread.id },
    data: {
      lastMsg: msg.body,
      lastAt: msg.createdAt,
      vendorLastReadAt: new Date(),
      archivedByUser: false,
    },
  });

  return thread.id;
}

async function notifyAdminsRefundNeeded({ db, rr, order }) {
  const admins = await db.user.findMany({
    where: { role: "ADMIN", status: "ACTIVE" },
    select: { id: true },
    take: 50,
  });

  const isCard = order?.paymentMethod === "CARD";

  await Promise.all(
    admins.map((admin) =>
      createUserNotification(admin.id, {
        dedupeKey: `return_refund_needed:${rr.id}:${admin.id}`,
        type: "system",
        title: `Retur primit - rambursare de procesat (#${order?.orderNumber || rr.orderId})`,
        body: isCard
          ? "Vânzătorul a confirmat primirea produsului returnat. Comanda a fost plătită cu cardul: rambursarea se face din Admin (refund integral existent) sau manual, dacă returul este parțial."
          : "Vânzătorul a confirmat primirea produsului returnat. Comanda a fost plătită ramburs (COD): rambursarea se face de vânzător către client, în afara platformei.",
        link: "/admin?tab=orders",
        meta: {
          kind: "return_refund_needed",
          returnRequestId: rr.id,
          orderId: rr.orderId,
          paymentMethod: order?.paymentMethod || null,
        },
      }).catch(() => null)
    )
  );
}

/* =========================================================
   Citire (client + vânzător)
========================================================= */

const RETURN_SELECT = {
  id: true,
  orderId: true,
  originalShipmentId: true,
  vendorId: true,
  userId: true,
  status: true,
  reasonCode: true,
  reasonText: true,
  resolutionWanted: true,
  notesUser: true,
  photos: true,
  createdAt: true,
  updatedAt: true,
  items: { select: { id: true, shipmentItemId: true, productId: true, title: true, qty: true, price: true } },
};

async function lastVendorMessages(db, returnIds) {
  if (!returnIds.length) return new Map();

  const messages = await db.message.findMany({
    where: {
      OR: returnIds.map((id) => ({ clientMessageId: { startsWith: `return:${id}:` } })),
    },
    orderBy: { createdAt: "desc" },
    select: { body: true, createdAt: true, clientMessageId: true, threadId: true, authorType: true },
  });

  // id cerere -> { last: ultimul mesaj al vânzătorului, all: conversația de retur }
  const map = new Map();

  for (const m of messages) {
    const id = String(m.clientMessageId).split(":")[1];
    if (!map.has(id)) map.set(id, { last: null, all: [] });

    const entry = map.get(id);
    entry.all.push(m);
    if (!entry.last && (m.authorType || "VENDOR") === "VENDOR") entry.last = m;
  }

  return map;
}

/*
 * audience: "USER" (doar cererile clientului) sau "VENDOR" (doar ale
 * vânzătorului). Filtrarea de ownership e ÎN query, nu în client.
 */
export async function listReturnRequestsForOrder({
  orderId,
  userId = null,
  vendorId = null,
  audience,
  db = defaultPrisma,
}) {
  const where = { orderId };

  if (audience === "USER") where.userId = userId;
  if (audience === "VENDOR") where.vendorId = vendorId;
  // guest: doar cererile fără cont ale comenzii (accesul e verificat prin token)
  if (audience === "GUEST") where.userId = null;

  const rows = await db.returnRequest.findMany({
    where,
    orderBy: { createdAt: "desc" },
    select: RETURN_SELECT,
  });

  const lastMessages = await lastVendorMessages(db, rows.map((r) => r.id));

  return rows.map((rr) => {
    const conversation = lastMessages.get(rr.id) || { last: null, all: [] };
    const last = conversation.last;
    const info = RETURN_STATUS_INFO[rr.status] || { client: rr.status, vendor: rr.status };

    return {
      id: rr.id,
      shortId: shortId(rr.id),
      shipmentId: rr.originalShipmentId,
      status: rr.status,
      statusLabel: audience === "VENDOR" ? info.vendor : info.client,
      reasonCode: rr.reasonCode,
      reasonLabel: returnReasonLabel(rr.reasonCode),
      // WITHDRAWAL = retragere fără motiv; CONFORMITY = defect / neconformitate
      reasonKind: RETURN_REASONS[rr.reasonCode]?.kind || null,
      reasonText: rr.reasonText,
      resolutionWanted: rr.resolutionWanted,
      notesUser: rr.notesUser,
      photos: rr.photos || [],
      createdAt: rr.createdAt,
      updatedAt: rr.updatedAt,
      items: rr.items.map((i) => ({ ...i, price: Number(i.price) })),
      lastVendorMessage: last ? { body: last.body, createdAt: last.createdAt } : null,
      threadId: conversation.all[0]?.threadId || null,
      guest: !rr.userId,
      ...(audience === "VENDOR" ? { allowedActions: allowedVendorActions(rr.status) } : {}),
      // guest-ul nu are inbox: îi arătăm conversația de retur în pagina securizată
      ...(audience === "GUEST"
        ? {
            messages: [...conversation.all].reverse().map((m) => ({
              body: m.body,
              createdAt: m.createdAt,
              from: m.authorType === "VENDOR" ? "VENDOR" : "CLIENT",
            })),
          }
        : {}),
    };
  });
}

/* =========================================================
   Acțiune vânzător
========================================================= */

export async function applyVendorReturnAction({
  returnRequestId,
  orderId,
  vendorId,
  action,
  message,
  db = defaultPrisma,
}) {
  const rr = await db.returnRequest.findUnique({
    where: { id: returnRequestId },
    select: RETURN_SELECT,
  });

  // ownership: cererea trebuie să fie a ACESTUI vânzător și a ACESTEI comenzi
  if (!rr || rr.vendorId !== vendorId || rr.orderId !== orderId) {
    throw new ReturnFlowError(404, "return_not_found", "Cererea de retur nu a fost găsită.");
  }

  const plan = planVendorReturnAction({ status: rr.status, action, message });

  if (!plan.ok) {
    throw new ReturnFlowError(plan.code === "invalid_transition" ? 409 : 400, plan.code, plan.message);
  }

  // concurență: actualizăm doar dacă statusul nu s-a schimbat între timp
  const updated = await db.returnRequest.updateMany({
    where: { id: rr.id, status: rr.status },
    data: { status: plan.nextStatus },
  });

  if (!updated.count) {
    throw new ReturnFlowError(409, "status_changed", "Cererea a fost actualizată între timp. Reîncarcă pagina.");
  }

  const [order, vendor] = await Promise.all([
    db.order.findUnique({
      where: { id: rr.orderId },
      select: {
        id: true,
        orderNumber: true,
        paymentMethod: true,
        shippingAddress: true,
        customerName: true,
        customerEmail: true,
        customerPhone: true,
      },
    }),
    db.vendor.findUnique({ where: { id: vendorId }, select: { displayName: true } }),
  ]);

  const threadId = await communicateReturnStatus({
    db,
    rr,
    order,
    status: plan.nextStatus,
    action,
    text: plan.text,
    authorName: vendor?.displayName,
  });

  return { id: rr.id, status: plan.nextStatus, threadId };
}

/*
 * Comunicarea unei schimbări de status către client - UN SINGUR loc, folosit
 * și de vânzător (applyVendorReturnAction), și de Admin (notifyAdminReturnStatusChange):
 * mesaj în conversația comenzii (adresa de retur doar la acceptare),
 * notificare în cont și email (inclusiv guest, cu link securizat).
 * Best-effort: statusul e deja salvat.
 */
const STATUS_ACTION = {
  APPROVED: "accept",
  IN_REVIEW: "request_info",
  REJECTED: "reject",
  CLOSED: "received",
  PICKUP_REQUESTED: "pickup",
  NEW: "reopen",
};

export async function communicateReturnStatus({
  db = defaultPrisma,
  rr,
  order,
  status,
  action = STATUS_ACTION[status],
  text = "",
  authorName,
  notifyAdminsOnReceived = true,
}) {
  let threadId = null;
  let body = "";

  try {
    body = await buildVendorActionMessage({ db, rr, action, text });
    threadId = await postThreadMessage({
      db,
      rr,
      order,
      vendorName: authorName,
      body,
      tag: returnTag(rr.id, String(action || status).toUpperCase()),
    });
  } catch (error) {
    console.error("[returns] thread message failed:", error?.message || error);
  }

  if (rr.userId) {
    await createUserNotification(rr.userId, {
      dedupeKey: `return_status:${rr.id}:${status}:${Date.now()}`,
      type: "order",
      title: `Retur #${shortId(rr.id)}: ${RETURN_STATUS_INFO[status].client}`,
      body: text || RETURN_STATUS_INFO[status].client,
      link: `/comanda/${rr.orderId}`,
      meta: { kind: "return_status", returnRequestId: rr.id, status },
    }).catch(() => null);
  }

  await sendClientStatusEmail({ db, rr, order, status, body }).catch((error) =>
    console.error("[returns] client status email failed:", error?.message || error)
  );

  if (action === "received" && notifyAdminsOnReceived) {
    await notifyAdminsRefundNeeded({ db, rr, order }).catch(() => null);
  }

  return threadId;
}

const ORDER_CONTACT_SELECT = {
  id: true,
  orderNumber: true,
  paymentMethod: true,
  shippingAddress: true,
  customerName: true,
  customerEmail: true,
  customerPhone: true,
};

/*
 * Admin: schimbare de status prin endpointurile existente
 * (PATCH /api/admin/returns/:id/status, POST .../create-shipment) - păstrează
 * comportamentul existent (orice status valid), dar clientul este anunțat cu
 * ACELEAȘI texte și mecanisme ca la acțiunile vânzătorului. Scrierea
 * statusului rămâne în ruta admin; aici doar comunicăm schimbarea.
 */
export async function notifyAdminReturnStatusChange({ db = defaultPrisma, returnRequestId, previousStatus, status, message }) {
  if (!status || status === previousStatus) return null;

  const rr = await db.returnRequest.findUnique({ where: { id: returnRequestId }, select: RETURN_SELECT });
  if (!rr) return null;

  const order = await db.order.findUnique({ where: { id: rr.orderId }, select: ORDER_CONTACT_SELECT });

  return communicateReturnStatus({
    db,
    rr: { ...rr, status },
    order,
    status,
    text: String(message || "").trim(),
    authorName: "Echipa Artfest",
    // Adminul a închis el cererea - nu își trimite singur notificarea de rambursare
    notifyAdminsOnReceived: false,
  });
}

function appUrl() {
  return (process.env.APP_URL || process.env.FRONTEND_URL || "").replace(/\/+$/, "");
}

/*
 * Linkul prin care clientul își urmărește returul:
 *  - cont: pagina comenzii;
 *  - guest: pagina securizată /retur-guest cu token semnat (fără DB).
 */
export function clientReturnTrackingLink({ rr }) {
  if (rr.userId) return `${appUrl()}/comanda/${rr.orderId}`;

  try {
    const token = createGuestReturnAccessToken({ orderId: rr.orderId });
    return `${appUrl()}/retur-guest/${encodeURIComponent(rr.orderId)}?returnToken=${encodeURIComponent(token)}`;
  } catch {
    return null;
  }
}

async function sendClientStatusEmail({ db, rr, order, status, body }) {
  if (typeof mailer.sendReturnStatusEmail !== "function") return;

  const user = rr.userId
    ? await db.user.findUnique({ where: { id: rr.userId }, select: { email: true, firstName: true } })
    : null;

  const to = user?.email || order?.customerEmail || order?.shippingAddress?.email || null;
  if (!to) return;

  await mailer.sendReturnStatusEmail({
    to,
    clientName: user?.firstName || order?.customerName || order?.shippingAddress?.name || "",
    orderNumber: order?.orderNumber || rr.orderId,
    status,
    // același text ca mesajul din conversație (adresa apare doar la APPROVED)
    messageBody: body,
    link: clientReturnTrackingLink({ rr }),
    orderId: rr.orderId,
    userId: rr.userId || null,
  });
}

/* =========================================================
   Guest: răspuns la mesajele vânzătorului
========================================================= */

export async function postGuestReturnReply({ db = defaultPrisma, returnRequestId, orderId, message }) {
  const text = String(message || "").trim().slice(0, 4000);

  if (!text) throw new ReturnFlowError(400, "message_required", "Scrie un mesaj.");

  const rr = await db.returnRequest.findUnique({
    where: { id: returnRequestId },
    select: { id: true, orderId: true, vendorId: true, userId: true },
  });

  // doar cererile guest ale ACESTEI comenzi
  if (!rr || rr.orderId !== orderId || rr.userId) {
    throw new ReturnFlowError(404, "return_not_found", "Cererea de retur nu a fost găsită.");
  }

  const order = await db.order.findUnique({
    where: { id: orderId },
    select: { id: true, orderNumber: true, shippingAddress: true, customerName: true, customerEmail: true, customerPhone: true },
  });

  const thread = await ensureGuestReturnThread({ db, vendorId: rr.vendorId, orderId, order });

  const msg = await db.message.create({
    data: {
      threadId: thread.id,
      vendorId: rr.vendorId,
      body: text,
      authorType: "VISITOR",
      authorName: order?.customerName || order?.shippingAddress?.name || "Client",
      clientMessageId: returnTag(rr.id, "GUEST_REPLY"),
    },
  });

  await db.messageThread.update({
    where: { id: thread.id },
    data: { lastMsg: msg.body, lastAt: msg.createdAt, visitorLastReadAt: new Date(), archived: false },
  });

  try {
    await notifications.createVendorNotification(rr.vendorId, {
      dedupeKey: `return_guest_reply:${msg.id}`,
      type: "message",
      title: `Răspuns de la client - retur #${shortId(rr.id)}`,
      body: text.slice(0, 200),
      link: `/vendor/orders/${orderId}`,
      meta: { kind: "return_guest_reply", returnRequestId: rr.id, orderId, threadId: thread.id },
    });
  } catch (error) {
    console.error("[returns] guest reply notification failed:", error?.message || error);
  }

  return { ok: true, threadId: thread.id };
}
