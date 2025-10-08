import { useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api";
import styles from "./AccountPage.module.css";

import {
  LayoutDashboard,
  Bell,
  MessageSquare,
  Users,
  Package,
  Heart,
  Settings,
  LifeBuoy,
  Store,
  LogOut,
  ShieldCheck,
  ChevronRight,
  ArrowLeft,
  Sun,
  Moon,
  MapPin,
  CreditCard,
  FileText,
  Lock,
  ShieldHalf,
  CheckCircle2,
  Star,
  MessageCircle,
  Reply,
  Pencil,
  Trash2,
  Clock,
} from "lucide-react";

/* ---------- mici utilitare UI ---------- */
function Stars({ value = 0 }) {
  const full = Math.round(value);
  return (
    <span className={styles.stars} aria-label={`Rating ${value} din 5`}>
      {[0, 1, 2, 3, 4].map((i) => (
        <Star key={i} size={14} className={i < full ? styles.starFull : styles.starEmpty} />
      ))}
    </span>
  );
}
function displayName(me) {
  if (me?.name) return me.name;
  const full = `${me?.firstName || ""} ${me?.lastName || ""}`.trim();
  return full || me?.email || "Utilizator";
}
function getInitials(me) {
  const s = displayName(me).split(" ").filter(Boolean);
  return (s[0]?.[0] || "U").concat(s[1]?.[0] || "").toUpperCase();
}

/* ------- sub-componente simple ------- */
function RowLink({ to, label, icon, badge }) {
  return (
    <a className={styles.row} href={to}>
      <div className={styles.left}>
        <span className={styles.rowIcon}>{icon}</span>
        <span className={styles.rowLabel}>{label}</span>
      </div>
      <div className={styles.right}>
        {badge > 0 && <span className={styles.badge}>{Math.min(badge, 99)}</span>}
        <ChevronRight size={18} className={styles.chev} />
      </div>
    </a>
  );
}

export default function AccountPage() {
  /* ====== identitate + tema ====== */
  const [me, setMe] = useState(null);
  const [loading, setLoading] = useState(true);
  const [unreadNotif, setUnreadNotif] = useState(0);
  const [unreadMsgs, setUnreadMsgs] = useState(0);
  const [onboarding, setOnboarding] = useState(null);

  const [theme, setTheme] = useState(() => {
    const saved = typeof window !== "undefined" ? localStorage.getItem("theme") : null;
    return saved === "dark" ? "dark" : "light";
  });
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try {
      localStorage.setItem("theme", theme);
    } catch {/* ignore */}
  }, [theme]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const d = await api("/api/auth/me");
        if (!alive) return;
        if (!d?.user) {
          window.location.href = "/autentificare?redirect=/cont";
          return;
        }
        setMe(d.user);
      } catch {
        window.location.href = "/autentificare?redirect=/cont";
        return;
      } finally {
        setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const isVendor = me?.role === "VENDOR";
  const isAdmin = me?.role === "ADMIN";
  const isUser = me?.role === "USER";
  const roleLabel = isVendor ? "Vânzător" : isAdmin ? "Administrator" : "Utilizator";

  useEffect(() => {
    if (!me) return;
    let alive = true;
    (async () => {
      try {
        const notif = await api("/api/notifications/unread-count").catch(() => ({ count: 0 }));
        const msgs =
          isVendor ? await api("/api/inbox/unread-count").catch(() => ({ count: 0 })) : { count: 0 };
        if (!alive) return;
        setUnreadNotif(notif?.count || 0);
        setUnreadMsgs(msgs?.count || 0);
      } catch {/* ignore */}
      if (isVendor) {
        try {
          const ob = await api("/api/vendors/me/onboarding-status").catch(() => null);
          if (alive) setOnboarding(ob || null);
        } catch {/* ignore */}
      }
    })();
    return () => {
      alive = false;
    };
  }, [me, isVendor]);

  const profilePct = useMemo(() => {
    if (!me) return 0;
    const checks = [
      !!(me.firstName || me.name),
      !!(me.lastName || (me.name && me.name.split(" ").length > 1)),
      !!me.phone,
      !!me.avatarUrl,
      !!(me.city || me.address || me.country),
    ];
    return Math.round((checks.filter(Boolean).length / checks.length) * 100);
  }, [me]);

  /* ====== recenzii & comentarii (mobile list + load more) ====== */
  const [revTab, setRevTab] = useState("sent"); // "sent" | "received"
  const [comTab, setComTab] = useState(isVendor ? "received" : "sent");

  const [reviewsSent, setReviewsSent] = useState([]);
  const [reviewsRecv, setReviewsRecv] = useState([]);
  const [revLoading, setRevLoading] = useState(false);
  const [revHasMore, setRevHasMore] = useState(true);
  const [revPage, setRevPage] = useState(1);

  const [commentsSent, setCommentsSent] = useState([]);
  const [commentsRecv, setCommentsRecv] = useState([]);
  const [comLoading, setComLoading] = useState(false);
  const [comHasMore, setComHasMore] = useState(true);
  const [comPage, setComPage] = useState(1);

  useEffect(() => {
    if (!me) return;
    loadReviews(1, true);
    loadComments(1, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me]);

  async function loadReviews(page = 1, replace = false) {
    try {
      setRevLoading(true);
      const limit = 10;
      const [sent, recv] = await Promise.all([
        api(`/api/reviews/my?page=${page}&limit=${limit}`).catch(() => ({ items: [] })),
        isVendor
          ? api(`/api/reviews/received?page=${page}&limit=${limit}`).catch(() => ({ items: [] }))
          : { items: [] },
      ]);
      if (replace) {
        setReviewsSent(sent.items || []);
        setReviewsRecv(recv.items || []);
      } else {
        setReviewsSent((prev) => [...prev, ...(sent.items || [])]);
        setReviewsRecv((prev) => [...prev, ...(recv.items || [])]);
      }
      setRevHasMore((sent.items?.length || 0) === limit || (recv.items?.length || 0) === limit);
      setRevPage(page);
    } finally {
      setRevLoading(false);
    }
  }
  async function loadComments(page = 1, replace = false) {
    try {
      setComLoading(true);
      const limit = 10;
      const [sent, recv] = await Promise.all([
        api(`/api/comments/my?page=${page}&limit=${limit}`).catch(() => ({ items: [] })),
        isVendor
          ? api(`/api/comments/received?page=${page}&limit=${limit}`).catch(() => ({ items: [] }))
          : { items: [] },
      ]);
      if (replace) {
        setCommentsSent(sent.items || []);
        setCommentsRecv(recv.items || []);
      } else {
        setCommentsSent((prev) => [...prev, ...(sent.items || [])]);
        setCommentsRecv((prev) => [...prev, ...(recv.items || [])]);
      }
      setComHasMore((sent.items?.length || 0) === limit || (recv.items?.length || 0) === limit);
      setComPage(page);
    } finally {
      setComLoading(false);
    }
  }

  // quick grid
  const quick = [
    { to: "/desktop", label: "Desktop", icon: <LayoutDashboard size={20} /> },
    { to: "/notificari", label: "Notificări", icon: <Bell size={20} />, badge: unreadNotif },
    ...(isVendor
      ? [{ to: "/mesaje", label: "Mesaje", icon: <MessageSquare size={20} />, badge: unreadMsgs }]
      : []),
    { to: "/wishlist", label: "Dorințe", icon: <Heart size={20} /> },
    ...(isUser ? [{ to: "/comenzile-mele", label: "Comenzi", icon: <Package size={20} /> }] : []),
    ...(isVendor ? [{ to: "/magazine", label: "Magazinul meu", icon: <Store size={20} /> }] : []),
  ].slice(0, 6);

  // Logout
  async function handleLogout(e) {
    e.preventDefault();
    try {
      await api("/api/auth/logout", { method: "POST" });
    } catch {/* ignore */}
    window.location.href = "/autentificare";
  }

  if (loading) {
    return (
      <div className={styles.page}>
        <div className={styles.stickyTop}>
          <button className={styles.iconBtn} aria-label="Înapoi" onClick={() => history.back()}>
            <ArrowLeft size={18} />
          </button>
          <h1 className={styles.pageTitle}>Cont</h1>
          <span className={styles.iconBtn} aria-hidden="true" />
        </div>
        <div className={styles.card}>Se încarcă…</div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      {/* ===== header sticky (mobile) ===== */}
      <div className={styles.stickyTop}>
        <button className={styles.iconBtn} aria-label="Înapoi" onClick={() => history.back()}>
          <ArrowLeft size={18} />
        </button>
        <h1 className={styles.pageTitle}>Cont</h1>
        <button
          className={styles.iconBtn}
          aria-label="Comută tema"
          title="Comută tema"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
        >
          {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
        </button>
      </div>

      {/* ===== identitate ===== */}
      <div className={styles.identity}>
        <div className={styles.avatar}>{getInitials(me)}</div>
        <div className={styles.idText}>
          <div className={styles.nameRow}>
            <span className={styles.name}>{displayName(me)}</span>
            {me?.verified && (
              <span className={styles.verified}>
                <CheckCircle2 size={14} />
                Verificat
              </span>
            )}
          </div>
          <div className={styles.rolePill}>{roleLabel}</div>
        </div>
      </div>

      {/* ===== profil + quick ===== */}
      <div className={styles.card}>
        <div className={styles.progressWrap} aria-label={`Profil ${profilePct}%`}>
          <div className={styles.progressBar} style={{ width: `${profilePct}%` }} />
        </div>
        <div className={styles.progressRow}>
          <span className={styles.progressText}>
            Profil completat <b>{profilePct}%</b>
          </span>
          <a className={styles.smallBtn} href="/setari">
            Completează
          </a>
        </div>

        <div className={styles.quickGrid}>
          {quick.map((q) => (
            <a key={q.to} href={q.to} className={styles.quickItem}>
              <span className={styles.quickIcon}>
                {q.icon}
                {q.badge > 0 && <span className={styles.quickBadge}>{Math.min(q.badge, 99)}</span>}
              </span>
              <span className={styles.quickLabel}>{q.label}</span>
            </a>
          ))}
        </div>
      </div>

      {/* ===== banner onboarding (vendor) ===== */}
      {isVendor && onboarding && onboarding.exists && onboarding.nextStep !== "done" && (
        <div className={styles.banner}>
          <div className={styles.bannerText}>
            <b>Finalizează configurarea magazinului</b>
            <span className={styles.bannerSub}>
              Următorul pas:{" "}
              {onboarding.nextStep === "selectServices"
                ? "Alege servicii"
                : onboarding.nextStep === "profile"
                ? "Completează profilul"
                : "Continuă setup"}
            </span>
          </div>
          <a href="/onboarding" className={styles.bannerBtn}>
            Continuă
          </a>
        </div>
      )}

      {/* ===== Recenzii ===== */}
      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>
            <Star size={16} /> Recenzii
          </h2>
          <div className={styles.segment}>
            <button
              type="button"
              className={`${styles.segBtn} ${revTab === "sent" ? styles.segActive : ""}`}
              onClick={() => setRevTab("sent")}
            >
              Trimise
            </button>
            <button
              type="button"
              className={`${styles.segBtn} ${revTab === "received" ? styles.segActive : ""}`}
              onClick={() => setRevTab("received")}
              disabled={!isVendor}
              title={!isVendor ? "Doar pentru vânzători" : undefined}
            >
              Primite
            </button>
          </div>
        </div>

        <div className={styles.list}>
          {(revTab === "sent" ? reviewsSent : reviewsRecv).map((r) => (
            <article key={r.id || `${r.itemId}-${r.createdAt}`} className={styles.itemCard}>
              <a href={r.productUrl || r.targetUrl || "#"} className={styles.itemThumb}>
                <img src={r.image || "/placeholder.png"} alt="" loading="lazy" />
              </a>
              <div className={styles.itemBody}>
                <div className={styles.itemTop}>
                  <a className={styles.itemTitle} href={r.productUrl || r.targetUrl || "#"}>
                    {r.productTitle || r.title || "Produs / Serviciu"}
                  </a>
                  <time className={styles.itemTime}>
                    <Clock size={12} />{" "}
                    {new Date(r.createdAt || Date.now()).toLocaleDateString("ro-RO")}
                  </time>
                </div>
                <div className={styles.itemMeta}>
                  <Stars value={r.rating || 0} />
                </div>
                {r.text && <p className={styles.itemText}>{r.text}</p>}
                <div className={styles.itemActions}>
                  {revTab === "sent" ? (
                    <>
                      <a href={`/recenzii/${r.id || ""}/editeaza`} className={styles.linkBtn}>
                        <Pencil size={14} /> Editează
                      </a>
                      <a href={`/recenzii/${r.id || ""}/sterge`} className={styles.linkBtnDanger}>
                        <Trash2 size={14} /> Șterge
                      </a>
                    </>
                  ) : (
                    isVendor && (
                      <a href={`/recenzii/${r.id || ""}#raspunde`} className={styles.linkBtn}>
                        <Reply size={14} /> Răspunde
                      </a>
                    )
                  )}
                </div>
              </div>
            </article>
          ))}

          {!revLoading && (revTab === "sent" ? reviewsSent : reviewsRecv).length === 0 && (
            <div className={styles.empty}>
              Nu există recenzii {revTab === "sent" ? "trimise" : "primite"} încă.
            </div>
          )}

          {revHasMore && (
            <div className={styles.moreWrap}>
              <button
                className={styles.moreBtn}
                onClick={() => loadReviews(revPage + 1, false)}
                disabled={revLoading}
              >
                Vezi mai mult
              </button>
            </div>
          )}
        </div>
      </section>

      {/* ===== Comentarii ===== */}
      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>
            <MessageCircle size={16} /> Comentarii
          </h2>
          <div className={styles.segment}>
            <button
              type="button"
              className={`${styles.segBtn} ${comTab === "sent" ? styles.segActive : ""}`}
              onClick={() => setComTab("sent")}
            >
              Trimise
            </button>
            <button
              type="button"
              className={`${styles.segBtn} ${comTab === "received" ? styles.segActive : ""}`}
              onClick={() => setComTab("received")}
              disabled={!isVendor}
              title={!isVendor ? "Doar pentru vânzători" : undefined}
            >
              Primite
            </button>
          </div>
        </div>

        <div className={styles.list}>
          {(comTab === "sent" ? commentsSent : commentsRecv).map((c) => (
            <article key={c.id || `${c.itemId}-${c.createdAt}`} className={styles.itemCard}>
              <a href={c.productUrl || c.targetUrl || "#"} className={styles.itemThumb}>
                <img src={c.image || "/placeholder.png"} alt="" loading="lazy" />
              </a>
              <div className={styles.itemBody}>
                <div className={styles.itemTop}>
                  <a className={styles.itemTitle} href={c.productUrl || c.targetUrl || "#"}>
                    {c.productTitle || c.title || "Produs / Serviciu"}
                  </a>
                  <time className={styles.itemTime}>
                    <Clock size={12} />{" "}
                    {new Date(c.createdAt || Date.now()).toLocaleDateString("ro-RO")}
                  </time>
                </div>
                {c.text && <p className={styles.itemText}>{c.text}</p>}
                <div className={styles.itemActions}>
                  {comTab === "sent" ? (
                    <>
                      <a href={`/comentarii/${c.id || ""}/editeaza`} className={styles.linkBtn}>
                        <Pencil size={14} /> Editează
                      </a>
                      <a href={`/comentarii/${c.id || ""}/sterge`} className={styles.linkBtnDanger}>
                        <Trash2 size={14} /> Șterge
                      </a>
                    </>
                  ) : (
                    isVendor && (
                      <a href={`/comentarii/${c.id || ""}#raspunde`} className={styles.linkBtn}>
                        <Reply size={14} /> Răspunde
                      </a>
                    )
                  )}
                </div>
              </div>
            </article>
          ))}

          {!comLoading && (comTab === "sent" ? commentsSent : commentsRecv).length === 0 && (
            <div className={styles.empty}>
              Nu există comentarii {comTab === "sent" ? "trimise" : "primite"} încă.
            </div>
          )}

          {comHasMore && (
            <div className={styles.moreWrap}>
              <button
                className={styles.moreBtn}
                onClick={() => loadComments(comPage + 1, false)}
                disabled={comLoading}
              >
                Vezi mai mult
              </button>
            </div>
          )}
        </div>
      </section>

      {/* ===== setări & ajutor ===== */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Setări & securitate</h2>
        <div className={styles.card}>
          <RowLink to="/setari" label="Setări cont" icon={<Settings size={20} />} />
          <RowLink to="/setari/securitate" label="Securitate" icon={<Lock size={20} />} />
          <RowLink to="/gdpr" label="Datele mele (GDPR)" icon={<ShieldHalf size={20} />} />
          <RowLink to="/adrese" label="Adrese de livrare" icon={<MapPin size={20} />} />
          <RowLink to="/plati" label="Metode de plată" icon={<CreditCard size={20} />} />
          <RowLink to="/documente" label="Facturi / documente" icon={<FileText size={20} />} />
        </div>
      </section>

      {/* ===== Vendor & Admin ===== */}
      {isVendor && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Vânzător</h2>
          <div className={styles.card}>
            <RowLink to="/planner" label="Planificator comenzi" icon={<LayoutDashboard size={20} />} />
            <RowLink to="/vendor/visitors" label="Vizitatori" icon={<Users size={20} />} />
            <RowLink to="/mesaje" label="Mesaje" icon={<MessageSquare size={20} />} badge={unreadMsgs} />
            <RowLink to="/magazine" label="Magazine / Produse" icon={<Store size={20} />} />
            <RowLink to="/asistenta-tehnica" label="Asistență tehnică" icon={<LifeBuoy size={20} />} />
          </div>
        </section>
      )}

      {isAdmin && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Administrare</h2>
          <div className={styles.card}>
            <RowLink to="/admin" label="Panou Admin" icon={<ShieldCheck size={20} />} />
          </div>
        </section>
      )}

      {/* ===== Logout ===== */}
      <div className={styles.card}>
        <button className={styles.logoutBtn} onClick={handleLogout} type="button">
          <LogOut size={18} />
          Deconectare
        </button>
      </div>

      <div className={styles.bottomSpace} />
    </div>
  );
}
