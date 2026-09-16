// backend/src/services/vendorAttributionStats.js

/*
 * Agregare SERVER-SIDE, LIVE, din ShipmentItem/Shipment - pentru
 * statistici reale pe coduri de reducere vendor și campanii vendor.
 *
 * NU o a doua logică financiară - reutilizează exact valorile deja
 * snapshotate pe ShipmentItem (price, qty, discountAmount,
 * platformDiscountAmount, vendorDiscountAmount) și, pentru "net
 * vendor", funcția deja exportată computeVendorEarningForShipment
 * din vendorOrdersRoutes.js (aceeași sursă folosită de Order Details).
 *
 * GĂSIT LA AUDIT (raportat, nu "reparat" silențios):
 * VendorCampaign.visits / attributedOrdersCount / attributedRevenueCents
 * sunt coloane care NU sunt incrementate NICĂIERI în cod - rămân
 * mereu la valoarea implicită (0). De aceea statisticile de campanie
 * de aici sunt calculate LIVE, nu citite din acele coloane.
 */

import { prisma } from "../db.js";
import {
  computeVendorEarningForShipment,
  getActivePlanForVendor,
} from "../routes/vendorOrdersRoutes.js";
import { computeOwnSaleBenefit } from "./vendorReferralEarnings.js";

function round2(value) {
  return Number.parseFloat((Number(value) || 0).toFixed(2));
}

/**
 * Rândul complet de atribuire (Admin Marketing - detalii coduri/
 * campanii vendor, audit 2026-09-14) - PENTRU AFIȘARE, nu recalculează
 * NIMIC nou: reutilizează STRICT computeVendorEarningForShipment
 * (sursa unică pentru comisionul Artfest/vendorNet, deja folosită de
 * Order Details), computeOwnSaleBenefit (deja folosită de pagina
 * Recomandări vendor) și snapshot-urile de pe Shipment
 * (referrerVendorCommissionBpsSnapshot, vendorReferralEarningEntry).
 *
 * @param {object} params
 * @param {string} params.sellerVendorId - shipment.vendorId
 * @param {string|null} params.promoterVendorId - vendorul proprietar
 *   al codului/campaniei (promoter)
 * @param {object} params.shipment - { id, status,
 *   referrerVendorCommissionBpsSnapshot, vendorReferralEarningEntry }
 */
export async function computeAdminAttributionRow({
  sellerVendorId,
  promoterVendorId,
  shipment,
}) {
  const isOwnSale =
    !!sellerVendorId &&
    !!promoterVendorId &&
    sellerVendorId === promoterVendorId;

  let earning = null;

  try {
    earning = await computeVendorEarningForShipment({
      vendorId: sellerVendorId,
      shipmentId: shipment.id,
    });
  } catch {
    earning = null;
  }

  if (!earning) {
    return {
      promotionType: isOwnSale ? "OWN_SALE" : "CROSS_VENDOR",
      artfestCommissionGross: null,
      promoterPercent: null,
      promoterEarning: null,
      netArtfest: null,
      netSeller: null,
      ownSaleBenefit: null,
    };
  }

  /*
   * "Comision Artfest brut" = platformNet (comisionul EFECTIV reținut
   * de Artfest, deja după subvenția care protejează sellerul - vezi
   * commissionCalc.js, NEATINS) - disponibil pentru remunerația
   * promoterului, exact ca în ensureVendorReferralSaleLedgerEntry.
   */
  const artfestCommissionGross = Number(earning.platformNet || 0);
  const netSeller = Number(earning.vendorNet || 0);

  if (isOwnSale) {
    let ownSaleBenefit = null;

    try {
      const plan = await getActivePlanForVendor(sellerVendorId);

      ownSaleBenefit = computeOwnSaleBenefit({
        commissionBaseGross: earning.commissionBaseGross,
        platformDiscountGross: earning.platformDiscountGross,
        vendorDiscountGross: earning.vendorDiscountGross,
        vatRate: earning.vatRate,
        standardCommissionBps: Number(plan?.commissionBps || 0),
        actualCommissionNet: earning.commissionNet,
      });
    } catch {
      ownSaleBenefit = null;
    }

    return {
      promotionType: "OWN_SALE",
      artfestCommissionGross,
      promoterPercent: null,
      promoterEarning: 0,
      netArtfest: artfestCommissionGross,
      netSeller,
      ownSaleBenefit,
    };
  }

  /*
   * CROSS_VENDOR - "confirmat" citește STRICT din
   * VendorReferralEarningEntry deja creat (ensureVendorReferralSaleLedgerEntry,
   * vendorOrdersRoutes.js); dacă încă nu există (shipment neajuns la
   * DELIVERED/IN_TRANSIT), estimăm LIVE cu EXACT aceeași formulă
   * (earningNet = platformNet × commissionBpsSnapshot / 10000),
   * folosind snapshot-ul de pe shipment (NU valoarea curentă din
   * Vendor.referralCommissionBps, care se poate fi schimbat între
   * timp - snapshot-ul e sursa de adevăr pentru ACEASTĂ comandă).
   */
  const confirmedEarningNet = shipment.vendorReferralEarningEntry?.earningNet;

  const commissionBpsSnapshot = Number(
    shipment.referrerVendorCommissionBpsSnapshot || 0
  );

  const promoterEarning =
    confirmedEarningNet != null
      ? Number(confirmedEarningNet)
      : round2((artfestCommissionGross * commissionBpsSnapshot) / 10000);

  return {
    promotionType: "CROSS_VENDOR",
    artfestCommissionGross,
    promoterPercent: round2(commissionBpsSnapshot / 100),
    promoterEarning,
    netArtfest: round2(artfestCommissionGross - promoterEarning),
    netSeller,
    ownSaleBenefit: null,
  };
}

/**
 * Statistici pe cod de reducere, calculate din ShipmentItem-urile
 * REAL câștigate de acel cod (item.discountCodeId).
 *
 * @returns {Promise<Map<string, {
 *   ordersCount: number,
 *   componentsCount: number,
 *   salesValue: number,
 *   totalDiscount: number,
 *   artfestFunded: number,
 *   vendorFunded: number,
 *   vendorNetGenerated: number,
 * }>>}
 */
export async function getDiscountCodeStats(discountCodeIds = []) {
  const ids = [...new Set((discountCodeIds || []).filter(Boolean))];
  const result = new Map();

  if (!ids.length) return result;

  const items = await prisma.shipmentItem.findMany({
    where: { discountCodeId: { in: ids } },
    select: {
      discountCodeId: true,
      qty: true,
      price: true,
      discountAmount: true,
      platformDiscountAmount: true,
      vendorDiscountAmount: true,
      shipment: {
        select: { id: true, orderId: true, vendorId: true },
      },
    },
  });

  // shipmentId -> { vendorId, itemsNetForVendorNetShare }
  const shipmentIdsNeeded = new Set(
    items.map((it) => it.shipment?.id).filter(Boolean)
  );

  const vendorNetByShipmentId = await getVendorNetByShipmentId(
    [...shipmentIdsNeeded]
      .map((shipmentId) => {
        const sample = items.find((it) => it.shipment?.id === shipmentId);
        return sample?.shipment
          ? { shipmentId, vendorId: sample.shipment.vendorId }
          : null;
      })
      .filter(Boolean)
  );

  for (const item of items) {
    const codeId = item.discountCodeId;
    if (!codeId) continue;

    if (!result.has(codeId)) {
      result.set(codeId, {
        ordersCount: 0,
        componentsCount: 0,
        salesValue: 0,
        totalDiscount: 0,
        artfestFunded: 0,
        vendorFunded: 0,
        vendorNetGenerated: 0,
        _orderIds: new Set(),
        _shipmentIds: new Set(),
      });
    }

    const bucket = result.get(codeId);
    const qty = Number(item.qty || 0);
    const lineValue = Number(item.price || 0) * qty;

    bucket.componentsCount += 1;
    bucket.salesValue += lineValue;
    bucket.totalDiscount += Number(item.discountAmount || 0);
    bucket.artfestFunded += Number(item.platformDiscountAmount || 0);
    bucket.vendorFunded += Number(item.vendorDiscountAmount || 0);

    if (item.shipment?.orderId) bucket._orderIds.add(item.shipment.orderId);

    if (
      item.shipment?.id &&
      !bucket._shipmentIds.has(item.shipment.id)
    ) {
      bucket._shipmentIds.add(item.shipment.id);
      bucket.vendorNetGenerated += Number(
        vendorNetByShipmentId.get(item.shipment.id) || 0
      );
    }
  }

  for (const [codeId, bucket] of result) {
    result.set(codeId, {
      ordersCount: bucket._orderIds.size,
      componentsCount: bucket.componentsCount,
      salesValue: round2(bucket.salesValue),
      totalDiscount: round2(bucket.totalDiscount),
      artfestFunded: round2(bucket.artfestFunded),
      vendorFunded: round2(bucket.vendorFunded),
      vendorNetGenerated: round2(bucket.vendorNetGenerated),
    });
  }

  return result;
}

/**
 * Statistici pe campanie vendor, calculate din Shipment-urile
 * atribuite (shipment.campaignId), pe TOATE produsele shipment-ului
 * (clientul a intrat prin campanie), plus reducerea EFECTIV acordată
 * prin campanie (item.discountSource === "CAMPAIGN" - poate fi mai
 * mică decât discountul total al liniei, dacă a câștigat altă
 * promoție mai mare pe acel produs).
 */
export async function getCampaignStats(campaignIds = []) {
  const ids = [...new Set((campaignIds || []).filter(Boolean))];
  const result = new Map();

  if (!ids.length) return result;

  const shipments = await prisma.shipment.findMany({
    where: { campaignId: { in: ids } },
    select: {
      id: true,
      orderId: true,
      vendorId: true,
      campaignId: true,
      items: {
        select: {
          qty: true,
          price: true,
          discountAmount: true,
          discountSource: true,
          platformDiscountAmount: true,
          vendorDiscountAmount: true,
        },
      },
    },
  });

  const vendorNetByShipmentId = await getVendorNetByShipmentId(
    shipments.map((s) => ({ shipmentId: s.id, vendorId: s.vendorId }))
  );

  for (const shipment of shipments) {
    const campaignId = shipment.campaignId;
    if (!campaignId) continue;

    if (!result.has(campaignId)) {
      result.set(campaignId, {
        ordersCount: 0,
        productsSoldCount: 0,
        salesValue: 0,
        discountGiven: 0,
        artfestFunded: 0,
        vendorFunded: 0,
        vendorNetGenerated: 0,
        _orderIds: new Set(),
      });
    }

    const bucket = result.get(campaignId);

    bucket._orderIds.add(shipment.orderId);
    bucket.vendorNetGenerated += Number(
      vendorNetByShipmentId.get(shipment.id) || 0
    );

    for (const item of shipment.items || []) {
      const qty = Number(item.qty || 0);
      bucket.productsSoldCount += qty;
      bucket.salesValue += Number(item.price || 0) * qty;

      /*
       * Split Artfest/Vendor - identic ca sursă cu getDiscountCodeStats
       * de mai sus (ShipmentItem.platformDiscountAmount/
       * vendorDiscountAmount, deja calculate la checkout de
       * campaignToPromotion/getPromotionPricingForProducts, nu un
       * calcul nou aici).
       */
      if (item.discountSource === "CAMPAIGN") {
        bucket.discountGiven += Number(item.discountAmount || 0);
        bucket.artfestFunded += Number(item.platformDiscountAmount || 0);
        bucket.vendorFunded += Number(item.vendorDiscountAmount || 0);
      }
    }
  }

  for (const [campaignId, bucket] of result) {
    result.set(campaignId, {
      ordersCount: bucket._orderIds.size,
      productsSoldCount: bucket.productsSoldCount,
      salesValue: round2(bucket.salesValue),
      discountGiven: round2(bucket.discountGiven),
      artfestFunded: round2(bucket.artfestFunded),
      vendorFunded: round2(bucket.vendorFunded),
      vendorNetGenerated: round2(bucket.vendorNetGenerated),
    });
  }

  return result;
}

/**
 * Net vendor per shipment - reutilizează computeVendorEarningForShipment
 * (aceeași sursă ca Order Details). Nu recalculăm nimic nou, doar
 * cache-uim per shipmentId ca să nu interogăm de mai multe ori
 * pentru shipment-uri cu mai multe linii/coduri.
 */
async function getVendorNetByShipmentId(shipmentVendorPairs = []) {
  const map = new Map();

  const unique = [];
  const seen = new Set();

  for (const pair of shipmentVendorPairs) {
    if (!pair?.shipmentId || seen.has(pair.shipmentId)) continue;
    seen.add(pair.shipmentId);
    unique.push(pair);
  }

  await Promise.all(
    unique.map(async ({ shipmentId, vendorId }) => {
      try {
        const earning = await computeVendorEarningForShipment({
          vendorId,
          shipmentId,
        });

        map.set(shipmentId, Number(earning?.vendorNet || 0));
      } catch (error) {
        console.error(
          "[vendorAttributionStats] computeVendorEarningForShipment failed:",
          shipmentId,
          error
        );

        map.set(shipmentId, 0);
      }
    })
  );

  return map;
}
