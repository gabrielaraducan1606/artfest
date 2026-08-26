// src/pages/Vendor/CostsProfit/components/VendorProductPicker.jsx

import { formatRonFromCents } from "../formatMoney.js";

/**
 * Listă de până la 5 produse ale vendorului, pentru
 * dezambiguizare - folosită din Vendor Assistant când o
 * căutare după nume întoarce mai multe rezultate, sau când
 * vendorul alege să asocieze un calcul din fotografie unui
 * produs existent.
 */
export default function VendorProductPicker({
  title = "Care produs?",
  hint = "",
  products = [],
  loading = false,
  error = "",
  onSelect,
  onBack,
}) {
  return (
    <div style={wrapperStyle}>
      <div style={headerRowStyle}>
        <strong style={{ fontSize: 14 }}>
          {title}
        </strong>

        {onBack && (
          <button
            type="button"
            onClick={onBack}
            style={linkBtnStyle}
          >
            Renunță
          </button>
        )}
      </div>

      {hint && (
        <p style={hintStyle}>{hint}</p>
      )}

      {loading && (
        <div style={emptyStyle}>Caut produse...</div>
      )}

      {!loading && error && (
        <div style={errorStyle}>{error}</div>
      )}

      {!loading && !error && products.length === 0 && (
        <div style={emptyStyle}>
          Nu am găsit niciun produs.
        </div>
      )}

      {!loading && products.length > 0 && (
        <div style={listStyle}>
          {products.map((product) => (
            <button
              key={product.productId}
              type="button"
              onClick={() =>
                onSelect?.(product)
              }
              style={cardStyle}
            >
              {product.image ? (
                <img
                  src={product.image}
                  alt=""
                  style={thumbStyle}
                />
              ) : (
                <div
                  style={thumbPlaceholderStyle}
                />
              )}

              <span style={infoStyle}>
                <span style={titleStyle}>
                  {product.title}
                </span>

                <small
                  style={{
                    color:
                      "var(--color-muted, #6b7280)",
                  }}
                >
                  {formatRonFromCents(
                    product.priceCents
                  )}
                  {product.hasCosting
                    ? product.costingStatus ===
                      "CONFIRMED"
                      ? " · costing confirmat"
                      : " · costing draft"
                    : " · fără costing"}
                </small>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const wrapperStyle = {
  padding: 4,
};

const headerRowStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  marginBottom: 6,
};

const linkBtnStyle = {
  border: 0,
  background: "transparent",
  color: "var(--color-primary, #8b5cf6)",
  fontWeight: 700,
  fontSize: 12.5,
  cursor: "pointer",
  padding: 0,
};

const hintStyle = {
  fontSize: 12.5,
  color: "var(--color-muted, #6b7280)",
  marginTop: 0,
  marginBottom: 10,
};

const emptyStyle = {
  fontSize: 13,
  color: "var(--color-muted, #6b7280)",
  padding: "10px 0",
};

const errorStyle = {
  color: "var(--color-danger, #dc2626)",
  fontSize: 12.5,
  padding: "6px 0",
};

const listStyle = {
  display: "flex",
  flexDirection: "column",
  gap: 8,
};

const cardStyle = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  border: "1px solid var(--color-border, #e5e5e5)",
  borderRadius: 12,
  padding: 10,
  background: "var(--surface, #ffffff)",
  cursor: "pointer",
  textAlign: "left",
  width: "100%",
};

const thumbStyle = {
  width: 40,
  height: 40,
  borderRadius: 8,
  objectFit: "cover",
  flexShrink: 0,
  border: "1px solid var(--color-border, #e5e5e5)",
};

const thumbPlaceholderStyle = {
  ...thumbStyle,

  background:
    "color-mix(in srgb, var(--color-muted, #6b7280) 15%, transparent)",
};

const infoStyle = {
  display: "flex",
  flexDirection: "column",
  gap: 2,
  minWidth: 0,
};

const titleStyle = {
  fontSize: 13.5,
  fontWeight: 700,
  color: "var(--color-text, #2d2d2d)",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};
