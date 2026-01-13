import { useCallback, useEffect, useState } from "react";
import {
  Bell,
  RefreshCcw,
  Archive,
  Check,
  Search as SearchIcon,
} from "lucide-react";
import { api } from "../../../lib/api";
import styles from "./UserNotificationPage.module.css";

const TABS = [
  { id: "all", label: "Toate" },
  { id: "unread", label: "Necitite" },
  { id: "archived", label: "Arhivate" },
];

const PAGE_SIZE = 20;

function fmt(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  return d.toLocaleString("ro-RO", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function UserNotificationsPage() {
  const [scope, setScope] = useState("all");
  const [q, setQ] = useState("");
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [markingAll, setMarkingAll] = useState(false);

  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const notifyNavbar = useCallback(() => {
    try {
      window.dispatchEvent(new Event("notifications:changed"));
    } catch {
      /* ignore */
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    setVisibleCount(PAGE_SIZE);

    try {
      const params = new URLSearchParams();
      params.set("scope", scope);
      if (q.trim()) params.set("q", q.trim());

      const res = await api(`/api/notifications?${params.toString()}`);
      setItems(res?.items || []);
    } catch (e) {
      setError(e?.message || "Eroare la încărcarea notificărilor");
    } finally {
      setLoading(false);
    }
  }, [scope, q]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!items.length) return;

    function onScroll() {
      const scrollPos = window.innerHeight + window.scrollY;
      const threshold = document.body.offsetHeight - 300;

      if (scrollPos >= threshold && !loading && visibleCount < items.length) {
        setVisibleCount((prev) => Math.min(prev + PAGE_SIZE, items.length));
      }
    }

    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, [items.length, loading, visibleCount]);

  const visibleItems = items.slice(0, visibleCount);
  const unreadCount = items.filter((n) => !n.readAt && !n.archived).length;

  const markRead = async (id) => {
    try {
      await api(`/api/notifications/${id}/read`, { method: "PATCH" });
      setItems((prev) =>
        prev.map((n) =>
          n.id === id ? { ...n, readAt: n.readAt || new Date().toISOString() } : n
        )
      );
      notifyNavbar();
    } catch (e) {
      console.error(e);
    }
  };

  const toggleArchive = async (id, archived) => {
    try {
      await api(`/api/notifications/${id}/archive`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived: !archived }),
      });

      await load();
      notifyNavbar();
    } catch (e) {
      console.error(e);
    }
  };

  const markAllRead = async () => {
    setMarkingAll(true);
    try {
      await api("/api/notifications/read-all", { method: "PATCH" });
      setItems((prev) =>
        prev.map((n) => ({ ...n, readAt: n.readAt || new Date().toISOString() }))
      );
      notifyNavbar();
    } catch (e) {
      console.error(e);
    } finally {
      setMarkingAll(false);
    }
  };

  return (
    <div className={styles.wrap}>
      {/* ===== Header ===== */}
      <header className={styles.head}>
        <div className={styles.title}>
          <Bell size={20} />
          <span>Notificările mele</span>
        </div>

        <div className={styles.actions}>
          <button
            type="button"
            className={styles.primary}
            onClick={markAllRead}
            disabled={markingAll || loading || !items.length}
          >
            <Check size={14} />
            {markingAll ? "Se marchează…" : "Marchează tot ca citit"}
          </button>

          <button type="button" className={styles.iconBtn} onClick={load} title="Reîncarcă">
            <RefreshCcw size={16} className={loading ? styles.spin : ""} />
          </button>
        </div>
      </header>

      {/* ===== Toolbar ===== */}
      <section className={styles.toolbar}>
        <div className={styles.tabs}>
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`${styles.tab} ${scope === tab.id ? styles.active : ""}`}
              onClick={() => setScope(tab.id)}
            >
              {tab.label}
              {tab.id === "unread" && unreadCount > 0 && (
                <span className={styles.badge}>{Math.min(unreadCount, 99)}</span>
              )}
            </button>
          ))}
        </div>

        <div className={styles.search}>
          <SearchIcon size={14} />
          <input
            type="search"
            placeholder="Caută după titlu sau conținut…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && load()}
          />
          <button type="button" className={styles.iconBtn} onClick={load} title="Caută">
            <SearchIcon size={14} />
          </button>
        </div>
      </section>

      {/* ===== Info / error / loading ===== */}
      {error && <div className={styles.error}>{error}</div>}
      {loading && !items.length && <div className={styles.info}>Se încarcă notificările…</div>}
      {!loading && !items.length && !error && (
        <div className={styles.info}>Nu ai notificări în această secțiune.</div>
      )}

      {/* ===== Listă ===== */}
      {visibleItems.length > 0 && (
        <ul className={styles.list}>
          {visibleItems.map((n) => {
            const isUnread = !n.readAt;

            return (
              <li key={n.id} className={`${styles.item} ${isUnread ? styles.unread : ""}`}>
                <div className={styles.icon}>
                  <Bell size={16} />
                </div>

                {/* corp notificare */}
                <button
                  type="button"
                  className={styles.body}
                  onClick={() => {
                    if (isUnread) markRead(n.id);
                    if (n.link) window.location.href = n.link;
                  }}
                >
                  <div className={styles.row}>
                    <div className={styles.itemTitle}>{n.title}</div>
                    <div className={styles.time}>{fmt(n.createdAt)}</div>
                  </div>

                  {n.body && <div className={styles.itemText}>{n.body}</div>}

                  {/* MOBILE footer: Vezi detalii + butoane pe aceeași linie */}
                  <div className={styles.footerRow}>
                    {n.link ? <div className={styles.link}>Vezi detalii</div> : <span />}

                    <div className={styles.actionsInline}>
                      {isUnread && (
                        <button
                          type="button"
                          className={styles.ghostBtn}
                          title="Marchează citit"
                          onClick={(e) => {
                            e.stopPropagation();
                            markRead(n.id);
                          }}
                        >
                          <Check size={14} />
                        </button>
                      )}

                      <button
                        type="button"
                        className={styles.ghostBtn}
                        title={n.archived ? "Dezarhivează" : "Arhivează"}
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleArchive(n.id, n.archived);
                        }}
                      >
                        <Archive size={14} />
                      </button>
                    </div>
                  </div>
                </button>

                {/* DESKTOP actions (coloana din dreapta) */}
                <div className={styles.rowActions}>
                  {isUnread && (
                    <button
                      type="button"
                      className={styles.ghostBtn}
                      title="Marchează citit"
                      onClick={() => markRead(n.id)}
                    >
                      <Check size={14} />
                    </button>
                  )}
                  <button
                    type="button"
                    className={styles.ghostBtn}
                    title={n.archived ? "Dezarhivează" : "Arhivează"}
                    onClick={() => toggleArchive(n.id, n.archived)}
                  >
                    <Archive size={14} />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {!loading && visibleCount < items.length && (
        <div className={styles.info}>Derulează în jos pentru a încărca mai multe notificări…</div>
      )}
    </div>
  );
}
