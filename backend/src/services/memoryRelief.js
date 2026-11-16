// backend/src/services/memoryRelief.js
//
// Registru MIC (fără dependențe) pentru „eliberează memorie dacă se poate”,
// folosit de protecția de memorie a uploadurilor (uploadMemoryGuard.js) pe
// instanța Render de 512 MB.
//
// Exemplu: Chrome-ul partajat pentru PDF-uri (lib/pdfBrowser.js) rămâne deschis
// 2 minute după ultimul PDF și ține ~100-250 MB. Dacă un vânzător încarcă o
// fotografie exact atunci, protecția ar refuza-o (503) deși Chrome nu face
// nimic. pdfBrowser se înregistrează aici la prima pornire, iar uploadul îi
// cere să se închidă DOAR dacă e inactiv (fără pagini în lucru sau la rând).
//
// Registrul nu importă puppeteer: dacă Chrome nu a pornit niciodată, nu e
// nimic de eliberat și nu încărcăm module în plus.

const reliefs = new Map();

/** @param {string} name  @param {() => Promise<boolean>|boolean} fn  true = a eliberat ceva */
export function registerMemoryRelief(name, fn) {
  reliefs.set(String(name), fn);
}

/** Teste. */
export function __clearMemoryReliefs() {
  reliefs.clear();
}

/**
 * Cere tuturor sursele înregistrate să elibereze memoria nefolosită.
 * Fără excepții. @returns {Promise<string[]>} numele celor care au eliberat ceva
 */
export async function relieveMemory() {
  const released = [];
  for (const [name, fn] of reliefs) {
    try {
      if (await fn()) released.push(name);
    } catch {
      /* o sursă care eșuează nu blochează uploadul */
    }
  }
  return released;
}
