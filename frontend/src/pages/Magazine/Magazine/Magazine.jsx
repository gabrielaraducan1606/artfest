import React, { useEffect, useMemo, useRef, useState } from "react";
import { FaMapMarkerAlt, FaBoxOpen, FaStar, FaFilter, FaSort } from "react-icons/fa";
import { useNavigate, useSearchParams } from "react-router-dom";
import Navbar from "../../../components/HomePage/Navbar/Navbar";
import Footer from "../../../components/HomePage/Footer/Footer";
import styles from "./Magazine.module.css";
import api from "../../../components/services/api";
import StoreFilterModal from "../Modal/StoreFilterModal";
import StoreSortModal from "../Modal/StoreSortModal";

/* helper: diacritics-insensitive */
const norm = (s = "") =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

function highlight(text, query) {
  if (!query) return [text];
  const t = text ?? "";
  const nT = norm(t);
  const nQ = norm(query);
  const i = nT.indexOf(nQ);
  if (i < 0) return [t];
  const end = i + nQ.length;
  return [t.slice(0, i), <mark key="m">{t.slice(i, end)}</mark>, t.slice(end)];
}

export default function Magazine() {
  const [stores, setStores] = useState([]);
  const [loading, setLoading] = useState(true);

  // UI state controlate de URL
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const [search, setSearch] = useState(params.get("q") || "");
  const [category, setCategory] = useState(params.get("categorie") || "");
  const [minRating, setMinRating] = useState(params.get("minRating") || "");
  const [sort, setSort] = useState(params.get("sort") || "featured");

  const [suggestions, setSuggestions] = useState([]);
  const [showFilter, setShowFilter] = useState(false);
  const [showSort, setShowSort] = useState(false);
  const typingRef = useRef(null);

  // Load stores (public)
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const { data } = await api.get("/seller/public");
        if (mounted) setStores(Array.isArray(data) ? data : []);
      } catch (err) {
        console.error("❌ Eroare la încărcarea magazinelor:", err);
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, []);

  // 2-way sync cu URL: când URL-ul se schimbă (back/forward), actualizează state
  useEffect(() => {
    setSearch(params.get("q") || "");
    setCategory(params.get("categorie") || "");
    setMinRating(params.get("minRating") || "");
    setSort(params.get("sort") || "featured");
  }, [params]);

  // Debounce sugestii pe client
  const onChangeSearch = (e) => {
    const value = e.target.value;
    setSearch(value);

    // scrie în URL (q=) ca să fie navigabilă căutarea
    const next = new URLSearchParams(params);
    if (value.trim()) next.set("q", value.trim());
    else next.delete("q");
    next.set("page", "1");
    setParams(next, { replace: true });

    if (typingRef.current) clearTimeout(typingRef.current);
    if (value.trim().length < 2) {
      setSuggestions([]);
      return;
    }
    typingRef.current = setTimeout(() => {
      const q = norm(value);
      const list = stores
        .filter((st) => norm(st.shopName || "").includes(q))
        .slice(0, 8);
      setSuggestions(list);
    }, 250);
  };

  const resetFilters = () => {
    const next = new URLSearchParams(params);
    ["q", "categorie", "minRating", "sort", "page"].forEach((k) => next.delete(k));
    setParams(next, { replace: true });
    setSearch("");
    setCategory("");
    setMinRating("");
    setSort("featured");
    setSuggestions([]);
  };

  // Filtrare + sortare locală
  const visibleStores = useMemo(() => {
    const q = norm(search);
    let list = stores.filter((s) => {
      const matchesSearch = q
        ? norm(s.shopName || "").includes(q) || norm(s.city || "").includes(q)
        : true;
      const matchesCategory = category ? s.category === category : true;
      const matchesRating = minRating ? (s.rating || 0) >= parseFloat(minRating) : true;
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
        list.sort((a, b) => (a.shopName || "").localeCompare(b.shopName || "", "ro"));
        break;
      case "name-desc":
        list.sort((a, b) => (b.shopName || "").localeCompare(a.shopName || "", "ro"));
        break;
      case "newest":
        list.sort(
          (a, b) =>
            new Date(b.createdAt || b.updatedAt || 0) - new Date(a.createdAt || a.updatedAt || 0)
        );
        break;
      case "featured":
      default:
        list.sort((a, b) => {
          const r = (b.rating || 0) - (a.rating || 0);
          if (r !== 0) return r;
          const p = (b.productCount || 0) - (a.productCount || 0);
          if (p !== 0) return p;
          return (a.shopName || "").localeCompare(b.shopName || "", "ro");
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
            <button onClick={resetFilters} className={styles.resetBtn}>
              Resetează filtrele
            </button>
          </div>
        </div>

        {/* Search + sugestii */}
        <div className={styles.searchBar}>
          <input
            type="text"
            placeholder="Caută magazin..."
            value={search}
            onChange={onChangeSearch}
          />
          {suggestions.length > 0 && (
            <ul className={styles.suggestions}>
              {suggestions.map((s) => (
                <li key={s._id} onClick={() => navigate(`/magazin/${s._id}`)}>
                  <img
                    src={s.profileImageUrl || "https://via.placeholder.com/50?text=Logo"}
                    alt={s.shopName}
                  />
                  <span>{highlight(s.shopName || "", search)}</span>
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
                  src={store.profileImageUrl || "https://via.placeholder.com/100x100?text=Logo"}
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
          const next = new URLSearchParams(params);
          if (typeof c !== "undefined") {
            setCategory(c);
            if (c) next.set("categorie", c);
            else next.delete("categorie");
            next.set("page", "1");
          }
          if (typeof r !== "undefined") {
            setMinRating(r);
            if (r) next.set("minRating", String(r));
            else next.delete("minRating");
          }
          setParams(next, { replace: true });
          setShowFilter(false);
        }}
      />

      <StoreSortModal
        show={showSort}
        onClose={() => setShowSort(false)}
        selected={sort}
        onSelect={(val) => {
          setSort(val);
          const next = new URLSearchParams(params);
          next.set("sort", val);
          setParams(next, { replace: true });
          setShowSort(false);
        }}
      />

      <Footer />
    </>
  );
}
