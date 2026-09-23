// src/pages/Vendor/Produse/components/DiscoverMoreProducts.jsx
//
// "Descoperă și alte produse pe Artfest" - a treia secțiune de jos din
// ProductDetails.jsx, DUPĂ "Produse similare" și "Mai multe din acest
// magazin". Scop: dacă userul continuă să dea scroll (sau primele
// două secțiuni au puține produse), să mai vadă produse din
// marketplace, ca să rămână în platformă.
//
// SELF-CONTAINED (spre deosebire de celelalte 2 secțiuni, ale căror
// fetch-uri trăiesc în ProductDetails.jsx): propriul IntersectionObserver
// + propriul fetch, declanșat DOAR când userul se apropie de secțiune
// (rootMargin generos) - nu afectează primul paint, nu pornește
// odată cu Produse similare/Mai multe din magazin. Reutilizează
// STRICT GET /api/public/products (același endpoint ca "Produse
// similare") - niciun endpoint nou.
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../../../lib/api.js";
import styles from "../ProductDetails.module.css";
import {
  productPlaceholder,
  onImgError,
} from "../../../../components/utils/imageFallback.js";
import { withCache, resolveFileUrl } from "../hooks/urlUtils.js";
import { buildDiscoverSelection } from "../hooks/discoverMoreScoring.js";

const CANDIDATE_POOL_LIMIT = 60; // cap existent pe backend (Math.min(60,...))
const SECTION_LIMIT = 16; // "maximum 12-16" - capătul superior cerut
const MAX_PER_VENDOR = 2;
const OBSERVER_ROOT_MARGIN = "600px 0px"; // fetch cu mult înainte să intre în viewport

function formatMoney(value, currency = "RON") {
  return new Intl.NumberFormat("ro-RO", {
    style: "currency",
    currency,
  }).format(value);
}

function DiscoverMoreProductsBase({ product, getExcludedIds, cacheT, navigate }) {
  const [items, setItems] = useState([]);
  // "idle" -> "loading" -> "done" | "error" - randăm ceva vizibil
  // DOAR în starea "done" cu produse găsite (nicio secțiune goală,
  // niciun skeleton permanent care să pară o secțiune "ruptă").
  const [status, setStatus] = useState("idle");

  const sectionRef = useRef(null);
  const fetchStartedRef = useRef(false);
  const mountedRef = useRef(true);
  const prefetchedRef = useRef(new Set());

  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    []
  );

  useEffect(() => {
    if (!product?.id || fetchStartedRef.current) return undefined;

    const el = sectionRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return undefined;

    const observer = new IntersectionObserver(
      (entries) => {
        if (fetchStartedRef.current) return;
        if (!entries.some((entry) => entry.isIntersecting)) return;

        fetchStartedRef.current = true;
        observer.disconnect();
        runFetch();
      },
      { root: null, rootMargin: OBSERVER_ROOT_MARGIN, threshold: 0 }
    );

    observer.observe(el);

    async function runFetch() {
      setStatus("loading");

      try {
        const params = new URLSearchParams();
        params.set("limit", String(CANDIDATE_POOL_LIMIT));
        params.set("sort", "popular");

        const res = await api(`/api/public/products?${params.toString()}`);
        if (!mountedRef.current) return;

        const pool = Array.isArray(res?.items) ? res.items : [];

        const excludeIds = new Set([product.id]);
        const extra = getExcludedIds ? getExcludedIds() : null;
        if (extra) {
          for (const id of extra) excludeIds.add(id);
        }

        const selection = buildDiscoverSelection({
          baseProduct: product,
          candidates: pool,
          excludeIds,
          maxPerVendor: MAX_PER_VENDOR,
          limit: SECTION_LIMIT,
        });

        setItems(selection);
        setStatus("done");
      } catch {
        if (mountedRef.current) setStatus("error");
      }
    }

    return () => observer.disconnect();
    // `product` citit doar în closure-ul lui runFetch (mereu ultima
    // valoare primită ca prop la momentul intersecției) - efectul
    // însuși nu trebuie să repornească la o revalidare de fundal cu
    // ACELAȘI id (ar recrea observer-ul degeaba).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product?.id, getExcludedIds]);

  const normalizedItems = useMemo(() => {
    return items.map((p) => {
      const imageSrc =
        Array.isArray(p.images) && p.images[0]
          ? withCache(resolveFileUrl(p.images[0]), cacheT)
          : productPlaceholder(480, 360, "Produs");

      const price =
        Number.isFinite(p.priceCents) && p.priceCents >= 0
          ? p.priceCents / 100
          : typeof p.price === "number"
            ? p.price
            : null;

      const badge =
        p.hasDiscount && p.discountPercent > 0
          ? { kind: "discount", label: `-${p.discountPercent}%` }
          : p.acceptsCustom
            ? { kind: "custom", label: "Personalizabil" }
            : null;

      return {
        ...p,
        imageSrc,
        price,
        formattedPrice:
          price != null ? formatMoney(price, p.currency || "RON") : null,
        storeName: p.storeName || p.service?.profile?.displayName || null,
        badge,
      };
    });
  }, [items, cacheT]);

  const prefetchProduct = useCallback((p) => {
    if (!p?.id) return;

    const key = String(p.id);
    if (prefetchedRef.current.has(key)) return;
    prefetchedRef.current.add(key);

    api(`/api/public/products/${encodeURIComponent(p.id)}`).catch(() => {});

    if (p.imageSrc) {
      const img = new Image();
      img.decoding = "async";
      img.src = p.imageSrc;
    }
  }, []);

  const handleNavigate = useCallback(
    (productId) => {
      if (!productId) return;
      navigate(`/produs/${productId}`);
    },
    [navigate]
  );

  // Sentinela pentru IntersectionObserver TREBUIE randată chiar dacă
  // nu avem încă produse (altfel observer-ul n-are ce urmări) - dar
  // fără conținut vizibil cât timp nu s-a încărcat nimic, ca să nu
  // apară o secțiune goală/un skeleton permanent.
  if (status !== "done" || normalizedItems.length === 0) {
    return <div ref={sectionRef} aria-hidden="true" className={styles.discoverSentinel} />;
  }

  return (
    <section
      ref={sectionRef}
      className={styles.discoverSec}
      aria-labelledby="discover-more-heading"
    >
      <h2 id="discover-more-heading" className={styles.sectionTitle}>
        Descoperă și alte produse pe Artfest
      </h2>

      <div className={styles.discoverGrid}>
        {normalizedItems.map((p) => (
          <button
            key={p.id}
            className={styles.relatedCard}
            onClick={() => handleNavigate(p.id)}
            onMouseEnter={() => prefetchProduct(p)}
            onFocus={() => prefetchProduct(p)}
            onTouchStart={() => prefetchProduct(p)}
            aria-label={`Vezi ${p.title}`}
            type="button"
          >
            <div className={styles.relImageWrap}>
              <img
                loading="lazy"
                decoding="async"
                src={p.imageSrc}
                alt={p.title || "Produs"}
                width={480}
                height={360}
                onError={(e) => onImgError(e, 480, 360, "Produs")}
              />

              {p.badge && (
                <span
                  className={`${styles.relBadge} ${
                    p.badge.kind === "discount" ? styles.relBadgeDiscount : ""
                  }`}
                >
                  {p.badge.label}
                </span>
              )}
            </div>

            <div className={styles.relBody}>
              {p.storeName && <div className={styles.relStore}>{p.storeName}</div>}

              <div className={styles.relTitle}>{p.title}</div>

              {p.formattedPrice && (
                <div className={styles.relPrice}>{p.formattedPrice}</div>
              )}
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}

export const DiscoverMoreProducts = React.memo(DiscoverMoreProductsBase);
