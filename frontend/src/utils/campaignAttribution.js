// src/utils/campaignAttribution.js

/*
 * Memoria de CAMPANIE vendor (VendorCampaign) - request-based,
 * privacy-minimal, același model ca referral-ul (utils/referralMemory.js).
 *
 * Slug-urile campaniilor vizitate (/c/:slug, modalul campaniei din profilul
 * magazinului, ?camp= din URL) sunt ținute DOAR în memoria aplicației,
 * cele mai recente întâi (distincte, cel mult MAX_CAMPAIGN_SLUGS), și
 * trimise ca `campaignSlugs` la coș / sumar / checkout / prețuri. Serverul
 * revalidează fiecare campanie fresh din DB și alege, per vendor, cea mai
 * recentă campanie VALIDĂ (backend/src/services/campaignAttribution.js).
 *
 * NU citește / scrie localStorage / sessionStorage / cookie, nu face
 * request și NU depinde de consimțământul „Atribuire” (slug-ul e public,
 * nu identifică vizitatorul; reducerea și comisionul de campanie sunt
 * tranzacționale). Refresh / tab nou: doar prin URL (?camp= pe paginile
 * de produs din campanie și pe /checkout).
 *
 * Fosta cheie localStorage „artfest.campaignAttribution” (tokenul JWT
 * per vendor) NU mai e folosită; rămâne doar în lista de curățare din
 * lib/cookieConsent.js pentru datele vechi de pe dispozitive.
 */

export const CAMPAIGN_PARAM = "camp";
export const MAX_CAMPAIGN_SLUGS = 10;
const CAMPAIGN_SLUG_MAX_LENGTH = 160;

function normalizeSlug(value) {
  const slug = String(value ?? "").trim();
  if (!slug || slug.length > CAMPAIGN_SLUG_MAX_LENGTH || slug.includes(",")) return null;
  return slug;
}

export function createCampaignMemory() {
  let slugs = []; // cele mai recente întâi

  // vizită campanie -> last-click-wins (devine cea mai recentă)
  function capture(value) {
    const slug = normalizeSlug(value);
    if (!slug) return false;
    slugs = [slug, ...slugs.filter((s) => s !== slug)].slice(0, MAX_CAMPAIGN_SLUGS);
    return true;
  }

  // ?camp= (repetabil; ordinea din URL = cea mai recentă primul)
  function captureFromSearch(search) {
    const values = new URLSearchParams(search || "").getAll(CAMPAIGN_PARAM);
    [...values].reverse().forEach((slug) => capture(slug));
  }

  // după o comandă: campaniile cu ≥1 produs eligibil (răspunsul serverului)
  function consume(consumed = []) {
    if (!Array.isArray(consumed) || !consumed.length) return;
    const drop = new Set(consumed.map(String));
    slugs = slugs.filter((s) => !drop.has(s));
  }

  return {
    capture,
    captureFromSearch,
    consume,
    getSlugs: () => [...slugs],
    clear: () => {
      slugs = [];
    },
  };
}

/* =========================================================
   Instanța aplicației (una singură)
========================================================= */

const appMemory = createCampaignMemory();

export function captureCampaignSlug(slug) {
  return appMemory.capture(slug);
}

export function captureCampaignsFromSearch(search) {
  return appMemory.captureFromSearch(search);
}

// body checkout / coș / sumar: `campaignSlugs`
export function getCampaignSlugsForCheckout() {
  return appMemory.getSlugs();
}

// query pentru GET-uri API (coș, sumar, produse): "campaignSlugs=a%2Cb" sau ""
export function buildCampaignSlugsApiQuery() {
  const slugs = appMemory.getSlugs();
  return slugs.length ? `campaignSlugs=${encodeURIComponent(slugs.join(","))}` : "";
}

// query pentru URL-uri de pagină (produs din campanie, /checkout): "camp=a&camp=b" sau ""
export function buildCampaignUrlQuery(slugs = appMemory.getSlugs()) {
  const params = new URLSearchParams();
  (slugs || []).forEach((slug) => {
    const normalized = normalizeSlug(slug);
    if (normalized) params.append(CAMPAIGN_PARAM, normalized);
  });
  return params.toString();
}

/*
 * Apelat DOAR după o comandă plasată cu succes, cu `eligibleCampaignSlugs`
 * din răspunsul /checkout/place sau /checkout/guest/place: campaniile fără
 * niciun produs eligibil în comandă rămân în memorie (o comandă ulterioară
 * cu produse eligibile le poate folosi).
 */
export function consumeCampaignSlugs(slugs = []) {
  appMemory.consume(slugs);
}
