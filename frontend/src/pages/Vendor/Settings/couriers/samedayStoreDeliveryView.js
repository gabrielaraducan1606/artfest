// src/pages/Vendor/Settings/couriers/samedayStoreDeliveryView.js
//
// „Livrare Sameday prin Artfest” (per magazin) - ce afișăm, din starea calculată de server
// (GET /api/vendor/stores/:serviceId/sameday-delivery). Serverul decide eligibilitatea;
// aici doar textele și acțiunea disponibilă. Fără importuri din browser (testabil cu node --test).

export const SAMEDAY_DELIVERY_RULES = Object.freeze([
  "Comenzile livrate prin Sameday cu Artfest se plătesc integral online, cu cardul (fără ramburs și fără avans).",
  "Clientul poate alege oricând livrarea ta obișnuită; metodele tale actuale de livrare și plată rămân neschimbate.",
  "Transportul Sameday este contractat și plătit de Artfest: suma de transport plătită de client pentru aceste comenzi nu intră în transferul către tine.",
  "Clienții vor vedea opțiunea după ce Artfest lansează livrarea Sameday în checkout.",
]);

/**
 * @param {object|null} status  răspunsul serverului (sameday)
 * @returns {{ state: string, tone: "ok"|"warn"|"muted"|"error", title: string, description: string,
 *   action: "activate"|"deactivate"|null, actionLabel: string|null, notes: string[] }}
 */
export function samedayDeliveryView(status) {
  if (!status) {
    return { state: "unknown", tone: "muted", title: "Starea nu este disponibilă", description: "", action: null, actionLabel: null, notes: [] };
  }
  const notes = Array.isArray(status.messages) ? status.messages : [];
  const deactivate = status.optedIn ? { action: "deactivate", actionLabel: "Dezactivează Sameday prin Artfest" } : { action: null, actionLabel: null };

  if (status.disabledByArtfest) {
    return {
      state: "disabled_by_artfest",
      tone: "error",
      title: "Dezactivată de Artfest",
      description: "Livrarea Sameday prin Artfest nu poate fi folosită pentru acest magazin. Livrarea ta obișnuită funcționează normal.",
      ...deactivate,
      notes,
    };
  }
  if (status.optedIn && status.active) {
    return {
      state: "active",
      tone: "ok",
      title: "Activată",
      description: "Magazinul este pregătit pentru livrarea Sameday prin Artfest.",
      ...deactivate,
      notes,
    };
  }
  if (status.optedIn) {
    return {
      state: "paused",
      tone: "warn",
      title: "Activată, dar indisponibilă momentan",
      description: "Până se rezolvă situația de mai jos, comenzile folosesc livrarea ta obișnuită.",
      ...deactivate,
      notes,
    };
  }
  if (status.canActivate) {
    return {
      state: "available",
      tone: "muted",
      title: "Neactivată",
      description: "Magazinul îndeplinește condițiile. Poți activa livrarea Sameday prin Artfest.",
      action: "activate",
      actionLabel: "Activează Sameday prin Artfest",
      notes,
    };
  }
  return {
    state: "not_eligible",
    tone: "muted",
    title: "Indisponibilă pentru acest magazin",
    description: "Pentru a o putea activa, sunt necesare:",
    action: null,
    actionLabel: null,
    notes,
  };
}
