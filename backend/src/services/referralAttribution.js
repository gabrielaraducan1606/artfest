// backend/src/services/referralAttribution.js
//
// Atribuire de referral REQUEST-BASED (influencer + vendor) la plasarea
// comenzii - un singur punct folosit de checkout (user/guest) și oferte.
//
// Frontend-ul nu știe tipul unui ?ref= (influencer și vendor folosesc același
// parametru) și nu face request la captură. Trimite, din memoria aplicației:
//   referralCodes: [{ code, at }]            - ?ref= explicite, cele mai recente întâi
//   influencerCollectionReferralCode         - proprietarul colecției de influencer (fallback)
//   influencerReferralCode / vendorReferralCode - compatibilitate (ultimul cod)
//
// Serverul reproduce EXACT semantica tokenurilor vechi (câte unul pe tip):
//   influencer = cel mai recent cod VALID de influencer; altfel proprietarul
//                colecției (dacă e valid); altfel tokenul vechi (tranziție);
//   vendor     = cel mai recent cod VALID de vendor (issuedAt = momentul
//                capturii, pt. last-click față de VendorCollection); altfel
//                tokenul vechi (tranziție).
// Codurile din client NU sunt de încredere: fiecare trece prin validarea
// existentă (influencer ACTIVE / colaborare / procent; vendor activ / procent).
// Prioritățile dintre ele (influencer vs vendor, cod de reducere, campanii,
// own-sale) rămân în resolveShipmentPromoter - neschimbate.

import { prisma } from "../db.js";
import {
  resolveInfluencerAttribution,
  resolveInfluencerAttributionByReferralCode,
} from "./influencerAttribution.js";
import {
  resolveVendorCollectionAttribution,
  resolveVendorCollectionAttributionBySlug,
  resolveVendorReferralAttribution,
  resolveVendorReferralAttributionByCode,
} from "./vendorAttribution.js";

const MAX_REFERRAL_CODES = 5;
const MAX_VENDOR_COLLECTION_SLUGS = 5;

// vendorCollectionSlugs: [{ slug, at }] (sau string-uri; din query: "a,b") -> curat, distinct, cele mai recente întâi
export function normalizeVendorCollectionSlugs(vendorCollectionSlugs) {
  if (typeof vendorCollectionSlugs === "string") {
    vendorCollectionSlugs = vendorCollectionSlugs.split(",");
  }
  if (!Array.isArray(vendorCollectionSlugs)) return [];

  const seen = new Set();
  const out = [];

  for (const item of vendorCollectionSlugs) {
    const raw = typeof item === "string" ? item : item?.slug;
    if (typeof raw !== "string") continue;
    const slug = raw.trim();
    if (!slug || slug.length > 180 || seen.has(slug)) continue;
    seen.add(slug);
    out.push({ slug, at: typeof item === "object" ? Number(item?.at) || null : null });
    if (out.length >= MAX_VENDOR_COLLECTION_SLUGS) break;
  }

  return out;
}

// [{ code, at }] curat, fără duplicate, cel mult MAX_REFERRAL_CODES
export function normalizeReferralCodes(referralCodes) {
  if (!Array.isArray(referralCodes)) return [];

  const seen = new Set();
  const out = [];

  for (const item of referralCodes) {
    const code = String((typeof item === "string" ? item : item?.code) ?? "").trim();
    if (!code || code.length > 64 || seen.has(code)) continue;
    seen.add(code);
    out.push({ code, at: typeof item === "object" ? Number(item?.at) || null : null });
    if (out.length >= MAX_REFERRAL_CODES) break;
  }

  return out;
}

async function firstResolved(candidates, resolve) {
  for (const candidate of candidates) {
    const resolved = await resolve(candidate);
    if (resolved) return resolved;
  }
  return null;
}

export async function resolveRequestReferralAttributions({
  referralCodes,
  influencerReferralCode,
  influencerCollectionReferralCode,
  vendorReferralCode,
  influencerToken,
  vendorToken,
  vendorCollectionSlugs,
  vendorCollectionToken,
  db = prisma,
} = {}) {
  const explicit = normalizeReferralCodes(referralCodes);

  const influencer =
    (await firstResolved(explicit, ({ code }) =>
      resolveInfluencerAttributionByReferralCode({ referralCode: code, db })
    )) ||
    (await resolveInfluencerAttributionByReferralCode({
      referralCode: influencerCollectionReferralCode,
      db,
    })) ||
    // compatibilitate: bundle-uri care trimit doar câmpul simplu
    (await resolveInfluencerAttributionByReferralCode({
      referralCode: influencerReferralCode,
      db,
    })) ||
    // TRANZIȚIE - DE ELIMINAT: token vechi din bundle-uri vechi
    (await resolveInfluencerAttribution({ token: influencerToken, db }));

  const vendor =
    (await firstResolved(explicit, ({ code, at }) =>
      resolveVendorReferralAttributionByCode({ referralCode: code, capturedAt: at, db })
    )) ||
    (await resolveVendorReferralAttributionByCode({
      referralCode: vendorReferralCode,
      db,
    })) ||
    // TRANZIȚIE - DE ELIMINAT: token vechi din bundle-uri vechi
    (await resolveVendorReferralAttribution({ token: vendorToken, db }));

  /*
   * VendorCollection: cea mai recentă colecție VALIDĂ din navigarea curentă
   * (o singură colecție, ca tokenul vechi - last-click). Apartenența
   * produselor e verificată la checkout, per item.
   */
  const collection =
    (await firstResolved(normalizeVendorCollectionSlugs(vendorCollectionSlugs), ({ slug, at }) =>
      resolveVendorCollectionAttributionBySlug({ slug, capturedAt: at, db })
    )) ||
    // TRANZIȚIE - DE ELIMINAT: token vechi din bundle-uri vechi
    (await resolveVendorCollectionAttribution({ token: vendorCollectionToken, db }));

  return { influencer, vendor, collection };
}

/* =========================================================
   SELF-REFERRAL
   Cumpărătorul nu poate genera câștig de referral către sine:
   - user logat -> vendorul / influencerul legat de contul lui (userId);
   - guest -> vendorul / influencerul al cărui CONT are emailul comenzii.
   Emailul public / de contact al magazinului (Vendor.email) NU identifică
   cumpărătorul: e setat liber din profilul magazinului, neverificat, și poate
   coincide cu emailul altui cont (ex. două magazine cu același contact) ->
   ar bloca fals un referral legitim.
   Aplicat PE CANDIDAȚI, înainte de resolveShipmentPromoter, deci
   prioritățile rămân neschimbate (se trece la următorul promotor valid).
   Own-sale (vendorul pe propriile produse) rămâne conform regulii
   existente - nu generează oricum câștig de referral.
========================================================= */

const EMPTY_SELF = Object.freeze({ vendorIds: new Set(), influencerIds: new Set() });

export async function resolveBuyerSelfIdentity({ userId, email, db = prisma } = {}) {
  const userIds = new Set();
  const vendorIds = new Set();
  const influencerIds = new Set();

  if (userId) userIds.add(String(userId));

  const normalizedEmail = String(email ?? "").trim().toLowerCase();

  if (normalizedEmail) {
    const users = await db.user.findMany({
      where: { email: { equals: normalizedEmail, mode: "insensitive" } },
      select: { id: true },
    });
    users.forEach((u) => userIds.add(String(u.id)));
  }

  if (!userIds.size && !vendorIds.size) return EMPTY_SELF;

  if (userIds.size) {
    const ids = [...userIds];

    const [vendors, influencers] = await Promise.all([
      db.vendor.findMany({ where: { userId: { in: ids } }, select: { id: true } }),
      db.influencerProfile.findMany({ where: { userId: { in: ids } }, select: { id: true } }),
    ]);

    vendors.forEach((v) => vendorIds.add(String(v.id)));
    influencers.forEach((i) => influencerIds.add(String(i.id)));
  }

  return { vendorIds, influencerIds };
}

/*
 * Întoarce candidatul de atribuire sau null dacă ar însemna câștig de
 * referral către cumpărătorul însuși.
 *  - kind "influencer": exclus dacă influencerul e cumpărătorul;
 *  - kind "vendor": exclus dacă vendorul e cumpărătorul ȘI ar fi referral
 *    extern (alt vendor decât cel al shipment-ului); own-sale rămâne.
 */
export function withoutSelfReferral(attribution, { self = EMPTY_SELF, kind, shipmentVendorId } = {}) {
  if (!attribution) return attribution;

  if (kind === "influencer") {
    return self.influencerIds.has(String(attribution.influencerId)) ? null : attribution;
  }

  if (kind === "vendor") {
    const promoterVendorId = String(attribution.vendorId);
    const isOwnSale = shipmentVendorId != null && promoterVendorId === String(shipmentVendorId);
    return !isOwnSale && self.vendorIds.has(promoterVendorId) ? null : attribution;
  }

  return attribution;
}
