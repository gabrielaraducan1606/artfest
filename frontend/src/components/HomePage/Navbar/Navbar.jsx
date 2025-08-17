import React, { useEffect, useRef, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import styles from "./Navbar.module.css";
import logo from "../../../assets/LogoArfest.png";
import { FaUserCircle, FaShoppingCart, FaHeart, FaSearch } from "react-icons/fa";

import { useAppContext } from "../../Context/useAppContext";
import useAutosuggest from "../../hooks/useAutosuggest";
import useClickOutside from "../../hooks/useClickOutside";
import useRole from "../../hooks/useRole";

import PublicMenu from "./PublicMenu";
import SellerMenu from "./SellerMenu";
import ThemeToggle from "./ThemeToggle";

export default function Navbar() {
  const [menuOpen, setMenuOpen] = useState(false);

  const { logout, cart, favorites } = useAppContext();
  const location = useLocation();
  const navigate = useNavigate();

  const isAuthed = !!localStorage.getItem("authToken");
  const role = useRole(isAuthed);
  const isSellerSection = location.pathname.startsWith("/vanzator");

  // închide meniul la schimbare de rută
  useEffect(() => { setMenuOpen(false); }, [location.pathname]);

  // search + sugestii
  const sugRef = useRef(null);
  const {
    term, setTerm,
    suggestions, open, setOpen,
    activeIdx, setActiveIdx,
    onKeyDown,
  } = useAutosuggest(2, 250);

  useClickOutside(sugRef, () => setOpen(false));

  function routeForSuggestion(s) {
    const val = s?.value || s?.label || "";
    if (!s || !val) return `/produse?search=${encodeURIComponent(val)}`;

    switch (s.type) {
      case "product":
        return `/produs/${s.slug || String(s.id || "").replace(/^p_/, "") || encodeURIComponent(val)}`;
      case "shop":
        return `/magazin/${s.slug || String(s.id || "").replace(/^s_/, "") || encodeURIComponent(val)}`;
      case "category":
        return `/produse?categorie=${encodeURIComponent(s.slug || val)}`;
      default:
        return `/produse?search=${encodeURIComponent(val)}`;
    }
  }

  function pickSuggestion(s) {
    navigate(routeForSuggestion(s));
    setOpen(false);
    setTerm("");
  }

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    const q = term.trim();
    if (!q) return;

    // smart-enter: dacă există match exact, navighează direct
    const exact = suggestions.find(
      (s) => (s.value || s.label || "").toLowerCase() === q.toLowerCase()
    );
    if (exact) return pickSuggestion(exact);

    navigate(`/search?q=${encodeURIComponent(q)}`);
    setTerm("");
    setOpen(false);
  };

  return (
    <header className={styles.header}>
      <div className={styles.container}>
        <NavLink to={role === "seller" ? "/vanzator/dashboard" : "/"}>
          <img src={logo} alt="Artfest" className={styles.logo} />
        </NavLink>

        <button
          aria-label="Deschide meniul"
          className={styles.burger}
          onClick={() => setMenuOpen((v) => !v)}
        >
          ☰
        </button>

        <nav className={`${styles.nav} ${menuOpen ? styles["nav--open"] : ""}`}>
          {role === "seller" && isSellerSection ? <SellerMenu /> : <PublicMenu />}
        </nav>

        {/* Search (ascuns în dashboard vânzător) */}
        {!(role === "seller" && isSellerSection) && (
          <form
            onSubmit={handleSearchSubmit}
            className={styles.search}
            ref={sugRef}
            role="search"
            aria-haspopup="listbox"
            aria-expanded={open}
          >
            <input
              type="text"
              placeholder="Caută produse…"
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              onKeyDown={(e) => onKeyDown(e, pickSuggestion)}
              className={styles.input}
              aria-autocomplete="list"
              aria-controls="suggestions-listbox"
            />
            <button type="submit" className={styles.searchBtn} aria-label="Caută">
              <FaSearch />
            </button>

            {open && suggestions.length > 0 && (
              <ul
                id="suggestions-listbox"
                className={styles.suggestList}
                role="listbox"
                aria-label="Sugestii de căutare"
              >
                {suggestions.map((s, idx) => (
                  <li
                    key={s.id || `${idx}-${s.value || s.label}`}
                    role="option"
                    aria-selected={activeIdx === idx}
                    className={`${styles.suggestItem} ${activeIdx === idx ? styles.activeItem : ""}`}
                    onMouseDown={(e) => { e.preventDefault(); pickSuggestion(s); }}
                    onMouseEnter={() => setActiveIdx(idx)}
                  >
                    {s.parts
                      ? s.parts.map((p, i) =>
                          p.highlight
                            ? <mark key={i} className={styles.suggestMark}>{p.text}</mark>
                            : <span key={i}>{p.text}</span>
                        )
                      : (s.label || s.value)}
                  </li>
                ))}
              </ul>
            )}
          </form>
        )}

        <div className={styles.actionsRight}>
          {/* toggle temă */}
          <ThemeToggle className={styles.iconWrapper} />

          {role !== "seller" && (
            <>
              <div
                className={styles.iconWrapper}
                onClick={() => navigate("/wishlist")}
                role="button"
                tabIndex={0}
                aria-label="Deschide lista de favorite"
              >
                <FaHeart />
                {favorites.length > 0 && <span className={styles.badge}>{favorites.length}</span>}
              </div>
              <div
                className={styles.iconWrapper}
                onClick={() => navigate("/cos")}
                role="button"
                tabIndex={0}
                aria-label="Deschide coșul"
              >
                <FaShoppingCart />
                {cart.length > 0 && <span className={styles.badge}>{cart.length}</span>}
              </div>
            </>
          )}

          {(!isAuthed || role !== "seller") && !isSellerSection && (
            <button className={styles.sellBtn} onClick={() => navigate("/vinde")}>
              Vinde pe Artfest
            </button>
          )}

          {!isAuthed ? (
            <NavLink to="/login" className={styles.accountBtn}>
              <FaUserCircle className={styles.icon} />
              <span>Contul Meu</span>
            </NavLink>
          ) : (
            <button
              onClick={() => { logout(); navigate("/"); }}
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
