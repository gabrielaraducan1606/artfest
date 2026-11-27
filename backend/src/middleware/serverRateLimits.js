// src/middleware/serverRateLimits.js
//
// Limitatoarele globale din server.js (/api, /api/auth/me, /api/auth/exists,
// /api/auth/login), cu cheia corectă.
//
// Bug reparat: `keyGenerator: ipKeyGenerator` primea `req` în loc de un
// string IP (express-rate-limit 8), deci fiecare cerere avea o cheie
// proprie și limitele nu se atingeau niciodată; la login cheia era
// „[object Object]|email”, adică practic per email.
//
// Pentru /api, /api/auth/me și /api/auth/exists cheia devine IP-ul clientului
// (clientIpKey: IPv4 exact, IPv6 pe /56). În producție requestul poate
// trece prin rewrite-ul Vercel (/api/:path* -> Render), iar server.js are
// `trust proxy` = 1: nu se poate verifica local dacă req.ip e clientul sau
// proxy-ul. Dacă ar fi proxy-ul, o limită per IP aplicată ar bloca TOȚI
// vizitatorii împreună. De aceea modul vine din RATE_LIMIT_IP_MODE:
//   - "observe" (implicit): numără, jurnalizează (cel mult o dată pe minut
//     per limitator) și NU blochează - comportament identic cu azi;
//   - "enforce": răspunde 429;
//   - "off": dezactivat.
// Diagnosticul periodic (o dată pe oră, fără IP-uri) arată câte chei IP
// distincte vede serverul; dacă rămân 1-3 la trafic real, req.ip e proxy-ul.
//
// /api/auth/login: păstrează EXACT protecția efectivă de azi (cheie per
// email, 20 / 10 min), acum explicit, și e mereu aplicată. Fără email
// în body cheia e IP-ul (înainte toate cererile fără email împărțeau
// aceeași cheie globală).

import rateLimit from "express-rate-limit";

import {
  classifyIp,
  clientIpKey,
  createIpDiagnostics,
} from "./customizationUploadRateLimit.js";

const RATE_LIMITED_BODY = {
  error: "rate_limited",
  message: "Prea multe cereri într-un timp scurt. Încearcă din nou peste câteva minute.",
};

export function resolveIpLimitMode(value = process.env.RATE_LIMIT_IP_MODE) {
  const mode = String(value || "").trim().toLowerCase();
  return mode === "enforce" || mode === "off" ? mode : "observe";
}

/* Cheia IP a clientului pentru limitare (vezi clientIpKey). */
export function rateLimitIpKey(req) {
  return clientIpKey(req?.ip /* ipKeyGenerator */ || "");
}

export function loginRateLimitKey(req) {
  const email = String(req?.body?.email || "").trim().toLowerCase();
  return email ? `email:${email}` : `ip:${rateLimitIpKey(req)}`;
}

/*
 * Limitator per IP cu mod observe / enforce / off.
 */
export function createIpModeLimiter({
  name,
  windowMs,
  max,
  mode = resolveIpLimitMode(),
  logger = console,
  body = RATE_LIMITED_BODY,
}) {
  let lastObserveLogAt = 0;

  return rateLimit({
    windowMs,
    limit: max,
    standardHeaders: mode === "enforce",
    legacyHeaders: false,
    skip: () => mode === "off",
    keyGenerator: (req) => rateLimitIpKey(req),
    handler: (req, res, next) => {
      if (mode === "enforce") {
        return res.status(429).json(body);
      }

      const at = Date.now();

      if (at - lastObserveLogAt > 60 * 1000) {
        lastObserveLogAt = at;
        logger.warn(`[RATE] ${name} would block (observe mode):`, {
          ipClass: classifyIp(req.ip),
          limit: max,
          windowMinutes: Math.round(windowMs / 60000),
        });
      }

      return next();
    },
  });
}

export function createServerRateLimiters({
  env = process.env,
  mode = resolveIpLimitMode(env.RATE_LIMIT_IP_MODE),
  logger = console,
  diagnostics = mode === "observe",
} = {}) {
  const apiLimiter = createIpModeLimiter({
    name: "api",
    windowMs: 15 * 60 * 1000,
    max: Number(env.RATE_API_MAX || 3000),
    mode,
    logger,
  });

  const authMeLimiter = createIpModeLimiter({
    name: "auth_me",
    windowMs: 60 * 1000,
    max: Number(env.RATE_AUTH_ME_MAX || 120),
    mode,
    logger,
  });

  const authExistsLimiter = createIpModeLimiter({
    name: "auth_exists",
    windowMs: 60 * 1000,
    max: Number(env.RATE_AUTH_EXISTS_MAX || 60),
    mode,
    logger,
  });

  const authLoginLimiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    limit: Number(env.RATE_AUTH_LOGIN_MAX || 20),
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => loginRateLimitKey(req),
  });

  const apiChain = diagnostics
    ? [createIpDiagnostics({ logger, label: "[RATE] api ip diagnostics:" }), apiLimiter]
    : [apiLimiter];

  return {
    mode,
    apiChain,
    apiLimiter,
    authMeLimiter,
    authExistsLimiter,
    authLoginLimiter,
  };
}
