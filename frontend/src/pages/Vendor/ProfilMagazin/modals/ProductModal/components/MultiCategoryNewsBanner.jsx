import { useState } from "react";

import styles from "../../../components/css/ProductModal.module.css";

/*
 * Banner discret de noutate: categorii suplimentare.
 * Vizibil până la MULTI_CATEGORY_NEWS_UNTIL sau până când vendorul îl
 * închide (memorat local, per browser). Fără date pe server.
 */
const MULTI_CATEGORY_NEWS_UNTIL = "2027-01-31";
const DISMISS_KEY = "artfest-news-multi-category-v1";

function readDismissed() {
  try {
    return window.localStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

function writeDismissed() {
  try {
    window.localStorage.setItem(DISMISS_KEY, "1");
  } catch {
    // stocare indisponibilă (mod privat etc.) - bannerul se închide doar acum
  }
}

export default function MultiCategoryNewsBanner({ onAction }) {
  const [dismissed, setDismissed] = useState(readDismissed);

  const expired = new Date() > new Date(`${MULTI_CATEGORY_NEWS_UNTIL}T23:59:59`);
  if (dismissed || expired) return null;

  const close = () => {
    writeDismissed();
    setDismissed(true);
  };

  return (
    <aside className={styles.newsBanner} aria-label="Noutate Artfest">
      <div className={styles.newsBannerBody}>
        <strong className={styles.newsBannerTitle}>
          Produsele tale pot fi găsite acum mai ușor ✨
        </strong>
        <p className={styles.newsBannerText}>
          Pe lângă categoria principală, poți adăuga până la 3 categorii
          suplimentare. Astfel, produsul poate apărea în mai multe categorii
          relevante din Artfest.
        </p>
        <button
          type="button"
          className={styles.newsBannerCta}
          onClick={() => {
            onAction?.();
            close();
          }}
        >
          Adaugă categorii suplimentare
        </button>
      </div>

      <button
        type="button"
        className={styles.newsBannerClose}
        onClick={close}
        aria-label="Închide noutatea"
      >
        ×
      </button>
    </aside>
  );
}
