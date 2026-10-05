import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../../../lib/api.js";
import styles from "../ProfilMagazin.module.css";

/*
 * „Colecțiile magazinului” din profilul public - VendorCollection (conceptul
 * unic „Colecții”, care înlocuiește campaniile). Doar colecțiile active în
 * interval ale magazinului; click -> pagina canonică /colectie-vendor/:slug.
 * Fișierul își păstrează numele istoric (StoreCampaignCollections) ca să nu
 * mute importurile; afișează exclusiv VendorCollection.
 */
export default function StoreCampaignCollections({ storeSlug }) {
  const [collections, setCollections] = useState([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!storeSlug) return undefined;

    let alive = true;

    api(`/api/public/vendor-collections/store/${encodeURIComponent(storeSlug)}`)
      .then((data) => {
        if (alive) setCollections(Array.isArray(data?.collections) ? data.collections : []);
      })
      .catch(() => {
        if (alive) setCollections([]);
      })
      .finally(() => {
        if (alive) setLoaded(true);
      });

    return () => {
      alive = false;
    };
  }, [storeSlug]);

  // fără colecții active -> secțiunea nu se afișează deloc
  if (!loaded || !collections.length) return null;

  return (
    <section className={styles.storeCollections} aria-labelledby="store-collections-title">
      <div className={styles.storeCollectionsHeader}>
        <div>
          <span className={styles.storeCollectionsEyebrow}>Descoperă mai ușor</span>
          <h2 id="store-collections-title" className={styles.storeCollectionsTitle}>
            Colecțiile magazinului
          </h2>
        </div>

        {collections.length > 3 ? (
          <span className={styles.storeCollectionsCount}>{collections.length} colecții</span>
        ) : null}
      </div>

      <div className={styles.storeCollectionsGrid}>
        {collections.map((collection) => {
          const discountPercent = Number(collection.discountPercent || 0);

          return (
            <Link
              key={collection.id}
              to={`/colectie-vendor/${encodeURIComponent(collection.slug)}`}
              className={styles.storeCollectionCard}
            >
              <div className={styles.storeCollectionIcon}>
                {collection.coverImage ? (
                  <img
                    src={collection.coverImage}
                    alt=""
                    style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "inherit" }}
                  />
                ) : (
                  "📚"
                )}
              </div>

              <div className={styles.storeCollectionContent}>
                <div className={styles.storeCollectionTop}>
                  <strong>{collection.title || "Colecție"}</strong>

                  {discountPercent > 0 ? (
                    <span className={styles.storeCollectionDiscount}>-{discountPercent}%</span>
                  ) : null}
                </div>

                {collection.description ? (
                  <div className={styles.storeCollectionMeta}>{collection.description}</div>
                ) : null}

                <div className={styles.storeCollectionAction}>Vezi colecția →</div>
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
