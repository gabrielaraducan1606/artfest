// src/lib/artfestFairAccessories.js
//
// Târgul Artfest - „Ambalare și accesorii” adăugate de Artfest pe produsele participanților
// (cutii, funde, pungi etc.). Funcții pure (fără DB), folosite de inventar, POS, retururi,
// rapoarte și decont.
//
// Valorile sunt PER BUCATĂ DE PRODUS: o poziție = { name, quantity, unitPriceCents, totalCents },
// totalCents = quantity × unitPriceCents; accessoriesUnitCents = suma pozițiilor.
//
// La vânzare (computeLine):
//   comisionul rămâne round_half_up(lineGross × commissionBps / 10000), pe prețul EFECTIV;
//   accessoriesCents = accessoriesUnitCents × cantitatea vândută (nu depinde de reducere);
//   vendorNet = lineGross − commission − accessoriesCents (+ compensația istorică D8);
//   partea Artfest = commission + accessoriesCents.
// Accesoriile NU schimbă prețul final / online și nu devin linii de vânzare separate.
// Produsele proprii Artfest nu au accesorii (încasarea e oricum integral Artfest).
// Toate sumele în bani întregi (RON × 100).

export const ACCESSORY_LIMITS = Object.freeze({
  maxItems: 20,
  nameMax: 80,
  // bucăți de accesoriu pe O bucată de produs (ex. 2 funde)
  quantityMax: 100,
  // 10.000 lei pe bucată de accesoriu - gardă împotriva greșelilor de tastare
  unitPriceMaxCents: 1_000_000,
});

export const ACCESSORY_ERRORS = Object.freeze({
  accessories_invalid: "Lista de accesorii este invalidă.",
  accessories_too_many: `Cel mult ${ACCESSORY_LIMITS.maxItems} poziții de accesorii pe produs.`,
});

function cleanName(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

/*
 * Validează lista trimisă de Admin. Întoarce { ok, items, unitCents, fields } - fields: mesaje
 * per poziție (`items.<i>.name|quantity|unitPriceCents`). Lista goală = fără accesorii.
 */
export function validateAccessories(raw) {
  if (!Array.isArray(raw)) return { ok: false, items: [], unitCents: 0, fields: { items: ACCESSORY_ERRORS.accessories_invalid } };
  if (raw.length > ACCESSORY_LIMITS.maxItems) {
    return { ok: false, items: [], unitCents: 0, fields: { items: ACCESSORY_ERRORS.accessories_too_many } };
  }
  const fields = {};
  const items = [];
  raw.forEach((entry, i) => {
    const name = cleanName(entry?.name);
    const quantity = Number(entry?.quantity);
    const unitPriceCents = Number(entry?.unitPriceCents);
    if (!name) fields[`items.${i}.name`] = "Scrie denumirea accesoriului.";
    else if (name.length > ACCESSORY_LIMITS.nameMax) fields[`items.${i}.name`] = `Maximum ${ACCESSORY_LIMITS.nameMax} de caractere.`;
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > ACCESSORY_LIMITS.quantityMax) {
      fields[`items.${i}.quantity`] = `Cantitatea pe bucată de produs: număr întreg între 1 și ${ACCESSORY_LIMITS.quantityMax}.`;
    }
    if (!Number.isInteger(unitPriceCents) || unitPriceCents < 1 || unitPriceCents > ACCESSORY_LIMITS.unitPriceMaxCents) {
      fields[`items.${i}.unitPriceCents`] = "Prețul unitar trebuie să fie mai mare decât zero.";
    }
    items.push({ name, quantity, unitPriceCents, totalCents: quantity * unitPriceCents });
  });
  const ok = Object.keys(fields).length === 0;
  return { ok, items: ok ? items : [], unitCents: ok ? items.reduce((s, x) => s + x.totalCents, 0) : 0, fields };
}

/** Lista salvată (JSON) -> poziții curate; date invalide / lipsă => []. */
export function accessoryItems(json) {
  if (!Array.isArray(json)) return [];
  return json
    .filter((x) => x && typeof x === "object")
    .map((x) => {
      const quantity = Number(x.quantity) || 0;
      const unitPriceCents = Number(x.unitPriceCents) || 0;
      return { name: String(x.name || ""), quantity, unitPriceCents, totalCents: Number(x.totalCents ?? quantity * unitPriceCents) || 0 };
    });
}

/** Accesoriile curente ale unei linii de inventar: { items, unitCents, updatedAt }. */
export function accessoriesOf(item) {
  return {
    items: accessoryItems(item?.accessories),
    unitCents: Number(item?.accessoriesUnitCents) || 0,
    updatedAt: item?.accessoriesUpdatedAt || null,
  };
}

/** Aceeași listă (denumire, cantitate, preț) - pentru „fără schimbare” (dublu click / retrimitere). */
export function sameAccessories(a, b) {
  const key = (list) => JSON.stringify(accessoryItems(list).map((x) => [x.name, x.quantity, x.unitPriceCents]));
  return key(a) === key(b);
}

/*
 * Suma bucăților [from, from + qty) dintr-un total împărțit determinist pe `quantity` bucăți:
 * bucata i = floor(total / quantity) + (i < total % quantity). Aceeași regulă ca retururile.
 */
export function allocateUnits(total, quantity, from, qty) {
  const base = Math.floor(total / quantity);
  const rest = total % quantity;
  const extra = Math.max(0, Math.min(from + qty, rest) - Math.min(from, rest));
  return base * qty + extra;
}

/*
 * Cea mai mică sumă a vânzătorului pe O bucată, cu alocarea pe bucăți folosită la retururi
 * (încasat, comision, compensație). Un retur parțial nu poate da o sumă negativă dacă
 * minimul e ≥ 0 - și nici suma liniei.
 */
export function minUnitVendorNetCents({ lineGrossCents, commissionCents, artfestFundedDiscountCents = 0, quantity, accessoriesUnitCents = 0 }) {
  let min = Infinity;
  // bucățile diferă doar prin restul împărțirii: ajung primele / ultimele poziții distincte
  const points = new Set([0, quantity - 1]);
  for (const total of [lineGrossCents, commissionCents, artfestFundedDiscountCents]) {
    const rest = total % quantity;
    if (rest > 0) {
      points.add(rest - 1);
      points.add(Math.min(rest, quantity - 1));
    }
  }
  for (const i of points) {
    const v =
      allocateUnits(lineGrossCents, quantity, i, 1) -
      allocateUnits(commissionCents, quantity, i, 1) +
      allocateUnits(artfestFundedDiscountCents, quantity, i, 1) -
      accessoriesUnitCents;
    if (v < min) min = v;
  }
  return min;
}

/*
 * Partea Artfest dintr-un set de linii de vânzare și de retur (valorile SALVATE), separat:
 *   commissionCents   - comisionul din vânzările participanților (după retururile imputate vânzătorului);
 *   accessoriesCents  - recuperarea „Ambalare și accesorii” (idem) - NU este profit net: aplicația
 *                       nu cunoaște toate costurile Artfest;
 *   ownProductsCents  - încasările din produsele proprii Artfest, după rambursări;
 *   artfestFundedCents - compensații istorice pentru reduceri (D8), scad partea Artfest;
 *   artfestBorneRefundCents - rambursări pe produsele participanților suportate de Artfest;
 *   totalCents = commission + accessories + ownProducts − artfestFunded − artfestBorneRefund
 *              = încasat net − suma netă a vânzătorilor (fără dublare).
 */
export function artfestShareOf(saleLines = [], returnLines = []) {
  const out = { commissionCents: 0, accessoriesCents: 0, ownProductsCents: 0, artfestFundedCents: 0, artfestBorneRefundCents: 0, totalCents: 0 };
  for (const l of saleLines) {
    if (!l.vendorId) out.ownProductsCents += l.lineGrossCents;
    else {
      out.commissionCents += l.commissionCents;
      out.accessoriesCents += l.accessoriesCents || 0;
      out.artfestFundedCents += l.artfestFundedDiscountCents || 0;
    }
  }
  for (const rl of returnLines) {
    if (!rl.vendorId) out.ownProductsCents -= rl.refundCents;
    else if (rl.refundResponsibility === "ARTFEST") out.artfestBorneRefundCents += rl.refundCents;
    else {
      out.commissionCents -= rl.commissionReversedCents;
      out.accessoriesCents -= rl.accessoriesReversedCents || 0;
      out.artfestFundedCents -= rl.artfestFundedReversedCents || 0;
    }
  }
  out.totalCents = out.commissionCents + out.accessoriesCents + out.ownProductsCents - out.artfestFundedCents - out.artfestBorneRefundCents;
  return out;
}

/** Text scurt (fără „;”, separatorul CSV): „Cutie 1 × 6,00 lei + Fundă 2 × 1,00 lei”. */
export function accessoriesText(items) {
  const lei = (c) => (Number(c || 0) / 100).toFixed(2).replace(".", ",");
  return accessoryItems(items)
    .map((x) => `${x.name} ${x.quantity} × ${lei(x.unitPriceCents)} lei`)
    .join(" + ");
}
