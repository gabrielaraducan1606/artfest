import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../../../lib/api";
import { useAuth } from "../../../pages/Auth/Context/context.js";
import styles from "./Desktop.module.css";

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
  CreditCard,
  FileText,
  CheckCircle2,
  ShoppingCart,
  Receipt,
  ScrollText,
  Paperclip,
  ArrowLeft,
  Sun,
  Moon,
} from "lucide-react";

/* ===================== UI cache (instant render) ===================== */
const DASH_CACHE_KEY = "vendor:dashboard-cache:v1";

function readDashCache() {
  try {
    const raw = localStorage.getItem(DASH_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeDashCache(data) {
  try {
    localStorage.setItem(DASH_CACHE_KEY, JSON.stringify(data));
  } catch {
    /* noop */
  }
}

/* range helpers */
function toISODate(d) {
  return d.toISOString().slice(0, 10);
}
function lastNDaysRange(n) {
  const to = new Date();
  const from = new Date();
  from.setDate(to.getDate() - (n - 1));
  return { from: toISODate(from), to: toISODate(to) };
}

function humanizeAddStoreError(e) {
  const data = e?.data || e?.response?.data || {};

  const code = data?.error || e?.error || e?.code || "";
  const title = data?.title || "";
  const message = data?.message || "";
  const hint = data?.hint || "";

  if (code === "store_limit_reached") {
    return [title, message, hint].filter(Boolean).join("\n\n");
  }

  return message || e?.message || "Nu am putut crea un magazin nou.";
}

/* ============================ Subscriptions hook ============================ */
/**
 * Așteaptă ca backend-ul să întoarcă:
 *  - ok: boolean
 *  - kind: "trial" | "paid" (opțional)
 *  - plan: {code,name} (opțional)
 *  - endAt: ISO date (opțional)
 *  - trialEndsAt: ISO date (opțional)
 *  - status: string (opțional)
 */
function useSubscriptionStatus({ auto = true } = {}) {
  const [state, setState] = useState({
    ok: null,
    kind: null,
    plan: null,
    endAt: null,
    trialEndsAt: null,
    status: null,
    loading: true,
    error: "",
  });

  const timerRef = useRef(null);

  const fetchOnce = useCallback(async () => {
    try {
      setState((s) => ({ ...s, loading: true, error: "" }));
      const d = await api("/api/vendors/me/subscription/status", { method: "GET" });

      if (d?.ok) {
        setState({
          ok: true,
          kind: d.kind || null,
          plan: d.plan || null,
          endAt: d.endAt || null,
          trialEndsAt: d.trialEndsAt || null,
          status: d.status || null,
          loading: false,
          error: "",
        });
      } else {
        setState({
          ok: false,
          kind: null,
          plan: null,
          endAt: null,
          trialEndsAt: null,
          status: null,
          loading: false,
          error: "",
        });
      }
    } catch (e) {
      setState({
        ok: false,
        kind: null,
        plan: null,
        endAt: null,
        trialEndsAt: null,
        status: null,
        loading: false,
        error: e?.message || "Nu am putut citi abonamentul.",
      });
    }
  }, []);

  const startShortPolling = useCallback(() => {
    const startedAt = Date.now();
    const tick = async () => {
      await fetchOnce();
      if (Date.now() - startedAt < 120_000) {
        timerRef.current = setTimeout(tick, 10_000);
      }
    };
    tick();
  }, [fetchOnce]);

  useEffect(() => {
    if (!auto) return;
    fetchOnce();

    const onFocus = () => fetchOnce();
    const onVisible = () => {
      if (document.visibilityState === "visible") fetchOnce();
    };

    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [auto, fetchOnce]);

  useEffect(() => () => timerRef.current && clearTimeout(timerRef.current), []);

  return { ...state, refetch: fetchOnce, startShortPolling };
}

/* ------- mici utilitare pentru identitate ------- */
function displayName(me) {
  if (!me) return "Utilizator";
  if (me.name) return me.name;
  const full = `${me.firstName || ""} ${me.lastName || ""}`.trim();
  return full || me.email || "Utilizator";
}
function getInitials(me) {
  const s = displayName(me).split(" ").filter(Boolean);
  return ((s[0]?.[0] || "U") + (s[1]?.[0] || "").toUpperCase()).toUpperCase();
}

/* date helpers */
function formatDT(v) {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("ro-RO");
}
function daysLeftFromISO(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const diff = d.getTime() - Date.now();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

function isTrialSub(sub) {
  if (!sub?.ok) return false;
  if (sub.kind === "trial") return true;
  const left = daysLeftFromISO(sub.trialEndsAt);
  return typeof left === "number" && left > 0;
}

/* =============================== Componenta =============================== */
export default function DesktopV3() {
  const { me, loading: authLoading } = useAuth();
  const navigate = useNavigate();

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

  const cached = useMemo(() => readDashCache(), []);

  const [services, setServices] = useState(() => cached?.services ?? []);
  const [onboarding, setOnboarding] = useState(() => cached?.onboarding ?? null);

  const [stats, setStats] = useState(() => cached?.stats ?? { visitors: 0, followers: 0 });
  const [reviewCounts] = useState(() => cached?.reviewCounts ?? { product: 0, store: 0 });

  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState({});
  const [error, setError] = useState("");
  const [vendor, setVendor] = useState(() => cached?.vendor ?? null);

  const sub = useSubscriptionStatus();

  const [unreadNotif, setUnreadNotif] = useState(() => cached?.counts?.unreadNotif ?? 0);
  const [unreadMsgs, setUnreadMsgs] = useState(() => cached?.counts?.unreadMsgs ?? 0);
  const [cartCount, setCartCount] = useState(() => cached?.counts?.cartCount ?? 0);
  const [favCount, setFavCount] = useState(() => cached?.counts?.favCount ?? 0);
  const [supportUnread, setSupportUnread] = useState(() => cached?.counts?.supportUnread ?? 0);

  const cacheTimerRef = useRef(null);
  useEffect(() => {
    if (cacheTimerRef.current) clearTimeout(cacheTimerRef.current);

    cacheTimerRef.current = setTimeout(() => {
      writeDashCache({
        services,
        onboarding,
        stats,
        reviewCounts,
        vendor,
        counts: { unreadNotif, unreadMsgs, cartCount, favCount, supportUnread },
        ts: Date.now(),
      });
    }, 800);

    return () => cacheTimerRef.current && clearTimeout(cacheTimerRef.current);
  }, [
    services,
    onboarding,
    stats,
    reviewCounts,
    vendor,
    unreadNotif,
    unreadMsgs,
    cartCount,
    favCount,
    supportUnread,
  ]);

  useEffect(() => {
    if (me?.vendor) setVendor(me.vendor);
  }, [me]);

  const loadAllVendor = useCallback(() => {
    setError("");
    setLoading(true);

    const fetchLite = async () => {
      try {
        const lite = await api("/api/vendors/me/services").catch(() => ({ items: [] }));
        setServices(lite?.items || []);
      } catch {
        /* ignore */
      }
    };

    const fetchFull = async () => {
      try {
        const [svc, ob] = await Promise.all([
          api("/api/vendors/me/services?includeProfile=1").catch(() => ({ items: [] })),
          api("/api/vendors/me/onboarding-status").catch(() => null),
        ]);
        setServices(svc?.items || []);
        setOnboarding(ob || null);
      } catch {
        /* ignore */
      } finally {
        setLoading(false);
      }
    };

    const fetchNonCritical = async () => {
      api("/api/vendors/me")
        .then((v) => v?.vendor && setVendor(v.vendor))
        .catch(() => {});

      const { from, to } = lastNDaysRange(7);
      api(`/api/vendors/me/visitors/kpi?from=${from}&to=${to}`)
        .then((r) => {
          const d = r?.data;
          if (!d) return;
          setStats((prev) => ({ ...prev, visitors: d.visitors ?? 0 }));
        })
        .catch(() => {});
    };

    requestAnimationFrame(fetchLite);

    if ("requestIdleCallback" in window) {
      window.requestIdleCallback(fetchFull, { timeout: 1500 });
    } else {
      setTimeout(fetchFull, 800);
    }

    setTimeout(fetchNonCritical, 1200);
  }, []);

  useEffect(() => {
    if (!me) return;

    let alive = true;
    let intervalId = null;

    const fetchCounts = async () => {
      try {
        const [notif, msgs, cart, fav, sup] = await Promise.all([
          api("/api/notifications/unread-count").catch(() => ({ count: 0 })),
          me.role === "VENDOR"
            ? api("/api/inbox/unread-count").catch(() => ({ count: 0 }))
            : Promise.resolve({ count: 0 }),
          api("/api/cart/count").catch(() => ({ count: 0 })),
          api("/api/favorites/count").catch(() => ({ count: 0 })),
          me.role === "VENDOR"
            ? api("/api/vendor/support/unread-count").catch(() => ({ count: 0 }))
            : Promise.resolve({ count: 0 }),
        ]);

        if (!alive) return;

        setUnreadNotif(notif?.count || 0);
        setUnreadMsgs(msgs?.count || 0);
        setCartCount(cart?.count || 0);
        setFavCount(fav?.count || 0);
        setSupportUnread(sup?.count || 0);
      } catch {
        /* ignore */
      }
    };

    const startInterval = () => {
      if (intervalId) clearInterval(intervalId);
      const ms = document.visibilityState === "visible" ? 15_000 : 60_000;
      intervalId = setInterval(fetchCounts, ms);
    };

    const warmup = setTimeout(() => {
      fetchCounts();
      startInterval();
    }, 900);

    const onFocus = () => fetchCounts();
    const onVisible = () => {
      if (document.visibilityState === "visible") fetchCounts();
      startInterval();
    };

    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      alive = false;
      clearTimeout(warmup);
      if (intervalId) clearInterval(intervalId);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [me]);

  useEffect(() => {
    if (authLoading) return;

    if (!me) {
      setLoading(false);
      return;
    }

    if (me.role === "VENDOR") {
      loadAllVendor();
    } else {
      setLoading(false);
    }
  }, [authLoading, me, loadAllVendor]);

  const completeness = useMemo(() => {
    if (!services.length) return 0;
    const filled = services.filter((s) => s?.profile && (s.profile.displayName || s.title)).length;
    return Math.round((filled / services.length) * 100);
  }, [services]);

  const nextStep = useMemo(() => {
    if (!onboarding?.exists) return { label: "Creează profil vendor", href: "/onboarding" };
    const map = {
      selectServices: { label: "Alege/Adaugă servicii", href: "/onboarding" },
      fillDetails: { label: "Completează detalii servicii", href: "/onboarding/details" },
      profile: { label: "Publică profilul", href: "/onboarding/details" },
      done: { label: "Gata ✨", href: "/vendor/visitors" },
    };
    return map[onboarding?.nextStep] || { label: "Continuă", href: "/onboarding" };
  }, [onboarding]);

  const onDeactivate = useCallback(async (serviceId) => {
    try {
      setBusy((prev) => ({ ...prev, [serviceId]: "deactivate" }));
      await api(`/api/vendors/me/services/${serviceId}/deactivate`, { method: "POST" });

      const d = await api("/api/vendors/me/services?includeProfile=1");
      setServices(d.items || []);
    } catch (e) {
      alert(e?.message || "Nu am putut dezactiva serviciul.");
    } finally {
      setBusy((prev) => {
        const n = { ...prev };
        delete n[serviceId];
        return n;
      });
    }
  }, []);

  const onDelete = useCallback(async (serviceId, isActive, status) => {
    try {
      if (isActive && status === "ACTIVE") {
        alert("Serviciul este activ. Dezactivează-l înainte de a-l șterge.");
        return;
      }
      if (
        !confirm("Ești sigur că vrei să ștergi definitiv acest serviciu? Acțiunea nu poate fi anulată.")
      ) {
        return;
      }

      setBusy((prev) => ({ ...prev, [serviceId]: "delete" }));
      await api(`/api/vendors/me/services/${serviceId}`, { method: "DELETE" });

      const d = await api("/api/vendors/me/services?includeProfile=1");
      setServices(d.items || []);
    } catch (e) {
      alert(e?.message || "Nu am putut șterge serviciul.");
    } finally {
      setBusy((prev) => {
        const n = { ...prev };
        delete n[serviceId];
        return n;
      });
    }
  }, []);

  const onAddStore = useCallback(async () => {
    try {
      setError("");
      setLoading(true);

      const r = await api("/api/vendors/me/services/products/new", {
        method: "POST",
      });

      const newId = r?.item?.id || null;

      const d = await api("/api/vendors/me/services?includeProfile=1");
      setServices(d.items || []);

      if (newId) {
        navigate(`/onboarding/details?serviceId=${encodeURIComponent(newId)}`);
      } else {
        navigate("/onboarding/details");
      }
    } catch (e) {
      const data = e?.data || e?.response?.data || {};
      const code = data?.error || e?.error || e?.code || "";
      const ctaUrl = data?.cta?.url || "";

      const msg = humanizeAddStoreError(e);
      alert(msg);

      if (code === "store_limit_reached" && ctaUrl) {
        navigate(ctaUrl);
      }
    } finally {
      setLoading(false);
    }
  }, [navigate]);

  const onPreview = useCallback(
    (service) => {
      const slug = service?.profile?.slug;
      if (slug) {
        window.open(`/magazin/${slug}`, "_blank", "noopener,noreferrer");
      } else {
        navigate(`/onboarding/details?serviceId=${encodeURIComponent(service.id)}`);
      }
    },
    [navigate]
  );

  const isVendor = me?.role === "VENDOR";
  const isAdmin = me?.role === "ADMIN";
  const roleLabel = isVendor ? "Vânzător" : isAdmin ? "Administrator" : "Utilizator";

  const quick = useMemo(
    () => [
      { to: "/notificari", label: "Notificări", icon: <Bell size={20} />, badge: unreadNotif },
      { to: "/mesaje", label: "Mesaje", icon: <MessageSquare size={20} />, badge: unreadMsgs },
      { to: "/wishlist", label: "Dorințe", icon: <Heart size={20} />, badge: favCount },
      { to: "/cos", label: "Coș", icon: <ShoppingCart size={20} />, badge: cartCount },
      { to: "/vendor/support", label: "Asistență", icon: <LifeBuoy size={20} />, badge: supportUnread },
      { to: "/vendor/store", label: "Magazinul meu", icon: <Store size={20} /> },
      { to: "/setari", label: "Setări", icon: <Settings size={20} /> },
      { to: "/vendor/invoices", label: "Facturi", icon: <FileText size={20} /> },
      { to: "/vendor/orders", label: "Comenzi", icon: <Package size={20} /> },
    ],
    [unreadNotif, unreadMsgs, favCount, cartCount, supportUnread]
  );

  if (authLoading) {
    return (
      <section className={styles.page}>
        <HeaderSkeleton />
        <ServicesSkeleton />
      </section>
    );
  }

  if (!me || me.role !== "VENDOR") {
    return <div className={styles.page}>Acces doar pentru vendori.</div>;
  }

  return (
    <section className={styles.page}>
      <Topbar
        me={me}
        completeness={completeness}
        sub={sub}
        nextStep={nextStep}
        theme={theme}
        setTheme={setTheme}
      />

      {error ? <div className={styles.errorBar}>{error}</div> : null}

      <IdentityCard me={me} roleLabel={roleLabel} />
      <QuickCard quick={quick} />

      <TrialBanner sub={sub} />
      <SubscriptionAlert sub={sub} />

      <div className={styles.kpiRow}>
        <KPI label="Vizitatori (7d)" value={stats.visitors ?? 0} />
        <KPI label="Recenzii produs" value={reviewCounts.product ?? 0} />
        <KPI label="Recenzii magazin" value={reviewCounts.store ?? 0} />
        <KPI label="Urmăritori" value={stats.followers ?? 0} />
      </div>

      <div className={styles.grid}>
        <div className={styles.colMain}>
          <OnboardingCard nextStep={nextStep} />

          <ServicesCard
            services={services}
            busy={busy}
            onDeactivate={onDeactivate}
            onDelete={onDelete}
            onPreview={onPreview}
            onAddStore={onAddStore}
            loading={loading}
          />
        </div>

        <Sidebar sub={sub} />
      </div>

      <SettingsAndSecurityCard />

      {isVendor && <VendorLinksCard unreadMsgs={unreadMsgs} supportUnread={supportUnread} />}

      {isAdmin && <AdminCard />}

      <LogoutCard onLogout={() => navigate("/autentificare", { replace: true })} />
    </section>
  );
}

/* ============================= Sub-componente ============================= */

function Topbar({ me, completeness, sub, nextStep, theme, setTheme }) {
  const subBadge = (() => {
    if (sub.loading) return <span className={styles.badgeWait} aria-label="loading" />;

    if (sub.ok) {
      const trial = isTrialSub(sub);
      const until = trial ? sub.trialEndsAt : sub.endAt;
      const daysLeft = daysLeftFromISO(until);

      return (
        <span className={styles.badgeOk}>
          {trial ? (
            <>
              Trial activ
              {until ? ` • până la ${formatDT(until)}` : ""}
              {typeof daysLeft === "number" ? ` • ${daysLeft} zile rămase` : ""}
            </>
          ) : (
            <>
              Plan: {sub.plan?.name || sub.plan?.code || "activ"}
              {until ? ` • până la ${formatDT(until)}` : ""}
              {typeof daysLeft === "number" ? ` • ${daysLeft} zile rămase` : ""}
            </>
          )}
        </span>
      );
    }

    return (
      <Link
        className={styles.badgeWarn}
        to="/onboarding/details?tab=plata&solo=1"
        title="Activează abonamentul"
      >
        Fără abonament activ — Activează abonament
      </Link>
    );
  })();

  return (
    <div className={styles.topbar}>
      <div className={styles.topbarActions}>
        <button
          type="button"
          className={styles.iconBtn}
          aria-label="Înapoi"
          title="Înapoi"
          onClick={() => history.back()}
        >
          <ArrowLeft size={18} />
        </button>

        <button
          type="button"
          className={styles.iconBtn}
          aria-label="Comută tema"
          title="Comută tema"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
        >
          {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
        </button>
      </div>

      <div>
        <h1 className={styles.h1}>Bun venit, {me.name || me.email}!</h1>
        <div className={styles.meta}>
          <span className={styles.badge}>VENDOR</span>
          <span className={styles.dot} />
          <span className={styles.metaBlock}>
            Completență profil:<b> {completeness}%</b>
          </span>
          <span className={styles.dot} />
          {subBadge}
        </div>

        <div className={styles.profileCompletion}>
          <div className={styles.progressBar}>
            <div className={styles.progressFill} style={{ width: `${completeness}%` }} />
          </div>
          <span className={styles.progressLabel}>
            Următorul pas: <b>{nextStep.label}</b>
          </span>
        </div>
      </div>

      <Link className={`${styles.btn} ${styles.btnPrimary}`} to={nextStep.href}>
        {nextStep.label}
      </Link>
    </div>
  );
}

function TrialBanner({ sub }) {
  if (sub.loading) return null;
  const trial = isTrialSub(sub);
  if (!trial) return null;

  const until = sub.trialEndsAt;
  const daysLeft = daysLeftFromISO(until);

  return (
    <div className={`${styles.card} ${styles.cardOk}`}>
      <div className={styles.cardHead}>
        <h3>Perioadă de încercare (Trial)</h3>
      </div>
      <p className={styles.subtle}>
        Ai trial activ
        {until ? (
          <>
            {" "}
            până la <b>{formatDT(until)}</b>
          </>
        ) : null}
        {typeof daysLeft === "number" ? (
          <>
            {" "}
            • <b>{daysLeft} zile</b> rămase
          </>
        ) : null}
        .
      </p>
      <div className={styles.actionsRow}>
        <Link className={`${styles.btn} ${styles.btnGhost}`} to="/onboarding/details?tab=plata&solo=1">
          Vezi abonamentul
        </Link>
        <button className={`${styles.btn} ${styles.btnGhost}`} onClick={sub.refetch} type="button">
          Reîncarcă status
        </button>
      </div>
    </div>
  );
}

function IdentityCard({ me, roleLabel }) {
  const initials = getInitials(me);

  return (
    <div className={styles.card}>
      <div className={styles.cardHead}>
        <h3>Contul meu</h3>
      </div>

      <div className={styles.identityRow}>
        <div className={styles.avatarCircle}>{initials}</div>

        <div>
          <div className={styles.identityNameRow}>
            {displayName(me)}
            {me?.verified && (
              <span className={styles.verifiedPill}>
                <CheckCircle2 size={14} className={styles.verifiedIcon} /> Verificat
              </span>
            )}
          </div>

          <div className={styles.subtle}>{roleLabel}</div>
        </div>
      </div>
    </div>
  );
}

function QuickCard({ quick }) {
  if (!quick.length) return null;

  return (
    <div className={styles.card}>
      <div className={styles.cardHead}>
        <h3>Scurtături</h3>
      </div>

      <div className={styles.actionsRow} style={{ flexWrap: "wrap" }}>
        {quick.map((q) => (
          <Link
            key={q.to}
            to={q.to}
            className={`${styles.btn} ${styles.btnGhost} ${styles.btnWithBadge}`}
            style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}
          >
            <span className={styles.iconWrap}>
              {q.icon}
              <Badge count={q.badge} />
            </span>
            <span>{q.label}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}

function SubscriptionAlert({ sub }) {
  if (sub.loading || sub.ok) return null;
  return (
    <div className={`${styles.card} ${styles.cardWarning}`}>
      <div className={styles.cardHead}>
        <h3>Abonament necesar</h3>
      </div>
      <p className={styles.subtle}>
        Pentru a activa servicii și a apărea în căutări, ai nevoie de un abonament activ.
      </p>
      <div className={styles.actionsRow}>
        <Link className={`${styles.btn} ${styles.btnPrimary}`} to="/onboarding/details?tab=plata&solo=1">
          Activează abonament
        </Link>
        <button className={`${styles.btn} ${styles.btnGhost}`} onClick={sub.refetch} type="button">
          Reîncarcă status
        </button>
      </div>
    </div>
  );
}

function OnboardingCard({ nextStep }) {
  return (
    <div className={styles.card}>
      <div className={styles.cardHead}>
        <h3>Onboarding</h3>
        <span className={styles.subtle}>
          Următorul pas: <b>{nextStep.label}</b>
        </span>
      </div>
      <div className={styles.actionsRow}>
        <Link className={`${styles.btn} ${styles.btnPrimary}`} to="/onboarding">
          Alege/Adaugă servicii
        </Link>
        <Link className={`${styles.btn} ${styles.btnGhost}`} to="/onboarding/details">
          Completează detalii
        </Link>
      </div>
    </div>
  );
}

function ServicesCard({
  services,
  busy,
  onDeactivate,
  onDelete,
  onPreview,
  onAddStore,
  loading,
}) {
  const activeCount = services.filter((s) => s.isActive && s.status === "ACTIVE").length;

  return (
    <div className={styles.card}>
      <div className={styles.cardHead}>
        <div>
          <h3>Serviciile mele</h3>
          <div className={styles.subtle}>
            Active: <b>{activeCount}</b> / Total: <b>{services.length}</b>
          </div>
        </div>

        <button
          type="button"
          className={`${styles.btn} ${styles.btnPrimary}`}
          onClick={onAddStore}
          disabled={loading}
          title="Adaugă magazin nou"
        >
          + Adaugă magazin
        </button>
      </div>

      {services.length === 0 && loading ? (
        <ServicesSkeleton />
      ) : services.length === 0 ? (
        <EmptyState
          title="Nu ai servicii încă"
          subtitle="Începe prin a alege servicii și a completa detaliile profilului."
          ctaText="Pornește onboarding"
          to="/onboarding"
        />
      ) : (
        <ul className={styles.serviceList}>
          {services.map((s) => {
            const hasFull = !!(s.status || s.profile?.displayName || typeof s.isActive === "boolean");
            const isAct = !!(s.isActive && s.status === "ACTIVE");
            const isBusy = !!busy[s.id];

            return (
              <li key={s.id} className={styles.serviceItem}>
                <div className={styles.serviceMain}>
                  <div className={styles.serviceTitle}>
                    {s.profile?.displayName || s.title || s.type?.name || s.typeName || "Serviciu"}
                  </div>

                  <div className={styles.serviceMeta}>
                    {hasFull ? (
                      <>
                        <span>
                          Tip: <b>{s.type?.name || s.typeName}</b>
                        </span>

                        {" · "}
                        <span>
                          Status: <b>{s.status}</b>
                          {isAct ? " (activ)" : ""}
                        </span>

                        {s.profile?.displayName ? (
                          <>
                            {" · "}Brand: <b>{s.profile.displayName}</b>
                          </>
                        ) : null}

                        {s.city ? (
                          <>
                            {" · "}Oraș: <b>{s.city}</b>
                          </>
                        ) : null}
                      </>
                    ) : (
                      <div className={styles.metaSkeletonRow}>
                        <span className={styles.skelLine} />
                        <span className={styles.skelLine} />
                        <span className={styles.skelLine} />
                      </div>
                    )}
                  </div>
                </div>

                <div className={styles.actionsRow}>
                  {hasFull ? (
                    <>
                      <Link
                        className={`${styles.btn} ${styles.btnGhost}`}
                        to={`/onboarding/details?serviceId=${encodeURIComponent(s.id)}`}
                      >
                        Editează
                      </Link>

                      <button
                        className={`${styles.btn} ${styles.btnGhost}`}
                        onClick={() => onPreview(s)}
                        disabled={isBusy}
                        type="button"
                        title="Previzualizează"
                      >
                        Previzualizează
                      </button>

                      {isAct && (
                        <button
                          className={`${styles.btn} ${styles.btnWarn}`}
                          onClick={() => onDeactivate(s.id)}
                          disabled={isBusy}
                          type="button"
                          title="Dezactivează"
                        >
                          {busy[s.id] === "deactivate" ? "Se dezactivează…" : "Dezactivează"}
                        </button>
                      )}

                      <button
                        className={`${styles.btn} ${styles.btnDanger}`}
                        onClick={() => onDelete(s.id, isAct, s.status)}
                        disabled={isBusy}
                        type="button"
                        title="Șterge definitiv"
                      >
                        {busy[s.id] === "delete" ? "Se șterge…" : "Șterge"}
                      </button>
                    </>
                  ) : (
                    <>
                      <span className={styles.skelBtn} />
                      <span className={styles.skelBtn} />
                      <span className={styles.skelBtn} />
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function Sidebar({ sub }) {
  const trial = isTrialSub(sub);
  const until = trial ? sub?.trialEndsAt : sub?.endAt;
  const daysLeft = daysLeftFromISO(until);

  return (
    <aside className={styles.colSide}>
      <div className={styles.card}>
        <div className={styles.cardHead}>
          <h3>Abonament</h3>
        </div>

        {sub.loading ? (
          <div className={styles.metaSkeletonRow} aria-label="loading">
            <span className={styles.skelLine} />
            <span className={styles.skelLine} />
            <span className={styles.skelLine} />
          </div>
        ) : sub.ok ? (
          <>
            <p className={styles.subtle}>
              {trial ? (
                <>
                  <b>Trial activ</b>
                  <br />
                  {until ? (
                    <>
                      Valabil până la: <b>{formatDT(until)}</b>
                      {typeof daysLeft === "number" ? ` • ${daysLeft} zile rămase` : ""}
                    </>
                  ) : null}
                </>
              ) : (
                <>
                  Plan: <b>{sub.plan?.name || sub.plan?.code || "activ"}</b>
                  <br />
                  {until ? (
                    <>
                      Valabil până la: <b>{formatDT(until)}</b>
                      {typeof daysLeft === "number" ? ` • ${daysLeft} zile rămase` : ""}
                    </>
                  ) : null}
                </>
              )}
            </p>

            <Link className={`${styles.btn} ${styles.btnGhost}`} to="/onboarding/details?tab=plata&solo=1">
              Gestionează abonamentul
            </Link>
            <button className={`${styles.btn} ${styles.btnGhost}`} onClick={sub.refetch} type="button">
              Reîncarcă
            </button>
          </>
        ) : (
          <>
            <p className={styles.subtle}>Nu ai un abonament activ. Activează-l pentru a-ți publica serviciile.</p>
            <Link className={`${styles.btn} ${styles.btnPrimary}`} to="/onboarding/details?tab=plata&solo=1">
              Activează abonament
            </Link>
            <button className={`${styles.btn} ${styles.btnGhost}`} onClick={sub.refetch} type="button">
              Am plătit — verifică din nou
            </button>
          </>
        )}
      </div>
    </aside>
  );
}

function SettingsAndSecurityCard() {
  const base = import.meta.env.VITE_API_URL.replace(/\/+$/, "");
  return (
    <div className={styles.card}>
      <div className={styles.cardHead}>
        <h3>Setări & securitate</h3>
      </div>

      <div className={styles.actionsCol}>
        <Link className={`${styles.btn} ${styles.btnGhost}`} to="/setari">
          <Settings size={18} style={{ marginRight: 6 }} /> Setări cont
        </Link>

        <Link className={`${styles.btn} ${styles.btnGhost}`} to="/vendor/invoices">
          <Receipt size={18} style={{ marginRight: 6 }} /> Facturi / documente
        </Link>

        <Link className={`${styles.btn} ${styles.btnGhost}`} to="/setari?tab=billing">
          <CreditCard size={18} style={{ marginRight: 6 }} /> Date facturare
        </Link>

        <a className={`${styles.btn} ${styles.btnGhost}`} href={`${base}/termenii-si-conditiile`}>
          <ScrollText size={18} style={{ marginRight: 6 }} /> Termeni și condiții
        </a>

        <a className={`${styles.btn} ${styles.btnGhost}`} href={`${base}/confidentialitate`}>
          <ScrollText size={18} style={{ marginRight: 6 }} /> Politica de confidențialitate
        </a>

        <a className={`${styles.btn} ${styles.btnGhost}`} href={`${base}/politica-retur`}>
          <ScrollText size={18} style={{ marginRight: 6 }} /> Politica de retur
        </a>

        <a className={`${styles.btn} ${styles.btnGhost}`} href={`${base}/anexa-expediere`}>
          <Paperclip size={18} style={{ marginRight: 6 }} /> Anexa expediere
        </a>

        <a className={`${styles.btn} ${styles.btnGhost}`} href={`${base}/acord-vanzatori`}>
          <Paperclip size={18} style={{ marginRight: 6 }} /> Acord vânzători
        </a>

        <a className={`${styles.btn} ${styles.btnGhost}`} href={`${base}/anexa-produse`}>
          <Paperclip size={18} style={{ marginRight: 6 }} /> Anexa produse
        </a>
      </div>
    </div>
  );
}

function VendorLinksCard({ unreadMsgs, supportUnread }) {
  return (
    <div className={styles.card}>
      <div className={styles.cardHead}>
        <h3>Vânzător</h3>
      </div>
      <div className={styles.actionsCol}>
        <Link className={`${styles.btn} ${styles.btnGhost}`} to="/vendor/orders">
          <Package size={18} style={{ marginRight: 6 }} /> Comenzile mele
        </Link>
        <Link className={`${styles.btn} ${styles.btnGhost}`} to="/vendor/orders/planning">
          <LayoutDashboard size={18} style={{ marginRight: 6 }} /> Planificator comenzi
        </Link>
        <Link className={`${styles.btn} ${styles.btnGhost}`} to="/vendor/visitors">
          <Users size={18} style={{ marginRight: 6 }} /> Vizitatori
        </Link>

        <Link className={`${styles.btn} ${styles.btnGhost} ${styles.btnWithBadge}`} to="/mesaje">
          <span className={styles.iconWrap}>
            <MessageSquare size={18} style={{ marginRight: 6 }} />
            <Badge count={unreadMsgs} />
          </span>
          Mesaje
        </Link>

        <Link className={`${styles.btn} ${styles.btnGhost}`} to="/magazine">
          <Store size={18} style={{ marginRight: 6 }} /> Magazine / Produse
        </Link>

        <Link className={`${styles.btn} ${styles.btnGhost} ${styles.btnWithBadge}`} to="/vendor/support">
          <span className={styles.iconWrap}>
            <LifeBuoy size={18} style={{ marginRight: 6 }} />
            <Badge count={supportUnread} />
          </span>
          Asistență tehnică
        </Link>
      </div>
    </div>
  );
}

function AdminCard() {
  return (
    <div className={styles.card}>
      <div className={styles.cardHead}>
        <h3>Administrare</h3>
      </div>
      <div className={styles.actionsCol}>
        <Link className={`${styles.btn} ${styles.btnGhost}`} to="/admin">
          <ShieldCheck size={18} style={{ marginRight: 6 }} /> Panou Admin
        </Link>
      </div>
    </div>
  );
}

function LogoutCard({ onLogout }) {
  async function handleLogout(e) {
    e.preventDefault();
    try {
      await api("/api/auth/logout", { method: "POST" });
    } catch {
      /* ignore */
    }
    onLogout?.();
  }

  return (
    <div className={styles.card}>
      <button
        className={`${styles.btn} ${styles.btnDanger} ${styles.logoutBtn}`}
        type="button"
        onClick={handleLogout}
      >
        <LogOut size={18} />
        Deconectare
      </button>
    </div>
  );
}

function KPI({ label, value }) {
  return (
    <div className={styles.kpi}>
      <div className={styles.kpiVal}>{value}</div>
      <div className={styles.kpiLabel}>{label}</div>
    </div>
  );
}

function EmptyState({ title, subtitle, ctaText, to }) {
  return (
    <div className={styles.empty}>
      <div className={styles.emptyTitle}>{title}</div>
      <div className={styles.subtle}>{subtitle}</div>
      <Link className={`${styles.btn} ${styles.btnPrimary}`} to={to}>
        {ctaText}
      </Link>
    </div>
  );
}

function HeaderSkeleton() {
  return (
    <div className={styles.card}>
      <div className={styles.cardHead}>
        <div className={styles.skelTitle} />
      </div>
      <div className={styles.metaSkeletonRow}>
        <span className={styles.skelLine} />
        <span className={styles.skelLine} />
        <span className={styles.skelLine} />
      </div>
      <div className={styles.metaSkeletonRow} style={{ marginTop: 10 }}>
        <span className={styles.skelLine} />
        <span className={styles.skelLine} />
      </div>
    </div>
  );
}

function ServicesSkeleton() {
  return (
    <div className={styles.card}>
      <div className={styles.cardHead}>
        <h3>Serviciile mele</h3>
      </div>

      <ul className={styles.serviceList}>
        {Array.from({ length: 4 }).map((_, i) => (
          <li key={i} className={styles.serviceItem}>
            <div className={styles.serviceMain}>
              <div className={styles.skelTitle} />
              <div className={styles.metaSkeletonRow}>
                <span className={styles.skelLine} />
                <span className={styles.skelLine} />
                <span className={styles.skelLine} />
              </div>
            </div>
            <div className={styles.actionsRow}>
              <span className={styles.skelBtn} />
              <span className={styles.skelBtn} />
              <span className={styles.skelBtn} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Badge({ count }) {
  if (!count || count <= 0) return null;
  const v = Math.min(count, 99);
  return <span className={styles.badgeBubble}>{v}</span>;
}