import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../../lib/api";
import { useAuth } from "../../Auth/Context/useAuth";
import {
  Search, Filter, Calendar, RefreshCw, Loader2,
  ChevronLeft, ChevronRight, ExternalLink, Download, PackageCheck
} from "lucide-react";
import styles from "./Orders.module.css";
import SubscriptionBanner from "../Onboarding/OnBoardingDetails/tabs/SubscriptionBanner/SubscriptionBanner"; // sau alt path

/* Utils */
function formatMoney(n) {
  const v = Number(n || 0);
  return new Intl.NumberFormat("ro-RO", { style: "currency", currency: "RON" }).format(v);
}
function formatDate(d) {
  try {
    const dt = new Date(d);
    return new Intl.DateTimeFormat("ro-RO", { dateStyle: "medium", timeStyle: "short" }).format(dt);
  } catch { return d || ""; }
}

const STATUS_OPTIONS = [
  { value: "", label: "Toate" },
  { value: "new", label: "Nouă" },
  { value: "preparing", label: "În pregătire" },
  { value: "confirmed", label: "Confirmată (gata de predare)" },
  { value: "fulfilled", label: "Finalizată" },
  { value: "cancelled", label: "Anulată" },
];

export default function VendorOrdersPage() {
  const { me } = useAuth();
  const isVendor = me?.role === "VENDOR";

  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [from, setFrom] = useState(""); // yyyy-mm-dd
  const [to, setTo] = useState("");     // yyyy-mm-dd
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [data, setData] = useState({ items: [], total: 0 });

  const [courierOrder, setCourierOrder] = useState(null); // pt modal

  const totalPages = Math.max(1, Math.ceil((data?.total || 0) / pageSize));
  const query = useMemo(() => ({ q, status, from, to, page, pageSize }), [q, status, from, to, page, pageSize]);

  useEffect(() => {
    let alive = true;
    async function run() {
      if (!isVendor) return;
      setLoading(true);
      setErr("");
      try {
        // GET /api/vendor/orders?q=&status=&from=&to=&page=1&pageSize=20
        const res = await api(`/api/vendor/orders?${new URLSearchParams(
          Object.fromEntries(Object.entries(query).filter(([, v]) => v !== "" && v != null))
        ).toString()}`);
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
    return () => { alive = false; };
  }, [query, isVendor]);

  if (!isVendor) {
    return (
      <main className={styles.page}>
        <div className={styles.card}>
          <h1 className={styles.h1}>Comenzile mele</h1>
          <p className={styles.muted}>Această pagină este disponibilă doar pentru conturile de tip vânzător.</p>
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

  return (
    <main className={styles.page}>
      <SubscriptionBanner />  {/* 👈 doar o linie în plus */}
      <div className={styles.headerRow}>
        <h1 className={styles.h1}>Comenzile mele</h1>
        <div className={styles.headerActions}>
          <button
            className={styles.secondaryBtn}
            onClick={() => {
              const rows = [
                ["ID", "Data", "Client", "Telefon", "Email", "Status", "Total", "AWB", "Pickup", "Slot"],
                ...data.items.map(o => [
                  o.id,
                  formatDate(o.createdAt),
                  o.customerName || "",
                  o.customerPhone || "",
                  o.customerEmail || "",
                  o.status || "",
                  String(o.total || 0).replace(".", ","),
                  o.awb || "",
                  o.pickupDate ? new Date(o.pickupDate).toISOString().slice(0,10) : "",
                  (o.pickupSlotStart && o.pickupSlotEnd)
                    ? `${new Date(o.pickupSlotStart).toLocaleTimeString("ro-RO",{hour:"2-digit",minute:"2-digit"})}-${new Date(o.pickupSlotEnd).toLocaleTimeString("ro-RO",{hour:"2-digit",minute:"2-digit"})}`
                    : "",
                ]),
              ];
              const csv = rows.map(r => r.map(x => `"${String(x ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
              const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = `comenzi-${new Date().toISOString().slice(0,10)}.csv`;
              a.click();
              URL.revokeObjectURL(url);
            }}
            title="Export CSV"
          >
            <Download size={16} /> Export
          </button>
          <button
            className={styles.secondaryBtn}
            onClick={() => { setPage(1); setQ(""); setStatus(""); setFrom(""); setTo(""); }}
            title="Resetează filtre"
          >
            <RefreshCw size={16} /> Reset
          </button>
        </div>
      </div>

      {/* Filtre */}
      <div className={styles.filters}>
        <div className={styles.inputWrap}>
          <Search size={16} className={styles.inputIcon} />
          <input
            value={q}
            onChange={(e) => { setPage(1); setQ(e.target.value); }}
            placeholder="Caută după nume client, telefon, ID…"
            className={styles.input}
            aria-label="Căutare în comenzi"
          />
        </div>

        <div className={styles.selectWrap}>
          <Filter size={16} />
          <select
            value={status}
            onChange={(e) => { setPage(1); setStatus(e.target.value); }}
            className={styles.select}
            aria-label="Filtru status"
          >
            {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>

        <div className={styles.dateWrap}>
          <Calendar size={16} />
          <input
            type="date"
            value={from}
            onChange={(e) => { setPage(1); setFrom(e.target.value); }}
            className={styles.input}
            aria-label="De la data"
          />
        </div>
        <div className={styles.dateWrap}>
          <Calendar size={16} />
          <input
            type="date"
            value={to}
            onChange={(e) => { setPage(1); setTo(e.target.value); }}
            className={styles.input}
            aria-label="Până la data"
          />
        </div>
      </div>

      {/* Listă / tabel */}
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
              {loading && Array.from({ length: 6 }).map((_, i) => (
                <tr key={`sk-${i}`} className={styles.skeletonRow}>
                  <td colSpan={7}><Loader2 className={styles.spin} size={16} /> Se încarcă…</td>
                </tr>
              ))}

              {!loading && data.items.length === 0 && (
                <tr>
                  <td colSpan={7} className={styles.emptyCell}>
                    Nu există comenzi pentru filtrele curente.
                  </td>
                </tr>
              )}

              {!loading && data.items.map((o) => (
                <tr key={o.id}>
                  <td><code>{o.shortId || o.id}</code></td>
                  <td>{formatDate(o.createdAt)}</td>
                  <td>
                    <div className={styles.clientCol}>
                      <div className={styles.clientName}>{o.customerName || "—"}</div>
                      <div className={styles.clientNote}>{o.eventName || o.address?.city || ""}</div>
                      {(o.awb || o.pickupDate) && (
                        <div className={styles.inlineChips}>
                          {o.awb && <span className={`${styles.badge} ${styles.badgeConfirmed}`}>AWB {o.awb}</span>}
                          {o.pickupDate && (
                            <span className={styles.badge}>
                              Ridicare {new Date(o.pickupDate).toLocaleDateString("ro-RO", { weekday:"short", day:"2-digit", month:"short" })}{" "}
                              {(o.pickupSlotStart && o.pickupSlotEnd) ? (
                                <>
                                  {new Date(o.pickupSlotStart).toLocaleTimeString("ro-RO",{hour:"2-digit",minute:"2-digit"})}
                                  {"–"}
                                  {new Date(o.pickupSlotEnd).toLocaleTimeString("ro-RO",{hour:"2-digit",minute:"2-digit"})}
                                </>
                              ) : null}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </td>
                  <td className={styles.hideSm}>
                    <div className={styles.clientContact}>
                      {o.customerPhone && <a href={`tel:${o.customerPhone}`}>{o.customerPhone}</a>}
                      {o.customerEmail && <a href={`mailto:${o.customerEmail}`}>{o.customerEmail}</a>}
                    </div>
                  </td>
                  <td>
                    <span className={`${styles.badge} ${
                      o.status === "new" ? styles.badgeNew :
                      o.status === "preparing" ? styles.badgeWarning :
                      o.status === "confirmed" ? styles.badgeConfirmed :
                      o.status === "fulfilled" ? styles.badgeFulfilled :
                      o.status === "cancelled" ? styles.badgeCancelled : ""
                    }`}>
                      {STATUS_OPTIONS.find(s => s.value === o.status)?.label || (o.status || "—")}
                    </span>
                  </td>
                  <td>{formatMoney(o.total)}</td>
                  <td className={styles.actionsCell}>
                    <Link className={styles.linkBtn} to={`/vendor/orders/${o.id}`} title="Deschide detalii">
                      <ExternalLink size={16} /> Detalii
                    </Link>

                    {o.status === "new" && (
                      <button
                        className={styles.secondaryBtn}
                        onClick={async () => {
                          try {
                            await api(`/api/vendor/orders/${o.id}/status`, {
                              method: "PATCH",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ status: "preparing" }),
                            });
                            setData(prev => ({ ...prev, items: prev.items.map(x => x.id===o.id ? { ...x, status:"preparing" } : x) }));
                          } catch { alert("Nu am putut marca 'În pregătire'."); }
                        }}
                      >
                        În pregătire
                      </button>
                    )}

                    {(o.status === "preparing" || o.status === "confirmed") && (
                      <button
                        className={styles.primaryBtn}
                        onClick={() => openCourierModal(o)}
                        title="Confirmă & programează curier"
                      >
                        <PackageCheck size={16} /> Confirmă & curier
                      </button>
                    )}

                    {o.status === "confirmed" && (
                      <button
                        className={styles.secondaryBtn}
                        onClick={async () => {
                          try {
                            await api(`/api/vendor/orders/${o.id}/status`, {
                              method: "PATCH",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ status: "fulfilled" }),
                            });
                            setData(prev => ({ ...prev, items: prev.items.map(x => x.id===o.id ? { ...x, status:"fulfilled" } : x) }));
                          } catch {
                            alert("Nu am putut marca comanda ca finalizată.");
                          }
                        }}
                      >
                        Marchează finalizată
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Paginare */}
        {data.total > pageSize && (
          <div className={styles.pagination}>
            <button
              className={styles.secondaryBtn}
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page <= 1}
            >
              <ChevronLeft size={16} /> Anterioare
            </button>
            <span className={styles.pageInfo}>
              Pagina {page} / {totalPages} &middot; {data.total} rezultate
            </span>
            <button
              className={styles.secondaryBtn}
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
            >
              Următoare <ChevronRight size={16} />
            </button>
          </div>
        )}
      </div>

      {err && <p className={styles.muted} style={{ marginTop: 8 }}>{err}</p>}

      {courierOrder && (
        <CourierModal
          order={courierOrder}
          onClose={closeCourierModal}
          onDone={async () => {
            // refresh soft: doar elementul curent
            try {
              const res = await api(`/api/vendor/orders?${new URLSearchParams({ q: courierOrder.id, page: 1, pageSize: 1 })}`);
              const fresh = res?.items?.[0];
              setData(prev => ({
                ...prev,
                items: prev.items.map(x => x.id === courierOrder.id ? { ...x, ...fresh } : x)
              }));
            } catch { /* ignore */ }
          }}
        />
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
  const [dimensions, setDimensions] = useState({ parcels: 1, weightKg: 1, l: 30, w: 20, h: 10 });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  async function handleSubmit() {
    setSaving(true);
    setErr("");
    try {
      await api(`/api/vendor/shipments/${order.shipmentId}/schedule-pickup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ consents, pickup, dimensions }),
      });
      await api(`/api/vendor/orders/${order.id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "confirmed" }),
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
          <button className={styles.iconBtn} onClick={onClose} aria-label="Închide">×</button>
        </div>

        <fieldset className={styles.fieldset}>
          <legend>Acorduri curier</legend>
          <Check
            label="Sunt de acord să transmiteți către curier datele clientului și ale expediției (GDPR)."
            checked={consents.gdprProcessing}
            onChange={v => setConsents(s => ({ ...s, gdprProcessing: v }))}
          />
          <Check
            label="Confirm că marfa este ambalată corespunzător conform ghidului curierului."
            checked={consents.properPackaging}
            onChange={v => setConsents(s => ({ ...s, properPackaging: v }))}
          />
          <Check
            label="Conține obiecte fragile (curierul va nota 'fragil')."
            checked={consents.fragile}
            onChange={v => setConsents(s => ({ ...s, fragile: v }))}
          />
          <Check
            label="Accept valoarea declarată și condițiile de răspundere ale curierului."
            checked={consents.declaredValue}
            onChange={v => setConsents(s => ({ ...s, declaredValue: v }))}
          />
          <Check
            label="Accept politica de retur pentru colete nelivrate/refuzate."
            checked={consents.returnPolicyAck}
            onChange={v => setConsents(s => ({ ...s, returnPolicyAck: v }))}
          />
          <Check
            label="Accept ca șoferul să mă contacteze telefonic la preluare."
            checked={consents.canCallDriver}
            onChange={v => setConsents(s => ({ ...s, canCallDriver: v }))}
          />
        </fieldset>

        <fieldset className={styles.fieldset}>
          <legend>Programare curier</legend>
          <div className={styles.row}>
            <label className={styles.radio}><input type="radio" name="day" value="today" checked={pickup.day==="today"} onChange={e=>setPickup(v=>({...v, day:e.target.value}))}/> Azi</label>
            <label className={styles.radio}><input type="radio" name="day" value="tomorrow" checked={pickup.day==="tomorrow"} onChange={e=>setPickup(v=>({...v, day:e.target.value}))}/> Mâine</label>
          </div>
          <select className={styles.select} value={pickup.slot} onChange={e=>setPickup(v=>({...v, slot:e.target.value}))}>
            <option value="10-14">10:00–14:00</option>
            <option value="14-18">14:00–18:00</option>
            <option value="18-21">18:00–21:00</option>
          </select>
        </fieldset>

        <fieldset className={styles.fieldset}>
          <legend>Detalii colet</legend>
          <div className={styles.grid3}>
            <label>Număr colete <input type="number" min={1} value={dimensions.parcels} onChange={e=>setDimensions(v=>({...v, parcels:+e.target.value}))}/></label>
            <label>Greutate (kg) <input type="number" step="0.1" min={0.1} value={dimensions.weightKg} onChange={e=>setDimensions(v=>({...v, weightKg:+e.target.value}))}/></label>
            <label>Dimensiuni (cm) <input type="text" value={`${dimensions.l}x${dimensions.w}x${dimensions.h}`} onChange={e=>{
              const [l,w,h] = e.target.value.split("x").map(n=>Number(n)||0);
              setDimensions(v=>({...v, l,w,h}));
            }}/></label>
          </div>
        </fieldset>

        {err && <p className={styles.error}>{err}</p>}

        <div className={styles.modalActions}>
          <button className={styles.secondaryBtn} onClick={onClose} disabled={saving}>Anulează</button>
          <button className={styles.primaryBtn} onClick={handleSubmit} disabled={saving}>
            {saving ? <Loader2 className={styles.spin} size={16}/> : <PackageCheck size={16}/>} Programează curierul
          </button>
        </div>
        <p className={styles.muted}>După programare, vei vedea AWB-ul și mesajul „Un curier ajunge {pickup.day==="today"?"azi":"mâine"} în intervalul selectat”.</p>
      </div>
    </div>
  );
}

function Check({ label, checked, onChange }) {
  return (
    <label className={styles.check}>
      <input type="checkbox" checked={checked} onChange={e=>onChange(e.target.checked)} /> {label}
    </label>
  );
}
