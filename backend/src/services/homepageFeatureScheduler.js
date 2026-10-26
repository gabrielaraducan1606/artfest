// backend/src/services/homepageFeatureScheduler.js

import {
  prisma,
} from "../db.js";

import {
  getZonedDayRange,
  getZonedWeekRange,
  getZonedDayKey,
  getZonedWeekKey,
} from "../lib/bucharestDate.js";

import {
  notifyVendorOnHomepageFeatureCreated,
} from "./notifications.js";

import {
  sendHomepageFeatureSelectedEmail,
} from "../lib/mailer.js";

/* =========================================================
   CONFIGURARE
========================================================= */

const MIN_ARTISAN_PRODUCTS =
  Math.max(
    1,
    Number(
      process.env
        .HOMEPAGE_MIN_ARTISAN_PRODUCTS ||
        3
    )
  );

/*
 * Cooldown produs (zile): același produs nu revine ca Produsul zilei
 * mai devreme. Cooldown-ul vendorului / artizanului e ADAPTIV, vezi
 * computeVendorCooldownDays / computeArtisanCooldownWeeks.
 */
const PRODUCT_REPEAT_DAYS =
  Math.max(
    1,
    Number(
      process.env
        .HOMEPAGE_PRODUCT_REPEAT_DAYS ||
        60
    )
  );

/*
 * Artfest oferă promovarea, NU reducerea (audit 2026-09-28):
 * promovările noi se creează mereu cu platformDiscountPercent = 0.
 * HOMEPAGE_PLATFORM_DISCOUNT_PERCENT nu mai este citit (env-ul
 * poate rămâne setat în Render, e ignorat). Câmpul din DB e legacy.
 */
const PLATFORM_DISCOUNT_PERCENT = 0;

/* =========================================================
   INCLUDE-URI PRISMA
========================================================= */

export const productFeatureInclude = {
  product: {
    include: {
      service: {
        include: {
          profile:
            true,

          vendor:
            true,
        },
      },
    },
  },

  service: {
    include: {
      profile:
        true,

      vendor:
        true,
    },
  },

  vendor:
    true,
};

export const artisanFeatureInclude = {
  service: {
    include: {
      profile:
        true,

      vendor:
        true,

      products: {
        where: {
          isActive:
            true,

          isHidden:
            false,

          moderationStatus:
            "APPROVED",

          availability: {
            in: [
              "READY",
              "MADE_TO_ORDER",
              "PREORDER",
            ],
          },

          images: {
            isEmpty:
              false,
          },
        },

        take:
          6,

        orderBy: {
          createdAt:
            "desc",
        },
      },
    },
  },

  vendor:
    true,
};

/* =========================================================
   FILTRE ELIGIBILITATE
========================================================= */

export const eligibleProductWhere = {
  isActive:
    true,

  isHidden:
    false,

  moderationStatus:
    "APPROVED",

  availability: {
    in: [
      "READY",
      "MADE_TO_ORDER",
      "PREORDER",
    ],
  },

  images: {
    isEmpty:
      false,
  },

  service: {
    isActive:
      true,

    status:
      "ACTIVE",

    vendor: {
      isActive:
        true,
    },
  },
};

/* =========================================================
   HELPERS DATĂ
========================================================= */

/*
 * Audit promoții 2026-09-15 (fix timezone): funcțiile de mai jos
 * delegau înainte la ora LOCALĂ a procesului Node
 * (`Date.setHours(0,0,0,0)`), fără nicio ancorare explicită în
 * Europe/Bucharest - pe un server care rulează în UTC (Render),
 * ziua/săptămâna s-ar fi schimbat la ora greșită (2-3h diferență).
 *
 * Acum delegă STRICT la sursa unică `lib/bucharestDate.js`, aceeași
 * folosită și de `adminHomepageFeatureRoutes.js` (care avea o
 * duplicare identică, eliminată) și de
 * `services/influencerGeneratedContent.js` (care avea deja o
 * implementare corectă, dar izolată). Semnăturile și numele
 * exportate rămân neschimbate, ca niciun apelant existent să nu
 * aibă nevoie de modificări.
 */
export function getDayRange(
  value = new Date()
) {
  return getZonedDayRange(
    value
  );
}

export function getWeekRange(
  value = new Date()
) {
  return getZonedWeekRange(
    value
  );
}

export function getDayKey(
  value = new Date()
) {
  return getZonedDayKey(
    value
  );
}

export function getWeekKey(
  value = new Date()
) {
  return getZonedWeekKey(
    value
  );
}

function cloneDate(value) {
  const date =
    value instanceof Date
      ? new Date(
          value.getTime()
        )
      : new Date(value);

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return null;
  }

  return date;
}

function addDays(
  value,
  days
) {
  const date =
    cloneDate(value);

  if (!date) {
    return null;
  }

  date.setDate(
    date.getDate() +
      Number(days || 0)
  );

  return date;
}

function addWeeks(
  value,
  weeks
) {
  return addDays(
    value,
    Number(weeks || 0) *
      7
  );
}

/* =========================================================
   HELPERS GENERALE
========================================================= */

function uniqueIds(values) {
  return [
    ...new Set(
      (
        Array.isArray(values)
          ? values
          : []
      ).filter(Boolean)
    ),
  ];
}

function buildInitialVendorResponse() {
  return {
    vendorDiscountPercent:
      0,

    vendorDiscountStatus:
      "PENDING",

    vendorDiscountRespondedAt:
      null,

    vendorNotifiedAt:
      null,

    vendorEmailedAt:
      null,

    vendorEmailError:
      null,
  };
}

export function isServiceVisuallyEligible(
  service
) {
  if (!service) {
    return false;
  }

  const productsCount =
    Number(
      service?._count
        ?.products ||
        0
    );

  const hasImage =
    Boolean(
      service?.profile
        ?.coverUrl ||
        service?.profile
          ?.logoUrl ||
        service?.vendor
          ?.coverUrl ||
        service?.vendor
          ?.logoUrl ||
        service?.mediaUrls?.[0]
    );

  return (
    productsCount >=
      MIN_ARTISAN_PRODUCTS &&
    hasImage
  );
}

/* =========================================================
   ROTAȚIE ECHILIBRATĂ (audit 2026-10-26)

   Înainte: random per PRODUS din cele mai noi 100 de produse,
   produsele promovate vreodată excluse permanent, fără pauză pe
   vendor -> un vendor cu multe produse noi domina, iar fallback-ul
   (care excludea Artizanul săptămânii) lăsa adesea un singur vendor.

   Acum, pe istoricul REAL (inclusiv programările viitoare deja
   generate, în ambele direcții față de data țintă):
   - Produsul zilei: întâi VENDORUL, apoi produsul lui;
   - Artizanul săptămânii: magazinul;
   - prioritate celor nepromovați, apoi celui folosit cel mai demult;
     random DOAR la egalitate;
   - cooldown adaptiv: vendor min(14, vendori eligibili - 1) zile,
     produs PRODUCT_REPEAT_DAYS (60) zile, artizan
     min(26, artizani eligibili - 1) săptămâni;
   - fallback gradual (etapele de mai jos), nu toate regulile deodată.

   Distanțele se calculează pe ZILE CALENDARISTICE din România
   (dateKey "YYYY-MM-DD"), nu pe milisecunde - corecte și la
   trecerea la ora de vară/iarnă.
========================================================= */

export const VENDOR_COOLDOWN_MAX_DAYS = 14;
export const ARTISAN_COOLDOWN_MAX_WEEKS = 26;

export function computeVendorCooldownDays(eligibleVendorCount) {
  return Math.max(
    0,
    Math.min(
      VENDOR_COOLDOWN_MAX_DAYS,
      Number(eligibleVendorCount || 0) - 1
    )
  );
}

export function computeArtisanCooldownWeeks(eligibleArtisanCount) {
  return Math.max(
    0,
    Math.min(
      ARTISAN_COOLDOWN_MAX_WEEKS,
      Number(eligibleArtisanCount || 0) - 1
    )
  );
}

// indexul zilei calendaristice din România (independent de DST)
function dayIndexOf(value) {
  const key = getZonedDayKey(value);
  if (!key) return null;

  const [year, month, day] = key.split("-").map(Number);
  return Math.round(Date.UTC(year, month - 1, day) / 86400000);
}

/*
 * Distanța (în zile) până la cea mai apropiată promovare a fiecărei
 * chei (vendor / produs / magazin), față de ziua țintă. Ziua țintă
 * însăși nu intră (ar fi chiar selecția pe care o facem).
 */
function buildDistanceMap(history, keyOf, targetDayIndex) {
  const map = new Map();

  for (const item of history) {
    const key = keyOf(item);
    const index = dayIndexOf(item.startsAt);

    if (!key || index === null || index === targetDayIndex) continue;

    const distance = Math.abs(index - targetDayIndex);
    if (!map.has(key) || distance < map.get(key)) map.set(key, distance);
  }

  return map;
}

/*
 * Cel mai bun element: nepromovat (distanță infinită) > cel folosit
 * cel mai demult (distanță mai mare); random doar la egalitate.
 */
function pickLeastRecent(items, distanceOf, random) {
  if (!items.length) return null;

  let best = [];
  let bestDistance = -1;

  for (const item of items) {
    const distance = distanceOf(item);

    if (distance > bestDistance) {
      best = [item];
      bestDistance = distance;
    } else if (distance === bestDistance) {
      best.push(item);
    }
  }

  return best[Math.min(best.length - 1, Math.floor(random() * best.length))];
}

/*
 * Etapele de relaxare pentru Produsul zilei, în ordine. Evitarea
 * vendorului Artizanului săptămânii e cea mai slabă preferință - prima
 * renunțată (altfel, cu puțini vendori, ar bloca alternanța o săptămână
 * întreagă). În ORICE etapă alegerea rămâne „cel mai puțin recent”,
 * deci și după relaxare vendorii se rotesc.
 */
const PRODUCT_SELECTION_STAGES = Object.freeze([
  { stage: "normal", vendorCooldown: true, productCooldown: true, avoidArtisan: true },
  { stage: "allow_artisan_vendor", vendorCooldown: true, productCooldown: true, avoidArtisan: false },
  { stage: "relax_vendor_cooldown", vendorCooldown: false, productCooldown: true, avoidArtisan: false },
  // ultima instanță: orice produs eligibil (tot cel mai puțin recent)
  { stage: "relax_product_cooldown", vendorCooldown: false, productCooldown: false, avoidArtisan: false },
]);

/**
 * Selecția PURĂ pentru Produsul zilei (testabilă fără DB).
 *  products: produse eligibile [{ id, vendorId, ... }]
 *  history:  promovări PRODUCT_OF_DAY existente [{ productId, vendorId, startsAt }]
 *            (trecute ȘI viitoare; ziua țintă e ignorată)
 * Returnează { product, stage, vendorCooldownDays } sau null.
 */
export function selectProductOfDay({
  products = [],
  history = [],
  targetDate,
  artisanVendorId = null,
  productCooldownDays = PRODUCT_REPEAT_DAYS,
  random = Math.random,
}) {
  const valid = products.filter((product) => product?.id && product?.vendorId);
  if (!valid.length) return null;

  const targetDayIndex = dayIndexOf(targetDate);
  const vendorDistance = buildDistanceMap(history, (item) => item.vendorId, targetDayIndex);
  const productDistance = buildDistanceMap(history, (item) => item.productId, targetDayIndex);

  const vendorIds = uniqueIds(valid.map((product) => product.vendorId));
  const vendorCooldownDays = computeVendorCooldownDays(vendorIds.length);
  const distanceOr = (map, key) => (map.has(key) ? map.get(key) : Infinity);

  for (const rules of PRODUCT_SELECTION_STAGES) {
    const pool = valid.filter((product) => {
      if (rules.productCooldown && distanceOr(productDistance, product.id) <= productCooldownDays) {
        return false;
      }

      if (rules.vendorCooldown && distanceOr(vendorDistance, product.vendorId) <= vendorCooldownDays) {
        return false;
      }

      return !(rules.avoidArtisan && artisanVendorId && product.vendorId === artisanVendorId);
    });

    if (!pool.length) continue;

    const vendorId = pickLeastRecent(
      uniqueIds(pool.map((product) => product.vendorId)),
      (id) => distanceOr(vendorDistance, id),
      random
    );

    const product = pickLeastRecent(
      pool.filter((item) => item.vendorId === vendorId),
      (item) => distanceOr(productDistance, item.id),
      random
    );

    return { product, stage: rules.stage, vendorCooldownDays };
  }

  return null;
}

/**
 * Selecția PURĂ pentru Artizanul săptămânii (pe magazin).
 *  services: magazine eligibile [{ id, vendorId, ... }]
 *  history:  promovări ARTISAN_OF_WEEK existente [{ serviceId, startsAt }]
 */
export function selectArtisanOfWeek({
  services = [],
  history = [],
  targetDate,
  random = Math.random,
}) {
  const valid = services.filter((service) => service?.id);
  if (!valid.length) return null;

  const targetDayIndex = dayIndexOf(targetDate);
  const dayDistance = buildDistanceMap(history, (item) => item.serviceId, targetDayIndex);
  // săptămâni întregi (startsAt-urile sunt mereu luni 00:00 ora României)
  const weekDistance = (id) => (dayDistance.has(id) ? Math.round(dayDistance.get(id) / 7) : Infinity);
  const cooldownWeeks = computeArtisanCooldownWeeks(valid.length);

  const rested = valid.filter((service) => weekDistance(service.id) > cooldownWeeks);
  const pool = rested.length ? rested : valid;

  return {
    service: pickLeastRecent(pool, (service) => weekDistance(service.id), random),
    stage: rested.length ? "normal" : "relax_artisan_cooldown",
    cooldownWeeks,
  };
}

/*
 * Random determinist pentru o zi (fallback la afișare): același
 * rezultat la fiecare request din aceeași zi.
 */
export function seededRandom(seedText) {
  let seed = 2166136261;

  for (const char of String(seedText || "")) {
    seed = Math.imul(seed ^ char.charCodeAt(0), 16777619);
  }

  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* =========================================================
   PRODUSUL ZILEI – DATE DIN DB
========================================================= */

async function getArtisanVendorIdForDate(targetDate) {
  const weekKey = getWeekKey(targetDate);
  if (!weekKey) return null;

  const feature = await prisma.homepageFeature.findUnique({
    where: { type_dateKey: { type: "ARTISAN_OF_WEEK", dateKey: weekKey } },
    select: { vendorId: true, service: { select: { vendorId: true } } },
  });

  return feature?.vendorId || feature?.service?.vendorId || null;
}

async function chooseProductForDate(targetDate, { random = Math.random } = {}) {
  const [products, history, artisanVendorId] = await Promise.all([
    prisma.product.findMany({
      where: eligibleProductWhere,
      select: {
        id: true,
        serviceId: true,
        service: { select: { vendorId: true } },
      },
    }),
    prisma.homepageFeature.findMany({
      where: { type: "PRODUCT_OF_DAY" },
      select: { productId: true, vendorId: true, startsAt: true },
    }),
    getArtisanVendorIdForDate(targetDate),
  ]);

  const result = selectProductOfDay({
    products: products.map((product) => ({
      id: product.id,
      serviceId: product.serviceId,
      vendorId: product.service?.vendorId || null,
    })),
    history,
    targetDate,
    artisanVendorId,
    random,
  });

  if (!result) return null;

  if (result.stage !== "normal") {
    console.info("[homepage-feature-scheduler] product fallback", {
      targetDate,
      stage: result.stage,
    });
  }

  return prisma.product.findUnique({
    where: { id: result.product.id },
    include: {
      service: {
        include: {
          profile: true,
          vendor: true,
        },
      },
    },
  });
}

/* =========================================================
   ARTIZANUL SĂPTĂMÂNII – DATE DIN DB
========================================================= */

async function findEligibleArtisanServices() {
  const services = await prisma.vendorService.findMany({
    where: {
      isActive: true,
      status: "ACTIVE",
      vendor: { isActive: true },
      products: { some: eligibleProductWhere },
    },
    select: {
      id: true,
      vendorId: true,
      mediaUrls: true,
      profile: { select: { coverUrl: true, logoUrl: true } },
      vendor: { select: { coverUrl: true, logoUrl: true } },
      _count: {
        select: {
          products: { where: eligibleProductWhere },
        },
      },
    },
  });

  return services.filter(isServiceVisuallyEligible);
}

async function chooseArtisanForDate(targetDate, { random = Math.random } = {}) {
  const [services, history] = await Promise.all([
    findEligibleArtisanServices(),
    prisma.homepageFeature.findMany({
      where: { type: "ARTISAN_OF_WEEK" },
      select: { serviceId: true, startsAt: true },
    }),
  ]);

  const result = selectArtisanOfWeek({ services, history, targetDate, random });
  return result?.service || null;
}

/* =========================================================
   AFIȘARE PE HOMEPAGE - eligibilitate la momentul afișării

   O selecție programată poate deveni neeligibilă (produs dezactivat,
   ascuns, respins; magazin/vendor inactiv). Atunci NU o afișăm și
   alegem, DOAR pentru afișare, un înlocuitor eligibil pentru ziua /
   săptămâna respectivă (determinist pe zi). Rândul din calendar și
   istoricul rămân neatinse.
========================================================= */

const ELIGIBLE_AVAILABILITY = ["READY", "MADE_TO_ORDER", "PREORDER"];

function isServiceLiveForDisplay(service) {
  return Boolean(
    service &&
      service.isActive === true &&
      service.status === "ACTIVE" &&
      service.vendor?.isActive === true
  );
}

export function isProductFeatureDisplayable(feature) {
  const product = feature?.product;

  return Boolean(
    product &&
      product.isActive === true &&
      product.isHidden !== true &&
      product.moderationStatus === "APPROVED" &&
      ELIGIBLE_AVAILABILITY.includes(product.availability) &&
      Array.isArray(product.images) &&
      product.images.length > 0 &&
      isServiceLiveForDisplay(product.service)
  );
}

export function isArtisanFeatureDisplayable(feature) {
  const service = feature?.service;

  // artisanFeatureInclude încarcă DOAR produsele eligibile ale magazinului
  return Boolean(
    isServiceLiveForDisplay(service) &&
      Array.isArray(service.products) &&
      service.products.length > 0
  );
}

/*
 * Rândul de afișat pentru Produsul zilei: selecția zilei dacă e încă
 * eligibilă, altfel un înlocuitor (fără reducere, nesalvat).
 * Returnează { feature, replaced, originalFeatureId }.
 */
export async function resolveDisplayProductFeature(now = new Date()) {
  let { feature } = await generateProductFeatureForDate(now);

  if (isProductFeatureDisplayable(feature)) {
    return { feature, replaced: false, originalFeatureId: feature.id };
  }

  const { startsAt, endsAt } = getDayRange(now);
  const product = await chooseProductForDate(startsAt, {
    random: seededRandom(`PRODUCT_OF_DAY:${getDayKey(startsAt)}`),
  });

  if (!product) {
    return { feature: null, replaced: Boolean(feature), originalFeatureId: feature?.id || null };
  }

  return {
    feature: {
      id: null,
      type: "PRODUCT_OF_DAY",
      source: "FALLBACK",
      startsAt,
      endsAt,
      productId: product.id,
      serviceId: product.serviceId,
      vendorId: product.service?.vendorId || null,
      platformDiscountPercent: 0,
      vendorDiscountPercent: 0,
      vendorDiscountStatus: "DECLINED",
      product,
      service: product.service,
      vendor: product.service?.vendor || null,
    },
    replaced: true,
    originalFeatureId: feature?.id || null,
  };
}

export async function resolveDisplayArtisanFeature(now = new Date()) {
  const { feature } = await generateArtisanFeatureForDate(now);

  if (isArtisanFeatureDisplayable(feature)) {
    return { feature, replaced: false, originalFeatureId: feature.id };
  }

  const { startsAt, endsAt } = getWeekRange(now);
  const service = await chooseArtisanForDate(startsAt, {
    random: seededRandom(`ARTISAN_OF_WEEK:${getWeekKey(startsAt)}`),
  });

  if (!service) {
    return { feature: null, replaced: Boolean(feature), originalFeatureId: feature?.id || null };
  }

  const full = await prisma.vendorService.findUnique({
    where: { id: service.id },
    include: artisanFeatureInclude.service.include,
  });

  if (!full) {
    return { feature: null, replaced: Boolean(feature), originalFeatureId: feature?.id || null };
  }

  return {
    feature: {
      id: null,
      type: "ARTISAN_OF_WEEK",
      source: "FALLBACK",
      startsAt,
      endsAt,
      productId: null,
      serviceId: full.id,
      vendorId: full.vendorId,
      platformDiscountPercent: 0,
      vendorDiscountPercent: 0,
      vendorDiscountStatus: "DECLINED",
      service: full,
      vendor: full.vendor || null,
    },
    replaced: true,
    originalFeatureId: feature?.id || null,
  };
}

/* =========================================================
   NOTIFICARE VENDOR (audit promoții 2026-09-15)

   Mutat aici din adminHomepageFeatureRoutes.js (era definit STRICT
   pentru butonul manual "Retrimite" din admin) - acum e sursa unică,
   reutilizată atât de acel buton, cât și de generarea automată de
   mai jos (la creare, nu la request manual).

   Idempotent pe ambele canale:
   - notificarea în platformă: notifyVendorOnHomepageFeatureCreated
     face upsert pe un dedupeKey unic (notifications.js) - reapelarea
     nu creează un al doilea rând, doar readuce aceeași notificare ca
     necitită (comportament dorit și pentru "Retrimite").
   - emailul: dacă vendorEmailedAt e deja setat, NU retrimitem -
     `emailSkipped: true`. Dacă emailul eșuează, NU setăm
     vendorEmailedAt (rămâne null, cu vendorEmailError completat) -
     o reîncercare ulterioară (același apel, mai târziu) va încerca
     din nou doar emailul, fără să atingă din nou notificarea deja
     trimisă.
   - Niciuna dintre cele două erori nu blochează cealaltă ramură și
     nu aruncă mai departe - generarea feature-ului nu trebuie
     niciodată blocată de un eșec de notificare/email.
========================================================= */

/* =========================================================
   EMAIL PROMOVARE - PROGRAMAT ÎNAINTE DE ÎNCEPUT (2026-10-07)
   - Produsul zilei:        sendAt = ziua promovării - 3 zile, 09:00
   - Artizanul săptămânii:  sendAt = începutul săptămânii - 7 zile, 09:00
   (ora României, din startsAt-ul din DB - nu din data creării).
   Notificarea IN-APP rămâne la creare; DOAR emailul e programat
   (jobs/homepageFeatureEmailJob.js îl trimite când devine scadent).
   Promovare creată după momentul normal -> email imediat, o singură
   dată, dacă nu a început încă. Promovare începută -> fără email.
========================================================= */

export const FEATURE_EMAIL_LEAD_DAYS = Object.freeze({
  PRODUCT_OF_DAY: 3,
  ARTISAN_OF_WEEK: 7,
});

export const FEATURE_EMAIL_SEND_HOUR = 9;

/** Ziua calendaristică (ora României) "YYYY-MM-DD" minus `days`. */
function shiftDayKey(dayKey, days) {
  const base = new Date(`${dayKey}T12:00:00.000Z`);
  base.setUTCDate(base.getUTCDate() - days);
  return base.toISOString().slice(0, 10);
}

/**
 * Momentul trimiterii emailului: ziua de început (ora României) minus
 * lead-ul tipului, la FEATURE_EMAIL_SEND_HOUR ora României.
 */
export function computeFeatureEmailSendAt(feature) {
  const lead = FEATURE_EMAIL_LEAD_DAYS[feature?.type];
  const startsAt = feature?.startsAt ? new Date(feature.startsAt) : null;

  if (lead == null || !startsAt || Number.isNaN(startsAt.getTime())) {
    return null;
  }

  const sendDayKey = shiftDayKey(getZonedDayKey(startsAt), lead);
  const { startsAt: dayStart } = getZonedDayRange(new Date(`${sendDayKey}T12:00:00.000Z`));

  return new Date(dayStart.getTime() + FEATURE_EMAIL_SEND_HOUR * 60 * 60 * 1000);
}

/*
 * Promovarea e „activă” pentru email: are vendor, iar produsul / magazinul
 * și vendorul nu sunt dezactivate, ascunse sau neaprobate. Câmpurile lipsă
 * (relații neîncărcate) nu blochează - doar valorile explicit invalide.
 */
export function isFeatureEmailEligible(feature) {
  if (!feature?.vendorId && !feature?.vendor) return false;

  const vendor = feature.vendor || feature.service?.vendor || feature.product?.service?.vendor || null;
  if (vendor && vendor.isActive === false) return false;

  const service = feature.service || feature.product?.service || null;
  if (service && (service.isActive === false || (service.status && service.status !== "ACTIVE"))) {
    return false;
  }

  if (feature.type === "PRODUCT_OF_DAY") {
    const product = feature.product;
    if (!product) return false;
    if (product.isActive === false || product.isHidden === true) return false;
    if (product.moderationStatus && product.moderationStatus !== "APPROVED") return false;
  }

  if (feature.type === "ARTISAN_OF_WEEK" && !service) return false;

  return true;
}

/**
 * Decizia de email pentru o promovare, la momentul `now`:
 *  { sendNow, sendAt, reason } - reason: "due" | "scheduled" |
 *  "started" | "ineligible" | "invalid".
 */
export function planFeatureEmail(feature, now = new Date()) {
  const sendAt = computeFeatureEmailSendAt(feature);
  const startsAt = feature?.startsAt ? new Date(feature.startsAt) : null;

  if (!sendAt || !startsAt) return { sendNow: false, sendAt, reason: "invalid" };
  if (now >= startsAt) return { sendNow: false, sendAt, reason: "started" };
  if (!isFeatureEmailEligible(feature)) return { sendNow: false, sendAt, reason: "ineligible" };
  if (now < sendAt) return { sendNow: false, sendAt, reason: "scheduled" };

  return { sendNow: true, sendAt, reason: "due" };
}

/**
 * Trimite emailul promovării ACUM și persistă rezultatul
 * (vendorEmailedAt la succes; vendorEmailError la eșec, fără
 * vendorEmailedAt -> poate fi reluat). Nu aruncă.
 */
export async function sendFeatureEmailNow(feature) {
  const featureId = feature?.id;

  try {
    const vendor =
      feature.vendor ||
      feature.service?.vendor ||
      feature.product?.service?.vendor ||
      null;

    const vendorEmail = String(vendor?.user?.email || vendor?.email || "").trim();

    if (!vendorEmail) {
      throw new Error("Vendorul nu are o adresă de email.");
    }

    const accountName = String(vendor?.user?.name || "").trim();
    const composedAccountName = [vendor?.user?.firstName, vendor?.user?.lastName]
      .filter(Boolean)
      .join(" ")
      .trim();

    const vendorName =
      accountName ||
      composedAccountName ||
      vendor?.displayName ||
      feature.service?.profile?.displayName ||
      feature.product?.service?.profile?.displayName ||
      "creator";

    const profile = feature.service?.profile || feature.product?.service?.profile || null;
    const storeName = profile?.displayName || vendor?.displayName || null;

    await sendHomepageFeatureSelectedEmail({
      to: vendorEmail,
      userId: vendor?.userId || null,
      vendorName,
      firstName: String(vendor?.user?.firstName || "").trim() || null,
      featureId: feature.id,
      featureType: feature.type,
      productId: feature.productId || feature.product?.id || null,
      productTitle: feature.product?.title || null,
      storeName,
      storeSlug: profile?.slug || null,
      startsAt: feature.startsAt,
      endsAt: feature.endsAt,
    });

    const vendorEmailedAt = new Date();

    await prisma.homepageFeature.update({
      where: { id: featureId },
      data: { vendorEmailedAt, vendorEmailError: null },
    });

    return { emailSent: true, emailError: null, vendorEmailedAt, vendorEmailError: null };
  } catch (error) {
    const errorMessage = String(error?.message || error || "Email error").slice(0, 1000);

    console.error("[homepage-features] vendor email failed", error);

    await prisma.homepageFeature
      .update({
        where: { id: featureId },
        data: { vendorEmailError: errorMessage },
      })
      .catch(() => null);

    return { emailSent: false, emailError: error, vendorEmailedAt: null, vendorEmailError: errorMessage };
  }
}

export async function notifyVendorAboutFeatureCreated(
  feature,
  { now = new Date() } = {}
) {
  const featureId =
    feature?.id;

  if (!featureId) {
    return {
      ok: false,
      notification: null,
      notificationSent: false,
      emailSent: false,
      emailSkipped: false,
      notificationError:
        new Error(
          "Missing homepage feature"
        ),
      emailError: null,
      vendorNotifiedAt:
        feature?.vendorNotifiedAt ||
        null,
      vendorEmailedAt:
        feature?.vendorEmailedAt ||
        null,
      vendorEmailError:
        feature?.vendorEmailError ||
        null,
    };
  }

  let notification =
    null;

  let notificationSent =
    false;

  let emailSent =
    false;

  let emailSkipped =
    false;

  let notificationError =
    null;

  let emailError =
    null;

  let vendorNotifiedAt =
    feature.vendorNotifiedAt ||
    null;

  let vendorEmailedAt =
    feature.vendorEmailedAt ||
    null;

  let vendorEmailError =
    feature.vendorEmailError ||
    null;

  /*
   * 1. Notificarea din platformă.
   */
  try {
    notification =
      await notifyVendorOnHomepageFeatureCreated(
        featureId
      );

    if (notification) {
      notificationSent =
        true;

      vendorNotifiedAt =
        new Date();

      await prisma.homepageFeature.update({
        where: {
          id:
            featureId,
        },

        data: {
          vendorNotifiedAt,
        },
      });
    }
  } catch (error) {
    notificationError =
      error;

    console.error(
      "[homepage-features] vendor notification failed",
      error
    );
  }

  /*
   * 2. Emailul - PROGRAMAT (planFeatureEmail): pleacă doar când e scadent
   *    (sendAt) și promovarea nu a început; sărit dacă a fost deja trimis.
   */
  const emailPlan = planFeatureEmail(feature, now);
  const emailScheduledFor = emailPlan.sendAt;
  let emailSkipReason = null;

  if (feature.vendorEmailedAt) {
    emailSkipped = true;
    emailSkipReason = "already_sent";
  } else if (!emailPlan.sendNow) {
    emailSkipped = true;
    emailSkipReason = emailPlan.reason;
  } else {
    const result = await sendFeatureEmailNow(feature);

    emailSent = result.emailSent;
    emailError = result.emailError;
    vendorEmailError = result.vendorEmailError;

    if (result.vendorEmailedAt) {
      vendorEmailedAt = result.vendorEmailedAt;
    }
  }

  return {
    ok:
      !notificationError &&
      !emailError,

    notification,
    notificationSent,
    emailSent,
    emailSkipped,

    notificationError,
    emailError,

    vendorNotifiedAt,
    vendorEmailedAt,
    vendorEmailError,

    emailScheduledFor,
    emailSkipReason,
  };
}

/* =========================================================
   GENERARE PRODUSUL ZILEI
========================================================= */

export async function generateProductFeatureForDate(
  value
) {
  const range =
    getDayRange(value);

  if (!range) {
    throw new Error(
      "Data pentru Produsul zilei nu este validă."
    );
  }

  const {
    startsAt,
    endsAt,
  } = range;

  const dateKey =
    getDayKey(startsAt);

  const existing =
    await prisma.homepageFeature.findUnique({
      where: {
        type_dateKey: {
          type:
            "PRODUCT_OF_DAY",

          dateKey,
        },
      },

      include:
        productFeatureInclude,
    });

  /*
   * Nu suprascriem o selecție deja existentă,
   * indiferent dacă este MANUAL sau AUTOMATIC.
   */
  if (existing) {
    return {
      created:
        false,

      feature:
        existing,

      reason:
        "already_exists",
    };
  }

  const selected =
    await chooseProductForDate(
      startsAt
    );

  if (!selected) {
    return {
      created:
        false,

      feature:
        null,

      reason:
        "no_eligible_product",
    };
  }

  try {
    const feature =
      await prisma.homepageFeature.create({
        data: {
          type:
            "PRODUCT_OF_DAY",

          dateKey,

          source:
            "AUTOMATIC",

          productId:
            selected.id,

          serviceId:
            selected.serviceId,

          vendorId:
            selected.service
              .vendorId,

          startsAt,
          endsAt,

          platformDiscountPercent:
            PLATFORM_DISCOUNT_PERCENT,

          ...buildInitialVendorResponse(),
        },

        include:
          productFeatureInclude,
      });

    /*
     * Notificare automată o singură dată, la creare - vezi
     * notifyVendorAboutFeatureCreated mai sus. Nu blocăm
     * generarea feature-ului dacă notificarea/emailul eșuează.
     */
    const notifyResult =
      await notifyVendorAboutFeatureCreated(
        feature
      );

    return {
      created:
        true,

      feature: {
        ...feature,

        vendorNotifiedAt:
          notifyResult.vendorNotifiedAt,

        vendorEmailedAt:
          notifyResult.vendorEmailedAt,

        vendorEmailError:
          notifyResult.vendorEmailError,
      },

      reason:
        "created",
    };
  } catch (error) {
    /*
     * Protecție pentru două requesturi simultane.
     */
    if (
      error?.code ===
      "P2002"
    ) {
      const feature =
        await prisma.homepageFeature.findUnique({
          where: {
            type_dateKey: {
              type:
                "PRODUCT_OF_DAY",

              dateKey,
            },
          },

          include:
            productFeatureInclude,
        });

      return {
        created:
          false,

        feature,

        reason:
          "already_exists",
      };
    }

    throw error;
  }
}

/* =========================================================
   GENERARE ARTIZANUL SĂPTĂMÂNII
========================================================= */

export async function generateArtisanFeatureForDate(
  value
) {
  const range =
    getWeekRange(value);

  if (!range) {
    throw new Error(
      "Data pentru Artizanul săptămânii nu este validă."
    );
  }

  const {
    startsAt,
    endsAt,
  } = range;

  const dateKey =
    getWeekKey(startsAt);

  const existing =
    await prisma.homepageFeature.findUnique({
      where: {
        type_dateKey: {
          type:
            "ARTISAN_OF_WEEK",

          dateKey,
        },
      },

      include:
        artisanFeatureInclude,
    });

  if (existing) {
    return {
      created:
        false,

      feature:
        existing,

      reason:
        "already_exists",
    };
  }

  const selected =
    await chooseArtisanForDate(
      startsAt
    );

  if (!selected) {
    return {
      created:
        false,

      feature:
        null,

      reason:
        "no_eligible_artisan",
    };
  }

  try {
    const feature =
      await prisma.homepageFeature.create({
        data: {
          type:
            "ARTISAN_OF_WEEK",

          dateKey,

          source:
            "AUTOMATIC",

          productId:
            null,

          serviceId:
            selected.id,

          vendorId:
            selected.vendorId,

          startsAt,
          endsAt,

          platformDiscountPercent:
            PLATFORM_DISCOUNT_PERCENT,

          ...buildInitialVendorResponse(),
        },

        include:
          artisanFeatureInclude,
      });

    /*
     * Notificare automată o singură dată, la creare - vezi
     * notifyVendorAboutFeatureCreated mai sus. Nu blocăm
     * generarea feature-ului dacă notificarea/emailul eșuează.
     */
    const notifyResult =
      await notifyVendorAboutFeatureCreated(
        feature
      );

    return {
      created:
        true,

      feature: {
        ...feature,

        vendorNotifiedAt:
          notifyResult.vendorNotifiedAt,

        vendorEmailedAt:
          notifyResult.vendorEmailedAt,

        vendorEmailError:
          notifyResult.vendorEmailError,
      },

      reason:
        "created",
    };
  } catch (error) {
    if (
      error?.code ===
      "P2002"
    ) {
      const feature =
        await prisma.homepageFeature.findUnique({
          where: {
            type_dateKey: {
              type:
                "ARTISAN_OF_WEEK",

              dateKey,
            },
          },

          include:
            artisanFeatureInclude,
        });

      return {
        created:
          false,

        feature,

        reason:
          "already_exists",
      };
    }

    throw error;
  }
}

/* =========================================================
   GENERARE CALENDAR COMPLET
========================================================= */

export async function generateHomepageSchedule({
  startDate =
    new Date(),

  productDays =
    14,

  artisanWeeks =
    4,
} = {}) {
  const normalizedStartDate =
    cloneDate(startDate);

  if (!normalizedStartDate) {
    throw new Error(
      "Data de început pentru calendar nu este validă."
    );
  }

  const normalizedProductDays =
    Math.min(
      90,
      Math.max(
        0,
        Math.round(
          Number(
            productDays ||
              0
          )
        )
      )
    );

  const normalizedArtisanWeeks =
    Math.min(
      26,
      Math.max(
        0,
        Math.round(
          Number(
            artisanWeeks ||
              0
          )
        )
      )
    );

  const productResults =
    [];

  const artisanResults =
    [];

  /*
   * Generăm mai întâi artizanii.
   *
   * Astfel, la alegerea produselor zilei,
   * sistemul poate evita produsele magazinului
   * care este Artizanul săptămânii.
   */
  for (
    let index = 0;
    index <
    normalizedArtisanWeeks;
    index += 1
  ) {
    const targetDate =
      addWeeks(
        normalizedStartDate,
        index
      );

    try {
      const result =
        await generateArtisanFeatureForDate(
          targetDate
        );

      artisanResults.push({
        index,
        dateKey:
          getWeekKey(
            targetDate
          ),
        ...result,
      });
    } catch (error) {
      console.error(
        "[homepage-feature-scheduler] artisan generation failed",
        {
          index,
          targetDate,
          error,
        }
      );

      artisanResults.push({
        index,
        dateKey:
          getWeekKey(
            targetDate
          ),
        created:
          false,
        feature:
          null,
        reason:
          "error",
        error:
          error?.message ||
          "unknown_error",
      });
    }
  }

  for (
    let index = 0;
    index <
    normalizedProductDays;
    index += 1
  ) {
    const targetDate =
      addDays(
        normalizedStartDate,
        index
      );

    try {
      const result =
        await generateProductFeatureForDate(
          targetDate
        );

      productResults.push({
        index,
        dateKey:
          getDayKey(
            targetDate
          ),
        ...result,
      });
    } catch (error) {
      console.error(
        "[homepage-feature-scheduler] product generation failed",
        {
          index,
          targetDate,
          error,
        }
      );

      productResults.push({
        index,
        dateKey:
          getDayKey(
            targetDate
          ),
        created:
          false,
        feature:
          null,
        reason:
          "error",
        error:
          error?.message ||
          "unknown_error",
      });
    }
  }

  const createdProducts =
    productResults.filter(
      (item) =>
        item.created
    ).length;

  const existingProducts =
    productResults.filter(
      (item) =>
        item.reason ===
        "already_exists"
    ).length;

  const missingProducts =
    productResults.filter(
      (item) =>
        item.reason ===
        "no_eligible_product"
    ).length;

  const productErrors =
    productResults.filter(
      (item) =>
        item.reason ===
        "error"
    ).length;

  const createdArtisans =
    artisanResults.filter(
      (item) =>
        item.created
    ).length;

  const existingArtisans =
    artisanResults.filter(
      (item) =>
        item.reason ===
        "already_exists"
    ).length;

  const missingArtisans =
    artisanResults.filter(
      (item) =>
        item.reason ===
        "no_eligible_artisan"
    ).length;

  const artisanErrors =
    artisanResults.filter(
      (item) =>
        item.reason ===
        "error"
    ).length;

  return {
    ok:
      true,

    configuration: {
      startDate:
        normalizedStartDate,

      productDays:
        normalizedProductDays,

      artisanWeeks:
        normalizedArtisanWeeks,

      platformDiscountPercent:
        PLATFORM_DISCOUNT_PERCENT,
    },

    summary: {
      createdProducts,
      existingProducts,
      missingProducts,
      productErrors,

      createdArtisans,
      existingArtisans,
      missingArtisans,
      artisanErrors,
    },

    products:
      productResults,

    artisans:
      artisanResults,
  };
}

/* =========================================================
   ASIGURARE PERIOADĂ CURENTĂ
========================================================= */

/*
 * Aceste funcții pot fi folosite de ruta publică
 * drept fallback dacă, din orice motiv, calendarul
 * nu a fost generat în avans.
 */

export async function ensureCurrentProductFeature() {
  return generateProductFeatureForDate(
    new Date()
  );
}

export async function ensureCurrentArtisanFeature() {
  return generateArtisanFeatureForDate(
    new Date()
  );
}