// backend/src/middleware/enforceInfluencerTermsGate.js

/*
 * Gate minim, cu un singur scop: blochează acțiunile comerciale ale
 * unui influencer (creare/editare cod de reducere, creare/editare
 * colecție) dacă influencerul nu a acceptat încă versiunea CURENTĂ a
 * Acordului Programului de Influenceri (influencer_terms).
 *
 * Inspirat structural din middleware/enforcePolicyGate.js (status
 * 428, formă de răspuns similară), dar NU îl reutilizează direct:
 * - enforcePolicyGate citește `req.user?.id`, câmp care NU există pe
 *   payload-ul JWT (`{ sub, role, tv, iat, exp }` - vezi
 *   api/auth.js:authRequired) - acel middleware e de altfel neapelat
 *   nicăieri activ în cod (singura referință e comentată în
 *   vendorRoutes.js). NU am corectat/atins acel fișier - scop
 *   separat, neatins aici.
 * - influencer_terms are un singur document relevant (nu multiple
 *   politici active simultan ca la VendorPolicy/UserPolicy), deci nu
 *   are nevoie de generalitatea multi-scope a lui enforcePolicyGate.
 *
 * NU blochează GET-uri publice și NU blochează endpoint-ul de
 * acceptare (POST /api/influencer/terms/accept) - vezi routes/
 * influencerRoutes.js, unde acel endpoint NU are acest middleware.
 *
 * IMPORTANT: rulează ÎNAINTEA verificării `requireInfluencer()` din
 * interiorul fiecărui handler (acolo se verifică efectiv rolul/
 * existența InfluencerProfile). Dacă am verifica direct statusul
 * termenilor fără să știm dacă userul e influencer, un user/vendor/
 * admin autentificat care ar nimeri (eronat) pe o rută de influencer
 * ar primi 428 în loc de 403 - un cod de eroare mai puțin corect,
 * deși tot blocant. De-aia verificăm aici, minimal, DOAR existența
 * InfluencerProfile - dacă nu există, lăsăm mai departe handler-ul
 * să dea propriul 403 "influencer_required".
 */

import { prisma } from "../db.js";
import { getInfluencerTermsStatus } from "../services/influencerTermsStatus.js";

export async function enforceInfluencerTermsGate(req, res, next) {
  try {
    const userId = req.user?.sub;

    if (!userId) {
      return res.status(401).json({ error: "unauthenticated" });
    }

    const influencer = await prisma.influencerProfile.findUnique({
      where: { userId },
      select: { id: true },
    });

    if (!influencer) {
      return next();
    }

    const status = await getInfluencerTermsStatus(userId);

    if (status.outdated) {
      return res.status(428).json({
        error: "influencer_terms_acceptance_required",

        message:
          "Trebuie să accepți versiunea actualizată a Acordului Programului de Influenceri înainte de a continua.",

        terms: status,
      });
    }

    return next();
  } catch (e) {
    console.error("enforceInfluencerTermsGate error:", e);
    return res.status(500).json({ error: "internal_error" });
  }
}
