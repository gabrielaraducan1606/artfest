import { useEffect, useMemo, useState } from "react";

import { SEO } from "../../components/Seo/SeoProvider";
import Breadcrumbs from "../../components/Breadcrumbs/Breadcrumbs.jsx";
import CollectionCards from "../Home/CollectionsSection/CollectionCards.jsx";
import { toCollectionCards } from "../Home/CollectionsSection/collectionCards.js";
import { fetchPublicCollections } from "../../hooks/usePublicCollections";
import { resolveFileUrl } from "../Vendor/Produse/hooks/urlUtils.js";
import {
  COLLECTIONS_INDEX_DESCRIPTION,
  COLLECTIONS_INDEX_TITLE,
  COLLECTIONS_INDEX_URL,
  buildCollectionsIndexStructuredData,
} from "../../utils/seo/collectionSeo.js";
import styles from "../Products/Products.module.css";

const BREADCRUMBS = [
  { name: "Acasă", to: "/" },
  { name: "Colecții", to: "/colectii" },
];

/*
 * /colectii - pagina index: toate colecțiile active cu produse reale
 * (GET /api/public/collections?placement=all). Ținta breadcrumb-ului
 * "Colecții" din paginile de colecție și un hub de linkuri interne către
 * toate colecțiile. SEO identic cu HTML-ul brut din /api/seo-colectie
 * (același builder).
 */
export default function CollectionsIndexPage() {
  const [state, setState] = useState({ loading: true, items: [] });

  useEffect(() => {
    let active = true;

    fetchPublicCollections("all").then((items) => {
      if (active) setState({ loading: false, items });
    });

    return () => {
      active = false;
    };
  }, []);

  const cards = useMemo(
    () =>
      toCollectionCards(state.items, { resolveImage: resolveFileUrl, max: 60 }),
    [state.items]
  );

  const jsonLd = useMemo(
    () => buildCollectionsIndexStructuredData(state.items),
    [state.items]
  );

  return (
    <section className={styles.page}>
      <SEO
        title={COLLECTIONS_INDEX_TITLE}
        description={COLLECTIONS_INDEX_DESCRIPTION}
        canonical={COLLECTIONS_INDEX_URL}
        url={COLLECTIONS_INDEX_URL}
        jsonLd={jsonLd}
      />

      <header className={styles.head}>
        <Breadcrumbs items={BREADCRUMBS} />

        <div className={styles.categoryHeroText}>
          <span className={styles.categoryEyebrow}>Artfest Marketplace</span>
          <h1 className={styles.h1}>Colecții Artfest</h1>
          <p className={styles.categoryIntro}>
            Selecții de produse handmade și personalizate, alese pentru nunți,
            botezuri, cadouri și alte ocazii speciale.
          </p>
        </div>
      </header>

      {state.loading ? (
        <p>Se încarcă colecțiile…</p>
      ) : cards.length ? (
        <CollectionCards cards={cards} />
      ) : (
        <p className={styles.emptyState}>
          Momentan nu există colecții disponibile.
        </p>
      )}
    </section>
  );
}
