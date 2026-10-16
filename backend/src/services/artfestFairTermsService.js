// backend/src/services/artfestFairTermsService.js
//
// Legarea regulamentului PUBLICAT de Târgul Artfest: termsVersion și termsUrl
// se setează DOAR împreună, dintr-o versiune existentă în registrul de
// versiuni publicate (legal/artfest_fair_rules/versions.yml), fără marcaje de
// draft. URL-ul nu vine niciodată din exterior: se derivă din versiune.
//
// Garanția finală e în DB (CHECK ArtfestFair_terms_pair_chk): ambele NULL sau
// termsUrl = '/targ-artfest/regulament/v' || termsVersion.

import { prisma } from "../db.js";
import { ARTFEST_FAIR_KEY } from "../config/artfestFair.js";
import { fairRulesPublicPath, loadPublishedFairRules, normalizeFairRulesVersion } from "../lib/artfestFairRules.js";
import { FairError } from "./artfestFairService.js";

// starea consistentă pentru o pereche (termsVersion, termsUrl)
export function termsPairState(termsVersion, termsUrl) {
  if (!termsVersion && !termsUrl) return "none";
  if (termsVersion && termsUrl === fairRulesPublicPath(termsVersion)) return "linked";
  return "inconsistent";
}

/*
 * Verifică fără să scrie: versiunea e publicată și se poate servi?
 * loadPublished e injectabil doar pentru teste.
 */
export function checkPublishableTerms(version, { loadPublished = loadPublishedFairRules } = {}) {
  const clean = normalizeFairRulesVersion(version);
  if (!clean) throw new FairError(400, "invalid_version", "Versiune invalidă (format: 1.0.0).");
  const doc = loadPublished(clean);
  if (!doc) {
    throw new FairError(
      409,
      "terms_not_published",
      `Versiunea ${clean} nu este publicată (lipsește din registru, fișierul lipsește sau conține încă marcaje de draft / variabile lipsă).`
    );
  }
  return { version: clean, url: fairRulesPublicPath(clean), title: doc.title };
}

/*
 * Setează ÎMPREUNĂ termsVersion + termsUrl pe târg, într-o singură scriere.
 * Înscrierile vechi își păstrează versiunea acceptată (nu se rescriu).
 */
export async function linkPublishedTerms({ version, fairKey = ARTFEST_FAIR_KEY, db = prisma, loadPublished } = {}) {
  const target = checkPublishableTerms(version, { loadPublished });
  const fair = await db.artfestFair.findUnique({ where: { key: fairKey }, select: { id: true, termsVersion: true, termsUrl: true } });
  if (!fair) throw new FairError(404, "fair_not_found", "Târgul nu există.");

  const before = { termsVersion: fair.termsVersion || null, termsUrl: fair.termsUrl || null };
  await db.artfestFair.update({
    where: { id: fair.id },
    data: { termsVersion: target.version, termsUrl: target.url },
  });
  return { before, after: { termsVersion: target.version, termsUrl: target.url }, title: target.title };
}
