// src/pages/SecretSanta/secretSanta.js
//
// Secret Santa Artfest - texte, adrese API și logica pură a paginii
// (testabilă fără browser). Separat complet de Târgul Artfest.

export const SS_PUBLIC_API = "/api/public/secret-santa";
export const SS_VENDOR_API = "/api/vendor/secret-santa";
export const SS_ADMIN_API = "/api/admin/secret-santa";

export const SS_RULES = [
  "Participă gratuit doar vânzătorii Artfest.",
  "Cadoul handmade are valoarea de 50–80 lei.",
  "Fiecare trimite un cadou și primește unul.",
  "Transportul este achitat de expeditor, fără ramburs la destinatar.",
  "Cadoul trebuie expediat până la termenul stabilit.",
];

export const SS_DATA_NOTICE =
  "Folosim datele de livrare doar pentru expedierea cadoului tău Secret Santa. Le vede numai vânzătorul desemnat la extragere să-ți trimită cadoul și administratorii autorizați Artfest. Le ștergem după încheierea ediției.";

// ediție de TEST (?test=<cheie>): aceeași pagină, alt parametru către API
export function withEdition(url, testKey) {
  return testKey ? `${url}${url.includes("?") ? "&" : "?"}edition=${encodeURIComponent(testKey)}` : url;
}

export function formatSsDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("ro-RO", { day: "numeric", month: "long", year: "numeric" });
}

export const EMPTY_FORM = {
  storeId: "",
  recipientName: "",
  email: "",
  phone: "",
  county: "",
  city: "",
  address: "",
  postalCode: "",
  preferences: "",
  dataNotice: false,
};

// formularul pornește din înscrierea existentă sau din datele contului
export function initialForm(state) {
  const reg = state?.registration;
  if (reg) {
    const store = (state.stores || []).find((item) => item.name === reg.storeName);
    return {
      ...EMPTY_FORM,
      storeId: store?.id || state?.stores?.[0]?.id || "",
      recipientName: reg.recipientName || "",
      email: reg.email || "",
      phone: reg.phone || "",
      county: reg.county || "",
      city: reg.city || "",
      address: reg.address || "",
      postalCode: reg.postalCode || "",
      preferences: reg.preferences || "",
      dataNotice: false,
    };
  }
  return {
    ...EMPTY_FORM,
    storeId: state?.stores?.[0]?.id || "",
    email: state?.defaults?.email || "",
    phone: state?.defaults?.phone || "",
  };
}

/*
 * Ce vede vizitatorul în zona de acțiune:
 *   no_edition | login | not_vendor | loading | not_eligible |
 *   my_santa (după extragere, participant) | missed (după extragere, neînscris) |
 *   form (înscriere deschisă) | registered (înscris, în așteptarea extragerii) | closed
 */
// deschiderea înscrierilor oficiale (aceeași dată ca backend/src/config/secretSanta.js)
export const SS_OFFICIAL_OPENS_AT = "2026-11-17T00:00:00+02:00";

// butonul „Testează înscrierea”: doar ADMIN, doar până la deschiderea oficială
export function adminTestAvailable(me, now = Date.now()) {
  return me?.role === "ADMIN" && now < Date.parse(SS_OFFICIAL_OPENS_AT);
}

export function pageMode({ edition, me, vendorState, now = Date.now() }) {
  if (!edition) return now < Date.parse(SS_OFFICIAL_OPENS_AT) ? "not_yet_open" : "no_edition";
  // ediție publicată, cu înscrieri programate (ex. 17 noiembrie): încă nu se acceptă înscrieri
  if (
    edition.status === "OPEN" &&
    !edition.registrationOpen &&
    edition.registrationOpensAt &&
    new Date(edition.registrationOpensAt).getTime() > now
  ) {
    return "not_yet_open";
  }
  if (!me) return edition.drawn ? "missed" : "login";
  if (me.role !== "VENDOR") return "not_vendor";
  if (!vendorState) return "loading";
  if (vendorState.registration && vendorState.edition?.drawn) return "my_santa";
  if (vendorState.edition?.drawn) return "missed";
  if (!vendorState.eligible) return "not_eligible";
  if (vendorState.registration) return "registered";
  return vendorState.edition?.registrationOpen ? "form" : "closed";
}

export function participantsLabel(count) {
  const n = Number(count) || 0;
  if (n === 1) return "1 vânzător înscris";
  const de = n >= 20 && (n % 100 >= 20 || n % 100 === 0) ? " de" : "";
  return `${n}${de} vânzători înscriși`;
}

/**
 * Admin -> invitația prin email: de ce butonul „Trimite invitația vânzătorilor” e
 * dezactivat (null = se poate trimite). Datele vin din GET /api/admin/secret-santa/invite.
 */
export function inviteSendDisabledReason(data) {
  if (!data) return "Se încarcă…";
  if (data.run?.running) return "Trimiterea este în curs.";
  if (!data.canSend) return data.blockReason || "Trimiterea nu este disponibilă acum.";
  if (!data.unsubscribeAvailable) return "Linkul de dezabonare nu poate fi generat (configurare server), deci nu se trimite nimic.";
  if (!data.willSend) return "Nu există destinatari noi pentru invitație.";
  return null;
}
