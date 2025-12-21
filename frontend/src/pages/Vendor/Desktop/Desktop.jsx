// DesktopV3.jsx
import { useEffect, useMemo, useState, useCallback, useRef } from "react";
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
  ShieldHalf,
  CheckCircle2,
  ShoppingCart,
} from "lucide-react";

/* ---------- helpers mutate în afara componentei (fără deps) ---------- */
function extractMissing(e) {
  try {
    return (
      e?.missing ||
      e?.data?.missing ||
      e?.response?.data?.missing ||
      e?.body?.missing ||
      null
    );
  } catch {
    return null;
  }
}
function extractCode(e) {
  try {
    return (
      e?.error ||
      e?.code ||
      e?.data?.error ||
      e?.response?.data?.error ||
      null
    );
  } catch {
    return null;
  }
}
function humanizeActivateError(e) {
  const code = extractCode(e);
  const missing = extractMissing(e);

  if (code === "vendor_entity_not_confirmed") {
    return "Pentru a activa serviciile, trebuie să confirmi că reprezinți o entitate juridică (PFA / SRL / II / IF). Poți face asta din bannerul de deasupra listei de servicii.";
  }

  if (code === "missing_required_fields_billing") {
    if (Array.isArray(missing) && missing.length) {
      return `Completează datele de facturare: ${missing.join(
        ", "
      )} (tab „Plată & facturare”).`;
    }
    return "Completează datele de facturare în tab-ul „Plată & facturare”, apoi încearcă din nou.";
  }

  if (Array.isArray(missing) && missing.length) {
    return `Completează câmpurile obligatorii: ${missing.join(", ")}`;
  }
  if (code === "missing_required_fields_core") {
    return "Completează câmpurile esențiale ale serviciului și profilului, apoi încearcă din nou.";
  }
  if (code === "missing_required_fields_profile") {
    return "Completează profilul magazinului (brand, adresă, zonă acoperire, imagine și acord Master), apoi încearcă din nou.";
  }
  return e?.message || "Nu am putut activa serviciul.";
}

/* ============================ Subscriptions hook ============================ */
function useSubscriptionStatus({ auto = true } = {}) {
  const [state, setState] = useState({
    ok: null,
    plan: null,
    endAt: null,
    loading: true,
    error: "",
  });
  const timerRef = useRef(null);

  const fetchOnce = useCallback(async () => {
    try {
      setState((s) => ({ ...s, loading: true, error: "" }));
      const d = await api("/api/vendors/me/subscription/status", {
        method: "GET",
      });
      if (d?.ok) {
        setState({
          ok: true,
          plan: d.plan || null,
          endAt: d.endAt || null,
          loading: false,
          error: "",
        });
      } else {
        setState({
          ok: false,
          plan: null,
          endAt: null,
          loading: false,
          error: "",
        });
      }
    } catch (e) {
      setState({
        ok: false,
        plan: null,
        endAt: null,
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

  useEffect(
    () => () => timerRef.current && clearTimeout(timerRef.current),
    []
  );

  return {
    ...state,
    refetch: fetchOnce,
    startShortPolling,
  };
}

/* ------- mici utilitare pentru identitate (din Account) ------- */
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

/* =============================== Componenta =============================== */
export default function DesktopV3() {
  const { me, loading: authLoading } = useAuth();

  const [services, setServices] = useState([]);
  const [onboarding, setOnboarding] = useState(null);

  // stats vendor (vizitatori + urmăritori)
  const [stats, setStats] = useState({
    visitors: 0,
    followers: 0,
  });

  // număr real de recenzii produs / magazin
  const [reviewCounts, setReviewCounts] = useState({
    product: 0,
    store: 0,
  });

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState({});
  const [error, setError] = useState("");

  // INFO VENDOR (entitate juridică)
  const [vendor, setVendor] = useState(null);
  const [entityConfirmBusy, setEntityConfirmBusy] = useState(false);
  const [entityConfirmError, setEntityConfirmError] = useState("");

  const sub = useSubscriptionStatus();

  // cont / account bits (counts)
  const [unreadNotif, setUnreadNotif] = useState(0);
  const [unreadMsgs, setUnreadMsgs] = useState(0);
  const [cartCount, setCartCount] = useState(0);
  const [favCount, setFavCount] = useState(0);

  // ✅ suport unread
  const [supportUnread, setSupportUnread] = useState(0);

  // dacă auth context-ul aduce deja vendor cu entitySelfDeclared, îl sincronizăm
  useEffect(() => {
    if (me?.vendor) {
      setVendor(me.vendor);
    }
  }, [me]);

  const loadAllVendor = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [svc, ob, v, st] = await Promise.all([
        api("/api/vendors/me/services?includeProfile=1").catch(() => ({
          items: [],
        })),
        api("/api/vendors/me/onboarding-status").catch(() => null),
        api("/api/vendors/me").catch(() => null),
        api("/api/vendors/me/stats?window=7d").catch(() => null),
      ]);

      setServices(svc?.items || []);
      setOnboarding(ob || null);

      if (v?.vendor) setVendor(v.vendor);

      if (st) {
        setStats({
          visitors: st.visitors ?? 0,
          followers: st.followers ?? 0,
        });
        setReviewCounts({
          product: st.productReviewsTotal ?? 0,
          store: st.storeReviewsTotal ?? 0,
        });
      }
    } catch (e) {
      setError(e?.message || "Eroare la încărcare");
    } finally {
      setLoading(false);
    }
  }, []);

  // notificări / mesaje / cart / favorite / suport (refresh periodic + focus)
  useEffect(() => {
    if (!me) return;

    let alive = true;

    const fetchCounts = async () => {
      try {
        const [notif, msgs, cart, fav, sup] = await Promise.all([
          api("/api/notifications/unread-count").catch(() => ({ count: 0 })),
          me.role === "VENDOR"
            ? api("/api/inbox/unread-count").catch(() => ({ count: 0 }))
            : Promise.resolve({ count: 0 }),
          api("/api/cart/count").catch(() => ({ count: 0 })),
          api("/api/favorites/count").catch(() => ({ count: 0 })),

          // ✅ suport vendor unread (din ruta ta)
          me.role === "VENDOR"
            ? api("/api/vendor/support/unread-count").catch(() => ({
                count: 0,
              }))
            : Promise.resolve({ count: 0 }),
        ]);

        if (!alive) return;

        setUnreadNotif(notif?.count || 0);
        setUnreadMsgs(msgs?.count || 0);
        setCartCount(cart?.count || 0);
        setFavCount(fav?.count || 0);
        setSupportUnread(sup?.count || 0);
      } catch {
        // ignore
      }
    };

    fetchCounts();

    const t = setInterval(fetchCounts, 15_000);
    const onFocus = () => fetchCounts();
    window.addEventListener("focus", onFocus);

    return () => {
      alive = false;
      clearInterval(t);
      window.removeEventListener("focus", onFocus);
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
    const filled = services.filter(
      (s) => s?.profile && (s.profile.displayName || s.title)
    ).length;
    return Math.round((filled / services.length) * 100);
  }, [services]);

  const nextStep = useMemo(() => {
    if (!onboarding?.exists)
      return { label: "Creează profil vendor", href: "/onboarding" };
    const map = {
      selectServices: { label: "Alege/Adaugă servicii", href: "/onboarding" },
      fillDetails: {
        label: "Completează detalii servicii",
        href: "/onboarding/details",
      },
      profile: { label: "Publică profilul", href: "/onboarding/details" },
      done: { label: "Gata ✨", href: "/vendor/visitors" },
    };
    return map[onboarding?.nextStep] || {
      label: "Continuă",
      href: "/onboarding",
    };
  }, [onboarding]);

  /* ---------------------------- Actions ---------------------------- */
  const guardSubscriptionOrRedirect = useCallback(async () => {
    if (sub.loading) {
      await sub.refetch();
    }
    if (!sub.ok) {
      sub.startShortPolling?.();
      window.location.href = "/abonament";
      return false;
    }
    return true;
  }, [sub]);

  const onActivate = useCallback(
    async (serviceId) => {
      try {
        const ok = await guardSubscriptionOrRedirect();
        if (!ok) return;

        setBusy((prev) => ({ ...prev, [serviceId]: "activate" }));
        await api(`/api/vendors/me/services/${serviceId}/activate`, {
          method: "POST",
        });
        const d = await api("/api/vendors/me/services?includeProfile=1");
        setServices(d.items || []);
      } catch (e) {
        alert(humanizeActivateError(e));
      } finally {
        setBusy((prev) => {
          const n = { ...prev };
          delete n[serviceId];
          return n;
        });
      }
    },
    [guardSubscriptionOrRedirect]
  );

  const onDeactivate = useCallback(async (serviceId) => {
    try {
      setBusy((prev) => ({ ...prev, [serviceId]: "deactivate" }));
      await api(`/api/vendors/me/services/${serviceId}/deactivate`, {
        method: "POST",
      });
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
        !confirm(
          "Ești sigur că vrei să ștergi definitiv acest serviciu? Acțiunea nu poate fi anulată."
        )
      )
        return;
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

  const onPreview = useCallback((service) => {
    const slug = service?.profile?.slug;
    if (slug) {
      window.open(`/magazin/${slug}`, "_blank", "noopener,noreferrer");
    } else {
      window.location.href = "/onboarding/details";
    }
  }, []);

  // confirmarea entității juridice
  const onConfirmEntity = useCallback(async () => {
    try {
      setEntityConfirmBusy(true);
      setEntityConfirmError("");
      const d = await api("/api/vendors/me/entity-confirm", {
        method: "POST",
      });

      if (d?.vendor) {
        setVendor((prev) => ({
          ...(prev || {}),
          ...d.vendor,
        }));
      } else {
        setVendor((prev) => ({
          ...(prev || {}),
          entitySelfDeclared: true,
        }));
      }
    } catch (e) {
      setEntityConfirmError(
        e?.message || "Nu am putut confirma entitatea juridică."
      );
    } finally {
      setEntityConfirmBusy(false);
    }
  }, []);

  /* ---------------------------- Render gating ---------------------------- */
  if (authLoading || loading) return <div className={styles.page}>Se încarcă…</div>;
  if (!me || me.role !== "VENDOR")
    return <div className={styles.page}>Acces doar pentru vendori.</div>;

  const entityConfirmed =
    vendor?.entitySelfDeclared === true || me?.vendor?.entitySelfDeclared === true;

  const isVendor = me.role === "VENDOR";
  const isAdmin = me.role === "ADMIN";
  const roleLabel = isVendor ? "Vânzător" : isAdmin ? "Administrator" : "Utilizator";

  // scurtături (cu badge și pe wishlist/cart + suport)
  const quick = [
    {
      to: "/notificari",
      label: "Notificări",
      icon: <Bell size={20} />,
      badge: unreadNotif,
    },
    {
      to: "/mesaje",
      label: "Mesaje",
      icon: <MessageSquare size={20} />,
      badge: unreadMsgs,
    },
    {
      to: "/wishlist",
      label: "Dorințe",
      icon: <Heart size={20} />,
      badge: favCount,
    },
    {
      to: "/cos",
      label: "Coș",
      icon: <ShoppingCart size={20} />,
      badge: cartCount,
    },
    {
      to: "/vendor/support",
      label: "Asistență",
      icon: <LifeBuoy size={20} />,
      badge: supportUnread, // ✅
    },
    {
      to: "/vendor/store",
      label: "Magazinul meu",
      icon: <Store size={20} />,
    },
    {
      to: "/setari",
      label: "Setări",
      icon: <Settings size={20} />,
    },
    {
      to: "/vendor/invoices",
      label: "Facturi",
      icon: <FileText size={20} />,
    },
    {
      to: "/vendor/orders",
      label: "Comenzi",
      icon: <Package size={20} />,
    },
  ];

  return (
    <section className={styles.page}>
      <Topbar me={me} completeness={completeness} sub={sub} nextStep={nextStep} />

      {error ? <div className={styles.errorBar}>{error}</div> : null}

      {/* card de identitate / account */}
      <IdentityCard me={me} roleLabel={roleLabel} />

      {/* scurtături stil Account */}
      <QuickCard quick={quick} />

      {/* Banner confirmare entitate juridică */}
      {!entityConfirmed && (
        <div className={styles.card} style={{ borderColor: "var(--color-warn)" }}>
          <div className={styles.cardHead}>
            <h3>Confirmă că reprezinți o entitate juridică</h3>
          </div>
          <p className={styles.subtle}>
            Pentru a activa serviciile și a apărea în căutări, trebuie să confirmi că
            reprezinți o <b>entitate juridică</b> (PFA / SRL / II / IF) și deții un{" "}
            <b>CUI/CIF</b> valid. Dacă acest cont nu este destinat furnizării de servicii,
            ci doar utilizării platformei ca <b>client</b>, poți solicita modificarea tipului
            de cont către „user” prin <b>asistența tehnică</b>.
            <br />
            <br />
            Dacă ai nevoie de ajutor, contactează-ne în secțiunea <b>„Asistență tehnică”</b>{" "}
            din platformă.
          </p>

          {entityConfirmError && <div className={styles.errorBar}>{entityConfirmError}</div>}

          <div className={styles.actionsRow}>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnPrimary}`}
              onClick={onConfirmEntity}
              disabled={entityConfirmBusy}
            >
              {entityConfirmBusy ? "Se confirmă…" : "Confirm că sunt entitate juridică"}
            </button>
            <a href="/vendor/support" className={`${styles.btn} ${styles.btnGhost}`}>
              Mergi la asistență
            </a>
          </div>
        </div>
      )}

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
            onActivate={onActivate}
            onDeactivate={onDeactivate}
            onDelete={onDelete}
            onPreview={onPreview}
          />
        </div>

        <Sidebar sub={sub} />
      </div>

      {/* secțiuni account: setări, vendor, admin, logout */}
      <SettingsAndSecurityCard />

      {isVendor && (
        <VendorLinksCard
          unreadMsgs={unreadMsgs}
          supportUnread={supportUnread} // ✅
        />
      )}

      {isAdmin && <AdminCard />}

      <LogoutCard />
    </section>
  );
}

/* ============================= Sub-componente ============================= */

function Topbar({ me, completeness, sub, nextStep }) {
  const subBadge = (() => {
    if (sub.loading) return <span className={styles.badgeWait}>Verific abonament…</span>;
    if (sub.ok) {
      const end = sub.endAt ? new Date(sub.endAt) : null;
      const daysLeft = end
        ? Math.ceil((end - new Date()) / (1000 * 60 * 60 * 24))
        : null;
      return (
        <span className={styles.badgeOk}>
          Plan: {sub.plan?.name || sub.plan?.code || "activ"}
          {end ? ` • până la ${end.toLocaleDateString("ro-RO")}` : ""}
          {typeof daysLeft === "number" ? ` • ${daysLeft} zile rămase` : ""}
        </span>
      );
    }
    return (
      <a className={`${styles.badgeWarn}`} href="/abonament" title="Activează abonamentul">
        Fără abonament activ — Activează abonament
      </a>
    );
  })();

  return (
    <div className={styles.topbar}>
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
      <a className={`${styles.btn} ${styles.btnPrimary}`} href={nextStep.href}>
        {nextStep.label}
      </a>
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
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: "50%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontWeight: 600,
            background: "var(--color-bg-soft, #eee)",
          }}
        >
          {initials}
        </div>
        <div>
          <div style={{ fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
            {displayName(me)}
            {me?.verified && (
              <span style={{ display: "inline-flex", alignItems: "center", fontSize: 12 }}>
                <CheckCircle2 size={14} style={{ marginRight: 2 }} /> Verificat
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
          <a
            key={q.to}
            href={q.to}
            className={`${styles.btn} ${styles.btnGhost} ${styles.btnWithBadge}`}
            style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}
          >
            <span className={styles.iconWrap}>
              {q.icon}
              <Badge count={q.badge} />
            </span>
            <span>{q.label}</span>
          </a>
        ))}
      </div>
    </div>
  );
}

function SubscriptionAlert({ sub }) {
  if (sub.loading || sub.ok) return null;
  return (
    <div className={styles.card} style={{ borderColor: "var(--color-warn)" }}>
      <div className={styles.cardHead}>
        <h3>Abonament necesar</h3>
      </div>
      <p className={styles.subtle}>
        Pentru a activa servicii și a apărea în căutări, ai nevoie de un abonament activ.
      </p>
      <div className={styles.actionsRow}>
        <a className={`${styles.btn} ${styles.btnPrimary}`} href="/abonament">
          Activează abonamentul
        </a>
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
        <a className={`${styles.btn} ${styles.btnPrimary}`} href="/onboarding">
          Alege/Adaugă servicii
        </a>
        <a className={`${styles.btn} ${styles.btnGhost}`} href="/onboarding/details">
          Completează detalii
        </a>
      </div>
    </div>
  );
}

function ServicesCard({ services, busy, onActivate, onDeactivate, onDelete, onPreview }) {
  const activeCount = services.filter((s) => s.isActive && s.status === "ACTIVE").length;

  return (
    <div className={styles.card}>
      <div className={styles.cardHead}>
        <h3>Serviciile mele</h3>
        <div className={styles.subtle}>
          Active: <b>{activeCount}</b> / Total: <b>{services.length}</b>
        </div>
      </div>

      {services.length === 0 ? (
        <EmptyState
          title="Nu ai servicii încă"
          subtitle="Începe prin a alege servicii și a completa detaliile profilului."
          ctaText="Pornește onboarding"
          href="/onboarding"
        />
      ) : (
        <ul className={styles.serviceList}>
          {services.map((s) => {
            const isAct = !!(s.isActive && s.status === "ACTIVE");
            const isBusy = !!busy[s.id];
            const actLabel = isAct ? "Dezactivează" : "Activează";
            const actTitle = isAct ? "Dezactivează" : "Activează";

            const brandVal = (s.profile?.displayName && s.profile.displayName.trim()) || "";
            const titleVal = (s.title && s.title.trim()) || "";

            const missingFields = [];
            if (!titleVal) missingFields.push("titlul");
            if (!brandVal) missingFields.push("numele de brand");

            const missingCore = missingFields.length > 0;

            return (
              <li key={s.id} className={styles.serviceItem}>
                <div className={styles.serviceMain}>
                  <div className={styles.serviceTitle}>
                    {s.type?.name || s.typeName}
                    {s.title ? ` — ${s.title}` : ""}
                  </div>
                  <div className={styles.serviceMeta}>
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
                  </div>
                  {missingCore && !isAct && (
                    <div className={styles.serviceWarning}>
                      Pentru a putea activa serviciul, completează {missingFields.join(", ")}.
                    </div>
                  )}
                </div>

                <div className={styles.actionsRow}>
                  <a className={`${styles.btn} ${styles.btnGhost}`} href="/onboarding/details">
                    Editează
                  </a>

                  <button
                    className={`${styles.btn} ${styles.btnGhost}`}
                    onClick={() => onPreview(s)}
                    disabled={isBusy}
                    type="button"
                    title="Previzualizează"
                  >
                    Previzualizează
                  </button>

                  {isAct ? (
                    <button
                      className={`${styles.btn} ${styles.btnWarn}`}
                      onClick={() => onDeactivate(s.id)}
                      disabled={isBusy}
                      type="button"
                      title={actTitle}
                    >
                      {busy[s.id] === "deactivate" ? "Se dezactivează…" : actLabel}
                    </button>
                  ) : (
                    <button
                      className={`${styles.btn} ${styles.btnPrimary}`}
                      onClick={() => onActivate(s.id)}
                      disabled={isBusy}
                      type="button"
                      title={actTitle}
                    >
                      {busy[s.id] === "activate" ? "Se activează…" : actLabel}
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
  return (
    <aside className={styles.colSide}>
      <div className={styles.card}>
        <div className={styles.cardHead}>
          <h3>Abonament</h3>
        </div>

        {sub.loading ? (
          <p className={styles.subtle}>Se verifică abonamentul…</p>
        ) : sub.ok ? (
          <>
            <p className={styles.subtle}>
              Plan: <b>{sub.plan?.name || sub.plan?.code || "activ"}</b>
              <br />
              {sub.endAt ? (
                <>
                  Valabil până la:{" "}
                  <b>{new Date(sub.endAt).toLocaleDateString("ro-RO")}</b>
                </>
              ) : null}
            </p>
            <a
              className={`${styles.btn} ${styles.btnGhost}`}
              href="/onboarding/details?tab=plata&solo=1"
            >
              Gestionează abonamentul
            </a>
            <button className={`${styles.btn} ${styles.btnGhost}`} onClick={sub.refetch} type="button">
              Reîncarcă
            </button>
          </>
        ) : (
          <>
            <p className={styles.subtle}>
              Nu ai un abonament activ. Activează-l pentru a-ți publica serviciile.
            </p>
            <a
              className={`${styles.btn} ${styles.btnPrimary}`}
              href="/onboarding/details?tab=plata&solo=1"
            >
              Activează abonament
            </a>
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
  return (
    <div className={styles.card}>
      <div className={styles.cardHead}>
        <h3>Setări & securitate</h3>
      </div>

      <div className={styles.actionsCol}>
        <a className={`${styles.btn} ${styles.btnGhost}`} href="/cont/setari">
          <Settings size={18} style={{ marginRight: 6 }} /> Setări cont
        </a>

        <a className={`${styles.btn} ${styles.btnGhost}`} href="/vendor/invoices">
          <FileText size={18} style={{ marginRight: 6 }} /> Facturi / documente
        </a>

        <a className={`${styles.btn} ${styles.btnGhost}`} href="/setari?tab=billing">
          <CreditCard size={18} style={{ marginRight: 6 }} /> Date facturare
        </a>

        <a
          className={`${styles.btn} ${styles.btnGhost}`}
          href={`${import.meta.env.VITE_API_URL.replace(/\/+$/, "")}/termenii-si-conditiile`}
        >
          <FileText size={18} style={{ marginRight: 6 }} /> Termeni și condiții
        </a>

        <a
          className={`${styles.btn} ${styles.btnGhost}`}
          href={`${import.meta.env.VITE_API_URL.replace(/\/+$/, "")}/confidentialitate`}
        >
          <ShieldHalf size={18} style={{ marginRight: 6 }} /> Politica de confidențialitate
        </a>

        <a
          className={`${styles.btn} ${styles.btnGhost}`}
          href={`${import.meta.env.VITE_API_URL.replace(/\/+$/, "")}/politica-retur`}
        >
          <FileText size={18} style={{ marginRight: 6 }} /> Politica de retur
        </a>

        <a
          className={`${styles.btn} ${styles.btnGhost}`}
          href={`${import.meta.env.VITE_API_URL.replace(/\/+$/, "")}/anexa-expediere`}
        >
          <FileText size={18} style={{ marginRight: 6 }} /> Anexa expediere
        </a>

        <a
          className={`${styles.btn} ${styles.btnGhost}`}
          href={`${import.meta.env.VITE_API_URL.replace(/\/+$/, "")}/acord-vanzatori`}
        >
          <ShieldHalf size={18} style={{ marginRight: 6 }} /> Acord vânzători
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
        <a className={`${styles.btn} ${styles.btnGhost}`} href="/vendor/orders">
          <Package size={18} style={{ marginRight: 6 }} /> Comenzile mele
        </a>
        <a className={`${styles.btn} ${styles.btnGhost}`} href="/vendor/orders/planning">
          <LayoutDashboard size={18} style={{ marginRight: 6 }} /> Planificator comenzi
        </a>
        <a className={`${styles.btn} ${styles.btnGhost}`} href="/vendor/visitors">
          <Users size={18} style={{ marginRight: 6 }} /> Vizitatori
        </a>

        <a className={`${styles.btn} ${styles.btnGhost} ${styles.btnWithBadge}`} href="/mesaje">
          <span className={styles.iconWrap}>
            <MessageSquare size={18} style={{ marginRight: 6 }} />
            <Badge count={unreadMsgs} />
          </span>
          Mesaje
        </a>

        <a className={`${styles.btn} ${styles.btnGhost}`} href="/magazine">
          <Store size={18} style={{ marginRight: 6 }} /> Magazine / Produse
        </a>

        {/* ✅ suport cu badge */}
        <a className={`${styles.btn} ${styles.btnGhost} ${styles.btnWithBadge}`} href="/vendor/support">
          <span className={styles.iconWrap}>
            <LifeBuoy size={18} style={{ marginRight: 6 }} />
            <Badge count={supportUnread} />
          </span>
          Asistență tehnică
        </a>
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
        <a className={`${styles.btn} ${styles.btnGhost}`} href="/admin">
          <ShieldCheck size={18} style={{ marginRight: 6 }} /> Panou Admin
        </a>
      </div>
    </div>
  );
}

function LogoutCard() {
  async function handleLogout(e) {
    e.preventDefault();
    try {
      await api("/api/auth/logout", { method: "POST" });
    } catch {
      // ignore
    }
    window.location.href = "/autentificare";
  }

  return (
    <div className={styles.card}>
      <button
        className={`${styles.btn} ${styles.btnDanger}`}
        type="button"
        onClick={handleLogout}
        style={{
          width: "100%",
          justifyContent: "center",
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <LogOut size={18} />
        Deconectare
      </button>
    </div>
  );
}

/* ===== micro-componente ===== */
function KPI({ label, value }) {
  return (
    <div className={styles.kpi}>
      <div className={styles.kpiVal}>{value}</div>
      <div className={styles.kpiLabel}>{label}</div>
    </div>
  );
}

function EmptyState({ title, subtitle, ctaText, href }) {
  return (
    <div className={styles.empty}>
      <div className={styles.emptyTitle}>{title}</div>
      <div className={styles.subtle}>{subtitle}</div>
      <a className={`${styles.btn} ${styles.btnPrimary}`} href={href}>
        {ctaText}
      </a>
    </div>
  );
}

function Badge({ count }) {
  if (!count || count <= 0) return null;
  const v = Math.min(count, 99);
  return <span className={styles.badgeBubble}>{v}</span>;
}
