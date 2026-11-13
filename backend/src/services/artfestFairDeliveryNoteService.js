// backend/src/services/artfestFairDeliveryNoteService.js
//
// Avize de însoțire a mărfii (cod 14-3-6A, OMFP 2634/2015) pentru bunurile pe
// care participantul le trimite la Târgul Artfest.
//
//   - emitent: participantul (VendorBilling), DOAR dacă are formă juridică
//     (SRL / PFA / II / IF) și datele de identificare complete; creatorii
//     independenți (persoane fizice) NU primesc aviz fiscal;
//   - destinatar: Artfest (PlatformBilling, id "platform");
//   - destinație: ArtfestFair.deliveryAddress, setată de Admin (fără ea nu se emite);
//   - liniile vin din inventarul târgului (catalog + produse manuale), cu
//     cantitatea efectiv expediată (transporturi parțiale: suma pe avizele
//     emise <= cantitatea declarată);
//   - prețul unitar e cel confirmat de emitent (fără TVA); prețul de vânzare
//     de la târg e DOAR o sugestie, nu se aplică automat; se poate emite și
//     fără valori; TVA nu se calculează;
//   - numerotare unică per emitent și serie (lock pe emitent, în tranzacție);
//     idempotent pe Idempotency-Key (dublu-click => același aviz);
//   - un aviz emis nu se modifică: corecția = anulare cu motiv + aviz
//     înlocuitor (replacesNoteId), cu număr nou.
//
// Serviciul CITEȘTE inventarul și scrie DOAR în tabelele avizelor: nu atinge
// stocurile, vânzările, comenzile, facturile sau deconturile.

import { prisma } from "../db.js";
import { FAIR_TX_OPTIONS } from "../config/artfestFair.js";
import { FairError, ensureFair } from "./artfestFairService.js";
import { formatFairBarcode } from "./artfestFairInventoryService.js";
import { isManualFairItem } from "../lib/artfestFairManualItem.js";

export const DELIVERY_NOTE_ISSUER_LEGAL_TYPES = Object.freeze(["SRL", "PFA", "II", "IF"]);
// liniile trimise / recepționate pot pleca cu aviz (DRAFT = inventar netrimis)
const NOTE_ITEM_STATUSES = ["SUBMITTED", "RECEIVED"];
const SERIES_RE = /^[A-Z0-9][A-Z0-9-]{0,15}$/;
const IDEMPOTENCY_RE = /^[A-Za-z0-9_-]{8,80}$/;
const MAX_LINES = 500;
const MAX_UNIT_PRICE_CENTS = 100_000_000; // 1.000.000 lei
export const DEFAULT_UNIT = "buc";

const LIMITS = Object.freeze({
  reason: 500,
  notes: 2000,
  delegateName: 160,
  delegateIdSeries: 10,
  delegateIdNumber: 20,
  delegateIdIssuedBy: 120,
  vehicle: 80,
  cancelReason: 1000,
  unit: 16,
});

export function defaultReason(fairTitle) {
  return `Predare bunuri spre comercializare în regim de comision/consignație la ${fairTitle || "Târgul Artfest"}, fără transferul dreptului de proprietate.`;
}

const clean = (value, max) => {
  if (value === undefined || value === null) return null;
  const text = String(value).replace(/\s+/g, " ").trim();
  if (!text) return null;
  return max ? text.slice(0, max) : text;
};

/* ===================== Emitent / destinatar ===================== */

// datele emitentului din VendorBilling; blockers = ce lipsește pentru un aviz fiscal
export function buildIssuer(billing) {
  if (!billing) {
    return {
      eligible: false,
      kind: "missing",
      snapshot: null,
      blockers: [{ code: "issuer_billing_missing", message: "Completează datele de facturare ale magazinului." }],
    };
  }
  const legalType = clean(billing.legalType)?.toUpperCase() || null;
  if (String(billing.sellerType || "") === "independent_creator" || !legalType) {
    return {
      eligible: false,
      kind: "independent_creator",
      snapshot: null,
      blockers: [
        {
          code: "issuer_not_legal_entity",
          message:
            "Avizul de însoțire a mărfii se emite de participanții cu formă juridică (SRL, PFA, II, IF). Ca persoană fizică fără formă juridică, nu poți emite acest document fiscal.",
        },
      ],
    };
  }
  if (!DELIVERY_NOTE_ISSUER_LEGAL_TYPES.includes(legalType)) {
    return {
      eligible: false,
      kind: "unsupported",
      snapshot: null,
      blockers: [{ code: "issuer_legal_type_unsupported", message: "Forma juridică a magazinului nu permite emiterea avizului din Artfest." }],
    };
  }
  const snapshot = {
    name: clean(billing.companyName) || clean(billing.vendorName),
    legalType,
    regCom: clean(billing.regCom),
    cui: clean(billing.cui),
    address: clean(billing.address),
    email: clean(billing.email),
    phone: clean(billing.phone),
  };
  const missing = [];
  if (!snapshot.name) missing.push("denumirea");
  if (!snapshot.cui) missing.push("codul de identificare fiscală (CUI)");
  if (!snapshot.regCom) missing.push("numărul de înmatriculare în Registrul Comerțului");
  if (!snapshot.address) missing.push("sediul");
  const blockers = missing.length
    ? [{ code: "issuer_incomplete", message: `Completează în datele de facturare: ${missing.join(", ")}.`, fields: missing }]
    : [];
  return { eligible: !missing.length, kind: "business", snapshot, blockers };
}

export function buildRecipient(platform) {
  if (!platform) {
    return { snapshot: null, blockers: [{ code: "recipient_missing", message: "Datele Artfest (destinatar) nu sunt încă disponibile. Revino mai târziu." }] };
  }
  const snapshot = {
    name: clean(platform.companyName),
    legalType: clean(platform.legalType),
    regCom: clean(platform.regCom),
    cui: clean(platform.cui),
    address: clean(platform.address),
  };
  const ok = snapshot.name && snapshot.cui && snapshot.address;
  return {
    snapshot,
    blockers: ok ? [] : [{ code: "recipient_incomplete", message: "Datele Artfest (destinatar) sunt incomplete. Revino mai târziu." }],
  };
}

/* ===================== Context ===================== */

async function loadNoteContext(db, vendorId) {
  const fair = await ensureFair(db);
  const fullFair = await db.artfestFair.findUnique({
    where: { id: fair.id },
    select: { id: true, key: true, title: true, city: true, venue: true, deliveryAddress: true },
  });
  const registration = await db.artfestFairRegistration.findUnique({
    where: { fairId_vendorId: { fairId: fair.id, vendorId } },
    select: { id: true, status: true },
  });
  return { fair: fullFair, registration };
}

function requireRegistration(ctx) {
  if (!ctx.registration) throw new FairError(404, "registration_not_found", "Nu ești înscris la târg.");
}

// cantitățile deja trecute pe avize emise (anulatele nu contează), per linie de inventar
async function issuedQtyByItem(db, registrationId, itemIds) {
  const map = new Map();
  if (!itemIds.length) return map;
  const lines = await db.artfestFairDeliveryNoteLine.findMany({
    where: { inventoryItemId: { in: itemIds }, note: { registrationId, status: "ISSUED" } },
    select: { inventoryItemId: true, quantity: true },
  });
  for (const line of lines) map.set(line.inventoryItemId, (map.get(line.inventoryItemId) || 0) + line.quantity);
  return map;
}

async function loadCandidates(db, ctx, vendorId) {
  const items = await db.artfestFairInventoryItem.findMany({
    where: { registrationId: ctx.registration.id, vendorId, status: { in: NOTE_ITEM_STATUSES } },
    orderBy: [{ createdAt: "asc" }],
    select: {
      id: true,
      productId: true,
      variantKey: true,
      variantLabel: true,
      titleSnapshot: true,
      priceSnapshotCents: true,
      currency: true,
      barcode: true,
      declaredQty: true,
      status: true,
    },
  });
  const issued = await issuedQtyByItem(db, ctx.registration.id, items.map((i) => i.id));
  return items.map((item) => {
    const alreadyIssued = issued.get(item.id) || 0;
    return {
      inventoryItemId: item.id,
      title: item.titleSnapshot,
      variantLabel: item.variantLabel || null,
      internalCode: formatFairBarcode(item.barcode),
      isManual: isManualFairItem(item),
      status: item.status,
      declaredQty: item.declaredQty,
      issuedQty: alreadyIssued,
      remainingQty: Math.max(0, item.declaredQty - alreadyIssued),
      // DOAR sugestie (preț de vânzare la târg, cu TVA inclus dacă e cazul) - nu e prețul contabil
      fairPriceCents: item.priceSnapshotCents,
      currency: item.currency || "RON",
    };
  });
}

async function loadParties(db, vendorId) {
  const [billing, platform] = await Promise.all([
    db.vendorBilling.findUnique({ where: { vendorId } }),
    db.platformBilling.findUnique({ where: { id: "platform" } }),
  ]);
  return { issuer: buildIssuer(billing), recipient: buildRecipient(platform) };
}

/* ===================== Serializare ===================== */

export function serializeNote(note) {
  return {
    id: note.id,
    series: note.series,
    number: note.number,
    displayNumber: `${note.series} nr. ${note.number}`,
    status: note.status,
    issuedAt: note.issuedAt,
    issuer: note.issuerSnapshot,
    recipient: note.recipientSnapshot,
    destination: note.destination,
    reason: note.reason,
    withoutInvoice: note.withoutInvoice,
    withoutValues: note.withoutValues,
    notes: note.notes || null,
    delegate: {
      name: note.delegateName || null,
      idSeries: note.delegateIdSeries || null,
      idNumber: note.delegateIdNumber || null,
      idIssuedBy: note.delegateIdIssuedBy || null,
    },
    vehicle: note.vehicle || null,
    shippedAt: note.shippedAt || null,
    totalValueCents: note.totalValueCents ?? null,
    currency: note.currency,
    cancelledAt: note.cancelledAt || null,
    cancelReason: note.cancelReason || null,
    replacesNoteId: note.replacesNoteId || null,
    replaces: note.replaces ? { id: note.replaces.id, series: note.replaces.series, number: note.replaces.number } : null,
    replacedBy: note.replacedBy ? { id: note.replacedBy.id, series: note.replacedBy.series, number: note.replacedBy.number } : null,
    lines: (note.lines || [])
      .slice()
      .sort((a, b) => a.position - b.position)
      .map((l) => ({
        position: l.position,
        inventoryItemId: l.inventoryItemId,
        title: l.titleSnapshot,
        variantLabel: l.variantLabel || null,
        internalCode: l.internalCode,
        isManual: l.isManual,
        unit: l.unit,
        quantity: l.quantity,
        unitPriceCents: l.unitPriceCents ?? null,
        valueCents: l.valueCents ?? null,
      })),
    totalQuantity: (note.lines || []).reduce((sum, l) => sum + l.quantity, 0),
  };
}

const NOTE_INCLUDE = {
  lines: true,
  replaces: { select: { id: true, series: true, number: true } },
  replacedBy: { select: { id: true, series: true, number: true } },
};

/* ===================== Previzualizare / istoric ===================== */

export async function getDeliveryNotePreview({ vendorId, db = prisma }) {
  const ctx = await loadNoteContext(db, vendorId);
  requireRegistration(ctx);
  const { issuer, recipient } = await loadParties(db, vendorId);
  const candidates = await loadCandidates(db, ctx, vendorId);
  const series = await db.artfestDeliveryNoteSeries.findMany({
    where: { vendorId },
    orderBy: { updatedAt: "desc" },
    select: { series: true, nextNumber: true },
  });

  const blockers = [...issuer.blockers, ...recipient.blockers];
  if (ctx.registration.status !== "APPROVED") {
    blockers.push({ code: "registration_not_approved", message: "Avizele se emit doar pentru înscrierile aprobate." });
  }
  if (!ctx.fair.deliveryAddress) {
    blockers.push({
      code: "delivery_address_missing",
      message: "Artfest nu a comunicat încă adresa de livrare a târgului. Avizul se poate emite după ce adresa este disponibilă.",
    });
  }
  if (!candidates.some((c) => c.remainingQty > 0)) {
    blockers.push({
      code: "no_items",
      message: "Nu există produse trimise în inventar care să nu fie deja trecute pe un aviz. Trimite mai întâi inventarul.",
    });
  }

  return {
    canIssue: blockers.length === 0,
    blockers,
    issuerKind: issuer.kind,
    issuer: issuer.snapshot,
    recipient: recipient.snapshot,
    fair: { title: ctx.fair.title, city: ctx.fair.city || null, venue: ctx.fair.venue || null },
    destination: ctx.fair.deliveryAddress || null,
    defaults: { reason: defaultReason(ctx.fair.title), unit: DEFAULT_UNIT, currency: "RON" },
    series,
    items: candidates,
  };
}

export async function listDeliveryNotes({ vendorId, db = prisma }) {
  const ctx = await loadNoteContext(db, vendorId);
  if (!ctx.registration) return { notes: [] };
  const notes = await db.artfestFairDeliveryNote.findMany({
    where: { vendorId, registrationId: ctx.registration.id },
    orderBy: [{ issuedAt: "desc" }],
    include: NOTE_INCLUDE,
  });
  return { notes: notes.map(serializeNote) };
}

export async function getDeliveryNote({ vendorId, id, db = prisma }) {
  const note = await db.artfestFairDeliveryNote.findFirst({ where: { id: String(id || ""), vendorId }, include: NOTE_INCLUDE });
  if (!note) throw new FairError(404, "delivery_note_not_found", "Avizul nu a fost găsit.");
  return note;
}

/* ===================== Validare ===================== */

function parseCents(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > MAX_UNIT_PRICE_CENTS) return NaN;
  return n;
}

function parseShippedAt(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new FairError(400, "invalid_shipped_at", "Data și ora expedierii nu sunt valide.");
  return d;
}

export function normalizeIssueInput(body = {}) {
  const fields = {};
  const series = String(body.series || "").trim().toUpperCase();
  if (!SERIES_RE.test(series)) fields.series = "Seria are 1-16 caractere: litere, cifre sau cratimă.";

  let startNumber = null;
  if (body.startNumber !== undefined && body.startNumber !== null && body.startNumber !== "") {
    startNumber = Number(body.startNumber);
    if (!Number.isInteger(startNumber) || startNumber < 1 || startNumber > 99_999_999) {
      fields.startNumber = "Numărul de început trebuie să fie un număr întreg pozitiv.";
    }
  }

  const reason = clean(body.reason, LIMITS.reason);
  if (!reason) fields.reason = "Completează motivul expedierii.";

  const withoutValues = body.withoutValues === true;
  const withoutInvoice = body.withoutInvoice === true;
  const valuesConfirmed = body.valuesConfirmed === true;

  const rawLines = Array.isArray(body.lines) ? body.lines : [];
  if (!rawLines.length) fields.lines = "Alege cel puțin un produs.";
  if (rawLines.length > MAX_LINES) fields.lines = `Cel mult ${MAX_LINES} produse pe un aviz.`;

  const seen = new Set();
  const lines = [];
  rawLines.slice(0, MAX_LINES).forEach((raw, index) => {
    const inventoryItemId = String(raw?.inventoryItemId || "");
    const quantity = Number(raw?.quantity);
    const unit = clean(raw?.unit, LIMITS.unit) || DEFAULT_UNIT;
    const unitPriceCents = withoutValues ? null : parseCents(raw?.unitPriceCents);
    if (!inventoryItemId || seen.has(inventoryItemId)) {
      fields[`lines.${index}`] = "Produs invalid sau repetat.";
      return;
    }
    seen.add(inventoryItemId);
    if (!Number.isInteger(quantity) || quantity < 1) fields[`lines.${index}.quantity`] = "Cantitatea trebuie să fie cel puțin 1.";
    if (!withoutValues) {
      if (unitPriceCents === null) fields[`lines.${index}.unitPriceCents`] = "Completează prețul unitar sau emite avizul fără valori.";
      else if (Number.isNaN(unitPriceCents)) fields[`lines.${index}.unitPriceCents`] = "Preț unitar invalid.";
    }
    lines.push({ inventoryItemId, quantity, unit, unitPriceCents: Number.isNaN(unitPriceCents) ? null : unitPriceCents });
  });

  // valorile sunt declarația emitentului: confirmare explicită că sunt fără TVA / valoarea corectă
  if (!withoutValues && !valuesConfirmed) {
    fields.valuesConfirmed = "Confirmă că prețurile unitare sunt valorile corecte pentru aviz (fără TVA).";
  }

  const shippedAt = parseShippedAt(body.shippedAt);

  if (Object.keys(fields).length) {
    throw new FairError(400, "invalid_delivery_note", "Verifică datele avizului.", { fields });
  }

  return {
    series,
    startNumber,
    reason,
    withoutValues,
    withoutInvoice,
    notes: clean(body.notes, LIMITS.notes),
    delegateName: clean(body.delegateName, LIMITS.delegateName),
    delegateIdSeries: clean(body.delegateIdSeries, LIMITS.delegateIdSeries)?.toUpperCase() || null,
    delegateIdNumber: clean(body.delegateIdNumber, LIMITS.delegateIdNumber),
    delegateIdIssuedBy: clean(body.delegateIdIssuedBy, LIMITS.delegateIdIssuedBy),
    vehicle: clean(body.vehicle, LIMITS.vehicle)?.toUpperCase() || null,
    shippedAt,
    replacesNoteId: body.replacesNoteId ? String(body.replacesNoteId) : null,
    lines,
  };
}

/* ===================== Emitere ===================== */

export async function issueDeliveryNote({ vendorId, userId, idempotencyKey, body, db = prisma }) {
  const key = String(idempotencyKey || "").trim();
  if (!IDEMPOTENCY_RE.test(key)) {
    throw new FairError(400, "idempotency_key_required", "Cererea nu are o cheie de unicitate validă. Reîncarcă pagina și încearcă din nou.");
  }

  // dublu-click / retrimitere: același aviz, fără număr nou
  const existing = await db.artfestFairDeliveryNote.findUnique({
    where: { vendorId_idempotencyKey: { vendorId, idempotencyKey: key } },
    include: NOTE_INCLUDE,
  });
  if (existing) return { note: serializeNote(existing), duplicate: true };

  const input = normalizeIssueInput(body);

  return db.$transaction(async (tx) => {
    // un singur emitent la un moment dat: numerotare fără goluri / dubluri
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`artfest-delivery-note:${vendorId}`}))`;

    const again = await tx.artfestFairDeliveryNote.findUnique({
      where: { vendorId_idempotencyKey: { vendorId, idempotencyKey: key } },
      include: NOTE_INCLUDE,
    });
    if (again) return { note: serializeNote(again), duplicate: true };

    const ctx = await loadNoteContext(tx, vendorId);
    requireRegistration(ctx);
    if (ctx.registration.status !== "APPROVED") {
      throw new FairError(403, "registration_not_approved", "Avizele se emit doar pentru înscrierile aprobate.");
    }
    if (!ctx.fair.deliveryAddress) {
      throw new FairError(409, "delivery_address_missing", "Artfest nu a comunicat încă adresa de livrare a târgului.");
    }
    const { issuer, recipient } = await loadParties(tx, vendorId);
    const blockers = [...issuer.blockers, ...recipient.blockers];
    if (blockers.length) throw new FairError(409, blockers[0].code, blockers[0].message);

    if (input.replacesNoteId) {
      const old = await tx.artfestFairDeliveryNote.findFirst({
        where: { id: input.replacesNoteId, vendorId },
        select: { id: true, status: true, replacedBy: { select: { id: true } } },
      });
      if (!old) throw new FairError(404, "delivery_note_not_found", "Avizul înlocuit nu a fost găsit.");
      if (old.status !== "CANCELLED") {
        throw new FairError(409, "replaced_note_not_cancelled", "Anulează mai întâi avizul pe care vrei să îl înlocuiești.");
      }
      if (old.replacedBy) throw new FairError(409, "note_already_replaced", "Avizul anulat are deja un aviz înlocuitor.");
    }

    // cantitățile se verifică pe datele din tranzacție (doar produsele proprii)
    const candidates = new Map((await loadCandidates(tx, ctx, vendorId)).map((c) => [c.inventoryItemId, c]));
    const fields = {};
    input.lines.forEach((line, index) => {
      const c = candidates.get(line.inventoryItemId);
      if (!c) fields[`lines.${index}`] = "Produsul nu este în inventarul tău trimis pentru târg.";
      else if (line.quantity > c.remainingQty) {
        fields[`lines.${index}.quantity`] = `Cantitate prea mare: mai poți trece pe aviz ${c.remainingQty} buc. din ${c.declaredQty} declarate.`;
      }
    });
    if (Object.keys(fields).length) {
      throw new FairError(409, "delivery_note_quantity_invalid", "Verifică produsele și cantitățile.", { fields });
    }

    let seriesRow = await tx.artfestDeliveryNoteSeries.findUnique({
      where: { vendorId_series: { vendorId, series: input.series } },
    });
    if (!seriesRow) {
      seriesRow = await tx.artfestDeliveryNoteSeries.create({
        data: { vendorId, series: input.series, nextNumber: input.startNumber || 1 },
      });
    }
    const number = seriesRow.nextNumber;
    await tx.artfestDeliveryNoteSeries.update({ where: { id: seriesRow.id }, data: { nextNumber: number + 1 } });

    const lines = input.lines.map((line, index) => {
      const c = candidates.get(line.inventoryItemId);
      const valueCents = line.unitPriceCents === null ? null : line.unitPriceCents * line.quantity;
      return {
        inventoryItemId: line.inventoryItemId,
        position: index + 1,
        titleSnapshot: String(c.title || "").slice(0, 200),
        variantLabel: c.variantLabel ? String(c.variantLabel).slice(0, 200) : null,
        internalCode: c.internalCode,
        isManual: c.isManual,
        unit: line.unit,
        quantity: line.quantity,
        unitPriceCents: input.withoutValues ? null : line.unitPriceCents,
        valueCents: input.withoutValues ? null : valueCents,
      };
    });
    const totalValueCents = input.withoutValues ? null : lines.reduce((sum, l) => sum + (l.valueCents || 0), 0);

    const note = await tx.artfestFairDeliveryNote.create({
      data: {
        fairId: ctx.fair.id,
        registrationId: ctx.registration.id,
        vendorId,
        series: input.series,
        number,
        issuedById: userId || null,
        idempotencyKey: key,
        issuerSnapshot: issuer.snapshot,
        recipientSnapshot: recipient.snapshot,
        destination: ctx.fair.deliveryAddress,
        reason: input.reason,
        withoutInvoice: input.withoutInvoice,
        withoutValues: input.withoutValues,
        notes: input.notes,
        delegateName: input.delegateName,
        delegateIdSeries: input.delegateIdSeries,
        delegateIdNumber: input.delegateIdNumber,
        delegateIdIssuedBy: input.delegateIdIssuedBy,
        vehicle: input.vehicle,
        shippedAt: input.shippedAt,
        totalValueCents,
        currency: "RON",
        replacesNoteId: input.replacesNoteId,
        lines: { create: lines },
      },
      include: NOTE_INCLUDE,
    });
    return { note: serializeNote(note), duplicate: false };
  }, FAIR_TX_OPTIONS);
}

/* ===================== Anulare (trasabilă) ===================== */

export async function cancelDeliveryNote({ vendorId, userId, id, reason, db = prisma }) {
  const text = clean(reason, LIMITS.cancelReason);
  if (!text || text.length < 5) {
    throw new FairError(400, "cancel_reason_required", "Scrie motivul anulării (cel puțin 5 caractere).", {
      fields: { reason: "Scrie motivul anulării." },
    });
  }
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`artfest-delivery-note:${vendorId}`}))`;
    const note = await tx.artfestFairDeliveryNote.findFirst({ where: { id: String(id || ""), vendorId }, select: { id: true, status: true } });
    if (!note) throw new FairError(404, "delivery_note_not_found", "Avizul nu a fost găsit.");
    if (note.status === "CANCELLED") throw new FairError(409, "delivery_note_already_cancelled", "Avizul este deja anulat.");
    const updated = await tx.artfestFairDeliveryNote.update({
      where: { id: note.id },
      data: { status: "CANCELLED", cancelledAt: new Date(), cancelledById: userId || null, cancelReason: text },
      include: NOTE_INCLUDE,
    });
    return serializeNote(updated);
  }, FAIR_TX_OPTIONS);
}
