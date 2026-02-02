// frontend/src/pages/Vendor/Orders/modals/CourierModal.jsx
import React, { useMemo, useState } from "react";
import { Loader2, PackageCheck } from "lucide-react";
import { api } from "../../../../lib/api";
import styles from "../Orders.module.css";
import { isCourierAlreadyScheduled } from "../utils/orderLocks";

export default function CourierModal({ order, onClose, onDone }) {
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

  const alreadyScheduled = useMemo(() => isCourierAlreadyScheduled(order), [order]);

  async function handleSubmit() {
    if (!order?.shipmentId || !order?.id) {
      setErr("Lipsește shipmentId / orderId pentru această comandă.");
      return;
    }

    if (alreadyScheduled) {
      setErr("Curierul este deja programat pentru această comandă.");
      return;
    }

    setSaving(true);
    setErr("");

    try {
      // 1) programează ridicarea (shipment)
      const res = await api(`/api/vendor/shipments/${order.shipmentId}/schedule-pickup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ consents, pickup, dimensions }),
      });

      // ✅ 2) patch optimist pentru listă (instant UI)
      // Ideal: backend să returneze pickupDate/slotStart/slotEnd/pickupScheduledAt.
      const nowIso = new Date().toISOString();
      const patch = {
        id: order.id,
        shipmentId: order.shipmentId,

        // UI status (list-ul tău folosește status în UI: "confirmed")
        // Oricum, după refresh va veni tot "confirmed" pentru PICKUP_SCHEDULED
        status: "confirmed",

        pickupDate: res?.pickupDate || nowIso,
        pickupSlotStart: res?.pickupSlotStart || null,
        pickupSlotEnd: res?.pickupSlotEnd || null,

        // pentru chip "Așteptăm AWB"
        pickupScheduledAt: res?.pickupScheduledAt || nowIso,

        // încă nu ai awb/label
        awb: null,
        labelUrl: null,
      };

      // ✅ 3) închide imediat modalul
      onClose?.();

      // ✅ 4) update imediat în OrdersPage
      onDone?.(patch);
    } catch (e) {
      setErr(e?.message || "Eroare necunoscută");
    } finally {
      setSaving(false);
    }
  }

  if (!order) return null;

  return (
    <div className={styles.modalBackdrop} role="dialog" aria-modal="true">
      <div className={styles.modal}>
        <div className={styles.modalHead}>
          <h3>Confirmare predare & curier</h3>
          <button className={styles.iconBtn} onClick={onClose} aria-label="Închide" disabled={saving}>
            ×
          </button>
        </div>

        <fieldset className={styles.fieldset}>
          <legend>Acorduri curier</legend>

          <Check
            label="Sunt de acord să transmiteți către curier datele clientului și ale expediției (GDPR)."
            checked={consents.gdprProcessing}
            onChange={(v) => setConsents((s) => ({ ...s, gdprProcessing: v }))}
          />
          <Check
            label="Confirm că marfa este ambalată corespunzător conform ghidului curierului."
            checked={consents.properPackaging}
            onChange={(v) => setConsents((s) => ({ ...s, properPackaging: v }))}
          />
          <Check
            label="Conține obiecte fragile (curierul va nota 'fragil')."
            checked={consents.fragile}
            onChange={(v) => setConsents((s) => ({ ...s, fragile: v }))}
          />
          <Check
            label="Accept valoarea declarată și condițiile de răspundere ale curierului."
            checked={consents.declaredValue}
            onChange={(v) => setConsents((s) => ({ ...s, declaredValue: v }))}
          />
          <Check
            label="Accept politica de retur pentru colete nelivrate/refuzate."
            checked={consents.returnPolicyAck}
            onChange={(v) => setConsents((s) => ({ ...s, returnPolicyAck: v }))}
          />
          <Check
            label="Accept ca șoferul să mă contacteze telefonic la preluare."
            checked={consents.canCallDriver}
            onChange={(v) => setConsents((s) => ({ ...s, canCallDriver: v }))}
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
                onChange={(e) => setPickup((v) => ({ ...v, day: e.target.value }))}
              />{" "}
              Azi
            </label>

            <label className={styles.radio}>
              <input
                type="radio"
                name="day"
                value="tomorrow"
                checked={pickup.day === "tomorrow"}
                onChange={(e) => setPickup((v) => ({ ...v, day: e.target.value }))}
              />{" "}
              Mâine
            </label>
          </div>

          <select
            className={styles.select}
            value={pickup.slot}
            onChange={(e) => setPickup((v) => ({ ...v, slot: e.target.value }))}
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
                  setDimensions((v) => ({ ...v, parcels: Number(e.target.value) || 1 }))
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
                  setDimensions((v) => ({ ...v, weightKg: Number(e.target.value) || 0 }))
                }
              />
            </label>

            <label>
              Dimensiuni (cm){" "}
              <input
                type="text"
                value={`${dimensions.l}x${dimensions.w}x${dimensions.h}`}
                onChange={(e) => {
                  const [l, w, h] = String(e.target.value)
                    .split("x")
                    .map((n) => Number(n) || 0);
                  setDimensions((v) => ({ ...v, l, w, h }));
                }}
              />
            </label>
          </div>
        </fieldset>

        {alreadyScheduled && (
          <p className={styles.muted} style={{ marginTop: 8 }}>
            Curierul este deja programat pentru această comandă (ai deja AWB sau perioadă de ridicare).
          </p>
        )}

        {err && <p className={styles.error}>{err}</p>}

        <div className={styles.modalActions}>
          <button className={styles.secondaryBtn} onClick={onClose} disabled={saving}>
            Anulează
          </button>

          <button
            className={styles.primaryBtn}
            onClick={handleSubmit}
            disabled={saving || alreadyScheduled}
            title={alreadyScheduled ? "Curierul este deja programat" : "Programează curierul"}
          >
            {saving ? <Loader2 className={styles.spin} size={16} /> : <PackageCheck size={16} />}{" "}
            Programează curierul
          </button>
        </div>

        <p className={styles.muted}>
          După programare, comanda se blochează până primești AWB-ul de la admin.
        </p>
      </div>
    </div>
  );
}

function Check({ label, checked, onChange }) {
  return (
    <label className={styles.check}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />{" "}
      {label}
    </label>
  );
}
