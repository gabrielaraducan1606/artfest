// src/payments/marketplaceCalc.js

import {
  prisma,
} from "../db.js";
import {
  computeCommissionBreakdown,
  computeGroupedCommissionBreakdown,
} from "../services/commissionCalc.js";
import {
  getCampaignEligibilityInfoMap,
  splitItemsByCampaignEligibility,
} from "../services/campaignAttribution.js";

/* =========================================================
   Helpers
========================================================= */

function dec2(value) {
  return Number.parseFloat(
    Number(
      value || 0
    ).toFixed(2)
  );
}

function safeNumber(
  value,
  fallback = 0
) {
  const parsed =
    Number(value);

  return Number.isFinite(
    parsed
  )
    ? parsed
    : fallback;
}

/*
 * Acceptă:
 *
 * 19
 * "19"
 * "19%"
 * 0.19
 * "0.19"
 *
 * și returnează:
 *
 * 0.19
 */
function parseVatRateToFraction(
  vatRate
) {
  if (
    vatRate == null
  ) {
    return 0;
  }

  const raw =
    String(
      vatRate
    )
      .trim()
      .replace(
        "%",
        ""
      );

  const value =
    Number(raw);

  if (
    !Number.isFinite(
      value
    ) ||
    value < 0
  ) {
    return 0;
  }

  /*
   * 19 => 0.19
   */
  if (value > 1) {
    return (
      value /
      100
    );
  }

  /*
   * 0.19 => 0.19
   */
  return value;
}

/* =========================================================
   Plan activ vendor

   IMPORTANT:
   folosim aceeași logică de bază ca în vendorOrdersRoutes.

   Astfel evităm ca marketplaceCalc să creadă că vendorul
   are comision 0 doar pentru că nu găsește un plan "starter".
========================================================= */

export async function getActivePlanForVendor(
  vendorId
) {
  const now =
    new Date();

  /*
   * 1. Abonament activ sau trial activ.
   */
  const active =
    await prisma.vendorSubscription.findFirst({
      where: {
        vendorId,

        OR: [
          {
            status:
              "active",

            endAt: {
              gt:
                now,
            },
          },

          {
            trialEndsAt: {
              gt:
                now,
            },
          },
        ],
      },

      include: {
        plan:
          true,
      },

      orderBy: [
        {
          startAt:
            "desc",
        },

        {
          createdAt:
            "desc",
        },
      ],
    });

  if (
    active?.plan
  ) {
    return active.plan;
  }

  /*
   * 2. Dacă nu avem unul activ, folosim ultimul plan
   * asociat vendorului.
   *
   * Este util pentru vendorii vechi sau pentru situații
   * de migrare a sistemului de abonamente.
   */
  const latest =
    await prisma.vendorSubscription.findFirst({
      where: {
        vendorId,
      },

      include: {
        plan:
          true,
      },

      orderBy: {
        createdAt:
          "desc",
      },
    });

  if (
    latest?.plan
  ) {
    return latest.plan;
  }

  /*
   * 3. Încercăm planul Basic din DB.
   */
  const basic =
    await prisma.subscriptionPlan.findUnique({
      where: {
        code:
          "basic",
      },
    });

  if (basic) {
    return basic;
  }

  /*
   * 4. Fallback defensiv.
   *
   * Ideal acest caz să nu fie atins în producție.
   */
  return {
    code:
      "basic",

    name:
      "Basic",

    commissionBps:
      0,
  };
}

/* =========================================================
   VAT vendor map
========================================================= */

async function getVendorVatMap(
  vendorIds
) {
  if (
    !Array.isArray(
      vendorIds
    ) ||
    vendorIds.length ===
      0
  ) {
    return new Map();
  }

  const vendors =
    await prisma.vendor.findMany({
      where: {
        id: {
          in:
            vendorIds,
        },
      },

      select: {
        id:
          true,

        billing: {
          select: {
            vatStatus:
              true,

            vatRate:
              true,
          },
        },
      },
    });

  return new Map(
    vendors.map(
      (vendor) => {
        const vatStatus =
          vendor.billing
            ?.vatStatus ||
          null;

        const vatFraction =
          vatStatus ===
          "payer"
            ? parseVatRateToFraction(
                vendor.billing
                  ?.vatRate
              )
            : 0;

        return [
          String(
            vendor.id
          ),

          {
            vatStatus,
            vatFraction,
          },
        ];
      }
    )
  );
}

/* =========================================================
   COMPUTE ORDER SPLITS

   Reguli:

   - ShipmentItem.price = prețul efectiv plătit de client
     pentru o unitate, cu TVA inclus dacă vendorul este
     plătitor TVA.

   - Comisionul Artfest se calculează numai pe PRODUSE.

   - Comisionul nu se calculează pe transport.

   - Pentru vendor plătitor TVA:
       itemsNetExVat = gross / (1 + TVA)

   - Pentru vendor neplătitor TVA:
       itemsNetExVat = gross

========================================================= */

export async function computeOrderSplits(
  orderId
) {
  const order =
    await prisma.order.findUnique({
      // Pin explicit pe "query": cod de calcul comision/payout -
      // păstrăm strategia actuală, verificată în producție, chiar
      // dacă relațiile în sine (shipments -> items, fără paginare
      // nested) nu par riscante mecanic sub join.
      relationLoadStrategy: "query",

      where: {
        id:
          orderId,
      },

      include: {
        shipments: {
          include: {
            items:
              true,
          },
        },
      },
    });

  if (!order) {
    throw new Error(
      "order_not_found"
    );
  }

  const shipments =
    Array.isArray(
      order.shipments
    )
      ? order.shipments
      : [];

  const vendorIds =
    Array.from(
      new Set(
        shipments
          .map(
            (
              shipment
            ) =>
              shipment
                ?.vendorId
                ? String(
                    shipment.vendorId
                  )
                : null
          )
          .filter(
            Boolean
          )
      )
    );

  const vatByVendor =
    await getVendorVatMap(
      vendorIds
    );

  /*
   * Comision MIXT per item (audit 2026-09-14, lifecycle
   * VendorCampaign) - identic cu COD (computeVendorEarningForShipment):
   * doar itemii efectiv eligibili campaniei (scope ALL_PRODUCTS vs
   * SELECTED_PRODUCTS) beneficiază de comisionul redus, restul rămân
   * pe comisionul standard al planului. Batch pe toate campaignId-urile
   * din comandă, o singură interogare, nu una per shipment.
   */
  const orderCampaignIds =
    Array.from(
      new Set(
        shipments
          .map((s) => (s?.campaignId ? String(s.campaignId) : null))
          .filter(Boolean)
      )
    );

  const campaignEligibilityByCampaignId =
    await getCampaignEligibilityInfoMap(orderCampaignIds);

  const byVendor =
    new Map();

  /* =======================================================
     Calcul gross/net per shipment
  ======================================================= */

  for (
    const shipment of
    shipments
  ) {
    if (
      !shipment
        ?.vendorId
    ) {
      continue;
    }

    const vendorId =
      String(
        shipment.vendorId
      );

    const vatInfo =
      vatByVendor.get(
        vendorId
      ) || {
        vatStatus:
          null,

        vatFraction:
          0,
      };

    const vatFraction =
      safeNumber(
        vatInfo
          .vatFraction,
        0
      );

    /* -----------------------------------------------------
       Produse
    ----------------------------------------------------- */

    const shipmentItems =
      Array.isArray(
        shipment.items
      )
        ? shipment.items
        : [];

    const itemsGross =
      dec2(
        shipmentItems.reduce(
          (
            total,
            item
          ) => {
            const price =
              safeNumber(
                item
                  ?.price,
                0
              );

            const qty =
              safeNumber(
                item?.qty,
                0
              );

            return (
              total +
              price *
                qty
            );
          },
          0
        )
      );

    const itemsNetExVat =
      vatFraction >
      0
        ? dec2(
            itemsGross /
              (
                1 +
                vatFraction
              )
          )
        : itemsGross;

    const itemsVat =
      dec2(
        itemsGross -
          itemsNetExVat
      );

    /*
     * Reducerile pe surse - aceleași câmpuri ShipmentItem
     * folosite deja de COD (computeVendorEarningForShipment).
     * Prețul original se reconstituie din prețul plătit +
     * ambele reduceri, la fel ca în COD - evită orice
     * discrepanță de rotunjire față de originalPrice per-unit.
     */
    const platformDiscountGross =
      dec2(
        shipmentItems.reduce(
          (total, item) =>
            total +
            safeNumber(item?.platformDiscountAmount, 0),
          0
        )
      );

    const vendorDiscountGross =
      dec2(
        shipmentItems.reduce(
          (total, item) =>
            total +
            safeNumber(item?.vendorDiscountAmount, 0),
          0
        )
      );

    const itemsOriginalGross =
      dec2(
        itemsGross +
          platformDiscountGross +
          vendorDiscountGross
      );

    /* -----------------------------------------------------
       Transport

       În logica actuală:
       transportul aparține vendorului,
       dar NU intră în baza comisionului Artfest.
    ----------------------------------------------------- */

    const shippingGross =
      dec2(
        safeNumber(
          shipment.price,
          0
        )
      );

    const shippingNetExVat =
      vatFraction >
      0
        ? dec2(
            shippingGross /
              (
                1 +
                vatFraction
              )
          )
        : shippingGross;

    const shippingVat =
      dec2(
        shippingGross -
          shippingNetExVat
      );

    /* -----------------------------------------------------
       Inițializare vendor
    ----------------------------------------------------- */

    if (
      !byVendor.has(
        vendorId
      )
    ) {
      byVendor.set(
        vendorId,
        {
          vendorId,

          vatStatus:
            vatInfo
              .vatStatus,

          vatFraction,

          /*
           * Produse
           */
          itemsGross:
            0,

          itemsNetExVat:
            0,

          itemsVat:
            0,

          itemsOriginalGross:
            0,

          platformDiscountGross:
            0,

          vendorDiscountGross:
            0,

          /*
           * Transport
           */
          shippingGross:
            0,

          shippingNetExVat:
            0,

          shippingVat:
            0,

          /*
           * Comision de campanie (override), dacă
           * shipment-urile acestui vendor din comandă
           * au fost create cu o atribuire de campanie
           * validă. Toate shipment-urile aceluiași
           * vendor dintr-o comandă primesc aceeași
           * atribuire (per vendor, nu per serviciu) -
           * așa că e sigur să reținem prima valoare
           * nenulă întâlnită.
           */
          campaignCommissionBps:
            null,

          campaignId:
            null,

          /*
           * Comision MIXT per item (audit 2026-09-14) - acumulatoare
           * SEPARATE de itemsGross/itemsOriginalGross/... de mai sus
           * (alea rămân totalul brut, neschimbat, folosit pentru
           * totaluri comandă/Stripe fee). Astea sunt DOAR pentru
           * calculul comisionului: grup "campaign" = itemii eligibili
           * campaniei (comision redus), grup "standard" = restul
           * (comision standard al planului).
           */
          commissionGroups: {
            campaign: {
              itemsGross: 0,
              itemsOriginalGross: 0,
              platformDiscountGross: 0,
              itemCount: 0,
            },

            standard: {
              itemsGross: 0,
              itemsOriginalGross: 0,
              platformDiscountGross: 0,
              itemCount: 0,
            },
          },
        }
      );
    }

    const vendorRow =
      byVendor.get(
        vendorId
      );

    if (
      vendorRow.campaignCommissionBps ===
        null &&
      shipment.campaignCommissionBps !==
        null &&
      shipment.campaignCommissionBps !==
        undefined
    ) {
      vendorRow.campaignCommissionBps =
        Number(
          shipment.campaignCommissionBps
        );

      vendorRow.campaignId =
        shipment.campaignId ||
        null;
    }

    /*
     * Acumulare per grup de eligibilitate (audit 2026-09-14) - vezi
     * comentariul de la inițializarea commissionGroups. NU afectează
     * vendorRow.itemsGross/... de mai jos (rămân totalul brut real,
     * neschimbat).
     */
    const shipmentHasCampaignCommission =
      shipment.campaignCommissionBps !== null &&
      shipment.campaignCommissionBps !== undefined;

    if (shipmentHasCampaignCommission) {
      const eligibilityInfo =
        campaignEligibilityByCampaignId.get(
          String(shipment.campaignId || "")
        ) || null;

      const { eligible, standard } =
        splitItemsByCampaignEligibility(
          shipmentItems,
          eligibilityInfo
        );

      for (const [subset, bucket] of [
        [eligible, vendorRow.commissionGroups.campaign],
        [standard, vendorRow.commissionGroups.standard],
      ]) {
        const subsetItemsGross = dec2(
          subset.reduce(
            (total, item) =>
              total +
              safeNumber(item?.price, 0) *
                safeNumber(item?.qty, 0),
            0
          )
        );

        const subsetPlatformDiscountGross = dec2(
          subset.reduce(
            (total, item) =>
              total + safeNumber(item?.platformDiscountAmount, 0),
            0
          )
        );

        const subsetVendorDiscountGross = dec2(
          subset.reduce(
            (total, item) =>
              total + safeNumber(item?.vendorDiscountAmount, 0),
            0
          )
        );

        const subsetOriginalGross = dec2(
          subsetItemsGross +
            subsetPlatformDiscountGross +
            subsetVendorDiscountGross
        );

        bucket.itemsGross = dec2(bucket.itemsGross + subsetItemsGross);
        bucket.itemsOriginalGross = dec2(
          bucket.itemsOriginalGross + subsetOriginalGross
        );
        bucket.platformDiscountGross = dec2(
          bucket.platformDiscountGross + subsetPlatformDiscountGross
        );
        bucket.itemCount += subset.length;
      }
    } else {
      const bucket = vendorRow.commissionGroups.standard;

      bucket.itemsGross = dec2(bucket.itemsGross + itemsGross);
      bucket.itemsOriginalGross = dec2(
        bucket.itemsOriginalGross + itemsOriginalGross
      );
      bucket.platformDiscountGross = dec2(
        bucket.platformDiscountGross + platformDiscountGross
      );
      bucket.itemCount += shipmentItems.length;
    }

    vendorRow.itemsGross =
      dec2(
        vendorRow
          .itemsGross +
          itemsGross
      );

    vendorRow.itemsNetExVat =
      dec2(
        vendorRow
          .itemsNetExVat +
          itemsNetExVat
      );

    vendorRow.itemsVat =
      dec2(
        vendorRow
          .itemsVat +
          itemsVat
      );

    vendorRow.itemsOriginalGross =
      dec2(
        vendorRow
          .itemsOriginalGross +
          itemsOriginalGross
      );

    vendorRow.platformDiscountGross =
      dec2(
        vendorRow
          .platformDiscountGross +
          platformDiscountGross
      );

    vendorRow.vendorDiscountGross =
      dec2(
        vendorRow
          .vendorDiscountGross +
          vendorDiscountGross
      );

    vendorRow.shippingGross =
      dec2(
        vendorRow
          .shippingGross +
          shippingGross
      );

    vendorRow.shippingNetExVat =
      dec2(
        vendorRow
          .shippingNetExVat +
          shippingNetExVat
      );

    vendorRow.shippingVat =
      dec2(
        vendorRow
          .shippingVat +
          shippingVat
      );
  }

  const vendors =
    Array.from(
      byVendor.values()
    );

  /* =======================================================
     Comision Artfest per vendor
  ======================================================= */

  for (
    const vendor of
    vendors
  ) {
    const plan =
      await getActivePlanForVendor(
        vendor.vendorId
      );

    let commissionBps =
      safeNumber(
        plan
          ?.commissionBps,
        0
      );

    if (
      commissionBps <
      0
    ) {
      commissionBps =
        0;
    }

    vendor.planCode =
      plan?.code ||
      "basic";

    vendor.planName =
      plan?.name ||
      "Basic";

    /*
     * IMPORTANT (audit 2026-09-14, lifecycle VendorCampaign):
     *
     * Comision Artfest - sursă unică (commissionCalc.js), identică cu
     * COD (computeVendorEarningForShipment) și cu Order Details
     * vendor - inclusiv comision MIXT: grupul "campaign" (itemii
     * efectiv eligibili campaniei atașate, comision redus) și grupul
     * "standard" (restul, comisionul planului). Simpla existență a
     * atribuirii de campanie (vendor.campaignCommissionBps) NU mai
     * acordă 5% pe tot vendorul - vezi commissionGroups, acumulat
     * per item mai sus, în bucla de shipment-uri.
     *
     * doar produse, fără transport
     * x preț NET după discount, fără TVA
     * x comisionul efectiv per grup (plan sau campanie)
     *
     * Pentru discounturi finanțate de Artfest (Collection /
     * Product of the Day / Artisan of the Week) se adaugă
     * separat platformSubsidyAmount, astfel încât vendorul să
     * nu piardă suma pe care Artfest o subvenționează.
     * commissionNet = platformNet (ce reține EFECTIV Artfest,
     * după subvenție) - asta e cifra corectă de facturat.
     */
    const campaignBucket =
      vendor.commissionGroups.campaign;

    const standardBucket =
      vendor.commissionGroups.standard;

    const grouped =
      computeGroupedCommissionBreakdown([
        {
          label: "campaign",
          commissionBps: safeNumber(vendor.campaignCommissionBps, 0),
          itemCount: campaignBucket.itemCount,
          itemsOriginalGross: campaignBucket.itemsOriginalGross,
          itemsAfterDiscountGross: campaignBucket.itemsGross,
          platformDiscountAmount: campaignBucket.platformDiscountGross,
          vatFraction: vendor.vatFraction,
        },
        {
          label: "plan",
          commissionBps,
          itemCount: standardBucket.itemCount,
          itemsOriginalGross: standardBucket.itemsOriginalGross,
          itemsAfterDiscountGross: standardBucket.itemsGross,
          platformDiscountAmount: standardBucket.platformDiscountGross,
          vatFraction: vendor.vatFraction,
        },
      ]);

    /*
     * Fallback IDENTIC cu COD (computeVendorEarningForShipment) pentru
     * cazul non-mixt: campania (dacă există atribuire), altfel planul.
     * Doar cosmetic/reprezentativ - UI-ul ignoră acest câmp complet
     * când isMixedCommission=true (vezi commissionGroups), dar trebuie
     * să rămână identic între COD și CARD pentru același shipment.
     */
    const hasCampaignCommission =
      vendor.campaignCommissionBps !== null &&
      vendor.campaignCommissionBps !== undefined;

    const fallbackCommissionBps =
      hasCampaignCommission
        ? Number(vendor.campaignCommissionBps)
        : commissionBps;

    vendor.commissionBps =
      grouped.commissionBps != null
        ? grouped.commissionBps
        : fallbackCommissionBps;

    vendor.commissionSource =
      grouped.commissionSource || "plan";

    /*
     * true DOAR când vendorul are itemi pe DOUĂ commissionBps
     * diferite în aceeași comandă (parte eligibili campanie, parte
     * pe planul standard) - vezi vendor.commissionGroups pentru
     * defalcarea reală.
     */
    vendor.isMixedCommission =
      grouped.isMixed;

    /*
     * Suprascriem acumulatorul intern {campaign, standard} (folosit
     * doar pentru calcul, în bucla de mai sus) cu defalcarea FINALĂ
     * per grup - aceeași formă ca `commissionGroups` din COD
     * (computeVendorEarningForShipment/ensureSaleLedgerEntry), ca
     * ledger-ul CARD (stripeWebhookRoutes.js) și Order Details să
     * citească identic indiferent de metoda de plată.
     */
    vendor.commissionGroups =
      grouped.groups;

    vendor.commissionBase =
      grouped.commissionBase;

    vendor.commissionAmount =
      grouped.commissionAmount;

    vendor.platformSubsidyAmount =
      grouped.platformSubsidyAmount;

    vendor.platformNet =
      grouped.platformNet;

    vendor.vendorNet =
      grouped.vendorNet;

    vendor.commissionNet =
      grouped.platformNet;
  }

  /* =======================================================
     Totaluri comandă
  ======================================================= */

  const totalItemsGross =
    dec2(
      vendors.reduce(
        (
          total,
          vendor
        ) =>
          total +
          safeNumber(
            vendor
              .itemsGross,
            0
          ),
        0
      )
    );

  const totalShippingGross =
    dec2(
      vendors.reduce(
        (
          total,
          vendor
        ) =>
          total +
          safeNumber(
            vendor
              .shippingGross,
            0
          ),
        0
      )
    );

  const totalGross =
    dec2(
      totalItemsGross +
        totalShippingGross
    );

  const totalCommissionNet =
    dec2(
      vendors.reduce(
        (
          total,
          vendor
        ) =>
          total +
          safeNumber(
            vendor
              .commissionNet,
            0
          ),
        0
      )
    );

  return {
    order: {
      id:
        order.id,

      currency:
        order.currency ||
        "RON",

      totalGross,

      totalItemsGross,

      totalShippingGross,

      totalCommissionNet,
    },

    vendors,
  };
}

/* =========================================================
   ALLOCATE STRIPE FEE

   Se folosește pentru plata integrală a unei comenzi.

   Stripe percepe fee o singură dată pentru charge.

   Îl împărțim între vendori proporțional cu valoarea lor
   brută din comandă:

   produse + transport.
========================================================= */

export function allocateStripeFee({
  vendors,
  feeNet,
}) {
  const safeVendors =
    Array.isArray(
      vendors
    )
      ? vendors
      : [];

  const totalFee =
    dec2(
      feeNet
    );

  if (
    totalFee <=
      0 ||
    safeVendors.length ===
      0
  ) {
    return safeVendors.map(
      (vendor) => ({
        ...vendor,

        stripeFeeAllocated:
          0,
      })
    );
  }

  const weights =
    safeVendors.map(
      (vendor) => {
        const gross =
          dec2(
            safeNumber(
              vendor
                .itemsGross,
              0
            ) +
              safeNumber(
                vendor
                  .shippingGross,
                0
              )
          );

        return {
          vendorId:
            vendor
              .vendorId,

          gross,
        };
      }
    );

  const totalGross =
    dec2(
      weights.reduce(
        (
          total,
          weight
        ) =>
          total +
          weight.gross,
        0
      )
    );

  if (
    totalGross <=
    0
  ) {
    return safeVendors.map(
      (vendor) => ({
        ...vendor,

        stripeFeeAllocated:
          0,
      })
    );
  }

  let allocated =
    0;

  return safeVendors.map(
    (
      vendor,
      index
    ) => {
      const gross =
        dec2(
          safeNumber(
            vendor
              .itemsGross,
            0
          ) +
            safeNumber(
              vendor
                .shippingGross,
              0
            )
        );

      let part =
        0;

      /*
       * Ultimul vendor primește diferența de rotunjire,
       * astfel încât suma totală alocată să fie exact feeNet.
       */
      if (
        index <
        safeVendors.length -
          1
      ) {
        part =
          dec2(
            (
              totalFee *
              gross
            ) /
              totalGross
          );

        allocated =
          dec2(
            allocated +
              part
          );
      } else {
        part =
          dec2(
            totalFee -
              allocated
          );
      }

      return {
        ...vendor,

        stripeFeeAllocated:
          part,
      };
    }
  );
}

/* =========================================================
   COMPUTE VENDOR PAYOUTS

   Plata integrală cu cardul:

   vendor payout =
       produse gross
     + transport gross
     - comision Artfest
     - Stripe fee alocat
========================================================= */

export function computeVendorPayouts({
  vendors,
}) {
  const safeVendors =
    Array.isArray(
      vendors
    )
      ? vendors
      : [];

  return safeVendors.map(
    (vendor) => {
      const gross =
        dec2(
          safeNumber(
            vendor
              .itemsGross,
            0
          ) +
            safeNumber(
              vendor
                .shippingGross,
              0
            )
        );

      const commissionNet =
        dec2(
          safeNumber(
            vendor
              .commissionNet,
            0
          )
        );

      const stripeFeeAllocated =
        dec2(
          safeNumber(
            vendor
              .stripeFeeAllocated,
            0
          )
        );

      /*
       * MODEL B (decizie business, 2026-09-06) - comisionul Artfest NU
       * se mai reține din payout-ul vendorului la transferul Stripe
       * Connect; rămâne DOAR calculat/salvat (vezi `commissionNet` mai
       * jos, neschimbat) pentru facturarea lunară (CARD + COD,
       * aceeași regulă). Singura deducere reală din transfer rămâne
       * taxa Stripe. Motivul schimbării: comisionul dedus aici risca
       * să fie facturat A DOUA OARĂ de generatorul lunar de facturi
       * (create-vendor-commission-invoice), care nu exclude entry-urile
       * deja decontate prin transfer - vezi auditul din 2026-09-06.
       */
      const vendorPayoutNet =
        dec2(
          Math.max(
            0,

            gross -
              stripeFeeAllocated
          )
        );

      return {
        ...vendor,

        gross,

        commissionNet,

        stripeFeeAllocated,

        vendorPayoutNet,
      };
    }
  );
}