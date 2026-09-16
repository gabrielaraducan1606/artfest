// backend/src/services/userAssistantReviews.js
//
// USER BATCH 2 (audit USER, 2026-09-08) - serviciu SUBȚIRE, read-only,
// STRICT pentru "câte recenzii am lăsat / ce recenzii am lăsat" -
// singura întrebare despre recenzii proprii care e determinist
// răspunsabilă și are sens real de UI (pagina "Recenziile mele").
// Nu construim topics suplimentare (ex. "recenzii primite" nu are sens
// pentru un cumpărător - acela e un flux de VENDOR, vezi
// vendorAssistantReviews.js).
//
// NU duplică business logic - reutilizează EXACT query-ul din
// reviewsProductRoutes.js (GET /reviews/my): where: { userId }.
//
// Ownership STRICT: userId vine din req.user.sub (server-side, prin
// copilotRouter.js), NICIODATĂ din mesajul liber al userului.

import { prisma } from "../db.js";

function normalizeForDetection(text) {
  return String(text || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

export function detectUserReviewsTopic(message, { lastCategory } = {}) {
  const t = normalizeForDetection(message);

  const mentionsReviews = /\brecenzi/.test(t);

  const inheritsContext =
    !mentionsReviews &&
    lastCategory === "reviews" &&
    /\bcate\b|\bce\b|\bcare\b/.test(t);

  if (!mentionsReviews && !inheritsContext) return null;

  /*
   * "recenzii primite" e un subiect de VÂNZĂTOR (recenzii primite pe
   * produsele lui) - nu e ceva ce are sens pentru un cumpărător, nu
   * interceptăm aici, cade pe knowledge generic.
   */
  if (/primit/.test(t)) return null;

  return "MY_REVIEWS";
}

export async function answerUserReviewsQuestion({ userSub, message, lastCategory }) {
  if (!userSub) return null;

  const topic = detectUserReviewsTopic(message, { lastCategory });
  if (!topic) return null;

  const reviews = await prisma.review.findMany({
    where: { userId: userSub },
    orderBy: { createdAt: "desc" },
    take: 5,
    select: {
      rating: true,
      product: { select: { title: true } },
    },
  });

  if (!reviews.length) {
    return {
      resultType: "answer",
      topicId: "reviews",
      message: "Nu ai lăsat nicio recenzie momentan.",
    };
  }

  const total = await prisma.review.count({ where: { userId: userSub } });
  const lines = reviews.map(
    (r, i) => `${i + 1}. ${r.product?.title || "Produs"} - ${r.rating}/5`
  );

  return {
    resultType: "answer",
    topicId: "reviews",
    message: `Ai lăsat ${total === 1 ? "1 recenzie" : `${total} recenzii`}:\n\n${lines.join("\n")}`,
  };
}
