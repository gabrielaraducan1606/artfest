// src/lib/phoneRo.js
//
// Normalizarea numerelor de telefon românești la formatul național
// (10 cifre, cu 0 în față: 07xxxxxxxx / 02xxxxxxxx / 03xxxxxxxx).
//
// Acceptă formatele frecvente din autocompletarea de pe mobil:
//   +40 712 345 678, 0040712345678, 40712345678, +40 (0)712 345 678
//
// NU mai trunchiem la 10 cifre: "+40712345678" trunchiat devenea
// "4071234567" - un număr valid ca format, dar greșit (curierul nu putea
// suna clientul). Un număr care nu se poate normaliza rămâne cu cifrele
// lui și pică validarea, în loc să fie corupt în tăcere.
// Aceeași logică există în frontend (pages/Checkout/checkoutForm.js).

export function normalizeRoPhone(value = "") {
  const raw = String(value ?? "").trim();
  let digits = raw.replace(/\D/g, "");

  if (!digits) return "";

  let international = raw.startsWith("+");

  if (digits.startsWith("00")) {
    digits = digits.slice(2);
    international = true;
  }

  // prefixul de țară 40 - doar când e clar internațional
  // (+40 / 0040) sau când lungimea arată un număr cu prefix (40 + 9 cifre)
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
