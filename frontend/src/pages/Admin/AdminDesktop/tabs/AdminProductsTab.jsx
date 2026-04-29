// src/pages/Admin/AdminDesktop/tabs/AdminProductsTab.jsx
import { useEffect, useMemo, useState } from "react";
import { api } from "../../../../lib/api";
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

function getModerationTone(status) {
  switch (String(status || "PENDING").toUpperCase()) {
    case "APPROVED":
      return "success";
    case "REJECTED":
      return "danger";
    case "CHANGES_REQUESTED":
      return "warn";
    case "PENDING":
    default:
      return "info";
  }
}

function getModerationLabel(status) {
  switch (String(status || "PENDING").toUpperCase()) {
    case "APPROVED":
      return "Aprobat";
    case "REJECTED":
      return "Respins";
    case "CHANGES_REQUESTED":
      return "Necesită modificări";
    case "PENDING":
    default:
      return "În verificare";
  }
}

function StatusBadge({ children, tone = "neutral" }) {
  return (
    <span className={`${styles.badge} ${styles[`badge_${tone}`] || ""}`}>
      {children}
    </span>
  );
}

function normalizeProductsPayload(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.products)) return payload.products;
  return [];
}

export default function AdminProductsTab({ products: productsProp = null }) {
  const [productsState, setProductsState] = useState([]);
  const [loading, setLoading] = useState(false);
  const [workingProductId, setWorkingProductId] = useState("");
  const [error, setError] = useState("");

  const [selectedProduct, setSelectedProduct] = useState(null);
  const [moderationMessage, setModerationMessage] = useState("");

  const [query, setQuery] = useState("");
  const [availability, setAvailability] = useState("");
  const [activeFilter, setActiveFilter] = useState("");
  const [hiddenFilter, setHiddenFilter] = useState("");
  const [storeStatusFilter, setStoreStatusFilter] = useState("");
  const [moderationFilter, setModerationFilter] = useState("");

  const shouldFetchOwnData = productsProp === null;

 async function fetchJson(path, options = {}) {
  return api(path, options);
}

  useEffect(() => {
    if (!shouldFetchOwnData) return;

    let alive = true;

    async function loadProducts() {
      try {
        setLoading(true);
        setError("");

        const data = await fetchJson("/api/admin/products?take=200");

        if (!alive) return;
        setProductsState(normalizeProductsPayload(data));
      } catch (e) {
        if (!alive) return;
        setError(e?.message || "Nu am putut încărca produsele.");
        setProductsState([]);
      } finally {
        if (alive) setLoading(false);
      }
    }

    loadProducts();

    return () => {
      alive = false;
    };
  }, [shouldFetchOwnData]);

  const products = Array.isArray(productsProp) ? productsProp : productsState;

  const setProductEverywhere = (productId, patchOrProduct) => {
    const updater = (old) =>
      old.map((p) => {
        if (p.id !== productId) return p;
        return typeof patchOrProduct === "function"
          ? patchOrProduct(p)
          : { ...p, ...patchOrProduct };
      });

    setProductsState(updater);

    setSelectedProduct((old) => {
      if (!old || old.id !== productId) return old;
      return typeof patchOrProduct === "function"
        ? patchOrProduct(old)
        : { ...old, ...patchOrProduct };
    });
  };

  const approveProduct = async (productId) => {
    if (!productId) return;

    try {
      setWorkingProductId(productId);
      setError("");

      const data = await fetchJson(`/api/admin/products/${productId}/approve`, {
        method: "PATCH",
      });

      if (data?.product) {
        setProductEverywhere(productId, data.product);
      }
    } catch (e) {
      setError(e?.message || "Nu am putut aproba produsul.");
    } finally {
      setWorkingProductId("");
    }
  };

  const requestChangesProduct = async (productId, message) => {
    if (!productId || !String(message || "").trim()) return;

    try {
      setWorkingProductId(productId);
      setError("");

      const data = await fetchJson(`/api/admin/products/${productId}/request-changes`, {
        method: "PATCH",
        body: { message: String(message).trim() },
      });

      if (data?.product) {
        setProductEverywhere(productId, data.product);
        setModerationMessage("");
      }
    } catch (e) {
      setError(e?.message || "Nu am putut cere modificări.");
    } finally {
      setWorkingProductId("");
    }
  };

  const rejectProduct = async (productId, message) => {
    if (!productId || !String(message || "").trim()) return;

    try {
      setWorkingProductId(productId);
      setError("");

      const data = await fetchJson(`/api/admin/products/${productId}/reject`, {
        method: "PATCH",
        body: { message: String(message).trim() },
      });

      if (data?.product) {
        setProductEverywhere(productId, data.product);
        setModerationMessage("");
      }
    } catch (e) {
      setError(e?.message || "Nu am putut respinge produsul.");
    } finally {
      setWorkingProductId("");
    }
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();

    return products.filter((p) => {
      const storeStatus = String(p.service?.status || "").toUpperCase();
      const productModerationStatus = String(
        p.moderationStatus || "PENDING"
      ).toUpperCase();

      const matchesQuery =
        !q ||
        String(p.title || "").toLowerCase().includes(q) ||
        String(p.description || "").toLowerCase().includes(q) ||
        String(p.category || "").toLowerCase().includes(q) ||
        String(p.color || "").toLowerCase().includes(q) ||
        String(p.vendor?.displayName || "").toLowerCase().includes(q) ||
        String(p.vendor?.id || "").toLowerCase().includes(q) ||
        String(p.service?.displayName || "").toLowerCase().includes(q) ||
        String(p.service?.slug || "").toLowerCase().includes(q) ||
        String(p.service?.id || "").toLowerCase().includes(q) ||
        String(p.id || "").toLowerCase().includes(q);

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

      const matchesStoreStatus =
        !storeStatusFilter || storeStatus === storeStatusFilter;

      const matchesModeration =
        !moderationFilter || productModerationStatus === moderationFilter;

      return (
        matchesQuery &&
        matchesAvailability &&
        matchesActive &&
        matchesHidden &&
        matchesStoreStatus &&
        matchesModeration
      );
    });
  }, [
    products,
    query,
    availability,
    activeFilter,
    hiddenFilter,
    storeStatusFilter,
    moderationFilter,
  ]);

  return (
    <div className={styles.wrap}>
      <div className={styles.toolbar}>
        <input
          type="text"
          className={styles.search}
          placeholder="Caută după titlu, vendor, slug, categorie, ID..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />

        <select
          className={styles.select}
          value={moderationFilter}
          onChange={(e) => setModerationFilter(e.target.value)}
        >
          <option value="">Toate verificările</option>
          <option value="PENDING">În verificare</option>
          <option value="APPROVED">Aprobate</option>
          <option value="CHANGES_REQUESTED">Necesită modificări</option>
          <option value="REJECTED">Respinse</option>
        </select>

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
          <option value="">Toate statusurile produsului</option>
          <option value="active">Produse active</option>
          <option value="inactive">Produse inactive</option>
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

        <select
          className={styles.select}
          value={storeStatusFilter}
          onChange={(e) => setStoreStatusFilter(e.target.value)}
        >
          <option value="">Toate store-urile</option>
          <option value="ACTIVE">Store ACTIVE</option>
          <option value="DRAFT">Store DRAFT</option>
          <option value="INACTIVE">Store INACTIVE</option>
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

      {loading ? (
        <div className={styles.empty}>Se încarcă produsele...</div>
      ) : error ? (
        <div className={styles.empty}>{error}</div>
      ) : !filtered.length ? (
        <div className={styles.empty}>
          Nu există produse care să corespundă filtrelor.
        </div>
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
                <th>Verificare</th>
                <th>Status produs</th>
                <th>Status store</th>
                <th>Creat la</th>
                <th>Acțiuni</th>
              </tr>
            </thead>

            <tbody>
              {filtered.map((p) => {
                const image =
                  Array.isArray(p.images) && p.images.length ? p.images[0] : "";

                const storeStatus = String(p.service?.status || "").toUpperCase();
                const storeStatusTone =
                  storeStatus === "ACTIVE"
                    ? "success"
                    : storeStatus === "DRAFT"
                    ? "warn"
                    : "danger";

                const moderationStatus = String(
                  p.moderationStatus || "PENDING"
                ).toUpperCase();

                const isApproved = moderationStatus === "APPROVED";

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
                          <div className={styles.productTitle}>
                            {p.title || "Fără titlu"}
                          </div>
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
                        <div className={styles.vendorMeta}>
                          serviceId: {p.service?.id || "—"}
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
                        <StatusBadge tone="info">{p.availability || "—"}</StatusBadge>

                        {p.availability === "READY" && p.readyQty != null ? (
                          <span className={styles.inlineMeta}>Qty: {p.readyQty}</span>
                        ) : null}

                        {p.availability === "MADE_TO_ORDER" &&
                        p.leadTimeDays != null ? (
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
                        <StatusBadge tone={getModerationTone(moderationStatus)}>
                          {getModerationLabel(moderationStatus)}
                        </StatusBadge>

                        {p.moderationMessage ? (
                          <span className={styles.inlineMeta}>
                            {String(p.moderationMessage).slice(0, 80)}
                            {String(p.moderationMessage).length > 80 ? "…" : ""}
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

                    <td>
                      <div className={styles.badgesCol}>
                        <StatusBadge tone={storeStatusTone}>
                          {storeStatus || "—"}
                        </StatusBadge>
                        <StatusBadge tone={p.service?.isActive ? "success" : "danger"}>
                          {p.service?.isActive ? "Store activ" : "Store inactiv"}
                        </StatusBadge>
                      </div>
                    </td>

                    <td className={styles.nowrap}>{formatDate(p.createdAt)}</td>

                    <td>
                      <div className={styles.badgesCol}>
                        <button
                          type="button"
                          className={styles.actionBtn}
                          onClick={() => {
                            setSelectedProduct(p);
                            setModerationMessage("");
                          }}
                        >
                          Verifică
                        </button>

                        <button
                          type="button"
                          className={styles.approveBtn}
                          disabled={isApproved || workingProductId === p.id}
                          onClick={() => approveProduct(p.id)}
                        >
                          {isApproved
                            ? "Aprobat"
                            : workingProductId === p.id
                            ? "Se procesează..."
                            : "Aprobă"}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {selectedProduct ? (
        <ProductReviewModal
          product={selectedProduct}
          working={workingProductId === selectedProduct.id}
          moderationMessage={moderationMessage}
          setModerationMessage={setModerationMessage}
          onClose={() => {
            setSelectedProduct(null);
            setModerationMessage("");
          }}
          onApprove={() => approveProduct(selectedProduct.id)}
          onRequestChanges={(message) =>
            requestChangesProduct(selectedProduct.id, message)
          }
          onReject={(message) => rejectProduct(selectedProduct.id, message)}
        />
      ) : null}
    </div>
  );
}

function ProductReviewModal({
  product,
  working,
  moderationMessage,
  setModerationMessage,
  onClose,
  onApprove,
  onRequestChanges,
  onReject,
}) {
  const images = Array.isArray(product.images) ? product.images : [];
  const moderationStatus = String(product.moderationStatus || "PENDING").toUpperCase();
  const isApproved = moderationStatus === "APPROVED";

  return (
    <div className={styles.modalBackdrop} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHead}>
          <div>
            <h3 className={styles.modalTitle}>
              {product.title || "Produs fără titlu"}
            </h3>
            <p className={styles.modalSub}>ID: {product.id}</p>
          </div>

          <button type="button" className={styles.closeBtn} onClick={onClose}>
            ×
          </button>
        </div>

        <div className={styles.modalActions}>
          <button
            type="button"
            className={styles.approveBtn}
            disabled={isApproved || working}
            onClick={onApprove}
          >
            {isApproved ? "Produs aprobat" : working ? "Se procesează..." : "Aprobă produsul"}
          </button>
        </div>

        <div className={styles.moderationBox}>
          <div className={styles.badgesCol}>
            <StatusBadge tone={getModerationTone(moderationStatus)}>
              {getModerationLabel(moderationStatus)}
            </StatusBadge>
          </div>

          {product.moderationMessage ? (
            <p className={styles.moderationOldMessage}>
              Ultimul mesaj: {product.moderationMessage}
            </p>
          ) : null}

          <textarea
            className={styles.textarea}
            placeholder="Scrie motivul pentru modificări sau respingere..."
            value={moderationMessage}
            onChange={(e) => setModerationMessage(e.target.value)}
          />

          <div className={styles.modalActions}>
            <button
              type="button"
              className={styles.warnBtn}
              disabled={working || !moderationMessage.trim()}
              onClick={() => onRequestChanges(moderationMessage)}
            >
              Cere modificări
            </button>

            <button
              type="button"
              className={styles.rejectBtn}
              disabled={working || !moderationMessage.trim()}
              onClick={() => onReject(moderationMessage)}
            >
              Respinge
            </button>
          </div>
        </div>

        <div className={styles.modalGrid}>
          <div>
            {images.length ? (
              <div className={styles.gallery}>
                {images.map((src, index) => (
                  <a
                    key={`${src}-${index}`}
                    href={src}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <img
                      src={src}
                      alt={`Produs ${index + 1}`}
                      className={styles.galleryImg}
                    />
                  </a>
                ))}
              </div>
            ) : (
              <div className={styles.noImages}>Produsul nu are poze.</div>
            )}
          </div>

          <div className={styles.detailsPanel}>
            <Detail label="Preț" value={formatPrice(product.price, product.currency)} />
            <Detail label="Categorie" value={product.category || "—"} />
            <Detail label="Culoare" value={product.color || "—"} />
            <Detail label="Disponibilitate" value={product.availability || "—"} />
            <Detail label="Stoc ready" value={product.readyQty ?? "—"} />
            <Detail
              label="Lead time"
              value={product.leadTimeDays ? `${product.leadTimeDays} zile` : "—"}
            />
            <Detail label="Livrare preorder" value={formatDate(product.nextShipDate)} />
            <Detail label="Acceptă custom" value={product.acceptsCustom ? "Da" : "Nu"} />

            <hr className={styles.modalSep} />

            <Detail label="Vendor" value={product.vendor?.displayName || "—"} />
            <Detail
              label="Vendor ID"
              value={product.vendor?.id || product.service?.vendorId || "—"}
            />
            <Detail label="Store" value={product.service?.displayName || "—"} />
            <Detail label="Slug store" value={product.service?.slug || "—"} />
            <Detail label="Service ID" value={product.service?.id || "—"} />
            <Detail label="Status store" value={product.service?.status || "—"} />
            <Detail label="Store activ" value={product.service?.isActive ? "Da" : "Nu"} />

            <hr className={styles.modalSep} />

            <Detail label="Produs activ" value={product.isActive ? "Da" : "Nu"} />
            <Detail label="Produs ascuns" value={product.isHidden ? "Da" : "Nu"} />
            <Detail label="Trimis la" value={formatDate(product.submittedAt)} />
            <Detail label="Verificat la" value={formatDate(product.reviewedAt)} />
            <Detail label="Aprobat la" value={formatDate(product.approvedAt)} />
            <Detail label="Creat la" value={formatDate(product.createdAt)} />
            <Detail label="Actualizat la" value={formatDate(product.updatedAt)} />
          </div>
        </div>

        <div className={styles.descriptionBox}>
          <h4>Descriere</h4>
          <p>{product.description || "Fără descriere."}</p>
        </div>

        <div className={styles.descriptionBox}>
          <h4>Detalii produs</h4>
          <Detail label="Material" value={product.materialMain || "—"} />
          <Detail label="Tehnică" value={product.technique || "—"} />
          <Detail label="Dimensiuni" value={product.dimensions || "—"} />
          <Detail label="Îngrijire" value={product.careInstructions || "—"} />
          <Detail label="Note speciale" value={product.specialNotes || "—"} />
        </div>

        <div className={styles.descriptionBox}>
          <h4>Tag-uri</h4>
          <p>
            Stil:{" "}
            {Array.isArray(product.styleTags) && product.styleTags.length
              ? product.styleTags.join(", ")
              : "—"}
          </p>
          <p>
            Ocazii:{" "}
            {Array.isArray(product.occasionTags) && product.occasionTags.length
              ? product.occasionTags.join(", ")
              : "—"}
          </p>
        </div>
      </div>
    </div>
  );
}

function Detail({ label, value }) {
  return (
    <div className={styles.detailRow}>
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
}