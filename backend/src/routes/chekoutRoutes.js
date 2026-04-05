import { Router } from "express";
import { prisma } from "../db.js";
import { authRequired } from "../api/auth.js";
import { sendOrderConfirmationEmail } from "../lib/mailer.js";
import { createPaymentForOrder } from "../payments/orchestrator.js";
import { createVendorNotification } from "../services/notifications.js";

const router = Router();
const dec = (n) => Number.parseFloat((Number(n || 0)).toFixed(2));

const normalizeText = (v = "") => String(v || "").trim();
const normalizeDigits = (v = "") => String(v || "").replace(/\D/g, "");
const normalizeCui = (v = "") =>
  String(v || "")
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/[^A-Z0-9]/g, "")
    .trim();

const isValidPhone = (v = "") => {
  const digits = normalizeDigits(v);
  return /^\d{10}$/.test(digits);
};

const isValidEmail = (v = "") => {
  if (!v) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
};

const isValidPostalCode = (v = "") => {
  const trimmed = String(v || "").trim();
  return !trimmed || /^\d{6}$/.test(trimmed);
};

const isValidCui = (v = "") => {
  const cui = normalizeCui(v);

  if (!cui) return false;

  if (cui.startsWith("RO")) {
    return /^RO\d{2,10}$/.test(cui);
  }

  return /^\d{2,10}$/.test(cui);
};

function mapPublicBilling(billing) {
  if (!billing) return null;
  return {
    tvaActive: billing.tvaActive,
    vatRate: billing.vatRate,
    vatStatus: billing.vatStatus,
  };
}

function generateOrderNumber() {
  const t = Date.now().toString(36).toUpperCase();
  const r = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `AF-${t}-${r}`.slice(0, 32);
}

function buildFullName(obj = {}) {
  if (normalizeText(obj.name)) return normalizeText(obj.name);
  return `${normalizeText(obj.lastName)} ${normalizeText(obj.firstName)}`.trim();
}

function buildNormalizedShippingAddress(address) {
  return {
    ...address,
    firstName: normalizeText(address?.firstName),
    lastName: normalizeText(address?.lastName),
    name: buildFullName(address),
    phone: normalizeDigits(address?.phone).slice(0, 10),
    email: normalizeText(address?.email),
    county: address?.county || "",
    city: normalizeText(address?.city),
    postalCode: normalizeText(address?.postalCode),
    street: normalizeText(address?.street),
    notes: normalizeText(address?.notes),
  };
}

function buildNormalizedBillingAddress(billingAddress) {
  if (!billingAddress) return null;

  return {
    ...billingAddress,
    companyName: normalizeText(billingAddress.companyName),
    companyCui: normalizeCui(billingAddress.companyCui),
    companyRegCom: normalizeText(billingAddress.companyRegCom),
    county: billingAddress.county || "",
    city: normalizeText(billingAddress.city),
    postalCode: normalizeText(billingAddress.postalCode),
    street: normalizeText(billingAddress.street),
  };
}

function buildNormalizedContactPerson(contactPerson) {
  if (!contactPerson) return null;

  return {
    ...contactPerson,
    firstName: normalizeText(contactPerson.firstName),
    lastName: normalizeText(contactPerson.lastName),
    name: buildFullName(contactPerson),
    email: normalizeText(contactPerson.email),
    phone: normalizeDigits(contactPerson.phone).slice(0, 10),
  };
}

function validateShippingAddress(address) {
  if (!address) {
    return {
      error: "address_required",
      message: "Adresa de livrare este obligatorie.",
    };
  }

  if (!normalizeText(address.firstName)) {
    return {
      error: "shipping_first_name_required",
      message: "Completează prenumele pentru livrare.",
    };
  }

  if (!normalizeText(address.lastName)) {
    return {
      error: "shipping_last_name_required",
      message: "Completează numele pentru livrare.",
    };
  }

  if (!normalizeText(address.phone)) {
    return {
      error: "phone_required",
      message: "Completează numărul de telefon.",
    };
  }

  if (!isValidPhone(address.phone)) {
    return {
      error: "phone_invalid",
      message: "Numărul de telefon trebuie să conțină exact 10 cifre.",
    };
  }

  if (!normalizeText(address.email)) {
    return {
      error: "email_required",
      message: "Completează adresa de email.",
    };
  }

  if (!isValidEmail(address.email)) {
    return {
      error: "email_invalid",
      message: "Adresa de email nu este validă.",
    };
  }

  if (!address.county) {
    return {
      error: "shipping_county_required",
      message: "Selectează județul pentru livrare.",
    };
  }

  if (!normalizeText(address.city)) {
    return {
      error: "shipping_city_required",
      message: "Completează orașul / localitatea pentru livrare.",
    };
  }

  if (!normalizeText(address.street)) {
    return {
      error: "shipping_street_required",
      message: "Completează strada și numărul pentru livrare.",
    };
  }

  if (!isValidPostalCode(address.postalCode)) {
    return {
      error: "shipping_postal_code_invalid",
      message: "Codul poștal pentru livrare trebuie să aibă exact 6 cifre.",
    };
  }

  return null;
}

function validateBillingCompany(billingAddress) {
  if (!billingAddress) {
    return {
      error: "company_required",
      message: "Datele firmei sunt obligatorii pentru persoană juridică.",
    };
  }

  if (!normalizeText(billingAddress.companyName)) {
    return {
      error: "company_name_required",
      message: "Completează denumirea firmei.",
    };
  }

  if (!normalizeText(billingAddress.companyCui)) {
    return {
      error: "company_cui_required",
      message: "Completează CUI-ul firmei.",
    };
  }

  if (!isValidCui(billingAddress.companyCui)) {
    return {
      error: "company_cui_invalid",
      message: "CUI-ul firmei nu are un format valid.",
    };
  }

  if (!billingAddress.county) {
    return {
      error: "company_county_required",
      message: "Selectează județul sediului firmei.",
    };
  }

  if (!normalizeText(billingAddress.city)) {
    return {
      error: "company_city_required",
      message: "Completează orașul sediului firmei.",
    };
  }

  if (!normalizeText(billingAddress.street)) {
    return {
      error: "company_street_required",
      message: "Completează strada și numărul sediului firmei.",
    };
  }

  if (!isValidPostalCode(billingAddress.postalCode)) {
    return {
      error: "company_postal_code_invalid",
      message: "Codul poștal al sediului firmei trebuie să aibă exact 6 cifre.",
    };
  }

  return null;
}

function validateContactPerson(contactPerson) {
  if (!contactPerson) {
    return {
      error: "contact_required",
      message: "Persoana de contact este obligatorie.",
    };
  }

  if (!normalizeText(contactPerson.firstName)) {
    return {
      error: "contact_first_name_required",
      message: "Completează prenumele persoanei de contact.",
    };
  }

  if (!normalizeText(contactPerson.lastName)) {
    return {
      error: "contact_last_name_required",
      message: "Completează numele persoanei de contact.",
    };
  }

  if (!normalizeText(contactPerson.email)) {
    return {
      error: "contact_email_required",
      message: "Completează emailul persoanei de contact.",
    };
  }

  if (!isValidEmail(contactPerson.email)) {
    return {
      error: "contact_email_invalid",
      message: "Emailul persoanei de contact nu este valid.",
    };
  }

  if (!normalizeText(contactPerson.phone)) {
    return {
      error: "contact_phone_required",
      message: "Completează telefonul persoanei de contact.",
    };
  }

  if (!isValidPhone(contactPerson.phone)) {
    return {
      error: "contact_phone_invalid",
      message:
        "Telefonul persoanei de contact trebuie să conțină exact 10 cifre.",
    };
  }

  return null;
}

/**
 * SUMMARY
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
                  billing: true,
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
      price: Math.round(i.product.priceCents) / 100,
      currency: i.product.currency || currency,
      vendorId,
      vendorBilling,
    };
  });

  const subtotal = dec(mapped.reduce((s, it) => s + it.price * it.qty, 0));
  res.json({ items: mapped, currency, subtotal });
});

/**
 * SHIPPING QUOTE
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
      price: 15,
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
 * QUOTE
 */
router.post("/checkout/quote", authRequired, async (req, res) => {
  const address = buildNormalizedShippingAddress(req.body?.address || {});
  const selections = req.body?.selections || {};

  const shippingError = validateShippingAddress(address);
  if (shippingError) {
    return res.status(400).json(shippingError);
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
    return res.status(400).json({
      error: "cart_empty",
      message: "Coșul este gol.",
    });
  }

  const byVendor = new Map();
  for (const it of cart) {
    const vId = it.product.service?.vendorId;
    if (!vId) continue;
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
 * PLACE
 */
router.post("/checkout/place", authRequired, async (req, res) => {
  const {
    address,
    billingAddress,
    contactPerson,
    selections,
    paymentMethod,
    customerType,
    shipToDifferentAddress,
  } = req.body || {};

  const ctRaw = String(customerType || "").toUpperCase();
  const ct = ctRaw === "PJ" ? "PJ" : "PF";

  const pmRaw = String(paymentMethod || "").toUpperCase();
  const pm = pmRaw === "CARD" ? "CARD" : "COD";

  const normalizedAddress = buildNormalizedShippingAddress(address || {});
  const normalizedBillingAddress =
    ct === "PJ" ? buildNormalizedBillingAddress(billingAddress || {}) : null;
  const normalizedContactPerson =
    ct === "PJ" ? buildNormalizedContactPerson(contactPerson || {}) : null;

  const shippingError = validateShippingAddress(normalizedAddress);
  if (shippingError) {
    return res.status(400).json(shippingError);
  }

  if (ct === "PJ") {
    const companyError = validateBillingCompany(normalizedBillingAddress);
    if (companyError) {
      return res.status(400).json(companyError);
    }

    const contactError = validateContactPerson(normalizedContactPerson);
    if (contactError) {
      return res.status(400).json(contactError);
    }
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
    return res.status(400).json({
      error: "cart_empty",
      message: "Coșul este gol.",
    });
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

  const quote = await quoteShipping({ groups, selections });
  const shippingTotal = dec(quote.totalShipping);
  const total = dec(subtotal + shippingTotal);

  const vendorIds = Array.from(groupsMap.keys()).map(String);

  const vendors = await prisma.vendor.findMany({
    where: { id: { in: vendorIds } },
    select: {
      id: true,
      displayName: true,
      address: true,
      city: true,
    },
  });

  const storeAddresses = {};
  for (const v of vendors) {
    storeAddresses[v.id] = {
      name: v.displayName || "Magazin",
      street: v.address || "",
      city: v.city || "",
      county: normalizedAddress.county || "",
      postalCode: "",
      country: "România",
    };
  }

  const shippingAddressForOrder =
    ct === "PJ" && !shipToDifferentAddress
      ? {
          firstName: normalizedContactPerson?.firstName || "",
          lastName: normalizedContactPerson?.lastName || "",
          name: buildFullName(normalizedContactPerson || {}),
          email: normalizedContactPerson?.email || "",
          phone: normalizedContactPerson?.phone || "",
          county: normalizedBillingAddress?.county || "",
          city: normalizedBillingAddress?.city || "",
          postalCode: normalizedBillingAddress?.postalCode || "",
          street: normalizedBillingAddress?.street || "",
          notes: normalizedAddress?.notes || "",
          companyName: normalizedBillingAddress?.companyName || "",
        }
      : normalizedAddress;

  const created = await prisma.$transaction(async (tx) => {
    const order = await tx.order.create({
      data: {
        orderNumber: generateOrderNumber(),
        userId: req.user.sub,
        status: "PENDING",
        paymentMethod: pm,
        currency,
        subtotal,
        shippingTotal,
        total,
        shippingAddress: shippingAddressForOrder,
        billingAddress: ct === "PJ" ? normalizedBillingAddress : null,
        contactPerson: ct === "PJ" ? normalizedContactPerson : null,
        shipToDifferentAddress: ct === "PJ" ? Boolean(shipToDifferentAddress) : false,
        customerType: ct,
      },
    });

    for (const s of quote.shipments) {
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
        groups.find((g) => String(g.vendorId) === String(s.vendorId))?.items ||
        [];

      if (its.length) {
        await tx.shipmentItem.createMany({
          data: its.map((it) => ({
            shipmentId: sh.id,
            productId: it.productId,
            title: it.title,
            qty: it.qty,
            price: dec(it.price),
          })),
        });
      }
    }

    await tx.cartItem.deleteMany({ where: { userId: req.user.sub } });

    return order;
  });

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

  try {
    await sendOrderConfirmationEmail({
      to: shippingAddressForOrder.email,
      order: created,
      items,
      storeAddresses,
    });
  } catch (err) {
    console.error("Eroare la trimiterea emailului de confirmare:", err);
  }

  if (pm === "COD") {
    return res.json({
      ok: true,
      orderId: created.id,
      orderNumber: created.orderNumber,
    });
  }

  try {
    const payment = await createPaymentForOrder(created);
    return res.json({
      ok: true,
      orderId: created.id,
      orderNumber: created.orderNumber,
      payment,
    });
  } catch (err) {
    console.error("Eroare la inițierea plății pentru comandă:", err);
    return res.status(500).json({
      error: "payment_init_failed",
      message: "Comanda a fost creată, dar inițierea plății a eșuat.",
      orderId: created.id,
      orderNumber: created.orderNumber,
    });
  }
});

export default router;