// backend/src/jobs/quotePriceReminderJob.js

import { prisma } from "../db.js";
import { createVendorNotification } from "../services/notifications.js";

/*
 * Atenționare pentru vendori: produse QUOTE_ONLY fără preț
 * orientativ (priceCents <= 0), deci temporar neeligibile pentru
 * feed-ul Google (vezi googleShoppingFeed.js, filtrul priceCents >
 * 0).
 *
 * IMPORTANT:
 * - DOAR citește produsele (findMany) - nu scrie nimic pe Product,
 *   nu modifică isActive/isHidden/moderationStatus, nu inventează
 *   niciun preț. Produsul rămâne exact cum e - job-ul doar creează
 *   o notificare pentru vendor.
 * - Fără "claim atomic" pe Product (spre deosebire de
 *   followupChecker.js, care scrie followUpNotifiedAt pe
 *   MessageThread) - aici dedup-ul se bazează STRICT pe
 *   `dedupeKey` @unique din Notification, ca să nu fie nevoie de
 *   niciun câmp nou pe Product.
 */
export async function runQuotePriceReminderJob() {
  const products = await prisma.product.findMany({
    where: {
      orderMode: "QUOTE_ONLY",
      priceCents: { lte: 0 },
      isActive: true,
      isHidden: false,
    },

    select: {
      id: true,
      title: true,

      service: {
        select: {
          vendorId: true,

          profile: {
            select: {
              slug: true,
            },
          },
        },
      },
    },

    // Plasă de siguranță - în practică setul e mic (produse
    // existente, deja notificate ies din filtru automat).
    take: 200,
  });

  if (!products.length) {
    console.log(
      "[quotePriceReminderJob] created 0 quote-price-missing notifications"
    );

    return;
  }

  let created = 0;

  for (const product of products) {
    const vendorId = product.service?.vendorId;

    if (!vendorId) {
      continue;
    }

    const productTitle = product.title || "produsul tău";

    /*
     * dedupeKey stabil (fără timestamp) - o singură notificare
     * vreodată per produs, pe modelul notifyVendorOnProductSoldOut
     * (nu pe modelul notifyVendorOnProductModeration, care se
     * repetă la fiecare acțiune).
     */
    const dedupeKey = `quote_price_missing:${product.id}`;

    /*
     * Verificare de existență ÎNAINTE de create - evită excepția
     * P2002 (și zgomotul ei în log) pentru cazul normal, de zi cu
     * zi, în care produsul a fost deja notificat. Constrângerea
     * `dedupeKey @unique` rămâne neatinsă și rămâne plasa de
     * siguranță reală pentru eventuale race conditions (ex. două
     * rulări suprapuse) - try/catch-ul din createVendorNotification
     * nu se schimbă.
     */
    const alreadyNotified = await prisma.notification.findUnique({
      where: { dedupeKey },
      select: { id: true },
    });

    if (alreadyNotified) {
      continue;
    }

    const result = await createVendorNotification(vendorId, {
      dedupeKey,
      type: "system",

      title: "Preț orientativ lipsă",

      body: `Pentru ca produsul „${productTitle}” (cerere de ofertă) să poată fi trimis corect către Google, adaugă un preț orientativ.`,

      link: "/vendor/catalog",

      meta: {
        kind: "quote_price_missing",
        productId: product.id,
        vendorId,
        storeSlug: product.service?.profile?.slug || null,
      },
    });

    if (result) {
      created += 1;
    }
  }

  console.log(
    `[quotePriceReminderJob] created ${created} quote-price-missing notifications (${products.length} eligible products checked)`
  );
}
