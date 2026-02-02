// frontend/src/pages/Vendor/Orders/components/OrdersFiltersModal.jsx
import React from "react";
import { Calendar, Filter, RefreshCw } from "lucide-react";
import styles from "../Orders.module.css";
import { STATUS_OPTIONS } from "../utils/constants";

export default function OrdersFiltersModal({
  open,
  onClose,
  status,
  setStatus,
  from,
  setFrom,
  to,
  setTo,
  onReset,
}) {
  if (!open) return null;

  return (
    <div className={styles.modalBackdrop} role="dialog" aria-modal="true">
      <div className={styles.modal}>
        <div className={styles.modalHead}>
          <h3>Filtre comenzi</h3>
          <button className={styles.iconBtn} onClick={onClose} aria-label="Închide">
            ×
          </button>
        </div>

        <div className={styles.modalBody}>
          <fieldset className={styles.fieldset}>
            <legend>Status comandă</legend>
            <div className={styles.selectWrap}>
              <Filter size={16} />
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className={styles.select}
              >
                {STATUS_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          </fieldset>

          <fieldset className={styles.fieldset}>
            <legend>Interval de timp</legend>
            <div className={styles.grid3}>
              <label>
                De la data
                <div className={styles.dateWrap}>
                  <Calendar size={16} />
                  <input
                    type="date"
                    value={from}
                    onChange={(e) => setFrom(e.target.value)}
                    className={styles.input}
                  />
                </div>
              </label>

              <label>
                Până la data
                <div className={styles.dateWrap}>
                  <Calendar size={16} />
                  <input
                    type="date"
                    value={to}
                    onChange={(e) => setTo(e.target.value)}
                    className={styles.input}
                  />
                </div>
              </label>

              <div />
            </div>
          </fieldset>
        </div>

        <div className={styles.modalActions}>
          <button className={styles.secondaryBtn} onClick={onReset}>
            <RefreshCw size={16} /> Resetează filtrele
          </button>
          <button className={styles.primaryBtn} onClick={onClose}>
            Aplică filtrele
          </button>
        </div>
      </div>
    </div>
  );
}
