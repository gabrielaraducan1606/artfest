import React from "react";
import { Link } from "react-router-dom";
import { FaRegLightbulb, FaShoppingBag } from "react-icons/fa";
import Button from "../../ui/Button/Button";
import styles from "./HeroSection.module.css";

// Imagini (înlocuiește cu ale tale dacă vrei)
import imageMain from "../../../assets/heroSectionImage.jpg";
import imageSmall1 from "../../../assets/LogoArfest.png";
import imageSmall2 from "../../../assets/heroSectionImage.jpg";

export default function HeroSection() {
  return (
    <section className={styles.heroSection}>
      <div className={styles.inner}>
        <div className={styles.content}>
          <h1 className={styles.title}>
            Creează <span className={styles.accent}>momente unice</span> cu
            produse handmade și servicii digitale
          </h1>

          <p className={styles.description}>
            De la invitații personalizate și decorațiuni create cu suflet, până
            la instrumente digitale care fac organizarea evenimentului simplă și plăcută.
          </p>

          <div className={styles.buttons}>
            <Link to="/servicii-digitale" className={styles.buttonLink}>
              <Button size="lg" className={styles.buttonPrimary}>
                <FaRegLightbulb className={styles.btnIcon} />
                <span>Începe organizarea</span>
              </Button>
            </Link>

            <Link to="/produse" className={styles.buttonLink}>
              <Button size="lg" variant="outline" className={styles.buttonOutline}>
                <FaShoppingBag className={styles.btnIcon} />
                <span>Descoperă colecțiile</span>
              </Button>
            </Link>
          </div>

          <ul className={styles.badges} aria-label="Avantaje">
            <li>🔒 Plăți sigure</li>
            <li>🎁 Produse unicat</li>
            <li>💬 Suport pentru artizani</li>
          </ul>
        </div>

        <div className={styles.images} aria-hidden="true">
          <div className={styles.mainImageWrapper}>
            <img
              src={imageMain}
              alt=""
              className={styles.mainImage}
              loading="eager"
            />
            <div className={styles.shape} />
          </div>

          <img
            src={imageSmall1}
            alt=""
            className={`${styles.smallImage} ${styles.smallImage1} ${styles.maybeLogo}`}
            loading="lazy"
          />
          <img
            src={imageSmall2}
            alt=""
            className={`${styles.smallImage} ${styles.smallImage2}`}
            loading="lazy"
          />
        </div>
      </div>
    </section>
  );
}
