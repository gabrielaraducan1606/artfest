import { useEffect, useState } from "react";
import { FaTimes } from "react-icons/fa";
import styles from "../ProfilMagazin.module.css";
import { storeCampaignAttribution } from "../../../../utils/campaignAttribution.js";

function money(value) {
  const number = Number(value || 0);

  return new Intl.NumberFormat("ro-RO", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(
    Number.isFinite(number)
      ? number
      : 0
  );
}

export default function PublicCampaignModal({
  open,
  campaign,
  onClose,
  navigate,
}) {
  const [details, setDetails] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const campaignSlug = campaign?.slug || null;

  useEffect(() => {
    if (!open || !campaignSlug) {
      return;
    }

    let alive = true;
    const controller = new AbortController();

    async function loadCampaign() {
      setLoading(true);
      setError("");
      setDetails(null);

      try {
        const response = await fetch(
          `/api/public/campaigns/${encodeURIComponent(
            campaignSlug
          )}`,
          {
            method: "GET",
            headers: {
              Accept: "application/json",
            },
            signal: controller.signal,
          }
        );

        let data = null;

        try {
          data = await response.json();
        } catch {
          data = null;
        }

        if (!response.ok) {
          throw new Error(
            data?.message ||
              data?.error ||
              "Colecția nu a putut fi încărcată."
          );
        }

        if (!alive) {
          return;
        }

        setDetails(data);

        if (data?.campaign?.attributionToken && data?.vendor?.id) {
          storeCampaignAttribution({
            vendorId: data.vendor.id,
            token: data.campaign.attributionToken,
            campaignId: data.campaign.id,
            slug: data.campaign.slug,
            attributionWindowHours:
              data.campaign.attributionWindowHours,
          });
        }
      } catch (requestError) {
        if (requestError?.name === "AbortError") {
          return;
        }

        console.error(
          "[PublicCampaignModal] load:",
          requestError
        );

        if (alive) {
          setError(
            requestError?.message ||
              "Colecția nu a putut fi încărcată."
          );
        }
      } finally {
        if (alive) {
          setLoading(false);
        }
      }
    }

    loadCampaign();

    return () => {
      alive = false;
      controller.abort();
    };
  }, [open, campaignSlug]);

  useEffect(() => {
    if (!open) {
      return;
    }

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        onClose?.();
      }
    }

    const previousOverflow =
      document.body.style.overflow;

    document.body.style.overflow = "hidden";

    document.addEventListener(
      "keydown",
      handleKeyDown
    );

    return () => {
      document.body.style.overflow =
        previousOverflow;

      document.removeEventListener(
        "keydown",
        handleKeyDown
      );
    };
  }, [open, onClose]);

  if (!open || !campaign) {
    return null;
  }

  function handleBackdropClick(event) {
    if (event.target === event.currentTarget) {
      onClose?.();
    }
  }

  function handleGoToFullCampaign() {
    if (!campaignSlug) {
      return;
    }

    onClose?.();

    navigate?.(
      `/c/${encodeURIComponent(campaignSlug)}`
    );
  }

  const campaignData =
    details?.campaign ||
    campaign;

  const products =
    Array.isArray(details?.products)
      ? details.products
      : [];

  return (
    <div
      className={styles.publicCampaignBackdrop}
      onMouseDown={handleBackdropClick}
      role="presentation"
    >
      <div
        className={styles.publicCampaignModal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="public-campaign-title"
      >
        <div className={styles.publicCampaignHeader}>
          <div>
            <span className={styles.publicCampaignEyebrow}>
              Colecția creatorului
            </span>

            <h2
              id="public-campaign-title"
              className={styles.publicCampaignTitle}
            >
              {campaignData?.name ||
                "Colecție"}
            </h2>

            {Number(
              campaignData?.discountPercent || 0
            ) > 0 && (
              <div
                className={
                  styles.publicCampaignDiscount
                }
              >
                {campaignData.discountPercent}% reducere
                pentru produsele eligibile
              </div>
            )}
          </div>

          <button
            type="button"
            className={styles.publicCampaignClose}
            onClick={onClose}
            aria-label="Închide"
            title="Închide"
          >
            <FaTimes />
          </button>
        </div>

        <div className={styles.publicCampaignBody}>
          {loading ? (
            <div className={styles.publicCampaignState}>
              Se încarcă produsele...
            </div>
          ) : error ? (
            <div
              className={`${styles.publicCampaignState} ${styles.publicCampaignError}`}
            >
              {error}
            </div>
          ) : products.length ? (
            <div className={styles.publicCampaignProducts}>
              {products.map((product) => (
                <div
                  key={product.id}
                  className={styles.publicCampaignProduct}
                >
                  <div
                    className={
                      styles.publicCampaignProductImageWrap
                    }
                  >
                    {product.image ? (
                      <img
                        src={product.image}
                        alt={product.title || ""}
                        className={
                          styles.publicCampaignProductImage
                        }
                        loading="lazy"
                      />
                    ) : (
                      <div
                        className={
                          styles.publicCampaignProductPlaceholder
                        }
                      >
                        📦
                      </div>
                    )}
                  </div>

                  <div
                    className={
                      styles.publicCampaignProductBody
                    }
                  >
                    <strong>
                      {product.title ||
                        "Produs"}
                    </strong>

                    {product.category && (
                      <span
                        className={
                          styles.publicCampaignProductCategory
                        }
                      >
                        {product.category}
                      </span>
                    )}

                    <div
                      className={
                        styles.publicCampaignProductPrice
                      }
                    >
                      {money(product.price)}{" "}
                      {product.currency || "RON"}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className={styles.publicCampaignState}>
              Colecția nu are momentan produse disponibile.
            </div>
          )}
        </div>

        <div className={styles.publicCampaignFooter}>
          <button
            type="button"
            className={styles.campaignModalSecondary}
            onClick={onClose}
          >
            Închide
          </button>

          <button
            type="button"
            className={styles.campaignModalPrimary}
            onClick={handleGoToFullCampaign}
          >
            Vezi campania completă →
          </button>
        </div>
      </div>
    </div>
  );
}