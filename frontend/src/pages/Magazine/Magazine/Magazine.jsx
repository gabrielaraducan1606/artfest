import React, { useEffect, useMemo, useState } from "react";
import {
  FaMapMarkerAlt,
  FaBoxOpen,
  FaStar,
  FaFilter,
  FaSort,
} from "react-icons/fa";
import { useNavigate, useLocation } from "react-router-dom";
import Navbar from "../../../components/Navbar/Navbar";
import Footer from "../../../components/Footer/Footer";
import styles from "./Magazine.module.css";
import api from "../../../../api/api";
import StoreFilterModal from "./Modal/StoreFilterModal";
import StoreSortModal from "./Modal/StoreSortModal";

export default function Magazine() {
  const [stores, setStores] = useState([]);
  const [loading, setLoading] = useState(true);

  // UI state
  const [search, setSearch] = useState("");
  const [suggestions, setSuggestions] = useState([]);
  const [category, setCategory] = useState("");
  const [minRating, setMinRating] = useState("");
  const [sort, setSort] = useState("featured"); // featured | rating | products | name-asc | name-desc | newest
  const [showFilter, setShowFilter] = useState(false);
  const [showSort, setShowSort] = useState(false);
  const [typingTimeout, setTypingTimeout] = useState(null);

  const navigate = useNavigate();
  const location = useLocation();

  // Load stores
  useEffect(() => {
    const fetchStores = async () => {
      try {
        const { data } = await api.get("/seller/public");
        setStores(Array.isArray(data) ? data : []);
      } catch (err) {
        console.error("❌ Eroare la încărcarea magazinelor:", err);
      } finally {
        setLoading(false);
      }
    };
    fetchStores();
  }, []);

  // Read category from URL
  useEffect(() => {
  const params = new URLSearchParams(location.search);
  const urlCategory = params.get("categorie") || "";
  setCategory(urlCategory);
}, [location.search]);

  // Suggestions (client-side)
  const handleSearchChange = (e) => {
    const value = e.target.value;
    setSearch(value);
    if (typingTimeout) clearTimeout(typingTimeout);

    if (value.trim().length < 2) {
      setSuggestions([]);
      return;
    }
    setTypingTimeout(
      setTimeout(() => {
        const q = value.trim().toLowerCase();
        const s = stores
          .filter((st) =>
            (st.shopName || "").toLowerCase().includes(q)
          )
          .slice(0, 8);
        setSuggestions(s);
      }, 250)
    );
  };

  // Filter + sort
  const visibleStores = useMemo(() => {
    const q = search.trim().toLowerCase();

    let list = stores.filter((s) => {
      const matchesSearch = q
        ? (s.shopName || "").toLowerCase().includes(q) ||
          (s.city || "").toLowerCase().includes(q)
        : true;
      const matchesCategory = category ? s.category === category : true;
      const matchesRating = minRating
        ? (s.rating || 0) >= parseFloat(minRating)
        : true;
      return matchesSearch && matchesCategory && matchesRating;
    });

    switch (sort) {
      case "rating":
        list.sort((a, b) => (b.rating || 0) - (a.rating || 0));
        break;
      case "products":
        list.sort((a, b) => (b.productCount || 0) - (a.productCount || 0));
        break;
      case "name-asc":
        list.sort((a, b) => (a.shopName || "").localeCompare(b.shopName || ""));
        break;
      case "name-desc":
        list.sort((a, b) => (b.shopName || "").localeCompare(a.shopName || ""));
        break;
      case "newest":
        list.sort(
          (a, b) =>
            new Date(b.createdAt || b.updatedAt || 0) -
            new Date(a.createdAt || a.updatedAt || 0)
        );
        break;
      case "featured":
      default:
        list.sort((a, b) => {
          const r = (b.rating || 0) - (a.rating || 0);
          if (r !== 0) return r;
          const p = (b.productCount || 0) - (a.productCount || 0);
          if (p !== 0) return p;
          return (a.shopName || "").localeCompare(b.shopName || "");
        });
        break;
    }

    return list;
  }, [stores, search, category, minRating, sort]);

  return (
    <>
      <Navbar />
      <div className={styles.container}>
        <div className={styles.headerRow}>
          <h1>Magazine</h1>

          <div className={styles.actions}>
            <button onClick={() => setShowFilter(true)}>
              <FaFilter /> Filtrare
            </button>
            <button onClick={() => setShowSort(true)}>
              <FaSort /> Sortare
            </button>
          </div>
        </div>

        {/* Search with suggestions */}
        <div className={styles.searchBar}>
          <input
            type="text"
            placeholder="Caută magazin..."
            value={search}
            onChange={handleSearchChange}
          />
          {suggestions.length > 0 && (
            <ul className={styles.suggestions}>
              {suggestions.map((s) => (
                <li
                  key={s._id}
                  onClick={() => navigate(`/magazin/${s._id}`)}
                >
                  <img
                    src={
                      s.profileImageUrl ||
                      "https://via.placeholder.com/50?text=Logo"
                    }
                    alt={s.shopName}
                  />
                  <span
                    dangerouslySetInnerHTML={{
                      __html: (s.shopName || "").replace(
                        new RegExp(`(${search})`, "gi"),
                        "<mark>$1</mark>"
                      ),
                    }}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Grid */}
        {loading ? (
          <p>Se încarcă...</p>
        ) : visibleStores.length === 0 ? (
          <p>Nu am găsit magazine care să corespundă filtrelor.</p>
        ) : (
          <div className={styles.grid}>
            {visibleStores.map((store) => (
              <div
                key={store._id}
                className={styles.card}
                onClick={() => navigate(`/magazin/${store._id}`)}
              >
                <img
                  src={
                    store.profileImageUrl ||
                    "https://via.placeholder.com/100x100?text=Logo"
                  }
                  alt={store.shopName}
                  className={styles.logo}
                />
                <h3 className={styles.title}>{store.shopName}</h3>

                <div className={styles.rating}>
                  {[...Array(5)].map((_, i) => (
                    <FaStar
                      key={i}
                      className={styles.star}
                      color={i < Math.round(store.rating || 0) ? "#ffc107" : "#e4e5e9"}
                    />
                  ))}
                  <span className={styles.ratingValue}>
                    ({(store.rating || 0).toFixed(1)})
                  </span>
                </div>

                <p className={styles.location}>
                  <FaMapMarkerAlt /> {store.city || "-"}, {store.country || "-"}
                </p>
                <p className={styles.products}>
                  <FaBoxOpen /> {store.productCount || 0} produse
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Modale */}
      <StoreFilterModal
        show={showFilter}
        onClose={() => setShowFilter(false)}
        selected={{ category, minRating }}
        onSelect={({ category: c, minRating: r }) => {
          if (typeof c !== "undefined") {
            setCategory(c);
            // reflectă în URL (opțional)
            const url = c ? `/magazine?categorie=${encodeURIComponent(c)}` : "/magazine";
            navigate(url, { replace: true });
          }
          if (typeof r !== "undefined") setMinRating(r);
          setShowFilter(false);
        }}
      />

      <StoreSortModal
        show={showSort}
        onClose={() => setShowSort(false)}
        selected={sort}
        onSelect={(val) => {
          setSort(val);
          setShowSort(false);
        }}
      />

      <Footer />
    </>
  );
}
