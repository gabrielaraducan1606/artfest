// frontend/src/pages/user/UserMessagesPage.jsx
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  Pencil,
  Paperclip,
  ChevronLeft,
  Trash2,
  X,
  Download,
  FileText,
} from "lucide-react";
import styles from "./UserMessages.module.css";

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
    return d.toLocaleTimeString("ro-RO", { hour: "2-digit", minute: "2-digit" });
  if (diffDays < 7)
    return d.toLocaleDateString("ro-RO", {
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  return d.toLocaleDateString("ro-RO", { day: "2-digit", month: "short" });
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

function shortOrderId(orderSummary) {
  if (!orderSummary) return null;
  const baseId = orderSummary.id;
  if (!baseId) return null;
  return String(baseId).slice(-6).toUpperCase();
}

function autoResize(el) {
  if (!el) return;
  el.style.height = "auto";
  const max = 80;
  el.style.height = Math.min(el.scrollHeight, max) + "px";
}

function isImageMime(mime = "") {
  return /^image\//i.test(mime);
}

function niceBytes(n) {
  if (!n && n !== 0) return "";
  const units = ["B", "KB", "MB", "GB"];
  let v = Number(n);
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  const fixed = i === 0 ? 0 : v < 10 ? 1 : 0;
  return `${v.toFixed(fixed)} ${units[i]}`;
}

/* ========= Hooks ========= */
function useThreads({ scope, q, groupByStore }) {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState([]);
  const [error, setError] = useState(null);

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
      if (d?.items) setItems(d.items);
      else setItems([]);
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

  const reload = useCallback(async () => {
    if (!threadId) return;
    setLoading(true);
    setError(null);
    try {
      const d = await api(`${API_BASE}/threads/${threadId}/messages`).catch(() => null);
      if (d?.items) setMsgs(d.items);
      else setMsgs([]);
      await api(`${API_BASE}/threads/${threadId}/read`, { method: "PATCH" }).catch(() => {});
    } catch (e) {
      setError(e?.message || "Eroare la încărcarea mesajelor");
    } finally {
      setLoading(false);
    }
  }, [threadId]);

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

/* ========= Pagina ========= */
export default function UserMessagesPage() {
  const [searchParams] = useSearchParams();
  const threadIdFromUrl = searchParams.get("threadId") || searchParams.get("thread") || null;

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

  const [selectedId, setSelectedId] = useState(null);
  const [activeThreadId, setActiveThreadId] = useState(null);

  const [dragY, setDragY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef(null);

  useEffect(() => {
    if (threadIdFromUrl) setSelectedId(String(threadIdFromUrl));
  }, [threadIdFromUrl]);

  useEffect(() => {
    if (!threads.length) return;

    const isBrowser = typeof window !== "undefined";
    const isMobile =
      isBrowser && window.matchMedia && window.matchMedia("(max-width: 768px)").matches;

    if (threadIdFromUrl) return;

    if (!selectedId && !isMobile && threads[0]) {
      setSelectedId(threads[0].id);
    }
  }, [threads, selectedId, threadIdFromUrl]);

  const current = useMemo(
    () => threads.find((t) => String(t.id) === String(selectedId)) || null,
    [threads, selectedId]
  );

  useEffect(() => {
    if (!current) {
      setActiveThreadId(null);
      return;
    }

    if (groupByStore && Array.isArray(current.threads) && current.threads.length) {
      setActiveThreadId((prev) => {
        if (prev && current.threads.some((th) => th.threadId === prev)) return prev;
        const nonArchived = current.threads.find((th) => !th.archived);
        return nonArchived?.threadId || current.threads[0].threadId;
      });
    } else {
      setActiveThreadId(current.id || null);
    }
  }, [current, groupByStore]);

  const activeThread = useMemo(() => {
    if (!current) return null;
    if (groupByStore && Array.isArray(current.threads) && current.threads.length) {
      const found = current.threads.find((th) => th.threadId === activeThreadId);
      return found || current.threads[0];
    }
    return current;
  }, [current, groupByStore, activeThreadId]);

  const currentThreadId = activeThread?.threadId || activeThread?.id || null;

  const { loading: loadingMsgs, msgs, error: errMsgs, setMsgs, reload: reloadMsgs } =
    useMessages(currentThreadId);

  const listRef = useRef(null);
  useEffect(() => {
    if (!listRef.current) return;
    listRef.current.scrollTop = listRef.current.scrollHeight + 1000;

    const ta = document.querySelector(`.${styles.input}`);
    if (ta) autoResize(ta);
  }, [msgs, currentThreadId, loadingMsgs]);

  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);

  // ✅ attachments state
  const fileInputRef = useRef(null);
  const [pickedFiles, setPickedFiles] = useState([]);
  const [uploadingFiles, setUploadingFiles] = useState(false);

  const visibleThreads = useMemo(() => {
    if (scope === "unread")
      return threads.filter((t) => (t.unreadCount || 0) > 0 && !t.archived);
    if (scope === "archived") return threads.filter((t) => t.archived);
    return threads.filter((t) => !t.archived);
  }, [threads, scope]);

  const isGroupedView = groupByStore;
  const hasCurrent = !!activeThread;

  const selectItem = (id) => setSelectedId(id);

  const clearSelection = () => {
    setSelectedId(null);
    setActiveThreadId(null);
  };

  const archiveThread = async (threadId, archived) => {
    if (!threadId) return;
    try {
      await api(`${API_BASE}/threads/${threadId}/archive`, {
        method: "PATCH",
        body: { archived },
      });
      setThreads((items) =>
        items.map((t) => {
          if (!Array.isArray(t.threads)) {
            if (t.id === threadId) return { ...t, archived };
            return t;
          }
          return {
            ...t,
            threads: t.threads.map((th) => (th.threadId === threadId ? { ...th, archived } : th)),
          };
        })
      );
      await reloadThreads();
    } catch (e) {
      console.error("Eroare la (de)arhivare", e);
    }
  };

  const deleteThread = async (threadId) => {
    if (!threadId) return;
    if (!window.confirm("Sigur vrei să ștergi această conversație?")) return;
    try {
      await api(`${API_BASE}/threads/${threadId}`, { method: "DELETE" });
      setThreads((items) => {
        const after = items
          .map((t) => {
            if (!Array.isArray(t.threads)) {
              if (t.id === threadId) return null;
              return t;
            }
            const remaining = t.threads.filter((th) => th.threadId !== threadId);
            if (!remaining.length) return null;
            return { ...t, threads: remaining };
          })
          .filter(Boolean);
        return after;
      });

      if (currentThreadId === threadId) clearSelection();
    } catch (e) {
      console.error("Eroare la ștergere conversație", e);
    }
  };

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
      attachments: [],
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
        m.map((x) => (x.id === optimistic.id ? { ...x, failed: true, pending: false } : x))
      );
    } finally {
      setSending(false);
    }
  }

  // ✅ Edit mesaj USER (presupune că ai ruta PATCH în backend)
  async function editMessage(messageId, newBody) {
    if (!currentThreadId || !messageId) return;
    if (String(messageId).startsWith("local_")) return;
    try {
      await api(`${API_BASE}/threads/${currentThreadId}/messages/${messageId}`, {
        method: "PATCH",
        body: { body: newBody },
      });
      await reloadMsgs();
      await reloadThreads();
    } catch (e) {
      console.error("Eroare la editare mesaj", e);
      alert("Nu am putut edita mesajul.");
    }
  }

  async function deleteMessage(messageId) {
  if (!currentThreadId || !messageId) return;
  if (String(messageId).startsWith("local_")) return;
  if (!window.confirm("Ștergi acest mesaj?")) return;

  // ✅ optimistic: nu îl scoatem din UI, îl transformăm în placeholder
  setMsgs((m) =>
    m.map((x) =>
      x.id === messageId
        ? { ...x, _deletedLocal: true, body: "", attachments: x.attachments || [] }
        : x
    )
  );

  try {
    await api(`${API_BASE}/threads/${currentThreadId}/messages/${messageId}`, {
      method: "DELETE",
    });

    // ✅ dacă backend îl returnează încă (ideal), reload îl păstrează cu flag
    await reloadMsgs();
    await reloadThreads();
  } catch (e) {
    console.error("Eroare la ștergere mesaj", e);
    alert("Nu am putut șterge mesajul.");

    // rollback (opțional): reîncarcă din server ca să revină mesajul
    await reloadMsgs();
  }
}

  function handleKey(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  // ✅ Attach UI handlers
  const openFilePicker = () => {
    if (!currentThreadId) return;
    if (fileInputRef.current) fileInputRef.current.click();
  };

  const onPickFiles = (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    setPickedFiles((prev) => {
      const merged = [...prev, ...files];
      return merged.slice(0, 10);
    });

    e.target.value = "";
  };

  const removePickedFile = (idx) => {
    setPickedFiles((prev) => prev.filter((_, i) => i !== idx));
  };

  const clearPickedFiles = () => setPickedFiles([]);

  // ✅ Upload attachments (FIX: folosim copie locală)
  const uploadPickedFiles = async () => {
    if (!currentThreadId) return;
    if (!pickedFiles.length) return;

    const filesToUpload = [...pickedFiles]; // ✅ copie locală

    const optimisticId = `local_att_${Date.now()}`;
    const optimistic = {
      id: optimisticId,
      threadId: currentThreadId,
      from: "me",
      body: "",
      createdAt: nowIso(),
      pending: true,
      readByPeer: false,
      attachments: filesToUpload.map((f, i) => ({
        id: `${optimisticId}_${i}`,
        url: null,
        name: f.name,
        mime: f.type,
        size: f.size,
        pending: true,
      })),
    };

    setMsgs((m) => [...m, optimistic]);
    setUploadingFiles(true);
    clearPickedFiles(); // ✅ ok acum

    try {
      const fd = new FormData();
      filesToUpload.forEach((f) => fd.append("files", f)); // ✅ folosește copia

      const token =
        localStorage.getItem("token") ||
        localStorage.getItem("accessToken") ||
        sessionStorage.getItem("token") ||
        sessionStorage.getItem("accessToken");

      const resp = await fetch(`${API_BASE}/threads/${currentThreadId}/attachments`, {
        method: "POST",
        body: fd,
        credentials: "include",
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });

      const data = await resp.json().catch(() => null);

      if (!resp.ok) {
        console.error("Upload attachments failed:", { status: resp.status, data });
        const msg =
          data?.message || data?.details || data?.error || `upload_failed_${resp.status}`;
        throw new Error(msg);
      }

      await reloadMsgs();
      await reloadThreads();
    } catch (e) {
      setMsgs((m) =>
        m.map((x) => (x.id === optimisticId ? { ...x, failed: true, pending: false } : x))
      );
      console.error("Upload failed", e);
      alert("Nu am putut încărca fișierele. Încearcă din nou.");
    } finally {
      setUploadingFiles(false);
    }
  };

  // swipe handlers
  const handleSheetTouchStart = (e) => {
    if (!current || !activeThread) return;
    const touch = e.touches[0];
    dragStartRef.current = touch.clientY;
    setIsDragging(true);
  };

  const handleSheetTouchMove = (e) => {
    if (!isDragging || dragStartRef.current == null) return;
    const touch = e.touches[0];
    const diff = touch.clientY - dragStartRef.current;
    if (diff > 0) setDragY(diff);
  };

  const handleSheetTouchEnd = () => {
    if (!isDragging) return;
    const threshold = 80;
    if (dragY > threshold) clearSelection();
    setIsDragging(false);
    setDragY(0);
    dragStartRef.current = null;
  };

  return (
    <>
      <div className={styles.wrap} data-mobile-open={hasCurrent ? "1" : "0"}>
        {/* Sidebar */}
        <aside className={styles.sidebar}>
          <div className={styles.sideHead}>
            <div className={styles.sideTitle}>
              <MessageSquare size={18} /> Mesaje
            </div>
            <button
              className={`${styles.iconBtn} ${loadingThreads ? styles.iconBtnLoading : ""}`}
              title="Reîncarcă"
              onClick={reloadThreads}
              type="button"
            >
              <Loader2 size={16} className={loadingThreads ? styles.spin : ""} />
            </button>
          </div>

          <div className={styles.searchBar}>
            <SearchIcon size={16} />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Caută magazin, telefon, mesaj…"
            />
            <button className={styles.iconBtn} title="Filtre (în curând)" type="button">
              <Filter size={16} />
            </button>
          </div>

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
              className={`${styles.tab} ${scope === "all" ? styles.active : ""}`}
              onClick={() => setScope("all")}
              type="button"
            >
              <Inbox size={14} /> Toate
            </button>
            <button
              className={`${styles.tab} ${scope === "unread" ? styles.active : ""}`}
              onClick={() => setScope("unread")}
              type="button"
            >
              Necitite
            </button>
            <button
              className={`${styles.tab} ${scope === "archived" ? styles.active : ""}`}
              onClick={() => setScope("archived")}
              type="button"
            >
              <Archive size={14} /> Arhivate
            </button>
          </div>

          <div className={styles.threadList}>
            {loadingThreads && !threads.length && <div className={styles.empty}>Se încarcă…</div>}
            {errThreads && <div className={styles.error}>Nu am putut încărca conversațiile.</div>}
            {!loadingThreads && !visibleThreads.length && (
              <div className={styles.empty}>Nu există conversații.</div>
            )}

            {visibleThreads.map((t) => {
              const isSelected = String(t.id) === String(selectedId);
              const hasUnread = (t.unreadCount || 0) > 0;
              const name = t.storeName || t.name || "Magazin";
              const lastMsg = t.lastMsg || "Fără mesaje recente";

              const isStoreGroup = isGroupedView && Array.isArray(t.threads);
              const orderBadge = !isStoreGroup && t.orderSummary && shortOrderId(t.orderSummary);

              return (
                <div
                  key={t.id}
                  className={`${styles.threadItem} ${isSelected ? styles.selected : ""} ${
                    hasUnread ? styles.unread : ""
                  }`}
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
                  <div className={styles.threadAvatar}>{initialsOf(name)}</div>
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
                      <span className={styles.threadTime}>{fmtTime(t.lastAt)}</span>
                    </div>

                    <div className={styles.threadRowBottom}>
                      <span className={styles.threadLastMsg}>{lastMsg}</span>
                      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        {t.archived && <span className={styles.threadStatus}>Arhivat</span>}
                        {hasUnread && <span className={styles.unreadBadge}>{t.unreadCount}</span>}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </aside>

        {/* Chat */}
        <section
          className={styles.chat}
          style={
            isDragging ? { transform: `translateY(${dragY}px)`, transition: "none" } : undefined
          }
          onTouchStart={handleSheetTouchStart}
          onTouchMove={handleSheetTouchMove}
          onTouchEnd={handleSheetTouchEnd}
        >
          {!current || !activeThread ? (
            <div className={styles.chatEmpty}>
              <MessageSquare size={28} />
              <div>Selectează o conversație din listă.</div>
            </div>
          ) : (
            <>
              <header className={styles.chatHead}>
                <button
                  className={`${styles.iconBtn} ${styles.hideDesktop}`}
                  onClick={clearSelection}
                  title="Înapoi la listă"
                  type="button"
                >
                  <ChevronLeft size={18} />
                </button>

                <div className={styles.chatPeer}>
                  <div className={styles.avatarLg}>{initialsOf(current.storeName || current.name || "M")}</div>
                  <div>
                    <div className={styles.peerName}>
                     {current.storeName || current.name || "Magazin"}
                      {!isGroupedView &&
                        activeThread.orderSummary &&
                        shortOrderId(activeThread.orderSummary) && (
                          <span className={styles.peerOrderBadge}>
                            {" · "}Comanda {shortOrderId(activeThread.orderSummary)}
                          </span>
                        )}
                    </div>
                    {current.phone && <div className={styles.peerSub}>{current.phone}</div>}
                    <div className={styles.peerSub}>
                      {activeThread.archived ? "Conversație arhivată" : "Conversație activă"}
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
                  {currentThreadId && (
                    <button
                      className={styles.iconBtn}
                      title={activeThread.archived ? "Dezarhivează" : "Arhivează"}
                      onClick={() => archiveThread(currentThreadId, !activeThread.archived)}
                      type="button"
                    >
                      <Archive size={18} />
                    </button>
                  )}

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

              {isGroupedView && Array.isArray(current.threads) && current.threads.length > 1 && (
                <div className={styles.orderTabs}>
                  {current.threads.map((th) => {
                    const sid = shortOrderId(th.orderSummary);
                    return (
                      <button
                        key={th.threadId}
                        type="button"
                        className={
                          th.threadId === currentThreadId ? styles.orderTabActive : styles.orderTab
                        }
                        onClick={() => setActiveThreadId(th.threadId)}
                      >
                        <span>{sid ? `Comanda ${sid}` : "Conversație fără comandă"}</span>
                        {th.lastAt && <span className={styles.orderTabDate}>{fmtDate(th.lastAt)}</span>}
                        {th.unreadCount > 0 && (
                          <span className={styles.unreadBadge}>{th.unreadCount}</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}

              <div className={styles.msgList} ref={listRef}>
                {loadingMsgs && <div className={styles.loading}>Se încarcă…</div>}
                {errMsgs && <div className={styles.error}>Nu am putut încărca mesajele.</div>}

                {msgs.map((m) => (
                  <MessageBubble
                    key={m.id}
                    mine={m.from === "me"}
                    msg={m}
                    onEdit={(body) => editMessage(m.id, body)}
                    onDelete={() => deleteMessage(m.id)}
                  />
                ))}
              </div>

              {/* Composer */}
              <footer className={styles.composer}>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  style={{ display: "none" }}
                  onChange={onPickFiles}
                />

                <button
                  className={styles.iconBtn}
                  title={currentThreadId ? "Atașează fișiere" : "Selectează o conversație"}
                  type="button"
                  onClick={openFilePicker}
                  disabled={!currentThreadId || uploadingFiles || sending}
                >
                  <Paperclip size={18} />
                </button>

                <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
                  {!!pickedFiles.length && (
                    <div className={styles.attachPreviewRow}>
                      {pickedFiles.map((f, idx) => (
                        <div key={`${f.name}_${idx}`} className={styles.attachChip}>
                          <span className={styles.attachChipName}>{f.name}</span>
                          <span className={styles.attachChipSize}>{niceBytes(f.size)}</span>
                          <button
                            type="button"
                            className={styles.attachChipRemove}
                            title="Elimină"
                            onClick={() => removePickedFile(idx)}
                          >
                            <X size={14} />
                          </button>
                        </div>
                      ))}

                      <button
                        type="button"
                        className={styles.attachUploadBtn}
                        onClick={uploadPickedFiles}
                        disabled={!pickedFiles.length || uploadingFiles || !currentThreadId}
                        title="Trimite atașamentele"
                      >
                        {uploadingFiles ? (
                          <>
                            <Loader2 size={16} className={styles.spin} /> Se încarcă…
                          </>
                        ) : (
                          <>
                            <Send size={16} /> Trimite fișiere
                          </>
                        )}
                      </button>
                    </div>
                  )}

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
                    disabled={uploadingFiles}
                  />
                </div>

                <button
                  className={styles.sendBtn}
                  onClick={handleSend}
                  disabled={!text.trim() || sending || !currentThreadId || uploadingFiles}
                  type="button"
                >
                  {sending ? (
                    <>
                      <Loader2 size={16} className={styles.spin} /> Se trimite…
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

      {hasCurrent && <div className={styles.mobileBackdrop} onClick={clearSelection} />}
    </>
  );
}

function MessageBubble({ mine, msg, onEdit, onDelete }) {
  const isPending = msg.pending;
  const isFailed = msg.failed;
  const readByPeer = !!msg.readByPeer;
function isDeletedPlaceholder(m) {
  // 1) dacă backend trimite un flag (recomandat) — ex: m.deleted === true
  if (m?.deleted) return true;

  // 2) dacă noi îl marcăm local după DELETE
  if (m?._deletedLocal) return true;

  // 3) fallback: dacă body e gol și nu are attachments (opțional)
  // return !String(m?.body || "").trim() && !(m?.attachments?.length > 0);

  return false;
}

const isDeleted = isDeletedPlaceholder(msg);
const deletedText = mine ? "Mesaj șters de tine" : "Mesaj șters";

  const atts = useMemo(() => {
    const a = msg?.attachments;
    return Array.isArray(a) ? a : [];
  }, [msg?.attachments]);

  const hasAttachments = atts.length > 0;

  function shouldRenderBody(m) {
    const b = (m?.body || "").trim();
    if (!b) return false;
    if (Array.isArray(m?.attachments) && m.attachments.length) {
      if (b === "📎 Atașament") return false;
      if (/^📎\s+\d+\s+atașamente$/i.test(b)) return false;
      if (/^📎\s+.+/.test(b) && m.attachments.length === 1) return false;
    }
    return true;
  }

  const hasBody = !isDeleted && shouldRenderBody(msg);
  const bubbleKind = hasAttachments && !hasBody ? "att" : "msg";

  const imgAtts = useMemo(() => atts.filter((a) => isImageMime(a.mime)), [atts]);
  const fileAtts = useMemo(() => atts.filter((a) => !isImageMime(a.mime)), [atts]);

  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(msg.body || "");

  // ✅ long-press actions (mobile)
  const [showActions, setShowActions] = useState(false);
  const pressTimerRef = useRef(null);

  const isTouchDevice =
    typeof window !== "undefined" &&
    window.matchMedia &&
    window.matchMedia("(pointer: coarse)").matches;

  const LONG_PRESS_MS = 320;

  const startPress = () => {
    if (!isTouchDevice) return;
    if (isPending) return;
    if (isEditing) return;
    clearTimeout(pressTimerRef.current);
    pressTimerRef.current = setTimeout(() => {
      setShowActions(true);
      if (navigator?.vibrate) navigator.vibrate(10);
    }, LONG_PRESS_MS);
  };

  const cancelPress = () => {
    clearTimeout(pressTimerRef.current);
    pressTimerRef.current = null;
  };

  useEffect(() => {
    setEditText(msg.body || "");
  }, [msg.body]);

  useEffect(() => {
    setShowActions(false);
  }, [msg.id, isEditing]);

  function triggerBrowserDownload(url) {
    if (!url) return;
    const a = document.createElement("a");
    a.href = url;
    a.rel = "noreferrer";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  const handleDownload = () => {
    const att = atts?.[0];
    if (!att) return;
    const url = att?.id ? `${API_BASE}/attachments/${att.id}/download` : att?.url;
    triggerBrowserDownload(url);
  };

  async function saveEdit() {
    const v = (editText || "").trim();
    if (!v) return;
    await onEdit?.(v);
    setIsEditing(false);
  }

  // ✅ nu arăta edit/delete pentru mesaje locale (optimistic)
 const canMutate =
  mine && !isPending && !isDeleted && !String(msg.id || "").startsWith("local_");

  let tickLabel = "";
  let tickClass = "";
  if (isFailed) {
    tickLabel = "!";
    tickClass = styles.readTickFailed;
  } else if (isPending) {
    tickLabel = "…";
    tickClass = styles.readTickPending;
  } else if (mine) {
    tickLabel = readByPeer ? "✓✓" : "✓";
    tickClass = readByPeer ? `${styles.readTick} ${styles.readTickRead}` : styles.readTick;
  }

  return (
    <div className={`${styles.bubbleRow} ${mine ? styles.right : styles.left}`}>
      <div
        className={`${styles.bubbleWrap} ${showActions ? styles.bubbleWrapActive : ""}`}
        onTouchStart={startPress}
        onTouchEnd={cancelPress}
        onTouchMove={cancelPress}
        onTouchCancel={cancelPress}
        onContextMenu={(e) => {
          if (isTouchDevice) {
            e.preventDefault();
            if (!isPending && (hasAttachments || canMutate)) setShowActions(true);
          }
        }}
      >
        <div
          className={`${styles.bubble} ${mine ? styles.mine : styles.theirs}`}
          data-state={isFailed ? "failed" : isPending ? "pending" : "ok"}
          data-kind={bubbleKind}
        >
          {isEditing ? (
            <textarea
              className={styles.editInput}
              rows={2}
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  saveEdit();
                }
                if (e.key === "Escape") {
                  e.preventDefault();
                  setIsEditing(false);
                  setEditText(msg.body || "");
                }
              }}
            />
          ) : (
            <>
             {isDeleted ? (
  <div className={styles.bodyText} style={{ opacity: 0.65, fontStyle: "italic" }}>
    {deletedText}
  </div>
) : (
  hasBody && <div className={styles.bodyText}>{msg.body}</div>
)}


              {!!atts.length && (
                <div className={styles.attWrap}>
                  {!!imgAtts.length && (
                    <div className={styles.attGrid} data-count={imgAtts.length}>
                      {imgAtts.map((a) => {
                        const href = a?.url;
                        return (
                          <a
                            key={a.id || a.name}
                            className={styles.attThumb}
                            href={href || "#"}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(e) => {
                              if (!href) e.preventDefault();
                            }}
                            title={a.name}
                          >
                            {href ? (
                              <img src={href} alt={a.name || "Imagine"} loading="lazy" />
                            ) : (
                              <div className={styles.attThumbPlaceholder}>IMG</div>
                            )}
                          </a>
                        );
                      })}
                    </div>
                  )}

                  {!!fileAtts.length && (
                    <div className={styles.attFiles}>
                      {fileAtts.map((a) => {
                        const href = a?.id ? `${API_BASE}/attachments/${a.id}/download` : a?.url;

                        return (
                          <a
                            key={a.id || a.name}
                            className={styles.attFileCard}
                            href={href || "#"}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(e) => {
                              if (!href) e.preventDefault();
                            }}
                            title={a.name}
                          >
                            <span className={styles.attFileIcon}>
                              <FileText size={16} />
                            </span>

                            <span className={styles.attFileMeta}>
                              <span className={styles.attFileName}>{a.name || "Fișier"}</span>
                              <span className={styles.attFileSub}>
                                {a.size ? niceBytes(a.size) : ""}
                                {a.pending ? " · în curs…" : ""}
                              </span>
                            </span>
                          </a>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          <div className={styles.meta}>
            <span>{fmtTime(msg.createdAt)}</span>
            {mine && tickLabel && (
              <span className={tickClass} title={readByPeer ? "Citit" : "Trimis"}>
                {tickLabel}
              </span>
            )}
          </div>
        </div>

        {/* actions */}
        {!isPending && (hasAttachments || canMutate) && (
          <div className={`${styles.msgActions} ${showActions ? styles.msgActionsOpen : ""}`}>
            {!isEditing ? (
              <>
                {hasAttachments && (
                  <button
                    type="button"
                    className={styles.msgIconBtn}
                    title="Descarcă atașamentul"
                    onClick={() => {
                      setShowActions(false);
                      handleDownload();
                    }}
                  >
                    <Download size={14} />
                  </button>
                )}

                {canMutate && (
                  <>
                    <button
                      type="button"
                      className={styles.msgIconBtn}
                      title="Editează"
                      onClick={() => {
                        setShowActions(false);
                        setIsEditing(true);
                      }}
                    >
                      <Pencil size={14} />
                    </button>

                    <button
                      type="button"
                      className={`${styles.msgIconBtn} ${styles.msgIconBtnDanger}`}
                      title="Șterge"
                      onClick={() => {
                        setShowActions(false);
                        onDelete?.();
                      }}
                    >
                      <Trash2 size={14} />
                    </button>
                  </>
                )}
              </>
            ) : (
              canMutate && (
                <>
                  <button type="button" className={styles.msgSaveBtn} onClick={saveEdit}>
                    Salvează
                  </button>
                  <button
                    type="button"
                    className={styles.msgIconBtn}
                    title="Renunță"
                    onClick={() => {
                      setIsEditing(false);
                      setEditText(msg.body || "");
                    }}
                  >
                    <X size={14} />
                  </button>
                </>
              )
            )}
          </div>
        )}
      </div>
    </div>
  );
}
