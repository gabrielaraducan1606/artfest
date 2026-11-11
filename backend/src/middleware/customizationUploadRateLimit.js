// src/middleware/customizationUploadRateLimit.js
//
// Limitare pentru POST /api/upload/customization (publică - guest permis).
// Separată de apiLimiter-ul global din server.js (neatins aici).
//
// 1) Per cont (utilizator autentificat): mereu activă, cheie = userId.
//    Implicit 30 / 10 min (RATE_CUSTOMIZATION_UPLOAD_USER_MAX).
//
// 2) Per IP: cheie = ipKeyGenerator(req.ip, 56) - IPv4 exact, IPv6 grupat
//    pe /56 (altfel un singur client poate roti adrese din propriul
//    prefix). Implicit 40 / 10 min (RATE_CUSTOMIZATION_UPLOAD_IP_MAX).
//    Modul vine din CUSTOMIZATION_UPLOAD_IP_LIMIT:
//      - "observe" (implicit): numără și jurnalizează, NU blochează;
//      - "enforce": răspunde 429;
//      - "off": dezactivat.
//    De ce nu "enforce" implicit: în producție requestul trece prin
//    rewrite-ul Vercel (/api/:path* -> Render), iar server.js are
//    `trust proxy` = 1. Nu am putut verifica fără producție dacă req.ip
//    este IP-ul clientului sau al proxy-ului Vercel; dacă e al doilea,
//    o limită per IP i-ar trata pe toți clienții ca pe același IP.
//    Jurnalul de diagnostic de mai jos (fără IP-uri) arată asta.
//
// Fără DB: memory store, per instanță (ca restul limitelor).

import net from "node:net";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";

const RATE_LIMITED_BODY = {
  error: "rate_limited",
  message:
    "Ai încărcat prea multe fotografii într-un timp scurt. Încearcă din nou peste câteva minute.",
};

const DIAGNOSTIC_INTERVAL_MS = 60 * 60 * 1000;

export function resolveCustomizationIpLimitMode(
  value = process.env.CUSTOMIZATION_UPLOAD_IP_LIMIT
) {
  const mode = String(value || "").trim().toLowerCase();
  return mode === "enforce" || mode === "off" ? mode : "observe";
}

/*
 * Cheia de limitare pentru o adresă: IPv4 ca atare, IPv6 pe /56.
 * IPv4 mapat în IPv6 (::ffff:1.2.3.4, cum îl raportează un socket
 * dual-stack) e tratat ca IPv4-ul lui, nu ca o rețea IPv6 separată.
 */
export function clientIpKey(ip = "") {
  let value = String(ip || "").trim();

  if (/^::ffff:\d+\.\d+\.\d+\.\d+$/i.test(value)) value = value.slice(7);

  return ipKeyGenerator(value, 56);
}

/* Clasa adresei (fără adresa propriu-zisă) - pentru diagnostic. */
export function classifyIp(ip = "") {
  let value = String(ip || "").trim();

  if (value.startsWith("::ffff:")) value = value.slice(7);

  const family = net.isIP(value);

  if (!family) return "unknown";

  if (family === 4) {
    const [a, b] = value.split(".").map(Number);

    if (a === 127) return "loopback";
    if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) {
      return "private";
    }
    if (a === 100 && b >= 64 && b <= 127) return "cgnat";

    return "public-v4";
  }

  const lower = value.toLowerCase();

  if (lower === "::1") return "loopback";
  if (/^f[cd]/.test(lower) || /^fe[89ab]/.test(lower)) return "private";

  return "public-v6";
}

function forwardedForCount(req) {
  const raw = req.headers?.["x-forwarded-for"];

  if (!raw) return 0;

  return String(raw)
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean).length;
}

/*
 * Sumar periodic (cel mult o dată pe oră): câte requesturi, câte chei IP
 * distincte, ce clase de adrese vede req.ip și câte intrări are
 * X-Forwarded-For. Dacă "distinctIpKeys" rămâne 1-3 la zeci de upload-uri
 * de la clienți diferiți, req.ip este proxy-ul, nu clientul.
 */
export function createIpDiagnostics({ logger = console, intervalMs = DIAGNOSTIC_INTERVAL_MS, now = Date.now } = {}) {
  let windowStart = now();
  let requests = 0;
  let keys = new Set();
  let ipClasses = {};
  let xffCounts = {};
  let vercelHeader = 0;

  const flush = () => {
    if (requests > 0) {
      logger.info("[UPLOAD] customization ip diagnostics:", {
        windowMinutes: Math.round((now() - windowStart) / 60000),
        requests,
        distinctIpKeys: keys.size,
        reqIpClasses: ipClasses,
        forwardedForEntries: xffCounts,
        withVercelForwardedHeader: vercelHeader,
      });
    }

    windowStart = now();
    requests = 0;
    keys = new Set();
    ipClasses = {};
    xffCounts = {};
    vercelHeader = 0;
  };

  return function customizationIpDiagnostics(req, _res, next) {
    try {
      if (now() - windowStart >= intervalMs) flush();

      requests += 1;
      keys.add(clientIpKey(req.ip));

      const ipClass = classifyIp(req.ip);
      ipClasses[ipClass] = (ipClasses[ipClass] || 0) + 1;

      const xff = forwardedForCount(req);
      xffCounts[xff] = (xffCounts[xff] || 0) + 1;

      if (req.headers?.["x-vercel-forwarded-for"]) vercelHeader += 1;
    } catch {
      // diagnosticul nu are voie să blocheze upload-ul
    }

    next();
  };
}

/*
 * Plafon global (per instanță) de upload-uri aflate în lucru simultan -
 * verificat ÎNAINTE ca multer să citească fișierul în memorie (max 10 MB
 * fiecare). Nu depinde de IP, deci nu poate confunda clienții între ei;
 * în trafic normal nu se atinge (2 decodări + coadă de 6 - vezi
 * services/customizationImage.js). Peste plafon: 503 + Retry-After.
 */
export function createInflightGuard({
  max = Number(process.env.CUSTOMIZATION_UPLOAD_MAX_INFLIGHT || 12),
  logger = console,
} = {}) {
  let inflight = 0;
  let lastLogAt = 0;

  const guard = function customizationInflightGuard(req, res, next) {
    if (inflight >= max) {
      const at = Date.now();

      if (at - lastLogAt > 60 * 1000) {
        lastLogAt = at;
        logger.warn("[UPLOAD] customization busy - inflight limit reached:", { max });
      }

      res.setHeader("Retry-After", "5");
      return res.status(503).json({
        error: "server_busy",
        message:
          "Serverul procesează acum multe fotografii. Încearcă din nou peste câteva secunde.",
      });
    }

    inflight += 1;

    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      inflight -= 1;
    };

    res.once("finish", release);
    res.once("close", release);

    return next();
  };

  guard.inflight = () => inflight;

  return guard;
}

export function createCustomizationUploadLimiters({
  mode = resolveCustomizationIpLimitMode(),
  windowMs = 10 * 60 * 1000,
  userMax = Number(process.env.RATE_CUSTOMIZATION_UPLOAD_USER_MAX || 30),
  ipMax = Number(process.env.RATE_CUSTOMIZATION_UPLOAD_IP_MAX || 40),
  logger = console,
  diagnostics = mode === "observe",
} = {}) {
  const userLimiter = rateLimit({
    windowMs,
    limit: userMax,
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => !req.uploader?.userId,
    keyGenerator: (req) => `user:${req.uploader.userId}`,
    message: RATE_LIMITED_BODY,
  });

  let lastObserveLogAt = 0;

  const ipLimiter = rateLimit({
    windowMs,
    limit: ipMax,
    standardHeaders: mode === "enforce",
    legacyHeaders: false,
    skip: () => mode === "off",
    // clientIpKey = ipKeyGenerator(ip, 56) - comentariul din funcție
    // satisface și validarea express-rate-limit (ERR_ERL_KEY_GEN_IPV6)
    keyGenerator: (req) => clientIpKey(req.ip /* ipKeyGenerator */),
    handler: (req, res, next) => {
      if (mode === "enforce") {
        return res.status(429).json(RATE_LIMITED_BODY);
      }

      // observe: doar semnalăm (cel mult o dată pe minut), fără blocare
      const at = Date.now();

      if (at - lastObserveLogAt > 60 * 1000) {
        lastObserveLogAt = at;
        logger.warn("[UPLOAD] customization ip limit would block (observe mode):", {
          ipClass: classifyIp(req.ip),
          limit: ipMax,
          windowMinutes: Math.round(windowMs / 60000),
          authenticated: Boolean(req.uploader?.userId),
        });
      }

      return next();
    },
  });

  const chain = [userLimiter, ipLimiter];

  if (diagnostics) {
    chain.unshift(createIpDiagnostics({ logger }));
  }

  return chain;
}
