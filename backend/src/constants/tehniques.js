// backend/constants/techniques.js
// Tehnici principale pentru Product.technique

export const TECHNIQUES = [
  "hand_painted",
  "watercolor",
  "acrylic",
  "oil_paint",
  "digital_illustration",
  "calligraphy",
  "lettering",

  "laser_cut",
  "engraving",
  "pyrography",

  "embroidery",
  "cross_stitch",
  "knitting",
  "crochet",
  "macrame",
  "sewing",

  "quilling",
  "decoupage",
  "resin_cast",
  "print_3d",
  "paper_craft",

  "photography",
  "photo_editing",
  "foil_print",
  "letterpress",
];

export const TECHNIQUE_LABELS = {
  hand_painted: "Pictat manual",
  watercolor: "Acuarelă",
  acrylic: "Acrilic",
  oil_paint: "Ulei",
  digital_illustration: "Ilustrație digitală",
  calligraphy: "Caligrafie",
  lettering: "Lettering",

  laser_cut: "Decupaj laser",
  engraving: "Gravură",
  pyrography: "Pirogravură",

  embroidery: "Broderie",
  cross_stitch: "Punct în cruce",
  knitting: "Tricotat",
  crochet: "Croșetat",
  macrame: "Macramé",
  sewing: "Cusut / croitorie",

  quilling: "Quilling",
  decoupage: "Decoupage",
  resin_cast: "Turnare rășină",
  print_3d: "Print 3D",
  paper_craft: "Craft din hârtie",

  photography: "Fotografie",
  photo_editing: "Editare foto",
  foil_print: "Print cu folie",
  letterpress: "Letterpress",
};

export const TECHNIQUE_GROUP_LABELS = {
  painting: "Pictură & ilustrație",
  lettering: "Caligrafie & lettering",
  laser: "Laser & gravură",
  textile: "Textil & fire",
  craft: "Craft & mixed media",
  print: "Print & foto",
};

const GROUP_BY_TECHNIQUE = {
  hand_painted: "painting",
  watercolor: "painting",
  acrylic: "painting",
  oil_paint: "painting",
  digital_illustration: "painting",

  calligraphy: "lettering",
  lettering: "lettering",

  laser_cut: "laser",
  engraving: "laser",
  pyrography: "laser",

  embroidery: "textile",
  cross_stitch: "textile",
  knitting: "textile",
  crochet: "textile",
  macrame: "textile",
  sewing: "textile",

  quilling: "craft",
  decoupage: "craft",
  resin_cast: "craft",
  print_3d: "craft",
  paper_craft: "craft",

  photography: "print",
  photo_editing: "print",
  foil_print: "print",
  letterpress: "print",
};

export const TECHNIQUES_DETAILED = TECHNIQUES.map((key) => {
  const group = GROUP_BY_TECHNIQUE[key] || "craft";
  return {
    key,
    label: TECHNIQUE_LABELS[key] || key,
    group,
    groupLabel: TECHNIQUE_GROUP_LABELS[group] || "Altele",
  };
});

export const TECHNIQUE_SET = new Set(TECHNIQUES);
