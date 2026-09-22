// backend/src/services/influencerCollaborationGate.js
//
// Sursă UNICĂ pentru "poate influencerul să înceapă o activitate
// comercială NOUĂ acum?" - reutilizată de toate rutele care creează/
// activează un instrument comercial (cod nou, colecție nouă/publicată,
// acceptarea unei propuneri noi de remunerație) sau care ar genera
// atribuire NOUĂ (services/influencerAttribution.js).
//
// NU recalculează nimic - folosește STRICT computeCollaborationState
// (services/influencerCollaboration.js), care e deja sursa unică pentru
// dashboard (GET /api/influencer/me) și Admin (GET /api/admin/influencers).
//
// Regula (matricea aprobată):
//   ACTIVE   -> voie (poate genera attribution/comision nou, poate crea
//               coduri/colecții, poate accepta propuneri noi).
//   EXPIRED  -> NU voie la nimic din lista de mai sus, dar rămâne
//               READ-ONLY: dashboard, istoric, earnings, payout-uri,
//               upload de documente pentru sume deja câștigate rămân
//               NEATINSE de acest fișier (nu sunt gated aici).
//   DISABLED -> la fel ca EXPIRED pentru activitatea comercială nouă
//               (collaborationStatus === "DISABLED" != "ACTIVE", deci
//               fail-closed automat) - vezi și requireInfluencer() din
//               fiecare rută, care blochează deja TOT (inclusiv citirile)
//               pentru DISABLED, mai restrictiv decât ce face acest fișier.
//
// Prelungirea (collaborationEndOverride) readuce collaborationStatus la
// ACTIVE (dacă status contului e ACTIVE) fără nicio acțiune suplimentară
// aici - computeCollaborationState o face deja.

import { computeCollaborationState } from "./influencerCollaboration.js";

/**
 * @param {{createdAt: Date, status: string, commissionBps: number, collaborationEndOverride: Date|null}} profile
 * @returns {{ collaboration: object, canStartNewCommercialActivity: boolean }}
 */
export function resolveCollaborationGate(profile) {
  const collaboration = computeCollaborationState({
    activatedAt: profile.createdAt,
    status: profile.status,
    commissionBps: profile.commissionBps,
    collaborationEndOverride: profile.collaborationEndOverride,
  });

  return {
    collaboration,
    canStartNewCommercialActivity: collaboration.collaborationStatus === "ACTIVE",
  };
}

/**
 * Corpul JSON de răspuns (403) pentru o acțiune comercială blocată.
 * Include `collaboration` recalculat, ca frontend-ul să poată afișa
 * direct starea reală (fără un al doilea request).
 */
export function collaborationGateErrorBody(collaboration) {
  const disabled = collaboration.collaborationStatus === "DISABLED";

  return {
    ok: false,

    error: disabled ? "influencer_disabled" : "collaboration_not_active",

    message: disabled
      ? "Contul de influencer este dezactivat."
      : "Colaborarea a expirat. Prelungește colaborarea pentru a putea continua această acțiune.",

    collaboration,
  };
}
