import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";

import { api } from "../../lib/api.js";
import {
  REF_PARAM,
  VENDOR_COLLECTION_PARAM,
  captureVendorCollectionSlug,
} from "../../utils/referralMemory.js";
import ProductCard from "../Vendor/ProfilMagazin/components/ProductCard";
import { SEO } from "../../components/Seo/SeoProvider";
import styles from "../Products/Products.module.css";
import own from "./PublicVendorCollectionPage.module.css";

/*
 * Pagina publică minimă a unei VendorCollection (/colectie-vendor/:slug).
 *
 * Atribuire REQUEST-BASED, fără localStorage / cookie / token / click
 * tracking / consimțământ (utils/referralMemory.js):
 *  - fără ?ref= în URL -> slug-ul colecției intră în memoria comună de
 *    referral (vendorCollectionSlugs); linkurile produselor poartă ?vcol=
 *    (tab nou / refresh pe produs păstrează contextul);
 *  - cu ?ref= explicit -> rămâne click-ul explicit (InfluencerAttributionCapture),
 *    propagat pe linkurile produselor; colecția nu se suprapune.
 * Serverul atribuie colecția DOAR produselor efectiv membre, per item
 * (own-sale pentru produsele ownerului, referral pentru ale altor vendori).
 */
export default function PublicVendorCollectionPage() {
  const { slug } = useParams();
  const [searchParams] = useSearchParams();

  const [collection, setCollection] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [me, setMe] = useState(null);

  // viewMode pentru ProductCard ("user" vs "guest"), ca în PublicCampaignPage
  useEffect(() => {
    let alive = true;

    api("/api/auth/me")
      .then((res) => {
        if (alive) setMe(res?.__unauth ? null : res?.user || null);
      })
      .catch(() => {
        if (alive) setMe(null);
      });

    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    setLoading(true);
    setError("");
    setCollection(null);

    api(`/api/public/vendor-collections/${encodeURIComponent(slug || "")}`)
      .then((res) => {
        if (cancelled) return;
        if (!res?.collection) throw new Error("Colecția nu a fost găsită.");
        setCollection(res.collection);
      })
      .catch((e) => {
        if (!cancelled) setError(e?.message || "Această colecție nu este disponibilă.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [slug]);

  const urlRef = String(searchParams.get(REF_PARAM) || "").trim();
  // în afara intervalului startsAt / endsAt (isLive=false) nu pornim atribuirea
  const collectionSlug = collection?.isLive === false ? null : collection?.slug || null;

  // colecția validă (serverul a răspuns 200) -> memoria aplicației, doar fără ?ref= explicit
  useEffect(() => {
    if (urlRef || !collectionSlug) return;
    captureVendorCollectionSlug(collectionSlug);
  }, [urlRef, collectionSlug]);

  const productLinkQuery = urlRef
    ? `${REF_PARAM}=${encodeURIComponent(urlRef)}`
    : collectionSlug
      ? `${VENDOR_COLLECTION_PARAM}=${encodeURIComponent(collectionSlug)}`
      : "";

  const viewMode = me ? "user" : "guest";
  const products = useMemo(
    () => (Array.isArray(collection?.products) ? collection.products : []),
    [collection]
  );

  const productCards = useMemo(
    () =>
      products.map((p) => {
        // sellerul REAL al produsului (poate fi alt magazin decât ownerul colecției)
        const sellerName =
          p?.service?.profile?.displayName || p?.service?.title || p?.service?.vendor?.displayName || null;
        const sellerSlug = p?.service?.profile?.slug || null;

        return (
          <div key={p.id} className={own.productCell}>
            <ProductCard
              p={p}
              viewMode={viewMode}
              isFav={false}
              categoryLabelMap={{}}
              linkQuery={productLinkQuery}
            />
            {sellerName ? (
              <p className={own.seller}>
                Vândut de{" "}
                {sellerSlug ? <Link to={`/magazin/${sellerSlug}`}>{sellerName}</Link> : sellerName}
              </p>
            ) : null}
          </div>
        );
      }),
    [products, viewMode, productLinkQuery]
  );

  const canonical = `https://www.artfest.ro/colectie-vendor/${slug || ""}`;

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
        <p>{error || "Această colecție nu este disponibilă momentan."}</p>
        <Link to="/" className={styles.btnPrimary}>
          Mergi la Artfest
        </Link>
      </section>
    );
  }

  const ownerName = collection.vendor?.displayName || "Artfest";

  return (
    <section className={styles.page} style={{ paddingBottom: 110 }}>
      <SEO
        title={`${collection.title} — ${ownerName} | Artfest`}
        description={
          collection.description ||
          `Descoperă selecția de produse recomandată de ${ownerName} pe Artfest.`
        }
        canonical={canonical}
        url={canonical}
        image={collection.coverImage || undefined}
      />

      <header className={styles.head}>
        <div className={styles.categoryHeroText}>
          <span className={styles.categoryEyebrow}>Colecție · {ownerName}</span>
          <h1 className={styles.h1}>{collection.title}</h1>
          {collection.description ? (
            <p className={styles.categoryIntro}>{collection.description}</p>
          ) : null}
          {collection.isLive && Number(collection.discountPercent) > 0 ? (
            <p className={own.discountNote}>
              {collection.discountPercent}% reducere la produsele {ownerName} din această colecție
              (prețurile afișate includ deja reducerea).
            </p>
          ) : null}
          {collection.status === "SCHEDULED" ? (
            <p className={own.statusNote}>Colecția începe în curând - reducerea nu este încă activă.</p>
          ) : null}
          {collection.status === "EXPIRED" ? (
            <p className={own.statusNote}>Perioada colecției s-a încheiat - reducerea nu mai este activă.</p>
          ) : null}
        </div>

        {collection.coverImage ? (
          <img
            src={collection.coverImage}
            alt={collection.title}
            className={own.cover}
          />
        ) : null}
      </header>

      {products.length ? (
        <div className={styles.grid}>{productCards}</div>
      ) : (
        <p className={styles.emptyState}>Momentan nu există produse disponibile în această colecție.</p>
      )}
    </section>
  );
}
