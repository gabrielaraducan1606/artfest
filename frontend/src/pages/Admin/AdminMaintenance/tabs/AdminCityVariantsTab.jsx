// src/admin/maintenance/tabs/AdminCityVariantsTab.jsx
import { useCallback, useEffect, useState } from "react";
import { api } from "../../../../lib/api.js";
import styles from "../AdminMaintenancePage.module.css";

export default function AdminCityVariantsTab() {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [groups, setGroups] = useState([]);

  const [editingSlug, setEditingSlug] = useState(null);
  const [editingValue, setEditingValue] = useState("");
  const [savingSlug, setSavingSlug] = useState(null);

  // ======== load() cu useCallback ca să fie stabil în deps ========
  const load = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      const d = await api("/api/admin/cities/variants");
      setGroups(d.groups || []);
    } catch (e) {
      const msg =
        e?.response?.data?.error ||
        e?.message ||
        "Nu am putut încărca lista variantelor de orașe.";
      setErr(msg);
      setGroups([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // ======== start edit pentru un slug ========
  const startEdit = (group) => {
    const initial =
      group.adminLabel ||
      group.canonicalLabel ||
      group.slug ||
      "";
    setEditingSlug(group.slug);
    setEditingValue(initial);
  };

  const cancelEdit = () => {
    setEditingSlug(null);
    setEditingValue("");
  };

  // ======== salvare etichetă canonică ========
  const saveLabel = async (slug) => {
    const value = (editingValue || "").trim();
    if (!value) {
      setErr("Te rog completează eticheta pentru oraș.");
      return;
    }

    setSavingSlug(slug);
    setErr("");

    try {
      await api(`/api/admin/cities/${slug}/label`, {
        method: "PUT",
        body: { label: value }, // IMPORTANT: api() trebuie să trimită JSON din body
      });

      // după salvare, resetăm editarea și reîncărcăm lista
      setEditingSlug(null);
      setEditingValue("");
      await load();
    } catch (e) {
      const msg =
        e?.response?.data?.error ||
        e?.message ||
        "Nu am putut salva eticheta orașului.";
      setErr(msg);
    } finally {
      setSavingSlug(null);
    }
  };

  return (
    <div className={styles.tabBody}>
      <p className={styles.subtle}>
        Aici vezi toate orașele introduse de vendori, grupate după formă
        normalizată (slug). Exemplu: <code>Bacau</code>, <code>Bacău</code>,
        <code>bacău</code> → <strong>slug: bacau</strong>.
      </p>

      <div className={styles.actionsRow}>
        <button
          type="button"
          className={styles.btnGhost}
          onClick={load}
          disabled={loading}
        >
          {loading ? "Se reîncarcă…" : "Reîncarcă"}
        </button>
      </div>

      {err && <div className={styles.errorBox}>{err}</div>}

      {loading && !err && (
        <div className={styles.loading}>Se încarcă lista de orașe…</div>
      )}

      {!loading && !err && groups.length === 0 && (
        <p className={styles.subtle}>
          Nu există încă date de orașe. Probabil nu ai magazine active sau
          nimeni nu a completat orașul în profil.
        </p>
      )}

      {!loading && !err && groups.length > 0 && (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Oraș (canonic)</th>
                <th>Slug</th>
                <th>Număr apariții</th>
                <th>Variante introduse</th>
                <th>Acțiuni</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => {
                const isEditing = editingSlug === g.slug;

                return (
                  <tr key={g.slug}>
                    <td>
                      {isEditing ? (
                        <input
                          type="text"
                          className={styles.input}
                          value={editingValue}
                          onChange={(e) => setEditingValue(e.target.value)}
                          disabled={savingSlug === g.slug}
                        />
                      ) : (
                        <strong>{g.canonicalLabel}</strong>
                      )}
                      {g.adminLabel && !isEditing && (
                        <div className={styles.subtle}>
                          (ales de admin: {g.adminLabel})
                        </div>
                      )}
                    </td>
                    <td>
                      <code>{g.slug}</code>
                    </td>
                    <td>{g.totalCount}</td>
                    <td>
                      <ul className={styles.variantList}>
                        {g.variants.map((v) => (
                          <li key={v.label}>
                            <span>{v.label}</span>{" "}
                            <span className={styles.subtle}>
                              ({v.count}x)
                            </span>
                          </li>
                        ))}
                      </ul>
                    </td>
                    <td>
                      {!isEditing && (
                        <button
                          type="button"
                          className={styles.btnSecondary}
                          onClick={() => startEdit(g)}
                        >
                          Editează eticheta
                        </button>
                      )}

                      {isEditing && (
                        <div className={styles.inlineActions}>
                          <button
                            type="button"
                            className={styles.btnPrimary}
                            onClick={() => saveLabel(g.slug)}
                            disabled={savingSlug === g.slug}
                          >
                            {savingSlug === g.slug
                              ? "Se salvează…"
                              : "Salvează"}
                          </button>
                          <button
                            type="button"
                            className={styles.btnGhost}
                            onClick={cancelEdit}
                            disabled={savingSlug === g.slug}
                          >
                            Anulează
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className={styles.subtle} style={{ marginTop: 16 }}>
        💡 Eticheta aleasă aici este salvată în <code>CityDictionary</code> și
        poate fi folosită în endpoint-urile publice (de ex.{" "}
        <code>/api/public/stores/cities</code>) pentru a afișa clienților un singur
        nume de oraș curat, indiferent ce au completat vendori la început.
      </p>
    </div>
  );
}
