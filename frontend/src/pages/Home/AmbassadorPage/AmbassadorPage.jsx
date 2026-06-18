import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import styles from "./AmbassadorPage.module.css";
import { api } from "../../../lib/api.js";

export default function AmbassadorsPage() {
  const [mission, setMission] = useState(null);
  const [benefits, setBenefits] = useState(null);
  const [ambassador, setAmbassador] = useState(null);

  useEffect(() => {
    api("/api/ambassadors/mission")
      .then(setMission)
      .catch(() => setMission(null));

    api("/api/ambassadors/benefits")
      .then(setBenefits)
      .catch(() => setBenefits(null));

    api("/api/ambassadors/me")
      .then(setAmbassador)
      .catch(() => setAmbassador(null));
  }, []);

  const current = mission?.currentCreators ?? 0;
  const target = mission?.targetCreators ?? 1000;
  const progress =
    mission?.progress ?? Math.min(100, Math.round((current / target) * 100));

  const copyReferralLink = async () => {
    if (!ambassador?.referralLink) return;

    const text = `Fac parte din Artfest, comunitatea creatorilor români. ❤️
Hai să ajungem împreună la 1000 de creatori!
Înscrie-te aici: ${ambassador.referralLink}`;

    try {
      await navigator.clipboard.writeText(text);
      alert("Textul și linkul tău au fost copiate.");
    } catch {
      window.prompt("Copiază mesajul:", text);
    }
  };

  const levels = benefits?.levels || [
    {
      title: "Founding Creator",
      minInvites: 0,
      benefits: [
        "Badge pe profil",
        "Apari printre creatorii de început Artfest",
      ],
    },
    {
      title: "Ambasador",
      minInvites: 3,
      benefits: [
        "Badge Ambasador",
        "1 lună gratuită dacă cei 3 creatori invitați devin vendori activi",
        "Promovare pe canalele Artfest",
      ],
    },
    {
      title: "Ambasador Gold",
      minInvites: 10,
      benefits: [
        "Prioritate la promovare",
        "2 luni gratuite dacă invitații validați sunt vendori activi",
        "Posibilitatea de a apărea în reclame Artfest",
      ],
    },
    {
      title: "Ambasador Elite",
      minInvites: 25,
      benefits: [
        "Homepage spotlight",
        "3 luni gratuite dacă invitații validați sunt vendori activi",
        "Acces prioritar la evenimente Artfest",
        "Campanii speciale Artfest",
      ],
    },
  ];

  return (
    <main className={styles.page}>
      <section className={styles.hero}>
        <span className={styles.badge}>
          🇷🇴 Programul Ambasadorilor Artfest
        </span>

        <h1>Construim împreună comunitatea creatorilor români</h1>

        <p>
          Invită creatori în Artfest, construiește comunitatea și deblochează
          beneficii de vizibilitate, promovare și luni gratuite.
        </p>

        <div className={styles.progressCard}>
          <div className={styles.progressTop}>
            <strong>
              {current} / {target} creatori
            </strong>
            <span>{progress}%</span>
          </div>

          <div className={styles.progressBar}>
            <div style={{ width: `${progress}%` }} />
          </div>
        </div>

        {ambassador && (
          <div className={styles.myAmbassadorCard}>
            <h3>Statusul tău de ambasador</h3>

            <p>
              Ai invitat <strong>{ambassador.invitedCount || 0}</strong>{" "}
              creatori prin linkul tău.
            </p>

            <p>
              Nivel actual: <strong>{ambassador.level}</strong>
            </p>

            <p>
              La <strong>3 creatori invitați care devin vendori activi</strong>,
              primești <strong>1 lună gratuită</strong> pe Artfest.
            </p>

            <button type="button" onClick={copyReferralLink}>
              Copiază linkul meu
            </button>
          </div>
        )}

        <Link to="/?auth=register&as=partner" className={styles.cta}>
          Devino creator Artfest
        </Link>
      </section>

      <section className={styles.section}>
        <h2>Cum funcționează?</h2>

        <div className={styles.steps}>
          <div>
            <strong>1</strong>
            <h3>Primești linkul tău unic</h3>
            <p>Creatorii logați primesc un link personal de invitație.</p>
          </div>

          <div>
            <strong>2</strong>
            <h3>Îl distribui</h3>
            <p>Pe Facebook, Instagram, TikTok, WhatsApp sau comunități locale.</p>
          </div>

          <div>
            <strong>3</strong>
            <h3>Creatorii se înscriu</h3>
            <p>Când se înscriu prin linkul tău, invitația este contorizată.</p>
          </div>

          <div>
            <strong>4</strong>
            <h3>Deblochezi beneficii</h3>
            <p>
              Dacă invitații tăi devin vendori activi, primești luni gratuite,
              badge-uri și promovare.
            </p>
          </div>
        </div>
      </section>

      <section className={styles.section}>
        <h2>Niveluri și beneficii</h2>

        <div className={styles.levels}>
          {levels.map((level) => (
            <article className={styles.levelCard} key={level.title}>
              <span>{level.minInvites}+ invitați</span>
              <h3>{level.title}</h3>

              <ul>
                {level.benefits.map((benefit) => (
                  <li key={benefit}>✅ {benefit}</li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>

      <section className={styles.section}>
        <h2>Condiții pentru lunile gratuite</h2>

        <div className={styles.steps}>
          <div>
            <strong>✓</strong>
            <h3>Invitații trebuie să vină prin linkul tău</h3>
            <p>Doar înscrierile făcute prin linkul personal sunt contorizate.</p>
          </div>

          <div>
            <strong>✓</strong>
            <h3>Creatorii invitați trebuie să fie activi</h3>
            <p>
              Bonusul se acordă când creatorii invitați își activează magazinul
              pe Artfest.
            </p>
          </div>

          <div>
            <strong>✓</strong>
            <h3>Bonusul se acordă pentru contribuție reală</h3>
            <p>
              Scopul este să creștem comunitatea cu creatori reali, activi și
              vizibili.
            </p>
          </div>
        </div>
      </section>

      <section className={styles.finalCta}>
        <h2>Nu construim doar un marketplace.</h2>
        <p>Construim comunitatea creatorilor români.</p>
        <Link to="/?auth=register&as=partner">Alătură-te Artfest</Link>
      </section>
    </main>
  );
}