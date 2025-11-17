// backend/constants/colors.js
// Paletă de culori standard pentru Product.color
// în DB salvăm cheile (slug-uri), în UI afișăm label-urile frumoase.

export const COLORS = [
  // Neutre
  "white",
  "ivory",
  "cream",
  "beige",
  "grey_light",
  "grey_dark",
  "black",

  // Maro / pământii
  "brown_light",
  "brown",
  "brown_dark",
  "taupe",

  // Roșu / roz
  "red",
  "burgundy",
  "pink_light",
  "pink_dusty",
  "pink_hot",

  // Mov / lila
  "lilac",
  "purple",

  // Galben / portocaliu
  "yellow",
  "mustard",
  "orange",
  "peach",

  // Albastru
  "blue_light",
  "blue",
  "blue_royal",
  "navy",
  "turquoise",
  "teal",

  // Verde
  "green_light",
  "green",
  "green_olive",
  "green_dark",
  "mint",

  // Metalice / speciale
  "gold",
  "rose_gold",
  "silver",
  "copper",
  "transparent",
  "multicolor",
];

export const COLOR_LABELS = {
  // Neutre
  white: "Alb",
  ivory: "Ivory / ivoire",
  cream: "Crem",
  beige: "Bej",
  grey_light: "Gri deschis",
  grey_dark: "Gri închis",
  black: "Negru",

  // Maro
  brown_light: "Maro deschis",
  brown: "Maro",
  brown_dark: "Maro închis",
  taupe: "Taupe",

  // Roșu / roz
  red: "Roșu",
  burgundy: "Burgundy / vișiniu",
  pink_light: "Roz deschis",
  pink_dusty: "Roz pudră",
  pink_hot: "Roz aprins",

  // Mov
  lilac: "Lila",
  purple: "Mov",

  // Galben / portocaliu
  yellow: "Galben",
  mustard: "Muștar",
  orange: "Portocaliu",
  peach: "Pișcă / piersică",

  // Albastru
  blue_light: "Albastru deschis",
  blue: "Albastru",
  blue_royal: "Albastru regal",
  navy: "Bleumarin",
  turquoise: "Turcoaz",
  teal: "Teal",

  // Verde
  green_light: "Verde deschis",
  green: "Verde",
  green_olive: "Verde olive",
  green_dark: "Verde închis",
  mint: "Mentă",

  // Metalice / speciale
  gold: "Auriu",
  rose_gold: "Rose gold",
  silver: "Argintiu",
  copper: "Cupru",
  transparent: "Transparent",
  multicolor: "Multicolor",
};

// grupuri pentru UI (filtre)
export const COLOR_GROUP_LABELS = {
  neutrals: "Neutre",
  browns: "Maro & pământii",
  reds_pinks: "Roșu & roz",
  purples: "Mov & lila",
  yellows_oranges: "Galben & portocaliu",
  blues: "Albastru",
  greens: "Verde",
  metallics: "Metalice & speciale",
};

const GROUP_BY_COLOR = {
  white: "neutrals",
  ivory: "neutrals",
  cream: "neutrals",
  beige: "neutrals",
  grey_light: "neutrals",
  grey_dark: "neutrals",
  black: "neutrals",

  brown_light: "browns",
  brown: "browns",
  brown_dark: "browns",
  taupe: "browns",

  red: "reds_pinks",
  burgundy: "reds_pinks",
  pink_light: "reds_pinks",
  pink_dusty: "reds_pinks",
  pink_hot: "reds_pinks",

  lilac: "purples",
  purple: "purples",

  yellow: "yellows_oranges",
  mustard: "yellows_oranges",
  orange: "yellows_oranges",
  peach: "yellows_oranges",

  blue_light: "blues",
  blue: "blues",
  blue_royal: "blues",
  navy: "blues",
  turquoise: "blues",
  teal: "blues",

  green_light: "greens",
  green: "greens",
  green_olive: "greens",
  green_dark: "greens",
  mint: "greens",

  gold: "metallics",
  rose_gold: "metallics",
  silver: "metallics",
  copper: "metallics",
  transparent: "metallics",
  multicolor: "metallics",
};

export const COLORS_DETAILED = COLORS.map((key) => {
  const group = GROUP_BY_COLOR[key] || "metallics";
  return {
    key,
    label: COLOR_LABELS[key] || key,
    group,
    groupLabel: COLOR_GROUP_LABELS[group] || "Altele",
  };
});

export const COLOR_SET = new Set(COLORS);
