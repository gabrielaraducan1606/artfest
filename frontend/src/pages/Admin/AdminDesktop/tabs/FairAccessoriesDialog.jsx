// src/pages/Admin/AdminDesktop/tabs/FairAccessoriesDialog.jsx
//
// Târgul Artfest - „Ambalare și accesorii” (doar Admin), la fiecare produs al unui participant:
// poziții (denumire, cantitate, preț unitar), PER BUCATĂ DE PRODUS; totalul pe bucată se calculează
// automat. La vânzare se rețin din partea vânzătorului și revin integral Artfest (comisionul rămâne
// 10% din prețul efectiv). Modificarea se aplică doar vânzărilor viitoare; nu schimbă prețul final /
// online și nici stocul de pungi / cutii Artfest. Vânzătorul vede lista în inventarul lui.

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../../../lib/api";
import styles from "./AdminFairPos.module.css";
import {
  ACCESSORY_MAX_ITEMS,
  accessoriesListText,
  emptyRow,
  formatLeiPlain,
  liveUnitTotal,
  rowsFromItems,
  proposedPrice,
  splitAtPrice,
  validateAccessoryRows,
} from "../../../Vendor/Fair/fairAccessories.js";

/*
 * Împărțirea pe bucată după regula actuală: preț declarat (integral vânzătorului), adaos Artfest
 * (10% din declarat; efectiv mai mic la o reducere), accesorii, total client. Comun: dialogul
 * accesoriilor, fișa de recepție din POS.
 */
export function PriceBreakdown({ split, proposedCents = null }) {
  if (!split) return null;
  const discounted = split.financeRule === "DISCOUNTED_COMMISSION";
  const proposed = proposedCents ?? split.proposedPriceCents;
  return (
    <>
      <dl className={styles.totals} aria-label="Calcul pe bucată">
        {discounted ? (
          <>
            <div className={styles.grand}>
              <dt>Total client (încasat)</dt>
              <dd>{formatLeiPlain(split.priceCents)}</dd>
            </div>
            <div>
              <dt>− Ambalare și accesorii (Artfest)</dt>
              <dd>{formatLeiPlain(split.accessoriesCents)}</dd>
            </div>
            <div>
              <dt>= Bază după accesorii</dt>
              <dd>{formatLeiPlain(Math.max(0, split.baseCents))}</dd>
            </div>
            <div>
              <dt>Comision Artfest 10% din bază</dt>
              <dd>{formatLeiPlain(split.markupCents)}</dd>
            </div>
            <div>
              <dt>Vânzătorul primește (90%; preț declarat {formatLeiPlain(split.declaredCents)})</dt>
              <dd>{formatLeiPlain(Math.max(0, split.vendorNetCents))}</dd>
            </div>
          </>
        ) : (
          <>
            <div>
              <dt>Preț declarat (integral al vânzătorului)</dt>
              <dd>{formatLeiPlain(split.declaredCents)}</dd>
            </div>
            <div>
              <dt>Adaos Artfest{split.markupCents > split.plannedMarkupCents ? " (peste 10%: surplusul peste prețul propus)" : " (10% din declarat)"}</dt>
              <dd>{formatLeiPlain(split.markupCents)}</dd>
            </div>
            <div>
              <dt>Ambalare și accesorii</dt>
              <dd>{formatLeiPlain(split.accessoriesCents)}</dd>
            </div>
            <div className={styles.grand}>
              <dt>Total client</dt>
              <dd>{formatLeiPlain(split.priceCents)}</dd>
            </div>
            <div>
              <dt>Vânzătorul primește</dt>
              <dd>{formatLeiPlain(split.vendorNetCents)}</dd>
            </div>
          </>
        )}
        <div>
          <dt>Artfest primește (accesorii + {discounted ? "comision" : "adaos"})</dt>
          <dd>{formatLeiPlain(Math.max(0, split.artfestCents))}</dd>
        </div>
      </dl>
      {proposed != null && proposed !== split.priceCents && (
        <small className={styles.accSplit}>Preț propus (declarat + 10% + accesorii): {formatLeiPlain(proposed)}.</small>
      )}
      {split.negative ? (
        <p className={styles.cameraError} role="alert">
          Prețul nu acoperă ambalajele / accesoriile Artfest ({formatLeiPlain(split.floorPriceCents)}): vânzarea se blochează la casă.
        </p>
      ) : discounted ? (
        <p className={styles.stateWait} role="note">
          Sub prețul propus ({formatLeiPlain(proposed)}) reducerea afectează suma vânzătorului: se scad accesoriile, apoi Artfest primește 10% din rest, iar
          vânzătorul {formatLeiPlain(split.vendorNetCents)} în loc de prețul declarat {formatLeiPlain(split.declaredCents)}.
        </p>
      ) : null}
    </>
  );
}

const FAIR_API = "/api/admin/artfest-fair";

function errorText(err, fallback) {
  const fields = err?.data?.fields;
  if (fields && typeof fields === "object") {
    const first = Object.values(fields).find(Boolean);
    if (first) return String(first);
  }
  if (!err?.status) return "Eroare de conexiune. Verifică internetul și încearcă din nou.";
  return err?.data?.message || err?.message || fallback;
}

function formatWhen(value) {
  if (!value) return "";
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleString("ro-RO", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Bucharest" });
}

/*
 * Rândurile „Ambalare și accesorii” (denumire, cantitate pe o bucată de produs, preț unitar, total).
 * Același formular în dialogul accesoriilor și în „Adaugă produs într-un magazin”.
 */
export function AccessoryRowsEditor({ rows, onChange, fields = {}, disabled = false }) {
  return (
    <div className={styles.accRows}>
      <div className={styles.accHead} aria-hidden="true">
        <span>Denumire</span>
        <span>Cant. / buc. produs</span>
        <span>Preț unitar (lei)</span>
        <span>Total</span>
        <span />
      </div>
      {rows.map((r, i) => {
        const q = Number(r.quantity);
        const rowTotal = liveUnitTotal([r]);
        return (
          <div className={styles.accRow} key={i}>
            <label className={styles.field}>
              <span className={styles.accLabel}>Denumire</span>
              <input value={r.name} onChange={(e) => onChange(rows.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} placeholder="ex. Cutie" maxLength={80} aria-label={`Denumire accesoriu ${i + 1}`} disabled={disabled} />
              {fields[`${i}.name`] && <small className={styles.fieldError}>{fields[`${i}.name`]}</small>}
            </label>
            <label className={styles.field}>
              <span className={styles.accLabel}>Cantitate pe o bucată de produs</span>
              <input inputMode="numeric" value={r.quantity} onChange={(e) => onChange(rows.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))} aria-label={`Cantitate accesoriu ${i + 1} pe o bucată de produs`} disabled={disabled} />
              {fields[`${i}.quantity`] && <small className={styles.fieldError}>{fields[`${i}.quantity`]}</small>}
            </label>
            <label className={styles.field}>
              <span className={styles.accLabel}>Preț unitar (lei)</span>
              <input inputMode="decimal" value={r.price} onChange={(e) => onChange(rows.map((x, j) => (j === i ? { ...x, price: e.target.value } : x)))} placeholder="ex. 6" aria-label={`Preț unitar accesoriu ${i + 1}`} disabled={disabled} />
              {fields[`${i}.price`] && <small className={styles.fieldError}>{fields[`${i}.price`]}</small>}
            </label>
            <span className={styles.accTotal}>{rowTotal ? formatLeiPlain(rowTotal) : Number.isInteger(q) ? "—" : ""}</span>
            <button
              type="button"
              className={styles.ghostBtn}
              onClick={() => onChange(rows.length > 1 ? rows.filter((_, j) => j !== i) : [emptyRow()])}
              disabled={disabled}
              aria-label={`Șterge accesoriul ${i + 1}`}
            >
              Șterge
            </button>
          </div>
        );
      })}
      <button type="button" className={styles.ghostBtn} onClick={() => onChange([...rows, emptyRow()])} disabled={disabled || rows.length >= ACCESSORY_MAX_ITEMS}>
        + Adaugă poziție
      </button>
    </div>
  );
}

function AccessoriesDialog({ line, onClose, onSaved }) {
  const [data, setData] = useState(null);
  const [rows, setRows] = useState([emptyRow()]);
  const [fields, setFields] = useState({});
  const [message, setMessage] = useState({ tone: "", text: "" });
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  const load = useCallback(async () => {
    try {
      const res = await api(`${FAIR_API}/inventory/${encodeURIComponent(line.id)}/accessories`);
      setData(res);
      setRows(res.items?.length ? rowsFromItems(res.items) : [emptyRow()]);
    } catch (err) {
      setMessage({ tone: "error", text: errorText(err, "Accesoriile nu au putut fi încărcate.") });
    }
  }, [line.id]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);


  const unitTotal = liveUnitTotal(rows);
  // fără preț final salvat, prețul de vânzare = prețul propus (se recalculează cu accesoriile noi)
  const declared = line.pricing?.vendorPriceCents ?? null;
  const proposed = proposedPrice(declared, unitTotal);
  const price = line.pricing?.finalPriceCents ?? proposed;
  const preview = splitAtPrice(price, declared, unitTotal);

  async function save() {
    if (busyRef.current) return;
    const parsed = validateAccessoryRows(rows);
    if (!parsed.ok) {
      setFields(parsed.fields);
      setMessage({ tone: "error", text: parsed.fields.items || "Verifică pozițiile marcate." });
      return;
    }
    busyRef.current = true;
    setBusy(true);
    try {
      const res = await api(`${FAIR_API}/inventory/${encodeURIComponent(line.id)}/accessories`, {
        method: "PUT",
        body: { items: parsed.items },
      });
      setData(res.accessories);
      setMessage({
        tone: "ok",
        text: res.changed
          ? `Salvat: ${formatLeiPlain(res.accessories.unitCents)} pe bucată. Se aplică vânzărilor viitoare.`
          : "Nicio modificare (aceleași accesorii).",
      });
      onSaved?.(res.item);
    } catch (err) {
      setMessage({ tone: "error", text: errorText(err, "Accesoriile nu au putut fi salvate.") });
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  const title = `Ambalare și accesorii - ${line.title}`;
  return (
    <div className={styles.cameraBackdrop} role="dialog" aria-modal="true" aria-label={title}>
      <div className={styles.toolBox}>
        <div className={styles.cameraHead}>
          <strong>{title}</strong>
          <button type="button" className={styles.ghostBtn} onClick={onClose}>
            Închide
          </button>
        </div>

        <p className={styles.notice}>
          Introdu materialele adăugate de Artfest <strong>pentru O BUCATĂ de produs</strong> (ex. 1 cutie, 2 funde). La fiecare bucată
          vândută, valoarea lor se reține din suma vânzătorului și revine Artfest, pe lângă comisionul de 10% din prețul efectiv.
          Prețul de vânzare nu se schimbă. Modificările se aplică doar vânzărilor viitoare.
        </p>
        {data?.soldQty > 0 && (
          <p className={styles.stateWait}>
            {data.soldQty} buc. deja vândute își păstrează valorile de la vânzare (vânzările și deconturile existente nu se recalculează).
          </p>
        )}

        <AccessoryRowsEditor rows={rows} onChange={(next) => { setRows(next); setFields({}); setMessage({ tone: "", text: "" }); }} fields={fields} disabled={busy} />

        <dl className={styles.totals}>
          <div className={styles.grand}>
            <dt>Total accesorii pe bucată</dt>
            <dd>{formatLeiPlain(unitTotal)}</dd>
          </div>
        </dl>
        <PriceBreakdown split={preview} proposedCents={proposed} />
        {line.pricing?.finalPriceCents != null && proposed !== line.pricing.finalPriceCents && (
          <p className={styles.stateWait}>
            Prețul final salvat ({formatLeiPlain(line.pricing.finalPriceCents)}) diferă de noul preț propus ({formatLeiPlain(proposed)}): nu se modifică automat.
          </p>
        )}

        <div className={styles.toolActions}>
          <button type="button" className={styles.primaryBtn} onClick={save} disabled={busy || !data?.editable}>
            {busy ? "Se salvează…" : "Salvează accesoriile"}
          </button>
        </div>
        {message.text && (
          <p className={message.tone === "error" ? styles.cameraError : styles.stateOk} role={message.tone === "error" ? "alert" : "status"}>
            {message.text}
          </p>
        )}

        {data?.history?.length > 0 && (
          <details className={styles.breakdown}>
            <summary>Istoric modificări ({data.history.length})</summary>
            <ul>
              {data.history.map((h) => (
                <li key={h.id}>
                  {formatWhen(h.at)} · {h.by || "Admin"}: {formatLeiPlain(h.before.unitCents)} → {formatLeiPlain(h.after.unitCents)} pe bucată
                  {h.after.items.length ? ` (${accessoriesListText(h.after.items)})` : " (fără accesorii)"}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </div>
  );
}

/** Butonul „Ambalare și accesorii” al unui produs (ascuns pentru produsele proprii Artfest). */
export default function FairAccessoriesButton({ line, onSaved }) {
  const [open, setOpen] = useState(false);
  if (!line || line.artfestOwned || !line.vendor?.id) return null;
  const unit = line.accessories?.unitCents || 0;
  return (
    <>
      <button type="button" className={styles.ghostBtn} onClick={() => setOpen(true)}>
        Ambalare și accesorii{unit > 0 ? ` (${formatLeiPlain(unit)}/buc.)` : ""}
      </button>
      {open && <AccessoriesDialog line={line} onClose={() => setOpen(false)} onSaved={onSaved} />}
    </>
  );
}
