import { useCallback, useEffect, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { api } from "../../../lib/api";
import { ArrowLeft, Loader2, ExternalLink, FileDown, Phone, Mail, MapPin } from "lucide-react";
import styles from "./Orders.module.css";

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

export default function OrderDetailsPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setErr("");
    try {
      const res = await api(`/api/vendor/orders/${id}`);
      setOrder(res);
    } catch (e) {
      setErr(e?.message || "Nu am putut încărca comanda.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return <div className={styles.page}><div className={styles.card}><Loader2 className={styles.spin} /> Se încarcă…</div></div>;
  }
  if (err) {
    return <div className={styles.page}><div className={styles.card}><p className={styles.error}>{err}</p></div></div>;
  }
  if (!order) return null;

  const ship = order.shipment || {};
  const addr = order.shippingAddress || {};
  const items = order.items || [];

  return (
    <main className={styles.page}>
      <div className={styles.headerRow}>
        <button className={styles.secondaryBtn} onClick={() => nav(-1)}><ArrowLeft size={16}/> Înapoi</button>
        <h1 className={styles.h1}>Comanda <code>{order.shortId || order.id}</code></h1>
        <div className={styles.headerActions}>
          {ship.labelUrl && (
            <a className={styles.secondaryBtn} href={`/api/vendor/shipments/${ship.id}/label`} target="_blank" rel="noreferrer">
              <FileDown size={16}/> Etichetă AWB
            </a>
          )}
          {ship.trackingUrl && (
            <a className={styles.linkBtn} href={ship.trackingUrl} target="_blank" rel="noreferrer">
              <ExternalLink size={16}/> Urmărește colet
            </a>
          )}
        </div>
      </div>

      <div className={styles.grid2}>
        <section className={styles.card}>
          <h3>Client</h3>
          <div className={styles.kv}><span>Nume</span><strong>{addr.name || "—"}</strong></div>
          <div className={styles.kv}><span><Phone size={14}/></span><a href={`tel:${addr.phone || ""}`}>{addr.phone || "—"}</a></div>
          <div className={styles.kv}><span><Mail size={14}/></span><a href={`mailto:${addr.email || ""}`}>{addr.email || "—"}</a></div>
          <div className={styles.kv}><span><MapPin size={14}/></span><div>
            {addr.street && <div>{addr.street}</div>}
            <div>{addr.city} {addr.postalCode && `(${addr.postalCode})`}</div>
            <div>{addr.county}</div>
          </div></div>
          <div className={styles.kv}><span>Creată</span><div>{formatDate(order.createdAt)}</div></div>
          <div className={styles.kv}><span>Status</span><div><span className={styles.badge}>{order.statusLabel || order.status}</span></div></div>
        </section>

        <section className={styles.card}>
          <h3>Transport</h3>
          <div className={styles.kv}><span>Curier</span><div>{ship.courierProvider || "—"}</div></div>
          <div className={styles.kv}><span>AWB</span><div>{ship.awb || "—"}</div></div>
          <div className={styles.kv}><span>Ridicare</span><div>
            {ship.pickupDate ? new Date(ship.pickupDate).toLocaleDateString("ro-RO", { weekday:"long", day:"2-digit", month:"long" }) : "—"}
            {(ship.pickupSlotStart && ship.pickupSlotEnd) && (
              <> · {new Date(ship.pickupSlotStart).toLocaleTimeString("ro-RO",{hour:"2-digit",minute:"2-digit"})}–{new Date(ship.pickupSlotEnd).toLocaleTimeString("ro-RO",{hour:"2-digit",minute:"2-digit"})}</>
            )}
          </div></div>
          <div className={styles.kv}><span>Dimensiuni</span><div>
            {ship.parcels ? `${ship.parcels} col.` : "—"}{ship.weightKg ? ` · ${ship.weightKg} kg` : ""}{(ship.lengthCm && ship.widthCm && ship.heightCm) ? ` · ${ship.lengthCm}x${ship.widthCm}x${ship.heightCm} cm` : ""}
          </div></div>
        </section>
      </div>

      <section className={styles.card}>
        <h3>Produse</h3>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Produs</th>
                <th>Cant.</th>
                <th>Preț unitar</th>
                <th>Total linie</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.id}>
                  <td>{it.title}</td>
                  <td>{it.qty}</td>
                  <td>{formatMoney(it.price)}</td>
                  <td>{formatMoney(Number(it.price) * Number(it.qty))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className={styles.totalBar}>
          <div>Subtotal: <strong>{formatMoney(order.subtotal)}</strong></div>
          <div>Transport: <strong>{formatMoney(order.shippingTotal)}</strong></div>
          <div>Total: <strong>{formatMoney(order.total)}</strong></div>
        </div>
      </section>

      <section className={styles.card}>
        <h3>Jurnal & Consimțăminte</h3>
        <pre className={styles.pre}>{JSON.stringify(ship.consents || {}, null, 2)}</pre>
      </section>

      <div className={styles.footerActions}>
        <Link className={styles.secondaryBtn} to="/vendor/orders"><ArrowLeft size={16}/> Înapoi la listă</Link>
      </div>
    </main>
  );
}
