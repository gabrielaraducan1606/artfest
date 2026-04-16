import React from "react";

export default function OwnerWarningBanner({
  missingProfile = [],
  missingBilling = [],
  noSub = false,
}) {
  if (!noSub && !missingProfile.length && !missingBilling.length) return null;

  return (
    <div
      role="note"
      aria-label="Completează configurarea magazinului"
      style={{
        margin: "12px 0 16px",
        padding: 12,
        border: "1px solid #F59E0B",
        background: "#FFFBEB",
        color: "#92400E",
        borderRadius: 8,
      }}
    >
      <strong style={{ display: "block", marginBottom: 6 }}>
        Configurare incompletă
      </strong>

      {noSub && (
        <div style={{ marginBottom: 6 }}>
          Nu ai un <b>abonament activ</b>.{" "}
          <a href="/onboarding/details?tab=plata&solo=1">
            Activează abonamentul
          </a>
          .
        </div>
      )}

      {missingProfile.length > 0 && (
        <div style={{ marginBottom: 6 }}>
          Din <b>Profil servicii</b> lipsesc: {missingProfile.join(", ")}.{" "}
          <a href="/onboarding/details?tab=profil&solo=1">
            Completează acum
          </a>
          .
        </div>
      )}

      {missingBilling.length > 0 && (
        <div>
          Din <b>Date facturare</b> lipsesc: {missingBilling.join(", ")}.{" "}
          <a href="/onboarding/details?tab=facturare">Completează acum</a>.
        </div>
      )}
    </div>
  );
}