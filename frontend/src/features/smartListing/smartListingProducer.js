// src/features/smartListing/smartListingProducer.js
//
// Artfest Smart Listing (PROTOTIP) - profiluri de producător reutilizabile
// (GPSR, Reg. UE 2023/988) și protejarea domiciliului creatorilor.
//
// Pur, fără React / rețea. Nu citește și nu scrie Vendor / Product.
//
// Reutilizează regulile EXISTENTE (backend/src/lib/gpsrCompliance.js,
// nemodificat): validateGpsrManufacturerContact (nume + adresă + email) și
// buildPublicGpsrInfo (exact ce apare public pe pagina produsului).
//
// Reguli suplimentare propuse (doar prototip, de confirmat juridic):
//   - adresa de contact NU se precompletează niciodată din adresa de
//     ridicare, de retur sau de facturare - vânzătorul o scrie / alege explicit;
//   - nu se acceptă easybox / lockere / puncte de ridicare (nu primesc
//     corespondență pe numele producătorului) și nici adresa Artfest;
//   - căsuțele poștale sunt oprite până la o decizie juridică
//     (PO_BOX_POLICY), cu mesaj și „Cere ajutor echipei Artfest”;
//   - salvarea cere confirmarea explicită că adresa e reală, că se poate
//     primi corespondență acolo și că datele vor fi publice.

import {
  buildPublicGpsrInfo,
  isValidGpsrAddress,
  isValidGpsrEmail,
  validateGpsrManufacturerContact,
  GPSR_ADDRESS_HINT,
  GPSR_CONTACT_MAX_LENGTH,
} from "../../../../backend/src/lib/gpsrCompliance.js";

export const PRODUCER_KINDS = Object.freeze({
  // vânzătorul este producătorul (Vendor.gpsrManufacturer* azi)
  SELF: "SELF",
  // alt producător, salvat pentru reutilizare (azi: câmpuri pe fiecare Product)
  OTHER: "OTHER",
});

// Decizie juridică DESCHISĂ: căsuță poștală ca adresă GPSR de contact.
// "block" = refuzată până la confirmare; "allow" = acceptată.
export const PO_BOX_POLICY = "block";

/**
 * Cele cinci adrese din Artfest, separate. „public” = ce ajunge la client
 * azi / în propunere. Folosit în interfață (explicație pentru vânzător).
 */
export const ADDRESS_USES = Object.freeze([
  {
    key: "gpsr",
    title: "Adresa de contact a producătorului (GPSR)",
    source: "Vendor.gpsrManufacturerAddress / Product.manufacturerAddress",
    visibility: "public",
    note: "Apare pe pagina produsului. E adresa poștală la care poți fi contactat ca producător - nu neapărat locul unde lucrezi.",
  },
  {
    key: "billing",
    title: "Adresa fiscală / de facturare",
    source: "VendorBilling.address",
    visibility: "private",
    note: "Pentru facturi și obligații fiscale. Nu se afișează public.",
  },
  {
    key: "pickup",
    title: "Adresa de ridicare a coletelor",
    source: "VendorPickupAddress",
    visibility: "private",
    note: "Doar pentru curier (AWB). Nu se afișează public.",
  },
  {
    key: "returns",
    title: "Adresa pentru retururi",
    source: "ServiceProfile.address",
    visibility: "buyer",
    note: "Doar clientul care returnează un produs o primește. Nu trebuie să fie publică.",
  },
  {
    key: "city",
    title: "Localitatea magazinului",
    source: "ServiceProfile.city",
    visibility: "public",
    note: "Doar orașul, pentru căutare și încredere. Fără stradă sau număr.",
  },
]);

/* ---------------- adresa de contact ---------------- */

const LOCKER_PATTERNS = [
  /\beasy\s*box\b/i,
  /\beasybox\b/i,
  /\blocker(ul|e)?\b/i,
  /\bpudo\b/i,
  /\bpunct(ul)?\s+de\s+(ridicare|colectare)\b/i,
  /\bout\s*of\s*home\b/i,
  /\bfan\s*box\b/i,
  /\bsameday\b/i,
];

const ARTFEST_PATTERN = /\bartfest\b/i;
// `\b` din JS nu consideră diacriticele litere -> limite Unicode explicite
const PO_BOX_PATTERN =
  /(?<![\p{L}\d])(c\.?\s?p\.?\s?\d+|c[aă]su[tțţ][aă]\s+po[sșş]tal[aă]|post\s*box|p\.?\s?o\.?\s?box)(?![\p{L}\d])/iu;

/**
 * Verificarea adresei poștale de contact a producătorului.
 * @returns {{ ok: boolean, errors: string[], needsHelp: boolean }}
 */
export function checkProducerAddress(address) {
  const value = String(address ?? "").trim();
  const errors = [];
  let needsHelp = false;

  if (!value) {
    return { ok: false, errors: ["Completează adresa poștală de contact."], needsHelp: false };
  }

  if (!isValidGpsrAddress(value)) errors.push(GPSR_ADDRESS_HINT);

  if (LOCKER_PATTERNS.some((pattern) => pattern.test(value))) {
    errors.push(
      "Un easybox, locker sau punct de ridicare nu poate fi adresa producătorului - acolo nu se poate primi corespondență pe numele tău."
    );
    needsHelp = true;
  }

  if (ARTFEST_PATTERN.test(value)) {
    errors.push("Nu poți folosi adresa Artfest - adresa trebuie să fie a producătorului sau a punctului lui de contact.");
    needsHelp = true;
  }

  if (PO_BOX_POLICY === "block" && PO_BOX_PATTERN.test(value)) {
    errors.push("Căsuțele poștale nu sunt acceptate deocamdată (în verificare juridică). Echipa Artfest te poate ajuta.");
    needsHelp = true;
  }

  return { ok: errors.length === 0, errors, needsHelp };
}

/* ---------------- profilul producătorului ---------------- */

/**
 * Validează un profil de producător (SELF sau OTHER).
 * @returns {{ ok: boolean, errors: Array<{ field: string, message: string }>, needsHelp: boolean }}
 */
export function validateProducerProfile(profile = {}) {
  const errors = [];

  const name = String(profile.name ?? "").trim();
  if (!name) errors.push({ field: "name", message: "Completează denumirea producătorului." });
  else if (name.length > GPSR_CONTACT_MAX_LENGTH.name) {
    errors.push({ field: "name", message: "Denumirea producătorului este prea lungă." });
  }

  const address = checkProducerAddress(profile.address);
  address.errors.forEach((message) => errors.push({ field: "address", message }));
  const needsHelp = address.needsHelp;

  const email = String(profile.email ?? "").trim();
  if (!email) errors.push({ field: "email", message: "Completează emailul de contact." });
  else if (!isValidGpsrEmail(email)) errors.push({ field: "email", message: "Emailul de contact nu este valid." });

  // aceeași regulă ca serverul (PUT /api/vendors/me/gpsr-manufacturer)
  if (!errors.length) {
    const server = validateGpsrManufacturerContact({ name, address: profile.address, email });
    if (!server.ok) errors.push({ field: server.field, message: server.message });
  }

  if (profile.kind === PRODUCER_KINDS.OTHER) {
    if (profile.inEU !== true && profile.inEU !== false) {
      errors.push({ field: "inEU", message: "Precizează dacă producătorul este stabilit în UE." });
    }
    if (profile.inEU === false) {
      const rp = validateGpsrManufacturerContact({
        name: profile.rpName,
        address: profile.rpAddress,
        email: profile.rpEmail,
      });
      if (!rp.ok) errors.push({ field: `rp-${rp.field}`, message: `Persoana responsabilă din UE: ${rp.message}` });
    }
  }

  // Corectitudinea datelor producătorului se confirmă O SINGURĂ DATĂ, în
  // declarația GPSR de la publicare (înregistrată pe server), nu aici.

  return { ok: errors.length === 0, errors, needsHelp };
}

/** Rezumatul afișat în formular („Producător: X · Contact: configurat / incomplet”). */
export function producerSummary(profile) {
  if (!profile) return { name: "", status: "missing", missing: ["producătorul"] };
  const check = validateProducerProfile(profile);
  return {
    name: String(profile.name || "").trim() || "Fără denumire",
    status: check.ok ? "complete" : "incomplete",
    missing: [...new Set(check.errors.map((item) => item.message))],
  };
}

/* ---------------- sugestii (doar cu confirmare) ---------------- */

/**
 * Sugestii din contul vânzătorului - DOAR pentru câmpurile potrivite, și
 * niciodată aplicate automat. Adresa NU are sugestii: nu propunem adresa
 * de ridicare, de retur sau fiscală (pot fi domiciliul).
 *
 * @param {{ storeName?: string, legalName?: string, accountEmail?: string }} account
 */
export function producerSuggestions(account = {}) {
  const name = [];
  const storeName = String(account.storeName || "").trim();
  const legalName = String(account.legalName || "").trim();
  if (storeName) name.push({ source: "Numele magazinului", value: storeName });
  if (legalName && legalName.toLowerCase() !== storeName.toLowerCase()) {
    name.push({ source: "Denumirea din datele de facturare", value: legalName });
  }

  const email = [];
  const accountEmail = String(account.accountEmail || "").trim();
  if (accountEmail) {
    email.push({
      source: "Emailul contului",
      value: accountEmail,
      warning: "Va fi afișat public. Dacă e personal, folosește o adresă dedicată (ex. contact@...).",
    });
  }

  return { name, email, address: [] };
}

/* ---------------- legătura cu formularul existent ---------------- */

/**
 * Salvarea produsului ar scrie datele CENTRALE ale vânzătorului? Da, doar dacă
 * ciorna are conținut și diferă de datele salvate (aceeași regulă ca
 * saveVendorGpsrDraftIfNeeded). PUT-ul reevaluează produsele PENDING oprite doar
 * de GPSR, așa că formularul cere o confirmare separată pentru această scriere.
 */
export function centralGpsrWillChange(state) {
  const draft = state?.draft;
  if (!draft) return false;
  const clean = (value) => String(value || "").trim();
  const fields = ["name", "address", "email"];
  if (fields.every((field) => !clean(draft[field]))) return false;
  if (!state.complete) return true;
  return fields.some((field) => clean(draft[field]) !== clean(state.saved?.[field]));
}

/**
 * Producătorul ales -> câmpurile GPSR ale formularului existent
 * (isOwnManufacturer / manufacturer* / responsiblePerson*) și datele
 * centrale ale vânzătorului (vendorGpsr, pentru checkProductForPublish).
 */
export function producerToProductFields(profile) {
  if (!profile) return { safety: { isOwnManufacturer: null }, vendorGpsr: null };

  if (profile.kind === PRODUCER_KINDS.SELF) {
    return {
      safety: { isOwnManufacturer: true },
      vendorGpsr: {
        gpsrManufacturerName: profile.name || "",
        gpsrManufacturerAddress: profile.address || "",
        gpsrManufacturerEmail: profile.email || "",
      },
    };
  }

  return {
    safety: {
      isOwnManufacturer: false,
      manufacturerName: profile.name || "",
      manufacturerAddress: profile.address || "",
      manufacturerEmail: profile.email || "",
      manufacturerInEU: profile.inEU ?? null,
      responsiblePersonName: profile.inEU === false ? profile.rpName || "" : "",
      responsiblePersonAddress: profile.inEU === false ? profile.rpAddress || "" : "",
      responsiblePersonEmail: profile.inEU === false ? profile.rpEmail || "" : "",
    },
    vendorGpsr: null,
  };
}

/**
 * Exact ce ar vedea clientul pe pagina produsului - calculat cu funcția
 * reală buildPublicGpsrInfo (aceeași ca endpointul public).
 */
export function publicProducerPreview(profile, { safetyWarnings = null, isForChildren = null } = {}) {
  const { safety, vendorGpsr } = producerToProductFields(profile);
  const product = { ...safety, safetyWarnings, isForChildren };
  return buildPublicGpsrInfo(product, vendorGpsr);
}
