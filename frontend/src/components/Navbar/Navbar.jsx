import { useEffect, useMemo, useState, useRef } from "react";
import { createPortal } from "react-dom";
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
  const [me, setMe] = useState(null);
  const [burgerOpen, setBurgerOpen] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [authTab, setAuthTab] = useState("login");
  const [partnerOpen, setPartnerOpen] = useState(false);

  const [srvZona, setSrvZona] = useState("");
  const [q, setQ] = useState("");
  const [scope] = useState("toate");

  const [wishCount, setWishCount] = useState(0);
  const [cartCount, setCartCount] = useState(0);
  const [vServices, setVServices] = useState([]);
  const [unreadMsgs, setUnreadMsgs] = useState(0);
  const [unreadNotif, setUnreadNotif] = useState(0);
  const [onboarding, setOnboarding] = useState(null);

  const [uploadingImg, setUploadingImg] = useState(false);

  // ✅ fără id duplicat — folosim ref-uri separate
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

  // Me
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const d = await api("/api/auth/me");
        if (alive) setMe(d.user);
      } catch {
        if (alive) setMe(null);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

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
      } finally {""}
    })();
    return () => {
      alive = false;
    };
  }, [me?.role]);

  // Counts: notifications, messages, onboarding
  useEffect(() => {
    let alive = true;
    (async () => {
      if (me) {
        const notif = await api("/api/notifications/unread-count").catch(
          () => ({ count: 0 })
        );
        if (alive) setUnreadNotif(notif?.count || 0);
      } else {
        setUnreadNotif(0);
      }
      if (me?.role === "VENDOR") {
        const msgs = await api("/api/inbox/unread-count").catch(() => ({
          count: 0,
        }));
        const ob = await api("/api/vendors/me/onboarding-status").catch(
          () => null
        );
        if (!alive) return;
        setUnreadMsgs(msgs?.count || 0);
        setOnboarding(ob || null);
      } else {
        setUnreadMsgs(0);
        setOnboarding(null);
      }
    })();
    return () => {
      alive = false;
    };
  }, [me?.role, me]);

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
    } catch {""}
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

  const isVendor = me?.role === "VENDOR";
  const isAdmin = me?.role === "ADMIN";
  const isUser = me?.role === "USER";

  // Profiluri (vendor)
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

  // CTA „Continuă setup” (vendor)
  const nextStepCTA = useMemo(() => {
    if (!onboarding?.exists)
      return isVendor ? { label: "Începe setup", href: "/onboarding" } : null;
    const map = {
      selectServices: { label: "Alege servicii", href: "/onboarding" },
      profile: { label: "Publică profilul", href: "/onboarding/details" },
      done: null,
    };
    return map[onboarding?.nextStep] || null;
  }, [onboarding, isVendor]);

  const ACHIZITII_LABEL = "Achiziții";

  // === Căutare după imagine
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

      const ids = Array.isArray(res?.items) ? res.items.map((x) => x.id).filter(Boolean) : [];
      if (ids.length > 0) {
        try {
          sessionStorage.setItem(`imgsearch:${res.searchId || "last"}`, JSON.stringify(res));
        } catch {""}
        window.location.href = `/produse?ids=${encodeURIComponent(ids.join(","))}`;
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

  // ✅ fără getElementById — folosim ref-urile dedicate
  function openImagePickerDesktop() {
    fileInputDesktopRef.current?.click();
  }
  function openImagePickerMobile() {
    fileInputMobileRef.current?.click();
  }

  // redirect pentru Login din query param
  const loginRedirect = (() => {
    try {
      const sp = new URLSearchParams(window.location.search);
      return sp.get("redirect") || "/desktop";
    } catch {
      return "/desktop";
    }
  })();

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
                <a className={styles.navLink} href="#" role="button" aria-haspopup="menu">
                  {ACHIZITII_LABEL}
                  <ChevronDown className={styles.dropdownIcon} size={14} />
                </a>
                <div className={styles.dropdownContent} role="menu" style={{ padding: 10, minWidth: 280 }}>
                  <div className={styles.menuGrid}>
                    <div>
                      <div className={styles.groupLabel}>Servicii digitale</div>
                      <div className={styles.colGrid}>
                        <a href="/digitale/invitatie" role="menuitem">Invitație tip site</a>
                        <a href="/digitale/asezare-mese" role="menuitem">Așezarea la mese (SMS)</a>
                        <a href="/digitale/album-qr" role="menuitem">Album QR</a>
                      </div>
                    </div>
                    <div>
                      <div className={styles.groupLabel}>Produse</div>
                      <div className={styles.colGrid}>
                        <a href="/produse" role="menuitem">Produse</a>
                      </div>
                    </div>
                    <div>
                      <div className={styles.groupLabel}>Servicii</div>
                      <div className={styles.colGrid}>
                        <a href="/servicii" role="menuitem">Toate serviciile</a>
                        <form
                          onSubmit={(e) => {
                            e.preventDefault();
                            window.location.href = `/servicii?zona=${encodeURIComponent(srvZona)}`;
                          }}
                          className={styles.zoneForm}
                        >
                          <input
                            className={styles.field}
                            placeholder="Zonă (ex: București)"
                            value={srvZona}
                            onChange={(e) => setSrvZona(e.target.value)}
                          />
                          <button className={styles.primaryBtn} type="submit">Caută în zonă</button>
                        </form>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* ===== Profiluri ===== */}
              {profileLinks.length <= 1 ? (
                <a className={styles.navLink} href={profileLinks[0]?.[0] || "/onboarding"}>
                  {profileLinks[0]?.[1] || "Profil"}
                </a>
              ) : (
                <div className={styles.dropdown} tabIndex={0}>
                  <a className={styles.navLink} href="#" role="button" aria-haspopup="menu">
                    Profiluri <ChevronDown className={styles.dropdownIcon} size={14} />
                  </a>
                  <div className={styles.dropdownContent} role="menu" style={{ padding: 8 }}>
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
                          <a href={href} role="menuitem">{label}</a>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}

              {/* ===== Vizitatori / Mesaje / Asistență ===== */}
              <a className={styles.navLink} href="/vendor/visitors">Vizitatori</a>
              <a className={styles.navLink} href="/mesaje">Mesaje</a>
              <a className={styles.navLink} href="/asistenta-tehnica">Asistență tehnică</a>

              {nextStepCTA && (
                <a className={styles.accountBtn} href={nextStepCTA.href} title="Următorul pas">
                  {nextStepCTA.label}
                </a>
              )}
            </>
          ) : (
            <>
              <div className={styles.dropdown} tabIndex={0}>
                <a className={styles.navLink} href="#" role="button" aria-haspopup="menu">
                  Servicii digitale
                  <ChevronDown className={styles.dropdownIcon} size={14} />
                </a>
                <div className={styles.dropdownContent} role="menu">
                  <a href="/digitale/invitatie" role="menuitem">Invitație tip site</a>
                  <a href="/digitale/asezare-mese" role="menuitem">Așezarea la mese (SMS)</a>
                  <a href="/digitale/album-qr" role="menuitem">Album QR</a>
                </div>
              </div>

              <a className={styles.navLink} href="/produse">Produse</a>

              <div className={styles.dropdown} tabIndex={0}>
                <a className={styles.navLink} href="#" role="button" aria-haspopup="menu">
                  Servicii
                  <ChevronDown className={styles.dropdownIcon} size={14} />
                </a>
                <div className={styles.dropdownContent} role="menu" style={{ padding: 8 }}>
                  <a href="/magazine" role="menuitem">Magazine</a>
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
            </>
          )}

          {/* Search – desktop */}
          {me?.role !== "VENDOR" && (
            <form className={styles.search} onSubmit={submitSearch} role="search" aria-label="Căutare">
              <SearchIcon size={18} className={styles.searchIcon} />
              <input
                className={styles.input}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Caută pe Artfest"
                aria-label="Caută"
              />

              {/* ✅ input fișier (desktop) */}
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

        {/* Dreapta: acțiuni + cont + ASISTENȚĂ */}
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
            href="/asistenta-tehnica"
            title="Asistență tehnică"
            aria-label="Asistență tehnică"
          >
            <LifeBuoy size={22} />
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

          {isVendor && (
            <a
              className={styles.iconWrapper}
              href="/mesaje"
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

          {/* Wishlist (DESKTOP): doar când utilizatorul este logat) */}
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

          {/* Coșul */}
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
            // Dropdown cont
            <div className={styles.dropdown}>
              <button
                className={styles.avatarBtn}
                title="Contul meu"
                aria-label="Contul meu"
                type="button"
              >
                <span className={styles.avatar}>{initials}</span>
                <ChevronDown className={styles.dropdownIcon} size={14} />
              </button>
              <div className={styles.dropdownContent} style={{ padding: 10, minWidth: 240 }}>
                <ul
                  style={{
                    margin: 0,
                    padding: 0,
                    listStyle: "none",
                    display: "grid",
                    gap: 4,
                  }}
                >
                  <li><a href="/desktop">Desktop</a></li>
                  {isUser && <li><a href="/comenzile-mele">Comenzile mele</a></li>}
                  <li><a href="/wishlist">Lista de dorințe</a></li>
                  <li><a href="/notificari">Notificări</a></li>
                  {isVendor && (
                    <>
                      <li><a href="/vendor/visitors">Vizitatori</a></li>
                      <li><a href="/mesaje">Mesaje</a></li>
                    </>
                  )}
                  {isAdmin && <li><a href="/admin">Panou Admin</a></li>}
                  <li><a href="/setari">Setări</a></li>
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
                        } catch {""}
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

      {/* === Mobil: sus — Mesaje/Notificări la stânga, Căutare la mijloc, Asistență la dreapta === */}
      <div className={styles.mobileSearch}>
        <div className={styles.mobileSearchRow}>
          {/* Stânga: Mesaje (vendor) + Notificări (logat) */}
          <div className={styles.mobileSearchLeft}>
            {isVendor && (
              <a
                className={styles.iconWrapper}
                href="/mesaje"
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

          {/* Căutare (se întinde) */}
          <form
            className={`${styles.search} ${styles.searchSm}`}
            onSubmit={submitSearch}
            role="search"
            aria-label="Căutare"
            style={{ flex: 1 }}
          >
            <SearchIcon size={18} className={styles.searchIcon}/>
            <input
              className={styles.input}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Caută pe Artfest"
              aria-label="Caută"
            />

            {/* ✅ input fișier (mobil) */}
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

          {/* Dreapta: Asistență tehnică */}
          <div className={styles.mobileSearchRight}>
            <a
              className={styles.iconWrapper}
              href="/asistenta-tehnica"
              title="Asistență tehnică"
              aria-label="Asistență tehnică"
            >
              <LifeBuoy size={22} />
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
                authTab === "login" ? "var(--color-primary)" : "var(--color-border)",
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

      {/* === Mobile: Bottom Navigation === */}
      <MobileBar me={me} unreadNotif={unreadNotif} cartCount={cartCount} />
    </header>
  );
}
