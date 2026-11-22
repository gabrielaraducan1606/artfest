// src/pages/Vendor/Fair/fairInventoryErrors.js
//
// Mesajele de eroare din inventarul târgului (FairInventorySection), pentru
// vânzător, în română. Mesajul serverului se păstrează când există; un cod
// tehnic („server_error”, „Request failed (502)”, „Failed to fetch”) nu ajunge
// niciodată pe ecran.
//
// Fără răspuns / 5xx fără mesaj = rezultat NECUNOSCUT (salvarea poate fi
// reușit). Nu spunem că nu s-a salvat; reîncercarea e sigură:
//   - produs manual: același clientRequestId -> serverul întoarce linia existentă;
//   - produs din magazin: a doua adăugare primește „deja în inventar” (409);
//   - editare: aceleași valori aplicate din nou nu schimbă nimic.

const NO_ANSWER_STATUSES = new Set([408, 500, 502, 503, 504]);

/** Text care e doar un cod tehnic / mesaj de rețea al browserului. */
export function isTechnicalMessage(text) {
  const value = String(text ?? "").trim();
  if (!value) return true;
  if (/^[a-z0-9_.:-]+$/i.test(value)) return true; // server_error, upload_failed
  return /Request failed|Failed to fetch|NetworkError|Load failed|<html|<!doctype/i.test(value);
}

const MESSAGES = {
  save: (code) =>
    `Nu am primit confirmarea salvării${code}. Produsul poate fi deja salvat. Apasă din nou pe salvare: dacă a fost salvat, nu se adaugă a doua oară.`,
  load: (code) => `Nu am putut încărca inventarul${code}. Reîncarcă pagina peste câteva momente.`,
  action: (code) =>
    `Nu am primit confirmarea operației${code}. Reîncarcă pagina și verifică inventarul înainte să o repeți.`,
};

/**
 * @param {any} err eroarea din api() (status + data) sau o eroare de rețea
 * @param {string} fallback mesajul existent al formularului
 * @param {{ action?: "save" | "load" | "action" }} [options]
 */
export function inventoryErrorMessage(err, fallback, { action = "action" } = {}) {
  const status = Number(err?.status) || 0;
  const serverMessage = err?.data?.message;
  if (serverMessage && !isTechnicalMessage(serverMessage)) return String(serverMessage);

  // eroare locală, fără cerere HTTP (ex. validare în browser): textul ei e deja pentru vânzător
  if (!status && !(err instanceof TypeError) && err?.message && !isTechnicalMessage(err.message)) {
    return String(err.message);
  }

  if (!status || NO_ANSWER_STATUSES.has(status)) {
    const code = status ? ` (cod ${status})` : "";
    return (MESSAGES[action] || MESSAGES.action)(code);
  }

  const message = err?.message;
  if (message && !isTechnicalMessage(message)) return String(message);
  return fallback;
}
