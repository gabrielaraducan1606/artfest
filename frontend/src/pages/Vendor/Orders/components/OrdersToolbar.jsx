// frontend/src/pages/Vendor/Orders/components/OrdersToolbar.jsx
import React from "react";
import { Link } from "react-router-dom";
import { Calendar, Download, Plus } from "lucide-react";
import styles from "../Orders.module.css";

export default function OrdersToolbar({
  onAddManual,
  onExport,
}) {
  return (
    <div className={styles.headerActions}>
      <button className={styles.primaryBtn} onClick={onAddManual}>
        <Plus size={16} /> Adaugă comandă
      </button>

      <Link to="/vendor/orders/planning" className={styles.secondaryBtn}>
        <Calendar size={16} /> Planificare
      </Link>

      <button className={styles.secondaryBtn} onClick={onExport}>
        <Download size={16} /> Export
      </button>
    </div>
  );
}
