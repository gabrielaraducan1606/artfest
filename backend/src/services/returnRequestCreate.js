// backend/src/services/returnRequestCreate.js
//
// Crearea unei cereri de RETUR - logică comună pentru:
//   POST /api/user/returns                    (client cu cont)
//   POST /api/guest/orders/:id/returns?token= (comandă guest, fără cont)
//
// Aceleași reguli pentru ambele (fereastra de 14 zile, neconformitate,
// produse personalizate - OUG 34/2014 art. 9 și art. 16 lit. c),
// aceleași modele existente (ReturnRequest / ReturnRequestItem), fără
// schimbări Prisma și fără logică financiară.

import { z } from "zod";
import { prisma as defaultPrisma } from "../db.js";
// namespace: testele pot simula parțial aceste module
import * as notificationsService from "./notifications.js";
import * as mailer from "../lib/mailer.js";
import * as legalPublished from "./legalPublishedService.js";
import {
  RETURN_REASONS,
  RETURN_REASON_CODES,
  PERSONALIZATION,
  checkPersonalizedReturn,
  classifyPersonalization,
  isConformityReason,
  returnReasonLabel,
  vendorNewReturnNotificationBody,
} from "./returnRequestRules.js";

export const RETURN_WINDOW_DAYS = 14;

// Cererile respinse nu mai "consumă" cantitatea returnabilă.
const EXCLUDED_STATUSES_FOR_QTY = ["REJECTED"];

const REASON_KIND_LABELS = {
  WITHDRAWAL: "Retragere fără motiv",
  CONFORMITY: "Neconformitate",
};

export const ReturnPayload = z.object({
  orderId: z.string().trim().min(1),
  shipmentId: z.string().trim().min(1),
  // vendorId trimis de client e ignorat: îl derivăm din shipment.
  vendorId: z.string().trim().nullish(),
  items: z
    .array(
      z.object({
        orderItemId: z.string().trim().min(1),
        qty: z.coerce.number().int().min(1),
      })
    )
    .min(1)
    .max(100),
  reasonCode: z.enum(RETURN_REASON_CODES),
  reasonText: z.string().trim().max(2000).nullish(),
  faultParty: z.enum(["VENDOR", "CUSTOMER", "UNKNOWN"]).nullish(),
  resolutionWanted: z.enum(["REFUND", "EXCHANGE", "VOUCHER"]).nullish(),
  notesUser: z.string().trim().max(2000).nullish(),
  photos: z.array(z.string().trim().url().max(2000)).max(6).default([]),
  policyAck: z
    .object({
      accepted: z.literal(true),
    })
    .passthrough(),
});

export class ReturnCreateError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

// select-ul comenzii, identic pentru client și guest
export function returnOrderSelect(shipmentId) {
  return {
    id: true,
    orderNumber: true,
    userId: true,
    customerName: true,
    customerEmail: true,
    shippingAddress: true,
    // comandă rezultată dintr-o ofertă personalizată
    quoteRequest: { select: { id: true } },
    shipments: {
      where: { id: shipmentId },
      select: {
        id: true,
        vendorId: true,
        status: true,
        direction: true,
        deliveredAt: true,
        updatedAt: true,
        items: {
          select: {
            id: true,
            productId: true,
            title: true,
            qty: true,
            price: true,
            customAnswers: true,
            repeatedGroupAnswers: true,
          },
        },
      },
    },
  };
}

function frontendUrl() {
  return (process.env.APP_URL || process.env.FRONTEND_URL || "").replace(/\/+$/, "");
}

/*
 * Versiunea ACTIVĂ a Politicii de retur, stabilită pe server (nu cea
 * declarată de client) - păstrată pentru audit în meta notificării
 * vânzătorului (fără coloană nouă pe ReturnRequest).
 */
async function activeReturnsPolicy() {
  try {
    const doc = await legalPublished.loadPublishedLegalDoc("returns_policy_ack");
    return {
      key: "returns_policy_ack",
      version: doc?.semver || doc?.version || null,
      checksum: doc?.checksum || null,
    };
  } catch {
    return null;
  }
}

async function notifyAdminsPersonalizationReview({ db, returnRequestId, order }) {
  const createUserNotification = notificationsService.createUserNotification;
  if (typeof createUserNotification !== "function") return;

  const admins = await db.user.findMany({
    where: { role: "ADMIN", status: "ACTIVE" },
    select: { id: true },
    take: 50,
  });

  await Promise.all(
    admins.map((admin) =>
      createUserNotification(admin.id, {
        dedupeKey: `return_personalization_review:${returnRequestId}:${admin.id}`,
        type: "system",
        title: `Retur de verificat - personalizare neclară (#${order.orderNumber || order.id})`,
        body: "Clientul a cerut retragerea fără motiv pentru un produs a cărui personalizare nu poate fi stabilită sigur din datele comenzii. Verifică dacă se aplică excepția din OUG 34/2014, art. 16 lit. c) (produs realizat după specificațiile clientului / personalizat în mod clar). Culoarea, mărimea și opțiunile standard nu sunt personalizare.",
        link: "/admin?tab=returns",
        meta: {
          kind: "return_personalization_review",
          returnRequestId,
          orderId: order.id,
        },
      }).catch(() => null)
    )
  );
}

async function sendVendorEmail({ db, vendorId, order, items, reasonCode }) {
  if (typeof mailer.sendVendorReturnRequestedEmail !== "function") return;

  const vendor = await db.vendor.findUnique({
    where: { id: vendorId },
    select: { displayName: true, email: true, user: { select: { email: true } } },
  });

  const to = vendor?.email || vendor?.user?.email;
  if (!to) return;

  await mailer.sendVendorReturnRequestedEmail({
    to,
    vendorName: vendor.displayName,
    orderNumber: order.orderNumber || order.id,
    items,
    reasonLabel: returnReasonLabel(reasonCode),
    reasonKindLabel: REASON_KIND_LABELS[RETURN_REASONS[reasonCode]?.kind] || "",
    link: `/vendor/orders/${order.id}`,
    orderId: order.id,
  });
}

async function sendClientConfirmation({ db, order, userId, items, link }) {
  if (typeof mailer.sendReturnRequestReceivedEmail !== "function") return;

  const user = userId
    ? await db.user.findUnique({ where: { id: userId }, select: { email: true, firstName: true } })
    : null;

  const to = user?.email || order.customerEmail || order.shippingAddress?.email || null;
  if (!to) return;

  await mailer.sendReturnRequestReceivedEmail({
    to,
    clientName: user?.firstName || order.customerName || order.shippingAddress?.name || "",
    orderNumber: order.orderNumber || order.id,
    items,
    link,
    orderId: order.id,
    userId,
  });
}

/*
 * order: rezultatul lui findFirst(select: returnOrderSelect(shipmentId)),
 *        deja verificat ca aparținând clientului / tokenului guest.
 * userId: id-ul clientului sau null (guest).
 * clientLink: unde își urmărește clientul cererea (pagina comenzii sau
 *             pagina guest securizată).
 */
export async function createReturnRequest({ db = defaultPrisma, order, userId = null, input, clientLink = null }) {
  const reason = RETURN_REASONS[input.reasonCode];

  if (reason.textRequired && !String(input.reasonText || "").trim()) {
    throw new ReturnCreateError(400, "reason_text_required", "Te rugăm să descrii motivul returnului.");
  }

  const isNonConformity = isConformityReason(input.reasonCode);

  if (reason.photosRequired && input.photos.length === 0) {
    throw new ReturnCreateError(
      400,
      "photos_required",
      "Pentru acest motiv este necesară cel puțin o fotografie."
    );
  }

  const shipment = order.shipments[0];

  if (!shipment || shipment.direction !== "OUTBOUND") {
    throw new ReturnCreateError(404, "shipment_not_found", "Livrarea selectată nu aparține acestei comenzi.");
  }

  if (shipment.status !== "DELIVERED") {
    throw new ReturnCreateError(409, "not_delivered", "Returul este disponibil doar pentru produsele livrate.");
  }

  // Fereastra standard de retur. După ea, doar neconformitate.
  const deliveredAt = shipment.deliveredAt || shipment.updatedAt;
  const ageDays = deliveredAt
    ? (Date.now() - new Date(deliveredAt).getTime()) / (1000 * 60 * 60 * 24)
    : 0;

  if (ageDays > RETURN_WINDOW_DAYS && !isNonConformity) {
    throw new ReturnCreateError(
      409,
      "return_window_expired",
      `Termenul de ${RETURN_WINDOW_DAYS} zile pentru retur a expirat. După acest termen poți solicita doar remedierea unei neconformități (produs defect, greșit sau diferit de descriere).`
    );
  }

  // Produsele cerute trebuie să fie din această livrare.
  const itemsById = new Map(shipment.items.map((item) => [item.id, item]));
  const requestedByItem = new Map();

  for (const requested of input.items) {
    if (!itemsById.has(requested.orderItemId)) {
      throw new ReturnCreateError(
        400,
        "item_not_in_shipment",
        "Unul dintre produsele selectate nu face parte din această livrare."
      );
    }

    requestedByItem.set(
      requested.orderItemId,
      (requestedByItem.get(requested.orderItemId) || 0) + requested.qty
    );
  }

  /*
   * Produse personalizate (OUG 34/2014, art. 16 lit. c): fără retragere
   * fără motiv; neconformitatea rămâne permisă. Clasificare neclară ->
   * cererea NU e respinsă, ci trimisă la verificare.
   */
  let personalizationReview = false;

  if (!isNonConformity) {
    const requestedItems = [...requestedByItem.keys()].map((id) => itemsById.get(id));
    const productIds = [...new Set(requestedItems.map((i) => i.productId).filter(Boolean))];

    const products = productIds.length
      ? await db.product.findMany({
          where: { id: { in: productIds } },
          select: { id: true, optionsSchema: true, customSchema: true, repeatedGroups: true },
        })
      : [];

    const productsById = new Map(products.map((p) => [p.id, p]));

    const personalizationCheck = checkPersonalizedReturn({
      reasonCode: input.reasonCode,
      items: requestedItems.map((item) => ({
        title: item.title,
        personalization: classifyPersonalization(item, productsById.get(item.productId) || null, {
          fromQuote: Boolean(order.quoteRequest),
        }),
      })),
    });

    if (personalizationCheck?.block) {
      throw new ReturnCreateError(409, personalizationCheck.code, personalizationCheck.message);
    }

    personalizationReview = Boolean(personalizationCheck?.review);
  }

  // Cantitatea totală returnată (inclusiv cereri anterioare nerespinse)
  // nu poate depăși cantitatea cumpărată.
  const previous = await db.returnRequestItem.findMany({
    where: {
      shipmentItemId: { in: [...requestedByItem.keys()] },
      returnRequest: { status: { notIn: EXCLUDED_STATUSES_FOR_QTY } },
    },
    select: { shipmentItemId: true, qty: true },
  });

  const alreadyReturned = new Map();

  for (const row of previous) {
    alreadyReturned.set(row.shipmentItemId, (alreadyReturned.get(row.shipmentItemId) || 0) + row.qty);
  }

  for (const [itemId, qty] of requestedByItem) {
    const item = itemsById.get(itemId);
    const available = Number(item.qty || 0) - (alreadyReturned.get(itemId) || 0);

    if (qty > available) {
      throw new ReturnCreateError(
        409,
        "quantity_exceeds_purchased",
        `Pentru "${item.title}" poți solicita cel mult ${Math.max(0, available)} buc. (restul sunt deja în cereri de retur).`
      );
    }
  }

  const created = await db.returnRequest.create({
    data: {
      userId,
      orderId: order.id,
      originalShipmentId: shipment.id,
      vendorId: shipment.vendorId,
      reasonCode: input.reasonCode,
      reasonText: input.reasonText || null,
      faultParty: input.faultParty || "UNKNOWN",
      resolutionWanted: input.resolutionWanted || "REFUND",
      notesUser: input.notesUser || null,
      photos: input.photos,
      items: {
        create: [...requestedByItem].map(([itemId, qty]) => {
          const item = itemsById.get(itemId);

          return {
            shipmentItemId: item.id,
            productId: item.productId || null,
            title: item.title,
            qty,
            price: item.price,
          };
        }),
      },
    },
    select: { id: true, status: true, createdAt: true },
  });

  const emailItems = [...requestedByItem].map(([itemId, qty]) => ({
    title: itemsById.get(itemId).title,
    qty,
  }));

  const policy = await activeReturnsPolicy();

  // Efecte secundare best-effort: cererea e deja salvată.
  try {
    await notificationsService.createVendorNotification(shipment.vendorId, {
      dedupeKey: `vendor_return_requested:${created.id}`,
      type: "order",
      title: `Cerere de retur pentru comanda #${order.orderNumber || order.id}`,
      body: vendorNewReturnNotificationBody({ personalizationReview }),
      link: `/vendor/orders/${order.id}`,
      meta: {
        kind: "return_requested",
        returnRequestId: created.id,
        orderId: order.id,
        shipmentId: shipment.id,
        reasonCode: input.reasonCode,
        reasonKind: reason.kind,
        personalizationReview,
        guest: !userId,
        // audit: politica ACTIVĂ la momentul cererii + ce a confirmat clientul
        policy,
        policyAck: {
          key: input.policyAck?.key || "returns_policy_ack",
          version: input.policyAck?.version ?? null,
          acceptedAt: input.policyAck?.acceptedAt || null,
        },
      },
    });
  } catch (error) {
    console.error("[returns] vendor notification failed:", error?.message || error);
  }

  await sendVendorEmail({ db, vendorId: shipment.vendorId, order, items: emailItems, reasonCode: input.reasonCode }).catch(
    (error) => console.error("[returns] vendor email failed:", error?.message || error)
  );

  await sendClientConfirmation({ db, order, userId, items: emailItems, link: clientLink }).catch((error) =>
    console.error("[returns] client confirmation email failed:", error?.message || error)
  );

  if (personalizationReview) {
    await notifyAdminsPersonalizationReview({ db, returnRequestId: created.id, order }).catch((error) =>
      console.error("[returns] admin review notification failed:", error?.message || error)
    );
  }

  return {
    ok: true,
    returnRequestId: created.id,
    status: created.status,
    createdAt: created.createdAt,
    reasonKind: reason.kind,
    ...(personalizationReview ? { review: PERSONALIZATION.UNCLEAR } : {}),
  };
}

export function clientReturnLink({ orderId, guest = false }) {
  const base = frontendUrl();
  return guest ? null : `${base}/comanda/${orderId}`;
}

export function sendCreateError(res, error, where) {
  if (error instanceof ReturnCreateError) {
    return res.status(error.status).json({ ok: false, error: error.code, message: error.message, ...error.extra });
  }

  console.error(`${where} FAILED:`, error);

  return res.status(500).json({
    ok: false,
    error: "return_request_failed",
    message: "Cererea de retur nu a putut fi trimisă.",
  });
}
