import fetch from "node-fetch";

const ANAF_URL = "https://webservicesp.anaf.ro/PlatitorTvaRest/api/v7/ws/tva";

const iso = (d) => (d ? new Date(d) : null);
const bool = (v) => v === true || v === "true" || v === 1;

/** Scoate RO și non-cifre */
export function normalizeCui(input = "") {
  return String(input).replace(/^RO/i, "").replace(/\D/g, "");
}

/**
 * Verifică CUI la ANAF (v7).
 * Răspunsul ANAF este de forma: { cod, message, found: [...], notFound: [...] }
 *
 * Returnează un obiect „îmbogățit” cu aliasuri standardizate:
 *  - tvaActive (bool|null)
 *  - verifiedAt (ISO)
 *  - source ("anaf" | "ANAF_TEMP_DOWN")
 *  - name, address
 *  - tvaCode (ex: "RO12345678")
 *  + anafName/anafAddress & raw
 *
 * Fail-open: dacă ANAF e jos/timeouts, întoarce shape compatibil cu câmpuri null.
 */
export async function verifyCuiAtAnaf(
  cuiRaw,
  dateISO = new Date().toISOString().slice(0, 10)
) {
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

    if (!r.ok) throw new Error(`ANAF HTTP ${r.status}`);

    const data = await r.json();

    // ✅ ANAF v7: { cod: 200, message: "SUCCESS", found: [...], notFound: [...] }
    if (!data || data.cod !== 200) throw new Error(`ANAF COD ${data?.cod}`);

    const it = Array.isArray(data.found) ? data.found[0] : null;

    // dacă nu e în found, îl tratăm ca „negăsit” => TVA false
    if (!it) {
      return {
        ...fallback,
        source: "anaf",
        verifiedAt: new Date().toISOString(),
        tvaActive: false,
        raw: data,
      };
    }

    const dg = it?.date_generale || {};
    const tva = it?.inregistrare_scop_Tva || {};
    const inact = it?.stare_inactiv || {};
    const insol = it?.stare_in_sistem_insolventa || {};
    const split = it?.inregistrare_SplitTVA || {};

    const anafName = dg?.denumire ?? null;
    const anafAddress = dg?.adresa ?? null;

    return {
      source: "anaf",
      verifiedAt: new Date().toISOString(),

      // ✅ cheie corectă: scpTVA
      tvaActive: bool(tva?.scpTVA),

      name: anafName,
      address: anafAddress,
      tvaCode: `RO${cui}`,

      // perioade TVA (dacă există)
      tvaRegStart: tva?.perioade_TVA?.data_inceput_ScpTVA
        ? iso(tva.perioade_TVA.data_inceput_ScpTVA)?.toISOString()
        : null,
      tvaRegEnd: tva?.perioade_TVA?.data_sfarsit_ScpTVA
        ? iso(tva.perioade_TVA.data_sfarsit_ScpTVA)?.toISOString()
        : null,

      // ✅ inactivi: statusInactivi
      inactiv: bool(inact?.statusInactivi),
      inactivFrom: inact?.dataInactivare
        ? iso(inact.dataInactivare)?.toISOString()
        : null,

      insolvent: bool(insol?.insolventa) || bool(insol?.inceputInsolventa) || false,

      // ✅ split TVA: statusSplitTVA
      splitTva: bool(split?.statusSplitTVA),

      // back-compat + debug
      anafName,
      anafAddress,
      raw: it || null,

      cui: String(cui),
    };
  } catch (e) {
    // log în dev ca să vezi dacă e DNS/TLS/timeout
    console.error("[ANAF] verify failed:", e?.name, e?.message);
    return fallback;
  } finally {
    clearTimeout(timeout);
  }
}
