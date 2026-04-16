import { useEffect, useMemo, useState } from "react";
import { api } from "../../../lib/api";
import styles from "./AdminMarketingPage.module.css";

export default function AdminNewsletterSubscribersTab() {
  const [items, setItems] = useState([]);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(25);
  const [total, setTotal] = useState(0);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [sourceFilter, setSourceFilter] = useState("");

  const [createEmail, setCreateEmail] = useState("");
  const [createSource, setCreateSource] = useState("ADMIN");
  const [createSourceLabel, setCreateSourceLabel] = useState("");
  const [createNotes, setCreateNotes] = useState("");
  const [creating, setCreating] = useState(false);

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(total / pageSize)),
    [total, pageSize]
  );

  async function loadSubscribers(nextPage = 1, nextQuery = query) {
    setLoading(true);
    setError("");

    try {
      const params = new URLSearchParams();
      params.set("page", String(nextPage));
      params.set("pageSize", String(pageSize));

      if (nextQuery?.trim()) {
        params.set("q", nextQuery.trim());
      }
      if (statusFilter) {
        params.set("status", statusFilter);
      }
      if (sourceFilter) {
        params.set("source", sourceFilter);
      }

      const res = await api(
        `/api/admin/marketing/newsletter-subscribers?${params.toString()}`
      );

      if (!res?.ok) {
        setError(res?.error || "Nu am putut încărca abonații newsletter.");
        setItems([]);
        setTotal(0);
        return;
      }

      setItems(res.items || []);
      setTotal(res.total || 0);
      setPage(res.page || 1);
    } catch (e) {
      setError(e?.message || "Nu am putut încărca abonații newsletter.");
      setItems([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadSubscribers(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, sourceFilter]);

  async function handleCreate(e) {
    e.preventDefault();
    setMessage("");
    setError("");

    if (!createEmail.trim()) {
      setError("Introdu o adresă de email.");
      return;
    }

    try {
      setCreating(true);

      const res = await api("/api/admin/marketing/newsletter-subscribers", {
        method: "POST",
        body: JSON.stringify({
          email: createEmail.trim().toLowerCase(),
          source: createSource,
          sourceLabel: createSourceLabel.trim() || undefined,
          notes: createNotes.trim() || undefined,
        }),
      });

      if (!res?.ok) {
        setError(res?.error || "Nu am putut adăuga abonatul.");
        return;
      }

      setMessage("Abonatul a fost salvat.");
      setCreateEmail("");
      setCreateSource("ADMIN");
      setCreateSourceLabel("");
      setCreateNotes("");

      await loadSubscribers(1);
    } catch (e) {
      setError(e?.message || "Eroare la salvarea abonatului.");
    } finally {
      setCreating(false);
    }
  }

  async function handleToggleStatus(item, nextStatus) {
    setMessage("");
    setError("");

    try {
      const res = await api(
        `/api/admin/marketing/newsletter-subscribers/${item.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            status: nextStatus,
            notes: item.notes || undefined,
          }),
        }
      );

      if (!res?.ok) {
        setError(res?.error || "Nu am putut actualiza statusul.");
        return;
      }

      setMessage(
        nextStatus === "SUBSCRIBED"
          ? `Emailul ${item.email} a fost abonat.`
          : `Emailul ${item.email} a fost dezabonat.`
      );

      await loadSubscribers(page);
    } catch (e) {
      setError(e?.message || "Eroare la actualizarea statusului.");
    }
  }

  return (
    <div className={styles.cardMuted}>
      <div className={styles.prefsHead}>
        <div>
          <h4>Abonați newsletter</h4>
          <p className={styles.subtle}>
            Vezi toate emailurile înscrise sau dezabonate, inclusiv cele fără
            cont.
          </p>
        </div>

        <div className={styles.prefsFilters}>
          <input
            type="search"
            placeholder="Caută după email…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                loadSubscribers(1, e.currentTarget.value);
              }
            }}
          />

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="">Toate statusurile</option>
            <option value="SUBSCRIBED">Abonați</option>
            <option value="UNSUBSCRIBED">Dezabonați</option>
          </select>

          <select
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value)}
          >
            <option value="">Toate sursele</option>
            <option value="FOOTER">FOOTER</option>
            <option value="ADMIN">ADMIN</option>
            <option value="IMPORT">IMPORT</option>
            <option value="CHECKOUT">CHECKOUT</option>
            <option value="CONTACT">CONTACT</option>
            <option value="OTHER">OTHER</option>
          </select>

          <button
            type="button"
            className={styles.prefsRefreshBtn}
            onClick={() => loadSubscribers(1)}
          >
            Reîncarcă
          </button>
        </div>
      </div>

      {error && <div className={styles.error}>{error}</div>}
      {message && <div className={styles.success}>{message}</div>}

      <form
        onSubmit={handleCreate}
        className={styles.marketingForm}
        style={{ marginBottom: 16 }}
      >
        <div className={styles.marketingFormHead}>
          <h3>Adaugă abonat manual</h3>
          <p className={styles.subtle}>
            Poți adăuga rapid un email în lista de newsletter.
          </p>
        </div>

        <div className={styles.formRow}>
          <label className={styles.field}>
            <span>Email</span>
            <input
              type="email"
              value={createEmail}
              onChange={(e) => setCreateEmail(e.target.value)}
              placeholder="ex: client@exemplu.ro"
            />
          </label>

          <label className={styles.field}>
            <span>Sursă</span>
            <select
              value={createSource}
              onChange={(e) => setCreateSource(e.target.value)}
            >
              <option value="ADMIN">ADMIN</option>
              <option value="FOOTER">FOOTER</option>
              <option value="IMPORT">IMPORT</option>
              <option value="CHECKOUT">CHECKOUT</option>
              <option value="CONTACT">CONTACT</option>
              <option value="OTHER">OTHER</option>
            </select>
          </label>
        </div>

        <div className={styles.formRow}>
          <label className={styles.field}>
            <span>Etichetă sursă (opțional)</span>
            <input
              type="text"
              value={createSourceLabel}
              onChange={(e) => setCreateSourceLabel(e.target.value)}
              placeholder="ex: import aprilie 2026"
            />
          </label>
        </div>

        <div className={styles.formRow}>
          <label className={styles.field}>
            <span>Note (opțional)</span>
            <textarea
              rows={3}
              value={createNotes}
              onChange={(e) => setCreateNotes(e.target.value)}
              placeholder="observații interne"
            />
          </label>
        </div>

        <div className={styles.formActions}>
          <button
            type="submit"
            className={styles.sendBtn}
            disabled={creating}
          >
            {creating ? "Se salvează…" : "Adaugă abonat"}
          </button>
        </div>
      </form>

      {loading ? (
        <div className={styles.subtle}>Se încarcă lista de abonați…</div>
      ) : items.length === 0 ? (
        <div className={styles.subtle}>Nu există rezultate.</div>
      ) : (
        <>
          <div className={styles.prefsTableWrap}>
            <table className={styles.prefsTable}>
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Status</th>
                  <th>Sursă</th>
                  <th>Cont</th>
                  <th>Rol</th>
                  <th>Abonat la</th>
                  <th>Dezabonat la</th>
                  <th>Ultimul send</th>
                  <th>Acțiuni</th>
                </tr>
              </thead>
              <tbody>
                {items.map((row) => (
                  <tr key={row.id}>
                    <td>{row.email}</td>
                    <td>
                      {row.status === "SUBSCRIBED" ? "✔ Abonat" : "— Dezabonat"}
                    </td>
                    <td>{row.sourceLabel || row.source || "—"}</td>
                    <td>{row.user ? "Da" : "Nu"}</td>
                    <td>{row.user?.role || "—"}</td>
                    <td>
                      {row.subscribedAt
                        ? new Date(row.subscribedAt).toLocaleString()
                        : "—"}
                    </td>
                    <td>
                      {row.unsubscribedAt
                        ? new Date(row.unsubscribedAt).toLocaleString()
                        : "—"}
                    </td>
                    <td>
                      {row.lastSentAt
                        ? new Date(row.lastSentAt).toLocaleString()
                        : "—"}
                    </td>
                    <td>
                      <div
                        style={{
                          display: "flex",
                          gap: 8,
                          flexWrap: "wrap",
                        }}
                      >
                        {row.status !== "SUBSCRIBED" ? (
                          <button
                            type="button"
                            className={styles.prefsRefreshBtn}
                            onClick={() =>
                              handleToggleStatus(row, "SUBSCRIBED")
                            }
                          >
                            Abonează
                          </button>
                        ) : (
                          <button
                            type="button"
                            className={styles.prefsRefreshBtn}
                            onClick={() =>
                              handleToggleStatus(row, "UNSUBSCRIBED")
                            }
                          >
                            Dezabonează
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className={styles.prefsPagination}>
            <span>
              Pagina {page} din {totalPages} (total {total} rânduri)
            </span>
            <div className={styles.prefsPaginationBtns}>
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => loadSubscribers(page - 1)}
              >
                &larr; Anterioară
              </button>
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => loadSubscribers(page + 1)}
              >
                Următoarea &rarr;
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}