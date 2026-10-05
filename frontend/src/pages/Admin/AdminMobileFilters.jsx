// src/pages/Admin/AdminMobileFilters.jsx
//
// Filtrele unei pagini admin: pe desktop - exact ca înainte (children
// randați direct); pe mobil - ascunse în spatele butonului „Filtre (N)”,
// cu Reset și Aplică. Filtrele rămân controlate de pagină (aceleași state-uri
// și aceleași cereri) - „Aplică” doar închide panoul.
// Stilurile: adminMobile.css (.admin-filters*).

import { useState } from "react";

export default function AdminMobileFilters({ activeCount = 0, onReset, children, label = "Filtre" }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="admin-filters" data-open={open ? "true" : "false"}>
      <button
        type="button"
        className="admin-filters__toggle"
        aria-expanded={open ? "true" : "false"}
        onClick={() => setOpen((v) => !v)}
      >
        {label}
        {activeCount > 0 ? <span className="admin-filters__badge">{activeCount}</span> : null}
      </button>

      <div className="admin-filters__panel">
        {children}

        <div className="admin-filters__mobile-actions">
          <button
            type="button"
            className="admin-filters__reset"
            onClick={() => {
              onReset?.();
            }}
          >
            Reset
          </button>
          <button type="button" className="admin-filters__apply" onClick={() => setOpen(false)}>
            Aplică
          </button>
        </div>
      </div>
    </div>
  );
}
