// src/pages/vanzator/VanzatorDashboard.jsx
import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../../../../api/api";
import Navbar from "../../../components/Navbar/Navbar";
import Footer from "../../../components/Footer/Footer"; // ✅ import footer
import styles from "./VanzatorDashboard.module.css";

export default function VanzatorDashboard() {
  const [sellerData, setSellerData] = useState(null);
  const [products, setProducts] = useState([]);
  const navigate = useNavigate();

  useEffect(() => {
    const fetchSellerData = async () => {
      const token = localStorage.getItem("authToken");
      if (!token) {
        navigate("/login", { replace: true });
        return;
      }

      try {
        const sellerRes = await api.get("/seller/me", {
          headers: { Authorization: `Bearer ${token}` },
        });
        setSellerData(sellerRes.data);

        const prodRes = await api.get("/products/my", {
          headers: { Authorization: `Bearer ${token}` },
        });
        setProducts(Array.isArray(prodRes.data) ? prodRes.data : []);
      } catch (err) {
        const status = err?.response?.status;
        if (status === 404) {
          navigate("/vanzator/completare-profil", { replace: true });
          return;
        }
        if (status === 401) {
          navigate("/login", { replace: true });
          return;
        }
        console.error("❌ Eroare dashboard:", err);
      }
    };

    fetchSellerData();
  }, [navigate]);

  return (
    <>
      <Navbar />
      <div className={styles.container}>
        {sellerData && (
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
              <p className={styles.shopDescription}>
                {sellerData.shortDescription || "Fără descriere"}
              </p>
              <p className={styles.shopLocation}>
                📍 {sellerData.city}, {sellerData.country}
              </p>
            </div>
          </div>
        )}

        <h2 className={styles.sectionTitle}>Produsele magazinului</h2>
        <div className={styles.productList}>
  {products.map((prod) => (
    <div
      key={prod._id}
      className={styles.card}
      onClick={() => navigate(`/produs/${prod._id}`)}
      style={{ cursor: "pointer" }}
    >
      {prod.image ? (
        <img src={prod.image} alt={prod.title} className={styles.image} />
      ) : (
        <div className={styles.noImage}>Fără imagine</div>
      )}
      <div className={styles.cardBody}>
        <h4 className={styles.cardTitle}>{prod.title}</h4>
        <p className={styles.price}>{prod.price} lei</p>
        <p className={styles.desc}>
          {prod.description
            ? prod.description.substring(0, 80) + "..."
            : "Fără descriere"}
        </p>
      </div>
    </div>
  ))}
</div>
      </div>

      {/* ✅ Footer integrat */}
      <Footer />
    </>
  );
}
