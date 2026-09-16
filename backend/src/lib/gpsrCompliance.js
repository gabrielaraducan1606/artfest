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

  return patch;
}

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
  }

  return { ok: true };
}

/**
 * Stare GPSR complet/incomplet - folosită de catalogul vendorului,
 * de admin și, dacă e nevoie, de orice alt loc care trebuie să știe
 * dacă un produs are datele GPSR minime confirmate. Un produs vechi,
 * fără nicio informație GPSR (toate null), este mereu incomplet.
 */
export function isGpsrComplete(product) {
  if (!product) return false;

  if (product.isOwnManufacturer === null || product.isOwnManufacturer === undefined) {
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
export function getGpsrMissingFields(product) {
  if (!product) return GPSR_PRODUCT_FIELDS.slice();

  const missing = [];

  if (product.isOwnManufacturer === null || product.isOwnManufacturer === undefined) {
    missing.push("isOwnManufacturer");
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
 * Bloc GPSR pentru randare publică (pagina de produs). Rezolvă cazul
 * "isOwnManufacturer === true" din datele publice ale Vendorului
 * (displayName/address/email), NICIODATĂ din VendorBilling (date
 * fiscale/private). Returnează null pentru orice secțiune care nu
 * are date suficiente - pagina publică nu trebuie să afișeze
 * placeholdere sau valori inventate.
 */
export function buildPublicGpsrInfo(product, vendor) {
  if (!product) return null;

  const manufacturer =
    product.isOwnManufacturer === true
      ? {
          name: vendor?.displayName || null,
          address: vendor?.address || null,
          email: vendor?.email || null,
          isVendor: true,
        }
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
