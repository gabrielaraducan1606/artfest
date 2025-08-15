import { NavLink } from "react-router-dom";
import { FaChevronDown } from "react-icons/fa";
import styles from "./Navbar.module.css";

export default function PublicMenu() {
  return (
    <>
      <div className={styles.dropdown}>
        <NavLink to="/servicii-digitale"
          className={({ isActive }) => isActive ? `${styles.navLink} ${styles.active}` : styles.navLink}>
          Servicii Digitale <FaChevronDown className={styles.dropdownIcon} />
        </NavLink>
        <div className={styles.dropdownContent}>
          <NavLink to="/servicii-digitale/invitatie-instant">Invitație Instant</NavLink>
          <NavLink to="/servicii-digitale/seating-sms">Seating & SMS</NavLink>
          <NavLink to="/servicii-digitale/album-qr">Album QR</NavLink>
        </div>
      </div>

      <div className={styles.dropdown}>
        <NavLink to="/produse"
          className={({ isActive }) => isActive ? `${styles.navLink} ${styles.active}` : styles.navLink}>
          Produse <FaChevronDown className={styles.dropdownIcon} />
        </NavLink>
        <div className={styles.dropdownContent}>
          <NavLink to="/produse">Toate produsele</NavLink>
          <NavLink to="/produse?categorie=invitații">Invitații</NavLink>
          <NavLink to="/produse?categorie=marturii">Mărturii</NavLink>
          <NavLink to="/produse?categorie=trusouri">Trusouri</NavLink>
          <NavLink to="/produse?categorie=altele">Altele</NavLink>
        </div>
      </div>

      <div className={styles.dropdown}>
        <NavLink to="/magazine"
          className={({ isActive }) => isActive ? `${styles.navLink} ${styles.active}` : styles.navLink}>
          Magazine <FaChevronDown className={styles.dropdownIcon} />
        </NavLink>
        <div className={styles.dropdownContent}>
          <NavLink to="/magazine">Toate magazinele</NavLink>
          <NavLink to="/magazine?categorie=invitații">Invitații</NavLink>
          <NavLink to="/magazine?categorie=marturii">Mărturii</NavLink>
          <NavLink to="/magazine?categorie=trusouri">Trusouri</NavLink>
          <NavLink to="/magazine?categorie=altele">Altele</NavLink>
        </div>
      </div>
    </>
  );
}
