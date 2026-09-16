// backend/src/services/vendorAssistantPromotions.js
//
// BATCH D (audit regression Vendor Assistant, 2026-09-07) - serviciu SUBȚIRE,
// read-only, pentru "sunt produsul zilei? / sunt artizanul săptămânii? / ce
// promovări active am / ce campanii am active" puse de un vendor autentificat.
//
// NU duplică logica de business din vendorHomepageFeatureRoutes.js sau
// vendorCampaignRoutes.js - reutilizează ACELEAȘI where-clause-uri (scope
// "current"/"upcoming" pentru HomepageFeature; `isActive` pentru
// VendorCampaign, identic cu `activeCount` din GET /api/vendor/campaigns).
//
// Scop STRICT: status/listă a promovărilor proprii - NU comenzi/câștiguri/
// cereri de ofertă (alte domenii, tratate separat).

import { prisma } from "../db.js";

function stripDiacritics(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/ă/g, "a")
    .replace(/â/g, "a")
    .replace(/î/g, "i")
    .replace(/ș|ş/g, "s")
    .replace(/ț|ţ/g, "t");
}

/*
 * Ordinea contează: verificăm întâi tipurile specifice (produs zilei /
 * artizan săptămânii), apoi campanii, apoi generic "promovări active"/
 * "viitoare". Orice întrebare STATICĂ despre CUM funcționează (fără "sunt"/
 * "am"/"active"/"viitoare") întoarce `null` - cade pe manifest.
 */
export function detectPromotionsLiveTopic(message) {
  const t = stripDiacritics(message);

  const mentionsProductOfDay = /produsul zilei|produs (al )?zilei/.test(t);
  const mentionsArtisanOfWeek = /artizanul saptamanii|artizan (al )?saptamanii/.test(t);
  const mentionsCampaign = /campani/.test(t);
  const mentionsPromotion = /promovar/.test(t);

  const looksLikeStatusQuery = /\bsunt\b|\bam\b|\bexista\b/.test(t);
  const mentionsUpcoming = /viitoare|programat/.test(t);
  const mentionsActive = /activ/.test(t);

  if (mentionsProductOfDay && looksLikeStatusQuery) return "PRODUCT_OF_DAY_STATUS";
  if (mentionsArtisanOfWeek && looksLikeStatusQuery) return "ARTISAN_OF_WEEK_STATUS";

  if (mentionsCampaign && mentionsActive) return "ACTIVE_CAMPAIGNS";

  if (mentionsPromotion && mentionsUpcoming) return "UPCOMING_HOMEPAGE_FEATURES";
  if (mentionsPromotion && (mentionsActive || looksLikeStatusQuery)) {
    return "ACTIVE_HOMEPAGE_FEATURES";
  }

  return null;
}

const TYPE_LABEL = {
  PRODUCT_OF_DAY: "produsul zilei",
  ARTISAN_OF_WEEK: "artizanul săptămânii",
};

async function loadCurrentFeatures(vendorId, type = null) {
  const now = new Date();
  return prisma.homepageFeature.findMany({
    where: {
      vendorId,
      startsAt: { lte: now },
      endsAt: { gt: now },
      ...(type ? { type } : {}),
    },
    include: { product: { select: { title: true } } },
    orderBy: { startsAt: "asc" },
  });
}

async function loadUpcomingFeatures(vendorId, limit = 5) {
  const now = new Date();
  return prisma.homepageFeature.findMany({
    where: { vendorId, startsAt: { gt: now } },
    include: { product: { select: { title: true } } },
    orderBy: { startsAt: "asc" },
    take: limit,
  });
}

function formatFeatureLine(f) {
  const label = TYPE_LABEL[f.type] || f.type;
  const product = f.product?.title ? ` - „${f.product.title}”` : "";
  const date = new Date(f.startsAt).toLocaleDateString("ro-RO");
  return `${label}${product} (${date})`;
}

async function loadActiveCampaigns(vendorId, limit = 5) {
  return prisma.vendorCampaign.findMany({
    where: { vendorId, isActive: true },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      name: true,
      slug: true,
      discountPercent: true,
      commissionBps: true,
      visits: true,
      attributedOrdersCount: true,
    },
  });
}

/*
 * Punct de intrare unic pentru copilotRouter.js. Întoarce `null` dacă
 * mesajul NU e o întrebare de status/listă a promovărilor (apelantul cade
 * pe comportamentul existent, neschimbat).
 */
export async function answerVendorPromotionsQuestion({ vendorId, message }) {
  const topic = detectPromotionsLiveTopic(message);
  if (!topic) return null;

  if (topic === "PRODUCT_OF_DAY_STATUS" || topic === "ARTISAN_OF_WEEK_STATUS") {
    const type = topic === "PRODUCT_OF_DAY_STATUS" ? "PRODUCT_OF_DAY" : "ARTISAN_OF_WEEK";
    const label = TYPE_LABEL[type];
    const features = await loadCurrentFeatures(vendorId, type);

    if (!features.length) {
      return { message: `Nu, momentan nu ești ${label}.`, topic };
    }

    const lines = features.map(formatFeatureLine);
    return {
      message: `Da, ești ${label} chiar acum:\n\n${lines.join("\n")}`,
      topic,
    };
  }

  if (topic === "ACTIVE_HOMEPAGE_FEATURES") {
    const features = await loadCurrentFeatures(vendorId);
    if (!features.length) {
      return { message: "Nu ai nicio promovare activă pe homepage momentan.", topic };
    }
    const lines = features.map(formatFeatureLine);
    return { message: `Promovări active acum:\n\n${lines.join("\n")}`, topic };
  }

  if (topic === "UPCOMING_HOMEPAGE_FEATURES") {
    const features = await loadUpcomingFeatures(vendorId);
    if (!features.length) {
      return { message: "Nu ai nicio promovare programată pentru perioada următoare.", topic };
    }
    const lines = features.map(formatFeatureLine);
    return { message: `Promovări programate:\n\n${lines.join("\n")}`, topic };
  }

  if (topic === "ACTIVE_CAMPAIGNS") {
    const campaigns = await loadActiveCampaigns(vendorId);
    if (!campaigns.length) {
      return { message: "Nu ai nicio campanie proprie activă momentan.", topic };
    }
    const lines = campaigns.map(
      (c, i) =>
        `${i + 1}. ${c.name} - discount ${c.discountPercent}%, comision ${c.commissionBps / 100}%, ${c.visits} vizite, ${c.attributedOrdersCount} comenzi atribuite`
    );
    return { message: `Campanii proprii active:\n\n${lines.join("\n")}`, topic };
  }

  return null;
}
