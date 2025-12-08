// src/pages/Admin/AdminDesktop/AdminProductsTab.jsx
import styles from "../AdminDesktop.module.css";

export default function AdminProductsTab({ products }) {
  if (!products?.length) {
    return (
      <p className={styles.subtle}>
        Nu există produse sau nu au fost încărcate.
      </p>
    );
  }

  return (
    <div className={styles.tableWrapper}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Titlu</th>
            <th>Vendor</th>
            <th>Acorduri vendor</th> {/* 👈 NOU */}
            <th>Serviciu</th>
            <th>Preț</th>
            <th>Disponibilitate</th>
            <th>Activ</th>
            <th>Ascuns</th>
            <th>Popularitate</th>
            <th># Favorite</th>
            <th># Reviews</th>
            <th># Comentarii</th>
            <th>Creat la</th>
          </tr>
        </thead>
        <tbody>
          {products.map((p) => {
            const svc = p.service;
            const vendor = svc?.vendor;
            const counts = p._count || {};

            const ag = vendor?.agreementsSummary;
            const agreementsLabel = ag
              ? ag.allRequired
                ? "OK"
                : "Lipsește"
              : "—";

            const agreementsTitle = ag
              ? ag.allRequired
                ? `Toate acordurile obligatorii sunt acceptate. Ultima acceptare: ${
                    ag.lastAcceptedAt
                      ? new Date(ag.lastAcceptedAt).toLocaleString("ro-RO")
                      : "n/a"
                  }`
                : `Lipsesc: ${ag.missingDocs?.join(", ") || "—"}`
              : "Nu există informații despre acorduri pentru acest vendor.";

            return (
              <tr key={p.id}>
                <td>{p.title}</td>
                <td>{vendor?.displayName || "—"}</td>

                {/* 👇 NOU: status acorduri vendor pentru produsul respectiv */}
                <td title={agreementsTitle}>{agreementsLabel}</td>

                <td>{svc?.title || "—"}</td>
                <td>
                  {p.priceCents != null
                    ? `${(p.priceCents / 100).toFixed(2)} ${
                        p.currency || "RON"
                      }`
                    : "—"}
                </td>
                <td>{p.availability}</td>
                <td>{p.isActive ? "Da" : "Nu"}</td>
                <td>{p.isHidden ? "Da" : "Nu"}</td>
                <td>{p.popularityScore ?? 0}</td>
                <td>{counts.Favorite ?? 0}</td>
                <td>{counts.reviews ?? 0}</td>
                <td>{counts.comments ?? 0}</td>
                <td>
                  {p.createdAt
                    ? new Date(p.createdAt).toLocaleString("ro-RO")
                    : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
