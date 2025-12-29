import React, { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import styles from "./ServiciiDigitale.module.css";
import {
  FaClock,
  FaGlobe,
  FaClipboardCheck,
  FaUsers,
  FaQrcode,
  FaImages,
  FaBell,
  FaFilePdf,
  FaMapMarkedAlt,
  FaCheckCircle,
} from "react-icons/fa";

export default function ServiciiDigitale() {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const items = useMemo(
    () => [
      {
        title: "Invitație online instant (mini-site)",
        desc: "Invitație tip website, cu temă modernă + link de share. Include detalii, hartă și program.",
        icon: FaGlobe,
        badge: "În lucru",
      },
      {
        title: "Formular RSVP & listă invitați",
        desc: "Invitații confirmă prezența, aleg opțiuni (meniu/alergii) și vezi totul într-un dashboard.",
        icon: FaClipboardCheck,
        badge: "În lucru",
      },
      {
        title: "Așezare la mese + căutare instant",
        desc: "Import listă, creezi mese, tragi invitații cu drag & drop. Căutare rapidă după nume.",
        icon: FaUsers,
        badge: "În lucru",
      },
      {
        title: "QR pentru găsirea mesei (1 click)",
        desc: "Generezi un QR pentru eveniment. Invitatul scanează și își găsește masa imediat.",
        icon: FaQrcode,
        badge: "În lucru",
      },
      {
        title: "Album QR (galerie după eveniment)",
        desc: "Un QR pe mese / la intrare → invitații urcă poze; primești un album centralizat.",
        icon: FaImages,
        badge: "În lucru",
      },
      {
        title: "Check-in invitați cu QR (opțional)",
        desc: "Scanare la intrare pentru a vedea rapid cine a sosit. Util și pentru corporate.",
        icon: FaCheckCircle,
        badge: "Idee",
      },
      {
        title: "Reminder automat (email/SMS/WhatsApp)",
        desc: "Reamintești RSVP-ul sau trimiți update-uri (schimbare locație, program etc.).",
        icon: FaBell,
        badge: "Idee",
      },
      {
        title: "Generator PDF (meniuri, place cards, program)",
        desc: "Dintr-un formular → export print-ready (PDF) sau versiune digitală.",
        icon: FaFilePdf,
        badge: "Idee",
      },
      {
        title: "Pagină de informații (FAQ + map + dress code)",
        desc: "Tot ce întreabă lumea înainte de eveniment, într-un singur loc.",
        icon: FaMapMarkedAlt,
        badge: "Idee",
      },
    ],
    []
  );

  const onSubmit = async (e) => {
  e.preventDefault();
  const v = (email || "").trim();
  if (!v) return;

  const res = await fetch("/api/public/digital-waitlist", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: v, source: "servicii-digitale" }),
  });

  if (res.ok) setSubmitted(true);
};

  return (
    <main className={styles.page}>
      <section className={styles.hero}>
        <div className={styles.heroInner}>
          <div className={styles.kicker}>
            <FaClock aria-hidden="true" />
            <span>Disponibile în curând</span>
          </div>

          <h1 className={styles.title}>Servicii digitale pentru evenimentul tău</h1>
          <p className={styles.subtitle}>
            Lucrăm la instrumente simple și frumoase care îți fac organizarea mai ușoară.
            Stai pe aproape — sigur vei avea nevoie de ceva pentru evenimentul tău.
          </p>

          <div className={styles.actions}>
            <Link to="/produse" className={styles.primaryBtn}>
              Descoperă produsele →
            </Link>
            <a href="#features" className={styles.ghostBtn}>
              Vezi ce urmează
            </a>
          </div>

          <div className={styles.waitlistCard}>
            <div className={styles.waitlistText}>
              <div className={styles.waitlistTitle}>Vrei să fii anunțat(ă) primul?</div>
              <div className={styles.waitlistDesc}>
                Lasă un email și îți trimitem un mesaj când lansăm serviciile digitale.
              </div>
            </div>

            {!submitted ? (
              <form className={styles.waitlistForm} onSubmit={onSubmit}>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="email@exemplu.ro"
                  className={styles.input}
                  aria-label="Email pentru notificare"
                />
                <button className={styles.submit} type="submit">
                  Anunță-mă
                </button>
              </form>
            ) : (
              <div className={styles.success} role="status">
                Mulțumim! Te anunțăm când lansăm. 💜
              </div>
            )}
          </div>
        </div>
      </section>

      <section id="features" className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.h2}>Ce pregătim</h2>
          <p className={styles.p}>
            Un set de tool-uri gândite pentru nunți, botezuri, aniversări și evenimente corporate.
          </p>
        </div>

        <div className={styles.grid}>
          {items.map((it) => {
            const Icon = it.icon;
            return (
              <article key={it.title} className={styles.card}>
                <div className={styles.cardTop}>
                  <div className={styles.icon}>
                    <Icon />
                  </div>
                  <span className={styles.badge}>{it.badge}</span>
                </div>

                <h3 className={styles.h3}>{it.title}</h3>
                <p className={styles.cardP}>{it.desc}</p>
              </article>
            );
          })}
        </div>
      </section>

      <section className={styles.footerCta}>
        <div className={styles.footerInner}>
          <div>
            <h2 className={styles.h2}>Până lansăm, poți explora colecțiile</h2>
            <p className={styles.p}>Invitații, mărturii, cadouri și decor — toate într-un singur loc.</p>
          </div>
          <Link to="/produse" className={styles.primaryBtn}>
            Vezi produsele →
          </Link>
        </div>
      </section>
    </main>
  );
}
