// src/pages/Checkout/delivery/deliveryState.js
//
// Starea livrării per magazin în checkout (fără React): alegerea fiecărui
// magazin, păstrarea ei la reîncărcare (sessionStorage - doar alegerea și
// datele publice ale locației, niciun token / secret), payload-ul trimis la
// server și textele afișate clientului. Serverul revalidează totul.

export const DELIVERY_METHODS = ["HOME", "LOCKER", "PUDO"];

/*
 * Modul de livrare al unui magazin (etapa 3):
 *  ARTFEST_SAMEDAY  „Sameday prin Artfest” - adresă / easybox / Sameday Point, doar cu cardul;
 *  VENDOR_COURIER   „Curierul magazinului” - livrare la adresă, ramburs sau card.
 * Serverul decide ce e disponibil și preselectează Sameday când se poate; alegerea
 * făcută de client (userChosen) nu se schimbă automat.
 */
export const FULFILLMENTS = ["ARTFEST_SAMEDAY", "VENDOR_COURIER"];
export const ARTFEST_SAMEDAY = "ARTFEST_SAMEDAY";
export const VENDOR_COURIER = "VENDOR_COURIER";

export const METHOD_LABELS = {
  HOME: "Livrare la adresă",
  LOCKER: "Easybox",
  PUDO: "Sameday Point",
};

export const METHOD_HINTS = {
  HOME: "Curierul aduce coletul la adresa ta.",
  LOCKER: "Ridici coletul din easybox, oricând, cu un cod.",
  PUDO: "Ridici coletul dintr-un punct Sameday partener.",
};

// v2: alegerea include modul de livrare (Sameday prin Artfest / curierul magazinului)
const STORAGE_KEY = "checkout:delivery:v2";

function safeStorage() {
  try {
    return typeof window !== "undefined" ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

/** Doar câmpurile publice ale locației (ce primim de la /api/shipping). */
export function publicLocation(loc) {
  if (!loc || !Number.isInteger(Number(loc.id))) return null;
  const num = (v) => (v !== null && v !== undefined && v !== "" && Number.isFinite(Number(v)) ? Number(v) : null);
  return {
    id: Number(loc.id),
    type: loc.type === "PUDO" ? "PUDO" : "LOCKER",
    name: String(loc.name || ""),
    address: String(loc.address || ""),
    city: String(loc.city || ""),
    county: String(loc.county || ""),
    // codul poștal al locației, exact cum îl întoarce Sameday (ooh-locations)
    postalCode: loc.postalCode ? String(loc.postalCode) : null,
    lat: num(loc.lat),
    lng: num(loc.lng),
    schedule: Array.isArray(loc.schedule) ? loc.schedule : [],
    specialSchedule: Array.isArray(loc.specialSchedule) ? loc.specialSchedule : [],
    // doar în sesiunea curentă, când clientul a cerut „Lângă mine”
    distanceKm: num(loc.distanceKm),
    // Sameday supportedPayment: plata cu cardul la locație (null = necunoscut)
    acceptsCardPayment: typeof loc.acceptsCardPayment === "boolean" ? loc.acceptsCardPayment : null,
  };
}

/**
 * Zilele cu program special în următoarele `days` zile (specialSchedule:
 * day + month din Swagger; anul nu e precizat -> data cea mai apropiată).
 * @returns {{ date: string, text: string }[]}  ex. { date: "25.12", text: "închis" }
 */
export function upcomingSpecialDays(specialSchedule = [], today = new Date(), days = 14) {
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const end = new Date(start.getTime() + days * 86400000);
  const out = [];
  for (const s of specialSchedule || []) {
    const day = Number(s?.day);
    const month = Number(s?.month);
    if (!day || !month) continue;
    let date = new Date(start.getFullYear(), month - 1, day);
    if (date < start) date = new Date(start.getFullYear() + 1, month - 1, day);
    if (date > end) continue;
    const text = s.closed ? "închis" : s.open && s.close ? `${s.open}-${s.close}` : null;
    if (!text) continue;
    out.push({ at: date.getTime(), date: `${String(day).padStart(2, "0")}.${String(month).padStart(2, "0")}`, text });
  }
  return out.sort((a, b) => a.at - b.at).map(({ date, text }) => ({ date, text }));
}

/** Alegerea unui magazin, curățată (metodă cunoscută, locație de tipul metodei). */
export function sanitizeSelection(raw) {
  const fulfillment = FULFILLMENTS.includes(raw?.fulfillment) ? raw.fulfillment : null;
  const mode = fulfillment ? { fulfillment, userChosen: raw?.userChosen === true } : {};
  // easybox / Sameday Point există doar cu Sameday prin Artfest (sau modul încă necunoscut)
  const method = DELIVERY_METHODS.includes(raw?.method) && fulfillment !== VENDOR_COURIER ? raw.method : "HOME";
  if (method === "HOME") return { method, location: null, ...mode };
  const loc = publicLocation(raw?.location);
  // distanța ține de poziția clientului - nu se păstrează în alegere / sessionStorage
  const location = loc ? { ...loc, distanceKm: null } : null;
  return { method, location: location && location.type === method ? location : null, ...mode };
}

export function loadSelections() {
  const storage = safeStorage();
  if (!storage) return {};
  try {
    const parsed = JSON.parse(storage.getItem(STORAGE_KEY) || "{}");
    return Object.fromEntries(Object.entries(parsed || {}).map(([k, v]) => [k, sanitizeSelection(v)]));
  } catch {
    return {};
  }
}

export function saveSelections(selections) {
  const storage = safeStorage();
  if (!storage) return;
  try {
    // doar câmpurile publice ale locației (fără distanța derivată din poziția clientului)
    const clean = Object.fromEntries(Object.entries(selections || {}).map(([k, v]) => [k, sanitizeSelection(v)]));
    storage.setItem(STORAGE_KEY, JSON.stringify(clean));
  } catch {
    /* stocare indisponibilă: alegerea rămâne doar în memorie */
  }
}

export function clearSelections() {
  try {
    safeStorage()?.removeItem(STORAGE_KEY);
  } catch {
    /* ignorat */
  }
}

/**
 * Alegerea efectivă a unui magazin, ținând cont de metodele disponibile acum
 * (o metodă dezactivată între timp revine la livrarea la adresă).
 */
export function effectiveSelection(selections, groupKey, availableMethods = ["HOME"]) {
  const sel = sanitizeSelection(selections?.[groupKey]);
  if (availableMethods.includes(sel.method)) return sel;
  const { fulfillment, userChosen } = sel;
  return { method: "HOME", location: null, ...(fulfillment ? { fulfillment, userChosen } : {}) };
}

/**
 * Ce trimitem la server: modul de livrare (doar când e ales de client sau e Sameday -
 * altfel serverul preselectează), metoda și ID-ul locației. Fără preț / serviciu.
 */
export function buildSelectionsPayload(groupKeys, selections, availableMethods) {
  return Object.fromEntries(
    groupKeys.map((key) => {
      const sel = effectiveSelection(selections, key, availableMethods);
      const mode = sel.fulfillment && (sel.userChosen || sel.fulfillment === ARTFEST_SAMEDAY) ? { fulfillment: sel.fulfillment } : {};
      return [key, sel.method === "HOME" ? { method: "HOME", ...mode } : { method: sel.method, oohId: sel.location?.id ?? null, ...mode }];
    })
  );
}

/**
 * Modul preselectat de server devine alegerea magazinului - DOAR unde clientul nu a
 * ales singur. Sameday indisponibil (selectedFulfillment null) nu schimbă nimic:
 * clientul reconfirmă explicit. Fără schimbare -> același obiect (fără bucle de render).
 */
export function applyQuotedFulfillment(selections, byGroup = {}) {
  let next = selections;
  for (const [key, quoted] of Object.entries(byGroup || {})) {
    const target = quoted?.selectedFulfillment;
    if (!FULFILLMENTS.includes(target)) continue;
    const sel = sanitizeSelection(selections?.[key]);
    if (sel.userChosen || sel.fulfillment === target) continue;
    if (next === selections) next = { ...selections };
    next[key] = target === ARTFEST_SAMEDAY ? { ...sel, fulfillment: target, userChosen: false } : { method: "HOME", location: null, fulfillment: target, userChosen: false };
  }
  return next;
}

/** Alegerea explicită a clientului pentru un magazin (păstrată la recalculări). */
export function chooseFulfillment(selections, groupKey, fulfillment) {
  if (!FULFILLMENTS.includes(fulfillment)) return selections;
  const sel = sanitizeSelection(selections?.[groupKey]);
  const keep = fulfillment === ARTFEST_SAMEDAY && sel.fulfillment === ARTFEST_SAMEDAY ? { method: sel.method, location: sel.location } : { method: "HOME", location: null };
  return { ...selections, [groupKey]: { ...keep, fulfillment, userChosen: true } };
}

/** Magazinele cu Sameday prin Artfest ales acum (=> plata doar cu cardul). */
export function samedayGroupKeys(groupKeys, selections) {
  return groupKeys.filter((key) => sanitizeSelection(selections?.[key]).fulfillment === ARTFEST_SAMEDAY);
}

/**
 * Magazinele care aveau ales easybox / Sameday Point, dar metoda nu mai e
 * disponibilă acum (Sameday indisponibil temporar). NU le trecem tăcut pe
 * livrare la adresă: clientul alege explicit adresa sau încearcă din nou.
 */
export function unavailableSelections(groupKeys, selections, availableMethods) {
  return groupKeys.filter((key) => {
    const sel = sanitizeSelection(selections?.[key]);
    return sel.method !== "HOME" && !availableMethods.includes(sel.method);
  });
}

/* ---------- opțiunile de livrare (structura checkout-ului) ---------- */

const OPTIONS_KEY = "checkout:delivery-options:v1";
export const HOME_ONLY = Object.freeze([{ method: "HOME", label: METHOD_LABELS.HOME }]);
export const DEFAULT_DELIVERY_OPTIONS = Object.freeze({ enabled: false, nomenclator: false, artfestSameday: false, methods: HOME_ONLY });

function cleanOptions(raw) {
  const methods = Array.isArray(raw?.methods) ? raw.methods.filter((m) => DELIVERY_METHODS.includes(m?.method)) : [];
  return {
    enabled: Boolean(raw?.enabled),
    nomenclator: Boolean(raw?.nomenclator),
    // Sameday prin Artfest poate fi oferit (ce magazine îl au decide quote-ul serverului)
    artfestSameday: Boolean(raw?.artfestSameday),
    methods: methods.some((m) => m.method === "HOME") ? methods : [...HOME_ONLY, ...methods],
  };
}

/**
 * Opțiunile noi peste cele cunoscute. Un răspuns reușit al serverului e
 * autoritar (inclusiv oprirea checkout-ului nou). O cerere EȘUATĂ
 * (rețea / 503) NU schimbă formularul: structura rămâne, doar metodele
 * dependente de Sameday dispar (livrarea la adresă rămâne).
 */
export function mergeDeliveryOptions(prev, next) {
  if (next?.ok !== false) return cleanOptions(next);
  const known = cleanOptions(prev || DEFAULT_DELIVERY_OPTIONS);
  return { ...known, methods: HOME_ONLY };
}

/** Ultimele opțiuni reușite (sessionStorage): după refresh, aceeași structură imediat. */
export function loadDeliveryOptions() {
  try {
    const raw = safeStorage()?.getItem(OPTIONS_KEY);
    return raw ? cleanOptions(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function saveDeliveryOptions(options) {
  try {
    safeStorage()?.setItem(OPTIONS_KEY, JSON.stringify(cleanOptions(options)));
  } catch {
    /* stocare indisponibilă */
  }
}

/** Magazinele cu easybox / Sameday Point ales, dar fără locație. */
export function missingLocations(groupKeys, selections, availableMethods) {
  return groupKeys.filter((key) => {
    const sel = effectiveSelection(selections, key, availableMethods);
    return sel.method !== "HOME" && !sel.location;
  });
}

// zilele 1-7 din programul Sameday; convenția ISO (1 = luni) nu e precizată
// explicit în documentație - de confirmat cu Sameday
const DAY_NAMES = { 1: "Lun", 2: "Mar", 3: "Mie", 4: "Joi", 5: "Vin", 6: "Sâm", 7: "Dum" };

/** Programul pe scurt („Lun-Vin 08:00-20:00 · Sâm 09:00-14:00”); „Non-stop” dacă e cazul. */
export function scheduleSummary(schedule = []) {
  const rows = (schedule || [])
    .filter((s) => s && DAY_NAMES[s.day] && s.open && s.close)
    .sort((a, b) => a.day - b.day);
  if (!rows.length) return "";
  if (rows.length === 7 && rows.every((s) => s.open === "00:00" && /^23:5\d$/.test(s.close))) return "Non-stop";

  const groups = [];
  for (const s of rows) {
    const hours = `${s.open}-${s.close}`;
    const last = groups[groups.length - 1];
    if (last && last.hours === hours && last.to === s.day - 1) last.to = s.day;
    else groups.push({ from: s.day, to: s.day, hours });
  }
  return groups.map((g) => `${DAY_NAMES[g.from]}${g.to !== g.from ? `-${DAY_NAMES[g.to]}` : ""} ${g.hours}`).join(" · ");
}

/**
 * Magazinele unde clientul a avut „Sameday prin Artfest” ales, dar opțiunea nu mai e oferită
 * deloc (Sameday oprit global -> checkout-ul revine la forma veche, fără quote). Fără acest
 * control, alegerea ar fi ignorată în tăcere și comanda ar pleca cu curierul magazinului.
 * Doar după un răspuns reușit al serverului (optionsFetched), ca să nu apară la încărcare.
 */
export function staleSamedayGroupKeys({ deliveryEnabled, optionsFetched, groupKeys = [], selections }) {
  if (deliveryEnabled || !optionsFetched) return [];
  return samedayGroupKeys(groupKeys, selections);
}

export const STALE_SAMEDAY_MESSAGE =
  "Livrarea Sameday prin Artfest aleasă nu mai este disponibilă. Comanda poate fi livrată de curierul magazinului, la prețul afișat; confirmă alegerea ca să continui.";
