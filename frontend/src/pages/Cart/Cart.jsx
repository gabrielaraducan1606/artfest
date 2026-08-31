// ==============================
// File: src/pages/Cart/Cart.jsx
// ==============================
import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
} from "react";
import { Link, useNavigate } from "react-router-dom";
import { createPortal } from "react-dom";
import { api } from "../../lib/api";
import { humanizeOptionValue } from "../../utils/optionLabels";
import {
  productPlaceholder,
  onImgError,
} from "../../components/utils/imageFallback";
import {
  FaMinus,
  FaPlus,
  FaTrash,
  FaHeart,
  FaRegHeart,
} from "react-icons/fa";
import {
  getGuestCart,
  updateGuestCartItem,
  removeFromGuestCart,
  clearGuestCart,
} from "../../utils/guestCart";
import { getAttributionsForCheckout } from "../../utils/campaignAttribution.js";
import {
  trackAddToCart,
  trackBeginCheckout,
} from "../../../services/analytics.js";
import styles from "./Cart.module.css";

const BACKEND_BASE = (import.meta.env.VITE_API_URL || "").replace(/\/+$/, "");
const isHttp = (u = "") => /^https?:\/\//i.test(u);
const isDataOrBlob = (u = "") => /^(data|blob):/i.test(u);

const resolveFileUrl = (u) => {
  if (!u) return "";
  if (isHttp(u) || isDataOrBlob(u)) return u;
  const path = u.startsWith("/") ? u : `/${u}`;
  return BACKEND_BASE
    ? `${BACKEND_BASE}${path}`.replace(/([^:]\/)\/+/g, "$1")
    : path;
};

const nfCache = new Map();

const money = (v, currency = "RON", locale = "ro-RO") => {
  const key = `${locale}|${currency}`;
  if (!nfCache.has(key)) {
    nfCache.set(
      key,
      new Intl.NumberFormat(locale, { style: "currency", currency })
    );
  }
  return nfCache.get(key).format(v ?? 0);
};

const getReadableValue = (value) => {
  if (Array.isArray(value)) {
    return value.map((v) => humanizeOptionValue(String(v))).join(", ");
  }

  if (value && typeof value === "object") {
    return Object.values(value)
      .map((v) => humanizeOptionValue(String(v)))
      .join(", ");
  }

  if (value === true) return "Da";
  if (value === false) return "Nu";

  return humanizeOptionValue(String(value ?? ""));
};

const isImageUrl = (value) => {
  if (typeof value !== "string") {
    return false;
  }

  const url = value.trim();

  return (
    /^https?:\/\//i.test(url) &&
    (
      url.includes("/customizations/") ||
      /\.(jpg|jpeg|png|webp|gif|heic|heif|bmp|tiff|avif)(\?.*)?$/i.test(url)
    )
  );
};

const getConfigurationEntries = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [];
  }

  return Object.entries(value).filter(([, itemValue]) => {
    if (itemValue === null || itemValue === undefined) return false;
    if (typeof itemValue === "string" && !itemValue.trim()) return false;
    if (Array.isArray(itemValue) && !itemValue.length) return false;

    return true;
  });
};

const getRepeatedGroupEntries = (
  repeatedGroupAnswers
) => {
  if (
    !repeatedGroupAnswers ||
    typeof repeatedGroupAnswers !==
      "object" ||
    Array.isArray(
      repeatedGroupAnswers
    )
  ) {
    return [];
  }

  return Object.entries(
    repeatedGroupAnswers
  ).filter(
    ([, items]) =>
      Array.isArray(items) &&
      items.length > 0
  );
};

const DEFAULT_MAX_QTY = 9999;

const getMaxQty = (product = {}) => {
  if (Number.isFinite(product?.stockLimit) && product.stockLimit > 0) {
    return product.stockLimit;
  }

  if (Number.isFinite(product?.readyQty) && product.readyQty > 0) {
    return product.readyQty;
  }

  if (Number.isFinite(product?.maxOrderQty) && product.maxOrderQty > 0) {
    return product.maxOrderQty;
  }

  if (Number.isFinite(product?.stock) && product.stock > 0) {
    return product.stock;
  }

  return DEFAULT_MAX_QTY;
};

const clampQty = (q, max = DEFAULT_MAX_QTY) =>
  Math.max(1, Math.min(Number.isFinite(q) ? q : 1, max));

const getRowKey = (row) =>
  `${row.productId}:${row.configurationKey || "default"}`;

function getFriendlyCartError(e, fallbackMax) {
  if (e?.error === "insufficient_stock") {
    return `Avem doar ${e?.stock ?? fallbackMax} buc. disponibile momentan. Am ajustat cantitatea la maximul disponibil.`;
  }

  if (e?.error === "product_sold_out") {
    return "Produsul este momentan epuizat. Îl poți elimina din coș sau verifica mai târziu.";
  }

  if (e?.error === "product_unavailable") {
    return "Produsul nu mai este disponibil momentan.";
  }

  if (e?.error === "cannot_update_own_product") {
    return "Nu poți modifica în coș un produs care îți aparține.";
  }

  return e?.message || "Nu am putut actualiza cantitatea.";
}

export default function Cart() {
  const nav = useNavigate();

  const [loading, setLoading] =
  useState(true);

const [me, setMe] =
  useState(null);

const [rows, setRows] =
  useState([]);

  const didMergeRef = useRef(false);
  const announceRef = useRef(null);

  const [pending, setPending] = useState(() => new Set());
  const [favIds, setFavIds] = useState(() => new Set());
  const [previewImage, setPreviewImage] = useState(null);

  const closePreviewImage = useCallback(() => {
    setPreviewImage(null);
  }, []);

  useEffect(() => {
    if (!previewImage) return;

    const previousOverflow = document.body.style.overflow;

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        closePreviewImage();
      }
    };

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [previewImage, closePreviewImage]);

  const myVendorId = me?.vendor?.id || null;

  const notifyCartChanged = useCallback(() => {
    try {
      window.dispatchEvent(new CustomEvent("cart:changed"));
    } catch {
      /* noop */
    }
  }, []);

  const announce = useCallback((msg) => {
    if (!announceRef.current) return;
    announceRef.current.textContent = msg;
    setTimeout(() => {
      if (announceRef.current) announceRef.current.textContent = "";
    }, 1500);
  }, []);

  const withPending = useCallback(async (id, fn) => {
    setPending((s) => new Set(s).add(id));
    try {
      return await fn();
    } finally {
      setPending((s) => {
        const n = new Set(s);
        n.delete(id);
        return n;
      });
    }
  }, []);

  const loadGuest = useCallback(async (signal) => {
    const list = getGuestCart();

    if (list.length === 0) {
      if (!signal?.aborted) setRows([]);
      return;
    }

    const ids = list.map((x) => x.productId).join(",");
    const attributionQuery = encodeURIComponent(
      JSON.stringify(getAttributionsForCheckout())
    );
    const res = await api(
      `/api/public/products?ids=${encodeURIComponent(ids)}&limit=${list.length}&campaignAttribution=${attributionQuery}`,
      { signal }
    );

    const byId = new Map((res?.items || []).map((p) => [p.id, p]));

    const mapped = list.map((x) => {
      const p = byId.get(x.productId);

      if (!p) {
        const qty = clampQty(x.qty, 1);
        return {
          productId: x.productId,
          qty,
          _localQty: qty,
          selectedOptions: x.selectedOptions || {},
customAnswers: x.customAnswers || {},
repeatedGroupAnswers:
  x.repeatedGroupAnswers || {},
configurationKey:
  x.configurationKey || "default",
          product: {
            id: x.productId,
            title: "Produs indisponibil",
            images: [],
            price: 0,
            currency: "RON",
            vendorId: null,
            vendorName: null,
            vendorSlug: null,
            available: false,
          },
        };
      }

      const hasNumericValue = (
  value
) =>
  value !== null &&
  value !== undefined &&
  value !== "" &&
  Number.isFinite(
    Number(value)
  );

const finalPriceCents =
  hasNumericValue(
    p?.finalPriceCents
  )
    ? Number(
        p.finalPriceCents
      )
    : hasNumericValue(
          p?.discountedPriceCents
        )
      ? Number(
          p.discountedPriceCents
        )
      : hasNumericValue(
            p?.priceCents
          )
        ? Number(
            p.priceCents
          )
        : hasNumericValue(
              p?.price
            )
          ? Math.round(
              Number(p.price) *
                100
            )
          : null;

const originalPriceCents =
  hasNumericValue(
    p?.originalPriceCents
  )
    ? Number(
        p.originalPriceCents
      )
    : hasNumericValue(
          p?.originalPrice
        )
      ? Math.round(
          Number(
            p.originalPrice
          ) * 100
        )
      : null;

const hasDiscount =
  p?.hasDiscount === true &&
  finalPriceCents !== null &&
  originalPriceCents !== null &&
  finalPriceCents <
    originalPriceCents;

const price =
  finalPriceCents !== null
    ? finalPriceCents / 100
    : 0;

     const product = {
  id: p.id,

  title:
    p.title ||
    "Produs",

  images:
    Array.isArray(
      p.images
    )
      ? p.images
      : [],

 price,

priceCents:
  finalPriceCents,

finalPriceCents,

discountedPriceCents:
  finalPriceCents,

originalPrice:
  hasDiscount
    ? originalPriceCents /
      100
    : null,

originalPriceCents:
  hasDiscount
    ? originalPriceCents
    : null,

hasDiscount,

discountPercent:
  hasDiscount
    ? Number(
        p?.totalDiscountPercent ??
          p?.discountPercent ??
          0
      )
    : 0,

totalDiscountPercent:
  hasDiscount
    ? Number(
        p?.totalDiscountPercent ??
          p?.discountPercent ??
          0
      )
    : 0,

platformDiscountPercent:
  hasDiscount
    ? Number(
        p?.platformDiscountPercent ??
          0
      )
    : 0,

vendorDiscountPercent:
  hasDiscount
    ? Number(
        p?.vendorDiscountPercent ??
          0
      )
    : 0,

hasActiveHomepageDiscount:
  hasDiscount &&
  p?.hasActiveHomepageDiscount ===
    true,

promoLabel:
  hasDiscount
    ? p?.promoLabel ||
      p?.discount?.label ||
      "Reducere Artfest"
    : null,

promoFundingSource:
  hasDiscount
    ? p?.promoFundingSource ||
      p?.discount
        ?.fundingSource ||
      null
    : null,

promoCollectionId:
  hasDiscount
    ? p?.promoCollectionId ||
      p?.discount
        ?.collectionId ||
      null
    : null,

discount:
  hasDiscount
    ? p?.discount ||
      null
    : null,

  currency:
    p.currency ||
    "RON",
        vendorId: p?.service?.vendor?.id || p?.vendorId || null,
        vendorName:
          p.storeName ||
          p?.service?.profile?.displayName ||
          p?.service?.vendor?.displayName ||
          "Magazin",
        vendorSlug: p.storeSlug || p?.service?.profile?.slug || null,

        readyQty: Number.isFinite(Number(p?.readyQty))
          ? Number(p.readyQty)
          : null,
        stockLimit: Number.isFinite(Number(p?.stockLimit))
          ? Number(p.stockLimit)
          : null,
        maxOrderQty: p?.maxOrderQty,
        stock: p?.stock,

        availability: p?.availability || null,
        available:
          p?.isActive !== false &&
          !p?.isHidden &&
          String(p?.availability || "").toUpperCase() !== "SOLD_OUT",
      };

      const max = getMaxQty(product);
      const qty = clampQty(x.qty, max);

      return {
  productId: x.productId,
  qty,
  _localQty: qty,

  selectedOptions: x.selectedOptions || {},
customAnswers: x.customAnswers || {},
repeatedGroupAnswers:
  x.repeatedGroupAnswers || {},
configurationKey:
  x.configurationKey || "default",

  product,
};
    });

    if (!signal?.aborted) setRows(mapped);
  }, []);

  const loadServer = useCallback(async (signal) => {
    const c = await api(
      `/api/cart?campaignAttribution=${encodeURIComponent(
        JSON.stringify(getAttributionsForCheckout())
      )}`,
      { signal }
    );
    const items = Array.isArray(c?.items) ? c.items : [];

    const mapped = items.map((it) => {
      const productRaw = it?.product || {};

      const product = {
        ...productRaw,
        title: productRaw?.title || "Produs",
        images: Array.isArray(productRaw?.images) ? productRaw.images : [],
      price:
  productRaw?.finalPriceCents !== null &&
  productRaw?.finalPriceCents !== undefined &&
  Number.isFinite(
    Number(
      productRaw.finalPriceCents
    )
  )
    ? Number(
        productRaw.finalPriceCents
      ) / 100
    : productRaw?.priceCents !== null &&
        productRaw?.priceCents !== undefined &&
        Number.isFinite(
          Number(
            productRaw.priceCents
          )
        )
      ? Number(
          productRaw.priceCents
        ) / 100
      : Number.isFinite(
            Number(
              productRaw?.price
            )
          )
        ? Number(
            productRaw.price
          )
        : 0,

priceCents:
  productRaw?.finalPriceCents !== null &&
  productRaw?.finalPriceCents !== undefined &&
  Number.isFinite(
    Number(
      productRaw.finalPriceCents
    )
  )
    ? Number(
        productRaw.finalPriceCents
      )
    : productRaw?.priceCents !== null &&
        productRaw?.priceCents !== undefined &&
        Number.isFinite(
          Number(
            productRaw.priceCents
          )
        )
      ? Number(
          productRaw.priceCents
        )
      : null,

originalPriceCents:
  productRaw?.originalPriceCents ?? null,

originalPrice:
  Number.isFinite(productRaw?.originalPriceCents)
    ? productRaw.originalPriceCents / 100
    : null,

hasDiscount:
  productRaw?.hasDiscount === true,

discountPercent:
  Number(
    productRaw?.totalDiscountPercent ??
      productRaw?.discountPercent ??
      0
  ),

totalDiscountPercent:
  Number(
    productRaw?.totalDiscountPercent ??
      productRaw?.discountPercent ??
      0
  ),

platformDiscountPercent:
  Number(
    productRaw?.platformDiscountPercent ??
      0
  ),

vendorDiscountPercent:
  Number(
    productRaw?.vendorDiscountPercent ??
      0
  ),

hasActiveHomepageDiscount:
  productRaw?.hasActiveHomepageDiscount ===
  true,

discountedPriceCents:
  productRaw?.discountedPriceCents ??
  productRaw?.finalPriceCents ??
  productRaw?.priceCents ??
  null,

finalPriceCents:
  productRaw?.finalPriceCents ??
  productRaw?.priceCents ??
  null,

promoLabel:
  productRaw?.promoLabel ??
  productRaw?.discount?.label ??
  null,

promoFundingSource:
  productRaw?.promoFundingSource ??
  productRaw?.discount?.fundingSource ??
  null,

promoCollectionId:
  productRaw?.promoCollectionId ??
  productRaw?.discount?.collectionId ??
  null,

discount:
  productRaw?.discount ??
  null,
        currency: productRaw?.currency || "RON",
        vendorId:
          productRaw?.vendorId ||
          productRaw?.service?.vendor?.id ||
          productRaw?.vendor?.id ||
          null,
        vendorName:
          productRaw?.storeName ||
          productRaw?.service?.profile?.displayName ||
          productRaw?.service?.vendor?.displayName ||
          productRaw?.vendor?.displayName ||
          "Magazin",
        vendorSlug:
          productRaw?.storeSlug || productRaw?.service?.profile?.slug || null,

        readyQty: Number.isFinite(Number(productRaw?.readyQty))
          ? Number(productRaw.readyQty)
          : null,
        stockLimit: Number.isFinite(Number(productRaw?.stockLimit))
          ? Number(productRaw.stockLimit)
          : null,
        maxOrderQty: productRaw?.maxOrderQty,
        stock: productRaw?.stock,

        availability:
  productRaw?.availability || null,

available:
  productRaw?.isAvailable !== false,

quantityAvailable:
  productRaw?.quantityAvailable ?? true,

availabilityMessage:
  productRaw?.availabilityMessage || null,
      };

      const max = getMaxQty(product);
      const qty = clampQty(it.qty, max);

      return {
  ...it,

  qty,
  _localQty: qty,

  selectedOptions:
    it.selectedOptions || {},

  customAnswers:
    it.customAnswers || {},

  repeatedGroupAnswers:
    it.repeatedGroupAnswers || {},

  product,
};
    });

    if (!signal?.aborted) setRows(mapped);
  }, []);

  const mergeIfNeeded = useCallback(
    async (user) => {
      if (!user || didMergeRef.current) return;

      const local = getGuestCart();
      if (!local.length) return;

      try {
        await api("/api/cart/merge", {
          method: "POST",
          body: {
            items: local,
            campaignAttribution: getAttributionsForCheckout(),
          },
        });

        clearGuestCart();
        didMergeRef.current = true;
        notifyCartChanged();
        announce("Am sincronizat coșul tău.");
      } catch {
        /* noop */
      }
    },
    [announce, notifyCartChanged]
  );

  useEffect(() => {
    const ac = new AbortController();

    (async () => {
      try {
        const d = await api("/api/auth/me", {
          signal: ac.signal,
        }).catch(() => null);

        const user = d?.user || null;
        if (!ac.signal.aborted) setMe(user);

        if (user) {
          await mergeIfNeeded(user);
          await loadServer(ac.signal);
        } else {
          await loadGuest(ac.signal);
        }
      } finally {
        if (!ac.signal.aborted) setLoading(false);
      }
    })();

    return () => ac.abort();
  }, [loadGuest, loadServer, mergeIfNeeded]);

  useEffect(() => {
    const ac = new AbortController();

    (async () => {
      if (!me) {
        setFavIds(new Set());
        return;
      }

      try {
        const res = await api("/api/favorites/ids", { signal: ac.signal });
        const items = Array.isArray(res?.items) ? res.items : [];

        if (!ac.signal.aborted) {
          setFavIds(new Set(items));
        }
      } catch (err) {
        console.error("Nu am putut încărca favoritele:", err);
      }
    })();

    return () => ac.abort();
  }, [me, me?.id, me?.sub]);

  const groups = useMemo(() => {
    const map = new Map();

    for (const r of rows) {
      const vid = r.product?.vendorId || "unknown";
      if (!map.has(vid)) map.set(vid, []);
      map.get(vid).push(r);
    }

    return map;
  }, [rows]);

  const grandTotal = useMemo(() => {
    let s = 0;

    for (const r of rows) {
      s += Number(r.product?.price || 0) * Number(r.qty || 0);
    }

    return s;
  }, [rows]);

  const hasOwnItems = useMemo(() => {
    if (!myVendorId) return false;

    return rows.some(
      (r) => r.product?.vendorId && r.product.vendorId === myVendorId
    );
  }, [rows, myVendorId]);

  const totalItems = useMemo(
    () => rows.reduce((s, r) => s + Number(r.qty || 0), 0),
    [rows]
  );

 const hasUnavailableItems = useMemo(
  () =>
    rows.some(
      (r) =>
        r.product?.available === false ||
        r.product?.quantityAvailable === false
    ),
  [rows]
);

  const setLocalQty = useCallback(
    (productId, configurationKey, value) => {
      setRows((list) =>
        list.map((r) =>
          r.productId === productId &&
          (r.configurationKey || "default") === configurationKey
            ? { ...r, _localQty: value }
            : r
        )
      );
    },
    []
  );

  const commitQty = useCallback(
    async (productId, configurationKey, qty) => {
      const row = rows.find(
        (r) =>
          r.productId === productId &&
          (r.configurationKey || "default") === configurationKey
      );

      const max = getMaxQty(row?.product);
      const safe = clampQty(qty, max);
      const prev = rows.slice();

      setRows((list) =>
        list.map((r) =>
          r.productId === productId &&
          (r.configurationKey || "default") === configurationKey
            ? { ...r, qty: safe, _localQty: safe }
            : r
        )
      );

      if (!me) {
        updateGuestCartItem(productId, configurationKey, safe);
        notifyCartChanged();

        if (safe !== qty) {
          alert(`Avem doar ${max} buc. disponibile momentan.`);
        }

        return;
      }

      const pendingKey = `${productId}:${configurationKey}`;

      await withPending(pendingKey, async () => {
        try {
          const res = await api("/api/cart/update", {
            method: "POST",
            body: {
              productId,
              configurationKey,
              qty: safe,
            },
          });

          if (res?.item?.qty && Number(res.item.qty) !== safe) {
            const serverQty = Number(res.item.qty);

            setRows((list) =>
              list.map((r) =>
                r.productId === productId &&
                (r.configurationKey || "default") === configurationKey
                  ? { ...r, qty: serverQty, _localQty: serverQty }
                  : r
              )
            );
          }

          notifyCartChanged();

          if (safe !== qty) {
            alert(`Avem doar ${max} buc. disponibile momentan.`);
          } else {
            announce("Cantitate actualizată.");
          }
        } catch (e) {
          alert(getFriendlyCartError(e, max));
          setRows(prev);
        }
      });
    },
    [rows, me, notifyCartChanged, withPending, announce]
  );

  const inc = useCallback(
    (productId, configurationKey, current) => {
      const row = rows.find(
        (r) =>
          r.productId === productId &&
          (r.configurationKey || "default") === configurationKey
      );

      const max = getMaxQty(row?.product);

      if (current >= max) {
        alert(`Avem doar ${max} buc. disponibile momentan.`);
        return;
      }

      if (row?.product) {
        trackAddToCart(row.product);
      }

      return commitQty(productId, configurationKey, current + 1);
    },
    [rows, commitQty]
  );

  const dec = useCallback(
    (productId, configurationKey, current) =>
      commitQty(
        productId,
        configurationKey,
        Math.max(current - 1, 1)
      ),
    [commitQty]
  );

  const removeItem = useCallback(
    async (productId, configurationKey) => {
      const prev = rows.slice();

      setRows((list) =>
        list.filter(
          (r) =>
            !(
              r.productId === productId &&
              (r.configurationKey || "default") === configurationKey
            )
        )
      );

      if (!me) {
        removeFromGuestCart(productId, configurationKey);
        notifyCartChanged();
        announce("Produs eliminat.");
        return;
      }

      const pendingKey = `${productId}:${configurationKey}`;

      await withPending(pendingKey, async () => {
        try {
          await api("/api/cart/remove", {
            method: "DELETE",
            body: {
              productId,
              configurationKey,
            },
          });

          notifyCartChanged();
          announce("Produs eliminat.");
        } catch {
          setRows(prev);
        }
      });
    },
    [rows, me, withPending, notifyCartChanged, announce]
  );

  const clearVendor = useCallback(
    async (vendorId) => {
      const vendorRows = rows.filter(
        (r) => (r.product?.vendorId || "unknown") === vendorId
      );

      const ids = [...new Set(vendorRows.map((r) => r.productId))];

      if (!vendorRows.length) return;
      if (!confirm("Elimini toate produsele acestui magazin din coș?")) return;

      const prev = rows.slice();
      setRows((list) =>
        list.filter((r) => (r.product?.vendorId || "unknown") !== vendorId)
      );

      if (!me) {
        vendorRows.forEach((r) => {
          removeFromGuestCart(
            r.productId,
            r.configurationKey || "default"
          );
        });

        notifyCartChanged();
        announce("Produsele magazinului au fost eliminate.");
        return;
      }

      try {
        await api("/api/cart/remove-batch", {
          method: "POST",
          body: { productIds: ids },
        }).catch(async () => {
          for (const r of vendorRows) {
            await api("/api/cart/remove", {
              method: "DELETE",
              body: {
                productId: r.productId,
                configurationKey: r.configurationKey || "default",
              },
            }).catch(() => {});
          }
        });

        notifyCartChanged();
        announce("Produsele magazinului au fost eliminate.");
      } catch {
        setRows(prev);
      }
    },
    [rows, me, notifyCartChanged, announce]
  );

  const clearAll = useCallback(async () => {
    if (!rows.length) return;
    if (!confirm("Sigur vrei să golești tot coșul?")) return;

    const prev = rows.slice();
    setRows([]);

    if (!me) {
      clearGuestCart();
      notifyCartChanged();
      announce("Coș golit.");
      return;
    }

    try {
      await api("/api/cart/clear", {
        method: "POST",
      }).catch(async () => {
        for (const r of prev) {
          await api("/api/cart/remove", {
            method: "DELETE",
            body: {
              productId: r.productId,
              configurationKey: r.configurationKey || "default",
            },
          }).catch(() => {});
        }
      });

      notifyCartChanged();
      announce("Coș golit.");
    } catch {
      setRows(prev);
    }
  }, [rows, me, notifyCartChanged, announce]);

const goCheckout = useCallback(() => {
  if (hasOwnItems || hasUnavailableItems) {
    return;
  }

  trackBeginCheckout(grandTotal);

  nav("/checkout");
}, [
  hasOwnItems,
  hasUnavailableItems,
  grandTotal,
  nav,
]);

  const isRowPending = useCallback((id) => pending.has(id), [pending]);

  const toggleFavorite = useCallback(
    async (productId) => {
      if (!productId) return;

      if (!me) {
        const redir = encodeURIComponent(`/produs/${productId}`);
        return nav(`/autentificare?redirect=${redir}`);
      }

      const pendingKey = `fav-${productId}`;

      await withPending(pendingKey, async () => {
        try {
          const res = await api("/api/favorites/toggle", {
            method: "POST",
            body: { productId },
          });

          const favorited = !!res?.favorited;

          setFavIds((old) => {
            const next = new Set(old);
            if (favorited) next.add(productId);
            else next.delete(productId);
            return next;
          });

          announce(
            favorited
              ? "Produs adăugat la favorite."
              : "Produs eliminat din favorite."
          );
        } catch (e) {
          console.error("toggleFavorite failed:", e);
          alert(e?.message || "Nu am putut actualiza lista de favorite.");
        }
      });
    },
    [me, nav, withPending, announce]
  );

  if (loading) {
    return (
      <div className={styles.container}>
        <div className={styles.headerRow}>
          <h2 className={styles.pageTitle}>Coș</h2>
        </div>

        <div className={styles.layout}>
          <div className={styles.list}>
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className={styles.card} aria-hidden="true">
                <div className={styles.media}>
                  <div className={styles.skelImg} />
                </div>
                <div className={styles.body}>
                  <div className={styles.skelLine} />
                  <div className={styles.skelLineShort} />
                </div>
              </div>
            ))}
          </div>

          <aside className={styles.summary} aria-hidden="true">
            <div className={styles.skelLine} />
            <div className={styles.skelLineShort} />
            <div className={styles.skelLineShort} />
          </aside>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div ref={announceRef} aria-live="polite" className={styles.srOnly} />

      <div className={styles.headerRow}>
        <h2 className={styles.pageTitle}>Coș</h2>

        {rows.length > 0 && (
          <button className={styles.linkBtn} onClick={clearAll} type="button">
            Golește coșul
          </button>
        )}
      </div>

      {rows.length === 0 ? (
        <div className={styles.empty}>
          <p>Coșul tău este gol.</p>
          <Link to="/produse" className={styles.checkoutBtn}>
            Vezi produsele
          </Link>
        </div>
      ) : (
        <div className={styles.layout}>
          <div className={styles.list}>
            {[...groups.entries()].map(([vendorId, items]) => {
              const firstProduct = items[0]?.product || {};
              const vName = firstProduct.vendorName || "Magazin";
              const vSlug = firstProduct.vendorSlug || null;

              const vendorSubtotal = items.reduce(
                (s, r) =>
                  s + Number(r.product?.price || 0) * Number(r.qty || 0),
                0
              );

              return (
                <section
                  key={vendorId}
                  className={styles.vendorSection}
                  aria-label={`Magazin ${vName || ""}`}
                >
                  <header className={styles.vendorHead}>
                    <div className={styles.vendorTitle}>
                      {vSlug ? (
                        <Link to={`/magazin/${vSlug}`}>{vName}</Link>
                      ) : (
                        <span>{vName}</span>
                      )}

                      <small className={styles.vendorSub}>
                        Subtotal: {money(vendorSubtotal, "RON")}
                      </small>
                    </div>

                    <button
                      className={styles.linkBtn}
                      type="button"
                      onClick={() => clearVendor(vendorId)}
                    >
                      Elimină tot de la acest magazin
                    </button>
                  </header>

                  {items.map((r, idx) => {
                    const p = r.product || {};
                    const selectedOptionEntries = getConfigurationEntries(
  r.selectedOptions
);

const customAnswerEntries = getConfigurationEntries(
  r.customAnswers
);
const repeatedGroupEntries =
  getRepeatedGroupEntries(
    r.repeatedGroupAnswers
  );
const hasConfiguration =
  selectedOptionEntries.length > 0 ||
  customAnswerEntries.length > 0 ||
  repeatedGroupEntries.length > 0;
                    const img = p.images?.[0]
                      ? resolveFileUrl(p.images[0])
                      : productPlaceholder(200, 160, "Produs");

                    const isOwner =
                      !!myVendorId && !!p.vendorId && myVendorId === p.vendorId;

                    const max = getMaxQty(p);
                    const canDec = r._localQty > 1;
                    const canInc = r._localQty < max;

                    const unavailable = p.available === false;
                    const rowBusy = isRowPending(getRowKey(r));

                    const productIdForFav = p.id || r.productId;
                    const isFav =
                      !!productIdForFav && favIds.has(productIdForFav);

                    const favKey = productIdForFav
                      ? `fav-${productIdForFav}`
                      : null;

                    const favBusy = favKey ? isRowPending(favKey) : false;
                    const eager = idx < 2;

                    return (
                      <article key={getRowKey(r)} className={styles.card}>
                        <Link
                          to={p.id ? `/produs/${p.id}` : "#"}
                          className={styles.media}
                          aria-label={p.title}
                          onClick={(e) => {
                            if (!p.id) e.preventDefault();
                          }}
                        >
                          <img
                            className={styles.mediaImg}
                            src={img}
                            alt={p.title}
                            onError={(e) => onImgError(e, 200, 160, "Produs")}
                            decoding="async"
                            loading={eager ? "eager" : "lazy"}
                            fetchPriority={eager ? "high" : "auto"}
                          />
                        </Link>

                        <div className={styles.body}>
                          <h3 className={styles.title}>
                            {p.title}
                            {unavailable ? " (indisponibil)" : ""}
                            {unavailable && (
  <div className={styles.errorBar}>
    {p.availabilityMessage ||
      "Produsul nu mai este disponibil."}
  </div>
)}
                          </h3>
{hasConfiguration && (
  <div className={styles.configuration}>
    {selectedOptionEntries.length > 0 && (
      <div className={styles.configurationGroup}>
        <div className={styles.configurationTitle}>
          Opțiuni selectate
        </div>

        {selectedOptionEntries.map(([key, value]) => (
          <div
            key={`option-${key}`}
            className={styles.configurationRow}
          >
            <span>{key}</span>
            <strong>{getReadableValue(value)}</strong>
          </div>
        ))}
      </div>
    )}

   {customAnswerEntries.map(([key, value]) => {
  const imageValue = isImageUrl(value);

  return (
    <div
      key={`custom-${key}`}
      className={styles.configurationRow}
    >
      <span>{key}</span>

     {imageValue ? (
  <button
    type="button"
    className={styles.previewTrigger}
    onClick={() =>
      setPreviewImage({
        url: resolveFileUrl(value),
        label: key,
      })
    }
    aria-label={`Deschide poza pentru ${key}`}
    title="Deschide poza"
  >
    <img
      src={resolveFileUrl(value)}
      alt={`Personalizare ${key}`}
      className={styles.previewThumb}
    />
  </button>
) : (
  <strong>
    {getReadableValue(value)}
  </strong>
)}
    </div>
  );
})}
    {repeatedGroupEntries.length > 0 && (
  <div
    className={
      styles.configurationGroup
    }
  >
    <div
      className={
        styles.configurationTitle
      }
    >
      Pentru fiecare membru
    </div>

    {repeatedGroupEntries.map(
      ([groupKey, items]) => (
        <div
          key={`repeated-${groupKey}`}
        >
          {items.map(
            (item, itemIndex) => {
              const entries =
                getConfigurationEntries(
                  item
                );

              if (!entries.length) {
                return null;
              }

              return (
                <div
                  key={`${groupKey}-${itemIndex}`}
                  style={{
                    marginTop: 10,
                    paddingTop: 10,
                    borderTop:
                      itemIndex > 0
                        ? "1px solid rgba(0,0,0,0.08)"
                        : "none",
                  }}
                >
                  <div
                    style={{
                      fontWeight: 700,
                      marginBottom: 6,
                    }}
                  >
                    Membru{" "}
                    {itemIndex + 1}
                  </div>

                  {entries.map(
                    ([key, value]) => (
                      <div
                        key={`${groupKey}-${itemIndex}-${key}`}
                        className={
                          styles.configurationRow
                        }
                      >
                        <span>
                          {key}
                        </span>

                        <strong>
                          {getReadableValue(
                            value
                          )}
                        </strong>
                      </div>
                    )
                  )}
                </div>
              );
            }
          )}
        </div>
      )
    )}
  </div>
)}

  </div>
)}
                          {typeof p.price === "number" && (
  <div className={styles.priceWrap}>
    {p.hasDiscount && typeof p.originalPrice === "number" ? (
      <>
        <div className={styles.oldPrice}>
          {money(p.originalPrice, p.currency)}
        </div>

        <div className={styles.priceRow}>
          <div className={styles.price}>
            {money(p.price, p.currency)}
          </div>

          <span className={styles.discountBadge}>
            -{p.discountPercent}%
          </span>
        </div>

        {p.promoLabel ? (
          <div className={styles.promoLabel}>
            {p.promoLabel}
          </div>
        ) : null}
      </>
    ) : (
      <div className={styles.price}>
        {money(p.price, p.currency)}
      </div>
    )}
  </div>
)}

                          {Number.isFinite(max) && max !== DEFAULT_MAX_QTY && (
                            <div className={styles.meta}>
                              Disponibil momentan: {max} buc.
                            </div>
                          )}

                          {r._localQty >= 1000 && (
                            <div className={styles.meta}>
                              Comenzile mari pot avea timpi de procesare/livrare
                              suplimentari.
                            </div>
                          )}

                          {isOwner && me && (
                            <div className={styles.ownerNote}>
                              (Produsul îți aparține — checkout-ul va fi blocat.)
                            </div>
                          )}
                        </div>

                        <div className={styles.actions}>
                          <div className={styles.qty} aria-label="Cantitate">
                            <button
                              className={styles.iconBtnOutline}
                              onClick={() =>
                                dec(
                                  r.productId,
                                  r.configurationKey || "default",
                                  r.qty
                                )
                              }
                              title="Scade cantitatea"
                              aria-label="Scade cantitatea"
                              type="button"
                              disabled={!canDec || unavailable || rowBusy}
                            >
                              <FaMinus />
                            </button>

                            <input
                              className={styles.qtyInput}
                              value={String(r._localQty)}
                              inputMode="numeric"
                              pattern="[0-9]*"
                              min={1}
                              max={max}
                              onChange={(e) => {
                                const raw = e.target.value.replace(/[^\d]/g, "");
                                const parsed = parseInt(raw || "1", 10);
                                const v = clampQty(parsed, max);
                                setLocalQty(
                                  r.productId,
                                  r.configurationKey || "default",
                                  v
                                );
                              }}
                              onBlur={() => {
                                if (r._localQty !== r.qty) {
                                  commitQty(
                                    r.productId,
                                    r.configurationKey || "default",
                                    r._localQty
                                  );
                                }
                              }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") e.currentTarget.blur();
                              }}
                              aria-label="Cantitate"
                              disabled={unavailable || rowBusy}
                            />

                            <button
                              className={styles.iconBtnOutline}
                              onClick={() =>
                                inc(
                                  r.productId,
                                  r.configurationKey || "default",
                                  r.qty
                                )
                              }
                              title={
                                canInc
                                  ? "Crește cantitatea"
                                  : `Avem doar ${max} buc. disponibile`
                              }
                              aria-label="Crește cantitatea"
                              type="button"
                              disabled={!canInc || unavailable || rowBusy}
                            >
                              <FaPlus />
                            </button>
                          </div>

                          <div className={styles.actionsIcons}>
                            {productIdForFav && (
                              <button
                                type="button"
                                className={`${styles.iconBtnOutline} ${
                                  isFav ? styles.favActive : styles.favInactive
                                }`}
                                onClick={() => toggleFavorite(productIdForFav)}
                                aria-label={
                                  isFav
                                    ? "Scoate din favorite"
                                    : "Adaugă la favorite"
                                }
                                title={
                                  isFav
                                    ? "Scoate din favorite"
                                    : "Adaugă la favorite"
                                }
                                disabled={favBusy}
                              >
                                {isFav ? <FaHeart /> : <FaRegHeart />}
                              </button>
                            )}

                            <button
                              className={styles.iconBtnOutline}
                              onClick={() =>
                                removeItem(
                                  r.productId,
                                  r.configurationKey || "default"
                                )
                              }
                              title="Elimină din coș"
                              aria-label="Elimină din coș"
                              type="button"
                              disabled={rowBusy}
                            >
                              <FaTrash />
                            </button>
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </section>
              );
            })}
          </div>

          <aside className={styles.summary} aria-label="Sumar coș">
            <div className={styles.summaryTitle}>
              Sumar
              {totalItems > 0 && (
                <span className={styles.summaryCount}>
                  {" "}
                  · {totalItems} produse
                </span>
              )}
            </div>

            {[...groups.entries()].map(([vendorId, items]) => {
              const firstProduct = items[0]?.product || {};
              const vName = firstProduct.vendorName || "Magazin";
              const vSlug = firstProduct.vendorSlug || null;

              const vendorSubtotal = items.reduce(
                (s, r) =>
                  s + Number(r.product?.price || 0) * Number(r.qty || 0),
                0
              );

              return (
                <div className={styles.summaryRow} key={`sum-${vendorId}`}>
                  {vSlug ? (
                    <Link to={`/magazin/${vSlug}`}>{vName}</Link>
                  ) : (
                    <span>{vName}</span>
                  )}

                  <strong>{money(vendorSubtotal, "RON")}</strong>
                </div>
              );
            })}

            <div className={styles.summaryRow}>
              <span>Subtotal</span>
              <strong>{money(grandTotal, "RON")}</strong>
            </div>

            <div className={styles.summaryNote}>
              Taxele de livrare se calculează la pasul următor, separat pe
              fiecare magazin.
            </div>

            {hasOwnItems && (
              <div className={styles.errorBar} role="alert">
                Ai produse din propriul magazin în coș. Elimină-le pentru a
                continua la checkout.
              </div>
            )}

            {hasUnavailableItems && (
  <div
    className={styles.errorBar}
    role="alert"
  >
    Unele produse din coș nu mai sunt disponibile
    sau nu mai există suficient stoc.
    Verifică produsele înainte de checkout.
  </div>
)}

            <button
              className={styles.checkoutBtn}
              onClick={goCheckout}
              type="button"
              disabled={hasOwnItems || hasUnavailableItems}
            >
              Continuă la checkout
            </button>
          </aside>
        </div>
      )}

      {rows.length > 0 && (
        <div
          className={styles.mobileBar}
          role="region"
          aria-label="Rezumat rapid și checkout"
        >
          <div>
            <div className={styles.tot}>{money(grandTotal, "RON")}</div>
            <div className={styles.small}>Subtotal fără livrare</div>
          </div>

          <button
            className={styles.mobileCheckout}
            onClick={goCheckout}
            type="button"
            disabled={hasOwnItems || hasUnavailableItems}
            aria-disabled={hasOwnItems || hasUnavailableItems}
            title={
              hasOwnItems
                ? "Ai produse din propriul magazin în coș"
                : hasUnavailableItems
                ? "Ai produse indisponibile în coș"
                : "Continuă la checkout"
            }
          >
            Checkout
          </button>
        </div>
      )}

      {previewImage &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className={styles.modalOverlay}
            role="dialog"
            aria-modal="true"
            aria-label="Previzualizare poză personalizare"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) {
                closePreviewImage();
              }
            }}
          >
            <div
              className={styles.modalContent}
              onMouseDown={(event) => event.stopPropagation()}
            >
              <button
                type="button"
                className={styles.modalClose}
                onClick={closePreviewImage}
                aria-label="Închide poza"
                title="Închide"
              >
                ×
              </button>

              <img
                src={previewImage.url}
                alt={
                  previewImage.label
                    ? `Personalizare ${previewImage.label}`
                    : "Poză personalizare"
                }
                className={styles.modalImage}
                onError={(event) => {
                  event.currentTarget.alt =
                    "Imaginea nu a putut fi încărcată";
                }}
              />
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
