import { useEffect, useMemo, useState } from "react";
import { api } from "../../../lib/api";
import styles from "./AdminMarketingPage.module.css";

export default function AdminDigitalWaitlistTab() {
  const [items, setItems] = useState([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const pageSize = 50;

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(total / pageSize)),
    [total, pageSize]
  );

  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all"); // all | new | contacted | unsubscribed
  const [loading, setLoading] = useState(false);
  const [tableErr, setTableErr] = useState("");

  // compose + send
  const [subject, setSubject] = useState(
    "Servicii digitale ArtFest — în curând ✨"
  );
  const [bodyHtml, setBodyHtml] = useState(
    `<h2>Servicii digitale ArtFest — în curând ✨</h2>
<p>Lucrăm la instrumente care îți fac organizarea mai ușoară:</p>
<ul>
  <li>Invitație online tip mini-site + RSVP</li>
  <li>Așezarea la mese + căutare rapidă</li>
  <li>QR pentru găsirea mesei (1 click)</li>
  <li>Album QR pentru poze după eveniment</li>
</ul>
<p>Revenim foarte curând cu lansarea!</p>
<p><a href="https://artfest.ro/servicii-digitale">Vezi pagina</a></p>`
  );

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

      const d = await api(`/api/admin/digital-waitlist?${params.toString()}`);

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

  async function onSend(e) {
    e.preventDefault();
    setMsg("");
    setErr("");

    if (!subject.trim()) return setErr("Completează subiectul.");
    if (!bodyHtml.trim()) return setErr("Completează conținutul (HTML).");
    if (testMode && !testEmail.trim())
      return setErr("Completează adresa de test.");

    try {
      setSending(true);

      const payload = {
        subject: subject.trim(),
        bodyHtml,
        onlyNew,
        testEmail: testMode ? testEmail.trim() : undefined,
      };

      const res = await api("/api/admin/digital-waitlist/send", {
        method: "POST",
        body: JSON.stringify(payload),
      });

      if (res?.ok) {
        setMsg(
          testMode
            ? "Emailul de test a fost trimis."
            : `Email trimis către ${res.sentCount ?? 0} destinatari.`
        );
        if (!testMode) load(page);
      } else {
        setErr(res?.error || "Nu am putut trimite emailul.");
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
          <h4>Waitlist — Servicii digitale</h4>
          <p className={styles.subtle}>
            Emailuri înscrise pe pagina “Servicii digitale”. Poți trimite un email către listă.
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
            <option value="new">Doar new</option>
            <option value="contacted">Doar contacted</option>
            <option value="unsubscribed">Doar unsubscribed</option>
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

      {/* Compose + send */}
      <form onSubmit={onSend} className={styles.marketingForm} style={{ marginTop: 10 }}>
        {err && <div className={styles.error}>{err}</div>}
        {msg && <div className={styles.success}>{msg}</div>}

        <div className={styles.formRow}>
          <label className={styles.field}>
            <span>Subiect</span>
            <input type="text" value={subject} onChange={(e) => setSubject(e.target.value)} />
          </label>
        </div>

        <div className={styles.formRow}>
          <label className={styles.field}>
            <span>Conținut (HTML)</span>
            <textarea rows={10} value={bodyHtml} onChange={(e) => setBodyHtml(e.target.value)} />
          </label>
        </div>

        <div className={styles.formRow}>
          <label className={styles.checkboxRow}>
            <input type="checkbox" checked={onlyNew} onChange={(e) => setOnlyNew(e.target.checked)} />
            <span>Trimite doar către cei cu status = <b>new</b></span>
          </label>
        </div>

        <div className={styles.formRow}>
          <label className={styles.checkboxRow}>
            <input type="checkbox" checked={testMode} onChange={(e) => setTestMode(e.target.checked)} />
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
                  </tr>
                </thead>
                <tbody>
                  {items.map((r) => (
                    <tr key={r.id}>
                      <td>{r.email}</td>
                      <td>{r.status}</td>
                      <td>{r.source || "—"}</td>
                      <td>{r.createdAt ? new Date(r.createdAt).toLocaleString() : "—"}</td>
                      <td>{r.contactedAt ? new Date(r.contactedAt).toLocaleString() : "—"}</td>
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
                <button type="button" disabled={page <= 1} onClick={() => load(page - 1)}>
                  &larr; Anterioară
                </button>
                <button type="button" disabled={page >= totalPages} onClick={() => load(page + 1)}>
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
