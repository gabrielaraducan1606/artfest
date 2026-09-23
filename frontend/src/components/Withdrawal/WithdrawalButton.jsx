// src/components/Withdrawal/WithdrawalButton.jsx
//
// Funcția online de retragere din contract (Returns v2 §4.3):
//  - buton clar identificat ("Retrageți-vă din contract aici"), vizibil
//    pe pagina comenzii (Client autentificat și guest);
//  - formular: nume, comandă/livrări, e-mail pentru confirmare;
//  - pas SEPARAT de confirmare înainte de transmiterea finală;
//  - după transmitere: conținutul declarației + data și ora, iar
//    confirmarea pe suport durabil e trimisă pe e-mail de backend.
//
// Backend:
//   user : GET/POST /api/user/orders/:id/withdrawal
//   guest: GET/POST /api/guest/orders/:id/withdrawal?token=...

import { useCallback, useEffect, useState } from "react";
import { api } from "../../lib/api.js";
import styles from "./WithdrawalModal.module.css";

const REASON_LABEL = {
  not_consumer:
    "Dreptul legal de retragere fără motiv se aplică consumatorilor (persoane fizice).",
  order_cancelled: "Comanda este anulată.",
  shipment_cancelled: "Livrarea este anulată sau returnată.",
  non_professional_seller:
    "Vânzătorul s-a declarat neprofesionist - dreptul de retragere specific contractelor cu profesioniști nu se aplică.",
  already_submitted: "Ai transmis deja o declarație pentru această livrare.",
};

function formatDateTime(value) {
  try {
    return new Intl.DateTimeFormat("ro-RO", {
      dateStyle: "long",
      timeStyle: "medium",
      timeZone: "Europe/Bucharest",
    }).format(new Date(value));
  } catch {
    return String(value || "");
  }
}

export default function WithdrawalButton({
  orderRef,
  mode = "user",
  token = "",
  className = "",
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState("");

  const [status, setStatus] = useState(null);
  const [step, setStep] = useState("form"); // form | confirm | done

  const [clientName, setClientName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [selected, setSelected] = useState({});

  const [result, setResult] = useState(null);

  const endpoint = useCallback(() => {
    const base =
      mode === "guest"
        ? `/api/guest/orders/${encodeURIComponent(orderRef)}/withdrawal`
        : `/api/user/orders/${encodeURIComponent(orderRef)}/withdrawal`;

    return mode === "guest"
      ? `${base}?token=${encodeURIComponent(token)}`
      : base;
  }, [mode, orderRef, token]);

  useEffect(() => {
    if (!open) return undefined;

    let alive = true;

    (async () => {
      setLoading(true);
      setErr("");
      setStep("form");
      setResult(null);

      try {
        const data = await api(endpoint());
        if (!alive) return;

        setStatus(data);
        setClientName(data?.prefill?.clientName || "");
        setContactEmail(data?.prefill?.contactEmail || "");

        const initial = {};
        for (const shipment of data?.shipments || []) {
          if (shipment.eligible) initial[shipment.id] = true;
        }
        setSelected(initial);
      } catch (e) {
        if (!alive) return;
        setErr(e?.message || "Nu am putut încărca datele comenzii.");
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [open, endpoint]);

  useEffect(() => {
    if (!open) return undefined;

    const onKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const shipments = status?.shipments || [];
  const eligibleShipments = shipments.filter((s) => s.eligible);
  const selectedIds = eligibleShipments
    .filter((s) => selected[s.id])
    .map((s) => s.id);

  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail.trim());
  const canContinue =
    clientName.trim().length >= 2 &&
    emailOk &&
    selectedIds.length > 0;

  async function submit() {
    setErr("");
    setSubmitting(true);

    try {
      const allEligibleSelected =
        selectedIds.length === eligibleShipments.length;

      const data = await api(endpoint(), {
        method: "POST",
        body: {
          clientName: clientName.trim(),
          contactEmail: contactEmail.trim(),
          // gol = toate livrările eligibile (întreaga Comandă)
          shipmentIds: allEligibleSelected ? [] : selectedIds,
          confirmed: true,
          ...(mode === "guest" ? { token } : {}),
        },
      });

      setResult(data?.withdrawal || null);
      setStep("done");
    } catch (e) {
      setErr(e?.message || "Declarația nu a putut fi transmisă.");
      setStep("form");
    } finally {
      setSubmitting(false);
    }
  }

  if (!orderRef) return null;

  return (
    <>
      <button
        type="button"
        className={className || styles.trigger}
        onClick={() => setOpen(true)}
      >
        Solicită retragerea din comandă
      </button>

      <div className={styles.clarification}>
        Cererea este transmisă vânzătorului și nu anulează automat comanda.
      </div>

      {open && (
        <div
          className={styles.backdrop}
          role="dialog"
          aria-modal="true"
          aria-label="Solicită retragerea din contractul acestei comenzi"
        >
          <div className={styles.modal}>
            <div className={styles.head}>
              <div>
                <div className={styles.title}>
                  Solicită retragerea din contractul acestei comenzi
                </div>
                <div className={styles.subtle}>
                  Comandă:{" "}
                  <b>#{status?.order?.orderNumber || orderRef}</b>
                </div>
              </div>

              <button
                type="button"
                className={styles.iconBtn}
                onClick={() => setOpen(false)}
                aria-label="Închide"
              >
                ×
              </button>
            </div>

            <div className={styles.body}>
              {loading && <div>Se încarcă…</div>}

              {!loading && err && step !== "done" && (
                <div className={styles.error}>{err}</div>
              )}

              {!loading && status && step === "form" && (
                <>
                  {!status.eligible ? (
                    <>
                      <div className={styles.warn}>
                        Pentru această comandă nu se poate transmite o
                        declarație de retragere online.
                      </div>

                      {shipments.map((shipment) => (
                        <div key={shipment.id} className={styles.subtle}>
                          <b>{shipment.vendorName}</b>:{" "}
                          {REASON_LABEL[shipment.reason] ||
                            "Nu este disponibilă retragerea online."}
                        </div>
                      ))}

                      <div className={styles.actions}>
                        <button
                          type="button"
                          className={styles.btnGhost}
                          onClick={() => setOpen(false)}
                        >
                          Închide
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <p className={styles.subtle} style={{ marginTop: 0 }}>
                        Te poți retrage din contract fără a invoca un motiv,
                        în termenul legal ({status.periodDays} zile).
                        Folosirea acestui formular nu este obligatorie -
                        poți transmite retragerea și pe alte căi permise de
                        lege.
                      </p>

                      {status.hasCustomItems && (
                        <div className={styles.warn}>
                          Pentru produsele realizate după specificațiile
                          tale sau personalizate în mod clar, dreptul legal
                          de retragere poate să nu se aplice. Vânzătorul va
                          analiza solicitarea conform legii și politicii
                          aplicabile.
                        </div>
                      )}

                      <div className={styles.field}>
                        <label className={styles.label} htmlFor="wd-name">
                          Nume și prenume
                        </label>
                        <input
                          id="wd-name"
                          className={styles.input}
                          value={clientName}
                          onChange={(e) => setClientName(e.target.value)}
                          autoComplete="name"
                          maxLength={160}
                        />
                      </div>

                      <div className={styles.field}>
                        <label className={styles.label} htmlFor="wd-email">
                          E-mail pentru confirmare
                        </label>
                        <input
                          id="wd-email"
                          type="email"
                          className={styles.input}
                          value={contactEmail}
                          onChange={(e) => setContactEmail(e.target.value)}
                          autoComplete="email"
                          maxLength={320}
                        />
                      </div>

                      <div className={styles.card}>
                        <div className={styles.cardTitle}>
                          Livrări din care te retragi
                        </div>

                        {shipments.map((shipment) => (
                          <label
                            key={shipment.id}
                            className={`${styles.shipRow} ${
                              shipment.eligible ? "" : styles.shipDisabled
                            }`}
                          >
                            <input
                              type="checkbox"
                              disabled={!shipment.eligible}
                              checked={Boolean(selected[shipment.id])}
                              onChange={(e) =>
                                setSelected((prev) => ({
                                  ...prev,
                                  [shipment.id]: e.target.checked,
                                }))
                              }
                            />
                            <span>
                              <b>{shipment.vendorName}</b>
                              <br />
                              <span className={styles.subtle}>
                                {shipment.items
                                  .map((item) => `${item.title} x${item.qty}`)
                                  .join(", ")}
                              </span>
                              {!shipment.eligible && (
                                <>
                                  <br />
                                  <span className={styles.subtle}>
                                    {REASON_LABEL[shipment.reason] || ""}
                                  </span>
                                </>
                              )}
                            </span>
                          </label>
                        ))}
                      </div>

                      <div className={styles.actions}>
                        <button
                          type="button"
                          className={styles.btnGhost}
                          onClick={() => setOpen(false)}
                        >
                          Renunț
                        </button>
                        <button
                          type="button"
                          className={styles.btnPrimary}
                          disabled={!canContinue}
                          onClick={() => setStep("confirm")}
                        >
                          Continuă
                        </button>
                      </div>
                    </>
                  )}
                </>
              )}

              {!loading && step === "confirm" && (
                <>
                  <div className={styles.card}>
                    <div className={styles.cardTitle}>
                      Confirmă solicitarea de retragere
                    </div>

                    <div className={styles.declaration}>
                      {`Eu, ${clientName.trim()}, mă retrag din contractul aferent Comenzii #${
                        status?.order?.orderNumber || orderRef
                      }`}
                      {selectedIds.length === eligibleShipments.length &&
                      eligibleShipments.length === shipments.length
                        ? " (întreaga Comandă)."
                        : ` (doar: ${eligibleShipments
                            .filter((s) => selectedIds.includes(s.id))
                            .map((s) => s.vendorName)
                            .join(", ")}).`}
                      {`\nConfirmarea se trimite la: ${contactEmail.trim()}`}
                    </div>
                  </div>

                  <div className={styles.warn}>
                    După transmitere, declarația nu mai poate fi modificată
                    din această pagină.
                  </div>

                  {err && <div className={styles.error}>{err}</div>}

                  <div className={styles.actions}>
                    <button
                      type="button"
                      className={styles.btnGhost}
                      disabled={submitting}
                      onClick={() => setStep("form")}
                    >
                      Înapoi
                    </button>
                    <button
                      type="button"
                      className={styles.btnPrimary}
                      disabled={submitting}
                      onClick={submit}
                    >
                      {submitting
                        ? "Se transmite…"
                        : "Confirm solicitarea de retragere"}
                    </button>
                  </div>
                </>
              )}

              {step === "done" && result && (
                <>
                  <div className={styles.successTitle}>
                    Declarația a fost transmisă ✅
                  </div>

                  <div className={styles.card}>
                    <div className={styles.subtle}>
                      Data și ora transmiterii:{" "}
                      <b>{formatDateTime(result.submittedAt)}</b>
                    </div>
                    <div
                      className={styles.declaration}
                      style={{ marginTop: 8 }}
                    >
                      {result.declarationText}
                    </div>
                  </div>

                  {result.confirmationSent ? (
                    <div className={styles.subtle}>
                      Am trimis confirmarea primirii pe{" "}
                      <b>{result.contactEmail}</b>. Păstrează-l ca dovadă.
                    </div>
                  ) : (
                    <div className={styles.warn}>
                      Declarația a fost înregistrată, dar nu am putut trimite
                      acum emailul de confirmare. Salvează această pagină
                      (data, ora și conținutul de mai sus) ca dovadă.
                    </div>
                  )}

                  <div className={styles.actions}>
                    <button
                      type="button"
                      className={styles.btnPrimary}
                      onClick={() => setOpen(false)}
                    >
                      Închide
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
