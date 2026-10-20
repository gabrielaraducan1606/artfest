// src/pages/Vendor/CatalogProduse/VendorDiscountCodesTab/DiscountProductPicker.jsx
//
// „Doar anumite produse din magazinul meu” - alegerea produselor eligibile
// pentru un cod de reducere. Aceeași experiență ca selectorul din Colecții
// (căutare, filtre, checkboxuri, „Selectează pagina”, „Toate rezultatele
// filtrate”), reutilizând logica PURĂ (collectionPicker.js) și stilurile
// lui (CollectionProducts.module.css) - fără să le modifice.
//
// Diferență față de Colecții: nimic nu se salvează aici. Selecția (Map
// id -> produs) rămâne în formularul codului și se trimite la „Creează /
// Salvează”, unde backend-ul verifică strict că produsele sunt ale tale.
//
// Fără <form> propriu: selectorul stă în formularul codului (form-uri
// imbricate nu sunt valide) - Enter în căutare aplică filtrele.

import { useCallback, useEffect, useState } from "react";
import { Search, SlidersHorizontal, X } from "lucide-react";

import { api } from "../../../../lib/api.js";
import { CATEGORIES_DETAILED } from "../../../../constants/productscategories.js";
import { OCCASION_TAGS_DETAILED } from "../../../../../../backend/src/constants/occasinsTags.js";
import { getCanonicalLabel } from "../../../../utils/optionLabels.js";
import {
  AVAILABILITY_OPTIONS,
  EMPTY_FILTERS,
  PICKER_PAGE_SIZE,
  activeFilterCount,
  buildSearchParams,
  mergeResults,
  serverFilters,
} from "../VendorCollections/collectionPicker.js";
import pickerStyles from "../VendorCollections/CollectionProducts.module.css";
import styles from "./VendorDiscountCodesTab.module.css";

export const MAX_CODE_PRODUCTS = 300;

const STATUS_LABELS = {
  unavailable: "Nu se poate cumpăra acum",
  other_store: "Nu mai aparține magazinului tău",
};

function money(priceCents, currency = "RON") {
  const value = Number(priceCents || 0) / 100;
  return `${value.toLocaleString("ro-RO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

function summary(product) {
  return {
    id: product.id,
    title: product.title,
    image: product.image || null,
    priceCents: product.priceCents,
    currency: product.currency || "RON",
    status: product.status || "available",
  };
}

export default function DiscountProductPicker({ selected, onChange, maxProducts = MAX_CODE_PRODUCTS }) {
  const [draft, setDraft] = useState({ ...EMPTY_FILTERS });
  const [filters, setFilters] = useState({ ...EMPTY_FILTERS });
  const [filtersOpen, setFiltersOpen] = useState(false);

  const [results, setResults] = useState([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState(0);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reviewOpen, setReviewOpen] = useState(false);

  const count = selected.size;
  const remaining = Math.max(0, maxProducts - count);
  const filterCount = activeFilterCount(filters);
  const filtered = Boolean(filterCount || filters.q.trim());

  const runSearch = useCallback(
    async (nextPage = 1) => {
      setSearching(true);
      setError("");
      try {
        const params = buildSearchParams("own", filters, nextPage, PICKER_PAGE_SIZE);
        const data = await api(`/api/vendor/discount-codes/product-search?${params.toString()}`);
        const products = Array.isArray(data?.products) ? data.products : [];
        setResults((current) => (nextPage === 1 ? products : mergeResults(current, products)));
        setPage(nextPage);
        setHasMore(Boolean(data?.hasMore));
        setTotal(Number(data?.total || 0));
        setSearched(true);
      } catch (err) {
        setError(err?.data?.message || err?.message || "Nu am putut căuta produsele.");
      } finally {
        setSearching(false);
      }
    },
    [filters]
  );

  useEffect(() => {
    runSearch(1);
  }, [runSearch]);

  function applyFilters() {
    setNotice("");
    setFilters({ ...draft });
    setFiltersOpen(false);
  }

  function resetFilters() {
    setDraft({ ...EMPTY_FILTERS });
    setFilters({ ...EMPTY_FILTERS });
    setFiltersOpen(false);
    setNotice("");
  }

  function addMany(products) {
    const next = new Map(selected);
    let skipped = 0;
    for (const p of products) {
      if (next.has(p.id)) continue;
      if (next.size >= maxProducts) {
        skipped += 1;
        continue;
      }
      next.set(p.id, summary(p));
    }
    onChange(next);
    return skipped;
  }

  function toggle(product) {
    setNotice("");
    if (selected.has(product.id)) {
      const next = new Map(selected);
      next.delete(product.id);
      onChange(next);
      return;
    }
    if (remaining === 0) {
      setNotice(`Un cod poate avea maximum ${maxProducts} de produse.`);
      return;
    }
    addMany([product]);
  }

  const everythingOnPage = results.length > 0 && results.every((p) => selected.has(p.id));

  function togglePage() {
    setNotice("");
    if (everythingOnPage) {
      const next = new Map(selected);
      results.forEach((p) => next.delete(p.id));
      onChange(next);
      return;
    }
    const skipped = addMany(results);
    if (skipped) setNotice(`Limita de ${maxProducts} produse a fost atinsă: ${skipped} nu au mai încăput.`);
  }

  async function selectAllFiltered() {
    setNotice("");
    setError("");
    setBulkBusy(true);
    try {
      const data = await api("/api/vendor/discount-codes/product-ids", {
        method: "POST",
        body: serverFilters("own", filters),
      });
      const products = Array.isArray(data?.products) ? data.products : [];
      const skipped = addMany(products);
      if (data?.truncated || skipped) {
        setNotice(
          `Au fost selectate maximum ${maxProducts} de produse. Restrânge căutarea dacă vrei alte produse.`
        );
      }
    } catch (err) {
      setError(err?.data?.message || err?.message || "Nu am putut selecta rezultatele.");
    } finally {
      setBulkBusy(false);
    }
  }

  function remove(id) {
    const next = new Map(selected);
    next.delete(id);
    onChange(next);
  }

  const selectedList = [...selected.values()];
  const flagged = selectedList.filter((p) => p.status === "unavailable").length;
  const moved = selectedList.filter((p) => p.status === "other_store").length;

  return (
    <div className={`${pickerStyles.picker} ${styles.codePicker}`}>
      {/* ---------- selecția curentă ---------- */}
      <div className={styles.pickedBar} aria-live="polite">
        <div>
          <strong>
            {count === 1 ? "1 produs selectat" : `${count} produse selectate`}
          </strong>
          <span>
            {count ? `Mai încap ${remaining} din ${maxProducts}` : `Alege cel puțin un produs (maximum ${maxProducts}).`}
          </span>
        </div>
        {count ? (
          <div className={styles.pickedActions}>
            <button type="button" className={pickerStyles.link} onClick={() => setReviewOpen((v) => !v)}>
              {reviewOpen ? "Ascunde selecția" : `Vezi selecția (${count})`}
            </button>
            <button type="button" className={pickerStyles.link} onClick={() => onChange(new Map())}>
              Golește
            </button>
          </div>
        ) : null}
      </div>

      {moved ? (
        <div className={pickerStyles.notice}>
          {moved === 1 ? "Un produs nu mai aparține" : `${moved} produse nu mai aparțin`} magazinului tău și nu{" "}
          {moved === 1 ? "mai primește" : "mai primesc"} reducerea. La salvare{" "}
          {moved === 1 ? "va fi scos" : "vor fi scoase"} automat de pe cod.
        </div>
      ) : null}

      {flagged ? (
        <div className={pickerStyles.notice}>
          {flagged === 1 ? "Un produs selectat nu se poate" : `${flagged} produse selectate nu se pot`} cumpăra
          acum (inactiv sau neaprobat). {flagged === 1 ? "Rămâne" : "Rămân"} pe cod și primesc reducerea când
          redevin disponibile; le poți scoate din selecție.
        </div>
      ) : null}

      {reviewOpen && count ? (
        <ul className={styles.pickedList}>
          {selectedList.map((p) => (
            <li key={p.id}>
              {p.image ? (
                <img src={p.image} alt="" className={pickerStyles.thumb} loading="lazy" />
              ) : (
                <span className={pickerStyles.thumb} aria-hidden="true" />
              )}
              <span className={pickerStyles.rowText}>
                <strong>{p.title || "Produs"}</strong>
                <span className={pickerStyles.meta}>
                  {money(p.priceCents, p.currency)}
                  {STATUS_LABELS[p.status] ? (
                    <span className={pickerStyles.badgeWarn}> {STATUS_LABELS[p.status]}</span>
                  ) : null}
                </span>
              </span>
              <button
                type="button"
                className={pickerStyles.iconGhost}
                onClick={() => remove(p.id)}
                aria-label={`Scoate ${p.title} din selecție`}
                title="Scoate din selecție"
              >
                <X size={16} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {/* ---------- căutare + filtre (fără <form>: suntem în formularul codului) ---------- */}
      <div className={pickerStyles.searchRow} role="search">
        <label className={pickerStyles.searchField}>
          <Search size={18} aria-hidden="true" />
          <input
            type="search"
            value={draft.q}
            onChange={(e) => setDraft((d) => ({ ...d, q: e.target.value }))}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                applyFilters();
              }
            }}
            placeholder="Caută în produsele tale"
            aria-label="Caută în produsele tale"
          />
        </label>
        <button
          type="button"
          className={filterCount ? pickerStyles.filterButtonActive : pickerStyles.filterButton}
          aria-expanded={filtersOpen}
          onClick={() => setFiltersOpen((open) => !open)}
        >
          <SlidersHorizontal size={17} aria-hidden="true" />
          <span>Filtre{filterCount ? ` · ${filterCount}` : ""}</span>
        </button>
      </div>

      {filtersOpen ? (
        <div className={pickerStyles.filtersPanel}>
          <label>
            <span>Categorie</span>
            <select value={draft.category} onChange={(e) => setDraft((d) => ({ ...d, category: e.target.value }))}>
              <option value="">Toate categoriile</option>
              {CATEGORIES_DETAILED.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.groupLabel} · {c.label}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span>Ocazie</span>
            <select value={draft.occasion} onChange={(e) => setDraft((d) => ({ ...d, occasion: e.target.value }))}>
              <option value="">Orice ocazie</option>
              {OCCASION_TAGS_DETAILED.map((o) => (
                <option key={o.key} value={o.key}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>

          <div className={pickerStyles.priceRow}>
            <label>
              <span>Preț minim (lei)</span>
              <input
                inputMode="decimal"
                value={draft.minPrice}
                onChange={(e) => setDraft((d) => ({ ...d, minPrice: e.target.value }))}
                placeholder="0"
              />
            </label>
            <label>
              <span>Preț maxim (lei)</span>
              <input
                inputMode="decimal"
                value={draft.maxPrice}
                onChange={(e) => setDraft((d) => ({ ...d, maxPrice: e.target.value }))}
                placeholder="Fără limită"
              />
            </label>
          </div>

          <label>
            <span>Disponibilitate</span>
            <select
              value={draft.availability}
              onChange={(e) => setDraft((d) => ({ ...d, availability: e.target.value }))}
            >
              {AVAILABILITY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>

          <label className={pickerStyles.checkLine}>
            <input
              type="checkbox"
              checked={draft.personalizable}
              onChange={(e) => setDraft((d) => ({ ...d, personalizable: e.target.checked }))}
            />
            <span>Doar produse personalizabile</span>
          </label>

          <div className={pickerStyles.filtersActions}>
            <button type="button" className={pickerStyles.ghost} onClick={resetFilters}>
              Resetează
            </button>
            <button type="button" className={pickerStyles.primary} onClick={applyFilters}>
              Aplică filtrele
            </button>
          </div>
        </div>
      ) : null}

      {error ? <div className={pickerStyles.error}>{error}</div> : null}
      {notice ? <div className={pickerStyles.notice}>{notice}</div> : null}

      {/* ---------- rezultate ---------- */}
      <div className={pickerStyles.resultsHead}>
        <span className={pickerStyles.resultsCount} aria-live="polite">
          {searched ? (total === 1 ? "1 rezultat" : `${total} rezultate`) : "Se încarcă…"}
        </span>
        {results.length ? (
          <div className={pickerStyles.resultsActions}>
            <button type="button" className={pickerStyles.link} onClick={togglePage}>
              {everythingOnPage ? "Deselectează pagina" : "Selectează pagina"}
            </button>
            {total > 0 ? (
              <button
                type="button"
                className={pickerStyles.link}
                onClick={selectAllFiltered}
                disabled={bulkBusy || remaining === 0}
              >
                {bulkBusy
                  ? "Se selectează…"
                  : filtered
                    ? `Toate rezultatele filtrate (${total})`
                    : `Toate rezultatele (${total})`}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {results.length ? (
        <ul className={searching && page === 1 ? `${pickerStyles.list} ${pickerStyles.listBusy}` : pickerStyles.list}>
          {results.map((p) => {
            const checked = selected.has(p.id);
            return (
              <li key={p.id} className={checked ? pickerStyles.rowChecked : pickerStyles.row}>
                <label className={pickerStyles.rowMain}>
                  <input
                    type="checkbox"
                    className={pickerStyles.checkbox}
                    checked={checked}
                    onChange={() => toggle(p)}
                    aria-label={`Selectează ${p.title}`}
                  />
                  {p.image ? (
                    <img src={p.image} alt="" className={pickerStyles.thumb} loading="lazy" />
                  ) : (
                    <span className={pickerStyles.thumb} aria-hidden="true" />
                  )}
                  <span className={pickerStyles.rowText}>
                    <strong>{p.title || "Produs"}</strong>
                    <span className={pickerStyles.meta}>{money(p.priceCents, p.currency)}</span>
                    <span className={pickerStyles.badges}>
                      {p.category ? (
                        <span className={pickerStyles.badgeSoft}>{getCanonicalLabel("category", p.category)}</span>
                      ) : null}
                      {p.personalizable ? <span className={pickerStyles.badgeSoft}>Personalizabil</span> : null}
                      {p.soldOut ? <span className={pickerStyles.badgeWarn}>Stoc epuizat</span> : null}
                    </span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      ) : searched && !searching ? (
        <div className={pickerStyles.empty}>
          <strong>{filtered ? "Niciun produs pentru această căutare" : "Nu ai încă produse publice"}</strong>
          <p>
            {filtered
              ? "Schimbă textul căutării sau resetează filtrele."
              : "Doar produsele tale publice (active și aprobate) pot fi alese pentru un cod."}
          </p>
          {filtered ? (
            <button type="button" className={pickerStyles.ghost} onClick={resetFilters}>
              Resetează filtrele
            </button>
          ) : null}
        </div>
      ) : null}

      {hasMore ? (
        <button type="button" className={pickerStyles.loadMore} disabled={searching} onClick={() => runSearch(page + 1)}>
          {searching ? "Se încarcă…" : "Încarcă mai multe"}
        </button>
      ) : null}
    </div>
  );
}
