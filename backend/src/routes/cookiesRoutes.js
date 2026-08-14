// src/routes/cookiesRoutes.js

import { Router } from "express";
import crypto from "crypto";

import { prisma } from "../db.js";
import { authRequired } from "../api/auth.js";

const router = Router();

/* =========================================================
   CONFIG
========================================================= */

const CONSENT_VERSION = "1.0";

const ALLOWED_ACTIONS = new Set([
  "ACCEPT_ALL",
  "NECESSARY_ONLY",
  "CUSTOM",
  "WITHDRAW",
]);

const ALLOWED_SOURCES = new Set([
  "COOKIE_BANNER",
  "COOKIE_PREFERENCES",
]);

/* =========================================================
   HELPERS
========================================================= */

function getBearerToken(req) {
  const auth =
    req.headers.authorization || "";

  const match =
    String(auth).match(
      /^Bearer\s+(.+)$/i
    );

  return match?.[1] || null;
}

/*
 * Ruta trebuie să funcționeze și pentru guest.
 *
 * Dacă există token:
 * folosim middleware-ul oficial authRequired.
 *
 * Dacă nu există token:
 * continuăm fără autentificare.
 */
function optionalAuth(
  req,
  res,
  next
) {
  const cookieToken =
    req.cookies?.token;

  const bearerToken =
    getBearerToken(req);

  if (
    !cookieToken &&
    !bearerToken
  ) {
    return next();
  }

  return authRequired(
    req,
    res,
    next
  );
}

function cleanString(
  value,
  maxLength = 255
) {
  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  const text =
    String(value).trim();

  if (!text) {
    return null;
  }

  return text.slice(
    0,
    maxLength
  );
}

function hashIp(ip) {
  if (!ip) {
    return null;
  }

  /*
   * Folosim un secret server-side.
   * Nu salvăm IP-ul brut.
   */
  const secret =
    process.env
      .COOKIE_CONSENT_HASH_SECRET ||
    process.env.JWT_SECRET;

  if (!secret) {
    return null;
  }

  return crypto
    .createHmac(
      "sha256",
      String(secret)
    )
    .update(
      String(ip)
    )
    .digest("hex");
}

function inferAction({
  analytics,
  marketing,
}) {
  if (
    analytics === true &&
    marketing === true
  ) {
    return "ACCEPT_ALL";
  }

  if (
    analytics === false &&
    marketing === false
  ) {
    return "NECESSARY_ONLY";
  }

  return "CUSTOM";
}

/* =========================================================
   POST /api/cookies/consent
========================================================= */

router.post(
  "/consent",
  optionalAuth,
  async (
    req,
    res,
    next
  ) => {
    try {
      const body =
        req.body || {};

      /*
       * Cookie-urile necesare
       * nu pot fi dezactivate.
       */
      const necessary =
        true;

      const analytics =
        body.analytics === true;

      const marketing =
        body.marketing === true;

      const anonymousId =
        cleanString(
          body.anonymousId,
          100
        );

      const requestedAction =
        cleanString(
          body.action,
          32
        );

      const action =
        requestedAction &&
        ALLOWED_ACTIONS.has(
          requestedAction
        )
          ? requestedAction
          : inferAction({
              analytics,
              marketing,
            });

      const requestedSource =
        cleanString(
          body.source,
          64
        );

      const source =
        requestedSource &&
        ALLOWED_SOURCES.has(
          requestedSource
        )
          ? requestedSource
          : "COOKIE_BANNER";

      const consentVersion =
        cleanString(
          body.consentVersion,
          32
        ) ||
        CONSENT_VERSION;

      /*
       * authRequired setează
       * req.user.sub în proiectul tău.
       */
      const userId =
        req.user?.sub ||
        null;

      /*
       * Pentru guest trebuie
       * să avem anonymousId.
       */
      if (
        !userId &&
        !anonymousId
      ) {
        return res
          .status(400)
          .json({
            error:
              "anonymous_id_required",
          });
      }

      /*
       * Dacă avem user logat,
       * verificăm că există.
       */
      let resolvedUserId =
        null;

      if (userId) {
        const user =
          await prisma.user.findUnique({
            where: {
              id: userId,
            },

            select: {
              id: true,
            },
          });

        resolvedUserId =
          user?.id || null;
      }

      const created =
        await prisma.cookieConsent.create({
          data: {
            userId:
              resolvedUserId,

            anonymousId,

            necessary,

            analytics,

            marketing,

            consentVersion,

            action,

            source,

            ipHash:
              hashIp(
                req.ip
              ),

            userAgent:
              cleanString(
                req.headers[
                  "user-agent"
                ],
                500
              ),
          },

          select: {
            id: true,

            necessary:
              true,

            analytics:
              true,

            marketing:
              true,

            consentVersion:
              true,

            action:
              true,

            source:
              true,

            createdAt:
              true,
          },
        });

      return res
        .status(201)
        .json({
          ok: true,

          consent:
            created,
        });
    } catch (
      error
    ) {
      next(
        error
      );
    }
  }
);

export default router;