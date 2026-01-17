// src/components/Navbar/Navbar.jsx
import { useEffect, useMemo, useState, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate, Link, NavLink } from "react-router-dom";
import {
  Heart,
  ShoppingCart,
  Search as SearchIcon,
  ChevronDown,
  Menu,
  Sun,
  Moon,
  Bell,
  MessageSquare,
  User as UserIcon,
  Home,
  LayoutGrid,
  Camera,
  LifeBuoy,
} from "lucide-react";

import { api } from "../../lib/api";
import { useAuth } from "../../pages/Auth/Context/context.js";
import styles from "./Navbar.module.css";
import logo from "../../assets/LogoArtfest.png";
import Register from "../../pages/Auth/Register/Register";
import Login from "../../pages/Auth/Login/Login";
import { guestCart } from "../../lib/guestCart";

/* ========================= Modal (cu portal & blur) ========================= */
function Modal({ open, onClose, title, children }) {
  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.classList.add("modal-open");

    const onEsc = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    document.addEventListener("keydown", onEsc);

    return () => {
      document.body.style.overflow = prevOverflow;
      document.documentElement.classList.remove("modal-open");
      document.removeEventListener("keydown", onEsc);
    };
  }, [open, onClose]);

  if (!open) return null;

  const modalNode = (
    <div
      className={styles.overlay}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className={styles.modal}
        onClick={(e) => e.stopPropagation()}
        role="document"
      >
        <header className={styles.modalHead}>
          <h3 className={styles.modalTitle}>{title}</h3>
          <button
            className={styles.modalClose}
            onClick={onClose}
            aria-label="Închide"
            type="button"
          >
            ×
          </button>
        </header>
        <div className={styles.modalBody}>{children}</div>
      </div>
    </div>
  );

  return createPortal(modalNode, document.body);
}

/* ==========================================
   Mobile bottom bar (portal în document.body)
========================================== */
function MobileBar({ me, unreadNotif, cartCount, onOpenAuth }) {
  const node = (
    <nav className={styles.mobileBar} aria-label="Navigație secundară">
      <NavLink to="/" className={styles.mobileItem} aria-label="Acasă">
        <Home size={22} />
        <span>Acasă</span>
      </NavLink>

      <NavLink
        to="/categorii"
        className={styles.mobileItem}
        aria-label="Categorii"
      >
        <LayoutGrid size={22} />
        <span>Categorii</span>
      </NavLink>

      {/* CONT: dacă nu e logat -> deschide modalul */}
      {me ? (
        <NavLink to="/cont" className={styles.mobileItem} aria-label="Contul meu">
          <UserIcon size={22} />
          <span>Cont</span>
          {unreadNotif > 0 && (
            <span className={styles.badgeMini}>
              {Math.min(unreadNotif, 99)}
            </span>
          )}
        </NavLink>
      ) : (
        <button
          type="button"
          className={styles.mobileItem}
          aria-label="Autentificare"
          onClick={() => onOpenAuth?.("login")}
        >
          <UserIcon size={22} />
          <span>Cont</span>
        </button>
      )}

      {me && (
        <NavLink
          to="/wishlist"
          className={styles.mobileItem}
          aria-label="Lista de dorințe"
        >
          <Heart size={22} />
          <span>Dorințe</span>
        </NavLink>
      )}

      <NavLink to="/cos" className={styles.mobileItem} aria-label="Coș">
        <ShoppingCart size={22} />
        <span>Coș</span>
        {cartCount > 0 && (
          <span className={styles.badgeMini}>{Math.min(cartCount, 99)}</span>
        )}
      </NavLink>
    </nav>
  );

  return createPortal(node, document.body);
}

/* ===================== Navbar principal ===================== */
export default function Navbar() {
  // ✅ IMPORTANT: ajustează dacă funcția ta are alt nume
  // ideal în context să ai { me, loading, refresh }
  const { me, refresh } = useAuth();

  const location = useLocation();
  const navigate = useNavigate();

  const STORE_PAGE_PREFIX = "/magazin";

  const [burgerOpen, setBurgerOpen] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [authTab, setAuthTab] = useState("login");
  const [partnerOpen, setPartnerOpen] = useState(false);

  const [q, setQ] = useState("");

  const [wishCount, setWishCount] = useState(0);
  const [cartCount, setCartCount] = useState(0);
  const [vServices, setVServices] = useState([]);
  const [unreadMsgs, setUnreadMsgs] = useState(0);
  const [unreadNotif, setUnreadNotif] = useState(0);
  const [onboarding, setOnboarding] = useState(null);
  const [supportUnread, setSupportUnread] = useState(0);

  const [uploadingImg, setUploadingImg] = useState(false);
  const fileInputDesktopRef = useRef(null);
  const fileInputMobileRef = useRef(null);

  const [suggestions, setSuggestions] = useState(null);
  const [suggestLoading, setSuggestLoading] = useState(false);
  const searchDesktopRef = useRef(null);
  const searchMobileRef = useRef(null);
  const suggestCacheRef = useRef(new Map());

  const [theme, setTheme] = useState(() => {
    const saved =
      typeof window !== "undefined" ? localStorage.getItem("theme") : null;
    return saved === "light" || saved === "dark" ? saved : "light";
  });

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("theme", theme);
  }, [theme]);

  const toggleTheme = () => setTheme((t) => (t === "dark" ? "light" : "dark"));

  const computeGuestCartCount = () => {
    try {
      const items = guestCart.list();
      return items.reduce((s, it) => s + (Number(it.qty) || 0), 0);
    } catch {
      return 0;
    }
  };

  /* ===== cart count refresh (guest + logged) ===== */
  useEffect(() => {
    async function refreshCart() {
      if (me) {
        try {
          const cc = await api("/api/cart/count").catch(() => ({ count: 0 }));
          setCartCount(cc.count || 0);
        } catch {
          setCartCount(0);
        }
      } else {
        setCartCount(computeGuestCartCount());
      }
    }

    refreshCart();

    const handler = () => refreshCart();
    window.addEventListener("cart:changed", handler);

    const onStorage = (e) => {
      if (e.key === "guest_cart_v1") refreshCart();
    };
    window.addEventListener("storage", onStorage);

    return () => {
      window.removeEventListener("cart:changed", handler);
      window.removeEventListener("storage", onStorage);
    };
  }, [me]);

  /* ===== wishlist + cart count ===== */
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!me) {
        setWishCount(0);
        setCartCount(computeGuestCartCount());
        return;
      }
      try {
        const wc = await api("/api/wishlist/count").catch(async () => {
          const f = await api("/api/favorites/count").catch(() => ({ count: 0 }));
          return { count: f.count || 0 };
        });
        const cc = await api("/api/cart/count").catch(() => ({ count: 0 }));
        if (alive) {
          setWishCount(wc.count || 0);
          setCartCount(cc.count || 0);
        }
      } catch {
        if (alive) {
          setWishCount(0);
          setCartCount(computeGuestCartCount());
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [me]);

  /* ===== vendor services ===== */
  useEffect(() => {
    let alive = true;
    (async () => {
      if (me?.role !== "VENDOR") {
        setVServices([]);
        return;
      }
      try {
        const d = await api("/api/vendors/me/services").catch(() => ({ items: [] }));
        if (!alive) return;
        setVServices(d?.items || []);
      } catch {
        // ignore
      }
    })();
    return () => {
      alive = false;
    };
  }, [me?.role]);

  /* ===== notif + messages + onboarding ===== */
  useEffect(() => {
    let alive = true;
    (async () => {
      if (me) {
        const notifUrl =
          me.role === "VENDOR"
            ? "/api/vendor/notifications/unread-count"
            : "/api/notifications/unread-count";
        const notif = await api(notifUrl).catch(() => ({ count: 0 }));
        if (alive) setUnreadNotif(notif?.count || 0);
      } else {
        setUnreadNotif(0);
      }

      if (!me) {
        if (alive) {
          setUnreadMsgs(0);
          setOnboarding(null);
        }
        return;
      }

      if (me.role === "VENDOR") {
        const msgs = await api("/api/inbox/unread-count").catch(() => ({ count: 0 }));
        const ob = await api("/api/vendors/me/onboarding-status").catch(() => null);
        if (!alive) return;
        setUnreadMsgs(msgs?.count || 0);
        setOnboarding(ob || null);
        return;
      }

      if (me.role === "USER") {
        const msgs = await api("/api/user-inbox/unread-count").catch(() => ({ count: 0 }));
        if (!alive) return;
        setUnreadMsgs(msgs?.count || 0);
        setOnboarding(null);
        return;
      }

      if (alive) {
        setUnreadMsgs(0);
        setOnboarding(null);
      }
    })();

    return () => {
      alive = false;
    };
  }, [me?.role, me]);

  /* ===== support unread ===== */
  const fetchSupportUnread = useCallback(async () => {
    if (!me) {
      setSupportUnread(0);
      return;
    }

    let url;
    if (me.role === "ADMIN") url = "/api/admin/support/unread-count";
    else if (me.role === "VENDOR") url = "/api/vendor/support/unread-count";
    else if (me.role === "USER") url = "/api/support/unread-count";
    else {
      setSupportUnread(0);
      return;
    }

    try {
      const d = await api(url).catch(() => ({ count: 0 }));
      setSupportUnread(d?.count || 0);
    } catch {
      setSupportUnread(0);
    }
  }, [me]);

  useEffect(() => {
    if (!me) {
      setSupportUnread(0);
      return;
    }

    fetchSupportUnread();

    const id = setInterval(() => {
      if (document.visibilityState === "visible") fetchSupportUnread();
    }, 15000);

    const onVis = () => {
      if (document.visibilityState === "visible") fetchSupportUnread();
    };
    const onSupportChanged = () => fetchSupportUnread();

    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("support:changed", onSupportChanged);

    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("support:changed", onSupportChanged);
    };
  }, [me, fetchSupportUnread]);

  /* ===== scroll lock pt burger ===== */
  useEffect(() => {
    if (!burgerOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [burgerOpen]);

  /* ===== open modal via query params ===== */
  useEffect(() => {
    const sp = new URLSearchParams(location.search);
    const auth = sp.get("auth");
    const as = sp.get("as");

    if (auth === "register" && as === "partner") {
      setPartnerOpen(true);
      setAuthOpen(false);
      return;
    }

    if (auth === "login" || auth === "register") {
      setAuthTab(auth);
      setAuthOpen(true);
      setPartnerOpen(false);
      return;
    }
  }, [location.search]);

  const clearAuthParams = useCallback(() => {
    const sp = new URLSearchParams(location.search);
    sp.delete("auth");
    sp.delete("as");
    const next = sp.toString();
    navigate(
      { pathname: location.pathname, search: next ? `?${next}` : "" },
      { replace: true }
    );
  }, [location.pathname, location.search, navigate]);

  const closeAuth = () => {
    setAuthOpen(false);
    clearAuthParams();
  };
  const closePartner = () => {
    setPartnerOpen(false);
    clearAuthParams();
  };

  /* ===== suggestions fetch ===== */
  useEffect(() => {
    const term = (q || "").trim();

    if (term.length < 2) {
      setSuggestions(null);
      setSuggestLoading(false);
      return;
    }

    const key = term.toLowerCase();
    const cached = suggestCacheRef.current.get(key);
    if (cached) {
      setSuggestions(cached);
      setSuggestLoading(false);
      return;
    }

    const ctrl = new AbortController();
    const DEBOUNCE_MS = 90;

    const handle = setTimeout(async () => {
      try {
        setSuggestLoading(true);

        const [prodRes, storeRes] = await Promise.allSettled([
          fetch(`/api/public/products/suggest?q=${encodeURIComponent(term)}`, {
            signal: ctrl.signal,
          }),
          fetch(`/api/public/stores/suggest?q=${encodeURIComponent(term)}`, {
            signal: ctrl.signal,
          }),
        ]);

        const prodData =
          prodRes.status === "fulfilled" && prodRes.value.ok
            ? await prodRes.value.json().catch(() => null)
            : null;

        const storeData =
          storeRes.status === "fulfilled" && storeRes.value.ok
            ? await storeRes.value.json().catch(() => null)
            : null;

        if (ctrl.signal.aborted) return;

        const merged = {
          products: Array.isArray(prodData?.products) ? prodData.products : [],
          categories: Array.isArray(prodData?.categories) ? prodData.categories : [],
          stores: Array.isArray(storeData?.stores) ? storeData.stores : [],
        };

        suggestCacheRef.current.set(key, merged);

        const hasAny =
          merged.products.length || merged.categories.length || merged.stores.length;
        setSuggestions(hasAny ? merged : { products: [], categories: [], stores: [] });
      } catch {
        if (ctrl.signal.aborted) return;
        setSuggestions(null);
      } finally {
        if (!ctrl.signal.aborted) setSuggestLoading(false);
      }
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(handle);
      ctrl.abort();
    };
  }, [q]);

  /* ===== click outside suggestions ===== */
  useEffect(() => {
    const handleClickOutside = (e) => {
      const inDesktop = searchDesktopRef.current?.contains(e.target);
      const inMobile = searchMobileRef.current?.contains(e.target);
      if (!inDesktop && !inMobile) setSuggestions(null);
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("touchstart", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("touchstart", handleClickOutside);
    };
  }, []);

  const showSuggest =
    q &&
    q.trim().length >= 2 &&
    (suggestLoading || suggestions) &&
    (suggestions?.products?.length ||
      suggestions?.categories?.length ||
      suggestions?.stores?.length ||
      suggestLoading);

  const handleSuggestionCategoryClick = useCallback(
    (catKey) => {
      const term = (q || "").trim();
      setSuggestions(null);
      navigate(
        `/produse?q=${encodeURIComponent(term)}&categorie=${encodeURIComponent(
          catKey
        )}&page=1`
      );
    },
    [navigate, q]
  );

  const handleSuggestionProductClick = useCallback(
    (id) => {
      setSuggestions(null);
      navigate(`/produs/${encodeURIComponent(id)}`);
    },
    [navigate]
  );

  const handleSuggestionStoreClick = useCallback(
    (profileSlug) => {
      setSuggestions(null);
      if (!profileSlug) return;
      navigate(`${STORE_PAGE_PREFIX}/${encodeURIComponent(profileSlug)}`);
    },
    [navigate]
  );

  function submitSearch(e) {
    e.preventDefault();
    const term = (q || "").trim();
    setSuggestions(null);
    navigate(term ? `/produse?q=${encodeURIComponent(term)}&page=1` : "/produse");
  }

  const initials = useMemo(() => {
    if (!me?.name && !me?.firstName && !me?.lastName) return "U";
    const display =
      me?.name || `${me?.firstName || ""} ${me?.lastName || ""}`.trim();
    return display
      .split(" ")
      .map((p) => p[0])
      .slice(0, 2)
      .join("")
      .toUpperCase();
  }, [me]);

  const avatarUrl = me?.avatarUrl || null;
  const isVendor = me?.role === "VENDOR";

  const supportHref = useMemo(() => {
    if (!me) return "/support";
    if (me.role === "ADMIN") return "/admin/support";
    if (me.role === "VENDOR") return "/vendor/support";
    return "/account/support";
  }, [me]);

  const profileLinks = useMemo(() => {
    const items = [];
    const has = (code) =>
      vServices.some((s) => (s?.type?.code || s?.typeCode) === code);
    if (has("photography")) items.push(["/vendor/photography", "Profil Fotograf"]);
    if (has("products")) items.push(["/vendor/store", "Profil Magazin / Produse"]);
    if (has("restaurant")) items.push(["/vendor/restaurant", "Profil Restaurant / Catering"]);
    if (has("entertainment")) items.push(["/vendor/entertainment", "Profil Formație / DJ / MC"]);
    if (has("decor_tent")) items.push(["/vendor/decor", "Profil Decor / Cort evenimente"]);
    if (has("special_fx")) items.push(["/vendor/special-fx", "Profil Efecte speciale"]);
    if (has("florist")) items.push(["/vendor/florist", "Profil Florărie"]);
    if (has("bakery")) items.push(["/vendor/bakery", "Profil Cofetărie"]);
    return items;
  }, [vServices]);

  const nextStepCTA = useMemo(() => {
    if (!isVendor) return null;
    const hasServices = Array.isArray(vServices) && vServices.length > 0;

    if (!onboarding?.exists)
      return hasServices ? null : { label: "Începe setup", href: "/onboarding" };
    if (onboarding.nextStep === "selectServices")
      return hasServices ? null : { label: "Alege servicii", href: "/onboarding" };
    if (onboarding.nextStep === "profile")
      return { label: "Publică profilul", href: "/onboarding/details" };
    return null;
  }, [onboarding, isVendor, vServices]);

  const ACHIZITII_LABEL = "Achiziții";

  async function handleImagePicked(file) {
    if (!file) return;
    try {
      setUploadingImg(true);
      const fd = new FormData();
      fd.append("image", file);

      const res = await api("/api/search/image", { method: "POST", body: fd });

      const ids = Array.isArray(res?.ids)
        ? res.ids.filter(Boolean)
        : Array.isArray(res?.items)
        ? res.items.map((x) => x?.id).filter(Boolean)
        : [];

      if (ids.length > 0) {
        try {
          sessionStorage.setItem(
            `imgsearch:${res.searchId || "last"}`,
            JSON.stringify(res)
          );
        } catch {
          // ignore
        }
        navigate(`/produse?ids=${encodeURIComponent(ids.join(","))}&page=1`);
        return;
      }

      navigate("/produse?by=image&page=1");
    } catch {
      alert("Nu am putut procesa imaginea. Încearcă din nou.");
      navigate("/produse?by=image&error=1&page=1");
    } finally {
      setUploadingImg(false);
    }
  }

  function openImagePickerDesktop() {
    fileInputDesktopRef.current?.click();
  }
  function openImagePickerMobile() {
    fileInputMobileRef.current?.click();
  }

  const loginRedirect = (() => {
    try {
      const sp = new URLSearchParams(window.location.search);
      return sp.get("redirect") || "/desktop";
    } catch {
      return "/desktop";
    }
  })();

  const isAdmin = me?.role === "ADMIN";
  const isAdminRoute = location.pathname.startsWith("/admin");

  /* ================= NAVBAR SPECIAL PENTRU ADMIN ================= */
  if (isAdmin && isAdminRoute) {
    return (
      <header className={styles.header}>
        <div className={styles.container}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <Link to="/" aria-label="Artfest – Acasă" title="Pagina principală">
              <img src={logo} alt="Artfest" className={styles.logo} />
            </Link>
          </div>

          <nav className={styles.nav} aria-label="Meniu admin">
            <NavLink className={styles.navLink} to="/admin" end>
              Dashboard
            </NavLink>
            <NavLink className={styles.navLink} to="/admin/marketing">
              Marketing
            </NavLink>
            <NavLink className={styles.navLink} to="/admin/maintenance">
              Mentenanță
            </NavLink>
            <NavLink className={styles.navLink} to="/admin/incidents">
              Incidente
            </NavLink>
          </nav>

          <div className={styles.actionsRight}>
            <button
              className={styles.themeBtn}
              onClick={toggleTheme}
              aria-label="Comută tema"
              type="button"
              title="Comută tema"
            >
              {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
            </button>

            <Link
              className={styles.iconWrapper}
              to={supportHref}
              title="Asistență tehnică"
              aria-label="Asistență tehnică"
            >
              <LifeBuoy size={22} />
              {supportUnread > 0 && (
                <span className={styles.badge}>
                  {Math.min(supportUnread, 99)}
                </span>
              )}
            </Link>

            <div className={styles.dropdown}>
              <button
                className={styles.avatarBtn}
                title="Cont admin"
                aria-label="Cont admin"
                type="button"
              >
                {avatarUrl ? (
                  <img
                    src={avatarUrl}
                    alt={me?.name || me?.email || "Avatar"}
                    className={styles.avatarImg}
                  />
                ) : (
                  <span className={styles.avatar}>{initials}</span>
                )}
                <ChevronDown className={styles.dropdownIcon} size={14} />
              </button>

              <div
                className={styles.dropdownContent}
                style={{ padding: 10, minWidth: 240 }}
              >
                <ul
                  style={{
                    margin: 0,
                    padding: 0,
                    listStyle: "none",
                    display: "grid",
                    gap: 4,
                  }}
                >
                  <li>
                    <span style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
                      Logat ca <b>{me?.email}</b>
                    </span>
                  </li>

                  <li
                    style={{
                      borderTop: "1px solid var(--color-border)",
                      marginTop: 6,
                      paddingTop: 6,
                    }}
                  >
                    <button
                      type="button"
                      className={styles.accountBtn}
                      onClick={async (e) => {
                        e.preventDefault();
                        try {
                          await api("/api/auth/logout", { method: "POST" });
                          if (typeof refresh === "function") await refresh();
                        } catch {
                          // ignore
                        }
                        navigate("/autentificare", { replace: true });
                      }}
                      style={{ width: "100%", justifyContent: "center" }}
                    >
                      Deconectare
                    </button>
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </header>
    );
  }

  /* ================= NAVBAR NORMAL (user / vendor / guest) ================= */
  return (
    <header className={styles.header}>
      <div className={styles.container}>
        {/* Stânga: burger + logo */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <button
            type="button"
            className={styles.burger}
            onClick={() => setBurgerOpen((v) => !v)}
            aria-label="Meniu"
            aria-expanded={burgerOpen ? "true" : "false"}
          >
            <Menu size={22} />
          </button>

          <Link to="/" aria-label="ArtFest – Acasă" title="Pagina principală">
            <img src={logo} alt="Artfest" className={styles.logo} />
          </Link>
        </div>

        {/* Centru: nav contextual */}
        <nav
          className={`${styles.nav} ${burgerOpen ? styles["nav--open"] : ""}`}
          aria-label="Meniu principal"
          onClick={(e) => {
            if (e.target.closest("a")) setBurgerOpen(false);
          }}
        >
          {isVendor ? (
            <>
              {/* ===== Achiziții ===== */}
              <div className={styles.dropdown} tabIndex={0}>
                <button
                  type="button"
                  className={styles.navLink}
                  aria-haspopup="menu"
                  aria-label={ACHIZITII_LABEL}
                >
                  {ACHIZITII_LABEL}
                  <ChevronDown className={styles.dropdownIcon} size={14} />
                </button>

                <div
                  className={styles.dropdownContent}
                  role="menu"
                  style={{ padding: 10, minWidth: 280 }}
                >
                  <div className={styles.menuGrid}>
                    <div>
                      <div className={styles.groupLabel}>Servicii digitale</div>
                      <div className={styles.colGrid}>
                        <NavLink to="/servicii-digitale" role="menuitem">
                          Invitație tip site
                        </NavLink>
                        <NavLink to="/servicii-digitale" role="menuitem">
                          Așezarea la mese (SMS)
                        </NavLink>
                        <NavLink to="/servicii-digitale" role="menuitem">
                          Album QR
                        </NavLink>
                      </div>
                    </div>

                    <div>
                      <div className={styles.groupLabel}>Produse</div>
                      <div className={styles.colGrid}>
                        <NavLink to="/produse" role="menuitem">
                          Produse
                        </NavLink>
                      </div>
                    </div>

                    <div>
                      <div className={styles.groupLabel}>Servicii</div>
                      <div className={styles.colGrid}>
                        <NavLink to="/magazine" role="menuitem">
                          Magazine
                        </NavLink>
                        <div
                          style={{
                            marginTop: 10,
                            fontSize: 12,
                            color: "var(--color-text-muted)",
                            fontStyle: "italic",
                            borderTop: "1px solid var(--color-border)",
                            paddingTop: 6,
                          }}
                        >
                          * Toate serviciile pentru evenimente vor fi disponibile în curând
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* ===== Profiluri ===== */}
              {profileLinks.length <= 1 ? (
                <NavLink
                  className={styles.navLink}
                  to={profileLinks[0]?.[0] || "/onboarding"}
                >
                  {profileLinks[0]?.[1] || "Profil"}
                </NavLink>
              ) : (
                <div className={styles.dropdown} tabIndex={0}>
                  <button type="button" className={styles.navLink} aria-haspopup="menu">
                    Profiluri <ChevronDown className={styles.dropdownIcon} size={14} />
                  </button>

                  <div className={styles.dropdownContent} role="menu" style={{ padding: 8 }}>
                    <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: 4 }}>
                      {profileLinks.map(([href, label]) => (
                        <li key={href}>
                          <NavLink to={href} role="menuitem">
                            {label}
                          </NavLink>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}

              <NavLink className={styles.navLink} to="/vendor/orders">
                Comenzile mele
              </NavLink>
              <NavLink className={styles.navLink} to="/vendor/visitors">
                Vizitatori
              </NavLink>

              {nextStepCTA && (
                <NavLink className={styles.accountBtn} to={nextStepCTA.href} title="Următorul pas">
                  {nextStepCTA.label}
                </NavLink>
              )}
            </>
          ) : (
            <>
              <div className={styles.dropdown} tabIndex={0}>
                <button type="button" className={styles.navLink} aria-haspopup="menu">
                  Servicii digitale
                  <ChevronDown className={styles.dropdownIcon} size={14} />
                </button>

                <div className={styles.dropdownContent} role="menu">
                  <NavLink to="/servicii-digitale" role="menuitem">
                    Invitație tip site
                  </NavLink>
                  <NavLink to="/servicii-digitale" role="menuitem">
                    Așezarea la mese (SMS)
                  </NavLink>
                  <NavLink to="/servicii-digitale" role="menuitem">
                    Album QR
                  </NavLink>
                </div>
              </div>

              <NavLink className={styles.navLink} to="/produse">
                Produse
              </NavLink>
              <NavLink className={styles.navLink} to="/magazine">
                Magazine
              </NavLink>
            </>
          )}

          {/* Search – desktop (doar pentru non-vendor) */}
          {me?.role !== "VENDOR" && (
            <form
              ref={searchDesktopRef}
              className={styles.search}
              onSubmit={submitSearch}
              role="search"
              aria-label="Căutare"
              style={{ position: "relative" }}
              onKeyDown={(e) => {
                if (e.key === "Escape") setSuggestions(null);
              }}
            >
              <SearchIcon size={30} className={styles.searchIcon} />
              <input
                className={styles.input}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Caută pe Artfest"
                aria-label="Caută"
                autoComplete="off"
              />

              <input
                ref={fileInputDesktopRef}
                type="file"
                accept="image/*"
                className={styles.hiddenFile}
                onChange={(e) => handleImagePicked(e.target.files?.[0])}
              />

              <button
                className={styles.cameraBtn}
                type="button"
                onClick={openImagePickerDesktop}
                aria-label="Caută după imagine"
                title="Caută după imagine"
                disabled={uploadingImg}
              >
                <Camera size={18} />
              </button>

              {showSuggest && (
                <div
                  role="listbox"
                  aria-label="Sugestii de căutare"
                  className={styles.suggestDropdown}
                >
                  {suggestLoading && (
                    <div className={styles.suggestLoading}>Se încarcă sugestiile…</div>
                  )}

                  {!suggestLoading && suggestions && (
                    <>
                      {!suggestions.products?.length &&
                        !suggestions.categories?.length &&
                        !suggestions.stores?.length && (
                          <div className={styles.suggestEmpty}>
                            Nu avem sugestii exacte pentru <strong>{q}</strong>.
                          </div>
                        )}

                      {suggestions.categories?.length > 0 && (
                        <div className={styles.suggestSection}>
                          <div className={styles.suggestSectionTitle}>
                            Categorii sugerate
                          </div>
                          {suggestions.categories.map((c) => (
                            <button
                              key={c.key}
                              type="button"
                              role="option"
                              className={styles.suggestCategoryBtn}
                              onClick={() => handleSuggestionCategoryClick(c.key)}
                            >
                              {c.label}
                            </button>
                          ))}
                        </div>
                      )}

                      {suggestions.stores?.length > 0 && (
                        <div className={styles.suggestSection}>
                          <div className={styles.suggestSectionTitle}>
                            Magazine sugerate
                          </div>

                          <div className={styles.suggestStoresList}>
                            {suggestions.stores.map((s) => (
                              <button
                                key={s.id || s.profileSlug}
                                type="button"
                                role="option"
                                className={styles.suggestStoreBtn}
                                onClick={() => handleSuggestionStoreClick(s.profileSlug)}
                              >
                                {s.logoUrl ? (
                                  <img
                                    src={s.logoUrl}
                                    alt={s.displayName || s.storeName || "Magazin"}
                                    className={styles.suggestStoreThumb}
                                    loading="lazy"
                                    decoding="async"
                                  />
                                ) : (
                                  <div
                                    className={styles.suggestStoreThumbFallback}
                                    aria-hidden="true"
                                  />
                                )}

                                <div className={styles.suggestStoreMeta}>
                                  <div className={styles.suggestStoreTitle}>
                                    {s.displayName || s.storeName || "Magazin"}
                                  </div>
                                  <div className={styles.suggestStoreSub}>
                                    {s.city ? s.city : "—"}
                                  </div>
                                </div>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      {suggestions.products?.length > 0 && (
                        <div className={styles.suggestSection}>
                          <div className={styles.suggestSectionTitle}>Produse sugerate</div>
                          <div className={styles.suggestProductsList}>
                            {suggestions.products.map((p) => (
                              <button
                                key={p.id}
                                type="button"
                                role="option"
                                className={styles.suggestProductBtn}
                                onClick={() => handleSuggestionProductClick(p.id)}
                              >
                                {p.images?.[0] && (
                                  <img
                                    src={p.images[0]}
                                    alt={p.title}
                                    className={styles.suggestProductThumb}
                                  />
                                )}
                                <div className={styles.suggestProductMeta}>
                                  <div className={styles.suggestProductTitle}>{p.title}</div>
                                  <div className={styles.suggestProductPrice}>
                                    {(Number(p.priceCents || 0) / 100).toFixed(2)}{" "}
                                    {p.currency || "RON"}
                                  </div>
                                </div>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </form>
          )}
        </nav>

        {/* overlay pentru off-canvas (mobil) */}
        {burgerOpen && (
          <button
            type="button"
            className={styles.navBackdrop}
            aria-label="Închide meniul"
            onClick={() => setBurgerOpen(false)}
          />
        )}

        {/* Dreapta: acțiuni + cont + asistență */}
        <div className={styles.actionsRight}>
          <button
            className={styles.themeBtn}
            onClick={toggleTheme}
            aria-label="Comută tema"
            type="button"
            title="Comută tema"
          >
            {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
          </button>

          {isVendor && (
            <NavLink className={styles.iconWrapper} to="/desktop" title="Desktop vendor" aria-label="Desktop vendor">
              <LayoutGrid size={22} />
            </NavLink>
          )}

          {me && !isVendor && (
            <NavLink className={styles.iconWrapper} to="/desktop-user" title="Desktop" aria-label="Desktop">
              <LayoutGrid size={22} />
            </NavLink>
          )}

          <NavLink
            className={styles.iconWrapper}
            to={supportHref}
            title="Asistență tehnică"
            aria-label="Asistență tehnică"
          >
            <LifeBuoy size={22} />
            {supportUnread > 0 && (
              <span className={styles.badge}>{Math.min(supportUnread, 99)}</span>
            )}
          </NavLink>

          {me && (
            <NavLink className={styles.iconWrapper} to="/notificari" title="Notificări" aria-label="Notificări">
              <Bell size={22} />
              {unreadNotif > 0 && (
                <span className={styles.badge}>{Math.min(unreadNotif, 99)}</span>
              )}
            </NavLink>
          )}

          {me && (
            <NavLink
              className={styles.iconWrapper}
              to={isVendor ? "/mesaje" : "/cont/mesaje"}
              title="Mesaje"
              aria-label="Mesaje"
            >
              <MessageSquare size={22} />
              {unreadMsgs > 0 && (
                <span className={styles.badge}>{Math.min(unreadMsgs, 99)}</span>
              )}
            </NavLink>
          )}

          {me && (
            <NavLink className={styles.iconWrapper} to="/wishlist" title="Lista de dorințe" aria-label="Lista de dorințe">
              <Heart size={22} />
              {wishCount > 0 && (
                <span className={styles.badge}>{Math.min(wishCount, 99)}</span>
              )}
            </NavLink>
          )}

          <NavLink className={styles.iconWrapper} to="/cos" title="Coșul meu" aria-label="Coșul meu">
            <ShoppingCart size={22} />
            {cartCount > 0 && (
              <span className={styles.badge}>{Math.min(cartCount, 99)}</span>
            )}
          </NavLink>

          {!me ? (
            <>
              <button
                className={styles.authIconBtn}
                onClick={() => {
                  setAuthTab("login");
                  setAuthOpen(true);
                }}
                aria-label="Autentificare"
                title="Autentificare"
                type="button"
              >
                <UserIcon size={18} />
              </button>

              <button
                className={styles.sellBtn}
                onClick={() => setPartnerOpen(true)}
                type="button"
              >
                Devino partener
              </button>
            </>
          ) : (
            <div className={styles.dropdown}>
              <button
                className={styles.avatarBtn}
                title="Contul meu"
                aria-label="Contul meu"
                type="button"
              >
                {avatarUrl ? (
                  <img
                    src={avatarUrl}
                    alt={me?.name || me?.email || "Avatar"}
                    className={styles.avatarImg}
                  />
                ) : (
                  <span className={styles.avatar}>{initials}</span>
                )}
                <ChevronDown className={styles.dropdownIcon} size={14} />
              </button>

              <div className={styles.dropdownContent} style={{ padding: 10, minWidth: 240 }}>
                <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: 4 }}>
                  <li>
                    <NavLink to="/cont">{isVendor ? "Cont (mobil)" : "Contul meu"}</NavLink>
                  </li>

                  {isVendor ? (
                    <>
                      <li><NavLink to="/vendor/orders">Comenzile mele</NavLink></li>
                      <li><NavLink to="/vendor/invoices">Facturi</NavLink></li>
                      <li><NavLink to="/setari">Setări</NavLink></li>
                    </>
                  ) : (
                    <>
                      <li><NavLink to="/comenzile-mele">Comenzile mele</NavLink></li>
                      <li><NavLink to="/facturi">Facturi</NavLink></li>
                      <li><NavLink to="/cont/setari">Setări</NavLink></li>
                    </>
                  )}

                  <li style={{ borderTop: "1px solid var(--color-border)", marginTop: 6, paddingTop: 6 }}>
                    <button
                      type="button"
                      className={styles.accountBtn}
                      onClick={async (e) => {
                        e.preventDefault();
                        try {
                          await api("/api/auth/logout", { method: "POST" });
                          if (typeof refresh === "function") await refresh();
                        } catch {
                          // ignore
                        }
                        navigate("/autentificare", { replace: true });
                      }}
                      style={{ width: "100%", justifyContent: "center" }}
                    >
                      Deconectare
                    </button>
                  </li>
                </ul>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Mobile: top row cu mesaje/notif + search + asistență */}
      <div className={styles.mobileSearch}>
        <div className={styles.mobileSearchRow}>
          <div className={styles.mobileSearchLeft}>
            {me && (
              <NavLink
                className={styles.iconWrapper}
                to={isVendor ? "/mesaje" : "/cont/mesaje"}
                title="Mesaje"
                aria-label="Mesaje"
              >
                <MessageSquare size={22} />
                {unreadMsgs > 0 && (
                  <span className={styles.badgeMini}>{Math.min(unreadMsgs, 99)}</span>
                )}
              </NavLink>
            )}

            {me && (
              <NavLink
                className={styles.iconWrapper}
                to="/notificari"
                title="Notificări"
                aria-label="Notificări"
              >
                <Bell size={22} />
                {unreadNotif > 0 && (
                  <span className={styles.badgeMini}>{Math.min(unreadNotif, 99)}</span>
                )}
              </NavLink>
            )}
          </div>

          <form
            ref={searchMobileRef}
            className={`${styles.search} ${styles.searchSm}`}
            onSubmit={submitSearch}
            role="search"
            aria-label="Căutare"
            style={{ flex: 1, position: "relative" }}
            onKeyDown={(e) => {
              if (e.key === "Escape") setSuggestions(null);
            }}
          >
            <SearchIcon size={18} className={styles.searchIcon} />
            <input
              className={styles.input}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Caută pe Artfest"
              aria-label="Caută"
              autoComplete="off"
            />

            <input
              ref={fileInputMobileRef}
              type="file"
              accept="image/*"
              className={styles.hiddenFile}
              onChange={(e) => handleImagePicked(e.target.files?.[0])}
            />

            <button
              className={styles.cameraBtn}
              type="button"
              onClick={openImagePickerMobile}
              aria-label="Caută după imagine"
              title="Caută după imagine"
              disabled={uploadingImg}
            >
              <Camera size={18} />
            </button>
{showSuggest && (
  <div
    role="listbox"
    aria-label="Sugestii de căutare"
    className={styles.suggestDropdown}
  >
    {suggestLoading && (
      <div className={styles.suggestLoading}>Se încarcă sugestiile…</div>
    )}

    {!suggestLoading && suggestions && (
      <>
        {!suggestions.products?.length &&
          !suggestions.categories?.length &&
          !suggestions.stores?.length && (
            <div className={styles.suggestEmpty}>
              Nu avem sugestii exacte pentru <strong>{q}</strong>.
            </div>
          )}

        {suggestions.categories?.length > 0 && (
          <div className={styles.suggestSection}>
            <div className={styles.suggestSectionTitle}>Categorii sugerate</div>
            {suggestions.categories.map((c) => (
              <button
                key={c.key}
                type="button"
                role="option"
                className={styles.suggestCategoryBtn}
                onClick={() => handleSuggestionCategoryClick(c.key)}
              >
                {c.label}
              </button>
            ))}
          </div>
        )}

        {suggestions.stores?.length > 0 && (
          <div className={styles.suggestSection}>
            <div className={styles.suggestSectionTitle}>Magazine sugerate</div>

            <div className={styles.suggestStoresList}>
              {suggestions.stores.map((s) => (
                <button
                  key={s.id || s.profileSlug}
                  type="button"
                  role="option"
                  className={styles.suggestStoreBtn}
                  onClick={() => handleSuggestionStoreClick(s.profileSlug)}
                >
                  {s.logoUrl ? (
                    <img
                      src={s.logoUrl}
                      alt={s.displayName || s.storeName || "Magazin"}
                      className={styles.suggestStoreThumb}
                      loading="lazy"
                      decoding="async"
                    />
                  ) : (
                    <div
                      className={styles.suggestStoreThumbFallback}
                      aria-hidden="true"
                    />
                  )}

                  <div className={styles.suggestStoreMeta}>
                    <div className={styles.suggestStoreTitle}>
                      {s.displayName || s.storeName || "Magazin"}
                    </div>
                    <div className={styles.suggestStoreSub}>{s.city ? s.city : "—"}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {suggestions.products?.length > 0 && (
          <div className={styles.suggestSection}>
            <div className={styles.suggestSectionTitle}>Produse sugerate</div>
            <div className={styles.suggestProductsList}>
              {suggestions.products.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  role="option"
                  className={styles.suggestProductBtn}
                  onClick={() => handleSuggestionProductClick(p.id)}
                >
                  {p.images?.[0] && (
                    <img
                      src={p.images[0]}
                      alt={p.title}
                      className={styles.suggestProductThumb}
                    />
                  )}
                  <div className={styles.suggestProductMeta}>
                    <div className={styles.suggestProductTitle}>{p.title}</div>
                    <div className={styles.suggestProductPrice}>
                      {(Number(p.priceCents || 0) / 100).toFixed(2)} {p.currency || "RON"}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
      </>
    )}
  </div>
)}

            {/* Dacă vrei complet și aici, copiază același dropdown ca la desktop.
               (ai deja CSS/structură) */}
          </form>

          <div className={styles.mobileSearchRight}>
            <NavLink
              className={styles.iconWrapper}
              to={supportHref}
              title="Asistență tehnică"
              aria-label="Asistență tehnică"
            >
              <LifeBuoy size={22} />
              {supportUnread > 0 && (
                <span className={styles.badgeMini}>{Math.min(supportUnread, 99)}</span>
              )}
            </NavLink>
          </div>
        </div>
      </div>

      {/* Modale */}
      <Modal open={authOpen} onClose={closeAuth} title="Conectează-te sau creează cont">
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <button
            className={styles.sellBtn}
            style={{
              borderColor:
                authTab === "login"
                  ? "var(--color-primary)"
                  : "var(--color-border)",
            }}
            onClick={() => setAuthTab("login")}
            type="button"
          >
            Autentificare
          </button>
          <button
            className={styles.sellBtn}
            style={{
              borderColor:
                authTab === "register"
                  ? "var(--color-primary)"
                  : "var(--color-border)",
            }}
            onClick={() => setAuthTab("register")}
            type="button"
          >
            Înregistrare
          </button>
        </div>

        {authTab === "login" ? (
          <Login
            inModal
            redirectTo={loginRedirect}
            onLoggedIn={() => setAuthOpen(false)}
            onSwitchToRegister={() => setAuthTab("register")}
          />
        ) : (
          <Register defaultAsVendor={false} inModal />
        )}
      </Modal>

      <Modal open={partnerOpen} onClose={closePartner} title="Devino partener pe ArtFest">
        <Register defaultAsVendor={true} inModal />
      </Modal>

      {/* Mobile bottom navigation */}
      <MobileBar
        me={me}
        unreadNotif={unreadNotif}
        cartCount={cartCount}
        onOpenAuth={(tab = "login") => {
          setAuthTab(tab);
          setAuthOpen(true);
          setPartnerOpen(false);
        }}
      />
    </header>
  );
}
