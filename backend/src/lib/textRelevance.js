// backend/src/lib/textRelevance.js

/*
 * Normalizare + matching pe TOKENI, generic (nu legat de produse
 * sau de vreun domeniu anume) - extras din
 * vendorAssistantCommandService.js (era acolo sub nume specifice
 * "Product*", deși logica era deja 100% generică) ca să poată fi
 * reutilizat și de knowledgeRetrieval.js (potrivirea întrebării
 * userului cu tags/aliases din manifestele platformei), fără
 * duplicare. Nicio schimbare de comportament față de codul
 * original - doar redenumire + relocare.
 */

/*
 * Diacritice românești -> forma de bază, EXPLICIT (nu doar via
 * NFD) - "ș"/"ț" (comma-below, U+0219/U+021B) nu au descompunere
 * canonică în Unicode, deci String.normalize("NFD") NU le separă
 * de combining mark ca pe ă/â/î. Acoperim și variantele legacy cu
 * sedilă (ş/ţ) folosite uneori în loc de comma-below.
 */
export const ROMANIAN_DIACRITIC_MAP = {
  ă: "a",
  â: "a",
  î: "i",
  ș: "s",
  ş: "s",
  ț: "t",
  ţ: "t",
};

export function normalizeSearchText(value) {
  let text = String(value || "");

  text = text.replace(
    /[ăâîșşțţ]/gi,
    (ch) =>
      ROMANIAN_DIACRITIC_MAP[
        ch.toLowerCase()
      ] || ch
  );

  text = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

  text = text.replace(/[^a-z0-9\s]/g, " ");
  text = text.replace(/\s+/g, " ").trim();

  return text;
}

/*
 * Stem foarte ușor pentru terminații flexionale frecvente
 * (articol hotărât / plural / genitiv-dativ) - "iepurașului" și
 * "iepuraș" trebuie să ajungă la ACEEAȘI formă de bază. Verificăm
 * sufixele MAI LUNGI primele (ex. "ului" înaintea lui "lui"/"ul",
 * ca să nu tăiem doar o parte din terminație), și nu scurtăm sub
 * 3 caractere ca să nu stricăm cuvinte scurte.
 */
export const RO_STEM_SUFFIXES = [
  "ului",
  "lor",
  "lui",
  "ul",
  "a",
  "i",
];

export function stemToken(token) {
  for (const suffix of RO_STEM_SUFFIXES) {
    if (
      token.length - suffix.length >= 3 &&
      token.endsWith(suffix)
    ) {
      return token.slice(
        0,
        token.length - suffix.length
      );
    }
  }

  return token;
}

export function tokenizeSearchText(value) {
  return normalizeSearchText(value)
    .split(" ")
    .filter(Boolean)
    .map(stemToken);
}

/*
 * Distanță Levenshtein (necesară pentru toleranță la mici
 * greșeli de tastare/scriere) - tokenii sunt scurți (cuvinte),
 * deci costul e neglijabil chiar și pe seturi mari.
 */
export function levenshteinDistance(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const prevRow = new Array(b.length + 1);

  for (let j = 0; j <= b.length; j++) {
    prevRow[j] = j;
  }

  for (let i = 1; i <= a.length; i++) {
    let prevDiag = prevRow[0];
    prevRow[0] = i;

    for (let j = 1; j <= b.length; j++) {
      const temp = prevRow[j];

      prevRow[j] = Math.min(
        prevRow[j] + 1,
        prevRow[j - 1] + 1,

        prevDiag +
          (a[i - 1] === b[j - 1] ? 0 : 1)
      );

      prevDiag = temp;
    }
  }

  return prevRow[b.length];
}

/*
 * Scor compus pentru O PERECHE de tokeni (0-3): match exact,
 * prefix/substring, apoi similaritate fuzzy (toleranță la
 * greșeli mici) - 0 dacă nu au nicio legătură.
 */
export function scoreTokenPair(
  queryToken,
  targetToken
) {
  if (queryToken === targetToken) return 3;

  if (
    queryToken.length >= 3 &&
    targetToken.length >= 3
  ) {
    if (
      targetToken.startsWith(queryToken) ||
      queryToken.startsWith(targetToken)
    ) {
      return 2.5;
    }

    if (
      targetToken.includes(queryToken) ||
      queryToken.includes(targetToken)
    ) {
      return 2;
    }
  }

  const maxLen = Math.max(
    queryToken.length,
    targetToken.length
  );

  if (maxLen >= 3) {
    const distance = levenshteinDistance(
      queryToken,
      targetToken
    );

    const tolerance = Math.max(
      1,
      Math.floor(maxLen * 0.3)
    );

    if (distance <= tolerance) return 1;
  }

  return 0;
}

/*
 * Scor compus pentru text-țintă vs query - matching pe TOKENI, nu
 * pe string complet (ex. query "iepuras plusat" trebuie să
 * găsească "Iepuraș plușat croșetat manual...", chiar dacă șirul
 * complet nu apare ca substring exact; sau query "cum schimb
 * prețul" trebuie să găsească un manifest cu tag-ul "preț").
 * Media scorurilor per-token e împărțită la NUMĂRUL de tokeni din
 * query, deci un query cu un singur token nepotrivit din mai
 * multe e penalizat automat (fără bonus de acoperire completă);
 * un text FĂRĂ niciun token relevant primește scor 0.
 */
export function scoreTextMatch(target, query) {
  const queryTokens =
    tokenizeSearchText(query);

  const targetTokens =
    tokenizeSearchText(target);

  if (
    !queryTokens.length ||
    !targetTokens.length
  ) {
    return 0;
  }

  let scoreSum = 0;
  let matchedTokenCount = 0;

  for (const queryToken of queryTokens) {
    let bestTokenScore = 0;

    for (const targetToken of targetTokens) {
      const pairScore = scoreTokenPair(
        queryToken,
        targetToken
      );

      if (pairScore > bestTokenScore) {
        bestTokenScore = pairScore;
      }
    }

    if (bestTokenScore > 0) {
      matchedTokenCount += 1;
    }

    scoreSum += bestTokenScore;
  }

  if (matchedTokenCount === 0) return 0;

  const average = scoreSum / queryTokens.length;

  const fullCoverageBonus =
    matchedTokenCount === queryTokens.length
      ? 1
      : 0;

  return average + fullCoverageBonus;
}
