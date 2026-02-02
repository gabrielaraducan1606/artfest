// frontend/src/pages/Vendor/Orders/components/OrdersTable.jsx
import React from "react";
import { ChevronLeft, ChevronRight, FileText, Loader2, MessageSquare, PackageCheck, XCircle } from "lucide-react";
import styles from "../Orders.module.css";
import { STATUS_OPTIONS, CANCEL_REASONS } from "../utils/constants";
import { formatMoney, formatDate, getLeadStatusLabel } from "../utils/format";
import { isCourierAlreadyScheduled } from "../utils/orderLocks";

export default function OrdersTable({
  loading,
  items,
  page,
  totalPages,
  total,
  pageSize,
  startingMessageOrderId,

  onPrev,
  onNext,
  onRowClick,

  onContactClient,
  onMarkPreparing,
  onOpenCourier,
  onMarkFulfilled,
  onOpenInvoice,
  onOpenCancel,

  billingReady,
  billingLoading,
  invoiceLoadingId,
}) {
  return (
    <div className={styles.card}>
      <div className={styles.tableWrap} role="region" aria-label="Tabel comenzi">
        <table className={styles.table}>
          <thead>
            <tr>
              <th>ID</th>
              <th>Data</th>
              <th>Client</th>
              <th className={styles.hideSm}>Contact</th>
              <th>Status</th>
              <th>Total</th>
              <th></th>
            </tr>
          </thead>

          <tbody>
            {loading &&
              Array.from({ length: 6 }).map((_, i) => (
                <tr key={`sk-${i}`} className={styles.skeletonRow}>
                  <td colSpan={7}>
                    <Loader2 className={styles.spin} size={16} /> Se încarcă…
                  </td>
                </tr>
              ))}

            {!loading && items.length === 0 && (
              <tr>
                <td colSpan={7} className={styles.emptyCell}>
                  Nu există comenzi pentru filtrele curente.
                </td>
              </tr>
            )}

            {!loading &&
              items.map((o) => {
                const leadLabel = getLeadStatusLabel(o.leadStatus);
                const cancelReasonLabel =
                  o.cancelReason &&
                  (CANCEL_REASONS.find((r) => r.value === o.cancelReason)?.label || o.cancelReason);

                const courierScheduled = isCourierAlreadyScheduled(o);

                return (
                  <tr key={o.id} className={styles.orderRow} onClick={() => onRowClick(o)}>
                    <td>
                      <code>{o.orderNumber || o.shortId || o.id}</code>
                    </td>

                    <td>{formatDate(o.createdAt)}</td>

                    <td>
                      <div className={styles.clientCol}>
                        <div className={styles.clientName}>{o.customerName || "—"}</div>
                        <div className={styles.clientNote}>{o.eventName || o.address?.city || ""}</div>

                        {(o.awb || o.pickupDate || leadLabel) && (
                          <div className={styles.inlineChips}>
                            {o.awb && (
                              <span className={`${styles.badge} ${styles.badgeConfirmed}`}>AWB {o.awb}</span>
                            )}

                            {o.pickupDate && (
                              <span className={styles.badge}>
                                Ridicare{" "}
                                {new Date(o.pickupDate).toLocaleDateString("ro-RO", {
                                  weekday: "short",
                                  day: "2-digit",
                                  month: "short",
                                })}{" "}
                                {o.pickupSlotStart && o.pickupSlotEnd ? (
                                  <>
                                    {new Date(o.pickupSlotStart).toLocaleTimeString("ro-RO", {
                                      hour: "2-digit",
                                      minute: "2-digit",
                                    })}
                                    {"–"}
                                    {new Date(o.pickupSlotEnd).toLocaleTimeString("ro-RO", {
                                      hour: "2-digit",
                                      minute: "2-digit",
                                    })}
                                  </>
                                ) : null}
                              </span>
                            )}

                            {leadLabel && (
                              <span className={`${styles.badge} ${styles.badgeLead || ""}`}>{leadLabel}</span>
                            )}
                          </div>
                        )}
                      </div>
                    </td>

                    <td className={styles.hideSm}>
                      <div className={styles.clientContact}>
                        {o.customerPhone && (
                          <a href={`tel:${o.customerPhone}`} onClick={(e) => e.stopPropagation()}>
                            {o.customerPhone}
                          </a>
                        )}
                        {o.customerEmail && (
                          <a href={`mailto:${o.customerEmail}`} onClick={(e) => e.stopPropagation()}>
                            {o.customerEmail}
                          </a>
                        )}
                      </div>
                    </td>

                    <td>
                      <div>
                        <span
                          className={`${styles.badge} ${
                            o.status === "new"
                              ? styles.badgeNew
                              : o.status === "preparing"
                              ? styles.badgeWarning
                              : o.status === "confirmed"
                              ? styles.badgeConfirmed
                              : o.status === "fulfilled"
                              ? styles.badgeFulfilled
                              : o.status === "cancelled"
                              ? styles.badgeCancelled
                              : ""
                          }`}
                        >
                          {STATUS_OPTIONS.find((s) => s.value === o.status)?.label || o.status || "—"}
                        </span>

                        {o.paymentMethod && (
                          <div className={styles.clientNote}>
                            {o.paymentMethod === "COD" ? "Plată la livrare" : "Card online"}
                          </div>
                        )}

                        {o.invoiceNumber && (
                          <div className={styles.clientNote}>
                            Factură: <strong>{o.invoiceNumber}</strong>
                            {o.invoiceDate && <> {" · "}{new Date(o.invoiceDate).toLocaleDateString("ro-RO")}</>}
                          </div>
                        )}

                        {cancelReasonLabel && (
                          <div className={styles.clientNote}>
                            Motiv anulare: <strong>{cancelReasonLabel}</strong>
                            {o.cancelReasonNote && <> – {o.cancelReasonNote}</>}
                          </div>
                        )}
                      </div>
                    </td>

                    <td>{formatMoney(o.total)}</td>

                    <td className={styles.actionsCell}>
                      <button
                        type="button"
                        className={styles.iconActionBtn}
                        onClick={(e) => {
                          e.stopPropagation();
                          onContactClient(o);
                        }}
                        disabled={startingMessageOrderId === o.id}
                        aria-label="Mesaje client"
                      >
                        {startingMessageOrderId === o.id ? (
                          <Loader2 size={16} className={styles.spin} />
                        ) : (
                          <MessageSquare size={16} />
                        )}
                        {o.messageUnreadCount > 0 && <span className={styles.unreadDot}>{o.messageUnreadCount}</span>}
                      </button>

                      {o.status === "new" && (
                        <button
                          className={styles.secondaryBtn}
                          onClick={(e) => {
                            e.stopPropagation();
                            onMarkPreparing(o);
                          }}
                        >
                          În pregătire
                        </button>
                      )}

                      {(o.status === "preparing" || o.status === "confirmed") && (
                        <button
                          className={styles.primaryBtn}
                          onClick={(e) => {
                            e.stopPropagation();
                            onOpenCourier(o);
                          }}
                          disabled={courierScheduled}
                          title={courierScheduled ? "Curierul este deja programat" : "Programează curier"}
                        >
                          <PackageCheck size={16} /> {courierScheduled ? "Curier programat" : "Programează curier"}
                        </button>
                      )}

                      {o.status === "confirmed" && (
                        <button
                          className={styles.secondaryBtn}
                          onClick={(e) => {
                            e.stopPropagation();
                            onMarkFulfilled(o);
                          }}
                        >
                          Marchează finalizată
                          <br />
                          Predată curierului
                        </button>
                      )}

                      {o.status !== "cancelled" && (
                        <button
                          className={styles.iconActionBtn}
                          onClick={(e) => {
                            e.stopPropagation();
                            onOpenInvoice(o);
                          }}
                          disabled={!billingReady || billingLoading || invoiceLoadingId === o.id}
                          aria-label="Factură"
                        >
                          {invoiceLoadingId === o.id ? <Loader2 size={16} className={styles.spin} /> : <FileText size={16} />}
                        </button>
                      )}

                      {["new", "preparing", "confirmed"].includes(o.status) && (
                        <button
                          className={styles.iconActionBtn}
                          onClick={(e) => {
                            e.stopPropagation();
                            onOpenCancel(o);
                          }}
                          title="Anulează comanda"
                          aria-label="Anulează comanda"
                        >
                          <XCircle size={16} />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>

      {total > pageSize && (
        <div className={styles.pagination}>
          <button className={styles.secondaryBtn} onClick={onPrev} disabled={page <= 1}>
            <ChevronLeft size={16} /> Anterioare
          </button>
          <span className={styles.pageInfo}>
            Pagina {page} / {totalPages} · {total} rezultate
          </span>
          <button className={styles.secondaryBtn} onClick={onNext} disabled={page >= totalPages}>
            Următoare <ChevronRight size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
