import React, { useCallback, useEffect, useRef, useState } from "react";
import { FaFilter, FaSort, FaStar, FaHeart, FaShoppingCart } from "react-icons/fa";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import Navbar from "../../components/HomePage/Navbar/Navbar";
import Footer from "../../components/HomePage/Footer/Footer";
import styles from "./ProductsPage.module.css";
import api from "../../components/services/api";
import FilterModal from "./Modal/FilterModal";
import SortModal from "./Modal/SortModal";
import { toast, ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import { useAppContext } from "../../components/Context/useAppContext";
import { productPlaceholder, thumbPlaceholder, onImgError } from "../../components/utils/imageFallback";

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

// handle pentru link-ul magazinului (slug || username || _id)
const sellerHandle = (s) => s?.slug || s?.username || s?._id;

export default function ProductsPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();

  // URL → state
  const [search, setSearch] = useState(params.get("q") || "");
  const [category, setCategory] = useState(params.get("categorie") || params.get("category") || "");
  const [sort, setSort] = useState(params.get("sort") || "new"); // new | price-asc | price-desc | rating

  const [products, setProducts] = useState([]);
  const [suggestions, setSuggestions] = useState([]);
  const [loading, setLoading] = useState(true);

  // UI: modale
  const [showFilter, setShowFilter] = useState(false);
  const [showSort, setShowSort] = useState(false);

  const typingRef = useRef(null);

  const { cart, setCart, favorites, setFavorites } = useAppContext();
  const isAuthed = !!localStorage.getItem("authToken");

  // Back/forward sync
  useEffect(() => {
    setSearch(params.get("q") || "");
    setCategory(params.get("categorie") || params.get("category") || "");
    setSort(params.get("sort") || "new");
  }, [params]);

  const fetchProducts = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/products/public", {
        params: {
          search: search || undefined,
          category: category || undefined,
          sort,
        },
      });
      setProducts(Array.isArray(data?.products) ? data.products : []);
    } catch (err) {
      console.error("❌ Eroare la încărcarea produselor:", err);
      setProducts([]);
    } finally {
      setLoading(false);
    }
  }, [search, category, sort]);

  useEffect(() => {
    fetchProducts();
  }, [fetchProducts]);

  // Sugestii server
  const fetchSuggestions = async (query) => {
    try {
      const { data } = await api.get("/products/suggestions", { params: { query } });
      setSuggestions(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("❌ Eroare la sugestii:", err);
    }
  };

  const onChangeSearch = (e) => {
    const value = e.target.value;
    setSearch(value);

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
    typingRef.current = setTimeout(() => fetchSuggestions(value), 300);
  };

  const resetFilters = () => {
    const next = new URLSearchParams(params);
    ["q", "categorie", "category", "min", "max", "sort", "page"].forEach((k) => next.delete(k));
    setParams(next, { replace: true });
    setSearch("");
    setCategory("");
    setSort("new");
    setSuggestions([]);
  };

  const handleToggleWishlist = async (product, e) => {
    e.stopPropagation();
    const exists = favorites.some((fav) => fav._id === product._id);

    if (!isAuthed) {
      const updated = exists ? favorites.filter((f) => f._id !== product._id) : [...favorites, product];
      setFavorites(updated);
      localStorage.setItem("wishlist", JSON.stringify(updated));
      toast.success(exists ? "Produs scos din lista de dorințe!" : "Produs adăugat la lista de dorințe!");
      return;
    }

    try {
      if (exists) await api.delete(`/wishlist/${product._id}`);
      else await api.post(`/wishlist/${product._id}`);
      const { data } = await api.get("/wishlist");
      setFavorites(data);
      toast.success(exists ? "Produs scos din lista de dorințe!" : "Produs adăugat la lista de dorințe!");
    } catch {
      toast.error("A apărut o problemă cu lista de dorințe.");
    }
  };

  const handleAddToCart = async (product, e) => {
    e.stopPropagation();
    if (!isAuthed) {
      const updated = [...cart, { ...product, qty: 1 }];
      setCart(updated);
      localStorage.setItem("cart", JSON.stringify(updated));
      toast.success("Produs adăugat în coș!");
      return;
    }
    try {
      await api.post(`/cart/${product._id}`, { qty: 1 });
      const { data } = await api.get("/cart");
      setCart(data);
      toast.success("Produs adăugat în coș!");
    } catch {
      toast.error("Nu s-a putut adăuga în coș.");
    }
  };

  return (
    <>
      <Navbar />

      <div className={styles.container}>
        <div className={styles.headerRow}>
          <h1>Produse</h1>
          <div className={styles.actions}>
            <button onClick={resetFilters}>Resetează filtrele</button>
            <button onClick={() => navigate(0)} title="Reîncarcă">↻</button>
            <button onClick={() => setShowFilter(true)}>
              <FaFilter /> Filtrare
            </button>
            <button onClick={() => setShowSort(true)}>
              <FaSort /> Sortare
            </button>
          </div>
        </div>

        {/* Search cu sugestii */}
        <div className={styles.searchBar}>
          <input
            type="text"
            placeholder="Caută produs..."
            value={search}
            onChange={onChangeSearch}
          />
          {suggestions.length > 0 && (
            <ul className={styles.suggestions}>
              {suggestions.map((s) => (
                <li key={s._id} onClick={() => navigate(`/produs/${s._id}`)}>
                  <img
                    src={s.images?.[0] || thumbPlaceholder(50)}
                    alt={s.title}
                    loading="lazy"
                    width={50}
                    height={50}
                    onError={(e) => onImgError(e, 50, 50, "")}
                  />
                  <span>{highlight(s.title, search)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Grid produse */}
        {loading ? (
          <p>Se încarcă...</p>
        ) : products.length === 0 ? (
          <p>Nu am găsit produse.</p>
        ) : (
          <div className={styles.grid}>
            {products.map((product) => (
              <article
                key={product._id}
                className={styles.card}
                onClick={() => navigate(`/produs/${product._id}`)}
              >
                <button
                  className={styles.imageButton}
                  onClick={(e) => { e.stopPropagation(); navigate(`/produs/${product._id}`); }}
                  aria-label={`Deschide ${product.title}`}
                >
                  <div className={styles.imageWrap}>
                    <img
                      src={product.images?.[0] || productPlaceholder(600, 450, "Produs")}
                      alt={product.title}
                      className={styles.productImage}
                      loading="lazy"
                      onError={(e) => onImgError(e, 600, 450, "Produs")}
                    />
                  </div>
                </button>

                <h3 className={styles.name} title={product.title}>{product.title}</h3>

                <div className={styles.metaRow}>
                  <div className={styles.rating}>
                    {[...Array(5)].map((_, i) => (
                      <FaStar
                        key={i}
                        color={
                          i < Math.round(product.rating || product.avgRating || 0)
                            ? "var(--rating-on)"
                            : "var(--rating-off)"
                        }
                      />
                    ))}
                    {(product.reviewCount ?? 0) > 0 && (
                      <span className={styles.reviewsCount}>({product.reviewCount})</span>
                    )}
                  </div>
                  <p className={styles.price}>{Number(product.price).toFixed(2)} lei</p>
                </div>

                <div className={styles.bottomRow}>
                  {product.seller ? (
                    <Link
                      to={`/magazin/${sellerHandle(product.seller)}`}
                      className={styles.shopLink}
                      onClick={(e) => e.stopPropagation()}
                      title={product.seller.shopName || "Magazin"}
                    >
                      {product.seller.shopName || "Magazin"}
                    </Link>
                  ) : (
                    <span className={styles.shopPlaceholder}>—</span>
                  )}

                  <div className={styles.iconBar} onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={(e) => handleToggleWishlist(product, e)}
                      className={styles.iconBtn}
                      title="Adaugă la favorite"
                    >
                      <FaHeart
                        color={
                          favorites.some((fav) => fav._id === product._id)
                            ? "var(--color-primary)"
                            : "var(--color-text)"
                        }
                      />
                    </button>
                    <button
                      onClick={(e) => handleAddToCart(product, e)}
                      className={styles.iconBtn}
                      title="Adaugă în coș"
                    >
                      <FaShoppingCart />
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>

      {/* Modale funcționale */}
      <FilterModal
        show={showFilter}
        onClose={() => setShowFilter(false)}
        selected={category}
        onSelect={(cat) => {
          setCategory(cat);
          const next = new URLSearchParams(params);
          if (cat) next.set("categorie", encodeURIComponent(cat));
          else next.delete("categorie");
          next.set("page", "1");
          setParams(next, { replace: true });
          setShowFilter(false);
        }}
      />
      <SortModal
        show={showSort}
        onClose={() => setShowSort(false)}
        selected={sort}
        onSelect={(s) => {
          setSort(s);
          const next = new URLSearchParams(params);
          next.set("sort", s);
          setParams(next, { replace: true });
          setShowSort(false);
        }}
      />

      <Footer />
      <ToastContainer position="bottom-right" />
    </>
  );
}
