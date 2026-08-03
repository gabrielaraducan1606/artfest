// src/routes/admin/userConsentsRoutes.js

import { Router } from "express";
import { prisma } from "../db.js";
import {
  authRequired,
  enforceTokenVersion,
} from "../api/auth.js";

const router = Router();

function sortNewestFirst(items = []) {
  return [...items].sort((a, b) => {
    const dateA = new Date(a?.givenAt || 0).getTime();
    const dateB = new Date(b?.givenAt || 0).getTime();

    return dateB - dateA;
  });
}

function buildConsentHistory(consents, documents) {
  return sortNewestFirst(
    consents.filter((consent) =>
      documents.includes(consent.document)
    )
  ).map((consent) => ({
    id: consent.id,
    document: consent.document,
    version: consent.version,
    checksum: consent.checksum || null,
    givenAt: consent.givenAt,
    ip: consent.ip || null,
    ua: consent.ua || null,
  }));
}

/**
 * GET /api/admin/user-consents
 *
 * Returnează, pentru fiecare utilizator:
 * - ultima versiune acceptată pentru fiecare document;
 * - istoricul complet al versiunilor acceptate.
 *
 * Nu șterge și nu modifică acceptările existente.
 */
router.get(
  "/user-consents",
  authRequired,
  enforceTokenVersion,
  async (req, res) => {
    try {
      if (req.user?.role !== "ADMIN") {
        return res.status(403).json({
          error: "forbidden",
        });
      }

      const users = await prisma.user.findMany({
        select: {
          id: true,
          email: true,
          createdAt: true,

          UserConsent: {
            select: {
              id: true,
              document: true,
              version: true,
              checksum: true,
              givenAt: true,
              ip: true,
              ua: true,
            },

            orderBy: {
              givenAt: "desc",
            },
          },
        },

        orderBy: {
          createdAt: "desc",
        },

        take: 500,
      });

      const rows = users.map((user) => {
        const tosHistory = buildConsentHistory(
          user.UserConsent,
          ["TOS"]
        );

        const privacyHistory = buildConsentHistory(
          user.UserConsent,
          ["PRIVACY_ACK", "PRIVACY"]
        );

        const cookiesHistory = buildConsentHistory(
          user.UserConsent,
          ["COOKIES_ACK", "COOKIES"]
        );

        const returnsHistory = buildConsentHistory(
          user.UserConsent,
          ["RETURNS_POLICY_ACK"]
        );

        const marketingHistory = buildConsentHistory(
          user.UserConsent,
          ["MARKETING_EMAIL_OPTIN", "MARKETING"]
        );

        const latestTos =
          tosHistory[0] || null;

        const latestPrivacy =
          privacyHistory[0] || null;

        const latestCookies =
          cookiesHistory[0] || null;

        const latestReturns =
          returnsHistory[0] || null;

        const latestMarketing =
          marketingHistory[0] || null;

        return {
          userId: user.id,
          email: user.email,
          createdAt: user.createdAt,

          tosAccepted: !!latestTos,
          tosVersion:
            latestTos?.version || null,
          tosGivenAt:
            latestTos?.givenAt || null,
          tosHistory,

          privacyAccepted:
            !!latestPrivacy,
          privacyVersion:
            latestPrivacy?.version || null,
          privacyGivenAt:
            latestPrivacy?.givenAt || null,
          privacyHistory,

          cookiesAccepted:
            !!latestCookies,
          cookiesVersion:
            latestCookies?.version || null,
          cookiesGivenAt:
            latestCookies?.givenAt || null,
          cookiesHistory,

          returnsAccepted:
            !!latestReturns,
          returnsVersion:
            latestReturns?.version || null,
          returnsGivenAt:
            latestReturns?.givenAt || null,
          returnsHistory,

          marketingOptIn:
            !!latestMarketing,
          marketingVersion:
            latestMarketing?.version || null,
          marketingGivenAt:
            latestMarketing?.givenAt || null,
          marketingHistory,
        };
      });

      return res.json({
        consents: rows,
      });
    } catch (error) {
      console.error(
        "admin user-consents error:",
        error
      );

      return res.status(500).json({
        error: "internal_error",
      });
    }
  }
);

export default router;