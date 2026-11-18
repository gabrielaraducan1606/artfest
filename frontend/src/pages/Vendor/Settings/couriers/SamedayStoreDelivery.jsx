// src/pages/Vendor/Settings/couriers/SamedayStoreDelivery.jsx
//
// Secțiunea „Livrare Sameday prin Artfest” pentru UN magazin (Setări > Livrare și retururi).
// Activarea / dezactivarea trec prin server, care verifică eligibilitatea (Stripe, adresa
// de ridicare, contul Artfest, restricția Admin). Nu blochează magazinul și nu schimbă
// livrarea obișnuită a vânzătorului.

import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { api } from "../../../../lib/api";
import { SAMEDAY_DELIVERY_RULES, samedayDeliveryView } from "./samedayStoreDeliveryView.js";

export default function SamedayStoreDelivery({ serviceId, styles }) {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const url = `/api/vendor/stores/${encodeURIComponent(serviceId)}/sameday-delivery`;

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await api(url);
      setStatus(data?.sameday || null);
    } catch (e) {
      setStatus(null);
      setError(e?.data?.message || "Nu am putut încărca setarea Sameday.");
    } finally {
      setLoading(false);
    }
  }, [url]);

  useEffect(() => {
    load();
  }, [load]);

  const view = samedayDeliveryView(status);

  const submit = async () => {
    if (!view.action || busy) return;
    setBusy(true);
    setError("");
    try {
      const data = await api(url, { method: "PUT", body: { enabled: view.action === "activate" } });
      setStatus(data?.sameday || null);
    } catch (e) {
      setError(e?.data?.message || "Nu am putut salva setarea Sameday.");
      // starea reală (ex. eligibilitatea s-a schimbat între timp)
      load();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.grid1} data-sameday-store={serviceId}>
      <div className={styles.title}>Livrare Sameday prin Artfest</div>

      {loading ? (
        <div className={styles.hint}>
          <Loader2 className={styles.spin} size={14} /> Se verifică…
        </div>
      ) : (
        <>
          <div
            className={view.tone === "ok" ? styles.success : view.tone === "error" ? styles.error : view.tone === "warn" ? styles.warn : styles.hint}
            role="status"
            data-sameday-state={view.state}
          >
            <strong>{view.title}</strong>
            {view.description ? <div>{view.description}</div> : null}
            {view.notes.length ? (
              <ul>
                {view.notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            ) : null}
          </div>

          <ul className={styles.subtitle}>
            {SAMEDAY_DELIVERY_RULES.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>

          {view.action ? (
            <div>
              <button type="button" className={view.action === "deactivate" ? styles.dangerBtn : styles.primary} onClick={submit} disabled={busy}>
                {busy ? "Se salvează…" : view.actionLabel}
              </button>
            </div>
          ) : null}
        </>
      )}

      {error ? (
        <div className={styles.error} role="alert">
          {error}
        </div>
      ) : null}
    </div>
  );
}
