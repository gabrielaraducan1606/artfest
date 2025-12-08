import { useMemo, useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { api } from "../../../../lib/api.js";
import styles from "../AdminDesktop.module.css";

const PAGE_SIZE = 25;

// helper dată
function formatDate(dateString) {
  if (!dateString) return "—";
  const d = new Date(dateString);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("ro-RO");
}

/* ----------------------------------------------------
   Helpers: status la fel ca în backend userOrdersRoutes
----------------------------------------------------- */
function computeUiStatus(order) {
  const shipments = order.shipments || [];
  const orderStatus = order?.status || null; // PENDING / PAID / CANCELLED / FULFILLED
  const shipmentStatuses = shipments.map((s) => s.status);

  if (orderStatus === "CANCELLED") return "CANCELED";

  if (shipmentStatuses.length) {
    if (shipmentStatuses.every((st) => st === "DELIVERED")) return "DELIVERED";
    if (shipmentStatuses.some((st) => st === "RETURNED")) return "RETURNED";
    if (
      shipmentStatuses.some((st) =>
        ["IN_TRANSIT", "AWB", "PICKUP_SCHEDULED"].includes(st)
      )
    )
      return "SHIPPED";
    if (
      shipmentStatuses.some((st) =>
        ["PREPARING", "READY_FOR_PICKUP"].includes(st)
      )
    )
      return "PROCESSING";
    if (shipmentStatuses.some((st) => st === "PENDING")) return "PENDING";
  }

  switch (orderStatus) {
    case "PENDING":
      return "PENDING";
    case "PAID":
      return "PROCESSING";
    case "FULFILLED":
      return "DELIVERED";
    default:
      return "PENDING";
  }
}

function isOrderCancellable(order) {
  const shipments = order.shipments || [];
  const orderStatus = order?.status || null;

  if (["CANCELLED", "FULFILLED"].includes(orderStatus)) return false;

  const hasStartedOrBeyond = shipments.some((s) =>
    [
      "PREPARING",
      "READY_FOR_PICKUP",
      "AWB",
      "IN_TRANSIT",
      "PICKUP_SCHEDULED",
      "DELIVERED",
      "RETURNED",
    ].includes(s.status)
  );

  if (hasStartedOrBeyond) return false;
  return true;
}

/* ----------------------------------------------------
   Tab principal: listă + filtre + paginare + drawer
----------------------------------------------------- */

function createDefaultFilters() {
  return {
    q: "",
    status: "ALL", // ALL | PENDING | PROCESSING | SHIPPED | DELIVERED | RETURNED | CANCELED
    payment: "ALL", // ALL | CARD | COD
    hasShipments: "ALL", // ALL | YES | NO
  };
}

export default function AdminOrdersTab({ orders, forcedUserId, forcedVendorId }) {
  const [filters, setFilters] = useState(createDefaultFilters);
  const [page, setPage] = useState(1);
  const [selectedOrder, setSelectedOrder] = useState(null);

  // resync selectedOrder când vine un nou orders de la backend
  useEffect(() => {
    if (!selectedOrder) return;
    const updated = orders?.find((o) => o.id === selectedOrder.id);
    if (updated) setSelectedOrder(updated);
  }, [orders, selectedOrder]);

  // dacă se schimbă filtrarea forțată (user/vendor), resetăm pagina
  useEffect(() => {
    setPage(1);
  }, [forcedUserId, forcedVendorId]);

  const enrichedOrders = useMemo(() => {
    return (orders || []).map((o) => {
      const uiStatus = computeUiStatus(o);
      const cancellable = isOrderCancellable(o);
      const shipments = o.shipments || [];
      const vendors =
        shipments
          .map((s) => s.vendor?.displayName || null)
          .filter(Boolean) || [];
      const uniqueVendors = [...new Set(vendors)];

      const subtotal = Number(o.subtotal || 0);
      const shippingTotal = Number(o.shippingTotal || 0);
      const total = Number(
        o.total != null ? o.total : subtotal + shippingTotal
      );

      return {
        ...o,
        _uiStatus: uiStatus,
        _cancellable: cancellable,
        _vendors: uniqueVendors,
        _shipmentsCount: shipments.length,
        _total: total,
      };
    });
  }, [orders]);

  const filteredOrders = useMemo(() => {
    let list = [...enrichedOrders];

    // Filtru "hard" din UsersTab – user
    if (forcedUserId) {
      list = list.filter(
        (o) =>
          String(o.userId || "").toLowerCase() ===
          String(forcedUserId).toLowerCase()
      );
    }

    // Filtru "hard" din UsersTab – vendor (după vendorId din shipments)
    if (forcedVendorId) {
      list = list.filter((o) =>
        (o.shipments || []).some(
          (s) =>
            String(s.vendorId || "").toLowerCase() ===
            String(forcedVendorId).toLowerCase()
        )
      );
    }

    const q = filters.q.trim().toLowerCase();
    if (q) {
      list = list.filter((o) => {
        const id = String(o.id || "").toLowerCase();
        const userId = String(o.userId || "").toLowerCase();
        const vendors = (o._vendors || []).join(" ").toLowerCase();
        const payment = String(o.paymentMethod || "").toLowerCase();
        return (
          id.includes(q) ||
          userId.includes(q) ||
          vendors.includes(q) ||
          payment.includes(q)
        );
      });
    }

    if (filters.status !== "ALL") {
      list = list.filter((o) => o._uiStatus === filters.status);
    }

    if (filters.payment !== "ALL") {
      list = list.filter((o) => o.paymentMethod === filters.payment);
    }

    if (filters.hasShipments === "YES") {
      list = list.filter((o) => (o._shipmentsCount || 0) > 0);
    } else if (filters.hasShipments === "NO") {
      list = list.filter((o) => (o._shipmentsCount || 0) === 0);
    }

    // sort implicit: cele mai noi (backend deja dă desc, dar păstrăm siguranță)
    list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    return list;
  }, [enrichedOrders, filters, forcedUserId, forcedVendorId]);

  const totalItems = filteredOrders.length;
  const totalPages = totalItems ? Math.ceil(totalItems / PAGE_SIZE) : 1;
  const currentPage = Math.min(page, totalPages);
  const startIndex = (currentPage - 1) * PAGE_SIZE;
  const endIndex = startIndex + PAGE_SIZE;
  const paginatedOrders = filteredOrders.slice(startIndex, endIndex);

  const handleFilterChange = (updater) => {
    setFilters((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      return next;
    });
    setPage(1);
  };

  const resetFilters = () => {
    setFilters(createDefaultFilters());
    setPage(1);
  };

  return (
    <>
      {/* Filtre */}
      <div className={styles.filtersRow}>
        <label>
          <span>Caută</span>
          <input
            type="text"
            placeholder="ID comandă, userId, vendor, metodă plată"
            value={filters.q}
            onChange={(e) =>
              handleFilterChange((f) => ({ ...f, q: e.target.value }))
            }
          />
        </label>

        <label>
          <span>Status</span>
          <select
            value={filters.status}
            onChange={(e) =>
              handleFilterChange((f) => ({ ...f, status: e.target.value }))
            }
          >
            <option value="ALL">Toate</option>
            <option value="PENDING">În așteptare</option>
            <option value="PROCESSING">În procesare</option>
            <option value="SHIPPED">În livrare</option>
            <option value="DELIVERED">Livrate</option>
            <option value="RETURNED">Returnate / respinse</option>
            <option value="CANCELED">Anulate</option>
          </select>
        </label>

        <label>
          <span>Metodă plată</span>
          <select
            value={filters.payment}
            onChange={(e) =>
              handleFilterChange((f) => ({ ...f, payment: e.target.value }))
            }
          >
            <option value="ALL">Toate</option>
            <option value="CARD">Card online</option>
            <option value="COD">Ramburs (COD)</option>
          </select>
        </label>

        <label>
          <span>Shipments</span>
          <select
            value={filters.hasShipments}
            onChange={(e) =>
              handleFilterChange((f) => ({
                ...f,
                hasShipments: e.target.value,
              }))
            }
          >
            <option value="ALL">Toate</option>
            <option value="YES">Doar cu shipments</option>
            <option value="NO">Fără shipments</option>
          </select>
        </label>

        <div className={styles.filtersActions}>
          <button
            type="button"
            className={styles.resetBtn}
            onClick={resetFilters}
          >
            Reset
          </button>
          <span className={styles.filtersCount}>{totalItems} rezultate</span>
        </div>
      </div>

      {(forcedUserId || forcedVendorId) && (
        <div className={styles.subtle}>
          {forcedUserId && (
            <span>
              Filtrat după <b>userId = {forcedUserId}</b>{" "}
            </span>
          )}
          {forcedVendorId && (
            <span>
              Filtrat după <b>vendorId = {forcedVendorId}</b>{" "}
            </span>
          )}
        </div>
      )}

      {/* Tabel + paginare */}
      <OrdersTable
        rows={paginatedOrders}
        totalItems={totalItems}
        onRowClick={setSelectedOrder}
      />

      <Pagination
        page={currentPage}
        totalPages={totalPages}
        totalItems={totalItems}
        onPageChange={setPage}
      />

      {selectedOrder && (
        <OrderDetailsDrawer
          order={selectedOrder}
          onClose={() => setSelectedOrder(null)}
        />
      )}
    </>
  );
}

/* ----------------------------------------------------
   Tabel comenzi
----------------------------------------------------- */

function OrdersTable({ rows, onRowClick, totalItems }) {
  if (!rows?.length) {
    return (
      <p className={styles.subtle}>
        {totalItems
          ? "Nu există comenzi pe această pagină."
          : "Nu există comenzi sau nu au fost încărcate încă."}
      </p>
    );
  }

  return (
    <div className={styles.tableWrapper}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>ID</th>
            <th>User ID</th>
            <th>Status</th>
            <th>Metodă plată</th>
            <th>Total</th>
            <th># Shipments</th>
            <th>Vendori</th>
            <th>Creat la</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((o) => (
            <tr
              key={o.id}
              className={styles.clickableRow}
              onClick={() => onRowClick?.(o)}
              tabIndex={0}
              role="button"
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onRowClick?.(o);
                }
              }}
            >
              <td>
                <code>{o.id}</code>
              </td>
              <td>{o.userId || "—"}</td>
              <td>
                <StatusBadge uiStatus={o._uiStatus} />
              </td>
              <td>{o.paymentMethod || "—"}</td>
              <td>
                {o._total != null
                  ? `${o._total.toFixed(2)} ${o.currency || "RON"}`
                  : "—"}
              </td>
              <td>{o._shipmentsCount ?? 0}</td>
              <td>{o._vendors?.join(", ") || "—"}</td>
              <td>{formatDate(o.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StatusBadge({ uiStatus }) {
  if (!uiStatus) return <span className={styles.roleBadge}>—</span>;
  const labelMap = {
    PENDING: "În așteptare",
    PROCESSING: "În procesare",
    SHIPPED: "În livrare",
    DELIVERED: "Livrată",
    RETURNED: "Returnată",
    CANCELED: "Anulată",
  };
  return (
    <span
      className={`${styles.roleBadge} ${
        styles["statusBadge" + uiStatus] || ""
      }`}
    >
      {labelMap[uiStatus] || uiStatus}
    </span>
  );
}

/* ----------------------------------------------------
   Paginare (copiată din UsersTab, adaptată)
----------------------------------------------------- */

function Pagination({ page, totalPages, totalItems, onPageChange }) {
  if (!totalItems || totalPages <= 1) return null;

  const canPrev = page > 1;
  const canNext = page < totalPages;

  const handlePrev = () => {
    if (canPrev) onPageChange(page - 1);
  };

  const handleNext = () => {
    if (canNext) onPageChange(page + 1);
  };

  const pages = [];
  const start = Math.max(1, page - 2);
  const end = Math.min(totalPages, page + 2);
  for (let p = start; p <= end; p++) {
    pages.push(p);
  }

  return (
    <div className={styles.pagination}>
      <div className={styles.paginationInfo}>
        Pagina {page} din {totalPages} · {totalItems} rezultate
      </div>
      <div className={styles.paginationControls}>
        <button
          type="button"
          className={styles.paginationBtn}
          onClick={handlePrev}
          disabled={!canPrev}
        >
          ‹ Înapoi
        </button>

        {pages.map((p) => (
          <button
            key={p}
            type="button"
            className={`${styles.paginationBtn} ${
              p === page ? styles.paginationBtnActive : ""
            }`}
            onClick={() => onPageChange(p)}
          >
            {p}
          </button>
        ))}

        <button
          type="button"
          className={styles.paginationBtn}
          onClick={handleNext}
          disabled={!canNext}
        >
          Înainte ›
        </button>
      </div>
    </div>
  );
}

/* ----------------------------------------------------
   Drawer detalii comandă + acțiuni admin
----------------------------------------------------- */

function OrderDetailsDrawer({ order, onClose }) {
  const [localOrder, setLocalOrder] = useState(order);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  const [adminNotes, setAdminNotes] = useState(order.adminNotes || "");

  useEffect(() => {
    setLocalOrder(order);
    setAdminNotes(order.adminNotes || "");
    setActionError("");
    setActionMessage("");
  }, [order]);

  if (!localOrder) return null;
  if (typeof document === "undefined") return null;

  const shipments = localOrder.shipments || [];
  const uiStatus = computeUiStatus(localOrder);
  const cancellable = isOrderCancellable(localOrder);

  const subtotal = Number(localOrder.subtotal || 0);
  const shippingTotal = Number(localOrder.shippingTotal || 0);
  const total = Number(
    localOrder.total != null ? localOrder.total : subtotal + shippingTotal
  );
  const currency = localOrder.currency || "RON";

  const shippingAddress = localOrder.shippingAddress || {};
  const customerName =
    shippingAddress.name ||
    `${shippingAddress.lastName || ""} ${
      shippingAddress.firstName || ""
    }`.trim() ||
    "";

  const flatItems = shipments.flatMap((s) =>
    (s.items || []).map((it) => ({
      ...it,
      _vendorName: s.vendor?.displayName || null,
    }))
  );

  const handleCancelOrder = async () => {
    setActionLoading(true);
    setActionError("");
    setActionMessage("");

    try {
      await api(`/api/admin/orders/${localOrder.id}/cancel`, {
        method: "POST",
      });

      setLocalOrder((prev) => ({
        ...prev,
        status: "CANCELLED",
      }));
      setActionMessage("Comanda a fost anulată.");
    } catch (e) {
      const msg =
        e?.response?.data?.message ||
        e?.message ||
        "Nu am putut anula comanda.";
      setActionError(msg);
    } finally {
      setActionLoading(false);
    }
  };

  const handleMarkFulfilled = async () => {
    setActionLoading(true);
    setActionError("");
    setActionMessage("");

    try {
      await api(`/api/admin/orders/${localOrder.id}/mark-fulfilled`, {
        method: "POST",
      });

      setLocalOrder((prev) => ({
        ...prev,
        status: "FULFILLED",
      }));
      setActionMessage("Comanda a fost marcată ca livrată.");
    } catch (e) {
      const msg =
        e?.response?.data?.message ||
        e?.message ||
        "Nu am putut marca comanda ca livrată.";
      setActionError(msg);
    } finally {
      setActionLoading(false);
    }
  };

  const handleResendConfirmation = async () => {
    setActionLoading(true);
    setActionError("");
    setActionMessage("");

    try {
      await api(`/api/admin/orders/${localOrder.id}/resend-confirmation`, {
        method: "POST",
      });

      setActionMessage("Email de confirmare comandă a fost retrimis.");
    } catch (e) {
      const msg =
        e?.response?.data?.message ||
        e?.message ||
        "Nu am putut retrimite emailul de confirmare.";
      setActionError(msg);
    } finally {
      setActionLoading(false);
    }
  };

  const handleSaveAdminNotes = async () => {
    setActionLoading(true);
    setActionError("");
    setActionMessage("");

    try {
      const res = await api(`/api/admin/orders/${localOrder.id}/notes`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ adminNotes }),
      });

      const updatedNotes = res?.order?.adminNotes ?? adminNotes;

      setLocalOrder((prev) => ({
        ...prev,
        adminNotes: updatedNotes,
      }));

      setAdminNotes(updatedNotes);
      setActionMessage("Notițele au fost salvate.");
    } catch (e) {
      const msg =
        e?.response?.data?.message ||
        e?.message ||
        "Nu am putut salva notițele.";
      setActionError(msg);
    } finally {
      setActionLoading(false);
    }
  };

  const node = (
    <div className={styles.drawerOverlay} onClick={onClose}>
      <aside
        className={styles.drawer}
        onClick={(e) => e.stopPropagation()}
        aria-label="Detalii comandă"
      >
        <header className={styles.drawerHeader}>
          <div>
            <h3 className={styles.drawerTitle}>Comandă #{localOrder.id}</h3>
            <p className={styles.drawerSub}>
              {customerName || "Client necunoscut"} ·{" "}
              <StatusBadge uiStatus={uiStatus} />
            </p>
          </div>
          <button
            type="button"
            className={styles.drawerClose}
            onClick={onClose}
            aria-label="Închide"
          >
            ×
          </button>
        </header>

        <div className={styles.drawerBody}>
          {/* Info de bază */}
          <section className={styles.drawerSection}>
            <h4>Info de bază</h4>
            <div className={styles.drawerField}>
              <span>ID comandă</span>
              <code>{localOrder.id}</code>
            </div>
            <div className={styles.drawerField}>
              <span>User ID</span>
              <span>{localOrder.userId || "—"}</span>
            </div>
            <div className={styles.drawerField}>
              <span>Creată la</span>
              <span>{formatDate(localOrder.createdAt)}</span>
            </div>
            <div className={styles.drawerField}>
              <span>Metodă de plată</span>
              <span>
                {localOrder.paymentMethod === "COD"
                  ? "Plată la livrare (ramburs)"
                  : localOrder.paymentMethod === "CARD"
                  ? "Card online"
                  : localOrder.paymentMethod || "—"}
              </span>
            </div>
            <div className={styles.drawerField}>
              <span>Status intern (DB)</span>
              <span>{localOrder.status || "—"}</span>
            </div>
            <div className={styles.drawerField}>
              <span>Status UI</span>
              <StatusBadge uiStatus={uiStatus} />
            </div>
            <div className={styles.drawerField}>
              <span>Subtotal</span>
              <span>
                {subtotal.toFixed(2)} {currency}
              </span>
            </div>
            <div className={styles.drawerField}>
              <span>Transport</span>
              <span>
                {shippingTotal.toFixed(2)} {currency}
              </span>
            </div>
            <div className={styles.drawerField}>
              <span>Total</span>
              <span>
                <strong>
                  {total.toFixed(2)} {currency}
                </strong>
              </span>
            </div>
          </section>

          {/* Adresă livrare */}
          <section className={styles.drawerSection}>
            <h4>Adresă livrare</h4>
            {shippingAddress ? (
              <>
                <div className={styles.drawerField}>
                  <span>Nume</span>
                  <span>{customerName || "—"}</span>
                </div>
                <div className={styles.drawerField}>
                  <span>Stradă</span>
                  <span>{shippingAddress.street || "—"}</span>
                </div>
                <div className={styles.drawerField}>
                  <span>Oraș</span>
                  <span>{shippingAddress.city || "—"}</span>
                </div>
                <div className={styles.drawerField}>
                  <span>Județ</span>
                  <span>{shippingAddress.county || "—"}</span>
                </div>
                <div className={styles.drawerField}>
                  <span>Cod poștal</span>
                  <span>{shippingAddress.postalCode || "—"}</span>
                </div>
                <div className={styles.drawerField}>
                  <span>Telefon</span>
                  <span>{shippingAddress.phone || "—"}</span>
                </div>
                <div className={styles.drawerField}>
                  <span>Email</span>
                  <span>{shippingAddress.email || "—"}</span>
                </div>
              </>
            ) : (
              <p className={styles.subtle}>Nu există adresă de livrare.</p>
            )}
          </section>

          {/* Produse */}
          <section className={styles.drawerSection}>
            <h4>Produse</h4>
            {flatItems.length ? (
              <div className={styles.drawerList}>
                {flatItems.map((it) => (
                  <div key={it.id} className={styles.drawerListItem}>
                    <div className={styles.drawerListTitle}>{it.title}</div>
                    <div className={styles.drawerListMeta}>
                      x{it.qty} · {Number(it.price).toFixed(2)} {currency} / buc ·{" "}
                      {it._vendorName ? `Vendor: ${it._vendorName}` : "—"}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className={styles.subtle}>
                Nu există items în această comandă.
              </p>
            )}
          </section>

          {/* Shipments */}
          <section className={styles.drawerSection}>
            <h4>Shipments</h4>
            {shipments.length ? (
              <div className={styles.drawerList}>
                {shipments.map((s) => (
                  <div key={s.id} className={styles.drawerListItem}>
                    <div className={styles.drawerListTitle}>
                      {s.vendor?.displayName || "Vendor necunoscut"}{" "}
                      {s.vendor?.city ? `(${s.vendor.city})` : ""}
                    </div>
                    <div className={styles.drawerListMeta}>
                      ID shipment: <code>{s.id}</code>
                      <br />
                      Status: {s.status}
                      <br />
                      AWB: {s.awb || "—"}
                      <br />
                      {s.trackingUrl && (
                        <a
                          href={s.trackingUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Tracking
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className={styles.subtle}>Comanda nu are shipments încă.</p>
            )}
          </section>

          {/* Note interne admin */}
          <section className={styles.drawerSection}>
            <h4>Note interne admin</h4>
            <div className={styles.drawerFieldColumn}>
              <span>Note</span>
              <textarea
                className={styles.textarea}
                rows={4}
                value={adminNotes}
                onChange={(e) => setAdminNotes(e.target.value)}
                placeholder="Ex: 2025-11-25 - client sunat, a confirmat livrarea..."
              />
            </div>
            <div className={styles.drawerActions}>
              <button
                type="button"
                className={styles.adminActionBtn}
                onClick={handleSaveAdminNotes}
                disabled={actionLoading}
              >
                Salvează notițele
              </button>
            </div>
          </section>

          {/* Acțiuni admin */}
          <section className={styles.drawerSection}>
            <h4>Acțiuni admin</h4>
            <div className={styles.drawerActions}>
              <button
                type="button"
                className={styles.adminActionBtn}
                onClick={handleResendConfirmation}
                disabled={actionLoading}
              >
                Retrimite email confirmare
              </button>

              <button
                type="button"
                className={styles.adminActionBtn}
                onClick={handleMarkFulfilled}
                disabled={actionLoading || uiStatus === "DELIVERED"}
              >
                Marchează ca livrată
              </button>

              <button
                type="button"
                className={styles.adminActionBtnDanger}
                onClick={handleCancelOrder}
                disabled={actionLoading || !cancellable}
                title={
                  cancellable
                    ? "Anulează comanda (override user)"
                    : "Comanda nu mai poate fi anulată"
                }
              >
                Anulează comanda
              </button>
            </div>

            {actionError && (
              <p className={styles.actionError}>{actionError}</p>
            )}
            {actionMessage && (
              <p className={styles.actionSuccess}>{actionMessage}</p>
            )}
          </section>
        </div>

        <footer className={styles.drawerFooter}>
          <button
            type="button"
            className={styles.drawerBtnDisabled}
            disabled
            title="În viitor: deschide thread cu clientul / vendorul"
          >
            Mesaje (în curând)
          </button>
        </footer>
      </aside>
    </div>
  );

  return createPortal(node, document.body);
}
