// src/features/smartListing/SmartListingDevLink.jsx
//
// TEMPORAR - butonul „Previzualizează formularul” din Admin → Produse.
// Apare DOAR în `npm run dev` (import.meta.env.DEV e false la `vite build`,
// deci codul dispare din bundle-ul de producție) și doar cu
// VITE_SMART_LISTING_ENABLED=1 (frontend/.env.development.local).
// Tabul Admin e deja protejat de RequireAdmin. Admin vede formularul în mod
// previzualizare; produsele se creează doar din conturi de vânzător de test.
// Deschide formularul separat, într-un tab nou - ProductModal rămâne neatins.

function isOn(value) {
  const raw = String(value ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true";
}

export default function SmartListingDevLink() {
  // `import.meta.env.DEV` e înlocuit static de Vite -> eliminat din producție
  if (!import.meta.env.DEV || !isOn(import.meta.env.VITE_SMART_LISTING_ENABLED)) return null;

  return (
    <div
      role="note"
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: "8px 12px",
        margin: "0 0 12px",
        padding: "10px 12px",
        border: "1px dashed var(--border-strong, #d1d5db)",
        borderRadius: "var(--radius, 10px)",
        background: "var(--surface-muted, #f2f2f3)",
        color: "var(--color-text)",
        fontSize: "0.85rem",
      }}
    >
      <span>
        <strong>Doar local:</strong> Smart Listing în previzualizare. Nimic nu se încarcă și nu se salvează; produsele se
        creează din contul de vânzător.
      </span>
      <a
        href="/vendor/produs-nou"
        target="_blank"
        rel="noopener noreferrer"
        style={{
          marginLeft: "auto",
          padding: "8px 14px",
          borderRadius: "var(--radius, 10px)",
          background: "var(--color-primary)",
          color: "var(--on-primary, #fff)",
          fontWeight: 700,
          textDecoration: "none",
          whiteSpace: "nowrap",
        }}
      >
        Previzualizează formularul
      </a>
    </div>
  );
}
