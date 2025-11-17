// ./src/pages/Vendors/Visitors/VendorVisitorsPage.jsx
import React, { useEffect, useMemo, useState } from "react";
import { api } from "../../../lib/api";
import {
  Users,
  Eye,
  MousePointerClick,
  MessageSquare,
  TrendingUp,
  CalendarDays,
  RefreshCw,
  Download,
  ExternalLink,
  Globe,
  Search as SearchIcon,
  Clock,
} from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  AreaChart,
  Area,
  BarChart,
  Bar,
} from "recharts";
import styles from "./Visitors.module.css";

/* ========= Utils ========= */
function fmtNumber(n) {
  if (n == null) return "–";
  return n.toLocaleString("ro-RO");
}
function toISODate(d) {
  const pad = (x) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function addDays(d, delta) {
  const x = new Date(d);
  x.setDate(x.getDate() + delta);
  return x;
}
function daysBetween(a, b) {
  const a0 = new Date(a);
  const b0 = new Date(b);
  const ms = b0.setHours(0, 0, 0, 0) - a0.setHours(0, 0, 0, 0);
  return Math.round(ms / 86400000);
}

// CSV cu escaping corect
function downloadBlobCSV(filename, rows) {
  if (!rows || rows.length === 0) return;
  const escape = (v) => {
    const s = String(v ?? "");
    const needsQuote = /[",\n]/.test(s);
    const inner = s.replace(/"/g, '""');
    return needsQuote ? `"${inner}"` : inner;
  };
  const head = Object.keys(rows[0]).map(escape).join(",");
  const body = rows
    .map((r) => Object.values(r).map(escape).join(","))
    .join("\n");
  const csv = head + "\n" + body;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/* ========= Demo fallback (doar în dev) ========= */
function makeDemoSeries(from, to) {
  const days = daysBetween(new Date(from), new Date(to)) + 1;
  const start = new Date(from);
  const arr = [];
  let base = 100;
  for (let i = 0; i < days; i++) {
    const d = addDays(start, i);
    base += Math.round((Math.random() - 0.4) * 10);
    const visitors = Math.max(20, base + Math.round(Math.random() * 25));
    const views = Math.round(visitors * (1.3 + Math.random() * 0.6));
    const cta = Math.round(visitors * (0.06 + Math.random() * 0.03));
    const msgs = Math.round(cta * (0.25 + Math.random() * 0.15));
    arr.push({ date: toISODate(d), visitors, views, cta, messages: msgs });
  }
  return arr;
}

/* ========= Meta vendor (createdAt) ========= */
function useVendorMeta() {
  const [meta, setMeta] = useState({ createdAt: null, loading: true });

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const d = await api("/api/vendors/me/visitors/meta").catch(() => null);
        if (!alive) return;
        setMeta({ createdAt: d?.createdAt || null, loading: false });
      } catch {
        if (!alive) return;
        setMeta({ createdAt: null, loading: false });
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  return meta;
}

/* ========= Data hooks ========= */
function useVendorAnalytics(range) {
  const { from, to } = range;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [series, setSeries] = useState([]);
  const [kpi, setKpi] = useState({
    visitors: 0,
    views: 0,
    cta: 0,
    messages: 0,
    convRate: 0,
  });
  const [topPages, setTopPages] = useState([]);
  const [referrers, setReferrers] = useState([]);
  const [searches, setSearches] = useState([]);
  const [ctaPerf, setCtaPerf] = useState([]);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const qs = `?from=${encodeURIComponent(from)}&to=${encodeURIComponent(
          to
        )}`;
        const [s, k, p, r, q, c] = await Promise.all([
          api(`/api/vendors/me/visitors/series${qs}`).catch(() => null),
          api(`/api/vendors/me/visitors/kpi${qs}`).catch(() => null),
          api(`/api/vendors/me/visitors/top-pages${qs}`).catch(() => null),
          api(`/api/vendors/me/visitors/referrers${qs}`).catch(() => null),
          api(`/api/vendors/me/visitors/searches${qs}`).catch(() => null),
          api(`/api/vendors/me/visitors/cta-performance${qs}`).catch(
            () => null
          ),
        ]);
        if (!alive) return;

        const isProd = import.meta.env.PROD;

        // serie principală
        const demoSeries = makeDemoSeries(from, to);
        const sData = s?.items?.length
          ? s.items
          : isProd
          ? [] // în prod: fără demo
          : demoSeries;

        const totals = sData.reduce(
          (acc, d) => ({
            visitors: acc.visitors + (d.visitors || 0),
            views: acc.views + (d.views || 0),
            cta: acc.cta + (d.cta || 0),
            messages: acc.messages + (d.messages || 0),
          }),
          { visitors: 0, views: 0, cta: 0, messages: 0 }
        );
        const convRate = totals.cta ? totals.messages / totals.cta : 0;

        setSeries(sData);
        setKpi(k?.data || { ...totals, convRate });

        // top pages
        const demoPages = [
          { url: "/magazin/demo", title: "Profil magazin", views: 311, avgTime: 56 },
          { url: "/produs/1", title: "Pagină produs", views: 207, avgTime: 43 },
        ];
        setTopPages(p?.items || (isProd ? [] : demoPages));

        // referrers
        const demoRefs = [
          { source: "Google", sessions: 468, share: 52 },
          { source: "Facebook", sessions: 212, share: 24 },
          { source: "Direct", sessions: 156, share: 17 },
          { source: "Instagram", sessions: 64, share: 7 },
        ];
        setReferrers(r?.items || (isProd ? [] : demoRefs));

        // searches
        const demoSearches = [
          { query: "fotograf nuntă sector 3", hits: 32 },
          { query: "fum greu bucurești", hits: 21 },
          { query: "band live cluj", hits: 15 },
        ];
        setSearches(q?.items || (isProd ? [] : demoSearches));

        // CTA performance
        const demoCta = [
          { cta: "Solicită ofertă", clicks: 128, conv: 31 },
          { cta: "Trimite mesaj", clicks: 94, conv: 27 },
          { cta: "Vezi telefon", clicks: 211, conv: 18 },
        ];
        setCtaPerf(c?.items || (isProd ? [] : demoCta));
      } catch (e) {
        if (!alive) return;
        setError(e?.message || "Eroare la încărcare");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [from, to]);

  return { loading, error, series, kpi, topPages, referrers, searches, ctaPerf };
}

function useRealtime() {
  const [active, setActive] = useState(0);
  useEffect(() => {
    let alive = true;
    let id;
    const tick = async () => {
      try {
        const d = await api("/api/vendors/me/visitors/realtime").catch(
          () => null
        );
        if (!alive) return;
        setActive(
          d?.active ?? Math.max(0, Math.round(5 + Math.random() * 6 - 3))
        );
      } finally {
        id = setTimeout(tick, 15000);
      }
    };
    tick();
    return () => {
      alive = false;
      clearTimeout(id);
    };
  }, []);
  return active;
}

/* ========= UI pieces ========= */
function KPICard({ icon: IconProp, label, value, delta, spark }) {
  const Icon = IconProp || null;
  return (
    <div
      className={styles.card}
      style={{ display: "flex", gap: 12, alignItems: "center" }}
    >
      <div className={styles.iconBox}>{Icon && <Icon size={22} />}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className={styles.muted} style={{ fontSize: 12 }}>
          {label}
        </div>
        <div style={{ fontSize: 22, fontWeight: 700 }}>{fmtNumber(value)}</div>
        {typeof delta === "number" && (
          <div
            style={{
              fontSize: 12,
              marginTop: 4,
              color: delta >= 0 ? "#059669" : "#b91c1c",
            }}
          >
            <TrendingUp
              size={12}
              style={{ verticalAlign: "-2px", marginRight: 4 }}
            />
            {delta >= 0 ? "+" : ""}
            {delta.toFixed(1)}% față de perioada anterioară
          </div>
        )}
      </div>
      {spark && (
        <div style={{ width: 120, height: 44 }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={spark}
              margin={{ left: 0, right: 0, top: 6, bottom: 0 }}
            >
              <Area
                type="monotone"
                dataKey="v"
                strokeOpacity={0.8}
                fillOpacity={0.15}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

function Section({ title, icon: Icon, children }) {
  return (
    <section className={styles.section}>
      <header className={styles.sectionHead}>
        <h3 className={styles.sectionTitle}>
          {Icon && <Icon size={18} />} {title}
        </h3>
      </header>
      {children}
    </section>
  );
}

function DateRangePicker({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const presets = [
    { label: "Ultimele 7 zile", days: 6 },
    { label: "Ultimele 30 zile", days: 29 },
    { label: "Ultimele 90 zile", days: 89 },
  ];
  return (
    <div style={{ position: "relative" }}>
      <button className={styles.btnGhost} onClick={() => setOpen((v) => !v)}>
        <CalendarDays size={16} /> {value.from} – {value.to}
      </button>
      {open && (
        <div
          className={styles.card}
          style={{
            position: "absolute",
            right: 0,
            marginTop: 8,
            zIndex: 20,
            width: 320,
          }}
        >
          <div style={{ display: "grid", gap: 8 }}>
            {presets.map((p) => (
              <button
                key={p.label}
                className={styles.btnGhost}
                onClick={() => {
                  const to = new Date();
                  const from = addDays(to, -p.days);
                  onChange({ from: toISODate(from), to: toISODate(to) });
                  setOpen(false);
                }}
                style={{ textAlign: "left" }}
              >
                {p.label}
              </button>
            ))}
            <div style={{ display: "grid", gap: 6, marginTop: 6 }}>
              <div className={styles.muted} style={{ fontSize: 12 }}>
                Personalizat
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 6,
                }}
              >
                <input
                  type="date"
                  value={value.from}
                  onChange={(e) =>
                    onChange({ ...value, from: e.target.value })
                  }
                  className={styles.dateInput}
                />
                <input
                  type="date"
                  value={value.to}
                  onChange={(e) => onChange({ ...value, to: e.target.value })}
                  className={styles.dateInput}
                />
              </div>
              <button
                className={styles.btnPrimary}
                onClick={() => setOpen(false)}
              >
                Aplică
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ========= Page ========= */
export default function VendorVisitorsPage() {
  const today = useMemo(() => new Date(), []);
  const [range, setRange] = useState(() => ({
    from: toISODate(addDays(today, -29)),
    to: toISODate(today),
  }));

  const { createdAt } = useVendorMeta();

  // Ajustează `from` ca să nu fie mai vechi decât data creării vendorului
  useEffect(() => {
    if (!createdAt) return;
    const created = new Date(createdAt);

    setRange((prev) => {
      const toDate = new Date(prev.to || toISODate(today));
      const defaultFromDate = addDays(toDate, -29);

      // from = max(createdAt, to - 29 zile)
      const fromDate = created > defaultFromDate ? created : defaultFromDate;

      const newFrom = toISODate(fromDate);
      if (newFrom === prev.from) return prev;
      return { ...prev, from: newFrom };
    });
  }, [createdAt, today]);

  const { loading, error, series, kpi, topPages, referrers, searches, ctaPerf } =
    useVendorAnalytics(range);
  const activeNow = useRealtime();

  const spark = useMemo(
    () => series.map((d) => ({ v: d.visitors })),
    [series]
  );

  // (current - previous) / previous * 100
  const deltas = useMemo(() => {
    const len = series.length;
    if (len < 4) return { v: 0, vw: 0, c: 0, m: 0 };
    const half = Math.floor(len / 2);
    const firstHalf = series.slice(0, half); // previous
    const secondHalf = series.slice(half); // current
    const sum = (arr, k) => arr.reduce((a, b) => a + (b[k] || 0), 0);
    const pct = (prev, curr) => (prev ? ((curr - prev) / prev) * 100 : 0);

    return {
      v: pct(sum(firstHalf, "visitors"), sum(secondHalf, "visitors")),
      vw: pct(sum(firstHalf, "views"), sum(secondHalf, "views")),
      c: pct(sum(firstHalf, "cta"), sum(secondHalf, "cta")),
      m: pct(sum(firstHalf, "messages"), sum(secondHalf, "messages")),
    };
  }, [series]);

  const canExport = series?.length > 0;
  const exportCSV = () => {
    const rows = series.map((d) => ({
      data: d.date,
      vizitatori: d.visitors,
      afisari: d.views,
      click_cta: d.cta,
      mesaje: d.messages,
    }));
    downloadBlobCSV(`trafic_${range.from}_${range.to}.csv`, rows);
  };

  return (
    <div className={styles.container}>
      {/* Toolbar */}
      <div className={styles.toolbar}>
        <h2 className={styles.title}>
          <Users size={22} /> Vizitatori
        </h2>
        <div>
          <span
            className={styles.muted}
            title="Vizitatori activi acum"
            style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
          >
            <Clock size={16} /> {activeNow} activi acum
          </span>
          <DateRangePicker value={range} onChange={setRange} />
          <button
            className={styles.btnGhost}
            onClick={() => window.location.reload()}
            title="Reîncarcă"
          >
            <RefreshCw size={16} />
          </button>
          <button
            className={styles.btnGhost}
            onClick={exportCSV}
            disabled={!canExport}
            style={{ opacity: canExport ? 1 : 0.6 }}
          >
            <Download size={16} /> Export CSV
          </button>
        </div>
      </div>

      {/* KPI */}
      <div className={styles.kpiRow}>
        <KPICard
          icon={Users}
          label="Vizitatori"
          value={kpi.visitors}
          delta={deltas.v}
          spark={spark}
        />
        <KPICard
          icon={Eye}
          label="Afișări pagină"
          value={kpi.views}
          delta={deltas.vw}
        />
        <KPICard
          icon={MousePointerClick}
          label="Click-uri CTA"
          value={kpi.cta}
          delta={deltas.c}
        />
        <KPICard
          icon={MessageSquare}
          label="Mesaje primite"
          value={kpi.messages}
          delta={deltas.m}
        />
      </div>

      {/* Chart */}
      <Section title="Trafic zilnic & conversii" icon={TrendingUp}>
        <div className={styles.chartBox}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={series}
              margin={{ left: 12, right: 12, top: 12, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip
                formatter={(v, name) => [fmtNumber(v), labelMap[name] || name]}
              />
              <Line
                type="monotone"
                dataKey="visitors"
                strokeWidth={2}
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="views"
                strokeWidth={2}
                dot={false}
              />
              <Line type="monotone" dataKey="cta" strokeWidth={2} dot={false} />
              <Line
                type="monotone"
                dataKey="messages"
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Section>

      {/* Tables row 1 */}
      <div className={styles.grid2}>
        <Section title="Top pagini vizualizate" icon={ExternalLink}>
          <Table
            head={["Pagină", "Afișări", "Timp mediu (s)"]}
            rows={topPages.map((p) => [
              <a
                key={p.url}
                href={p.url}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                }}
                target="_blank"
                rel="noreferrer"
              >
                {p.title || p.url} <ExternalLink size={14} />
              </a>,
              fmtNumber(p.views),
              fmtNumber(p.avgTime),
            ])}
          />
        </Section>

        <Section title="Surse trafic" icon={Globe}>
          <Table
            head={["Sursă", "Sesiuni", "%"]}
            rows={referrers.map((r) => [
              r.source,
              fmtNumber(r.sessions),
              `${r.share}%`,
            ])}
          />
          <div style={{ width: "100%", height: 160, marginTop: 8 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={referrers}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="source" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip formatter={(v) => fmtNumber(v)} />
                <Bar dataKey="sessions" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Section>
      </div>

      {/* Tables row 2 */}
      <div className={styles.grid2}>
        <Section title="Căutări interne" icon={SearchIcon}>
          <Table
            head={["Interogare", "Câte rezultate / vizite"]}
            rows={searches.map((s) => [s.query, fmtNumber(s.hits)])}
          />
        </Section>

        <Section title="Performanță CTA" icon={MousePointerClick}>
          <Table
            head={["CTA", "Click-uri", "Conver. (mesaje)"]}
            rows={ctaPerf.map((c) => [
              c.cta,
              fmtNumber(c.clicks),
              fmtNumber(c.conv),
            ])}
          />
        </Section>
      </div>

      {error && (
        <div
          className={styles.card}
          style={{
            marginTop: 16,
            borderColor: "#fca5a5",
            background: "#fff1f2",
          }}
        >
          A apărut o problemă la încărcarea datelor.
        </div>
      )}

      {loading && (
        <div className={styles.card} style={{ marginTop: 16 }}>
          Se încarcă datele…
        </div>
      )}
    </div>
  );
}

/* ========= Helpers ========= */
const labelMap = {
  visitors: "Vizitatori",
  views: "Afișări",
  cta: "Click-uri CTA",
  messages: "Mesaje",
};

function Table({ head, rows }) {
  const hasRows = rows && rows.length > 0;
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            {head.map((h, i) => (
              <th key={i} className={styles.th}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {hasRows ? (
            rows.map((r, i) => (
              <tr key={i}>
                {r.map((c, j) => (
                  <td key={j} className={styles.td}>
                    {c}
                  </td>
                ))}
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={head.length} className={styles.td}>
                <span className={styles.muted}>
                  Încă nu există date pentru perioada selectată.
                </span>
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
