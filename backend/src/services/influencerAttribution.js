// backend/src/services/influencerAttribution.js

/*
 * Revalidare server-side a atribuirii de influencer, folosită
 * EXCLUSIV la checkout (mirror al campaignAttribution.js).
 *
 * Clientul trimite un influencerAttribution token (emis de
 * GET /api/public/influencer/attribution) - dar tokenul dovedește
 * doar "acest server a emis asta pentru influencerul X la
 * momentul Y", nu că influencerul e încă ACTIV acum. De aceea
 * revalidăm mereu direct din DB înainte să facem vreun snapshot.
 *
 * Fail-open: orice atribuire invalidă/expirată/lipsă e ignorată
 * silențios - comanda continuă normal, fără atribuire de
 * influencer. Nu blocăm niciodată checkout-ul din cauza asta.
 *
 * IMPORTANT: spre deosebire de campanii (atribuire PER VENDOR),
 * atribuirea de influencer e GLOBALĂ pentru întreaga comandă -
 * un singur token, aplicat identic pe toate shipment-urile
 * comenzii, indiferent de câți vendori conține.
 */

import { prisma } from "../db.js";
import { verifyInfluencerAttributionToken } from "./influencerAttributionToken.js";
import { resolveCollaborationGate } from "./influencerCollaborationGate.js";

/*
 * Regulă comună de eligibilitate PENTRU ATRIBUIRE (nu pentru
 * validitatea unui discount code în sine - un cod poate fi valid
 * și oferi reducere chiar dacă influencerul lui nu mai e eligibil
 * pentru remunerație; vezi resolveInfluencerAttributionByInfluencerId).
 *
 * Extrasă din resolveInfluencerAttribution FĂRĂ nicio schimbare de
 * comportament pe calea ?ref= - doar reutilizată și de calea prin
 * cod de reducere.
 */
function buildAttributionFromInfluencer(influencer) {
  if (!influencer) return null;
  if (influencer.status !== "ACTIVE") return null;

  /*
   * Colaborarea trebuie să fie ACTIVĂ (nu expirată) pentru ca
   * influencerul să poată fi candidat pentru o atribuire NOUĂ -
   * vezi services/influencerCollaborationGate.js (sursă unică,
   * derivată din computeCollaborationState). Atribuirile deja
   * existente (Shipment/InfluencerEarningEntry deja scrise) NU
   * sunt afectate - această funcție rulează STRICT la o atribuire
   * nouă (link ?ref=/cod de reducere), niciodată retroactiv.
   */
  const { canStartNewCommercialActivity } = resolveCollaborationGate(influencer);

  if (!canStartNewCommercialActivity) return null;

  /*
   * O propunere de remunerație în așteptare NU e activă încă -
   * folosim STRICT commissionBps deja acceptat (identic cu
   * regula folosită oriunde altundeva în platformă).
   */
  const commissionBpsSnapshot = Number(
    influencer.commissionBps || 0
  );

  if (
    !Number.isInteger(commissionBpsSnapshot) ||
    commissionBpsSnapshot <= 0
  ) {
    /*
     * Influencer fără remunerație activă acceptată -
     * nu are sens să atribuim o comandă fără procent de
     * câștig, deși linkul/codul lui a fost folosit.
     */
    return null;
  }

  return {
    influencerId: influencer.id,
    referralCodeSnapshot: influencer.referralCode,
    commissionBpsSnapshot,
  };
}

/**
 * @param {object} params
 * @param {string} params.token - influencerAttribution trimis de client
 * @returns {Promise<{
 *   influencerId: string,
 *   referralCodeSnapshot: string,
 *   commissionBpsSnapshot: number,
 * } | null>}
 */
export async function resolveInfluencerAttribution({
  token,
  db = prisma,
} = {}) {
  const payload = verifyInfluencerAttributionToken(token);

  if (!payload) {
    return null;
  }

  const influencer = await db.influencerProfile.findFirst({
    where: {
      id: payload.influencerId,
      referralCode: payload.referralCode,
    },

    select: {
      id: true,
      referralCode: true,
      commissionBps: true,
      status: true,
      createdAt: true,
      collaborationEndOverride: true,
    },
  });

  return buildAttributionFromInfluencer(influencer);
}

/**
 * Mirror al resolveInfluencerAttribution, dar pentru atribuirea
 * provenită dintr-un cod de reducere al unui influencer (nu dintr-un
 * token ?ref=). Cheie: influencerId (deja cunoscut, din
 * DiscountCode.influencerId, validat separat de discountCodeValidation.js),
 * NU un token - re-citește FRESH commissionBps/status din DB, exact
 * ca la ?ref=, niciodată din vreo valoare cache-uită pe cod.
 *
 * @param {object} params
 * @param {string} params.influencerId
 * @returns {Promise<{
 *   influencerId: string,
 *   referralCodeSnapshot: string,
 *   commissionBpsSnapshot: number,
 * } | null>}
 */
export async function resolveInfluencerAttributionByInfluencerId({
  influencerId,
  db = prisma,
} = {}) {
  if (!influencerId) return null;

  const influencer = await db.influencerProfile.findUnique({
    where: { id: influencerId },

    select: {
      id: true,
      referralCode: true,
      commissionBps: true,
      status: true,
      createdAt: true,
      collaborationEndOverride: true,
    },
  });

  return buildAttributionFromInfluencer(influencer);
}
