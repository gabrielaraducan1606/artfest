import { useEffect, useMemo, useState } from "react";
import { api } from "../../../lib/api";
import styles from "./AdminMarketingPage.module.css";
import AdminDigitalWaitlistTab from "./AdminDigitalWaitListTab";
import AdminMarketplaceWaitlistTab from "./AdminMarketplaceWaitlistTab";
import AdminNewsletterSubscribersTab from "./AdminNewsletterTab";
import AdminAccountEmailTab from "./AdminAccountEmailTab";
import AdminAmbassadorsTab from "./AdminAmbassadorsTab";

function cx(...xs) {
  return xs.filter(Boolean).join(" ");
}

export default function AdminMarketingTab() {
  const [stats, setStats] = useState({
    subscribersTotal: 0,
    subscribersUsers: 0,
    subscribersVendors: 0,
    unsubscribedTotal: 0,
  });

  const [tab, setTab] = useState("campaign");

  const [prefs, setPrefs] = useState([]);
  const [prefsPage, setPrefsPage] = useState(1);
  const [prefsTotal, setPrefsTotal] = useState(0);
  const [prefsPageSize] = useState(25);
  const [prefsLoading, setPrefsLoading] = useState(false);
  const [prefsError, setPrefsError] = useState("");
  const [prefsQuery, setPrefsQuery] = useState("");

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(prefsTotal / prefsPageSize)),
    [prefsTotal, prefsPageSize]
  );

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
          unsubscribedTotal: d.unsubscribedTotal ?? 0,
        });
      } catch {
        // nu blocăm UI
      }
    })();

    return () => {
      alive = false;
    };
  }, []);

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

  useEffect(() => {
    if (tab === "prefs") {
      loadPrefs(1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  return (
    <div className={styles.page}>
      <div className={styles.marketingRoot}>
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

          <div className={styles.marketingStatItem}>
            <span className={styles.marketingStatLabel}>Dezabonați</span>
            <span className={styles.marketingStatVal}>
              {stats.unsubscribedTotal}
            </span>
          </div>
        </div>

        <div className={styles.tabsRow}>
          <button
            type="button"
            className={cx(
              styles.tabBtn,
              tab === "campaign" && styles.tabBtnActive
            )}
            onClick={() => setTab("campaign")}
          >
            Email conturi
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
              tab === "newsletter" && styles.tabBtnActive
            )}
            onClick={() => setTab("newsletter")}
          >
            Abonați newsletter
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

          <button
            type="button"
            className={cx(
              styles.tabBtn,
              tab === "marketplaceWaitlist" && styles.tabBtnActive
            )}
            onClick={() => setTab("marketplaceWaitlist")}
          >
            Waitlist marketplace
          </button>
          <button
  type="button"
  className={cx(
    styles.tabBtn,
    tab === "ambassadors" && styles.tabBtnActive
  )}
  onClick={() => setTab("ambassadors")}
>
  Ambasadori
</button>
        </div>

        {tab === "campaign" && <AdminAccountEmailTab />}

        {tab === "newsletter" && <AdminNewsletterSubscribersTab />}

        {tab === "digitalWaitlist" && <AdminDigitalWaitlistTab />}

        {tab === "marketplaceWaitlist" && <AdminMarketplaceWaitlistTab />}

{tab === "ambassadors" && <AdminAmbassadorsTab />}

        {tab === "prefs" && (
          <div className={styles.cardMuted}>
            <div className={styles.prefsHead}>
              <div>
                <h4>Preferințe marketing utilizatori</h4>
                <p className={styles.subtle}>
                  Vizualizează cine este abonat, ce sursă și ce topicuri a ales
                  din <code>UserMarketingPrefs</code>.
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
                      loadPrefs(1, e.currentTarget.value);
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
                    Pagina {prefsPage} din {totalPages} total {prefsTotal}{" "}
                    rânduri
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