import { Link } from "react-router-dom";
import styles from "./PageLinks.module.css";

/*
 * Linkuri REALE Pagina anterioară / Pagina următoare (<a href> prin
 * <Link>), în paralel cu infinite scroll-ul: crawlerele (și utilizatorii
 * fără JS de scroll) pot ajunge la ?page=N. `prev`/`next` vin din
 * paginationLinks (utils/seo/pagination.js): { page, to } sau null.
 */
export default function PageLinks({ prev, next, currentPage }) {
  if (!prev && !next) return null;

  return (
    <nav className={styles.pageLinks} aria-label="Paginare">
      {prev ? (
        <Link to={prev.to} rel="prev" className={styles.link}>
          ← Pagina anterioară
        </Link>
      ) : (
        <span />
      )}

      <span className={styles.current} aria-current="page">
        Pagina {currentPage}
      </span>

      {next ? (
        <Link to={next.to} rel="next" className={styles.link}>
          Pagina următoare →
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}
