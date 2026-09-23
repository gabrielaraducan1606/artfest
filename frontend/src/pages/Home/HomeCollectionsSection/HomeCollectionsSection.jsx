// src/pages/Home/HomeCollectionsSection/HomeCollectionsSection.jsx
//
// "Colecții Artfest" pe homepage, DUPĂ Produse noi (bloc editorial,
// maximum 3-4 colecții). Nu era pe homepage înainte - secțiunea în
// sine e nouă, dar reutilizează 100% infrastructura existentă:
// usePublicCollections("homepage") (GET /api/public/collections,
// backend-ul filtrează deja isActive + showOnHomepage), toCollectionCards
// și CollectionCards - EXACT aceleași folosite de Navbar și de
// /colectii (CollectionsIndex.jsx). Niciun endpoint nou, niciun model
// nou, infrastructura Collection din backend/DB neatinsă.
import React, { useMemo } from "react";
import { Link } from "react-router-dom";
import { FaArrowRight } from "react-icons/fa";

import { usePublicCollections } from "../../../hooks/usePublicCollections";
import { toCollectionCards } from "../CollectionsSection/collectionCards.js";
import CollectionCards from "../CollectionsSection/CollectionCards.jsx";
import { resolveFileUrl } from "../../Vendor/Produse/hooks/urlUtils.js";

import styles from "./HomeCollectionsSection.module.css";

const MAX_HOMEPAGE_COLLECTIONS = 4;

export default function HomeCollectionsSection() {
  const items = usePublicCollections("homepage");

  const cards = useMemo(
    () =>
      toCollectionCards(items, {
        resolveImage: resolveFileUrl,
        max: MAX_HOMEPAGE_COLLECTIONS,
      }),
    [items]
  );

  // listă decorativă - fără date reale, nu afișăm nimic (nu inventăm
  // colecții placeholder)
  if (!cards.length) return null;

  const hasMore = items.length > cards.length;

  return (
    <section className={styles.section} aria-labelledby="home-collections-heading">
      <div className={styles.header}>
        <div>
          <h2 id="home-collections-heading" className={styles.heading}>
            Colecții Artfest
          </h2>
          <p className={styles.subheading}>
            Selecții editoriale, alese pentru ocazii și stiluri diferite.
          </p>
        </div>

        {hasMore && (
          <Link to="/colectii" className={styles.viewAll}>
            Vezi toate colecțiile
            <FaArrowRight aria-hidden="true" />
          </Link>
        )}
      </div>

      <CollectionCards cards={cards} />
    </section>
  );
}
