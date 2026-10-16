// src/pages/Vendor/Orders/components/CourierConnectCta.jsx
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Truck, ArrowRight } from "lucide-react";
import { api } from "../../../../lib/api";
import { VENDOR_COURIERS_SETTINGS_URL } from "../../../../config/vendorNavigation.js";
import {
  COURIER_AUTOMATION_ENABLED,
  COURIER_AUTOMATION_SOON_MESSAGE,
  COURIER_SOON_SHORT,
  COURIER_MANUAL_SHIPPING_MESSAGE,
} from "../../../../config/features.js";
import { shouldShowCourierCta } from "../utils/courierCta.js";
import styles from "./CourierConnectCta.module.css";

/*
 * CTA „Conectează un curier” (Comenzi + detaliu comandă). Apare doar dacă
 * vendorul NU are niciun CourierAccount ACTIVE; duce în secțiunea
 * existentă din Setări (fără UI duplicat). Când există cont activ nu
 * randează nimic - locul viitorului buton „Generează AWB” (NU acum).
 *
 * Fără cache: după ce vendorul își conectează un curier în Setări, CTA-ul
 * trebuie să dispară imediat la revenirea în Comenzi.
 */

async function loadAccounts() {
  const res = await api("/api/vendor/couriers/accounts");
  return Array.isArray(res?.items) ? res.items : [];
}

// integrarea automată indisponibilă => CTA vizibil, dar dezactivat; niciun apel API (vezi config/features.js)
export default function CourierConnectCta(props) {
  if (!COURIER_AUTOMATION_ENABLED) return <CourierConnectCtaUnavailable {...props} />;
  return <CourierConnectCtaInner {...props} />;
}

function CourierConnectCtaUnavailable({ variant = "banner" }) {
  return (
    <section
      className={`${styles.cta} ${styles.unavailable} ${variant === "compact" ? styles.compact : ""}`}
      aria-label="Conectează un curier - disponibil în curând"
    >
      <span className={styles.icon} aria-hidden="true">
        <Truck size={20} />
      </span>
      <div className={styles.text}>
        <strong className={styles.title}>Conectează un curier</strong>
        <span className={styles.subtitle}>
          {COURIER_AUTOMATION_SOON_MESSAGE} {COURIER_MANUAL_SHIPPING_MESSAGE}
        </span>
      </div>
      <button
        type="button"
        className={`${styles.btn} ${styles.btnUnavailable}`}
        disabled
        aria-disabled="true"
        title={COURIER_SOON_SHORT}
      >
        Conectează un curier <ArrowRight size={16} aria-hidden="true" />
      </button>
    </section>
  );
}

function CourierConnectCtaInner({ variant = "banner" }) {
  const [state, setState] = useState({ loading: true, error: false, accounts: null });

  useEffect(() => {
    let alive = true;
    loadAccounts()
      .then((accounts) => alive && setState({ loading: false, error: false, accounts }))
      .catch(
        (e) =>
          alive &&
          setState({
            loading: false,
            error: true,
            accounts: null,
            backendDisabled: e?.data?.error === "courier_integration_disabled",
          })
      );
    return () => {
      alive = false;
    };
  }, []);

  // backend oprit (COURIER_INTEGRATION_ENABLED, 503): CTA vizibil, dar dezactivat
  if (state.backendDisabled) return <CourierConnectCtaUnavailable variant={variant} />;
  if (!shouldShowCourierCta(state)) return null;

  return (
    <section
      className={`${styles.cta} ${variant === "compact" ? styles.compact : ""}`}
      aria-label="Conectează un curier"
    >
      <span className={styles.icon} aria-hidden="true">
        <Truck size={20} />
      </span>
      <div className={styles.text}>
        <strong className={styles.title}>Conectează un curier</strong>
        <span className={styles.subtitle}>
          Conectează contul tău de curier pentru a putea genera AWB-uri direct din Artfest.
        </span>
      </div>
      <Link className={styles.btn} to={VENDOR_COURIERS_SETTINGS_URL}>
        Conectează un curier <ArrowRight size={16} aria-hidden="true" />
      </Link>
    </section>
  );
}
