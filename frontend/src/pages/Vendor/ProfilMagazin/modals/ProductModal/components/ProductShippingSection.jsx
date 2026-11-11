import styles from "../../../components/css/ProductModal.module.css";
import own from "./ProductShippingSection.module.css";
import { SHIPPING_MESSAGES } from "../../../../../../../../backend/src/lib/productShipping.js";

/*
 * „Livrare și colet”: profilul logistic al produsului AMBALAT, gata de
 * expediere (calculul transportului Sameday), separat de „Dimensiuni” din
 * detalii (produsul descris clientului). Validarea finală e pe server
 * (backend/src/lib/productShipping.js); aici doar câmpuri numerice.
 *
 * requirement: "required" (produs nou, checkout Sameday) | "recommended" | "none".
 */
const DIMENSIONS = [
  { field: "shippingLengthCm", id: "product-shipping-length", label: "Lungime" },
  { field: "shippingWidthCm", id: "product-shipping-width", label: "Lățime" },
  { field: "shippingHeightCm", id: "product-shipping-height", label: "Înălțime" },
];

// doar cifre (fără zecimale / semne): grame și centimetri întregi
const digitsOnly = (value) => String(value ?? "").replace(/\D+/g, "").slice(0, 6);

export default function ProductShippingSection({ form, setForm, requirement = "none", hasOptions = false, isQuoteOnly = false }) {
  const setField = (field) => (e) => {
    const value = digitsOnly(e.target.value);
    setForm((prev) => ({ ...prev, [field]: value }));
  };
  const weight = String(form?.shippingWeightGrams ?? "").trim();
  const required = requirement === "required";
  const showMissing = requirement === "recommended" && !weight;

  return (
    <div id="manual-section-shipping" className={styles.fieldGroup}>
      <strong className={styles.orderConfigTitle}>Livrare și colet</strong>

      <div className={styles.tip}>
        Datele produsului <strong>ambalat, gata de expediere</strong> (cu cutie și protecție). Le folosim ca să
        calculăm automat costul transportului Sameday. Nu sunt dimensiunile afișate clienților.
      </div>

      {showMissing ? (
        <p className={own.warning} role="status">
          {isQuoteOnly ? SHIPPING_MESSAGES.weightRecommendedQuote : SHIPPING_MESSAGES.weightMissingPublished}
        </p>
      ) : null}

      <label className={styles.label} htmlFor="product-shipping-weight">
        Greutatea coletului (produsul pregătit pentru expediere){required ? " *" : ""}
      </label>
      <div className={own.unitInput}>
        <input
          id="product-shipping-weight"
          className={styles.input}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          value={form?.shippingWeightGrams ?? ""}
          onChange={setField("shippingWeightGrams")}
          placeholder="Ex: 450"
          aria-required={required}
          aria-describedby="product-shipping-weight-hint"
        />
        <span className={own.unit} aria-hidden="true">g</span>
      </div>
      <div id="product-shipping-weight-hint" className={styles.tip}>
        Cântărește produsul împachetat, în grame (1 kg = 1000 g).
        {hasOptions ? " Dacă opțiunile schimbă greutatea, introdu greutatea celei mai grele variante." : ""}
      </div>

      <span className={styles.label}>Dimensiunile coletului (opțional)</span>
      <div className={own.dims}>
        {DIMENSIONS.map(({ field, id, label }) => (
          <div key={field} className={own.dimField}>
            <label className={styles.tip} htmlFor={id}>
              {label}
            </label>
            <div className={own.unitInput}>
              <input
                id={id}
                className={styles.input}
                type="text"
                inputMode="numeric"
                autoComplete="off"
                value={form?.[field] ?? ""}
                onChange={setField(field)}
                placeholder="cm"
              />
              <span className={own.unit} aria-hidden="true">cm</span>
            </div>
          </div>
        ))}
      </div>
      <div className={styles.tip}>
        Măsoară cutia în care trimiți produsul. Completează toate cele trei sau lasă-le goale; ajută la alegerea
        compartimentului easybox.
      </div>
    </div>
  );
}
