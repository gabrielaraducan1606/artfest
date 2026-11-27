// src/routes/customerRequestGuestRoutes.js
//
// /api/customer-requests/guest/* - cereri de ofertă fără cont (QR flyere).
// Logica: services/customerRequestGuestService.js. Montat în server.js
// ÎNAINTEA routerului /api/customer-requests (rutele de acolo rămân
// neschimbate).
//
//   GET    /config                   fluxul e activ? (+ versiunea acordului)
//   POST   /submit                   trimite cererea -> email de confirmare (202 identic)
//   POST   /confirm   {token}        publică cererea (sau cere autentificare)
//   POST   /access    {token}        link din email -> sesiune (cookie httpOnly)
//   POST   /access-link {email}      trimite un link nou (202 identic)
//   GET    /me                       cererile vizitatorului din sesiune
//   POST   /logout                   șterge sesiunea de pe dispozitiv
//   POST   /link-account             (cont) asociază cererile cu același email verificat
//   POST   /requests/:id/images      fotografie nouă (doar după confirmare)
//   DELETE /requests/:id/images      șterge o fotografie {url}

import { Router } from "express";
import multer from "multer";
import rateLimit from "express-rate-limit";
import crypto from "node:crypto";
import { PutObjectCommand } from "@aws-sdk/client-s3";

import { prisma } from "../db.js";
import { authRequired, optionalAuth } from "../api/auth.js";
import {
  sendGuestCustomerRequestAccessEmail,
  sendGuestCustomerRequestConfirmEmail,
} from "../lib/mailer.js";
import {
  moderateMarketplaceImage,
  moderateMarketplaceMessage,
} from "../services/marketplaceMessageModeration.js";
import { notifyVendorsAboutCustomerRequest } from "../services/customerRequestVendorNotifications.js";
import {
  CUSTOMIZATION_MAX_BYTES,
  CustomizationImageError,
  processSafeImage,
} from "../services/customizationImage.js";
import { buildPublicUrl, r2Client } from "../services/r2Storage.js";
import { createIpModeLimiter, resolveIpLimitMode } from "../middleware/serverRateLimits.js";
import {
  GUEST_CONSENT_VERSION,
  LIMITS,
  clearGuestSessionCookie,
  confirmGuestRequest,
  exchangeAccessToken,
  findGuestOwnedRequest,
  isGuestRequestsEnabled,
  linkGuestRequestsToUser,
  listGuestRequests,
  normalizeGuestEmail,
  readGuestSession,
  requestAccessLink,
  setGuestRequestImages,
  setGuestSessionCookie,
  submitGuestRequest,
} from "../services/customerRequestGuestService.js";

const MODERATION_TECHNICAL_REASONS = new Set([
  "text_moderation_failed",
  "text_moderation_invalid_response",
  "text_moderation_ambiguous_response",
]);

const IMAGE_MODERATION_TECHNICAL_REASONS = new Set([
  "image_moderation_failed",
  "image_moderation_invalid_response",
  "image_moderation_ambiguous_response",
]);

const mailer = {
  sendGuestCustomerRequestConfirmEmail,
  sendGuestCustomerRequestAccessEmail,
};

/* email-ul pleacă DUPĂ răspuns: timpul de răspuns nu dezvăluie ramura */
function runAfterResponse(task, label) {
  if (typeof task !== "function") return;
  setImmediate(() => {
    Promise.resolve()
      .then(task)
      .catch((error) => console.error(`[customer-request-guest] ${label} failed:`, error?.message || error));
  });
}

function moderateText({ title, description }) {
  const text = [title, description].filter(Boolean).join("\n").trim();
  if (!text) return { allowed: true };
  return moderateMarketplaceMessage({ text, senderType: "USER" });
}

function sendModeration(res, moderation) {
  const technical = MODERATION_TECHNICAL_REASONS.has(moderation?.reason);
  return res.status(technical ? 503 : 422).json({
    error: technical ? "moderation_unavailable" : "customer_request_blocked",
    reason: moderation?.reason || "not_allowed",
    detections: moderation?.detections || [],
    message: technical
      ? "Cererea nu a putut fi verificată momentan. Încearcă din nou peste câteva secunde."
      : "Cererea nu poate fi publicată deoarece conține sau sugerează date de contact, comunicare, comandă ori plată în afara platformei.",
  });
}

function sendResult(res, result) {
  if (result?.moderation) return sendModeration(res, result.moderation);
  return res.status(result.status).json(result.body);
}

const emailBody = { error: "guest_rate_limited", message: "Prea multe încercări pentru această adresă. Încearcă din nou mai târziu." };

export function createCustomerRequestGuestRouter({
  db = prisma,
  env = process.env,
  ipLimitMode = resolveIpLimitMode(env.RATE_LIMIT_IP_MODE),
  moderate = moderateText,
  moderateImage = moderateMarketplaceImage,
  processImage = processSafeImage,
  storeImage = storeGuestImage,
  notifyVendors = notifyVendorsAboutCustomerRequest,
  mail = mailer,
  defer = runAfterResponse,
} = {}) {
  const router = Router();

  /* ---------- limite ---------- */

  // per IP (modul observe / enforce din RATE_LIMIT_IP_MODE - vezi serverRateLimits.js)
  const ipSubmitLimiter = createIpModeLimiter({ name: "guest_submit", windowMs: 60 * 60 * 1000, max: 10, mode: ipLimitMode });
  const ipTokenLimiter = createIpModeLimiter({ name: "guest_token", windowMs: 15 * 60 * 1000, max: 30, mode: ipLimitMode });

  // per email: mereu aplicat (nu depinde de proxy)
  const emailLimiter = (max, windowMs) =>
    rateLimit({
      windowMs,
      limit: max,
      standardHeaders: true,
      legacyHeaders: false,
      skip: (req) => !normalizeGuestEmail(req.body?.email),
      keyGenerator: (req) => `email:${normalizeGuestEmail(req.body?.email)}`,
      message: emailBody,
    });

  const submitEmailLimiter = emailLimiter(8, 60 * 60 * 1000);
  const accessLinkEmailLimiter = emailLimiter(3, 60 * 60 * 1000);

  const imageGuestLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 30,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => `guest:${req.guest.id}`,
    message: { error: "rate_limited", message: "Ai încărcat multe fotografii într-un timp scurt. Încearcă din nou mai târziu." },
  });

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: CUSTOMIZATION_MAX_BYTES, files: 1, fields: 5, parts: 6 },
  });

  /* ---------- middleware ---------- */

  const requireEnabled = (_req, res, next) => {
    if (!isGuestRequestsEnabled(env)) {
      return res.status(404).json({ error: "guest_requests_disabled", message: "Funcția nu este disponibilă momentan." });
    }
    return next();
  };

  const loadGuest = async (req, res, next) => {
    try {
      const guest = await readGuestSession(req, { db, env });
      if (!guest) {
        return res.status(401).json({
          error: "guest_session_required",
          message: "Deschide din nou linkul primit pe email sau cere un link nou.",
        });
      }
      req.guest = guest;
      return next();
    } catch (error) {
      return next(error);
    }
  };

  /* ---------- rute ---------- */

  router.get("/config", (_req, res) => {
    res.json({ enabled: isGuestRequestsEnabled(env), consentVersion: GUEST_CONSENT_VERSION });
  });

  router.post("/submit", requireEnabled, ipSubmitLimiter, submitEmailLimiter, async (req, res) => {
    try {
      const result = await submitGuestRequest({
        db,
        body: req.body || {},
        ip: req.ip,
        userAgent: req.get("user-agent") || null,
        moderateText: moderate,
        mailer: mail,
        env,
        enforceIpLimit: ipLimitMode === "enforce",
      });
      if (result.after) defer(result.after, "confirm email");
      return sendResult(res, result);
    } catch (error) {
      console.error("[customer-request-guest] submit failed:", error);
      return res.status(500).json({ error: "guest_submit_failed", message: "Cererea nu a putut fi trimisă. Încearcă din nou." });
    }
  });

  router.post("/confirm", requireEnabled, ipTokenLimiter, optionalAuth, async (req, res) => {
    try {
      const result = await confirmGuestRequest({
        db,
        token: req.body?.token,
        authUserId: req.user?.sub || req.user?.id || null,
      });

      if (!result.ok) return sendResult(res, result);

      if (result.guest) setGuestSessionCookie(req, res, result.guest);

      if (result.request) {
        const published = result.request;
        defer(() => notifyVendors(published), "vendor match");
      }

      return res.status(result.status).json({
        ok: true,
        outcome: result.outcome,
        requestId: result.requestId,
        wantsAccount: Boolean(result.wantsAccount),
        // doar deținătorului linkului (a dovedit accesul la căsuța de email), pentru „Creează cont”
        email: result.outcome === "published_guest" ? result.email : undefined,
      });
    } catch (error) {
      console.error("[customer-request-guest] confirm failed:", error);
      return res.status(500).json({ error: "guest_confirm_failed", message: "Cererea nu a putut fi publicată. Încearcă din nou." });
    }
  });

  router.post("/access", requireEnabled, ipTokenLimiter, async (req, res) => {
    try {
      const result = await exchangeAccessToken({ db, token: req.body?.token });
      if (!result.ok) return sendResult(res, result);

      setGuestSessionCookie(req, res, result.guest);
      const requests = await listGuestRequests({ db, guestId: result.guest.id });
      return res.json({ ok: true, guest: { displayName: result.guest.displayName }, requests });
    } catch (error) {
      console.error("[customer-request-guest] access failed:", error);
      return res.status(500).json({ error: "guest_access_failed", message: "Linkul nu a putut fi verificat. Încearcă din nou." });
    }
  });

  router.post("/access-link", requireEnabled, ipTokenLimiter, accessLinkEmailLimiter, async (req, res) => {
    try {
      const result = await requestAccessLink({ db, email: req.body?.email, mailer: mail, env });
      if (result.after) defer(result.after, "access email");
      return sendResult(res, result);
    } catch (error) {
      console.error("[customer-request-guest] access-link failed:", error);
      return res.status(500).json({ error: "guest_access_link_failed", message: "Nu am putut trimite linkul. Încearcă din nou." });
    }
  });

  router.get("/me", requireEnabled, loadGuest, async (req, res) => {
    const requests = await listGuestRequests({ db, guestId: req.guest.id });
    res.setHeader("Cache-Control", "no-store");
    return res.json({ ok: true, guest: { displayName: req.guest.displayName }, requests });
  });

  router.post("/logout", (req, res) => {
    clearGuestSessionCookie(req, res);
    return res.json({ ok: true });
  });

  router.post("/link-account", authRequired, async (req, res) => {
    try {
      const result = await linkGuestRequestsToUser({ db, userId: req.user?.sub || req.user?.id });
      return res.json({ ok: true, linked: result.linked });
    } catch (error) {
      console.error("[customer-request-guest] link-account failed:", error);
      return res.status(500).json({ error: "guest_link_failed", message: "Cererile nu au putut fi asociate cu contul." });
    }
  });

  router.post("/requests/:id/images", requireEnabled, loadGuest, imageGuestLimiter, (req, res) => {
    upload.single("file")(req, res, async (uploadError) => {
      try {
        if (uploadError) {
          if (uploadError.code === "LIMIT_FILE_SIZE") {
            return res.status(413).json({ error: "file_too_large", message: "Fotografia este prea mare (max 10 MB)." });
          }
          return res.status(400).json({ error: "invalid_upload", message: "Trimite o singură fotografie." });
        }

        const request = await findGuestOwnedRequest({ db, guestId: req.guest.id, requestId: req.params.id });
        if (!request) return res.status(404).json({ error: "customer_request_not_found", message: "Cererea nu există." });
        if (request.status !== "OPEN") {
          return res.status(409).json({ error: "customer_request_not_open", message: "Cererea nu mai primește modificări." });
        }
        if ((request.images || []).length >= LIMITS.maxImages) {
          return res.status(409).json({ error: "too_many_images", message: `Poți adăuga cel mult ${LIMITS.maxImages} fotografii.` });
        }
        if (!req.file) return res.status(400).json({ error: "no_file", message: "Nu ai trimis nicio fotografie." });

        const processed = await processImage(req.file.buffer);

        const moderation = await moderateImage({
          buffer: processed.buffer,
          mimeType: "image/jpeg",
          filename: req.file.originalname,
          senderType: "USER",
        });

        if (!moderation?.allowed) {
          const technical = IMAGE_MODERATION_TECHNICAL_REASONS.has(moderation?.reason);
          return res.status(technical ? 503 : 422).json({
            error: technical ? "image_moderation_unavailable" : "image_blocked",
            message: technical
              ? "Fotografia nu a putut fi verificată momentan. Încearcă din nou."
              : "Fotografia pare să conțină date de contact (telefon, email, link, cod QR). Încarcă o variantă fără ele.",
          });
        }

        const url = await storeImage({ guestId: req.guest.id, buffer: processed.buffer });

        // recitim: între timp poate s-a mai adăugat o fotografie
        const fresh = await findGuestOwnedRequest({ db, guestId: req.guest.id, requestId: request.id });
        const images = [...(fresh?.images || [])];
        if (images.length >= LIMITS.maxImages) {
          return res.status(409).json({ error: "too_many_images", message: `Poți adăuga cel mult ${LIMITS.maxImages} fotografii.` });
        }
        images.push(url);
        await setGuestRequestImages({ db, requestId: request.id, images });

        return res.status(201).json({ ok: true, url, images });
      } catch (error) {
        if (error instanceof CustomizationImageError) {
          if (error.retryAfterSeconds) res.setHeader("Retry-After", String(error.retryAfterSeconds));
          return res.status(error.status).json({ error: error.code, message: error.message });
        }
        console.error("[customer-request-guest] image upload failed:", error);
        return res.status(500).json({ error: "guest_image_failed", message: "Fotografia nu a putut fi încărcată. Încearcă din nou." });
      }
    });
  });

  router.delete("/requests/:id/images", requireEnabled, loadGuest, async (req, res) => {
    try {
      const request = await findGuestOwnedRequest({ db, guestId: req.guest.id, requestId: req.params.id });
      if (!request) return res.status(404).json({ error: "customer_request_not_found", message: "Cererea nu există." });

      const url = String(req.body?.url || "");
      const images = (request.images || []).filter((item) => item !== url);
      if (images.length === (request.images || []).length) {
        return res.status(404).json({ error: "image_not_found", message: "Fotografia nu există." });
      }

      await setGuestRequestImages({ db, requestId: request.id, images });
      return res.json({ ok: true, images });
    } catch (error) {
      console.error("[customer-request-guest] image delete failed:", error);
      return res.status(500).json({ error: "guest_image_delete_failed", message: "Fotografia nu a putut fi ștearsă." });
    }
  });

  return router;
}

/* R2: customer-requests/guest-<id>/<timp>-<aleator>.jpg (JPEG re-encodat, fără EXIF) */
async function storeGuestImage({ guestId, buffer }) {
  const key = `customer-requests/guest-${guestId}/${Date.now()}-${crypto.randomBytes(6).toString("hex")}.jpg`;
  await r2Client.send(
    new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: key,
      Body: buffer,
      ContentType: "image/jpeg",
      CacheControl: "public, max-age=31536000, immutable",
    })
  );
  return buildPublicUrl(key);
}

export default createCustomerRequestGuestRouter();
