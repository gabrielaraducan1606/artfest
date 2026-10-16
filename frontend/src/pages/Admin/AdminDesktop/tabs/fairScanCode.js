// src/pages/Admin/AdminDesktop/tabs/fairScanCode.js
//
// Codul de pe eticheta Târgului Artfest, citit din QR (camera telefonului).
// QR-ul conține EXACT identificatorul din codul de bare (ex. AF7K3M9QXT), deci
// rezultatul merge prin același flux ca scannerul USB / câmpul de scanare.
// Fără React - testabil cu node --test.

// AF + 8 caractere din alfabetul codurilor de târg (fără 0/O, 1/I/L, U, Y/Z)
const FAIR_CODE_RE = /^AF[23456789ABCDEFGHJKMNPQRSTVWX]{8}$/;

/*
 * Întoarce { ok: true, code } sau { ok: false, reason }:
 *   empty   - QR gol / ilizibil;
 *   not_af  - QR valid, dar nu e un cod Artfest (ex. un link);
 *   invalid - începe cu AF, dar nu are formatul unui cod de târg.
 */
export function extractFairCode(raw) {
  const text = String(raw ?? "").trim();
  if (!text) return { ok: false, reason: "empty" };
  const normalized = text.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!normalized.startsWith("AF")) return { ok: false, reason: "not_af" };
  if (!FAIR_CODE_RE.test(normalized)) return { ok: false, reason: "invalid" };
  return { ok: true, code: normalized };
}

export const SCAN_MESSAGES = Object.freeze({
  empty: "Codul QR nu a putut fi citit. Apropie telefonul de etichetă.",
  not_af: "Codul QR nu este o etichetă Artfest (trebuie să înceapă cu AF).",
  invalid: "Codul QR nu are formatul unei etichete Artfest.",
  denied: "Accesul la cameră a fost refuzat. Permite camera din setările browserului sau folosește câmpul de scanare.",
  no_camera: "Nu am găsit nicio cameră pe acest dispozitiv.",
  insecure: "Camera funcționează doar pe o conexiune securizată (HTTPS).",
  unavailable: "Camera nu poate fi pornită acum (poate e folosită de altă aplicație).",
  load_failed: "Scannerul nu s-a putut încărca. Reîncarcă pagina și încearcă din nou.",
});

// eroarea de la getUserMedia / scanner -> mesaj clar
export function cameraErrorReason(error, { secure = true } = {}) {
  if (!secure) return "insecure";
  // modulul scannerului nu s-a încărcat (ex. versiune nouă după deploy)
  if (/dynamically imported module|Importing a module script failed|Failed to fetch/i.test(String(error?.message || ""))) {
    return "load_failed";
  }
  const name = String(error?.name || error || "");
  if (/NotAllowed|Permission|denied/i.test(name)) return "denied";
  if (/NotFound|no camera|Overconstrained|DevicesNotFound/i.test(name)) return "no_camera";
  return "unavailable";
}

/*
 * Anti-dublare: același cod citit din nou în fereastra dată (camera citește
 * același QR de mai multe ori pe secundă) nu se trimite a doua oară.
 */
export function createScanDeduper(windowMs = 4000, now = () => Date.now()) {
  let last = { code: null, at: 0 };
  return (code) => {
    const t = now();
    if (code === last.code && t - last.at < windowMs) return false;
    last = { code, at: t };
    return true;
  };
}
