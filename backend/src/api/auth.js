// src/api/auth.js
import jwt from "jsonwebtoken";
import { prisma } from "../db.js";

/** Setări de bază */
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TOKEN_COOKIE = "token";

/** Semnează un JWT cu exp 7 zile */
export function signToken(payload) {
  if (!JWT_SECRET) {
    // Fail fast dacă lipsește în prod
    if (process.env.NODE_ENV === "production") {
      throw new Error("JWT_SECRET is not set");
    }
  }
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "7d" });
}

/** Extrage token din cookie sau Authorization: Bearer */
function getTokenFromReq(req) {
  const fromCookie = req.cookies?.[TOKEN_COOKIE];
  const fromHeader = req.headers.authorization?.startsWith("Bearer ")
    ? req.headers.authorization.slice(7)
    : null;
  return fromCookie || fromHeader || null;
}

/** Middleware: necesită autentificare (401 dacă lipsește/invalid) */
export function authRequired(req, res, next) {
  try {
    const token = getTokenFromReq(req);
    if (!token) return res.status(401).json({ error: "unauthenticated" });

    const decoded = jwt.verify(token, JWT_SECRET);
    if (!decoded?.sub) return res.status(401).json({ error: "unauthenticated" });

    // { sub, role, tv?, iat, exp }
    req.user = decoded;
    next();
  } catch (e) {
    console.error("authRequired error:", e?.message || e);
    return res.status(401).json({ error: "invalid_token" });
  }
}

/** Middleware: opțional — setează req.user dacă există token, altfel trece mai departe */
export function optionalAuth(req, _res, next) {
  try {
    const token = getTokenFromReq(req);
    if (!token) return next();
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded?.sub) req.user = decoded;
  } catch (e) {
    // nu blocăm request-ul dacă tokenul e invalid; doar nu setăm req.user
    console.warn("optionalAuth token ignored:", e?.message || e);
  }
  next();
}

/** Middleware: roluri necesare (403 dacă rolul nu e în listă) */
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: "unauthenticated" });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: "forbidden" });
    }
    next();
  };
}

/** Middleware: (nou) verifică tokenVersion din JWT vs DB, dacă tv e prezent */
export async function enforceTokenVersion(req, res, next) {
  try {
    const hasTv = typeof req?.user?.tv !== "undefined";
    if (!hasTv) return next(); // compat: tokenuri vechi fără tv => le acceptăm
    const u = await prisma.user.findUnique({
      where: { id: req.user.sub },
      select: { tokenVersion: true },
    });
    if (!u || u.tokenVersion !== req.user.tv) {
      return res.status(401).json({ error: "invalid_token" });
    }
    return next();
  } catch (e) {
    console.error("enforceTokenVersion error:", e?.message || e);
    return res.status(401).json({ error: "invalid_token" });
  }
}
