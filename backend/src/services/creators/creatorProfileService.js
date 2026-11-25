// backend/src/services/creators/creatorProfileService.js
//
// Artfest Creators, etapa 1a: profilul profesional al influencerului (copie de
// lucru + versiune publică moderată), rețele sociale, portofoliu, oferte cu
// versiuni imuabile, turul ghidat și moderarea din Admin.
//
// Reguli:
//   - Doar conturi INFLUENCER existente (create prin invitație). Contul DISABLED /
//     anonimizat nu poate folosi Creators. Perioada de AFILIERE (3 luni) NU
//     contează aici, iar nimic de aici nu atinge afilierea (comision, coduri,
//     colecții, câștiguri).
//   - Statusuri: DRAFT -> PENDING -> APPROVED | CHANGES_REQUESTED | REJECTED.
//     Public = approvedSnapshot (ultima versiune aprobată). Editările unui profil
//     aprobat NU se publică automat: hasUnpublishedChanges + retrimitere.
//     REJECTED = doar pentru profiluri niciodată aprobate; pentru un profil publicat
//     Adminul cere modificări sau îl suspendă.
//   - Tranzițiile se fac cu updateMany condiționat pe status (dublu click /
//     două taburi / Admin + influencer simultan => o singură tranziție).
//   - Fiecare decizie = un CreatorProfileEvent (istoric append-only, cu autor).
//     Emailul de status se trimite după commit, cu cheie de idempotență = id-ul
//     evenimentului; eșecurile se reiau (retryCreatorProfileEmails).

import { prisma } from "../../db.js";
import {
  CREATOR_EMAIL_MAX_ATTEMPTS,
  CREATOR_LIMITS,
  CREATOR_PATHS,
  CREATOR_TOUR_VERSION,
  isNewCreatorsInfluencer,
} from "../../config/creators.js";
import {
  CreatorError,
  publishProblems,
  slugify,
  validateAvatarUrl,
  validateOffer,
  validatePortfolioItem,
  validateProfilePatch,
  validateReason,
  validateSocialAccounts,
} from "./creatorValidation.js";

export { CreatorError };

const TX = { timeout: 20_000, maxWait: 10_000 };

const CONTENT_FIELDS = ["displayName", "slug", "bio", "avatarUrl", "city", "niches", "preferredCategories", "contentLanguages"];
const PREFERENCE_FIELDS = ["acceptsProducts", "acceptsPaid", "typicalTurnaroundDays", "availableForCollabs", "indicativeFeeCents"];

// stările din care influencerul poate trimite spre aprobare
const SUBMITTABLE = ["DRAFT", "CHANGES_REQUESTED", "APPROVED"];

/* ===================== contul influencerului ===================== */

export async function loadInfluencerAccount(db, userId) {
  if (!userId) throw new CreatorError(401, "unauthenticated", "Autentifică-te din nou.");
  const user = await db.user.findUnique({ where: { id: userId }, select: { id: true, role: true, status: true, email: true, firstName: true, lastName: true } });
  if (!user || user.role !== "INFLUENCER") {
    throw new CreatorError(403, "influencer_required", "Artfest Creators este disponibil doar pentru influencerii Artfest.");
  }
  const influencer = await db.influencerProfile.findUnique({
    where: { userId },
    select: { id: true, userId: true, displayName: true, status: true, anonymizedAt: true, createdAt: true },
  });
  if (!influencer) throw new CreatorError(403, "influencer_required", "Artfest Creators este disponibil doar pentru influencerii Artfest.");
  if (influencer.status !== "ACTIVE" || influencer.anonymizedAt || (user.status && user.status !== "ACTIVE")) {
    throw new CreatorError(403, "influencer_inactive", "Contul tău de influencer nu este activ. Pentru detalii, contactează echipa Artfest.");
  }
  return { user, influencer };
}

async function findProfile(db, influencerId) {
  return db.creatorProfile.findUnique({ where: { influencerId } });
}

async function requireProfile(db, influencerId) {
  const profile = await findProfile(db, influencerId);
  if (!profile) throw new CreatorError(404, "profile_not_found", "Nu ai încă un profil Creators. Începe configurarea.");
  return profile;
}

/* ===================== serializare ===================== */

const sortBy = (key) => (a, b) => (a[key] ?? 0) - (b[key] ?? 0);

export function serializeSocial(s) {
  return {
    platform: s.platform,
    url: s.url,
    handle: s.handle,
    followersDeclared: s.followersDeclared,
    avgViewsDeclared: s.avgViewsDeclared ?? null,
    engagementBps: s.engagementBps ?? null,
  };
}

export function serializePortfolioItem(p) {
  return {
    id: p.id,
    kind: p.kind,
    imageUrl: p.imageUrl || null,
    linkUrl: p.linkUrl || null,
    title: p.title,
    description: p.description || null,
    sort: p.sort ?? 0,
  };
}

// versiunea PUBLICĂ (fără date private: fără email, telefon, IBAN, adresă)
export function buildPublicSnapshot(profile, socials = [], portfolio = []) {
  return {
    displayName: profile.displayName || null,
    slug: profile.slug,
    bio: profile.bio || null,
    avatarUrl: profile.avatarUrl || null,
    city: profile.city || null,
    niches: [...(profile.niches || [])],
    preferredCategories: [...(profile.preferredCategories || [])],
    contentLanguages: [...(profile.contentLanguages || [])],
    socials: [...socials].sort((a, b) => a.platform.localeCompare(b.platform)).map(serializeSocial),
    portfolio: [...portfolio].sort(sortBy("sort")).map(serializePortfolioItem),
  };
}

const sameSnapshot = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/*
 * Profilul e vizibil public (catalog / pagină - etapa 1b) doar dacă:
 * are o versiune aprobată, nu e suspendat, nu e pus pe pauză și contul de
 * influencer e activ. Expirarea perioadei de AFILIERE nu contează.
 */
export function publicVisibility(profile, influencer) {
  if (!profile?.approvedSnapshot) return { visible: false, reason: "not_approved" };
  if (profile.suspendedAt) return { visible: false, reason: "suspended" };
  if (profile.pausedAt) return { visible: false, reason: "paused" };
  if (!influencer || influencer.status !== "ACTIVE" || influencer.anonymizedAt) return { visible: false, reason: "account_inactive" };
  return { visible: true, reason: null };
}

export function tourState(profile, version = CREATOR_TOUR_VERSION) {
  const eligible = Boolean(profile?.onboardingCompletedAt);
  return { version, shouldShow: eligible && (profile.tourSeenVersion ?? 0) < version, seenVersion: profile?.tourSeenVersion ?? 0 };
}

function serializeForInfluencer(profile, socials, portfolio, influencer) {
  return {
    id: profile.id,
    status: profile.status,
    version: profile.version,
    displayName: profile.displayName || "",
    slug: profile.slug,
    slugLocked: Boolean(profile.approvedSnapshot),
    bio: profile.bio || "",
    avatarUrl: profile.avatarUrl || null,
    city: profile.city || "",
    niches: profile.niches || [],
    preferredCategories: profile.preferredCategories || [],
    contentLanguages: profile.contentLanguages || [],
    acceptsProducts: Boolean(profile.acceptsProducts),
    acceptsPaid: Boolean(profile.acceptsPaid),
    typicalTurnaroundDays: profile.typicalTurnaroundDays ?? null,
    availableForCollabs: profile.availableForCollabs !== false,
    indicativeFeeCents: profile.indicativeFeeCents ?? null,
    socials: socials.map(serializeSocial),
    portfolio: [...portfolio].sort(sortBy("sort")).map(serializePortfolioItem),
    hasPublishedVersion: Boolean(profile.approvedSnapshot),
    hasUnpublishedChanges: Boolean(profile.hasUnpublishedChanges),
    submittedAt: profile.submittedAt || null,
    approvedAt: profile.approvedAt || null,
    // mesajul echipei (cerere de modificări / motivul respingerii sau al suspendării)
    moderationMessage: profile.moderationMessage || null,
    suspended: Boolean(profile.suspendedAt),
    suspendedReason: profile.suspendedAt ? profile.suspendedReason || null : null,
    paused: Boolean(profile.pausedAt),
    onboardingCompleted: Boolean(profile.onboardingCompletedAt),
    visibility: publicVisibility(profile, influencer),
    publishProblems: publishProblems(profile, socials),
    tour: tourState(profile),
    canSubmit: canSubmit(profile, socials),
    canEditContent: canEditContent(profile),
  };
}

function canEditContent(profile) {
  return !["PENDING", "REJECTED"].includes(profile.status) && !profile.suspendedAt;
}

function canSubmit(profile, socials) {
  if (profile.suspendedAt || !SUBMITTABLE.includes(profile.status)) return false;
  if (profile.status === "APPROVED" && !profile.hasUnpublishedChanges) return false;
  return publishProblems(profile, socials).length === 0;
}

async function loadParts(db, profileId) {
  const [socials, portfolio] = await Promise.all([
    db.creatorSocialAccount.findMany({ where: { profileId } }),
    db.creatorPortfolioItem.findMany({ where: { profileId }, orderBy: { sort: "asc" } }),
  ]);
  return { socials, portfolio };
}

/* ===================== starea pentru dashboard ===================== */

/*
 * entry:
 *   "setup"     - fără profil (autoOnboarding: influencer nou => redirect la onboarding)
 *   "draft" | "pending" | "changes_requested" | "approved" | "rejected"
 */
export async function getCreatorState({ userId, db = prisma }) {
  const { influencer } = await loadInfluencerAccount(db, userId);
  const profile = await findProfile(db, influencer.id);
  if (!profile) {
    return {
      entry: "setup",
      autoOnboarding: isNewCreatorsInfluencer(influencer.createdAt),
      profile: null,
      offersCount: 0,
    };
  }
  const { socials, portfolio } = await loadParts(db, profile.id);
  const offersCount = await db.creatorOffer.count({ where: { profileId: profile.id, isActive: true } });
  return {
    entry: profile.status.toLowerCase(),
    autoOnboarding: false,
    profile: serializeForInfluencer(profile, socials, portfolio, influencer),
    offersCount,
  };
}

/* ===================== profil: creare + editare ===================== */

async function uniqueSlug(db, base) {
  const root = slugify(base) || "creator";
  const seed = root.length >= 3 ? root : `${root}-creator`;
  for (let i = 0; i < 20; i += 1) {
    const candidate = i === 0 ? seed : `${seed.slice(0, 54)}-${i + 1}`;
    const taken = await db.creatorProfile.findUnique({ where: { slug: candidate }, select: { id: true } });
    if (!taken) return candidate;
  }
  return `${seed.slice(0, 50)}-${Date.now().toString(36)}`;
}

// „Începe configurarea” / „Completez mai târziu”: un singur profil per influencer (@unique)
export async function ensureProfile({ userId, db = prisma }) {
  const { user, influencer } = await loadInfluencerAccount(db, userId);
  const existing = await findProfile(db, influencer.id);
  if (existing) return existing;

  const name = influencer.displayName || [user.firstName, user.lastName].filter(Boolean).join(" ").trim() || null;
  try {
    return await db.$transaction(async (tx) => {
      const created = await tx.creatorProfile.create({
        data: {
          influencerId: influencer.id,
          slug: await uniqueSlug(tx, name || "creator"),
          displayName: name ? name.slice(0, CREATOR_LIMITS.displayNameMax) : null,
          contentLanguages: ["ro"],
        },
      });
      await tx.creatorProfileEvent.create({
        data: { profileId: created.id, type: "CREATED", actorUserId: userId, actorRole: "INFLUENCER" },
      });
      return created;
    }, TX);
  } catch (error) {
    // două cereri simultane: profilul există deja (@unique influencerId)
    if (error?.code === "P2002") return requireProfile(db, influencer.id);
    throw error;
  }
}

async function bumpAndRefresh(tx, profile) {
  const { socials, portfolio } = await loadParts(tx, profile.id);
  const fresh = await tx.creatorProfile.findUnique({ where: { id: profile.id } });
  const hasUnpublishedChanges = fresh.approvedSnapshot ? !sameSnapshot(fresh.approvedSnapshot, buildPublicSnapshot(fresh, socials, portfolio)) : false;
  return tx.creatorProfile.update({
    where: { id: profile.id },
    data: { hasUnpublishedChanges, version: { increment: 1 } },
  });
}

function assertContentEditable(profile) {
  if (profile.suspendedAt) throw new CreatorError(409, "profile_suspended", "Profilul este suspendat. Pentru detalii, contactează echipa Artfest.");
  if (profile.status === "PENDING") {
    throw new CreatorError(409, "profile_pending", "Profilul este în verificare. Îl poți modifica după răspunsul echipei Artfest.");
  }
  if (profile.status === "REJECTED") throw new CreatorError(409, "profile_rejected", "Profilul a fost respins și nu mai poate fi modificat.");
}

export async function updateProfile({ userId, body = {}, uploadPrefix, db = prisma }) {
  const { influencer } = await loadInfluencerAccount(db, userId);
  const profile = await requireProfile(db, influencer.id);

  if (body.expectedVersion !== undefined && Number(body.expectedVersion) !== profile.version) {
    throw new CreatorError(409, "version_conflict", "Profilul a fost modificat între timp (poate în alt tab). Reîncarcă pagina.");
  }

  const data = validateProfilePatch(body, { existingCategories: profile.preferredCategories, existingLanguages: profile.contentLanguages });
  if ("avatarUrl" in body) data.avatarUrl = validateAvatarUrl(body.avatarUrl, { uploadPrefix });

  const touchesContent = CONTENT_FIELDS.some((key) => key in data && JSON.stringify(data[key]) !== JSON.stringify(profile[key]));
  if (touchesContent) assertContentEditable(profile);
  if (!touchesContent) for (const key of CONTENT_FIELDS) delete data[key];

  if ("slug" in data && data.slug !== profile.slug) {
    if (profile.approvedSnapshot) throw new CreatorError(409, "slug_locked", "Adresa profilului nu se mai poate schimba după publicare.");
    const taken = await db.creatorProfile.findUnique({ where: { slug: data.slug }, select: { id: true } });
    if (taken && taken.id !== profile.id) throw new CreatorError(409, "slug_taken", "Adresa aleasă este deja folosită. Încearcă alta.", { fields: { slug: "Adresa este deja folosită." } });
  }

  const preferenceChanges = PREFERENCE_FIELDS.filter((key) => key in data);
  if (!touchesContent && !preferenceChanges.length) return getCreatorState({ userId, db });
  if (profile.status === "REJECTED") assertContentEditable(profile);

  await db.$transaction(async (tx) => {
    const updated = await tx.creatorProfile.updateMany({ where: { id: profile.id, version: profile.version }, data });
    if (updated.count !== 1) throw new CreatorError(409, "version_conflict", "Profilul a fost modificat între timp. Reîncarcă pagina.");
    await bumpAndRefresh(tx, profile);
  }, TX);

  return getCreatorState({ userId, db });
}

export async function replaceSocials({ userId, list, db = prisma }) {
  const { influencer } = await loadInfluencerAccount(db, userId);
  const profile = await requireProfile(db, influencer.id);
  assertContentEditable(profile);
  const socials = validateSocialAccounts(list);

  await db.$transaction(async (tx) => {
    await tx.creatorSocialAccount.deleteMany({ where: { profileId: profile.id } });
    if (socials.length) await tx.creatorSocialAccount.createMany({ data: socials.map((s) => ({ ...s, profileId: profile.id })) });
    await bumpAndRefresh(tx, profile);
  }, TX);
  return getCreatorState({ userId, db });
}

export async function addPortfolioItem({ userId, body, uploadPrefix, db = prisma }) {
  const { influencer } = await loadInfluencerAccount(db, userId);
  const profile = await requireProfile(db, influencer.id);
  assertContentEditable(profile);
  const item = validatePortfolioItem(body, { uploadPrefix });

  await db.$transaction(async (tx) => {
    const count = await tx.creatorPortfolioItem.count({ where: { profileId: profile.id } });
    if (count >= CREATOR_LIMITS.portfolioMax) {
      throw new CreatorError(409, "portfolio_full", `Portofoliul poate avea maximum ${CREATOR_LIMITS.portfolioMax} elemente.`);
    }
    await tx.creatorPortfolioItem.create({ data: { ...item, profileId: profile.id, sort: count } });
    await bumpAndRefresh(tx, profile);
  }, TX);
  return getCreatorState({ userId, db });
}

export async function removePortfolioItem({ userId, itemId, db = prisma }) {
  const { influencer } = await loadInfluencerAccount(db, userId);
  const profile = await requireProfile(db, influencer.id);
  assertContentEditable(profile);
  await db.$transaction(async (tx) => {
    // doar din profilul propriu (fără IDOR)
    const removed = await tx.creatorPortfolioItem.deleteMany({ where: { id: String(itemId), profileId: profile.id } });
    if (!removed.count) throw new CreatorError(404, "item_not_found", "Elementul nu mai există.");
    await bumpAndRefresh(tx, profile);
  }, TX);
  return getCreatorState({ userId, db });
}

/* ===================== trimitere spre aprobare ===================== */

export async function submitForReview({ userId, db = prisma, now = new Date() }) {
  const { influencer } = await loadInfluencerAccount(db, userId);
  const profile = await requireProfile(db, influencer.id);
  const { socials } = await loadParts(db, profile.id);

  if (profile.suspendedAt) throw new CreatorError(409, "profile_suspended", "Profilul este suspendat. Pentru detalii, contactează echipa Artfest.");
  if (profile.status === "PENDING") throw new CreatorError(409, "already_pending", "Profilul este deja în verificare.");
  if (profile.status === "REJECTED") throw new CreatorError(409, "profile_rejected", "Profilul a fost respins și nu mai poate fi retrimis.");
  if (profile.status === "APPROVED" && !profile.hasUnpublishedChanges) {
    throw new CreatorError(409, "nothing_to_submit", "Nu ai modificări noi de trimis. Profilul aprobat este deja publicat.");
  }
  const problems = publishProblems(profile, socials);
  if (problems.length) {
    throw new CreatorError(400, "profile_incomplete", "Mai sunt câteva informații de completat înainte de trimitere.", { problems });
  }

  const event = await db.$transaction(async (tx) => {
    const updated = await tx.creatorProfile.updateMany({
      where: { id: profile.id, status: profile.status, version: profile.version, suspendedAt: null },
      data: {
        status: "PENDING",
        submittedAt: now,
        moderationMessage: null,
        onboardingCompletedAt: profile.onboardingCompletedAt || now,
        version: profile.version + 1,
      },
    });
    if (updated.count !== 1) throw new CreatorError(409, "invalid_transition", "Profilul a fost modificat între timp. Reîncarcă pagina.");
    return tx.creatorProfileEvent.create({
      data: {
        profileId: profile.id,
        type: "SUBMITTED",
        actorUserId: userId,
        actorRole: "INFLUENCER",
        before: { status: profile.status },
        after: { status: "PENDING", resubmission: Boolean(profile.approvedSnapshot) },
      },
    });
  }, TX);

  await notifyAdminsSubmitted(db, { profile, event }).catch((error) => console.error("[creators] notificare admin:", error?.message || error));
  return getCreatorState({ userId, db });
}

async function notifyAdminsSubmitted(db, { profile, event }) {
  const { createUserNotification } = await import("../notifications.js");
  const admins = await db.user.findMany({ where: { role: "ADMIN", status: "ACTIVE" }, select: { id: true }, take: 50 });
  await Promise.all(
    admins.map((admin) =>
      createUserNotification(admin.id, {
        dedupeKey: `creator_profile_submitted:${event.id}:${admin.id}`,
        type: "system",
        title: "Profil Artfest Creators de verificat",
        body: `${profile.displayName || "Un influencer"} a trimis profilul Creators spre aprobare.`,
        link: CREATOR_PATHS.admin(profile.id),
        meta: { kind: "creator_profile_submitted", profileId: profile.id },
      }).catch(() => null)
    )
  );
}

/* ===================== pauză (influencer) + tur ===================== */

export async function setPaused({ userId, paused, db = prisma, now = new Date() }) {
  const { influencer } = await loadInfluencerAccount(db, userId);
  const profile = await requireProfile(db, influencer.id);
  if (Boolean(profile.pausedAt) === Boolean(paused)) return getCreatorState({ userId, db });

  await db.$transaction(async (tx) => {
    const updated = await tx.creatorProfile.updateMany({
      where: { id: profile.id, pausedAt: paused ? null : { not: null } },
      data: { pausedAt: paused ? now : null },
    });
    if (updated.count === 1) {
      await tx.creatorProfileEvent.create({
        data: { profileId: profile.id, type: paused ? "PAUSED" : "RESUMED", actorUserId: userId, actorRole: "INFLUENCER" },
      });
    }
  }, TX);
  return getCreatorState({ userId, db });
}

// turul: finalizat sau omis => nu mai apare pentru această versiune (reluarea manuală nu cere server)
export async function markTourSeen({ userId, version, db = prisma, now = new Date() }) {
  const { influencer } = await loadInfluencerAccount(db, userId);
  const profile = await requireProfile(db, influencer.id);
  const v = Number(version);
  if (!Number.isInteger(v) || v < 1 || v > CREATOR_TOUR_VERSION) throw new CreatorError(400, "invalid_tour_version", "Versiune de tur invalidă.");
  await db.creatorProfile.updateMany({ where: { id: profile.id, tourSeenVersion: { lt: v } }, data: { tourSeenVersion: v, tourSeenAt: now } });
  return { tour: tourState({ ...profile, tourSeenVersion: Math.max(profile.tourSeenVersion ?? 0, v) }) };
}

/* ===================== oferte (versiuni imuabile) ===================== */

function serializeOffer(offer, version) {
  return {
    id: offer.id,
    isActive: offer.isActive,
    disabledByAdmin: Boolean(offer.disabledByAdminAt),
    version: offer.currentVersion,
    title: version?.title || "",
    description: version?.description || null,
    platform: version?.platform || null,
    contentType: version?.contentType || null,
    deliverables: version?.deliverables || [],
    turnaroundDays: version?.turnaroundDays ?? null,
    type: version?.type || null,
    creatorFeeCents: version?.creatorFeeCents ?? null,
    acceptsProduct: Boolean(version?.acceptsProduct),
    conditions: version?.conditions || null,
    updatedAt: offer.updatedAt || offer.createdAt,
  };
}

export async function listOffersFor(db, profileId) {
  const offers = await db.creatorOffer.findMany({ where: { profileId }, orderBy: { createdAt: "asc" } });
  if (!offers.length) return [];
  const versions = await db.creatorOfferVersion.findMany({ where: { offerId: { in: offers.map((o) => o.id) } } });
  return offers.map((offer) =>
    serializeOffer(offer, versions.find((v) => v.offerId === offer.id && v.version === offer.currentVersion))
  );
}

export async function listOffers({ userId, db = prisma }) {
  const { influencer } = await loadInfluencerAccount(db, userId);
  const profile = await requireProfile(db, influencer.id);
  return listOffersFor(db, profile.id);
}

function assertOffersAllowed(profile) {
  if (profile.suspendedAt) throw new CreatorError(409, "profile_suspended", "Profilul este suspendat. Pentru detalii, contactează echipa Artfest.");
  if (profile.status === "REJECTED") throw new CreatorError(409, "profile_rejected", "Profilul a fost respins.");
}

export async function createOffer({ userId, body, db = prisma }) {
  const { influencer } = await loadInfluencerAccount(db, userId);
  const profile = await requireProfile(db, influencer.id);
  assertOffersAllowed(profile);
  const { contentHash, ...content } = validateOffer(body);

  const offer = await db.$transaction(async (tx) => {
    const count = await tx.creatorOffer.count({ where: { profileId: profile.id } });
    if (count >= CREATOR_LIMITS.offersMax) throw new CreatorError(409, "offers_full", `Poți avea maximum ${CREATOR_LIMITS.offersMax} oferte.`);
    const created = await tx.creatorOffer.create({ data: { profileId: profile.id, currentVersion: 1, isActive: true } });
    await tx.creatorOfferVersion.create({ data: { offerId: created.id, version: 1, ...content, contentHash, createdByUserId: userId } });
    return created;
  }, TX);
  return (await listOffersFor(db, profile.id)).find((o) => o.id === offer.id);
}

/*
 * Editare = versiune NOUĂ (cea veche rămâne neschimbată pentru colaborările
 * care o referă). Fără modificări reale => nicio versiune nouă.
 * expectedVersion protejează de editări simultane.
 */
export async function updateOffer({ userId, offerId, body, db = prisma }) {
  const { influencer } = await loadInfluencerAccount(db, userId);
  const profile = await requireProfile(db, influencer.id);
  assertOffersAllowed(profile);
  const { contentHash, ...content } = validateOffer(body);

  await db.$transaction(async (tx) => {
    const offer = await tx.creatorOffer.findFirst({ where: { id: String(offerId), profileId: profile.id } });
    if (!offer) throw new CreatorError(404, "offer_not_found", "Oferta nu există.");
    if (body.expectedVersion !== undefined && Number(body.expectedVersion) !== offer.currentVersion) {
      throw new CreatorError(409, "version_conflict", "Oferta a fost modificată între timp. Reîncarcă pagina.");
    }
    const current = await tx.creatorOfferVersion.findUnique({ where: { offerId_version: { offerId: offer.id, version: offer.currentVersion } } });
    if (current?.contentHash === contentHash) return;
    const next = offer.currentVersion + 1;
    const bumped = await tx.creatorOffer.updateMany({ where: { id: offer.id, currentVersion: offer.currentVersion }, data: { currentVersion: next } });
    if (bumped.count !== 1) throw new CreatorError(409, "version_conflict", "Oferta a fost modificată între timp. Reîncarcă pagina.");
    await tx.creatorOfferVersion.create({ data: { offerId: offer.id, version: next, ...content, contentHash, createdByUserId: userId } });
  }, TX);
  return (await listOffersFor(db, profile.id)).find((o) => o.id === String(offerId));
}

export async function setOfferActive({ userId, offerId, active, db = prisma }) {
  const { influencer } = await loadInfluencerAccount(db, userId);
  const profile = await requireProfile(db, influencer.id);
  const offer = await db.creatorOffer.findFirst({ where: { id: String(offerId), profileId: profile.id } });
  if (!offer) throw new CreatorError(404, "offer_not_found", "Oferta nu există.");
  if (active) {
    assertOffersAllowed(profile);
    if (offer.disabledByAdminAt) throw new CreatorError(409, "offer_disabled_by_admin", "Oferta a fost dezactivată de echipa Artfest și nu poate fi reactivată.");
  }
  await db.creatorOffer.updateMany({ where: { id: offer.id, profileId: profile.id }, data: { isActive: Boolean(active) } });
  return (await listOffersFor(db, profile.id)).find((o) => o.id === offer.id);
}

/* ===================== Admin: listă + detaliu ===================== */

const ADMIN_STATUSES = ["DRAFT", "PENDING", "CHANGES_REQUESTED", "APPROVED", "REJECTED"];

// numărul real de profiluri trimise spre aprobare (contorul din Admin; o singură numărătoare indexată)
export async function adminPendingCount({ db = prisma } = {}) {
  return db.creatorProfile.count({ where: { status: "PENDING" } });
}

export async function adminListProfiles({ status = null, q = "", suspended = null, page = 1, pageSize = 25, db = prisma }) {
  const where = {};
  if (status) {
    if (!ADMIN_STATUSES.includes(status)) throw new CreatorError(400, "invalid_status", "Status invalid.");
    where.status = status;
  }
  if (suspended === true) where.suspendedAt = { not: null };
  const text = String(q || "").trim().toLowerCase();
  if (text) where.OR = [{ displayName: { contains: text, mode: "insensitive" } }, { slug: { contains: text } }];

  const size = Math.min(Math.max(Number(pageSize) || 25, 1), 100);
  const current = Math.max(Number(page) || 1, 1);
  const [rows, total, pending] = await Promise.all([
    db.creatorProfile.findMany({ where, orderBy: { updatedAt: "desc" }, skip: (current - 1) * size, take: size }),
    db.creatorProfile.count({ where }),
    db.creatorProfile.count({ where: { status: "PENDING" } }),
  ]);
  return {
    items: rows.map((p) => ({
      id: p.id,
      displayName: p.displayName,
      slug: p.slug,
      avatarUrl: p.avatarUrl,
      status: p.status,
      submittedAt: p.submittedAt,
      approvedAt: p.approvedAt,
      hasUnpublishedChanges: Boolean(p.hasUnpublishedChanges),
      hasPublishedVersion: Boolean(p.approvedSnapshot),
      suspended: Boolean(p.suspendedAt),
      paused: Boolean(p.pausedAt),
      updatedAt: p.updatedAt,
    })),
    total,
    page: current,
    pageSize: size,
    pendingCount: pending,
  };
}

export async function adminGetProfile({ id, db = prisma }) {
  const profile = await db.creatorProfile.findUnique({ where: { id: String(id) } });
  if (!profile) throw new CreatorError(404, "profile_not_found", "Profilul nu există.");
  const [{ socials, portfolio }, offers, events, influencer] = await Promise.all([
    loadParts(db, profile.id),
    listOffersFor(db, profile.id),
    db.creatorProfileEvent.findMany({ where: { profileId: profile.id }, orderBy: { createdAt: "asc" } }),
    db.influencerProfile.findUnique({ where: { id: profile.influencerId }, select: { id: true, userId: true, displayName: true, status: true, anonymizedAt: true, createdAt: true } }),
  ]);
  const user = influencer?.userId
    ? await db.user.findUnique({ where: { id: influencer.userId }, select: { id: true, email: true, firstName: true, lastName: true } })
    : null;

  return {
    profile: {
      ...serializeForInfluencer(profile, socials, portfolio, influencer),
      reviewedAt: profile.reviewedAt || null,
      suspendedAt: profile.suspendedAt || null,
      // ce vede publicul acum (ultima versiune aprobată) vs. ce a trimis influencerul
      approvedSnapshot: profile.approvedSnapshot || null,
      submittedSnapshot: buildPublicSnapshot(profile, socials, portfolio),
    },
    // doar pentru Admin (identificarea contului); nu apare niciodată public
    account: {
      influencerId: influencer?.id || null,
      influencerStatus: influencer?.status || null,
      email: user?.email || null,
      name: [user?.firstName, user?.lastName].filter(Boolean).join(" ") || influencer?.displayName || null,
      influencerSince: influencer?.createdAt || null,
    },
    offers,
    events: events.map((e) => ({
      id: e.id,
      type: e.type,
      actorRole: e.actorRole,
      actorUserId: e.actorUserId,
      reason: e.reason || null,
      emailStatus: e.emailStatus,
      createdAt: e.createdAt,
    })),
    actions: adminActionsFor(profile),
  };
}

export function adminActionsFor(profile) {
  const suspended = Boolean(profile.suspendedAt);
  return {
    canApprove: profile.status === "PENDING" && !suspended,
    canRequestChanges: ["PENDING", "APPROVED", "REJECTED"].includes(profile.status) && !suspended,
    // respingere doar pentru profiluri niciodată publicate
    canReject: profile.status === "PENDING" && !profile.approvedSnapshot && !suspended,
    canSuspend: !suspended && Boolean(profile.approvedSnapshot),
    canUnsuspend: suspended,
  };
}

/* ===================== Admin: moderare ===================== */

const MODERATION = {
  approve: { from: ["PENDING"], event: "APPROVED", notify: "approved" },
  request_changes: { from: ["PENDING", "APPROVED", "REJECTED"], event: "CHANGES_REQUESTED", notify: "changes_requested", reasonRequired: true },
  reject: { from: ["PENDING"], event: "REJECTED", notify: "rejected", reasonRequired: true },
  suspend: { event: "SUSPENDED", notify: "suspended", reasonRequired: true },
  unsuspend: { event: "UNSUSPENDED", notify: null },
};

export async function adminModerate({ id, action, adminId, reason = null, db = prisma, now = new Date() }) {
  const rule = MODERATION[action];
  if (!rule) throw new CreatorError(400, "invalid_action", "Acțiune invalidă.");
  const message = validateReason(reason, { required: Boolean(rule.reasonRequired) });

  const event = await db.$transaction(async (tx) => {
    const profile = await tx.creatorProfile.findUnique({ where: { id: String(id) } });
    if (!profile) throw new CreatorError(404, "profile_not_found", "Profilul nu există.");
    const allowed = adminActionsFor(profile);
    const permitted = {
      approve: allowed.canApprove,
      request_changes: allowed.canRequestChanges,
      reject: allowed.canReject,
      suspend: allowed.canSuspend,
      unsuspend: allowed.canUnsuspend,
    }[action];
    if (!permitted) {
      throw new CreatorError(409, "invalid_transition", "Statusul profilului nu permite această acțiune.", { currentStatus: profile.status });
    }

    let data;
    let where = { id: profile.id, version: profile.version };
    if (action === "approve") {
      const { socials, portfolio } = await loadParts(tx, profile.id);
      data = {
        status: "APPROVED",
        approvedSnapshot: buildPublicSnapshot(profile, socials, portfolio),
        approvedAt: now,
        hasUnpublishedChanges: false,
        moderationMessage: null,
        reviewedAt: now,
        reviewedById: adminId,
      };
      where = { ...where, status: "PENDING" };
    } else if (action === "request_changes") {
      data = { status: "CHANGES_REQUESTED", moderationMessage: message, reviewedAt: now, reviewedById: adminId };
      where = { ...where, status: { in: rule.from } };
    } else if (action === "reject") {
      data = { status: "REJECTED", moderationMessage: message, reviewedAt: now, reviewedById: adminId };
      // „niciodată publicat” e verificat mai sus (adminActionsFor); versiunea protejează de schimbări între timp
      where = { ...where, status: "PENDING" };
    } else if (action === "suspend") {
      data = { suspendedAt: now, suspendedById: adminId, suspendedReason: message };
      where = { ...where, suspendedAt: null };
    } else {
      data = { suspendedAt: null, suspendedById: null, suspendedReason: null };
      where = { ...where, suspendedAt: { not: null } };
    }

    const updated = await tx.creatorProfile.updateMany({ where, data: { ...data, version: profile.version + 1 } });
    if (updated.count !== 1) {
      throw new CreatorError(409, "invalid_transition", "Profilul a fost modificat între timp. Reîncarcă pagina.", { currentStatus: profile.status });
    }
    return tx.creatorProfileEvent.create({
      data: {
        profileId: profile.id,
        type: rule.event,
        actorUserId: adminId,
        actorRole: "ADMIN",
        reason: message,
        before: { status: profile.status, suspended: Boolean(profile.suspendedAt) },
        after: { status: data.status || profile.status, suspended: action === "suspend" ? true : action === "unsuspend" ? false : Boolean(profile.suspendedAt) },
        emailStatus: rule.notify ? "PENDING" : "NONE",
      },
    });
  }, TX);

  if (rule.notify) await deliverProfileEventNotification({ eventId: event.id, db });
  return adminGetProfile({ id, db });
}

export async function adminDeactivateOffer({ profileId, offerId, adminId, reason, db = prisma, now = new Date() }) {
  const message = validateReason(reason, { required: true });
  await db.$transaction(async (tx) => {
    const offer = await tx.creatorOffer.findFirst({ where: { id: String(offerId), profileId: String(profileId) } });
    if (!offer) throw new CreatorError(404, "offer_not_found", "Oferta nu există.");
    const updated = await tx.creatorOffer.updateMany({ where: { id: offer.id, disabledByAdminAt: null }, data: { isActive: false, disabledByAdminAt: now } });
    if (updated.count !== 1) throw new CreatorError(409, "already_disabled", "Oferta este deja dezactivată.");
    await tx.creatorProfileEvent.create({
      data: { profileId: offer.profileId, type: "OFFER_DEACTIVATED_BY_ADMIN", actorUserId: adminId, actorRole: "ADMIN", reason: message, after: { offerId: offer.id } },
    });
  }, TX);
  return adminGetProfile({ id: profileId, db });
}

/* ===================== notificare + email de status (retry, fără duplicate) ===================== */

const NOTIFY_KIND = {
  APPROVED: "approved",
  CHANGES_REQUESTED: "changes_requested",
  REJECTED: "rejected",
  SUSPENDED: "suspended",
};

export const CREATOR_STATUS_COPY = Object.freeze({
  approved: {
    title: "Profilul tău Artfest Creators a fost aprobat",
    body: "Felicitări! Profilul tău a fost aprobat de echipa Artfest.",
  },
  changes_requested: {
    title: "Profilul tău Artfest Creators are nevoie de câteva modificări",
    body: "Echipa Artfest ți-a lăsat câteva observații. Actualizează profilul și trimite-l din nou.",
  },
  rejected: {
    title: "Profilul tău Artfest Creators nu a fost aprobat",
    body: "Echipa Artfest a analizat profilul tău și nu l-a putut aproba.",
  },
  suspended: {
    title: "Profilul tău Artfest Creators a fost suspendat",
    body: "Profilul tău nu mai este vizibil momentan. Pentru detalii, contactează echipa Artfest.",
  },
});

/*
 * Trimite notificarea în aplicație (dedupeKey = eveniment) și emailul (cheie de
 * idempotență = eveniment). „Revendicarea” încercării e condiționată pe
 * emailAttempts, deci două rulări simultane nu trimit de două ori.
 */
export async function deliverProfileEventNotification({ eventId, db = prisma, mailer = null }) {
  const event = await db.creatorProfileEvent.findUnique({ where: { id: eventId } });
  const kind = event ? NOTIFY_KIND[event.type] : null;
  if (!event || !kind || !["PENDING", "FAILED"].includes(event.emailStatus)) return null;
  if (event.emailAttempts >= CREATOR_EMAIL_MAX_ATTEMPTS) return null;

  const claimed = await db.creatorProfileEvent.updateMany({
    where: { id: event.id, emailStatus: event.emailStatus, emailAttempts: event.emailAttempts },
    data: { emailAttempts: event.emailAttempts + 1 },
  });
  if (claimed.count !== 1) return null;

  const profile = await db.creatorProfile.findUnique({ where: { id: event.profileId } });
  const influencer = profile ? await db.influencerProfile.findUnique({ where: { id: profile.influencerId }, select: { userId: true } }) : null;
  const user = influencer?.userId
    ? await db.user.findUnique({ where: { id: influencer.userId }, select: { id: true, email: true, firstName: true } })
    : null;
  const copy = CREATOR_STATUS_COPY[kind];
  const key = `creator_profile_event:${event.id}`;

  if (user?.id) {
    const { createUserNotification } = await import("../notifications.js");
    await createUserNotification(user.id, {
      dedupeKey: key,
      type: "system",
      title: copy.title,
      body: event.reason ? `${copy.body} Mesajul echipei: ${event.reason}` : copy.body,
      link: CREATOR_PATHS.home,
      meta: { kind: `creator_profile_${kind}`, profileId: event.profileId },
    }).catch((error) => console.error("[creators] notificare in-app:", error?.message || error));
  }

  if (!user?.email) {
    await db.creatorProfileEvent.updateMany({ where: { id: event.id }, data: { emailStatus: "FAILED", emailError: "missing_recipient" } });
    return { status: "FAILED" };
  }

  try {
    const send = mailer || (await import("../../lib/mailer.js")).sendCreatorProfileStatusEmail;
    await send({
      to: user.email,
      toName: user.firstName || null,
      userId: user.id,
      idempotencyKey: key,
      kind,
      displayName: profile?.displayName || user.firstName || "",
      message: event.reason || null,
      path: CREATOR_PATHS.home,
    });
    await db.creatorProfileEvent.updateMany({ where: { id: event.id }, data: { emailStatus: "SENT", emailSentAt: new Date(), emailError: null } });
    return { status: "SENT" };
  } catch (error) {
    const code = String(error?.code || error?.name || "send_failed").slice(0, 200);
    await db.creatorProfileEvent.updateMany({ where: { id: event.id }, data: { emailStatus: "FAILED", emailError: code } });
    console.error("[creators] email status profil:", code);
    return { status: "FAILED" };
  }
}

// job: reia emailurile eșuate / rămase PENDING (ex. restart între commit și trimitere)
export async function retryCreatorProfileEmails({ db = prisma, mailer = null, now = new Date(), olderThanMs = 2 * 60 * 1000 } = {}) {
  const rows = await db.creatorProfileEvent.findMany({
    where: {
      emailStatus: { in: ["PENDING", "FAILED"] },
      emailAttempts: { lt: CREATOR_EMAIL_MAX_ATTEMPTS },
      createdAt: { lt: new Date(now.getTime() - olderThanMs) },
    },
    orderBy: { createdAt: "asc" },
    take: 50,
  });
  const results = [];
  for (const row of rows) results.push(await deliverProfileEventNotification({ eventId: row.id, db, mailer }));
  return results.filter(Boolean);
}
