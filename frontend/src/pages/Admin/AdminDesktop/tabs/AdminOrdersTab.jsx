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
   Sursa vânzării - calculată STRICT per Shipment (nu global
   pe Order, care poate fi multi-vendor). Un shipment are UNA
   dintre: Direct / Influencer (referral) / Cod influencer /
   Campanie vendor - niciodată mai multe simultan pe același
   shipment (best promotion + atribuire per-shipment, deja
   garantate la checkout).
----------------------------------------------------- */
const PROMOTION_SOURCE_LABELS = {
  PRODUCT_OF_DAY: "Produsul zilei",
  ARTISAN_OF_WEEK: "Artizanul săptămânii",
  COLLECTION: "Collection",
  CAMPAIGN: "VendorCampaign",
  DISCOUNT_CODE: "Cod de reducere",
};

function getShipmentSource(shipment) {
  if (!shipment) return "Direct";

  if (shipment.influencerId) {
    const hasCode = (shipment.items || []).some(
      (it) => it.discountCodeId
    );
    return hasCode ? "Cod influencer" : "Influencer";
  }

  if (shipment.campaignId) return "Campanie vendor";

  return "Direct";
}

function getOrderSourceSummary(order) {
  const shipments = order?.shipments || [];
  if (!shipments.length) return "Direct";

  const sources = [...new Set(shipments.map(getShipmentSource))];

  if (sources.length === 1) return sources[0];
  return "Surse multiple";
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
        _source: getOrderSourceSummary(o),
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
       const id =
  String(o.id || "").toLowerCase();

const orderNumber =
  String(
    o.orderNumber || ""
  ).toLowerCase();

const userId =
  String(
    o.userId || ""
  ).toLowerCase();

const vendors =
  (o._vendors || [])
    .join(" ")
    .toLowerCase();

const payment =
  String(
    o.paymentMethod || ""
  ).toLowerCase();

return (
  id.includes(q) ||
  orderNumber.includes(q) ||
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
async function handleOpenOrder(
  order
) {
  if (!order?.id) {
    return;
  }

  // Deschidem imediat cu datele din listă
  setSelectedOrder(order);

  try {
    // Apoi încărcăm detaliile complete
    const details =
      await api(
        `/api/admin/orders/${encodeURIComponent(
          order.id
        )}`
      );

    if (details) {
      setSelectedOrder(
        details
      );
    }
  } catch (error) {
    console.error(
      "Admin order details load failed:",
      error
    );
  }
}
  return (
    <>
      {/* Filtre */}
      <div className={styles.filtersRow}>
        <label>
          <span>Caută</span>
          <input
            type="text"
            placeholder="Număr comandă, ID, userId, vendor, metodă plată"
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
  onRowClick={handleOpenOrder}
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

function getOrderDeposits(order) {
  const fromSummary =
    order?.depositSummary?.deposits;

  if (Array.isArray(fromSummary)) {
    return fromSummary;
  }

  return (order?.shipments || [])
    .map((shipment) => {
      if (!shipment?.deposit) {
        return null;
      }

      return {
        shipmentId: shipment.id,
        vendorId: shipment.vendorId,
        vendorName:
          shipment.vendor?.displayName ||
          null,

        ...shipment.deposit,
      };
    })
    .filter(Boolean);
}

function getDepositState(order) {
  const deposits =
    getOrderDeposits(order).filter(
      (deposit) =>
        deposit?.status &&
        deposit.status !==
          "NOT_REQUESTED"
    );

  if (!deposits.length) {
    return {
      code: "NONE",
      label: "—",
    };
  }

  if (
    deposits.some(
      (deposit) =>
        deposit.status === "PENDING"
    )
  ) {
    return {
      code: "PENDING",
      label: "Avans solicitat",
    };
  }

  if (
    deposits.every(
      (deposit) =>
        deposit.status === "PAID"
    )
  ) {
    return {
      code: "PAID",
      label: "Avans plătit",
    };
  }

  if (
    deposits.some(
      (deposit) =>
        deposit.status === "PAID"
    )
  ) {
    return {
      code: "PARTIAL",
      label: "Parțial plătit",
    };
  }

  if (
    deposits.every(
      (deposit) =>
        deposit.status === "REFUNDED"
    )
  ) {
    return {
      code: "REFUNDED",
      label: "Avans rambursat",
    };
  }

  if (
    deposits.some(
      (deposit) =>
        deposit.status === "EXPIRED"
    )
  ) {
    return {
      code: "EXPIRED",
      label: "Avans expirat",
    };
  }

  if (
    deposits.some(
      (deposit) =>
        deposit.status === "FAILED"
    )
  ) {
    return {
      code: "FAILED",
      label: "Plată eșuată",
    };
  }

  return {
    code: "OTHER",
    label: "Avans",
  };
}

function DepositBadge({ order }) {
  const state =
    getDepositState(order);

  if (state.code === "NONE") {
    return (
      <span className={styles.subtle}>
        —
      </span>
    );
  }

  const style = {
    display: "inline-flex",
    alignItems: "center",
    padding: "4px 8px",
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 700,
    whiteSpace: "nowrap",
  };

  if (state.code === "PAID") {
    return (
      <span
        style={{
          ...style,
          background: "#dcfce7",
          color: "#166534",
        }}
      >
        ✓ {state.label}
      </span>
    );
  }

  if (
    state.code === "PENDING" ||
    state.code === "PARTIAL"
  ) {
    return (
      <span
        style={{
          ...style,
          background: "#fef3c7",
          color: "#92400e",
        }}
      >
        ⚠ {state.label}
      </span>
    );
  }

  return (
    <span
      style={{
        ...style,
        background: "#fee2e2",
        color: "#991b1b",
      }}
    >
      {state.label}
    </span>
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
<th>Avans</th>
<th>Total</th>
<th># Shipments</th>
            <th>Vendori</th>
            <th>Sursă</th>
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
              <td>
  {o.userId ? (
    o.userId
  ) : o.isGuestOrder ? (
    <span className={styles.roleBadge}>Guest</span>
  ) : (
    "—"
  )}
</td>
              <td>
                <StatusBadge uiStatus={o._uiStatus} />
              </td>
              <td>
  {o.paymentMethod || "—"}
</td>

<td>
  <DepositBadge order={o} />
</td>

<td>
  {o._total != null
    ? `${o._total.toFixed(2)} ${
        o.currency || "RON"
      }`
    : "—"}
</td>
              <td>{o._shipmentsCount ?? 0}</td>
              <td>{o._vendors?.join(", ") || "—"}</td>
              <td>
                <span className={styles.roleBadge}>
                  {o._source}
                </span>
              </td>
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

  // rezultatul refund-ului CARD apelat ÎN ACEASTĂ sesiune de drawer -
  // folosit doar pentru UI (ascunde/dezactivează butonul, arată detalii);
  // siguranța reală (fără dublu refund) vine din idempotența backend-ului.
  const [refundResult, setRefundResult] = useState(null);
  const [refundModalOpen, setRefundModalOpen] = useState(false);

  useEffect(() => {
    setLocalOrder(order);
    setAdminNotes(order.adminNotes || "");
    setActionError("");
    setActionMessage("");
    setRefundResult(null);
  }, [order]);

  /*
   * Endpoint-ul de listă (GET /api/admin/orders) NU include
   * vendorFinancials/isReversed per shipment - doar detaliul
   * (GET /api/admin/orders/:id) le calculează (buildShipmentFinancialsForAdmin).
   * Hidratăm drawer-ul cu detaliul complet la deschidere, ca secțiunea
   * "Calcul financiar" (comision reversat, net reversat) să se afișeze
   * corect, inclusiv imediat după un refund.
   */
  const reloadOrderDetail = async () => {
    if (!order?.id) return;
    try {
      const detail = await api(
        `/api/admin/orders/${encodeURIComponent(order.id)}`
      );
      if (detail?.id) {
        setLocalOrder(detail);
      }
    } catch (e) {
      console.error("Admin order detail reload failed:", e);
    }
  };

  useEffect(() => {
    reloadOrderDetail();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order?.id]);

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

  /*
   * Eligibilitate refund CARD (Secțiunea 3 din audit) - STRICT
   * paymentMethod === CARD + plată confirmată (paidAt setat de
   * webhook-ul Stripe la payment_intent.succeeded). NU dezactivăm
   * butonul pe baza statusului shipment-ului (RETURNED/REFUSED) sau
   * a vendorFinancials.isReversed, pentru că ambele pot fi adevărate
   * și în cazul în care vendorul a anulat comanda ÎNAINTE de livrare
   * (PATCH /api/vendor/orders/:id/status -> "cancelled"), care
   * reversează DOAR ledger-ul intern, FĂRĂ să atingă Stripe - în acel
   * caz refund-ul Stripe real tot mai trebuie declanșat de admin.
   */
  const isCardOrder =
    String(localOrder.paymentMethod || "").toUpperCase() === "CARD";
  const cardPaymentConfirmed = isCardOrder && Boolean(localOrder.paidAt);
  const cardRefundEligible = isCardOrder && cardPaymentConfirmed;

  // dezactivat doar DUPĂ un refund reușit ÎN ACEASTĂ sesiune de drawer
  // (backend-ul rămâne oricum idempotent la un re-apel după redeschidere)
  const cardRefundDoneThisSession =
    Boolean(refundResult) && !refundResult?.dbReversalNeedsAttention;

const deposits =
  getOrderDeposits(localOrder).filter(
    (deposit) =>
      deposit?.status &&
      deposit.status !==
        "NOT_REQUESTED"
  );

const depositSummary =
  localOrder.depositSummary || {};

const requestedDepositTotal =
  Number(
    depositSummary.requestedTotal ??
      deposits.reduce(
        (sum, deposit) =>
          sum +
          Number(
            deposit.requestedAmount ||
              0
          ),
        0
      )
  );

const paidDepositTotal =
  Number(
    depositSummary.paidTotal ??
      deposits.reduce(
        (sum, deposit) =>
          sum +
          Number(
            deposit.paidAmount ||
              0
          ),
        0
      )
  );

const stripeFeeTotal =
  Number(
    depositSummary.stripeFeeTotal ??
      deposits.reduce(
        (sum, deposit) =>
          sum +
          Number(
            deposit.stripeFeeNet ||
              0
          ),
        0
      )
  );

const vendorTransferTotal =
  Number(
    depositSummary.vendorTransferTotal ??
      deposits.reduce(
        (sum, deposit) =>
          sum +
          Number(
            deposit.vendorTransferNet ||
              0
          ),
        0
      )
  );
  const shippingAddress =
  localOrder.shippingAddress || {};

const customerName =
  localOrder.customerName ||
  shippingAddress.name ||
  `${shippingAddress.lastName || ""} ${
    shippingAddress.firstName || ""
  }`.trim() ||
  "";

const customerEmail =
  localOrder.customerEmail ||
  shippingAddress.email ||
  "—";

const customerPhone =
  localOrder.customerPhone ||
  shippingAddress.phone ||
  "—";

  const flatItems =
  shipments.flatMap((shipment) =>
    (shipment.items || []).map(
      (item) => ({
        ...item,

        _vendorName:
          shipment.vendor
            ?.displayName ||
          null,
      })
    )
  );

const totalDiscount =
  flatItems.reduce(
    (sum, item) =>
      sum +
      Number(
        item.discountAmount ||
          0
      ),
    0
  );

const FUNDING_SOURCE_LABELS = {
  PLATFORM: "Artfest",
  VENDOR: "Vânzător",
  SHARED: "Artfest + vânzător",
};

const appliedDiscountCodes = Object.values(
  flatItems
    .filter((item) => item.discountCodeId)
    .reduce((byCode, item) => {
      const key = item.discountCodeId;

      if (!byCode[key]) {
        byCode[key] = {
          discountCodeId: item.discountCodeId,
          discountCodeText: item.discountCodeText || "—",
          discountCodeFundingSource:
            item.discountCodeFundingSource || null,
          amount: 0,
          platformAmount: 0,
          vendorAmount: 0,
        };
      }

      byCode[key].amount += Number(item.discountCodeAmount || 0);

      /*
       * platformDiscountAmount/vendorDiscountAmount sunt split-ul
       * REAL, deja calculat la checkout (vendorCommissionService),
       * pentru promoția câștigătoare pe această linie - identice cu
       * discountCodeAmount dacă un cod de reducere a câștigat pe
       * toată linia (cazul uzual aici, de vreme ce filtrăm pe
       * discountCodeId).
       */
      byCode[key].platformAmount += Number(
        item.platformDiscountAmount || 0
      );
      byCode[key].vendorAmount += Number(
        item.vendorDiscountAmount || 0
      );

      return byCode;
    }, {})
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

  const handleRefundPayment = async () => {
    if (!localOrder?.id || !isCardOrder) {
      return;
    }

    setRefundModalOpen(false);
    setActionLoading(true);
    setActionError("");
    setActionMessage("");

    try {
      const result = await api(
        `/api/admin/orders/${encodeURIComponent(localOrder.id)}/refund`,
        { method: "POST" }
      );

      // "alreadyRefunded" (alreadyRefundedByStripe) este tot un caz de
      // succes (ok: true), nu o eroare - backend-ul îl tratează idempotent.
      setRefundResult(result);

      setActionMessage(
        result?.message || "Rambursarea a fost inițiată cu succes."
      );

      // reîncărcăm detaliul complet, ca statusul shipment-urilor și
      // secțiunea "Calcul financiar" (comision/net reversat) să reflecte
      // imediat rezultatul refund-ului.
      await reloadOrderDetail();
    } catch (e) {
      console.error("Admin refund failed:", e);

      const msg =
        e?.response?.data?.message ||
        e?.data?.message ||
        e?.message ||
        "Nu am putut rambursa plata.";

      setActionError(msg);
    } finally {
      setActionLoading(false);
    }
  };

  /*
   * Flux SEPARAT, NESCHIMBAT, pentru COD + avans Stripe (CAZ 2 din
   * ruta backend - rambursare doar a avansului, nu a plății integrale
   * CARD). Auditul curent vizează STRICT refund-ul CARD (Secțiunile
   * 1-13); acest caz rămâne pe comportamentul anterior (window.confirm),
   * ca să nu modificăm un flux financiar în afara scopului cerut.
   */
  const handleRefundDeposit = async () => {
    if (!localOrder?.id) {
      return;
    }

    const confirmed = window.confirm(
      `Sigur vrei să rambursezi avansul plătit pentru comanda ${
        localOrder.orderNumber || localOrder.id
      }?\n\n` +
        `Această acțiune va returna avansul clientului și nu trebuie folosită decât după verificarea situației.`
    );

    if (!confirmed) {
      return;
    }

    setActionLoading(true);
    setActionError("");
    setActionMessage("");

    try {
      const result = await api(
        `/api/admin/orders/${encodeURIComponent(localOrder.id)}/refund`,
        { method: "POST" }
      );

      setActionMessage(
        result?.message || "Rambursarea avansului a fost inițiată cu succes."
      );

      await reloadOrderDetail();
    } catch (e) {
      console.error("Admin deposit refund failed:", e);

      const msg =
        e?.response?.data?.message ||
        e?.data?.message ||
        e?.message ||
        "Nu am putut rambursa avansul.";

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
  <span>Tip comandă</span>
  <span>
    {localOrder.isGuestOrder
      ? "Guest"
      : "Utilizator autentificat"}
  </span>
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
  <span>Subtotal produse</span>

  <span>
    {subtotal.toFixed(2)}{" "}
    {currency}
  </span>
</div>

{totalDiscount > 0 && (
  <div
    className={
      styles.drawerField
    }
  >
    <span>Reduceri aplicate</span>

    <span
      style={{
        color:
          "#16a34a",
        fontWeight:
          600,
      }}
    >
      −
      {totalDiscount.toFixed(
        2
      )}{" "}
      {currency}
    </span>
  </div>
)}

{appliedDiscountCodes.map((dc) => (
  <div
    className={styles.drawerField}
    key={dc.discountCodeId}
  >
    <span>Cod de reducere</span>

    <span>
      {dc.discountCodeText}
      {" · "}
      {FUNDING_SOURCE_LABELS[dc.discountCodeFundingSource] ||
        dc.discountCodeFundingSource ||
        "—"}
      {" · "}Total −{dc.amount.toFixed(2)} {currency}
      {dc.discountCodeFundingSource === "SHARED" && (
        <>
          {" "}(din care Artfest −{dc.platformAmount.toFixed(2)}{" "}
          {currency}, vânzător −{dc.vendorAmount.toFixed(2)} {currency})
        </>
      )}
    </span>
  </div>
))}

<div className={styles.drawerField}>
  <span>Transport</span>

  <span>
    {shippingTotal.toFixed(
      2
    )}{" "}
    {currency}
  </span>
</div>

<div className={styles.drawerField}>
  <span>Total plătit</span>

  <span>
    <strong>
      {total.toFixed(2)}{" "}
      {currency}
    </strong>
  </span>
</div>
          </section>
{/* Avans / Stripe */}
{deposits.length > 0 && (
  <section
    className={styles.drawerSection}
  >
    <h4>💳 Avans & plăți Stripe</h4>

    <div
      className={styles.drawerField}
    >
      <span>Status avans</span>

      <DepositBadge
        order={localOrder}
      />
    </div>

    <div
      className={styles.drawerField}
    >
      <span>Avans solicitat</span>

      <strong>
        {requestedDepositTotal.toFixed(
          2
        )}{" "}
        {currency}
      </strong>
    </div>

    <div
      className={styles.drawerField}
    >
      <span>Avans plătit</span>

      <strong>
        {paidDepositTotal.toFixed(2)}{" "}
        {currency}
      </strong>
    </div>

    {stripeFeeTotal > 0 && (
      <div
        className={styles.drawerField}
      >
        <span>Taxă Stripe</span>

        <span>
          {stripeFeeTotal.toFixed(2)}{" "}
          {currency}
        </span>
      </div>
    )}

    {vendorTransferTotal > 0 && (
      <div
        className={styles.drawerField}
      >
        <span>
          Transfer către vendor
        </span>

        <strong>
          {vendorTransferTotal.toFixed(
            2
          )}{" "}
          {currency}
        </strong>
      </div>
    )}

    <div
      style={{
        marginTop: 14,
        display: "grid",
        gap: 10,
      }}
    >
      {deposits.map(
        (deposit) => (
          <div
            key={
              deposit.shipmentId ||
              deposit.stripePaymentIntentId
            }
            style={{
              padding: 12,
              border:
                "1px solid #e5e7eb",
              borderRadius: 10,
            }}
          >
            <div
              style={{
                fontWeight: 700,
                marginBottom: 8,
              }}
            >
              {deposit.vendorName ||
                "Vendor"}
            </div>

            <div
              className={
                styles.drawerListMeta
              }
            >
              Status:{" "}
              <strong>
                {
                  {
                    NOT_REQUESTED: "nesolicitat",
                    PENDING: "solicitat, neplătit",
                    PAID: "plătit",
                    FAILED: "plată eșuată",
                    EXPIRED: "expirat",
                    REFUNDED: "rambursat",
                  }[deposit.status] ||
                    deposit.status ||
                    "—"
                }
              </strong>

              <br />

              Procent:{" "}
              {deposit.percent != null
                ? `${deposit.percent}%`
                : "—"}

              <br />

              Solicitat:{" "}
              {Number(
                deposit.requestedAmount ||
                  0
              ).toFixed(2)}{" "}
              {currency}

              <br />

              Plătit:{" "}
              {Number(
                deposit.paidAmount ||
                  0
              ).toFixed(2)}{" "}
              {currency}

              {deposit.remainingCodAmount !=
                null && (
                <>
                  <br />
                  Rămas ramburs:{" "}
                  {Number(
                    deposit.remainingCodAmount
                  ).toFixed(2)}{" "}
                  {currency}
                </>
              )}

              {deposit.stripeFeeNet !=
                null && (
                <>
                  <br />
                  Taxă Stripe:{" "}
                  {Number(
                    deposit.stripeFeeNet
                  ).toFixed(2)}{" "}
                  {currency}
                </>
              )}

              {deposit.vendorTransferNet !=
                null && (
                <>
                  <br />
                  Transfer vendor:{" "}
                  <strong>
                    {Number(
                      deposit.vendorTransferNet
                    ).toFixed(2)}{" "}
                    {currency}
                  </strong>
                </>
              )}

              {deposit.paidAt && (
                <>
                  <br />
                  Plătit la:{" "}
                  {formatDate(
                    deposit.paidAt
                  )}
                </>
              )}

              {deposit.stripePaymentIntentId && (
                <>
                  <br />
                  Payment Intent:{" "}
                  <code>
                    {
                      deposit.stripePaymentIntentId
                    }
                  </code>
                </>
              )}

              {deposit.stripeChargeId && (
                <>
                  <br />
                  Charge:{" "}
                  <code>
                    {
                      deposit.stripeChargeId
                    }
                  </code>
                </>
              )}

              {deposit.stripeTransferId && (
                <>
                  <br />
                  Transfer:{" "}
                  <code>
                    {
                      deposit.stripeTransferId
                    }
                  </code>
                </>
              )}

              {deposit.paymentError && (
                <>
                  <br />
                  <span
                    style={{
                      color: "#b91c1c",
                      fontWeight: 600,
                    }}
                  >
                    Eroare:{" "}
                    {
                      deposit.paymentError
                    }
                  </span>
                </>
              )}

              {deposit.refunded && (
                <>
                  <br />
                  <span
                    style={{
                      color: "#991b1b",
                      fontWeight: 700,
                    }}
                  >
                    ↩ Avans rambursat
                    {deposit.refundedAmount != null
                      ? `: ${Number(deposit.refundedAmount).toFixed(2)} ${currency}`
                      : ""}
                  </span>

                  {deposit.refundedAt && (
                    <>
                      <br />
                      Rambursat la:{" "}
                      {formatDate(deposit.refundedAt)}
                    </>
                  )}

                  {deposit.stripeRefundId && (
                    <>
                      <br />
                      Refund ID:{" "}
                      <code>{deposit.stripeRefundId}</code>
                    </>
                  )}

                  {deposit.refundReversalId && (
                    <>
                      <br />
                      Reversal ID:{" "}
                      <code>{deposit.refundReversalId}</code>
                    </>
                  )}
                </>
              )}
            </div>
          </div>
        )
      )}
    </div>
  </section>
)}
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
                 <span>{customerPhone}</span>
                </div>
                <div className={styles.drawerField}>
                  <span>Email</span>
                  <span>{customerEmail}</span>
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
                   <div
  className={
    styles.drawerListMeta
  }
>
  x{it.qty} ·{" "}

  {it.originalPrice !=
    null &&
  Number(
    it.originalPrice
  ) >
    Number(
      it.price
    ) ? (
    <>
      <span
        style={{
          textDecoration:
            "line-through",
          color:
            "#9ca3af",
          marginRight:
            6,
        }}
      >
        {Number(
          it.originalPrice
        ).toFixed(2)}{" "}
        {currency}
      </span>

      <strong>
        {Number(
          it.price
        ).toFixed(2)}{" "}
        {currency}
      </strong>

      {Number(
        it.originalPrice
      ) > 0 && (
        <span
          style={{
            color:
              "#16a34a",
            marginLeft:
              6,
            fontWeight:
              600,
          }}
        >
          −
          {Math.round(
            (
              (
                Number(
                  it.originalPrice
                ) -
                Number(
                  it.price
                )
              ) /
              Number(
                it.originalPrice
              )
            ) *
              100
          )}
          %
        </span>
      )}
    </>
  ) : (
    <>
      {Number(
        it.price
      ).toFixed(2)}{" "}
      {currency}
    </>
  )}

  {" · "}

  {it._vendorName
    ? `Vendor: ${it._vendorName}`
    : "—"}

  {" · "}
  {PROMOTION_SOURCE_LABELS[it.discountSource] || "Fără promoție"}
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
                {shipments.map((s) => {
                  const shipmentItems = s.items || [];

                  const shipmentSource = getShipmentSource(s);

                  const attributionType = s.influencerId
                    ? shipmentItems.some((it) => it.discountCodeId)
                      ? "Cod de reducere"
                      : "Referral (?ref=)"
                    : null;

                  const totalDiscount = shipmentItems.reduce(
                    (sum, it) => sum + Number(it.discountAmount || 0),
                    0
                  );

                  const platformDiscount = shipmentItems.reduce(
                    (sum, it) =>
                      sum + Number(it.platformDiscountAmount || 0),
                    0
                  );

                  const vendorDiscount = shipmentItems.reduce(
                    (sum, it) => sum + Number(it.vendorDiscountAmount || 0),
                    0
                  );

                  const winningSources = [
                    ...new Set(
                      shipmentItems
                        .map((it) => it.discountSource)
                        .filter(Boolean)
                    ),
                  ];

                  return (
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

                      <div
                        className={styles.drawerListMeta}
                        style={{ marginTop: 8 }}
                      >
                        <strong>Sursă vânzare:</strong> {shipmentSource}
                        <br />
                        {s.influencerId && (
                          <>
                            <strong>Influencer:</strong>{" "}
                            {s.influencer?.displayName || "—"}
                            {" · "}
                            {attributionType}
                            <br />
                          </>
                        )}
                        {s.campaignId && (
                          <>
                            <strong>Campanie vendor:</strong>{" "}
                            {s.campaign?.name || "—"}
                            <br />
                          </>
                        )}
                        <strong>Promoția câștigătoare:</strong>{" "}
                        {winningSources.length
                          ? winningSources
                              .map(
                                (src) =>
                                  PROMOTION_SOURCE_LABELS[src] || src
                              )
                              .join(", ")
                          : "Fără promoție"}
                        <br />
                        <strong>Reducere totală:</strong>{" "}
                        {totalDiscount.toFixed(2)} RON
                        {" · "}
                        <strong>Artfest:</strong>{" "}
                        {platformDiscount.toFixed(2)} RON
                        {" · "}
                        <strong>Vendor:</strong>{" "}
                        {vendorDiscount.toFixed(2)} RON
                      </div>

                      {s.vendorFinancials && (
                        <div
                          className={styles.drawerListMeta}
                          style={{ marginTop: 8 }}
                        >
                          <strong>
                            {s.vendorFinancials.isMixedCommission
                              ? "Comision mixt"
                              : `Comision ${
                                  s.vendorFinancials.commissionSource === "campaign"
                                    ? "campanie"
                                    : s.vendorFinancials.commissionSource ===
                                      "vendor_collection_own_sale"
                                    ? "colecție / vânzare proprie"
                                    : s.vendorFinancials.commissionSource ===
                                      "vendor_referral_own_sale"
                                    ? "recomandare proprie"
                                    : "standard"
                                }${
                                  s.vendorFinancials.commissionBps != null
                                    ? ` (${(s.vendorFinancials.commissionBps / 100).toFixed(2)}%)`
                                    : ""
                                }`}
                            :
                          </strong>{" "}
                          {s.vendorFinancials.isMixedCommission &&
                            Array.isArray(s.vendorFinancials.commissionGroups) && (
                              <>
                                {s.vendorFinancials.commissionGroups
                                  .map(
                                    (g) =>
                                      `${
                                        g.label === "campaign" ? "campanie" : "standard"
                                      } ${(g.commissionBps / 100).toFixed(2)}% pe ${
                                        g.itemCount
                                      } ${g.itemCount === 1 ? "produs" : "produse"} (${Number(
                                        g.itemsAfterDiscount || 0
                                      ).toFixed(2)} RON)`
                                  )
                                  .join(" · ")}
                                {" · "}
                              </>
                            )}
                          Bază de calcul{" "}
                          {Number(s.vendorFinancials.itemsNet || 0).toFixed(2)}{" "}
                          RON
                          {s.vendorFinancials.commissionAmount != null && (
                            <>
                              {" · "}
                              Comision Artfest brut{" "}
                              {Number(s.vendorFinancials.commissionAmount || 0).toFixed(2)}{" "}
                              RON
                            </>
                          )}
                          {Number(s.vendorFinancials.platformSubsidyAmount || 0) > 0 && (
                            <>
                              {" · "}
                              Subvenție Artfest{" "}
                              {Number(s.vendorFinancials.platformSubsidyAmount || 0).toFixed(2)}{" "}
                              RON
                            </>
                          )}
                          {" · "}
                          Comision Artfest (net){" "}
                          {Number(s.vendorFinancials.commissionNet || 0).toFixed(2)}{" "}
                          RON
                          {" · "}
                          Net magazin{" "}
                          {Number(s.vendorFinancials.vendorNet || 0).toFixed(2)}{" "}
                          RON
                          {" · "}
                          Net Artfest{" "}
                          {Number(
                            s.vendorFinancials.netArtfestAfterAttribution ??
                              s.vendorFinancials.commissionNet ??
                              0
                          ).toFixed(2)}{" "}
                          RON
                          {!s.vendorFinancials.isSnapshot && (
                            <span className={styles.subtle}> · estimat (comanda nu a fost încă finalizată)</span>
                          )}
                          {s.vendorFinancials.isReversed && (
                            <span className={styles.subtle}> · reversat (retur/refuz)</span>
                          )}
                          <br />
                          Metodă plată: {localOrder.paymentMethod || "—"}
                          {localOrder.paymentMethod === "COD" &&
                            s.deposit?.status &&
                            s.deposit.status !== "NOT_REQUESTED" && (
                              <>
                                {" · "}
                                Avans: {s.deposit.status}
                                {s.deposit.requestedAmount != null &&
                                  ` (${Number(s.deposit.requestedAmount).toFixed(2)} RON)`}
                                {s.deposit.remainingCodAmount != null &&
                                  `, rest ramburs ${Number(s.deposit.remainingCodAmount).toFixed(2)} RON`}
                              </>
                            )}
                        </div>
                      )}

                      {(s.influencerCommission || s.vendorReferralCommission) && (
                        <div
                          className={styles.drawerListMeta}
                          style={{ marginTop: 8 }}
                        >
                          {s.influencerCommission && (
                            <>
                              <strong>Comision influencer</strong>
                              {s.influencerCommission.name
                                ? ` (${s.influencerCommission.name})`
                                : ""}
                              : {Number(s.influencerCommission.amount || 0).toFixed(2)} RON
                              {" "}({s.influencerCommission.commissionPercent}% din comisionul Artfest)
                              {!s.influencerCommission.isSnapshot && " · estimat"}
                              <br />
                            </>
                          )}
                          {s.vendorReferralCommission && (
                            <>
                              <strong>Comision recomandare</strong>
                              {s.vendorReferralCommission.name
                                ? ` (${s.vendorReferralCommission.name})`
                                : ""}
                              : {Number(s.vendorReferralCommission.amount || 0).toFixed(2)} RON
                              {" "}({s.vendorReferralCommission.commissionPercent}% din comisionul Artfest)
                              {!s.vendorReferralCommission.isSnapshot && " · estimat"}
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
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
              {isCardOrder ? (
                <button
                  type="button"
                  className={styles.adminActionBtnDanger}
                  onClick={() => setRefundModalOpen(true)}
                  disabled={
                    actionLoading ||
                    !cardRefundEligible ||
                    cardRefundDoneThisSession
                  }
                  title={
                    !cardPaymentConfirmed
                      ? "Plata cu cardul nu este încă confirmată."
                      : cardRefundDoneThisSession
                      ? "Rambursarea a fost deja efectuată în această sesiune."
                      : "Rambursează integral plata cu cardul"
                  }
                >
                  {actionLoading
                    ? "Se procesează..."
                    : cardRefundDoneThisSession
                    ? "Plată rambursată"
                    : "Rambursează plata"}
                </button>
              ) : (
                <button
                  type="button"
                  className={styles.adminActionBtnDanger}
                  onClick={handleRefundDeposit}
                  disabled={actionLoading || paidDepositTotal <= 0}
                  title={
                    paidDepositTotal > 0
                      ? "Rambursează avansul plătit online clientului"
                      : "Această comandă nu are un avans online de rambursat"
                  }
                >
                  {actionLoading ? "Se procesează..." : "Rambursează avansul"}
                </button>
              )}
            </div>

            {actionError && (
              <p className={styles.actionError}>{actionError}</p>
            )}
            {actionMessage && !refundResult?.dbReversalNeedsAttention && (
              <p className={styles.actionSuccess}>{actionMessage}</p>
            )}
            {refundResult?.dbReversalNeedsAttention && (
              <p
                className={styles.actionError}
                style={{
                  background: "#fef2f2",
                  border: "1px solid #fecaca",
                  borderRadius: 8,
                  padding: "8px 12px",
                  fontWeight: 600,
                }}
              >
                Rambursarea Stripe a fost efectuată, dar actualizarea
                financiară internă necesită reverificare. Reîncearcă sau
                contactează suportul tehnic.
              </p>
            )}
            {refundResult?.ok && (
              <p className={styles.subtle} style={{ fontSize: 12 }}>
                {refundResult.refundId && (
                  <>ID rambursare Stripe: {refundResult.refundId} · </>
                )}
                {refundResult.refundedAmount != null && (
                  <>
                    Sumă rambursată: {Number(refundResult.refundedAmount).toFixed(2)}{" "}
                    {refundResult.currency || currency}
                  </>
                )}
              </p>
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

  const refundModalNode = refundModalOpen && (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.45)",
        zIndex: 10000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
      onClick={() => setRefundModalOpen(false)}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Confirmare rambursare"
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#fff",
          borderRadius: 12,
          maxWidth: 440,
          width: "100%",
          padding: 24,
          boxShadow: "0 10px 40px rgba(0,0,0,0.25)",
        }}
      >
        <h3 style={{ marginTop: 0 }}>Confirmă rambursarea</h3>

        <div style={{ fontSize: 14, lineHeight: 1.6, marginBottom: 12 }}>
          <div>
            <strong>Comandă:</strong>{" "}
            {localOrder.orderNumber || localOrder.id}
          </div>
          <div>
            <strong>Sumă rambursată:</strong> {total.toFixed(2)} {currency}
          </div>
          <div>
            <strong>Metodă de plată:</strong> Card
          </div>
          <div>
            <strong>Tip rambursare:</strong> Rambursare integrală
          </div>
        </div>

        <p
          style={{
            background: "#fef2f2",
            border: "1px solid #fecaca",
            color: "#991b1b",
            borderRadius: 8,
            padding: "10px 12px",
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          Această acțiune va rambursa plata clientului și va reversa
          evidențele financiare asociate comenzii.
          <br />
          Acțiunea nu poate fi anulată.
        </p>

        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 10,
            marginTop: 16,
          }}
        >
          <button
            type="button"
            className={styles.adminActionBtn}
            onClick={() => setRefundModalOpen(false)}
            disabled={actionLoading}
          >
            Renunță
          </button>
          <button
            type="button"
            className={styles.adminActionBtnDanger}
            onClick={handleRefundPayment}
            disabled={actionLoading}
          >
            {actionLoading ? "Se procesează..." : "Confirmă rambursarea"}
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(
    <>
      {node}
      {refundModalNode}
    </>,
    document.body
  );
}
