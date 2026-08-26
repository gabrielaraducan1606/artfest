// src/pages/Vendor/CostsProfit/CostLibraryPage.jsx

import { useEffect, useMemo, useState } from "react";
import styles from "./CostLibraryPage.module.css";

import {
  fetchCostItems,
  createCostItem,
  updateCostItem,
  archiveCostItem,
  restoreCostItem,
} from "./costLibraryApi.js";

/* =========================================================
   Constante
========================================================= */

const TYPE_OPTIONS = [
  { value: "MATERIAL", label: "Materiale" },
  { value: "PACKAGING", label: "Ambalaje" },
  { value: "OTHER", label: "Alte costuri" },
];

const TYPE_LABELS = TYPE_OPTIONS.reduce((acc, t) => {
  acc[t.value] = t.label;
  return acc;
}, {});

const EMPTY_FORM = {
  id: null,
  type: "MATERIAL",
  name: "",
  unit: "",
  unitCostLei: "",
  notes: "",
};

const moneyFormatter = new Intl.NumberFormat("ro-RO", {
  style: "currency",
  currency: "RON",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function formatMoney(lei) {
  const value = Number(lei);
  if (!Number.isFinite(value)) return moneyFormatter.format(0);
  return moneyFormatter.format(value);
}

function leiToCents(value) {
  const numeric = Number(String(value).replace(",", "."));
  if (!Number.isFinite(numeric) || numeric < 0) return null;
  return Math.round(numeric * 100);
}

/* =========================================================
   Componenta principală
========================================================= */

export default function CostLibraryPage() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [filterType, setFilterType] = useState("");
  const [filterActive, setFilterActive] = useState("true");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  const [form, setForm] = useState(null); // null = închis
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  const [busyId, setBusyId] = useState(null);
  const [rowError, setRowError] = useState("");

  useEffect(() => {
    const handle = setTimeout(() => {
      setDebouncedSearch(search.trim());
    }, 300);

    return () => clearTimeout(handle);
  }, [search]);

  async function loadItems() {
    try {
      setLoading(true);
      setLoadError("");

      const data = await fetchCostItems({
        type: filterType,
        q: debouncedSearch,
        isActive: filterActive,
      });

      setItems(data);
    } catch (err) {
      setLoadError(
        err?.message || "Nu am putut încărca biblioteca de costuri."
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadItems();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterType, filterActive, debouncedSearch]);

  const groupedByType = useMemo(() => {
    if (filterType) {
      return [{ type: filterType, items }];
    }

    const groups = TYPE_OPTIONS.map((t) => ({
      type: t.value,
      items: items.filter((item) => item.type === t.value),
    }));

    return groups.filter((g) => g.items.length > 0);
  }, [items, filterType]);

  function openCreateForm() {
    setFormError("");
    setForm({ ...EMPTY_FORM });
  }

  function openEditForm(item) {
    setFormError("");
    setForm({
      id: item.id,
      type: item.type,
      name: item.name,
      unit: item.unit || "",
      unitCostLei: String(item.unitCost ?? 0),
      notes: item.notes || "",
    });
  }

  function closeForm() {
    if (saving) return;
    setForm(null);
    setFormError("");
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (!form) return;

    const name = form.name.trim();
    if (!name) {
      setFormError("Numele este obligatoriu.");
      return;
    }

    const unitCostCents = leiToCents(form.unitCostLei);
    if (unitCostCents === null) {
      setFormError(
        "Costul unitar trebuie să fie un număr valid, mai mare sau egal cu 0."
      );
      return;
    }

    try {
      setSaving(true);
      setFormError("");

      const payload = {
        type: form.type,
        name,
        unit: form.unit.trim(),
        unitCostCents,
        notes: form.notes.trim(),
      };

      if (form.id) {
        await updateCostItem(form.id, payload);
      } else {
        await createCostItem(payload);
      }

      setForm(null);
      await loadItems();
    } catch (err) {
      setFormError(
        err?.message || "Nu am putut salva costul."
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleArchive(item) {
    if (
      !window.confirm(
        `Arhivezi „${item.name}”? Nu va mai apărea în lista activă, dar rămâne păstrat.`
      )
    ) {
      return;
    }

    try {
      setBusyId(item.id);
      setRowError("");
      await archiveCostItem(item.id);
      await loadItems();
    } catch (err) {
      setRowError(
        err?.message || "Nu am putut arhiva costul."
      );
    } finally {
      setBusyId(null);
    }
  }

  async function handleRestore(item) {
    try {
      setBusyId(item.id);
      setRowError("");
      await restoreCostItem(item.id);
      await loadItems();
    } catch (err) {
      setRowError(
        err?.message || "Nu am putut restaura costul."
      );
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Biblioteca de costuri</h1>
          <p className={styles.subtitle}>
            Materialele, ambalajele și celelalte costuri pe care le
            folosești în produsele tale. Le poți reutiliza mai târziu
            când calculezi prețul unui produs.
          </p>
        </div>

        <button
          type="button"
          className={styles.btnPrimary}
          onClick={openCreateForm}
        >
          + Adaugă cost
        </button>
      </div>

      <div className={styles.filters}>
        <div className={styles.typeTabs}>
          <button
            type="button"
            className={
              !filterType ? styles.typeTabActive : styles.typeTab
            }
            onClick={() => setFilterType("")}
          >
            Toate
          </button>

          {TYPE_OPTIONS.map((t) => (
            <button
              key={t.value}
              type="button"
              className={
                filterType === t.value
                  ? styles.typeTabActive
                  : styles.typeTab
              }
              onClick={() => setFilterType(t.value)}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className={styles.filtersRight}>
          <input
            type="text"
            className={styles.searchInput}
            placeholder="Caută după nume..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />

          <select
            className={styles.select}
            value={filterActive}
            onChange={(e) => setFilterActive(e.target.value)}
          >
            <option value="true">Active</option>
            <option value="false">Arhivate</option>
            <option value="all">Toate</option>
          </select>
        </div>
      </div>

      {rowError ? (
        <div className={styles.errorBar}>{rowError}</div>
      ) : null}

      {loadError ? (
        <div className={styles.errorBar}>{loadError}</div>
      ) : null}

      {loading ? (
        <div className={styles.emptyState}>Se încarcă...</div>
      ) : items.length === 0 ? (
        <div className={styles.emptyState}>
          <p>Nu ai încă niciun cost salvat aici.</p>
          <button
            type="button"
            className={styles.btnPrimary}
            onClick={openCreateForm}
          >
            + Adaugă primul cost
          </button>
        </div>
      ) : (
        groupedByType.map((group) => (
          <div key={group.type} className={styles.groupBlock}>
            {!filterType ? (
              <h2 className={styles.groupTitle}>
                {TYPE_LABELS[group.type]}
              </h2>
            ) : null}

            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Nume</th>
                    <th>Unitate</th>
                    <th>Cost unitar</th>
                    <th>Notițe</th>
                    <th aria-label="Acțiuni" />
                  </tr>
                </thead>

                <tbody>
                  {group.items.map((item) => (
                    <tr
                      key={item.id}
                      className={
                        item.isActive ? "" : styles.rowArchived
                      }
                    >
                      <td>
                        {item.name}
                        {item.source === "AI_SUGGESTED" ? (
                          <span className={styles.aiPill}>
                            sugerat AI
                          </span>
                        ) : null}
                        {!item.isActive ? (
                          <span className={styles.archivedPill}>
                            arhivat
                          </span>
                        ) : null}
                      </td>

                      <td>{item.unit || "—"}</td>

                      <td>{formatMoney(item.unitCost)}</td>

                      <td className={styles.notesCell}>
                        {item.notes || "—"}
                      </td>

                      <td className={styles.actionsCell}>
                        <button
                          type="button"
                          className={styles.btnGhost}
                          onClick={() => openEditForm(item)}
                          disabled={busyId === item.id}
                        >
                          Editează
                        </button>

                        {item.isActive ? (
                          <button
                            type="button"
                            className={styles.btnDanger}
                            onClick={() => handleArchive(item)}
                            disabled={busyId === item.id}
                          >
                            {busyId === item.id
                              ? "..."
                              : "Arhivează"}
                          </button>
                        ) : (
                          <button
                            type="button"
                            className={styles.btnGhost}
                            onClick={() => handleRestore(item)}
                            disabled={busyId === item.id}
                          >
                            {busyId === item.id
                              ? "..."
                              : "Restaurează"}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))
      )}

      {form ? (
        <CostItemFormModal
          form={form}
          setForm={setForm}
          saving={saving}
          error={formError}
          onSubmit={handleSubmit}
          onClose={closeForm}
        />
      ) : null}
    </div>
  );
}

/* =========================================================
   Formular adăugare / editare
========================================================= */

function CostItemFormModal({
  form,
  setForm,
  saving,
  error,
  onSubmit,
  onClose,
}) {
  const isEdit = Boolean(form.id);

  function update(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div
        className={styles.modal}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.modalHeader}>
          <h2>{isEdit ? "Editează costul" : "Cost nou"}</h2>

          <button
            type="button"
            className={styles.iconBtn}
            onClick={onClose}
            aria-label="Închide"
          >
            ✕
          </button>
        </div>

        <form onSubmit={onSubmit} className={styles.form}>
          <label className={styles.field}>
            <span>Tip</span>
            <select
              value={form.type}
              onChange={(e) => update("type", e.target.value)}
            >
              {TYPE_OPTIONS.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>

          <label className={styles.field}>
            <span>Nume</span>
            <input
              type="text"
              value={form.name}
              onChange={(e) => update("name", e.target.value)}
              placeholder="Ex: Fir bumbac roz"
              maxLength={160}
              required
            />
          </label>

          <div className={styles.fieldRow}>
            <label className={styles.field}>
              <span>Unitate</span>
              <input
                type="text"
                value={form.unit}
                onChange={(e) => update("unit", e.target.value)}
                placeholder="buc, ml, g, m..."
                maxLength={40}
              />
            </label>

            <label className={styles.field}>
              <span>Cost unitar (lei)</span>
              <input
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                value={form.unitCostLei}
                onChange={(e) =>
                  update("unitCostLei", e.target.value)
                }
                placeholder="0.00"
                required
              />
            </label>
          </div>

          <label className={styles.field}>
            <span>Notițe (opțional)</span>
            <textarea
              value={form.notes}
              onChange={(e) => update("notes", e.target.value)}
              placeholder="Ex: cumpărat la cutii de 100 buc"
              maxLength={2000}
              rows={3}
            />
          </label>

          {error ? (
            <div className={styles.errorBar}>{error}</div>
          ) : null}

          <div className={styles.modalActions}>
            <button
              type="button"
              className={styles.btnGhost}
              onClick={onClose}
              disabled={saving}
            >
              Renunță
            </button>

            <button
              type="submit"
              className={styles.btnPrimary}
              disabled={saving}
            >
              {saving
                ? "Se salvează..."
                : isEdit
                ? "Salvează modificările"
                : "Adaugă costul"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
