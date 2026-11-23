// backend/src/lib/artfestFairPricing.js
//
// Prețurile Târgului Artfest - funcții pure (fără DB), folosite de inventar,
// etichete, recepție, POS și rapoarte.
//
// UNA SINGURĂ regulă financiară pentru toate vânzările de la Târg: comisionul
// existent (fair.commissionBps, 10%) din prețul EFECTIV de vânzare; vendorul
// primește restul (90%). Calculul rămâne în artfestFairPosService.computeLine.
// Reducerile (automate sau prețul introdus la casă) scad prețul efectiv, deci
// scad și comisionul, și suma vendorului.
//
// Funcțiile de preț NU depind de acceptarea regulamentului 2.0.0: pentru orice
// înscriere APPROVED (COMMISSION sau FAIR_PRICE) Admin poate salva prețul final
// (sugestia = prețul declarat / 0,90), poate genera etichete cu sau fără preț, iar
// prețul efectiv se poate introduce la casă (doar vânzarea curentă), fără retipărire.
// Fără preț final, prețul de vânzare = prețul declarat.
// pricingModel rămâne doar ca evidență (salvat neschimbat pe vânzare); singura
// diferență: la FAIR_PRICE lipsa prețului final cere prețul introdus la casă.
//
// Toate sumele în bani întregi (RON × 100).

export const PRICING_MODELS = Object.freeze({ COMMISSION: "COMMISSION", FAIR_PRICE: "FAIR_PRICE" });
export const MAX_FAIR_PRICE_CENTS = 100_000_000; // 1.000.000 lei (aceeași limită ca produsele manuale)

// round_half_up(a / b) pentru a >= 0, b > 0 - ACEEAȘI rotunjire ca la comisionul din POS
function roundHalfUpDiv(a, b) {
  return Math.floor((2 * a + b) / (2 * b));
}

export function isFairPriceModel(model) {
  return model === PRICING_MODELS.FAIR_PRICE;
}

/** Comisionul și suma vendorului pentru o sumă încasată (aceeași formulă ca POS-ul). */
export function splitGross(grossCents, commissionBps) {
  const commissionCents = roundHalfUpDiv(grossCents * commissionBps, 10000);
  return { commissionCents, vendorNetCents: grossCents - commissionCents };
}

/**
 * Prețul sugerat = prețul declarat / (1 − comision), în bani: CEL MAI MIC preț pentru
 * care, după comisionul rotunjit exact ca la vânzare, vendorul primește cel puțin
 * prețul declarat. Ex.: 100,00 lei -> 111,11 lei (Artfest 11,11, vendorul 100,00).
 */
export function suggestedFinalPriceCents(vendorPriceCents, commissionBps) {
  const v = Number(vendorPriceCents);
  const bps = Number(commissionBps);
  if (!Number.isInteger(v) || v <= 0 || !Number.isInteger(bps) || bps < 0 || bps >= 10000) return null;
  let price = Math.floor((v * 10000) / (10000 - bps));
  while (splitGross(price, bps).vendorNetCents < v) price += 1;
  return price;
}

/**
 * Prețul de vânzare la târg al liniei = prețul care TREBUIE să fie pe etichetă.
 * finalPriceCents (salvat de Admin, orice înscriere); fără el, prețul declarat.
 */
export function fairSalePriceCents(item) {
  return item?.finalPriceCents ?? item?.priceSnapshotCents ?? null;
}

/*
 * Starea etichetei: none | valid | outdated | blank.
 * „blank” = etichetă generată FĂRĂ preț tipărit (Etichete fără preț, cu cod AF):
 * labelGeneratedAt setat și labelPriceCents NULL. Prețul efectiv se introduce la casă;
 * fără schimbări de schemă.
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

/** Câmpurile de preț pentru Admin / vendor (aceeași formă peste tot). */
export function pricingView(item, model, commissionBps) {
  const vendorPriceCents = item.priceSnapshotCents;
  const fairModel = isFairPriceModel(model);
  const salePriceCents = fairSalePriceCents(item);
  const split = salePriceCents != null && Number.isInteger(commissionBps) ? splitGross(salePriceCents, commissionBps) : null;
  return {
    model: fairModel ? PRICING_MODELS.FAIR_PRICE : PRICING_MODELS.COMMISSION,
    commissionBps: Number.isInteger(commissionBps) ? commissionBps : null,
    vendorPriceCents,
    suggestedFinalPriceCents: suggestedFinalPriceCents(vendorPriceCents, commissionBps),
    finalPriceCents: item.finalPriceCents ?? null,
    salePriceCents,
    // la prețul de pe etichetă: comisionul Artfest și suma vendorului
    commissionCents: split ? split.commissionCents : null,
    vendorNetCents: split ? split.vendorNetCents : null,
    issues: finalPriceIssues(item, model),
    // prețul final se salvează, se tipărește și se vinde indiferent de acceptarea regulamentului 2.0.0
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
