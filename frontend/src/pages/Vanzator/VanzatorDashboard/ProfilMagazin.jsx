import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import api from "../../../components/services/api";
import Navbar from "../../../components/HomePage/Navbar/Navbar";
import Footer from "../../../components/HomePage/Footer/Footer";
import { FaUserCircle, FaStar } from "react-icons/fa";
import styles from "./ProfilMagazin.module.css";
import {
  productPlaceholder,
  avatarPlaceholder,
  onImgError,
} from "../../../components/utils/imageFallback";

const isObjectId = (s = "") => /^[0-9a-fA-F]{24}$/.test(s);

// ✅ DOAR câmpuri esențiale lipsă, fără onboardingStep/status
const getMissingFields = (shop = {}) => {
  const missing = [];
  if (!shop.shopName || shop.shopName.trim().length < 2) missing.push("shopName");
  if (!shop.shortDescription || shop.shortDescription.trim().length < 10) missing.push("shortDescription");
  if (!shop.city || !shop.country) missing.push("location");
  return missing;
};

export default function ProfilMagazin() {
  const { handle } = useParams();
  const navigate = useNavigate();

  const [sellerData, setSellerData] = useState(null);
  const [products, setProducts] = useState([]);
  const [reviews, setReviews] = useState([]);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [myRating, setMyRating] = useState(0);

  const [userRole, setUserRole] = useState(null);
  const [isOwner, setIsOwner] = useState(false);

  const [showReviewModal, setShowReviewModal] = useState(false);

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);

  const token = localStorage.getItem("authToken");

  useEffect(() => {
    let mounted = true;

    async function fetchData() {
      setLoading(true);
      setErr(null);
      setNeedsOnboarding(false);

      try {
        let user = {};
        if (token) {
          try {
            const payload = JSON.parse(atob(token.split(".")[1] || ""));
            user = payload || {};
            if (mounted) setUserRole(payload?.role || null);
          } catch {""}
        }

        let shop;
        try {
          if (handle) {
            const sellerRes = await api.get(`/seller/public/resolve/${encodeURIComponent(handle)}`);
            shop = sellerRes.data;
          } else {
            const meRes = await api.get(`/seller/me`);
            shop = meRes.data;
            if (mounted) setIsOwner(true);
          }
        } catch (e) {
          const status = e?.response?.status;
          if (!handle && (status === 404 || status === 400)) {
            if (mounted) {
              setNeedsOnboarding(true);
              setSellerData(null);
              setProducts([]);
              setReviews([]);
              setRating(0);
            }
            setLoading(false);
            return;
          }
          throw e;
        }

        if (mounted && handle && isObjectId(handle) && shop.slug) {
          navigate(`/magazin/${shop.slug}`, { replace: true });
        }

        if (mounted) {
          setSellerData(shop);
          const userIsOwner = (!handle && true) || (user?.id && user.id === shop.userId);
          setIsOwner(userIsOwner);
        }

        try {
          const prodRes = await api.get(`/products/by-seller/${shop.userId}`);
          if (mounted) setProducts(Array.isArray(prodRes.data) ? prodRes.data : []);
        } catch {
          if (mounted) setProducts([]);
        }

        try {
          const [revRes, avgRes] = await Promise.all([
            api.get(`/reviews/seller/${shop._id}`),
            api.get(`/reviews/seller/${shop._id}/average`),
          ]);
          if (mounted) {
            setReviews(Array.isArray(revRes.data) ? revRes.data : []);
            setRating(Number(avgRes.data?.average || 0));
          }
        } catch {
          if (mounted) {
            setReviews([]);
            setRating(0);
          }
        }
      } catch (error) {
        console.error("Eroare încărcare profil magazin:", error);
        if (mounted) setErr("Nu am putut încărca magazinul.");
      } finally {
        if (mounted) setLoading(false);
      }
    }

    fetchData();
    return () => {
      mounted = false;
    };
  }, [handle, token, navigate]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const wantsReview = params.get("review") === "true";
    if (wantsReview && token && userRole) {
      setShowReviewModal(true);
    }
  }, [token, userRole]);

  // ⛳ Redirect doar dacă lipsesc câmpuri-cheie
  useEffect(() => {
  if (!handle && sellerData) {
    // ✅ Bypass redirect dacă tocmai ai semnat contractul și ai venit din Step3
    const params = new URLSearchParams(window.location.search);
    const cameFromContract = params.get("from") === "contract_signed";
    if (cameFromContract) return;

    // ✅ Dacă backend-ul a setat deja onboardingStep >= 3 și status=active, nu redirecționa
    const step = Number(sellerData.onboardingStep || 0);
    const active = sellerData.status === "active";
    if (step >= 3 && active) return;

    // 🔧 fallback pe verificarea veche
    const missing = getMissingFields(sellerData);
    if (missing.length > 0) {
      navigate("/vanzator/informatii", {
        replace: true,
        state: { reason: "incomplete_shop", missing },
      });
    }
  }
}, [handle, sellerData, navigate]);


  const handleReviewSubmit = async (e) => {
    e.preventDefault();
    try {
      await api.post(`/reviews/seller/${sellerData._id}`, { rating: myRating, comment });
      setComment("");
      setMyRating(0);
      setShowReviewModal(false);

      const [revRes, avgRes] = await Promise.all([
        api.get(`/reviews/seller/${sellerData._id}`),
        api.get(`/reviews/seller/${sellerData._id}/average`),
      ]);
      setReviews(Array.isArray(revRes.data) ? revRes.data : []);
      setRating(Number(avgRes.data?.average || 0));
    } catch (error) {
      console.error("Eroare trimitere recenzie:", error);
    }
  };

  const renderStars = (value) => (
    <span className={styles.stars}>
      {[...Array(5)].map((_, i) => (
        <FaStar key={i} className={i < value ? styles.starFull : styles.starEmpty} />
      ))}
    </span>
  );

  const renderReviewModal = () => (
    <div className={styles.modalBackdrop}>
      <div className={styles.modalContent}>
        <button className={styles.modalClose} onClick={() => setShowReviewModal(false)}>
          ×
        </button>
        {token && userRole === "user" ? (
          <form onSubmit={handleReviewSubmit}>
            <label>Rating</label>
            <select value={myRating} onChange={(e) => setMyRating(Number(e.target.value))} required>
              <option value={0}>Alege rating</option>
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n} stele
                </option>
              ))}
            </select>

            <label>Comentariu (opțional)</label>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Scrie părerea ta..."
              className={styles.reviewTextarea}
            />
            <button type="submit">Trimite recenzia</button>
          </form>
        ) : (
          <div className={styles.loginPrompt}>
            <p>Vrei să lași o recenzie?</p>
            <a href="/login">Autentifică-te sau creează cont</a>
          </div>
        )}
      </div>
    </div>
  );

  // ================= UI states =================
  if (loading) {
    return (
      <>
        <Navbar />
        <div style={{ padding: "2rem" }}>Se încarcă…</div>
        <Footer />
      </>
    );
  }

  // Seller logat fără magazin creat (404/400 la /seller/me)
  if (needsOnboarding) {
    return (
      <>
        <Navbar />
        <div style={{ padding: "2rem" }}>
          <h2 style={{ marginBottom: 8 }}>Încă nu ai configurat magazinul</h2>
          <p style={{ marginBottom: 16 }}>Pentru a-ți publica magazinul, completează pașii de onboarding.</p>
          <button
            type="button"
            className={styles.followBtn}
            onClick={() => navigate("/vanzator/informatii")}
          >
            Continuă crearea magazinului
          </button>
        </div>
        <Footer />
      </>
    );
  }

  // Profil public invalid / eroare
  if (err || !sellerData) {
    return (
      <>
        <Navbar />
        <div style={{ padding: "2rem" }}>
          {err || "Magazinul nu a fost găsit."}
          {isOwner && (
            <div style={{ marginTop: 16 }}>
              <button
                type="button"
                className={styles.followBtn}
                onClick={() => navigate("/vanzator/informatii")}
              >
                Continuă crearea magazinului
              </button>
            </div>
          )}
        </div>
        <Footer />
      </>
    );
  }

  const {
    shopName,
    shortDescription,
    about,
    city,
    country,
    address,
    slug,
    coverImageUrl,
    profileImageUrl,
    tags = [],
    email,
    website,
  } = sellerData;

  return (
    <>
      <Navbar />
      <div className={styles.wrapper}>
        <div className={styles.cover}>
          {coverImageUrl ? (
            <img
              src={coverImageUrl}
              className={styles.coverImg}
              alt="Copertă"
              onError={(e) => onImgError(e, 1200, 360, "Cover")}
            />
          ) : (
            <img src={productPlaceholder(1200, 360, "Cover")} className={styles.coverImg} alt="Copertă" />
          )}
        </div>

        <div className={styles.card}>
          {/* Header */}
          <div className={styles.headerRow}>
            <div className={styles.avatarWrap}>
              {profileImageUrl ? (
                <img
                  src={profileImageUrl}
                  className={styles.avatar}
                  alt="Profil"
                  onError={(e) => onImgError(e, 160, 160, "Profil")}
                />
              ) : (
                <img src={avatarPlaceholder(160, "Profil")} className={styles.avatar} alt="Profil" />
              )}
            </div>
            <div>
              <h1 className={styles.title}>{shopName}</h1>
              <p className={styles.subtitle}>{shortDescription}</p>
              {!!slug && <div className={styles.slug}>{window.location.origin}/magazin/{slug}</div>}
            </div>
            {!isOwner && (
              <div className={styles.actions}>
                <button className={styles.followBtn}>Urmărește</button>
              </div>
            )}
          </div>

          <hr className={styles.hr} />

          {/* Despre */}
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Despre</h2>
            <p className={styles.about}>{about || "—"}</p>
          </section>

          <hr className={styles.hr} />

          {/* Informații */}
          <section className={styles.section}>
            <h3 className={styles.subheading}>Informații magazin</h3>
            <div className={styles.meta}>
              {tags.length > 0 && (
                <div className={styles.metaRow}>
                  <span className={styles.metaLabel}>Tag-uri</span>
                  <div className={styles.tags}>
                    {tags.map((t, i) => (
                      <span key={i} className={styles.tag}>
                        {t}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              <div className={styles.metaRow}>
                <span className={styles.metaLabel}>Locație</span>
                <span className={styles.metaValue}>
                  {city}, {country}
                </span>
              </div>
              {address && (
                <div className={styles.metaRow}>
                  <span className={styles.metaLabel}>Adresă</span>
                  <span className={styles.metaValue}>{address}</span>
                </div>
              )}
              {email && (
                <div className={styles.metaRow}>
                  <span className={styles.metaLabel}>Email</span>
                  <a href={`mailto:${email}`} className={styles.link}>
                    {email}
                  </a>
                </div>
              )}
              {website && (
                <div className={styles.metaRow}>
                  <span className={styles.metaLabel}>Website</span>
                  <a href={website} target="_blank" rel="noreferrer" className={styles.link}>
                    {website}
                  </a>
                </div>
              )}
            </div>
          </section>

          {/* Produse */}
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Produse</h2>
            <div className={styles.productList}>
              {products.length === 0 ? (
                <div className={styles.emptyBox}>Acest magazin nu are produse momentan.</div>
              ) : (
                products.map((p) => (
                  <div key={p._id} className={styles.card} onClick={() => navigate(`/produs/${p._id}`)}>
                    <img
                      src={p.images?.[0] || productPlaceholder(600, 450, "Produs")}
                      alt={p.title}
                      className={styles.image}
                      onError={(e) => onImgError(e, 600, 450, "Produs")}
                    />
                    <div className={styles.cardBody}>
                      <h4 className={styles.cardTitle}>{p.title}</h4>
                      <p className={styles.price}>{p.price} RON</p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>

          {/* Recenzii */}
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Recenzii</h2>
            <div className={styles.ratingRow}>
              <span className={styles.ratingValue}>{rating.toFixed(1)}</span>
              {renderStars(Math.round(rating))}
              <span className={styles.muted}>{reviews.length} recenzii</span>
            </div>

            {reviews.map((r, i) => (
              <div key={i} className={styles.reviewItem}>
                <div className={styles.reviewAvatarWrap}>
                  {r.userAvatar ? (
                    <img
                      src={r.userAvatar}
                      className={styles.reviewAvatar}
                      alt={r.userName}
                      onError={(e) => onImgError(e, 48, 48, "")}
                    />
                  ) : (
                    <div className={styles.reviewAvatarPlaceholder}>
                      <FaUserCircle />
                    </div>
                  )}
                </div>
                <div className={styles.reviewBody}>
                  <div className={styles.reviewHeader}>
                    <span className={styles.reviewName}>{r.userName}</span>
                    {renderStars(r.rating)}
                  </div>
                  <p className={styles.reviewText}>{r.comment}</p>
                </div>
              </div>
            ))}

            {!isOwner && (
              <div style={{ marginTop: "20px" }}>
                {userRole === "user" ? (
                  <button className={styles.followBtn} onClick={() => setShowReviewModal(true)}>
                    Scrie o recenzie
                  </button>
                ) : (
                  <p className={styles.loginPrompt}>
                    Vrei să lași o recenzie? <a href="/login">Autentifică-te</a> sau{" "}
                    <a href="/inregistrare">Creează cont</a>.
                  </p>
                )}
              </div>
            )}
          </section>
        </div>
      </div>

      {showReviewModal && renderReviewModal()}
      <Footer />
    </>
  );
}
