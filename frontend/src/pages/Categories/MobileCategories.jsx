// frontend/src/pages/MobileCategories/MobileCategories.jsx
import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import styles from "./MobileCategories.module.css";

import {
  FaEnvelopeOpenText,
  FaUtensils,
  FaRegAddressCard,
  FaGift,
  FaSeedling,
  FaLightbulb,
  FaImage,
  FaFeather,
  FaGem,
  FaMugHot,
  FaBirthdayCake,
  FaUserTie,
  FaStore,
  FaClock,
  FaTags,
  FaQrcode,
  FaChair,
  FaMagic,
} from "react-icons/fa";

/* Tabs (stânga) */
const ROOT_TABS = [
  { key: "digitale", label: "Digitale" },
  { key: "produse", label: "Produse" },
  { key: "servicii", label: "Servicii" },
];

/* ✅ Servicii digitale — ICON-uri */
const DIGITAL = [
  { key: "invitatia", label: "Invitație", to: "/digitale/invitatie", icon: FaMagic },
  { key: "seating", label: "Seating", to: "/digitale/asezare-mese", icon: FaChair },
  { key: "albumqr", label: "Album QR", to: "/digitale/album-qr", icon: FaQrcode },
];

/**
 * Endpoint-ul rutei tale existente:
 * - app.use("/api/service-types", router) => "/api/service-types"
 * - app.use("/api/public/service-types", router) => "/api/public/service-types"
 */
const SERVICE_TYPES_ENDPOINT = "/api/service-types";
const PRODUCT_CATEGORIES_ENDPOINT = "/api/public/categories";

/* icon per grup pentru PRODUSE */
const GROUP_ICON = {
  decor: FaLightbulb,
  papetarie: FaEnvelopeOpenText,
  ceremonie: FaRegAddressCard,
  home: FaMugHot,
  bijuterii: FaGem,
  marturii: FaGift,
  cadouri: FaGift,
  arta: FaImage,
  textile: FaFeather,
  party: FaBirthdayCake,
  alte: FaTags,
};

/* icon per code pentru SERVICII */
const SERVICE_ICON_BY_CODE = {
  bakery_bar: FaBirthdayCake,
  restaurant: FaUtensils,
  decor: FaLightbulb,
  tents: FaRegAddressCard,
  florist: FaSeedling,
  entertainment: FaUserTie,
  photography: FaImage,
  special_fx: FaTags,
  products: FaStore,
};

/* =========================
   ✅ cache în memorie (instant în aceeași sesiune de runtime)
========================= */
let MEM_CATS = null;     // [{key,label,group,groupLabel}]
let MEM_SERVICES = null; // [{code,name}]
let INFLIGHT_CATS = null;
let INFLIGHT_SERVICES = null;

/* =========================
   ✅ cache în sessionStorage (persistă la refresh)
========================= */
const SS_KEYS = {
  cats: "mobileCats_v1",
  services: "mobileServiceTypes_v1",
};

function readSession(key) {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
function writeSession(key, value) {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore
  }
}

/* =========================
   ✅ fetch helpers (dedup + normalize)
========================= */
async function fetchProductCategories(signal) {
  const res = await fetch(PRODUCT_CATEGORIES_ENDPOINT, {
    signal,
    headers: { Accept: "application/json" },
    // important: permite cache-ul browserului când există
    cache: "force-cache",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json().catch(() => ({}));
  const items = Array.isArray(json?.items) ? json.items : [];
  // items: [{ key, label, group, groupLabel }]
  return items;
}

async function fetchServiceTypes(signal) {
  const res = await fetch(SERVICE_TYPES_ENDPOINT, {
    signal,
    headers: { Accept: "application/json" },
    cache: "force-cache",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json().catch(() => ({}));
  const items = Array.isArray(json?.items) ? json.items : [];
  return items
    .map((x) => ({ code: x?.code, name: x?.name }))
    .filter((x) => x.code && x.name);
}

/* =========================
   ✅ prefetch (rulează o dată)
========================= */
function warmCaches() {
  // 1) din memorie
  if (MEM_CATS && MEM_SERVICES) return;

  // 2) din sessionStorage
  if (!MEM_CATS) {
    const ssCats = readSession(SS_KEYS.cats);
    if (Array.isArray(ssCats)) MEM_CATS = ssCats;
  }
  if (!MEM_SERVICES) {
    const ssServices = readSession(SS_KEYS.services);
    if (Array.isArray(ssServices)) MEM_SERVICES = ssServices;
  }

  // 3) pornește fetch în background (dedup)
  if (!MEM_CATS && !INFLIGHT_CATS) {
    const ac = new AbortController();
    INFLIGHT_CATS = fetchProductCategories(ac.signal)
      .then((items) => {
        MEM_CATS = items;
        writeSession(SS_KEYS.cats, items);
        return items;
      })
      .catch(() => null)
      .finally(() => {
        INFLIGHT_CATS = null;
      });
  }

  if (!MEM_SERVICES && !INFLIGHT_SERVICES) {
    const ac = new AbortController();
    INFLIGHT_SERVICES = fetchServiceTypes(ac.signal)
      .then((items) => {
        MEM_SERVICES = items;
        writeSession(SS_KEYS.services, items);
        return items;
      })
      .catch(() => null)
      .finally(() => {
        INFLIGHT_SERVICES = null;
      });
  }
}

export default function MobileCategories() {
  const [tab, setTab] = useState("digitale");

  // ✅ seed state instant din cache (memorie / sessionStorage)
  const [productCats, setProductCats] = useState(() => MEM_CATS || readSession(SS_KEYS.cats) || []);
  const [serviceTypes, setServiceTypes] = useState(() => MEM_SERVICES || readSession(SS_KEYS.services) || []);

  // loading = doar dacă NU avem nimic încă
  const [catsLoading, setCatsLoading] = useState(false);
  const [serviceLoading, setServiceLoading] = useState(false);

  // ✅ prefetch imediat când se montează pagina
  useEffect(() => {
    warmCaches();
  }, []);

  /* asigurăm --header-h corect (dacă n-a fost deja setată) */
  useEffect(() => {
    const header = document.querySelector("header, .header, [data-header]");
    if (!header) return;

    const setVar = () => {
      const h = Math.round(header.offsetHeight || 64);
      const cur = getComputedStyle(document.documentElement).getPropertyValue("--header-h");
      if (!cur || cur.trim() === "" || parseInt(cur) !== h) {
        document.documentElement.style.setProperty("--header-h", `${h}px`);
      }
    };

    setVar();
    const ro = new ResizeObserver(setVar);
    ro.observe(header);
    window.addEventListener("resize", setVar);

    return () => {
      ro.disconnect();
      window.removeEventListener("resize", setVar);
    };
  }, []);

  // ✅ tab din querystring
  useEffect(() => {
    const usp = new URLSearchParams(window.location.search);
    const t = usp.get("tab");
    if (t && ROOT_TABS.some((r) => r.key === t)) setTab(t);
  }, []);

  const onPickTab = (key) => {
    setTab(key);
    const usp = new URLSearchParams(window.location.search);
    usp.set("tab", key);
    window.history.replaceState(null, "", `${window.location.pathname}?${usp.toString()}`);
  };

  // ✅ când intri pe "produse": dacă n-ai nimic, faci fetch; dacă ai, doar refresh în fundal
  useEffect(() => {
    if (tab !== "produse") return;

    let alive = true;
    const ac = new AbortController();

    (async () => {
      try {
        // dacă nu avem nimic, arată loading; altfel, nu
        if (!productCats?.length) setCatsLoading(true);

        // dacă există inflight global, așteaptă-l
        if (INFLIGHT_CATS) {
          const items = await INFLIGHT_CATS;
          if (alive && Array.isArray(items)) setProductCats(items);
          return;
        }

        const items = await fetchProductCategories(ac.signal);
        if (!alive) return;

        MEM_CATS = items;
        writeSession(SS_KEYS.cats, items);
        setProductCats(items);
      } catch (e) {
        if (!alive) return;
        console.warn("[mobile categories] categories fetch failed:", e?.message || e);
      } finally {
        if (alive) setCatsLoading(false);
      }
    })();

    return () => {
      alive = false;
      ac.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  // ✅ când intri pe "servicii": idem
  useEffect(() => {
    if (tab !== "servicii") return;

    let alive = true;
    const ac = new AbortController();

    (async () => {
      try {
        if (!serviceTypes?.length) setServiceLoading(true);

        if (INFLIGHT_SERVICES) {
          const items = await INFLIGHT_SERVICES;
          if (alive && Array.isArray(items)) setServiceTypes(items);
          return;
        }

        const items = await fetchServiceTypes(ac.signal);
        if (!alive) return;

        MEM_SERVICES = items;
        writeSession(SS_KEYS.services, items);
        setServiceTypes(items);
      } catch (e) {
        if (!alive) return;
        console.warn("[mobile categories] service types fetch failed:", e?.message || e);
      } finally {
        if (alive) setServiceLoading(false);
      }
    })();

    return () => {
      alive = false;
      ac.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  // ✅ grupare pe groupLabel (produse)
  const grouped = useMemo(() => {
    const map = new Map();
    for (const c of productCats || []) {
      const groupLabel = c.groupLabel || "Altele";
      const group = c.group || "alte";
      if (!map.has(groupLabel)) map.set(groupLabel, { group, groupLabel, items: [] });
      map.get(groupLabel).items.push(c);
    }
    return Array.from(map.values());
  }, [productCats]);

  return (
    <section className={styles.page} aria-label="Categorii (mobil)">
      {/* Rail stânga */}
      <aside className={styles.rail} aria-label="Secțiuni">
        {ROOT_TABS.map((r) => (
          <button
            key={r.key}
            type="button"
            className={`${styles.railItem} ${tab === r.key ? styles.railItemActive : ""}`}
            onClick={() => onPickTab(r.key)}
            aria-current={tab === r.key ? "true" : "false"}
          >
            {r.label}
          </button>
        ))}
      </aside>

      {/* Panel dreapta */}
      <main className={styles.panel}>
        {tab === "digitale" && (
          <>
            <h1 className={styles.heading}>Servicii digitale</h1>
            <div className={styles.compactGrid} aria-label="Servicii digitale">
              {DIGITAL.map((d) => {
                const Icon = d.icon || FaTags;
                return (
                  <Link key={d.key} to={d.to} className={styles.compactTile} title={d.label}>
                    <span className={styles.compactIcon}>
                      <Icon size={16} />
                    </span>
                    <span className={styles.compactLabel}>{d.label}</span>
                  </Link>
                );
              })}
            </div>
          </>
        )}

        {tab === "produse" && (
          <>
            <h1 className={styles.heading}>Produse</h1>

            {/* Loading doar dacă chiar nu aveai nimic */}
            {catsLoading && !productCats?.length && (
              <div className={styles.compactGrid} aria-busy="true">
                {Array.from({ length: 12 }).map((_, i) => (
                  <div key={i} className={styles.compactTile} style={{ opacity: 0.55 }}>
                    <span className={styles.compactIcon}>
                      <FaTags size={16} />
                    </span>
                    <span className={styles.compactLabel}>Se încarcă…</span>
                  </div>
                ))}
              </div>
            )}

            {!catsLoading && grouped.length === 0 && (
              <div className={styles.emptyState}>Nu am putut încărca categoriile.</div>
            )}

            {grouped.map((g) => {
              const IconGroup = GROUP_ICON[g.group] || FaTags;
              return (
                <section key={g.groupLabel} aria-label={g.groupLabel} className={styles.groupSection}>
                  <div className={styles.groupHeading}>
                    <IconGroup size={12} />
                    <span>{g.groupLabel}</span>
                  </div>

                  <div className={styles.compactGrid}>
                    {g.items.map((c) => {
                      const IconComp = GROUP_ICON[c.group] || FaTags;
                      return (
                        <Link
                          key={c.key}
                          to={`/produse?categorie=${encodeURIComponent(c.key)}&page=1`}
                          className={styles.compactTile}
                          title={c.label}
                        >
                          <span className={styles.compactIcon}>
                            <IconComp size={16} />
                          </span>
                          <span className={styles.compactLabel}>{c.label}</span>
                        </Link>
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </>
        )}

        {tab === "servicii" && (
          <>
            <h1 className={styles.heading}>Servicii</h1>

            {serviceLoading && !serviceTypes?.length && (
              <div className={styles.compactGrid} aria-busy="true">
                {Array.from({ length: 12 }).map((_, i) => (
                  <div key={i} className={styles.compactTile} style={{ opacity: 0.55 }}>
                    <span className={styles.compactIcon}>
                      <FaClock size={16} />
                    </span>
                    <span className={styles.compactLabel}>Se încarcă…</span>
                  </div>
                ))}
              </div>
            )}

            {!serviceLoading && serviceTypes.length === 0 && (
              <div className={styles.emptyState}>Nu am putut încărca serviciile.</div>
            )}

            {serviceTypes.length > 0 && (
              <div className={styles.compactGrid}>
                {serviceTypes.map((s) => {
                  const IconComp = SERVICE_ICON_BY_CODE[s.code] || FaTags;
                  const to = `/servicii?type=${encodeURIComponent(s.code)}`;

                  return (
                    <Link key={s.code} to={to} className={styles.compactTile} title={s.name}>
                      <span className={styles.compactIcon}>
                        <IconComp size={16} />
                      </span>
                      <span className={styles.compactLabel}>{s.name}</span>
                    </Link>
                  );
                })}
              </div>
            )}
          </>
        )}
      </main>
    </section>
  );
}
