// backend/src/services/artfestFairAccessoriesService.js
//
// Târgul Artfest - „Ambalare și accesorii” (doar Admin): materialele adăugate de Artfest pe
// un produs al unui participant (cutii, funde, pungi). Valorile sunt PER BUCATĂ DE PRODUS.
//
//  - modificarea se aplică DOAR vânzărilor viitoare: vânzările / retururile / deconturile
//    existente își păstrează snapshot-ul de pe linia de vânzare (nimic nu se recalculează);
//  - nu schimbă prețul final / online, eticheta sau stocul de pungi / cutii Artfest
//    (evidența accesoriilor deja adăugate fizic);
//  - produsele proprii Artfest nu au accesorii (încasarea e oricum integral Artfest);
//  - istoric: eveniment ACCESSORIES_SET (before / after + autor), plus cine / când pe linie;
//  - aceeași listă trimisă din nou (dublu click / retrimitere) => fără schimbare, fără eveniment.
// Vânzătorul vede lista și valorile în inventarul lui (fără email).

import { prisma } from "../db.js";
import { FAIR_TX_OPTIONS } from "../config/artfestFair.js";
import { FairError, ensureFair } from "./artfestFairService.js";
import { getAdminInventoryLine, lockLine, writeEvent } from "./artfestFairReceptionService.js";
import { accessoriesOf, accessoryItems, sameAccessories, validateAccessories } from "../lib/artfestFairAccessories.js";
import { isArtfestOwned } from "../lib/artfestFairOwner.js";

// liniile active ale târgului (cele anulate / refuzate nu se mai vând)
const ACCESSORY_STATUSES = Object.freeze(["DRAFT", "SUBMITTED", "RECEIVED"]);
const HISTORY_LIMIT = 50;

function userName(u) {
  if (!u) return null;
  const full = [u.firstName, u.lastName].filter(Boolean).join(" ").trim();
  return full || u.name || u.email || null;
}

async function history(db, itemId) {
  const events = await db.artfestFairInventoryEvent.findMany({
    where: { inventoryItemId: itemId, type: "ACCESSORIES_SET" },
    orderBy: { createdAt: "desc" },
    take: HISTORY_LIMIT,
  });
  const actorIds = [...new Set(events.map((e) => e.actorUserId).filter(Boolean))];
  const users = actorIds.length
    ? await db.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, email: true, firstName: true, lastName: true, name: true } })
    : [];
  const byId = new Map(users.map((u) => [u.id, u]));
  return events.map((e) => ({
    id: e.id,
    at: e.createdAt,
    by: userName(byId.get(e.actorUserId)),
    before: { items: accessoryItems(e.before?.items), unitCents: Number(e.before?.unitCents) || 0 },
    after: { items: accessoryItems(e.after?.items), unitCents: Number(e.after?.unitCents) || 0 },
  }));
}

async function loadLine(db, id, fairId) {
  const item = await db.artfestFairInventoryItem.findUnique({ where: { id } });
  if (!item || item.fairId !== fairId) {
    throw new FairError(404, "inventory_item_not_found", "Linia de inventar nu a fost găsită.");
  }
  return item;
}

function assertEditable(item) {
  if (isArtfestOwned(item)) {
    throw new FairError(409, "artfest_owned_no_accessories", "Produs Artfest (stoc propriu): încasarea este oricum integral Artfest, fără accesorii reținute.");
  }
  if (!ACCESSORY_STATUSES.includes(item.status)) {
    throw new FairError(409, "inventory_line_inactive", "Linia nu mai este activă în inventarul târgului (anulată / refuzată).");
  }
}

/** Accesoriile curente + istoricul modificărilor (Admin). */
export async function getInventoryAccessories({ id, db = prisma }) {
  const fair = await ensureFair(db);
  const item = await loadLine(db, String(id || "").trim(), fair.id);
  const updatedBy = item.accessoriesUpdatedById
    ? await db.user.findUnique({ where: { id: item.accessoriesUpdatedById }, select: { id: true, email: true, firstName: true, lastName: true, name: true } })
    : null;
  return {
    inventoryItemId: item.id,
    editable: !isArtfestOwned(item) && ACCESSORY_STATUSES.includes(item.status),
    artfestOwned: isArtfestOwned(item),
    soldQty: item.soldQty || 0,
    ...accessoriesOf(item),
    updatedBy: userName(updatedBy),
    history: await history(db, item.id),
  };
}

/*
 * Înlocuiește lista accesoriilor (PER BUCATĂ DE PRODUS). body.items = [{ name, quantity, unitPriceCents }];
 * lista goală = fără accesorii. Sub lock pe linie (același ca vânzarea), deci o vânzare simultană
 * folosește fie lista veche, fie pe cea nouă - niciodată un amestec.
 */
export async function setInventoryAccessories({ id, body = {}, adminId, db = prisma, now = new Date() }) {
  const lineId = String(id || "").trim();
  const parsed = validateAccessories(body.items);
  if (!parsed.ok) {
    throw new FairError(400, "invalid_accessories", "Verifică accesoriile introduse.", { fields: parsed.fields });
  }

  const changed = await db.$transaction(async (tx) => {
    const fair = await ensureFair(tx);
    await lockLine(tx, lineId);
    const item = await loadLine(tx, lineId, fair.id);
    assertEditable(item);
    if (sameAccessories(item.accessories, parsed.items) && (Number(item.accessoriesUnitCents) || 0) === parsed.unitCents) return false;
    await tx.artfestFairInventoryItem.update({
      where: { id: item.id },
      data: {
        accessories: parsed.items,
        accessoriesUnitCents: parsed.unitCents,
        accessoriesUpdatedAt: now,
        accessoriesUpdatedById: adminId || null,
      },
    });
    const prev = accessoriesOf(item);
    await writeEvent(tx, item, "ACCESSORIES_SET", {
      before: { items: prev.items, unitCents: prev.unitCents },
      after: { items: parsed.items, unitCents: parsed.unitCents },
      note: "Ambalare și accesorii (per bucată de produs); se aplică doar vânzărilor viitoare.",
      actorUserId: adminId || null,
    });
    return true;
  }, FAIR_TX_OPTIONS);

  return {
    changed,
    accessories: await getInventoryAccessories({ id: lineId, db }),
    item: await getAdminInventoryLine({ id: lineId, db }),
  };
}
