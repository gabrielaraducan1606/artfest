// src/components/Navbar/MessagesPopover.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MessageSquare, X, ArrowRight, Clock, Send } from "lucide-react";
import { api } from "../../lib/api";
import styles from "./Navbar.module.css";

/** =========================
 *  In-memory cache (module scope)
 *  ========================= */
const MSG_CACHE = new Map(); // threadId -> { items, ts }
const INFLIGHT = new Map(); // threadId -> Promise
const CACHE_TTL_MS = 30_000;

function getCached(threadId) {
  const hit = MSG_CACHE.get(threadId);
  if (!hit) return null;
  if (Date.now() - hit.ts > CACHE_TTL_MS) return hit.items; // stale ok
  return hit.items;
}

function setCached(threadId, items) {
  MSG_CACHE.set(threadId, { items: Array.isArray(items) ? items : [], ts: Date.now() });
}

async function fetchMsgsCached(url, threadId) {
  // dedupe inflight
  if (INFLIGHT.has(threadId)) return INFLIGHT.get(threadId);

  const p = (async () => {
    const data = await api(url).catch(() => null);
    const items = data?.items || [];
    setCached(threadId, items);
    return items;
  })().finally(() => {
    INFLIGHT.delete(threadId);
  });

  INFLIGHT.set(threadId, p);
  return p;
}

/** =========================
 *  Utils
 *  ========================= */
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
    return d.toLocaleDateString("ro-RO", { day: "2-digit", month: "2-digit" });
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

  const [sheetOpen, setSheetOpen] = useState(false);
  const [activeThread, setActiveThread] = useState(null);

  const [loadingThreads, setLoadingThreads] = useState(false);
  const [threads, setThreads] = useState([]);

  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [msgs, setMsgs] = useState([]);

  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);

  const isVendor = me?.role === "VENDOR";

  const API = useMemo(() => {
    const listThreads = isVendor
      ? `/api/inbox/threads?scope=all&groupBy=order`
      : `/api/user-inbox/threads?scope=all&groupBy=store`;

    const getMsgs = (threadId) =>
      isVendor
        ? `/api/inbox/threads/${encodeURIComponent(threadId)}/messages`
        : `/api/user-inbox/threads/${encodeURIComponent(threadId)}/messages`;

    const markRead = (threadId) =>
      isVendor
        ? `/api/inbox/threads/${encodeURIComponent(threadId)}/read`
        : `/api/user-inbox/threads/${encodeURIComponent(threadId)}/read`;

    const sendMsg = (threadId) =>
      isVendor
        ? `/api/inbox/threads/${encodeURIComponent(threadId)}/messages`
        : `/api/user-inbox/threads/${encodeURIComponent(threadId)}/messages`;

    const fullPage = fullPageHref || (isVendor ? "/mesaje" : "/cont/mesaje");

    return { listThreads, getMsgs, markRead, sendMsg, fullPage };
  }, [isVendor, fullPageHref]);

  const isMobile = useMemo(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia && window.matchMedia("(max-width: 768px)").matches;
  }, []);

  useClickOutside(open, popRef, anchorRef, () => {
    setSheetOpen(false);
    setActiveThread(null);
    setText("");
    onClose?.();
  });

  const pos = useMemo(() => {
    const a = anchorRef?.current;
    if (!open || !a) return null;
    const r = a.getBoundingClientRect();
    const top = r.bottom + 10;
    const left = Math.min(Math.max(8, r.right - 360), window.innerWidth - 8 - 360);
    return { top, left };
  }, [open, anchorRef]);

  const chatPos = useMemo(() => {
    if (!pos) return null;
    const width = 360;
    const height = 520;

    const preferRightLeft = pos.left + 360 + 12;
    const canRight = preferRightLeft + width <= window.innerWidth - 8;

    const left = canRight ? preferRightLeft : Math.max(8, pos.left - width - 12);
    const top = Math.min(pos.top, window.innerHeight - height - 12);

    return { top, left, width, height };
  }, [pos]);

  // Load threads when opening popover
  useEffect(() => {
    if (!open || !me) return;
    let alive = true;

    (async () => {
      try {
        setLoadingThreads(true);
        const data = await api(API.listThreads).catch(() => null);
        if (!alive) return;

        let items = data?.items || [];
        if (limit && items.length > limit) items = items.slice(0, limit);
        setThreads(items);
      } catch {
        if (alive) setThreads([]);
      } finally {
        if (alive) setLoadingThreads(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [open, me, API.listThreads, limit]);

  // ✅ Prefetch messages for first N threads when popover opens (desktop only, best effort)
  useEffect(() => {
    if (!open || !threads.length) return;
    const first = threads.slice(0, 4); // ajustează: 3-6 e sweet spot
    first.forEach((t) => {
      const threadId = pickRealThreadId(t);
      if (!threadId) return;
      if (getCached(threadId)) return; // already cached
      fetchMsgsCached(API.getMsgs(threadId), threadId).catch(() => {});
    });
  }, [open, threads, API]);

  async function openThread(item) {
    const threadId = pickRealThreadId(item);
    if (!threadId) return;

    setActiveThread({ ...item, _threadId: threadId });
    setSheetOpen(true);
    setText("");

    // ✅ 1) show cached instantly if exists (NO loader)
    const cached = getCached(threadId);
    if (cached) {
      setMsgs(cached);
      setLoadingMsgs(false);

      // ✅ 2) refresh in background (stale-while-revalidate)
      fetchMsgsCached(API.getMsgs(threadId), threadId)
        .then((fresh) => {
          // update only if still same thread open
          setMsgs((prev) => (activeThread?._threadId === threadId ? fresh : prev));
        })
        .catch(() => {});
    } else {
      // no cache => fallback to loader
      setLoadingMsgs(true);
      setMsgs([]);
      try {
        const fresh = await fetchMsgsCached(API.getMsgs(threadId), threadId);
        setMsgs(fresh);
      } catch {
        setMsgs([]);
      } finally {
        setLoadingMsgs(false);
      }
    }

    // mark read (fire and forget)
    api(API.markRead(threadId), { method: "PATCH" }).catch(() => {});
  }

  const activeThreadId = activeThread?._threadId || null;

  // ✅ Hover prefetch
  const prefetchThread = (t) => {
    const threadId = pickRealThreadId(t);
    if (!threadId) return;
    if (getCached(threadId)) return;
    fetchMsgsCached(API.getMsgs(threadId), threadId).catch(() => {});
  };

  async function handleSend(e) {
    e?.preventDefault?.();
    e?.stopPropagation?.();

    const content = (text || "").trim();
    if (!content || !activeThreadId || sending) return;

    setSending(true);

    const optimistic = {
      id: `local_${Date.now()}`,
      threadId: activeThreadId,
      from: "me",
      body: content,
      createdAt: new Date().toISOString(),
      pending: true,
    };

    // optimistic in UI
    setMsgs((m) => {
      const next = [...m, optimistic];
      setCached(activeThreadId, next); // ✅ cache update instantly
      return next;
    });
    setText("");

    try {
      await api(API.sendMsg(activeThreadId), {
        method: "POST",
        body: { body: content },
      });

      // refresh from server (but don't show loader)
      fetchMsgsCached(API.getMsgs(activeThreadId), activeThreadId)
        .then((fresh) => setMsgs(fresh))
        .catch(() => {});

      // update list preview
      setThreads((prev) =>
        prev.map((x) => {
          const realId = pickRealThreadId(x);
          if (String(realId) !== String(activeThreadId)) return x;
          if (Array.isArray(x.threads)) return { ...x, lastMsg: content, lastAt: new Date().toISOString() };
          return { ...x, lastMsg: content, lastAt: new Date().toISOString(), unreadCount: 0 };
        })
      );
    } catch {
      setMsgs((m) => {
        const next = m.map((x) => (x.id === optimistic.id ? { ...x, failed: true, pending: false } : x));
        setCached(activeThreadId, next);
        return next;
      });
    } finally {
      setSending(false);
    }
  }

  if (!open || !pos) return null;

  const popover = (
    <>
      {/* THREAD LIST */}
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
            onClick={() => {
              setSheetOpen(false);
              setActiveThread(null);
              setText("");
              onClose?.();
            }}
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
                    key={t.id || t.threadId}
                    type="button"
                    className={styles.notifItem}
                    onClick={() => openThread(t)}
                    onMouseEnter={() => prefetchThread(t)} // ✅ prefetch on hover
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
                          </div>

                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
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
                            {unread > 0 && <span className={styles.badge}>{Math.min(unread, 99)}</span>}
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
              setSheetOpen(false);
              setActiveThread(null);
              setText("");
              onClose?.();
              navigate(API.fullPage);
            }}
          >
            Vezi toate mesajele <ArrowRight size={16} />
          </button>
        </div>
      </div>

      {/* CHAT WINDOW */}
      {sheetOpen &&
        (isMobile ? (
          <div role="dialog" aria-label="Conversație" style={{ position: "fixed", inset: 0, zIndex: 10000 }}>
            <div
              onClick={() => {
                setSheetOpen(false);
                setActiveThread(null);
                setText("");
              }}
              style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.35)" }}
            />

            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                bottom: 0,
                maxHeight: "78vh",
                borderTopLeftRadius: 18,
                borderTopRightRadius: 18,
                background: "var(--color-bg)",
                borderTop: "1px solid var(--color-border)",
                boxShadow: "0 -20px 50px rgba(0,0,0,0.18)",
                overflow: "hidden",
                display: "flex",
                flexDirection: "column",
              }}
            >
              <ChatInner
                styles={styles}
                title={activeThread?.name || "Conversație"}
                msgs={msgs}
                loadingMsgs={loadingMsgs}
                text={text}
                setText={setText}
                sending={sending}
                onClose={() => {
                  setSheetOpen(false);
                  setActiveThread(null);
                  setText("");
                }}
                onSend={handleSend}
              />
            </div>
          </div>
        ) : (
          <div
            role="dialog"
            aria-label="Conversație"
            className={styles.chatPop}
            style={{
              position: "fixed",
              zIndex: 10000,
              top: chatPos?.top ?? pos.top,
              left: chatPos?.left ?? pos.left,
              width: chatPos?.width ?? 360,
              height: chatPos?.height ?? 520,
            }}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            <ChatInner
              styles={styles}
              title={activeThread?.name || "Conversație"}
              msgs={msgs}
              loadingMsgs={loadingMsgs}
              text={text}
              setText={setText}
              sending={sending}
              onClose={() => {
                setSheetOpen(false);
                setActiveThread(null);
                setText("");
              }}
              onSend={handleSend}
              compactHeader
            />
          </div>
        ))}
    </>
  );

  return createPortal(popover, document.body);
}

function ChatInner({
  styles,
  title,
  msgs,
  loadingMsgs,
  text,
  setText,
  sending,
  onClose,
  onSend,
  compactHeader,
}) {
  return (
    <div className={styles.chatPopInner}>
      <div className={styles.chatPopHead} data-compact={compactHeader ? "1" : "0"}>
        <div style={{ fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {title}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Închide conversația"
          className={styles.notifClose}
          style={{ width: 30, height: 30 }}
        >
          <X size={18} />
        </button>
      </div>

      <div className={styles.chatPopBody}>
        {loadingMsgs && !msgs.length ? (
          <div style={{ color: "var(--color-text-muted)" }}>Se încarcă mesajele…</div>
        ) : msgs.length === 0 ? (
          <div style={{ color: "var(--color-text-muted)" }}>Nu există mesaje în această conversație.</div>
        ) : (
          msgs.map((m, idx) => {
            const mine = m.from === "me";
            const body = m.body || m.text || m.message || "";
            const isDeleted = !!m.deleted || !!m.deletedByUserAt;
            return (
              <div
                key={m.id || idx}
                style={{
                  alignSelf: mine ? "flex-end" : "flex-start",
                  maxWidth: "85%",
                  background: mine ? "var(--color-primary)" : "var(--color-card)",
                  color: mine ? "white" : "var(--color-text)",
                  border: mine ? "none" : "1px solid var(--color-border)",
                  borderRadius: 14,
                  padding: "10px 12px",
                  lineHeight: 1.35,
                  whiteSpace: "pre-wrap",
                  opacity: isDeleted ? 0.7 : 1,
                  fontStyle: isDeleted ? "italic" : "normal",
                }}
              >
                {isDeleted ? "🚫 Mesaj șters" : body || "—"}
              </div>
            );
          })
        )}
      </div>

      <form className={styles.chatPopComposer} onSubmit={onSend}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Scrie un mesaj…"
          className={styles.chatPopInput}
        />
        <button
          type="submit"
          disabled={!text.trim() || sending}
          className={styles.chatPopSend}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <Send size={16} /> Trimite
        </button>
      </form>
    </div>
  );
}
