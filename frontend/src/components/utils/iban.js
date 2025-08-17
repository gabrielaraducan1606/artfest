// src/utils/iban.js
export function isValidROIBAN(iban) {
  const raw = String(iban).replace(/\s+/g,'').toUpperCase();
  if (!/^RO\d{2}[A-Z]{4}[0-9A-Z]{16}$/.test(raw)) return false;
  const rearr = raw.slice(4) + raw.slice(0,4);
  const numeric = rearr.replace(/[A-Z]/g, ch => (ch.charCodeAt(0) - 55).toString());
  let rem = 0;
  for (const chunk of numeric.match(/.{1,9}/g)) {
    rem = Number(String(rem) + chunk) % 97;
  }
  return rem === 1;
}
