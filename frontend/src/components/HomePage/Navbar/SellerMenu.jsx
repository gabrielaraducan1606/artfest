import { NavLink } from "react-router-dom";
import styles from "./Navbar.module.css";

export default function SellerMenu() {
  const link = (to, label) => (
    <NavLink to={to} className={({isActive}) => isActive ? `${styles.navLink} ${styles.active}` : styles.navLink}>
      {label}
    </NavLink>
  );

  return (
    <>
      {link("/vanzator/dashboard", "Profilul meu")}
      {link("/vanzator/produse", "Produsele mele")}
      {link("/vanzator/comenzi", "Comenzile mele")}
      {link("/vanzator/vizitatori", "Vizitatori")}
      {link("/vanzator/asistenta", "Asistență tehnică")}
      {link("/vanzator/setari", "Setări")}
    </>
  );
}
