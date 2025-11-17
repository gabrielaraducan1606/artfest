// src/pages/Desktop/Desktop.jsx
import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { api } from "../../../lib/api";
import { useAuth } from "../../../pages/Auth/Context/useAuth.js";
import styles from "./Desktop.module.css";

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
  if (Array.isArray(missing) && missing.length) {
    return `Completează câmpurile obligatorii: ${missing.join(", ")}`;
  }
  if (code === "missing_required_fields_core") {
    return "Completează titlul pachetului și orașul serviciului, apoi încearcă din nou.";
  }
  if (code === "missing_required_fields_specs") {
    return "Completează specificațiile obligatorii din secțiunea de detalii ale serviciului.";
  }
  return e?.message || "Nu am putut activa serviciul.";
}

/* ============================ Subscriptions hook ============================ */
/**
 * Folosește endpointul: GET /api/vendors/me/subscription/status
 * { ok:false, code:"subscription_required", upgradeUrl:"/app/billing" }
 * sau
 * { ok:true, plan:{code,name}, endAt: ISO }
 */
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

  // polling scurt după întoarcerea din plată (max 2 min, din 10 în 10 sec.)
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

/* ======================= Helpers pentru activity feed ======================= */
function labelForActivity(type) {
  switch (type) {
    case "visit":
      return "Vizită";
    case "lead":
      return "Cerere ofertă";
    case "message":
      return "Mesaj";
    case "review":
      return "Review";
    default:
      return "Activitate";
  }
}

function activityText(item) {
  const name = item.serviceName || "serviciul tău";
  switch (item.type) {
    case "visit":
      return `Ai primit o vizită nouă pe „${name}”.`;
    case "lead":
      return `Cerere nouă de ofertă pentru „${name}”.`;
    case "message":
      return `Mesaj nou pentru „${name}”.`;
    case "review":
      return `Review nou pentru „${name}”.`;
    default:
      return item.text || `Actualizare pentru „${name}”.`;
  }
}

/* =============================== Componenta =============================== */
export default function DesktopV3() {
  const { me, loading: authLoading } = useAuth();

  const [services, setServices] = useState([]);
  const [onboarding, setOnboarding] = useState(null);
  const [stats, setStats] = useState({
    visitors: 0,
    leads: 0,
    messages: 0,
    reviews: 0,
  });
  const [activity, setActivity] = useState([]);
  const [activityLoading, setActivityLoading] = useState(true);

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState({}); // { [serviceId]: 'activate' | 'deactivate' | 'delete' }
  const [error, setError] = useState("");

  const sub = useSubscriptionStatus();

  const loadAllVendor = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [svc, ob] = await Promise.all([
        api("/api/vendors/me/services?includeProfile=1").catch(() => ({
          items: [],
        })),
        api("/api/vendors/me/onboarding-status").catch(() => null),
      ]);
      setServices(svc?.items || []);
      setOnboarding(ob || null);
      const st = await api("/api/vendors/me/stats?window=7d").catch(
        () => null
      );
      if (st) setStats(st);
    } catch (e) {
      setError(e?.message || "Eroare la încărcare");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadActivity = useCallback(async () => {
    setActivityLoading(true);
    try {
      const d = await api("/api/vendors/me/activity?limit=10").catch(
        () => null
      );
      setActivity(d?.items || []);
    } catch {
      setActivity([]);
    } finally {
      setActivityLoading(false);
    }
  }, []);

  // Încarcă datele vendor doar după ce știm cine e userul
  useEffect(() => {
    if (authLoading) return;
    if (!me) {
      setLoading(false);
      return;
    }
    if (me.role === "VENDOR") {
      loadAllVendor();
      loadActivity();
    } else {
      setLoading(false);
    }
  }, [authLoading, me, loadAllVendor, loadActivity]);

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
        alert(
          "Serviciul este activ. Dezactivează-l înainte de a-l șterge."
        );
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

  /* ---------------------------- Render gating ---------------------------- */
  if (authLoading || loading)
    return <div className={styles.page}>Se încarcă…</div>;
  if (!me || me.role !== "VENDOR")
    return (
      <div className={styles.page}>Acces doar pentru vendori.</div>
    );

  return (
    <section className={styles.page}>
      <Topbar
        me={me}
        completeness={completeness}
        sub={sub}
        nextStep={nextStep}
      />

      {error ? <div className={styles.errorBar}>{error}</div> : null}

      <SubscriptionAlert sub={sub} />

      <div className={styles.kpiRow}>
        <KPI label="Vizitatori (7d)" value={stats.visitors ?? 0} />
        <KPI label="Lead-uri (7d)" value={stats.leads ?? 0} />
        <KPI label="Mesaje (7d)" value={stats.messages ?? 0} />
        <KPI label="Review-uri (7d)" value={stats.reviews ?? 0} />
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

          <ActivityCard
            activity={activity}
            loading={activityLoading}
            onReload={loadActivity}
          />
        </div>

        <Sidebar sub={sub} stats={stats} />
      </div>
    </section>
  );
}

/* ============================= Sub-componente ============================= */

function Topbar({ me, completeness, sub, nextStep }) {
  // badge abonament
  const subBadge = (() => {
    if (sub.loading)
      return (
        <span className={styles.badgeWait}>Verific abonament…</span>
      );
    if (sub.ok) {
      const end = sub.endAt ? new Date(sub.endAt) : null;
      const daysLeft = end
        ? Math.ceil(
            (end - new Date()) / (1000 * 60 * 60 * 24)
          )
        : null;
      return (
        <span className={styles.badgeOk}>
          Plan: {sub.plan?.name || sub.plan?.code || "activ"}
          {end ? ` • până la ${end.toLocaleDateString("ro-RO")}` : ""}
          {typeof daysLeft === "number"
            ? ` • ${daysLeft} zile rămase`
            : ""}
        </span>
      );
    }
    return (
      <a
        className={`${styles.badgeWarn}`}
        href="/abonament"
        title="Activează abonamentul"
      >
        Fără abonament activ — Activează abonament
      </a>
    );
  })();

  return (
    <div className={styles.topbar}>
      <div>
        <h1 className={styles.h1}>
          Bun venit, {me.name || me.email}!
        </h1>
        <div className={styles.meta}>
          <span className={styles.badge}>VENDOR</span>
          <span className={styles.dot} />
          <span className={styles.metaBlock}>
            Completență profil:
            <b> {completeness}%</b>
          </span>
          <span className={styles.dot} />
          {subBadge}
        </div>

        <div className={styles.profileCompletion}>
          <div className={styles.progressBar}>
            <div
              className={styles.progressFill}
              style={{ width: `${completeness}%` }}
            />
          </div>
          <span className={styles.progressLabel}>
            Următorul pas: <b>{nextStep.label}</b>
          </span>
        </div>
      </div>
      <a
        className={`${styles.btn} ${styles.btnPrimary}`}
        href={nextStep.href}
      >
        {nextStep.label}
      </a>
    </div>
  );
}

function SubscriptionAlert({ sub }) {
  if (sub.loading || sub.ok) return null;
  return (
    <div
      className={styles.card}
      style={{ borderColor: "var(--color-warn)" }}
    >
      <div className={styles.cardHead}>
        <h3>Abonament necesar</h3>
      </div>
      <p className={styles.subtle}>
        Pentru a activa servicii și a apărea în căutări, ai nevoie de
        un abonament activ.
      </p>
      <div className={styles.actionsRow}>
        <a className={`${styles.btn} ${styles.btnPrimary}`} href="/abonament">
          Activează abonamentul
        </a>
        <button
          className={`${styles.btn} ${styles.btnGhost}`}
          onClick={sub.refetch}
          type="button"
        >
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
        <a
          className={`${styles.btn} ${styles.btnPrimary}`}
          href="/onboarding"
        >
          Alege/Adaugă servicii
        </a>
        <a
          className={`${styles.btn} ${styles.btnGhost}`}
          href="/onboarding/details"
        >
          Completează detalii
        </a>
        <a
          className={`${styles.btn} ${styles.btnGhost}`}
          href="/vendor/visitors"
        >
          Vezi vizitatorii
        </a>
      </div>
    </div>
  );
}

function ServicesCard({
  services,
  busy,
  onActivate,
  onDeactivate,
  onDelete,
  onPreview,
}) {
  const activeCount = services.filter(
    (s) => s.isActive && s.status === "ACTIVE"
  ).length;

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

            const missingCore =
              !s.city || !s.profile?.displayName || !s.title;

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
                  {missingCore && (
                    <div className={styles.serviceWarning}>
                      Pentru a putea activa serviciul, completează orașul,
                      titlul și numele de brand.
                    </div>
                  )}
                </div>
                <div className={styles.actionsRow}>
                  <a
                    className={`${styles.btn} ${styles.btnGhost}`}
                    href="/onboarding/details"
                  >
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
                      {busy[s.id] === "deactivate"
                        ? "Se dezactivează…"
                        : actLabel}
                    </button>
                  ) : (
                    <button
                      className={`${styles.btn} ${styles.btnPrimary}`}
                      onClick={() => onActivate(s.id)}
                      disabled={isBusy}
                      type="button"
                      title={actTitle}
                    >
                      {busy[s.id] === "activate"
                        ? "Se activează…"
                        : actLabel}
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

function ActivityCard({ activity, loading, onReload }) {
  return (
    <div className={styles.card}>
      <div className={styles.cardHead}>
        <h3>Activitate recentă</h3>
        <button
          className={`${styles.btn} ${styles.btnGhost}`}
          type="button"
          onClick={onReload}
        >
          Reîncarcă
        </button>
      </div>
      {loading ? (
        <p className={styles.subtle}>Se încarcă activitatea…</p>
      ) : activity.length === 0 ? (
        <p className={styles.subtle}>
          Încă nu ai activitate recentă. Când vei primi vizite, cereri sau
          review-uri, le vei vedea aici.
        </p>
      ) : (
        <ul className={styles.timeline}>
          {activity.map((item) => (
            <li key={item.id} className={styles.timelineItem}>
              <div className={styles.timelineMain}>
                <span className={styles.timelineType}>
                  {labelForActivity(item.type)}
                </span>
                <span className={styles.timelineText}>
                  {activityText(item)}
                </span>
              </div>
              <span className={styles.timelineTime}>
                {item.createdAt
                  ? new Date(item.createdAt).toLocaleString("ro-RO", {
                      dateStyle: "short",
                      timeStyle: "short",
                    })
                  : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Sidebar({ sub, stats }) {
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
                  <b>
                    {new Date(sub.endAt).toLocaleDateString("ro-RO")}
                  </b>
                </>
              ) : null}
            </p>
            <a
              className={`${styles.btn} ${styles.btnGhost}`}
              href="/onboarding/details?tab=plata&solo=1"
            >
              Gestionează abonamentul
            </a>
            <button
              className={`${styles.btn} ${styles.btnGhost}`}
              onClick={sub.refetch}
              type="button"
            >
              Reîncarcă
            </button>
          </>
        ) : (
          <>
            <p className={styles.subtle}>
              Nu ai un abonament activ. Activează-l pentru a-ți publica
              serviciile.
            </p>
            <a
              className={`${styles.btn} ${styles.btnPrimary}`}
              href="/onboarding/details?tab=plata&solo=1"
            >
              Activează abonament
            </a>
            <button
              className={`${styles.btn} ${styles.btnGhost}`}
              onClick={sub.refetch}
              type="button"
            >
              Am plătit — verifică din nou
            </button>
          </>
        )}
      </div>

      <div className={styles.card}>
        <div className={styles.cardHead}>
          <h3>Vizitatori</h3>
        </div>
        <p className={styles.subtle}>
          Ultimele 7 zile: <b>{stats.visitors ?? 0}</b>
        </p>
        <a
          className={`${styles.btn} ${styles.btnGhost}`}
          href="/vendor/visitors"
        >
          Vezi vizitatorii
        </a>
      </div>

      <div className={styles.card}>
        <div className={styles.cardHead}>
          <h3>Asistență</h3>
        </div>
        <div className={styles.actionsCol}>
          <a
            className={`${styles.btn} ${styles.btnGhost}`}
            href="/asistenta-tehnica"
          >
            Suport & FAQ
          </a>
          <a
            className={`${styles.btn} ${styles.btnGhost}`}
            href="/ghid-imagini"
          >
            Ghid imagini
          </a>
        </div>
      </div>
    </aside>
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
