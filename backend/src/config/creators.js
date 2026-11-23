// backend/src/config/creators.js
//
// Artfest Creators - constantele etapei 1a (profil, rețele sociale, portofoliu,
// oferte, onboarding, tur, moderare). Fără catalog vânzători / plăți (etape ulterioare).
//
// Disponibil permanent (fără feature flag): rutele cer autentificare + rolul
// potrivit (influencer / admin); nu există pagini sau API publice de profil / oferte.
// Separat complet de programul de afiliere (InfluencerProfile.commissionBps,
// perioada de 3 luni, coduri, colecții): nimic de aici nu le citește sau scrie.

/*
 * Influencerii „noi” = contul de influencer creat ÎNCEPÂND cu această dată (UTC).
 * Doar ei, fără profil Creators, sunt duși automat în configurare la prima intrare
 * în dashboard (după acceptarea documentelor obligatorii - vezi CreatorsEntryCard).
 * Cei existenți văd doar cardul de configurare. Prima intrare în configurare
 * creează ciorna, deci redirecționarea nu se repetă (nici după „Completez mai târziu”).
 * Dată fixă în cod (înainte era o variabilă de mediu), fără nicio dependență de mediu.
 */
export const CREATORS_AUTO_ONBOARDING_SINCE = new Date("2026-11-23T00:00:00.000Z");

export function isNewCreatorsInfluencer(influencerCreatedAt, since = CREATORS_AUTO_ONBOARDING_SINCE) {
  if (!influencerCreatedAt) return false;
  const created = new Date(influencerCreatedAt);
  return !Number.isNaN(created.getTime()) && created >= since;
}

// versiunea turului ghidat: o creștere îl reafișează o singură dată tuturor
export const CREATOR_TOUR_VERSION = 1;

export const CREATOR_PATHS = Object.freeze({
  home: "/influencer/creatori",
  onboarding: "/influencer/creatori/configurare",
  offers: "/influencer/creatori/oferte",
  admin: (profileId) => `/admin/marketing?tab=creators&profile=${encodeURIComponent(profileId)}`,
});

/* ---------------- rețele sociale ---------------- */

// doar https, doar domeniile oficiale ale platformei (fără scurtături / redirecturi)
export const SOCIAL_PLATFORMS = Object.freeze({
  INSTAGRAM: { label: "Instagram", hosts: ["instagram.com", "www.instagram.com"] },
  TIKTOK: { label: "TikTok", hosts: ["tiktok.com", "www.tiktok.com"] },
  FACEBOOK: { label: "Facebook", hosts: ["facebook.com", "www.facebook.com", "m.facebook.com"] },
  YOUTUBE: { label: "YouTube", hosts: ["youtube.com", "www.youtube.com", "m.youtube.com"] },
});

// portofoliu: linkuri doar spre platformele sociale + Vimeo
export const PORTFOLIO_LINK_HOSTS = Object.freeze([
  ...new Set([
    ...Object.values(SOCIAL_PLATFORMS).flatMap((p) => p.hosts),
    "youtu.be",
    "vimeo.com",
    "www.vimeo.com",
  ]),
]);

/* ---------------- nișe, categorii, limbi ---------------- */

export const CREATOR_NICHES = Object.freeze({
  lifestyle: "Lifestyle",
  home_decor: "Casă și decor",
  gifts: "Cadouri",
  fashion: "Modă și accesorii",
  beauty: "Beauty și îngrijire",
  parenting: "Părinți și copii",
  family: "Familie",
  weddings: "Nunți și evenimente",
  diy_crafts: "DIY și handmade",
  art: "Artă",
  food: "Food",
  travel: "Călătorii",
  eco: "Sustenabilitate",
  pets: "Animale de companie",
  books: "Cărți și papetărie",
  local: "Local și comunitate",
});

// categoriile de produse de promovat NU sunt o listă de aici: vin din catalogul
// oficial Artfest (services/creators/creatorCatalogCategories.js) - toate cele active

// limbile oferite acum; valorile salvate anterior (ex. „hu”) se păstrează în profil
export const CREATOR_LANGUAGES = Object.freeze({ ro: "Română", en: "Engleză" });
export const CREATOR_LEGACY_LANGUAGE_LABELS = Object.freeze({ hu: "Maghiară" });

/* ---------------- oferte ---------------- */

export const OFFER_CONTENT_TYPES = Object.freeze({
  REEL: "Reel",
  STORY: "Story",
  POST: "Postare",
  TIKTOK_VIDEO: "Video TikTok",
  YOUTUBE_VIDEO: "Video YouTube",
  SHORT: "Short",
  UNBOXING: "Unboxing",
  REVIEW: "Recenzie",
  LIVE: "Live",
  OTHER: "Altul",
});

export const OFFER_TYPES = Object.freeze({
  BARTER: "Produse, fără plată",
  PAID: "Promovare plătită",
  MIXED: "Produse + plată",
});

/* ---------------- limite ---------------- */

export const CREATOR_LIMITS = Object.freeze({
  displayNameMin: 2,
  displayNameMax: 80,
  bioMin: 40,
  bioMax: 1500,
  cityMax: 120,
  nichesMax: 5,
  categoriesMax: 6,
  languagesMax: 3,
  turnaroundMaxDays: 90,
  followersMax: 500_000_000,
  viewsMax: 500_000_000,
  engagementBpsMax: 10_000,
  urlMax: 300,
  handleMax: 100,
  portfolioMax: 12,
  portfolioTitleMax: 120,
  portfolioDescriptionMax: 500,
  offersMax: 20,
  offerTitleMax: 120,
  offerDescriptionMax: 2000,
  offerConditionsMax: 2000,
  deliverablesMax: 6,
  deliverableCountMax: 50,
  // remunerație dorită: între 1 leu și 100.000 lei (în bani)
  feeMinCents: 100,
  feeMaxCents: 10_000_000,
  reasonMax: 2000,
  uploadMaxBytes: 10 * 1024 * 1024,
  uploadMaxPixels: 40_000_000,
});

// folderul R2 al imaginilor Creators (avatar + portofoliu)
export const CREATOR_UPLOAD_FOLDER = "creators";

// emailurile de status: maximum atâtea încercări per eveniment
export const CREATOR_EMAIL_MAX_ATTEMPTS = 5;

/* ---------------- opțiunile pentru interfață (influencer + Admin) ---------------- */

export function creatorOptions() {
  const toList = (obj) => Object.entries(obj).map(([value, label]) => ({ value, label }));
  return {
    niches: toList(CREATOR_NICHES),
    languages: toList(CREATOR_LANGUAGES),
    // etichete și pentru limbile scoase din listă, salvate deja în unele profiluri
    languageLabels: { ...CREATOR_LEGACY_LANGUAGE_LABELS, ...CREATOR_LANGUAGES },
    platforms: Object.entries(SOCIAL_PLATFORMS).map(([value, def]) => ({ value, label: def.label, host: def.hosts[0], hosts: [...def.hosts] })),
    contentTypes: toList(OFFER_CONTENT_TYPES),
    offerTypes: toList(OFFER_TYPES),
    limits: {
      displayNameMin: CREATOR_LIMITS.displayNameMin,
      bioMin: CREATOR_LIMITS.bioMin,
      bioMax: CREATOR_LIMITS.bioMax,
      displayNameMax: CREATOR_LIMITS.displayNameMax,
      nichesMax: CREATOR_LIMITS.nichesMax,
      categoriesMax: CREATOR_LIMITS.categoriesMax,
      portfolioMax: CREATOR_LIMITS.portfolioMax,
      offersMax: CREATOR_LIMITS.offersMax,
      turnaroundMaxDays: CREATOR_LIMITS.turnaroundMaxDays,
      uploadMaxBytes: CREATOR_LIMITS.uploadMaxBytes,
    },
    tourVersion: CREATOR_TOUR_VERSION,
  };
}
