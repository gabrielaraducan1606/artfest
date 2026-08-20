import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  lazy,
  Suspense,
} from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { api } from "../../../lib/api.js";
import { SEO } from "../../../components/Seo/SeoProvider";
import styles from "./ProductDetails.module.css";
import {
  FaChevronLeft,
  FaChevronDown,
  FaShareAlt,
  FaShoppingCart,
  FaHeart,
  FaRegHeart,
  FaStore,
  FaEdit,
} from "react-icons/fa";
import {
  productPlaceholder,
  avatarPlaceholder,
  onImgError,
} from "../../../components/utils/imageFallback.js";

import { useIsMobile } from "./hooks/useIsMobile.js";
import { ProductGallery } from "./components/ProductGallery.jsx";
import DetailsContent from "./components/DetailsContent.jsx";
import { getHasStructuredDetails } from "./hooks/detailsUtils.js";
import { resolveFileUrl, withCache } from "./hooks/urlUtils.js";
import { addToGuestCart } from "../../../utils/guestCart";
import {
  trackViewContent,
  trackAddToCart,
} from "../../../../services/analytics.js";
import {
  MagicIcon,
} from "../../../components/AIAssistant/Personalization/PersonalizationIcons.jsx";

const ReviewsSection = lazy(() => import("./ReviewSection/ReviewSection"));
const CommentsSection = lazy(() => import("./CommentSection/CommentSection"));
const ProductModal = lazy(() =>
  import("../ProfilMagazin/modals/ProductModal.jsx")
);

const StoreProductsSlider = lazy(() =>
  import("./components/StoreProductsSlider.jsx").then((m) => ({
    default: m.StoreProductsSlider,
  }))
);

const SimilarProductsGrid = lazy(() =>
  import("./components/SimilarProductsGrid.jsx").then((m) => ({
    default: m.SimilarProductsGrid,
  }))
);

const ImageZoom = lazy(() =>
  import("./components/ImageZoom.jsx").then((m) => ({
    default: m.ImageZoom,
  }))
);

const dateOnlyToISO = (yyyyMmDd) => {
  if (!yyyyMmDd) return null;
  const [y, m, d] = String(yyyyMmDd).split("-").map(Number);
  if (!y || !m || !d) return null;
  const dt = new Date(y, m - 1, d, 12, 0, 0);
  return dt.toISOString();
};

const emptyProdForm = {
  id: "",
  title: "",
  description: "",
  price: 0,
  images: [],
  category: "",
  currency: "RON",
  isActive: true,

  availability: "READY",
  leadTimeDays: "",
  readyQty: "",
  nextShipDate: "",
  acceptsCustom: false,
  isHidden: false,

  orderMode: "READY_TO_BUY",
  optionsSchema: [],
  customSchema: [],
  repeatedGroups: [],
  quoteSchema: [],

  color: "",
  materialMain: "",
  technique: "",
  styleTags: "",
  occasionTags: "",
  dimensions: "",
  careInstructions: "",
  specialNotes: "",
};

function ProductDetailsSkeleton() {
  return (
    <div className={styles.pageWrap}>
      <div className={styles.breadcrumbs}>
        <button className={styles.linkBtn} type="button" disabled>
          <FaChevronLeft /> Înapoi
        </button>
      </div>

      <div className={styles.grid}>
        <div
          style={{
            width: "100%",
            aspectRatio: "4 / 3",
            borderRadius: 16,
            background: "rgba(255,255,255,0.06)",
          }}
        />

        <div className={styles.infoCard}>
          <div
            style={{
              height: 34,
              width: "70%",
              borderRadius: 10,
              background: "rgba(255,255,255,0.06)",
              marginBottom: 12,
            }}
          />
          <div
            style={{
              height: 18,
              width: "40%",
              borderRadius: 10,
              background: "rgba(255,255,255,0.05)",
              marginBottom: 18,
            }}
          />
          <div
            style={{
              height: 28,
              width: 120,
              borderRadius: 10,
              background: "rgba(255,255,255,0.08)",
              marginBottom: 18,
            }}
          />
          <div
            style={{
              height: 44,
              width: "100%",
              borderRadius: 12,
              background: "rgba(255,255,255,0.05)",
              marginBottom: 12,
            }}
          />
          <div
            style={{
              height: 110,
              width: "100%",
              borderRadius: 14,
              background: "rgba(255,255,255,0.04)",
            }}
          />
        </div>
      </div>
    </div>
  );
}

export default function ProductDetails() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [me, setMe] = useState(null);
  const [favorites, setFavorites] = useState(() => new Set());
  const [product, setProduct] = useState(null);

  const [storeProducts, setStoreProducts] = useState([]);
  const [similarProducts, setSimilarProducts] = useState([]);

  const [reviews, setReviews] = useState([]);
  const [avg, setAvg] = useState({ average: 0, count: 0 });

  const [comments, setComments] = useState([]);

  const [activeIdx, setActiveIdx] = useState(0);
  const [zoomOpen, setZoomOpen] = useState(false);

 const [qty, setQty] = useState(1);
const [adding, setAdding] = useState(false);

const [
  uploadingCustomization,
  setUploadingCustomization,
] = useState({});

const [selectedOptions, setSelectedOptions] = useState({});
const [customAnswers, setCustomAnswers] = useState({});
const [customizationOpen, setCustomizationOpen] = useState(false);
const [validationErrors, setValidationErrors] = useState({});
const [
  repeatedGroupAnswers,
  setRepeatedGroupAnswers,
] = useState({});
useEffect(() => {
  const handlePersonalizationComplete = (event) => {
    const detail = event?.detail || {};

    /*
     * Ignorăm eventuale rezultate pentru
     * alt produs.
     */
    if (
      !detail.productId ||
      detail.productId !== product?.id
    ) {
      return;
    }

    if (
      detail.selectedOptions &&
      typeof detail.selectedOptions === "object"
    ) {
      setSelectedOptions(
        detail.selectedOptions
      );
    }

    if (
      detail.customAnswers &&
      typeof detail.customAnswers === "object"
    ) {
      setCustomAnswers(
        detail.customAnswers
      );
    }

    if (
      detail.repeatedGroupAnswers &&
      typeof detail.repeatedGroupAnswers === "object"
    ) {
      setRepeatedGroupAnswers(
        detail.repeatedGroupAnswers
      );
    }

    /*
     * Ștergem eventualele erori vechi
     * și deschidem formularul pentru
     * verificare.
     */
    setValidationErrors({});
    setCustomizationOpen(true);
  };

  window.addEventListener(
    "artfest:personalization-complete",
    handlePersonalizationComplete
  );

  return () => {
    window.removeEventListener(
      "artfest:personalization-complete",
      handlePersonalizationComplete
    );
  };
}, [product?.id]);
  const [revRating, setRevRating] = useState(0);
  const [revText, setRevText] = useState("");
  const [submittingReview, setSubmittingReview] = useState(false);

  const [commentText, setCommentText] = useState("");
  const [submittingComment, setSubmittingComment] = useState(false);
  const [editingCommentId, setEditingCommentId] = useState(null);

  const [openAccordions, setOpenAccordions] = useState({
    details: false,
    reviews: false,
    comments: false,
  });

  const [activeMobileTab, setActiveMobileTab] = useState("descriere");
  const isMobile = useIsMobile(768);

  const [editOpen, setEditOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState(null);
  const [prodForm, setProdForm] = useState(emptyProdForm);
  const [savingProd, setSavingProd] = useState(false);
  const [categories, setCategories] = useState([]);

  const [reviewsLoaded, setReviewsLoaded] = useState(false);
  const [commentsLoaded, setCommentsLoaded] = useState(false);
  const [deferredSections, setDeferredSections] = useState(false);

  const mountedRef = useRef(true);
const requestSeqRef = useRef(0);

const trackedViewContentRef =
  useRef(null);

  const touchStartX = useRef(null);
  const touchEndX = useRef(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    setActiveIdx(0);
    setQty(1);
    setMe(null);
setFavorites(new Set());
    setZoomOpen(false);

    setEditOpen(false);
    setEditingProduct(null);
    setProdForm(emptyProdForm);

    setComments([]);
    setCommentText("");
    setEditingCommentId(null);

    setReviews([]);
    setAvg({ average: 0, count: 0 });

    setStoreProducts([]);
    setSimilarProducts([]);

    setReviewsLoaded(false);
    setCommentsLoaded(false);
    setDeferredSections(false);
    setSelectedOptions({});
setCustomAnswers({});
setRepeatedGroupAnswers({});
    setCustomizationOpen(false);
    setValidationErrors({});
  }, [id]);

  const cacheT = useMemo(() => {
    if (!product?.updatedAt) return "1";
    return String(new Date(product.updatedAt).getTime());
  }, [product?.updatedAt]);

  const images = useMemo(() => {
    const list =
      Array.isArray(product?.images) && product.images.length
        ? product.images
        : [];
    return list.length ? list : [productPlaceholder(1000, 750, "Produs")];
  }, [product?.images]);

  useEffect(() => {
    setActiveIdx((i) => (images[i] ? i : 0));
  }, [images]);

  const activeSrc = useMemo(
    () => withCache(resolveFileUrl(images[activeIdx] || images[0]), cacheT),
    [images, activeIdx, cacheT]
  );

  useEffect(() => {
    if (!activeSrc) return;

    const link = document.createElement("link");
    link.rel = "preload";
    link.as = "image";
    link.href = activeSrc;
    document.head.appendChild(link);

    return () => {
      try {
        document.head.removeChild(link);
      } catch {
        /* ignore */
      }
    };
  }, [activeSrc]);

  useEffect(() => {
    const next = images[(activeIdx + 1) % images.length];
    if (!next) return;

    const img = new Image();
    img.decoding = "async";
    img.src = withCache(resolveFileUrl(next), cacheT);
  }, [activeIdx, images, cacheT]);

const priceDisplay = useMemo(() => {
  if (!product) {
    return {
      originalPrice: null,
      finalPrice: null,
      discountPercent: 0,
      hasDiscount: false,
    };
  }

  const hasNumericValue = (value) =>
    value !== null &&
    value !== undefined &&
    value !== "" &&
    Number.isFinite(Number(value));

  const fallbackPriceCents =
    hasNumericValue(product.priceCents)
      ? Number(product.priceCents)
      : hasNumericValue(product.price)
        ? Math.round(Number(product.price) * 100)
        : null;

  const originalPriceCents =
    hasNumericValue(product.originalPriceCents)
      ? Number(product.originalPriceCents)
      : fallbackPriceCents;

  const finalPriceCents =
    hasNumericValue(product.finalPriceCents)
      ? Number(product.finalPriceCents)
      : hasNumericValue(product.discountedPriceCents)
        ? Number(product.discountedPriceCents)
        : fallbackPriceCents;

  const rawDiscountPercent =
    product.totalDiscountPercent ??
    product.discount?.totalDiscountPercent ??
    0;

  const discountPercent = Math.min(
    50,
    Math.max(
      0,
      Number.isFinite(Number(rawDiscountPercent))
        ? Number(rawDiscountPercent)
        : 0
    )
  );

  const hasDiscount =
    product.orderMode !== "QUOTE_ONLY" &&
    Boolean(
      product.hasActiveHomepageDiscount ||
        (
          discountPercent > 0 &&
          originalPriceCents !== null &&
          finalPriceCents !== null &&
          finalPriceCents < originalPriceCents
        )
    );

  return {
    originalPrice:
      originalPriceCents !== null
        ? originalPriceCents / 100
        : null,

    finalPrice:
      finalPriceCents !== null
        ? finalPriceCents / 100
        : null,

    discountPercent,
    hasDiscount,
  };
}, [product]);

const displayPrice =
  priceDisplay.finalPrice;

const originalDisplayPrice =
  priceDisplay.originalPrice;
useEffect(() => {
  if (!product?.id) {
    return;
  }

  /*
   * Evităm trimiterea de două ori
   * pentru același produs la rerender.
   */
  if (
    trackedViewContentRef.current ===
    product.id
  ) {
    return;
  }

  trackedViewContentRef.current =
    product.id;

  trackViewContent({
    ...product,

    /*
     * Pentru tracking trimitem
     * prețul REAL afișat clientului,
     * inclusiv reducerea Artfest.
     */
    price:
      displayPrice ??
      product.price ??
      0,

    currency:
      product.currency ||
      "RON",
  });
}, [
  product?.id,
  displayPrice,
  product?.currency,
  product
]);
const hasHomepageDiscount =
  priceDisplay.hasDiscount;

const homepageDiscountPercent =
  priceDisplay.discountPercent;

  const fmt = useMemo(
    () =>
      new Intl.NumberFormat("ro-RO", {
        style: "currency",
        currency: product?.currency || "RON",
      }),
    [product?.currency]
  );

const priceInfo = useMemo(() => {
  if (!product || displayPrice == null) {
    return null;
  }

  if (hasHomepageDiscount) {
    return `Reducere specială Artfest de ${homepageDiscountPercent}%.`;
  }

  return "TVA inclus în preț.";
}, [
  product,
  displayPrice,
  hasHomepageDiscount,
  homepageDiscountPercent,
]);

  const availabilityText = useMemo(() => {
    if (!product?.availability) return null;

    switch (product.availability) {
      case "READY":
        if (typeof product.readyQty === "number") {
          if (product.readyQty > 0) {
            return `În stoc (${product.readyQty} bucăți disponibile).`;
          }
          return "În stoc, dar stoc foarte limitat.";
        }
        return "În stoc, gata de livrare.";

      case "MADE_TO_ORDER":
        return product.leadTimeDays
          ? `Realizat la comandă, timpul de execuție este de aproximativ ${product.leadTimeDays} zile.`
          : "Realizat la comandă, timpul de execuție este comunicat după plasarea comenzii.";

      case "PREORDER":
        return product.nextShipDate
          ? `Disponibil la precomandă, livrare estimată începând cu ${new Date(
              product.nextShipDate
            ).toLocaleDateString("ro-RO")}.`
          : "Disponibil la precomandă.";

      case "SOLD_OUT":
        return "Stoc epuizat momentan.";

      default:
        return null;
    }
  }, [product]);

  const isSoldOut = product?.availability === "SOLD_OUT";

const optionsSchema = useMemo(() => {
  if (
    Array.isArray(
      product?.optionsSchema
    )
  ) {
    return product.optionsSchema;
  }

  if (
    Array.isArray(
      product?.optionsSchema?.fields
    )
  ) {
    return product.optionsSchema.fields;
  }

  return [];
}, [product?.optionsSchema]);

const customSchema = useMemo(() => {
  if (
    Array.isArray(
      product?.customSchema
    )
  ) {
    return product.customSchema;
  }

  if (
    Array.isArray(
      product?.customSchema?.fields
    )
  ) {
    return product.customSchema.fields;
  }

  return [];
}, [product?.customSchema]);

const repeatedGroups = useMemo(() => {
  if (
    !Array.isArray(
      product?.repeatedGroups
    )
  ) {
    return [];
  }

  const allFields = [
    ...optionsSchema,
    ...customSchema,
  ];

  const fieldsByKey =
    new Map(
      allFields
        .filter(
          (field) =>
            field?.key
        )
        .map(
          (field) => [
            String(
              field.key
            ),
            field,
          ]
        )
    );

  return product.repeatedGroups
    .map((group) => {
      if (
        !group ||
        typeof group !==
          "object"
      ) {
        return null;
      }

      const rawFields =
        Array.isArray(
          group.fields
        )
          ? group.fields
          : [];

      const fields =
        rawFields
          .map((field) => {
            /*
             * Format vechi/nou:
             * fields: ["marime", "culoare"]
             */
            if (
              typeof field ===
              "string"
            ) {
              return (
                fieldsByKey.get(
                  field
                ) || {
                  key: field,
                  label: field,
                  type: "text",
                  required: false,
                }
              );
            }

            /*
             * Dacă avem deja
             * obiectul complet.
             */
            if (
              field &&
              typeof field ===
                "object"
            ) {
              const key =
                field.key;

              if (!key) {
                return null;
              }

              return {
                ...(
                  fieldsByKey.get(
                    String(key)
                  ) || {}
                ),
                ...field,
              };
            }

            return null;
          })
          .filter(Boolean);

      return {
        ...group,
        fields,
      };
    })
    .filter(Boolean);
}, [
  product?.repeatedGroups,
  optionsSchema,
  customSchema,
]);

const repeatedFieldKeys = useMemo(() => {
  const keys = new Set();

  for (const group of repeatedGroups) {
    const fields = Array.isArray(
      group?.fields
    )
      ? group.fields
      : [];

    for (const field of fields) {
      if (field?.key) {
        keys.add(field.key);
      }
    }
  }

  return keys;
}, [repeatedGroups]);

const topLevelOptionsSchema = useMemo(
  () =>
    optionsSchema.filter(
      (field) =>
        !repeatedFieldKeys.has(
          field.key
        )
    ),
  [
    optionsSchema,
    repeatedFieldKeys,
  ]
);

const topLevelCustomSchema = useMemo(
  () =>
    customSchema.filter(
      (field) =>
        !repeatedFieldKeys.has(
          field.key
        )
    ),
  [
    customSchema,
    repeatedFieldKeys,
  ]
);

const hasOrderOptions =
  topLevelOptionsSchema.length > 0 ||
  topLevelCustomSchema.length > 0 ||
  repeatedGroups.length > 0;

  const createEmptyRepeatedItem =
  useCallback((group) => {
    const item = {};

    const fields =
      Array.isArray(group?.fields)
        ? group.fields
        : [];

    for (const field of fields) {
      if (!field?.key) {
        continue;
      }

      item[field.key] = "";
    }

    return item;
  }, []);

useEffect(() => {
  if (!repeatedGroups.length) {
    setRepeatedGroupAnswers({});
    return;
  }

  setRepeatedGroupAnswers(
    (current) => {
      const next = {
        ...current,
      };

      for (const group of repeatedGroups) {
        const groupKey =
          group?.key || group?.id;

        if (!groupKey) {
          continue;
        }

        const existing =
          Array.isArray(
            next[groupKey]
          )
            ? next[groupKey]
            : [];

        if (existing.length) {
          continue;
        }

        next[groupKey] = [
          createEmptyRepeatedItem(
            group
          ),
        ];
      }

      return next;
    }
  );
}, [
  repeatedGroups,
  createEmptyRepeatedItem,
]);

const addRepeatedItem =
  useCallback(
    (group) => {
      const groupKey =
        group?.key || group?.id;

      if (!groupKey) {
        return;
      }

      setRepeatedGroupAnswers(
        (current) => {
          const items =
            Array.isArray(
              current[groupKey]
            )
              ? current[groupKey]
              : [];

          if (items.length >= 10) {
            return current;
          }

          return {
            ...current,

            [groupKey]: [
              ...items,
              createEmptyRepeatedItem(
                group
              ),
            ],
          };
        }
      );
    },
    [createEmptyRepeatedItem]
  );

const removeRepeatedItem =
  useCallback(
    (
      group,
      itemIndex
    ) => {
      const groupKey =
        group?.key || group?.id;

      if (!groupKey) {
        return;
      }

      setRepeatedGroupAnswers(
        (current) => {
          const items =
            Array.isArray(
              current[groupKey]
            )
              ? current[groupKey]
              : [];

          if (items.length <= 1) {
            return current;
          }

          return {
            ...current,

            [groupKey]:
              items.filter(
                (_, index) =>
                  index !== itemIndex
              ),
          };
        }
      );
    },
    []
  );

const updateRepeatedItemField =
  useCallback(
    (
      group,
      itemIndex,
      fieldKey,
      value
    ) => {
      const groupKey =
        group?.key || group?.id;

      if (
        !groupKey ||
        !fieldKey
      ) {
        return;
      }

      setRepeatedGroupAnswers(
        (current) => {
          const items =
            Array.isArray(
              current[groupKey]
            )
              ? current[groupKey]
              : [];

          const nextItems =
            items.map(
              (item, index) =>
                index === itemIndex
                  ? {
                      ...item,
                      [fieldKey]:
                        value,
                    }
                  : item
            );

          return {
            ...current,
            [groupKey]:
              nextItems,
          };
        }
      );

      setValidationErrors(
        (current) => {
          const errorKey =
            `repeated:${groupKey}:${itemIndex}:${fieldKey}`;

          if (!current[errorKey]) {
            return current;
          }

          const next = {
            ...current,
          };

          delete next[errorKey];

          return next;
        }
      );
    },
    []
  );

  const myVendorId = me?.vendor?.id ?? null;
  const myUserId = me?.id ?? me?.sub ?? null;

const missingRequiredSelection = useMemo(() => {
  const missingOption =
    topLevelOptionsSchema.some((field) => {
      if (field?.required === false) {
        return false;
      }

      return !String(
        selectedOptions[field.key] || ""
      ).trim();
    });

  const missingCustomAnswer =
    topLevelCustomSchema.some((field) => {
      if (!field?.required) {
        return false;
      }

      return !String(
        customAnswers[field.key] || ""
      ).trim();
    });

  const missingRepeatedAnswer =
    repeatedGroups.some((group) => {
      const groupKey =
        group?.key || group?.id;

      if (!groupKey) {
        return false;
      }

      const items = Array.isArray(
        repeatedGroupAnswers[groupKey]
      )
        ? repeatedGroupAnswers[groupKey]
        : [];

      if (!items.length) {
        return true;
      }

      const fields = Array.isArray(
        group?.fields
      )
        ? group.fields
        : [];

      return items.some((item) =>
        fields.some((field) => {
          if (field?.required === false) {
            return false;
          }

          return !String(
            item?.[field.key] ?? ""
          ).trim();
        })
      );
    });

  return (
    missingOption ||
    missingCustomAnswer ||
    missingRepeatedAnswer
  );
}, [
  topLevelOptionsSchema,
  topLevelCustomSchema,
  repeatedGroups,
  selectedOptions,
  customAnswers,
  repeatedGroupAnswers,
]);


  const ownerVendorId =
    product?.service?.vendor?.id ??
    product?.vendor?.id ??
    product?.ownerVendorId ??
    null;

  const ownerUserId =
    product?.service?.vendor?.userId ?? product?.vendor?.userId ?? null;

  const isOwner = useMemo(() => {
    const byVendor =
      !!myVendorId && !!ownerVendorId && myVendorId === ownerVendorId;
    const byUser = !!myUserId && !!ownerUserId && myUserId === ownerUserId;
    return byVendor || byUser;
  }, [myVendorId, myUserId, ownerVendorId, ownerUserId]);

  const viewMode = isOwner ? "vendor" : me ? "user" : "guest";

  const requireAuth = useCallback(
    (fn) => (...args) => {
      if (!me) {
        alert(
          "Pentru a salva produsele tale preferate și a putea reveni la ele oricând, te rugăm să te autentifici. Te așteptăm cu drag, durează doar câteva secunde! 💛"
        );
        const redir = encodeURIComponent(
          window.location.pathname + window.location.search
        );
        navigate(`/autentificare?redirect=${redir}`);
        return;
      }
      return fn(...args);
    },
    [me, navigate]
  );
const isQuoteOnly =
  product?.orderMode === "QUOTE_ONLY";

const onRequestQuote = useCallback(() => {
  if (!product || isOwner) {
    return;
  }

  if (!me) {
    const redir = encodeURIComponent(
      window.location.pathname +
        window.location.search
    );

    navigate(
      `/autentificare?redirect=${redir}`
    );

    return;
  }

  window.dispatchEvent(
    new CustomEvent(
      "artfest:quote-request",
      {
        detail: {
          productId:
            product.id,

          productTitle:
            product.title,

          vendorId:
            product?.service
              ?.vendor?.id ||
            product?.vendor?.id ||
            null,

          vendorName:
            product?.service
              ?.profile
              ?.displayName ||
            product?.vendor
              ?.displayName ||
            null,

          image:
            Array.isArray(
              product.images
            )
              ? product.images[0] ||
                null
              : null,

          quoteSchema:
            product.quoteSchema ||
            [],
        },
      }
    )
  );
}, [
  product,
  isOwner,
  me,
  navigate,
]);

const onStartPersonalizationAssistant =
  useCallback(() => {
    if (
      !product ||
      isOwner ||
      !hasOrderOptions
    ) {
      return;
    }

    window.dispatchEvent(
      new CustomEvent(
        "artfest:personalization-start",
        {
          detail: {
            productId:
              product.id,

            productTitle:
              product.title,

            image:
              Array.isArray(
                product.images
              )
                ? product.images[0] ||
                  null
                : null,

            /*
             * Variante normale:
             * culoare, mărime etc.
             */
            optionsSchema:
              topLevelOptionsSchema,

            /*
             * Personalizare:
             * nume, text etc.
             */
            customSchema:
              topLevelCustomSchema,

            /*
             * Seturi / persoane multiple.
             */
            repeatedGroups,

            /*
             * Dacă utilizatorul a completat
             * deja ceva manual, AI-ul pornește
             * de la valorile existente.
             */
            currentAnswers: {
              selectedOptions,
              customAnswers,
              repeatedGroupAnswers,
            },
          },
        }
      )
    );
  }, [
    product,
    isOwner,
    hasOrderOptions,
    topLevelOptionsSchema,
    topLevelCustomSchema,
    repeatedGroups,
    selectedOptions,
    customAnswers,
    repeatedGroupAnswers,
  ]);

const onAddToCart = useCallback(async () => {
  if (
    !product ||
    isOwner ||
    adding ||
    isSoldOut
  ) {
    return;
  }

  if (hasOrderOptions) {
    const nextErrors = {};
    let hasCustomError = false;

    /*
     * Variante care se aleg o singură dată
     * pentru întreg produsul.
     */
    for (const field of topLevelOptionsSchema) {
      const value = String(
        selectedOptions[field.key] || ""
      ).trim();

      if (
        field?.required !== false &&
        !value
      ) {
        nextErrors[
          `option:${field.key}`
        ] = `Alege ${
          field.label ||
          "această opțiune"
        }.`;
      }
    }

    /*
     * Personalizări care se completează
     * o singură dată.
     */
    for (const field of topLevelCustomSchema) {
      const value = String(
        customAnswers[field.key] || ""
      ).trim();

      if (
        field?.required &&
        !value
      ) {
        nextErrors[
          `custom:${field.key}`
        ] = `Completează ${
          field.label ||
          "acest câmp"
        }.`;

        hasCustomError = true;
      }
    }

    /*
     * Câmpurile care se completează
     * separat pentru fiecare membru.
     */
    for (const group of repeatedGroups) {
      const groupKey =
        group?.key || group?.id;

      if (!groupKey) {
        continue;
      }

      const items = Array.isArray(
        repeatedGroupAnswers[groupKey]
      )
        ? repeatedGroupAnswers[groupKey]
        : [];

      const fields = Array.isArray(
        group?.fields
      )
        ? group.fields
        : [];

      /*
       * Dacă grupul există, avem nevoie
       * de cel puțin un membru.
       */
      if (!items.length) {
        nextErrors[
          `repeated:${groupKey}`
        ] =
          "Adaugă cel puțin un membru.";

        continue;
      }

      items.forEach(
        (item, itemIndex) => {
          for (const field of fields) {
            if (
              field?.required === false
            ) {
              continue;
            }

            const value = String(
              item?.[field.key] ?? ""
            ).trim();

            if (!value) {
              nextErrors[
                `repeated:${groupKey}:${itemIndex}:${field.key}`
              ] =
                `Completează ${
                  field.label ||
                  "acest câmp"
                } pentru membrul ${
                  itemIndex + 1
                }.`;
            }
          }
        }
      );
    }

    if (
      Object.keys(nextErrors)
        .length > 0
    ) {
      setValidationErrors(
        nextErrors
      );

      if (hasCustomError) {
        setCustomizationOpen(true);
      }

      requestAnimationFrame(() => {
        const firstInvalid =
          document.querySelector(
            '[data-validation-error="true"]'
          );

        if (firstInvalid) {
          firstInvalid.scrollIntoView({
            behavior: "smooth",
            block: "center",
          });
        }
      });

      return;
    }

    setValidationErrors({});
  }

  setAdding(true);

  try {

    const configuration = {
      selectedOptions,
      customAnswers,
      repeatedGroupAnswers,
    };

    if (me) {
      try {
        const response = await api(
          "/api/cart/add",
          {
            method: "POST",

            body: {
              productId: product.id,
              qty,

              ...configuration,
            },
          }
        );

        /*
         * Unele versiuni ale helperului api()
         * întorc __unauth în loc să arunce.
         */
        if (
          response?.__unauth ||
          response?.status === 401
        ) {
          addToGuestCart(
            product.id,
            qty,
            configuration
          );

        }

        if (
          response?.error ===
          "cannot_add_own_product"
        ) {
          alert(
            "Nu poți adăuga în coș propriul produs."
          );

          return;
        }
      } catch (error) {
        const status =
          error?.status ||
          error?.response?.status ||
          error?.data?.status;

        const errorCode =
          error?.error ||
          error?.code ||
          error?.data?.error ||
          error?.response?.data
            ?.error;

        /*
         * Token expirat sau sesiune invalidă:
         * produsul intră în coșul guest.
         */
        if (
          status === 401 ||
          errorCode === "unauthorized" ||
          errorCode === "AUTH_REQUIRED"
        ) {
          addToGuestCart(
            product.id,
            qty,
            configuration
          );

        } else {
          throw error;
        }
      }
    } else {
      addToGuestCart(
        product.id,
        qty,
        configuration
      );

    }

  window.dispatchEvent(
  new CustomEvent(
    "cart:changed"
  )
);

try {
  sessionStorage.removeItem(
    "cart:ui-cache:v1"
  );

  sessionStorage.removeItem(
    "cart:ui-cache:v2"
  );
} catch {
  // ignore
}

/*
 * META + GA
 *
 * Ajungem aici DOAR dacă produsul
 * a fost adăugat cu succes în coș.
 */
trackAddToCart({
  ...product,

  price:
    displayPrice ??
    product.price ??
    0,

  currency:
    product.currency ||
    "RON",

  quantity:
    qty,
});

alert(
  "Produs adăugat în coș."
);
  } catch (error) {
    console.error(
      "Add to cart error:",
      error
    );

    const code =
      error?.error ||
      error?.code ||
      error?.data?.error ||
      error?.response?.data
        ?.error;

    const message =
      error?.data?.message ||
      error?.response?.data
        ?.message ||
      error?.message;

    if (
      code ===
      "insufficient_stock"
    ) {
      alert(
        message ||
          "Nu sunt disponibile suficiente produse."
      );

      return;
    }

    if (
      code ===
      "product_sold_out"
    ) {
      alert(
        "Produsul este epuizat."
      );

      return;
    }

    if (
      code ===
      "product_unavailable"
    ) {
      alert(
        "Produsul nu mai este disponibil."
      );

      return;
    }

    if (
      code ===
      "cannot_add_own_product"
    ) {
      alert(
        "Nu poți adăuga în coș propriul produs."
      );

      return;
    }

    alert(
      message ||
        "Nu am putut adăuga produsul în coș."
    );
  } finally {
    setAdding(false);
  }
}, [
  product,
  isOwner,
  adding,
  isSoldOut,
  me,
  qty,

  selectedOptions,
  customAnswers,
  repeatedGroupAnswers,

  hasOrderOptions,

  topLevelOptionsSchema,
  topLevelCustomSchema,
  repeatedGroups,
  displayPrice
]);
  const addToCartAny = onAddToCart;

  const isFav = useMemo(
    () => (product ? favorites.has(product.id) : false),
    [favorites, product]
  );

  const toggleFavorite = useCallback(async () => {
    if (!product || isOwner) return;

    const prev = isFav;

    setFavorites((set) => {
      const next = new Set(set);
      prev ? next.delete(product.id) : next.add(product.id);
      return next;
    });

    try {
      const r = await api("/api/favorites/toggle", {
        method: "POST",
        body: { productId: product.id },
      });

      if (r?.error === "cannot_favorite_own_product") {
        setFavorites((set) => {
          const next = new Set(set);
          prev ? next.add(product.id) : next.delete(product.id);
          return next;
        });
        alert("Nu poți adăuga la favorite un produs care îți aparține.");
      }
    } catch (e) {
      setFavorites((set) => {
        const next = new Set(set);
        prev ? next.add(product.id) : next.delete(product.id);
        return next;
      });

      const msg =
        e?.message ||
        (e?.status === 403
          ? "Nu poți adăuga la favorite un produs care îți aparține."
          : "Nu am putut actualiza favoritele.");
      alert(msg);
    }
  }, [product, isOwner, isFav]);

  const toggleFavoriteSafe = requireAuth(toggleFavorite);

  const shareIt = useCallback(async () => {
    try {
      const url = window.location.href;
      if (navigator.share) {
        await navigator.share({ title: product?.title || "Produs", url });
      } else if (navigator.clipboard) {
        await navigator.clipboard.writeText(url);
        alert("Link copiat în clipboard.");
      } else {
        const ta = document.createElement("textarea");
        ta.value = url;
        document.body.appendChild(ta);
        ta.select();
        try {
          document.execCommand("copy");
          alert("Link copiat în clipboard.");
        } finally {
          document.body.removeChild(ta);
        }
      }
    } catch (e) {
      console.error(e);
      alert("Nu am putut copia linkul.");
    }
  }, [product?.title]);

  const loadReviewsForProduct = useCallback(async (prodId) => {
    try {
      const [list, stats] = await Promise.all([
        api(
          `/api/public/product/${encodeURIComponent(
            prodId
          )}/reviews?sort=recent&skip=0&take=50`
        ),
        api(
          `/api/public/product/${encodeURIComponent(
            prodId
          )}/reviews/average`
        ),
      ]);

      const items = Array.isArray(list?.items) ? list.items : [];

      if (!mountedRef.current) return;

      setReviews(items);
      setAvg({
        average: typeof stats?.average === "number" ? stats.average : 0,
        count: typeof stats?.count === "number" ? stats.count : items.length,
      });
    } catch {
      if (!mountedRef.current) return;
      setReviews([]);
      setAvg({ average: 0, count: 0 });
    }
  }, []);

  const loadCommentsForProduct = useCallback(async (prodId) => {
    try {
      const res = await api(
        `/api/public/product/${encodeURIComponent(
          prodId
        )}/comments?skip=0&take=50`
      );

      const items = Array.isArray(res?.items) ? res.items : [];
      if (!mountedRef.current) return;

      setComments(items);
    } catch (e) {
      console.error("loadCommentsForProduct error", e);
      if (!mountedRef.current) return;
      setComments([]);
    }
  }, []);

  const loadStoreProducts = useCallback(async (p) => {
    if (!p?.service?.profile?.slug) {
      if (mountedRef.current) setStoreProducts([]);
      return;
    }

    try {
      const items = await api(
        `/api/public/store/${encodeURIComponent(p.service.profile.slug)}/products?take=12`
      );

      if (!mountedRef.current) return;

      const list = Array.isArray(items) ? items : [];
      setStoreProducts(list.filter((x) => x.id !== p.id));
    } catch {
      if (mountedRef.current) setStoreProducts([]);
    }
  }, []);

  const loadSimilarProducts = useCallback(async (p) => {
    try {
      const params = new URLSearchParams();
      params.set("limit", "48");
      params.set("sort", "popular");
      if (p.category) params.set("category", p.category);
      if (p.color) params.set("color", p.color);

      const res = await api(`/api/public/products?${params.toString()}`);
      if (!mountedRef.current) return;

      const items = Array.isArray(res?.items) ? res.items : [];
      const baseList = items.filter((it) => it.id !== p.id);

      const same = (a, b) =>
        a && b && String(a).toLowerCase() === String(b).toLowerCase();

      const splitTags = (v) =>
        String(v || "")
          .split(",")
          .map((t) => t.trim().toLowerCase())
          .filter(Boolean);

      const productStyleTags = splitTags(p.styleTags);
      const productOccasionTags = splitTags(p.occasionTags);

      let strict = baseList.filter((it) => same(it.category, p.category));

      if (p.color) {
        strict = strict.filter((it) => same(it.color, p.color));
      }

      if (productStyleTags.length) {
        strict = strict.filter((it) => {
          const itsTags = splitTags(it.styleTags);
          return itsTags.some((tag) => productStyleTags.includes(tag));
        });
      }

      if (productOccasionTags.length) {
        strict = strict.filter((it) => {
          const itsTags = splitTags(it.occasionTags);
          return itsTags.some((tag) => productOccasionTags.includes(tag));
        });
      }

      let finalList = strict;

      if (finalList.length < 4) {
        finalList = baseList.filter((it) => same(it.category, p.category));
      }

      if (finalList.length < 4) {
        finalList = baseList;
      }

      setSimilarProducts(finalList.slice(0, 12));
    } catch {
      if (mountedRef.current) setSimilarProducts([]);
    }
  }, []);

const loadProduct = useCallback(async () => {
  const seq = ++requestSeqRef.current;

  setLoading(true);
  setError(null);

  try {
    let productData;

    if (isOwner) {
      productData = await api(
        `/api/vendors/products/${encodeURIComponent(id)}`
      );
    } else {
      productData = await api(
        `/api/public/products/${encodeURIComponent(id)}`
      );
    }

    if (!mountedRef.current || requestSeqRef.current !== seq) return;

    setProduct(productData);
    setLoading(false);
  } catch (e) {
    if (!mountedRef.current || requestSeqRef.current !== seq) return;

    setError(e?.message || "Nu am putut încărca produsul.");
    setLoading(false);
  }
}, [id, isOwner]);

useEffect(() => {
  loadProduct();
}, [loadProduct]);

useEffect(() => {
  window.scrollTo({
    top: 0,
    left: 0,
    behavior: "instant",
  });
}, [id]);

useEffect(() => {
  let alive = true;

  const loadUserContext = async () => {
    const [meRes, favRes] = await Promise.allSettled([
      api("/api/auth/me"),
      api("/api/favorites/ids"),
    ]);

    if (!alive || !mountedRef.current) return;

   if (meRes.status === "fulfilled") {
  const currentUser =
    meRes.value?.user ||
    meRes.value ||
    null;

  setMe(currentUser);
}

    if (
      favRes.status === "fulfilled" &&
      Array.isArray(favRes.value?.items)
    ) {
      setFavorites(new Set(favRes.value.items));
    }
  };

  loadUserContext();

  return () => {
    alive = false;
  };
}, [id]);

  useEffect(() => {
    if (!product) return;

    const run = () => {
      if (!mountedRef.current) return;
      setDeferredSections(true);
    };

    if ("requestIdleCallback" in window) {
      const idleId = window.requestIdleCallback(run, { timeout: 700 });
      return () => {
        if ("cancelIdleCallback" in window) {
          window.cancelIdleCallback(idleId);
        }
      };
    }

    const t = setTimeout(run, 100);
    return () => clearTimeout(t);
  }, [product]);

  useEffect(() => {
    if (!product || !deferredSections) return;
    loadStoreProducts(product);
    loadSimilarProducts(product);
  }, [product, deferredSections, loadStoreProducts, loadSimilarProducts]);

  useEffect(() => {
    if (!product?.id || reviewsLoaded) return;

    if (isMobile) {
      if (activeMobileTab !== "recenzii") return;
    } else {
      if (!openAccordions.reviews) return;
    }

    setReviewsLoaded(true);
    loadReviewsForProduct(product.id);
  }, [
    product?.id,
    reviewsLoaded,
    isMobile,
    activeMobileTab,
    openAccordions.reviews,
    loadReviewsForProduct,
  ]);

  useEffect(() => {
    if (!product?.id || commentsLoaded) return;

    if (isMobile) {
      if (activeMobileTab !== "intrebari") return;
    } else {
      if (!openAccordions.comments) return;
    }

    setCommentsLoaded(true);
    loadCommentsForProduct(product.id);
  }, [
    product?.id,
    commentsLoaded,
    isMobile,
    activeMobileTab,
    openAccordions.comments,
    loadCommentsForProduct,
  ]);

  const submitReview = useCallback(
    async ({ rating, comment, images: reviewImages }) => {
      if (isOwner) return;

      if (!me) {
        return navigate(
          `/autentificare?redirect=${encodeURIComponent(
            window.location.pathname + window.location.search
          )}`
        );
      }

      if (rating < 1 || rating > 5) {
        alert("Alege un rating între 1 și 5.");
        return;
      }

      try {
        setSubmittingReview(true);

        const form = new FormData();
        form.append("productId", product.id);
        form.append("rating", String(rating));
        form.append("comment", comment || "");

        (reviewImages || []).forEach((file) => {
          form.append("images", file);
        });

        const res = await fetch("/api/reviews", {
          method: "POST",
          body: form,
        });

        if (!res.ok) {
          let msg = "Nu am putut trimite recenzia.";
          try {
            const err = await res.json();
            if (err?.error === "rate_limited") {
              msg =
                "Ai atins limita de recenzii. Poți trimite maximum 10 recenzii la 24 de ore.";
            } else if (err?.error === "cannot_review_own_product") {
              msg = "Nu poți lăsa recenzie pentru propriul produs.";
            }
          } catch {
            /* ignore */
          }
          alert(msg);
          return;
        }

        setRevRating(0);
        setRevText("");
        setReviewsLoaded(true);
        await loadReviewsForProduct(product.id);
      } catch (e2) {
        alert(e2?.message || "Nu am putut trimite recenzia.");
      } finally {
        setSubmittingReview(false);
      }
    },
    [isOwner, me, navigate, product?.id, loadReviewsForProduct]
  );

  const startEditComment = useCallback((comment) => {
    setEditingCommentId(comment.id);
    setCommentText(comment.text || "");

    const formTextarea = document.querySelector(
      "#tab-intrebari textarea, .commentsSection textarea"
    );

    if (formTextarea) {
      formTextarea.scrollIntoView({ behavior: "smooth", block: "start" });
      formTextarea.focus();
    }
  }, []);

  const cancelEditComment = useCallback(() => {
    setEditingCommentId(null);
    setCommentText("");
  }, []);

  const submitComment = useCallback(
    async (e) => {
      e?.preventDefault?.();

      if (isOwner && !editingCommentId) return;

      if (!me) {
        return navigate(
          `/autentificare?redirect=${encodeURIComponent(
            window.location.pathname + window.location.search
          )}`
        );
      }

      const text = commentText.trim();
      if (!text) return;

      try {
        setSubmittingComment(true);

        if (editingCommentId) {
          await api(`/api/comments/${encodeURIComponent(editingCommentId)}`, {
            method: "PATCH",
            body: { text },
          });
          setEditingCommentId(null);
          setCommentText("");
        } else {
          await api("/api/comments", {
            method: "POST",
            body: { productId: product.id, text },
          });
          setCommentText("");
        }

        setCommentsLoaded(true);
        await loadCommentsForProduct(product.id);
      } catch (e2) {
        alert(e2?.message || "Nu am putut trimite comentariul.");
      } finally {
        setSubmittingComment(false);
      }
    },
    [
      isOwner,
      editingCommentId,
      me,
      navigate,
      commentText,
      product?.id,
      loadCommentsForProduct,
    ]
  );

  const hasDescription =
    typeof product?.description === "string" &&
    product.description.trim().length > 0;

  const imagesForLd = useMemo(
    () => images.map((u) => resolveFileUrl(u)),
    [images]
  );

  const schemaAvailability = useMemo(() => {
    switch (product?.availability) {
      case "READY":
        return "https://schema.org/InStock";
      case "MADE_TO_ORDER":
        return "https://schema.org/PreOrder";
      case "PREORDER":
        return "https://schema.org/PreOrder";
      case "SOLD_OUT":
        return "https://schema.org/OutOfStock";
      default:
        return "https://schema.org/InStock";
    }
  }, [product?.availability]);

  const displayPriceForLd = displayPrice ?? undefined;

  const storeName =
  product?.service?.profile?.displayName ||
  product?.vendor?.displayName ||
  "Artfest";

const productUrl = product?.id
  ? `https://artfest.ro/produs/${product.id}`
  : "https://artfest.ro/produse";

const seoTitle = useMemo(() => {
  if (!product?.title) {
    return "Produs handmade";
  }

  return `${product.title} | ${storeName}`;
}, [
  product?.title,
  storeName,
]);

const seoDescription = useMemo(() => {
  const rawDescription =
    typeof product?.description === "string"
      ? product.description
      : "";
  const cleanDescription = rawDescription
    .replace(/\s+/g, " ")
    .trim();

  if (cleanDescription) {
    return cleanDescription.length > 155
      ? `${cleanDescription.slice(0, 152).trim()}...`
      : cleanDescription;
  }

  return `Descoperă ${
    product?.title || "acest produs handmade"
  } realizat de ${storeName}. Vezi detalii, preț și opțiuni de personalizare pe Artfest.`;
}, [
  product?.title,
  product?.description,
  storeName,
]);


const seoImage =
  imagesForLd?.[0] || undefined;

  const jsonLd = useMemo(() => {
  const data = {
    "@context": "https://schema.org",
    "@type": "Product",
    "@id": productUrl,

    name: product?.title || "",
    description: product?.description || "",
    image: imagesForLd,

    sku: product?.id,

    brand: {
      "@type": "Brand",
      name: storeName,
    },

    seller: {
      "@type": "Organization",
      name: storeName,
    },

  offers: {
  "@type": "Offer",
  url: productUrl,
  priceCurrency: product?.currency || "RON",

  price:
    displayPriceForLd !== undefined
      ? String(displayPriceForLd)
      : undefined,

  availability: schemaAvailability,
  itemCondition: "https://schema.org/NewCondition",

  ...(hasHomepageDiscount &&
  product?.discount?.endsAt
    ? {
        priceValidUntil: String(
          product.discount.endsAt
        ).slice(0, 10),
      }
    : {}),
},
  };

  if (avg?.count > 0) {
    data.aggregateRating = {
      "@type": "AggregateRating",
      ratingValue: Number(avg.average).toFixed(1),
      reviewCount: avg.count,
    };
  }

  return data;
}, [
  product,
  productUrl,
  imagesForLd,
  displayPriceForLd,
  schemaAvailability,
  storeName,
  avg,
  hasHomepageDiscount
]);

  const onTouchStart = useCallback((e) => {
    if (!e.touches || e.touches.length === 0) return;
    touchStartX.current = e.touches[0].clientX;
    touchEndX.current = null;
  }, []);

  const onTouchMove = useCallback((e) => {
    if (!e.touches || e.touches.length === 0) return;
    touchEndX.current = e.touches[0].clientX;
  }, []);

  const onTouchEnd = useCallback(() => {
    if (
      touchStartX.current == null ||
      touchEndX.current == null ||
      images.length <= 1
    ) {
      touchStartX.current = null;
      touchEndX.current = null;
      return;
    }

    const diff = touchStartX.current - touchEndX.current;
    const threshold = 40;

    if (Math.abs(diff) > threshold) {
      if (diff > 0) {
        setActiveIdx((i) => (i + 1) % images.length);
      } else {
        setActiveIdx((i) => (i - 1 + images.length) % images.length);
      }
    }

    touchStartX.current = null;
    touchEndX.current = null;
  }, [images.length]);

  const toggleAccordion = useCallback((key) => {
    setOpenAccordions((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  }, []);

  const ensureCategories = useCallback(async () => {
    if (categories.length) return;

    try {
      const c = await api("/api/public/categories/detailed").catch(() => []);
      if (!mountedRef.current) return;
      setCategories(Array.isArray(c) ? c : []);
    } catch {
      if (mountedRef.current) setCategories([]);
    }
  }, [categories.length]);

const uploadFile = useCallback(async (f) => {
  const fd = new FormData();
  fd.append("file", f);

  const res = await fetch("/api/upload/products", {
    method: "POST",
    body: fd,
  });

  if (!res.ok) {
    let message = "Upload eșuat";

    try {
      const err = await res.json();
      message = err?.message || message;
    } catch {
      // ignore
    }

    throw new Error(message);
  }

  const data = await res.json();
  return data.url;
}, []);

const uploadCustomizationFile = useCallback(
  async (file, uploadKey) => {
    if (!file) {
      return null;
    }

    setUploadingCustomization(
      (current) => ({
        ...current,
        [uploadKey]: true,
      })
    );

    try {
      const fd = new FormData();

      fd.append("file", file);

      const res = await fetch(
        "/api/upload/customization",
        {
          method: "POST",
          body: fd,
          credentials: "include",
        }
      );

      if (!res.ok) {
        let message =
          "Nu am putut încărca poza.";

        try {
          const error =
            await res.json();

          message =
            error?.message ||
            message;
        } catch {
          // ignore
        }

        throw new Error(message);
      }

      const data =
        await res.json();

      if (!data?.url) {
        throw new Error(
          "Upload-ul nu a returnat imaginea."
        );
      }

      return data.url;
    } finally {
      setUploadingCustomization(
        (current) => ({
          ...current,
          [uploadKey]: false,
        })
      );
    }
  },
  []
);

 const openEditModal = useCallback(async () => {
  if (!product?.id) {
    return;
  }

  try {
    await ensureCategories();

    const full = await api(
      `/api/vendors/products/${encodeURIComponent(
        product.id
      )}`
    );

    if (!mountedRef.current) {
      return;
    }

    setEditingProduct(full);

    const price =
      typeof full?.price === "number"
        ? full.price
        : Number.isFinite(
              Number(full?.priceCents)
            )
          ? Number(
              full.priceCents
            ) / 100
          : 0;

    setProdForm({
      id:
        full.id ||
        full._id ||
        "",

      title:
        full.title || "",

      description:
        full.description || "",

      price,

      images:
        Array.isArray(
          full.images
        )
          ? full.images
          : [],

      category:
        full.category || "",

      currency:
        full.currency || "RON",

      isActive:
        full.isActive !== false,

      availability:
        (
          full.availability ||
          "READY"
        ).toUpperCase(),

      leadTimeDays:
        Number.isFinite(
          Number(
            full.leadTimeDays
          )
        )
          ? String(
              Number(
                full.leadTimeDays
              )
            )
          : "",

      readyQty:
        full.readyQty === null ||
        full.readyQty ===
          undefined
          ? ""
          : Number.isFinite(
                Number(
                  full.readyQty
                )
              )
            ? String(
                Number(
                  full.readyQty
                )
              )
            : "",

      nextShipDate:
        full.nextShipDate
          ? String(
              full.nextShipDate
            ).slice(0, 10)
          : "",

      acceptsCustom:
        !!full.acceptsCustom,

      isHidden:
        !!full.isHidden,

      color:
        full.color || "",

      materialMain:
        full.materialMain || "",

      technique:
        full.technique || "",

      styleTags:
        Array.isArray(
          full.styleTags
        )
          ? full.styleTags.join(
              ", "
            )
          : full.styleTags ||
            "",

      occasionTags:
        Array.isArray(
          full.occasionTags
        )
          ? full.occasionTags.join(
              ", "
            )
          : full.occasionTags ||
            "",

      dimensions:
        full.dimensions || "",

      careInstructions:
        full.careInstructions ||
        "",

      specialNotes:
        full.specialNotes || "",

      orderMode:
        full.orderMode ===
        "DIRECT"
          ? "READY_TO_BUY"
          : full.orderMode ===
              "CUSTOMIZABLE"
            ? "OPTIONS"
            : full.orderMode ||
              "READY_TO_BUY",

      optionsSchema:
        Array.isArray(
          full.optionsSchema
        )
          ? full.optionsSchema
          : Array.isArray(
                full.optionsSchema
                  ?.fields
              )
            ? full.optionsSchema
                .fields
            : [],

      customSchema:
        Array.isArray(
          full.customSchema
        )
          ? full.customSchema
          : Array.isArray(
                full.customSchema
                  ?.fields
              )
            ? full.customSchema
                .fields
            : [],

      repeatedGroups:
        Array.isArray(
          full.repeatedGroups
        )
          ? full.repeatedGroups
          : [],

      quoteSchema:
        Array.isArray(
          full.quoteSchema
        )
          ? full.quoteSchema
          : Array.isArray(
                full.quoteSchema
                  ?.fields
              )
            ? full.quoteSchema
                .fields
            : [],
    });

    setEditOpen(true);
  } catch (error) {
    alert(
      error?.message ||
        "Nu am putut încărca produsul pentru editare."
    );
  }
}, [
  product?.id,
  ensureCategories,
]);

 const handleSaveProduct =
  useCallback(
    async (e) => {
      e?.preventDefault?.();

      if (
        !editingProduct ||
        !prodForm.id
      ) {
        alert(
          "Nu am găsit produsul pentru salvare."
        );

        return;
      }

      try {
        setSavingProd(true);

        const title = String(
          prodForm.title || ""
        ).trim();

        const description =
          prodForm.description || "";

        const price = Number(
          prodForm.price
        );

        const imagesArr =
          Array.isArray(
            prodForm.images
          )
            ? prodForm.images
            : [];

        const category = String(
          prodForm.category || ""
        ).trim();

        const color =
          String(
            prodForm.color || ""
          ).trim() || null;

        const materialMain =
          String(
            prodForm.materialMain ||
              ""
          ).trim() || null;

        const technique =
          String(
            prodForm.technique ||
              ""
          ).trim() || null;

        const styleTags = String(
          prodForm.styleTags || ""
        ).trim();

        const occasionTags = String(
          prodForm.occasionTags ||
            ""
        ).trim();

        const dimensions =
          String(
            prodForm.dimensions ||
              ""
          ).trim() || null;

        const careInstructions =
          String(
            prodForm.careInstructions ||
              ""
          ).trim() || null;

        const specialNotes =
          String(
            prodForm.specialNotes ||
              ""
          ).trim() || null;

        if (!title) {
          alert(
            "Te rog adaugă un titlu."
          );

          return;
        }

        if (
          !Number.isFinite(price) ||
          price < 0
        ) {
          alert("Preț invalid.");

          return;
        }

        if (!category) {
          alert(
            "Selectează categoria produsului."
          );

          return;
        }

        const normalizedOrderMode =
          prodForm.orderMode ===
          "DIRECT"
            ? "READY_TO_BUY"
            : prodForm.orderMode ===
                "CUSTOMIZABLE"
              ? "OPTIONS"
              : prodForm.orderMode ||
                "READY_TO_BUY";

        const optionsSchema =
          Array.isArray(
            prodForm.optionsSchema
          )
            ? prodForm.optionsSchema
            : [];

        const customSchema =
          Array.isArray(
            prodForm.customSchema
          )
            ? prodForm.customSchema
            : [];

        const repeatedGroups =
          Array.isArray(
            prodForm.repeatedGroups
          )
            ? prodForm.repeatedGroups
            : [];

        const quoteSchema =
          Array.isArray(
            prodForm.quoteSchema
          )
            ? prodForm.quoteSchema
            : [];

        const basePayload = {
          title,
          description,
          price,
          images: imagesArr,
          category,

          currency:
            prodForm.currency ||
            "RON",

          isActive:
            prodForm.isActive !==
            false,

          isHidden:
            !!prodForm.isHidden,

          orderMode:
            normalizedOrderMode,

          acceptsCustom:
            normalizedOrderMode ===
              "OPTIONS" ||
            normalizedOrderMode ===
              "QUOTE_ONLY" ||
            prodForm.acceptsCustom ===
              true,

          optionsSchema:
            normalizedOrderMode ===
            "OPTIONS"
              ? optionsSchema
              : [],

          customSchema:
            normalizedOrderMode ===
            "OPTIONS"
              ? customSchema
              : [],

          repeatedGroups:
            normalizedOrderMode ===
            "OPTIONS"
              ? repeatedGroups
              : [],

          quoteSchema:
            normalizedOrderMode ===
            "QUOTE_ONLY"
              ? quoteSchema
              : [],

          color,
          materialMain,
          technique,
          styleTags,
          occasionTags,
          dimensions,
          careInstructions,
          specialNotes,
        };

        const av = String(
          prodForm.availability ||
            "READY"
        ).toUpperCase();

        const payload = {
          ...basePayload,

          availability: av,
          leadTimeDays: null,
          readyQty: null,
          nextShipDate: null,
        };

        if (
          av ===
          "MADE_TO_ORDER"
        ) {
          const leadTime =
            Number(
              prodForm.leadTimeDays ||
                0
            );

          payload.leadTimeDays =
            Number.isFinite(
              leadTime
            ) &&
            leadTime > 0
              ? leadTime
              : 1;
        }

        if (av === "READY") {
          if (
            prodForm.readyQty !==
              "" &&
            prodForm.readyQty != null
          ) {
            const readyQty =
              Number(
                prodForm.readyQty
              );

            payload.readyQty =
              Number.isFinite(
                readyQty
              ) &&
              readyQty >= 0
                ? readyQty
                : 0;
          } else {
            payload.readyQty =
              null;
          }
        }

        if (av === "PREORDER") {
          payload.nextShipDate =
            prodForm.nextShipDate
              ? dateOnlyToISO(
                  prodForm.nextShipDate
                )
              : null;
        }

        if (
          av === "SOLD_OUT"
        ) {
          payload.readyQty = 0;
        }

        const pid =
          editingProduct.id ||
          editingProduct._id;

        const saved = await api(
          `/api/vendors/products/${encodeURIComponent(
            pid
          )}`,
          {
            method: "PUT",
            body: payload,
          }
        );

        try {
          window.dispatchEvent(
            new CustomEvent(
              "vendor:productUpdated",
              {
                detail: {
                  product: saved,
                },
              }
            )
          );
        } catch {
          // ignore
        }

        setProduct((prev) => ({
          ...(prev || {}),
          ...(saved || {}),
        }));

        setEditOpen(false);
        setEditingProduct(null);
      } catch (error) {
        alert(
          error?.message ||
            "Nu am putut salva produsul."
        );
      } finally {
        setSavingProd(false);
      }
    },
    [
      editingProduct,
      prodForm,
    ]
  );

  const hasStructuredDetails = getHasStructuredDetails(
    product,
    availabilityText
  );

  if (loading) {
    return <ProductDetailsSkeleton />;
  }

  if (error || !product) {
    return (
      <div className={styles.pageWrap}>
        <p>{error || "Produsul nu a fost găsit."}</p>
        <button
          className={styles.linkBtn}
          onClick={() => navigate(-1)}
          type="button"
        >
          <FaChevronLeft /> Înapoi
        </button>
      </div>
    );
  }

 return (
  <div className={styles.pageWrap}>
   <SEO
  title={seoTitle}
  description={seoDescription}
  canonical={productUrl}
  url={productUrl}
  image={seoImage}
/>

    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(jsonLd),
      }}
    />
      <div className={styles.breadcrumbs}>
        <button
          className={styles.linkBtn}
          onClick={() => navigate(-1)}
          type="button"
        >
          <FaChevronLeft /> Înapoi
        </button>
        <span className={styles.sep}>/</span>

        {product?.service?.profile?.slug ? (
          <Link
            className={styles.link}
            to={`/magazin/${product.service.profile.slug}`}
          >
            <FaStore style={{ marginRight: 6 }} />{" "}
            {product.service?.profile?.displayName ||
              product.vendor?.displayName ||
              "Magazin"}
          </Link>
        ) : product?.vendor?.displayName ? (
          <span className={styles.muted}>
            <FaStore style={{ marginRight: 6 }} /> {product.vendor?.displayName}
          </span>
        ) : null}
      </div>

      <div className={styles.grid}>
        <ProductGallery
          productTitle={product.title}
          images={images}
          activeIdx={activeIdx}
          setActiveIdx={setActiveIdx}
          activeSrc={activeSrc}
          cacheT={cacheT}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          setZoomOpen={setZoomOpen}
        />

        <div className={styles.infoCard}>
          <div className={styles.titleRow}>
            <h1 className={styles.title}>{product.title}</h1>
          </div>

          {(product.vendor?.displayName ||
            product?.service?.profile?.displayName) && (
            <div className={styles.vendorRow}>
              {product?.service?.profile?.slug ? (
                <Link
                  to={`/magazin/${product.service.profile.slug}`}
                  className={styles.vendorLink}
                >
                  {product.service.profile.displayName ||
                    product.vendor?.displayName}
                </Link>
              ) : (
                <span className={styles.vendorName}>
                  {product.vendor?.displayName}
                </span>
              )}
              {product?.service?.vendor?.city && (
                <span className={styles.vendorCity}>
                  · {product.service.vendor.city}
                </span>
              )}
            </div>
          )}

          {displayPrice != null && !isQuoteOnly && (
  <>
    {hasHomepageDiscount ? (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          flexWrap: "wrap",
          marginBottom: 4,
        }}
      >
        <span
          style={{
            textDecoration: "line-through",
            color: "#6b7280",
            fontSize: 17,
          }}
        >
          {originalDisplayPrice != null
            ? fmt.format(originalDisplayPrice)
            : null}
        </span>

        <div className={styles.price}>
          {fmt.format(displayPrice)}
        </div>

        <span
          style={{
            padding: "5px 9px",
            borderRadius: 999,
            background: "#dc2626",
            color: "#ffffff",
            fontSize: 13,
            fontWeight: 800,
          }}
        >
          -{homepageDiscountPercent}%
        </span>
      </div>
    ) : (
      <div className={styles.price}>
        {fmt.format(displayPrice)}
      </div>
    )}

    {priceInfo && (
      <div className={styles.priceInfo}>
        {priceInfo}
      </div>
    )}
  </>
)}
          {isOwner && (
            <p className={styles.ownerNote}>
              Ești proprietarul acestui produs.
            </p>
          )}

          {product.availability && (
            <div className={styles.availabilityRow}>
              {product.availability === "READY" && (
                <span className={styles.badgeReady}>
                  {typeof product.readyQty === "number" && product.readyQty > 0
                    ? `În stoc (${product.readyQty} buc.)`
                    : "În stoc"}
                </span>
              )}

              {product.availability === "MADE_TO_ORDER" && (
                <span className={styles.badgeMto}>
                  Realizat la comandă
                  {product.leadTimeDays ? ` · ${product.leadTimeDays} zile` : ""}
                </span>
              )}

              {product.availability === "PREORDER" && (
                <span className={styles.badgePreorder}>
                  Precomandă
                  {product.nextShipDate
                    ? ` · livrare din ${new Date(
                        product.nextShipDate
                      ).toLocaleDateString("ro-RO")}`
                    : ""}
                </span>
              )}

              {product.availability === "SOLD_OUT" && (
                <span className={styles.badgeSoldOut}>Stoc epuizat</span>
              )}

              {product.acceptsCustom && (
                <span className={styles.badgeCustom}>
                  Acceptă comenzi personalizate
                </span>
              )}
            </div>
          )}

          {product.color && (
            <div className={styles.colorRow}>
              Culoare principală:{" "}
              <span className={styles.colorValue}>{product.color}</span>
            </div>
          )}

          {hasDescription && (
            <div className={styles.inlineDetailsBox}>
              <h2 className={styles.inlineBoxTitle}>Descriere produs</h2>
              <p className={styles.inlineDescription}>{product.description}</p>
            </div>
          )}
{hasOrderOptions && !isQuoteOnly && (
  <div className={styles.productConfigurator}>
    <div className={styles.configuratorHeader}>
      <div>
        <h3 className={styles.configuratorTitle}>
          Configurează produsul
        </h3>

        <p className={styles.configuratorSubtitle}>
          Alege variantele disponibile și, dacă dorești, adaugă detalii de personalizare.
        </p>
      </div>
    </div>

    {topLevelOptionsSchema.length > 0 && (
      <div className={styles.configuratorOptions}>
        {topLevelOptionsSchema.map((field) => {
          const rawValues = Array.isArray(field?.options)
            ? field.options
            : Array.isArray(field?.values)
              ? field.values
              : [];

          const selectedValue = selectedOptions[field.key] || "";

          return (
            <div
              key={field.key}
              data-validation-error={
                validationErrors[`option:${field.key}`] ? "true" : undefined
              }
              className={[
                styles.configuratorGroup,
                validationErrors[`option:${field.key}`]
                  ? styles.configuratorGroupError
                  : "",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              <div className={styles.configuratorLabelRow}>
                <label className={styles.configuratorLabel}>
                  {field.label || "Alege o variantă"}

                  {field.required !== false && (
                    <span className={styles.requiredMark}>*</span>
                  )}
                </label>

                {selectedValue && (
                  <span className={styles.configuratorSelected}>
                    {selectedValue}
                  </span>
                )}
              </div>

              <div
                className={styles.configuratorChoices}
                role="group"
                aria-label={field.label || "Opțiune produs"}
              >
                {rawValues.map((rawOption, index) => {
                  const option =
                    typeof rawOption === "string"
                      ? {
                          value: rawOption,
                          label: rawOption,
                          colorHex: null,
                          imageUrl: null,
                          imageIndex: null,
                          disabled: false,
                        }
                      : {
                          value: String(
                            rawOption?.value ||
                              rawOption?.key ||
                              rawOption?.label ||
                              ""
                          ),
                          label: String(
                            rawOption?.label ||
                              rawOption?.value ||
                              rawOption?.key ||
                              ""
                          ),
                          colorHex:
                            rawOption?.colorHex ||
                            rawOption?.color ||
                            null,
                          imageUrl:
                            rawOption?.imageUrl ||
                            rawOption?.image ||
                            null,
                          imageIndex: Number.isInteger(rawOption?.imageIndex)
                            ? rawOption.imageIndex
                            : null,
                          disabled: !!rawOption?.disabled,
                        };

                  if (!option.value) return null;

                  const isSelected =
                    String(selectedValue) === String(option.value);

                  return (
                    <button
                      key={`${field.key}-${option.value}-${index}`}
                      type="button"
                      disabled={option.disabled}
                      aria-pressed={isSelected}
                      className={[
                        styles.configuratorChoice,
                        isSelected
                          ? styles.configuratorChoiceSelected
                          : "",
                        option.disabled
                          ? styles.configuratorChoiceDisabled
                          : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      onClick={() => {
                        if (option.disabled) return;

                        setSelectedOptions((current) => ({
                          ...current,
                          [field.key]: option.value,
                        }));

                        setValidationErrors((current) => {
                          const next = { ...current };
                          delete next[`option:${field.key}`];
                          return next;
                        });

                        if (
                          Number.isInteger(option.imageIndex) &&
                          images[option.imageIndex]
                        ) {
                          setActiveIdx(option.imageIndex);
                        } else if (option.imageUrl) {
                          const foundIndex = images.findIndex(
                            (image) => image === option.imageUrl
                          );

                          if (foundIndex >= 0) {
                            setActiveIdx(foundIndex);
                          }
                        }
                      }}
                    >
                      {option.colorHex && (
                        <span
                          className={styles.choiceColor}
                          style={{
                            backgroundColor: option.colorHex,
                          }}
                          aria-hidden="true"
                        />
                      )}

                      {option.imageUrl && (
                        <img
                          src={resolveFileUrl(option.imageUrl)}
                          alt=""
                          className={styles.choiceImage}
                          loading="lazy"
                        />
                      )}

                      <span>{option.label}</span>

                      {isSelected && (
                        <span
                          className={styles.choiceCheck}
                          aria-hidden="true"
                        >
                          ✓
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              {validationErrors[`option:${field.key}`] && (
                <p className={styles.fieldErrorMessage}>
                  {validationErrors[`option:${field.key}`]}
                </p>
              )}
            </div>
          );
        })}
      </div>
    )}

   {hasOrderOptions && (
  <div className={styles.customizationCard}>

    <div
      style={{
        padding: "16px 16px 4px",
      }}
    >
      <div
        style={{
          display: "flex",
          gap: 10,
          alignItems: "flex-start",
          marginBottom: 12,
        }}
      >
        <span
          className={
            styles.customizationIcon
          }
        >
          <MagicIcon />
        </span>

        <div>
          <strong
            style={{
              display: "block",
              marginBottom: 4,
            }}
          >
            Acest produs este personalizabil
          </strong>

          <span
            style={{
              fontSize: 13,
              opacity: 0.75,
              lineHeight: 1.45,
            }}
          >
            Te putem ajuta să alegi și să
            completezi toate detaliile
            necesare pentru comandă.
          </span>
        </div>
      </div>

      <button
        type="button"
        className={styles.primaryBtn}
        onClick={
          onStartPersonalizationAssistant
        }
        style={{
          width: "100%",
          marginBottom: 10,
        }}
      >
        <MagicIcon />
        Ajută-mă să personalizez
      </button>

      <div
        style={{
          textAlign: "center",
          fontSize: 12,
          opacity: 0.65,
          marginBottom: 4,
        }}
      >
        sau completează manual
      </div>
    </div>
        <button
          type="button"
          className={styles.customizationToggle}
          onClick={() =>
            setCustomizationOpen((current) => !current)
          }
          aria-expanded={customizationOpen}
        >
          <span className={styles.customizationToggleLeft}>
            <span className={styles.customizationIcon}>
              <MagicIcon />
            </span>

            <span className={styles.customizationToggleText}>
             <strong>
  Completează manual
</strong>

<small>
  Vezi toate opțiunile de personalizare
</small>
            </span>
          </span>

          <FaChevronDown
            className={[
              styles.customizationChevron,
              customizationOpen
                ? styles.customizationChevronOpen
                : "",
            ]
              .filter(Boolean)
              .join(" ")}
          />
        </button>

        {customizationOpen && (
          <div className={styles.customizationFields}>
            {topLevelCustomSchema.map((field) => {
              const value = customAnswers[field.key] || "";
              const fieldType = field.type || "text";
const isImageField =
  ["image", "photo", "file"].includes(
    String(fieldType)
      .toLowerCase()
  );

const uploadKey =
  `custom:${field.key}`;

const isUploading =
  !!uploadingCustomization[
    uploadKey
  ];
              return (
                <div
                  key={field.key}
                  data-validation-error={
                    validationErrors[`custom:${field.key}`] ? "true" : undefined
                  }
                  className={[
                    styles.customizationField,
                    validationErrors[`custom:${field.key}`]
                      ? styles.customizationFieldError
                      : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  <label className={styles.customizationLabel}>
                    {field.label || "Detalii personalizare"}

                    {field.required && (
                      <span className={styles.requiredMark}>
                        *
                      </span>
                    )}
                  </label>

                  {field.description && (
                    <p className={styles.customizationHint}>
                      {field.description}
                    </p>
                  )}

                 {isImageField ? (
  <div>
    <input
      type="file"
      accept="image/*"
      className={
        styles.customizationInput
      }
      disabled={isUploading}
      onChange={async (event) => {
        const file =
          event.target.files?.[0];

        if (!file) {
          return;
        }

        try {
          const url =
            await uploadCustomizationFile(
              file,
              uploadKey
            );

          if (!url) {
            return;
          }

          setCustomAnswers(
            (current) => ({
              ...current,
              [field.key]: url,
            })
          );

          setValidationErrors(
            (current) => {
              const next = {
                ...current,
              };

              delete next[
                `custom:${field.key}`
              ];

              return next;
            }
          );
        } catch (error) {
          alert(
            error?.message ||
              "Nu am putut încărca poza."
          );
        }
      }}
    />

    {isUploading && (
      <p
        className={
          styles.customizationHint
        }
      >
        Se încarcă poza...
      </p>
    )}

    {!isUploading &&
      value && (
        <div
          style={{
            marginTop: 10,
          }}
        >
          <img
            src={value}
            alt="Poză pentru personalizare"
            style={{
              width: 100,
              height: 100,
              objectFit:
                "cover",
              borderRadius: 10,
            }}
          />

          <p
            className={
              styles.customizationHint
            }
          >
            ✓ Poza a fost
            încărcată
          </p>

          <button
            type="button"
            className={
              styles.linkBtn
            }
            onClick={() => {
              setCustomAnswers(
                (current) => {
                  const next = {
                    ...current,
                  };

                  delete next[
                    field.key
                  ];

                  return next;
                }
              );
            }}
          >
            Schimbă poza
          </button>
        </div>
      )}
  </div>
) : fieldType === "textarea" ? (
  <textarea
    value={value}
    maxLength={
      field.maxLength ||
      undefined
    }
    placeholder={
      field.placeholder ||
      "Scrie aici detaliile..."
    }
    className={
      styles.customizationTextarea
    }
    onChange={(event) => {
      const nextValue =
        event.target.value;

      setCustomAnswers(
        (current) => ({
          ...current,
          [field.key]:
            nextValue,
        })
      );

      if (
        String(
          nextValue
        ).trim()
      ) {
        setValidationErrors(
          (current) => {
            const next = {
              ...current,
            };

            delete next[
              `custom:${field.key}`
            ];

            return next;
          }
        );
      }
    }}
  />
) : (
  <input
    type={
      fieldType === "date"
        ? "date"
        : "text"
    }
    value={value}
    maxLength={
      field.maxLength ||
      undefined
    }
    placeholder={
      field.placeholder ||
      "Completează aici..."
    }
    className={
      styles.customizationInput
    }
    onChange={(event) => {
      const nextValue =
        event.target.value;

      setCustomAnswers(
        (current) => ({
          ...current,
          [field.key]:
            nextValue,
        })
      );

      if (
        String(
          nextValue
        ).trim()
      ) {
        setValidationErrors(
          (current) => {
            const next = {
              ...current,
            };

            delete next[
              `custom:${field.key}`
            ];

            return next;
          }
        );
      }
    }}
  />
)}
                  {validationErrors[`custom:${field.key}`] && (
                    <p className={styles.fieldErrorMessage}>
                      {validationErrors[`custom:${field.key}`]}
                    </p>
                  )}

                  {field.maxLength && fieldType !== "date" && (
                    <span className={styles.characterCounter}>
                      {String(value).length}/{field.maxLength}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    )}
{repeatedGroups.map((group) => {
  const groupKey =
    group?.key || group?.id;

  if (!groupKey) {
    return null;
  }

  const fields =
    Array.isArray(group?.fields)
      ? group.fields
      : [];

  if (!fields.length) {
    return null;
  }

  const items =
    Array.isArray(
      repeatedGroupAnswers[
        groupKey
      ]
    )
      ? repeatedGroupAnswers[
          groupKey
        ]
      : [];

  return (
    <div
      key={groupKey}
      className={
        styles.customizationCard
      }
      style={{
        marginTop: 16,
      }}
    >
      <div
        style={{
          padding: 16,
        }}
      >
        <strong>
          Completează pentru fiecare
          membru
        </strong>

        <p
          className={
            styles.customizationHint
          }
        >
          Pentru fiecare persoană din
          set, completează informațiile
          de mai jos.
        </p>

        {items.map(
          (item, itemIndex) => (
            <div
              key={`${groupKey}-${itemIndex}`}
              style={{
                marginTop: 14,
                padding: 14,
                border:
                  "1px solid rgba(0,0,0,0.1)",
                borderRadius: 12,
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent:
                    "space-between",
                  alignItems: "center",
                  marginBottom: 12,
                }}
              >
                <strong>
                  Membru{" "}
                  {itemIndex + 1}
                </strong>

                {items.length > 1 && (
                  <button
                    type="button"
                    className={
                      styles.linkBtn
                    }
                    onClick={() =>
                      removeRepeatedItem(
                        group,
                        itemIndex
                      )
                    }
                  >
                    Șterge
                  </button>
                )}
              </div>

           {fields.map(
  (field, fieldIndex) => {
                  const value =
                    item?.[
                      field.key
                    ] ?? "";

                  const fieldType =
                    field?.type ||
                    "text";

                  const values =
                    Array.isArray(
                      field?.options
                    )
                      ? field.options
                      : Array.isArray(
                            field?.values
                          )
                        ? field.values
                        : [];

                  const errorKey =
                    `repeated:${groupKey}:${itemIndex}:${field.key}`;

                  return (
                  <div
  key={`${groupKey}-${field.key || field.label || "field"}-${fieldIndex}`}
                      data-validation-error={
                        validationErrors[
                          errorKey
                        ]
                          ? "true"
                          : undefined
                      }
                      className={
                        styles.customizationField
                      }
                    >
                      <label
                        className={
                          styles.customizationLabel
                        }
                      >
                        {field.label}

                        {field.required !==
                          false && (
                          <span
                            className={
                              styles.requiredMark
                            }
                          >
                            *
                          </span>
                        )}
                      </label>

                      {values.length >
                      0 ? (
                        <select
                          className={
                            styles.customizationInput
                          }
                          value={value}
                          onChange={(e) =>
                            updateRepeatedItemField(
                              group,
                              itemIndex,
                              field.key,
                              e.target.value
                            )
                          }
                        >
                          <option value="">
                            Alege...
                          </option>

                          {values.map(
                            (
                              option,
                              index
                            ) => {
                              const value =
                                typeof option ===
                                "string"
                                  ? option
                                  : option?.value ||
                                    option?.key ||
                                    option?.label ||
                                    "";

                              const label =
                                typeof option ===
                                "string"
                                  ? option
                                  : option?.label ||
                                    option?.value ||
                                    option?.key ||
                                    "";

                              return (
                                <option
                                  key={`${value}-${index}`}
                                  value={
                                    value
                                  }
                                >
                                  {label}
                                </option>
                              );
                            }
                          )}
                        </select>
                      ) : fieldType ===
                        "textarea" ? (
                        <textarea
                          className={
                            styles.customizationTextarea
                          }
                          value={value}
                          placeholder={
                            field.placeholder ||
                            "Completează aici..."
                          }
                          onChange={(e) =>
                            updateRepeatedItemField(
                              group,
                              itemIndex,
                              field.key,
                              e.target.value
                            )
                          }
                        />
                      ) : (
                        <input
                          className={
                            styles.customizationInput
                          }
                          type={
                            fieldType ===
                            "date"
                              ? "date"
                              : "text"
                          }
                          value={value}
                          placeholder={
                            field.placeholder ||
                            "Completează aici..."
                          }
                          onChange={(e) =>
                            updateRepeatedItemField(
                              group,
                              itemIndex,
                              field.key,
                              e.target.value
                            )
                          }
                        />
                      )}

                      {validationErrors[
                        errorKey
                      ] && (
                        <p
                          className={
                            styles.fieldErrorMessage
                          }
                        >
                          {
                            validationErrors[
                              errorKey
                            ]
                          }
                        </p>
                      )}
                    </div>
                  );
                }
              )}
            </div>
          )
        )}

        {items.length < 10 && (
          <button
            type="button"
            className={
              styles.linkBtn
            }
            style={{
              marginTop: 12,
            }}
            onClick={() =>
              addRepeatedItem(group)
            }
          >
            + Adaugă membru
          </button>
        )}
      </div>
    </div>
  );
})}
    {(Object.values(selectedOptions).some((value) =>
      String(value || "").trim()
    ) ||
      Object.values(customAnswers).some((value) =>
        String(value || "").trim()
      )) && (
      <div className={styles.selectionSummary}>
        <span className={styles.selectionSummaryLabel}>
          Selecția ta
        </span>

        <div className={styles.selectionSummaryValues}>
          {optionsSchema.map((field) => {
            const value = selectedOptions[field.key];

            if (!value) return null;

            return (
              <span
                key={field.key}
                className={styles.selectionPill}
              >
                {field.label && <span>{field.label}:</span>}
                <strong>{value}</strong>
              </span>
            );
          })}

          {Object.values(customAnswers).some((value) =>
            String(value || "").trim()
          ) && (
            <span className={styles.selectionPillCustom}>
              <MagicIcon />
              Personalizat
            </span>
          )}
        </div>
      </div>
    )}
  </div>
)}
          <div className={styles.ctaRow}>
  {viewMode !== "vendor" && (
    <>
      {!isQuoteOnly && (
        <button
          className={styles.primaryBtn}
          onClick={addToCartAny}
          disabled={
            adding ||
            isSoldOut
          }
          title={
            isSoldOut
              ? "Stoc epuizat"
              : adding
                ? "Se adaugă…"
                : hasOrderOptions &&
                    missingRequiredSelection
                  ? "Alege opțiunile"
                  : "Adaugă în coș"
          }
          type="button"
        >
          <FaShoppingCart />{" "}
          {isSoldOut
            ? "Stoc epuizat"
            : adding
              ? "Se adaugă…"
              : "Adaugă în coș"}
        </button>
      )}

      <button
        className={styles.primaryBtn}
        onClick={onRequestQuote}
        type="button"
      >
        <MagicIcon /> Cere ofertă
      </button>

      {!isQuoteOnly && (
        <p className={styles.quoteHint}>
          Ai nevoie de mai multe bucăți decât sunt disponibile,
          alte culori sau o variantă personalizată?{" "}
          <strong>
            Poți cere o ofertă direct de la vânzător.
          </strong>
        </p>
      )}
               {!isQuoteOnly && (
  <div className={styles.qtyRow}>
    <button
      type="button"
      className={styles.qtyBtn}
      onClick={() =>
        setQty((q) =>
          Math.max(
            1,
            Math.min(999, q - 1)
          )
        )
      }
      aria-label="Scade cantitatea"
    >
      −
    </button>

    <input
      type="number"
      min={1}
      value={qty}
      onChange={(e) =>
        setQty(
          Math.max(
            1,
            Math.min(
              999,
              parseInt(
                e.target.value || "1",
                10
              )
            )
          )
        )
      }
      aria-label="Cantitate"
      className={styles.qtyInput}
    />

    <button
      type="button"
      className={styles.qtyBtn}
      onClick={() =>
        setQty((q) =>
          Math.max(
            1,
            Math.min(999, q + 1)
          )
        )
      }
      aria-label="Crește cantitatea"
    >
      +
    </button>
  </div>
)}

                <button
                  className={`${styles.iconBtn} ${
                    isFav ? styles.heartFilled : ""
                  }`}
                  onClick={toggleFavoriteSafe}
                  aria-pressed={isFav}
                  aria-label={
                    isFav ? "Elimină din favorite" : "Adaugă la favorite"
                  }
                  title={isFav ? "Elimină din favorite" : "Adaugă la favorite"}
                  type="button"
                >
                  {isFav ? <FaHeart /> : <FaRegHeart />}
                </button>
              </>
            )}

            <div className={styles.ctaIconGroup}>
              <button
                className={styles.iconBtn}
                onClick={shareIt}
                aria-label="Distribuie"
                title="Distribuie"
                type="button"
              >
                <FaShareAlt />
              </button>

              {isOwner && (
                <button
                  type="button"
                  className={`${styles.iconBtn} ${styles.editIconBtn}`}
                  onClick={openEditModal}
                  disabled={savingProd}
                  aria-label="Editează produsul"
                  title="Editează produsul"
                >
                  <FaEdit />
                </button>
              )}
            </div>
          </div>

          <div className={styles.shopCard}>
            <div className={styles.shopAvatarWrap}>
              <img
                src={
                  product.service?.profile?.logoUrl
                    ? withCache(
                        resolveFileUrl(product.service.profile.logoUrl),
                        cacheT
                      )
                    : product.vendor?.logoUrl
                    ? withCache(resolveFileUrl(product.vendor.logoUrl), cacheT)
                    : avatarPlaceholder(64, "Magazin")
                }
                alt={
                  product.service?.profile?.displayName ||
                  product.vendor?.displayName ||
                  "Magazin"
                }
                className={styles.shopAvatar}
                onError={(e) => onImgError(e, 64, 64, "Magazin")}
                loading="lazy"
                decoding="async"
              />
            </div>

            <div className={styles.shopMeta}>
              <div className={styles.shopNameRow}>
                {product?.service?.profile?.slug ? (
                  <Link
                    to={`/magazin/${product.service.profile.slug}`}
                    className={styles.vendorLink}
                  >
                    {product.service.profile.displayName ||
                      product.vendor?.displayName}
                  </Link>
                ) : (
                  <span className={styles.vendorName}>
                    {product.service?.profile?.displayName ||
                      product.vendor?.displayName}
                  </span>
                )}
              </div>

              {product?.service?.vendor?.city && (
                <div className={styles.shopCity}>
                  {product.service.vendor.city}
                </div>
              )}
            </div>
          </div>

          {isMobile && (
            <>
              <div
                className={styles.mobileTabs}
                aria-label="Secțiuni produs"
                role="tablist"
              >
                <button
                  type="button"
                  className={`${styles.mobileTab} ${
                    activeMobileTab === "descriere"
                      ? styles.mobileTabActive
                      : ""
                  }`}
                  onClick={() => setActiveMobileTab("descriere")}
                  role="tab"
                  aria-selected={activeMobileTab === "descriere"}
                  aria-controls="tab-descriere"
                >
                  Descriere
                </button>

                {hasStructuredDetails && (
                  <button
                    type="button"
                    className={`${styles.mobileTab} ${
                      activeMobileTab === "detalii"
                        ? styles.mobileTabActive
                        : ""
                    }`}
                    onClick={() => setActiveMobileTab("detalii")}
                    role="tab"
                    aria-selected={activeMobileTab === "detalii"}
                    aria-controls="tab-detalii"
                  >
                    Detalii
                  </button>
                )}

                <button
                  type="button"
                  className={`${styles.mobileTab} ${
                    activeMobileTab === "recenzii"
                      ? styles.mobileTabActive
                      : ""
                  }`}
                  onClick={() => setActiveMobileTab("recenzii")}
                  role="tab"
                  aria-selected={activeMobileTab === "recenzii"}
                  aria-controls="tab-recenzii"
                >
                  Recenzii
                </button>

                <button
                  type="button"
                  className={`${styles.mobileTab} ${
                    activeMobileTab === "intrebari"
                      ? styles.mobileTabActive
                      : ""
                  }`}
                  onClick={() => setActiveMobileTab("intrebari")}
                  role="tab"
                  aria-selected={activeMobileTab === "intrebari"}
                  aria-controls="tab-intrebari"
                >
                  Întrebări
                </button>
              </div>

              <div className={styles.mobileTabPanels}>
                <div
                  id="tab-descriere"
                  role="tabpanel"
                  hidden={activeMobileTab !== "descriere"}
                >
                  {activeMobileTab === "descriere" && (
                    <div className={styles.mobileTabPanel}>
                      {hasDescription ? (
                        <p>{product.description}</p>
                      ) : (
                        <p>Nu există încă o descriere pentru acest produs.</p>
                      )}
                    </div>
                  )}
                </div>

                {hasStructuredDetails && (
                  <div
                    id="tab-detalii"
                    role="tabpanel"
                    hidden={activeMobileTab !== "detalii"}
                  >
                    {activeMobileTab === "detalii" && (
                      <div className={styles.mobileTabPanel}>
                        <DetailsContent
                          product={product}
                          availabilityText={availabilityText}
                        />
                      </div>
                    )}
                  </div>
                )}

                <div
                  id="tab-recenzii"
                  role="tabpanel"
                  hidden={activeMobileTab !== "recenzii"}
                >
                  {activeMobileTab === "recenzii" && (
                    <div className={styles.mobileTabPanel}>
                      <Suspense fallback={<div>Se încarcă recenziile…</div>}>
                        <ReviewsSection
                          avg={avg}
                          reviews={reviews}
                          isOwner={isOwner}
                          isLoggedIn={!!me}
                          currentUserId={myUserId}
                          onSubmit={submitReview}
                          submitting={submittingReview}
                          revRating={revRating}
                          setRevRating={setRevRating}
                          revText={revText}
                          setRevText={setRevText}
                        />
                      </Suspense>
                    </div>
                  )}
                </div>

                <div
                  id="tab-intrebari"
                  role="tabpanel"
                  hidden={activeMobileTab !== "intrebari"}
                >
                  {activeMobileTab === "intrebari" && (
                    <div className={styles.mobileTabPanel}>
                      <Suspense fallback={<div>Se încarcă comentariile…</div>}>
                        <CommentsSection
                          comments={comments}
                          isOwner={isOwner}
                          isLoggedIn={!!me}
                          onSubmit={submitComment}
                          submitting={submittingComment}
                          commentText={commentText}
                          setCommentText={setCommentText}
                          currentUserId={myUserId}
                          editingCommentId={editingCommentId}
                          onStartEditComment={startEditComment}
                          onCancelEditComment={cancelEditComment}
                          onAfterChange={() =>
                            loadCommentsForProduct(product.id)
                          }
                        />
                      </Suspense>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {!isMobile && hasStructuredDetails && (
        <section className={styles.descriptionSection}>
          <div className={styles.accordion}>
            <button
              type="button"
              className={styles.accordionHeader}
              onClick={() => toggleAccordion("details")}
              aria-expanded={openAccordions.details}
            >
              <div className={styles.accordionTitleWrap}>
                <span className={styles.accordionTitle}>Detalii produs</span>
                <span className={styles.accordionMeta}>
                  Informații despre disponibilitate, material, dimensiuni și
                  alte detalii
                </span>
              </div>
              <span className={styles.accordionIcon}>
                <FaChevronDown />
              </span>
            </button>

            {openAccordions.details && (
              <div className={styles.accordionBody}>
                <DetailsContent
                  product={product}
                  availabilityText={availabilityText}
                />
              </div>
            )}
          </div>
        </section>
      )}

      {!isMobile && (
        <section className={styles.reviewsSection}>
          <div className={styles.accordion}>
            <button
              type="button"
              className={styles.accordionHeader}
              onClick={() => toggleAccordion("reviews")}
              aria-expanded={openAccordions.reviews}
            >
              <div className={styles.accordionTitleWrap}>
                <span className={styles.accordionTitle}>Recenzii produs</span>
                <span className={styles.accordionMeta}>
                  {avg.count > 0
                    ? `${avg.average.toFixed(1)} ★ · ${avg.count} recenzii`
                    : "Nu există recenzii încă"}
                </span>
              </div>
              <span className={styles.accordionIcon}>
                <FaChevronDown />
              </span>
            </button>

            {openAccordions.reviews && (
              <div className={styles.accordionBody}>
                <Suspense fallback={<div>Se încarcă recenziile…</div>}>
                  <ReviewsSection
                    avg={avg}
                    reviews={reviews}
                    isOwner={isOwner}
                    isLoggedIn={!!me}
                    currentUserId={myUserId}
                    onSubmit={submitReview}
                    submitting={submittingReview}
                    revRating={revRating}
                    setRevRating={setRevRating}
                    revText={revText}
                    setRevText={setRevText}
                  />
                </Suspense>
              </div>
            )}
          </div>
        </section>
      )}

      {!isMobile && (
        <section className={styles.commentsSection}>
          <div className={styles.accordion}>
            <button
              type="button"
              className={styles.accordionHeader}
              onClick={() => toggleAccordion("comments")}
              aria-expanded={openAccordions.comments}
            >
              <div className={styles.accordionTitleWrap}>
                <span className={styles.accordionTitle}>
                  Întrebări & comentarii
                </span>
                <span className={styles.accordionMeta}>
                  Pune o întrebare sau lasă un mesaj pentru vânzător
                </span>
              </div>
              <span className={styles.accordionIcon}>
                <FaChevronDown />
              </span>
            </button>

            {openAccordions.comments && (
              <div className={styles.accordionBody}>
                <Suspense fallback={<div>Se încarcă comentariile…</div>}>
                  <CommentsSection
                    comments={comments}
                    isOwner={isOwner}
                    isLoggedIn={!!me}
                    onSubmit={submitComment}
                    submitting={submittingComment}
                    commentText={commentText}
                    setCommentText={setCommentText}
                    currentUserId={myUserId}
                    editingCommentId={editingCommentId}
                    onStartEditComment={startEditComment}
                    onCancelEditComment={cancelEditComment}
                    onAfterChange={() => loadCommentsForProduct(product.id)}
                  />
                </Suspense>
              </div>
            )}
          </div>
        </section>
      )}

      {deferredSections && (
        <Suspense fallback={null}>
          <>
            <section className={styles.relatedSec}>
              <h2 className={styles.sectionTitle}>Mai multe din acest magazin</h2>
              <StoreProductsSlider
                products={storeProducts}
                cacheT={cacheT}
                navigate={navigate}
              />
            </section>

            <SimilarProductsGrid
              products={similarProducts}
              cacheT={cacheT}
              navigate={navigate}
            />
          </>
        </Suspense>
      )}

      {zoomOpen && (
        <Suspense fallback={null}>
          <ImageZoom
            open={zoomOpen}
            images={images}
            activeIdx={activeIdx}
            setActiveIdx={setActiveIdx}
            activeSrc={activeSrc}
            onClose={() => setZoomOpen(false)}
          />
        </Suspense>
      )}

      {isOwner && editOpen && (
        <Suspense fallback={null}>
          <ProductModal
            open={editOpen}
            onClose={() => {
              setEditOpen(false);
              setEditingProduct(null);
            }}
            saving={savingProd}
            editingProduct={editingProduct}
            form={prodForm}
            setForm={setProdForm}
            categories={categories}
            onSave={handleSaveProduct}
            uploadFile={uploadFile}
          />
        </Suspense>
      )}
    </div>
  );
}