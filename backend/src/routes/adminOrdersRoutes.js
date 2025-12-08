// src/routes/adminOrdersRoutes.js
import { Router } from "express";
import { prisma } from "../db.js";
import { authRequired, requireRole } from "../api/auth.js";
import { sendOrderConfirmationEmail } from "../lib/mailer.js";

const router = Router();

// doar ADMIN
router.use(authRequired, requireRole("ADMIN"));

/* ----------------------------------------------------
   Helper: computeUiStatus (copiat din userOrdersRoutes)
----------------------------------------------------- */
function computeUiStatus(order, shipments = []) {
  const orderStatus = order?.status || null; // PENDING / PAID / CANCELLED / FULFILLED
  const shipmentStatuses = shipments.map((s) => s.status);

  if (orderStatus === "CANCELLED") return "CANCELED";

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

/* ----------------------------------------------------
   Helper: este anulabilă comanda?
   (la fel ca în userOrders, dar fără filtrul de userId)
----------------------------------------------------- */
function isOrderCancellable(order, shipments = []) {
  const orderStatus = order?.status || null;

  if (["CANCELLED", "FULFILLED"].includes(orderStatus)) return false;

  const hasStartedOrBeyond = shipments.some((s) =>
    [
      "PREPARING",
      "READY_FOR_PICKUP",
      "AWB",
      "IN_TRANSIT",
      "PICKUP_SCHEDULED",
      "DELIVERED",
      "RETURNED",
    ].includes(s.status)
  );

  if (hasStartedOrBeyond) return false;
  return true;
}

/* ----------------------------------------------------
   POST /api/admin/orders/:id/cancel
   Anulează comanda + marchează shipments ca RETURNED
----------------------------------------------------- */
router.post("/orders/:id/cancel", async (req, res) => {
  const id = String(req.params.id);

  try {
    const o = await prisma.order.findFirst({
      where: { id },
      include: { shipments: true },
    });

    if (!o) return res.status(404).json({ error: "not_found" });

    const uiStatus = computeUiStatus(o, o.shipments);
    const cancellable = isOrderCancellable(o, o.shipments);

    // Poți relaxa condițiile dacă vrei ca adminul să poată forța orice
    if (!["PENDING", "PROCESSING"].includes(uiStatus) || !cancellable) {
      return res.status(400).json({
        error: "not_cancellable",
        message:
          "Comanda nu mai poate fi anulată (este deja în livrare sau finalizată).",
      });
    }

    // marcăm shipment-urile active ca RETURNED
    await prisma.shipment.updateMany({
      where: {
        orderId: o.id,
        status: {
          in: [
            "PENDING",
            "PREPARING",
            "READY_FOR_PICKUP",
            "AWB",
            "IN_TRANSIT",
            "PICKUP_SCHEDULED",
          ],
        },
      },
      data: { status: "RETURNED" },
    });

    // marcăm comanda ca anulată
    await prisma.order.update({
      where: { id: o.id },
      data: { status: "CANCELLED" },
    });

    res.json({ ok: true });
  } catch (e) {
    console.error("ADMIN /orders/:id/cancel error", e);
    res.status(500).json({ error: "admin_order_cancel_failed" });
  }
});

/* ----------------------------------------------------
   POST /api/admin/orders/:id/mark-fulfilled
   Marchează comanda ca FULFILLED + shipments DELIVERED
----------------------------------------------------- */
router.post("/orders/:id/mark-fulfilled", async (req, res) => {
  const id = String(req.params.id);

  try {
    const o = await prisma.order.findFirst({
      where: { id },
      include: { shipments: true },
    });

    if (!o) return res.status(404).json({ error: "not_found" });

    if (o.status === "CANCELLED") {
      return res.status(400).json({
        error: "already_cancelled",
        message:
          "Comanda este deja anulată și nu poate fi marcată ca livrată.",
      });
    }

    // toate shipments -> DELIVERED (exceptate already RETURNED/DELIVERED)
    await prisma.shipment.updateMany({
      where: {
        orderId: o.id,
        status: {
          notIn: ["DELIVERED", "RETURNED"],
        },
      },
      data: { status: "DELIVERED" },
    });

    const updated = await prisma.order.update({
      where: { id: o.id },
      data: { status: "FULFILLED" },
      include: { shipments: true },
    });

    res.json({ ok: true, order: updated });
  } catch (e) {
    console.error("ADMIN /orders/:id/mark-fulfilled error", e);
    res.status(500).json({ error: "admin_order_mark_fulfilled_failed" });
  }
});

/* ----------------------------------------------------
   POST /api/admin/orders/:id/resend-confirmation
   Retrimite email de confirmare comandă
----------------------------------------------------- */
router.post("/orders/:id/resend-confirmation", async (req, res) => {
  const id = String(req.params.id);

  try {
    const o = await prisma.order.findFirst({
      where: { id },
      include: {
        shipments: {
          include: { items: true },
        },
        user: {
          select: { email: true },
        },
      },
    });

    if (!o) return res.status(404).json({ error: "not_found" });

    const addr = o.shippingAddress || {};
    const to =
      addr.email || // email din adresă de livrare
      o.user?.email || // fallback user
      null;

    if (!to) {
      return res.status(400).json({
        error: "no_email",
        message:
          "Comanda nu are o adresă de email asociată, nu pot trimite confirmarea.",
      });
    }

    const items = o.shipments.flatMap((s) =>
      s.items.map((it) => ({
        title: it.title,
        qty: it.qty,
        price: Number(it.price || 0),
      }))
    );

    await sendOrderConfirmationEmail({
      to,
      order: o,
      items,
    });

    res.json({ ok: true });
  } catch (e) {
    console.error("ADMIN /orders/:id/resend-confirmation error", e);
    res
      .status(500)
      .json({ error: "admin_order_resend_confirmation_failed" });
  }
});

/* ----------------------------------------------------
   GET /api/admin/orders/:id
   Detalii comandă pentru admin
----------------------------------------------------- */
router.get("/orders/:id", async (req, res) => {
  const id = String(req.params.id);

  try {
    const o = await prisma.order.findFirst({
      where: { id },
      include: {
        user: {
          select: { id: true, email: true },
        },
        shipments: {
          include: {
            vendor: {
              select: {
                id: true,
                displayName: true,
                city: true,
              },
            },
            items: true,
          },
        },
      },
    });

    if (!o) return res.status(404).json({ error: "not_found" });

    const statusUi = computeUiStatus(o, o.shipments);

    res.json({
      ...o,
      uiStatus: statusUi,
    });
  } catch (e) {
    console.error("ADMIN GET /orders/:id error", e);
    res.status(500).json({ error: "admin_order_details_failed" });
  }
});

/* ----------------------------------------------------
   PATCH /api/admin/orders/:id/notes
   Salvează note interne pentru comandă
   Prefix automat: [YYYY-MM-DD | admin@email]
----------------------------------------------------- */
router.patch("/orders/:id/notes", async (req, res) => {
  const id = String(req.params.id);
  const raw = String(req.body?.adminNotes || "");

  try {
    const existing = await prisma.order.findFirst({
      where: { id },
      select: { id: true },
    });

    if (!existing) {
      return res.status(404).json({ error: "not_found" });
    }

    const trimmed = raw.trim();

    let finalNotes = "";

    if (trimmed) {
      const now = new Date();
      const dateStr = now.toISOString().slice(0, 10); // YYYY-MM-DD
      const who = req.user?.email || req.user?.id || "admin";
      const prefix = `[${dateStr} | ${who}] `;
      finalNotes = prefix + trimmed;
    }

    const updated = await prisma.order.update({
      where: { id },
      data: { adminNotes: finalNotes },
      select: {
        id: true,
        adminNotes: true,
      },
    });

    res.json({ ok: true, order: updated });
  } catch (e) {
    console.error("ADMIN PATCH /orders/:id/notes error", e);
    res.status(500).json({ error: "admin_order_notes_failed" });
  }
});

export default router;
