import React, { useEffect, useState } from "react";
import { FaMapMarkerAlt, FaBoxOpen, FaStar } from "react-icons/fa";
import Navbar from "../../../components/Navbar/Navbar";
import Footer from "../../../components/Footer/Footer";
import styles from "./Magazine.module.css";
import api from "../../../api";

export default function Magazine() {
  const [magazine, setMagazine] = useState([]);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [minRating, setMinRating] = useState("");
  const [loading, setLoading] = useState(true);

  // 📌 Încărcare magazine
  useEffect(() => {
    const fetchStores = async () => {
      try {
        const { data } = await api.get("/seller/public");
        setMagazine(data);
      } catch (err) {
        console.error("❌ Eroare la încărcarea magazinelor:", err);
      } finally {
        setLoading(false);
      }
    };
    fetchStores();
  }, []);

  // 📌 Filtrare magazine (folosind direct datele din backend)
  const filteredStores = magazine.filter((store) => {
    const matchesSearch = store.shopName
      .toLowerCase()
      .includes(search.toLowerCase());
    const matchesCategory = category ? store.category === category : true;
    const matchesRating = minRating
      ? store.rating >= parseFloat(minRating)
      : true;

    return matchesSearch && matchesCategory && matchesRating;
  });

  return (
    <>
      <Navbar />
      <div className={styles.container}>
        <h1>Magazine</h1>

        {/* FILTRE */}
        <div className={styles.filters}>
          <input
            type="text"
            placeholder="Caută magazin..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            <option value="">Toate categoriile</option>
            <option value="Invitații">Invitații</option>
            <option value="Mărturii">Mărturii</option>
            <option value="Trusouri">Trusouri</option>
            <option value="Decor">Decor</option>
          </select>
          <select
            value={minRating}
            onChange={(e) => setMinRating(e.target.value)}
          >
            <option value="">Toate rating-urile</option>
            <option value="4">Minim 4 ⭐</option>
            <option value="3">Minim 3 ⭐</option>
            <option value="2">Minim 2 ⭐</option>
          </select>
        </div>

        {/* LISTĂ MAGAZINE */}
        {loading ? (
          <p>Se încarcă...</p>
        ) : filteredStores.length === 0 ? (
          <p>Nu am găsit magazine care să corespundă filtrelor.</p>
        ) : (
          <div className={styles.grid}>
            {filteredStores.map((store) => (
              <div
                key={store._id}
                className={styles.card}
                onClick={() => (window.location.href = `/magazin/${store._id}`)}
              >
                <img
                  src={
                    store.profileImageUrl ||
                    "https://via.placeholder.com/100x100?text=Logo"
                  }
                  alt={store.shopName}
                  className={styles.logo}
                />
                <h3>{store.shopName}</h3>
                <div className={styles.rating}>
                  {[...Array(5)].map((_, i) => (
                    <FaStar
                      key={i}
                      color={i < Math.round(store.rating) ? "#ffc107" : "#e4e5e9"}
                    />
                  ))}
                  <span className={styles.ratingValue}>
                    ({store.rating.toFixed(1)})
                  </span>
                </div>
                <p className={styles.location}>
                  <FaMapMarkerAlt /> {store.city}, {store.country}
                </p>
                <p className={styles.products}>
                  <FaBoxOpen /> {store.productCount || 0} produse
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
      <Footer />
    </>
  );
}
