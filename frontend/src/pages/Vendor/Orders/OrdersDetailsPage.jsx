// frontend/src/pages/vendor/OrderDetailsPage.jsx
import { useCallback, useEffect, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { api } from "../../../lib/api";
import {
  ArrowLeft,
  Loader2,
  ExternalLink,
  FileDown,
  Phone,
  Mail,
  MapPin,
  FileText,
  MessageSquare,
  PackageCheck,
  Send,
} from "lucide-react";
import styles from "./Orders.module.css";

const COURIER_ENABLED = false;
const INVOICE_ENABLED = false;

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

/* 🔹 motive anulare – la fel ca în lista de comenzi */
const CANCEL_REASONS = [
  { value: "client_no_answer", label: "Clientul nu răspunde la telefon" },
  { value: "client_request", label: "Clientul a solicitat anularea" },
  { value: "stock_issue", label: "Produs indisponibil / stoc epuizat" },
  { value: "address_issue", label: "Adresă incompletă / imposibil de livrat" },
  { value: "payment_issue", label: "Probleme cu plata" },
  { value: "other", label: "Alt motiv" },
];

export default function OrderDetailsPage() {
  const { id } = useParams();
  const nav = useNavigate();

  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  // 🔹 facturare vendor
  const [billingReady, setBillingReady] = useState(false);
  const [billingLoading, setBillingLoading] = useState(true);
  const [billingError, setBillingError] = useState("");

  // 🔹 modale
  const [courierOrder, setCourierOrder] = useState(null);
  const [invoiceOrder, setInvoiceOrder] = useState(null);
  const [invoiceLoadingId, setInvoiceLoadingId] = useState(null);
  const [cancelOrder, setCancelOrder] = useState(null);

  // 🔹 mesaje
  const [startingMessage, setStartingMessage] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      const res = await api(`/api/vendor/orders/${id}`);
      setOrder(res);
    } catch (e) {
      setErr(e?.message || "Nu am putut încărca comanda.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  // 🔹 Load billing vendor – minimul necesar ca să poți genera facturi
  useEffect(() => {
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
  }, []);

  if (loading) {
    return (
      <div className={styles.page}>
        <div className={styles.card}>
          <Loader2 className={styles.spin} /> Se încarcă…
        </div>
      </div>
    );
  }

  if (err) {
    return (
      <div className={styles.page}>
        <div className={styles.card}>
          <p className={styles.error}>{err}</p>
        </div>
      </div>
    );
  }

  if (!order) return null;

  const ship = order.shipment || {};
  const addr = order.shippingAddress || {};
  const items = order.items || [];
  const priceBreakdown = order.priceBreakdown || null;
  const vf = order.vendorFinancials || priceBreakdown?.vendorFinancials || null;

  const isCompany =
    order.customerType === "PJ" ||
    (!order.customerType && (addr.companyName || addr.companyCui));

  const primaryThread =
    (order.messageThreads && order.messageThreads[0]) || null;

  /* ===== Handlere acțiuni ===== */

  function openCourierModal() {
    if (!COURIER_ENABLED) return;
    setCourierOrder({
      id: order.id,
      shipmentId: ship.id,
    });
  }

  function openInvoiceModal() {
    if (!INVOICE_ENABLED) return;

    if (!billingReady) {
      alert(
        "Pentru a genera facturi, te rugăm să completezi și să salvezi mai întâi datele de facturare."
      );
      return;
    }
    setInvoiceOrder(order);
  }

  async function handleInvoiceSaved() {
    setInvoiceLoadingId(order.id);
    try {
      await load();
    } catch {
      /* ignore */
    } finally {
      setInvoiceLoadingId(null);
    }
  }

  async function handleContactClient() {
    try {
      setStartingMessage(true);

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

      nav(`/mesaje?threadId=${res.threadId}`);
    } catch (e) {
      console.error("Eroare la pornirea conversației", e);
      alert("Nu am putut porni conversația cu clientul. Încearcă din nou.");
    } finally {
      setStartingMessage(false);
    }
  }

  return (
    <main className={styles.page}>
      {/* header */}
      <div className={styles.headerRow}>
        <button className={styles.secondaryBtn} onClick={() => nav(-1)}>
          <ArrowLeft size={16} /> Înapoi
        </button>

        <h1 className={styles.h1}>
          Comanda <code>{order.orderNumber || order.shortId || order.id}</code>
        </h1>

        <div className={styles.headerActions}>
          {/* Mesaje client */}
          <button
            className={styles.secondaryBtn}
            type="button"
            onClick={handleContactClient}
            disabled={startingMessage}
            title="Deschide conversația cu clientul"
          >
            {startingMessage ? (
              <>
                <Loader2 size={16} className={styles.spin} /> Deschide…
              </>
            ) : (
              <>
                <MessageSquare size={16} /> Mesaje
              </>
            )}
          </button>

          {/* Curier temporar indisponibil */}
          {(order.status === "preparing" || order.status === "confirmed") && (
            <button
              className={styles.primaryBtn}
              type="button"
              onClick={openCourierModal}
              disabled={!COURIER_ENABLED}
              title="Funcționalitate temporar indisponibilă"
            >
              <PackageCheck size={16} /> Curier
            </button>
          )}

          {/* Factură temporar indisponibilă */}
          {order.status !== "cancelled" && (
            <button
              className={styles.secondaryBtn}
              type="button"
              onClick={openInvoiceModal}
              disabled={true}
              title="Funcționalitate temporar indisponibilă"
            >
              {invoiceLoadingId ? (
                <>
                  <Loader2 size={16} className={styles.spin} /> Factură…
                </>
              ) : (
                <>
                  <FileText size={16} />{" "}
                  {order.invoiceNumber ? "Vezi factura" : "Factură"}
                </>
              )}
            </button>
          )}

          {/* Anulare comandă (new / preparing / confirmed) */}
          {["new", "preparing", "confirmed"].includes(order.status) && (
            <button
              className={styles.secondaryBtn}
              type="button"
              onClick={() => setCancelOrder(order)}
              title="Anulează comanda"
            >
              Anulează
            </button>
          )}

          {/* AWB & tracking existente */}
          {ship.labelUrl && (
            <a
              className={styles.secondaryBtn}
              href={`/api/vendor/shipments/${ship.id}/label`}
              target="_blank"
              rel="noreferrer"
            >
              <FileDown size={16} /> Etichetă AWB
            </a>
          )}
          {ship.trackingUrl && (
            <a
              className={styles.linkBtn}
              href={ship.trackingUrl}
              target="_blank"
              rel="noreferrer"
            >
              <ExternalLink size={16} /> Urmărește colet
            </a>
          )}
        </div>
      </div>

      <div className={styles.grid2}>
        {/* Client + facturare */}
        <section className={styles.card}>
          <h3>Client</h3>

          <div className={styles.kv}>
            <span>Nume</span>
            <strong>{addr.name || "—"}</strong>
          </div>

          <div className={styles.kv}>
            <span>
              <Phone size={14} />
            </span>
            {addr.phone ? (
              <a href={`tel:${addr.phone}`}>{addr.phone}</a>
            ) : (
              "—"
            )}
          </div>

          <div className={styles.kv}>
            <span>
              <Mail size={14} />
            </span>
            {addr.email ? (
              <a href={`mailto:${addr.email}`}>{addr.email}</a>
            ) : (
              "—"
            )}
          </div>

          <div className={styles.kv}>
            <span>
              <MapPin size={14} />
            </span>
            <div>
              {addr.street && <div>{addr.street}</div>}
              <div>
                {addr.city} {addr.postalCode && `(${addr.postalCode})`}
              </div>
              {addr.county && <div>{addr.county}</div>}
            </div>
          </div>

          <div className={styles.kv}>
            <span>Creată</span>
            <div>{formatDate(order.createdAt)}</div>
          </div>

          <div className={styles.kv}>
            <span>Status</span>
            <div>
              <span className={styles.badge}>
                {order.statusLabel || order.status}
              </span>
            </div>
          </div>

          {primaryThread && primaryThread.internalNote && (
            <div className={styles.kv}>
              <span>
                <FileText size={14} />
              </span>
              <div className={styles.internalNoteBox}>
                <div className={styles.internalNoteLabel}>Notă internă lead</div>
                <div>{primaryThread.internalNote}</div>
              </div>
            </div>
          )}

          {isCompany && (
            <>
              <div
                style={{
                  marginTop: 12,
                  marginBottom: 4,
                  fontWeight: 600,
                }}
              >
                Facturare pe firmă
              </div>

              <div className={styles.kv}>
                <span>Denumire firmă</span>
                <strong>{addr.companyName || "—"}</strong>
              </div>

              <div className={styles.kv}>
                <span>CUI</span>
                <strong>{addr.companyCui || "—"}</strong>
              </div>

              {addr.companyRegCom && (
                <div className={styles.kv}>
                  <span>Nr. Reg. Comerțului</span>
                  <strong>{addr.companyRegCom}</strong>
                </div>
              )}
            </>
          )}

          {billingError && !billingLoading && (
            <p className={styles.muted} style={{ marginTop: 8 }}>
              {billingError}
            </p>
          )}
        </section>

        {/* Transport */}
        <section className={styles.card}>
          <h3>Transport</h3>

          <div className={styles.kv}>
            <span>Curier</span>
            <div>{ship.courierProvider || "—"}</div>
          </div>

          <div className={styles.kv}>
            <span>AWB</span>
            <div>{ship.awb || "—"}</div>
          </div>

          <div className={styles.kv}>
            <span>Ridicare</span>
            <div>
              {ship.pickupDate
                ? new Date(ship.pickupDate).toLocaleDateString("ro-RO", {
                    weekday: "long",
                    day: "2-digit",
                    month: "long",
                  })
                : "—"}
              {ship.pickupSlotStart && ship.pickupSlotEnd && (
                <>
                  {" "}
                  ·{" "}
                  {new Date(ship.pickupSlotStart).toLocaleTimeString("ro-RO", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                  –
                  {new Date(ship.pickupSlotEnd).toLocaleTimeString("ro-RO", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </>
              )}
            </div>
          </div>

          <div className={styles.kv}>
            <span>Dimensiuni</span>
            <div>
              {ship.parcels ? `${ship.parcels} col.` : "—"}
              {ship.weightKg ? ` · ${ship.weightKg} kg` : ""}
              {ship.lengthCm && ship.widthCm && ship.heightCm
                ? ` · ${ship.lengthCm}x${ship.widthCm}x${ship.heightCm} cm`
                : ""}
            </div>
          </div>
        </section>
      </div>

      {/* Produse */}
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
          <div>
            Produsele tale: <strong>{formatMoney(order.subtotal)}</strong>
            {priceBreakdown?.items && (
              <div className={styles.muted}>
                {formatMoney(priceBreakdown.items.net)} fără TVA +{" "}
                {formatMoney(priceBreakdown.items.vat)} TVA
              </div>
            )}
          </div>

          {vf && (
            <>
              <div>
                Bază comision (produse fără TVA):{" "}
                <strong>{formatMoney(vf.itemsNet)}</strong>
                <div className={styles.muted}>Comisionul se aplică pe NET</div>
              </div>

              <div>
                Comision produse: <strong>{formatMoney(vf.commissionNet)}</strong>
                <div className={styles.muted}>
                  {((vf.commissionBps || 0) / 100).toFixed(2)}%
                </div>
              </div>

              <div>
                Îți rămâne (din produse):{" "}
                <strong>{formatMoney(vf.vendorNetBeforeShipping)}</strong>
                <div className={styles.muted}>Produse fără TVA − comision</div>
              </div>
            </>
          )}
        </div>

        <div className={styles.totalBar} style={{ marginTop: 10 }}>
          <div>
            Transport: <strong>{formatMoney(order.shippingTotal)}</strong>
          </div>
          <div>
            Total comandă: <strong>{formatMoney(order.total)}</strong>
          </div>
        </div>
      </section>

      {/* Info lead din inbox */}
      <section className={styles.card}>
        <h3>Note interne &amp; follow-up</h3>

        {!primaryThread && (
          <div className={styles.info}>
            Nu există note interne pentru această comandă.
          </div>
        )}

        {primaryThread && (
          <>
            <div className={styles.kv}>
              <span>
                <FileText size={14} />
              </span>
              <div className={styles.internalNoteBox}>
                <div className={styles.internalNoteLabel}>
                  Notă internă lead
                </div>
                <div>
                  {primaryThread.internalNote || "Fără notă internă."}
                </div>
              </div>
            </div>

            <div className={styles.kv}>
              <span>Status lead</span>
              <div>
                <span className={styles.badge}>
                  {primaryThread.leadStatus || "NECUNOSCUT"}
                </span>
              </div>
            </div>

            {primaryThread.followUpAt && (
              <div className={styles.kv}>
                <span>Follow-up</span>
                <div>
                  {new Date(primaryThread.followUpAt).toLocaleString("ro-RO", {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </div>
              </div>
            )}
          </>
        )}
      </section>

      <div className={styles.footerActions}>
        <Link className={styles.secondaryBtn} to="/vendor/orders">
          <ArrowLeft size={16} /> Înapoi la listă
        </Link>
      </div>

      {/* ===== Modale ===== */}

      {courierOrder && COURIER_ENABLED && (
        <CourierModal
          order={courierOrder}
          onClose={() => setCourierOrder(null)}
          onDone={async () => {
            await load();
          }}
        />
      )}

      {invoiceOrder && INVOICE_ENABLED && (
        <InvoiceModal
          order={invoiceOrder}
          onClose={() => setInvoiceOrder(null)}
          onSaved={handleInvoiceSaved}
        />
      )}

      {cancelOrder && (
        <CancelOrderModal
          order={cancelOrder}
          onClose={() => setCancelOrder(null)}
          onCancelled={(payload) => {
            setOrder((prev) =>
              prev
                ? {
                    ...prev,
                    status: "cancelled",
                    statusLabel: "Anulată",
                    cancelReason: payload.cancelReason,
                    cancelReasonNote: payload.cancelReasonNote,
                  }
                : prev
            );
            setCancelOrder(null);
          }}
        />
      )}
    </main>
  );
}

/* ====== Modal Confirmare & Curier ===== */

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

        const addr = order.shippingAddress || {};
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

          if (!alive) return;
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

          if (!alive) return;
          setInvoice({
            series: "FA",
            number: "",
            issueDate: new Date().toISOString().slice(0, 10),
            dueDate: new Date().toISOString().slice(0, 10),
            currency: "RON",
            vendor: null,
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
            Factură pentru comanda{" "}
            <code>{order.orderNumber || order.shortId || order.id}</code>
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
              <Loader2 size={16} className={styles.spin} /> Se încarcă
              draftul de factură…
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
                          updateCustomerField("companyRegCom", e.target.value)
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
            Anulează comanda{" "}
            <code>{order.orderNumber || order.shortId || order.id}</code>
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
              <Loader2 size={16} className={styles.spin} />
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