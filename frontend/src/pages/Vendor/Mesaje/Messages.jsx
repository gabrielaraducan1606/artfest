// frontend/src/pages/vendor/MessagesPage.jsx
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
  ChevronRight,
  Calendar,
  MapPin,
  Tag as TagIcon,
  FileText,
  Clock,
  ChevronDown,
  Trash2,
} from "lucide-react";
import styles from "./Messages.module.css";

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

/** shortId din orderSummary (shipment sau order) */
function shortOrderId(orderSummary) {
  if (!orderSummary) return null;
  const shipment = orderSummary.shipments?.[0];
  const baseId = shipment?.id || orderSummary.id;
  if (!baseId) return null;
  return baseId.slice(-6).toUpperCase();
}

/* ========= Șabloane mesaje ========= */
const TEMPLATES = [
  {
    id: "intro",
    label: "Cerere detalii eveniment",
    text:
      "Bună! Mulțumesc pentru mesaj 😊\nÎmi poți spune te rog data, locația și tipul evenimentului?",
  },
  {
    id: "oferta",
    label: "Ofertă standard",
    text:
      "Îți trimit mai jos oferta noastră standard pentru acest tip de eveniment. Spune-mi te rog dacă vrei să o adaptăm în funcție de bugetul tău.",
  },
  {
    id: "followup",
    label: "Follow-up ofertă",
    text:
      "Revin cu un mic follow-up legat de oferta trimisă. Ai apucat să te uiți peste ea? 🙂",
  },
];

/* ========= Hooks ========= */
function useThreads({ scope, q, status, eventType, period, groupByUser }) {
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
      if (status && status !== "all") params.set("status", status);
      if (eventType && eventType !== "all") params.set("eventType", eventType);
      if (period && period !== "all") params.set("period", period);
      if (groupByUser) params.set("groupBy", "user");

      const url = `/api/inbox/threads?${params.toString()}`;
      const d = await api(url).catch(() => null);
      if (d?.items) setItems(d.items);
      else setItems([]);
    } catch (e) {
      setError(e?.message || "Eroare la încărcarea conversațiilor");
    } finally {
      setLoading(false);
    }
  }, [scope, dq, status, eventType, period, groupByUser]);

  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    const id = setInterval(reload, 15000);
    return () => clearInterval(id);
  }, [reload]);

  return { loading, items, error, reload, setItems };
}

/**
 * Mesaje pentru un singur thread (comandă)
 */
function useMessages(threadId) {
  const [loading, setLoading] = useState(false);
  const [msgs, setMsgs] = useState([]);
  const [error, setError] = useState(null);

  const reload = useCallback(async () => {
    if (!threadId) return;
    setLoading(true);
    setError(null);
    try {
      const d = await api(`/api/inbox/threads/${threadId}/messages`).catch(
        () => null
      );
      if (d?.items) setMsgs(d.items);
      else setMsgs([]);
      // mark as read (best-effort)
      await api(`/api/inbox/threads/${threadId}/read`, {
        method: "PATCH",
      }).catch(() => {});
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

/* auto-resize textarea */
function autoResize(el) {
  if (!el) return;
  el.style.height = "auto";
  const max = 80;
  el.style.height = Math.min(el.scrollHeight, max) + "px";
}

/* ========= Pagina ========= */
export default function MessagesPage() {
  const [searchParams, setSearchParams] = useSearchParams();

  const [scope, setScope] = useState("all"); // all | unread | archived
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [periodFilter, setPeriodFilter] = useState("all");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [groupByUser, setGroupByUser] = useState(false);

  const {
    loading: loadingThreads,
    items: threads,
    error: errThreads,
    reload: reloadThreads,
    setItems: setThreads,
  } = useThreads({
    scope,
    q,
    status: statusFilter,
    eventType: typeFilter,
    period: periodFilter,
    groupByUser,
  });

  const [selectedId, setSelectedId] = useState(null); // poate fi threadId sau "user:xxx"
  const [activeThreadId, setActiveThreadId] = useState(null); // mereu threadId real

  // swipe state pentru bottom sheet
  const [dragY, setDragY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef(null);

  // Sincronizare cu ?threadId=...
  useEffect(() => {
    if (!threads.length) return;

    const paramId = searchParams.get("threadId");
    const isBrowser = typeof window !== "undefined";
    const isMobile =
      isBrowser &&
      window.matchMedia &&
      window.matchMedia("(max-width: 768px)").matches;

    if (paramId) {
      const found = threads.find((t) => t.id === paramId);
      if (found && selectedId !== paramId) {
        setSelectedId(paramId);
      }
      return;
    }

    // dacă nu avem paramId și suntem pe DESKTOP -> auto-selectăm primul
    if (!selectedId && !isMobile && threads[0]) {
      const firstId = threads[0].id;
      setSelectedId(firstId);
      const sp = new URLSearchParams(searchParams);
      sp.set("threadId", firstId);
      setSearchParams(sp, { replace: true });
    }
  }, [threads, selectedId, searchParams, setSearchParams]);

  const current = useMemo(
    () => threads.find((t) => t.id === selectedId) || null,
    [threads, selectedId]
  );

  // când se schimbă current sau modul de grupare, setăm activeThreadId
  useEffect(() => {
    if (!current) {
      setActiveThreadId(null);
      return;
    }

    if (groupByUser && Array.isArray(current.threads) && current.threads.length) {
      // încercăm să păstrăm tab-ul curent dacă încă există
      setActiveThreadId((prev) => {
        if (prev && current.threads.some((th) => th.threadId === prev)) {
          return prev;
        }
        const nonArchived = current.threads.find((th) => !th.archived);
        return nonArchived?.threadId || current.threads[0].threadId;
      });
    } else {
      // mod normal: id-ul item-ului este chiar threadId
      setActiveThreadId(current.id || null);
    }
  }, [current, groupByUser]);

  // thread-ul activ (comanda selectată în tab)
  const activeThread = useMemo(() => {
    if (!current) return null;
    if (groupByUser && Array.isArray(current.threads) && current.threads.length) {
      const found = current.threads.find((th) => th.threadId === activeThreadId);
      return found || current.threads[0];
    }
    return current;
  }, [current, groupByUser, activeThreadId]);

  const {
    loading: loadingMsgs,
    msgs,
    error: errMsgs,
    setMsgs,
    reload: reloadMsgs,
  } = useMessages(activeThread?.threadId || activeThread?.id || null);

  const listRef = useRef(null);
  useEffect(() => {
    if (!listRef.current) return;
    listRef.current.scrollTop = listRef.current.scrollHeight + 1000;

    const ta = document.querySelector(`.${styles.input}`);
    if (ta) autoResize(ta);
  }, [msgs, activeThread?.threadId, loadingMsgs]);

  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef(null);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [internalNote, setInternalNote] = useState("");

  // notă internă sincronizată cu thread-ul activ
  useEffect(() => {
    if (!activeThread) {
      setInternalNote("");
      setTemplatesOpen(false);
      return;
    }
    setInternalNote(activeThread.internalNote || "");
    setTemplatesOpen(false);
  }, [activeThread]);

  const currentThreadId = activeThread?.threadId || activeThread?.id || null;

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
      await api(`/api/inbox/threads/${currentThreadId}/messages`, {
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

  // 🔹 vizibilitate în funcție de scope + archived
  const visibleThreads = useMemo(() => {
    if (scope === "unread") {
      return threads.filter(
        (t) => (t.unreadCount || 0) > 0 && !t.archived
      );
    }

    if (scope === "archived") {
      return threads.filter((t) => t.archived);
    }

    // scope === "all" -> toate ne-arhivate
    return threads.filter((t) => !t.archived);
  }, [threads, scope]);

  const currentIndex = useMemo(
    () => visibleThreads.findIndex((t) => t.id === current?.id),
    [visibleThreads, current]
  );

  const prevThread =
    currentIndex > 0 ? visibleThreads[currentIndex - 1] : null;

  const nextThread =
    currentIndex >= 0 && currentIndex < visibleThreads.length - 1
      ? visibleThreads[currentIndex + 1] : null;

  const handleAttachClick = () => {
    if (!fileInputRef.current) return;
    fileInputRef.current.click();
  };

  async function handleFilesChange(e) {
    const files = Array.from(e.target.files || []);
    if (!files.length || !currentThreadId) return;
    setUploading(true);
    try {
      const formData = new FormData();
      files.forEach((file) => formData.append("files", file));
      await api(`/api/inbox/threads/${currentThreadId}/attachments`, {
        method: "POST",
        body: formData,
      });
      await reloadMsgs();
    } catch (err) {
      console.error("Eroare la upload atașamente", err);
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  }

  async function handleSaveNote() {
    if (!currentThreadId) return;
    try {
      await api(`/api/inbox/threads/${currentThreadId}/meta`, {
        method: "PATCH",
        body: { internalNote },
      });
      setThreads((items) =>
        items.map((t) => {
          // mod normal: item = thread
          if (!groupByUser) {
            if (t.id === currentThreadId) {
              return { ...t, internalNote };
            }
            return t;
          }
          // mod groupByUser: item = user, cu threads[]
          if (!current || t.id !== current.id) return t;
          return {
            ...t,
            threads: (t.threads || []).map((th) =>
              th.threadId === currentThreadId
                ? { ...th, internalNote }
                : th
            ),
          };
        })
      );
    } catch (e) {
      console.error("Eroare la salvarea notei interne", e);
    }
  }

  const selectThread = (id) => {
    setSelectedId(id);
    const sp = new URLSearchParams(searchParams);
    sp.set("threadId", id);
    setSearchParams(sp, { replace: true });
  };

  const clearSelection = () => {
    setSelectedId(null);
    setActiveThreadId(null);
    const sp = new URLSearchParams(searchParams);
    sp.delete("threadId");
    setSearchParams(sp, { replace: true });
  };

  const hasCurrent = !!current;

  // swipe handlers (mobil)
  const handleSheetTouchStart = (e) => {
    if (!hasCurrent) return;
    const touch = e.touches[0];
    dragStartRef.current = touch.clientY;
    setIsDragging(true);
  };

  const handleSheetTouchMove = (e) => {
    if (!isDragging || dragStartRef.current == null) return;
    const touch = e.touches[0];
    const diff = touch.clientY - dragStartRef.current;
    if (diff > 0) {
      setDragY(diff);
    }
  };

  const handleSheetTouchEnd = () => {
    if (!isDragging) return;
    const threshold = 80; // px până când considerăm swipe de închidere
    if (dragY > threshold) {
      setIsDragging(false);
      setDragY(0);
      clearSelection();
    } else {
      setIsDragging(false);
      setDragY(0);
    }
    dragStartRef.current = null;
  };

  const isGroupedView = groupByUser;

  // handler comun de ștergere, folosit și în header
  const deleteThread = async (threadId) => {
    if (!threadId) return;
    if (!window.confirm("Sigur vrei să ștergi această conversație?")) return;
    try {
      await api(`/api/inbox/threads/${threadId}`, {
        method: "DELETE",
      });
      setThreads((items) => items.filter((it) => it.id !== threadId));
      if (selectedId === threadId) {
        clearSelection();
      }
    } catch (err) {
      console.error("Eroare la ștergere conversație", err);
    }
  };

  return (
    <>
      <div
        className={styles.wrap}
        data-mobile-open={hasCurrent ? "1" : "0"}
      >
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
              placeholder="Caută nume, telefon, mesaj…"
            />
            <button
              className={`${styles.iconBtn} ${
                filtersOpen ? styles.active : ""
              }`}
              title="Filtre"
              type="button"
              onClick={() => setFiltersOpen((o) => !o)}
            >
              <Filter size={16} />
            </button>
          </div>

          {filtersOpen && (
            <div className={styles.filterPanel}>
              <div className={styles.filterRow}>
                <label>Status lead</label>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                >
                  <option value="all">Toate</option>
                  <option value="nou">Nou</option>
                  <option value="in_discutii">În discuții</option>
                  <option value="oferta_trimisa">Ofertă trimisă</option>
                  <option value="rezervat">Rezervat</option>
                  <option value="pierdut">Pierdut</option>
                </select>
              </div>
              <div className={styles.filterRow}>
                <label>Tip eveniment</label>
                <select
                  value={typeFilter}
                  onChange={(e) => setTypeFilter(e.target.value)}
                >
                  <option value="all">Toate</option>
                  <option value="nunta">Nuntă</option>
                  <option value="botez">Botez</option>
                  <option value="corporate">Corporate</option>
                  <option value="petrecere">Petrecere privată</option>
                </select>
              </div>
              <div className={styles.filterRow}>
                <label>Perioadă</label>
                <select
                  value={periodFilter}
                  onChange={(e) => setPeriodFilter(e.target.value)}
                >
                  <option value="all">Oricând</option>
                  <option value="next_30">
                    Evenimente în următoarele 30 zile
                  </option>
                  <option value="past">Evenimente trecute</option>
                </select>
              </div>
            </div>
          )}

          {/* 🔀 Toggle grupare pe client */}
          <div className={styles.groupToggleRow}>
            <label className={styles.groupToggle}>
              <input
                type="checkbox"
                checked={groupByUser}
                onChange={(e) => {
                  const checked = e.target.checked;
                  setGroupByUser(checked);
                  setSelectedId(null);
                  setActiveThreadId(null);
                  const sp = new URLSearchParams(searchParams);
                  sp.delete("threadId");
                  setSearchParams(sp, { replace: true });
                }}
              />
              Grupare conversații pe client
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
              const isSelected = t.id === selectedId;
              const hasUnread = (t.unreadCount || 0) > 0;

              const name = t.name || "Vizitator";
              const lastMsg = t.lastMsg || "Fără mesaje recente";

              // mod grupat: afișăm doar userul + nr comenzi
              const isUserGroup = isGroupedView && Array.isArray(t.threads);

              return (
                // 🔧 FIX: container-ul nu mai e <button>, ci <div role="button">
                <div
                  key={t.id}
                  role="button"
                  tabIndex={0}
                  className={`${styles.threadItem} ${
                    isSelected ? styles.selected : ""
                  } ${hasUnread ? styles.unread : ""}`}
                  onClick={() => selectThread(t.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      selectThread(t.id);
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
                        {/* ✅ Afișăm numărul comenzii DOAR când nu e grupare pe user */}
                        {!isGroupedView &&
                          t.orderSummary &&
                          shortOrderId(t.orderSummary) && (
                            <span className={styles.threadOrderBadge}>
                              {" · "}Comanda {shortOrderId(t.orderSummary)}
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
                        {isUserGroup ? (
                          <>
                            {t.orderCount ? (
                              <span className={styles.threadStatus}>
                                {t.orderCount} comenzi
                              </span>
                            ) : null}
                          </>
                        ) : (
                          <>
                            {t.status && (
                              <span className={styles.threadStatus}>
                                {t.status}
                              </span>
                            )}
                            {t.followUpAt && (
                              <span className={styles.threadFollowUp}>
                                <Clock size={10} />{" "}
                                {fmtDate(t.followUpAt)}
                              </span>
                            )}
                          </>
                        )}

                        {/* 🔹 Acțiuni inline (doar desktop, pe mobil ascunse în CSS) */}
                        <span className={styles.threadInlineActions}>
                          <button
                            type="button"
                            className={styles.threadIconBtn}
                            title={
                              t.archived
                                ? "Dezarhivează conversația"
                                : "Arhivează conversația"
                            }
                            onClick={async (e) => {
                              e.stopPropagation();
                              try {
                                await api(
                                  `/api/inbox/threads/${t.id}/archive`,
                                  {
                                    method: "PATCH",
                                    body: { archived: !t.archived },
                                  }
                                );
                                setThreads((items) =>
                                  items.map((it) =>
                                    it.id === t.id
                                      ? { ...it, archived: !t.archived }
                                      : it
                                  )
                                );
                              } catch (err) {
                                console.error(
                                  "Eroare la (de)arhivare",
                                  err
                                );
                              }
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
                              deleteThread(t.id);
                            }}
                          >
                            <Trash2 size={14} />
                          </button>
                        </span>

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

        {/* Chat (desktop normal, mobil bottom-sheet) */}
        <section
          className={styles.chat}
          style={
            isDragging
              ? {
                  transform: `translateY(${dragY}px)`,
                  transition: "none",
                }
              : undefined
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
                {/* Back doar pe desktop */}
                <button
                  className={`${styles.iconBtn} ${styles.hideMobile}`}
                  onClick={clearSelection}
                  title="Înapoi la listă"
                  type="button"
                >
                  <ChevronLeft size={18} />
                </button>

                <div className={styles.chatPeer}>
                  <div className={styles.avatarLg}>
                    {initialsOf(current.name || "U")}
                  </div>
                  <div>
                    <div className={styles.peerName}>
                      {current.name || "Vizitator"}
                      {/* în mod user-group nu mai afișăm id comanda aici */}
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
                      {isGroupedView && current.orderCount ? (
                        <>
                          {" · "}
                          {current.orderCount} comenzi de la acest client
                        </>
                      ) : null}
                    </div>

                    <div className={styles.peerMetaRow}>
                      {activeThread.eventDate && (
                        <span className={styles.chip}>
                          <Calendar size={12} />{" "}
                          {fmtDate(activeThread.eventDate)}
                        </span>
                      )}
                      {activeThread.eventType && (
                        <span className={styles.chip}>
                          {activeThread.eventType}
                        </span>
                      )}
                      {activeThread.eventLocation && (
                        <span className={styles.chip}>
                          <MapPin size={12} />{" "}
                          {activeThread.eventLocation}
                        </span>
                      )}
                    </div>

                    <div className={styles.peerMetaRow}>
                      {(activeThread.budgetMin ||
                        activeThread.budgetMax) && (
                        <span className={styles.chip}>
                          Buget:{" "}
                          {activeThread.budgetMin
                            ? `${activeThread.budgetMin}€`
                            : "?"}{" "}
                          -{" "}
                          {activeThread.budgetMax
                            ? `${activeThread.budgetMax}€`
                            : "?"}
                        </span>
                      )}
                      {currentThreadId && (
                        <StatusSelect
                          value={activeThread.status || "nou"}
                          onChange={async (value) => {
                            try {
                              await api(
                                `/api/inbox/threads/${currentThreadId}/meta`,
                                {
                                  method: "PATCH",
                                  body: { status: value },
                                }
                              );
                              setThreads((items) =>
                                items.map((t) => {
                                  if (!isGroupedView) {
                                    if (t.id === currentThreadId) {
                                      return { ...t, status: value };
                                    }
                                    return t;
                                  }
                                  if (t.id !== current.id) return t;
                                  return {
                                    ...t,
                                    threads: (t.threads || []).map(
                                      (th) =>
                                        th.threadId === currentThreadId
                                          ? { ...th, status: value }
                                          : th
                                    ),
                                  };
                                })
                              );
                            } catch (e) {
                              console.error(
                                "Eroare la actualizarea statusului",
                                e
                              );
                            }
                          }}
                        />
                      )}
                    </div>
                  </div>
                </div>

                <div className={styles.chatActions}>
                  {/* Navigare între conversații pe mobil */}
                  <div
                    className={`${styles.navSwitch} ${styles.hideDesktop}`}
                  >
                    <button
                      className={styles.iconBtn}
                      type="button"
                      disabled={!prevThread}
                      title="Conversația anterioară"
                      onClick={() => {
                        if (prevThread) selectThread(prevThread.id);
                      }}
                    >
                      <ChevronLeft size={16} />
                    </button>
                    <button
                      className={styles.iconBtn}
                      type="button"
                      disabled={!nextThread}
                      title="Conversația următoare"
                      onClick={() => {
                        if (nextThread) selectThread(nextThread.id);
                      }}
                    >
                      <ChevronRight size={16} />
                    </button>
                  </div>

                  {currentThreadId && (
                    <FollowUpControl
                      thread={activeThread}
                      onChange={async (followUpAt) => {
                        try {
                          await api(
                            `/api/inbox/threads/${currentThreadId}/meta`,
                            {
                              method: "PATCH",
                              body: { followUpAt },
                            }
                          );
                          setThreads((items) =>
                            items.map((t) => {
                              if (!isGroupedView) {
                                if (t.id === currentThreadId) {
                                  return { ...t, followUpAt };
                                }
                                return t;
                              }
                              if (t.id !== current.id) return t;
                              return {
                                ...t,
                                threads: (t.threads || []).map((th) =>
                                  th.threadId === currentThreadId
                                    ? { ...th, followUpAt }
                                    : th
                                ),
                              };
                            })
                          );
                        } catch (e) {
                          console.error(
                            "Eroare la actualizarea follow-up-ului",
                            e
                          );
                        }
                      }}
                    />
                  )}

                  {/* Buton arhivare / dezarhivare (vizibil și pe mobil) */}
                  <button
                    className={styles.iconBtn}
                    title={
                      activeThread.archived
                        ? "Dezarhivează"
                        : "Arhivează"
                    }
                    onClick={async () => {
                      if (!currentThreadId) return;
                      try {
                        await api(
                          `/api/inbox/threads/${currentThreadId}/archive`,
                          {
                            method: "PATCH",
                            body: {
                              archived: !activeThread.archived,
                            },
                          }
                        );
                        await reloadThreads();
                      } catch (e) {
                        console.error("Eroare la arhivare", e);
                      }
                    }}
                    type="button"
                  >
                    <Archive size={18} />
                  </button>

                  {/* Buton ștergere conversație – și pe mobil, dar doar în conversație */}
                  <button
                    className={styles.iconBtn}
                    title="Șterge conversația"
                    onClick={() => deleteThread(currentThreadId)}
                    type="button"
                  >
                    <Trash2 size={18} />
                  </button>
                </div>
              </header>

              {/* 🔀 Tab-uri comenzi în mod grupat */}
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
                          {th.eventDate && (
                            <span className={styles.orderTabDate}>
                              {fmtDate(th.eventDate)}
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

              <div className={styles.internalNote}>
                <label>
                  <TagIcon size={14} /> Notă internă (invitatul nu o vede)
                </label>
                <textarea
                  className={styles.noteInput}
                  rows={2}
                  placeholder="Ex: client foarte hotărât, a mai lucrat cu noi în 2022, îi place X stil…"
                  value={internalNote}
                  onChange={(e) => setInternalNote(e.target.value)}
                  onBlur={handleSaveNote}
                />
              </div>

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
                <div className={styles.composerLeft}>
                  <button
                    className={styles.iconBtn}
                    title="Atașează fișiere"
                    type="button"
                    onClick={handleAttachClick}
                  >
                    <Paperclip size={18} />
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    className={styles.hiddenFileInput}
                    onChange={handleFilesChange}
                  />

                  <div className={styles.templatesWrap}>
                    <button
                      className={styles.iconBtn}
                      type="button"
                      title="Șabloane de răspuns"
                      onClick={() =>
                        setTemplatesOpen((open) => !open)
                      }
                    >
                      <FileText size={18} />
                      <ChevronDown size={14} />
                    </button>
                    {templatesOpen && (
                      <div className={styles.templatesMenu}>
                        {TEMPLATES.map((t) => (
                          <button
                            key={t.id}
                            type="button"
                            onClick={() => {
                              setText((prev) =>
                                prev ? `${prev}\n${t.text}` : t.text
                              );
                              setTemplatesOpen(false);
                            }}
                          >
                            {t.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

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
                  disabled={
                    !text.trim() ||
                    sending ||
                    uploading ||
                    !currentThreadId
                  }
                  type="button"
                >
                  {sending ? (
                    <>
                      <Loader2
                        size={16}
                        className={styles.spin}
                      />{" "}
                      Se trimite…
                    </>
                  ) : uploading ? (
                    <>
                      <Loader2
                        size={16}
                        className={styles.spin}
                      />{" "}
                      Încarc atașamente…
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

      {/* Backdrop full-screen peste TOT (inclusiv navbar) pe mobil */}
      {hasCurrent && (
        <div
          className={styles.mobileBackdrop}
          onClick={clearSelection}
        />
      )}
    </>
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
          {initialsOf(msg.authorName || "U")}
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

        {msg.attachments?.length > 0 && (
          <div className={styles.attachments}>
            {msg.attachments.map((att) => (
              <a
                key={att.id || att.url}
                href={att.url}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.attachmentItem}
              >
                <Paperclip size={12} />
                <span>{att.name || "Fișier"}</span>
              </a>
            ))}
          </div>
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

function StatusSelect({ value, onChange }) {
  return (
    <span className={styles.statusSelectWrap}>
      <span className={styles.statusLabel}>Status lead:</span>
      <select
        className={styles.statusSelect}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="nou">Nou</option>
        <option value="in_discutii">În discuții</option>
        <option value="oferta_trimisa">Ofertă trimisă</option>
        <option value="rezervat">Rezervat</option>
        <option value="pierdut">Pierdut</option>
      </select>
    </span>
  );
}

function FollowUpControl({ thread, onChange }) {
  const label = thread?.followUpAt
    ? `Follow-up: ${fmtDate(thread.followUpAt)}`
    : "Setează follow-up";

  const handleSelect = (value) => {
    if (value === "none") {
      onChange(null);
      return;
    }
    const base = new Date();
    if (value === "tomorrow") base.setDate(base.getDate() + 1);
    if (value === "3days") base.setDate(base.getDate() + 3);
    if (value === "week") base.setDate(base.getDate() + 7);
    const iso = base.toISOString();
    onChange(iso);
  };

  return (
    <div className={styles.followUp}>
      <Clock size={14} />
      <select
        className={styles.followUpSelect}
        value="placeholder"
        onChange={(e) => {
          const v = e.target.value;
          e.target.value = "placeholder";
          handleSelect(v);
        }}
      >
        <option value="placeholder" disabled>
          {label}
        </option>
        <option value="tomorrow">Mâine</option>
        <option value="3days">În 3 zile</option>
        <option value="week">Peste o săptămână</option>
        <option value="none">Șterge follow-up</option>
      </select>
    </div>
  );
}
