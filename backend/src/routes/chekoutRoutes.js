import { Router } from "express";
import { prisma } from "../db.js";
import { authRequired } from "../api/auth.js";
import { sendOrderConfirmationEmail } from "../lib/mailer.js";
import { createPaymentForOrder } from "../payments/orchestrator.js";
import {
  createVendorNotification,
  notifyVendorOnProductSoldOut,
} from "../services/notifications.js";

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
 * Construiește grupurile de checkout pe service (magazin)
 */
function buildCheckoutGroups(cart) {
  const map = new Map();

  for (const it of cart) {
    const service = it.product?.service;
    const serviceId = service?.id || null;
    const vendorId = service?.vendorId || null;

    if (!serviceId || !vendorId) continue;

    if (!map.has(serviceId)) {
      map.set(serviceId, {
        serviceId,
        vendorId,
        serviceTitle: service?.title || "",
        estimatedShippingFeeCents:
          service?.estimatedShippingFeeCents != null
            ? Number(service.estimatedShippingFeeCents)
            : null,
        freeShippingThresholdCents:
          service?.freeShippingThresholdCents != null
            ? Number(service.freeShippingThresholdCents)
            : null,
        shippingNotes: service?.shippingNotes || null,
        items: [],
      });
    }

    map.get(serviceId).items.push({
      productId: it.productId,
      title: it.product.title,
      qty: Number(it.qty || 0),
      price: Math.round(Number(it.product.priceCents || 0)) / 100,
      currency: it.product.currency || "RON",
      vendorId,
      serviceId,
    });
  }

  return Array.from(map.values());
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
              id: true,
              title: true,
              vendorId: true,
              estimatedShippingFeeCents: true,
              freeShippingThresholdCents: true,
              shippingNotes: true,
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
    return res.json({
      items: [],
      groups: [],
      currency: "RON",
      subtotal: 0,
    });
  }

  const currency = items[0]?.product?.currency || "RON";

  const mapped = items.map((i) => {
    const service = i.product.service;
    const vendorId = service?.vendorId || null;
    const serviceId = service?.id || null;
    const vendorBilling = service?.vendor?.billing
      ? mapPublicBilling(service.vendor.billing)
      : null;

    return {
      productId: i.productId,
      serviceId,
      vendorId,
      title: i.product.title,
      image:
        Array.isArray(i.product.images) && i.product.images[0]
          ? i.product.images[0]
          : null,
      qty: i.qty,
      price: Math.round(i.product.priceCents) / 100,
      currency: i.product.currency || currency,
      vendorBilling,
      estimatedShippingFee:
        service?.estimatedShippingFeeCents != null
          ? dec(Number(service.estimatedShippingFeeCents) / 100)
          : null,
      freeShippingThreshold:
        service?.freeShippingThresholdCents != null
          ? dec(Number(service.freeShippingThresholdCents) / 100)
          : null,
      shippingNotes: service?.shippingNotes || null,
    };
  });

  const groups = buildCheckoutGroups(items).map((g) => ({
    serviceId: g.serviceId,
    vendorId: g.vendorId,
    serviceTitle: g.serviceTitle,
    estimatedShippingFee:
      g.estimatedShippingFeeCents != null
        ? dec(g.estimatedShippingFeeCents / 100)
        : null,
    freeShippingThreshold:
      g.freeShippingThresholdCents != null
        ? dec(g.freeShippingThresholdCents / 100)
        : null,
    shippingNotes: g.shippingNotes || null,
    subtotal: dec(
      g.items.reduce(
        (sum, it) => sum + Number(it.price || 0) * Number(it.qty || 0),
        0
      )
    ),
    items: g.items,
  }));

  const subtotal = dec(mapped.reduce((s, it) => s + it.price * it.qty, 0));

  res.json({
    items: mapped,
    groups,
    currency,
    subtotal,
  });
});

/**
 * SHIPPING QUOTE
 */
async function quoteShipping({ groups, selections }) {
  const shipments = groups.map((g) => {
    const key = String(g.serviceId);
    const sel = selections?.[key] || { method: "COURIER" };
    const method = sel.method === "LOCKER" ? "LOCKER" : "COURIER";

    const estimatedShippingFeeCents =
      g.estimatedShippingFeeCents != null
        ? Number(g.estimatedShippingFeeCents)
        : 0;

    const freeShippingThresholdCents =
      g.freeShippingThresholdCents != null
        ? Number(g.freeShippingThresholdCents)
        : null;

    const vendorSubtotalCents = g.items.reduce(
      (sum, it) =>
        sum + Math.round(Number(it.price || 0) * 100) * Number(it.qty || 0),
      0
    );

    const qualifiesFreeShipping =
      freeShippingThresholdCents != null &&
      vendorSubtotalCents >= freeShippingThresholdCents;

    const finalShippingCents = qualifiesFreeShipping
      ? 0
      : estimatedShippingFeeCents;

    return {
      serviceId: g.serviceId,
      vendorId: g.vendorId,
      method,
      lockerId: method === "LOCKER" ? sel.lockerId || null : null,
      price: dec(finalShippingCents / 100),
      estimatedShippingFee: dec(estimatedShippingFeeCents / 100),
      freeShippingThreshold:
        freeShippingThresholdCents != null
          ? dec(freeShippingThresholdCents / 100)
          : null,
      shippingNotes: g.shippingNotes || null,
      qualifiesFreeShipping,
      vendorSubtotal: dec(vendorSubtotalCents / 100),
    };
  });

  const totalShipping = dec(
    shipments.reduce((s, x) => s + Number(x.price || 0), 0)
  );

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
          service: {
            select: {
              id: true,
              title: true,
              vendorId: true,
              estimatedShippingFeeCents: true,
              freeShippingThresholdCents: true,
              shippingNotes: true,
            },
          },
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

  const groups = buildCheckoutGroups(cart);
  const q = await quoteShipping({ groups, selections });

  const quoteId = `q_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  res.json({ id: quoteId, ...q });
});

/**
 * PLACE
 */
/**
 * PLACE
 */
router.post("/checkout/place", authRequired, async (req, res) => {
  const soldOutProductIds = [];

  try {
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
    if (shippingError) return res.status(400).json(shippingError);

    if (ct === "PJ") {
      const companyError = validateBillingCompany(normalizedBillingAddress);
      if (companyError) return res.status(400).json(companyError);

      const contactError = validateContactPerson(normalizedContactPerson);
      if (contactError) return res.status(400).json(contactError);
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
            availability: true,
            readyQty: true,
            isActive: true,
            isHidden: true,
            moderationStatus: true,
            service: {
              select: {
                id: true,
                title: true,
                vendorId: true,
                estimatedShippingFeeCents: true,
                freeShippingThresholdCents: true,
                shippingNotes: true,
              },
            },
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
      serviceId: i.product.service?.id || null,
    }));

    const subtotal = dec(items.reduce((s, it) => s + it.price * it.qty, 0));

    const groups = buildCheckoutGroups(cart);
    const quote = await quoteShipping({ groups, selections: selections || {} });
    const shippingTotal = dec(quote.totalShipping);
    const total = dec(subtotal + shippingTotal);

    const vendorIds = [
      ...new Set(groups.map((g) => String(g.vendorId)).filter(Boolean)),
    ];

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
      for (const item of cart) {
        const productId = item.productId;
        const qty = Number(item.qty || 0);

        if (!productId || qty <= 0) continue;

        const product = await tx.product.findUnique({
          where: { id: productId },
          select: {
            id: true,
            title: true,
            availability: true,
            readyQty: true,
            isActive: true,
            isHidden: true,
            moderationStatus: true,
          },
        });

        if (!product) throw new Error("product_not_found");

        if (
          product.isActive === false ||
          product.isHidden === true ||
          product.moderationStatus !== "APPROVED"
        ) {
          throw new Error("product_unavailable");
        }

        const availability = String(product.availability || "READY").toUpperCase();

        if (availability === "SOLD_OUT") {
          throw new Error("product_sold_out");
        }

        if (availability === "READY" && product.readyQty !== null) {
          const currentQty = Number(product.readyQty);

          if (!Number.isFinite(currentQty) || currentQty < qty) {
            throw new Error("insufficient_stock");
          }

          const nextQty = currentQty - qty;

          const updatedStock = await tx.product.updateMany({
            where: {
              id: productId,
              readyQty: { gte: qty },
              isActive: true,
              isHidden: false,
              moderationStatus: "APPROVED",
              availability: "READY",
            },
            data: {
              readyQty: { decrement: qty },
              availability: nextQty <= 0 ? "SOLD_OUT" : "READY",
            },
          });

          if (updatedStock.count !== 1) {
            throw new Error("insufficient_stock");
          }

          if (nextQty <= 0) {
            soldOutProductIds.push(productId);
          }
        }
      }

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
          shipToDifferentAddress:
            ct === "PJ" ? Boolean(shipToDifferentAddress) : false,
          customerType: ct,
        },
      });

      for (const s of quote.shipments) {
        if (!s.vendorId) continue;

        const sh = await tx.shipment.create({
          data: {
            orderId: order.id,
            vendorId: String(s.vendorId),
            serviceId: s.serviceId ? String(s.serviceId) : null,
            method: s.method === "LOCKER" ? "LOCKER" : "COURIER",
            lockerId: s.lockerId || null,
            price: dec(s.price),
            status: "PENDING",
          },
        });

        const its =
          groups.find((g) => String(g.serviceId) === String(s.serviceId))
            ?.items || [];

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
      await Promise.all(
        [...new Set(soldOutProductIds)].map((productId) =>
          notifyVendorOnProductSoldOut(productId)
        )
      );
    } catch (err) {
      console.error("Nu am putut trimite notificările pentru produse epuizate:", err);
    }

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
  } catch (err) {
    console.error("Eroare la plasarea comenzii:", err);

    if (err?.message === "insufficient_stock") {
      return res.status(409).json({
        error: "insufficient_stock",
        message: "Un produs din coș nu mai are stoc suficient.",
      });
    }

    if (err?.message === "product_sold_out") {
      return res.status(409).json({
        error: "product_sold_out",
        message: "Un produs din coș este epuizat.",
      });
    }

    if (err?.message === "product_unavailable") {
      return res.status(409).json({
        error: "product_unavailable",
        message: "Un produs din coș nu mai este disponibil.",
      });
    }

    if (err?.message === "product_not_found") {
      return res.status(404).json({
        error: "product_not_found",
        message: "Un produs din coș nu mai există.",
      });
    }

    return res.status(500).json({
      error: "order_place_failed",
      message: "Nu am putut plasa comanda.",
    });
  }
});

export default router;