// backend/src/routes/adminInfluencerTermsRoutes.js

/*
 * Admin - status de acceptare a Acordului Programului de Influenceri
 * (influencer_terms), pentru tab-ul nou „Influenceri” din Admin ->
 * Politici și consimțăminte.
 *
 * AUDIT (înainte de a scrie acest fișier):
 * - /api/admin/user-consents (adminUserConsentPolicies.js) e
 *   generic PE UserConsent, dar per USER - nu are join cu
 *   InfluencerProfile (status cont, data intrării în program), care
 *   sunt cerute explicit în UI.
 * - /api/admin/influencers (adminInfluencersRoutes.js, folosit de
 *   tab-ul Marketing) are deja join-ul InfluencerProfile+User+
 *   UserConsent(INFLUENCER_TERMS, take:1) - dar DOAR ultima
 *   acceptare (fără istoric complet cu checksum/ip/ua), nicio
 *   comparație cu versiunea curentă din legal manifest, și rulează
 *   deja N+1 (getInfluencerConfirmedTotals per influencer) - a-l
 *   extinde acolo ar încărca inutil un endpoint deja greu, folosit
 *   de o pagină diferită (Marketing), pentru un tab care nu are
 *   nevoie de acele date financiare.
 * - /api/admin/vendor-acceptances (adminVendorPolicies.js) e legat
 *   de un sistem PARALEL, DB-driven (VendorPolicy/VendorAcceptance)
 *   - nu se aplică deloc la influencer_terms (care e file-based,
 *   via legal/manifest.yml + UserConsent).
 *
 * Concluzie: rută NOUĂ, minimă, dedicată - exact ce a sugerat
 * userul conceptual (GET /api/admin/legal/influencers), dar
 * consolidată într-un singur apel (listă + istoric complet embedat
 * per rând, nu un endpoint separat de istoric) - la scara unui
 * admin tool, un singur query e suficient și mai simplu decât
 * lazy-loading pe rând.
 *
 * Read-only: NU creează, NU modifică, NU șterge UserConsent.
 * Acceptarea rămâne exclusiv acțiunea influencerului
 * (POST /api/influencer/terms/accept).
 */

import { Router } from "express";
import { prisma } from "../db.js";
import { authRequired, requireRole } from "../api/auth.js";

import {
  computeInfluencerTermsState,
  getInfluencerTermsTarget,
  INFLUENCER_TERMS_CONSENT_DOCUMENT,
} from "../services/influencerTermsStatus.js";

import { serializePayoutProfileSummary } from "../services/influencerPayoutProfile.js";

const router = Router();

router.use(authRequired, requireRole("ADMIN"));

function sortNewestFirst(items = []) {
  return [...items].sort(
    (a, b) =>
      new Date(b?.givenAt || 0).getTime() -
      new Date(a?.givenAt || 0).getTime()
  );
}

/*
 * GET /api/admin/legal/influencers
 *
 * Listă influenceri + status curent al Acordului Programului de
 * Influenceri + istoric complet de acceptări (INFLUENCER_TERMS).
 */
router.get("/influencers", async (_req, res) => {
  try {
    // versiunea PUBLICATĂ + cererea deschisă de reacceptare (dacă există);
    // schimbarea manifestului nu mai face pe nimeni "outdated"
    const { published, requirement } = await getInfluencerTermsTarget();

    const profiles = await prisma.influencerProfile.findMany({
      orderBy: { createdAt: "desc" },

      select: {
        /*
         * IMPORTANT (identitate): InfluencerProfile.id NU e
         * User.id. UserConsent e legat de User.id (userId), deci
         * istoricul se caută după `userId`, nu după `id`-ul
         * profilului. Expunem explicit AMBELE în răspuns, ca să nu
         * existe ambiguitate în frontend.
         */
        id: true,
        userId: true,
        displayName: true,
        status: true,
        createdAt: true,

        /*
         * Read-only, doar status - NICIODATĂ IBAN/taxId/adresă în
         * această listă (vezi serializePayoutProfileSummary).
         */
        payoutProfile: {
          select: {
            isComplete: true,
            verificationStatus: true,
            beneficiaryType: true,
          },
        },

        user: {
          select: {
            id: true,
            email: true,
            name: true,
            firstName: true,
            lastName: true,

            UserConsent: {
              where: {
                document: INFLUENCER_TERMS_CONSENT_DOCUMENT,
              },

              select: {
                id: true,
                version: true,
                checksum: true,
                givenAt: true,
                ip: true,
                ua: true,
              },

              orderBy: { givenAt: "desc" },
            },
          },
        },
      },
    });

    const influencers = profiles.map((profile) => {
      const history = sortNewestFirst(profile.user?.UserConsent || []);
      const latest = history[0] || null;

      const acceptedVersion = latest?.version || null;

      const state = computeInfluencerTermsState({
        published,
        requirement,
        consentVersions: history.map((item) => item.version),
      });

      const outdated = state.outdated;

      const fallbackName = [
        profile.user?.firstName,
        profile.user?.lastName,
      ]
        .filter(Boolean)
        .join(" ")
        .trim();

      // NEVER_ACCEPTED: niciun acord; OUTDATED: cerere de reacceptare
      // deschisă și neonorată; UPDATED: acceptă versiunea publicată;
      // OLDER_VERSION: a acceptat o versiune anterioară, fără cerere
      // deschisă (informativ, nu blochează)
      const termsStatus = !latest
        ? "NEVER_ACCEPTED"
        : outdated
        ? "OUTDATED"
        : state.acceptedPublished
        ? "UPDATED"
        : "OLDER_VERSION";

      return {
        influencerId: profile.id,
        userId: profile.userId,

        name:
          profile.displayName ||
          profile.user?.name ||
          fallbackName ||
          profile.user?.email ||
          "Influencer",

        email: profile.user?.email || "",

        influencerStatus: profile.status,
        joinedAt: profile.createdAt,

        payoutProfile: serializePayoutProfileSummary(profile.payoutProfile),

        acceptedVersion,
        acceptedAt: latest?.givenAt || null,
        outdated,
        blocking: state.blocking,
        termsStatus,

        history: history.map((item) => ({
          id: item.id,
          document: INFLUENCER_TERMS_CONSENT_DOCUMENT,
          version: item.version,
          checksum: item.checksum || null,
          givenAt: item.givenAt,
          ip: item.ip || null,
          ua: item.ua || null,
        })),
      };
    });

    return res.json({
      ok: true,

      currentVersion: published ? String(published.version) : null,
      publishedVersion: published ? String(published.version) : null,
      requiredVersion: requirement ? requirement.version : null,
      reacceptance: requirement
        ? {
            version: requirement.version,
            campaignId: requirement.campaignId,
            requestedAt: requirement.createdAt,
            deadlineAt: requirement.deadlineAt,
          }
        : null,
      documentUrl: published?.url || null,

      influencers,
    });
  } catch (error) {
    console.error(
      "[adminInfluencerTermsRoutes] GET /influencers error:",
      error
    );

    return res.status(500).json({
      ok: false,
      error: "admin_influencer_terms_failed",
    });
  }
});

export default router;
