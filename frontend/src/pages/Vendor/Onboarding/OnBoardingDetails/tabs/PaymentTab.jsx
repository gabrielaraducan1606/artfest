import { useEffect, useMemo, useState } from "react";
import { api } from "../../../../../lib/api";
import styles from "./css/PaymentTab.module.css";
import { useCurrentSubscription } from "../hooks/useCurrentSubscriptionBanner.js";

/* ============================ Constante ============================ */
const TRIAL_DAYS = 30;
const YEAR_DISCOUNT = 2 / 12; // ~16.6667%

const LEGAL_LINKS = {
  vendorTerms: "/acord-vanzatori",
  billingTerms: "/abonamente-si-facturare",
  privacy: "/confidentialitate-vendori",
};

const CHECKOUT_LEGAL_NOTE =
  "Prin apăsarea butonului de mai sus, confirmi că ai citit și accepți termenii abonamentului, condițiile de facturare și politica de confidențialitate aplicabilă și înțelegi că selectarea unui plan plătit implică o obligație de plată.";

const TRIAL_NOTE =
  "Perioada de probă se aplică doar la prima activare eligibilă. Verifică termenii abonamentului pentru a vedea dacă, la finalul trial-ului, abonamentul devine plătit automat sau necesită o confirmare suplimentară.";

const CANCELLATION_NOTE =
  "Anularea poate produce dezactivarea imediată a magazinelor tale, conform regulilor abonamentului și politicii de facturare.";

const PAYMENT_PROCESSOR_NOTE =
  "Comisioanele procesatorului de plăți nu sunt incluse în prețurile de mai sus și pot fi percepute separat de procesator, conform propriilor condiții.";

const FEES = {
  basic: { productsBps: 1200, minFeeCentsPerOrder: 0 },
  pro: { productsBps: 800, minFeeCentsPerOrder: 0 },
  premium: { productsBps: 500, minFeeCentsPerOrder: 0 },
};

const DEFAULT_PLANS = [
  {
    id: "local-basic",
    code: "basic",
    name: "Basic",
    priceCents: 0,
    currency: "RON",
    interval: "month",
    isActive: true,
    popular: false,
    trialDays: 0,
    features: [
      "1 magazin inclus",
      "Max. 15 produse",
      "Chat cu clienții (mesaje simple)",
      "Recenzii",
      "Profil public",
      "3 lead-uri / lună",
      "Suport standard",
    ],
    meta: {
      commissions: FEES.basic,
      limits: { products: 15, stores: 1 },
      capabilities: {
        shareLink: true,
        chat: true,
        attachments: false,
        advancedChat: false,
        serviceSalesEnabled: false,
      },
    },
  },
  {
    id: "local-pro",
    code: "pro",
    name: "Pro",
    priceCents: 5900,
    currency: "RON",
    interval: "month",
    isActive: true,
    popular: false,
    trialDays: TRIAL_DAYS,
    features: [
      "2 magazine incluse",
      "Produse nelimitate",
      "Chat + follow-up",
      "Note interne",
      "Atașamente",
      "10 lead-uri / lună",
      "Suport prioritar",
    ],
    meta: {
      commissions: FEES.pro,
      limits: { products: -1, stores: 2 },
      capabilities: {
        shareLink: true,
        chat: true,
        attachments: true,
        advancedChat: false,
        serviceSalesEnabled: false,
      },
    },
  },
  {
    id: "local-premium",
    code: "premium",
    name: "Premium",
    priceCents: 14900,
    currency: "RON",
    interval: "month",
    isActive: true,
    popular: true,
    trialDays: TRIAL_DAYS,
    features: [
      "3 magazine incluse",
      "Produse nelimitate",
      "CRM complet (note + follow-up + atașamente)",
      "Badge verificat",
      "Prioritate în listări",
      "Statistici (vizualizări, lead-uri)",
      "Lead-uri nelimitate",
      "Suport dedicat",
    ],
    meta: {
      commissions: FEES.premium,
      limits: { products: -1, stores: 3 },
      capabilities: {
        shareLink: true,
        chat: true,
        attachments: true,
        advancedChat: true,
        serviceSalesEnabled: false,
      },
    },
  },
];

/* ============================ Utils ============================ */
function formatPrice(cents, currency = "RON") {
  if (cents === 0) return "Gratuit";
  try {
    return new Intl.NumberFormat("ro-RO", {
      style: "currency",
      currency,
    }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}

function bpsToPct(bps) {
  return (bps / 100).toFixed(bps % 100 ? 2 : 0) + "%";
}

function absolutizeUrl(url) {
  if (/^https?:\/\//i.test(url)) return url;

  const API_BASE = (import.meta.env?.VITE_API_URL || "http://localhost:5000").replace(
    /\/+$/,
    ""
  );
  const APP_BASE = (import.meta.env?.VITE_APP_URL || window.location.origin).replace(
    /\/+$/,
    ""
  );

  const base = url.startsWith("/api/") ? API_BASE : APP_BASE;
  return `${base}${url.startsWith("/") ? "" : "/"}${url}`;
}

function getLegalUrl(path) {
  return absolutizeUrl(path);
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
        const items =
          Array.isArray(d?.items) && d.items.length ? d.items : DEFAULT_PLANS;

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
      const fallback = FEES[p.code] || FEES.basic;

      const trialDays =
        typeof p?.trialDays === "number"
          ? p.trialDays
          : typeof p?.meta?.trialDays === "number"
            ? p.meta.trialDays
            : p.priceCents > 0
              ? TRIAL_DAYS
              : 0;

      const storeLimit = p?.meta?.limits?.stores ?? null;

      return {
        ...p,
        trialDays,
        popular: p.popular ?? p.code === "premium",
        fees: {
          productsBps: fromMeta?.productsBps ?? fallback.productsBps,
          minFeeCentsPerOrder:
            fromMeta?.minFeeCentsPerOrder ?? fallback.minFeeCentsPerOrder,
        },
        serviceSalesEnabled: !!p?.meta?.capabilities?.serviceSalesEnabled,
        shareLinkEnabled: p?.meta?.capabilities?.shareLink !== false,
        isActive: p.isActive !== false,
        storeLimit,
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

  const ss = useMemo(() => {
    return {
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
          // ignore
        }
      },
    };
  }, []);

  const [period, setPeriod] = useState(() =>
    ss.get(KEY_PERIOD) === "year" ? "year" : "month"
  );
  const [plan, setPlan] = useState(() => ss.get(KEY_PLAN) || "premium");
  const [expanded, setExpanded] = useState({});
  const [status, setStatus] = useState("idle");
  const [err, setErr] = useState("");

  useEffect(() => {
    if (sub?.plan?.code) {
      setPlan(sub.plan.code);
      ss.set(KEY_PLAN, sub.plan.code);
    }
  }, [sub?.plan?.code, KEY_PLAN, ss]);

  useEffect(() => {
    if (!plans.length) return;

    const current = plans.find((p) => p.code === plan);
    if (!current || current.isActive === false) {
      const firstActive = plans.find((p) => p.isActive !== false) || plans[0];
      setPlan(firstActive.code);
      ss.set(KEY_PLAN, firstActive.code);
    }
  }, [plans, plan, KEY_PLAN, ss]);

  const selectedPlan = useMemo(
    () => plans.find((p) => p.code === plan) || null,
    [plans, plan]
  );

  function changePeriod(next) {
    setPeriod(next);
    ss.set(KEY_PERIOD, next);
  }

  function detectWalletHints() {
    let applePay = "0";
    let googlePay = "0";

    try {
      const w = typeof window !== "undefined" ? window : undefined;
      const canApplePay = !!(
        w &&
        w.ApplePaySession &&
        typeof w.ApplePaySession.canMakePayments === "function" &&
        w.ApplePaySession.canMakePayments()
      );
      if (canApplePay) applePay = "1";
    } catch {
      // ignore
    }

    try {
      const w = typeof window !== "undefined" ? window : undefined;
      const canGooglePay = !!(
        w &&
        w.PaymentRequest &&
        /Android|Chrome/i.test(navigator.userAgent)
      );
      if (canGooglePay) googlePay = "1";
    } catch {
      // ignore
    }

    return { applePay, googlePay };
  }

  async function startCheckout() {
    try {
      if (!selectedPlan || selectedPlan.isActive === false) return;

      setStatus("processing");
      setErr("");

      const { applePay, googlePay } = detectWalletHints();

      const resp = await api(
        `/api/billing/checkout?plan=${encodeURIComponent(
          plan
        )}&period=${encodeURIComponent(period)}&applePay=${applePay}&googlePay=${googlePay}`,
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

  async function cancelSubscription() {
    if (!sub?.plan?.code) return;

    const ok = window.confirm(
      "Sigur vrei să anulezi abonamentul?\n\nMagazinele tale pot deveni inactive imediat, conform regulilor abonamentului și politicii de facturare."
    );
    if (!ok) return;

    try {
      setStatus("canceling");
      setErr("");

      const resp = await api("/api/vendors/me/subscription/cancel", {
        method: "POST",
      });
      setSub(resp?.subscription ?? null);
    } catch (e) {
      console.error("subscription cancel failed:", e);
      setStatus("error");
      const msg =
        e?.data?.message ||
        e?.message ||
        "Nu am putut anula abonamentul. Încearcă din nou.";
      setErr(msg);
    } finally {
      setStatus("idle");
    }
  }

  const sameActivePlan = !!sub?.plan?.code && sub.plan.code === plan;
  const daysLeft = sub?.endAt
    ? Math.ceil((new Date(sub.endAt) - new Date()) / (1000 * 60 * 60 * 24))
    : null;
  const isRenewSoon = typeof daysLeft === "number" && daysLeft <= 7;
  const isFreePlan =
    selectedPlan?.code === "basic" || (selectedPlan?.priceCents ?? 0) === 0;

  function displayPrice(p) {
    const base = p.priceCents || 0;
    if (base === 0) return "Gratuit";

    if (period === "year") {
      const yearlyCents =
        p.interval === "year"
          ? base
          : Math.round(base * 12 * (1 - YEAR_DISCOUNT));
      return `${formatPrice(yearlyCents, p.currency)} / an`;
    }

    return `${formatPrice(base, p.currency)} / lună`;
  }

  function shouldShowTrialBadge(p) {
    const trialDays = typeof p?.trialDays === "number" ? p.trialDays : 0;
    const base = p?.priceCents || 0;
    return p.isActive !== false && base > 0 && trialDays > 0;
  }

  const disableCheckout =
    status === "processing" ||
    status === "canceling" ||
    (sameActivePlan && !isRenewSoon) ||
    !selectedPlan ||
    selectedPlan.isActive === false;

  const FEATURE_COLLAPSE_AT = 8;

  const checkoutButtonLabel =
    status === "processing"
      ? "Se redirecționează…"
      : isFreePlan
        ? "Activează planul gratuit"
        : sameActivePlan
          ? isRenewSoon
            ? "Confirmă și plătește prelungirea"
            : "Plan activ"
          : shouldShowTrialBadge(selectedPlan)
            ? "Activează trial-ul"
            : "Confirmă și plătește abonamentul";

  return (
    <div className={styles.form}>
      <header className={styles.header}>
        <h2 className={styles.cardTitle}>Plată abonament</h2>

        {subLoading ? (
          <span className={styles.badgeWait}>Se încarcă abonamentul curent…</span>
        ) : sub?.status === "active" ? (
          <span className={styles.badgeOk}>
            Plan curent: {sub.plan?.name || sub.plan?.code}
            {sub?.plan?.priceCents === 0
              ? " • plan gratuit activ"
              : sub?.endAt
                ? ` • valabil până la ${new Date(sub.endAt).toLocaleDateString("ro-RO")}`
                : ""}
            {sub?.plan?.priceCents !== 0 && typeof daysLeft === "number"
              ? ` • ${daysLeft} zile rămase`
              : ""}
          </span>
        ) : (
          <span className={styles.help}>Nu ai un abonament activ.</span>
        )}
      </header>

      <div className={styles.periodRow}>
        <div className={styles.help}>Perioadă de facturare:</div>
        <div
          className={styles.periodToggle}
          role="tablist"
          aria-label="Perioadă de facturare"
        >
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
          <strong>{selectedPlan.trialDays || TRIAL_DAYS} zile gratuite</strong> la
          activare — verifică termenii abonamentului pentru ce se întâmplă la
          finalul perioadei de probă.
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
            const visibleFeats =
              showToggle && !isExpanded ? feats.slice(0, FEATURE_COLLAPSE_AT) : feats;
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
                title={disabled ? "Plan indisponibil momentan" : undefined}
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
                  <span className={styles.badgeWait + " " + styles.cardBadge}>
                    Cel mai popular
                  </span>
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
                    <strong>{p.trialDays || TRIAL_DAYS} zile gratuite</strong> la
                    activare
                  </div>
                )}

                <div className={styles.feesRow} title="Comisioane platformă">
                  <span className={styles.help}>
                    Produse: {bpsToPct(productsBps || 0)}
                    {typeof minFeeCentsPerOrder === "number" &&
                    minFeeCentsPerOrder > 0
                      ? ` (min. ${formatPrice(
                          minFeeCentsPerOrder,
                          p.currency || "RON"
                        )} / comandă)`
                      : ""}
                  </span>

                  <span className={`${styles.help} ${styles.muted}`}>
                    Servicii: indisponibil momentan
                  </span>
                </div>

                {p.shareLinkEnabled && (
                  <div className={styles.shareHint}>
                    Include <strong>link de distribuire</strong> pentru promovare
                    rapidă.
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
                          e.preventDefault();
                          e.stopPropagation();
                          setExpanded((prev) => ({
                            ...prev,
                            [p.code]: !prev[p.code],
                          }));
                        }}
                        onMouseDown={(e) => e.stopPropagation()}
                        onPointerDown={(e) => e.stopPropagation()}
                        aria-expanded={isExpanded}
                        aria-label={
                          isExpanded
                            ? "Arată mai puține beneficii"
                            : "Vezi toate beneficiile"
                        }
                      >
                        {isExpanded
                          ? "Arată mai puțin"
                          : `Vezi toate (${feats.length})`}
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
          {checkoutButtonLabel}
        </button>

        {sub?.status === "active" && (
          <button
            type="button"
            onClick={cancelSubscription}
            className={styles.secondaryBtn}
            disabled={status === "processing" || status === "canceling"}
            title="Abonamentul poate fi oprit conform politicii de anulare și regulilor de facturare."
          >
            {status === "canceling" ? "Se anulează…" : "Anulează abonamentul"}
          </button>
        )}

        <div className={styles.legalBox ?? ""} style={{ width: "100%" }}>
          <small className={styles.help} style={{ display: "block", marginTop: 4 }}>
            {PAYMENT_PROCESSOR_NOTE}
          </small>

          {selectedPlan && shouldShowTrialBadge(selectedPlan) && (
            <small className={styles.help} style={{ display: "block", marginTop: 6 }}>
              {TRIAL_NOTE}
            </small>
          )}

          {sub?.status === "active" && (
            <small className={styles.help} style={{ display: "block", marginTop: 6 }}>
              {CANCELLATION_NOTE}
            </small>
          )}

          <small className={styles.help} style={{ display: "block", marginTop: 6 }}>
            {CHECKOUT_LEGAL_NOTE}
          </small>

          <small className={styles.help} style={{ display: "block", marginTop: 8 }}>
            <a href={getLegalUrl(LEGAL_LINKS.vendorTerms)} target="_blank" rel="noreferrer">
              Termeni abonament / Acord vendor
            </a>
            {" • "}
            <a href={getLegalUrl(LEGAL_LINKS.billingTerms)} target="_blank" rel="noreferrer">
              Politica de anulare și facturare
            </a>
            {" • "}
            <a href={getLegalUrl(LEGAL_LINKS.privacy)} target="_blank" rel="noreferrer">
              Politica de confidențialitate
            </a>
          </small>
        </div>
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