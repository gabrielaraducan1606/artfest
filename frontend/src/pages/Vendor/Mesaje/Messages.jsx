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
import {
  createVendorQuoteOffer,
} from "../../../components/AIAssistant/quotes/quoteApi.js";
import styles from "./Messages.module.css";
import { useMessageThreads } from "../../../features/messages/hooks/useMessageThreads";
import { useThreadMessages } from "../../../features/messages/hooks/useThreadMessages";
import { useMessageSend } from "../../../features/messages/hooks/useMessageSend";
import MessageBubble from "../../../features/messages/components/MessageBubble";
import {
  fmtTime,
  fmtDate,
  autoResize,
  initialsOf,
} from "../../../features/messages/utils/messageFormatters";

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


/* ========= Pagina ========= */
export default function MessagesPage() {
  const [searchParams, setSearchParams] = useSearchParams();

  const [conversationMode, setConversationMode] = useState(() =>
  searchParams.get("vendorThreadId") ? "vendor" : "customer"
);
// customer | vendor
  const [scope, setScope] = useState("all"); // all | unread | archived
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [periodFilter, setPeriodFilter] = useState("all");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [groupByUser, setGroupByUser] = useState(false);
const [chatBlocked, setChatBlocked] = useState(null);
const [customerUnread, setCustomerUnread] = useState(0);
const [vendorUnread, setVendorUnread] = useState(0);

const reloadUnreadTabs = useCallback(async () => {
  try {
    const [customerData, vendorData] = await Promise.all([
      api("/api/inbox/unread-count").catch(() => ({ count: 0 })),
      api("/api/inbox/vendor-threads?scope=unread").catch(() => ({ items: [] })),
    ]);

    const vendorCount = Array.isArray(vendorData?.items)
      ? vendorData.items.reduce(
          (sum, t) => sum + (Number(t.unreadCount) || 0),
          0
        )
      : 0;

    setCustomerUnread(Number(customerData?.count) || 0);
    setVendorUnread(vendorCount);
  } catch {
    setCustomerUnread(0);
    setVendorUnread(0);
  }
}, []);
  const buildThreadsUrl = useCallback(
    (dq) => {
      const params = new URLSearchParams();
      params.set("scope", scope || "all");
      if (dq) params.set("q", dq);

      if (conversationMode === "customer") {
        if (statusFilter && statusFilter !== "all") params.set("status", statusFilter);
        if (typeFilter && typeFilter !== "all") params.set("eventType", typeFilter);
        if (periodFilter && periodFilter !== "all") params.set("period", periodFilter);
        if (groupByUser) params.set("groupBy", "user");
      }

      return conversationMode === "vendor"
        ? `/api/inbox/vendor-threads?${params.toString()}`
        : `/api/inbox/threads?${params.toString()}`;
    },
    [scope, statusFilter, typeFilter, periodFilter, groupByUser, conversationMode]
  );

  const {
    loading: loadingThreads,
    items: threads,
    error: errThreads,
    reload: reloadThreads,
    setItems: setThreads,
  } = useMessageThreads({ q, buildUrl: buildThreadsUrl });
useEffect(() => {
  reloadUnreadTabs();

  const id = setInterval(reloadUnreadTabs, 15000);
  return () => clearInterval(id);
}, [reloadUnreadTabs]);
  const [selectedId, setSelectedId] = useState(null); // poate fi threadId sau "user:xxx"
  const [activeThreadId, setActiveThreadId] = useState(null); // mereu threadId real

  // swipe state pentru bottom sheet
  const [dragY, setDragY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef(null);

  // Sincronizare cu ?threadId=...
 useEffect(() => {
  if (!threads.length) return;

  const paramKey =
    conversationMode === "vendor" ? "vendorThreadId" : "threadId";

  const paramId = searchParams.get(paramKey);

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

  if (!selectedId && !isMobile && threads[0]) {
    const firstId = threads[0].id;
    setSelectedId(firstId);

    const sp = new URLSearchParams(searchParams);
    sp.set(paramKey, firstId);
    setSearchParams(sp, { replace: true });
  }
}, [threads, selectedId, searchParams, setSearchParams, conversationMode]);

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
 const buildMessagesEndpoint = useCallback(
  (id) =>
    conversationMode === "vendor"
      ? `/api/inbox/vendor-threads/${id}`
      : `/api/inbox/threads/${id}`,
  [conversationMode]
);

const {
  loading: loadingMsgs,
  loadingOlder,
  hasMoreOlder,
  msgs,
  error: errMsgs,
  setMsgs,
  reload: reloadMsgs,
  loadOlder,
  quoteRequest,
} = useThreadMessages(currentThreadId, {
  buildEndpoint: buildMessagesEndpoint,
  includeQuoteRequest: conversationMode === "customer",
});

const latestQuoteOffer =
  Array.isArray(
    quoteRequest?.offers
  )
    ? quoteRequest
        .offers[0] ||
      null
    : null;

const quoteStatus =
  String(
    quoteRequest?.status ||
      ""
  )
    .trim()
    .toUpperCase();

const canSendQuoteOffer =
  conversationMode ===
    "customer" &&
  Boolean(
    quoteRequest?.id
  ) &&
  !quoteRequest?.orderId &&
  ![
    "ACCEPTED",
    "CANCELLED",
    "EXPIRED",
  ].includes(
    quoteStatus
  );

const listRef = useRef(null);
const nearBottomRef = useRef(true);
const prevThreadIdRef = useRef(null);
const justSentRef = useRef(false);

/*
 * ETAPA 4 (paginare thread + load older) - refs (nu state) pentru
 * hasMoreOlder/loadingOlder, ca handleScroll să nu citească valori
 * stale - vezi nota identică din UserMessages.jsx.
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

const [text, setText] =
  useState("");

const [uploading, setUploading] =
  useState(false);

const fileInputRef =
  useRef(null);

const [
  templatesOpen,
  setTemplatesOpen,
] = useState(false);

const [
  internalNote,
  setInternalNote,
] = useState("");

const [
  quoteOfferOpen,
  setQuoteOfferOpen,
] = useState(false);

const [
  quoteOfferSending,
  setQuoteOfferSending,
] = useState(false);

const [
  quoteOfferError,
  setQuoteOfferError,
] = useState("");

const [
  quoteOfferForm,
  setQuoteOfferForm,
] = useState({
  unitPrice: "",
  shippingPrice: "0",
  productionDays: "",
  notes: "",
});

useEffect(() => {
  setQuoteOfferOpen(false);
  setQuoteOfferSending(false);
  setQuoteOfferError("");

  setQuoteOfferForm({
    unitPrice: "",
    shippingPrice: "0",
    productionDays: "",
    notes: "",
  });
}, [currentThreadId]);

useEffect(() => {
  const el = listRef.current;
  if (!el) return;

  function maybeLoadOlder() {
    if (!hasMoreOlderRef.current || isLoadingOlderRef.current) return;

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
  if (!listRef.current) {
    return;
  }

  const threadJustOpened = prevThreadIdRef.current !== currentThreadId;
  prevThreadIdRef.current = currentThreadId;

  const shouldAutoScroll =
    threadJustOpened || nearBottomRef.current || justSentRef.current;

  justSentRef.current = false;

  if (shouldAutoScroll) {
    listRef.current.scrollTop =
      listRef.current.scrollHeight +
      1000;
    nearBottomRef.current = true;
  }

  const textarea =
    document.querySelector(
      `.${styles.input}`
    );

  if (textarea) {
    autoResize(textarea);
  }
}, [
  msgs,
  activeThread?.threadId,
  currentThreadId,
  loadingMsgs,
]);
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
    : code === "attachments_limit_reached"
    ? `Ai atins limita de atașamente pentru luna curentă. Mai ai ${data?.remaining ?? 0} disponibile din ${data?.limit ?? "?"}.`
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
  code === "attachments_limit_reached" ||
  code === "subscription_required" ||
  code === "CHAT_NOT_ALLOWED";

  const cta =
  data?.cta ||
  (shouldBlock
    ? {
        label: "Modifică abonamentul",
        url: "/setari?tab=subscription",
      }
    : null);
 return {
  status,
  code,
  message,
  details: data,
  shouldBlock,
  cta,
};
}

async function handleSendQuoteOffer(
  event
) {
  event?.preventDefault?.();

  if (
    !quoteRequest?.id ||
    quoteOfferSending
  ) {
    return;
  }

  const quantity =
    Number(
      quoteRequest.quantity
    );

  const unitPrice =
    Number(
      String(
        quoteOfferForm
          .unitPrice ||
          ""
      )
        .trim()
        .replace(
          ",",
          "."
        )
    );

  const shippingPrice =
    Number(
      String(
        quoteOfferForm
          .shippingPrice ||
          "0"
      )
        .trim()
        .replace(
          ",",
          "."
        )
    );

  const productionDays =
    Number.parseInt(
      quoteOfferForm
        .productionDays,
      10
    );

  if (
    !Number.isFinite(
      quantity
    ) ||
    quantity <= 0
  ) {
    setQuoteOfferError(
      "Cantitatea cererii nu este validă."
    );

    return;
  }

  if (
    !Number.isFinite(
      unitPrice
    ) ||
    unitPrice < 0
  ) {
    setQuoteOfferError(
      "Introdu un preț unitar valid."
    );

    return;
  }

  if (
    !Number.isFinite(
      shippingPrice
    ) ||
    shippingPrice < 0
  ) {
    setQuoteOfferError(
      "Introdu un cost de transport valid."
    );

    return;
  }

  if (
    !Number.isFinite(
      productionDays
    ) ||
    productionDays <= 0
  ) {
    setQuoteOfferError(
      "Introdu un termen de producție valid."
    );

    return;
  }

  setQuoteOfferSending(true);
  setQuoteOfferError("");

  try {
    await createVendorQuoteOffer(
      quoteRequest.id,
      {
        quantity,

        unitPrice,

        shippingPrice,

        currency:
          "RON",

        productionDays,

        notes:
          String(
            quoteOfferForm
              .notes ||
              ""
          ).trim() ||
          null,
      }
    );

    setQuoteOfferOpen(false);

    setQuoteOfferForm({
      unitPrice: "",
      shippingPrice:
        "0",
      productionDays:
        "",
      notes:
        "",
    });

    await reloadMsgs();
    await reloadThreads();
    await reloadUnreadTabs();
  } catch (error) {
    setQuoteOfferError(
      error?.data
        ?.message ||
        error?.message ||
        "Oferta nu a putut fi trimisă."
    );
  } finally {
    setQuoteOfferSending(
      false
    );
  }
}

  /*
   * ETAPA 3 (refactor comun Mesaje) - nucleul de trimitere e acum în
   * useMessageSend (gardă double-submit, mesaj optimist, POST, marcare
   * "failed", dispatch messages:changed). Vendor golește composer-ul
   * DOAR la succes și îl restaurează la eșec (spre deosebire de User) -
   * plus are gating de subscripție/cotă (normalizeChatError, chatBlocked)
   * și reloadUnreadTabs - păstrate exact prin onSuccess/onError.
   */
  const { sending, send, retryMessage } = useMessageSend({
    threadId: currentThreadId,
    buildEndpoint: buildMessagesEndpoint,
    setMsgs,
    onBeforeSend: () => {
      justSentRef.current = true;
    },
    onSuccess: async () => {
      setText("");
      await reloadMsgs();
      await reloadThreads();
      await reloadUnreadTabs();
    },
    onError: (err, content) => {
      const info = normalizeChatError(err);
      setText(content);
      if (info.shouldBlock) setChatBlocked(info);
      else alert(info.message);
    },
    /*
     * ETAPA 6 - retry manual pe mesaj failed: variante SEPARATE de
     * onSuccess/onError, fără setText(...) - onSuccess/onError de mai sus
     * rescriu composer-ul cu textul TRIMIS ACUM, dar la retry se
     * retrimite body-ul unui mesaj VECHI, deja eșuat - nu are nicio
     * legătură cu ce e în composer în momentul retry-ului (ar putea fi un
     * draft nou, neterminat). Restul (reload mesaje/threads/unread-tabs,
     * normalizeChatError, chatBlocked) rămâne identic.
     */
    onRetrySuccess: async () => {
      await reloadMsgs();
      await reloadThreads();
      await reloadUnreadTabs();
    },
    onRetryError: (err) => {
      const info = normalizeChatError(err);
      if (info.shouldBlock) setChatBlocked(info);
      else alert(info.message);
    },
  });

  async function handleSend() {
    await send(text);
  }

  async function handleRetry(msg) {
    await retryMessage(msg);
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

  if (conversationMode === "vendor") {
    sp.delete("threadId");
    sp.set("vendorThreadId", id);
  } else {
    sp.delete("vendorThreadId");
    sp.set("threadId", id);
  }

  setSearchParams(sp, { replace: true });
};

  const clearSelection = () => {
  setSelectedId(null);
  setActiveThreadId(null);

  const sp = new URLSearchParams(searchParams);
  sp.delete("threadId");
  sp.delete("vendorThreadId");

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
    if (conversationMode === "vendor") {
      await api(`/api/inbox/vendor-threads/${threadId}/archive`, {
        method: "PATCH",
        body: { archived: true },
      });
    } else {
      await api(`/api/inbox/threads/${threadId}`, { method: "DELETE" });
    }

    setThreads((items) =>
      items
        .map((t) => {
          if (!Array.isArray(t.threads)) {
            return t.id === threadId ? null : t;
          }

          const remaining = (t.threads || []).filter(
            (th) => th.threadId !== threadId
          );

          if (!remaining.length) return null;

          const sorted = remaining
            .slice()
            .sort((a, b) => (+b.lastAt || 0) - (+a.lastAt || 0));

          const primary = sorted[0];
          const totalUnread = sorted.reduce(
            (s, x) => s + (x.unreadCount || 0),
            0
          );

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
              placeholder="Caută client, magazin, telefon, mesaj…"
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

          {conversationMode === "customer" && filtersOpen && (
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
         {conversationMode === "customer" && (
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
          </div>)}
<div className={styles.scopeTabs}>
  <button
    className={`${styles.tab} ${
      conversationMode === "customer" ? styles.active : ""
    }`}
    onClick={() => {
      setConversationMode("customer");
      setSelectedId(null);
      setActiveThreadId(null);
      setGroupByUser(false);
      setChatBlocked(null);

      const sp = new URLSearchParams(searchParams);
      sp.delete("vendorThreadId");
sp.delete("threadId");
      setSearchParams(sp, { replace: true });
    }}
    type="button"
  >
    Clienți
{customerUnread > 0 && (
  <span className={styles.unreadBadge}>{customerUnread}</span>
)}
  </button>

  <button
    className={`${styles.tab} ${
      conversationMode === "vendor" ? styles.active : ""
    }`}
    onClick={() => {
      setConversationMode("vendor");
      setSelectedId(null);
      setActiveThreadId(null);
      setGroupByUser(false);
      setChatBlocked(null);

      const sp = new URLSearchParams(searchParams);
      sp.delete("threadId");
sp.delete("vendorThreadId");
      setSearchParams(sp, { replace: true });
    }}
    type="button"
  >
    Vendori
{vendorUnread > 0 && (
  <span className={styles.unreadBadge}>{vendorUnread}</span>
)}
  </button>
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
const storeName = t.storeName || "Magazin";
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
  <span className={styles.threadOrderBadge}>
    {" · "}{storeName}
  </span>
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
                                const archiveUrl =
  conversationMode === "vendor"
    ? `/api/inbox/vendor-threads/${t.id}/archive`
    : `/api/inbox/threads/${t.id}/archive`;

await api(archiveUrl, {
  method: "PATCH",
  body: { archived: !t.archived },
});
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
  {activeThread?.storeName && (
    <span className={styles.peerOrderBadge}>
      {" · "}{activeThread.storeName}
    </span>
  )}
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
                      {conversationMode === "customer" && currentThreadId && (
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

                  {conversationMode === "customer" && currentThreadId && (
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
                        const archiveUrl =
  conversationMode === "vendor"
    ? `/api/inbox/vendor-threads/${currentThreadId}/archive`
    : `/api/inbox/threads/${currentThreadId}/archive`;

await api(archiveUrl, {
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
    ? `${th.storeName || "Magazin"} · Comanda ${sid}`
    : `${th.storeName || "Magazin"} · Conversație fără comandă`}
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

             {conversationMode === "customer" && (
  <div className={styles.internalNote}>
                <label>
                  <TagIcon size={14} /> Notă internă (invitatul nu o vede)
                </label>
                <textarea
  className={styles.noteInput}
  rows={2}
  placeholder={
   chatBlocked?.code === "CHAT_ADVANCED_NOT_ALLOWED"
     ? "Disponibil doar pe planul PRO."
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

      {(chatBlocked?.cta?.url ||
  chatBlocked?.details?.upgradeUrl) && (
  <a
    className={styles.smallBtnPrimary}
    href={
      chatBlocked?.cta?.url ||
      chatBlocked?.details?.upgradeUrl
    }
  >
    {chatBlocked?.cta?.label || "Modifică abonamentul"}
  </a>
)}
    </div>
  </div>
)}
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

  {conversationMode ===
      "customer" &&
    quoteRequest && (
     <QuoteRequestPanel
  quoteRequest={quoteRequest}
  latestOffer={latestQuoteOffer}
  canSendOffer={canSendQuoteOffer}
  onOpenOffer={() => {
    setQuoteOfferError("");
    setQuoteOfferOpen(true);
  }}
/>
    )}

  {loadingOlder && (
    <div className={styles.loading}>
      Se încarcă mesaje mai vechi…
    </div>
  )}

  {msgs.map((m) => (
    <MessageBubble
      key={m.id}
      mine={
        m.from === "me"
      }
      msg={m}
      styles={styles}
      showAvatar
      onEdit={
        conversationMode ===
        "customer"
          ? (body) =>
              editMessage(
                m.id,
                body
              )
          : undefined
      }
      onDelete={
        conversationMode ===
        "customer"
          ? () =>
              deleteMessage(
                m.id
              )
          : undefined
      }
      onRetry={handleRetry}
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
  disabled={
  uploading ||
  sending ||
  !currentThreadId ||
  !!chatBlocked ||
  activeThread?.archived ||
  conversationMode === "vendor"
}
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
{quoteOfferOpen &&
  quoteRequest && (
    <QuoteOfferModal
      quoteRequest={quoteRequest}
      form={quoteOfferForm}
      setForm={setQuoteOfferForm}
      sending={quoteOfferSending}
      error={quoteOfferError}
      setError={setQuoteOfferError}
      onSubmit={handleSendQuoteOffer}
      onClose={() => {
        if (quoteOfferSending) {
          return;
        }

        setQuoteOfferError("");
        setQuoteOfferOpen(false);
      }}
    />
  )}
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
function QuoteRequestPanel({
  quoteRequest,
  latestOffer,
  canSendOffer,
  onOpenOffer,
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

  const requestMessage =
    String(
      quoteRequest?.requestData
        ?.message || ""
    ).trim();

  const latestOfferStatus =
    String(
      latestOffer?.status ||
        ""
    )
      .trim()
      .toUpperCase();

  const latestOfferTotal =
    Number(
      latestOffer?.total
    );

  return (
    <section
      className={styles.quotePanel}
    >
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
              styles.quotePanelEyebrow
            }
          >
            Cerere de ofertă
          </div>

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
                {quoteRequest?.status ||
                  "SUBMITTED"}
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

      {requestMessage && (
        <div
          className={
            styles.quoteRequestText
          }
        >
          <strong>
            Cerințele clientului:
          </strong>

          <p>
            {requestMessage}
          </p>
        </div>
      )}

      {latestOffer && (
        <div
          className={
            styles.quoteExistingOffer
          }
        >
          <div>
            <strong>
              Ultima ofertă
            </strong>

            <span>
              {latestOfferStatus ||
                "SENT"}
            </span>
          </div>

          {Number.isFinite(
            latestOfferTotal
          ) && (
            <strong>
              {latestOfferTotal.toFixed(
                2
              )}{" "}
              {latestOffer?.currency ||
                "RON"}
            </strong>
          )}
        </div>
      )}

      {canSendOffer && (
        <button
          type="button"
          className={
            styles.quotePrimaryBtn
          }
          onClick={onOpenOffer}
        >
          {latestOffer
            ? "Trimite o ofertă nouă"
            : "Trimite ofertă"}
        </button>
      )}
    </section>
  );
}

function QuoteOfferModal({
  quoteRequest,
  form,
  setForm,
  sending,
  error,
  setError,
  onSubmit,
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

  const unitPrice =
    Number(
      String(
        form.unitPrice || "0"
      ).replace(",", ".")
    ) || 0;

  const shippingPrice =
    Number(
      String(
        form.shippingPrice ||
          "0"
      ).replace(",", ".")
    ) || 0;

  const productsTotal =
    unitPrice * quantity;

  const finalTotal =
    productsTotal +
    shippingPrice;

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
      <div
        className={
          styles.quoteModal
        }
        role="dialog"
        aria-modal="true"
        aria-labelledby="quote-modal-title"
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
              Ofertă personalizată
            </div>

            <h2
              id="quote-modal-title"
            >
              Trimite ofertă
            </h2>

            <p>
              {productTitle} ·{" "}
              {quantity} buc.
            </p>
          </div>

          <button
            type="button"
            className={
              styles.quoteModalClose
            }
            onClick={onClose}
            disabled={sending}
            aria-label="Închide"
          >
            <X size={20} />
          </button>
        </div>

        <form
          className={
            styles.quoteOfferForm
          }
          onSubmit={onSubmit}
        >
          <div
            className={
              styles.quoteFormGrid
            }
          >
            <label>
              <span>
                Preț unitar
              </span>

              <div
                className={
                  styles.quoteMoneyInput
                }
              >
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={
                    form.unitPrice
                  }
                  autoFocus
                  required
                  onChange={(event) =>
                    setForm(
                      (current) => ({
                        ...current,
                        unitPrice:
                          event.target
                            .value,
                      })
                    )
                  }
                />

                <span>RON</span>
              </div>
            </label>

            <label>
              <span>
                Transport
              </span>

              <div
                className={
                  styles.quoteMoneyInput
                }
              >
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={
                    form.shippingPrice
                  }
                  required
                  onChange={(event) =>
                    setForm(
                      (current) => ({
                        ...current,
                        shippingPrice:
                          event.target
                            .value,
                      })
                    )
                  }
                />

                <span>RON</span>
              </div>
            </label>

            <label>
              <span>
                Termen producție
              </span>

              <div
                className={
                  styles.quoteDaysInput
                }
              >
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={
                    form.productionDays
                  }
                  required
                  onChange={(event) =>
                    setForm(
                      (current) => ({
                        ...current,
                        productionDays:
                          event.target
                            .value,
                      })
                    )
                  }
                />

                <span>zile</span>
              </div>
            </label>
          </div>

          <label
            className={
              styles.quoteNotesLabel
            }
          >
            <span>
              Observații pentru client
            </span>

            <textarea
              rows={4}
              value={form.notes}
              placeholder="Ex: prețul include personalizarea și ambalarea..."
              onChange={(event) =>
                setForm(
                  (current) => ({
                    ...current,
                    notes:
                      event.target
                        .value,
                  })
                )
              }
            />
          </label>

          <div
            className={
              styles.quoteOfferSummary
            }
          >
            <span>
              Produse:
              <strong>
                {productsTotal.toFixed(
                  2
                )}{" "}
                RON
              </strong>
            </span>

            <span>
              Transport:
              <strong>
                {shippingPrice.toFixed(
                  2
                )}{" "}
                RON
              </strong>
            </span>

            <span>
              Total:
              <strong>
                {finalTotal.toFixed(
                  2
                )}{" "}
                RON
              </strong>
            </span>
          </div>

          {error && (
            <div
              className={
                styles.quoteOfferError
              }
            >
              {error}
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
              disabled={sending}
              onClick={() => {
                setError("");
                onClose();
              }}
            >
              Renunță
            </button>

            <button
              type="submit"
              className={
                styles.quotePrimaryBtn
              }
              disabled={sending}
            >
              {sending ? (
                <>
                  <Loader2
                    size={16}
                    className={
                      styles.spin
                    }
                  />

                  Se trimite…
                </>
              ) : (
                <>
                  <Send size={16} />
                  Trimite oferta
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
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
