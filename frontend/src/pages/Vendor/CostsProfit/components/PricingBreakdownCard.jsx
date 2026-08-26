// src/pages/Vendor/CostsProfit/components/PricingBreakdownCard.jsx

import React from "react";
import { formatRon } from "../formatMoney.js";

/* =========================================================
   Componentă comună pentru cardul cu cele 7 rezultate ale
   calculului de preț - folosită atât de calculatorul
   conversațional (VendorPriceCalculator), cât și de pagina
   de detaliu costing per produs, ca să nu existe două
   implementări ale aceluiași card.

   Acceptă tolerant două forme de `pricing`, fiindcă cele
   două rute backend le întorc puțin diferit:
   - chat (/api/ai/price-calculator/turn): pricing.commission = { percent, planName }
   - REST (/api/vendor/products/:id/costing): pricing.commissionPercent (fără planName)
========================================================= */

const cardStyle = {
  border: "1px solid var(--color-border, #e5e5e5)",
  borderRadius: 14,
  padding: 14,
  background: "var(--surface, #ffffff)",
  marginTop: 6,
  marginBottom: 12,
};

const cardTitleStyle = {
  display: "block",
  marginBottom: 10,
  fontSize: 14,
  fontWeight: 700,
  color: "var(--color-text, #2d2d2d)",
};

const dividerStyle = {
  margin: "6px 0",
  border: 0,
  borderTop: "1px solid var(--color-border, #e5e5e5)",
};

function rowStyle({ strong = false, accent = false } = {}) {
  return {
    display: "flex",
    justifyContent: "space-between",
    gap: 10,
    padding: "5px 0",
    fontSize: 13.5,
    fontWeight: strong ? 700 : 400,

    color: accent
      ? "var(--color-primary, #8b5cf6)"
      : "var(--color-text, #2d2d2d)",
  };
}

export default function PricingBreakdownCard({
  pricing,
  title = "Rezultatul calculului",
}) {
  if (!pricing) {
    return null;
  }

  const commissionPercent =
    pricing.commission?.percent ??
    pricing.commissionPercent ??
    0;

  const planName =
    pricing.commission?.planName || null;

  return (
    <div style={cardStyle}>
      <strong style={cardTitleStyle}>{title}</strong>

      <div style={rowStyle()}>
        <span>Cost materiale</span>
        <span>{formatRon(pricing.materialsCost)}</span>
      </div>

      <div style={rowStyle()}>
        <span>Cost manoperă</span>
        <span>{formatRon(pricing.laborCost)}</span>
      </div>

      <hr style={dividerStyle} />

      <div style={rowStyle({ strong: true })}>
        <span>Cost total real</span>
        <span>{formatRon(pricing.totalRealCost)}</span>
      </div>

      <hr style={dividerStyle} />

      <div style={rowStyle()}>
        <span>Preț minim (fără pierdere)</span>
        <span>{formatRon(pricing.minPrice)}</span>
      </div>

      <div style={rowStyle({ strong: true, accent: true })}>
        <span>Preț recomandat</span>
        <span>{formatRon(pricing.recommendedPrice)}</span>
      </div>

      <hr style={dividerStyle} />

      <div style={rowStyle()}>
        <span>Profit estimat</span>
        <span>{formatRon(pricing.estimatedProfit)}</span>
      </div>

      <div style={rowStyle({ strong: true })}>
        <span>Îți rămâne ție (după comision)</span>
        <span>
          {formatRon(pricing.vendorNetAfterCommission)}
        </span>
      </div>

      <small
        style={{
          display: "block",
          marginTop: 10,
          color: "var(--color-muted, #6b7280)",
        }}
      >
        {planName ? `Plan ${planName} · ` : ""}
        comision Artfest {commissionPercent}% din prețul
        de vânzare, calculat la prețul recomandat.
      </small>
    </div>
  );
}
