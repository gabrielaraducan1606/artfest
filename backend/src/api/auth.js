// src/api/auth.js
import jwt from "jsonwebtoken";
import { prisma } from "../db.js";

/** Setări de bază pentru JWT & numele cookie-ului */
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TOKEN_COOKIE = "token";

/**
 * Semnează un JWT cu exp 7 zile.
 * payload tipic: { sub: userId, role: "USER"|"ADMIN"|"VENDOR", tv: tokenVersion }
 */
export function signToken(payload) {
  if (!JWT_SECRET) {
    // Fail fast în producție dacă lipsește secretul
    if (process.env.NODE_ENV === "production") {
      throw new Error("JWT_SECRET is not set");
    }
  }
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "7d" });
}

/**
 * Extrage token-ul din request:
 * - cookie: token
 * - sau header: Authorization: Bearer <token>
 */
function getTokenFromReq(req) {
  const fromCookie = req.cookies?.[TOKEN_COOKIE];
  const fromHeader = req.headers.authorization?.startsWith("Bearer ")
    ? req.headers.authorization.slice(7)
    : null;
  return fromCookie || fromHeader || null;
}

/**
 * Middleware: necesită autentificare (401 dacă lipsește/invalid).
 * - Verifică JWT-ul.
 * - Setează req.user cu payload-ul din token.
 */
export function authRequired(req, res, next) {
  try {
    const token = getTokenFromReq(req);
    if (!token) return res.status(401).json({ error: "unauthenticated" });

    const decoded = jwt.verify(token, JWT_SECRET);
    if (!decoded?.sub) {
      return res.status(401).json({ error: "unauthenticated" });
    }

    // decoded conține { sub, role, tv?, iat, exp }
    req.user = decoded;
    next();
  } catch (e) {
    console.error("authRequired error:", e?.message || e);
    return res.status(401).json({ error: "invalid_token" });
  }
}

/**
 * Middleware: autentificare opțională.
 * - Dacă token-ul este valid -> setează req.user.
 * - Dacă lipsește / este invalid -> NU blochează request-ul.
 */
export function optionalAuth(req, _res, next) {
  try {
    const token = getTokenFromReq(req);
    if (!token) return next();
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded?.sub) req.user = decoded;
  } catch (e) {
    // token invalid: îl ignorăm, dar nu blocăm request-ul
    console.warn("optionalAuth token ignored:", e?.message || e);
  }
  next();
}

/**
 * Middleware factory: verifică dacă user-ul are unul dintre rolurile cerute.
 * Usage: router.get(..., authRequired, requireRole("ADMIN", "VENDOR"), handler)
 */
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: "unauthenticated" });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: "forbidden" });
    }
    next();
  };
}

/**
 * Middleware: verifică tokenVersion din JWT vs DB (dacă tv e prezent în token).
 *
 * - Dacă tokenul NU are tv => îl acceptăm (compatibilitate cu token-uri vechi).
 * - Dacă ARE tv:
 *    - citim user.tokenVersion din DB
 *    - dacă diferă de req.user.tv => token invalid (ex: user a schimbat parola,
 *      s-a dat "logout from all devices" etc.)
 */
export async function enforceTokenVersion(req, res, next) {
  try {
    const hasTv = typeof req?.user?.tv !== "undefined";
    if (!hasTv) return next(); // compat: tokenuri vechi fără tv

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
