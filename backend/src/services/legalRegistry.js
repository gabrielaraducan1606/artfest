// src/services/legalRegistry.js
//
// SURSA UNICĂ despre documentele juridice administrabile: ce document e,
// unde se stochează acceptarea, cui i se adresează (audience) și dacă
// intră în mecanismul contractual de reacceptare.
//
// Reguli (decise):
//  - "Publică versiunea" (UserPolicy/VendorPolicy) și "Cere reacceptarea"
//    (PolicyGateCampaign) sunt acțiuni SEPARATE. Doar cererea poate deschide
//    gate-ul pentru utilizatorii existenți.
//  - Returns e desfăcut în două rânduri independente: USER (UserPolicy /
//    UserConsent) și VENDOR (VendorPolicy / VendorAcceptance).
//  - TOS/Privacy se aplică USER, VENDOR și INFLUENCER; acceptarea se
//    stochează per utilizator (un singur rând de politică, comun), dar
//    cererea de reacceptare se face pe audience.
//  - Cookies NU e document contractual: consimțământul lui se gestionează
//    exclusiv prin CookieConsent + consentVersion (apare în Admin doar
//    informativ).
//
// Fără schimbări de schemă Prisma: cererile de reacceptare sunt rânduri
// PolicyGateCampaign cu campaignKey prefixat "req_" și documents[]
// codificat "KEY@AUDIENCE@VERSION[@deadlineISO]"; evenimentele de publicare
// (audit) sunt rânduri cu prefix "pub_" și audience "PUBLISH".

export const AUDIENCES = Object.freeze(["USER", "VENDOR", "INFLUENCER"]);

export const AUDIENCE_ROLES = Object.freeze({
  USER: ["USER"],
  VENDOR: ["VENDOR"],
  INFLUENCER: ["INFLUENCER"],
});

export const REQUEST_CAMPAIGN_PREFIX = "req_";
export const PUBLISH_CAMPAIGN_PREFIX = "pub_";
export const PUBLISH_AUDIENCE_TOKEN = "PUBLISH";

export const LEGAL_DOCUMENTS = Object.freeze([
  {
    catalogId: "TOS",
    key: "TOS",
    label: "Termeni și Condiții",
    manifestType: "tos",
    storage: "USER",
    policyDocument: "TOS",
    audiences: ["USER", "VENDOR", "INFLUENCER"],
    contractual: true,
  },
  {
    catalogId: "PRIVACY",
    key: "PRIVACY",
    label: "Politica de confidențialitate",
    manifestType: "privacy",
    storage: "USER",
    policyDocument: "PRIVACY_ACK",
    audiences: ["USER", "VENDOR", "INFLUENCER"],
    contractual: true,
  },
  {
    catalogId: "RETURNS_POLICY_ACK@USER",
    key: "RETURNS_POLICY_ACK",
    label: "Politica de retur (clienți)",
    manifestType: "returns_policy_ack",
    storage: "USER",
    policyDocument: "RETURNS_POLICY_ACK",
    audiences: ["USER"],
    contractual: true,
  },
  {
    catalogId: "RETURNS_POLICY_ACK@VENDOR",
    key: "RETURNS_POLICY_ACK",
    label: "Politica de retur (vânzători)",
    manifestType: "returns_policy_ack",
    storage: "VENDOR",
    policyDocument: "RETURNS_POLICY_ACK",
    audiences: ["VENDOR"],
    contractual: true,
  },
  {
    catalogId: "VENDOR_TERMS",
    key: "VENDOR_TERMS",
    label: "Acordul Marketplace pentru Vânzători",
    manifestType: "vendor_terms",
    storage: "VENDOR",
    policyDocument: "VENDOR_TERMS",
    audiences: ["VENDOR"],
    contractual: true,
  },
  {
    catalogId: "SHIPPING_ADDENDUM",
    key: "SHIPPING_ADDENDUM",
    label: "Politica de livrare / Anexa de expediere",
    manifestType: "shipping_addendum",
    storage: "VENDOR",
    policyDocument: "SHIPPING_ADDENDUM",
    audiences: ["VENDOR"],
    contractual: true,
  },
  {
    catalogId: "PRODUCTS_ADDENDUM",
    key: "PRODUCTS_ADDENDUM",
    label: "Anexa Produse",
    manifestType: "products_addendum",
    storage: "VENDOR",
    policyDocument: "PRODUCTS_ADDENDUM",
    audiences: ["VENDOR"],
    contractual: true,
  },
  {
    catalogId: "INFLUENCER_TERMS",
    key: "INFLUENCER_TERMS",
    label: "Acordul Programului de Influenceri",
    manifestType: "influencer_terms",
    storage: "USER",
    policyDocument: "INFLUENCER_TERMS",
    audiences: ["INFLUENCER"],
    contractual: true,
    // se afișează prin InfluencerTermsGateModal, nu prin PolicyGate
    gateHandledBy: "influencer_modal",
  },
  {
    catalogId: "COOKIES",
    key: "COOKIES",
    label: "Politica de Cookie-uri",
    manifestType: "cookies",
    storage: null,
    policyDocument: null,
    audiences: [],
    contractual: false,
    informational: true,
  },
]);

/* ----------------------------------------------------
   Căutări
----------------------------------------------------- */

export function getCatalogEntry(catalogId) {
  return (
    LEGAL_DOCUMENTS.find((entry) => entry.catalogId === catalogId) || null
  );
}

export function contractualEntries() {
  return LEGAL_DOCUMENTS.filter((entry) => entry.contractual);
}

/*
 * Rândul de catalog pentru o cheie de document + audience (Returns are două
 * rânduri cu aceeași cheie; audience-ul le distinge).
 */
export function findEntryByKeyAndAudience(key, audience) {
  const normalizedKey = String(key || "").trim().toUpperCase();
  return (
    contractualEntries().find(
      (entry) =>
        entry.key === normalizedKey && entry.audiences.includes(audience)
    ) || null
  );
}

export function entriesForStorage(storage) {
  return contractualEntries().filter((entry) => entry.storage === storage);
}

export function findEntryByStorageAndKey(storage, key) {
  const normalizedKey = String(key || "").trim().toUpperCase();
  return (
    contractualEntries().find(
      (entry) => entry.storage === storage && entry.key === normalizedKey
    ) || null
  );
}

export function audienceForRole(role) {
  const normalized = String(role || "").toUpperCase();
  return AUDIENCES.includes(normalized) ? normalized : null;
}

/* ----------------------------------------------------
   Codificarea cerințelor în PolicyGateCampaign.documents (String[])
----------------------------------------------------- */

export function encodeRequirement({ key, audience, version, deadlineAt = null }) {
  const parts = [
    String(key).trim().toUpperCase(),
    String(audience).trim().toUpperCase(),
    String(version).trim(),
  ];

  if (deadlineAt) {
    parts.push(new Date(deadlineAt).toISOString());
  }

  return parts.join("@");
}

/*
 * Întoarce null pentru intrări legacy (fără "@") sau invalide.
 */
export function parseRequirement(value) {
  const raw = String(value || "");

  if (!raw.includes("@")) return null;

  const [key, audience, version, deadline] = raw.split("@");

  if (!key || !audience || !version) return null;

  const normalizedAudience = audience.toUpperCase();

  if (
    !AUDIENCES.includes(normalizedAudience) &&
    normalizedAudience !== PUBLISH_AUDIENCE_TOKEN
  ) {
    return null;
  }

  const deadlineAt = deadline ? new Date(deadline) : null;

  return {
    key: key.toUpperCase(),
    audience: normalizedAudience,
    version,
    deadlineAt:
      deadlineAt && !Number.isNaN(deadlineAt.getTime()) ? deadlineAt : null,
  };
}
