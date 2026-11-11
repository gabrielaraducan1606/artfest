// src/pages/Vendor/StoreDesign/StoreDesignPage.jsx
import React from "react";
import { Link } from "react-router-dom";
import { Clock, Check, Loader2, ArrowRight } from "lucide-react";
import styles from "./StoreDesignPage.module.css";
import useVendorSubscriptionStatus from "../Subscription/useVendorSubscriptionStatus.js";
import {
  CUSTOMIZATION_SERVICES,
  CUSTOMIZATION_STEPS,
  CUSTOMIZATION_AVAILABILITY_NOTE,
} from "../Subscription/subscriptionPlansContent.js";
import { VENDOR_SUBSCRIPTION_URL } from "../../../config/vendorNavigation.js";

/*
 * „Design magazin” - prezentarea serviciilor de personalizare realizate de
 * echipa Artfest. Serviciile sunt SEPARATE de abonamente (disponibile și
 * pentru BASIC). Nu există editor vizual: pagina nu are niciun control
 * care să pretindă că salvează, publică sau comandă ceva.
 */
export default function StoreDesignPage() {
  const { view } = useVendorSubscriptionStatus();

  return (
    <div className={styles.wrap}>
      <header className={styles.hero}>
        <div className={styles.heroText}>
          <span className={styles.badgeSoon}>
            <Clock size={12} aria-hidden="true" /> În pregătire
          </span>
          <h1 className={styles.title}>Design magazin</h1>
          <p className={styles.subtitle}>
            Vrei un magazin cu identitatea brandului tău? Echipa Artfest îl
            personalizează pentru tine, ca serviciu separat de abonament.
          </p>
          <p className={styles.planLine}>
            {view.state === "loading" ? (
              <>
                <Loader2 size={14} className={styles.spin} aria-hidden="true" />
                Se încarcă abonamentul…
              </>
            ) : view.state === "active" ? (
              <>
                Planul tău actual: <strong>{view.planName}</strong>. Serviciile de
                personalizare sunt disponibile pentru toate planurile, inclusiv BASIC.
              </>
            ) : (
              <>Serviciile de personalizare sunt disponibile pentru toate planurile, inclusiv BASIC.</>
            )}
          </p>
        </div>

        {/* Ilustrație statică - nu e un editor funcțional */}
        <div className={styles.mock} aria-hidden="true">
          <div className={styles.mockBar}>
            <span />
            <span />
            <span />
          </div>
          <div className={styles.mockHeader} />
          <div className={styles.mockBanner} />
          <div className={styles.mockRow}>
            <span />
            <span />
            <span />
          </div>
          <div className={styles.mockFooter} />
        </div>
      </header>

      <section aria-labelledby="design-services-title">
        <h2 id="design-services-title" className={styles.sectionTitle}>
          Serviciile echipei Artfest
        </h2>
        <div className={styles.services}>
          {CUSTOMIZATION_SERVICES.map((s) => (
            <article key={s.code} className={styles.serviceCard}>
              <div className={styles.serviceTop}>
                <h3 className={styles.serviceName}>{s.name}</h3>
                <span className={styles.badgeSoon}>
                  <Clock size={12} aria-hidden="true" /> În pregătire
                </span>
              </div>
              <div className={styles.servicePrice}>
                <strong>{s.priceLabel}</strong>
                <span>{s.priceNote}</span>
              </div>
              <ul className={styles.includes}>
                {s.includes.map((f) => (
                  <li key={f}>
                    <Check size={16} aria-hidden="true" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              <p className={styles.serviceNote}>{s.note}</p>
            </article>
          ))}
        </div>
      </section>

      <section aria-labelledby="design-steps-title">
        <h2 id="design-steps-title" className={styles.sectionTitle}>
          Cum va funcționa
        </h2>
        <ol className={styles.steps}>
          {CUSTOMIZATION_STEPS.map((step, i) => (
            <li key={step.title} className={styles.step}>
              <span className={styles.stepNo}>{i + 1}</span>
              <div>
                <strong>{step.title}</strong>
                <p>{step.text}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className={styles.note}>
        <p>
          {CUSTOMIZATION_AVAILABILITY_NOTE} Magazinul tău de pe Artfest rămâne
          neschimbat; îl poți edita în continuare din{" "}
          <Link to="/vendor/stores">Magazinele mele</Link>.
        </p>
        <Link to={VENDOR_SUBSCRIPTION_URL} className={styles.cta}>
          Vezi abonamentele <ArrowRight size={16} aria-hidden="true" />
        </Link>
      </section>
    </div>
  );
}
