// backend/src/lib/configurationKey.js
//
// Cheia de configurație a unui produs (opțiuni + personalizare), folosită
// identic de coș (CartItem.configurationKey), comenzi (ShipmentItem) și
// inventarul Târgului Artfest (ArtfestFairInventoryItem.variantKey).
// Mutată 1:1 din routes/cartRoutes.js - NU schimba algoritmul: cheile
// existente din DB depind de el.

import crypto from "node:crypto";

export function normalizeCartData(value) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value)
      .map(([key, itemValue]) => [
        String(key || "").trim(),
        typeof itemValue === "string"
          ? itemValue.trim()
          : itemValue,
      ])
      .filter(([key, itemValue]) => {
        if (!key) {
          return false;
        }

        if (
          itemValue === undefined ||
          itemValue === null
        ) {
          return false;
        }

        if (
          typeof itemValue === "string" &&
          itemValue.length === 0
        ) {
          return false;
        }

        return true;
      })
      /*
       * Sortare deterministă pe cheie - altfel JSON.stringify (folosit
       * de buildConfigurationKey mai jos) păstrează ordinea de
       * inserare primită de la client, iar {color,size} vs {size,color}
       * (aceeași configurație, ordine diferită) ar produce hash-uri
       * diferite -> aceeași personalizare ar putea fi tratată ca 2
       * linii distincte în coș.
       */
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  );
}

export function buildConfigurationKey(
  selectedOptions = {},
  customAnswers = {},
  repeatedGroupAnswers = {}
) {
  const normalized = JSON.stringify({
    selectedOptions:
      normalizeCartData(
        selectedOptions
      ),

    customAnswers:
      normalizeCartData(
        customAnswers
      ),

    repeatedGroupAnswers:
      normalizeCartData(
        repeatedGroupAnswers
      ),
  });

  return crypto
    .createHash("sha256")
    .update(normalized)
    .digest("hex");
}
