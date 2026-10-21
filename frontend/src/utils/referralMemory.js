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
 * NU citește / scrie localStorage / cookie; nu face request.
 * Refresh / tab nou: prin URL (?ref= / cref= / vcol= pe paginile care contează).
 *
 * EXCEPȚIE - vendorCollections (cel mult 5 slug-uri, fără date personale)
 * sunt copiate și în sessionStorage (VENDOR_COLLECTIONS_STORAGE_KEY), ca un
 * refresh / login să nu piardă atribuirea colecției. sessionStorage dispare la
 * închiderea tab-ului (nu persistă între sesiuni). Politica de cookie-uri
 * (§3.4) cere consimțământul „Atribuire recomandări” pentru stocarea pe
 * dispozitiv - de aceea scrierea / citirea se fac DOAR cu acel consimțământ;
 * la retragere cheia e ștearsă. Fără consimțământ: doar memorie + URL.
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

// sessionStorage pentru vendorCollections (doar cu consimțământul „Atribuire”)
export const VENDOR_COLLECTIONS_STORAGE_KEY = "artfest:referral:vcol:v1";

function defaultSessionStorage() {
  try {
    return typeof window !== "undefined" && window.sessionStorage ? window.sessionStorage : null;
  } catch {
    return null; // stocare blocată (ex. setări stricte de confidențialitate)
  }
}

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
  storage = defaultSessionStorage(),
  // stocarea pe dispozitiv cere MEREU consimțământul „Atribuire” (politica §3.4),
  // indiferent de requiresConsent (care privește doar folosirea codurilor)
  canPersist = hasAttributionConsent,
} = {}) {
  let explicit = []; // [{ code, at }] - cele mai recente întâi
  let collection = null; // { code, at }
  let vendorCollections = []; // [{ slug, at }] - cele mai recente întâi

  // cu requiresConsent=false consimțământul nu e consultat deloc
  const allowed = () => !requiresConsent || hasConsent();
  const refused = () => requiresConsent && hasDecision() && !hasConsent();

  const persistAllowed = (override) => {
    try {
      return typeof override === "boolean" ? override : canPersist() === true;
    } catch {
      return false;
    }
  };

  // memorie -> sessionStorage (cu consimțământ), altfel cheia e ștearsă
  function syncStorage(consentOverride) {
    if (!storage) return;
    try {
      if (persistAllowed(consentOverride) && vendorCollections.length) {
        storage.setItem(VENDOR_COLLECTIONS_STORAGE_KEY, JSON.stringify(vendorCollections));
      } else {
        storage.removeItem(VENDOR_COLLECTIONS_STORAGE_KEY);
      }
    } catch {
      // stocare plină / blocată - memoria rămâne sursa
    }
  }

  // sessionStorage -> memorie, la crearea instanței (refresh / login)
  function rehydrate() {
    if (!storage || !persistAllowed()) return;
    try {
      const parsed = JSON.parse(storage.getItem(VENDOR_COLLECTIONS_STORAGE_KEY) || "null");
      if (!Array.isArray(parsed)) return;

      const seen = new Set();
      vendorCollections = parsed
        .map((e) => ({ slug: String(e?.slug ?? "").trim(), at: Number(e?.at) || 0 }))
        .filter((e) => e.slug && e.slug.length <= VENDOR_COLLECTION_SLUG_MAX_LENGTH && !seen.has(e.slug) && seen.add(e.slug))
        .sort((a, b) => b.at - a.at)
        .slice(0, MAX_VENDOR_COLLECTION_SLUGS);
    } catch {
      vendorCollections = [];
    }
  }

  rehydrate();

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
    syncStorage();
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
    // sessionStorage urmează MEREU consimțământul „Atribuire” (acordat -> scriem
    // memoria curentă; retras -> ștergem cheia), indiferent de requiresConsent
    syncStorage(detail ? detail.attribution === true : undefined);

    if (!requiresConsent) return;
    const attribution = detail ? detail.attribution === true : hasConsent();
    if (!attribution) {
      explicit = [];
      collection = null;
      vendorCollections = [];
      syncStorage(false);
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
    syncStorage(false);
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

// ascultăm MEREU consimțământul: sessionStorage-ul vendorCollections îl urmează;
// golirea memoriei rămâne doar când ATTRIBUTION_REQUIRES_CONSENT (handleConsent)
if (typeof window !== "undefined" && window.addEventListener) {
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
