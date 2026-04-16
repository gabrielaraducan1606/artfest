import React from "react";

export default function StoreActivationBadge({
  isOwner,
  isActive,
  onActivate,
  busy,
}) {
  if (!isOwner) return null;

  if (isActive) {
    return (
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          padding: "6px 10px",
          borderRadius: 999,
          border: "1px solid #86EFAC",
          background: "#F0FDF4",
          color: "#166534",
          fontSize: 12,
          fontWeight: 800,
          lineHeight: 1,
          whiteSpace: "nowrap",
          marginTop: 8,
        }}
        title="Magazinul este activ și vizibil utilizatorilor"
      >
        ● Public
      </span>
    );
  }

  return (
    <div
      role="note"
      aria-label="Magazin dezactivat"
      style={{
        marginTop: 8,
        padding: 12,
        borderRadius: 10,
        border: "1px solid #F59E0B",
        background: "#FFFBEB",
        color: "#92400E",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 900, marginBottom: 2 }}>
          Magazin dezactivat
        </div>
        <div style={{ fontSize: 13 }}>
          Magazinul <b>nu este vizibil utilizatorilor</b> până când îl activezi.
        </div>
      </div>

      <button
        type="button"
        onClick={onActivate}
        disabled={busy}
        style={{
          flex: "0 0 auto",
          padding: "10px 12px",
          borderRadius: 10,
          border: "1px solid #F59E0B",
          background: "#F59E0B",
          color: "#111827",
          fontWeight: 900,
          cursor: busy ? "not-allowed" : "pointer",
          opacity: busy ? 0.7 : 1,
          whiteSpace: "nowrap",
        }}
        title="Activează magazinul ca să apară în căutări"
      >
        {busy ? "Se activează…" : "Activează"}
      </button>
    </div>
  );
}