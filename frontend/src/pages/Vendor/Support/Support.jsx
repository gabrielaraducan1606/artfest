import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../../lib/api";
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
} from "lucide-react";
import styles from "./Support.module.css";

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

/* ========= Demo fallback ========= */
function demoTickets() {
  return [
    { id: "tk_1", subject: "Nu se încarcă imaginile pe profil", status: "open", priority: "high", updatedAt: new Date(Date.now()-2*3600000).toISOString() },
    { id: "tk_2", subject: "Problemă facturare: factură dublă", status: "pending", priority: "medium", updatedAt: new Date(Date.now()-26*3600000).toISOString() },
    { id: "tk_3", subject: "Cum activez invitația digitală?", status: "closed", priority: "low", updatedAt: new Date(Date.now()-4*86400000).toISOString() },
  ];
}
function demoFaq() {
  return [
    { q: "Cum îmi public profilul?", a: "Mergi la Onboarding → Detalii profil → Publică. Asigură-te că ai completat descrierea și cel puțin 3 imagini." },
    { q: "Cum conectez domeniul personal?", a: "Planurile Pro permit maparea unui domeniu. Deschide un tichet la Asistență pentru a primi instrucțiunile DNS." },
    { q: "Cum export rapoartele de vizitatori?", a: "În Vizitatori → Export CSV. Poți alege intervalul dorit din picker-ul de date." },
  ];
}
function demoMessages(ticketId) {
  const map = {
    tk_1: [
      { id: "m1", ticketId, from: "them", body: "Salut! Investigăm problema imaginilor.", createdAt: new Date(Date.now()-90*60000).toISOString() },
      { id: "m2", ticketId, from: "me", body: "Mulțumesc. Pot oferi linkuri de exemplu.", createdAt: new Date(Date.now()-80*60000).toISOString() },
    ],
  };
  return map[ticketId] || [];
}

/* ========= Hooks ========= */
function useTickets({ scope, q }) {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState([]);
  const [error, setError] = useState(null);

  // debounce pentru search
  const [dq, setDq] = useState(q);
  useEffect(() => {
    const id = setTimeout(() => setDq(q), 300);
    return () => clearTimeout(id);
  }, [q]);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const url = `/api/support/me/tickets?status=${encodeURIComponent(scope)}${dq ? `&q=${encodeURIComponent(dq)}` : ""}`;
      const d = await api(url).catch(() => null);
      if (d?.items) setItems(d.items);
      else setItems(demoTickets());
    } catch (e) {
      setError(e?.message || "Eroare la încărcarea tichetelor");
    } finally {
      setLoading(false);
    }
  }, [scope, dq]);

  useEffect(() => { reload(); }, [reload]);

  // polling ușor
  useEffect(() => {
    const id = setInterval(reload, 15000);
    return () => clearInterval(id);
  }, [reload]);

  return { loading, items, error, reload, setItems };
}

function useTicketMessages(ticketId) {
  const [loading, setLoading] = useState(false);
  const [msgs, setMsgs] = useState([]);
  const [error, setError] = useState(null);

  const reload = useCallback(async () => {
    if (!ticketId) return;
    setLoading(true);
    setError(null);
    try {
      const d = await api(`/api/support/tickets/${ticketId}/messages`).catch(() => null);
      if (d?.items) setMsgs(d.items);
      else setMsgs(demoMessages(ticketId));
      // mark read (best-effort)
      await api(`/api/support/tickets/${ticketId}/read`, { method: "PATCH" }).catch(()=>{});
    } catch (e) {
      setError(e?.message || "Eroare la încărcarea mesajelor");
    } finally {
      setLoading(false);
    }
  }, [ticketId]);

  useEffect(() => { reload(); }, [reload]);

  useEffect(() => {
    if (!ticketId) return;
    const id = setInterval(reload, 10000);
    return () => clearInterval(id);
  }, [ticketId, reload]);

  return { loading, msgs, error, setMsgs, reload };
}

/* ========= Sub-componente ========= */
function StatusBadge({ status }) {
  if (status === "open") return <span className={`${styles.badge} ${styles.open}`}><CircleDot size={12}/> Deschis</span>;
  if (status === "pending") return <span className={`${styles.badge} ${styles.pending}`}><Loader2 size={12}/> În lucru</span>;
  return <span className={`${styles.badge} ${styles.closed}`}><CheckCircle2 size={12}/> Închis</span>;
}
function PriorityDot({ priority }) {
  const cls = priority === "high" ? styles.pHigh : priority === "medium" ? styles.pMed : styles.pLow;
  return <span className={`${styles.priority} ${cls}`} title={`Prioritate: ${priority}`} />;
}

/* ========= Pagina ========= */
export default function SupportPage() {
  const [scope, setScope] = useState("all"); // all | open | pending | closed
  const [q, setQ] = useState("");
  const { loading, items: tickets, error, reload } = useTickets({ scope, q });

  const [selectedId, setSelectedId] = useState(null);
  useEffect(() => {
    if (!selectedId && tickets.length) setSelectedId(tickets[0].id);
  }, [tickets, selectedId]);

  const current = useMemo(() => tickets.find(t => t.id === selectedId) || null, [tickets, selectedId]);
  const { loading: loadingMsgs, msgs, error: errMsgs, setMsgs, reload: reloadMsgs } = useTicketMessages(selectedId);

  // form nou tichet
  const [form, setForm] = useState({ subject: "", category: "general", priority: "medium", message: "", attachments: [] });
  const [creating, setCreating] = useState(false);

  const listRef = useRef(null);
  useEffect(() => {
    if (!listRef.current) return;
    listRef.current.scrollTop = listRef.current.scrollHeight + 1000;
  }, [msgs, selectedId, loadingMsgs]);

  async function handleCreate(e) {
    e.preventDefault();
    if (!form.subject.trim() || !form.message.trim()) return;
    setCreating(true);
    try {
      const payload = { ...form, attachments: [] }; // atașamentele se pot adăuga ulterior ca upload separat
      const d = await api("/api/support/tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      }).catch(()=>null);
      // dacă API nu răspunde, simulăm un tichet creat
      const created = d?.ticket || {
        id: `tk_${Date.now()}`,
        subject: form.subject,
        status: "open",
        priority: form.priority,
        updatedAt: nowIso()
      };
      // refresh listă & selectează
      await reload();
      setSelectedId(created.id);
      // reset form
      setForm({ subject: "", category: "general", priority: "medium", message: "", attachments: [] });
    } finally {
      setCreating(false);
    }
  }

  async function handleReply(content) {
    if (!content.trim() || !selectedId) return;
    const optimistic = {
      id: `local_${Date.now()}`,
      ticketId: selectedId,
      from: "me",
      body: content,
      createdAt: nowIso(),
      pending: true,
    };
    setMsgs(m => [...m, optimistic]);

    try {
      await api(`/api/support/tickets/${selectedId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: content })
      });
      await reloadMsgs();
      await reload();
    } catch {
      // marchează ca eșuat local
      setMsgs(m => m.map(x => x.id === optimistic.id ? { ...x, failed: true, pending: false } : x));
    }
  }

  return (
    <div className={styles.wrap}>
      {/* stânga: deschide tichet + FAQ */}
      <aside className={styles.left}>
        <div className={styles.card}>
          <div className={styles.head}><LifeBuoy size={18}/> Deschide un tichet</div>
          <form className={styles.form} onSubmit={handleCreate}>
            <label>
              Subiect
              <input
                className={styles.input}
                value={form.subject}
                onChange={e=>setForm(f=>({ ...f, subject: e.target.value }))}
                placeholder="Ex: Nu pot publica profilul"
                required
              />
            </label>

            <div className={styles.grid2}>
              <label>
                Categoria
                <select className={styles.input} value={form.category} onChange={e=>setForm(f=>({ ...f, category: e.target.value }))}>
                  <option value="general">General</option>
                  <option value="billing">Facturare</option>
                  <option value="store">Magazin / Produse</option>
                  <option value="profile">Profil / Servicii</option>
                  <option value="analytics">Vizitatori / Analytics</option>
                </select>
              </label>
              <label>
                Prioritate
                <select className={styles.input} value={form.priority} onChange={e=>setForm(f=>({ ...f, priority: e.target.value }))}>
                  <option value="low">Scăzută</option>
                  <option value="medium">Medie</option>
                  <option value="high">Ridicată</option>
                </select>
              </label>
            </div>

            <label>
              Descriere
              <textarea
                className={styles.input}
                rows={4}
                value={form.message}
                onChange={e=>setForm(f=>({ ...f, message: e.target.value }))}
                placeholder="Descrie pe scurt problema și pașii de reprodus…"
                required
              />
            </label>

            <div className={styles.attachRow}>
              <button type="button" className={styles.iconBtn} title="Atașează fișiere (opțional)" onClick={()=>document.getElementById("support-attach")?.click()}>
                <Paperclip size={16}/>
              </button>
              <input id="support-attach" type="file" multiple style={{ display: "none" }}
                onChange={(e)=> {
                  const files = Array.from(e.target.files || []);
                  setForm(f=>({ ...f, attachments: files }));
                }}
              />
              <div className={styles.muted}>
                {form.attachments?.length ? `${form.attachments.length} fișier(e) selectate` : "Atașamente opționale (capturi ecran, PDF…)"}
              </div>
              <button className={styles.primary} disabled={creating}>
                <Plus size={16}/> Trimite tichet
              </button>
            </div>
          </form>
        </div>

        <FAQBlock />
      </aside>

      {/* dreapta: listă tichete + detaliu */}
      <section className={styles.right}>
        <div className={styles.toolbar}>
          <div className={styles.tabs}>
            <button className={`${styles.tab} ${scope==="all" ? styles.active : ""}`} onClick={()=>setScope("all")}>Toate</button>
            <button className={`${styles.tab} ${scope==="open" ? styles.active : ""}`} onClick={()=>setScope("open")}>Deschise</button>
            <button className={`${styles.tab} ${scope==="pending" ? styles.active : ""}`} onClick={()=>setScope("pending")}>În lucru</button>
            <button className={`${styles.tab} ${scope==="closed" ? styles.active : ""}`} onClick={()=>setScope("closed")}>Închise</button>
          </div>

          <div className={styles.filters}>
            <div className={styles.search}>
              <SearchIcon size={16}/>
              <input value={q} onChange={e=>setQ(e.target.value)} placeholder="Caută după subiect…" />
            </div>
            <button className={styles.iconBtn} onClick={reload} title="Reîncarcă">
              <RefreshCw size={16}/>
            </button>
            <button className={styles.iconBtn} title="Filtre">
              <Filter size={16}/>
            </button>
          </div>
        </div>

        <div className={styles.split}>
          <div className={styles.ticketList}>
            {loading && <div className={styles.empty}>Se încarcă…</div>}
            {error && <div className={styles.error}>Nu am putut încărca tichetele.</div>}
            {!loading && !tickets.length && <div className={styles.empty}>Nu ai tichete încă.</div>}

            {tickets.map(t => (
              <button
                key={t.id}
                onClick={()=>setSelectedId(t.id)}
                className={`${styles.ticketItem} ${t.id === selectedId ? styles.selected : ""}`}
              >
                <div className={styles.row}>
                  <div className={styles.subject}>
                    <PriorityDot priority={t.priority}/>
                    {t.subject}
                  </div>
                  <div className={styles.time}>{fmtTime(t.updatedAt)}</div>
                </div>
                <div className={styles.row}>
                  <StatusBadge status={t.status}/>
                  <ChevronRight size={16}/>
                </div>
              </button>
            ))}
          </div>

          <div className={styles.ticketDetail}>
            {!current ? (
              <div className={styles.detailEmpty}>
                <LifeBuoy size={26}/> Selectează un tichet din listă.
              </div>
            ) : (
              <>
                <header className={styles.detailHead}>
                  <button className={`${styles.iconBtn} ${styles.onlyMobile}`} onClick={()=>setSelectedId(null)} title="Înapoi">
                    <ChevronLeft size={16}/>
                  </button>
                  <div className={styles.detailTitle}>
                    <PriorityDot priority={current.priority}/>
                    <span>{current.subject}</span>
                    <StatusBadge status={current.status}/>
                  </div>
                </header>

                <div className={styles.msgList} ref={listRef}>
                  {loadingMsgs && <div className={styles.empty}>Se încarcă…</div>}
                  {errMsgs && <div className={styles.error}>Nu am putut încărca discuția.</div>}
                  {msgs.map(m => (
                    <div key={m.id} className={`${styles.bubbleRow} ${m.from === "me" ? styles.right : styles.left}`}>
                      <div className={`${styles.bubble} ${m.from === "me" ? styles.mine : styles.theirs}`}>
                        {m.body}
                        <div className={styles.meta}>{fmtTime(m.createdAt)}{m.pending && " · în curs…"}{m.failed && " · nereușit"}</div>
                      </div>
                    </div>
                  ))}
                </div>

                <TicketComposer onSend={handleReply}/>
              </>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

function TicketComposer({ onSend }) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);

  async function send() {
    if (!text.trim()) return;
    setSending(true);
    await onSend(text);
    setText("");
    setSending(false);
  }
  function handleKey(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }
  return (
    <footer className={styles.composer}>
      <button className={styles.iconBtn} title="Atașează">
        <Paperclip size={16}/>
      </button>
      <textarea
        className={styles.input}
        rows={1}
        placeholder="Scrie un răspuns…"
        value={text}
        onChange={e=>setText(e.target.value)}
        onKeyDown={handleKey}
      />
      <button className={styles.primary} onClick={send} disabled={!text.trim() || sending}>
        <Send size={16}/> Trimite
      </button>
    </footer>
  );
}

function FAQBlock() {
  const [q, setQ] = useState("");
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async ()=>{
    setLoading(true);
    const d = await api(`/api/support/faqs?q=${encodeURIComponent(q)}`).catch(()=>null);
    setItems(d?.items || demoFaq());
    setLoading(false);
  }, [q]);

  useEffect(()=>{ reload(); }, [reload]);

  return (
    <div className={styles.card}>
      <div className={styles.head}><SearchIcon size={16}/> Întrebări frecvente</div>
      <div className={styles.search}>
        <SearchIcon size={16}/>
        <input placeholder="Caută în FAQ…" value={q} onChange={e=>setQ(e.target.value)}/>
      </div>

      {loading && <div className={styles.empty}>Se încarcă…</div>}
      {!loading && !items.length && <div className={styles.empty}>Nicio întrebare găsită.</div>}

      <div className={styles.faqList}>
        {items.map((f, i)=>(
          <details key={i} className={styles.faqItem}>
            <summary>{f.q}</summary>
            <div className={styles.faqAns}>{f.a}</div>
          </details>
        ))}
      </div>

      <div className={styles.tip}>
        <XCircle size={14}/> Dacă problema e critică (ex. plăți), creează un tichet cu prioritate <b>Ridicată</b>.
      </div>
    </div>
  );
}
