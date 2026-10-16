// backend/src/lib/artfestFairRules.js
//
// Regulamentul și condițiile de participare la Târgul Artfest - versiuni publicate.
//
// - Registrul versiunilor publicate: legal/artfest_fair_rules/versions.yml
//   (listă goală = nimic publicat => orice versiune răspunde 404).
// - Draftul (legal/drafts/artfest_fair_rules) NU este servit niciodată.
// - Randarea folosește același mecanism ca documentele legale generale
//   (renderLegalMarkdown: variabile din legal/vars, ex. {{company.legal_name}}).
// - O versiune cu variabile lipsă sau cu marcaje de draft rămase NU este servită.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import yaml from "yaml";
import { renderLegalMarkdown } from "./legal.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LEGAL_DIR = path.resolve(__dirname, "../../legal");
const REGISTRY_PATH = path.join(LEGAL_DIR, "artfest_fair_rules", "versions.yml");
// draftul de lucru: servit DOAR prin ruta separată de draft (autentificat, marcat „draft”),
// niciodată prin ruta oficială și niciodată ca versiune acceptată
const DRAFT_PATH = path.join(LEGAL_DIR, "drafts", "artfest_fair_rules", "v1.md");

const SEMVER_RE = /^\d+\.\d+\.\d+$/;
// marcaje care nu au voie să ajungă într-o versiune publică
const DRAFT_MARKERS_RE = /\[(DE STABILIT|REVIZUIRE JURIDICĂ|TERMEN LIMITĂ PREDARE)[^\]]*\]/;

export const FAIR_RULES_TITLE = "Regulamentul și condițiile de participare la Târgul Artfest";

// adresa publică (frontend) a unei versiuni
export function fairRulesPublicPath(version) {
  return `/targ-artfest/regulament/v${version}`;
}

// HTML-ul randat de backend pentru o versiune (folosit de pagina publică)
export function fairRulesHtmlPath(version) {
  return `/legal/artfest-fair-rules/v/${version}.html`;
}

export function normalizeFairRulesVersion(raw) {
  const value = String(raw || "").trim().replace(/^v/i, "");
  return SEMVER_RE.test(value) ? value : null;
}

export function listPublishedFairRules() {
  if (!fs.existsSync(REGISTRY_PATH)) return [];
  const data = yaml.parse(fs.readFileSync(REGISTRY_PATH, "utf8")) || {};
  const versions = Array.isArray(data.versions) ? data.versions : [];
  return versions
    .map((entry) => ({
      version: normalizeFairRulesVersion(entry?.version),
      path: String(entry?.path || ""),
      vars: Number(entry?.vars || 1),
      publishedAt: entry?.publishedAt ? String(entry.publishedAt) : null,
    }))
    .filter((entry) => entry.version && entry.path);
}

export function isFairRulesVersionPublished(version) {
  const wanted = normalizeFairRulesVersion(version);
  return Boolean(wanted) && listPublishedFairRules().some((entry) => entry.version === wanted);
}

// adresa versiunii acceptate, doar dacă versiunea este publicată
export function fairRulesUrlForAcceptedVersion(version) {
  return isFairRulesVersionPublished(version) ? fairRulesPublicPath(normalizeFairRulesVersion(version)) : null;
}

// adresa paginii de citire a draftului (frontend) - NU este termsUrl
export const FAIR_RULES_DRAFT_PATH = "/targ-artfest/regulament-draft";

/*
 * Draftul curent, doar pentru citire (vendor / Admin). Întoarce și semver-ul
 * draftului, DOAR informativ: nu este o versiune publicată și nu se salvează
 * niciodată ca termsVersion.
 */
export function loadFairRulesDraft() {
  if (!fs.existsSync(DRAFT_PATH)) return null;
  const raw = fs.readFileSync(DRAFT_PATH, "utf8");
  const doc = renderLegalMarkdown(raw, { varsVersion: 1 });
  return {
    status: "draft",
    draftVersion: doc.data?.semver ? String(doc.data.semver) : null,
    title: doc.title || FAIR_RULES_TITLE,
    html: doc.html,
  };
}

/*
 * Încarcă o versiune PUBLICATĂ. Întoarce null dacă versiunea nu e în
 * registru, fișierul lipsește, iese din folderul legal sau conține încă
 * variabile lipsă / marcaje de draft.
 */
export function loadPublishedFairRules(version) {
  const wanted = normalizeFairRulesVersion(version);
  if (!wanted) return null;

  const entry = listPublishedFairRules().find((e) => e.version === wanted);
  if (!entry) return null;

  const filePath = path.resolve(LEGAL_DIR, entry.path);
  if (!filePath.startsWith(LEGAL_DIR + path.sep) || filePath.includes(`${path.sep}drafts${path.sep}`)) return null;
  if (!fs.existsSync(filePath)) return null;

  const raw = fs.readFileSync(filePath, "utf8");
  const doc = renderLegalMarkdown(raw, { varsVersion: entry.vars });
  if (doc.missingVars.length || DRAFT_MARKERS_RE.test(doc.content)) return null;

  return {
    version: wanted,
    title: doc.title || FAIR_RULES_TITLE,
    html: doc.html,
    publishedAt: entry.publishedAt,
    publicPath: fairRulesPublicPath(wanted),
  };
}
