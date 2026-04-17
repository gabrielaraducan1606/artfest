import React, { useEffect, useState, useCallback, useMemo } from "react";
import { api } from "../../../../../lib/api";

export default function ConnectPayoutsTab() {
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [err, setErr] = useState("");
  const [status, setStatus] = useState(null);

  const payoutsActivationDate = useMemo(
    () => new Date("2026-05-17T00:00:00"),
    []
  );

  const payoutsLocked = new Date() < payoutsActivationDate;

  const activationDateText = "17 mai";
  const gracePeriodText =
    "După 17 mai, vei avea o perioadă limitată pentru completarea formularului de activare.";

  const boxStyle = {
    marginTop: 10,
    padding: 12,
    border: "1px solid #ddd",
    borderRadius: 8,
    background: "#fafafa",
  };

  const warningStyle = {
    marginTop: 10,
    padding: 12,
    border: "1px solid #e6b800",
    borderRadius: 8,
    background: "#fff8e1",
  };

  const errorStyle = {
    marginTop: 10,
    padding: 10,
    border: "1px solid #f00",
    borderRadius: 8,
    background: "#fff5f5",
  };

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
    if (payoutsLocked) {
      setErr(`Activarea încasărilor va fi disponibilă după ${activationDateText}.`);
      return;
    }

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
  }, [payoutsLocked, activationDateText]);

  const continueOnboarding = useCallback(async () => {
    if (payoutsLocked) {
      setErr(`Continuarea onboarding-ului va fi disponibilă după ${activationDateText}.`);
      return;
    }

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
  }, [payoutsLocked, activationDateText]);

  if (loading) {
    return <div style={{ padding: 12 }}>Se verifică statusul încasărilor…</div>;
  }

  const enabled = !!status?.payouts_enabled;
  const hasAccount = !!status?.hasAccount;
  const due = Array.isArray(status?.requirements_due) ? status.requirements_due : [];

  return (
    <div style={{ padding: 12 }}>
      <h3>Încasări prin platformă (Stripe)</h3>

      <div style={boxStyle}>
        <p style={{ marginTop: 0 }}>
          În curând, platforma va introduce <strong>plăți online</strong> pentru clienți.
          Pentru ca tu să poți primi acești bani direct în contul tău bancar, folosim{" "}
          <strong>Stripe</strong>.
        </p>

        <p>
          Stripe este serviciul prin care se procesează plățile online și prin care se pot
          face transferurile către vânzători. În cadrul activării, Stripe poate solicita
          date precum:
        </p>

        <ul style={{ marginTop: 0 }}>
          <li>nume / denumire firmă sau PFA</li>
          <li>IBAN pentru încasări</li>
          <li>date de identificare necesare verificării</li>
        </ul>

        <p style={{ marginBottom: 0 }}>
          Până atunci, îți poți activa magazinul și folosi platforma în perioada de probă
          gratuită <strong>fără să completezi acest formular</strong>.
        </p>
      </div>

      {payoutsLocked && (
        <div style={warningStyle}>
          <p style={{ marginTop: 0 }}>
            <strong>Activarea încasărilor nu este necesară încă.</strong>
          </p>
          <p>
            Formularul Stripe va deveni disponibil după <strong>{activationDateText}</strong>.
            Până atunci, platforma este în perioadă de probă gratuită.
          </p>
          <p style={{ marginBottom: 0 }}>{gracePeriodText}</p>
        </div>
      )}

      {err && <div style={errorStyle}>{err}</div>}

      {!hasAccount && (
        <>
          <div style={boxStyle}>
            <p style={{ marginTop: 0 }}>
              Pentru a primi plăți online prin platformă după perioada de probă, va trebui
              să activezi încasările prin Stripe.
            </p>
            <p style={{ marginBottom: 0 }}>
              Când activarea va fi disponibilă, vei fi redirecționat către Stripe pentru
              completarea datelor necesare.
            </p>
          </div>

          <button onClick={startOnboarding} disabled={starting || payoutsLocked}>
            {starting ? "Se deschide Stripe…" : "Activează încasări"}
          </button>
        </>
      )}

      {hasAccount && !enabled && (
        <>
          <div style={boxStyle}>
            <p style={{ marginTop: 0 }}>
              Contul Stripe există, dar activarea încasărilor nu este încă finalizată.
            </p>
            <p style={{ marginBottom: 0 }}>
              După activare, vei putea primi plăți online și transferuri către contul bancar.
            </p>
          </div>

          {due.length > 0 && (
            <div style={boxStyle}>
              <strong>Mai lipsesc:</strong>
              <ul>
                {due.slice(0, 12).map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
              {due.length > 12 && <div>…și încă {due.length - 12}</div>}
            </div>
          )}

          {payoutsLocked && (
            <div style={warningStyle}>
              Continuarea onboarding-ului va fi disponibilă după{" "}
              <strong>{activationDateText}</strong>.
            </div>
          )}

          <div style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
            <button onClick={continueOnboarding} disabled={starting || payoutsLocked}>
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
          <p style={{ marginTop: 10 }}>
            ✅ Încasările sunt active. Poți primi transferuri către contul bancar.
          </p>

          <div style={boxStyle}>
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