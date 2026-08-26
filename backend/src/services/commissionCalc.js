// backend/src/services/commissionCalc.js

/*
 * Sursă unică pentru calculul comisionului Artfest pe un shipment.
 * Folosită identic de COD (vendorOrdersRoutes.js) și CARD
 * (marketplaceCalc.js), plus Order Details vendor - ca să nu mai
 * existe divergență între metode de plată sau între ce vede
 * vendorul și ce e în ledger.
 *
 * Regulă (aprobată explicit, Varianta 2):
 *
 * 1. commissionBase = itemsTotalAfterDiscount (fără transport,
 *    indiferent de sursa discountului, identic COD/CARD).
 *    commissionAmount = commissionBase * commissionBps / 10000.
 *
 * 2. Discount finanțat de vendor (VendorCampaign): fără subvenție -
 *    vendorul suportă discountul, comisionul rămâne cel simplu de
 *    mai sus, pe prețul net.
 *
 * 3. Discount finanțat de Artfest (Collection / Product of the Day /
 *    Artisan of the Week): se adaugă separat platformSubsidyAmount,
 *    calculat astfel încât vendorNet final să rămână economic
 *    echivalent cu regula anterioară (Artfest absoarbe costul
 *    discountului din propriul comision, până la limita comisionului
 *    standard calculat pe prețul ORIGINAL - niciodată mai mult).
 *
 * platformNet = commissionAmount - platformSubsidyAmount = cât reține
 * efectiv Artfest (asta trebuie facturat vendorului, nu commissionAmount
 * brut, pentru liniile subvenționate).
 */

function round2(value) {
  return Number.parseFloat(
    Number(value || 0).toFixed(2)
  );
}

function toNet(grossValue, vatFraction) {
  return vatFraction > 0
    ? round2(grossValue / (1 + vatFraction))
    : round2(grossValue);
}

/**
 * @param {object} params
 * @param {number} params.itemsOriginalGross - suma prețurilor ORIGINALE
 *   (înainte de orice discount), gross.
 * @param {number} params.itemsAfterDiscountGross - suma prețurilor FINALE
 *   plătite de client (după discount câștigător), gross.
 * @param {number} params.platformDiscountAmount - partea din discount
 *   finanțată de Artfest (sumă gross, din ShipmentItem.platformDiscountAmount).
 * @param {number} params.commissionBps - comisionul efectiv (plan sau
 *   override de campanie) în bps, 10000 = 100%.
 * @param {number} [params.vatFraction] - ex: 0.19 pentru vendor plătitor TVA.
 */
export function computeCommissionBreakdown({
  itemsOriginalGross = 0,
  itemsAfterDiscountGross = 0,
  platformDiscountAmount = 0,
  commissionBps = 0,
  vatFraction = 0,
}) {
  const itemsAfterDiscount =
    toNet(itemsAfterDiscountGross, vatFraction);

  const originalNet =
    toNet(itemsOriginalGross, vatFraction);

  const platformDiscountNet =
    toNet(platformDiscountAmount, vatFraction);

  const commissionBase =
    itemsAfterDiscount;

  const commissionAmount =
    round2(
      (commissionBase * commissionBps) / 10000
    );

  /*
   * Comisionul standard, dacă nu ar exista niciun discount -
   * folosit doar intern, pentru a determina cât din discountul
   * finanțat de Artfest depășește ce Artfest ar fi oricum reținut.
   */
  const standardCommissionOnOriginal =
    round2(
      (originalNet * commissionBps) / 10000
    );

  /*
   * Cât primea vendorul sub regula anterioară (comision absorbit
   * de Artfest, floor la 0, doar pentru partea platform-funded).
   */
  const legacyVendorNet =
    round2(
      itemsAfterDiscount -
        Math.max(
          0,
          standardCommissionOnOriginal - platformDiscountNet
        )
    );

  const simpleVendorNet =
    round2(itemsAfterDiscount - commissionAmount);

  const platformSubsidyAmount =
    round2(
      Math.max(0, legacyVendorNet - simpleVendorNet)
    );

  const vendorNet =
    round2(simpleVendorNet + platformSubsidyAmount);

  const platformNet =
    round2(commissionAmount - platformSubsidyAmount);

  return {
    itemsAfterDiscount,
    commissionBase,
    commissionBps,
    commissionAmount,
    platformSubsidyAmount,
    vendorNet,
    platformNet,
  };
}
