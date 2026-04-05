import React, { useEffect, useState, useCallback } from "react";
import { api } from "../../../../../lib/api";

export default function ConnectPayoutsTab() {
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [err, setErr] = useState("");
  const [status, setStatus] = useState(null);

  const loadStatus = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      const d = await api("/api/vendors/stripe/connect/status", { method: "GET" });
      setStatus(d);
    } catch (e) {
      setErr(e?.message || "Nu am putut verifica statusul Stripe.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  const startOnboarding = useCallback(async () => {
    setStarting(true);
    setErr("");
    try {
      const d = await api("/api/vendors/stripe/connect/start", { method: "POST" });
      if (!d?.url) throw new Error("Nu am primit linkul de onboarding.");
      window.location.href = d.url;
    } catch (e) {
      setErr(e?.message || "Nu am putut porni onboarding-ul Stripe.");
      setStarting(false);
    }
  }, []);

  const continueOnboarding = useCallback(async () => {
    setStarting(true);
    setErr("");
    try {
      const d = await api("/api/vendors/stripe/connect/continue", { method: "POST" });
      if (!d?.url) throw new Error("Nu am primit linkul de continuare.");
      window.location.href = d.url;
    } catch (e) {
      setErr(e?.message || "Nu am putut continua onboarding-ul.");
      setStarting(false);
    }
  }, []);

  if (loading) return <div style={{ padding: 12 }}>Se verifică statusul încasărilor…</div>;

  const enabled = !!status?.payouts_enabled;
  const hasAccount = !!status?.hasAccount;
  const due = Array.isArray(status?.requirements_due) ? status.requirements_due : [];

  return (
    <div style={{ padding: 12 }}>
      <h3>Activează încasările (Stripe)</h3>

      {err && (
        <div style={{ marginTop: 10, padding: 10, border: "1px solid #f00" }}>
          {err}
        </div>
      )}

      {!hasAccount && (
        <>
          <p>
            Pentru a primi bani din comenzi, trebuie să activezi încasările. Vei fi redirecționat către Stripe pentru
            completarea datelor (IBAN, firmă/PFA, verificări).
          </p>
          <button onClick={startOnboarding} disabled={starting}>
            {starting ? "Se deschide Stripe…" : "Activează încasări"}
          </button>
        </>
      )}

      {hasAccount && !enabled && (
        <>
          <p>Contul Stripe există, dar nu este încă finalizat.</p>

          {due.length > 0 && (
            <div style={{ marginTop: 10, padding: 10, border: "1px solid #ddd" }}>
              <strong>Mai lipsesc:</strong>
              <ul>
                {due.slice(0, 12).map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
              {due.length > 12 && <div>…și încă {due.length - 12}</div>}
            </div>
          )}

          <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
            <button onClick={continueOnboarding} disabled={starting}>
              {starting ? "Se deschide Stripe…" : "Continuă onboarding"}
            </button>
            <button onClick={loadStatus} disabled={starting}>
              Reîncarcă status
            </button>
          </div>
        </>
      )}

      {hasAccount && enabled && (
        <>
          <p style={{ marginTop: 10 }}>✅ Încasările sunt active. Poți primi transferuri.</p>
          <div style={{ marginTop: 10, padding: 10, border: "1px solid #ddd" }}>
            <div>payouts_enabled: {String(status.payouts_enabled)}</div>
            <div>details_submitted: {String(status.details_submitted)}</div>
            <div>charges_enabled: {String(status.charges_enabled)}</div>
          </div>
          <div style={{ marginTop: 12 }}>
            <button onClick={loadStatus}>Reîncarcă status</button>
          </div>
        </>
      )}
    </div>
  );
}
