// frontend/src/pages/Checkout/ThankYou.jsx
import React from "react";
import { useSearchParams, Link } from "react-router-dom";
import styles from "./Checkout.module.css"; // reutilizăm container/card etc.

export default function ThankYou() {
  const [params] = useSearchParams();
  const orderId = params.get("order");

  return (
    <div className={styles.container}>
      <div className={styles.card}>
        <h2 className={styles.pageTitle}>Mulțumim pentru comandă! 🎉</h2>

        <p style={{ marginBottom: 8 }}>
          Comanda ta a fost primită și a fost trimisă către magazinul(ele) vânzător.
        </p>

        {orderId && (
          <p>
            <strong>ID comandă:</strong>{" "}
            <code>{orderId}</code>
          </p>
        )}

        <p className={styles.muted} style={{ marginTop: 16 }}>
          Vei primi un email cu detaliile comenzii. Poți urmări statusul ei din
          secțiunea <Link to="/comenzile-mele">„Comenzile mele”</Link>.
        </p>

        <div style={{ marginTop: 24, display: "flex", gap: 12 }}>
          <Link to="/comenzile-mele" className={styles.primaryBtn}>
            Vezi comanda
          </Link>
          <Link to="/produse" className={styles.secondaryBtn}>
            Continuă cumpărăturile
          </Link>
        </div>
      </div>
    </div>
  );
}
