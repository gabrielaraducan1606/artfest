// backend/constants/materials.js
// Materiale principale pentru Product.materialMain

export const MATERIALS = [
  // Ceară / lumânări
  "wax_soy",
  "wax_paraffin",
  "wax_rapeseed",
  "wax_beeswax",

  // Lemn
  "wood_soft",
  "wood_hard",
  "wood_plywood",
  "wood_mdf",

  // Ceramică / lut
  "ceramic",
  "clay_airdry",
  "clay_polymer",
  "porcelain",

  // Sticlă
  "glass_clear",
  "glass_colored",

  // Hârtie / carton
  "paper",
  "cardboard",
  "paper_handmade",

  // Textile
  "fabric_cotton",
  "fabric_linen",
  "fabric_velvet",
  "fabric_satin",
  "fabric_tulle",

  // Fire / yarn
  "yarn_cotton",
  "yarn_wool",
  "yarn_acrylic",

  // Rășină / compozite
  "resin_epoxy",
  "concrete",
  "plaster",

  // Metal
  "metal_brass",
  "metal_steel",
  "metal_silver",
  "metal_gold_plated",

  // Piele
  "leather_natural",
  "leather_vegan",

  // Food
  "food_cookies",
  "food_chocolate",
  "food_candy",
];

export const MATERIAL_LABELS = {
  wax_soy: "Ceară de soia",
  wax_paraffin: "Ceară de parafină",
  wax_rapeseed: "Ceară de rapiță",
  wax_beeswax: "Ceară de albine",

  wood_soft: "Lemn moale",
  wood_hard: "Lemn tare",
  wood_plywood: "Placaj",
  wood_mdf: "MDF",

  ceramic: "Ceramică",
  clay_airdry: "Lut cu uscare la aer",
  clay_polymer: "Lut polimeric",
  porcelain: "Porțelan",

  glass_clear: "Sticlă transparentă",
  glass_colored: "Sticlă colorată",

  paper: "Hârtie",
  cardboard: "Carton",
  paper_handmade: "Hârtie hand-made",

  fabric_cotton: "Bumbac",
  fabric_linen: "In",
  fabric_velvet: "Catifea",
  fabric_satin: "Satin",
  fabric_tulle: "Tull",

  yarn_cotton: "Fir bumbac",
  yarn_wool: "Fir lână",
  yarn_acrylic: "Fir acrilic",

  resin_epoxy: "Rășină epoxidică",
  concrete: "Beton decorativ",
  plaster: "Ipsos / ghips",

  metal_brass: "Alamă",
  metal_steel: "Oțel",
  metal_silver: "Argint",
  metal_gold_plated: "Placat cu aur",

  leather_natural: "Piele naturală",
  leather_vegan: "Piele vegană",

  food_cookies: "Biscuiți / cookies",
  food_chocolate: "Ciocolată",
  food_candy: "Dulciuri / bomboane",
};

export const MATERIAL_GROUP_LABELS = {
  wax: "Ceară & lumânări",
  wood: "Lemn",
  ceramic: "Ceramică & lut",
  glass: "Sticlă",
  paper: "Hârtie & carton",
  textile: "Textile",
  yarn: "Fire & yarn",
  resin: "Rășină & compozite",
  metal: "Metal",
  leather: "Piele",
  food: "Produse alimentare",
};

const GROUP_BY_MATERIAL = {
  wax_soy: "wax",
  wax_paraffin: "wax",
  wax_rapeseed: "wax",
  wax_beeswax: "wax",

  wood_soft: "wood",
  wood_hard: "wood",
  wood_plywood: "wood",
  wood_mdf: "wood",

  ceramic: "ceramic",
  clay_airdry: "ceramic",
  clay_polymer: "ceramic",
  porcelain: "ceramic",

  glass_clear: "glass",
  glass_colored: "glass",

  paper: "paper",
  cardboard: "paper",
  paper_handmade: "paper",

  fabric_cotton: "textile",
  fabric_linen: "textile",
  fabric_velvet: "textile",
  fabric_satin: "textile",
  fabric_tulle: "textile",

  yarn_cotton: "yarn",
  yarn_wool: "yarn",
  yarn_acrylic: "yarn",

  resin_epoxy: "resin",
  concrete: "resin",
  plaster: "resin",

  metal_brass: "metal",
  metal_steel: "metal",
  metal_silver: "metal",
  metal_gold_plated: "metal",

  leather_natural: "leather",
  leather_vegan: "leather",

  food_cookies: "food",
  food_chocolate: "food",
  food_candy: "food",
};

export const MATERIALS_DETAILED = MATERIALS.map((key) => {
  const group = GROUP_BY_MATERIAL[key] || "other";
  return {
    key,
    label: MATERIAL_LABELS[key] || key,
    group,
    groupLabel: MATERIAL_GROUP_LABELS[group] || "Altele",
  };
});

export const MATERIAL_SET = new Set(MATERIALS);
