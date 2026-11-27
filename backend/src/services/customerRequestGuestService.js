// src/services/customerRequestGuestService.js
//
// Cereri de ofertă trimise de vizitatori FĂRĂ cont (ex. QR de pe flyere).
//
// Reguli:
//  - cererea se publică DOAR după confirmarea emailului (link din email);
//    până atunci stă în CustomerRequestPending, nevăzută public și
//    netrimisă vânzătorilor; ciorna neconfirmată expiră după 48 de ore;
//  - NU se creează niciodată conturi: CustomerRequestGuest nu are parolă și
//    nu se poate autentifica;
//  - răspunsul la trimitere este IDENTIC indiferent dacă emailul are cont,
//    dacă e un duplicat sau dacă trimiterea a fost oprită ca spam
//    (fără enumerarea adreselor de email);
//  - email care are deja cont: cererea se publică în acel cont doar după
//    autentificarea în ACEL cont;
//  - accesul vizitatorului la ofertele lui: link din email (token aleator,
//    în DB doar sha256) -> sesiune într-un cookie httpOnly semnat, legată
//    de accessVersion (revocabilă);
//  - asocierea cu un cont creat ulterior: doar când contul are același
//    email, verificat (ambele confirmări dovedesc aceeași căsuță de email).
//
// Fără conversații / comenzi pentru vizitatori în etapa 1: pentru ele e
// nevoie de cont (fluxurile existente rămân neschimbate).

import crypto from "node:crypto";
import jwt from "jsonwebtoken";

import { CATEGORIES } from "../constants/categories.js";

export const GUEST_CONSENT_VERSION = "cereri-vizitatori-2026-11-draft";

export const PENDING_TTL_MS = 48 * 60 * 60 * 1000;
export const ACCESS_TOKEN_TTL_MS = 14 * 24 * 60 * 60 * 1000;
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const REQUEST_TTL_DAYS = 30;

export const LIMITS = {
  maxOpenPendingPerEmail: 3,
  maxSubmitsPerEmailPerDay: 5,
  maxSubmitsPerIpPerDay: 20,
  resendCooldownMs: 10 * 60 * 1000,
  accessLinkCooldownMs: 5 * 60 * 1000,
  minFillMs: 3000,
  maxImages: 10,
  maxDetailsBytes: 8 * 1024,
};

export const GUEST_SESSION_COOKIE = "artfest_crg";
const SESSION_AUDIENCE = "customer_request_guest";

const CATEGORY_SET = new Set(CATEGORIES);
const VALID_BUDGET_TYPES = new Set(["TOTAL", "PER_ITEM"]);
const MAX_CENTS = 100_000_000; // 1.000.000 lei
const MAX_QUANTITY = 100_000;

export const GENERIC_SUBMIT_MESSAGE =
  "Ți-am trimis un email. Deschide linkul din email ca să publicăm cererea. " +
  "Dacă nu îl găsești, verifică și dosarul Spam / Promoții.";

export const GENERIC_ACCESS_LINK_MESSAGE =
  "Dacă există cereri confirmate pentru această adresă, îți trimitem pe email un link nou.";

/* =========================================================
   Activare
========================================================= */

/*
 * Fluxul e activ implicit local / pe DEV. În producție doar cu
 * CUSTOMER_REQUEST_GUEST_ENABLED=1 (textul legal trebuie aprobat întâi).
 * CUSTOMER_REQUEST_GUEST_ENABLED=0 îl oprește oriunde.
 */
export function isGuestRequestsEnabled(env = process.env) {
  const flag = String(env.CUSTOMER_REQUEST_GUEST_ENABLED ?? "").trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(flag)) return true;
  if (["0", "false", "no", "off"].includes(flag)) return false;
  return env.NODE_ENV !== "production";
}

/* =========================================================
   Utilitare
========================================================= */

const sha256 = (value) => crypto.createHash("sha256").update(String(value)).digest("hex");

export const hashToken = (token) => sha256(`crg:${token}`);

export function newToken() {
  return crypto.randomBytes(32).toString("base64url");
}

function secret(env = process.env) {
  return env.JWT_SECRET || "dev-secret-change-me";
}

export function hashIp(ip, env = process.env) {
  const value = String(ip || "").trim();
  if (!value) return null;
  return sha256(`ip:${secret(env)}:${value}`);
}

function clean(value, max) {
  if (value === null || value === undefined) return "";
  return String(value).replace(/\u0000/g, "").trim().slice(0, max);
}

/* email: trim + lowercase, format simplu, max 254 */
export function normalizeGuestEmail(value) {
  const email = clean(value, 400).toLowerCase();
  if (!email || email.length > 254) return null;
  if (!/^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[a-z]{2,}$/i.test(email)) return null;
  return email;
}

/*
 * Prenume / nume de utilizator afișat public pe cerere: 2-40 caractere,
 * fără email, link sau număr de telefon (ar ocoli regulile platformei).
 */
export function normalizeDisplayName(value) {
  const name = clean(value, 200).replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 40) return null;
  if (/[@<>]/.test(name)) return null;
  if (/(https?:|www\.|\.(ro|com|net|org|eu)\b)/i.test(name)) return null;
  if ((name.match(/\d/g) || []).length >= 5) return null;
  if (!/^[\p{L}\p{M}0-9 ._'-]+$/u.test(name)) return null;
  return name;
}

function optionalInt(value, { min = 0, max = MAX_CENTS } = {}) {
  if (value === null || value === undefined || value === "") return { ok: true, value: null };
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) return { ok: false };
  return { ok: true, value: n };
}

function slugifyCity(value) {
  const city = clean(value, 120);
  if (!city) return null;
  return city
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || null;
}

const fail = (status, error, message, field = null) => ({
  ok: false,
  status,
  body: { error, message, ...(field ? { field } : {}) },
});

/*
 * Validarea server-side a câmpurilor cererii (aceleași limite ca la
 * POST /api/customer-requests, plus reguli mai stricte pentru vizitatori:
 * categorie din listă, valuta RON, detalii max 8 KB, fără imagini /
 * expirare trimise de client).
 */
export function parseGuestRequestFields(body = {}, { now = new Date() } = {}) {
  const title = clean(body.title, 180);
  if (title.length < 5) return fail(400, "title_required", "Spune pe scurt ce cauți (minimum 5 caractere).", "title");

  const description = clean(body.description, 5000);
  if (description.length < 10) {
    return fail(400, "description_required", "Adaugă câteva detalii despre ce cauți (minimum 10 caractere).", "description");
  }

  const rawCategory = clean(body.category, 64);
  if (rawCategory && !CATEGORY_SET.has(rawCategory)) {
    return fail(400, "invalid_category", "Alege o categorie din listă.", "category");
  }

  const quantity = optionalInt(body.quantity, { min: 1, max: MAX_QUANTITY });
  if (!quantity.ok) return fail(400, "invalid_quantity", "Cantitatea trebuie să fie un număr între 1 și 100.000.", "quantity");

  const budgetMin = optionalInt(body.budgetMinCents);
  const budgetMax = optionalInt(body.budgetMaxCents);
  if (!budgetMin.ok || !budgetMax.ok) return fail(400, "invalid_budget", "Bugetul nu este valid.", "budget");
  if (budgetMin.value !== null && budgetMax.value !== null && budgetMin.value > budgetMax.value) {
    return fail(400, "invalid_budget_range", "Bugetul minim nu poate fi mai mare decât bugetul maxim.", "budget");
  }

  const rawBudgetType = clean(body.budgetType, 30).toUpperCase();
  const budgetType = VALID_BUDGET_TYPES.has(rawBudgetType) ? rawBudgetType : null;

  let deliveryDeadline = null;
  if (body.deliveryDeadline) {
    const date = new Date(body.deliveryDeadline);
    const maxDate = new Date(now.getTime() + 2 * 365 * 24 * 60 * 60 * 1000);
    if (Number.isNaN(date.getTime()) || date < now || date > maxDate) {
      return fail(400, "invalid_delivery_deadline", "Termenul de livrare trebuie să fie în viitor.", "deliveryDeadline");
    }
    deliveryDeadline = date.toISOString();
  }

  const city = clean(body.city, 120) || null;

  let details = null;
  if (body.details && typeof body.details === "object" && !Array.isArray(body.details)) {
    const json = JSON.stringify(body.details);
    if (Buffer.byteLength(json, "utf8") > LIMITS.maxDetailsBytes) {
      return fail(400, "details_too_large", "Detaliile suplimentare sunt prea lungi.", "details");
    }
    details = JSON.parse(json);
  }

  return {
    ok: true,
    data: {
      title,
      description,
      category: rawCategory || null,
      quantity: quantity.value,
      budgetMinCents: budgetMin.value,
      budgetMaxCents: budgetMax.value,
      budgetType,
      currency: "RON",
      deliveryDeadline,
      city,
      citySlug: city ? slugifyCity(city) : null,
      details,
    },
  };
}

export function payloadHashFor(email, data) {
  const norm = (v) => String(v || "").toLowerCase().replace(/\s+/g, " ").trim();
  return sha256(["v1", email, norm(data.title), norm(data.description), data.category || ""].join("|"));
}

export const PUBLIC_SITE_ORIGIN = "https://www.artfest.ro";

/*
 * Originea linkurilor din email: APP_URL / FRONTEND_URL (ca restul
 * emailurilor). Fără ea, sau cu o adresă locală în producție, folosim
 * domeniul public - un link relativ nu ar funcționa din email.
 */
export function appUrl(env = process.env) {
  const configured = String(env.APP_URL || env.FRONTEND_URL || "").trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(configured)) return PUBLIC_SITE_ORIGIN;
  if (env.NODE_ENV === "production" && /\/\/(localhost|127\.0\.0\.1)(:|$|\/)/i.test(configured)) return PUBLIC_SITE_ORIGIN;
  return configured;
}

export function confirmUrlFor(token, env = process.env) {
  return `${appUrl(env)}/cereri/confirmare#t=${encodeURIComponent(token)}`;
}

export function accessUrlFor(token, env = process.env) {
  return `${appUrl(env)}/cereri/acces#t=${encodeURIComponent(token)}`;
}

/* =========================================================
   Sesiunea vizitatorului (cookie httpOnly semnat)
========================================================= */

export function signGuestSession(guest, env = process.env) {
  return jwt.sign(
    { gid: guest.id, av: guest.accessVersion ?? 0, typ: "crg" },
    secret(env),
    { audience: SESSION_AUDIENCE, expiresIn: Math.floor(SESSION_TTL_MS / 1000) }
  );
}

export function guestSessionCookieOptions(req, maxAge) {
  const proto = String(req?.headers?.["x-forwarded-proto"] || "").toLowerCase();
  const secure = proto === "https" || !!req?.secure;
  return {
    httpOnly: true,
    secure,
    sameSite: secure ? "None" : "Lax",
    path: "/api/customer-requests",
    ...(typeof maxAge === "number" ? { maxAge } : {}),
  };
}

export function setGuestSessionCookie(req, res, guest) {
  res.cookie(GUEST_SESSION_COOKIE, signGuestSession(guest), guestSessionCookieOptions(req, SESSION_TTL_MS));
}

export function clearGuestSessionCookie(req, res) {
  res.clearCookie(GUEST_SESSION_COOKIE, guestSessionCookieOptions(req));
}

/*
 * Vizitatorul din cookie, verificat în DB (email confirmat + accessVersion
 * identic). null dacă lipsește / e invalid / revocat - niciodată o eroare.
 */
export async function readGuestSession(req, { db, env = process.env } = {}) {
  const raw = req?.cookies?.[GUEST_SESSION_COOKIE];
  if (!raw) return null;

  let decoded;
  try {
    decoded = jwt.verify(raw, secret(env), { audience: SESSION_AUDIENCE });
  } catch {
    return null;
  }

  if (decoded?.typ !== "crg" || !decoded.gid) return null;

  const guest = await db.customerRequestGuest.findUnique({
    where: { id: String(decoded.gid) },
    select: { id: true, email: true, displayName: true, emailVerifiedAt: true, accessVersion: true, linkedUserId: true },
  });

  if (!guest || !guest.emailVerifiedAt || guest.accessVersion !== decoded.av) return null;

  return guest;
}

/* =========================================================
   Curățenie (lazy, fără cron)
========================================================= */

let lastCleanupAt = 0;

export async function cleanupExpiredGuestData({ db, now = new Date(), force = false } = {}) {
  if (!force && now.getTime() - lastCleanupAt < 10 * 60 * 1000) return null;
  lastCleanupAt = now.getTime();

  try {
    const tokens = await db.customerRequestGuestToken.deleteMany({ where: { expiresAt: { lt: now } } });
    const pendings = await db.customerRequestPending.deleteMany({
      where: { publishedRequestId: null, expiresAt: { lt: now } },
    });
    return { tokens: tokens.count, pendings: pendings.count };
  } catch (error) {
    console.warn("[customer-request-guest] cleanup failed:", error?.message || error);
    return null;
  }
}

/* =========================================================
   1. Trimitere cerere (fără cont)
========================================================= */

/*
 * Rezultat: { status, body, after? } - `after` = trimiterea emailului,
 * rulată de rută DUPĂ răspuns (timpul de răspuns nu dezvăluie ramura).
 */
export async function submitGuestRequest({
  db,
  body = {},
  ip = null,
  userAgent = null,
  now = new Date(),
  moderateText,
  mailer,
  env = process.env,
  enforceIpLimit = false,
}) {
  const accepted = { status: 202, body: { ok: true, message: GENERIC_SUBMIT_MESSAGE } };

  /* anti-bot: câmp ascuns completat sau formular trimis prea repede */
  if (clean(body.website, 200)) return { ...accepted, dropped: "honeypot" };

  const startedAt = Number(body.startedAt);
  if (Number.isFinite(startedAt) && startedAt > 0 && now.getTime() - startedAt < LIMITS.minFillMs) {
    return { ...accepted, dropped: "too_fast" };
  }

  if (body.consent !== true) {
    return fail(400, "consent_required", "Bifează acordul pentru prelucrarea datelor ca să putem trimite cererea.", "consent");
  }

  const displayName = normalizeDisplayName(body.displayName);
  if (!displayName) {
    return fail(
      400,
      "invalid_display_name",
      "Scrie prenumele sau un nume de utilizator (2-40 caractere, fără email, link sau telefon).",
      "displayName"
    );
  }

  const email = normalizeGuestEmail(body.email);
  if (!email) return fail(400, "invalid_email", "Adresa de email nu este validă.", "email");

  const parsed = parseGuestRequestFields(body, { now });
  if (!parsed.ok) return parsed;
  const data = parsed.data;

  const moderation = await moderateText({ title: data.title, description: data.description });
  if (!moderation?.allowed) return { ok: false, moderation };

  await cleanupExpiredGuestData({ db, now });

  const ipHash = hashIp(ip, env);
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  if (enforceIpLimit && ipHash) {
    const fromIp = await db.customerRequestPending.count({ where: { ipHash, createdAt: { gt: dayAgo } } });
    if (fromIp >= LIMITS.maxSubmitsPerIpPerDay) {
      return fail(429, "guest_rate_limited", "Au fost trimise multe cereri din această rețea. Încearcă din nou mai târziu.");
    }
  }

  const guest = await db.customerRequestGuest.upsert({
    where: { email },
    create: { email, displayName },
    update: {},
  });

  const payloadHash = payloadHashFor(email, data);

  /* duplicat: aceeași cerere încă neconfirmată -> retrimitem linkul (cu pauză) */
  const duplicate = await db.customerRequestPending.findFirst({
    where: { guestId: guest.id, payloadHash, createdAt: { gt: dayAgo } },
    orderBy: { createdAt: "desc" },
  });

  if (duplicate) {
    if (duplicate.publishedRequestId || duplicate.expiresAt <= now) return { ...accepted, dropped: "duplicate" };

    const recentlySent = duplicate.lastEmailAt && now.getTime() - new Date(duplicate.lastEmailAt).getTime() < LIMITS.resendCooldownMs;
    if (recentlySent) return { ...accepted, dropped: "duplicate_cooldown" };

    const token = newToken();
    await db.customerRequestGuestToken.create({
      data: { guestId: guest.id, pendingId: duplicate.id, purpose: "confirm", tokenHash: hashToken(token), expiresAt: duplicate.expiresAt },
    });
    await db.customerRequestPending.update({
      where: { id: duplicate.id },
      data: { lastEmailAt: now, emailCount: { increment: 1 } },
    });

    return {
      ...accepted,
      dropped: "duplicate_resent",
      after: buildConfirmEmail({ db, mailer, env, email, displayName, title: data.title, token }),
    };
  }

  const [submittedToday, openPending] = await Promise.all([
    db.customerRequestPending.count({ where: { guestId: guest.id, createdAt: { gt: dayAgo } } }),
    db.customerRequestPending.count({ where: { guestId: guest.id, publishedRequestId: null, expiresAt: { gt: now } } }),
  ]);

  if (submittedToday >= LIMITS.maxSubmitsPerEmailPerDay || openPending >= LIMITS.maxOpenPendingPerEmail) {
    return fail(
      429,
      "guest_email_limit",
      "Ai trimis deja mai multe cereri cu acest email. Confirmă-le din emailurile primite sau încearcă din nou mâine."
    );
  }

  const expiresAt = new Date(now.getTime() + PENDING_TTL_MS);

  const pending = await db.customerRequestPending.create({
    data: {
      guestId: guest.id,
      displayName,
      payload: data,
      payloadHash,
      wantsAccount: body.wantsAccount === true,
      consentVersion: GUEST_CONSENT_VERSION,
      consentAt: now,
      ipHash,
      source: clean(body.source, 40) || null,
      expiresAt,
      lastEmailAt: now,
    },
  });

  const token = newToken();
  await db.customerRequestGuestToken.create({
    data: { guestId: guest.id, pendingId: pending.id, purpose: "confirm", tokenHash: hashToken(token), expiresAt },
  });

  if (userAgent) {
    // doar pentru jurnal (fără IP / email)
    console.info("[customer-request-guest] pending created:", { pendingId: pending.id, source: pending.source });
  }

  return {
    ...accepted,
    pendingId: pending.id,
    after: buildConfirmEmail({ db, mailer, env, email, displayName, title: data.title, token }),
  };
}

/* emailul de confirmare: varianta „ai deja cont” se alege abia aici */
function buildConfirmEmail({ db, mailer, env, email, displayName, title, token }) {
  return async () => {
    const account = await db.user.findUnique({ where: { email }, select: { id: true } });
    await mailer.sendGuestCustomerRequestConfirmEmail({
      to: email,
      displayName,
      requestTitle: title,
      confirmUrl: confirmUrlFor(token, env),
      accountExists: Boolean(account),
    });
  };
}

/* =========================================================
   2. Confirmare (publicare)
========================================================= */

function requestDataFromPayload(payload = {}) {
  return {
    title: payload.title,
    description: payload.description,
    category: payload.category ?? null,
    quantity: payload.quantity ?? null,
    budgetMinCents: payload.budgetMinCents ?? null,
    budgetMaxCents: payload.budgetMaxCents ?? null,
    budgetType: payload.budgetType ?? null,
    currency: "RON",
    deliveryDeadline: payload.deliveryDeadline ? new Date(payload.deliveryDeadline) : null,
    city: payload.city ?? null,
    citySlug: payload.citySlug ?? null,
    images: [],
    details: payload.details ?? null,
  };
}

async function findToken(db, token, purpose) {
  const value = clean(token, 200);
  if (!value || value.length < 20) return null;
  const row = await db.customerRequestGuestToken.findUnique({ where: { tokenHash: hashToken(value) } });
  return row && row.purpose === purpose ? row : null;
}

const linkInvalid = () =>
  fail(410, "link_invalid", "Linkul nu mai este valabil. Trimite din nou cererea sau cere un link nou.");

/*
 * authUserId: utilizatorul autentificat (dacă există). Rezultat:
 *  - published (guest): cererea publicată ca vizitator + sesiune;
 *  - published (account): cererea publicată în contul autentificat;
 *  - 409 login_required: emailul are cont -> autentificare în acel cont;
 *  - 403 account_mismatch: autentificat în ALT cont.
 */
export async function confirmGuestRequest({ db, token, authUserId = null, now = new Date() }) {
  const row = await findToken(db, token, "confirm");
  if (!row || !row.pendingId) return linkInvalid();

  const pending = await db.customerRequestPending.findUnique({ where: { id: row.pendingId } });
  if (!pending) return linkInvalid();

  const guest = await db.customerRequestGuest.findUnique({ where: { id: pending.guestId } });
  if (!guest) return linkInvalid();

  const tokenExpired = new Date(row.expiresAt) <= now;

  /* deja publicată (link apăsat din nou în termen) */
  if (pending.publishedRequestId) {
    if (tokenExpired) return linkInvalid();
    const published = await db.customerRequest.findUnique({
      where: { id: pending.publishedRequestId },
      select: { id: true, userId: true, guestId: true },
    });
    if (!published) return linkInvalid();
    return { ok: true, status: 200, outcome: "already_published", requestId: published.id, guest: published.guestId ? guest : null };
  }

  if (tokenExpired || new Date(pending.expiresAt) <= now || row.usedAt) return linkInvalid();

  const account = await db.user.findUnique({
    where: { email: guest.email },
    select: { id: true, status: true, locked: true },
  });

  if (account) {
    if (!authUserId) {
      return {
        ok: false,
        status: 409,
        body: {
          error: "login_required",
          message: "Autentifică-te ca să publicăm cererea în contul tău. Datele cererii sunt păstrate.",
        },
      };
    }

    if (String(authUserId) !== String(account.id)) {
      return fail(
        403,
        "account_mismatch",
        "Ești autentificat cu alt cont decât adresa de email a cererii. Ieși din cont și autentifică-te cu adresa folosită în cerere."
      );
    }

    if (account.locked || (account.status && account.status !== "ACTIVE")) {
      return fail(403, "account_unavailable", "Contul nu poate publica cereri momentan.");
    }
  }

  const expiresAt = new Date(now.getTime() + REQUEST_TTL_DAYS * 24 * 60 * 60 * 1000);

  const result = await db.$transaction(async (tx) => {
    const claimed = await tx.customerRequestGuestToken.updateMany({
      where: { id: row.id, usedAt: null },
      data: { usedAt: now },
    });
    if (claimed.count !== 1) return null;

    const request = await tx.customerRequest.create({
      data: {
        ...requestDataFromPayload(pending.payload),
        ...(account ? { userId: account.id } : { guestId: guest.id }),
        status: "OPEN",
        expiresAt,
      },
    });

    const marked = await tx.customerRequestPending.updateMany({
      where: { id: pending.id, publishedRequestId: null },
      data: { publishedRequestId: request.id, publishedAt: now },
    });
    if (marked.count !== 1) throw Object.assign(new Error("pending_already_published"), { code: "PENDING_RACE" });

    let updatedGuest = guest;
    if (!account) {
      updatedGuest = await tx.customerRequestGuest.update({
        where: { id: guest.id },
        data: { emailVerifiedAt: guest.emailVerifiedAt || now, displayName: pending.displayName, lastAccessAt: now },
      });
    }

    return { request, guest: updatedGuest };
  });

  if (!result) {
    // apăsare dublă: celălalt request a publicat deja
    const again = await db.customerRequestPending.findUnique({ where: { id: pending.id } });
    if (again?.publishedRequestId) {
      return { ok: true, status: 200, outcome: "already_published", requestId: again.publishedRequestId, guest: account ? null : guest };
    }
    return linkInvalid();
  }

  return {
    ok: true,
    status: 201,
    outcome: account ? "published_account" : "published_guest",
    request: result.request,
    requestId: result.request.id,
    guest: account ? null : result.guest,
    wantsAccount: pending.wantsAccount,
    email: guest.email,
  };
}

/* =========================================================
   3. Acces prin link
========================================================= */

export async function exchangeAccessToken({ db, token, now = new Date() }) {
  const row = await findToken(db, token, "access");
  if (!row || new Date(row.expiresAt) <= now) return linkInvalid();

  const guest = await db.customerRequestGuest.findUnique({ where: { id: row.guestId } });
  if (!guest || !guest.emailVerifiedAt) return linkInvalid();

  const updated = await db.customerRequestGuest.update({ where: { id: guest.id }, data: { lastAccessAt: now } });
  return { ok: true, status: 200, guest: updated };
}

export async function createAccessToken({ db, guestId, now = new Date() }) {
  const token = newToken();
  await db.customerRequestGuestToken.create({
    data: { guestId, purpose: "access", tokenHash: hashToken(token), expiresAt: new Date(now.getTime() + ACCESS_TOKEN_TTL_MS) },
  });
  return token;
}

/* „Trimite-mi linkul din nou” - răspuns identic în toate cazurile. */
export async function requestAccessLink({ db, email: rawEmail, mailer, env = process.env, now = new Date() }) {
  const accepted = { status: 202, body: { ok: true, message: GENERIC_ACCESS_LINK_MESSAGE } };
  const email = normalizeGuestEmail(rawEmail);
  if (!email) return fail(400, "invalid_email", "Adresa de email nu este validă.", "email");

  const guest = await db.customerRequestGuest.findUnique({ where: { email } });
  if (!guest || !guest.emailVerifiedAt) return accepted;

  const hasRequests = await db.customerRequest.count({ where: { guestId: guest.id } });
  if (!hasRequests) return accepted;

  const recent = await db.customerRequestGuestToken.findFirst({
    where: { guestId: guest.id, purpose: "access", createdAt: { gt: new Date(now.getTime() - LIMITS.accessLinkCooldownMs) } },
  });
  if (recent) return accepted;

  const token = await createAccessToken({ db, guestId: guest.id, now });

  return {
    ...accepted,
    after: () =>
      mailer.sendGuestCustomerRequestAccessEmail({
        to: guest.email,
        displayName: guest.displayName,
        accessUrl: accessUrlFor(token, env),
      }),
  };
}

/* revocă toate sesiunile vizitatorului (ex. „Ieși de pe acest dispozitiv” peste tot) */
export async function revokeGuestSessions({ db, guestId }) {
  await db.customerRequestGuest.update({ where: { id: guestId }, data: { accessVersion: { increment: 1 } } });
}

export async function listGuestRequests({ db, guestId }) {
  const requests = await db.customerRequest.findMany({
    where: { guestId, status: { not: "CANCELLED" } },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: { id: true, title: true, status: true, createdAt: true, expiresAt: true, images: true, userId: true },
  });

  const counts = await Promise.all(
    requests.map((r) => db.customerRequestOffer.count({ where: { requestId: r.id } }))
  );

  return requests.map((r, i) => ({
    id: r.id,
    title: r.title,
    status: r.status,
    createdAt: r.createdAt,
    expiresAt: r.expiresAt,
    imagesCount: (r.images || []).length,
    offersCount: counts[i],
    linkedToAccount: Boolean(r.userId),
  }));
}

/* =========================================================
   4. Asociere cu un cont (același email, verificat)
========================================================= */

export async function linkGuestRequestsToUser({ db, userId, now = new Date() }) {
  if (!userId) return { linked: 0 };

  const user = await db.user.findUnique({
    where: { id: String(userId) },
    select: { id: true, email: true, emailVerifiedAt: true, status: true, locked: true },
  });

  if (!user?.email || !user.emailVerifiedAt || user.locked || (user.status && user.status !== "ACTIVE")) {
    return { linked: 0 };
  }

  const guest = await db.customerRequestGuest.findUnique({ where: { email: String(user.email).trim().toLowerCase() } });
  if (!guest || !guest.emailVerifiedAt) return { linked: 0 };
  if (guest.linkedUserId && guest.linkedUserId !== user.id) return { linked: 0 };

  return db.$transaction(async (tx) => {
    const updated = await tx.customerRequest.updateMany({
      where: { guestId: guest.id, userId: null },
      data: { userId: user.id },
    });

    if (!guest.linkedUserId) {
      await tx.customerRequestGuest.update({ where: { id: guest.id }, data: { linkedUserId: user.id, linkedAt: now } });
    }

    return { linked: updated.count };
  });
}

/* =========================================================
   5. Ofertă nouă -> email către vizitator (cu pauză anti-spam)
========================================================= */

export async function notifyGuestAboutOffer({ db, requestId, vendorName, mailer, env = process.env, now = new Date() }) {
  const request = await db.customerRequest.findUnique({
    where: { id: requestId },
    select: { id: true, title: true, userId: true, guestId: true },
  });

  // cererile cu cont primesc notificarea existentă din aplicație
  if (!request?.guestId || request.userId) return { sent: false, reason: "not_guest" };

  const guest = await db.customerRequestGuest.findUnique({ where: { id: request.guestId } });
  if (!guest?.emailVerifiedAt) return { sent: false, reason: "guest_unverified" };

  const lastEmail = guest.lastOfferEmailAt ? new Date(guest.lastOfferEmailAt) : null;
  const lastAccess = guest.lastAccessAt ? new Date(guest.lastAccessAt) : null;
  if (lastEmail && (!lastAccess || lastAccess < lastEmail)) return { sent: false, reason: "waiting_for_visit" };

  // rezervare atomică: două oferte simultane -> un singur email
  const claimed = await db.customerRequestGuest.updateMany({
    where: { id: guest.id, lastOfferEmailAt: guest.lastOfferEmailAt ?? null },
    data: { lastOfferEmailAt: now },
  });
  if (claimed.count !== 1) return { sent: false, reason: "race" };

  const token = await createAccessToken({ db, guestId: guest.id, now });

  await mailer.sendGuestCustomerRequestOfferEmail({
    to: guest.email,
    displayName: guest.displayName,
    requestTitle: request.title,
    vendorName,
    accessUrl: accessUrlFor(token, env),
  });

  return { sent: true };
}

/* =========================================================
   6. Fotografii adăugate după confirmare
========================================================= */

export async function findGuestOwnedRequest({ db, guestId, requestId }) {
  const request = await db.customerRequest.findUnique({
    where: { id: String(requestId || "") },
    select: { id: true, guestId: true, userId: true, status: true, images: true, title: true },
  });
  if (!request || request.guestId !== guestId || request.userId) return null;
  return request;
}

export async function setGuestRequestImages({ db, requestId, images }) {
  return db.customerRequest.update({ where: { id: requestId }, data: { images } });
}
