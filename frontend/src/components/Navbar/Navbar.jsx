import React, { useState } from "react";
import { NavLink } from "react-router-dom";
import styles from "./Navbar.module.css";
import logo from "../../assets/logoArtfest.png"; // Înlocuiește cu logo-ul tău
import { FaUserCircle } from "react-icons/fa";

export default function Navbar() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className={styles.header}>
      <div className={styles.container}>
        <NavLink to="/">
          <img src={logo} alt="Artfest Logo" className={styles.logo} />
        </NavLink>

        <button className={styles.burger} onClick={() => setMenuOpen(!menuOpen)}>
          ☰
        </button>

        <nav className={`${styles.nav} ${menuOpen ? styles.show : ""}`}>
          <NavLink to="/produse" className={({ isActive }) => isActive ? `${styles.navLink} ${styles.active}` : styles.navLink}>Produse</NavLink>
          <NavLink to="/servicii-digitale" className={({ isActive }) => isActive ? `${styles.navLink} ${styles.active}` : styles.navLink}>Servicii Digitale</NavLink>
          <NavLink to="/despre" className={({ isActive }) => isActive ? `${styles.navLink} ${styles.active}` : styles.navLink}>Despre</NavLink>
          <NavLink to="/contact" className={({ isActive }) => isActive ? `${styles.navLink} ${styles.active}` : styles.navLink}>Contact</NavLink>
        </nav>

        <div className={styles.search}>
          <input type="text" placeholder="Caută produse..." className={styles.input} />
          <NavLink to="/login" className={styles.accountBtn}>
            <FaUserCircle className={styles.icon} />
            <span>Contul Meu</span>
          </NavLink>
        </div>
      </div>
    </header>
  );
}
