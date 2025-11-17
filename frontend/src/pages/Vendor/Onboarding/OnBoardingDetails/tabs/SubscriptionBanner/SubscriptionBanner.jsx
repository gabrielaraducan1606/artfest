// src/features/billing/SubscriptionBanner.jsx
import { useCurrentSubscription } from "../../hooks/useCurrentSubscriptionBanner.js";
import styles from "./SubscriptionBanner.module.css";

export default function SubscriptionBanner() {
  const { sub, loading } = useCurrentSubscription();

  const show =
    !loading &&
    (
      !sub ||              // nu există abonament
      sub.status !== "active" // sau nu e activ (canceled, expired, etc.)
    );

  if (!show) return null;

  return (
    <div className={styles.banner}>
      <div className={styles.content}>
        <div className={styles.text}>
          <strong>Abonamentul tău nu este activ.</strong>
          <span>Magazinele tale nu sunt vizibile în platformă.</span>
        </div>

        <a  href="/onboarding/details?tab=plata&solo=1" className={styles.link}>
          Reia abonamentul →
        </a>
      </div>
    </div>
  );
}
