// src/pages/Admin/AdminDesktop/tabs/AdminProductsTab.jsx
import { useMemo, useState } from "react";
import styles from "../css/AdminProductsTab.module.css";

function formatPrice(value, currency = "RON") {
  const n = Number(value || 0);
  try {
    return new Intl.NumberFormat("ro-RO", {
      style: "currency",
      currency: currency || "RON",
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return `${n.toFixed(2)} ${currency || "RON"}`;
  }
}

function formatDate(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("ro-RO", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(d);
}

function StatusBadge({ children, tone = "neutral" }) {
  return (
    <span className={`${styles.badge} ${styles[`badge_${tone}`] || ""}`}>
      {children}
    </span>
  );
}

export default function AdminProductsTab({ products = [] }) {
  const [query, setQuery] = useState("");
  const [availability, setAvailability] = useState("");
  const [activeFilter, setActiveFilter] = useState("");
  const [hiddenFilter, setHiddenFilter] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();

    return products.filter((p) => {
      const matchesQuery =
        !q ||
        String(p.title || "").toLowerCase().includes(q) ||
        String(p.description || "").toLowerCase().includes(q) ||
        String(p.category || "").toLowerCase().includes(q) ||
        String(p.color || "").toLowerCase().includes(q) ||
        String(p.vendor?.displayName || "").toLowerCase().includes(q) ||
        String(p.service?.displayName || "").toLowerCase().includes(q) ||
        String(p.service?.slug || "").toLowerCase().includes(q);

      const matchesAvailability =
        !availability ||
        String(p.availability || "").toUpperCase() === availability;

      const matchesActive =
        !activeFilter ||
        (activeFilter === "active" && p.isActive === true) ||
        (activeFilter === "inactive" && p.isActive === false);

      const matchesHidden =
        !hiddenFilter ||
        (hiddenFilter === "hidden" && p.isHidden === true) ||
        (hiddenFilter === "visible" && p.isHidden === false);

      return (
        matchesQuery &&
        matchesAvailability &&
        matchesActive &&
        matchesHidden
      );
    });
  }, [products, query, availability, activeFilter, hiddenFilter]);

  return (
    <div className={styles.wrap}>
      <div className={styles.toolbar}>
        <input
          type="text"
          className={styles.search}
          placeholder="Caută după titlu, vendor, slug, categorie..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />

        <select
          className={styles.select}
          value={availability}
          onChange={(e) => setAvailability(e.target.value)}
        >
          <option value="">Toată disponibilitatea</option>
          <option value="READY">READY</option>
          <option value="MADE_TO_ORDER">MADE_TO_ORDER</option>
          <option value="PREORDER">PREORDER</option>
          <option value="SOLD_OUT">SOLD_OUT</option>
        </select>

        <select
          className={styles.select}
          value={activeFilter}
          onChange={(e) => setActiveFilter(e.target.value)}
        >
          <option value="">Toate statusurile</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>

        <select
          className={styles.select}
          value={hiddenFilter}
          onChange={(e) => setHiddenFilter(e.target.value)}
        >
          <option value="">Vizibile + ascunse</option>
          <option value="visible">Doar vizibile</option>
          <option value="hidden">Doar ascunse</option>
        </select>
      </div>

      <div className={styles.metaRow}>
        <p className={styles.metaText}>
          Total produse încărcate: <b>{products.length}</b>
        </p>
        <p className={styles.metaText}>
          Rezultate afișate: <b>{filtered.length}</b>
        </p>
      </div>

      {!filtered.length ? (
        <div className={styles.empty}>Nu există produse care să corespundă filtrelor.</div>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Produs</th>
                <th>Vendor / Store</th>
                <th>Preț</th>
                <th>Categorie</th>
                <th>Disponibilitate</th>
                <th>Status</th>
                <th>Creat la</th>
              </tr>
            </thead>

            <tbody>
              {filtered.map((p) => {
                const image =
                  Array.isArray(p.images) && p.images.length ? p.images[0] : "";

                return (
                  <tr key={p.id}>
                    <td>
                      <div className={styles.productCell}>
                        <div className={styles.thumbWrap}>
                          {image ? (
                            <img
                              src={image}
                              alt={p.title || "Produs"}
                              className={styles.thumb}
                            />
                          ) : (
                            <div className={styles.thumbPlaceholder}>Fără poză</div>
                          )}
                        </div>

                        <div className={styles.productInfo}>
                          <div className={styles.productTitle}>{p.title || "Fără titlu"}</div>
                          <div className={styles.productId}>ID: {p.id}</div>

                          {p.description ? (
                            <div className={styles.productDesc}>
                              {String(p.description).slice(0, 110)}
                              {String(p.description).length > 110 ? "…" : ""}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </td>

                    <td>
                      <div className={styles.vendorBlock}>
                        <div className={styles.vendorName}>
                          {p.vendor?.displayName || p.service?.displayName || "—"}
                        </div>
                        <div className={styles.vendorMeta}>
                          slug: {p.service?.slug || "—"}
                        </div>
                        <div className={styles.vendorMeta}>
                          vendorId: {p.vendor?.id || p.service?.vendorId || "—"}
                        </div>
                      </div>
                    </td>

                    <td className={styles.nowrap}>
                      {formatPrice(p.price, p.currency)}
                    </td>

                    <td>
                      <div>{p.category || "—"}</div>
                      {p.color ? (
                        <div className={styles.subtleLine}>Culoare: {p.color}</div>
                      ) : null}
                    </td>

                    <td>
                      <div className={styles.badgesCol}>
                        <StatusBadge tone="info">
                          {p.availability || "—"}
                        </StatusBadge>

                        {p.availability === "READY" && p.readyQty != null ? (
                          <span className={styles.inlineMeta}>Qty: {p.readyQty}</span>
                        ) : null}

                        {p.availability === "MADE_TO_ORDER" && p.leadTimeDays != null ? (
                          <span className={styles.inlineMeta}>
                            {p.leadTimeDays} zile
                          </span>
                        ) : null}

                        {p.availability === "PREORDER" && p.nextShipDate ? (
                          <span className={styles.inlineMeta}>
                            Livrare: {formatDate(p.nextShipDate)}
                          </span>
                        ) : null}
                      </div>
                    </td>

                    <td>
                      <div className={styles.badgesCol}>
                        <StatusBadge tone={p.isActive ? "success" : "danger"}>
                          {p.isActive ? "Activ" : "Inactiv"}
                        </StatusBadge>
                        <StatusBadge tone={p.isHidden ? "warn" : "neutral"}>
                          {p.isHidden ? "Ascuns" : "Vizibil"}
                        </StatusBadge>
                      </div>
                    </td>

                    <td className={styles.nowrap}>{formatDate(p.createdAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}