// backend/src/routes/publicInfluencerRoutes.js

/*
 * Captură publică a atribuirii de referral influencer.
 *
 * GET /api/public/influencer/attribution?ref=<referralCode>
 *
 * Apelat de pe ORICE pagină (nu doar o pagină de destinație
 * dedicată, spre deosebire de campaniile vendor - vezi
 * frontend/src/components/InfluencerAttributionCapture.jsx),
 * de fiecare dată când URL-ul curent conține ?ref=.
 *
 * Nu necesită autentificare. Fail-open pentru orice caz invalid -
 * niciodată nu blochează navigarea, doar nu emite un token.
 */

import { Router } from "express";
import crypto from "node:crypto";

import { prisma } from "../db.js";

import {
  signInfluencerAttributionToken,
  INFLUENCER_ATTRIBUTION_WINDOW_HOURS,
} from "../services/influencerAttributionToken.js";

const router = Router();

/*
 * Nu stocăm IP brut niciodată - doar hash, la fel ca la
 * consimțămintele de acceptare a remunerației din
 * influencerRoutes.js.
 */
function sha256(value = "") {
  return crypto
    .createHash("sha256")
    .update(String(value), "utf8")
    .digest("hex");
}

function getReqIp(req) {
  const ipHeader = String(
    req.headers["x-forwarded-for"] || ""
  );

  return (
    ipHeader.split(",")[0].trim() ||
    req.socket?.remoteAddress ||
    null
  );
}

function hashRequestIp(req) {
  const ip = getReqIp(req);
  return ip ? sha256(ip) : null;
}

function truncateUserAgent(value) {
  if (!value) return null;
  return String(value).slice(0, 500);
}

/*
 * Evită "duplicate excesive la fiecare rerender" (cerință
 * explicită) - dacă avem deja un InfluencerClick pentru ACEEAȘI
 * pereche influencer+sessionId în ultimele 30 de minute, nu mai
 * creăm unul nou. sessionId vine din frontend (id generat per
 * tab, NU legat de autentificare - vezi influencerAttribution.js
 * frontend).
 */
const CLICK_DEDUPE_WINDOW_MS = 30 * 60 * 1000;

async function recordInfluencerClickIfNeeded({
  influencerId,
  sessionId,
  pageUrl,
  referrer,
  req,
}) {
  try {
    if (sessionId) {
      const recent = await prisma.influencerClick.findFirst({
        where: {
          influencerId,
          sessionId,

          createdAt: {
            gte: new Date(
              Date.now() - CLICK_DEDUPE_WINDOW_MS
            ),
          },
        },

        select: { id: true },
      });

      if (recent) return;
    }

    await prisma.influencerClick.create({
      data: {
        influencerId,
        sessionId: sessionId || null,
        pageUrl: pageUrl ? String(pageUrl).slice(0, 500) : null,
        referrer: referrer ? String(referrer).slice(0, 500) : null,
        ipHash: hashRequestIp(req),
        userAgent: truncateUserAgent(req.get("user-agent")),
      },
    });
  } catch (error) {
    /*
     * Tracking-ul de click nu trebuie NICIODATĂ să blocheze
     * emiterea tokenului de atribuire.
     */
    console.error(
      "[public-influencer] click tracking failed:",
      error
    );
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

    const sessionId = req.query?.sessionId
      ? String(req.query.sessionId).slice(0, 128)
      : null;

    const pageUrl = req.query?.pageUrl
      ? String(req.query.pageUrl)
      : null;

    const referrer = req.get("referer") || null;

    /*
     * Non-blocant - vezi comentariul din
     * recordInfluencerClickIfNeeded.
     */
    recordInfluencerClickIfNeeded({
      influencerId: influencer.id,
      sessionId,
      pageUrl,
      referrer,
      req,
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
