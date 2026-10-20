// src/pages/Admin/AdminDesktop/tabs/AdminFairLabelsPanel.jsx
//
// Admin -> Târg Artfest -> Etichete. Artfest generează, imprimă și aplică
// etichetele (vendorii nu mai au acces la ele). Reutilizează generatorul
// existent (fairLabels.js pe server): 70 × 37 mm, Code128 + QR cu același cod.
//   - o etichetă individuală (PDF 70 × 37 mm);
//   - produsele selectate pe coală A4 (3 × 8), câte una pe bucată declarată /
//     recepționată / una pe produs;
// Reimprimarea folosește codul existent al liniei; nu se generează coduri noi.
// Generarea nu atinge stocul: stocul târgului scade doar la vânzarea confirmată (POS).

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../../../../lib/api";
import shared from "../AdminDesktop.module.css";
import rx from "./AdminFairReception.module.css";
import styles from "./AdminFairLabels.module.css";
import { downloadLabelsPdf } from "../../../Vendor/Fair/fairInventory.js";

const API = "/api/admin/artfest-fair/inventory";
const MAX_SELECTION = 500;

const COPY_MODES = [
  { id: "declared", label: "Câte una pe bucată declarată" },
  { id: "received", label: "Câte una pe bucată recepționată" },
  { id: "one", label: "O etichetă pe produs" },
];

const STATUS_FILTERS = [
  { id: "all", label: "Toate" },
  { id: "SUBMITTED", label: "De recepționat" },
  { id: "RECEIVED", label: "Recepționate" },
];

const LABEL_FILTERS = [
  { id: "all", label: "Toate etichetele" },
  { id: "none", label: "Negenerate" },
  { id: "outdated", label: "Cu preț vechi" },
  { id: "valid", label: "Generate" },
];

const STATUS_LABEL = { SUBMITTED: "De recepționat", RECEIVED: "Recepționat" };

function formatPrice(priceCents) {
  const value = Number(priceCents || 0) / 100;
  return `${Number.isInteger(value) ? value : value.toFixed(2).replace(".", ",")} lei`;
}

function formatDate(value) {
  if (!value) return "";
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleString("ro-RO", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Bucharest" });
}

function errorMessage(err, fallback) {
  return err?.data?.message || err?.message || fallback;
}

// câte etichete iese pentru o linie (aceeași regulă ca pe server)
function labelCopiesFor(item, mode) {
  if (mode === "one") return 1;
  if (mode === "received") return item.status === "RECEIVED" ? Math.max(0, item.receivedQty || 0) : 0;
  return Math.max(1, item.declaredQty || 0);
}

function LabelBadge({ label }) {
  if (label?.state === "valid") {
    return <span className={`${styles.badge} ${styles.badgeValid}`}>Generată · {formatDate(label.generatedAt)}</span>;
  }
  if (label?.state === "outdated") return <span className={`${styles.badge} ${styles.badgeWarn}`}>Preț vechi</span>;
  return <span className={`${styles.badge} ${styles.badgeNone}`}>Negenerată</span>;
}

export default function AdminFairLabelsPanel() {
  const [search, setSearch] = useState("");
  const [vendorId, setVendorId] = useState("");
  const [status, setStatus] = useState("all");
  const [labelState, setLabelState] = useState("all");
  const [copies, setCopies] = useState("declared");
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(() => new Set());
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  // toate liniile târgului (fără ciorne / anulate); căutarea după produs, vendor, cod e pe server
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ filter: "all" });
      if (search.trim()) params.set("q", search.trim());
      const res = await api(`${API}?${params.toString()}`);
      setItems((res?.items || []).filter((i) => i.actions?.canPrintLabel));
    } catch (err) {
      setError(errorMessage(err, "Nu am putut încărca produsele."));
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  const vendors = useMemo(() => {
    const map = new Map();
    for (const i of items) if (i.vendor?.id) map.set(i.vendor.id, i.vendor.name || i.storeName || "Vendor");
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1], "ro"));
  }, [items]);

  const rows = useMemo(
    () =>
      items.filter(
        (i) =>
          (!vendorId || i.vendor?.id === vendorId) &&
          (status === "all" || i.status === status) &&
          (labelState === "all" || (i.label?.state || "none") === labelState)
      ),
    [items, vendorId, status, labelState]
  );

  // selecția rămâne doar pe liniile încă valide (după reîncărcare)
  useEffect(() => {
    setSelected((prev) => {
      const valid = new Set(items.map((i) => i.id));
      const next = new Set([...prev].filter((id) => valid.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [items]);

  const selectedItems = useMemo(() => items.filter((i) => selected.has(i.id)), [items, selected]);
  const labelTotal = selectedItems.reduce((sum, i) => sum + labelCopiesFor(i, copies), 0);
  const skippedForReceived = copies === "received" ? selectedItems.filter((i) => labelCopiesFor(i, "received") === 0).length : 0;
  const allVisibleSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const counts = useMemo(
    () => ({
      none: items.filter((i) => (i.label?.state || "none") === "none").length,
      outdated: items.filter((i) => i.label?.state === "outdated").length,
    }),
    [items]
  );

  function toggle(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < MAX_SELECTION) next.add(id);
      return next;
    });
  }

  function toggleAllVisible() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) rows.forEach((r) => next.delete(r.id));
      else for (const r of rows) if (next.size < MAX_SELECTION) next.add(r.id);
      return next;
    });
  }

  async function run(key, action, success) {
    if (busy) return;
    setBusy(key);
    setError("");
    setNotice("");
    try {
      await action();
      setNotice(success);
      load();
    } catch (err) {
      const problems = err?.data?.problems;
      const titles = Array.isArray(problems) ? problems.map((p) => p.title).filter(Boolean) : [];
      setError(`${errorMessage(err, "Nu am putut genera etichetele.")}${titles.length ? ` (${titles.join(", ")})` : ""}`);
    } finally {
      setBusy("");
    }
  }

  const printSelected = () =>
    run(
      "selected",
      () =>
        downloadLabelsPdf(`${API}/labels.pdf`, "etichete-selectate-targ-artfest.pdf", "Nu am putut genera etichetele.", {
          body: { ids: selectedItems.map((i) => i.id), copies },
        }),
      `PDF-ul a fost generat: ${labelTotal} ${labelTotal === 1 ? "etichetă" : "etichete"} (A4, 3 × 8). Codurile sunt cele existente.`
    );

  const printOne = (item) =>
    run(
      `one:${item.id}`,
      () => downloadLabelsPdf(`${API}/${encodeURIComponent(item.id)}/label.pdf`, `eticheta-${item.barcode}.pdf`),
      item.label?.state === "valid"
        ? `Eticheta „${item.title}” a fost reimprimată cu același cod (${item.barcodeDisplay}).`
        : `Eticheta „${item.title}” a fost generată (${item.barcodeDisplay}).`
    );

  return (
    <div className={`${rx.panel} ${selectedItems.length ? styles.withBulkBar : ""}`}>
      <section className={styles.intro} aria-labelledby="fair-labels-title">
        <div>
          <h2 id="fair-labels-title">Etichete cu coduri de bare</h2>
          <p>
            Artfest generează, imprimă și aplică etichetele la recepție. Fiecare produs sau variantă are un cod unic,
            care nu se schimbă la reimprimare. Generarea etichetelor nu modifică stocul: stocul târgului scade doar
            după confirmarea vânzării în POS.
          </p>
        </div>
        <p className={styles.format}>Coli A4 cu 24 de etichete (70 × 37 mm). La imprimare alege scala 100%.</p>
        {(counts.none > 0 || counts.outdated > 0) && (
          <p className={styles.todo}>
            {counts.none > 0 && <span>{counts.none} fără etichetă</span>}
            {counts.outdated > 0 && <span>{counts.outdated} cu preț vechi (de reimprimat)</span>}
          </p>
        )}
      </section>

      <div className={styles.toolbar}>
        <input
          className={styles.search}
          type="search"
          placeholder="Caută după produs, creator sau cod de bare"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Caută produse"
        />
        <select className={styles.select} value={vendorId} onChange={(e) => setVendorId(e.target.value)} aria-label="Creator">
          <option value="">Toți creatorii</option>
          {vendors.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
        <select className={styles.select} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Participare la târg">
          {STATUS_FILTERS.map((f) => (
            <option key={f.id} value={f.id}>
              {f.id === "all" ? "Toate produsele participante" : f.label}
            </option>
          ))}
        </select>
        <select className={styles.select} value={labelState} onChange={(e) => setLabelState(e.target.value)} aria-label="Starea etichetei">
          {LABEL_FILTERS.map((f) => (
            <option key={f.id} value={f.id}>
              {f.label}
            </option>
          ))}
        </select>
      </div>

      {notice && (
        <div className={rx.notice} role="status">
          {notice}
        </div>
      )}
      {error && (
        <div className={shared.error} role="alert">
          {error}
        </div>
      )}

      <div className={styles.listHead}>
        <label className={styles.checkAll}>
          <input type="checkbox" checked={allVisibleSelected} onChange={toggleAllVisible} disabled={!rows.length} />
          <span>{allVisibleSelected ? "Deselectează rezultatele" : "Selectează rezultatele"}</span>
        </label>
        <span className={styles.muted}>
          {loading ? "Se încarcă…" : `${rows.length} ${rows.length === 1 ? "produs" : "produse"}`}
        </span>
      </div>

      {!loading && rows.length === 0 ? (
        <p className={shared.subtle}>
          {items.length
            ? "Niciun produs nu corespunde filtrelor."
            : "Nu există încă produse trimise de creatori pentru târg."}
        </p>
      ) : (
        <ul className={styles.list}>
          {rows.map((item) => {
            const isSelected = selected.has(item.id);
            const reprint = item.label?.state === "valid";
            return (
              <li key={item.id} className={`${styles.row} ${isSelected ? styles.rowSelected : ""}`}>
                <label className={styles.check}>
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggle(item.id)}
                    aria-label={`Selectează ${item.title}`}
                  />
                </label>
                {item.imageUrl ? <img className={styles.thumb} src={item.imageUrl} alt="" /> : <span className={styles.thumb} />}
                <div className={styles.info}>
                  <strong className={styles.title}>{item.title}</strong>
                  {item.variantLabel && <span className={styles.muted}>{item.variantLabel}</span>}
                  <span className={styles.muted}>
                    {item.vendor?.name || "—"}
                    {item.storeName && item.storeName !== item.vendor?.name ? ` · ${item.storeName}` : ""}
                  </span>
                  <span className={styles.meta}>
                    <span className={rx.code}>{item.barcodeDisplay}</span>
                    <span>{formatPrice(item.priceCents)}</span>
                    <span>
                      Declarat {item.declaredQty}
                      {item.status === "RECEIVED" ? ` · Recepționat ${item.receivedQty}` : ""}
                    </span>
                    <span>{STATUS_LABEL[item.status] || item.status}</span>
                  </span>
                </div>
                <div className={styles.rowActions}>
                  <LabelBadge label={item.label} />
                  <button
                    type="button"
                    className={rx.ghostBtn}
                    onClick={() => printOne(item)}
                    disabled={Boolean(busy)}
                    title="O etichetă 70 × 37 mm, cu codul existent"
                  >
                    {busy === `one:${item.id}`
                      ? "Se generează…"
                      : reprint
                        ? "Reimprimă eticheta"
                        : item.label?.state === "outdated"
                          ? "Reimprimă (preț nou)"
                          : "Etichetă individuală"}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {selectedItems.length > 0 && (
        <div className={styles.bulkBar} role="region" aria-label="Etichete pentru produsele selectate">
          <div className={styles.bulkInfo}>
            <strong>
              {selectedItems.length} {selectedItems.length === 1 ? "produs selectat" : "produse selectate"} · {labelTotal}{" "}
              {labelTotal === 1 ? "etichetă" : "etichete"}
            </strong>
            {skippedForReceived > 0 && (
              <span className={styles.muted}>
                {skippedForReceived} {skippedForReceived === 1 ? "produs nerecepționat nu intră" : "produse nerecepționate nu intră"} în PDF.
              </span>
            )}
          </div>
          <select className={styles.select} value={copies} onChange={(e) => setCopies(e.target.value)} aria-label="Câte etichete pe produs">
            {COPY_MODES.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
          <div className={styles.bulkActions}>
            <button type="button" className={rx.ghostBtn} onClick={() => setSelected(new Set())} disabled={Boolean(busy)}>
              Golește selecția
            </button>
            <button type="button" className={rx.primaryBtn} onClick={printSelected} disabled={Boolean(busy) || labelTotal === 0}>
              {busy === "selected" ? "Se generează…" : "Descarcă PDF (A4)"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
