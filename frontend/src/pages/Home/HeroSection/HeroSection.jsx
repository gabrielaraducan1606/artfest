import React, {
  useCallback,
  useEffect,
  useState,
} from "react";

import {
  Link,
  useNavigate,
} from "react-router-dom";

import {
  FaArrowRight,
  FaComments,
  FaLock,
  FaMapMarkerAlt,
  FaStore,
} from "react-icons/fa";

import styles from "./HeroSection.module.css";

import NewsletterModal from "../NewsletterModal/NewsletterModal.jsx";
import HomeDirections from "../HomeDirections/HomeDirections.jsx";
import FeaturedPicksSection from "../FeaturedPicks/FeaturedPicks.jsx";
import { markHpTiming } from "../FeaturedPicks/homepageTiming.js";
import {
  CREATE_REQUEST_FALLBACK_URL,
  EVENTS_ANCHOR_ID,
  openCreateCustomerRequest,
} from "../homeActions.js";
import { trackEvent } from "../../../../services/analytics.js";

/* =========================================================
   HERO
========================================================= */

/*
 * Primul ecran (mai ales pe mobil, unde ajunge traficul din Ads): ce
 * este Artfest, ce găsești, ce poți face imediat. Text, fără imagine
 * mare - pagina se înțelege înainte să se încarce vreo fotografie.
 */
const HERO_TRUST = [
  {
    key: "payment",
    icon: <FaLock aria-hidden="true" />,
    text: "Plată cu cardul sau ramburs",
  },
  {
    key: "creators",
    icon: <FaMapMarkerAlt aria-hidden="true" />,
    text: "Creatori români",
  },
  {
    key: "contact",
    icon: <FaComments aria-hidden="true" />,
    text: "Vorbești direct cu creatorul",
  },
];

function prefersReducedMotion() {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

function HomeHero({ onAnalytics }) {
  const navigate = useNavigate();

  const handleEventsClick = (event) => {
    onAnalytics?.("home_cta_click", {
      cta: "plan_event",
      placement: "hero",
    });

    const target = document.getElementById(EVENTS_ANCHOR_ID);
    if (!target) return;

    event.preventDefault();
    target.scrollIntoView({
      behavior: prefersReducedMotion() ? "auto" : "smooth",
      block: "start",
    });
  };

  const handleRequestClick = () => {
    onAnalytics?.("home_cta_click", {
      cta: "create_request",
      placement: "hero",
    });

    if (!openCreateCustomerRequest("manual")) {
      navigate(CREATE_REQUEST_FALLBACK_URL);
    }
  };

  return (
    <header className={styles.hero}>
      <div className={styles.heroInner}>
        <p className={styles.heroEyebrow}>
          Handmade · Cadouri personalizate · Evenimente
        </p>

        <h1 className={styles.heroTitle}>
          Cadouri handmade și tot ce ai nevoie pentru evenimente, create de
          artizani români.
        </h1>

        <p className={styles.heroLead}>
          Descoperă produse unicat și personalizate. Cumpără direct sau
          publică gratuit o cerere și primește oferte de la creatori.
        </p>

        <div className={styles.heroActions}>
          <Link
            to="/produse"
            className={styles.heroPrimary}
            onClick={() =>
              onAnalytics?.("home_cta_click", {
                cta: "discover_products",
                placement: "hero",
              })
            }
          >
            Descoperă produsele
            <FaArrowRight aria-hidden="true" />
          </Link>

          <a
            href={`#${EVENTS_ANCHOR_ID}`}
            className={styles.heroSecondary}
            onClick={handleEventsClick}
          >
            Pregătesc un eveniment
          </a>
        </div>

        <button
          type="button"
          className={styles.heroRequestLink}
          onClick={handleRequestClick}
        >
          Publică gratuit o cerere
          <FaArrowRight aria-hidden="true" />
        </button>

        <p className={styles.heroRequestNote}>
          O singură cerere, mai multe oferte posibile, fără obligația de a
          comanda.
        </p>

        <ul className={styles.heroTrust} aria-label="De ce Artfest">
          {HERO_TRUST.map(({ key, icon, text }) => (
            <li key={key}>
              {icon}
              <span>{text}</span>
            </li>
          ))}
        </ul>
      </div>
    </header>
  );
}

/* =========================================================
   PARTENER
========================================================= */

function PartnerBar({
  ambassador,
  onCopyAmbassadorLink,
  onAnalytics,
}) {
  return (
    <section className={styles.partnerBar} aria-label="Vinde pe Artfest">
      <div className={styles.partnerBarInner}>
        <div className={styles.partnerCopy}>
          <span className={styles.partnerIcon} aria-hidden="true">
            <FaStore />
          </span>

          <div>
            <span className={styles.partnerKicker}>Pentru creatori</span>
            <strong>Creezi produse handmade?</strong>
            <span className={styles.partnerDescription}>
              Deschide-ți magazinul pe Artfest și ajungi mai ușor la clienții
              care caută produse originale și personalizate.
            </span>
          </div>
        </div>

        <div className={styles.partnerActions}>
          {ambassador?.referralLink && (
            <button
              type="button"
              className={styles.ambassadorButton}
              onClick={onCopyAmbassadorLink}
            >
              Invită un creator
            </button>
          )}

          <Link
            to="/?auth=register&as=partner"
            className={styles.partnerCta}
            onClick={() =>
              onAnalytics?.("partner_cta_click", {
                placement: "homepage_partner_bar",
              })
            }
          >
            Deschide magazin gratuit
            <FaArrowRight aria-hidden="true" />
          </Link>
        </div>
      </div>
    </section>
  );
}


/* =========================================================
   PENTRU CREATORI (mutat din hero în partea de jos a paginii)
========================================================= */

/*
 * Banda pentru vânzători nu mai stă în primul ecran - acolo vorbim
 * cumpărătorului. Logica de ambasador e aceeași, doar mutată aici,
 * ca Home.jsx să poată așeza secțiunea spre finalul paginii.
 */
export function CreatorsBand() {
  const [ambassador, setAmbassador] = useState(null);

  const log = useCallback((eventName, eventData = {}) => {
    // prin analytics.js: doar cu acord pentru statistici, doar către GA4
    trackEvent(eventName, eventData);
  }, []);

  useEffect(() => {
    fetch("/api/ambassadors/me", {
      credentials: "include",
    })
      .then((response) => (response.ok ? response.json() : null))
      .then(setAmbassador)
      .catch(() => {
        setAmbassador(null);
      });
  }, []);

  const copyAmbassadorLink = useCallback(async () => {
    if (!ambassador?.referralLink) {
      return;
    }

    const message = `Fac parte din Artfest, comunitatea creatorilor români. ❤️
Hai să ajungem împreună la 1000 de creatori!
Înscrie-te aici: ${ambassador.referralLink}`;

    try {
      await navigator.clipboard.writeText(message);

      log("ambassador_link_copy");

      window.alert("Textul și linkul au fost copiate.");
    } catch {
      window.prompt("Copiază mesajul:", message);
    }
  }, [ambassador, log]);

  return (
    <PartnerBar
      ambassador={ambassador}
      onCopyAmbassadorLink={copyAmbassadorLink}
      onAnalytics={log}
    />
  );
}

/* =========================================================
   COMPONENTA PRINCIPALĂ
========================================================= */

export default function HeroSection() {
  useEffect(() => {
    markHpTiming("homepage:mount");
  }, []);

  const log = useCallback((eventName, eventData = {}) => {
    // prin analytics.js: doar cu acord pentru statistici, doar către GA4
    trackEvent(eventName, eventData);
  }, []);

  return (
    <>
      <NewsletterModal />

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html:
            JSON.stringify({
              "@context":
                "https://schema.org",

              "@type":
                "WebSite",

              url:
                "https://www.artfest.ro/",

              publisher: {
                "@type":
                  "Organization",

                name:
                  "Artfest",

                url:
                  "https://www.artfest.ro/",
              },
            }),
        }}
      />

      <HomeHero onAnalytics={log} />

      <HomeDirections onAnalytics={log} />

      <FeaturedPicksSection placement="homepage_featured_spotlight" />
    </>
  );
}
