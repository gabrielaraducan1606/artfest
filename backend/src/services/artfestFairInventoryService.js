// backend/src/services/artfestFairInventoryService.js
//
// Inventarul Târgului Artfest - partea de vendor (etapa 1):
// linii DRAFT, trimitere (cu rezervarea stocului online), sincronizare preț,
// date pentru etichete. Recepția, vânzarea, decontul și returul NU sunt aici.
//
// Reguli de securitate:
//   - vendorId vine DOAR din sesiune; liniile altui vendor => 404;
//   - doar înscrierile APPROVED pot crea / edita / trimite;
//   - codul de bare, prețul, cantitățile recepționate/vândute, statusul și
//     câmpurile de rezervare online NU vin niciodată din client.
//
// Rezervarea online la SUBMITTED (într-o singură tranzacție, cu
// pg_advisory_xact_lock pe fiecare produs):
//   A. READY cu readyQty urmărit  -> readyQty scade atomic cu suma declarată
//      (SOLD_OUT la 0, ca la checkout); linia: TRANSFERRED;
//   B. unicat                     -> starea anterioară salvată, produsul
//      devine SOLD_OUT online; linia: FORCED_UNAVAILABLE;
//   C. altfel (la comandă / precomandă / stoc neurmărit / epuizat) -> NONE.

import crypto from "node:crypto";
import { prisma } from "../db.js";
import { buildConfigurationKey } from "../lib/configurationKey.js";
import {
  ACTIVE_INVENTORY_STATUSES,
  FAIR_TX_OPTIONS,
  FAIR_BARCODE_ALPHABET,
  FAIR_BARCODE_LENGTH,
  FAIR_BARCODE_PREFIX,
  LABEL_INVENTORY_STATUSES,
  MAX_DECLARED_QTY,
} from "../config/artfestFair.js";
import { FairError, ensureFair } from "./artfestFairService.js";
import { lockProductForFair } from "./fairProductLock.js";

const TEXT_LIMIT = 2000;

/* ===================== Cod de bare ===================== */

export function generateFairBarcode(randomInt = crypto.randomInt) {
  let code = FAIR_BARCODE_PREFIX;
  for (let i = 0; i < FAIR_BARCODE_LENGTH; i += 1) {
    code += FAIR_BARCODE_ALPHABET[randomInt(FAIR_BARCODE_ALPHABET.length)];
  }
  return code;
}

// afișare pe etichetă: AF-7K3M-9QXT (codul de bare conține AF7K3M9QXT)
export function formatFairBarcode(barcode) {
  const raw = String(barcode || "");
  if (raw.length !== FAIR_BARCODE_PREFIX.length + FAIR_BARCODE_LENGTH) return raw;
  return `${raw.slice(0, 2)}-${raw.slice(2, 6)}-${raw.slice(6)}`;
}

/* ===================== Variante (optionsSchema) ===================== */

function schemaFields(schema) {
  if (Array.isArray(schema)) return schema;
  if (Array.isArray(schema?.fields)) return schema.fields;
  return [];
}

/*
 * Câmpurile de variantă ale produsului: toate câmpurile din optionsSchema
 * (select-uri; personalizarea text/dată/fișier e în customSchema și NU
 * definește variante de inventar). Opțiunile dezactivate sunt excluse.
 */
export function inventoryOptionFields(product) {
  return schemaFields(product?.optionsSchema)
    .map((field) => {
      const key = String(field?.key || "").trim();
      const label = String(field?.label || key).trim();
      if (!key) return null;

      const raw = Array.isArray(field?.options) ? field.options : Array.isArray(field?.values) ? field.values : [];
      const choices = raw
        .map((item) => {
          if (typeof item === "string") {
            const text = item.trim();
            return text ? { value: text, label: text, imageIndex: null } : null;
          }
          if (!item || typeof item !== "object" || item.disabled) return null;
          const value = String(item.value || item.key || item.label || "").trim();
          const optionLabel = String(item.label || item.value || item.key || "").trim();
          if (!value) return null;
          return {
            value,
            label: optionLabel || value,
            imageIndex: Number.isInteger(item.imageIndex) && item.imageIndex >= 0 ? item.imageIndex : null,
          };
        })
        .filter(Boolean);

      if (!choices.length) return null;
      return { key, label, required: field?.required !== false, choices };
    })
    .filter(Boolean);
}

/*
 * Validează opțiunile alese față de optionsSchema și calculează cheia cu
 * ACEEAȘI funcție ca online (buildConfigurationKey; fără personalizare).
 */
export function resolveVariant(product, rawSelected = {}) {
  const fields = inventoryOptionFields(product);
  const input = rawSelected && typeof rawSelected === "object" && !Array.isArray(rawSelected) ? rawSelected : {};
  const errors = {};
  const selected = {};
  const options = [];
  let imageIndex = null;

  const knownKeys = new Set(fields.map((f) => f.key));
  for (const key of Object.keys(input)) {
    if (!knownKeys.has(key)) errors[key] = "Opțiune necunoscută pentru acest produs.";
  }

  for (const field of fields) {
    const value = input[field.key] == null ? "" : String(input[field.key]).trim();
    if (!value) {
      if (field.required) errors[field.key] = `Alege ${field.label.toLowerCase()}.`;
      continue;
    }
    const choice = field.choices.find((c) => c.value === value);
    if (!choice) {
      errors[field.key] = `Valoare invalidă pentru ${field.label.toLowerCase()}.`;
      continue;
    }
    selected[field.key] = choice.value;
    options.push({ key: field.key, label: field.label, value: choice.value, valueLabel: choice.label });
    if (imageIndex === null && choice.imageIndex !== null) imageIndex = choice.imageIndex;
  }

  if (Object.keys(errors).length) {
    throw new FairError(400, "invalid_variant", "Varianta aleasă nu este validă.", { fields: errors });
  }

  return {
    variantKey: buildConfigurationKey(selected, {}, {}),
    variantLabel: options.length ? options.map((o) => `${o.label}: ${o.valueLabel}`).join(" · ").slice(0, 200) : null,
    variantSnapshot: options.length ? { options } : null,
    selectedOptions: selected,
    imageIndex,
  };
}

/* ===================== Context vendor ===================== */

function deadlinePassed(fair, now) {
  return Boolean(fair?.inventoryDeadlineAt) && now >= new Date(fair.inventoryDeadlineAt);
}

function fairEnded(fair, now) {
  return Boolean(fair?.endsAt) && now > new Date(fair.endsAt);
}

async function loadContext(db, vendorId, now) {
  const fair = await ensureFair(db);
  const fullFair = await db.artfestFair.findUnique({
    where: { id: fair.id },
    select: { id: true, key: true, title: true, inventoryDeadlineAt: true, endsAt: true, startsAt: true },
  });
  const registration = await db.artfestFairRegistration.findUnique({
    where: { fairId_vendorId: { fairId: fair.id, vendorId } },
    select: { id: true, status: true, vendorId: true },
  });

  const approved = registration?.status === "APPROVED";
  // participare anulată: inventarul rămâne vizibil, doar pentru citire
  const cancelled = registration?.status === "CANCELLED";
  const locked = deadlinePassed(fullFair, now) || fairEnded(fullFair, now);

  return { fair: fullFair, registration, approved, cancelled, canEdit: approved && !locked, deadlinePassed: locked };
}

function requireEditable(ctx) {
  if (!ctx.registration || !ctx.approved) {
    throw new FairError(403, "registration_not_approved", "Inventarul este disponibil doar pentru înscrierile aprobate.");
  }
  if (!ctx.canEdit) {
    throw new FairError(409, "inventory_locked", "Termenul pentru inventarul târgului a trecut. Inventarul nu mai poate fi modificat.");
  }
}

async function vendorServiceMap(db, vendorId) {
  const services = await db.vendorService.findMany({
    where: { vendorId },
    select: { id: true, title: true, profile: { select: { displayName: true } } },
  });
  return new Map(services.map((s) => [s.id, s]));
}

const PRODUCT_SELECT = {
  id: true,
  serviceId: true,
  title: true,
  images: true,
  priceCents: true,
  currency: true,
  isActive: true,
  isHidden: true,
  moderationStatus: true,
  orderMode: true,
  availability: true,
  readyQty: true,
  optionsSchema: true,
  limitedEditionOf: true,
  limitedEditionNumber: true,
};

function isEligibleProduct(product, services) {
  return Boolean(
    product &&
      services.has(product.serviceId) &&
      product.isActive === true &&
      product.isHidden !== true &&
      product.moderationStatus === "APPROVED" &&
      Number(product.priceCents) > 0 &&
      product.orderMode !== "QUOTE_ONLY"
  );
}

async function loadOwnedProduct(db, vendorId, productId) {
  const services = await vendorServiceMap(db, vendorId);
  const product = await db.product.findUnique({ where: { id: String(productId || "") }, select: PRODUCT_SELECT });
  if (!product || !services.has(product.serviceId)) {
    throw new FairError(404, "product_not_found", "Produsul nu a fost găsit.");
  }
  if (!isEligibleProduct(product, services)) {
    throw new FairError(
      400,
      "product_not_eligible",
      "Produsul trebuie să fie activ, vizibil, aprobat, cu preț și să nu fie doar la cerere de ofertă."
    );
  }
  return { product, services };
}

/* ===================== Serializare ===================== */

function labelState(item) {
  if (!item.labelGeneratedAt || item.labelPriceCents == null) return "none";
  return item.labelPriceCents === item.priceSnapshotCents ? "valid" : "outdated";
}

function plural(n, one, many) {
  return n === 1 ? `1 ${one}` : `${n} ${many}`;
}

/*
 * Rezultatul recepției, așa cum îl vede vendorul (doar citire). Motivele
 * refuzului / deteriorării și fotografiile vin din jurnalul de stoc;
 * notițele interne ale Artfest NU sunt expuse.
 */
function receptionFor(item, movements = []) {
  if (item.status !== "RECEIVED" && item.status !== "REJECTED") return null;

  const pick = (type) =>
    movements
      .filter((m) => m.type === type)
      .map((m) => ({ quantity: m.quantity, reason: m.reason || null, photoUrls: m.photoUrls || [], at: m.createdAt }));

  const delta = item.receivedQty + item.rejectedQty - item.declaredQty;
  const messages = [
    `Ai declarat ${plural(item.declaredQty, "bucată", "bucăți")}. Artfest a recepționat ${item.receivedQty}.`,
  ];
  const rejections = pick("REJECTED");
  for (const r of rejections) {
    messages.push(`${plural(r.quantity, "produs a fost refuzat", "produse au fost refuzate")}: ${r.reason}.`);
  }
  const damages = pick("DAMAGED");
  for (const d of damages) {
    messages.push(`${plural(d.quantity, "produs a fost marcat deteriorat", "produse au fost marcate deteriorate")}: ${d.reason}.`);
  }
  if (delta < 0) messages.push(delta === -1 ? "Lipsește 1 bucată față de cantitatea declarată." : `Lipsesc ${-delta} bucăți față de cantitatea declarată.`);
  if (delta > 0) messages.push(delta === 1 ? "Ai trimis 1 bucată în plus față de cantitatea declarată." : `Ai trimis ${delta} bucăți în plus față de cantitatea declarată.`);

  return {
    declaredQty: item.declaredQty,
    receivedQty: item.receivedQty,
    rejectedQty: item.rejectedQty,
    damagedQty: item.damagedQty,
    difference: delta,
    receivedAt: item.receivedAt || null,
    rejections,
    damages,
    messages,
  };
}

/*
 * Situația fizică a liniei, pentru vendor (mai ales după anularea participării):
 *   CANCELLED          linia a fost anulată (nu a plecat sau a fost oprită);
 *   IN_TRANSIT         trimisă, încă nerecepționată de Artfest;
 *   RETURN_IN_PROGRESS există un retur expediat / predat, neconfirmat încă;
 *   AT_ARTFEST         bucăți încă la Artfest (în stoc, refuzate sau deteriorate, nereturnate);
 *   RETURNED           nimic nu mai e la Artfest, returul a fost confirmat.
 */
export function lineSituation(item, { openReturnQty = 0 } = {}) {
  if (item.status === "CANCELLED" || item.status === "DRAFT") return "CANCELLED";
  if (item.status === "SUBMITTED") return "IN_TRANSIT";
  if (openReturnQty > 0) return "RETURN_IN_PROGRESS";
  if (custodyQty(item) > 0) return "AT_ARTFEST";
  return "RETURNED";
}

// bucăți încă în custodia fizică Artfest: vandabile + refuzate + deteriorate, nereturnate
export function custodyQty(item) {
  return (
    (item.availableQty || 0) +
    Math.max(0, (item.rejectedQty || 0) - (item.rejectedReturnedQty || 0)) +
    Math.max(0, (item.damagedQty || 0) - (item.damagedReturnedQty || 0))
  );
}

// starea rezervării online: reserved / released / restored / none
export function onlineReservationState(item) {
  if (item.onlineReservationMode === "NONE") return "none";
  if (item.onlineRestoredAt || (item.onlineRestoredQty || 0) > 0) return "restored";
  if (item.onlineReleasedAt) return "released";
  return "reserved";
}

function serializeItem(item, product, ctx, movements = [], returnInfo = null) {
  const priceOutOfSync = Boolean(product) && product.priceCents !== item.priceSnapshotCents;
  const reservedOnline = Math.max(0, (item.onlineReservedQty || 0) - (item.onlineReleasedQty || 0));
  const tracked = product && product.readyQty !== null && product.readyQty !== undefined;
  const openReturnQty = returnInfo?.openQty || 0;

  return {
    id: item.id,
    productId: item.productId,
    variantKey: item.variantKey,
    variantLabel: item.variantLabel || null,
    title: item.titleSnapshot,
    storeName: item.storeNameSnapshot || null,
    imageUrl: item.imageUrlSnapshot || null,
    priceCents: item.priceSnapshotCents,
    currency: item.currency,
    currentPriceCents: product ? product.priceCents : null,
    priceOutOfSync,
    canSyncPrice: priceOutOfSync && ctx.canEdit && ["DRAFT", "SUBMITTED"].includes(item.status),
    barcode: item.barcode,
    barcodeDisplay: formatFairBarcode(item.barcode),
    declaredQty: item.declaredQty,
    receivedQty: item.receivedQty,
    soldQty: item.soldQty,
    status: item.status,
    isFragile: item.isFragile,
    isUnique: item.isUnique,
    isLimitedEdition: item.isLimitedEdition,
    canBeRemade: item.canBeRemade,
    handlingInstructions: item.handlingInstructions || null,
    vendorNotes: item.vendorNotes || null,
    submittedAt: item.submittedAt || null,
    label: {
      state: labelState(item),
      generatedAt: item.labelGeneratedAt || null,
      priceCents: item.labelPriceCents ?? null,
    },
    online: {
      mode: item.onlineReservationMode,
      state: onlineReservationState(item),
      reservedQty:
        item.onlineReservationMode === "TRANSFERRED" && onlineReservationState(item) === "reserved" ? reservedOnline : 0,
      releasedQty: item.onlineReleasedAt ? item.onlineReleasedQty || 0 : 0,
      restoredQty: item.onlineRestoredQty || 0,
      forcedUnavailable:
        item.onlineReservationMode === "FORCED_UNAVAILABLE" && !item.onlineReleasedAt && !item.onlineRestoredAt,
      onlineAvailableQty: tracked ? product.readyQty : null,
      productAvailability: product ? product.availability : null,
    },
    reception: receptionFor(item, movements),
    situation: lineSituation(item, { openReturnQty }),
    // cantitățile fizice, pentru vizualizarea după anulare / la retur
    physical: {
      availableQty: item.availableQty || 0,
      rejectedPendingReturnQty: Math.max(0, (item.rejectedQty || 0) - (item.rejectedReturnedQty || 0)),
      damagedPendingReturnQty: Math.max(0, (item.damagedQty || 0) - (item.damagedReturnedQty || 0)),
      damagedReturnedQty: item.damagedReturnedQty || 0,
      returnInProgressQty: openReturnQty,
      returnedQty: (item.returnedQty || 0) + (item.rejectedReturnedQty || 0) + (item.damagedReturnedQty || 0) - openReturnQty,
      vendorConfirmedQty: item.vendorReturnReceivedQty ?? null,
    },
    actions: {
      canEdit: ctx.canEdit && item.status === "DRAFT",
      canRemove: ctx.canEdit && item.status === "DRAFT",
      // trimisă dar nerecepționată: anularea eliberează rezervarea online
      canCancel: ctx.canEdit && item.status === "SUBMITTED",
      // participare anulată: fără etichete (inventarul e doar pentru citire)
      canPrintLabel: ctx.approved !== false && LABEL_INVENTORY_STATUSES.includes(item.status),
    },
  };
}

// contextul vendorului (înscriere, termen) - folosit și de anularea liniilor trimise
export async function getVendorInventoryContext({ vendorId, db = prisma, now = new Date() }) {
  return loadContext(db, vendorId, now);
}

async function itemsWithProducts(db, items) {
  const productIds = [...new Set(items.map((i) => i.productId).filter(Boolean))];
  const products = productIds.length
    ? await db.product.findMany({
        where: { id: { in: productIds } },
        select: { id: true, priceCents: true, readyQty: true, availability: true },
      })
    : [];
  return new Map(products.map((p) => [p.id, p]));
}

/* ===================== Listare ===================== */

// bucăți în retururi expediate / predate și încă neconfirmate de vendor, per linie
export async function openReturnQtyByItem(db, itemIds) {
  const map = new Map();
  if (!itemIds.length) return map;
  const lines = await db.artfestFairReturnLine.findMany({ where: { inventoryItemId: { in: itemIds } } });
  if (!lines.length) return map;
  const returns = await db.artfestFairReturn.findMany({
    where: { id: { in: [...new Set(lines.map((l) => l.returnId))] }, status: "SHIPPED" },
    select: { id: true },
  });
  const shipped = new Set(returns.map((r) => r.id));
  for (const line of lines) {
    if (!shipped.has(line.returnId)) continue;
    map.set(line.inventoryItemId, (map.get(line.inventoryItemId) || 0) + line.qtyFromStock + line.qtyRejected + (line.qtyDamaged || 0));
  }
  return map;
}

export async function listInventory({ vendorId, db = prisma, now = new Date() }) {
  const ctx = await loadContext(db, vendorId, now);

  const base = {
    fair: {
      key: ctx.fair.key,
      title: ctx.fair.title,
      inventoryDeadlineAt: ctx.fair.inventoryDeadlineAt || null,
      endsAt: ctx.fair.endsAt || null,
    },
    registrationStatus: ctx.registration?.status || null,
    approved: ctx.approved,
    cancelled: ctx.cancelled,
    // participare anulată => doar citire
    readOnly: !ctx.approved,
    canEdit: ctx.canEdit,
    deadlinePassed: ctx.deadlinePassed,
  };

  if (!ctx.registration || (!ctx.approved && !ctx.cancelled)) return { ...base, items: [], summary: null };

  const items = await db.artfestFairInventoryItem.findMany({
    // după anulare se văd și liniile anulate (cu situația lor)
    where: ctx.cancelled
      ? { registrationId: ctx.registration.id, vendorId }
      : { registrationId: ctx.registration.id, vendorId, status: { not: "CANCELLED" } },
    orderBy: { createdAt: "asc" },
  });
  const products = await itemsWithProducts(db, items);
  const receivedIds = items.filter((i) => ["RECEIVED", "REJECTED", "CLOSED"].includes(i.status)).map((i) => i.id);
  const movements = receivedIds.length
    ? await db.artfestFairStockMovement.findMany({
        where: { inventoryItemId: { in: receivedIds }, type: { in: ["REJECTED", "DAMAGED"] } },
        orderBy: { createdAt: "asc" },
        select: { inventoryItemId: true, type: true, quantity: true, reason: true, photoUrls: true, createdAt: true },
      })
    : [];
  const returnInfo = await openReturnQtyByItem(db, receivedIds);
  const serialized = items.map((item) =>
    serializeItem(
      item,
      products.get(item.productId),
      ctx,
      movements.filter((m) => m.inventoryItemId === item.id),
      { openQty: returnInfo.get(item.id) || 0 }
    )
  );

  return {
    ...base,
    items: serialized,
    summary: {
      lines: serialized.length,
      draftLines: serialized.filter((i) => i.status === "DRAFT").length,
      declaredUnits: serialized.reduce((sum, i) => sum + i.declaredQty, 0),
      outdatedLabels: serialized.filter((i) => i.label.state === "outdated").length,
      priceOutOfSync: serialized.filter((i) => i.priceOutOfSync).length,
    },
  };
}

export async function listEligibleProducts({ vendorId, db = prisma }) {
  const services = await vendorServiceMap(db, vendorId);
  if (!services.size) return [];

  const products = await db.product.findMany({
    where: {
      serviceId: { in: [...services.keys()] },
      isActive: true,
      isHidden: false,
      moderationStatus: "APPROVED",
      priceCents: { gt: 0 },
      orderMode: { not: "QUOTE_ONLY" },
    },
    orderBy: { title: "asc" },
    select: PRODUCT_SELECT,
  });

  return products.map((product) => ({
    id: product.id,
    title: product.title,
    imageUrl: Array.isArray(product.images) ? product.images[0] || null : null,
    priceCents: product.priceCents,
    currency: product.currency || "RON",
    availability: product.availability,
    readyQty: product.readyQty,
    isLimitedEdition: product.limitedEditionOf != null || product.limitedEditionNumber != null,
    options: inventoryOptionFields(product).map((f) => ({
      key: f.key,
      label: f.label,
      required: f.required,
      choices: f.choices.map((c) => ({ value: c.value, label: c.label })),
    })),
  }));
}

/* ===================== Câmpurile editabile de vendor ===================== */

function cleanOptionalText(value, field) {
  if (value === undefined) return undefined;
  const text = String(value ?? "").trim();
  if (text.length > TEXT_LIMIT) {
    throw new FairError(400, "invalid_inventory_item", "Verifică datele liniei.", {
      fields: { [field]: `Maximum ${TEXT_LIMIT} de caractere.` },
    });
  }
  return text || null;
}

/*
 * Doar câmpurile pe care vendorul le poate seta. Orice alt câmp din body
 * (barcode, preț, cantități recepționate, status, rezervare) e ignorat.
 */
function pickVendorFields(body = {}, { partial = false } = {}) {
  const out = {};
  const fields = {};

  if (!partial || body.declaredQty !== undefined) {
    const qty = Number(body.declaredQty);
    if (!Number.isInteger(qty) || qty < 1 || qty > MAX_DECLARED_QTY) {
      fields.declaredQty = `Cantitatea trebuie să fie un număr întreg între 1 și ${MAX_DECLARED_QTY}.`;
    } else {
      out.declaredQty = qty;
    }
  }

  for (const flag of ["isFragile", "isUnique", "isLimitedEdition", "canBeRemade"]) {
    if (body[flag] !== undefined) out[flag] = body[flag] === true;
  }

  const handling = cleanOptionalText(body.handlingInstructions, "handlingInstructions");
  if (handling !== undefined) out.handlingInstructions = handling;
  const notes = cleanOptionalText(body.vendorNotes, "vendorNotes");
  if (notes !== undefined) out.vendorNotes = notes;

  if (Object.keys(fields).length) {
    throw new FairError(400, "invalid_inventory_item", "Verifică datele liniei.", { fields });
  }
  return out;
}

function assertUniqueRules(next) {
  if (next.isUnique && next.declaredQty !== 1) {
    throw new FairError(400, "invalid_inventory_item", "Un produs unicat are cantitatea 1.", {
      fields: { declaredQty: "Un produs unicat are cantitatea 1." },
    });
  }
  if (next.isUnique && next.canBeRemade) {
    throw new FairError(400, "invalid_inventory_item", "Un produs unicat nu poate fi marcat ca refăcibil.", {
      fields: { canBeRemade: "Un produs unicat nu poate fi marcat ca refăcibil." },
    });
  }
}

// unicatul ocupă singur produsul în inventarul vendorului
async function assertNoUniqueConflict(db, registrationId, productId, isUnique, excludeId = null) {
  const others = await db.artfestFairInventoryItem.findMany({
    where: {
      registrationId,
      productId,
      status: { not: "CANCELLED" },
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: { id: true, isUnique: true },
  });
  if (others.length && (isUnique || others.some((o) => o.isUnique))) {
    throw new FairError(
      409,
      "unique_product_conflict",
      "Un produs unicat poate apărea o singură dată în inventar, fără alte variante."
    );
  }
}

async function writeEvent(db, item, type, { before = null, after = null, note = null, actorUserId = null } = {}) {
  await db.artfestFairInventoryEvent.create({
    data: {
      inventoryItemId: item.id,
      fairId: item.fairId,
      vendorId: item.vendorId,
      type,
      before,
      after,
      note,
      actorUserId,
    },
  });
}

function storeNameFor(product, services) {
  const service = services.get(product.serviceId);
  return (service?.profile?.displayName || service?.title || "").slice(0, 160) || null;
}

function imageFor(product, imageIndex) {
  const images = Array.isArray(product.images) ? product.images : [];
  if (imageIndex !== null && images[imageIndex]) return images[imageIndex];
  return images[0] || null;
}

async function findOwnedItem(db, vendorId, id) {
  const item = await db.artfestFairInventoryItem.findUnique({ where: { id: String(id || "") } });
  // altă linie decât a vendorului => 404 (nu dezvăluim că există)
  if (!item || item.vendorId !== vendorId) {
    throw new FairError(404, "inventory_item_not_found", "Linia de inventar nu a fost găsită.");
  }
  return item;
}

/* ===================== Adăugare ===================== */

export async function addInventoryItem({ vendorId, userId, body = {}, db = prisma, now = new Date(), randomInt }) {
  const ctx = await loadContext(db, vendorId, now);
  requireEditable(ctx);

  const { product, services } = await loadOwnedProduct(db, vendorId, body.productId);
  const variant = resolveVariant(product, body.selectedOptions);
  const fields = pickVendorFields(body);

  const next = {
    isFragile: false,
    isUnique: false,
    canBeRemade: false,
    isLimitedEdition: product.limitedEditionOf != null || product.limitedEditionNumber != null,
    ...fields,
  };
  assertUniqueRules(next);

  const snapshot = {
    variantKey: variant.variantKey,
    variantLabel: variant.variantLabel,
    variantSnapshot: variant.variantSnapshot,
    titleSnapshot: String(product.title || "").slice(0, 200),
    storeNameSnapshot: storeNameFor(product, services),
    imageUrlSnapshot: imageFor(product, variant.imageIndex),
    priceSnapshotCents: product.priceCents,
    currency: product.currency || "RON",
    priceSyncedAt: now,
  };

  const existing = await db.artfestFairInventoryItem.findUnique({
    where: {
      registrationId_productId_variantKey: {
        registrationId: ctx.registration.id,
        productId: product.id,
        variantKey: variant.variantKey,
      },
    },
  });

  if (existing && existing.status !== "CANCELLED") {
    throw new FairError(409, "duplicate_variant", "Această variantă este deja în inventar. Modifică linia existentă.");
  }

  await assertNoUniqueConflict(db, ctx.registration.id, product.id, next.isUnique, existing?.id || null);

  // linie anulată anterior pentru aceeași variantă => o reactivăm (codul de bare rămâne)
  if (existing) {
    const reactivated = await db.artfestFairInventoryItem.update({
      where: { id: existing.id },
      data: {
        ...snapshot,
        ...next,
        status: "DRAFT",
        cancelledAt: null,
        submittedAt: null,
        handlingInstructions: next.handlingInstructions ?? null,
        vendorNotes: next.vendorNotes ?? null,
        // rezervarea online anterioară a fost eliberată la anulare; linia pornește curat
        onlineReservationMode: "NONE",
        onlineReservedAt: null,
        onlineReservedQty: 0,
        onlineReleasedQty: 0,
        onlineReleasedAt: null,
        onlinePrevAvailability: null,
        onlinePrevReadyQty: null,
        onlineDeferredRestoreQty: 0,
      },
    });
    await writeEvent(db, reactivated, "CREATED", { after: { declaredQty: reactivated.declaredQty }, note: "reactivated", actorUserId: userId });
    const products = await itemsWithProducts(db, [reactivated]);
    return serializeItem(reactivated, products.get(reactivated.productId), ctx);
  }

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const barcode = generateFairBarcode(randomInt);
    try {
      const created = await db.artfestFairInventoryItem.create({
        data: {
          fairId: ctx.fair.id,
          registrationId: ctx.registration.id,
          vendorId,
          productId: product.id,
          barcode,
          status: "DRAFT",
          ...snapshot,
          ...next,
        },
      });
      await writeEvent(db, created, "CREATED", {
        after: { declaredQty: created.declaredQty, variantKey: created.variantKey, barcode },
        actorUserId: userId,
      });
      const products = await itemsWithProducts(db, [created]);
      return serializeItem(created, products.get(created.productId), ctx);
    } catch (error) {
      if (error?.code !== "P2002") throw error;
      // coliziune de cod de bare => cod nou; altfel e varianta dublată
      const clash = await db.artfestFairInventoryItem.findUnique({ where: { barcode }, select: { id: true } });
      if (!clash) {
        throw new FairError(409, "duplicate_variant", "Această variantă este deja în inventar. Modifică linia existentă.");
      }
    }
  }

  throw new FairError(500, "barcode_generation_failed", "Nu am putut genera un cod unic. Încearcă din nou.");
}

/* ===================== Editare / eliminare (DRAFT) ===================== */

export async function updateInventoryItem({ vendorId, userId, id, body = {}, db = prisma, now = new Date() }) {
  const ctx = await loadContext(db, vendorId, now);
  requireEditable(ctx);

  const item = await findOwnedItem(db, vendorId, id);
  if (item.status !== "DRAFT") {
    throw new FairError(409, "inventory_item_not_editable", "Doar liniile încă netrimise pot fi modificate.");
  }

  const fields = pickVendorFields(body, { partial: true });
  const next = {
    declaredQty: item.declaredQty,
    isFragile: item.isFragile,
    isUnique: item.isUnique,
    isLimitedEdition: item.isLimitedEdition,
    canBeRemade: item.canBeRemade,
    ...fields,
  };
  assertUniqueRules(next);
  if (next.isUnique !== item.isUnique) {
    await assertNoUniqueConflict(db, item.registrationId, item.productId, next.isUnique, item.id);
  }

  const updated = await db.artfestFairInventoryItem.update({ where: { id: item.id }, data: fields });
  const before = Object.fromEntries(Object.keys(fields).map((k) => [k, item[k] ?? null]));
  await writeEvent(db, updated, "UPDATED", { before, after: fields, actorUserId: userId });

  const products = await itemsWithProducts(db, [updated]);
  return serializeItem(updated, products.get(updated.productId), ctx);
}

export async function removeInventoryItem({ vendorId, userId, id, db = prisma, now = new Date() }) {
  const ctx = await loadContext(db, vendorId, now);
  requireEditable(ctx);

  const item = await findOwnedItem(db, vendorId, id);
  if (item.status !== "DRAFT") {
    throw new FairError(409, "inventory_item_not_editable", "Doar liniile încă netrimise pot fi eliminate.");
  }

  // păstrăm linia (istoric + codul de bare) ca CANCELLED; nu are rezervare online
  const res = await db.artfestFairInventoryItem.updateMany({
    where: { id: item.id, status: "DRAFT" },
    data: { status: "CANCELLED", cancelledAt: now },
  });
  if (res.count !== 1) {
    throw new FairError(409, "inventory_item_not_editable", "Doar liniile încă netrimise pot fi eliminate.");
  }
  await writeEvent(db, item, "CANCELLED", { before: { status: "DRAFT" }, after: { status: "CANCELLED" }, actorUserId: userId });
  return { ok: true };
}

/* ===================== Preț ===================== */

export async function syncInventoryItemPrice({ vendorId, userId, id, db = prisma, now = new Date() }) {
  const ctx = await loadContext(db, vendorId, now);
  if (!ctx.approved) {
    throw new FairError(403, "registration_not_approved", "Inventarul este disponibil doar pentru înscrierile aprobate.");
  }
  if (!ctx.canEdit) {
    throw new FairError(409, "price_locked", "După termenul de predare prețul de la târg este blocat.");
  }

  const item = await findOwnedItem(db, vendorId, id);
  if (!["DRAFT", "SUBMITTED"].includes(item.status)) {
    throw new FairError(409, "inventory_item_not_editable", "Prețul acestei linii nu mai poate fi sincronizat.");
  }

  const product = item.productId
    ? await db.product.findUnique({ where: { id: item.productId }, select: { id: true, priceCents: true } })
    : null;
  if (!product || !(product.priceCents > 0)) {
    throw new FairError(409, "product_unavailable", "Produsul asociat nu mai este disponibil.");
  }

  let updated = item;
  if (product.priceCents !== item.priceSnapshotCents) {
    updated = await db.artfestFairInventoryItem.update({
      where: { id: item.id },
      data: { priceSnapshotCents: product.priceCents, priceSyncedAt: now },
    });
    await writeEvent(db, updated, "PRICE_SYNCED", {
      before: { priceSnapshotCents: item.priceSnapshotCents },
      after: { priceSnapshotCents: product.priceCents },
      actorUserId: userId,
    });
  }

  const products = await itemsWithProducts(db, [updated]);
  return serializeItem(updated, products.get(updated.productId), ctx);
}

/* ===================== Trimitere + rezervare online ===================== */

export async function submitInventory({ vendorId, userId, db = prisma, now = new Date() }) {
  const ctx = await loadContext(db, vendorId, now);
  requireEditable(ctx);

  const registrationId = ctx.registration.id;
  const services = await vendorServiceMap(db, vendorId);

  const submittedIds = await db.$transaction(async (tx) => {
    // două trimiteri simultane ale aceluiași vendor se serializează; anularea participării ia același lock
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`artfest-fair-submit:${registrationId}`}))`;

    // statusul se reverifică sub lock: o anulare concurentă nu poate fi urmată de rezervări noi
    const current = await tx.artfestFairRegistration.findUnique({ where: { id: registrationId }, select: { status: true } });
    if (current?.status !== "APPROVED") {
      throw new FairError(403, "registration_not_approved", "Inventarul este disponibil doar pentru înscrierile aprobate.");
    }

    const lines = await tx.artfestFairInventoryItem.findMany({
      where: { registrationId, vendorId, status: "DRAFT" },
      orderBy: { createdAt: "asc" },
    });
    if (!lines.length) {
      throw new FairError(409, "nothing_to_submit", "Nu ai linii noi de trimis în inventar.");
    }

    const productIds = [...new Set(lines.map((l) => l.productId).filter(Boolean))].sort();
    for (const productId of productIds) await lockProductForFair(tx, productId);

    const products = await tx.product.findMany({ where: { id: { in: productIds } }, select: PRODUCT_SELECT });
    const productById = new Map(products.map((p) => [p.id, p]));

    // validare completă înainte de orice scriere
    const problems = [];
    for (const line of lines) {
      const product = productById.get(line.productId);
      if (!isEligibleProduct(product, services)) {
        problems.push({ id: line.id, title: line.titleSnapshot, reason: "product_not_eligible" });
        continue;
      }
      try {
        const variant = resolveVariant(product, Object.fromEntries((line.variantSnapshot?.options || []).map((o) => [o.key, o.value])));
        if (variant.variantKey !== line.variantKey) throw new Error("variant_changed");
      } catch {
        problems.push({ id: line.id, title: line.titleSnapshot, reason: "variant_invalid" });
      }
      try {
        assertUniqueRules(line);
      } catch {
        problems.push({ id: line.id, title: line.titleSnapshot, reason: "unique_rules" });
      }
    }
    if (problems.length) {
      throw new FairError(
        409,
        "inventory_invalid",
        "Unele produse nu mai pot fi trimise (produs indisponibil sau variantă schimbată). Elimină-le sau corectează-le.",
        { problems }
      );
    }

    // revendicăm liniile (o a doua trimitere nu le mai găsește în DRAFT)
    const lineIds = lines.map((l) => l.id);
    const claimed = await tx.artfestFairInventoryItem.updateMany({
      where: { id: { in: lineIds }, status: "DRAFT" },
      data: { status: "SUBMITTED", submittedAt: now },
    });
    if (claimed.count !== lineIds.length) {
      throw new FairError(409, "inventory_conflict", "Inventarul a fost modificat între timp. Reîncarcă pagina.");
    }

    for (const productId of productIds) {
      const product = productById.get(productId);
      const productLines = lines.filter((l) => l.productId === productId);

      // prețul trimis = prețul curent din Artfest (eticheta veche devine invalidă)
      for (const line of productLines) {
        if (line.priceSnapshotCents !== product.priceCents) {
          await tx.artfestFairInventoryItem.update({
            where: { id: line.id },
            data: { priceSnapshotCents: product.priceCents, priceSyncedAt: now },
          });
          await writeEvent(tx, line, "PRICE_SYNCED", {
            before: { priceSnapshotCents: line.priceSnapshotCents },
            after: { priceSnapshotCents: product.priceCents },
            actorUserId: userId,
          });
        }
      }

      const isUnique = productLines.some((l) => l.isUnique);

      if (isUnique) {
        // B. unicat: indisponibil online cât timp e la târg; starea anterioară salvată
        const prevAvailability = product.availability;
        const prevReadyQty = product.readyQty;
        const res = await tx.product.updateMany({
          where: { id: productId, availability: prevAvailability, readyQty: prevReadyQty },
          data: { availability: "SOLD_OUT", readyQty: prevReadyQty === null ? null : 0 },
        });
        if (res.count !== 1) {
          throw new FairError(409, "product_changed", `Produsul „${product.title}” a fost modificat între timp. Încearcă din nou.`);
        }
        for (const line of productLines) {
          await tx.artfestFairInventoryItem.update({
            where: { id: line.id },
            data: {
              onlineReservationMode: "FORCED_UNAVAILABLE",
              onlineReservedAt: now,
              onlineReservedQty: 0,
              onlinePrevAvailability: prevAvailability,
              onlinePrevReadyQty: prevReadyQty,
            },
          });
          await writeEvent(tx, line, "ONLINE_STOCK_RESERVED", {
            before: { availability: prevAvailability, readyQty: prevReadyQty },
            after: { availability: "SOLD_OUT", readyQty: prevReadyQty === null ? null : 0, mode: "FORCED_UNAVAILABLE" },
            actorUserId: userId,
          });
        }
      } else if (product.availability === "READY" && product.readyQty !== null && product.readyQty !== undefined) {
        // A. stoc urmărit: transfer atomic din stocul online (aceeași gardă ca checkout-ul)
        const total = productLines.reduce((sum, l) => sum + l.declaredQty, 0);
        const nextQty = product.readyQty - total;
        const res = await tx.product.updateMany({
          where: { id: productId, availability: "READY", readyQty: { gte: total } },
          data: { readyQty: { decrement: total }, availability: nextQty <= 0 ? "SOLD_OUT" : "READY" },
        });
        if (res.count !== 1) {
          throw new FairError(
            409,
            "insufficient_online_stock",
            `Pentru „${product.title}” ai ${Math.max(0, product.readyQty)} bucăți în stocul online și ai declarat ${total} pentru târg. Mărește stocul produsului sau scade cantitatea.`,
            { productId, available: product.readyQty, requested: total }
          );
        }
        for (const line of productLines) {
          await tx.artfestFairInventoryItem.update({
            where: { id: line.id },
            data: { onlineReservationMode: "TRANSFERRED", onlineReservedAt: now, onlineReservedQty: line.declaredQty },
          });
          await writeEvent(tx, line, "ONLINE_STOCK_RESERVED", {
            before: { readyQty: product.readyQty, availability: "READY" },
            after: { readyQty: nextQty, availability: nextQty <= 0 ? "SOLD_OUT" : "READY", mode: "TRANSFERRED", reservedQty: line.declaredQty },
            actorUserId: userId,
          });
        }
      }
      // C. la comandă / precomandă / stoc neurmărit / epuizat, neunicat: fără rezervare online

      for (const line of productLines) {
        await writeEvent(tx, line, "SUBMITTED", { before: { status: "DRAFT" }, after: { status: "SUBMITTED" }, actorUserId: userId });
      }
    }

    return lineIds;
  }, FAIR_TX_OPTIONS);

  return { submitted: submittedIds.length, ...(await listInventory({ vendorId, db, now })) };
}

/* ===================== Etichete ===================== */

function assertLabelPriceFresh(ctx, items, productById) {
  if (ctx.deadlinePassed) return; // după termen prețul e blocat => snapshot-ul e prețul de târg
  const stale = items.filter((item) => {
    const product = productById.get(item.productId);
    return product && product.priceCents !== item.priceSnapshotCents;
  });
  if (stale.length) {
    throw new FairError(409, "price_out_of_sync", "Prețul s-a schimbat pe Artfest. Sincronizează prețul înainte de a genera eticheta.", {
      problems: stale.map((s) => ({ id: s.id, title: s.titleSnapshot })),
    });
  }
}

export async function getLabelItems({ vendorId, id = null, db = prisma, now = new Date() }) {
  const ctx = await loadContext(db, vendorId, now);
  if (!ctx.registration || !ctx.approved) {
    throw new FairError(403, "registration_not_approved", "Inventarul este disponibil doar pentru înscrierile aprobate.");
  }

  let items;
  if (id) {
    const item = await findOwnedItem(db, vendorId, id);
    if (item.registrationId !== ctx.registration.id || !LABEL_INVENTORY_STATUSES.includes(item.status)) {
      throw new FairError(404, "inventory_item_not_found", "Linia de inventar nu a fost găsită.");
    }
    items = [item];
  } else {
    items = await db.artfestFairInventoryItem.findMany({
      where: { registrationId: ctx.registration.id, vendorId, status: { in: [...LABEL_INVENTORY_STATUSES] } },
      orderBy: { createdAt: "asc" },
    });
    if (!items.length) throw new FairError(404, "no_inventory_items", "Nu ai produse în inventar.");
  }

  assertLabelPriceFresh(ctx, items, await itemsWithProducts(db, items));
  return items;
}

/*
 * Etichetele generate din Admin: aceleași linii / același generator / aceeași
 * regulă de preț ca la vendor, dar doar pentru liniile valide din inventarul
 * târgului activ (trimise sau recepționate, înscriere APPROVED).
 *   id        -> o linie;  vendorId -> toate liniile vendorului;  altfel -> tot târgul.
 */
const ADMIN_LABEL_STATUSES = ["SUBMITTED", "RECEIVED"];

export async function getAdminLabelItems({ id = null, vendorId = null, db = prisma, now = new Date() } = {}) {
  const base = await ensureFair(db);
  const fair = await db.artfestFair.findUnique({
    where: { id: base.id },
    select: { id: true, inventoryDeadlineAt: true, endsAt: true },
  });

  let items;
  if (id) {
    const item = await db.artfestFairInventoryItem.findUnique({ where: { id: String(id) } });
    if (!item || item.fairId !== fair.id || !ADMIN_LABEL_STATUSES.includes(item.status)) {
      throw new FairError(404, "inventory_item_not_found", "Linia nu este în inventarul valid al târgului activ.");
    }
    items = [item];
  } else {
    items = await db.artfestFairInventoryItem.findMany({
      where: { fairId: fair.id, status: { in: ADMIN_LABEL_STATUSES }, ...(vendorId ? { vendorId: String(vendorId) } : {}) },
      orderBy: [{ vendorId: "asc" }, { createdAt: "asc" }],
    });
  }

  // doar participări aprobate (o participare anulată nu mai primește etichete de vânzare)
  const registrationIds = [...new Set(items.map((i) => i.registrationId))];
  const approved = new Set(
    (registrationIds.length
      ? await db.artfestFairRegistration.findMany({ where: { id: { in: registrationIds }, status: "APPROVED" }, select: { id: true } })
      : []
    ).map((r) => r.id)
  );
  items = items.filter((i) => approved.has(i.registrationId));
  if (!items.length) {
    throw new FairError(id ? 409 : 404, id ? "registration_not_approved" : "no_inventory_items", id
      ? "Participarea vendorului nu este aprobată. Eticheta nu se poate genera."
      : "Nu există linii valide pentru etichete.");
  }

  // aceeași regulă ca la vendor: înainte de termen, prețul trebuie sincronizat
  const locked = deadlinePassed(fair, now) || fairEnded(fair, now);
  assertLabelPriceFresh({ deadlinePassed: locked }, items, await itemsWithProducts(db, items));
  return items;
}

export async function markLabelsGenerated({ items, userId, db = prisma, now = new Date() }) {
  for (const item of items) {
    await db.artfestFairInventoryItem.update({
      where: { id: item.id },
      data: { labelPriceCents: item.priceSnapshotCents, labelGeneratedAt: now },
    });
    await writeEvent(db, item, "LABEL_GENERATED", {
      after: { labelPriceCents: item.priceSnapshotCents, copies: item.declaredQty },
      actorUserId: userId,
    });
  }
}

/* ===================== Restricții pentru alte fluxuri ===================== */

// retragerea înscrierii: blocată după ce există inventar trimis / recepționat
export async function hasActiveInventory({ registrationId, db = prisma }) {
  const count = await db.artfestFairInventoryItem.count({
    where: { registrationId, status: { in: [...ACTIVE_INVENTORY_STATUSES] } },
  });
  return count > 0;
}
