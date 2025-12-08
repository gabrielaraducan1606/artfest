import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../../../lib/api";
import {
  MessageSquare,
  Send,
  Search as SearchIcon,
  Loader2,
  Archive,
  Inbox,
  Filter,
  Paperclip,
  ChevronLeft,
  Trash2,
} from "lucide-react";
import styles from "../../Vendor/Mesaje/Messages.module.css";

const API_BASE = "/api/user-inbox";

/* ========= Utils ========= */
const nowIso = () => new Date().toISOString();

function fmtTime(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  const today = new Date();
  const isToday = d.toDateString() === today.toDateString();
  const diffDays = Math.floor((+today - +d) / 86400000);
  if (isToday)
    return d.toLocaleTimeString("ro-RO", {
      hour: "2-digit",
      minute: "2-digit",
    });
  if (diffDays < 7)
    return d.toLocaleDateString("ro-RO", {
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  return d.toLocaleDateString("ro-RO", {
    day: "2-digit",
    month: "short",
  });
}

function fmtDate(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  return d.toLocaleDateString("ro-RO", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function initialsOf(name = "U") {
  return name
    .split(" ")
    .filter(Boolean)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

/** scurtăm id-ul comenzii / thread-ului */
function shortOrderId(orderSummary) {
  if (!orderSummary) return null;
  const baseId = orderSummary.id;
  if (!baseId) return null;
  return String(baseId).slice(-6).toUpperCase();
}

/* ========= Hooks ========= */
function useThreads({ scope, q, groupByStore }) {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState([]);
  const [error, setError] = useState(null);

  // debounced query
  const [dq, setDq] = useState(q);
  useEffect(() => {
    const id = setTimeout(() => setDq(q), 300);
    return () => clearTimeout(id);
  }, [q]);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set("scope", scope || "all");
      if (dq) params.set("q", dq);
      if (groupByStore) params.set("groupBy", "store");

      const url = `${API_BASE}/threads?${params.toString()}`;
      const d = await api(url).catch(() => null);
      if (d?.items) {
        setItems(d.items);
      } else {
        setItems([]);
      }
    } catch (e) {
      setError(e?.message || "Eroare la încărcarea conversațiilor");
    } finally {
      setLoading(false);
    }
  }, [scope, dq, groupByStore]);

  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    const id = setInterval(reload, 15000);
    return () => clearInterval(id);
  }, [reload]);

  return { loading, items, error, reload, setItems };
}

function useMessages(threadId) {
  const [loading, setLoading] = useState(false);
  const [msgs, setMsgs] = useState([]);
  const [error, setError] = useState(null);

  const reload = useCallback(
    async () => {
      if (!threadId) return;
      setLoading(true);
      setError(null);
      try {
        const d = await api(
          `${API_BASE}/threads/${threadId}/messages`
        ).catch(() => null);
        if (d?.items) setMsgs(d.items);
        else setMsgs([]);
        // mark as read (best-effort)
        await api(`${API_BASE}/threads/${threadId}/read`, {
          method: "PATCH",
        }).catch(() => {});
      } catch (e) {
        setError(e?.message || "Eroare la încărcarea mesajelor");
      } finally {
        setLoading(false);
      }
    },
    [threadId]
  );

  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    if (!threadId) return;
    const id = setInterval(reload, 8000);
    return () => clearInterval(id);
  }, [threadId, reload]);

  return { loading, msgs, error, setMsgs, reload };
}

/* auto-resize textarea */
function autoResize(el) {
  if (!el) return;
  el.style.height = "auto";
  const max = 80;
  el.style.height = Math.min(el.scrollHeight, max) + "px";
}

/* ========= Pagina ========= */
export default function UserMessagesPage() {
  const [searchParams] = useSearchParams();
  const initialThreadFromUrl =
    searchParams.get("thread") || searchParams.get("threadId") || null;

  const [scope, setScope] = useState("all"); // all | unread | archived
  const [q, setQ] = useState("");
  const [groupByStore, setGroupByStore] = useState(false);

  const {
    loading: loadingThreads,
    items: threads,
    error: errThreads,
    reload: reloadThreads,
    setItems: setThreads,
  } = useThreads({ scope, q, groupByStore });

  const [selectedId, setSelectedId] = useState(initialThreadFromUrl); // poate fi id de thread sau id de magazin
  const [activeThreadId, setActiveThreadId] = useState(null); // mereu threadId real

  // selectăm implicit ceva când vin thread-urile
  useEffect(() => {
    if (!threads.length) return;

    // dacă ai un thread specific în URL și încă nu e selectat
    if (!selectedId && initialThreadFromUrl) {
      const exists = threads.some(
        (t) => String(t.id) === String(initialThreadFromUrl)
      );
      if (exists) {
        setSelectedId(String(initialThreadFromUrl));
        return;
      }
    }

    // fallback: primul item
    if (!selectedId && threads[0]) {
      setSelectedId(threads[0].id);
    }
  }, [threads, selectedId, initialThreadFromUrl]);

  const current = useMemo(
    () => threads.find((t) => String(t.id) === String(selectedId)) || null,
    [threads, selectedId]
  );

  // când se schimbă current sau modul de grupare, setăm activeThreadId
  useEffect(() => {
    if (!current) {
      setActiveThreadId(null);
      return;
    }

    if (groupByStore && Array.isArray(current.threads) && current.threads.length) {
      setActiveThreadId((prev) => {
        if (prev && current.threads.some((th) => th.threadId === prev)) {
          return prev;
        }
        const nonArchived = current.threads.find((th) => !th.archived);
        return nonArchived?.threadId || current.threads[0].threadId;
      });
    } else {
      // mod normal: id-ul elementului = threadId
      setActiveThreadId(current.id || null);
    }
  }, [current, groupByStore]);

  // thread-ul activ (comanda selectată în tab)
  const activeThread = useMemo(() => {
    if (!current) return null;
    if (groupByStore && Array.isArray(current.threads) && current.threads.length) {
      const found = current.threads.find((th) => th.threadId === activeThreadId);
      return found || current.threads[0];
    }
    return current;
  }, [current, groupByStore, activeThreadId]);

  const currentThreadId = activeThread?.threadId || activeThread?.id || null;

  const {
    loading: loadingMsgs,
    msgs,
    error: errMsgs,
    setMsgs,
    reload: reloadMsgs,
  } = useMessages(currentThreadId);

  const listRef = useRef(null);
  useEffect(() => {
    if (!listRef.current) return;
    listRef.current.scrollTop = listRef.current.scrollHeight + 1000;

    const ta = document.querySelector(`.${styles.input}`);
    if (ta) autoResize(ta);
  }, [msgs, currentThreadId, loadingMsgs]);

  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);

  async function handleSend() {
    const content = text.trim();
    if (!content || !currentThreadId) return;
    const optimistic = {
      id: `local_${Date.now()}`,
      threadId: currentThreadId,
      from: "me",
      body: content,
      createdAt: nowIso(),
      pending: true,
      readByPeer: false,
    };
    setMsgs((m) => [...m, optimistic]);
    setText("");
    setSending(true);
    try {
      await api(`${API_BASE}/threads/${currentThreadId}/messages`, {
        method: "POST",
        body: { body: content },
      });
      await reloadMsgs();
      await reloadThreads();
    } catch {
      setMsgs((m) =>
        m.map((x) =>
          x.id === optimistic.id
            ? { ...x, failed: true, pending: false }
            : x
        )
      );
    } finally {
      setSending(false);
    }
  }

  function handleKey(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  // filtrăm conversațiile vizibile în funcție de scope + archived
  const visibleThreads = useMemo(() => {
    if (scope === "unread") {
      return threads.filter((t) => (t.unreadCount || 0) > 0 && !t.archived);
    }
    if (scope === "archived") {
      return threads.filter((t) => t.archived);
    }
    // scope === "all"
    return threads.filter((t) => !t.archived);
  }, [threads, scope]);

  const isGroupedView = groupByStore;
  const hasCurrent = !!current;

  const selectItem = (id) => {
    setSelectedId(id);
  };

  const clearSelection = () => {
    setSelectedId(null);
    setActiveThreadId(null);
  };

  // arhivare / dezarhivare thread
  const archiveThread = async (threadId, archived) => {
    if (!threadId) return;
    try {
      await api(`${API_BASE}/threads/${threadId}/archive`, {
        method: "PATCH",
        body: { archived },
      });
      setThreads((items) =>
        items.map((t) => {
          // în mod grupat, t poate fi magazin cu t.threads[]
          if (!Array.isArray(t.threads)) {
            if (t.id === threadId) return { ...t, archived };
            return t;
          }
          return {
            ...t,
            threads: t.threads.map((th) =>
              th.threadId === threadId ? { ...th, archived } : th
            ),
          };
        })
      );
      await reloadThreads();
    } catch (e) {
      console.error("Eroare la (de)arhivare", e);
    }
  };

  // ștergere thread
  const deleteThread = async (threadId) => {
    if (!threadId) return;
    if (!window.confirm("Sigur vrei să ștergi această conversație?")) return;
    try {
      await api(`${API_BASE}/threads/${threadId}`, {
        method: "DELETE",
      });
      setThreads((items) => {
        // scoatem thread-ul din listă / grup
        const after = items
          .map((t) => {
            if (!Array.isArray(t.threads)) {
              if (t.id === threadId) return null;
              return t;
            }
            const remaining = t.threads.filter(
              (th) => th.threadId !== threadId
            );
            if (!remaining.length) return null;
            return { ...t, threads: remaining };
          })
          .filter(Boolean);
        return after;
      });

      if (currentThreadId === threadId) {
        clearSelection();
      }
    } catch (e) {
      console.error("Eroare la ștergere conversație", e);
    }
  };

  return (
    <div className={styles.wrap} data-view={hasCurrent ? "chat" : "list"}>
      {/* Sidebar conversații */}
      <aside className={styles.sidebar}>
        <div className={styles.sideHead}>
          <div className={styles.sideTitle}>
            <MessageSquare size={18} /> Mesaje
          </div>
          <button
            className={`${styles.iconBtn} ${
              loadingThreads ? styles.iconBtnLoading : ""
            }`}
            title="Reîncarcă"
            onClick={reloadThreads}
            type="button"
          >
            <Loader2
              size={16}
              className={loadingThreads ? styles.spin : ""}
            />
          </button>
        </div>

        <div className={styles.searchBar}>
          <SearchIcon size={16} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Caută magazin, telefon, mesaj…"
          />
          <button
            className={styles.iconBtn}
            title="Filtre (în curând)"
            type="button"
          >
            <Filter size={16} />
          </button>
        </div>

        {/* bifa de grupare pe magazin */}
        <div className={styles.groupToggleRow}>
          <label className={styles.groupToggle}>
            <input
              type="checkbox"
              checked={groupByStore}
              onChange={(e) => {
                setGroupByStore(e.target.checked);
                setSelectedId(null);
                setActiveThreadId(null);
              }}
            />
            Grupare conversații pe magazin
          </label>
        </div>

        <div className={styles.scopeTabs}>
          <button
            className={`${styles.tab} ${
              scope === "all" ? styles.active : ""
            }`}
            onClick={() => setScope("all")}
            type="button"
          >
            <Inbox size={14} /> Toate
          </button>
          <button
            className={`${styles.tab} ${
              scope === "unread" ? styles.active : ""
            }`}
            onClick={() => setScope("unread")}
            type="button"
          >
            Necitite
          </button>
          <button
            className={`${styles.tab} ${
              scope === "archived" ? styles.active : ""
            }`}
            onClick={() => setScope("archived")}
            type="button"
          >
            <Archive size={14} /> Arhivate
          </button>
        </div>

        <div className={styles.threadList}>
          {loadingThreads && !threads.length && (
            <div className={styles.empty}>Se încarcă…</div>
          )}
          {errThreads && (
            <div className={styles.error}>
              Nu am putut încărca conversațiile.
            </div>
          )}
          {!loadingThreads && !visibleThreads.length && (
            <div className={styles.empty}>Nu există conversații.</div>
          )}

          {visibleThreads.map((t) => {
            const isSelected = String(t.id) === String(selectedId);
            const hasUnread = (t.unreadCount || 0) > 0;
            const name = t.name || "Magazin";
            const lastMsg = t.lastMsg || "Fără mesaje recente";

            const isStoreGroup =
              isGroupedView && Array.isArray(t.threads);

            // în mod negrupat avem orderSummary pentru fiecare thread
            const orderBadge =
              !isStoreGroup && t.orderSummary && shortOrderId(t.orderSummary);

            return (
              <div
                key={t.id}
                className={`${styles.threadItem} ${
                  isSelected ? styles.selected : ""
                } ${hasUnread ? styles.unread : ""}`}
                role="button"
                tabIndex={0}
                onClick={() => selectItem(t.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    selectItem(t.id);
                  }
                }}
              >
                <div className={styles.threadAvatar}>
                  {initialsOf(name)}
                </div>
                <div className={styles.threadBody}>
                  <div className={styles.threadRowTop}>
                    <span className={styles.threadName}>
                      {name}
                      {orderBadge && (
                        <span className={styles.threadOrderBadge}>
                          {" · "}Comanda {orderBadge}
                        </span>
                      )}
                    </span>
                    <span className={styles.threadTime}>
                      {fmtTime(t.lastAt)}
                    </span>
                  </div>

                  <div className={styles.threadRowBottom}>
                    <span className={styles.threadLastMsg}>
                      {lastMsg}
                    </span>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 4,
                      }}
                    >
                      {t.archived && (
                        <span className={styles.threadStatus}>
                          Arhivat
                        </span>
                      )}

                      {/* acțiuni inline DOAR în mod negrupat (altfel n-avem threadId direct) */}
                      {!isStoreGroup && (
                        <span className={styles.threadInlineActions}>
                          <button
                            type="button"
                            className={styles.threadIconBtn}
                            title={
                              t.archived
                                ? "Dezarhivează conversația"
                                : "Arhivează conversația"
                            }
                            onClick={(e) => {
                              e.stopPropagation();
                              e.preventDefault();
                              archiveThread(t.id, !t.archived);
                            }}
                          >
                            <Archive size={14} />
                          </button>

                          <button
                            type="button"
                            className={`${styles.threadIconBtn} ${styles.threadIconBtnDanger}`}
                            title="Șterge conversația"
                            onClick={(e) => {
                              e.stopPropagation();
                              e.preventDefault();
                              deleteThread(t.id);
                            }}
                          >
                            <Trash2 size={14} />
                          </button>
                        </span>
                      )}

                      {hasUnread && (
                        <span className={styles.unreadBadge}>
                          {t.unreadCount}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </aside>

      {/* Chat */}
      <section className={styles.chat}>
        {!current || !activeThread ? (
          <div className={styles.chatEmpty}>
            <MessageSquare size={28} />
            <div>Selectează o conversație din listă.</div>
          </div>
        ) : (
          <>
            <header className={styles.chatHead}>
              {/* back doar pe mobil */}
              <button
                className={`${styles.iconBtn} ${styles.hideDesktop}`}
                onClick={clearSelection}
                title="Înapoi la listă"
                type="button"
              >
                <ChevronLeft size={18} />
              </button>

              <div className={styles.chatPeer}>
                <div className={styles.avatarLg}>
                  {initialsOf(current.name || "M")}
                </div>
                <div>
                  <div className={styles.peerName}>
                    {current.name || "Magazin"}
                    {/* în mod negrupat: badge cu număr comandă */}
                    {!isGroupedView &&
                      activeThread.orderSummary &&
                      shortOrderId(activeThread.orderSummary) && (
                        <span className={styles.peerOrderBadge}>
                          {" · "}Comanda{" "}
                          {shortOrderId(activeThread.orderSummary)}
                        </span>
                      )}
                  </div>
                  {current.phone && (
                    <div className={styles.peerSub}>
                      {current.phone}
                    </div>
                  )}
                  <div className={styles.peerSub}>
                    {activeThread.archived
                      ? "Conversație arhivată"
                      : "Conversație activă"}
                    {isGroupedView && current.threads?.length ? (
                      <>
                        {" · "}
                        {current.threads.length} conversații cu acest magazin
                      </>
                    ) : null}
                  </div>
                </div>
              </div>

              <div className={styles.chatActions}>
                {/* buton arhivare / dezarhivare */}
                {currentThreadId && (
                  <button
                    className={styles.iconBtn}
                    title={
                      activeThread.archived
                        ? "Dezarhivează"
                        : "Arhivează"
                    }
                    onClick={() =>
                      archiveThread(currentThreadId, !activeThread.archived)
                    }
                    type="button"
                  >
                    <Archive size={18} />
                  </button>
                )}

                {/* buton ștergere conversație */}
                {currentThreadId && (
                  <button
                    className={styles.iconBtn}
                    title="Șterge conversația"
                    onClick={() => deleteThread(currentThreadId)}
                    type="button"
                  >
                    <Trash2 size={18} />
                  </button>
                )}
              </div>
            </header>

            {/* tab-uri comenzi în mod grupat */}
            {isGroupedView &&
              Array.isArray(current.threads) &&
              current.threads.length > 1 && (
                <div className={styles.orderTabs}>
                  {current.threads.map((th) => {
                    const sid = shortOrderId(th.orderSummary);
                    return (
                      <button
                        key={th.threadId}
                        type="button"
                        className={
                          th.threadId === currentThreadId
                            ? styles.orderTabActive
                            : styles.orderTab
                        }
                        onClick={() => setActiveThreadId(th.threadId)}
                      >
                        <span>
                          {sid
                            ? `Comanda ${sid}`
                            : "Conversație fără comandă"}
                        </span>
                        {th.lastAt && (
                          <span className={styles.orderTabDate}>
                            {fmtDate(th.lastAt)}
                          </span>
                        )}
                        {th.unreadCount > 0 && (
                          <span className={styles.unreadBadge}>
                            {th.unreadCount}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}

            <div className={styles.msgList} ref={listRef}>
              {loadingMsgs && (
                <div className={styles.loading}>Se încarcă…</div>
              )}
              {errMsgs && (
                <div className={styles.error}>
                  Nu am putut încărca mesajele.
                </div>
              )}
              {msgs.map((m) => (
                <MessageBubble
                  key={m.id}
                  mine={m.from === "me"}
                  msg={m}
                />
              ))}
            </div>

            <footer className={styles.composer}>
              {/* attach e doar placeholder deocamdată */}
              <button
                className={styles.iconBtn}
                title="Atașează (în curând)"
                type="button"
              >
                <Paperclip size={18} />
              </button>
              <textarea
                className={styles.input}
                rows={1}
                placeholder="Scrie un mesaj…"
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                  autoResize(e.target);
                }}
                onKeyDown={handleKey}
                title="Trimite (Enter) · Linie nouă (Shift+Enter)"
              />
              <button
                className={styles.sendBtn}
                onClick={handleSend}
                disabled={!text.trim() || sending || !currentThreadId}
                type="button"
              >
                {sending ? (
                  <>
                    <Loader2 size={16} className={styles.spin} /> Se
                    trimite…
                  </>
                ) : (
                  <>
                    <Send size={16} /> Trimite
                  </>
                )}
              </button>
            </footer>
          </>
        )}
      </section>
    </div>
  );
}

/* ========= Sub-componente ========= */
function MessageBubble({ mine, msg }) {
  const isPending = msg.pending;
  const isFailed = msg.failed;

  const readByPeer = !!msg.readByPeer;

  let tickLabel = "";
  let tickClass = "";
  if (isFailed) {
    tickLabel = "!";
    tickClass = styles.readTickFailed;
  } else if (isPending) {
    tickLabel = "…";
    tickClass = styles.readTickPending;
  } else if (mine) {
    // ✓ = trimis, ✓✓ = citit
    tickLabel = readByPeer ? "✓✓" : "✓";
    tickClass = readByPeer
      ? `${styles.readTick} ${styles.readTickRead}`
      : styles.readTick;
  }

  return (
    <div
      className={`${styles.bubbleRow} ${
        mine ? styles.right : styles.left
      }`}
    >
      {!mine && (
        <div className={styles.avatarSm}>
          {initialsOf(msg.authorName || "M")}
        </div>
      )}
      <div
        className={`${styles.bubble} ${
          mine ? styles.mine : styles.theirs
        }`}
      >
        {msg.body && (
          <div className={styles.bodyText}>{msg.body}</div>
        )}
        <div className={styles.meta}>
          <span>{fmtTime(msg.createdAt)}</span>
          {mine && tickLabel && (
            <span
              className={tickClass}
              title={readByPeer ? "Citit" : "Trimis"}
            >
              {tickLabel}
            </span>
          )}
          {isPending && <span>· în curs…</span>}
          {isFailed && <span>· nereușit</span>}
        </div>
      </div>
    </div>
  );
}
