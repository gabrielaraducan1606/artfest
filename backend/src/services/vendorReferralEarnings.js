// backend/src/services/vendorReferralEarnings.js

/*
 * Agregate de câștig REFERRAL VENDOR - mirror STRUCTURAL al
 * influencerEarnings.js (aceleași 4 funcții, adaptate la
 * VendorReferralEarningEntry / Shipment.referrerVendor* în loc de
 * InfluencerEarningEntry / Shipment.influencer*).
 *
 * NU recalculează comisionul Artfest - "confirmat" citește STRICT
 * din VendorReferralEarningEntry (deja creat de
 * ensureVendorReferralSaleLedgerEntry/ensureVendorReferralRefundLedgerEntry
 * din vendorOrdersRoutes.js, la ACELAȘI trigger ca vendorul/influencerul).
 * "Estimat" reutilizează computeVendorEarningForShipment (sursa unică
 * de adevăr a comisionului Artfest), fără să inventeze un calculator
 * paralel.
 *
 * IMPORTANT: funcțiile de mai sus (getVendorReferral... /
 * listVendorReferralAttributedOrders) NU includ vânzările "own-sale"
 * (vendorul își promovează propriul produs) - acelea NU au
 * referrerVendorId setat (vezi buildShipmentAttributionFields din
 * chekoutRoutes.js) și deci nu apar niciodată în ele. Impactul lor
 * (comisionul Artfest redus la 5%) se vede în earning-ul normal al
 * vendorului (VendorEarningEntry) - funcțiile getVendorOwnSale... /
 * listVendorOwnSaleAttributedOrders de mai jos agregă STRICT acele
 * vânzări, separat, pentru afișare în tab-ul "Recomandări" (audit
 * 2026-09-14: cardurile de overview ignorau own-sale-urile, deși
 * "Activitate recentă" le afișa deja).
 *
 * Semantică IMPORTANTĂ, cerută explicit: pentru own-sale NU există un
 * "câștig" plătit separat - vendorul își vinde propriul produs, iar
 * singurul avantaj e comisionul Artfest REDUS (VENDOR_REFERRAL_OWN_SALE_COMMISSION_BPS
 * în loc de comisionul standard al planului). De aceea funcțiile de
 * mai jos NU întorc un "earningNet" ca la referral, ci un "benefitAmount" =
 * diferența (comisionul standard - comisionul redus efectiv reținut),
 * calculată STRICT cu computeCommissionBreakdown (aceeași formulă
 * unică, fără niciun calcul nou), aplicată o dată cu bps-ul standard al
 * planului vendorului și o dată cu bps-ul own-sale deja aplicat.
 */

import { prisma } from "../db.js";
import {
  computeVendorEarningForShipment,
  getActivePlanForVendor,
} from "../routes/vendorOrdersRoutes.js";
import { computeCommissionBreakdown } from "./commissionCalc.js";

/*
 * Statusuri de shipment care NU mai pot deveni o vânzare confirmată
 * - excluse din estimarea "live".
 */
const NON_ESTIMABLE_SHIPMENT_STATUSES = new Set(["REFUSED", "RETURNED"]);

/*
 * Sursa atribuirii pentru afișare UI (audit 2026-09-15, persistent
 * attribution VendorCollection) - PREFIX pe
 * referrerVendorReferralCodeSnapshot, NU egalitate strictă (vezi
 * marcajul scris în buildShipmentAttributionFields, chekoutRoutes.js).
 * Prioritate: DISCOUNT_CODE (a câștigat efectiv prețul) > COLLECTION
 * (atribuire prin vizitarea colecției, fără discount câștigat) >
 * REFERRAL (?ref= clasic).
 */
function resolveAttributionSource({ discountCodeItem, snapshot }) {
  if (discountCodeItem) {
    return { source: "DISCOUNT_CODE", collectionSlug: null };
  }

  if (
    typeof snapshot === "string" &&
    snapshot.startsWith("COLLECTION:")
  ) {
    return {
      source: "COLLECTION",
      collectionSlug: snapshot.slice("COLLECTION:".length) || null,
    };
  }

  return { source: "REFERRAL", collectionSlug: null };
}

/*
 * Beneficiul own-sale = diferența dintre comisionul STANDARD al
 * planului vendorului și comisionul EFECTIV reținut la bps-ul redus
 * (override own-sale) - calculată STRICT cu computeCommissionBreakdown
 * (aceeași formulă unică din commissionCalc.js, folosită și de
 * checkout/vendorOrdersRoutes.js), aplicată o dată cu bps-ul standard
 * și o dată cu bps-ul own-sale deja reținut. NU e un calculator nou -
 * doar diferența a două rulări ale aceleiași funcții.
 *
 * Componentele brute (commissionBaseGross/platformDiscountGross/
 * vendorDiscountGross/vatRate) sunt identice indiferent de bps - vin
 * fie din meta ledger-ului (VendorEarningEntry.meta, pentru vânzări
 * deja confirmate), fie din calculul live
 * (computeVendorEarningForShipment, pentru shipment-uri neledgerate
 * încă), care le expune deja pe amândouă.
 */
export function computeOwnSaleBenefit({
  commissionBaseGross,
  platformDiscountGross,
  vendorDiscountGross,
  vatRate,
  standardCommissionBps,
  actualCommissionNet,
}) {
  const subtotalGross =
    Number(commissionBaseGross || 0) -
    Number(platformDiscountGross || 0) -
    Number(vendorDiscountGross || 0);

  const vatFraction = Number(vatRate || 0) > 0 ? Number(vatRate) / 100 : 0;

  const standardBreakdown = computeCommissionBreakdown({
    itemsOriginalGross: commissionBaseGross,
    itemsAfterDiscountGross: subtotalGross,
    platformDiscountAmount: platformDiscountGross,
    commissionBps: standardCommissionBps,
    vatFraction,
  });

  return (
    Math.round(
      (standardBreakdown.platformNet - Number(actualCommissionNet || 0)) * 100
    ) / 100
  );
}

/**
 * Totaluri CONFIRMATE (deja în ledger), pentru un vendor promotor.
 */
export async function getVendorReferralConfirmedTotals(referrerVendorId) {
  const [salesAgg, allEntries] = await Promise.all([
    prisma.vendorReferralEarningEntry.aggregate({
      where: { referrerVendorId },

      _sum: {
        earningNet: true,
        eligibleItemsNet: true,
      },
    }),

    prisma.vendorReferralEarningEntry.findMany({
      where: { referrerVendorId },
      select: { type: true, orderId: true, shipmentId: true, meta: true },
    }),
  ]);

  const reversedShipmentIds = new Set(
    allEntries
      .filter((e) => e.type === "REFUND")
      .map((e) => e?.meta?.refShipmentId)
      .filter(Boolean)
  );

  const confirmedOrderIds = new Set(
    allEntries
      .filter(
        (e) =>
          e.type === "SALE" &&
          e.orderId &&
          e.shipmentId &&
          !reversedShipmentIds.has(e.shipmentId)
      )
      .map((e) => e.orderId)
  );

  return {
    ordersCount: confirmedOrderIds.size,
    salesAmount: Number(salesAgg._sum.eligibleItemsNet || 0),
    confirmedEarningsAmount: Number(salesAgg._sum.earningNet || 0),
  };
}

/**
 * Totaluri ATRIBUITE (pentru "Comenzi" și "Vânzări generate" din
 * dashboard) - reflectă atribuirea (?ref=/cod de vendor) imediat la
 * plasarea comenzii, nu doar shipment-urile deja confirmate.
 *
 * ordersCount = numărul de COMENZI DISTINCTE (Order.id) - o comandă
 * multi-vendor cu 2 shipment-uri atribuite ACELUIAȘI vendor promotor
 * trebuie să conteze o singură dată.
 *
 * salesAmount = valoarea comercială EFECTIVĂ (preț final plătit de
 * client, brut) a produselor din shipment-urile atribuite - exclude
 * REFUSED/RETURNED, identic cu influencerEarnings.js.
 */
export async function getVendorReferralAttributedTotals(referrerVendorId) {
  const [distinctOrders, shipmentItems] = await Promise.all([
    prisma.shipment.findMany({
      where: { referrerVendorId },
      select: { orderId: true },
      distinct: ["orderId"],
    }),

    prisma.shipmentItem.findMany({
      where: {
        shipment: {
          referrerVendorId,
          status: { notIn: Array.from(NON_ESTIMABLE_SHIPMENT_STATUSES) },
        },
      },

      select: {
        price: true,
        qty: true,
      },
    }),
  ]);

  const salesAmount =
    Math.round(
      shipmentItems.reduce(
        (sum, item) => sum + Number(item.price || 0) * Number(item.qty || 0),
        0
      ) * 100
    ) / 100;

  return {
    ordersCount: distinctOrders.length,
    salesAmount,
  };
}

/**
 * Câștig ESTIMAT (live, nepersistat) - shipment-uri atribuite
 * vendorului promotor care încă nu au ajuns la statusul care
 * creează ledger entry (DELIVERED/IN_TRANSIT) și nu au fost
 * refuzate/returnate.
 */
export async function getVendorReferralEstimatedEarnings(referrerVendorId) {
  const pendingShipments = await prisma.shipment.findMany({
    where: {
      referrerVendorId,
      status: { notIn: Array.from(NON_ESTIMABLE_SHIPMENT_STATUSES) },
      vendorReferralEarningEntry: null,
    },

    select: {
      id: true,
      vendorId: true,
      referrerVendorCommissionBpsSnapshot: true,
    },
  });

  let estimatedEarningsAmount = 0;

  for (const shipment of pendingShipments) {
    const commissionBpsSnapshot = Number(
      shipment.referrerVendorCommissionBpsSnapshot || 0
    );

    if (!commissionBpsSnapshot) continue;

    try {
      const earning = await computeVendorEarningForShipment({
        vendorId: shipment.vendorId,
        shipmentId: shipment.id,
      });

      estimatedEarningsAmount +=
        (Number(earning.commissionNet || 0) * commissionBpsSnapshot) / 10000;
    } catch {
      /*
       * Shipment fără iteme încă / date incomplete - îl sărim, nu
       * blocăm restul estimării.
       */
    }
  }

  return Math.round(estimatedEarningsAmount * 100) / 100;
}

/**
 * Lista de comenzi/shipment-uri atribuite vendorului promotor, FĂRĂ
 * nicio dată personală despre client.
 */
export async function listVendorReferralAttributedOrders({
  referrerVendorId,
  take = 20,
  skip = 0,
}) {
  const shipments = await prisma.shipment.findMany({
    where: { referrerVendorId },

    orderBy: { referrerVendorAttributedAt: "desc" },

    take,
    skip,

    select: {
      id: true,
      status: true,
      vendorId: true,
      referrerVendorAttributedAt: true,
      referrerVendorReferralCodeSnapshot: true,
      referrerVendorCommissionBpsSnapshot: true,
      createdAt: true,

      /*
       * Doar pentru afișare (numele vendorului CĂRUIA i s-a vândut
       * produsul, nu al vendorului promotor) - nu intră în niciun
       * calcul financiar.
       */
      vendor: {
        select: { displayName: true },
      },

      order: {
        select: {
          id: true,
          orderNumber: true,
          currency: true,
          createdAt: true,
        },
      },

      vendorReferralEarningEntry: {
        select: {
          type: true,
          eligibleItemsNet: true,
          artfestCommissionNet: true,
          earningNet: true,
          currency: true,
        },
      },

      items: {
        select: {
          discountCodeId: true,
          discountCodeText: true,
          platformDiscountAmount: true,
        },
      },
    },
  });

  const total = await prisma.shipment.count({
    where: { referrerVendorId },
  });

  const refunds = await prisma.vendorReferralEarningEntry.findMany({
    where: { referrerVendorId, type: "REFUND" },
    select: {
      meta: true,
      eligibleItemsNet: true,
      artfestCommissionNet: true,
      earningNet: true,
    },
  });

  const refundByShipmentId = new Map(
    refunds
      .filter((r) => r?.meta?.refShipmentId)
      .map((r) => [r.meta.refShipmentId, r])
  );

  const items = [];

  for (const shipment of shipments) {
    const confirmed = shipment.vendorReferralEarningEntry;
    const refund = confirmed ? refundByShipmentId.get(shipment.id) : null;

    let eligibleItemsNet = confirmed
      ? Number(confirmed.eligibleItemsNet || 0) +
        Number(refund?.eligibleItemsNet || 0)
      : null;

    let artfestCommissionNet = confirmed
      ? Number(confirmed.artfestCommissionNet || 0) +
        Number(refund?.artfestCommissionNet || 0)
      : null;

    let earningNet = confirmed
      ? Number(confirmed.earningNet || 0) + Number(refund?.earningNet || 0)
      : null;

    let earningStatus = confirmed ? (refund ? "REVERSED" : "CONFIRMED") : "PENDING";

    if (!confirmed && !NON_ESTIMABLE_SHIPMENT_STATUSES.has(shipment.status)) {
      try {
        const live = await computeVendorEarningForShipment({
          vendorId: shipment.vendorId,
          shipmentId: shipment.id,
        });

        const bps = Number(shipment.referrerVendorCommissionBpsSnapshot || 0);

        eligibleItemsNet = Number(live.itemsNet || 0);
        artfestCommissionNet = Number(live.commissionNet || 0);
        earningNet =
          Math.round(((artfestCommissionNet * bps) / 10000) * 100) / 100;
      } catch {
        earningStatus = "UNAVAILABLE";
      }
    } else if (
      !confirmed &&
      NON_ESTIMABLE_SHIPMENT_STATUSES.has(shipment.status)
    ) {
      earningStatus = "CANCELLED";
      eligibleItemsNet = 0;
      artfestCommissionNet = 0;
      earningNet = 0;
    }

    const discountCodeItem = (shipment.items || []).find(
      (it) => it.discountCodeId
    );

    const { source: attributionSource, collectionSlug } =
      resolveAttributionSource({
        discountCodeItem,
        snapshot: shipment.referrerVendorReferralCodeSnapshot,
      });

    /*
     * Reducere Artfest (audit 2026-09-14, secțiunea "UI recomandări" -
     * ALL_ARTFEST cross-vendor) - suma ShipmentItem.platformDiscountAmount,
     * un snapshot imuabil, corect indiferent de status (pending/
     * confirmat/reversat) - nu recalculăm nimic, doar afișăm cât a
     * susținut Artfest din prețul acestui shipment.
     */
    const platformDiscountGross =
      Math.round(
        (shipment.items || []).reduce(
          (sum, item) => sum + Number(item.platformDiscountAmount || 0),
          0
        ) * 100
      ) / 100;

    items.push({
      shipmentId: shipment.id,
      orderNumber: shipment.order?.orderNumber || null,
      createdAt: shipment.order?.createdAt || shipment.createdAt,

      vendorName: shipment.vendor?.displayName || null,

      status: shipment.status,
      earningStatus,

      attributionSource,
      collectionSlug,
      discountCodeText: discountCodeItem?.discountCodeText || null,
      attributedAt: shipment.referrerVendorAttributedAt,

      commissionBpsSnapshot: Number(
        shipment.referrerVendorCommissionBpsSnapshot || 0
      ),

      eligibleItemsNet,
      artfestCommissionNet,
      earningNet,
      platformDiscountGross,

      currency: confirmed?.currency || shipment.order?.currency || "RON",
    });
  }

  return { items, total };
}

/**
 * Lista de comenzi "own-sale" (vendorul și-a promovat PROPRIUL produs
 * prin propriul cod/link) - PENTRU AFIȘARE în tab-ul "Recomandări",
 * ca informare, NU ca un nou tip de câștig financiar.
 *
 * Reutilizează STRICT date deja persistate:
 * - Shipment.vendorReferralOwnSaleAttributedAt/
 *   vendorReferralCommissionOverrideBps (scrise de
 *   buildShipmentAttributionFields din chekoutRoutes.js);
 * - VendorEarningEntry (ledger-ul NORMAL al vendorului, deja creat de
 *   ensureSaleLedgerEntry/ensureRefundLedgerEntry pentru FIECARE
 *   shipment al vendorului, own-sale inclus - vezi comentariul din
 *   computeVendorEarningForShipment: comisionul redus la 5% e deja
 *   reflectat acolo, NU într-un ledger separat).
 *
 * NU recalculează niciun comision - "confirmat"/"reversat" citesc
 * STRICT din VendorEarningEntry deja existent; "estimat" reutilizează
 * computeVendorEarningForShipment (aceeași sursă unică de adevăr ca
 * la lista de mai sus).
 */
export async function listVendorOwnSaleAttributedOrders({
  vendorId,
  take = 20,
  skip = 0,
}) {
  const where = {
    vendorId,
    vendorReferralOwnSaleAttributedAt: { not: null },
  };

  const shipments = await prisma.shipment.findMany({
    where,

    orderBy: { vendorReferralOwnSaleAttributedAt: "desc" },

    take,
    skip,

    select: {
      id: true,
      status: true,
      vendorId: true,
      vendorReferralOwnSaleAttributedAt: true,
      vendorReferralCommissionOverrideBps: true,
      createdAt: true,

      vendor: {
        select: { displayName: true },
      },

      order: {
        select: {
          id: true,
          orderNumber: true,
          currency: true,
          createdAt: true,
        },
      },

      vendorEarningEntry: {
        select: {
          type: true,
          itemsNet: true,
          commissionNet: true,
          vendorNet: true,
          currency: true,
          meta: true,
        },
      },

      items: {
        select: {
          discountCodeId: true,
          discountCodeText: true,
        },
      },

      referrerVendorReferralCodeSnapshot: true,
    },
  });

  const total = await prisma.shipment.count({ where });

  const plan = await getActivePlanForVendor(vendorId);
  const standardCommissionBps = Number(plan?.commissionBps || 0);

  const refunds = await prisma.vendorEarningEntry.findMany({
    where: { vendorId, type: "REFUND" },
    select: {
      meta: true,
      itemsNet: true,
      commissionNet: true,
      vendorNet: true,
    },
  });

  const refundByShipmentId = new Map(
    refunds
      .filter((r) => r?.meta?.refShipmentId)
      .map((r) => [r.meta.refShipmentId, r])
  );

  const items = [];

  for (const shipment of shipments) {
    const confirmed = shipment.vendorEarningEntry;
    const refund = confirmed ? refundByShipmentId.get(shipment.id) : null;

    let eligibleItemsNet = confirmed
      ? Number(confirmed.itemsNet || 0) + Number(refund?.itemsNet || 0)
      : null;

    let artfestCommissionNet = confirmed
      ? Number(confirmed.commissionNet || 0) +
        Number(refund?.commissionNet || 0)
      : null;

    let vendorNet = confirmed
      ? Number(confirmed.vendorNet || 0) + Number(refund?.vendorNet || 0)
      : null;

    let earningStatus = confirmed ? (refund ? "REVERSED" : "CONFIRMED") : "PENDING";

    /*
     * Beneficiu (economie de comision), NU un câștig plătit separat -
     * vezi computeOwnSaleBenefit. O vânzare REVERSATĂ nu păstrează
     * niciun beneficiu (retur/refuz -> 0), la fel cum
     * eligibleItemsNet/artfestCommissionNet netuiesc deja la ~0 mai
     * sus.
     */
    let benefitAmount = null;

    if (confirmed && !refund) {
      const meta = confirmed.meta || {};

      benefitAmount = computeOwnSaleBenefit({
        commissionBaseGross: meta.commissionBaseGross,
        platformDiscountGross: meta.platformDiscountGross,
        vendorDiscountGross: meta.vendorDiscountGross,
        vatRate: meta.vatRate,
        standardCommissionBps,
        actualCommissionNet: confirmed.commissionNet,
      });
    } else if (confirmed && refund) {
      benefitAmount = 0;
    }

    if (!confirmed && !NON_ESTIMABLE_SHIPMENT_STATUSES.has(shipment.status)) {
      try {
        const live = await computeVendorEarningForShipment({
          vendorId: shipment.vendorId,
          shipmentId: shipment.id,
        });

        eligibleItemsNet = Number(live.itemsNet || 0);
        artfestCommissionNet = Number(live.commissionNet || 0);
        vendorNet = Number(live.vendorNet || 0);

        benefitAmount = computeOwnSaleBenefit({
          commissionBaseGross: live.commissionBaseGross,
          platformDiscountGross: live.platformDiscountGross,
          vendorDiscountGross: live.vendorDiscountGross,
          vatRate: live.vatRate,
          standardCommissionBps,
          actualCommissionNet: live.commissionNet,
        });
      } catch {
        earningStatus = "UNAVAILABLE";
      }
    } else if (
      !confirmed &&
      NON_ESTIMABLE_SHIPMENT_STATUSES.has(shipment.status)
    ) {
      earningStatus = "CANCELLED";
      eligibleItemsNet = 0;
      artfestCommissionNet = 0;
      vendorNet = 0;
      benefitAmount = 0;
    }

    const discountCodeItem = (shipment.items || []).find(
      (it) => it.discountCodeId
    );

    const { source: attributionSource, collectionSlug } =
      resolveAttributionSource({
        discountCodeItem,
        snapshot: shipment.referrerVendorReferralCodeSnapshot,
      });

    items.push({
      type: "OWN_SALE",

      shipmentId: shipment.id,
      orderNumber: shipment.order?.orderNumber || null,
      createdAt: shipment.order?.createdAt || shipment.createdAt,

      vendorName: shipment.vendor?.displayName || null,

      status: shipment.status,
      earningStatus,

      attributionSource,
      collectionSlug,
      discountCodeText: discountCodeItem?.discountCodeText || null,
      attributedAt: shipment.vendorReferralOwnSaleAttributedAt,

      commissionBpsSnapshot: Number(
        shipment.vendorReferralCommissionOverrideBps || 0
      ),

      eligibleItemsNet,
      artfestCommissionNet,
      vendorNet,
      benefitAmount,

      currency: confirmed?.currency || shipment.order?.currency || "RON",
    });
  }

  return { items, total };
}

/**
 * Totaluri ATRIBUITE own-sale (comenzi/vânzări) - mirror STRUCTURAL al
 * getVendorReferralAttributedTotals, scope pe vendorId +
 * vendorReferralOwnSaleAttributedAt (nu referrerVendorId).
 */
export async function getVendorOwnSaleAttributedTotals(vendorId) {
  const where = { vendorId, vendorReferralOwnSaleAttributedAt: { not: null } };

  const [distinctOrders, shipmentItems] = await Promise.all([
    prisma.shipment.findMany({
      where,
      select: { orderId: true },
      distinct: ["orderId"],
    }),

    prisma.shipmentItem.findMany({
      where: {
        shipment: {
          ...where,
          status: { notIn: Array.from(NON_ESTIMABLE_SHIPMENT_STATUSES) },
        },
      },

      select: { price: true, qty: true },
    }),
  ]);

  const salesAmount =
    Math.round(
      shipmentItems.reduce(
        (sum, item) => sum + Number(item.price || 0) * Number(item.qty || 0),
        0
      ) * 100
    ) / 100;

  return { ordersCount: distinctOrders.length, salesAmount };
}

/**
 * Totaluri CONFIRMATE own-sale (deja în ledger-ul NORMAL al
 * vendorului, VendorEarningEntry) - mirror STRUCTURAL al
 * getVendorReferralConfirmedTotals, dar "confirmedBenefitAmount" ia
 * locul lui "confirmedEarningsAmount" (economie de comision, nu
 * câștig plătit - vezi computeOwnSaleBenefit).
 *
 * VendorEarningEntry conține TOATE vânzările vendorului (nu doar
 * own-sale) - filtrăm explicit pe shipment-urile own-sale identificate
 * mai întâi, apoi căutăm refund-urile lor prin meta.refShipmentId
 * (rândul REFUND nu are shipmentId, la fel ca la referral).
 */
export async function getVendorOwnSaleConfirmedTotals(vendorId) {
  const ownSaleShipments = await prisma.shipment.findMany({
    where: { vendorId, vendorReferralOwnSaleAttributedAt: { not: null } },
    select: { id: true },
  });

  const ownSaleShipmentIds = new Set(ownSaleShipments.map((s) => s.id));

  if (!ownSaleShipmentIds.size) {
    return { ordersCount: 0, salesAmount: 0, confirmedBenefitAmount: 0 };
  }

  const [saleEntries, refundEntries, plan] = await Promise.all([
    prisma.vendorEarningEntry.findMany({
      where: {
        vendorId,
        type: "SALE",
        shipmentId: { in: [...ownSaleShipmentIds] },
      },
      select: {
        orderId: true,
        shipmentId: true,
        itemsNet: true,
        commissionNet: true,
        meta: true,
      },
    }),

    prisma.vendorEarningEntry.findMany({
      where: { vendorId, type: "REFUND" },
      select: { meta: true },
    }),

    getActivePlanForVendor(vendorId),
  ]);

  const standardCommissionBps = Number(plan?.commissionBps || 0);

  const reversedShipmentIds = new Set(
    refundEntries
      .map((r) => r?.meta?.refShipmentId)
      .filter((id) => id && ownSaleShipmentIds.has(id))
  );

  const confirmedOrderIds = new Set();
  let salesAmount = 0;
  let confirmedBenefitAmount = 0;

  for (const entry of saleEntries) {
    /*
     * Reversat -> nu păstrează niciun beneficiu confirmat, la fel ca
     * la referral (unde vânzarea+refund-ul netuiesc la ~0).
     */
    if (reversedShipmentIds.has(entry.shipmentId)) continue;

    confirmedOrderIds.add(entry.orderId);
    salesAmount += Number(entry.itemsNet || 0);

    const meta = entry.meta || {};

    confirmedBenefitAmount += computeOwnSaleBenefit({
      commissionBaseGross: meta.commissionBaseGross,
      platformDiscountGross: meta.platformDiscountGross,
      vendorDiscountGross: meta.vendorDiscountGross,
      vatRate: meta.vatRate,
      standardCommissionBps,
      actualCommissionNet: entry.commissionNet,
    });
  }

  return {
    ordersCount: confirmedOrderIds.size,
    salesAmount: Math.round(salesAmount * 100) / 100,
    confirmedBenefitAmount: Math.round(confirmedBenefitAmount * 100) / 100,
  };
}

/**
 * Beneficiu ESTIMAT (live, nepersistat) own-sale - mirror STRUCTURAL
 * al getVendorReferralEstimatedEarnings, pe shipment-urile own-sale
 * încă neledgerate.
 */
export async function getVendorOwnSaleEstimatedBenefit(vendorId) {
  const pendingShipments = await prisma.shipment.findMany({
    where: {
      vendorId,
      vendorReferralOwnSaleAttributedAt: { not: null },
      status: { notIn: Array.from(NON_ESTIMABLE_SHIPMENT_STATUSES) },
      vendorEarningEntry: null,
    },

    select: { id: true, vendorId: true },
  });

  if (!pendingShipments.length) return 0;

  const plan = await getActivePlanForVendor(vendorId);
  const standardCommissionBps = Number(plan?.commissionBps || 0);

  let estimatedBenefitAmount = 0;

  for (const shipment of pendingShipments) {
    try {
      const live = await computeVendorEarningForShipment({
        vendorId: shipment.vendorId,
        shipmentId: shipment.id,
      });

      estimatedBenefitAmount += computeOwnSaleBenefit({
        commissionBaseGross: live.commissionBaseGross,
        platformDiscountGross: live.platformDiscountGross,
        vendorDiscountGross: live.vendorDiscountGross,
        vatRate: live.vatRate,
        standardCommissionBps,
        actualCommissionNet: live.commissionNet,
      });
    } catch {
      /*
       * Shipment fără iteme încă / date incomplete - îl sărim, nu
       * blocăm restul estimării.
       */
    }
  }

  return Math.round(estimatedBenefitAmount * 100) / 100;
}
