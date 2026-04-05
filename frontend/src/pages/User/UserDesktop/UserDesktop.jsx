// frontend/src/pages/account/UserDesktop.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../../lib/api";
import styles from "./UserDesktop.module.css";

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
  FileText,
  ShieldHalf,
  CheckCircle2,
  Star,
  MessageCircle,
  Reply,
  Pencil,
  Trash2,
  Clock,
  ShoppingCart,
} from "lucide-react";

/* ===================== tiny cache (stale-while-revalidate) ===================== */
const ME_CACHE_KEY = "user:me:v1";
const COUNTS_CACHE_KEY = "user:counts:v1";

function readCache(key, maxAgeMs) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.ts) return null;
    if (Date.now() - parsed.ts > maxAgeMs) return null;
    return parsed.data ?? null;
  } catch {
    return null;
  }
}
function writeCache(key, data) {
  try {
    localStorage.setItem(key, JSON.stringify({ ts: Date.now(), data }));
  } catch {
    /* ignore */
  }
}

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
function RowLink({ to, label, icon, badge, onPrefetch }) {
  return (
    <Link className={styles.row} to={to} onMouseEnter={onPrefetch}>
      <div className={styles.left}>
        <span className={styles.rowIcon}>{icon}</span>
        <span className={styles.rowLabel}>{label}</span>
      </div>
      <div className={styles.right}>
        {badge > 0 && <span className={styles.badge}>{Math.min(badge, 99)}</span>}
        <ChevronRight size={18} className={styles.chev} />
      </div>
    </Link>
  );
}

function RowExternalLink({ href, label, icon, badge }) {
  return (
    <a className={styles.row} href={href} target="_blank" rel="noreferrer">
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

/* ===== card generic (îl folosim doar pt Wishlist acum) ===== */
function CardDash({ title, icon, cta, children }) {
  return (
    <section className={styles.card}>
      <header className={styles.cardHead}>
        <div className={styles.titleWrap}>
          {icon}
          {icon ? " " : null}
          <span className={styles.title}>{title}</span>
        </div>
        {cta && (
          <a className={styles.link} href={cta.href}>
            {cta.label}
          </a>
        )}
      </header>
      <div className={styles.cardBody}>{children}</div>
    </section>
  );
}

function EmptyDash({ text }) {
  return <div className={styles.empty}>{text}</div>;
}

/* =============================== Component =============================== */
export default function UserDesktop() {
  /* ====== theme ====== */
  const [theme, setTheme] = useState(() => {
    const saved = typeof window !== "undefined" ? localStorage.getItem("theme") : null;
    return saved === "dark" ? "dark" : "light";
  });

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try {
      localStorage.setItem("theme", theme);
    } catch {
      /* ignore */
    }
  }, [theme]);

  /* ====== identity (cache first) ====== */
  const cachedMe = useMemo(() => readCache(ME_CACHE_KEY, 5 * 60_000), []);
  const cachedCounts = useMemo(() => readCache(COUNTS_CACHE_KEY, 20_000), []);

  const [me, setMe] = useState(cachedMe || null);

  // IMPORTANT: dacă avem cache, nu mai blocăm pagina cu loading
  const [loading, setLoading] = useState(!cachedMe);

  /* ====== counts (cache first) ====== */
  const [unreadNotif, setUnreadNotif] = useState(cachedCounts?.unreadNotif ?? 0);
  const [unreadMsgs, setUnreadMsgs] = useState(cachedCounts?.unreadMsgs ?? 0); // inbox vendor
  const [cartCount, setCartCount] = useState(cachedCounts?.cartCount ?? 0);
  const [wishlistCount, setWishlistCount] = useState(cachedCounts?.wishlistCount ?? 0);
  const [userUnreadMsgs, setUserUnreadMsgs] = useState(cachedCounts?.userUnreadMsgs ?? 0);
  const [supportUnread, setSupportUnread] = useState(cachedCounts?.supportUnread ?? 0);

  const [onboarding, setOnboarding] = useState(null);

  const isVendor = me?.role === "VENDOR";
  const isAdmin = me?.role === "ADMIN";
  const isUser = me?.role === "USER";
  const roleLabel = isVendor ? "Vânzător" : isAdmin ? "Administrator" : "Utilizator";

  // ✅ docs base ca în vendor desktop
  const docsBase = (import.meta.env.VITE_API_URL || "").replace(/\/+$/, "");

  /* ===================== 1) fetch me (revalidate) ===================== */
  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        const d = await api("/api/auth/me");
        if (!alive) return;

        if (!d?.user) {
          writeCache(ME_CACHE_KEY, null);
          window.location.href = "/autentificare?redirect=/desktop";
          return;
        }

        setMe(d.user);
        writeCache(ME_CACHE_KEY, d.user);
      } catch {
        if (!cachedMe) {
          window.location.href = "/autentificare?redirect=/desktop";
          return;
        }
        // dacă avem cache, nu omorâm UX-ul; lăsăm userul să vadă pagina
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ===================== 2) fetch counts (revalidate + cache) ===================== */
  useEffect(() => {
    if (!me) return;

    let alive = true;

    const fetchCounts = async () => {
      try {
        const [notif, vendorInbox, cart, wishlist, userInbox, support] = await Promise.all([
          api("/api/notifications/unread-count").catch(() => ({ count: 0 })),
          me.role === "VENDOR"
            ? api("/api/inbox/unread-count").catch(() => ({ count: 0 }))
            : Promise.resolve({ count: 0 }),
          api("/api/cart/count").catch(() => ({ count: 0 })),
          api("/api/wishlist/count").catch(() => ({ count: 0 })),
          api("/api/user-inbox/unread-count").catch(() => ({ count: 0 })),
          api("/api/support/unread-count").catch(() => ({ count: 0 })),
        ]);

        if (!alive) return;

        const next = {
          unreadNotif: notif?.count || 0,
          unreadMsgs: vendorInbox?.count || 0,
          cartCount: cart?.count || 0,
          wishlistCount: wishlist?.count || 0,
          userUnreadMsgs: userInbox?.count || 0,
          supportUnread: support?.count || 0,
        };

        setUnreadNotif(next.unreadNotif);
        setUnreadMsgs(next.unreadMsgs);
        setCartCount(next.cartCount);
        setWishlistCount(next.wishlistCount);
        setUserUnreadMsgs(next.userUnreadMsgs);
        setSupportUnread(next.supportUnread);

        writeCache(COUNTS_CACHE_KEY, next);
      } catch {
        /* ignore */
      }
    };

    // fetch imediat
    fetchCounts();

    // polling light (mai rar când tab-ul nu e activ)
    let intervalId = null;
    const startInterval = () => {
      if (intervalId) clearInterval(intervalId);
      const ms = document.visibilityState === "visible" ? 20_000 : 60_000;
      intervalId = setInterval(fetchCounts, ms);
    };
    startInterval();

    const onFocus = () => fetchCounts();
    const onVisible = () => {
      if (document.visibilityState === "visible") fetchCounts();
      startInterval();
    };

    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      alive = false;
      if (intervalId) clearInterval(intervalId);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [me]);

  /* ===================== 3) onboarding (vendor only) ===================== */
  useEffect(() => {
    if (!me || me.role !== "VENDOR") return;

    let alive = true;
    api("/api/vendors/me/onboarding-status")
      .then((ob) => alive && setOnboarding(ob || null))
      .catch(() => {});

    return () => {
      alive = false;
    };
  }, [me]);

  /* ====== recenzii & comentarii (paginare) ====== */
  const [revTab, setRevTab] = useState("sent"); // "sent" | "received"
  const [comTab, setComTab] = useState("sent");
  useEffect(() => {
    if (!me) return;
    setComTab(me.role === "VENDOR" ? "received" : "sent");
  }, [me]);

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
        api(`/api/desktop-reviews/my?page=${page}&limit=${limit}`).catch(() => ({ items: [] })),
        isVendor
          ? api(`/api/desktop-reviews/received?page=${page}&limit=${limit}`).catch(() => ({ items: [] }))
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
        api(`/api/product-comments/my?page=${page}&limit=${limit}`).catch(() => ({ items: [] })),
        isVendor
          ? api(`/api/product-comments/received?page=${page}&limit=${limit}`).catch(() => ({ items: [] }))
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

  async function handleDeleteReview(r) {
    if (!r?.id) return;
    const ok = window.confirm("Sigur vrei să ștergi această recenzie?");
    if (!ok) return;

    try {
      if (r.kind === "STORE_REVIEW") {
        await api(`/api/store-reviews/${r.id}`, { method: "DELETE" });
      } else {
        await api(`/api/reviews/${r.id}`, { method: "DELETE" });
      }
      setReviewsSent((prev) => prev.filter((it) => it.id !== r.id));
    } catch (e) {
      console.error(e);
      alert("Nu am putut șterge recenzia. Încearcă din nou.");
    }
  }

  async function handleDeleteComment(c) {
    if (!c?.id) return;
    const ok = window.confirm("Sigur vrei să ștergi acest comentariu?");
    if (!ok) return;

    try {
      await api(`/api/reviews/${c.id}`, { method: "DELETE" });
      setCommentsSent((prev) => prev.filter((it) => it.id !== c.id));
    } catch (e) {
      console.error(e);
      alert("Nu am putut șterge comentariul. Încearcă din nou.");
    }
  }

  /* ===== Quick grid cu badge-uri ===== */
  const quick = useMemo(
    () =>
      [
        { to: "/notificari", label: "Notificări", icon: <Bell size={20} />, badge: unreadNotif },
        { to: "/cos", label: "Coș", icon: <ShoppingCart size={20} />, badge: cartCount },
        { to: "/wishlist", label: "Dorințe", icon: <Heart size={20} />, badge: wishlistCount },

        ...(isUser
          ? [
              { to: "/comenzile-mele", label: "Comenzi", icon: <Package size={20} />, badge: 0 },
              { to: "/cont/mesaje", label: "Mesaje", icon: <MessageSquare size={20} />, badge: userUnreadMsgs },
              { to: "/account/support", label: "Suport", icon: <LifeBuoy size={20} />, badge: supportUnread },
            ]
          : []),

        ...(isVendor
          ? [{ to: "/cont/mesaje", label: "Mesaje clienți", icon: <MessageSquare size={20} />, badge: unreadMsgs }]
          : []),

        { to: "/cont/setari", label: "Setări", icon: <Settings size={20} /> },
      ].slice(0, 6),
    [unreadNotif, cartCount, wishlistCount, isUser, userUnreadMsgs, supportUnread, isVendor, unreadMsgs]
  );

  /* ===================== Prefetch (best-effort) ===================== */
  // NOTE: ajustează paths dacă ai alte foldere; dacă nu există fișierul, nu crapă build-ul
  const didPrefetchRef = useRef(false);
  useEffect(() => {
    if (didPrefetchRef.current) return;
    didPrefetchRef.current = true;

    // mică pauză ca să nu concureze cu primul render
    const t = setTimeout(() => {
      try {
        // best effort: dacă ai lazy routes, asta le aduce în cache
        import("../Notification/UserNotaificationPage.jsx").catch(() => {});
        import("../../Cart/Cart.jsx").catch(() => {});
        import("../../Wishlist/Wishlist.jsx").catch(() => {});
      } catch {
        /* ignore */
      }
    }, 400);

    return () => clearTimeout(t);
  }, []);

  const prefetchMap = useMemo(
    () => ({
      "/notificari": () => import("../Notification/UserNotaificationPage.jsx").catch(() => {}),
      "/cos": () => import("../../Cart/Cart.jsx").catch(() => {}),
      "/wishlist": () => import("../../Wishlist/Wishlist.jsx").catch(() => {}),
    }),
    []
  );

  /* ===== Logout ===== */
  async function handleLogout(e) {
    e.preventDefault();
    try {
      await api("/api/auth/logout", { method: "POST" });
    } catch {
      /* ignore */
    }
    // curățăm cache-ul ca să nu “flash-uiască” la următoarea intrare
    writeCache(ME_CACHE_KEY, null);
    writeCache(COUNTS_CACHE_KEY, null);
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

      {/* ===== acces rapid ===== */}
      <div className={styles.card}>
        <div className={styles.quickGrid}>
          {quick.map((q) => (
            <Link
              key={q.to}
              to={q.to}
              className={styles.quickItem}
              onMouseEnter={prefetchMap[q.to]}
            >
              <span className={styles.quickIcon}>
                {q.icon}
                {q.badge > 0 && <span className={styles.quickBadge}>{Math.min(q.badge, 99)}</span>}
              </span>
              <span className={styles.quickLabel}>{q.label}</span>
            </Link>
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
          <Link to="/onboarding" className={styles.bannerBtn}>
            Continuă
          </Link>
        </div>
      )}

      {/* ===== Dashboard (opțional) ===== */}
      {isUser && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Activitate recentă</h2>
        </section>
      )}

      {/* ===== Recenzii ===== */}
      <section className={styles.section} id="recenzii">
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>
            <Star size={16} /> Recenzii
          </h2>
          <div className={styles.segment}>
            <button
              type="button"
              className={`${styles.segBtn} ${revTab === "sent" ? styles.segActive : ""}`}
              onClick={() => {
                setRevTab("sent");
                if (revPage !== 1) loadReviews(1, true);
              }}
            >
              Trimise
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
                    <Clock size={12} /> {new Date(r.createdAt || Date.now()).toLocaleDateString("ro-RO")}
                  </time>
                </div>

                <div className={styles.itemMeta}>
                  <Stars value={r.rating || 0} />
                </div>

                {r.text && <p className={styles.itemText}>{r.text}</p>}

                <div className={styles.itemActions}>
                  {revTab === "sent" ? (
                    <>
                      <a href={(r.productUrl || "#") + (r.id ? `#rev-${r.id}` : "")} className={styles.linkBtn}>
                        <Pencil size={14} /> Editează
                      </a>
                      <button type="button" className={styles.linkBtnDanger} onClick={() => handleDeleteReview(r)}>
                        <Trash2 size={14} /> Șterge
                      </button>
                    </>
                  ) : (
                    isVendor && (
                      <a href={(r.productUrl || "#") + (r.id ? `#rev-${r.id}` : "")} className={styles.linkBtn}>
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

          <div className={styles.pager}>
            <button
              type="button"
              className={styles.pagerBtn}
              onClick={() => revPage > 1 && loadReviews(revPage - 1, true)}
              disabled={revLoading || revPage === 1}
            >
              ← <span>Înapoi</span>
            </button>
            <span className={styles.pagerLabel}>Pagina {revPage}</span>
            <button
              type="button"
              className={styles.pagerBtn}
              onClick={() => loadReviews(revPage + 1, true)}
              disabled={revLoading || !revHasMore}
            >
              <span>Înainte</span> →
            </button>
          </div>
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
              onClick={() => {
                setComTab("sent");
                if (comPage !== 1) loadComments(1, true);
              }}
            >
              Trimise
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
                    <Clock size={12} /> {new Date(c.createdAt || Date.now()).toLocaleDateString("ro-RO")}
                  </time>
                </div>

                <div className={styles.itemMeta}>
                  <Stars value={c.rating || 0} />
                </div>

                {c.text && <p className={styles.itemText}>{c.text}</p>}

                <div className={styles.itemActions}>
                  {comTab === "sent" ? (
                    <>
                      <a href={c.productUrl || "#"} className={styles.linkBtn}>
                        <Pencil size={14} /> Editează
                      </a>
                      <button type="button" className={styles.linkBtnDanger} onClick={() => handleDeleteComment(c)}>
                        <Trash2 size={14} /> Șterge
                      </button>
                    </>
                  ) : (
                    isVendor && (
                      <a href={c.productUrl || "#"} className={styles.linkBtn}>
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

          <div className={styles.pager}>
            <button
              type="button"
              className={styles.pagerBtn}
              onClick={() => comPage > 1 && loadComments(comPage - 1, true)}
              disabled={comLoading || comPage === 1}
            >
              ← <span>Înapoi</span>
            </button>
            <span className={styles.pagerLabel}>Pagina {comPage}</span>
            <button
              type="button"
              className={styles.pagerBtn}
              onClick={() => loadComments(comPage + 1, true)}
              disabled={comLoading || !comHasMore}
            >
              <span>Înainte</span> →
            </button>
          </div>
        </div>
      </section>

      {/* ===== Setări & ajutor ===== */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Setări & securitate</h2>
        <div className={styles.card}>
          <RowLink to="/cont/setari" label="Setări cont" icon={<Settings size={20} />} />
          <RowLink
            to="/account/support"
            label="Ajutor & suport"
            icon={<LifeBuoy size={20} />}
            badge={supportUnread}
          />

          <RowExternalLink href={`${docsBase}/termenii-si-conditiile`} label="Termeni și condiții" icon={<FileText size={20} />} />
          <RowExternalLink href={`${docsBase}/confidentialitate`} label="Politica de confidențialitate" icon={<ShieldHalf size={20} />} />
          <RowExternalLink href={`${docsBase}/politica-retur`} label="Politica de retur" icon={<FileText size={20} />} />

          {/* <RowLink to="/facturi" label="Facturi / documente" icon={<FileText size={20} />} /> */}
        </div>
      </section>

      {/* ===== Vendor & Admin ===== */}
      {isVendor && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Vânzător</h2>
          <div className={styles.card}>
            <RowLink to="/planner" label="Planificator comenzi" icon={<LayoutDashboard size={20} />} />
            <RowLink to="/vendor/visitors" label="Vizitatori" icon={<Users size={20} />} />
            <RowLink to="/cont/mesaje" label="Mesaje" icon={<MessageSquare size={20} />} badge={unreadMsgs} />
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
