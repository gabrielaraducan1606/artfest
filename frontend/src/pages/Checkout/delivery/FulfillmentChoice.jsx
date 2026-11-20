// src/pages/Checkout/delivery/FulfillmentChoice.jsx
//
// Modul de livrare pentru UN magazin (etapa 3): „Sameday prin Artfest” (doar cu
// cardul; adresă / easybox / Sameday Point) sau „Curierul magazinului” (ramburs
// sau card). Prețul fiecărei opțiuni vine din quote-ul serverului. Magazinele
// fără Sameday prin Artfest nu afișează nimic nou (doar transportul, ca înainte).
// Sameday ales, devenit indisponibil -> mesaj + reconfirmare explicită (nicio
// schimbare tăcută).

import React from "react";
import styles from "./Delivery.module.css";
import { ARTFEST_SAMEDAY, VENDOR_COURIER } from "./deliveryState.js";

const FULFILLMENT_LABELS = {
  ARTFEST_SAMEDAY: "Sameday prin Artfest",
  VENDOR_COURIER: "Curierul magazinului",
};

export const STANDARD_RATE_NOTE = "Tarif fix Artfest, fără costuri ulterioare.";

const FULFILLMENT_HINTS = {
  ARTFEST_SAMEDAY: "La adresă, easybox sau Sameday Point. Plata doar online, cu cardul.",
  VENDOR_COURIER: "Livrare la adresă, cu curierul ales de magazin. Plata ramburs sau cu cardul.",
};

/**
 * @param {Object}   props
 * @param {string}   props.groupKey
 * @param {Object}   props.quoted        intrarea magazinului din quote (readQuote) sau null
 * @param {string}   props.fulfillment   modul ales acum (din starea checkout-ului)
 * @param {Function} props.formatPrice   (opțiune) => text preț
 * @param {Function} props.onChoose      (fulfillment) => void
 * @param {Function} props.onRetry       recalculează (Sameday indisponibil temporar)
 * @param {React.ReactNode} props.children  alegerea metodei Sameday (adresă / easybox / punct)
 */
export default function FulfillmentChoice({ groupKey, quoted, fulfillment, formatPrice, onChoose, onRetry, children }) {
  const sameday = quoted?.options?.ARTFEST_SAMEDAY || null;
  const vendor = quoted?.options?.VENDOR_COURIER || null;
  const unavailable = quoted?.samedayUnavailable || null;
  // magazin fără Sameday prin Artfest: nimic nou de ales
  if (!sameday && !unavailable) return null;

  const current = unavailable ? null : fulfillment || quoted?.selectedFulfillment || null;
  const name = `fulfillment-${groupKey}`;
  const options = [
    {
      key: ARTFEST_SAMEDAY,
      disabled: !sameday?.available,
      // indisponibil: starea în titlu, explicația pe toată lățimea (fără coloană de preț îngustă pe mobil)
      price: sameday?.available && sameday?.price != null ? formatPrice(sameday) : null,
      status: sameday?.available ? null : "indisponibil momentan",
      note: !sameday?.available
        ? sameday?.message || null
        : sameday?.standardRate
          ? `${FULFILLMENT_HINTS.ARTFEST_SAMEDAY} ${STANDARD_RATE_NOTE}`
          : null,
    },
    {
      key: VENDOR_COURIER,
      // tariful magazinului lipsă: nu se poate alege (fără 0 lei afișat)
      disabled: vendor?.available === false,
      price: vendor && vendor.available !== false ? formatPrice(vendor) : null,
      status: vendor?.available === false ? "indisponibil" : null,
      note: vendor?.available === false ? vendor.message || null : null,
    },
  ];
  const vendorAvailable = vendor?.available !== false;

  return (
    <div className={styles.picker}>
      {unavailable ? (
        <div className={styles.notice} role="alert">
          <p style={{ margin: 0 }}>{unavailable.message}</p>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 8 }}>
            {vendorAvailable ? (
              <button type="button" className={styles.secondary} onClick={() => onChoose(VENDOR_COURIER)}>
                Continuă cu curierul magazinului{vendor ? ` (${formatPrice(vendor)})` : ""}
              </button>
            ) : null}
            {onRetry ? (
              <button type="button" className={styles.linkButton} onClick={onRetry}>
                Încearcă din nou
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className={styles.options} role="radiogroup" aria-label="Cine livrează comanda">
        {options.map((opt) => {
          const checked = current === opt.key;
          return (
            <label
              key={opt.key}
              className={`${styles.option} ${checked ? styles.optionActive : ""}`}
              style={opt.disabled ? { opacity: 0.6, cursor: "not-allowed" } : undefined}
            >
              <input
                type="radio"
                name={name}
                value={opt.key}
                checked={checked}
                disabled={opt.disabled}
                onChange={() => onChoose(opt.key)}
                className={styles.radio}
              />
              <span className={styles.optionText}>
                <span className={styles.optionTitle}>
                  {FULFILLMENT_LABELS[opt.key]}
                  {opt.status ? <span className={styles.optionHint}> · {opt.status}</span> : null}
                </span>
                <span className={styles.optionHint}>{opt.note || FULFILLMENT_HINTS[opt.key]}</span>
              </span>
              {opt.price ? <span className={styles.optionPrice}>{opt.price}</span> : null}
            </label>
          );
        })}
      </div>

      {current === ARTFEST_SAMEDAY && children ? (
        <div className={styles.subChoice}>
          <span className={styles.subChoiceTitle}>Unde primești coletul</span>
          {children}
        </div>
      ) : null}
    </div>
  );
}
