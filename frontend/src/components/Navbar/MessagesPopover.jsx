// src/components/Navbar/MessagesPopover.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MessageSquare, X, ArrowRight, Clock } from "lucide-react";
import { api } from "../../lib/api";
import styles from "./Navbar.module.css";

/*
 * ETAPA 3 (refactor comun Mesaje) - codul mort a fost eliminat aici.
 *
 * Ce s-a șters și de ce era sigur:
 *  - `sheetOpen`/`activeThread` erau setate NUMAI cu `false`/`null` în tot
 *    fișierul (confirmat din nou, la fel ca în auditul ETAPA 1) - sheet-ul
 *    de mini-chat (`ChatInner`) nu se deschidea niciodată.
 *  - `openThread()` naviga mereu spre pagina completă, nu seta niciodată
 *    `sheetOpen`/`activeThread`.
 *  - Tot ce exista DOAR pentru sheet-ul mort a dispărut cu el: `ChatInner`,
 *    cache-ul de mesaje (`MSG_CACHE`/`fetchMsgsCached`/`getCached`/
 *    `setCached`/`INFLIGHT`), `prefetchThread` (prefetch de mesaje pentru
 *    un sheet care nu se deschidea), `handleSend`/`text`/`sending` locale
 *    din popover, `chatPos`, `isMobile`.
 *  - Ce a rămas: lista de thread-uri (preview: nume/ultimul mesaj/unread/
 *    oră) și `openThread()` care navighează spre pagina completă - acesta
 *    e singurul comportament live al popover-ului.
 *
 * De ce lista de thread-uri NU folosește useMessageThreads (hook-ul comun
 * din features/messages): aici fetch-ul e declanșat de `open` (nu de
 * polling continuu) și combină DOUĂ surse (customer + vendor) într-o
 * singură listă pentru rolul VENDOR - formă diferită de nevoia paginilor
 * User/Vendor. Forțarea în același hook ar fi cerut încă un mod special
 * doar pentru acest caz, deci a rămas separat, așa cum era.
 *
 * MessageBubble/MessageAttachment nu apar aici: popover-ul nu randează
 * niciodată un mesaj individual sau un attachment - singurul loc care o
 * făcea era sheet-ul mort, acum șters.
 */

function useClickOutside(open, popoverRef, anchorRef, onClose) {
  useEffect(() => {
    if (!open) return;

    const handler = (e) => {
      const p = popoverRef.current;
      const a = anchorRef?.current;

      const inPopover = p && p.contains(e.target);
      const inAnchor = a && a.contains(e.target);

      if (!inPopover && !inAnchor) onClose?.();
    };

    document.addEventListener("mousedown", handler);
    document.addEventListener("touchstart", handler);

    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("touchstart", handler);
    };
  }, [open, popoverRef, anchorRef, onClose]);
}

function formatTime(ts) {
  try {
    const d = new Date(ts);
    return d.toLocaleDateString("ro-RO", {
      day: "2-digit",
      month: "2-digit",
    });
  } catch {
    return "";
  }
}

function pickRealThreadId(item) {
  if (item && Array.isArray(item.threads) && item.threads.length) {
    const nonArchived = item.threads.find((t) => !t.archived);
    return nonArchived?.threadId || item.threads[0]?.threadId || null;
  }

  return item?.threadId || item?.id || null;
}

export default function MessagesPopover({
  open,
  onClose,
  me,
  anchorRef,
  navigate,
  fullPageHref,
  limit = 8,
}) {
  const popRef = useRef(null);

  const [loadingThreads, setLoadingThreads] = useState(false);
  const [threads, setThreads] = useState([]);

  const isVendor = me?.role === "VENDOR";

  const API = useMemo(() => {
    const listThreads = isVendor
      ? "/api/inbox/threads?scope=all&groupBy=order"
      : "/api/user-inbox/threads?scope=all&groupBy=store";

    const listVendorThreads = "/api/inbox/vendor-threads?scope=all";

    const fullPage = fullPageHref || (isVendor ? "/mesaje" : "/cont/mesaje");

    return {
      listThreads,
      listVendorThreads,
      fullPage,
    };
  }, [isVendor, fullPageHref]);

  useClickOutside(open, popRef, anchorRef, () => {
    onClose?.();
  });

  const pos = useMemo(() => {
    const a = anchorRef?.current;
    if (!open || !a) return null;

    const r = a.getBoundingClientRect();
    const top = r.bottom + 10;
    const left = Math.min(
      Math.max(8, r.right - 360),
      window.innerWidth - 8 - 360
    );

    return { top, left };
  }, [open, anchorRef]);

  useEffect(() => {
    if (!open || !me) return;

    let alive = true;

    (async () => {
      try {
        setLoadingThreads(true);

        let items = [];

        if (isVendor) {
          const [customerData, vendorData] = await Promise.all([
            api(API.listThreads).catch(() => ({ items: [] })),
            api(API.listVendorThreads).catch(() => ({ items: [] })),
          ]);

          const customerItems = (customerData?.items || []).map((t) => ({
            ...t,
            _kind: "customer",
          }));

          const vendorItems = (vendorData?.items || []).map((t) => ({
            ...t,
            _kind: "vendor",
          }));

          items = [...vendorItems, ...customerItems];
        } else {
          const data = await api(API.listThreads).catch(() => ({ items: [] }));

          items = (data?.items || []).map((t) => ({
            ...t,
            _kind: "customer",
          }));
        }

        items.sort(
          (a, b) => new Date(b.lastAt || 0) - new Date(a.lastAt || 0)
        );

        if (limit && items.length > limit) {
          items = items.slice(0, limit);
        }

        if (alive) setThreads(items);
      } catch {
        if (alive) setThreads([]);
      } finally {
        if (alive) setLoadingThreads(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [
    open,
    me,
    isVendor,
    API.listThreads,
    API.listVendorThreads,
    limit,
  ]);

  function openThread(item) {
    const threadId = pickRealThreadId(item);
    if (!threadId) return;

    onClose?.();

    if (isVendor && item?._kind === "vendor") {
      navigate(`${API.fullPage}?vendorThreadId=${encodeURIComponent(threadId)}`);
      return;
    }

    navigate(`${API.fullPage}?threadId=${encodeURIComponent(threadId)}`);
  }

  if (!open || !pos) return null;

  const popover = (
    <div
      ref={popRef}
      className={styles.notifPop}
      style={{
        position: "fixed",
        top: pos.top,
        left: pos.left,
        width: 360,
        zIndex: 9999,
      }}
      role="dialog"
      aria-label="Mesaje"
    >
      <div className={styles.notifHead}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <MessageSquare size={18} />
          <b>Mesaje</b>
        </div>

        <button
          type="button"
          className={styles.notifClose}
          onClick={() => onClose?.()}
          aria-label="Închide"
        >
          <X size={18} />
        </button>
      </div>

      <div className={styles.notifBody}>
        {loadingThreads ? (
          <div className={styles.notifEmpty}>Se încarcă…</div>
        ) : threads.length === 0 ? (
          <div className={styles.notifEmpty}>Nu ai conversații încă.</div>
        ) : (
          <div className={styles.notifList}>
            {threads.map((t) => {
              const title = t.name || "Conversație";
              const preview = t.lastMsg || "—";
              const unread = Number(t.unreadCount || 0);
              const when = t.lastAt;

              return (
                <button
                  key={`${t._kind || "customer"}-${t.id || t.threadId}`}
                  type="button"
                  className={styles.notifItem}
                  onClick={() => openThread(t)}
                  style={{ textAlign: "left" }}
                >
                  <div style={{ display: "flex", gap: 10 }}>
                    <div
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: 12,
                        background: "var(--color-card)",
                        border: "1px solid var(--color-border)",
                        display: "grid",
                        placeItems: "center",
                        flex: "0 0 auto",
                      }}
                      aria-hidden="true"
                    >
                      <MessageSquare size={16} />
                    </div>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          justifyContent: "space-between",
                        }}
                      >
                        <div
                          style={{
                            fontWeight: 700,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                            color: "var(--color-text)",
                          }}
                        >
                          {title}
                          {t._kind === "vendor" && (
                            <span
                              style={{
                                marginLeft: 6,
                                fontSize: 11,
                                color: "var(--color-text-muted)",
                              }}
                            >
                              · vendor
                            </span>
                          )}
                        </div>

                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                          }}
                        >
                          {when && (
                            <span
                              style={{
                                fontSize: 12,
                                color: "var(--color-text-muted)",
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 4,
                              }}
                            >
                              <Clock size={12} />
                              {formatTime(when)}
                            </span>
                          )}

                          {unread > 0 && (
                            <span className={styles.badge}>
                              {Math.min(unread, 99)}
                            </span>
                          )}
                        </div>
                      </div>

                      <div
                        style={{
                          fontSize: 13,
                          color: "var(--color-text-muted)",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          marginTop: 2,
                        }}
                      >
                        {preview}
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className={styles.notifFooter}>
        <button
          type="button"
          className={styles.notifAllBtn}
          onClick={() => {
            onClose?.();
            navigate(API.fullPage);
          }}
        >
          Vezi toate mesajele <ArrowRight size={16} />
        </button>
      </div>
    </div>
  );

  return createPortal(popover, document.body);
}
