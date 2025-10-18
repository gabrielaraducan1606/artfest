// client/src/pages/Store/ProfilMagazin.jsx
import React, { useEffect, useMemo, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { createPortal } from "react-dom";
import { api } from "../../../lib/api";
import styles from "./ProfilMagazin.module.css";
import {
  FaUserCircle,
  FaStar,
  FaCopy,
  FaPlus,
  FaEdit,
  FaTrash,
  FaShoppingCart,
  FaHeart,
  FaRegHeart,
} from "react-icons/fa";
import {
  productPlaceholder,
  avatarPlaceholder,
  onImgError,
} from "../../../components/utils/imageFallback";

/* ========= FALLBACK categorii (identic cu backend) ========= */
const FALLBACK_CATEGORIES = [
  "Invitatii",
  "Papetarie-eveniment",
  "Meniuri",
  "Place cards",
  "Plicuri bani",
  "Decoratiuni",
  "Aranjamente-florale",
  "Baloane",
  "Lumini-decor",
  "Tablouri",
  "Textile",
  "Marturii",
  "Cadouri",
  "Bijuterii",
  "Accesorii",
  "Ceramica",
  "Lemn",
  "Tort",
  "Rochii domnișoare de onoare",
  "Organizator",
  "invitatie-digitala",
  "Album-qr",
  "Seating-sms",
];

/* ========= Helpers URL + cache-buster ========= */
const BACKEND_BASE = (import.meta.env.VITE_API_URL || "").replace(/\/+$/, "");
const isHttp = (u = "") => /^https?:\/\//i.test(u);
const isDataOrBlob = (u = "") => /^(data|blob):/i.test(u);

const resolveFileUrl = (u) => {
  if (!u) return "";
  if (isHttp(u) || isDataOrBlob(u)) return u;
  const path = u.startsWith("/") ? u : `/${u}`;
  return BACKEND_BASE ? `${BACKEND_BASE}${path}` : path;
};

const withCache = (url, t) => {
  if (!url || !isHttp(url)) return url;
  return url.includes("?") ? `${url}&t=${t}` : `${url}?t=${t}`;
};

/* ===================== Modal generic (portal) ===================== */
function Modal({ open, onClose, children, maxWidth = 640 }) {
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") onClose?.(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      className={styles.modalBackdrop}
      onMouseDown={() => onClose?.()}
      role="presentation"
    >
      <div
        className={styles.modalContent}
        style={{ ["--modal-w"]: `${maxWidth}px` }}
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        {children}
      </div>
    </div>,
    document.body
  );
}

export default function ProfilMagazin() {
  const { slug } = useParams();
  const navigate = useNavigate();

  const [sellerData, setSellerData] = useState(null);
  const [products, setProducts] = useState([]);
  const [reviews, setReviews] = useState([]);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [myRating, setMyRating] = useState(0);

  const [me, setMe] = useState(null);
  const [isOwner, setIsOwner] = useState(false);

  const [showReviewModal, setShowReviewModal] = useState(false);

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);

  const [copied, setCopied] = useState(false);

  // favorite local (set de productId)
  const [favorites, setFavorites] = useState(() => new Set());

  // categorii pentru dropdown (preluate din backend, cu fallback)
  const [categories, setCategories] = useState(FALLBACK_CATEGORIES);

  // ===== modal produs (create/edit) =====
  const [prodModalOpen, setProdModalOpen] = useState(false);
  const [savingProd, setSavingProd] = useState(false);
  const [editingProduct, setEditingProduct] = useState(null); // null => create
  const [prodForm, setProdForm] = useState({
    title: "",
    description: "",
    price: "",
    images: [],
    category: "",
  });

  /* ===== GATE: acceptări vendor ===== */
  const [gateOpen, setGateOpen] = useState(false);
  const [gateLoading, setGateLoading] = useState(false);
  const [gateErr, setGateErr] = useState("");
  const [gateDocs, setGateDocs] = useState({}); // meta din backend
  const [gateChecks, setGateChecks] = useState({ vendor: false, shipping: false, returns: false });

  async function loadVendorAcceptances() {
    setGateLoading(true);
    setGateErr("");
    try {
      const d = await api("/api/vendor/acceptances");
      const needVendor = !(d?.accepted?.vendor_terms);
      const needShip   = !(d?.accepted?.shipping_addendum);
      const needRet    = !(d?.accepted?.returns_policy); // opțional

      setGateDocs(d?.legalMeta || {});
      setGateChecks({
        vendor: !needVendor,
        shipping: !needShip,
        returns: !needRet,
      });

      const allOK = !needVendor && !needShip; // retur doar informativ
      return { allOK };
    } catch (e) {
      setGateErr(e?.message || "Nu s-a putut verifica acordurile.");
      return { allOK: false };
    } finally {
      setGateLoading(false);
    }
  }

  async function acceptVendorDocs() {
    try {
      const payload = [];
      if (gateChecks.vendor && gateDocs.vendor_terms) {
        payload.push({
          type: "vendor_terms",
          version: gateDocs.vendor_terms.version,
          checksum: gateDocs.vendor_terms.checksum,
        });
      }
      if (gateChecks.shipping && gateDocs.shipping_addendum) {
        payload.push({
          type: "shipping_addendum",
          version: gateDocs.shipping_addendum.version,
          checksum: gateDocs.shipping_addendum.checksum,
        });
      }
      if (gateChecks.returns && gateDocs.returns) {
        payload.push({
          type: "returns",
          version: gateDocs.returns.version,
          checksum: gateDocs.returns.checksum,
        });
      }
      if (!payload.length) return;

      await api("/api/legal/vendor-accept", { method: "POST", body: { accept: payload } });
      setGateOpen(false);

      // deschide imediat formularul de produs
      setEditingProduct(null);
      setProdForm({ title: "", description: "", price: "", images: [], category: "" });
      setProdModalOpen(true);
    } catch (e) {
      setGateErr(e?.message || "Eroare la salvarea acceptărilor.");
    }
  }

  /* ========= fetch combinat ========= */
  const fetchEverything = useCallback(async () => {
    setLoading(true);
    setErr(null);
    setNeedsOnboarding(false);
    try {
      // 0) categorii (sync cu backend)
      try {
        const list = await api("/api/public/categories");
        if (Array.isArray(list) && list.length) setCategories(list);
      } catch { /* fallback-ul rămâne */ }

      // 1) me
      let meNow = null;
      try {
        const d = await api("/api/auth/me");
        meNow = d?.user || null;
        setMe(meNow);
      } catch {
        setMe(null);
      }

      // 2) profil magazin public
      let shop;
      try {
        const seller = await api(`/api/public/store/${encodeURIComponent(slug)}`);
        shop = seller;
      } catch (e) {
        if ([404, 400].includes(e?.status)) {
          setErr("Magazinul nu a fost găsit.");
          setSellerData(null);
          setProducts([]);
          setReviews([]);
          setRating(0);
          setLoading(false);
          return;
        }
        throw e;
      }
      setSellerData(shop);

      // 3) e owner?
      const owner =
        !!meNow && !!shop?.userId && (meNow.id === shop.userId || meNow.sub === shop.userId);
      setIsOwner(owner);

      // 4) produse
      try {
        const prod = await api(`/api/public/store/${encodeURIComponent(slug)}/products`);
        setProducts(Array.isArray(prod) ? prod : []);
      } catch {
        setProducts([]);
      }

      // 4b) favorite
      try {
        const fav = await api("/api/favorites");
        const ids = new Set((Array.isArray(fav?.items) ? fav.items : []).map((x) => x.productId));
        setFavorites(ids);
      } catch { /* ignore */ }

      // 5) recenzii (placeholder)
      try {
        const [rev, avg] = await Promise.all([
          api(`/api/public/store/${encodeURIComponent(slug)}/reviews`),
          api(`/api/public/store/${encodeURIComponent(slug)}/reviews/average`),
        ]);
        setReviews(Array.isArray(rev) ? rev : []);
        setRating(Number(avg?.average || 0));
      } catch {
        setReviews([]);
        setRating(0);
      }
    } catch (error) {
      console.error("Eroare încărcare profil magazin:", error);
      setErr("Nu am putut încărca magazinul.");
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => { fetchEverything(); }, [fetchEverything]);

  // cache-buster pe imagini http/https
  const cacheT = useMemo(
    () => (sellerData?.updatedAt ? new Date(sellerData.updatedAt).getTime() : Date.now()),
    [sellerData?.updatedAt]
  );

  const viewMode = isOwner ? "vendor" : (me ? "user" : "guest");

  const requireAuth = (fn) => (...args) => {
    if (!me) {
      const redirect = encodeURIComponent(window.location.pathname);
      navigate(`/autentificare?redirect=${redirect}`);
      return;
    }
    return fn(...args);
  };

  const copyProfileLink = async () => {
    if (!sellerData?.slug) return;
    const url = `${window.location.origin}/magazin/${sellerData.slug}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = url;
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      } catch { /* noop */ }
      document.body.removeChild(ta);
    }
  };

  async function uploadFile(file) {
    const fd = new FormData();
    fd.append("file", file); // numele câmpului TREBUIE să fie "file" (multer.single('file'))
   const { url } = await api("/api/upload", {
     method: "POST",
     body: fd,
   });
   return url;
 }

  // --- PATCH: înlocuim openNewProduct cu varianta care verifică acceptările
  const openNewProduct = async () => {
    if (!isOwner) return;
    const { allOK } = await loadVendorAcceptances();
    if (allOK) {
      setEditingProduct(null);
      setProdForm({ title: "", description: "", price: "", images: [], category: "" });
      setProdModalOpen(true);
    } else {
      setGateOpen(true);
    }
  };

  const openEditProduct = async (p) => {
    // dacă vrei să blochezi și editarea până acceptă:
    const { allOK } = await loadVendorAcceptances();
    if (!allOK) { setGateOpen(true); return; }

    setEditingProduct(p);
    setProdForm({
      title: p.title || "",
      description: p.description || "",
      price: p.price ?? "",
      images: Array.isArray(p.images) ? p.images : [],
      category: p.category || "",
    });
    setProdModalOpen(true);
  };

  const onSaveProduct = async (e) => {
    e?.preventDefault?.();
    if (!prodForm.title?.trim()) return alert("Te rog adaugă un titlu.");
    const priceNum = Number(prodForm.price);
    if (Number.isNaN(priceNum) || priceNum < 0) return alert("Preț invalid.");
    if (!prodForm.category?.trim()) return alert("Te rog selectează o categorie.");

    try {
      setSavingProd(true);
      const body = {
        title: prodForm.title.trim(),
        description: prodForm.description?.trim() || "",
        price: priceNum,
        images: prodForm.images || [],
        category: prodForm.category?.trim() || null,
      };

      if (editingProduct && (editingProduct.id || editingProduct._id)) {
        const id = editingProduct.id || editingProduct._id;
        await api(`/api/vendor/products/${encodeURIComponent(id)}`, { method: "PUT", body });
      } else {
        await api(`/api/vendor/store/${encodeURIComponent(slug)}/products`, { method: "POST", body });
      }

      setProdModalOpen(false);
      setEditingProduct(null);
      setProdForm({ title: "", description: "", price: "", images: [], category: "" });
      await fetchEverything();
    } catch (e2) {
      console.error(e2);
      alert(e2?.message || "Nu am putut salva produsul.");
    } finally {
      setSavingProd(false);
    }
  };

  const onDeleteProduct = async (p) => {
    if (!p) return;
    if (!confirm("Ștergi acest produs?")) return;
    try {
      const id = p.id || p._id;
      await api(`/api/vendor/products/${encodeURIComponent(id)}`, { method: "DELETE" });
      await fetchEverything();
    } catch (e2) {
      console.error(e2);
      alert(e2?.message || "Nu am putut șterge produsul.");
    }
  };

  const onAddToCart = async (p) => {
    if (isOwner) return;
    try {
      await api(`/api/cart/add`, { method: "POST", body: { productId: p.id || p._id, qty: 1 } });
      alert("Produs adăugat în coș.");
    } catch (e2) {
      console.error(e2);
      alert(e2?.message || "Nu am putut adăuga în coș.");
    }
  };

  const onToggleFavorite = async (p) => {
    if (!me || isOwner) return;
    const pid = p.id || p._id;
    const next = new Set(favorites);
    const isFav = next.has(pid);
    if (isFav) next.delete(pid);
    else next.add(pid);
    setFavorites(next);
    try {
      await api("/api/favorites/toggle", { method: "POST", body: { productId: pid } });
    } catch (e2) {
      const revert = new Set(next);
      if (isFav) revert.add(pid);
      else revert.delete(pid);
      setFavorites(revert);
      console.error(e2);
    }
  };

  const addToCartSafe = requireAuth(onAddToCart);
  const toggleFavSafe = requireAuth(onToggleFavorite);

  const ProductActions = ({ p, isFav, viewMode }) => {
    if (viewMode === "vendor") {
      return (
        <div className={styles.ownerRow}>
          <button
            type="button"
            className={styles.followBtn}
            onClick={() => openEditProduct(p)}
            title="Editează"
            style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
          >
            <FaEdit /> Editează
          </button>
          <button
            type="button"
            className={styles.linkBtn}
            onClick={() => onDeleteProduct(p)}
            title="Șterge"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              color: "var(--color-danger, #ef4444)",
            }}
          >
            <FaTrash /> Șterge
          </button>
        </div>
      );
    }

    if (viewMode === "user") {
      return (
        <div className={styles.iconRow}>
          <button
            type="button"
            className={`${styles.iconBtnOutline} ${isFav ? styles.heartFilled : ""}`}
            onClick={() => toggleFavSafe(p)}
            title={isFav ? "Elimină din favorite" : "Adaugă la favorite"}
            aria-pressed={isFav}
            aria-label={isFav ? "Elimină din favorite" : "Adaugă la favorite"}
          >
            {isFav ? <FaHeart /> : <FaRegHeart />}
          </button>

          <button
            type="button"
            className={styles.iconBtn}
            onClick={() => addToCartSafe(p)}
            title="Adaugă în coș"
            aria-label="Adaugă în coș"
          >
            <FaShoppingCart />
          </button>
        </div>
      );
    }

    return (
      <div className={styles.iconRow}>
        <button
          type="button"
          className={styles.iconBtnOutline}
          onClick={() =>
            navigate("/autentificare?redirect=" + encodeURIComponent(window.location.pathname))
          }
          title="Autentifică-te pentru a salva la favorite"
          aria-label="Autentifică-te pentru a salva la favorite"
        >
          <FaRegHeart />
        </button>
        <button
          type="button"
          className={styles.iconBtn}
          onClick={() =>
            navigate("/autentificare?redirect=" + encodeURIComponent(window.location.pathname))
          }
          title="Autentifică-te pentru a adăuga în coș"
          aria-label="Autentifică-te pentru a adăuga în coș"
        >
          <FaShoppingCart />
        </button>
      </div>
    );
  };

  if (loading) return <div style={{ padding: "2rem" }}>Se încarcă…</div>;

  if (needsOnboarding) {
    return (
      <div style={{ padding: "2rem" }}>
        <h2 style={{ marginBottom: 8 }}>Încă nu ai configurat magazinul</h2>
        <p style={{ marginBottom: 16 }}>
          Pentru a-ți publica magazinul, completează pașii de onboarding.
        </p>
        <button type="button" className={styles.followBtn} onClick={() => navigate("/onboarding")}>
          Continuă crearea magazinului
        </button>
      </div>
    );
  }

  if (err || !sellerData) {
    return (
      <div style={{ padding: "2rem" }}>
        {err || "Magazinul nu a fost găsit."}
        {isOwner && (
          <div style={{ marginTop: 16 }}>
            <button type="button" className={styles.followBtn} onClick={() => navigate("/onboarding")}>
              Continuă crearea magazinului
            </button>
          </div>
        )}
      </div>
    );
  }

  const {
    shopName,
    shortDescription,
    brandStory,
    city,
    country,
    address,
    slug: handle,
    coverImageUrl: coverRaw,
    profileImageUrl: avatarRaw,
    tags = [],
    publicEmail,
    phone,
    delivery = [],
    website,
  } = sellerData;

  const aboutText = brandStory ?? shortDescription ?? "—";

  const coverUrl = coverRaw ? withCache(resolveFileUrl(coverRaw), cacheT) : "";
  const avatarUrl = avatarRaw ? withCache(resolveFileUrl(avatarRaw), cacheT) : "";

  const prettyDelivery =
    Array.isArray(delivery) && delivery.length
      ? (delivery[0] === "counties" ? delivery.slice(1) : delivery).join(", ")
      : "";

  const renderStars = (value) => (
    <span className={styles.stars}>
      {[...Array(5)].map((_, i) => (
        <FaStar key={i} className={i < value ? styles.starFull : styles.starEmpty} />
      ))}
    </span>
  );

  const handleReviewSubmit = async (e) => {
    e.preventDefault();
    setComment("");
    setMyRating(0);
    setShowReviewModal(false);
  };

  return (
    <>
      <div className={styles.wrapper}>
        <div className={styles.cover}>
          {coverUrl ? (
            <img
              src={coverUrl}
              className={styles.coverImg}
              alt="Copertă"
              onError={(e) => onImgError(e, 1200, 360, "Cover")}
            />
          ) : (
            <img
              src={productPlaceholder(1200, 360, "Cover")}
              className={styles.coverImg}
              alt="Copertă"
            />
          )}
        </div>

        <div className={styles.card}>
          {/* Header */}
          <div className={styles.headerRow}>
            <div className={styles.avatarWrap}>
              {avatarUrl ? (
                <img
                  src={avatarUrl}
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
              {shortDescription && <p className={styles.subtitle}>{shortDescription}</p>}

              {!!handle && (
                <div className={styles.linkRow} style={{ marginTop: 6 }}>
                  <div className={styles.slug}>
                    {window.location.origin}/magazin/{handle}
                  </div>
                  <button
                    type="button"
                    className={styles.copyBtn}
                    onClick={copyProfileLink}
                    title="Copiază link-ul profilului"
                    aria-label="Copiază link-ul profilului"
                  >
                    <FaCopy size={14} />
                  </button>
                  {copied && (
                    <span className={styles.copiedBadge} style={{ fontWeight: 700 }}>
                      Copiat!
                    </span>
                  )}
                </div>
              )}
            </div>

            {viewMode !== "vendor" ? (
              <div className={styles.actions}>
                <button
                  className={styles.followBtn}
                  onClick={() =>
                    me
                      ? alert("Ai început să urmărești magazinul!")
                      : navigate("/autentificare?redirect=" + encodeURIComponent(window.location.pathname))
                  }
                >
                  Urmărește
                </button>
              </div>
            ) : (
              <div className={styles.actions} style={{ display: "flex", gap: 8 }}>
                <button
                  className={styles.followBtn}
                  onClick={() => navigate("/onboarding/details")}
                  title="Editează profilul magazinului"
                >
                  Editează profil
                </button>
                <button
                  className={styles.followBtn}
                  onClick={openNewProduct}
                  title="Adaugă produs"
                  style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
                >
                  <FaPlus /> Adaugă produs
                </button>
              </div>
            )}
          </div>

          <hr className={styles.hr} />

          {/* Despre */}
          {aboutText && (
            <>
              <section className={styles.section}>
                <h2 className={styles.sectionTitle}>Despre</h2>
                <p className={styles.about}>{aboutText}</p>
              </section>
              <hr className={styles.hr} />
            </>
          )}

          {/* Informații */}
          <section className={styles.section}>
            <h3 className={styles.subheading}>Informații magazin</h3>
            <div className={styles.meta}>
              {tags.length > 0 && (
                <div className={styles.metaRow}>
                  <span className={styles.metaLabel}>Tag-uri</span>
                  <div className={styles.tags}>
                    {tags.map((t, i) => (
                      <span key={i} className={styles.tag}>{t}</span>
                    ))}
                  </div>
                </div>
              )}

              <div className={styles.metaRow}>
                <span className={styles.metaLabel}>Locație</span>
                <span className={styles.metaValue}>
                  {city}{country ? `, ${country}` : ""}
                </span>
              </div>

              {address && (
                <div className={styles.metaRow}>
                  <span className={styles.metaLabel}>Adresă</span>
                  <span className={styles.metaValue}>{address}</span>
                </div>
              )}

              {prettyDelivery && (
                <div className={styles.metaRow}>
                  <span className={styles.metaLabel}>Zonă acoperire</span>
                  <span className={styles.metaValue}>{prettyDelivery}</span>
                </div>
              )}

              {publicEmail && (
                <div className={styles.metaRow}>
                  <span className={styles.metaLabel}>Email</span>
                  <a href={`mailto:${publicEmail}`} className={styles.link}>{publicEmail}</a>
                </div>
              )}

              {phone && (
                <div className={styles.metaRow}>
                  <span className={styles.metaLabel}>Telefon</span>
                  <a href={`tel:${phone}`} className={styles.link}>{phone}</a>
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

            {products.length === 0 && viewMode === "vendor" && (
              <div style={{ margin: "8px 0 14px" }}>
                <button
                  className={styles.followBtn}
                  onClick={openNewProduct}
                  style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
                >
                  <FaPlus /> Adaugă primul produs
                </button>
              </div>
            )}

            <div className={styles.productList}>
              {products.length === 0 ? (
                <div className={styles.emptyBox}>Acest magazin nu are produse momentan.</div>
              ) : (
                products.map((p) => {
                  const raw = Array.isArray(p.images) && p.images[0] ? p.images[0] : "";
                  const img = raw ? resolveFileUrl(raw) : productPlaceholder(600, 450, "Produs");
                  const pid = p.id || p._id;
                  const isFav = favorites.has(pid);
                  const cat = p.category || null;

                  return (
                    <div key={pid} className={styles.card}>
                      <img
                        src={img}
                        alt={p.title}
                        className={styles.image}
                        onError={(e) => onImgError(e, 600, 450, "Produs")}
                        onClick={() => navigate(`/produs/${pid}`)}
                        style={{ cursor: "pointer" }}
                      />
                      <div className={styles.cardBody}>
                        <h4
                          className={styles.cardTitle}
                          style={{ cursor: "pointer" }}
                          onClick={() => navigate(`/produs/${pid}`)}
                        >
                          {p.title}
                        </h4>

                        <div className={styles.cardMetaRow}>
                          {p.price != null && <p className={styles.price}>{p.price} RON</p>}
                          {cat && (
                            <button
                              type="button"
                              className={styles.catPill}
                              title={`Vezi produse în ${cat}`}
                              onClick={() => navigate(`/produse?categorie=${encodeURIComponent(cat)}`)}
                            >
                              {cat}
                            </button>
                          )}
                        </div>

                        <div className={styles.cardActions}>
                          <ProductActions p={p} isFav={isFav} viewMode={viewMode} />
                        </div>
                      </div>
                    </div>
                  );
                })
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

            {viewMode !== "vendor" && (
              <div style={{ marginTop: "20px" }}>
                {me ? (
                  <button className={styles.followBtn} onClick={() => setShowReviewModal(true)}>
                    Scrie o recenzie
                  </button>
                ) : (
                  <p className={styles.loginPrompt}>
                    Vrei să lași o recenzie? <a href="/autentificare">Autentifică-te</a> sau{" "}
                    <a href="/inregistrare">Creează cont</a>.
                  </p>
                )}
              </div>
            )}
          </section>
        </div>
      </div>

      {/* Modal recenzie */}
      <Modal open={showReviewModal} onClose={() => setShowReviewModal(false)}>
        <div className={styles.modalHeader}>
          <h3 className={styles.modalTitle}>Scrie o recenzie</h3>
          <button
            className={styles.modalClose}
            onClick={() => setShowReviewModal(false)}
            type="button"
            aria-label="Închide"
          >
            ×
          </button>
        </div>

        <div className={styles.modalBody}>
          {me ? (
            <form onSubmit={handleReviewSubmit} className={styles.formGrid}>
              <label className={styles.label}>Rating</label>
              <select
                value={myRating}
                onChange={(e) => setMyRating(Number(e.target.value))}
                required
                className={styles.input}
              >
                <option value={0}>Alege rating</option>
                {[1, 2, 3, 4, 5].map((n) => (
                  <option key={n} value={n}>{n} stele</option>
                ))}
              </select>

              <label className={styles.label}>Comentariu (opțional)</label>
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Scrie părerea ta..."
                className={styles.textarea}
                rows={5}
              />

              <div className={styles.modalFooter}>
                <button type="button" className={styles.linkBtn} onClick={() => setShowReviewModal(false)}>
                  Anulează
                </button>
                <button type="submit" className={styles.primaryBtn}>
                  Trimite recenzia
                </button>
              </div>
            </form>
          ) : (
            <div className={styles.loginPrompt}>
              <p>Vrei să lași o recenzie?</p>
              <a href="/autentificare">Autentifică-te sau creează cont</a>
            </div>
          )}
        </div>
      </Modal>

      {/* GATE: acceptări vendor */}
      <Modal open={gateOpen} onClose={() => (!gateLoading ? setGateOpen(false) : null)} maxWidth={720}>
        <div className={styles.modalHeader}>
          <h3 className={styles.modalTitle}>Finalizează acordurile pentru a continua</h3>
          <button
            className={styles.modalClose}
            onClick={() => (!gateLoading ? setGateOpen(false) : null)}
            disabled={gateLoading}
            type="button"
            aria-label="Închide"
          >
            ×
          </button>
        </div>

        <div className={styles.modalBody}>
          {gateLoading ? (
            <p>Se verifică acordurile…</p>
          ) : (
            <>
              <p>
                Pentru a adăuga produse, trebuie să accepți documentele de mai jos. Linkurile se deschid într-o filă nouă.
              </p>

              <label style={{display:"block", margin:"10px 0"}}>
                <input
                  type="checkbox"
                  checked={gateChecks.vendor}
                  onChange={e => setGateChecks(s => ({...s, vendor: e.target.checked}))}
                />{" "}
                Accept{" "}
                <a href={gateDocs?.vendor_terms?.url || "/legal/vendor/terms"} target="_blank" rel="noreferrer">
                  Acordul Marketplace pentru Vânzători {gateDocs?.vendor_terms?.version ? `(v${gateDocs.vendor_terms.version})` : ""}
                </a>
              </label>

              <label style={{display:"block", margin:"10px 0"}}>
                <input
                  type="checkbox"
                  checked={gateChecks.shipping}
                  onChange={e => setGateChecks(s => ({...s, shipping: e.target.checked}))}
                />{" "}
                Accept{" "}
                <a href={gateDocs?.shipping_addendum?.url || "/legal/vendor/expediere"} target="_blank" rel="noreferrer">
                  Anexa de Expediere & Curierat {gateDocs?.shipping_addendum?.version ? `(v${gateDocs.shipping_addendum.version})` : ""}
                </a>
              </label>

              <label style={{display:"block", margin:"10px 0"}}>
                <input
                  type="checkbox"
                  checked={gateChecks.returns}
                  onChange={e => setGateChecks(s => ({...s, returns: e.target.checked}))}
                />{" "}
                Confirm că am citit{" "}
                <a href={gateDocs?.returns?.url || "/retur"} target="_blank" rel="noreferrer">
                  Politica de retur {gateDocs?.returns?.version ? `(v${gateDocs.returns.version})` : ""}
                </a>{" "}
                <span style={{opacity:.7}}>(opțional)</span>
              </label>

              {!!gateErr && <div className={styles.error} style={{marginTop:8}}>{gateErr}</div>}

              <div className={styles.modalFooter}>
                <button
                  type="button"
                  className={styles.linkBtn}
                  onClick={() => (!gateLoading ? setGateOpen(false) : null)}
                  disabled={gateLoading}
                >
                  Renunță
                </button>
                <button
                  className={styles.primaryBtn}
                  onClick={acceptVendorDocs}
                  disabled={gateLoading || !(gateChecks.vendor && gateChecks.shipping)}
                  title={!(gateChecks.vendor && gateChecks.shipping) ? "Bifează acordurile obligatorii" : "Continuă"}
                >
                  Accept și continuă
                </button>
              </div>
            </>
          )}
        </div>
      </Modal>

      {/* Modal produs (Add/Edit) */}
      <Modal
        open={prodModalOpen}
        onClose={() => (!savingProd ? setProdModalOpen(false) : null)}
        maxWidth={700}
      >
        <div className={styles.modalHeader}>
          <h3 className={styles.modalTitle}>
            {editingProduct ? "Editează produs" : "Adaugă produs"}
          </h3>
          <button
            className={styles.modalClose}
            onClick={() => (!savingProd ? setProdModalOpen(false) : null)}
            disabled={savingProd}
            type="button"
            aria-label="Închide"
          >
            ×
          </button>
        </div>

        <div className={styles.modalBody}>
          <form onSubmit={onSaveProduct} className={styles.formGrid}>
            <label className={styles.label}>Titlu</label>
            <input
              className={styles.input}
              value={prodForm.title}
              onChange={(e) => setProdForm((s) => ({ ...s, title: e.target.value }))}
              placeholder="Ex: Coroniță florală din lavandă"
              required
            />

            <label className={styles.label}>Descriere</label>
            <textarea
              className={styles.textarea}
              value={prodForm.description}
              onChange={(e) => setProdForm((s) => ({ ...s, description: e.target.value }))}
              placeholder="Detalii despre material, dimensiuni, personalizare etc."
              rows={5}
            />

            <label className={styles.label}>Preț (RON)</label>
            <input
              type="number"
              step="0.01"
              min="0"
              className={styles.input}
              value={prodForm.price}
              onChange={(e) => setProdForm((s) => ({ ...s, price: e.target.value }))}
              placeholder="0.00"
              required
            />

            {/* Dropdown categorie (obligatoriu) */}
            <label className={styles.label}>Categorie</label>
            <select
              className={styles.select}
              value={prodForm.category}
              onChange={(e) => setProdForm((s) => ({ ...s, category: e.target.value }))}
              required
            >
              <option value="">Alege categorie</option>
              {categories.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>

            <label className={styles.label}>Imagini</label>
            <div className={styles.imagesRow}>
              <input
                type="file"
                accept="image/*"
                multiple
                onChange={async (e) => {
                  const files = Array.from(e.target.files || []);
                  if (!files.length) return;
                  try {
                    for (const f of files) {
                      const url = await uploadFile(f);
                      setProdForm((s) => ({ ...s, images: [...(s.images || []), url] }));
                    }
                  } catch (er) {
                    console.error(er);
                    alert(er?.message || "Upload eșuat.");
                  } finally {
                    e.target.value = "";
                  }
                }}
              />
              {!!prodForm.images?.length && (
                <div className={styles.thumbGrid}>
                  {prodForm.images.map((img, idx) => (
                    <div key={`${img}-${idx}`} className={styles.thumbItem}>
                      <img
                        src={resolveFileUrl(img)}
                        alt={`img-${idx}`}
                        className={styles.thumbImg}
                      />
                      <button
                        type="button"
                        onClick={() =>
                          setProdForm((s) => ({
                            ...s,
                            images: s.images.filter((_, i) => i !== idx),
                          }))
                        }
                        title="Șterge imagine"
                        className={styles.thumbRemove}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className={styles.modalFooter}>
              <button
                type="button"
                className={styles.linkBtn}
                onClick={() => (!savingProd ? setProdModalOpen(false) : null)}
                disabled={savingProd}
              >
                Anulează
              </button>
              <button className={styles.primaryBtn} type="submit" disabled={savingProd}>
                {savingProd ? "Se salvează…" : "Salvează"}
              </button>
            </div>
          </form>
        </div>
      </Modal>
    </>
  );
}
