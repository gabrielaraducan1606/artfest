import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { api } from "../../../lib/api";
import {
  ArrowLeft,
  Loader2,
  Phone,
  Mail,
  MapPin,
  ExternalLink,
  MessageSquare, // pentru "Contactează artizanul"
} from "lucide-react";
import styles from "./Orders.module.css";

const ORDER_STATUS_LABEL = {
  PENDING: "În așteptare",
  PROCESSING: "În procesare",
  SHIPPED: "Predată curierului",
  DELIVERED: "Livrată",
  CANCELED: "Anulată",
  RETURNED: "Returnată",
};

const ORDER_STATUS_HELP = {
  PENDING:
    "Comanda a fost înregistrată și urmează să fie preluată de artizani.",
  PROCESSING:
    "Artizanii pregătesc produsele pentru livrare. Vei primi actualizări când pachetele sunt predate curierului.",
  SHIPPED:
    "Cel puțin un pachet a fost predat curierului. Poți urmări statusul din secțiunea Livrare & AWB.",
  DELIVERED:
    "Toate pachetele au fost marcate ca livrate. Sperăm să te bucuri de produse ❤️",
  CANCELED:
    "Comanda a fost anulată. Dacă ai întrebări, contactează-ne pe suport.",
  RETURNED:
    "Comanda a fost returnată / nelivrată. Verifică inbox-ul pentru detalii sau contactează suportul.",
};

const SHIPMENT_STATUS_LABEL = {
  PENDING: "Nouă",
  PREPARING: "În pregătire",
  READY_FOR_PICKUP: "Confirmată pentru predare",
  PICKUP_SCHEDULED: "Ridicare programată",
  AWB: "AWB generat",
  IN_TRANSIT: "În livrare",
  DELIVERED: "Livrată",
  RETURNED: "Returnată / Anulată",
};

const SHIPMENT_STATUS_HELP = {
  PENDING: "Pachetul a fost înregistrat de către artizan.",
  PREPARING: "Artizanul pregătește produsele pentru acest pachet.",
  READY_FOR_PICKUP: "Pachetul este gata și urmează să fie preluat de curier.",
  PICKUP_SCHEDULED:
    "Preluarea de la artizan a fost programată. În scurt timp pachetul intră în livrare.",
  AWB: "AWB-ul a fost generat, pachetul urmează să fie preluat de curier.",
  IN_TRANSIT: "Pachetul este pe drum către tine.",
  DELIVERED: "Pachetul a fost livrat.",
  RETURNED: "Pachetul a fost returnat sau livrarea a eșuat.",
};

function money(cents = 0, currency = "RON") {
  const val = (Number(cents) || 0) / 100;
  return new Intl.NumberFormat("ro-RO", {
    style: "currency",
    currency,
  }).format(val);
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

export default function MyOrderDetailsPage() {
  const { id } = useParams();
  const nav = useNavigate();

  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [busyAction, setBusyAction] = useState(null); // "cancel" | "reorder" | null

  const load = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      const res = await api(`/api/user/orders/${encodeURIComponent(id)}`);
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

  // items & shipments stabile (evităm warning-uri ESLint)
  const items = useMemo(
    () => (Array.isArray(order?.items) ? order.items : []),
    [order]
  );

  const shipments = useMemo(
    () => (Array.isArray(order?.shipments) ? order.shipments : []),
    [order]
  );

  const addr = order?.shippingAddress || {};

  // grupăm produsele pe shipment (pachet / vendor)
  const shipmentBlocks = useMemo(() => {
    if (!shipments.length) return [];

    return shipments.map((s, index) => {
      const sItems = items.filter((it) => it.shipmentId === s.id);

      const itemsTotalCents = sItems.reduce(
        (sum, it) =>
          sum +
          (Number(it.priceCents) || 0) * (Number(it.qty) || 0),
        0
      );

      return {
        ...s,
        index: index + 1,
        items: sItems,
        itemsTotalCents,
      };
    });
  }, [shipments, items]);

  const hasMultipleShipments = shipmentBlocks.length > 1;

  const canCancel = !!order?.cancellable;
  const canReorder = !!order && order.status !== "CANCELED";

  async function handleCancel() {
    if (!order || !canCancel) return;
    if (!window.confirm("Sigur vrei să anulezi această comandă?")) return;

    setBusyAction("cancel");
    try {
      await api(`/api/user/orders/${order.id}/cancel`, {
        method: "POST",
      });
      await load();
    } catch (e) {
      alert(e?.message || "Nu am putut anula comanda.");
    } finally {
      setBusyAction(null);
    }
  }

  async function handleReorder() {
    if (!order) return;
    setBusyAction("reorder");
    try {
      await api(`/api/user/orders/${order.id}/reorder`, {
        method: "POST",
      });
      if (
        window.confirm(
          "Produsele au fost adăugate în coș. Deschizi coșul?"
        )
      ) {
        window.location.href = "/cos";
      }
    } catch (e) {
      alert(
        e?.message ||
          "Nu am putut re-comanda. Unele produse ar putea să nu mai fie disponibile."
      );
    } finally {
      setBusyAction(null);
    }
  }

  // contact vendor DOAR pentru pachetul curent
  async function contactVendorForShipment(shipment) {
    if (!shipment.vendorId) {
      alert(
        "Nu am putut identifica artizanul pentru acest pachet. Te rugăm contactează suportul."
      );
      return;
    }

    try {
      const res = await api("/api/user-inbox/ensure-thread", {
        method: "POST",
        body: { vendorId: shipment.vendorId },
      });

      const threadId = res?.threadId;
      if (!threadId) {
        throw new Error("Nu am primit ID-ul conversației.");
      }

      window.location.href = `/cont/mesaje?thread=${encodeURIComponent(
        threadId
      )}`;
    } catch (e) {
      console.error(e);
      alert(
        e?.message ||
          "Nu am putut deschide conversația cu artizanul. Încearcă din nou sau contactează suportul."
      );
    }
  }

  // abia acum facem early return-uri
  if (loading) {
    return (
      <main className={styles.page}>
        <div className={styles.card}>
          <Loader2 className={styles.spin} /> Se încarcă…
        </div>
      </main>
    );
  }

  if (err) {
    return (
      <main className={styles.page}>
        <div className={styles.card}>
          <p className={styles.error}>{err}</p>
          <button className={styles.btnGhost} onClick={() => nav(-1)}>
            <ArrowLeft size={16} /> Înapoi
          </button>
        </div>
      </main>
    );
  }

  if (!order) return null;

  const mainStatusLabel =
    ORDER_STATUS_LABEL[order.status] || order.status;
  const mainStatusHelp =
    ORDER_STATUS_HELP[order.status] ||
    "Vezi mai jos detaliile pe pachete și informațiile de livrare.";

  const isCompany = order.customerType === "PJ";

  return (
    <main className={styles.page}>
      {/* header */}
      <div className={styles.head}>
        <div>
          <h1 className={styles.h1}>
  Detalii comandă{" "}
  <span style={{ fontWeight: 400 }}>
    #{order.orderNumber || order.id.slice(0, 8) + "…"}
  </span>
</h1>

          <p className={styles.subtle}>
            Plasată la {formatDate(order.createdAt)}
          </p>

          {/* status principal + text ajutător */}
          <div
            style={{
              marginTop: 8,
              display: "flex",
              flexDirection: "column",
              gap: 4,
            }}
          >
            <span
              className={`${styles.badge} ${
                styles[`st_${order.status}`] || ""
              }`}
            >
              {mainStatusLabel}
            </span>
            <span className={styles.subtle}>{mainStatusHelp}</span>
          </div>
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 8,
            alignItems: "flex-end",
          }}
        >
          <button
            className={styles.btnGhost}
            onClick={() => nav(-1)}
            type="button"
          >
            <ArrowLeft size={16} /> Înapoi la listă
          </button>

          {/* acțiuni pe comandă */}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {canReorder && (
              <button
                type="button"
                className={styles.btnPrimary}
                onClick={handleReorder}
                disabled={busyAction === "reorder"}
              >
                {busyAction === "reorder" ? (
                  <>
                    <Loader2 size={16} className={styles.spin} />{" "}
                    Se adaugă…
                  </>
                ) : (
                  "Comandă din nou"
                )}
              </button>
            )}
            {canCancel && (
              <button
                type="button"
                className={styles.btnWarn}
                onClick={handleCancel}
                disabled={busyAction === "cancel"}
              >
                {busyAction === "cancel" ? (
                  <>
                    <Loader2 size={16} className={styles.spin} />{" "}
                    Se anulează…
                  </>
                ) : (
                  "Anulează comanda"
                )}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* info: livrare în mai multe pachete */}
      {hasMultipleShipments && (
        <div className={styles.card} style={{ marginBottom: 12 }}>
          <p className={styles.subtle}>
            Această comandă este livrată în{" "}
            <strong>{shipmentBlocks.length} pachete</strong>. Fiecare
            pachet poate avea un status de livrare diferit.
          </p>
        </div>
      )}

      {/* grid info client + livrare globală */}
      <div className={styles.list} style={{ marginBottom: 12 }}>
        <section className={styles.card}>
          <h3>Adresă de livrare</h3>
          <div className={styles.itemMeta} style={{ marginTop: 6 }}>
            <strong>{addr.name || "—"}</strong>
          </div>
          <div className={styles.itemMeta}>
            <Phone size={14} />{" "}
            {addr.phone ? (
              <a href={`tel:${addr.phone}`}>{addr.phone}</a>
            ) : (
              "—"
            )}
          </div>
          <div className={styles.itemMeta}>
            <Mail size={14} />{" "}
            {addr.email ? (
              <a href={`mailto:${addr.email}`}>{addr.email}</a>
            ) : (
              "—"
            )}
          </div>
          <div className={styles.itemMeta}>
            <MapPin size={14} />{" "}
            <span>
              {addr.street && <>{addr.street}, </>}
              {addr.city}
              {addr.postalCode && ` (${addr.postalCode})`}
              {addr.county && `, ${addr.county}`}
            </span>
          </div>

          {/* Dacă este persoană juridică, afișăm și datele de firmă */}
          {isCompany && (
            <>
              <div style={{ marginTop: 10 }}>
                <strong>Facturare pe firmă</strong>
              </div>
              <div className={styles.itemMeta}>
                Denumire firmă:{" "}
                <strong>{addr.companyName || "—"}</strong>
              </div>
              <div className={styles.itemMeta}>
                CUI: <strong>{addr.companyCui || "—"}</strong>
              </div>
              {addr.companyRegCom && (
                <div className={styles.itemMeta}>
                  Nr. Reg. Comerțului:{" "}
                  <strong>{addr.companyRegCom}</strong>
                </div>
              )}
            </>
          )}
        </section>

        <section className={styles.card}>
          <h3>Livrare & AWB (per pachet)</h3>
          {shipments.length === 0 && (
            <p className={styles.itemMeta}>
              Nu există încă informații de transport.
            </p>
          )}

          {shipments.length > 0 && (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Pachet</th>
                    <th>Status livrare</th>
                    <th>Curier</th>
                    <th>AWB</th>
                    <th>Tracking</th>
                  </tr>
                </thead>
                <tbody>
                  {shipmentBlocks.map((s) => (
                    <tr key={s.id}>
                      <td># {s.index}</td>
                      <td>
                        <div>
                          <strong>
                            {SHIPMENT_STATUS_LABEL[s.status] ||
                              s.status ||
                              "—"}
                          </strong>
                          {SHIPMENT_STATUS_HELP[s.status] && (
                            <div className={styles.subtle}>
                              {SHIPMENT_STATUS_HELP[s.status]}
                            </div>
                          )}
                        </div>
                      </td>
                      <td>
                        {s.provider || "—"}
                        {s.service && (
                          <div className={styles.itemMeta}>
                            {s.service}
                          </div>
                        )}
                      </td>
                      <td>{s.awb || "—"}</td>
                      <td>
                        {s.trackingUrl ? (
                          <a
                            href={s.trackingUrl}
                            target="_blank"
                            rel="noreferrer"
                            className={styles.itemMeta}
                          >
                            <ExternalLink size={14} /> urmărește
                          </a>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {/* produse – împărțite pe pachete / vendori */}
      {shipmentBlocks.length > 0 ? (
        <>
          {shipmentBlocks.map((s) => (
            <section className={styles.card} key={s.id}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 8,
                  alignItems: "center",
                  marginBottom: 6,
                  flexWrap: "wrap",
                }}
              >
                <div>
                  <h3>
                    Pachet {s.index} ·{" "}
                    {SHIPMENT_STATUS_LABEL[s.status] ||
                      s.status ||
                      "—"}
                  </h3>

                  {(s.vendorName || s.vendorId) && (
                    <>
                      <p className={styles.subtle}>
                        De la artizan:{" "}
                        <strong>{s.vendorName || "Artizan"}</strong>
                      </p>

                      {/* 👇 ADRESĂ MAGAZIN pentru pachet */}
                      {s.storeAddress && (
                        <p className={styles.itemMeta}>
                          <MapPin size={14} style={{ marginRight: 4 }} />
                          {[
                            s.storeAddress.street,
                            s.storeAddress.city,
                            s.storeAddress.county,
                            s.storeAddress.country,
                          ]
                            .filter(Boolean)
                            .join(", ")}
                        </p>
                      )}
                    </>
                  )}
                </div>

                {(s.vendorId || s.vendorName) && (
                  <button
                    type="button"
                    className={styles.btnGhost}
                    onClick={() => contactVendorForShipment(s)}
                    title="Scrie artizanului pentru acest pachet"
                  >
                    <MessageSquare
                      size={16}
                      style={{ marginRight: 4 }}
                    />
                    Contactează artizanul
                  </button>
                )}
              </div>

              {s.items.length === 0 && (
                <p className={styles.itemMeta}>
                  Nu există produse asociate acestui pachet.
                </p>
              )}

              {s.items.length > 0 && (
                <ul className={styles.itemList}>
                  {s.items.map((it) => {
                    const lineTotalCents =
                      (Number(it.priceCents) || 0) *
                      (Number(it.qty) || 0);
                    return (
                      <li className={styles.item} key={it.id}>
                        {it.productId ? (
                          <Link
                            to={`/produs/${it.productId}`}
                            className={styles.itemThumbLink}
                          >
                            <img
                              src={it.image || "/placeholder.png"}
                              alt={it.title}
                              className={styles.thumb}
                              loading="lazy"
                            />
                          </Link>
                        ) : (
                          <div className={styles.itemThumbLink}>
                            <img
                              src={it.image || "/placeholder.png"}
                              alt={it.title}
                              className={styles.thumb}
                              loading="lazy"
                            />
                          </div>
                        )}

                        <div className={styles.itemInfo}>
                          <div className={styles.itemTitle}>
                            {it.productId ? (
                              <Link
                                to={`/produs/${it.productId}`}
                                className={styles.itemTitleLink}
                              >
                                {it.title}
                              </Link>
                            ) : (
                              it.title
                            )}
                          </div>
                          <div className={styles.itemMeta}>
                            Cantitate: <b>{it.qty}</b> · Preț unitar:{" "}
                            <b>
                              {money(
                                it.priceCents,
                                order.currency
                              )}
                            </b>{" "}
                            · Total linie:{" "}
                            <b>
                              {money(
                                lineTotalCents,
                                order.currency
                              )}
                            </b>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}

              <div
                className={styles.actionsRow}
                style={{ justifyContent: "flex-end" }}
              >
                <div>
                  Total produse pachet {s.index}:{" "}
                  <strong>
                    {money(
                      s.itemsTotalCents,
                      order.currency
                    )}
                  </strong>
                </div>
              </div>
            </section>
          ))}
        </>
      ) : (
        <section className={styles.card}>
          <h3>Produse din comandă</h3>
          <ul className={styles.itemList}>
            {items.map((it) => {
              const lineTotalCents =
                (Number(it.priceCents) || 0) *
                (Number(it.qty) || 0);
              return (
                <li className={styles.item} key={it.id}>
                  {it.productId ? (
                    <Link
                      to={`/produs/${it.productId}`}
                      className={styles.itemThumbLink}
                    >
                      <img
                        src={it.image || "/placeholder.png"}
                        alt={it.title}
                        className={styles.thumb}
                        loading="lazy"
                      />
                    </Link>
                  ) : (
                    <div className={styles.itemThumbLink}>
                      <img
                        src={it.image || "/placeholder.png"}
                        alt={it.title}
                        className={styles.thumb}
                        loading="lazy"
                      />
                    </div>
                  )}

                  <div className={styles.itemInfo}>
                    <div className={styles.itemTitle}>
                      {it.productId ? (
                        <Link
                          to={`/produs/${it.productId}`}
                          className={styles.itemTitleLink}
                        >
                          {it.title}
                        </Link>
                      ) : (
                        it.title
                      )}
                    </div>
                    <div className={styles.itemMeta}>
                      Cantitate: <b>{it.qty}</b> · Preț unitar:{" "}
                      <b>
                        {money(
                          it.priceCents,
                          order.currency
                        )}
                      </b>{" "}
                      · Total linie:{" "}
                      <b>
                        {money(
                          lineTotalCents,
                          order.currency
                        )}
                      </b>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section className={styles.card}>
        <h3>Sumar costuri</h3>
        <div
          className={styles.actionsRow}
          style={{ justifyContent: "flex-end" }}
        >
          <div>
            Subtotal:{" "}
            <strong>
              {money(order.subtotalCents, order.currency)}
            </strong>
          </div>
          <div>
            Transport:{" "}
            <strong>
              {money(order.shippingCents, order.currency)}
            </strong>
          </div>
          <div>
            Total:{" "}
            <strong>
              {money(order.totalCents, order.currency)}
            </strong>
          </div>
        </div>
      </section>

      <div className={styles.loadMoreWrap}>
        <button
          className={styles.btnGhost}
          onClick={() => nav(-1)}
          type="button"
        >
          <ArrowLeft size={16} /> Înapoi la listă
        </button>
      </div>
    </main>
  );
}
