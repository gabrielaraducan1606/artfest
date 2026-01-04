// HeroSection.jsx
import React, { useEffect, useRef, useState, useMemo, useId, useCallback } from "react";
import { Link, useNavigate } from "react-router-dom";
import { FaRegLightbulb, FaShoppingBag, FaCamera } from "react-icons/fa";
import { SearchIcon } from "lucide-react";
import styles from "./HeroSection.module.css";

import imageMain from "../../../assets/heroSectionImage.jpg";
import { useTypeCycle } from "./hooks/useTypeCycle";

/* ========= util: prefers-reduced-motion ========= */
function usePrefersReducedMotion() {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)");
    if (!mq) return;
    const onChange = () => setReduce(mq.matches);
    onChange();
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);
  return reduce;
}

/* ========= util: match media ========= */
function useMediaQuery(query) {
  const [matches, setMatches] = useState(() => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (!window.matchMedia) return;
    const mq = window.matchMedia(query);
    const onChange = () => setMatches(mq.matches);
    onChange();
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, [query]);

  return matches;
}

/* ========= util: normalizează lista de reclame ========= */
function normalizeAds(items = []) {
  const now = Date.now();

  const active = items.filter((a) => {
    const s = a.startAt ? Date.parse(a.startAt) : -Infinity;
    const e = a.endAt ? Date.parse(a.endAt) : Infinity;
    return now >= s && now <= e;
  });

  const base = active.length ? active : items;
  const shuffled = [...base].sort(() => Math.random() - 0.5);

  const expanded = [];
  shuffled.forEach((a) => {
    const w = Math.max(1, Number(a.weight || 1));
    for (let i = 0; i < w; i++) expanded.push(a);
  });

  return expanded.length ? expanded : items;
}

/* ========= util: cache-busting pt imagini ========= */
function withV(url, v) {
  if (!url) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}v=${encodeURIComponent(String(v || "1"))}`;
}

/* ========= util: rezolvă url-urile pt <picture> ========= */
function resolveAdImageUrls(ad) {
  const desktopRaw = ad?.image?.desktop || ad?.image || null;
  const mobileRaw = ad?.image?.mobile || ad?.image?.desktop || ad?.image || null;
  const v = ad?.updatedAt || ad?.imageUpdatedAt || ad?.id || "1";

  return {
    desktop: withV(desktopRaw, v),
    mobile: withV(mobileRaw, v),
    v,
  };
}

/* ========= tracking (PUBLIC) ========= */
function trackImpression(ad) {
  const url =
    ad?.tracking?.impressionUrl ||
    (ad?.id?.startsWith?.("fallback") ? null : `/api/public/ads/${encodeURIComponent(ad.id)}/impression`);

  if (url) fetch(url, { method: "POST" }).catch(() => {});
}

function trackClick(ad) {
  const url =
    ad?.tracking?.clickUrl ||
    (ad?.id?.startsWith?.("fallback") ? null : `/api/public/ads/${encodeURIComponent(ad.id)}/click`);

  if (url) fetch(url, { method: "POST" }).catch(() => {});
}

/* ========= hook: rotator ads (PUBLIC ONLY) ========= */
function useAdRotator({ placement = "hero_top", interval = 7000 }) {
  const [ads, setAds] = useState([]);
  const [idx, setIdx] = useState(0);
  const timer = useRef(null);
  const seen = useRef(new Set());

  useEffect(() => {
    let alive = true;
    const ac = new AbortController();
    const timeout = setTimeout(() => ac.abort(), 6000);

    (async () => {
      try {
        const res = await fetch(`/api/public/ads?placement=${encodeURIComponent(placement)}`, {
          signal: ac.signal,
          headers: { Accept: "application/json" },
          cache: "no-store",
        });

        if (!res.ok) throw new Error(`ads http ${res.status}`);

        const json = await res.json().catch(() => ({}));
        const raw = json.items || json.ads || json.data || [];
        const list = normalizeAds(Array.isArray(raw) ? raw : []);

        if (!alive) return;

        if (list.length) {
          setAds(list);
          setIdx(0);
        } else {
          setAds([
            {
              id: "fallback1",
              image: { desktop: imageMain, mobile: imageMain },
              title: "ArtFest",
              updatedAt: String(Date.now()),
            },
          ]);
          setIdx(0);
        }
      } catch (err) {
        if (!alive) return;
        console.warn("[ads] fallback:", err?.message || err);

        setAds([
          {
            id: "fallback1",
            image: { desktop: imageMain, mobile: imageMain },
            title: "Inspirație pentru eveniment",
            updatedAt: String(Date.now()),
          },
        ]);
        setIdx(0);
      } finally {
        clearTimeout(timeout);
      }
    })();

    return () => {
      alive = false;
      ac.abort();
      clearTimeout(timeout);
    };
  }, [placement]);

  useEffect(() => {
    if (ads.length <= 1 || !Number.isFinite(interval)) return;

    timer.current = setInterval(() => {
      if (document.hidden || document.documentElement.dataset.adsPaused === "1") return;
      setIdx((i) => (i + 1) % ads.length);
    }, interval);

    return () => clearInterval(timer.current);
  }, [ads.length, interval]);

  useEffect(() => {
    const ad = ads[idx];
    if (!ad?.id) return;
    if (seen.current.has(ad.id)) return;
    seen.current.add(ad.id);
    trackImpression(ad);
  }, [ads, idx]);

  return { ads, idx, setIdx };
}

/* ========= Banda promo (DOAR DESKTOP) ========= */
function PromoStrip() {
  const reduceMotion = usePrefersReducedMotion();
  const { ads, idx, setIdx } = useAdRotator({
    placement: "hero_top",
    interval: reduceMotion ? Infinity : 7000,
  });

  const stripRef = useRef(null);

  useEffect(() => {
    const el = stripRef.current;
    if (!el) return;

    const toggle = (isVisible) => {
      document.documentElement.dataset.adsPaused = isVisible ? "0" : "1";
    };

    const io = new IntersectionObserver(([e]) => toggle(e.isIntersecting), { threshold: 0.15 });
    io.observe(el);

    const onVis = () => toggle(!document.hidden);
    document.addEventListener("visibilitychange", onVis);

    return () => {
      io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  const list = ads.length
    ? ads
    : [
        {
          id: "fallback",
          image: { desktop: imageMain, mobile: imageMain },
          title: "ArtFest",
          updatedAt: String(Date.now()),
        },
      ];

  const safeIdx = Math.min(idx, list.length - 1);
  const current = list[safeIdx] || list[0];

  return (
    <div ref={stripRef} className={styles.promoStrip} role="region" aria-label="Promoții">
      {list.map((ad, i) => {
        const urls = resolveAdImageUrls(ad);

        return (
          <a
            key={`${ad.id || i}:${urls.v}`}
            className={`${styles.promoSlideLink} ${i === safeIdx ? styles.active : ""}`}
            href={ad.ctaUrl || "#"}
            onClick={(e) => {
              if (!ad.ctaUrl) e.preventDefault();
              trackClick(ad);
            }}
            rel={ad.ctaUrl ? "noopener noreferrer nofollow" : undefined}
            target={ad.ctaUrl ? "_blank" : undefined}
          >
            <picture>
              <source media="(max-width: 480px)" srcSet={urls.mobile || urls.desktop} />
              <source media="(max-width: 1024px)" srcSet={urls.desktop} />
              <img
                className={styles.promoSlide}
                src={urls.desktop}
                width={1600}
                height={900}
                alt={ad.title ? `Promo: ${ad.title}` : ""}
                loading={i === 0 ? "eager" : "lazy"}
                decoding="async"
                fetchPriority={i === safeIdx ? "high" : "low"}
              />
            </picture>
          </a>
        );
      })}

      <div className={styles.promoOverlay} />

      {current?.title && (
        <div className={styles.adRibbon}>
          <span className={styles.adLabel}>Promo</span>
          <span className={styles.adTitle}>{current.title}</span>
        </div>
      )}

      {list.length > 1 && (
        <div className={styles.adControls}>
          <button
            type="button"
            className={styles.navBtn}
            aria-label="Înapoi"
            onClick={() => setIdx((safeIdx - 1 + list.length) % list.length)}
          >
            ‹
          </button>

          <div
            className={styles.adDots}
            role="tablist"
            aria-label="Indicatori slide"
            onKeyDown={(e) => {
              if (e.key === "ArrowLeft") setIdx((safeIdx - 1 + list.length) % list.length);
              if (e.key === "ArrowRight") setIdx((safeIdx + 1) % list.length);
            }}
          >
            {list.map((_, i) => (
              <button
                key={i}
                className={`${styles.dot} ${i === safeIdx ? styles.dotActive : ""}`}
                onClick={() => setIdx(i)}
                aria-label={`Slide ${i + 1}`}
                role="tab"
                aria-selected={i === safeIdx}
                tabIndex={i === safeIdx ? 0 : -1}
              />
            ))}
          </div>

          <button
            type="button"
            className={styles.navBtn}
            aria-label="Înainte"
            onClick={() => setIdx((safeIdx + 1) % list.length)}
          >
            ›
          </button>
        </div>
      )}
    </div>
  );
}

/* ========= Card “Devino partener” ========= */
function PartnerCard({ onCta }) {
  return (
    <aside className={styles.partnerCard} aria-label="Devino partener Artfest">
      <div className={styles.partnerBadge}>Pentru artizani</div>

      <h2 className={styles.partnerTitle}>
        Creezi lucruri handmade, invitații, mărturii?
        <br />
        <span className={styles.partnerAccent}>Vinde-ți creațiile fără să-ți faci site.</span>
      </h2>

      <p className={styles.partnerText}>
        Listare, promovare, comenzi — ca să vinzi mai ușor pe un marketplace pentru evenimente.
      </p>

      <ul className={styles.partnerBullets} aria-label="Beneficii">
        <li>🛍️ Vitrină online pentru produsele tale</li>
        <li>📣 Promovare & trafic către listările tale</li>
        <li>✅ Tu creezi. Noi te ajutăm să vinzi.</li>
      </ul>

      <div className={styles.partnerActions}>
        <Link to="/?auth=register&as=partner" className={styles.partnerCta} onClick={onCta}>
          Devino partener pe Artfest →
        </Link>

        <div className={styles.partnerHint}>Înscriere rapidă • Fără costuri de site</div>
      </div>

      <div className={styles.partnerGlow} aria-hidden="true" />
      <div className={styles.partnerGrid} aria-hidden="true" />
    </aside>
  );
}

export default function HeroSection() {
  const navigate = useNavigate();
  const fileInputId = useId();

  // ✅ ruta publică din App.jsx este /magazin/:slug
  const STORE_PAGE_PREFIX = "/magazin";

  const isMobile = useMediaQuery("(max-width: 980px)");

  const rotating = useTypeCycle(
    ["invitații ilustrate", "mărturii unicat", "album QR pentru poze", "un eveniment fără stres"],
    { delay: 1800 }
  );

  const trending = useMemo(
    () => [
      { label: "Invitații nuntă", categorie: "papetarie_invitatii-nunta" },
      { label: "Invitații botez", categorie: "papetarie_invitatii-botez" },
      { label: "Mărturii nuntă", categorie: "marturii_nunta" },
      { label: "Mărturii botez", categorie: "marturii_botez" },
      { label: "Cadouri pentru nași", categorie: "cadouri_pentru-nasi" },
      { label: "Cake toppers", categorie: "party_cake-toppers" },
    ],
    []
  );

  const [q, setQ] = useState("");
  const [suggestions, setSuggestions] = useState(null);
  const [suggestLoading, setSuggestLoading] = useState(false);
  const searchRef = useRef(null);

  const [uploadingImg, setUploadingImg] = useState(false);

  const log = useCallback((name, data = {}) => window.gtag?.("event", name, data), []);

  const onSearch = useCallback(
    (e) => {
      e.preventDefault();
      const term = q.trim();
      setSuggestions(null);
      log("hero_search_submit", { term, via: e?.nativeEvent?.submitter ? "button" : "enter" });
      navigate(term ? `/produse?q=${encodeURIComponent(term)}&page=1` : "/produse");
    },
    [q, navigate, log]
  );

  // ✅ Sugestii: produse + categorii + magazine (2 request-uri în paralel)
  useEffect(() => {
    const term = (q || "").trim();
    if (!term || term.length < 2) {
      setSuggestions(null);
      return;
    }

    const handle = setTimeout(async () => {
      try {
        setSuggestLoading(true);

        const [prodRes, storeRes] = await Promise.all([
          fetch(`/api/public/products/suggest?q=${encodeURIComponent(term)}`),
          fetch(`/api/public/stores/suggest?q=${encodeURIComponent(term)}`),
        ]);

        const prodData = prodRes.ok ? await prodRes.json().catch(() => null) : null;
        const storeData = storeRes.ok ? await storeRes.json().catch(() => null) : null;

        const storesRaw = Array.isArray(storeData?.stores) ? storeData.stores : [];
        // ✅ guard: afișează doar magazine cu profileSlug (altfel nu ai cum să navighezi)
        const stores = storesRaw.filter((s) => s?.profileSlug);

        const merged = {
          products: Array.isArray(prodData?.products) ? prodData.products : [],
          categories: Array.isArray(prodData?.categories) ? prodData.categories : [],
          stores,
        };

        const hasAny = merged.products.length || merged.categories.length || merged.stores.length;

        setSuggestions(
          hasAny
            ? merged
            : {
                products: [],
                categories: [],
                stores: [],
              }
        );
      } catch (err) {
        console.error("suggest error", err);
        setSuggestions(null);
      } finally {
        setSuggestLoading(false);
      }
    }, 250);

    return () => clearTimeout(handle);
  }, [q]);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (searchRef.current && !searchRef.current.contains(e.target)) {
        setSuggestions(null);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("touchstart", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("touchstart", handleClickOutside);
    };
  }, []);

  const handleSuggestionCategoryClick = useCallback(
    (catKey) => {
      const term = (q || "").trim();
      setSuggestions(null);
      navigate(`/produse?q=${encodeURIComponent(term)}&categorie=${encodeURIComponent(catKey)}&page=1`);
    },
    [navigate, q]
  );

  const handleSuggestionProductClick = useCallback(
    (id) => {
      setSuggestions(null);
      // ATENȚIE: în App.jsx ai ruta /produs/:id (nu /produse/:id)
      navigate(`/produs/${encodeURIComponent(id)}`);
    },
    [navigate]
  );

  const handleSuggestionStoreClick = useCallback(
    (profileSlug) => {
      setSuggestions(null);
      if (!profileSlug) return;
      navigate(`${STORE_PAGE_PREFIX}/${encodeURIComponent(profileSlug)}`);
    },
    [navigate, STORE_PAGE_PREFIX]
  );

  const handleImagePicked = useCallback(
    async (file) => {
      if (!file) return;
      if (!file.type?.startsWith("image/")) return;

      try {
        setUploadingImg(true);

        const fd = new FormData();
        fd.append("image", file);

        // ⚠️ ai pe backend /api/public/products/search-by-image
        // dar în UI foloseai /api/search/image — păstrează endpoint-ul tău real
        const res = await fetch("/api/search/image", { method: "POST", body: fd });

        if (!res.ok) {
          const errJson = await res.json().catch(() => null);
          const msg = errJson?.message || errJson?.error || `HTTP ${res.status}`;
          throw new Error(msg);
        }

        const data = await res.json().catch(() => null);
        const ids = Array.isArray(data?.ids) ? data.ids.filter(Boolean) : [];

        if (ids.length > 0) {
          navigate(`/produse?ids=${encodeURIComponent(ids.join(","))}&page=1`);
          log("hero_image_search", { ok: true, count: ids.length, size: file.size, type: file.type });
          return;
        }

        navigate("/produse?by=image&page=1");
        log("hero_image_search", { ok: true, count: 0, size: file.size, type: file.type });
      } catch (err) {
        console.warn("Nu am putut procesa imaginea. Încearcă din nou.", err);
        log("hero_image_search", { ok: false, error: String(err?.message || err || "") });
        navigate("/produse?by=image&error=1&page=1");
      } finally {
        setUploadingImg(false);
      }
    },
    [navigate, log]
  );

  useEffect(() => {
    const onPaste = (e) => {
      const f = e.clipboardData?.files?.[0];
      if (f?.type?.startsWith("image/")) handleImagePicked(f);
    };
    const onDrop = (e) => {
      e.preventDefault();
      const f = e.dataTransfer?.files?.[0];
      if (f?.type?.startsWith("image/")) handleImagePicked(f);
    };
    const onDragOver = (e) => e.preventDefault();

    window.addEventListener("paste", onPaste);
    window.addEventListener("drop", onDrop);
    window.addEventListener("dragover", onDragOver);
    return () => {
      window.removeEventListener("paste", onPaste);
      window.removeEventListener("drop", onDrop);
      window.removeEventListener("dragover", onDragOver);
    };
  }, [handleImagePicked]);

  const openImagePicker = useCallback(() => {
    log("hero_image_picker_open");
    document.getElementById(fileInputId)?.click();
  }, [fileInputId, log]);

  const showSuggest =
    q &&
    q.trim().length >= 2 &&
    (suggestLoading || suggestions) &&
    (suggestions?.products?.length ||
      suggestions?.categories?.length ||
      suggestions?.stores?.length ||
      suggestLoading);

  return (
    <>
      {/* JSON-LD pentru SearchAction (SEO) + Organization */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "WebSite",
            url: "https://artfest.ro/",
            potentialAction: {
              "@type": "SearchAction",
              target: "https://artfest.ro/produse?q={search_term_string}",
              "query-input": "required name=search_term_string",
            },
            publisher: { "@type": "Organization", name: "ArtFest", url: "https://artfest.ro/" },
          }),
        }}
      />

      {!isMobile && <PromoStrip />}

      <section className={styles.heroSection} role="banner" aria-label="Marketplace evenimente și handmade">
        <div className={styles.inner}>
          <div className={styles.content}>
            <span className={styles.eyebrow}>Marketplace pentru evenimente & handmade</span>

            <h1 className={styles.title}>
              Creează <span className={styles.accent}>{rotating}</span> cu produse handmade și servicii digitale
            </h1>

            <p className={styles.description}>
              Tot ce-ți trebuie pentru un eveniment memorabil — simplu, frumos și la un click distanță.
            </p>

            <form
              ref={searchRef}
              className={styles.searchBar}
              onSubmit={onSearch}
              role="search"
              aria-label="Căutare produse"
              style={{ position: "relative" }}
              onKeyDown={(e) => {
                if (e.key === "Escape") setSuggestions(null);
              }}
            >
              <button type="submit" className={styles.submitBtn} aria-label="Caută" title="Caută" disabled={uploadingImg}>
                <SearchIcon />
              </button>

              <input
                className={styles.searchInput}
                type="search"
                placeholder="Caută: invitații, mărturii, magazine…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                aria-label="Caută produse sau servicii"
                autoComplete="off"
              />

              <input
                id={fileInputId}
                type="file"
                accept="image/*"
                capture="environment"
                className={styles.hiddenFile}
                onChange={(e) => handleImagePicked(e.target.files?.[0])}
              />

              <button
                type="button"
                className={styles.cameraBtn}
                onClick={openImagePicker}
                aria-label="Caută după imagine"
                title="Caută după imagine"
                disabled={uploadingImg}
                aria-busy={uploadingImg}
              >
                {uploadingImg ? <span className={styles.spinner} aria-label="Se încarcă" /> : <FaCamera />}
              </button>

              {showSuggest && (
                <div role="listbox" aria-label="Sugestii de căutare" className={styles.suggestDropdown}>
                  {suggestLoading && <div className={styles.suggestLoading}>Se încarcă sugestiile…</div>}

                  {!suggestLoading && suggestions && (
                    <>
                      {(!suggestions.products?.length && !suggestions.categories?.length && !suggestions.stores?.length) && (
                        <div className={styles.suggestEmpty}>
                          Nu avem sugestii exacte pentru <strong>{q}</strong>.
                        </div>
                      )}

                      {suggestions.categories?.length > 0 && (
                        <div className={styles.suggestSection}>
                          <div className={styles.suggestSectionTitle}>Categorii sugerate</div>
                          {suggestions.categories.map((c) => (
                            <button
                              key={c.key}
                              type="button"
                              role="option"
                              className={styles.suggestCategoryBtn}
                              onClick={() => handleSuggestionCategoryClick(c.key)}
                            >
                              {c.label}
                            </button>
                          ))}
                        </div>
                      )}

                      {suggestions.stores?.length > 0 && (
                        <div className={styles.suggestSection}>
                          <div className={styles.suggestSectionTitle}>Magazine sugerate</div>

                          <div className={styles.suggestStoresList}>
                            {suggestions.stores.map((s) => (
                              <button
                                key={s.profileSlug}
                                type="button"
                                role="option"
                                className={styles.suggestStoreBtn}
                                onClick={() => handleSuggestionStoreClick(s.profileSlug)}
                              >
                                {s.logoUrl ? (
                                  <img
                                    src={s.logoUrl}
                                    alt={s.displayName || s.storeName || "Magazin"}
                                    className={styles.suggestStoreThumb}
                                    loading="lazy"
                                    decoding="async"
                                  />
                                ) : (
                                  <div className={styles.suggestStoreThumbFallback} aria-hidden="true" />
                                )}

                                <div className={styles.suggestStoreMeta}>
                                  <div className={styles.suggestStoreTitle}>{s.displayName || s.storeName || "Magazin"}</div>
                                  <div className={styles.suggestStoreSub}>{s.city ? s.city : "—"}</div>
                                </div>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      {suggestions.products?.length > 0 && (
                        <div className={styles.suggestSection}>
                          <div className={styles.suggestSectionTitle}>Produse sugerate</div>
                          <div className={styles.suggestProductsList}>
                            {suggestions.products.map((p) => (
                              <button
                                key={p.id}
                                type="button"
                                role="option"
                                className={styles.suggestProductBtn}
                                onClick={() => handleSuggestionProductClick(p.id)}
                              >
                                {p.images?.[0] && <img src={p.images[0]} alt={p.title} className={styles.suggestProductThumb} />}
                                <div className={styles.suggestProductMeta}>
                                  <div className={styles.suggestProductTitle}>{p.title}</div>
                                  <div className={styles.suggestProductPrice}>
                                    {(Number(p.priceCents || 0) / 100).toFixed(2)} {p.currency || "RON"}
                                  </div>
                                </div>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </form>

            <div className={styles.trending} aria-label="Căutări populare">
              {trending.map((t) => (
                <button
                  key={t.categorie}
                  className={styles.trend}
                  onClick={() => {
                    log("hero_trend_click", { categorie: t.categorie, label: t.label });
                    navigate(`/produse?categorie=${encodeURIComponent(t.categorie)}&page=1`);
                  }}
                  type="button"
                >
                  {t.label}
                </button>
              ))}
            </div>

            <div className={styles.buttons}>
              <Link to="/servicii-digitale" className={`${styles.btn} ${styles.btnPrimary}`} onClick={() => log("hero_cta_primary")}>
                <FaRegLightbulb className={styles.btnIcon} aria-hidden="true" />
                <span>Începe organizarea</span>
              </Link>

              <Link to="/produse" className={`${styles.btn} ${styles.btnGhost}`} onClick={() => log("hero_cta_secondary")}>
                <FaShoppingBag className={styles.btnIcon} aria-hidden="true" />
                <span>Descoperă colecțiile</span>
              </Link>
            </div>

            <ul className={styles.badges} aria-label="Avantaje">
              <li>🔒 Plăți sigure</li>
              <li>🎁 Produse unicat</li>
              <li>💬 Suport pentru artizani</li>
            </ul>

            {isMobile && (
              <div className={styles.mobilePartnerWrap}>
                <PartnerCard onCta={() => log("hero_partner_cta", { placement: "hero_mobile_card" })} />
              </div>
            )}
          </div>

          <div className={styles.images}>
            <PartnerCard onCta={() => log("hero_partner_cta", { placement: "hero_right_card" })} />
          </div>
        </div>
      </section>
    </>
  );
}
