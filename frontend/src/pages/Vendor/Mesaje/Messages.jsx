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
  Pencil,
  X,
  Download,
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
     const d = await api(url); // fără .catch(() => null)
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
      const d = await api(`/api/inbox/threads/${threadId}/messages`);

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
const [chatBlocked, setChatBlocked] = useState(null);

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

  const currentThreadId = activeThread?.threadId || activeThread?.id || null;

useEffect(() => {
  setChatBlocked(null);
}, [currentThreadId]);
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
function normalizeChatError(err) {
  const status = err?.status || err?.response?.status;

  const data =
    err?.data ||
    err?.response?.data ||
    err?.body ||
    null;

  const code =
    data?.error ||
    data?.code ||
    (status === 500 ? "SERVER_ERROR" : null) ||
    (status === 402 ? "PAYMENT_REQUIRED" : null) ||
    "UNKNOWN_ERROR";

  const message =
    code === "CHAT_LIMIT_REACHED"
      ? `Ai atins limita de mesaje pentru luna curentă (${data?.used ?? "?"}/${data?.limit ?? "?"}).`
      : code === "subscription_required"
      ? "Ai nevoie de un abonament activ pentru a folosi chat-ul."
      : code === "CHAT_ATTACHMENTS_NOT_ALLOWED"
      ? "Planul tău nu permite atașamente."
      : code === "CHAT_ADVANCED_NOT_ALLOWED"
      ? "Planul tău nu permite această funcție."
      : code === "SERVER_ERROR"
      ? "Ups… avem o problemă tehnică. Te rog încearcă din nou în câteva secunde."
      : // dacă backend trimite message, îl folosim
        data?.message ||
        "Nu am putut trimite mesajul.";

  const shouldBlock =
    status === 402 ||
    code === "CHAT_LIMIT_REACHED" ||
    code === "subscription_required" ||
    code === "CHAT_NOT_ALLOWED";

  return { status, code, message, details: data, shouldBlock };
}

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
setSending(true);

try {
  await api(`/api/inbox/threads/${currentThreadId}/messages`, {
    method: "POST",
    body: { body: content },
  });

  // ✅ golim input doar după succes
  setText("");

  await reloadMsgs();
  await reloadThreads();
} catch (err) {
  const info = normalizeChatError(err);

  setMsgs((m) =>
    m.map((x) =>
      x.id === optimistic.id ? { ...x, failed: true, pending: false } : x
    )
  );

  // ✅ punem textul înapoi ca user-ul să nu-l piardă
  setText(content);

  if (info.shouldBlock) setChatBlocked(info);
  else alert(info.message);
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
      ? visibleThreads[currentIndex + 1]
      : null;

  const handleAttachClick = () => {
    if (!fileInputRef.current) return;
    fileInputRef.current.click();
  };

async function handleFilesChange(e) {
  const files = Array.from(e.target.files || []);
  if (!files.length || !currentThreadId) return;

  const filesToUpload = [...files]; // copie
  setUploading(true);

  try {
    const fd = new FormData();
    filesToUpload.forEach((f) => fd.append("files", f));

    const token =
      localStorage.getItem("token") ||
      localStorage.getItem("accessToken") ||
      sessionStorage.getItem("token") ||
      sessionStorage.getItem("accessToken");

    const resp = await fetch(`/api/inbox/threads/${currentThreadId}/attachments`, {
      method: "POST",
      body: fd,
      credentials: "include",
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });

    const data = await resp.json().catch(() => null);

    if (!resp.ok) {
      const err = { status: resp.status, data };
      const info = normalizeChatError(err);
      if (info.shouldBlock) setChatBlocked(info);
      else alert(info.message);
      return;
    }

    await reloadMsgs();
    await reloadThreads();
  } catch (err) {
    const info = normalizeChatError(err);
    if (info.shouldBlock) setChatBlocked(info);
    else alert(info.message);
  } finally {
    setUploading(false);
    e.target.value = "";
  }
}

  async function handleSaveNote() {
    if (!currentThreadId) return;
    try {
      await api(`/api/inbox/threads/${currentThreadId}/meta-advanced`, {
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
     const info = normalizeChatError(e);
 if (info.code === "CHAT_ADVANCED_NOT_ALLOWED") setChatBlocked(info);
  else console.error("Eroare la salvarea notei interne", e);
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

  const deleteThread = async (threadId) => {
  if (!threadId) return;
  if (!window.confirm("Sigur vrei să ștergi această conversație?")) return;

  try {
    await api(`/api/inbox/threads/${threadId}`, { method: "DELETE" });

    setThreads((items) =>
      items
        .map((t) => {
          // mod normal: thread direct
          if (!Array.isArray(t.threads)) {
            return t.id === threadId ? null : t;
          }

          // mod groupByUser: scoatem thread-ul din grup
          const remaining = (t.threads || []).filter((th) => th.threadId !== threadId);
          if (!remaining.length) return null;

          // recalculăm sumarul grupului (primary = cel mai recent)
          const sorted = remaining.slice().sort((a, b) => (+b.lastAt || 0) - (+a.lastAt || 0));
          const primary = sorted[0];

          const totalUnread = sorted.reduce((s, x) => s + (x.unreadCount || 0), 0);

          return {
            ...t,
            lastAt: primary.lastAt,
            lastMsg: primary.lastMsg,
            archived: primary.archived,
            unreadCount: totalUnread,
            orderCount: remaining.length,
            threads: remaining,
          };
        })
        .filter(Boolean)
    );

    // dacă ștergeai thread-ul activ, curățăm selecția
    if (currentThreadId === threadId) clearSelection();

    await reloadThreads();
  } catch (err) {
    console.error("Eroare la ștergere conversație", err);
  }
};

  // ✅ Edit mesaj (presupune PATCH /api/inbox/messages/:messageId)
  async function editMessage(messageId, newBody) {
    if (!messageId) return;
    try {
      await api(`/api/inbox/threads/${currentThreadId}/messages/${messageId}`, {
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

  // ✅ Șterge mesaj (presupune DELETE /api/inbox/messages/:messageId)
  async function deleteMessage(messageId) {
    if (!messageId) return;
    if (!window.confirm("Ștergi acest mesaj?")) return;
    try {
     await api(`/api/inbox/threads/${currentThreadId}/messages/${messageId}`, {
  method: "DELETE",
});
      await reloadMsgs();
      await reloadThreads();
    } catch (e) {
      console.error("Eroare la ștergere mesaj", e);
      alert("Nu am putut șterge mesajul.");
    }
  }

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
                             await api(`/api/inbox/threads/${currentThreadId}/meta-advanced`, {
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
                              const info = normalizeChatError(e);
  if (info.code === "CHAT_ADVANCED_NOT_ALLOWED") setChatBlocked(info);
  else console.error("Eroare la actualizarea statusului", e);
                            }
                          }}
                          disabled={chatBlocked?.code === "CHAT_ADVANCED_NOT_ALLOWED"}
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
                          await api(`/api/inbox/threads/${currentThreadId}/meta-advanced`, {
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
                          const info = normalizeChatError(e);
 if (info.code === "CHAT_ADVANCED_NOT_ALLOWED") setChatBlocked(info);
  else console.error("Eroare la actualizarea follow-up-ului", e);
                        }
                      }}
                      disabled={chatBlocked?.code === "CHAT_ADVANCED_NOT_ALLOWED"}
                    />
                  )}

                  {/* Buton arhivare / dezarhivare */}
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

                  {/* Buton ștergere conversație */}
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
  placeholder={
   chatBlocked?.code === "CHAT_ADVANCED_NOT_ALLOWED"
     ? "Disponibil doar pe planul Advanced."
     : "Ex: client foarte hotărât..."
  }
  value={internalNote}
  onChange={(e) => setInternalNote(e.target.value)}
  onBlur={handleSaveNote}
disabled={chatBlocked?.code === "CHAT_ADVANCED_NOT_ALLOWED"}
/>
{chatBlocked && (
  <div className={styles.chatBlockedBanner}>
    <strong>{chatBlocked.message}</strong>
    <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
      <button
        type="button"
        className={styles.smallBtn}
        onClick={() => setChatBlocked(null)}
      >
        Am înțeles
      </button>

      {/* dacă backend trimite upgradeUrl în payload, folosește-l */}
      {chatBlocked?.details?.upgradeUrl && (
        <a className={styles.smallBtnPrimary} href={chatBlocked.details.upgradeUrl}>
          Upgrade
        </a>
      )}
    </div>
  </div>
)}
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
                    onEdit={(body) => editMessage(m.id, body)}
                    onDelete={() => deleteMessage(m.id)}
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
  disabled={uploading || sending || !currentThreadId || !!chatBlocked || activeThread?.archived}
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
  placeholder={
    chatBlocked
      ? chatBlocked.message
      : activeThread?.archived
      ? "Conversație arhivată — dezarhivează ca să poți răspunde."
      : "Scrie un mesaj…"
  }
  value={text}
  onChange={(e) => {
    setText(e.target.value);
    autoResize(e.target);
  }}
  onKeyDown={handleKey}
  disabled={!!chatBlocked || activeThread?.archived}
  
/>

               <button
  className={styles.sendBtn}
  onClick={handleSend}
  disabled={
    !text.trim() ||
    sending ||
    uploading ||
    !currentThreadId ||
    !!chatBlocked ||
    activeThread?.archived
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

function MessageBubble({ mine, msg, onEdit, onDelete }) {
  const isPending = msg.pending;
  const isFailed = msg.failed;
  const readByPeer = !!msg.readByPeer;

  const [isEditing, setIsEditing] = useState(false);
  const [text, setText] = useState(msg.body || "");

  const hasAttachments = (msg.attachments?.length || 0) > 0;

  // ✅ long-press actions (mobile)
  const [showActions, setShowActions] = useState(false);
  const pressTimerRef = useRef(null);

  const isTouchDevice =
    typeof window !== "undefined" &&
    window.matchMedia &&
    window.matchMedia("(pointer: coarse)").matches;

  const LONG_PRESS_MS = 320;

const startPress = () => {
  if (!isTouchDevice) return;          // doar pe mobil / touch
  if (isPending) return;              // nu pentru pending
  if (isEditing) return;              // nu când editezi

  // ✅ mutat AICI (în cadrul touchstart = user gesture)
  if (navigator?.vibrate) navigator.vibrate(10);

  clearTimeout(pressTimerRef.current);
  pressTimerRef.current = setTimeout(() => {
    setShowActions(true);
  }, LONG_PRESS_MS);
};

  const cancelPress = () => {
    clearTimeout(pressTimerRef.current);
    pressTimerRef.current = null;
  };

  // dacă se schimbă mesajul / intră în edit, închidem actions
  useEffect(() => {
    setShowActions(false);
  }, [msg.id, isEditing]);

  useEffect(() => {
    setText(msg.body || "");
  }, [msg.body]);

  const handleDownload = async () => {
    try {
      const att = msg.attachments?.[0];
      if (!att) return;

      const url = att?.id
        ? `/api/inbox/attachments/${att.id}/download`
        : att?.url;

      await forceDownload(url, att?.name || "atasament");
    } catch (e) {
      console.error(e);
      alert("Nu am putut descărca atașamentul.");
    }
  };

  function shouldRenderBody(msg) {
    const b = (msg?.body || "").trim();
    if (!b) return false;
    if (msg?.attachments?.length) {
      if (b === "📎 Atașament") return false;
      if (/^📎\s+\d+\s+atașamente$/i.test(b)) return false;
      if (/^📎\s+.+/.test(b) && msg.attachments.length === 1) return false;
    }
    return true;
  }

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
    tickClass = readByPeer
      ? `${styles.readTick} ${styles.readTickRead}`
      : styles.readTick;
  }

  async function save() {
    const v = (text || "").trim();
    if (!v) return;
    await onEdit?.(v);
    setIsEditing(false);
  }

  const canShowActions = !isPending && (hasAttachments || mine);

  return (
    <>
      {/* ✅ backdrop doar când actions sunt deschise pe mobil */}
      {showActions && isTouchDevice && (
        <button
          type="button"
          className={styles.msgActionsBackdrop}
          onClick={() => setShowActions(false)}
          aria-label="Închide acțiuni mesaj"
        />
      )}

      <div className={`${styles.bubbleRow} ${mine ? styles.right : styles.left}`}>
        {!mine && (
          <div className={styles.avatarSm}>
            {initialsOf(msg.authorName || "U")}
          </div>
        )}

        <div
          className={`${styles.bubbleWrap} ${
            showActions ? styles.bubbleWrapActive : ""
          }`}
          onTouchStart={startPress}
          onTouchEnd={cancelPress}
          onTouchMove={cancelPress}
          onTouchCancel={cancelPress}
          onContextMenu={(e) => {
            // ținut apăsat pe Android poate deschide context menu
            if (isTouchDevice) {
              e.preventDefault();
              if (canShowActions) setShowActions(true);
            }
          }}
        >
          <div className={`${styles.bubble} ${mine ? styles.mine : styles.theirs}`}>
            {isEditing ? (
              <textarea
                className={styles.editInput}
                rows={2}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    save();
                  }
                  if (e.key === "Escape") {
                    e.preventDefault();
                    setIsEditing(false);
                    setText(msg.body || "");
                  }
                }}
              />
            ) : (
              <>
                {shouldRenderBody(msg) && (
                  <div className={styles.bodyText}>{msg.body}</div>
                )}

                {msg.attachments?.length > 0 && (
                  <AttachmentList attachments={msg.attachments} mine={mine} />
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
              {isPending && <span>· în curs…</span>}
              {isFailed && <span>· nereușit</span>}
            </div>
          </div>

          {/* ✅ Acțiuni:
              - Desktop: apar la hover (CSS)
              - Mobil: apar doar când showActions = true
          */}
          {canShowActions && (
            <div
              className={`${styles.msgActions} ${
                showActions ? styles.msgActionsOpen : ""
              }`}
            >
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
                      <Download size={16} />
                    </button>
                  )}

                  {mine && (
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
                        <Pencil size={16} />
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
                        <Trash2 size={16} />
                      </button>
                    </>
                  )}
                </>
              ) : (
                mine && (
                  <>
                    <button
                      type="button"
                      className={styles.msgSaveBtn}
                      onClick={save}
                    >
                      Salvează
                    </button>
                    <button
                      type="button"
                      className={styles.msgIconBtn}
                      title="Renunță"
                      onClick={() => {
                        setIsEditing(false);
                        setText(msg.body || "");
                      }}
                    >
                      <X size={16} />
                    </button>
                  </>
                )
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function AttachmentList({ attachments = [], mine }) {
  const images = attachments.filter((a) => (a.mime || "").startsWith("image/"));
  const files = attachments.filter((a) => !((a.mime || "").startsWith("image/")));

  return (
    <div className={styles.attWrap} data-mine={mine ? "1" : "0"}>
      {images.length > 0 && (
        <div className={styles.attGrid}>
          {images.map((att) => {
            // ✅ PREVIEW: direct URL public (se deschide în browser)
            const previewHref = att?.url;

            return (
              <a
                key={att.id || att.url}
                href={previewHref}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.attThumb}
                title={att.name || "Imagine"}
                onClick={(e) => {
                  if (!previewHref) e.preventDefault();
                }}
              >
                <img
                  src={att.url}
                  alt={att.name || "Imagine"}
                  loading="lazy"
                />
              </a>
            );
          })}
        </div>
      )}

      {files.length > 0 && (
        <div className={styles.attFiles}>
          {files.map((att) => {
            // ✅ PREVIEW: direct URL public (PDF se vede în browser, DOC etc depinde de browser)
            const previewHref = att?.url;

            return (
              <a
                key={att.id || att.url}
                href={previewHref}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.attFileCard}
                title={att.name || "Fișier"}
                onClick={(e) => {
                  if (!previewHref) e.preventDefault();
                }}
              >
                <div className={styles.attFileIcon}>
                  <Paperclip size={14} />
                </div>

                <div className={styles.attFileMeta}>
                  <div className={styles.attFileName}>{att.name || "Fișier"}</div>
                  <div className={styles.attFileSub}>
                    {att.mime ? att.mime : "document"}{" "}
                    {att.size ? `· ${prettyBytes(att.size)}` : ""}
                  </div>
                </div>
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}

function prettyBytes(bytes) {
  const b = Number(bytes || 0);
  if (!Number.isFinite(b) || b <= 0) return "";
  const units = ["B", "KB", "MB", "GB"];
  let v = b;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}
async function forceDownload(url, filename = "atasament") {
  if (!url) return;

  const res = await fetch(url, {
    method: "GET",
    credentials: "include", // ok pentru cookie auth; nu schimbă nimic în rest
  });

  if (!res.ok) throw new Error(`Download failed: ${res.status}`);

  const blob = await res.blob();
  const blobUrl = window.URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = blobUrl;
  a.download = filename || "atasament";
  document.body.appendChild(a);
  a.click();
  a.remove();

  window.URL.revokeObjectURL(blobUrl);
}

function StatusSelect({ value, onChange, disabled }) {
  return (
    <span className={styles.statusSelectWrap}>
      <span className={styles.statusLabel}>Status lead:</span>
      <select
        className={styles.statusSelect}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
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

function FollowUpControl({ thread, onChange, disabled }) {
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
        disabled={disabled}
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
