import { useState } from "react";

import dashboardStyles from "./InfluencerDashboardPage.module.css";
import styles from "./CommunityFeaturesSection.module.css";
import {
  CLIENT_CTAS,
  CLIENT_FEATURE_GROUPS,
  CONTENT_IDEAS,
  VENDOR_CTAS,
  VENDOR_FEATURE_GROUPS,
} from "./communityFeaturesData.js";

/*
 * „Ce poate face comunitatea ta pe Artfest” - rezumat comercial, STATIC
 * (nu depinde de niciun API), construit STRICT din funcționalități reale,
 * verificate în cod (vezi comentariile din communityFeaturesData.js).
 *
 * Scop: influencerul înțelege rapid ce poate arăta/promova comunității
 * lui - nu e un manual tehnic, doar un rezumat scanabil.
 */
export default function CommunityFeaturesSection() {
  const [openPanel, setOpenPanel] = useState("clients");

  return (
    <section className={dashboardStyles.card}>
      <div className={dashboardStyles.cardHeader}>
        <div>
          <h2 className={dashboardStyles.cardTitle}>
            Ce poate face comunitatea ta pe Artfest
          </h2>

          <p className={dashboardStyles.cardSubtitle}>
            Ce poți arăta comunității tale, în câteva secunde.
          </p>
        </div>
      </div>

      <AccordionPanel
        id="clients"
        icon="🛍️"
        title="Pentru clienți"
        subtitle="Caută, cer oferte și cumpără - simplu, cu sau fără cont"
        groups={CLIENT_FEATURE_GROUPS}
        open={openPanel === "clients"}
        onToggle={() =>
          setOpenPanel((current) => (current === "clients" ? "" : "clients"))
        }
      />

      <AccordionPanel
        id="vendors"
        icon="🏪"
        title="Pentru creatori și vânzători"
        subtitle="Magazin, AI, prețuri și comenzi - într-un singur loc"
        groups={VENDOR_FEATURE_GROUPS}
        open={openPanel === "vendors"}
        onToggle={() =>
          setOpenPanel((current) => (current === "vendors" ? "" : "vendors"))
        }
      />

      <div className={styles.ideasBox}>
        <div className={styles.ideasTitle}>💡 Idei rapide de conținut</div>

        <ul className={styles.ideasList}>
          {CONTENT_IDEAS.map((idea) => (
            <li key={idea}>{idea}</li>
          ))}
        </ul>
      </div>

      <div className={styles.ctaLabel}>Arată-i comunității tale:</div>

      <div className={styles.ctaRow}>
        {CLIENT_CTAS.map((cta) => (
          <a
            key={cta.href}
            href={cta.href}
            target="_blank"
            rel="noreferrer"
            className={dashboardStyles.secondaryButton}
          >
            {cta.label}
          </a>
        ))}

        {VENDOR_CTAS.map((cta) => (
          <a
            key={cta.href}
            href={cta.href}
            target="_blank"
            rel="noreferrer"
            className={dashboardStyles.secondaryButton}
          >
            {cta.label}
          </a>
        ))}
      </div>
    </section>
  );
}

/* =========================================================
   ACORDEON
========================================================= */

function AccordionPanel({ icon, title, subtitle, groups, open, onToggle }) {
  const panelId = `community-features-panel-${title}`;

  return (
    <div className={styles.accordion}>
      <button
        type="button"
        className={styles.accordionHeader}
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={panelId}
      >
        <span className={styles.accordionIcon}>{icon}</span>

        <span className={styles.accordionHeaderText}>
          <span className={styles.accordionTitle}>{title}</span>
          <span className={styles.accordionSubtitle}>{subtitle}</span>
        </span>

        <span className={styles.accordionChevron} aria-hidden="true">
          {open ? "−" : "+"}
        </span>
      </button>

      {open && (
        <div id={panelId} className={styles.accordionBody}>
          {groups.map((group) => (
            <div key={group.id} className={styles.group}>
              <div className={styles.groupTitle}>{group.title}</div>

              <div className={styles.itemsGrid}>
                {group.items.map((item) => (
                  <div key={item.title} className={styles.item}>
                    <div className={styles.itemHeader}>
                      <span className={styles.itemIcon}>{item.icon}</span>
                      <span className={styles.itemTitle}>{item.title}</span>

                      {item.access === "guest" && (
                        <span className={styles.badgeGuest}>fără cont</span>
                      )}

                      {item.access === "account" && (
                        <span className={styles.badgeAccount}>cont Artfest</span>
                      )}
                    </div>

                    <p className={styles.itemText}>{item.text}</p>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
