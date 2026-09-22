// backend/src/routes/userReturnsRoutes.js
//
// POST /api/user/returns - cerere de RETUR / NECONFORMITATE inițiată de
// client (formularul ReturnRequestModal din /comenzile-mele).
//
// Endpoint-ul lipsea complet: frontend-ul apela POST /api/user/returns,
// dar nicio rută nu-l implementa (404) - deși admin-ul are deja
// procesarea completă (adminPickupsRoutes.js: listă, status, AWB retur).
//
// Folosește STRICT modelele existente ReturnRequest / ReturnRequestItem
// (fără schimbări de schemă). Retragerea legală fără motiv (OUG 34/2014)
// e un flux DISTINCT (WithdrawalRequest) - vezi userWithdrawalRoutes.js.
//
// Montat în server.js ÎNAINTE de /api/user (userRoutes cere rol USER pe
// toate rutele; proprietatea comenzii se verifică aici pe userId, ca în
// userOrdersRoutes.js - un vânzător care cumpără își poate returna
// comenzile).

import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { authRequired, enforceTokenVersion } from "../api/auth.js";
import { createVendorNotification } from "../services/notifications.js";

const router = Router();

router.use(authRequired, enforceTokenVersion);

const RETURN_WINDOW_DAYS = 14;

const REASON_CODES = [
  "DEFECT",
  "WRONG_ITEM",
  "NOT_AS_DESCRIBED",
  "SIZE_COLOR",
  "CHANGED_MIND",
  "OTHER",
];

// Motive de neconformitate: rămân posibile și după fereastra standard
// (aceeași regulă ca în ReturnRequestModal) și cer dovezi foto.
const NON_CONFORMITY_REASONS = [
  "DEFECT",
  "WRONG_ITEM",
  "NOT_AS_DESCRIBED",
];

// Cererile respinse nu mai "consumă" cantitatea returnabilă.
const EXCLUDED_STATUSES_FOR_QTY = ["REJECTED"];

const ReturnPayload = z.object({
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
  reasonCode: z.enum(REASON_CODES),
  reasonText: z.string().trim().max(2000).nullish(),
  faultParty: z.enum(["VENDOR", "CUSTOMER", "UNKNOWN"]).nullish(),
  resolutionWanted: z
    .enum(["REFUND", "EXCHANGE", "VOUCHER"])
    .nullish(),
  notesUser: z.string().trim().max(2000).nullish(),
  photos: z
    .array(z.string().trim().url().max(2000))
    .max(6)
    .default([]),
  policyAck: z
    .object({
      accepted: z.literal(true),
    })
    .passthrough(),
});

function sendError(res, status, error, message, extra = {}) {
  return res.status(status).json({
    ok: false,
    error,
    message,
    ...extra,
  });
}

router.post("/", async (req, res) => {
  try {
    const parsed = ReturnPayload.safeParse(req.body || {});

    if (!parsed.success) {
      return sendError(
        res,
        400,
        "invalid_payload",
        "Datele cererii de retur sunt invalide.",
        { details: parsed.error.flatten() }
      );
    }

    const input = parsed.data;
    const userId = req.user.sub;

    if (
      input.reasonCode === "OTHER" &&
      !String(input.reasonText || "").trim()
    ) {
      return sendError(
        res,
        400,
        "reason_text_required",
        "Te rugăm să descrii motivul returnului."
      );
    }

    const isNonConformity = NON_CONFORMITY_REASONS.includes(
      input.reasonCode
    );

    if (isNonConformity && input.photos.length === 0) {
      return sendError(
        res,
        400,
        "photos_required",
        "Pentru acest motiv este necesară cel puțin o fotografie."
      );
    }

    // Comanda trebuie să aparțină userului logat.
    const order = await prisma.order.findFirst({
      relationLoadStrategy: "query",
      where: {
        userId,
        OR: [{ id: input.orderId }, { orderNumber: input.orderId }],
      },
      select: {
        id: true,
        orderNumber: true,
        shipments: {
          where: { id: input.shipmentId },
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
              },
            },
          },
        },
      },
    });

    if (!order) {
      return sendError(res, 404, "not_found", "Comanda nu a fost găsită.");
    }

    const shipment = order.shipments[0];

    if (!shipment || shipment.direction !== "OUTBOUND") {
      return sendError(
        res,
        404,
        "shipment_not_found",
        "Livrarea selectată nu aparține acestei comenzi."
      );
    }

    if (shipment.status !== "DELIVERED") {
      return sendError(
        res,
        409,
        "not_delivered",
        "Returul este disponibil doar pentru produsele livrate."
      );
    }

    // Fereastra standard de retur. După ea, doar neconformitate
    // (regulă identică cu cea din formular, acum aplicată și server-side).
    const deliveredAt = shipment.deliveredAt || shipment.updatedAt;
    const ageDays = deliveredAt
      ? (Date.now() - new Date(deliveredAt).getTime()) /
        (1000 * 60 * 60 * 24)
      : 0;

    if (ageDays > RETURN_WINDOW_DAYS && !isNonConformity) {
      return sendError(
        res,
        409,
        "return_window_expired",
        `Termenul de ${RETURN_WINDOW_DAYS} zile pentru retur a expirat. După acest termen poți solicita doar remedierea unei neconformități (produs defect, greșit sau diferit de descriere).`
      );
    }

    // Produsele cerute trebuie să fie din această livrare, iar
    // cantitatea totală returnată (inclusiv cererile anterioare
    // nerespinse) nu poate depăși cantitatea cumpărată.
    const itemsById = new Map(
      shipment.items.map((item) => [item.id, item])
    );

    const requestedByItem = new Map();

    for (const requested of input.items) {
      if (!itemsById.has(requested.orderItemId)) {
        return sendError(
          res,
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

    const previous = await prisma.returnRequestItem.findMany({
      where: {
        shipmentItemId: { in: [...requestedByItem.keys()] },
        returnRequest: {
          status: { notIn: EXCLUDED_STATUSES_FOR_QTY },
        },
      },
      select: { shipmentItemId: true, qty: true },
    });

    const alreadyReturned = new Map();

    for (const row of previous) {
      alreadyReturned.set(
        row.shipmentItemId,
        (alreadyReturned.get(row.shipmentItemId) || 0) + row.qty
      );
    }

    for (const [itemId, qty] of requestedByItem) {
      const item = itemsById.get(itemId);
      const available =
        Number(item.qty || 0) - (alreadyReturned.get(itemId) || 0);

      if (qty > available) {
        return sendError(
          res,
          409,
          "quantity_exceeds_purchased",
          `Pentru "${item.title}" poți solicita cel mult ${Math.max(
            0,
            available
          )} buc. (restul sunt deja în cereri de retur).`
        );
      }
    }

    const created = await prisma.returnRequest.create({
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
      select: {
        id: true,
        status: true,
        createdAt: true,
      },
    });

    // Vânzătorul e informat; eșecul notificării nu invalidează cererea
    // (ea e deja salvată și vizibilă în admin -> Retururi).
    try {
      await createVendorNotification(shipment.vendorId, {
        dedupeKey: `vendor_return_requested:${created.id}`,
        type: "order",
        title: `Cerere de retur pentru comanda #${
          order.orderNumber || order.id
        }`,
        body: "Un client a trimis o cerere de retur/neconformitate. Echipa Artfest o procesează; vei fi contactat dacă este necesar.",
        link: `/vendor/orders/${order.id}`,
        meta: {
          kind: "return_requested",
          returnRequestId: created.id,
          orderId: order.id,
          shipmentId: shipment.id,
          reasonCode: input.reasonCode,
        },
      });
    } catch (notifyError) {
      console.error(
        "POST /api/user/returns vendor notification failed:",
        notifyError
      );
    }

    return res.status(201).json({
      ok: true,
      returnRequestId: created.id,
      status: created.status,
      createdAt: created.createdAt,
    });
  } catch (error) {
    console.error("POST /api/user/returns FAILED:", error);

    return sendError(
      res,
      500,
      "return_request_failed",
      "Cererea de retur nu a putut fi trimisă."
    );
  }
});

export default router;
