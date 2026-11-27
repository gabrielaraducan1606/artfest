// backend/src/lib/artfestFairPricing.js
//
// Prețurile Târgului Artfest - funcții pure (fără DB), folosite de inventar,
// etichete, recepție, POS și rapoarte.
//
// REGULA PENTRU VÂNZĂRILE VIITOARE ale produselor participanților (DECLARED_PLUS_MARKUP):
// prețul DECLARAT de vânzător rămâne integral al lui; peste el se adaugă
//   1. adaosul Artfest = 10% din prețul declarat (round_half_up, bani întregi);
//   2. „Ambalare și accesorii” Artfest, per bucată, integral.
// Prețul final PROPUS = declarat + adaos + accesorii (ex. 50 + 5 + 5 = 60 lei).
// La vânzare, după prețul EFECTIV încasat (pe linie, față de propus × cantitate):
//   1. încasat ≥ propus (DECLARED_PLUS_MARKUP): vânzătorul primește prețul declarat × cantitate;
//      Artfest primește diferența (adaos + accesorii; peste propus, tot surplusul).
//   2. încasat < propus (DISCOUNTED_COMMISSION): se scad întâi accesoriile din încasare; din baza
//      rămasă Artfest primește comisionul de 10% (round_half_up), vânzătorul restul de 90%.
//      Ex.: declarat 12, cutie 3, încasat 15 (< 16,20): bază 12, comision 1,20, vânzător 10,80, Artfest 4,20.
//   Încasarea sub valoarea accesoriilor e blocată.
// NU se mai folosește declarat / 0,90.
//
// Vânzările anterioare își păstrează regula salvată pe linie (COMMISSION_PERCENT: comision
// 10% din prețul efectiv). Produsele proprii Artfest rămân integral Artfest.
// Prețurile finale deja salvate și etichetele existente NU se modifică automat: diferența
// față de noul preț propus e semnalată (finalDiffersFromProposed, eticheta „outdated”).
// Fără preț final salvat, prețul de vânzare = prețul propus. Prețurile online nu se ating.
//
// Toate sumele în bani întregi (RON × 100).

export const PRICING_MODELS = Object.freeze({ COMMISSION: "COMMISSION", FAIR_PRICE: "FAIR_PRICE" });
export const MAX_FAIR_PRICE_CENTS = 100_000_000; // 1.000.000 lei (aceeași limită ca produsele manuale)

// regula financiară salvată pe fiecare linie de vânzare
export const FINANCE_RULES = Object.freeze({
  // istoric: comision (commissionBps) din prețul efectiv, vânzătorul restul
  COMMISSION_PERCENT: "COMMISSION_PERCENT",
  // actual (participanți), încasat ≥ propus: declarat integral vânzătorului, diferența Artfest
  DECLARED_PLUS_MARKUP: "DECLARED_PLUS_MARKUP",
  // actual (participanți), încasat < propus: accesoriile Artfest, apoi 10% / 90% din rest
  DISCOUNTED_COMMISSION: "DISCOUNTED_COMMISSION",
  // produs propriu Artfest: integral Artfest
  ARTFEST_OWN: "ARTFEST_OWN",
});
// adaosul Artfest: 10% din prețul declarat
export const ARTFEST_MARKUP_BPS = 1000;

/*
 * DOAR ÎN TESTE: regula istorică (comision 10% din prețul efectiv, fără preț propus) pentru testele
 * vechi care verifică mecanismele (idempotență, reduceri, retururi, rapoarte) pe vânzări istorice.
 * Necesită ambele: NODE_ENV=test ȘI ARTFEST_FAIR_LEGACY_COMMISSION_RULE=1 - în producție e ignorat.
 */
export function legacyCommissionRuleActive() {
  return process.env.NODE_ENV === "test" && process.env.ARTFEST_FAIR_LEGACY_COMMISSION_RULE === "1";
}

// round_half_up(a / b) pentru a >= 0, b > 0 - ACEEAȘI rotunjire ca la comisionul din POS
function roundHalfUpDiv(a, b) {
  return Math.floor((2 * a + b) / (2 * b));
}

export function isFairPriceModel(model) {
  return model === PRICING_MODELS.FAIR_PRICE;
}

/** Comisionul și suma vendorului pentru o sumă încasată - REGULA ISTORICĂ (COMMISSION_PERCENT). */
export function splitGross(grossCents, commissionBps) {
  const commissionCents = roundHalfUpDiv(grossCents * commissionBps, 10000);
  return { commissionCents, vendorNetCents: grossCents - commissionCents };
}

/** Adaosul Artfest pe bucată: 10% din prețul declarat (round_half_up). */
export function markupUnitCents(declaredCents, markupBps = ARTFEST_MARKUP_BPS) {
  const d = Number(declaredCents);
  if (!Number.isInteger(d) || d <= 0) return 0;
  return roundHalfUpDiv(d * markupBps, 10000);
}

const accessoriesUnit = (item) => (item?.vendorId ? Number(item.accessoriesUnitCents) || 0 : 0);

/**
 * Prețul final PROPUS al unei linii de participant: declarat + 10% din declarat + accesorii / buc.
 * Produs propriu Artfest: prețul lui (fără adaos). null = preț declarat lipsă.
 */
export function proposedFinalPriceCents(item, markupBps = ARTFEST_MARKUP_BPS) {
  const d = Number(item?.priceSnapshotCents);
  if (!Number.isInteger(d) || d <= 0) return null;
  if (!item.vendorId) return d;
  return d + markupUnitCents(d, markupBps) + accessoriesUnit(item);
}

/**
 * Compatibilitate: „prețul sugerat” = prețul propus după regula actuală (declarat + 10%), fără
 * accesorii (necunoscute aici). NU mai e declarat / 0,90.
 */
export function suggestedFinalPriceCents(vendorPriceCents, markupBps = ARTFEST_MARKUP_BPS) {
  const v = Number(vendorPriceCents);
  if (!Number.isInteger(v) || v <= 0) return null;
  if (legacyCommissionRuleActive()) return legacySuggestedFinalPriceCents(v, markupBps);
  const bps = Number.isInteger(markupBps) && markupBps >= 0 && markupBps < 10000 ? markupBps : ARTFEST_MARKUP_BPS;
  return v + markupUnitCents(v, bps);
}

/**
 * Prețul de vânzare la târg al liniei = prețul care TREBUIE să fie pe etichetă (totalul pentru client).
 * finalPriceCents (salvat de Admin) are prioritate; fără el, prețul propus (participant) sau prețul
 * produsului propriu Artfest.
 */
export function fairSalePriceCents(item) {
  if (item?.finalPriceCents != null) return item.finalPriceCents;
  if (legacyCommissionRuleActive()) return item?.priceSnapshotCents ?? null;
  return proposedFinalPriceCents(item) ?? item?.priceSnapshotCents ?? null;
}

/*
 * Starea etichetei: none | valid | outdated | blank.
 * „blank” = etichetă generată FĂRĂ preț tipărit (Etichete fără preț, cu cod AF).
 * „outdated” = prețul tipărit diferă de prețul de vânzare actual (ex. etichetă tipărită cu
 * prețul declarat înainte de regula „declarat + adaos + accesorii”) - semnalat, NU retipărit automat.
 */
export function labelStateFor(item) {
  if (!item?.labelGeneratedAt) return "none";
  if (item.labelPriceCents == null) return "blank";
  return item.labelPriceCents === fairSalePriceCents(item) ? "valid" : "outdated";
}

/** FAIR_PRICE: fără preț final stabilit de Admin nu se generează eticheta și nu se vinde. */
export function finalPriceIssues(item, model) {
  if (!isFairPriceModel(model)) return [];
  return item?.finalPriceCents == null ? ["final_price_missing"] : [];
}

export const FINAL_PRICE_MESSAGES = Object.freeze({
  final_price_missing: "Prețul final de vânzare nu a fost stabilit (Admin → Etichete).",
});

/*
 * Împărțirea unei LINII (cantitate q, încasat total grossCents) după regula actuală (participant).
 * Rezultat: financeRule (treapta aplicată), commissionCents = partea Artfest FĂRĂ accesorii,
 * vendorNetCents, accessoriesCents; belowAccessories = încasarea nu acoperă accesoriile (blocat);
 * vendorReduced = treapta 2 (reducerea afectează suma vânzătorului).
 */
export function fairLineSplit({ grossCents, quantity = 1, declaredUnitPriceCents, accessoriesUnitCents = 0, markupBps = ARTFEST_MARKUP_BPS }) {
  const g = Number(grossCents);
  const q = Number(quantity);
  const d = Number(declaredUnitPriceCents);
  if (!Number.isInteger(g) || !Number.isInteger(q) || q < 1 || !Number.isInteger(d) || d <= 0) return null;
  const a = Math.max(0, Number(accessoriesUnitCents) || 0);
  const plannedMarkupUnit = markupUnitCents(d, markupBps);
  const proposedUnit = d + plannedMarkupUnit + a;
  const accessoriesCents = a * q;
  const baseCents = g - accessoriesCents;
  let financeRule;
  let commissionCents;
  let vendorNetCents;
  if (g >= proposedUnit * q) {
    financeRule = FINANCE_RULES.DECLARED_PLUS_MARKUP;
    vendorNetCents = d * q;
    commissionCents = baseCents - vendorNetCents;
  } else {
    financeRule = FINANCE_RULES.DISCOUNTED_COMMISSION;
    commissionCents = baseCents > 0 ? roundHalfUpDiv(baseCents * markupBps, 10000) : 0;
    vendorNetCents = baseCents - commissionCents;
  }
  return {
    financeRule,
    grossCents: g,
    quantity: q,
    declaredCents: d * q,
    declaredUnitPriceCents: d,
    markupBps,
    markupUnitCents: plannedMarkupUnit,
    plannedMarkupCents: plannedMarkupUnit * q,
    proposedUnitPriceCents: proposedUnit,
    accessoriesUnitCents: a,
    accessoriesCents,
    baseCents,
    commissionCents,
    vendorNetCents,
    artfestCents: g - vendorNetCents,
    belowAccessories: g < accessoriesCents,
    vendorReduced: financeRule === FINANCE_RULES.DISCOUNTED_COMMISSION,
  };
}

/* O bucată vândută la `priceCents` (Admin / vendor / etichete): aceeași regulă, cantitate 1. */
export function declaredMarkupSplit(priceCents, declaredCents, accessoriesCents = 0, markupBps = ARTFEST_MARKUP_BPS) {
  const split = fairLineSplit({ grossCents: priceCents, quantity: 1, declaredUnitPriceCents: declaredCents, accessoriesUnitCents: accessoriesCents, markupBps });
  if (!split) return null;
  return {
    ...split,
    priceCents: split.grossCents,
    declaredCents: split.declaredUnitPriceCents,
    proposedPriceCents: split.proposedUnitPriceCents,
    // compatibilitate: partea Artfest fără accesorii (adaos sau comision 10%)
    markupCents: split.commissionCents,
    // minimul încasării = accesoriile
    floorPriceCents: split.accessoriesUnitCents,
    belowFloor: split.belowAccessories,
    markupReduced: split.vendorReduced,
  };
}

/* Regula istorică (doar teste vechi): prețul sugerat = declarat / (1 − comision). */
function legacySuggestedFinalPriceCents(v, bps) {
  if (!Number.isInteger(bps) || bps < 0 || bps >= 10000) return null;
  let price = Math.floor((v * 10000) / (10000 - bps));
  while (splitGross(price, bps).vendorNetCents < v) price += 1;
  return price;
}

function legacyPricingView(item, model, commissionBps) {
  const vendorPriceCents = item.priceSnapshotCents;
  const fairModel = isFairPriceModel(model);
  const salePriceCents = fairSalePriceCents(item);
  const split = salePriceCents != null && Number.isInteger(commissionBps) ? splitGross(salePriceCents, commissionBps) : null;
  const accessoriesUnitCents = accessoriesUnit(item);
  return {
    model: fairModel ? PRICING_MODELS.FAIR_PRICE : PRICING_MODELS.COMMISSION,
    financeRule: FINANCE_RULES.COMMISSION_PERCENT,
    commissionBps: Number.isInteger(commissionBps) ? commissionBps : null,
    vendorPriceCents,
    suggestedFinalPriceCents: suggestedFinalPriceCents(vendorPriceCents, commissionBps),
    finalPriceCents: item.finalPriceCents ?? null,
    salePriceCents,
    commissionCents: split ? split.commissionCents : null,
    accessoriesUnitCents,
    vendorNetCents: split ? split.vendorNetCents - accessoriesUnitCents : null,
    accessoriesExceedVendorNet: split ? split.vendorNetCents - accessoriesUnitCents < 0 : false,
    issues: finalPriceIssues(item, model),
    canEditFinalPrice: true,
    ruleAccepted: fairModel,
  };
}

/** Câmpurile de preț pentru Admin / vendor (aceeași formă peste tot). */
export function pricingView(item, model, commissionBps) {
  if (legacyCommissionRuleActive()) return legacyPricingView(item, model, commissionBps);
  const vendorPriceCents = item.priceSnapshotCents;
  const fairModel = isFairPriceModel(model);
  const salePriceCents = fairSalePriceCents(item);
  const ownedByArtfest = !item.vendorId;
  const accessoriesUnitCents = accessoriesUnit(item);
  const proposed = proposedFinalPriceCents(item);
  const split = !ownedByArtfest && salePriceCents != null ? declaredMarkupSplit(salePriceCents, vendorPriceCents, accessoriesUnitCents) : null;
  return {
    model: fairModel ? PRICING_MODELS.FAIR_PRICE : PRICING_MODELS.COMMISSION,
    // treapta aplicată la prețul de vânzare actual (DECLARED_PLUS_MARKUP / DISCOUNTED_COMMISSION)
    financeRule: ownedByArtfest ? FINANCE_RULES.ARTFEST_OWN : split?.financeRule || FINANCE_RULES.DECLARED_PLUS_MARKUP,
    commissionBps: Number.isInteger(commissionBps) ? commissionBps : null,
    markupBps: ownedByArtfest ? null : ARTFEST_MARKUP_BPS,
    // prețul declarat (integral al vânzătorului), adaosul de 10%, accesoriile, totalul propus
    vendorPriceCents,
    markupUnitCents: ownedByArtfest ? 0 : markupUnitCents(vendorPriceCents),
    accessoriesUnitCents,
    proposedFinalPriceCents: proposed,
    // compatibilitate (câmp vechi): acum = prețul propus (declarat + adaos + accesorii)
    suggestedFinalPriceCents: proposed,
    finalPriceCents: item.finalPriceCents ?? null,
    // prețul final salvat diferă de noul preț propus: semnalat, NU modificat automat
    finalDiffersFromProposed: item.finalPriceCents != null && proposed != null && item.finalPriceCents !== proposed,
    salePriceCents,
    // la prețul de pe etichetă: partea Artfest (adaos efectiv), accesoriile și suma vânzătorului
    commissionCents: ownedByArtfest ? salePriceCents : split ? split.markupCents : null,
    markupCents: split ? split.markupCents : null,
    vendorNetCents: ownedByArtfest ? 0 : split ? split.vendorNetCents : null,
    artfestCents: ownedByArtfest ? salePriceCents : split ? split.artfestCents : null,
    // prețul de vânzare nu acoperă accesoriile: vânzarea se blochează la casă
    accessoriesExceedVendorNet: Boolean(split?.belowFloor),
    belowFloor: Boolean(split?.belowFloor),
    floorPriceCents: split ? split.floorPriceCents : null,
    // sub prețul propus: accesoriile, apoi 10% / 90% din rest (suma vânzătorului scade)
    markupReduced: Boolean(split?.markupReduced),
    vendorReduced: Boolean(split?.vendorReduced),
    issues: finalPriceIssues(item, model),
    canEditFinalPrice: true,
    ruleAccepted: fairModel,
  };
}

/** Sumă trimisă de Admin (bani întregi); null = invalid. */
export function parseCents(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > MAX_FAIR_PRICE_CENTS) return null;
  return n;
}
