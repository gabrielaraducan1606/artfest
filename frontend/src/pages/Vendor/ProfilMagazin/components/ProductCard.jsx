import React, {
  useMemo,
  useCallback,
  useState,
  useRef,
  useEffect,
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
import { resolveFileUrl } from "../hooks/useProfilMagazin";
import { api } from "../../../../lib/api";

const humanizeSlug = (slug = "", { dropPrefix = false } = {}) => {
  if (!slug || typeof slug !== "string") return "";
  let s = slug;
  if (dropPrefix) s = s.replace(/^[^_]+_/, "");
  return s.replace(/[_-]+/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
};

const LOCAL_COLOR_LABELS = {
  white: "Alb",
  ivory: "Ivory / ivoire",
  cream: "Crem",
  beige: "Bej",
  grey_light: "Gri deschis",
  grey_dark: "Gri închis",
  black: "Negru",
  brown_light: "Maro deschis",
  brown: "Maro",
  brown_dark: "Maro închis",
  taupe: "Taupe",
  red: "Roșu",
  burgundy: "Burgundy / vișiniu",
  pink_light: "Roz deschis",
  pink_dusty: "Roz pudră",
  pink_hot: "Roz aprins",
  lilac: "Lila",
  purple: "Mov",
  yellow: "Galben",
  mustard: "Muștar",
  orange: "Portocaliu",
  peach: "Piersică",
  blue_light: "Albastru deschis",
  blue: "Albastru",
  blue_royal: "Albastru regal",
  navy: "Bleumarin",
  turquoise: "Turcoaz",
  teal: "Teal",
  green_light: "Verde deschis",
  green: "Verde",
  green_olive: "Verde olive",
  green_dark: "Verde închis",
  mint: "Mentă",
  gold: "Auriu",
  rose_gold: "Rose gold",
  silver: "Argintiu",
  copper: "Cupru",
  transparent: "Transparent",
  multicolor: "Multicolor",
};

function moderationMeta(status) {
  switch (String(status || "PENDING").toUpperCase()) {
    case "APPROVED":
      return { label: "Aprobat", tone: "success" };
    case "CHANGES_REQUESTED":
      return { label: "Necesită modificări", tone: "warning" };
    case "REJECTED":
      return { label: "Respins", tone: "danger" };
    case "PENDING":
    default:
      return { label: "În verificare", tone: "info" };
  }
}

function badgeToneClass(tone) {
  if (tone === "danger") return styles.badgeDanger;
  if (tone === "warning") return styles.badgeWarning;
  if (tone === "info") return styles.badgeInfo;
  if (tone === "success") return styles.badgeSuccess;
  return "";
}

function ProductCard({
  p,
  viewMode,
  isFav,
  navigate,
  onToggleFavorite,
  onAddToCart,
  onEdit,
  onDelete,
  categoryLabelMap,
  categoryGroupLabelMap,
  colorLabelMap,
  onEditProduct,
  vendorActionsOverride,
}) {
  const nav = useNavigate();
  const loc = useLocation();
  const go = navigate || nav;

  const [idx, setIdx] = useState(0);
  const [deleting, setDeleting] = useState(false);
  const [favBusy, setFavBusy] = useState(false);
  const [cartBusy, setCartBusy] = useState(false);
  const [localFav, setLocalFav] = useState(!!isFav);

  const touchStartX = useRef(null);
  const prefetchedRef = useRef(false);

  const isLoggedIn = viewMode === "user" || viewMode === "vendor";

  useEffect(() => {
    setLocalFav(!!isFav);
  }, [isFav]);

  const safe = useMemo(() => {
    const images = Array.isArray(p?.images) ? p.images : [];

    const readyQtyRaw = p?.readyQty;
    const readyQty =
      readyQtyRaw === null || readyQtyRaw === undefined || readyQtyRaw === ""
        ? null
        : Number.isFinite(Number(readyQtyRaw))
        ? Number(readyQtyRaw)
        : null;

    const availability =
      typeof p?.availability === "string" ? p.availability.toUpperCase() : null;

    const priceCentsRaw =
      typeof p?.priceCents === "number"
        ? p.priceCents
        : Number.isFinite(Number(p?.priceCents))
        ? Number(p.priceCents)
        : null;

    let price = null;
    if (typeof p?.price === "number") {
      price = p.price;
    } else if (priceCentsRaw != null) {
      price = priceCentsRaw / 100;
    } else if (Number.isFinite(Number(p?.price))) {
      price = Number(p.price);
    }

    return {
      id: p?.id || p?._id || "",
      title: p?.title || "Produs",
      images,
      price,
      priceCents: priceCentsRaw,
      currency: p?.currency || "RON",
      category: p?.category || null,
      color: p?.color || null,
      isActive: p?.isActive !== false,
      isHidden: !!p?.isHidden,
      moderationStatus: String(p?.moderationStatus || "PENDING").toUpperCase(),
      moderationMessage: p?.moderationMessage || null,
      availability,
      leadTimeDays: Number.isFinite(Number(p?.leadTimeDays))
        ? Number(p.leadTimeDays)
        : null,
      readyQty,
      acceptsCustom: !!p?.acceptsCustom,
      nextShipDate: p?.nextShipDate || null,
    };
  }, [p]);

  const href = safe.id ? `/produs/${safe.id}${loc.search || ""}` : null;

  const imgCount = safe.images.length;
  const activeIndex = imgCount ? Math.min(idx, imgCount - 1) : 0;

  const resolvedImages = useMemo(() => {
    return safe.images.map((img) => {
      const src = resolveFileUrl(img);
      return src || "";
    });
  }, [safe.images]);

  const imgSrc = useMemo(() => {
    const src = resolvedImages[activeIndex];
    return src || productPlaceholder(600, 450, "Produs");
  }, [resolvedImages, activeIndex]);

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

  const nextShipDateLabel = useMemo(() => {
    if (!safe.nextShipDate) return null;
    try {
      return new Date(safe.nextShipDate).toLocaleDateString("ro-RO");
    } catch {
      return null;
    }
  }, [safe.nextShipDate]);

  const catKey = safe.category;
  const catGroupKey = catKey ? catKey.split("_")[0] || null : null;

  const catLabel = useMemo(() => {
    if (!catKey) return null;
    if (categoryLabelMap?.[catKey]) return categoryLabelMap[catKey];
    return humanizeSlug(catKey, { dropPrefix: true });
  }, [catKey, categoryLabelMap]);

  const catGroupLabel = useMemo(() => {
    if (!catGroupKey) return null;
    if (categoryGroupLabelMap?.[catGroupKey]) {
      return categoryGroupLabelMap[catGroupKey];
    }
    return humanizeSlug(catGroupKey);
  }, [catGroupKey, categoryGroupLabelMap]);

  const colorLabel = useMemo(() => {
    if (!safe.color) return null;
    if (colorLabelMap?.[safe.color]) return colorLabelMap[safe.color];
    if (LOCAL_COLOR_LABELS[safe.color]) return LOCAL_COLOR_LABELS[safe.color];
    return safe.color;
  }, [safe.color, colorLabelMap]);

  const isSoldOut =
    safe.availability === "SOLD_OUT" ||
    (safe.availability === "READY" && safe.readyQty === 0);

  const isApproved = safe.moderationStatus === "APPROVED";

  const isDisabled =
    viewMode === "vendor"
      ? false
      : !safe.isActive || safe.isHidden || !isApproved;

  const moderation = useMemo(
    () => moderationMeta(safe.moderationStatus),
    [safe.moderationStatus]
  );

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

  const goTo = useCallback(
    (path) => {
      if (path) go(path);
    },
    [go]
  );

  const goLogin = useCallback(() => {
    goTo(`/autentificare?redirect=${encodeURIComponent(href || "/")}`);
  }, [goTo, href]);

 const prefetchProduct = useCallback(() => {
  if (!safe.id || prefetchedRef.current) return;

  // Nu prefetch public pentru produse care nu sunt publice
  if (viewMode === "vendor" || isDisabled) return;

  prefetchedRef.current = true;

  api(`/api/public/products/${encodeURIComponent(safe.id)}`).catch(() => {});

  if (resolvedImages[0]) {
    const hero = new Image();
    hero.decoding = "async";
    hero.src = resolvedImages[0];
  }

  if (resolvedImages[1]) {
    const second = new Image();
    second.decoding = "async";
    second.src = resolvedImages[1];
  }
}, [safe.id, resolvedImages, viewMode, isDisabled]);

  useEffect(() => {
    prefetchedRef.current = false;
  }, [safe.id]);

  const handleOpenProduct = useCallback(
    (e) => {
      if (!href || isDisabled) return;
      e?.preventDefault?.();
      goTo(href);
    },
    [href, isDisabled, goTo]
  );

  const handleFav = useCallback(
    async (e) => {
      e?.stopPropagation?.();
      if (!safe.id || favBusy) return;

      if (!isLoggedIn) {
        goLogin();
        return;
      }

      if (typeof onToggleFavorite === "function") {
        onToggleFavorite(safe.id, !localFav);
        return;
      }

      const prev = localFav;
      setLocalFav(!prev);
      setFavBusy(true);

      try {
        const r = await api("/api/favorites/toggle", {
          method: "POST",
          body: { productId: safe.id },
        });

        if (r?.error === "cannot_favorite_own_product") {
          setLocalFav(prev);
          alert("Nu poți adăuga la favorite un produs care îți aparține.");
          return;
        }
      } catch (err) {
        setLocalFav(prev);
        const msg =
          err?.message ||
          (err?.status === 403
            ? "Nu poți adăuga la favorite un produs care îți aparține."
            : "Nu am putut actualiza favoritele.");
        alert(msg);
      } finally {
        setFavBusy(false);
      }
    },
    [safe.id, favBusy, isLoggedIn, goLogin, onToggleFavorite, localFav]
  );

  const handleCart = useCallback(
    async (e) => {
      e?.stopPropagation?.();
      if (!safe.id || isDisabled || isSoldOut || cartBusy) return;

      if (!isLoggedIn) {
        goLogin();
        return;
      }

      if (typeof onAddToCart === "function") {
        onAddToCart(safe.id);
        return;
      }

      try {
        setCartBusy(true);

        const r = await api("/api/cart/add", {
          method: "POST",
          body: { productId: safe.id, qty: 1 },
        });

        if (r?.error === "cannot_add_own_product") {
          alert("Nu poți adăuga în coș propriul produs.");
          return;
        }

        try {
          window.dispatchEvent(new CustomEvent("cart:changed"));
        } catch {
          /* ignore */
        }

        alert("Produs adăugat în coș.");
      } catch (err) {
        const msg =
          err?.message ||
          (err?.status === 403
            ? "Nu poți adăuga în coș propriul produs."
            : "Nu am putut adăuga în coș.");
        alert(msg);
      } finally {
        setCartBusy(false);
      }
    },
    [safe.id, isDisabled, isSoldOut, cartBusy, isLoggedIn, goLogin, onAddToCart]
  );

  const handleEdit = useCallback(
    (e) => {
      e?.stopPropagation?.();
      if (!safe.id) return;
      if (typeof onEditProduct === "function") {
        onEditProduct(p);
        return;
      }
      if (typeof onEdit === "function") {
        onEdit(p);
      }
    },
    [safe.id, onEditProduct, onEdit, p]
  );

  const handleDelete = useCallback(
    async (e) => {
      e?.stopPropagation?.();
      if (!safe.id || deleting) return;

      if (typeof onDelete === "function") {
        onDelete(safe.id);
        return;
      }

      if (!window.confirm("Sigur vrei să ștergi acest produs?")) return;

      try {
        setDeleting(true);
        await api(`/api/vendor/products/${encodeURIComponent(safe.id)}`, {
          method: "DELETE",
        });
        alert("Produs șters.");
      } catch (err) {
        alert(err?.message || "Nu am putut șterge produsul.");
      } finally {
        setDeleting(false);
      }
    },
    [safe.id, deleting, onDelete]
  );

  const next = useCallback(
    (e) => {
      e?.stopPropagation?.();
      if (imgCount <= 1) return;
      setIdx((i) => (i + 1) % imgCount);
    },
    [imgCount]
  );

  const prev = useCallback(
    (e) => {
      e?.stopPropagation?.();
      if (imgCount <= 1) return;
      setIdx((i) => (i - 1 + imgCount) % imgCount);
    },
    [imgCount]
  );

  const onTouchStart = useCallback((e) => {
    touchStartX.current = e.changedTouches?.[0]?.clientX ?? null;
  }, []);

  const onTouchEnd = useCallback(
    (e) => {
      const startX = touchStartX.current;
      const endX = e.changedTouches?.[0]?.clientX ?? null;
      if (startX == null || endX == null) return;

      const dx = endX - startX;
      if (Math.abs(dx) > 40) {
        if (dx < 0) next();
        else prev();
      }
      touchStartX.current = null;
    },
    [next, prev]
  );

  if (!safe.id) return null;

  return (
    <article
      className={`${styles.card} ${isDisabled ? styles.cardInactive : ""}`}
      data-product-id={safe.id}
      aria-labelledby={`prod-title-${safe.id}`}
      role="group"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" && href) handleOpenProduct(e);
      }}
      onMouseEnter={prefetchProduct}
      onFocus={prefetchProduct}
      onTouchStart={prefetchProduct}
    >
      <div
        className={styles.media}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        <div className={styles.badges}>
          {!safe.isActive && (
            <span className={`${styles.badge} ${styles.badgeInactive}`}>
              Inactiv
            </span>
          )}

          {safe.isHidden && <span className={styles.badge}>Ascuns</span>}

          {viewMode === "vendor" && (
            <span
              className={`${styles.badge} ${badgeToneClass(moderation.tone)}`}
            >
              {moderation.label}
            </span>
          )}

          {status && (
            <span
              className={`${styles.badge} ${badgeToneClass(status.tone)}`}
            >
              {status.label}
            </span>
          )}

          {safe.acceptsCustom && (
            <span className={`${styles.badge} ${styles.badgeOutline}`}>
              Personalizabil
            </span>
          )}
        </div>

        {isSoldOut && (
          <div className={styles.soldOutOverlay} aria-hidden="true" />
        )}

        {imgCount > 1 && <span className={styles.badgeImgs}>{imgCount}</span>}

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
              width={600}
              height={450}
              sizes="(max-width: 480px) 45vw, (max-width: 1024px) 30vw, 280px"
              onError={(e) => onImgError(e, 600, 450, "Produs")}
            />
          </Link>
        ) : (
          <img
            src={imgSrc}
            alt={safe.title}
            className={styles.image}
            loading="lazy"
            decoding="async"
            width={600}
            height={450}
            sizes="(max-width: 480px) 45vw, (max-width: 1024px) 30vw, 280px"
            onError={(e) => onImgError(e, 600, 450, "Produs")}
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
              const active = i === activeIndex;
              return (
                <button
                  key={`dot-${safe.id}-${i}`}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  aria-label={`Imaginea ${i + 1} din ${imgCount}`}
                  className={`${styles.dot} ${active ? styles.dotActive : ""}`}
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
          id={`prod-title-${safe.id}`}
          className={styles.cardTitle}
          title={safe.title}
        >
          {href && !isDisabled ? (
            <Link
              to={href}
              onClick={handleOpenProduct}
              style={{ color: "inherit", textDecoration: "none" }}
            >
              {safe.title}
            </Link>
          ) : (
            safe.title
          )}
        </h4>

        {viewMode === "vendor" && safe.moderationMessage && (
          <p className={styles.moderationMessage}>
            Mesaj admin: {safe.moderationMessage}
          </p>
        )}

        {colorLabel && (
          <p className={styles.colorHint} title={safe.color || ""}>
            Culoare: <span className={styles.metaInline}>{colorLabel}</span>
          </p>
        )}

        <div className={styles.cardMetaRow}>
          <div className={styles.metaLeft}>
            {priceLabel != null && (
              <p className={styles.price} aria-label={`Preț ${priceLabel}`}>
                {priceLabel}
              </p>
            )}

            {safe.availability === "READY" && safe.readyQty != null && (
              <span className={styles.metaHint}>
                Stoc:{" "}
                <span className={styles.metaInline}>{safe.readyQty} buc</span>
              </span>
            )}

            {safe.availability === "MADE_TO_ORDER" && safe.leadTimeDays && (
              <span className={styles.metaHint}>
                Timp execuție:{" "}
                <span className={styles.metaInline}>
                  {safe.leadTimeDays} zile
                </span>
              </span>
            )}

            {safe.availability === "PREORDER" && nextShipDateLabel && (
              <span className={styles.metaHint}>
                Expediere:{" "}
                <span className={styles.metaInline}>{nextShipDateLabel}</span>
              </span>
            )}
          </div>

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
              {vendorActionsOverride ? (
                vendorActionsOverride
              ) : (
                <>
                  <button
                    type="button"
                    className={`${styles.ownerIconBtn} ${styles.ownerIconTip}`}
                    data-tip="Editează"
                    onClick={handleEdit}
                    aria-label="Editează produs"
                  >
                    <FaEdit />
                    <span className={styles.srOnly}>Editează</span>
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
                      {deleting ? "Se șterge…" : "Șterge"}
                    </span>
                  </button>
                </>
              )}
            </div>
          ) : viewMode === "user" ? (
            <div className={styles.iconRow}>
              <button
                type="button"
                className={`${styles.iconBtnOutline} ${
                  localFav ? styles.heartFilled : ""
                }`}
                onClick={handleFav}
                title={localFav ? "Elimină din favorite" : "Adaugă la favorite"}
                aria-pressed={!!localFav}
                aria-label={
                  localFav ? "Elimină din favorite" : "Adaugă la favorite"
                }
                disabled={favBusy}
              >
                {localFav ? <FaHeart /> : <FaRegHeart />}
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
                    : cartBusy
                    ? "Se adaugă…"
                    : "Adaugă în coș"
                }
                aria-label={
                  isDisabled
                    ? "Produs indisponibil"
                    : isSoldOut
                    ? "Epuizat"
                    : cartBusy
                    ? "Se adaugă…"
                    : "Adaugă în coș"
                }
                disabled={isDisabled || isSoldOut || cartBusy}
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
                  goLogin();
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
                  goLogin();
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

function areEqual(prevProps, nextProps) {
  return (
    prevProps.p === nextProps.p &&
    prevProps.viewMode === nextProps.viewMode &&
    prevProps.isFav === nextProps.isFav &&
    prevProps.navigate === nextProps.navigate &&
    prevProps.productsCacheT === nextProps.productsCacheT &&
    prevProps.onToggleFavorite === nextProps.onToggleFavorite &&
    prevProps.onAddToCart === nextProps.onAddToCart &&
    prevProps.onEdit === nextProps.onEdit &&
    prevProps.onDelete === nextProps.onDelete &&
    prevProps.onEditProduct === nextProps.onEditProduct &&
    prevProps.categoryLabelMap === nextProps.categoryLabelMap &&
    prevProps.categoryGroupLabelMap === nextProps.categoryGroupLabelMap &&
    prevProps.colorLabelMap === nextProps.colorLabelMap &&
    prevProps.vendorActionsOverride === nextProps.vendorActionsOverride
  );
}

export default React.memo(ProductCard, areEqual);