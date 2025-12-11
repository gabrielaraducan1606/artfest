import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../lib/api.js";
import {
  LifeBuoy,
  Send,
  Search as SearchIcon,
  Loader2,
  RefreshCw,
  Paperclip,
  ChevronLeft,
  ChevronRight,
  Plus,
  Filter,
  CheckCircle2,
  CircleDot,
  XCircle,
  X,
  Trash2,
  Pencil,
} from "lucide-react";
import styles from "./Support.module.css";
import BottomSheet from "./BottomSheet";

/* ========= Meta suport ========= */
const SUPPORT_META = {
  workHoursLabel: "Luni–Vineri, 08:00–16:00",
  highPrioritySla:
    "Tichetele cu prioritate Ridicată sunt tratate cu prioritate. În programul de lucru încercăm să răspundem în max. 1–2 ore.",
  emergencyPhone: "+40760565147", // TODO: pune aici numărul vostru real
};

function isSupportOnline(date = new Date()) {
  const day = date.getDay(); // 0 = D, 1 = L, ..., 6 = S
  const hour = date.getHours();
  const isWorkday = day >= 1 && day <= 5;
  const inHours = hour >= 8 && hour < 16;
  return isWorkday && inHours;
}

function useSupportOnline() {
  const [online, setOnline] = useState(isSupportOnline());
  useEffect(() => {
    const id = setInterval(() => setOnline(isSupportOnline()), 60000);
    return () => clearInterval(id);
  }, []);
  return online;
}

/* Mesaj dinamic pentru prioritate Ridicată (în program vs. în afara programului) */
function HighPriorityHint({ online }) {
  return (
    <p className={styles.mutedSmall}>
      {online ? (
        <>
  {SUPPORT_META.highPrioritySla}
        </>
      ) : (
        <>
        </>
      )}
    </p>
  );
}

/* ========= FAQ default (poți override cu prop) ========= */
const DEFAULT_FAQ_ITEMS = [
  // Cont & acces
  {
    q: "Nu pot să mă autentific. Ce pot face?",
    a: "Verifică emailul și parola (inclusiv litere mari/mici). Dacă tot nu merge, folosește „Am uitat parola”. Dacă nu primești emailul, verifică și Spam/Promotions.",
  },
  {
    q: "Am uitat parola. Cum o resetez?",
    a: "Apasă pe „Am uitat parola” în pagina de login, introdu adresa de email și urmează pașii din emailul de resetare. Dacă nu apare, mai încearcă o dată și verifică Spam.",
  },

  // Abonament & facturare
  {
    q: "Am nevoie de abonament pentru ca serviciile mele să apară în căutări?",
    a: "Da, pentru vizibilitate constantă în căutările clienților ai nevoie de un abonament activ. Fără abonament, profilul poate avea vizibilitate limitată, în funcție de plan.",
  },
  {
    q: "Ce se întâmplă cu serviciile mele dacă expiră abonamentul?",
    a: "Dacă abonamentul expiră, serviciile pot fi ascunse sau coborâte în listări, iar anumite funcții (promovare, analytics etc.) devin indisponibile până la reactivare.",
  },
  {
    q: "Unde găsesc facturile pentru abonament?",
    a: "Facturile sunt disponibile în secțiunea „Facturare”/„Abonament” din contul tău, de unde le poți descărca în format PDF.",
  },

  // Profil & servicii
  {
    q: "Cum îmi public profilul ca să fie vizibil clienților?",
    a: "Completează datele profilului (brand, oraș, categorie, descriere), adaugă cel puțin un serviciu activ și asigură-te că ai abonament activ. Profilul va apărea apoi în căutări.",
  },
  {
    q: "De ce văd mesajul „Completează titlul pachetului și orașul serviciului”?",
    a: "Pentru a putea fi afișat, fiecare serviciu are nevoie de un titlu clar (ex. „Pachet Foto Gold”) și de orașul în care este oferit. Verifică aceste câmpuri la fiecare serviciu.",
  },
  {
    q: "Cum adaug un serviciu nou (ex. foto, candy bar, decor)?",
    a: "Mergi în secțiunea „Servicii”/„Produse”, apasă „Adaugă serviciu”, completează titlul, categoria, prețul, orașul, descrierea și imaginile, apoi salvează și publică.",
  },
  {
    q: "Cum editez un serviciu deja creat?",
    a: "Intră în lista de servicii, deschide serviciul dorit și apasă „Editează”. Modifică ce ai nevoie (titlu, preț, descriere, imagini etc.) și salvează.",
  },

  // Vizibilitate & analytics
  {
    q: "Cum ajung în fața mirilor din zona mea?",
    a: "Asigură-te că ai orașul setat corect, profil complet, imagini bune și abonament activ. Activitatea constantă și răspunsurile rapide la mesaje ajută la vizibilitate mai bună.",
  },
  {
    q: "Ce înseamnă „Vizitatori”, „Afișări pagină”, „Click-uri CTA” și „Mesaje”?",
    a: "Vizitatori = persoane unice care îți văd profilul. Afișări = câte ori s-au încărcat paginile tale. Click-uri CTA = click-uri pe butoane (ex. Solicită ofertă). Mesaje = conversații de la miri.",
  },

  // Comenzi & clienți
  {
    q: "Unde văd toate comenzile primite?",
    a: "Comenzile sunt listate în secțiunea „Comenzile mele”. Poți filtra după status, perioadă sau numele clientului și poți deschide detaliile fiecărei comenzi.",
  },
  {
    q: "Ce înseamnă statusurile comenzii: „Nouă”, „În pregătire”, „Confirmată”, „Finalizată”, „Anulată”?",
    a: "Nouă = abia primită. În pregătire = lucrezi la comandă. Confirmată = totul este stabilit pentru livrare/eveniment. Finalizată = comanda a fost onorată. Anulată = nu se mai onorează.",
  },

  // Curier & livrare
  {
    q: "Cum programez un curier pentru o comandă?",
    a: "Din detaliile comenzii folosește acțiunea „Confirmă & curier”, completezi acordurile, intervalul de ridicare și detaliile coletului, apoi confirmi.",
  },
  {
    q: "Cum descarc eticheta AWB pentru o comandă?",
    a: "După generarea AWB-ului, în detaliile comenzii apare butonul „Etichetă AWB”, de unde poți descărca PDF-ul pentru imprimare.",
  },

  // Imagini & conținut
  {
    q: "Ce fel de poze sunt recomandate pentru profil și servicii?",
    a: "Ideal sunt poze luminoase, clare, fără watermark deranjant, care arată clar produsele/serviciile tale. Evită imaginile pixelate sau colajele foarte încărcate.",
  },
  {
    q: "Ce formate de imagine sunt acceptate?",
    a: "Poți încărca imagini JPEG/JPG, PNG sau WebP. Recomandat ca latura lungă să fie de minimum 1200px.",
  },

  // Tichete & suport
  {
    q: "Cum deschid un tichet de suport?",
    a: "În pagina de suport, folosește formularul „Deschide un tichet”: completezi subiectul, categoria, prioritatea și descrierea, atașezi fișiere (opțional) și trimiți.",
  },
  {
    q: "Ce înseamnă statusurile unui tichet: „Deschis”, „În lucru”, „Închis”?",
    a: "Deschis = tichet creat, așteaptă răspuns. În lucru = echipa noastră lucrează la rezolvare. Închis = discuția s-a încheiat sau problema e rezolvată.",
  },
  {
    q: "Cum atașez capturi de ecran sau fișiere la un tichet?",
    a: "În formularul de creare sau în zona de răspuns folosești iconița de „Paperclip”, apoi selectezi fișierele de pe dispozitiv (imagini, PDF etc.).",
  },

  // Securitate & date
  {
    q: "Platforma este conformă GDPR?",
    a: "Tratarea datelor personale se face conform GDPR. Folosim datele doar pentru funcționarea platformei și comunicarea cu tine și clienții tăi, conform termenilor afișați.",
  },
];

/* ========= Utils ========= */
const nowIso = () => new Date().toISOString();
const isImg = (v = "") => /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(v);

function fmtTime(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  const today = new Date();
  const isToday = d.toDateString() === today.toDateString();
  const diffDays = Math.floor((today - d) / 86400000);
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

// ===== Utils noi =====
const storage = {
  get(key, fallback = "") {
    try {
      return localStorage.getItem(key) ?? fallback;
    } catch {
      return fallback;
    }
  },
  set(key, val) {
    try {
      localStorage.setItem(key, val);
    } catch {
      /* ignore */
    }
  },
  del(key) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  },
};

function groupByDate(items = []) {
  const out = [];
  let lastLabel = "";
  for (const m of items) {
    const d = new Date(m.createdAt);
    const today = new Date();
    const isToday = d.toDateString() === today.toDateString();
    const label = isToday
      ? "Azi"
      : d.toLocaleDateString("ro-RO", {
          weekday: "long",
          day: "2-digit",
          month: "long",
        });
    if (label !== lastLabel) {
      out.push({ type: "divider", label });
      lastLabel = label;
    }
    out.push({ type: "msg", item: m });
  }
  return out;
}

/* ========= Hooks ========= */
function useTickets({ scope, q, supportBase, listPath }) {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState([]);
  const [error, setError] = useState(null);

  // debounce search
  const [dq, setDq] = useState(q);
  useEffect(() => {
    const id = setTimeout(() => setDq(q), 300);
    return () => clearTimeout(id);
  }, [q]);

  const reload = useCallback(
    async ({ hard = false, signal } = {}) => {
      if (hard) setLoading(true);
      setError(null);

      try {
        const url = `${supportBase}${listPath}?status=${encodeURIComponent(
          scope
        )}${dq ? `&q=${encodeURIComponent(dq)}` : ""}`;
        const d = await api(url, { signal }).catch(() => null);
        if (signal?.aborted) return;
        setItems(Array.isArray(d?.items) ? d.items : []);
      } catch (e) {
        if (e.name !== "AbortError") {
          setError(e?.message || "Eroare la încărcarea tichetelor");
          setItems([]);
        }
      } finally {
        setLoading(false);
      }
    },
    [scope, dq, supportBase, listPath]
  );

  useEffect(() => {
    const c = new AbortController();
    reload({ hard: true, signal: c.signal });
    return () => c.abort();
  }, [reload]);

  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible") reload();
    }, 15000);
    const onVis = () => document.visibilityState === "visible" && reload();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [reload]);

  return { loading, items, error, reload, setItems };
}

function useTicketMessages(ticketId, supportBase) {
  const [loading, setLoading] = useState(false);
  const [msgs, setMsgs] = useState([]);
  const [error, setError] = useState(null);

  const reload = useCallback(
    async ({ hard = false, signal } = {}) => {
      if (!ticketId) return;
      if (hard) setLoading(true);
      setError(null);

      const controller = !signal ? new AbortController() : null;
      const effSignal = signal || controller.signal;

      try {
        const d = await api(`${supportBase}/tickets/${ticketId}/messages`, {
          signal: effSignal,
        }).catch(() => null);
        if (effSignal.aborted) return;
        setMsgs(Array.isArray(d?.items) ? d.items : []);
        if (Array.isArray(d?.items)) {
          api(`${supportBase}/tickets/${ticketId}/read`, {
            method: "PATCH",
          }).catch(() => {});
        }
      } catch (e) {
        if (e.name !== "AbortError") {
          setError(e?.message || "Eroare la încărcarea mesajelor");
          setMsgs([]);
        }
      } finally {
        setLoading(false);
      }
    },
    [ticketId, supportBase]
  );

  useEffect(() => {
    const c = new AbortController();
    reload({ hard: true, signal: c.signal });
    return () => c.abort();
  }, [reload]);

  useEffect(() => {
    if (!ticketId) return;
    const id = setInterval(() => {
      if (document.visibilityState === "visible") reload();
    }, 10000);
    const onVis = () => document.visibilityState === "visible" && reload();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [ticketId, reload]);

  return { loading, msgs, error, setMsgs, reload };
}

/* ========= Sub-componente ========= */
function StatusBadge({ status }) {
  if (status === "open")
    return (
      <span className={`${styles.badge} ${styles.open}`}>
        <CircleDot size={12} /> Deschis
      </span>
    );
  if (status === "pending")
    return (
      <span className={`${styles.badge} ${styles.pending}`}>
        <Loader2 size={12} /> În lucru
      </span>
    );
  return (
    <span className={`${styles.badge} ${styles.closed}`}>
      <CheckCircle2 size={12} /> Închis
    </span>
  );
}
function PriorityDot({ priority }) {
  const cls =
    priority === "high"
      ? styles.pHigh
      : priority === "medium"
      ? styles.pMed
      : styles.pLow;
  return (
    <span
      className={`${styles.priority} ${cls}`}
      title={`Prioritate: ${priority}`}
    />
  );
}

/* ===== helper: long-press ===== */
function useLongPress(callback, ms = 350) {
  const t = useRef(null);
  function onTouchStart() {
    t.current = window.setTimeout(callback, ms);
  }
  function onTouchEnd() {
    if (t.current) window.clearTimeout(t.current);
  }
  return { onTouchStart, onTouchEnd };
}

/* ===== helper: detect mobile ===== */
function useIsMobile(breakpoint = 768) {
  const [m, setM] = useState(
    typeof window !== "undefined"
      ? window.matchMedia(`(max-width: ${breakpoint}px)`).matches
      : false
  );
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia(`(max-width: ${breakpoint}px)`);
    const on = (e) => setM(e.matches);
    mq.addEventListener?.("change", on);
    setM(mq.matches);
    return () => mq.removeEventListener?.("change", on);
  }, [breakpoint]);
  return m;
}

/* ========= Pagina generică ========= */
export default function SupportPageBase({
  supportBase,
  faqItems = DEFAULT_FAQ_ITEMS,
  listPath = "/me/tickets", // default pt user/vendor
  hideNewTicket = false, // pt admin true dacă nu vrei creare tichete
}) {
  // server-side filters
  const [scope] = useState("all"); // all | open | pending | closed
  const [q, setQ] = useState("");

  // client-side (priority + sort)
  const [priority, setPriority] = useState("all");
  const [sort, setSort] = useState("recent");
  const [showFilters, setShowFilters] = useState(false);
  const [showFilterSheet, setShowFilterSheet] = useState(false);

  // sheet “tichet nou”
  const [showNewSheet, setShowNewSheet] = useState(false);
  // sheet FAQ full
  const [showFaqSheet, setShowFaqSheet] = useState(false);

  const isMobileView = useIsMobile(768);
  const [mobileTab, setMobileTab] = useState("tickets"); // "tickets" | "new" | "faq"

  useEffect(() => {
    if (!isMobileView) {
      setMobileTab("tickets");
    }
  }, [isMobileView]);

  // formular "Deschide un tichet" expand/collapse
  const [showNewForm, setShowNewForm] = useState(!isMobileView && !hideNewTicket);
  useEffect(() => {
    // pe desktop: formular deschis, pe mobil: ascuns (numai dacă nu e ascuns complet)
    setShowNewForm(!isMobileView && !hideNewTicket);
  }, [isMobileView, hideNewTicket]);

  const { loading, items: tickets, error, reload } = useTickets({
    scope,
    q,
    supportBase,
    listPath,
  });

  const filteredTickets = useMemo(() => {
    let arr = tickets;
    if (priority !== "all") {
      arr = arr.filter(
        (t) => (t.priority || "").toLowerCase() === priority
      );
    }
    if (sort === "priority") {
      const rank = { high: 0, medium: 1, low: 2 };
      arr = [...arr].sort(
        (a, b) => (rank[a.priority] ?? 9) - (rank[b.priority] ?? 9)
      );
    } else {
      arr = [...arr].sort(
        (a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)
      );
    }
    return arr;
  }, [tickets, priority, sort]);

  const [selectedId, setSelectedId] = useState(null);

  // sync selecția tichete
  useEffect(() => {
    if (isMobileView) {
      if (selectedId && !filteredTickets.some((t) => t.id === selectedId)) {
        setSelectedId(null);
      }
    } else {
      if (selectedId && !filteredTickets.some((t) => t.id === selectedId)) {
        setSelectedId(filteredTickets[0]?.id ?? null);
      } else if (!selectedId && filteredTickets.length) {
        setSelectedId(filteredTickets[0].id);
      }
    }
  }, [filteredTickets, selectedId, isMobileView]);

  const current = useMemo(
    () => filteredTickets.find((t) => t.id === selectedId) || null,
    [filteredTickets, selectedId]
  );

  const {
    loading: loadingMsgs,
    msgs,
    error: errMsgs,
    setMsgs,
    reload: reloadMsgs,
  } = useTicketMessages(selectedId, supportBase);

  // form nou tichet
  const [form, setForm] = useState({
    subject: "",
    category: "general",
    priority: "medium",
    message: "",
    attachments: [],
  });
  const [creating, setCreating] = useState(false);

  // autoscroll inteligent + “scroll to latest”
  const listRef = useRef(null);
  const [showToBottom, setShowToBottom] = useState(false);
  useEffect(() => {
    if (!listRef.current) return;
    const el = listRef.current;
    const nearBottom =
      el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (nearBottom) el.scrollTop = el.scrollHeight + 1000;
  }, [msgs, selectedId, loadingMsgs]);
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    function onScroll() {
      setShowToBottom(
        el.scrollHeight - el.scrollTop - el.clientHeight > 160
      );
    }
    el.addEventListener("scroll", onScroll);
    onScroll();
    return () => el.removeEventListener("scroll", onScroll);
  }, [listRef, selectedId]);

  // închidere popover desktop
  useEffect(() => {
    function onDocClick(e) {
      if (!e.target.closest?.(`.${styles.filterWrap}`))
        setShowFilters(false);
    }
    if (showFilters) document.addEventListener("click", onDocClick);
    return () =>
      document.removeEventListener("click", onDocClick);
  }, [showFilters]);

  // shortcut-uri: N = tichet nou, R = reply
  useEffect(() => {
    function onKey(e) {
      const tag = (e.target?.tagName || "").toLowerCase();
      const typing =
        ["input", "textarea", "select"].includes(tag) ||
        e.target?.isContentEditable;
      if (typing) return;

      const key = e.key.toLowerCase();

      if (key === "n" && !hideNewTicket) {
        e.preventDefault();
        if (isMobileView) {
          setShowNewSheet(true);
        } else {
          document
            .getElementById("support-subject")
            ?.focus();
        }
      }

      if (key === "r") {
        e.preventDefault();
        document.getElementById("composer-input")?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isMobileView, hideNewTicket]);

 async function handleCreate(e) {
  e.preventDefault();
  if (!form.subject.trim() || !form.message.trim()) return;
  setCreating(true);

  try {
    // 1) upload atașamente dacă există
    let uploaded = [];
    if (form.attachments?.length) {
      const fd = new FormData();
      form.attachments.forEach((f) => fd.append("files", f));

      const up = await api("/api/upload/support", {
        method: "POST",
        body: fd,
      });

      uploaded = (up?.items || []).map((x) => ({
        url: x.url,
        name: x.name || "attachment",
        size: x.size || null,
        mimeType: x.mimeType || null,
      }));
    }

    // 2) trimitem tichetul cu lista de atașamente
    const { ...rest } = form;
    const payload = { ...rest, attachments: uploaded };

    const d = await api(`${supportBase}/tickets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).catch(() => null);

    if (d?.ticket?.id) {
      await reload({ hard: true });
      setSelectedId(d.ticket.id);
    } else {
      await reload({ hard: true });
    }

    setForm({
      subject: "",
      category: "general",
      priority: "medium",
      message: "",
      attachments: [],
    });

      if (isMobileView) {
        setMobileTab("tickets");
      }

      setTimeout(
        () =>
          document
            .getElementById("composer-input")
            ?.focus(),
        0
      );
      setShowNewSheet(false);
    } finally {
      setCreating(false);
    }
  }

  async function handleReply(content, files = []) {
    if (!content.trim() && !files.length) return;
    if (!selectedId) return;

    // 1) upload atașamente (opțional)
    let uploaded = [];
    if (files.length) {
  const formData = new FormData();
  files.forEach((f) => formData.append("files", f));

  try {
    const up = await api("/api/upload/support", {
      method: "POST",
      body: formData,
    });

    uploaded = (up?.items || []).map((x) => ({
      url: x.url,
      name: x.name || "attachment",
      size: x.size || null,
      mimeType: x.mimeType || null,
    }));
  } catch (e) {
    console.warn("upload failed:", e?.message);
  }
}

    // 2) optimistic
    const optimistic = {
      id: `local_${Date.now()}`,
      ticketId: selectedId,
      from: "me",
      body:
        content || (uploaded.length ? "(fișiere atașate)" : ""),
      createdAt: nowIso(),
      pending: true,
      attachments: uploaded,
    };
    setMsgs((m) => [...m, optimistic]);

    try {
      await api(`${supportBase}/tickets/${selectedId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: content, attachments: uploaded }),
      });
      await reloadMsgs();
      await reload();
    } catch {
      setMsgs((m) =>
        m.map((x) =>
          x.id === optimistic.id
            ? { ...x, failed: true, pending: false }
            : x
        )
      );
    }
  }

  async function deleteTicket(id) {
    if (!id) return;
    if (!confirm("Ștergi acest tichet? Acțiunea este definitivă."))
      return;
    try {
      await api(`${supportBase}/tickets/${id}`, {
        method: "DELETE",
      });
      await reload({ hard: true });
      setSelectedId(null);
    } catch {
      alert("Nu am putut șterge tichetul.");
    }
  }

  async function editMessage(mid, newBody) {
    try {
      await api(`${supportBase}/messages/${mid}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: newBody }),
      });
      await reloadMsgs();
    } catch {
      alert("Nu am putut edita mesajul.");
    }
  }

  async function deleteMessage(mid) {
    if (!confirm("Ștergi acest mesaj?")) return;
    try {
      await api(`${supportBase}/messages/${mid}`, {
        method: "DELETE",
      });
      await reloadMsgs();
    } catch {
      alert("Nu am putut șterge mesajul.");
    }
  }

  const lastReadAt = current?.lastReadAt
    ? new Date(current.lastReadAt)
    : null;

  const isSupportOnlineNow = useSupportOnline();

  return (
    <div className={styles.wrap}>
      {/* FAB doar desktop pentru tichet nou */}
      {!isMobileView && !hideNewTicket && (
        <button
          className={styles.fab}
          onClick={() =>
            document
              .getElementById("support-subject")
              ?.focus()
          }
          aria-label="Deschide tichet nou"
        >
          <Plus size={20} />
        </button>
      )}

      {/* stânga: deschide tichet + FAQ compact */}
      <aside className={styles.left}>
        {!hideNewTicket && (
          <div className={styles.card}>
            <div className={styles.headRow}>
              <div className={styles.head}>
                <LifeBuoy size={18} /> Deschide un tichet
              </div>
              <button
                type="button"
                className={styles.iconBtn}
                onClick={() =>
                  isMobileView
                    ? setShowNewSheet(true)
                    : setShowNewForm((v) => !v)
                }
                title="Tichet nou"
                aria-label="Tichet nou"
              >
                <Plus size={16} />
              </button>
            </div>

            {/* banner info suport */}
            <div className={styles.supportMeta}>
  <span
    className={
      isSupportOnlineNow ? styles.onlineDot : styles.offlineDot
    }
  />
  {isSupportOnlineNow ? (
    <span>
      Suntem <b>online</b> ({SUPPORT_META.workHoursLabel}). <br />
      {SUPPORT_META.highPrioritySla}
    </span>
  ) : (
    <span>
      Suntem în afara programului ({SUPPORT_META.workHoursLabel}).{" "}
      <br />
      Pentru urgențe (plăți, acces cont, eveniment foarte apropiat)
      te rugăm să ne suni la{" "}
      <a
        href={`tel:${SUPPORT_META.emergencyPhone}`}
        className={styles.phoneLink}
      >
        {SUPPORT_META.emergencyPhone}
      </a>
      .
    </span>
  )}
</div>

            {/* banner special pentru Ridicată în afara programului */}
            {form.priority === "high" && !isSupportOnlineNow && (
              <div className={styles.offHoursBanner}>
                Tichetul cu prioritate <b>Ridicată</b> va fi preluat cu
                prioritate imediat după ora 08:00, în următoarea zi lucrătoare.
              </div>
            )}

            {showNewForm && (
              <form className={styles.form} onSubmit={handleCreate}>
                <label>
                  Subiect
                  <input
                    id="support-subject"
                    className={styles.input}
                    value={form.subject}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        subject: e.target.value,
                      }))
                    }
                    placeholder="Ex: Nu pot publica profilul"
                    required
                  />
                </label>

                {/* Sugestii rapide */}
                <div
                  className={styles.quickChips}
                  aria-label="Sugestii rapide"
                >
                  {[
                    { label: "Plăți / facturare", category: "billing" },
                    { label: "Publicare produs", category: "store" },
                    {
                      label: "Profil / servicii",
                      category: "profile",
                    },
                  ].map((s) => (
                    <button
                      key={s.label}
                      type="button"
                      className={styles.chip}
                      onClick={() =>
                        setForm((f) => ({
                          ...f,
                          category: s.category,
                          subject: s.label,
                        }))
                      }
                    >
                      {s.label}
                    </button>
                  ))}
                </div>

                <div className={styles.grid2}>
                  <label>
                    Categoria
                    <select
                      className={styles.input}
                      value={form.category}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          category: e.target.value,
                        }))
                      }
                    >
                      <option value="general">General</option>
                      <option value="billing">Facturare</option>
                      <option value="store">
                        Magazin / Produse
                      </option>
                      <option value="profile">
                        Profil / Servicii
                      </option>
                      <option value="analytics">
                        Vizitatori / Analytics
                      </option>
                    </select>
                  </label>
                  <label>
                    Prioritate
                    <select
                      className={styles.input}
                      value={form.priority}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          priority: e.target.value,
                        }))
                      }
                    >
                      <option value="low">Scăzută</option>
                      <option value="medium">Medie</option>
                      <option value="high">Ridicată</option>
                    </select>
                    <HighPriorityHint online={isSupportOnlineNow} />
                  </label>
                </div>

                <label>
                  Descriere
                  <textarea
                    className={styles.input}
                    rows={4}
                    value={form.message}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        message: e.target.value,
                      }))
                    }
                    placeholder="Descrie pe scurt problema și pașii de reprodus…"
                    required
                  />
                </label>

                <div className={styles.attachRow}>
                  <button
                    type="button"
                    className={styles.iconBtn}
                    title="Atașează fișiere (opțional)"
                    onClick={() =>
                      document
                        .getElementById("support-attach")
                        ?.click()
                    }
                    aria-label="Atașează fișiere"
                  >
                    <Paperclip size={16} />
                  </button>
                  <input
                    id="support-attach"
                    type="file"
                    multiple
                    style={{ display: "none" }}
                    onChange={(e) => {
                      const files = Array.from(
                        e.target.files || []
                      );
                      setForm((f) => ({
                        ...f,
                        attachments: files,
                      }));
                    }}
                  />
                  <div className={styles.muted}>
                    {form.attachments?.length
                      ? `${form.attachments.length} fișier(e) selectate`
                      : "Atașamente opționale (capturi ecran, PDF…)"}
                  </div>
                  <button
                    className={styles.primary}
                    disabled={creating}
                  >
                    {creating ? (
                      <Loader2
                        size={16}
                        className={styles.spin}
                      />
                    ) : (
                      <Plus size={16} />
                    )}{" "}
                    Trimite tichet
                  </button>
                </div>
              </form>
            )}
          </div>
        )}

        <FAQBlock
          faqItems={faqItems}
          onOpenFull={() => setShowFaqSheet(true)}
        />
      </aside>

      {/* ===== LISTĂ + DETALIU (responsive) ===== */}
      {!isMobileView ? (
        /* DESKTOP: ambele vizibile, side-by-side */
        <div className={styles.split}>
          {/* LISTA */}
          <div
            className={styles.ticketList}
            role="listbox"
            tabIndex={0}
            aria-label="Lista tichete"
          >
            <div className={styles.toolbar}>
              <div className={styles.filtersRow}>
                <button
                  className={styles.iconBtn}
                  type="button"
                  title="Reîncarcă"
                  onClick={() =>
                    reload({ hard: true })
                  }
                >
                  <RefreshCw size={16} />
                </button>
                <div className={styles.filterWrap}>
                  <button
                    className={styles.iconBtn}
                    type="button"
                    onClick={() =>
                      setShowFilters((v) => !v)
                    }
                    title="Filtre & sortare"
                  >
                    <Filter size={16} />
                  </button>
                  {showFilters && (
                    <div className={styles.popover}>
                      <div
                        className={styles.popoverRow}
                      >
                        <label>Prioritate</label>
                        <select
                          value={priority}
                          onChange={(e) =>
                            setPriority(
                              e.target.value
                            )
                          }
                          className={styles.input}
                        >
                          <option value="all">
                            Toate
                          </option>
                          <option value="high">
                            Ridicată
                          </option>
                          <option value="medium">
                            Medie
                          </option>
                          <option value="low">
                            Scăzută
                          </option>
                        </select>
                      </div>
                      <div
                        className={styles.popoverRow}
                      >
                        <label>Sortare</label>
                        <select
                          value={sort}
                          onChange={(e) =>
                            setSort(
                              e.target.value
                            )
                          }
                          className={styles.input}
                        >
                          <option value="recent">
                            Cele mai recente
                          </option>
                          <option value="priority">
                            Prioritate
                          </option>
                        </select>
                      </div>
                      <div
                        className={styles.divider}
                      />
                      <button
                        className={styles.primary}
                        type="button"
                        onClick={() => {
                          setShowFilters(false);
                          reload({ hard: true });
                        }}
                      >
                        Aplică
                      </button>
                    </div>
                  )}
                </div>
              </div>

              <input
                className={styles.input}
                placeholder="Caută în tichete…"
                value={q}
                onChange={(e) =>
                  setQ(e.target.value)
                }
              />
            </div>

            {loading && !filteredTickets.length && (
              <div className={styles.empty}>
                <div
                  className={styles.skeleton}
                  style={{
                    height: 48,
                    marginBottom: 8,
                  }}
                />
                <div
                  className={styles.skeleton}
                  style={{
                    height: 48,
                    marginBottom: 8,
                  }}
                />
                <div
                  className={styles.skeleton}
                  style={{ height: 48 }}
                />
              </div>
            )}
            {error && (
              <div className={styles.error}>
                Nu am putut încărca tichetele.
              </div>
            )}
            {!loading &&
              !filteredTickets.length && (
                <div className={styles.empty}>
                  Nu ai tichete încă.
                </div>
              )}

            {filteredTickets.map((t) => (
              <button
                key={t.id}
                role="option"
                aria-selected={t.id === selectedId}
                onClick={() => setSelectedId(t.id)}
                className={`${styles.ticketItem} ${
                  t.id === selectedId
                    ? styles.selected
                    : ""
                }`}
              >
                <div className={styles.row}>
                  <div className={styles.subject}>
                    <PriorityDot
                      priority={t.priority}
                    />
                    {t.subject}
                    {t.unreadCount > 0 && (
                      <span
                        className={styles.unreadBadge}
                        aria-label={`${t.unreadCount} mesaje necitite`}
                      >
                        {t.unreadCount}
                      </span>
                    )}
                  </div>
                  <div className={styles.time}>
                    {fmtTime(t.updatedAt)}
                  </div>
                </div>
                <div className={styles.row}>
                  <StatusBadge
                    status={t.status}
                  />
                  <ChevronRight size={16} />
                </div>
              </button>
            ))}
          </div>

          {/* DETALIU */}
          <TicketDetailPanel
            current={current}
            loadingMsgs={loadingMsgs}
            errMsgs={errMsgs}
            msgs={msgs}
            lastReadAt={lastReadAt}
            listRef={listRef}
            onEditMessage={editMessage}
            onDeleteMessage={deleteMessage}
            onDeleteTicket={() =>
              deleteTicket(current?.id)
            }
            onSendReply={handleReply}
            showToBottom={showToBottom}
            setSelectedId={setSelectedId}
            isMobile={false}
          />
        </div>
      ) : (
        /* MOBIL: tab-uri Tichete / Adaugă tichet / FAQ + detaliu */
        <>
          {!selectedId ? (
            <>
              {/* Bara de tab-uri */}
              <div className={styles.mobileTabs}>
                <button
                  type="button"
                  className={`${styles.mobileTab} ${
                    mobileTab === "tickets"
                      ? styles.mobileTabActive
                      : ""
                  }`}
                  onClick={() => setMobileTab("tickets")}
                >
                  Tichete
                </button>

                {!hideNewTicket && (
                  <button
                    type="button"
                    className={`${styles.mobileTab} ${
                      mobileTab === "new"
                        ? styles.mobileTabActive
                        : ""
                    }`}
                    onClick={() => setMobileTab("new")}
                  >
                    Adaugă tichet
                  </button>
                )}

                <button
                  type="button"
                  className={`${styles.mobileTab} ${
                    mobileTab === "faq"
                      ? styles.mobileTabActive
                      : ""
                  }`}
                  onClick={() => setMobileTab("faq")}
                >
                  FAQ
                </button>
              </div>

              {/* TAB: Tichete */}
              {mobileTab === "tickets" && (
                <div
                  className={styles.ticketList}
                  role="listbox"
                  tabIndex={0}
                  aria-label="Lista tichete"
                >
                  <div className={styles.toolbar}>
                    <input
                      className={styles.input}
                      placeholder="Caută în tichete…"
                      value={q}
                      onChange={(e) =>
                        setQ(e.target.value)
                      }
                    />
                    <button
                      className={styles.iconBtn}
                      type="button"
                      title="Filtre"
                      onClick={() =>
                        setShowFilterSheet(true)
                      }
                    >
                      <Filter size={16} />
                    </button>
                  </div>

                  {loading &&
                    !filteredTickets.length && (
                      <div className={styles.empty}>
                        <div
                          className={styles.skeleton}
                          style={{
                            height: 48,
                            marginBottom: 8,
                          }}
                        />
                        <div
                          className={styles.skeleton}
                          style={{
                            height: 48,
                            marginBottom: 8,
                          }}
                        />
                        <div
                          className={styles.skeleton}
                          style={{ height: 48 }}
                        />
                      </div>
                    )}
                  {error && (
                    <div className={styles.error}>
                      Nu am putut încărca tichetele.
                    </div>
                  )}
                  {!loading &&
                    !filteredTickets.length && (
                      <div className={styles.empty}>
                        Nu ai tichete încă.
                      </div>
                    )}

                  {filteredTickets.map((t) => (
                    <button
                      key={t.id}
                      role="option"
                      aria-selected={false}
                      onClick={() => {
                        setSelectedId(t.id);
                        window.scrollTo({
                          top: 0,
                          left: 0,
                          behavior: "auto",
                        });
                      }}
                      className={styles.ticketItem}
                    >
                      <div className={styles.row}>
                        <div className={styles.subject}>
                          <PriorityDot
                            priority={t.priority}
                          />
                          {t.subject}
                          {t.unreadCount > 0 && (
                            <span
                              className={
                                styles.unreadBadge
                              }
                              aria-label={`${t.unreadCount} mesaje necitite`}
                            >
                              {t.unreadCount}
                            </span>
                          )}
                        </div>
                        <div className={styles.time}>
                          {fmtTime(t.updatedAt)}
                        </div>
                      </div>
                      <div className={styles.row}>
                        <StatusBadge
                          status={t.status}
                        />
                        <ChevronRight size={16} />
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {/* TAB: Adaugă tichet */}
              {mobileTab === "new" && !hideNewTicket && (
                <form
                  className={styles.form}
                  onSubmit={handleCreate}
                  style={{ marginTop: 12 }}
                >
                  {/* banner special pentru Ridicată în afara programului */}
                  {form.priority === "high" && !isSupportOnlineNow && (
                    <div className={styles.offHoursBanner}>
                      Tichetul cu prioritate <b>Ridicată</b> va fi preluat cu
                      prioritate imediat după ora 08:00, în următoarea zi
                      lucrătoare.
                    </div>
                  )}

                  <input
                    className={styles.input}
                    value={form.subject}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        subject: e.target.value,
                      }))
                    }
                    placeholder="Subiect"
                    required
                  />
                  <select
                    className={styles.input}
                    value={form.category}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        category: e.target.value,
                      }))
                    }
                  >
                    <option value="general">
                      General
                    </option>
                    <option value="billing">
                      Facturare
                    </option>
                    <option value="store">
                      Magazin / Produse
                    </option>
                    <option value="profile">
                      Profil / Servicii
                    </option>
                    <option value="analytics">
                      Vizitatori / Analytics
                    </option>
                  </select>
                  <select
                    className={styles.input}
                    value={form.priority}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        priority: e.target.value,
                      }))
                    }
                  >
                    <option value="low">
                      Scăzută
                    </option>
                    <option value="medium">
                      Medie
                    </option>
                    <option value="high">
                      Ridicată
                    </option>
                  </select>
                  <HighPriorityHint online={isSupportOnlineNow} />
                  <textarea
                    className={styles.input}
                    rows={4}
                    value={form.message}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        message: e.target.value,
                      }))
                    }
                    placeholder="Descrierea problemei…"
                    required
                  />
                  <div className={styles.attachRow}>
                    <button
                      type="button"
                      className={styles.iconBtn}
                      title="Atașează"
                      onClick={() =>
                        document
                          .getElementById(
                            "support-attach-tab"
                          )
                          ?.click()
                      }
                      aria-label="Atașează"
                    >
                      <Paperclip size={16} />
                    </button>
                    <input
                      id="support-attach-tab"
                      type="file"
                      multiple
                      style={{ display: "none" }}
                      onChange={(e) => {
                        const files = Array.from(
                          e.target.files || []
                        );
                        setForm((f) => ({
                          ...f,
                          attachments: files,
                        }));
                      }}
                    />
                    <div className={styles.muted}>
                      {form.attachments?.length
                        ? `${form.attachments.length} fișier(e)`
                        : "Atașamente (opțional)"}
                    </div>
                    <button
                      className={styles.primary}
                      disabled={creating}
                    >
                      {creating ? (
                        <Loader2
                          size={16}
                          className={styles.spin}
                        />
                      ) : (
                        <Plus size={16} />
                      )}{" "}
                      Trimite
                    </button>
                  </div>
                </form>
              )}

              {/* TAB: FAQ */}
              {mobileTab === "faq" && (
                <div style={{ marginTop: 12 }}>
                  <FAQSheet faqItems={faqItems} />
                </div>
              )}
            </>
          ) : (
            <TicketDetailPanel
              current={current}
              loadingMsgs={loadingMsgs}
              errMsgs={errMsgs}
              msgs={msgs}
              lastReadAt={lastReadAt}
              listRef={listRef}
              onEditMessage={editMessage}
              onDeleteMessage={deleteMessage}
              onDeleteTicket={() =>
                deleteTicket(current?.id)
              }
              onSendReply={handleReply}
              showToBottom={showToBottom}
              setSelectedId={setSelectedId}
              isMobile={true}
            />
          )}
        </>
      )}

      {/* ===== Bottom sheets ===== */}
      <BottomSheet
        open={showFilterSheet}
        onClose={() => setShowFilterSheet(false)}
        title="Filtre & sortare"
      >
        <div className={styles.popoverRow}>
          <label>Prioritate</label>
          <select
            value={priority}
            onChange={(e) =>
              setPriority(e.target.value)
            }
            className={styles.input}
          >
            <option value="all">Toate</option>
            <option value="high">Ridicată</option>
            <option value="medium">Medie</option>
            <option value="low">Scăzută</option>
          </select>
        </div>
        <div className={styles.popoverRow}>
          <label>Sortare</label>
          <select
            value={sort}
            onChange={(e) =>
              setSort(e.target.value)
            }
            className={styles.input}
          >
            <option value="recent">
              Cele mai recente
            </option>
            <option value="priority">
              Prioritate
            </option>
          </select>
        </div>
        <div className={styles.divider} />
        <button
          className={styles.primary}
          onClick={() => {
            setShowFilterSheet(false);
            reload({ hard: true });
          }}
        >
          Aplică
        </button>
      </BottomSheet>

      {!hideNewTicket && (
        <BottomSheet
          open={showNewSheet}
          onClose={() => setShowNewSheet(false)}
          title="Tichet nou"
        >
          {/* banner special pentru Ridicată în afara programului */}
          {form.priority === "high" && !isSupportOnlineNow && (
            <div className={styles.offHoursBanner}>
              Tichetul cu prioritate <b>Ridicată</b> va fi preluat cu prioritate
              imediat după ora 08:00, în următoarea zi lucrătoare.
            </div>
          )}

          <form className={styles.form} onSubmit={handleCreate}>
            <input
              className={styles.input}
              value={form.subject}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  subject: e.target.value,
                }))
              }
              placeholder="Subiect"
              required
            />
            <select
              className={styles.input}
              value={form.category}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  category: e.target.value,
                }))
              }
            >
              <option value="general">General</option>
              <option value="billing">Facturare</option>
              <option value="store">
                Magazin / Produse
              </option>
              <option value="profile">
                Profil / Servicii
              </option>
              <option value="analytics">
                Vizitatori / Analytics
              </option>
            </select>
            <select
              className={styles.input}
              value={form.priority}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  priority: e.target.value,
                }))
              }
            >
              <option value="low">Scăzută</option>
              <option value="medium">Medie</option>
              <option value="high">Ridicată</option>
            </select>
            <HighPriorityHint online={isSupportOnlineNow} />
            <textarea
              className={styles.input}
              rows={4}
              value={form.message}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  message: e.target.value,
                }))
              }
              placeholder="Descrierea problemei…"
              required
            />
            <div className={styles.attachRow}>
              <button
                type="button"
                className={styles.iconBtn}
                title="Atașează"
                onClick={() =>
                  document
                    .getElementById(
                      "support-attach-sheet"
                    )
                    ?.click()
                }
                aria-label="Atașează"
              >
                <Paperclip size={16} />
              </button>
              <input
                id="support-attach-sheet"
                type="file"
                multiple
                style={{ display: "none" }}
                onChange={(e) => {
                  const files = Array.from(
                    e.target.files || []
                  );
                  setForm((f) => ({
                    ...f,
                    attachments: files,
                  }));
                }}
              />
              <div className={styles.muted}>
                {form.attachments?.length
                  ? `${form.attachments.length} fișier(e)`
                  : "Atașamente (opțional)"}
              </div>
              <button
                className={styles.primary}
                disabled={creating}
              >
                {creating ? (
                  <Loader2
                    size={16}
                    className={styles.spin}
                  />
                ) : (
                  <Plus size={16} />
                )}{" "}
                Trimite
              </button>
            </div>
          </form>
        </BottomSheet>
      )}

      {/* Sheet full FAQ */}
      <BottomSheet
        open={showFaqSheet}
        onClose={() => setShowFaqSheet(false)}
        title="Întrebări frecvente"
      >
        <FAQSheet faqItems={faqItems} />
      </BottomSheet>
    </div>
  );
}

/* ========= Sub-view: detaliu ========= */
function TicketDetailPanel({
  current,
  loadingMsgs,
  errMsgs,
  msgs,
  lastReadAt,
  listRef,
  onEditMessage,
  onDeleteMessage,
  onDeleteTicket,
  onSendReply,
  showToBottom,
  setSelectedId,
  isMobile,
}) {
  const grouped = useMemo(
    () => groupByDate(msgs),
    [msgs]
  );

  if (!current) {
    return (
      <div className={styles.ticketDetail}>
        <div className={styles.detailEmpty}>
          <LifeBuoy size={26} /> Selectează un
          tichet din listă.
        </div>
      </div>
    );
  }

  return (
    <div
      className={styles.ticketDetail}
      id="ticket-detail"
    >
      <header className={styles.detailHead}>
        {isMobile && (
          <button
            className={`${styles.iconBtn} ${styles.onlyMobile}`}
            onClick={() => setSelectedId(null)}
            title="Înapoi"
            aria-label="Înapoi"
          >
            <ChevronLeft size={16} />
          </button>
        )}
        <div className={styles.detailTitle}>
          <PriorityDot priority={current.priority} />
          <span>{current.subject}</span>
          <StatusBadge status={current.status} />
        </div>
        <div className={styles.actionRow}>
          <button
            className={`${styles.iconBtn} ${styles.danger}`}
            title="Șterge tichet"
            onClick={onDeleteTicket}
          >
            <Trash2 size={16} />
          </button>
        </div>
      </header>

      <div className={styles.msgList} ref={listRef}>
        {loadingMsgs && (
          <div
            className={styles.empty}
            aria-live="polite"
          >
            Se încarcă…
          </div>
        )}
        {errMsgs && (
          <div className={styles.error}>
            Nu am putut încărca discuția.
          </div>
        )}
        {!loadingMsgs && !msgs.length && (
          <div className={styles.empty}>
            Nu există mesaje încă.
            <div style={{ marginTop: 6 }}>
              <em>
                Spune-ne cum te putem ajuta 👋
              </em>
            </div>
          </div>
        )}

        {grouped.map((g, i) => {
          if (g.type === "divider") {
            return (
              <div
                key={`d-${i}`}
                className={styles.dayDivider}
                role="separator"
              >
                <span>{g.label}</span>
              </div>
            );
          }
          const m = g.item;
          const isNew =
            !!lastReadAt &&
            new Date(m.createdAt) > lastReadAt;
          const firstNewIndex = lastReadAt
            ? msgs.findIndex(
                (x) =>
                  new Date(x.createdAt) >
                  lastReadAt
              )
            : -1;
          const shouldShowNewMarker =
            isNew &&
            msgs[firstNewIndex]?.id === m.id;

          return (
            <div key={m.id}>
              {shouldShowNewMarker && (
                <div
                  className={styles.newMarker}
                  aria-label="Mesaje noi"
                >
                  Mesaje noi
                </div>
              )}
              <MessageBubble
                m={m}
                onEdit={(body) =>
                  onEditMessage(m.id, body)
                }
                onDelete={() =>
                  onDeleteMessage(m.id)
                }
              />
            </div>
          );
        })}

        {showToBottom && (
          <button
            className={styles.toBottom}
            onClick={() => {
              const el = listRef.current;
              if (el)
                el.scrollTop =
                  el.scrollHeight + 1000;
            }}
          >
            Mergi la cele mai noi
          </button>
        )}
      </div>

      <TicketComposer
        onSend={onSendReply}
        ticketId={current.id}
      />
    </div>
  );
}

/* ========= Bubble cu edit/ștergere, long-press & preview ========= */
function MessageActionsSheet({
  open,
  onClose,
  onEdit,
  onDelete,
  onCopy,
}) {
  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title="Acțiuni mesaj"
    >
      <div className={styles.sheetList}>
        <button
          className={styles.sheetItem}
          onClick={() => {
            onEdit();
            onClose();
          }}
        >
          ✏️ Editează
        </button>
        <button
          className={`${styles.sheetItem} ${styles.danger}`}
          onClick={() => {
            onDelete();
            onClose();
          }}
        >
          🗑️ Șterge
        </button>
        <button
          className={styles.sheetItem}
          onClick={() => {
            onCopy();
            onClose();
          }}
        >
          📋 Copiază
        </button>
      </div>
    </BottomSheet>
  );
}

function AttachmentPreview({ file, onClose }) {
  if (!file) return null;
  const img = isImg(file?.name || file?.url || "");
  return (
    <BottomSheet
      open={!!file}
      onClose={onClose}
      title={file.name || "Fișier"}
    >
      {img ? (
        <img
          src={file.url}
          alt={file.name}
          style={{ maxWidth: "100%", borderRadius: 12 }}
        />
      ) : (
        <a
          href={file.url}
          target="_blank"
          rel="noreferrer"
          className={styles.primary}
        >
          Deschide
        </a>
      )}
    </BottomSheet>
  );
}

function MessageBubble({ m, onEdit, onDelete }) {
  const mine = m.from === "me";
  const [isEditing, setIsEditing] = useState(false);
  const [text, setText] = useState(m.body);
  const [showSheet, setShowSheet] = useState(false);
  const [preview, setPreview] = useState(null);
  const lp = useLongPress(() => setShowSheet(true));

  useEffect(() => {
    setText(m.body);
  }, [m.body]);

  async function save() {
    const v = (text || "").trim();
    if (!v) return;
    await onEdit(v);
    setIsEditing(false);
  }

  return (
    <div
      className={`${styles.bubbleRow} ${
        mine ? styles.bubbleRight : styles.bubbleLeft
      }`}
    >
      <div className={styles.msgBubbleWrap}>
        <div
          className={`${styles.bubble} ${
            mine ? styles.mine : styles.theirs
          } ${m.failed ? styles.failed : ""}`}
          {...lp}
        >
          {isEditing ? (
            <textarea
              className={styles.input}
              rows={2}
              value={text}
              onChange={(e) =>
                setText(e.target.value)
              }
              onKeyDown={(e) => {
                if (
                  e.key === "Enter" &&
                  (e.metaKey || e.ctrlKey)
                ) {
                  e.preventDefault();
                  save();
                }
                if (e.key === "Escape") {
                  e.preventDefault();
                  setIsEditing(false);
                  setText(m.body);
                }
              }}
            />
          ) : (
            <>{m.body}</>
          )}

          {m.attachments?.length ? (
            <ul
              style={{
                marginTop: 6,
                display: "grid",
                gap: 4,
              }}
            >
              {m.attachments.map((a, i) => (
                <li key={i}>
                  <button
                    type="button"
                    onClick={() => setPreview(a)}
                    className={styles.linkBtn}
                  >
                    {a.name || a.url}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}

          <div className={styles.meta}>
            {fmtTime(m.createdAt)}
            {m.pending && " · în curs…"}
            {m.failed && " · nereușit"}
          </div>
        </div>

        {mine && (
          <div className={styles.msgActions}>
            {!isEditing ? (
              <>
                <button
                  className={styles.iconBtn}
                  title="Editează"
                  onClick={() =>
                    setIsEditing(true)
                  }
                >
                  <Pencil size={14} />
                </button>
                <button
                  className={`${styles.iconBtn} ${styles.danger}`}
                  title="Șterge"
                  onClick={onDelete}
                >
                  <Trash2 size={14} />
                </button>
              </>
            ) : (
              <>
                <button
                  className={styles.primary}
                  onClick={save}
                >
                  Salvează
                </button>
                <button
                  className={styles.iconBtn}
                  onClick={() => {
                    setIsEditing(false);
                    setText(m.body);
                  }}
                >
                  <X size={14} />
                </button>
              </>
            )}
          </div>
        )}
      </div>

      <MessageActionsSheet
        open={showSheet}
        onClose={() => setShowSheet(false)}
        onEdit={() => setIsEditing(true)}
        onDelete={onDelete}
        onCopy={() =>
          navigator.clipboard?.writeText(
            m.body || ""
          )
        }
      />
      <AttachmentPreview
        file={preview}
        onClose={() => setPreview(null)}
      />
    </div>
  );
}

/* ========= Composer ========= */
function TicketComposer({ onSend, ticketId }) {
  const [text, setText] = useState("");
  const [files, setFiles] = useState([]);
  const [sending, setSending] = useState(false);
  const taRef = useRef(null);
  const fileRef = useRef(null);

  // draft per tichet
  useEffect(() => {
    if (!ticketId) return;
    setText(storage.get(`support:draft:${ticketId}`, ""));
    setFiles([]);
    taRef.current?.focus();
  }, [ticketId]);
  useEffect(() => {
    if (!ticketId) return;
    storage.set(`support:draft:${ticketId}`, text);
  }, [text, ticketId]);

  // autosize
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height =
      Math.min(el.scrollHeight, 140) + "px";
  }, [text]);

  function onPickFiles(e) {
    const picked = Array.from(e.target.files || []);
    if (!picked.length) return;
    setFiles((prev) => [...prev, ...picked]);
    e.target.value = "";
  }
  function removeFile(idx) {
    setFiles((list) =>
      list.filter((_, i) => i !== idx)
    );
  }

  // drag & drop + paste
  function onDrop(e) {
    e.preventDefault();
    const dropped = Array.from(
      e.dataTransfer?.files || []
    );
    if (dropped.length)
      setFiles((prev) => [...prev, ...dropped]);
  }
  function onPaste(e) {
    const items = Array.from(
      e.clipboardData?.items || []
    );
    const blobs = items
      .filter((it) => it.kind === "file")
      .map((it) => it.getAsFile())
      .filter(Boolean);
    if (blobs.length) {
      e.preventDefault();
      setFiles((prev) => [...prev, ...blobs]);
    }
  }

  async function send() {
    const value = text.trim();
    if (!value && !files.length) return;
    if (sending) return;
    setSending(true);
    await onSend(value, files);
    setText("");
    setFiles([]);
    storage.del(`support:draft:${ticketId}`);
    setSending(false);
    taRef.current?.focus();
  }

  function handleKey(e) {
    const metaEnter =
      e.key === "Enter" &&
      (e.metaKey || e.ctrlKey);
    if ((e.key === "Enter" && !e.shiftKey) || metaEnter) {
      e.preventDefault();
      send();
    }
  }

  return (
    <footer
      className={styles.composer}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
      onPaste={onPaste}
      aria-label="Scrie un răspuns"
    >
      <button
        type="button"
        className={styles.iconBtn}
        title="Atașează"
        aria-label="Atașează fișiere"
        onClick={() => fileRef.current?.click()}
      >
        <Paperclip size={16} />
      </button>
      <input
        ref={fileRef}
        type="file"
        multiple
        style={{ display: "none" }}
        onChange={onPickFiles}
      />

      <textarea
        id="composer-input"
        ref={taRef}
        className={styles.input}
        rows={1}
        placeholder="Scrie un răspuns…"
        value={text}
        onChange={(e) =>
          setText(e.target.value)
        }
        onKeyDown={handleKey}
        disabled={sending}
      />
      <button
        className={styles.primary}
        onClick={send}
        disabled={
          sending ||
          (!text.trim() && !files.length)
        }
      >
        {sending ? (
          <Loader2
            size={16}
            className={styles.spin}
          />
        ) : (
          <Send size={16} />
        )}{" "}
        Trimite
      </button>

      {!!files.length && (
        <div
          style={{
            gridColumn: "1 / -1",
            display: "flex",
            flexWrap: "wrap",
            gap: 6,
            marginTop: 6,
          }}
        >
          {files.map((f, i) => (
            <span
              key={i}
              className={styles.fileChip}
            >
              <Paperclip size={12} />
              <span
                className={styles.fileChipName}
              >
                {f.name}
              </span>
              <button
                type="button"
                aria-label="Remove"
                onClick={() => removeFile(i)}
                className={
                  styles.fileChipRemove
                }
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      )}
    </footer>
  );
}

/* ========= FAQ ========= */
function FAQItem({ q, a }) {
  const [open, setOpen] = useState(
    storage.get(`faq:${q}`) === "1"
  );
  useEffect(
    () =>
      storage.set(
        `faq:${q}`,
        open ? "1" : "0"
      ),
    [open, q]
  );

  return (
    <details
      className={`${styles.faqItem} ${styles.accordion}`}
      open={open}
      onToggle={(e) => setOpen(e.target.open)}
    >
      <summary>
        <ChevronRight
          size={14}
          style={{
            transform: open
              ? "rotate(90deg)"
              : "rotate(0deg)",
            transition: ".15s",
          }}
        />
        {q}
      </summary>
      <div className={styles.accBody}>{a}</div>
    </details>
  );
}

function FAQBlock({ onOpenFull, faqItems }) {
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return faqItems;
    return faqItems.filter(
      (f) =>
        f.q.toLowerCase().includes(term) ||
        f.a.toLowerCase().includes(term)
    );
  }, [q, faqItems]);

  const preview = filtered.slice(0, 3);

  return (
    <div className={styles.card}>
      <div className={styles.head}>
        <SearchIcon size={16} /> Întrebări frecvente
      </div>
      <div className={styles.search}>
        <SearchIcon size={16} />
        <input
          placeholder="Caută în FAQ…"
          value={q}
          onChange={(e) =>
            setQ(e.target.value)
          }
        />
      </div>

      {!preview.length && (
        <div className={styles.empty}>
          Nicio întrebare găsită.
        </div>
      )}

      <div className={styles.faqList}>
        {preview.map((f, i) => (
          <FAQItem key={i} q={f.q} a={f.a} />
        ))}
      </div>

      <button
        type="button"
        className={styles.faqMoreBtn}
        onClick={onOpenFull}
      >
        Vezi toate întrebările ({filtered.length})
      </button>

      <div className={styles.tip}>
        <XCircle size={14} /> Dacă problema e
        critică (ex. plăți), creează un tichet cu
        prioritate <b>Ridicată</b>.
      </div>
    </div>
  );
}

function FAQSheet({ faqItems }) {
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return faqItems;
    return faqItems.filter(
      (f) =>
        f.q.toLowerCase().includes(term) ||
        f.a.toLowerCase().includes(term)
    );
  }, [q, faqItems]);

  return (
    <div className={styles.faqSheetBody}>
      <div className={styles.search}>
        <SearchIcon size={16} />
        <input
          placeholder="Caută în toate întrebările…"
          value={q}
          onChange={(e) =>
            setQ(e.target.value)
          }
        />
      </div>

      {!filtered.length && (
        <div className={styles.empty}>
          Nicio întrebare găsită.
        </div>
      )}

      <div className={styles.faqList}>
        {filtered.map((f, i) => (
          <FAQItem key={i} q={f.q} a={f.a} />
        ))}
      </div>
    </div>
  );
}
