// backend/src/services/influencerTermsStatus.js

/*
 * Status de acceptare a Acordului Programului de Influenceri
 * (influencer_terms) pentru un utilizator - sursă UNICĂ, reutilizată
 * de:
 * - GET /api/influencer/me (câmpul `terms`, aditiv);
 * - enforceInfluencerTermsGate (middleware de blocare pe rutele
 *   comerciale);
 * - POST /api/influencer/terms/accept (răspunsul după acceptare).
 *
 * Nu recalculează nimic financiar - doar compară cea mai recentă
 * versiune acceptată (UserConsent) cu versiunea curentă din
 * documentul legal (legal/manifest.yml, prin loadLegalDoc - aceeași
 * sursă canonică folosită de /api/legal).
 */

import { prisma } from "../db.js";
import { loadLegalDoc } from "../lib/legal.js";

export const INFLUENCER_TERMS_LEGAL_TYPE = "influencer_terms";
export const INFLUENCER_TERMS_CONSENT_DOCUMENT = "INFLUENCER_TERMS";

/**
 * Predicat PUR, reutilizat de oriunde trebuie comparată o versiune
 * acceptată cu versiunea curentă (inclusiv de admin/legal routes) -
 * o singură formulă, un singur loc. `null`/`undefined` (nicio
 * acceptare) e tratat mereu ca outdated.
 */
export function isInfluencerTermsOutdated(
  acceptedVersion,
  currentVersion
) {
  return acceptedVersion !== currentVersion;
}

/**
 * Documentul legal curent (influencer_terms) - expus separat ca să
 * nu importe consumatorii `loadLegalDoc` direct doar pentru
 * currentVersion/documentUrl (ex. rutele admin de mai jos).
 */
export function getCurrentInfluencerTermsDoc() {
  return loadLegalDoc(INFLUENCER_TERMS_LEGAL_TYPE);
}

/**
 * @param {string} userId
 * @returns {Promise<{
 *   currentVersion: string,
 *   acceptedVersion: string|null,
 *   outdated: boolean,
 *   documentUrl: string,
 * }>}
 */
export async function getInfluencerTermsStatus(userId) {
  const currentDoc = getCurrentInfluencerTermsDoc();
  const currentVersion = currentDoc.policyVersion;

  /*
   * Verificare DIRECTĂ pe versiunea curentă (lookup pe cheia unică
   * userId+document+version), NU "ultima acceptare din timp"
   * (findFirst orderBy givenAt desc).
   *
   * Motiv (audit 2026-09-11): dacă influencerul acceptase deja o
   * versiune mai nouă (ex. 2.0.0) și versiunea curentă redevine, din
   * greșeală sau nu, o versiune mai veche/identică (ex. 1.0.0),
   * "cea mai recentă acceptare din timp" tot arăta spre 2.0.0 ->
   * mismatch fals cu currentVersion -> outdated: true la infinit,
   * chiar și după ce userul reaccepta explicit versiunea curentă
   * (acel upsert nu putea "câștiga" din nou cursa cu givenAt).
   *
   * Istoricul altor versiuni (mai vechi sau mai noi) nu mai
   * influențează statusul curent - contează strict dacă există un
   * consimțământ pentru EXACT versiunea curentă.
   */
  const acceptedConsent = userId
    ? await prisma.userConsent.findUnique({
        where: {
          userId_document_version: {
            userId,
            document: INFLUENCER_TERMS_CONSENT_DOCUMENT,
            version: currentVersion,
          },
        },

        select: { version: true },
      })
    : null;

  const acceptedVersion = acceptedConsent?.version || null;

  return {
    currentVersion,
    acceptedVersion,

    /*
     * `acceptedVersion` este fie `null`, fie identic cu
     * `currentVersion` (a rezultat dintr-un lookup pe exact acea
     * versiune) - deci echivalent cu `outdated: !acceptedConsent`,
     * păstrat totuși prin helper-ul existent pentru compatibilitate
     * cu ceilalți consumatori (ex. adminInfluencerTermsRoutes.js).
     */
    outdated: isInfluencerTermsOutdated(
      acceptedVersion,
      currentVersion
    ),

    documentUrl: currentDoc.publicUrl,
  };
}
