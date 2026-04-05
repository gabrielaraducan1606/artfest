import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Archive, Check, Bell } from "lucide-react";
import { api } from "../../lib/api";
import styles from "./Navbar.module.css";

export default function NotificationsPopover({
  open,
  onClose,
  me,
  anchorRef,
  navigate,
  onChanged, // optional: () => window.dispatchEvent(...)
  fullPageHref = "/notificari",
  limit = 8,
}) {
  const panelRef = useRef(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [items, setItems] = useState([]);

  const baseUrl = useMemo(() => {
    if (!me) return null;
    return me.role === "VENDOR" ? "/api/vendor/notifications" : "/api/notifications";
  }, [me]);

  const load = useCallback(async () => {
    if (!me || !baseUrl) return;
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      params.set("scope", "all");
      params.set("limit", String(limit));
      const res = await api(`${baseUrl}?${params.toString()}`);
      setItems(res?.items || []);
    } catch (e) {
      setError(e?.message || "Nu am putut încărca notificările");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [me, baseUrl, limit]);

  const markRead = useCallback(
    async (id) => {
      if (!baseUrl) return;
      try {
        await api(`${baseUrl}/${id}/read`, { method: "PATCH" });
        setItems((prev) =>
          prev.map((n) =>
            n.id === id ? { ...n, readAt: n.readAt || new Date().toISOString() } : n
          )
        );
        onChanged?.();
      } catch {
        // ignore
      }
    },
    [baseUrl, onChanged]
  );

  const toggleArchive = useCallback(
    async (id, archived) => {
      if (!baseUrl) return;
      try {
        await api(`${baseUrl}/${id}/archive`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ archived: !archived }),
        });
        await load();
        onChanged?.();
      } catch {
        // ignore
      }
    },
    [baseUrl, load, onChanged]
  );

  // load când se deschide
  useEffect(() => {
    if (!open) return;
    load();
  }, [open, load]);

  // close on ESC + click outside
  useEffect(() => {
    if (!open) return;

    const onEsc = (e) => {
      if (e.key === "Escape") onClose?.();
    };

    const onDocDown = (e) => {
      const btn = anchorRef?.current;
      const panel = panelRef.current;
      if (btn?.contains(e.target)) return;
      if (panel?.contains(e.target)) return;
      onClose?.();
    };

    document.addEventListener("keydown", onEsc);
    document.addEventListener("mousedown", onDocDown);
    document.addEventListener("touchstart", onDocDown);

    return () => {
      document.removeEventListener("keydown", onEsc);
      document.removeEventListener("mousedown", onDocDown);
      document.removeEventListener("touchstart", onDocDown);
    };
  }, [open, onClose, anchorRef]);

  if (!open || !me) return null;

  // poziționare lângă buton
  const r = anchorRef?.current?.getBoundingClientRect?.();
  const width = Math.min(360, window.innerWidth - 24);
const top = (r?.bottom || 60) + 8;

let left = (r?.right ?? width) - width;   // aliniază la dreapta butonului
left = Math.max(12, Math.min(left, window.innerWidth - width - 12));

  const node = (
    <div
      ref={panelRef}
      className={styles.notifPanel}
      role="dialog"
      aria-label="Notificări"
      style={{
        position: "fixed",
        top,
        left,
        width,
        zIndex: 9999,
      }}
    >
      <div className={styles.notifHead}>
        <div className={styles.notifTitle}>
          <Bell size={16} />
          <span>Notificări</span>
        </div>

        <button
          type="button"
          className={styles.notifClose}
          aria-label="Închide"
          onClick={onClose}
        >
          ×
        </button>
      </div>

      <div className={styles.notifBody}>
        {loading && <div className={styles.notifInfo}>Se încarcă…</div>}
        {error && <div className={styles.notifError}>{error}</div>}

        {!loading && !error && items.length === 0 && (
          <div className={styles.notifInfo}>Nu ai notificări.</div>
        )}

        {!loading && !error && items.length > 0 && (
          <ul className={styles.notifList}>
            {items.map((n) => {
              const isUnread = !n.readAt && !n.archived;

              return (
                <li key={n.id} className={styles.notifItem}>
                  {/* rând clickabil - div (evităm button în button) */}
                  <div
                    className={`${styles.notifRow} ${isUnread ? styles.notifUnread : ""}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => {
                      if (isUnread) markRead(n.id);
                      if (n.link) {
                        onClose?.();
                        navigate?.(n.link);
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        if (isUnread) markRead(n.id);
                        if (n.link) {
                          onClose?.();
                          navigate?.(n.link);
                        }
                      }
                    }}
                  >
                    <div className={styles.notifRowTop}>
                      <div className={styles.notifRowTitle}>{n.title}</div>
                    </div>

                    {n.body ? <div className={styles.notifRowText}>{n.body}</div> : null}

                    <div className={styles.notifRowActions}>
                      {isUnread && (
                        <button
                          type="button"
                          className={styles.notifActionBtn}
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
                        className={styles.notifActionBtn}
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
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className={styles.notifFooter}>
        <button
          type="button"
          className={styles.notifFullBtn}
          onClick={() => {
            onClose?.();
            navigate?.(fullPageHref);
          }}
        >
          Vezi pagina întreagă
        </button>
      </div>
    </div>
  );

  return createPortal(node, document.body);
}
