// frontend/src/pages/vendor/VendorOrdersPlanningPage.jsx
import { useEffect, useState, useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../../../lib/api";
import { useAuth } from "../../Auth/Context/context.js";
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Filter,
  ArrowLeft,
  LayoutPanelLeft,
  FileText,
  X,
  MessageSquare,
  RotateCcw,
} from "lucide-react";
import styles from "./OrdersPlaning.module.css";

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
  { value: "confirmed", label: "Confirmată" },
  { value: "fulfilled", label: "Finalizată" },
  { value: "cancelled", label: "Anulată" },
];

const STATUS_LABEL = STATUS_OPTIONS.reduce((acc, s) => {
  acc[s.value] = s.label;
  return acc;
}, {});

// capacitate orientativă per zi
const CAPACITY_PER_DAY = 10;

// luni ca început de săptămână
function getWeekStart(date) {
  const d = new Date(date);
  const day = d.getDay(); // 0 duminică, 1 luni
  const diff = (day === 0 ? -6 : 1) - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}
function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

// range pentru load în funcție de mod
function getRange(calendarMode, currentDate) {
  const d = new Date(currentDate);
  d.setHours(0, 0, 0, 0);

  if (calendarMode === "week") {
    const start = getWeekStart(d);
    const end = addDays(start, 6);
    return { start, end };
  }

  if (calendarMode === "month") {
    const start = new Date(d.getFullYear(), d.getMonth(), 1);
    start.setHours(0, 0, 0, 0);
    const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    end.setHours(23, 59, 59, 999);
    return { start, end };
  }

  if (calendarMode === "year") {
    const start = new Date(d.getFullYear(), 0, 1);
    start.setHours(0, 0, 0, 0);
    const end = new Date(d.getFullYear(), 11, 31);
    end.setHours(23, 59, 59, 999);
    return { start, end };
  }

  const start = getWeekStart(d);
  const end = addDays(start, 6);
  return { start, end };
}

// zile pentru grid (week / month)
function buildDays(calendarMode, currentDate) {
  if (calendarMode === "week") {
    const start = getWeekStart(currentDate);
    return [...Array(7)].map((_, i) => addDays(start, i));
  }

  if (calendarMode === "month") {
    const startOfMonth = new Date(
      currentDate.getFullYear(),
      currentDate.getMonth(),
      1
    );
    const firstGridDay = getWeekStart(startOfMonth);
    const days = [];
    for (let i = 0; i < 42; i++) {
      days.push(addDays(firstGridDay, i));
    }
    return days;
  }

  return [];
}

// ce dată folosim pentru planificare:
function getPlanDate(order) {
  return order.pickupDate || order.eventDate || order.createdAt;
}

// range helper pentru zile
function getDateKey(d) {
  return new Date(d).toISOString().slice(0, 10);
}

// load vizual per zi (în funcție de capacitate) – doar pe comenzi
function getDayLoadState(ordersForDay) {
  const count = ordersForDay.length;
  if (!count) return "empty";
  if (count < CAPACITY_PER_DAY * 0.6) return "ok";
  if (count < CAPACITY_PER_DAY) return "high";
  return "over";
}

/* =========================
   WRAPPER – verifică rolul
   ========================= */

export default function VendorOrdersPlanningPage() {
  const { me } = useAuth();
  const isVendor = me?.role === "VENDOR";

  if (!isVendor) {
    return (
      <main className={styles.page}>
        <div className={styles.card}>
          <h1 className={styles.h1}>Planificare comenzi</h1>
          <p className={styles.muted}>
            Această pagină este disponibilă doar pentru conturile de tip
            vânzător.
          </p>
          <Link to="/vendor/orders" className={styles.secondaryBtn}>
            <ArrowLeft size={16} /> Înapoi la comenzi
          </Link>
        </div>
      </main>
    );
  }

  return <VendorOrdersPlanningContent />;
}

/* =========================
   COMPONENTA PRINCIPALĂ
   ========================= */

function VendorOrdersPlanningContent() {
  const navigate = useNavigate();

  const [viewMode, setViewMode] = useState("calendar"); // 'calendar' | 'board'
  const [calendarMode, setCalendarMode] = useState("week"); // 'week' | 'month' | 'year'
  const [currentDate, setCurrentDate] = useState(() => new Date());
  const [status, setStatus] = useState(""); // filtru suplimentar pe comenzi

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [items, setItems] = useState([]);

  // UI: contabilitate pliată
  const [showAccounting, setShowAccounting] = useState(false);

  // UI: modal filtre
  const [showFiltersModal, setShowFiltersModal] = useState(false);

  // filtre (comenzi)
  const [searchText, setSearchText] = useState("");
  const [eventTypeFilter, setEventTypeFilter] = useState("");
  const [productTypeFilter, setProductTypeFilter] = useState("");
  const [locationFilter, setLocationFilter] = useState("");

  // day modal
  const [selectedDay, setSelectedDay] = useState(null);

  // drag & drop pe board (comenzi)
  const [draggingOrderId, setDraggingOrderId] = useState(null);

  // === efect: încărcare comenzi când se schimbă intervalul sau filtrul de status ===
  useEffect(() => {
    let alive = true;

    async function run() {
      setLoading(true);
      setErr("");

      try {
        const { start, end } = getRange(calendarMode, currentDate);

        const query = {
          status,
          from: start.toISOString().slice(0, 10),
          to: end.toISOString().slice(0, 10),
          page: 1,
          pageSize: calendarMode === "year" ? 500 : 300,
        };

        const qs = new URLSearchParams(
          Object.fromEntries(
            Object.entries(query).filter(([, v]) => v !== "" && v != null)
          )
        ).toString();

        const res = await api(`/api/vendor/orders?${qs}`);
        if (!alive) return;
        setItems(Array.isArray(res?.items) ? res.items : []);
      } catch {
        if (!alive) return;
        setErr("Nu am putut încărca planificarea. Încearcă din nou.");
      } finally {
        if (alive) setLoading(false);
      }
    }

    run();

    return () => {
      alive = false;
    };
  }, [status, calendarMode, currentDate]);

  const { start: rangeStart, end: rangeEnd } = getRange(
    calendarMode,
    currentDate
  );
  const days =
    calendarMode === "year" ? [] : buildDays(calendarMode, currentDate);

  // opțiuni derivate din date (eventType, productType, location) – pe COMENZI
  const derivedEventTypes = useMemo(
    () =>
      Array.from(
        new Set(items.map((o) => o.eventType).filter(Boolean))
      ).sort(),
    [items]
  );
  const derivedProductTypes = useMemo(
    () =>
      Array.from(
        new Set(items.map((o) => o.productType).filter(Boolean))
      ).sort(),
    [items]
  );
  const derivedLocations = useMemo(
    () =>
      Array.from(
        new Set(items.map((o) => o.location).filter(Boolean))
      ).sort(),
    [items]
  );

  // aplicăm filtrele pe COMENZI (fără notițe aici)
  const filteredItems = useMemo(() => {
    const search = searchText.trim().toLowerCase();
    return items.filter((o) => {
      if (eventTypeFilter && o.eventType !== eventTypeFilter) return false;
      if (productTypeFilter && o.productType !== productTypeFilter)
        return false;
      if (locationFilter && o.location !== locationFilter) return false;

      if (!search) return true;

      const haystack = [
        o.customerName,
        o.shortId,
        o.id,
        o.eventType,
        o.productType,
        o.location,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return haystack.includes(search);
    });
  }, [items, searchText, eventTypeFilter, productTypeFilter, locationFilter]);

  // grupare pe zile pentru COMENZI (week / month) din items FILTRATE
  const ordersByDay =
    calendarMode === "year"
      ? []
      : days.map((d) => {
          const dayStr = getDateKey(d);
          return {
            date: d,
            items: filteredItems.filter((o) => {
              const p = getPlanDate(o);
              if (!p) return false;
              const s = getDateKey(p);
              return s === dayStr;
            }),
          };
        });

  async function changeStatus(order, nextStatus) {
    try {
      await api(`/api/vendor/orders/${order.id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });
      setItems((prev) =>
        prev.map((o) =>
          o.id === order.id ? { ...o, status: nextStatus } : o
        )
      );
    } catch {
      setErr("Nu am putut actualiza statusul comenzii. Încearcă din nou.");
    }
  }

  // grupare pentru board (Kanban) din items FILTRATE
  const boardColumns = {
    new: [],
    preparing: [],
    confirmed: [],
    fulfilled: [],
    cancelled: [],
  };
  for (const o of filteredItems) {
    const st = o.status || "new";
    if (!boardColumns[st]) boardColumns[st] = [];
    boardColumns[st].push(o);
  }

  // statistici pe interval (din items FILTRATE)
  const intervalTotalAmount = filteredItems.reduce(
    (acc, o) => acc + (Number(o.total) || 0),
    0
  );
  const intervalFulfilledCount = boardColumns.fulfilled.length;
  const intervalCancelledCount = boardColumns.cancelled.length;

  // REZUMAT CONTABIL PE INTERVAL
  const accountingStats = useMemo(() => {
    let grossTotal = 0; // toate comenzile (după filtre)
    let grossActive = 0; // toate în afară de anulate
    let grossFulfilled = 0; // doar finalizate
    let grossCancelled = 0; // anulate
    let codTotal = 0;
    let cardTotal = 0;

    filteredItems.forEach((o) => {
      const amount = Number(o.total) || 0;
      grossTotal += amount;

      if (o.status === "cancelled") {
        grossCancelled += amount;
      } else {
        grossActive += amount;
      }

      if (o.status === "fulfilled") {
        grossFulfilled += amount;
      }

      if (o.paymentMethod === "COD") {
        codTotal += amount;
      } else if (o.paymentMethod === "CARD") {
        cardTotal += amount;
      }
    });

    const conversionBase = grossFulfilled + grossCancelled;
    const conversionRate =
      conversionBase > 0 ? (grossFulfilled / conversionBase) * 100 : 0;

    return {
      grossTotal,
      grossActive,
      grossFulfilled,
      grossCancelled,
      codTotal,
      cardTotal,
      conversionRate,
    };
  }, [filteredItems]);

  // NAV între intervale
  function handlePrevPeriod() {
    setCurrentDate((prev) => {
      const d = new Date(prev);
      if (calendarMode === "week") {
        return addDays(d, -7);
      }
      if (calendarMode === "month") {
        return new Date(d.getFullYear(), d.getMonth() - 1, 1);
      }
      if (calendarMode === "year") {
        return new Date(d.getFullYear() - 1, 0, 1);
      }
      return d;
    });
  }
  function handleNextPeriod() {
    setCurrentDate((prev) => {
      const d = new Date(prev);
      if (calendarMode === "week") {
        return addDays(d, 7);
      }
      if (calendarMode === "month") {
        return new Date(d.getFullYear(), d.getMonth() + 1, 1);
      }
      if (calendarMode === "year") {
        return new Date(d.getFullYear() + 1, 0, 1);
      }
      return d;
    });
  }
  function handleToday() {
    setCurrentDate(new Date());
  }

  // reset filtre
  function handleResetFilters() {
    setSearchText("");
    setStatus("");
    setEventTypeFilter("");
    setProductTypeFilter("");
    setLocationFilter("");
  }

  // day modal
  function openDayModal(date) {
    setSelectedDay(date);
  }
  function closeDayModal() {
    setSelectedDay(null);
  }

  // drag & drop handlers pentru board
  function handleDragStart(orderId) {
    setDraggingOrderId(orderId);
  }
  function handleDragEnd() {
    setDraggingOrderId(null);
  }
  function handleDropOnColumn(col) {
    if (!draggingOrderId) return;
    const order = filteredItems.find((o) => o.id === draggingOrderId);
    if (order && order.status !== col) {
      changeStatus(order, col);
    }
    setDraggingOrderId(null);
  }

  return (
    <main className={styles.page}>
      {/* HEADER */}
      <div className={styles.headerRow}>
        <div className={styles.headerLeft}>
          <button
            type="button"
            className={styles.iconBtn}
            onClick={() => navigate("/vendor/orders")}
            aria-label="Înapoi la comenzi"
          >
            <ArrowLeft size={18} />
          </button>
          <div>
            <h1 className={styles.h1}>Planificare comenzi</h1>
            <p className={styles.muted}>
              Calendar + board de producție pentru comenzi, ridicări și
              livrări.
            </p>
          </div>
        </div>

        <div className={styles.headerActions}>
          {/* Toggle calendar / board */}
          <div className={styles.viewToggle}>
            <button
              type="button"
              className={
                viewMode === "calendar"
                  ? styles.viewBtnActive
                  : styles.viewBtn
              }
              onClick={() => setViewMode("calendar")}
            >
              <CalendarIcon size={14} /> Calendar
            </button>
            <button
              type="button"
              className={
                viewMode === "board" ? styles.viewBtnActive : styles.viewBtn
              }
              onClick={() => setViewMode("board")}
            >
              <LayoutPanelLeft size={14} /> Board
            </button>
          </div>

          {/* Mod calendar: week / month / year */}
          {viewMode === "calendar" && (
            <div className={styles.calendarModeToggle}>
              <button
                type="button"
                className={
                  calendarMode === "week"
                    ? styles.viewBtnActive
                    : styles.viewBtn
                }
                onClick={() => setCalendarMode("week")}
              >
                Săptămână
              </button>
              <button
                type="button"
                className={
                  calendarMode === "month"
                    ? styles.viewBtnActive
                    : styles.viewBtn
                }
                onClick={() => setCalendarMode("month")}
              >
                Lună
              </button>
              <button
                type="button"
                className={
                  calendarMode === "year"
                    ? styles.viewBtnActive
                    : styles.viewBtn
                }
                onClick={() => setCalendarMode("year")}
              >
                An
              </button>
            </div>
          )}

          {/* Butoane filtre */}
          <div className={styles.filtersButtons}>
            <button
              type="button"
              className={styles.secondaryBtn}
              onClick={() => setShowFiltersModal(true)}
            >
              <Filter size={14} /> Filtre
            </button>

            <button
              type="button"
              className={styles.iconBtn}
              onClick={handleResetFilters}
              aria-label="Resetează filtrele"
              title="Resetează filtrele"
            >
              <RotateCcw size={16} />
            </button>
          </div>
        </div>
      </div>

      {/* REZUMAT INTERVAL – operațional */}
      <div className={styles.intervalSummaryBar}>
        <span>
          Comenzi în interval: <strong>{filteredItems.length}</strong>
          {filteredItems.length !== items.length && (
            <span className={styles.muted}>
              {" "}
              (din {items.length} înainte de filtre)
            </span>
          )}
        </span>
        <span>
          Valoare comenzi:{" "}
          <strong>{formatMoney(intervalTotalAmount)}</strong>
        </span>
        <span>
          Finalizate: <strong>{intervalFulfilledCount}</strong>
        </span>
        <span>
          Anulate: <strong>{intervalCancelledCount}</strong>
        </span>
      </div>

      {/* REZUMAT CONTABIL – pliat */}
      <section className={styles.accountingSection}>
        <button
          type="button"
          className={styles.accountingToggle}
          onClick={() => setShowAccounting((v) => !v)}
        >
          <div className={styles.accountingToggleLeft}>
            <FileText size={14} />
            <span>Detalii financiare pe interval</span>
          </div>
          <span className={styles.accountingToggleHint}>
            {showAccounting
              ? "Ascunde"
              : `${formatMoney(
                  accountingStats.grossFulfilled
                )} încasări estimate`}
          </span>
        </button>

        {showAccounting && (
          <div className={styles.accountingSummaryBar}>
            <div className={styles.accountingItem}>
              <span className={styles.muted}>
                Total potențial (toate comenzile)
              </span>
              <div className={styles.accountingValue}>
                {formatMoney(accountingStats.grossTotal)}
              </div>
            </div>
            <div className={styles.accountingItem}>
              <span className={styles.muted}>
                Încasări estimate (Finalizate)
              </span>
              <div className={styles.accountingValue}>
                {formatMoney(accountingStats.grossFulfilled)}
              </div>
            </div>
            <div className={styles.accountingItem}>
              <span className={styles.muted}>Valoare pierdută (Anulate)</span>
              <div className={styles.accountingValueLoss}>
                −{formatMoney(accountingStats.grossCancelled)}
              </div>
            </div>
            <div className={styles.accountingItem}>
              <span className={styles.muted}>Structură plăți</span>
              <div className={styles.accountingValue}>
                <strong>{formatMoney(accountingStats.codTotal)}</strong>{" "}
                ramburs ·{" "}
                <strong>{formatMoney(accountingStats.cardTotal)}</strong> card
              </div>
            </div>
            <div className={styles.accountingItem}>
              <span className={styles.muted}>
                Rată conversie (finalizate vs. anulate)
              </span>
              <div className={styles.accountingValue}>
                {accountingStats.conversionRate.toFixed(1)}%
              </div>
            </div>
          </div>
        )}
      </section>

      {/* VIEW: CALENDAR */}
      {viewMode === "calendar" && (
        <>
          {/* CONTROALE DE INTERVAL */}
          <div className={styles.weekControls}>
            <button
              type="button"
              className={styles.secondaryBtn}
              onClick={handlePrevPeriod}
            >
              <ChevronLeft size={16} />{" "}
              {calendarMode === "week"
                ? "Săptămâna anterioară"
                : calendarMode === "month"
                ? "Luna anterioară"
                : "Anul anterior"}
            </button>

            <div className={styles.weekLabel}>
              <CalendarIcon size={16} />
              <span>
                {calendarMode === "week" &&
                  `${rangeStart.toLocaleDateString("ro-RO", {
                    day: "2-digit",
                    month: "short",
                  })} – ${rangeEnd.toLocaleDateString("ro-RO", {
                    day: "2-digit",
                    month: "short",
                    year: "numeric",
                  })}`}
                {calendarMode === "month" &&
                  rangeStart.toLocaleDateString("ro-RO", {
                    month: "long",
                    year: "numeric",
                  })}
                {calendarMode === "year" &&
                  rangeStart.getFullYear().toString()}
              </span>
            </div>

            <button
              type="button"
              className={styles.secondaryBtn}
              onClick={handleNextPeriod}
            >
              {calendarMode === "week"
                ? "Săptămâna următoare"
                : calendarMode === "month"
                ? "Luna următoare"
                : "Anul următor"}{" "}
              <ChevronRight size={16} />
            </button>

            <button
              type="button"
              className={styles.textBtn}
              onClick={handleToday}
            >
              Astăzi
            </button>
          </div>

          {/* WEEK / MONTH GRID */}
          {(calendarMode === "week" || calendarMode === "month") && (
            <div className={styles.calendar}>
              <div className={styles.calendarGrid}>
                {ordersByDay.map(({ date, items: dayOrders }) => {
                  const todayStr = new Date().toISOString().slice(0, 10);
                  const dayStr = date.toISOString().slice(0, 10);
                  const isToday = todayStr === dayStr;
                  const isOtherMonth =
                    calendarMode === "month" &&
                    date.getMonth() !== currentDate.getMonth();

                  const loadState = getDayLoadState(dayOrders);
                  const loadClass =
                    styles["calendarDayLoad_" + loadState] || "";

                  return (
                    <div
                      key={date.toISOString()}
                      className={`${styles.calendarDay} ${
                        isToday ? styles.calendarDayToday : ""
                      } ${isOtherMonth ? styles.calendarDayFaded : ""} ${
                        loadClass
                      }`}
                      onClick={() => openDayModal(date)}
                    >
                      <div className={styles.calendarDayHeader}>
                        <div>
                          <div className={styles.dayName}>
                            {date.toLocaleDateString("ro-RO", {
                              weekday: "short",
                            })}
                          </div>
                          <div className={styles.dayNum}>{date.getDate()}</div>
                        </div>
                        {dayOrders.length > 0 && (
                          <span className={styles.dayBadge}>
                            {dayOrders.length} comenzi
                          </span>
                        )}
                      </div>

                      <div className={styles.calendarDayList}>
                        {/* Comenzi – variantă simplificată */}
                        {dayOrders.slice(0, 3).map((o) => (
                          <div
                            key={o.id}
                            className={styles.orderCardWrapper}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <Link
                              to={`/vendor/orders/${o.id}`}
                              className={styles.orderCard}
                            >
                              <div className={styles.orderTitleRow}>
                                <span className={styles.orderTitleText}>
                                  {o.customerName || "Client"}
                                </span>
                                <span className={styles.orderId}>
                                  #{(o.shortId || o.id || "").slice(-6)}
                                </span>
                              </div>

                              <div className={styles.orderMetaRow}>
                                <span>{formatMoney(o.total)}</span>
                                {o.pickupDate && (
                                  <span className={styles.orderMetaTime}>
                                    {new Date(
                                      o.pickupDate
                                    ).toLocaleTimeString("ro-RO", {
                                      hour: "2-digit",
                                      minute: "2-digit",
                                    })}
                                  </span>
                                )}
                              </div>

                              <div className={styles.orderMetaTags}>
                                {o.eventType && (
                                  <span className={styles.tag}>
                                    {o.eventType}
                                  </span>
                                )}
                                {o.productType && (
                                  <span className={styles.tagSecondary}>
                                    {o.productType}
                                  </span>
                                )}
                              </div>
                            </Link>
                          </div>
                        ))}

                        {!loading && dayOrders.length === 0 && (
                          <div className={styles.emptyDay}>
                            Nicio activitate
                          </div>
                        )}

                        {dayOrders.length > 3 && (
                          <div className={styles.moreHint}>
                            +{dayOrders.length - 3} comenzi…
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {loading && (
                <div className={styles.loading}>
                  <Loader2 className={styles.spin} size={18} /> Se încarcă…
                </div>
              )}

              {err && (
                <p className={styles.error} style={{ marginTop: 8 }}>
                  {err}
                </p>
              )}
            </div>
          )}

          {/* YEAR OVERVIEW */}
          {calendarMode === "year" && (
            <section className={styles.yearSection}>
              <div className={styles.yearGrid}>
                {Array.from({ length: 12 }).map((_, i) => {
                  const dt = new Date(currentDate.getFullYear(), i, 1);
                  const monthOrders = filteredItems.filter((o) => {
                    const p = getPlanDate(o);
                    if (!p) return false;
                    const d = new Date(p);
                    return (
                      d.getFullYear() === dt.getFullYear() &&
                      d.getMonth() === dt.getMonth()
                    );
                  });

                  const preparing = monthOrders.filter(
                    (o) => o.status === "preparing"
                  ).length;
                  const confirmed = monthOrders.filter(
                    (o) => o.status === "confirmed"
                  ).length;

                  return (
                    <button
                      key={i}
                      type="button"
                      className={styles.yearMonthCard}
                      onClick={() => {
                        setCurrentDate(dt);
                        setCalendarMode("month");
                      }}
                    >
                      <div className={styles.yearMonthName}>
                        {dt.toLocaleDateString("ro-RO", {
                          month: "long",
                        })}
                      </div>
                      <div className={styles.yearMonthStats}>
                        <span>{monthOrders.length} comenzi</span>
                        <span>
                          {preparing} în pregătire · {confirmed} confirmate
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>

              {loading && (
                <div className={styles.loading}>
                  <Loader2 className={styles.spin} size={18} /> Se încarcă…
                </div>
              )}

              {err && (
                <p className={styles.error} style={{ marginTop: 8 }}>
                  {err}
                </p>
              )}
            </section>
          )}
        </>
      )}

      {/* VIEW: BOARD (KANBAN) – doar COMENZI */}
      {viewMode === "board" && (
        <section className={styles.board}>
          <header className={styles.boardHead}>
            <h2>Board comenzi pe status</h2>
            <p className={styles.muted}>
              To-do vizual pentru producție: câte comenzi sunt noi, în lucru,
              confirmate sau finalizate în intervalul selectat.
            </p>
          </header>

          <div className={styles.boardSummary}>
            <span>
              Total în interval (după filtre):{" "}
              <strong>{filteredItems.length}</strong> comenzi
            </span>
            <span>
              În pregătire:{" "}
              <strong>{boardColumns.preparing.length}</strong>
            </span>
            <span>
              Confirmate:{" "}
              <strong>{boardColumns.confirmed.length}</strong>
            </span>
            <span>
              Finalizate:{" "}
              <strong>{boardColumns.fulfilled.length}</strong>
            </span>
            <span>
              Valoare totală:{" "}
              <strong>{formatMoney(intervalTotalAmount)}</strong>
            </span>
          </div>

          {/* legendă status */}
          <div className={styles.boardLegend}>
            <span>
              <span className={styles.statusDotNew} /> Nouă
            </span>
            <span>
              <span className={styles.statusDotPreparing} /> În pregătire
            </span>
            <span>
              <span className={styles.statusDotConfirmed} /> Confirmată
            </span>
            <span>
              <span className={styles.statusDotFulfilled} /> Finalizată
            </span>
            <span>
              <span className={styles.statusDotCancelled} /> Anulată
            </span>
          </div>

          <div className={styles.boardColumns}>
            {["new", "preparing", "confirmed", "fulfilled", "cancelled"].map(
              (col) => {
                const colItems = boardColumns[col] || [];
                if (col === "cancelled" && colItems.length === 0) {
                  return null;
                }
                return (
                  <div
                    key={col}
                    className={`${styles.boardColumn} ${
                      col === "cancelled" ? styles.boardColumnMuted : ""
                    }`}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => handleDropOnColumn(col)}
                  >
                    <div className={styles.boardColumnHead}>
                      <div>
                        <div className={styles.boardColTitle}>
                          {STATUS_LABEL[col] ||
                            (col === "cancelled" ? "Anulată" : col)}
                        </div>
                        <div className={styles.boardColCount}>
                          {colItems.length} comenzi
                        </div>
                      </div>
                    </div>

                    <div className={styles.boardCards}>
                      {colItems.map((o) => {
                        const threadId = o.messageThreadId || o.threadId;
                        const unread =
                          o.messageUnreadCount ?? o.unreadCount ?? 0;

                        return (
                          <article
                            key={o.id}
                            className={`${styles.boardCard} ${
                              draggingOrderId === o.id
                                ? styles.boardCardDragging
                                : ""
                            }`}
                            draggable
                            onDragStart={() => handleDragStart(o.id)}
                            onDragEnd={handleDragEnd}
                          >
                            <header className={styles.boardCardHeader}>
                              <div>
                                <div className={styles.boardCardTitle}>
                                  {o.customerName || "Client"}{" "}
                                  <span className={styles.orderId}>
                                    #{(o.shortId || o.id || "").slice(-6)}
                                  </span>
                                </div>
                                <div className={styles.boardCardMeta}>
                                  {formatMoney(o.total)} ·{" "}
                                  {formatDate(o.createdAt)}
                                </div>
                                <div className={styles.boardCardExtraMeta}>
                                  {o.eventType && <span>{o.eventType}</span>}
                                  {o.productType && (
                                    <>
                                      {" "}
                                      · <span>{o.productType}</span>
                                    </>
                                  )}
                                  {o.location && (
                                    <>
                                      {" "}
                                      · <span>{o.location}</span>
                                    </>
                                  )}
                                </div>
                              </div>
                              <div className={styles.boardCardHeaderRight}>
                                <Link
                                  to={`/vendor/orders/${o.id}`}
                                  className={styles.boardDetailsLink}
                                >
                                  Detalii
                                </Link>

                                {/* buton Mesaje dacă există thread */}
                                {threadId && (
                                  <Link
                                    to={`/vendor/messages?threadId=${threadId}`}
                                    className={styles.boardDetailsLink}
                                  >
                                    <MessageSquare size={14} />
                                    {unread > 0 && (
                                      <span className={styles.unreadDot}>
                                        {unread}
                                      </span>
                                    )}
                                  </Link>
                                )}
                              </div>
                            </header>

                            {o.pickupDate && (
                              <div className={styles.boardCardPickup}>
                                Ridicare:{" "}
                                {new Date(
                                  o.pickupDate
                                ).toLocaleDateString("ro-RO", {
                                  weekday: "short",
                                  day: "2-digit",
                                  month: "short",
                                })}
                              </div>
                            )}

                            <div className={styles.boardCardActions}>
                              {col === "new" && (
                                <>
                                  <button
                                    type="button"
                                    className={styles.smallBtnPrimary}
                                    onClick={() =>
                                      changeStatus(o, "preparing")
                                    }
                                  >
                                    În pregătire
                                  </button>
                                  <button
                                    type="button"
                                    className={styles.smallBtnGhost}
                                    onClick={() =>
                                      changeStatus(o, "cancelled")
                                    }
                                  >
                                    Anulează
                                  </button>
                                </>
                              )}

                              {col === "preparing" && (
                                <>
                                  <button
                                    type="button"
                                    className={styles.smallBtnPrimary}
                                    onClick={() =>
                                      changeStatus(o, "confirmed")
                                    }
                                  >
                                    Confirmă
                                  </button>
                                  <button
                                    type="button"
                                    className={styles.smallBtnGhost}
                                    onClick={() =>
                                      changeStatus(o, "cancelled")
                                    }
                                  >
                                    Anulează
                                  </button>
                                </>
                              )}

                              {col === "confirmed" && (
                                <>
                                  <button
                                    type="button"
                                    className={styles.smallBtnPrimary}
                                    onClick={() =>
                                      changeStatus(o, "fulfilled")
                                    }
                                  >
                                    Finalizată
                                  </button>
                                  <button
                                    type="button"
                                    className={styles.smallBtnGhost}
                                    onClick={() =>
                                      changeStatus(o, "cancelled")
                                    }
                                  >
                                    Anulează
                                  </button>
                                </>
                              )}

                              {col === "fulfilled" && (
                                <span className={styles.boardDoneLabel}>
                                  Gata 🎉
                                </span>
                              )}

                              {col === "cancelled" && (
                                <span className={styles.boardCancelledLabel}>
                                  Anulată
                                </span>
                              )}
                            </div>
                          </article>
                        );
                      })}

                      {colItems.length === 0 && (
                        <div className={styles.boardEmpty}>
                          Nicio comandă în această coloană.
                        </div>
                      )}
                    </div>
                  </div>
                );
              }
            )}
          </div>

          {loading && (
            <div className={styles.loading}>
              <Loader2 className={styles.spin} size={18} /> Se încarcă…
            </div>
          )}

          {err && (
            <p className={styles.error} style={{ marginTop: 8 }}>
              {err}
            </p>
          )}
        </section>
      )}

      {/* MODAL ZI (detalii pe o zi: doar comenzi) */}
      {selectedDay && (
        <DayDetailsModal
          date={selectedDay}
          orders={
            ordersByDay.find(
              (d) =>
                d.date.toISOString().slice(0, 10) ===
                selectedDay.toISOString().slice(0, 10)
            )?.items || []
          }
          onClose={closeDayModal}
          navigate={navigate}
        />
      )}

      {/* MODAL FILTRE */}
      {showFiltersModal && (
        <div
          className={styles.notesModalBackdrop}
          role="dialog"
          aria-modal="true"
        >
          <div className={styles.notesModal}>
            <div className={styles.notesModalHead}>
              <h3>Filtre comenzi</h3>
              <button
                type="button"
                className={styles.iconBtn}
                onClick={() => setShowFiltersModal(false)}
                aria-label="Închide"
              >
                <X size={16} />
              </button>
            </div>

            <div className={styles.filtersModalBody}>
              <div className={styles.filtersFieldGroup}>
                <label className={styles.filtersLabel}>Căutare</label>
                <input
                  type="text"
                  className={styles.searchInput}
                  placeholder="Client, ID comandă..."
                  value={searchText}
                  onChange={(e) => setSearchText(e.target.value)}
                />
              </div>

              <div className={styles.filtersFieldGroup}>
                <label className={styles.filtersLabel}>Status comandă</label>
                <select
                  className={styles.filtersSelect}
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                >
                  {STATUS_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>

              {derivedEventTypes.length > 0 && (
                <div className={styles.filtersFieldGroup}>
                  <label className={styles.filtersLabel}>Tip eveniment</label>
                  <select
                    className={styles.filtersSelect}
                    value={eventTypeFilter}
                    onChange={(e) => setEventTypeFilter(e.target.value)}
                  >
                    <option value="">Toate</option>
                    {derivedEventTypes.map((et) => (
                      <option key={et} value={et}>
                        {et}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {derivedProductTypes.length > 0 && (
                <div className={styles.filtersFieldGroup}>
                  <label className={styles.filtersLabel}>Tip produs</label>
                  <select
                    className={styles.filtersSelect}
                    value={productTypeFilter}
                    onChange={(e) => setProductTypeFilter(e.target.value)}
                  >
                    <option value="">Toate</option>
                    {derivedProductTypes.map((pt) => (
                      <option key={pt} value={pt}>
                        {pt}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {derivedLocations.length > 0 && (
                <div className={styles.filtersFieldGroup}>
                  <label className={styles.filtersLabel}>Locație</label>
                  <select
                    className={styles.filtersSelect}
                    value={locationFilter}
                    onChange={(e) => setLocationFilter(e.target.value)}
                  >
                    <option value="">Toate</option>
                    {derivedLocations.map((loc) => (
                      <option key={loc} value={loc}>
                        {loc}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            <div className={styles.notesActions}>
              <button
                type="button"
                className={styles.secondaryBtn}
                onClick={() => {
                  handleResetFilters();
                  setShowFiltersModal(false);
                }}
              >
                Resetare filtre
              </button>
              <button
                type="button"
                className={styles.primaryBtn}
                onClick={() => setShowFiltersModal(false)}
              >
                Aplică filtrele
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

/* ===== DayDetailsModal: detalii pentru o zi (doar comenzi) ===== */

function DayDetailsModal({ date, orders, onClose, navigate }) {
  const dayLabel = date.toLocaleDateString("ro-RO", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });

  const totalAmount = orders.reduce(
    (acc, o) => acc + (Number(o.total) || 0),
    0
  );

  const statusCounts = orders.reduce(
    (acc, o) => {
      const st = o.status || "unknown";
      acc[st] = (acc[st] || 0) + 1;
      return acc;
    },
    {}
  );

  // mic rezumat contabil pe zi
  const fulfilledAmount = orders.reduce(
    (acc, o) =>
      o.status === "fulfilled" ? acc + (Number(o.total) || 0) : acc,
    0
  );
  const cancelledAmount = orders.reduce(
    (acc, o) =>
      o.status === "cancelled" ? acc + (Number(o.total) || 0) : acc,
    0
  );
  const codTotal = orders.reduce(
    (acc, o) =>
      o.paymentMethod === "COD" ? acc + (Number(o.total) || 0) : acc,
    0
  );
  const cardTotal = orders.reduce(
    (acc, o) =>
      o.paymentMethod === "CARD" ? acc + (Number(o.total) || 0) : acc,
    0
  );

  return (
    <div className={styles.notesModalBackdrop} role="dialog" aria-modal="true">
      <div className={styles.dayModal}>
        <div className={styles.dayModalHead}>
          <h3>{dayLabel}</h3>
          <button
            type="button"
            className={styles.iconBtn}
            onClick={onClose}
            aria-label="Închide"
          >
            <X size={16} />
          </button>
        </div>

        <div className={styles.dayModalActions}>
          <button
            type="button"
            className={styles.primaryBtn}
            onClick={() => {
              navigate(
                `/vendor/orders?date=${date.toISOString().slice(0, 10)}`
              );
            }}
          >
            + Adaugă comandă / activitate
          </button>
        </div>

        {/* rezumat zi */}
        <div className={styles.daySummary}>
          <span>
            Comenzi în această zi: <strong>{orders.length}</strong>
          </span>
          <span>
            Valoare comenzi: <strong>{formatMoney(totalAmount)}</strong>
          </span>
          <span>
            Estimare încasări (Finalizate):{" "}
            <strong>{formatMoney(fulfilledAmount)}</strong>
          </span>
          <span>
            Valoare pierdută (Anulate):{" "}
            <strong>−{formatMoney(cancelledAmount)}</strong>
          </span>
          <span>
            Structură plăți:{" "}
            <strong>{formatMoney(codTotal)}</strong> ramburs ·{" "}
            <strong>{formatMoney(cardTotal)}</strong> card
          </span>
          {Object.keys(statusCounts).length > 0 && (
            <span className={styles.daySummaryStatuses}>
              {Object.entries(statusCounts).map(([st, count]) => (
                <span key={st}>
                  {STATUS_LABEL[st] || st}: <strong>{count}</strong>
                </span>
              ))}
            </span>
          )}
        </div>

        {/* LISTĂ COMENZI */}
        {orders.length === 0 ? (
          <p className={styles.muted}>
            Nu există comenzi sau activități planificate pentru această zi.
          </p>
        ) : (
          <>
            <h4 className={styles.daySectionTitle}>Comenzi</h4>
            <ul className={styles.dayOrdersList}>
              {orders.map((o) => {
                const threadId = o.messageThreadId || o.threadId;
                const unread =
                  o.messageUnreadCount ?? o.unreadCount ?? 0;

                return (
                  <li key={o.id} className={styles.dayOrderItem}>
                    <div className={styles.dayOrderHeader}>
                      <div>
                        <div className={styles.boardCardTitle}>
                          {o.customerName || "Client"}{" "}
                          <span className={styles.orderId}>
                            #
                            {(o.shortId || o.id || "").slice(-6)}
                          </span>
                        </div>
                        <div className={styles.boardCardMeta}>
                          {formatMoney(o.total)} ·{" "}
                          {STATUS_LABEL[o.status] || o.status || "—"}
                        </div>
                        <div className={styles.boardCardExtraMeta}>
                          {o.eventType && <span>{o.eventType}</span>}
                          {o.productType && (
                            <>
                              {" "}
                              · <span>{o.productType}</span>
                            </>
                          )}
                          {o.location && (
                            <>
                              {" "}
                              · <span>{o.location}</span>
                            </>
                          )}
                        </div>
                      </div>
                      <div className={styles.dayOrderHeaderRight}>
                        <Link
                          to={`/vendor/orders/${o.id}`}
                          className={styles.boardDetailsLink}
                        >
                          Detalii
                        </Link>

                        {threadId && (
                          <Link
                            to={`/vendor/messages?threadId=${threadId}`}
                            className={styles.boardDetailsLink}
                          >
                            <MessageSquare size={14} />
                            {unread > 0 && (
                              <span className={styles.unreadDot}>
                                {unread}
                              </span>
                            )}
                          </Link>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
