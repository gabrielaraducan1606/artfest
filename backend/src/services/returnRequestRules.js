// backend/src/services/returnRequestRules.js

/*
 * Regulile PURE ale fluxului de retur (fără DB, fără importuri) - folosite
 * de services/returnRequestService.js și de routes/userReturnsRoutes.js.
 *
 * Doar statusurile EXISTENTE (ReturnRequestStatus), fără schimbări Prisma:
 *   NEW              - cerere trimisă de client, așteaptă vânzătorul
 *   IN_REVIEW        - vânzătorul a cerut informații suplimentare (în thread)
 *   APPROVED         - acceptată: clientul trimite produsul (instrucțiuni în thread)
 *   PICKUP_REQUESTED - colet de retur prin curier (setat de fluxul admin existent)
 *   REJECTED         - respinsă, cu motiv (în thread)
 *   CLOSED           - vânzătorul a primit produsul înapoi; rambursarea se
 *                      procesează în afara acestui flux (admin / vânzător COD)
 */

export const RETURN_STATUS_INFO = Object.freeze({
  // Clientul NU expediază nimic înainte de APPROVED.
  NEW: {
    client: "Cererea ta a fost trimisă. Așteaptă răspunsul vânzătorului înainte să expediezi produsul.",
    vendor: "Cerere nouă",
  },
  IN_REVIEW: {
    client: "Vânzătorul are nevoie de informații suplimentare. Răspunde în conversație - nu expedia încă produsul.",
    vendor: "Informații cerute clientului",
  },
  APPROVED: {
    client: "Returul a fost acceptat. Acum poți pregăti produsul pentru expediere folosind instrucțiunile de mai jos.",
    vendor: "Acceptată - aștepți produsul",
  },
  PICKUP_REQUESTED: {
    client: "Returul a fost acceptat - coletul este preluat prin curier.",
    vendor: "Colet de retur prin curier",
  },
  REJECTED: {
    client: "Cererea a fost respinsă. Motivul este mai jos; poți răspunde în conversație sau contacta suportul.",
    vendor: "Respinsă",
  },
  CLOSED: {
    client: "Produs primit de vânzător - rambursarea se procesează",
    vendor: "Produs primit - rambursarea se procesează separat",
  },
});

export const VENDOR_RETURN_ACTIONS = Object.freeze({
  accept: { from: ["NEW", "IN_REVIEW"], to: "APPROVED", messageRequired: false },
  request_info: { from: ["NEW", "IN_REVIEW"], to: "IN_REVIEW", messageRequired: true },
  reject: { from: ["NEW", "IN_REVIEW", "APPROVED"], to: "REJECTED", messageRequired: true },
  received: { from: ["APPROVED", "PICKUP_REQUESTED"], to: "CLOSED", messageRequired: false },
});

export function allowedVendorActions(status) {
  return Object.entries(VENDOR_RETURN_ACTIONS)
    .filter(([, rule]) => rule.from.includes(status))
    .map(([action]) => action);
}

export function planVendorReturnAction({ status, action, message }) {
  const rule = VENDOR_RETURN_ACTIONS[action];

  if (!rule) {
    return { ok: false, code: "unknown_action", message: "Acțiune necunoscută." };
  }

  if (!rule.from.includes(status)) {
    return {
      ok: false,
      code: "invalid_transition",
      message: "Această acțiune nu mai este disponibilă pentru statusul curent al cererii.",
    };
  }

  const text = String(message || "").trim();

  if (rule.messageRequired && !text) {
    return {
      ok: false,
      code: "message_required",
      message:
        action === "reject"
          ? "Scrie motivul respingerii - clientul îl va vedea în conversația comenzii."
          : "Scrie ce informații ai nevoie de la client.",
    };
  }

  return { ok: true, nextStatus: rule.to, text };
}

/* =========================================================
   Motive de retur: RETRAGERE fără motiv vs. NECONFORMITATE
========================================================= */

/*
 * WITHDRAWAL  - retragere fără justificare (OUG 34/2014, art. 9): doar
 *               produse standard, doar în termenul de 14 zile.
 * CONFORMITY  - defect / greșit / deteriorat / neconform: permise și pentru
 *               produsele personalizate și și după termenul de 14 zile.
 *
 * ReturnRequest.reasonCode e String în DB -> coduri noi fără Prisma.
 * `legacy`: acceptate în continuare de backend (pagini vechi din cache,
 * cereri istorice), dar neafișate în formular.
 */
export const RETURN_REASONS = Object.freeze({
  CHANGED_MIND: { kind: "WITHDRAWAL", label: "M-am răzgândit" },
  NO_LONGER_WANTED: { kind: "WITHDRAWAL", label: "Nu mi se potrivește / nu îl mai doresc" },
  OTHER_WITHDRAWAL: { kind: "WITHDRAWAL", label: "Alt motiv de retragere", textRequired: true },

  DEFECT: { kind: "CONFORMITY", label: "Produs defect", photosRequired: true },
  DAMAGED: { kind: "CONFORMITY", label: "Produs deteriorat", photosRequired: true },
  WRONG_ITEM: { kind: "CONFORMITY", label: "Produs greșit", photosRequired: true },
  NOT_AS_DESCRIBED: { kind: "CONFORMITY", label: "Produs diferit de descriere", photosRequired: true },
  PERSONALIZATION_MISMATCH: {
    kind: "CONFORMITY",
    label: "Personalizarea nu corespunde comenzii",
    photosRequired: true,
  },
  MISSING_PARTS: { kind: "CONFORMITY", label: "Lipsesc elemente", photosRequired: true },
  OTHER_CONFORMITY: { kind: "CONFORMITY", label: "Altă problemă de conformitate", textRequired: true },

  SIZE_COLOR: { kind: "WITHDRAWAL", label: "Mărime / culoare nepotrivită", legacy: true },
  OTHER: { kind: "WITHDRAWAL", label: "Alt motiv", textRequired: true, legacy: true },
});

export const RETURN_REASON_CODES = Object.freeze(Object.keys(RETURN_REASONS));

export const WITHDRAWAL_REASONS = Object.freeze(
  RETURN_REASON_CODES.filter((code) => RETURN_REASONS[code].kind === "WITHDRAWAL")
);

export const CONFORMITY_REASONS = Object.freeze(
  RETURN_REASON_CODES.filter((code) => RETURN_REASONS[code].kind === "CONFORMITY")
);

// compatibilitate cu importurile existente
export const NO_FAULT_REASONS = WITHDRAWAL_REASONS;

export function isWithdrawalReason(code) {
  return RETURN_REASONS[code]?.kind === "WITHDRAWAL";
}

export function isConformityReason(code) {
  return RETURN_REASONS[code]?.kind === "CONFORMITY";
}

export function returnReasonLabel(code) {
  return RETURN_REASONS[code]?.label || code || "";
}

/*
 * Motivele afișate în formular, după clasificarea produselor selectate.
 * PERSONALIZED -> doar neconformitate. STANDARD / UNCLEAR -> toate
 * (UNCLEAR: cererea de retragere nu e respinsă automat, ci trimisă la
 * verificare).
 */
export function formReasonsFor(classification) {
  return RETURN_REASON_CODES.filter((code) => {
    const reason = RETURN_REASONS[code];
    if (reason.legacy) return false;
    if (classification === "PERSONALIZED") return reason.kind === "CONFORMITY";
    return true;
  }).map((code) => ({ code, ...RETURN_REASONS[code] }));
}

/* =========================================================
   Produs PERSONALIZAT (OUG 34/2014, art. 16 lit. c)
========================================================= */

/*
 * Excepția de la dreptul de retragere se aplică DOAR bunurilor
 * confecționate după specificațiile consumatorului sau personalizate în
 * mod clar. NU sunt personalizare: culoarea, mărimea, variantele standard
 * și orice opțiune aleasă dintr-o listă predefinită din catalog.
 *
 * Surse (fără câmpuri noi în DB):
 *  - ShipmentItem.customAnswers / repeatedGroupAnswers = ce a completat
 *    clientul (snapshot al comenzii);
 *  - Product.customSchema / optionsSchema / repeatedGroups = definiția
 *    câmpurilor, ca să știm dacă răspunsul e text/fișier liber (specificație
 *    individuală) sau o opțiune standard dintr-o listă;
 *  - ShipmentItem.selectedOptions = variante standard -> ignorate.
 *
 * Rezultat per linie:
 *  PERSONALIZED - cel puțin un răspuns liber (text, nume, mesaj, poză,
 *                 dimensiune individuală) completat de client;
 *  STANDARD     - nicio personalizare, sau doar opțiuni din listă;
 *  UNCLEAR      - date istorice insuficiente (produs șters, câmp care nu
 *                 mai există în schemă, valoare în afara listei) sau
 *                 comandă dintr-o ofertă - NU se respinge automat, ci se
 *                 trimite la verificare.
 */
export const PERSONALIZATION = Object.freeze({
  STANDARD: "STANDARD",
  PERSONALIZED: "PERSONALIZED",
  UNCLEAR: "UNCLEAR",
});

const RANK = { STANDARD: 0, UNCLEAR: 1, PERSONALIZED: 2 };

function worst(a, b) {
  return RANK[b] > RANK[a] ? b : a;
}

function isFilled(value) {
  if (value === null || value === undefined || value === false) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.some(isFilled);
  if (typeof value === "object") return Object.values(value).some(isFilled);
  return true;
}

function schemaFields(schema) {
  if (Array.isArray(schema)) return schema;
  if (Array.isArray(schema?.fields)) return schema.fields;
  return [];
}

function normalizeChoice(value) {
  const raw = value && typeof value === "object" ? value.value ?? value.label : value;
  return String(raw ?? "").trim().toLowerCase();
}

function fieldChoices(field) {
  const list = Array.isArray(field?.options)
    ? field.options
    : Array.isArray(field?.values)
      ? field.values
      : null;

  if (!list) return null;

  const set = new Set();

  for (const option of list) {
    if (option && typeof option === "object") {
      if (option.value !== undefined) set.add(normalizeChoice(option.value));
      if (option.label !== undefined) set.add(normalizeChoice(option.label));
    } else {
      set.add(normalizeChoice(option));
    }
  }

  return set;
}

function classifyAnswer(field, value) {
  if (!field) return PERSONALIZATION.UNCLEAR;

  const choices = fieldChoices(field);

  // câmp liber (text, mesaj, nume, poză, dimensiuni) = specificație individuală
  if (!choices) return PERSONALIZATION.PERSONALIZED;

  const values = (Array.isArray(value) ? value : [value]).filter(isFilled);

  return values.every((v) => choices.has(normalizeChoice(v)))
    ? PERSONALIZATION.STANDARD
    : PERSONALIZATION.UNCLEAR;
}

function fieldsByKey(product) {
  const map = new Map();

  for (const field of [...schemaFields(product?.optionsSchema), ...schemaFields(product?.customSchema)]) {
    if (field?.key) map.set(String(field.key), field);
  }

  return map;
}

function groupFieldsByKey(product, fields) {
  const groups = new Map();

  for (const group of Array.isArray(product?.repeatedGroups) ? product.repeatedGroups : []) {
    const groupKey = group?.key || group?.id;
    if (!groupKey) continue;

    const map = new Map();

    for (const raw of Array.isArray(group.fields) ? group.fields : []) {
      if (typeof raw === "string") {
        if (fields.has(raw)) map.set(raw, fields.get(raw));
      } else if (raw?.key) {
        map.set(String(raw.key), { ...(fields.get(String(raw.key)) || {}), ...raw });
      }
    }

    groups.set(String(groupKey), map);
  }

  return groups;
}

/*
 * item: { customAnswers, repeatedGroupAnswers } (snapshot ShipmentItem)
 * product: { customSchema, optionsSchema, repeatedGroups } sau null
 */
export function classifyPersonalization(item, product, { fromQuote = false } = {}) {
  let result = fromQuote ? PERSONALIZATION.UNCLEAR : PERSONALIZATION.STANDARD;

  const customAnswers =
    item?.customAnswers && typeof item.customAnswers === "object" ? item.customAnswers : {};
  const groupAnswers =
    item?.repeatedGroupAnswers && typeof item.repeatedGroupAnswers === "object"
      ? item.repeatedGroupAnswers
      : {};

  const filledCustom = Object.entries(customAnswers).filter(([, v]) => isFilled(v));
  const filledGroups = Object.entries(groupAnswers).filter(([, v]) => isFilled(v));

  if (!filledCustom.length && !filledGroups.length) return result;

  // există răspunsuri, dar nu mai avem definiția câmpurilor
  if (!product) return worst(result, PERSONALIZATION.UNCLEAR);

  const fields = fieldsByKey(product);
  const groups = groupFieldsByKey(product, fields);

  for (const [key, value] of filledCustom) {
    result = worst(result, classifyAnswer(fields.get(String(key)), value));
  }

  for (const [groupKey, entries] of filledGroups) {
    const groupFields = groups.get(String(groupKey));
    const rows = Array.isArray(entries) ? entries : [entries];

    for (const row of rows) {
      if (!row || typeof row !== "object") {
        if (isFilled(row)) result = worst(result, PERSONALIZATION.UNCLEAR);
        continue;
      }

      for (const [key, value] of Object.entries(row)) {
        if (!isFilled(value)) continue;
        const field = groupFields?.get(String(key)) || fields.get(String(key));
        result = worst(result, classifyAnswer(field, value));
      }
    }
  }

  return result;
}

export function combinePersonalization(list = []) {
  return list.reduce((acc, value) => worst(acc, value || PERSONALIZATION.STANDARD), PERSONALIZATION.STANDARD);
}

export const PERSONALIZED_WITHDRAWAL_MESSAGE =
  "Acest produs a fost realizat/personalizat după specificațiile tale și nu beneficiază de dreptul de retragere de 14 zile doar pentru răzgândire. Poți solicita în continuare soluționarea dacă produsul este defect, greșit sau neconform cu ceea ce ai comandat.";

/*
 * items: [{ title, personalization }] (clasificate cu classifyPersonalization)
 * -> null (se poate crea normal)
 *  | { block: true, code, message }     (retragere pentru produs personalizat)
 *  | { review: true, code }             (retragere, clasificare neclară)
 */
export function checkPersonalizedReturn({ reasonCode, items = [] }) {
  if (!isWithdrawalReason(reasonCode)) return null;

  const personalized = items.filter((i) => i.personalization === PERSONALIZATION.PERSONALIZED);

  if (personalized.length) {
    return {
      block: true,
      code: "personalized_withdrawal_excluded",
      message: `${PERSONALIZED_WITHDRAWAL_MESSAGE} (${personalized.map((i) => `„${i.title}”`).join(", ")})`,
    };
  }

  if (items.some((i) => i.personalization === PERSONALIZATION.UNCLEAR)) {
    return { review: true, code: "personalization_unclear" };
  }

  return null;
}

/*
 * Textul notificării de cerere nouă către vânzător (vânzătorul gestionează
 * acum returul din pagina comenzii).
 */
export function vendorNewReturnNotificationBody({ personalizationReview = false } = {}) {
  const base =
    "Un client a trimis o cerere de retur. Deschide comanda pentru a o accepta, a cere informații sau a o respinge; poți discuta cu clientul în conversația comenzii.";

  if (!personalizationReview) return base;

  return `${base} Atenție: este o retragere fără motiv pentru un produs a cărui personalizare nu a putut fi stabilită automat. Cererea este verificată și de echipa Artfest; nu o respinge doar pe motiv de personalizare dacă produsul are doar opțiuni standard (culoare, mărime, variantă).`;
}
