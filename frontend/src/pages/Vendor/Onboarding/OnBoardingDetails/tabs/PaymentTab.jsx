import { useEffect, useMemo, useState } from "react";
import { api } from "../../../../../lib/api";
import styles from "./css/PaymentTab.module.css";
import { useCurrentSubscription } from "../hooks/useCurrentSubscriptionBanner.js";

/* ============================ Constante ============================ */
// ✅ 1 lună gratuită la activare (trial)
const TRIAL_DAYS = 30;

// 2 luni gratis la anual (ex: 49*12=588 -> 490)
const YEAR_DISCOUNT = 2 / 12; // ~16.6667%

// fallback FEES (doar dacă backend-ul nu trimite meta.commissions)
const FEES = {
  starter: { productsBps: 1200, minFeeCentsPerOrder: 1000 }, // 12%, min 10 RON / comandă
  basic: { productsBps: 1000, minFeeCentsPerOrder: 800 }, // 10%, min 8 RON
  pro: { productsBps: 800, minFeeCentsPerOrder: 600 }, // 8%,  min 6 RON
  business: { productsBps: 600, minFeeCentsPerOrder: 500 }, // 6%,  min 5 RON
};

// fallback local (în caz că backend-ul nu are încă seed / meta)
// — aliniat 1:1 cu planurile stabilite
const DEFAULT_PLANS = [
  {
    id: "local-starter",
    code: "starter",
    name: "Starter",
    priceCents: 0,
    currency: "RON",
    interval: "month",
    isActive: true,
    popular: false,
    trialDays: TRIAL_DAYS,
    features: [
      "Profil public de vânzător",
      "Listare produse (max. 25)",
      "Vânzare direct în platformă",
      "Recenzii clienți",
      "Chat cu clienții (mesaje simple)",
      "Notificări comenzi",
      "1 membru, 1 locație",
      "Suport standard",
    ],
    meta: {
      commissions: FEES.starter,
      limits: { products: 25, members: 1, locations: 1 },
      capabilities: {
        shareLink: true,
        chat: true,
        chatNotes: false,
        chatLeadStatus: false,
        chatFollowUps: false,
        analyticsVisitors: false,
        discountCodes: false,
        autoInvoicing: false,
        invoicingAdvanced: false,
        courierPickup: false,
        courierScheduling: false,
        courierTracking: false,
        marketingEligible: false,
        marketingPriority: false,
        marketingDedicated: false,
        serviceSalesEnabled: false,
      },
    },
  },
  {
    id: "local-basic",
    code: "basic",
    name: "Basic",
    priceCents: 4900,
    currency: "RON",
    interval: "month",
    isActive: true,
    popular: true,
    trialDays: TRIAL_DAYS,
    features: [
      "TOT din Starter",
      "Listare produse extinsă (max. 150)",
      "Discount codes",
      "Chat avansat: note interne",
      "Status lead (nou / ofertat / confirmat / livrat)",
      "Notificări avansate",
      "Analytics vizitatori (zi / lună)",
      "Facturare automată: factură PDF trimisă clientului",
      "TVA corect (plătitor / neplătitor)",
      "Curier automat: AWB + ridicare de la adresă (cost per livrare)",
      "Eligibil pentru promovare în campaniile platformei (Meta & Google – selecție ne-garantată)",
      "2 membri, 2 locații",
      "Suport prioritar (email)",
    ],
    meta: {
      commissions: FEES.basic,
      limits: { products: 150, members: 2, locations: 2 },
      capabilities: {
        shareLink: true,
        chat: true,
        chatNotes: true,
        chatLeadStatus: true,
        chatFollowUps: false,
        analyticsVisitors: true,
        discountCodes: true,
        autoInvoicing: true,
        invoicingAdvanced: false,
        courierPickup: true,
        courierScheduling: false,
        courierTracking: true,
        marketingEligible: true,
        marketingPriority: false,
        marketingDedicated: false,
        serviceSalesEnabled: false,
      },
    },
  },
  {
    id: "local-pro",
    code: "pro",
    name: "Pro",
    priceCents: 9900,
    currency: "RON",
    interval: "month",
    isActive: true,
    popular: false,
    trialDays: TRIAL_DAYS,
    features: [
      "TOT din Basic",
      "Produse nelimitate",
      "Boost în listări",
      "SEO îmbunătățit pentru paginile produselor",
      "Chat complet: note interne + status lead",
      "Follow-up reminders",
      "Istoric lead & comandă",
      "Analytics avansat: perioade custom",
      "Top produse vizitate",
      "Facturare avansată: istoric facturi",
      "Storno / corecții",
      "Logo vendor pe factură",
      "Curier avansat: alegere curier",
      "Programare ridicare",
      "Tracking automat trimis clientului",
      "Istoric livrări",
      "Promovare prioritară (Meta & Google) + rotație mai frecventă în ads",
      "3 membri, multi-locație",
      "Suport prioritar + SLA",
    ],
    meta: {
      commissions: FEES.pro,
      limits: { products: -1, members: 3, locations: -1 },
      capabilities: {
        shareLink: true,
        chat: true,
        chatNotes: true,
        chatLeadStatus: true,
        chatFollowUps: true,
        analyticsVisitors: true,
        discountCodes: true,
        listingBoost: true,
        seoBoost: true,
        autoInvoicing: true,
        invoicingAdvanced: true,
        courierPickup: true,
        courierScheduling: true,
        courierTracking: true,
        marketingEligible: true,
        marketingPriority: true,
        marketingDedicated: false,
        serviceSalesEnabled: false,
      },
    },
  },
  {
    id: "local-business",
    code: "business",
    name: "Business",
    priceCents: 19900,
    currency: "RON",
    interval: "month",
    isActive: false, // ✅ IMPORTANT: se vede, dar e indisponibil
    popular: false,
    trialDays: TRIAL_DAYS,
    features: [
      "TOT din Pro",
      "Multi-brand / multi-store",
      "Membri extinși (5–10)",
      "Export date (CSV / API)",
      "Facturare completă: serii multiple de facturi",
      "Integrare contabilitate (viitor)",
      "Facturare per brand",
      "Curier premium: tarife negociate, ridicare prioritară",
      "Retururi automate",
      "Promovare dedicată: campanii gestionate de platformă",
      "Buget inclus (limită lunară)",
      "Landing dedicat + raport performanță",
      "Account manager dedicat",
      "Early access la funcții noi",
      "Prioritate în campanii sezoniere (nunți)",
    ],
    meta: {
      commissions: FEES.business,
      limits: { products: -1, members: 10, locations: -1 },
      capabilities: {
        shareLink: true,
        chat: true,
        chatNotes: true,
        chatLeadStatus: true,
        chatFollowUps: true,
        analyticsVisitors: true,
        discountCodes: true,
        listingBoost: true,
        seoBoost: true,
        autoInvoicing: true,
        invoicingAdvanced: true,
        courierPickup: true,
        courierScheduling: true,
        courierTracking: true,
        marketingEligible: true,
        marketingPriority: true,
        marketingDedicated: true,
        serviceSalesEnabled: false,
      },
    },
  },
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

function formatMoney(cents, currency = "RON") {
  try {
    return new Intl.NumberFormat("ro-RO", { style: "currency", currency }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}

function bpsToPct(bps) {
  return (bps / 100).toFixed(bps % 100 ? 2 : 0) + "%";
}

function absolutizeUrl(url) {
  if (/^https?:\/\//i.test(url)) return url;

  const API_BASE = (import.meta.env?.VITE_API_URL || "http://localhost:5000").replace(/\/+$/, "");
  const APP_BASE = (import.meta.env?.VITE_APP_URL || window.location.origin).replace(/\/+$/, "");

  const base = url.startsWith("/api/") ? API_BASE : APP_BASE;
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

        // Important: păstrăm și planurile inactive ca să le putem afișa
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
    return () => {
      alive = false;
    };
  }, []);

  const enriched = useMemo(() => {
    return (plans || []).map((p) => {
      const fromMeta = p?.meta?.commissions || p?.commissions;
      const fallback = FEES[p.code] || FEES.starter;

      const trialDays =
        typeof p?.trialDays === "number"
          ? p.trialDays
          : typeof p?.meta?.trialDays === "number"
            ? p.meta.trialDays
            : TRIAL_DAYS;

      return {
        ...p,
        trialDays,
        popular: p.popular ?? p.code === "basic",
        fees: {
          productsBps: fromMeta?.productsBps ?? fallback.productsBps,
          minFeeCentsPerOrder: fromMeta?.minFeeCentsPerOrder ?? fallback.minFeeCentsPerOrder,
        },
        serviceSalesEnabled: !!p?.meta?.capabilities?.serviceSalesEnabled,
        shareLinkEnabled: p?.meta?.capabilities?.shareLink !== false,
        // normalizare: dacă e undefined, considerăm activ
        isActive: p.isActive !== false,
      };
    });
  }, [plans]);

  return { plans: enriched, loading, err };
}

/* ============================ Componenta ============================ */
function SubscriptionPayment({ obSessionId }) {
  const { plans, loading: plansLoading, err: plansErr } = usePlans();
  const { sub, loading: subLoading, setSub } = useCurrentSubscription();

  const KEY_PLAN = `onboarding.plan:${obSessionId || "default"}`;
  const KEY_PERIOD = `onboarding.period:${obSessionId || "default"}`;
  const ss = {
    get(k) {
      try {
        if (typeof window === "undefined") return null;
        return window.sessionStorage.getItem(k);
      } catch {
        return null;
      }
    },
    set(k, v) {
      try {
        if (typeof window === "undefined") return;
        window.sessionStorage.setItem(k, v);
      } catch {
        /* ignore */
      }
    },
  };

  const [period, setPeriod] = useState(() => (ss.get(KEY_PERIOD) === "year" ? "year" : "month"));
  const [plan, setPlan] = useState(() => ss.get(KEY_PLAN) || "basic");

  // ✅ nou: expand/collapse per plan
  const [expanded, setExpanded] = useState({}); // { [code]: boolean }

  useEffect(() => {
    if (sub?.plan?.code) {
      setPlan(sub.plan.code);
      ss.set(KEY_PLAN, sub.plan.code);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sub?.plan?.code]);

  // ✅ dacă planul selectat nu există sau e inactiv, sărim pe primul activ
  useEffect(() => {
    if (!plans.length) return;

    const current = plans.find((p) => p.code === plan);
    if (!current || current.isActive === false) {
      const firstActive = plans.find((p) => p.isActive !== false) || plans[0];
      setPlan(firstActive.code);
      ss.set(KEY_PLAN, firstActive.code);
    }
  }, [plans, plan]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedPlan = useMemo(() => plans.find((p) => p.code === plan) || null, [plans, plan]);

  const [status, setStatus] = useState("idle");
  const [err, setErr] = useState("");

  function changePeriod(next) {
    setPeriod(next);
    ss.set(KEY_PERIOD, next);
  }

  function detectWalletHints() {
    let applePay = "0";
    let googlePay = "0";

    try {
      const w = typeof window !== "undefined" ? window : undefined;
      const canApplePay =
        !!(w && w.ApplePaySession && typeof w.ApplePaySession.canMakePayments === "function" && w.ApplePaySession.canMakePayments());
      if (canApplePay) applePay = "1";
    } catch {
      /* ignore */
    }

    try {
      const w = typeof window !== "undefined" ? window : undefined;
      const canGooglePay = !!(w && w.PaymentRequest && /Android|Chrome/i.test(navigator.userAgent));
      if (canGooglePay) googlePay = "1";
    } catch {
      /* ignore */
    }

    return { applePay, googlePay };
  }

  async function startCheckout() {
    try {
      // ✅ safety: nu pornim checkout pe plan indisponibil
      if (!selectedPlan || selectedPlan.isActive === false) return;

      setStatus("processing");
      setErr("");

      const { applePay, googlePay } = detectWalletHints();

      const resp = await api(
        `/api/billing/checkout?plan=${encodeURIComponent(plan)}&period=${encodeURIComponent(period)}&applePay=${applePay}&googlePay=${googlePay}`,
        { method: "POST" }
      );

      if (resp?.kind === "free_activated" && resp?.url) {
        window.location.assign(absolutizeUrl(resp.url));
        return;
      }

      if (resp?.kind === "provider_redirect") {
        if (resp.url) {
          window.location.assign(absolutizeUrl(resp.url));
          return;
        }
        if (resp.form?.action) {
          const form = document.createElement("form");
          form.method = resp.form.method || "POST";
          form.action = absolutizeUrl(resp.form.action);
          const hid = document.createElement("input");
          hid.type = "hidden";
          hid.name = "subId";
          hid.value = resp.subscriptionId || "";
          form.appendChild(hid);
          document.body.appendChild(form);
          form.submit();
          return;
        }
      }

      if (resp?.url) {
        window.location.assign(absolutizeUrl(resp.url));
        return;
      }

      throw new Error("Răspuns de checkout neașteptat.");
    } catch (e) {
      console.error("checkout failed:", e);
      setStatus("error");
      const msg = e?.data?.message || e?.message || "Nu s-a putut porni plata.";
      setErr(msg);
    } finally {
      setStatus("idle");
    }
  }

  const sameActivePlan = sub?.status === "active" && sub?.plan?.code === plan;
  const daysLeft = sub?.endAt ? Math.ceil((new Date(sub.endAt) - new Date()) / (1000 * 60 * 60 * 24)) : null;
  const isRenewSoon = typeof daysLeft === "number" && daysLeft <= 7;

  function displayPrice(p) {
    const base = p.priceCents || 0;
    if (base === 0) return "Gratuit";
    if (period === "year") {
      const yearlyCents = p.interval === "year" ? base : Math.round(base * 12 * (1 - YEAR_DISCOUNT));
      return `${formatPrice(yearlyCents, p.currency)} / an`;
    }
    return `${formatPrice(base, p.currency)} / lună`;
  }

  function shouldShowTrialBadge(p) {
    const trialDays = typeof p?.trialDays === "number" ? p.trialDays : 0;
    const base = p?.priceCents || 0;
    // trial doar pt plătite + active
    return p.isActive !== false && base > 0 && trialDays >= 28;
  }

  async function cancelSubscription() {
    if (!sub || sub.status !== "active") return;

    const ok = window.confirm(
      "Sigur vrei să anulezi abonamentul?\n\nMagazinele tale vor deveni inactive imediat și nu vor mai apărea în platformă."
    );
    if (!ok) return;

    try {
      setStatus("canceling");
      setErr("");
      const resp = await api("/api/vendors/me/subscription/cancel", { method: "POST" });
      setSub(resp?.subscription ?? null);
    } catch (e) {
      console.error("subscription cancel failed:", e);
      setStatus("error");
      const msg = e?.data?.message || e?.message || "Nu am putut anula abonamentul. Încearcă din nou.";
      setErr(msg);
    } finally {
      setStatus("idle");
    }
  }

  const disableCheckout =
    status === "processing" ||
    status === "canceling" ||
    (sameActivePlan && !isRenewSoon) ||
    !selectedPlan ||
    selectedPlan.isActive === false;

  const FEATURE_COLLAPSE_AT = 8;

  return (
    <div className={styles.form}>
      <header className={styles.header}>
        <h2 className={styles.cardTitle}>Plată abonament</h2>

        {subLoading ? (
          <span className={styles.badgeWait}>Se încarcă abonamentul curent…</span>
        ) : sub?.status === "active" ? (
          <span className={styles.badgeOk}>
            Plan curent: {sub.plan?.name || sub.plan?.code}
            {sub?.endAt ? ` • valabil până la ${new Date(sub.endAt).toLocaleDateString("ro-RO")}` : ""}
            {typeof daysLeft === "number" ? ` • ${daysLeft} zile rămase` : ""}
          </span>
        ) : (
          <span className={styles.help}>Nu ai un abonament activ.</span>
        )}
      </header>

      <div className={styles.periodRow}>
        <div className={styles.help}>Perioadă de facturare:</div>
        <div className={styles.periodToggle} role="tablist" aria-label="Perioadă de facturare">
          <button
            type="button"
            onClick={() => changePeriod("month")}
            className={styles.tab + " " + (period === "month" ? styles.tabActive : "")}
            aria-pressed={period === "month"}
          >
            Lunar
          </button>
          <button
            type="button"
            onClick={() => changePeriod("year")}
            className={styles.tab + " " + (period === "year" ? styles.tabActive : "")}
            aria-pressed={period === "year"}
            title={`- ${Math.round(YEAR_DISCOUNT * 100)}% față de lunar`}
          >
            Anual (−{Math.round(YEAR_DISCOUNT * 100)}%)
          </button>
        </div>
      </div>

      {selectedPlan && shouldShowTrialBadge(selectedPlan) && (
        <div className={styles.shareHint} style={{ marginBottom: 10 }}>
          <strong>1 lună gratuită</strong> la activare — începi să plătești după perioada de probă.
        </div>
      )}

      {plansErr && (
        <div className={styles.error} role="alert">
          {plansErr}
        </div>
      )}

      {plansLoading ? (
        <div className={styles.card}>Se încarcă planurile…</div>
      ) : (
        <div className={styles.grid}>
          {plans.map((p) => {
            const selected = plan === p.code;
            const disabled = p.isActive === false;
            const { productsBps, minFeeCentsPerOrder } = p.fees || {};
            const feats = Array.isArray(p.features) ? p.features : [];
            const isExpanded = !!expanded[p.code];
            const showToggle = feats.length > FEATURE_COLLAPSE_AT;
            const visibleFeats = showToggle && !isExpanded ? feats.slice(0, FEATURE_COLLAPSE_AT) : feats;

            const radioId = `plan-${p.code}`;

const onSelectPlan = () => {
  if (disabled) return;
  setPlan(p.code);
  ss.set(KEY_PLAN, p.code);
};

return (
  <div
    key={p.id || p.code}
    className={[
      styles.card,
      selected ? styles.cardSelected : "",
      disabled ? styles.cardDisabled : "",
    ].join(" ")}
    title={disabled ? "Indisponibil momentan" : undefined}
    role="radio"
    aria-checked={selected}
    aria-disabled={disabled}
    tabIndex={disabled ? -1 : 0}
    onClick={onSelectPlan}
    onKeyDown={(e) => {
      if (disabled) return;
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onSelectPlan();
      }
    }}
  >
    {p.popular && !disabled && (
      <span className={styles.badgeWait + " " + styles.cardBadge}>Popular</span>
    )}

    {disabled && (
      <span className={styles.badgeMuted + " " + styles.cardBadge}>
        Indisponibil momentan
      </span>
    )}

    <div className={styles.cardTop}>
      <div className={styles.planName}>{p.name}</div>
      <div className={styles.planPrice}>{displayPrice(p)}</div>
    </div>

    {shouldShowTrialBadge(p) && (
      <div className={styles.shareHint} style={{ marginTop: 8 }}>
        <strong>1 lună gratuită</strong> la activare
      </div>
    )}

    <div className={styles.feesRow} title="Comisioane platformă">
      <span className={styles.help}>
        Produse: {bpsToPct(productsBps || 0)}
        {typeof minFeeCentsPerOrder === "number" && minFeeCentsPerOrder > 0
          ? ` (min. ${formatMoney(minFeeCentsPerOrder, p.currency || "RON")} / comandă)`
          : ""}
      </span>

      <span className={`${styles.help} ${styles.muted}`}>
        Servicii: indisponibil momentan
      </span>
    </div>

    {p.shareLinkEnabled && (
      <div className={styles.shareHint}>
        Include <strong>link de distribuire</strong> pentru promovare rapidă.
      </div>
    )}

    {feats.length > 0 && (
      <>
        <ul className={styles.featuresList}>
          {visibleFeats.map((f, i) => (
            <li key={i}>{f}</li>
          ))}
        </ul>

        {showToggle && (
          <button
            type="button"
            className={styles.moreBtn}
            onClick={(e) => {
              // ✅ oprește selectarea planului
              e.preventDefault();
              e.stopPropagation();
              setExpanded((prev) => ({ ...prev, [p.code]: !prev[p.code] }));
            }}
            onMouseDown={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            aria-expanded={isExpanded}
            aria-label={isExpanded ? "Arată mai puține beneficii" : "Vezi toate beneficiile"}
          >
            {isExpanded ? "Arată mai puțin" : `Vezi toate (${feats.length})`}
            <span
              aria-hidden="true"
              className={[
                styles.moreChevron,
                isExpanded ? styles.moreChevronUp : "",
              ].join(" ")}
            >
              ▾
            </span>
          </button>
        )}
      </>
    )}

    <div className={styles.pickRow}>
      <input
        id={radioId}
        type="radio"
        name="plan"
        value={p.code}
        checked={selected}
        disabled={disabled}
        onChange={onSelectPlan}
        onClick={(e) => e.stopPropagation()}
      />
      <label htmlFor={radioId} onClick={(e) => e.stopPropagation()}>
        {disabled ? "În curând" : `Alege ${p.name}`}
      </label>
    </div>

    {sub?.status === "active" && sub.plan?.code === p.code && (
      <small className={styles.help}>Planul tău actual</small>
    )}
  </div>
);

          })}
        </div>
      )}

      {err && (
        <div className={styles.error} role="alert" style={{ marginTop: 8 }}>
          {err}
        </div>
      )}

      <div className={styles.actionsRow}>
        <button
          className={styles.primaryBtn}
          onClick={startCheckout}
          disabled={disableCheckout}
          type="button"
          title={
            selectedPlan?.isActive === false
              ? "Plan indisponibil momentan"
              : sameActivePlan && !isRenewSoon
                ? "Ești deja pe acest plan"
                : undefined
          }
        >
          {status === "processing"
            ? "Se redirecționează…"
            : sameActivePlan
              ? isRenewSoon
                ? "Reînnoiește / Prelungește"
                : "Plan activ"
              : "Plătește / Activează"}
        </button>

        {sub?.status === "active" && (
          <button
            type="button"
            onClick={cancelSubscription}
            className={styles.secondaryBtn}
            disabled={status === "processing" || status === "canceling"}
            title="Abonamentul va fi oprit, iar magazinele tale vor deveni inactive."
          >
            {status === "canceling" ? "Se anulează…" : "Anulează abonamentul"}
          </button>
        )}

        <small className={styles.help}>
          Prețurile afișate nu includ comisionul procesatorului de plăți. Comisioanele platformei se aplică per plan.
          {selectedPlan && shouldShowTrialBadge(selectedPlan) && (
            <>
              {" "}
              • <strong>1 lună gratuită</strong> se aplică la prima activare.
            </>
          )}
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
