// frontend/src/pages/User/Orders/components/OrderCard.jsx
import React, { memo, useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { MessageSquare } from "lucide-react";
import styles from "../Orders.module.css";

const STATUS_LABEL = {
  PENDING: "În așteptare",
  PROCESSING: "În procesare la artizani",
  SHIPPED: "Predată curierului",
  DELIVERED: "Livrată",
  CANCELED: "Anulată",
  RETURNED: "Returnată",
};

function shortId(id = "") {
  if (id.length <= 8) return id;
  return `${id.slice(0, 4)}…${id.slice(-4)}`;
}

function money(cents = 0, currency = "RON") {
  const val = (Number(cents) || 0) / 100;
  return new Intl.NumberFormat("ro-RO", { style: "currency", currency }).format(val);
}

function OrderCardBase({ order, onCancel, onReorder, onContact, onReturn, busy }) {
  const navigate = useNavigate();

  const canCancel = !!order.cancellable;
  const canReorder = order.status !== "CANCELED";
  const canReturn = !!order.returnEligible && order.status === "DELIVERED";

  const createdLabel = useMemo(() => {
    const created = new Date(order.createdAt);
    return created.toLocaleString("ro-RO", { dateStyle: "medium", timeStyle: "short" });
  }, [order.createdAt]);

  const goToDetails = () => {
    navigate(`/comanda/${order.id}`);
  };

  const isCompany = order.customerType === "PJ";
  const addr = order.shippingAddress || {};
  const companyName = addr.companyName;

  const items = Array.isArray(order.items) ? order.items : [];
  const visibleItems = items.slice(0, 3);
  const remaining = Math.max(0, items.length - visibleItems.length);

  return (
    <article
      className={styles.card}
      role="button"
      tabIndex={0}
      onClick={goToDetails}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          goToDetails();
        }
      }}
    >
      <header className={styles.cardHead}>
        <div className={styles.orderMeta}>
          <div className={styles.orderId}># {order.orderNumber || shortId(order.id)}</div>

          <div className={styles.dot} />

          <div className={`${styles.badge} ${styles[`st_${order.status}`]}`}>
            {STATUS_LABEL[order.status] || order.status}
          </div>

          {order?.shippingStage?.label && (
            <>
              <div className={styles.dot} />
              <div className={styles.subtle}>{order.shippingStage.label}</div>
            </>
          )}

          <div className={styles.dot} />
          <div className={styles.date}>{createdLabel}</div>
        </div>

        <div className={styles.total}>
          Total: <b>{money(order.totalCents, order.currency)}</b>
        </div>
      </header>

      {isCompany && (
        <div style={{ marginTop: 4, marginBottom: 4 }}>
          <span className={styles.subtle}>
            Facturare pe firmă{companyName ? `: ${companyName}` : ""}
          </span>
        </div>
      )}

      <div className={styles.cardBody}>
        <ul className={styles.itemList}>
          {visibleItems.map((it) => (
            <li className={styles.item} key={it.id}>
              <Link
                to={it.productId ? `/produs/${it.productId}` : "#"}
                className={styles.itemThumbLink}
                onClick={(e) => e.stopPropagation()}
              >
                <img
                  src={it.image || "/placeholder.png"}
                  alt={it.title}
                  className={styles.thumb}
                  loading="lazy"
                  decoding="async"
                />
              </Link>

              <div className={styles.itemInfo}>
                <Link
                  to={it.productId ? `/produs/${it.productId}` : "#"}
                  className={styles.itemTitle}
                  onClick={(e) => e.stopPropagation()}
                >
                  {it.title}
                </Link>
                <div className={styles.itemMeta}>
                  Cantitate: <b>{it.qty}</b> · Preț: <b>{money(it.priceCents, order.currency)}</b>
                </div>
              </div>
            </li>
          ))}

          {remaining > 0 && (
            <li className={styles.subtle} style={{ padding: "6px 0" }}>
              + {remaining} produse (vezi în detalii)
            </li>
          )}
        </ul>

        <div className={styles.cardBodyRight} onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            className={styles.btnGhost}
            onClick={() => onContact(order)}
            title="Scrie artizanului pentru această comandă"
          >
            <MessageSquare size={16} style={{ marginRight: 4 }} />
            Contactează artizanul
          </button>
        </div>
      </div>

      <footer className={styles.actionsRow} onClick={(e) => e.stopPropagation()}>
        <button type="button" className={styles.btnGhost} onClick={goToDetails}>
          Detalii comandă
        </button>

        {canReturn && (
          <button
            type="button"
            className={styles.btnGhost}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onReturn?.(order);
            }}
          >
            Retur
          </button>
        )}

        {canReorder && (
          <button className={styles.btnPrimary} disabled={busy} onClick={() => onReorder(order.id)}>
            {busy ? "Se adaugă…" : "Comandă din nou"}
          </button>
        )}

        {canCancel && (
          <button className={styles.btnWarn} disabled={busy} onClick={() => onCancel(order.id)}>
            {busy ? "Se anulează…" : "Anulează comanda"}
          </button>
        )}
      </footer>
    </article>
  );
}

export default memo(OrderCardBase);
