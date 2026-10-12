// backend/src/middleware/enforceInfluencerComplianceGate.js

/*
 * Blochează (428) acțiunile comerciale / financiare sensibile ale unui
 * influencer cu gate de conformitate necompletat (PENDING / CANCELLED /
 * REJECTED / EXPIRED) - vezi services/influencerComplianceGate.js.
 *
 * Montat DOAR pe rutele listate în audit (profil plată, factură payout,
 * acceptare comision, creare/modificare coduri și colecții). NU pe login,
 * profil public, resurse, istoric, formular - și nu atinge atribuirea /
 * earning-urile (checkout).
 *
 * Ca enforceInfluencerTermsGate: un user fără InfluencerProfile trece mai
 * departe (handler-ul dă propriul 403). Flag oprit -> nu blochează nimic.
 */

import { prisma } from "../db.js";
import {
  complianceBlockedBody,
  getInfluencerComplianceStatus,
  isComplianceGateEnabled,
} from "../services/influencerComplianceGate.js";

export function createInfluencerComplianceGate({ db = prisma, env = process.env, now = () => new Date() } = {}) {
  return async function enforceInfluencerComplianceGate(req, res, next) {
    try {
      if (!isComplianceGateEnabled(env)) return next();

      const userId = req.user?.sub;
      if (!userId) return res.status(401).json({ error: "unauthenticated" });

      const influencer = await db.influencerProfile.findUnique({
        where: { userId },
        select: { id: true },
      });
      if (!influencer) return next();

      const state = await getInfluencerComplianceStatus(influencer.id, { db, env, now: now() });
      if (state.blocking) return res.status(428).json(complianceBlockedBody(state));

      return next();
    } catch (e) {
      console.error("enforceInfluencerComplianceGate error:", e?.message || e);
      return res.status(500).json({ error: "internal_error" });
    }
  };
}

export const enforceInfluencerComplianceGate = createInfluencerComplianceGate();
