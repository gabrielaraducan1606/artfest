import { useEffect, useMemo, useState } from "react";

import { FiHelpCircle, FiX } from "react-icons/fi";

import styles from "./InfluencerDashboardPage.module.css";

/* =========================================================
   CONSTANTE
========================================================= */

const RESOURCE_TYPE_LABELS = {
  PRODUCT_OF_DAY: "Produsul zilei",
  ARTISAN_OF_WEEK: "Artizanul săptămânii",
  POST_IDEA: "Idee de postare",
  ARTFEST_FEATURE: "Funcționalitate Artfest",
  CAMPAIGN: "Campanie",
  GENERIC: "Resursă",
};

/*
 * Interval FIX (nu în Prisma, nu configurabil momentan) - dacă
 * vrem un interval diferit pe viitor, se adaugă separat, explicit.
 */
const REPOST_THRESHOLD_DAYS = 14;

const SEGMENTS = [
  { id: "all", label: "Toate" },
  { id: "toPost", label: "De postat" },
  { id: "toRepost", label: "De repostat" },
  { id: "posted", label: "Postate" },
];

/*
 * "new_products"/"new_vendors" nu filtrează lista de
 * InfluencerResource - au propriul render, alimentat din
 * generatedContent (vezi GET /api/influencer/resources).
 */
const CATEGORIES = [
  { id: "all", label: "Toate" },
  { id: "ARTFEST_FEATURE", label: "Funcționalități" },
  { id: "PRODUCT_OF_DAY", label: "Produsul zilei" },
  { id: "ARTISAN_OF_WEEK", label: "Artizanul săptămânii" },
  { id: "new_products", label: "Produse noi azi" },
  { id: "new_vendors", label: "Vânzători noi" },
  { id: "CAMPAIGN", label: "Campanii" },
];

function matchesCategory(resource, categoryId) {
  if (categoryId === "all") {
    return true;
  }

  return resource.type === categoryId;
}

/*
 * FAZA 3 (INFLUENCER) - filtre inițiale primite din URL (?category=
 * &activity=), trimise fie de un link direct, fie de asistentul AI
 * (INFLUENCER_RESOURCES din assistantActionRegistry.js). Normalizate
 * defensiv - id-urile REALE folosite intern sunt cele din CATEGORIES/
 * SEGMENTS mai sus (ex. "toRepost", nu "REPOST"), dar acceptăm și
 * variante uppercase/alt casing, ca un target scris manual (sau
 * exemplul din cerință) să tot funcționeze corect.
 */
const CATEGORY_FILTER_IDS = new Set(
  CATEGORIES.map((item) => item.id)
);

const ACTIVITY_ALIASES = {
  ALL: "all",
  TOPOST: "toPost",
  TO_POST: "toPost",
  TOREPOST: "toRepost",
  TO_REPOST: "toRepost",
  REPOST: "toRepost",
  POSTED: "posted",
};

function normalizeCategoryFilter(value) {
  if (!value) {
    return "all";
  }

  if (CATEGORY_FILTER_IDS.has(value)) {
    return value;
  }

  const upper = String(value).toUpperCase();

  const match = CATEGORIES.find(
    (item) => item.id.toUpperCase() === upper
  );

  return match ? match.id : "all";
}

function normalizeActivityFilter(value) {
  if (!value) {
    return "all";
  }

  if (
    value === "all" ||
    value === "toPost" ||
    value === "toRepost" ||
    value === "posted"
  ) {
    return value;
  }

  return (
    ACTIVITY_ALIASES[String(value).toUpperCase()] || "all"
  );
}

/* =========================================================
   HELPERS TIMP / STATUS
========================================================= */

function daysBetween(pastValue, now = new Date()) {
  const past = new Date(pastValue);

  if (Number.isNaN(past.getTime())) {
    return null;
  }

  const startOfPast = new Date(
    past.getFullYear(),
    past.getMonth(),
    past.getDate()
  );

  const startOfNow = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate()
  );

  return Math.round(
    (startOfNow - startOfPast) / 86400000
  );
}

/*
 * Grupul + numărul de zile de la ultima postare - SINGURA sursă
 * de adevăr pentru filtrare, sortare și textul afișat pe card.
 */
function getResourceStatus(activity) {
  if (!activity?.lastPostedAt) {
    return { group: "toPost", days: null };
  }

  const days = daysBetween(activity.lastPostedAt);

  if (days === null) {
    return { group: "toPost", days: null };
  }

  if (days >= REPOST_THRESHOLD_DAYS) {
    return { group: "toRepost", days };
  }

  return { group: "posted", days };
}

function formatStatusText(status) {
  if (status.group === "toPost") {
    return "Nu ai postat încă";
  }

  if (status.days <= 0) {
    return "Postat azi";
  }

  if (status.group === "toRepost") {
    return `E timpul să repostezi · ultima postare acum ${status.days} zile`;
  }

  return `Postat acum ${status.days} zile`;
}

const GROUP_PRIORITY = {
  toPost: 0,
  toRepost: 1,
  posted: 2,
};

/*
 * Sortare pentru "Toate": întâi niciodată postate, apoi de
 * repostat, apoi postate recent - în interiorul fiecărui grup,
 * cele mai vechi/urgente primele (zile descrescător).
 */
function compareResources(a, b) {
  const statusA = getResourceStatus(a.activity);
  const statusB = getResourceStatus(b.activity);

  const groupDiff =
    GROUP_PRIORITY[statusA.group] -
    GROUP_PRIORITY[statusB.group];

  if (groupDiff !== 0) {
    return groupDiff;
  }

  return (statusB.days ?? -1) - (statusA.days ?? -1);
}

/* =========================================================
   COMPONENTA PRINCIPALĂ
========================================================= */

export default function InfluencerResourcesSection({
  resources,
  loading,
  loaded,
  error,
  onReload,
  onDownload,
  onCopy,
  copyState,
  onMarkPosted,
  markingPostedId,
  generatedContent,
  initialFilters,
}) {
  const [segment, setSegment] = useState(() =>
    normalizeActivityFilter(initialFilters?.activity)
  );

  const [category, setCategory] = useState(() =>
    normalizeCategoryFilter(initialFilters?.category)
  );

  /*
   * FAZA 3 (INFLUENCER) - `initialFilters` nu se aplică doar la
   * montare: dacă influencerul are deja tab-ul Resurse deschis și
   * cere asistentului un filtru nou, InfluencerDashboardPage.jsx
   * navighează pe ACEEAȘI pagină (fără remount) - trebuie re-aplicat
   * reactiv de fiecare dată când obiectul (memoizat pe searchParams
   * în componenta părinte) chiar se schimbă.
   */
  useEffect(() => {
    if (!initialFilters) {
      return;
    }

    setCategory(
      normalizeCategoryFilter(initialFilters.category)
    );

    setSegment(
      normalizeActivityFilter(initialFilters.activity)
    );
  }, [initialFilters]);
  const [copiedGeneratedId, setCopiedGeneratedId] = useState("");
  const [helpResource, setHelpResource] = useState(null);

  const newProductsToday =
    generatedContent?.newProductsToday || [];

  const newVendorsToday =
    generatedContent?.newVendorsToday || [];

  async function copyGeneratedLink(id, path) {
    if (!path) {
      return;
    }

    try {
      await navigator.clipboard.writeText(
        `${window.location.origin}${path}`
      );

      setCopiedGeneratedId(id);

      window.setTimeout(() => {
        setCopiedGeneratedId("");
      }, 1600);
    } catch {
      // opțional - nu blocăm UI-ul pentru o eroare de clipboard
    }
  }

  const sortedResources = useMemo(
    () => [...resources].sort(compareResources),
    [resources]
  );

  const segmentCounts = useMemo(() => {
    const counts = { all: sortedResources.length, toPost: 0, toRepost: 0, posted: 0 };

    for (const resource of sortedResources) {
      const status = getResourceStatus(resource.activity);
      counts[status.group] += 1;
    }

    return counts;
  }, [sortedResources]);

  const visibleResources = useMemo(
    () =>
      sortedResources.filter(
        (resource) =>
          (segment === "all" ||
            getResourceStatus(resource.activity)
              .group === segment) &&
          matchesCategory(resource, category)
      ),
    [sortedResources, segment, category]
  );

  return (
    <section className={styles.card}>
      <div className={styles.cardHeader}>
        <div>
          <h2 className={styles.cardTitle}>
            Resurse pentru conținut
          </h2>

          <p className={styles.cardSubtitle}>
            Materiale pregătite de Artfest pe care le poți
            folosi direct în conținutul tău.
          </p>
        </div>

        <button
          type="button"
          className={styles.secondaryButton}
          disabled={loading}
          onClick={onReload}
        >
          {loading ? "Se încarcă..." : "Reîncarcă"}
        </button>
      </div>

      {error && (
        <div className={styles.inlineError}>{error}</div>
      )}

      {loading && !loaded ? (
        <div className={styles.ordersLoading}>
          Se încarcă resursele…
        </div>
      ) : resources.length === 0 &&
        newProductsToday.length === 0 &&
        newVendorsToday.length === 0 ? (
        <div className={styles.ordersEmpty}>
          <div className={styles.ordersEmptyIcon}>▣</div>

          <strong>
            Nu există încă resurse disponibile
          </strong>

          <span>
            Materialele pregătite de Artfest vor apărea
            aici de îndată ce sunt publicate.
          </span>
        </div>
      ) : (
        <>
          {/* Rând 1 - categorie */}
          <div
            role="tablist"
            aria-label="Filtrează după categorie"
            style={{
              display: "flex",
              gap: 8,
              flexWrap: "nowrap",
              overflowX: "auto",
              WebkitOverflowScrolling: "touch",
              paddingBottom: 6,
              marginTop: 10,
            }}
          >
            {CATEGORIES.map((item) => (
              <SegmentPill
                key={item.id}
                active={category === item.id}
                onClick={() => setCategory(item.id)}
              >
                {item.label}
              </SegmentPill>
            ))}
          </div>

          {/* Rând 2 - activitate */}
          <div
            role="tablist"
            aria-label="Filtrează după activitate"
            style={{
              display: "flex",
              gap: 8,
              flexWrap: "nowrap",
              overflowX: "auto",
              WebkitOverflowScrolling: "touch",
              paddingBottom: 6,
              marginTop: 8,
              marginBottom: 16,
            }}
          >
            {SEGMENTS.map((item) => (
              <SegmentPill
                key={item.id}
                active={segment === item.id}
                onClick={() => setSegment(item.id)}
              >
                {item.label}
                {segmentCounts[item.id] > 0 &&
                  ` (${segmentCounts[item.id]})`}
              </SegmentPill>
            ))}
          </div>

          {category === "new_products" ? (
            newProductsToday.length === 0 ? (
              <div className={styles.ordersEmpty}>
                <span>Nu există produse noi azi.</span>
              </div>
            ) : (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns:
                    "repeat(auto-fill, minmax(200px, 1fr))",
                  gap: 12,
                }}
              >
                {newProductsToday.map((product) => (
                  <GeneratedProductCard
                    key={product.id}
                    product={product}
                    onCopyLink={() =>
                      copyGeneratedLink(
                        product.id,
                        product.productUrl
                      )
                    }
                    copied={
                      copiedGeneratedId === product.id
                    }
                  />
                ))}
              </div>
            )
          ) : category === "new_vendors" ? (
            newVendorsToday.length === 0 ? (
              <div className={styles.ordersEmpty}>
                <span>Nu există vânzători noi azi.</span>
              </div>
            ) : (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns:
                    "repeat(auto-fill, minmax(220px, 1fr))",
                  gap: 12,
                }}
              >
                {newVendorsToday.map((vendor) => (
                  <GeneratedVendorCard
                    key={vendor.serviceId}
                    vendor={vendor}
                    onCopyLink={() =>
                      copyGeneratedLink(
                        vendor.serviceId,
                        vendor.storeUrl
                      )
                    }
                    copied={
                      copiedGeneratedId ===
                      vendor.serviceId
                    }
                  />
                ))}
              </div>
            )
          ) : (
            <>
              {category === "all" &&
                newProductsToday.length > 0 && (
                  <GeneratedStrip title="Produse noi azi">
                    {newProductsToday.map((product) => (
                      <GeneratedProductCard
                        key={product.id}
                        product={product}
                        onCopyLink={() =>
                          copyGeneratedLink(
                            product.id,
                            product.productUrl
                          )
                        }
                        copied={
                          copiedGeneratedId === product.id
                        }
                      />
                    ))}
                  </GeneratedStrip>
                )}

              {category === "all" &&
                newVendorsToday.length > 0 && (
                  <GeneratedStrip title="Vânzători noi azi">
                    {newVendorsToday.map((vendor) => (
                      <GeneratedVendorCard
                        key={vendor.serviceId}
                        vendor={vendor}
                        onCopyLink={() =>
                          copyGeneratedLink(
                            vendor.serviceId,
                            vendor.storeUrl
                          )
                        }
                        copied={
                          copiedGeneratedId ===
                          vendor.serviceId
                        }
                      />
                    ))}
                  </GeneratedStrip>
                )}

              {visibleResources.length === 0 ? (
                <div className={styles.ordersEmpty}>
                  <span>
                    Nu există resurse pentru acest filtru.
                  </span>
                </div>
              ) : (
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns:
                      "repeat(auto-fill, minmax(240px, 1fr))",
                    gap: 12,
                  }}
                >
                  {visibleResources.map((resource) => (
                    <ResourceCompactCard
                      key={resource.id}
                      resource={resource}
                      onDownload={() => onDownload(resource)}
                      onCopy={() => onCopy(resource)}
                      copied={
                        copyState === `resource-${resource.id}`
                      }
                      onMarkPosted={() =>
                        onMarkPosted(resource)
                      }
                      markingPosted={
                        markingPostedId === resource.id
                      }
                      onShowHelp={() =>
                        setHelpResource(resource)
                      }
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </>
      )}

      {helpResource && (
        <ResourceHelpModal
          resource={helpResource}
          onClose={() => setHelpResource(null)}
        />
      )}
    </section>
  );
}

/* =========================================================
   MODAL "?" - INFORMAȚII SUPLIMENTARE

   Text introdus de admin (helpText), afișat influencerului la
   apăsarea butonului "?" de pe card - NU navighează, NU descarcă
   nimic. Nu vine hardcodat - vine din datele resursei.
========================================================= */

function ResourceHelpModal({ resource, onClose }) {
  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    document.addEventListener("keydown", handleKeyDown);

    return () =>
      document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div
      role="presentation"
      className={styles.helpModalBackdrop}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="resource-help-title"
        className={styles.helpModal}
      >
        <div className={styles.helpModalHeader}>
          <h3
            id="resource-help-title"
            className={styles.helpModalTitle}
          >
            Despre această resursă
          </h3>

          <button
            type="button"
            onClick={onClose}
            aria-label="Închide"
            className={styles.helpModalCloseButton}
          >
            <FiX size={20} />
          </button>
        </div>

        <div className={styles.helpModalBody}>
          {resource.helpText}
        </div>

        <div className={styles.helpModalFooter}>
          <button
            type="button"
            onClick={onClose}
            className={styles.primaryButton}
          >
            Am înțeles
          </button>
        </div>
      </div>
    </div>
  );
}

/* =========================================================
   SEGMENTED PILL
========================================================= */

function SegmentPill({ active, onClick, children }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      style={{
        padding: "8px 16px",
        borderRadius: 999,
        border: active
          ? "1px solid #ddd6fe"
          : "1px solid #e5e7eb",
        background: active ? "#f5f3ff" : "#ffffff",
        color: active ? "#6d28d9" : "#374151",
        fontWeight: active ? 700 : 500,
        fontSize: 13,
        whiteSpace: "nowrap",
        flexShrink: 0,
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}

/* =========================================================
   CARD COMPACT
========================================================= */

function ResourceCompactCard({
  resource,
  onDownload,
  onCopy,
  copied,
  onMarkPosted,
  markingPosted,
  onShowHelp,
}) {
  const hasMedia = Boolean(resource.mediaUrl);
  const hasHelpText = Boolean(resource.helpText);

  const typeLabel =
    RESOURCE_TYPE_LABELS[resource.type] || "Resursă";

  const status = getResourceStatus(resource.activity);

  return (
    <div
      className={styles.resourceCard}
      style={{ padding: 12 }}
    >
      {hasMedia && (
        <div
          style={{
            borderRadius: 10,
            overflow: "hidden",
            marginBottom: 8,
            background: "#f3f4f6",
          }}
        >
          {resource.mediaType === "VIDEO" ? (
            <video
              src={resource.mediaUrl}
              controls
              style={{
                width: "100%",
                maxHeight: 150,
                display: "block",
              }}
            />
          ) : (
            <img
              src={resource.mediaUrl}
              alt={resource.title}
              style={{
                width: "100%",
                maxHeight: 150,
                objectFit: "cover",
                display: "block",
              }}
            />
          )}
        </div>
      )}

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 6,
          flexWrap: "wrap",
        }}
      >
        <span
          className={styles.resourceEyebrow}
          style={{ fontSize: 11 }}
        >
          {typeLabel}
        </span>

        {status.group === "toRepost" && (
          <span
            style={{
              padding: "2px 8px",
              borderRadius: 999,
              fontSize: 11,
              fontWeight: 700,
              background: "#fef9c3",
              color: "#854d0e",
            }}
          >
            De repostat
          </span>
        )}
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 6,
        }}
      >
        <h3
          className={styles.resourceTitle}
          style={{ fontSize: 15, margin: "4px 0" }}
        >
          {resource.title}
        </h3>

        {hasHelpText && (
          <button
            type="button"
            onClick={onShowHelp}
            className={styles.resourceHelpButton}
            aria-label="Mai multe informații despre această resursă"
            title="Mai multe informații"
          >
            <FiHelpCircle size={16} />
          </button>
        )}
      </div>

      {resource.description && (
        <p
          className={styles.resourceText}
          style={{
            fontSize: 13,
            margin: 0,
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {resource.description}
        </p>
      )}

      <div
        className={styles.subtitle}
        style={{ fontSize: 12, marginTop: 6 }}
      >
        {formatStatusText(status)}
      </div>

      <div
        style={{
          display: "flex",
          gap: 6,
          flexWrap: "wrap",
          marginTop: 8,
        }}
      >
        {hasMedia && (
          <button
            type="button"
            className={styles.secondaryButton}
            onClick={onDownload}
            style={{ fontSize: 12, padding: "6px 10px" }}
          >
            Descarcă
          </button>
        )}

        {resource.description && (
          <button
            type="button"
            className={styles.secondaryButton}
            onClick={onCopy}
            style={{ fontSize: 12, padding: "6px 10px" }}
          >
            {copied ? "Copiat ✓" : "Copiază textul"}
          </button>
        )}

        {resource.targetUrl && (
          <a
            href={resource.targetUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.secondaryButton}
            style={{
              textDecoration: "none",
              display: "inline-flex",
              alignItems: "center",
              fontSize: 12,
              padding: "6px 10px",
            }}
          >
            Deschide linkul
          </a>
        )}

        <button
          type="button"
          className={styles.primaryButton}
          disabled={markingPosted}
          onClick={onMarkPosted}
          style={{ fontSize: 12, padding: "6px 10px" }}
        >
          {markingPosted ? "Se marchează..." : "Am postat"}
        </button>
      </div>
    </div>
  );
}

/* =========================================================
   BLOC COMPACT PENTRU CONȚINUT GENERAT ("Toate")
========================================================= */

function GeneratedStrip({ title, children }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div
        style={{
          fontWeight: 700,
          fontSize: 14,
          marginBottom: 8,
          color: "#374151",
        }}
      >
        {title}
      </div>

      <div
        style={{
          display: "flex",
          gap: 12,
          flexWrap: "nowrap",
          overflowX: "auto",
          WebkitOverflowScrolling: "touch",
          paddingBottom: 6,
        }}
      >
        {children}
      </div>
    </div>
  );
}

/* =========================================================
   CARD - PRODUS NOU AZI (generat, fără InfluencerResource)
========================================================= */

function GeneratedProductCard({ product, onCopyLink, copied }) {
  return (
    <div
      className={styles.resourceCard}
      style={{ padding: 12, minWidth: 200, flexShrink: 0 }}
    >
      <div
        style={{
          borderRadius: 10,
          overflow: "hidden",
          marginBottom: 8,
          background: "#f3f4f6",
        }}
      >
        {product.image ? (
          <img
            src={product.image}
            alt={product.title}
            style={{
              width: "100%",
              maxHeight: 150,
              objectFit: "cover",
              display: "block",
            }}
          />
        ) : (
          <div style={{ width: "100%", height: 120 }} />
        )}
      </div>

      <span
        className={styles.resourceEyebrow}
        style={{ fontSize: 11 }}
      >
        {product.storeName || "Artfest"}
      </span>

      <h3
        className={styles.resourceTitle}
        style={{ fontSize: 15, margin: "4px 0" }}
      >
        {product.title}
      </h3>

      <span
        style={{
          padding: "2px 8px",
          borderRadius: 999,
          fontSize: 11,
          fontWeight: 700,
          background: "#dcfce7",
          color: "#166534",
          display: "inline-block",
        }}
      >
        Nou azi
      </span>

      <div
        style={{
          display: "flex",
          gap: 6,
          flexWrap: "wrap",
          marginTop: 8,
        }}
      >
        <a
          href={product.productUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={styles.secondaryButton}
          style={{
            textDecoration: "none",
            display: "inline-flex",
            alignItems: "center",
            fontSize: 12,
            padding: "6px 10px",
          }}
        >
          Deschide produsul
        </a>

        <button
          type="button"
          className={styles.secondaryButton}
          onClick={onCopyLink}
          style={{ fontSize: 12, padding: "6px 10px" }}
        >
          {copied ? "Copiat ✓" : "Copiază linkul"}
        </button>
      </div>
    </div>
  );
}

/* =========================================================
   CARD - VÂNZĂTOR NOU AZI (generat, fără InfluencerResource)
========================================================= */

function GeneratedVendorCard({ vendor, onCopyLink, copied }) {
  const previewProducts = vendor.previewProducts || [];

  return (
    <div
      className={styles.resourceCard}
      style={{ padding: 12, minWidth: 220, flexShrink: 0 }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 8,
        }}
      >
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: "50%",
            overflow: "hidden",
            background: "#f3f4f6",
            flexShrink: 0,
          }}
        >
          {vendor.logo && (
            <img
              src={vendor.logo}
              alt={vendor.storeName || "Magazin"}
              style={{
                width: "100%",
                height: "100%",
                objectFit: "cover",
              }}
            />
          )}
        </div>

        <div>
          <div style={{ fontWeight: 700, fontSize: 14 }}>
            {vendor.storeName || "Magazin Artfest"}
          </div>

          <span
            style={{
              padding: "2px 8px",
              borderRadius: 999,
              fontSize: 11,
              fontWeight: 700,
              background: "#dcfce7",
              color: "#166534",
              display: "inline-block",
              marginTop: 2,
            }}
          >
            Nou pe Artfest
          </span>
        </div>
      </div>

      {previewProducts.length > 0 && (
        <div
          style={{
            display: "flex",
            gap: 6,
            marginBottom: 8,
          }}
        >
          {previewProducts.map((product) => (
            <img
              key={product.id}
              src={product.image}
              alt={product.title}
              style={{
                width: 48,
                height: 48,
                borderRadius: 8,
                objectFit: "cover",
                background: "#f3f4f6",
              }}
            />
          ))}
        </div>
      )}

      <div
        style={{
          display: "flex",
          gap: 6,
          flexWrap: "wrap",
        }}
      >
        <a
          href={vendor.storeUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={styles.secondaryButton}
          style={{
            textDecoration: "none",
            display: "inline-flex",
            alignItems: "center",
            fontSize: 12,
            padding: "6px 10px",
          }}
        >
          Deschide magazinul
        </a>

        <button
          type="button"
          className={styles.secondaryButton}
          onClick={onCopyLink}
          style={{ fontSize: 12, padding: "6px 10px" }}
        >
          {copied ? "Copiat ✓" : "Copiază linkul"}
        </button>
      </div>
    </div>
  );
}
