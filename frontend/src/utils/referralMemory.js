// src/utils/referralMemory.js

/*
 * Memoria de REFERRAL (influencer + vendor) - request-based, privacy-minimal.
 *
 * Linkurile de influencer și de vendor folosesc ACELAȘI parametru `?ref=`,
 * iar frontend-ul NU știe (și nu întreabă serverul) de ce tip e un cod.
 * De aceea păstrăm, DOAR în memoria aplicației:
 *  - explicit:   codurile ?ref= văzute în navigarea curentă, cele mai
 *                recente întâi (distincte, cel mult MAX_EXPLICIT);
 *  - collection: proprietarul colecției de influencer vizitate fără ?ref=
 *                (fallback; primul rămâne).
 *  - vendorCollections: slug-urile VendorCollection vizitate (/colectie-vendor/:slug,
 *                ?vcol=), cele mai recente întâi - NU un ?ref= generic: serverul
 *                atribuie colecția DOAR produselor efectiv membre, per item.
 * La checkout trimitem lista, iar SERVERUL alege cel mai recent cod valid de
 * influencer și cel mai recent cod valid de vendor (services/referralAttribution.js)
 * - aceeași semantică ca tokenurile vechi (câte unul pe tip), deci aceleași
 * priorități (influencer vs vendor, colecție, coduri de reducere, campanii).
 *
 * NU citește / scrie localStorage / sessionStorage / cookie; nu face request.
 * Refresh / tab nou: doar prin URL (?ref= / cref= pe paginile care contează).
 *
 * Consimțământ: un singur punct de control, ATTRIBUTION_REQUIRES_CONSENT
 * (config/features.js), aplicat AICI. Cu false (varianta curentă) fluxul nu
 * depinde de consimțământ; cu true, codurile sunt folosite doar cu
 * consimțământ „Atribuire” (fără decizie -> ținute în memorie; refuz /
 * retragere -> abandonate).
 */

import { hasAnyDecision, hasAttributionConsent } from "../lib/cookieConsent.js";
import { ATTRIBUTION_REQUIRES_CONSENT } from "../config/features.js";

export const COOKIE_CONSENT_EVENT = "cookie:consent";

const REFERRAL_CODE_MAX_LENGTH = 64;
export const MAX_EXPLICIT_REFERRAL_CODES = 5;
export const MAX_VENDOR_COLLECTION_SLUGS = 5;
const VENDOR_COLLECTION_SLUG_MAX_LENGTH = 180;

// parametri URL: ?ref= explicit (repetabil), ?cref= proprietarul colecției
export const REF_PARAM = "ref";
export const COLLECTION_REF_PARAM = "cref";
// ?vcol= - slug-ul unei VendorCollection (repetabil, cel mai recent primul)
export const VENDOR_COLLECTION_PARAM = "vcol";
// compatibilitate cu linkurile deja distribuite: ?ref=X&refSource=collection
export const LEGACY_COLLECTION_REF_SOURCE = "collection";

function normalizeCode(value) {
  const code = String(value ?? "").trim();
  if (!code || code.length > REFERRAL_CODE_MAX_LENGTH) return null;
  return code;
}

export function createReferralMemory({
  requiresConsent = ATTRIBUTION_REQUIRES_CONSENT,
  hasConsent = hasAttributionConsent,
  hasDecision = hasAnyDecision,
  now = () => Date.now(),
} = {}) {
  let explicit = []; // [{ code, at }] - cele mai recente întâi
  let collection = null; // { code, at }
  let vendorCollections = []; // [{ slug, at }] - cele mai recente întâi

  // cu requiresConsent=false consimțământul nu e consultat deloc
  const allowed = () => !requiresConsent || hasConsent();
  const refused = () => requiresConsent && hasDecision() && !hasConsent();

  // ?ref= explicit -> last-click-wins (devine cel mai recent)
  function captureExplicit(referralCode) {
    const code = normalizeCode(referralCode);
    if (!code || refused()) return false;
    explicit = [{ code, at: now() }, ...explicit.filter((e) => e.code !== code)].slice(0, MAX_EXPLICIT_REFERRAL_CODES);
    return true;
  }

  // proprietarul colecției -> doar dacă nu există deja un fallback de colecție
  function captureCollection(referralCode) {
    const code = normalizeCode(referralCode);
    if (!code || refused()) return false;
    if (collection) return false;
    collection = { code, at: now() };
    return true;
  }

  // VendorCollection vizitată -> last-click-wins (devine cea mai recentă)
  function captureVendorCollection(slugValue) {
    const slug = String(slugValue ?? "").trim();
    if (!slug || slug.length > VENDOR_COLLECTION_SLUG_MAX_LENGTH || refused()) return false;
    vendorCollections = [{ slug, at: now() }, ...vendorCollections.filter((e) => e.slug !== slug)].slice(
      0,
      MAX_VENDOR_COLLECTION_SLUGS
    );
    return true;
  }

  // parametrii din URL: ref (repetabil, cel mai recent primul), cref, refSource legacy, vcol
  function captureFromSearch(search) {
    const params = new URLSearchParams(search || "");

    // ?vcol= - ordinea din URL = cea mai recentă primul -> capturăm invers
    [...params.getAll(VENDOR_COLLECTION_PARAM)].reverse().forEach((slug) => captureVendorCollection(slug));
    const refs = params.getAll(REF_PARAM);
    const legacyCollection = params.get("refSource") === LEGACY_COLLECTION_REF_SOURCE;

    if (legacyCollection) {
      refs.forEach((code) => captureCollection(code));
    } else {
      // ordinea din URL = cel mai recent primul -> capturăm invers
      [...refs].reverse().forEach((code) => captureExplicit(code));
    }

    const cref = params.get(COLLECTION_REF_PARAM);
    if (cref) captureCollection(cref);
  }

  function snapshot() {
    if (!allowed()) return { explicit: [], collection: null, vendorCollections: [] };
    return {
      explicit: explicit.map((e) => ({ ...e })),
      collection: collection ? { ...collection } : null,
      vendorCollections: vendorCollections.map((e) => ({ ...e })),
    };
  }

  // câmpurile trimise la checkout / oferte
  function getCheckoutFields() {
    const s = snapshot();
    const latest = s.explicit[0]?.code || null;
    return {
      referralCodes: s.explicit,
      influencerCollectionReferralCode: s.collection?.code || null,
      // compatibilitate (câmp simplu, ca în versiunile anterioare)
      influencerReferralCode: latest || s.collection?.code || null,
      vendorReferralCode: latest,
      // VendorCollection request-based: [{ slug, at }], validat per item pe server
      vendorCollectionSlugs: s.vendorCollections,
    };
  }

  // query pentru linkul Coș -> /checkout (refresh pe checkout nu pierde nimic)
  function toCheckoutQuery() {
    const s = snapshot();
    const params = new URLSearchParams();
    s.explicit.forEach((e) => params.append(REF_PARAM, e.code));
    if (s.collection) params.set(COLLECTION_REF_PARAM, s.collection.code);
    s.vendorCollections.forEach((e) => params.append(VENDOR_COLLECTION_PARAM, e.slug));
    return params.toString();
  }

  function handleConsent(detail) {
    if (!requiresConsent) return;
    const attribution = detail ? detail.attribution === true : hasConsent();
    if (!attribution) {
      explicit = [];
      collection = null;
      vendorCollections = [];
    }
  }

  function attach(target) {
    const listener = (event) => handleConsent(event?.detail);
    target.addEventListener(COOKIE_CONSENT_EVENT, listener);
    return () => target.removeEventListener(COOKIE_CONSENT_EVENT, listener);
  }

  function clear() {
    explicit = [];
    collection = null;
    vendorCollections = [];
  }

  return {
    captureExplicit,
    captureCollection,
    captureVendorCollection,
    captureFromSearch,
    snapshot,
    getCheckoutFields,
    toCheckoutQuery,
    handleConsent,
    attach,
    clear,
  };
}

/* =========================================================
   Instanța aplicației (una singură)
========================================================= */

const appMemory = createReferralMemory();

// ascultăm consimțământul doar când politica îl cere
if (ATTRIBUTION_REQUIRES_CONSENT && typeof window !== "undefined" && window.addEventListener) {
  appMemory.attach(window);
}

export function captureReferralsFromSearch(search) {
  return appMemory.captureFromSearch(search);
}

export function captureReferralCode(referralCode) {
  return appMemory.captureExplicit(referralCode);
}

export function captureCollectionReferralCode(referralCode) {
  return appMemory.captureCollection(referralCode);
}

// pagina publică a unei VendorCollection (/colectie-vendor/:slug)
export function captureVendorCollectionSlug(slug) {
  return appMemory.captureVendorCollection(slug);
}

// payload checkout / oferte: { referralCodes, influencerCollectionReferralCode, influencerReferralCode, vendorReferralCode, vendorCollectionSlugs }
export function getReferralCheckoutFields() {
  return appMemory.getCheckoutFields();
}

export function getInfluencerReferralCodeForCheckout() {
  return appMemory.getCheckoutFields().influencerReferralCode;
}

export function getVendorReferralCodeForCheckout() {
  return appMemory.getCheckoutFields().vendorReferralCode;
}

export function getCurrentReferrals() {
  return appMemory.snapshot();
}

export function buildCheckoutReferralQuery() {
  return appMemory.toCheckoutQuery();
}
