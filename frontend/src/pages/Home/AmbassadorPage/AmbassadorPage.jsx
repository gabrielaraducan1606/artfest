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

    try {
      await navigator.clipboard.writeText(ambassador.referralLink);
      alert("Linkul tău a fost copiat.");
    } catch {
      window.prompt("Copiază linkul tău:", ambassador.referralLink);
    }
  };

  const levels = benefits?.levels || [
    {
      title: "Founding Creator",
      minInvites: 0,
      benefits: ["Badge pe profil", "Apari printre creatorii de început Artfest"],
    },
    {
      title: "Ambasador",
      minInvites: 3,
      benefits: ["Badge Ambasador", "Promovare pe canalele Artfest"],
    },
    {
      title: "Ambasador Gold",
      minInvites: 10,
      benefits: [
        "Prioritate la promovare",
        "Posibilitatea de a apărea în reclame Artfest",
      ],
    },
    {
      title: "Ambasador Elite",
      minInvites: 25,
      benefits: ["Homepage spotlight", "Acces prioritar la evenimente Artfest"],
    },
  ];

  return (
    <main className={styles.page}>
      <section className={styles.hero}>
        <span className={styles.badge}>🇷🇴 Programul Ambasadorilor Artfest</span>

        <h1>Ajută-ne să ajungem la 1000 de creatori români</h1>

        <p>
          Invită creatori în Artfest, construiește comunitatea și deblochează
          beneficii de vizibilitate, promovare și apariții în campanii.
        </p>

        <div className={styles.progressCard}>
          <div className={styles.progressTop}>
            <strong>{current} / {target} creatori</strong>
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
              Ai invitat{" "}
              <strong>{ambassador.invitedCount || 0}</strong>{" "}
              creatori prin linkul tău.
            </p>

            <p>
              Nivel actual: <strong>{ambassador.level}</strong>
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
              Primești badge-uri, promovare și șanse de apariție în reclame
              Artfest.
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

      <section className={styles.finalCta}>
        <h2>Nu construim doar un marketplace.</h2>
        <p>Construim comunitatea creatorilor români.</p>
        <Link to="/?auth=register&as=partner">Alătură-te Artfest</Link>
      </section>
    </main>
  );
}