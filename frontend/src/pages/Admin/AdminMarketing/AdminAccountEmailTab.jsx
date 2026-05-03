import { useEffect, useMemo, useState } from "react";
import { api } from "../../../lib/api";
import styles from "./AdminMarketingPage.module.css";

export default function AdminAccountEmailTab() {
  const [items, setItems] = useState([]);
  const [selectedIds, setSelectedIds] = useState([]);

  const [page, setPage] = useState(1);
  const [pageSize] = useState(25);
  const [total, setTotal] = useState(0);

  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState("ALL");
  const [setupFilter, setSetupFilter] = useState("");

  const [minProducts, setMinProducts] = useState("");
  const [maxProducts, setMaxProducts] = useState("");
  const [minStores, setMinStores] = useState("");
  const [maxStores, setMaxStores] = useState("");
  const [minActiveStores, setMinActiveStores] = useState("");
  const [maxActiveStores, setMaxActiveStores] = useState("");
  const [minOrders, setMinOrders] = useState("");
  const [maxOrders, setMaxOrders] = useState("");

  const [subject, setSubject] = useState(
    "Finalizează configurarea contului tău Artfest"
  );

  const [preheader, setPreheader] = useState(
    "Intră în cont și continuă configurarea."
  );

  const [bodyHtml, setBodyHtml] = useState(`<h2>Salut, {{name}} 👋</h2>
<p>Contul tău Artfest este activ.</p>
<p>Intră în platformă și continuă configurarea pentru a profita de toate funcționalitățile disponibile.</p>

<p style="margin-top:16px;">
  <a href="https://artfest.ro/login" style="display:inline-block;padding:10px 16px;background:#111;color:#fff;text-decoration:none;border-radius:8px;">
    Intră în cont
  </a>
</p>

<p style="font-size:12px;color:#777;margin-top:22px;">
  Dacă nu mai vrei să primești astfel de emailuri, te poți
  <a href="{{unsubscribeUrl}}">dezabona aici</a>.
</p>`);

  const [testMode, setTestMode] = useState(true);
  const [testEmail, setTestEmail] = useState("");

  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(total / pageSize)),
    [total, pageSize]
  );

  const allVisibleSelected =
    items.length > 0 && items.every((row) => selectedIds.includes(row.id));

  function addNumberParam(params, key, value) {
    if (value === "" || value === null || value === undefined) return;

    const n = Number(value);

    if (Number.isFinite(n)) {
      params.set(key, String(n));
    }
  }

  async function loadAccounts(nextPage = 1, nextQuery = query) {
    setLoading(true);
    setError("");

    try {
      const params = new URLSearchParams();
      params.set("page", String(nextPage));
      params.set("pageSize", String(pageSize));
      params.set("role", roleFilter);

      if (nextQuery?.trim()) params.set("q", nextQuery.trim());
      if (setupFilter) params.set("setup", setupFilter);

      addNumberParam(params, "minProducts", minProducts);
      addNumberParam(params, "maxProducts", maxProducts);
      addNumberParam(params, "minStores", minStores);
      addNumberParam(params, "maxStores", maxStores);
      addNumberParam(params, "minActiveStores", minActiveStores);
      addNumberParam(params, "maxActiveStores", maxActiveStores);
      addNumberParam(params, "minOrders", minOrders);
      addNumberParam(params, "maxOrders", maxOrders);

      const res = await api(
        `/api/admin/marketing/account-targets?${params.toString()}`
      );

      if (!res?.ok) {
        setError(res?.error || "Nu am putut încărca lista de conturi.");
        setItems([]);
        setTotal(0);
        return;
      }

      setItems(res.items || []);
      setTotal(res.total || 0);
      setPage(res.page || 1);
    } catch (e) {
      setError(e?.message || "Nu am putut încărca lista de conturi.");
      setItems([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setSelectedIds([]);
    loadAccounts(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roleFilter, setupFilter]);

  function toggleOne(id) {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  function toggleVisible() {
    if (allVisibleSelected) {
      setSelectedIds((prev) =>
        prev.filter((id) => !items.some((row) => row.id === id))
      );
    } else {
      setSelectedIds((prev) =>
        Array.from(new Set([...prev, ...items.map((row) => row.id)]))
      );
    }
  }

  async function handleSend(e) {
    e.preventDefault();

    setError("");
    setMessage("");

    if (!subject.trim()) return setError("Completează subiectul.");
    if (!bodyHtml.trim()) return setError("Completează conținutul HTML.");

    if (testMode && !testEmail.trim()) {
      return setError("Completează adresa de test.");
    }

    if (!testMode && selectedIds.length === 0) {
      return setError("Selectează cel puțin un cont.");
    }

    try {
      setSending(true);

      const payload = testMode
        ? {
            subject: subject.trim(),
            preheader: preheader.trim() || undefined,
            bodyHtml,
            testEmail: testEmail.trim(),
          }
        : {
            subject: subject.trim(),
            preheader: preheader.trim() || undefined,
            bodyHtml,
            userIds: selectedIds,
          };

      const res = await api("/api/admin/marketing/account-send", {
        method: "POST",
        body: JSON.stringify(payload),
      });

      if (!res?.ok) {
        setError(res?.error || "Nu am putut trimite emailurile.");
        return;
      }

      setMessage(
        testMode
          ? "Emailul de test a fost trimis."
          : `Email trimis către ${res.sentCount ?? 0} conturi.`
      );
    } catch (e) {
      setError(e?.message || "Eroare la trimiterea emailurilor.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className={styles.cardMuted}>
      <div className={styles.prefsHead}>
        <div>
          <h4>Email către conturi</h4>
          <p className={styles.subtle}>
            Trimite emailuri către useri sau vendori care au cont Artfest,
            indiferent dacă sunt sau nu abonați la newsletter.
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
                loadAccounts(1, e.currentTarget.value);
              }
            }}
          />

          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
          >
            <option value="ALL">Toate conturile</option>
            <option value="USER">Doar useri / clienți</option>
            <option value="VENDOR">Doar vendori</option>
          </select>

          <select
            value={setupFilter}
            onChange={(e) => setSetupFilter(e.target.value)}
          >
            <option value="">Toate configurările</option>
            <option value="incomplete">Configurare incompletă</option>
            <option value="complete">Configurare completă</option>
          </select>

          <button
            type="button"
            className={styles.prefsRefreshBtn}
            onClick={() => loadAccounts(1)}
          >
            Reîncarcă
          </button>
        </div>
      </div>

      {error && <div className={styles.error}>{error}</div>}
      {message && <div className={styles.success}>{message}</div>}

      <form
        onSubmit={handleSend}
        className={styles.marketingForm}
        style={{ marginBottom: 16 }}
      >
        <div className={styles.marketingFormHead}>
          <h3>Trimite email</h3>
          <p className={styles.subtle}>
            Variabile disponibile: <code>{"{{name}}"}</code>,{" "}
            <code>{"{{unsubscribeUrl}}"}</code>.
          </p>
        </div>

        <div className={styles.formRow}>
          <label className={styles.field}>
            <span>Subiect</span>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
            />
          </label>
        </div>

        <div className={styles.formRow}>
          <label className={styles.field}>
            <span>Preheader opțional</span>
            <input
              type="text"
              value={preheader}
              onChange={(e) => setPreheader(e.target.value)}
              placeholder="Text scurt care apare în inbox"
            />
          </label>
        </div>

        <div className={styles.formRow}>
          <label className={styles.field}>
            <span>Conținut HTML</span>
            <textarea
              rows={10}
              value={bodyHtml}
              onChange={(e) => setBodyHtml(e.target.value)}
            />
          </label>
        </div>

        <div className={styles.formRow}>
          <label className={styles.checkboxRow}>
            <input
              type="checkbox"
              checked={testMode}
              onChange={(e) => setTestMode(e.target.checked)}
            />
            <span>Trimite doar email de test</span>
          </label>

          {testMode && (
            <label className={styles.field}>
              <span>Adresă test</span>
              <input
                type="email"
                placeholder="ex: tu@artfest.ro"
                value={testEmail}
                onChange={(e) => setTestEmail(e.target.value)}
              />
            </label>
          )}
        </div>

        {!testMode && (
          <p className={styles.subtle}>
            Conturi selectate: {selectedIds.length}
          </p>
        )}

        <div className={styles.formActions}>
          <button type="submit" className={styles.sendBtn} disabled={sending}>
            {sending
              ? "Se trimite…"
              : testMode
              ? "Trimite email de test"
              : "Trimite către conturile selectate"}
          </button>
        </div>
      </form>

      <div className={styles.marketingForm} style={{ marginBottom: 16 }}>
        <div className={styles.marketingFormHead}>
          <h3>Filtre avansate</h3>
          <p className={styles.subtle}>
            Pentru useri contează comenzile. Pentru vendori contează magazinele,
            produsele și configurarea magazinului.
          </p>
        </div>

        <div className={styles.formRow}>
          <label className={styles.field}>
            <span>Min produse</span>
            <input
              type="number"
              min="0"
              value={minProducts}
              onChange={(e) => setMinProducts(e.target.value)}
            />
          </label>

          <label className={styles.field}>
            <span>Max produse</span>
            <input
              type="number"
              min="0"
              value={maxProducts}
              onChange={(e) => setMaxProducts(e.target.value)}
            />
          </label>

          <label className={styles.field}>
            <span>Min magazine</span>
            <input
              type="number"
              min="0"
              value={minStores}
              onChange={(e) => setMinStores(e.target.value)}
            />
          </label>

          <label className={styles.field}>
            <span>Max magazine</span>
            <input
              type="number"
              min="0"
              value={maxStores}
              onChange={(e) => setMaxStores(e.target.value)}
            />
          </label>
        </div>

        <div className={styles.formRow}>
          <label className={styles.field}>
            <span>Min magazine active</span>
            <input
              type="number"
              min="0"
              value={minActiveStores}
              onChange={(e) => setMinActiveStores(e.target.value)}
            />
          </label>

          <label className={styles.field}>
            <span>Max magazine active</span>
            <input
              type="number"
              min="0"
              value={maxActiveStores}
              onChange={(e) => setMaxActiveStores(e.target.value)}
            />
          </label>

          <label className={styles.field}>
            <span>Min comenzi</span>
            <input
              type="number"
              min="0"
              value={minOrders}
              onChange={(e) => setMinOrders(e.target.value)}
            />
          </label>

          <label className={styles.field}>
            <span>Max comenzi</span>
            <input
              type="number"
              min="0"
              value={maxOrders}
              onChange={(e) => setMaxOrders(e.target.value)}
            />
          </label>
        </div>

        <div className={styles.formActions}>
          <button
            type="button"
            className={styles.sendBtn}
            disabled={loading}
            onClick={() => loadAccounts(1)}
          >
            {loading ? "Se filtrează…" : "Aplică filtre"}
          </button>
        </div>
      </div>

      {loading ? (
        <div className={styles.subtle}>Se încarcă lista de conturi…</div>
      ) : items.length === 0 ? (
        <div className={styles.subtle}>Nu există rezultate.</div>
      ) : (
        <>
          <div className={styles.prefsTableWrap}>
            <table className={styles.prefsTable}>
              <thead>
                <tr>
                  <th>
                    <input
                      type="checkbox"
                      checked={allVisibleSelected}
                      onChange={toggleVisible}
                    />
                  </th>
                  <th>Email</th>
                  <th>Rol</th>
                  <th>Nume</th>
                  <th>Vendor</th>
                  <th>Magazine</th>
                  <th>Active</th>
                  <th>Produse</th>
                  <th>Aprobate</th>
                  <th>Comenzi</th>
                  <th>Configurare</th>
                  <th>Lipsește</th>
                  <th>Opt-in</th>
                  <th>Newsletter</th>
                  <th>Creat la</th>
                </tr>
              </thead>

              <tbody>
                {items.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(row.id)}
                        onChange={() => toggleOne(row.id)}
                      />
                    </td>

                    <td>{row.email}</td>
                    <td>{row.role}</td>
                    <td>{row.name || "—"}</td>
                    <td>{row.vendorDisplayName || "—"}</td>
                    <td>{row.storesCount}</td>
                    <td>{row.activeStoresCount}</td>
                    <td>{row.productsCount}</td>
                    <td>{row.approvedProductsCount}</td>
                    <td>{row.ordersCount}</td>
                    <td>
                      {row.role === "VENDOR"
                        ? row.setupCompleted
                          ? "✔ Completă"
                          : "— Incompletă"
                        : "—"}
                    </td>
                    <td>
                      {row.setupMissing && row.setupMissing.length
                        ? row.setupMissing.join(", ")
                        : "—"}
                    </td>
                    <td>{row.marketingOptIn ? "✔" : "—"}</td>
                    <td>{row.newsletterStatus || "—"}</td>
                    <td>
                      {row.createdAt
                        ? new Date(row.createdAt).toLocaleString()
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className={styles.prefsPagination}>
            <span>
              Pagina {page} din {totalPages} total {total} rânduri
            </span>

            <div className={styles.prefsPaginationBtns}>
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => loadAccounts(page - 1)}
              >
                &larr; Anterioară
              </button>

              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => loadAccounts(page + 1)}
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