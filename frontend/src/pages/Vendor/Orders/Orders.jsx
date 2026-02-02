// frontend/src/pages/Vendor/Orders/VendorOrdersPage.jsx
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
  MessageSquare,
  Plus,
  XCircle,
} from "lucide-react";

import styles from "./Orders.module.css";
import SubscriptionBanner from "../Onboarding/OnBoardingDetails/tabs/SubscriptionBanner/SubscriptionBanner.jsx";

import UserOrdersPage from "../../User/Orders/UserOrders";
import VendorManualOrderModal from "./VendorManualOrderModal.jsx";

import CourierModal from "./modals/CourierModal.jsx";
import CancelOrderModal from "./modals/CancelOrderModal.jsx";

/* ----------------
   Utils + constants
----------------- */
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

function isCourierAlreadyScheduled(o) {
  return !!(o?.awb || o?.pickupScheduledAt);
}

// ✅ LOCK UI: după schedule pickup până la AWB
function isAwaitingAwb(o) {
  return !!o?.pickupScheduledAt && !o?.awb;
}

function lockMessage() {
  return "Comanda este blocată deoarece ai cerut curier. Așteaptă AWB-ul de la admin, apoi poți modifica din nou comanda.";
}

// ✅ helper: tratează 409 din backend
async function withLockHandling(promiseFn) {
  try {
    return await promiseFn();
  } catch (e) {
    const status = e?.status || e?.response?.status;
    const data = e?.data || e?.response?.data;

    if (status === 409 && data?.error === "ORDER_LOCKED_AWAITING_AWB") {
      alert(data?.message || lockMessage());
      return null;
    }

    throw e;
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

  // mobil
  const [isMobile, setIsMobile] = useState(false);
  const [, setSelectedOrder] = useState(null);

  // list filters
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [manualOrderOpen, setManualOrderOpen] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  // data
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [data, setData] = useState({ items: [], total: 0 });

  // modals state
  const [courierOrder, setCourierOrder] = useState(null);
  const [cancelOrder, setCancelOrder] = useState(null);

  const [startingMessageOrderId, setStartingMessageOrderId] = useState(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sseConnected, setSseConnected] = useState(false);

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

  // load orders list
  useEffect(() => {
    let alive = true;

    async function run() {
      if (!isVendor || activeTab !== "vendor") return;

      setLoading(true);
      setErr("");
      try {
        const qs = new URLSearchParams(
          Object.fromEntries(
            Object.entries(query).filter(([, v]) => v !== "" && v != null)
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

  // ✅ SSE
  useEffect(() => {
    if (!isVendor || activeTab !== "vendor") return;

    let es;
    let closed = false;

    function connect() {
      try {
        es = new EventSource("/api/vendor/orders/stream");

        es.addEventListener("open", () => {
          if (closed) return;
          setSseConnected(true);
        });

        es.addEventListener("ready", () => {
          if (closed) return;
          setSseConnected(true);
        });

        es.addEventListener("ping", () => {});

        es.addEventListener("pickup_scheduled", (ev) => {
          if (closed) return;
          try {
            const msg = JSON.parse(ev.data || "{}");

            setData((prev) => ({
              ...prev,
              items: prev.items.map((x) =>
                x.shipmentId === msg.shipmentId || x.id === msg.orderId
                  ? {
                      ...x,
                      status: "confirmed",
                      pickupScheduledAt:
                        msg.pickupScheduledAt || x.pickupScheduledAt,
                      pickupDate: msg.pickupDate || x.pickupDate,
                      pickupSlotStart: msg.pickupSlotStart || x.pickupSlotStart,
                      pickupSlotEnd: msg.pickupSlotEnd || x.pickupSlotEnd,
                    }
                  : x
              ),
            }));
          } catch {
            ""
          }
        });

        es.addEventListener("awb", (ev) => {
          if (closed) return;
          try {
            const msg = JSON.parse(ev.data || "{}");

            setData((prev) => ({
              ...prev,
              items: prev.items.map((x) =>
                x.shipmentId === msg.shipmentId || x.id === msg.orderId
                  ? {
                      ...x,
                      awb: msg.awb ?? x.awb,
                      labelUrl: msg.labelUrl ?? x.labelUrl,
                      courierProvider: msg.courierProvider ?? x.courierProvider,
                      courierService: msg.courierService ?? x.courierService,
                      status: msg.status ?? x.status,
                    }
                  : x
              ),
            }));
          } catch {
            ""
          }
        });

        es.addEventListener("error", () => {
          if (closed) return;
          setSseConnected(false);
          try {
            es.close();
          } catch {
            ""
          }

          setTimeout(() => {
            if (!closed) connect();
          }, 1500);
        });
      } catch {
        setSseConnected(false);
      }
    }

    connect();

    return () => {
      closed = true;
      setSseConnected(false);
      try {
        es?.close();
      } catch {
        ""
      }
    };
  }, [isVendor, activeTab]);

  // ✅ fallback polling doar dacă SSE nu e conectat
  useEffect(() => {
    if (!isVendor || activeTab !== "vendor") return;
    if (sseConnected) return;

    const hasAwaiting = (data?.items || []).some(
      (o) => !!o?.pickupScheduledAt && !o?.awb
    );
    if (!hasAwaiting) return;

    const t = setInterval(() => {
      setReloadToken((x) => x + 1);
    }, 15000);

    return () => clearInterval(t);
  }, [isVendor, activeTab, data?.items, sseConnected]);

  // detect mobile
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

  function handleRowClick(order) {
    if (isMobile) setSelectedOrder(order);
    else navigate(`/vendor/orders/${order.id}`);
  }

  async function handleContactClient(order) {
  // dacă există deja thread, mergem la ruta corectă pentru vendor: /mesaje
  if (order.messageThreadId) {
    navigate(`/mesaje?threadId=${order.messageThreadId}`);
    return;
  }

  try {
    setStartingMessageOrderId(order.id);

    const res = await api(`/api/inbox/ensure-thread-from-order/${order.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });

    if (!res?.threadId) {
      alert("Nu am putut crea conversația cu clientul.");
      return;
    }

    // ✅ RUTA CORECTĂ (conform App.jsx)
    navigate(`/mesaje?threadId=${res.threadId}`);
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
                    "PickupScheduledAt",
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
                          { hour: "2-digit", minute: "2-digit" }
                        )}-${new Date(o.pickupSlotEnd).toLocaleTimeString(
                          "ro-RO",
                          { hour: "2-digit", minute: "2-digit" }
                        )}`
                      : "",
                    o.pickupScheduledAt
                      ? new Date(o.pickupScheduledAt).toISOString()
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

                const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `comenzi-${new Date().toISOString().slice(0, 10)}.csv`;
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
          {/* Filters bar */}
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

          {/* Table */}
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
                        (CANCEL_REASONS.find((r) => r.value === o.cancelReason)?.label ||
                          o.cancelReason);

                      const awaitingAwb = isAwaitingAwb(o);
                      const canFinalize =
                        !!o.awb && !awaitingAwb && ["confirmed", "preparing"].includes(o.status);

                      return (
                        <tr
                          key={o.id}
                          className={styles.orderRow}
                          onClick={() => handleRowClick(o)}
                        >
                          <td>
                            <code>{o.orderNumber || o.shortId || o.id}</code>
                          </td>

                          <td>{formatDate(o.createdAt)}</td>

                          <td>
                            <div className={styles.clientCol}>
                              <div className={styles.clientName}>{o.customerName || "—"}</div>
                              <div className={styles.clientNote}>
                                {o.eventName || o.address?.city || ""}
                              </div>

                              {(o.awb || o.pickupDate || leadLabel || awaitingAwb) && (
                                <div className={styles.inlineChips}>
                                  {awaitingAwb && (
                                    <span className={styles.badge}>Așteptăm AWB</span>
                                  )}

                                  {o.awb && (
                                    <span className={`${styles.badge} ${styles.badgeConfirmed}`}>
                                      AWB {o.awb}
                                    </span>
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
                                    <span className={`${styles.badge} ${styles.badgeLead || ""}`}>
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
                                {STATUS_OPTIONS.find((s) => s.value === o.status)?.label ||
                                  o.status ||
                                  "—"}
                              </span>

                              {o.paymentMethod && (
                                <div className={styles.clientNote}>
                                  {o.paymentMethod === "COD" ? "Plată la livrare" : "Card online"}
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
                            {/* Mesaje */}
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
                                <span className={styles.unreadDot}>{o.messageUnreadCount}</span>
                              )}
                            </button>
{/* Cancel */}
                            {["new", "preparing", "confirmed"].includes(o.status) && (
                              <button
                                className={`${styles.iconActionBtn} ${styles.dangerBtn}`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (awaitingAwb) {
                                    alert(lockMessage());
                                    return;
                                  }
                                  setCancelOrder(o);
                                }}
                                title={awaitingAwb ? lockMessage() : "Anulează comanda"}
                                aria-label="Anulează comanda"
                                disabled={awaitingAwb}
                              >
                                <XCircle size={16} />
                              </button>
                            )}
                            {/* În pregătire */}
                            {o.status === "new" && (
                              <button
                                className={styles.secondaryBtn}
                                onClick={async (e) => {
                                  e.stopPropagation();
                                  if (awaitingAwb) {
                                    alert(lockMessage());
                                    return;
                                  }

                                  try {
                                    const ok = await withLockHandling(() =>
                                      api(`/api/vendor/orders/${o.id}/status`, {
                                        method: "PATCH",
                                        headers: { "Content-Type": "application/json" },
                                        body: JSON.stringify({ status: "preparing" }),
                                      })
                                    );
                                    if (!ok) return;

                                    setData((prev) => ({
                                      ...prev,
                                      items: prev.items.map((x) =>
                                        x.id === o.id ? { ...x, status: "preparing" } : x
                                      ),
                                    }));
                                  } catch {
                                    alert("Nu am putut marca 'În pregătire'.");
                                  }
                                }}
                                disabled={awaitingAwb}
                                title={awaitingAwb ? lockMessage() : undefined}
                              >
                                În pregătire
                              </button>
                            )}

                            {/* Programează curier */}
                            {(o.status === "preparing" || o.status === "confirmed") &&
                              (() => {
                                const courierScheduled = isCourierAlreadyScheduled(o);
                                return (
                                  <button
                                    className={styles.primaryBtn}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      openCourierModal(o);
                                    }}
                                    disabled={courierScheduled}
                                    title={
                                      courierScheduled
                                        ? "Curierul este deja programat"
                                        : "Programează curier"
                                    }
                                  >
                                    <PackageCheck size={16} />{" "}
                                    {courierScheduled ? "Curier programat" : "Programează curier"}
                                  </button>
                                );
                              })()}

                            {/* Marchează ca finalizată */}
                            {["confirmed", "preparing"].includes(o.status) && (
                              <button
                                className={styles.secondaryBtn}
                                disabled={!canFinalize}
                                title={
                                  !o.awb
                                    ? "Așteaptă AWB-ul de la admin ca să poți finaliza."
                                    : "Marchează drept finalizată"
                                }
                                onClick={async (e) => {
                                  e.stopPropagation();
                                  try {
                                    const ok = await withLockHandling(() =>
                                      api(`/api/vendor/orders/${o.id}/status`, {
                                        method: "PATCH",
                                        headers: { "Content-Type": "application/json" },
                                        body: JSON.stringify({ status: "fulfilled" }),
                                      })
                                    );
                                    if (!ok) return;

                                    setData((prev) => ({
                                      ...prev,
                                      items: prev.items.map((x) =>
                                        x.id === o.id ? { ...x, status: "fulfilled" } : x
                                      ),
                                    }));
                                  } catch {
                                    alert("Nu am putut marca finalizată.");
                                  }
                                }}
                              >
                                Marchează ca finalizată
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

          {/* MODALS */}
          {courierOrder && (
            <CourierModal
              order={courierOrder}
              onClose={closeCourierModal}
              onDone={(patch) => {
                if (patch && typeof patch === "object") {
                  setData((prev) => ({
                    ...prev,
                    items: prev.items.map((x) =>
                      x.id === courierOrder.id ? { ...x, ...patch } : x
                    ),
                  }));
                }
                closeCourierModal();
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

          {/* Filters modal */}
          {filtersOpen && (
            <div className={styles.modalBackdrop} role="dialog" aria-modal="true">
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
                  <button className={styles.secondaryBtn} onClick={handleResetFilters}>
                    <RefreshCw size={16} /> Resetează filtrele
                  </button>
                  <button className={styles.primaryBtn} onClick={() => setFiltersOpen(false)}>
                    Aplică filtrele
                  </button>
                </div>
              </div>
            </div>
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
