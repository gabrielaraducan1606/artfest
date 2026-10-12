import { useEffect, useMemo, useState } from "react";
import { api } from "../../../lib/api";
import {
  Search,
  Filter,
  RefreshCw,
  Loader2,
  ChevronLeft,
  ChevronRight,
  Copy,
  ExternalLink,
  X,
} from "lucide-react";

import styles from "./AdminPickupsPage.module.css";

/* Utils */
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

function slotLabel(start, end) {
  if (!start || !end) return "";
  const s = new Date(start).toLocaleTimeString("ro-RO", {
    hour: "2-digit",
    minute: "2-digit",
  });
  const e = new Date(end).toLocaleTimeString("ro-RO", {
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${s}–${e}`;
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

const STATUS_OPTIONS = [
  { value: "", label: "Toate (pickup cerut)" },
  { value: "READY_FOR_PICKUP", label: "READY_FOR_PICKUP" },
  { value: "PICKUP_SCHEDULED", label: "PICKUP_SCHEDULED" },

  // optional: dacă vrei să poți filtra și după final states în aceeași pagină
  // { value: "DELIVERED", label: "DELIVERED" },
  // { value: "REFUSED", label: "REFUSED" },
  // { value: "RETURNED", label: "RETURNED" },
];

function statusBadgeClass(status) {
  if (status === "DELIVERED") return styles.badgeSuccess;
  if (status === "RETURNED") return styles.badgeWarning;
  if (status === "REFUSED") return styles.badgeWarning;

  if (status === "PICKUP_SCHEDULED") return styles.badgeSuccess;
  if (status === "READY_FOR_PICKUP") return styles.badgeWarning;
  return "";
}

const COURIER_PROVIDERS = [
  { value: "", label: "Alege curier" },
  { value: "FAN", label: "FAN" },
  { value: "SAMEDAY", label: "Sameday" },
  { value: "DPD", label: "DPD" },
  { value: "CARGUS", label: "Cargus" },
  { value: "BOOKURIER", label: "Bookurier" },
  { value: "OTHER", label: "Altul" },
];

function toHHMM(d) {
  if (!d) return "";
  const x = new Date(d);
  return x.toLocaleTimeString("ro-RO", { hour: "2-digit", minute: "2-digit" });
}

function isValidUrlMaybeEmpty(v) {
  if (!v) return true;
  try {
    const u = new URL(v);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

export default function AdminPickupsPage() {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [data, setData] = useState({ items: [], total: 0 });

  const [selected, setSelected] = useState(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsErr, setDetailsErr] = useState("");

  const totalPages = Math.max(1, Math.ceil((data?.total || 0) / pageSize));

  const query = useMemo(
    () => ({ q, status, from, to, page, pageSize }),
    [q, status, from, to, page, pageSize]
  );

  const refresh = () => setPage((p) => p);

  useEffect(() => {
    let alive = true;

    async function run() {
      setLoading(true);
      setErr("");
      try {
        const qs = new URLSearchParams(
          Object.fromEntries(
            Object.entries(query).filter(([, v]) => v !== "" && v != null)
          )
        ).toString();

        const res = await api(`/api/admin/pickups?${qs}`);
        if (!alive) return;

        setData({
          items: Array.isArray(res?.items) ? res.items : [],
          total: Number(res?.total || 0),
        });
      } catch {
        if (!alive) return;
        setErr("Nu am putut încărca pickup-urile. Încearcă din nou.");
      } finally {
        if (alive) setLoading(false);
      }
    }

    run();
    return () => {
      alive = false;
    };
  }, [query]);

  function reset() {
    setPage(1);
    setQ("");
    setStatus("");
    setFrom("");
    setTo("");
  }

  async function openDetails(row) {
    setSelected(null);
    setDetailsErr("");
    setDetailsLoading(true);
    try {
      const res = await api(`/api/admin/pickups/${row.shipmentId}`);
      setSelected(res?.shipment ? withCourierAwbs(normalizeShipment(res.shipment), res.courierAwbs) : null);
    } catch {
      setDetailsErr("Nu am putut încărca detaliile coletului.");
      setSelected(null);
    } finally {
      setDetailsLoading(false);
    }
  }

  // reîncarcă detaliile fără să închidă modalul (după rezolvarea unui AWB)
  async function reloadDetails(shipmentId) {
    try {
      const res = await api(`/api/admin/pickups/${shipmentId}`);
      if (!res?.shipment) return;
      const next = withCourierAwbs(normalizeShipment(res.shipment), res.courierAwbs);
      setSelected(next);
      setData((prev) => ({
        ...prev,
        items: (prev.items || []).map((it) =>
          it.shipmentId === shipmentId
            ? { ...it, awb: next.awb, trackingUrl: next.trackingUrl, courierAwb: next.courierAwbs[0] || null }
            : it
        ),
      }));
    } catch {
      // detaliile vechi rămân afișate
    }
  }

  return (
    <main className={styles.page}>
      <div className={styles.headerRow}>
        <div>
          <h1 className={styles.h1}>Pickup-uri (colete gata de ridicare)</h1>
          <div className={styles.muted} style={{ fontSize: 13, marginTop: 4 }}>
            Vendorul cere ridicarea → apare aici (READY_FOR_PICKUP / PICKUP_SCHEDULED). Admin poate seta curier + AWB + perioada ridicare.
          </div>
        </div>

        <button className={styles.secondaryBtn} onClick={refresh}>
          <RefreshCw size={16} /> Refresh
        </button>
      </div>

      {/* Filters */}
      <div className={styles.filters}>
        <div className={styles.inputWrap}>
          <Search size={16} className={styles.inputIcon} />
          <input
            value={q}
            onChange={(e) => {
              setPage(1);
              setQ(e.target.value);
            }}
            placeholder="Caută: AWB, #colet, AF-..., comanda, vendor…"
            className={styles.input}
            aria-label="Căutare pickups"
          />
        </div>

        <div className={styles.selectWrap} title="Filtru status">
          <Filter size={16} className={styles.inputIcon} />
          <select
            className={styles.select}
            value={status}
            onChange={(e) => {
              setPage(1);
              setStatus(e.target.value);
            }}
            aria-label="Filtru status"
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        <div className={styles.actions}>
          <div className={styles.dateWrap}>
            <span className={styles.muted} style={{ fontSize: 13 }}>
              De la
            </span>
            <input
              type="date"
              className={styles.dateInput}
              value={from}
              onChange={(e) => {
                setPage(1);
                setFrom(e.target.value);
              }}
              aria-label="De la data"
            />
          </div>

          <div className={styles.dateWrap}>
            <span className={styles.muted} style={{ fontSize: 13 }}>
              Până la
            </span>
            <input
              type="date"
              className={styles.dateInput}
              value={to}
              onChange={(e) => {
                setPage(1);
                setTo(e.target.value);
              }}
              aria-label="Până la data"
            />
          </div>

          <button className={styles.secondaryBtn} onClick={reset}>
            <RefreshCw size={16} /> Reset
          </button>
        </div>
      </div>

      {/* Table */}
      <div className={styles.card}>
        <div className={styles.tableWrap} role="region" aria-label="Tabel pickup-uri">
          <table className={styles.table}>
            <thead className={styles.thead}>
              <tr>
                <th className={styles.th}>Colet</th>
                <th className={styles.th}>Vendor</th>
                <th className={styles.th}>Client</th>
                <th className={styles.th}>Pickup</th>
                <th className={styles.th}>AWB</th>
                <th className={styles.th}>Status</th>
              </tr>
            </thead>

            <tbody>
              {loading && (
                <tr>
                  <td className={styles.td} colSpan={6}>
                    <Loader2 size={16} className={styles.spin} /> Se încarcă…
                  </td>
                </tr>
              )}

              {!loading && data.items.length === 0 && (
                <tr>
                  <td className={styles.emptyCell} colSpan={6}>
                    Nu există pickup-uri pentru filtrele curente.
                  </td>
                </tr>
              )}

              {!loading &&
                data.items.map((p) => (
                  <tr
                    key={p.shipmentId}
                    className={styles.row}
                    style={{ cursor: "pointer" }}
                    onClick={() => openDetails(p)}
                    title="Click pentru detalii"
                  >
                    <td className={styles.td}>
                      <div>
                        <code className={styles.code}>#{p.shortShipmentId}</code>
                      </div>

                      <div className={styles.muted} style={{ fontSize: 12, marginTop: 4 }}>
                        Comandă:{" "}
                        <span style={{ fontFamily: "ui-monospace" }}>
                          {p.orderNumber || p.orderId}
                        </span>
                      </div>
                    </td>

                    <td className={styles.td}>
                      <div style={{ fontWeight: 600 }}>{p.vendorName || p.vendorId}</div>
                      {!!p.vendorEmail && (
                        <div className={styles.muted} style={{ fontSize: 12 }}>
                          {p.vendorEmail}
                        </div>
                      )}
                    </td>

                    <td className={styles.td}>
                      <div style={{ fontWeight: 600 }}>{p.customerName || "—"}</div>
                      <div className={styles.muted} style={{ fontSize: 12 }}>
                        {p.customerPhone || "—"}
                        {p.customerCity ? ` · ${p.customerCity}` : ""}
                      </div>
                    </td>

                    <td className={styles.td}>
                      <div>{p.pickupDate ? formatDate(p.pickupDate) : "—"}</div>
                      <div className={styles.muted} style={{ fontSize: 12 }}>
                        {slotLabel(p.pickupSlotStart, p.pickupSlotEnd)}
                      </div>
                    </td>

                    <td className={styles.td} onClick={(e) => e.stopPropagation()}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <code className={styles.code}>{p.awb || "—"}</code>
                        {p.courierAwb?.status === "UNKNOWN" && (
                          <span className={styles.error} style={{ fontSize: 12 }} title={p.courierAwb.errorMessage || ""}>
                            AWB necunoscut – verifică
                          </span>
                        )}
                        {p.awb && (
                          <button
                            type="button"
                            className={styles.secondaryBtn}
                            style={{ padding: "8px 10px" }}
                            onClick={async () => {
                              const ok = await copyToClipboard(p.awb);
                              if (!ok) alert("Nu am putut copia în clipboard.");
                            }}
                            title="Copiază AWB"
                          >
                            <Copy size={16} />
                          </button>
                        )}
                      </div>
                    </td>

                    <td className={styles.td}>
                      <span className={`${styles.badge} ${statusBadgeClass(p.status)}`}>
                        {p.status}
                      </span>
                      {!!p.pickupScheduledAt && (
                        <div className={styles.muted} style={{ fontSize: 12, marginTop: 6 }}>
                          Cerut: {formatDate(p.pickupScheduledAt)}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>

        {!!err && <p className={styles.error}>{err}</p>}

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

      {/* Details modal */}
      {(detailsLoading || detailsErr || selected) && (
        <AdminPickupDetailsModal
          loading={detailsLoading}
          error={detailsErr}
          shipment={selected}
          onReload={() => selected?.shipmentId && reloadDetails(selected.shipmentId)}
          onClose={() => {
            setSelected(null);
            setDetailsErr("");
            setDetailsLoading(false);
          }}
          onSaved={(patch) => {
            setSelected((prev) => (prev ? { ...prev, ...patch } : prev));
            setData((prev) => ({
              ...prev,
              items: (prev.items || []).map((it) =>
                it.shipmentId === patch.shipmentId ? { ...it, ...patch } : it
              ),
            }));
          }}
        />
      )}
    </main>
  );
}

/* ----------------------------
   Modal detalii (inline)
----------------------------- */
function AdminPickupDetailsModal({ loading, error, shipment, onClose, onSaved, onReload }) {
  // AWB generat prin integrarea de curier, încă activ -> fără editare manuală (backend: 409)
  const integrationAwbActive = (shipment?.courierAwbs || []).some((r) => r.active || r.stale);
  const [providerDraft, setProviderDraft] = useState("");
  const [serviceDraft, setServiceDraft] = useState("");

  const [awbDraft, setAwbDraft] = useState("");
  const [labelDraft, setLabelDraft] = useState("");
  const [trackDraft, setTrackDraft] = useState("");

  const [pickupDateDraft, setPickupDateDraft] = useState("");
  const [slotStartDraft, setSlotStartDraft] = useState("14:00");
  const [slotEndDraft, setSlotEndDraft] = useState("18:00");

  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState("");

  // ✅ NEW: status saving/errors
  const [statusSaving, setStatusSaving] = useState(false);
  const [statusErr, setStatusErr] = useState("");

  useEffect(() => {
    setProviderDraft(shipment?.courierProvider || "");
    setServiceDraft(shipment?.courierService || "");

    setAwbDraft(shipment?.awb || "");
    setLabelDraft(shipment?.labelUrl || "");
    setTrackDraft(shipment?.trackingUrl || "");

    const pd = shipment?.pickupDate ? new Date(shipment.pickupDate) : null;
    setPickupDateDraft(pd ? pd.toISOString().slice(0, 10) : "");

    setSlotStartDraft(shipment?.pickupSlotStart ? toHHMM(shipment.pickupSlotStart) : "14:00");
    setSlotEndDraft(shipment?.pickupSlotEnd ? toHHMM(shipment.pickupSlotEnd) : "18:00");

    setSaving(false);
    setSaveErr("");
    setStatusSaving(false);
    setStatusErr("");
  }, [
    shipment?.shipmentId,
    shipment?.awb,
    shipment?.courierProvider,
    shipment?.courierService,
    shipment?.labelUrl,
    shipment?.pickupDate,
    shipment?.pickupSlotStart,
    shipment?.pickupSlotEnd,
    shipment?.trackingUrl,
    shipment?.status,
    shipment?.deliveredAt,
    shipment?.refusedAt,
    shipment?.returnedAt,
  ]);

  async function saveCourier() {
    if (!shipment?.shipmentId) return;

    const courierProvider = providerDraft.trim();
    const courierService = serviceDraft.trim() ? serviceDraft.trim() : null;

    const awb = awbDraft.trim() ? awbDraft.trim() : null;
    const labelUrl = labelDraft.trim() ? labelDraft.trim() : null;
    const trackingUrl = trackDraft.trim() ? trackDraft.trim() : null;

    if (!courierProvider) {
      setSaveErr("Alege un curier (courierProvider).");
      return;
    }

    if (!isValidUrlMaybeEmpty(labelUrl)) {
      setSaveErr("Label URL invalid (trebuie http/https).");
      return;
    }
    if (!isValidUrlMaybeEmpty(trackingUrl)) {
      setSaveErr("Tracking URL invalid (trebuie http/https).");
      return;
    }

    let pickupDate = null;
    let pickupSlotStart = null;
    let pickupSlotEnd = null;

    if (pickupDateDraft) {
      const [sh, sm] = String(slotStartDraft || "14:00").split(":").map(Number);
      const [eh, em] = String(slotEndDraft || "18:00").split(":").map(Number);

      const start = new Date(`${pickupDateDraft}T00:00:00`);
      start.setHours(Number.isFinite(sh) ? sh : 14, Number.isFinite(sm) ? sm : 0, 0, 0);

      const end = new Date(`${pickupDateDraft}T00:00:00`);
      end.setHours(Number.isFinite(eh) ? eh : 18, Number.isFinite(em) ? em : 0, 0, 0);

      if (end <= start) {
        setSaveErr("Interval pickup invalid (end trebuie să fie după start).");
        return;
      }

      pickupDate = new Date(`${pickupDateDraft}T00:00:00`).toISOString();
      pickupSlotStart = start.toISOString();
      pickupSlotEnd = end.toISOString();
    }

    setSaving(true);
    setSaveErr("");

    try {
      const res = await api(`/api/admin/pickups/${shipment.shipmentId}/courier`, {
        method: "PATCH",
        body: JSON.stringify({
          courierProvider,
          courierService,

          awb,
          labelUrl,
          trackingUrl,

          pickupDate,
          pickupSlotStart,
          pickupSlotEnd,

          status: "PICKUP_SCHEDULED",
        }),
      });

      const updated = res?.shipment;
      if (!updated?.id) throw new Error("bad_response");

      onSaved?.({
        shipmentId: shipment.shipmentId,

        status: updated.status,
        courierProvider: updated.courierProvider || "",
        courierService: updated.courierService || "",

        awb: updated.awb || "",
        labelUrl: updated.labelUrl || null,
        trackingUrl: updated.trackingUrl || null,

        pickupDate: updated.pickupDate || null,
        pickupSlotStart: updated.pickupSlotStart || null,
        pickupSlotEnd: updated.pickupSlotEnd || null,
      });
    } catch (e) {
      const msg =
        e?.data?.error === "courier_awb_active"
          ? e.data.message
          : e?.status === 409
          ? "Nu pot salva: status nepotrivit sau AWB duplicat."
          : e?.status === 400
          ? "Payload invalid (verifică datele/URL-urile)."
          : "Nu am putut salva curierul/AWB/pickup. Încearcă din nou.";
      setSaveErr(msg);
    } finally {
      setSaving(false);
    }
  }

  // ✅ NEW: set status (manual)
  async function setShipmentStatus(action) {
    if (!shipment?.shipmentId) return;

    const map = {
      delivered: "DELIVERED",
      refused: "REFUSED",
      returned: "RETURNED",
    };

    const nextStatus = map[action];
    if (!nextStatus) return;

    const confirmMsg =
      action === "refused" || action === "returned"
        ? `Sigur vrei să setezi statusul la ${nextStatus}?\n\nAceastă acțiune va reversa (anula) veniturile deja înregistrate pentru acest colet: comisionul vânzătorului, comisionul Artfest și, dacă e cazul, comisionul influencerului.`
        : `Sigur vrei să setezi statusul la ${nextStatus}?`;

    const ok = window.confirm(confirmMsg);
    if (!ok) return;

    setStatusSaving(true);
    setStatusErr("");

    try {
      const res = await api(`/api/admin/pickups/${shipment.shipmentId}/${action}`, {
        method: "PATCH",
      });

      const updated = res?.shipment;
      if (!updated?.id) throw new Error("bad_response");

      onSaved?.({
        shipmentId: shipment.shipmentId,
        status: updated.status,
        deliveredAt: updated.deliveredAt || null,
        refusedAt: updated.refusedAt || null,
        returnedAt: updated.returnedAt || null,
      });
    } catch (e) {
      const msg =
        e?.status === 409
          ? "Nu pot seta statusul: status curent nepotrivit."
          : "Nu am putut seta statusul. Încearcă din nou.";
      setStatusErr(msg);
    } finally {
      setStatusSaving(false);
    }
  }

  return (
    <div className={styles.modalBackdrop} role="dialog" aria-modal="true">
      <div className={styles.modal}>
        <div className={styles.modalHead}>
          <div>
            <div style={{ fontWeight: 700, fontFamily: "var(--font-title)" }}>
              Detalii pickup
            </div>
            {shipment?.shortShipmentId && (
              <div className={styles.muted} style={{ fontSize: 12 }}>
                Colet <code className={styles.code}>#{shipment.shortShipmentId}</code>
              </div>
            )}
          </div>

          <button className={styles.iconBtn} onClick={onClose} aria-label="Închide">
            <X size={18} />
          </button>
        </div>

        <div className={styles.modalBody}>
          {loading && (
            <div style={{ padding: 14 }}>
              <Loader2 size={16} className={styles.spin} /> Se încarcă…
            </div>
          )}

          {!loading && error && <p className={styles.error}>{error}</p>}

          {!loading && !error && shipment && (
            <>
              <div className={styles.kvGrid}>
                <KV label="Status">
                  <span className={`${styles.badge} ${statusBadgeClass(shipment.status)}`}>
                    {shipment.status}
                  </span>
                </KV>

                <KV label="AWB integrare curier">
                  <CourierAwbSection
                    shipmentId={shipment.shipmentId}
                    rows={shipment.courierAwbs}
                    onResolved={onReload}
                  />
                </KV>

                {/* ✅ NEW: show timestamps */}
                <KV label="Istoric status">
                  <div className={styles.muted} style={{ fontSize: 12, display: "grid", gap: 4 }}>
                    <div>Livrat: {shipment.deliveredAt ? formatDate(shipment.deliveredAt) : "—"}</div>
                    <div>Refuzat: {shipment.refusedAt ? formatDate(shipment.refusedAt) : "—"}</div>
                    <div>Returnat: {shipment.returnedAt ? formatDate(shipment.returnedAt) : "—"}</div>
                  </div>
                </KV>

                <KV label="Comandă">
                  <div style={{ display: "grid", gap: 4 }}>
                    <code className={styles.code}>{shipment.orderNumber || "—"}</code>
                    <div className={styles.muted} style={{ fontSize: 12 }}>
                      ID intern: <code className={styles.code}>{shipment.orderId}</code>
                    </div>
                  </div>
                </KV>

                <KV label="Curier (admin)">
                  <div style={{ display: "grid", gap: 8 }}>
                    {integrationAwbActive && (
                      <div className={styles.muted} style={{ fontSize: 12 }}>
                        Curierul și AWB-ul sunt gestionate de integrarea de curier (AWB activ). Nu pot fi
                        suprascrise manual; vendorul îl poate anula, iar un AWB neconfirmat se rezolvă mai sus.
                      </div>
                    )}
                    <select
                      className={styles.select}
                      value={providerDraft}
                      disabled={integrationAwbActive}
                      onChange={(e) => setProviderDraft(e.target.value)}
                      aria-label="Courier Provider"
                    >
                      {COURIER_PROVIDERS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>

                    <input
                      className={styles.input}
                      value={serviceDraft}
                      disabled={integrationAwbActive}
                      onChange={(e) => setServiceDraft(e.target.value)}
                      placeholder="Serviciu (ex: standard24h) (opțional)"
                      aria-label="Courier Service"
                    />
                  </div>
                </KV>

                <KV label="Perioadă ridicare (admin)">
                  <div style={{ display: "grid", gap: 8 }}>
                    <input
                      type="date"
                      className={styles.dateInput}
                      value={pickupDateDraft}
                      onChange={(e) => setPickupDateDraft(e.target.value)}
                      aria-label="Pickup date"
                    />

                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                      <input
                        type="time"
                        className={styles.input}
                        value={slotStartDraft}
                        onChange={(e) => setSlotStartDraft(e.target.value)}
                        aria-label="Slot start"
                      />
                      <input
                        type="time"
                        className={styles.input}
                        value={slotEndDraft}
                        onChange={(e) => setSlotEndDraft(e.target.value)}
                        aria-label="Slot end"
                      />
                    </div>

                    <div className={styles.muted} style={{ fontSize: 12 }}>
                      Exemplu: 14:00 – 18:00
                    </div>
                  </div>
                </KV>

                <KV label="AWB + link-uri">
                  <div style={{ display: "grid", gap: 8 }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <input
                        className={styles.input}
                        value={awbDraft}
                      disabled={integrationAwbActive}
                        onChange={(e) => setAwbDraft(e.target.value)}
                        placeholder="AWB (opțional, dar recomandat)"
                        aria-label="AWB"
                      />

                      {shipment.awb && (
                        <button
                          className={styles.secondaryBtn}
                          style={{ padding: "8px 10px" }}
                          onClick={async () => {
                            const ok = await copyToClipboard(shipment.awb);
                            if (!ok) alert("Nu am putut copia în clipboard.");
                          }}
                          title="Copiază AWB"
                        >
                          <Copy size={16} />
                        </button>
                      )}
                    </div>

                    <input
                      className={styles.input}
                      value={labelDraft}
                      disabled={integrationAwbActive}
                      onChange={(e) => setLabelDraft(e.target.value)}
                      placeholder="Label URL (opțional)"
                      aria-label="Label URL"
                    />
                    <input
                      className={styles.input}
                      value={trackDraft}
                      disabled={integrationAwbActive}
                      onChange={(e) => setTrackDraft(e.target.value)}
                      placeholder="Tracking URL (opțional)"
                      aria-label="Tracking URL"
                    />

                    {!!saveErr && <div className={styles.error}>{saveErr}</div>}
                  </div>
                </KV>

                <KV label="Vendor">
                  <div>
                    <div style={{ fontWeight: 600 }}>
                      {shipment.vendorName || shipment.vendorId}
                    </div>
                    {shipment.vendorEmail && (
                      <div className={styles.muted} style={{ fontSize: 12 }}>
                        {shipment.vendorEmail}
                      </div>
                    )}
                  </div>
                </KV>

                <KV label="Pickup (curent)">
                  <div>
                    <div>{shipment.pickupDate ? formatDate(shipment.pickupDate) : "—"}</div>
                    <div className={styles.muted} style={{ fontSize: 12 }}>
                      {slotLabel(shipment.pickupSlotStart, shipment.pickupSlotEnd)}
                    </div>
                  </div>
                </KV>

                <KV label="Colet">
                  <div className={styles.muted} style={{ fontSize: 13 }}>
                    {shipment.parcels || 1} colet(e) · {shipment.weightKg || 0} kg ·{" "}
                    {shipment.dims || "—"}
                  </div>
                </KV>

                <KV label="Client">
                  <div>
                    <div style={{ fontWeight: 600 }}>{shipment.customerName || "—"}</div>
                    <div className={styles.muted} style={{ fontSize: 12 }}>
                      {shipment.customerPhone || "—"}
                      {shipment.customerCity ? ` · ${shipment.customerCity}` : ""}
                    </div>
                    {shipment.customerAddress && (
                      <div className={styles.muted} style={{ fontSize: 12, marginTop: 4 }}>
                        {shipment.customerAddress}
                      </div>
                    )}
                  </div>
                </KV>

                <KV label="Programat la">
                  <div>{shipment.pickupScheduledAt ? formatDate(shipment.pickupScheduledAt) : "—"}</div>
                </KV>
              </div>

              <div className={styles.modalActions}>
                <button
                  className={styles.primaryBtn}
                  disabled={saving || !providerDraft.trim()}
                  onClick={saveCourier}
                  style={{ whiteSpace: "nowrap" }}
                >
                  {saving ? <Loader2 size={16} className={styles.spin} /> : "Salvează"}
                </button>

                {/* ✅ NEW: status buttons */}
                <button
                  className={styles.secondaryBtn}
                  disabled={statusSaving}
                  onClick={() => setShipmentStatus("delivered")}
                  title="Marchează livrat"
                >
                  {statusSaving ? <Loader2 size={16} className={styles.spin} /> : "Livrat"}
                </button>

                <button
                  className={styles.secondaryBtn}
                  disabled={statusSaving}
                  onClick={() => setShipmentStatus("refused")}
                  title="Marchează refuzat"
                >
                  {statusSaving ? <Loader2 size={16} className={styles.spin} /> : "Refuzat"}
                </button>

                <button
                  className={styles.secondaryBtn}
                  disabled={statusSaving}
                  onClick={() => setShipmentStatus("returned")}
                  title="Marchează returnat"
                >
                  {statusSaving ? <Loader2 size={16} className={styles.spin} /> : "Returnat"}
                </button>

                {!!statusErr && <div className={styles.error}>{statusErr}</div>}

                {shipment.labelUrl && (
                  <a
                    className={styles.secondaryBtn}
                    href={shipment.labelUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <ExternalLink size={16} /> Label
                  </a>
                )}

                {shipment.trackingUrl && (
                  <a
                    className={styles.secondaryBtn}
                    href={shipment.trackingUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <ExternalLink size={16} /> Tracking
                  </a>
                )}

                <button className={styles.primaryBtn} onClick={onClose}>
                  Închide
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ----------------------------
   AWB-uri generate prin integrarea de curier (CourierAwb)
   Doar vizualizare + rezolvarea celor UNKNOWN (după verificarea
   manuală în contul curierului). Adminul NU generează AWB aici.
----------------------------- */
const COURIER_AWB_STATUS = {
  REQUESTED: { label: "În curs", tone: "warning" },
  CREATED: { label: "Creat", tone: "success" },
  FAILED: { label: "Eșuat", tone: "danger" },
  UNKNOWN: { label: "Necesită verificare", tone: "warning" },
  CANCELLED: { label: "Anulat", tone: "muted" },
};

function CourierAwbBadge({ status }) {
  const meta = COURIER_AWB_STATUS[status] || { label: status, tone: "muted" };
  return <span className={`${styles.awbBadge} ${styles[`awbTone_${meta.tone}`]}`}>{meta.label}</span>;
}

// rezolvarea unui AWB UNKNOWN, după verificarea în contul curierului
function ResolveAwbForm({ shipmentId, row, onDone, onCancel }) {
  const [outcome, setOutcome] = useState("");
  const [awbNumber, setAwbNumber] = useState(row.awbNumber || "");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const numberOk = /^[A-Za-z0-9-]{4,60}$/.test(awbNumber.trim());
  const canSubmit = !busy && (outcome === "FAILED" || (outcome === "CREATED" && numberOk));

  async function submit() {
    if (!canSubmit) return;
    setBusy(true);
    setErr("");
    try {
      await api(
        `/api/admin/pickups/${encodeURIComponent(shipmentId)}/courier-awb/${encodeURIComponent(row.id)}/resolve`,
        {
          method: "POST",
          body: JSON.stringify({
            outcome,
            awbNumber: outcome === "CREATED" ? awbNumber.trim() : undefined,
            note,
          }),
        }
      );
      await onDone?.();
    } catch (e) {
      setErr(e?.data?.message || "Nu am putut rezolva AWB-ul.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.resolveBox}>
      <div className={styles.muted} style={{ fontSize: 12 }}>
        Verifică mai întâi în contul curierului (eAWB) după referința comenzii.
      </div>
      <label className={styles.resolveOption}>
        <input type="radio" name={`resolve-${row.id}`} checked={outcome === "FAILED"} onChange={() => setOutcome("FAILED")} />
        AWB nu există – expedierea poate genera un AWB nou
      </label>
      <label className={styles.resolveOption}>
        <input type="radio" name={`resolve-${row.id}`} checked={outcome === "CREATED"} onChange={() => setOutcome("CREATED")} />
        AWB există
      </label>
      {outcome === "CREATED" && (
        <input
          className={styles.input}
          value={awbNumber}
          onChange={(e) => setAwbNumber(e.target.value)}
          placeholder="Număr AWB"
          aria-label="Număr AWB"
          aria-invalid={!!awbNumber && !numberOk}
        />
      )}
      <input
        className={styles.input}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Notă pentru audit (opțional)"
        aria-label="Notă pentru audit"
        maxLength={500}
      />
      {err && <div className={styles.error} style={{ fontSize: 12 }}>{err}</div>}
      <div className={styles.resolveActions}>
        <button type="button" className={styles.primaryBtn} disabled={!canSubmit} onClick={submit}>
          {busy ? <Loader2 size={16} className={styles.spin} /> : null} Confirmă
        </button>
        <button type="button" className={styles.secondaryBtn} disabled={busy} onClick={onCancel}>
          Renunță
        </button>
      </div>
    </div>
  );
}

function CourierAwbSection({ shipmentId, rows, onResolved }) {
  const [resolvingId, setResolvingId] = useState("");

  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return <span className={styles.muted}>—</span>;

  return (
    <div className={styles.awbList}>
      {list.map((row) => (
        <div key={row.id} className={styles.awbItem}>
          <div className={styles.awbHead}>
            <strong>{row.provider}</strong>
            <code className={styles.code}>{row.awbNumber || "—"}</code>
            <CourierAwbBadge status={row.status} />
          </div>
          <div className={styles.muted} style={{ fontSize: 12 }}>
            Creat: {row.createdAt ? formatDate(row.createdAt) : "—"}
            {row.cost != null ? ` · cost curier: ${row.cost} RON` : ""}
          </div>
          {row.errorMessage && <div className={styles.error} style={{ fontSize: 12 }}>{row.errorMessage}</div>}
          {row.trackingUrl && (
            <a href={row.trackingUrl} target="_blank" rel="noreferrer" className={styles.awbLink}>
              <ExternalLink size={14} /> Tracking
            </a>
          )}

          {row.status === "UNKNOWN" &&
            (resolvingId === row.id ? (
              <ResolveAwbForm
                shipmentId={shipmentId}
                row={row}
                onCancel={() => setResolvingId("")}
                onDone={async () => {
                  setResolvingId("");
                  await onResolved?.();
                }}
              />
            ) : (
              <button
                type="button"
                className={styles.primaryBtn}
                disabled={!!resolvingId}
                onClick={() => setResolvingId(row.id)}
              >
                Rezolvă AWB
              </button>
            ))}

          {row.audit?.length > 0 && (
            <details style={{ fontSize: 12 }}>
              <summary className={styles.muted}>Istoric ({row.audit.length})</summary>
              <ul style={{ margin: "4px 0 0", paddingLeft: 16 }}>
                {row.audit.map((a, i) => (
                  <li key={i}>
                    {a.at ? formatDate(a.at) : "—"} · {a.action} · {a.actor}
                    {a.userId ? ` (${a.userId})` : ""}
                    {a.note ? ` – ${a.note}` : ""}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      ))}
    </div>
  );
}

function withCourierAwbs(shipment, courierAwbs) {
  return { ...shipment, courierAwbs: Array.isArray(courierAwbs) ? courierAwbs : [] };
}

function KV({ label, children }) {
  return (
    <div className={styles.kv}>
      <div className={styles.kvLabel}>{label}</div>
      <div className={styles.kvValue}>{children}</div>
    </div>
  );
}

/* ----------------------------
   Normalize shipment
----------------------------- */
function normalizeShipment(s) {
  const addr = s?.order?.shippingAddress || {};
  const vendorEmail = s?.vendor?.email || s?.vendor?.user?.email || "";

  return {
    shipmentId: s.id,
    shortShipmentId: String(s.id).slice(-6).toUpperCase(),

    orderId: s.orderId,
    orderNumber: s?.order?.orderNumber || null,

    vendorId: s.vendorId,

    status: s.status,

    courierProvider: s.courierProvider || "",
    courierService: s.courierService || "",

    awb: s.awb || "",
    labelUrl: s.labelUrl || null,
    trackingUrl: s.trackingUrl || null,

    pickupScheduledAt: s.pickupScheduledAt,
    pickupDate: s.pickupDate,
    pickupSlotStart: s.pickupSlotStart,
    pickupSlotEnd: s.pickupSlotEnd,

    // ✅ NEW: timestamps for manual status
    deliveredAt: s.deliveredAt || null,
    refusedAt: s.refusedAt || null,
    returnedAt: s.returnedAt || null,

    parcels: s.parcels,
    weightKg: s.weightKg,
    dims: `${s.lengthCm || 0}x${s.widthCm || 0}x${s.heightCm || 0}`,

    customerName: addr.name || "",
    customerPhone: addr.phone || "",
    customerCity: addr.city || "",
    customerAddress:
      addr.address ||
      [addr.street, addr.city, addr.county, addr.postalCode].filter(Boolean).join(", "),

    vendorName: s.vendor?.displayName || "",
    vendorEmail,
  };
}
