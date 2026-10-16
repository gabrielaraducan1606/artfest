// src/pages/Vendor/Fair/FairReturnsSection.jsx
//
// „Retururi de la Artfest” - produsele trimise înapoi vendorului (după
// anularea participării sau după târg). Vendorul confirmă ce a primit și cât
// readaugă în stocul online; implicit: tot ce a primit și e eligibil.

import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, Truck } from "lucide-react";
import { api } from "../../../lib/api";
import { formatDateTime } from "./fairInventory.js";
import {
  COST_PAYER_LABEL,
  DAMAGED_NOTICE,
  RETURNS_API,
  RETURN_METHOD_LABEL,
  RETURN_STATUS_LABEL,
  buildConfirmPayload,
  hasDifferences,
  initialConfirmState,
  newIdempotencyKey,
  updateReceived,
  updateReceivedDamaged,
  updateRestore,
} from "./fairReturns.js";
import styles from "./FairInventory.module.css";

const STATUS_TONE = {
  PREPARING: "muted",
  SHIPPED: "info",
  CONFIRMED: "success",
  CONFIRMED_WITH_DIFFERENCES: "danger",
};

function ConfirmForm({ ret, onDone }) {
  const [state, setState] = useState(() => initialConfirmState(ret));
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState({});
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  // aceeași cheie pentru retrimiterea aceleiași confirmări (dublu click / retry)
  const keyRef = useRef(newIdempotencyKey());

  async function onSubmit(event) {
    event.preventDefault();
    if (saving) return;
    const { errors: found, body } = buildConfirmPayload(ret, state, note.trim());
    setErrors(found);
    setError("");
    if (Object.keys(found).length) return;

    const diff = hasDifferences(ret, state);
    const ok = window.confirm(
      diff
        ? "Confirmi primirea cu diferențe față de ce a trimis Artfest? Echipa Artfest va verifica diferențele."
        : "Confirmi că ai primit toate produsele din acest retur?"
    );
    if (!ok) return;

    setSaving(true);
    try {
      await api(`${RETURNS_API}/${encodeURIComponent(ret.id)}/confirm`, {
        method: "POST",
        body,
        headers: { "Idempotency-Key": keyRef.current },
      });
      onDone(diff ? "Am înregistrat confirmarea și diferențele raportate." : "Primirea a fost confirmată.");
    } catch (err) {
      setErrors(err?.data?.fields || {});
      setError(err?.data?.message || err?.message || "Nu am putut confirma primirea.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className={styles.reception} onSubmit={onSubmit} noValidate aria-label={`Confirmă returul #${ret.number}`}>
      <p className={styles.hint}>
        Completează câte bucăți ai primit efectiv și câte vrei să readaugi în stocul online. Implicit readăugăm tot ce ai
        primit și se poate readăuga.
      </p>
      <ul className={styles.list}>
        {ret.lines.map((line) => {
          const entry = state[line.id];
          return (
            <li key={line.id} className={styles.item}>
              <div className={styles.itemBody}>
                <div className={styles.itemTitle}>
                  <strong>{line.title}</strong>
                  {line.variantLabel && <span>{line.variantLabel}</span>}
                  <span className={styles.code}>{line.barcodeDisplay}</span>
                </div>
                <p className={styles.muted}>
                  Trimise de Artfest: {line.sentQty}
                  {line.qtyDamaged > 0 ? ` + ${line.qtyDamaged} deteriorate` : ""}
                </p>
                <div className={styles.meta}>
                  {line.sentQty > 0 && (
                    <>
                      <label className={styles.field}>
                        <span className={styles.label}>Primite</span>
                        <input
                          className={styles.input}
                          type="number"
                          inputMode="numeric"
                          min={0}
                          max={line.sentQty}
                          value={entry.receivedQty}
                          onChange={(e) => setState((prev) => updateReceived(prev, line, e.target.value))}
                          aria-invalid={errors[line.id] ? "true" : undefined}
                        />
                      </label>
                      <label className={styles.field}>
                        <span className={styles.label}>Readaug online</span>
                        <input
                          className={styles.input}
                          type="number"
                          inputMode="numeric"
                          min={0}
                          max={line.restoreCap ?? 0}
                          value={entry.restoreOnlineQty}
                          disabled={!line.restoreCap}
                          onChange={(e) => setState((prev) => updateRestore(prev, line, e.target.value))}
                        />
                      </label>
                    </>
                  )}
                  {line.qtyDamaged > 0 && (
                    <label className={styles.field}>
                      <span className={styles.label}>Deteriorate primite</span>
                      <input
                        className={styles.input}
                        type="number"
                        inputMode="numeric"
                        min={0}
                        max={line.qtyDamaged}
                        value={entry.receivedDamagedQty}
                        onChange={(e) => setState((prev) => updateReceivedDamaged(prev, line, e.target.value))}
                        aria-invalid={errors[line.id] ? "true" : undefined}
                      />
                    </label>
                  )}
                </div>
                {line.qtyDamaged > 0 && <p className={styles.warning}>{DAMAGED_NOTICE}</p>}
                {line.sentQty > 0 && !line.restoreCap && (
                  <p className={styles.hint}>Stocul online al acestui produs nu a fost modificat pentru târg.</p>
                )}
                {errors[line.id] && <p className={styles.fieldError}>{errors[line.id]}</p>}
              </div>
            </li>
          );
        })}
      </ul>
      <label className={styles.field}>
        <span className={styles.label}>Observații (opțional)</span>
        <textarea className={styles.input} rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      {error && (
        <div className={styles.errorBox} role="alert">
          {error}
        </div>
      )}
      <div className={styles.itemActions}>
        <button type="submit" className={styles.btn} disabled={saving}>
          <CheckCircle2 size={16} aria-hidden="true" /> {saving ? "Se confirmă…" : "Confirmă primirea"}
        </button>
      </div>
    </form>
  );
}

export default function FairReturnsSection() {
  const [items, setItems] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [open, setOpen] = useState(null);

  const load = useCallback(async () => {
    try {
      const res = await api(RETURNS_API);
      setItems(Array.isArray(res?.items) ? res.items : []);
      setError("");
    } catch (err) {
      setError(err?.data?.message || err?.message || "Nu am putut încărca retururile.");
      setItems((prev) => prev || []);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (!items || items.length === 0) {
    return error ? (
      <section className={styles.section}>
        <div className={styles.errorBox} role="alert">
          {error}
        </div>
      </section>
    ) : null;
  }

  return (
    <section className={styles.section} aria-labelledby="fair-returns-title">
      <div className={styles.head}>
        <div>
          <h2 id="fair-returns-title" className={styles.title}>
            <Truck size={20} aria-hidden="true" /> Retururi de la Artfest
          </h2>
          <p className={styles.muted}>
            Produsele pe care Artfest ți le trimite înapoi. Stocul online revine doar după ce confirmi primirea.
          </p>
        </div>
      </div>

      {notice && (
        <div className={styles.successBox} role="status">
          {notice}
        </div>
      )}
      {error && (
        <div className={styles.errorBox} role="alert">
          {error}
        </div>
      )}

      <ul className={styles.list}>
        {items.map((ret) => (
          <li key={ret.id} className={styles.item}>
            <div className={styles.itemBody}>
              <div className={styles.itemHead}>
                <div className={styles.itemTitle}>
                  <strong>Retur #{ret.number}</strong>
                  <span>
                    {RETURN_METHOD_LABEL[ret.method] || ret.method} · cost suportat de {COST_PAYER_LABEL[ret.costPayer] || ret.costPayer}
                  </span>
                </div>
                <span className={`${styles.badge} ${styles[`tone_${STATUS_TONE[ret.status] || "muted"}`]}`}>
                  {RETURN_STATUS_LABEL[ret.status] || ret.status}
                </span>
              </div>

              <dl className={styles.meta}>
                <div>
                  <dt>Bucăți</dt>
                  <dd>{ret.totals.sent}</dd>
                </div>
                {ret.shippedAt && (
                  <div>
                    <dt>{ret.method === "PICKUP" ? "Predat la" : "Expediat la"}</dt>
                    <dd>{formatDateTime(ret.shippedAt)}</dd>
                  </div>
                )}
                {ret.trackingNumber && (
                  <div>
                    <dt>AWB</dt>
                    <dd className={styles.code}>
                      {ret.courierName ? `${ret.courierName} · ` : ""}
                      {ret.trackingNumber}
                    </dd>
                  </div>
                )}
                {ret.confirmedAt && (
                  <div>
                    <dt>Confirmat la</dt>
                    <dd>{formatDateTime(ret.confirmedAt)}</dd>
                  </div>
                )}
              </dl>

              {ret.status === "CONFIRMED_WITH_DIFFERENCES" && (
                <p className={styles.warning}>Ai raportat diferențe; echipa Artfest le verifică.</p>
              )}
              {ret.confirmedAt && (
                <ul className={styles.receptionMessages}>
                  {ret.lines.map((line) => (
                    <li key={line.id}>
                      {line.title}: primite {line.vendorReceivedQty ?? 0} din {line.sentQty}
                      {line.qtyDamaged > 0
                        ? ` · deteriorate primite ${line.vendorReceivedDamagedQty ?? 0} din ${line.qtyDamaged} (${DAMAGED_NOTICE})`
                        : ""}
                      {line.onlineRestoredQty > 0 ? ` · readăugate online ${line.onlineRestoredQty}` : ""}
                    </li>
                  ))}
                </ul>
              )}

              {ret.actions?.canConfirm &&
                (open === ret.id ? (
                  <ConfirmForm
                    ret={ret}
                    onDone={(message) => {
                      setOpen(null);
                      setNotice(message);
                      load();
                    }}
                  />
                ) : (
                  <div className={styles.itemActions}>
                    <button
                      type="button"
                      className={styles.btn}
                      onClick={() => {
                        setNotice("");
                        setOpen(ret.id);
                      }}
                    >
                      Am primit coletul
                    </button>
                  </div>
                ))}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
