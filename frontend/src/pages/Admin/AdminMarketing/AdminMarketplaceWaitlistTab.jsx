import { useEffect, useMemo, useState } from "react";
import { api } from "../../../lib/api";
import styles from "./AdminMarketingPage.module.css";

/**
 * Admin tab: Marketplace Waitlist (separat de "Servicii digitale")
 * Endpoints:
 *  - GET    /api/admin/marketplace-waitlist?status=NEW&search=gmail&page=1&limit=50
 *  - PATCH  /api/admin/marketplace-waitlist/:id   body: { status?, notes? }
 *  - (opt)  POST   /api/admin/marketplace-waitlist/test  body: { to, subject, bodyHtml, preheader?, senderKey? }
 *  - (opt)  POST   /api/admin/marketplace-waitlist/send  body: { subject, bodyHtml, preheader?, onlyNew?, senderKey? }
 */
export default function AdminMarketplaceWaitlistTab() {
  // table
  const [items, setItems] = useState([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const pageSize = 50;

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(total / pageSize)),
    [total, pageSize]
  );

  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all"); // all | NEW | CONTACTED | CONVERTED | SPAM
  const [loading, setLoading] = useState(false);
  const [tableErr, setTableErr] = useState("");

  // compose + send (optional)
  const [subject, setSubject] = useState("Artfest — în curând ✨");
  const [bodyHtml, setBodyHtml] = useState(
    `<h2>Artfest — în curând ✨</h2>
<p>Mulțumim că te-ai înscris pe lista de așteptare.</p>
<p>Lucrăm la marketplace-ul pentru artizanii de evenimente și revenim cu acces cât de curând.</p>
<p style="margin-top:14px;">— Echipa Artfest</p>`
  );
  const [preheader, setPreheader] = useState("Ai fost adăugat(ă) pe lista de așteptare.");
  const [onlyNew, setOnlyNew] = useState(true);

  const [testMode, setTestMode] = useState(true);
  const [testEmail, setTestEmail] = useState("");

  const [sending, setSending] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  async function load(p = 1) {
    setLoading(true);
    setTableErr("");

    try {
      const params = new URLSearchParams();
      params.set("page", String(p));
      params.set("limit", String(pageSize));

      if (q.trim()) params.set("search", q.trim());
      if (status !== "all") params.set("status", status);

      const d = await api(`/api/admin/marketplace-waitlist?${params.toString()}`);

      if (!d?.ok) {
        setTableErr(d?.error || "Nu am putut încărca lista.");
        setItems([]);
        setTotal(0);
        setPage(1);
        return;
      }

      setItems(d.items || []);
      setTotal(d.total || 0);
      setPage(d.page || p);
    } catch (e) {
      setTableErr(e?.message || "Nu am putut încărca lista.");
      setItems([]);
      setTotal(0);
      setPage(1);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Optional: update status / notes (basic inline action)
  async function updateRow(id, patch) {
    try {
      const res = await api(`/api/admin/marketplace-waitlist/${id}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      if (!res?.ok) throw new Error(res?.error || "Nu am putut salva.");

      // optimistic refresh in-place
      setItems((prev) =>
        prev.map((it) => (it.id === id ? { ...it, ...res.item } : it))
      );
    } catch (e) {
      alert(e?.message || "Eroare la salvare.");
    }
  }

  async function onSend(e) {
    e.preventDefault();
    setMsg("");
    setErr("");

    if (!subject.trim()) return setErr("Completează subiectul.");
    if (!bodyHtml.trim()) return setErr("Completează conținutul (HTML).");
    if (testMode && !testEmail.trim()) return setErr("Completează adresa de test.");

    try {
      setSending(true);

      if (testMode) {
        const payload = {
          to: testEmail.trim(),
          subject: subject.trim(),
          bodyHtml,
          preheader: preheader?.trim() || undefined,
        };

        const res = await api("/api/admin/marketplace-waitlist/test", {
          method: "POST",
          body: JSON.stringify(payload),
        });

        if (res?.ok) {
          setMsg("Emailul de test a fost trimis.");
        } else {
          setErr(res?.error || "Nu am putut trimite emailul de test.");
        }
        return;
      }

      const payload = {
        subject: subject.trim(),
        bodyHtml,
        preheader: preheader?.trim() || undefined,
        onlyNew,
      };

      const res = await api("/api/admin/marketplace-waitlist/send", {
        method: "POST",
        body: JSON.stringify(payload),
      });

      if (res?.ok) {
        setMsg(`Email trimis către ${res.sentCount ?? 0} destinatari.`);
        load(page);
      } else {
        setErr(res?.error || "Nu am putut trimite emailul către listă.");
      }
    } catch (e2) {
      setErr(e2?.message || "Eroare la trimiterea emailului.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className={styles.cardMuted}>
      <div className={styles.prefsHead}>
        <div>
          <h4>Waitlist — Marketplace</h4>
          <p className={styles.subtle}>
            Emailuri înscrise pe pagina “Artfest – În curând” (marketplace).
          </p>
        </div>

        <div className={styles.prefsFilters}>
          <input
            type="search"
            placeholder="Caută după email / source…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                load(1);
              }
            }}
          />

          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            style={{ minWidth: 170 }}
          >
            <option value="all">Toate statusurile</option>
            <option value="NEW">Doar NEW</option>
            <option value="CONTACTED">Doar CONTACTED</option>
            <option value="CONVERTED">Doar CONVERTED</option>
            <option value="SPAM">Doar SPAM</option>
          </select>

          <button
            type="button"
            onClick={() => load(1)}
            className={styles.prefsRefreshBtn}
          >
            Caută
          </button>

          <button
            type="button"
            onClick={() => load(page)}
            className={styles.prefsRefreshBtn}
          >
            Reîncarcă
          </button>
        </div>
      </div>

      {/* Compose + send (optional) */}
      <form
        onSubmit={onSend}
        className={styles.marketingForm}
        style={{ marginTop: 10 }}
      >
        {err && <div className={styles.error}>{err}</div>}
        {msg && <div className={styles.success}>{msg}</div>}

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
            <span>Preheader (opțional)</span>
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
            <span>Conținut (HTML)</span>
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
              checked={onlyNew}
              onChange={(e) => setOnlyNew(e.target.checked)}
              disabled={testMode}
            />
            <span>
              Trimite doar către cei cu status = <b>NEW</b>
            </span>
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

        <div className={styles.formActions}>
          <button type="submit" className={styles.sendBtn} disabled={sending}>
            {sending
              ? testMode
                ? "Se trimite test…"
                : "Se trimite către listă…"
              : testMode
              ? "Trimite email de test"
              : "Trimite email către listă"}
          </button>
        </div>
      </form>

      {/* Table */}
      <div style={{ marginTop: 14 }}>
        {tableErr && <div className={styles.error}>{tableErr}</div>}

        {loading ? (
          <div className={styles.subtle}>Se încarcă lista…</div>
        ) : items.length === 0 ? (
          <div className={styles.subtle}>Nu există înregistrări.</div>
        ) : (
          <>
            <div className={styles.prefsTableWrap}>
              <table className={styles.prefsTable}>
                <thead>
                  <tr>
                    <th>Email</th>
                    <th>Status</th>
                    <th>Source</th>
                    <th>Creat</th>
                    <th>Contactat</th>
                    <th style={{ width: 200 }}>Acțiuni</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((r) => (
                    <tr key={r.id}>
                      <td>{r.email}</td>
                      <td>{r.status}</td>
                      <td>{r.source || "—"}</td>
                      <td>
                        {r.createdAt ? new Date(r.createdAt).toLocaleString() : "—"}
                      </td>
                      <td>
                        {r.contactedAt ? new Date(r.contactedAt).toLocaleString() : "—"}
                      </td>
                      <td>
                        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                          <select
                            value={r.status}
                            onChange={(e) =>
                              updateRow(r.id, { status: e.target.value })
                            }
                          >
                            <option value="NEW">NEW</option>
                            <option value="CONTACTED">CONTACTED</option>
                            <option value="CONVERTED">CONVERTED</option>
                            <option value="SPAM">SPAM</option>
                          </select>

                          <button
                            type="button"
                            className={styles.prefsRefreshBtn}
                            onClick={() => {
                              const notes = prompt("Note (opțional):", r.notes || "");
                              if (notes !== null) updateRow(r.id, { notes });
                            }}
                          >
                            Note
                          </button>
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
                  onClick={() => load(page - 1)}
                >
                  &larr; Anterioară
                </button>
                <button
                  type="button"
                  disabled={page >= totalPages}
                  onClick={() => load(page + 1)}
                >
                  Următoarea &rarr;
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
