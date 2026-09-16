// backend/src/services/vendorAssistantReviews.js
//
// BATCH E (audit regression Vendor Assistant, 2026-09-07) - serviciu SUBȚIRE,
// read-only, pentru "câte recenzii am / ratingul meu / câte notificări
// necitite am" puse de un vendor autentificat.
//
// NU duplică logica de business - reutilizează ACELEAȘI interogări ca:
// - GET /api/vendors/me/reviews/kpi (reviewsProductRoutes.js:940 - ATENȚIE:
//   reviewsStoreRoutes.js:1017 definește a doua oară exact același path,
//   dar router-ul lui e montat DUPĂ (server.js:547-548), deci varianta lui
//   e umbrită/inaccesibilă - Express folosește mereu handler-ul primului
//   router montat pe un path deja înregistrat. Folosim aici EXACT query-urile
//   din varianta reală, accesibilă: reviewsProductRoutes.js).
// - StoreRatingStats.avg (schema.prisma:1063-1078) - rating pre-calculat,
//   ținut la zi, NU o "medie simplă" calculată live pe cerere.
// - GET /api/vendor/notifications/unread-count (vendorNotificationsRoutes.js:119)
//   - {vendorId, readAt:null, archived:false}.

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
 * Ordinea contează: "rating"/"nota" înainte de "recenzii" generic (o
 * întrebare despre rating nu e o cerere de numărare a recenziilor).
 * "notificari" + "necitite" pentru contorul de necitite - orice altă
 * întrebare despre notificări (ex. "de ce nu primesc notificări")
 * rămâne STATIC, cade pe manifest.
 */
export function detectReviewsLiveTopic(message) {
  const t = stripDiacritics(message);

  if (/rating|nota (mea|magazinului)/.test(t)) return "MY_RATING";

  if (/recenzi/.test(t) && (/\bcate\b|numar/.test(t))) return "REVIEW_COUNT";

  if (/notificar/.test(t) && /necitit/.test(t)) return "UNREAD_NOTIFICATIONS";

  return null;
}

async function getReviewCounts(vendorId) {
  const vendor = await prisma.vendor.findUnique({
    where: { id: vendorId },
    select: { services: { select: { id: true } } },
  });

  const serviceIds = (vendor?.services || []).map((s) => s.id);
  if (!serviceIds.length) return { product: 0, store: 0 };

  const [storeGroups, productReviews] = await Promise.all([
    prisma.storeReview.groupBy({
      by: ["serviceId"],
      where: { status: "APPROVED", serviceId: { in: serviceIds } },
      _count: { _all: true },
    }),
    prisma.review.findMany({
      where: { status: "APPROVED", product: { serviceId: { in: serviceIds } } },
      select: { id: true },
    }),
  ]);

  const store = storeGroups.reduce((sum, g) => sum + (g._count._all || 0), 0);
  return { product: productReviews.length, store };
}

async function getMyRating(vendorId) {
  const stats = await prisma.storeRatingStats.findMany({
    where: { vendorId },
    select: { avg: true, c1: true, c2: true, c3: true, c4: true, c5: true, serviceId: true },
  });

  if (!stats.length) return null;

  const totalCount = stats.reduce(
    (sum, s) => sum + s.c1 + s.c2 + s.c3 + s.c4 + s.c5,
    0
  );

  if (!totalCount) return null;

  const weightedSum = stats.reduce((sum, s) => sum + Number(s.avg) * (s.c1 + s.c2 + s.c3 + s.c4 + s.c5), 0);
  const avg = weightedSum / totalCount;

  return { avg: Math.round(avg * 10) / 10, count: totalCount };
}

async function getUnreadNotificationsCount(vendorId) {
  return prisma.notification.count({
    where: { vendorId, readAt: null, archived: false },
  });
}

/*
 * Punct de intrare unic pentru copilotRouter.js. Întoarce `null` dacă
 * mesajul NU e o întrebare de sumă/rating din acest domeniu.
 */
export async function answerVendorReviewsQuestion({ vendorId, message }) {
  const topic = detectReviewsLiveTopic(message);
  if (!topic) return null;

  if (topic === "REVIEW_COUNT") {
    const counts = await getReviewCounts(vendorId);
    const total = counts.product + counts.store;

    if (!total) {
      return { message: "Nu ai încă nicio recenzie.", topic };
    }

    return {
      message: `Ai ${total} recenzii în total - ${counts.product} pe produse și ${counts.store} pe magazin.`,
      topic,
    };
  }

  if (topic === "MY_RATING") {
    const rating = await getMyRating(vendorId);

    if (!rating) {
      return { message: "Nu ai încă recenzii de magazin, deci nu există un rating calculat.", topic };
    }

    return {
      message: `Rating-ul magazinului tău este ${rating.avg}/5, calculat din ${rating.count} recenzii.`,
      topic,
    };
  }

  if (topic === "UNREAD_NOTIFICATIONS") {
    const count = await getUnreadNotificationsCount(vendorId);

    if (!count) {
      return { message: "Nu ai nicio notificare necitită.", topic };
    }

    return {
      message: `Ai ${count} notificări necitite.`,
      topic,
    };
  }

  return null;
}
