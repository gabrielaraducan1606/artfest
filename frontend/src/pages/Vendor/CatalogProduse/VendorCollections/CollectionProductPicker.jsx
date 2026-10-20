// src/pages/Vendor/CatalogProduse/VendorCollections/CollectionProductPicker.jsx
//
// Selectorul de produse al unei colecții (etapa 1 - selecție MANUALĂ, fixă):
//  - sursa: „Magazinul meu” / „Tot Artfest” (inclusiv produsele proprii);
//  - căutare pe server + filtre (categorie, ocazie, buget, disponibilitate,
//    personalizare, magazin), cu paginare;
//  - bifare individuală, „toate de pe pagină”, „toate cele N rezultate”
//    (rezolvate pe server, aceleași filtre) și adăugare rapidă pe un rând;
//  - bară de selecție fixă jos, cu contorul și limita colecției.
// Nimic nu intră automat: produsele publicate ulterior NU se adaugă singure.
// Backend: vendorCollectionsRoutes.js (product-search, products, products/select-all).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Globe, Plus, Search, SlidersHorizontal, Sparkles, Store, X } from "lucide-react";

import { api } from "../../../../lib/api.js";
import { CATEGORIES_DETAILED } from "../../../../constants/productscategories.js";
import { OCCASION_TAGS_DETAILED } from "../../../../../../backend/src/constants/occasinsTags.js";
import { getCanonicalLabel } from "../../../../utils/optionLabels.js";
import {
  AVAILABILITY_OPTIONS,
  EMPTY_FILTERS,
  PICKER_PAGE_SIZE,
  SOURCE_OPTIONS,
  activeFilterCount,
  buildSearchParams,
  isSelectable,
  limitMessage,
  mergeResults,
  remainingCapacity,
  selectVisible,
  serverFilters,
  toggleSelection,
} from "./collectionPicker.js";
import styles from "./CollectionProducts.module.css";
import useInView from "./useInView.js";

// „Găsește produse cu AI”: vizibil, dar dezactivat („Disponibil în curând”) până la lansare.
// Cât timp e false: panoul nu se deschide și nu se face niciun apel AI (nici /ai-status).
const AI_COLLECTIONS_AVAILABLE = false;

function money(priceCents, currency = "RON") {
  const value = Number(priceCents || 0) / 100;
  return `${value.toLocaleString("ro-RO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

function errorText(err, fallback) {
  return limitMessage(err?.data) || err?.data?.message || err?.message || fallback;
}

export default function CollectionProductPicker({
  collectionId,
  allOwnActive = false,
  collectionCount = 0,
  maxProducts = 300,
  focusSignal = 0,
  inputRef,
  onChanged,
}) {
  const [scope, setScope] = useState(allOwnActive ? "marketplace" : "own");
  const [draft, setDraft] = useState({ ...EMPTY_FILTERS });
  const [filters, setFilters] = useState({ ...EMPTY_FILTERS });
  const [filtersOpen, setFiltersOpen] = useState(false);

  const [results, setResults] = useState([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState(0);
  // câte dintre rezultate se mai pot adăuga (calculat pe server, exact)
  const [selectableTotal, setSelectableTotal] = useState(0);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);

  const [selected, setSelected] = useState(() => new Set());
  // lista bifelor deschisă în bara de jos („Vezi selecția”)
  const [reviewOpen, setReviewOpen] = useState(false);
  // produsele văzute în căutări (titlu, imagine) - ca bifele din alte căutări
  // să poată fi afișate și deselectate individual
  const knownProductsRef = useRef(new Map());

  /*
   * „Găsește produse cu AI”: propunerea AI înlocuiește temporar lista de
   * rezultate - aceleași bife, aceeași bară, același „Adaugă în colecție”.
   * AI-ul NU adaugă nimic; folosește sursa și filtrele alese mai sus.
   */
  const [aiOpen, setAiOpen] = useState(false);
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiDiverse, setAiDiverse] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiResults, setAiResults] = useState(null); // null = căutare obișnuită
  const [aiInfo, setAiInfo] = useState(null); // { interpretation, meta, message }
  const [aiError, setAiError] = useState("");
  const [aiDismissed, setAiDismissed] = useState(() => new Set());
  const aiBusyRef = useRef(false);
  // starea AI de pe server: { enabled, available, dailyLimit, remaining } (null = necunoscută)
  const [aiStatus, setAiStatus] = useState(null);
  const resultsHeadRef = useRef(null);
  const [allFiltered, setAllFiltered] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const requestRef = useRef(0);
  // blochează dublu-click-ul înainte ca starea `busy` să ajungă în UI
  const busyRef = useRef(false);
  const rootRef = useRef(null);
  const inView = useInView(rootRef);
  const remaining = remainingCapacity(collectionCount, maxProducts);
  const filterCount = activeFilterCount(filters);

  const runSearch = useCallback(
    async (nextPage = 1) => {
      const requestId = ++requestRef.current;
      setSearching(true);
      setError("");

      try {
        const params = buildSearchParams(scope, filters, nextPage, PICKER_PAGE_SIZE);
        const data = await api(
          `/api/vendor/collections/${encodeURIComponent(collectionId)}/product-search?${params}`
        );
        if (requestId !== requestRef.current) return; // a pornit între timp o căutare nouă

        const products = Array.isArray(data?.products) ? data.products : [];
        products.forEach((p) => p?.id && knownProductsRef.current.set(p.id, p));
        setResults((current) => (nextPage === 1 ? mergeResults([], products) : mergeResults(current, products)));
        setPage(nextPage);
        setHasMore(Boolean(data?.hasMore));
        setTotal(Number(data?.total || 0));
        setSelectableTotal(Number(data?.selectableTotal ?? data?.total ?? 0));
        setSearched(true);
      } catch (err) {
        if (requestId === requestRef.current) setError(errorText(err, "Căutarea nu a reușit."));
      } finally {
        if (requestId === requestRef.current) setSearching(false);
      }
    },
    [collectionId, scope, filters]
  );

  /*
   * Sursa sau filtrele s-au schimbat -> căutare nouă. Bifele individuale se
   * PĂSTREAZĂ (poți selecta din mai multe căutări și adăuga o singură dată);
   * doar „toate rezultatele” se anulează, pentru că se referea la filtrul vechi.
   */
  useEffect(() => {
    setAllFiltered(false);
    runSearch(1);
  }, [runSearch]);

  useEffect(() => {
    if (!AI_COLLECTIONS_AVAILABLE) return undefined;
    let alive = true;
    api("/api/vendor/collections/ai-status")
      .then((data) => {
        if (alive) setAiStatus(data || null);
      })
      .catch(() => {
        if (alive) setAiStatus(null);
      });
    return () => {
      alive = false;
    };
  }, []);

  // CTA-ul „Adaugă produse” din editor: focus pe căutare
  useEffect(() => {
    if (!focusSignal) return;
    inputRef?.current?.focus({ preventScroll: true });
  }, [focusSignal, inputRef]);

  // textul căutării se aplică singur după o scurtă pauză de tastare
  useEffect(() => {
    if (draft.q === filters.q) return undefined;
    const handle = window.setTimeout(() => setFilters((f) => ({ ...f, q: draft.q })), 350);
    return () => window.clearTimeout(handle);
  }, [draft.q, filters.q]);

  const aiActive = aiResults !== null;
  const listItems = useMemo(
    () => (aiActive ? aiResults.filter((p) => !aiDismissed.has(p.id)) : results),
    [aiActive, aiResults, aiDismissed, results]
  );

  const selectableOnPage = useMemo(
    () => listItems.filter((p) => isSelectable(p, { allOwnActive })),
    [listItems, allOwnActive]
  );

  const everythingOnPageSelected =
    selectableOnPage.length > 0 && selectableOnPage.every((p) => selected.has(p.id));

  // bife făcute în alte căutări / filtre (nu se văd în lista curentă)
  const selectedElsewhere = useMemo(() => {
    const visibleIds = new Set(listItems.map((p) => p.id));
    return [...selected].filter((id) => !visibleIds.has(id)).length;
  }, [selected, listItems]);

  // „toate rezultatele” doar pe filtrul deja aplicat (nu în timpul tastării / căutării)
  const canSelectAllFiltered = selectableTotal > 0 && !searching && draft.q === filters.q;

  function applyFilters(event) {
    event?.preventDefault();
    setFilters({ ...draft });
    setFiltersOpen(false);
  }

  function resetFilters() {
    setDraft({ ...EMPTY_FILTERS });
    setFilters({ ...EMPTY_FILTERS });
  }

  function toggle(productId) {
    setAllFiltered(false);
    setNotice("");
    const { selected: next, blocked } = toggleSelection(selected, productId, remaining);
    if (blocked) {
      setNotice(`Colecția mai are loc pentru ${remaining} produse (maximum ${maxProducts}).`);
      return;
    }
    setSelected(next);
  }

  function togglePage() {
    setAllFiltered(false);
    setNotice("");

    if (everythingOnPageSelected) {
      const next = new Set(selected);
      selectableOnPage.forEach((p) => next.delete(p.id));
      setSelected(next);
      return;
    }

    const { selected: next, skipped } = selectVisible(selected, listItems, remaining, { allOwnActive });
    setSelected(next);
    if (skipped) setNotice(`${skipped} produse nu au mai încăput (maximum ${maxProducts} în colecție).`);
  }

  function selectAllFiltered() {
    if (!canSelectAllFiltered) return;
    if (selectableTotal > remaining) {
      setNotice(
        `Rezultatele au ${selectableTotal} produse noi, dar colecția mai are loc pentru ${remaining} (maximum ${maxProducts}). Restrânge căutarea.`
      );
      return;
    }
    setAllFiltered(true);
    setNotice("");
  }

  async function runAi(event) {
    event?.preventDefault();
    if (!AI_COLLECTIONS_AVAILABLE) return;
    const prompt = aiPrompt.trim();
    if (prompt.length < 3) {
      setAiError("Descrie în câteva cuvinte ce produse cauți.");
      return;
    }
    if (aiBusyRef.current) return;
    aiBusyRef.current = true;
    setAiLoading(true);
    setAiError("");
    setNotice("");
    setAllFiltered(false);

    try {
      const data = await api(`/api/vendor/collections/${encodeURIComponent(collectionId)}/ai-suggest`, {
        method: "POST",
        body: { prompt, diverseStores: aiDiverse, filters: serverFilters(scope, filters) },
      });
      const products = Array.isArray(data?.products) ? data.products : [];
      products.forEach((p) => p?.id && knownProductsRef.current.set(p.id, p));
      setAiDismissed(new Set());
      setAiResults(products);
      // panoul se închide (cererea rămâne pentru rafinare), propunerea intră în ecran
      setAiOpen(false);
      window.setTimeout(() => resultsHeadRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
      setAiInfo({ interpretation: data?.interpretation || null, meta: data?.meta || null, message: data?.message || "" });
      if (data?.meta) setAiStatus((st) => ({ ...(st || {}), ...data.meta, enabled: true }));
    } catch (err) {
      setAiError(errorText(err, "Asistentul AI nu a putut răspunde acum."));
      if (err?.data?.meta) {
        setAiInfo((info) => ({ ...(info || {}), meta: err.data.meta }));
        setAiStatus((st) => ({ ...(st || {}), ...err.data.meta }));
      }
      if (err?.data?.error === "ai_disabled") setAiStatus((st) => ({ ...(st || {}), enabled: false }));
    } finally {
      aiBusyRef.current = false;
      setAiLoading(false);
    }
  }

  function closeAiResults() {
    setAiResults(null);
    setAiDismissed(new Set());
    setAllFiltered(false);
  }

  // scoate un produs din propunere (nu din colecție; bifa lui dispare)
  function dismissFromProposal(productId) {
    setAiDismissed((current) => new Set(current).add(productId));
    if (selected.has(productId)) deselect(productId);
  }

  function deselect(productId) {
    const next = new Set(selected);
    next.delete(productId);
    setSelected(next);
    if (!next.size) setReviewOpen(false);
  }

  function clearSelection() {
    setReviewOpen(false);
    setSelected(new Set());
    setAllFiltered(false);
    setNotice("");
  }

  async function afterAdd(added, extra = "", addedIds = []) {
    if (addedIds.length) {
      const addedSet = new Set(addedIds);
      setAiResults((list) => (list ? list.map((p) => (addedSet.has(p.id) ? { ...p, inCollection: true } : p)) : list));
    }
    setSelected(new Set());
    setReviewOpen(false);
    setAllFiltered(false);
    setNotice(
      added
        ? `${added === 1 ? "Un produs adăugat" : `${added} produse adăugate`} în colecție.${extra}`
        : `Produsele erau deja în colecție.${extra}`
    );
    await Promise.all([onChanged?.(), runSearch(1)]);
  }

  async function addIds(productIds) {
    if (!productIds.length || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");

    try {
      const data = await api(`/api/vendor/collections/${encodeURIComponent(collectionId)}/products`, {
        method: "POST",
        body: { productIds },
      });
      const extra = data?.ineligible
        ? ` ${data.ineligible} nu mai erau disponibile și nu au fost adăugate.`
        : "";
      await afterAdd(Number(data?.added || 0), extra, Array.isArray(data?.productIds) ? data.productIds : []);
    } catch (err) {
      setError(errorText(err, "Produsele nu au putut fi adăugate."));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  /*
   * „Toate cele N rezultate” (filtrul curent, rezolvat pe server) + bifele
   * individuale făcute în alte căutări, dacă există.
   */
  async function addAllFiltered() {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");

    try {
      const data = await api(
        `/api/vendor/collections/${encodeURIComponent(collectionId)}/products/select-all`,
        { method: "POST", body: { filters: serverFilters(scope, filters) } }
      );
      let added = Number(data?.added || 0);

      if (selected.size) {
        const extra = await api(`/api/vendor/collections/${encodeURIComponent(collectionId)}/products`, {
          method: "POST",
          body: { productIds: [...selected] },
        });
        added += Number(extra?.added || 0);
      }

      await afterAdd(added);
    } catch (err) {
      setError(errorText(err, "Rezultatele nu au putut fi adăugate."));
      // ce s-a adăugat deja rămâne vizibil corect
      await Promise.all([onChanged?.(), runSearch(1)]);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  const barVisible = allFiltered || selected.size > 0;

  return (
    <div ref={rootRef} className={barVisible ? `${styles.picker} ${styles.withBar}` : styles.picker}>
      {/* ---------- sursa ---------- */}
      {/* sursa produselor: aceeași stare `scope` care comandă căutarea */}
      <div className={styles.sources} role="radiogroup" aria-label="Sursa produselor">
        {SOURCE_OPTIONS.map((option) => {
          const Icon = option.value === "own" ? Store : Globe;
          const active = scope === option.value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={active}
              className={active ? styles.sourceActive : styles.source}
              onClick={() => setScope(option.value)}
            >
              <span className={styles.sourceIcon} aria-hidden="true">
                <Icon size={18} strokeWidth={1.8} />
              </span>
              <span className={styles.sourceText}>
                <strong>{option.label}</strong>
                <span>{option.hint}</span>
              </span>
              <span className={styles.sourceDot} aria-hidden="true" />
            </button>
          );
        })}
      </div>

      <p className={styles.sourceHint}>
        {scope === "own"
          ? allOwnActive
            ? "Produsele tale sunt deja incluse automat (opțiunea de mai sus). Aici le vezi doar pentru referință."
            : "Alege produsele tale care intră în colecție."
          : "Produse publice de la toți creatorii Artfest, inclusiv ale tale. Produsele altor magazine rămân ale lor: preț, stoc și comandă."}
      </p>

      {/* ---------- căutare + filtre ---------- */}
      <form className={styles.searchRow} onSubmit={applyFilters} role="search">
        <label className={styles.searchField}>
          <Search size={18} aria-hidden="true" />
          <input
            ref={inputRef}
            type="search"
            value={draft.q}
            onChange={(e) => setDraft((d) => ({ ...d, q: e.target.value }))}
            placeholder={scope === "own" ? "Caută în produsele tale" : "Caută produse pe Artfest"}
            aria-label="Caută produse"
          />
        </label>

        <button
          type="button"
          className={filterCount ? styles.filterButtonActive : styles.filterButton}
          aria-expanded={filtersOpen}
          onClick={() => setFiltersOpen((open) => !open)}
        >
          <SlidersHorizontal size={17} aria-hidden="true" />
          <span>Filtre{filterCount ? ` · ${filterCount}` : ""}</span>
        </button>
      </form>

      {/* ---------- asistentul AI (doar când e activ: AI_VENDOR_COLLECTIONS_ENABLED) ---------- */}
      {!AI_COLLECTIONS_AVAILABLE ? (
        <button type="button" className={styles.aiToggleSoon} disabled aria-disabled="true">
          <Sparkles size={17} aria-hidden="true" />
          Găsește produse cu AI
          <span className={styles.aiSoonBadge}>Disponibil în curând</span>
        </button>
      ) : aiStatus?.enabled ? (
        <button
          type="button"
          className={aiOpen ? styles.aiToggleActive : styles.aiToggle}
          aria-expanded={aiOpen}
          onClick={() => setAiOpen((open) => !open)}
        >
          <Sparkles size={17} aria-hidden="true" />
          Găsește produse cu AI
          {typeof aiStatus.remaining === "number" ? (
            <span className={styles.aiBadge}>{aiStatus.remaining} rămase azi</span>
          ) : null}
        </button>
      ) : null}

      {AI_COLLECTIONS_AVAILABLE && aiOpen && aiStatus?.enabled ? (
        <form className={styles.aiPanel} onSubmit={runAi}>
          <label className={styles.aiLabel} htmlFor="collection-ai-prompt">
            Descrie ce produse cauți
          </label>
          <textarea
            id="collection-ai-prompt"
            className={styles.aiTextarea}
            value={aiPrompt}
            maxLength={600}
            rows={3}
            onChange={(e) => setAiPrompt(e.target.value)}
            placeholder="Ex.: Vreau 20 de cadouri pentru Crăciun, sub 100 lei, din magazine diferite"
          />
          <label className={styles.checkLine}>
            <input type="checkbox" checked={aiDiverse} onChange={(e) => setAiDiverse(e.target.checked)} />
            <span>Din magazine diferite</span>
          </label>
          <p className={styles.aiHint}>
            AI-ul caută doar produse reale și publice, din sursa și filtrele alese mai sus. Nu adaugă nimic
            singur: tu alegi ce intră în colecție.
          </p>
          {aiStatus && aiStatus.remaining === 0 ? (
            <div className={styles.notice}>
              Ai folosit toate căutările AI de azi ({aiStatus.dailyLimit}). Mâine primești din nou; până atunci
              poți folosi căutarea obișnuită și filtrele, fără limită.
            </div>
          ) : aiStatus && aiStatus.available === false ? (
            <div className={styles.notice}>
              Asistentul AI nu este disponibil momentan. Căutarea obișnuită și filtrele funcționează în continuare.
            </div>
          ) : null}
          {aiError ? <div className={styles.error}>{aiError}</div> : null}
          <div className={styles.aiActions}>
            <span className={styles.aiQuota}>
              {typeof aiStatus?.remaining === "number"
                ? `${aiStatus.remaining} din ${aiStatus.dailyLimit} căutări AI rămase azi`
                : ""}
            </span>
            <button
              type="submit"
              className={styles.primary}
              disabled={
                aiLoading ||
                aiPrompt.trim().length < 3 ||
                aiStatus?.remaining === 0 ||
                aiStatus?.available === false
              }
            >
              {aiLoading ? "Se caută…" : "Găsește produse"}
            </button>
          </div>
        </form>
      ) : null}

      {filtersOpen ? (
        <form className={styles.filtersPanel} onSubmit={applyFilters}>
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

          <div className={styles.priceRow}>
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

          {scope === "marketplace" ? (
            <label>
              <span>Magazin</span>
              <input
                value={draft.store}
                onChange={(e) => setDraft((d) => ({ ...d, store: e.target.value }))}
                placeholder="Numele magazinului"
              />
            </label>
          ) : null}

          <label className={styles.checkLine}>
            <input
              type="checkbox"
              checked={draft.personalizable}
              onChange={(e) => setDraft((d) => ({ ...d, personalizable: e.target.checked }))}
            />
            <span>Doar produse personalizabile</span>
          </label>

          <div className={styles.filtersActions}>
            <button type="button" className={styles.ghost} onClick={resetFilters}>
              Resetează
            </button>
            <button type="submit" className={styles.primary}>
              Aplică filtrele
            </button>
          </div>
        </form>
      ) : null}

      {/* ---------- bara rezultatelor ---------- */}
      <div className={styles.resultsHead} ref={resultsHeadRef}>
        <span className={styles.resultsCount} aria-live="polite">
          {aiActive
            ? `Propunere AI · ${listItems.length} ${listItems.length === 1 ? "produs" : "produse"}`
            : searching && page === 1
              ? "Se caută…"
              : `${total} ${total === 1 ? "rezultat" : "rezultate"}`}
        </span>

        {selectableOnPage.length ? (
          <div className={styles.resultsActions}>
            <button type="button" className={styles.link} onClick={togglePage} disabled={allFiltered}>
              {aiActive
                ? everythingOnPageSelected
                  ? "Deselectează propunerile"
                  : "Selectează toate propunerile"
                : everythingOnPageSelected
                  ? "Deselectează pagina"
                  : "Selectează pagina"}
            </button>
            {!aiActive && selectableTotal > 0 ? (
              <button
                type="button"
                className={styles.link}
                onClick={selectAllFiltered}
                disabled={!canSelectAllFiltered || allFiltered}
              >
                {filterCount || filters.q
                  ? `Toate rezultatele filtrate (${selectableTotal})`
                  : `Toate rezultatele (${selectableTotal})`}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {aiActive ? (
        <div className={styles.aiSummary}>
          <div className={styles.badges}>
            {aiInfo?.interpretation?.occasionLabel ? (
              <span className={styles.badgeSoft}>{aiInfo.interpretation.occasionLabel}</span>
            ) : null}
            {aiInfo?.interpretation?.minPrice ? (
              <span className={styles.badgeSoft}>de la {aiInfo.interpretation.minPrice} lei</span>
            ) : null}
            {aiInfo?.interpretation?.maxPrice ? (
              <span className={styles.badgeSoft}>până la {aiInfo.interpretation.maxPrice} lei</span>
            ) : null}
            {aiInfo?.interpretation?.diverseStores ? (
              <span className={styles.badgeSoft}>magazine diferite</span>
            ) : null}
            {aiInfo?.interpretation?.personalizable ? (
              <span className={styles.badgeSoft}>personalizabile</span>
            ) : null}
          </div>
          <span className={styles.aiQuota}>
            {typeof aiStatus?.remaining === "number" ? `${aiStatus.remaining} din ${aiStatus.dailyLimit} căutări AI rămase azi` : ""}
          </span>
          <button type="button" className={styles.link} onClick={closeAiResults}>
            Înapoi la căutare
          </button>
        </div>
      ) : null}

      {error ? <div className={styles.error}>{error}</div> : null}
      {notice ? <div className={styles.notice}>{notice}</div> : null}

      {/* ---------- rezultate ---------- */}
      {aiLoading || (!aiActive && !results.length && searching) ? (
        <ul className={styles.list} aria-busy="true" aria-label="Se încarcă produsele">
          {[0, 1, 2].map((i) => (
            <li key={i} className={styles.skeletonRow} aria-hidden="true">
              <span className={styles.skeletonThumb} />
              <span className={styles.skeletonLines}>
                <span />
                <span />
              </span>
            </li>
          ))}
        </ul>
      ) : listItems.length ? (
        <ul
          className={!aiActive && searching && page === 1 ? `${styles.list} ${styles.listBusy}` : styles.list}
          aria-busy={!aiActive && searching && page === 1 ? "true" : "false"}
        >
          {listItems.map((p) => {
            const selectable = isSelectable(p, { allOwnActive });
            const checked = allFiltered ? selectable : selected.has(p.id);
            const autoIncluded = p.isOwn && allOwnActive;

            return (
              <li key={p.id} className={checked ? styles.rowChecked : styles.row}>
                <label className={styles.rowMain}>
                  <input
                    type="checkbox"
                    className={styles.checkbox}
                    checked={checked || p.inCollection || autoIncluded}
                    disabled={!selectable || allFiltered}
                    onChange={() => toggle(p.id)}
                    aria-label={`Selectează ${p.title}`}
                  />
                  {p.image ? (
                    <img src={p.image} alt="" className={styles.thumb} loading="lazy" />
                  ) : (
                    <span className={styles.thumb} aria-hidden="true" />
                  )}
                  <span className={styles.rowText}>
                    <strong>{p.title || "Produs"}</strong>
                    <span className={styles.meta}>
                      {money(p.priceCents, p.currency)}
                      {p.storeName ? ` · ${p.storeName}` : ""}
                    </span>
                    <span className={styles.badges}>
                      <span className={p.isOwn ? styles.badgeOwn : styles.badgeOther}>
                        {p.isOwn ? "Produsul tău" : "Alt magazin"}
                      </span>
                      {p.category ? (
                        <span className={styles.badgeSoft}>{getCanonicalLabel("category", p.category)}</span>
                      ) : null}
                      {p.personalizable ? <span className={styles.badgeSoft}>Personalizabil</span> : null}
                      {p.soldOut ? <span className={styles.badgeWarn}>Stoc epuizat</span> : null}
                    </span>
                    {aiActive && p.reason ? <span className={styles.aiReason}>{p.reason}</span> : null}
                  </span>
                </label>

                <div className={styles.rowAction}>
                  {p.inCollection ? (
                    <span className={styles.stateAdded}>
                      <Check size={15} aria-hidden="true" /> În colecție
                    </span>
                  ) : autoIncluded ? (
                    <span className={styles.stateAuto}>Inclus automat</span>
                  ) : (
                    <button
                      type="button"
                      className={styles.iconButton}
                      disabled={busy || remaining === 0}
                      onClick={() => addIds([p.id])}
                      aria-label={`Adaugă ${p.title} în colecție`}
                      title="Adaugă acum"
                    >
                      <Plus size={18} aria-hidden="true" />
                    </button>
                  )}
                  {aiActive && !p.inCollection ? (
                    <button
                      type="button"
                      className={styles.iconGhost}
                      onClick={() => dismissFromProposal(p.id)}
                      aria-label={`Elimină ${p.title} din propunere`}
                      title="Elimină din propunere"
                    >
                      <X size={16} aria-hidden="true" />
                    </button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      ) : aiActive ? (
        <div className={styles.empty}>
          <strong>Nicio propunere de afișat</strong>
          <p>{aiInfo?.message || "Reformulează cererea sau lărgește filtrele, apoi încearcă din nou."}</p>
          <button type="button" className={styles.ghost} onClick={closeAiResults}>
            Înapoi la căutare
          </button>
        </div>
      ) : searched && !searching ? (
        <div className={styles.empty}>
          {filterCount || filters.q ? (
            <>
              <strong>Niciun produs pentru această căutare</strong>
              <p>Încearcă alt cuvânt sau renunță la unele filtre.</p>
            </>
          ) : scope === "own" ? (
            <>
              <strong>Nu ai încă produse publice</strong>
              <p>Produsele apar aici după ce sunt aprobate și vizibile în magazinul tău. Poți alege între timp din tot Artfest.</p>
            </>
          ) : (
            <>
              <strong>Niciun produs disponibil</strong>
              <p>Momentan nu există produse publice eligibile pentru colecții.</p>
            </>
          )}
          {filterCount || filters.q ? (
            <button type="button" className={styles.ghost} onClick={resetFilters}>
              Șterge filtrele
            </button>
          ) : null}
        </div>
      ) : null}

      {!aiActive && hasMore ? (
        <button type="button" className={styles.loadMore} disabled={searching} onClick={() => runSearch(page + 1)}>
          {searching ? "Se încarcă…" : "Încarcă mai multe"}
        </button>
      ) : null}

      {/* ---------- bara de selecție (fixă jos) ---------- */}
      {barVisible && inView ? (
        <div className={styles.selectionBar} role="region" aria-label="Produse selectate">
          {reviewOpen && selected.size ? (
            <ul className={styles.reviewList} aria-label="Produsele bifate">
              {[...selected].map((id) => {
                const p = knownProductsRef.current.get(id) || {};
                return (
                  <li key={id} className={styles.reviewItem}>
                    {p.image ? (
                      <img src={p.image} alt="" className={styles.reviewThumb} loading="lazy" />
                    ) : (
                      <span className={styles.reviewThumb} aria-hidden="true" />
                    )}
                    <span className={styles.reviewText}>
                      <strong>{p.title || "Produs"}</strong>
                      <span>{p.storeName || ""}</span>
                    </span>
                    <button
                      type="button"
                      className={styles.iconGhost}
                      onClick={() => deselect(id)}
                      aria-label={`Deselectează ${p.title || "produsul"}`}
                    >
                      <X size={16} aria-hidden="true" />
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : null}

          <div className={styles.selectionInfo}>
            <strong>
              {allFiltered
                ? `Toate cele ${selectableTotal} rezultate${selected.size ? ` + ${selected.size} bifate` : ""}`
                : `${selected.size} ${selected.size === 1 ? "produs selectat" : "produse selectate"}`}
            </strong>
            <span>
              {selectedElsewhere && !allFiltered ? `${selectedElsewhere} din alte căutări · ` : ""}
              Mai încap {remaining} din {maxProducts}
            </span>
            {selected.size ? (
              <button
                type="button"
                className={styles.link}
                aria-expanded={reviewOpen}
                onClick={() => setReviewOpen((open) => !open)}
              >
                {reviewOpen ? "Ascunde selecția" : `Vezi selecția (${selected.size})`}
              </button>
            ) : null}
          </div>
          <div className={styles.selectionActions}>
            <button type="button" className={styles.iconGhost} onClick={clearSelection} aria-label="Anulează selecția">
              <X size={18} aria-hidden="true" />
            </button>
            <button
              type="button"
              className={styles.primary}
              disabled={busy}
              onClick={() => (allFiltered ? addAllFiltered() : addIds([...selected]))}
            >
              {busy ? "Se adaugă…" : "Adaugă în colecție"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
