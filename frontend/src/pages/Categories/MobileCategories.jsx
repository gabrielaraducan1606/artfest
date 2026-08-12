// frontend/src/pages/MobileCategories/MobileCategories.jsx

import React, {
  useEffect,
  useState,
} from "react";

import {
  useSearchParams,
} from "react-router-dom";

import styles from "./MobileCategories.module.css";

import ProductsPage from "../Products/Products.jsx";
import StoresPage from "../Stores/StoresPage.jsx";
import ServiciiDigitale from "../ServiciiDigitale/ServiciiDigitale.jsx";

import {
  FaClock,
} from "react-icons/fa";

/* =========================================================
   TAB-URI PRINCIPALE
========================================================= */

const ROOT_TABS = [
  {
    key: "produse",
    label: "Produse",
  },
  {
    key: "servicii",
    label: "Servicii",
  },
  {
    key: "digitale",
    label: "Digitale",
  },
  {
    key: "magazine",
    label: "Magazine",
  },
];

/* =========================================================
   COMPONENTĂ
========================================================= */

export default function MobileCategories() {
  const [
    searchParams,
    setSearchParams,
  ] = useSearchParams();

  /* =======================================================
     TAB INIȚIAL
  ======================================================= */

  const initialTab =
    searchParams.get(
      "tab"
    );

  const [
    tab,
    setTab,
  ] = useState(
    ROOT_TABS.some(
      (item) =>
        item.key ===
        initialTab
    )
      ? initialTab
      : "produse"
  );

  /* =======================================================
     SYNC URL -> TAB
  ======================================================= */

  useEffect(() => {
    const requestedTab =
      searchParams.get(
        "tab"
      );

    if (
      requestedTab &&
      ROOT_TABS.some(
        (item) =>
          item.key ===
          requestedTab
      )
    ) {
      setTab(
        requestedTab
      );

      return;
    }

    setTab(
      "produse"
    );
  }, [
    searchParams,
  ]);

  /* =======================================================
     SCHIMBARE TAB
  ======================================================= */

  const onPickTab = (
    key
  ) => {
    setTab(key);

    /*
     * Păstrăm parametrii existenți.
     *
     * Asta permite, de exemplu,
     * ca filtrele/categoria din Produse
     * să rămână în URL când utilizatorul
     * schimbă temporar tab-ul.
     */
    const next =
      new URLSearchParams(
        searchParams
      );

    next.set(
      "tab",
      key
    );

    setSearchParams(
      next,
      {
        replace: true,
      }
    );
  };

  /* =======================================================
     RENDER
  ======================================================= */

  return (
    <section
      className={
        styles.page
      }
      aria-label="Explorează Artfest"
    >
      {/* =================================================
          HERO
      ================================================= */}

      <header
        className={
          styles.hero
        }
      >
        <span
          className={
            styles.eyebrow
          }
        >
          Artfest Marketplace
        </span>

        <h1
          className={
            styles.pageTitle
          }
        >
          Explorează Artfest
        </h1>

        <p
          className={
            styles.pageIntro
          }
        >
          Descoperă produse,
          servicii digitale și
          magazine ale creatorilor
          Artfest.
        </p>
      </header>

      {/* =================================================
          TAB-URI
      ================================================= */}

      <nav
        className={
          styles.tabs
        }
        aria-label="Secțiuni Artfest"
      >
        {ROOT_TABS.map(
          (item) => {
            const active =
              tab ===
              item.key;

            return (
              <button
                key={
                  item.key
                }
                type="button"
                className={`${styles.tab} ${
                  active
                    ? styles.tabActive
                    : ""
                }`}
                onClick={() =>
                  onPickTab(
                    item.key
                  )
                }
                aria-current={
                  active
                    ? "page"
                    : undefined
                }
              >
                {
                  item.label
                }
              </button>
            );
          }
        )}
      </nav>

      {/* =================================================
          CONTENT
      ================================================= */}

      <main
        className={`${styles.panel} ${
          tab === "produse" ||
          tab === "magazine" ||
          tab === "digitale"
            ? styles.marketplacePanel
            : ""
        }`}
      >
        {/* =================================================
            PRODUSE
        ================================================= */}

        {tab ===
          "produse" && (
          <div
            className={
              styles.productsEmbed
            }
          >
            <ProductsPage
              embedded
            />
          </div>
        )}

        {/* =================================================
            SERVICII
        ================================================= */}

        {tab ===
          "servicii" && (
          <UnavailableServices />
        )}

        {/* =================================================
            SERVICII DIGITALE
        ================================================= */}

        {tab ===
          "digitale" && (
          <div
            className={
              styles.digitalEmbed
            }
          >
            <ServiciiDigitale />
          </div>
        )}

        {/* =================================================
            MAGAZINE
        ================================================= */}

        {tab ===
          "magazine" && (
          <div
            className={
              styles.storesEmbed
            }
          >
            <StoresPage
              embedded
            />
          </div>
        )}
      </main>
    </section>
  );
}

/* =========================================================
   SERVICII INDISPONIBILE
========================================================= */

function UnavailableServices() {
  return (
    <section
      className={
        styles.unavailableState
      }
      aria-label="Servicii indisponibile momentan"
    >
      <div
        className={
          styles.unavailableIcon
        }
        aria-hidden="true"
      >
        <FaClock />
      </div>

      <span
        className={
          styles.unavailableEyebrow
        }
      >
        În pregătire
      </span>

      <h2
        className={
          styles.unavailableTitle
        }
      >
        Serviciile Artfest
        vor fi disponibile
        în curând
      </h2>

      <p
        className={
          styles.unavailableText
        }
      >
        Lucrăm la această
        secțiune pentru ca în
        curând să poți descoperi
        mai ușor furnizori și
        profesioniști pentru
        evenimentul tău.
      </p>

      <span
        className={
          styles.unavailableBadge
        }
      >
        Indisponibil momentan
      </span>
    </section>
  );
}