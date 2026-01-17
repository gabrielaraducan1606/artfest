import fetch from "node-fetch";

const ANAF_URL = "https://webservicesp.anaf.ro/api/PlatitorTvaRest/v9/tva"; // ✅ v9

const iso = (d) => (d ? new Date(d) : null);
const bool = (v) => v === true || v === "true" || v === 1;

/** Scoate RO și non-cifre */
export function normalizeCui(input = "") {
  return String(input).replace(/^RO/i, "").replace(/\D/g, "");
}

/**
 * Verifică CUI la ANAF (v9).
 * Răspuns ANAF v9: { cod:200, message:"SUCCESS", found:[...], notFound:[...] }
 * Doc oficial: https://static.anaf.ro/.../doc_WS_V9.txt
 *
 * Fail-open: dacă ANAF e jos/timeouts, întoarce tvaActive=null.
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
  const timeout = setTimeout(() => controller.abort(), 12000);

  try {
    const r = await fetch(ANAF_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        // uneori ajută în practică (proxy / WAF / etc)
        "User-Agent": "vendor-platform/1.0 (anaf-vat-check)",
      },
      body: JSON.stringify([{ cui: Number(cui), data: dateISO }]),
      signal: controller.signal,
    });

    if (!r.ok) {
      // păstrăm textul pentru debug (nu îl expunem în UI)
      const txt = await r.text().catch(() => "");
      throw new Error(`ANAF HTTP ${r.status} ${txt?.slice(0, 120)}`);
    }

    const data = await r.json();

    // ✅ ANAF v9: cod 200 = SUCCESS
    const cod = Number(data?.cod);
    if (!data || cod !== 200) {
      throw new Error(`ANAF COD ${data?.cod} MSG ${data?.message || ""}`);
    }

    const it = Array.isArray(data.found) ? data.found[0] : null;

    // dacă nu e în found => nu e găsit => tvaActive false (poți schimba în null dacă preferi)
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

      // ✅ doc v9: scpTVA
      tvaActive: bool(tva?.scpTVA),

      name: anafName,
      address: anafAddress,
      tvaCode: `RO${cui}`,

      // perioade TVA (doc v9: perioade_TVA)
      tvaRegStart: tva?.perioade_TVA?.data_inceput_ScpTVA
        ? iso(tva.perioade_TVA.data_inceput_ScpTVA)?.toISOString()
        : null,
      tvaRegEnd: tva?.perioade_TVA?.data_sfarsit_ScpTVA
        ? iso(tva.perioade_TVA.data_sfarsit_ScpTVA)?.toISOString()
        : null,

      // ✅ doc v9: statusInactivi
      inactiv: bool(inact?.statusInactivi),
      inactivFrom: inact?.dataInactivare
        ? iso(inact.dataInactivare)?.toISOString()
        : null,

      insolvent: bool(insol?.insolventa) || bool(insol?.inceputInsolventa) || false,

      // ✅ doc v9: statusSplitTVA
      splitTva: bool(split?.statusSplitTVA),

      anafName,
      anafAddress,
      raw: it || null,

      cui: String(cui),
    };
  } catch (e) {
    // ✅ super util în dev / live logs
    console.error("[ANAF] verify failed:", e?.name, e?.message);
    return fallback;
  } finally {
    clearTimeout(timeout);
  }
}
