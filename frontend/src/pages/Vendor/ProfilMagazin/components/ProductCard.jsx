import React, {
  useMemo,
  useCallback,
  useState,
  useEffect,
  useRef,
} from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import {
  FaEdit,
  FaTrash,
  FaShoppingCart,
  FaHeart,
  FaRegHeart,
  FaChevronLeft,
  FaChevronRight,
} from "react-icons/fa";
import styles from "./css/ProductCard.module.css";
import {
  productPlaceholder,
  onImgError,
} from "../../../../components/utils/imageFallback";
import { resolveFileUrl, withCache } from "../hooks/useProfilMagazin";
import { api } from "../../../../lib/api";

// Mic util pentru fallback generic din slug -> text uman
const humanizeSlug = (slug = "", { dropPrefix = false } = {}) => {
  if (!slug || typeof slug !== "string") return "";
  let s = slug;
  if (dropPrefix) {
    s = s.replace(/^[^_]+_/, ""); // taie prefixul până la primul "_"
  }
  return s
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (m) => m.toUpperCase());
};

// Map local pentru culori (în română) – ca fallback dacă nu primim colorLabelMap
const LOCAL_COLOR_LABELS = {
  // Neutre
  white: "Alb",
  ivory: "Ivory / ivoire",
  cream: "Crem",
  beige: "Bej",
  grey_light: "Gri deschis",
  grey_dark: "Gri închis",
  black: "Negru",

  // Maro
  brown_light: "Maro deschis",
  brown: "Maro",
  brown_dark: "Maro închis",
  taupe: "Taupe",

  // Roșu / roz
  red: "Roșu",
  burgundy: "Burgundy / vișiniu",
  pink_light: "Roz deschis",
  pink_dusty: "Roz pudră",
  pink_hot: "Roz aprins",

  // Mov
  lilac: "Lila",
  purple: "Mov",

  // Galben / portocaliu
  yellow: "Galben",
  mustard: "Muștar",
  orange: "Portocaliu",
  peach: "Pișcă / piersică",

  // Albastru
  blue_light: "Albastru deschis",
  blue: "Albastru",
  blue_royal: "Albastru regal",
  navy: "Bleumarin",
  turquoise: "Turcoaz",
  teal: "Teal",

  // Verde
  green_light: "Verde deschis",
  green: "Verde",
  green_olive: "Verde olive",
  green_dark: "Verde închis",
  mint: "Mentă",

  // Metalice / speciale
  gold: "Auriu",
  rose_gold: "Rose gold",
  silver: "Argintiu",
  copper: "Cupru",
  transparent: "Transparent",
  multicolor: "Multicolor",
};

export default function ProductCard({
  p,
  viewMode,
  isFav,
  navigate, // opțional; dacă nu e dat, folosim useNavigate
  productsCacheT,
  onToggleFavorite,
  onAddToCart,
  onEdit, // fallback
  onDelete, // fallback
  categoryLabelMap,
  categoryGroupLabelMap, // opțional
  colorLabelMap, // opțional
  onEditProduct, // preferat
}) {
  const nav = useNavigate();
  const loc = useLocation();
  const go = navigate || nav;

  const [deleting, setDeleting] = useState(false);

  // copie locală pentru update instant
  const [prod, setProd] = useState(() => p || {});
  const [cacheT, setCacheT] = useState(() => Date.now());
  useEffect(() => {
    setProd(p || {});
  }, [p]);

  // evenimente globale: update & delete
  useEffect(() => {
    const onUpdated = (e) => {
      const up = e?.detail?.product;
      const onlyId = e?.detail?.id; // fallback doar id
      const myId = prod?.id || prod?._id || "";
      if (!myId) return;

      if (up) {
        const upId = up.id || up._id;
        if (upId !== myId) return;
        setProd((prev) => ({ ...prev, ...up }));
        setCacheT(Date.now()); // bust cache imagini
        return;
      }
      if (onlyId && onlyId === myId) {
        setCacheT(Date.now());
      }
    };

    const onDeleted = (e) => {
      const delId = e?.detail?.id;
      const myId = prod?.id || prod?._id;
      if (delId && delId === myId) {
        setProd((prev) => ({ ...prev, _hidden: true }));
      }
    };

    window.addEventListener("vendor:productUpdated", onUpdated);
    window.addEventListener("vendor:productDeleted", onDeleted);
    return () => {
      window.removeEventListener("vendor:productUpdated", onUpdated);
      window.removeEventListener("vendor:productDeleted", onDeleted);
    };
  }, [prod?.id, prod?._id]);

  const isHiddenInternal = !!prod?._hidden; // intern (după delete event)
  const isValid = !!prod && typeof prod === "object";

  // availability: doar ce vine din API (nu mai „ghicim”)
const safe = useMemo(() => {
  const images = Array.isArray(prod?.images) ? prod.images : [];

  const readyQtyRaw = prod?.readyQty;
  const readyQty =
    readyQtyRaw === null ||
    readyQtyRaw === undefined ||
    readyQtyRaw === ""
      ? null
      : Number.isFinite(Number(readyQtyRaw))
      ? Number(readyQtyRaw)
      : null;

  const availability =
    typeof prod?.availability === "string"
      ? prod.availability.toUpperCase()
      : null;

  // 🔹 preț: exact ca în ProductDetails – încercăm price, apoi priceCents
  const priceCentsRaw =
    typeof prod?.priceCents === "number"
      ? prod.priceCents
      : Number.isFinite(Number(prod?.priceCents))
      ? Number(prod.priceCents)
      : null;

  let price = null;
  if (typeof prod?.price === "number") {
    price = prod.price;
  } else if (priceCentsRaw != null) {
    price = priceCentsRaw / 100;
  } else if (Number.isFinite(Number(prod?.price))) {
    price = Number(prod.price);
  }

  return {
    id: prod?.id || prod?._id || "",
    title: prod?.title || "Produs",
    images,
    price,                 // 👈 acum e calculat corect
    priceCents: priceCentsRaw,
    currency: prod?.currency || "RON",
    category: prod?.category || null,
    color: prod?.color || null,
    isActive: prod?.isActive !== false,
    isHidden: !!prod?.isHidden,
    availability,
    leadTimeDays: Number.isFinite(Number(prod?.leadTimeDays))
      ? Number(prod.leadTimeDays)
      : null,
    readyQty,
    acceptsCustom: !!prod?.acceptsCustom,
    nextShipDate: prod?.nextShipDate || null,
  };
}, [prod]);

  const href = safe.id ? `/produs/${safe.id}${loc.search || ""}` : null;

  // Galerie
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    setIdx(0);
  }, [safe.id, safe.images?.length]);

  const imgCount = safe.images.length;
  const activeImg = imgCount
    ? safe.images[Math.min(idx, imgCount - 1)]
    : "";
  const imgSrc = useMemo(() => {
    const src = activeImg ? resolveFileUrl(activeImg) : "";
    const t = cacheT || productsCacheT;
    return src
      ? withCache(src, t)
      : productPlaceholder(600, 450, "Produs");
  }, [activeImg, cacheT, productsCacheT]);

  const next = useCallback(
    (e) => {
      e?.stopPropagation?.();
      if (!imgCount) return;
      setIdx((i) => (i + 1) % imgCount);
    },
    [imgCount]
  );

  const prev = useCallback(
    (e) => {
      e?.stopPropagation?.();
      if (!imgCount) return;
      setIdx((i) => (i - 1 + imgCount) % imgCount);
    },
    [imgCount]
  );

  // swipe mobil
  const touchStartX = useRef(null);
  const onTouchStart = (e) => {
    touchStartX.current =
      e.changedTouches?.[0]?.clientX ?? null;
  };
  const onTouchEnd = (e) => {
    const startX = touchStartX.current;
    const endX = e.changedTouches?.[0]?.clientX ?? null;
    if (startX == null || endX == null) return;
    const dx = endX - startX;
    if (Math.abs(dx) > 40) {
      if (dx < 0) next();
      else prev();
    }
    touchStartX.current = null;
  };

  const priceLabel = useMemo(() => {
    if (!Number.isFinite(safe.price)) return null;
    try {
      return new Intl.NumberFormat("ro-RO", {
        style: "currency",
        currency: safe.currency || "RON",
        maximumFractionDigits: 2,
      }).format(safe.price);
    } catch {
      return `${safe.price} ${safe.currency || "RON"}`;
    }
  }, [safe.price, safe.currency]);

  const catKey = safe.category;

  const catLabel = useMemo(() => {
    if (!catKey) return null;
    if (categoryLabelMap && categoryLabelMap[catKey]) {
      return categoryLabelMap[catKey];
    }
    // fallback: scoatem prefixul (decor_, papetarie_, etc.) și humanizăm
    return humanizeSlug(catKey, { dropPrefix: true });
  }, [catKey, categoryLabelMap]);

  const catGroupKey = useMemo(() => {
    if (!catKey) return null;
    return catKey.split("_")[0] || null;
  }, [catKey]);

  const catGroupLabel = useMemo(() => {
    if (!catGroupKey) return null;
    if (
      categoryGroupLabelMap &&
      categoryGroupLabelMap[catGroupKey]
    ) {
      return categoryGroupLabelMap[catGroupKey];
    }
    // fallback: capitalizăm simplu
    return humanizeSlug(catGroupKey);
  }, [catGroupKey, categoryGroupLabelMap]);

  const colorLabel = useMemo(() => {
    if (!safe.color) return null;

    // 1) Map primit ca prop (ideal: din shared/ui/colorsUi)
    if (colorLabelMap && colorLabelMap[safe.color]) {
      return colorLabelMap[safe.color];
    }

    // 2) Map local, cu label-uri în română
    if (LOCAL_COLOR_LABELS[safe.color]) {
      return LOCAL_COLOR_LABELS[safe.color];
    }

    // 3) Ultim fallback: slug brut (nu îl mai "englezim" cu humanizeSlug)
    return safe.color;
  }, [safe.color, colorLabelMap]);

  const goTo = useCallback(
    (path) => {
      if (path) go(path);
    },
    [go]
  );

  const isSoldOut =
    safe.availability === "SOLD_OUT" ||
    (safe.availability === "READY" &&
      safe.readyQty === 0);

  const isDisabled = !safe.isActive || safe.isHidden;

  // status badge (singurul care conține textul disponibilității)
  const status = useMemo(() => {
    if (safe.availability === "SOLD_OUT" || isSoldOut) {
      return { label: "Epuizat", tone: "danger" };
    }
    if (safe.availability === "PREORDER") {
      return { label: "Precomandă", tone: "info" };
    }
    if (safe.availability === "MADE_TO_ORDER") {
      return { label: "La comandă", tone: "warning" };
    }
    if (safe.availability === "READY") {
      return { label: "Gata de livrare", tone: "success" };
    }
    return null;
  }, [safe.availability, isSoldOut]);

  const handleOpenProduct = useCallback(
    (e) => {
      if (!href || isDisabled) return;
      e?.preventDefault?.();
      goTo(href);
    },
    [href, goTo, isDisabled]
  );

  const handleFav = useCallback(
    (e) => {
      e?.stopPropagation?.();
      if (!safe.id) return;
      if (typeof onToggleFavorite === "function")
        onToggleFavorite(safe.id, !isFav);
      else
        goTo(
          `/autentificare?redirect=${encodeURIComponent(
            href || "/"
          )}`
        );
    },
    [safe.id, isFav, onToggleFavorite, goTo, href]
  );

  const handleCart = useCallback(
    (e) => {
      e?.stopPropagation?.();
      if (!safe.id || isDisabled || isSoldOut) return;
      if (typeof onAddToCart === "function")
        onAddToCart(safe.id);
      else
        goTo(
          `/autentificare?redirect=${encodeURIComponent(
            href || "/"
          )}`
        );
    },
    [safe.id, onAddToCart, goTo, href, isDisabled, isSoldOut]
  );

  const handleEdit = useCallback(
    (e) => {
      e?.stopPropagation?.();
      if (!safe.id) return;
      if (typeof onEditProduct === "function")
        return onEditProduct(prod);
      if (typeof onEdit === "function") return onEdit(prod);
    },
    [safe.id, onEditProduct, onEdit, prod]
  );

  const handleDelete = useCallback(
    async (e) => {
      e?.stopPropagation?.();
      if (!safe.id || deleting) return;
      if (typeof onDelete === "function")
        return onDelete(safe.id);

      if (
        !window.confirm(
          "Sigur vrei să ștergi acest produs?"
        )
      )
        return;
      try {
        setDeleting(true);
        await api(
          `/api/vendor/products/${encodeURIComponent(
            safe.id
          )}`,
          { method: "DELETE" }
        );
        try {
          window.dispatchEvent(
            new CustomEvent("vendor:productDeleted", {
              detail: { id: safe.id },
            })
          );
        } catch {
          /* noop */
        }
        alert("Produs șters.");
      } catch (e2) {
        alert(
          e2?.message || "Nu am putut șterge produsul."
        );
      } finally {
        setDeleting(false);
      }
    },
    [safe.id, onDelete, deleting]
  );

  if (!isValid || isHiddenInternal) return null;

  return (
    <article
      className={`${styles.card} ${
        isDisabled ? styles.cardInactive : ""
      }`}
      data-product-id={safe.id}
      aria-labelledby={
        safe.id ? `prod-title-${safe.id}` : undefined
      }
      role="group"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" && href)
          handleOpenProduct(e);
      }}
    >
      <div
        className={styles.media}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        {/* BADGES pe imagine */}
        <div className={styles.badges}>
          {!safe.isActive && (
            <span
              className={`${styles.badge} ${styles.badgeInactive}`}
            >
              Inactiv
            </span>
          )}
          {safe.isHidden && (
            <span className={styles.badge}>Ascuns</span>
          )}

          {status && (
            <span
              className={`${styles.badge} ${
                status.tone === "danger"
                  ? styles.badgeDanger
                  : status.tone === "warning"
                  ? styles.badgeWarning
                  : status.tone === "info"
                  ? styles.badgeInfo
                  : styles.badgeSuccess
              }`}
            >
              {status.label}
            </span>
          )}

          {safe.acceptsCustom && (
            <span
              className={`${styles.badge} ${styles.badgeOutline}`}
            >
              Personalizabil
            </span>
          )}
        </div>

        {/* Overlay discret pentru epuizat */}
        {isSoldOut && (
          <div
            className={styles.soldOutOverlay}
            aria-hidden="true"
          />
        )}

        {imgCount > 1 && (
          <span className={styles.badgeImgs}>
            {imgCount}
          </span>
        )}

        {href && !isDisabled ? (
          <Link
            to={href}
            onClick={handleOpenProduct}
            aria-label={`Deschide ${safe.title}`}
          >
            <img
              src={imgSrc}
              alt={safe.title}
              className={styles.image}
              loading="lazy"
              decoding="async"
              sizes="(max-width: 480px) 45vw, (max-width: 1024px) 30vw, 280px"
              onError={(e) =>
                onImgError(e, 600, 450, "Produs")
              }
            />
          </Link>
        ) : (
          <img
            src={imgSrc}
            alt={safe.title}
            className={styles.image}
            loading="lazy"
            decoding="async"
            onError={(e) =>
              onImgError(e, 600, 450, "Produs")
            }
            aria-disabled="true"
          />
        )}

        {imgCount > 1 && (
          <>
            <button
              type="button"
              className={`${styles.navBtn} ${styles.navPrev}`}
              onClick={prev}
              aria-label="Imagine anterioară"
            >
              <FaChevronLeft />
            </button>
            <button
              type="button"
              className={`${styles.navBtn} ${styles.navNext}`}
              onClick={next}
              aria-label="Imagine următoare"
            >
              <FaChevronRight />
            </button>
          </>
        )}

        {imgCount > 1 && (
          <div
            className={styles.dots}
            role="tablist"
            aria-label="Navigare imagini produs"
          >
            {safe.images.map((_, i) => {
              const active = i === idx;
              return (
                <button
                  key={`dot-${i}`}
                  role="tab"
                  aria-selected={active}
                  aria-label={`Imaginea ${i + 1} din ${imgCount}`}
                  className={`${styles.dot} ${
                    active ? styles.dotActive : ""
                  }`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setIdx(i);
                  }}
                />
              );
            })}
          </div>
        )}
      </div>

      <div className={styles.cardBody}>
        <h4
          id={safe.id ? `prod-title-${safe.id}` : undefined}
          className={styles.cardTitle}
          title={safe.title}
        >
          {href && !isDisabled ? (
            <Link
              to={href}
              onClick={handleOpenProduct}
              style={{
                color: "inherit",
                textDecoration: "none",
              }}
            >
              {safe.title}
            </Link>
          ) : (
            safe.title
          )}
        </h4>

        {/* Culoare (în română, folosind map-urile) */}
        {colorLabel && (
          <p
            className={styles.colorHint}
            title={safe.color || ""} // slug-ul în tooltip, dacă e nevoie
          >
            Culoare:{" "}
            <span className={styles.metaInline}>
              {colorLabel}
            </span>
          </p>
        )}

        <div className={styles.cardMetaRow}>
          <div className={styles.metaLeft}>
            {priceLabel != null && (
              <p
                className={styles.price}
                aria-label={`Preț ${priceLabel}`}
              >
                {priceLabel}
              </p>
            )}

            {/* Detalii livrare / stoc (subțire, sub preț) */}
            {safe.availability === "READY" &&
              safe.readyQty != null && (
                <span className={styles.metaHint}>
                  Stoc:{" "}
                  <span className={styles.metaInline}>
                    {safe.readyQty} buc
                  </span>
                </span>
              )}

            {safe.availability === "MADE_TO_ORDER" &&
              safe.leadTimeDays && (
                <span className={styles.metaHint}>
                  Timp execuție:{" "}
                  <span className={styles.metaInline}>
                    {safe.leadTimeDays} zile
                  </span>
                </span>
              )}

            {safe.availability === "PREORDER" &&
              safe.nextShipDate && (
                <span className={styles.metaHint}>
                  Expediere:{" "}
                  <span className={styles.metaInline}>
                    {new Date(
                      safe.nextShipDate
                    ).toLocaleDateString("ro-RO")}
                  </span>
                </span>
              )}
          </div>

          {/* Categoria – label prietenos */}
          {catKey && catLabel && (
            <button
              type="button"
              className={styles.catPill}
              title={
                catGroupLabel
                  ? `${catGroupLabel} · ${catLabel}`
                  : `Vezi produse în ${catLabel}`
              }
              onClick={(e) => {
                e.stopPropagation();
                const qp = new URLSearchParams(loc.search);
                qp.set("category", catKey);
                const qs = qp.toString();
                goTo(`/produse${qs ? `?${qs}` : ""}`);
              }}
              aria-label={`Vezi produse în categoria ${catLabel}`}
            >
              {catLabel}
            </button>
          )}
        </div>

        <div className={styles.cardActions}>
          {viewMode === "vendor" ? (
            <div className={styles.ownerRow}>
              <button
                type="button"
                className={`${styles.ownerIconBtn} ${styles.ownerIconTip}`}
                data-tip="Editează"
                onClick={handleEdit}
                aria-label="Editează produs"
              >
                <FaEdit />
                <span className={styles.srOnly}>
                  Editează
                </span>
              </button>

              <button
                type="button"
                className={`${styles.ownerIconBtn} ${styles.ownerIconDanger} ${styles.ownerIconTip}`}
                data-tip={deleting ? "Se șterge…" : "Șterge"}
                onClick={handleDelete}
                disabled={deleting}
                aria-label="Șterge produs"
              >
                <FaTrash />
                <span className={styles.srOnly}>
                  {deleting
                    ? "Se șterge…"
                    : "Șterge"}
                </span>
              </button>
            </div>
          ) : viewMode === "user" ? (
            <div className={styles.iconRow}>
              <button
                type="button"
                className={`${styles.iconBtnOutline} ${
                  isFav ? styles.heartFilled : ""
                }`}
                onClick={handleFav}
                title={
                  isFav
                    ? "Elimină din favorite"
                    : "Adaugă la favorite"
                }
                aria-pressed={!!isFav}
                aria-label={
                  isFav
                    ? "Elimină din favorite"
                    : "Adaugă la favorite"
                }
              >
                {isFav ? (
                  <FaHeart />
                ) : (
                  <FaRegHeart />
                )}
              </button>
              <button
                type="button"
                className={styles.iconBtn}
                onClick={handleCart}
                title={
                  isDisabled
                    ? "Produs indisponibil"
                    : isSoldOut
                    ? "Epuizat"
                    : "Adaugă în coș"
                }
                aria-label={
                  isDisabled
                    ? "Produs indisponibil"
                    : isSoldOut
                    ? "Epuizat"
                    : "Adaugă în coș"
                }
                disabled={isDisabled || isSoldOut}
              >
                <FaShoppingCart />
              </button>
            </div>
          ) : (
            <div className={styles.iconRow}>
              <button
                type="button"
                className={styles.iconBtnOutline}
                onClick={(e) => {
                  e.stopPropagation();
                  goTo(
                    `/autentificare?redirect=${encodeURIComponent(
                      href || "/"
                    )}`
                  );
                }}
                title="Autentifică-te pentru a salva la favorite"
                aria-label="Autentifică-te pentru a salva la favorite"
              >
                <FaRegHeart />
              </button>
              <button
                type="button"
                className={styles.iconBtn}
                onClick={(e) => {
                  e.stopPropagation();
                  goTo(
                    `/autentificare?redirect=${encodeURIComponent(
                      href || "/"
                    )}`
                  );
                }}
                title="Autentifică-te pentru a adăuga în coș"
                aria-label="Autentifică-te pentru a adăuga în coș"
              >
                <FaShoppingCart />
              </button>
            </div>
          )}
        </div>
      </div>
    </article>
  );
}
