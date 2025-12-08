// backend/src/routes/checkoutRoutes.js
import { Router } from "express";
import { prisma } from "../db.js";
import { authRequired } from "../api/auth.js";
import { sendOrderConfirmationEmail } from "../lib/mailer.js";
import { createPaymentForOrder } from "../payments/orchestrator.js";
import { createVendorNotification } from "../services/notifications.js";

const router = Router();
const dec = (n) => Number.parseFloat((Number(n || 0)).toFixed(2));

const normalizeDigits = (v = "") => String(v).replace(/\D/g, "");

const isValidPhone = (v = "") => {
  const digits = normalizeDigits(v);
  // simplu: 10 cifre, format românesc de bază
  return /^\d{10}$/.test(digits);
};

const isValidEmail = (v = "") => {
  if (!v) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
};

// 🔹 helper mic – exact ca în publicProductRoutes, dar local aici
function mapPublicBilling(billing) {
  if (!billing) return null;
  return {
    tvaActive: billing.tvaActive,
    vatRate: billing.vatRate, // "19", "9", "5", "0"
    vatStatus: billing.vatStatus, // "payer" | "non_payer"
  };
}

/**
 * SUMMARY: items + subtotal (include thumb, vendorId, vendorBilling)
 */
router.get("/checkout/summary", authRequired, async (req, res) => {
  const items = await prisma.cartItem.findMany({
    where: { userId: req.user.sub },
    include: {
      product: {
        select: {
          id: true,
          title: true,
          images: true,
          priceCents: true,
          currency: true,
          service: {
            select: {
              vendorId: true,
              vendor: {
                select: {
                  billing: true, // 🔹 aici luăm TVA-ul vendorului
                },
              },
            },
          },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  if (!items.length) {
    return res.json({ items: [], currency: "RON", subtotal: 0 });
  }

  const currency = items[0]?.product?.currency || "RON";

  const mapped = items.map((i) => {
    const service = i.product.service;
    const vendorId = service?.vendorId || null;
    const vendorBilling = service?.vendor?.billing
      ? mapPublicBilling(service.vendor.billing)
      : null;

    return {
      productId: i.productId,
      title: i.product.title,
      image:
        Array.isArray(i.product.images) && i.product.images[0]
          ? i.product.images[0]
          : null,
      qty: i.qty,
      price: Math.round(i.product.priceCents) / 100, // preț BRUT (cu TVA dacă e plătitor)
      currency: i.product.currency || currency,
      vendorId,
      vendorBilling, // 🔹 TVA per vendor pentru front
    };
  });

  const subtotal = dec(mapped.reduce((s, it) => s + it.price * it.qty, 0));

  res.json({ items: mapped, currency, subtotal });
});

/**
 * SHIPPING QUOTE:
 * - 15 RON standard per vendor (indiferent de curier/locker)
 * - selecțiile (COURIER / LOCKER) doar influențează metoda
 */
async function quoteShipping({ groups, selections }) {
  const shipments = groups.map((g) => {
    const key = String(g.vendorId);
    const sel = selections?.[key] || { method: "COURIER" };
    const method = sel.method === "LOCKER" ? "LOCKER" : "COURIER";

    return {
      vendorId: g.vendorId,
      method,
      lockerId: method === "LOCKER" ? sel.lockerId || null : null,
      price: 15, // transport fix per vendor
    };
  });

  const totalShipping = dec(shipments.reduce((s, x) => s + x.price, 0));

  return {
    shipments,
    totalShipping,
    currency: "RON",
  };
}

/**
 * QUOTE: calculează livrarea per vendor + selecții
 * POST /api/checkout/quote
 */
router.post("/checkout/quote", authRequired, async (req, res) => {
  const address = req.body?.address || {};
  const selections = req.body?.selections || {};

  // frontend trimite firstName, lastName, email, phone etc.
  if (
    !address?.firstName ||
    !address?.lastName ||
    !address?.phone ||
    !address?.email ||
    !address?.county ||
    !address?.city ||
    !address?.street
  ) {
    return res.status(400).json({
      error: "address_invalid",
      message:
        "Completează nume, prenume, telefon, email, județ, oraș și stradă.",
    });
  }

  if (!isValidPhone(address.phone)) {
    return res.status(400).json({
      error: "phone_invalid",
      message: "Numărul de telefon trebuie să conțină 10 cifre.",
    });
  }

  if (!isValidEmail(address.email)) {
    return res.status(400).json({
      error: "email_invalid",
      message: "Adresa de email nu este validă.",
    });
  }

  if (!address.name) {
    address.name = `${address.lastName} ${address.firstName}`.trim();
  }

  const cart = await prisma.cartItem.findMany({
    where: { userId: req.user.sub },
    include: {
      product: {
        select: {
          id: true,
          title: true,
          priceCents: true,
          currency: true,
          service: { select: { vendorId: true } },
        },
      },
    },
  });

  if (!cart.length) {
    console.warn("checkout/quote: cart_empty for user", req.user.sub);
    return res.status(400).json({ error: "cart_empty" });
  }

  // grupăm produsele pe vendorId
  const byVendor = new Map();
  for (const it of cart) {
    const vId = it.product.service?.vendorId;
    if (!vId) continue; // safety: fără vendor, nu includem
    if (!byVendor.has(vId)) byVendor.set(vId, []);
    byVendor.get(vId).push({
      productId: it.productId,
      title: it.product.title,
      qty: it.qty,
      price: Math.round(it.product.priceCents) / 100,
      currency: it.product.currency || "RON",
    });
  }

  const groups = Array.from(byVendor.entries()).map(([vendorId, items]) => ({
    vendorId,
    items,
  }));

  const q = await quoteShipping({ groups, selections });

  const quoteId = `q_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  res.json({ id: quoteId, ...q });
});

/**
 * PLACE: creează Order + Shipments per vendor, golește coșul
 * POST /api/checkout/place
 */
router.post("/checkout/place", authRequired, async (req, res) => {
  const { address, selections, paymentMethod, customerType } = req.body || {};

  if (!address) {
    return res.status(400).json({ error: "address_required" });
  }

  if (
    !address?.firstName ||
    !address?.lastName ||
    !address?.phone ||
    !address?.email ||
    !address?.county ||
    !address?.city ||
    !address?.street
  ) {
    return res.status(400).json({
      error: "address_invalid",
      message:
        "Completează nume, prenume, telefon, email, județ, oraș și stradă.",
    });
  }

  if (!isValidPhone(address.phone)) {
    return res.status(400).json({
      error: "phone_invalid",
      message: "Numărul de telefon trebuie să conțină 10 cifre.",
    });
  }

  if (!isValidEmail(address.email)) {
    return res.status(400).json({
      error: "email_invalid",
      message: "Adresa de email nu este validă.",
    });
  }

  // nume complet pentru AWB etc.
  if (!address.name) {
    address.name = `${address.lastName} ${address.firstName}`.trim();
  }

  // Tip client (PF / PJ) – fallback PF
  const ctRaw = String(customerType || "").toUpperCase();
  const ct = ctRaw === "PJ" ? "PJ" : "PF";

  // Validare minimă pentru persoană juridică
  if (ct === "PJ") {
    if (!address.companyName || !address.companyCui) {
      return res.status(400).json({
        error: "company_invalid",
        message:
          "Pentru persoană juridică, completează denumirea firmei și CUI-ul.",
      });
    }
  }

  // validăm metoda de plată (default COD)
  const pmRaw = String(paymentMethod || "").toUpperCase();
  const pm = pmRaw === "CARD" ? "CARD" : "COD";

  const cart = await prisma.cartItem.findMany({
    where: { userId: req.user.sub },
    include: {
      product: {
        select: {
          id: true,
          title: true,
          priceCents: true,
          currency: true,
          service: { select: { vendorId: true } },
        },
      },
    },
  });

  if (!cart.length) {
    console.warn("checkout/place: cart_empty for user", req.user.sub);
    return res.status(400).json({ error: "cart_empty" });
  }

  const currency = cart[0]?.product?.currency || "RON";

  const items = cart.map((i) => ({
    productId: i.productId,
    title: i.product.title,
    qty: i.qty,
    price: Math.round(i.product.priceCents) / 100,
    vendorId: i.product.service?.vendorId || null,
  }));

  const subtotal = dec(items.reduce((s, it) => s + it.price * it.qty, 0));

  // grupăm item-urile per vendor
  const groupsMap = new Map();
  for (const it of items) {
    if (!it.vendorId) continue;
    if (!groupsMap.has(it.vendorId)) groupsMap.set(it.vendorId, []);
    groupsMap.get(it.vendorId).push(it);
  }

  const groups = Array.from(groupsMap.entries()).map(([vendorId, its]) => ({
    vendorId,
    items: its,
  }));

  // calculăm quote în backend (nu ne bazăm pe frontend)
  const quote = await quoteShipping({ groups, selections });
  const shippingTotal = dec(quote.totalShipping);
  const total = dec(subtotal + shippingTotal);

  // 👇 ADĂUGAT: pregătim adresele magazinelor (retur) pentru mail
  const vendorIds = Array.from(groupsMap.keys()).map(String);

  const vendors = await prisma.vendor.findMany({
    where: { id: { in: vendorIds } },
    select: {
      id: true,
      displayName: true,
      address: true,
      city: true,
      // dacă mai târziu adaugi country/postalCode pe Vendor, le poți selecta aici
    },
  });

  const storeAddresses = {};
  for (const v of vendors) {
    storeAddresses[v.id] = {
      name: v.displayName || "Magazin",
      street: v.address || "",
      city: v.city || "",
      county: address.county || "",
      postalCode: "", // dacă adaugi postalCode pe Vendor, actualizezi aici
      country: "România",
    };
  }

  const created = await prisma.$transaction(async (tx) => {
    // 1) Order
    const order = await tx.order.create({
      data: {
        userId: req.user.sub,
        status: "PENDING",
        paymentMethod: pm, // "COD" sau "CARD"
        currency,
        subtotal,
        shippingTotal,
        total,
        shippingAddress: address, // JSON cu PF/PJ + date firmă
        customerType: ct, // enum CustomerType (PF / PJ)
        // ❌ fără meta aici – modelul Order nu are câmp meta
      },
    });

    // 2) Shipments per vendor
    for (const s of quote.shipments) {
      // siguranță: vendorId trebuie să fie string valid
      if (!s.vendorId) continue;

      const sh = await tx.shipment.create({
        data: {
          orderId: order.id,
          vendorId: String(s.vendorId),
          method: s.method === "LOCKER" ? "LOCKER" : "COURIER",
          lockerId: s.lockerId || null,
          price: dec(s.price),
          status: "PENDING",
        },
      });

      const its =
        groups.find((g) => String(g.vendorId) === String(s.vendorId))
          ?.items || [];

      if (its.length) {
        await tx.shipmentItem.createMany({
          data: its.map((it) => ({
            shipmentId: sh.id,
            productId: it.productId,
            title: it.title,
            qty: it.qty,
            price: dec(it.price), // preț unitar la momentul comenzii
          })),
        });
      }
    }

    // 3) golește coșul
    await tx.cartItem.deleteMany({ where: { userId: req.user.sub } });

    return order;
  });

  // 🔔 Notificări pentru vendorii implicați în comandă
  try {
    const shipments = await prisma.shipment.findMany({
      where: { orderId: created.id },
    });

    const addr = created.shippingAddress || {};
    const customerName =
      addr.name ||
      `${addr.lastName || ""} ${addr.firstName || ""}`.trim() ||
      "Client";

    await Promise.all(
      shipments.map(async (s) => {
        const shortId = s.id.slice(-6).toUpperCase();

        const itemsForVendor = items.filter(
          (it) => String(it.vendorId) === String(s.vendorId)
        );
        const subtotalVendor = dec(
          itemsForVendor.reduce((sum, it) => sum + it.price * it.qty, 0)
        );
        const totalVendor = dec(subtotalVendor + Number(s.price || 0));

        await createVendorNotification(s.vendorId, {
          type: "order",
          title: `Comandă nouă (#${shortId})`,
          body: `${customerName} a plasat o comandă – total ${totalVendor.toFixed(
            2
          )} ${created.currency || "RON"}.`,
          link: `/vendor/orders`,
        });
      })
    );
  } catch (err) {
    console.error("Nu am putut crea notificările pentru vendor:", err);
  }

  // email de confirmare — acum cu storeAddresses
  try {
    await sendOrderConfirmationEmail({
      to: address.email,
      order: created,
      items,
      storeAddresses,
    });
  } catch (err) {
    console.error(
      "Eroare la trimiterea emailului de confirmare:",
      err
    );
  }

  // COD: finalizăm direct
  if (pm === "COD") {
    return res.json({ ok: true, orderId: created.id });
  }

  // CARD: inițiem plata și trimitem redirectUrl la FE
  try {
    const payment = await createPaymentForOrder(created);
    return res.json({
      ok: true,
      orderId: created.id,
      payment,
    });
  } catch (err) {
    console.error("Eroare la inițierea plății pentru comandă:", err);
    return res.status(500).json({
      error: "payment_init_failed",
      message: "Comanda a fost creată, dar inițierea plății a eșuat.",
      orderId: created.id,
    });
  }
});

export default router;
