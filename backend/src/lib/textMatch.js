// backend/src/lib/textMatch.js

/**
 * Matching determinist de text (NU implică LLM-ul), reutilizat de:
 * - analiza componentelor din fotografie (vendorCostProfitAiRoutes.js);
 * - comenzile conversaționale de administrare costuri
 *   (vendorAssistantCommandService.js) - identificarea unui
 *   VendorCostItem sau produs după un nume spus liber.
 */

export function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

function levenshteinDistance(a, b) {
  const m = a.length;
  const n = b.length;

  if (!m) return n;
  if (!n) return m;

  const previousRow = Array.from(
    { length: n + 1 },
    (_, index) => index
  );

  for (let i = 1; i <= m; i += 1) {
    const currentRow = [i];

    for (let j = 1; j <= n; j += 1) {
      const substitutionCost =
        a[i - 1] === b[j - 1] ? 0 : 1;

      currentRow[j] = Math.min(
        previousRow[j] + 1,
        currentRow[j - 1] + 1,
        previousRow[j - 1] + substitutionCost
      );
    }

    for (let j = 0; j <= n; j += 1) {
      previousRow[j] = currentRow[j];
    }
  }

  return previousRow[n];
}

export function textSimilarity(a, b) {
  const normalizedA = normalizeText(a);
  const normalizedB = normalizeText(b);

  if (!normalizedA || !normalizedB) {
    return 0;
  }

  if (normalizedA === normalizedB) {
    return 1;
  }

  if (
    normalizedA.includes(normalizedB) ||
    normalizedB.includes(normalizedA)
  ) {
    return 0.85;
  }

  const distance = levenshteinDistance(
    normalizedA,
    normalizedB
  );

  const maxLength = Math.max(
    normalizedA.length,
    normalizedB.length
  );

  return maxLength
    ? 1 - distance / maxLength
    : 0;
}

export const DEFAULT_MATCH_THRESHOLD = 0.72;

/**
 * Întoarce toate elementele din `items` a căror `nameField`
 * se potrivește cu `label` peste prag, sortate descrescător
 * după scor. Util pentru dezambiguizare (mai multe potriviri
 * posibile), nu doar cea mai bună.
 */
export function findMatchingItems(
  label,
  items,
  {
    nameField = "name",
    threshold = DEFAULT_MATCH_THRESHOLD,
  } = {}
) {
  return items
    .map((item) => ({
      item,
      score: textSimilarity(
        label,
        item[nameField]
      ),
    }))
    .filter(({ score }) => score >= threshold)
    .sort((a, b) => b.score - a.score);
}

export function findBestMatch(
  label,
  items,
  options = {}
) {
  const matches = findMatchingItems(
    label,
    items,
    options
  );

  return matches.length ? matches[0].item : null;
}
