// src/pages/Admin/AdminDesktop/tabs/adminFairTerms.js
//
// Admin -> Târg Artfest -> detaliul înscrierii: blocul „Acceptarea regulamentului”.
// Fără React (testabil cu node --test). Afișează DOAR ce e salvat pe înscriere:
// fără versiune acceptată nu se inventează nimic.

export const TERMS_NOT_ACCEPTED_TEXT = "Regulamentul nu a fost acceptat / versiune indisponibilă";

const SEMVER_RE = /^\d+\.\d+\.\d+$/;

// adresa publică a unei versiuni acceptate (aceeași formă ca termsUrl / CHECK-ul din DB)
export function fairTermsVersionPath(version) {
  const clean = String(version ?? "").trim();
  return SEMVER_RE.test(clean) ? `/targ-artfest/regulament/v${clean}` : null;
}

export function termsAcceptanceView(item) {
  const version = item?.termsVersion ? String(item.termsVersion).trim() : null;
  return {
    accepted: Boolean(version),
    version,
    href: version ? fairTermsVersionPath(version) : null,
    acceptedAt: item?.termsAcceptedAt || null,
    ip: item?.termsIp || null,
    ua: item?.termsUa || null,
  };
}
