// backend/src/routes/publicVendorReferralRoutes.js

/*
 * DEPRECIAT (atribuire vendor referral request-based, fără stocare pe
 * terminal): frontend-ul NU mai apelează această rută - codul ?ref= e
 * transportat în aceeași navigare (URL / memoria aplicației) și validat
 * server-side la checkout (services/referralAttribution.js). Atribuirea
 * comenzii NU depinde de această rută și nici de VendorReferralClick.
 *
 * TRANZIȚIE - DE ELIMINAT: păstrată doar pentru bundle-urile vechi din cache
 * (care încă cer un token): emite tokenul ca înainte, dar click-ul se
 * înregistrează ANONIM - fără ipHash, userAgent, sessionId sau referrer (doar
 * vendorul și calea paginii, fără query) - ca simplu contor agregat.
 *
 * GET /api/public/vendor-referral/attribution?ref=<referralCode>
 */

import { Router } from "express";

import { prisma } from "../db.js";

import {
  signVendorReferralAttributionToken,
  VENDOR_REFERRAL_ATTRIBUTION_WINDOW_HOURS,
} from "../services/vendorAttributionToken.js";

const router = Router();

// doar calea (fără query/hash - fără identificatori în URL)
function pagePathOnly(pageUrl) {
  if (!pageUrl) return null;
  return String(pageUrl).split(/[?#]/)[0].slice(0, 500) || null;
}

async function recordAnonymousVendorReferralClick({ vendorId, pageUrl }) {
  try {
    await prisma.vendorReferralClick.create({
      data: {
        vendorId,
        pageUrl: pagePathOnly(pageUrl),
        sessionId: null,
        referrer: null,
        ipHash: null,
        userAgent: null,
      },
    });
  } catch (error) {
    // contorul nu blochează niciodată emiterea tokenului
    console.error("[public-vendor-referral] anonymous click counter failed:", error?.message || error);
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

    const pageUrl = req.query?.pageUrl
      ? String(req.query.pageUrl)
      : null;

    // contor anonim, non-blocant (fără identificatori)
    recordAnonymousVendorReferralClick({
      vendorId: vendor.id,
      pageUrl,
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
