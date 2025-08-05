import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { FaStar } from "react-icons/fa";
import api from "../../api";
import Navbar from "../../components/Navbar/Navbar";
import styles from "./DetaliiProdus.module.css";
import { toast, ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import { useAppContext } from "../../components/Context/useAppContext";

export default function DetaliiProdus() {
  const { id } = useParams();
  const [product, setProduct] = useState(null);
  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [currentImage, setCurrentImage] = useState(0);
  const [newRating, setNewRating] = useState(0);
  const [comment, setComment] = useState("");

  const { cart, setCart, favorites, setFavorites } = useAppContext();
  const isAuthed = !!localStorage.getItem("authToken");
  const navigate = useNavigate();

  useEffect(() => {
    const fetchProductAndReviews = async () => {
      try {
        const prodRes = await api.get(`/products/public/${id}`);
        setProduct(prodRes.data);

        if (prodRes.data?.sellerId?._id) {
          const revRes = await api.get(`/reviews/seller/${prodRes.data.sellerId._id}`);
          setReviews(revRes.data);
        }
      } catch (err) {
        console.error("❌ Eroare la încărcarea datelor produsului:", err);
      } finally {
        setLoading(false);
      }
    };
    fetchProductAndReviews();
  }, [id]);

  const images = Array.isArray(product?.images) && product.images.length > 0
    ? product.images
    : product?.image
    ? [product.image]
    : [];

  const handlePrev = () => {
    setCurrentImage((prev) => (prev === 0 ? images.length - 1 : prev - 1));
  };

  const handleNext = () => {
    setCurrentImage((prev) => (prev === images.length - 1 ? 0 : prev + 1));
  };

  const handleAddToCart = () => {
    if (!isAuthed) {
      const updated = [...cart, { ...product, qty: 1 }];
      setCart(updated);
      localStorage.setItem("cart", JSON.stringify(updated));
      toast.success("Produs adăugat în coș!");
      return;
    }
    api.post(`/cart/${product._id}`, { qty: 1 })
      .then(() => toast.success("Produs adăugat în coș!"))
      .catch(() => toast.error("Eroare la adăugare în coș"));
  };

  const handleToggleWishlist = () => {
    const exists = favorites.some((fav) => fav._id === product._id);
    if (!isAuthed) {
      const updated = exists
        ? favorites.filter((fav) => fav._id !== product._id)
        : [...favorites, product];
      setFavorites(updated);
      localStorage.setItem("wishlist", JSON.stringify(updated));
      toast.success(exists ? "Scos din favorite!" : "Adăugat la favorite!");
      return;
    }
    if (exists) {
      api.delete(`/wishlist/${product._id}`).then(() => toast.success("Scos din favorite!"));
    } else {
      api.post(`/wishlist/${product._id}`).then(() => toast.success("Adăugat la favorite!"));
    }
  };

  const handleSubmitReview = async () => {
    if (!isAuthed) {
      navigate("/login");
      return;
    }
    if (newRating < 1) {
      toast.error("Te rog alege un rating.");
      return;
    }
    try {
      await api.post(`/reviews/seller/${product.sellerId._id}`, {
        rating: newRating,
        comment
      });
      toast.success("Recenzie adăugată!");
      setComment("");
      setNewRating(0);
      const revRes = await api.get(`/reviews/seller/${product.sellerId._id}`);
      setReviews(revRes.data);
    } catch {
  toast.error("Eroare la trimiterea recenziei.");
}
  };

  if (loading) return <div className={styles.loading}>Se încarcă...</div>;
  if (!product) return <div className={styles.error}>Produs inexistent</div>;

  return (
    <>
      <Navbar />
      <div className={styles.pageWrapper}>
        <div className={styles.container}>
          {/* 🖼️ Carusel */}
          <div className={styles.imageWrapper}>
            {images.length > 0 ? (
              <>
                <img src={images[currentImage]} alt={product.title} />
                {images.length > 1 && (
                  <>
                    <button className={styles.prevBtn} onClick={handlePrev}>❮</button>
                    <button className={styles.nextBtn} onClick={handleNext}>❯</button>
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

            <div className={styles.rating}>
              {[...Array(5)].map((_, i) => (
                <FaStar
                  key={i}
                  color={i < Math.round(product.avgRating || 0) ? "#ffc107" : "#e4e5e9"}
                />
              ))}
              <span>({reviews.length} recenzii)</span>
            </div>

            <p className={styles.description}>{product.description}</p>

            {/* Butoane */}
            <div className={styles.buttons}>
              <button className={styles.favBtn} onClick={handleToggleWishlist}>❤️ Favorite</button>
              <button className={styles.cartBtn} onClick={handleAddToCart}>🛒 Coș</button>
            </div>

            {/* Info vânzător */}
            {product.sellerId && (
              <div
                className={styles.sellerCard}
                onClick={() => navigate(`/magazin/${product.sellerId._id}`)}
              >
                {product.sellerId.profileImageUrl ? (
                  <img
                    src={product.sellerId.profileImageUrl}
                    alt={product.sellerId.shopName}
                    className={styles.sellerLogo}
                  />
                ) : (
                  <div className={styles.sellerLogoPlaceholder}></div>
                )}
                <div>
                  <p className={styles.sellerName}>{product.sellerId.shopName}</p>
                  <p className={styles.sellerLocation}>
                    📍 {product.sellerId.city}, {product.sellerId.country}
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Recenzii */}
        <div className={styles.reviewsSection}>
          <h2>Recenzii</h2>

          {reviews.length === 0 && <p>Nu există recenzii pentru acest vânzător.</p>}

          {reviews.map((rev) => (
            <div key={rev._id} className={styles.review}>
              <strong>{rev.userName}</strong>
              <div className={styles.ratingSmall}>
                {[...Array(5)].map((_, i) => (
                  <FaStar
                    key={i}
                    size={14}
                    color={i < rev.rating ? "#ffc107" : "#e4e5e9"}
                  />
                ))}
              </div>
              <p>{rev.comment}</p>
            </div>
          ))}

          {/* Formular adăugare recenzie */}
          <div className={styles.addReview}>
            <h3>Lasă o recenzie</h3>
            <div className={styles.starsSelect}>
              {[...Array(5)].map((_, i) => (
                <FaStar
                  key={i}
                  size={20}
                  onClick={() => setNewRating(i + 1)}
                  color={i < newRating ? "#ffc107" : "#e4e5e9"}
                  style={{ cursor: "pointer" }}
                />
              ))}
            </div>
            <textarea
              placeholder="Scrie un comentariu..."
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />
            <button onClick={handleSubmitReview}>Trimite recenzia</button>
          </div>
        </div>
      </div>
      <ToastContainer position="bottom-right" />
    </>
  );
}
