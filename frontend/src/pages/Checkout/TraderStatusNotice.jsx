// src/pages/Checkout/TraderStatusNotice.jsx
//
// Statutul Vânzătorului afișat în blocul fiecărui magazin din checkout
// (user și guest), înainte de plasarea Comenzii. Status necunoscut/invalid
// -> nu randează nimic (fără excepții).

import styles from "./Checkout.module.css";
import {
  NON_PROFESSIONAL_WARNING,
  TRADER_NON_PROFESSIONAL,
  getTraderStatusLabel,
  normalizeTraderStatus,
} from "../../utils/traderStatus.js";

export default function TraderStatusNotice({ status }) {
  const normalized = normalizeTraderStatus(status);
  const label = getTraderStatusLabel(normalized);

  if (!label) return null;

  return (
    <div className={styles.traderInfo} data-trader-status={normalized}>
      <span className={styles.traderBadge}>{label}</span>

      {normalized === TRADER_NON_PROFESSIONAL && (
        <p className={styles.traderNote} role="note">
          {NON_PROFESSIONAL_WARNING}
        </p>
      )}
    </div>
  );
}
