import { useEffect } from "react";
import { FaTimes } from "react-icons/fa";
import styles from "../ProfilMagazin.module.css";

export default function StoreCampaignsModal({
  open,
  onClose,
  shopName,
  campaigns = [],
  loading = false,
  error = "",
  onGoToCampaignsPage,
}) {
  useEffect(() => {
    if (!open) {
      return;
    }

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        onClose?.();
      }
    }

    document.addEventListener(
      "keydown",
      handleKeyDown
    );

    const previousOverflow =
      document.body.style.overflow;

    document.body.style.overflow =
      "hidden";

    return () => {
      document.removeEventListener(
        "keydown",
        handleKeyDown
      );

      document.body.style.overflow =
        previousOverflow;
    };
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  function handleBackdropClick(event) {
    if (
      event.target ===
      event.currentTarget
    ) {
      onClose?.();
    }
  }

  function getProductsLabel(campaign) {
    if (
      campaign?.scope ===
      "SELECTED_PRODUCTS"
    ) {
      const count =
        Number(
          campaign?.productsCount ??
            campaign?.productIds?.length ??
            0
        ) || 0;

      return `${count} ${
        count === 1
          ? "produs selectat"
          : "produse selectate"
      }`;
    }

    return "Toate produsele";
  }

  function getCampaignStatus(campaign) {
    if (!campaign?.isActive) {
      return "Oprită";
    }

    const now = Date.now();

    if (
      campaign?.startsAt &&
      new Date(
        campaign.startsAt
      ).getTime() > now
    ) {
      return "Programată";
    }

    if (
      campaign?.endsAt &&
      new Date(
        campaign.endsAt
      ).getTime() <= now
    ) {
      return "Expirată";
    }

    return "Activă";
  }

  return (
    <div
      className={
        styles.campaignModalBackdrop
      }
      onMouseDown={
        handleBackdropClick
      }
      role="presentation"
    >
      <div
        className={
          styles.campaignModal
        }
        role="dialog"
        aria-modal="true"
        aria-labelledby="campaign-modal-title"
      >
        {/* HEADER */}
        <div
          className={
            styles.campaignModalHeader
          }
        >
          <div>
            <div
              className={
                styles.campaignModalEyebrow
              }
            >
              Magazinul tău
            </div>

            <h2
              id="campaign-modal-title"
              className={
                styles.campaignModalTitle
              }
            >
              Campanii
            </h2>

            {shopName && (
              <p
                className={
                  styles.campaignModalSubtitle
                }
              >
                {shopName}
              </p>
            )}
          </div>

          <button
            type="button"
            className={
              styles.campaignModalClose
            }
            onClick={onClose}
            aria-label="Închide"
            title="Închide"
          >
            <FaTimes />
          </button>
        </div>

        {/* BODY */}
        <div
          className={
            styles.campaignModalBody
          }
        >
          {loading ? (
            <div
              className={
                styles.campaignModalState
              }
            >
              Se încarcă campaniile...
            </div>
          ) : error ? (
            <div
              className={`${styles.campaignModalState} ${styles.campaignModalError}`}
            >
              {error}
            </div>
          ) : campaigns.length >
            0 ? (
            <div
              className={
                styles.campaignModalList
              }
            >
              {campaigns.map(
                (campaign) => {
                  const status =
                    getCampaignStatus(
                      campaign
                    );

                  const discount =
                    Number(
                      campaign?.discountPercent ||
                        0
                    );

                  return (
                    <div
                      key={
                        campaign.id
                      }
                      className={
                        styles.campaignModalItem
                      }
                    >
                      <div
                        className={
                          styles.campaignModalItemMain
                        }
                      >
                        <strong>
                          {campaign.name ||
                            campaign.title ||
                            "Campanie"}
                        </strong>

                        <span>
                          {status}
                        </span>
                      </div>

                      <div
                        className={
                          styles.campaignModalProductCount
                        }
                      >
                        {getProductsLabel(
                          campaign
                        )}
                      </div>

                      {discount > 0 && (
                        <div
                          className={
                            styles.campaignModalProductCount
                          }
                        >
                          {discount}% reducere
                          pentru client
                        </div>
                      )}

                      <div
                        style={{
                          display:
                            "flex",
                          flexWrap:
                            "wrap",
                          gap: 12,
                          marginTop: 10,
                          fontSize: 13,
                          opacity: 0.75,
                        }}
                      >
                        <span>
                          {campaign.visits ??
                            0}{" "}
                          vizite
                        </span>

                        <span>
                          {campaign.attributedOrdersCount ??
                            0}{" "}
                          comenzi
                        </span>

                        <span>
                          Comision{" "}
                          {campaign.commissionPercent ??
                            5}
                          %
                        </span>
                      </div>
                    </div>
                  );
                }
              )}
            </div>
          ) : (
            <div
              className={
                styles.campaignModalEmpty
              }
            >
              <div
                className={
                  styles.campaignModalEmptyIcon
                }
              >
                ✨
              </div>

              <strong>
                Nu ai încă nicio campanie
              </strong>

              <p>
                Creează o campanie
                pentru produsele tale și
                distribuie linkul
                propriu pe Instagram,
                Facebook, TikTok sau
                WhatsApp.
              </p>
            </div>
          )}
        </div>

        {/* FOOTER */}
        <div
          className={
            styles.campaignModalFooter
          }
        >
          <button
            type="button"
            className={
              styles.campaignModalSecondary
            }
            onClick={onClose}
          >
            Închide
          </button>

          <button
            type="button"
            className={
              styles.campaignModalPrimary
            }
            onClick={
              onGoToCampaignsPage
            }
          >
            {campaigns.length > 0
              ? "Administrează campaniile →"
              : "Creează o campanie →"}
          </button>
        </div>
      </div>
    </div>
  );
}
