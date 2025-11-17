import fetch from "node-fetch";

const ANAF_URL = "https://webservicesp.anaf.ro/PlatitorTvaRest/api/v7/ws/tva";

const iso = (d) => (d ? new Date(d) : null);
const bool = (v) => (v === true || v === "true" || v === 1);

/** Scoate RO și non-cifre */
export function normalizeCui(input = "") {
  return String(input).replace(/^RO/i, "").replace(/\D/g, "");
}

/**
 * Verifică CUI la ANAF (v7).
 * Returnează un obiect „îmbogățit” cu aliasuri standardizate:
 *  - tvaActive (bool|null)
 *  - verifiedAt (ISO)
 *  - source ("anaf" | "ANAF_TEMP_DOWN")
 *  - name, address (aliasuri pentru registeredName/registeredAddress)
 *  - tvaCode (ex: "RO12345678")
 *  + anafName/anafAddress & raw pentru audit/debug
 *
 * Fail-open: dacă ANAF e jos/timeouts, întoarce shape compatibil cu câmpuri null.
 */
export async function verifyCuiAtAnaf(cuiRaw, dateISO = new Date().toISOString().slice(0, 10)) {
  const cui = normalizeCui(cuiRaw);
  const fallback = {
    source: "ANAF_TEMP_DOWN",
    tvaActive: null,
    verifiedAt: new Date().toISOString(),
    name: null,
    address: null,
    tvaCode: cui ? `RO${cui}` : null,
    anafName: null,
    anafAddress: null,
    raw: null,
    // câteva câmpuri extra rămân null în fail-open:
    tvaRegStart: null,
    tvaRegEnd: null,
    inactiv: null,
    inactivFrom: null,
    insolvent: null,
    splitTva: null,
    cui: cui || null,
  };

  if (!cui) return fallback;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const r = await fetch(ANAF_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([{ cui: Number(cui), data: dateISO }]),
      signal: controller.signal,
    });
    if (!r.ok) throw new Error(`ANAF ${r.status}`);

    const arr = await r.json();
    const it = Array.isArray(arr) ? arr[0] : null;

    const dg   = it?.date_generale || it?.dateGenerale || {};
    const tva  = it?.inregistrare_scop_Tva || it?.inregistrareScopTva || {};
    const inact = it?.inactivi || {};
    const insol = it?.stare_in_sistem_insolventa || it?.stareInSistemInsolventa || {};
    const split = it?.inregistrare_RTVAI || it?.inregistrareRTVAI || it?.splitTVA || {};

    const anafName    = dg?.denumire || null;
    const anafAddress = dg?.adresa || null;

    const out = {
      // standard pentru backend-ul tău
      source: "anaf",
      verifiedAt: new Date().toISOString(),
      tvaActive: bool(tva?.scpTva),

      // aliasuri prietenoase cu DB-ul tău
      name: anafName,
      address: anafAddress,
      tvaCode: `RO${cui}`,

      // detalii utile (opționale)
      tvaRegStart: tva?.data_inceput_ScpTva ? iso(tva.data_inceput_ScpTva)?.toISOString() : null,
      tvaRegEnd:   tva?.data_anul_imp_ScpTva ? iso(tva.data_anul_imp_ScpTva)?.toISOString() : null,
      inactiv: bool(inact?.inactiva),
      inactivFrom: inact?.dataInactivare ? iso(inact.dataInactivare)?.toISOString() : null,
      insolvent: bool(insol?.inceputInsolventa) || bool(insol?.insolventa) || false,
      splitTva: bool(split?.aplica) || bool(split?.rtvai) || false,

      // back-compat + debug
      anafName,
      anafAddress,
      raw: it || null,

      // conveniență
      cui: String(cui),
    };

    return out;
  } catch {
    return fallback;
  } finally {
    clearTimeout(timeout);
  }
}
