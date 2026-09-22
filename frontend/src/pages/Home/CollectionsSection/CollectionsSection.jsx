import { useMemo } from "react";

import { usePublicCollections } from "../../../hooks/usePublicCollections";
import { resolveFileUrl } from "../../Vendor/Produse/hooks/urlUtils.js";
import { toCollectionCards } from "./collectionCards.js";
import CollectionCards from "./CollectionCards.jsx";
import styles from "./CollectionsSection.module.css";

/*
 * Colecții Artfest marcate showOnHomepage (doar active și cu produse
 * reale - filtrate de backend, GET /api/public/collections?placement=
 * homepage). Linkuri interne reale <Link to="/colectii/:slug"> către
 * paginile de colecție, ca Google să le descopere din Home, nu doar din
 * sitemap. Nu randează nimic dacă nu există colecții.
 */
export default function CollectionsSection() {
  const items = usePublicCollections("homepage");

  const cards = useMemo(
    () => toCollectionCards(items, { resolveImage: resolveFileUrl, max: 12 }),
    [items]
  );

  if (!cards.length) return null;

  return (
    <section
      className={styles.section}
      aria-labelledby="home-collections-title"
    >
      <header className={styles.header}>
        <h2 id="home-collections-title" className={styles.heading}>
          Colecții Artfest
        </h2>
        <p className={styles.subheading}>
          Selecții tematice de produse handmade, pentru fiecare ocazie.
        </p>
      </header>

      <CollectionCards cards={cards} />
    </section>
  );
}
