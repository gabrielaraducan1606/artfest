import React, { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./ShopPlanner.module.css";
import { api } from "../../../lib/api";
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  CheckCircle2,
  Clock,
  Filter,
  RefreshCw,
} from "lucide-react";

/* =========== Helpers de dată =========== */
function startOfWeek(d) {
  const dt = new Date(d);
  const day = (dt.getDay() + 6) % 7; // luni=0
  dt.setHours(0, 0, 0, 0);
  dt.setDate(dt.getDate() - day);
  return dt;
}
function addDays(d, n) {
  const dt = new Date(d);
  dt.setDate(dt.getDate() + n);
  return dt;
}
function makeDays(baseDate, total = 14) {
  const arr = [];
  for (let i = 0; i < total; i++) arr.push(addDays(baseDate, i));
  return arr;
}
function isoDate(d) { return d.toISOString().slice(0, 10); }
function fmtDay(d) {
  return d.toLocaleDateString("ro-RO", { weekday: "short", day: "numeric", month: "short" });
}

/* Map status -> UI */
const STATUS_META = {
  PENDING: { label: "În așteptare", cls: styles.stPending, icon: <Clock size={14}/> },
  IN_PROGRESS: { label: "În lucru", cls: styles.stProgress, icon: <RefreshCw size={14}/> },
  DONE: { label: "Finalizat", cls: styles.stDone, icon: <CheckCircle2 size={14}/> },
};

/* ================== Planner principal ================== */
export default function ShopPlanner() {
  const [weeks] = useState(2); // 1 sau 2 săptămâni vizibile
  const [base, setBase] = useState(() => startOfWeek(new Date()));
  const days = useMemo(() => makeDays(base, weeks * 7), [base, weeks]);

  const [loading, setLoading] = useState(false);
  const [tasks, setTasks] = useState([]);     // { id, date, title, customer, status }
  const [filter, setFilter] = useState("ALL"); // ALL | PENDING | IN_PROGRESS | DONE
  const [error, setError] = useState(null);

  // range memo (ca să treacă linterul corect)
  const range = useMemo(() => {
    const from = days[0] ? isoDate(days[0]) : "";
    const to = days.at(-1) ? isoDate(days.at(-1)) : "";
    return { from, to };
  }, [days]);

  const fetchRange = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Endpoint exemplu: /api/planner?from=YYYY-MM-DD&to=YYYY-MM-DD
      const res = await api(`/api/planner?from=${range.from}&to=${range.to}`).catch(() => null);

      // fallback demo (dacă nu e backendul încă)
      const demo = !res || !Array.isArray(res?.items);
      const items = demo
        ? [
            { id: "t1", date: range.from, title: "Invitații greenery – 80 buc", customer: "Cristina & Vlad", status: "IN_PROGRESS" },
            { id: "t2", date: isoDate(addDays(days[0], 1)), title: "Mărturii miere – 50 borcane", customer: "Ioana Pop", status: "PENDING" },
            { id: "t3", date: isoDate(addDays(days[0], 2)), title: "Lemn gravat – 12 plăcuțe", customer: "Andrei M.", status: "PENDING" },
            { id: "t4", date: isoDate(addDays(days[0], 2)), title: "Buchet nașă – mockup", customer: "Studio Floris", status: "DONE" },
            { id: "t5", date: isoDate(addDays(days[0], 6)), title: "Invitații acuarelă – 120 buc", customer: "Sara & Mihai", status: "IN_PROGRESS" },
          ]
        : res.items;

      setTasks(items);
    } catch (e) {
      setError(e?.message || "Eroare la încărcare");
    } finally {
      setLoading(false);
    }
  }, [range, days]);

  useEffect(() => { fetchRange(); }, [fetchRange]);

  function shiftWeeks(delta) {
    setBase((b) => addDays(b, delta * (weeks * 7)));
  }

  const tasksByDay = useMemo(() => {
    const map = new Map(days.map((d) => [isoDate(d), []]));
    for (const t of tasks) {
      if (!t.date) continue;
      const k = t.date.slice(0, 10);
      if (!map.has(k)) continue; // în range
      if (filter !== "ALL" && t.status !== filter) continue;
      map.get(k).push(t);
    }
    return map;
  }, [days, tasks, filter]);

  async function markDone(task) {
    try {
      // await api(`/api/planner/${task.id}`, { method: "PATCH", body: JSON.stringify({ status: "DONE" }) });
      setTasks((prev) => prev.map((x) => (x.id === task.id ? { ...x, status: "DONE" } : x)));
    } catch {/* ignore */}
  }

  function addQuick(day) {
    const title = prompt("Titlu sarcină (ex: Invitații x buc):");
    if (!title) return;
    const newTask = {
      id: "tmp_" + Math.random().toString(36).slice(2),
      date: isoDate(day),
      title,
      customer: "Client",
      status: "PENDING",
    };
    setTasks((prev) => [newTask, ...prev]);
    // TODO: persistență reală
    // api("/api/planner", { method: "POST", body: JSON.stringify(newTask) });
  }

  return (
    <div className={styles.page}>
      {/* top bar sticky (mobil) */}
      <div className={styles.topbar}>
        <button className={styles.iconBtn} onClick={() => shiftWeeks(-1)} aria-label="Săptămâna anterioară">
          <ChevronLeft size={18} />
        </button>

        <div className={styles.rangeTitle}>
          {fmtDay(days[0] || new Date())} — {fmtDay(days.at(-1) || new Date())}
        </div>

        <button className={styles.iconBtn} onClick={() => shiftWeeks(1)} aria-label="Săptămâna următoare">
          <ChevronRight size={18} />
        </button>
      </div>

      {/* bară filtre + refresh */}
      <div className={styles.controls}>
        <div className={styles.segment}>
          {["ALL", "PENDING", "IN_PROGRESS", "DONE"].map((key) => (
            <button
              key={key}
              type="button"
              className={`${styles.segBtn} ${filter === key ? styles.segActive : ""}`}
              onClick={() => setFilter(key)}
              title={key === "ALL" ? "Toate" : STATUS_META[key]?.label}
            >
              {key === "ALL" ? <Filter size={14}/> : STATUS_META[key]?.icon}{" "}
              <span className={styles.segLabel}>
                {key === "ALL" ? "Toate" : STATUS_META[key]?.label}
              </span>
            </button>
          ))}
        </div>

        <button className={styles.smallBtn} onClick={fetchRange} disabled={loading}>
          <RefreshCw size={14}/> Reîncarcă
        </button>
      </div>

      {error && <div className={styles.error}>{error}</div>}

      {/* timeline cu zile (orizontal scrollabil pe mobil) */}
      <div className={styles.scroller} role="list">
        {days.map((d) => {
          const k = isoDate(d);
          const list = tasksByDay.get(k) || [];
          const today = isoDate(new Date()) === k;

          return (
            <section key={k} className={styles.dayCol} role="listitem">
              <header className={`${styles.dayHead} ${today ? styles.today : ""}`}>
                <div className={styles.dayLabel}>{fmtDay(d)}</div>
                <button className={styles.addBtn} onClick={() => addQuick(d)} title="Adaugă sarcină">
                  <Plus size={16}/> Adaugă
                </button>
              </header>

              <div className={styles.cards}>
                {list.map((t) => (
                  <article key={t.id} className={styles.card}>
                    <div className={styles.cardTop}>
                      <span className={`${styles.status} ${STATUS_META[t.status]?.cls}`}>
                        {STATUS_META[t.status]?.icon}
                        {STATUS_META[t.status]?.label}
                      </span>
                    </div>

                    <h3 className={styles.title} title={t.title}>{t.title}</h3>
                    {t.customer && <div className={styles.customer}>👤 {t.customer}</div>}

                    <div className={styles.cardActions}>
                      {t.status !== "DONE" ? (
                        <button className={styles.primaryBtn} onClick={() => markDone(t)}>
                          <CheckCircle2 size={16}/> Marchează finalizat
                        </button>
                      ) : (
                        <span className={styles.doneNote}><CheckCircle2 size={16}/> Gata</span>
                      )}

                      <a className={styles.ghostBtn} href={`/magazine/comenzi?date=${k}`}>
                        Gestionează comenzi
                      </a>
                    </div>
                  </article>
                ))}

                {list.length === 0 && (
                  <div className={styles.empty}>
                    Nicio sarcină. <button className={styles.linkBtn} onClick={() => addQuick(d)}>Adaugă rapid</button>
                  </div>
                )}
              </div>
            </section>
          );
        })}
      </div>

      {/* bara jos (spațiu pentru bottom nav pe mobil) */}
      <div className={styles.bottomSpace} />
    </div>
  );
}
