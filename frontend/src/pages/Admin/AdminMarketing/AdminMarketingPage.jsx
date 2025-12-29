import { useEffect, useMemo, useState } from "react";
import { api } from "../../../lib/api";
import styles from "./AdminMarketingPage.module.css";
import AdminDigitalWaitlistTab from "./AdminDigitalWaitListTab";

function cx(...xs) {
  return xs.filter(Boolean).join(" ");
}

export default function AdminMarketingTab() {
  const [stats, setStats] = useState({
    subscribersTotal: 0,
    subscribersUsers: 0,
    subscribersVendors: 0,
  });

  // campanie manuală
  const [subject, setSubject] = useState("");
  const [preheader, setPreheader] = useState("");
  const [bodyHtml, setBodyHtml] = useState("");
  const [audience, setAudience] = useState("ALL"); // ALL | USERS | VENDORS
  const [testMode, setTestMode] = useState(false);
  const [testEmail, setTestEmail] = useState("");

  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  // 🔹 Tab intern: "campaign" | "prefs" | "digitalWaitlist"
  const [tab, setTab] = useState("campaign");

  // 🔹 stare pentru tabelul cu preferințe
  const [prefs, setPrefs] = useState([]);
  const [prefsPage, setPrefsPage] = useState(1);
  const [prefsTotal, setPrefsTotal] = useState(0);
  const [prefsPageSize] = useState(25);
  const [prefsLoading, setPrefsLoading] = useState(false);
  const [prefsError, setPrefsError] = useState("");
  const [prefsQuery, setPrefsQuery] = useState(""); // search după email

  // ============ DIGEST: Followed stores ============
  const [digestDays, setDigestDays] = useState(7);
  const [digestMaxPerStore, setDigestMaxPerStore] = useState(4);
  const [digestMaxStores, setDigestMaxStores] = useState(6);

  const [digestSubject, setDigestSubject] = useState(
    "Noutăți de la magazinele urmărite"
  );
  const [digestPreheader, setDigestPreheader] = useState("");
  const [digestTestMode, setDigestTestMode] = useState(true);
  const [digestTestEmail, setDigestTestEmail] = useState("");

  const [digestSending, setDigestSending] = useState(false);
  const [digestMsg, setDigestMsg] = useState("");
  const [digestErr, setDigestErr] = useState("");

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(prefsTotal / prefsPageSize)),
    [prefsTotal, prefsPageSize]
  );

  // citește statistici despre abonați (o singură dată)
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const d = await api("/api/admin/marketing/stats").catch(() => null);
        if (!alive || !d) return;
        setStats({
          subscribersTotal: d.subscribersTotal ?? 0,
          subscribersUsers: d.subscribersUsers ?? 0,
          subscribersVendors: d.subscribersVendors ?? 0,
        });
      } catch {
        // nu blocăm UI
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // funcție pentru încărcat preferințele
  async function loadPrefs(page = 1, q = prefsQuery) {
    setPrefsLoading(true);
    setPrefsError("");
    try {
      const params = new URLSearchParams();
      params.set("page", String(page));
      params.set("pageSize", String(prefsPageSize));
      if (q && q.trim()) {
        params.set("q", q.trim());
      }

      const d = await api(`/api/admin/marketing/prefs?${params.toString()}`);
      if (!d?.ok) {
        setPrefsError(
          d?.error || "Nu am putut încărca preferințele de marketing."
        );
        setPrefs([]);
        setPrefsTotal(0);
        return;
      }

      setPrefs(d.items || []);
      setPrefsTotal(d.total || 0);
      setPrefsPage(d.page || 1);
    } catch (e) {
      setPrefsError(
        e?.message || "Nu am putut încărca preferințele de marketing."
      );
      setPrefs([]);
      setPrefsTotal(0);
    } finally {
      setPrefsLoading(false);
    }
  }

  // încarcă preferințele DOAR când intri pe tab-ul "prefs"
  useEffect(() => {
    if (tab === "prefs") {
      loadPrefs(1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  // ========= campanie manuală =========
  async function handleSend(e) {
    e.preventDefault();
    setMessage("");
    setError("");

    if (!subject.trim()) {
      setError("Completează subiectul.");
      return;
    }
    if (!bodyHtml.trim()) {
      setError("Completează conținutul campaniei.");
      return;
    }
    if (testMode && !testEmail.trim()) {
      setError("Introdu o adresă de test.");
      return;
    }

    try {
      setSending(true);

      const payload = {
        subject: subject.trim(),
        preheader: preheader.trim() || undefined,
        bodyHtml,
        audience,
        testEmail: testMode ? testEmail.trim() : undefined,
      };

      const res = await api("/api/admin/marketing/send", {
        method: "POST",
        body: JSON.stringify(payload),
      });

      if (res?.ok) {
        setMessage(
          testMode
            ? "Emailul de test a fost trimis."
            : `Campania a fost lansată către ${res.sentCount ?? "abonati"} abonați.`
        );
      } else {
        setError(
          res?.error ||
            "Nu am putut trimite campania. Verifică serverul sau log-urile."
        );
      }
    } catch (e) {
      setError(e?.message || "Eroare la trimiterea campaniei.");
    } finally {
      setSending(false);
    }
  }

  // ========= digest followed stores =========
  async function handleSendDigest(e) {
    e.preventDefault();
    setDigestMsg("");
    setDigestErr("");

    if (!digestSubject.trim()) {
      setDigestErr("Completează subiectul digest-ului.");
      return;
    }
    if (digestTestMode && !digestTestEmail.trim()) {
      setDigestErr("Introdu o adresă de test pentru digest.");
      return;
    }

    try {
      setDigestSending(true);

      const payload = {
        subject: digestSubject.trim(),
        preheader: digestPreheader.trim() || undefined,
        days: Number(digestDays) || 7,
        maxPerStore: Number(digestMaxPerStore) || 4,
        maxStores: Number(digestMaxStores) || 6,
        testEmail: digestTestMode ? digestTestEmail.trim() : undefined,
      };

      const res = await api("/api/admin/marketing/send-followed-stores-digest", {
        method: "POST",
        body: JSON.stringify(payload),
      });

      if (res?.ok) {
        setDigestMsg(
          digestTestMode
            ? "Digest-ul de test a fost trimis."
            : `Digest-ul a fost trimis către ${res.sentCount ?? 0} destinatari (doar cei cu noutăți).`
        );
      } else {
        setDigestErr(res?.error || "Nu am putut trimite digest-ul.");
      }
    } catch (e) {
      setDigestErr(e?.message || "Eroare la trimiterea digest-ului.");
    } finally {
      setDigestSending(false);
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.marketingRoot}>
        {/* Statistici abonați – rămân sus, comune pentru toate tab-urile */}
        <div className={styles.marketingStats}>
          <div className={styles.marketingStatItem}>
            <span className={styles.marketingStatLabel}>Abonați total</span>
            <span className={styles.marketingStatVal}>
              {stats.subscribersTotal}
            </span>
          </div>
          <div className={styles.marketingStatItem}>
            <span className={styles.marketingStatLabel}>Useri (clienți)</span>
            <span className={styles.marketingStatVal}>
              {stats.subscribersUsers}
            </span>
          </div>
          <div className={styles.marketingStatItem}>
            <span className={styles.marketingStatLabel}>Vendori</span>
            <span className={styles.marketingStatVal}>
              {stats.subscribersVendors}
            </span>
          </div>
        </div>

        {/* 🔹 TAB-URI INTERNE */}
        <div className={styles.tabsRow}>
          <button
            type="button"
            className={cx(
              styles.tabBtn,
              tab === "campaign" && styles.tabBtnActive
            )}
            onClick={() => setTab("campaign")}
          >
            Campanii email
          </button>

          <button
            type="button"
            className={cx(styles.tabBtn, tab === "prefs" && styles.tabBtnActive)}
            onClick={() => setTab("prefs")}
          >
            Preferințe utilizatori
          </button>

          <button
            type="button"
            className={cx(
              styles.tabBtn,
              tab === "digitalWaitlist" && styles.tabBtnActive
            )}
            onClick={() => setTab("digitalWaitlist")}
          >
            Waitlist servicii digitale
          </button>
        </div>

        {/* TAB: Waitlist servicii digitale */}
        {tab === "digitalWaitlist" && <AdminDigitalWaitlistTab />}

        {/* TAB: Campanii email */}
        {tab === "campaign" && (
          <>
            {/* ======= CARD: Digest followed stores ======= */}
            <div className={styles.cardMuted} style={{ marginBottom: 16 }}>
              <h4>Digest: Produse noi de la magazinele urmărite</h4>
              <p className={styles.subtle}>
                Trimite automat emailuri personalizate. Fiecare user primește doar
                noutățile din ultimele X zile de la magazinele pe care le urmărește.
                Dacă nu are noutăți, nu primește email.
              </p>

              {digestErr && <div className={styles.error}>{digestErr}</div>}
              {digestMsg && <div className={styles.success}>{digestMsg}</div>}

              <form onSubmit={handleSendDigest}>
                <div className={styles.formRow}>
                  <label className={styles.field}>
                    <span>Subiect</span>
                    <input
                      type="text"
                      value={digestSubject}
                      onChange={(e) => setDigestSubject(e.target.value)}
                    />
                  </label>
                </div>

                <div className={styles.formRow}>
                  <label className={styles.field}>
                    <span>Preheader (opțional)</span>
                    <input
                      type="text"
                      value={digestPreheader}
                      onChange={(e) => setDigestPreheader(e.target.value)}
                    />
                  </label>
                </div>

                <div className={styles.formRow}>
                  <label className={styles.field}>
                    <span>Zile (ex: 7)</span>
                    <input
                      type="number"
                      min="1"
                      max="60"
                      value={digestDays}
                      onChange={(e) => setDigestDays(e.target.value)}
                    />
                  </label>

                  <label className={styles.field}>
                    <span>Max produse / magazin</span>
                    <input
                      type="number"
                      min="1"
                      max="20"
                      value={digestMaxPerStore}
                      onChange={(e) => setDigestMaxPerStore(e.target.value)}
                    />
                  </label>

                  <label className={styles.field}>
                    <span>Max magazine</span>
                    <input
                      type="number"
                      min="1"
                      max="50"
                      value={digestMaxStores}
                      onChange={(e) => setDigestMaxStores(e.target.value)}
                    />
                  </label>
                </div>

                <div className={styles.formRow}>
                  <label className={styles.checkboxRow}>
                    <input
                      type="checkbox"
                      checked={digestTestMode}
                      onChange={(e) => setDigestTestMode(e.target.checked)}
                    />
                    <span>Trimite doar email de test</span>
                  </label>

                  {digestTestMode && (
                    <label className={styles.field}>
                      <span>Adresă test</span>
                      <input
                        type="email"
                        placeholder="ex: tu@artfest.ro"
                        value={digestTestEmail}
                        onChange={(e) => setDigestTestEmail(e.target.value)}
                      />
                    </label>
                  )}
                </div>

                <div className={styles.formActions}>
                  <button
                    type="submit"
                    className={styles.sendBtn}
                    disabled={digestSending}
                  >
                    {digestSending
                      ? digestTestMode
                        ? "Se trimite digest-ul de test…"
                        : "Se trimite digest-ul…"
                      : digestTestMode
                      ? "Trimite digest de test"
                      : "Trimite digest către abonați"}
                  </button>
                </div>
              </form>
            </div>

            {/* ======= Form: campanie manuală ======= */}
            <form className={styles.marketingForm} onSubmit={handleSend}>
              <div className={styles.marketingFormHead}>
                <h3>Campanie rapidă email</h3>
                <p className={styles.subtle}>
                  Trimite un email către utilizatorii care au acceptat marketing-ul
                  (marketingOptIn = true). Ai grijă să incluzi link de dezabonare.
                </p>
              </div>

              {error && <div className={styles.error}>{error}</div>}
              {message && <div className={styles.success}>{message}</div>}

              <div className={styles.formRow}>
                <label className={styles.field}>
                  <span>Public țintă</span>
                  <select
                    value={audience}
                    onChange={(e) => setAudience(e.target.value)}
                  >
                    <option value="ALL">Toți abonații</option>
                    <option value="USERS">Doar useri (clienți)</option>
                    <option value="VENDORS">Doar vendori</option>
                  </select>
                </label>
              </div>

              <div className={styles.formRow}>
                <label className={styles.field}>
                  <span>Subiect email</span>
                  <input
                    type="text"
                    placeholder="Ex: Noutăți handmade de primăvară"
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
                    placeholder="Text scurt afișat lângă subiect în inbox"
                    value={preheader}
                    onChange={(e) => setPreheader(e.target.value)}
                  />
                </label>
              </div>

              <div className={styles.formRow}>
                <label className={styles.field}>
                  <span>Conținut (HTML sau text simplu)</span>
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

              <div className={styles.formActions}>
                <button
                  type="submit"
                  className={styles.sendBtn}
                  disabled={sending}
                >
                  {sending
                    ? testMode
                      ? "Se trimite emailul de test…"
                      : "Se lansează campania…"
                    : testMode
                    ? "Trimite email de test"
                    : "Trimite campania"}
                </button>
              </div>
            </form>

            <div className={styles.cardMuted}>
              <h4>Istoric campanii (de implementat ulterior)</h4>
              <p className={styles.subtle}>
                Aici poți lista campaniile salvate în DB (subiect, dată, audiență,
                număr destinatari, etc.).
              </p>
            </div>
          </>
        )}

        {/* TAB: Preferințe utilizatori */}
        {tab === "prefs" && (
          <div className={styles.cardMuted}>
            <div className={styles.prefsHead}>
              <div>
                <h4>Preferințe marketing utilizatori</h4>
                <p className={styles.subtle}>
                  Vizualizează cine este abonat, ce sursă și ce topicuri a ales
                  (din <code>UserMarketingPrefs</code>).
                </p>
              </div>
              <div className={styles.prefsFilters}>
                <input
                  type="search"
                  placeholder="Caută după email…"
                  value={prefsQuery}
                  onChange={(e) => setPrefsQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      loadPrefs(1, e.target.value);
                    }
                  }}
                />
                <button
                  type="button"
                  onClick={() => loadPrefs(1)}
                  className={styles.prefsRefreshBtn}
                >
                  Reîncarcă
                </button>
              </div>
            </div>

            {prefsError && (
              <div className={styles.error} style={{ marginBottom: 8 }}>
                {prefsError}
              </div>
            )}

            {prefsLoading ? (
              <div className={styles.subtle}>Se încarcă preferințele…</div>
            ) : prefs.length === 0 ? (
              <div className={styles.subtle}>
                Nu am găsit preferințe de marketing.
              </div>
            ) : (
              <>
                <div className={styles.prefsTableWrap}>
                  <table className={styles.prefsTable}>
                    <thead>
                      <tr>
                        <th>Email</th>
                        <th>Rol</th>
                        <th>Opt-in</th>
                        <th>Source</th>
                        <th>Topics</th>
                        <th>Canale</th>
                        <th>Ultima actualizare</th>
                      </tr>
                    </thead>
                    <tbody>
                      {prefs.map((row) => (
                        <tr key={row.id}>
                          <td>{row.email}</td>
                          <td>{row.role}</td>
                          <td>{row.marketingOptIn ? "✔" : "–"}</td>
                          <td>{row.sourcePreference}</td>
                          <td>
                            {row.topics && row.topics.length
                              ? row.topics.join(", ")
                              : "—"}
                          </td>
                          <td>
                            {[
                              row.emailEnabled ? "Email" : null,
                              row.smsEnabled ? "SMS" : null,
                              row.pushEnabled ? "Push" : null,
                            ]
                              .filter(Boolean)
                              .join(", ") || "—"}
                          </td>
                          <td>
                            {row.updatedAt
                              ? new Date(row.updatedAt).toLocaleString()
                              : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className={styles.prefsPagination}>
                  <span>
                    Pagina {prefsPage} din {totalPages} (total {prefsTotal} rânduri)
                  </span>
                  <div className={styles.prefsPaginationBtns}>
                    <button
                      type="button"
                      disabled={prefsPage <= 1}
                      onClick={() => loadPrefs(prefsPage - 1)}
                    >
                      &larr; Anterioară
                    </button>
                    <button
                      type="button"
                      disabled={prefsPage >= totalPages}
                      onClick={() => loadPrefs(prefsPage + 1)}
                    >
                      Următoarea &rarr;
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
