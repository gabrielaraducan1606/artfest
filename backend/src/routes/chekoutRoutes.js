import { Router } from "express";
import crypto from "crypto";
import { prisma } from "../db.js";
import { authRequired } from "../api/auth.js";
import {
  sendOrderConfirmationEmail,
  sendVendorNewOrderEmail,
} from "../lib/mailer.js";
import { createPaymentForOrder } from "../payments/orchestrator.js";
import {
  createVendorNotification,
  notifyVendorOnProductSoldOut,
} from "../services/notifications.js";

const router = Router();
const dec = (n) => Number.parseFloat((Number(n || 0)).toFixed(2));

function isCollectionPromoActive(collection, now = new Date()) {
  if (!collection?.promoEnabled) return false;

  const percent = Number(collection.promoPercent || 0);
  if (!Number.isFinite(percent) || percent <= 0) return false;

  if (collection.promoStartsAt && new Date(collection.promoStartsAt) > now) {
    return false;
  }

  if (collection.promoEndsAt && new Date(collection.promoEndsAt) < now) {
    return false;
  }

  return true;
}

function productMatchesCollectionRules(product, rules = {}) {
  if (!product) return false;

  if (Array.isArray(rules.categories) && rules.categories.length) {
    if (!rules.categories.includes(product.category)) return false;
  }

  if (rules.acceptsCustom === true && product.acceptsCustom !== true) {
    return false;
  }

  const minPriceCents = Number(rules.minPriceCents);
  const maxPriceCents = Number(rules.maxPriceCents);

  if (Number.isFinite(minPriceCents) && product.priceCents < minPriceCents) {
    return false;
  }

  if (Number.isFinite(maxPriceCents) && product.priceCents > maxPriceCents) {
    return false;
  }

  if (Array.isArray(rules.occasionTags) && rules.occasionTags.length) {
    const tags = Array.isArray(product.occasionTags) ? product.occasionTags : [];
    if (!rules.occasionTags.some((tag) => tags.includes(String(tag)))) {
      return false;
    }
  }

  if (Array.isArray(rules.styleTags) && rules.styleTags.length) {
    const tags = Array.isArray(product.styleTags) ? product.styleTags : [];
    if (!rules.styleTags.some((tag) => tags.includes(String(tag)))) {
      return false;
    }
  }

  return true;
}

function getPromoPrice(priceCents, promo = null) {
  const originalPriceCents = Math.round(Number(priceCents || 0));

  if (!promo) {
    return {
      originalPriceCents,
      finalPriceCents: originalPriceCents,
      hasDiscount: false,
      discountPercent: 0,
      promoLabel: null,
      promoFundingSource: null,
      promoCollectionId: null,
    };
  }

  const discountPercent = Number(promo.promoPercent || 0);

  const finalPriceCents = Math.max(
    0,
    Math.round(originalPriceCents * (1 - discountPercent / 100))
  );

  return {
    originalPriceCents,
    finalPriceCents,
    hasDiscount: true,
    discountPercent,
    promoLabel: promo.promoLabel || "Promoție Artfest",
    promoFundingSource: promo.promoFundingSource || "PLATFORM_COMMISSION",
    promoCollectionId: promo.id || null,
  };
}

async function getActiveCollectionPromosForProducts(products = []) {
  if (!products.length) return new Map();

  const now = new Date();

  const collections = await prisma.collection.findMany({
    where: {
      isActive: true,
      promoEnabled: true,
      OR: [{ promoStartsAt: null }, { promoStartsAt: { lte: now } }],
      AND: [
        {
          OR: [{ promoEndsAt: null }, { promoEndsAt: { gte: now } }],
        },
      ],
    },
    select: {
      id: true,
      rules: true,
      promoEnabled: true,
      promoPercent: true,
      promoLabel: true,
      promoFundingSource: true,
      promoStartsAt: true,
      promoEndsAt: true,
    },
  });

  const activePromos = collections.filter((c) =>
    isCollectionPromoActive(c, now)
  );

  const promoByProductId = new Map();

  for (const product of products) {
    const matchingPromos = activePromos.filter((collection) =>
      productMatchesCollectionRules(product, collection.rules || {})
    );

    if (!matchingPromos.length) continue;

    matchingPromos.sort(
      (a, b) => Number(b.promoPercent || 0) - Number(a.promoPercent || 0)
    );

    promoByProductId.set(product.id, matchingPromos[0]);
  }

  return promoByProductId;
}

function mapCartItemForCheckout(it, promoCollection = null) {
  const promo = getPromoPrice(it.product?.priceCents, promoCollection);

  return {
    productId: it.productId,
    title: it.product?.title || "Produs",
    qty: Number(it.qty || 0),

    selectedOptions: it.selectedOptions || {},
    customAnswers: it.customAnswers || {},
    configurationKey: it.configurationKey || "default",

    price: dec(promo.finalPriceCents / 100),

    originalPrice: promo.hasDiscount
      ? dec(promo.originalPriceCents / 100)
      : null,

    hasDiscount: promo.hasDiscount,
    discountPercent: promo.discountPercent,
    promoLabel: promo.promoLabel,
    promoFundingSource: promo.promoFundingSource,
    promoCollectionId: promo.promoCollectionId,

    currency: it.product?.currency || "RON",
    vendorId: it.product?.service?.vendorId || null,
    serviceId: it.product?.service?.id || null,
    category: it.product?.category || null,
  };
}

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

function generateGuestAccessToken() {
  const token = crypto.randomBytes(32).toString("hex");

  const tokenHash = crypto
    .createHash("sha256")
    .update(token)
    .digest("hex");

  return {
    token,
    tokenHash,
  };
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

async function getGuestCart(rawItems = []) {
  if (!Array.isArray(rawItems)) {
    return [];
  }

  const normalizedItems = [];
  const itemsByConfiguration = new Map();

  for (const rawItem of rawItems) {
    const productId = normalizeText(rawItem?.productId);

    if (!productId) {
      continue;
    }

    const qty = Math.min(
      99,
      Math.max(1, Number.parseInt(rawItem?.qty, 10) || 1)
    );

    const selectedOptions =
      rawItem?.selectedOptions &&
      typeof rawItem.selectedOptions === "object" &&
      !Array.isArray(rawItem.selectedOptions)
        ? rawItem.selectedOptions
        : {};

    const customAnswers =
      rawItem?.customAnswers &&
      typeof rawItem.customAnswers === "object" &&
      !Array.isArray(rawItem.customAnswers)
        ? rawItem.customAnswers
        : {};

    const configurationKey =
      normalizeText(rawItem?.configurationKey) || "default";

    const itemKey = `${productId}:${configurationKey}`;

    const existing = itemsByConfiguration.get(itemKey);

    if (existing) {
      existing.qty = Math.min(99, existing.qty + qty);
    } else {
      const item = {
        productId,
        qty,
        selectedOptions,
        customAnswers,
        configurationKey,
      };

      normalizedItems.push(item);
      itemsByConfiguration.set(itemKey, item);
    }
  }

  const productIds = [
    ...new Set(normalizedItems.map((item) => item.productId)),
  ];

  if (!productIds.length) {
    return [];
  }

  const products = await prisma.product.findMany({
    where: {
      id: {
        in: productIds,
      },
    },
    select: {
      id: true,
      title: true,
      images: true,
      priceCents: true,
      category: true,
      currency: true,
      acceptsCustom: true,
      styleTags: true,
      occasionTags: true,
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
          vendor: {
            select: {
              billing: true,
            },
          },
        },
      },
    },
  });

  const productsById = new Map(
    products.map((product) => [product.id, product])
  );

  if (products.length !== productIds.length) {
    throw new Error("product_not_found");
  }

  return normalizedItems.map((item) => ({
    ...item,
    product: productsById.get(item.productId),
  }));
}

/**
 * Construiește grupurile de checkout pe service (magazin)
 */
function buildCheckoutGroups(cart, promoByProductId = new Map()) {
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

    map.get(serviceId).items.push(
      mapCartItemForCheckout(
        it,
        promoByProductId.get(it.product?.id) || null
      )
    );
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
          category: true,
          currency: true,
          acceptsCustom: true,
styleTags: true,
occasionTags: true,
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

  const promoByProductId = await getActiveCollectionPromosForProducts(
  items.map((i) => i.product).filter(Boolean)
);

  const currency = items[0]?.product?.currency || "RON";

  const mapped = items.map((i) => {
    const service = i.product.service;
    const vendorId = service?.vendorId || null;
    const serviceId = service?.id || null;
    const vendorBilling = service?.vendor?.billing
      ? mapPublicBilling(service.vendor.billing)
      : null;
   const promo = getPromoPrice(
  i.product.priceCents,
  promoByProductId.get(i.product.id) || null
);

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

  // variantele produsului
  selectedOptions: i.selectedOptions || {},
  customAnswers: i.customAnswers || {},
  configurationKey: i.configurationKey || "default",

  price: dec(promo.finalPriceCents / 100),
      originalPrice: promo.hasDiscount
        ? dec(promo.originalPriceCents / 100)
        : null,
      hasDiscount: promo.hasDiscount,
      discountPercent: promo.discountPercent,
      promoLabel: promo.promoLabel,
promoFundingSource: promo.promoFundingSource,
promoCollectionId: promo.promoCollectionId,
      category: i.product.category || null,
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

  const groups = buildCheckoutGroups(items, promoByProductId).map((g) => ({
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

router.post("/checkout/guest/summary", async (req, res) => {
  try {
    const cart = await getGuestCart(req.body?.items || []);

    if (!cart.length) {
      return res.json({
        items: [],
        groups: [],
        currency: "RON",
        subtotal: 0,
      });
    }

    const promoByProductId =
      await getActiveCollectionPromosForProducts(
        cart.map((item) => item.product).filter(Boolean)
      );

    const currency =
      cart[0]?.product?.currency || "RON";

    const mapped = cart.map((item) => {
      const product = item.product;
      const service = product?.service;

      const promo = getPromoPrice(
        product?.priceCents,
        promoByProductId.get(product?.id) || null
      );

      return {
        productId: item.productId,
        serviceId: service?.id || null,
        vendorId: service?.vendorId || null,
        title: product?.title || "Produs",
        image:
          Array.isArray(product?.images) &&
          product.images[0]
            ? product.images[0]
            : null,
        qty: item.qty,
selectedOptions: item.selectedOptions || {},
customAnswers: item.customAnswers || {},
configurationKey: item.configurationKey || "default",
        price: dec(promo.finalPriceCents / 100),

        originalPrice: promo.hasDiscount
          ? dec(promo.originalPriceCents / 100)
          : null,

        hasDiscount: promo.hasDiscount,
        discountPercent: promo.discountPercent,
        promoLabel: promo.promoLabel,
        promoFundingSource:
          promo.promoFundingSource,
        promoCollectionId:
          promo.promoCollectionId,

        category: product?.category || null,
        currency: product?.currency || currency,

        vendorBilling:
          service?.vendor?.billing
            ? mapPublicBilling(
                service.vendor.billing
              )
            : null,

        estimatedShippingFee:
          service?.estimatedShippingFeeCents != null
            ? dec(
                Number(
                  service.estimatedShippingFeeCents
                ) / 100
              )
            : null,

        freeShippingThreshold:
          service?.freeShippingThresholdCents != null
            ? dec(
                Number(
                  service.freeShippingThresholdCents
                ) / 100
              )
            : null,

        shippingNotes:
          service?.shippingNotes || null,

        availability:
          product?.availability || null,

        readyQty:
          product?.readyQty ?? null,

        isAvailable:
          product?.isActive === true &&
          product?.isHidden !== true &&
          product?.moderationStatus === "APPROVED" &&
          product?.availability !== "SOLD_OUT" &&
          (
            product?.readyQty == null ||
            Number(product.readyQty) >= Number(item.qty)
          ),
      };
    });

    const groups = buildCheckoutGroups(
      cart,
      promoByProductId
    ).map((group) => ({
      serviceId: group.serviceId,
      vendorId: group.vendorId,
      serviceTitle: group.serviceTitle,

      estimatedShippingFee:
        group.estimatedShippingFeeCents != null
          ? dec(
              group.estimatedShippingFeeCents / 100
            )
          : null,

      freeShippingThreshold:
        group.freeShippingThresholdCents != null
          ? dec(
              group.freeShippingThresholdCents / 100
            )
          : null,

      shippingNotes:
        group.shippingNotes || null,

      subtotal: dec(
        group.items.reduce(
          (sum, item) =>
            sum +
            Number(item.price || 0) *
              Number(item.qty || 0),
          0
        )
      ),

      items: group.items,
    }));

    const subtotal = dec(
      mapped.reduce(
        (sum, item) =>
          sum +
          Number(item.price || 0) *
            Number(item.qty || 0),
        0
      )
    );

    return res.json({
      items: mapped,
      groups,
      currency,
      subtotal,
    });
  } catch (err) {
    console.error(
      "Eroare la sumarul coșului guest:",
      err
    );
if (err?.message === "product_not_found") {
  return res.status(404).json({
    error: "product_not_found",
    message: "Un produs din coș nu mai există.",
  });
}
    return res.status(500).json({
      error: "guest_summary_failed",
      message:
        "Nu am putut încărca sumarul coșului.",
    });
  }
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
          category: true,
          currency: true,
          acceptsCustom: true,
styleTags: true,
occasionTags: true,
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
const promoByProductId = await getActiveCollectionPromosForProducts(
  cart.map((i) => i.product).filter(Boolean)
);
  const groups = buildCheckoutGroups(cart, promoByProductId);
  const q = await quoteShipping({ groups, selections });

  const quoteId = `q_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  res.json({ id: quoteId, ...q });
});

router.post("/checkout/guest/quote", async (req, res) => {
  try {
    const address =
      buildNormalizedShippingAddress(
        req.body?.address || {}
      );

    const selections =
      req.body?.selections || {};

    const shippingError =
      validateShippingAddress(address);

    if (shippingError) {
      return res.status(400).json(
        shippingError
      );
    }

    const cart = await getGuestCart(
      req.body?.items || []
    );

    if (!cart.length) {
      return res.status(400).json({
        error: "cart_empty",
        message: "Coșul este gol.",
      });
    }

    const promoByProductId =
      await getActiveCollectionPromosForProducts(
        cart.map((item) => item.product).filter(Boolean)
      );

    const groups = buildCheckoutGroups(
      cart,
      promoByProductId
    );

    const quote = await quoteShipping({
      groups,
      selections,
    });

    const quoteId =
      `q_${Date.now()}_${Math.random()
        .toString(36)
        .slice(2, 8)}`;

    return res.json({
      id: quoteId,
      ...quote,
    });
  } catch (err) {
    console.error(
      "Eroare la calcularea livrării guest:",
      err
    );
if (err?.message === "product_not_found") {
  return res.status(404).json({
    error: "product_not_found",
    message: "Un produs din coș nu mai există.",
  });
}
    return res.status(500).json({
      error: "guest_quote_failed",
      message:
        "Nu am putut calcula livrarea.",
    });
  }
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
            category: true,
            currency: true,
            acceptsCustom: true,
styleTags: true,
occasionTags: true,
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
const promoByProductId = await getActiveCollectionPromosForProducts(
  cart.map((i) => i.product).filter(Boolean)
);
    const items = cart.map((i) =>
  mapCartItemForCheckout(i, promoByProductId.get(i.product?.id) || null)
);

    const subtotal = dec(items.reduce((s, it) => s + it.price * it.qty, 0));

    const groups = buildCheckoutGroups(cart, promoByProductId);
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
  email: true,
  emailOnNewOrder: true,
  user: {
    select: {
      email: true,
    },
  },
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
const quantitiesByProductId = new Map();

for (const item of cart) {
  quantitiesByProductId.set(
    item.productId,
    Number(quantitiesByProductId.get(item.productId) || 0) +
      Number(item.qty || 0)
  );
}
    const created = await prisma.$transaction(async (tx) => {
      for (const [productId, qty] of quantitiesByProductId.entries()) {

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

    selectedOptions: it.selectedOptions,
    customAnswers: it.customAnswers,
    configurationKey: it.configurationKey,

    originalPrice:
      it.hasDiscount && it.originalPrice
        ? dec(it.originalPrice)
        : null,

    discountAmount:
      it.hasDiscount && it.originalPrice
        ? dec(
            (Number(it.originalPrice) - Number(it.price)) *
              Number(it.qty || 1)
          )
        : 0,

    promoCollectionId: it.promoCollectionId || null,
    promoFundingSource: it.promoFundingSource || null,
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
          const vendor = vendors.find((v) => String(v.id) === String(s.vendorId));
const vendorEmail = vendor?.user?.email || vendor?.email || null;

if (
  vendorEmail &&
  vendor?.emailOnNewOrder !== false
) {
  await sendVendorNewOrderEmail({
    to: vendorEmail,
    vendorName: vendor?.displayName || "vendor",
    order: created,
    items: itemsForVendor,
    customerName,
    total: totalVendor,
    currency: created.currency || "RON",
  });
}

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
    total: Number(created.total),
    subtotal: Number(created.subtotal),
    shippingTotal: Number(created.shippingTotal),
    currency: created.currency || "RON",
  });
}

    try {
      const payment = await createPaymentForOrder(created);

      return res.json({
  ok: true,
  orderId: created.id,
  orderNumber: created.orderNumber,
  total: Number(created.total),
  subtotal: Number(created.subtotal),
  shippingTotal: Number(created.shippingTotal),
  currency: created.currency || "RON",
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

  if (
  err?.message ===
  "insufficient_stock"
) {
  return res.status(409).json({
    error: "insufficient_stock",
    message:
      "Cantitatea solicitată nu mai este disponibilă pentru unul dintre produse. Verifică produsele din coș și actualizează cantitatea.",
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

router.post("/checkout/guest/place", async (req, res) => {
  const soldOutProductIds = [];

  try {
    const {
      items: rawItems,
      address,
      billingAddress,
      contactPerson,
      selections,
      paymentMethod,
      customerType,
      shipToDifferentAddress,
      consents,
    } = req.body || {};

    const ctRaw = String(customerType || "").toUpperCase();
    const ct = ctRaw === "PJ" ? "PJ" : "PF";

    const pmRaw = String(paymentMethod || "").toUpperCase();
    const pm = pmRaw === "CARD" ? "CARD" : "COD";

    if (pm === "CARD") {
      return res.status(400).json({
        error: "guest_card_payment_not_ready",
        message:
          "Plata cu cardul pentru comenzile fără cont nu este disponibilă momentan. Selectează plata ramburs.",
      });
    }

    const normalizedAddress = buildNormalizedShippingAddress(address || {});

    const normalizedBillingAddress =
      ct === "PJ"
        ? buildNormalizedBillingAddress(billingAddress || {})
        : null;

    const normalizedContactPerson =
      ct === "PJ"
        ? buildNormalizedContactPerson(contactPerson || {})
        : null;

    const shippingError = validateShippingAddress(normalizedAddress);

    if (shippingError) {
      return res.status(400).json(shippingError);
    }

    if (ct === "PJ") {
      const companyError = validateBillingCompany(
        normalizedBillingAddress
      );

      if (companyError) {
        return res.status(400).json(companyError);
      }

      const contactError = validateContactPerson(
        normalizedContactPerson
      );

      if (contactError) {
        return res.status(400).json(contactError);
      }
    }

    const cart = await getGuestCart(rawItems || []);

    if (!cart.length) {
      return res.status(400).json({
        error: "cart_empty",
        message: "Coșul este gol.",
      });
    }

    const currency = cart[0]?.product?.currency || "RON";

    const promoByProductId =
      await getActiveCollectionPromosForProducts(
        cart.map((item) => item.product).filter(Boolean)
      );

    const checkoutItems = cart.map((item) =>
      mapCartItemForCheckout(
        item,
        promoByProductId.get(item.product?.id) || null
      )
    );

    const subtotal = dec(
      checkoutItems.reduce(
        (sum, item) =>
          sum +
          Number(item.price || 0) *
            Number(item.qty || 0),
        0
      )
    );

    const groups = buildCheckoutGroups(
      cart,
      promoByProductId
    );

    const quote = await quoteShipping({
      groups,
      selections: selections || {},
    });

    const shippingTotal = dec(quote.totalShipping);
    const total = dec(subtotal + shippingTotal);

    const vendorIds = [
      ...new Set(
        groups
          .map((group) => String(group.vendorId))
          .filter(Boolean)
      ),
    ];

    const vendors = await prisma.vendor.findMany({
      where: {
        id: {
          in: vendorIds,
        },
      },
      select: {
        id: true,
        displayName: true,
        address: true,
        city: true,
        email: true,
        emailOnNewOrder: true,
        user: {
          select: {
            email: true,
          },
        },
      },
    });

    const storeAddresses = {};

    for (const vendor of vendors) {
      storeAddresses[vendor.id] = {
        name: vendor.displayName || "Magazin",
        street: vendor.address || "",
        city: vendor.city || "",
        county: normalizedAddress.county || "",
        postalCode: "",
        country: "România",
      };
    }

    const shippingAddressForOrder =
      ct === "PJ" && !shipToDifferentAddress
        ? {
            firstName:
              normalizedContactPerson?.firstName || "",
            lastName:
              normalizedContactPerson?.lastName || "",
            name: buildFullName(
              normalizedContactPerson || {}
            ),
            email:
              normalizedContactPerson?.email || "",
            phone:
              normalizedContactPerson?.phone || "",
            county:
              normalizedBillingAddress?.county || "",
            city:
              normalizedBillingAddress?.city || "",
            postalCode:
              normalizedBillingAddress?.postalCode || "",
            street:
              normalizedBillingAddress?.street || "",
            notes:
              normalizedAddress?.notes || "",
            companyName:
              normalizedBillingAddress?.companyName || "",
          }
        : normalizedAddress;

    const customerName =
      ct === "PJ"
        ? buildFullName(normalizedContactPerson || {})
        : buildFullName(normalizedAddress || {});

    const customerEmail =
      ct === "PJ"
        ? normalizedContactPerson?.email
        : normalizedAddress?.email;

    const customerPhone =
      ct === "PJ"
        ? normalizedContactPerson?.phone
        : normalizedAddress?.phone;

    const guestAccess = generateGuestAccessToken();

    const guestAccessExpiresAt = new Date(
      Date.now() + 90 * 24 * 60 * 60 * 1000
    );

    /*
     * Agregăm cantitatea totală per produs.
     * Același produs poate apărea de mai multe ori,
     * cu configurationKey diferit.
     */
    const quantitiesByProductId = new Map();

    for (const item of cart) {
      quantitiesByProductId.set(
        item.productId,
        Number(
          quantitiesByProductId.get(item.productId) || 0
        ) + Number(item.qty || 0)
      );
    }

    const created = await prisma.$transaction(
      async (tx) => {
        /*
         * Verificăm și scădem stocul o singură dată
         * pentru fiecare produs.
         */
        for (const [
          productId,
          qty,
        ] of quantitiesByProductId.entries()) {
          if (!productId || qty <= 0) {
            continue;
          }

          const product = await tx.product.findUnique({
            where: {
              id: productId,
            },
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

          if (!product) {
            throw new Error("product_not_found");
          }

          if (
            product.isActive === false ||
            product.isHidden === true ||
            product.moderationStatus !== "APPROVED"
          ) {
            throw new Error("product_unavailable");
          }

          const availability = String(
            product.availability || "READY"
          ).toUpperCase();

          if (availability === "SOLD_OUT") {
            throw new Error("product_sold_out");
          }

          if (
            availability === "READY" &&
            product.readyQty !== null
          ) {
            const currentQty = Number(product.readyQty);

            if (
              !Number.isFinite(currentQty) ||
              currentQty < qty
            ) {
              throw new Error("insufficient_stock");
            }

            const nextQty = currentQty - qty;

            const updatedStock =
              await tx.product.updateMany({
                where: {
                  id: productId,
                  readyQty: {
                    gte: qty,
                  },
                  isActive: true,
                  isHidden: false,
                  moderationStatus: "APPROVED",
                  availability: "READY",
                },
                data: {
                  readyQty: {
                    decrement: qty,
                  },
                  availability:
                    nextQty <= 0
                      ? "SOLD_OUT"
                      : "READY",
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

            userId: null,
            isGuestOrder: true,

            customerName: customerName || null,
            customerEmail: customerEmail || null,
            customerPhone: customerPhone || null,

            guestAccessTokenHash:
              guestAccess.tokenHash,

            guestAccessExpiresAt,

            checkoutConsents: consents || null,

            checkoutIp: req.ip || null,

            checkoutUserAgent:
              normalizeText(
                req.headers["user-agent"]
              ).slice(0, 500) || null,

            status: "PENDING",
            paymentMethod: pm,
            currency,
            subtotal,
            shippingTotal,
            total,

            shippingAddress:
              shippingAddressForOrder,

            billingAddress:
              ct === "PJ"
                ? normalizedBillingAddress
                : null,

            contactPerson:
              ct === "PJ"
                ? normalizedContactPerson
                : null,

            shipToDifferentAddress:
              ct === "PJ"
                ? Boolean(shipToDifferentAddress)
                : false,

            customerType: ct,
          },
        });

        /*
         * Creăm shipment-urile și itemii,
         * păstrând configurațiile.
         */
        for (const shipmentQuote of quote.shipments) {
          if (!shipmentQuote.vendorId) {
            continue;
          }

          const shipment = await tx.shipment.create({
            data: {
              orderId: order.id,
              vendorId: String(
                shipmentQuote.vendorId
              ),

              serviceId: shipmentQuote.serviceId
                ? String(shipmentQuote.serviceId)
                : null,

              method:
                shipmentQuote.method === "LOCKER"
                  ? "LOCKER"
                  : "COURIER",

              lockerId:
                shipmentQuote.lockerId || null,

              price: dec(shipmentQuote.price),
              status: "PENDING",
            },
          });

          const shipmentItems =
            groups.find(
              (group) =>
                String(group.serviceId) ===
                String(shipmentQuote.serviceId)
            )?.items || [];

          if (shipmentItems.length) {
            await tx.shipmentItem.createMany({
              data: shipmentItems.map((item) => ({
                shipmentId: shipment.id,
                productId: item.productId,
                title: item.title,
                qty: item.qty,
                price: dec(item.price),

                selectedOptions:
                  item.selectedOptions || {},

                customAnswers:
                  item.customAnswers || {},

                configurationKey:
                  item.configurationKey || "default",

                originalPrice:
                  item.hasDiscount &&
                  item.originalPrice
                    ? dec(item.originalPrice)
                    : null,

                discountAmount:
                  item.hasDiscount &&
                  item.originalPrice
                    ? dec(
                        (
                          Number(
                            item.originalPrice
                          ) -
                          Number(item.price)
                        ) *
                          Number(item.qty || 1)
                      )
                    : 0,

                promoCollectionId:
                  item.promoCollectionId || null,

                promoFundingSource:
                  item.promoFundingSource || null,
              })),
            });
          }
        }

        return order;
      }
    );

    try {
      await Promise.all(
        [...new Set(soldOutProductIds)].map(
          (productId) =>
            notifyVendorOnProductSoldOut(
              productId
            )
        )
      );
    } catch (err) {
      console.error(
        "Nu am putut trimite notificările pentru produsele epuizate:",
        err
      );
    }

    try {
      const shipments =
        await prisma.shipment.findMany({
          where: {
            orderId: created.id,
          },
        });

      await Promise.all(
        shipments.map(async (shipment) => {
          const shortId = shipment.id
            .slice(-6)
            .toUpperCase();

          const itemsForVendor =
            checkoutItems.filter(
              (item) =>
                String(item.vendorId) ===
                String(shipment.vendorId)
            );

          const subtotalVendor = dec(
            itemsForVendor.reduce(
              (sum, item) =>
                sum +
                Number(item.price || 0) *
                  Number(item.qty || 0),
              0
            )
          );

          const totalVendor = dec(
            subtotalVendor +
              Number(shipment.price || 0)
          );

          await createVendorNotification(
            shipment.vendorId,
            {
              type: "order",
              title: `Comandă nouă (#${shortId})`,
              body:
                `${customerName || "Client"} a plasat o comandă – total ` +
                `${totalVendor.toFixed(2)} ` +
                `${created.currency || "RON"}.`,
              link: "/vendor/orders",
            }
          );

          const vendor = vendors.find(
            (item) =>
              String(item.id) ===
              String(shipment.vendorId)
          );

          const vendorEmail =
            vendor?.user?.email ||
            vendor?.email ||
            null;

          if (
            vendorEmail &&
            vendor?.emailOnNewOrder !== false
          ) {
            await sendVendorNewOrderEmail({
              to: vendorEmail,
              vendorName:
                vendor?.displayName || "vendor",
              order: created,
              items: itemsForVendor,
              customerName:
                customerName || "Client",
              total: totalVendor,
              currency:
                created.currency || "RON",
            });
          }
        })
      );
    } catch (err) {
      console.error(
        "Nu am putut crea notificările guest pentru vendor:",
        err
      );
    }

    try {
      await sendOrderConfirmationEmail({
        to: customerEmail,
        order: created,
        items: checkoutItems,
        storeAddresses,
      });
    } catch (err) {
      console.error(
        "Eroare la trimiterea emailului guest:",
        err
      );
    }

    return res.json({
      ok: true,
      orderId: created.id,
      orderNumber: created.orderNumber,

      guestAccessToken: guestAccess.token,

      total: Number(created.total),
      subtotal: Number(created.subtotal),

      shippingTotal: Number(
        created.shippingTotal
      ),

      currency: created.currency || "RON",
    });
  } catch (err) {
    console.error(
      "Eroare la plasarea comenzii guest:",
      err
    );

    if (err?.message === "insufficient_stock") {
      return res.status(409).json({
        error: "insufficient_stock",
        message:
          "Cantitatea solicitată nu mai este disponibilă pentru unul dintre produse.",
      });
    }

    if (err?.message === "product_sold_out") {
      return res.status(409).json({
        error: "product_sold_out",
        message:
          "Un produs din coș este epuizat.",
      });
    }

    if (
      err?.message === "product_unavailable"
    ) {
      return res.status(409).json({
        error: "product_unavailable",
        message:
          "Un produs din coș nu mai este disponibil.",
      });
    }

    if (err?.message === "product_not_found") {
      return res.status(404).json({
        error: "product_not_found",
        message:
          "Un produs din coș nu mai există.",
      });
    }

    return res.status(500).json({
      error: "guest_order_place_failed",
      message:
        "Nu am putut plasa comanda.",
    });
  }
});

export default router;