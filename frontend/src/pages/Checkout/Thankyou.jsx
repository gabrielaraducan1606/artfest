// frontend/src/pages/Checkout/ThankYou.jsx
import React from "react";
import { useSearchParams, Link } from "react-router-dom";
import styles from "./Checkout.module.css";
import { api } from "../../lib/api";
import { trackPurchase } from "../../../services/analytics.js";
import { useAuth } from "../Auth/Context/context.js";

export default function ThankYou() {
  const [params] = useSearchParams();
  const { me } = useAuth();

  const orderId = params.get("order");
  const orderNoFromUrl = params.get("orderNo");

const ordersListPath =
  me?.role === "VENDOR"
    ? `/vendor/orders?tab=client${
        orderId ? `&order=${encodeURIComponent(orderId)}` : ""
      }`
    : `/comenzile-mele${
        orderId ? `?order=${encodeURIComponent(orderId)}` : ""
      }`;

const orderDetailsPath =
  me?.role === "VENDOR"
    ? ordersListPath
    : orderId
    ? `/comanda/${encodeURIComponent(orderId)}`
    : "/comenzile-mele";
    
  const [displayNo, setDisplayNo] = React.useState(() => {
    if (orderNoFromUrl) return orderNoFromUrl;

    if (orderId) {
      const cached = sessionStorage.getItem(`orderNo:${orderId}`);
      if (cached) return cached;
    }

    return null;
  });

  const [loading, setLoading] = React.useState(false);
  const purchaseTrackedRef = React.useRef(false);

  React.useEffect(() => {
    if (!orderId) return;
    if (purchaseTrackedRef.current) return;

    purchaseTrackedRef.current = true;

    let cancelled = false;
    setLoading(true);

    (async () => {
      try {
        const data = await api(`/api/user/orders/${orderId}`);

        const items = Array.isArray(data?.items) ? data.items : [];

        const total = Number(
          data?.total ||
            data?.totalPrice ||
            data?.totalAmount ||
            data?.grandTotal ||
            data?.finalTotal ||
            data?.amount ||
            data?.totals?.total ||
            data?.pricing?.total ||
            data?.order?.total ||
            data?.order?.totalPrice ||
            items.reduce((sum, item) => {
              const price = Number(
                item?.price ||
                  item?.unitPrice ||
                  item?.product?.price ||
                  item?.productPrice ||
                  0
              );

              const quantity = Number(item?.quantity || item?.qty || 1);

              return sum + price * quantity;
            }, 0)
        );

        const currency = data?.currency || "RON";
        const orderNumber = data?.orderNumber || orderNoFromUrl || orderId;

        trackPurchase({
          id: orderId,
          total,
          currency,
        });

        if (!cancelled) {
          setDisplayNo(orderNumber);
          sessionStorage.setItem(`orderNo:${orderId}`, orderNumber);
        }
      } catch {
        if (!cancelled) {
          setDisplayNo(orderNoFromUrl || orderId);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [orderId, orderNoFromUrl]);

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
          secțiunea{" "}
          <Link to={ordersListPath}>„Comenzile mele”</Link>.
        </p>

        <div className={styles.thankYouActions}>
          <Link to={orderDetailsPath} className={styles.primaryBtn}>
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