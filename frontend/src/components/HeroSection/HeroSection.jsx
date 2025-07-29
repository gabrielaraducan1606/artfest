import React from "react";
import { Link } from "react-router-dom";
import Button from "../../components/ui/Button/Button";
import styles from "./HeroSection.module.css"; 
import imageHero from '../../assets/heroSectionImage.jpg'

export default function HeroSection() {
  return (
    <section className={styles.heroSection}>
      <div className={styles.content}>
        <h1 className={styles.title}>
          Totul pentru evenimentul tău,<br /> într-un singur loc
        </h1>
        <p className={styles.description}>
          Produse handmade, invitații personalizate, organizare digitală și multă inspirație.
        </p>
        <div className={styles.buttons}>
          <Link to="/invitatie-digitala">
            <Button>Creează invitația ta digitală</Button>
          </Link>
          <Link to="/produse">
            <Button variant="outline">Explorează produse handmade</Button>
          </Link>
        </div>
      </div>
      <div className={styles.imageWrapper}>
        <img src={imageHero} alt="Eveniment Artfest" className={styles.image} />
      </div>
    </section>
  );
}
