import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { api } from "../../lib/api";
import styles from "./Products.module.css";
import { FaShoppingCart, FaHeart, FaRegHeart } from "react-icons/fa";
import { guestCart } from "../../lib/guestCart";

const SORTS = [
  { v: "new", label: "Cele mai noi" },
  { v: "popular", label: "Populare" },
  { v: "price_asc", label: "Preț crescător" },
  { v: "price_desc", label: "Preț descrescător" },
];

export default function ProductsPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();

  // --- auth + favorite state ---
  const [me, setMe] = useState(null);
  const [favorites, setFavorites] = useState(() => new Set());

  // --- list state ---
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(Number(params.get("page") || 1));
  const limit = 24;

  // suport rezultate după imagine (ids)
  const ids = params.get("ids") || "";

  const q = params.get("q") || "";
  const category = params.get("categorie") || params.get("category") || "";
  const city = params.get("city") || "";
  const sort = params.get("sort") || "new";
  const minPrice = params.get("min") || "";
  const maxPrice = params.get("max") || "";

  const onParamChange = (key, value) => {
    const p = new URLSearchParams(params);
    if (value === "" || value == null) p.delete(key);
    else p.set(key, value);
    p.set("page", "1");
    setParams(p);
  };

  // --- load me + favorites (o singură dată) ---
  useEffect(() => {
    (async () => {
      try {
        const d = await api("/api/auth/me");
        if (d?.__unauth) {
          setMe(null);
          setFavorites(new Set());
        } else {
          setMe(d?.user || null);
          if (d?.user) {
            const fav = await api("/api/favorites/ids").catch(() => ({ items: [] }));
            const idsSet = new Set(Array.isArray(fav?.items) ? fav.items : []);
            setFavorites(idsSet);
          }
        }
      } catch {
        setMe(null);
        setFavorites(new Set());
      }
    })();
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams();
      p.set("page", String(page));
      p.set("limit", String(limit));

      // ne asigurăm că listăm doar produse (servicii de tip "products")
      p.set("serviceType", "products");

      if (ids) p.set("ids", ids); // ordinea de similaritate
      if (q) p.set("q", q);
      if (category) p.set("category", category);
      if (city) p.set("city", city);
      if (!ids && sort) p.set("sort", sort);
      if (minPrice) p.set("minPrice", minPrice);
      if (maxPrice) p.set("maxPrice", maxPrice);

      const res = await api(`/api/public/products?${p.toString()}`);
      setItems(res?.items || []);
      setTotal(res?.total || 0);
    } finally {
      setLoading(false);
    }
  }, [ids, q, category, city, sort, minPrice, maxPrice, page]);

  useEffect(() => {
    setPage(Number(params.get("page") || 1));
  }, [params]);

  useEffect(() => {
    load();
  }, [load]);

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(total / limit)),
    [total]
  );

  // === Helper: deschide modalul de login din Navbar prin query params
  const openAuthModal = useCallback(() => {
    const current = window.location.pathname + window.location.search;
    const url = new URL(window.location.href);
    url.searchParams.set("auth", "login");
    url.searchParams.set("redirect", current);
    navigate(url.pathname + url.search, { replace: false });
  }, [navigate]);

  // === Add to cart: logged-in -> server; guest -> localStorage
  const doAddToCart = useCallback(
    async (productId) => {
      if (me) {
        const r = await api(`/api/cart/add`, {
          method: "POST",
          body: { productId, qty: 1 },
        });
        if (r?.__unauth) {
          // sesiune expirată; scriem local
          guestCart.add(productId, 1);
        }
      } else {
        guestCart.add(productId, 1);
      }
      try {
        window.dispatchEvent(new CustomEvent("cart:changed"));
      } catch {
        /* ignore */
      }
    },
    [me]
  );

  // wishlist rămâne doar pentru useri logați
  const toggleFavorite = async (p) => {
    if (!me) {
      alert("Trebuie să fii autentificat pentru a adăuga produse în wishlist.");
      try {
        sessionStorage.setItem(
          "intent",
          JSON.stringify({ type: "favorite_toggle", productId: p.id })
        );
      } catch {
        /* ignore */
      }
      openAuthModal();
      return;
    }

    const next = new Set(favorites);
    const isFav = next.has(p.id);
    isFav ? next.delete(p.id) : next.add(p.id);
    setFavorites(next);
    try {
      const r = await api("/api/favorites/toggle", {
        method: "POST",
        body: { productId: p.id },
      });
      if (r?.error === "cannot_favorite_own_product") {
        const rev = new Set(next);
        isFav ? rev.add(p.id) : rev.delete(p.id);
        setFavorites(rev);
        alert("Nu poți adăuga la favorite un produs care îți aparține.");
      }
    } catch {
      const rev = new Set(next);
      isFav ? rev.add(p.id) : rev.delete(p.id);
      setFavorites(rev);
    }
  };

  // Reia doar intenția de favorite (coșul e deja în localStorage)
  useEffect(() => {
    if (!me) return;
    const raw = sessionStorage.getItem("intent");
    if (!raw) return;
    try {
      const intent = JSON.parse(raw);
      (async () => {
        try {
          if (intent?.type === "favorite_toggle" && intent?.productId) {
            await api("/api/favorites/toggle", {
              method: "POST",
              body: { productId: intent.productId },
            });
            const fav = await api("/api/favorites/ids").catch(() => ({ items: [] }));
            setFavorites(new Set(Array.isArray(fav?.items) ? fav.items : []));
          }
        } finally {
          sessionStorage.removeItem("intent");
        }
      })();
    } catch {
      sessionStorage.removeItem("intent");
    }
  }, [me]);

  return (
    <section className={styles.page}>
      <header className={styles.head}>
        <h1 className={styles.h1}>Produse</h1>

        {ids && (
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "6px 10px",
              borderRadius: 12,
              background: "var(--surface)",
              border: "1px solid var(--color-border)",
              marginTop: 6,
            }}
          >
            <span style={{ fontSize: 13, color: "var(--color-text-muted)" }}>
              Rezultate după imagine — ordinea este de similaritate. Poți rafina cu filtrele de mai jos.
            </span>
            <button
              onClick={() => onParamChange("ids", "")}
              className={styles.btnPrimary}
              style={{ padding: "4px 8px" }}
            >
              Resetează
            </button>
          </div>
        )}

        {/* filtre */}
        <div className={styles.filters}>
          <input
            className={styles.input}
            placeholder="Caută produse…"
            value={q}
            onChange={(e) => onParamChange("q", e.target.value)}
          />
          <input
            className={styles.input}
            placeholder="Categorie produs (ex: invitatii)"
            value={category}
            onChange={(e) => onParamChange("categorie", e.target.value)}
          />
          <input
            className={styles.input}
            placeholder="Oraș"
            value={city}
            onChange={(e) => onParamChange("city", e.target.value)}
          />
          <input
            className={styles.inputN}
            type="number"
            min="0"
            placeholder="Min (RON)"
            value={minPrice}
            onChange={(e) => onParamChange("min", e.target.value)}
          />
          <input
            className={styles.inputN}
            type="number"
            min="0"
            placeholder="Max (RON)"
            value={maxPrice}
            onChange={(e) => onParamChange("max", e.target.value)}
          />

          <select
            className={styles.select}
            value={sort}
            onChange={(e) => onParamChange("sort", e.target.value)}
            disabled={!!ids}
            title={ids ? "Sortarea este fixă (ordine de similaritate)" : "Sortează"}
          >
            {SORTS.map((s) => (
              <option key={s.v} value={s.v}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
      </header>

      {loading ? (
        <div className={styles.loading}>Se încarcă…</div>
      ) : (
        <>
          {items.length === 0 ? (
            <EmptyState />
          ) : (
            <ul className={styles.grid}>
              {items.map((p) => (
                <ProductCard
                  key={p.id}
                  p={p}
                  me={me}
                  favorites={favorites}
                  onAddToCart={async (prod) => {
                    await doAddToCart(prod.id);
                    alert("Produs adăugat în coș.");
                  }}
                  onToggleFavorite={toggleFavorite}
                  onOpenAuthModal={openAuthModal}
                />
              ))}
            </ul>
          )}

          <Pagination
            page={page}
            totalPages={totalPages}
            onChange={(newPage) => onParamChange("page", String(newPage))}
          />
        </>
      )}
    </section>
  );
}

function ProductCard({ p, me, favorites, onAddToCart, onToggleFavorite, onOpenAuthModal }) {
  const navigate = useNavigate();

  const price = new Intl.NumberFormat("ro-RO", {
    style: "currency",
    currency: p.currency || "RON",
  }).format((p.priceCents || 0) / 100);

  const vendorName =
    p?.storeName ||
    p?.service?.profile?.displayName ||
    p?.service?.vendor?.displayName ||
    "Vânzător";

  const stName = p?.service?.type?.name || "";

  const ownerUserId = p?.service?.vendor?.userId;
  const isOwner =
    !!me && !!ownerUserId && (me.id === ownerUserId || me.sub === ownerUserId);
  const viewMode = isOwner ? "vendor" : me ? "user" : "guest";

  const isFav = favorites.has(p.id);

  const gotoProduct = () => navigate(`/produs/${p.id}`);

  return (
    <li className={styles.card}>
      <div
        className={styles.cardLink}
        role="button"
        tabIndex={0}
        onClick={gotoProduct}
        onKeyDown={(e) => (e.key === "Enter" ? gotoProduct() : null)}
        aria-label={p.title}
      >
        <div className={styles.thumbWrap}>
          <img
            src={p.images?.[0] || "/placeholder.png"}
            alt={p.title}
            className={styles.thumb}
            loading="lazy"
          />
        </div>
        <div className={styles.cardBody}>
          <div className={styles.title} title={p.title}>
            {p.title}
          </div>
          <div className={styles.meta} title={stName}>
            {stName} · de la <span className={styles.vendor}>{vendorName}</span>
          </div>
          <div className={styles.price}>{price}</div>
        </div>
      </div>

      <div className={styles.cardActions}>
        {viewMode === "vendor" ? (
          <span className={styles.ownerBadge} title="Produsul tău">
            Produsul tău
          </span>
        ) : viewMode === "user" ? (
          <div className={styles.iconRow}>
            <button
              type="button"
              className={`${styles.iconBtnOutline} ${isFav ? styles.heartFilled : ""}`}
              onClick={(e) => {
                e.stopPropagation();
                onToggleFavorite(p);
              }}
              title={isFav ? "Elimină din favorite" : "Adaugă la favorite"}
              aria-pressed={isFav}
              aria-label={isFav ? "Elimină din favorite" : "Adaugă la favorite"}
            >
              {isFav ? <FaHeart /> : <FaRegHeart />}
            </button>
            <button
              type="button"
              className={styles.iconBtn}
              onClick={(e) => {
                e.stopPropagation();
                if (!isOwner) onAddToCart(p);
              }}
              title="Adaugă în coș"
              aria-label="Adaugă în coș"
            >
              <FaShoppingCart />
            </button>
          </div>
        ) : (
          <div className={styles.iconRow}>
            {/* GUEST: wishlist cere login */}
            <button
              type="button"
              className={styles.iconBtnOutline}
              onClick={(e) => {
                e.stopPropagation();
                alert("Trebuie să fii autentificat pentru a adăuga produse în wishlist.");
                try {
                  sessionStorage.setItem(
                    "intent",
                    JSON.stringify({ type: "favorite_toggle", productId: p.id })
                  );
                } catch {
                  /* ignore */
                }
                onOpenAuthModal();
              }}
              title="Autentifică-te pentru a salva la favorite"
              aria-label="Autentifică-te pentru a salva la favorite"
            >
              <FaRegHeart />
            </button>
            {/* GUEST: coș = localStorage */}
            <button
              type="button"
              className={styles.iconBtn}
              onClick={(e) => {
                e.stopPropagation();
                onAddToCart(p);
              }}
              title="Adaugă în coș"
              aria-label="Adaugă în coș"
            >
              <FaShoppingCart />
            </button>
          </div>
        )}
      </div>
    </li>
  );
}

function Pagination({ page, totalPages, onChange }) {
  if (totalPages <= 1) return null;
  const prev = Math.max(1, page - 1);
  const next = Math.min(totalPages, page + 1);
  return (
    <div className={styles.pagination}>
      <button disabled={page <= 1} onClick={() => onChange(prev)}>
        Înapoi
      </button>
      <span>
        Pagina {page} din {totalPages}
      </span>
      <button disabled={page >= totalPages} onClick={() => onChange(next)}>
        Înainte
      </button>
    </div>
  );
}

function EmptyState() {
  return (
    <div className={styles.empty}>
      <div className={styles.emptyTitle}>
        Nu am găsit produse pentru filtrele alese.
      </div>
      <a className={styles.btnPrimary} href="/produse">
        Resetează filtrele
      </a>
    </div>
  );
}
