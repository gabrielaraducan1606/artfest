// src/pages/Magazine/ProfilMagazinPublic.jsx
import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { FaMapMarkerAlt, FaStar } from "react-icons/fa";
import Navbar from "../../../components/Navbar/Navbar";
import Footer from "../../../components/Footer/Footer";
import api from "../../../api";
import styles from "./ProfilMagazinPublic.module.css";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000";

// 🔧 Funcție utilitară pentru a normaliza URL-urile imaginilor
function normalizeImageUrl(url) {
  if (!url) return null;
  if (url.startsWith("http")) {
    return url.replace(/^https?:\/\/files\.example\.com/, API_URL);
  }
  return `${API_URL}${url.startsWith("/") ? "" : "/"}${url}`;
}

export default function PublicMagazin() {
  const { id } = useParams(); // _id din Seller
  const navigate = useNavigate();
  const [sellerData, setSellerData] = useState(null);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchStoreData = async () => {
      try {
        // 1️⃣ Preluăm datele publice ale magazinului
        const sellerRes = await api.get(`/seller/public/${id}`);
        const seller = sellerRes.data;

        // Normalizăm imaginile de profil și cover
        seller.profileImageUrl = normalizeImageUrl(seller.profileImageUrl);
        seller.coverImageUrl = normalizeImageUrl(seller.coverImageUrl);

        setSellerData(seller);

        // 2️⃣ Preluăm produsele magazinului folosind userId
        if (seller.userId) {
          const prodRes = await api.get(`/products/by-seller/${seller.userId}`);
          const fixedProducts = prodRes.data.map((p) => ({
            ...p,
            images: p.images?.map((img) => normalizeImageUrl(img)),
          }));
          setProducts(Array.isArray(fixedProducts) ? fixedProducts : []);
        }
      } catch (err) {
        console.error("❌ Eroare la încărcarea magazinului:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchStoreData();
  }, [id]); // ✅ fără warning

  if (loading) {
    return (
      <>
        <Navbar />
        <div className={styles.loading}>Se încarcă...</div>
        <Footer />
      </>
    );
  }

  if (!sellerData) {
    return (
      <>
        <Navbar />
        <div className={styles.error}>Magazin inexistent</div>
        <Footer />
      </>
    );
  }

  return (
    <>
      <Navbar />
      <div className={styles.container}>
        {/* Header magazin */}
        <div className={styles.sellerHeader}>
          {sellerData.profileImageUrl ? (
            <img
              src={sellerData.profileImageUrl}
              alt={sellerData.shopName}
              className={styles.logo}
            />
          ) : (
            <div className={styles.logoPlaceholder}></div>
          )}
          <div>
            <h1 className={styles.shopName}>{sellerData.shopName}</h1>
            <div className={styles.rating}>
              {[...Array(5)].map((_, i) => (
                <FaStar
                  key={i}
                  color={i < Math.round(sellerData.rating || 0) ? "#ffc107" : "#e4e5e9"}
                />
              ))}
              <span>({sellerData.rating?.toFixed(1) || "0.0"})</span>
            </div>
            <p className={styles.shopLocation}>
              <FaMapMarkerAlt /> {sellerData.city}, {sellerData.country}
            </p>
            <p className={styles.shopDescription}>
              {sellerData.shortDescription || "Fără descriere"}
            </p>
          </div>
        </div>

        {/* Lista produse */}
        <h2 className={styles.sectionTitle}>Produsele magazinului</h2>
        {products.length === 0 ? (
          <p>Acest magazin nu are produse disponibile momentan.</p>
        ) : (
          <div className={styles.productList}>
            {products.map((prod) => (
              <div
                key={prod._id}
                className={styles.card}
                onClick={() => navigate(`/produs/${prod._id}`)}
              >
                {prod.images?.[0] ? (
                  <img
                    src={prod.images[0]}
                    alt={prod.title}
                    className={styles.image}
                  />
                ) : (
                  <div className={styles.noImage}>Fără imagine</div>
                )}
                <div className={styles.cardBody}>
                  <h4 className={styles.cardTitle}>{prod.title}</h4>
                  <p className={styles.price}>{prod.price} lei</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      <Footer />
    </>
  );
}
