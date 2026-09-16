// backend/src/ai/knowledgeRetrieval.js

/*
 * Selectează manifestele RELEVANTE pentru un mesaj, NU trimite
 * toate manifestele la LLM la fiecare mesaj (vezi FAZA 3 din
 * cerință). Scoring determinist pe tags/aliases/title/description,
 * reutilizând EXACT algoritmul de token-matching deja construit și
 * testat pentru rezolvarea de produse (vezi
 * backend/src/lib/textRelevance.js - extras din
 * vendorAssistantCommandService.js ca să nu se dubleze logica).
 *
 * Al doilea pas LLM (dezambiguizare) e OPȚIONAL și se declanșează
 * DOAR dacă primele două rezultate au scoruri foarte apropiate -
 * nu se cheamă la fiecare mesaj.
 */

import { openai } from "../lib/openai.js";
import {
  scoreTextMatch,
  scoreTextMatchStrict,
  tokenizeSearchText,
} from "../lib/textRelevance.js";
import { getPlatformManifests } from "./manifests/index.js";

/*
 * Sub acest scor, un manifest NU e considerat relevant deloc -
 * nu apare în rezultat, indiferent de câte manifeste au scor mic.
 * Calibrat separat de PRODUCT_SEARCH_MIN_RELEVANCE_SCORE din
 * vendorAssistantCommandService.js (text-ul de potrivit e diferit:
 * tag-uri/alias-uri scurte vs. titluri de produs) - vezi
 * scoreManifest() mai jos pentru cum se combină sursele.
 */
const MIN_RELEVANCE_SCORE = 1.4;

/*
 * Dacă diferența dintre primele două scoruri e sub acest prag,
 * rezultatul e considerat ambiguu - se poate declanșa pasul 2 (LLM).
 */
const AMBIGUITY_GAP = 0.35;

const MAX_RESULTS = 3;

/*
 * "Ce fac aici?" / "Cum funcționează asta?" nu au NICIUN cuvânt în
 * comun cu tag-urile/alias-urile vreunui manifest (best rămâne 0) -
 * fără currentPage/currentEntity, un asemenea mesaj e, pe bună
 * dreptate, prea vag ca să răspundem la ceva. DAR dacă userul e deja
 * pe o pagină cunoscută (pageType/currentEntity cu hint structurat
 * spre un manifest anume), o întrebare SCURTĂ ca asta chiar se referă
 * la pagina respectivă - vezi cerința "knowledge contextual" (FAZA
 * curentă). Pragul e mic INTENȚIONAT: doar mesaje cu conținut minim
 * (fără nume propriu de funcționalitate) primesc acest tratament -
 * o întrebare cu conținut real, chiar dacă nu se potrivește cu
 * pagina curentă, nu trebuie deturnată către manifestul paginii.
 */
const VAGUE_QUERY_MAX_TOKENS = 4;

/*
 * Scor de bază pentru o întrebare vagă ancorată de pagină/entitate -
 * suficient de mare ca să domine (vezi DOMINANCE_RATIO din
 * knowledgeRetrieval.js) suprapuneri accidentale slabe cu alte
 * manifeste, dar sub un match REAL de text (title/tag/alias
 * complet, ~4.0) - nu vrem să depășească o potrivire genuină.
 */
const VAGUE_QUERY_STRUCTURAL_SCORE = 3.5;

/*
 * BATCH 1 (FINAL GAP PASS, 2026-09-07) - înlocuiește vechiul
 * LAST_CATEGORY_HINT_SCORE (constantă fixă 1.5, aplicată LOCAL în
 * scoreManifest). Auditul a confirmat, prin rulare directă, 3 cazuri
 * reale în care 1.5 fix nu era suficient: alte manifeste complet
 * nerelevante puteau avea un scor organic mai mare pe cuvinte
 * generice ("îl mai pot recupera?", "unde o văd?") și scoteau
 * manifestul indicat de context din top-3, în ciuda hint-ului.
 *
 * Noul mecanism (vezi getRelevantPlatformKnowledge) e GLOBAL, nu
 * local: se calculează întâi scorul organic al TUTUROR manifestelor
 * pentru mesajul curent, izolat de conversație, apoi:
 * - dacă cel mai mare scor organic e sub CONFIDENT_MATCH_SCORE
 *   (niciun manifest nu are un match de-sine-stătător de încredere -
 *   semnalul de "mesaj eliptic/dependent de context", NU numărul de
 *   tokeni), manifestul indicat de lastCategory primește un scor
 *   suficient să DOMINE orice zgomot organic existent;
 * - dacă există deja un match organic de încredere (pe ACEST mesaj,
 *   pe ORICE manifest), hint-ul nu se aplică deloc - nu retrogradează
 *   niciodată un răspuns deja corect.
 */
const CONFIDENT_MATCH_SCORE = 2.5;
const LAST_CATEGORY_DOMINANCE_MARGIN = 0.5;

/*
 * Un query cu mai puține cuvinte de conținut real (lungime >= 3
 * caractere) decât atât nu poate produce un match "de încredere",
 * indiferent de scor - vezi comentariul din getRelevantPlatformKnowledge.
 */
const MIN_MEANINGFUL_TOKENS_FOR_CONFIDENCE = 3;

/*
 * Filtru de dominanță (zgomot din retrieval): dacă top-1 e clar
 * peste restul, manifestele slabe NU mai ajung la LLM-ul care
 * generează răspunsul - doar confuzie inutilă pentru el, fără
 * beneficiu (vezi "Cum funcționează produsul zilei?", unde apărea
 * și un manifest cu scor 1.5 lângă unul cu scor 4 - complet
 * irelevant, doar zgomot).
 *
 * E RELATIV la top-1 (nu diferență fixă), tocmai ca să nu taie
 * recall-ul pe întrebări cu scoruri mici dar apropiate - o
 * ambiguitate reală între două scoruri mici (ex. 1.4 vs 1.35) tot
 * trece testul (1.35 >= 1.4*0.55), pentru că diferența RELATIVĂ e
 * mică, deși cea absolută pare "aproape".
 *
 * Distinct de AMBIGUITY_GAP de mai jos: acela decide dacă se
 * declanșează dezambiguizarea LLM (pentru top 2 aproape identice,
 * ca să alegem UNUL singur); DOMINANCE_RATIO decide doar câte
 * manifeste secundare rămân ca și context suplimentar pentru
 * generarea răspunsului, înainte de acel pas.
 */
const DOMINANCE_RATIO = 0.55;

/*
 * Boost-uri deterministe (NU multiplicative, aditive - un
 * manifest slab potrivit pe text nu ajunge sus doar pentru că
 * userul e pe acea pagină; boost-ul întărește un match deja
 * plauzibil, nu inventează unul).
 */
const CURRENT_PAGE_BOOST = 2;
const CONTEXT_ENTITY_BOOST = 2.5;

/*
 * PAGE-AWARE knowledge boost (etapa curentă) - mapare STRUCTURATĂ,
 * determinist verificată, de la pageType-ul real trimis de frontend
 * (vezi derivePageContext.js) la id-ul manifestului relevant.
 * Distinctă de boost-ul vechi pe bază de substring din uiLocations
 * (mai jos) - acela rămâne, e doar mult mai fragil (compară
 * pathname-ul brut cu bucăți din path-ul descriptiv al manifestului,
 * ex. "catalog (tab import)"), asta e sursa de adevăr nouă.
 */
const PAGE_TYPE_MANIFEST_HINTS = {
  PRODUCT_CATALOG: "products",
  CATALOG_IMPORT: "catalog-imports",
  COSTS_PROFIT: "costs-profit",
  COST_LIBRARY: "costs-profit",
  PRODUCT_COSTING: "costs-profit",
  ORDERS_LIST: "orders",
  ORDER_DETAILS: "orders",
  ORDERS_PLANNING: "orders",
  STORE_PROFILE: "vendor-store-profile",
  HOMEPAGE_FEATURES: "homepage-features",
  INVOICES: "invoices",
  QUOTES_LIST: "quotes",
  QUOTE_DETAILS: "quotes",
  VENDOR_SUPPORT: "support",
};

/*
 * ENTITY-AWARE knowledge boost - la fel, mapare structurată de la
 * currentEntity.type (whitelist server-side, vezi
 * assistantCopilotRoutes.js) la manifestul relevant.
 */
const ENTITY_TYPE_MANIFEST_HINTS = {
  PRODUCT: "products",
  PRODUCT_COSTING: "costs-profit",
  ORDER: "orders",
  STORE: "vendor-store-profile",
  QUOTE: "quotes",
};

function normalizeAudience(value) {
  const audience = String(value || "USER").toUpperCase();

  return ["USER", "VENDOR", "ADMIN", "GUEST"].includes(
    audience
  )
    ? audience
    : "USER";
}

/*
 * Scor per manifest = cel mai bun scor din (title, tags[],
 * aliases[], description), plus boost-uri de context. tags/aliases
 * sunt fraze scurte de intenție ("cum programez curierul") - se
 * potrivesc de multe ori mai bine cu o întrebare liberă decât
 * title/description, care sunt mai degrabă etichete.
 */
function scoreManifest({
  manifest,
  query,
  currentPage,
  currentEntity,
  conversationContext,
}) {
  let best = scoreTextMatch(manifest.title || "", query);

  for (const tag of manifest.tags || []) {
    const score = scoreTextMatch(tag, query);
    if (score > best) best = score;
  }

  for (const alias of manifest.aliases || []) {
    const score = scoreTextMatch(alias, query);
    if (score > best) best = score;
  }

  /*
   * BATCH 1 (FINAL GAP PASS, 2026-09-07) - FIX SISTEMIC pentru
   * WEAK_RETRIEVAL: auditul a găsit 57 de cazuri unde răspunsul
   * corect exista deja, verbatim, în manifest.faq[].q - dar
   * retrieval-ul nu-l vedea NICIODATĂ, pentru că scora doar title/
   * tags/aliases/description, niciodată întrebările din FAQ. Fix
   * SISTEMIC (nu 57 de aliases scrise manual): tratăm fiecare
   * faq[].q exact ca un alias - aceeași funcție de scor, același
   * prag. FAQ-urile sunt fraze curate, scrise de audit direct din
   * întrebări reale de vânzători - același nivel de semnal ca
   * aliases, nu zgomot nou.
   */
  for (const faqEntry of manifest.faq || []) {
    const score = scoreTextMatchStrict(faqEntry?.q || "", query);
    if (score > best) best = score;
  }

  const descriptionScore = scoreTextMatch(
    manifest.description || "",
    query
  );

  /*
   * description e text lung - un match acolo contează mai puțin
   * decât un match pe title/tags/aliases, dar tot ajută (ex.
   * cuvinte menționate doar în descriere).
   */
  if (descriptionScore * 0.6 > best) {
    best = descriptionScore * 0.6;
  }

  const pageTypeHint = String(
    currentPage?.pageType || ""
  ).toUpperCase();

  const entityTypeHintEarly = String(
    currentEntity?.type || ""
  ).toUpperCase();

  /*
   * BATCH 1 (FINAL GAP PASS, 2026-09-07) - hint-ul de context pe
   * lastCategory NU mai e calculat AICI (local, per-manifest) - s-a
   * mutat în getRelevantPlatformKnowledge, unde poate compara scorul
   * organic al manifestului indicat de context cu scorul organic al
   * TUTUROR celorlalte manifeste pentru acest mesaj, nu doar cu 0.
   * Motiv: auditul a confirmat, prin rulare directă, cazuri reale
   * unde un hint fix (1.5) era depășit de zgomot organic pe alte
   * manifeste complet nerelevante - vezi CONFIDENT_MATCH_SCORE mai
   * sus. Hint-ul de pagină/entitate (hasStructuralHint) rămâne
   * neschimbat - semnal diferit, mai stabil (o pagină nu se schimbă
   * de la o tură la alta), fără regresii găsite în audit pe acesta.
   */
  const hasStructuralHint =
    (pageTypeHint &&
      PAGE_TYPE_MANIFEST_HINTS[pageTypeHint] === manifest.id) ||
    (entityTypeHintEarly &&
      ENTITY_TYPE_MANIFEST_HINTS[entityTypeHintEarly] ===
        manifest.id);

  const isVagueQuery =
    tokenizeSearchText(query).length <=
    VAGUE_QUERY_MAX_TOKENS;

  if (best <= 0 && (!hasStructuralHint || !isVagueQuery)) {
    return 0;
  }

  /*
   * O întrebare vagă ANCORATĂ de pagina curentă trebuie să domine
   * clar orice suprapunere accidentală de cuvinte cu alte manifeste
   * (ex. "cum funcționează asta" se suprapune parțial, din
   * întâmplare, atât cu tag-uri proprii ale manifestului paginii -
   * dând un best mic, dar peste 0 - CÂT ȘI cu alias-ul altui
   * manifest complet nerelevant, ex. "cum funcționează produsul
   * zilei" - fără acest scor de bază minim GARANTAT, cele două ar
   * putea ajunge la scoruri comparabile și userul ar primi o
   * clarificare inutilă, deși pagina curentă indică deja clar
   * despre ce e vorba). De-aia e Math.max, nu doar un caz "best
   * era 0" - se aplică și când best era deja pozitiv, dar slab.
   */
  if (hasStructuralHint && isVagueQuery) {
    best = Math.max(best, VAGUE_QUERY_STRUCTURAL_SCORE);
  }

  if (
    pageTypeHint &&
    PAGE_TYPE_MANIFEST_HINTS[pageTypeHint] === manifest.id
  ) {
    best += CURRENT_PAGE_BOOST;
  }

  const pageHint = String(
    currentPage?.pathname ||
      currentPage?.page ||
      currentPage?.route ||
      ""
  ).toLowerCase();

  const pageTypeAlreadyBoosted = Boolean(
    pageTypeHint &&
      PAGE_TYPE_MANIFEST_HINTS[pageTypeHint] === manifest.id
  );

  if (
    !pageTypeAlreadyBoosted &&
    pageHint &&
    manifest.uiLocations?.some((loc) =>
      pageHint.includes(
        String(loc.path || "")
          .toLowerCase()
          .split("/")
          .filter(Boolean)[1] || " "
      )
    )
  ) {
    best += CURRENT_PAGE_BOOST;
  }

  const entityTypeHint = String(
    currentEntity?.type || ""
  ).toUpperCase();

  const entityTypeAlreadyBoosted = Boolean(
    entityTypeHint &&
      ENTITY_TYPE_MANIFEST_HINTS[entityTypeHint] === manifest.id
  );

  if (entityTypeAlreadyBoosted) {
    best += CONTEXT_ENTITY_BOOST;
  }

  const activeEntity = String(
    conversationContext?.entityType ||
      conversationContext?.activeIntent ||
      ""
  ).toLowerCase();

  if (
    !entityTypeAlreadyBoosted &&
    activeEntity &&
    (manifest.id.includes(activeEntity) ||
      manifest.tags?.some((tag) =>
        tag.toLowerCase().includes(activeEntity)
      ))
  ) {
    best += CONTEXT_ENTITY_BOOST;
  }

  return best;
}

/*
 * Pas 2 (opțional): dacă primele două manifeste relevante au
 * scoruri foarte apropiate, cerem modelului să aleagă unul singur,
 * dându-i DOAR titlurile+descrierile candidaților (nu tot
 * manifestul) - ieftin, un singur apel, doar când chiar există
 * ambiguitate reală.
 */
async function disambiguateWithLLM({
  query,
  candidates,
}) {
  try {
    const response = await openai.responses.create({
      model: "gpt-4.1-mini",

      text: { format: { type: "json_object" } },

      input: [
        {
          role: "user",

          content: [
            {
              type: "input_text",

              text: `Un utilizator a întrebat: "${query}"

Alege care dintre următoarele domenii ale platformei Artfest răspunde cel mai bine la întrebare. Dacă niciunul nu se potrivește clar, alege null.

Domenii candidate:
${candidates
  .map(
    (c, i) =>
      `${i + 1}. id="${c.id}" - ${c.title}: ${c.description}`
  )
  .join("\n")}

Răspunde EXCLUSIV JSON: { "id": "<id-ul ales sau null>" }`,
            },
          ],
        },
      ],
    });

    const raw = String(
      response.output_text || ""
    ).trim();

    const parsed = JSON.parse(
      raw.replace(/^```json/i, "").replace(/```$/i, "").trim()
    );

    return parsed?.id || null;
  } catch (error) {
    /*
     * Dezambiguizarea e un bonus - dacă eșuează, rămânem cu
     * ordinea deterministă (primul rezultat din scor). Logăm
     * totuși (audit: eșecul era complet invizibil înainte, greu
     * de depanat dacă disambiguarea nu mai funcționează deloc).
     */
    console.error(
      "[knowledgeRetrieval] disambiguateWithLLM failed:",
      error
    );

    return null;
  }
}

/**
 * Selectează manifestele relevante pentru un mesaj. NU garantează
 * niciun rezultat - dacă nimic nu trece pragul minim, întoarce
 * un array gol (routerul/knowledge-answer-ul trebuie să trateze
 * asta ca "nu am suficiente informații sigure", nu ca eroare).
 */
export async function getRelevantPlatformKnowledge({
  query,
  audience,
  currentPage,
  currentEntity,
  conversationContext,
  allowLlmDisambiguation = true,
}) {
  const safeQuery = String(query || "").trim();

  if (!safeQuery) {
    return [];
  }

  const safeAudience = normalizeAudience(audience);

  /*
   * knowledgeAudience vs audience (audit): "audience" rămâne sursa
   * de adevăr pentru CINE poate EXECUTA capabilitățile din manifest
   * (folosit separat, neschimbat, de handlePlatformAction/action
   * registry - un GUEST/USER nu poate declanșa nimic doar pentru că
   * poate CITI despre asta). "knowledgeAudience", opțional, extinde
   * DOAR cine poate GĂSI manifestul prin retrieval - pentru concepte
   * vendor-only care sunt totuși explicabile public (comision,
   * onboarding, Costuri & Profit etc: "Cum devin vânzător?" trebuie
   * să funcționeze și pentru un GUEST). Dacă manifestul nu declară
   * knowledgeAudience, comportamentul e identic cu înainte (fallback
   * pe audience).
   */
  const manifests = getPlatformManifests().filter((manifest) => {
    const knowledgeAudience = Array.isArray(
      manifest.knowledgeAudience
    )
      ? manifest.knowledgeAudience
      : manifest.audience;

    return (
      Array.isArray(knowledgeAudience) &&
      knowledgeAudience.includes(safeAudience)
    );
  });

  const organic = manifests.map((manifest) => ({
    manifest,

    score: scoreManifest({
      manifest,
      query: safeQuery,
      currentPage,
      currentEntity,
      conversationContext,
    }),
  }));

  /*
   * BATCH 1 (FINAL GAP PASS, 2026-09-07) - hint de context GLOBAL,
   * calculat DUPĂ ce toate manifestele au un scor organic (izolat de
   * conversație). Fixează 3 cazuri confirmate prin rulare directă
   * unde vechiul hint local (scor fix 1.5) era depășit de zgomot
   * organic pe manifeste complet nerelevante:
   * - "Când primesc factura?" -> "Unde o văd?" (lastCategory=
   *   checkout-payments, dar catalog-imports/catalog-products/orders
   *   scorau mai mult pe cuvinte generice)
   * - "Cum conectez Stripe?" -> "Unde văd dacă este conectat?" (5
   *   tokeni - peste vechiul VAGUE_QUERY_MAX_TOKENS, hint-ul nu se
   *   aplica NICIODATĂ, indiferent de context)
   * - "Cum șterg definitiv contul?" -> "Îl mai pot recupera?"
   *   (hint 1.5 depășit de 3 manifeste nerelevante)
   *
   * Semnalul de "mesaj eliptic/dependent de context" NU mai e numărul
   * de tokeni (arbitrar) - e faptul că NICIUN manifest nu are deja un
   * match organic de încredere pentru acest mesaj, privit izolat de
   * conversație. Dacă există un asemenea match (>= CONFIDENT_MATCH_
   * SCORE, pe ORICE manifest, nu neapărat pe cel indicat de context),
   * hint-ul nu se aplică deloc - nu retrogradează niciodată un răspuns
   * deja corect, indiferent de conversație (cerința explicită a
   * auditului: "fără să strice query-urile independente clare").
   *
   * Când hint-ul SE aplică, manifestul indicat primește un scor peste
   * cel mai mare scor organic existent + o marjă - suficient să
   * domine zgomotul, dar NU exagerat de mare, ca alte manifeste cu
   * scor organic real (ex. "messages" la "Mai pot răspunde la
   * mesaje?" după o tură despre pauza magazinului) să rămână și ele
   * în rezultat, prin filtrul de dominanță de mai jos - LLM-ul de
   * răspuns le vede pe amândouă, nu doar pe cea indicată de context.
   */
  const lastCategoryId = String(
    conversationContext?.lastCategory || ""
  );

  /*
   * USER BATCH 3 (#362, audit 2026-09-08, fix GENERAL aprobat) - flag
   * setat DOAR când mesajul curent e un follow-up eliptic/dependent de
   * context (isContextDependent, calculat mai jos) ȚINTIND manifestul
   * indicat de lastCategory. Folosit mai departe la filtrul de
   * dominanță: când e activ, un manifest SECUNDAR (diferit de cel
   * dominant) supraviețuiește filtrului DOAR dacă are el însuși un
   * scor organic de încredere (>= CONFIDENT_MATCH_SCORE) - nu doar
   * pentru că trece pragul relativ DOMINANCE_RATIO față de scorul
   * ARTIFICIAL (boostat) al celui dominant. Nu e specific niciunui
   * cuvânt ("email"/"telefon"/etc.) - se aplică oricărui follow-up
   * eliptic, pe orice domeniu, exact cerința "nu hardcodat".
   */
  let ellipticalContinuationHintApplied = false;

  if (lastCategoryId) {
    const hinted = organic.find(
      ({ manifest }) => manifest.id === lastCategoryId
    );

    if (hinted) {
      const bestOrganicScore = organic.reduce(
        (max, o) => Math.max(max, o.score),
        0
      );

      /*
       * BATCH 1 (FINAL GAP PASS, 2026-09-07) - a doua condiție,
       * necesară după regresia Q255: un scor organic mare NU e
       * automat un "match de încredere" care trebuie protejat de
       * hint. Cazul real găsit prin audit: "Unde o văd?" (3 tokeni)
       * atinge scor 4.0 (acoperire completă) pe FAQ-ul quotes "Unde
       * văd conversația legată de o ofertă?" - dar acoperirea e
       * completă DOAR pentru că query-ul are 2 cuvinte de conținut
       * ("unde", "văd"), amândouă extrem de generice, comune la
       * majoritatea manifestelor cu conținut "unde văd X". Bonusul de
       * acoperire completă favorizează disproporționat query-urile
       * scurte, indiferent cât de generice sunt cuvintele - de-aia
       * cerem, în plus, un NUMĂR MINIM de cuvinte de conținut real
       * (lungime >= 3) în query, nu doar scorul. Sub acest minim, un
       * match "complet" e prea ambiguu ca să blocheze contextul.
       */
      const meaningfulQueryTokenCount = tokenizeSearchText(
        safeQuery
      ).filter((token) => token.length >= 3).length;

      const isContextDependent =
        bestOrganicScore < CONFIDENT_MATCH_SCORE ||
        meaningfulQueryTokenCount < MIN_MEANINGFUL_TOKENS_FOR_CONFIDENCE;

      if (isContextDependent) {
        hinted.score = Math.max(
          hinted.score,
          bestOrganicScore + LAST_CATEGORY_DOMINANCE_MARGIN,
          MIN_RELEVANCE_SCORE
        );

        ellipticalContinuationHintApplied = true;
      }
    }
  }

  const ranked = organic
    .filter(({ score }) => score >= MIN_RELEVANCE_SCORE)
    .sort((a, b) => b.score - a.score);

  if (!ranked.length) {
    return [];
  }

  /*
   * Tăiem manifestele secundare mult sub top-1 ÎNAINTE de slice-ul
   * la MAX_RESULTS - dacă top-1 domină clar, rămânem cu un singur
   * rezultat (și sărim și pasul de dezambiguizare LLM de mai jos,
   * care oricum n-ar avea sens cu un singur candidat).
   */
  const dominanceThreshold =
    ranked[0].score * DOMINANCE_RATIO;

  let dominant = ranked.filter(
    ({ score }) => score >= dominanceThreshold
  );

  /*
   * USER BATCH 3 (#362, fix GENERAL) - când follow-up-ul e eliptic
   * (hint aplicat mai sus), scorul manifestului dominant e ARTIFICIAL
   * (boostat, nu organic) - pragul relativ DOMINANCE_RATIO calculat
   * față de el e prea permisiv și lasă să treacă manifeste secundare
   * complet nerelevante organic (ex. "quotes" lângă "checkout-
   * payments" la "Unde o văd?", "auth-account" lângă "vendor-store-
   * profile" la "Îl mai pot recupera?" - confirmate prin audit ca
   * bug-uri reale). Restrângem manifestele secundare la cele cu scor
   * organic de-sine-stătător de încredere (>= CONFIDENT_MATCH_SCORE) -
   * o schimbare REALĂ de subiect (alt manifest, independent relevant
   * pe mesajul curent) rămâne vizibilă, doar zgomotul e tăiat.
   */
  if (ellipticalContinuationHintApplied) {
    dominant = dominant.filter(
      ({ manifest, score }) =>
        manifest.id === lastCategoryId || score >= CONFIDENT_MATCH_SCORE
    );
  }

  const top = dominant.slice(0, MAX_RESULTS);

  const isAmbiguous =
    allowLlmDisambiguation &&
    top.length >= 2 &&
    top[0].score - top[1].score < AMBIGUITY_GAP;

  if (isAmbiguous) {
    const chosenId = await disambiguateWithLLM({
      query: safeQuery,

      candidates: top.map(({ manifest }) => manifest),
    });

    if (chosenId) {
      const chosen = top.find(
        ({ manifest }) => manifest.id === chosenId
      );

      if (chosen) {
        return [chosen.manifest];
      }
    }
  }

  return top.map(({ manifest }) => manifest);
}
