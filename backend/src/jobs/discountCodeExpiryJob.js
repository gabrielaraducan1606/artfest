// backend/src/jobs/discountCodeExpiryJob.js

import { prisma } from "../db.js";
import {
  createVendorNotification,
  createUserNotification,
} from "../services/notifications.js";

/*
 * Notificare in-app pentru VENDOR/INFLUENCER când un cod de reducere
 * expiră (audit 2026-09-23).
 *
 * IMPORTANT:
 * - DOAR citește DiscountCode (findMany) - NU modifică `status`,
 *   `isActive` sau orice alt câmp al codului. Expirarea rămâne
 *   exact ca înainte: calculată live, la validare
 *   (validateDiscountCode.js), niciodată scrisă în DB de acest job.
 * - Fără "claim atomic" pe DiscountCode (spre deosebire de
 *   followupChecker.js) - dedup-ul se bazează STRICT pe `dedupeKey`
 *   @unique din Notification, ca și quotePriceReminderJob.js -
 *   niciun câmp nou pe DiscountCode.
 *
 * DEDUPE PE CICLU DE EXPIRARE (cerut explicit, diferit de
 * quotePriceReminderJob.js): cheia include `endsAt` -
 * `discount_code_expired:{id}:{endsAt ISO}` - NU doar `{id}`. Efect:
 * - același endsAt găsit la rulări succesive => o singură notificare
 *   (verificarea de existență de mai jos + @unique ca plasă de
 *   siguranță finală);
 * - dacă vendorul/influencerul reactivează codul mutând `endsAt` într-o
 *   dată viitoare, iar codul expiră DIN NOU mai târziu, noul `endsAt`
 *   produce o cheie NOUĂ => o notificare nouă, pentru noul ciclu real
 *   de expirare. Istoricul (notificarea veche, cu endsAt-ul vechi)
 *   rămâne neatins, ca istoric.
 *
 * Eligibil pentru notificare: `isActive: true` ȘI `status: "ACTIVE"` -
 * adică exact un cod care ERA încă utilizabil (nimeni nu l-a
 * dezactivat manual) și a expirat "în tăcere". Un cod deja
 * dezactivat manual (isActive: false) NU generează notificare - owner-ul
 * știe deja starea lui (a fost o acțiune a lui), nu e o expirare
 * surprinzătoare.
 */
export async function runDiscountCodeExpiryJob() {
  const now = new Date();

  const codes = await prisma.discountCode.findMany({
    where: {
      endsAt: { lte: now },
      isActive: true,
      status: "ACTIVE",
    },

    select: {
      id: true,
      code: true,
      endsAt: true,
      vendorId: true,
      influencerId: true,
    },

    // Plasă de siguranță - în practică setul e mic (codurile deja
    // notificate pentru acest endsAt ies din procesare mai jos,
    // fără a fi excluse din query).
    take: 200,
  });

  if (!codes.length) {
    console.log(
      "[discountCodeExpiryJob] created 0 discount-code-expired notifications"
    );

    return;
  }

  let created = 0;

  for (const discountCode of codes) {
    try {
      if (!discountCode.endsAt) continue; // gardă - query-ul deja exclude asta

      const dedupeKey = `discount_code_expired:${discountCode.id}:${discountCode.endsAt.toISOString()}`;

      /*
       * Verificare de existență ÎNAINTE de create - evită excepția
       * P2002 (și zgomotul ei în log) pentru cazul normal, de zi cu
       * zi, în care codul a fost deja notificat pentru ACEST endsAt.
       * Constrângerea `dedupeKey @unique` rămâne plasa de siguranță
       * reală pentru eventuale race conditions (ex. două rulări
       * suprapuse) - createVendorNotification/createUserNotification
       * prind deja P2002.
       */
      const alreadyNotified = await prisma.notification.findUnique({
        where: { dedupeKey },
        select: { id: true },
      });

      if (alreadyNotified) continue;

      const title = "Cod de reducere expirat";

      const body =
        `Codul «${discountCode.code}» a expirat și nu mai poate fi ` +
        `folosit. Dacă vrei să îl activezi din nou, intră în Coduri ` +
        `de reducere și modifică perioada de valabilitate.`;

      let result = null;

      if (discountCode.vendorId) {
        result = await createVendorNotification(discountCode.vendorId, {
          dedupeKey,
          type: "system",
          title,
          body,

          // Rută existentă, verificată (vendorNavigation.js) - NU
          // inventată.
          link: "/vendor/catalog?tab=codes",

          meta: {
            kind: "discount_code_expired",
            discountCodeId: discountCode.id,
            vendorId: discountCode.vendorId,
            endsAt: discountCode.endsAt.toISOString(),
          },
        });
      } else if (discountCode.influencerId) {
        /*
         * Notification NU are influencerId - notificarea influencerului
         * se face STRICT prin userId (mirror al
         * notifyInfluencerPayoutProfileIncomplete, notifications.js).
         */
        const influencer = await prisma.influencerProfile.findUnique({
          where: { id: discountCode.influencerId },
          select: { userId: true },
        });

        if (influencer?.userId) {
          result = await createUserNotification(influencer.userId, {
            dedupeKey,
            type: "system",
            title,
            body,
            link: "/influencer?tab=promotion",

            meta: {
              kind: "discount_code_expired",
              discountCodeId: discountCode.id,
              influencerId: discountCode.influencerId,
              endsAt: discountCode.endsAt.toISOString(),
            },
          });
        } else {
          /*
           * Profil de influencer inexistent/fără user legat (date
           * incomplete/orfane) - sărim STRICT acest cod, nu blocăm
           * restul batch-ului.
           */
          console.warn(
            "[discountCodeExpiryJob] influencer profile/user missing for code:",
            discountCode.id,
            discountCode.influencerId
          );
        }
      }

      if (result) created += 1;
    } catch (err) {
      /*
       * Un cod cu date neașteptate/eroare punctuală nu trebuie să
       * blocheze restul batch-ului - sărim la următorul.
       */
      console.error(
        "[discountCodeExpiryJob] failed for discount code:",
        discountCode.id,
        err
      );
    }
  }

  console.log(
    `[discountCodeExpiryJob] created ${created} discount-code-expired notifications (${codes.length} eligible codes checked)`
  );
}
