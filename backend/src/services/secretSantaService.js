// backend/src/services/secretSantaService.js
//
// Secret Santa Artfest: schimb gratuit de cadouri handmade între vânzători.
// Complet separat de Târgul Artfest (tabele proprii SecretSanta*).
//
// Confidențialitate:
//   - datele de livrare ale unui participant le vede DOAR expeditorul extras
//     pentru el (după extragere) și Adminul;
//   - destinatarul nu află din API cine îi trimite cadoul;
//   - în loguri scriem doar ID-uri și coduri de eroare, niciodată adrese,
//     telefoane, nume sau emailuri.
//
// Extragerea: amestecare Fisher-Yates cu crypto.randomInt, apoi un singur ciclu
// (fiecare îi trimite următorului) => fiecare dă și primește exact un cadou,
// nimeni nu se extrage pe sine. Salvare atomică, o singură dată (CLOSED -> DRAWN).

import crypto from "node:crypto";
import { prisma } from "../db.js";
import {
  SECRET_SANTA_TEST_FORM_EDITION_KEY,
  SECRET_SANTA_TEST_STORES,
  SECRET_SANTA_TEST_VENDOR_NAME,
  isTestEditionKey,
  isTestFormAvailable,
  registrationOpensAt,
} from "../config/secretSanta.js";

export class SecretSantaError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    this.status = status;
    this.code = code;
    Object.assign(this, extra);
  }
}

export const MIN_PARTICIPANTS = 2;
// marcajul emailurilor „trimise” într-o ediție de test (nimic nu pleacă)
export const SIMULATED_EMAIL = "simulated_test";

/* ---------------------------- extragerea ---------------------------- */

/*
 * ids -> [{ giverId, receiverId }]. randomInt(max) întoarce un întreg în [0, max).
 * Rezultatul e o permutare cu un singur ciclu: fără extragere pe sine, fără
 * duplicate; de la 3 participanți nu apar nici perechi reciproce.
 */
export function buildAssignments(ids, randomInt = crypto.randomInt) {
  const unique = [...new Set(ids)];
  if (unique.length !== ids.length) throw new SecretSantaError(409, "duplicate_participants", "Participanți duplicați.");
  if (unique.length < MIN_PARTICIPANTS) {
    throw new SecretSantaError(409, "not_enough_participants", "Extragerea are nevoie de cel puțin doi participanți.");
  }
  const order = [...unique];
  for (let i = order.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order.map((giverId, index) => ({ giverId, receiverId: order[(index + 1) % order.length] }));
}

/* ---------------------------- validare ---------------------------- */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function cleanText(value, max) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

export function validateRegistration(body = {}) {
  const data = {
    recipientName: cleanText(body.recipientName, 160),
    email: cleanText(body.email, 320).toLowerCase(),
    phone: cleanText(body.phone, 40),
    county: cleanText(body.county, 60),
    city: cleanText(body.city, 120),
    address: cleanText(body.address, 300),
    postalCode: cleanText(body.postalCode, 12).replace(/\s/g, ""),
    preferences: String(body.preferences ?? "").trim().slice(0, 500) || null,
  };
  const fields = {};
  if (data.recipientName.length < 3) fields.recipientName = "Scrie numele și prenumele destinatarului.";
  if (!EMAIL_RE.test(data.email)) fields.email = "Adresa de email nu pare corectă.";
  const digits = data.phone.replace(/\D/g, "");
  if (!/^[+\d\s().-]+$/.test(data.phone) || digits.length < 10 || digits.length > 15) {
    fields.phone = "Scrie un număr de telefon valid pentru curier.";
  }
  if (!data.county) fields.county = "Alege județul.";
  if (data.city.length < 2) fields.city = "Scrie localitatea.";
  if (data.address.length < 5) fields.address = "Scrie adresa completă (stradă, număr, bloc, apartament).";
  if (!/^\d{6}$/.test(data.postalCode)) fields.postalCode = "Codul poștal are 6 cifre.";
  if (body.dataNotice !== true) fields.dataNotice = "Confirmă că ai citit cum folosim datele de livrare.";
  if (Object.keys(fields).length) {
    throw new SecretSantaError(400, "invalid_fields", "Verifică câmpurile marcate.", { fields });
  }
  return data;
}

/* ---------------------------- ediția ---------------------------- */

export function isRegistrationOpen(edition, now = new Date()) {
  if (!edition || edition.status !== "OPEN") return false;
  const opensAt = registrationOpensAt(edition.key);
  if (opensAt && now < opensAt) return false; // programată: nu se deschide înainte de dată
  return !edition.registrationClosesAt || now < new Date(edition.registrationClosesAt);
}

// ediția afișată public: cea mai nouă care nu e DRAFT și nu e de test
export function findCurrentEdition(db = prisma) {
  return db.secretSantaEdition.findFirst({
    where: { status: { not: "DRAFT" }, NOT: { key: { startsWith: "TEST", mode: "insensitive" } } },
    orderBy: { createdAt: "desc" },
  });
}

/*
 * Ediția cerută de pagină: fără cheie -> ediția oficială curentă; cu cheie ->
 * DOAR o ediție de test publicată (o cheie oficială sau o ciornă -> null).
 */
export async function resolveEdition(db = prisma, editionKey = null) {
  const key = cleanText(editionKey, 60);
  if (!key) return findCurrentEdition(db);
  if (!isTestEditionKey(key)) return null;
  const edition = await db.secretSantaEdition.findUnique({ where: { key } });
  return edition && edition.status !== "DRAFT" ? edition : null;
}

export function publicEdition(edition, participantCount = 0, now = new Date()) {
  if (!edition) return null;
  return {
    key: edition.key,
    title: edition.title,
    status: edition.status,
    test: isTestEditionKey(edition.key),
    registrationOpen: isRegistrationOpen(edition, now),
    registrationOpensAt: registrationOpensAt(edition.key),
    registrationClosesAt: edition.registrationClosesAt,
    shipByAt: edition.shipByAt,
    drawn: edition.status === "DRAWN",
    participantCount,
  };
}

export async function getPublicState({ db = prisma, now = new Date(), editionKey = null } = {}) {
  const edition = await resolveEdition(db, editionKey);
  const count = edition ? await db.secretSantaParticipant.count({ where: { editionId: edition.id } }) : 0;
  return { edition: publicEdition(edition, count, now) };
}

/* ---------------------------- vânzătorul ---------------------------- */

function storeLabel(service, vendor) {
  return cleanText(service?.profile?.displayName || service?.title || vendor?.displayName || "Magazin Artfest", 200);
}

/*
 * Verificarea participantului: cont VENDOR activ, vendor activ și neanonimizat,
 * cu cel puțin un magazin. vendorId vine EXCLUSIV din sesiune.
 */
export async function loadEligibleVendor({ db = prisma, userId }) {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, status: true, email: true },
  });
  if (!user || user.role !== "VENDOR") {
    throw new SecretSantaError(403, "vendor_only", "Secret Santa este doar pentru vânzătorii Artfest.");
  }
  const vendor = await db.vendor.findUnique({
    where: { userId },
    select: {
      id: true,
      displayName: true,
      isActive: true,
      anonymizedAt: true,
      phone: true,
      services: {
        select: { id: true, title: true, profile: { select: { displayName: true } } },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  const eligible = Boolean(
    vendor && user.status === "ACTIVE" && vendor.isActive && !vendor.anonymizedAt && vendor.services.length
  );
  return {
    user,
    vendor,
    eligible,
    stores: (vendor?.services || []).map((service) => ({ id: service.id, name: storeLabel(service, vendor) })),
  };
}

const RECIPIENT_SELECT = {
  storeName: true,
  recipientName: true,
  phone: true,
  county: true,
  city: true,
  address: true,
  postalCode: true,
  preferences: true,
};

export async function getVendorState({ db = prisma, userId, now = new Date(), editionKey = null }) {
  const { user, vendor, eligible, stores } = await loadEligibleVendor({ db, userId });
  const edition = await resolveEdition(db, editionKey);
  const count = edition ? await db.secretSantaParticipant.count({ where: { editionId: edition.id } }) : 0;

  const result = {
    edition: publicEdition(edition, count, now),
    eligible,
    stores,
    defaults: { email: user.email || "", phone: vendor?.phone || "" },
    registration: null,
    giving: null,
    incoming: null,
  };
  if (!edition || !vendor) return result;

  const participant = await db.secretSantaParticipant.findUnique({
    where: { editionId_vendorId: { editionId: edition.id, vendorId: vendor.id } },
    select: {
      id: true,
      storeName: true,
      ...RECIPIENT_SELECT,
      email: true,
      createdAt: true,
    },
  });
  if (!participant) return result;

  const { id: participantId, ...own } = participant;
  result.registration = own;

  if (edition.status === "DRAWN") {
    const [giving, incoming] = await Promise.all([
      db.secretSantaAssignment.findUnique({
        where: { giverId: participantId },
        select: { awb: true, courierName: true, shippedAt: true, receiver: { select: RECIPIENT_SELECT } },
      }),
      // DOAR starea coletului: fără expeditor
      db.secretSantaAssignment.findUnique({
        where: { receiverId: participantId },
        select: { awb: true, courierName: true, shippedAt: true },
      }),
    ]);
    if (giving) {
      result.giving = {
        recipient: edition.personalDataPurgedAt ? null : giving.receiver,
        awb: giving.awb,
        courierName: giving.courierName,
        shippedAt: giving.shippedAt,
      };
    }
    if (incoming) {
      result.incoming = { shipped: Boolean(incoming.shippedAt), shippedAt: incoming.shippedAt, awb: incoming.awb, courierName: incoming.courierName };
    }
  }
  return result;
}

async function requireParticipantContext({ db, userId, requireEligible = true, editionKey = null }) {
  const context = await loadEligibleVendor({ db, userId });
  if (requireEligible ? !context.eligible : !context.vendor) {
    throw new SecretSantaError(
      403,
      "not_eligible",
      "Pentru Secret Santa ai nevoie de un cont de vânzător activ, cu cel puțin un magazin."
    );
  }
  const edition = await resolveEdition(db, editionKey);
  if (!edition) throw new SecretSantaError(404, "no_edition", "Nu există o ediție Secret Santa activă.");
  return { ...context, edition };
}

// înscriere nouă sau actualizarea datelor, cât timp înscrierile sunt deschise
export async function registerVendor({ db = prisma, userId, body = {}, now = new Date(), editionKey = null }) {
  const { vendor, stores, edition } = await requireParticipantContext({ db, userId, editionKey });
  if (!isRegistrationOpen(edition, now)) {
    throw new SecretSantaError(409, "registration_closed", "Înscrierile pentru această ediție sunt închise.");
  }
  const data = validateRegistration(body);
  const store = body.storeId ? stores.find((item) => item.id === String(body.storeId)) : stores[0];
  if (!store) throw new SecretSantaError(400, "invalid_fields", "Alege unul dintre magazinele tale.", { fields: { storeId: "Alege magazinul." } });

  const payload = { ...data, storeName: store.name, dataNoticeAcceptedAt: now };
  const where = { editionId_vendorId: { editionId: edition.id, vendorId: vendor.id } };
  const existing = await db.secretSantaParticipant.findUnique({ where, select: { id: true } });
  try {
    if (existing) {
      await db.secretSantaParticipant.update({ where, data: payload });
    } else {
      await db.secretSantaParticipant.create({
        data: { ...payload, editionId: edition.id, vendorId: vendor.id, userId },
      });
    }
  } catch (error) {
    // dublu click: a doua cerere găsește înscrierea deja creată
    if (error?.code === "P2002") throw new SecretSantaError(409, "already_registered", "Ești deja înscris la această ediție.");
    throw error;
  }
  return { updated: Boolean(existing) };
}

/*
 * Retragere înainte de extragere. Condițiile sunt în același DELETE: ediția
 * nu e DRAWN și participantul nu are atribuiri => o extragere concurentă nu
 * poate fi „ruptă” de o retragere.
 */
export async function withdrawVendor({ db = prisma, userId, editionKey = null }) {
  const { vendor, edition } = await requireParticipantContext({ db, userId, requireEligible: false, editionKey });
  const { count } = await db.secretSantaParticipant.deleteMany({
    where: {
      editionId: edition.id,
      vendorId: vendor.id,
      edition: { status: { in: ["OPEN", "CLOSED"] } },
      giving: { is: null },
      receiving: { is: null },
    },
  });
  if (!count) throw new SecretSantaError(409, "cannot_withdraw", "Nu te mai poți retrage după extragere.");
  return { ok: true };
}

export async function markShipped({ db = prisma, userId, body = {}, now = new Date(), editionKey = null }) {
  const { vendor, edition } = await requireParticipantContext({ db, userId, requireEligible: false, editionKey });
  if (edition.status !== "DRAWN") throw new SecretSantaError(409, "not_drawn", "Extragerea nu a avut loc încă.");
  const participant = await db.secretSantaParticipant.findUnique({
    where: { editionId_vendorId: { editionId: edition.id, vendorId: vendor.id } },
    select: { id: true },
  });
  if (!participant) throw new SecretSantaError(404, "not_participant", "Nu participi la această ediție.");

  const awb = cleanText(body.awb, 60) || null;
  const courierName = cleanText(body.courierName, 80) || null;
  if (awb && !/^[A-Za-z0-9 -]{4,60}$/.test(awb)) {
    throw new SecretSantaError(400, "invalid_fields", "AWB-ul conține doar litere și cifre.", { fields: { awb: "AWB invalid." } });
  }
  const { count } = await db.secretSantaAssignment.updateMany({
    where: { giverId: participant.id },
    data: { awb, courierName, shippedAt: now },
  });
  if (!count) throw new SecretSantaError(404, "no_assignment", "Nu am găsit destinatarul tău.");
  return { ok: true, shippedAt: now };
}

/* ---------------------------- Admin ---------------------------- */

function parseDate(value, field) {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new SecretSantaError(400, "invalid_fields", "Dată invalidă.", { fields: { [field]: "Dată invalidă." } });
  }
  return date;
}

export function listEditions({ db = prisma } = {}) {
  return db.secretSantaEdition.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { participants: true } } },
  });
}

export async function createEdition({ db = prisma, body = {} }) {
  const key = cleanText(body.key, 60).toUpperCase().replace(/[^A-Z0-9_]/g, "_");
  const title = cleanText(body.title, 160);
  if (key.length < 3 || title.length < 3) {
    throw new SecretSantaError(400, "invalid_fields", "Completează cheia și titlul ediției.");
  }
  try {
    return await db.secretSantaEdition.create({
      data: {
        key,
        title,
        registrationClosesAt: parseDate(body.registrationClosesAt, "registrationClosesAt") ?? null,
        shipByAt: parseDate(body.shipByAt, "shipByAt") ?? null,
      },
    });
  } catch (error) {
    if (error?.code === "P2002") throw new SecretSantaError(409, "edition_exists", "Există deja o ediție cu această cheie.");
    throw error;
  }
}

export async function updateEdition({ db = prisma, editionId, body = {} }) {
  const data = {};
  if (body.title !== undefined) {
    data.title = cleanText(body.title, 160);
    if (data.title.length < 3) throw new SecretSantaError(400, "invalid_fields", "Titlul e prea scurt.");
  }
  const closes = parseDate(body.registrationClosesAt, "registrationClosesAt");
  const shipBy = parseDate(body.shipByAt, "shipByAt");
  if (closes !== undefined) data.registrationClosesAt = closes;
  if (shipBy !== undefined) data.shipByAt = shipBy;
  return db.secretSantaEdition.update({ where: { id: editionId }, data });
}

const STATUS_FROM = { OPEN: ["DRAFT", "CLOSED"], CLOSED: ["OPEN"] };

export async function setEditionStatus({ db = prisma, editionId, status }) {
  const from = STATUS_FROM[status];
  if (!from) throw new SecretSantaError(400, "invalid_status", "Status invalid.");
  const { count } = await db.secretSantaEdition.updateMany({
    where: { id: editionId, status: { in: from } },
    data: { status },
  });
  if (!count) throw new SecretSantaError(409, "invalid_transition", "Statusul ediției nu mai poate fi schimbat.");
  return db.secretSantaEdition.findUnique({ where: { id: editionId } });
}

export async function getEditionDetail({ db = prisma, editionId }) {
  const edition = await db.secretSantaEdition.findUnique({ where: { id: editionId } });
  if (!edition) throw new SecretSantaError(404, "not_found", "Ediția nu există.");
  const participants = await db.secretSantaParticipant.findMany({
    where: { editionId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      vendorId: true,
      storeName: true,
      ...RECIPIENT_SELECT,
      email: true,
      createdAt: true,
      giving: {
        select: {
          receiverId: true,
          awb: true,
          courierName: true,
          shippedAt: true,
          emailSentAt: true,
          emailError: true,
        },
      },
    },
  });
  return {
    edition,
    participants,
    meta: { test: isTestEditionKey(edition.key), registrationOpensAt: registrationOpensAt(edition.key) },
  };
}

export async function removeParticipant({ db = prisma, editionId, participantId }) {
  const { count } = await db.secretSantaParticipant.deleteMany({
    where: {
      id: participantId,
      editionId,
      edition: { status: { in: ["OPEN", "CLOSED"] } },
      giving: { is: null },
      receiving: { is: null },
    },
  });
  if (!count) throw new SecretSantaError(409, "cannot_remove", "Participantul nu mai poate fi eliminat după extragere.");
  return { ok: true };
}

/*
 * Extragerea. confirm = cheia ediției (introdusă manual în Admin).
 * Tot în aceeași tranzacție: trecerea condiționată CLOSED -> DRAWN (o a doua
 * extragere, chiar simultană, primește 409) + toate atribuirile. Orice eroare
 * anulează totul: nu rămân atribuiri parțiale.
 */
export async function drawEdition({ db = prisma, editionId, adminUserId, confirm, randomInt, now = new Date() }) {
  const edition = await db.secretSantaEdition.findUnique({ where: { id: editionId } });
  if (!edition) throw new SecretSantaError(404, "not_found", "Ediția nu există.");
  if (String(confirm || "") !== edition.key) {
    throw new SecretSantaError(400, "confirmation_required", "Scrie cheia ediției pentru a confirma extragerea.");
  }
  if (edition.status === "DRAWN") throw new SecretSantaError(409, "already_drawn", "Extragerea a fost deja realizată.");
  if (edition.status !== "CLOSED") {
    throw new SecretSantaError(409, "registration_not_closed", "Închide mai întâi înscrierile.");
  }

  return db.$transaction(async (tx) => {
    const locked = await tx.secretSantaEdition.updateMany({
      where: { id: editionId, status: "CLOSED" },
      data: { status: "DRAWN", drawnAt: now, drawnById: adminUserId || null },
    });
    if (locked.count !== 1) throw new SecretSantaError(409, "already_drawn", "Extragerea a fost deja realizată.");

    const participants = await tx.secretSantaParticipant.findMany({ where: { editionId }, select: { id: true } });
    const pairs = buildAssignments(participants.map((item) => item.id), randomInt);
    await tx.secretSantaAssignment.createMany({ data: pairs.map((pair) => ({ ...pair, editionId })) });
    return { ok: true, assignments: pairs.length };
  });
}

/*
 * Emailul cu destinatarul, pentru atribuirile fără emailSentAt (prima trimitere
 * și retrimiterea celor eșuate). Nu reface extragerea. Un singur rând simultan
 * per ediție. sendEmail e injectabil (teste).
 */
const runningEmailBatches = new Set();

export async function sendAssignmentEmails({ db = prisma, editionId, sendEmail, appUrl = "" }) {
  if (runningEmailBatches.has(editionId)) return { started: false, reason: "already_running" };
  runningEmailBatches.add(editionId);
  try {
    const edition = await db.secretSantaEdition.findUnique({ where: { id: editionId } });
    if (!edition || edition.status !== "DRAWN" || edition.personalDataPurgedAt) return { started: false, sent: 0, failed: 0 };
    const pending = await db.secretSantaAssignment.findMany({
      where: { editionId, emailSentAt: null },
      select: {
        id: true,
        giver: { select: { email: true, recipientName: true, userId: true, storeName: true } },
        receiver: { select: RECIPIENT_SELECT },
      },
    });
    // ediție de TEST: niciun email real; marcăm doar „simulat”
    if (isTestEditionKey(edition.key)) {
      for (const item of pending) {
        await db.secretSantaAssignment.update({
          where: { id: item.id },
          data: { emailSentAt: new Date(), emailError: SIMULATED_EMAIL },
        });
      }
      return { started: true, sent: 0, failed: 0, simulated: pending.length };
    }
    let sent = 0;
    let failed = 0;
    for (const item of pending) {
      try {
        await sendEmail({
          to: item.giver.email,
          toName: item.giver.recipientName,
          userId: item.giver.userId,
          editionTitle: edition.title,
          shipByAt: edition.shipByAt,
          recipient: item.receiver,
          link: `${appUrl}/secret-santa`,
          idempotencyKey: `secret-santa-assignment:${item.id}`,
        });
        await db.secretSantaAssignment.update({
          where: { id: item.id },
          data: { emailSentAt: new Date(), emailError: null },
        });
        sent += 1;
      } catch (error) {
        failed += 1;
        const code = cleanText(error?.code || error?.name || "send_failed", 80);
        console.error("[secretSanta] email atribuire eșuat:", item.id, code);
        await db.secretSantaAssignment
          .update({ where: { id: item.id }, data: { emailError: code } })
          .catch(() => null);
      }
    }
    return { started: true, sent, failed };
  } finally {
    runningEmailBatches.delete(editionId);
  }
}

// după eveniment: ștergem datele de livrare (rămân magazinul și statusurile)
export async function purgePersonalData({ db = prisma, editionId, confirm, now = new Date() }) {
  const edition = await db.secretSantaEdition.findUnique({ where: { id: editionId } });
  if (!edition) throw new SecretSantaError(404, "not_found", "Ediția nu există.");
  if (String(confirm || "") !== edition.key) {
    throw new SecretSantaError(400, "confirmation_required", "Scrie cheia ediției pentru a confirma ștergerea.");
  }
  if (edition.status !== "DRAWN") throw new SecretSantaError(409, "not_drawn", "Datele se șterg după încheierea ediției.");
  await db.$transaction([
    db.secretSantaParticipant.updateMany({
      where: { editionId },
      data: { recipientName: "", email: "", phone: "", county: "", city: "", address: "", postalCode: "", preferences: null },
    }),
    db.secretSantaAssignment.updateMany({ where: { editionId }, data: { awb: null, courierName: null } }),
    db.secretSantaEdition.update({ where: { id: editionId }, data: { personalDataPurgedAt: now } }),
  ]);
  return { ok: true };
}

/* ------------- formular de probă pentru ADMIN (înainte de 17 noiembrie) -------------
 * Același formular și aceeași validare ca la vânzători, dar:
 *   - doar pentru ADMIN (garda rutelor Admin), doar până la deschiderea oficială;
 *   - salvat EXCLUSIV în ediția TEST_SECRET_SANTA_FORM (ascunsă public);
 *   - participantul de probă e un Vendor intern INACTIV, fără cont (userId null),
 *     deci nu schimbă rolul nimănui și nu dă acces de vânzător nimănui;
 *   - fără emailuri.
 */
function requireTestFormAvailable(now) {
  if (!isTestFormAvailable(now)) {
    throw new SecretSantaError(410, "test_form_closed", "Înscrierile oficiale au început; formularul de probă nu mai este disponibil.");
  }
}

async function ensureTestFormContext(db) {
  const edition = await db.secretSantaEdition.upsert({
    where: { key: SECRET_SANTA_TEST_FORM_EDITION_KEY },
    create: { key: SECRET_SANTA_TEST_FORM_EDITION_KEY, title: "Secret Santa TEST – înscriere de probă", status: "OPEN" },
    update: {},
  });
  let vendor = await db.vendor.findFirst({
    where: { displayName: SECRET_SANTA_TEST_VENDOR_NAME, userId: null },
    select: { id: true },
  });
  if (!vendor) {
    vendor = await db.vendor.create({
      data: { displayName: SECRET_SANTA_TEST_VENDOR_NAME, isActive: false },
      select: { id: true },
    });
  }
  return { edition, vendorId: vendor.id };
}

export async function getAdminTestFormState({ db = prisma, adminUserId, now = new Date() }) {
  requireTestFormAvailable(now);
  const { edition, vendorId } = await ensureTestFormContext(db);
  const [admin, count, participant] = await Promise.all([
    db.user.findUnique({ where: { id: adminUserId }, select: { email: true } }),
    db.secretSantaParticipant.count({ where: { editionId: edition.id } }),
    db.secretSantaParticipant.findUnique({
      where: { editionId_vendorId: { editionId: edition.id, vendorId } },
      select: { storeName: true, ...RECIPIENT_SELECT, email: true, createdAt: true },
    }),
  ]);
  return {
    edition: publicEdition(edition, count, now),
    eligible: true,
    stores: SECRET_SANTA_TEST_STORES,
    defaults: { email: admin?.email || "", phone: "" },
    registration: participant || null,
    giving: null,
    incoming: null,
  };
}

export async function registerAdminTestForm({ db = prisma, adminUserId, body = {}, now = new Date() }) {
  requireTestFormAvailable(now);
  const data = validateRegistration(body);
  const store = SECRET_SANTA_TEST_STORES.find((item) => item.id === String(body.storeId || "")) || SECRET_SANTA_TEST_STORES[0];
  const { edition, vendorId } = await ensureTestFormContext(db);
  const payload = { ...data, storeName: store.name, dataNoticeAcceptedAt: now };
  const where = { editionId_vendorId: { editionId: edition.id, vendorId } };
  const existing = await db.secretSantaParticipant.findUnique({ where, select: { id: true } });
  if (existing) await db.secretSantaParticipant.update({ where, data: payload });
  else await db.secretSantaParticipant.create({ data: { ...payload, editionId: edition.id, vendorId, userId: adminUserId } });
  return { updated: Boolean(existing), test: true };
}

export async function withdrawAdminTestForm({ db = prisma, now = new Date() }) {
  requireTestFormAvailable(now);
  const { edition, vendorId } = await ensureTestFormContext(db);
  await db.secretSantaParticipant.deleteMany({
    where: { editionId: edition.id, vendorId, giving: { is: null }, receiving: { is: null } },
  });
  return { ok: true };
}
