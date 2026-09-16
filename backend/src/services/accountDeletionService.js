// backend/src/services/accountDeletionService.js

/*
 * Punct unic de ștergere/anonimizare a unui cont, folosit atât de
 * fluxul self-service (DELETE /api/account/me) cât și de jobul de
 * curățare a conturilor inactive (adminMaintenanceRoutes.js).
 *
 * REGULA CENTRALĂ, care motivează tot ce urmează:
 *
 * NU ștergem niciodată User, Vendor sau InfluencerProfile prin
 * `delete()`. Îi ANONIMIZĂM (păstrăm rândul, golim câmpurile
 * personale neesențiale). Motivele sunt legale, nu tehnice:
 *
 * 1. UserConsent.user și VendorAcceptance.user rămân onDelete: Cascade
 *    (neschimbate în migrarea curentă) - dacă am șterge fizic User,
 *    am pierde dovada acceptării Termenilor/Politicii de
 *    confidențialitate/Acordului Vânzător. Nu putem schimba Prisma
 *    în această etapă - singura soluție compatibilă e să nu ștergem
 *    niciodată rândul User.
 *
 * 2. Invoice.vendor / Invoice.influencer / VendorBilling.vendor /
 *    VendorEarningEntry.vendor / VendorPayout.vendor /
 *    InfluencerPayoutProfile.influencer / InfluencerEarningEntry.influencer /
 *    InfluencerPayout.influencer sunt onDelete: Restrict (migrarea
 *    "add_account_retention_protection") - documente/evidențe
 *    financiar-contabile, retenție legală 5 ani de la 1 iulie a anului
 *    următor încheierii exercițiului financiar (Legea contabilității
 *    nr. 82/1991, art. 25, forma actuală după Legea nr. 36/2023).
 *    Nu încercăm NICIODATĂ să ștergem Vendor/InfluencerProfile - deci
 *    aceste constrângeri nu se declanșează niciodată în fluxul normal;
 *    rămân doar ca plasă de siguranță împotriva unui viitor cod care
 *    ar încerca din greșeală un delete direct.
 *
 * 3. InfluencerCommissionAgreement.influencer rămâne intenționat
 *    Cascade, dar cum InfluencerProfile nu e niciodată șters, rândurile
 *    lui supraviețuiesc oricum, neatinse - acordurile de comision
 *    rămân ca dovadă, fără nicio acțiune suplimentară necesară aici.
 *
 * 4. InfluencerFile rămâne Cascade (decizie intenționată - documentele
 *    generale ale influencerului nu au regim de retenție fiscală, spre
 *    deosebire de facturi). Cum InfluencerProfile nu mai e șters,
 *    Cascade-ul nu s-ar mai declanșa singur - de aceea ștergem explicit
 *    InfluencerFile (+ obiectul R2 asociat) în acest flux.
 *
 * 5. InfluencerPayoutProfile.iban/bankName/beneficiaryName sunt golite
 *    explicit (minimizare GDPR) - nu sunt referențiate/snapshot-ate de
 *    Invoice/InfluencerPayout/InfluencerEarningEntry, deci golirea lor
 *    nu afectează retenția legală a acelor evidențe. Restul câmpurilor
 *    de profil fiscal (fiscalName/taxId/registrationNumber/fiscalAddress/
 *    city/postalCode) NU sunt atinse - nu există certitudine din cod că
 *    pot fi șterse fără a afecta obligațiile de retenție financiar-
 *    contabilă (Legea 82/1991); rămân semnalate pentru decizie legală.
 *
 * Nu atingem: Order, Shipment, ReturnRequest, Message/MessageThread,
 * Comment/Review/StoreReview - conținut sau evidențe cu valoare proprie,
 * independente de identitatea contului.
 */

import crypto from "node:crypto";
import { DeleteObjectCommand } from "@aws-sdk/client-s3";

import { prisma } from "../db.js";
import { r2Client } from "./r2Storage.js";

const { R2_ACCOUNT_ID, R2_BUCKET_NAME, R2_PUBLIC_BASE_URL } = process.env;

function sha256(value) {
  return crypto.createHash("sha256").update(String(value), "utf8").digest("hex");
}

/*
 * Identică ca logică cu keyFromPublicUrl din uploadRoutes.js /
 * influencerFilesRoutes.js - extrage cheia R2 dintr-un URL public,
 * fără să atingem acele fișiere.
 */
function keyFromPublicUrl(url) {
  const base = R2_PUBLIC_BASE_URL
    ? R2_PUBLIC_BASE_URL.replace(/\/+$/, "")
    : `https://${R2_BUCKET_NAME}.${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;

  if (!url || !url.startsWith(`${base}/`)) return null;

  return url.slice(base.length + 1);
}

function makeAnonymizedVendorName(vendorId) {
  return `Cont șters (${String(vendorId).slice(0, 8)})`;
}

/**
 * Șterge/anonimizează definitiv un cont.
 *
 * @param {object} params
 * @param {string} params.userId
 * @param {string} [params.reason] - doar informativ, pentru loguri (ex. "SELF_SERVICE", "INACTIVE_CLEANUP")
 *
 * @returns {Promise<{
 *   ok: boolean,
 *   status?: number,
 *   error?: string,
 *   alreadyProcessed?: boolean,
 *   hadVendor?: boolean,
 *   hadInfluencerProfile?: boolean,
 * }>}
 *
 * Idempotentă: un al doilea apel pe același userId nu aruncă eroare,
 * doar confirmă că userul e deja procesat.
 */
export async function deleteOrAnonymizeAccount({ userId, reason = "SELF_SERVICE" }) {
  if (!userId) {
    return { ok: false, status: 400, error: "user_id_required" };
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      status: true,
      vendor: { select: { id: true } },
      influencerProfile: { select: { id: true } },
    },
  });

  if (!user) {
    return { ok: false, status: 404, error: "user_not_found" };
  }

  /*
   * Idempotency - al doilea apel (self-service dublu-click, sau
   * jobul de cleanup rulat din nou) nu trebuie să eșueze.
   */
  if (user.status === "DELETED") {
    return {
      ok: true,
      alreadyProcessed: true,
      hadVendor: Boolean(user.vendor),
      hadInfluencerProfile: Boolean(user.influencerProfile),
    };
  }

  const now = new Date();
  const r2KeysToDelete = [];

  await prisma.$transaction(async (tx) => {
    /* =========================================================
       VENDOR - anonimizat, NU șters. Facturile/decontările rămân
       intacte, neatinse.
    ========================================================= */

    if (user.vendor) {
      const vendorId = user.vendor.id;

      await tx.vendor.update({
        where: { id: vendorId },
        data: {
          userId: null,
          anonymizedAt: now,
          isActive: false,

          displayName: makeAnonymizedVendorName(vendorId),
          about: null,
          logoUrl: null,
          coverUrl: null,
          phone: null,
          email: null,
          website: null,
          socials: null,
          address: null,
          delivery: { set: [] },
          city: null,
          citySlug: null,

          entitySelfDeclaredIp: null,
          entitySelfDeclaredUa: null,
          entitySelfDeclaredMeta: null,
        },
      });

      const services = await tx.vendorService.findMany({
        where: { vendorId },
        select: { id: true },
      });

      if (services.length) {
        const serviceIds = services.map((s) => s.id);

        await tx.vendorService.updateMany({
          where: { id: { in: serviceIds } },
          data: { isActive: false, status: "INACTIVE" },
        });

        await tx.product.updateMany({
          where: { serviceId: { in: serviceIds } },
          data: { isHidden: true, isActive: false },
        });
      }

      await tx.notification.updateMany({
        where: { vendorId, archived: false },
        data: { archived: true, readAt: now },
      });

      await tx.messageThread.updateMany({
        where: { vendorId, archived: false },
        data: { archived: true },
      });

      /*
       * NU atingem: VendorBilling, Invoice, VendorPayout,
       * VendorEarningEntry, VendorAcceptance, DiscountCode,
       * VendorCampaign, VendorCollection, referralClicks/Earnings,
       * ReturnRequest, Shipment, Message/MessageThread content.
       */
    }

    /* =========================================================
       INFLUENCER - anonimizat, NU șters. Facturile/payout-urile/
       earnings rămân intacte, neatinse.
    ========================================================= */

    if (user.influencerProfile) {
      const influencerId = user.influencerProfile.id;

      await tx.influencerProfile.update({
        where: { id: influencerId },
        data: {
          userId: null,
          anonymizedAt: now,
          status: "DISABLED",

          displayName: null,
          instagramUrl: null,
          tiktokUrl: null,
          facebookUrl: null,
          websiteUrl: null,
          notes: null,
        },
      });

      /*
       * InfluencerFile rămâne Cascade intenționat, dar cum nu mai
       * ștergem InfluencerProfile, trebuie golit explicit aici -
       * nu au regim de retenție fiscală (spre deosebire de Invoice).
       */
      const files = await tx.influencerFile.findMany({
        where: { influencerId },
        select: { id: true, fileUrl: true },
      });

      for (const file of files) {
        const key = keyFromPublicUrl(file.fileUrl);
        if (key) r2KeysToDelete.push(key);
      }

      await tx.influencerFile.deleteMany({ where: { influencerId } });

      /*
       * InfluencerPayoutProfile rămâne (Restrict) - dar IBAN/bankName/
       * beneficiaryName sunt date de plată redundante odată ce contul e
       * șters (nu se mai poate iniția niciun payout viitor către ele) -
       * le minimizăm prin anonimizare (GDPR data minimization).
       *
       * NU atingem fiscalName/taxId/registrationNumber/fiscalAddress/
       * city/postalCode/beneficiaryType/countryCode - nu se poate stabili
       * cu certitudine din cod dacă identitatea fiscală a influencerului
       * trebuie păstrată alături de InfluencerPayout/InfluencerEarningEntry
       * deja emise, pentru perioada de retenție legală (Legea 82/1991).
       * Rămân neatinse - necesită decizie legală explicită înainte de a
       * fi șterse (semnalat în audit).
       */
      await tx.influencerPayoutProfile.updateMany({
        where: { influencerId },
        data: {
          iban: null,
          bankName: null,
          beneficiaryName: null,
        },
      });

      /*
       * NU atingem: Invoice, InfluencerPayout, InfluencerEarningEntry,
       * InfluencerCommissionAgreement, InfluencerClick, discountCodes,
       * collections, resourceActivities, Shipment (influencerId e deja
       * SetNull acolo, neschimbat).
       */
    }

    /* =========================================================
       DATE STRICT DE CONT - fără nicio obligație de retenție.
       Cascade din User nu se mai declanșează (User nu e șters),
       deci trebuie golite explicit aici.
    ========================================================= */

    await tx.favorite.deleteMany({ where: { userId } });
    await tx.cartItem.deleteMany({ where: { userId } });
    await tx.authAccount.deleteMany({ where: { userId } });
    await tx.passwordResetToken.deleteMany({ where: { userId } });
    await tx.passwordHistory.deleteMany({ where: { userId } });
    await tx.emailVerificationToken.deleteMany({ where: { userId } });
    await tx.userVendorBlock.deleteMany({ where: { userId } });
    await tx.serviceFollow.deleteMany({ where: { userId } });

    /*
     * Notificări PERSONALE (userId) - șterse complet. Distinct de
     * notificările de business ale vendorului (vendorId), arhivate
     * mai sus, nu șterse.
     */
    await tx.notification.deleteMany({ where: { userId } });

    await tx.userMarketingPrefs.upsert({
      where: { userId },
      update: {
        marketingOptIn: false,
        emailEnabled: false,
        smsEnabled: false,
        pushEnabled: false,
        topics: { set: [] },
        updatedAt: now,
      },
      create: {
        userId,
        marketingOptIn: false,
        emailEnabled: false,
        smsEnabled: false,
        pushEnabled: false,
        topics: [],
      },
    });

    /* =========================================================
       USER - anonimizat, NU șters (vezi UserConsent în header).
       tokenVersion incrementat -> orice JWT existent devine invalid
       imediat (enforceTokenVersion); locked=true blochează login-ul
       chiar dacă cineva ar reconstitui manual o cerere.
    ========================================================= */

    await tx.user.update({
      where: { id: userId },
      data: {
        status: "DELETED",
        locked: true,
        tokenVersion: { increment: 1 },

        email: `deleted-${userId}@deleted.local`,
        passwordHash: sha256(`deleted:${userId}:${Date.now()}`),
        googleId: null,

        firstName: null,
        lastName: null,
        phone: null,
        name: null,
        city: null,
        avatarUrl: null,
        preferences: null,
        marketingOptIn: false,

        emailVerifiedAt: null,
        emailChangeToken: null,
        emailChangeNewEmail: null,
        emailChangeExpiresAt: null,
        vendorDeactivateToken: null,
        vendorDeactivateExpiresAt: null,

        inactiveNotifiedAt: null,
        scheduledDeletionAt: null,
      },
    });

    /*
     * NU atingem: UserConsent, LoginAttempt (log de securitate),
     * Order (SetNull deja pe userId), ReturnRequest (SetNull deja),
     * Comment/Review/StoreReview (conținut public existent),
     * Message/MessageThread (conversații, business record al
     * celeilalte părți).
     */
  });

  /*
   * Ștergerea din R2 e I/O extern, ținută în afara tranzacției Prisma.
   * Fail-soft: dacă un obiect R2 nu poate fi șters, nu anulăm
   * anonimizarea deja confirmată în DB - doar logăm.
   */
  for (const key of r2KeysToDelete) {
    try {
      await r2Client.send(
        new DeleteObjectCommand({ Bucket: R2_BUCKET_NAME, Key: key })
      );
    } catch (err) {
      console.error(
        "[accountDeletionService] R2 delete failed for key:",
        key,
        err
      );
    }
  }

  return {
    ok: true,
    reason,
    hadVendor: Boolean(user.vendor),
    hadInfluencerProfile: Boolean(user.influencerProfile),
  };
}
