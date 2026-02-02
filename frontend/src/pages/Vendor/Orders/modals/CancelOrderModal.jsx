// frontend/src/pages/Vendor/Orders/modals/CancelOrderModal.jsx
import React, { useState } from "react";
import { Loader2, XCircle } from "lucide-react";
import { api } from "../../../../lib/api";
import styles from "../Orders.module.css";

const CANCEL_REASONS = [
  { value: "client_no_answer", label: "Clientul nu răspunde la telefon" },
  { value: "client_request", label: "Clientul a solicitat anularea" },
  { value: "stock_issue", label: "Produs indisponibil / stoc epuizat" },
  { value: "address_issue", label: "Adresă incompletă / imposibil de livrat" },
  { value: "payment_issue", label: "Probleme cu plata" },
  { value: "other", label: "Alt motiv" },
];

export default function CancelOrderModal({ order, onClose, onCancelled }) {
  const [reason, setReason] = useState("client_no_answer");
  const [otherReason, setOtherReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  if (!order) return null;

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
      setErr(e?.message || "Nu am putut anula comanda. Încearcă din nou.");
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
          <button className={styles.iconBtn} onClick={onClose} aria-label="Închide">
            ×
          </button>
        </div>

        <div className={styles.modalBody}>
          <p className={styles.muted}>
            Comanda va fi marcată ca <strong>„Anulată”</strong>. Clientul va primi
            automat un mesaj în inbox și un email cu motivul selectat.
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
          <button className={styles.secondaryBtn} onClick={onClose} disabled={saving}>
            Închide
          </button>

          <button className={styles.primaryBtn} onClick={handleSubmit} disabled={saving}>
            {saving ? (
              <Loader2 size={16} className={styles.spin} />
            ) : (
              <>
                <XCircle size={16} /> Confirmă anularea
              </>
            )}
          </button>
        </div>

        <p className={styles.muted}>
          Acțiunea nu poate fi reversată din interfață. Pentru reactivare va fi nevoie de o nouă comandă.
        </p>
      </div>
    </div>
  );
}
