import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

import { api } from "../../../lib/api.js";

import styles from "./AdminVendorMarketingTab.module.css";

const PAGE_SIZE = 25;

const SCOPE_LABELS = {
  ALL_PRODUCTS: "Toate produsele vendorului",
  SELECTED_PRODUCTS: "Produse selectate",
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

export default function AdminVendorCampaignsTab() {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [queryInput, setQueryInput] = useState("");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
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
        if (scopeFilter) params.set("scope", scopeFilter);

        const d = await api(
          `/api/admin/vendor-campaigns?${params.toString()}`
        );

        setItems(Array.isArray(d?.items) ? d.items : []);
        setTotal(Number(d?.total || 0));
        setPage(Number(d?.page || 1));
      } catch (err) {
        setError(
          err?.data?.message ||
            err?.message ||
            "Nu am putut încărca campaniile."
        );
        setItems([]);
        setTotal(0);
      } finally {
        setLoading(false);
      }
    },
    [query, statusFilter, scopeFilter]
  );

  useEffect(() => {
    loadList(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, statusFilter, scopeFilter]);

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
        `/api/admin/vendor-campaigns/${encodeURIComponent(id)}`
      );
      setDetail(d?.campaign || null);
    } catch (err) {
      setDetailError(
        err?.data?.message ||
          err?.message ||
          "Nu am putut încărca detaliile campaniei."
      );
    } finally {
      setDetailLoading(false);
    }

    try {
      const d = await api(
        `/api/admin/vendor-campaigns/${encodeURIComponent(id)}/orders`
      );
      setOrders(Array.isArray(d?.items) ? d.items : []);
    } catch (err) {
      setOrdersError(
        err?.data?.message ||
          err?.message ||
          "Nu am putut încărca comenzile atribuite acestei campanii."
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

  async function toggleActive(id, nextActive) {
    setToggleBusy(true);
    setError("");
    setSuccess("");

    try {
      const d = await api(
        `/api/admin/vendor-campaigns/${encodeURIComponent(id)}/status`,
        { method: "PATCH", body: { active: nextActive } }
      );

      setSuccess(d?.message || "Statusul a fost actualizat.");

      if (detail?.id === id) {
        setDetail(d?.campaign || detail);
      }

      await loadList(page);
    } catch (err) {
      setError(
        err?.data?.message ||
          err?.message ||
          "Nu am putut modifica statusul campaniei."
      );
    } finally {
      setToggleBusy(false);
    }
  }

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <div className={styles.headerText}>
          <h3 className={styles.title}>Campanii (vendor)</h3>

          <p className={styles.subtitle}>
            Campaniile de promovare create de vendori (VendorCampaign) —
            discount, comision, produse incluse și performanță de bază.
            Separat de campaniile/colecțiile influencerilor.
          </p>
        </div>
      </div>

      <div className={styles.filters}>
        <input
          type="search"
          className={styles.searchInput}
          placeholder="Caută după titlu sau magazin…"
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
          <option value="active">Activă</option>
          <option value="inactive">Inactivă</option>
        </select>

        <select
          className={styles.selectInput}
          value={scopeFilter}
          onChange={(e) => setScopeFilter(e.target.value)}
        >
          <option value="">Orice scope</option>
          <option value="ALL_PRODUCTS">Toate produsele</option>
          <option value="SELECTED_PRODUCTS">Produse selectate</option>
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
          <div className={styles.emptyTitle}>Nicio campanie vendor găsită</div>
          <div className={styles.emptyText}>
            Nu există campanii create de vendori care să corespundă
            filtrelor curente.
          </div>
        </div>
      ) : (
        <>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Titlu</th>
                  <th>Magazin</th>
                  <th>Status</th>
                  <th>Perioadă</th>
                  <th>Discount</th>
                  <th>Comision</th>
                  <th>Produse</th>
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
                    <td>{item.name}</td>
                    <td>{item.vendor?.displayName || "—"}</td>

                    <td>
                      <span
                        className={`${styles.status} ${
                          item.isActive
                            ? styles.statusActive
                            : styles.statusInactive
                        }`}
                      >
                        {item.isActive ? "ACTIVĂ" : "INACTIVĂ"}
                      </span>
                    </td>

                    <td>
                      {item.startsAt ? formatDate(item.startsAt) : "imediat"}
                      {item.endsAt
                        ? ` – ${formatDate(item.endsAt)}`
                        : " – nelimitat"}
                    </td>

                    <td>
                      {item.discountPercent}%
                      {Number(item.discountPercent || 0) > 0 && (
                        <div className={styles.subText}>
                          Artfest {item.artfestDiscountPercent ?? 0}% · Vendor{" "}
                          {item.vendorDiscountPercent ?? item.discountPercent ?? 0}
                          %
                        </div>
                      )}
                    </td>
                    <td>{item.commissionPercent}%</td>
                    <td>{item.productsCount}</td>
                    <td>{formatDate(item.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className={styles.pagination}>
            <span>
              Pagina {page} din {totalPages} · {total} campanii
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
          <CampaignDrawer
            loading={detailLoading}
            error={detailError}
            item={detail}
            toggleBusy={toggleBusy}
            onClose={closeDetail}
            onToggle={(nextActive) => toggleActive(selectedId, nextActive)}
            orders={orders}
            ordersLoading={ordersLoading}
            ordersError={ordersError}
          />,
          document.body
        )}
    </div>
  );
}

function CampaignDrawer({
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
      <aside className={styles.drawer} aria-label="Detalii campanie">
        <div className={styles.drawerHeader}>
          <div>
            <h3 className={styles.drawerTitle}>{item?.name || "Campanie"}</h3>
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
                    {item.isActive ? "ACTIVĂ" : "INACTIVĂ"}
                  </span>
                </DrawerField>

                <DrawerField
                  label="Scope"
                  value={SCOPE_LABELS[item.scope] || item.scope}
                />

                {item.publicPath && (
                  <DrawerField label="Link public">
                    <a
                      href={item.publicPath}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {item.publicPath}
                    </a>
                  </DrawerField>
                )}
              </section>

              <section className={styles.drawerSection}>
                <h4>Discount &amp; comision</h4>

                <DrawerField
                  label="Discount client (total)"
                  value={`${item.discountPercent}%`}
                />
                <DrawerField
                  label="Artfest suportă"
                  value={`${item.artfestDiscountPercent ?? 0}%`}
                />
                <DrawerField
                  label="Vendor suportă"
                  value={`${
                    item.vendorDiscountPercent ?? item.discountPercent ?? 0
                  }%`}
                />
                <DrawerField
                  label="Comision campanie"
                  value={`${item.commissionPercent}% (${item.commissionBps} bps)`}
                />
                <DrawerField
                  label="Fereastră atribuire"
                  value={`${item.attributionWindowHours} ore`}
                />
              </section>

              <section className={styles.drawerSection}>
                <h4>Performanță</h4>

                <DrawerField label="Vizite" value={item.visits} />
                <DrawerField
                  label="Comenzi atribuite"
                  value={item.attributedOrdersCount}
                />
                <DrawerField
                  label="Venit atribuit"
                  value={formatMoney(item.attributedRevenue)}
                />
                {item.discountGiven != null && (
                  <DrawerField
                    label="Discount acordat prin campanie"
                    value={formatMoney(item.discountGiven)}
                  />
                )}
                {item.artfestFunded != null && (
                  <DrawerField
                    label="Din care suportat de Artfest"
                    value={formatMoney(item.artfestFunded)}
                  />
                )}
                {item.vendorFunded != null && (
                  <DrawerField
                    label="Din care suportat de vendor"
                    value={formatMoney(item.vendorFunded)}
                  />
                )}
                {item.vendorNetGenerated != null && (
                  <DrawerField
                    label="Net vendor generat"
                    value={formatMoney(item.vendorNetGenerated)}
                  />
                )}
              </section>

              <section className={styles.drawerSection}>
                <h4>Perioadă</h4>

                <DrawerField
                  label="Începe la"
                  value={item.startsAt ? formatDate(item.startsAt) : "imediat"}
                />
                <DrawerField
                  label="Expiră la"
                  value={item.endsAt ? formatDate(item.endsAt) : "nelimitat"}
                />
                <DrawerField label="Creat la" value={formatDate(item.createdAt)} />
                <DrawerField
                  label="Actualizat la"
                  value={formatDate(item.updatedAt)}
                />
              </section>

              <section className={styles.drawerSection}>
                <h4>
                  Produse incluse (
                  {Array.isArray(item.products) ? item.products.length : 0})
                </h4>

                {!item.products?.length ? (
                  <div className={styles.emptyText}>
                    Campania se aplică fără o listă explicită de produse
                    (scope „{SCOPE_LABELS[item.scope] || item.scope}”) sau nu
                    are încă produse asociate.
                  </div>
                ) : (
                  <div className={styles.productGrid}>
                    {item.products.map((product) => (
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
                            {formatMoney(Number(product.priceCents || 0) / 100)}
                            {!product.isActive || product.isHidden
                              ? " · inactiv"
                              : ""}
                          </div>
                        </div>
                      </a>
                    ))}
                  </div>
                )}
              </section>

              <section className={styles.drawerSection}>
                <h4>Comenzi/componente atribuite</h4>

                {ordersLoading ? (
                  <div className={styles.loading}>Se încarcă…</div>
                ) : ordersError ? (
                  <div className={styles.error}>{ordersError}</div>
                ) : !orders.length ? (
                  <div className={styles.subText}>
                    Nicio comandă atribuită încă acestei campanii.
                  </div>
                ) : (
                  orders.map((row) => (
                    <CampaignAttributionRow key={row.shipmentId} row={row} />
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
              onClick={() => onToggle(!item.isActive)}
            >
              {toggleBusy
                ? "Se salvează…"
                : item.isActive
                ? "Dezactivează campania"
                : "Activează campania"}
            </button>
          </div>
        )}
      </aside>
    </div>
  );
}

/*
 * Rând de atribuire (comandă/componentă) - regula finală de business,
 * audit 2026-09-14. VendorCampaign e tehnic doar own-products
 * (validateOwnedProducts), deci promotionType e mereu OWN_SALE aici -
 * afișat totuși explicit, pentru consistență cu tab-ul de coduri.
 * Câmpurile vin STRICT din computeAdminAttributionRow
 * (vendorAttributionStats.js) - niciun calcul nou, doar formatare.
 */
function CampaignAttributionRow({ row }) {
  const isOwnSale = row.promotionType !== "CROSS_VENDOR";

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

      <DrawerField label="Seller" value={row.sellerVendor?.displayName} />
      <DrawerField label="Promoter" value={row.promoterVendor?.displayName} />

      <DrawerField label="Valoare brută" value={formatMoney(row.grossValue)} />
      <DrawerField
        label="Discount aplicat"
        value={formatMoney(row.discountAmount)}
      />
      <DrawerField
        label="Cine suportă discountul"
        value={
          row.whoFundsDiscount === "SHARED"
            ? "Mixt (Artfest + Vendor)"
            : row.whoFundsDiscount === "ARTFEST"
            ? "Artfest"
            : row.whoFundsDiscount === "VENDOR"
            ? "Vendor"
            : "Fără discount"
        }
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
