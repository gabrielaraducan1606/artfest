import React from "react";

export default function OwnerStoresSwitcher({
  isOwner,
  stores,
  currentSlug,
  loading,
  onGoToStore,
  onAddStore,
}) {
  if (!isOwner) return null;
  if (loading) return null;
  if (!Array.isArray(stores)) return null;

  return (
    <div
      style={{
        marginTop: 12,
        display: "flex",
        flexWrap: "wrap",
        gap: 8,
        alignItems: "center",
      }}
    >
      <span style={{ fontSize: 13, fontWeight: 800, color: "#374151" }}>
        Magazinele mele:
      </span>

      {stores.map((store) => {
        const active = store.slug === currentSlug;

        return (
          <button
            key={store.id}
            type="button"
            onClick={() => onGoToStore(store)}
            style={{
              padding: "8px 12px",
              borderRadius: 999,
              border: active ? "1px solid #111827" : "1px solid #D1D5DB",
              background: active ? "#111827" : "#FFFFFF",
              color: active ? "#FFFFFF" : "#111827",
              fontWeight: 700,
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
            }}
            title={store.label}
          >
            <span>{store.label}</span>
            <span style={{ opacity: 0.8, fontSize: 12 }}>
              {store.isActive ? "●" : "○"}
            </span>
          </button>
        );
      })}

      <button
        type="button"
        onClick={onAddStore}
        style={{
          padding: "8px 12px",
          borderRadius: 999,
          border: "1px dashed #9CA3AF",
          background: "#F9FAFB",
          color: "#111827",
          fontWeight: 700,
          cursor: "pointer",
        }}
      >
        + Magazin nou
      </button>
    </div>
  );
}