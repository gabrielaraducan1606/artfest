// src/pages/Admin/AdminMarketing/creatorsPending.js
//
// Contorul profilurilor Artfest Creators „în verificare” (PENDING): lista din Admin
// îl anunță după fiecare încărcare (inclusiv după o decizie de moderare), iar
// meniul Admin și subtabul „Profiluri Creators” îl afișează fără cereri în plus.

export const CREATORS_PENDING_EVENT = "artfest:creators-pending";

/** Numărul real de profiluri PENDING (o numărătoare pe server), anunțat tuturor ascultătorilor. */
export async function refreshCreatorsPending(api) {
  try {
    const r = await api("/api/admin/creators/pending-count");
    const n = Number(r?.pending);
    if (Number.isFinite(n)) announceCreatorsPending(n);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

export function announceCreatorsPending(pending) {
  const n = Number(pending);
  if (!Number.isFinite(n) || typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(CREATORS_PENDING_EVENT, { detail: { pending: n } }));
}

/** Linkurile vechi (?tab=creators) -> Influenceri → Profiluri Creators, cu profilul păstrat. */
export function legacyCreatorsRedirect(search) {
  const params = new URLSearchParams(search || "");
  if (params.get("tab") !== "creators") return null;
  const next = new URLSearchParams({ tab: "influencers", sub: "creators" });
  if (params.get("profile")) next.set("profile", params.get("profile"));
  return next;
}
