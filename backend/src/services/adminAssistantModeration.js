// backend/src/services/adminAssistantModeration.js

/*
 * Asistent Admin - întrebări despre moderarea produselor, STRICT
 * read-only (nu aprobă / nu respinge nimic). Apelat din
 * copilotRouter.js DOAR pentru audience ADMIN, înaintea restului
 * rutării; dacă mesajul nu e despre moderare întoarce null și
 * copilotul continuă exact ca înainte.
 *
 * Datele vin din câmpurile EXISTENTE ale produsului (moderationStatus,
 * reviewedByUserId, aiModeration) - fără coadă separată de moderare.
 * „De verificat" = moderationStatus PENDING (acolo ajung atât
 * NEEDS_ADMIN_REVIEW, cât și produsele fără analiză AI), exact ce
 * arată filtrul „În verificare" din Admin > Produse.
 */

import { prisma as defaultPrisma } from "../db.js";

export const ADMIN_MODERATION_TOPICS = Object.freeze({
  PENDING_COUNT: "PENDING_COUNT",
  PENDING_LIST: "PENDING_LIST",
  BLOCKED: "BLOCKED",
  AUTO_APPROVED: "AUTO_APPROVED",
  WHY_PRODUCT: "WHY_PRODUCT",
  GPSR_EXPLAIN: "GPSR_EXPLAIN",
});

// aceleași etichete ca în AdminProductsTab.jsx (panoul AI)
export const REASON_LABELS = Object.freeze({
  PHONE_NUMBER: "număr de telefon în imagine",
  EMAIL: "adresă de email în imagine",
  URL: "website / link în imagine",
  SOCIAL_HANDLE: "cont social media în imagine",
  QR_CODE: "cod QR în imagine",
  PROMOTIONAL_MATERIAL: "material promoțional în loc de poză de produs",
  POSSIBLE_PROMOTIONAL_MATERIAL: "posibil material promoțional",
  LOGO: "logo",
  WATERMARK: "watermark",
  PROMOTIONAL_TEXT: "text promoțional suprapus",
  PRODUCT_NOT_VISIBLE: "produsul nu e vizibil clar",
  POSSIBLE_STOCK_PHOTO: "posibilă poză de catalog/stoc",
  LOW_CONFIDENCE: "AI nesigur",
  AI_ANALYSIS_UNAVAILABLE: "analiza AI nu a fost disponibilă",
  POSSIBLE_RESELL: "posibil resell",
  POSSIBLE_INDUSTRIAL: "posibil produs de serie",
  DIGITAL_PRODUCT: "produs digital",
  UNCLEAR_PRODUCT_TYPE: "tip de produs neclar",
  UNCLEAR_HANDMADE: "nu e clar că e handmade",
  TEXT_CONTACT_INFO: "date de contact în text",
  PREVIOUSLY_REJECTED_BY_ADMIN: "respins anterior de un admin",
  GPSR_INCOMPLETE: "GPSR incomplet",
  NO_IMAGES: "fără imagini",
});

const REVIEW_LIST_LINK = "/admin?tab=products&moderation=PENDING";
const BLOCKED_LIST_LINK = "/admin?tab=products&moderation=CHANGES_REQUESTED";
const APPROVED_LIST_LINK = "/admin?tab=products&moderation=APPROVED";
const LIST_LIMIT = 5;

export function productReviewLink(productId) {
  return `/admin?tab=products&productId=${encodeURIComponent(productId)}`;
}

function normalize(text = "") {
  return String(text)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const REVIEW_WORDS = "(verific|review|revizu|asteptare|aprobare|moderare)";

/*
 * Detector determinist (fără LLM). Ordinea contează: întrebările
 * despre UN produs / GPSR înaintea celor despre liste.
 */
export function detectAdminModerationTopic(message = "") {
  const t = normalize(message);
  if (!t) return null;

  if (
    /\bde ce\b.{0,60}\b(verific|review|blocat|respins|ajuns|asteptare|pending)/.test(t) ||
    /\bmotiv\w*\b.{0,40}\bprodus/.test(t)
  ) {
    return ADMIN_MODERATION_TOPICS.WHY_PRODUCT;
  }

  if (/\bgpsr\b/.test(t)) {
    return ADMIN_MODERATION_TOPICS.GPSR_EXPLAIN;
  }

  if (/\bprodus\w*\b.{0,40}\bblocat\w*|\bblocat\w*\b.{0,30}\b(de )?ai\b/.test(t)) {
    return ADMIN_MODERATION_TOPICS.BLOCKED;
  }

  if (/\bauto\s?aprobat\w*|\baprobat\w*\b.{0,15}\bautomat/.test(t)) {
    return ADMIN_MODERATION_TOPICS.AUTO_APPROVED;
  }

  if (
    new RegExp(`\\b(cate|numar\\w*)\\b.{0,40}\\bprodus\\w*\\b.{0,40}${REVIEW_WORDS}`).test(t)
  ) {
    return ADMIN_MODERATION_TOPICS.PENDING_COUNT;
  }

  if (
    new RegExp(`\\b(arata|lista|listeaza|care|ce|deschide)\\w*\\b.{0,40}\\bprodus\\w*\\b.{0,50}${REVIEW_WORDS}`).test(t) ||
    new RegExp(`\\bprodus\\w*\\b.{0,15}\\bde\\s+${REVIEW_WORDS}`).test(t)
  ) {
    return ADMIN_MODERATION_TOPICS.PENDING_LIST;
  }

  return null;
}

export function describeReasons(reasons) {
  return (Array.isArray(reasons) ? reasons : [])
    .map((code) => REASON_LABELS[code] || null)
    .filter(Boolean);
}

/*
 * Motiv scurt pentru o listă (clopoțel / asistent). Produsele fără
 * analiză AI (vechi sau cu moderarea AI oprită) sunt în coada manuală.
 */
export function shortReviewReason(product) {
  const ai = product?.aiModeration;

  if (!ai || !ai.decision) {
    return "verificare manuală (fără analiză AI)";
  }

  const labels = describeReasons(ai.reasons);

  return labels.length ? labels.slice(0, 3).join(", ") : "necesită verificare";
}

function formatRoDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  return date.toLocaleString("ro-RO", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const PRODUCT_LIST_SELECT = {
  id: true,
  title: true,
  moderationStatus: true,
  submittedAt: true,
  approvedAt: true,
  reviewedAt: true,
  reviewedByUserId: true,
  createdAt: true,
  aiModeration: true,
};

async function isAdminUser(db, userSub) {
  if (!userSub) return false;

  const user = await db.user.findUnique({
    where: { id: userSub },
    select: { role: true },
  });

  return String(user?.role || "").toUpperCase() === "ADMIN";
}

/* =========================================================
   Răspunsuri
========================================================= */

async function answerPendingCount(db) {
  const pending = await db.product.findMany({
    where: { moderationStatus: "PENDING" },
    select: { id: true, aiModeration: true },
    take: 1000,
  });

  const total = await db.product.count({
    where: { moderationStatus: "PENDING" },
  });

  const gpsrOnly = pending.filter((p) => {
    const reasons = p.aiModeration?.reasons;
    return Array.isArray(reasons) && reasons.length === 1 && reasons[0] === "GPSR_INCOMPLETE";
  }).length;

  const withoutAi = pending.filter((p) => !p.aiModeration?.decision).length;
  const aiFlagged = pending.length - gpsrOnly - withoutAi;

  const parts = [];
  if (aiFlagged > 0) parts.push(`${aiFlagged} semnalate de AI pentru verificare`);
  if (gpsrOnly > 0) parts.push(`${gpsrOnly} așteaptă doar completarea GPSR de către vânzător`);
  if (withoutAi > 0) parts.push(`${withoutAi} fără analiză AI (verificare manuală)`);

  const message =
    total === 0
      ? "Nu ai niciun produs de verificat acum."
      : `Ai ${total} ${total === 1 ? "produs" : "produse"} de verificat.` +
        (parts.length ? `\n\nDin care: ${parts.join("; ")}.` : "");

  return {
    resultType: "answer",
    message,
    links: total ? [{ label: "Deschide produsele de verificat", href: REVIEW_LIST_LINK }] : [],
  };
}

async function answerPendingList(db) {
  const [items, total] = await Promise.all([
    db.product.findMany({
      where: { moderationStatus: "PENDING" },
      orderBy: { submittedAt: "desc" },
      take: LIST_LIMIT,
      select: PRODUCT_LIST_SELECT,
    }),
    db.product.count({ where: { moderationStatus: "PENDING" } }),
  ]);

  if (!items.length) {
    return {
      resultType: "answer",
      message: "Nu ai niciun produs de verificat acum.",
      links: [],
    };
  }

  const lines = items.map(
    (p, i) =>
      `${i + 1}. „${p.title || "Produs fără titlu"}” - ${shortReviewReason(p)}` +
      (p.submittedAt ? ` (${formatRoDate(p.submittedAt)})` : "")
  );

  return {
    resultType: "answer",
    message:
      `Produse care au nevoie de verificare (${total} în total, cele mai recente ${items.length}):\n\n` +
      lines.join("\n"),
    links: [
      ...items.map((p) => ({
        label: `Verifică: ${p.title || p.id}`,
        href: productReviewLink(p.id),
      })),
      { label: "Toate produsele de verificat", href: REVIEW_LIST_LINK },
    ],
  };
}

async function answerBlocked(db) {
  const where = {
    moderationStatus: "CHANGES_REQUESTED",
    reviewedByUserId: null,
    aiModeration: { path: ["decision"], equals: "BLOCK_PUBLICATION" },
  };

  const [items, total] = await Promise.all([
    db.product.findMany({
      where,
      orderBy: { reviewedAt: "desc" },
      take: LIST_LIMIT,
      select: PRODUCT_LIST_SELECT,
    }),
    db.product.count({ where }),
  ]);

  if (!items.length) {
    return {
      resultType: "answer",
      message: "Nu există produse blocate acum de verificarea AI.",
      links: [],
    };
  }

  const lines = items.map((p, i) => {
    const blocked = (p.aiModeration?.images || [])
      .filter((img) => img?.blockIssues?.length)
      .map((img) => `imaginea ${Number(img.index) + 1}: ${describeReasons(img.blockIssues).join(", ")}`);

    return `${i + 1}. „${p.title || "Produs fără titlu"}” - ${blocked.join("; ") || "imagine neconformă"}`;
  });

  return {
    resultType: "answer",
    message:
      `Produse blocate de AI (${total}). Vânzătorii au fost rugați să înlocuiască imaginile; ` +
      `produsul se reverifică automat după salvare.\n\n${lines.join("\n")}`,
    links: [
      ...items.map((p) => ({ label: `Vezi: ${p.title || p.id}`, href: productReviewLink(p.id) })),
      { label: "Toate produsele cu modificări cerute", href: BLOCKED_LIST_LINK },
    ],
  };
}

async function answerAutoApproved(db) {
  const where = {
    moderationStatus: "APPROVED",
    reviewedByUserId: null,
    aiModeration: { path: ["decision"], equals: "AUTO_APPROVE" },
  };

  const [items, total] = await Promise.all([
    db.product.findMany({
      where,
      orderBy: { approvedAt: "desc" },
      take: LIST_LIMIT,
      select: PRODUCT_LIST_SELECT,
    }),
    db.product.count({ where }),
  ]);

  if (!items.length) {
    return {
      resultType: "answer",
      message: "Nu există încă produse aprobate automat de AI.",
      links: [],
    };
  }

  const lines = items.map(
    (p, i) =>
      `${i + 1}. „${p.title || "Produs fără titlu"}”` +
      (p.approvedAt ? ` (${formatRoDate(p.approvedAt)})` : "")
  );

  return {
    resultType: "answer",
    message: `Produse aprobate automat de AI (${total} în total, cele mai recente ${items.length}):\n\n${lines.join("\n")}`,
    links: [
      ...items.map((p) => ({ label: `Vezi: ${p.title || p.id}`, href: productReviewLink(p.id) })),
      { label: "Toate produsele aprobate", href: APPROVED_LIST_LINK },
    ],
  };
}

const GPSR_EXPLANATION =
  "GPSR (Regulamentul UE 2023/988 privind siguranța produselor) cere ca fiecare produs să aibă informații de siguranță. " +
  "Pe Artfest, un produs are GPSR complet când vânzătorul a precizat:\n" +
  "• cine este producătorul (el însuși sau alt producător, cu nume, adresă și email);\n" +
  "• dacă producătorul e din afara UE - persoana responsabilă din UE (nume, adresă, email);\n" +
  "• avertismentele de siguranță (sau confirmarea explicită că nu se aplică);\n" +
  "• dacă produsul este destinat copiilor.\n\n" +
  "„GPSR incomplet” în verificarea AI înseamnă că produsul e altfel conform, dar nu se aprobă automat până nu completează vânzătorul aceste date - el a primit deja un mesaj cu exact ce lipsește, iar după completare produsul se aprobă automat. " +
  "Tu îl poți aproba manual oricând, ca până acum.";

function extractProductHint(message = "") {
  const quoted = String(message).match(/[„"«]([^”"»]{2,120})[”"»]/);
  if (quoted) return quoted[1].trim();

  const named = String(message).match(/produsul\s+(?!acesta\b|asta\b|acela\b)(.{2,120}?)\s+(la|a|în|in|e|este)\b/i);
  return named ? named[1].trim() : null;
}

async function answerWhyProduct(db, { message, currentEntity }) {
  let product = null;

  if (currentEntity?.type === "PRODUCT" && currentEntity.id) {
    product = await db.product.findUnique({
      where: { id: String(currentEntity.id) },
      select: PRODUCT_LIST_SELECT,
    });
  }

  if (!product) {
    const hint = extractProductHint(message);

    if (hint) {
      product = await db.product.findFirst({
        where: { title: { contains: hint, mode: "insensitive" } },
        orderBy: { updatedAt: "desc" },
        select: PRODUCT_LIST_SELECT,
      });
    }
  }

  if (!product) {
    return {
      resultType: "answer",
      message:
        "Despre care produs? Deschide-l din Admin > Produse (apoi întreabă-mă din nou) sau scrie-i numele între ghilimele, de exemplu: de ce a ajuns „Lumânare din soia” la verificare?",
      links: [{ label: "Produsele de verificat", href: REVIEW_LIST_LINK }],
    };
  }

  const ai = product.aiModeration;
  const title = product.title || "Produs fără titlu";
  const status = String(product.moderationStatus || "PENDING");
  const links = [{ label: "Verifică produsul", href: productReviewLink(product.id) }];

  if (!ai || !ai.decision) {
    return {
      resultType: "answer",
      message: `„${title}” nu are o analiză AI (produs mai vechi sau salvat înainte de moderarea automată), așa că e în verificarea manuală obișnuită. Status actual: ${status}.`,
      links,
    };
  }

  const reasons = describeReasons(ai.reasons);

  const problemImages = (ai.images || [])
    .filter((img) => img?.issues?.length)
    .map((img) => `imaginea ${Number(img.index) + 1}: ${describeReasons(img.issues).join(", ")}`);

  const classification = ai.classification?.analyzed
    ? `Clasificare: ${ai.classification.type}, handmade ${Math.round((ai.classification.handmadeConfidence || 0) * 100)}%` +
      (ai.classification.possibleResell ? ", posibil resell" : "") + "."
    : "Clasificarea AI nu a fost disponibilă.";

  const verdict =
    ai.decision === "AUTO_APPROVE"
      ? "AI-ul l-a considerat conform și l-a aprobat automat"
      : ai.decision === "BLOCK_PUBLICATION"
        ? "AI-ul a blocat publicarea (date de contact / material promoțional clar în imagini)"
        : "AI-ul l-a trimis la verificare manuală";

  const adminNote = product.reviewedByUserId
    ? " Un admin a luat între timp o decizie manuală pe el."
    : "";

  return {
    resultType: "answer",
    message:
      `„${title}”: ${verdict} (încredere ${Math.round((ai.confidence || 0) * 100)}%).${adminNote}\n\n` +
      (reasons.length ? `Motive: ${reasons.join(", ")}.\n` : "") +
      (problemImages.length ? `Imagini cu probleme: ${problemImages.join("; ")}.\n` : "") +
      classification,
    links,
  };
}

/* =========================================================
   Punct de intrare
========================================================= */

/*
 * Returnează null dacă mesajul nu e despre moderare sau utilizatorul
 * nu e ADMIN (verificat din DB, nu doar din token) - copilotul
 * continuă atunci neschimbat.
 */
export async function answerAdminModerationQuestion({
  message,
  userSub,
  currentEntity = null,
  db = defaultPrisma,
}) {
  const topic = detectAdminModerationTopic(message);
  if (!topic) return null;

  if (!(await isAdminUser(db, userSub))) return null;

  switch (topic) {
    case ADMIN_MODERATION_TOPICS.PENDING_COUNT:
      return answerPendingCount(db);
    case ADMIN_MODERATION_TOPICS.PENDING_LIST:
      return answerPendingList(db);
    case ADMIN_MODERATION_TOPICS.BLOCKED:
      return answerBlocked(db);
    case ADMIN_MODERATION_TOPICS.AUTO_APPROVED:
      return answerAutoApproved(db);
    case ADMIN_MODERATION_TOPICS.WHY_PRODUCT:
      return answerWhyProduct(db, { message, currentEntity });
    case ADMIN_MODERATION_TOPICS.GPSR_EXPLAIN:
      return {
        resultType: "answer",
        message: GPSR_EXPLANATION,
        links: [{ label: "Produse cu GPSR incomplet", href: "/admin?tab=products&gpsr=1" }],
      };
    default:
      return null;
  }
}
