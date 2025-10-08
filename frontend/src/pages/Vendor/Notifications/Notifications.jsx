import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../../../lib/api";
import {
  Bell,
  Mail,
  MessageSquare,
  CreditCard,
  ShoppingCart,
  AlertTriangle,
  ExternalLink,
  Archive,
  Trash2,
  Check,
  Loader2,
  RefreshCw,
  Filter,
  Search as SearchIcon,
} from "lucide-react";
import styles from "./Notifications.module.css";

/* ===== Utils ===== */
function cls(...xs) { return xs.filter(Boolean).join(" "); }
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
function IconByType({ type }) {
  if (type === "message") return <MessageSquare size={16} />;
  if (type === "order") return <ShoppingCart size={16} />;
  if (type === "billing") return <CreditCard size={16} />;
  if (type === "system") return <AlertTriangle size={16} />;
  if (type === "email") return <Mail size={16} />;
  return <Bell size={16} />;
}

/* ===== Demo fallback ===== */
function demoItems() {
  const now = Date.now();
  return [
    { id: "n1", type: "message", title: "Mesaj nou de la Andreea", body: "„Bună! Sunteți disponibili pe 21 iunie?”", createdAt: new Date(now - 60*60000).toISOString(), readAt: null, archived: false, link: "/mesaje" },
    { id: "n2", type: "order", title: "Comandă #AF-1024", body: "Plasată de către Mihai Pop", createdAt: new Date(now - 4*3600000).toISOString(), readAt: null, archived: false, link: "/comenzile-mele" },
    { id: "n3", type: "billing", title: "Factura #INV-204", body: "Scadență în 3 zile", createdAt: new Date(now - 26*3600000).toISOString(), readAt: new Date(now - 25*3600000).toISOString(), archived: false, link: "/facturare" },
    { id: "n4", type: "system", title: "Actualizare platformă", body: "Am îmbunătățit pagina de Vizitatori.", createdAt: new Date(now - 6*86400000).toISOString(), readAt: new Date(now - 5*86400000).toISOString(), archived: true, link: null },
  ];
}

/* ===== Data hook ===== */
function useNotifications({ scope, q }) {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState([]);
  const [error, setError] = useState(null);

  // debounce search
  const [dq, setDq] = useState(q);
  useEffect(() => {
    const id = setTimeout(() => setDq(q), 300);
    return () => clearTimeout(id);
  }, [q]);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const url = `/api/notifications?scope=${encodeURIComponent(scope)}${dq ? `&q=${encodeURIComponent(dq)}` : ""}`;
      const d = await api(url).catch(() => null);
      if (d?.items) setItems(d.items);
      else setItems(demoItems());
    } catch (e) {
      setError(e?.message || "Eroare la încărcarea notificărilor");
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

/* ===== Page ===== */
export default function NotificationsPage() {
  const [scope, setScope] = useState("all"); // all | unread | archived
  const [q, setQ] = useState("");
  const { loading, items, error, reload, setItems } = useNotifications({ scope, q });

  const unreadCount = useMemo(() => items.filter(n => !n.readAt && !n.archived).length, [items]);

  // actions
  const markRead = useCallback(async (id) => {
    setItems(list => list.map(n => n.id === id ? { ...n, readAt: n.readAt || new Date().toISOString() } : n));
    await api(`/api/notifications/${id}/read`, { method: "PATCH" }).catch(() => {});
    reload();
  }, [reload, setItems]);

  const archive = useCallback(async (id) => {
    setItems(list => list.map(n => n.id === id ? { ...n, archived: true } : n));
    await api(`/api/notifications/${id}/archive`, { method: "PATCH" }).catch(() => {});
    reload();
  }, [reload, setItems]);

  const openLink = useCallback(async (n) => {
    if (!n.link) return;
    if (!n.readAt) {
      await api(`/api/notifications/${n.id}/read`, { method: "PATCH" }).catch(() => {});
    }
    window.location.href = n.link;
  }, []);

  const markAllRead = useCallback(async () => {
    setItems(list => list.map(n => n.archived ? n : ({ ...n, readAt: n.readAt || new Date().toISOString() })));
    await api("/api/notifications/read-all", { method: "PATCH" }).catch(() => {});
    reload();
  }, [reload, setItems]);

  const filtered = useMemo(() => {
    if (scope === "unread") return items.filter(n => !n.readAt && !n.archived);
    if (scope === "archived") return items.filter(n => n.archived);
    return items.filter(n => !n.archived); // „Toate” = ne-arhivate
  }, [items, scope]);

  return (
    <div className={styles.wrap}>
      <header className={styles.head}>
        <div className={styles.title}><Bell size={18}/> Notificări</div>
        <div className={styles.actions}>
          <button className={styles.iconBtn} onClick={reload} title="Reîncarcă"><RefreshCw size={16}/></button>
          <button className={styles.primary} onClick={markAllRead} disabled={!unreadCount}>
            <Check size={16}/> Marchează toate ca citite
          </button>
        </div>
      </header>

      <div className={styles.toolbar}>
        <div className={styles.tabs}>
          <button className={cls(styles.tab, scope==="all" && styles.active)} onClick={()=>setScope("all")}>Toate</button>
          <button className={cls(styles.tab, scope==="unread" && styles.active)} onClick={()=>setScope("unread")}>
            Necitite {unreadCount ? <span className={styles.badge}>{Math.min(unreadCount,99)}</span> : null}
          </button>
          <button className={cls(styles.tab, scope==="archived" && styles.active)} onClick={()=>setScope("archived")}>Arhivate</button>
        </div>

        <div className={styles.search}>
          <SearchIcon size={16}/>
          <input placeholder="Caută după titlu sau conținut…" value={q} onChange={(e)=>setQ(e.target.value)}/>
          <button className={styles.iconBtn} title="Filtre"><Filter size={16}/></button>
        </div>
      </div>

      <div className={styles.list}>
        {loading && <div className={styles.info}><Loader2 className={styles.spin} size={16}/> Se încarcă…</div>}
        {error && <div className={styles.error}>Nu am putut încărca notificările.</div>}
        {!loading && !filtered.length && <div className={styles.info}>Nu există notificări.</div>}

        {filtered.map(n => (
          <article key={n.id} className={cls(styles.item, !n.readAt && styles.unread)}>
            <div className={styles.icon}><IconByType type={n.type}/></div>
            <div className={styles.body} onClick={()=>openLink(n)} role={n.link ? "button" : undefined}>
              <div className={styles.row}>
                <div className={styles.itemTitle}>{n.title}</div>
                <div className={styles.time}>{fmtTime(n.createdAt)}</div>
              </div>
              <div className={styles.itemText}>{n.body}</div>
              {n.link && <div className={styles.link}><ExternalLink size={14}/> Deschide</div>}
            </div>
            <div className={styles.rowActions}>
              {!n.readAt && <button className={styles.ghostBtn} onClick={()=>markRead(n.id)} title="Marchează citit"><Check size={16}/></button>}
              {!n.archived && <button className={styles.ghostBtn} onClick={()=>archive(n.id)} title="Arhivează"><Archive size={16}/></button>}
              {/* Exemplu: ștergere (opțional) */}
              {/* <button className={styles.ghostBtn} onClick={()=>remove(n.id)} title="Șterge"><Trash2 size={16}/></button> */}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
