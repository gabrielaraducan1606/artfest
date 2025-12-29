import { prisma } from "../db.js";

function cleanUndefined(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

function truncate(str, max = 20000) {
  if (!str) return str;
  const s = String(str);
  if (s.length <= max) return s;
  return s.slice(0, max) + `\n...truncated(${s.length - max})`;
}

// simplu masking (extinde lista după nevoie)
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

export async function logRouteIncident(payload) {
  try {
    const data = cleanUndefined({
      ...payload,
      message: payload?.message ? truncate(payload.message, 4000) : payload?.message,
      stack: payload?.stack ? truncate(payload.stack, 20000) : payload?.stack,
      userAgent: payload?.userAgent ? truncate(payload.userAgent, 400) : payload?.userAgent,
    });

    await prisma.routeIncident.create({ data });
  } catch (e) {
    // IMPORTANT: nu crăpăm request-ul dacă logging-ul pică
    console.error("FAILED_TO_LOG_INCIDENT", e?.message || e);
  }
}
