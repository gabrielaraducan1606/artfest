// backend/src/routes/publicInfluencerRoutes.js

/*
 * DEPRECIAT (atribuire influencer request-based, fără stocare pe terminal):
 * frontend-ul NU mai apelează această rută - referralCode-ul e transportat
 * în aceeași navigare (URL / memoria aplicației) și validat server-side la
 * checkout (services/referralAttribution.js). Atribuirea comenzii NU depinde de
 * această rută și nici de InfluencerClick.
 *
 * Păstrată TEMPORAR doar pentru bundle-urile vechi din cache (care încă
 * cer un token): emite tokenul ca înainte, dar click-ul se înregistrează
 * ANONIM - fără ipHash, userAgent, sessionId sau referrer (doar
 * influencerul și calea paginii, fără query) - ca simplu contor agregat.
 * De eliminat după perioada de tranziție.
 *
 * GET /api/public/influencer/attribution?ref=<referralCode>
 */

import { Router } from "express";

import { prisma } from "../db.js";

import {
  signInfluencerAttributionToken,
  INFLUENCER_ATTRIBUTION_WINDOW_HOURS,
} from "../services/influencerAttributionToken.js";

const router = Router();

// doar calea (fără query/hash - fără identificatori în URL)
function pagePathOnly(pageUrl) {
  if (!pageUrl) return null;
  return String(pageUrl).split(/[?#]/)[0].slice(0, 500) || null;
}

async function recordAnonymousInfluencerClick({ influencerId, pageUrl }) {
  try {
    await prisma.influencerClick.create({
      data: {
        influencerId,
        pageUrl: pagePathOnly(pageUrl),
        sessionId: null,
        referrer: null,
        ipHash: null,
        userAgent: null,
      },
    });
  } catch (error) {
    // contorul nu blochează niciodată emiterea tokenului
    console.error("[public-influencer] anonymous click counter failed:", error?.message || error);
  }
}

/* =========================================================
   GET /attribution?ref=CODE&sessionId=...&pageUrl=...&referrer=...
========================================================= */

router.get("/attribution", async (req, res) => {
  try {
    const referralCode = String(
      req.query?.ref || ""
    ).trim();

    if (!referralCode) {
      return res.status(400).json({
        ok: false,
        error: "referral_code_required",
      });
    }

    const influencer = await prisma.influencerProfile.findUnique({
      where: { referralCode },

      select: {
        id: true,
        referralCode: true,
        status: true,
      },
    });

    if (!influencer || influencer.status !== "ACTIVE") {
      return res.status(404).json({
        ok: false,
        error: "influencer_not_found",
      });
    }

    const pageUrl = req.query?.pageUrl
      ? String(req.query.pageUrl)
      : null;

    // contor anonim, non-blocant (fără identificatori)
    recordAnonymousInfluencerClick({
      influencerId: influencer.id,
      pageUrl,
    });

    const attributionToken = signInfluencerAttributionToken({
      influencerId: influencer.id,
      referralCode: influencer.referralCode,
    });

    return res.json({
      ok: true,

      influencer: {
        id: influencer.id,
        referralCode: influencer.referralCode,
      },

      attributionToken,
      attributionWindowHours: INFLUENCER_ATTRIBUTION_WINDOW_HOURS,
    });
  } catch (error) {
    console.error(
      "[public-influencer] attribution:",
      error
    );

    return res.status(500).json({
      ok: false,
      error: "influencer_attribution_failed",
    });
  }
});

export default router;
