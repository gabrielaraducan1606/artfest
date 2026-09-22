// src/components/Navbar/Navbar.jsx
import { useEffect, useMemo, useState, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate, Link, NavLink } from "react-router-dom";
import {
  Heart,
  ShoppingCart,
  Search as SearchIcon,
  ChevronDown,
  ChevronRight,
  Menu,
  X,
  Sun,
  Moon,
  Bell,
  MessageSquare,
  User as UserIcon,
  Home,
  LayoutGrid,
  Camera,
  LifeBuoy,
  Store,
  Package,
  Users,
  Upload,
  Layers,
  Tag,
  ShoppingBag,
  Megaphone,
  Percent,
  Receipt,
  CreditCard,
  TrendingUp,
  Settings,
  FileText,
  LogOut,
  CalendarDays,
  Activity,
  Sparkles,
  UserPlus,
  Wrench,
  AlertTriangle,
} from "lucide-react";

import { api } from "../../lib/api";
import { useAuth } from "../../pages/Auth/Context/context.js";
import styles from "./Navbar.module.css";
import logo from "../../assets/LogoArtfest.png";
import Register from "../../pages/Auth/Register/Register";
import Login from "../../pages/Auth/Login/Login";
import { getGuestCartCount } from "../../utils/guestCart";
import NotificationsPopover from "./NotificationsPopover";
import MessagesPopover from "./MessagesPopover";
import { useImageSearch } from "../../hooks/useImageSearch";
import { useUnreadMessagesCount } from "../../features/messages/hooks/useUnreadMessagesCount";
import {
  VENDOR_DASHBOARD_LINK,
  VENDOR_NAV_SECTIONS,
} from "../../config/vendorNavigation.js";
import {
  USER_DASHBOARD_LINK,
  USER_NAV_SECTIONS,
} from "../../config/userNavigation.js";
import {
  INFLUENCER_DASHBOARD_LINK,
  INFLUENCER_NAV_SECTIONS,
} from "../../config/influencerNavigation.js";
import { GUEST_NAV_SECTIONS } from "../../config/guestNavigation.js";
import { usePublicCollections } from "../../hooks/usePublicCollections";
import { toCollectionCards } from "../../pages/Home/CollectionsSection/collectionCards.js";
import {
  ADMIN_DASHBOARD_LINK,
  ADMIN_NAV_SECTIONS,
} from "../../config/adminNavigation.js";

/*
 * Lookup de iconițe pentru drawerul de rol (VendorDrawer - shell comun,
 * reutilizat acum și de USER, vezi mai jos) - config-urile statice
 * (vendorNavigation.js, userNavigation.js) țin doar numele (string),
 * nu JSX/componente.
 */
const VENDOR_DRAWER_ICONS = {
  Store,
  Users,
  Package,
  Upload,
  Layers,
  Tag,
  ShoppingBag,
  MessageSquare,
  Megaphone,
  Percent,
  Receipt,
  CreditCard,
  TrendingUp,
  Settings,
  LifeBuoy,
  FileText,
  LayoutGrid,
  CalendarDays,
  Bell,
  Heart,
  Activity,
  Home,
  Sparkles,
  UserPlus,
  UserIcon,
  Wrench,
  AlertTriangle,
};

function VendorDrawerIcon({ name, size = 18 }) {
  const IconComponent = VENDOR_DRAWER_ICONS[name];
  if (!IconComponent) return null;
  return <IconComponent size={size} aria-hidden="true" />;
}

/*
 * Un item de drawer e "activ" dacă pathname-ul curent se potrivește
 * (exact sau ca prefix, pentru rute cu :id ca /vendor/orders/:id) și,
 * dacă item.to are un query string (?tab=...), toate perechile din el
 * regăsindu-se identic în query-ul curent - altfel toate tab-urile
 * /vendor/catalog ar apărea simultan active. Pură/generică - folosită
 * acum de orice rol care are drawer (nu doar vendor).
 */
function isVendorNavItemActive(item, location) {
  const [itemPath, itemQuery] = (item?.to || "").split("?");
  if (!itemPath) return false;

  const pathname = location.pathname;
  const matchesPath =
    pathname === itemPath || pathname.startsWith(`${itemPath}/`);

  if (!matchesPath) return false;
  if (!itemQuery) return true;

  const itemParams = new URLSearchParams(itemQuery);
  const currentParams = new URLSearchParams(location.search);

  for (const [key, value] of itemParams.entries()) {
    if (currentParams.get(key) !== value) return false;
  }

  return true;
}

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
  const isVendor = me?.role === "VENDOR";

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

      {me ? (
        <NavLink
          to={
  me.role === "USER"
    ? "/desktop-user"
    : me.role === "VENDOR"
    ? "/desktop"
    : me.role === "INFLUENCER"
    ? "/influencer"
    : "/"
}
          className={styles.mobileItem}
          aria-label="Contul meu"
        >
          <UserIcon size={22} />
          <span>Cont</span>

          {unreadNotif > 0 && (
            <span className={styles.badgeMini}>{Math.min(unreadNotif, 99)}</span>
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

      {me && isVendor ? (
        <NavLink
          to="/vendor/store"
          className={styles.mobileItem}
          aria-label="Magazinul meu"
        >
          <Store size={22} />
          <span>Magazin</span>
        </NavLink>
      ) : me ? (
        <NavLink
          to="/wishlist"
          className={styles.mobileItem}
          aria-label="Lista de dorințe"
        >
          <Heart size={22} />
          <span>Dorințe</span>
        </NavLink>
      ) : null}

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

/* ==========================================
   Drawer vendor (portal în document.body)

   Deschis din burgerul principal / trigger-ul mobil (state
   burgerOpen, reutilizat - nu e un al doilea sistem de state).
   Are propriul backdrop (navBackdrop existent e ascuns pe mobil cu
   !important pentru vechiul .nav, deci nu poate fi reutilizat ca
   atare) - Escape și scroll lock rămân gestionate central în Navbar,
   pe același burgerOpen.
========================================== */
function VendorDrawer({
  open,
  onClose,
  displayName,
  eyebrow = "Dashboard vendor",
  dashboardLink = VENDOR_DASHBOARD_LINK,
  sections,
  openSections,
  onToggleSection,
  isItemActive,
  nextStepCTA,
  theme,
  onToggleTheme,
  onLogout,
}) {
  if (!open) return null;

  const isDark = theme === "dark";

  const node = (
    <>
      <button
        type="button"
        className={styles.vendorDrawerBackdrop}
        onClick={onClose}
        aria-label="Închide meniul"
      />

      <aside
        className={styles.vendorDrawer}
        role="dialog"
        aria-modal="true"
        aria-label="Meniu"
        onClick={(e) => {
          if (e.target.closest("a")) onClose();
        }}
      >
      <header className={styles.vendorDrawerHead}>
        <div className={styles.vendorDrawerHeadText}>
          <div className={styles.vendorDrawerEyebrow}>{eyebrow}</div>
          {displayName && (
            <div className={styles.vendorDrawerName} title={displayName}>
              {displayName}
            </div>
          )}
        </div>

        <button
          type="button"
          className={styles.vendorDrawerClose}
          onClick={onClose}
          aria-label="Închide meniul"
        >
          <X size={18} />
        </button>
      </header>

      <nav className={styles.vendorDrawerBody} aria-label="Navigație">
        {dashboardLink && (
          <NavLink
            to={dashboardLink.to}
            className={`${styles.vendorDrawerDashboardLink} ${
              isItemActive(dashboardLink)
                ? styles.vendorDrawerItemActive
                : ""
            }`}
          >
            <VendorDrawerIcon name={dashboardLink.icon} />
            {dashboardLink.label}
          </NavLink>
        )}

        {sections.map((section) => {
          const isOpen = openSections.has(section.key);

          return (
            <div key={section.key} className={styles.vendorDrawerSection}>
              <button
                type="button"
                className={styles.vendorDrawerSectionHead}
                onClick={() => onToggleSection(section.key)}
                aria-expanded={isOpen ? "true" : "false"}
                aria-controls={`vendor-drawer-section-${section.key}`}
                id={`vendor-drawer-section-${section.key}-trigger`}
              >
                <VendorDrawerIcon name={section.icon} />
                <span className={styles.vendorDrawerSectionLabel}>
                  {section.label}
                </span>
                {isOpen ? (
                  <ChevronDown size={16} />
                ) : (
                  <ChevronRight size={16} />
                )}
              </button>

              {isOpen && (
                <div
                  className={styles.vendorDrawerSectionBody}
                  id={`vendor-drawer-section-${section.key}`}
                  role="group"
                  aria-labelledby={`vendor-drawer-section-${section.key}-trigger`}
                >
                  {section.items.map((item) =>
                    item.to ? (
                      <NavLink
                        key={item.to}
                        to={item.to}
                        className={`${styles.vendorDrawerItem} ${
                          isItemActive(item)
                            ? styles.vendorDrawerItemActive
                            : ""
                        }`}
                      >
                        <VendorDrawerIcon name={item.icon} size={16} />
                        {item.label}
                      </NavLink>
                    ) : (
                      <button
                        key={item.label}
                        type="button"
                        className={styles.vendorDrawerItem}
                        onClick={() => {
                          item.onSelect?.();
                          onClose();
                        }}
                      >
                        <VendorDrawerIcon name={item.icon} size={16} />
                        {item.label}
                      </button>
                    )
                  )}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {nextStepCTA && (
        <div className={styles.vendorDrawerNextStep}>
          <div className={styles.vendorDrawerNextStepLabel}>
            Următorul pas
          </div>

          <NavLink
            to={nextStepCTA.href}
            className={styles.vendorDrawerNextStepBtn}
          >
            {nextStepCTA.label}
          </NavLink>
        </div>
      )}

      <div className={styles.vendorDrawerFooter}>
        <div className={styles.vendorDrawerPrefRow}>
          <span className={styles.vendorDrawerPrefLabel}>
            {isDark ? (
              <Moon size={18} aria-hidden="true" />
            ) : (
              <Sun size={18} aria-hidden="true" />
            )}
            {isDark ? "Mod întunecat" : "Mod luminos"}
          </span>

          <button
            type="button"
            role="switch"
            aria-checked={isDark}
            aria-label="Comută tema deschisă/închisă"
            className={styles.vendorDrawerThemeSwitch}
            onClick={onToggleTheme}
          >
            <span className={styles.vendorDrawerThemeSwitchThumb} />
          </button>
        </div>

        {onLogout && (
          <button
            type="button"
            className={styles.vendorDrawerLogoutBtn}
            onClick={() => {
              onClose();
              onLogout();
            }}
            aria-label="Deconectare din cont"
          >
            <LogOut size={18} aria-hidden="true" />
            Deconectare
          </button>
        )}
      </div>
      </aside>
    </>
  );

  return createPortal(node, document.body);
}

/* ===================== Navbar principal ===================== */
export default function Navbar() {
  const { me, refresh } = useAuth();

  const location = useLocation();
  const navigate = useNavigate();

  const {
    searching: uploadingImg,
    fileInputRef: imageInputRef,
    openPicker: openImagePicker,
    handleFileChange,
  } = useImageSearch();

  const STORE_PAGE_PREFIX = "/magazin";

  /*
   * Colecții Artfest marcate showInMenu (doar active - filtrate de
   * backend). Linkuri interne reale către /colectii/:slug în meniul
   * principal; dropdown-ul nu apare dacă nu există nicio colecție.
   */
  const menuCollectionItems = usePublicCollections("menu");
  const menuCollections = useMemo(
    () => toCollectionCards(menuCollectionItems, { max: 20 }),
    [menuCollectionItems]
  );

  const [burgerOpen, setBurgerOpen] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [authTab, setAuthTab] = useState("login");
  const [partnerOpen, setPartnerOpen] = useState(false);

  const [q, setQ] = useState("");

  const [wishCount, setWishCount] = useState(0);
  const [cartCount, setCartCount] = useState(0);
  const [vServices, setVServices] = useState([]);
  const { count: unreadMsgs } = useUnreadMessagesCount();
  const [unreadNotif, setUnreadNotif] = useState(0);
  const [onboarding, setOnboarding] = useState(null);
  const [supportUnread, setSupportUnread] = useState(0);

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

  const [notifOpen, setNotifOpen] = useState(false);
  const notifBtnDesktopRef = useRef(null);
  const notifBtnMobileRef = useRef(null);

  useEffect(() => {
    setNotifOpen(false);
  }, [location.pathname]);

  const [msgOpen, setMsgOpen] = useState(false);
  const msgBtnDesktopRef = useRef(null);
  const msgBtnMobileRef = useRef(null);

  useEffect(() => {
    setMsgOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("theme", theme);
  }, [theme]);

  const toggleTheme = () => setTheme((t) => (t === "dark" ? "light" : "dark"));

  /*
   * Logout - o singură logică, reutilizată de dropdown-ul avatarului
   * (admin + normal) și de drawer-ul vendor, ca să nu se dubleze.
   */
  const handleLogout = useCallback(async () => {
    try {
      await api("/api/auth/logout", { method: "POST" });
      if (typeof refresh === "function") await refresh();
    } catch {
      // ignore
    }
    navigate("/autentificare", { replace: true });
  }, [refresh, navigate]);

  const computeGuestCartCount = useCallback(() => {
  try {
    return getGuestCartCount();
  } catch {
    return 0;
  }
}, []);
  /* ===== cart count refresh (guest + logged) ===== */
useEffect(() => {
  let alive = true;

  async function refreshCart() {
    /*
     * Citim mereu și coșul guest.
     * Este fallback-ul corect dacă tokenul
     * este expirat, chiar dacă me încă există
     * temporar în context.
     */
    const guestCount =
      computeGuestCartCount();

    if (!me) {
      if (alive) {
        setCartCount(
          guestCount
        );
      }

      return;
    }

    try {
      const response =
        await api(
          "/api/cart/count"
        );

      /*
       * Compatibilitate cu helperul api(),
       * dacă acesta întoarce __unauth în loc
       * să arunce eroarea.
       */
      if (
        response?.__unauth ||
        response?.status === 401
      ) {
        if (alive) {
          setCartCount(
            guestCount
          );
        }

        return;
      }

      const serverCount =
        Number(
          response?.count ||
            0
        );

      if (alive) {
        /*
         * În mod normal folosim coșul server.
         * Dacă produsul tocmai a fost salvat
         * ca guest din cauza unui token expirat,
         * nu pierdem badge-ul.
         */
        setCartCount(
          Math.max(
            serverCount,
            guestCount
          )
        );
      }
    } catch (error) {
      const status =
        error?.status ||
        error?.response?.status ||
        error?.data?.status;

      if (alive) {
        /*
         * La 401 utilizatorul funcționează
         * temporar ca guest.
         */
        if (status === 401) {
          setCartCount(
            guestCount
          );
        } else {
          setCartCount(
            guestCount
          );
        }
      }
    }
  }

  refreshCart();

  function handleCartChanged() {
    refreshCart();
  }

  function handleStorage(
    event
  ) {
    if (
      event.key ===
      "artfest_guest_cart"
    ) {
      refreshCart();
    }
  }

  window.addEventListener(
    "cart:changed",
    handleCartChanged
  );

  window.addEventListener(
    "storage",
    handleStorage
  );

  return () => {
    alive = false;

    window.removeEventListener(
      "cart:changed",
      handleCartChanged
    );

    window.removeEventListener(
      "storage",
      handleStorage
    );
  };
}, [
  me,
  computeGuestCartCount,
]);

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
  }, [me, computeGuestCartCount]);

  useEffect(() => {
  const handleFavoritesChanged = (e) => {
    const delta = Number(e.detail?.delta || 0);

    setWishCount((prev) =>
      Math.max(0, prev + delta)
    );
  };

  window.addEventListener(
    "favorites-changed",
    handleFavoritesChanged
  );

  return () =>
    window.removeEventListener(
      "favorites-changed",
      handleFavoritesChanged
    );
}, []);
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

  /* ===== notif + onboarding =====
   * ETAPA 1 (audit Mesaje, #3 MEDIUM): unread-count-ul de mesaje era
   * preluat aici ȘI în fetchUnreadMessages de mai jos (dublu request
   * spre aceleași endpoint-uri la fiecare load/poll). Rămâne un singur
   * loc: fetchUnreadMessages. Acest efect gestionează doar notif +
   * onboarding, care nu sunt duplicate nicăieri altundeva.
   */
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
        if (alive) setOnboarding(null);
        return;
      }

      if (me.role === "VENDOR") {
        const ob = await api("/api/vendors/me/onboarding-status").catch(() => null);
        if (!alive) return;
        setOnboarding(ob || null);
        return;
      }

      if (alive) setOnboarding(null);
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

  /* ===== Escape închide burgerul (meniu / drawer vendor) ===== */
  useEffect(() => {
    if (!burgerOpen) return;

    function onKeyDown(e) {
      if (e.key === "Escape") setBurgerOpen(false);
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
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
const isInfluencer = me?.role === "INFLUENCER";
const isUser = me?.role === "USER";
const isGuest = !me;
const isAdmin = me?.role === "ADMIN";
const isAdminRoute = location.pathname.startsWith("/admin");
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

  /* ===== Drawer vendor: secțiuni (config static + profileLinks) ===== */
  const [vendorOpenSections, setVendorOpenSections] = useState(
    () => new Set()
  );

  const vendorSections = useMemo(() => {
    return VENDOR_NAV_SECTIONS.map((section) => {
      if (section.key !== "magazin") return section;

      const profileItems = profileLinks.map(([href, label]) => ({
        label,
        to: href,
        icon: "Store",
      }));

      return {
        ...section,
        items: [
          section.items[0],
          ...profileItems,
          ...section.items.slice(1),
        ],
      };
    });
  }, [profileLinks]);

  const activeVendorSectionKey = useMemo(() => {
    if (!isVendor) return null;

    for (const section of vendorSections) {
      if (
        section.items.some((item) =>
          isVendorNavItemActive(item, location)
        )
      ) {
        return section.key;
      }
    }

    return null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isVendor, vendorSections, location.pathname, location.search]);

  useEffect(() => {
    if (!activeVendorSectionKey) return;

    setVendorOpenSections((prev) => {
      if (prev.has(activeVendorSectionKey)) return prev;
      const next = new Set(prev);
      next.add(activeVendorSectionKey);
      return next;
    });
  }, [activeVendorSectionKey, burgerOpen]);

  const toggleVendorSection = useCallback((key) => {
    setVendorOpenSections((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const isVendorItemActive = useCallback(
    (item) => isVendorNavItemActive(item, location),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [location.pathname, location.search]
  );

  const vendorDisplayName =
    me?.name ||
    `${me?.firstName || ""} ${me?.lastName || ""}`.trim() ||
    me?.email ||
    "Vendor";

  /*
   * Drawer USER - același shell (VendorDrawer), config separat
   * (userNavigation.js), fără nimic dinamic de injectat (spre
   * deosebire de vendor, care combină profileLinks) - secțiunile
   * sunt folosite direct din config.
   */
  const [userOpenSections, setUserOpenSections] = useState(
    () => new Set()
  );

  const activeUserSectionKey = useMemo(() => {
    if (!isUser) return null;

    for (const section of USER_NAV_SECTIONS) {
      if (
        section.items.some((item) =>
          isVendorNavItemActive(item, location)
        )
      ) {
        return section.key;
      }
    }

    return null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isUser, location.pathname, location.search]);

  useEffect(() => {
    if (!activeUserSectionKey) return;

    setUserOpenSections((prev) => {
      if (prev.has(activeUserSectionKey)) return prev;
      const next = new Set(prev);
      next.add(activeUserSectionKey);
      return next;
    });
  }, [activeUserSectionKey, burgerOpen]);

  const toggleUserSection = useCallback((key) => {
    setUserOpenSections((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const userDisplayName =
    me?.name ||
    `${me?.firstName || ""} ${me?.lastName || ""}`.trim() ||
    me?.email ||
    "Contul meu";

  /*
   * Drawer INFLUENCER - același shell, config separat
   * (influencerNavigation.js), fără nimic dinamic de injectat.
   */
  const [influencerOpenSections, setInfluencerOpenSections] = useState(
    () => new Set()
  );

  const activeInfluencerSectionKey = useMemo(() => {
    if (!isInfluencer) return null;

    for (const section of INFLUENCER_NAV_SECTIONS) {
      if (
        section.items.some((item) =>
          isVendorNavItemActive(item, location)
        )
      ) {
        return section.key;
      }
    }

    return null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isInfluencer, location.pathname, location.search]);

  useEffect(() => {
    if (!activeInfluencerSectionKey) return;

    setInfluencerOpenSections((prev) => {
      if (prev.has(activeInfluencerSectionKey)) return prev;
      const next = new Set(prev);
      next.add(activeInfluencerSectionKey);
      return next;
    });
  }, [activeInfluencerSectionKey, burgerOpen]);

  const toggleInfluencerSection = useCallback((key) => {
    setInfluencerOpenSections((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const influencerDisplayName =
    me?.name ||
    `${me?.firstName || ""} ${me?.lastName || ""}`.trim() ||
    me?.email ||
    "Influencer";

  /*
   * Drawer GUEST - același shell, config separat (guestNavigation.js).
   * Autentificare/Creează cont/Devino partener nu sunt rute (item.to
   * lipsă) - sunt modalele deja existente (authOpen/partnerOpen),
   * legate aici prin item.action, NU în config (care rămâne date pure).
   */
  const GUEST_ACTIONS = {
    login: () => {
      setAuthTab("login");
      setAuthOpen(true);
    },
    register: () => {
      setAuthTab("register");
      setAuthOpen(true);
    },
    partner: () => setPartnerOpen(true),
  };

  const guestSections = useMemo(() => {
    return GUEST_NAV_SECTIONS.map((section) => ({
      ...section,
      items: section.items.map((item) =>
        item.action
          ? { ...item, onSelect: GUEST_ACTIONS[item.action] }
          : item
      ),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [guestOpenSections, setGuestOpenSections] = useState(
    () => new Set()
  );

  const activeGuestSectionKey = useMemo(() => {
    if (!isGuest) return null;

    for (const section of guestSections) {
      if (
        section.items.some((item) =>
          isVendorNavItemActive(item, location)
        )
      ) {
        return section.key;
      }
    }

    return null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isGuest, guestSections, location.pathname, location.search]);

  useEffect(() => {
    if (!activeGuestSectionKey) return;

    setGuestOpenSections((prev) => {
      if (prev.has(activeGuestSectionKey)) return prev;
      const next = new Set(prev);
      next.add(activeGuestSectionKey);
      return next;
    });
  }, [activeGuestSectionKey, burgerOpen]);

  const toggleGuestSection = useCallback((key) => {
    setGuestOpenSections((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  /*
   * Drawer ADMIN - același shell, config separat (adminNavigation.js).
   * Declarat aici (înainte de return-ul early al branch-ului admin,
   * câteva zeci de linii mai jos) ca să respecte regulile hook-urilor
   * React - nu poate fi condiționat de acel return.
   */
  const [adminOpenSections, setAdminOpenSections] = useState(
    () => new Set()
  );

  const activeAdminSectionKey = useMemo(() => {
    if (!isAdmin) return null;

    for (const section of ADMIN_NAV_SECTIONS) {
      if (
        section.items.some((item) =>
          isVendorNavItemActive(item, location)
        )
      ) {
        return section.key;
      }
    }

    return null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, location.pathname, location.search]);

  useEffect(() => {
    if (!activeAdminSectionKey) return;

    setAdminOpenSections((prev) => {
      if (prev.has(activeAdminSectionKey)) return prev;
      const next = new Set(prev);
      next.add(activeAdminSectionKey);
      return next;
    });
  }, [activeAdminSectionKey, burgerOpen]);

  const toggleAdminSection = useCallback((key) => {
    setAdminOpenSections((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const adminDisplayName =
    me?.name ||
    `${me?.firstName || ""} ${me?.lastName || ""}`.trim() ||
    me?.email ||
    "Admin";

 const loginRedirect = (() => {
  try {
    const sp =
      new URLSearchParams(
        location.search
      );

    const requestedRedirect =
      sp.get(
        "redirect"
      );

    /*
     * Acceptăm doar redirect-uri interne.
     *
     * Ex:
     * /
     * /cereri/123
     * /produs/abc#recenzii
     */
    if (
      requestedRedirect &&
      requestedRedirect.startsWith("/") &&
      !requestedRedirect.startsWith("//")
    ) {
      return requestedRedirect;
    }

    /*
     * Dacă autentificarea este deschisă
     * direct din Navbar, nu avem redirect
     * contextual.
     *
     * Login.jsx va decide desktop-ul
     * în funcție de rol.
     */
    return null;
  } catch {
    return null;
  }
})();

  /* ================= NAVBAR SPECIAL PENTRU ADMIN ================= */
  if (isAdmin && isAdminRoute) {
    return (
      <header className={styles.header}>
        <div className={styles.container}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <button
              type="button"
              className={`${styles.burger} ${styles.burgerVendor}`}
              onClick={() => setBurgerOpen((v) => !v)}
              aria-label="Meniu admin"
              aria-expanded={burgerOpen ? "true" : "false"}
            >
              <Menu size={22} />
            </button>

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
            <NavLink className={styles.navLink} to="/admin/vendor-plans" end>
              Abonamente
            </NavLink>
            <NavLink className={styles.navLink} to="/admin/pickups" end>
              Colete
            </NavLink>
            <NavLink className={styles.navLink} to="/admin/billing" end>
              Facturare
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
                <span className={styles.badge}>{Math.min(supportUnread, 99)}</span>
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
                      onClick={(e) => {
                        e.preventDefault();
                        handleLogout();
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

        {/*
         * .container e ascuns pe mobil (regulă CSS comună tuturor
         * rolurilor) - burgerul de mai sus devine invizibil acolo.
         * .mobileSearch e vizibil doar pe mobil (regulă deja
         * existentă) - îl reutilizăm doar ca declanșator de drawer,
         * fără câmp de căutare (adminul nu are search de produse).
         */}
        <div className={styles.mobileSearch}>
          <div className={styles.mobileSearchRow}>
            <div className={styles.mobileSearchLeft}>
              <button
                type="button"
                className={styles.iconWrapper}
                onClick={() => setBurgerOpen(true)}
                title="Meniu admin"
                aria-label="Meniu admin"
                aria-expanded={burgerOpen ? "true" : "false"}
              >
                <Menu size={22} />
              </button>
            </div>
          </div>
        </div>

        <VendorDrawer
          open={burgerOpen}
          onClose={() => setBurgerOpen(false)}
          displayName={adminDisplayName}
          eyebrow="Dashboard admin"
          dashboardLink={ADMIN_DASHBOARD_LINK}
          sections={ADMIN_NAV_SECTIONS}
          openSections={adminOpenSections}
          onToggleSection={toggleAdminSection}
          isItemActive={isVendorItemActive}
          theme={theme}
          onToggleTheme={toggleTheme}
          onLogout={handleLogout}
        />
      </header>
    );
  }

  /* ================= NAVBAR NORMAL (user / vendor / guest) ================= */
  return (
    <header className={styles.header}>
      <div className={styles.container}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <button
            type="button"
            className={`${styles.burger} ${
              isVendor || isUser || isInfluencer || isGuest
                ? styles.burgerVendor
                : ""
            }`}
            onClick={() => setBurgerOpen((v) => !v)}
            aria-label={
              isVendor
                ? "Meniu vendor"
                : isInfluencer
                ? "Meniu influencer"
                : isUser
                ? "Meniu cont"
                : "Meniu"
            }
            aria-expanded={burgerOpen ? "true" : "false"}
          >
            <Menu size={22} />
          </button>

          <Link to="/" aria-label="ArtFest – Acasă" title="Pagina principală">
            <img src={logo} alt="Artfest" className={styles.logo} />
          </Link>
        </div>

        <nav
          className={`${styles.nav} ${burgerOpen ? styles["nav--open"] : ""}`}
          aria-label="Meniu principal"
          onClick={(e) => {
            if (e.target.closest("a")) setBurgerOpen(false);
          }}
        >
          {isVendor ? (
            <>
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

              <NavLink className={styles.navLink} to="/vendor/catalog?tab=products">
                Catalog produse
              </NavLink>
              <NavLink className={styles.navLink} to="/vendor/orders">
                Comenzi
              </NavLink>
              <NavLink className={styles.navLink} to="/vendor/visitors">
                Vizitatori
              </NavLink>
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

              {menuCollections.length > 0 && (
                <div className={styles.dropdown} tabIndex={0}>
                  <button
                    type="button"
                    className={styles.navLink}
                    aria-haspopup="menu"
                  >
                    Colecții
                    <ChevronDown className={styles.dropdownIcon} size={14} />
                  </button>

                  <div className={styles.dropdownContent} role="menu">
                    {menuCollections.map((collection) => (
                      <NavLink
                        key={collection.slug}
                        to={collection.to}
                        role="menuitem"
                      >
                        {collection.title}
                      </NavLink>
                    ))}
                    <NavLink to="/colectii" role="menuitem">
                      Toate colecțiile
                    </NavLink>
                  </div>
                </div>
              )}
            </>
          )}

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
                ref={imageInputRef}
                type="file"
                accept="image/*"
                className={styles.hiddenFile}
                onChange={handleFileChange}
              />

              <button
                className={styles.cameraBtn}
                type="button"
                onClick={openImagePicker}
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

        {burgerOpen && !isVendor && !isUser && !isInfluencer && !isGuest && (
          <button
            type="button"
            className={styles.navBackdrop}
            aria-label="Închide meniul"
            onClick={() => setBurgerOpen(false)}
          />
        )}

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

          {me && !isVendor && !isInfluencer && (
  <NavLink
    className={styles.iconWrapper}
    to="/desktop-user"
    title="Desktop"
    aria-label="Desktop"
  >
    <LayoutGrid size={22} />
  </NavLink>
)}

{isInfluencer && (
  <NavLink
    className={styles.iconWrapper}
    to="/influencer"
    title="Dashboard influencer"
    aria-label="Dashboard influencer"
  >
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
            <button
              ref={notifBtnDesktopRef}
              type="button"
              className={styles.iconWrapper}
              title="Notificări"
              aria-label="Notificări"
              aria-haspopup="dialog"
              aria-expanded={notifOpen ? "true" : "false"}
              onClick={() => setNotifOpen((v) => !v)}
            >
              <Bell size={22} />
              {unreadNotif > 0 && (
                <span className={styles.badge}>{Math.min(unreadNotif, 99)}</span>
              )}
            </button>
          )}

          {me && (
            <button
              ref={msgBtnDesktopRef}
              type="button"
              className={styles.iconWrapper}
              title="Mesaje"
              aria-label="Mesaje"
              aria-haspopup="dialog"
              aria-expanded={msgOpen ? "true" : "false"}
              onClick={() => setMsgOpen((v) => !v)}
            >
              <MessageSquare size={22} />
              {unreadMsgs > 0 && <span className={styles.badge}>{Math.min(unreadMsgs, 99)}</span>}
            </button>
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
                  {isVendor ? (
  <>
    <li>
      <NavLink to="/setari">
        Setări
      </NavLink>
    </li>
  </>
) : isInfluencer ? (
  <>
    <li>
      <NavLink to="/influencer">
        Dashboard influencer
      </NavLink>
    </li>
  </>
) : (
  <>
    <li>
      <NavLink to="/comenzile-mele">
        Comenzile mele
      </NavLink>
    </li>

    <li>
      <NavLink to="/cont/setari">
        Setări
      </NavLink>
    </li>
  </>
)}

                  <li style={{ borderTop: "1px solid var(--color-border)", marginTop: 6, paddingTop: 6 }}>
                    <button
                      type="button"
                      className={styles.accountBtn}
                      onClick={(e) => {
                        e.preventDefault();
                        handleLogout();
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

      <div className={styles.mobileSearch}>
        <div className={styles.mobileSearchRow}>
          <div className={styles.mobileSearchLeft}>
            {isVendor && (
              <button
                type="button"
                className={styles.iconWrapper}
                onClick={() => setBurgerOpen(true)}
                title="Meniu vendor"
                aria-label="Meniu vendor"
                aria-expanded={burgerOpen ? "true" : "false"}
              >
                <Menu size={22} />
              </button>
            )}

            {isVendor && (
              <NavLink
                className={styles.iconWrapper}
                to="/vendor/orders"
                title="Comenzile mele"
                aria-label="Comenzile mele"
              >
                <Package size={22} />
              </NavLink>
            )}

            {isUser && (
              <button
                type="button"
                className={styles.iconWrapper}
                onClick={() => setBurgerOpen(true)}
                title="Meniu cont"
                aria-label="Meniu cont"
                aria-expanded={burgerOpen ? "true" : "false"}
              >
                <Menu size={22} />
              </button>
            )}

            {isInfluencer && (
              <button
                type="button"
                className={styles.iconWrapper}
                onClick={() => setBurgerOpen(true)}
                title="Meniu influencer"
                aria-label="Meniu influencer"
                aria-expanded={burgerOpen ? "true" : "false"}
              >
                <Menu size={22} />
              </button>
            )}

            {isGuest && (
              <button
                type="button"
                className={styles.iconWrapper}
                onClick={() => setBurgerOpen(true)}
                title="Meniu"
                aria-label="Meniu"
                aria-expanded={burgerOpen ? "true" : "false"}
              >
                <Menu size={22} />
              </button>
            )}

            {me && (
              <button
                ref={msgBtnMobileRef}
                type="button"
                className={styles.iconWrapper}
                title="Mesaje"
                aria-label="Mesaje"
                aria-haspopup="dialog"
                aria-expanded={msgOpen ? "true" : "false"}
                onClick={() => setMsgOpen((v) => !v)}
              >
                <MessageSquare size={22} />
                {unreadMsgs > 0 && (
                  <span className={styles.badgeMini}>{Math.min(unreadMsgs, 99)}</span>
                )}
              </button>
            )}

            {me && (
              <button
                ref={notifBtnMobileRef}
                type="button"
                className={styles.iconWrapper}
                title="Notificări"
                aria-label="Notificări"
                aria-haspopup="dialog"
                aria-expanded={notifOpen ? "true" : "false"}
                onClick={() => setNotifOpen((v) => !v)}
              >
                <Bell size={22} />
                {unreadNotif > 0 && (
                  <span className={styles.badgeMini}>{Math.min(unreadNotif, 99)}</span>
                )}
              </button>
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
              ref={imageInputRef}
              type="file"
              accept="image/*"
              className={styles.hiddenFile}
              onChange={handleFileChange}
            />

            <button
              className={styles.cameraBtn}
              type="button"
              onClick={openImagePicker}
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

      {isVendor && (
        <VendorDrawer
          open={burgerOpen}
          onClose={() => setBurgerOpen(false)}
          displayName={vendorDisplayName}
          sections={vendorSections}
          openSections={vendorOpenSections}
          onToggleSection={toggleVendorSection}
          isItemActive={isVendorItemActive}
          nextStepCTA={nextStepCTA}
          theme={theme}
          onToggleTheme={toggleTheme}
          onLogout={handleLogout}
        />
      )}

      {isUser && (
        <VendorDrawer
          open={burgerOpen}
          onClose={() => setBurgerOpen(false)}
          displayName={userDisplayName}
          dashboardLink={USER_DASHBOARD_LINK}
          sections={USER_NAV_SECTIONS}
          openSections={userOpenSections}
          onToggleSection={toggleUserSection}
          isItemActive={isVendorItemActive}
          theme={theme}
          onToggleTheme={toggleTheme}
          onLogout={handleLogout}
        />
      )}

      {isInfluencer && (
        <VendorDrawer
          open={burgerOpen}
          onClose={() => setBurgerOpen(false)}
          displayName={influencerDisplayName}
          dashboardLink={INFLUENCER_DASHBOARD_LINK}
          sections={INFLUENCER_NAV_SECTIONS}
          openSections={influencerOpenSections}
          onToggleSection={toggleInfluencerSection}
          isItemActive={isVendorItemActive}
          theme={theme}
          onToggleTheme={toggleTheme}
          onLogout={handleLogout}
        />
      )}

      {isGuest && (
        <VendorDrawer
          open={burgerOpen}
          onClose={() => setBurgerOpen(false)}
          eyebrow="Meniu"
          dashboardLink={null}
          sections={guestSections}
          openSections={guestOpenSections}
          onToggleSection={toggleGuestSection}
          isItemActive={isVendorItemActive}
          theme={theme}
          onToggleTheme={toggleTheme}
        />
      )}

      <NotificationsPopover
        open={notifOpen}
        onClose={() => setNotifOpen(false)}
        me={me}
        anchorRef={notifBtnDesktopRef.current ? notifBtnDesktopRef : notifBtnMobileRef}
        navigate={navigate}
        fullPageHref="/notificari"
        limit={8}
      />

      <MessagesPopover
        open={msgOpen}
        onClose={() => setMsgOpen(false)}
        me={me}
        anchorRef={msgBtnDesktopRef.current ? msgBtnDesktopRef : msgBtnMobileRef}
        navigate={navigate}
        fullPageHref={isVendor ? "/mesaje" : "/cont/mesaje"}
        limit={8}
      />
    </header>
  );
}