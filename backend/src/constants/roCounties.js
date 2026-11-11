// backend/src/constants/roCounties.js
//
// Județele României (ISO 3166-2:RO) - codul folosit de checkout în adresă
// (shippingAddress.county) + denumirea. Sursă unică pentru /api/geo/ro/counties
// și pentru asocierea cu nomenclatorul Sameday (după denumire, fără diacritice).

// 41 județe + Municipiul București (ISO 3166-2:RO)
export const RO_COUNTIES = Object.freeze([
  { code: "AB", name: "Alba" },
  { code: "AR", name: "Arad" },
  { code: "AG", name: "Argeș" },
  { code: "BC", name: "Bacău" },
  { code: "BH", name: "Bihor" },
  { code: "BN", name: "Bistrița-Năsăud" },
  { code: "BT", name: "Botoșani" },
  { code: "BR", name: "Brăila" },
  { code: "BV", name: "Brașov" },
  { code: "B",  name: "București" },
  { code: "BZ", name: "Buzău" },
  { code: "CS", name: "Caraș-Severin" },
  { code: "CL", name: "Călărași" },
  { code: "CJ", name: "Cluj" },
  { code: "CT", name: "Constanța" },
  { code: "CV", name: "Covasna" },
  { code: "DB", name: "Dâmbovița" },
  { code: "DJ", name: "Dolj" },
  { code: "GL", name: "Galați" },
  { code: "GR", name: "Giurgiu" },
  { code: "GJ", name: "Gorj" },
  { code: "HR", name: "Harghita" },
  { code: "HD", name: "Hunedoara" },
  { code: "IL", name: "Ialomița" },
  { code: "IS", name: "Iași" },
  { code: "IF", name: "Ilfov" },
  { code: "MM", name: "Maramureș" },
  { code: "MH", name: "Mehedinți" },
  { code: "MS", name: "Mureș" },
  { code: "NT", name: "Neamț" },
  { code: "OT", name: "Olt" },
  { code: "PH", name: "Prahova" },
  { code: "SM", name: "Satu Mare" },
  { code: "SJ", name: "Sălaj" },
  { code: "SB", name: "Sibiu" },
  { code: "SV", name: "Suceava" },
  { code: "TR", name: "Teleorman" },
  { code: "TM", name: "Timiș" },
  { code: "TL", name: "Tulcea" },
  { code: "VS", name: "Vaslui" },
  { code: "VL", name: "Vâlcea" },
  { code: "VN", name: "Vrancea" },
]);

const fold = (v) =>
  String(v || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/^(judetul|municipiul)\s+/, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** Județul după cod („CJ”) sau după denumire („Cluj”, „Județul Cluj”); null dacă nu există. */
export function findRoCounty(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const byCode = RO_COUNTIES.find((c) => c.code === raw.toUpperCase());
  if (byCode) return byCode;
  const key = fold(raw);
  return RO_COUNTIES.find((c) => fold(c.name) === key) || null;
}

export { fold as foldCountyName };
