// src/pages/Admin/AdminDesktop/tabs/AdminHomepageFeaturesTab.jsx

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  api,
} from "../../../../../lib/api.js";

import styles from "../../AdminDesktop.module.css";

const FEATURE_TYPES = {
  PRODUCT_OF_DAY:
    "PRODUCT_OF_DAY",

  ARTISAN_OF_WEEK:
    "ARTISAN_OF_WEEK",
};

const DISCOUNT_OPTIONS = [
  0,
  5,
  10,
  15,
  20,
];

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

function formatDateTime(value) {
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
        "medium",

      timeStyle:
        "short",
    }
  ).format(date);
}

function toDateInputValue(value) {
  if (!value) {
    return "";
  }

  const date =
    new Date(value);

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return "";
  }

  const year =
    date.getFullYear();

  const month =
    String(
      date.getMonth() + 1
    ).padStart(
      2,
      "0"
    );

  const day =
    String(
      date.getDate()
    ).padStart(
      2,
      "0"
    );

  return `${year}-${month}-${day}`;
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
    return "—";
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
    FEATURE_TYPES.PRODUCT_OF_DAY
  ) {
    return (
      feature?.product?.title ||
      "Produs fără titlu"
    );
  }

  return (
    feature?.service?.profile
      ?.displayName ||
    feature?.service?.title ||
    feature?.vendor
      ?.displayName ||
    "Magazin fără nume"
  );
}

function getFeatureImage(feature) {
  if (
    feature?.type ===
    FEATURE_TYPES.PRODUCT_OF_DAY
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
    feature?.vendor
      ?.coverUrl ||
    feature?.vendor
      ?.logoUrl ||
    feature?.service
      ?.mediaUrls?.[0] ||
    null
  );
}

function getFeatureTypeLabel(type) {
  if (
    type ===
    FEATURE_TYPES.PRODUCT_OF_DAY
  ) {
    return "Produsul zilei";
  }

  if (
    type ===
    FEATURE_TYPES.ARTISAN_OF_WEEK
  ) {
    return "Artizanul săptămânii";
  }

  return "Promovare";
}

function getVendorStatusLabel(feature) {
  if (
    feature?.vendorDiscountStatus ===
    "ACCEPTED"
  ) {
    return `Reducere acceptată: ${
      Number(
        feature.vendorDiscountPercent ||
          0
      )
    }%`;
  }

  if (
    feature?.vendorDiscountStatus ===
    "DECLINED"
  ) {
    return "Vendorul nu adaugă reducere";
  }

  if (
    feature?.vendorNotifiedAt
  ) {
    return "Așteaptă răspunsul vendorului";
  }

  return "Vendor necontactat";
}

function getFeatureStatus(feature) {
  const now =
    Date.now();

  const startsAt =
    new Date(
      feature.startsAt
    ).getTime();

  const endsAt =
    new Date(
      feature.endsAt
    ).getTime();

  if (
    startsAt <= now &&
    endsAt > now
  ) {
    return "active";
  }

  if (
    startsAt > now
  ) {
    return "upcoming";
  }

  return "past";
}

function getVendorName(feature) {
  return (
    feature?.vendor
      ?.displayName ||
    feature?.product?.service
      ?.vendor?.displayName ||
    feature?.service?.vendor
      ?.displayName ||
    "Vendor"
  );
}

function normalizePercent(value) {
  const number =
    Number(value);

  if (
    !Number.isFinite(number)
  ) {
    return 0;
  }

  return Math.min(
    50,
    Math.max(
      0,
      Math.round(number)
    )
  );
}

export default function AdminHomepageFeaturesTab() {
  const [
    features,
    setFeatures,
  ] = useState([]);

  const [
    loading,
    setLoading,
  ] = useState(true);

  const [
    generating,
    setGenerating,
  ] = useState(false);

  const [
    sendingId,
    setSendingId,
  ] = useState(null);

  const [
    deletingId,
    setDeletingId,
  ] = useState(null);

  const [
    error,
    setError,
  ] = useState("");

  const [
    success,
    setSuccess,
  ] = useState("");

  const [
    editingFeature,
    setEditingFeature,
  ] = useState(null);

  const [
    activeView,
    setActiveView,
  ] = useState("products");

  const [
    editForm,
    setEditForm,
  ] = useState({
    date:
      "",

    selectionId:
      "",

    platformDiscountPercent:
      "5",

    force:
      false,
  });

  const [
    searchQuery,
    setSearchQuery,
  ] = useState("");

  const [
    searchResults,
    setSearchResults,
  ] = useState([]);

  const [
    searching,
    setSearching,
  ] = useState(false);

  const [
    selectedResult,
    setSelectedResult,
  ] = useState(null);

  const [
    savingEdit,
    setSavingEdit,
  ] = useState(false);

  const clearMessages =
    useCallback(() => {
      setError("");
      setSuccess("");
    }, []);

  const loadFeatures =
    useCallback(
      async ({
        silent = false,
      } = {}) => {
        if (!silent) {
          setLoading(true);
        }

        try {
          const data =
            await api(
              "/api/admin/homepage-features?take=100"
            );

          setFeatures(
            data?.features ||
              data?.items ||
              []
          );
        } catch (loadError) {
          setError(
            loadError?.message ||
              "Nu am putut încărca promovările."
          );
        } finally {
          if (!silent) {
            setLoading(false);
          }
        }
      },
      []
    );

  const generateSchedule =
    useCallback(
      async ({
        showMessage = true,
      } = {}) => {
        setGenerating(true);

        if (showMessage) {
          clearMessages();
        }

        try {
          const data =
            await api(
              "/api/admin/homepage-features/generate",
              {
                method:
                  "POST",

                body: {
                  productDays:
                    14,

                  artisanWeeks:
                    4,
                },
              }
            );
console.log(
  "HOMEPAGE GENERATE MANUAL:",
  data
);
          const summary =
            data?.summary ||
            {};

          if (showMessage) {
            setSuccess(
              `Calendar actualizat. Produse noi: ${
                summary.createdProducts ||
                0
              }, artizani noi: ${
                summary.createdArtisans ||
                0
              }.`
            );
          }

          await loadFeatures({
            silent:
              true,
          });
        } catch (generateError) {
          setError(
            generateError?.message ||
              "Nu am putut genera calendarul."
          );
        } finally {
          setGenerating(false);
        }
      },
      [
        clearMessages,
        loadFeatures,
      ]
    );

  useEffect(() => {
    let cancelled =
      false;

    async function initialize() {
      setLoading(true);
      setError("");

      try {
        /*
         * Completează automat perioadele lipsă.
         * Nu suprascrie selecțiile deja existente.
         */
        const generateResult =
  await api(
    "/api/admin/homepage-features/generate",
    {
      method:
        "POST",

      body: {
        productDays:
          14,

        artisanWeeks:
          4,
      },
    }
  );

console.log(
  "HOMEPAGE GENERATE RESULT:",
  generateResult
);

        if (
          cancelled
        ) {
          return;
        }

        const data =
          await api(
            "/api/admin/homepage-features?take=100"
          );

        if (
          cancelled
        ) {
          return;
        }

        setFeatures(
          data?.features ||
            data?.items ||
            []
        );
      } catch (initializeError) {
        if (
          !cancelled
        ) {
          setError(
            initializeError?.message ||
              "Nu am putut inițializa calendarul de promovări."
          );
        }
      } finally {
        if (
          !cancelled
        ) {
          setLoading(false);
        }
      }
    }

    initialize();

    return () => {
      cancelled =
        true;
    };
  }, []);

  const productFeatures =
    useMemo(
      () =>
        features
          .filter(
            (feature) =>
              feature.type ===
              FEATURE_TYPES.PRODUCT_OF_DAY
          )
          .sort(
            (a, b) =>
              new Date(
                a.startsAt
              ).getTime() -
              new Date(
                b.startsAt
              ).getTime()
          ),
      [
        features,
      ]
    );

  const artisanFeatures =
    useMemo(
      () =>
        features
          .filter(
            (feature) =>
              feature.type ===
              FEATURE_TYPES.ARTISAN_OF_WEEK
          )
          .sort(
            (a, b) =>
              new Date(
                a.startsAt
              ).getTime() -
              new Date(
                b.startsAt
              ).getTime()
          ),
      [
        features,
      ]
    );

  const visibleFeatures =
    activeView ===
    "products"
      ? productFeatures
      : artisanFeatures;

  const activeFeatures =
    useMemo(
      () =>
        visibleFeatures.filter(
          (feature) =>
            getFeatureStatus(
              feature
            ) ===
            "active"
        ),
      [
        visibleFeatures,
      ]
    );

const upcomingFeatures =
  useMemo(
    () => {
      const upcoming =
        visibleFeatures.filter(
          (feature) =>
            getFeatureStatus(
              feature
            ) ===
            "upcoming"
        );

      /*
       * Pentru produsele zilei afișăm
       * următoarele 7 selecții.
       *
       * Pentru artizani păstrăm toate
       * săptămânile generate.
       */
      if (
        activeView ===
        "products"
      ) {
        return upcoming.slice(
          0,
          7
        );
      }

      return upcoming;
    },
    [
      visibleFeatures,
      activeView,
    ]
  );

  const pastFeatures =
    useMemo(
      () =>
        visibleFeatures
          .filter(
            (feature) =>
              getFeatureStatus(
                feature
              ) ===
              "past"
          )
          .reverse()
          .slice(
            0,
            10
          ),
      [
        visibleFeatures,
      ]
    );

  function closeEditModal() {
    setEditingFeature(
      null
    );

    setSearchQuery("");
    setSearchResults([]);
    setSelectedResult(
      null
    );

    setEditForm({
      date:
        "",

      selectionId:
        "",

      platformDiscountPercent:
        "5",

      force:
        false,
    });
  }

  function openEditModal(feature) {
    clearMessages();

    const startsAt =
      new Date(
        feature.startsAt
      ).getTime();

    const force =
      Number.isFinite(
        startsAt
      ) &&
      startsAt <
        Date.now() +
          24 *
            60 *
            60 *
            1000;

    setEditingFeature(
      feature
    );

    setEditForm({
      date:
        toDateInputValue(
          feature.startsAt
        ),

      selectionId:
        feature.type ===
        FEATURE_TYPES.PRODUCT_OF_DAY
          ? feature.productId ||
            feature.product?.id ||
            ""
          : feature.serviceId ||
            feature.service?.id ||
            "",

      platformDiscountPercent:
        String(
          feature
            .platformDiscountPercent ??
            0
        ),

      force,
    });

    setSelectedResult(
      feature.type ===
      FEATURE_TYPES.PRODUCT_OF_DAY
        ? feature.product ||
          null
        : feature.service ||
          null
    );

    setSearchQuery(
      getFeatureTitle(
        feature
      )
    );

    setSearchResults([]);
  }

  async function searchSelections() {
    if (
      !editingFeature
    ) {
      return;
    }

    setSearching(true);
    setError("");

    try {
      const params =
        new URLSearchParams();

      if (
        searchQuery.trim()
      ) {
        params.set(
          "q",
          searchQuery.trim()
        );
      }

      params.set(
        "take",
        "30"
      );

      const isProduct =
        editingFeature.type ===
        FEATURE_TYPES.PRODUCT_OF_DAY;

      const endpoint =
        isProduct
          ? `/api/admin/homepage-features/products?${params.toString()}`
          : `/api/admin/homepage-features/artisans?${params.toString()}`;

      const data =
        await api(
          endpoint
        );

      const results =
        isProduct
          ? data?.products ||
            data?.items ||
            []
          : data?.artisans ||
            data?.services ||
            data?.items ||
            [];

      setSearchResults(
        results
      );

      if (
        !results.length
      ) {
        setError(
          isProduct
            ? "Nu am găsit produse eligibile."
            : "Nu am găsit magazine eligibile."
        );
      }
    } catch (searchError) {
      setError(
        searchError?.message ||
          "Nu am putut încărca rezultatele."
      );
    } finally {
      setSearching(false);
    }
  }

  function selectSearchResult(
    result
  ) {
    setSelectedResult(
      result
    );

    setEditForm(
      (current) => ({
        ...current,

        selectionId:
          result.id,
      })
    );

    setSearchResults([]);

    setSearchQuery(
      editingFeature?.type ===
      FEATURE_TYPES.PRODUCT_OF_DAY
        ? result.title ||
          ""
        : result?.profile
            ?.displayName ||
          result?.title ||
          result?.vendor
            ?.displayName ||
          ""
    );
  }

  async function saveEdit(
    event
  ) {
    event.preventDefault();

    if (
      !editingFeature
    ) {
      return;
    }

    if (
      !editForm.date ||
      !editForm.selectionId
    ) {
      setError(
        "Completează data și selecția."
      );

      return;
    }

    setSavingEdit(true);
    clearMessages();

    try {
      const isProduct =
        editingFeature.type ===
        FEATURE_TYPES.PRODUCT_OF_DAY;

      const payload =
        isProduct
          ? {
              date:
                editForm.date,

              productId:
                editForm.selectionId,

              platformDiscountPercent:
                normalizePercent(
                  editForm
                    .platformDiscountPercent
                ),

              force:
                Boolean(
                  editForm.force
                ),
            }
          : {
              weekStartDate:
                editForm.date,

              serviceId:
                editForm.selectionId,

              platformDiscountPercent:
                normalizePercent(
                  editForm
                    .platformDiscountPercent
                ),

              force:
                Boolean(
                  editForm.force
                ),
            };

      await api(
        `/api/admin/homepage-features/${editingFeature.id}`,
        {
          method:
            "PATCH",

          body:
            payload,
        }
      );

      closeEditModal();

      setSuccess(
        "Promovarea a fost actualizată."
      );

      await loadFeatures({
        silent:
          true,
      });
    } catch (saveError) {
      setError(
        saveError?.message ||
          "Nu am putut actualiza promovarea."
      );
    } finally {
      setSavingEdit(false);
    }
  }

  async function sendNotification(
    feature
  ) {
    const alreadySent =
      Boolean(
        feature.vendorNotifiedAt
      );

    const confirmed =
      window.confirm(
        alreadySent
          ? `Retrimiți invitația către ${getVendorName(
              feature
            )}?`
          : `Trimiți invitația către ${getVendorName(
              feature
            )}?`
      );

    if (!confirmed) {
      return;
    }

    clearMessages();

    setSendingId(
      feature.id
    );

    try {
      const data =
        await api(
          `/api/admin/homepage-features/${feature.id}/send-notification`,
          {
            method:
              "POST",
          }
        );

      setSuccess(
        data?.message ||
          "Notificarea a fost procesată."
      );

      await loadFeatures({
        silent:
          true,
      });
    } catch (sendError) {
      setError(
        sendError?.message ||
          "Nu am putut trimite notificarea."
      );
    } finally {
      setSendingId(
        null
      );
    }
  }

  async function deleteFeature(
    feature
  ) {
    const confirmed =
      window.confirm(
        `Ștergi programarea „${getFeatureTypeLabel(
          feature.type
        )} – ${getFeatureTitle(
          feature
        )}”?`
      );

    if (!confirmed) {
      return;
    }

    clearMessages();

    setDeletingId(
      feature.id
    );

    try {
      await api(
        `/api/admin/homepage-features/${feature.id}`,
        {
          method:
            "DELETE",
        }
      );

      setSuccess(
        "Promovarea a fost ștearsă."
      );

      await loadFeatures({
        silent:
          true,
      });
    } catch (deleteError) {
      setError(
        deleteError?.message ||
          "Nu am putut șterge promovarea."
      );
    } finally {
      setDeletingId(
        null
      );
    }
  }

  if (loading) {
    return (
      <p
        className={
          styles.subtle
        }
      >
        Se pregătește calendarul de promovări…
      </p>
    );
  }

  return (
    <div>
      <div
        style={{
          display:
            "flex",

          justifyContent:
            "space-between",

          alignItems:
            "flex-start",

          gap:
            14,

          flexWrap:
            "wrap",

          marginBottom:
            20,
        }}
      >
        <div>
          <h2
            style={{
              marginBottom:
                6,
            }}
          >
            Calendar promovări
          </h2>

          <p
            className={
              styles.subtle
            }
            style={{
              margin:
                0,
            }}
          >
            Selecțiile sunt generate automat.
            Verifică produsele și artizanii,
            modifică reducerea și trimite
            invitația vendorului.
          </p>
        </div>

        <button
          type="button"
          className={
            styles.tab
          }
          disabled={
            generating
          }
          onClick={() =>
            generateSchedule({
              showMessage:
                true,
            })
          }
        >
          {generating
            ? "Se generează…"
            : "Completează calendarul"}
        </button>
      </div>

      {error && (
        <div
          className={
            styles.error
          }
          style={{
            marginBottom:
              16,
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

            border:
              "1px solid #bbf7d0",

            borderRadius:
              10,

            background:
              "#f0fdf4",

            color:
              "#166534",
          }}
        >
          {success}
        </div>
      )}

      <div
        style={{
          display:
            "flex",

          gap:
            10,

          flexWrap:
            "wrap",

          marginBottom:
            20,
        }}
      >
        <button
          type="button"
          className={
            styles.tab
          }
          onClick={() =>
            setActiveView(
              "products"
            )
          }
          style={{
            fontWeight:
              activeView ===
              "products"
                ? 800
                : 500,

            opacity:
              activeView ===
              "products"
                ? 1
                : 0.7,
          }}
        >
          Produsele zilei (
          {
            productFeatures.length
          }
          )
        </button>

        <button
          type="button"
          className={
            styles.tab
          }
          onClick={() =>
            setActiveView(
              "artisans"
            )
          }
          style={{
            fontWeight:
              activeView ===
              "artisans"
                ? 800
                : 500,

            opacity:
              activeView ===
              "artisans"
                ? 1
                : 0.7,
          }}
        >
          Artizanii săptămânii (
          {
            artisanFeatures.length
          }
          )
        </button>
      </div>

      <FeatureSection
        title={
          activeView ===
          "products"
            ? "Produs activ astăzi"
            : "Artizan activ acum"
        }
        features={
          activeFeatures
        }
        sendingId={
          sendingId
        }
        deletingId={
          deletingId
        }
        onEdit={
          openEditModal
        }
        onSend={
          sendNotification
        }
        onDelete={
          deleteFeature
        }
      />

      <FeatureSection
        title={
          activeView ===
          "products"
            ? "Următoarele produse"
            : "Următorii artizani"
        }
        features={
          upcomingFeatures
        }
        sendingId={
          sendingId
        }
        deletingId={
          deletingId
        }
        onEdit={
          openEditModal
        }
        onSend={
          sendNotification
        }
        onDelete={
          deleteFeature
        }
      />

      <FeatureSection
        title="Istoric recent"
        features={
          pastFeatures
        }
        sendingId={
          sendingId
        }
        deletingId={
          deletingId
        }
        onEdit={
          openEditModal
        }
        onSend={
          sendNotification
        }
        onDelete={
          deleteFeature
        }
        history
      />

      {editingFeature && (
        <EditFeatureModal
          feature={
            editingFeature
          }
          form={
            editForm
          }
          setForm={
            setEditForm
          }
          query={
            searchQuery
          }
          setQuery={
            setSearchQuery
          }
          results={
            searchResults
          }
          selectedResult={
            selectedResult
          }
          searching={
            searching
          }
          saving={
            savingEdit
          }
          onSearch={
            searchSelections
          }
          onSelect={
            selectSearchResult
          }
          onSubmit={
            saveEdit
          }
          onClose={
            closeEditModal
          }
        />
      )}
    </div>
  );
}

function FeatureSection({
  title,
  features,
  sendingId,
  deletingId,
  onEdit,
  onSend,
  onDelete,
  history = false,
}) {
  return (
    <section
      style={{
        marginTop:
          26,
      }}
    >
      <h3
        style={{
          marginBottom:
            12,
        }}
      >
        {title}
      </h3>

      {!features.length ? (
        <div
          className={
            styles.emptyState
          }
        >
          Nu există selecții în această secțiune.
        </div>
      ) : (
        <div
          style={{
            display:
              "grid",

            gap:
              12,
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
                sending={
                  sendingId ===
                  feature.id
                }
                deleting={
                  deletingId ===
                  feature.id
                }
                history={
                  history
                }
                onEdit={
                  onEdit
                }
                onSend={
                  onSend
                }
                onDelete={
                  onDelete
                }
              />
            )
          )}
        </div>
      )}
    </section>
  );
}

function FeatureCard({
  feature,
  sending,
  deleting,
  history,
  onEdit,
  onSend,
  onDelete,
}) {
  const image =
    getFeatureImage(
      feature
    );

  const platformPercent =
    Number(
      feature
        .platformDiscountPercent ||
        0
    );

  const vendorPercent =
    Number(
      feature
        .vendorDiscountPercent ||
        0
    );

  const totalPercent =
    Math.min(
      50,
      platformPercent +
        vendorPercent
    );

  const notified =
    Boolean(
      feature.vendorNotifiedAt
    );

  const emailed =
    Boolean(
      feature.vendorEmailedAt
    );

  return (
    <article
      style={{
        padding:
          15,

        border:
          "1px solid #e5e7eb",

        borderRadius:
          14,

        display:
          "grid",

        gap:
          13,
      }}
    >
      <div
        style={{
          display:
            "flex",

          gap:
            14,

          alignItems:
            "flex-start",
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
                84,

              height:
                84,

              borderRadius:
                11,

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
            className={
              styles.subtle
            }
            style={{
              fontSize:
                13,

              fontWeight:
                700,
            }}
          >
            {getFeatureTypeLabel(
              feature.type
            )}
            {" · "}
            {feature.source ===
            "AUTOMATIC"
              ? "Selectat automat"
              : "Modificat manual"}
          </div>

          <h4
            style={{
              margin:
                "5px 0",
            }}
          >
            {getFeatureTitle(
              feature
            )}
          </h4>

          <div
            className={
              styles.subtle
            }
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
            className={
              styles.subtle
            }
            style={{
              marginTop:
                5,
            }}
          >
            Vendor:{" "}
            <strong>
              {getVendorName(
                feature
              )}
            </strong>
          </div>
        </div>
      </div>

      <div
        style={{
          display:
            "flex",

          gap:
            10,

          flexWrap:
            "wrap",

          fontSize:
            14,
        }}
      >
        <span>
          Artfest:{" "}
          <strong>
            {platformPercent}%
          </strong>
        </span>

        <span>
          Vendor:{" "}
          <strong>
            {vendorPercent}%
          </strong>
        </span>

        <span>
          Total:{" "}
          <strong>
            {totalPercent}%
          </strong>
        </span>
      </div>

      <div
        style={{
          display:
            "flex",

          gap:
            8,

          flexWrap:
            "wrap",
        }}
      >
        <StatusBadge
          active={
            notified
          }
          label={
            notified
              ? `Notificare trimisă ${formatDateTime(
                  feature.vendorNotifiedAt
                )}`
              : "Notificare netrimisă"
          }
        />

        <StatusBadge
          active={
            emailed
          }
          label={
            emailed
              ? "Email trimis"
              : feature.vendorEmailError
                ? "Eroare email"
                : "Email netrimis"
          }
        />

        <StatusBadge
          active={
            feature.vendorDiscountStatus ===
            "ACCEPTED"
          }
          label={
            getVendorStatusLabel(
              feature
            )
          }
        />
      </div>

      {!history && (
        <div
          style={{
            display:
              "flex",

            gap:
              8,

            flexWrap:
              "wrap",
          }}
        >
          <button
            type="button"
            className={
              styles.tab
            }
            onClick={() =>
              onEdit(
                feature
              )
            }
          >
            Editează
          </button>

          <button
            type="button"
            className={
              styles.tab
            }
            disabled={
              sending
            }
            onClick={() =>
              onSend(
                feature
              )
            }
          >
            {sending
              ? "Se trimite…"
              : notified
                ? "Retrimite vendorului"
                : "Trimite vendorului"}
          </button>

          <button
            type="button"
            className={
              styles.tab
            }
            disabled={
              deleting
            }
            onClick={() =>
              onDelete(
                feature
              )
            }
          >
            {deleting
              ? "Se șterge…"
              : "Șterge"}
          </button>
        </div>
      )}
    </article>
  );
}

function StatusBadge({
  active,
  label,
}) {
  return (
    <span
      style={{
        padding:
          "5px 9px",

        borderRadius:
          999,

        fontSize:
          12,

        fontWeight:
          700,

        background:
          active
            ? "#dcfce7"
            : "#f3f4f6",

        color:
          active
            ? "#166534"
            : "#6b7280",

        border:
          active
            ? "1px solid #bbf7d0"
            : "1px solid #e5e7eb",
      }}
    >
      {label}
    </span>
  );
}

function EditFeatureModal({
  feature,
  form,
  setForm,
  query,
  setQuery,
  results,
  selectedResult,
  searching,
  saving,
  onSearch,
  onSelect,
  onSubmit,
  onClose,
}) {
  const isProduct =
    feature.type ===
    FEATURE_TYPES.PRODUCT_OF_DAY;

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

        background:
          "rgba(17, 24, 39, 0.62)",

        display:
          "grid",

        placeItems:
          "center",

        padding:
          18,
      }}
    >
      <form
        onSubmit={
          onSubmit
        }
        onMouseDown={(
          event
        ) =>
          event.stopPropagation()
        }
        style={{
          width:
            "100%",

          maxWidth:
            650,

          maxHeight:
            "92vh",

          overflowY:
            "auto",

          background:
            "#ffffff",

          borderRadius:
            17,

          padding:
            20,

          display:
            "grid",

          gap:
            15,
        }}
      >
        <div
          style={{
            display:
              "flex",

            justifyContent:
              "space-between",

            gap:
              12,
          }}
        >
          <div>
            <div
              className={
                styles.subtle
              }
            >
              {getFeatureTypeLabel(
                feature.type
              )}
            </div>

            <h3
              style={{
                margin:
                  "4px 0 0",
              }}
            >
              Editează selecția
            </h3>
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
                25,
            }}
          >
            ×
          </button>
        </div>

        <label>
          {isProduct
            ? "Data promovării"
            : "Începutul săptămânii"}

          <input
            type="date"
            value={
              form.date
            }
            onChange={(
              event
            ) =>
              setForm(
                (
                  current
                ) => ({
                  ...current,

                  date:
                    event.target
                      .value,
                })
              )
            }
            style={{
              width:
                "100%",

              marginTop:
                6,
            }}
          />
        </label>

        <div>
          <label>
            {isProduct
              ? "Produs"
              : "Magazin"}
          </label>

          <div
            style={{
              display:
                "flex",

              gap:
                8,

              marginTop:
                6,

              flexWrap:
                "wrap",
            }}
          >
            <input
              value={
                query
              }
              onChange={(
                event
              ) =>
                setQuery(
                  event.target
                    .value
                )
              }
              placeholder={
                isProduct
                  ? "Caută un produs"
                  : "Caută un magazin"
              }
              style={{
                flex:
                  "1 1 260px",
              }}
            />

            <button
              type="button"
              className={
                styles.tab
              }
              disabled={
                searching
              }
              onClick={
                onSearch
              }
            >
              {searching
                ? "Se caută…"
                : query.trim()
                  ? "Caută"
                  : "Afișează"}
            </button>
          </div>
        </div>

        {!!results.length && (
          <div
            style={{
              display:
                "grid",

              gap:
                8,
            }}
          >
            {results.map(
              (result) => (
                <SelectionResult
                  key={
                    result.id
                  }
                  result={
                    result
                  }
                  isProduct={
                    isProduct
                  }
                  onSelect={
                    onSelect
                  }
                />
              )
            )}
          </div>
        )}

        {selectedResult && (
          <div>
            <strong>
              Selecție curentă
            </strong>

            <div
              style={{
                marginTop:
                  8,
              }}
            >
              <SelectionResult
                result={
                  selectedResult
                }
                isProduct={
                  isProduct
                }
                selected
              />
            </div>
          </div>
        )}

        <label>
          Reducere oferită de Artfest

          <select
            value={
              form.platformDiscountPercent
            }
            onChange={(
              event
            ) =>
              setForm(
                (
                  current
                ) => ({
                  ...current,

                  platformDiscountPercent:
                    event.target
                      .value,
                })
              )
            }
            style={{
              width:
                "100%",

              marginTop:
                6,
            }}
          >
            {DISCOUNT_OPTIONS.map(
              (discount) => (
                <option
                  key={
                    discount
                  }
                  value={
                    discount
                  }
                >
                  {discount ===
                  0
                    ? "Fără reducere"
                    : `${discount}%`}
                </option>
              )
            )}
          </select>
        </label>

        <label>
          <input
            type="checkbox"
            checked={
              form.force
            }
            onChange={(
              event
            ) =>
              setForm(
                (
                  current
                ) => ({
                  ...current,

                  force:
                    event.target
                      .checked,
                })
              )
            }
          />{" "}
          Permite modificarea unei promovări
          active sau foarte apropiate
        </label>

        <div
          style={{
            display:
              "flex",

            justifyContent:
              "flex-end",

            gap:
              9,

            flexWrap:
              "wrap",
          }}
        >
          <button
            type="button"
            className={
              styles.tab
            }
            onClick={
              onClose
            }
            disabled={
              saving
            }
          >
            Renunță
          </button>

          <button
            type="submit"
            className={
              styles.tab
            }
            disabled={
              saving
            }
          >
            {saving
              ? "Se salvează…"
              : "Salvează modificările"}
          </button>
        </div>
      </form>
    </div>
  );
}

function SelectionResult({
  result,
  isProduct,
  onSelect,
  selected = false,
}) {
  const title =
    isProduct
      ? result?.title ||
        "Produs"
      : result?.profile
          ?.displayName ||
        result?.title ||
        result?.vendor
          ?.displayName ||
        "Magazin";

  const image =
    isProduct
      ? result?.images?.[0] ||
        null
      : result?.profile
          ?.coverUrl ||
        result?.profile
          ?.logoUrl ||
        result?.vendor
          ?.coverUrl ||
        result?.vendor
          ?.logoUrl ||
        result?.mediaUrls?.[0] ||
        null;

  return (
    <div
      style={{
        padding:
          10,

        borderRadius:
          11,

        border:
          selected
            ? "2px solid #22c55e"
            : "1px solid #e5e7eb",

        display:
          "flex",

        gap:
          11,

        alignItems:
          "center",
      }}
    >
      {image && (
        <img
          src={
            image
          }
          alt={
            title
          }
          style={{
            width:
              62,

            height:
              62,

            borderRadius:
              9,

            objectFit:
              "cover",
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
        <strong>
          {title}
        </strong>

        {isProduct && (
          <div
            className={
              styles.subtle
            }
          >
            {formatMoneyFromCents(
              result.priceCents,
              result.currency
            )}
            {" · "}
            {result.category ||
              "Fără categorie"}
          </div>
        )}

        {!isProduct && (
          <div
            className={
              styles.subtle
            }
          >
            {result?.city ||
              result?.profile
                ?.city ||
              result?.vendor
                ?.city ||
              "Localitate nespecificată"}
          </div>
        )}
      </div>

      {!selected &&
        onSelect && (
          <button
            type="button"
            className={
              styles.tab
            }
            onClick={() =>
              onSelect(
                result
              )
            }
          >
            Selectează
          </button>
        )}
    </div>
  );
}