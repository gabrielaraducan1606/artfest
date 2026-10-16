// src/pages/Admin/AdminDesktop/tabs/AdminFairSaleReturn.jsx
//
// Admin -> Târg Artfest -> POS -> Vânzări: retur / rambursare către client și
// anularea vânzării. Sumele inversate (rambursare, comision, net vendor,
// compensație Artfest) și efectul pe stoc vin EXCLUSIV din preview-ul serverului;
// confirmarea trimite Idempotency-Key (retry / dublu click => același retur).

import { Fragment, useEffect, useRef, useState } from "react";
import { api } from "../../../../lib/api";
import shared from "../AdminDesktop.module.css";
import cancelStyles from "./AdminArtfestFairTab.module.css";
import { Modal } from "./AdminFairCancellation.jsx";
import {
  DISPOSITION_LABEL,
  PAYMENT_LABEL,
  POS_API,
  RESPONSIBILITY_LABEL,
  RESPONSIBILITY_REQUIRED,
  formatLei,
  impactText,
  initialReturnDraft,
  newIdempotencyKey,
  returnDraftProblems,
  returnPayload,
} from "./adminFairPos.js";

function errorMessage(err, fallback) {
  const problems = err?.data?.problems;
  if (Array.isArray(problems) && problems.length) {
    return problems.map((p) => `${p.title || "Produs"}: ${(p.messages || []).join(" ")}`).join(" · ");
  }
  return err?.data?.message || err?.message || fallback;
}

function stockText(line) {
  if (line.disposition === "RESTOCKED") return `+${line.quantity} în stocul târgului`;
  if (line.disposition === "NOT_RESTOCKED") return `${line.quantity} deteriorat(e), stocul vandabil nu crește`;
  return "fără efect pe stoc";
}

function PreviewSummary({ preview }) {
  if (!preview) return null;
  const t = preview.totals;
  return (
    <div className={cancelStyles.result} role="status">
      <strong>
        Rambursare client: {formatLei(t.refundCents)} ({PAYMENT_LABEL[preview.refundMethod] || preview.refundMethod})
      </strong>
      <span>Comision inversat: {formatLei(t.commissionReversedCents)}</span>
      <span>Net vendor inversat (audit): {formatLei(t.vendorNetReversedCents)}</span>
      {t.artfestFundedReversedCents > 0 && <span>Compensație Artfest inversată: {formatLei(t.artfestFundedReversedCents)}</span>}
      <strong>
        Net vendor afectat (total): {t.vendorNetImpactCents ? `-${formatLei(t.vendorNetImpactCents)}` : `${formatLei(0)} (vendor neafectat)`}
      </strong>
      {t.artfestBorneRefundCents > 0 && <strong>Rambursare suportată de Artfest (total): {formatLei(t.artfestBorneRefundCents)}</strong>}
      <ul>
        {preview.lines.map((l) => (
          <li key={`${l.saleLineId}-${l.disposition}-${l.refundResponsibility || ""}`}>
            {l.title} × {l.quantity}: {formatLei(l.refundCents)} · stoc: {stockText(l)} · {impactText(l)}
          </li>
        ))}
      </ul>
      {preview.problems.map((p) => (
        <span key={p.saleLineId} className={cancelStyles.errorText}>
          {p.title || "Linie"}: {p.messages.join(" ")}
        </span>
      ))}
    </div>
  );
}

/* ===================== Retur / rambursare ===================== */

export function SaleReturnModal({ sale, onClose, onDone }) {
  const [draft, setDraft] = useState(() => initialReturnDraft(sale));
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const keyRef = useRef({ signature: "", key: "" });

  const payload = returnPayload(draft);
  const previewSig = JSON.stringify({
    r: payload.refundMethod,
    l: payload.lines.map((l) => [l.saleLineId, l.quantity, l.disposition, l.refundResponsibility || ""]),
  });

  useEffect(() => {
    if (!payload.lines.length) {
      setPreview(null);
      return undefined;
    }
    const timer = setTimeout(async () => {
      try {
        setPreview(
          await api(`${POS_API}/sales/${encodeURIComponent(sale.id)}/returns/preview`, {
            method: "POST",
            body: { type: "RETURN", ...payload },
          }),
        );
        setError("");
      } catch (err) {
        setPreview(null);
        setError(errorMessage(err, "Nu am putut calcula returul."));
      }
    }, 250);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewSig, sale.id]);

  const updateLine = (saleLineId, patch) =>
    setDraft((d) => ({
      ...d,
      lines: d.lines.map((l) => (l.saleLineId === saleLineId ? { ...l, ...patch } : l)),
    }));

  const problems = returnDraftProblems(draft);

  async function confirm() {
    if (problems.length || !preview?.canConfirm) return;
    if (
      !window.confirm(
        `Confirmi rambursarea de ${formatLei(preview.totals.refundCents)} (${PAYMENT_LABEL[draft.refundMethod].toLowerCase()})?`,
      )
    )
      return;
    const sig = JSON.stringify(payload);
    if (keyRef.current.signature !== sig) keyRef.current = { signature: sig, key: newIdempotencyKey() };
    setBusy(true);
    setError("");
    try {
      const res = await api(`${POS_API}/sales/${encodeURIComponent(sale.id)}/returns`, {
        method: "POST",
        headers: { "Idempotency-Key": keyRef.current.key },
        body: payload,
      });
      onDone(`Retur ${res.saleReturn.reference} înregistrat: ${formatLei(res.saleReturn.refundCents)} rambursat.`);
    } catch (err) {
      setError(errorMessage(err, "Returul nu a reușit."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      wide
      title={`Retur / rambursare - ${sale.receiptReference}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={cancelStyles.ghostBtn} onClick={onClose} disabled={busy}>
            Renunță
          </button>
          <button
            type="button"
            className={cancelStyles.dangerBtn}
            onClick={confirm}
            disabled={busy || problems.length > 0 || !preview?.canConfirm}
          >
            {busy ? "Se înregistrează…" : "Confirmă returul"}
          </button>
        </>
      }
    >
      <table className={shared.table}>
        <thead>
          <tr>
            <th>Produs</th>
            <th>Cumpărat</th>
            <th>Deja returnat</th>
            <th>De returnat</th>
            <th>Stare</th>
            <th>Notă despre stare</th>
          </tr>
        </thead>
        <tbody>
          {draft.lines.map((l) => (
            <Fragment key={l.saleLineId}>
              <tr>
                <td>
                  {l.title}
                  {l.variantLabel ? ` (${l.variantLabel})` : ""}
                  {l.vendorName && <div className={shared.subtle}>{l.vendorName}</div>}
                </td>
                <td>{l.quantity}</td>
                <td>{l.returnedQty}</td>
                <td>
                  <input
                    type="number"
                    min={0}
                    max={l.quantity - l.returnedQty}
                    value={l.qty}
                    onChange={(e) =>
                      updateLine(l.saleLineId, {
                        qty: Math.max(0, Math.floor(Number(e.target.value) || 0)),
                      })
                    }
                    aria-label={`Cantitate de returnat - ${l.title}`}
                    style={{ width: 70 }}
                  />
                </td>
                <td>
                  <select
                    value={l.disposition}
                    onChange={(e) => updateLine(l.saleLineId, { disposition: e.target.value })}
                    aria-label={`Stare - ${l.title}`}
                  >
                    {Object.entries(DISPOSITION_LABEL).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <input
                    type="text"
                    maxLength={1000}
                    value={l.note}
                    placeholder="opțional"
                    onChange={(e) => updateLine(l.saleLineId, { note: e.target.value })}
                    aria-label={`Notă - ${l.title}`}
                  />
                </td>
              </tr>
              {RESPONSIBILITY_REQUIRED.has(l.disposition) && (
                <tr>
                  <td colSpan={6}>
                    <div
                      role="radiogroup"
                      aria-label={`Cine suportă rambursarea - ${l.title}`}
                      style={{
                        display: "flex",
                        flexWrap: "wrap",
                        alignItems: "center",
                        gap: 8,
                      }}
                    >
                      <strong>Cine suportă rambursarea?</strong>
                      {Object.entries(RESPONSIBILITY_LABEL).map(([value, label]) => (
                        <button
                          key={value}
                          type="button"
                          role="radio"
                          aria-checked={l.refundResponsibility === value}
                          className={l.refundResponsibility === value ? cancelStyles.dangerBtn : cancelStyles.ghostBtn}
                          onClick={() =>
                            updateLine(l.saleLineId, {
                              refundResponsibility: value,
                            })
                          }
                        >
                          {label}
                        </button>
                      ))}
                      <input
                        type="text"
                        maxLength={1000}
                        value={l.responsibilityReason}
                        placeholder="Motiv (obligatoriu, intern)"
                        onChange={(e) =>
                          updateLine(l.saleLineId, {
                            responsibilityReason: e.target.value,
                          })
                        }
                        aria-label={`Motiv responsabil - ${l.title}`}
                        style={{ flex: "1 1 220px" }}
                      />
                    </div>
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>

      <label className={cancelStyles.field}>
        <span>Motivul returului (obligatoriu)</span>
        <textarea rows={2} maxLength={1000} value={draft.reason} onChange={(e) => setDraft((d) => ({ ...d, reason: e.target.value }))} />
      </label>

      <label className={cancelStyles.field}>
        <span>Metoda de rambursare</span>
        <select value={draft.refundMethod} onChange={(e) => setDraft((d) => ({ ...d, refundMethod: e.target.value }))}>
          <option value="CASH">Numerar</option>
          <option value="CARD">Card</option>
        </select>
      </label>

      <PreviewSummary preview={preview} />
      {problems.length > 0 && payload.lines.length > 0 && (
        <ul className={cancelStyles.errorText}>
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
      <p className={shared.subtle}>Fără bon fiscal / factură în această etapă; returul e o înregistrare internă.</p>
      {error && <div className={shared.error}>{error}</div>}
    </Modal>
  );
}

/* ===================== Anularea vânzării (VOID) ===================== */

export function SaleVoidModal({ sale, onClose, onDone }) {
  const [reason, setReason] = useState("");
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const keyRef = useRef({ signature: "", key: "" });

  useEffect(() => {
    api(`${POS_API}/sales/${encodeURIComponent(sale.id)}/returns/preview`, {
      method: "POST",
      body: { type: "VOID" },
    })
      .then(setPreview)
      .catch((err) => setError(errorMessage(err, "Nu am putut calcula anularea.")));
  }, [sale.id]);

  async function confirm() {
    if (reason.trim().length < 3 || !preview?.canConfirm) return;
    if (!window.confirm(`Anulezi vânzarea ${sale.receiptReference} și rambursezi ${formatLei(preview.totals.refundCents)}?`)) return;
    const sig = reason.trim();
    if (keyRef.current.signature !== sig) keyRef.current = { signature: sig, key: newIdempotencyKey() };
    setBusy(true);
    setError("");
    try {
      const res = await api(`${POS_API}/sales/${encodeURIComponent(sale.id)}/void`, {
        method: "POST",
        headers: { "Idempotency-Key": keyRef.current.key },
        body: { reason: reason.trim() },
      });
      onDone(`Vânzarea ${sale.receiptReference} a fost anulată (${res.saleReturn.reference}).`);
    } catch (err) {
      setError(errorMessage(err, "Anularea nu a reușit."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={`Anulează vânzarea - ${sale.receiptReference}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={cancelStyles.ghostBtn} onClick={onClose} disabled={busy}>
            Renunță
          </button>
          <button
            type="button"
            className={cancelStyles.dangerBtn}
            onClick={confirm}
            disabled={busy || reason.trim().length < 3 || !preview?.canConfirm}
          >
            {busy ? "Se anulează…" : "Anulează vânzarea"}
          </button>
        </>
      }
    >
      <p className={shared.subtle}>
        Anularea inversează toate liniile și pune toate bucățile înapoi în stocul târgului. Dacă un produs nu mai e vandabil, folosește
        „Retur / rambursare” cu starea potrivită.
      </p>
      <label className={cancelStyles.field}>
        <span>Motivul anulării (obligatoriu)</span>
        <textarea rows={2} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} />
      </label>
      <PreviewSummary preview={preview} />
      {error && <div className={shared.error}>{error}</div>}
    </Modal>
  );
}
