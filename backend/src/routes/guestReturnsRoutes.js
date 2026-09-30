// backend/src/routes/guestReturnsRoutes.js
//
// RETURURI pentru comenzile GUEST (fără cont), montat la /api/guest/orders:
//
//   GET  /:id/returns?token=|returnToken=          produse + cererile de retur
//   POST /:id/returns?token=                       cerere nouă (aceleași reguli)
//   POST /:id/returns/:returnId/reply?token=|returnToken=
//                                                  răspuns la mesajele vânzătorului
//
// Acces (fără câmpuri Prisma noi):
//  - token       = tokenul ORIGINAL al comenzii (guestAccessTokenHash +
//                  guestAccessExpiresAt, din emailul de confirmare) - acces
//                  complet: formular + urmărire;
//  - orderToken  = token semnat stateless (lib/guestOrderAccessToken.js),
//                  din emailul „predat curierului” - același acces complet
//                  la retur, fără să atingă guestAccessTokenHash;
//  - returnToken = token semnat, trimis în emailurile de status ale
//                  returului (lib/guestReturnAccessToken.js) - DOAR urmărire
//                  și răspuns, fără cereri noi.
// Nu se creează cont automat.

import { Router } from "express";
import multer from "multer";
import { prisma } from "../db.js";
import { uploadToR2 } from "../services/r2Storage.js";
import crypto from "node:crypto";
import { verifyGuestReturnAccessToken } from "../lib/guestReturnAccessToken.js";
import { verifyGuestOrderAccessToken } from "../lib/guestOrderAccessToken.js";
import {
  ReturnPayload,
  createReturnRequest,
  returnOrderSelect,
  sendCreateError,
} from "../services/returnRequestCreate.js";
import {
  ReturnFlowError,
  listReturnRequestsForOrder,
  postGuestReturnReply,
  clientReturnTrackingLink,
} from "../services/returnRequestService.js";
import { classifyPersonalization } from "../services/returnRequestRules.js";

const router = Router();

// același hash ca guestOrderRoutes.js / withdrawalService.js (guestAccessTokenHash)
function hashGuestToken(token) {
  return crypto.createHash("sha256").update(String(token || "")).digest("hex");
}

function guestOrderWhere(ref, token) {
  return {
    isGuestOrder: true,
    userId: null,
    guestAccessTokenHash: hashGuestToken(token),
    AND: [
      { OR: [{ id: ref }, { orderNumber: ref }] },
      { OR: [{ guestAccessExpiresAt: null }, { guestAccessExpiresAt: { gt: new Date() } }] },
    ],
  };
}

/*
 * -> { orderId, full } sau null.
 * full = true cu tokenul original al comenzii sau cu orderToken
 * (lib/guestOrderAccessToken.js, emailul „predat curierului”).
 */
async function resolveGuestAccess(req) {
  const ref = String(req.params.id || "").trim();
  const token = String(req.query.token || req.body?.token || "").trim();
  const orderToken = String(req.query.orderToken || req.body?.orderToken || "").trim();
  const returnToken = String(req.query.returnToken || req.body?.returnToken || "").trim();

  if (!ref) return null;

  if (!token && orderToken) {
    // semnătură + expirare + purpose; apoi STRICT comanda guest din token
    const payload = verifyGuestOrderAccessToken(orderToken);
    if (!payload) return null;

    const order = await prisma.order.findFirst({
      where: { isGuestOrder: true, userId: null, OR: [{ id: ref }, { orderNumber: ref }] },
      select: { id: true },
    });

    return order && order.id === payload.orderId ? { orderId: order.id, full: true } : null;
  }

  if (token) {
    const order = await prisma.order.findFirst({
      where: guestOrderWhere(ref, token),
      select: { id: true },
    });

    return order ? { orderId: order.id, full: true } : null;
  }

  if (returnToken) {
    const payload = verifyGuestReturnAccessToken(returnToken);
    if (!payload) return null;

    const order = await prisma.order.findFirst({
      where: { isGuestOrder: true, userId: null, OR: [{ id: ref }, { orderNumber: ref }] },
      select: { id: true },
    });

    return order && order.id === payload.orderId ? { orderId: order.id, full: false } : null;
  }

  return null;
}

function accessDenied(res) {
  return res.status(403).json({
    ok: false,
    error: "guest_order_access_invalid",
    message: "Linkul nu mai este valid. Folosește linkul din emailul comenzii sau contactează suportul Artfest.",
  });
}

/*
 * Datele de care are nevoie formularul de retur (aceeași formă ca
 * GET /api/user/orders/:id, doar câmpurile necesare) - fără adresa de
 * retur a vânzătorului (se comunică doar după acceptare).
 */
async function buildGuestReturnForm(orderId) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      orderNumber: true,
      status: true,
      quoteRequest: { select: { id: true } },
      shipments: {
        where: { direction: "OUTBOUND" },
        select: {
          id: true,
          status: true,
          deliveredAt: true,
          updatedAt: true,
          vendorId: true,
          vendor: { select: { displayName: true } },
          items: {
            select: {
              id: true,
              productId: true,
              title: true,
              qty: true,
              customAnswers: true,
              repeatedGroupAnswers: true,
            },
          },
        },
      },
    },
  });

  if (!order) return null;

  const productIds = [
    ...new Set(order.shipments.flatMap((s) => s.items.map((i) => i.productId)).filter(Boolean)),
  ];

  const products = productIds.length
    ? await prisma.product.findMany({
        where: { id: { in: productIds } },
        select: { id: true, images: true, optionsSchema: true, customSchema: true, repeatedGroups: true },
      })
    : [];

  const productById = new Map(products.map((p) => [p.id, p]));
  const anyDelivered = order.shipments.some((s) => s.status === "DELIVERED");

  return {
    id: order.id,
    orderNumber: order.orderNumber,
    status: anyDelivered ? "DELIVERED" : order.status,
    shipments: order.shipments.map((s) => ({
      id: s.id,
      status: s.status,
      deliveredAt: s.deliveredAt,
      statusUpdatedAt: s.updatedAt,
      vendorId: s.vendorId,
      vendorName: s.vendor?.displayName || "Artizan",
    })),
    items: order.shipments.flatMap((s) =>
      s.items.map((item) => {
        const product = productById.get(item.productId) || null;

        return {
          id: item.id,
          shipmentId: s.id,
          productId: item.productId,
          title: item.title,
          qty: item.qty,
          image: Array.isArray(product?.images) && product.images[0] ? product.images[0] : null,
          returnPersonalization: classifyPersonalization(item, product, {
            fromQuote: Boolean(order.quoteRequest),
          }),
        };
      })
    ),
  };
}

router.get("/:id/returns", async (req, res) => {
  try {
    const access = await resolveGuestAccess(req);
    if (!access) return accessDenied(res);

    const [form, returnRequests] = await Promise.all([
      access.full ? buildGuestReturnForm(access.orderId) : null,
      listReturnRequestsForOrder({ orderId: access.orderId, audience: "GUEST", db: prisma }),
    ]);

    return res.json({
      ok: true,
      orderId: access.orderId,
      canCreate: access.full,
      order: form,
      returnRequests,
    });
  } catch (error) {
    console.error("GET /api/guest/orders/:id/returns FAILED:", error);
    return res.status(500).json({ ok: false, error: "server_error" });
  }
});

router.post("/:id/returns", async (req, res) => {
  try {
    const access = await resolveGuestAccess(req);

    // cererile noi cer tokenul original al comenzii
    if (!access || !access.full) return accessDenied(res);

    const parsed = ReturnPayload.safeParse({ ...(req.body || {}), orderId: access.orderId });

    if (!parsed.success) {
      return res.status(400).json({
        ok: false,
        error: "invalid_payload",
        message: "Datele cererii de retur sunt invalide.",
        details: parsed.error.flatten(),
      });
    }

    const input = parsed.data;

    const order = await prisma.order.findUnique({
      relationLoadStrategy: "query",
      where: { id: access.orderId },
      select: returnOrderSelect(input.shipmentId),
    });

    if (!order) return accessDenied(res);

    const result = await createReturnRequest({
      db: prisma,
      order,
      userId: null,
      input,
      clientLink: clientReturnTrackingLink({ rr: { orderId: order.id, userId: null } }),
    });

    return res.status(201).json(result);
  } catch (error) {
    return sendCreateError(res, error, "POST /api/guest/orders/:id/returns");
  }
});

/*
 * Poze pentru cererea de retur (guest nu poate folosi /api/upload, care cere
 * cont). Doar cu tokenul original al comenzii; aceleași limite ca în
 * formular (PNG/JPG/WebP, max 3 MB).
 */
const uploadReturnPhoto = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 3 * 1024 * 1024 },
  fileFilter: (_req, file, cb) =>
    /^image\/(png|jpe?g|webp)$/i.test(String(file.mimetype || ""))
      ? cb(null, true)
      : cb(new Error("INVALID_IMAGE_TYPE")),
});

router.post("/:id/returns/photos", async (req, res) => {
  try {
    const access = await resolveGuestAccess(req);
    if (!access || !access.full) return accessDenied(res);

    uploadReturnPhoto.single("file")(req, res, async (err) => {
      if (err) {
        return res.status(400).json({
          ok: false,
          error: "invalid_file",
          message:
            err.code === "LIMIT_FILE_SIZE"
              ? "Maxim 3 MB per poză."
              : "Acceptăm doar PNG / JPG / WebP.",
        });
      }

      if (!req.file) {
        return res.status(400).json({ ok: false, error: "no_file", message: "Nu ai trimis nicio imagine." });
      }

      try {
        const uploaded = await uploadToR2({
          file: req.file,
          folder: "returns",
          userId: `guest-order-${access.orderId}`,
        });

        return res.json({ ok: true, url: uploaded.url });
      } catch (uploadError) {
        console.error("POST /api/guest/orders/:id/returns/photos upload failed:", uploadError);
        return res.status(500).json({ ok: false, error: "upload_failed", message: "Upload eșuat. Încearcă din nou." });
      }
    });
  } catch (error) {
    console.error("POST /api/guest/orders/:id/returns/photos FAILED:", error);
    return res.status(500).json({ ok: false, error: "server_error" });
  }
});

router.post("/:id/returns/:returnId/reply", async (req, res) => {
  try {
    const access = await resolveGuestAccess(req);
    if (!access) return accessDenied(res);

    const result = await postGuestReturnReply({
      db: prisma,
      returnRequestId: String(req.params.returnId),
      orderId: access.orderId,
      message: req.body?.message,
    });

    return res.json(result);
  } catch (error) {
    if (error instanceof ReturnFlowError) {
      return res.status(error.status).json({ ok: false, error: error.code, message: error.message });
    }

    console.error("POST /api/guest/orders/:id/returns/:returnId/reply FAILED:", error);
    return res.status(500).json({ ok: false, error: "server_error" });
  }
});

export default router;
