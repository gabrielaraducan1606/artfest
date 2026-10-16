// src/pages/Admin/AdminDesktop/tabs/AdminFairSettlementsPanel.jsx
//
// Admin -> Târg Artfest -> Deconturi: decont per vendor (vânzări + retururi +
// ajustări + sold reportat). Toate sumele sunt calculate pe server. Fără
// fiscalizare / factură / plată reală: „Marchează plătit” doar înregistrează o
// plată făcută în afara aplicației.

import { useCallback, useEffect, useState } from "react";
import { api } from "../../../../lib/api";
import shared from "../AdminDesktop.module.css";
import styles from "./AdminArtfestFairTab.module.css";
import { downloadLabelsPdf } from "../../../Vendor/Fair/fairInventory.js";
import {
  ADMIN_SETTLEMENTS_API as API,
  SETTLEMENT_STATUS_LABEL,
  defaultPeriod,
  formatDateRo,
  formatLei,
  parseLeiToCents,
  periodText,
  signedLei,
} from "../../../Vendor/Fair/fairSettlements.js";

const DISPOSITION_LABEL = { RESTOCKED: "Returnat, revandabil", NOT_RESTOCKED: "Returnat, nevandabil", NOT_RETURNED: "Rambursare fără produs" };
const TONE = { DRAFT: styles.toneMuted, FINALIZED: styles.toneInfo, PAID: styles.toneSuccess, CARRIED_FORWARD: styles.toneDanger, CANCELLED: styles.toneMuted };

function errorMessage(err, fallback) {
  return err?.data?.message || err?.message || fallback;
}

function Totals({ s }) {
  const rows = [
    ["Vânzări - valoare de listă", formatLei(s.listSalesCents)],
    ["Reduceri", formatLei(s.discountsCents)],
    ["Vânzări brute încasate", formatLei(s.grossSalesCents)],
    ["Comision Artfest", formatLei(s.commissionCents)],
    ["Net din vânzări", formatLei(s.vendorNetCents)],
    ["Rambursări către clienți (total)", formatLei(s.returnsRefundCents)],
    ["  din care suportate de vendor", formatLei(s.returnsRefundCents - s.artfestBorneRefundCents)],
    ["  din care suportate de Artfest", formatLei(s.artfestBorneRefundCents)],
    ["Comision inversat (imputat vendorului)", formatLei(s.commissionReversedCents)],
    ["Net retur care afectează vendorul", `-${formatLei(s.vendorNetReversedCents)}`],
    ["Ajustări", signedLei(s.adjustmentsCents)],
    ["Sold reportat", signedLei(s.carriedInCents)],
  ];
  return (
    <div className={styles.result}>
      {rows.map(([label, value]) => (
        <span key={label}>
          {label}: <strong>{value}</strong>
        </span>
      ))}
      <strong>
        Sumă finală (net vânzări − net retur + ajustări + sold reportat): {formatLei(s.finalDueCents)}
      </strong>
    </div>
  );
}

/* ===================== Generare ciornă ===================== */

function CreateDraft({ list, onCreated }) {
  const [vendorId, setVendorId] = useState("");
  const [period, setPeriod] = useState(() => defaultPeriod({ fairStartsAt: list.fair?.startsAt }));
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const vendor = list.vendors.find((v) => v.vendorId === vendorId);

  function chooseVendor(id) {
    setVendorId(id);
    setPreview(null);
    setError("");
    const v = list.vendors.find((x) => x.vendorId === id);
    setPeriod(defaultPeriod({ nextPeriodFrom: v?.nextPeriodFrom, fairStartsAt: list.fair?.startsAt }));
  }

  async function runPreview() {
    setBusy(true);
    setError("");
    try {
      setPreview(await api(`${API}/preview`, { method: "POST", body: { vendorId, ...period } }));
    } catch (err) {
      setPreview(null);
      setError(errorMessage(err, "Nu am putut calcula decontul."));
    } finally {
      setBusy(false);
    }
  }

  async function create() {
    setBusy(true);
    setError("");
    try {
      const res = await api(API, { method: "POST", body: { vendorId, ...period } });
      setPreview(null);
      onCreated(res.item);
    } catch (err) {
      setError(errorMessage(err, "Nu am putut genera ciorna."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles.subPanel} aria-label="Generează decont">
      <h3 className={styles.panelTitle}>Generează decont</h3>
      {!list.fair?.ended && (
        <p className={shared.subtle}>
          Târgul nu s-a încheiat încă. Decontul final se face de regulă după încheierea târgului; un retur ulterior
          intră într-un decont de corecție.
        </p>
      )}
      <div className={styles.formRow}>
        <label className={styles.field}>
          <span>Vendor</span>
          <select value={vendorId} onChange={(e) => chooseVendor(e.target.value)} aria-label="Vendor">
            <option value="">Alege vendorul</option>
            {list.vendors.map((v) => (
              <option key={v.vendorId} value={v.vendorId}>
                {v.vendorName || v.vendorId}
                {v.hasDraft ? " (are ciornă)" : ""}
                {v.registrationStatus === "CANCELLED" ? " (participare anulată)" : ""}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          <span>De la (inclusiv)</span>
          <input type="date" value={period.periodFrom} onChange={(e) => setPeriod((p) => ({ ...p, periodFrom: e.target.value }))} aria-label="De la" />
        </label>
        <label className={styles.field}>
          <span>Până la (inclusiv)</span>
          <input type="date" value={period.periodTo} onChange={(e) => setPeriod((p) => ({ ...p, periodTo: e.target.value }))} aria-label="Până la" />
        </label>
      </div>
      <div className={styles.actions}>
        <button type="button" className={styles.ghostBtn} disabled={!vendorId || busy} onClick={runPreview}>
          Calculează
        </button>
        <button type="button" className={styles.primaryBtn} disabled={!vendorId || busy || vendor?.hasDraft} onClick={create}>
          Generează draft
        </button>
      </div>
      {vendor?.hasDraft && <p className={styles.errorText}>Vendorul are deja o ciornă: finalizeaz-o sau anuleaz-o întâi.</p>}
      {preview && (
        <>
          <p className={shared.subtle}>
            Previzualizare (nimic salvat): {preview.saleLines} linii de vânzare ({preview.saleUnits} buc.), {preview.returnLines} linii de retur (
            {preview.returnUnits} buc.){preview.carriedFrom ? ` · preia soldul decontului #${preview.carriedFrom.sequence}` : ""}.
          </p>
          <Totals s={preview} />
        </>
      )}
      {error && <div className={shared.error}>{error}</div>}
    </section>
  );
}

/* ===================== Detaliu ===================== */

function AdjustmentForm({ settlement, onDone }) {
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [vendorNote, setVendorNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const cents = parseLeiToCents(amount);

  async function submit() {
    if (!cents || reason.trim().length < 3) return;
    if (!window.confirm(`Adaugi ajustarea ${signedLei(cents)}? Ajustările nu se pot edita sau șterge (corecția se face prin ajustare inversă).`)) return;
    setBusy(true);
    setError("");
    try {
      const res = await api(`${API}/${encodeURIComponent(settlement.id)}/adjustments`, {
        method: "POST",
        body: { amountCents: cents, reason: reason.trim(), ...(vendorNote.trim() ? { vendorNote: vendorNote.trim() } : {}) },
      });
      setAmount("");
      setReason("");
      setVendorNote("");
      onDone(res.item, `Ajustare ${signedLei(cents)} adăugată.`);
    } catch (err) {
      setError(errorMessage(err, "Nu am putut adăuga ajustarea."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.subPanel}>
      <strong>Adaugă ajustare</strong>
      <div className={styles.formRow}>
        <label className={styles.field}>
          <span>Sumă (lei; negativ = în defavoarea vendorului)</span>
          <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="ex. 15,50 sau -4" aria-label="Sumă ajustare" />
        </label>
        <label className={styles.field}>
          <span>Motiv intern (obligatoriu, NU îl vede vendorul)</span>
          <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={2000} aria-label="Motiv intern ajustare" />
        </label>
        <label className={styles.field}>
          <span>Notă pentru vendor (opțional)</span>
          <input value={vendorNote} onChange={(e) => setVendorNote(e.target.value)} maxLength={1000} aria-label="Notă pentru vendor" />
        </label>
      </div>
      {amount && cents === null && <span className={styles.errorText}>Sumă invalidă (maximum 2 zecimale).</span>}
      {cents === 0 && <span className={styles.errorText}>Suma trebuie să fie diferită de 0.</span>}
      <div className={styles.actions}>
        <button type="button" className={styles.ghostBtn} disabled={busy || !cents || reason.trim().length < 3} onClick={submit}>
          Adaugă ajustare
        </button>
      </div>
      {error && <div className={shared.error}>{error}</div>}
    </div>
  );
}

function MarkPaidForm({ settlement, onDone }) {
  const [reference, setReference] = useState("");
  const [paidAt, setPaidAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    if (!reference.trim()) return;
    if (!window.confirm(`Marchezi decontul ca plătit (${formatLei(settlement.finalDueCents)})? Aplicația NU face transferul; doar înregistrează plata.`)) return;
    setBusy(true);
    setError("");
    try {
      const res = await api(`${API}/${encodeURIComponent(settlement.id)}/mark-paid`, {
        method: "POST",
        body: { paymentReference: reference.trim(), ...(paidAt ? { paidAt: `${paidAt}T12:00:00` } : {}) },
      });
      onDone(res.item, "Decont marcat plătit.");
    } catch (err) {
      setError(errorMessage(err, "Nu am putut marca plata."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.subPanel}>
      <strong>Marchează plătit (plata se face în afara aplicației)</strong>
      <div className={styles.formRow}>
        <label className={styles.field}>
          <span>Referința plății (obligatoriu)</span>
          <input value={reference} onChange={(e) => setReference(e.target.value)} maxLength={120} aria-label="Referința plății" />
        </label>
        <label className={styles.field}>
          <span>Data plății (implicit azi)</span>
          <input type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} aria-label="Data plății" />
        </label>
      </div>
      <div className={styles.actions}>
        <button type="button" className={styles.successBtn} disabled={busy || !reference.trim()} onClick={submit}>
          Marchează plătit
        </button>
      </div>
      {error && <div className={shared.error}>{error}</div>}
    </div>
  );
}

function SettlementDetail({ id, onChanged, onClose }) {
  const [s, setS] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setS((await api(`${API}/${encodeURIComponent(id)}`)).item);
      setError("");
    } catch (err) {
      setError(errorMessage(err, "Nu am putut încărca decontul."));
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  function applied(item, message) {
    setS(item);
    setNotice(message);
    setError("");
    onChanged();
  }

  async function action(path, message, confirmText) {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(true);
    setNotice("");
    try {
      const res = await api(`${API}/${encodeURIComponent(id)}/${path}`, { method: "POST" });
      applied(res.item, message);
    } catch (err) {
      setError(errorMessage(err, "Operația nu a reușit."));
    } finally {
      setBusy(false);
    }
  }

  async function csv() {
    try {
      await downloadLabelsPdf(`${API}/${encodeURIComponent(id)}.csv`, `decont-${s.sequence}-${(s.vendorName || s.vendorId).replace(/[^\w-]+/g, "_")}.csv`, "Nu am putut exporta decontul.");
    } catch (err) {
      setError(err?.message || "Nu am putut exporta decontul.");
    }
  }

  if (error && !s) return <div className={shared.error}>{error}</div>;
  if (!s) return <p className={shared.subtle}>Se încarcă…</p>;

  return (
    <section className={styles.subPanel} aria-label={`Decont ${s.label}`}>
      <div className={styles.toolbar}>
        <h3 className={styles.panelTitle}>
          {s.vendorName || s.vendorId} · {s.label} · {periodText(s.periodFrom, s.periodTo)}{" "}
          <span className={`${styles.badge} ${TONE[s.status] || ""}`}>{SETTLEMENT_STATUS_LABEL[s.status] || s.status}</span>
        </h3>
        <div className={styles.actions}>
          {s.actions.canRecalculate && (
            <button type="button" className={styles.ghostBtn} disabled={busy} onClick={() => action("recalculate", "Decont recalculat.")}>
              Recalculează
            </button>
          )}
          {s.actions.canFinalize && (
            <button
              type="button"
              className={styles.primaryBtn}
              disabled={busy}
              onClick={() =>
                action(
                  "finalize",
                  "Decont finalizat.",
                  s.finalDueCents < 0
                    ? `Soldul este negativ (${signedLei(s.finalDueCents)}). Decontul devine „Sold reportat” și soldul trece în decontul următor. Continui?`
                    : `Finalizezi decontul (${formatLei(s.finalDueCents)})? După finalizare nu se mai poate modifica.`
                )
              }
            >
              Finalizează
            </button>
          )}
          {s.actions.canCancel && (
            <button type="button" className={styles.dangerBtn} disabled={busy} onClick={() => action("cancel", "Ciornă anulată.", "Anulezi ciorna? Liniile și soldul preluat se eliberează.")}>
              Anulează ciorna
            </button>
          )}
          <button type="button" className={styles.ghostBtn} onClick={csv}>
            Export CSV
          </button>
          <button type="button" className={styles.ghostBtn} onClick={onClose}>
            Închide
          </button>
        </div>
      </div>
      {notice && <div className={shared.success}>{notice}</div>}
      {error && <div className={shared.error}>{error}</div>}
      {!s.consistent && <p className={styles.errorText}>Totalurile nu corespund cu intrările - recalculează decontul.</p>}

      <Totals s={s} />
      <p className={shared.subtle}>
        {s.carriedFrom ? `Sold preluat din decontul #${s.carriedFrom.sequence}: ${signedLei(s.carriedFrom.finalDueCents)}. ` : ""}
        {s.carriedInto ? `Soldul acestui decont a fost preluat în decontul #${s.carriedInto.sequence}. ` : ""}
        {s.finalizedAt ? `Finalizat la ${formatDateRo(s.finalizedAt)}. ` : ""}
        {s.paidAt ? `Plătit la ${formatDateRo(s.paidAt)} · referință ${s.paymentReference}. ` : ""}
        Document intern - nu este factură.
      </p>

      {s.actions.canAdjust && <AdjustmentForm settlement={s} onDone={applied} />}
      {s.actions.canMarkPaid && <MarkPaidForm settlement={s} onDone={applied} />}

      <h4>Linii de vânzare incluse ({s.saleLines.length})</h4>
      {s.saleLines.length === 0 ? (
        <p className={shared.subtle}>Nicio linie de vânzare.</p>
      ) : (
        <table className={shared.table}>
          <thead>
            <tr>
              <th>Vânzare</th>
              <th>Produs</th>
              <th>Cant.</th>
              <th>Listă</th>
              <th>Reducere</th>
              <th>Încasat</th>
              <th>Comision</th>
              <th>Net</th>
            </tr>
          </thead>
          <tbody>
            {s.saleLines.map((l) => (
              <tr key={l.id}>
                <td>{l.receiptReference}</td>
                <td>
                  {l.title}
                  {l.variantLabel ? ` (${l.variantLabel})` : ""}
                </td>
                <td>{l.quantity}</td>
                <td>{formatLei(l.lineListCents)}</td>
                <td>
                  {l.lineDiscountCents ? `-${formatLei(l.lineDiscountCents)}` : "—"}
                  {l.artfestFundedDiscountCents ? <div className={shared.subtle}>compensație Artfest {formatLei(l.artfestFundedDiscountCents)}</div> : null}
                </td>
                <td>{formatLei(l.lineGrossCents)}</td>
                <td>{formatLei(l.commissionCents)}</td>
                <td>{formatLei(l.vendorNetCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h4>Linii de retur incluse ({s.returnLines.length})</h4>
      {s.returnLines.length === 0 ? (
        <p className={shared.subtle}>Niciun retur.</p>
      ) : (
        <table className={shared.table}>
          <thead>
            <tr>
              <th>Retur</th>
              <th>Produs</th>
              <th>Cant.</th>
              <th>Stare</th>
              <th>Rambursat</th>
              <th>Suportat de</th>
              <th>Net retur aplicat</th>
              <th>Valori originale (audit)</th>
            </tr>
          </thead>
          <tbody>
            {s.returnLines.map((r) => (
              <tr key={r.id}>
                <td>
                  {r.reference}
                  <div className={shared.subtle}>{formatDateRo(r.createdAt)}</div>
                </td>
                <td>{r.title}</td>
                <td>{r.quantity}</td>
                <td>{DISPOSITION_LABEL[r.disposition] || r.disposition}</td>
                <td>{formatLei(r.refundCents)}</td>
                <td>
                  {r.refundResponsibility === "ARTFEST" ? "Artfest" : r.refundResponsibility === "VENDOR" ? "Vendor" : "Vendor (retur normal)"}
                  {r.responsibilityReason && <div className={shared.subtle}>{r.responsibilityReason}</div>}
                </td>
                <td>{r.affectsVendorNet ? `-${formatLei(-r.entry.vendorNetCents)}` : "0,00 lei (vendor neafectat)"}</td>
                <td className={shared.subtle}>
                  comision {formatLei(r.commissionReversedCents)} · net {formatLei(r.vendorNetReversedCents)}
                  {r.artfestFundedReversedCents ? ` · compensație ${formatLei(r.artfestFundedReversedCents)}` : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h4>Ajustări ({s.adjustments.length})</h4>
      {s.adjustments.length === 0 ? (
        <p className={shared.subtle}>Nicio ajustare.</p>
      ) : (
        <table className={shared.table}>
          <thead>
            <tr>
              <th>Data</th>
              <th>Sumă</th>
              <th>Motiv intern</th>
              <th>Notă pentru vendor</th>
            </tr>
          </thead>
          <tbody>
            {s.adjustments.map((a) => (
              <tr key={a.id}>
                <td>{formatDateRo(a.createdAt)}</td>
                <td>{signedLei(a.amountCents)}</td>
                <td>{a.reason}</td>
                <td>{a.vendorNote || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

/* ===================== Panou ===================== */

export default function AdminFairSettlementsPanel() {
  const [list, setList] = useState(null);
  const [error, setError] = useState("");
  const [openId, setOpenId] = useState(null);

  const load = useCallback(async () => {
    try {
      setList(await api(API));
      setError("");
    } catch (err) {
      setError(errorMessage(err, "Nu am putut încărca deconturile."));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (error && !list) return <div className={shared.error}>{error}</div>;
  if (!list) return <p className={shared.subtle}>Se încarcă…</p>;

  return (
    <div className={styles.panel}>
      <CreateDraft
        key={list.items.length}
        list={list}
        onCreated={(item) => {
          setOpenId(item.id);
          load();
        }}
      />

      <section className={styles.subPanel} aria-label="Deconturi">
        <div className={styles.toolbar}>
          <h3 className={styles.panelTitle}>Deconturi</h3>
          <button type="button" className={styles.ghostBtn} onClick={load}>
            Actualizează
          </button>
        </div>
        {list.items.length === 0 ? (
          <p className={shared.subtle}>Niciun decont încă.</p>
        ) : (
          <table className={shared.table}>
            <thead>
              <tr>
                <th>Vendor</th>
                <th>Decont</th>
                <th>Perioadă</th>
                <th>Brut</th>
                <th>Comision</th>
                <th>Retururi</th>
                <th>Suportat de Artfest</th>
                <th>Net</th>
                <th>Sumă finală</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.items.map((s) => (
                <tr key={s.id}>
                  <td>{s.vendorName || s.vendorId}</td>
                  <td>{s.label}</td>
                  <td>{periodText(s.periodFrom, s.periodTo)}</td>
                  <td>{formatLei(s.grossSalesCents)}</td>
                  <td>{formatLei(s.commissionCents)}</td>
                  <td>{formatLei(s.returnsRefundCents)}</td>
                  <td>{formatLei(s.artfestBorneRefundCents)}</td>
                  <td>{formatLei(s.vendorNetCents - s.vendorNetReversedCents)}</td>
                  <td>
                    <strong>{formatLei(s.finalDueCents)}</strong>
                  </td>
                  <td>
                    <span className={`${styles.badge} ${TONE[s.status] || ""}`}>{SETTLEMENT_STATUS_LABEL[s.status] || s.status}</span>
                  </td>
                  <td>
                    <button type="button" className={styles.ghostBtn} onClick={() => setOpenId(s.id)}>
                      Detalii
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {openId && <SettlementDetail key={openId} id={openId} onChanged={load} onClose={() => setOpenId(null)} />}
    </div>
  );
}
