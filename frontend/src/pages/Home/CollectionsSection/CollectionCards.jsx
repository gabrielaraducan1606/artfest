import { Link } from "react-router-dom";
import styles from "./CollectionsSection.module.css";

/*
 * Grila de carduri de colecții (linkuri interne reale către
 * /colectii/:slug). Folosită de secțiunea din Home și de pagina index
 * /colectii. `cards` vine din toCollectionCards (collectionCards.js).
 */
export default function CollectionCards({ cards }) {
  if (!Array.isArray(cards) || !cards.length) return null;

  return (
    <ul className={styles.grid}>
      {cards.map((card) => (
        <li key={card.slug} className={styles.item}>
          <Link to={card.to} className={styles.card}>
            <span className={styles.media}>
              {card.image ? (
                <img
                  src={card.image}
                  alt={card.title}
                  loading="lazy"
                  decoding="async"
                  className={styles.image}
                />
              ) : (
                <span className={styles.placeholder} aria-hidden="true" />
              )}
            </span>

            <span className={styles.body}>
              <span className={styles.title}>{card.title}</span>
              {card.subtitle ? (
                <span className={styles.subtitle}>{card.subtitle}</span>
              ) : null}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
