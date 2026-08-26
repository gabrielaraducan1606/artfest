// src/pages/Vendor/CostsProfit/ProductCostingDetailPage.jsx

import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import styles from "./ProductCostingDetailPage.module.css";
import PricingBreakdownCard from "./components/PricingBreakdownCard.jsx";
import PhotoCostingModal from "./components/PhotoCostingModal.jsx";
import { formatRonFromCents } from "./formatMoney.js";

import {
  fetchProductCosting,
  fetchVendorProductSummary,
  confirmProductCosting,
  recalculateProductCosting,
} from "./productCostingApi.js";

import VendorPriceCalculator from "../../../components/AIAssistant/VendorAIAssistant/components/VendorPriceCalculator.jsx";

const KIND_LABELS = {
  MATERIAL: "Material",
  PACKAGING: "Ambalaj",
  OTHER: "Alt cost",
};

export default function ProductCostingDetailPage() {
  const { productId } = useParams();
  const navigate = useNavigate();

  const [product, setProduct] = useState(null);
  const [costing, setCosting] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState("");

  const [showPhotoModal, setShowPhotoModal] =
    useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError("");

      const [productSummary, costingData] =
        await Promise.all([
          fetchVendorProductSummary(productId),
          fetchProductCosting(productId),
        ]);

      setProduct(productSummary);
      setCosting(costingData);
    } catch (err) {
      setError(
        err?.message ||
          "Nu am putut încărca datele produsului."
      );
    } finally {
      setLoading(false);
    }
  }, [productId]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleConfirm() {
    if (actionBusy) return;

    setActionBusy(true);
    setActionError("");

    try {
      const updated = await confirmProductCosting(
        productId
      );

      setCosting(updated);
    } catch (err) {
      setActionError(
        err?.message ||
          "Nu am putut confirma costingul."
      );
    } finally {
      setActionBusy(false);
    }
  }

  async function handleRecalculate() {
    if (actionBusy) return;

    setActionBusy(true);
    setActionError("");

    try {
      const updated = await recalculateProductCosting(
        productId
      );

      setCosting(updated);
    } catch (err) {
      setActionError(
        err?.message ||
          "Nu am putut recalcula costingul."
      );
    } finally {
      setActionBusy(false);
    }
  }

  if (loading) {
    return (
      <div className={styles.page}>
        <div className={styles.emptyState}>
          Se încarcă...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.page}>
        <div className={styles.errorBar}>{error}</div>

        <Link
          to="/vendor/costs-profit"
          className={styles.btnGhost}
        >
          ← Înapoi la Costuri &amp; Profit
        </Link>
      </div>
    );
  }

  const belowMinPrice =
    costing?.pricing &&
    costing.pricing.minPrice > 0 &&
    (product?.price ?? 0) < costing.pricing.minPrice;

  return (
    <div className={styles.page}>
      <Link
        to="/vendor/costs-profit"
        className={styles.backLink}
      >
        ← Înapoi la Costuri &amp; Profit
      </Link>

      <div className={styles.productHeader}>
        {product?.image ? (
          <img
            src={product.image}
            alt=""
            className={styles.productImage}
          />
        ) : (
          <div
            className={styles.productImagePlaceholder}
          />
        )}

        <div>
          <h1 className={styles.title}>
            {product?.title || "Produs"}
          </h1>

          <p className={styles.subtitle}>
            Preț actual de vânzare:{" "}
            <strong>
              {formatRonFromCents(
                product?.priceCents ?? 0
              )}
            </strong>
          </p>

          {belowMinPrice && (
            <span
              className={`${styles.badge} ${styles.badge_danger}`}
            >
              Preț sub costul minim calculat
            </span>
          )}
        </div>

        <button
          type="button"
          className={styles.btnGhost}
          onClick={() => setShowPhotoModal(true)}
          style={{ marginLeft: "auto" }}
        >
          📷 Calculează din fotografie
        </button>
      </div>

      <div className={styles.columns}>
        <div className={styles.summaryColumn}>
          {costing?.pricing ? (
            <>
              <PricingBreakdownCard
                pricing={costing.pricing}
              />

              <div className={styles.itemsCard}>
                <strong className={styles.itemsTitle}>
                  Componente costing
                </strong>

                {costing.items?.length ? (
                  <ul className={styles.itemsList}>
                    {costing.items.map((item) => (
                      <li
                        key={item.id}
                        className={styles.itemRow}
                      >
                        <span
                          className={
                            styles.itemKind
                          }
                        >
                          {KIND_LABELS[item.kind] ||
                            item.kind}
                        </span>

                        <span
                          className={
                            styles.itemLabel
                          }
                        >
                          {item.label}
                          {item.quantity > 1
                            ? ` × ${item.quantity}${
                                item.unit
                                  ? ` ${item.unit}`
                                  : ""
                              }`
                            : ""}
                        </span>

                        <span
                          className={
                            styles.itemCost
                          }
                        >
                          {formatRonFromCents(
                            item.unitCostCentsSnapshot *
                              item.quantity
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className={styles.subtle}>
                    Niciun cost detaliat salvat.
                  </p>
                )}
              </div>

              <div className={styles.actionsRow}>
                {costing.status !== "CONFIRMED" && (
                  <button
                    type="button"
                    className={styles.btnPrimary}
                    onClick={handleConfirm}
                    disabled={actionBusy}
                  >
                    {actionBusy
                      ? "..."
                      : "Confirmă costingul"}
                  </button>
                )}

                <button
                  type="button"
                  className={styles.btnGhost}
                  onClick={handleRecalculate}
                  disabled={actionBusy}
                >
                  {actionBusy
                    ? "..."
                    : "Recalculează"}
                </button>
              </div>

              {actionError && (
                <div className={styles.errorBar}>
                  {actionError}
                </div>
              )}
            </>
          ) : (
            <div className={styles.emptyState}>
              Acest produs nu are încă un costing
              calculat (lipsesc cel puțin timpul de
              lucru și valoarea orei). Folosește
              asistentul din dreapta ca să-l creezi,
              sau butonul „Calculează din fotografie”
              de mai sus ca să pornești de la
              materialele identificate automat.
            </div>
          )}
        </div>

        <div className={styles.chatColumn}>
          <div className={styles.chatWrapper}>
            <VendorPriceCalculator
              productId={productId}
              onBack={() =>
                navigate("/vendor/costs-profit")
              }
              onClose={() =>
                navigate("/vendor/costs-profit")
              }
              onSaved={() => {
                load();
              }}
            />
          </div>
        </div>
      </div>

      {showPhotoModal && (
        <PhotoCostingModal
          productId={productId}
          productImageUrl={product?.image}
          onClose={() => setShowPhotoModal(false)}
          onSaved={() => {
            load();
          }}
        />
      )}
    </div>
  );
}
