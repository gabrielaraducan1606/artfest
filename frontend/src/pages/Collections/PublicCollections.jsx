import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../../lib/api.js";
import ProductCard from "../Vendor/ProfilMagazin/components/ProductCard";
import { SEO } from "../../components/Seo/SeoProvider";
import styles from "../Products/Products.module.css";

const LIMIT = 24;

export default function PublicCollectionPage() {
  const { slug } = useParams();

  const [collection, setCollection] = useState(null);
  const [items, setItems] = useState([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");

  const loadCollection = useCallback(
    async (pageToLoad = 1, append = false) => {
      if (!slug || loadingMore) return;

      if (pageToLoad === 1) setLoading(true);
      else setLoadingMore(true);

      setError("");

      try {
        const data = await api(
          `/api/public/collections/${encodeURIComponent(
            slug
          )}?page=${pageToLoad}&limit=${LIMIT}`
        );

        setCollection(data.collection || null);
        setItems((prev) =>
          append ? mergeUniqueById(prev, data.items || []) : data.items || []
        );
        setHasMore(!!data.hasMore);
        setPage(pageToLoad);
      } catch (e) {
        setError(e?.message || "Nu am putut încărca această colecție.");
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [slug, loadingMore]
  );

  useEffect(() => {
    setItems([]);
    setPage(1);
    setHasMore(false);
    setCollection(null);
    loadCollection(1, false);
  }, [slug, loadCollection]);

  const title = collection?.seoTitle || collection?.title || "Colecție Artfest";

  const description =
    collection?.seoDescription ||
    collection?.subtitle ||
    "Descoperă produse handmade și cadouri personalizate pe Artfest.";

  const canonical = `https://artfest.ro/colectii/${slug || ""}`;

  const productCards = useMemo(() => {
    return items.map((p) => (
      <ProductCard
        key={p.id}
        p={p}
        viewMode="guest"
        isFav={false}
        onAddToCart={() => {
          window.dispatchEvent(
            new CustomEvent("cart:add-product", {
              detail: { productId: p.id },
            })
          );
        }}
        onToggleFavorite={() => {}}
        categoryLabelMap={{}}
      />
    ));
  }, [items]);

  if (loading) {
    return <section className={styles.page}>Se încarcă colecția…</section>;
  }

  if (error || !collection) {
    return (
      <section className={styles.page}>
        <SEO
          title="Colecția nu a fost găsită | Artfest"
          description="Această colecție nu este disponibilă."
          canonical={canonical}
          url={canonical}
        />

        <h1>Colecția nu a fost găsită</h1>
        <p>{error || "Această colecție nu este disponibilă."}</p>
      </section>
    );
  }

  return (
    <section className={styles.page} style={{ paddingBottom: 110 }}>
      <SEO
        title={title}
        description={description}
        canonical={canonical}
        url={canonical}
        image={collection.heroImage || undefined}
      />

      <header className={styles.head}>
        <div className={styles.categoryHeroText}>
          <span className={styles.categoryEyebrow}>Artfest Marketplace</span>
          <h1 className={styles.h1}>{collection.title}</h1>

          {collection.subtitle ? (
            <p className={styles.categoryIntro}>{collection.subtitle}</p>
          ) : null}
        </div>

        {collection.heroImage ? (
          <img
            src={collection.heroImage}
            alt={collection.title}
            style={{
              width: "100%",
              maxHeight: 360,
              objectFit: "cover",
              borderRadius: 24,
              marginTop: 20,
            }}
          />
        ) : null}
      </header>

      {items.length ? (
        <div className={styles.grid}>{productCards}</div>
      ) : (
        <p className={styles.emptyState}>
          Momentan nu există produse în această colecție.
        </p>
      )}

      {collection.description ? (
        <section
          className={styles.categorySeoText}
          style={{ marginTop: 48 }}
          dangerouslySetInnerHTML={{ __html: collection.description }}
        />
      ) : null}

      <div
        style={{
          position: "fixed",
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 40,
          background: "rgba(255,255,255,0.94)",
          backdropFilter: "blur(12px)",
          borderTop: "1px solid rgba(0,0,0,0.08)",
          padding: "12px 16px",
        }}
      >
        <div
          style={{
            maxWidth: 1180,
            margin: "0 auto",
            display: "flex",
            gap: 12,
            justifyContent: "center",
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          {hasMore ? (
            <button
              type="button"
              className={styles.btnPrimary}
              disabled={loadingMore}
              onClick={() => loadCollection(page + 1, true)}
            >
              {loadingMore ? "Se încarcă…" : "Vezi mai multe produse"}
            </button>
          ) : (""
          )}

          <Link to="/produse" className={styles.btnPrimary}>
            Vezi toate produsele Artfest
          </Link>
        </div>
      </div>
    </section>
  );
}

function mergeUniqueById(prev, next) {
  const map = new Map();

  for (const item of prev) {
    if (item?.id) map.set(item.id, item);
  }

  for (const item of next) {
    if (item?.id) map.set(item.id, item);
  }

  return Array.from(map.values());
}