// src/services/artfestFairPosProductsService.js
//
// POS -> „Adaugă produs” (doar Admin): produse manuale ale târgului (pungi de cadou,
// ambalaje etc.), cu stocul primit fizic introdus direct.
//  - proprietar: Artfest - stoc propriu (vendorId / registrationId NULL) SAU un magazin al
//    unui participant APPROVED (vendorId + registrationId + serviceId = magazinul ales);
//  - EXCEPȚIE DOAR PENTRU ADMIN: se poate adăuga / suplimenta și după termenul pentru inventar.
//    Rutele și regulile vânzătorilor (addManualInventoryItem etc.) rămân neschimbate;
//  - „Stoc primit fizic”: confirmare explicită obligatorie; linia intră direct ca RECEIVED,
//    cu mecanismul existent al recepției: mișcare de stoc RECEIVED (cine, când, cheie de
//    idempotență), receivedAt / receivedById, evenimente CREATED + STATUS_CHANGED;
//  - nu creează / nu modifică niciun produs online și nu înregistrează vânzări;
//  - banii la vânzare (POS): Artfest = integral Artfest; participant = 10% Artfest / 90% vânzător.

import { prisma } from "../db.js";
import { FAIR_TX_OPTIONS, MAX_DECLARED_QTY } from "../config/artfestFair.js";
import { FairError, ensureFair } from "./artfestFairService.js";
import { formatFairBarcode, generateFairBarcode } from "./artfestFairInventoryService.js";
import { getAdminInventoryLine, lockLine, requireIdempotencyKey, writeEvent } from "./artfestFairReceptionService.js";
import { listPromoParticipants } from "./artfestFairPromoLabelsService.js";
import {
  cleanManualTitle,
  isManualFairItem,
  isValidClientRequestId,
  manualVariantKey,
  parsePriceRonToCents,
  MANUAL_TITLE_MAX,
} from "../lib/artfestFairManualItem.js";
import { ARTFEST_OWNER_NAME, isArtfestOwned } from "../lib/artfestFairOwner.js";

export const POS_PRODUCT_OWNERS = Object.freeze(["ARTFEST", "PARTICIPANT"]);
const ARTFEST_KEY_SCOPE = "artfest-own-stock";

function lineView(line) {
  return {
    id: line.id,
    title: line.titleSnapshot,
    barcodeDisplay: formatFairBarcode(line.barcode),
    status: line.status,
    serviceId: line.serviceId || null,
  };
}

/**
 * Proprietarii posibili: Artfest (stoc propriu) + participanții APPROVED cu magazinele lor;
 * fiecare cu produsele existente (pentru avertismentul de denumire dublată).
 */
export async function listPosProductOwners({ db = prisma } = {}) {
  const fair = await ensureFair(db);
  const [participants, artfestLines] = await Promise.all([
    listPromoParticipants({ db }),
    db.artfestFairInventoryItem.findMany({
      where: { fairId: fair.id, vendorId: null, status: { notIn: ["DRAFT", "CANCELLED"] } },
      orderBy: { createdAt: "asc" },
    }),
  ]);
  return {
    artfest: { name: ARTFEST_OWNER_NAME, lines: artfestLines.map(lineView) },
    participants: participants.items.map((p) => ({
      registrationId: p.registrationId,
      vendorId: p.vendorId,
      vendorName: p.vendorName,
      stores: p.stores.map((s) => ({ serviceId: s.serviceId, name: s.name })),
      lines: p.lines,
    })),
    maxQty: MAX_DECLARED_QTY,
  };
}

function parseReceivedQty(value) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= MAX_DECLARED_QTY ? n : null;
}

function requireReceiptConfirmation(body) {
  if (body?.confirmReceived !== true) {
    throw new FairError(400, "receipt_confirmation_required", "Confirmă că ai primit fizic bucățile înainte de salvare.", {
      fields: { confirmReceived: "Bifează confirmarea stocului primit fizic." },
    });
  }
}

// proprietarul ales: Artfest sau un magazin al unui participant APPROVED la târgul activ
async function resolveOwner(db, fair, body) {
  const owner = String(body?.owner || "").toUpperCase();
  if (!POS_PRODUCT_OWNERS.includes(owner)) {
    throw new FairError(400, "invalid_owner", "Alege proprietarul: Artfest sau un participant.", { fields: { owner: "Alege proprietarul." } });
  }
  if (owner === "ARTFEST") {
    return { artfest: true, registrationId: null, vendorId: null, serviceId: null, storeName: ARTFEST_OWNER_NAME };
  }
  const registrationId = String(body.registrationId || "").trim();
  const registration = registrationId
    ? await db.artfestFairRegistration.findUnique({ where: { id: registrationId }, select: { id: true, fairId: true, vendorId: true, status: true } })
    : null;
  if (!registration || registration.fairId !== fair.id || registration.status !== "APPROVED") {
    throw new FairError(409, "participant_not_eligible", "Participantul ales nu este aprobat la târgul activ.", {
      fields: { owner: "Alege un participant aprobat." },
    });
  }
  const stores = await db.vendorService.findMany({
    where: { vendorId: registration.vendorId, type: { is: { code: "products" } } },
    select: { id: true, title: true, profile: { select: { displayName: true } } },
  });
  const serviceId = String(body.serviceId || "").trim();
  if (!stores.length) {
    // participant fără magazin de produse: produsul e al vânzătorului, fără magazin
    if (serviceId) throw new FairError(409, "store_not_found", "Magazinul ales nu aparține participantului.", { fields: { serviceId: "Alege magazinul." } });
    return { artfest: false, registrationId: registration.id, vendorId: registration.vendorId, serviceId: null, storeName: null };
  }
  const store = stores.find((s) => s.id === serviceId);
  if (!store) {
    throw new FairError(serviceId ? 409 : 400, serviceId ? "store_not_found" : "store_required", "Alege magazinul participantului.", {
      fields: { serviceId: "Alege magazinul." },
    });
  }
  const name = String(store.profile?.displayName || store.title || "").trim().slice(0, 160) || null;
  return { artfest: false, registrationId: registration.id, vendorId: registration.vendorId, serviceId: store.id, storeName: name };
}

/*
 * Produs nou, cu stocul primit fizic. Idempotent pe clientRequestId (dublu click /
 * reîncercare => aceeași linie, duplicate: true). Fără limita termenului de inventar (Admin).
 */
export async function createPosProduct({ body = {}, adminId, db = prisma, now = new Date(), randomInt }) {
  if (!isValidClientRequestId(body.clientRequestId)) {
    throw new FairError(400, "invalid_client_request_id", "Reîncarcă formularul și încearcă din nou.");
  }
  const fields = {};
  const title = cleanManualTitle(body.title);
  if (!title) fields.title = `Scrie denumirea produsului (maximum ${MANUAL_TITLE_MAX} de caractere).`;
  const priceCents = parsePriceRonToCents(body.priceRon);
  if (priceCents === null) fields.priceRon = "Introdu un preț mai mare decât zero (ex. 5 sau 4,50).";
  const qty = parseReceivedQty(body.receivedQty);
  if (qty === null) fields.receivedQty = `Stocul primit fizic trebuie să fie un număr întreg între 1 și ${MAX_DECLARED_QTY}.`;
  if (Object.keys(fields).length) throw new FairError(400, "invalid_inventory_item", "Verifică datele produsului.", { fields });
  requireReceiptConfirmation(body);

  const fair = await ensureFair(db);
  const owner = await resolveOwner(db, fair, body);
  const variantKey = manualVariantKey(owner.registrationId || ARTFEST_KEY_SCOPE, body.clientRequestId);

  const result = await db.$transaction(async (tx) => {
    // productId NULL nu intră în indexul unic => serializăm noi aceeași cheie
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`artfest-fair-manual:${variantKey}`}))`;
    const existing = await tx.artfestFairInventoryItem.findFirst({
      where: { fairId: fair.id, registrationId: owner.registrationId, vendorId: owner.vendorId, productId: null, variantKey },
    });
    if (existing) return { item: existing, duplicate: true };

    for (let attempt = 0; attempt < 6; attempt += 1) {
      const barcode = generateFairBarcode(randomInt);
      const clash = await tx.artfestFairInventoryItem.findUnique({ where: { barcode }, select: { id: true } });
      if (clash) continue;
      const created = await tx.artfestFairInventoryItem.create({
        data: {
          fairId: fair.id,
          registrationId: owner.registrationId,
          vendorId: owner.vendorId,
          serviceId: owner.serviceId,
          productId: null,
          barcode,
          // stocul primit fizic: linia intră direct în stocul târgului (recepția de mai jos)
          status: "RECEIVED",
          variantKey,
          variantLabel: null,
          variantSnapshot: null,
          titleSnapshot: title,
          storeNameSnapshot: owner.storeName,
          imageUrlSnapshot: null,
          priceSnapshotCents: priceCents,
          currency: "RON",
          priceSyncedAt: now,
          declaredQty: qty,
          receivedQty: qty,
          availableQty: qty,
          submittedAt: now,
          receivedAt: now,
          receivedById: adminId || null,
          isFragile: false,
          isUnique: false,
          isLimitedEdition: false,
          canBeRemade: false,
        },
      });
      await writeEvent(tx, created, "CREATED", {
        after: {
          declaredQty: qty,
          barcode,
          manual: true,
          byAdmin: true,
          owner: owner.artfest ? "ARTFEST" : "PARTICIPANT",
          serviceId: owner.serviceId,
          priceSnapshotCents: priceCents,
        },
        actorUserId: adminId || null,
      });
      // recepția: aceeași mișcare ca la recepția existentă (cine, când, câte bucăți)
      await tx.artfestFairStockMovement.create({
        data: {
          inventoryItemId: created.id,
          fairId: fair.id,
          vendorId: owner.vendorId,
          type: "RECEIVED",
          quantity: qty,
          actorUserId: adminId || null,
          reason: "Stoc primit fizic - adăugat din POS (Admin)",
          idempotencyKey: `pos-product:${created.id}:received`,
        },
      });
      await writeEvent(tx, created, "STATUS_CHANGED", {
        before: { status: null },
        after: { status: "RECEIVED", receivedQty: qty, rejectedQty: 0, difference: 0 },
        note: "Stoc primit fizic, confirmat de Admin în POS",
        actorUserId: adminId || null,
      });
      return { item: created, duplicate: false };
    }
    throw new FairError(500, "barcode_generation_failed", "Nu am putut genera un cod unic. Încearcă din nou.");
  }, FAIR_TX_OPTIONS);

  return { duplicate: result.duplicate, item: await getAdminInventoryLine({ id: result.item.id, db }) };
}

/*
 * Suplimentarea stocului unui produs adăugat manual (Artfest sau participant), după
 * confirmarea primirii fizice. Mișcare RECEIVED cu cheia de idempotență a operației
 * (dublu click / retry => o singură intrare). Fără limita termenului de inventar (Admin).
 */
export async function addPosProductStock({ id, body = {}, idempotencyKey, adminId, db = prisma }) {
  const key = requireIdempotencyKey(idempotencyKey);
  const qty = parseReceivedQty(body.receivedQty);
  if (qty === null) {
    throw new FairError(400, "invalid_quantity", `Stocul primit fizic trebuie să fie un număr întreg între 1 și ${MAX_DECLARED_QTY}.`, {
      fields: { receivedQty: "Introdu câte bucăți ai primit." },
    });
  }
  requireReceiptConfirmation(body);
  const fair = await ensureFair(db);
  const movementKey = `pos-stock:${key}`;

  await db.$transaction(async (tx) => {
    await lockLine(tx, String(id));
    const previous = await tx.artfestFairStockMovement.findUnique({ where: { idempotencyKey: movementKey }, select: { inventoryItemId: true } });
    if (previous) {
      if (previous.inventoryItemId !== String(id)) throw new FairError(409, "idempotency_conflict", "Cheia operației a fost folosită pentru alt produs.");
      return;
    }
    const line = await tx.artfestFairInventoryItem.findUnique({ where: { id: String(id) } });
    if (!line || line.fairId !== fair.id) throw new FairError(404, "inventory_item_not_found", "Produsul nu este în inventarul târgului activ.");
    if (!isManualFairItem(line)) {
      throw new FairError(409, "stock_add_manual_only", "Stocul se suplimentează din POS doar pentru produsele adăugate manual.");
    }
    if (line.status !== "RECEIVED") {
      throw new FairError(409, "not_in_stock", "Produsul nu este în stocul târgului (nu a fost recepționat sau a fost anulat).");
    }
    if (!isArtfestOwned(line)) {
      const registration = await tx.artfestFairRegistration.findUnique({ where: { id: line.registrationId }, select: { status: true } });
      if (registration?.status !== "APPROVED") {
        throw new FairError(409, "participant_not_eligible", "Participarea vânzătorului nu mai este aprobată.");
      }
    }
    const updated = await tx.artfestFairInventoryItem.updateMany({
      where: { id: line.id, status: "RECEIVED", receivedQty: line.receivedQty, availableQty: line.availableQty },
      data: { receivedQty: { increment: qty }, availableQty: { increment: qty } },
    });
    if (updated.count !== 1) throw new FairError(409, "inventory_conflict", "Stocul s-a modificat între timp. Încearcă din nou.");
    await tx.artfestFairStockMovement.create({
      data: {
        inventoryItemId: line.id,
        fairId: line.fairId,
        vendorId: line.vendorId,
        type: "RECEIVED",
        quantity: qty,
        actorUserId: adminId || null,
        reason: "Suplimentare stoc primit fizic - POS (Admin)",
        idempotencyKey: movementKey,
      },
    });
    await writeEvent(tx, line, "UPDATED", {
      before: { receivedQty: line.receivedQty, availableQty: line.availableQty },
      after: { receivedQty: line.receivedQty + qty, availableQty: line.availableQty + qty, stockAdded: qty },
      note: "Stoc suplimentar primit fizic, confirmat de Admin în POS",
      actorUserId: adminId || null,
    });
  }, FAIR_TX_OPTIONS);

  return { item: await getAdminInventoryLine({ id: String(id), db }) };
}
