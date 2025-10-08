// frontend/src/hooks/useCuiCheck.js
import { useEffect, useState } from "react";

const normalize = (raw) =>
  raw?.toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/^RO/, "") || "";

export function isValidCifChecksum(cuiDigits) {
  // Algoritmul clasic: aliniază la 9 cifre pe stânga cu 0, înmulțește cu [7,5,3,2,1,7,5,3,2]
  // și verifică cifra de control (ultimul digit).
  if (!/^\d{2,10}$/.test(cuiDigits)) return false;
  const s = cuiDigits.padStart(10, "0");
  const base = s.slice(0, 9);
  const control = Number(s[9]);
  const weights = [7,5,3,2,1,7,5,3,2];
  const sum = base.split("").reduce((acc, d, i) => acc + Number(d) * weights[i], 0);
  let c = sum % 11;
  if (c === 10) c = 0;
  return c === control;
}

export function useCuiCheck(cuiInput, { debounceMs = 700 } = {}) {
  const [state, setState] = useState({ status: "idle", data: null, error: null });

  useEffect(() => {
    const digits = normalize(cuiInput || "");
    if (!digits) { setState({ status: "idle", data: null, error: null }); return; }
    if (!/^\d{2,10}$/.test(digits) || !isValidCifChecksum(digits)) {
      setState({ status: "invalid", data: null, error: "CUI invalid (format sau cifră de control)." });
      return;
    }

    setState((s) => ({ ...s, status: "checking", error: null }));
    const t = setTimeout(async () => {
      try {
        const r = await fetch("/api/anaf/verify-cui", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cui: digits }) // data=azi, pe backend
        });
        if (!r.ok) {
          const msg = (await r.json().catch(()=>null))?.message || "Eroare la verificarea ANAF.";
          setState({ status: "error", data: null, error: msg });
          return;
        }
        const json = await r.json();
        setState({ status: json.valid ? "ok" : "invalid", data: json, error: json.valid ? null : "CUI inexistent la ANAF." });
      } catch {
        setState({ status: "error", data: null, error: "ANAF indisponibil momentan." });
      }
    }, debounceMs);

    return () => clearTimeout(t);
  }, [cuiInput, debounceMs]);

  return state; // { status, data, error }
}
