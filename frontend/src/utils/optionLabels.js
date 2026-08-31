/*
 * Traducere vizuală pentru valorile brute de variantă (culoare etc.)
 * stocate în schema produsului / selectedOptions - ex. "brown_light".
 * NU modifică valoarea reală (folosită în selectedOptions,
 * configurationKey, payload) - doar ce vede clientul.
 */
const OPTION_VALUE_LABELS = {
  white: "Alb",
  black: "Negru",
  brown: "Maro",
  brown_light: "Maro deschis",
  multicolor: "Multicolor",
  red: "Roșu",
  blue: "Albastru",
  light_blue: "Albastru deschis",
  dark_blue: "Albastru închis",
  green: "Verde",
  light_green: "Verde deschis",
  yellow: "Galben",
  pink: "Roz",
  purple: "Mov",
  orange: "Portocaliu",
  beige: "Bej",
  gray: "Gri",
  grey: "Gri",
  gold: "Auriu",
  silver: "Argintiu",
  transparent: "Transparent",
};

export function humanizeOptionValue(raw) {
  if (raw === null || raw === undefined) return "";

  const value = String(raw).trim();
  if (!value) return "";

  const key = value.toLowerCase();
  if (OPTION_VALUE_LABELS[key]) return OPTION_VALUE_LABELS[key];

  return value.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}
