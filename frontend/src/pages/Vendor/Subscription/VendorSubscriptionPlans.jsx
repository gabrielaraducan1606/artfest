// src/pages/Vendor/Subscription/VendorSubscriptionPlans.jsx
import React, { useState } from "react";
import { Link } from "react-router-dom";
import {
  Check,
  Minus,
  ChevronDown,
  Clock,
  Loader2,
  Palette,
  ArrowRight,
  Info,
  Sparkles,
} from "lucide-react";
import { api } from "../../../lib/api";
import styles from "./VendorSubscriptionPlans.module.css";
import useVendorSubscriptionStatus from "./useVendorSubscriptionStatus.js";
import {
  SUBSCRIPTION_PLANS,
  PLAN_STATUS,
  PLANS_FOOTNOTE,
  COMPARISON_GROUPS,
  CUSTOMIZATION_SERVICES,
  CUSTOMIZATION_AVAILABILITY_NOTE,
  AI_CREDITS_NOTE,
  formatBpsPercent,
} from "./subscriptionPlansContent.js";
import { VENDOR_STORE_DESIGN_URL } from "../../../config/vendorNavigation.js";

/*
 * „Abonamentul meu” (Setări > tab subscription) - etapa 1, doar interfață.
 *
 * - Planul afișat este cel real (GET /api/vendors/me/subscription/status).
 * - PRO / BUSINESS sunt „În pregătire”: fără butoane de activare/plată.
 * - Personalizarea magazinului e un serviciu SEPARAT de abonamente.
 * - Singura acțiune este activarea Basic GRATUIT, păstrată identic din
 *   vechiul PaymentTab, doar pentru cazul în care vendorul nu are niciun
 *   abonament activ (POST /api/billing/checkout?plan=basic - backend-ul
 *   refuză orice alt plan).
 */
export default function VendorSubscriptionPlans() {
  const { view, error, reload } = useVendorSubscriptionStatus();
  const [compareOpen, setCompareOpen] = useState(false);

  return (
    <div className={styles.page}>
      <CurrentPlanCard view={view} error={error} onActivated={reload} />

      <header className={styles.hero}>
        <span className={styles.eyebrow}>Abonamente Artfest</span>
        <h2 className={styles.heroTitle}>Alege cum vrei să crești pe Artfest</h2>
        <p className={styles.heroSubtitle}>
          Începe gratuit și alege planul potrivit pentru modul în care vinzi:
          comenzi aduse de Artfest sau clienți proprii.
        </p>
      </header>

      <div className={styles.plansGrid}>
        {SUBSCRIPTION_PLANS.map((plan) => (
          <PlanCard
            key={plan.code}
            plan={plan}
            isCurrent={view.state === "active" && view.matchedCard === plan.code}
          />
        ))}
      </div>

      <p className={styles.footnote}>
        <Info size={14} aria-hidden="true" />
        <span>{PLANS_FOOTNOTE}</span>
      </p>

      <section className={styles.compare}>
        <button
          type="button"
          className={styles.compareToggle}
          aria-expanded={compareOpen}
          aria-controls="plans-compare-table"
          onClick={() => setCompareOpen((v) => !v)}
        >
          <span>Compară toate beneficiile</span>
          <ChevronDown
            size={18}
            aria-hidden="true"
            className={compareOpen ? styles.chevronUp : styles.chevron}
          />
        </button>

        {compareOpen && <ComparisonTable />}
      </section>

      <section className={styles.services} aria-labelledby="custom-services-title">
        <div className={styles.sectionHead}>
          <h3 id="custom-services-title" className={styles.sectionTitle}>
            Vrei un magazin personalizat de echipa Artfest?
          </h3>
          <p className={styles.sectionSubtitle}>
            Serviciu opțional, separat de abonamente: echipa Artfest îți
            configurează magazinul pe baza identității brandului tău. Disponibil
            pentru toate planurile, inclusiv BASIC.
          </p>
        </div>

        <div className={styles.servicesGrid}>
          {CUSTOMIZATION_SERVICES.map((s) => (
            <article key={s.code} className={styles.serviceCard}>
              <div className={styles.serviceTop}>
                <h4 className={styles.serviceName}>{s.name}</h4>
                <span className={styles.badgeSoon}>
                  <Clock size={12} aria-hidden="true" /> În pregătire
                </span>
              </div>
              <div className={styles.servicePrice}>
                <strong>{s.priceLabel}</strong>
                <span>{s.priceNote}</span>
              </div>
              <ul className={styles.featureList}>
                {s.includes.map((f) => (
                  <li key={f}>
                    <Check size={16} aria-hidden="true" className={styles.iconYes} />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              <p className={styles.serviceNote}>{s.note}</p>
            </article>
          ))}
        </div>

        <p className={styles.servicesHint}>{CUSTOMIZATION_AVAILABILITY_NOTE}</p>
      </section>

      <Link to={VENDOR_STORE_DESIGN_URL} className={styles.designLink}>
        <span className={styles.designIcon}>
          <Palette size={20} aria-hidden="true" />
        </span>
        <span className={styles.designText}>
          <strong>Design magazin</strong>
          <span>Cum funcționează serviciile de personalizare ale echipei Artfest.</span>
        </span>
        <ArrowRight size={18} aria-hidden="true" />
      </Link>
    </div>
  );
}

function CurrentPlanCard({ view, error, onActivated }) {
  const [status, setStatus] = useState("idle");
  const [activateErr, setActivateErr] = useState("");

  async function activateBasic() {
    setStatus("processing");
    setActivateErr("");
    try {
      await api("/api/billing/checkout?plan=basic&period=month", { method: "POST" });
      await onActivated?.();
    } catch (e) {
      setActivateErr(e?.message || "Planul Basic gratuit nu a putut fi activat.");
    } finally {
      setStatus("idle");
    }
  }

  if (view.state === "loading") {
    return (
      <section className={styles.current} aria-busy="true">
        <Loader2 size={18} className={styles.spin} aria-hidden="true" />
        <span className={styles.currentMuted}>Se încarcă abonamentul tău…</span>
      </section>
    );
  }

  if (view.state === "unknown") {
    return (
      <section className={styles.current} role="alert">
        <span className={styles.currentMuted}>
          {error || "Nu am putut citi abonamentul."}
        </span>
        <button type="button" className={styles.btnGhost} onClick={onActivated}>
          Reîncearcă
        </button>
      </section>
    );
  }

  if (view.state === "none") {
    return (
      <section className={styles.current}>
        <div className={styles.currentMain}>
          <span className={styles.currentLabel}>Abonamentul meu</span>
          <strong className={styles.currentName}>Niciun abonament activ</strong>
          <span className={styles.currentMuted}>
            Planul BASIC este gratuit, fără card și fără reînnoire cu plată.
          </span>
          {activateErr && (
            <span className={styles.error} role="alert">
              {activateErr}
            </span>
          )}
        </div>
        <button
          type="button"
          className={styles.btnPrimary}
          onClick={activateBasic}
          disabled={status === "processing"}
        >
          {status === "processing" ? "Se activează…" : "Activează planul gratuit"}
        </button>
      </section>
    );
  }

  const commission = formatBpsPercent(view.commissionBps);

  return (
    <section className={styles.current}>
      <div className={styles.currentMain}>
        <span className={styles.currentLabel}>Abonamentul meu</span>
        <div className={styles.currentRow}>
          <strong className={styles.currentName}>{view.planName}</strong>
          <span className={styles.badgeCurrent}>
            <Check size={12} aria-hidden="true" /> Activ
          </span>
        </div>
        <span className={styles.currentMuted}>
          {view.isFree ? "Gratuit" : "Plan plătit"}
          {commission ? ` · ${commission} comision standard pentru comenzile generate de Artfest` : ""}
          {view.planCode === "basic"
            ? " · 5% pentru comenzile proprii eligibile, conform regulilor actuale"
            : ""}
        </span>
      </div>
    </section>
  );
}

function PlanCard({ plan, isCurrent }) {
  const comingSoon = plan.status === PLAN_STATUS.COMING_SOON;

  return (
    <article
      className={[
        styles.planCard,
        plan.highlighted ? styles.planHighlighted : "",
        isCurrent ? styles.planCurrent : "",
      ].join(" ")}
      aria-label={`Plan ${plan.name}`}
    >
      <div className={styles.planHead}>
        <h3 className={styles.planName}>{plan.name}</h3>
        {isCurrent && (
          <span className={styles.badgeCurrent}>
            <Check size={12} aria-hidden="true" /> Planul actual
          </span>
        )}
        {comingSoon && (
          <span className={styles.badgeSoon}>
            <Clock size={12} aria-hidden="true" /> În pregătire
          </span>
        )}
      </div>

      <p className={styles.planTagline}>{plan.tagline}</p>

      <div className={styles.planPrice}>
        <strong>{plan.priceLabel}</strong>
        <span>{plan.priceSuffix}</span>
      </div>

      <ul className={styles.commissionList} aria-label="Comisioane">
        {plan.commissions.map((c) => (
          <li key={c.label}>
            <span className={styles.commissionValue}>{c.value}</span>
            <span className={styles.commissionLabel}>{c.label}</span>
          </li>
        ))}
      </ul>

      <ul className={styles.featureList}>
        {plan.features.map((f) => (
          <li key={f}>
            <Check size={16} aria-hidden="true" className={styles.iconYes} />
            <span>{f}</span>
          </li>
        ))}
      </ul>

      <div className={styles.aiCredits}>
        <Sparkles size={16} aria-hidden="true" />
        <span>
          <strong>{plan.aiCredits} credite AI</strong> pe lună
          <small>{AI_CREDITS_NOTE}</small>
        </span>
      </div>

      {/* Stare, nu acțiune - niciun buton de activare/plată pentru PRO/BUSINESS */}
      <div className={styles.planFoot}>
        {isCurrent ? (
          <span className={styles.stateCurrent}>Folosești acest plan</span>
        ) : comingSoon ? (
          <span className={styles.stateSoon}>Disponibil în curând</span>
        ) : (
          <span className={styles.stateSoon}>Plan gratuit</span>
        )}
      </div>
    </article>
  );
}

const PLAN_HEADERS = SUBSCRIPTION_PLANS.map((p) => p.name);

function ComparisonTable() {
  return (
    <div id="plans-compare-table" className={styles.compareBody}>
      <div className={styles.compareHeadRow} aria-hidden="true">
        <span />
        {PLAN_HEADERS.map((h) => (
          <span key={h} className={styles.compareHeadCell}>
            {h}
          </span>
        ))}
      </div>

      {COMPARISON_GROUPS.map((group) => (
        <div key={group.title} className={styles.compareGroup}>
          <div className={styles.compareGroupTitle}>
            {group.title}
          </div>
          {group.rows.map((row) => (
            <div key={row.label} className={styles.compareRow}>
              <span className={styles.compareLabel}>
                {row.label}
              </span>
              {row.values.map((v, i) => (
                <span key={PLAN_HEADERS[i]} className={styles.compareCell}>
                  <span className={styles.compareCellPlan}>{PLAN_HEADERS[i]}</span>
                  <CompareValue value={v} />
                </span>
              ))}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function CompareValue({ value }) {
  if (value === true) {
    return (
      <>
        <Check size={16} className={styles.iconYes} aria-hidden="true" />
        <span className={styles.srOnly}>Inclus</span>
      </>
    );
  }
  if (value === false) {
    return (
      <>
        <Minus size={16} className={styles.iconNo} aria-hidden="true" />
        <span className={styles.srOnly}>Neinclus</span>
      </>
    );
  }
  return <span className={styles.compareText}>{value}</span>;
}
