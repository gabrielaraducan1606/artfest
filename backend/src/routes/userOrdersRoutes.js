// backend/src/routes/userOrdersRoutes.js
import { Router } from "express";
import { prisma } from "../db.js";
import { authRequired } from "../api/auth.js";
import { sendOrderCancelledByUserNotifications } from "../services/orderMessaging.js";
import { sendOrderCancelledByUserEmail } from "../lib/mailer.js";

const router = Router();

/* ----------------------------------------------------
   Middleware global: doar user logat (indiferent de rol)
----------------------------------------------------- */
router.use(authRequired);

/* ----------------------------------------------------
   Helper: map OrderStatus + ShipmentStatus -> UI status
   UI: PENDING | PROCESSING | SHIPPED | DELIVERED | CANCELED | RETURNED
----------------------------------------------------- */
function computeUiStatus(order, shipments = []) {
  const orderStatus = order?.status || null; // PENDING / PAID / CANCELLED / FULFILLED
  const shipmentStatuses = shipments.map((s) => s.status);

  // 1) dacă avem shipments, derivăm din ele (au prioritate)
  if (shipmentStatuses.length) {
    // retur real are prioritate
    if (shipmentStatuses.some((st) => st === "RETURNED")) return "RETURNED";

    // anulare vendor / colet neexpediat
    if (shipmentStatuses.some((st) => st === "REFUSED")) return "CANCELED";

    // livrat doar dacă toate sunt livrate
    if (shipmentStatuses.every((st) => st === "DELIVERED")) return "DELIVERED";

    // SHIPPED doar când chiar există AWB / ridicat / în tranzit
    if (shipmentStatuses.some((st) => ["AWB", "IN_TRANSIT"].includes(st)))
      return "SHIPPED";

    // PROCESSING include și “pickup cerut”
    if (
      shipmentStatuses.some((st) =>
        ["PREPARING", "READY_FOR_PICKUP", "PICKUP_SCHEDULED"].includes(st)
      )
    )
      return "PROCESSING";

    if (shipmentStatuses.some((st) => st === "PENDING")) return "PENDING";
  }

  // 2) dacă order e CANCELLED și NU avem shipments relevante, override UI
  if (orderStatus === "CANCELLED") return "CANCELED";

  // 3) fallback din OrderStatus
  switch (orderStatus) {
    case "PENDING":
      return "PENDING";
    case "PAID":
      return "PROCESSING";
    case "FULFILLED":
      return "DELIVERED";
    default:
      return "PENDING";
  }
}

function computeShippingStage(shipments = []) {
  const st = shipments.map((s) => s.status);

  // pickup cerut / programat (fără AWB)
  if (st.some((x) => ["READY_FOR_PICKUP", "PICKUP_SCHEDULED"].includes(x))) {
    return {
      code: "AWAITING_COURIER_PICKUP",
      label: "Urmează să fie predată curierului",
    };
  }

  if (st.some((x) => x === "AWB")) {
    return {
      code: "AWB_ISSUED",
      label: "AWB emis – pregătită de expediere",
    };
  }

  if (st.some((x) => x === "IN_TRANSIT")) {
    return {
      code: "IN_TRANSIT",
      label: "Predată curierului",
    };
  }

  if (st.length > 0 && st.every((x) => x === "DELIVERED")) {
    return {
      code: "DELIVERED",
      label: "Livrată",
    };
  }

  return null;
}

/* ----------------------------------------------------
   Helper: este anulabilă comanda?
   - nu e deja CANCELLED/FULFILLED
   - niciun shipment nu a depășit PENDING
----------------------------------------------------- */
function isOrderCancellable(order, shipments = []) {
  const orderStatus = order?.status || null;

  // dacă e deja CANCELLED sau FULFILLED, clar nu
  if (["CANCELLED", "FULFILLED"].includes(orderStatus)) return false;

  // dacă vreun shipment este deja trecut de PENDING -> nu mai e anulabilă
  const hasStartedOrBeyond = shipments.some((s) =>
    [
      "PREPARING",
      "READY_FOR_PICKUP",
      "AWB",
      "IN_TRANSIT",
      "PICKUP_SCHEDULED",
      "DELIVERED",
      "RETURNED",
      "REFUSED",
    ].includes(s.status)
  );

  if (hasStartedOrBeyond) return false;

  return true;
}

/* ----------------------------------------------------
   GET /api/user/orders/my
   Folosit de OrdersPage (lista de comenzi user)
----------------------------------------------------- */
router.get("/my", async (req, res) => {
  const userId = req.user.sub;

  const q = String(req.query.q || "").trim();
  const statusParam = String(req.query.status || ""); // ex: "PENDING,PROCESSING,SHIPPED"
  const page = Math.max(1, parseInt(req.query.page || "1", 10));
  const limit = Math.min(
    50,
    Math.max(1, parseInt(req.query.limit || "10", 10))
  );

  const statusList = statusParam
    ? String(statusParam)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

  const where = { userId };

  // luăm toate comenzile userului, apoi filtrăm în memorie după status UI
  const rows = await prisma.order.findMany({
    where,
    include: {
      shipments: {
        include: { items: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  // 🔹 colectăm toate productId din shipment items
  const productIdSet = new Set();
  for (const o of rows) {
    for (const s of o.shipments) {
      for (const it of s.items) {
        if (it.productId) productIdSet.add(it.productId);
      }
    }
  }

  // 🔹 map productId -> prima imagine (sau null)
  let imageMap = new Map();
  if (productIdSet.size) {
    const products = await prisma.product.findMany({
      where: { id: { in: Array.from(productIdSet) } },
      select: { id: true, images: true },
    });

    imageMap = new Map(
      products.map((p) => [
        p.id,
        Array.isArray(p.images) && p.images[0] ? p.images[0] : null,
      ])
    );
  }

  let items = rows.map((o) => {
    const status = computeUiStatus(o, o.shipments);
    const shippingStage = computeShippingStage(o.shipments);

    // ✅ NEW: eligibil pentru retur (doar când e livrat)
    const returnEligible = status === "DELIVERED";

    const currency = o.currency || "RON";

    const subtotal = Number(o.subtotal || 0);
    const shippingTotal = Number(o.shippingTotal || 0);
    const total = Number(o.total || subtotal + shippingTotal);

    const totalCents = Math.round(total * 100);

    const addr = o.shippingAddress || {};
    const isCompany = !!(addr.companyName || addr.companyCui);
    const customerType = isCompany ? "PJ" : "PF";

    // flatten peste toate shipment items (multi-vendor)
    const flatItems = o.shipments.flatMap((s) =>
      s.items.map((it) => ({
        id: it.id,
        productId: it.productId,
        title: it.title,
        qty: it.qty,
        priceCents: Math.round(Number(it.price || 0) * 100),
        image: imageMap.get(it.productId) || null,
        shipmentId: s.id,
      }))
    );

    return {
      id: o.id,
      orderNumber: o.orderNumber || null,
      createdAt: o.createdAt,
      status, // PENDING / PROCESSING / SHIPPED / DELIVERED / RETURNED / CANCELED
      totalCents,
      currency,
      items: flatItems,
      cancellable: isOrderCancellable(o, o.shipments),
      customerType,
      shippingAddress: addr,
      shippingStage,

      // ✅ NEW
      returnEligible,
    };
  });

  // Filtrare text: id comandă + orderNumber + titluri produse
  if (q) {
    const Q = q.toLowerCase();
    items = items.filter((order) => {
      const inId = String(order.id).toLowerCase().includes(Q);
      const inOrderNumber = String(order.orderNumber || "")
        .toLowerCase()
        .includes(Q);
      const inItems = order.items?.some((it) =>
        (it.title || "").toLowerCase().includes(Q)
      );
      return inId || inOrderNumber || inItems;
    });
  }

  // Filtrare după status UI (tab-uri)
  if (statusList.length) {
    items = items.filter((o) => statusList.includes(o.status));
  }

  // paginare după ce am filtrat
  const total = items.length;
  const start = (page - 1) * limit;
  const end = start + limit;
  const pageItems = items.slice(start, end);

  res.json({
    total,
    items: pageItems,
  });
});

/* ----------------------------------------------------
   GET /api/user/orders/:id
   (pt pagina /comanda/:id – detalii comandă user)
----------------------------------------------------- */
router.get("/:id", async (req, res) => {
  const userId = req.user.sub;
  const ref = String(req.params.id);

  const o = await prisma.order.findFirst({
    where: {
      userId,
      OR: [{ id: ref }, { orderNumber: ref }],
    },
    include: {
      shipments: {
        include: {
          items: true,
          vendor: {
            select: { id: true, displayName: true, address: true, city: true },
          },
        },
      },
    },
  });

  if (!o) return res.status(404).json({ error: "not_found" });

  const status = computeUiStatus(o, o.shipments);
  const shippingStage = computeShippingStage(o.shipments);

  // ✅ NEW: eligibil pentru retur (doar când e livrat)
  const returnEligible = status === "DELIVERED";

  const currency = o.currency || "RON";

  const subtotal = Number(o.subtotal || 0);
  const shippingTotal = Number(o.shippingTotal || 0);
  const total = Number(o.total || subtotal + shippingTotal);

  const subtotalCents = Math.round(subtotal * 100);
  const shippingCents = Math.round(shippingTotal * 100);
  const totalCents = Math.round(total * 100);

  const addr = o.shippingAddress || {};
  const isCompany = !!(addr.companyName || addr.companyCui);
  const customerType = isCompany ? "PJ" : "PF";

  // 🔹 imagini produse
  const productIdSet = new Set();
  for (const s of o.shipments) {
    for (const it of s.items) {
      if (it.productId) productIdSet.add(it.productId);
    }
  }

  let imageMap = new Map();
  if (productIdSet.size) {
    const products = await prisma.product.findMany({
      where: { id: { in: Array.from(productIdSet) } },
      select: { id: true, images: true },
    });

    imageMap = new Map(
      products.map((p) => [
        p.id,
        Array.isArray(p.images) && p.images[0] ? p.images[0] : null,
      ])
    );
  }

  const flatItems = o.shipments.flatMap((s) =>
    s.items.map((it) => ({
      id: it.id,
      productId: it.productId,
      title: it.title,
      qty: it.qty,
      priceCents: Math.round(Number(it.price || 0) * 100),
      image: imageMap.get(it.productId) || null,
      shipmentId: s.id,
    }))
  );

  res.json({
    id: o.id,
    orderNumber: o.orderNumber || null,
    createdAt: o.createdAt,
    status,
    shippingStage,

    // ✅ NEW
    returnEligible,

    currency,
    subtotalCents,
    shippingCents,
    totalCents,
    shippingAddress: addr,
    customerType,
    items: flatItems,
    shipments: o.shipments.map((s) => ({
      id: s.id,
      provider: s.courierProvider,
      service: s.courierService,
      status: s.status,
      trackingUrl: s.trackingUrl,
      awb: s.awb,
      vendorId: s.vendorId || null,
      vendorName: s.vendor
        ? s.vendor.displayName || "Artizan"
        : s.vendorId
        ? "Artizan"
        : null,
      storeAddress: s.vendor
        ? {
            name: s.vendor.displayName || "Magazin",
            street: s.vendor.address || "",
            city: s.vendor.city || "",
            county: addr.county || "",
            postalCode: addr.postalCode || "",
            country: "România",
          }
        : null,
    })),
    cancellable: isOrderCancellable(o, o.shipments),
  });
});

/* ----------------------------------------------------
   POST /api/user/orders/:id/cancel
----------------------------------------------------- */
router.post("/:id/cancel", async (req, res) => {
  const userId = req.user.sub;
  const id = String(req.params.id);

  const o = await prisma.order.findFirst({
    where: { id, userId },
    include: {
      shipments: true,
      user: true,
    },
  });

  if (!o) return res.status(404).json({ error: "not_found" });

  const uiStatus = computeUiStatus(o, o.shipments);

  // în UI permiți anulare doar pentru PENDING / PROCESSING
  // + să nu fi început vreun vendor pregătirea
  if (
    !["PENDING", "PROCESSING"].includes(uiStatus) ||
    !isOrderCancellable(o, o.shipments)
  ) {
    return res.status(400).json({ error: "not_cancellable" });
  }

  // ✅ tranzacție: evităm stări "mixte"
  await prisma.$transaction([
    prisma.shipment.updateMany({
      where: {
        orderId: o.id,
        status: { in: ["PENDING"] }, // comanda anulabilă => shipments trebuie să fie încă PENDING
      },
      data: { status: "REFUSED" },
    }),
    prisma.order.update({
      where: { id: o.id },
      data: { status: "CANCELLED" },
    }),
  ]);

  // 🔹 notificări mesaje către vendor(i) (best-effort)
  try {
    await sendOrderCancelledByUserNotifications({
      orderId: o.id,
      userId,
    });
  } catch (e) {
    console.error("sendOrderCancelledByUserNotifications failed:", e);
  }

  // 🔹 email de confirmare către client (best-effort)
  try {
    const to = o.user?.email || o.shippingAddress?.email || null;
    if (to) {
      await sendOrderCancelledByUserEmail({ to, order: o });
    }
  } catch (e) {
    console.error("sendOrderCancelledByUserEmail failed:", e);
  }

  return res.json({ ok: true });
});

/* ----------------------------------------------------
   POST /api/user/orders/:id/reorder
----------------------------------------------------- */
router.post("/:id/reorder", async (req, res) => {
  const userId = req.user.sub;
  const id = String(req.params.id);

  const o = await prisma.order.findFirst({
    where: { id, userId },
    include: {
      shipments: {
        include: { items: true },
      },
    },
  });

  if (!o) return res.status(404).json({ error: "not_found" });

  const allItems = o.shipments.flatMap((s) => s.items);

  for (const it of allItems) {
    await prisma.cartItem.upsert({
      where: {
        userId_productId: {
          userId,
          productId: it.productId,
        },
      },
      update: {
        qty: {
          increment: it.qty,
        },
      },
      create: {
        userId,
        productId: it.productId,
        qty: it.qty,
      },
    });
  }

  return res.json({ ok: true });
});

export default router;
