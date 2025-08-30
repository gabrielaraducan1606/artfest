import React from "react";
import { Separator } from "../../../components/ui/separator/separator";
import { Button } from "../../../components/ui/Button/Button";
import { Truck } from "lucide-react";

const defaultCurrency = (n) => `${Number(n || 0).toFixed(2)} lei`;

/**
 * Props:
 * - merchandise, discount, vat (opțional), shipping, total
 * - shippingBreakdown?: [{ sellerId, shopName, shipping, method, etaDays }]
 * - isPickup, setIsPickup
 * - styles
 * - ctaLabel, onCtaClick
 * - currency? (funcție)
 */
export default function SummaryCard({
  merchandise, discount, vat, shipping, total,
  shippingBreakdown = [],
  isPickup, setIsPickup,
  styles, ctaLabel = "Plasează comanda", onCtaClick,
  currency = defaultCurrency
}) {
  return (
    <div className={`${styles.card} ${styles.padded} ${styles.summaryCard}`}>
      <div className={styles.titleRow}>
        <Truck className={styles.icon4} />
        <div className={styles.titleBase}>Rezumat comandă</div>
      </div>

      <div className={styles.stackMd} style={{ marginTop: 12 }}>
        <Row label="Produse" value={currency(merchandise)} />
        {discount > 0 && <Row label="Reducere" value={`- ${currency(discount)}`} />}
        <Separator className={styles.summarySep} />

        {shippingBreakdown?.length > 0 ? (
          <div>
            <div className={styles.textSm} style={{ fontWeight: 600, marginBottom: 6 }}>
              Transport pe magazin
            </div>
            <div className={styles.stackMd}>
              {shippingBreakdown.map((b) => (
                <div key={b.sellerId} className={styles.rowBetween}>
                  <div className={styles.textSm}>
                    {b.shopName} — {b.method === "pickup" ? "Ridicare" : "Curier"}
                    {Number.isFinite(b.etaDays) ? ` · ${b.etaDays} zile` : ""}
                  </div>
                  <div className={`${styles.textSm} ${styles.semi}`}>{currency(b.shipping)}</div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <Row label="Transport" value={currency(shipping)} />
        )}

        <Separator className={styles.summarySep} />
        {Number.isFinite(vat) && <Row label="TVA (informativ)" value={currency(vat)} muted />}
        <Row label="Total" value={currency(total)} strong />

        <div className={styles.rowBetween} style={{ marginTop: 8 }}>
          <label className={styles.textSm}>
            <input
              type="checkbox"
              checked={isPickup}
              onChange={(e) => setIsPickup?.(e.target.checked)}
              style={{ marginRight: 8 }}
            />
            Ridicare personală (acolo unde este disponibil)
          </label>
          <Button className={styles.btnPrimary} onClick={onCtaClick}>{ctaLabel}</Button>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, strong, muted }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between" }}>
      <div style={{ opacity: muted ? 0.7 : 1, fontWeight: strong ? 600 : 500 }}>{label}</div>
      <div style={{ fontWeight: strong ? 700 : 600 }}>{value}</div>
    </div>
  );
}
