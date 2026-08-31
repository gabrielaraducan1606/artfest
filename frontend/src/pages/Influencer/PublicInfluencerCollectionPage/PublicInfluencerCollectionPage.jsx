import {
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  Link,
  useParams,
} from "react-router-dom";

import { api } from "../../../lib/api.js";

import ProductCard from "../../Vendor/ProfilMagazin/components/ProductCard";

import { SEO } from "../../../components/Seo/SeoProvider";

import styles from "../../Products/Products.module.css";

export default function PublicInfluencerCollectionPage() {
  const { slug } =
    useParams();

  const [
    collection,
    setCollection,
  ] = useState(null);

  const [
    products,
    setProducts,
  ] = useState([]);

  const [
    loading,
    setLoading,
  ] = useState(true);

  const [
    error,
    setError,
  ] = useState("");

  /* =========================================================
     LOAD COLLECTION
  ========================================================= */

  useEffect(() => {
    let active = true;

    async function loadCollection() {
      if (!slug) {
        setError(
          "Colecția nu a fost găsită."
        );

        setLoading(false);

        return;
      }

      setLoading(true);
      setError("");

      try {
        const data =
          await api(
            `/api/influencer/collections/public/${encodeURIComponent(
              slug
            )}`
          );

        if (!active) {
          return;
        }

        if (
          data?.ok === false
        ) {
          throw Object.assign(
            new Error(
              data?.message ||
                "Colecția nu a fost găsită."
            ),
            {
              data,
            }
          );
        }

        const nextCollection =
          data?.collection ||
          null;

        if (!nextCollection) {
          throw new Error(
            "Colecția nu a fost găsită."
          );
        }

        setCollection(
          nextCollection
        );

        setProducts(
          Array.isArray(
            nextCollection.products
          )
            ? nextCollection.products
            : []
        );
      } catch (loadError) {
        if (!active) {
          return;
        }

        console.error(
          "[PublicInfluencerCollectionPage] load error:",
          loadError
        );

        setCollection(null);
        setProducts([]);

        setError(
          loadError?.data?.message ||
            loadError?.message ||
            "Nu am putut încărca această colecție."
        );
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    loadCollection();

    return () => {
      active = false;
    };
  }, [slug]);

  /* =========================================================
     SEO
  ========================================================= */

  const title =
    collection?.title
      ? `${collection.title} | Selecție Artfest`
      : "Selecție Artfest";

  const description =
    collection?.description ||
    (
      collection?.influencer
        ?.displayName
        ? `Descoperă selecția de produse Artfest recomandată de ${collection.influencer.displayName}.`
        : "Descoperă o selecție de produse handmade și cadouri de pe Artfest."
    );

  const canonical =
    `https://www.artfest.ro/selectii/${slug || ""}`;

  const heroImage =
    collection?.coverImage ||
    products?.[0]
      ?.images?.[0] ||
    undefined;

  /* =========================================================
     PRODUCT CARDS
  ========================================================= */

  const productCards =
    useMemo(() => {
      return products.map(
        (product) => (
          <ProductCard
            key={
              product.id
            }
            p={
              product
            }
            viewMode="guest"
            isFav={false}
            onAddToCart={() => {
              window.dispatchEvent(
                new CustomEvent(
                  "cart:add-product",
                  {
                    detail: {
                      productId:
                        product.id,
                    },
                  }
                )
              );
            }}
            onToggleFavorite={() => {}}
            categoryLabelMap={{}}
          />
        )
      );
    }, [products]);

  /* =========================================================
     LOADING
  ========================================================= */

  if (loading) {
    return (
      <section
        className={
          styles.page
        }
        style={{
          minHeight:
            "60vh",
          display:
            "grid",
          placeItems:
            "center",
        }}
      >
        <div
          style={{
            textAlign:
              "center",
          }}
        >
          <div
            style={{
              fontSize:
                28,
              marginBottom:
                10,
            }}
          >
            ✦
          </div>

          Se încarcă selecția…
        </div>
      </section>
    );
  }

  /* =========================================================
     NOT FOUND
  ========================================================= */

  if (
    error ||
    !collection
  ) {
    return (
      <section
        className={
          styles.page
        }
      >
        <SEO
          title="Selecția nu a fost găsită | Artfest"
          description="Această selecție nu este disponibilă."
          canonical={
            canonical
          }
          url={
            canonical
          }
        />

        <div
          style={{
            minHeight:
              "55vh",
            display:
              "flex",
            flexDirection:
              "column",
            justifyContent:
              "center",
            alignItems:
              "center",
            textAlign:
              "center",
            padding:
              "30px 16px",
          }}
        >
          <div
            style={{
              fontSize:
                42,
              marginBottom:
                12,
            }}
          >
            ✦
          </div>

          <h1
            style={{
              margin:
                "0 0 10px",
            }}
          >
            Selecția nu a fost găsită
          </h1>

          <p
            style={{
              maxWidth:
                500,
              color:
                "var(--color-text-muted, #6b7280)",
              lineHeight:
                1.6,
            }}
          >
            {error ||
              "Această selecție nu mai este disponibilă sau a fost ascunsă de creator."}
          </p>

          <Link
            to="/produse"
            className={
              styles.btnPrimary
            }
            style={{
              marginTop:
                12,
            }}
          >
            Vezi produsele Artfest
          </Link>
        </div>
      </section>
    );
  }

  const influencerName =
    collection
      ?.influencer
      ?.displayName ||
    "Creator Artfest";

  /* =========================================================
     PAGE
  ========================================================= */

  return (
    <section
      className={
        styles.page
      }
      style={{
        paddingBottom:
          110,
      }}
    >
      <SEO
        title={
          title
        }
        description={
          description
        }
        canonical={
          canonical
        }
        url={
          canonical
        }
        image={
          heroImage
        }
      />

      {/* =====================================================
          HERO
      ===================================================== */}

      <header
        className={
          styles.head
        }
      >
        <div
          className={
            styles.categoryHeroText
          }
        >
          <span
            className={
              styles.categoryEyebrow
            }
          >
            Selecție Artfest
          </span>

          <h1
            className={
              styles.h1
            }
          >
            {
              collection.title
            }
          </h1>

          <div
            style={{
              marginTop:
                10,
              display:
                "inline-flex",
              alignItems:
                "center",
              gap:
                8,
              padding:
                "7px 11px",
              borderRadius:
                999,
              background:
                "rgba(111, 78, 67, 0.08)",
              fontSize:
                13,
            }}
          >
            <span>
              ✦
            </span>

            <span>
              Recomandată de{" "}
              <strong>
                {
                  influencerName
                }
              </strong>
            </span>
          </div>

          {collection.description ? (
            <p
              className={
                styles.categoryIntro
              }
              style={{
                marginTop:
                  18,
                maxWidth:
                  760,
              }}
            >
              {
                collection.description
              }
            </p>
          ) : null}
        </div>

        {heroImage ? (
          <div
            style={{
              marginTop:
                22,
              position:
                "relative",
              overflow:
                "hidden",
              borderRadius:
                24,
              maxHeight:
                420,
            }}
          >
            <img
              src={
                heroImage
              }
              alt={
                collection.title
              }
              style={{
                width:
                  "100%",
                height:
                  "100%",
                maxHeight:
                  420,
                minHeight:
                  220,
                objectFit:
                  "cover",
                display:
                  "block",
              }}
            />

            <div
              style={{
                position:
                  "absolute",
                inset:
                  0,
                background:
                  "linear-gradient(to top, rgba(0,0,0,.18), transparent 55%)",
                pointerEvents:
                  "none",
              }}
            />
          </div>
        ) : null}
      </header>

      {/* =====================================================
          INFO
      ===================================================== */}

      <div
        style={{
          display:
            "flex",
          justifyContent:
            "space-between",
          alignItems:
            "center",
          gap:
            12,
          flexWrap:
            "wrap",
          margin:
            "26px 0 18px",
        }}
      >
        <div>
          <strong
            style={{
              fontSize:
                18,
            }}
          >
            Produse recomandate
          </strong>

          <div
            style={{
              marginTop:
                4,
              fontSize:
                13,
              color:
                "var(--color-text-muted, #6b7280)",
            }}
          >
            {products.length}{" "}
            {products.length ===
            1
              ? "produs ales"
              : "produse alese"}{" "}
            de{" "}
            {
              influencerName
            }
          </div>
        </div>

        {collection.visits !==
          undefined && (
          <div
            style={{
              fontSize:
                12,
              color:
                "var(--color-text-muted, #6b7280)",
            }}
          >
            {Number(
              collection.visits ||
                0
            ).toLocaleString(
              "ro-RO"
            )}{" "}
            vizite
          </div>
        )}
      </div>

      {/* =====================================================
          PRODUCTS
      ===================================================== */}

      {products.length ? (
        <div
          className={
            styles.grid
          }
        >
          {
            productCards
          }
        </div>
      ) : (
        <div
          className={
            styles.emptyState
          }
          style={{
            padding:
              "40px 20px",
            textAlign:
              "center",
          }}
        >
          <div
            style={{
              fontSize:
                34,
              marginBottom:
                10,
            }}
          >
            🛍️
          </div>

          <strong>
            Selecția este momentan goală
          </strong>

          <p
            style={{
              margin:
                "7px 0 0",
            }}
          >
            Influencerul nu a adăugat încă produse în această selecție.
          </p>
        </div>
      )}

      {/* =====================================================
          FOOTER INFO
      ===================================================== */}

      <section
        style={{
          marginTop:
            48,
          padding:
            22,
          border:
            "1px solid var(--color-border, #e5e7eb)",
          borderRadius:
            18,
          background:
            "var(--color-surface, #fff)",
        }}
      >
        <div
          style={{
            fontSize:
              13,
            color:
              "var(--color-text-muted, #6b7280)",
            lineHeight:
              1.65,
          }}
        >
          <strong
            style={{
              display:
                "block",
              marginBottom:
                5,
              color:
                "var(--color-text, #111827)",
            }}
          >
            Despre această selecție
          </strong>

          Produsele de mai sus sunt disponibile pe Artfest și au fost selectate de{" "}
          <strong>
            {
              influencerName
            }
          </strong>
          . Prețurile, disponibilitatea și opțiunile de personalizare sunt cele afișate în pagina fiecărui produs.
        </div>
      </section>

      {/* =====================================================
          FIXED CTA
      ===================================================== */}

      <div
        style={{
          position:
            "fixed",
          left:
            0,
          right:
            0,
          bottom:
            0,
          zIndex:
            40,
          background:
            "rgba(255,255,255,0.94)",
          backdropFilter:
            "blur(12px)",
          borderTop:
            "1px solid rgba(0,0,0,0.08)",
          padding:
            "12px 16px",
        }}
      >
        <div
          style={{
            maxWidth:
              1180,
            margin:
              "0 auto",
            display:
              "flex",
            gap:
              12,
            justifyContent:
              "center",
            alignItems:
              "center",
            flexWrap:
              "wrap",
          }}
        >
          <Link
            to="/produse"
            className={
              styles.btnPrimary
            }
          >
            Vezi toate produsele Artfest
          </Link>

          <Link
            to="/magazine"
            className={
              styles.btnPrimary
            }
          >
            Descoperă magazinele
          </Link>
        </div>
      </div>
    </section>
  );
}