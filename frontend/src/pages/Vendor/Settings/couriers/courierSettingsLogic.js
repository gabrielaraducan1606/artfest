// src/pages/Vendor/Settings/couriers/courierSettingsLogic.js

/*
 * Logică pură (fără React) pentru Setări > Livrare și retururi >
 * Curieri conectați / Adrese de ridicare. Formularul de conectare se
 * construiește EXCLUSIV din schema întoarsă de backend
 * (GET /api/vendor/couriers/providers: credentialFields,
 * publicConfigFields, capabilities) - niciun câmp de provider hardcodat.
 *
 * Credentialele salvate nu ajung niciodată în frontend (backend-ul
 * întoarce doar hasCredentials + credentialsHint), iar la editare
 * câmpurile de credentiale pornesc mereu goale.
 */

// ancora secțiunii (/setari?tab=shipping#couriers - vezi VENDOR_COURIERS_SETTINGS_URL)
export const COURIERS_ANCHOR_ID = "couriers";

export function isCouriersHash(hash) {
  return String(hash || "") === `#${COURIERS_ANCHOR_ID}`;
}

export const ACCOUNT_STATUS_META = Object.freeze({
  ACTIVE: { label: "Conectat", tone: "success" },
  INVALID_CREDENTIALS: { label: "Credentiale invalide", tone: "danger" },
  DISABLED: { label: "Deconectat", tone: "muted" },
});

export function accountStatusMeta(status) {
  return ACCOUNT_STATUS_META[status] || { label: "Necunoscut", tone: "muted" };
}

const dateTimeFormatter = new Intl.DateTimeFormat("ro-RO", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export function formatDateTime(value) {
  if (!value) return "";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "" : dateTimeFormatter.format(d);
}

/* ===== formular conectare / editare cont ===== */

/**
 * Valorile inițiale ale formularului.
 * - credentials: MEREU goale (și la editare) - nu precompletăm nimic secret;
 * - publicConfig: din contul existent sau din `default`-urile schemei.
 */
export function buildInitialCourierForm(provider, account = null) {
  const credentials = {};
  for (const field of provider?.credentialFields || []) credentials[field.key] = "";

  const publicConfig = {};
  for (const field of provider?.publicConfigFields || []) {
    const current = account?.publicConfig?.[field.key];
    publicConfig[field.key] =
      current !== undefined && current !== null
        ? String(current)
        : field.default !== undefined
        ? String(field.default)
        : "";
  }

  return {
    label: account?.label || provider?.name || "",
    credentials,
    publicConfig,
    pickupAddressId: account?.pickupAddressId || "",
    replaceCredentials: !account, // la creare credentialele sunt obligatorii
  };
}

/**
 * Validare locală, pe schema providerului. Backend-ul rămâne sursa de
 * adevăr (validează din nou și testează conexiunea).
 * @returns {Object<string,string>} erori pe câmp: "label", "credentials.<key>", "publicConfig.<key>"
 */
export function validateCourierForm(provider, form) {
  const errors = {};

  const label = String(form?.label || "").trim();
  if (!label) errors.label = "Completează un nume pentru cont.";
  else if (label.length > 160) errors.label = "Numele poate avea maximum 160 de caractere.";

  if (form?.replaceCredentials) {
    for (const field of provider?.credentialFields || []) {
      const value = String(form.credentials?.[field.key] || "").trim();
      if (field.required && !value) {
        errors[`credentials.${field.key}`] = `Completează „${field.label}”.`;
      } else if (value.length > (field.maxLength || 256)) {
        errors[`credentials.${field.key}`] = `„${field.label}” este prea lung.`;
      }
    }
  }

  for (const field of provider?.publicConfigFields || []) {
    const value = form?.publicConfig?.[field.key];
    if (field.required && (value === undefined || value === null || value === "")) {
      errors[`publicConfig.${field.key}`] = `Completează „${field.label}”.`;
    } else if (
      field.type === "select" &&
      value &&
      !(field.options || []).some((o) => o.value === value)
    ) {
      errors[`publicConfig.${field.key}`] = `Alege o valoare validă pentru „${field.label}”.`;
    }
  }

  return errors;
}

function cleanCredentials(provider, credentials) {
  const out = {};
  for (const field of provider?.credentialFields || []) {
    const value = String(credentials?.[field.key] || "").trim();
    if (value) out[field.key] = value;
  }
  return out;
}

function cleanPublicConfig(provider, publicConfig) {
  const out = {};
  for (const field of provider?.publicConfigFields || []) {
    if (publicConfig?.[field.key] !== undefined) out[field.key] = publicConfig[field.key];
  }
  return out;
}

// POST /api/vendor/couriers/accounts
export function buildCreatePayload(provider, form) {
  return {
    provider: provider.id,
    label: String(form.label || "").trim(),
    credentials: cleanCredentials(provider, form.credentials),
    publicConfig: cleanPublicConfig(provider, form.publicConfig),
    ...(form.pickupAddressId ? { pickupAddressId: form.pickupAddressId } : {}),
  };
}

/**
 * PATCH /api/vendor/couriers/accounts/:id - trimite DOAR ce s-a schimbat.
 * `credentials` apare doar dacă vendorul a ales explicit să le înlocuiască.
 */
export function buildUpdatePayload(provider, form, account) {
  const payload = {};

  const label = String(form.label || "").trim();
  if (label !== (account?.label || "")) payload.label = label;

  const nextConfig = cleanPublicConfig(provider, form.publicConfig);
  const prevConfig = account?.publicConfig || {};
  if (Object.keys(nextConfig).some((k) => String(nextConfig[k] ?? "") !== String(prevConfig[k] ?? ""))) {
    payload.publicConfig = nextConfig;
  }

  const nextPickup = form.pickupAddressId || null;
  if (nextPickup !== (account?.pickupAddressId || null)) payload.pickupAddressId = nextPickup;

  if (form.replaceCredentials) {
    payload.credentials = cleanCredentials(provider, form.credentials);
  }

  return payload;
}

// cheie pentru eroarea de câmp întoarsă de backend (`fields: ["password"]`)
export function mapBackendFieldErrors(provider, fields = [], message) {
  const errors = {};
  const credKeys = new Set((provider?.credentialFields || []).map((f) => f.key));
  const configKeys = new Set((provider?.publicConfigFields || []).map((f) => f.key));

  for (const key of fields) {
    if (credKeys.has(key)) errors[`credentials.${key}`] = message;
    else if (configKeys.has(key)) errors[`publicConfig.${key}`] = message;
    else if (key === "pickupAddressId" || key === "label") errors[key] = message;
  }
  return errors;
}

/* ===== erori API -> text pentru UI ===== */

const FALLBACK_BY_STATUS = {
  401: "Sesiunea a expirat. Autentifică-te din nou.",
  403: "Nu ai acces la această secțiune.",
  404: "Elementul nu mai există. Reîncarcă pagina.",
  429: "Prea multe încercări. Încearcă din nou peste câteva minute.",
};

/**
 * Mesajul SANITIZAT de backend (`message`) sau un text generic - niciodată
 * răspunsul brut / stack / răspunsul curierului.
 */
export function apiErrorMessage(e, fallback = "A apărut o eroare. Încearcă din nou.") {
  const message = e?.data?.message;
  if (typeof message === "string" && message.trim() && message.length <= 300) {
    return message.trim();
  }
  return FALLBACK_BY_STATUS[e?.status] || fallback;
}

/* ===== adrese de ridicare ===== */

export const PICKUP_ADDRESS_FIELDS = Object.freeze([
  { key: "contactName", label: "Persoană de contact", required: true, max: 160, autoComplete: "name" },
  { key: "phone", label: "Telefon", required: true, max: 40, inputMode: "tel", autoComplete: "tel" },
  { key: "email", label: "Email", required: false, max: 320, type: "email", autoComplete: "email" },
  { key: "county", label: "Județ", required: true, max: 120, autoComplete: "address-level1" },
  { key: "city", label: "Localitate", required: true, max: 160, autoComplete: "address-level2" },
  { key: "postalCode", label: "Cod poștal", required: false, max: 20, inputMode: "numeric", autoComplete: "postal-code" },
  { key: "street", label: "Stradă", required: true, max: 255, autoComplete: "address-line1" },
  { key: "streetNo", label: "Număr", required: true, max: 40 },
  { key: "details", label: "Detalii (bloc, scară, etaj, apartament, reper)", required: false, max: 500, autoComplete: "address-line2" },
]);

export function emptyPickupAddressForm(address = null) {
  const form = {};
  for (const f of PICKUP_ADDRESS_FIELDS) form[f.key] = address?.[f.key] ? String(address[f.key]) : "";
  form.isDefault = !!address?.isDefault;
  return form;
}

// aceleași reguli ca backend-ul (pickupAddresses.js)
export function validatePickupAddressForm(form) {
  const errors = {};

  for (const f of PICKUP_ADDRESS_FIELDS) {
    const value = String(form?.[f.key] || "").trim();
    if (!value) {
      if (f.required) errors[f.key] = `Completează „${f.label}”.`;
      continue;
    }
    if (value.length > f.max) errors[f.key] = `„${f.label}” este prea lung.`;
  }

  const phone = String(form?.phone || "").replace(/[^\d+]/g, "");
  if (form?.phone && !errors.phone && !/^\+?\d{9,15}$/.test(phone)) {
    errors.phone = "Telefonul nu este valid (ex. 0712345678 sau +40712345678).";
  }
  const email = String(form?.email || "").trim();
  if (email && !errors.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.email = "Emailul nu este valid.";
  }
  const postal = String(form?.postalCode || "").trim();
  if (postal && !errors.postalCode && !/^\d{4,10}$/.test(postal)) {
    errors.postalCode = "Codul poștal trebuie să conțină doar cifre.";
  }

  return errors;
}

export function buildPickupAddressPayload(form) {
  const payload = {};
  for (const f of PICKUP_ADDRESS_FIELDS) payload[f.key] = String(form?.[f.key] || "").trim();
  return payload;
}

export function formatPickupAddress(a) {
  if (!a) return "";
  const line1 = [a.street, a.streetNo ? `nr. ${a.streetNo}` : ""].filter(Boolean).join(" ");
  return [line1, a.details, [a.city, a.county].filter(Boolean).join(", "), a.postalCode]
    .filter(Boolean)
    .join(" · ");
}
