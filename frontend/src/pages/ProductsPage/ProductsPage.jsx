import React, { useEffect, useState, useCallback } from "react";
import {
  FaFilter,
  FaSort,
  FaStar,
  FaHeart,
  FaShoppingCart,
} from "react-icons/fa";
import { useNavigate, useLocation } from "react-router-dom";
import Navbar from "../../components/Navbar/Navbar";
import Footer from "../../components/Footer/Footer";
import styles from "./ProductsPage.module.css";
import api from "../../../api/api";
import FilterModal from "./Modal/FilterModal";
import SortModal from "./Modal/SortModal";
import { toast, ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import { useAppContext } from "../../components/Context/useAppContext";

export default function ProductsPage() {
  const [products, setProducts] = useState([]);
  const [suggestions, setSuggestions] = useState([]);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [sort, setSort] = useState("new");
  const [showFilter, setShowFilter] = useState(false);
  const [showSort, setShowSort] = useState(false);
  const [loading, setLoading] = useState(true);
  const [typingTimeout, setTypingTimeout] = useState(null);

  const { cart, setCart, favorites, setFavorites } = useAppContext();
  const isAuthed = !!localStorage.getItem("authToken");
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const urlCategory = params.get("categorie") || "";
    setCategory(urlCategory);
  }, [location.search]);

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
      setProducts(data.products);
    } catch (err) {
      console.error("❌ Eroare la încărcarea produselor:", err);
    } finally {
      setLoading(false);
    }
  }, [search, category, sort]);

  useEffect(() => {
    fetchProducts();
  }, [fetchProducts]);

  const fetchSuggestions = async (query) => {
    if (!query.trim()) {
      setSuggestions([]);
      return;
    }
    try {
      const { data } = await api.get("/products/suggestions", {
        params: { query },
      });
      setSuggestions(data);
    } catch (err) {
      console.error("❌ Eroare la sugestii:", err);
    }
  };

  const handleSearchChange = (e) => {
    const value = e.target.value;
    setSearch(value);

    if (typingTimeout) clearTimeout(typingTimeout);
    if (value.trim().length < 2) {
      setSuggestions([]);
      return;
    }
    setTypingTimeout(setTimeout(() => fetchSuggestions(value), 300));
  };

  const handleToggleWishlist = async (product, e) => {
    e.stopPropagation();
    const exists = favorites.some((fav) => fav._id === product._id);

    if (!isAuthed) {
      const updated = exists
        ? favorites.filter((fav) => fav._id !== product._id)
        : [...favorites, product];
      setFavorites(updated);
      localStorage.setItem("wishlist", JSON.stringify(updated));
      toast.success(
        exists ? "Produs scos din lista de dorințe!" : "Produs adăugat la lista de dorințe!"
      );
      return;
    }

    try {
      if (exists) {
        await api.delete(`/wishlist/${product._id}`);
      } else {
        await api.post(`/wishlist/${product._id}`);
      }
      const { data } = await api.get("/wishlist");
      setFavorites(data);
      toast.success(
        exists ? "Produs scos din lista de dorințe!" : "Produs adăugat la lista de dorințe!"
      );
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
        <h1>Produse</h1>

        <div className={styles.actions}>
          <button onClick={() => setShowFilter(true)}>
            <FaFilter /> Filtrare
          </button>
          <button onClick={() => setShowSort(true)}>
            <FaSort /> Sortare
          </button>
        </div>

        <div className={styles.searchBar}>
          <input
            type="text"
            placeholder="Caută produs..."
            value={search}
            onChange={handleSearchChange}
          />
          {suggestions.length > 0 && (
            <ul className={styles.suggestions}>
              {suggestions.map((s) => (
                <li key={s._id} onClick={() => navigate(`/produs/${s._id}`)}>
                  <img
                    src={s.images?.[0] || "https://via.placeholder.com/50"}
                    alt={s.title}
                  />
                  <span
                    dangerouslySetInnerHTML={{
                      __html: s.title.replace(
                        new RegExp(`(${search})`, "gi"),
                        "<mark>$1</mark>"
                      ),
                    }}
                  ></span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {loading ? (
          <p>Se încarcă...</p>
        ) : products.length === 0 ? (
          <p>Nu am găsit produse.</p>
        ) : (
          <div className={styles.grid}>
            {products.map((product) => (
              <div
                key={product._id}
                className={styles.card}
                onClick={() => navigate(`/produs/${product._id}`)}
              >
                <div className={styles.imageWrapper}>
                  <img
                    src={product.images?.[0] || "https://via.placeholder.com/300"}
                    alt={product.title}
                    className={styles.productImage}
                  />
                </div>
                <h3>{product.title}</h3>
                <div className={styles.rating}>
                  {[...Array(5)].map((_, i) => (
                    <FaStar
                      key={i}
                      color={i < Math.round(product.rating || 0) ? "#ffc107" : "#e4e5e9"}
                    />
                  ))}
                </div>
                <p className={styles.price}>{product.price} lei</p>
                <p className={styles.seller}>{product.sellerId?.shopName}</p>
                <div className={styles.iconBar}>
                  <button
                    onClick={(e) => handleToggleWishlist(product, e)}
                    className={styles.iconBtn}
                    title="Adaugă la favorite"
                  >
                    <FaHeart
                      color={
                        favorites.some((fav) => fav._id === product._id)
                          ? "#C1E1C1"
                          : "#000"
                      }
                    />
                  </button>
                  <button
                    onClick={(e) => handleAddToCart(product, e)}
                    className={styles.iconBtn}
                    title="Adaugă în coș"
                  >
                    <FaShoppingCart color="#3F3F3F" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <FilterModal
        show={showFilter}
        onClose={() => setShowFilter(false)}
        selected={category}
        onSelect={(cat) => {
          setCategory(cat);
          setShowFilter(false);
          navigate(`/produse?categorie=${encodeURIComponent(cat)}`);
        }}
      />

      <SortModal
        show={showSort}
        onClose={() => setShowSort(false)}
        selected={sort}
        onSelect={(s) => {
          setSort(s);
          setShowSort(false);
        }}
      />

      <Footer />
      <ToastContainer position="bottom-right" />
    </>
  );
}
