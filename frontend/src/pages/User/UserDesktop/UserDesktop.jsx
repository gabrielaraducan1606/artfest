import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../../../lib/api";
import styles from "./UserDesktop.module.css";
import { Heart, ShoppingCart, MessageSquare, Bell, ArrowRight, RefreshCcw } from "lucide-react";

function fmt(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  const today = new Date();
  const isToday = d.toDateString() === today.toDateString();
  if (isToday) return d.toLocaleTimeString("ro-RO", { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString("ro-RO", { day: "2-digit", month: "short" });
}

const demo = {
  orders: [
    { id: "AF-1024", totalCents: 23900, currency: "RON", status: "paid", createdAt: new Date().toISOString() },
    { id: "AF-1023", totalCents: 15900, currency: "RON", status: "shipped", createdAt: new Date(Date.now()-86400000).toISOString() },
  ],
  wishlist: [
    { id: "p1", title: "Set lumânări nuntă", priceCents: 9900, currency: "RON", image: "" },
    { id: "p2", title: "Buchet mireasă pastel", priceCents: 18900, currency: "RON", image: "" },
  ],
  recs: [
    { id: "r1", title: "Fotograf în București", tag: "serviciu", href: "/servicii?categorie=fotografi&zona=Bucuresti" },
    { id: "r2", title: "Formații / DJ populari lângă tine", tag: "serviciu", href: "/servicii?categorie=formatie-dj-mc" },
    { id: "r3", title: "Invitație digitală (demo)", tag: "digital", href: "/digitale/invitatie" },
  ],
  messages: [
    { id: "m1", from: "Studio Foto Lumi", preview: "Mulțumim pentru interes! Suntem disponibili pe 21 iunie…", createdAt: new Date().toISOString(), href: "/mesaje" },
  ],
  notifications: [
    { id: "n1", title: "Reducere 10% la florării", body: "Doar săptămâna asta.", createdAt: new Date().toISOString(), href: "/produse?categorie=florarii" },
  ],
  viewed: [
    { id: "v1", title: "Tort Red Velvet 3 etaje", href: "/produs/v1" },
    { id: "v2", title: "Cabină foto – pachet Basic", href: "/produs/v2" },
  ],
};

function money(cents, cur="RON") {
  if (typeof cents !== "number") return "—";
  return new Intl.NumberFormat("ro-RO", { style: "currency", currency: cur }).format(cents / 100);
}

export default function UserDesktop({ me }) {
  const [loading, setLoading] = useState(true);
  const [orders, setOrders] = useState([]);
  const [wishlist, setWishlist] = useState([]);
  const [recs, setRecs] = useState([]);
  const [msgs, setMsgs] = useState([]);
  const [notifs, setNotifs] = useState([]);
  const [viewed, setViewed] = useState([]);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [
        o, w, r, m, n, v,
      ] = await Promise.all([
        api("/api/orders/me?limit=5").catch(()=>null),
        api("/api/wishlist/items?limit=6").catch(()=>null),
        api("/api/public/products/recommended?limit=8").catch(()=>null),
        api("/api/inbox/threads?limit=5").catch(()=>null),
        api("/api/notifications?scope=unread&limit=5").catch(()=>null),
        api("/api/public/recently-viewed?limit=6").catch(()=>null),
      ]);

      setOrders(o?.items || demo.orders);
      setWishlist(w?.items || demo.wishlist);
      setRecs(r?.items || demo.recs);
      setMsgs(m?.items || demo.messages);
      setNotifs(n?.items || demo.notifications);
      setViewed(v?.items || demo.viewed);
    } catch (e) {
      setError(e?.message || "Eroare la încărcare");
      // fallback demouri
      setOrders(demo.orders);
      setWishlist(demo.wishlist);
      setRecs(demo.recs);
      setMsgs(demo.messages);
      setNotifs(demo.notifications);
      setViewed(demo.viewed);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(()=>{ load(); }, [load]);

  const firstName = useMemo(()=>{
    const n = me?.firstName || me?.name || "";
    return n?.split?.(" ")?.[0] || me?.email;
  }, [me]);

  return (
    <section className={styles.page}>
      <div className={styles.topbar}>
        <div>
          <h1 className={styles.h1}>Salut, {firstName}! 👋</h1>
          <div className={styles.subtle}>Bun venit în contul tău ArtFest.</div>
        </div>
        <div className={styles.actions}>
          <a className={`${styles.btn} ${styles.btnGhost}`} href="/wishlist"><Heart size={16}/> Lista de dorințe</a>
          <a className={`${styles.btn} ${styles.btnGhost}`} href="/cos"><ShoppingCart size={16}/> Coș</a>
          <button className={styles.iconBtn} onClick={load} title="Reîncarcă"><RefreshCcw size={16}/></button>
        </div>
      </div>

      {error && <div className={styles.error}>{error}</div>}
      {loading && <div className={styles.loading}>Se încarcă…</div>}

      <div className={styles.grid}>
        {/* Comenzi recente */}
        <Card title="Comenzile mele" cta={{ href: "/comenzile-mele", label: "Vezi toate" }}>
          {!orders.length ? <Empty text="Nicio comandă încă."/> : (
            <ul className={styles.list}>
              {orders.map(o=>(
                <li key={o.id} className={styles.row}>
                  <div className={styles.rowTitle}>#{o.id}</div>
                  <div className={styles.rowSub}>{fmt(o.createdAt)}</div>
                  <div className={styles.grow} />
                  <span className={`${styles.badge} ${styles[`st_${o.status||"new"}`]}`}>{o.status || "nouă"}</span>
                  <div className={styles.sum}>{money(o.totalCents, o.currency)}</div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Notificări */}
        <Card title="Notificări" icon={<Bell size={16}/>} cta={{ href: "/notificari", label: "Toate notificările" }}>
          {!notifs.length ? <Empty text="Nu ai notificări noi."/> : (
            <ul className={styles.list}>
              {notifs.map(n=>(
                <li key={n.id} className={styles.rowLink} onClick={()=> n.href && (window.location.href=n.href)}>
                  <div className={styles.rowTitle}>{n.title}</div>
                  <div className={styles.rowSub}>{fmt(n.createdAt)}</div>
                  <ArrowRight size={14}/>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Mesaje */}
        <Card title="Mesaje" icon={<MessageSquare size={16}/>} cta={{ href: "/mesaje", label: "Deschide inbox" }}>
          {!msgs.length ? <Empty text="Nu ai conversații."/> : (
            <ul className={styles.list}>
              {msgs.map(m=>(
                <li key={m.id} className={styles.rowLink} onClick={()=> m.href && (window.location.href=m.href)}>
                  <div className={styles.rowTitle}>{m.from}</div>
                  <div className={styles.rowSub}>{m.preview}</div>
                  <div className={styles.grow} />
                  <div className={styles.rowSub}>{fmt(m.createdAt)}</div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Wishlist scurt */}
        <Card title="Din lista ta de dorințe" cta={{ href: "/wishlist", label: "Gestionează" }}>
          {!wishlist.length ? <Empty text="Lista ta e goală."/> : (
            <div className={styles.gridCards}>
              {wishlist.slice(0,6).map(p=>(
                <a key={p.id} className={styles.tile} href={`/produs/${p.id}`}>
                  <div className={styles.thumb} aria-hidden />
                  <div className={styles.tileTitle}>{p.title}</div>
                  <div className={styles.price}>{money(p.priceCents, p.currency)}</div>
                </a>
              ))}
            </div>
          )}
        </Card>

        {/* Recomandări */}
        <Card title="Recomandate pentru tine" cta={{ href: "/servicii", label: "Vezi mai multe" }}>
          {!recs.length ? <Empty text="Nu avem încă recomandări."/> : (
            <div className={styles.tags}>
              {recs.map(r=>(
                <a key={r.id} className={styles.tag} href={r.href || "#"}>{r.title}</a>
              ))}
            </div>
          )}
        </Card>

        {/* Vizualizate recent */}
        <Card title="Ai vizualizat recent">
          {!viewed.length ? <Empty text="Nimic recent."/> : (
            <ul className={styles.list}>
              {viewed.map(v=>(
                <li key={v.id} className={styles.rowLink} onClick={()=> v.href && (window.location.href=v.href)}>
                  <div className={styles.rowTitle}>{v.title}</div>
                  <ArrowRight size={14}/>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </section>
  );
}

/* ===== UI mici ===== */
function Card({ title, icon, cta, children }) {
  return (
    <section className={styles.card}>
      <header className={styles.cardHead}>
        <div className={styles.titleWrap}>
          {icon}{icon ? " " : ""}<span className={styles.title}>{title}</span>
        </div>
        {cta && <a className={styles.link} href={cta.href}>{cta.label}</a>}
      </header>
      <div className={styles.cardBody}>{children}</div>
    </section>
  );
}

function Empty({ text }) {
  return <div className={styles.empty}>{text}</div>;
}
