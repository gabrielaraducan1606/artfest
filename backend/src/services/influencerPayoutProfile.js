// backend/src/services/influencerPayoutProfile.js

/*
 * Logică PURĂ + reutilizabilă pentru InfluencerPayoutProfile - sursă
 * UNICĂ pentru:
 * - GET/PATCH /api/influencer/payout-profile (influencerRoutes.js);
 * - GET /api/influencer/me (câmpul aditiv `payoutProfile`);
 * - GET /api/admin/legal/influencers (câmp read-only `payoutProfile`);
 * - trigger-ul de notificare din chekoutRoutes.js (prima comandă
 *   atribuită + profil incomplet).
 *
 * NU face nimic legat de Stripe, payout efectiv sau transfer bancar -
 * doar profilul de date (beneficiar/IBAN/date fiscale) și statusul
 * lui de completitudine.
 */

export const PAYOUT_EDITABLE_FIELDS = [
  "beneficiaryType",
  "beneficiaryName",
  "iban",
  "bankName",
  "countryCode",
  "fiscalName",
  "taxId",
  "registrationNumber",
  "fiscalAddress",
  "city",
  "postalCode",
];

const FISCAL_REQUIRED_TYPES = new Set(["PFA", "COMPANY"]);

/*
 * Regex de FORMAT (nu checksum mod-97, nu lookup bancar extern) -
 * cod țară ISO (2 litere) + 2 cifre de control + 11-30 caractere
 * alfanumerice, lungime totală 15-34 (acoperă IBAN-urile europene
 * uzuale, inclusiv RO: 24 caractere).
 */
const IBAN_FORMAT_REGEX = /^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$/;

export function normalizeIban(raw) {
  return String(raw || "")
    .replace(/\s+/g, "")
    .toUpperCase();
}

export function isValidIbanFormat(iban) {
  if (!iban) return true; // câmp opțional - gol e valid, doar isComplete îl cere condiționat
  return (
    iban.length >= 15 &&
    iban.length <= 34 &&
    IBAN_FORMAT_REGEX.test(iban)
  );
}

export function normalizeCountryCode(raw) {
  const value = String(raw || "").trim().toUpperCase();
  return value || "RO";
}

function trimmedOrNull(value) {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  return trimmed || null;
}

/**
 * Calculează isComplete STRICT server-side, din valorile finale
 * (merge între rândul existent și modificările acceptate) - niciodată
 * din ce trimite clientul.
 */
export function computeIsComplete(record) {
  const type = record?.beneficiaryType || null;

  if (!type) return false;

  const hasCore = Boolean(
    trimmedOrNull(record.beneficiaryName) &&
      trimmedOrNull(record.iban) &&
      trimmedOrNull(record.countryCode)
  );

  if (!hasCore) return false;

  if (FISCAL_REQUIRED_TYPES.has(type)) {
    return Boolean(
      trimmedOrNull(record.fiscalName) &&
        trimmedOrNull(record.taxId) &&
        trimmedOrNull(record.fiscalAddress) &&
        trimmedOrNull(record.city)
    );
  }

  // INDIVIDUAL / OTHER - minimal, fără cerințe fiscale suplimentare.
  return true;
}

/**
 * Tranziția de verificationStatus/verifiedAt după un update.
 *
 * Reguli (exacte, cerute explicit):
 * - devine incomplet -> INCOMPLETE, verifiedAt = null;
 * - era VERIFIED și s-a schimbat un câmp relevant -> COMPLETE, verifiedAt = null;
 * - era VERIFIED și NU s-a schimbat nimic relevant -> rămâne VERIFIED (evită
 *   demotarea silențioasă la un simplu re-submit din formular fără modificări);
 * - era UNDER_REVIEW/REJECTED (stări setate manual de admin - flux încă
 *   neconstruit) -> nu sunt suprascrise automat de o editare a
 *   influencerului, rămân neschimbate până la o decizie admin explicită;
 * - altfel (INCOMPLETE sau COMPLETE) și devine complet -> COMPLETE.
 */
export function resolveVerificationTransition({
  wasStatus,
  wasVerifiedAt,
  isComplete,
  hasRelevantChange,
}) {
  if (!isComplete) {
    return { verificationStatus: "INCOMPLETE", verifiedAt: null };
  }

  if (wasStatus === "UNDER_REVIEW" || wasStatus === "REJECTED") {
    return { verificationStatus: wasStatus, verifiedAt: wasVerifiedAt ?? null };
  }

  if (wasStatus === "VERIFIED") {
    if (!hasRelevantChange) {
      return { verificationStatus: "VERIFIED", verifiedAt: wasVerifiedAt ?? null };
    }

    return { verificationStatus: "COMPLETE", verifiedAt: null };
  }

  return { verificationStatus: "COMPLETE", verifiedAt: null };
}

/**
 * Detectează dacă vreunul dintre câmpurile editabile s-a schimbat
 * efectiv față de rândul existent (folosit doar pentru decizia
 * VERIFIED -> COMPLETE de mai sus).
 */
export function hasAnyRelevantFieldChanged(existingRow, mergedRecord) {
  return PAYOUT_EDITABLE_FIELDS.some((field) => {
    const before = existingRow?.[field] ?? null;
    const after = mergedRecord?.[field] ?? null;
    return before !== after;
  });
}

/**
 * Shape COMPLET (folosit DOAR de influencerul proprietar, în
 * GET /payout-profile - niciodată în /me sau admin).
 */
export function serializePayoutProfileFull(row) {
  if (!row) {
    return {
      exists: false,

      beneficiaryType: null,
      beneficiaryName: null,

      iban: null,
      bankName: null,
      countryCode: "RO",

      fiscalName: null,
      taxId: null,
      registrationNumber: null,
      fiscalAddress: null,
      city: null,
      postalCode: null,

      isComplete: false,
      verificationStatus: "INCOMPLETE",
      verifiedAt: null,

      updatedAt: null,
    };
  }

  return {
    exists: true,

    beneficiaryType: row.beneficiaryType,
    beneficiaryName: row.beneficiaryName,

    iban: row.iban,
    bankName: row.bankName,
    countryCode: row.countryCode,

    fiscalName: row.fiscalName,
    taxId: row.taxId,
    registrationNumber: row.registrationNumber,
    fiscalAddress: row.fiscalAddress,
    city: row.city,
    postalCode: row.postalCode,

    isComplete: row.isComplete,
    verificationStatus: row.verificationStatus,
    verifiedAt: row.verifiedAt,

    updatedAt: row.updatedAt,
  };
}

/**
 * Shape MINIM, fără date sensibile (IBAN/taxId/adresă) - folosit în
 * GET /api/influencer/me și în admin (listă).
 */
export function serializePayoutProfileSummary(row) {
  if (!row) {
    return {
      exists: false,
      isComplete: false,
      verificationStatus: "INCOMPLETE",
      beneficiaryType: null,
    };
  }

  return {
    exists: true,
    isComplete: row.isComplete,
    verificationStatus: row.verificationStatus,
    beneficiaryType: row.beneficiaryType,
  };
}
