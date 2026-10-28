// backend/src/lib/gpsrCompliance.js
//
// Sursă unică pentru logica GPSR (Regulamentul UE 2023/988) legată de
// Product: normalizarea/validarea payload-ului trimis de vendor/admin
// și calculul stării "GPSR complet/incomplet" - folosit peste tot
// unde Product e creat, actualizat sau listat (vendor, admin, import,
// pagina publică), ca să nu existe două implementări divergente.
//
// Reguli (stabilite explicit, nu presupuse):
// - isOwnManufacturer === null  -> produs vechi / încă neconfirmat.
// - isOwnManufacturer === false -> obligă manufacturerName/Address/
//   Email + manufacturerInEU.
// - manufacturerInEU === false  -> obligă responsiblePersonName/
//   Address/Email.
// - safetyWarnings === null     -> vendorul nu a răspuns încă.
// - safetyWarnings === ""       -> vendorul a confirmat explicit că nu
//   se aplică avertismente (NU se coerce la null).
// - isForChildren === null      -> necompletat.
//
// Niciun câmp nu e NOT NULL în DB - "obligatoriu" e doar la nivel de
// aplicație, și doar atunci când vendorul chiar atinge secțiunea GPSR
// în request (vezi touchesGpsrFields mai jos) - un produs vechi cu
// null-uri nu e blocat de editări nelegate de GPSR (ex. schimbarea
// prețului).
//
// isOwnManufacturer === true -> datele producătorului NU stau pe produs:
// vin dintr-o singură sursă, Vendor.gpsrManufacturerName/Address/Email
// (completate o dată, folosite pentru toate produsele vendorului). Nu se
// citesc niciodată din Vendor.address/email, ServiceProfile (retur),
// VendorBilling (facturare) sau VendorPickupAddress (curier).

/** Datele externe (isOwnManufacturer === false), golite la „Nu” -> „Da”. */
export const GPSR_EXTERNAL_MANUFACTURER_FIELDS = [
  "manufacturerName",
  "manufacturerAddress",
  "manufacturerEmail",
  "manufacturerInEU",
  "responsiblePersonName",
  "responsiblePersonAddress",
  "responsiblePersonEmail",
];

/** Sursa centrală pentru isOwnManufacturer === true (model Vendor). */
export const VENDOR_GPSR_FIELDS = [
  "gpsrManufacturerName",
  "gpsrManufacturerAddress",
  "gpsrManufacturerEmail",
];

// select Prisma pentru sursa centrală (Vendor)
export const VENDOR_GPSR_SELECT = Object.freeze(
  Object.fromEntries(VENDOR_GPSR_FIELDS.map((field) => [field, true]))
);

// aceleași limite ca în schema.prisma (VarChar)
export const GPSR_CONTACT_MAX_LENGTH = { name: 200, address: 500, email: 320 };

const GPSR_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function isValidGpsrEmail(value) {
  const email = String(value ?? "").trim();
  return email.length <= GPSR_CONTACT_MAX_LENGTH.email && GPSR_EMAIL_RE.test(email);
}

/*
 * Adresă publică de contact: minimum 10 caractere, cel puțin o literă și
 * o cifră (stradă + număr / cod poștal) - respinge texte ca „sdvfb”.
 */
export function isValidGpsrAddress(value) {
  const address = String(value ?? "").trim();
  return (
    address.length >= 10 &&
    address.length <= GPSR_CONTACT_MAX_LENGTH.address &&
    /\p{L}/u.test(address) &&
    /\d/.test(address)
  );
}

export const GPSR_ADDRESS_HINT =
  "Scrie adresa completă: stradă, număr, localitate (cel puțin 10 caractere, cu litere și cifre).";

/**
 * Validarea datelor publice ale producătorului - aceeași în editor
 * (frontend) și pe server (PUT /api/vendors/me/gpsr-manufacturer).
 *
 * @param {{name?:string,address?:string,email?:string}} contact
 * @returns {{ok:true,value:{name:string,address:string,email:string}}|{ok:false,field:string,error:string,message:string}}
 */
export function validateGpsrManufacturerContact(contact = {}) {
  const name = String(contact?.name ?? "").trim();
  const address = String(contact?.address ?? "").trim();
  const email = String(contact?.email ?? "").trim();

  if (!name) {
    return { ok: false, field: "name", error: "gpsr_name_required", message: "Completează numele producătorului." };
  }

  if (name.length > GPSR_CONTACT_MAX_LENGTH.name) {
    return { ok: false, field: "name", error: "gpsr_name_too_long", message: "Numele producătorului este prea lung." };
  }

  if (!address) {
    return { ok: false, field: "address", error: "gpsr_address_required", message: "Completează adresa publică de contact." };
  }

  if (!isValidGpsrAddress(address)) {
    return { ok: false, field: "address", error: "gpsr_address_invalid", message: GPSR_ADDRESS_HINT };
  }

  if (!email) {
    return { ok: false, field: "email", error: "gpsr_email_required", message: "Completează emailul public de contact." };
  }

  if (!isValidGpsrEmail(email)) {
    return { ok: false, field: "email", error: "gpsr_email_invalid", message: "Emailul public de contact nu este valid." };
  }

  return { ok: true, value: { name, address, email } };
}

/**
 * Datele publice ale producătorului din sursa centrală (Vendor), sau null
 * dacă nu sunt complete/valide. `vendor` = rândul Vendor (sau un obiect cu
 * aceleași chei gpsrManufacturer*).
 */
export function getVendorGpsrManufacturer(vendor) {
  if (!vendor) return null;

  const result = validateGpsrManufacturerContact({
    name: vendor.gpsrManufacturerName,
    address: vendor.gpsrManufacturerAddress,
    email: vendor.gpsrManufacturerEmail,
  });

  return result.ok ? result.value : null;
}

const vendorOf = (product) => product?.service?.vendor ?? null;

export const GPSR_PRODUCT_FIELDS = [
  "isOwnManufacturer",
  "manufacturerName",
  "manufacturerAddress",
  "manufacturerEmail",
  "manufacturerInEU",
  "responsiblePersonName",
  "responsiblePersonAddress",
  "responsiblePersonEmail",
  "safetyWarnings",
  "isForChildren",
];

function normalizeNullableText(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
}

function normalizeNullableBoolean(value) {
  if (value === null || value === undefined) return null;
  return value === true || value === "true" || value === "1" || value === 1;
}

/**
 * Extrage patch-ul GPSR dintr-un req.body, atingând DOAR câmpurile
 * prezente explicit (pattern identic cu restul lui vendorProductRoutes.js
 * - `req.body.X !== undefined`), astfel încât un PUT/PATCH parțial nu
 * șterge accidental date GPSR netrimise.
 */
export function pickGpsrPatchFromBody(body = {}) {
  const patch = {};

  if (body.isOwnManufacturer !== undefined) {
    patch.isOwnManufacturer = normalizeNullableBoolean(body.isOwnManufacturer);
  }

  if (body.manufacturerName !== undefined) {
    patch.manufacturerName = normalizeNullableText(body.manufacturerName);
  }

  if (body.manufacturerAddress !== undefined) {
    patch.manufacturerAddress = normalizeNullableText(body.manufacturerAddress);
  }

  if (body.manufacturerEmail !== undefined) {
    patch.manufacturerEmail = normalizeNullableText(body.manufacturerEmail);
  }

  if (body.manufacturerInEU !== undefined) {
    patch.manufacturerInEU = normalizeNullableBoolean(body.manufacturerInEU);
  }

  if (body.responsiblePersonName !== undefined) {
    patch.responsiblePersonName = normalizeNullableText(body.responsiblePersonName);
  }

  if (body.responsiblePersonAddress !== undefined) {
    patch.responsiblePersonAddress = normalizeNullableText(body.responsiblePersonAddress);
  }

  if (body.responsiblePersonEmail !== undefined) {
    patch.responsiblePersonEmail = normalizeNullableText(body.responsiblePersonEmail);
  }

  /*
   * IMPORTANT: safetyWarnings - "" e o valoare validă și distinctă de
   * null ("nu se aplică", confirmat explicit) - NU folosim
   * normalizeNullableText aici (acela ar transforma "" în null).
   */
  if (body.safetyWarnings !== undefined) {
    patch.safetyWarnings =
      body.safetyWarnings === null ? null : String(body.safetyWarnings);
  }

  if (body.isForChildren !== undefined) {
    patch.isForChildren = normalizeNullableBoolean(body.isForChildren);
  }

  /*
   * Salvare cu „Eu sunt producătorul = Da”: datele unui producător extern
   * (eventual rămase de la „Nu”) nu mai au ce căuta pe produs - le golim
   * explicit, ca să nu poată fi folosite/afișate din greșeală.
   */
  if (patch.isOwnManufacturer === true) {
    for (const field of GPSR_EXTERNAL_MANUFACTURER_FIELDS) {
      patch[field] = null;
    }
  }

  return patch;
}

/*
 * Formatul adreselor/emailurilor unui producător extern / persoane
 * responsabile - verificat DOAR pentru valorile noi sau schimbate. O
 * valoare veche, retrimisă neschimbată, nu blochează salvarea unui produs
 * deja publicat (rămâne avertizare în editor).
 */
const EXTERNAL_FORMAT_CHECKS = [
  ["manufacturerAddress", isValidGpsrAddress, "manufacturer_address_invalid", `Adresa producătorului nu este validă. ${GPSR_ADDRESS_HINT}`],
  ["manufacturerEmail", isValidGpsrEmail, "manufacturer_email_invalid", "Emailul producătorului nu este valid."],
  ["responsiblePersonAddress", isValidGpsrAddress, "responsible_person_address_invalid", `Adresa persoanei responsabile din UE nu este validă. ${GPSR_ADDRESS_HINT}`],
  ["responsiblePersonEmail", isValidGpsrEmail, "responsible_person_email_invalid", "Emailul persoanei responsabile din UE nu este valid."],
];

function touchesGpsrFields(body = {}) {
  return GPSR_PRODUCT_FIELDS.some((field) => body[field] !== undefined);
}

/**
 * Validează consistența internă a datelor GPSR, DOAR dacă vendorul
 * chiar a atins secțiunea GPSR în acest request (`body` conține cel
 * puțin unul dintre GPSR_PRODUCT_FIELDS). Un produs vechi/incomplet
 * nu blochează niciodată o editare care nu atinge deloc GPSR.
 *
 * @param {object} body - req.body (payload brut)
 * @param {object|null} currentProduct - produsul existent (null la create)
 * @returns {{ok:true}|{ok:false,error:string,message:string}}
 */
export function validateGpsrConsistency(body = {}, currentProduct = null) {
  if (!touchesGpsrFields(body)) {
    return { ok: true };
  }

  const patch = pickGpsrPatchFromBody(body);

  const effective = (field) =>
    field in patch ? patch[field] : currentProduct?.[field] ?? null;

  const isOwnManufacturer = effective("isOwnManufacturer");

  if (isOwnManufacturer === false) {
    if (!effective("manufacturerName")) {
      return {
        ok: false,
        error: "manufacturer_name_required",
        message: "Completează numele producătorului.",
      };
    }

    if (!effective("manufacturerAddress")) {
      return {
        ok: false,
        error: "manufacturer_address_required",
        message: "Completează adresa producătorului.",
      };
    }

    if (!effective("manufacturerEmail")) {
      return {
        ok: false,
        error: "manufacturer_email_required",
        message: "Completează emailul producătorului.",
      };
    }

    const manufacturerInEU = effective("manufacturerInEU");

    if (manufacturerInEU === null || manufacturerInEU === undefined) {
      return {
        ok: false,
        error: "manufacturer_in_eu_required",
        message: "Precizează dacă producătorul este stabilit în UE.",
      };
    }

    if (manufacturerInEU === false) {
      if (!effective("responsiblePersonName")) {
        return {
          ok: false,
          error: "responsible_person_name_required",
          message: "Completează numele persoanei responsabile din UE.",
        };
      }

      if (!effective("responsiblePersonAddress")) {
        return {
          ok: false,
          error: "responsible_person_address_required",
          message: "Completează adresa persoanei responsabile din UE.",
        };
      }

      if (!effective("responsiblePersonEmail")) {
        return {
          ok: false,
          error: "responsible_person_email_required",
          message: "Completează emailul persoanei responsabile din UE.",
        };
      }
    }

    for (const [field, isValid, error, message] of EXTERNAL_FORMAT_CHECKS) {
      if (field.startsWith("responsiblePerson") && manufacturerInEU !== false) continue;

      const value = effective(field);
      const changed = field in patch && (patch[field] ?? null) !== (currentProduct?.[field] ?? null);

      if (value && changed && !isValid(value)) {
        return { ok: false, error, message };
      }
    }
  }

  return { ok: true };
}

/**
 * Stare GPSR complet/incomplet - folosită de catalogul vendorului,
 * de admin și, dacă e nevoie, de orice alt loc care trebuie să știe
 * dacă un produs are datele GPSR minime confirmate. Un produs vechi,
 * fără nicio informație GPSR (toate null), este mereu incomplet.
 *
 * `vendor` = sursa centrală (Vendor.gpsrManufacturer*), implicit
 * product.service.vendor. Pentru isOwnManufacturer === true, un vendor
 * necunoscut sau fără date centrale complete înseamnă INCOMPLET.
 */
export function isGpsrComplete(product, vendor = vendorOf(product)) {
  if (!product) return false;

  if (product.isOwnManufacturer === null || product.isOwnManufacturer === undefined) {
    return false;
  }

  if (product.isOwnManufacturer === true && !getVendorGpsrManufacturer(vendor)) {
    return false;
  }

  if (product.safetyWarnings === null || product.safetyWarnings === undefined) {
    return false;
  }

  if (product.isForChildren === null || product.isForChildren === undefined) {
    return false;
  }

  if (product.isOwnManufacturer === false) {
    if (
      !product.manufacturerName ||
      !product.manufacturerAddress ||
      !product.manufacturerEmail
    ) {
      return false;
    }

    if (product.manufacturerInEU === null || product.manufacturerInEU === undefined) {
      return false;
    }

    if (product.manufacturerInEU === false) {
      if (
        !product.responsiblePersonName ||
        !product.responsiblePersonAddress ||
        !product.responsiblePersonEmail
      ) {
        return false;
      }
    }
  }

  return true;
}

/**
 * Lista, în cuvinte simple, a ce lipsește - folosită de UI (badge/CTA)
 * ca să nu repete logica de mai sus.
 */
export function getGpsrMissingFields(product, vendor = vendorOf(product)) {
  if (!product) return GPSR_PRODUCT_FIELDS.slice();

  const missing = [];

  if (product.isOwnManufacturer === null || product.isOwnManufacturer === undefined) {
    missing.push("isOwnManufacturer");
  }

  // datele publice ale vendorului-producător (sursa centrală)
  if (product.isOwnManufacturer === true && !getVendorGpsrManufacturer(vendor)) {
    missing.push("vendorGpsrManufacturer");
  }

  if (product.safetyWarnings === null || product.safetyWarnings === undefined) {
    missing.push("safetyWarnings");
  }

  if (product.isForChildren === null || product.isForChildren === undefined) {
    missing.push("isForChildren");
  }

  if (product.isOwnManufacturer === false) {
    if (!product.manufacturerName) missing.push("manufacturerName");
    if (!product.manufacturerAddress) missing.push("manufacturerAddress");
    if (!product.manufacturerEmail) missing.push("manufacturerEmail");

    if (product.manufacturerInEU === null || product.manufacturerInEU === undefined) {
      missing.push("manufacturerInEU");
    } else if (product.manufacturerInEU === false) {
      if (!product.responsiblePersonName) missing.push("responsiblePersonName");
      if (!product.responsiblePersonAddress) missing.push("responsiblePersonAddress");
      if (!product.responsiblePersonEmail) missing.push("responsiblePersonEmail");
    }
  }

  return missing;
}

/**
 * Echivalentul `isGpsrComplete(product) === false` exprimat ca
 * `where` Prisma, pentru filtrul "GPSR incomplet" din admin - evită
 * filtrarea în JS după paginare (care ar rupe skip/take).
 */
export function buildGpsrIncompleteWhere() {
  return {
    OR: [
      { isOwnManufacturer: null },
      { safetyWarnings: null },
      { isForChildren: null },
      {
        isOwnManufacturer: true,
        service: {
          is: {
            vendor: {
              is: {
                OR: VENDOR_GPSR_FIELDS.map((field) => ({ [field]: null })),
              },
            },
          },
        },
      },
      {
        isOwnManufacturer: false,
        OR: [
          { manufacturerName: null },
          { manufacturerAddress: null },
          { manufacturerEmail: null },
          { manufacturerInEU: null },
          {
            manufacturerInEU: false,
            OR: [
              { responsiblePersonName: null },
              { responsiblePersonAddress: null },
              { responsiblePersonEmail: null },
            ],
          },
        ],
      },
    ],
  };
}

/**
 * Bloc GPSR pentru randare publică (DOAR pagina de produs - listele nu îl
 * primesc). Cazul "isOwnManufacturer === true" vine EXCLUSIV din sursa
 * centrală Vendor.gpsrManufacturer* (niciodată Vendor.address/email,
 * ServiceProfile, VendorBilling sau VendorPickupAddress). Returnează null
 * pentru orice secțiune care nu are date suficiente - pagina publică nu
 * trebuie să afișeze placeholdere sau valori inventate.
 */
export function buildPublicGpsrInfo(product, vendor = vendorOf(product)) {
  if (!product) return null;

  const vendorManufacturer =
    product.isOwnManufacturer === true ? getVendorGpsrManufacturer(vendor) : null;

  const manufacturer =
    vendorManufacturer
      ? { ...vendorManufacturer, isVendor: true }
      : product.isOwnManufacturer === false &&
        product.manufacturerName &&
        product.manufacturerAddress &&
        product.manufacturerEmail
      ? {
          name: product.manufacturerName,
          address: product.manufacturerAddress,
          email: product.manufacturerEmail,
          isVendor: false,
        }
      : null;

  const responsiblePerson =
    product.isOwnManufacturer === false &&
    product.manufacturerInEU === false &&
    product.responsiblePersonName &&
    product.responsiblePersonAddress &&
    product.responsiblePersonEmail
      ? {
          name: product.responsiblePersonName,
          address: product.responsiblePersonAddress,
          email: product.responsiblePersonEmail,
        }
      : null;

  const safetyWarnings =
    typeof product.safetyWarnings === "string" && product.safetyWarnings.trim()
      ? product.safetyWarnings.trim()
      : null;

  const isForChildren = product.isForChildren === true;

  if (!manufacturer && !responsiblePerson && !safetyWarnings && !isForChildren) {
    return null;
  }

  return {
    manufacturer,
    responsiblePerson,
    safetyWarnings,
    isForChildren,
  };
}
