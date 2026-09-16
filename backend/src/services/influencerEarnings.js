// backend/src/services/influencerEarnings.js

/*
 * Agregate de câștig influencer, reutilizate de:
 * - GET /api/influencer/me (dashboard influencer)
 * - GET /api/influencer/orders (lista de comenzi atribuite)
 * - GET /api/admin/influencers (agregate admin)
 *
 * NU recalculează comisionul Artfest - "confirmat" citește STRICT
 * din InfluencerEarningEntry (deja creat de
 * ensureInfluencerSaleLedgerEntry/ensureInfluencerRefundLedgerEntry
 * din vendorOrdersRoutes.js, la ACELAȘI trigger ca vendorul).
 * "Estimat" reutilizează computeVendorEarningForShipment (sursa
 * unică de adevăr a comisionului Artfest), fără să inventeze un
 * calculator paralel.
 */

import { prisma } from "../db.js";
import { computeVendorEarningForShipment } from "../routes/vendorOrdersRoutes.js";

/*
 * Statusuri de shipment care NU mai pot deveni o vânzare
 * confirmată - excluse din estimarea "live".
 */
const NON_ESTIMABLE_SHIPMENT_STATUSES = new Set([
  "REFUSED",
  "RETURNED",
]);

/**
 * Totaluri CONFIRMATE (deja în ledger), pentru un influencer.
 */
export async function getInfluencerConfirmedTotals(influencerId) {
  const [salesAgg, allEntries] = await Promise.all([
    prisma.influencerEarningEntry.aggregate({
      where: { influencerId },

      _sum: {
        earningNet: true,
        eligibleItemsNet: true,
      },
    }),

    prisma.influencerEarningEntry.findMany({
      where: { influencerId },
      select: { type: true, orderId: true, shipmentId: true, meta: true },
    }),
  ]);

  /*
   * Un SALE e "reversat" dacă există un REFUND al cărui
   * meta.refShipmentId indică EXACT shipmentId-ul acelui SALE
   * (vezi ensureInfluencerRefundLedgerEntry - REFUND-ul are
   * shipmentId: null, dar păstrează originalul în meta).
   */
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
 * dashboard) - trebuie să reflecte atribuirea (?ref=/cod de
 * influencer) imediat la plasarea comenzii, nu doar shipment-urile
 * deja confirmate (DELIVERED/IN_TRANSIT, vezi getInfluencerConfirmedTotals,
 * folosit separat pentru "Câștig confirmat" - neschimbat).
 *
 * ordersCount = numărul de COMENZI DISTINCTE (Order.id), nu de
 * shipment-uri - o comandă multi-vendor cu 2 shipment-uri atribuite
 * ACELUIAȘI influencer trebuie să conteze o singură dată.
 *
 * salesAmount = valoarea comercială EFECTIVĂ (preț final plătit de
 * client, după reduceri, brut - fără nicio conversie de TVA) a
 * produselor din shipment-urile atribuite - NU trece prin
 * computeVendorEarningForShipment/platformNet (acelea sunt baza de
 * calcul a comisionului, o cifră internă, nu "vânzarea" din
 * perspectiva influencerului). Exclude shipment-urile REFUSED/
 * RETURNED (comandă anulată/refuzată/returnată definitiv) - identic
 * cu NON_ESTIMABLE_SHIPMENT_STATUSES folosit deja pentru estimare.
 */
export async function getInfluencerAttributedTotals(influencerId) {
  const [distinctOrders, shipmentItems] = await Promise.all([
    prisma.shipment.findMany({
      where: { influencerId },
      select: { orderId: true },
      distinct: ["orderId"],
    }),

    prisma.shipmentItem.findMany({
      where: {
        shipment: {
          influencerId,
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
        (sum, item) =>
          sum + Number(item.price || 0) * Number(item.qty || 0),
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
 * influencerului care încă nu au ajuns la statusul care creează
 * ledger entry (DELIVERED/IN_TRANSIT) și nu au fost refuzate/
 * returnate.
 */
export async function getInfluencerEstimatedEarnings(influencerId) {
  const pendingShipments = await prisma.shipment.findMany({
    where: {
      influencerId,
      status: { notIn: Array.from(NON_ESTIMABLE_SHIPMENT_STATUSES) },
      influencerEarningEntry: null,
    },

    select: {
      id: true,
      vendorId: true,
      influencerCommissionBpsSnapshot: true,
    },
  });

  let estimatedEarningsAmount = 0;

  for (const shipment of pendingShipments) {
    const commissionBpsSnapshot = Number(
      shipment.influencerCommissionBpsSnapshot || 0
    );

    if (!commissionBpsSnapshot) continue;

    try {
      const earning = await computeVendorEarningForShipment({
        vendorId: shipment.vendorId,
        shipmentId: shipment.id,
      });

      estimatedEarningsAmount +=
        (Number(earning.commissionNet || 0) *
          commissionBpsSnapshot) /
        10000;
    } catch {
      /*
       * Shipment fără iteme încă / date incomplete - îl sărim,
       * nu blocăm restul estimării.
       */
    }
  }

  return Math.round(estimatedEarningsAmount * 100) / 100;
}

/**
 * Lista de comenzi/shipment-uri atribuite influencerului, FĂRĂ
 * nicio dată personală despre client (nume/email/telefon/adresă).
 */
export async function listInfluencerAttributedOrders({
  influencerId,
  take = 20,
  skip = 0,
}) {
  const shipments = await prisma.shipment.findMany({
    where: { influencerId },

    orderBy: { influencerAttributedAt: "desc" },

    take,
    skip,

    select: {
      id: true,
      status: true,
      influencerAttributedAt: true,
      influencerReferralCodeSnapshot: true,
      influencerCommissionBpsSnapshot: true,
      vendorId: true,
      createdAt: true,

      order: {
        select: {
          id: true,
          orderNumber: true,
          currency: true,
          createdAt: true,
        },
      },

      influencerEarningEntry: {
        select: {
          type: true,
          eligibleItemsNet: true,
          artfestCommissionNet: true,
          earningNet: true,
          currency: true,
        },
      },

      /*
       * DOAR pentru a deriva attributionSource + textul codului -
       * fără date personale ale clientului (nu selectăm productId,
       * preț, opțiuni etc.). Nu adăugăm niciun câmp Prisma nou -
       * discountCodeId/discountCodeText există deja pe ShipmentItem.
       */
      items: {
        select: {
          discountCodeId: true,
          discountCodeText: true,
        },
      },
    },
  });

  const total = await prisma.shipment.count({
    where: { influencerId },
  });

  /*
   * REFUND-urile au shipmentId: null (vezi ensureInfluencerRefundLedgerEntry
   * din vendorOrdersRoutes.js) - originalul e păstrat în meta.refShipmentId.
   * Le luăm o singură dată, pentru toate shipment-urile de mai sus, ca să
   * putem neta un SALE deja confirmat cu REFUND-ul lui (dacă shipment-ul
   * a fost RETURNED/REFUSED după ce fusese deja livrat) - altfel
   * dashboard-ul ar arăta câștig pozitiv pentru o comandă deja reversată.
   */
  const refunds = await prisma.influencerEarningEntry.findMany({
    where: { influencerId, type: "REFUND" },
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
    const confirmed = shipment.influencerEarningEntry;
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

    let earningStatus = confirmed
      ? refund
        ? "REVERSED"
        : "CONFIRMED"
      : "PENDING";

    if (
      !confirmed &&
      !NON_ESTIMABLE_SHIPMENT_STATUSES.has(shipment.status)
    ) {
      try {
        const live = await computeVendorEarningForShipment({
          vendorId: shipment.vendorId,
          shipmentId: shipment.id,
        });

        const bps = Number(
          shipment.influencerCommissionBpsSnapshot || 0
        );

        eligibleItemsNet = Number(live.itemsNet || 0);
        artfestCommissionNet = Number(live.commissionNet || 0);
        earningNet =
          Math.round(
            ((artfestCommissionNet * bps) / 10000) * 100
          ) / 100;
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

    /*
     * DISCOUNT_CODE dacă vreun item al shipment-ului a câștigat
     * prin cod de reducere (discountCodeId setat) - vezi
     * chekoutRoutes.js, unde codul devine sursă de atribuire
     * (prioritate față de ?ref=) DOAR dacă a câștigat efectiv preț
     * pe un produs al acestui shipment. Altfel, REFERRAL (?ref=,
     * singurul canal existent înainte).
     */
    const discountCodeItem = (shipment.items || []).find(
      (it) => it.discountCodeId
    );

    const attributionSource = discountCodeItem
      ? "DISCOUNT_CODE"
      : "REFERRAL";

    items.push({
      shipmentId: shipment.id,
      orderNumber: shipment.order?.orderNumber || null,
      createdAt: shipment.order?.createdAt || shipment.createdAt,

      status: shipment.status,
      earningStatus,

      attributionSource,
      discountCodeText: discountCodeItem?.discountCodeText || null,
      attributedAt: shipment.influencerAttributedAt,

      commissionBpsSnapshot: Number(
        shipment.influencerCommissionBpsSnapshot || 0
      ),

      eligibleItemsNet,
      artfestCommissionNet,
      earningNet,

      currency:
        confirmed?.currency ||
        shipment.order?.currency ||
        "RON",
    });
  }

  return { items, total };
}
