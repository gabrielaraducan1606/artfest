import {
  useEffect,
  useMemo,
  useState,
  useRef,
  useCallback,
} from "react";
import { createPortal } from "react-dom";
import { useLocation } from "react-router-dom";
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
function MobileBar({ me, unreadNotif, cartCount }) {
  const node = (
    <nav className={styles.mobileBar} aria-label="Navigație secundară">
      <a href="/" className={styles.mobileItem} aria-label="Acasă">
        <Home size={22} />
        <span>Acasă</span>
      </a>

      <a href="/categorii" className={styles.mobileItem} aria-label="Categorii">
        <LayoutGrid size={22} />
        <span>Categorii</span>
      </a>

      <a href="/cont" className={styles.mobileItem} aria-label="Contul meu">
        <UserIcon size={22} />
        <span>Cont</span>
        {me && unreadNotif > 0 && (
          <span className={styles.badgeMini}>
            {Math.min(unreadNotif, 99)}
          </span>
        )}
      </a>

      {me && (
        <a
          href="/wishlist"
          className={styles.mobileItem}
          aria-label="Lista de dorințe"
        >
          <Heart size={22} />
          <span>Dorințe</span>
        </a>
      )}

      <a href="/cos" className={styles.mobileItem} aria-label="Coș">
        <ShoppingCart size={22} />
        <span>Coș</span>
        {cartCount > 0 && (
          <span className={styles.badgeMini}>
            {Math.min(cartCount, 99)}
          </span>
        )}
      </a>
    </nav>
  );

  return createPortal(node, document.body);
}

/* ===================== Navbar principal ===================== */
export default function Navbar() {
  const { me, loading: refresh } = useAuth();

  const [burgerOpen, setBurgerOpen] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [authTab, setAuthTab] = useState("login");
  const [partnerOpen, setPartnerOpen] = useState(false);

  const [q, setQ] = useState("");
  const [scope] = useState("toate");

  const [wishCount, setWishCount] = useState(0);
  const [cartCount, setCartCount] = useState(0);
  const [vServices, setVServices] = useState([]);
  const [unreadMsgs, setUnreadMsgs] = useState(0);
  const [unreadNotif, setUnreadNotif] = useState(0);
  const [onboarding, setOnboarding] = useState(null);
  const [supportUnread, setSupportUnread] = useState(0); // 🔴 contor tichete suport

  const [uploadingImg, setUploadingImg] = useState(false);

  const fileInputDesktopRef = useRef(null);
  const fileInputMobileRef = useRef(null);

  // Theme
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

  // helper: calculează totalul din coșul de guest
  const computeGuestCartCount = () => {
    try {
      const items = guestCart.list();
      return items.reduce((s, it) => s + (Number(it.qty) || 0), 0);
    } catch {
      return 0;
    }
  };

  // === Ascultă evenimentul cart:changed pentru refresh count (și guest, și logged)
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

  // Wishlist + cart counts
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!me) {
        try {
          const raw = localStorage.getItem("guest:cart");
          const list = JSON.parse(raw || "[]");
          const count = Array.isArray(list)
            ? list.reduce((s, x) => s + Number(x.qty || 0), 0)
            : 0;
          setCartCount(count);
        } catch {
          setCartCount(0);
        }
        return;
      }
      try {
        const wc = await api("/api/wishlist/count").catch(async () => {
          const f = await api("/api/favorites/count").catch(() => ({
            count: 0,
          }));
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

  // Vendor services
  useEffect(() => {
    let alive = true;
    (async () => {
      if (me?.role !== "VENDOR") {
        setVServices([]);
        return;
      }
      try {
        const d = await api("/api/vendors/me/services").catch(() => ({
          items: [],
        }));
        if (!alive) return;
        setVServices(d?.items || []);
      } finally {
        ""
      }
    })();
    return () => {
      alive = false;
    };
  }, [me?.role]);

  // Notificări, mesaje, onboarding
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

      // Mesaje + onboarding
      if (!me) {
        if (alive) {
          setUnreadMsgs(0);
          setOnboarding(null);
        }
        return;
      }

      if (me.role === "VENDOR") {
        const msgs = await api("/api/inbox/unread-count").catch(() => ({
          count: 0,
        }));
        const ob = await api("/api/vendors/me/onboarding-status").catch(
          () => null
        );
        if (!alive) return;
        setUnreadMsgs(msgs?.count || 0);
        setOnboarding(ob || null);
        return;
      }

      if (me.role === "USER") {
        const msgs = await api("/api/user-inbox/unread-count").catch(
          () => ({ count: 0 })
        );
        if (!alive) return;
        setUnreadMsgs(msgs?.count || 0);
        setOnboarding(null);
        return;
      }

      // orice alt rol (guest, admin)
      if (alive) {
        setUnreadMsgs(0);
        setOnboarding(null);
      }
    })();

    return () => {
      alive = false;
    };
  }, [me?.role, me]);

  // 🔴 funcție reutilizabilă pentru unread suport
  const fetchSupportUnread = useCallback(async () => {
    if (!me) {
      setSupportUnread(0);
      return;
    }

    let url;
    if (me.role === "ADMIN") {
      url = "/api/admin/support/unread-count";
    } else if (me.role === "VENDOR") {
      url = "/api/vendor/support/unread-count";
    } else if (me.role === "USER") {
      url = "/api/support/unread-count"; // adaptează dacă endpointul e altul
    } else {
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

  // 🔴 Support unread count (admin / vendor / user)
  useEffect(() => {
    if (!me) {
      setSupportUnread(0);
      return;
    }

    // încărcare imediată
    fetchSupportUnread();

    // poll la 15s și la revenirea în tab
    const id = setInterval(() => {
      if (document.visibilityState === "visible") {
        fetchSupportUnread();
      }
    }, 15000);

    const onVis = () => {
      if (document.visibilityState === "visible") {
        fetchSupportUnread();
      }
    };

    const onSupportChanged = () => {
      fetchSupportUnread();
    };

    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("support:changed", onSupportChanged);

    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("support:changed", onSupportChanged);
    };
  }, [me, fetchSupportUnread]);

  // Body scroll lock pentru drawer mobil
  useEffect(() => {
    if (!burgerOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [burgerOpen]);

  // === Citește query param auth=login|register pentru a deschide modalul ===
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const auth = sp.get("auth"); // "login" | "register"
    if (auth === "login" || auth === "register") {
      setAuthTab(auth);
      setAuthOpen(true);
    }

    const onPopState = () => {
      const sp2 = new URLSearchParams(window.location.search);
      const a = sp2.get("auth");
      if (a === "login" || a === "register") {
        setAuthTab(a);
        setAuthOpen(true);
      }
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  // curăță param-ul auth din URL când închizi modalul
  const closeAuth = () => {
    setAuthOpen(false);
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete("auth");
      const next = url.pathname + (url.search ? url.search : "") + url.hash;
      window.history.replaceState({}, "", next);
    } catch {
      ""
    }
  };

  function submitSearch(e) {
    e.preventDefault();
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (scope && scope !== "toate") params.set("scope", scope);
    window.location.href = `/cautare?${params.toString()}`;
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
    if (!me) return "/support"; // guest

    if (me.role === "ADMIN") {
      return "/admin/support"; // admin
    }

    if (me.role === "VENDOR") {
      return "/vendor/support"; // dashboard vendor
    }

    // restul = user normal
    return "/account/support";
  }, [me]);

  const profileLinks = useMemo(() => {
    const items = [];
    const has = (code) =>
      vServices.some((s) => (s?.type?.code || s?.typeCode) === code);
    if (has("photography")) items.push(["/vendor/photography", "Profil Fotograf"]);
    if (has("products"))
      items.push(["/vendor/store", "Profil Magazin / Produse"]);
    if (has("restaurant"))
      items.push(["/vendor/restaurant", "Profil Restaurant / Catering"]);
    if (has("entertainment"))
      items.push(["/vendor/entertainment", "Profil Formație / DJ / MC"]);
    if (has("decor_tent"))
      items.push(["/vendor/decor", "Profil Decor / Cort evenimente"]);
    if (has("special_fx"))
      items.push(["/vendor/special-fx", "Profil Efecte speciale"]);
    if (has("florist")) items.push(["/vendor/florist", "Profil Florărie"]);
    if (has("bakery")) items.push(["/vendor/bakery", "Profil Cofetărie"]);
    return items;
  }, [vServices]);

  const nextStepCTA = useMemo(() => {
    if (!isVendor) return null;

    const hasServices = Array.isArray(vServices) && vServices.length > 0;

    if (!onboarding?.exists) {
      return hasServices ? null : { label: "Începe setup", href: "/onboarding" };
    }

    if (onboarding.nextStep === "selectServices") {
      if (hasServices) return null;
      return { label: "Alege servicii", href: "/onboarding" };
    }

    if (onboarding.nextStep === "profile") {
      return { label: "Publică profilul", href: "/onboarding/details" };
    }

    return null;
  }, [onboarding, isVendor, vServices]);

  const ACHIZITII_LABEL = "Achiziții";

  async function handleImagePicked(file) {
    if (!file) return;
    try {
      setUploadingImg(true);
      const fd = new FormData();
      fd.append("image", file);

      const res = await api("/api/search/image", {
        method: "POST",
        body: fd,
      });

      const ids = Array.isArray(res?.items)
        ? res.items.map((x) => x.id).filter(Boolean)
        : [];
      if (ids.length > 0) {
        try {
          sessionStorage.setItem(
            `imgsearch:${res.searchId || "last"}`,
            JSON.stringify(res)
          );
        } catch {
          ""
        }
        window.location.href = `/produse?ids=${encodeURIComponent(
          ids.join(",")
        )}`;
        return;
      }

      const id = res?.searchId || res?.queryId;
      if (id) {
        window.location.href = `/cautare-imagine/${encodeURIComponent(id)}`;
      } else {
        window.location.href = "/produse?by=image";
      }
    } catch {
      alert("Nu am putut procesa imaginea. Încearcă din nou.");
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

  const location = useLocation();
  const isAdmin = me?.role === "ADMIN";
  const isAdminRoute = location.pathname.startsWith("/admin");

  /* ================= NAVBAR SPECIAL PENTRU ADMIN ================= */
  if (isAdmin && isAdminRoute) {
    return (
      <header className={styles.header}>
        <div className={styles.container}>
          {/* Stânga: logo + badge ADMIN */}
          <div
            style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}
          >
            <a
              href="/"
              aria-label="Artfest – Acasă"
              title="Pagina principală"
            >
              <img src={logo} alt="Artfest" className={styles.logo} />
            </a>
          </div>

          {/* Centru: link-uri admin */}
          <nav className={styles.nav} aria-label="Meniu admin">
            <a className={styles.navLink} href="/admin">
              Dashboard
            </a>
            <a className={styles.navLink} href="/admin/marketing">
              Marketing
            </a>
            <a className={styles.navLink} href="/admin/maintenance">
              Mentenanta
            </a>
            {/* aici poți adăuga și alte link-uri de admin pe viitor */}
          </nav>

          {/* Dreapta: temă + suport + avatar + logout */}
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

            <a
              className={styles.iconWrapper}
              href={supportHref}
              title="Asistență tehnică"
              aria-label="Asistență tehnică"
            >
              <LifeBuoy size={22} />
              {supportUnread > 0 && (
                <span className={styles.badge}>
                  {Math.min(supportUnread, 99)}
                </span>
              )}
            </a>

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
                    <span
                      style={{
                        fontSize: 12,
                        color: "var(--color-text-muted)",
                      }}
                    >
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
                          await refresh().catch(() => {});
                        } catch {
                          ""
                        }
                        window.location.href = "/autentificare";
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
          <a href="/" aria-label="ArtFest – Acasă" title="Pagina principală">
            <img src={logo} alt="Artfest" className={styles.logo} />
          </a>
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
                <a
                  className={styles.navLink}
                  href="#"
                  role="button"
                  aria-haspopup="menu"
                >
                  {ACHIZITII_LABEL}
                  <ChevronDown className={styles.dropdownIcon} size={14} />
                </a>
                <div
                  className={styles.dropdownContent}
                  role="menu"
                  style={{ padding: 10, minWidth: 280 }}
                >
                  <div className={styles.menuGrid}>
                    <div>
                      <div className={styles.groupLabel}>Servicii digitale</div>
                      <div className={styles.colGrid}>
                        <a href="/digitale/invitatie" role="menuitem">
                          Invitație tip site
                        </a>
                        <a href="/digitale/asezare-mese" role="menuitem">
                          Așezarea la mese (SMS)
                        </a>
                        <a href="/digitale/album-qr" role="menuitem">
                          Album QR
                        </a>
                      </div>
                    </div>
                    <div>
                      <div className={styles.groupLabel}>Produse</div>
                      <div className={styles.colGrid}>
                        <a href="/produse" role="menuitem">
                          Produse
                        </a>
                      </div>
                    </div>
                    <div>
                      <div className={styles.groupLabel}>Servicii</div>
                      <div className={styles.colGrid}>
                        <a href="/magazine" role="menuitem">
                          Magazine
                        </a>
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
                          * Toate serviciile pentru evenimente vor fi
                          disponibile în curând
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* ===== Profiluri ===== */}
              {profileLinks.length <= 1 ? (
                <a
                  className={styles.navLink}
                  href={profileLinks[0]?.[0] || "/onboarding"}
                >
                  {profileLinks[0]?.[1] || "Profil"}
                </a>
              ) : (
                <div className={styles.dropdown} tabIndex={0}>
                  <a
                    className={styles.navLink}
                    href="#"
                    role="button"
                    aria-haspopup="menu"
                  >
                    Profiluri{" "}
                    <ChevronDown className={styles.dropdownIcon} size={14} />
                  </a>
                  <div
                    className={styles.dropdownContent}
                    role="menu"
                    style={{ padding: 8 }}
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
                      {profileLinks.map(([href, label]) => (
                        <li key={href}>
                          <a href={href} role="menuitem">
                            {label}
                          </a>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}

              {/* ===== Vizitatori / Comenzi ===== */}
              <a className={styles.navLink} href="/vendor/orders">
                Comenzile mele
              </a>
              <a className={styles.navLink} href="/vendor/visitors">
                Vizitatori
              </a>
              {nextStepCTA && (
                <a
                  className={styles.accountBtn}
                  href={nextStepCTA.href}
                  title="Următorul pas"
                >
                  {nextStepCTA.label}
                </a>
              )}
            </>
          ) : (
            <>
              <div className={styles.dropdown} tabIndex={0}>
                <a
                  className={styles.navLink}
                  href="#"
                  role="button"
                  aria-haspopup="menu"
                >
                  Servicii digitale
                  <ChevronDown className={styles.dropdownIcon} size={14} />
                </a>
                <div className={styles.dropdownContent} role="menu">
                  <a href="/digitale/invitatie" role="menuitem">
                    Invitație tip site
                  </a>
                  <a href="/digitale/asezare-mese" role="menuitem">
                    Așezarea la mese (SMS)
                  </a>
                  <a href="/digitale/album-qr" role="menuitem">
                    Album QR
                  </a>
                </div>
              </div>

              <a className={styles.navLink} href="/produse">
                Produse
              </a>

              <a className={styles.navLink} href="/magazine">
  Magazine
</a>

            </>
          )}

          {/* Search – desktop (doar pentru non-vendor) */}
          {me?.role !== "VENDOR" && (
            <form
              className={styles.search}
              onSubmit={submitSearch}
              role="search"
              aria-label="Căutare"
            >
              <SearchIcon size={30} className={styles.searchIcon} />
              <input
                className={styles.input}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Caută pe Artfest"
                aria-label="Caută"
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

          {/* Icon Desktop vendor */}
          {isVendor && (
            <a
              className={styles.iconWrapper}
              href="/desktop"
              title="Desktop vendor"
              aria-label="Desktop vendor"
            >
              <LayoutGrid size={22} />
            </a>
          )}

          {/* Icon Desktop user (role USER) */}
          {me && !isVendor && (
            <a
              className={styles.iconWrapper}
              href="/desktop-user"
              title="Desktop"
              aria-label="Desktop"
            >
              <LayoutGrid size={22} />
            </a>
          )}

          {/* Asistență (în funcție de tipul userului) */}
          <a
            className={styles.iconWrapper}
            href={supportHref}
            title="Asistență tehnică"
            aria-label="Asistență tehnică"
          >
            <LifeBuoy size={22} />
            {supportUnread > 0 && (
              <span className={styles.badge}>
                {Math.min(supportUnread, 99)}
              </span>
            )}
          </a>

          {me && (
            <a
              className={styles.iconWrapper}
              href="/notificari"
              title="Notificări"
              aria-label="Notificări"
            >
              <Bell size={22} />
              {unreadNotif > 0 && (
                <span className={styles.badge}>
                  {Math.min(unreadNotif, 99)}
                </span>
              )}
            </a>
          )}

          {me && (
            <a
              className={styles.iconWrapper}
              href={isVendor ? "/mesaje" : "/cont/mesaje"}
              title="Mesaje"
              aria-label="Mesaje"
            >
              <MessageSquare size={22} />
              {unreadMsgs > 0 && (
                <span className={styles.badge}>
                  {Math.min(unreadMsgs, 99)}
                </span>
              )}
            </a>
          )}

          {/* Wishlist (desktop) */}
          {me && (
            <a
              className={styles.iconWrapper}
              href="/wishlist"
              title="Lista de dorințe"
              aria-label="Lista de dorințe"
            >
              <Heart size={22} />
              {wishCount > 0 && (
                <span className={styles.badge}>
                  {Math.min(wishCount, 99)}
                </span>
              )}
            </a>
          )}

          {/* Coș */}
          <a
            className={styles.iconWrapper}
            href="/cos"
            title="Coșul meu"
            aria-label="Coșul meu"
          >
            <ShoppingCart size={22} />
            {cartCount > 0 && (
              <span className={styles.badge}>
                {Math.min(cartCount, 99)}
              </span>
            )}
          </a>

          {/* Account */}
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
                    <a href="/cont">
                      {isVendor ? "Cont (mobil)" : "Contul meu"}
                    </a>
                  </li>
                  {isVendor ? (
                    <>
                      <li>
                        <a href="/vendor/orders">Comenzile mele</a>
                      </li>
                      <li>
                        <a href="/vendor/invoices">Facturi</a>
                      </li>
                      <li>
                        <a href="/setari">Setări</a>
                      </li>
                    </>
                  ) : (
                    <>
                      <li>
                        <a href="/comenzile-mele">Comenzile mele</a>
                      </li>
                      <li>
                        <a href="/facturi">Facturi</a>
                      </li>
                      <li>
                        <a href="/cont/setari">Setări</a>
                      </li>
                    </>
                  )}

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
                          await refresh().catch(() => {});
                        } catch {
                          ""
                        }
                        window.location.href = "/autentificare";
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
              <a
                className={styles.iconWrapper}
                href={isVendor ? "/mesaje" : "/cont/mesaje"}
                title="Mesaje"
                aria-label="Mesaje"
              >
                <MessageSquare size={22} />
                {unreadMsgs > 0 && (
                  <span className={styles.badgeMini}>
                    {Math.min(unreadMsgs, 99)}
                  </span>
                )}
              </a>
            )}

            {me && (
              <a
                className={styles.iconWrapper}
                href="/notificari"
                title="Notificări"
                aria-label="Notificări"
              >
                <Bell size={22} />
                {unreadNotif > 0 && (
                  <span className={styles.badgeMini}>
                    {Math.min(unreadNotif, 99)}
                  </span>
                )}
              </a>
            )}
          </div>

          <form
            className={`${styles.search} ${styles.searchSm}`}
            onSubmit={submitSearch}
            role="search"
            aria-label="Căutare"
            style={{ flex: 1 }}
          >
            <SearchIcon size={18} className={styles.searchIcon} />
            <input
              className={styles.input}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Caută pe Artfest"
              aria-label="Caută"
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
          </form>

          <div className={styles.mobileSearchRight}>
            <a
              className={styles.iconWrapper}
              href={supportHref}
              title="Asistență tehnică"
              aria-label="Asistență tehnică"
            >
              <LifeBuoy size={22} />
              {supportUnread > 0 && (
                <span className={styles.badgeMini}>
                  {Math.min(supportUnread, 99)}
                </span>
              )}
            </a>
          </div>
        </div>
      </div>

      {/* Modale */}
      <Modal
        open={authOpen}
        onClose={closeAuth}
        title="Conectează-te sau creează cont"
      >
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

      <Modal
        open={partnerOpen}
        onClose={() => setPartnerOpen(false)}
        title="Devino partener pe ArtFest"
      >
        <Register defaultAsVendor={true} inModal />
      </Modal>

      {/* Mobile bottom navigation */}
      <MobileBar me={me} unreadNotif={unreadNotif} cartCount={cartCount} />
    </header>
  );
}
