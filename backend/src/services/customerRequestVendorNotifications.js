// backend/src/services/customerRequestVendorNotifications.js
//
// La publicarea unei cereri de client (POST /api/customer-requests), anunță
// vendorii care au cel puțin un produs PUBLIC în categoria cererii:
//   1. notificare în platformă (Notification, dedupeKey unic);
//   2. email (sendVendorCustomerRequestMatchEmail).
//
// Matching v1 - fără AI: categoria cererii vs categoria principală SAU o
// categorie suplimentară a produselor (productCategoriesInWhere - aceeași
// regulă ca discovery-ul). Produs public = aceleași condiții ca
// GET /api/public/products/:id: activ, neascuns, APPROVED, magazin
// activ (ACTIVE, tip products), vendor activ. Contul vendorului trebuie
// să fie ACTIVE și neblocat.
//
// Anti-spam / idempotență:
//   - interogarea pe Vendor întoarce fiecare vendor o singură dată, oricâte
//     produse/categorii s-ar potrivi;
//   - dedupeKey `customer_request_match:<requestId>:<vendorId>` (unic în DB):
//     a doua rulare (retry / dublu apel) nu mai creează notificarea, iar
//     emailul pleacă DOAR când notificarea a fost creată acum;
//   - un email eșuat e doar logat - notificarea și cererea rămân.

import { prisma } from "../db.js";
import {
  CATEGORY_LABELS,
  productCategoriesInWhere,
} from "../constants/categories.js";
import { sendVendorCustomerRequestMatchEmail } from "../lib/mailer.js";

export const CUSTOMER_REQUEST_MATCH_KIND = "customer_request_vendor_match";

export function customerRequestMatchDedupeKey(requestId, vendorId) {
  return `customer_request_match:${requestId}:${vendorId}`;
}

// categoria cererii (azi una singură) -> listă curată, fără duplicate
export function customerRequestCategories(request) {
  const raw = Array.isArray(request?.categories)
    ? request.categories
    : [request?.category];

  return [...new Set(raw.map((c) => String(c || "").trim()).filter(Boolean))];
}

export function categoryLabel(category) {
  return CATEGORY_LABELS[category] || category || "";
}

function formatMoney(cents, currency = "RON") {
  const value = Number(cents) / 100;
  if (!Number.isFinite(value) || value <= 0) return "";
  return `${value.toLocaleString("ro-RO", { maximumFractionDigits: 2 })} ${currency || "RON"}`;
}

// bugetul exact cum e afișat public pe cerere (min / max / interval)
export function formatRequestBudget(request) {
  const currency = request?.currency || "RON";
  const min = formatMoney(request?.budgetMinCents, currency);
  const max = formatMoney(request?.budgetMaxCents, currency);

  let text = "";
  if (min && max) text = min === max ? max : `${min} - ${max}`;
  else if (max) text = `până la ${max}`;
  else if (min) text = `de la ${min}`;
  if (!text) return "";

  if (request?.budgetType === "PER_ITEM") text += " / bucată";
  else if (request?.budgetType === "TOTAL") text += " (total)";
  return text;
}

export function formatRequestDeadline(request) {
  if (!request?.deliveryDeadline) return "";
  const date = new Date(request.deliveryDeadline);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("ro-RO", { day: "numeric", month: "long", year: "numeric" });
}

/*
 * Vendorii potriviți - DISTINCT pe vendor (query pe Vendor cu `some`).
 * `excludeUserId`: autorul cererii nu se anunță pe sine (dacă are și magazin).
 */
export async function findVendorsForCustomerRequest({ categories, excludeUserId = null, db = prisma }) {
  const categoryWhere = productCategoriesInWhere(categories);
  if (!categoryWhere) return [];

  return db.vendor.findMany({
    where: {
      isActive: true,
      userId: excludeUserId ? { not: excludeUserId } : { not: null },
      user: { is: { status: "ACTIVE", locked: false } },
      services: {
        some: {
          isActive: true,
          status: "ACTIVE",
          type: { is: { code: "products" } },
          products: {
            some: {
              isActive: true,
              isHidden: false,
              moderationStatus: "APPROVED",
              ...categoryWhere,
            },
          },
        },
      },
    },
    select: {
      id: true,
      userId: true,
      displayName: true,
      user: { select: { email: true } },
      billing: { select: { email: true, vendorName: true } },
    },
  });
}

/*
 * Notifică vendorii potriviți pentru o cerere publicată.
 * Nu aruncă niciodată - întoarce un sumar (pentru log / teste).
 */
export async function notifyVendorsAboutCustomerRequest(
  request,
  { db = prisma, sendEmail = sendVendorCustomerRequestMatchEmail, logger = console } = {}
) {
  const summary = { matched: 0, notified: 0, skippedDuplicate: 0, emailed: 0, emailFailed: 0 };

  try {
    if (!request?.id || request.status !== "OPEN") return summary;

    const categories = customerRequestCategories(request);
    if (!categories.length) return summary;

    const vendors = await findVendorsForCustomerRequest({
      categories,
      excludeUserId: request.userId || null,
      db,
    });

    // plasă de siguranță: un vendor o singură dată, chiar dacă DB-ul ar întoarce dubluri
    const unique = [...new Map(vendors.map((v) => [v.id, v])).values()];
    summary.matched = unique.length;

    const label = categoryLabel(categories[0]);
    const link = `/cereri/${encodeURIComponent(request.id)}`;

    for (const vendor of unique) {
      let notification = null;

      try {
        notification = await db.notification.create({
          data: {
            userId: vendor.userId,
            vendorId: vendor.id,
            type: "system",
            title: "O cerere nouă ți s-ar putea potrivi",
            body: `A fost publicată o cerere în categoria ${label}. Vezi detaliile și trimite o ofertă dacă te interesează.`,
            link,
            dedupeKey: customerRequestMatchDedupeKey(request.id, vendor.id),
            meta: {
              kind: CUSTOMER_REQUEST_MATCH_KIND,
              requestId: request.id,
              category: categories[0],
              categories,
              ctaLabel: "Vezi cererea",
            },
          },
        });
      } catch (error) {
        if (error?.code === "P2002") {
          // deja anunțat (retry / dublu apel) - fără a doua notificare / email
          summary.skippedDuplicate += 1;
          continue;
        }
        logger.error?.("[customer-request-match] notification failed:", vendor.id, error?.message || error);
        continue;
      }

      if (!notification) continue;
      summary.notified += 1;

      const to = vendor.billing?.email || vendor.user?.email || null;
      if (!to) continue;

      try {
        await sendEmail({
          to,
          vendorName: vendor.billing?.vendorName || vendor.displayName || "",
          requestId: request.id,
          requestTitle: request.title || "",
          categoryLabel: label,
          budgetText: formatRequestBudget(request),
          deadlineText: formatRequestDeadline(request),
        });
        summary.emailed += 1;
      } catch (error) {
        // notificarea rămâne; cererea rămâne publicată
        summary.emailFailed += 1;
        logger.error?.("[customer-request-match] email failed:", vendor.id, error?.message || error);
      }
    }
  } catch (error) {
    logger.error?.("[customer-request-match] failed:", request?.id, error?.message || error);
  }

  return summary;
}
