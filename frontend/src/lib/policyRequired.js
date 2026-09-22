// src/lib/policyRequired.js
//
// Logică PURĂ (fără React / fără import.meta) pentru răspunsurile de
// "acceptare de documente necesară":
//   428 policy_acceptance_required             (enforcePolicyGate, când va fi montat)
//   428 influencer_terms_acceptance_required   (enforceInfluencerTermsGate)
//   412 policy_not_accepted                    (ex. programarea curierului - Anexa de expediere)
//
// api.js le transformă într-un eveniment de fereastră `policy:required`,
// pe care îl ascultă gate-urile din interfață (PolicyGate / modalul de
// influencer) ca să afișeze imediat documentele de acceptat, fără reload.
//
// Rulare teste: node --test src/lib/policyRequired.test.js

export const POLICY_REQUIRED_EVENT = "policy:required";

const POLICY_CODES_428 = new Set([
  "policy_acceptance_required",
  "influencer_terms_acceptance_required",
]);

function isGateScope(value) {
  return value === "USERS" || value === "VENDORS";
}

/**
 * Întoarce o descriere normalizată sau null dacă răspunsul nu e de acest tip.
 *
 * @returns {null | {
 *   status: number,
 *   kind: "policy" | "influencer_terms",
 *   code: string,
 *   scopes: string[],          // "USERS" / "VENDORS" implicate (gol = necunoscut)
 *   missing: object[],         // documente lipsă, dacă serverul le-a trimis
 *   document: string | null,   // pentru 412: documentul cerut
 *   terms: object | null,      // pentru influencer terms
 * }}
 */
export function describePolicyRequired(status, data) {
  const code = data && typeof data === "object" ? data.error : null;

  if (status === 428 && POLICY_CODES_428.has(code)) {
    if (code === "influencer_terms_acceptance_required") {
      return {
        status,
        kind: "influencer_terms",
        code,
        scopes: [],
        missing: [],
        document: "INFLUENCER_TERMS",
        terms: data.terms || null,
      };
    }

    const missing = Array.isArray(data.missing) ? data.missing : [];
    const scopes = [...new Set([data.scope, ...missing.map((m) => m?.scope)].filter(isGateScope))];

    return { status, kind: "policy", code, scopes, missing, document: null, terms: null };
  }

  if (status === 412 && code === "policy_not_accepted") {
    return {
      status,
      kind: "policy",
      code,
      scopes: ["VENDORS"],
      missing: data.policy ? [{ ...data.policy, document: data.document || null }] : [],
      document: data.document || null,
      terms: null,
    };
  }

  return null;
}

export function isPolicyRequiredResponse(status, data) {
  return describePolicyRequired(status, data) !== null;
}

/**
 * Emite evenimentul `policy:required` pe `target` (implicit window).
 * Nu aruncă niciodată (nu trebuie să strice fluxul cererii).
 */
export function notifyPolicyRequired(detail, target = globalThis.window) {
  if (!detail || !target || typeof target.dispatchEvent !== "function") return false;

  try {
    const EventCtor = globalThis.CustomEvent;

    const event =
      typeof EventCtor === "function"
        ? new EventCtor(POLICY_REQUIRED_EVENT, { detail })
        : Object.assign(new Event(POLICY_REQUIRED_EVENT), { detail });

    target.dispatchEvent(event);

    return true;
  } catch {
    return false;
  }
}

/**
 * Punctul unic apelat de api.js pentru fiecare răspuns non-2xx: dacă e un
 * 428/412 de acceptare de documente, emite `policy:required`.
 * Întoarce true dacă evenimentul a fost emis.
 */
export function reportPolicyRequired(status, data, target = globalThis.window) {
  const detail = describePolicyRequired(status, data);

  return detail ? notifyPolicyRequired(detail, target) : false;
}

/** Un răspuns de gate are documente obligatorii neacceptate? */
export function hasPendingRequiredDocuments(data) {
  return (
    data?.requiresAction === true &&
    Array.isArray(data?.documents) &&
    data.documents.some((doc) => doc?.required === true && doc?.alreadyAccepted !== true)
  );
}

/**
 * Ordinea în care se verifică scope-urile pentru un rol: toate conturile
 * verifică întâi documentele stocate per utilizator (USERS: TOS, Privacy,
 * Returns...), iar vendorii apoi și pe cele per vendor (VENDORS).
 * Administratorii nu au gate.
 */
export function scopeOrderForRole(role) {
  const value = String(role || "").toUpperCase();

  if (value === "ADMIN" || value === "SUPER_ADMIN" || !value) return [];
  if (value === "VENDOR") return ["USERS", "VENDORS"];

  return ["USERS"];
}

/**
 * Alege primul scope (în ordine) cu documente în așteptare.
 * `gates` = { USERS: răspuns, VENDORS: răspuns }; `hint` (din 428/412) are
 * prioritate dacă acel scope chiar are documente în așteptare.
 */
export function pickPendingScope(order, gates, hint = []) {
  const candidates = [...hint.filter((scope) => order.includes(scope)), ...order];

  for (const scope of candidates) {
    if (hasPendingRequiredDocuments(gates?.[scope])) return scope;
  }

  return null;
}
