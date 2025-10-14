import React, { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { FaRegLightbulb, FaShoppingBag, FaSearch, FaCamera } from "react-icons/fa";
import styles from "./HeroSection.module.css";

import imageMain from "../../../assets/heroSectionImage.jpg";

import { useTypeCycle } from "./hooks/useTypeCycle";

/* ========= util: normalizează lista de reclame ========= */
function normalizeAds(items = []) {
  const now = Date.now();
  const active = items.filter((a) => {
    const s = a.startAt ? Date.parse(a.startAt) : -Infinity;
    const e = a.endAt ? Date.parse(a.endAt) : Infinity;
    return now >= s && now <= e;
  });
  const base = active.length ? active : items;
  const expanded = [];
  base.forEach((a) => {
    const w = Math.max(1, Number(a.weight || 1));
    for (let i = 0; i < w; i++) expanded.push(a);
  });
  return expanded.length ? expanded : items;
}

function useAdRotator({ placement = "hero_top", interval = 7000 }) {
  const [ads, setAds] = useState([]);
  const [idx, setIdx] = useState(0);
  const seen = useRef(new Set());
  const timer = useRef(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/api/ads?placement=${encodeURIComponent(placement)}`);
        const json = await res.json().catch(() => ({}));
        const list = normalizeAds(json.items || []);
        if (alive && list.length) setAds(list);
      } catch {
        if (alive) {
          setAds([
            { id: "fallback1", image: { desktop: imageMain, mobile: imageMain }, title: "Inspirație pentru eveniment" },
          ]);
        }
      }
    })();
    return () => { alive = false; };
  }, [placement]);

  useEffect(() => {
    if (ads.length <= 1) return;
    timer.current = setInterval(() => {
      if (document.documentElement.dataset.adsPaused === "1") return;
      setIdx((i) => (i + 1) % ads.length);
    }, interval);
    return () => clearInterval(timer.current);
  }, [ads.length, interval]);

  useEffect(() => {
    const ad = ads[idx];
    if (!ad || seen.current.has(ad.id)) return;
    seen.current.add(ad.id);
    const url =
      ad.tracking?.impressionUrl ||
      (ad.id?.startsWith("fallback") ? null : `/api/ads/${ad.id}/impression`);
    if (url) fetch(url, { method: "POST" }).catch(() => {});
  }, [ads, idx]);

  return { ads, idx, setIdx };
}

function trackClick(ad) {
  const url =
    ad?.tracking?.clickUrl ||
    (ad?.id?.startsWith("fallback") ? null : `/api/ads/${ad.id}/click`);
  if (url) fetch(url, { method: "POST" }).catch(() => {});
}

/* ========= Banda promo fixă pe mobil + spacer dinamic ========= */
function PromoStrip() {
  const { ads, idx, setIdx } = useAdRotator({ placement: "hero_top", interval: 7000 });
  const stripRef = useRef(null);

  // măsoară înălțimea header-ului & setează --header-h
  useEffect(() => {
    const pickHeader = () => {
      const candidates = Array.from(
        document.querySelectorAll('header, [id*="header"], [class*="header"]')
      );
      const sticky = candidates.find((el) => {
        const pos = getComputedStyle(el).position;
        return pos === "sticky" || pos === "fixed";
      });
      return sticky || candidates[0] || null;
    };
    const header = pickHeader();
    if (!header) return;

    const setVar = () => {
      const h = Math.round(header.offsetHeight || 64);
      document.documentElement.style.setProperty("--header-h", `${h}px`);
    };

    setVar();
    const ro = new ResizeObserver(setVar);
    ro.observe(header);
    const onResize = () => setVar();
    window.addEventListener("resize", onResize);

    return () => {
      ro.disconnect();
      window.removeEventListener("resize", onResize);
    };
  }, []);

  // pauză când banda nu e vizibilă / tab inactiv
  useEffect(() => {
    const el = stripRef.current;
    if (!el) return;
    const toggle = (v) => {
      document.documentElement.dataset.adsPaused = v ? "0" : "1";
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

  const current = ads[idx];
  const list =
    ads.length ? ads : [{ id: "fallback", image: { desktop: imageMain, mobile: imageMain }, title: "ArtFest" }];

  return (
    <>
      <div
        ref={stripRef}
        className={styles.promoStrip}
        aria-label="Promo"
        aria-roledescription="carusel"
      >
        {list.map((ad, i) => (
          <a
            key={ad.id || i}
            className={`${styles.promoSlideLink} ${i === idx ? styles.active : ""}`}
            href={ad.ctaUrl || "#"}
            onClick={(e) => {
              if (!ad.ctaUrl) e.preventDefault();
              trackClick(ad);
            }}
            rel="nofollow"
          >
            <picture>
              <source
                media="(max-width: 620px)"
                srcSet={ad.image?.mobile || ad.image?.desktop}
                sizes="100vw"
              />
              <img
                className={styles.promoSlide}
                src={ad.image?.desktop || ad.image}
                alt={ad.title ? `Promo: ${ad.title}` : ""}
                loading={i === 0 ? "eager" : "lazy"}
                decoding="async"
                fetchPriority={i === 0 ? "high" : undefined}
                sizes="100vw"
                srcSet={`${ad.image?.desktop || ad.image} 1200w`}
              />
            </picture>
          </a>
        ))}
        <div className={styles.promoOverlay} />

        {current?.title && (
          <div className={styles.adRibbon}>
            <span className={styles.adLabel}>Promo</span>
            <span className={styles.adTitle}>{current.title}</span>
          </div>
        )}
        {current?.ctaText && current?.ctaUrl && (
          <a className={styles.adCta} href={current.ctaUrl} onClick={() => trackClick(current)}>
            {current.ctaText} →
          </a>
        )}

        {list.length > 1 && (
          <div className={styles.adDots} role="tablist" aria-label="Indicatori slide">
            {list.map((_, i) => (
              <button
                key={i}
                className={`${styles.dot} ${i === idx ? styles.dotActive : ""}`}
                onClick={() => setIdx(i)}
                aria-label={`Slide ${i + 1}`}
                role="tab"
                aria-selected={i === idx}
              />
            ))}
          </div>
        )}
      </div>

      {/* Spacer: înălțimea benzii - înălțimea header-ului (fără suprapuneri) */}
      <div className={styles.promoSpacer} aria-hidden="true" />
    </>
  );
}

export default function HeroSection() {
  const [q, setQ] = useState("");
  const [uploadingImg, setUploadingImg] = useState(false);
  const navigate = useNavigate();
  const fileInputId = "hero-image-input";

  // headline rotativ
  const rotating = useTypeCycle(
    ["invitații ilustrate", "mărturii unicat", "lumini care dansează", "organizare fără stres"],
    { delay: 1800 }
  );

  const trending = ["invitații greenery", "lumini calde", "mărturii miere", "buchete de toamnă"];

  const log = (name, data = {}) => window.gtag?.("event", name, data);

  const onSearch = (e) => {
    e.preventDefault();
    const term = q.trim();
    log("hero_search_submit", { term });
    navigate(term ? `/produse?q=${encodeURIComponent(term)}` : "/produse");
  };

  async function handleImagePicked(file) {
    if (!file) return;
    try {
      setUploadingImg(true);
      const fd = new FormData();
      fd.append("image", file);

      const res = await fetch("/api/search/image", { method: "POST", body: fd });
      const data = await res.json().catch(() => null);

      const ids = Array.isArray(data?.items) ? data.items.map((x) => x.id).filter(Boolean) : [];
      if (ids.length > 0) {
        try { sessionStorage.setItem(`imgsearch:${data?.searchId || "last"}`, JSON.stringify(data)); } catch {""}
        navigate(`/produse?ids=${encodeURIComponent(ids.join(","))}`);
        return;
      }

      const sid = data?.searchId || data?.queryId;
      if (sid) navigate(`/cautare-imagine/${encodeURIComponent(sid)}`);
      else navigate("/produse?by=image");

      log("hero_image_search", { ok: true });
    } catch {
      alert("Nu am putut procesa imaginea. Încearcă din nou.");
      log("hero_image_search", { ok: false });
    } finally {
      setUploadingImg(false);
    }
  }

  function openImagePicker() {
    document.getElementById(fileInputId)?.click();
  }

  return (
    <>
      {/* JSON-LD pentru SearchAction (SEO) */}
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
          }),
        }}
      />

      <PromoStrip />

      <section className={styles.heroSection}>
        <div className={styles.inner}>
          {/* ===== Content ===== */}
          <div className={styles.content}>
            <span className={styles.eyebrow}>Marketplace pentru evenimente & handmade</span>

            <h1 className={styles.title}>
              Creează <span className={styles.accent}>{rotating}</span> cu
              produse handmade și servicii digitale
            </h1>

            <p className={styles.description}>
              Tot ce-ți trebuie pentru un eveniment memorabil — simplu, frumos și la un click distanță.
            </p>

            {/* Search: input + buton cameră + buton submit (lupă) */}
           {/* Search: buton lupă (stânga) + input + buton cameră (dreapta) */}
<form className={styles.searchBar} onSubmit={onSearch} role="search" aria-label="Căutare produse">
  <button
    type="submit"
    className={styles.submitBtn}
    aria-label="Caută"
    title="Caută"
    disabled={uploadingImg}
  >
    <FaSearch />
  </button>

  <input
    className={styles.searchInput}
    type="search"
    placeholder="Caută: invitații, mărturii, lumini decor…"
    value={q}
    onChange={(e) => setQ(e.target.value)}
    aria-label="Caută produse sau servicii"
  />

  {/* input ascuns pentru imagine */}
  <input
    id={fileInputId}
    type="file"
    accept="image/*"
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
  >
    <FaCamera />
  </button>
</form>


            {/* Trending chips */}
            <div className={styles.trending} aria-label="Căutări populare">
              {trending.map((t) => (
                <button
                  key={t}
                  className={styles.trend}
                  onClick={() => {
                    log("hero_trend_click", { term: t });
                    navigate(`/produse?q=${encodeURIComponent(t)}`);
                  }}
                >
                  {t}
                </button>
              ))}
            </div>

            <div className={styles.buttons}>
              <Link
                to="/servicii-digitale"
                className={`${styles.btn} ${styles.btnPrimary}`}
                onClick={() => log("hero_cta_primary")}
              >
                <FaRegLightbulb className={styles.btnIcon} aria-hidden="true" />
                <span>Începe organizarea</span>
              </Link>
              <Link
                to="/produse"
                className={`${styles.btn} ${styles.btnGhost}`}
                onClick={() => log("hero_cta_secondary")}
              >
                <FaShoppingBag className={styles.btnIcon} aria-hidden="true" />
                <span>Descoperă colecțiile</span>
              </Link>
            </div>

            <ul className={styles.badges} aria-label="Avantaje">
              <li>🔒 Plăți sigure</li>
              <li>🎁 Produse unicat</li>
              <li>💬 Suport pentru artizani</li>
            </ul>
          </div>

          {/* ===== Visual (doar desktop) ===== */}
          <div className={styles.images} aria-hidden="true">
            <div className={styles.mainImageWrapper}>
              <img src={imageMain} alt="" className={styles.mainImage} loading="eager" decoding="async" />
              <div className={styles.glow} />
              <div className={styles.ring} />
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
