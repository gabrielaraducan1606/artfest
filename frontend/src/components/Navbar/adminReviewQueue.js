// src/components/Navbar/adminReviewQueue.js

/*
 * Clopoțelul din navbar-ul Admin - helpere PURE (testabile în node) +
 * fetch-ul listei, fără logică nouă de backend:
 *
 * - „produse de verificat" = moderationStatus PENDING, exact filtrul
 *   „În verificare" din Admin > Produse (acolo ajung și
 *   NEEDS_ADMIN_REVIEW, și GPSR_INCOMPLETE în review, și produsele fără
 *   analiză AI) -> GET /api/admin/products?moderationStatus=PENDING
 *   (endpoint existent, întoarce și `total`);
 * - notificările Admin existente (tichete suport etc.) = unread-count-ul
 *   din /api/notifications, deja folosit de Navbar.
 *
 * Nicio coadă nouă în DB. Un produs apare o singură dată (e un rând de
 * produs, nu o notificare), iar notificările existente nu privesc
 * produse de moderat - deci suma nu dublează nimic.
 */

export const ADMIN_REVIEW_LIST_HREF = "/admin?tab=products&moderation=PENDING";

export const ADMIN_REVIEW_PREVIEW_LIMIT = 5;

export function productReviewHref(productId) {
  return `/admin?tab=products&productId=${encodeURIComponent(productId)}`;
}

const REASON_LABELS = {
  LOGO: "logo",
  WATERMARK: "watermark",
  PROMOTIONAL_TEXT: "text promoțional",
  POSSIBLE_PROMOTIONAL_MATERIAL: "posibil material promoțional",
  PRODUCT_NOT_VISIBLE: "produs neclar în poză",
  POSSIBLE_STOCK_PHOTO: "posibilă poză de catalog",
  LOW_CONFIDENCE: "AI nesigur",
  AI_ANALYSIS_UNAVAILABLE: "analiză AI indisponibilă",
  POSSIBLE_RESELL: "posibil resell",
  POSSIBLE_INDUSTRIAL: "posibil produs de serie",
  DIGITAL_PRODUCT: "produs digital",
  UNCLEAR_PRODUCT_TYPE: "tip neclar",
  UNCLEAR_HANDMADE: "handmade neclar",
  TEXT_CONTACT_INFO: "contact în text",
  PREVIOUSLY_REJECTED_BY_ADMIN: "respins anterior",
  GPSR_INCOMPLETE: "GPSR incomplet",
  NO_IMAGES: "fără imagini",
  PHONE_NUMBER: "telefon în imagine",
  EMAIL: "email în imagine",
  URL: "link în imagine",
  SOCIAL_HANDLE: "cont social în imagine",
  QR_CODE: "cod QR",
  PROMOTIONAL_MATERIAL: "material promoțional",
};

export function shortReviewReason(product) {
  const ai = product?.aiModeration;

  if (!ai || !ai.decision) {
    return "Verificare manuală";
  }

  const labels = (Array.isArray(ai.reasons) ? ai.reasons : [])
    .map((code) => REASON_LABELS[code])
    .filter(Boolean);

  return labels.length ? labels.slice(0, 2).join(", ") : "Necesită verificare";
}

function toCount(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

export function computeAdminBadgeCount({
  pendingProducts = 0,
  unreadNotifications = 0,
} = {}) {
  return toCount(pendingProducts) + toCount(unreadNotifications);
}

export function formatBadge(count) {
  const n = toCount(count);
  if (!n) return "";
  return n > 99 ? "99+" : String(n);
}

export function formatReviewTimestamp(value) {
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

/*
 * `api` injectat (lib/api.js în app) ca modulul să rămână pur.
 * Erorile NU se propagă: clopoțelul nu trebuie să strice navbar-ul.
 */
export async function fetchAdminReviewQueue(
  api,
  { limit = ADMIN_REVIEW_PREVIEW_LIMIT } = {}
) {
  try {
    const params = new URLSearchParams({
      moderationStatus: "PENDING",
      take: String(limit),
      sort: "new",
    });

    const data = await api(`/api/admin/products?${params.toString()}`);

    const items = Array.isArray(data?.items) ? data.items : [];

    return {
      total: toCount(data?.total ?? items.length),
      items: items.map((p) => ({
        id: p.id,
        title: p.title || "Produs fără titlu",
        reason: shortReviewReason(p),
        timestamp: p.submittedAt || p.updatedAt || p.createdAt || null,
        href: productReviewHref(p.id),
      })),
      error: null,
    };
  } catch (error) {
    return { total: 0, items: [], error: error?.message || "error" };
  }
}
