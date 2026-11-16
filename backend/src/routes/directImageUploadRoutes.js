// backend/src/routes/directImageUploadRoutes.js
//
// POST /api/upload/direct/intent    { purpose, contentType, size }  -> URL PUT semnat (R2)
// POST /api/upload/direct/complete  { purpose, uploadId }           -> URL definitiv
//
// Logica și verificările: services/directImageUpload.js. Oprit implicit
// (DIRECT_IMAGE_UPLOAD_ENABLED) -> 404 direct_upload_disabled, iar browserul
// folosește ruta veche POST /api/upload/products.

import { Router } from "express";
import { authRequired, enforceTokenVersion } from "../api/auth.js";
import { prisma } from "../db.js";
import {
  DirectUploadError,
  completeDirectUpload,
  createDirectUploadIntent,
  createDirectUploadLimiter,
  directImageUploadEnabled,
} from "../services/directImageUpload.js";

/*
 * Confirmarea citește fișierul (max 10 MB) în memorie: cel mult
 * DIRECT_IMAGE_COMPLETE_CONCURRENCY confirmări simultane (implicit 4), restul
 * primesc 503 + Retry-After scurt (browserul reîncearcă automat).
 */
export function createCompleteGate(max) {
  let active = 0;
  return {
    enter() {
      if (active >= max) return false;
      active += 1;
      return true;
    },
    leave() {
      active = Math.max(0, active - 1);
    },
  };
}

/**
 * @param {{ env?: object, db?: object, deps?: object, limiter?: object }} [options] injectabile în teste
 */
export function createDirectImageUploadRouter({ env = process.env, db = prisma, deps, limiter } = {}) {
  const router = Router();
  const intentLimiter = limiter || createDirectUploadLimiter(env);
  const gate = createCompleteGate(Math.max(1, Number.parseInt(env.DIRECT_IMAGE_COMPLETE_CONCURRENCY, 10) || 4));
  const serviceOptions = deps ? { deps } : {};

  // comutatorul se citește la fiecare cerere: revenire fără deploy de cod (doar env + restart)
  router.use((req, res, next) => {
    if (!directImageUploadEnabled(env)) {
      return res.status(404).json({ error: "direct_upload_disabled", fallback: true });
    }
    next();
  });

  router.use(authRequired, enforceTokenVersion);

  // rolul din BAZA DE DATE (nu doar din token) + cont activ
  router.use(async (req, res, next) => {
    try {
      const user = await db.user.findUnique({
        where: { id: req.user.sub },
        select: { id: true, role: true, locked: true },
      });
      if (!user) return res.status(401).json({ error: "unauthenticated" });
      if (user.locked) return res.status(403).json({ error: "account_locked" });
      req.directUploadUser = user;
      next();
    } catch (error) {
      console.error("[DIRECT UPLOAD] verificarea utilizatorului a eșuat:", error?.message || error);
      res.status(500).json({ error: "auth_check_failed" });
    }
  });

  const send = (res, error, context) => {
    if (error instanceof DirectUploadError) {
      if (error.retryAfterSeconds) res.setHeader("Retry-After", String(error.retryAfterSeconds));
      return res.status(error.status).json({
        error: error.code,
        message: error.message,
        ...(error.fallback ? { fallback: true } : {}),
      });
    }
    console.error(`[DIRECT UPLOAD] ${context}:`, error?.name || "", error?.message || error);
    res.setHeader("Retry-After", "3");
    return res.status(503).json({
      error: "storage_unavailable",
      message: "Nu am putut salva fotografia acum. Reîncercăm automat.",
    });
  };

  router.post("/intent", async (req, res) => {
    try {
      const body = req.body && typeof req.body === "object" ? req.body : {};
      const intent = await createDirectUploadIntent(
        {
          userId: req.directUploadUser.id,
          role: req.directUploadUser.role,
          purpose: String(body.purpose || ""),
          contentType: String(body.contentType || ""),
          size: body.size,
        },
        { ...serviceOptions, limiter: intentLimiter }
      );
      res.setHeader("Cache-Control", "no-store");
      return res.json({ ok: true, ...intent });
    } catch (error) {
      return send(res, error, "intent");
    }
  });

  router.post("/complete", async (req, res) => {
    if (!gate.enter()) {
      res.setHeader("Retry-After", "2");
      return res.status(503).json({ error: "server_busy", reason: "queue", message: "Reîncercăm automat în câteva secunde." });
    }
    try {
      const body = req.body && typeof req.body === "object" ? req.body : {};
      const result = await completeDirectUpload(
        {
          userId: req.directUploadUser.id,
          role: req.directUploadUser.role,
          purpose: String(body.purpose || ""),
          uploadId: String(body.uploadId || ""),
        },
        serviceOptions
      );
      // același format ca POST /api/upload/products (url / urls / items)
      return res.json({ ok: true, ...result, items: [result], urls: [result.url] });
    } catch (error) {
      return send(res, error, "complete");
    } finally {
      gate.leave();
    }
  });

  return router;
}

export default createDirectImageUploadRouter();
