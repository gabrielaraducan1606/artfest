// backend/src/routes/userRoutes.js
import { Router } from "express";
import { prisma } from "../db.js";
import { authRequired, enforceTokenVersion, requireRole } from "../api/auth.js";

const router = Router();

// doar user logat, rol USER (client final)
router.use(authRequired, enforceTokenVersion, requireRole("USER"));

/* ----------------------------------------------------
   Helper: map OrderStatus + ShipmentStatus -> UI status
   UI: PENDING | PROCESSING | SHIPPED | DELIVERED | CANCELED | RETURNED
----------------------------------------------------- */
function computeUiStatus(order, shipments = []) {
  const orderStatus = order?.status || null; // PENDING / PAID / CANCELLED / FULFILLED
  const shipmentStatuses = shipments.map((s) => s.status);

  // 1) dacă order e CANCELLED -> override UI
  if (orderStatus === "CANCELLED") return "CANCELED";

  // 2) dacă avem shipments, derivăm din ele
  if (shipmentStatuses.length) {
    if (shipmentStatuses.every((st) => st === "DELIVERED")) return "DELIVERED";
    if (shipmentStatuses.some((st) => st === "RETURNED")) return "RETURNED";
    if (
      shipmentStatuses.some((st) =>
        ["IN_TRANSIT", "AWB", "PICKUP_SCHEDULED"].includes(st)
      )
    )
      return "SHIPPED";
    if (
      shipmentStatuses.some((st) =>
        ["PREPARING", "READY_FOR_PICKUP"].includes(st)
      )
    )
      return "PROCESSING";
    if (shipmentStatuses.some((st) => st === "PENDING")) return "PENDING";
  }

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

/**
 * GET /api/user/desktop
 * Returnează blocurile necesare pentru pagina de desktop:
 * - comenzi recente
 * - mesaje recente
 * - notificări recente
 * - recenzii recente (produs + magazin)  🔥 NOU
 * - wishlist (Favorite)
 * - recomandări produse
 */
router.get("/desktop", async (req, res) => {
  const userId = req.user.sub;

  try {
    /* -------------------------- COMENZI RECENTE -------------------------- */
    const ordersRaw = await prisma.order.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 5,
      include: {
        shipments: true,
      },
    });

    const orders = ordersRaw.map((o) => {
      const status = computeUiStatus(o, o.shipments);
      const currency = o.currency || "RON";

      const subtotal = Number(o.subtotal || 0);
      const shippingTotal = Number(o.shippingTotal || 0);
      const total = Number(o.total || subtotal + shippingTotal);

      const totalCents = Math.round(total * 100);

      return {
        id: o.id,
        createdAt: o.createdAt,
        status, // PENDING / PROCESSING / SHIPPED / DELIVERED / RETURNED / CANCELED
        totalCents,
        currency,
      };
    });

    /* ----------------------------- MESAJE ----------------------------- */
    const threads = await prisma.messageThread.findMany({
      where: { userId, archivedByUser: false },
      orderBy: [{ lastAt: "desc" }, { createdAt: "desc" }],
      take: 5,
      select: {
        id: true,
        lastMsg: true,
        lastAt: true,
        vendor: { select: { displayName: true } },
        contactName: true,
      },
    });

    const messages = threads.map((t) => ({
      id: t.id,
      from: t.vendor?.displayName || t.contactName || "Vendor",
      preview: t.lastMsg || "",
      createdAt: t.lastAt,
      href: `/mesaje/${t.id}`,
    }));

    /* --------------------------- NOTIFICĂRI --------------------------- */
    // IMPORTANT: structură compatibilă cu /api/notifications (items)
    const notificationsRaw = await prisma.notification.findMany({
      where: { userId, archived: false }, // pe desktop afișăm doar ne-arhivate
      orderBy: { createdAt: "desc" },
      take: 5, // doar ultimele 5 pentru summary
      select: {
        id: true,
        type: true,
        title: true,
        body: true,
        link: true,
        readAt: true,
        archived: true,
        createdAt: true,
      },
    });

    const notifications = notificationsRaw.map((n) => ({
      id: n.id,
      type: n.type,
      title: n.title,
      body: n.body,
      // câmpul „oficial” ca în /api/notifications
      link: n.link,
      readAt: n.readAt,
      archived: n.archived,
      createdAt: n.createdAt,
      // câmp suplimentar pentru compatibilitate cu desktop
      href: n.link || null,
    }));

    /* --------------------------- RECENZII RECENTE (USER) --------------------------- */
    let reviews = [];
    try {
      // luăm ultimele recenzii de PRODUS ale userului
      const productReviews = await prisma.review.findMany({
        where: { userId }, // dacă vrei doar APPROVED: { userId, status: "APPROVED" }
        orderBy: { createdAt: "desc" },
        take: 20, // luăm mai multe ca să putem combina cu storeReviews
        include: {
          product: {
            select: {
              id: true,
              title: true,
              images: true,
            },
          },
        },
      });

      // luăm ultimele recenzii de MAGAZIN ale userului
      const storeReviews = await prisma.storeReview.findMany({
        where: { userId, status: "APPROVED" },
        orderBy: { createdAt: "desc" },
        take: 20,
        include: {
          vendor: {
            select: {
              id: true,
              displayName: true,
            },
          },
        },
      });

      const mappedProductReviews = productReviews.map((r) => ({
        id: r.id,
        itemId: r.productId,
        kind: "product",
        productUrl: `/produs/${r.productId}`,
        targetUrl: `/produs/${r.productId}`,
        productTitle: r.product?.title || "Produs",
        title: r.product?.title || "Produs",
        image:
          Array.isArray(r.product?.images) && r.product.images[0]
            ? r.product.images[0]
            : null,
        rating: r.rating,
        text: r.comment || "",
        createdAt: r.createdAt,
      }));

      const mappedStoreReviews = storeReviews.map((r) => ({
        id: r.id,
        itemId: r.vendorId,
        kind: "store",
        productUrl: null,
        targetUrl: `/magazin/${r.vendorId}`,
        productTitle: r.vendor?.displayName || "Magazin",
        title: r.vendor?.displayName || "Magazin",
        image: null,
        rating: r.rating,
        text: r.comment || "",
        createdAt: r.createdAt,
      }));

      reviews = [...mappedProductReviews, ...mappedStoreReviews]
        .sort(
          (a, b) =>
            new Date(b.createdAt).getTime() -
            new Date(a.createdAt).getTime()
        )
        .slice(0, 5); // doar ultimele 5 pentru dashboard
    } catch (e) {
      console.warn("User desktop reviews summary failed:", e);
    }

    /* ----------------------------- WISHLIST ---------------------------- */
    // Folosim Favorite -> Product (dorințe)
    let wishlist = [];
    try {
      const favorites = await prisma.favorite.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        take: 6,
        select: {
          product: {
            select: {
              id: true,
              title: true,
              priceCents: true,
              currency: true,
              images: true,
            },
          },
        },
      });

      wishlist = favorites
        .filter((f) => !!f.product)
        .map((f) => ({
          id: f.product.id,
          title: f.product.title,
          priceCents: f.product.priceCents || 0,
          currency: f.product.currency || "RON",
          image:
            Array.isArray(f.product.images) && f.product.images[0]
              ? f.product.images[0]
              : null,
        }));
    } catch (e) {
      console.warn("Wishlist summary failed:", e);
    }

    /* --------------------------- RECOMANDĂRI --------------------------- */
    let recs = [];
    try {
      const recProducts = await prisma.product.findMany({
        where: {
          isActive: true,
          isHidden: false,
        },
        orderBy: [{ popularityScore: "desc" }, { createdAt: "desc" }],
        take: 8,
        select: {
          id: true,
          title: true,
        },
      });

      recs = recProducts.map((p) => ({
        id: p.id,
        title: p.title,
        tag: "produs",
        href: `/produs/${p.id}`,
      }));
    } catch (e) {
      console.warn("Recommendations summary failed:", e);
    }

    return res.json({
      orders,
      messages,
      notifications,
      reviews,    // 🔥 acum /api/user/desktop trimite și recenziile recente
      wishlist,
      recs,
    });
  } catch (e) {
    console.error("GET /api/user/desktop failed:", e);
    return res.status(500).json({ error: "server_error" });
  }
});

export default router;
