// frontend/src/pages/user/UserMessagesPage.jsx
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../../../lib/api";
import {
  acceptQuoteOffer,
  rejectQuoteOffer,
  validateQuoteOfferDiscountCode,
} from "../../../components/AIAssistant/quotes/quoteApi.js";
import {
  MessageSquare,
  Send,
  Search as SearchIcon,
  Loader2,
  Archive,
  Inbox,
  Pencil,
  Paperclip,
  ChevronLeft,
  Trash2,
  X,
} from "lucide-react";
import styles from "./UserMessages.module.css";
import { useMessageThreads } from "../../../features/messages/hooks/useMessageThreads";
import { useThreadMessages } from "../../../features/messages/hooks/useThreadMessages";
import { useMessageSend } from "../../../features/messages/hooks/useMessageSend";
import MessageBubble from "../../../features/messages/components/MessageBubble";
import {
  nowIso,
  fmtTime,
  fmtDate,
  initialsOf,
  autoResize,
  formatBytes,
} from "../../../features/messages/utils/messageFormatters";

const API_BASE = "/api/user-inbox";

/* ========= Utils specifice User ========= */
function shortOrderId(orderSummary) {
  if (!orderSummary) return null;
  const baseId = orderSummary.id;
  if (!baseId) return null;
  return String(baseId).slice(-6).toUpperCase();
}

/* ========= Pagina ========= */
export default function UserMessagesPage() {
  const [searchParams] = useSearchParams();
  const threadIdFromUrl = searchParams.get("threadId") || searchParams.get("thread") || null;

  const [scope, setScope] = useState("all"); // all | unread | archived
  const [q, setQ] = useState("");
  const [groupByStore, setGroupByStore] = useState(false);

  const buildThreadsUrl = useCallback(
    (dq) => {
      const params = new URLSearchParams();
      params.set("scope", scope || "all");
      if (dq) params.set("q", dq);
      if (groupByStore) params.set("groupBy", "store");
      return `${API_BASE}/threads?${params.toString()}`;
    },
    [scope, groupByStore]
  );

  const {
    loading: loadingThreads,
    items: threads,
    error: errThreads,
    reload: reloadThreads,
    setItems: setThreads,
  } = useMessageThreads({ q, buildUrl: buildThreadsUrl });

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

  const buildMessagesEndpoint = useCallback((id) => `${API_BASE}/threads/${id}`, []);

  const {
    loading: loadingMsgs,
    loadingOlder,
    hasMoreOlder,
    msgs,
    error: errMsgs,
    setMsgs,
    reload: reloadMsgs,
    loadOlder,
    threadMeta,
    quoteRequest,
  } = useThreadMessages(currentThreadId, { buildEndpoint: buildMessagesEndpoint });

  void threadMeta;

  const listRef = useRef(null);

  /*
   * ETAPA 1 (audit Mesaje, #1 HIGH) - auto-scroll DOAR când: thread-ul
   * tocmai s-a deschis, userul era deja aproape de bottom, sau userul
   * tocmai a trimis propriul mesaj. Altfel (userul a scrolat în sus
   * să citească istoric), poll-ul de 8s (neschimbat) nu-l mai trage
   * înapoi jos.
   */
  const nearBottomRef = useRef(true);
  const prevThreadIdRef = useRef(null);
  const justSentRef = useRef(false);

  /*
   * ETAPA 4 (paginare thread + load older) - trigger de "load older" la
   * scroll aproape de top. Refs (nu state) pentru hasMoreOlder/loadingOlder
   * ca handleScroll să nu citească valori stale - closure-ul e creat o
   * dată per thread (effect-ul depinde de currentThreadId), dar aceste
   * două flag-uri se schimbă des în timp ce threadul rămâne același.
   */
  const hasMoreOlderRef = useRef(false);
  const isLoadingOlderRef = useRef(false);

  useEffect(() => {
    hasMoreOlderRef.current = hasMoreOlder;
  }, [hasMoreOlder]);

  useEffect(() => {
    isLoadingOlderRef.current = loadingOlder;
  }, [loadingOlder]);

  const NEAR_BOTTOM_THRESHOLD = 80;
  const NEAR_TOP_THRESHOLD = 120;

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;

    function maybeLoadOlder() {
      if (!hasMoreOlderRef.current || isLoadingOlderRef.current) return;

      // Preservare poziție de scroll la prepend: capturăm înălțimea și
      // poziția ÎNAINTE, corectăm scrollTop DUPĂ ce DOM-ul s-a actualizat
      // (requestAnimationFrame garantează că React a comis re-randarea),
      // ca mesajele deja vizibile să rămână exact în același loc pe ecran.
      const prevScrollHeight = el.scrollHeight;
      const prevScrollTop = el.scrollTop;

      loadOlder().then((result) => {
        if (result?.appended > 0) {
          requestAnimationFrame(() => {
            const delta = el.scrollHeight - prevScrollHeight;
            el.scrollTop = prevScrollTop + delta;
          });
        }
      });
    }

    function handleScroll() {
      const distanceFromBottom =
        el.scrollHeight - el.scrollTop - el.clientHeight;

      nearBottomRef.current = distanceFromBottom < NEAR_BOTTOM_THRESHOLD;

      if (el.scrollTop < NEAR_TOP_THRESHOLD) {
        maybeLoadOlder();
      }
    }

    handleScroll();
    el.addEventListener("scroll", handleScroll, { passive: true });
    return () => el.removeEventListener("scroll", handleScroll);
  }, [currentThreadId, loadOlder]);

  useEffect(() => {
    if (!listRef.current) return;

    const threadJustOpened = prevThreadIdRef.current !== currentThreadId;
    prevThreadIdRef.current = currentThreadId;

    const shouldAutoScroll =
      threadJustOpened || nearBottomRef.current || justSentRef.current;

    justSentRef.current = false;

    if (shouldAutoScroll) {
      listRef.current.scrollTop = listRef.current.scrollHeight + 1000;
      nearBottomRef.current = true;
    }

    const ta = document.querySelector(`.${styles.input}`);
    if (ta) autoResize(ta);
  }, [msgs, currentThreadId, loadingMsgs]);

  const [text, setText] = useState("");

  const [quoteActionLoading, setQuoteActionLoading] = useState(false);
  const [quoteActionError, setQuoteActionError] = useState("");
  const [acceptOfferOpen, setAcceptOfferOpen] = useState(false);
  const [
  quoteDetailsOpen,
  setQuoteDetailsOpen,
] = useState(false);
  const [shippingForm, setShippingForm] = useState({
    recipientName: "",
    phone: "",
    addressLine1: "",
    city: "",
    county: "",
    postalCode: "",
  });

  const [wantsDiscountCode, setWantsDiscountCode] = useState(false);
  const [discountCodeInput, setDiscountCodeInput] = useState("");
  const [discountCodeApplied, setDiscountCodeApplied] = useState(null);
  const [discountCodeChecking, setDiscountCodeChecking] = useState(false);
  const [discountCodeError, setDiscountCodeError] = useState("");

 useEffect(() => {
  setAcceptOfferOpen(false);
  setQuoteDetailsOpen(false);
  setQuoteActionLoading(false);
  setQuoteActionError("");

  setShippingForm({
    recipientName: "",
    phone: "",
    addressLine1: "",
    city: "",
    county: "",
    postalCode: "",
  });
}, [currentThreadId]);

  const latestQuoteOffer = Array.isArray(quoteRequest?.offers)
    ? quoteRequest.offers[0] || null
    : null;

  const latestOfferStatus = String(latestQuoteOffer?.status || "")
    .trim()
    .toUpperCase();

  const quoteStatus = String(quoteRequest?.status || "")
    .trim()
    .toUpperCase();

  const canAnswerQuote =
    Boolean(quoteRequest?.id && latestQuoteOffer?.id) &&
    latestOfferStatus === "SENT" &&
    !quoteRequest?.orderId &&
    !["ACCEPTED", "REJECTED", "CANCELLED", "EXPIRED"].includes(quoteStatus);

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

  async function handleRejectQuoteOffer() {
    if (!quoteRequest?.id || !latestQuoteOffer?.id || quoteActionLoading) return;

    const confirmed = window.confirm(
      "Sigur vrei să refuzi definitiv această ofertă?"
    );
    if (!confirmed) return;

    setQuoteActionLoading(true);
    setQuoteActionError("");

    try {
      await rejectQuoteOffer(quoteRequest.id, latestQuoteOffer.id);
      setAcceptOfferOpen(false);
      setQuoteDetailsOpen(false);
      await reloadMsgs();
      await reloadThreads();
    } catch (error) {
      setQuoteActionError(
        error?.data?.message || error?.message || "Oferta nu a putut fi refuzată."
      );
    } finally {
      setQuoteActionLoading(false);
    }
  }

  function handleDiscountCodeInputChange(value) {
    setDiscountCodeInput(value);
    setDiscountCodeApplied(null);
    setDiscountCodeError("");
  }

  async function handleValidateDiscountCode() {
    if (!quoteRequest?.id || !latestQuoteOffer?.id) return;

    const code = String(discountCodeInput || "").trim();

    if (!code) {
      setDiscountCodeApplied(null);
      return setDiscountCodeError("Introdu un cod de reducere.");
    }

    setDiscountCodeChecking(true);
    setDiscountCodeError("");
    setDiscountCodeApplied(null);

    try {
      const result = await validateQuoteOfferDiscountCode(
        quoteRequest.id,
        latestQuoteOffer.id,
        code
      );

      setDiscountCodeApplied(result);
    } catch (error) {
      setDiscountCodeApplied(null);
      setDiscountCodeError(
        error?.data?.message ||
          error?.message ||
          "Codul de reducere nu este valid."
      );
    } finally {
      setDiscountCodeChecking(false);
    }
  }

  async function handleAcceptQuoteOffer(event) {
    event?.preventDefault?.();

    if (!quoteRequest?.id || !latestQuoteOffer?.id || quoteActionLoading) return;

    const recipientName = String(shippingForm.recipientName || "").trim();
    const phone = String(shippingForm.phone || "").trim();
    const addressLine1 = String(shippingForm.addressLine1 || "").trim();
    const city = String(shippingForm.city || "").trim();
    const county = String(shippingForm.county || "").trim();
    const postalCode = String(shippingForm.postalCode || "").trim();

    if (!recipientName) return setQuoteActionError("Introdu numele persoanei care va primi coletul.");
    if (!phone) return setQuoteActionError("Introdu numărul de telefon.");
    if (!addressLine1) return setQuoteActionError("Introdu adresa de livrare.");
    if (!city) return setQuoteActionError("Introdu localitatea.");
    if (!county) return setQuoteActionError("Introdu județul.");

    if (
      wantsDiscountCode &&
      String(discountCodeInput || "").trim() &&
      !discountCodeApplied?.valid
    ) {
      return setQuoteActionError(
        "Verifică codul de reducere înainte să confirmi comanda, sau renunță la el."
      );
    }

    setQuoteActionLoading(true);
    setQuoteActionError("");

    try {
      await acceptQuoteOffer(quoteRequest.id, latestQuoteOffer.id, {
        shippingAddress: {
          recipientName,
          phone,
          addressLine1,
          city,
          county,
          postalCode,
        },
        discountCode:
          wantsDiscountCode && discountCodeApplied?.valid
            ? String(discountCodeInput || "").trim()
            : undefined,
      });

      setAcceptOfferOpen(false);
      setQuoteDetailsOpen(false);
      await reloadMsgs();
      await reloadThreads();
      alert("Oferta a fost acceptată, iar comanda a fost înregistrată.");
    } catch (error) {
      setQuoteActionError(
        error?.data?.message || error?.message || "Comanda nu a putut fi înregistrată."
      );
    } finally {
      setQuoteActionLoading(false);
    }
  }

  /*
   * ETAPA 3 (refactor comun Mesaje) - nucleul de trimitere (gardă
   * double-submit, mesaj optimist, POST, marcare "failed", dispatch
   * messages:changed) e acum în useMessageSend. User golește
   * composer-ul IMEDIAT (optimist) și nu îl restaurează la eșec -
   * comportament păstrat exact prin onBeforeSend, fără onError.
   */
  const { sending, send, retryMessage } = useMessageSend({
    threadId: currentThreadId,
    buildEndpoint: buildMessagesEndpoint,
    setMsgs,
    onBeforeSend: () => {
      justSentRef.current = true;
      setText("");
    },
    onSuccess: async () => {
      await reloadMsgs();
      await reloadThreads();
    },
  });

  async function handleSend() {
    await send(text);
  }

  // ETAPA 6 - retry manual pe mesaj failed; onSuccess de mai sus e deja
  // sigur de reutilizat (nu atinge composer-ul), deci nu are nevoie de
  // onRetrySuccess separat.
  async function handleRetry(msg) {
    await retryMessage(msg);
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
  {loadingMsgs && (
    <div className={styles.loading}>
      Se încarcă…
    </div>
  )}

  {errMsgs && (
    <div className={styles.error}>
      Nu am putut încărca mesajele.
    </div>
  )}

  {loadingOlder && (
    <div className={styles.loading}>
      Se încarcă mesaje mai vechi…
    </div>
  )}


  {msgs.map((m) => (
    <MessageBubble
      key={m.id}
      mine={m.from === "me"}
      msg={m}
      styles={styles}
      actionIconSize={14}
      onEdit={(body) =>
        editMessage(
          m.id,
          body
        )
      }
      onDelete={() =>
        deleteMessage(
          m.id
        )
      }
      onRetry={handleRetry}
    />
  ))}

  {quoteRequest &&
  latestQuoteOffer && (
    <UserQuoteOfferPreview
      quoteRequest={
        quoteRequest
      }
      offer={
        latestQuoteOffer
      }
      onOpen={() => {
        setQuoteActionError("");
        setQuoteDetailsOpen(true);
      }}
    />
  )}
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
                          <span className={styles.attachChipSize}>{formatBytes(f.size)}</span>
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
{quoteDetailsOpen &&
  quoteRequest &&
  latestQuoteOffer && (
    <UserQuoteOfferModal
      quoteRequest={
        quoteRequest
      }
      offer={
        latestQuoteOffer
      }
      canAnswer={
        canAnswerQuote
      }
      acceptOpen={
        acceptOfferOpen
      }
      setAcceptOpen={
        setAcceptOfferOpen
      }
      shippingForm={
        shippingForm
      }
      setShippingForm={
        setShippingForm
      }
      loading={
        quoteActionLoading
      }
      error={
        quoteActionError
      }
      setError={
        setQuoteActionError
      }
      wantsDiscountCode={
        wantsDiscountCode
      }
      setWantsDiscountCode={
        setWantsDiscountCode
      }
      discountCodeInput={
        discountCodeInput
      }
      setDiscountCodeInput={
        handleDiscountCodeInputChange
      }
      discountCodeApplied={
        discountCodeApplied
      }
      discountCodeChecking={
        discountCodeChecking
      }
      discountCodeError={
        discountCodeError
      }
      onValidateDiscountCode={
        handleValidateDiscountCode
      }
      onAccept={
        handleAcceptQuoteOffer
      }
      onReject={
        handleRejectQuoteOffer
      }
      onClose={() => {
        if (
          quoteActionLoading
        ) {
          return;
        }

        setQuoteActionError("");
        setAcceptOfferOpen(false);
        setWantsDiscountCode(false);
        setDiscountCodeInput("");
        setDiscountCodeApplied(null);
        setDiscountCodeError("");
        setQuoteDetailsOpen(false);
      }}
    />
  )}
      {hasCurrent && <div className={styles.mobileBackdrop} onClick={clearSelection} />}
    </>
  );
}

function UserQuoteOfferPreview({
  quoteRequest,
  offer,
  onOpen,
}) {
  const productTitle =
    quoteRequest?.product?.title ||
    "Produs personalizat";

  const total =
    Number(offer?.total);

  const currency =
    offer?.currency ||
    "RON";

  const status =
    String(
      offer?.status ||
        "SENT"
    )
      .trim()
      .toUpperCase();

  const productionDays =
    Number(
      offer?.productionDays
    );

  const validUntil =
    offer?.validUntil
      ? new Date(
          offer.validUntil
        )
      : null;

  const validUntilText =
    validUntil &&
    !Number.isNaN(
      validUntil.getTime()
    )
      ? validUntil.toLocaleDateString(
          "ro-RO",
          {
            day: "2-digit",
            month: "long",
            year: "numeric",
          }
        )
      : null;

  return (
    <div
      className={
        styles.quotePreviewRow
      }
    >
      <article
        className={
          styles.quotePreviewCard
        }
      >
        <div
          className={
            styles.quotePreviewIcon
          }
        >
          <FileText size={20} />
        </div>

        <div
          className={
            styles.quotePreviewContent
          }
        >
          <div
            className={
              styles.quotePreviewEyebrow
            }
          >
            Ofertă primită
          </div>

          <strong
            className={
              styles.quotePreviewTitle
            }
          >
            {productTitle}
          </strong>

          <div
            className={
              styles.quotePreviewMeta
            }
          >
            {Number.isFinite(
              total
            ) && (
              <span>
                Total:{" "}
                <strong>
                  {total.toFixed(2)}{" "}
                  {currency}
                </strong>
              </span>
            )}

            {Number.isFinite(
              productionDays
            ) &&
              productionDays >
                0 && (
                <span>
                  Producție:{" "}
                  <strong>
                    {productionDays} zile
                  </strong>
                </span>
              )}
          </div>

          {validUntilText && (
            <div
              className={
                styles.quotePreviewValidity
              }
            >
              Oferta rămâne valabilă până la{" "}
              <strong>
                {validUntilText}
              </strong>
            </div>
          )}
        </div>

        <div
          className={
            styles.quotePreviewSide
          }
        >
          <span
            className={
              styles.quotePreviewStatus
            }
          >
            {status}
          </span>

          <button
            type="button"
            className={
              styles.quotePreviewBtn
            }
            onClick={onOpen}
          >
            Vezi oferta
          </button>
        </div>
      </article>
    </div>
  );
}

function UserQuoteOfferModal({
  quoteRequest,
  offer,
  canAnswer,
  acceptOpen,
  setAcceptOpen,
  shippingForm,
  setShippingForm,
  loading,
  error,
  setError,
  wantsDiscountCode,
  setWantsDiscountCode,
  discountCodeInput,
  setDiscountCodeInput,
  discountCodeApplied,
  discountCodeChecking,
  discountCodeError,
  onValidateDiscountCode,
  onAccept,
  onReject,
  onClose,
}) {
  const quantity =
    Number(
      quoteRequest?.quantity
    ) || 0;

  const productTitle =
    quoteRequest?.product
      ?.title ||
    "Produs personalizat";

  const productImage =
    Array.isArray(
      quoteRequest?.product
        ?.images
    )
      ? quoteRequest.product
          .images[0] || null
      : null;

  const status =
    String(
      offer?.status ||
        quoteRequest?.status ||
        ""
    )
      .trim()
      .toUpperCase();

  const subtotal =
    Number(
      offer?.subtotal
    );

  const shippingTotal =
    Number(
      offer?.shippingTotal
    );

  const total =
    Number(
      offer?.total
    );

  const currency =
    offer?.currency ||
    "RON";

  return (
    <div
      className={
        styles.quoteModalBackdrop
      }
      onMouseDown={(event) => {
        if (
          event.target ===
          event.currentTarget
        ) {
          onClose();
        }
      }}
    >
      <section
        className={
          styles.quoteModal
        }
        role="dialog"
        aria-modal="true"
        aria-labelledby="user-quote-modal-title"
      >
        <div
          className={
            styles.quoteModalHead
          }
        >
          <div>
            <div
              className={
                styles.quotePanelEyebrow
              }
            >
              Ofertă primită
            </div>

            <h2
              id="user-quote-modal-title"
            >
              Detalii ofertă
            </h2>

            <p>
              {productTitle}
            </p>
          </div>

          <button
            type="button"
            className={
              styles.quoteModalClose
            }
            onClick={onClose}
            disabled={loading}
            aria-label="Închide"
          >
            <X size={20} />
          </button>
        </div>

        <div
          className={
            styles.quotePanelHead
          }
        >
          <div
            className={
              styles.quotePanelInfo
            }
          >
            <div
              className={
                styles.quotePanelTitle
              }
            >
              {productTitle}
            </div>

            <div
              className={
                styles.quotePanelMeta
              }
            >
              <span>
                Cantitate:{" "}
                <strong>
                  {quantity}
                </strong>
              </span>

              <span>
                Status:{" "}
                <strong>
                  {status ||
                    "SENT"}
                </strong>
              </span>
            </div>
          </div>

          {productImage && (
            <img
              className={
                styles.quoteProductImage
              }
              src={productImage}
              alt={productTitle}
            />
          )}
        </div>

        <div
          className={
            styles.quotePriceDetails
          }
        >
          {Number.isFinite(
            subtotal
          ) && (
            <span>
              Produse:
              <strong>
                {subtotal.toFixed(
                  2
                )}{" "}
                {currency}
              </strong>
            </span>
          )}

          {Number.isFinite(
            shippingTotal
          ) && (
            <span>
              Transport:
              <strong>
                {shippingTotal.toFixed(
                  2
                )}{" "}
                {currency}
              </strong>
            </span>
          )}

          {Number.isFinite(
            total
          ) && (
            <span
              className={
                styles.quoteTotal
              }
            >
              Total:
              <strong>
                {total.toFixed(
                  2
                )}{" "}
                {currency}
              </strong>
            </span>
          )}
        </div>

        {offer?.productionDays && (
          <div
            className={
              styles.quoteDeliveryInfo
            }
          >
            Termen estimat de producție:{" "}
            <strong>
              {offer.productionDays} zile
            </strong>
          </div>
        )}

        {offer?.notes && (
          <div
            className={
              styles.quoteRequestText
            }
          >
            <strong>
              Mesajul vânzătorului:
            </strong>

            <p>
              {offer.notes}
            </p>
          </div>
        )}

        {error && (
          <div
            className={
              styles.quoteOfferError
            }
          >
            {error}
          </div>
        )}

        {canAnswer &&
          !acceptOpen && (
            <div
              className={
                styles.quoteOfferActions
              }
            >
              <button
                type="button"
                className={
                  styles.quoteRejectBtn
                }
                disabled={loading}
                onClick={onReject}
              >
                Refuză oferta
              </button>

              <button
                type="button"
                className={
                  styles.quotePrimaryBtn
                }
                disabled={loading}
                onClick={() => {
                  setError("");
                  setAcceptOpen(
                    true
                  );
                }}
              >
                Acceptă oferta
              </button>
            </div>
          )}

        {canAnswer &&
          acceptOpen && (
            <form
              className={
                styles.quoteAcceptForm
              }
              onSubmit={
                onAccept
              }
            >
              <div
                className={
                  styles.quoteAcceptTitle
                }
              >
                Date de livrare
              </div>

              <div
                className={
                  styles.quoteAddressGrid
                }
              >
                <label>
                  <span>
                    Nume complet
                  </span>

                  <input
                    value={
                      shippingForm.recipientName
                    }
                    onChange={(event) =>
                      setShippingForm(
                        (current) => ({
                          ...current,
                          recipientName:
                            event.target
                              .value,
                        })
                      )
                    }
                    required
                  />
                </label>

                <label>
                  <span>
                    Telefon
                  </span>

                  <input
                    value={
                      shippingForm.phone
                    }
                    onChange={(event) =>
                      setShippingForm(
                        (current) => ({
                          ...current,
                          phone:
                            event.target
                              .value,
                        })
                      )
                    }
                    required
                  />
                </label>

                <label
                  className={
                    styles.quoteAddressFull
                  }
                >
                  <span>
                    Adresă
                  </span>

                  <input
                    value={
                      shippingForm.addressLine1
                    }
                    onChange={(event) =>
                      setShippingForm(
                        (current) => ({
                          ...current,
                          addressLine1:
                            event.target
                              .value,
                        })
                      )
                    }
                    required
                  />
                </label>

                <label>
                  <span>
                    Localitate
                  </span>

                  <input
                    value={
                      shippingForm.city
                    }
                    onChange={(event) =>
                      setShippingForm(
                        (current) => ({
                          ...current,
                          city:
                            event.target
                              .value,
                        })
                      )
                    }
                    required
                  />
                </label>

                <label>
                  <span>
                    Județ
                  </span>

                  <input
                    value={
                      shippingForm.county
                    }
                    onChange={(event) =>
                      setShippingForm(
                        (current) => ({
                          ...current,
                          county:
                            event.target
                              .value,
                        })
                      )
                    }
                    required
                  />
                </label>

                <label>
                  <span>
                    Cod poștal
                  </span>

                  <input
                    value={
                      shippingForm.postalCode
                    }
                    onChange={(event) =>
                      setShippingForm(
                        (current) => ({
                          ...current,
                          postalCode:
                            event.target
                              .value,
                        })
                      )
                    }
                  />
                </label>
              </div>

              <div
                className={
                  styles.quoteAcceptTitle
                }
              >
                Ai un cod de reducere?
              </div>

              {!wantsDiscountCode ? (
                <div
                  className={
                    styles.quoteOfferActions
                  }
                >
                  <button
                    type="button"
                    className={
                      styles.quoteSecondaryBtn
                    }
                    disabled={loading}
                    onClick={() =>
                      setWantsDiscountCode(true)
                    }
                  >
                    Am un cod
                  </button>

                  <button
                    type="button"
                    className={
                      styles.quotePrimaryBtn
                    }
                    disabled={loading}
                    onClick={() =>
                      setWantsDiscountCode(false)
                    }
                  >
                    Nu, continuă
                  </button>
                </div>
              ) : (
                <div
                  className={
                    styles.quoteAddressGrid
                  }
                >
                  <label
                    className={
                      styles.quoteAddressFull
                    }
                  >
                    <span>
                      Cod de reducere
                    </span>

                    <input
                      value={discountCodeInput}
                      disabled={
                        discountCodeChecking ||
                        loading
                      }
                      onChange={(event) => {
                        setDiscountCodeInput(
                          event.target.value
                        );
                      }}
                      placeholder="Ex: ARTFEST10"
                    />
                  </label>

                  <div
                    className={
                      styles.quoteOfferActions
                    }
                  >
                    <button
                      type="button"
                      className={
                        styles.quoteSecondaryBtn
                      }
                      disabled={
                        discountCodeChecking ||
                        loading
                      }
                      onClick={() => {
                        setWantsDiscountCode(
                          false
                        );
                        setDiscountCodeInput("");
                      }}
                    >
                      Renunță la cod
                    </button>

                    <button
                      type="button"
                      className={
                        styles.quotePrimaryBtn
                      }
                      disabled={
                        discountCodeChecking ||
                        loading ||
                        !discountCodeInput.trim()
                      }
                      onClick={onValidateDiscountCode}
                    >
                      {discountCodeChecking ? (
                        <>
                          <Loader2
                            size={16}
                            className={styles.spin}
                          />
                          Se verifică…
                        </>
                      ) : (
                        "Verifică codul"
                      )}
                    </button>
                  </div>

                  {discountCodeError && (
                    <div
                      className={
                        styles.quoteOfferError
                      }
                    >
                      {discountCodeError}
                    </div>
                  )}

                  {discountCodeApplied?.valid && (
                    <div
                      className={
                        styles.quoteDeliveryInfo
                      }
                    >
                      Cod aplicat: reducere de{" "}
                      <strong>
                        {discountCodeApplied.discountPercent}%
                      </strong>{" "}
                      pe prețul negociat.
                    </div>
                  )}
                </div>
              )}

              <div
                className={
                  styles.quoteOfferActions
                }
              >
                <button
                  type="button"
                  className={
                    styles.quoteSecondaryBtn
                  }
                  disabled={loading}
                  onClick={() => {
                    setError("");
                    setAcceptOpen(
                      false
                    );
                  }}
                >
                  Înapoi
                </button>

                <button
                  type="submit"
                  className={
                    styles.quotePrimaryBtn
                  }
                  disabled={loading}
                >
                  {loading ? (
                    <>
                      <Loader2
                        size={16}
                        className={
                          styles.spin
                        }
                      />

                      Se înregistrează…
                    </>
                  ) : (
                    "Confirmă comanda"
                  )}
                </button>
              </div>
            </form>
          )}

        {!canAnswer &&
          status ===
            "ACCEPTED" && (
            <div
              className={
                styles.quoteAcceptedMessage
              }
            >
              Oferta a fost acceptată și transformată în comandă.
            </div>
          )}

        {!canAnswer &&
          status ===
            "REJECTED" && (
            <div
              className={
                styles.quoteRejectedMessage
              }
            >
              Oferta a fost refuzată.
            </div>
          )}
      </section>
    </div>
  );
}
