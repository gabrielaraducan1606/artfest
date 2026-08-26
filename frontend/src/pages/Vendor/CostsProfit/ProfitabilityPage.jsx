// src/pages/Vendor/CostsProfit/ProfitabilityPage.jsx

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import styles from "./ProfitabilityPage.module.css";
import { fetchProductProfitability } from "./productProfitabilityApi.js";
import { formatRonFromCents } from "./formatMoney.js";

/* =========================================================
   Constante
========================================================= */

const FILTER_OPTIONS = [
  { value: "", label: "Toate" },
  { value: "no_costing", label: "Fără costing" },
  { value: "draft", label: "Draft" },
  { value: "confirmed", label: "Confirmat" },
  {
    value: "needs_recalculation",
    label: "Necesită recalculare",
  },
  {
    value: "below_min_price",
    label: "Preț sub cost",
  },
];

const SORT_OPTIONS = [
  { value: "name", label: "Nume produs" },
  { value: "totalRealCost", label: "Cost real" },
  { value: "profit", label: "Profit estimat" },
  {
    value: "recommendedPrice",
    label: "Preț recomandat",
  },
  {
    value: "lastRecalculated",
    label: "Ultima recalculare",
  },
];

const PAGE_SIZE = 20;

/* =========================================================
   Helpers
========================================================= */

function getBadges(item) {
  const badges = [];

  if (!item.hasCosting) {
    badges.push({
      key: "no-costing",
      label: "Fără costing",
      tone: "muted",
    });
  } else if (item.costingStatus === "CONFIRMED") {
    badges.push({
      key: "confirmed",
      label: "Confirmat",
      tone: "success",
    });
  } else {
    badges.push({
      key: "draft",
      label: "Draft",
      tone: "warning",
    });
  }

  if (item.needsRecalculation) {
    badges.push({
      key: "needs-recalc",
      label: "Necesită recalculare",
      tone: "warning",
    });
  }

  if (
    item.hasCosting &&
    item.minPriceCents > 0 &&
    item.priceCents < item.minPriceCents
  ) {
    badges.push({
      key: "below-min",
      label: "Preț sub cost",
      tone: "danger",
    });
  }

  return badges;
}

function formatDate(value) {
  if (!value) return "—";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";

  return date.toLocaleDateString("ro-RO");
}

/* =========================================================
   Componentă
========================================================= */

export default function ProfitabilityPage() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [filter, setFilter] = useState("");
  const [sortBy, setSortBy] = useState("name");
  const [sortDir, setSortDir] = useState("asc");
  const [page, setPage] = useState(1);

  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setLoading(true);
        setError("");

        const data = await fetchProductProfitability({
          page,
          pageSize: PAGE_SIZE,
          filter,
          sortBy,
          sortDir,
        });

        if (cancelled) return;

        setItems(data.items);
        setTotal(data.total);
        setTotalPages(data.totalPages);
      } catch (err) {
        if (cancelled) return;

        setError(
          err?.message ||
            "Nu am putut încărca datele de profitabilitate."
        );
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [filter, sortBy, sortDir, page]);

  function handleFilterChange(value) {
    setFilter(value);
    setPage(1);
  }

  function handleSortByChange(value) {
    setSortBy(value);
    setPage(1);
  }

  function toggleSortDir() {
    setSortDir((current) =>
      current === "asc" ? "desc" : "asc"
    );
    setPage(1);
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>
            Costuri &amp; Profit
          </h1>

          <p className={styles.subtitle}>
            Vezi dintr-o privire ce produse au costing
            calculat, ce marjă au și unde prețul actual nu
            acoperă costurile reale.
          </p>
        </div>
      </div>

      <div className={styles.filters}>
        <div className={styles.typeTabs}>
          {FILTER_OPTIONS.map((option) => (
            <button
              key={option.value || "all"}
              type="button"
              className={
                filter === option.value
                  ? styles.typeTabActive
                  : styles.typeTab
              }
              onClick={() =>
                handleFilterChange(option.value)
              }
            >
              {option.label}
            </button>
          ))}
        </div>

        <div className={styles.filtersRight}>
          <select
            className={styles.select}
            value={sortBy}
            onChange={(e) =>
              handleSortByChange(e.target.value)
            }
          >
            {SORT_OPTIONS.map((option) => (
              <option
                key={option.value}
                value={option.value}
              >
                Sortează după: {option.label}
              </option>
            ))}
          </select>

          <button
            type="button"
            className={styles.btnGhost}
            onClick={toggleSortDir}
            title="Schimbă direcția sortării"
          >
            {sortDir === "asc" ? "↑ Crescător" : "↓ Descrescător"}
          </button>
        </div>
      </div>

      {error && (
        <div className={styles.errorBar}>{error}</div>
      )}

      {loading ? (
        <div className={styles.emptyState}>Se încarcă...</div>
      ) : items.length === 0 ? (
        <div className={styles.emptyState}>
          <p>
            Nu am găsit produse pentru acest filtru.
          </p>
        </div>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Produs</th>
                <th>Preț actual</th>
                <th>Cost real</th>
                <th>Preț minim</th>
                <th>Preț recomandat</th>
                <th>Profit estimat</th>
                <th>Net după comision</th>
                <th>Status</th>
                <th aria-label="Acțiuni" />
              </tr>
            </thead>

            <tbody>
              {items.map((item) => (
                <tr key={item.productId}>
                  <td>
                    <Link
                      to={`/vendor/costs-profit/${item.productId}`}
                      className={styles.productCell}
                    >
                      {item.image ? (
                        <img
                          src={item.image}
                          alt=""
                          className={styles.productThumb}
                        />
                      ) : (
                        <div
                          className={
                            styles.productThumbPlaceholder
                          }
                        />
                      )}

                      <span
                        className={styles.productTitle}
                      >
                        {item.title}
                      </span>
                    </Link>
                  </td>

                  <td>
                    {formatRonFromCents(
                      item.priceCents
                    )}
                  </td>

                  <td>
                    {item.hasCosting
                      ? formatRonFromCents(
                          item.totalRealCostCents
                        )
                      : "—"}
                  </td>

                  <td>
                    {item.hasCosting
                      ? formatRonFromCents(
                          item.minPriceCents
                        )
                      : "—"}
                  </td>

                  <td>
                    {item.hasCosting
                      ? formatRonFromCents(
                          item.recommendedPriceCents
                        )
                      : "—"}
                  </td>

                  <td>
                    {item.hasCosting
                      ? formatRonFromCents(
                          item.estimatedProfitCents
                        )
                      : "—"}
                  </td>

                  <td>
                    {item.hasCosting
                      ? formatRonFromCents(
                          item.vendorNetCents
                        )
                      : "—"}
                  </td>

                  <td>
                    <div
                      className={styles.badgeStack}
                    >
                      {getBadges(item).map(
                        (badge) => (
                          <span
                            key={badge.key}
                            className={`${styles.badge} ${
                              styles[
                                `badge_${badge.tone}`
                              ]
                            }`}
                          >
                            {badge.label}
                          </span>
                        )
                      )}
                    </div>

                    <small
                      className={styles.lastCalc}
                    >
                      {item.lastCalculatedAt
                        ? `Recalculat: ${formatDate(
                            item.lastCalculatedAt
                          )}`
                        : "Niciodată calculat"}
                    </small>
                  </td>

                  <td className={styles.actionsCell}>
                    <Link
                      to={`/vendor/costs-profit/${item.productId}`}
                      className={styles.btnGhost}
                    >
                      Vezi costing
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && items.length > 0 && (
        <div className={styles.pagination}>
          <button
            type="button"
            className={styles.btnGhost}
            onClick={() =>
              setPage((p) => Math.max(1, p - 1))
            }
            disabled={page <= 1}
          >
            ← Anterior
          </button>

          <span className={styles.pageInfo}>
            Pagina {page} din {totalPages} ·{" "}
            {total} produse
          </span>

          <button
            type="button"
            className={styles.btnGhost}
            onClick={() =>
              setPage((p) =>
                Math.min(totalPages, p + 1)
              )
            }
            disabled={page >= totalPages}
          >
            Următor →
          </button>
        </div>
      )}
    </div>
  );
}
