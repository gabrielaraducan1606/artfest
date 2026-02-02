// frontend/src/pages/Checkout/ThankYou.jsx
import React from "react";
import { useSearchParams, Link } from "react-router-dom";
import styles from "./Checkout.module.css";
import { api } from "../../lib/api";

export default function ThankYou() {
  const [params] = useSearchParams();

  const orderId = params.get("order");
  const orderNoFromUrl = params.get("orderNo");

  const [displayNo, setDisplayNo] = React.useState(() => {
    // 1) din URL
    if (orderNoFromUrl) return orderNoFromUrl;

    // 2) fallback din sessionStorage (setat la place order)
    if (orderId) {
      const cached = sessionStorage.getItem(`orderNo:${orderId}`);
      if (cached) return cached;
    }

    return null;
  });

  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    if (!orderId) return;

    // dacă avem deja orderNo (din URL sau cache), nu mai cerem backend
    if (displayNo) return;

    let cancelled = false;
    setLoading(true);

    (async () => {
      try {
        // ✅ IMPORTANT:
        // - api în proiectul tău pare a fi funcție (vezi AdminPickupsPage)
        // - include /api în path
        const data = await api(`/api/user/orders/${orderId}`);

        const no = data?.orderNumber || null;

        if (!cancelled) {
          if (no) {
            setDisplayNo(no);
            sessionStorage.setItem(`orderNo:${orderId}`, no);
          } else {
            // fallback dacă nu vine orderNumber (safety)
            setDisplayNo(orderId);
          }
        }
      } catch {
        if (!cancelled) setDisplayNo(orderId);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [orderId, displayNo]);

  const shownNo = loading ? "..." : displayNo || orderId || "-";

  return (
    <div className={styles.container}>
      <div className={styles.card}>
        <h2 className={styles.pageTitle}>Mulțumim pentru comandă! 🎉</h2>

        <p className={styles.thankYouLead}>
          Comanda ta a fost primită și a fost trimisă către magazinul(ele)
          vânzător.
        </p>

        {orderId && (
          <p className={styles.thankYouOrderRow}>
            <strong>Număr comandă:</strong> <code>{shownNo}</code>
          </p>
        )}

        <p className={styles.muted} style={{ marginTop: 16 }}>
          Vei primi un email cu detaliile comenzii. Poți urmări statusul ei din
          secțiunea <Link to="/comenzile-mele">„Comenzile mele”</Link>.
        </p>

        <div className={styles.thankYouActions}>
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
