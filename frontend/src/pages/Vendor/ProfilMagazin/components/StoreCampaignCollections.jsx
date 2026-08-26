import { useEffect, useMemo, useState } from "react";
import styles from "../ProfilMagazin.module.css";
import { getAttributionsForCheckout } from "../../../../utils/campaignAttribution.js";

export default function StoreCampaignCollections({
  storeSlug,
  isOwner = false,
  onOpenCampaign,
}) {
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!storeSlug) {
      console.warn(
        "[StoreCampaignCollections] lipsește storeSlug"
      );

      setCampaigns([]);
      setError("Lipsește slug-ul magazinului.");
      return;
    }

    if (isOwner) {
      setCampaigns([]);
      setError("");
      return;
    }

    let alive = true;

    const controller =
      new AbortController();

    async function loadCollections() {
      setLoading(true);
      setError("");

      /*
       * Trimitem atribuirea salvată (per vendor) ca să
       * backend-ul decidă, server-side, dacă vizitatorul
       * curent poate vedea vreo campanie a acestui magazin -
       * profilul public NU mai listează toate campaniile
       * active, doar cea atribuită (dacă există și e validă).
       */
      const url =
        `/api/public/campaigns/store/${encodeURIComponent(
          storeSlug
        )}?campaignAttribution=${encodeURIComponent(
          JSON.stringify(
            getAttributionsForCheckout()
          )
        )}`;

      console.log(
        "[StoreCampaignCollections] request:",
        url
      );

      try {
        const response =
          await fetch(url, {
            method: "GET",

            credentials:
              "include",

            headers: {
              Accept:
                "application/json",
            },

            signal:
              controller.signal,
          });

        let data = null;

        try {
          data =
            await response.json();
        } catch {
          data = null;
        }

        console.log(
          "[StoreCampaignCollections] response:",
          {
            status:
              response.status,

            ok:
              response.ok,

            storeSlug,

            data,
          }
        );

        if (!response.ok) {
          throw new Error(
            data?.message ||
              data?.error ||
              `Colecțiile nu au putut fi încărcate. HTTP ${response.status}`
          );
        }

        if (!alive) {
          return;
        }

        const items =
          Array.isArray(
            data?.items
          )
            ? data.items
            : [];

        console.log(
          "[StoreCampaignCollections] campaigns:",
          items
        );

        setCampaigns(
          items
        );
      } catch (
        requestError
      ) {
        if (
          requestError?.name ===
          "AbortError"
        ) {
          return;
        }

        console.error(
          "[StoreCampaignCollections] load error:",
          requestError
        );

        if (alive) {
          setCampaigns([]);

          setError(
            requestError?.message ||
              "Colecțiile nu au putut fi încărcate."
          );
        }
      } finally {
        if (alive) {
          setLoading(false);
        }
      }
    }

    loadCollections();

    return () => {
      alive = false;

      controller.abort();
    };
  }, [
    storeSlug,
    isOwner,
  ]);

  const visibleCampaigns =
    useMemo(
      () =>
        campaigns.slice(
          0,
          3
        ),
      [campaigns]
    );

  /*
   * Owner-ul nu vede colecțiile publice aici,
   * pentru că are deja butonul lui Campanii.
   */
  if (isOwner) {
    return null;
  }

  /*
   * TEMPORAR:
   * afișăm stările ca să putem diagnostica.
   */
  if (loading) {
    return (
      <section
        className={
          styles.storeCollections
        }
      >
        <div
          style={{
            padding: 12,
            fontSize: 14,
            opacity: 0.7,
          }}
        >
          Se încarcă
          colecțiile...
        </div>
      </section>
    );
  }

  if (error) {
    return (
      <section
        className={
          styles.storeCollections
        }
      >
        <div
          style={{
            padding: 12,
            fontSize: 14,
            color: "#b91c1c",
          }}
        >
          Colecțiile nu au
          putut fi încărcate:
          {" "}
          {error}
        </div>
      </section>
    );
  }

  if (
    !visibleCampaigns.length
  ) {
    return (
      <section
        className={
          styles.storeCollections
        }
      >
        <div
          style={{
            padding: 12,
            fontSize: 14,
            opacity: 0.7,
          }}
        >
          Acest creator nu
          are momentan
          colecții publice.
        </div>
      </section>
    );
  }

  return (
    <section
      className={
        styles.storeCollections
      }
      aria-labelledby="store-collections-title"
    >
      <div
        className={
          styles.storeCollectionsHeader
        }
      >
        <div>
          <span
            className={
              styles.storeCollectionsEyebrow
            }
          >
            Descoperă mai ușor
          </span>

          <h2
            id="store-collections-title"
            className={
              styles.storeCollectionsTitle
            }
          >
            Colecțiile
            creatorului
          </h2>
        </div>

        {campaigns.length >
          3 && (
          <span
            className={
              styles.storeCollectionsCount
            }
          >
            {
              campaigns.length
            }{" "}
            colecții
          </span>
        )}
      </div>

      <div
        className={
          styles.storeCollectionsGrid
        }
      >
        {visibleCampaigns.map(
          (campaign) => {
            const productsCount =
              Number(
                campaign?.productsCount ||
                  0
              );

            const discountPercent =
              Number(
                campaign?.discountPercent ||
                  0
              );

            return (
              <button
                key={
                  campaign.id
                }
                type="button"
                className={
                  styles.storeCollectionCard
                }
                onClick={() =>
                  onOpenCampaign?.(
                    campaign
                  )
                }
              >
                <div
                  className={
                    styles.storeCollectionIcon
                  }
                >
                  ✨
                </div>

                <div
                  className={
                    styles.storeCollectionContent
                  }
                >
                  <div
                    className={
                      styles.storeCollectionTop
                    }
                  >
                    <strong>
                      {campaign.name ||
                        "Colecție"}
                    </strong>

                    {discountPercent >
                      0 && (
                      <span
                        className={
                          styles.storeCollectionDiscount
                        }
                      >
                        -
                        {
                          discountPercent
                        }
                        %
                      </span>
                    )}
                  </div>

                  <div
                    className={
                      styles.storeCollectionMeta
                    }
                  >
                    {productsCount >
                    0
                      ? `${productsCount} ${
                          productsCount ===
                          1
                            ? "produs"
                            : "produse"
                        }`
                      : "Descoperă produsele"}
                  </div>

                  <div
                    className={
                      styles.storeCollectionAction
                    }
                  >
                    Vezi colecția →
                  </div>
                </div>
              </button>
            );
          }
        )}
      </div>
    </section>
  );
}