import {
  useCallback,
  useEffect,
  useState,
} from "react";

import { useLocation } from "react-router-dom";

import {
  saveConsent,
  hasAnyDecision,
  defaultConsent,
  OPEN_COOKIE_PREFERENCES_EVENT,
} from "../../lib/cookieConsent.js";

import { CookiePreferencesForm } from "./CookiePreferences.jsx";

import {
  initialView,
  reduceView,
  isBannerHiddenOnPath,
} from "./cookiePreferencesState.js";

import styles from "./CookieBanner.module.css";

export default function CookieBanner() {
  const { pathname } = useLocation();

  // "closed" | "banner" | "preferences"
  const [view, setView] =
    useState("closed");

  const dispatchView =
    useCallback((action) => {
      setView((current) =>
        reduceView(
          current,
          action,
          {
            hasDecision:
              hasAnyDecision(),
          }
        )
      );
    }, []);

  useEffect(() => {
    setView(
      initialView({
        hasDecision:
          hasAnyDecision(),
      })
    );
  }, []);

  /*
   * „Preferințe” se poate deschide ORICÂND (footer, banner, link),
   * indiferent dacă utilizatorul a decis deja - NU depinde de
   * hasAnyDecision().
   */
  useEffect(() => {
    const onOpen = () =>
      dispatchView(
        "open-preferences"
      );

    window.addEventListener(
      OPEN_COOKIE_PREFERENCES_EVENT,
      onOpen
    );

    return () =>
      window.removeEventListener(
        OPEN_COOKIE_PREFERENCES_EVENT,
        onOpen
      );
  }, [dispatchView]);

  useEffect(() => {
    if (view !== "preferences") {
      return undefined;
    }

    const onKey = (event) => {
      if (event.key === "Escape") {
        dispatchView(
          "close-preferences"
        );
      }
    };

    window.addEventListener(
      "keydown",
      onKey
    );

    return () =>
      window.removeEventListener(
        "keydown",
        onKey
      );
  }, [view, dispatchView]);

  const setOpen = (value) => {
    if (value === false) {
      dispatchView("decided");
    }
  };

  /*
   * Pe pagina /preferinte-cookie formularul e chiar pagina: bannerul
   * (overlay full-screen) ar acoperi-o.
   */
  if (
    isBannerHiddenOnPath(pathname)
  ) {
    return null;
  }

  if (view === "preferences") {
    return (
      <div
        className={styles.overlay}
        role="dialog"
        aria-modal="true"
        aria-label="Preferințe cookie"
        style={{
          alignItems: "center",
          overflowY: "auto",
        }}
        onMouseDown={(event) => {
          if (
            event.target ===
            event.currentTarget
          ) {
            dispatchView(
              "close-preferences"
            );
          }
        }}
      >
        <div
          className={styles.banner}
          style={{
            display: "block",
            width:
              "min(760px, 100%)",
            maxHeight:
              "calc(100dvh - 40px)",
            overflowY: "auto",
          }}
        >
          <CookiePreferencesForm
            onSaved={() =>
              dispatchView("saved")
            }
            onClose={() =>
              dispatchView(
                "close-preferences"
              )
            }
          />
        </div>
      </div>
    );
  }

  if (view !== "banner") {
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
          statistici, marketing și
          atribuirea recomandărilor
          (influenceri, vânzători,
          campanii).

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

                  attribution:
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

                  attribution:
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

          <button
            type="button"
            className={
              styles.btnLink
            }
            onClick={() =>
              dispatchView(
                "open-preferences"
              )
            }
          >
            Preferințe
          </button>
        </div>
      </div>
    </div>
  );
}