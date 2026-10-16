// src/pages/Admin/AdminDesktop/tabs/AdminFairPosPanel.jsx
//
// Admin -> Târg Artfest -> POS / Vânzare (MVP, fără fiscalizare).
// Scanner (tastatură / USB 1D, Enter) -> coș -> preview calculat pe server ->
// CASH / CARD -> vânzare atomică cu Idempotency-Key. Numărul intern
// (ex. TA26-000123) NU este bon fiscal.

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { api } from "../../../../lib/api";
import shared from "../AdminDesktop.module.css";
import styles from "./AdminFairPos.module.css";
import {
  DISPOSITION_LABEL,
  PAYMENT_LABEL,
  POS_API,
  RESPONSIBILITY_LABEL,
  RETURN_TYPE_LABEL,
  SALE_STATUS_LABEL,
  canSubmit,
  cartPayload,
  cartSignature,
  formatLei,
  initialPosState,
  newIdempotencyKey,
  normalizeBarcode,
  posReducer,
} from "./adminFairPos.js";
import { downloadLabelsPdf } from "../../../Vendor/Fair/fairInventory.js";
import { SaleReturnModal, SaleVoidModal } from "./AdminFairSaleReturn.jsx";
import { isValidDate, reportUrl, todayFairDate } from "../../../Vendor/Fair/fairSales.js";

function errorMessage(err, fallback) {
  const problems = err?.data?.problems;
  if (Array.isArray(problems) && problems.length) {
    return problems.map((p) => `${p.title || "Produs"}: ${(p.messages || []).join(" ")}`).join(" · ");
  }
  return err?.data?.message || err?.message || fallback;
}

function formatDate(value) {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("ro-RO", { timeZone: "Europe/Bucharest" });
}

/* ===================== Vânzare ===================== */

function SalePanel({ salesOpen }) {
  const [state, dispatch] = useReducer(posReducer, initialPosState);
  const [code, setCode] = useState("");
  const [preview, setPreview] = useState(null);
  const [previewError, setPreviewError] = useState("");
  const scanRef = useRef(null);
  // o cheie per coș + metodă: retry / dublu click => aceeași vânzare pe server
  const keyRef = useRef({ signature: "", key: "" });

  const focusScanner = useCallback(() => {
    requestAnimationFrame(() => scanRef.current?.focus());
  }, []);

  useEffect(() => {
    focusScanner();
  }, [focusScanner, state.cart.length, state.lastSale]);

  // focus permanent: orice tastă apăsată fără un câmp activ merge în scanner
  useEffect(() => {
    const onKey = (e) => {
      const active = document.activeElement;
      const typing = active && ["INPUT", "TEXTAREA", "SELECT"].includes(active.tagName);
      if (!typing && e.key.length === 1) focusScanner();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focusScanner]);

  const signature = cartSignature(state.cart);
  useEffect(() => {
    if (!state.cart.length) {
      setPreview(null);
      setPreviewError("");
      return undefined;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const res = await api(`${POS_API}/preview`, { method: "POST", body: { lines: JSON.parse(signature) } });
        if (!cancelled) {
          setPreview(res);
          setPreviewError("");
        }
      } catch (err) {
        if (!cancelled) setPreviewError(errorMessage(err, "Nu am putut calcula totalul."));
      }
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [signature, state.cart.length]);

  async function onScan(event) {
    event.preventDefault();
    const barcode = normalizeBarcode(code);
    setCode("");
    if (!barcode) return;
    try {
      const res = await api(`${POS_API}/scan?barcode=${encodeURIComponent(barcode)}`);
      dispatch({ type: "SCANNED", item: res.item });
    } catch (err) {
      dispatch({ type: "SCAN_ERROR", message: errorMessage(err, "Codul nu a fost găsit.") });
    } finally {
      focusScanner();
    }
  }

  async function pay(paymentMethod) {
    if (!canSubmit(state, preview)) return;
    const sig = `${signature}|${paymentMethod}`;
    if (keyRef.current.signature !== sig) keyRef.current = { signature: sig, key: newIdempotencyKey() };
    const total = preview?.totals?.totalPaidCents;
    if (!window.confirm(`Confirmi încasarea ${formatLei(total)} prin ${PAYMENT_LABEL[paymentMethod].toLowerCase()}?`)) return;

    dispatch({ type: "SUBMIT_START" });
    try {
      const res = await api(`${POS_API}/sales`, {
        method: "POST",
        headers: { "Idempotency-Key": keyRef.current.key },
        body: { lines: cartPayload(state.cart), paymentMethod },
      });
      keyRef.current = { signature: "", key: "" };
      dispatch({ type: "SUBMIT_SUCCESS", sale: res.sale });
    } catch (err) {
      dispatch({ type: "SUBMIT_ERROR", message: errorMessage(err, "Vânzarea nu a reușit.") });
    } finally {
      focusScanner();
    }
  }

  const problems = new Map((preview?.problems || []).map((p) => [p.inventoryItemId, p]));
  const priced = new Map((preview?.lines || []).map((l) => [l.inventoryItemId, l]));

  return (
    <div className={styles.layout}>
      <section className={styles.cartCol} aria-label="Coș">
        <form className={styles.scanRow} onSubmit={onScan}>
          <input
            ref={scanRef}
            className={styles.scanInput}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="Scanează codul de bare (sau tastează AF… și Enter)"
            aria-label="Cod de bare"
            autoComplete="off"
            disabled={state.busy}
          />
          <button type="submit" className={styles.ghostBtn} disabled={state.busy}>
            Adaugă
          </button>
        </form>
        {!salesOpen && <p className={styles.warning}>Vânzările sunt închise. Deschide-le din bara de sus.</p>}
        {state.error && (
          <div className={shared.error} role="alert">
            {state.error}
          </div>
        )}

        {state.lastSale && !state.cart.length ? (
          <div className={styles.success} role="status">
            <strong>Vânzare înregistrată: {state.lastSale.receiptReference}</strong>
            <span>
              Total {formatLei(state.lastSale.totalPaidCents)} · {PAYMENT_LABEL[state.lastSale.paymentMethod]}
            </span>
            <ul>
              {state.lastSale.lines.map((l) => (
                <li key={l.id}>
                  {l.title} × {l.quantity} - {formatLei(l.lineGrossCents)}
                </li>
              ))}
            </ul>
            <span className={shared.subtle}>Număr intern de vânzare - nu este bon fiscal.</span>
            <button
              type="button"
              className={styles.primaryBtn}
              onClick={() => {
                dispatch({ type: "NEW_SALE" });
                focusScanner();
              }}
            >
              Vânzare nouă
            </button>
          </div>
        ) : state.cart.length === 0 ? (
          <p className={shared.subtle}>Coșul e gol. Scanează primul produs.</p>
        ) : (
          <table className={shared.table}>
            <thead>
              <tr>
                <th>Produs</th>
                <th>Vendor</th>
                <th>Preț</th>
                <th>Cantitate</th>
                <th>Subtotal</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {state.cart.map((l) => {
                const p = priced.get(l.inventoryItemId);
                const problem = problems.get(l.inventoryItemId);
                return (
                  <tr key={l.inventoryItemId} className={problem ? styles.rowError : undefined}>
                    <td>
                      <strong>{l.title}</strong>
                      {l.variantLabel && <div className={shared.subtle}>{l.variantLabel}</div>}
                      <div className={shared.subtle}>{l.barcodeDisplay}</div>
                      {p?.discount && (
                        <div className={styles.discount}>
                          Reducere „{p.discount.name}”: −{formatLei(p.lineDiscountCents)}
                        </div>
                      )}
                      {problem && <div className={styles.errorText}>{problem.messages.join(" ")}</div>}
                    </td>
                    <td>{l.vendorName || "—"}</td>
                    <td>{formatLei(l.priceCents)}</td>
                    <td>
                      <div className={styles.qty}>
                        <button type="button" onClick={() => dispatch({ type: "DEC", inventoryItemId: l.inventoryItemId })} disabled={state.busy || l.quantity <= 1} aria-label="Scade">
                          −
                        </button>
                        <input
                          type="number"
                          min={1}
                          max={l.availableQty}
                          value={l.quantity}
                          onChange={(e) => dispatch({ type: "SET_QTY", inventoryItemId: l.inventoryItemId, quantity: e.target.value })}
                          disabled={state.busy}
                          aria-label={`Cantitate ${l.title}`}
                        />
                        <button type="button" onClick={() => dispatch({ type: "INC", inventoryItemId: l.inventoryItemId })} disabled={state.busy || l.quantity >= l.availableQty} aria-label="Crește">
                          +
                        </button>
                      </div>
                      <div className={shared.subtle}>max {l.availableQty}</div>
                    </td>
                    <td>{p ? formatLei(p.lineGrossCents) : "…"}</td>
                    <td>
                      <button type="button" className={styles.ghostBtn} onClick={() => dispatch({ type: "REMOVE", inventoryItemId: l.inventoryItemId })} disabled={state.busy}>
                        Elimină
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      <aside className={styles.summaryCol} aria-label="Total">
        <h4>Total</h4>
        {previewError && <div className={shared.error}>{previewError}</div>}
        {preview && state.cart.length > 0 ? (
          <>
            <dl className={styles.totals}>
              <div>
                <dt>Preț de listă</dt>
                <dd>{formatLei(preview.totals.listCents)}</dd>
              </div>
              <div>
                <dt>Reduceri</dt>
                <dd>−{formatLei(preview.totals.discountCents)}</dd>
              </div>
              <div className={styles.grand}>
                <dt>De plată</dt>
                <dd>{formatLei(preview.totals.totalPaidCents)}</dd>
              </div>
            </dl>
            <details className={styles.breakdown}>
              <summary>Pe vendor (comision {preview.commissionBps / 100}%)</summary>
              <ul>
                {preview.vendors.map((v) => (
                  <li key={v.vendorId}>
                    {v.vendorName || v.vendorId}: {formatLei(v.grossCents)} · comision {formatLei(v.commissionCents)} · net{" "}
                    {formatLei(v.vendorNetCents)}
                  </li>
                ))}
              </ul>
            </details>
            <div className={styles.payRow}>
              {["CASH", "CARD"].map((method) => (
                <button
                  key={method}
                  type="button"
                  className={styles.payBtn}
                  onClick={() => pay(method)}
                  disabled={!salesOpen || !canSubmit(state, preview)}
                >
                  {state.busy ? "Se înregistrează…" : `Încasează ${PAYMENT_LABEL[method].toLowerCase()}`}
                </button>
              ))}
            </div>
            {!preview.canConfirm && <p className={styles.errorText}>Elimină sau corectează produsele marcate.</p>}
          </>
        ) : (
          <p className={shared.subtle}>—</p>
        )}
      </aside>
    </div>
  );
}

/* ===================== Vânzări ===================== */

function SalesHistory() {
  const [items, setItems] = useState(null);
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [modal, setModal] = useState(null); // "return" | "void"

  const loadList = useCallback(async () => {
    try {
      const res = await api(`${POS_API}/sales`);
      setItems(res.items || []);
    } catch (err) {
      setError(errorMessage(err, "Nu am putut încărca vânzările."));
    }
  }, []);

  useEffect(() => {
    loadList();
  }, [loadList]);

  // doar ultima vânzare deschisă poate actualiza detaliul (altfel o reîncărcare
  // întârziată ar putea pune înapoi altă vânzare sub butoanele de retur / anulare)
  const openSeq = useRef(0);

  async function open(id, message = "") {
    const seq = ++openSeq.current;
    setDetail((current) => (current?.id === id ? current : null));
    setNotice(message);
    try {
      const res = await api(`${POS_API}/sales/${encodeURIComponent(id)}`);
      if (seq === openSeq.current) setDetail(res.item);
    } catch (err) {
      if (seq === openSeq.current) setError(errorMessage(err, "Nu am putut încărca vânzarea."));
    }
  }

  async function afterReturn(message) {
    setModal(null);
    await Promise.all([loadList(), detail ? open(detail.id, message) : null]);
  }

  if (error) return <div className={shared.error}>{error}</div>;
  if (!items) return <p className={shared.subtle}>Se încarcă…</p>;
  if (!items.length) return <p className={shared.subtle}>Nicio vânzare încă.</p>;

  return (
    <div className={styles.history}>
      <table className={shared.table}>
        <thead>
          <tr>
            <th>Număr</th>
            <th>Data</th>
            <th>Total</th>
            <th>Plată</th>
            <th>Status</th>
            <th>Produse</th>
            <th>Returnate</th>
            <th>Vendori</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {items.map((s) => (
            <tr key={s.id}>
              <td>{s.receiptReference}</td>
              <td>{formatDate(s.soldAt)}</td>
              <td>{formatLei(s.totalPaidCents)}</td>
              <td>{PAYMENT_LABEL[s.paymentMethod] || s.paymentMethod}</td>
              <td>{SALE_STATUS_LABEL[s.status] || s.status}</td>
              <td>{s.units}</td>
              <td>{s.returnedUnits || "—"}</td>
              <td>{s.vendors.join(", ")}</td>
              <td>
                <button type="button" className={styles.ghostBtn} onClick={() => open(s.id)}>
                  Detalii
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {detail && (
        <section className={styles.detail} aria-label={`Vânzarea ${detail.receiptReference}`}>
          <div className={styles.detailHead}>
            <h4>
              {detail.receiptReference} · {formatLei(detail.totalPaidCents)} · {PAYMENT_LABEL[detail.paymentMethod]} ·{" "}
              {SALE_STATUS_LABEL[detail.status] || detail.status}
            </h4>
            <div className={styles.detailActions}>
              {detail.actions?.canReturn && (
                <button type="button" className={styles.ghostBtn} onClick={() => setModal("return")}>
                  Retur / rambursare
                </button>
              )}
              {detail.actions?.canVoid && (
                <button type="button" className={styles.ghostBtn} onClick={() => setModal("void")}>
                  Anulează vânzarea
                </button>
              )}
              <button type="button" className={styles.ghostBtn} onClick={() => setDetail(null)}>
                Închide
              </button>
            </div>
          </div>
          {notice && <div className={styles.success}>{notice}</div>}
          <p className={shared.subtle}>Număr intern de vânzare - nu este bon fiscal. {formatDate(detail.soldAt)}</p>
          <table className={shared.table}>
            <thead>
              <tr>
                <th>Produs</th>
                <th>Vendor</th>
                <th>Cant.</th>
                <th>Returnat</th>
                <th>Listă</th>
                <th>Reducere</th>
                <th>Încasat</th>
                <th>Comision</th>
                <th>Net vendor</th>
                <th>Mișcare stoc</th>
              </tr>
            </thead>
            <tbody>
              {detail.lines.map((l) => (
                <tr key={l.id}>
                  <td>
                    {l.title}
                    <div className={shared.subtle}>{l.barcodeDisplay}</div>
                  </td>
                  <td>{l.vendorName || "—"}</td>
                  <td>{l.quantity}</td>
                  <td>{l.returnedQty || "—"}</td>
                  <td>{formatLei(l.lineListCents)}</td>
                  <td>
                    {l.lineDiscountCents ? `−${formatLei(l.lineDiscountCents)}` : "—"}
                    {l.discount && (
                      <div className={shared.subtle}>
                        {l.discount.name} ({l.discount.fundingSource === "ARTFEST" ? "finanțată de Artfest" : "finanțată de vendor"})
                      </div>
                    )}
                  </td>
                  <td>{formatLei(l.lineGrossCents)}</td>
                  <td>{formatLei(l.commissionCents)}</td>
                  <td>{formatLei(l.vendorNetCents)}</td>
                  <td className={shared.subtle}>{l.movements.map((m) => `${m.type} ${m.quantity} · ${m.id}`).join(", ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <ul className={styles.vendorTotals}>
            {detail.vendors.map((v) => (
              <li key={v.vendorId}>
                {v.vendorName || v.vendorId}: încasat {formatLei(v.grossCents)} · comision {formatLei(v.commissionCents)} · net{" "}
                {formatLei(v.vendorNetCents)}
                {v.artfestFundedDiscountCents ? ` (din care compensație Artfest ${formatLei(v.artfestFundedDiscountCents)})` : ""}
              </li>
            ))}
          </ul>
          {detail.returns?.length > 0 && (
            <>
              <h4>Retururi / anulări · rambursat {formatLei(detail.refundedCents)}</h4>
              <ul className={styles.vendorTotals}>
                {detail.returns.map((r) => (
                  <li key={r.id}>
                    {RETURN_TYPE_LABEL[r.type]} {r.reference} · {formatDate(r.createdAt)} · {formatLei(r.refundCents)} ({PAYMENT_LABEL[r.refundMethod]}) · comision
                    inversat {formatLei(r.commissionReversedCents)} · net vendor inversat {formatLei(r.vendorNetReversedCents)}
                    {r.artfestFundedReversedCents ? ` · compensație Artfest inversată ${formatLei(r.artfestFundedReversedCents)}` : ""}
                    <div className={shared.subtle}>
                      Motiv: {r.reason} ·{" "}
                      {r.lines
                        .map((rl) => `${detail.lines.find((l) => l.id === rl.saleLineId)?.title || "produs"} × ${rl.quantity} - ${DISPOSITION_LABEL[rl.disposition]}${rl.conditionNote ? ` (${rl.conditionNote})` : ""}${rl.refundResponsibility ? ` · suportat de ${RESPONSIBILITY_LABEL[rl.refundResponsibility]}: ${rl.responsibilityReason}` : ""}`)
                        .join("; ")}
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}
      {detail && modal === "return" && <SaleReturnModal sale={detail} onClose={() => setModal(null)} onDone={afterReturn} />}
      {detail && modal === "void" && <SaleVoidModal sale={detail} onClose={() => setModal(null)} onDone={afterReturn} />}
    </div>
  );
}

/* ===================== Raport zilnic ===================== */

function DailyReport() {
  const [date, setDate] = useState(() => todayFairDate());
  const [report, setReport] = useState(null);
  const [busy, setBusy] = useState(false);
  const [csvBusy, setCsvBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!isValidDate(date)) return;
    setBusy(true);
    try {
      setReport(await api(reportUrl(`${POS_API}/reports/daily`, date)));
      setError("");
    } catch (err) {
      setError(errorMessage(err, "Nu am putut încărca raportul."));
    } finally {
      setBusy(false);
    }
  }, [date]);

  useEffect(() => {
    load();
  }, [load]);

  async function downloadCsv() {
    setCsvBusy(true);
    setError("");
    try {
      await downloadLabelsPdf(
        reportUrl(`${POS_API}/reports/daily`, date, { csv: true }),
        `raport-targ-artfest-admin-${date}.csv`,
        "Nu am putut exporta raportul."
      );
    } catch (err) {
      setError(err?.message || "Nu am putut exporta raportul.");
    } finally {
      setCsvBusy(false);
    }
  }

  const r = report?.returns;
  const rows = report
    ? [
        ["Vânzări", report.salesCount],
        ["Bucăți", report.units],
        ["Valoare de listă", formatLei(report.listCents)],
        ["Reduceri", formatLei(report.discountCents)],
        ["Încasat", formatLei(report.totalPaidCents)],
        ["Numerar", formatLei(report.cashCents)],
        ["Card", formatLei(report.cardCents)],
        ["Comision Artfest", formatLei(report.commissionCents)],
        ["Net datorat vendorilor (vânzări)", formatLei(report.vendorNetCents)],
        ["Compensații Artfest (reduceri Artfest)", formatLei(report.artfestFundedDiscountCents)],
      ]
    : [];
  const returnRows = r
    ? [
        ["Retururi / anulări", `${r.count}${r.voidCount ? ` (din care ${r.voidCount} anulări)` : ""} · ${r.units} buc.`],
        ["Rambursat total", formatLei(r.refundCents)],
        ["Rambursat numerar", formatLei(r.cashRefundCents)],
        ["Rambursat card", formatLei(r.cardRefundCents)],
        ["Rambursări suportate de vendor", formatLei(r.vendorBorne.refundCents)],
        ["Rambursări suportate de Artfest", formatLei(r.artfestBorne.refundCents)],
        ["Comision inversat (imputat vendorului)", formatLei(r.vendorBorne.commissionReversedCents)],
        ["Net vendor inversat (imputat vendorului)", formatLei(r.vendorBorne.vendorNetReversedCents)],
        ["Încasat net al zilei", formatLei(report.netCollectedCents)],
        ["Numerar net", formatLei(report.netCashCents)],
        ["Card net", formatLei(report.netCardCents)],
        ["Comision net al zilei", formatLei(report.dayCommissionCents)],
        ["Net vendori al zilei", formatLei(report.dayVendorNetCents)],
      ]
    : [];

  return (
    <div className={styles.history}>
      <div className={styles.scanRow}>
        <label>
          Ziua{" "}
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Ziua raportului" />
        </label>
        <button type="button" className={styles.ghostBtn} onClick={load} disabled={busy}>
          {busy ? "Se actualizează…" : "Actualizează"}
        </button>
        <button type="button" className={styles.ghostBtn} onClick={downloadCsv} disabled={csvBusy || !report}>
          {csvBusy ? "Se exportă…" : "Export CSV"}
        </button>
      </div>
      <p className={shared.subtle}>
        Ora României (zi locală 00:00 – 24:00). Vânzările zilei cu valorile de la vânzare; retururile apar în ziua în care
        s-au făcut (istoricul zilei vânzării nu se modifică). Sursa sunt liniile vânzărilor și ale retururilor.
      </p>
      {error && <div className={shared.error}>{error}</div>}

      {report && (
        <>
          {!report.consistent && (
            <p className={styles.warning}>
              Totalurile din antetul vânzărilor / retururilor nu corespund cu suma liniilor - verifică ziua.
            </p>
          )}
          <dl className={styles.totals}>
            {rows.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          <h4>Retururi și net al zilei</h4>
          <dl className={styles.totals}>
            {returnRows.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>

          <h4>Pe vendori</h4>
          {report.vendors.length === 0 ? (
            <p className={shared.subtle}>Nicio vânzare sau retur în această zi.</p>
          ) : (
            <table className={shared.table}>
              <thead>
                <tr>
                  <th>Magazin</th>
                  <th>Vânzări</th>
                  <th>Bucăți</th>
                  <th>Listă</th>
                  <th>Reduceri</th>
                  <th>Încasat</th>
                  <th>Comision</th>
                  <th>Net</th>
                  <th>Rambursat</th>
                  <th>Net al zilei</th>
                </tr>
              </thead>
              <tbody>
                {report.vendors.map((v) => (
                  <tr key={v.vendorId}>
                    <td>{v.storeName || v.vendorId}</td>
                    <td>{v.salesCount}</td>
                    <td>{v.units}</td>
                    <td>{formatLei(v.listCents)}</td>
                    <td>{v.discountCents ? `−${formatLei(v.discountCents)}` : "—"}</td>
                    <td>{formatLei(v.grossCents)}</td>
                    <td>{formatLei(v.commissionCents)}</td>
                    <td>
                      {formatLei(v.vendorNetCents)}
                      {v.artfestFundedDiscountCents ? (
                        <div className={shared.subtle}>compensație Artfest {formatLei(v.artfestFundedDiscountCents)}</div>
                      ) : null}
                    </td>
                    <td>
                      {v.returns.refundCents ? formatLei(v.returns.refundCents) : "—"}
                      {v.returns.artfestBorne.refundCents ? (
                        <div className={shared.subtle}>din care suportat de Artfest {formatLei(v.returns.artfestBorne.refundCents)}</div>
                      ) : null}
                    </td>
                    <td>{formatLei(v.dayVendorNetCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {report.products.length > 0 && (
            <>
              <h4>Top produse</h4>
              <table className={shared.table}>
                <thead>
                  <tr>
                    <th>Produs</th>
                    <th>Magazin</th>
                    <th>Cant.</th>
                    <th>Valoare</th>
                  </tr>
                </thead>
                <tbody>
                  {report.products.map((p) => (
                    <tr key={p.inventoryItemId}>
                      <td>
                        {p.title}
                        {p.variantLabel ? ` (${p.variantLabel})` : ""}
                        <div className={shared.subtle}>{p.barcodeDisplay}</div>
                      </td>
                      <td>{p.storeName || "—"}</td>
                      <td>{p.quantity}</td>
                      <td>{formatLei(p.grossCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          {report.returnList.length > 0 && (
            <>
              <h4>Retururile zilei</h4>
              <table className={shared.table}>
                <thead>
                  <tr>
                    <th>Retur</th>
                    <th>Ora</th>
                    <th>Bucăți</th>
                    <th>Rambursat</th>
                    <th>Comision inversat</th>
                    <th>Net vendor inversat</th>
                    <th>Motiv</th>
                  </tr>
                </thead>
                <tbody>
                  {report.returnList.map((x) => (
                    <tr key={x.id}>
                      <td>
                        {RETURN_TYPE_LABEL[x.type]} {x.reference}
                        <div className={shared.subtle}>{x.dispositions.map((d) => DISPOSITION_LABEL[d]).join(", ")}</div>
                      </td>
                      <td>{x.localTime}</td>
                      <td>{x.units}</td>
                      <td>
                        {formatLei(x.refundCents)} ({PAYMENT_LABEL[x.refundMethod]})
                      </td>
                      <td>{formatLei(x.commissionReversedCents)}</td>
                      <td>{formatLei(x.vendorNetReversedCents)}</td>
                      <td>{x.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </>
      )}
    </div>
  );
}

/* ===================== Panou ===================== */

export default function AdminFairPosPanel() {
  const [tab, setTab] = useState("sale");
  const [status, setStatus] = useState(null);
  const [error, setError] = useState("");

  const loadStatus = useCallback(async () => {
    try {
      setStatus(await api(`${POS_API}/status`));
    } catch (err) {
      setError(errorMessage(err, "Nu am putut încărca starea POS."));
    }
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  async function toggleSales() {
    const next = !status?.salesOpen;
    if (!window.confirm(next ? "Deschizi vânzările la târg?" : "Închizi vânzările la târg?")) return;
    try {
      setStatus(await api(`${POS_API}/status`, { method: "POST", body: { salesOpen: next } }));
    } catch (err) {
      setError(errorMessage(err, "Nu am putut schimba starea vânzărilor."));
    }
  }

  return (
    <div className={styles.panel}>
      <div className={styles.topBar}>
        <div className={styles.tabs} role="tablist" aria-label="POS">
          {[
            ["sale", "Vânzare"],
            ["history", "Vânzări"],
            ["report", "Raport zilnic"],
          ].map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              className={`${styles.tabBtn} ${tab === id ? styles.tabBtnActive : ""}`}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>
        {status && (
          <div className={styles.status}>
            <span className={status.salesOpen ? styles.open : styles.closed}>
              {status.salesOpen ? "Vânzări deschise" : "Vânzări închise"}
            </span>
            <button type="button" className={styles.ghostBtn} onClick={toggleSales}>
              {status.salesOpen ? "Închide vânzările" : "Deschide vânzările"}
            </button>
          </div>
        )}
      </div>
      {error && <div className={shared.error}>{error}</div>}
      {tab === "sale" && <SalePanel salesOpen={Boolean(status?.salesOpen)} />}
      {tab === "history" && <SalesHistory />}
      {tab === "report" && <DailyReport />}
    </div>
  );
}
