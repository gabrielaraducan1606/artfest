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
    if (shipmentStatuses.some((st) => ["AWB", "IN_TRANSIT"].includes(st))) return "SHIPPED";

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
    return { code: "AWAITING_COURIER_PICKUP", label: "Urmează să fie predată curierului" };
  }

  if (st.some((x) => x === "AWB")) {
    return { code: "AWB_ISSUED", label: "AWB emis – pregătită de expediere" };
  }

  if (st.some((x) => x === "IN_TRANSIT")) {
    return { code: "IN_TRANSIT", label: "Predată curierului" };
  }

  if (st.length > 0 && st.every((x) => x === "DELIVERED")) {
    return { code: "DELIVERED", label: "Livrată" };
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

function parseStatusList(statusParam) {
  return statusParam
    ? String(statusParam)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
}

function toInsensitiveContains(q) {
  return { contains: q, mode: "insensitive" };
}

function computeTotalsCents(order) {
  const currency = order.currency || "RON";
  const subtotal = Number(order.subtotal || 0);
  const shippingTotal = Number(order.shippingTotal || 0);
  const total = Number(order.total || subtotal + shippingTotal);
  return { currency, totalCents: Math.round(total * 100) };
}

/* ----------------------------------------------------
   GET /api/user/orders/my
   Optimized:
   - query + paginare în DB (skip/take)
   - select minimal (nu include tot)
   - filtrare UI status în memorie cu "overfetch" ca să umple pagina
----------------------------------------------------- */
router.get("/my", async (req, res) => {
  const userId = req.user.sub;

  const q = String(req.query.q || "").trim();
  const statusParam = String(req.query.status || ""); // ex: "PENDING,PROCESSING,SHIPPED"
  const page = Math.max(1, parseInt(req.query.page || "1", 10));
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit || "10", 10)));

  const statusList = parseStatusList(statusParam);

  // where în DB (cât se poate)
  const where = {
    userId,
    ...(q
      ? {
          OR: [
            { orderNumber: toInsensitiveContains(q) },
            // id e cuid, de obicei nu e căutat, dar păstrăm funcțional
            { id: toInsensitiveContains(q) },
            {
              shipments: {
                some: {
                  items: {
                    some: {
                      title: toInsensitiveContains(q),
                    },
                  },
                },
              },
            },
          ],
        }
      : {}),
  };

  // total rapid (pentru paginare UI). Atenție: acest total NU ține cont de uiStatus derivat.
  // Dacă vrei total exact per tab, ai nevoie de denormalizare uiStatus sau de logică de numărare (scump).
  // Practic, front-ul tău calculează totalPages din total; ca să nu “mintă” prea tare, îl facem "best-effort":
  // - dacă nu ai statusList => total e exact
  // - dacă ai statusList => total e aproximativ (maxim), dar hasMore îl controlăm din fetch real
  const totalDb = await prisma.order.count({ where });

  // OVERFETCH ca să putem filtra pe uiStatus (derivat din shipments) dar să nu citim tot
  const INTERNAL_CHUNK = Math.min(200, limit * 8); // ex: limit 10 => 80
  const startIndexWanted = (page - 1) * limit;

  let collected = [];
  let scanned = 0;
  let skip = 0;

  // ca să ajungem la "pagina N" după filtrare, trebuie să sărim primele startIndexWanted rezultate filtrate
  let filteredOffsetToSkip = startIndexWanted;

  // limităm bucla ca să nu fie infinită dacă filtrele sunt foarte restrictive
  const MAX_LOOPS = 25;

  for (let loop = 0; loop < MAX_LOOPS; loop++) {
    const rows = await prisma.order.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: INTERNAL_CHUNK,
      select: {
        id: true,
        orderNumber: true,
        createdAt: true,
        status: true,
        currency: true,
        subtotal: true,
        shippingTotal: true,
        total: true,
        shippingAddress: true,
        shipments: {
          select: {
            id: true,
            status: true,
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

    if (!rows.length) break;

    skip += rows.length;
    scanned += rows.length;

    // colectăm productIds doar din chunk-ul curent (și doar dacă avem nevoie)
    const productIdSet = new Set();
    for (const o of rows) {
      for (const s of o.shipments) {
        for (const it of s.items) {
          if (it.productId) productIdSet.add(it.productId);
        }
      }
    }

    let imageMap = new Map();
    if (productIdSet.size) {
      const products = await prisma.product.findMany({
        where: { id: { in: Array.from(productIdSet) } },
        select: { id: true, images: true },
      });

      imageMap = new Map(
        products.map((p) => [p.id, Array.isArray(p.images) && p.images[0] ? p.images[0] : null])
      );
    }

    // map + filtrare uiStatus în memorie
    for (const o of rows) {
      const uiStatus = computeUiStatus(o, o.shipments);
      if (statusList.length && !statusList.includes(uiStatus)) continue;

      // "skip" pentru pagina cerută după filtrare
      if (filteredOffsetToSkip > 0) {
        filteredOffsetToSkip--;
        continue;
      }

      const shippingStage = computeShippingStage(o.shipments);
      const returnEligible = uiStatus === "DELIVERED";

      const { currency, totalCents } = computeTotalsCents(o);

      const addr = o.shippingAddress || {};
      const isCompany = !!(addr.companyName || addr.companyCui);
      const customerType = isCompany ? "PJ" : "PF";

      const flatItems = o.shipments.flatMap((s) =>
        s.items.map((it) => ({
          id: it.id,
          productId: it.productId,
          title: it.title,
          qty: it.qty,
          priceCents: Math.round(Number(it.price || 0) * 100),
          image: it.productId ? imageMap.get(it.productId) || null : null,
          shipmentId: s.id,
        }))
      );

      collected.push({
        id: o.id,
        orderNumber: o.orderNumber || null,
        createdAt: o.createdAt,
        status: uiStatus,
        totalCents,
        currency,
        items: flatItems,
        cancellable: isOrderCancellable(o, o.shipments),
        customerType,
        shippingAddress: addr,
        shippingStage,
        returnEligible,
      });

      if (collected.length >= limit) break;
    }

    if (collected.length >= limit) break;
  }

  // hasMore “real” pentru pagina curentă: dacă am reușit să umplem pagina și încă mai există date în DB,
  // e probabil că există next. Mai corect: mai încercăm să vedem dacă există încă măcar 1 rezultat filtrat după colectare.
  // (nu facem extra query; folosim un heuristic ok)
  const hasMore = collected.length === limit && scanned < totalDb;

  res.json({
    // total: exact doar când nu ai statusList; altfel e best-effort (maxim posibil din DB)
    total: statusList.length ? totalDb : totalDb,
    items: collected,
    hasMore, // extra (front-ul tău nu-l folosește acum, dar e util)
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

  // imagini produse
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

  if (!["PENDING", "PROCESSING"].includes(uiStatus) || !isOrderCancellable(o, o.shipments)) {
    return res.status(400).json({ error: "not_cancellable" });
  }

  await prisma.$transaction([
    prisma.shipment.updateMany({
      where: {
        orderId: o.id,
        status: { in: ["PENDING"] },
      },
      data: { status: "REFUSED" },
    }),
    prisma.order.update({
      where: { id: o.id },
      data: { status: "CANCELLED" },
    }),
  ]);

  // notificări către vendor(i) (best-effort)
  try {
    await sendOrderCancelledByUserNotifications({ orderId: o.id, userId });
  } catch (e) {
    console.error("sendOrderCancelledByUserNotifications failed:", e);
  }

  // email către client (best-effort)
  try {
    const to = o.user?.email || o.shippingAddress?.email || null;
    if (to) await sendOrderCancelledByUserEmail({ to, order: o });
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
    if (!it.productId) continue;
    await prisma.cartItem.upsert({
      where: {
        userId_productId: {
          userId,
          productId: it.productId,
        },
      },
      update: {
        qty: { increment: it.qty },
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
