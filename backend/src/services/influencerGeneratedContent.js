// backend/src/services/influencerGeneratedContent.js

import { prisma } from "../db.js";

import {
  eligibleProductWhere,
  isServiceVisuallyEligible,
} from "./homepageFeatureScheduler.js";

/* =========================================================
   "AZI" ÎN EUROPE/BUCHAREST

   getDayRange() din homepageFeatureScheduler.js folosește ora
   locală a SERVERULUI (new Date() + setHours(0,0,0,0)), care nu
   este explicit legată de Europe/Bucharest - pe un server care
   rulează în UTC, "azi" ar însemna greșit ziua UTC, nu ziua din
   România (diferență de 2-3 ore). Pentru acest feature construim
   explicit granița de zi în Europe/Bucharest, fără să modificăm
   helperul existent folosit de Produsul zilei / Artizanul
   săptămânii, ca să nu schimbăm comportamentul lor.
========================================================= */

const BUCHAREST_TZ = "Europe/Bucharest";

function getBucharestOffsetMinutes(reference) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: BUCHAREST_TZ,
    timeZoneName: "shortOffset",
  }).formatToParts(reference);

  const offsetLabel =
    parts.find(
      (part) => part.type === "timeZoneName"
    )?.value || "GMT+2";

  const match = offsetLabel.match(
    /GMT([+-])(\d+)(?::(\d+))?/
  );

  if (!match) {
    return 120;
  }

  const sign = match[1] === "-" ? -1 : 1;
  const hours = Number(match[2] || 0);
  const minutes = Number(match[3] || 0);

  return sign * (hours * 60 + minutes);
}

export function getBucharestDayRange(
  reference = new Date()
) {
  const dateParts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: BUCHAREST_TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(reference)
      .map((part) => [part.type, part.value])
  );

  const offsetMinutes =
    getBucharestOffsetMinutes(reference);

  const startsAt = new Date(
    Date.UTC(
      Number(dateParts.year),
      Number(dateParts.month) - 1,
      Number(dateParts.day),
      0,
      0,
      0
    ) -
      offsetMinutes * 60000
  );

  const endsAt = new Date(
    startsAt.getTime() + 24 * 60 * 60 * 1000
  );

  return { startsAt, endsAt };
}

/* =========================================================
   PRODUSE NOI AZI

   Reutilizează eligibleProductWhere (aceeași sursă de adevăr
   ca Produsul zilei) + createdAt în ziua curentă Europe/Bucharest.
   Un singur query, select minim.
========================================================= */

const NEW_PRODUCTS_LIMIT = 8;

export async function getNewProductsToday({
  limit = NEW_PRODUCTS_LIMIT,
} = {}) {
  const { startsAt, endsAt } =
    getBucharestDayRange();

  const products =
    await prisma.product.findMany({
      where: {
        ...eligibleProductWhere,

        createdAt: {
          gte: startsAt,
          lt: endsAt,
        },
      },

      select: {
        id: true,
        title: true,
        images: true,
        priceCents: true,
        currency: true,
        createdAt: true,

        service: {
          select: {
            id: true,

            profile: {
              select: {
                displayName: true,
              },
            },

            vendor: {
              select: {
                displayName: true,
              },
            },
          },
        },
      },

      orderBy: {
        createdAt: "desc",
      },

      take: Math.min(
        20,
        Math.max(
          1,
          Number(limit) || NEW_PRODUCTS_LIMIT
        )
      ),
    });

  return products.map((product) => ({
    id: product.id,
    title: product.title,
    image: product.images?.[0] || null,
    price: product.priceCents / 100,
    currency: product.currency,

    storeName:
      product.service?.profile?.displayName ||
      product.service?.vendor?.displayName ||
      null,

    productUrl: `/produs/${product.id}`,
    createdAt: product.createdAt,
  }));
}

/* =========================================================
   VÂNZĂTORI NOI AZI

   VendorService creat azi + activ + vendor activ + profil
   public valid (slug). Eligibilitatea vizuală reutilizează
   isServiceVisuallyEligible() din homepageFeatureScheduler.js
   (aceeași regulă ca Artizanul săptămânii) - nu o duplicăm.

   Preview-ul de produse per magazin se face printr-UN singur
   query batch suplimentar (nu per-vendor).
========================================================= */

const NEW_VENDORS_LIMIT = 6;
const NEW_VENDOR_CANDIDATE_LIMIT = 50;
const NEW_VENDOR_PREVIEW_PRODUCTS = 3;

export async function getNewVendorsToday({
  limit = NEW_VENDORS_LIMIT,
} = {}) {
  const { startsAt, endsAt } =
    getBucharestDayRange();

  const normalizedLimit = Math.min(
    20,
    Math.max(
      1,
      Number(limit) || NEW_VENDORS_LIMIT
    )
  );

  const candidates =
    await prisma.vendorService.findMany({
      where: {
        isActive: true,
        status: "ACTIVE",

        createdAt: {
          gte: startsAt,
          lt: endsAt,
        },

        vendor: {
          isActive: true,
        },

        profile: {
          is: {
            slug: {
              not: null,
            },
          },
        },
      },

      select: {
        id: true,
        createdAt: true,
        mediaUrls: true,

        profile: {
          select: {
            displayName: true,
            slug: true,
            logoUrl: true,
            coverUrl: true,
          },
        },

        vendor: {
          select: {
            displayName: true,
            logoUrl: true,
            coverUrl: true,
          },
        },

        _count: {
          select: {
            products: {
              where: eligibleProductWhere,
            },
          },
        },
      },

      orderBy: {
        createdAt: "desc",
      },

      take: NEW_VENDOR_CANDIDATE_LIMIT,
    });

  const eligible = candidates
    .filter(isServiceVisuallyEligible)
    .slice(0, normalizedLimit);

  const serviceIds = eligible.map(
    (service) => service.id
  );

  const previewProducts = serviceIds.length
    ? await prisma.product.findMany({
        where: {
          ...eligibleProductWhere,
          serviceId: { in: serviceIds },
        },

        select: {
          id: true,
          title: true,
          images: true,
          priceCents: true,
          serviceId: true,
        },

        orderBy: {
          createdAt: "desc",
        },
      })
    : [];

  const previewByServiceId = new Map();

  for (const product of previewProducts) {
    const list =
      previewByServiceId.get(
        product.serviceId
      ) || [];

    if (
      list.length <
      NEW_VENDOR_PREVIEW_PRODUCTS
    ) {
      list.push(product);
      previewByServiceId.set(
        product.serviceId,
        list
      );
    }
  }

  return eligible.map((service) => ({
    serviceId: service.id,

    storeName:
      service.profile?.displayName ||
      service.vendor?.displayName ||
      null,

    logo:
      service.profile?.logoUrl ||
      service.vendor?.logoUrl ||
      null,

    storeUrl: `/magazin/${service.profile.slug}`,
    createdAt: service.createdAt,

    previewProducts: (
      previewByServiceId.get(service.id) || []
    ).map((product) => ({
      id: product.id,
      title: product.title,
      image: product.images?.[0] || null,
      price: product.priceCents / 100,
    })),
  }));
}
