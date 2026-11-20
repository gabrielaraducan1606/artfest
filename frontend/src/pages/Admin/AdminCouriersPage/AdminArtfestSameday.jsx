// src/pages/Admin/AdminCouriersPage/AdminArtfestSameday.jsx
//
// Admin - „Sameday prin Artfest”: tariful simplu Artfest pe metodă, folosit doar când un produs
// din coletul unui magazin nu are greutate. Fără valori implicite (gol = metoda nu se oferă).

import { useCallback, useEffect, useState } from "react";
import { api } from "../../../lib/api";
import { METHOD_LABELS, amountToInput } from "./adminArtfestSamedayView.js";

const BASE = "/api/admin/sameday-delivery";
const METHODS = ["HOME", "LOCKER", "PUDO"];

export default function AdminArtfestSameday({ styles }) {
  const [values, setValues] = useState(null);
  const [busy, setBusy] = useState("");
  const [saved, setSaved] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const { config } = await api(`${BASE}/config`);
      setValues(Object.fromEntries(METHODS.map((m) => [m, amountToInput(config?.[m]?.amountCents)])));
    } catch (e) {
      setError(e?.data?.message || "Nu am putut încărca tarifele.");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const save = async (method) => {
    setBusy(method);
    setSaved("");
    setError("");
    try {
      const { config } = await api(`${BASE}/config/${method}`, { method: "PUT", body: { amountLei: values[method] } });
      setValues((v) => ({ ...v, [method]: amountToInput(config?.amountCents) }));
      setSaved(method);
    } catch (e) {
      setError(e?.data?.message || "Nu am putut salva.");
    } finally {
      setBusy("");
    }
  };

  return (
    <section className={styles.card} aria-labelledby="artfest-rates-title" data-testid="admin-artfest-sameday">
      <header className={styles.cardHead}>
        <h2 id="artfest-rates-title" className={styles.cardTitle}>
          Tarif Sameday prin Artfest pentru produse fără greutate
        </h2>
      </header>
      <p className={styles.messageMuted}>
        Se aplică doar când un produs din comandă nu are greutate. Lasă gol ca metoda să nu fie oferită în acest caz.
      </p>
      {values ? (
        <div className={styles.cfgGrid}>
          {METHODS.map((m) => (
            <label key={m} className={styles.cfgField}>
              <span>{METHOD_LABELS[m]} (lei)</span>
              <span className={styles.cfgActions}>
                <input
                  className={styles.trackingInput}
                  value={values[m]}
                  inputMode="decimal"
                  placeholder="neconfigurat"
                  onChange={(e) => setValues((v) => ({ ...v, [m]: e.target.value }))}
                />
                <button type="button" className={styles.primary} disabled={Boolean(busy)} onClick={() => save(m)}>
                  {busy === m ? "…" : saved === m ? "Salvat" : "Salvează"}
                </button>
              </span>
            </label>
          ))}
        </div>
      ) : null}
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
