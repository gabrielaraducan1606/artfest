// backend/src/lib/unsubscribeUrl.js
//
// Adresa linkului de dezabonare. Ruta reală este montată sub /api
// (server.js: app.use("/api", unsubscribeRouter) => /api/unsubscribe), deci baza
// publică trebuie să se termine cu /api. Pe www.artfest.ro, /api/* e rescris de
// Vercel către backend, așa că și APP_URL + /api funcționează.
// Fără dependențe (fără Prisma / mailer) => folosit și de scriptul de verificare.

import { signUnsubToken, verifyUnsubToken } from "./unsubscribe.js";

const trim = (v) => String(v || "").trim().replace(/\/+$/, "");

// aceeași ordine ca în mailer.js: PUBLIC_API_URL, API_URL, apoi APP_URL / FRONTEND_URL
export function unsubscribeApiBase(env = process.env) {
  const base = trim(env.PUBLIC_API_URL) || trim(env.API_URL) || trim(env.APP_URL) || trim(env.FRONTEND_URL);
  if (!base) return null;
  return /\/api$/i.test(base) ? base : `${base}/api`;
}

/*
 * Link semnat de dezabonare (categoria „marketing”) sau null dacă nu poate fi
 * generat corect: lipsește secretul / baza URL, ori în producție baza nu e https.
 */
export function buildApiUnsubscribeUrl(email, { env = process.env, now = Date.now() } = {}) {
  const base = unsubscribeApiBase(env);
  if (!base || !env.UNSUBSCRIBE_SECRET) return null;
  if (env.NODE_ENV === "production" && !/^https:\/\//i.test(base)) return null;
  try {
    const token = signUnsubToken({ email: String(email || "").trim().toLowerCase(), category: "marketing", ts: now });
    return `${base}/unsubscribe?token=${encodeURIComponent(token)}`;
  } catch {
    return null;
  }
}

/*
 * Verificarea configurației (fără valori secrete, fără email, fără bază de date):
 * prezența secretului, baza URL, https, și un token semnat + verificat local.
 */
export function checkUnsubscribeConfig(env = process.env) {
  const issues = [];
  const secret = String(env.UNSUBSCRIBE_SECRET || "");
  const base = unsubscribeApiBase(env);
  const source = trim(env.PUBLIC_API_URL) ? "PUBLIC_API_URL" : trim(env.API_URL) ? "API_URL" : trim(env.APP_URL) ? "APP_URL" : trim(env.FRONTEND_URL) ? "FRONTEND_URL" : null;

  if (!secret) issues.push("UNSUBSCRIBE_SECRET lipsește");
  else if (secret.length < 32) issues.push(`UNSUBSCRIBE_SECRET este scurt (${secret.length} caractere; recomandat cel puțin 32)`);
  if (!base) issues.push("Nicio bază URL (PUBLIC_API_URL / API_URL / APP_URL)");
  else if (!/^https:\/\//i.test(base)) issues.push(`Baza URL nu este https (${base})`);
  if (base && /localhost|127\.0\.0\.1/i.test(base)) issues.push("Baza URL este locală (localhost)");

  let roundTrip = false;
  if (secret) {
    try {
      const token = signUnsubToken({ email: "verificare@artfest.ro", category: "marketing" });
      const decoded = verifyUnsubToken(token);
      roundTrip = decoded?.email === "verificare@artfest.ro" && decoded?.category === "marketing";
    } catch {
      roundTrip = false;
    }
    if (!roundTrip) issues.push("Tokenul semnat nu a putut fi verificat");
  }

  return {
    secretSet: Boolean(secret),
    secretLength: secret.length,
    baseSource: source,
    unsubscribeEndpoint: base ? `${base}/unsubscribe` : null,
    httpsOk: Boolean(base && /^https:\/\//i.test(base)),
    tokenRoundTrip: roundTrip,
    ok: issues.length === 0,
    issues,
  };
}
