import React, { useEffect, useRef, useState, useMemo, useId, useCallback } from "react";
import { Link, useNavigate } from "react-router-dom";
import { FaRegLightbulb, FaShoppingBag, FaSearch, FaCamera } from "react-icons/fa";
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

/* ========= util: normalizează lista de reclame ========= */
function normalizeAds(items = []) {
  const now = Date.now();
  const active = items.filter((a) => {
    const s = a.startAt ? Date.parse(a.startAt) : -Infinity;
    const e = a.endAt ? Date.parse(a.endAt) : Infinity;
    return now >= s && now <= e;
  });
  const base = active.length ? active : items;
  // mic shuffle ca să nu fie mereu aceeași ordine
  const shuffled = [...base].sort(() => Math.random() - 0.5);
  const expanded = [];
  shuffled.forEach((a) => {
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
    const ac = new AbortController();
    const timeout = setTimeout(() => ac.abort(), 6000);

    (async () => {
      try {
        const res = await fetch(`/api/ads?placement=${encodeURIComponent(placement)}`, { signal: ac.signal });
        const json = await res.json().catch(() => ({}));
        const list = normalizeAds(json.items || []);
        if (alive && list.length) setAds(list);
      } catch {
        if (alive) {
          setAds([
            { id: "fallback1", image: { desktop: imageMain, mobile: imageMain }, title: "Inspirație pentru eveniment" },
          ]);
        }
      } finally {
        clearTimeout(timeout);
      }
    })();
    return () => { alive = false; ac.abort(); };
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
  const reduceMotion = usePrefersReducedMotion();
  const { ads, idx, setIdx } = useAdRotator({ placement: "hero_top", interval: reduceMotion ? Infinity : 7000 });
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
        role="region"
        aria-label="Promoții"
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
            rel={ad.ctaUrl ? "noopener noreferrer nofollow" : undefined}
            target={ad.ctaUrl ? "_blank" : undefined}
          >
            <picture>
              <source
                media="(max-width: 480px)"
                srcSet={`${ad.image?.mobile || ad.image?.desktop} 480w`}
                sizes="100vw"
              />
              <source
                media="(max-width: 1024px)"
                srcSet={`${ad.image?.desktop || ad.image} 1024w`}
                sizes="100vw"
              />
              <img
                className={styles.promoSlide}
                src={ad.image?.desktop || ad.image}
                width={1600}
                height={900}
                alt={ad.title ? `Promo: ${ad.title}` : ""}
                loading={i === 0 ? "eager" : "lazy"}
                decoding="async"
                fetchPriority={i === idx ? "high" : "low"}
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
          <div className={styles.adControls}>
            <button
              type="button"
              className={styles.navBtn}
              aria-label="Înapoi"
              onClick={() => setIdx((idx - 1 + list.length) % list.length)}
            >
              ‹
            </button>

            <div
              className={styles.adDots}
              role="tablist"
              aria-label="Indicatori slide"
              onKeyDown={(e) => {
                if (e.key === 'ArrowLeft') setIdx((idx - 1 + list.length) % list.length);
                if (e.key === 'ArrowRight') setIdx((idx + 1) % list.length);
              }}
            >
              {list.map((_, i) => (
                <button
                  key={i}
                  className={`${styles.dot} ${i === idx ? styles.dotActive : ""}`}
                  onClick={() => setIdx(i)}
                  aria-label={`Slide ${i + 1}`}
                  role="tab"
                  aria-selected={i === idx}
                  tabIndex={i === idx ? 0 : -1}
                />
              ))}
            </div>

            <button
              type="button"
              className={styles.navBtn}
              aria-label="Înainte"
              onClick={() => setIdx((idx + 1) % list.length)}
            >
              ›
            </button>
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
  const fileInputId = useId();

  // headline rotativ
  const rotating = useTypeCycle(
    ["invitații ilustrate", "mărturii unicat", "lumini care dansează", "organizare fără stres"],
    { delay: 1800 }
  );

  const trending = useMemo(() => ["invitații greenery", "lumini calde", "mărturii miere", "buchete de toamnă"], []);

  // stabilizăm log ca să nu polueze deps
  const log = useCallback((name, data = {}) => window.gtag?.("event", name, data), []);

  const onSearch = (e) => {
    e.preventDefault();
    const term = q.trim();
    log("hero_search_submit", { term, via: e?.nativeEvent?.submitter ? "button" : "enter" });
    navigate(term ? `/produse?q=${encodeURIComponent(term)}` : "/produse");
  };

  // handleImagePicked stabil, pentru ESLint deps
  const handleImagePicked = useCallback(async (file) => {
    if (!file) return;
    if (!file.type?.startsWith("image/")) return;
    try {
      setUploadingImg(true);
      const fd = new FormData();
      fd.append("image", file);

      const res = await fetch("/api/search/image", { method: "POST", body: fd });
      const data = await res.json().catch(() => null);

      const ids = Array.isArray(data?.items) ? data.items.map((x) => x.id).filter(Boolean) : [];
      if (ids.length > 0) {
        try { sessionStorage.setItem(`imgsearch:${data?.searchId || "last"}`, JSON.stringify(data)); } catch { /* ignore */ }
        navigate(`/produse?ids=${encodeURIComponent(ids.join(","))}`);
        log("hero_image_search", { ok: true, count: ids.length, size: file.size, type: file.type });
        return;
      }

      const sid = data?.searchId || data?.queryId;
      if (sid) navigate(`/cautare-imagine/${encodeURIComponent(sid)}`);
      else navigate("/produse?by=image");

      log("hero_image_search", { ok: true, count: 0, size: file.size, type: file.type });
    } catch {
      console.warn("Nu am putut procesa imaginea. Încearcă din nou.");
      log("hero_image_search", { ok: false });
    } finally {
      setUploadingImg(false);
    }
  }, [navigate, log]);

  // paste & drag-n-drop pentru imagine — include funcția stabilă în deps
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

  function openImagePicker() {
    log("hero_image_picker_open");
    document.getElementById(fileInputId)?.click();
  }

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
            publisher: {
              "@type": "Organization",
              name: "ArtFest",
              url: "https://artfest.ro/",
            },
          }),
        }}
      />

      <PromoStrip />

      <section className={styles.heroSection} role="banner" aria-label="Marketplace evenimente și handmade">
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

            {/* Search: lupă | input | cameră */}
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
