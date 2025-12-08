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
  MessageSquare, // 🔹 icon Mesaje
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

// Lead status UI (din inbox)
const LEAD_STATUS_LABEL = {
  nou: "Nou",
  in_discutii: "În discuții",
  oferta_trimisa: "Ofertă trimisă",
  rezervat: "Rezervat",
  pierdut: "Pierdut",
};

// capacitate orientativă per zi (poți ajusta sau scoate)
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

// range helper pentru leads
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

  // 🔽 LEADS (din inbox / threads)
  const [leadItems, setLeadItems] = useState([]);
  const [loadingLeads, setLoadingLeads] = useState(false);
  const [errLeads, setErrLeads] = useState("");

  // filtre avansate (comun pentru comenzi + lead-uri)
  const [searchText, setSearchText] = useState("");
  const [eventTypeFilter, setEventTypeFilter] = useState("");
  const [productTypeFilter, setProductTypeFilter] = useState("");
  const [locationFilter, setLocationFilter] = useState("");

  // notițe comenzi
  const [editingNotesOrder, setEditingNotesOrder] = useState(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [savingNote, setSavingNote] = useState(false);

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

  // === efect: încărcare LEAD-uri (din inbox) în același interval ===
  useEffect(() => {
    let alive = true;

    async function run() {
      setLoadingLeads(true);
      setErrLeads("");

      try {
        const { start, end } = getRange(calendarMode, currentDate);

        const qs = new URLSearchParams({
          from: start.toISOString().slice(0, 10),
          to: end.toISOString().slice(0, 10),
        }).toString();

        const res = await api(`/api/inbox/planning/leads?${qs}`);
        if (!alive) return;
        setLeadItems(Array.isArray(res?.items) ? res.items : []);
      } catch {
        if (!alive) return;
        setErrLeads("Nu am putut încărca lead-urile din mesaje.");
      } finally {
        if (alive) setLoadingLeads(false);
      }
    }

    run();

    return () => {
      alive = false;
    };
  }, [calendarMode, currentDate]);

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

  // aplicăm filtrele avansate pe COMENZI
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
        o.vendorNotes,
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

  // 🔽 aplicăm filtrele pe LEAD-uri (folosim doar search + tip eveniment + locație)
  const filteredLeads = useMemo(() => {
    const search = searchText.trim().toLowerCase();
    return leadItems.filter((l) => {
      if (eventTypeFilter && l.eventType !== eventTypeFilter) return false;
      if (locationFilter && l.eventLocation !== locationFilter) return false;

      if (!search) return true;

      const haystack = [l.name, l.phone, l.eventType, l.eventLocation]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return haystack.includes(search);
    });
  }, [leadItems, searchText, eventTypeFilter, locationFilter]);

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

  // grupare pe zile pentru LEAD-URI
  const leadsByDay =
    calendarMode === "year"
      ? []
      : days.map((d) => {
          const dayStr = getDateKey(d);
          return {
            date: d,
            items: filteredLeads.filter((l) => {
              if (!l.eventDate) return false;
              const s = getDateKey(l.eventDate);
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

  // 🔢 REZUMAT CONTABIL PE INTERVAL (din filteredItems)
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

  // statistici LEAD-uri pe interval
  const totalLeadsInterval = filteredLeads.length;
  const leadStatusCounts = useMemo(
    () =>
      filteredLeads.reduce((acc, l) => {
        const st = l.status || "nou";
        acc[st] = (acc[st] || 0) + 1;
        return acc;
      }, {}),
    [filteredLeads]
  );

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

  // --- Notițe: open / close / save (COMENZI) ---
  function openNotesModal(order) {
    setEditingNotesOrder(order);
    setNoteDraft(order.vendorNotes || "");
  }

  function closeNotesModal() {
    setEditingNotesOrder(null);
    setNoteDraft("");
    setSavingNote(false);
  }

  async function saveNotes() {
    if (!editingNotesOrder) return;
    setSavingNote(true);
    try {
      const res = await api(
        `/api/vendor/orders/${editingNotesOrder.id}/notes`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ vendorNotes: noteDraft }),
        }
      );
      const newNotes = res?.vendorNotes ?? noteDraft;
      setItems((prev) =>
        prev.map((o) =>
          o.id === editingNotesOrder.id ? { ...o, vendorNotes: newNotes } : o
        )
      );
      closeNotesModal();
    } catch {
      setErr("Nu am putut salva notițele. Încearcă din nou.");
      setSavingNote(false);
    }
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
              Calendar + board de producție pentru comenzi, ridicări, livrări
              și lead-uri de evenimente venite din mesaje.
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

          {/* Filtre avansate */}
          <div className={styles.extraFilters}>
            <div className={styles.searchWrapper}>
              <input
                type="text"
                className={styles.searchInput}
                placeholder="Caută după client, ID, notițe, eveniment..."
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
              />
            </div>

            {derivedEventTypes.length > 0 && (
              <select
                className={styles.select}
                value={eventTypeFilter}
                onChange={(e) => setEventTypeFilter(e.target.value)}
                aria-label="Filtru tip eveniment"
              >
                <option value="">Tip eveniment</option>
                {derivedEventTypes.map((et) => (
                  <option key={et} value={et}>
                    {et}
                  </option>
                ))}
              </select>
            )}

            {derivedProductTypes.length > 0 && (
              <select
                className={styles.select}
                value={productTypeFilter}
                onChange={(e) => setProductTypeFilter(e.target.value)}
                aria-label="Filtru tip produs"
              >
                <option value="">Tip produs</option>
                {derivedProductTypes.map((pt) => (
                  <option key={pt} value={pt}>
                    {pt}
                  </option>
                ))}
              </select>
            )}

            {derivedLocations.length > 0 && (
              <select
                className={styles.select}
                value={locationFilter}
                onChange={(e) => setLocationFilter(e.target.value)}
                aria-label="Filtru locație"
              >
                <option value="">Locație</option>
                {derivedLocations.map((loc) => (
                  <option key={loc} value={loc}>
                    {loc}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Filtru status (COMENZI) */}
          <div className={styles.statusFilter}>
            <Filter size={14} />
            <select
              className={styles.select}
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              aria-label="Filtru status comenzi"
            >
              {STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
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

        {/* 🔽 sumar LEAD-uri evenimente */}
        <span className={styles.intervalLeadsSummary}>
          Lead-uri evenimente:{" "}
          <strong>{totalLeadsInterval}</strong>
          {totalLeadsInterval > 0 && (
            <span className={styles.muted}>
              {" "}
              · Rezervate:{" "}
              <strong>{leadStatusCounts.rezervat || 0}</strong> · Ofertă
              trimisă:{" "}
              <strong>{leadStatusCounts.oferta_trimisa || 0}</strong>
            </span>
          )}
        </span>
      </div>

      {/* 🔢 REZUMAT CONTABIL – „mini contabilitate” pe interval */}
      <div className={styles.accountingSummaryBar}>
        <div className={styles.accountingItem}>
          <span className={styles.muted}>Total potențial (toate comenzile)</span>
          <div className={styles.accountingValue}>
            {formatMoney(accountingStats.grossTotal)}
          </div>
        </div>
        <div className={styles.accountingItem}>
          <span className={styles.muted}>Încasări estimate (Finalizate)</span>
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
            <strong>{formatMoney(accountingStats.codTotal)}</strong> ramburs ·{" "}
            <strong>{formatMoney(accountingStats.cardTotal)}</strong> card
          </div>
        </div>
        <div className={styles.accountingItem}>
          <span className={styles.muted}>Rată conversie (finalizate vs. anulate)</span>
          <div className={styles.accountingValue}>
            {accountingStats.conversionRate.toFixed(1)}%
          </div>
        </div>
      </div>

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
                {ordersByDay.map(({ date, items: dayOrders }, idx) => {
                  const todayStr = new Date().toISOString().slice(0, 10);
                  const dayStr = date.toISOString().slice(0, 10);
                  const isToday = todayStr === dayStr;
                  const isOtherMonth =
                    calendarMode === "month" &&
                    date.getMonth() !== currentDate.getMonth();

                  const loadState = getDayLoadState(dayOrders);
                  const loadClass =
                    styles["calendarDayLoad_" + loadState] || "";

                  const dayLeads = leadsByDay[idx]?.items || [];

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
                          <div className={styles.dayNum}>
                            {date.getDate()}
                          </div>
                        </div>
                        {(dayOrders.length > 0 || dayLeads.length > 0) && (
                          <span className={styles.dayBadge}>
                            {dayOrders.length} comenzi ·{" "}
                            {dayLeads.length} lead-uri
                          </span>
                        )}
                      </div>

                      <div className={styles.calendarDayList}>
                        {/* Comenzi */}
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
                              <div className={styles.orderTitle}>
                                {o.customerName || "Client"}{" "}
                                <span className={styles.orderId}>
                                  #{(o.shortId || o.id || "").slice(-6)}
                                </span>
                              </div>
                              <div className={styles.orderMeta}>
                                {formatMoney(o.total)} ·{" "}
                                {STATUS_LABEL[o.status] ||
                                  o.status ||
                                  "—"}
                              </div>

                              {/* info extra: tip eveniment / produs / ora */}
                              <div className={styles.orderExtraMeta}>
                                {o.eventType && (
                                  <span>{o.eventType}</span>
                                )}
                                {o.productType && (
                                  <>
                                    {" "}
                                    · <span>{o.productType}</span>
                                  </>
                                )}
                                {o.pickupDate && (
                                  <>
                                    {" "}
                                    ·{" "}
                                    <span>
                                      {new Date(
                                        o.pickupDate
                                      ).toLocaleTimeString("ro-RO", {
                                        hour: "2-digit",
                                        minute: "2-digit",
                                      })}
                                    </span>
                                  </>
                                )}
                              </div>

                              {o.pickupDate && (
                                <div className={styles.orderPickup}>
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

                              {o.vendorNotes && (
                                <div
                                  className={styles.orderNotesPreview}
                                >
                                  📝 {o.vendorNotes.slice(0, 60)}
                                  {o.vendorNotes.length > 60 ? "…" : ""}
                                </div>
                              )}
                            </Link>

                            <button
                              type="button"
                              className={styles.notesBtn}
                              onClick={() => openNotesModal(o)}
                              title={
                                o.vendorNotes
                                  ? "Editează notițele"
                                  : "Adaugă notițe"
                              }
                            >
                              <FileText size={14} />
                            </button>
                          </div>
                        ))}

                        {!loading &&
                          dayOrders.length === 0 &&
                          dayLeads.length === 0 && (
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

                      {/* 🔽 LEAD-uri evenimente (vizual separat) */}
                      {dayLeads.length > 0 && (
                        <div className={styles.calendarDayLeads}>
                          {dayLeads.slice(0, 3).map((l) => {
                            const threadId =
                              l.messageThreadId || l.threadId;
                            const unread =
                              l.messageUnreadCount ??
                              l.unreadCount ??
                              0;

                            return (
                              <div
                                key={l.id}
                                className={styles.leadPill}
                                onClick={(e) =>
                                  e.stopPropagation()
                                }
                              >
                                <div className={styles.leadPillTop}>
                                  <span className={styles.leadName}>
                                    {l.name || "Vizitator"}
                                  </span>
                                  {l.status && (
                                    <span
                                      className={`${styles.leadStatus} ${
                                        styles[
                                          "leadStatus_" + l.status
                                        ]
                                      }`}
                                    >
                                      {LEAD_STATUS_LABEL[l.status] ||
                                        l.status}
                                    </span>
                                  )}
                                </div>
                                <div className={styles.leadPillMeta}>
                                  {l.eventType && (
                                    <span>{l.eventType}</span>
                                  )}
                                  {l.eventLocation && (
                                    <>
                                      {" "}
                                      · <span>{l.eventLocation}</span>
                                    </>
                                  )}
                                  {(l.budgetMin ||
                                    l.budgetMax) && (
                                    <>
                                      {" "}
                                      ·{" "}
                                      <span>
                                        Buget:{" "}
                                        {l.budgetMin
                                          ? `${l.budgetMin}€`
                                          : "?"}{" "}
                                        –{" "}
                                        {l.budgetMax
                                          ? `${l.budgetMax}€`
                                          : "?"}
                                      </span>
                                    </>
                                  )}
                                </div>

                                {/* 🔗 link rapid în mesaje, dacă avem thread */}
                                {threadId && (
                                  <Link
                                    to={`/vendor/messages?threadId=${threadId}`}
                                    className={styles.leadLink}
                                    onClick={(e) =>
                                      e.stopPropagation()
                                    }
                                  >
                                    <MessageSquare size={12} /> Mesaje
                                    {unread > 0 && (
                                      <span
                                        className={
                                          styles.unreadDot
                                        }
                                      >
                                        {unread}
                                      </span>
                                    )}
                                  </Link>
                                )}
                              </div>
                            );
                          })}
                          {dayLeads.length > 3 && (
                            <div className={styles.moreHintLeads}>
                              +{dayLeads.length - 3} lead-uri…
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {(loading || loadingLeads) && (
                <div className={styles.loading}>
                  <Loader2 className={styles.spin} size={18} /> Se
                  încarcă…
                </div>
              )}

              {(err || errLeads) && (
                <p className={styles.error} style={{ marginTop: 8 }}>
                  {err || errLeads}
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

                  const monthLeads = filteredLeads.filter((l) => {
                    if (!l.eventDate) return false;
                    const d = new Date(l.eventDate);
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
                        <span>
                          {monthLeads.length} lead-uri evenimente
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>

              {(loading || loadingLeads) && (
                <div className={styles.loading}>
                  <Loader2 className={styles.spin} size={18} /> Se
                  încarcă…
                </div>
              )}

              {(err || errLeads) && (
                <p className={styles.error} style={{ marginTop: 8 }}>
                  {err || errLeads}
                </p>
              )}
            </section>
          )}
        </>
      )}

      {/* VIEW: BOARD (KANBAN) – rămâne doar pe COMENZI */}
      {viewMode === "board" && (
        <section className={styles.board}>
          <header className={styles.boardHead}>
            <h2>Board comenzi pe status</h2>
            <p className={styles.muted}>
              To-do vizual pentru producție: câte comenzi sunt noi, în
              lucru, confirmate sau finalizate în intervalul selectat.  
              Lead-urile de eveniment apar în calendarul de mai sus.
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
              <span className={styles.statusDotPreparing} /> În
              pregătire
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
                        const threadId =
                          o.messageThreadId || o.threadId;
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
                                  {o.eventType && (
                                    <span>{o.eventType}</span>
                                  )}
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

                                {/* 🔗 buton Mesaje dacă există thread */}
                                {threadId && (
                                  <Link
                                    to={`/vendor/messages?threadId=${threadId}`}
                                    className={styles.boardDetailsLink}
                                  >
                                    <MessageSquare size={14} />
                                    {unread > 0 && (
                                      <span
                                        className={
                                          styles.unreadDot
                                        }
                                      >
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

                            {o.vendorNotes && (
                              <div className={styles.boardCardNotes}>
                                📝 {o.vendorNotes.slice(0, 80)}
                                {o.vendorNotes.length > 80 ? "…" : ""}
                              </div>
                            )}

                            <div className={styles.boardCardActions}>
                              <button
                                type="button"
                                className={styles.smallBtnGhost}
                                onClick={() => openNotesModal(o)}
                              >
                                <FileText size={14} /> Notițe
                              </button>

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
                                <span
                                  className={styles.boardCancelledLabel}
                                >
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

      {/* MODAL ZI (detalii pe o zi: comenzi + lead-uri) */}
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
          leads={
            leadsByDay.find(
              (d) =>
                d.date.toISOString().slice(0, 10) ===
                selectedDay.toISOString().slice(0, 10)
            )?.items || []
          }
          onClose={closeDayModal}
          onOpenNotes={openNotesModal}
          navigate={navigate}
        />
      )}

      {/* MODAL NOTIȚE (comenzi) */}
      {editingNotesOrder && (
        <div
          className={styles.notesModalBackdrop}
          role="dialog"
          aria-modal="true"
        >
          <div className={styles.notesModal}>
            <div className={styles.notesModalHead}>
              <h3>
                Notițe pentru comanda{" "}
                <span className={styles.orderId}>
                  #
                  {(editingNotesOrder.shortId ||
                    editingNotesOrder.id ||
                    "").slice(-6)}
                </span>
              </h3>
              <button
                type="button"
                className={styles.iconBtn}
                onClick={closeNotesModal}
                aria-label="Închide"
              >
                <X size={16} />
              </button>
            </div>

            <p className={styles.muted}>
              Scrie aici detalii importante despre personalizare, preferințele
              clientului, culori, texte, livrare etc. Notițele sunt vizibile
              doar pentru tine.
            </p>

            <textarea
              className={styles.notesTextarea}
              value={noteDraft}
              onChange={(e) => setNoteDraft(e.target.value)}
              placeholder="Ex: Invitatii mov pastel, text în engleză, font script; adaugă inițialele mirilor pe plic."
              rows={6}
            />

            <div className={styles.notesActions}>
              <button
                type="button"
                className={styles.secondaryBtn}
                onClick={closeNotesModal}
                disabled={savingNote}
              >
                Renunță
              </button>
              <button
                type="button"
                className={styles.primaryBtn}
                onClick={saveNotes}
                disabled={savingNote}
              >
                {savingNote ? (
                  <Loader2 className={styles.spin} size={16} />
                ) : (
                  "Salvează notițele"
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

/* ===== DayDetailsModal: detalii pentru o zi ===== */

function DayDetailsModal({
  date,
  orders,
  leads,
  onClose,
  onOpenNotes,
  navigate,
}) {
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

  const leadStatusCounts = leads.reduce(
    (acc, l) => {
      const st = l.status || "nou";
      acc[st] = (acc[st] || 0) + 1;
      return acc;
    },
    {}
  );

  // 🔢 mic rezumat contabil pe zi
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
            Lead-uri evenimente: <strong>{leads.length}</strong>
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
          {Object.keys(leadStatusCounts).length > 0 && (
            <span className={styles.daySummaryStatuses}>
              {Object.entries(leadStatusCounts).map(([st, count]) => (
                <span key={st}>
                  {LEAD_STATUS_LABEL[st] || st}:{" "}
                  <strong>{count}</strong>
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

                    {o.vendorNotes && (
                      <div className={styles.dayOrderNotes}>
                        📝 {o.vendorNotes}
                      </div>
                    )}

                    <div className={styles.dayOrderActions}>
                      <button
                        type="button"
                        className={styles.smallBtnGhost}
                        onClick={() => onOpenNotes(o)}
                      >
                        <FileText size={14} /> Notițe
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </>
        )}

        {/* LISTĂ LEAD-URI */}
        {leads.length > 0 && (
          <>
            <h4 className={styles.daySectionTitle}>
              Lead-uri evenimente (din Mesaje)
            </h4>
            <ul className={styles.dayLeadsList}>
              {leads.map((l) => {
                const threadId = l.messageThreadId || l.threadId;
                const unread =
                  l.messageUnreadCount ?? l.unreadCount ?? 0;

                return (
                  <li key={l.id} className={styles.dayLeadItem}>
                    <div className={styles.dayLeadHeader}>
                      <div>
                        <div className={styles.leadName}>
                          {l.name || "Vizitator"}
                        </div>
                        <div className={styles.leadPillMeta}>
                          {l.eventType && <span>{l.eventType}</span>}
                          {l.eventLocation && (
                            <>
                              {" "}
                              · <span>{l.eventLocation}</span>
                            </>
                          )}
                          {(l.budgetMin || l.budgetMax) && (
                            <>
                              {" "}
                              ·{" "}
                              <span>
                                Buget:{" "}
                                {l.budgetMin
                                  ? `${l.budgetMin}€`
                                  : "?"}{" "}
                                –{" "}
                                {l.budgetMax
                                  ? `${l.budgetMax}€`
                                  : "?"}
                              </span>
                            </>
                          )}
                        </div>
                        {l.phone && (
                          <div className={styles.leadPhone}>{l.phone}</div>
                        )}
                      </div>

                      <div className={styles.dayLeadHeaderRight}>
                        {l.status && (
                          <span
                            className={`${styles.leadStatus} ${
                              styles["leadStatus_" + l.status]
                            }`}
                          >
                            {LEAD_STATUS_LABEL[l.status] || l.status}
                          </span>
                        )}

                        {threadId && (
                          <Link
                            to={`/vendor/messages?threadId=${threadId}`}
                            className={styles.leadLink}
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
