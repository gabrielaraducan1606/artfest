// src/pages/Produse/DetaliiProdus.jsx
import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import api from "../../api";
import Navbar from "../../components/Navbar/Navbar";
import styles from "./DetaliiProdus.module.css";

export default function DetaliiProdus() {
  const { id } = useParams();
  const [product, setProduct] = useState(null);
  const [loading, setLoading] = useState(true);
  const [currentImage, setCurrentImage] = useState(0);
  const navigate = useNavigate();

  useEffect(() => {
    const fetchProduct = async () => {
      try {
        const { data } = await api.get(`/products/public/${id}`);
        setProduct(data);
      } catch (err) {
        console.error("❌ Eroare la încărcarea produsului:", err);
      } finally {
        setLoading(false);
      }
    };
    fetchProduct();
  }, [id]);

  if (loading) return <div className={styles.loading}>Se încarcă...</div>;
  if (!product) return <div className={styles.error}>Produs inexistent</div>;

  const images = Array.isArray(product.images) && product.images.length > 0
    ? product.images
    : product.image
    ? [product.image]
    : [];

  const handlePrev = () => {
    setCurrentImage((prev) => (prev === 0 ? images.length - 1 : prev - 1));
  };

  const handleNext = () => {
    setCurrentImage((prev) => (prev === images.length - 1 ? 0 : prev + 1));
  };

  return (
    <>
      <Navbar />
      <div className={styles.pageWrapper}>
        <div className={styles.container}>
          {/* 🖼️ Carusel / Imagine */}
          <div className={styles.imageWrapper}>
            {images.length > 0 ? (
              <>
                <img src={images[currentImage]} alt={product.title} />
                {images.length > 1 && (
                  <>
                    <button className={styles.prevBtn} onClick={handlePrev}>
                      ❮
                    </button>
                    <button className={styles.nextBtn} onClick={handleNext}>
                      ❯
                    </button>
                  </>
                )}
              </>
            ) : (
              <div className={styles.noImage}>Fără imagine</div>
            )}
          </div>

          {/* 📄 Detalii produs */}
          <div className={styles.details}>
            <h1 className={styles.title}>{product.title}</h1>
            <p className={styles.price}>{product.price} lei</p>
            <p className={styles.description}>{product.description}</p>

            {/* 🔘 Butoane acțiuni */}
            <div className={styles.buttons}>
              <button className={styles.favBtn}>❤️ Adaugă la favorite</button>
              <button className={styles.cartBtn}>🛒 Adaugă în coș</button>
            </div>

            {/* 📌 Info vânzător */}
            {product.seller && (
              <div
                className={styles.sellerCard}
                onClick={() => navigate(`/magazin/${product.seller._id}`)}
              >
                {product.seller.profileImageUrl ? (
                  <img
                    src={product.seller.profileImageUrl}
                    alt={product.seller.shopName}
                    className={styles.sellerLogo}
                  />
                ) : (
                  <div className={styles.sellerLogoPlaceholder}></div>
                )}
                <div>
                  <p className={styles.sellerName}>
                    {product.seller.shopName}
                  </p>
                  <p className={styles.sellerLocation}>
                    📍 {product.seller.city}, {product.seller.country}
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
