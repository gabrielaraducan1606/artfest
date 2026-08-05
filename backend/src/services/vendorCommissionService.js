// backend/src/services/vendorCommissionService.js

/* =========================================================
   HELPERS
========================================================= */

function normalizeCents(
  value
) {
  const numericValue =
    Number(value);

  if (
    !Number.isFinite(
      numericValue
    )
  ) {
    return 0;
  }

  return Math.max(
    0,
    Math.round(
      numericValue
    )
  );
}

function normalizeQuantity(
  value
) {
  const numericValue =
    Number.parseInt(
      value,
      10
    );

  if (
    !Number.isFinite(
      numericValue
    ) ||
    numericValue <= 0
  ) {
    return 1;
  }

  return Math.min(
    100000,
    numericValue
  );
}

function normalizeCommissionBps(
  value
) {
  const numericValue =
    Number(value);

  if (
    !Number.isFinite(
      numericValue
    )
  ) {
    return 0;
  }

  /*
   * 10.000 bps = 100%.
   */
  return Math.min(
    10000,
    Math.max(
      0,
      Math.round(
        numericValue
      )
    )
  );
}

function normalizePercent(
  value
) {
  const numericValue =
    Number(value);

  if (
    !Number.isFinite(
      numericValue
    )
  ) {
    return 0;
  }

  return Math.min(
    100,
    Math.max(
      0,
      Math.round(
        numericValue
      )
    )
  );
}

function centsToMoney(
  cents
) {
  return (
    normalizeCents(
      cents
    ) / 100
  );
}

/* =========================================================
   ÎMPĂRȚIREA REDUCERII
========================================================= */

/**
 * Împarte reducerea totală între:
 *
 * - Artfest;
 * - vendor.
 *
 * Folosim diferența reală dintre prețul inițial
 * și prețul final pentru a evita diferențele
 * cauzate de rotunjire.
 */
function splitDiscountAmounts({
  originalUnitPriceCents,
  finalUnitPriceCents,
  platformDiscountPercent,
  vendorDiscountPercent,
  platformDiscountAmountCents,
  vendorDiscountAmountCents,
}) {
  const original =
    normalizeCents(
      originalUnitPriceCents
    );

  const final =
    Math.min(
      original,
      normalizeCents(
        finalUnitPriceCents
      )
    );

  const totalDiscountAmountCents =
    Math.max(
      0,
      original - final
    );

  /*
   * Dacă serviciul de pricing a trimis deja
   * sumele exacte, le folosim.
   */
  const explicitPlatformAmount =
    normalizeCents(
      platformDiscountAmountCents
    );

  const explicitVendorAmount =
    normalizeCents(
      vendorDiscountAmountCents
    );

  if (
    explicitPlatformAmount > 0 ||
    explicitVendorAmount > 0
  ) {
    const explicitTotal =
      explicitPlatformAmount +
      explicitVendorAmount;

    /*
     * Dacă totalul explicit este mai mare decât
     * reducerea reală, îl limităm proporțional.
     */
    if (
      explicitTotal >
        totalDiscountAmountCents &&
      explicitTotal > 0
    ) {
      const platformShare =
        explicitPlatformAmount /
        explicitTotal;

      const normalizedPlatformAmount =
        Math.round(
          totalDiscountAmountCents *
            platformShare
        );

      const normalizedVendorAmount =
        totalDiscountAmountCents -
        normalizedPlatformAmount;

      return {
        totalDiscountAmountCents,

        platformDiscountAmountCents:
          normalizedPlatformAmount,

        vendorDiscountAmountCents:
          normalizedVendorAmount,
      };
    }

    /*
     * Orice diferență de rotunjire rămasă
     * este atribuită Artfestului.
     */
    const remainder =
      Math.max(
        0,
        totalDiscountAmountCents -
          explicitTotal
      );

    return {
      totalDiscountAmountCents,

      platformDiscountAmountCents:
        explicitPlatformAmount +
        remainder,

      vendorDiscountAmountCents:
        explicitVendorAmount,
    };
  }

  const platformPercent =
    normalizePercent(
      platformDiscountPercent
    );

  const vendorPercent =
    normalizePercent(
      vendorDiscountPercent
    );

  const combinedPercent =
    platformPercent +
    vendorPercent;

  if (
    totalDiscountAmountCents <= 0 ||
    combinedPercent <= 0
  ) {
    return {
      totalDiscountAmountCents,

      platformDiscountAmountCents:
        0,

      vendorDiscountAmountCents:
        0,
    };
  }

  /*
   * Împărțim diferența reală de preț
   * proporțional cu procentele.
   */
  const platformShare =
    platformPercent /
    combinedPercent;

  const calculatedPlatformAmount =
    Math.round(
      totalDiscountAmountCents *
        platformShare
    );

  const calculatedVendorAmount =
    totalDiscountAmountCents -
    calculatedPlatformAmount;

  return {
    totalDiscountAmountCents,

    platformDiscountAmountCents:
      calculatedPlatformAmount,

    vendorDiscountAmountCents:
      calculatedVendorAmount,
  };
}

/* =========================================================
   CALCUL FINANCIAR PENTRU O LINIE
========================================================= */

/**
 * Calculează:
 *
 * - suma plătită de client;
 * - reducerea Artfest;
 * - reducerea vendorului;
 * - comisionul standard;
 * - comisionul final Artfest;
 * - suma vendorului.
 *
 * Toate calculele interne sunt în bani.
 */
export function calculateVendorLineFinancials({
  originalUnitPriceCents,
  finalUnitPriceCents,

  quantity = 1,

  commissionBps = 0,

  platformDiscountPercent = 0,
  vendorDiscountPercent = 0,

  platformDiscountAmountCents,
  vendorDiscountAmountCents,
}) {
  const qty =
    normalizeQuantity(
      quantity
    );

  const originalUnit =
    normalizeCents(
      originalUnitPriceCents
    );

  const finalUnit =
    Math.min(
      originalUnit,
      normalizeCents(
        finalUnitPriceCents
      )
    );

  const normalizedCommissionBps =
    normalizeCommissionBps(
      commissionBps
    );

  const unitDiscounts =
    splitDiscountAmounts({
      originalUnitPriceCents:
        originalUnit,

      finalUnitPriceCents:
        finalUnit,

      platformDiscountPercent,

      vendorDiscountPercent,

      platformDiscountAmountCents,

      vendorDiscountAmountCents,
    });

  const originalLineTotalCents =
    originalUnit * qty;

  const finalLineTotalCents =
    finalUnit * qty;

  const totalDiscountAmountCents =
    unitDiscounts
      .totalDiscountAmountCents *
    qty;

  const platformDiscountAmountLineCents =
    unitDiscounts
      .platformDiscountAmountCents *
    qty;

  const vendorDiscountAmountLineCents =
    unitDiscounts
      .vendorDiscountAmountCents *
    qty;

  /*
   * Comisionul standard este calculat din
   * valoarea inițială a produselor.
   *
   * Exemplu:
   * 100 lei × 12% = 12 lei.
   */
  const standardCommissionCents =
    Math.round(
      originalLineTotalCents *
        normalizedCommissionBps /
        10000
    );

  /*
   * Reducerea Artfest se scade din comision.
   *
   * Comisionul nu poate deveni negativ.
   */
  const finalCommissionCents =
    Math.max(
      0,
      standardCommissionCents -
        platformDiscountAmountLineCents
    );

  /*
   * Clientul plătește prețul final.
   * Din el se reține comisionul final Artfest.
   */
  const vendorNetCents =
    Math.max(
      0,
      finalLineTotalCents -
        finalCommissionCents
    );

  return {
    quantity:
      qty,

    commissionBps:
      normalizedCommissionBps,

    originalUnitPriceCents:
      originalUnit,

    finalUnitPriceCents:
      finalUnit,

    originalLineTotalCents,

    finalLineTotalCents,

    totalDiscountAmountCents,

    platformDiscountAmountCents:
      platformDiscountAmountLineCents,

    vendorDiscountAmountCents:
      vendorDiscountAmountLineCents,

    standardCommissionCents,

    finalCommissionCents,

    vendorNetCents,

    /*
     * Aliasuri în lei, pentru modelele Prisma
     * care folosesc Decimal în loc de bani.
     */
    originalUnitPrice:
      centsToMoney(
        originalUnit
      ),

    finalUnitPrice:
      centsToMoney(
        finalUnit
      ),

    originalLineTotal:
      centsToMoney(
        originalLineTotalCents
      ),

    finalLineTotal:
      centsToMoney(
        finalLineTotalCents
      ),

    totalDiscountAmount:
      centsToMoney(
        totalDiscountAmountCents
      ),

    platformDiscountAmount:
      centsToMoney(
        platformDiscountAmountLineCents
      ),

    vendorDiscountAmount:
      centsToMoney(
        vendorDiscountAmountLineCents
      ),

    standardCommission:
      centsToMoney(
        standardCommissionCents
      ),

    finalCommission:
      centsToMoney(
        finalCommissionCents
      ),

    vendorNet:
      centsToMoney(
        vendorNetCents
      ),
  };
}

/* =========================================================
   CALCUL PENTRU MAI MULTE LINII
========================================================= */

export function calculateVendorOrderFinancials({
  items = [],
  commissionBps = 0,
}) {
  const normalizedItems =
    Array.isArray(
      items
    )
      ? items
      : [];

  const lines =
    normalizedItems.map(
      (item) =>
        calculateVendorLineFinancials({
          originalUnitPriceCents:
            item.originalUnitPriceCents ??
            item.originalPriceCents ??
            Math.round(
              Number(
                item.originalPrice ??
                  item.price ??
                  0
              ) * 100
            ),

          finalUnitPriceCents:
            item.finalUnitPriceCents ??
            item.finalPriceCents ??
            item.priceCents ??
            Math.round(
              Number(
                item.finalPrice ??
                  item.price ??
                  0
              ) * 100
            ),

          quantity:
            item.quantity ??
            item.qty ??
            1,

          commissionBps:
            item.commissionBps ??
            commissionBps,

          platformDiscountPercent:
            item.platformDiscountPercent ??
            0,

          vendorDiscountPercent:
            item.vendorDiscountPercent ??
            0,

          platformDiscountAmountCents:
            item.platformDiscountAmountCents,

          vendorDiscountAmountCents:
            item.vendorDiscountAmountCents,
        })
    );

  const totals =
    lines.reduce(
      (result, line) => {
        result.originalItemsTotalCents +=
          line.originalLineTotalCents;

        result.finalItemsTotalCents +=
          line.finalLineTotalCents;

        result.totalDiscountAmountCents +=
          line.totalDiscountAmountCents;

        result.platformDiscountAmountCents +=
          line.platformDiscountAmountCents;

        result.vendorDiscountAmountCents +=
          line.vendorDiscountAmountCents;

        result.standardCommissionCents +=
          line.standardCommissionCents;

        result.finalCommissionCents +=
          line.finalCommissionCents;

        result.vendorNetCents +=
          line.vendorNetCents;

        return result;
      },
      {
        originalItemsTotalCents:
          0,

        finalItemsTotalCents:
          0,

        totalDiscountAmountCents:
          0,

        platformDiscountAmountCents:
          0,

        vendorDiscountAmountCents:
          0,

        standardCommissionCents:
          0,

        finalCommissionCents:
          0,

        vendorNetCents:
          0,
      }
    );

  return {
    lines,

    ...totals,

    originalItemsTotal:
      centsToMoney(
        totals.originalItemsTotalCents
      ),

    finalItemsTotal:
      centsToMoney(
        totals.finalItemsTotalCents
      ),

    totalDiscountAmount:
      centsToMoney(
        totals.totalDiscountAmountCents
      ),

    platformDiscountAmount:
      centsToMoney(
        totals.platformDiscountAmountCents
      ),

    vendorDiscountAmount:
      centsToMoney(
        totals.vendorDiscountAmountCents
      ),

    standardCommission:
      centsToMoney(
        totals.standardCommissionCents
      ),

    finalCommission:
      centsToMoney(
        totals.finalCommissionCents
      ),

    vendorNet:
      centsToMoney(
        totals.vendorNetCents
      ),
  };
}

/* =========================================================
   ADAPTOR PENTRU PRICING SERVICE
========================================================= */

/**
 * Primește direct rezultatul întors de:
 *
 * getPromotionPricingForProduct()
 *
 * sau:
 *
 * getPromotionPricingForProducts()
 */
export function calculateFinancialsFromPromotionPricing({
  pricing,
  quantity = 1,
  commissionBps = 0,
}) {
  const safePricing =
    pricing || {};

  return calculateVendorLineFinancials({
    originalUnitPriceCents:
      safePricing
        .originalPriceCents,

    finalUnitPriceCents:
      safePricing
        .finalPriceCents,

    quantity,

    commissionBps,

    platformDiscountPercent:
      safePricing
        .platformDiscountPercent,

    vendorDiscountPercent:
      safePricing
        .vendorDiscountPercent,

    platformDiscountAmountCents:
      safePricing
        .platformDiscountAmountCents,

    vendorDiscountAmountCents:
      safePricing
        .vendorDiscountAmountCents,
  });
}