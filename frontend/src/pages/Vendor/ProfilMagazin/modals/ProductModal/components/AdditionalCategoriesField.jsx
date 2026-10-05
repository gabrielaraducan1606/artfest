import { useEffect, useId, useMemo, useRef, useState } from "react";

import styles from "../../../components/css/ProductModal.module.css";
import {
  MAX_ADDITIONAL_CATEGORIES,
  normalizeAdditionalCategoryKeys,
} from "../../../../../../utils/additionalCategories.js";

/*
 * Categorii SUPLIMENTARE ale produsului (discovery intern):
 *  - max 3, fără duplicate, niciodată egale cu categoria principală;
 *  - chips pentru selecții + căutare în catalog;
 *  - sugestiile AI sunt doar propuneri - se adaugă DOAR la click.
 * Backend-ul validează aceleași reguli (normalizeAdditionalCategories).
 */
export default function AdditionalCategoriesField({
  value,
  onChange,
  options = [],
  primaryCategory = "",
  suggestions = [],
  inputId: inputIdProp,
  showInvite = false,
}) {
  const generatedId = useId();
  const inputId = inputIdProp || generatedId;
  const listId = `${inputId}-list`;

  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  const selected = useMemo(
    () => normalizeAdditionalCategoryKeys(value, primaryCategory),
    [value, primaryCategory]
  );

  const labelByKey = useMemo(
    () => new Map(options.map((o) => [o.key, o.label || o.key])),
    [options]
  );

  const isFull = selected.length >= MAX_ADDITIONAL_CATEGORIES;

  useEffect(() => {
    if (!open) return undefined;

    const onPointerDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
    };
  }, [open]);

  const normalize = (s) =>
    String(s || "")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase();

  const results = useMemo(() => {
    const q = normalize(query);
    const taken = new Set(selected);

    return options
      .filter((o) => o.key !== primaryCategory && !taken.has(o.key))
      .filter(
        (o) =>
          !q ||
          normalize(o.label).includes(q) ||
          normalize(o.groupLabel).includes(q)
      )
      .slice(0, 30);
  }, [options, selected, primaryCategory, query]);

  const pendingSuggestions = useMemo(() => {
    const taken = new Set(selected);
    return normalizeAdditionalCategoryKeys(suggestions, primaryCategory).filter(
      (key) => !taken.has(key) && labelByKey.has(key)
    );
  }, [suggestions, selected, primaryCategory, labelByKey]);

  const commit = (next) => {
    onChange(normalizeAdditionalCategoryKeys(next, primaryCategory));
  };

  const add = (key) => {
    if (isFull || !key) return;
    commit([...selected, key]);
    setQuery("");
  };

  const remove = (key) => {
    commit(selected.filter((k) => k !== key));
  };

  return (
    <div ref={wrapRef} className={styles.additionalCategories}>
      <label className={styles.label} htmlFor={inputId}>
        Categorii suplimentare{" "}
        <span className={styles.additionalCategoriesCount}>
          {selected.length}/{MAX_ADDITIONAL_CATEGORIES}
        </span>
      </label>

      <p className={styles.additionalCategoriesHelp}>
        Poți alege până la 3 categorii suplimentare pentru ca produsul să fie
        descoperit mai ușor.
      </p>

      {/* produs existent, încă fără suplimentare: invitație discretă */}
      {showInvite && selected.length === 0 && (
        <p className={styles.additionalCategoriesInvite}>
          Poți adăuga acum și categorii suplimentare pentru a îmbunătăți
          descoperirea produsului.
        </p>
      )}

      {selected.length > 0 && (
        <ul className={styles.additionalCategoriesChips} aria-label="Categorii suplimentare alese">
          {selected.map((key) => (
            <li key={key} className={styles.additionalCategoriesChip}>
              <span>{labelByKey.get(key) || key}</span>
              <button
                type="button"
                className={styles.additionalCategoriesChipRemove}
                onClick={() => remove(key)}
                aria-label={`Elimină categoria ${labelByKey.get(key) || key}`}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* sugestii AI: doar propuneri, se adaugă DOAR la click */}
      {pendingSuggestions.length > 0 && !isFull && (
        <div className={styles.additionalCategoriesSuggestions}>
          <span className={styles.additionalCategoriesSuggestionsLabel}>
            Categorii suplimentare sugerate de AI:
          </span>
          <ul className={styles.additionalCategoriesSuggestionList}>
            {pendingSuggestions.map((key) => (
              <li key={key} className={styles.additionalCategoriesSuggestion}>
                <span>{labelByKey.get(key)}</span>
                <button
                  type="button"
                  className={styles.additionalCategoriesSuggestionAdd}
                  onClick={() => add(key)}
                  aria-label={`Adaugă categoria ${labelByKey.get(key)}`}
                >
                  + Adaugă
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {isFull ? (
        <p className={styles.additionalCategoriesFull}>
          Ai ales numărul maxim de categorii suplimentare.
        </p>
      ) : (
        <div className={styles.additionalCategoriesSearch}>
          <input
            id={inputId}
            className={styles.input}
            type="search"
            value={query}
            placeholder={
              primaryCategory
                ? "Caută o categorie…"
                : "Alege întâi categoria principală"
            }
            disabled={!primaryCategory}
            autoComplete="off"
            role="combobox"
            aria-expanded={open}
            aria-controls={listId}
            onFocus={() => setOpen(true)}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") setOpen(false);
              if (e.key === "Enter") {
                e.preventDefault();
                if (results[0]) add(results[0].key);
              }
            }}
          />

          {open && primaryCategory && (
            <ul id={listId} role="listbox" className={styles.additionalCategoriesList}>
              {results.length === 0 ? (
                <li className={styles.additionalCategoriesEmpty}>
                  Nicio categorie găsită.
                </li>
              ) : (
                results.map((o) => (
                  <li key={o.key} role="option" aria-selected="false">
                    <button
                      type="button"
                      className={styles.additionalCategoriesOption}
                      onClick={() => add(o.key)}
                    >
                      <span>{o.label}</span>
                      {o.groupLabel && (
                        <span className={styles.additionalCategoriesGroup}>
                          {o.groupLabel}
                        </span>
                      )}
                    </button>
                  </li>
                ))
              )}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
