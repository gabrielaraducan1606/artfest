// backend/src/lib/unsubscribe.js
import crypto from "crypto";

const SECRET = process.env.UNSUBSCRIBE_SECRET;

// implicit: 180 zile (poți schimba din .env)
const MAX_AGE_SECONDS = Number(process.env.UNSUBSCRIBE_TOKEN_MAX_AGE_SECONDS || 60 * 60 * 24 * 180);

function b64url(s) {
  return Buffer.from(String(s), "utf8").toString("base64url");
}
function unb64url(s) {
  return Buffer.from(String(s), "base64url").toString("utf8");
}

function hmacBase64Url(payload) {
  if (!SECRET) throw new Error("Missing UNSUBSCRIBE_SECRET");
  return crypto.createHmac("sha256", SECRET).update(payload).digest("base64url");
}

/**
 * Token format: base64url(payloadJSON).base64url(hmac_sha256(payloadJSON))
 * payload: { email, category, ts }
 */
export function signUnsubToken({ email, category, ts = Date.now() }) {
  if (!email) throw new Error("Missing email");
  if (!category) throw new Error("Missing category");

  const payload = JSON.stringify({
    email: String(email).trim().toLowerCase(),
    category: String(category),
    ts: Number(ts),
  });

  const sig = hmacBase64Url(payload);
  return `${b64url(payload)}.${sig}`;
}

/**
 * Verifică semnătura + expirarea.
 * Aruncă eroare dacă token-ul e invalid/expirat.
 */
export function verifyUnsubToken(token) {
  if (!SECRET) throw new Error("Missing UNSUBSCRIBE_SECRET");

  const [p, sig] = String(token || "").split(".");
  if (!p || !sig) throw new Error("Invalid token");

  const payload = unb64url(p);
  const expectedSig = hmacBase64Url(payload);

  // Compare decoded signature bytes (constant-time)
  const a = Buffer.from(sig, "base64url");
  const b = Buffer.from(expectedSig, "base64url");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new Error("Bad signature");

  const data = JSON.parse(payload);

  // expiry check
  const ts = Number(data?.ts);
  if (!ts || !Number.isFinite(ts)) throw new Error("Invalid payload");
  const ageSeconds = (Date.now() - ts) / 1000;
  if (ageSeconds > MAX_AGE_SECONDS) throw new Error("Expired token");

  if (!data?.email || !data?.category) throw new Error("Invalid payload");

  return data;
}
