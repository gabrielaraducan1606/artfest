// src/pages/Vendor/Fair/fairAccessories.js
//
// Târgul Artfest - „Ambalare și accesorii” adăugate de Artfest pe produsele participanților
// (cutii, funde, pungi). Comun Admin (formular) și vânzător (afișare). Fără React - testabil
// cu node --test. Valorile sunt PER BUCATĂ DE PRODUS; la vânzare se rețin suplimentar din
// partea vânzătorului și revin integral Artfest. Comisionul rămâne 10% din prețul efectiv.
// Calculul real se face pe server; aici doar validarea formularului și previzualizarea.

// aceleași limite ca serverul (backend/src/lib/artfestFairAccessories.js)
export const ACCESSORY_MAX_ITEMS = 20;
export const ACCESSORY_NAME_MAX = 80;
export const ACCESSORY_QTY_MAX = 100;
export const ACCESSORY_UNIT_PRICE_MAX_CENTS = 1_000_000;
const PRICE_RE = /^\d{1,7}(?:[.,]\d{1,2})?$/;

export function formatLeiPlain(cents) {
  return `${(Number(cents || 0) / 100).toFixed(2).replace(".", ",")} lei`;
}

/** „6” / „6,50” -> 650; altfel null. */
export function parseLeiToCents(value) {
  const text = String(value ?? "").trim().replace(/\s+/g, "");
  if (!PRICE_RE.test(text)) return null;
  const [lei, bani = ""] = text.split(/[.,]/);
  const cents = Number(lei) * 100 + Number((bani + "00").slice(0, 2));
  return cents > 0 ? cents : null;
}

/** Rândurile salvate (bani) -> rândurile formularului (text în lei). */
export function rowsFromItems(items) {
  return (Array.isArray(items) ? items : []).map((x) => ({
    name: x.name || "",
    quantity: String(x.quantity ?? 1),
    price: (Number(x.unitPriceCents || 0) / 100).toFixed(2).replace(".", ","),
  }));
}

export const emptyRow = () => ({ name: "", quantity: "1", price: "" });

/*
 * Formularul -> { ok, fields, items, unitCents }. Rândurile complet goale se ignoră;
 * fields: `${i}.name|quantity|price`. items = corpul pentru PUT /inventory/:id/accessories.
 */
export function validateAccessoryRows(rows) {
  const fields = {};
  const items = [];
  const list = (Array.isArray(rows) ? rows : []).map((r, i) => ({ ...r, i }));
  const filled = list.filter((r) => String(r.name || "").trim() || String(r.price || "").trim());
  if (filled.length > ACCESSORY_MAX_ITEMS) fields.items = `Cel mult ${ACCESSORY_MAX_ITEMS} poziții.`;
  for (const r of filled) {
    const name = String(r.name || "").replace(/\s+/g, " ").trim();
    const quantity = Number(String(r.quantity ?? "").trim());
    const unitPriceCents = parseLeiToCents(r.price);
    if (!name) fields[`${r.i}.name`] = "Scrie denumirea (ex. Cutie).";
    else if (name.length > ACCESSORY_NAME_MAX) fields[`${r.i}.name`] = `Maximum ${ACCESSORY_NAME_MAX} de caractere.`;
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > ACCESSORY_QTY_MAX) {
      fields[`${r.i}.quantity`] = `Număr întreg între 1 și ${ACCESSORY_QTY_MAX} (pe o bucată de produs).`;
    }
    if (unitPriceCents === null || unitPriceCents > ACCESSORY_UNIT_PRICE_MAX_CENTS) fields[`${r.i}.price`] = "Preț mai mare decât zero (ex. 6 sau 2,50).";
    items.push({ name, quantity, unitPriceCents });
  }
  const ok = Object.keys(fields).length === 0;
  return { ok, fields, items: ok ? items : [], unitCents: ok ? items.reduce((s, x) => s + x.quantity * x.unitPriceCents, 0) : 0 };
}

/** Totalul pe bucată, live, pentru rândurile valide (ignoră rândurile incomplete). */
export function liveUnitTotal(rows) {
  return (Array.isArray(rows) ? rows : []).reduce((sum, r) => {
    const q = Number(String(r.quantity ?? "").trim());
    const p = parseLeiToCents(r.price);
    return Number.isInteger(q) && q > 0 && p ? sum + q * p : sum;
  }, 0);
}

// round_half_up(a / b), aceeași rotunjire ca serverul
const roundHalfUpDiv = (a, b) => Math.floor((2 * a + b) / (2 * b));

export const ARTFEST_MARKUP_BPS = 1000;

/** Adaosul Artfest pe bucată: 10% din prețul declarat (aceeași rotunjire ca serverul). */
export function markupUnit(declaredCents) {
  const d = Number(declaredCents);
  return Number.isInteger(d) && d > 0 ? roundHalfUpDiv(d * ARTFEST_MARKUP_BPS, 10000) : 0;
}

/** Prețul final propus: declarat + 10% din declarat + accesorii pe bucată. */
export function proposedPrice(declaredCents, accessoriesUnitCents = 0) {
  const d = Number(declaredCents);
  if (!Number.isInteger(d) || d <= 0) return null;
  return d + markupUnit(d) + Math.max(0, Number(accessoriesUnitCents) || 0);
}

/*
 * O bucată vândută la `priceCents` după regula actuală (aceeași ca serverul, fairLineSplit):
 *  - preț ≥ propus (declarat + 10% + accesorii): vânzătorul primește prețul DECLARAT, Artfest diferența;
 *  - preț < propus: se scad întâi accesoriile; din rest Artfest 10% (round_half_up), vânzătorul 90%.
 * negative = prețul nu acoperă accesoriile (vânzarea se blochează la casă);
 * markupReduced = treapta „sub propus” (reducerea afectează suma vânzătorului).
 */
export function splitAtPrice(priceCents, declaredCents, accessoriesUnitCents = 0) {
  const d = Number(declaredCents);
  if (!Number.isInteger(priceCents) || priceCents <= 0 || !Number.isInteger(d) || d <= 0) return null;
  const acc = Math.max(0, Number(accessoriesUnitCents) || 0);
  const plannedMarkupCents = markupUnit(d);
  const proposedPriceCents = d + plannedMarkupCents + acc;
  const baseCents = priceCents - acc;
  const full = priceCents >= proposedPriceCents;
  const commissionCents = full ? baseCents - d : baseCents > 0 ? roundHalfUpDiv(baseCents * ARTFEST_MARKUP_BPS, 10000) : 0;
  const vendorNetCents = full ? d : baseCents - commissionCents;
  return {
    priceCents,
    declaredCents: d,
    plannedMarkupCents,
    financeRule: full ? "DECLARED_PLUS_MARKUP" : "DISCOUNTED_COMMISSION",
    baseCents,
    // partea Artfest fără accesorii: adaosul (≥ propus) sau comisionul de 10% (sub propus)
    markupCents: commissionCents,
    accessoriesCents: acc,
    vendorNetCents,
    artfestCents: priceCents - vendorNetCents,
    proposedPriceCents,
    floorPriceCents: acc,
    negative: baseCents < 0,
    markupReduced: !full,
  };
}

/** „Cutie 1 × 6,00 lei + Fundă 1 × 2,00 lei”. */
export function accessoriesListText(items) {
  return (Array.isArray(items) ? items : [])
    .map((x) => `${x.name} ${x.quantity} × ${formatLeiPlain(x.unitPriceCents)}`)
    .join(" + ");
}

/*
 * Textul împărțirii pentru o linie (preview POS / vânzare salvată), după regula salvată pe ea:
 *  - DECLARED_PLUS_MARKUP: preț declarat (vânzătorului), adaos Artfest, accesorii;
 *  - COMMISSION_PERCENT (vânzări vechi): comision 10%, accesorii, vânzător.
 */
export function lineSplitText(line) {
  if (!line) return "";
  if (line.artfestOwned || line.financeRule === "ARTFEST_OWN") return `Produs Artfest: integral Artfest (${formatLeiPlain(line.commissionCents)})`;
  if (line.financeRule === "DISCOUNTED_COMMISSION") {
    const base = (line.lineGrossCents ?? 0) - (line.accessoriesCents || 0);
    const parts = [];
    if ((line.accessoriesCents || 0) > 0) parts.push(`Accesorii ${formatLeiPlain(line.accessoriesCents)}`);
    parts.push(`Comision 10% ${formatLeiPlain(line.commissionCents)} din ${formatLeiPlain(base)}`, `Vânzător ${formatLeiPlain(line.vendorNetCents)}`);
    return `Sub prețul propus: ${parts.join(" · ")}`;
  }
  if (line.financeRule === "DECLARED_PLUS_MARKUP") {
    const parts = [`Vânzător (preț declarat) ${formatLeiPlain(line.vendorNetCents)}`, `Adaos Artfest ${formatLeiPlain(line.commissionCents)}`];
    if ((line.accessoriesCents || 0) > 0) parts.push(`Accesorii ${formatLeiPlain(line.accessoriesCents)}`);
    return parts.join(" · ");
  }
  const parts = [`Comision 10% ${formatLeiPlain(line.commissionCents)}`];
  if ((line.accessoriesCents || 0) > 0) parts.push(`Ambalare și accesorii ${formatLeiPlain(line.accessoriesCents)}`);
  parts.push(`Vânzător ${formatLeiPlain(line.vendorNetCents)}`);
  return parts.join(" · ");
}
