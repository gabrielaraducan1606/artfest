import {
  useEffect,
  useState,
} from "react";

import {
  saveConsent,
  hasAnyDecision,
  defaultConsent,
} from "../../lib/cookieConsent.js";

import styles from "./CookieBanner.module.css";

export default function CookieBanner() {
  const [open, setOpen] =
    useState(false);

  useEffect(() => {
    setOpen(
      !hasAnyDecision()
    );
  }, []);

  if (!open) {
    return null;
  }

  return (
    <div
      className={styles.overlay}
      role="dialog"
      aria-modal="true"
      aria-label="Setări cookie"
    >
      <div
        className={styles.banner}
      >
        <div
          className={styles.text}
        >
          Folosim cookie-uri pentru
          funcționarea platformei și,
          doar cu acordul tău, pentru
          statistici și marketing.

          <a
            href="/cookies"
            className={styles.link}
          >
            Află mai multe
          </a>
          .
        </div>

        <div
          className={styles.actions}
        >
          <button
            type="button"
            className={styles.btn}
            onClick={() => {
              saveConsent(
                {
                  ...defaultConsent,

                  analytics:
                    false,

                  marketing:
                    false,
                },
                {
                  action:
                    "NECESSARY_ONLY",

                  source:
                    "COOKIE_BANNER",
                }
              );

              setOpen(false);
            }}
          >
            Doar necesare
          </button>

          <button
            type="button"
            className={
              styles.btnPrimary
            }
            onClick={() => {
              saveConsent(
                {
                  necessary:
                    true,

                  analytics:
                    true,

                  marketing:
                    true,
                },
                {
                  action:
                    "ACCEPT_ALL",

                  source:
                    "COOKIE_BANNER",
                }
              );

              setOpen(false);
            }}
          >
            Accept toate
          </button>

          <a
            className={
              styles.btnLink
            }
            href="/preferinte-cookie"
          >
            Preferințe
          </a>
        </div>
      </div>
    </div>
  );
}