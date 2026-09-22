import { Link } from "react-router-dom";
import styles from "./Breadcrumbs.module.css";

/*
 * Breadcrumbs vizibile cu linkuri interne reale. Același array de pași
 * (utils/seo/collectionSeo.js / categorySeo.js) alimentează și JSON-LD
 * BreadcrumbList, deci vizibilul și markup-ul nu se pot desincroniza.
 * Ultimul pas = pagina curentă (fără link, aria-current="page").
 *
 * items: [{ name, to }]
 */
export default function Breadcrumbs({ items }) {
  const steps = (Array.isArray(items) ? items : []).filter(
    (item) => item?.name && item?.to
  );

  if (steps.length < 2) return null;

  return (
    <nav className={styles.breadcrumbs} aria-label="Breadcrumb">
      <ol className={styles.list}>
        {steps.map((step, index) => {
          const isLast = index === steps.length - 1;

          return (
            <li key={step.to} className={styles.item}>
              {isLast ? (
                <span aria-current="page" className={styles.current}>
                  {step.name}
                </span>
              ) : (
                <>
                  <Link to={step.to} className={styles.link}>
                    {step.name}
                  </Link>
                  <span className={styles.sep} aria-hidden="true">
                    ›
                  </span>
                </>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
