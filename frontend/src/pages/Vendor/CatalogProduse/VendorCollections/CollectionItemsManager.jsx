// src/pages/Vendor/CatalogProduse/VendorCollections/CollectionItemsManager.jsx
//
// Produsele DEJA din colecție (selecție manuală, fixă):
//  - contor „N / 300”, căutare rapidă în listă, filtre pe tip / stare;
//  - selecție multiplă + eliminare în masă (doar din colecție - produsul
//    rămâne neatins în magazinul lui);
//  - mesaje clare pentru produsele care nu mai apar public (dezactivate,
//    neaprobate, magazin inactiv) sau cu stoc epuizat.
// Starea vine de la backend (GET /api/vendor/collections/:id -> items[].status).
import { useMemo, useRef, useState } from "react";
import { AlertTriangle, Search, Trash2 } from "lucide-react";

import { api } from "../../../../lib/api.js";
import styles from "./CollectionProducts.module.css";
import useInView from "./useInView.js";

const VISIBLE_STEP = 24;

const VIEWS = [
  { value: "all", label: "Toate" },
  { value: "own", label: "Ale mele" },
  { value: "other", label: "Alte magazine" },
  { value: "unavailable", label: "Indisponibile" },
];

function money(priceCents, currency = "RON") {
  const value = Number(priceCents || 0) / 100;
  return `${value.toLocaleString("ro-RO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

function normalize(text) {
  return String(text || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

export default function CollectionItemsManager({
  collectionId,
  items = [],
  allOwnActive = false,
  maxProducts = 300,
  onChanged,
  onAddClick,
}) {
  const [view, setView] = useState("all");
  const [query, setQuery] = useState("");
  const [visible, setVisible] = useState(VISIBLE_STEP);
  const [selected, setSelected] = useState(() => new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  // produsele care așteaptă confirmarea eliminării
  const [pendingRemove, setPendingRemove] = useState(null);
  const busyRef = useRef(false);
  const rootRef = useRef(null);
  const inView = useInView(rootRef);

  const unavailableCount = items.filter((i) => i.status === "unavailable").length;

  const filtered = useMemo(() => {
    const q = normalize(query.trim());
    return items.filter((item) => {
      if (view === "own" && !item.isOwn) return false;
      if (view === "other" && item.isOwn) return false;
      if (view === "unavailable" && item.status !== "unavailable") return false;
      if (!q) return true;
      const p = item.product || {};
      return normalize(`${p.title} ${p.service?.profile?.displayName || p.service?.title || ""}`).includes(q);
    });
  }, [items, view, query]);

  const shown = filtered.slice(0, visible);
  const allFilteredSelected = filtered.length > 0 && filtered.every((i) => selected.has(i.productId));

  function toggle(productId) {
    setNotice("");
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(productId)) next.delete(productId);
      else next.add(productId);
      return next;
    });
  }

  function toggleAllFiltered() {
    setNotice("");
    setSelected((current) => {
      const next = new Set(current);
      if (allFilteredSelected) filtered.forEach((i) => next.delete(i.productId));
      else filtered.forEach((i) => next.add(i.productId));
      return next;
    });
  }

  // cere confirmarea (pentru un produs sau pentru mai multe)
  function remove(productIds) {
    if (!productIds.length || busyRef.current) return;
    setError("");
    setPendingRemove(productIds);
  }

  async function confirmRemove() {
    const productIds = pendingRemove || [];
    if (!productIds.length || busyRef.current) return;

    busyRef.current = true;
    setBusy(true);
    setError("");

    try {
      const data = await api(`/api/vendor/collections/${encodeURIComponent(collectionId)}/products/remove`, {
        method: "POST",
        body: { productIds },
      });
      const removed = Number(data?.removed || 0);
      setSelected((current) => {
        const next = new Set(current);
        productIds.forEach((id) => next.delete(id));
        return next;
      });
      setNotice(removed === 1 ? "Un produs scos din colecție." : `${removed} produse scoase din colecție.`);
      await onChanged?.();
    } catch (err) {
      setError(err?.data?.message || err?.message || "Produsele nu au putut fi scoase din colecție.");
    } finally {
      busyRef.current = false;
      setBusy(false);
      setPendingRemove(null);
    }
  }

  const pendingTitle =
    pendingRemove?.length === 1
      ? items.find((i) => i.productId === pendingRemove[0])?.product?.title || "acest produs"
      : null;

  const fill = Math.min(100, Math.round((items.length / Math.max(1, maxProducts)) * 100));

  return (
    <div ref={rootRef} className={selected.size ? `${styles.manager} ${styles.withBar}` : styles.manager}>
      <div className={styles.managerHead}>
        <div>
          <h3 className={styles.managerTitle}>Deja în colecție</h3>
          <p className={styles.sourceHint}>
            {allOwnActive
              ? "Produsele tale publice sunt incluse automat. Aici sunt produsele adăugate manual."
              : "Selecție fixă: rămân aici până le scoți. Produsele noi nu se adaugă singure."}
          </p>
        </div>
        <div className={styles.capacity} aria-label={`${items.length} din ${maxProducts} produse`}>
          <strong>
            {items.length}
            <span> / {maxProducts}</span>
          </strong>
          <span className={styles.capacityBar} aria-hidden="true">
            <span style={{ width: `${fill}%` }} />
          </span>
        </div>
      </div>

      {unavailableCount ? (
        <div className={styles.warning}>
          <AlertTriangle size={18} aria-hidden="true" />
          <span>
            {unavailableCount === 1
              ? "Un produs nu mai apare public"
              : `${unavailableCount} produse nu mai apar public`}
            . Motive posibile: produs dezactivat, neaprobat sau magazin inactiv. Clienții nu le văd în
            colecție; le poți scoate sau le lași până revin.
          </span>
          <button type="button" className={styles.link} onClick={() => setView("unavailable")}>
            Vezi
          </button>
        </div>
      ) : null}

      {items.length ? (
        <>
          <div className={styles.managerTools}>
            <label className={styles.searchField}>
              <Search size={18} aria-hidden="true" />
              <input
                type="search"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setVisible(VISIBLE_STEP);
                }}
                placeholder="Caută în colecție"
                aria-label="Caută în colecție"
              />
            </label>

            <div className={styles.chips} role="tablist" aria-label="Filtrează produsele din colecție">
              {VIEWS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="tab"
                  aria-selected={view === option.value}
                  className={view === option.value ? styles.chipActive : styles.chip}
                  onClick={() => {
                    setView(option.value);
                    setVisible(VISIBLE_STEP);
                  }}
                >
                  {option.label}
                  {option.value === "unavailable" && unavailableCount ? ` (${unavailableCount})` : ""}
                </button>
              ))}
            </div>
          </div>

          <div className={styles.resultsHead}>
            <label className={styles.checkLine}>
              <input type="checkbox" checked={allFilteredSelected} onChange={toggleAllFiltered} />
              <span>
                Selectează {filtered.length === items.length ? "toate" : `cele ${filtered.length} afișate`}
              </span>
            </label>
          </div>

          {error ? <div className={styles.error}>{error}</div> : null}
          {notice ? <div className={styles.notice}>{notice}</div> : null}

          <ul className={styles.list}>
            {shown.map((item) => {
              const p = item.product || {};
              const image = Array.isArray(p.images) ? p.images[0] : null;
              const checked = selected.has(item.productId);
              const storeName = p.service?.profile?.displayName || p.service?.title || p.service?.vendor?.displayName;

              return (
                <li
                  key={item.productId}
                  className={`${checked ? styles.rowChecked : styles.row} ${
                    item.status === "unavailable" ? styles.rowMuted : ""
                  }`}
                >
                  <label className={styles.rowMain}>
                    <input
                      type="checkbox"
                      className={styles.checkbox}
                      checked={checked}
                      onChange={() => toggle(item.productId)}
                      aria-label={`Selectează ${p.title || "produsul"}`}
                    />
                    {image ? (
                      <img src={image} alt="" className={styles.thumb} loading="lazy" />
                    ) : (
                      <span className={styles.thumb} aria-hidden="true" />
                    )}
                    <span className={styles.rowText}>
                      <strong>{p.title || "Produs eliminat din catalog"}</strong>
                      <span className={styles.meta}>
                        {p.priceCents !== undefined ? money(p.priceCents, p.currency) : ""}
                        {storeName ? ` · ${storeName}` : ""}
                      </span>
                      <span className={styles.badges}>
                        <span className={item.isOwn ? styles.badgeOwn : styles.badgeOther}>
                          {item.isOwn ? "Produsul tău" : "Alt magazin"}
                        </span>
                        {item.status === "unavailable" ? (
                          <span className={styles.badgeDanger}>Nu mai apare public</span>
                        ) : null}
                        {item.status === "sold_out" ? <span className={styles.badgeWarn}>Stoc epuizat</span> : null}
                      </span>
                    </span>
                  </label>

                  <div className={styles.rowAction}>
                    <button
                      type="button"
                      className={styles.iconDanger}
                      disabled={busy}
                      onClick={() => remove([item.productId])}
                      aria-label={`Scoate ${p.title || "produsul"} din colecție`}
                      title="Scoate din colecție"
                    >
                      <Trash2 size={17} aria-hidden="true" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>

          {filtered.length > shown.length ? (
            <button type="button" className={styles.loadMore} onClick={() => setVisible((v) => v + VISIBLE_STEP)}>
              Arată mai multe ({filtered.length - shown.length})
            </button>
          ) : null}

          {!filtered.length ? <p className={styles.sourceHint}>Niciun produs pentru acest filtru.</p> : null}
        </>
      ) : (
        <div className={styles.empty}>
          <strong>Colecția nu are încă produse adăugate manual</strong>
          <p>Caută produse din magazinul tău sau din tot Artfest și bifează-le pe cele potrivite.</p>
          <button type="button" className={styles.primary} onClick={onAddClick}>
            Adaugă produse
          </button>
        </div>
      )}

      {pendingRemove ? (
        <div className={styles.confirmBackdrop} onClick={() => !busy && setPendingRemove(null)}>
          <div
            className={styles.confirmDialog}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="remove-confirm-title"
            aria-describedby="remove-confirm-text"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === "Escape" && !busy) setPendingRemove(null);
            }}
          >
            <strong id="remove-confirm-title">
              {pendingTitle ? `Scoți „${pendingTitle}” din colecție?` : `Scoți ${pendingRemove.length} produse din colecție?`}
            </strong>
            <p id="remove-confirm-text">
              Produsele dispar doar din această colecție. Rămân neatinse în magazinele lor și le poți adăuga din nou oricând.
            </p>
            <div className={styles.confirmActions}>
              <button type="button" className={styles.ghost} disabled={busy} onClick={() => setPendingRemove(null)} autoFocus>
                Anulează
              </button>
              <button type="button" className={styles.dangerButton} disabled={busy} onClick={confirmRemove}>
                <Trash2 size={16} aria-hidden="true" />
                {busy ? "Se scot…" : "Scoate din colecție"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {selected.size && inView ? (
        <div
          className={`${styles.selectionBar} ${styles.selectionBarRaised}`}
          role="region"
          aria-label="Produse selectate din colecție"
        >
          <div className={styles.selectionInfo}>
            <strong>{selected.size === 1 ? "Un produs selectat" : `${selected.size} produse selectate`}</strong>
            <span>Se scot doar din colecție</span>
          </div>
          <div className={styles.selectionActions}>
            <button type="button" className={styles.ghost} onClick={() => setSelected(new Set())}>
              Anulează
            </button>
            <button type="button" className={styles.dangerButton} disabled={busy} onClick={() => remove([...selected])}>
              <Trash2 size={16} aria-hidden="true" />
              {busy ? "Se scot…" : "Scoate din colecție"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
