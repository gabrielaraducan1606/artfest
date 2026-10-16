// src/pages/Admin/AdminDesktop/tabs/AdminFairCancellation.jsx
//
// Admin -> Târg Artfest: anularea unei participări APPROVED (separată de
// „Respinge”), istoricul deciziilor pe înscriere și returul produselor către
// vendor (creare, expediere / predare, anulare, confirmare în numele vendorului).

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../../../lib/api";
import shared from "../AdminDesktop.module.css";
import styles from "./AdminArtfestFairTab.module.css";
import {
  CAUSE_LABEL,
  CAUSE_OPTIONS,
  COST_PAYER_LABEL,
  EVENT_LABEL,
  FAIR_ADMIN_API,
  RETURN_METHOD_LABEL,
  RETURN_METHOD_OPTIONS,
  RETURN_REASON_LABEL,
  RETURN_STATUS_LABEL,
  buildReturnLines,
  canConfirmOnBehalf,
  cancellationImpact,
  fullConfirmationLines,
  initialReturnDraft,
  newIdempotencyKey,
  validateCancellation,
} from "./adminFairCancellation.js";

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("ro-RO", { timeZone: "Europe/Bucharest" });
}

function errorMessage(err, fallback) {
  return err?.data?.message || err?.message || fallback;
}

export function Modal({ title, onClose, children, footer, wide = false }) {
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className={styles.backdrop} onClick={onClose} role="presentation">
      <div
        className={`${styles.modal} ${wide ? styles.modalWide : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.modalHead}>
          <h3>{title}</h3>
          <button type="button" className={styles.ghostBtn} onClick={onClose} aria-label="Închide">
            ✕
          </button>
        </div>
        <div className={styles.modalBody}>{children}</div>
        {footer && <div className={styles.modalFoot}>{footer}</div>}
      </div>
    </div>
  );
}

/* ===================== Anulare participare ===================== */

export function CancelParticipationModal({ item, onClose, onDone }) {
  const [preview, setPreview] = useState(null);
  const [form, setForm] = useState({ cause: "", reason: "", messageForVendor: "", goodsAlreadyShipped: false });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // o singură cheie pentru această anulare (retrimiterea nu dublează efectele)
  const keyRef = useRef(newIdempotencyKey());

  useEffect(() => {
    api(`${FAIR_ADMIN_API}/registrations/${encodeURIComponent(item.id)}/cancellation-preview`)
      .then(setPreview)
      .catch((err) => setError(errorMessage(err, "Nu am putut încărca situația inventarului.")));
  }, [item.id]);

  const rules = form.cause && preview?.rules ? preview.rules[form.cause] : null;
  const impact = cancellationImpact(preview, form.goodsAlreadyShipped);

  function update(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => ({ ...prev, [field]: "" }));
  }

  async function onConfirm() {
    const found = validateCancellation(form);
    setErrors(found);
    if (Object.keys(found).length || busy) return;
    if (!window.confirm(`Anulezi participarea vendorului „${item.vendorName || "—"}”? Acțiunea este finală.`)) return;
    setBusy(true);
    setError("");
    try {
      const res = await api(`${FAIR_ADMIN_API}/registrations/${encodeURIComponent(item.id)}/cancel`, {
        method: "POST",
        headers: { "Idempotency-Key": keyRef.current },
        body: {
          cause: form.cause,
          reason: form.reason.trim(),
          messageForVendor: form.messageForVendor.trim() || undefined,
          goodsAlreadyShipped: form.goodsAlreadyShipped,
        },
      });
      onDone(res.item);
    } catch (err) {
      setErrors(err?.data?.fields || {});
      setError(errorMessage(err, "Anularea nu a reușit."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={`Anulează participarea - ${item.vendorName || "vendor"}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={styles.ghostBtn} onClick={onClose} disabled={busy}>
            Renunță
          </button>
          <button type="button" className={styles.dangerBtn} onClick={onConfirm} disabled={busy || !preview?.canCancel}>
            {busy ? "Se anulează…" : "Anulează participarea"}
          </button>
        </>
      }
    >
      <label className={styles.field}>
        <span>Cauza</span>
        <select value={form.cause} onChange={(e) => update("cause", e.target.value)} aria-invalid={errors.cause ? "true" : undefined}>
          <option value="">Alege cauza</option>
          {CAUSE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        {errors.cause && <span className={styles.errorText}>{errors.cause}</span>}
      </label>

      <label className={styles.field}>
        <span>Motiv intern (obligatoriu, NU este afișat vendorului)</span>
        <textarea rows={3} maxLength={2000} value={form.reason} onChange={(e) => update("reason", e.target.value)} />
        {errors.reason && <span className={styles.errorText}>{errors.reason}</span>}
      </label>

      <label className={styles.field}>
        <span>Mesaj pentru vendor (opțional; altfel se afișează mesajul standard)</span>
        <textarea rows={3} maxLength={2000} value={form.messageForVendor} onChange={(e) => update("messageForVendor", e.target.value)} />
      </label>

      <label className={styles.checkboxRow}>
        <input
          type="checkbox"
          checked={form.goodsAlreadyShipped}
          onChange={(e) => update("goodsAlreadyShipped", e.target.checked)}
        />
        <span>Produsele au fost deja expediate (rezervarea online rămâne până la returul fizic)</span>
      </label>

      {rules && (
        <div className={styles.result} role="status">
          <strong>Regula aplicabilă</strong>
          <span>{rules.feeRuleText}</span>
          <span>{rules.returnCostText}</span>
          <span className={shared.subtle}>Aplicația nu mută bani și nu modifică decontul.</span>
        </div>
      )}

      {preview && (
        <ul className={styles.stats}>
          {impact.map((row) => (
            <li key={row.label}>
              <strong>{row.value}</strong> {row.label.toLowerCase()}
            </li>
          ))}
        </ul>
      )}
      {preview && !preview.canCancel && <p className={styles.errorText}>Doar o participare aprobată poate fi anulată.</p>}
      {error && <div className={shared.error}>{error}</div>}
    </Modal>
  );
}

/* ===================== Istoric ===================== */

export function RegistrationHistory({ registrationId }) {
  const [items, setItems] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api(`${FAIR_ADMIN_API}/registrations/${encodeURIComponent(registrationId)}/events`)
      .then((res) => setItems(Array.isArray(res?.items) ? res.items : []))
      .catch((err) => setError(errorMessage(err, "Nu am putut încărca istoricul.")));
  }, [registrationId]);

  if (error) return <div className={shared.error}>{error}</div>;
  if (!items) return <p className={shared.subtle}>Se încarcă istoricul…</p>;
  if (!items.length) return <p className={shared.subtle}>Fără evenimente înregistrate.</p>;

  return (
    <ol className={styles.history}>
      {items.map((e) => (
        <li key={e.id}>
          <strong>{EVENT_LABEL[e.type] || e.type}</strong> · {formatDate(e.createdAt)}
          {e.metadata?.cause ? ` · ${CAUSE_LABEL[e.metadata.cause] || e.metadata.cause}` : ""}
          {e.metadata?.resubmission ? " · reînscriere" : ""}
          {e.metadata?.backfilled ? " · reconstituit" : ""}
          {e.reason && <div className={shared.subtle}>Motiv intern: {e.reason}</div>}
          {e.vendorMessage && <div className={shared.subtle}>Mesaj vendor: {e.vendorMessage}</div>}
        </li>
      ))}
    </ol>
  );
}

/* ===================== Retur către vendor ===================== */

function CreateReturnForm({ registration, onCreated, onCancel }) {
  const [candidates, setCandidates] = useState(null);
  const [draft, setDraft] = useState({});
  const [method, setMethod] = useState("COURIER_BY_ARTFEST");
  const [reason, setReason] = useState(registration.status === "CANCELLED" ? "PARTICIPATION_CANCELLED" : "FAIR_ENDED_UNSOLD");
  const [costPayer, setCostPayer] = useState("");
  const [costPayerReason, setCostPayerReason] = useState("");
  const [errors, setErrors] = useState({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api(`${FAIR_ADMIN_API}/returns/candidates?registrationId=${encodeURIComponent(registration.id)}`)
      .then((res) => {
        setCandidates(res.items || []);
        setDraft(initialReturnDraft(res.items));
        setCostPayer(res.suggestedCostPayer || "VENDOR");
      })
      .catch((err) => setError(errorMessage(err, "Nu am putut încărca produsele de returnat.")));
  }, [registration.id]);

  const derived = reason === "PARTICIPATION_CANCELLED" && registration.cancellation?.cause === "ARTFEST_DECISION" ? "ARTFEST" : "VENDOR";
  const overridden = costPayer && costPayer !== derived;

  async function onSubmit(event) {
    event.preventDefault();
    if (busy) return;
    const { errors: found, lines } = buildReturnLines(candidates, draft);
    setErrors(found);
    if (Object.keys(found).length) return;
    setBusy(true);
    setError("");
    try {
      const res = await api(`${FAIR_ADMIN_API}/returns`, {
        method: "POST",
        body: {
          registrationId: registration.id,
          reason,
          method,
          lines,
          ...(overridden ? { costPayer, costPayerReason } : {}),
        },
      });
      onCreated(res.item);
    } catch (err) {
      setErrors(err?.data?.fields || {});
      setError(errorMessage(err, "Nu am putut crea returul."));
    } finally {
      setBusy(false);
    }
  }

  if (!candidates) return error ? <div className={shared.error}>{error}</div> : <p className={shared.subtle}>Se încarcă…</p>;
  if (!candidates.length) {
    return (
      <div className={styles.subPanel}>
        <p className={shared.subtle}>Nu există produse la Artfest care să poată pleca într-un retur nou.</p>
        <button type="button" className={styles.ghostBtn} onClick={onCancel}>
          Închide
        </button>
      </div>
    );
  }

  return (
    <form className={styles.subPanel} onSubmit={onSubmit} noValidate>
      <strong>Retur nou</strong>
      <div className={styles.formRow}>
        <label className={styles.field}>
          <span>Motiv</span>
          <select value={reason} onChange={(e) => setReason(e.target.value)}>
            {Object.entries(RETURN_REASON_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          <span>Mod de retur</span>
          <select value={method} onChange={(e) => setMethod(e.target.value)}>
            {RETURN_METHOD_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          <span>Cost suportat de (implicit: {COST_PAYER_LABEL[derived]})</span>
          <select value={costPayer} onChange={(e) => setCostPayer(e.target.value)}>
            <option value="VENDOR">Vendor</option>
            <option value="ARTFEST">Artfest</option>
          </select>
        </label>
      </div>
      {overridden && (
        <label className={styles.field}>
          <span>Motivul schimbării costului (obligatoriu, rămâne în audit)</span>
          <input value={costPayerReason} onChange={(e) => setCostPayerReason(e.target.value)} maxLength={500} />
          {errors.costPayerReason && <span className={styles.errorText}>{errors.costPayerReason}</span>}
        </label>
      )}

      <table className={shared.table}>
        <thead>
          <tr>
            <th>Produs</th>
            <th>Vandabil (max)</th>
            <th>Refuzat (max)</th>
            <th>Deteriorat (max)</th>
          </tr>
        </thead>
        <tbody>
          {candidates.map((c) => (
            <tr key={c.inventoryItemId}>
              <td>
                {c.title}
                {c.variantLabel ? ` · ${c.variantLabel}` : ""}
                <div className={shared.subtle}>{c.barcodeDisplay}</div>
                {errors[c.inventoryItemId] && <div className={styles.errorText}>{errors[c.inventoryItemId]}</div>}
              </td>
              {[
                ["qtyFromStock", c.maxFromStock],
                ["qtyRejected", c.maxRejected],
                ["qtyDamaged", c.maxDamaged || 0],
              ].map(([field, max]) => (
                <td key={field}>
                  <input
                    className={styles.qtyInput}
                    type="number"
                    min={0}
                    max={max}
                    value={draft[c.inventoryItemId]?.[field] ?? "0"}
                    disabled={max === 0}
                    aria-label={`${c.title} - ${field}`}
                    onChange={(e) =>
                      setDraft((prev) => ({ ...prev, [c.inventoryItemId]: { ...prev[c.inventoryItemId], [field]: e.target.value } }))
                    }
                  />{" "}
                  / {max}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className={shared.subtle}>Bucățile deteriorate se returnează separat și nu revin niciodată în stocul online.</p>
      {errors._ && <p className={styles.errorText}>{errors._}</p>}
      {error && <div className={shared.error}>{error}</div>}
      <div className={styles.actions}>
        <button type="button" className={styles.ghostBtn} onClick={onCancel} disabled={busy}>
          Renunță
        </button>
        <button type="submit" className={styles.primaryBtn} disabled={busy}>
          {busy ? "Se creează…" : "Creează returul"}
        </button>
      </div>
    </form>
  );
}

function ShipForm({ ret, onDone, onCancel }) {
  const [courierName, setCourierName] = useState(ret.courierName || "");
  const [trackingNumber, setTrackingNumber] = useState(ret.trackingNumber || "");
  const [cost, setCost] = useState(ret.shippingCostCents != null ? String(ret.shippingCostCents / 100) : "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const keyRef = useRef(newIdempotencyKey());
  const pickup = ret.method === "PICKUP";

  async function onSubmit(event) {
    event.preventDefault();
    if (busy) return;
    const ok = window.confirm(
      pickup
        ? "Confirmi că produsele au fost predate vendorului? Stocul de la Artfest scade acum."
        : "Confirmi expedierea? Stocul de la Artfest scade acum; stocul online revine doar după confirmarea vendorului."
    );
    if (!ok) return;
    setBusy(true);
    setError("");
    try {
      const costCents = cost.trim() === "" ? null : Math.round(Number(cost.replace(",", ".")) * 100);
      const res = await api(`${FAIR_ADMIN_API}/returns/${encodeURIComponent(ret.id)}/ship`, {
        method: "POST",
        headers: { "Idempotency-Key": keyRef.current },
        body: pickup ? { shippingCostCents: costCents } : { courierName, trackingNumber, shippingCostCents: costCents },
      });
      onDone(res.item);
    } catch (err) {
      setError(errorMessage(err, "Nu am putut înregistra expedierea."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className={styles.subPanel} onSubmit={onSubmit} noValidate>
      <strong>{pickup ? "Predare către vendor" : "Expediere"}</strong>
      <div className={styles.formRow}>
        {!pickup && (
          <>
            <label className={styles.field}>
              <span>Curier (opțional)</span>
              <input value={courierName} onChange={(e) => setCourierName(e.target.value)} maxLength={80} />
            </label>
            <label className={styles.field}>
              <span>AWB (opțional)</span>
              <input value={trackingNumber} onChange={(e) => setTrackingNumber(e.target.value)} maxLength={80} />
            </label>
          </>
        )}
        <label className={styles.field}>
          <span>Cost transport, lei (informativ, nu intră în decont)</span>
          <input value={cost} onChange={(e) => setCost(e.target.value)} inputMode="decimal" />
        </label>
      </div>
      {error && <div className={shared.error}>{error}</div>}
      <div className={styles.actions}>
        <button type="button" className={styles.ghostBtn} onClick={onCancel} disabled={busy}>
          Renunță
        </button>
        <button type="submit" className={styles.primaryBtn} disabled={busy}>
          {busy ? "Se înregistrează…" : pickup ? "Confirmă predarea" : "Confirmă expedierea"}
        </button>
      </div>
    </form>
  );
}

function ConfirmOnBehalfForm({ ret, onDone, onCancel }) {
  const [quantities, setQuantities] = useState(() => Object.fromEntries(ret.lines.map((l) => [l.id, String(l.sentQty)])));
  const [damaged, setDamaged] = useState(() => Object.fromEntries(ret.lines.map((l) => [l.id, String(l.qtyDamaged || 0)])));
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const keyRef = useRef(newIdempotencyKey());

  async function onSubmit(event) {
    event.preventDefault();
    if (busy) return;
    if (reason.trim().length < 3) {
      setError("Motivul confirmării în numele vendorului este obligatoriu.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const lines = fullConfirmationLines(ret).map((l) => ({
        ...l,
        receivedQty: Number(quantities[l.returnLineId]),
        ...(l.receivedDamagedQty !== undefined ? { receivedDamagedQty: Number(damaged[l.returnLineId]) } : {}),
      }));
      const res = await api(`${FAIR_ADMIN_API}/returns/${encodeURIComponent(ret.id)}/confirm-on-behalf`, {
        method: "POST",
        headers: { "Idempotency-Key": keyRef.current },
        body: { lines, reason: reason.trim() },
      });
      onDone(res.item);
    } catch (err) {
      setError(errorMessage(err, "Confirmarea nu a reușit."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className={styles.subPanel} onSubmit={onSubmit} noValidate>
      <strong>Confirmare în numele vendorului</strong>
      <p className={shared.subtle}>
        Doar dacă vendorul nu a răspuns. Stocul online se readaugă implicit pentru cantitățile confirmate.
      </p>
      {ret.lines.map((l) => (
        <div key={l.id} className={styles.formRow}>
          {l.sentQty > 0 && (
            <label className={styles.field}>
              <span>
                {l.title} - nedeteriorate primite (trimise: {l.sentQty})
              </span>
              <input
                className={styles.qtyInput}
                type="number"
                min={0}
                max={l.sentQty}
                value={quantities[l.id]}
                onChange={(e) => setQuantities((prev) => ({ ...prev, [l.id]: e.target.value }))}
              />
            </label>
          )}
          {l.qtyDamaged > 0 && (
            <label className={styles.field}>
              <span>
                {l.title} - deteriorate primite (trimise: {l.qtyDamaged}; nu revin online)
              </span>
              <input
                className={styles.qtyInput}
                type="number"
                min={0}
                max={l.qtyDamaged}
                value={damaged[l.id]}
                onChange={(e) => setDamaged((prev) => ({ ...prev, [l.id]: e.target.value }))}
              />
            </label>
          )}
        </div>
      ))}
      <label className={styles.field}>
        <span>Motiv (obligatoriu, rămâne în audit)</span>
        <textarea rows={2} maxLength={2000} value={reason} onChange={(e) => setReason(e.target.value)} />
      </label>
      {error && <div className={shared.error}>{error}</div>}
      <div className={styles.actions}>
        <button type="button" className={styles.ghostBtn} onClick={onCancel} disabled={busy}>
          Renunță
        </button>
        <button type="submit" className={styles.primaryBtn} disabled={busy}>
          {busy ? "Se confirmă…" : "Confirmă primirea"}
        </button>
      </div>
    </form>
  );
}

function ReturnCard({ ret, onChanged }) {
  const [mode, setMode] = useState(null); // "ship" | "confirm"
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function cancelReturn() {
    if (busy || !window.confirm(`Anulezi returul #${ret.number}? Stocul nu se modifică.`)) return;
    setBusy(true);
    setError("");
    try {
      const res = await api(`${FAIR_ADMIN_API}/returns/${encodeURIComponent(ret.id)}/cancel`, { method: "POST", body: {} });
      onChanged(res.item);
    } catch (err) {
      setError(errorMessage(err, "Nu am putut anula returul."));
    } finally {
      setBusy(false);
    }
  }

  const onBehalfAllowed = canConfirmOnBehalf(ret);

  return (
    <li className={styles.returnCard}>
      <div className={styles.returnHead}>
        <strong>Retur #{ret.number}</strong>
        <span className={`${styles.badge} ${ret.needsClarification ? styles.toneDanger : ret.status === "CONFIRMED" ? styles.toneSuccess : styles.toneInfo}`}>
          {RETURN_STATUS_LABEL[ret.status] || ret.status}
        </span>
      </div>
      <p className={shared.subtle}>
        {RETURN_REASON_LABEL[ret.reason] || ret.reason} · {RETURN_METHOD_LABEL[ret.method] || ret.method} · cost: {COST_PAYER_LABEL[ret.costPayer]}
        {ret.trackingNumber ? ` · AWB ${ret.courierName ? `${ret.courierName} ` : ""}${ret.trackingNumber}` : ""}
        {ret.shippedAt ? ` · expediat ${formatDate(ret.shippedAt)}` : ""}
        {ret.confirmedAt ? ` · confirmat ${formatDate(ret.confirmedAt)}${ret.confirmedByAdmin ? " (de Admin)" : ""}` : ""}
      </p>
      <ul className={styles.returnLines}>
        {ret.lines.map((l) => (
          <li key={l.id}>
            {l.title}
            {l.variantLabel ? ` · ${l.variantLabel}` : ""}: vandabil {l.qtyFromStock}
            {l.qtyRejected ? ` · refuzat ${l.qtyRejected}` : ""}
            {l.qtyDamaged ? ` · deteriorat ${l.qtyDamaged} (nu revine online)` : ""}
            {l.vendorReceivedQty != null && ` · primite ${l.vendorReceivedQty}`}
            {l.vendorReceivedDamagedQty != null && ` · deteriorate primite ${l.vendorReceivedDamagedQty}`}
            {l.difference ? <strong className={styles.errorText}> · diferență {l.difference}</strong> : null}
            {l.onlineRestoredQty > 0 && ` · readăugate online ${l.onlineRestoredQty}`}
          </li>
        ))}
      </ul>
      {ret.needsClarification && <p className={styles.errorText}>De clarificat: vendorul a confirmat mai puțin decât s-a trimis.</p>}
      {ret.adminNotes && <p className={shared.subtle}>Notițe: {ret.adminNotes}</p>}
      {ret.confirmationNote && <p className={shared.subtle}>Motiv confirmare Admin: {ret.confirmationNote}</p>}

      <div className={styles.actions}>
        {ret.actions?.canShip && mode !== "ship" && (
          <button type="button" className={styles.primaryBtn} onClick={() => setMode("ship")} disabled={busy}>
            {ret.method === "PICKUP" ? "Predă vendorului" : "Marchează expediat"}
          </button>
        )}
        {ret.actions?.canCancel && (
          <button type="button" className={styles.ghostBtn} onClick={cancelReturn} disabled={busy}>
            Anulează returul
          </button>
        )}
        {ret.actions?.canConfirmOnBehalf && mode !== "confirm" && (
          <button
            type="button"
            className={styles.ghostBtn}
            onClick={() => setMode("confirm")}
            disabled={busy || !onBehalfAllowed}
            title={onBehalfAllowed ? "" : `Posibil de la ${formatDate(ret.actions.confirmOnBehalfFrom)}`}
          >
            Confirmă în numele vendorului
          </button>
        )}
      </div>
      {ret.actions?.canConfirmOnBehalf && !onBehalfAllowed && (
        <p className={shared.subtle}>Confirmarea în numele vendorului e posibilă de la {formatDate(ret.actions.confirmOnBehalfFrom)}.</p>
      )}
      {mode === "ship" && <ShipForm ret={ret} onCancel={() => setMode(null)} onDone={(next) => { setMode(null); onChanged(next); }} />}
      {mode === "confirm" && (
        <ConfirmOnBehalfForm ret={ret} onCancel={() => setMode(null)} onDone={(next) => { setMode(null); onChanged(next); }} />
      )}
      {error && <div className={shared.error}>{error}</div>}
    </li>
  );
}

export function RegistrationReturns({ registration }) {
  const [items, setItems] = useState(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await api(`${FAIR_ADMIN_API}/returns?registrationId=${encodeURIComponent(registration.id)}`);
      setItems(res.items || []);
    } catch (err) {
      setError(errorMessage(err, "Nu am putut încărca retururile."));
    }
  }, [registration.id]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className={styles.returnsBlock}>
      <div className={styles.returnHead}>
        <strong>Retururi către vendor</strong>
        {!creating && (
          <button type="button" className={styles.primaryBtn} onClick={() => setCreating(true)}>
            Retur nou
          </button>
        )}
      </div>
      {creating && (
        <CreateReturnForm
          registration={registration}
          onCancel={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            load();
          }}
        />
      )}
      {error && <div className={shared.error}>{error}</div>}
      {items && items.length === 0 && !creating && <p className={shared.subtle}>Niciun retur creat.</p>}
      {items && items.length > 0 && (
        <ul className={styles.returnList}>
          {items.map((ret) => (
            <ReturnCard key={ret.id} ret={ret} onChanged={() => load()} />
          ))}
        </ul>
      )}
    </div>
  );
}
