// src/pages/Vendor/Promotions/VendorHomepagePromotions.jsx

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  useSearchParams,
} from "react-router-dom";

import {
  api,
} from "../../../lib/api";

const DISCOUNT_OPTIONS = [
  0,
  5,
  10,
  15,
  20,
];

/* =========================================================
   HELPERS
========================================================= */

function formatDate(value) {
  if (!value) {
    return "—";
  }

  const date =
    new Date(value);

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return "—";
  }

  return new Intl.DateTimeFormat(
    "ro-RO",
    {
      dateStyle:
        "long",
    }
  ).format(date);
}

function formatMoneyFromCents(
  value,
  currency = "RON"
) {
  const cents =
    Number(value);

  if (
    !Number.isFinite(cents)
  ) {
    return null;
  }

  return new Intl.NumberFormat(
    "ro-RO",
    {
      style:
        "currency",

      currency:
        currency || "RON",
    }
  ).format(
    cents / 100
  );
}

function getFeatureTitle(feature) {
  if (
    feature?.type ===
    "PRODUCT_OF_DAY"
  ) {
    return (
      feature?.product?.title ||
      "Produsul tău"
    );
  }

  return (
    feature?.service?.profile
      ?.displayName ||
    feature?.service?.title ||
    "Magazinul tău"
  );
}

function getFeatureTypeLabel(type) {
  if (
    type ===
    "PRODUCT_OF_DAY"
  ) {
    return "Produsul zilei";
  }

  if (
    type ===
    "ARTISAN_OF_WEEK"
  ) {
    return "Artizanul săptămânii";
  }

  return "Promovare homepage";
}

function getFeatureImage(feature) {
  if (
    feature?.type ===
    "PRODUCT_OF_DAY"
  ) {
    return (
      feature?.product
        ?.images?.[0] ||
      null
    );
  }

  return (
    feature?.service?.profile
      ?.coverUrl ||
    feature?.service?.profile
      ?.logoUrl ||
    feature?.service
      ?.mediaUrls?.[0] ||
    null
  );
}

function getStatusLabel(feature) {
  if (
    !feature?.vendorContacted
  ) {
    return "Selecție în pregătire";
  }

  if (
    feature?.vendorDiscountStatus ===
    "ACCEPTED"
  ) {
    return "Reducere acceptată";
  }

  if (
    feature?.vendorDiscountStatus ===
    "DECLINED"
  ) {
    return "Fără reducere suplimentară";
  }

  return "Așteaptă răspunsul tău";
}

function getStatusColor(feature) {
  if (
    !feature?.vendorContacted
  ) {
    return "#6b7280";
  }

  if (
    feature?.vendorDiscountStatus ===
    "PENDING"
  ) {
    return "#b45309";
  }

  return "#166534";
}

function calculateDiscountedPrice(
  priceCents,
  totalDiscountPercent
) {
  const price =
    Number(priceCents);

  const percent =
    Number(
      totalDiscountPercent
    );

  if (
    !Number.isFinite(price) ||
    !Number.isFinite(percent)
  ) {
    return null;
  }

  return Math.max(
    0,
    Math.round(
      price *
        (
          100 -
          percent
        ) /
        100
    )
  );
}

/* =========================================================
   COMPONENTĂ PRINCIPALĂ
========================================================= */

export default function VendorHomepagePromotions() {
  const [
    searchParams,
    setSearchParams,
  ] = useSearchParams();

  const [
    features,
    setFeatures,
  ] = useState([]);

  const [
    loading,
    setLoading,
  ] = useState(true);

  const [
    error,
    setError,
  ] = useState("");

  const [
    success,
    setSuccess,
  ] = useState("");

  const [
    selectedFeature,
    setSelectedFeature,
  ] = useState(null);

  const [
    selectedDiscount,
    setSelectedDiscount,
  ] = useState(0);

  const [
    modalLoading,
    setModalLoading,
  ] = useState(false);

  const [
    saving,
    setSaving,
  ] = useState(false);

  const featureIdFromUrl =
    searchParams.get(
      "featureId"
    );

  const activeFeatures =
    useMemo(
      () =>
        features.filter(
          (feature) =>
            !feature.isExpired
        ),
      [
        features,
      ]
    );

  const expiredFeatures =
    useMemo(
      () =>
        features.filter(
          (feature) =>
            feature.isExpired
        ),
      [
        features,
      ]
    );

  const loadFeatures =
    useCallback(
      async () => {
        setLoading(true);
        setError("");

        try {
          const data =
            await api(
              "/api/vendor/homepage-features"
            );

          setFeatures(
            data?.features ||
              []
          );
        } catch (loadError) {
          setError(
            loadError?.message ||
              "Nu am putut încărca promovările."
          );
        } finally {
          setLoading(false);
        }
      },
      []
    );

  const openFeature =
    useCallback(
      async (featureOrId) => {
        const featureId =
          typeof featureOrId ===
          "string"
            ? featureOrId
            : featureOrId?.id;

        if (!featureId) {
          return;
        }

        setModalLoading(true);
        setError("");
        setSuccess("");

        try {
          const data =
            await api(
              `/api/vendor/homepage-features/${featureId}`
            );

          const feature =
            data?.feature;

          if (!feature) {
            throw new Error(
              "Promovarea nu a fost găsită."
            );
          }

          /*
           * Selecțiile generate automat pot fi
           * vizibile în listă, dar nu pot fi
           * confirmate până când adminul nu trimite
           * invitația prin notificare sau email.
           */
          if (
            !feature.canRespond
          ) {
            throw new Error(
              feature.isExpired
                ? "Promovarea s-a încheiat."
                : "Această selecție este încă în pregătire și nu a fost trimisă pentru confirmare."
            );
          }

          setSelectedFeature(
            feature
          );

          setSelectedDiscount(
            Number(
              feature.vendorDiscountPercent ||
                0
            )
          );

          setSearchParams(
            {
              featureId:
                feature.id,
            },
            {
              replace:
                true,
            }
          );
        } catch (openError) {
          setError(
            openError?.message ||
              "Nu am putut încărca promovarea."
          );

          setSearchParams(
            {},
            {
              replace:
                true,
            }
          );
        } finally {
          setModalLoading(false);
        }
      },
      [
        setSearchParams,
      ]
    );

  function closeModal() {
    setSelectedFeature(
      null
    );

    setSelectedDiscount(
      0
    );

    setSearchParams(
      {},
      {
        replace:
          true,
      }
    );
  }

  async function saveDiscount() {
    if (
      !selectedFeature?.id
    ) {
      return;
    }

    if (
      !selectedFeature.canRespond
    ) {
      setError(
        selectedFeature.isExpired
          ? "Promovarea s-a încheiat și reducerea nu mai poate fi modificată."
          : "Această promovare nu a fost încă trimisă pentru confirmare."
      );

      return;
    }

    setSaving(true);
    setError("");
    setSuccess("");

    try {
      const data =
        await api(
          `/api/vendor/homepage-features/${selectedFeature.id}/discount`,
          {
            method:
              "PATCH",

            body:
              JSON.stringify({
                vendorDiscountPercent:
                  Number(
                    selectedDiscount
                  ),
              }),
          }
        );

      const updatedFeature =
        data?.feature;

      if (updatedFeature) {
        setSelectedFeature(
          updatedFeature
        );

        setFeatures(
          (current) =>
            current.map(
              (feature) =>
                feature.id ===
                updatedFeature.id
                  ? updatedFeature
                  : feature
            )
        );
      }

      setSuccess(
        data?.message ||
          "Alegerea ta a fost salvată."
      );

      window.setTimeout(
        () => {
          closeModal();
        },
        900
      );
    } catch (saveError) {
      setError(
        saveError?.message ||
          "Nu am putut salva reducerea."
      );
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    loadFeatures();
  }, [
    loadFeatures,
  ]);

  useEffect(() => {
    if (
      !featureIdFromUrl
    ) {
      return;
    }

    openFeature(
      featureIdFromUrl
    );
  }, [
    featureIdFromUrl,
    openFeature,
  ]);

  if (loading) {
    return (
      <div
        style={{
          padding:
            20,
        }}
      >
        Se încarcă promovările…
      </div>
    );
  }

  return (
    <div
      style={{
        padding:
          20,

        maxWidth:
          1000,

        margin:
          "0 auto",
      }}
    >
      <div
        style={{
          marginBottom:
            22,
        }}
      >
        <h1
          style={{
            marginBottom:
              6,
          }}
        >
          Promovările mele
        </h1>

        <p
          style={{
            margin:
              0,

            color:
              "#6b7280",
          }}
        >
          Vezi când produsul sau magazinul
          tău este promovat pe homepage și
          poți adăuga o reducere
          suplimentară după ce primești
          invitația de la Artfest.
        </p>
      </div>

      {error && (
        <div
          style={{
            marginBottom:
              16,

            padding:
              12,

            borderRadius:
              10,

            background:
              "#fef2f2",

            border:
              "1px solid #fecaca",

            color:
              "#b91c1c",
          }}
        >
          {error}
        </div>
      )}

      {success && (
        <div
          style={{
            marginBottom:
              16,

            padding:
              12,

            borderRadius:
              10,

            background:
              "#f0fdf4",

            border:
              "1px solid #bbf7d0",

            color:
              "#166534",
          }}
        >
          {success}
        </div>
      )}

      <FeatureSection
        title="Promovări active și programate"
        features={
          activeFeatures
        }
        onOpen={
          openFeature
        }
      />

      {!!expiredFeatures.length && (
        <FeatureSection
          title="Promovări încheiate"
          features={
            expiredFeatures
          }
          onOpen={
            openFeature
          }
          expired
        />
      )}

      {modalLoading && (
        <div
          style={{
            position:
              "fixed",

            inset:
              0,

            zIndex:
              9999,

            display:
              "grid",

            placeItems:
              "center",

            background:
              "rgba(17, 24, 39, 0.55)",

            padding:
              20,
          }}
        >
          <div
            style={{
              background:
                "#ffffff",

              padding:
                24,

              borderRadius:
                16,
            }}
          >
            Se încarcă promovarea…
          </div>
        </div>
      )}

      {selectedFeature && (
        <DiscountModal
          feature={
            selectedFeature
          }
          selectedDiscount={
            selectedDiscount
          }
          setSelectedDiscount={
            setSelectedDiscount
          }
          saving={
            saving
          }
          onSave={
            saveDiscount
          }
          onClose={
            closeModal
          }
        />
      )}
    </div>
  );
}

/* =========================================================
   SECȚIUNE PROMOVĂRI
========================================================= */

function FeatureSection({
  title,
  features,
  onOpen,
  expired = false,
}) {
  return (
    <section
      style={{
        marginBottom:
          30,
      }}
    >
      <h2
        style={{
          fontSize:
            20,

          marginBottom:
            12,
        }}
      >
        {title}
      </h2>

      {!features.length ? (
        <div
          style={{
            padding:
              18,

            border:
              "1px dashed #d1d5db",

            borderRadius:
              12,

            color:
              "#6b7280",
          }}
        >
          Nu există promovări în această
          secțiune.
        </div>
      ) : (
        <div
          style={{
            display:
              "grid",

            gap:
              14,
          }}
        >
          {features.map(
            (feature) => (
              <FeatureCard
                key={
                  feature.id
                }
                feature={
                  feature
                }
                onOpen={
                  onOpen
                }
                expired={
                  expired
                }
              />
            )
          )}
        </div>
      )}
    </section>
  );
}

/* =========================================================
   CARD PROMOVARE
========================================================= */

function FeatureCard({
  feature,
  onOpen,
  expired,
}) {
  const image =
    getFeatureImage(
      feature
    );

  const canRespond =
    Boolean(
      feature.canRespond
    );

  return (
    <article
      style={{
        display:
          "flex",

        gap:
          14,

        alignItems:
          "center",

        padding:
          14,

        border:
          "1px solid #e5e7eb",

        borderRadius:
          14,

        opacity:
          expired
            ? 0.72
            : 1,
      }}
    >
      {image && (
        <img
          src={
            image
          }
          alt={
            getFeatureTitle(
              feature
            )
          }
          style={{
            width:
              86,

            height:
              86,

            borderRadius:
              12,

            objectFit:
              "cover",

            flexShrink:
              0,
          }}
        />
      )}

      <div
        style={{
          flex:
            1,

          minWidth:
            0,
        }}
      >
        <div
          style={{
            color:
              "#6b7280",

            fontSize:
              13,

            fontWeight:
              700,
          }}
        >
          {getFeatureTypeLabel(
            feature.type
          )}
        </div>

        <h3
          style={{
            margin:
              "4px 0 7px",

            fontSize:
              18,
          }}
        >
          {getFeatureTitle(
            feature
          )}
        </h3>

        <div
          style={{
            fontSize:
              14,

            color:
              "#4b5563",
          }}
        >
          {formatDate(
            feature.startsAt
          )}{" "}
          –{" "}
          {formatDate(
            feature.endsAt
          )}
        </div>

        <div
          style={{
            display:
              "flex",

            gap:
              10,

            flexWrap:
              "wrap",

            marginTop:
              8,

            fontSize:
              14,
          }}
        >
          <span>
            Artfest:{" "}
            <strong>
              {feature.platformDiscountPercent ||
                0}
              %
            </strong>
          </span>

          <span>
            Reducerea ta:{" "}
            <strong>
              {feature.vendorDiscountPercent ||
                0}
              %
            </strong>
          </span>

          <span>
            Total:{" "}
            <strong>
              {feature.totalDiscountPercent ||
                0}
              %
            </strong>
          </span>
        </div>

        <div
          style={{
            marginTop:
              7,

            color:
              getStatusColor(
                feature
              ),

            fontWeight:
              700,

            fontSize:
              13,
          }}
        >
          {getStatusLabel(
            feature
          )}
        </div>
      </div>

      {!expired && (
        <button
          type="button"
          disabled={
            !canRespond
          }
          onClick={() => {
            if (
              canRespond
            ) {
              onOpen(
                feature.id
              );
            }
          }}
          style={{
            border:
              0,

            borderRadius:
              10,

            padding:
              "10px 14px",

            cursor:
              canRespond
                ? "pointer"
                : "not-allowed",

            background:
              canRespond
                ? "#111827"
                : "#e5e7eb",

            color:
              canRespond
                ? "#ffffff"
                : "#6b7280",

            fontWeight:
              700,

            opacity:
              canRespond
                ? 1
                : 0.8,
          }}
        >
          {!feature.vendorContacted
            ? "În pregătire"
            : feature.vendorDiscountStatus ===
                "PENDING"
              ? "Alege reducerea"
              : "Modifică"}
        </button>
      )}
    </article>
  );
}

/* =========================================================
   MODAL REDUCERE
========================================================= */

function DiscountModal({
  feature,
  selectedDiscount,
  setSelectedDiscount,
  saving,
  onSave,
  onClose,
}) {
  const platformDiscount =
    Number(
      feature.platformDiscountPercent ||
        0
    );

  const vendorDiscount =
    Number(
      selectedDiscount ||
        0
    );

  const totalDiscount =
    Math.min(
      50,
      platformDiscount +
        vendorDiscount
    );

  const originalPrice =
    feature.type ===
    "PRODUCT_OF_DAY"
      ? formatMoneyFromCents(
          feature.product
            ?.priceCents,
          feature.product
            ?.currency
        )
      : null;

  const discountedPriceCents =
    feature.type ===
    "PRODUCT_OF_DAY"
      ? calculateDiscountedPrice(
          feature.product
            ?.priceCents,
          totalDiscount
        )
      : null;

  const discountedPrice =
    discountedPriceCents !==
    null
      ? formatMoneyFromCents(
          discountedPriceCents,
          feature.product
            ?.currency
        )
      : null;

  const canRespond =
    Boolean(
      feature.canRespond
    );

  return (
    <div
      role="presentation"
      onMouseDown={
        onClose
      }
      style={{
        position:
          "fixed",

        inset:
          0,

        zIndex:
          10000,

        display:
          "grid",

        placeItems:
          "center",

        padding:
          20,

        background:
          "rgba(17, 24, 39, 0.6)",
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        onMouseDown={(
          event
        ) =>
          event.stopPropagation()
        }
        style={{
          width:
            "100%",

          maxWidth:
            560,

          maxHeight:
            "90vh",

          overflowY:
            "auto",

          background:
            "#ffffff",

          borderRadius:
            18,

          padding:
            22,

          boxShadow:
            "0 20px 60px rgba(0,0,0,0.25)",
        }}
      >
        <div
          style={{
            display:
              "flex",

            justifyContent:
              "space-between",

            gap:
              15,

            alignItems:
              "flex-start",
          }}
        >
          <div>
            <div
              style={{
                color:
                  "#6b7280",

                fontSize:
                  13,

                fontWeight:
                  700,
              }}
            >
              {getFeatureTypeLabel(
                feature.type
              )}
            </div>

            <h2
              style={{
                margin:
                  "5px 0 0",
              }}
            >
              Felicitări!
            </h2>
          </div>

          <button
            type="button"
            onClick={
              onClose
            }
            style={{
              border:
                0,

              background:
                "transparent",

              cursor:
                "pointer",

              fontSize:
                24,
            }}
            aria-label="Închide"
          >
            ×
          </button>
        </div>

        <p
          style={{
            color:
              "#4b5563",

            lineHeight:
              1.55,
          }}
        >
          <strong>
            {getFeatureTitle(
              feature
            )}
          </strong>{" "}
          a fost selectat pentru promovare
          pe homepage în perioada{" "}
          {formatDate(
            feature.startsAt
          )}{" "}
          –{" "}
          {formatDate(
            feature.endsAt
          )}.
        </p>

        <div
          style={{
            padding:
              14,

            borderRadius:
              12,

            background:
              "#f3f4f6",

            marginBottom:
              18,
          }}
        >
          Artfest oferă deja o reducere de{" "}
          <strong>
            {platformDiscount}%
          </strong>
          .
        </div>

        <h3>
          Alege reducerea ta suplimentară
        </h3>

        <div
          style={{
            display:
              "grid",

            gridTemplateColumns:
              "repeat(5, minmax(0, 1fr))",

            gap:
              8,

            marginBottom:
              18,
          }}
        >
          {DISCOUNT_OPTIONS.map(
            (discount) => {
              const selected =
                selectedDiscount ===
                discount;

              return (
                <button
                  key={
                    discount
                  }
                  type="button"
                  disabled={
                    !canRespond
                  }
                  onClick={() => {
                    if (
                      canRespond
                    ) {
                      setSelectedDiscount(
                        discount
                      );
                    }
                  }}
                  style={{
                    border:
                      selected
                        ? "2px solid #111827"
                        : "1px solid #d1d5db",

                    background:
                      selected
                        ? "#111827"
                        : "#ffffff",

                    color:
                      selected
                        ? "#ffffff"
                        : "#111827",

                    borderRadius:
                      10,

                    padding:
                      "11px 4px",

                    cursor:
                      canRespond
                        ? "pointer"
                        : "not-allowed",

                    fontWeight:
                      800,

                    opacity:
                      canRespond
                        ? 1
                        : 0.6,
                  }}
                >
                  {discount === 0
                    ? "0%"
                    : `${discount}%`}
                </button>
              );
            }
          )}
        </div>

        <div
          style={{
            display:
              "grid",

            gap:
              7,

            padding:
              14,

            border:
              "1px solid #e5e7eb",

            borderRadius:
              12,

            marginBottom:
              20,
          }}
        >
          <div>
            Reducere Artfest:{" "}
            <strong>
              {platformDiscount}%
            </strong>
          </div>

          <div>
            Reducerea ta:{" "}
            <strong>
              {vendorDiscount}%
            </strong>
          </div>

          <div>
            Reducere totală pentru client:{" "}
            <strong>
              {totalDiscount}%
            </strong>
          </div>

          {originalPrice &&
            discountedPrice && (
              <div
                style={{
                  marginTop:
                    6,

                  paddingTop:
                    10,

                  borderTop:
                    "1px solid #e5e7eb",
                }}
              >
                Preț produs:{" "}
                <span
                  style={{
                    textDecoration:
                      totalDiscount > 0
                        ? "line-through"
                        : "none",

                    color:
                      "#6b7280",
                  }}
                >
                  {originalPrice}
                </span>

                {totalDiscount >
                  0 && (
                  <strong
                    style={{
                      marginLeft:
                        10,

                      color:
                        "#dc2626",
                    }}
                  >
                    {discountedPrice}
                  </strong>
                )}
              </div>
            )}
        </div>

        <p
          style={{
            color:
              "#6b7280",

            fontSize:
              13,

            lineHeight:
              1.5,
          }}
        >
          Selectează 0% dacă nu dorești să
          adaugi o reducere suplimentară.
          Promovarea rămâne activă cu
          reducerea oferită de Artfest.
        </p>

        <div
          style={{
            display:
              "flex",

            justifyContent:
              "flex-end",

            gap:
              10,

            flexWrap:
              "wrap",

            marginTop:
              20,
          }}
        >
          <button
            type="button"
            onClick={
              onClose
            }
            disabled={
              saving
            }
            style={{
              border:
                "1px solid #d1d5db",

              background:
                "#ffffff",

              borderRadius:
                10,

              padding:
                "11px 16px",

              cursor:
                saving
                  ? "not-allowed"
                  : "pointer",
            }}
          >
            Mai târziu
          </button>

          <button
            type="button"
            onClick={
              onSave
            }
            disabled={
              saving ||
              !canRespond
            }
            style={{
              border:
                0,

              background:
                canRespond
                  ? "#111827"
                  : "#e5e7eb",

              color:
                canRespond
                  ? "#ffffff"
                  : "#6b7280",

              borderRadius:
                10,

              padding:
                "11px 17px",

              cursor:
                saving ||
                !canRespond
                  ? "not-allowed"
                  : "pointer",

              fontWeight:
                800,

              opacity:
                saving
                  ? 0.7
                  : 1,
            }}
          >
            {saving
              ? "Se salvează…"
              : selectedDiscount > 0
                ? "Confirmă reducerea"
                : "Continuă fără reducere"}
          </button>
        </div>
      </div>
    </div>
  );
}