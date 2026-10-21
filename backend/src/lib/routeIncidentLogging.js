// src/lib/routeIncidentLogging.js
//
// Logarea incidentelor HTTP în RouteIncident (5xx + 403 + 404 /api cu
// sampling) și handlerul global de erori - mutate din server.js, cu
// același conținut al incidentului.
//
// BEST-EFFORT: scrierea în DB nu blochează NICIODATĂ răspunsul HTTP.
// Când baza nu răspunde (P1001 / P2024 / alte erori de conexiune),
// incidentul ajunge doar în consolă (Render logs), fără throw - deci
// fără a reintra în handlerul global și fără un nou incident.

import crypto from "crypto";
import { prisma } from "../db.js";

const SENSITIVE_KEYS = new Set([
  "password",
  "pass",
  "token",
  "access_token",
  "refresh_token",
  "authorization",
  "code",
  "otp",
  "secret",
  "email",
  "phone",
]);

export function maskQuery(query) {
  if (!query || typeof query !== "object") return query;
  const out = {};
  for (const [k, v] of Object.entries(query)) {
    if (SENSITIVE_KEYS.has(String(k).toLowerCase())) out[k] = "***";
    else out[k] = v;
  }
  return out;
}

function truncate(str, max = 20000) {
  if (str === undefined || str === null) return str;
  const s = String(str);
  if (s.length <= max) return s;
  return `${s.slice(0, max)}\n...truncated(${s.length - max})`;
}

/*
 * Nu aruncă niciodată (promisiunea se rezolvă mereu) - apelanții o pot
 * porni fără await. La eșec păstrăm în consolă un rezumat al
 * incidentului, ca informația să nu se piardă când DB e indisponibilă.
 */
export async function logRouteIncidentSafe(data) {
  let clean = {};
  try {
    for (const [k, v] of Object.entries(data || {})) {
      if (v !== undefined) clean[k] = v;
    }
    if (clean.message) clean.message = truncate(clean.message, 4000);
    if (clean.stack) clean.stack = truncate(clean.stack, 20000);
    if (clean.userAgent) clean.userAgent = truncate(clean.userAgent, 400);

    await prisma.routeIncident.create({ data: clean });
  } catch (e) {
    try {
      console.error(
        "FAILED_TO_LOG_ROUTE_INCIDENT:",
        e?.code || "",
        e?.message || e,
        JSON.stringify({
          reqId: clean.reqId,
          method: clean.method,
          path: clean.path,
          statusCode: clean.statusCode,
          durationMs: clean.durationMs,
          code: clean.code,
          message: clean.message ? truncate(clean.message, 500) : clean.message,
        })
      );
    } catch {
      // consola nu trebuie să poată arunca mai departe
    }
  }
}

/* =========================================================
   INCIDENT LOGGING - persistă 5xx + 403 + 404(/api, sampling) în DB
========================================================= */
export function createIncidentLoggingMiddleware() {
  return (req, res, next) => {
    req.__startAt = Date.now();
    req.__reqId = crypto.randomUUID?.() || String(Date.now());

    res.on("finish", () => {
      if (res.locals.__skipIncidentLog) return;

      const durationMs = Date.now() - (req.__startAt || Date.now());
      const status = res.statusCode || 0;
      const path = (req.originalUrl || req.url || "").split("?")[0];

      const is5xx = status >= 500;
      const is403 = status === 403;
      const is404 = status === 404;

      // 404: doar pe /api și cu sampling
      const logApi404Only = true;
      const sampleRate404 = Number(process.env.INCIDENT_SAMPLE_404 || "0.2");
      const isApiPath = path.startsWith("/api");

      const shouldLog404 =
        is404 &&
        (!logApi404Only || isApiPath) &&
        Math.random() < Math.max(0, Math.min(1, sampleRate404));

      const shouldLog = is5xx || is403 || shouldLog404;
      if (!shouldLog) return;

      // dacă error handler-ul a logat deja 5xx, nu mai logăm încă o dată
      if (is5xx && res.locals.__incidentLogged) return;

      // fire-and-forget: răspunsul a plecat deja; logRouteIncidentSafe nu aruncă
      void logRouteIncidentSafe({
        reqId: req.__reqId,
        method: req.method,
        path,
        query: req.query && Object.keys(req.query).length ? maskQuery(req.query) : undefined,
        statusCode: status,
        durationMs,
        message: null,
        stack: null,
        code: null,
        ip: req.ip,
        userId: req.user?.id || null,
        userAgent: req.headers["user-agent"] || null,
      });
    });

    next();
  };
}

/* =========================================================
   HANDLER GLOBAL DE ERORI
========================================================= */
export function createGlobalErrorHandler() {
  // eslint-disable-next-line no-unused-vars
  return (err, req, res, _next) => {
    try {
      console.error("UNCAUGHT:", err?.message || err);

      if (err?.message === "Not allowed by CORS") {
        res.locals.__skipIncidentLog = true;
        return res.status(403).json({ error: "cors_blocked" });
      }

      if (err?.type === "entity.too.large") {
        return res.status(413).json({
          error: "payload_too_large",
          message: "Body prea mare (max 10MB).",
        });
      }

      // log în DB (o singură dată)
      res.locals.__incidentLogged = true;

      const durationMs = typeof req.__startAt === "number" ? Date.now() - req.__startAt : null;

      /*
       * NU mai așteptăm scrierea: cu DB indisponibilă (P1001 / P2024)
       * răspunsul 500 ar fi întârziat cu timeout-ul de conectare.
       * logRouteIncidentSafe nu aruncă, deci nu poate reintra aici.
       */
      void logRouteIncidentSafe({
        reqId: req.__reqId || null,
        method: req.method,
        path: (req.originalUrl || req.url || "").split("?")[0],
        query: req.query && Object.keys(req.query).length ? maskQuery(req.query) : undefined,
        statusCode: 500,
        durationMs,
        message: err?.message ? String(err.message) : "server_error",
        stack: err?.stack ? String(err.stack) : null,
        code: err?.code ? String(err.code) : null,
        ip: req.ip,
        userId: req.user?.id || null,
        userAgent: req.headers["user-agent"] || null,
      });

      return res.status(500).json({ error: "server_error" });
    } catch (e) {
      console.error("ERROR_IN_ERROR_HANDLER:", e?.message || e);
      return res.status(500).json({ error: "server_error" });
    }
  };
}
