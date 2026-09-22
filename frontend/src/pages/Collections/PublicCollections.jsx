import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { api } from "../../lib/api.js";
import ProductCard from "../Vendor/ProfilMagazin/components/ProductCard";
import { SEO } from "../../components/Seo/SeoProvider";
import styles from "../Products/Products.module.css";
import { resolveFileUrl } from "../Vendor/Produse/hooks/urlUtils.js";
/*
 * Sursă unică cu funcția Vercel /api/seo-colectie (HTML brut pentru boți):
 * canonical/title/description/JSON-LD identice în HTML-ul brut și în DOM.
 * SeoProvider elimină JSON-LD-ul injectat server-side la mount, deci
 * pagina îl re-emite cu exact aceleași date.
 */
import {
  COLLECTION_PAGE_SIZE,
  buildCollectionStructuredData,
  collectionBreadcrumbs,
  collectionCanonicalUrl,
  collectionSeoDescription,
  collectionSeoTitle,
} from "../../utils/seo/collectionSeo.js";
import { paginationLinks, parsePage } from "../../utils/seo/pagination.js";
import Breadcrumbs from "../../components/Breadcrumbs/Breadcrumbs.jsx";
import PageLinks from "../../components/Pagination/PageLinks.jsx";
import { sanitizeHtml } from "../../utils/sanitizeHtml.js";
import { buildCollectionIntro } from "./collectionContent.js";

// Produse pe o pagină = aceeași valoare ca în funcția Vercel
// /api/seo-colectie, ca ?page=N să fie aceeași felie în HTML-ul brut și aici.
const LIMIT = COLLECTION_PAGE_SIZE;

export default function PublicCollectionPage() {
  const { slug } = useParams();

  /*
   * Paginare crawlabilă: ?page=N. Infinite scroll-ul rămâne (produsele
   * următoare se adaugă sub cele curente), dar pagina de START vine din URL:
   * ?page=3 afișează produsele paginii 3, nu începe mereu de la 1. Valori
   * invalide (0, negative, NaN...) => pagina 1.
   */
  const [searchParams] = useSearchParams();
  const startPage = parsePage(searchParams.get("page")).page;

  const [collection, setCollection] = useState(null);
  const [items, setItems] = useState([]);
  const [page, setPage] = useState(startPage);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");

  const loadMoreRef = useRef(null);
  const loadingMoreRef = useRef(false);

  const loadCollection = useCallback(
    async (pageToLoad = 1, append = false) => {
      if (!slug || loadingMoreRef.current) return;

      if (!append) {
        setLoading(true);
      } else {
        setLoadingMore(true);
        loadingMoreRef.current = true;
      }

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
        loadingMoreRef.current = false;
      }
    },
    [slug]
  );

  // (re)încarcă de la pagina de START din URL când se schimbă colecția sau
  // ?page= (linkurile Pagina anterioară/următoare).
  useEffect(() => {
    setItems([]);
    setPage(startPage);
    setHasMore(false);
    setCollection(null);
    loadingMoreRef.current = false;
    loadCollection(startPage, false);
  }, [slug, startPage, loadCollection]);

  useEffect(() => {
    if (!hasMore || loading || loadingMore) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          loadCollection(page + 1, true);
        }
      },
      { rootMargin: "350px" }
    );

    const el = loadMoreRef.current;
    if (el) observer.observe(el);

    return () => {
      if (el) observer.unobserve(el);
    };
  }, [hasMore, loading, loadingMore, page, loadCollection]);

  // Pagina 1: "Titlu"; pagina N>1: "Titlu - Pagina N".
  const title = collectionSeoTitle(collection, startPage) || "Colecție Artfest";

  const description = collectionSeoDescription(collection);

  // Slug-ul real al colecției (API-ul caută case-insensitive), nu cel din
  // URL: /colectii/Nunta și /colectii/nunta au același canonical. Pagina 1 =>
  // fără query; pagina N>1 => ?page=N (propriu, NU spre pagina 1).
  const canonical = collectionCanonicalUrl(collection?.slug || slug, startPage);

  // Produsele PAGINII de start (primele LIMIT din listă; cele adăugate de
  // infinite scroll vin după și nu intră în ItemList).
  const pageItems = useMemo(() => items.slice(0, LIMIT), [items]);

  // CollectionPage (+ ItemList al paginii) + BreadcrumbList - aceeași sursă
  // ca HTML-ul brut din /api/seo-colectie.
  const jsonLd = useMemo(
    () =>
      buildCollectionStructuredData({
        collection,
        items: pageItems,
        page: startPage,
        resolveImage: resolveFileUrl,
      }),
    [collection, pageItems, startPage]
  );

  // Linkuri reale Pagina anterioară / Pagina următoare. "Următoarea" există
  // dacă backend-ul mai are produse SAU pagina următoare a fost deja
  // încărcată de infinite scroll.
  const pager = useMemo(
    () =>
      paginationLinks({
        basePath: `/colectii/${encodeURIComponent(collection?.slug || slug || "")}`,
        page: startPage,
        hasNext: items.length > LIMIT || hasMore,
      }),
    [collection?.slug, slug, startPage, items.length, hasMore]
  );

  const breadcrumbs = useMemo(
    () => (collection ? collectionBreadcrumbs(collection) : []),
    [collection]
  );

  // Text scurt sus (fără duplicări) + descrierea lungă, sanitizată, jos.
  const intro = useMemo(
    () => buildCollectionIntro(collection || {}),
    [collection]
  );

  const safeBodyHtml = useMemo(
    () => sanitizeHtml(intro.bodyHtml),
    [intro.bodyHtml]
  );

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
        jsonLd={jsonLd}
      />

      <header className={styles.head}>
        <Breadcrumbs
          items={breadcrumbs.map(({ name, to }) => ({ name, to }))}
        />

        <div className={styles.categoryHeroText}>
          <span className={styles.categoryEyebrow}>Artfest Marketplace</span>
          <h1 className={styles.h1}>{collection.title}</h1>

          {intro.lead ? (
            <p className={styles.categoryIntro}>{intro.lead}</p>
          ) : null}

          {intro.detail ? (
            <p className={styles.categoryIntro}>{intro.detail}</p>
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
      ) : startPage > 1 ? (
        // ?page=N dincolo de ultima pagină: mesaj + cale înapoi (pagina 1)
        <p className={styles.emptyState}>
          Nu există produse pe această pagină.{" "}
          <Link to={`/colectii/${encodeURIComponent(collection.slug)}`}>
            Înapoi la prima pagină
          </Link>
        </p>
      ) : (
        <p className={styles.emptyState}>
          Momentan nu există produse în această colecție.
        </p>
      )}

      <div ref={loadMoreRef} style={{ height: 1 }} />

      {loadingMore ? (
        <p style={{ textAlign: "center", marginTop: 24 }}>
          Se încarcă mai multe produse…
        </p>
      ) : null}

      <PageLinks
        prev={pager.prev}
        next={pager.next}
        currentPage={startPage}
      />

      {safeBodyHtml ? (
        <section
          className={styles.categorySeoText}
          style={{ marginTop: 48 }}
          aria-label={`Despre ${collection.title}`}
        >
          <h2>Despre această colecție</h2>
          {/* HTML reconstruit din tokeni pe listă albă (utils/sanitizeHtml.js) */}
          <div dangerouslySetInnerHTML={{ __html: safeBodyHtml }} />
        </section>
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
          ) : null}

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