// src/components/Navbar/Navbar.jsx
import React, { useEffect, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import styles from "./Navbar.module.css";
import logo from "../../assets/logoArtfest.png";
import { FaUserCircle, FaShoppingCart, FaHeart } from "react-icons/fa";
import { useAppContext } from "../Context/useAppContext";
import api from "../../api";

export default function Navbar() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [role, setRole] = useState(null);
  const [cartCount, setCartCount] = useState(0);
  const [wishlistCount, setWishlistCount] = useState(0);
  const { logout } = useAppContext();
  const location = useLocation();
  const navigate = useNavigate();

  const isAuthed = !!localStorage.getItem("authToken");
  const isSellerSection = location.pathname.startsWith("/vanzator");

  // 📌 Preluăm rolul userului logat
  useEffect(() => {
    const fetchUserRole = async () => {
      if (!isAuthed) return;
      try {
        const res = await api.get("/users/me", {
          headers: { Authorization: `Bearer ${localStorage.getItem("authToken")}` },
        });
        setRole(res.data.role);
      } catch (err) {
        console.error("❌ Eroare la obținerea rolului:", err);
      }
    };
    fetchUserRole();
  }, [isAuthed]);

  // 📌 Setăm numărul de produse din coș și wishlist din localStorage
  useEffect(() => {
    const cart = JSON.parse(localStorage.getItem("cart") || "[]");
    const wishlist = JSON.parse(localStorage.getItem("wishlist") || "[]");
    setCartCount(cart.length);
    setWishlistCount(wishlist.length);
  }, [location]); // actualizează la schimbare de pagină

  const publicMenu = (
    <>
      <NavLink to="/produse" className={({ isActive }) => isActive ? `${styles.navLink} ${styles.active}` : styles.navLink}>
        Produse
      </NavLink>
      <NavLink to="/servicii-digitale" className={({ isActive }) => isActive ? `${styles.navLink} ${styles.active}` : styles.navLink}>
        Servicii Digitale
      </NavLink>
      <NavLink to="/despre" className={({ isActive }) => isActive ? `${styles.navLink} ${styles.active}` : styles.navLink}>
        Despre
      </NavLink>
      <NavLink to="/contact" className={({ isActive }) => isActive ? `${styles.navLink} ${styles.active}` : styles.navLink}>
        Contact
      </NavLink>
      {isAuthed && role === "seller" && (
        <NavLink to="/vanzator/dashboard" className={({ isActive }) => isActive ? `${styles.navLink} ${styles.active}` : styles.navLink}>
          Dashboard
        </NavLink>
      )}
    </>
  );

  const sellerMenu = (
    <>
      <NavLink to="/vanzator/dashboard" className={({ isActive }) => isActive ? `${styles.navLink} ${styles.active}` : styles.navLink}>
        Profilul meu
      </NavLink>
      <NavLink to="/vanzator/produse" className={({ isActive }) => isActive ? `${styles.navLink} ${styles.active}` : styles.navLink}>
        Produsele mele
      </NavLink>
      <NavLink to="/vanzator/comenzi" className={({ isActive }) => isActive ? `${styles.navLink} ${styles.active}` : styles.navLink}>
        Comenzile mele
      </NavLink>
      <NavLink to="/vanzator/vizitatori" className={({ isActive }) => isActive ? `${styles.navLink} ${styles.active}` : styles.navLink}>
        Vizitatori
      </NavLink>
      <NavLink to="/vanzator/asistenta" className={({ isActive }) => isActive ? `${styles.navLink} ${styles.active}` : styles.navLink}>
        Asistență tehnică
      </NavLink>
      <NavLink to="/vanzator/setari" className={({ isActive }) => isActive ? `${styles.navLink} ${styles.active}` : styles.navLink}>
        Setări
      </NavLink>
    </>
  );

  return (
    <header className={styles.header}>
      <div className={styles.container}>
        <NavLink to={role === "seller" ? "/vanzator/dashboard" : "/"}>
          <img src={logo} alt="Artfest Logo" className={styles.logo} />
        </NavLink>

        <button className={styles.burger} onClick={() => setMenuOpen(!menuOpen)}>
          ☰
        </button>

        <nav className={`${styles.nav} ${menuOpen ? styles.show : ""}`}>
          {role === "seller" && isSellerSection ? sellerMenu : publicMenu}
        </nav>

        <div className={styles.actionsRight}>
          {role !== "seller" && (
            <>
              <div className={styles.iconWrapper} onClick={() => navigate("/wishlist")}>
                <FaHeart />
                {wishlistCount > 0 && <span className={styles.badge}>{wishlistCount}</span>}
              </div>
              <div className={styles.iconWrapper} onClick={() => navigate("/cos")}>
                <FaShoppingCart />
                {cartCount > 0 && <span className={styles.badge}>{cartCount}</span>}
              </div>
            </>
          )}
          {!isAuthed ? (
            <NavLink to="/login" className={styles.accountBtn}>
              <FaUserCircle className={styles.icon} />
              <span>Contul Meu</span>
            </NavLink>
          ) : (
            <button onClick={() => { logout(); navigate("/"); }} className={styles.accountBtn} title="Delogare">
              <FaUserCircle className={styles.icon} />
              <span>Logout</span>
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
