import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

import { api } from "../../../lib/api.js";

import styles from "./AdminVendorMarketingTab.module.css";

const PAGE_SIZE = 25;

const SCOPE_LABELS = {
  ALL_PRODUCTS: "Toate produsele Artfest eligibile",
  VENDOR_COLLECTION: "O colecție a vendorului",
  SELECTED_PRODUCTS: "Produse selectate",
  INFLUENCER_COLLECTION: "Colecție influencer",
};

const FUNDING_LABELS = {
  PLATFORM: "Artfest",
  VENDOR: "Vendor",
  SHARED: "Mixt (Artfest + Vendor)",
};

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("ro-RO", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function formatMoney(value, currency = "RON") {
  return `${Number(value || 0).toFixed(2)} ${currency}`;
}

export default function AdminVendorDiscountCodesTab() {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [queryInput, setQueryInput] = useState("");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [fundingFilter, setFundingFilter] = useState("");
  const [scopeFilter, setScopeFilter] = useState("");

  const [selectedId, setSelectedId] = useState("");
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [toggleBusy, setToggleBusy] = useState(false);

  const [orders, setOrders] = useState([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [ordersError, setOrdersError] = useState("");

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(total / PAGE_SIZE)),
    [total]
  );

  const loadList = useCallback(
    async (targetPage = 1) => {
      setLoading(true);
      setError("");

      try {
        const params = new URLSearchParams();
        params.set("page", String(targetPage));
        params.set("pageSize", String(PAGE_SIZE));

        if (query) params.set("q", query);
        if (statusFilter) params.set("status", statusFilter);
        if (fundingFilter) params.set("funding", fundingFilter);
        if (scopeFilter) params.set("scope", scopeFilter);

        const d = await api(
          `/api/admin/vendor-discount-codes?${params.toString()}`
        );

        setItems(Array.isArray(d?.items) ? d.items : []);
        setTotal(Number(d?.total || 0));
        setPage(Number(d?.page || 1));
      } catch (err) {
        setError(
          err?.data?.message ||
            err?.message ||
            "Nu am putut încărca codurile de reducere."
        );
        setItems([]);
        setTotal(0);
      } finally {
        setLoading(false);
      }
    },
    [query, statusFilter, fundingFilter, scopeFilter]
  );

  useEffect(() => {
    loadList(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, statusFilter, fundingFilter, scopeFilter]);

  async function openDetail(id) {
    setSelectedId(id);
    setDetail(null);
    setDetailError("");
    setDetailLoading(true);
    setOrders([]);
    setOrdersError("");
    setOrdersLoading(true);

    try {
      const d = await api(
        `/api/admin/vendor-discount-codes/${encodeURIComponent(id)}`
      );
      setDetail(d?.discountCode || null);
    } catch (err) {
      setDetailError(
        err?.data?.message ||
          err?.message ||
          "Nu am putut încărca detaliile codului."
      );
    } finally {
      setDetailLoading(false);
    }

    try {
      const d = await api(
        `/api/admin/vendor-discount-codes/${encodeURIComponent(id)}/orders`
      );
      setOrders(Array.isArray(d?.items) ? d.items : []);
    } catch (err) {
      setOrdersError(
        err?.data?.message ||
          err?.message ||
          "Nu am putut încărca comenzile atribuite acestui cod."
      );
    } finally {
      setOrdersLoading(false);
    }
  }

  function closeDetail() {
    setSelectedId("");
    setDetail(null);
    setDetailError("");
    setOrders([]);
    setOrdersError("");
  }

  async function toggleActive(id) {
    setToggleBusy(true);
    setError("");
    setSuccess("");

    try {
      const d = await api(
        `/api/admin/vendor-discount-codes/${encodeURIComponent(id)}/toggle`,
        { method: "PATCH" }
      );

      setSuccess(d?.message || "Statusul a fost actualizat.");

      if (detail?.id === id) {
        setDetail(d?.discountCode || detail);
      }

      await loadList(page);
    } catch (err) {
      setError(
        err?.data?.message ||
          err?.message ||
          "Nu am putut modifica statusul codului."
      );
    } finally {
      setToggleBusy(false);
    }
  }

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <div className={styles.headerText}>
          <h3 className={styles.title}>Coduri de reducere (vendor)</h3>

          <p className={styles.subtitle}>
            Toate codurile de reducere create de vendori — cine finanțează
            fiecare reducere (Artfest / vendor / mixt) și cum sunt folosite.
            Codurile influencerilor au propriul tab, separat.
          </p>
        </div>
      </div>

      <div className={styles.filters}>
        <input
          type="search"
          className={styles.searchInput}
          placeholder="Caută după cod sau magazin…"
          value={queryInput}
          onChange={(e) => setQueryInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              setQuery(queryInput.trim());
            }
          }}
        />

        <button
          type="button"
          className={styles.secondaryButton}
          onClick={() => setQuery(queryInput.trim())}
        >
          Caută
        </button>

        <select
          className={styles.selectInput}
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="">Toate statusurile</option>
          <option value="active">Activ</option>
          <option value="inactive">Inactiv</option>
        </select>

        <select
          className={styles.selectInput}
          value={fundingFilter}
          onChange={(e) => setFundingFilter(e.target.value)}
        >
          <option value="">Orice finanțare</option>
          <option value="PLATFORM">Artfest</option>
          <option value="VENDOR">Vendor</option>
          <option value="SHARED">Mixt</option>
        </select>

        <select
          className={styles.selectInput}
          value={scopeFilter}
          onChange={(e) => setScopeFilter(e.target.value)}
        >
          <option value="">Orice scope</option>
          <option value="ALL_PRODUCTS">Toate produsele</option>
          <option value="VENDOR_COLLECTION">Colecție vendor</option>
        </select>

        <button
          type="button"
          className={styles.secondaryButton}
          onClick={() => loadList(page)}
        >
          Reîncarcă
        </button>
      </div>

      {error && <div className={styles.error}>{error}</div>}
      {success && <div className={styles.success}>{success}</div>}

      {loading ? (
        <div className={styles.loading}>Se încarcă…</div>
      ) : !items.length ? (
        <div className={styles.emptyState}>
          <div className={styles.emptyTitle}>
            Niciun cod de reducere vendor găsit
          </div>
          <div className={styles.emptyText}>
            Nu există coduri de reducere create de vendori care să
            corespundă filtrelor curente.
          </div>
        </div>
      ) : (
        <>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Cod</th>
                  <th>Magazin</th>
                  <th>Status</th>
                  <th>Scope</th>
                  <th>Reducere totală</th>
                  <th>Artfest suportă</th>
                  <th>Vendor suportă</th>
                  <th>Utilizări</th>
                  <th>Valabilitate</th>
                  <th>Creat</th>
                </tr>
              </thead>

              <tbody>
                {items.map((item) => (
                  <tr
                    key={item.id}
                    className={styles.clickableRow}
                    onClick={() => openDetail(item.id)}
                  >
                    <td>
                      <span className={styles.code}>{item.code}</span>
                    </td>

                    <td>{item.vendor?.displayName || "—"}</td>

                    <td>
                      <span
                        className={`${styles.status} ${
                          item.isActive
                            ? styles.statusActive
                            : styles.statusInactive
                        }`}
                      >
                        {item.isActive ? "ACTIV" : "INACTIV"}
                      </span>
                    </td>

                    <td>{SCOPE_LABELS[item.scope] || item.scope}</td>

                    <td>{item.totalDiscountPercent}%</td>
                    <td>{item.artfestDiscountPercent}%</td>
                    <td>{item.vendorDiscountPercent}%</td>

                    <td>
                      {item.usedCount || 0}
                      {item.usageLimit ? ` / ${item.usageLimit}` : ""}
                    </td>

                    <td>
                      {item.startsAt ? formatDate(item.startsAt) : "imediat"}
                      {item.endsAt
                        ? ` – ${formatDate(item.endsAt)}`
                        : " – nelimitat"}
                    </td>

                    <td>{formatDate(item.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className={styles.pagination}>
            <span>
              Pagina {page} din {totalPages} · {total} coduri
            </span>

            <div className={styles.paginationBtns}>
              <button
                type="button"
                className={styles.secondaryButton}
                disabled={page <= 1}
                onClick={() => loadList(page - 1)}
              >
                &larr; Anterioară
              </button>

              <button
                type="button"
                className={styles.secondaryButton}
                disabled={page >= totalPages}
                onClick={() => loadList(page + 1)}
              >
                Următoarea &rarr;
              </button>
            </div>
          </div>
        </>
      )}

      {selectedId &&
        createPortal(
          <DiscountCodeDrawer
            loading={detailLoading}
            error={detailError}
            item={detail}
            toggleBusy={toggleBusy}
            onClose={closeDetail}
            onToggle={() => toggleActive(selectedId)}
            orders={orders}
            ordersLoading={ordersLoading}
            ordersError={ordersError}
          />,
          document.body
        )}
    </div>
  );
}

function DiscountCodeDrawer({
  loading,
  error,
  item,
  toggleBusy,
  onClose,
  onToggle,
  orders,
  ordersLoading,
  ordersError,
}) {
  return (
    <div
      className={styles.drawerOverlay}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <aside className={styles.drawer} aria-label="Detalii cod de reducere">
        <div className={styles.drawerHeader}>
          <div>
            <h3 className={styles.drawerTitle}>
              {item?.code || "Cod de reducere"}
            </h3>
            <div className={styles.drawerSub}>
              {item?.vendor?.displayName || "—"}
            </div>
          </div>

          <button
            type="button"
            className={styles.drawerClose}
            onClick={onClose}
            aria-label="Închide"
          >
            ×
          </button>
        </div>

        <div className={styles.drawerBody}>
          {loading ? (
            <div className={styles.loading}>Se încarcă…</div>
          ) : error ? (
            <div className={styles.error}>{error}</div>
          ) : !item ? null : (
            <>
              <section className={styles.drawerSection}>
                <h4>Detalii</h4>

                <DrawerField label="Magazin" value={item.vendor?.displayName} />
                <DrawerField label="Oraș" value={item.vendor?.city} />

                <DrawerField label="Status">
                  <span
                    className={`${styles.status} ${
                      item.isActive ? styles.statusActive : styles.statusInactive
                    }`}
                  >
                    {item.isActive ? "ACTIV" : "INACTIV"}
                  </span>
                </DrawerField>

                <DrawerField
                  label="Scope"
                  value={SCOPE_LABELS[item.scope] || item.scope}
                />

                {item.collection && (
                  <DrawerField
                    label="Colecție"
                    value={`${item.collection.title}${
                      item.collection.isActive ? "" : " (inactivă)"
                    }`}
                  />
                )}
              </section>

              <section className={styles.drawerSection}>
                <h4>Reducere</h4>

                <DrawerField
                  label="Reducere totală"
                  value={`${item.totalDiscountPercent}%`}
                />
                <DrawerField
                  label="Artfest suportă"
                  value={`${item.artfestDiscountPercent}%`}
                />
                <DrawerField
                  label="Vendor suportă"
                  value={`${item.vendorDiscountPercent}%`}
                />

                <DrawerField
                  label="Finanțare"
                  value={FUNDING_LABELS[item.fundingSource] || item.fundingSource}
                />
              </section>

              {Array.isArray(item.eligibleProducts) &&
                item.eligibleProducts.length > 0 && (
                  <section className={styles.drawerSection}>
                    <h4>Produse eligibile ({item.eligibleProducts.length})</h4>

                    <div className={styles.productGrid}>
                      {item.eligibleProducts.map((product) => (
                        <a
                          key={product.id}
                          href={product.link}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={styles.productRow}
                        >
                          <div className={styles.productThumb}>
                            {product.imageUrl && (
                              <img src={product.imageUrl} alt="" />
                            )}
                          </div>

                          <div className={styles.productInfo}>
                            <div className={styles.productTitle}>
                              {product.title}
                            </div>
                            <div className={styles.productMeta}>
                              {formatMoney(
                                Number(product.priceCents || 0) / 100
                              )}
                              {!product.isActive || product.isHidden
                                ? " · inactiv"
                                : ""}
                            </div>
                          </div>
                        </a>
                      ))}
                    </div>
                  </section>
                )}

              {item.stats && (
                <section className={styles.drawerSection}>
                  <h4>Statistici (calculate live, din comenzi reale)</h4>

                  <DrawerField label="Comenzi generate" value={item.stats.ordersCount} />
                  <DrawerField
                    label="Valoare vânzări"
                    value={formatMoney(item.stats.salesValue)}
                  />
                  <DrawerField
                    label="Reducere totală oferită"
                    value={formatMoney(item.stats.totalDiscount)}
                  />
                  <DrawerField
                    label="Artfest a suportat"
                    value={formatMoney(item.stats.artfestFunded)}
                  />
                  <DrawerField
                    label="Vendorul a suportat"
                    value={formatMoney(item.stats.vendorFunded)}
                  />
                  <DrawerField
                    label="Net vendor generat"
                    value={formatMoney(item.stats.vendorNetGenerated)}
                  />
                </section>
              )}

              <section className={styles.drawerSection}>
                <h4>Utilizare</h4>

                <DrawerField
                  label="Folosit de"
                  value={`${item.usedCount || 0} ori${
                    item.usageLimit ? ` din ${item.usageLimit}` : ""
                  }`}
                />

                <DrawerField
                  label="Limită / client"
                  value={item.usageLimitPerUser ?? "nelimitat"}
                />

                <DrawerField
                  label="Valabil de la"
                  value={item.startsAt ? formatDate(item.startsAt) : "imediat"}
                />

                <DrawerField
                  label="Valabil până la"
                  value={item.endsAt ? formatDate(item.endsAt) : "nelimitat"}
                />

                <DrawerField label="Creat la" value={formatDate(item.createdAt)} />
                <DrawerField
                  label="Actualizat la"
                  value={formatDate(item.updatedAt)}
                />
              </section>

              {Array.isArray(item.recentRedemptions) &&
                item.recentRedemptions.length > 0 && (
                  <section className={styles.drawerSection}>
                    <h4>
                      Ultimele comenzi ({item.recentRedemptions.length})
                    </h4>

                    {item.recentRedemptions.map((r) => (
                      <DrawerField
                        key={r.id}
                        label={formatDate(r.createdAt)}
                        value={`Comanda ${r.orderId} · −${formatMoney(
                          r.discountAmount
                        )}`}
                      />
                    ))}
                  </section>
                )}

              <section className={styles.drawerSection}>
                <h4>Comenzi/componente atribuite</h4>

                {ordersLoading ? (
                  <div className={styles.loading}>Se încarcă…</div>
                ) : ordersError ? (
                  <div className={styles.error}>{ordersError}</div>
                ) : !orders.length ? (
                  <div className={styles.subText}>
                    Nicio comandă atribuită încă acestui cod.
                  </div>
                ) : (
                  orders.map((row) => (
                    <AttributionOrderRow key={row.shipmentItemId} row={row} />
                  ))
                )}
              </section>

              <section className={styles.drawerSection}>
                <h4>Magazin</h4>

                <a
                  href="/admin"
                  className={styles.drawerBtnSecondary}
                  style={{ display: "inline-block", textDecoration: "none" }}
                >
                  Deschide Admin → Vendori
                </a>
              </section>
            </>
          )}
        </div>

        {item && (
          <div className={styles.drawerFooter}>
            <button
              type="button"
              className={styles.drawerBtnSecondary}
              disabled={toggleBusy}
              onClick={onToggle}
            >
              {toggleBusy
                ? "Se salvează…"
                : item.isActive
                ? "Dezactivează codul"
                : "Activează codul"}
            </button>
          </div>
        )}
      </aside>
    </div>
  );
}

/*
 * Rând de atribuire (comandă/componentă) - regula finală de business,
 * audit 2026-09-14. Afișează STRICT câmpurile deja calculate de
 * computeAdminAttributionRow (vendorAttributionStats.js) - niciun
 * calcul nou aici, doar formatare.
 */
const WHO_FUNDS_LABELS = {
  ARTFEST: "Artfest",
  VENDOR: "Vendor",
  SHARED: "Mixt (Artfest + Vendor)",
  NONE: "Fără discount",
};

function AttributionOrderRow({ row }) {
  const isOwnSale = row.promotionType === "OWN_SALE";

  return (
    <div className={styles.attributionRow}>
      <div className={styles.attributionRowHeader}>
        <strong>{row.orderNumber || "—"}</strong>
        <span
          className={
            isOwnSale ? styles.badgeOwnSale : styles.badgeCrossVendor
          }
        >
          {isOwnSale ? "OWN_SALE" : "CROSS_VENDOR"}
        </span>
        <span className={styles.subText}>{row.shipmentStatus || "—"}</span>
      </div>

      <DrawerField
        label="Seller"
        value={row.sellerVendor?.displayName || row.sellingVendor?.displayName}
      />
      <DrawerField
        label="Promoter"
        value={row.promoterVendor?.displayName}
      />

      <DrawerField label="Valoare brută" value={formatMoney(row.grossValue)} />
      <DrawerField
        label="Discount aplicat"
        value={formatMoney(row.discountAmount)}
      />
      <DrawerField
        label="Cine suportă discountul"
        value={WHO_FUNDS_LABELS[row.whoFundsDiscount] || "—"}
      />

      <DrawerField
        label="Comision Artfest brut"
        value={formatMoney(row.artfestCommissionGross)}
      />

      {isOwnSale ? (
        <DrawerField
          label="Beneficiu comision redus"
          value={formatMoney(row.ownSaleBenefit)}
        />
      ) : (
        <>
          <DrawerField
            label="Procent promoter"
            value={
              row.promoterPercent != null ? `${row.promoterPercent}%` : "—"
            }
          />
          <DrawerField
            label="Remunerație promoter"
            value={formatMoney(row.promoterEarning)}
          />
        </>
      )}

      <DrawerField label="Net Artfest" value={formatMoney(row.netArtfest)} />
      <DrawerField label="Net seller" value={formatMoney(row.netSeller)} />
    </div>
  );
}

function DrawerField({ label, value, children }) {
  return (
    <div className={styles.drawerField}>
      <span>{label}</span>
      <div>{children ?? value ?? "—"}</div>
    </div>
  );
}
