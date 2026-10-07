// backend/src/services/feedTitleService.js
//
// Titlu SEPARAT pentru feed-ul Google Merchant Center (Product.feedTitle),
// generat cu OpenAI DOAR din datele produsului. Titlul afișat pe site
// (Product.title) rămâne neatins; feed-ul folosește feedTitle dacă există.
//
// Reguli (în prompt + validare locală, ca plasă de siguranță):
//   - formula: ce e + pentru cine/ocazie + detaliu (material, culoare,
//     personalizare), cel mai important termen de căutare la început;
//   - max 150 caractere (ideal sub 70), fără majuscule excesive, fără
//     emoji, fără formulări promoționale;
//   - NU inventează ocazii, materiale sau personalizări: doar faptele
//     trimise în `facts`; ce lipsește se omite;
//   - produsele aproape identice ale aceluiași magazin primesc lista
//     „fraților”, ca titlul să le diferențieze prin culoare / mărime /
//     model - doar dacă diferența există în datele produsului.
//
// `feedTitleInputHash` = hash-ul faptelor folosite: dacă produsul se
// schimbă (titlu, descriere, atribute), titlul de feed devine „vechi” și
// poate fi regenerat.

import crypto from "node:crypto";

import { prisma as defaultPrisma } from "../db.js";
import { openai as defaultOpenai } from "../lib/openai.js";
import {
  getCategoryLabel,
  getColorLabel,
  getMaterialLabel,
} from "../constants/productMerchantAttributes.js";

export const FEED_TITLE_VERSION = "feed-title-v2";
export const FEED_TITLE_MAX_LENGTH = 100;
export const FEED_TITLE_IDEAL_LENGTH = 70;
export const FEED_TITLE_MODEL = "gpt-4.1";

// Strict formulările promoționale interzise. „Promoția 2026” (generația de
// absolvenți) e conținut legitim al produsului, deci NU blocăm „promoți-”.
const BANNED_PHRASES = [
  /\bcel(e)? mai bun/i,
  /\bcea mai bun[aă]/i,
  /\breducer/i,
  /\blivrare gratuit/i,
  /\btransport gratuit/i,
];

const EMOJI = /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{FE0F}]/gu;

function stripHtml(value = "") {
  return String(value || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanList(values) {
  return [...new Set((Array.isArray(values) ? values : []).map((v) => String(v || "").trim()).filter(Boolean))];
}

/** Faptele din care AI-ul are voie să construiască titlul (nimic altceva). */
export function buildFeedTitleFacts(product) {
  const facts = {
    titluActual: String(product?.title || "").trim(),
    descriere: stripHtml(product?.description).slice(0, 1200),
    categorie: getCategoryLabel(product?.category) || null,
    culoare: getColorLabel(product?.color) || null,
    material: getMaterialLabel(product?.materialMain) || null,
    tehnica: String(product?.technique || "").trim() || null,
    dimensiuni: String(product?.dimensions || "").trim() || null,
    ocaziiDeclarate: cleanList(product?.occasionTags),
    stil: cleanList(product?.styleTags),
    personalizabil: product?.acceptsCustom === true || product?.orderMode === "OPTIONS",
  };

  return Object.fromEntries(
    Object.entries(facts).filter(([, value]) =>
      Array.isArray(value) ? value.length > 0 : value !== null && value !== "" && value !== false
    )
  );
}

export function feedTitleInputHash(facts) {
  return crypto.createHash("sha256").update(JSON.stringify(facts)).digest("hex");
}

/** Validare + curățare locală; întoarce { ok, title, problems }. */
export function sanitizeFeedTitle(raw) {
  const problems = [];
  let title = String(raw || "")
    .replace(EMOJI, "")
    .replace(/[!]+/g, "")
    .replace(/\s+/g, " ")
    .replace(/\s+,/g, ",")
    .replace(/^[\s,.-]+|[\s,.-]+$/g, "")
    .trim();

  if (!title) return { ok: false, title: "", problems: ["gol"] };

  // majuscule excesive: un cuvânt de 4+ litere scris integral cu majuscule
  const shouting = title.split(/\s+/).filter((w) => w.length >= 4 && w === w.toUpperCase() && /\p{L}/u.test(w));
  if (shouting.length) {
    problems.push(`majuscule: ${shouting.join(" ")}`);
    title = title
      .split(/\s+/)
      .map((w) => (shouting.includes(w) ? w.charAt(0) + w.slice(1).toLowerCase() : w))
      .join(" ");
  }

  for (const pattern of BANNED_PHRASES) {
    if (pattern.test(title)) problems.push(`formulare interzisă: ${pattern.source}`);
  }

  if (title.length > FEED_TITLE_MAX_LENGTH) {
    // tăiem la ultima parte întreagă (virgulă) care încape; altfel la cuvânt
    const head = title.slice(0, FEED_TITLE_MAX_LENGTH + 1);
    const lastComma = head.lastIndexOf(",");
    title =
      lastComma >= FEED_TITLE_IDEAL_LENGTH / 2
        ? head.slice(0, lastComma).trim()
        : head.slice(0, FEED_TITLE_MAX_LENGTH).replace(/[\s,]+\S*$/, "").trim();
    problems.push(`tăiat la ${FEED_TITLE_MAX_LENGTH} caractere`);
  }

  // prima literă mare (titlu de produs), restul neatins
  title = title.charAt(0).toLocaleUpperCase("ro-RO") + title.slice(1);

  const blocking = problems.some((p) => p.startsWith("formulare interzisă"));
  return { ok: !blocking, title, problems };
}

const STOPWORDS = new Set(["din", "sau", "cu", "si", "pentru", "de", "la", "in", "pe", "un", "o"]);

function normalizeForSimilarity(title) {
  return String(title || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

/** Aceleași primele două cuvinte semnificative = același tip de produs. */
function sameProductHead(a, b) {
  const A = normalizeForSimilarity(a).slice(0, 2).join(" ");
  const B = normalizeForSimilarity(b).slice(0, 2).join(" ");
  return Boolean(A) && A.includes(" ") && A === B;
}

/** Similaritate Jaccard pe cuvinte (titluri aproape identice ≥ 0.5). */
export function titleSimilarity(a, b) {
  const A = new Set(normalizeForSimilarity(a));
  const B = new Set(normalizeForSimilarity(b));
  if (!A.size || !B.size) return 0;
  let common = 0;
  for (const w of A) if (B.has(w)) common += 1;
  return common / (A.size + B.size - common);
}

/**
 * „Frații” unui produs: produse ale ACELUIAȘI magazin cu titlu aproape
 * identic (similaritate ≥ prag SAU același tip de produs la început, ex.
 * „Iepuraș croșetat …”) - AI-ul primește faptele lor ca să diferențieze.
 */
export function findSimilarSiblings(product, allProducts, threshold = 0.5) {
  return allProducts.filter(
    (other) =>
      other.id !== product.id &&
      other.serviceId === product.serviceId &&
      (titleSimilarity(other.title, product.title) >= threshold ||
        sameProductHead(other.title, product.title))
  );
}

export function buildFeedTitlePrompt(facts, siblingFacts = []) {
  return `Scrie un titlu de produs pentru Google Shopping (feed Merchant Center), în limba română, pentru un marketplace de produse handmade.

Răspunde EXCLUSIV cu JSON valid: {"feedTitle": "...", "folosite": ["..."]}
- "folosite" = lista faptelor din date pe care le-ai folosit (ex. "culoare", "material").

FORMULA: ce este produsul + pentru cine / ocazie + detaliu (material, culoare, personalizare).
- LUNGIME: ideal sub 70 de caractere, maximum 100.
- La început: tipul produsului + CEL MAI IMPORTANT detaliu (cel care îl deosebește: ex. material,
  culoare sau personalizare). Restul (ocazie, al doilea detaliu) DOAR dacă încape sub 70 de caractere;
  dacă nu încape, renunță la el - nu îl înghesui.
- Fără majuscule excesive, fără emoji, fără semne de exclamare.
- Fără „cel mai bun”, „reducere”, „livrare gratuită”, „ofertă”, superlative sau text promoțional.
- Fără numele magazinului.

- Scrie o frază naturală, cu virgule între părți (ex. „Iepuraș croșetat din pluș, jucărie pentru copii, gri cu rochiță verde”),
  NU o înșiruire de cuvinte cheie.

REGULĂ STRICTĂ: folosește DOAR informațiile din DATE. Nu inventa ocazii, destinatari, materiale,
culori, dimensiuni sau personalizări. Dacă o informație lipsește, omite-o (nu o ghici).
Poți reformula titlul actual și poți folosi doar ce scrie explicit în descriere.
- TIPUL produsului (ce este) trebuie să apară explicit în titlul actual, descriere sau categorie.
  Dacă nu îl poți identifica de acolo, răspunde cu "feedTitle": "" (nu îl deduce din material, culoare sau ocazie).
- Scrie „handmade” / „lucrat manual” DOAR dacă datele spun explicit că produsul e făcut manual.
- „Multicolor” doar dacă ajută la diferențiere; nu îl adăuga ca umplutură la final.

DATE PRODUS:
${JSON.stringify(facts, null, 2)}
${
  siblingFacts.length
    ? `
PRODUSE APROAPE IDENTICE ALE ACELUIAȘI MAGAZIN (doar pentru diferențiere, NU copia detaliile lor):
${JSON.stringify(siblingFacts, null, 2)}
Titlul trebuie să se deosebească de ale lor prin ce are ACEST produs diferit (culoare, mărime, model),
dar doar dacă diferența apare în DATE PRODUS.`
    : ""
}`;
}

/**
 * Generează titlul de feed (fără scriere în DB).
 * Întoarce { feedTitle, inputHash, problems, used } sau { feedTitle: null, error }.
 */
export async function generateFeedTitle(product, { siblings = [], openai = defaultOpenai, model = FEED_TITLE_MODEL } = {}) {
  const facts = buildFeedTitleFacts(product);
  const siblingFacts = siblings.map((s) => {
    const f = buildFeedTitleFacts(s);
    return { titluActual: f.titluActual, culoare: f.culoare, material: f.material, dimensiuni: f.dimensiuni };
  });

  try {
    const response = await openai.responses.create({
      model,
      temperature: 0.2,
      text: { format: { type: "json_object" } },
      input: [{ role: "user", content: [{ type: "input_text", text: buildFeedTitlePrompt(facts, siblingFacts) }] }],
    });

    let parsed = null;
    try {
      parsed = JSON.parse(response.output_text || "");
    } catch {
      parsed = null;
    }

    const checked = sanitizeFeedTitle(parsed?.feedTitle);
    if (!checked.ok) {
      return { feedTitle: null, inputHash: feedTitleInputHash(facts), problems: checked.problems, error: "invalid_title" };
    }

    return {
      feedTitle: checked.title,
      inputHash: feedTitleInputHash(facts),
      problems: checked.problems,
      used: Array.isArray(parsed?.folosite) ? parsed.folosite.map(String) : [],
    };
  } catch (error) {
    return { feedTitle: null, inputHash: feedTitleInputHash(facts), error: error?.message || "openai_failed" };
  }
}

/* =========================================================
   REGENERARE AUTOMATĂ (după creare / modificare produs)
   - doar dacă hash-ul datelor (buildFeedTitleFacts) s-a schimbat;
   - în fundal: nu blochează și nu poate face să eșueze salvarea;
   - la eșec, feedTitle devine null -> feed-ul folosește `title`
     (niciodată un feedTitle vechi pentru date noi).
========================================================= */

export const FEED_TITLE_FACT_FIELDS = {
  id: true,
  serviceId: true,
  title: true,
  description: true,
  category: true,
  color: true,
  materialMain: true,
  technique: true,
  dimensions: true,
  occasionTags: true,
  styleTags: true,
  acceptsCustom: true,
  orderMode: true,
};

/**
 * Regenerează Product.feedTitle dacă datele produsului s-au schimbat.
 * Întoarce { status: "unchanged" | "generated" | "empty" | "failed" | "missing" }.
 */
export async function refreshFeedTitleIfStale(
  productId,
  { prisma = defaultPrisma, openai = defaultOpenai, now = () => new Date() } = {}
) {
  const product = await prisma.product.findUnique({
    where: { id: String(productId) },
    select: { ...FEED_TITLE_FACT_FIELDS, feedTitle: true, feedTitleInputHash: true },
  });

  if (!product) return { status: "missing" };

  const inputHash = feedTitleInputHash(buildFeedTitleFacts(product));
  if (product.feedTitleInputHash && product.feedTitleInputHash === inputHash) {
    return { status: "unchanged" };
  }

  const sameStore = product.serviceId
    ? await prisma.product.findMany({
        where: { serviceId: product.serviceId, id: { not: product.id } },
        select: FEED_TITLE_FACT_FIELDS,
        take: 200,
      })
    : [];

  const generated = await generateFeedTitle(product, {
    siblings: findSimilarSiblings(product, sameStore),
    openai,
  });

  if (generated.feedTitle) {
    await prisma.product.update({
      where: { id: product.id },
      data: { feedTitle: generated.feedTitle, feedTitleGeneratedAt: now(), feedTitleInputHash: inputHash },
    });
    return { status: "generated", feedTitle: generated.feedTitle };
  }

  // AI-ul a refuzat / titlu invalid pentru ACESTE date: nu reîncercăm până
  // la următoarea modificare (hash salvat). Eroare de rețea / API: hash
  // null -> se reîncearcă la următoarea salvare. În ambele cazuri, feed-ul
  // folosește `title`.
  const deliberate = generated.error === "invalid_title";
  await prisma.product.update({
    where: { id: product.id },
    data: {
      feedTitle: null,
      feedTitleGeneratedAt: deliberate ? now() : null,
      feedTitleInputHash: deliberate ? inputHash : null,
    },
  });

  return { status: deliberate ? "empty" : "failed", error: generated.error };
}

const pendingRefresh = new Map();
export const FEED_TITLE_REFRESH_DELAY_MS = 3000;

/**
 * Programează regenerarea în fundal (fire-and-forget). Salvările rapide
 * succesive ale aceluiași produs se comasează într-o singură generare.
 * Fără OPENAI_API_KEY sau cu FEED_TITLE_AUTOGEN=0 -> nu face nimic.
 */
export function queueFeedTitleRefresh(productId, options = {}) {
  try {
    if (!productId) return false;
    if (process.env.FEED_TITLE_AUTOGEN === "0") return false;
    if (!options.openai && !process.env.OPENAI_API_KEY) return false;

    const id = String(productId);
    clearTimeout(pendingRefresh.get(id));

    const timer = setTimeout(() => {
      pendingRefresh.delete(id);
      refreshFeedTitleIfStale(id, options).catch((error) => {
        console.error("[feed-title] refresh failed", id, error?.message || error);
      });
    }, options.delayMs ?? FEED_TITLE_REFRESH_DELAY_MS);

    timer.unref?.();
    pendingRefresh.set(id, timer);
    return true;
  } catch (error) {
    console.error("[feed-title] queue failed", productId, error?.message || error);
    return false;
  }
}
