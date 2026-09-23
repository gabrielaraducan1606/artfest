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
import {
  computeVendorEarningForShipment,
  getActivePlanForVendor,
} from "../routes/vendorOrdersRoutes.js";

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

/*
 * Rulează `worker` pe `items`, cel mult `limit` execuții simultane -
 * concurență LIMITATĂ, nu nelimitată (audit performanță 2026-09-23,
 * fix N+1 getInfluencerEstimatedEarnings). Ordinea rezultatelor
 * corespunde ordinii din `items`, indiferent de ordinea de finalizare.
 */
export async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function runWorker() {
    for (;;) {
      const current = nextIndex++;
      if (current >= items.length) return;
      results[current] = await worker(items[current], current);
    }
  }

  const workerCount = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: workerCount }, runWorker));

  return results;
}

const DEFAULT_ESTIMATE_CONCURRENCY = 6;

/**
 * Câștig ESTIMAT (live, nepersistat) - shipment-uri atribuite
 * influencerului care încă nu au ajuns la statusul care creează
 * ledger entry (DELIVERED/IN_TRANSIT) și nu au fost refuzate/
 * returnate.
 *
 * FIX N+1 (audit performanță 2026-09-23) - fostă buclă `for...await`
 * serială (1 shipment pending = 3-4 query-uri DB secvențiale prin
 * computeVendorEarningForShipment: shipment.findUnique +
 * vendorBilling.findUnique + getActivePlanForVendor). Pentru un
 * influencer cu 32 shipment-uri pending, măsurat: ~24-25 SECUNDE
 * pentru `/api/influencer/me`, aproape în întregime din acest loc.
 *
 * Optimizări aplicate, FĂRĂ să schimbe formula de calcul (vezi
 * computeVendorEarningForShipment, vendorOrdersRoutes.js - NEATINSĂ
 * ca logică, doar cu `billing`/`plan` opționale, pre-fetched):
 * 1. concurență LIMITATĂ (implicit 6, nu nelimitată) în loc de serial;
 * 2. cache local (Map, per-apel, NU global/persistent) pentru
 *    getActivePlanForVendor - planul fiecărui vendor se citește o
 *    singură dată, reutilizat de toate shipment-urile lui;
 * 3. batch VendorBilling - un singur findMany({vendorId:{in:[...]}})
 *    pentru toți vendorii unici, în loc de N findUnique individuale.
 *
 * Parametrii din al 2-lea argument sunt STRICT pentru testare
 * (injectare de db/dependențe fake, fără DB real) - toți apelanții
 * din producție (ruta /me) folosesc valorile implicite.
 */
export async function getInfluencerEstimatedEarnings(
  influencerId,
  {
    db = prisma,
    computeEarning = computeVendorEarningForShipment,
    getPlan = getActivePlanForVendor,
    concurrency = DEFAULT_ESTIMATE_CONCURRENCY,
  } = {}
) {
  const pendingShipments = await db.shipment.findMany({
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

  /*
   * Identic comportamentului vechi (`if (!commissionBpsSnapshot) continue;`)
   * - filtrat ÎNAINTE de batch-uri, ca să nu aducem billing/plan
   * pentru vendori ale căror shipment-uri oricum nu contribuie.
   */
  const eligibleShipments = pendingShipments.filter(
    (shipment) =>
      Number(shipment.influencerCommissionBpsSnapshot || 0) > 0
  );

  if (!eligibleShipments.length) return 0;

  /*
   * BATCH billing (punctul 3) - un singur query pentru toți vendorii
   * unici implicați în shipment-urile eligibile.
   */
  const uniqueVendorIds = [
    ...new Set(eligibleShipments.map((s) => s.vendorId)),
  ];

  const billingRows = await db.vendorBilling.findMany({
    where: { vendorId: { in: uniqueVendorIds } },
  });

  const billingByVendorId = new Map(
    billingRows.map((b) => [b.vendorId, b])
  );

  /*
   * CACHE local per-request (punctul 2) - Map cu PROMISE-uri (nu doar
   * valori rezolvate), ca să dedupleze și apeluri concurente pentru
   * ACELAȘI vendor (2 workeri care ajung simultan la primul shipment
   * al aceluiași vendor nu declanșează 2 query-uri - al doilea
   * așteaptă promisiunea primului). Trăiește STRICT în closure-ul
   * acestui apel - NU e cache global/persistent, dispare la finalul
   * funcției.
   */
  const planCache = new Map();

  function getCachedPlan(vendorId) {
    if (!planCache.has(vendorId)) {
      planCache.set(vendorId, getPlan(vendorId));
    }
    return planCache.get(vendorId);
  }

  /*
   * PARALELIZARE cu concurență limitată (punctul 1) - înlocuiește
   * bucla `for...await` serială. Concurență implicit 6 (interval
   * cerut: 5-8), ca să nu saturăm conexiunile DB dacă numărul de
   * shipment-uri pending crește mult.
   */
  const contributions = await mapWithConcurrency(
    eligibleShipments,
    concurrency,
    async (shipment) => {
      const commissionBpsSnapshot = Number(
        shipment.influencerCommissionBpsSnapshot || 0
      );

      try {
        const billing =
          billingByVendorId.get(shipment.vendorId) ?? null;

        const plan = await getCachedPlan(shipment.vendorId);

        const earning = await computeEarning({
          vendorId: shipment.vendorId,
          shipmentId: shipment.id,
          billing,
          plan,
        });

        return (
          (Number(earning.commissionNet || 0) *
            commissionBpsSnapshot) /
          10000
        );
      } catch {
        /*
         * Shipment fără iteme încă / date incomplete - îl sărim,
         * nu blocăm restul estimării. Identic comportamentul vechi.
         */
        return 0;
      }
    }
  );

  const estimatedEarningsAmount = contributions.reduce(
    (sum, value) => sum + value,
    0
  );

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
