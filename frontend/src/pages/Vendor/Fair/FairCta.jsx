// src/pages/Vendor/Fair/FairCta.jsx
//
// Punctul de acces către pagina „Târg Artfest” din Dashboard (card) și din
// Comenzi (banner discret). Aceeași componentă și același link pentru
// ambele, ca logica să nu fie duplicată.
//   - dashboard: mereu vizibil; dacă vendorul e înscris, arată statusul;
//   - orders: doar cât timp vendorul NU are o înscriere activă.

import { Link } from "react-router-dom";
import { ArrowRight, Gift } from "lucide-react";
import { VENDOR_FAIR_URL } from "../../../config/vendorNavigation.js";
import { FAIR_TITLE, STATUS_LABEL, useArtfestFair } from "./artfestFair.js";
import styles from "./FairCta.module.css";

export default function FairCta({ variant = "dashboard" }) {
  const { loading, error, data } = useArtfestFair();

  // fără date (eroare / încă se încarcă) nu blocăm pagina gazdă
  if (loading || error || !data?.fair) return null;

  const status = data.registration?.status || null;
  const registered = status && status !== "WITHDRAWN";

  if (variant === "orders") {
    if (registered) return null;
    return (
      <section className={`${styles.cta} ${styles.compact}`} aria-label="Târgul de Crăciun Artfest">
        <span className={styles.icon} aria-hidden="true">
          <Gift size={18} />
        </span>
        <span className={styles.text}>
          <strong className={styles.title}>Vrei să participi la Târgul de Crăciun Artfest?</strong>
        </span>
        <Link className={styles.btnGhost} to={VENDOR_FAIR_URL}>
          Vezi detalii <ArrowRight size={16} aria-hidden="true" />
        </Link>
      </section>
    );
  }

  return (
    <section className={styles.cta} aria-label={FAIR_TITLE}>
      <span className={styles.icon} aria-hidden="true">
        <Gift size={22} />
      </span>
      <div className={styles.text}>
        <strong className={styles.title}>{FAIR_TITLE}</strong>
        <span className={styles.subtitle}>
          {registered
            ? `Statusul înscrierii tale: ${STATUS_LABEL[status] || status}.`
            : "Artfest iese din online. Participă alături de noi la Târgul de Crăciun din Buzău."}
        </span>
      </div>
      <Link className={styles.btn} to={VENDOR_FAIR_URL}>
        {registered ? "Vezi înscrierea" : "Înscrie-te la târg"} <ArrowRight size={16} aria-hidden="true" />
      </Link>
    </section>
  );
}
