// backend/src/services/artfestFairService.js
//
// Târgul de Crăciun Artfest - înscrierile vendorilor (etapa 1).
//
// - Vendorul are cel mult o înscriere per târg (@@unique([fairId, vendorId]));
//   vendorId vine DOAR din sesiune (rutele), niciodată din body.
// - WITHDRAWN -> reînscriere pe ACEEAȘI înregistrare (status SUBMITTED,
//   withdrawnAt null, submittedAt actualizat). REJECTED -> fără reînscriere.
// - Condițiile de participare: acceptarea se salvează pe înscriere
//   (termsAcceptedAt / termsVersion / termsIp / termsUa). Înscrierea e posibilă
//   DOAR cu o versiune publicată și legată de târg (termsVersion + termsUrl), iar
//   clientul trimite versiunea pe care a citit-o și a bifat-o: dacă între timp s-a
//   legat altă versiune => 409 terms_version_changed (nu înregistrăm o acceptare
//   pentru un text pe care vendorul nu l-a văzut). Fără versiune => 409 terms_not_published.
//   NU folosim VendorAcceptance / VendorDoc (ar intra în PolicyGate).
//
// Fără legături cu comenzi / checkout / Stripe / facturare / Shipment.

import { prisma } from "../db.js";
import { loadFairEligibility, loadFairEligibilityMap } from "./artfestFairEligibility.js";
import {
  ARTFEST_FAIR_KEY,
  ARTFEST_FAIR_DEFAULTS,
  CANCELLATION_RULES,
  DEFAULT_CANCELLATION_VENDOR_MESSAGE,
  FAIR_TX_OPTIONS,
  PARTICIPATION_TYPES,
  REGISTRATION_STATUSES,
} from "../config/artfestFair.js";
import { fairRulesUrlForAcceptedVersion } from "../lib/artfestFairRules.js";
import { notifyAdminsRegistrationSubmitted, notifyVendorRegistrationApproved } from "./artfestFairNotifications.js";

export class FairError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message || code);
    this.status = status;
    this.code = code;
    Object.assign(this, extra);
  }
}

const LIMITS = Object.freeze({
  contactName: 160,
  contactPhone: 50,
  contactEmail: 320,
  productType: 80,
  productTypes: 20,
  notes: 2000,
  rejectionReason: 2000,
  estimatedMax: 10000,
  ua: 500,
  ip: 64,
});

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_CHARS_RE = /^[+\d\s().\/-]+$/;

const FAIR_SELECT = {
  id: true,
  key: true,
  title: true,
  subtitle: true,
  city: true,
  venue: true,
  startsAt: true,
  endsAt: true,
  registrationOpen: true,
  termsVersion: true,
  termsUrl: true,
};

const REGISTRATION_SELECT = {
  id: true,
  fairId: true,
  vendorId: true,
  submittedByUserId: true,
  status: true,
  participationType: true,
  contactName: true,
  contactPhone: true,
  contactEmail: true,
  productTypes: true,
  estimatedProductCount: true,
  notes: true,
  termsAcceptedAt: true,
  termsVersion: true,
  termsIp: true,
  termsUa: true,
  submittedAt: true,
  reviewedAt: true,
  reviewedById: true,
  rejectionReason: true,
  withdrawnAt: true,
  cancelledAt: true,
  cancelledById: true,
  cancellationCause: true,
  cancellationReason: true,
  cancellationMessageForVendor: true,
  cancellationGoodsShipped: true,
};

/* ===================== Istoricul deciziilor (append-only) ===================== */

/*
 * ArtfestFairRegistrationEvent: un rând pentru fiecare decizie pe înscriere.
 * `reason` e intern (nu ajunge la vendor); `vendorMessage` e textul public.
 */
export async function writeRegistrationEvent(
  db,
  registration,
  type,
  { actorUserId = null, reason = null, vendorMessage = null, before = null, after = null, metadata = null } = {}
) {
  return db.artfestFairRegistrationEvent.create({
    data: {
      registrationId: registration.id,
      fairId: registration.fairId,
      vendorId: registration.vendorId,
      type,
      actorUserId,
      reason,
      vendorMessage,
      before,
      after,
      metadata,
    },
  });
}

export function cancellationRulesFor(cause) {
  return CANCELLATION_RULES[cause] || null;
}

/* ===================== Târgul ===================== */

// creează rândul târgului la prima utilizare; NU suprascrie ce e deja în DB
export async function ensureFair(db = prisma) {
  return db.artfestFair.upsert({
    where: { key: ARTFEST_FAIR_KEY },
    create: { key: ARTFEST_FAIR_KEY, ...ARTFEST_FAIR_DEFAULTS },
    update: {},
    select: FAIR_SELECT,
  });
}

export function serializeFair(fair) {
  if (!fair) return null;
  return {
    key: fair.key,
    title: fair.title,
    subtitle: fair.subtitle || null,
    city: fair.city || null,
    venue: fair.venue || null,
    startsAt: fair.startsAt || null,
    endsAt: fair.endsAt || null,
    registrationOpen: fair.registrationOpen !== false,
    termsVersion: fair.termsVersion || null,
    // link doar către o versiune publicată, cu adresa ei canonică (fără link mort / URL străin)
    termsUrl: publishedTermsUrl(fair.termsVersion, fair.termsUrl),
  };
}

function publishedTermsUrl(termsVersion, termsUrl) {
  if (!termsVersion || !termsUrl) return null;
  const url = fairRulesUrlForAcceptedVersion(termsVersion);
  return url && url === termsUrl ? url : null;
}

/* ===================== Validare ===================== */

function cleanText(value, max) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > max ? null : text;
}

function normalizeProductTypes(value) {
  const raw = Array.isArray(value) ? value : String(value ?? "").split(",");
  const seen = new Set();
  const out = [];

  for (const item of raw) {
    const text = String(item ?? "").replace(/\s+/g, " ").trim();
    if (!text) continue;
    if (text.length > LIMITS.productType) return null;
    const key = text.toLocaleLowerCase("ro-RO");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }

  return out.length > LIMITS.productTypes ? null : out;
}

/*
 * Validează câmpurile formularului. Întoarce { data } sau aruncă 400 cu
 * `fields` (cheie -> mesaj), ca formularul să poată marca fiecare câmp.
 */
export function validateRegistrationInput(body = {}) {
  const fields = {};

  const participationType = String(body.participationType || "").trim();
  if (!PARTICIPATION_TYPES.includes(participationType)) {
    fields.participationType = "Alege tipul de participare.";
  }

  const contactName = cleanText(body.contactName, LIMITS.contactName);
  if (!contactName || contactName.length < 2) {
    fields.contactName = "Completează persoana de contact.";
  }

  const contactPhone = cleanText(body.contactPhone, LIMITS.contactPhone);
  const phoneDigits = (contactPhone || "").replace(/\D/g, "").length;
  if (!contactPhone || !PHONE_CHARS_RE.test(contactPhone) || phoneDigits < 6 || phoneDigits > 15) {
    fields.contactPhone = "Completează un număr de telefon valid.";
  }

  const contactEmail = cleanText(body.contactEmail, LIMITS.contactEmail)?.toLowerCase() || null;
  if (!contactEmail || !EMAIL_RE.test(contactEmail)) {
    fields.contactEmail = "Completează o adresă de email validă.";
  }

  const productTypes = normalizeProductTypes(body.productTypes);
  if (!productTypes || productTypes.length === 0) {
    fields.productTypes = "Spune-ne ce tipuri de produse ai aduce sau trimite.";
  }

  const estimated = Number(body.estimatedProductCount);
  if (!Number.isInteger(estimated) || estimated < 1 || estimated > LIMITS.estimatedMax) {
    fields.estimatedProductCount = "Completează un număr estimativ de produse (minimum 1).";
  }

  const notesRaw = String(body.notes ?? "").trim();
  if (notesRaw.length > LIMITS.notes) {
    fields.notes = `Observațiile pot avea maximum ${LIMITS.notes} de caractere.`;
  }

  if (body.termsAccepted !== true) {
    fields.termsAccepted = "Trebuie să accepți condițiile de participare.";
  }

  if (Object.keys(fields).length) {
    throw new FairError(400, "invalid_registration", "Verifică datele din formular.", { fields });
  }

  return {
    participationType,
    contactName,
    contactPhone,
    contactEmail,
    productTypes,
    estimatedProductCount: estimated,
    notes: notesRaw || null,
  };
}

/* ===================== Serializare ===================== */

// pentru vendor: fără motivul intern de respingere, fără IP/UA, fără reviewer
export function serializeRegistrationForVendor(row) {
  if (!row) return null;
  return {
    id: row.id,
    status: row.status,
    participationType: row.participationType,
    contactName: row.contactName,
    contactPhone: row.contactPhone,
    contactEmail: row.contactEmail,
    productTypes: Array.isArray(row.productTypes) ? row.productTypes : [],
    estimatedProductCount: row.estimatedProductCount ?? null,
    notes: row.notes || null,
    termsAcceptedAt: row.termsAcceptedAt || null,
    termsVersion: row.termsVersion || null,
    submittedAt: row.submittedAt || null,
    reviewedAt: row.reviewedAt || null,
    withdrawnAt: row.withdrawnAt || null,
    // anularea: doar data și mesajul public; motivul intern și cauza NU ajung la vendor
    cancelledAt: row.status === "CANCELLED" ? row.cancelledAt || null : null,
    cancellationMessage:
      row.status === "CANCELLED" ? row.cancellationMessageForVendor || DEFAULT_CANCELLATION_VENDOR_MESSAGE : null,
  };
}

// hasActiveInventory: inventar trimis / recepționat => retragerea doar prin flux controlat
// înscrierea cere un regulament publicat și legat de târg (altfel nu există ce accepta)
export function fairTermsReady(fair) {
  return Boolean(publishedTermsUrl(fair?.termsVersion, fair?.termsUrl));
}

// eligibility: rezultatul evaluateFairEligibility (magazin activ / pe pauză cu profil valid)
export function vendorActions(fair, registration, { hasActiveInventory = false, eligibility = null } = {}) {
  const open = fair?.registrationOpen !== false && fairTermsReady(fair) && eligibility?.eligible !== false;
  const status = registration?.status || null;
  return {
    canRegister: open && (!registration || status === "WITHDRAWN"),
    canWithdraw: (status === "SUBMITTED" || status === "APPROVED") && !hasActiveInventory,
  };
}

/* ===================== Vendor ===================== */

async function findRegistration(db, fairId, vendorId) {
  return db.artfestFairRegistration.findUnique({
    where: { fairId_vendorId: { fairId, vendorId } },
    select: REGISTRATION_SELECT,
  });
}

async function loadPrefill(db, vendorId, userId) {
  const [vendor, user] = await Promise.all([
    db.vendor.findUnique({
      where: { id: vendorId },
      select: { displayName: true, phone: true, email: true },
    }),
    userId
      ? db.user.findUnique({
          where: { id: userId },
          select: { email: true, firstName: true, lastName: true, name: true, phone: true },
        })
      : null,
  ]);

  const personName = [user?.firstName, user?.lastName].filter(Boolean).join(" ").trim();

  return {
    vendorName: vendor?.displayName || "",
    contactName: personName || user?.name || vendor?.displayName || "",
    contactPhone: vendor?.phone || user?.phone || "",
    contactEmail: vendor?.email || user?.email || "",
  };
}

export async function getVendorFairState({ vendorId, userId, db = prisma }) {
  const fair = await ensureFair(db);
  const registration = await findRegistration(db, fair.id, vendorId);
  const hasActiveInventory = registration
    ? (await db.artfestFairInventoryItem.count({
        where: { registrationId: registration.id, status: { in: ["SUBMITTED", "RECEIVED"] } },
      })) > 0
    : false;

  const eligibility = await loadFairEligibility(vendorId, db);

  return {
    fair: serializeFair(fair),
    registration: serializeRegistrationForVendor(registration),
    actions: vendorActions(fair, registration, { hasActiveInventory, eligibility }),
    // de ce nu se poate înscrie (fără detalii interne: doar motivul și mesajul pentru vendor)
    eligibility: {
      eligible: eligibility.eligible,
      reason: eligibility.reason,
      message: eligibility.message,
      storeState: eligibility.storeState,
    },
    prefill: registration ? null : await loadPrefill(db, vendorId, userId),
  };
}

export async function submitRegistration({ vendorId, userId, body, ip = null, ua = null, now = new Date(), db = prisma }) {
  if (!vendorId || !userId) throw new FairError(403, "vendor_only", "Doar vendorii se pot înscrie.");

  const input = validateRegistrationInput(body);
  const fair = await ensureFair(db);

  if (fair.registrationOpen === false) {
    throw new FairError(409, "registration_closed", "Înscrierile pentru târg sunt închise.");
  }

  // doar magazinele activate (active sau puse pe pauză de vendor, cu profil valid);
  // codul erorii = motivul (store_not_activated, store_deactivated, account_restricted ...)
  const eligibility = await loadFairEligibility(vendorId, db);
  if (!eligibility.eligible) throw new FairError(409, eligibility.reason, eligibility.message);

  if (!fairTermsReady(fair)) {
    throw new FairError(409, "terms_not_published", "Înscrierile se deschid după publicarea regulamentului târgului.");
  }
  // versiunea bifată de vendor trebuie să fie exact cea legată acum de târg
  if (String(body?.termsVersion ?? "").trim() !== fair.termsVersion) {
    throw new FairError(
      409,
      "terms_version_changed",
      "Regulamentul târgului a fost actualizat. Citește versiunea nouă și bifează din nou acceptarea.",
      { fields: { termsAccepted: "Citește versiunea nouă a regulamentului și bifează din nou acceptarea." } }
    );
  }

  const terms = {
    termsAcceptedAt: now,
    termsVersion: fair.termsVersion || null,
    termsIp: ip ? String(ip).slice(0, LIMITS.ip) : null,
    termsUa: ua ? String(ua).slice(0, LIMITS.ua) : null,
  };

  const existing = await findRegistration(db, fair.id, vendorId);

  if (existing) {
    if (existing.status === "REJECTED") {
      throw new FairError(409, "registration_rejected", "Înscrierea ta a fost respinsă și nu poate fi retrimisă automat.");
    }

    if (existing.status === "CANCELLED") {
      throw new FairError(
        409,
        "registration_cancelled",
        "Participarea ta la târg a fost anulată și nu poate fi retrimisă automat. Pentru detalii, contactează Asistența."
      );
    }

    if (existing.status !== "WITHDRAWN") {
      throw new FairError(409, "already_registered", "Ești deja înscris la târg.");
    }

    // reînscriere după WITHDRAWN: aceeași înregistrare, doar dacă e încă WITHDRAWN
    await db.$transaction(async (tx) => {
      const updated = await tx.artfestFairRegistration.updateMany({
        where: { id: existing.id, vendorId, status: "WITHDRAWN" },
        data: {
          ...input,
          ...terms,
          status: "SUBMITTED",
          submittedByUserId: userId,
          submittedAt: now,
          withdrawnAt: null,
          reviewedAt: null,
          reviewedById: null,
          rejectionReason: null,
        },
      });

      if (updated.count !== 1) {
        throw new FairError(409, "already_registered", "Ești deja înscris la târg.");
      }

      await writeRegistrationEvent(tx, existing, "SUBMITTED", {
        actorUserId: userId,
        before: { status: "WITHDRAWN" },
        after: { status: "SUBMITTED" },
        metadata: { resubmission: true, termsVersion: terms.termsVersion },
      });
    }, FAIR_TX_OPTIONS);

    const resubmitted = await findRegistration(db, fair.id, vendorId);
    // după commit: Adminii află de cererea nouă
    await notifyAdminsRegistrationSubmitted({ registration: resubmitted, db });
    return serializeRegistrationForVendor(resubmitted);
  }

  try {
    const created = await db.$transaction(async (tx) => {
      const row = await tx.artfestFairRegistration.create({
        data: {
          fairId: fair.id,
          vendorId,
          submittedByUserId: userId,
          status: "SUBMITTED",
          submittedAt: now,
          ...input,
          ...terms,
        },
        select: REGISTRATION_SELECT,
      });
      await writeRegistrationEvent(tx, row, "SUBMITTED", {
        actorUserId: userId,
        after: { status: "SUBMITTED" },
        metadata: { termsVersion: terms.termsVersion },
      });
      return row;
    }, FAIR_TX_OPTIONS);
    // după commit: Adminii află de cererea nouă
    await notifyAdminsRegistrationSubmitted({ registration: created, db });
    return serializeRegistrationForVendor(created);
  } catch (error) {
    // două submit-uri simultane: @@unique([fairId, vendorId])
    if (error?.code === "P2002") {
      throw new FairError(409, "already_registered", "Ești deja înscris la târg.");
    }
    throw error;
  }
}

export async function withdrawRegistration({ vendorId, userId = null, now = new Date(), db = prisma }) {
  const fair = await ensureFair(db);
  const existing = await findRegistration(db, fair.id, vendorId);

  if (!existing) throw new FairError(404, "registration_not_found", "Nu ai o înscriere la târg.");

  // după ce există inventar trimis / recepționat, retragerea se face doar printr-un flux controlat
  const activeInventory = await db.artfestFairInventoryItem.count({
    where: { registrationId: existing.id, status: { in: ["SUBMITTED", "RECEIVED"] } },
  });
  if (activeInventory > 0) {
    throw new FairError(
      409,
      "inventory_submitted",
      "Ai trimis deja inventarul pentru târg, așa că înscrierea nu mai poate fi retrasă direct. Scrie-ne din Asistență și te ajutăm."
    );
  }

  await db.$transaction(async (tx) => {
    const updated = await tx.artfestFairRegistration.updateMany({
      where: { id: existing.id, vendorId, status: { in: ["SUBMITTED", "APPROVED"] } },
      data: { status: "WITHDRAWN", withdrawnAt: now },
    });

    if (updated.count !== 1) {
      throw new FairError(409, "invalid_transition", "Înscrierea nu mai poate fi retrasă.", {
        currentStatus: existing.status,
      });
    }

    await writeRegistrationEvent(tx, existing, "WITHDRAWN", {
      actorUserId: userId,
      before: { status: existing.status },
      after: { status: "WITHDRAWN" },
    });
  }, FAIR_TX_OPTIONS);

  return serializeRegistrationForVendor(await findRegistration(db, fair.id, vendorId));
}

/* ===================== Admin ===================== */

// REJECTED = înscriere niciodată aprobată; APPROVED -> CANCELLED doar prin anulare (cancelParticipation)
const ADMIN_TRANSITIONS = Object.freeze({
  approve: { from: ["SUBMITTED", "REJECTED"], to: "APPROVED" },
  reject: { from: ["SUBMITTED"], to: "REJECTED" },
});

function serializeRegistrationForAdmin(row, storesByVendor = new Map(), eligibilityByVendor = new Map()) {
  const cancelled = row.status === "CANCELLED";
  const eligibility = eligibilityByVendor.get(row.vendorId) || null;
  return {
    ...serializeRegistrationForVendor(row),
    vendorId: row.vendorId,
    vendorName: row.vendor?.displayName || null,
    vendorActive: row.vendor?.isActive ?? null,
    stores: storesByVendor.get(row.vendorId) || [],
    rejectionReason: row.rejectionReason || null,
    reviewedById: row.reviewedById || null,
    submittedByUserId: row.submittedByUserId || null,
    termsIp: row.termsIp || null,
    termsUa: row.termsUa || null,
    // adresa versiunii ACCEPTATE (nu a celei curente), doar dacă e publicată
    termsVersionUrl: fairRulesUrlForAcceptedVersion(row.termsVersion),
    cancellation: cancelled
      ? {
          at: row.cancelledAt || null,
          byId: row.cancelledById || null,
          cause: row.cancellationCause,
          reason: row.cancellationReason,
          messageForVendor: row.cancellationMessageForVendor || null,
          goodsShipped: row.cancellationGoodsShipped ?? null,
          rules: cancellationRulesFor(row.cancellationCause),
        }
      : null,
    // starea magazinului ACUM (înscrierile existente nu se anulează automat)
    storeEligibility: eligibility
      ? { eligible: eligibility.eligible, reason: eligibility.reason, label: eligibility.adminLabel, storeState: eligibility.storeState }
      : null,
    actions: {
      canApprove: (row.status === "SUBMITTED" || row.status === "REJECTED") && eligibility?.eligible !== false,
      canReject: row.status === "SUBMITTED",
      canCancel: row.status === "APPROVED",
    },
  };
}

async function loadStores(db, vendorIds) {
  const map = new Map();
  if (!vendorIds.length) return map;

  const services = await db.vendorService.findMany({
    where: { vendorId: { in: vendorIds } },
    select: { vendorId: true, title: true, profile: { select: { displayName: true, slug: true } } },
  });

  for (const service of services) {
    const name = service.profile?.displayName || service.title || null;
    if (!name) continue;
    const list = map.get(service.vendorId) || [];
    list.push({ name, slug: service.profile?.slug || null });
    map.set(service.vendorId, list);
  }

  return map;
}

const ADMIN_SELECT = {
  ...REGISTRATION_SELECT,
  vendor: { select: { id: true, displayName: true, isActive: true } },
};

export async function listRegistrationsForAdmin({ status = null, participationType = null, db = prisma } = {}) {
  const fair = await ensureFair(db);
  const where = { fairId: fair.id };

  if (status) {
    if (!REGISTRATION_STATUSES.includes(status)) throw new FairError(400, "invalid_status", "Status invalid.");
    where.status = status;
  }

  if (participationType) {
    if (!PARTICIPATION_TYPES.includes(participationType)) {
      throw new FairError(400, "invalid_participation_type", "Tip de participare invalid.");
    }
    where.participationType = participationType;
  }

  const rows = await db.artfestFairRegistration.findMany({
    where,
    orderBy: { submittedAt: "desc" },
    select: ADMIN_SELECT,
  });

  const vendorIds = [...new Set(rows.map((r) => r.vendorId))];
  const [stores, eligibility] = await Promise.all([loadStores(db, vendorIds), loadFairEligibilityMap(vendorIds, db)]);

  const counts = await db.artfestFairRegistration.groupBy({
    by: ["status"],
    where: { fairId: fair.id },
    _count: { _all: true },
  });

  return {
    fair: serializeFair(fair),
    items: rows.map((row) => serializeRegistrationForAdmin(row, stores, eligibility)),
    counts: Object.fromEntries(counts.map((c) => [c.status, c._count?._all ?? 0])),
  };
}

export async function getRegistrationForAdmin({ id, db = prisma }) {
  const row = await db.artfestFairRegistration.findUnique({ where: { id: String(id) }, select: ADMIN_SELECT });
  if (!row) throw new FairError(404, "registration_not_found", "Înscrierea nu există.");
  const [stores, eligibility] = await Promise.all([loadStores(db, [row.vendorId]), loadFairEligibilityMap([row.vendorId], db)]);
  return serializeRegistrationForAdmin(row, stores, eligibility);
}

export async function reviewRegistration({ id, action, adminId, reason = null, now = new Date(), db = prisma }) {
  const transition = ADMIN_TRANSITIONS[action];
  if (!transition) throw new FairError(400, "invalid_action", "Acțiune invalidă.");

  const rejectionReason = action === "reject" ? String(reason ?? "").trim() || null : null;
  if (rejectionReason && rejectionReason.length > LIMITS.rejectionReason) {
    throw new FairError(400, "reason_too_long", `Motivul poate avea maximum ${LIMITS.rejectionReason} de caractere.`);
  }

  // aprobarea doar pentru magazine eligibile (aceeași regulă ca la înscriere); respingerea rămâne posibilă
  if (action === "approve") {
    const target = await db.artfestFairRegistration.findUnique({ where: { id: String(id) }, select: { vendorId: true } });
    if (target) {
      const eligibility = await loadFairEligibility(target.vendorId, db);
      if (!eligibility.eligible) {
        throw new FairError(409, "vendor_not_eligible", `Înscrierea nu poate fi aprobată: ${eligibility.adminLabel.toLowerCase()}.`, {
          problems: [{ reason: eligibility.reason, label: eligibility.adminLabel }],
        });
      }
    }
  }

  const outcome = await db.$transaction(async (tx) => {
    const current = await tx.artfestFairRegistration.findUnique({
      where: { id: String(id) },
      select: { id: true, fairId: true, vendorId: true, status: true, rejectionReason: true },
    });
    if (!current) throw new FairError(404, "registration_not_found", "Înscrierea nu există.");

    const updated = await tx.artfestFairRegistration.updateMany({
      where: { id: current.id, status: { in: transition.from } },
      data: {
        status: transition.to,
        reviewedAt: now,
        reviewedById: adminId || null,
        rejectionReason,
      },
    });

    if (updated.count !== 1) {
      const message =
        action === "reject" && current.status === "APPROVED"
          ? "Participarea este deja aprobată. Folosește „Anulează participarea”."
          : "Statusul înscrierii nu permite această acțiune.";
      throw new FairError(409, "invalid_transition", message, { currentStatus: current.status });
    }

    // istoricul păstrează și motivul respingerii anterioare (câmpul de pe înscriere se golește la aprobare)
    const type = action === "reject" ? "REJECTED" : current.status === "REJECTED" ? "REAPPROVED" : "APPROVED";
    const event = await writeRegistrationEvent(tx, current, type, {
      actorUserId: adminId || null,
      reason: rejectionReason,
      before: { status: current.status, rejectionReason: current.rejectionReason || null },
      after: { status: transition.to },
    });
    return { registration: current, event };
  }, FAIR_TX_OPTIONS);

  // DOAR după ce aprobarea a reușit în DB
  if (transition.to === "APPROVED") {
    await notifyVendorRegistrationApproved({ registration: outcome.registration, approvalEventId: outcome.event.id });
  }

  return getRegistrationForAdmin({ id, db });
}

export async function listRegistrationEvents({ id, db = prisma }) {
  const registration = await db.artfestFairRegistration.findUnique({ where: { id: String(id) }, select: { id: true } });
  if (!registration) throw new FairError(404, "registration_not_found", "Înscrierea nu există.");
  const rows = await db.artfestFairRegistrationEvent.findMany({
    where: { registrationId: registration.id },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((e) => ({
    id: e.id,
    type: e.type,
    actorUserId: e.actorUserId || null,
    reason: e.reason || null,
    vendorMessage: e.vendorMessage || null,
    before: e.before ?? null,
    after: e.after ?? null,
    metadata: e.metadata ?? null,
    createdAt: e.createdAt,
  }));
}
