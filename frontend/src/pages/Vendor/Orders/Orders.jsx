import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../../../lib/api";
import { useAuth } from "../../Auth/Context/context.js";
import {
  Search,
  Filter,
  Calendar,
  RefreshCw,
  Loader2,
  ChevronLeft,
  ChevronRight,
  Download,
  PackageCheck,
  FileText,
  Send,
  MessageSquare,
  Plus,
  XCircle,
} from "lucide-react";
import styles from "./Orders.module.css";
import SubscriptionBanner from "../Onboarding/OnBoardingDetails/tabs/SubscriptionBanner/SubscriptionBanner.jsx";

import UserOrdersPage from "../../User/Orders/UserOrders";
import VendorManualOrderModal from "./VendorManualOrderModal.jsx";

/* Utils */
function formatMoney(n) {
  const v = Number(n || 0);
  return new Intl.NumberFormat("ro-RO", {
    style: "currency",
    currency: "RON",
  }).format(v);
}
function formatDate(d) {
  try {
    const dt = new Date(d);
    return new Intl.DateTimeFormat("ro-RO", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(dt);
  } catch {
    return d || "";
  }
}

const STATUS_OPTIONS = [
  { value: "", label: "Toate" },
  { value: "new", label: "Nouă" },
  { value: "preparing", label: "În pregătire" },
  { value: "confirmed", label: "Confirmată (gata de predare)" },
  { value: "fulfilled", label: "Finalizată" },
  { value: "cancelled", label: "Anulată" },
];

const CANCEL_REASONS = [
  { value: "client_no_answer", label: "Clientul nu răspunde la telefon" },
  { value: "client_request", label: "Clientul a solicitat anularea" },
  { value: "stock_issue", label: "Produs indisponibil / stoc epuizat" },
  { value: "address_issue", label: "Adresă incompletă / imposibil de livrat" },
  { value: "payment_issue", label: "Probleme cu plata" },
  { value: "other", label: "Alt motiv" },
];

function getLeadStatusLabel(st) {
  if (!st) return null;
  switch (st) {
    case "nou":
      return "Lead nou";
    case "in_discutii":
      return "În discuții";
    case "oferta_trimisa":
      return "Ofertă trimisă";
    case "rezervat":
      return "Rezervat";
    case "pierdut":
      return "Pierdut";
    default:
      return st;
  }
}

export default function VendorOrdersPage() {
  const { me } = useAuth();
  const isVendor = me?.role === "VENDOR";
  const navigate = useNavigate();

  const [activeTab, setActiveTab] = useState("vendor");

  // 👇 nou: detectăm mobil + ce comandă e deschisă în modal
  const [isMobile, setIsMobile] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState(null);

  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [manualOrderOpen, setManualOrderOpen] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [data, setData] = useState({ items: [], total: 0 });

  const [courierOrder, setCourierOrder] = useState(null);

  const [billingReady, setBillingReady] = useState(false);
  const [billingLoading, setBillingLoading] = useState(true);
  const [billingError, setBillingError] = useState("");

  const [invoiceOrder, setInvoiceOrder] = useState(null);
  const [invoiceLoadingId, setInvoiceLoadingId] = useState(null);

  const [cancelOrder, setCancelOrder] = useState(null);

  const [startingMessageOrderId, setStartingMessageOrderId] = useState(null);

  const [filtersOpen, setFiltersOpen] = useState(false);

  const totalPages = Math.max(1, Math.ceil((data?.total || 0) / pageSize));
  const query = useMemo(
    () => ({ q, status, from, to, page, pageSize, reloadToken }),
    [q, status, from, to, page, pageSize, reloadToken]
  );

  function handleResetFilters() {
    setPage(1);
    setQ("");
    setStatus("");
    setFrom("");
    setTo("");
  }

  useEffect(() => {
    let alive = true;
    async function run() {
      if (!isVendor || activeTab !== "vendor") return;
      setLoading(true);
      setErr("");
      try {
        const qs = new URLSearchParams(
          Object.fromEntries(
            Object.entries(query).filter(([v]) => v !== "" && v != null)
          )
        ).toString();
        const res = await api(`/api/vendor/orders?${qs}`);
        if (!alive) return;
        setData({
          items: Array.isArray(res?.items) ? res.items : [],
          total: Number(res?.total || 0),
        });
      } catch {
        if (!alive) return;
        setErr("Nu am putut încărca comenzile. Încearcă din nou.");
      } finally {
        if (alive) setLoading(false);
      }
    }
    run();
    return () => {
      alive = false;
    };
  }, [query, isVendor, activeTab]);

  useEffect(() => {
    if (!isVendor) return;

    let alive = true;
    async function run() {
      setBillingLoading(true);
      setBillingError("");
      try {
        const res = await api("/api/vendors/me/billing", {
          method: "GET",
        });
        const b = res?.billing || {};

        const hasMinBilling =
          b.legalType &&
          b.companyName &&
          b.cui &&
          b.regCom &&
          b.address &&
          b.iban &&
          b.bank &&
          b.email;

        if (!alive) return;
        setBillingReady(!!hasMinBilling);
        if (!hasMinBilling) {
          setBillingError(
            "Completează și salvează datele de facturare pentru a putea genera facturi."
          );
        }
      } catch {
        if (!alive) return;
        setBillingError(
          "Nu am putut încărca datele de facturare. Nu poți genera facturi acum."
        );
        setBillingReady(false);
      } finally {
        if (alive) setBillingLoading(false);
      }
    }

    run();
    return () => {
      alive = false;
    };
  }, [isVendor]);

  // 👇 detectăm mobil (sub 720px)
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(max-width: 720px)");

    const update = () => setIsMobile(mq.matches);
    update();

    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  if (!isVendor) {
    return (
      <main className={styles.page}>
        <div className={styles.card}>
          <h1 className={styles.h1}>Comenzile mele</h1>
          <p className={styles.muted}>
            Această pagină este disponibilă doar pentru conturile de tip
            vânzător.
          </p>
        </div>
      </main>
    );
  }

  function openCourierModal(orderRow) {
    setCourierOrder(orderRow);
  }
  function closeCourierModal() {
    setCourierOrder(null);
  }

  function openInvoiceModal(orderRow) {
    if (!billingReady) {
      alert(
        "Pentru a genera facturi, te rugăm să completezi și să salvezi mai întâi datele de facturare."
      );
      return;
    }
    setInvoiceOrder(orderRow);
  }
  function closeInvoiceModal() {
    setInvoiceOrder(null);
  }

  // 👇 acum primește obiectul comenzii
  function handleRowClick(order) {
    if (isMobile) {
      setSelectedOrder(order); // pe mobil deschidem modal
    } else {
      navigate(`/vendor/orders/${order.id}`); // pe desktop mergem în pagina de detalii
    }
  }

  async function handleInvoiceSaved(orderId) {
    setInvoiceLoadingId(orderId);
    try {
      const res = await api(
        `/api/vendor/orders?${new URLSearchParams({
          q: orderId,
          page: 1,
          pageSize: 1,
        }).toString()}`
      );
      const fresh = res?.items?.[0];
      if (fresh) {
        setData((prev) => ({
          ...prev,
          items: prev.items.map((x) =>
            x.id === orderId ? { ...x, ...fresh } : x
          ),
        }));
      }
    } catch (e) {
      console.error(e);
    } finally {
      setInvoiceLoadingId(null);
    }
  }

  async function handleContactClient(order) {
    if (order.messageThreadId) {
      navigate(`/mesaje?threadId=${order.messageThreadId}`);
      return;
    }

    try {
      setStartingMessageOrderId(order.id);

      const res = await api(
        `/api/inbox/ensure-thread-from-order/${order.id}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
        }
      );

      if (!res?.threadId) {
        alert("Nu am putut crea conversația cu clientul.");
        return;
      }

      navigate(`/vendor/messages?threadId=${res.threadId}`);
    } catch (e) {
      console.error("Eroare la pornirea conversației", e);
      alert("Nu am putut porni conversația cu clientul. Încearcă din nou.");
    } finally {
      setStartingMessageOrderId(null);
    }
  }

  const hasActiveFilters = !!(status || from || to);
  const activeFiltersLabel = [
    status &&
      `Status: ${
        STATUS_OPTIONS.find((s) => s.value === status)?.label || status
      }`,
    from && `De la: ${from}`,
    to && `Până la: ${to}`,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <main className={styles.page}>
      <SubscriptionBanner />

      <div className={styles.headerRow}>
        <h1 className={styles.h1}>Comenzile mele</h1>

        {activeTab === "vendor" && (
          <div className={styles.headerActions}>
            <button
              className={styles.primaryBtn}
              onClick={() => setManualOrderOpen(true)}
              title="Adaugă o comandă manuală pentru acest magazin"
            >
              <Plus size={16} /> Adaugă comandă
            </button>
            <Link
              to="/vendor/orders/planning"
              className={styles.secondaryBtn}
              title="Planificare comenzi"
            >
              <Calendar size={16} /> Planificare
            </Link>

            <button
              className={styles.secondaryBtn}
              onClick={() => {
                const rows = [
                  [
                    "ID",
                    "Data",
                    "Client",
                    "Telefon",
                    "Email",
                    "Status",
                    "Total",
                    "AWB",
                    "Pickup",
                    "Slot",
                  ],
                  ...data.items.map((o) => [
                    o.id,
                    formatDate(o.createdAt),
                    o.customerName || "",
                    o.customerPhone || "",
                    o.customerEmail || "",
                    o.status || "",
                    String(o.total || 0).replace(".", ","),
                    o.awb || "",
                    o.pickupDate
                      ? new Date(o.pickupDate).toISOString().slice(0, 10)
                      : "",
                    o.pickupSlotStart && o.pickupSlotEnd
                      ? `${new Date(o.pickupSlotStart).toLocaleTimeString(
                          "ro-RO",
                          {
                            hour: "2-digit",
                            minute: "2-digit",
                          }
                        )}-${new Date(o.pickupSlotEnd).toLocaleTimeString(
                          "ro-RO",
                          {
                            hour: "2-digit",
                            minute: "2-digit",
                          }
                        )}`
                      : "",
                  ]),
                ];
                const csv = rows
                  .map((r) =>
                    r
                      .map((x) => `"${String(x ?? "").replace(/"/g, '""')}"`)
                      .join(",")
                  )
                  .join("\n");
                const blob = new Blob([csv], {
                  type: "text/csv;charset=utf-8",
                });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `comenzi-${new Date()
                  .toISOString()
                  .slice(0, 10)}.csv`;
                a.click();
                URL.revokeObjectURL(url);
              }}
              title="Export CSV"
            >
              <Download size={16} /> Export
            </button>
          </div>
        )}
      </div>

      <div className={styles.tabs}>
        <button
          type="button"
          className={`${styles.tab} ${
            activeTab === "vendor" ? styles.tabActive : ""
          }`}
          onClick={() => setActiveTab("vendor")}
        >
          Comenzi primite
        </button>

        <button
          type="button"
          className={`${styles.tab} ${
            activeTab === "client" ? styles.tabActive : ""
          }`}
          onClick={() => setActiveTab("client")}
        >
          Comenzi plasate de mine
        </button>
      </div>

      {activeTab === "vendor" && (
        <>
          {/* Bara compactă: căutare + Filtre + Reset */}
          <div className={styles.filters}>
            <div className={styles.inputWrap}>
              <Search size={16} className={styles.inputIcon} />
              <input
                value={q}
                onChange={(e) => {
                  setPage(1);
                  setQ(e.target.value);
                }}
                placeholder="Caută după nume client, telefon, ID…"
                className={styles.input}
                aria-label="Căutare în comenzi"
              />
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  type="button"
                  className={styles.secondaryBtn}
                  onClick={() => setFiltersOpen(true)}
                  aria-label="Deschide filtre"
                >
                  <Filter size={16} /> Filtre
                </button>
                <button
                  type="button"
                  className={styles.secondaryBtn}
                  onClick={handleResetFilters}
                  aria-label="Resetează filtrele"
                >
                  <RefreshCw size={16} /> Reset
                </button>
              </div>
              {hasActiveFilters && (
                <span className={styles.muted} style={{ fontSize: 12 }}>
                  {activeFiltersLabel}
                </span>
              )}
            </div>
          </div>

          <div className={styles.card}>
            <div
              className={styles.tableWrap}
              role="region"
              aria-label="Tabel comenzi"
            >
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
                          <Loader2 className={styles.spin} size={16} /> Se
                          încarcă…
                        </td>
                      </tr>
                    ))}

                  {!loading && data.items.length === 0 && (
                    <tr>
                      <td colSpan={7} className={styles.emptyCell}>
                        Nu există comenzi pentru filtrele curente.
                      </td>
                    </tr>
                  )}

                  {!loading &&
                    data.items.map((o) => {
                      const leadLabel = getLeadStatusLabel(o.leadStatus);
                      const cancelReasonLabel =
                        o.cancelReason &&
                        (CANCEL_REASONS.find((r) => r.value === o.cancelReason)
                          ?.label || o.cancelReason);

                      return (
                        <tr
                          key={o.id}
                          className={styles.orderRow}
                          onClick={() => handleRowClick(o)}
                        >
                          <td>
                            <code>{o.shortId || o.id}</code>
                          </td>
                          <td>{formatDate(o.createdAt)}</td>
                          <td>
                            <div className={styles.clientCol}>
                              <div className={styles.clientName}>
                                {o.customerName || "—"}
                              </div>
                              <div className={styles.clientNote}>
                                {o.eventName || o.address?.city || ""}
                              </div>
                              {(o.awb || o.pickupDate || leadLabel) && (
                                <div className={styles.inlineChips}>
                                  {o.awb && (
                                    <span
                                      className={`${styles.badge} ${styles.badgeConfirmed}`}
                                    >
                                      AWB {o.awb}
                                    </span>
                                  )}
                                  {o.pickupDate && (
                                    <span className={styles.badge}>
                                      Ridicare{" "}
                                      {new Date(
                                        o.pickupDate
                                      ).toLocaleDateString("ro-RO", {
                                        weekday: "short",
                                        day: "2-digit",
                                        month: "short",
                                      })}{" "}
                                      {o.pickupSlotStart && o.pickupSlotEnd ? (
                                        <>
                                          {new Date(
                                            o.pickupSlotStart
                                          ).toLocaleTimeString("ro-RO", {
                                            hour: "2-digit",
                                            minute: "2-digit",
                                          })}
                                          {"–"}
                                          {new Date(
                                            o.pickupSlotEnd
                                          ).toLocaleTimeString("ro-RO", {
                                            hour: "2-digit",
                                            minute: "2-digit",
                                          })}
                                        </>
                                      ) : null}
                                    </span>
                                  )}

                                  {leadLabel && (
                                    <span
                                      className={`${styles.badge} ${
                                        styles.badgeLead || ""
                                      }`}
                                    >
                                      {leadLabel}
                                    </span>
                                  )}
                                </div>
                              )}
                            </div>
                          </td>
                          <td className={styles.hideSm}>
                            <div className={styles.clientContact}>
                              {o.customerPhone && (
                                <a
                                  href={`tel:${o.customerPhone}`}
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  {o.customerPhone}
                                </a>
                              )}
                              {o.customerEmail && (
                                <a
                                  href={`mailto:${o.customerEmail}`}
                                  onClick={(e) => e.stopPropagation()}
                                >
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
                                {STATUS_OPTIONS.find(
                                  (s) => s.value === o.status
                                )?.label ||
                                  o.status ||
                                  "—"}
                              </span>

                              {o.paymentMethod && (
                                <div className={styles.clientNote}>
                                  {o.paymentMethod === "COD"
                                    ? "Plată la livrare"
                                    : "Card online"}
                                </div>
                              )}

                              {o.invoiceNumber && (
                                <div className={styles.clientNote}>
                                  Factură: <strong>{o.invoiceNumber}</strong>
                                  {o.invoiceDate && (
                                    <>
                                      {" · "}
                                      {new Date(
                                        o.invoiceDate
                                      ).toLocaleDateString("ro-RO")}
                                    </>
                                  )}
                                </div>
                              )}

                              {cancelReasonLabel && (
                                <div className={styles.clientNote}>
                                  Motiv anulare:{" "}
                                  <strong>{cancelReasonLabel}</strong>
                                  {o.cancelReasonNote && (
                                    <> – {o.cancelReasonNote}</>
                                  )}
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
                                handleContactClient(o);
                              }}
                              disabled={startingMessageOrderId === o.id}
                              title={
                                o.messageThreadId
                                  ? o.messageUnreadCount > 0
                                    ? `${o.messageUnreadCount} mesaje necitite`
                                    : "Deschide conversația cu clientul"
                                  : "Pornește o conversație cu clientul"
                              }
                              aria-label="Mesaje client"
                            >
                              {startingMessageOrderId === o.id ? (
                                <Loader2 size={16} className={styles.spin} />
                              ) : (
                                <MessageSquare size={16} />
                              )}
                              {o.messageUnreadCount > 0 && (
                                <span className={styles.unreadDot}>
                                  {o.messageUnreadCount}
                                </span>
                              )}
                            </button>

                            {o.status === "new" && (
                              <button
                                className={styles.secondaryBtn}
                                onClick={async (e) => {
                                  e.stopPropagation();
                                  try {
                                    await api(
                                      `/api/vendor/orders/${o.id}/status`,
                                      {
                                        method: "PATCH",
                                        headers: {
                                          "Content-Type": "application/json",
                                        },
                                        body: JSON.stringify({
                                          status: "preparing",
                                        }),
                                      }
                                    );
                                    setData((prev) => ({
                                      ...prev,
                                      items: prev.items.map((x) =>
                                        x.id === o.id
                                          ? { ...x, status: "preparing" }
                                          : x
                                      ),
                                    }));
                                  } catch {
                                    alert(
                                      "Nu am putut marca 'În pregătire'."
                                    );
                                  }
                                }}
                              >
                                În pregătire
                              </button>
                            )}

                            {(o.status === "preparing" ||
                              o.status === "confirmed") && (
                              <button
                                className={styles.primaryBtn}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openCourierModal(o);
                                }}
                                title="Confirmă & programează curier"
                              >
                                <PackageCheck size={16} /> Confirmă & curier
                              </button>
                            )}

                            {o.status === "confirmed" && (
                              <button
                                className={styles.secondaryBtn}
                                onClick={async (e) => {
                                  e.stopPropagation();
                                  try {
                                    await api(
                                      `/api/vendor/orders/${o.id}/status`,
                                      {
                                        method: "PATCH",
                                        headers: {
                                          "Content-Type": "application/json",
                                        },
                                        body: JSON.stringify({
                                          status: "fulfilled",
                                        }),
                                      }
                                    );
                                    setData((prev) => ({
                                      ...prev,
                                      items: prev.items.map((x) =>
                                        x.id === o.id
                                          ? { ...x, status: "fulfilled" }
                                          : x
                                      ),
                                    }));
                                  } catch {
                                    alert(
                                      "Nu am putut marca comanda ca finalizată."
                                    );
                                  }
                                }}
                              >
                                Marchează finalizată
                              </button>
                            )}

                            {o.status !== "cancelled" && (
                              <button
                                className={styles.iconActionBtn}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openInvoiceModal(o);
                                }}
                                disabled={
                                  !billingReady ||
                                  billingLoading ||
                                  invoiceLoadingId === o.id
                                }
                                title={
                                  !billingReady
                                    ? "Completează datele de facturare pentru a putea genera facturi."
                                    : o.invoiceNumber
                                    ? "Vezi / editează factura"
                                    : "Generează factură"
                                }
                                aria-label="Factură"
                              >
                                {invoiceLoadingId === o.id ? (
                                  <Loader2 size={16} className={styles.spin} />
                                ) : (
                                  <FileText size={16} />
                                )}
                              </button>
                            )}

                            {["new", "preparing", "confirmed"].includes(
                              o.status
                            ) && (
                              <button
                                className={styles.iconActionBtn}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setCancelOrder(o);
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

            {data.total > pageSize && (
              <div className={styles.pagination}>
                <button
                  className={styles.secondaryBtn}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                >
                  <ChevronLeft size={16} /> Anterioare
                </button>
                <span className={styles.pageInfo}>
                  Pagina {page} / {totalPages} · {data.total} rezultate
                </span>
                <button
                  className={styles.secondaryBtn}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                >
                  Următoare <ChevronRight size={16} />
                </button>
              </div>
            )}
          </div>

          {err && (
            <p className={styles.muted} style={{ marginTop: 8 }}>
              {err}
            </p>
          )}

          {billingError && !billingLoading && (
            <p className={styles.muted} style={{ marginTop: 8 }}>
              {billingError}
            </p>
          )}

          {courierOrder && (
            <CourierModal
              order={courierOrder}
              onClose={closeCourierModal}
              onDone={async () => {
                try {
                  const res = await api(
                    `/api/vendor/orders?${new URLSearchParams({
                      q: courierOrder.id,
                      page: 1,
                      pageSize: 1,
                    }).toString()}`
                  );
                  const fresh = res?.items?.[0];
                  setData((prev) => ({
                    ...prev,
                    items: prev.items.map((x) =>
                      x.id === courierOrder.id ? { ...x, ...fresh } : x
                    ),
                  }));
                } catch (e) {
                  console.error(e);
                }
              }}
            />
          )}
          {manualOrderOpen && (
            <VendorManualOrderModal
              onClose={() => setManualOrderOpen(false)}
              onCreated={() => {
                setManualOrderOpen(false);
                setPage(1);
                setReloadToken((t) => t + 1);
              }}
            />
          )}

          {invoiceOrder && (
            <InvoiceModal
              order={invoiceOrder}
              onClose={closeInvoiceModal}
              onSaved={handleInvoiceSaved}
            />
          )}

          {cancelOrder && (
            <CancelOrderModal
              order={cancelOrder}
              onClose={() => setCancelOrder(null)}
              onCancelled={(payload) => {
                setData((prev) => ({
                  ...prev,
                  items: prev.items.map((x) =>
                    x.id === cancelOrder.id
                      ? {
                          ...x,
                          status: "cancelled",
                          cancelReason: payload.cancelReason,
                          cancelReasonNote: payload.cancelReasonNote,
                        }
                      : x
                  ),
                }));
                setCancelOrder(null);
              }}
            />
          )}

          {filtersOpen && (
            <div
              className={styles.modalBackdrop}
              role="dialog"
              aria-modal="true"
            >
              <div className={styles.modal}>
                <div className={styles.modalHead}>
                  <h3>Filtre comenzi</h3>
                  <button
                    className={styles.iconBtn}
                    onClick={() => setFiltersOpen(false)}
                    aria-label="Închide"
                  >
                    ×
                  </button>
                </div>

                <div className={styles.modalBody}>
                  <fieldset className={styles.fieldset}>
                    <legend>Status comandă</legend>
                    <div className={styles.selectWrap}>
                      <Filter size={16} />
                      <select
                        value={status}
                        onChange={(e) => {
                          setPage(1);
                          setStatus(e.target.value);
                        }}
                        className={styles.select}
                        aria-label="Filtru status"
                      >
                        {STATUS_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </fieldset>

                  <fieldset className={styles.fieldset}>
                    <legend>Interval de timp</legend>
                    <div className={styles.grid3}>
                      <label>
                        De la data
                        <div className={styles.dateWrap}>
                          <Calendar size={16} />
                          <input
                            type="date"
                            value={from}
                            onChange={(e) => {
                              setPage(1);
                              setFrom(e.target.value);
                            }}
                            className={styles.input}
                            aria-label="De la data"
                          />
                        </div>
                      </label>
                      <label>
                        Până la data
                        <div className={styles.dateWrap}>
                          <Calendar size={16} />
                          <input
                            type="date"
                            value={to}
                            onChange={(e) => {
                              setPage(1);
                              setTo(e.target.value);
                            }}
                            className={styles.input}
                            aria-label="Până la data"
                          />
                        </div>
                      </label>
                      <div />
                    </div>
                  </fieldset>
                </div>

                <div className={styles.modalActions}>
                  <button
                    className={styles.secondaryBtn}
                    onClick={handleResetFilters}
                  >
                    <RefreshCw size={16} /> Resetează filtrele
                  </button>
                  <button
                    className={styles.primaryBtn}
                    onClick={() => setFiltersOpen(false)}
                  >
                    Aplică filtrele
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* 👇 modal special pentru mobil */}
          {isMobile && selectedOrder && (
            <MobileOrderModal
              order={selectedOrder}
              billingReady={billingReady}
              billingLoading={billingLoading}
              onClose={() => setSelectedOrder(null)}
              onOpenDetails={() => {
                navigate(`/vendor/orders/${selectedOrder.id}`);
                setSelectedOrder(null);
              }}
              onContactClient={() => {
                handleContactClient(selectedOrder);
                setSelectedOrder(null);
              }}
              onOpenCourier={() => {
                openCourierModal(selectedOrder);
                setSelectedOrder(null);
              }}
              onMarkPreparing={async () => {
                try {
                  await api(
                    `/api/vendor/orders/${selectedOrder.id}/status`,
                    {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ status: "preparing" }),
                    }
                  );
                  setData((prev) => ({
                    ...prev,
                    items: prev.items.map((x) =>
                      x.id === selectedOrder.id
                        ? { ...x, status: "preparing" }
                        : x
                    ),
                  }));
                  setSelectedOrder(null);
                } catch {
                  alert("Nu am putut marca 'În pregătire'.");
                }
              }}
              onMarkFulfilled={async () => {
                try {
                  await api(
                    `/api/vendor/orders/${selectedOrder.id}/status`,
                    {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ status: "fulfilled" }),
                    }
                  );
                  setData((prev) => ({
                    ...prev,
                    items: prev.items.map((x) =>
                      x.id === selectedOrder.id
                        ? { ...x, status: "fulfilled" }
                        : x
                    ),
                  }));
                  setSelectedOrder(null);
                } catch {
                  alert("Nu am putut marca comanda ca finalizată.");
                }
              }}
              onOpenInvoice={() => {
                openInvoiceModal(selectedOrder);
                setSelectedOrder(null);
              }}
              onCancel={() => {
                setCancelOrder(selectedOrder);
                setSelectedOrder(null);
              }}
            />
          )}
        </>
      )}

      {activeTab === "client" && (
        <div style={{ marginTop: 16 }}>
          <UserOrdersPage />
        </div>
      )}
    </main>
  );
}

/* ===== Modal Confirmare & Curier ===== */

function CourierModal({ order, onClose, onDone }) {
  const [consents, setConsents] = useState({
    gdprProcessing: true,
    properPackaging: false,
    fragile: false,
    declaredValue: true,
    returnPolicyAck: true,
    canCallDriver: true,
  });
  const [pickup, setPickup] = useState({
    day: "today",
    slot: "14-18",
  });
  const [dimensions, setDimensions] = useState({
    parcels: 1,
    weightKg: 1,
    l: 30,
    w: 20,
    h: 10,
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  async function handleSubmit() {
    setSaving(true);
    setErr("");
    try {
      await api(`/api/vendor/shipments/${order.shipmentId}/schedule-pickup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          consents,
          pickup,
          dimensions,
        }),
      });
      await api(`/api/vendor/orders/${order.id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "confirmed",
        }),
      });
      onDone?.();
      onClose?.();
    } catch (e) {
      setErr(e?.message || "Eroare necunoscută");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={styles.modalBackdrop} role="dialog" aria-modal="true">
      <div className={styles.modal}>
        <div className={styles.modalHead}>
          <h3>Confirmare predare & curier</h3>
          <button
            className={styles.iconBtn}
            onClick={onClose}
            aria-label="Închide"
          >
            ×
          </button>
        </div>

        <fieldset className={styles.fieldset}>
          <legend>Acorduri curier</legend>
          <Check
            label="Sunt de acord să transmiteți către curier datele clientului și ale expediției (GDPR)."
            checked={consents.gdprProcessing}
            onChange={(v) =>
              setConsents((s) => ({
                ...s,
                gdprProcessing: v,
              }))
            }
          />
          <Check
            label="Confirm că marfa este ambalată corespunzător conform ghidului curierului."
            checked={consents.properPackaging}
            onChange={(v) =>
              setConsents((s) => ({
                ...s,
                properPackaging: v,
              }))
            }
          />
          <Check
            label="Conține obiecte fragile (curierul va nota 'fragil')."
            checked={consents.fragile}
            onChange={(v) =>
              setConsents((s) => ({
                ...s,
                fragile: v,
              }))
            }
          />
          <Check
            label="Accept valoarea declarată și condițiile de răspundere ale curierului."
            checked={consents.declaredValue}
            onChange={(v) =>
              setConsents((s) => ({
                ...s,
                declaredValue: v,
              }))
            }
          />
          <Check
            label="Accept politica de retur pentru colete nelivrate/refuzate."
            checked={consents.returnPolicyAck}
            onChange={(v) =>
              setConsents((s) => ({
                ...s,
                returnPolicyAck: v,
              }))
            }
          />
          <Check
            label="Accept ca șoferul să mă contacteze telefonic la preluare."
            checked={consents.canCallDriver}
            onChange={(v) =>
              setConsents((s) => ({
                ...s,
                canCallDriver: v,
              }))
            }
          />
        </fieldset>

        <fieldset className={styles.fieldset}>
          <legend>Programare curier</legend>
          <div className={styles.row}>
            <label className={styles.radio}>
              <input
                type="radio"
                name="day"
                value="today"
                checked={pickup.day === "today"}
                onChange={(e) =>
                  setPickup((v) => ({
                    ...v,
                    day: e.target.value,
                  }))
                }
              />{" "}
              Azi
            </label>
            <label className={styles.radio}>
              <input
                type="radio"
                name="day"
                value="tomorrow"
                checked={pickup.day === "tomorrow"}
                onChange={(e) =>
                  setPickup((v) => ({
                    ...v,
                    day: e.target.value,
                  }))
                }
              />{" "}
              Mâine
            </label>
          </div>
          <select
            className={styles.select}
            value={pickup.slot}
            onChange={(e) =>
              setPickup((v) => ({
                ...v,
                slot: e.target.value,
              }))
            }
          >
            <option value="10-14">10:00–14:00</option>
            <option value="14-18">14:00–18:00</option>
            <option value="18-21">18:00–21:00</option>
          </select>
        </fieldset>

        <fieldset className={styles.fieldset}>
          <legend>Detalii colet</legend>
          <div className={styles.grid3}>
            <label>
              Număr colete{" "}
              <input
                type="number"
                min={1}
                value={dimensions.parcels}
                onChange={(e) =>
                  setDimensions((v) => ({
                    ...v,
                    parcels: +e.target.value,
                  }))
                }
              />
            </label>
            <label>
              Greutate (kg){" "}
              <input
                type="number"
                step="0.1"
                min={0.1}
                value={dimensions.weightKg}
                onChange={(e) =>
                  setDimensions((v) => ({
                    ...v,
                    weightKg: +e.target.value,
                  }))
                }
              />
            </label>
            <label>
              Dimensiuni (cm){" "}
              <input
                type="text"
                value={`${dimensions.l}x${dimensions.w}x${dimensions.h}`}
                onChange={(e) => {
                  const [l, w, h] = e.target.value
                    .split("x")
                    .map((n) => Number(n) || 0);
                  setDimensions((v) => ({
                    ...v,
                    l,
                    w,
                    h,
                  }));
                }}
              />
            </label>
          </div>
        </fieldset>

        {err && <p className={styles.error}>{err}</p>}

        <div className={styles.modalActions}>
          <button
            className={styles.secondaryBtn}
            onClick={onClose}
            disabled={saving}
          >
            Anulează
          </button>
          <button
            className={styles.primaryBtn}
            onClick={handleSubmit}
            disabled={saving}
          >
            {saving ? (
              <Loader2 className={styles.spin} size={16} />
            ) : (
              <PackageCheck size={16} />
            )}{" "}
            Programează curierul
          </button>
        </div>
        <p className={styles.muted}>
          După programare, vei vedea AWB-ul și mesajul „Un curier ajunge{" "}
          {pickup.day === "today" ? "azi" : "mâine"} în intervalul selectat”.
        </p>
      </div>
    </div>
  );
}

/* ===== Modal Factură ===== */

function InvoiceModal({ order, onClose, onSaved }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [invoice, setInvoice] = useState(null);

  useEffect(() => {
    if (!order) return;
    let alive = true;

    async function loadInvoice() {
      setLoading(true);
      setErr("");
      try {
        const res = await api(`/api/vendor/orders/${order.id}/invoice`, {
          method: "GET",
        });

        const addr = order.address || {};
        const isCompany = !!(addr.companyName || addr.companyCui);
        const defaultLegalType = isCompany ? "PJ" : "PF";

        if (res?.invoice) {
          const inv = res.invoice;
          const prevCustomer = inv.customer || {};
          const legalType = prevCustomer.legalType || defaultLegalType;

          const resolvedName = isCompany
            ? addr.companyName ||
              prevCustomer.name ||
              addr.name ||
              order.customerName ||
              ""
            : prevCustomer.name || addr.name || order.customerName || "";

          setInvoice({
            ...inv,
            customer: {
              ...prevCustomer,
              legalType,
              name: resolvedName,
              companyCui: prevCustomer.companyCui || addr.companyCui || "",
              companyRegCom:
                prevCustomer.companyRegCom || addr.companyRegCom || "",
              address:
                prevCustomer.address ||
                addr.address ||
                [addr.street, addr.city, addr.county, addr.postalCode]
                  .filter(Boolean)
                  .join(", "),
            },
          });
        } else {
          const baseCustomerAddress =
            addr.address ||
            [addr.street, addr.city, addr.county, addr.postalCode]
              .filter(Boolean)
              .join(", ");

          const legalType = defaultLegalType;

          setInvoice({
            series: "FA",
            number: "",
            issueDate: new Date().toISOString().slice(0, 10),
            dueDate: new Date().toISOString().slice(0, 10),
            currency: "RON",
            vendor: {
              name: order.vendorName || "",
              cui: order.vendorCui || "",
              regCom: order.vendorRegCom || "",
              address: order.vendorAddress || "",
              iban: order.vendorIban || "",
              bank: order.vendorBank || "",
            },
            customer: {
              legalType,
              name:
                (isCompany && (addr.companyName || addr.name)) ||
                addr.name ||
                order.customerName ||
                "",
              email: order.customerEmail || addr.email || "",
              phone: order.customerPhone || addr.phone || "",
              companyCui: addr.companyCui || "",
              companyRegCom: addr.companyRegCom || "",
              address: baseCustomerAddress,
            },
            lines: Array.isArray(order.items)
              ? order.items.map((it) => ({
                  description: it.title,
                  qty: it.qty || 1,
                  unitPrice: it.price || 0,
                  vatRate: 19,
                }))
              : [
                  {
                    description: "Produse comandă",
                    qty: 1,
                    unitPrice: order.total || 0,
                    vatRate: 19,
                  },
                ],
            notes: "",
          });
        }
      } catch (e) {
        if (!alive) return;
        setErr(e?.message || "Nu am putut încărca draftul de factură.");
      } finally {
        if (alive) setLoading(false);
      }
    }

    loadInvoice();
    return () => {
      alive = false;
    };
  }, [order]);

  if (!order) return null;

  function updateHeaderField(field, value) {
    setInvoice((prev) => ({
      ...prev,
      [field]: value,
    }));
  }

  function updateCustomerField(field, value) {
    setInvoice((prev) => ({
      ...prev,
      customer: {
        ...(prev.customer || {}),
        [field]: value,
      },
    }));
  }

  function updateLine(index, field, value) {
    setInvoice((prev) => {
      const lines = Array.from(prev.lines || []);
      const line = { ...(lines[index] || {}) };
      if (field === "qty" || field === "unitPrice" || field === "vatRate") {
        line[field] = Number(value) || 0;
      } else {
        line[field] = value;
      }
      lines[index] = line;
      return { ...prev, lines };
    });
  }

  function addLine() {
    setInvoice((prev) => ({
      ...prev,
      lines: [
        ...(prev.lines || []),
        {
          description: "",
          qty: 1,
          unitPrice: 0,
          vatRate: 19,
        },
      ],
    }));
  }

  function removeLine(index) {
    setInvoice((prev) => ({
      ...prev,
      lines: (prev.lines || []).filter((_, i) => i !== index),
    }));
  }

  function computeTotals() {
    const lines = invoice?.lines || [];
    let baseTotal = 0;
    let vatTotal = 0;
    lines.forEach((ln) => {
      const qty = Number(ln.qty || 0);
      const price = Number(ln.unitPrice || 0);
      const vatRate = Number(ln.vatRate || 0);
      const base = qty * price;
      const vat = (base * vatRate) / 100;
      baseTotal += base;
      vatTotal += vat;
    });
    return {
      baseTotal,
      vatTotal,
      grandTotal: baseTotal + vatTotal,
    };
  }

  async function handleSaveAndSend() {
    if (!invoice) return;
    setSaving(true);
    setErr("");
    try {
      const res = await api(`/api/vendor/orders/${order.id}/invoice`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          invoice,
          sendEmail: true,
        }),
      });

      if (res?.pdfUrl) {
        window.open(res.pdfUrl, "_blank");
      }

      onSaved?.(order.id);
      onClose?.();
    } catch (e) {
      setErr(e?.message || "Nu am putut salva sau trimite factura.");
    } finally {
      setSaving(false);
    }
  }

  const totals = invoice ? computeTotals() : null;
  const legalType = invoice?.customer?.legalType || "PF";

  return (
    <div className={styles.modalBackdrop} role="dialog" aria-modal="true">
      <div className={`${styles.modal} ${styles.invoiceModal}`}>
        <div className={styles.modalHead}>
          <h3>
            Factură pentru comanda <code>{order.shortId || order.id}</code>
          </h3>
          <button
            className={styles.iconBtn}
            onClick={onClose}
            aria-label="Închide"
          >
            ×
          </button>
        </div>

        <div className={styles.modalBody}>
          {loading && (
            <div style={{ padding: 16 }}>
              <Loader2 size={16} className={styles.spin} /> Se încarcă draftul
              de factură…
            </div>
          )}

          {!loading && invoice && (
            <>
              <fieldset className={styles.fieldset}>
                <legend>Detalii factură</legend>
                <div className={styles.grid3}>
                  <label>
                    Serie
                    <input
                      className={styles.input}
                      value={invoice.series || ""}
                      onChange={(e) =>
                        updateHeaderField("series", e.target.value)
                      }
                    />
                  </label>
                  <label>
                    Număr
                    <input
                      className={styles.input}
                      value={invoice.number || ""}
                      onChange={(e) =>
                        updateHeaderField("number", e.target.value)
                      }
                    />
                  </label>
                  <label>
                    Dată emitere
                    <input
                      type="date"
                      className={styles.input}
                      value={
                        invoice.issueDate ||
                        new Date().toISOString().slice(0, 10)
                      }
                      onChange={(e) =>
                        updateHeaderField("issueDate", e.target.value)
                      }
                    />
                  </label>
                </div>
                <div className={styles.grid3}>
                  <label>
                    Dată scadență
                    <input
                      type="date"
                      className={styles.input}
                      value={
                        invoice.dueDate ||
                        invoice.issueDate ||
                        new Date().toISOString().slice(0, 10)
                      }
                      onChange={(e) =>
                        updateHeaderField("dueDate", e.target.value)
                      }
                    />
                  </label>
                  <label>
                    Monedă
                    <input
                      className={styles.input}
                      value={invoice.currency || "RON"}
                      onChange={(e) =>
                        updateHeaderField("currency", e.target.value)
                      }
                    />
                  </label>
                  <label>
                    Notă pe factură (opțional)
                    <input
                      className={styles.input}
                      value={invoice.notes || ""}
                      onChange={(e) =>
                        updateHeaderField("notes", e.target.value)
                      }
                      placeholder="Ex: Vă mulțumim pentru comandă!"
                    />
                  </label>
                </div>
                <p className={styles.invoiceHint}>
                  <strong>Notă:</strong> Dacă lași câmpul <strong>Număr</strong>{" "}
                  gol, platforma va genera automat următorul număr de factură,
                  pe baza ultimei facturi emise. Dacă introduci manual un număr
                  (ex. <code>FA-2025-010</code>), următoarea factură cu număr
                  gol va continua de la acesta (ex. <code>FA-2025-011</code>).
                </p>
              </fieldset>

              <fieldset className={styles.fieldset}>
                <legend>Client</legend>

                <div className={styles.grid3}>
                  <label>
                    Tip client
                    <select
                      className={styles.select}
                      value={legalType}
                      onChange={(e) =>
                        updateCustomerField("legalType", e.target.value)
                      }
                    >
                      <option value="PF">Persoană fizică</option>
                      <option value="PJ">Persoană juridică</option>
                    </select>
                  </label>
                </div>

                <div className={styles.grid3}>
                  <label>
                    {legalType === "PJ"
                      ? "Denumire firmă"
                      : "Nume și prenume"}
                    <input
                      className={styles.input}
                      value={invoice.customer?.name || ""}
                      onChange={(e) =>
                        updateCustomerField("name", e.target.value)
                      }
                    />
                  </label>
                  <label>
                    Email
                    <input
                      className={styles.input}
                      value={invoice.customer?.email || ""}
                      onChange={(e) =>
                        updateCustomerField("email", e.target.value)
                      }
                    />
                  </label>
                  <label>
                    Telefon
                    <input
                      className={styles.input}
                      value={invoice.customer?.phone || ""}
                      onChange={(e) =>
                        updateCustomerField("phone", e.target.value)
                      }
                    />
                  </label>
                </div>

                {legalType === "PJ" && (
                  <div className={styles.grid3}>
                    <label>
                      CUI
                      <input
                        className={styles.input}
                        value={invoice.customer?.companyCui || ""}
                        onChange={(e) =>
                          updateCustomerField("companyCui", e.target.value)
                        }
                      />
                    </label>
                    <label>
                      Nr. Reg. Com.
                      <input
                        className={styles.input}
                        value={invoice.customer?.companyRegCom || ""}
                        onChange={(e) =>
                          updateCustomerField(
                            "companyRegCom",
                            e.target.value
                          )
                        }
                      />
                    </label>
                    <div />
                  </div>
                )}

                <label>
                  Adresă
                  <input
                    className={styles.input}
                    value={invoice.customer?.address || ""}
                    onChange={(e) =>
                      updateCustomerField("address", e.target.value)
                    }
                    placeholder={
                      legalType === "PJ"
                        ? "Adresă sediu (stradă, oraș, județ, cod poștal)"
                        : "Adresă livrare / domiciliu"
                    }
                  />
                </label>
              </fieldset>

              <fieldset className={styles.fieldset}>
                <legend>Produse / Servicii</legend>
                <div className={styles.tableWrap} style={{ maxHeight: 260 }}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>Descriere</th>
                        <th>Cant.</th>
                        <th>Preț unitar</th>
                        <th>TVA %</th>
                        <th>Total (cu TVA)</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {(invoice.lines || []).map((ln, idx) => {
                        const qty = Number(ln.qty || 0);
                        const unit = Number(ln.unitPrice || 0);
                        const vatRate = Number(ln.vatRate || 0);
                        const base = qty * unit;
                        const vat = (base * vatRate) / 100;
                        const total = base + vat;

                        return (
                          <tr key={idx}>
                            <td>
                              <input
                                className={styles.input}
                                value={ln.description || ""}
                                onChange={(e) =>
                                  updateLine(idx, "description", e.target.value)
                                }
                              />
                            </td>
                            <td>
                              <input
                                className={styles.input}
                                type="number"
                                min={0}
                                value={ln.qty ?? 0}
                                onChange={(e) =>
                                  updateLine(idx, "qty", e.target.value)
                                }
                              />
                            </td>
                            <td>
                              <input
                                className={styles.input}
                                type="number"
                                step="0.01"
                                min={0}
                                value={ln.unitPrice ?? 0}
                                onChange={(e) =>
                                  updateLine(idx, "unitPrice", e.target.value)
                                }
                              />
                            </td>
                            <td>
                              <input
                                className={styles.input}
                                type="number"
                                step="0.1"
                                min={0}
                                value={ln.vatRate ?? 0}
                                onChange={(e) =>
                                  updateLine(idx, "vatRate", e.target.value)
                                }
                              />
                            </td>
                            <td>{formatMoney(total)}</td>
                            <td>
                              <button
                                type="button"
                                className={styles.iconBtn}
                                onClick={() => removeLine(idx)}
                                title="Șterge linia"
                              >
                                ×
                              </button>
                            </td>
                          </tr>
                        );
                      })}

                      {(!invoice.lines || invoice.lines.length === 0) && (
                        <tr>
                          <td colSpan={6} className={styles.emptyCell}>
                            Nu există linii. Adaugă cel puțin una.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <button
                  type="button"
                  className={styles.secondaryBtn}
                  style={{ marginTop: 8 }}
                  onClick={addLine}
                >
                  + Adaugă linie
                </button>
              </fieldset>

              {totals && (
                <div className={styles.fieldset} style={{ border: "none" }}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "flex-end",
                      gap: 16,
                      flexWrap: "wrap",
                    }}
                  >
                    <div>
                      <div>
                        Bază (fără TVA):{" "}
                        <strong>{formatMoney(totals.baseTotal)}</strong>
                      </div>
                      <div>
                        TVA total:{" "}
                        <strong>{formatMoney(totals.vatTotal)}</strong>
                      </div>
                      <div>
                        Total de plată:{" "}
                        <strong>{formatMoney(totals.grandTotal)}</strong>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}

          {err && <p className={styles.error}>{err}</p>}
        </div>

        <div className={styles.modalActions}>
          <button
            className={styles.secondaryBtn}
            onClick={onClose}
            disabled={saving}
          >
            Închide
          </button>
          <button
            className={styles.primaryBtn}
            onClick={handleSaveAndSend}
            disabled={saving || loading || !invoice}
          >
            {saving ? (
              <>
                <Loader2 size={16} className={styles.spin} /> Se salvează &
                trimite…
              </>
            ) : (
              <>
                <Send size={16} /> Salvează & trimite factura
              </>
            )}
          </button>
        </div>
        <p className={styles.muted}>
          La salvare, factura va fi generată și trimisă pe email clientului (dacă
          backend-ul este configurat astfel).
        </p>
      </div>
    </div>
  );
}

/* ===== Modal Anulare Comandă ===== */

function CancelOrderModal({ order, onClose, onCancelled }) {
  const [reason, setReason] = useState("client_no_answer");
  const [otherReason, setOtherReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  async function handleSubmit() {
    if (!reason) return;

    const payload = {
      status: "cancelled",
      cancelReason: reason,
      cancelReasonNote: reason === "other" ? otherReason : "",
    };

    if (reason === "other" && !otherReason.trim()) {
      setErr("Te rugăm să completezi motivul anulării.");
      return;
    }

    setSaving(true);
    setErr("");
    try {
      await api(`/api/vendor/orders/${order.id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      onCancelled?.(payload);
    } catch (e) {
      setErr(
        e?.message || "Nu am putut anula comanda. Încearcă din nou."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={styles.modalBackdrop} role="dialog" aria-modal="true">
      <div className={styles.modal}>
        <div className={styles.modalHead}>
          <h3>
            Anulează comanda <code>{order.shortId || order.id}</code>
          </h3>
          <button
            className={styles.iconBtn}
            onClick={onClose}
            aria-label="Închide"
          >
            ×
          </button>
        </div>

        <div className={styles.modalBody}>
          <p className={styles.muted}>
            Comanda va fi marcată ca <strong>„Anulată”</strong>. Clientul va
            primi automat un mesaj în inbox și un email cu motivul selectat mai
            sus.
          </p>

          <fieldset className={styles.fieldset}>
            <legend>Motiv anulare</legend>
            <select
              className={styles.select}
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                setErr("");
              }}
            >
              {CANCEL_REASONS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>

            {reason === "other" && (
              <div style={{ marginTop: 8 }}>
                <label>
                  Detalii motiv (opțional, dar recomandat)
                  <textarea
                    className={styles.input}
                    rows={3}
                    value={otherReason}
                    onChange={(e) => setOtherReason(e.target.value)}
                    placeholder="Ex: Clientul nu mai are nevoie de produse, a găsit alt furnizor etc."
                  />
                </label>
              </div>
            )}
          </fieldset>

          {err && <p className={styles.error}>{err}</p>}
        </div>

        <div className={styles.modalActions}>
          <button
            className={styles.secondaryBtn}
            onClick={onClose}
            disabled={saving}
          >
            Închide
          </button>
          <button
            className={styles.primaryBtn}
            onClick={handleSubmit}
            disabled={saving}
          >
            {saving ? (
              <Loader2 className={styles.spin} size={16} />
            ) : (
              "Confirmă anularea"
            )}
          </button>
        </div>
        <p className={styles.muted}>
          Acțiunea nu poate fi reversată din interfață. Pentru reactivare va fi
          nevoie de o nouă comandă.
        </p>
      </div>
    </div>
  );
}

/* ===== Modal mobil cu detalii comandă ===== */

function MobileOrderModal({
  order,
  onClose,
  onOpenDetails,
  onContactClient,
  onOpenCourier,
  onMarkPreparing,
  onMarkFulfilled,
  onOpenInvoice,
  onCancel,
  billingReady,
  billingLoading,
}) {
  if (!order) return null;

  const leadLabel = getLeadStatusLabel(order.leadStatus);
  const cancelReasonLabel =
    order.cancelReason &&
    (CANCEL_REASONS.find((r) => r.value === order.cancelReason)?.label ||
      order.cancelReason);

  return (
    <div className={styles.modalBackdrop} role="dialog" aria-modal="true">
      <div className={styles.modal}>
        <div className={styles.modalHead}>
          <h3>
            Comanda <code>{order.shortId || order.id}</code>
          </h3>
          <button
            className={styles.iconBtn}
            onClick={onClose}
            aria-label="Închide"
          >
            ×
          </button>
        </div>

        <div className={styles.modalBody}>
          <div className={styles.kv}>
            <span>ID</span>
            <div>
              <code>{order.id}</code>
            </div>
          </div>
          <div className={styles.kv}>
            <span>Data</span>
            <div>{formatDate(order.createdAt)}</div>
          </div>
          <div className={styles.kv}>
            <span>Client</span>
            <div>
              <strong>{order.customerName || "—"}</strong>
              <div className={styles.clientNote}>
                {order.eventName || order.address?.city || ""}
              </div>
            </div>
          </div>
          <div className={styles.kv}>
            <span>Contact</span>
            <div className={styles.clientContact}>
              {order.customerPhone && (
                <a href={`tel:${order.customerPhone}`}>{order.customerPhone}</a>
              )}
              {order.customerEmail && (
                <a href={`mailto:${order.customerEmail}`}>
                  {order.customerEmail}
                </a>
              )}
            </div>
          </div>
          <div className={styles.kv}>
            <span>Status</span>
            <div>
              <span
                className={`${styles.badge} ${
                  order.status === "new"
                    ? styles.badgeNew
                    : order.status === "preparing"
                    ? styles.badgeWarning
                    : order.status === "confirmed"
                    ? styles.badgeConfirmed
                    : order.status === "fulfilled"
                    ? styles.badgeFulfilled
                    : order.status === "cancelled"
                    ? styles.badgeCancelled
                    : ""
                }`}
              >
                {STATUS_OPTIONS.find((s) => s.value === order.status)?.label ||
                  order.status ||
                  "—"}
              </span>
              {order.paymentMethod && (
                <div className={styles.clientNote}>
                  {order.paymentMethod === "COD"
                    ? "Plată la livrare"
                    : "Card online"}
                </div>
              )}
              {order.invoiceNumber && (
                <div className={styles.clientNote}>
                  Factură: <strong>{order.invoiceNumber}</strong>
                  {order.invoiceDate && (
                    <>
                      {" · "}
                      {new Date(order.invoiceDate).toLocaleDateString("ro-RO")}
                    </>
                  )}
                </div>
              )}
              {cancelReasonLabel && (
                <div className={styles.clientNote}>
                  Motiv anulare: <strong>{cancelReasonLabel}</strong>
                  {order.cancelReasonNote && <> – {order.cancelReasonNote}</>}
                </div>
              )}
            </div>
          </div>

          {(order.awb || order.pickupDate || leadLabel) && (
            <div className={styles.kv}>
              <span>Extra</span>
              <div className={styles.inlineChips}>
                {order.awb && (
                  <span className={`${styles.badge} ${styles.badgeConfirmed}`}>
                    AWB {order.awb}
                  </span>
                )}
                {order.pickupDate && (
                  <span className={styles.badge}>
                    Ridicare{" "}
                    {new Date(order.pickupDate).toLocaleDateString("ro-RO", {
                      weekday: "short",
                      day: "2-digit",
                      month: "short",
                    })}
                  </span>
                )}
                {leadLabel && (
                  <span
                    className={`${styles.badge} ${
                      styles.badgeLead || ""
                    }`}
                  >
                    {leadLabel}
                  </span>
                )}
              </div>
            </div>
          )}

          <div className={styles.kv}>
            <span>Total</span>
            <div>
              <strong>{formatMoney(order.total)}</strong>
            </div>
          </div>
        </div>

        <div className={styles.modalActions}>
          <button className={styles.primaryBtn} onClick={onOpenDetails}>
            Vezi detalii complete
          </button>

          <button className={styles.secondaryBtn} onClick={onContactClient}>
            <MessageSquare size={16} /> Mesaje client
          </button>

          {order.status === "new" && (
            <button className={styles.secondaryBtn} onClick={onMarkPreparing}>
              În pregătire
            </button>
          )}

          {(order.status === "preparing" || order.status === "confirmed") && (
            <button className={styles.primaryBtn} onClick={onOpenCourier}>
              <PackageCheck size={16} /> Confirmă & curier
            </button>
          )}

          {order.status === "confirmed" && (
            <button className={styles.secondaryBtn} onClick={onMarkFulfilled}>
              Marchează finalizată
            </button>
          )}

          {order.status !== "cancelled" && (
            <button
              className={styles.secondaryBtn}
              onClick={onOpenInvoice}
              disabled={!billingReady || billingLoading}
            >
              <FileText size={16} /> Factură
            </button>
          )}

          {["new", "preparing", "confirmed"].includes(order.status) && (
            <button className={styles.secondaryBtn} onClick={onCancel}>
              <XCircle size={16} /> Anulează comanda
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Check({ label, checked, onChange }) {
  return (
    <label className={styles.check}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />{" "}
      {label}
    </label>
  );
}
