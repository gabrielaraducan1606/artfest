import React, { useEffect, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import styles from "./Navbar.module.css";
import logo from "../../assets/logoArtfest.png";
import { FaUserCircle, FaShoppingCart, FaHeart, FaChevronDown, FaSearch } from "react-icons/fa";
import { useAppContext } from "../Context/useAppContext";
import api from "../../api";

export default function Navbar() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [role, setRole] = useState(null);
  const [searchTerm, setSearchTerm] = useState("");
  const { logout, cart, favorites } = useAppContext();
  const location = useLocation();
  const navigate = useNavigate();

  const isAuthed = !!localStorage.getItem("authToken");
  const isSellerSection = location.pathname.startsWith("/vanzator");

  // Obținem rolul utilizatorului logat
  useEffect(() => {
    if (!isAuthed) return;
    api
      .get("/users/me", {
        headers: { Authorization: `Bearer ${localStorage.getItem("authToken")}` },
      })
      .then((res) => setRole(res.data.role))
      .catch((err) => console.error("❌ Eroare la obținerea rolului:", err));
  }, [isAuthed]);

  const handleSearch = (e) => {
    e.preventDefault();
    if (searchTerm.trim()) {
      navigate(`/search?q=${encodeURIComponent(searchTerm)}`);
      setSearchTerm("");
    }
  };

  const publicMenu = (
    <>
      <div className={styles.dropdown}>
        <NavLink
          to="/servicii-digitale"
          className={({ isActive }) =>
            isActive ? `${styles.navLink} ${styles.active}` : styles.navLink
          }
        >
          Servicii Digitale <FaChevronDown className={styles.dropdownIcon} />
        </NavLink>
        <div className={styles.dropdownContent}>
          <NavLink to="/servicii-digitale">Invitație tip site</NavLink>
          <NavLink to="/servicii-digitale?categorie=invitații">Planificare mese</NavLink>
          <NavLink to="/servicii-digitale?categorie=marturii">Poze QR</NavLink>
        </div>
      </div>

      <div className={styles.dropdown}>
        <NavLink
          to="/produse"
          className={({ isActive }) =>
            isActive ? `${styles.navLink} ${styles.active}` : styles.navLink
          }
        >
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
        <NavLink
          to="/magazine"
          className={({ isActive }) =>
            isActive ? `${styles.navLink} ${styles.active}` : styles.navLink
          }
        >
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

  const sellerMenu = (
    <>
      <NavLink to="/vanzator/dashboard">Profilul meu</NavLink>
      <NavLink to="/vanzator/produse">Produsele mele</NavLink>
      <NavLink to="/vanzator/comenzi">Comenzile mele</NavLink>
      <NavLink to="/vanzator/vizitatori">Vizitatori</NavLink>
      <NavLink to="/vanzator/asistenta">Asistență tehnică</NavLink>
      <NavLink to="/vanzator/setari">Setări</NavLink>
    </>
  );

  return (
    <header className={styles.header}>
      <div className={styles.container}>
        <NavLink to={role === "seller" ? "/vanzator/dashboard" : "/"}>
          <img src={logo} alt="Artfest Logo" className={styles.logo} />
        </NavLink>

        <button
          className={styles.burger}
          onClick={() => setMenuOpen(!menuOpen)}
        >
          ☰
        </button>

        <nav className={`${styles.nav} ${menuOpen ? styles.show : ""}`}>
          {role === "seller" && isSellerSection ? sellerMenu : publicMenu}
        </nav>

        {/* Search bar */}
        <form onSubmit={handleSearch} className={styles.search}>
          <input
            type="text"
            placeholder="Caută produse, magazin..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className={styles.input}
          />
          <button type="submit" className={styles.searchBtn}>
            <FaSearch />
          </button>
        </form>

        <div className={styles.actionsRight}>
          {role !== "seller" && (
            <>
              <div
                className={styles.iconWrapper}
                onClick={() => navigate("/wishlist")}
              >
                <FaHeart />
                {favorites.length > 0 && (
                  <span className={styles.badge}>{favorites.length}</span>
                )}
              </div>
              <div
                className={styles.iconWrapper}
                onClick={() => navigate("/cos")}
              >
                <FaShoppingCart />
                {cart.length > 0 && (
                  <span className={styles.badge}>{cart.length}</span>
                )}
              </div>
            </>
          )}
          {!isAuthed ? (
            <NavLink to="/login" className={styles.accountBtn}>
              <FaUserCircle className={styles.icon} />
              <span>Contul Meu</span>
            </NavLink>
          ) : (
            <button
              onClick={() => {
                logout();
                navigate("/");
              }}
              className={styles.accountBtn}
            >
              <FaUserCircle className={styles.icon} />
              <span>Logout</span>
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
