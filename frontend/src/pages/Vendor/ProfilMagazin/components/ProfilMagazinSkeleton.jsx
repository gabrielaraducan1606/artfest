import React from "react";
import styles from "../ProfilMagazin.module.css";

const bar = (h, w = "100%") => ({
  height: h,
  width: w,
  borderRadius: 8,
  background: "rgba(120,120,120,0.15)",
});

/**
 * `preview` (opțional) - summary minim trimis la navigare (StoresPage,
 * "Vândut de" din ProductDetails): { slug, shopName, profileImageUrl,
 * rating?, shortDescription? }. Folosit DOAR pentru primul paint -
 * fetch-ul real din useProfilMagazin pornește oricum necondiționat și
 * rămâne singura sursă de adevăr pentru produse/preț/atribuire.
 */
export default function ProfilMagazinSkeleton({ preview }) {
  return (
    <div className={styles.wrapper} style={{ padding: "1rem" }}>
      <div
        style={{
          height: 220,
          borderRadius: 12,
          background: "rgba(120,120,120,0.12)",
        }}
      />

      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          gap: 16,
          marginTop: -48,
          padding: "0 8px",
        }}
      >
        {preview?.profileImageUrl ? (
          <img
            src={preview.profileImageUrl}
            alt=""
            width={96}
            height={96}
            loading="eager"
            fetchPriority="high"
            decoding="async"
            style={{
              width: 96,
              height: 96,
              borderRadius: "50%",
              objectFit: "cover",
              border: "3px solid var(--surface, #fff)",
              background: "#fff",
            }}
          />
        ) : (
          <div
            style={{
              width: 96,
              height: 96,
              borderRadius: "50%",
              background: "rgba(120,120,120,0.18)",
              border: "3px solid var(--surface, #fff)",
              flexShrink: 0,
            }}
          />
        )}

        <div style={{ flex: 1, paddingBottom: 8 }}>
          {preview?.shopName ? (
            <h1 style={{ fontSize: "1.4rem", margin: "0 0 6px" }}>
              {preview.shopName}
            </h1>
          ) : (
            <div style={{ ...bar(24, "45%"), marginBottom: 8 }} />
          )}

          {typeof preview?.rating === "number" ? (
            <div style={{ fontSize: "0.9rem", opacity: 0.7 }}>
              ★ {preview.rating.toFixed(1)}
            </div>
          ) : (
            <div style={bar(14, "20%")} />
          )}
        </div>
      </div>

      <div style={{ padding: "16px 8px 0" }}>
        {preview?.shortDescription ? (
          <p style={{ fontSize: "0.9rem", opacity: 0.8, margin: 0 }}>
            {preview.shortDescription}
          </p>
        ) : (
          <>
            <div style={{ ...bar(12, "90%"), marginBottom: 6 }} />
            <div style={bar(12, "60%")} />
          </>
        )}
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
          gap: 12,
          marginTop: 24,
        }}
      >
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i}>
            <div style={{ ...bar(160), marginBottom: 8, borderRadius: 12 }} />
            <div style={{ ...bar(12, "80%"), marginBottom: 6 }} />
            <div style={bar(12, "40%")} />
          </div>
        ))}
      </div>
    </div>
  );
}
