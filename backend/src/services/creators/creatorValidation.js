// backend/src/services/creators/creatorValidation.js
//
// Artfest Creators - validări pure (fără DB), refolosite de rute și teste.
// Mesajele sunt pentru utilizator (limbaj natural, fără detalii tehnice).

import crypto from "node:crypto";

import {
  CREATOR_CATEGORY_GROUPS,
  CREATOR_LANGUAGES,
  CREATOR_LIMITS as L,
  CREATOR_NICHES,
  OFFER_CONTENT_TYPES,
  OFFER_TYPES,
  PORTFOLIO_LINK_HOSTS,
  SOCIAL_PLATFORMS,
} from "../../config/creators.js";

export class CreatorError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message || code);
    this.status = status;
    this.code = code;
    Object.assign(this, extra);
  }
}

const invalid = (fields, message = "Verifică datele completate.") =>
  new CreatorError(400, "invalid_input", message, { fields });

/* ---------------- text ---------------- */

// fără caractere de control; spațiile multiple comprimate (păstrează rândurile noi la `multiline`)
export function cleanText(value, { multiline = false } = {}) {
  if (value === null || value === undefined) return "";
  let text = String(value).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
  text = multiline
    ? text.replace(/\r\n?/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n")
    : text.replace(/\s+/g, " ");
  return text.trim();
}

export function slugify(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
}

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,58}[a-z0-9])$/;
const RESERVED_SLUGS = new Set(["admin", "api", "creatori", "influencer", "nou", "noi", "configurare", "oferte", "artfest"]);

export function validateSlug(value) {
  const slug = String(value || "").trim().toLowerCase();
  if (!SLUG_RE.test(slug) || slug.includes("--") || RESERVED_SLUGS.has(slug)) return null;
  return slug;
}

/* ---------------- URL-uri ---------------- */

/*
 * Doar https, fără date de autentificare, fără port, doar domeniile permise.
 * Întoarce URL-ul normalizat sau null. Respinge javascript:, data:, http:,
 * IDN-uri înșelătoare (host-ul trebuie să fie exact unul din listă).
 */
export function safeHttpsUrl(value, allowedHosts) {
  const raw = String(value || "").trim();
  if (!raw || raw.length > L.urlMax || /\s/.test(raw)) return null;
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (url.username || url.password || url.port) return null;
  const host = url.hostname.toLowerCase();
  if (!allowedHosts.includes(host)) return null;
  url.hash = "";
  return url.toString();
}

// numele contului din URL (primul segment de cale, fără @); null dacă lipsește
export function handleFromUrl(platform, normalizedUrl) {
  try {
    const url = new URL(normalizedUrl);
    const segments = url.pathname.split("/").filter(Boolean);
    if (!segments.length) return null;
    let first = segments[0];
    if (platform === "YOUTUBE" && ["c", "channel", "user"].includes(first) && segments[1]) first = segments[1];
    if (platform === "FACEBOOK" && first === "profile.php") return url.searchParams.get("id") || null;
    const handle = decodeURIComponent(first).replace(/^@/, "");
    return /^[\p{L}\p{N}._-]{1,100}$/u.test(handle) ? handle : null;
  } catch {
    return null;
  }
}

/* ---------------- liste din configurație ---------------- */

function pickKeys(value, allowed, max, field, fields, label) {
  const list = Array.isArray(value) ? value : [];
  const out = [...new Set(list.map((v) => String(v || "").trim()).filter(Boolean))];
  if (out.some((key) => !Object.hasOwn(allowed, key))) {
    fields[field] = `Alege ${label} din listă.`;
    return [];
  }
  if (out.length > max) {
    fields[field] = `Poți alege maximum ${max}.`;
    return [];
  }
  return out;
}

function intOrNull(value, { min = 0, max }) {
  if (value === null || value === undefined || value === "") return { ok: true, value: null };
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) return { ok: false, value: null };
  return { ok: true, value: n };
}

/* ---------------- profil (copia de lucru) ---------------- */

/*
 * Câmpurile editabile ale profilului. Toate sunt opționale la salvarea draftului;
 * se validează doar ce s-a trimis. Cerințele minime de publicare sunt în
 * `publishProblems`, separat.
 */
export function validateProfilePatch(body = {}) {
  const fields = {};
  const data = {};

  if ("displayName" in body) {
    const name = cleanText(body.displayName);
    if (name && (name.length < L.displayNameMin || name.length > L.displayNameMax)) {
      fields.displayName = `Numele public are între ${L.displayNameMin} și ${L.displayNameMax} de caractere.`;
    } else data.displayName = name || null;
  }

  if ("slug" in body) {
    const slug = body.slug ? validateSlug(body.slug) : null;
    if (body.slug && !slug) {
      fields.slug = "Adresa poate conține doar litere mici, cifre și cratime (3-60 de caractere).";
    } else if (slug) data.slug = slug;
  }

  if ("bio" in body) {
    const bio = cleanText(body.bio, { multiline: true });
    if (bio.length > L.bioMax) fields.bio = `Descrierea poate avea maximum ${L.bioMax} de caractere.`;
    else data.bio = bio || null;
  }

  if ("city" in body) {
    const city = cleanText(body.city);
    if (city.length > L.cityMax) fields.city = "Localitatea este prea lungă.";
    else data.city = city || null;
  }

  if ("niches" in body) data.niches = pickKeys(body.niches, CREATOR_NICHES, L.nichesMax, "niches", fields, "nișele");
  if ("preferredCategories" in body) {
    data.preferredCategories = pickKeys(body.preferredCategories, CREATOR_CATEGORY_GROUPS, L.categoriesMax, "preferredCategories", fields, "categoriile");
  }
  if ("contentLanguages" in body) {
    data.contentLanguages = pickKeys(body.contentLanguages, CREATOR_LANGUAGES, L.languagesMax, "contentLanguages", fields, "limba");
  }

  for (const key of ["acceptsProducts", "acceptsPaid", "availableForCollabs"]) {
    if (key in body) {
      if (typeof body[key] !== "boolean") fields[key] = "Alege da sau nu.";
      else data[key] = body[key];
    }
  }

  if ("typicalTurnaroundDays" in body) {
    const days = intOrNull(body.typicalTurnaroundDays, { min: 1, max: L.turnaroundMaxDays });
    if (!days.ok) fields.typicalTurnaroundDays = `Termenul este între 1 și ${L.turnaroundMaxDays} de zile.`;
    else data.typicalTurnaroundDays = days.value;
  }

  if (Object.keys(fields).length) throw invalid(fields);
  return data;
}

/* ---------------- rețele sociale ---------------- */

export function validateSocialAccounts(list) {
  if (!Array.isArray(list)) throw invalid({ socials: "Lista rețelelor sociale lipsește." });
  const fields = {};
  const out = [];
  const seen = new Set();

  list.forEach((item, index) => {
    const platform = String(item?.platform || "").toUpperCase();
    const key = `socials.${index}`;
    const def = SOCIAL_PLATFORMS[platform];
    if (!def) {
      fields[key] = "Platformă necunoscută.";
      return;
    }
    if (seen.has(platform)) {
      fields[key] = `Ai adăugat deja ${def.label}.`;
      return;
    }
    seen.add(platform);

    const url = safeHttpsUrl(item.url, def.hosts);
    if (!url) {
      fields[key] = `Adaugă linkul complet către profilul tău ${def.label} (https://${def.hosts[0]}/...).`;
      return;
    }
    const handleInput = cleanText(item.handle).replace(/^@/, "");
    const handle = handleInput || handleFromUrl(platform, url);
    if (!handle || handle.length > L.handleMax || !/^[\p{L}\p{N}._-]+$/u.test(handle)) {
      fields[key] = `Completează numele contului ${def.label}.`;
      return;
    }
    const followers = intOrNull(item.followersDeclared, { min: 0, max: L.followersMax });
    if (!followers.ok || followers.value === null) {
      fields[key] = `Completează numărul de urmăritori ${def.label} (număr întreg).`;
      return;
    }
    const views = intOrNull(item.avgViewsDeclared, { min: 0, max: L.viewsMax });
    const engagement = intOrNull(item.engagementBps, { min: 0, max: L.engagementBpsMax });
    if (!views.ok || !engagement.ok) {
      fields[key] = "Statisticile opționale trebuie să fie numere pozitive.";
      return;
    }
    out.push({
      platform,
      url,
      handle,
      followersDeclared: followers.value,
      avgViewsDeclared: views.value,
      engagementBps: engagement.value,
    });
  });

  if (Object.keys(fields).length) throw invalid(fields);
  return out;
}

/* ---------------- portofoliu ---------------- */

export function validatePortfolioItem(body = {}, { uploadPrefix }) {
  const fields = {};
  const kind = String(body.kind || "").toUpperCase();
  const title = cleanText(body.title);
  const description = cleanText(body.description, { multiline: true });
  const data = { kind, title, description: description || null, imageUrl: null, linkUrl: null };

  if (!["IMAGE", "LINK"].includes(kind)) fields.kind = "Alege fotografie sau link.";
  if (!title || title.length > L.portfolioTitleMax) fields.title = "Adaugă un titlu scurt (maximum 120 de caractere).";
  if (description.length > L.portfolioDescriptionMax) fields.description = "Descrierea poate avea maximum 500 de caractere.";

  if (kind === "IMAGE") {
    const url = String(body.imageUrl || "").trim();
    // doar fotografii încărcate prin Artfest (nu URL-uri externe)
    if (!uploadPrefix || !url.startsWith(uploadPrefix) || url.length > 500) fields.imageUrl = "Încarcă fotografia din calculator sau telefon.";
    else data.imageUrl = url;
  }
  if (kind === "LINK") {
    const url = safeHttpsUrl(body.linkUrl, PORTFOLIO_LINK_HOSTS);
    if (!url) fields.linkUrl = "Adaugă un link https către Instagram, TikTok, Facebook, YouTube sau Vimeo.";
    else data.linkUrl = url;
  }

  if (Object.keys(fields).length) throw invalid(fields);
  return data;
}

export function validateAvatarUrl(value, { uploadPrefix }) {
  if (value === null || value === "") return null;
  const url = String(value || "").trim();
  if (!uploadPrefix || !url.startsWith(uploadPrefix) || url.length > 500) {
    throw invalid({ avatarUrl: "Încarcă fotografia de profil din calculator sau telefon." });
  }
  return url;
}

/* ---------------- cerințele minime de publicare ---------------- */

// [{ field, step, message }] - goală = profilul poate fi trimis spre aprobare
export function publishProblems(profile, socials = []) {
  const problems = [];
  const add = (field, step, message) => problems.push({ field, step, message });

  if (!profile.avatarUrl) add("avatarUrl", 1, "Adaugă o fotografie de profil.");
  if (!profile.displayName || profile.displayName.length < L.displayNameMin) add("displayName", 1, "Completează numele public.");
  if (!profile.bio || profile.bio.length < L.bioMin) {
    add("bio", 1, `Scrie o descriere de cel puțin ${L.bioMin} de caractere despre tine și conținutul tău.`);
  }
  if (!profile.niches?.length) add("niches", 1, "Alege cel puțin o nișă.");
  if (!socials.length) add("socials", 2, "Adaugă cel puțin o rețea socială, cu numărul de urmăritori.");
  if (!profile.acceptsProducts && !profile.acceptsPaid) add("collaboration", 3, "Alege cum dorești să colaborezi: produse, promovare plătită sau ambele.");
  return problems;
}

/* ---------------- oferte ---------------- */

export function validateOffer(body = {}) {
  const fields = {};
  const title = cleanText(body.title);
  const description = cleanText(body.description, { multiline: true });
  const conditions = cleanText(body.conditions, { multiline: true });
  const platform = String(body.platform || "").toUpperCase();
  const contentType = String(body.contentType || "").toUpperCase();
  const type = String(body.type || "").toUpperCase();

  if (!title || title.length > L.offerTitleMax) fields.title = "Dă un titlu pachetului (maximum 120 de caractere).";
  if (description.length > L.offerDescriptionMax) fields.description = "Descrierea este prea lungă.";
  if (conditions.length > L.offerConditionsMax) fields.conditions = "Condițiile sunt prea lungi.";
  if (!SOCIAL_PLATFORMS[platform]) fields.platform = "Alege platforma.";
  if (!Object.hasOwn(OFFER_CONTENT_TYPES, contentType)) fields.contentType = "Alege tipul de conținut.";
  if (!Object.hasOwn(OFFER_TYPES, type)) fields.type = "Alege tipul ofertei.";

  const deliverablesIn = Array.isArray(body.deliverables) ? body.deliverables : [];
  const deliverables = [];
  const seen = new Set();
  for (const item of deliverablesIn) {
    const dType = String(item?.type || "").toUpperCase();
    const count = Number(item?.count);
    if (!Object.hasOwn(OFFER_CONTENT_TYPES, dType) || !Number.isInteger(count) || count < 1 || count > L.deliverableCountMax || seen.has(dType)) {
      fields.deliverables = "Fiecare livrabil are un tip și un număr între 1 și 50 (fără tipuri repetate).";
      break;
    }
    seen.add(dType);
    deliverables.push({ type: dType, count });
  }
  if (!deliverables.length && !fields.deliverables) fields.deliverables = "Adaugă cel puțin un livrabil (ex. 1 Reel).";
  if (deliverables.length > L.deliverablesMax) fields.deliverables = `Maximum ${L.deliverablesMax} tipuri de livrabile.`;

  const turnaround = intOrNull(body.turnaroundDays, { min: 1, max: L.turnaroundMaxDays });
  if (!turnaround.ok || turnaround.value === null) fields.turnaroundDays = `Termenul este între 1 și ${L.turnaroundMaxDays} de zile.`;

  // remunerația: în lei, cu maximum 2 zecimale -> bani (fără floating point)
  let creatorFeeCents = null;
  if (type === "PAID" || type === "MIXED") {
    creatorFeeCents = leiToCents(body.creatorFee);
    if (creatorFeeCents === null || creatorFeeCents < L.feeMinCents || creatorFeeCents > L.feeMaxCents) {
      fields.creatorFee = "Completează remunerația dorită, în lei (ex. 200 sau 199,50).";
    }
  }

  let acceptsProduct = body.acceptsProduct === true;
  if (type === "BARTER" || type === "MIXED") acceptsProduct = true;

  if (Object.keys(fields).length) throw invalid(fields);

  const content = {
    title,
    description: description || null,
    platform,
    contentType,
    deliverables,
    turnaroundDays: turnaround.value,
    type,
    creatorFeeCents,
    acceptsProduct,
    conditions: conditions || null,
  };
  return { ...content, contentHash: offerContentHash(content) };
}

// "200", "199,50", "199.5", 200 -> bani; null dacă nu e o sumă validă
export function leiToCents(value) {
  if (value === null || value === undefined || value === "") return null;
  const text = String(value).trim().replace(/\s/g, "").replace(",", ".");
  const match = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) return null;
  const whole = Number(match[1]);
  const fraction = Number((match[2] || "").padEnd(2, "0"));
  return whole * 100 + fraction;
}

export function offerContentHash(content) {
  const canonical = JSON.stringify([
    content.title,
    content.description,
    content.platform,
    content.contentType,
    content.deliverables,
    content.turnaroundDays,
    content.type,
    content.creatorFeeCents,
    content.acceptsProduct,
    content.conditions,
  ]);
  return crypto.createHash("sha256").update(canonical).digest("hex");
}

export function validateReason(value, { required = false } = {}) {
  const reason = cleanText(value, { multiline: true });
  if (required && reason.length < 3) throw invalid({ reason: "Scrie motivul (minimum 3 caractere)." });
  if (reason.length > L.reasonMax) throw invalid({ reason: `Motivul poate avea maximum ${L.reasonMax} de caractere.` });
  return reason || null;
}
