// Cardul opțional „Adaugă în colecții” din pasul Publicare (Smart Listing), afișat
// chiar înaintea butonului de publicare, deschis implicit. Fără pas nou în wizard;
// asocierea se face după salvarea produsului (logica existentă, neschimbată).
import React, { useCallback, useEffect, useId, useState } from "react";
import {
  COLLECTIONS_ENDPOINT,
  createCollection,
  mapCollections,
  normalizeCollectionIds,
  toggleCollectionId,
  validateNewCollectionTitle,
} from "./smartListingCollections.js";
import styles from "./SmartListingCollections.module.css";

// `lockedIds`: colecții a căror apartenență nu s-a putut verifica (editare) - nu se pot schimba
export default function SmartListingCollections({ api, enabled, selectedIds, onChange, lockedIds = [], intro = "" }) {
  const baseId = useId();
  const selected = normalizeCollectionIds(selectedIds);
  const [state, setState] = useState({ status: "idle", items: [], error: "" });
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newError, setNewError] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setState((s) => ({ ...s, status: "loading", error: "" }));
    try {
      const data = await api(COLLECTIONS_ENDPOINT);
      setState({ status: "ready", items: mapCollections(data), error: "" });
    } catch {
      setState({ status: "error", items: [], error: "Nu am putut încărca colecțiile." });
    }
  }, [api]);

  // cardul e vizibil implicit: lista se încarcă imediat
  useEffect(() => {
    if (enabled && state.status === "idle") load();
  }, [enabled, state.status, load]);

  // o colecție aleasă în ciornă și ștearsă între timp nu rămâne selectată „invizibil”
  useEffect(() => {
    if (state.status !== "ready") return;
    const known = new Set(state.items.map((c) => c.id));
    const kept = selected.filter((id) => known.has(id));
    if (kept.length !== selected.length) onChange(kept);
  }, [state.status, state.items]); // eslint-disable-line react-hooks/exhaustive-deps

  const locked = new Set(lockedIds);
  const toggle = (id) => {
    if (locked.has(id)) return;
    onChange(toggleCollectionId(selected, id));
  };

  const submitNew = async () => {
    const invalid = validateNewCollectionTitle(newTitle);
    if (invalid) {
      setNewError(invalid);
      return;
    }
    setSaving(true);
    setNewError("");
    try {
      const created = await createCollection({ api, title: newTitle });
      if (created?.id) {
        setState((s) => ({
          ...s,
          status: "ready",
          items: [...mapCollections({ collections: [created] }), ...s.items.filter((c) => c.id !== created.id)],
        }));
        onChange(normalizeCollectionIds([...selected, created.id]));
      }
      setNewTitle("");
      setCreating(false);
    } catch (error) {
      setNewError(error?.data?.message || "Nu am putut crea colecția. Încearcă din nou.");
    } finally {
      setSaving(false);
    }
  };

  const summary = selected.length
    ? `${selected.length} ${selected.length === 1 ? "colecție aleasă" : "colecții alese"}`
    : "Nicio colecție aleasă";

  return (
    <section className={styles.block} data-testid="sl-collections" aria-labelledby={`${baseId}-title`}>
      <div className={styles.header}>
        <h3 id={`${baseId}-title`} className={styles.title}>
          Adaugă în colecții
        </h3>
        <span className={styles.optionalBadge}>Opțional</span>
        <span className={styles.summary} aria-live="polite">
          {summary}
        </span>
      </div>
      <p className={styles.intro}>{intro || "Alege una sau mai multe colecții ale tale. Poți sări peste acest pas."}</p>

      {(
        <div id={`${baseId}-panel`} className={styles.panel}>
          {!enabled ? (
            <p className={styles.hint}>Colecțiile se pot alege la salvarea reală a produsului.</p>
          ) : state.status === "loading" || state.status === "idle" ? (
            <p className={styles.hint} role="status">Se încarcă colecțiile…</p>
          ) : state.status === "error" ? (
            <p className={styles.error} role="alert">
              {state.error}{" "}
              <button type="button" className={styles.link} onClick={load}>
                Reîncearcă
              </button>
            </p>
          ) : (
            <>
              {state.items.length === 0 ? (
                <p className={styles.hint}>Nu ai încă nicio colecție.</p>
              ) : (
                <ul className={styles.list}>
                  {state.items.map((c) => (
                    <li key={c.id}>
                      <label className={`${styles.item} ${c.auto ? styles.itemAuto : ""}`}>
                        <input
                          type="checkbox"
                          checked={c.auto || selected.includes(c.id)}
                          disabled={c.auto || locked.has(c.id)}
                          onChange={() => toggle(c.id)}
                        />
                        <span className={styles.itemTitle}>{c.title}</span>
                        <span className={styles.itemMeta}>
                          {c.auto ? "include automat produsele tale" : `${c.productsCount} produse`}
                          {c.inactive ? " · inactivă" : ""}
                          {locked.has(c.id) ? " · nu s-a putut verifica, rămâne neschimbată" : ""}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              )}

              {creating ? (
                <div className={styles.newRow}>
                  <input
                    className={styles.input}
                    type="text"
                    value={newTitle}
                    maxLength={160}
                    placeholder="Numele colecției"
                    aria-label="Numele colecției noi"
                    autoFocus
                    onChange={(e) => {
                      setNewTitle(e.target.value);
                      setNewError("");
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        submitNew();
                      }
                    }}
                  />
                  <button type="button" className={styles.smallPrimary} onClick={submitNew} disabled={saving}>
                    {saving ? "Se creează…" : "Creează"}
                  </button>
                  <button
                    type="button"
                    className={styles.link}
                    onClick={() => {
                      setCreating(false);
                      setNewError("");
                    }}
                    disabled={saving}
                  >
                    Renunță
                  </button>
                </div>
              ) : (
                <button type="button" className={styles.link} onClick={() => setCreating(true)}>
                  + Creează o colecție nouă
                </button>
              )}
              {newError ? (
                <p className={styles.error} role="alert">
                  {newError}
                </p>
              ) : null}
              <p className={styles.hint}>Produsul apare în colecție doar după ce este publicat.</p>
            </>
          )}
        </div>
      )}
    </section>
  );
}
