// src/pages/Checkout/checkoutForm.js
//
// Logica pură a formularului de checkout (fără React) - testată în
// checkoutForm.test.js. Audit conversii 2026-10-14:
//   - telefon: +40 / 0040 din autocompletarea mobilă nu mai e trunchiat
//     într-un număr greșit ("4071234567");
//   - județ: textul tastat e potrivit automat cu un județ, iar lista are
//     fallback local dacă /api/geo/ro/counties nu răspunde;
//   - recuperare după eșecul inițierii plății CARD (comanda există deja).

/* =========================================================
   Telefon
========================================================= */

// Aceeași logică există în backend (src/lib/phoneRo.js).
export function normalizeRoPhone(value = "") {
  const raw = String(value ?? "").trim();
  let digits = raw.replace(/\D/g, "");

  if (!digits) return "";

  let international = raw.startsWith("+");

  if (digits.startsWith("00")) {
    digits = digits.slice(2);
    international = true;
  }

  if (
    digits.startsWith("40") &&
    (international || digits.length === 11)
  ) {
    const national = digits.slice(2);
    return national.startsWith("0") ? national : `0${national}`;
  }

  return digits;
}

export function isValidRoPhone(value = "") {
  return /^0\d{9}$/.test(normalizeRoPhone(value));
}

/*
 * Ce păstrăm în câmp cât timp utilizatorul tastează: cifre și
 * separatorii obișnuiți (+, spații, paranteze, cratimă, punct). Nu
 * normalizăm la fiecare tastă - "+4" ar deveni "4" și "+40" n-ar mai
 * putea fi tastat. Normalizarea se face la blur și la trimitere.
 */
export function sanitizePhoneInput(value = "") {
  return String(value ?? "")
    .replace(/[^\d+()\-.\s]/g, "")
    .slice(0, 20);
}

/* =========================================================
   Județe
========================================================= */

// Copie locală a listei din backend (src/routes/geoRoutes.js), folosită
// doar dacă /api/geo/ro/counties nu răspunde - fără ea, județul nu mai
// poate fi ales și comanda nu poate fi plasată.
export const RO_COUNTIES_FALLBACK = [
  { code: "AB", name: "Alba" },
  { code: "AR", name: "Arad" },
  { code: "AG", name: "Argeș" },
  { code: "BC", name: "Bacău" },
  { code: "BH", name: "Bihor" },
  { code: "BN", name: "Bistrița-Năsăud" },
  { code: "BT", name: "Botoșani" },
  { code: "BR", name: "Brăila" },
  { code: "BV", name: "Brașov" },
  { code: "B", name: "București" },
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
].sort((a, b) => a.name.localeCompare(b.name, "ro"));

export function normalizeCountyName(value = "") {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[-_.,]/g, " ")
    .replace(/^\s*(judetul|judet|jud)\s+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

const BUCHAREST_ALIASES = new Set([
  "bucuresti",
  "municipiul bucuresti",
  "mun bucuresti",
  "bucharest",
  "sector 1",
  "sector 2",
  "sector 3",
  "sector 4",
  "sector 5",
  "sector 6",
]);

/*
 * Potrivește textul tastat cu un județ: nume (fără diacritice, fără
 * „Județul”), cod („CJ”, „B”), alias București sau un prefix NEAMBIGUU
 * de minim 3 litere („Consta” -> Constanța; „Bra” rămâne ambiguu între
 * Brăila și Brașov). Întoarce județul sau null.
 */
export function matchCounty(input, counties = RO_COUNTIES_FALLBACK) {
  const list = Array.isArray(counties) && counties.length
    ? counties
    : RO_COUNTIES_FALLBACK;

  const raw = String(input ?? "").trim();
  if (!raw) return null;

  const q = normalizeCountyName(raw);
  if (!q) return null;

  const byCode = list.find(
    (c) => String(c.code).toLowerCase() === q.replace(/\s/g, "")
  );
  if (byCode && q.length <= 2) return byCode;

  const exact = list.find((c) => normalizeCountyName(c.name) === q);
  if (exact) return exact;

  if (BUCHAREST_ALIASES.has(q)) {
    return list.find((c) => c.code === "B") || null;
  }

  if (q.length >= 3) {
    const prefixed = list.filter((c) =>
      normalizeCountyName(c.name).startsWith(q)
    );
    if (prefixed.length === 1) return prefixed[0];
  }

  return null;
}

/* Filtrare pentru lista derulantă (diacritice opționale). */
export function filterCounties(counties, input) {
  const list = [...(counties || [])].sort((a, b) =>
    a.name.localeCompare(b.name, "ro")
  );
  const q = normalizeCountyName(input);
  if (!q) return list;

  return list.filter(
    (c) =>
      normalizeCountyName(c.name).includes(q) ||
      String(c.code).toLowerCase() === q
  );
}

/* =========================================================
   Recuperare după eșecul plății
========================================================= */

/*
 * Erorile pentru care comanda A FOST creată, dar plata cu cardul nu a
 * putut fi inițiată (Stripe indisponibil, configurare lipsă, vendor
 * care și-a pierdut Stripe între verificare și plată). Backend-ul
 * întoarce orderId (+ guestAccessToken pentru guest). Clientul trebuie
 * dus la pagina comenzii, unde poate relua plata („Achită acum”) -
 * altfel reîncercarea din checkout dă „Coșul este gol” (user) sau
 * creează o comandă duplicat (guest).
 */
export function getPaymentRecoveryPath(error) {
  const data = error?.data || null;
  const orderId = data?.orderId ? String(data.orderId) : "";

  if (!orderId) return null;

  const id = encodeURIComponent(orderId);

  if (data.guestAccessToken) {
    return `/comanda-guest/${id}?token=${encodeURIComponent(
      data.guestAccessToken
    )}&payment=failed`;
  }

  return `/comanda/${id}?payment=failed`;
}

/*
 * Vendorul nu (mai) are Stripe activ - eroare întoarsă ÎNAINTE de
 * crearea comenzii (coșul e intact). Checkout-ul trece pe ramburs.
 */
export function isCardUnavailableError(error) {
  const code = error?.data?.error || error?.code || "";
  return (
    !error?.data?.orderId &&
    (code === "vendor_stripe_not_active" || code === "vendor_not_found")
  );
}
