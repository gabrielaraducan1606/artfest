// client/src/pages/Vendor/Desktop/Desktop.jsx
import { useEffect, useMemo, useState, useCallback } from "react";
import { api } from "../../../lib/api";
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
    return e?.error || e?.code || e?.data?.error || e?.response?.data?.error || null;
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

export default function DesktopV2() {
  const [me, setMe] = useState(null);
  const [services, setServices] = useState([]);
  const [onboarding, setOnboarding] = useState(null);
  const [stats, setStats] = useState({ visitors: 0, leads: 0, messages: 0, reviews: 0 });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState({});  // { [serviceId]: 'activate' | 'deactivate' | 'delete' }
  const [error, setError] = useState("");

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const { user } = await api("/api/auth/me");
      setMe(user);
      if (user?.role === "VENDOR") {
        const [svc, ob] = await Promise.all([
          api("/api/vendors/me/services?includeProfile=1").catch(() => ({ items: [] })),
          api("/api/vendors/me/onboarding-status").catch(() => null),
        ]);
        setServices(svc?.items || []);
        setOnboarding(ob || null);

        const st = await api("/api/vendors/me/stats?window=7d").catch(() => null);
        if (st) setStats(st);
      }
    } catch (e) {
      setError(e?.message || "Eroare la încărcare");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      await loadAll();
      if (!alive) return;
    })();
    return () => {
      alive = false;
    };
  }, [loadAll]);

  const completeness = useMemo(() => {
    const total = services.length || 1;
    const filled = services.filter(s => s?.profile && (s.profile.displayName || s.title)).length;
    return Math.round((filled / total) * 100);
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

  /* ---------------------------- Actions ---------------------------- */
  const onActivate = useCallback(async (serviceId) => {
    try {
      setBusy(prev => ({ ...prev, [serviceId]: "activate" }));
      await api(`/api/vendors/me/services/${serviceId}/activate`, { method: "POST" });
      const d = await api("/api/vendors/me/services?includeProfile=1");
      setServices(d.items || []);
    } catch (e) {
      alert(humanizeActivateError(e));
    } finally {
      setBusy(prev => {
        const n = { ...prev };
        delete n[serviceId];
        return n;
      });
    }
  }, []);

  const onDeactivate = useCallback(async (serviceId) => {
    try {
      setBusy(prev => ({ ...prev, [serviceId]: "deactivate" }));
      await api(`/api/vendors/me/services/${serviceId}/deactivate`, { method: "POST" });
      const d = await api("/api/vendors/me/services?includeProfile=1");
      setServices(d.items || []);
    } catch (e) {
      alert(e?.message || "Nu am putut dezactiva serviciul.");
    } finally {
      setBusy(prev => {
        const n = { ...prev };
        delete n[serviceId];
        return n;
      });
    }
  }, []);

  const onDelete = useCallback(async (serviceId, isActive, status) => {
    try {
      if (isActive && status === "ACTIVE") {
        return alert("Serviciul este activ. Dezactivează-l înainte de a-l șterge.");
      }
      if (!confirm("Ești sigur că vrei să ștergi definitiv acest serviciu?")) return;
      setBusy(prev => ({ ...prev, [serviceId]: "delete" }));
      await api(`/api/vendors/me/services/${serviceId}`, { method: "DELETE" });
      const d = await api("/api/vendors/me/services?includeProfile=1");
      setServices(d.items || []);
    } catch (e) {
      alert(e?.message || "Nu am putut șterge serviciul.");
    } finally {
      setBusy(prev => {
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

  /* ---------------------------- Render ---------------------------- */
  if (loading) return <div className={styles.page}>Se încarcă…</div>;
  if (!me || me.role !== "VENDOR") return <div className={styles.page}>Acces doar pentru vendori.</div>;

  return (
    <section className={styles.page}>
      <div className={styles.topbar}>
        <div>
          <h1 className={styles.h1}>Bun venit, {me.name || me.email}!</h1>
          <div className={styles.meta}>
            <span className={styles.badge}>VENDOR</span>
            <span className={styles.dot} />
            Completență profil: <b>{completeness}%</b>
          </div>
        </div>
        <a className={`${styles.btn} ${styles.btnPrimary}`} href={nextStep.href}>{nextStep.label}</a>
      </div>

      {error ? <div className={styles.errorBar}>{error}</div> : null}

      <div className={styles.kpiRow}>
        <KPI label="Vizitatori (7d)" value={stats.visitors ?? 0} />
        <KPI label="Lead-uri (7d)" value={stats.leads ?? 0} />
        <KPI label="Mesaje (7d)" value={stats.messages ?? 0} />
        <KPI label="Review-uri (7d)" value={stats.reviews ?? 0} />
      </div>

      <div className={styles.grid}>
        <div className={styles.colMain}>
          <div className={styles.card}>
            <div className={styles.cardHead}>
              <h3>Onboarding</h3>
              <span className={styles.subtle}>Următorul pas: <b>{nextStep.label}</b></span>
            </div>
            <div className={styles.actionsRow}>
              <a className={`${styles.btn} ${styles.btnPrimary}`} href="/onboarding">Alege/Adaugă servicii</a>
              <a className={`${styles.btn} ${styles.btnGhost}`} href="/onboarding/details">Completează detalii</a>
              <a className={`${styles.btn} ${styles.btnGhost}`} href="/vendor/visitors">Vezi vizitatorii</a>
            </div>
          </div>

          <div className={styles.card}>
            <div className={styles.cardHead}>
              <h3>Serviciile mele</h3>
              <div className={styles.subtle}>
                Active: <b>{services.filter(s => s.isActive && s.status === "ACTIVE").length}</b> / Total: <b>{services.length}</b>
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
                {services.map(s => {
                  const isAct = !!(s.isActive && s.status === "ACTIVE");
                  const isBusy = !!busy[s.id];
                  const actLabel = isAct ? "Dezactivează" : "Activează";
                  const actTitle = isAct ? "Dezactivează" : "Activează";
                  return (
                    <li key={s.id} className={styles.serviceItem}>
                      <div className={styles.serviceMain}>
                        <div className={styles.serviceTitle}>
                          {s.type?.name || s.typeName}{s.title ? ` — ${s.title}` : ""}
                        </div>
                        <div className={styles.serviceMeta}>
                          Status: <b>{s.status}</b>{isAct ? " (activ)" : ""}
                          {s.profile?.displayName ? <> · Brand: <b>{s.profile.displayName}</b></> : null}
                          {s.city ? <> · Oraș: <b>{s.city}</b></> : null}
                        </div>
                      </div>
                      <div className={styles.actionsRow}>
                        <a className={`${styles.btn} ${styles.btnGhost}`} href="/onboarding/details">Editează</a>
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

          <div className={styles.card}>
            <div className={styles.cardHead}><h3>Activitate recentă</h3></div>
            <ul className={styles.timeline}>
              <li>Ai primit 2 vizite noi pe „Profil Fotograf”.</li>
              <li>O cerere nouă de ofertă pentru „Formație / DJ”.</li>
              <li>Review nou pe „Restaurant / Catering”.</li>
            </ul>
          </div>
        </div>

        <aside className={styles.colSide}>
          <div className={styles.card}>
            <div className={styles.cardHead}><h3>Abonament</h3></div>
            <p className={styles.subtle}>Funcționalitate în lucru. Momentan, profilurile nu depind de abonament.</p>
            <a className={`${styles.btn} ${styles.btnGhost}`} href="/abonament">Gestionează abonamentul</a>
          </div>

          <div className={styles.card}>
            <div className={styles.cardHead}><h3>Vizitatori</h3></div>
            <p className={styles.subtle}>Ultimele 7 zile: <b>{stats.visitors ?? 0}</b></p>
            <a className={`${styles.btn} ${styles.btnGhost}`} href="/vendor/visitors">Vezi vizitatorii</a>
          </div>

          <div className={styles.card}>
            <div className={styles.cardHead}><h3>Asistență</h3></div>
            <div className={styles.actionsCol}>
              <a className={`${styles.btn} ${styles.btnGhost}`} href="/asistenta-tehnica">Suport & FAQ</a>
              <a className={`${styles.btn} ${styles.btnGhost}`} href="/ghid-imagini">Ghid imagini</a>
            </div>
          </div>
        </aside>
      </div>
    </section>
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
      <a className={`${styles.btn} ${styles.btnPrimary}`} href={href}>{ctaText}</a>
    </div>
  );
}
