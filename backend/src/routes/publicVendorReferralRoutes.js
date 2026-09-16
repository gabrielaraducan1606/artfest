// backend/src/routes/publicVendorReferralRoutes.js

/*
 * Captură publică a atribuirii de referral VENDOR - mirror
 * STRUCTURAL al publicInfluencerRoutes.js (endpoint separat, NU
 * reutilizează vreo rută de influencer/campanie).
 *
 * GET /api/public/vendor-referral/attribution?ref=<referralCode>
 *
 * Apelat de pe ORICE pagină, de fiecare dată când URL-ul curent
 * conține ?ref= (vezi frontend/src/components/VendorReferralAttributionCapture.jsx).
 *
 * Nu necesită autentificare. Fail-open pentru orice caz invalid -
 * niciodată nu blochează navigarea, doar nu emite un token.
 */

import { Router } from "express";
import crypto from "node:crypto";

import { prisma } from "../db.js";

import {
  signVendorReferralAttributionToken,
  VENDOR_REFERRAL_ATTRIBUTION_WINDOW_HOURS,
} from "../services/vendorAttributionToken.js";

const router = Router();

/*
 * Nu stocăm IP brut niciodată - doar hash, la fel ca la
 * publicInfluencerRoutes.js.
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
 * Evită duplicate excesive la fiecare rerender - dacă avem deja un
 * VendorReferralClick pentru ACEEAȘI pereche vendor+sessionId în
 * ultimele 30 de minute, nu mai creăm unul nou.
 */
const CLICK_DEDUPE_WINDOW_MS = 30 * 60 * 1000;

async function recordVendorReferralClickIfNeeded({
  vendorId,
  sessionId,
  pageUrl,
  referrer,
  req,
}) {
  try {
    if (sessionId) {
      const recent = await prisma.vendorReferralClick.findFirst({
        where: {
          vendorId,
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

    await prisma.vendorReferralClick.create({
      data: {
        vendorId,
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
      "[public-vendor-referral] click tracking failed:",
      error
    );
  }
}

/* =========================================================
   GET /attribution?ref=CODE&sessionId=...&pageUrl=...
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

    const vendor = await prisma.vendor.findUnique({
      where: { referralCode },

      select: {
        id: true,
        referralCode: true,
        isActive: true,
      },
    });

    if (!vendor || vendor.isActive === false) {
      return res.status(404).json({
        ok: false,
        error: "vendor_not_found",
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
     * recordVendorReferralClickIfNeeded.
     */
    recordVendorReferralClickIfNeeded({
      vendorId: vendor.id,
      sessionId,
      pageUrl,
      referrer,
      req,
    });

    const attributionToken = signVendorReferralAttributionToken({
      vendorId: vendor.id,
      referralCode: vendor.referralCode,
    });

    return res.json({
      ok: true,

      vendor: {
        id: vendor.id,
        referralCode: vendor.referralCode,
      },

      attributionToken,
      attributionWindowHours: VENDOR_REFERRAL_ATTRIBUTION_WINDOW_HOURS,
    });
  } catch (error) {
    console.error(
      "[public-vendor-referral] attribution:",
      error
    );

    return res.status(500).json({
      ok: false,
      error: "vendor_referral_attribution_failed",
    });
  }
});

export default router;
