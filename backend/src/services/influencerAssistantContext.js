// backend/src/services/influencerAssistantContext.js

/*
 * Context LIVE pentru asistentul AI, rol INFLUENCER (FAZA 2).
 *
 * Adună doar datele necesare asistentului, reutilizând EXCLUSIV
 * servicii/query-uri deja existente (nicio duplicare de logică):
 * - getInfluencerResourcesBundle (influencerRoutes.js) - resurse
 *   PUBLISHED + activitate proprie + generatedContent.
 * - listInfluencerCollectionsSummary (influencerCollectionRoutes.js).
 * - listInfluencerDiscountCodesSummary (influencerDiscountCodesRoutes.js).
 * - getInfluencerConfirmedTotals / getInfluencerEstimatedEarnings /
 *   listInfluencerAttributedOrders (influencerEarnings.js).
 *
 * IMPORTANT - PRIVACY: nimic din acest fișier nu selectează sau
 * expune date personale ale CLIENȚILOR (email/telefon/adresă/
 * shippingAddress/contactPerson) - vezi allowlist-ul explicit din
 * mapSafeOrder() de mai jos. listInfluencerAttributedOrders() e deja
 * verificat manual, câmp cu câmp, ca fiind PII-safe (vezi comentariul
 * din influencerEarnings.js), dar mapSafeOrder() NU are încredere
 * oarbă în asta - re-mapează explicit doar câmpurile whitelisted,
 * ca un shape nou adăugat vreodată acelui serviciu să nu ajungă
 * automat în promptul LLM-ului.
 */

import { prisma } from "../db.js";

import { getInfluencerResourcesBundle } from "../routes/influencerRoutes.js";
import { listInfluencerCollectionsSummary } from "../routes/influencerCollectionRoutes.js";
import { listInfluencerDiscountCodesSummary } from "../routes/influencerDiscountCodesRoutes.js";

import {
  getInfluencerConfirmedTotals,
  getInfluencerEstimatedEarnings,
  listInfluencerAttributedOrders,
} from "./influencerEarnings.js";

/*
 * Limită de comenzi trimise în contextul asistentului - suficient
 * pentru "ce comenzi am adus" / "de unde a venit comanda", fără să
 * umflăm promptul cu tot istoricul.
 */
const ASSISTANT_ORDERS_LIMIT = 10;

/* =========================================================
   DTO SAFE - COMENZI

   Allowlist explicit, INDEPENDENT de shape-ul intern al
   listInfluencerAttributedOrders() - dacă acel serviciu ar câștiga
   vreodată un câmp nou (ex. printr-un include mai larg), câmpul NU
   ajunge automat aici decât dacă e adăugat explicit în lista de mai
   jos. Exportată - reutilizată și de influencerAssistantCommands.js,
   ca să existe UN singur loc care decide ce e "safe" pentru comenzi.
========================================================= */
export function mapSafeOrder(order) {
  return {
    shipmentId: order.shipmentId,
    orderNumber: order.orderNumber,
    createdAt: order.createdAt,

    status: order.status,
    earningStatus: order.earningStatus,

    attributionSource: order.attributionSource,
    discountCodeText: order.discountCodeText,
    attributedAt: order.attributedAt,

    eligibleItemsNet: order.eligibleItemsNet,
    artfestCommissionNet: order.artfestCommissionNet,
    earningNet: order.earningNet,

    currency: order.currency,
  };
}

/* =========================================================
   CONTEXT COMPLET
========================================================= */

/**
 * getInfluencerAssistantContext({ userId, influencerId })
 *
 * Întoarce bundle-ul complet de date LIVE pentru un influencer,
 * gata de folosit de influencerAssistantCommands.js / copilotRouter.js.
 * `influencerId` trebuie deja verificat/rezolvat de apelant (vezi
 * requireActiveInfluencer din influencerRoutes.js) - această funcție
 * NU reverifică rolul, doar citește date pentru id-ul primit.
 */
export async function getInfluencerAssistantContext({
  userId,
  influencerId,
}) {
  const [
    profile,
    resourcesBundle,
    collections,
    discountCodes,
    confirmedTotals,
    estimatedEarningsAmount,
    ordersPage,
  ] = await Promise.all([
    prisma.influencerProfile.findUnique({
      where: { id: influencerId },

      select: {
        id: true,
        displayName: true,
        referralCode: true,
        commissionBps: true,
        status: true,
      },
    }),

    getInfluencerResourcesBundle(influencerId),
    listInfluencerCollectionsSummary(influencerId),
    listInfluencerDiscountCodesSummary(influencerId),
    getInfluencerConfirmedTotals(influencerId),
    getInfluencerEstimatedEarnings(influencerId),

    listInfluencerAttributedOrders({
      influencerId,
      take: ASSISTANT_ORDERS_LIMIT,
      skip: 0,
    }),
  ]);

  return {
    userId,

    profile: profile
      ? {
          id: profile.id,
          displayName: profile.displayName,
          referralCode: profile.referralCode,
          commissionBps: profile.commissionBps,
          status: profile.status,
        }
      : null,

    resources: {
      items: resourcesBundle.items,
      generatedContent: resourcesBundle.generatedContent,
    },

    collections: collections.map((collection) => ({
      id: collection.id,
      title: collection.title,
      slug: collection.slug,

      /*
       * Ruta publică reală - App.jsx: path="/selectii/:slug" ->
       * PublicInfluencerCollectionPage.
       */
      publicUrl: `/selectii/${collection.slug}`,

      productsCount: collection.productsCount,
      isActive: collection.isActive,
    })),

    discountCodes: discountCodes.map((code) => ({
      id: code.id,
      code: code.code,
      name: code.name,
      status: code.status,
      isActive: code.isActive,
      discountPercent: code.discountPercent,
      scope: code.scope,
      collection: code.collection,
    })),

    orders: {
      items: ordersPage.items.map(mapSafeOrder),
      total: ordersPage.total,
    },

    earnings: {
      ordersCount: confirmedTotals.ordersCount,
      salesAmount: confirmedTotals.salesAmount,
      confirmedEarningsAmount: confirmedTotals.confirmedEarningsAmount,
      estimatedEarningsAmount,
      currency: "RON",
    },
  };
}
