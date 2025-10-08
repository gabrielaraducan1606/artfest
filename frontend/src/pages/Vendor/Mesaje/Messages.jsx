// src/pages/Messages/Messages.jsx
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
} from "lucide-react";
import styles from "./Messages.module.css";

/* ========= Utils ========= */
const nowIso = () => new Date().toISOString();

function fmtTime(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  const today = new Date();
  const isToday = d.toDateString() === today.toDateString();
  const diffDays = Math.floor((today - d) / 86400000);
  if (isToday) return d.toLocaleTimeString("ro-RO", { hour: "2-digit", minute: "2-digit" });
  if (diffDays < 7) return d.toLocaleDateString("ro-RO", { weekday: "short", hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString("ro-RO", { day: "2-digit", month: "short" });
}

function initialsOf(name = "U") {
  return name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

/* ========= Demo fallback ========= */
function demoThreads() {
  return [
    {
      id: "t1",
      name: "Andreea Marinescu",
      phone: "07xx xxx xxx",
      lastMsg: "Mulțumesc pentru răspuns!",
      lastAt: new Date(Date.now() - 2 * 3600000).toISOString(),
      unreadCount: 0,
    },
    {
      id: "t2",
      name: "Mihai Pop",
      phone: "07xx xxx xxx",
      lastMsg: "Care e disponibilitatea în iunie?",
      lastAt: new Date(Date.now() - 6 * 3600000).toISOString(),
      unreadCount: 2,
    },
    {
      id: "t3",
      name: "Cristina B",
      phone: null,
      lastMsg: "Vă trimit detaliile locației.",
      lastAt: new Date(Date.now() - 86400000).toISOString(),
      unreadCount: 0,
    },
  ];
}
function demoMessages(threadId) {
  const map = {
    t1: [
      { id: "m1", threadId, from: "them", authorName: "Andreea", body: "Bună! Am primit oferta.", createdAt: new Date(Date.now() - 3 * 3600000).toISOString() },
      { id: "m2", threadId, from: "me", body: "Super! Revin cu calendarul.", createdAt: new Date(Date.now() - 2.8 * 3600000).toISOString() },
    ],
    t2: [
      { id: "m3", threadId, from: "them", authorName: "Mihai", body: "Care e disponibilitatea în iunie?", createdAt: new Date(Date.now() - 7 * 3600000).toISOString() },
      { id: "m4", threadId, from: "me", body: "Pe 7 și 21 suntem liberi.", createdAt: new Date(Date.now() - 6.5 * 3600000).toISOString() },
    ],
    t3: [{ id: "m5", threadId, from: "them", authorName: "Cristina", body: "Vă trimit detaliile locației.", createdAt: new Date(Date.now() - 26 * 3600000).toISOString() }],
  };
  return map[threadId] || [];
}

/* ========= Hooks ========= */
function useThreads({ scope, q }) {
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
      const url = `/api/inbox/threads?scope=${encodeURIComponent(scope)}${dq ? `&q=${encodeURIComponent(dq)}` : ""}`;
      const d = await api(url).catch(() => null);
      if (d?.items) setItems(d.items);
      else setItems(demoThreads());
    } catch (e) {
      setError(e?.message || "Eroare la încărcarea conversațiilor");
    } finally {
      setLoading(false);
    }
  }, [scope, dq]);

  useEffect(() => {
    // load on first mount & when deps change
    reload();
  }, [reload]);

  useEffect(() => {
    // polling
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
      const d = await api(`/api/inbox/threads/${threadId}/messages`).catch(() => null);
      if (d?.items) setMsgs(d.items);
      else setMsgs(demoMessages(threadId));
      // mark as read (best-effort)
      await api(`/api/inbox/threads/${threadId}/read`, { method: "PATCH" }).catch(() => {});
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
export default function MessagesPage() {
  const [scope, setScope] = useState("all"); // all | unread | archived
  const [q, setQ] = useState("");

  const {
    loading: loadingThreads,
    items: threads,
    error: errThreads,
    reload: reloadThreads,
  } = useThreads({ scope, q });

  const [selectedId, setSelectedId] = useState(null);

  // selectăm implicit prima conversație după încărcare
  useEffect(() => {
    if (!selectedId && threads.length) setSelectedId(threads[0].id);
  }, [threads, selectedId]);

  const current = useMemo(() => threads.find((t) => t.id === selectedId) || null, [threads, selectedId]);

  const {
    loading: loadingMsgs,
    msgs,
    error: errMsgs,
    setMsgs,
    reload: reloadMsgs,
  } = useMessages(selectedId);

  // auto scroll la capăt
  const listRef = useRef(null);
  useEffect(() => {
    if (!listRef.current) return;
    listRef.current.scrollTop = listRef.current.scrollHeight + 1000;
  }, [msgs, selectedId, loadingMsgs]);

  // compose
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);

  async function handleSend() {
    const content = text.trim();
    if (!content || !selectedId) return;
    const optimistic = {
      id: `local_${Date.now()}`,
      threadId: selectedId,
      from: "me",
      body: content,
      createdAt: nowIso(),
      pending: true,
    };
    setMsgs((m) => [...m, optimistic]);
    setText("");
    setSending(true);
    try {
      await api(`/api/inbox/threads/${selectedId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: content }),
      });
      await reloadMsgs();
      await reloadThreads();
    } catch {
      setMsgs((m) => m.map((x) => (x.id === optimistic.id ? { ...x, failed: true, pending: false } : x)));
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

  // fallback filtrare locală pt necitite dacă API nu face scope-ul
  const visibleThreads = useMemo(() => {
    if (scope !== "unread") return threads;
    return threads.filter((t) => (t.unreadCount || 0) > 0);
  }, [threads, scope]);

  return (
    <div className={styles.wrap}>
      {/* Sidebar conversații */}
      <aside className={styles.sidebar}>
        <div className={styles.sideHead}>
          <div className={styles.sideTitle}>
            <MessageSquare size={18} /> Mesaje
          </div>
          <button className={styles.iconBtn} title="Reîncarcă" onClick={reloadThreads}>
            <Loader2 size={16} />
          </button>
        </div>

        <div className={styles.searchBar}>
          <SearchIcon size={16} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Caută nume, telefon, mesaj…" />
          <button className={styles.iconBtn} title="Filtre">
            <Filter size={16} />
          </button>
        </div>

        <div className={styles.scopeTabs}>
          <button className={`${styles.tab} ${scope === "all" ? styles.active : ""}`} onClick={() => setScope("all")}>
            <Inbox size={14} /> Toate
          </button>
          <button className={`${styles.tab} ${scope === "unread" ? styles.active : ""}`} onClick={() => setScope("unread")}>
            Necitite
          </button>
          <button className={`${styles.tab} ${scope === "archived" ? styles.active : ""}`} onClick={() => setScope("archived")}>
            <Archive size={14} /> Arhivate
          </button>
        </div>

        <div className={styles.threadList}>
          {loadingThreads && <div className={styles.empty}>Se încarcă…</div>}
          {errThreads && <div className={styles.error}>Nu am putut încărca conversațiile.</div>}
          {!loadingThreads && !visibleThreads.length && <div className={styles.empty}>Nu există conversații.</div>}

          {visibleThreads.map((t) => (
            <button key={t.id} className={`${styles.threadItem} ${t.id === selectedId ? styles.selected : ""}`} onClick={() => setSelectedId(t.id)}>
              <div className={styles.avatar}>{initialsOf(t.name || "U")}</div>
              <div className={styles.threadMeta}>
                <div className={styles.row}>
                  <span className={styles.name}>{t.name || "Vizitator"}</span>
                  <span className={styles.time}>{fmtTime(t.lastAt)}</span>
                </div>
                <div className={styles.row}>
                  <span className={styles.snippet}>{t.lastMsg || "—"}</span>
                  {t.unreadCount > 0 && <span className={styles.badge}>{Math.min(t.unreadCount, 99)}</span>}
                </div>
              </div>
            </button>
          ))}
        </div>
      </aside>

      {/* Chat */}
      <section className={styles.chat}>
        {!current ? (
          <div className={styles.chatEmpty}>
            <MessageSquare size={28} />
            <div>Selectează o conversație din stânga.</div>
          </div>
        ) : (
          <>
            <header className={styles.chatHead}>
              <button className={`${styles.iconBtn} ${styles.hideDesktop}`} onClick={() => setSelectedId(null)} title="Înapoi la listă">
                <ChevronLeft size={18} />
              </button>
              <div className={styles.chatPeer}>
                <div className={styles.avatarLg}>{initialsOf(current.name || "U")}</div>
                <div>
                  <div className={styles.peerName}>{current.name || "Vizitator"}</div>
                  {current.phone && <div className={styles.peerSub}>{current.phone}</div>}
                </div>
              </div>
              <div className={styles.chatActions}>
                <button className={styles.iconBtn} title="Arhivează">
                  <Archive size={18} />
                </button>
              </div>
            </header>

            <div className={styles.msgList} ref={listRef}>
              {loadingMsgs && <div className={styles.loading}>Se încarcă…</div>}
              {errMsgs && <div className={styles.error}>Nu am putut încărca mesajele.</div>}
              {msgs.map((m) => (
                <MessageBubble key={m.id} mine={m.from === "me"} msg={m} />
              ))}
            </div>

            <footer className={styles.composer}>
              <button className={styles.iconBtn} title="Atașează">
                <Paperclip size={18} />
              </button>
              <textarea
                className={styles.input}
                rows={1}
                placeholder="Scrie un mesaj…"
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={handleKey}
              />
              <button className={styles.sendBtn} onClick={handleSend} disabled={!text.trim() || sending}>
                <Send size={16} /> Trimite
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
  return (
    <div className={`${styles.bubbleRow} ${mine ? styles.right : styles.left}`}>
      {!mine && <div className={styles.avatarSm}>{initialsOf(msg.authorName || "U")}</div>}
      <div className={`${styles.bubble} ${mine ? styles.mine : styles.theirs}`}>
        {msg.body}
        <div className={styles.meta}>
          <span>{fmtTime(msg.createdAt)}</span>
          {msg.pending && <span> · în curs…</span>}
          {msg.failed && <span> · nereușit</span>}
        </div>
      </div>
    </div>
  );
}
