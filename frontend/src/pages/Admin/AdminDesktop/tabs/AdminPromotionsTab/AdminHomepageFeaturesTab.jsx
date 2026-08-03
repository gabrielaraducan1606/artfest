// src/pages/Admin/AdminDesktop/tabs/AdminHomepageFeaturesTab.jsx

import {
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

const EMPTY_PRODUCT_FORM = {
  date: "",
  productId: "",
  platformDiscountPercent: "5",
  force: false,
};

const EMPTY_ARTISAN_FORM = {
  weekStartDate: "",
  serviceId: "",
  platformDiscountPercent: "5",
  force: false,
};

/* =========================================================
   HELPERS DATĂ
========================================================= */

function pad(value) {
  return String(value).padStart(
    2,
    "0"
  );
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

  return `${date.getFullYear()}-${pad(
    date.getMonth() + 1
  )}-${pad(date.getDate())}`;
}

function getMinimumProductDateInput() {
  const now =
    new Date();

  const minimumAllowed =
    new Date(
      now.getTime() +
        24 * 60 * 60 * 1000
    );

  const candidate =
    new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + 1,
      0,
      0,
      0,
      0
    );

  if (
    candidate.getTime() <
    minimumAllowed.getTime()
  ) {
    candidate.setDate(
      candidate.getDate() + 1
    );
  }

  return toDateInputValue(
    candidate
  );
}

function getNextMondayDateInput() {
  const date =
    new Date();

  const day =
    date.getDay();

  const daysUntilMonday =
    day === 0
      ? 1
      : 8 - day;

  date.setDate(
    date.getDate() +
      daysUntilMonday
  );

  return toDateInputValue(
    date
  );
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

function normalizePercent(value) {
  const numeric =
    Number(value);

  if (
    !Number.isFinite(numeric)
  ) {
    return 0;
  }

  return Math.min(
    50,
    Math.max(
      0,
      Math.round(numeric)
    )
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

  return type || "Promovare";
}

function getVendorStatusLabel(status) {
  if (
    status === "ACCEPTED"
  ) {
    return "Reducere acceptată";
  }

  if (
    status === "DECLINED"
  ) {
    return "Fără reducere suplimentară";
  }

  return "Așteaptă răspuns";
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
    feature?.vendor?.coverUrl ||
    feature?.vendor?.logoUrl ||
    feature?.service
      ?.mediaUrls?.[0] ||
    null
  );
}

/* =========================================================
   COMPONENTĂ PRINCIPALĂ
========================================================= */

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
    saving,
    setSaving,
  ] = useState(false);

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
    activeForm,
    setActiveForm,
  ] = useState("product");

  const [
    productForm,
    setProductForm,
  ] = useState({
    ...EMPTY_PRODUCT_FORM,

    date:
      getMinimumProductDateInput()
  });

  const [
    artisanForm,
    setArtisanForm,
  ] = useState({
    ...EMPTY_ARTISAN_FORM,

    weekStartDate:
      getNextMondayDateInput(),
  });

  const [
    productQuery,
    setProductQuery,
  ] = useState("");

  const [
    productResults,
    setProductResults,
  ] = useState([]);

  const [
    productSearchLoading,
    setProductSearchLoading,
  ] = useState(false);

  const [
    selectedProduct,
    setSelectedProduct,
  ] = useState(null);

  const [
    artisanQuery,
    setArtisanQuery,
  ] = useState("");

  const [
    artisanResults,
    setArtisanResults,
  ] = useState([]);

  const [
    artisanSearchLoading,
    setArtisanSearchLoading,
  ] = useState(false);

  const [
    selectedArtisan,
    setSelectedArtisan,
  ] = useState(null);

  const [
    editingFeature,
    setEditingFeature,
  ] = useState(null);

  const sortedFeatures =
    useMemo(
      () => {
        return [
          ...features,
        ].sort(
          (a, b) =>
            new Date(
              a.startsAt
            ).getTime() -
            new Date(
              b.startsAt
            ).getTime()
        );
      },
      [
        features,
      ]
    );

  const currentFeatures =
    useMemo(
      () => {
        const now =
          Date.now();

        return sortedFeatures.filter(
          (feature) =>
            new Date(
              feature.startsAt
            ).getTime() <= now &&
            new Date(
              feature.endsAt
            ).getTime() > now
        );
      },
      [
        sortedFeatures,
      ]
    );

  const upcomingFeatures =
    useMemo(
      () => {
        const now =
          Date.now();

        return sortedFeatures.filter(
          (feature) =>
            new Date(
              feature.startsAt
            ).getTime() > now
        );
      },
      [
        sortedFeatures,
      ]
    );

  const pastFeatures =
    useMemo(
      () => {
        const now =
          Date.now();

        return sortedFeatures
          .filter(
            (feature) =>
              new Date(
                feature.endsAt
              ).getTime() <= now
          )
          .reverse()
          .slice(
            0,
            10
          );
      },
      [
        sortedFeatures,
      ]
    );

  async function loadFeatures() {
    setLoading(true);
    setError("");

    try {
      const data =
        await api(
          "/api/admin/homepage-features"
        );

      setFeatures(
        data?.features ||
          data?.items ||
          []
      );
    } catch (loadError) {
      setError(
        loadError?.message ||
          "Nu am putut încărca promovările homepage."
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadFeatures();
  }, []);

  function clearMessages() {
    setError("");
    setSuccess("");
  }

  function resetProductForm() {
    setProductForm({
      ...EMPTY_PRODUCT_FORM,

      date:
        getMinimumProductDateInput()
    });

    setSelectedProduct(
      null
    );

    setProductQuery("");
    setProductResults([]);
    setEditingFeature(null);
  }

  function resetArtisanForm() {
    setArtisanForm({
      ...EMPTY_ARTISAN_FORM,

      weekStartDate:
        getNextMondayDateInput(),
    });

    setSelectedArtisan(
      null
    );

    setArtisanQuery("");
    setArtisanResults([]);
    setEditingFeature(null);
  }

  function resetAllForms() {
    resetProductForm();
    resetArtisanForm();
  }

  async function searchProducts() {
  clearMessages();

  setProductSearchLoading(
    true
  );

  try {
    const query =
      new URLSearchParams();

    const cleanQuery =
      productQuery.trim();

    if (cleanQuery) {
      query.set(
        "q",
        cleanQuery
      );
    }

    query.set(
      "take",
      "30"
    );

    const data =
      await api(
        `/api/admin/homepage-features/products?${query.toString()}`
      );

    const products =
      data?.products ||
      data?.items ||
      [];

    setProductResults(
      products
    );

    if (!products.length) {
      setError(
        cleanQuery
          ? "Nu am găsit produse pentru căutarea introdusă."
          : "Nu există produse eligibile pentru promovare."
      );
    }
  } catch (searchError) {
    setError(
      searchError?.message ||
        "Nu am putut încărca produsele."
    );
  } finally {
    setProductSearchLoading(
      false
    );
  }
}

  async function searchArtisans() {
  clearMessages();

  setArtisanSearchLoading(
    true
  );

  try {
    const query =
      new URLSearchParams();

    const cleanQuery =
      artisanQuery.trim();

    if (cleanQuery) {
      query.set(
        "q",
        cleanQuery
      );
    }

    query.set(
      "take",
      "30"
    );

    const data =
      await api(
        `/api/admin/homepage-features/artisans?${query.toString()}`
      );

    const artisans =
      data?.artisans ||
      data?.services ||
      data?.items ||
      [];

    setArtisanResults(
      artisans
    );

    if (!artisans.length) {
      setError(
        cleanQuery
          ? "Nu am găsit magazine pentru căutarea introdusă."
          : "Nu există magazine eligibile pentru promovare."
      );
    }
  } catch (searchError) {
    setError(
      searchError?.message ||
        "Nu am putut încărca magazinele."
    );
  } finally {
    setArtisanSearchLoading(
      false
    );
  }
}

  function chooseProduct(product) {
    setSelectedProduct(
      product
    );

    setProductForm(
      (current) => ({
        ...current,

        productId:
          product.id,
      })
    );

    setProductResults([]);
    setProductQuery(
      product.title || ""
    );
  }

  function chooseArtisan(service) {
    setSelectedArtisan(
      service
    );

    setArtisanForm(
      (current) => ({
        ...current,

        serviceId:
          service.id,
      })
    );

    setArtisanResults([]);
    setArtisanQuery(
      service?.profile
        ?.displayName ||
        service?.title ||
        service?.vendor
          ?.displayName ||
        ""
    );
  }

  async function saveProductFeature(
    event
  ) {
    event.preventDefault();

    clearMessages();

    if (
      !productForm.productId
    ) {
      setError(
        "Selectează produsul care va fi Produsul zilei."
      );

      return;
    }

    if (
      !productForm.date
    ) {
      setError(
        "Selectează data promovării."
      );

      return;
    }

    setSaving(true);

    try {
      const payload = {
        date:
          productForm.date,

        productId:
          productForm.productId,

        platformDiscountPercent:
          normalizePercent(
            productForm
              .platformDiscountPercent
          ),

        force:
          Boolean(
            productForm.force
          ),
      };

      if (
        editingFeature?.id
      ) {
        await api(
          `/api/admin/homepage-features/${editingFeature.id}`,
          {
            method:
              "PATCH",

            body:
              JSON.stringify(
                payload
              ),
          }
        );
      } else {
        await api(
          "/api/admin/homepage-features/product",
          {
            method:
              "POST",

            body:
              JSON.stringify(
                payload
              ),
          }
        );
      }

      setSuccess(
        editingFeature
          ? "Programarea Produsului zilei a fost actualizată."
          : "Produsul zilei a fost programat."
      );

      resetProductForm();

      await loadFeatures();
    } catch (saveError) {
      setError(
        saveError?.message ||
          "Nu am putut programa Produsul zilei."
      );
    } finally {
      setSaving(false);
    }
  }

  async function saveArtisanFeature(
    event
  ) {
    event.preventDefault();

    clearMessages();

    if (
      !artisanForm.serviceId
    ) {
      setError(
        "Selectează magazinul care va fi Artizanul săptămânii."
      );

      return;
    }

    if (
      !artisanForm.weekStartDate
    ) {
      setError(
        "Selectează data de început a săptămânii."
      );

      return;
    }

    setSaving(true);

    try {
      const payload = {
        weekStartDate:
          artisanForm.weekStartDate,

        serviceId:
          artisanForm.serviceId,

        platformDiscountPercent:
          normalizePercent(
            artisanForm
              .platformDiscountPercent
          ),

        force:
          Boolean(
            artisanForm.force
          ),
      };

      if (
        editingFeature?.id
      ) {
        await api(
          `/api/admin/homepage-features/${editingFeature.id}`,
          {
            method:
              "PATCH",

            body:
              JSON.stringify(
                payload
              ),
          }
        );
      } else {
        await api(
          "/api/admin/homepage-features/artisan",
          {
            method:
              "POST",

            body:
              JSON.stringify(
                payload
              ),
          }
        );
      }

      setSuccess(
        editingFeature
          ? "Programarea Artizanului săptămânii a fost actualizată."
          : "Artizanul săptămânii a fost programat."
      );

      resetArtisanForm();

      await loadFeatures();
    } catch (saveError) {
      setError(
        saveError?.message ||
          "Nu am putut programa Artizanul săptămânii."
      );
    } finally {
      setSaving(false);
    }
  }

function startEdit(feature) {
  clearMessages();

  setEditingFeature(
    feature
  );

  const startsAtTime =
    new Date(
      feature.startsAt
    ).getTime();

  const requiresForce =
    Number.isFinite(
      startsAtTime
    ) &&
    startsAtTime <
      Date.now() +
        24 * 60 * 60 * 1000;

  if (
    feature.type ===
    FEATURE_TYPES.PRODUCT_OF_DAY
  ) {
    setActiveForm(
      "product"
    );

    setSelectedProduct(
      feature.product ||
        null
    );

    setProductQuery(
      feature.product?.title ||
        ""
    );

    setProductResults([]);

    setProductForm({
      date:
        toDateInputValue(
          feature.startsAt
        ),

      productId:
        feature.productId ||
        feature.product?.id ||
        "",

      platformDiscountPercent:
        String(
          feature
            .platformDiscountPercent ??
            0
        ),

      force:
        requiresForce,
    });

    window.scrollTo({
      top:
        0,

      behavior:
        "smooth",
    });

    return;
  }

  setActiveForm(
    "artisan"
  );

  setSelectedArtisan(
    feature.service ||
      null
  );

  setArtisanQuery(
    feature.service?.profile
      ?.displayName ||
      feature.service?.title ||
      feature.vendor
        ?.displayName ||
      ""
  );

  setArtisanResults([]);

  setArtisanForm({
    weekStartDate:
      toDateInputValue(
        feature.startsAt
      ),

    serviceId:
      feature.serviceId ||
      feature.service?.id ||
      "",

    platformDiscountPercent:
      String(
        feature
          .platformDiscountPercent ??
          0
      ),

    force:
      requiresForce,
  });

  window.scrollTo({
    top:
      0,

    behavior:
      "smooth",
  });
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
        "Programarea a fost ștearsă."
      );

      if (
        editingFeature?.id ===
        feature.id
      ) {
        resetAllForms();
      }

      await loadFeatures();
    } catch (deleteError) {
      setError(
        deleteError?.message ||
          "Nu am putut șterge programarea."
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
        Se încarcă promovările homepage…
      </p>
    );
  }

  return (
    <div>
      <div
        style={{
          marginBottom:
            20,
        }}
      >
        <h2
          style={{
            marginBottom:
              6,
          }}
        >
          Promovări homepage
        </h2>

        <p
          className={
            styles.subtle
          }
        >
          Programează Produsul zilei și
          Artizanul săptămânii, setează
          reducerea oferită de Artfest și
          urmărește răspunsul vendorului.
        </p>
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

            background:
              "#f0fdf4",

            borderRadius:
              10,

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
          onClick={() => {
            resetAllForms();

            setActiveForm(
              "product"
            );
          }}
        >
          Produsul zilei
        </button>

        <button
          type="button"
          className={
            styles.tab
          }
          onClick={() => {
            resetAllForms();

            setActiveForm(
              "artisan"
            );
          }}
        >
          Artizanul săptămânii
        </button>
      </div>

      {activeForm ===
        "product" && (
        <ProductFeatureForm
          form={
            productForm
          }
          setForm={
            setProductForm
          }
          query={
            productQuery
          }
          setQuery={
            setProductQuery
          }
          results={
            productResults
          }
          selectedProduct={
            selectedProduct
          }
          searching={
            productSearchLoading
          }
          saving={
            saving
          }
          editing={
            Boolean(
              editingFeature
            )
          }
          onSearch={
            searchProducts
          }
          onChoose={
            chooseProduct
          }
          onSubmit={
            saveProductFeature
          }
          onCancel={() => {
            resetProductForm();
          }}
        />
      )}

      {activeForm ===
        "artisan" && (
        <ArtisanFeatureForm
          form={
            artisanForm
          }
          setForm={
            setArtisanForm
          }
          query={
            artisanQuery
          }
          setQuery={
            setArtisanQuery
          }
          results={
            artisanResults
          }
          selectedArtisan={
            selectedArtisan
          }
          searching={
            artisanSearchLoading
          }
          saving={
            saving
          }
          editing={
            Boolean(
              editingFeature
            )
          }
          onSearch={
            searchArtisans
          }
          onChoose={
            chooseArtisan
          }
          onSubmit={
            saveArtisanFeature
          }
          onCancel={() => {
            resetArtisanForm();
          }}
        />
      )}

      <FeatureSection
        title="Promovări active"
        features={
          currentFeatures
        }
        deletingId={
          deletingId
        }
        onEdit={
          startEdit
        }
        onDelete={
          deleteFeature
        }
      />

      <FeatureSection
        title="Promovări programate"
        features={
          upcomingFeatures
        }
        deletingId={
          deletingId
        }
        onEdit={
          startEdit
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
        deletingId={
          deletingId
        }
        onEdit={
          startEdit
        }
        onDelete={
          deleteFeature
        }
        history
      />
    </div>
  );
}

/* =========================================================
   FORMULAR PRODUSUL ZILEI
========================================================= */

function ProductFeatureForm({
  form,
  setForm,
  query,
  setQuery,
  results,
  selectedProduct,
  searching,
  saving,
  editing,
  onSearch,
  onChoose,
  onSubmit,
  onCancel,
}) {
  return (
    <form
      onSubmit={
        onSubmit
      }
      style={{
        display:
          "grid",

        gap:
          14,

        marginBottom:
          28,

        padding:
          18,

        border:
          "1px solid #e5e7eb",

        borderRadius:
          14,
      }}
    >
      <div>
        <h3
          style={{
            marginBottom:
              4,
          }}
        >
          {editing
            ? "Editează Produsul zilei"
            : "Programează Produsul zilei"}
        </h3>

        <p
          className={
            styles.subtle
          }
        >
          Selectează produsul, data și
          procentul suportat de Artfest.
        </p>
      </div>

      <label>
        Data promovării
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
            display:
              "block",

            width:
              "100%",

            marginTop:
              6,
          }}
        />
      </label>

      <div>
        <label>
          Caută produs
        </label>

        <div
          style={{
            display:
              "flex",

            gap:
              8,

            flexWrap:
              "wrap",

            marginTop:
              6,
          }}
        >
          <input
            value={
              query
            }
            placeholder="Titlu produs, categorie sau magazin"
            onChange={(
              event
            ) =>
              setQuery(
                event.target
                  .value
              )
            }
            onKeyDown={(
              event
            ) => {
              if (
                event.key ===
                "Enter"
              ) {
                event.preventDefault();

                onSearch();
              }
            }}
            style={{
              flex:
                "1 1 280px",
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
  ? "Se încarcă…"
  : query.trim()
    ? "Caută"
    : "Afișează produse"}
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
            (product) => (
              <ProductResultRow
                key={
                  product.id
                }
                product={
                  product
                }
                onChoose={
                  onChoose
                }
              />
            )
          )}
        </div>
      )}

      {selectedProduct && (
        <div>
          <strong>
            Produs selectat
          </strong>

          <div
            style={{
              marginTop:
                8,
            }}
          >
            <ProductResultRow
              product={
                selectedProduct
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
            display:
              "block",

            width:
              "100%",

            marginTop:
              6,
          }}
        >
          <option value="0">
            Fără reducere
          </option>

          <option value="5">
            5%
          </option>

          <option value="10">
            10%
          </option>

          <option value="15">
            15%
          </option>

          <option value="20">
            20%
          </option>
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
        Forțează programarea dacă începe
        în mai puțin de 24 de ore
      </label>

      <p
        className={
          styles.subtle
        }
      >
        În mod normal, promovarea trebuie
        programată cu cel puțin 24 de ore
        înainte. Forțarea trebuie folosită
        doar pentru corecții urgente.
      </p>

      <div
        style={{
          display:
            "flex",

          gap:
            10,

          flexWrap:
            "wrap",
        }}
      >
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
            : editing
              ? "Actualizează programarea"
              : "Programează produsul"}
        </button>

        {editing && (
          <button
            type="button"
            className={
              styles.tab
            }
            onClick={
              onCancel
            }
          >
            Renunță
          </button>
        )}
      </div>
    </form>
  );
}

/* =========================================================
   FORMULAR ARTIZANUL SĂPTĂMÂNII
========================================================= */

function ArtisanFeatureForm({
  form,
  setForm,
  query,
  setQuery,
  results,
  selectedArtisan,
  searching,
  saving,
  editing,
  onSearch,
  onChoose,
  onSubmit,
  onCancel,
}) {
  return (
    <form
      onSubmit={
        onSubmit
      }
      style={{
        display:
          "grid",

        gap:
          14,

        marginBottom:
          28,

        padding:
          18,

        border:
          "1px solid #e5e7eb",

        borderRadius:
          14,
      }}
    >
      <div>
        <h3
          style={{
            marginBottom:
              4,
          }}
        >
          {editing
            ? "Editează Artizanul săptămânii"
            : "Programează Artizanul săptămânii"}
        </h3>

        <p
          className={
            styles.subtle
          }
        >
          Selectează magazinul, începutul
          săptămânii și reducerea oferită
          de Artfest.
        </p>
      </div>

      <label>
        Începutul săptămânii
        <input
          type="date"
          value={
            form.weekStartDate
          }
          onChange={(
            event
          ) =>
            setForm(
              (
                current
              ) => ({
                ...current,

                weekStartDate:
                  event.target
                    .value,
              })
            )
          }
          style={{
            display:
              "block",

            width:
              "100%",

            marginTop:
              6,
          }}
        />
      </label>

      <p
        className={
          styles.subtle
        }
      >
        Este recomandat să alegi o zi de
        luni. Backendul va calcula perioada
        completă de șapte zile.
      </p>

      <div>
        <label>
          Caută magazin
        </label>

        <div
          style={{
            display:
              "flex",

            gap:
              8,

            flexWrap:
              "wrap",

            marginTop:
              6,
          }}
        >
          <input
            value={
              query
            }
            placeholder="Numele magazinului sau vendorului"
            onChange={(
              event
            ) =>
              setQuery(
                event.target
                  .value
              )
            }
            onKeyDown={(
              event
            ) => {
              if (
                event.key ===
                "Enter"
              ) {
                event.preventDefault();

                onSearch();
              }
            }}
            style={{
              flex:
                "1 1 280px",
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
  ? "Se încarcă…"
  : query.trim()
    ? "Caută"
    : "Afișează magazine"}
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
            (service) => (
              <ArtisanResultRow
                key={
                  service.id
                }
                service={
                  service
                }
                onChoose={
                  onChoose
                }
              />
            )
          )}
        </div>
      )}

      {selectedArtisan && (
        <div>
          <strong>
            Magazin selectat
          </strong>

          <div
            style={{
              marginTop:
                8,
            }}
          >
            <ArtisanResultRow
              service={
                selectedArtisan
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
            display:
              "block",

            width:
              "100%",

            marginTop:
              6,
          }}
        >
          <option value="0">
            Fără reducere
          </option>

          <option value="5">
            5%
          </option>

          <option value="10">
            10%
          </option>

          <option value="15">
            15%
          </option>

          <option value="20">
            20%
          </option>
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
        Forțează programarea dacă începe
        în mai puțin de 24 de ore
      </label>

      <div
        style={{
          display:
            "flex",

          gap:
            10,

          flexWrap:
            "wrap",
        }}
      >
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
            : editing
              ? "Actualizează programarea"
              : "Programează artizanul"}
        </button>

        {editing && (
          <button
            type="button"
            className={
              styles.tab
            }
            onClick={
              onCancel
            }
          >
            Renunță
          </button>
        )}
      </div>
    </form>
  );
}

/* =========================================================
   LISTĂ PROGRAMĂRI
========================================================= */

function FeatureSection({
  title,
  features,
  deletingId,
  onEdit,
  onDelete,
  history = false,
}) {
  return (
    <section
      style={{
        marginTop:
          28,
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
        <p
          className={
            styles.emptyState
          }
        >
          Nu există promovări în această
          secțiune.
        </p>
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
                deleting={
                  deletingId ===
                  feature.id
                }
                onEdit={
                  onEdit
                }
                onDelete={
                  onDelete
                }
                history={
                  history
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
  deleting,
  onEdit,
  onDelete,
  history,
}) {
  const image =
    getFeatureImage(
      feature
    );

  const platformPercent =
    Number(
      feature
        ?.platformDiscountPercent ||
        0
    );

  const vendorPercent =
    Number(
      feature
        ?.vendorDiscountPercent ||
        0
    );

  const totalPercent =
    Math.min(
      50,
      platformPercent +
        vendorPercent
    );

  return (
    <article
      style={{
        border:
          "1px solid #e5e7eb",

        borderRadius:
          14,

        padding:
          14,

        display:
          "grid",

        gap:
          12,
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
                80,

              height:
                80,

              objectFit:
                "cover",

              borderRadius:
                10,

              flexShrink:
                0,
            }}
          />
        )}

        <div
          style={{
            minWidth:
              0,

            flex:
              1,
          }}
        >
          <strong>
            {getFeatureTypeLabel(
              feature.type
            )}
          </strong>

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
                4,
            }}
          >
            Sursă:{" "}
            {feature.source ||
              "MANUAL"}
          </div>
        </div>
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

        <span>
          {getVendorStatusLabel(
            feature
              .vendorDiscountStatus
          )}
        </span>
      </div>

      <div
        className={
          styles.subtle
        }
      >
        Începe:{" "}
        {formatDateTime(
          feature.startsAt
        )}
        {" · "}
        Se termină:{" "}
        {formatDateTime(
          feature.endsAt
        )}
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

/* =========================================================
   REZULTAT PRODUS
========================================================= */

function ProductResultRow({
  product,
  onChoose,
  selected = false,
}) {
  return (
    <div
      style={{
        border:
          selected
            ? "2px solid #22c55e"
            : "1px solid #e5e7eb",

        borderRadius:
          12,

        padding:
          10,

        display:
          "flex",

        gap:
          12,

        alignItems:
          "center",
      }}
    >
      {product?.images?.[0] && (
        <img
          src={
            product.images[0]
          }
          alt={
            product.title
          }
          style={{
            width:
              64,

            height:
              64,

            objectFit:
              "cover",

            borderRadius:
              9,
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
          {product.title}
        </strong>

        <div
          className={
            styles.subtle
          }
        >
          {formatMoneyFromCents(
            product.priceCents,
            product.currency
          )}
          {" · "}
          {product.category ||
            "Fără categorie"}
        </div>

        <div
          className={
            styles.subtle
          }
        >
          {product?.service
            ?.profile?.displayName ||
            product?.service
              ?.title ||
            product?.service
              ?.vendor
              ?.displayName ||
            product?.vendor
              ?.displayName ||
            "Magazin necunoscut"}
        </div>
      </div>

      {!selected &&
        onChoose && (
          <button
            type="button"
            className={
              styles.tab
            }
            onClick={() =>
              onChoose(
                product
              )
            }
          >
            Selectează
          </button>
        )}
    </div>
  );
}

/* =========================================================
   REZULTAT ARTIZAN
========================================================= */

function ArtisanResultRow({
  service,
  onChoose,
  selected = false,
}) {
  const title =
    service?.profile
      ?.displayName ||
    service?.title ||
    service?.vendor
      ?.displayName ||
    "Magazin fără nume";

  const image =
    service?.profile
      ?.coverUrl ||
    service?.profile
      ?.logoUrl ||
    service?.vendor
      ?.coverUrl ||
    service?.vendor
      ?.logoUrl ||
    service?.mediaUrls?.[0] ||
    null;

  const productsCount =
    service?._count
      ?.products ??
    service?.productsCount ??
    service?.products?.length ??
    0;

  return (
    <div
      style={{
        border:
          selected
            ? "2px solid #22c55e"
            : "1px solid #e5e7eb",

        borderRadius:
          12,

        padding:
          10,

        display:
          "flex",

        gap:
          12,

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
              64,

            height:
              64,

            objectFit:
              "cover",

            borderRadius:
              9,
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

        <div
          className={
            styles.subtle
          }
        >
          {service?.city ||
            service?.profile
              ?.city ||
            service?.vendor
              ?.city ||
            "Localitate nespecificată"}
          {" · "}
          {productsCount} produse
        </div>

        <div
          className={
            styles.subtle
          }
        >
          Vendor:{" "}
          {service?.vendor
            ?.displayName ||
            "—"}
        </div>
      </div>

      {!selected &&
        onChoose && (
          <button
            type="button"
            className={
              styles.tab
            }
            onClick={() =>
              onChoose(
                service
              )
            }
          >
            Selectează
          </button>
        )}
    </div>
  );
}