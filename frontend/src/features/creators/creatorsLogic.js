// src/features/creators/creatorsLogic.js
//
// Artfest Creators - logica pură a interfeței (fără React, testată în
// creatorsLogic.test.js): pașii onboardingului, mesajele de status, turul ghidat,
// formatări și mesajele de eroare în limbaj natural.

import { parseCategorySelection } from "../../../../backend/src/lib/creatorCategorySelection.js";

export const CREATORS_API = "/api/creator";
export const CREATORS_ADMIN_API = "/api/admin/creators";

export const CREATOR_ROUTES = Object.freeze({
  home: "/influencer/creatori",
  onboarding: "/influencer/creatori/configurare",
  offers: "/influencer/creatori/oferte",
  dashboard: "/influencer",
});

/* ---------------- onboarding (maximum 3 pași) ---------------- */

export const ONBOARDING_STEPS = Object.freeze([
  { n: 1, key: "about", title: "Despre tine", hint: "Fotografie, nume public, descriere și nișe." },
  { n: 2, key: "socials", title: "Rețele sociale", hint: "Linkurile profilurilor și urmăritorii declarați." },
  { n: 3, key: "collaboration", title: "Cum colaborezi", hint: "Produse, promovare plătită sau ambele." },
]);

export function clampStep(value) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= ONBOARDING_STEPS.length ? n : 1;
}

// problemele de publicare (venite de pe server) pentru un pas anume
export function problemsForStep(profile, step) {
  return (profile?.publishProblems || []).filter((p) => p.step === step);
}

export function firstIncompleteStep(profile) {
  const problems = profile?.publishProblems || [];
  return problems.length ? Math.min(...problems.map((p) => p.step)) : ONBOARDING_STEPS.length;
}

// progres pentru indicatorul vizual: pași fără probleme / total
export function onboardingProgress(profile) {
  const done = ONBOARDING_STEPS.filter((s) => problemsForStep(profile, s.n).length === 0).length;
  return { done, total: ONBOARDING_STEPS.length, percent: Math.round((done / ONBOARDING_STEPS.length) * 100) };
}

/* ---------------- validare locală (aceleași reguli ca serverul) ---------------- */

/*
 * Serverul rămâne sursa de adevăr (validează oricum la salvare și la trimitere);
 * aici reproducem regulile doar pentru feedback imediat: progresul pașilor din
 * datele încă nesalvate și erorile specifice pe câmp la rețelele sociale.
 */

const URL_MAX = 300;
const COUNT_MAX = 500_000_000;

function platformHosts(platform) {
  if (Array.isArray(platform?.hosts) && platform.hosts.length) return platform.hosts.map((h) => String(h).toLowerCase());
  const host = String(platform?.host || "").toLowerCase().replace(/^www\./, "");
  return host ? [host, "www." + host] : [];
}

// numele contului din link (ca handleFromUrl din backend); null dacă linkul duce doar la pagina principală
function handleFromLink(platformValue, url) {
  const segments = url.pathname.split("/").filter(Boolean);
  if (platformValue === "FACEBOOK" && segments[0] === "profile.php") return url.searchParams.get("id") || null;
  if (!segments.length) return null;
  let first = segments[0];
  if (platformValue === "YOUTUBE" && ["c", "channel", "user"].includes(first) && segments[1]) first = segments[1];
  let handle;
  try {
    handle = decodeURIComponent(first).replace(/^@/, "");
  } catch {
    return null;
  }
  return /^[\p{L}\p{N}._-]{1,100}$/u.test(handle) ? handle : null;
}

const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

// mesajul pentru linkul unei rețele sau null dacă e valid
export function socialUrlError(value, platform) {
  const label = platform?.label || "rețeaua socială";
  const hosts = platformHosts(platform);
  const example = "https://" + (hosts.find((h) => h.startsWith("www.")) || hosts[0] || "...") + "/numele-tau";
  const raw = String(value || "").trim();
  if (!raw) return "Adaugă linkul profilului tău " + label + " (ex. " + example + ").";
  if (/\s/.test(raw)) return "Linkul nu poate conține spații.";
  if (raw.length > URL_MAX) return "Linkul este prea lung (maximum " + URL_MAX + " de caractere).";
  if (!HAS_SCHEME.test(raw)) return "Linkul trebuie să înceapă cu https:// (ex. " + example + ").";
  let url;
  try {
    url = new URL(raw);
  } catch {
    return "Linkul nu este valid. Copiază-l din aplicația " + label + " (ex. " + example + ").";
  }
  if (url.protocol !== "https:") return "Linkul trebuie să înceapă cu https:// (ex. " + example + ").";
  if (url.username || url.password || url.port) return "Linkul nu este valid. Copiază-l din aplicația " + label + " (ex. " + example + ").";
  if (!hosts.includes(url.hostname.toLowerCase())) return "Linkul nu este de pe " + label + ". Folosește adresa profilului tău (ex. " + example + ").";
  if (!handleFromLink(platform?.value, url)) return "Linkul trebuie să ducă la profilul tău, nu la pagina principală " + label + " (ex. " + example + ").";
  return null;
}

/*
 * Erorile pe câmp pentru un rând de rețea socială din formular:
 * { url?, followers?, views?, engagement? } - obiect gol = rând valid.
 * Rândurile nebifate nu au erori.
 */
export function socialRowErrors(row, platform) {
  if (!row?.enabled) return {};
  const errors = {};
  const urlError = socialUrlError(row.url, platform);
  if (urlError) errors.url = urlError;

  const followers = parseIntOrNull(row.followers);
  if (followers === null) errors.followers = "Completează numărul de urmăritori.";
  else if (Number.isNaN(followers) || followers > COUNT_MAX) errors.followers = "Scrie numărul de urmăritori ca număr întreg (ex. 12500).";

  const views = parseIntOrNull(row.views);
  if (Number.isNaN(views) || views > COUNT_MAX) errors.views = "Scrie vizualizările medii ca număr întreg (ex. 3000) sau lasă gol.";

  const engagement = String(row.engagement || "").trim().replace(",", ".");
  if (engagement && (!/^\d+(\.\d+)?$/.test(engagement) || Number(engagement) > 100)) {
    errors.engagement = "Scrie un procent între 0 și 100 (ex. 3,5) sau lasă gol.";
  }
  return errors;
}

/*
 * Problemele de publicare calculate din formular (inclusiv ce nu e încă salvat),
 * cu aceleași câmpuri / pași / reguli ca publishProblems de pe server.
 * Secțiunile lipsă din form (încă neîncărcate) se iau din profilul salvat.
 */
export function livePublishProblems(profile, form = {}, options = {}) {
  if (!profile) return [];
  const limits = options?.limits || {};
  const nameMin = limits.displayNameMin || 2;
  const bioMin = limits.bioMin || 40;
  const about = form?.about || profile;
  const collab = form?.collab || profile;
  const problems = [];
  const server = (field) => (profile.publishProblems || []).find((p) => p.field === field)?.message;
  const add = (field, step, message) => problems.push({ field, step, message: server(field) || message });

  if (!profile.avatarUrl) add("avatarUrl", 1, "Adaugă o fotografie de profil.");
  if (String(about.displayName || "").trim().length < nameMin) add("displayName", 1, "Completează numele public.");
  if (String(about.bio || "").trim().length < bioMin) add("bio", 1, "Scrie o descriere de cel puțin " + bioMin + " de caractere despre tine și conținutul tău.");
  if (!about.niches?.length) add("niches", 1, "Alege cel puțin o nișă.");

  const validSocials = form?.socials
    ? form.socials.filter((row) => row.enabled && !Object.keys(socialRowErrors(row, options?.platforms?.find((p) => p.value === row.platform))).length).length
    : (profile.socials || []).length;
  if (!validSocials) add("socials", 2, "Adaugă cel puțin o rețea socială, cu numărul de urmăritori.");

  if (!collab.acceptsProducts && !collab.acceptsPaid) add("collaboration", 3, "Alege cum dorești să colaborezi: produse, promovare plătită sau ambele.");
  return problems;
}

// progresul pașilor din formular (aceeași formă ca onboardingProgress)
export function liveOnboardingProgress(profile, form, options) {
  return onboardingProgress({ publishProblems: livePublishProblems(profile, form, options) });
}

/* ---------------- statusul profilului ---------------- */

/*
 * Ce vede influencerul în dashboard, după `entry` (de pe server):
 * setup | draft | pending | changes_requested | approved | rejected
 */
export function statusView(state) {
  const entry = state?.entry || "setup";
  const profile = state?.profile || null;

  if (profile?.suspended) {
    return {
      tone: "danger",
      badge: "Suspendat",
      title: "Profilul tău este suspendat",
      text: "Profilul nu este vizibil momentan. Pentru detalii, contactează echipa Artfest.",
      cta: null,
    };
  }

  switch (entry) {
    case "setup":
      return {
        tone: "info",
        badge: "Nou",
        title: "Creează-ți profilul Artfest Creators",
        text: "Un profil profesional, gratuit, prin care magazinele Artfest te pot descoperi pentru colaborări. Durează câteva minute.",
        cta: { label: "Configurează profilul", to: CREATOR_ROUTES.onboarding },
      };
    case "draft":
      return {
        tone: "info",
        badge: "Ciornă",
        title: "Continuă configurarea profilului",
        text: "Ai început profilul. Continuă de unde ai rămas și trimite-l spre aprobare.",
        cta: { label: "Continuă configurarea", to: `${CREATOR_ROUTES.onboarding}?pas=${firstIncompleteStep(profile)}` },
      };
    case "pending":
      return {
        tone: "warning",
        badge: "În verificare",
        title: profile?.hasPublishedVersion ? "Modificările tale sunt în verificare" : "Profilul tău este în verificare",
        text: profile?.hasPublishedVersion
          ? "Echipa Artfest verifică modificările. Până atunci, publicul vede versiunea aprobată anterior."
          : "Echipa Artfest verifică profilul. Primești un email și o notificare imediat ce avem un răspuns.",
        cta: null,
      };
    case "changes_requested":
      return {
        tone: "warning",
        badge: "Modificări solicitate",
        title: "Profilul are nevoie de câteva modificări",
        text: profile?.moderationMessage || "Actualizează profilul și trimite-l din nou spre aprobare.",
        cta: { label: "Actualizează profilul", to: `${CREATOR_ROUTES.onboarding}?pas=1` },
      };
    case "approved":
      if (profile?.paused) {
        return {
          tone: "muted",
          badge: "Pe pauză",
          title: "Profilul tău este pe pauză",
          text: "L-ai ascuns temporar. Îl poți reactiva oricând.",
          cta: null,
        };
      }
      return {
        tone: "success",
        badge: "Aprobat",
        title: profile?.hasUnpublishedChanges ? "Ai modificări netrimise" : "Profilul tău este aprobat",
        text: profile?.hasUnpublishedChanges
          ? "Modificările devin publice după ce le trimiți și sunt aprobate. Până atunci rămâne versiunea aprobată."
          : "Profilul tău a fost aprobat. Catalogul pentru magazine se deschide în curând.",
        cta: profile?.hasUnpublishedChanges ? { label: "Revizuiește și trimite", to: `${CREATOR_ROUTES.onboarding}?pas=1` } : null,
      };
    case "rejected":
      return {
        tone: "danger",
        badge: "Respins",
        title: "Profilul tău nu a fost aprobat",
        text: profile?.moderationMessage || "Pentru detalii, contactează echipa Artfest din secțiunea de asistență.",
        cta: null,
      };
    default:
      return { tone: "muted", badge: "", title: "Artfest Creators", text: "", cta: null };
  }
}

/*
 * Textul + acțiunea din cardul „Profilul meu” (pagina Creators), după status:
 * nu cerem trimiterea profilului cât timp este deja în verificare.
 */
export function profileSectionView(state) {
  const entry = state?.entry || "setup";
  const profile = state?.profile || null;
  if (!profile) return { text: "Încă nu ai un profil. Configurarea durează câteva minute.", cta: null };
  if (profile.suspended) return { text: "Profilul este suspendat și nu poate fi modificat momentan.", cta: null };
  const edit = (label, step = 1) => (profile.canEditContent ? { label, to: CREATOR_ROUTES.onboarding + "?pas=" + step } : null);
  switch (entry) {
    case "pending":
      return {
        text: profile.hasPublishedVersion
          ? "Modificările sunt în verificare. Publicul vede în continuare versiunea aprobată."
          : "Profilul a fost trimis și este în verificare. Te anunțăm prin email și notificare când avem un răspuns.",
        cta: null,
      };
    case "changes_requested":
      return { text: "Echipa Artfest a cerut câteva modificări. Actualizează profilul și trimite-l din nou.", cta: edit("Actualizează profilul") };
    case "rejected":
      return { text: "Profilul nu a fost aprobat.", cta: null };
    case "approved":
      return {
        text: profile.hasUnpublishedChanges
          ? "Ai modificări netrimise. Devin publice după ce le trimiți și sunt aprobate."
          : "Profil publicat. Modificările trec printr-o verificare scurtă.",
        cta: edit("Editează profilul"),
      };
    default:
      return { text: "Completează profilul și trimite-l spre aprobare.", cta: edit("Continuă configurarea", firstIncompleteStep(profile)) };
  }
}

// noul influencer (invitat după lansare) fără profil => direct în onboarding
export function shouldAutoStartOnboarding(state) {
  return state?.entry === "setup" && state?.autoOnboarding === true;
}

/* ---------------- turul ghidat (maximum 4 pași) ---------------- */

export const TOUR_STEPS = Object.freeze([
  { target: "creator-profile", title: "Profilul meu", text: "Aici îți vezi și editezi profilul public. Modificările importante trec printr-o verificare scurtă." },
  { target: "creator-offers", title: "Ofertele mele", text: "Creează pachete de promovare: produse, promovare plătită sau ambele. Le poți edita sau dezactiva oricând." },
  { target: "creator-collabs", title: "Colaborările mele", text: "Aici vei vedea propunerile de la magazine și colaborările în desfășurare." },
  { target: "creator-results", title: "Rezultatele mele", text: "Aici vei vedea colaborările finalizate și evaluările primite." },
]);

/*
 * Navigarea turului: { index } -> acțiune -> { index, done, outcome }.
 * outcome: "completed" (după ultimul pas) | "skipped" | null.
 */
export function tourReducer(state, action) {
  const index = state?.index ?? 0;
  const last = TOUR_STEPS.length - 1;
  switch (action) {
    case "next":
      return index >= last ? { index, done: true, outcome: "completed" } : { index: index + 1, done: false, outcome: null };
    case "back":
      return { index: Math.max(0, index - 1), done: false, outcome: null };
    case "skip":
      return { index, done: true, outcome: "skipped" };
    case "restart":
      return { index: 0, done: false, outcome: null };
    default:
      return { index, done: Boolean(state?.done), outcome: state?.outcome ?? null };
  }
}

/* ---------------- formatări ---------------- */

export function formatFollowers(n) {
  const value = Number(n);
  if (!Number.isFinite(value) || value < 0) return "-";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1).replace(".", ",").replace(/,0$/, "")} mil.`;
  if (value >= 10_000) return `${Math.round(value / 1000)} mii`;
  return new Intl.NumberFormat("ro-RO").format(value);
}

export function formatLei(cents) {
  if (cents === null || cents === undefined) return "";
  const value = Number(cents) / 100;
  return `${new Intl.NumberFormat("ro-RO", { minimumFractionDigits: Number(cents) % 100 ? 2 : 0, maximumFractionDigits: 2 }).format(value)} lei`;
}

// bani -> textul din câmp („199,50”)
export function centsToInput(cents) {
  if (cents === null || cents === undefined) return "";
  const whole = Math.trunc(Number(cents) / 100);
  const rest = Number(cents) % 100;
  return rest ? `${whole},${String(rest).padStart(2, "0")}` : String(whole);
}

// „200” sau „199,50” / „199.5”: validare înainte de trimitere (serverul validează oricum)
export function isValidLeiInput(value) {
  return /^\d{1,9}([.,]\d{1,2})?$/.test(String(value || "").trim().replace(/\s/g, ""));
}

export function parseIntOrNull(value) {
  const text = String(value ?? "").trim().replace(/[.\s]/g, "");
  if (!text) return null;
  const n = Number(text);
  return Number.isInteger(n) && n >= 0 ? n : NaN;
}

/* ---------------- erori ---------------- */

const FRIENDLY_STATUS = {
  401: "Sesiunea a expirat. Autentifică-te din nou.",
  403: "Nu ai acces la această secțiune.",
  413: "Fișierul este prea mare (maximum 10 MB).",
  428: "Mai ai de completat un pas de conformitate în contul tău de influencer înainte de a continua.",
  503: "Serverul este ocupat momentan. Încearcă din nou în câteva secunde.",
};

// mesaj pentru utilizator: niciodată JSON / stack trace / coduri tehnice
export function friendlyError(error, fallback = "Nu am putut salva. Încearcă din nou.") {
  const message = error?.data?.message;
  if (typeof message === "string" && message && !/[{}<>]|Error:|at\s\w+\s\(/.test(message)) return message;
  return FRIENDLY_STATUS[error?.status] || fallback;
}

export function fieldErrors(error) {
  const fields = error?.data?.fields;
  return fields && typeof fields === "object" ? fields : {};
}

/* ---------------- categoriile de produse (din catalogul Artfest) ---------------- */

// modelul selecției (grupe întregi, categorii, excluderi) e comun cu serverul
export {
  countCategoryPreferences,
  toggleCategory,
  toggleCategoryGroup,
} from "../../../../backend/src/lib/creatorCategorySelection.js";

const normalizeSearch = (text) =>
  String(text || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();

/*
 * Vizualizarea formularului „Ce categorii de produse ai dori să promovezi?”:
 *   - groups: grupele oficiale (din options.categories), fiecare cu starea
 *     „none” | „partial” | „full”, câte sunt alese și categoriile vizibile;
 *   - căutare după numele categoriei (fără diacritice); dacă se potrivește numele
 *     grupei, apare toată grupa; grupele fără rezultate se ascund;
 *   - unknown: valori salvate care nu mai există în catalog (rămân, pot fi scoase);
 *   - count: câte preferințe ocupă selecția (grupa întreagă = una).
 */
export function categoryPickerView(options = {}, selected = [], query = "") {
  const catalog = Array.isArray(options?.categories) ? options.categories : [];
  const labels = options?.categoryLabels || {};
  const sel = parseCategorySelection(selected, catalog);
  const q = normalizeSearch(query);
  const groups = [];
  const byGroup = new Map();
  for (const item of catalog) {
    const key = item.group || "alte";
    if (!byGroup.has(key)) {
      const group = { key, label: item.groupLabel || "Alte categorii", all: [], items: [] };
      byGroup.set(key, group);
      groups.push(group);
    }
    byGroup.get(key).all.push(item);
  }
  const visible = [];
  for (const group of groups) {
    const excluded = sel.groups.get(group.key);
    const whole = sel.groups.has(group.key);
    const isOn = (value) => (whole ? !excluded.has(value) : sel.singles.has(value));
    const selectedCount = group.all.filter((item) => isOn(item.value)).length;
    const state = whole ? (excluded.size ? "partial" : "full") : selectedCount ? "partial" : "none";
    const groupMatches = q && normalizeSearch(group.label).includes(q);
    const items = group.all
      .filter((item) => !q || groupMatches || normalizeSearch(item.label).includes(q))
      .map((item) => ({ value: item.value, label: item.label, on: isOn(item.value) }));
    if (q && !items.length) continue;
    visible.push({ key: group.key, label: group.label, state, whole, selectedCount, total: group.all.length, items });
  }
  return {
    groups: visible,
    unknown: sel.unknown.map((value) => ({ value, label: labels[value] || value })),
    count: sel.groups.size + sel.singles.size + sel.unknown.length,
  };
}
