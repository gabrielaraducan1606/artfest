// backend/src/services/artfestFairDeliveryNoteService.js
//
// Avize de însoțire a mărfii (cod 14-3-6A, OMFP 2634/2015) pentru bunurile pe
// care participantul le trimite la Târgul Artfest.
//
//   - emitent: participantul (VendorBilling), DOAR dacă are formă juridică
//     (SRL / PFA / II / IF) și datele de identificare complete; creatorii
//     independenți (persoane fizice) NU primesc aviz fiscal;
//   - destinatar: Artfest (PlatformBilling, id "platform");
//   - destinație: precompletată din ARTFEST_FAIR_RECEIVING_ADDRESS (adresa de
//     recepție Artfest, doar din mediul backend); emitentul o poate schimba (ex.
//     predare direct la târg); adresa finală se îngheață în aviz. Fără variabilă
//     nu se emite (409 cu mesaj, nu 500);
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
import { ARTFEST_FAIR_KEY, FAIR_TX_OPTIONS } from "../config/artfestFair.js";
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
  destination: 500,
});

// adresa de recepție a coletelor (variabilă de mediu în Render); fără fallback inventat
export function receivingAddress() {
  const value = String(process.env.ARTFEST_FAIR_RECEIVING_ADDRESS || "").replace(/\s+/g, " ").trim();
  return value || null;
}

const RECEIVING_ADDRESS_MISSING = Object.freeze({
  code: "receiving_address_missing",
  message:
    "Adresa de recepție Artfest nu este încă configurată, așa că avizul nu poate fi emis acum. Revino mai târziu sau contactează Artfest.",
});

export function defaultReason() {
  return "Predare de bunuri în regim de comision/consignație, în vederea comercializării prin Artfest. Bunurile rămân în proprietatea expeditorului până la vânzare. Facturarea bunurilor vândute se realizează ulterior, conform contractului și legislației aplicabile.";
}

const clean = (value, max) => {
  if (value === undefined || value === null) return null;
  const text = String(value).replace(/\s+/g, " ").trim();
  if (!text) return null;
  return max ? text.slice(0, max) : text;
};

/* ===================== Emitent / destinatar ===================== */

// câmpurile din VendorBilling cerute pe aviz, cu denumiri pe înțelesul participantului
const ISSUER_FIELD_LABELS = Object.freeze({
  legalType: "Forma juridică (SRL, PFA, II sau IF)",
  companyName: "Denumirea firmei",
  cui: "Codul de identificare fiscală (CUI)",
  regCom: "Numărul de înregistrare la Registrul Comerțului",
  address: "Adresa sediului",
});
const missingField = (field) => ({ field, label: ISSUER_FIELD_LABELS[field] });

/*
 * Regimul TVA al emitentului, DOAR informativ (nu se calculează TVA, nu se aplică vatRate):
 * status = VendorBilling.vatStatus ("payer" / "non_payer" / null = necunoscut);
 * anafMismatch = ultima verificare ANAF (tvaActive) contrazice statutul declarat.
 */
export function issuerVatInfo(billing) {
  if (!billing) return null;
  const raw = String(billing.vatStatus || "");
  const status = raw === "payer" || raw === "non_payer" ? raw : null;
  const anaf = typeof billing.tvaActive === "boolean" ? billing.tvaActive : null;
  return {
    status,
    anafMismatch: Boolean(status && anaf !== null && anaf !== (status === "payer")),
  };
}

// datele emitentului din VendorBilling; blockers = ce lipsește pentru un aviz fiscal.
// billingAction: "complete" (nu există date de facturare) / "update" (există, dar nu ajung);
// missing: câmpurile concrete de completat în pagina de facturare existentă.
export function buildIssuer(billing) {
  if (!billing) {
    const missing = Object.keys(ISSUER_FIELD_LABELS).map(missingField);
    return {
      eligible: false,
      kind: "missing",
      snapshot: null,
      billingAction: "complete",
      missing,
      blockers: [
        { code: "issuer_billing_missing", message: "Completează datele de facturare ale magazinului.", billing: true },
      ],
    };
  }
  const legalType = clean(billing.legalType)?.toUpperCase() || null;
  if (String(billing.sellerType || "") === "independent_creator") {
    return {
      eligible: false,
      kind: "independent_creator",
      snapshot: null,
      billingAction: "update",
      missing: [missingField("legalType")],
      blockers: [
        {
          code: "issuer_not_legal_entity",
          message:
            "Avizul de însoțire a mărfii se emite de participanții cu formă juridică (SRL, PFA, II, IF). Ca persoană fizică fără formă juridică, nu poți emite acest document fiscal.",
          billing: true,
        },
      ],
    };
  }
  if (legalType && !DELIVERY_NOTE_ISSUER_LEGAL_TYPES.includes(legalType)) {
    return {
      eligible: false,
      kind: "unsupported",
      snapshot: null,
      billingAction: "update",
      missing: [missingField("legalType")],
      blockers: [
        {
          code: "issuer_legal_type_unsupported",
          message: "Forma juridică a magazinului nu permite emiterea avizului din Artfest.",
          billing: true,
        },
      ],
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
  if (!snapshot.legalType) missing.push(missingField("legalType"));
  if (!snapshot.name) missing.push(missingField("companyName"));
  if (!snapshot.cui) missing.push(missingField("cui"));
  if (!snapshot.regCom) missing.push(missingField("regCom"));
  if (!snapshot.address) missing.push(missingField("address"));
  const blockers = missing.length
    ? [
        {
          code: "issuer_incomplete",
          message: `Completează în datele de facturare: ${missing.map((m) => m.label).join("; ")}.`,
          billing: true,
        },
      ]
    : [];
  return {
    eligible: !missing.length,
    kind: "business",
    snapshot,
    billingAction: missing.length ? "update" : null,
    missing,
    blockers,
  };
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
    select: { id: true, key: true, title: true, city: true, venue: true },
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
      // priceSnapshotCents = prețul de vânzare la târg (cel de pe etichetă, plătit de client; pentru
      // produsele din catalog e Product.priceCents la sincronizare, pentru cele manuale e prețul
      // introdus de vânzător). Doar REFERINȚĂ în formular: pe aviz se trece prețul artizanului,
      // care nu există separat în inventar și se completează de vânzător.
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
  return { issuer: { ...buildIssuer(billing), vat: issuerVatInfo(billing) }, recipient: buildRecipient(platform) };
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
  const receiving = receivingAddress();
  if (!receiving) blockers.push(RECEIVING_ADDRESS_MISSING);
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
    // ce lipsește din datele de facturare (VendorBilling) pentru aviz; null = complete
    billing: issuer.billingAction ? { action: issuer.billingAction, missing: issuer.missing } : null,
    // regimul TVA declarat de emitent (informativ; avizul nu calculează TVA)
    issuerVat: issuer.vat,
    recipient: recipient.snapshot,
    fair: { title: ctx.fair.title, city: ctx.fair.city || null, venue: ctx.fair.venue || null },
    // adresa de recepție doar pentru participanții aprobați (fluxul de emitere)
    destination: ctx.registration.status === "APPROVED" ? receiving : null,
    defaults: { reason: defaultReason(), unit: DEFAULT_UNIT, currency: "RON" },
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

/* ===================== Admin (doar citire) ===================== */
//
// Avizele tuturor participanților la târgul curent. Nimic de aici nu scrie:
// avizul NU înseamnă recepție (receivedQty / stocul rămân neatinse).

export const ADMIN_NOTES_PAGE_SIZE = 20;

// târgul curent, doar citire (fără ensureFair, care îl poate crea)
async function currentFairReadOnly(db) {
  return db.artfestFair.findUnique({ where: { key: ARTFEST_FAIR_KEY }, select: { id: true, title: true } });
}
const ADMIN_STATUS_FILTERS = { ISSUED: "ISSUED", CANCELLED: "CANCELLED" };

// „AV 12”, „AV-12”, „AV nr. 12”, „12” -> { series?, number? }
function parseNoteNumberQuery(q) {
  const text = q.toUpperCase().replace(/\s+/g, " ").trim();
  if (/^\d{1,9}$/.test(text)) return { number: Number(text) };
  const m = text.match(/^([A-Z0-9][A-Z0-9-]*?)[\s.-]*(?:NR\.?\s*)?(\d{1,9})$/);
  if (m && /[A-Z]/.test(m[1])) return { series: m[1].replace(/-+$/, ""), number: Number(m[2]) };
  return null;
}

function adminNotesWhere(fairId, { q, status }) {
  const where = { fairId };
  if (status) {
    const s = ADMIN_STATUS_FILTERS[String(status).toUpperCase()];
    if (!s) throw new FairError(400, "invalid_status", "Status invalid.");
    where.status = s;
  }
  const text = clean(q, 120);
  if (text) {
    const or = [
      { vendor: { displayName: { contains: text, mode: "insensitive" } } },
      { vendor: { billing: { is: { companyName: { contains: text, mode: "insensitive" } } } } },
      { series: { contains: text.toUpperCase() } },
    ];
    const num = parseNoteNumberQuery(text);
    if (num?.series) or.push({ series: num.series, number: num.number });
    else if (num) or.push({ number: num.number });
    where.OR = or;
  }
  return where;
}

function adminVendor(vendor) {
  return vendor ? { id: vendor.id, displayName: vendor.displayName || null } : null;
}

export async function listDeliveryNotesForAdmin({ q = null, status = null, page = 1, db = prisma } = {}) {
  const pageNum = Math.max(1, Math.min(10_000, Number.parseInt(page, 10) || 1));
  const fair = await currentFairReadOnly(db);
  if (!fair) return { fair: null, page: 1, pageSize: ADMIN_NOTES_PAGE_SIZE, total: 0, pages: 1, notes: [] };
  const where = adminNotesWhere(fair.id, { q, status });
  const [total, notes] = await Promise.all([
    db.artfestFairDeliveryNote.count({ where }),
    db.artfestFairDeliveryNote.findMany({
      where,
      orderBy: [{ issuedAt: "desc" }, { id: "desc" }],
      skip: (pageNum - 1) * ADMIN_NOTES_PAGE_SIZE,
      take: ADMIN_NOTES_PAGE_SIZE,
      select: {
        id: true,
        series: true,
        number: true,
        status: true,
        issuedAt: true,
        destination: true,
        withoutValues: true,
        totalValueCents: true,
        currency: true,
        issuerSnapshot: true,
        cancelledAt: true,
        vendor: { select: { id: true, displayName: true } },
        lines: { select: { quantity: true } },
      },
    }),
  ]);
  return {
    fair: { id: fair.id, title: fair.title || null },
    page: pageNum,
    pageSize: ADMIN_NOTES_PAGE_SIZE,
    total,
    pages: Math.max(1, Math.ceil(total / ADMIN_NOTES_PAGE_SIZE)),
    notes: notes.map((n) => ({
      id: n.id,
      series: n.series,
      number: n.number,
      displayNumber: `${n.series} nr. ${n.number}`,
      status: n.status,
      issuedAt: n.issuedAt,
      // numele înghețat pe aviz (emitentul la data emiterii) + magazinul
      issuerName: n.issuerSnapshot?.name || null,
      vendor: adminVendor(n.vendor),
      linesCount: n.lines.length,
      totalQuantity: n.lines.reduce((s, l) => s + l.quantity, 0),
      withoutValues: n.withoutValues,
      totalValueCents: n.withoutValues ? null : n.totalValueCents ?? null,
      currency: n.currency,
      destination: n.destination,
      cancelledAt: n.cancelledAt || null,
    })),
  };
}

// orice aviz al târgului curent (Admin); avizul altui târg => 404
export async function getDeliveryNoteForAdmin({ id, db = prisma }) {
  const fair = await currentFairReadOnly(db);
  if (!fair) throw new FairError(404, "delivery_note_not_found", "Avizul nu a fost găsit.");
  const note = await db.artfestFairDeliveryNote.findFirst({
    where: { id: String(id || ""), fairId: fair.id },
    include: { ...NOTE_INCLUDE, vendor: { select: { id: true, displayName: true } } },
  });
  if (!note) throw new FairError(404, "delivery_note_not_found", "Avizul nu a fost găsit.");
  return note;
}

export function serializeNoteForAdmin(note) {
  return { ...serializeNote(note), vendor: adminVendor(note.vendor) };
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

  // gol => adresa de recepție Artfest; altfel adresa efectivă (ex. predare la târg)
  const destination = clean(body.destination, LIMITS.destination);
  if (destination && destination.length < 10) fields.destination = "Scrie adresa completă de livrare.";

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
    destination,
    lines,
  };
}

/* ===================== Emitere ===================== */

/*
 * Validare + datele avizului, FĂRĂ scrieri (folosit de emitere, în tranzacție,
 * și de previzualizare). Aruncă FairError cu mesaj clar la orice blocaj.
 */
async function prepareNoteData(db, vendorId, input) {
  const ctx = await loadNoteContext(db, vendorId);
  requireRegistration(ctx);
  if (ctx.registration.status !== "APPROVED") {
    throw new FairError(403, "registration_not_approved", "Avizele se emit doar pentru înscrierile aprobate.");
  }
  const receiving = receivingAddress();
  if (!receiving) throw new FairError(409, RECEIVING_ADDRESS_MISSING.code, RECEIVING_ADDRESS_MISSING.message);
  // adresa aleasă de emitent (implicit: recepția Artfest), înghețată în aviz
  const destination = input.destination || receiving;
  const { issuer, recipient } = await loadParties(db, vendorId);
  const blockers = [...issuer.blockers, ...recipient.blockers];
  if (blockers.length) throw new FairError(409, blockers[0].code, blockers[0].message);

  let replaces = null;
  if (input.replacesNoteId) {
    const old = await db.artfestFairDeliveryNote.findFirst({
      where: { id: input.replacesNoteId, vendorId },
      select: { id: true, series: true, number: true, status: true, replacedBy: { select: { id: true } } },
    });
    if (!old) throw new FairError(404, "delivery_note_not_found", "Avizul înlocuit nu a fost găsit.");
    if (old.status !== "CANCELLED") {
      throw new FairError(409, "replaced_note_not_cancelled", "Anulează mai întâi avizul pe care vrei să îl înlocuiești.");
    }
    if (old.replacedBy) throw new FairError(409, "note_already_replaced", "Avizul anulat are deja un aviz înlocuitor.");
    replaces = { id: old.id, series: old.series, number: old.number };
  }

  // doar produsele proprii, cu cantitatea rămasă după avizele emise
  const candidates = new Map((await loadCandidates(db, ctx, vendorId)).map((c) => [c.inventoryItemId, c]));
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
  return { ctx, issuer, recipient, destination, lines, totalValueCents, replaces };
}

/*
 * Previzualizare: același conținut ca avizul final, fără serie / număr definitiv
 * și fără NICIO scriere (nu creează aviz, nu consumă număr, nu atinge inventarul).
 */
export async function previewDeliveryNoteDraft({ vendorId, body, db = prisma, now = new Date() }) {
  const input = normalizeIssueInput(body);
  const { issuer, recipient, destination, lines, totalValueCents, replaces } = await prepareNoteData(db, vendorId, input);
  return {
    ...serializeNote({
      id: null,
      series: null,
      number: null,
      status: "ISSUED",
      issuedAt: now,
      issuerSnapshot: issuer.snapshot,
      recipientSnapshot: recipient.snapshot,
      destination,
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
      replacesNoteId: replaces?.id || null,
      replaces,
      replacedBy: null,
      lines,
    }),
    displayNumber: null,
    preview: true,
  };
}

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

    // validare + date înghețate, pe datele din tranzacție
    const { ctx, issuer, recipient, destination, lines, totalValueCents } = await prepareNoteData(tx, vendorId, input);

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
        destination,
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
