import { useEffect, useMemo, useState } from "react";
import { api } from "../../../../../lib/api";
import styles from "../OnBoardingDetails.module.css";

/* ============================ Constante ============================ */
const YEAR_DISCOUNT = 0.2; // -20% la anual (poți schimba)

// comisioane platformă (basis points = sutimi de procent)
const FEES = {
  starter:  { productsBps: 1000, servicesBps: 700 },  // 10.00%, 7.00%
  basic:    { productsBps:  800, servicesBps: 500 },  // 8.00%, 5.00%
  pro:      { productsBps:  600, servicesBps: 350 },  // 6.00%, 3.50%
  business: { productsBps:  400, servicesBps: 250 },  // 4.00%, 2.50%
};

// fallback local (în caz că backend-ul nu are încă seed)
const DEFAULT_PLANS = [
  { id:"local-starter",  code:"starter",  name:"Starter",  priceCents:0,     currency:"RON", interval:"month", isActive:true,
    features:["25 produse","Link distribuire","Agenda de bază","1 membru, 1 locație"], popular:false },
  { id:"local-basic",    code:"basic",    name:"Basic",    priceCents:4900,  currency:"RON", interval:"month", isActive:true,
    features:["150 produse, variante & stoc","Discount codes, UTM","Agenda extinsă, avans","2 membri, 2 locații"], popular:false },
  { id:"local-pro",      code:"pro",      name:"Pro",      priceCents:9900,  currency:"RON", interval:"month", isActive:true,
    features:["Produse nelimitate, SEO","Boosturi în listări","Agenda Pro + SMS","3 membri, multi-locație"], popular:true },
  { id:"local-business", code:"business", name:"Business", priceCents:19900, currency:"RON", interval:"month", isActive:true,
    features:["Multi-brand/store","API & Webhooks","Seats extins","Suport prioritar"], popular:false },
];

/* ============================ Utils ============================ */
function formatPrice(cents, currency = "RON") {
  if (cents === 0) return "Gratuit";
  try {
    return new Intl.NumberFormat("ro-RO", { style: "currency", currency }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}
function bpsToPct(bps) {
  return (bps / 100).toFixed(bps % 100 ? 2 : 0) + "%";
}
function absolutizeBackendUrl(url) {
  if (/^https?:\/\//i.test(url)) return url;
  const base = (import.meta.env?.VITE_API_URL || "http://localhost:5000").replace(/\/+$/, "");
  return `${base}${url.startsWith("/") ? "" : "/"}${url}`;
}

/* ============================ Hooks ============================ */
function usePlans() {
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoading(true);
        setErr("");
        const d = await api("/api/billing/plans", { method: "GET" });
        const items = Array.isArray(d?.items) && d.items.length ? d.items : DEFAULT_PLANS;
        if (!alive) return;
        setPlans(items);
      } catch (e) {
        if (!alive) return;
        setPlans(DEFAULT_PLANS);
        setErr(e?.message || "Nu am putut încărca planurile; folosesc lista implicită.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  const enriched = useMemo(() => {
    return (plans || []).map(p => ({
      ...p,
      fees: FEES[p.code] || FEES.starter,
      popular: p.popular ?? (p.code === "pro"),
    }));
  }, [plans]);

  return { plans: enriched, loading, err };
}

function useCurrentSubscription() {
  const [sub, setSub] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoading(true);
        const d = await api("/api/vendors/me/subscription", { method: "GET" });
        if (!alive) return;
        setSub(d?.subscription ?? null);
      } catch {
        if (!alive) return;
        setSub(null);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  return { sub, loading };
}

/* ============================ Componenta principală ============================ */
function SubscriptionPayment({ obSessionId }) {
  const { plans, loading: plansLoading, err: plansErr } = usePlans();
  const { sub, loading: subLoading } = useCurrentSubscription();

  // sessionStorage utilitar namespaced
  const KEY_PLAN = `onboarding.plan:${obSessionId || "default"}`;
  const KEY_PERIOD = `onboarding.period:${obSessionId || "default"}`;
  const ss = {
    get(k) { try { if (typeof window==="undefined") return null; return window.sessionStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { if (typeof window==="undefined") return; window.sessionStorage.setItem(k, v); } catch {""} },
  };

  const [period, setPeriod] = useState(() => (ss.get(KEY_PERIOD) === "year" ? "year" : "month"));
  const [plan, setPlan] = useState(() => ss.get(KEY_PLAN) || "basic");

  // dacă backend-ul spune planul curent, îl folosim ca selecție
  useEffect(() => {
    if (sub?.plan?.code) {
      setPlan(sub.plan.code);
      ss.set(KEY_PLAN, sub.plan.code);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sub?.plan?.code]);

  // dacă planul selectat nu mai e în listă, alege primul activ
  useEffect(() => {
    if (!plans.length) return;
    const exists = plans.some(p => p.code === plan);
    if (!exists) {
      const first = plans.find(p => p.isActive !== false) || plans[0];
      setPlan(first.code);
      ss.set(KEY_PLAN, first.code);
    }
  }, [plans, plan]); // eslint-disable-line react-hooks/exhaustive-deps

  const [status, setStatus] = useState("idle"); // 'idle'|'processing'|'done'|'error'
  const [err, setErr] = useState("");

  function changePeriod(next) {
    setPeriod(next);
    ss.set(KEY_PERIOD, next);
  }

  async function startCheckout() {
    try {
      setStatus("processing");
      setErr("");
      const { url } = await api(
        `/api/billing/checkout?plan=${encodeURIComponent(plan)}&period=${encodeURIComponent(period)}`,
        { method: "POST" }
      );
      const target = absolutizeBackendUrl(url);
      window.location.assign(target);
    } catch (e) {
      console.error("checkout failed:", e);
      setStatus("error");
      const msg = e?.data?.message || e?.message || "Nu s-a putut porni plata.";
      setErr(msg);
    }
  }

  const sameActivePlan = sub?.status === "active" && sub?.plan?.code === plan;

  function displayPrice(p) {
    const base = p.priceCents || 0;
    if (base === 0) return "Gratuit";
    if (period === "year") {
      const yearlyCents = p.interval === "year" ? base : Math.round(base * 12 * (1 - YEAR_DISCOUNT));
      return `${formatPrice(yearlyCents, p.currency)} / an`;
    }
    return `${formatPrice(base, p.currency)} / lună`;
  }

  return (
    <div className={styles.form}>
      <header className={styles.header} style={{ display:"flex", alignItems:"center", gap:12, justifyContent:"space-between", flexWrap:"wrap" }}>
        <h2 className={styles.cardTitle} style={{ margin:0 }}>Plată abonament</h2>
        {subLoading ? (
          <span className={styles.badgeWait}>Se încarcă abonamentul curent…</span>
        ) : sub?.status === "active" ? (
          <span className={styles.badgeOk}>
            Plan curent: {sub.plan?.name || sub.plan?.code}
            {sub?.endAt ? ` • valabil până la ${new Date(sub.endAt).toLocaleDateString("ro-RO")}` : ""}
          </span>
        ) : (
          <span className={styles.help}>Nu ai un abonament activ.</span>
        )}
      </header>

      <div style={{ display:"flex", gap:8, alignItems:"center", marginBottom:8 }}>
        <div className={styles.help}>Perioadă de facturare:</div>
        <div style={{ display:"inline-flex", border: "1px solid var(--color-border)", borderRadius: 8, overflow:"hidden" }}>
          <button type="button" onClick={() => changePeriod("month")} className={styles.tab + " " + (period === "month" ? styles.tabActive : "")} style={{ border: 0, borderRadius: 0 }}>
            Lunar
          </button>
          <button type="button" onClick={() => changePeriod("year")} className={styles.tab + " " + (period === "year" ? styles.tabActive : "")} style={{ border: 0, borderRadius: 0 }} title={`- ${Math.round(YEAR_DISCOUNT * 100)}% față de lunar`}>
            Anual (−{Math.round(YEAR_DISCOUNT * 100)}%)
          </button>
        </div>
      </div>

      {plansErr && <div className={styles.error} role="alert">{plansErr}</div>}

      {plansLoading ? (
        <div className={styles.card}>Se încarcă planurile…</div>
      ) : (
        <div className={styles.grid} style={{ gridTemplateColumns: "repeat(auto-fit,minmax(250px,1fr))" }}>
          {plans.map((p) => {
            const selected = plan === p.code;
            const { productsBps, servicesBps } = p.fees || {};
            return (
              <label key={p.id || p.code} className={styles.card} style={{ cursor: "pointer", borderColor: selected ? "var(--color-primary)" : "var(--color-border)", boxShadow: selected ? "0 0 0 2px rgba(247,140,61,0.15)" : "none", position: "relative" }}>
                {p.popular && (
                  <span className={styles.badgeWait} style={{ position: "absolute", top: 10, right: 12, fontWeight: 600 }}>
                    Popular
                  </span>
                )}

                <div className={styles.fieldGroup} style={{ marginBottom: 6 }}>
                  <strong style={{ fontSize: "1.05rem" }}>{p.name}</strong>
                  <div style={{ fontSize: "0.95rem", marginTop: 4 }}>{displayPrice(p)}</div>
                </div>

                <div style={{ display:"flex", gap:8, flexWrap:"wrap", margin: "4px 0 8px" }}>
                  <span className={styles.help}>Produse: {bpsToPct(productsBps || 0)}</span>
                  <span className={styles.help}>Servicii: {bpsToPct(servicesBps || 0)}</span>
                </div>

                {Array.isArray(p.features) && p.features.length > 0 && (
                  <ul style={{ margin: "6px 0 10px 18px" }}>
                    {p.features.slice(0, 6).map((f, i) => (
                      <li key={i} style={{ fontSize:"0.9rem" }}>{f}</li>
                    ))}
                    {p.features.length > 6 && <li style={{ color:"#6b7280" }}>… și altele</li>}
                  </ul>
                )}

                <div className={styles.fieldGroup} style={{ marginTop: "auto", display: "flex", alignItems: "center", gap: 8 }}>
                  <input type="radio" name="plan" value={p.code} checked={selected} onChange={() => { setPlan(p.code); ss.set(KEY_PLAN, p.code); }} />
                  <span>Alege {p.name}</span>
                </div>

                {sub?.status === "active" && sub.plan?.code === p.code && (
                  <small className={styles.help} style={{ marginTop: 8 }}>Planul tău actual</small>
                )}
              </label>
            );
          })}
        </div>
      )}

      {err && <div className={styles.error} role="alert" style={{ marginTop: 8 }}>{err}</div>}

      <div style={{ marginTop: 12, display:"flex", gap:8, alignItems:"center", flexWrap:"wrap" }}>
        <button
          className={styles.primaryBtn}
          onClick={startCheckout}
          disabled={status === "processing" || sameActivePlan}
          type="button"
          title={sameActivePlan ? "Ești deja pe acest plan" : undefined}
        >
          {status === "processing" ? "Se redirecționează…" : sameActivePlan ? "Plan activ" : "Plătește / Activează"}
        </button>
        <small className={styles.help}>
          Prețurile afișate nu includ comisionul procesatorului de plăți. Comisioanele platformei se aplică per plan.
        </small>
      </div>
    </div>
  );
}

export default function PaymentTab({ obSessionId }) {
  return (
    <div role="tabpanel" className={styles.tabPanel} aria-labelledby="tab-plata">
      <SubscriptionPayment obSessionId={obSessionId} />
    </div>
  );
}
