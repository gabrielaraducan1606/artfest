import React, { useRef, useState, useEffect, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import styles from "./ProfilMagazin.module.css";
import { SEO } from "../../../components/Seo/SeoProvider.jsx";
import { onImgError } from "../../../components/utils/imageFallback";
import { FaCopy, FaPlus, FaCamera } from "react-icons/fa";
import { api } from "../../../lib/api";

// hook + helpers
import useProfilMagazin, {
  withCache,
  resolveFileUrl,
} from "./hooks/useProfilMagazin";

// secțiuni
import AboutSection from "./components/AboutSection";
import InfoSection from "./components/InfoSection";
import ProductList from "./components/ProductList";
import ReviewsSection from "./components/ReviewsSection";
import TabsNav from "./components/TabsNav.jsx";

// modale păstrate (non-reviews)
import VendorGateModal from "./modals/VendorGateModal";
import ProductModal from "./modals/ProductModal";

/* ========================== TRACKING helpers ========================== */
function makeId() {
  try {
    return (
      (self.crypto?.randomUUID && crypto.randomUUID()) ||
      (Date.now().toString(36) + Math.random().toString(36).slice(2))
    );
  } catch {
    return Date.now().toString(36) + Math.random().toString(36).slice(2);
  }
}
function getSessionId() {
  try {
    const k = "sid";
    const v = localStorage.getItem(k);
    if (v) return v;
    const n = makeId();
    localStorage.setItem(k, n);
    return n;
  } catch {
    return undefined;
  }
}

function useVendorTracking(vendorId, pageUrl) {
  const sid = useMemo(() => getSessionId(), []);
  const [viewId, setViewId] = useState(() => makeId());

  const send = (payload) => {
    try {
      const blob = new Blob([JSON.stringify(payload)], {
        type: "application/json",
      });
      if (
        navigator.sendBeacon &&
        navigator.sendBeacon("/api/visitors/track", blob)
      )
        return;
    } catch {
      ""
    }
    fetch("/api/visitors/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).catch(() => {});
  };

  // PAGEVIEW + VIEW_* lifecycle
  useEffect(() => {
    if (!vendorId) return;

    const url =
      pageUrl ||
      (typeof window !== "undefined"
        ? location.pathname + location.search
        : undefined);
    const ref =
      typeof document !== "undefined" ? document.referrer || "" : "";

    const newView = makeId();
    setViewId(newView);

    // PAGEVIEW
    send({
      vendorId,
      type: "PAGEVIEW",
      pageUrl: url,
      referrer: ref,
      sessionId: sid,
    });
    // VIEW_START
    send({
      vendorId,
      type: "VIEW_START",
      pageUrl: url,
      referrer: ref,
      sessionId: sid,
      viewId: newView,
    });

    // Heartbeat ping (15s) doar când tab-ul e vizibil
    let hb;
    const beat = () =>
      send({
        vendorId,
        type: "VIEW_PING",
        pageUrl: url,
        sessionId: sid,
        viewId: newView,
      });
    const startHB = () => {
      hb = setInterval(() => {
        if (document.visibilityState === "visible") beat();
      }, 15000);
    };
    const stopHB = () => {
      if (hb) clearInterval(hb);
      hb = null;
    };
    startHB();

    const onVis = () => {
      if (document.visibilityState === "hidden") stopHB();
      else if (!hb) startHB();
    };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      document.removeEventListener("visibilitychange", onVis);
      stopHB();
      send({
        vendorId,
        type: "VIEW_END",
        pageUrl: url,
        sessionId: sid,
        viewId: newView,
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vendorId, pageUrl]);

  function trackCTA(label) {
    if (!vendorId) return;
    send({
      vendorId,
      type: "CTA_CLICK",
      ctaLabel: label,
      pageUrl:
        typeof window !== "undefined"
          ? location.pathname + location.search
          : undefined,
      sessionId: sid,
      viewId,
    });
  }
  function trackMESSAGE(label) {
    if (!vendorId) return;
    send({
      vendorId,
      type: "MESSAGE",
      ctaLabel: label,
      pageUrl:
        typeof window !== "undefined"
          ? location.pathname + location.search
          : undefined,
      sessionId: sid,
      viewId,
    });
  }

  return { trackCTA, trackMESSAGE };
}
/* ===================================================================== */

/* ---------- banner note (doar pentru owner) ---------- */
function OwnerWarningBanner({
  missingProfile = [],
  missingBilling = [],
  noSub = false,
}) {
  if (!noSub && !missingProfile.length && !missingBilling.length) return null;

  return (
    <div
      role="note"
      aria-label="Completează configurarea magazinului"
      style={{
        margin: "12px 0 16px",
        padding: 12,
        border: "1px solid #F59E0B",
        background: "#FFFBEB",
        color: "#92400E",
        borderRadius: 8,
      }}
    >
      <strong style={{ display: "block", marginBottom: 6 }}>
        Configurare incompletă
      </strong>

      {noSub && (
        <div style={{ marginBottom: 6 }}>
          Nu ai un <b>abonament activ</b>.{" "}
          <a href="/onboarding/details?tab=plata&solo=1">
            Activează abonamentul
          </a>
          .
        </div>
      )}

      {missingProfile.length > 0 && (
        <div style={{ marginBottom: 6 }}>
          Din <b>Profil servicii</b> lipsesc: {missingProfile.join(", ")}.{" "}
          <a href="/onboarding/details?tab=profil&solo=1">
            Completează acum
          </a>
          .
        </div>
      )}

      {missingBilling.length > 0 && (
        <div>
          Din <b>Date facturare</b> lipsesc:{" "}
          {missingBilling.join(", ")}.{" "}
          <a href="/onboarding/details?tab=facturare">
            Completează acum
          </a>
          .
        </div>
      )}
    </div>
  );
}

function broadcastProfileUpdated(serviceIdOrSlug) {
  try {
    window.dispatchEvent(
      new CustomEvent("vendor:profileUpdated", {
        detail: { idOrSlug: serviceIdOrSlug },
      })
    );
  } catch {
    ""
  }
  try {
    localStorage.setItem("vendorProfileUpdatedAt", String(Date.now()));
  } catch {
    ""
  }
}

export default function ProfilMagazin() {
  const { slug } = useParams();
  const navigate = useNavigate();

  const {
    sellerData: _sellerData,
    products,
    reviews,
    rating,
    me,
    isOwner,
    viewMode,
    categories,
    favorites,
    loading,
    err,
    needsOnboarding,
    cacheT,
    productsCacheT,

    // din hook
    countySuggestions,
    countiesLoading,
    countiesErr,
    onCountiesChange,

    // product modal (create/edit)
    prodModalOpen,
    setProdModalOpen,
    savingProd,
    editingProduct,
    prodForm,
    setProdForm,

    // gate
    gateOpen,
    setGateOpen,
    gateLoading,
    gateErr,
    gateDocs,
    setGateChecks,

    // actions
    openNewProduct,
    acceptVendorDocs,
    refetch,
  } = useProfilMagazin(slug);

  // local
  const [editingOverride, setEditingOverride] = useState(null);
  const [copied, setCopied] = useState(false);

  // patch optimist pentru avatar/cover
  const [profilePatch, setProfilePatch] = useState({});
  const [localCacheT, setLocalCacheT] = useState(Date.now());

  // refs file inputs
  const avatarInputRef = useRef(null);
  const coverInputRef = useRef(null);

  // profil afișat
  const sellerData = useMemo(
    () => ({ ...(_sellerData || {}), ...profilePatch }),
    [_sellerData, profilePatch]
  );

  // === calc ce lipsește din ProfileTab (pentru banner, doar owner) ===
  const missingProfile = useMemo(() => {
    const m = [];
    const s = sellerData || {};
    const profile = s.profile || {};
    const hasName = s.shopName || profile.displayName;
    const hasSlug = s.slug || profile.slug;
    const hasImage = !!(
      s.profileImageUrl ||
      s.logoUrl ||
      s.coverImageUrl ||
      s.coverUrl ||
      profile.logoUrl ||
      profile.coverUrl
    );
    const hasAddress = s.address || profile.address;
    const deliveryArr = Array.isArray(s.delivery)
      ? s.delivery
      : Array.isArray(profile.delivery)
      ? profile.delivery
      : [];
    if (!String(hasName || "").trim()) m.push("Nume brand");
    if (!String(hasSlug || "").trim()) m.push("Slug");
    if (!hasImage) m.push("Logo/Copertă");
    if (!String(hasAddress || "").trim()) m.push("Adresă");
    if (!deliveryArr.length) m.push("Zonă acoperire");
    return m;
  }, [sellerData]);

  // === abonament + billing (doar pentru owner) ===
  const [ownerChecks, setOwnerChecks] = useState({
    hasActiveSub: null,
    missingBilling: [],
    loading: false,
  });

  useEffect(() => {
    if (!isOwner) return;

    let alive = true;
    (async () => {
      try {
        setOwnerChecks((s) => ({ ...s, loading: true }));

        // 1) abonament
        let hasActiveSub = false;
        try {
          const sub = await api(
            "/api/vendors/me/subscription/status",
            { method: "GET" }
          );
          hasActiveSub = !!sub?.ok;
        } catch {
          hasActiveSub = false;
        }

        // 2) billing
        let missingBilling = [];
        try {
          const b = await api("/api/vendors/me/billing", {
            method: "GET",
          });
          const v = b?.billing || {};
          const need = (k) => !String(v[k] ?? "").trim();
          if (need("legalType")) missingBilling.push("Tip entitate");
          if (need("vendorName")) missingBilling.push("Nume vendor");
          if (need("companyName"))
            missingBilling.push("Denumire entitate");
          if (need("cui")) missingBilling.push("CUI");
          if (need("regCom")) missingBilling.push("Nr. Reg. Com.");
          if (need("address"))
            missingBilling.push("Adresă facturare");
          if (need("iban")) missingBilling.push("IBAN");
          if (need("bank")) missingBilling.push("Banca");
          if (need("email"))
            missingBilling.push("Email facturare");
          if (need("contactPerson"))
            missingBilling.push("Persoană contact");
          if (need("phone")) missingBilling.push("Telefon");
        } catch {
          missingBilling = ["Date facturare"];
        }

        if (!alive) return;
        setOwnerChecks({ hasActiveSub, missingBilling, loading: false });
      } catch {
        if (!alive) return;
        setOwnerChecks({
          hasActiveSub: false,
          missingBilling: ["Date facturare"],
          loading: false,
        });
      }
    })();

    return () => {
      alive = false;
    };
  }, [isOwner]);

  // === reviews: normalizare din hook (fallback inițial) ===
  const baseReviewsData = useMemo(() => {
    if (!reviews)
      return {
        items: [],
        total: 0,
        stats: { avg: rating || 0, c1: 0, c2: 0, c3: 0, c4: 0, c5: 0 },
      };
    if (Array.isArray(reviews))
      return {
        items: reviews,
        total: reviews.length,
        stats: { avg: rating || 0, c1: 0, c2: 0, c3: 0, c4: 0, c5: 0 },
      };
    return {
      items: reviews.items || [],
      total: reviews.total ?? (reviews.items?.length || 0),
      stats:
        reviews.stats || {
          avg: rating || 0,
          c1: 0,
          c2: 0,
          c3: 0,
          c4: 0,
          c5: 0,
        },
    };
  }, [reviews, rating]);

  // ID produs pentru reviews (primul activ)
  const firstActiveProductId = useMemo(() => {
    const active = Array.isArray(products)
      ? products.find((p) => p.isActive !== false)
      : null;
    return active?.id || active?._id || null;
  }, [products]);

  // stare listă + query
  const [revState, setRevState] = useState({
    items: baseReviewsData.items,
    total: baseReviewsData.total,
    stats: baseReviewsData.stats,
  });
  useEffect(() => {
    setRevState({
      items: baseReviewsData.items,
      total: baseReviewsData.total,
      stats: baseReviewsData.stats,
    });
  }, [baseReviewsData.items, baseReviewsData.total, baseReviewsData.stats]);

  const [query, setQuery] = useState({
    sort: "relevant",
    filter: { verified: false, star: 0 },
    skip: 0,
    take: 20,
  });

  async function fetchReviews(q) {
    if (!firstActiveProductId) return;
    const params = new URLSearchParams();
    params.set("sort", q.sort);
    params.set("skip", String(q.skip));
    params.set("take", String(q.take));
    if (q.filter?.verified) params.set("verified", "1");
    if (q.filter?.star >= 1 && q.filter?.star <= 5)
      params.set("star", String(q.filter.star));
    const res = await fetch(
      `/api/public/products/${encodeURIComponent(
        firstActiveProductId
      )}/reviews?${params}`
    );
    const data = await res.json();
    setRevState({
      items: data.items || [],
      total: data.total || 0,
      stats:
        data.stats || {
          avg: 0,
          c1: 0,
          c2: 0,
          c3: 0,
          c4: 0,
          c5: 0,
        },
    });
  }

  function changeQueryFromUI(p) {
    setQuery((prev) => {
      const next = {
        ...prev,
        ...p,
        filter: { ...prev.filter, ...(p?.filter || {}) },
        skip: 0,
      };
      fetchReviews(next).catch(() => {});
      return next;
    });
  }

  // helpers recenzii
  const onHelpful = async (reviewId) => {
    try {
      await api(`/api/reviews/${reviewId}/helpful`, { method: "POST" });
      fetchReviews(query).catch(() => {});
    } catch {
      alert("Nu am putut marca recenzia ca utilă.");
    }
  };

  const onReport = async (reviewId) => {
    const reason = window.prompt(
      "De ce raportezi această recenzie? (max 300 caractere)"
    );
    if (!reason) return;
    try {
      await api(`/api/reviews/${reviewId}/report`, {
        method: "POST",
        body: { reason },
      });
      alert("Mulțumim! Am înregistrat raportarea.");
    } catch {
      alert("Nu am putut raporta recenzia.");
    }
  };

  const onSubmitUserReview = async ({ rating: r, comment: c }) => {
    if (!firstActiveProductId) {
      alert(
        "Nu am găsit un produs activ pentru a atașa recenzia."
      );
      return;
    }
    try {
      await api("/api/reviews", {
        method: "POST",
        body: { productId: firstActiveProductId, rating: r, comment: c },
      });
      if (typeof refetch === "function")
        setTimeout(() => refetch().catch(() => {}), 200);
      fetchReviews(query).catch(() => {});
    } catch (er) {
      alert(er?.message || "Nu am putut trimite recenzia.");
    }
  };

  const onOptimisticAdd = (temp) => {
    setRevState((s) => ({
      ...s,
      items: [temp, ...s.items],
      total: s.total + 1,
    }));
  };

  /* ====== SAVE HELPERS: doar logoUrl & coverUrl prin /vendors/store/:slug ====== */
  async function saveStorePatch(patch) {
    const sd =
      sellerData?.slug || sellerData?.profile?.slug || slug;
    if (!sd) throw new Error("Slug lipsă la salvare.");
    const data = await api(
      `/api/vendors/store/${encodeURIComponent(sd)}`,
      {
        method: "PUT",
        body: { ...patch, mirrorVendor: true },
      }
    );
    return data?.profile || {};
  }

  async function onAvatarChange(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      const fd = new FormData();
      fd.append("file", f);
      const up = await fetch("/api/upload", {
        method: "POST",
        body: fd,
      });
      if (!up.ok) throw new Error("Upload eșuat");
      const { url } = await up.json();
      await saveStorePatch({ logoUrl: url });
      setProfilePatch((p) => ({
        ...p,
        profileImageUrl: url,
        logoUrl: url,
      }));
      setLocalCacheT(Date.now());
      broadcastProfileUpdated(slug);
      if (typeof refetch === "function")
        setTimeout(() => refetch().catch(() => {}), 250);
    } catch (er) {
      alert(er?.message || "Nu am putut salva avatarul");
    } finally {
      e.target.value = "";
    }
  }

  async function onCoverChange(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      const fd = new FormData();
      fd.append("file", f);
      const up = await fetch("/api/upload", {
        method: "POST",
        body: fd,
      });
      if (!up.ok) throw new Error("Upload eșuat");
      const { url } = await up.json();
      await saveStorePatch({ coverUrl: url });
      setProfilePatch((p) => ({
        ...p,
        coverImageUrl: url,
        coverUrl: url,
      }));
      setLocalCacheT(Date.now());
      broadcastProfileUpdated(slug);
      if (typeof refetch === "function")
        setTimeout(() => refetch().catch(() => {}), 250);
    } catch (er) {
      alert(er?.message || "Nu am putut salva coperta");
    } finally {
      e.target.value = "";
    }
  }

  // derive afișare
  const {
    shopName,
    brandStory,
    city,
    country,
    address,
    coverImageUrl: coverRaw,
    profileImageUrl: avatarRaw,
    tags = [],
    publicEmail,
    phone,
    delivery = [],
    website,
    leadTimes,
    slug: sdSlug,
    profile, // în caz că vine shortDescription și aici
  } = sellerData;

  // 🔹 scurta descriere sub nume – preferă shortDescription, apoi profile.shortDescription, apoi tagline
  const shortText = useMemo(
    () =>
      (
        sellerData?.shortDescription ??
        profile?.shortDescription ??
        profile?.tagline ??
        ""
      ).trim(),
    [sellerData?.shortDescription, profile?.shortDescription, profile?.tagline]
  );

  // „Despre” nu folosește descrierea scurtă ca fallback, ca să nu dublăm textul
  const aboutText = (brandStory ?? sellerData?.about ?? "—").trim();

  const coverUrl = useMemo(
    () =>
      coverRaw
        ? withCache(
            resolveFileUrl(coverRaw),
            localCacheT || cacheT
          )
        : "",
    [coverRaw, localCacheT, cacheT]
  );
  const avatarUrl = useMemo(
    () =>
      avatarRaw
        ? withCache(
            resolveFileUrl(avatarRaw),
            localCacheT || cacheT
          )
        : "",
    [avatarRaw, localCacheT, cacheT]
  );

  const origin =
    typeof window !== "undefined" && window.location?.origin
      ? window.location.origin
      : "https://artfest.ro";

  const pageUrl = `${origin}/magazin/${sdSlug || ""}`;
  const shareImage =
    coverUrl || avatarUrl || `${origin}/img/share-fallback.jpg`;
  const prettyDelivery =
    Array.isArray(delivery) && delivery.length
      ? (delivery[0] === "counties"
          ? delivery.slice(1)
          : delivery
        ).join(", ")
      : "";
  const seoPreloads = coverUrl
    ? [{ href: coverUrl, as: "image", useInDom: true }]
    : [];

  // 🧭 TRACKING – vendorId + hook (PAGEVIEW + VIEW_*)
  const vendorId =
    _sellerData?.id ||
    _sellerData?.vendorId ||
    _sellerData?.profile?.vendorId ||
    sellerData?.id ||
    sellerData?.vendorId ||
    sellerData?.profile?.vendorId ||
    null;

  const { trackCTA /*, trackMESSAGE*/ } = useVendorTracking(
    vendorId,
    pageUrl
  );

  // product modal open/edit
    const openEditProduct = async (p) => {
    if (!p) return;
    const id = p.id || p._id;
    if (!id) return;

    try {
      // 🔹 luăm produsul complet, cu toate câmpurile, din endpoint-ul de vendor
      const full = await api(
        `/api/vendors/products/${encodeURIComponent(id)}`,
        { method: "GET" }
      );

      setProdForm({
        id: full.id || full._id || "",
        title: full.title || "",
        description: full.description || "",
        price:
          typeof full.price === "number"
            ? full.price
            : Number.isFinite(full.priceCents)
            ? full.priceCents / 100
            : 0,
        images: Array.isArray(full.images) ? full.images : [],
        category: full.category || "",
        currency: full.currency || "RON",
        isActive: full.isActive !== false,

        // 🔸 câmpuri availability
        availability: (full.availability || "READY").toUpperCase(),
        leadTimeDays: Number.isFinite(Number(full.leadTimeDays))
          ? String(Number(full.leadTimeDays))
          : "",
        readyQty:
          full.readyQty === null || full.readyQty === undefined
            ? ""
            : Number.isFinite(Number(full.readyQty))
            ? String(Number(full.readyQty))
            : "",
        nextShipDate: full.nextShipDate
          ? String(full.nextShipDate).slice(0, 10)
          : "",
        acceptsCustom: !!full.acceptsCustom,
        isHidden: !!full.isHidden,

        // 🔸 culoare
        color: full.color || "",

        // 🔸 detalii structurate
        materialMain: full.materialMain || "",
        technique: full.technique || "",
        styleTags: Array.isArray(full.styleTags)
          ? full.styleTags.join(", ")
          : full.styleTags || "",
        occasionTags: Array.isArray(full.occasionTags)
          ? full.occasionTags.join(", ")
          : full.occasionTags || "",
        dimensions: full.dimensions || "",
        careInstructions: full.careInstructions || "",
        specialNotes: full.specialNotes || "",
      });

      setEditingOverride(full);
      setProdModalOpen(true);
    } catch (er) {
      console.error("Nu am putut încărca produsul pentru editare:", er);
      alert("Nu am putut încărca produsul pentru editare.");
    }
  };

  const closeProductModal = () => {
    setProdModalOpen(false);
    setEditingOverride(null);
  };

  const handleSaveProduct = async (e) => {
    e?.preventDefault?.();
    try {
      // Construim payload comun pentru create + edit
      const payload = {
        title: (prodForm.title || "").trim(),
        description: prodForm.description || "",
        price: Number(prodForm.price) || 0,
        images: Array.isArray(prodForm.images)
          ? prodForm.images
          : [],
        category: prodForm.category || null,
        currency: prodForm.currency || "RON",
        isActive: prodForm.isActive !== false,
        isHidden: !!prodForm.isHidden,

        availability: prodForm.availability || "READY",
        acceptsCustom: !!prodForm.acceptsCustom,
      };

      if (prodForm.availability === "MADE_TO_ORDER") {
        payload.leadTimeDays = Math.max(
          1,
          Number(prodForm.leadTimeDays || 1)
        );
        payload.readyQty = null;
        payload.nextShipDate = null;
      } else if (prodForm.availability === "READY") {
        payload.readyQty =
          prodForm.readyQty === "" || prodForm.readyQty == null
            ? null
            : Math.max(0, Number(prodForm.readyQty || 0));
        payload.leadTimeDays = null;
        payload.nextShipDate = null;
      } else if (prodForm.availability === "PREORDER") {
        payload.leadTimeDays = null;
        payload.readyQty = 0;
        payload.nextShipDate = prodForm.nextShipDate
          ? new Date(prodForm.nextShipDate).toISOString()
          : null;
      } else if (prodForm.availability === "SOLD_OUT") {
        payload.leadTimeDays = null;
        payload.readyQty = 0;
        payload.nextShipDate = null;
      }

      let saved;

      // EDIT EXISTENT
      if (editingOverride && (editingOverride.id || editingOverride._id)) {
        const id = editingOverride.id || editingOverride._id;

        saved = await api(
          `/api/vendors/products/${encodeURIComponent(id)}`,
          {
            method: "PUT",
            body: payload,
          }
        );

        try {
          window.dispatchEvent(
            new CustomEvent("vendor:productUpdated", {
              detail: { product: saved },
            })
          );
        } catch {
          ""
        }

        // CREATE NOU
      } else {
        const sd =
          sellerData?.slug ||
          sellerData?.profile?.slug ||
          slug;

        if (!sd) throw new Error("Slug lipsă la creare produs.");

        saved = await api(
          `/api/vendors/store/${encodeURIComponent(sd)}/products`,
          {
            method: "POST",
            body: payload,
          }
        );

        try {
          window.dispatchEvent(
            new CustomEvent("vendor:productUpdated", {
              detail: { product: saved },
            })
          );
        } catch {
          ""
        }
      }

      // Reîncarcă lista sigur, din server
      if (typeof refetch === "function") {
        setTimeout(() => refetch().catch(() => {}), 200);
      }

      closeProductModal();
    } catch (er) {
      alert(er?.message || "Nu am putut salva produsul.");
    }
  };

  const isLoading = loading;
  const errorText = err;

  /* ===================== TABS – ancore ===================== */
  const aboutRef = useRef(null);
  const infoRef = useRef(null);
  const productsRef = useRef(null);
  const reviewsRef = useRef(null);

  const [activeTab, setActiveTab] = useState("produse");

  // 👇 flag care ne spune când scroll-ul e declanșat din click pe tab
  const clickScrollRef = useRef(false);

  const HEADER_OFFSET = useMemo(() => {
    if (typeof window === "undefined") return 96;
    const rs = getComputedStyle(document.documentElement);
    const app = parseInt(rs.getPropertyValue("--appbar-h")) || 64;
    const tabs = parseInt(rs.getPropertyValue("--tabs-h")) || 44;
    return app + tabs + 12;
  }, []);

  const tabs = [
    { key: "despre", label: "Despre", ref: aboutRef, hash: "#despre" },
    {
      key: "informatii",
      label: "Informații",
      ref: infoRef,
      hash: "#informatii",
    },
    {
      key: "produse",
      label: "Produse",
      ref: productsRef,
      hash: "#produse",
    },
    {
      key: "recenzii",
      label: "Recenzii",
      ref: reviewsRef,
      hash: "#recenzii",
    },
  ];

  function smoothScrollTo(ref) {
    const el = ref?.current;
    if (!el || typeof window === "undefined") return;

    const rect = el.getBoundingClientRect();
    const absoluteY = window.scrollY + rect.top;

    // marcăm că urmează un scroll programatic din click/tab
    clickScrollRef.current = true;

    window.scrollTo({
      top: absoluteY - HEADER_OFFSET,
      behavior: "smooth",
    });

    // după ce se termină animația, permitem iar update-ul din scroll normal
    window.setTimeout(() => {
      clickScrollRef.current = false;
    }, 600);
  }

  function onJump(key) {
    const t = tabs.find((t) => t.key === key);
    if (!t) return;
    if (typeof history !== "undefined") {
      history.replaceState(null, "", t.hash);
    }
    smoothScrollTo(t.ref);
    setActiveTab(key);
  }

  // init din hash, dacă există
  useEffect(() => {
    if (typeof window === "undefined") return;

    const byHash = Object.fromEntries(tabs.map((t) => [t.hash, t]));
    const h = window.location.hash;
    const target = byHash[h] || tabs[0];

    if (target?.ref?.current) {
      const rect = target.ref.current.getBoundingClientRect();
      const absoluteY = window.scrollY + rect.top;
      window.scrollTo({ top: absoluteY - HEADER_OFFSET });
      setActiveTab(target.key);
    }

    const onHash = () => {
      const hh = window.location.hash;
      const tt = byHash[hh];
      if (tt?.ref?.current) {
        smoothScrollTo(tt.ref);
        setActiveTab(tt.key);
      }
    };

    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [HEADER_OFFSET]);

  // sincronizează activul cu SCROLL (schimbă la secțiunea cea mai vizibilă)
  useEffect(() => {
    if (typeof window === "undefined") return;

    const io = new IntersectionObserver(
      (entries) => {
        // dacă scroll-ul este declanșat programatic (din tab), nu reacționăm
        if (clickScrollRef.current) return;

        let best = { key: null, ratio: 0 };
        for (const e of entries) {
          if (e.isIntersecting) {
            const key = e.target.getAttribute("data-tab-key");
            if (e.intersectionRatio > best.ratio)
              best = { key, ratio: e.intersectionRatio };
          }
        }
        if (best.key && best.key !== activeTab) {
          setActiveTab(best.key);
          const t = tabs.find((x) => x.key === best.key);
          if (t && typeof history !== "undefined") {
            history.replaceState(null, "", t.hash);
          }
        }
      },
      {
        root: null,
        rootMargin: `-${HEADER_OFFSET + 8}px 0px -55% 0px`,
        threshold: [0, 0.1, 0.25, 0.5, 0.75, 1],
      }
    );

    tabs.forEach((t) => t.ref.current && io.observe(t.ref.current));
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [HEADER_OFFSET, tabs.map((t) => t.ref.current).join("|"), activeTab]);

  /* ========================================================= */

  return (
    <>
      <SEO
        title={shopName}
        description={
          shortText ||
          brandStory ||
          sellerData?.about ||
          "Descoperă produse unicat create de artizani pe Artfest."
        }
        url={pageUrl}
        image={shareImage}
        canonical={pageUrl}
        preloads={seoPreloads}
        jsonLd={[
          {
            "@context": "https://schema.org",
            "@type": "Organization",
            name: shopName,
            url: pageUrl,
            logo: shareImage,
            address: address || undefined,
            telephone: phone || undefined,
            email: publicEmail || undefined,
          },
          {
            "@context": "https://schema.org",
            "@type": "WebSite",
            name: "Artfest",
            url: origin,
            potentialAction: {
              "@type": "SearchAction",
              target: `${origin}/cauta?q={search_term_string}`,
              "query-input": "required name=search_term_string",
            },
          },
        ]}
      />

      {isLoading ? (
        <div style={{ padding: "2rem" }}>Se încarcă…</div>
      ) : needsOnboarding ? (
        <div style={{ padding: "2rem" }}>
          <h2 style={{ marginBottom: 8 }}>
            Încă nu ai configurat magazinul
          </h2>
          <p style={{ marginBottom: 16 }}>
            Pentru a-ți publica magazinul, completează pașii de
            onboarding.
          </p>
          <button
            type="button"
            className={styles.followBtn}
            onClick={() => navigate("/onboarding")}
          >
            Continuă crearea magazinului
          </button>
        </div>
      ) : errorText || !_sellerData ? (
        <div style={{ padding: "2rem" }}>
          {errorText || "Magazinul nu a fost găsit."}
          {isOwner && (
            <div style={{ marginTop: 16 }}>
              <button
                type="button"
                className={styles.followBtn}
                onClick={() => navigate("/onboarding")}
              >
                Continuă crearea magazinului
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className={styles.wrapper}>
          {/* Banner (owner) */}
          {isOwner && !ownerChecks.loading && (
            <OwnerWarningBanner
              missingProfile={missingProfile}
              missingBilling={ownerChecks.missingBilling}
              noSub={ownerChecks.hasActiveSub === false}
            />
          )}

          <div className={styles.cover}>
            {coverUrl ? (
              <img
                src={coverUrl}
                className={styles.coverImg}
                alt="Copertă"
                onError={(e) =>
                  onImgError(e, 1200, 360, "Cover")
                }
              />
            ) : (
              <div
                className={styles.coverPlaceholder}
                aria-label="Copertă"
              />
            )}

            {isOwner && (
              <>
                <button
                  type="button"
                  className={`${styles.editFab} ${styles.editFabCover}`}
                  onClick={() => coverInputRef.current?.click()}
                  title="Schimbă fotografia de copertă"
                  aria-label="Schimbă fotografia de copertă"
                >
                  <FaCamera size={18} />
                </button>
                <input
                  ref={coverInputRef}
                  type="file"
                  accept="image/*"
                  onChange={onCoverChange}
                  style={{ display: "none" }}
                />
              </>
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
                    onError={(e) =>
                      onImgError(e, 160, 160, "Profil")
                    }
                  />
                ) : (
                  <div
                    className={styles.avatarPlaceholder}
                    aria-label="Profil"
                  />
                )}

                {isOwner && (
                  <>
                    <button
                      type="button"
                      className={`${styles.editFab} ${styles.editFabAvatar}`}
                      onClick={() =>
                        avatarInputRef.current?.click()
                      }
                      title="Schimbă fotografia de profil"
                      aria-label="Schimbă fotografia de profil"
                    >
                      <FaCamera size={16} />
                    </button>
                    <input
                      ref={avatarInputRef}
                      type="file"
                      accept="image/*"
                      onChange={onAvatarChange}
                      style={{ display: "none" }}
                    />
                  </>
                )}
              </div>

              <div>
                <h1 className={styles.title}>{shopName}</h1>

                {shortText && (
                  <p className={styles.subtitle}>{shortText}</p>
                )}

                {!!sdSlug && (
                  <div
                    className={styles.linkRow}
                    style={{ marginTop: 6 }}
                  >
                    <div className={styles.slug}>
                      {origin}/magazin/{sdSlug}
                    </div>
                    <button
                      type="button"
                      className={styles.copyBtn}
                      onClick={async () => {
                        const url = `${origin}/magazin/${sdSlug}`;
                        try {
                          await navigator.clipboard.writeText(url);
                          // TRACK CTA: copy link
                          trackCTA("Copy profile link");
                          setCopied(true);
                          setTimeout(
                            () => setCopied(false),
                            1500
                          );
                        } catch {
                          const ta =
                            document.createElement("textarea");
                          ta.value = url;
                          document.body.appendChild(ta);
                          ta.select();
                          try {
                            document.execCommand("copy");
                            // TRACK CTA: copy link
                            trackCTA("Copy profile link");
                            setCopied(true);
                            setTimeout(
                              () => setCopied(false),
                              1500
                            );
                          } catch {
                            ""
                          }
                          document.body.removeChild(ta);
                        }
                      }}
                      title="Copiază link-ul profilului"
                      aria-label="Copiază link-ul profilului"
                    >
                      <FaCopy size={14} />
                    </button>
                    {copied && (
                      <span
                        className={styles.copiedBadge}
                        style={{ fontWeight: 700 }}
                      >
                        Copiat!
                      </span>
                    )}
                  </div>
                )}
              </div>

              {isOwner ? (
                <div
                  className={styles.actions}
                  style={{ display: "flex", gap: 8 }}
                >
                  <button
                    className={styles.followBtn}
                    onClick={openNewProduct}
                    title="Adaugă produs"
                    type="button"
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                    }}
                  >
                    <FaPlus /> Adaugă produs
                  </button>
                </div>
              ) : (
                <div className={styles.actions}>
                  <button
                    className={styles.followBtn}
                    onClick={() =>
                      me
                        ? (trackCTA("Follow"),
                          alert(
                            "Ai început să urmărești magazinul!"
                          ))
                        : (trackCTA("Follow"),
                          navigate(
                            "/autentificare?redirect=" +
                              encodeURIComponent(
                                window.location.pathname
                              )
                          ))
                    }
                    type="button"
                  >
                    Urmărește
                  </button>
                </div>
              )}
            </div>

            <hr className={styles.hr} />

            {/* ===== Bara de taburi (ancore) – se sincronizează cu scroll ===== */}
            <TabsNav
              items={tabs}
              activeKey={activeTab}
              onJump={onJump}
            />

            {/* ===== SECȚIUNI cu ancore ===== */}

            {/* Despre */}
            <section
              id="despre"
              ref={aboutRef}
              data-tab-key="despre"
              className={`${styles.section} sectionAnchorPad`}
            >
              <AboutSection
                aboutText={aboutText}
                canEdit={isOwner}
                editAbout={false}
                aboutDraft={aboutText}
                onToggleEditAbout={() =>
                  navigate(
                    "/onboarding/details?tab=profil&solo=1"
                  )
                }
                onChangeAbout={() => {}}
                onSaveAbout={() => {}}
                savingAbout={false}
              />
            </section>

            {/* Informații */}
            <section
              id="informatii"
              ref={infoRef}
              data-tab-key="informatii"
              className={`${styles.section} sectionAnchorPad`}
            >
              <InfoSection
                tags={tags}
                city={city}
                country={country}
                address={address}
                publicEmail={publicEmail}
                phone={phone}
                website={website}
                leadTimes={leadTimes}
                prettyDelivery={prettyDelivery}
                editInfo={false}
                savingInfo={false}
                infoErr={""}
                infoDraft={{}}
                onChangeInfoDraft={() => {}}
                countySuggestions={countySuggestions}
                countiesLoading={countiesLoading}
                countiesErr={countiesErr}
                onCountiesChange={onCountiesChange}
                canEdit={isOwner}
                onToggleEditInfo={() =>
                  navigate(
                    "/onboarding/details?tab=profil&solo=1"
                  )
                }
                onSaveInfo={async () => {}}
                onTrackCTA={trackCTA} // tracking cta
              />
            </section>

            {/* Produse */}
            <section
              id="produse"
              ref={productsRef}
              data-tab-key="produse"
              className={`${styles.section} sectionAnchorPad`}
            >
              <ProductList
                products={products}
                isOwner={isOwner}
                viewMode={viewMode}
                favorites={favorites}
                navigate={navigate}
                onAddFirstProduct={openNewProduct}
                productsCacheT={productsCacheT}
                onEditProduct={openEditProduct}
              />
            </section>

            {/* Recenzii */}
            <section
              id="recenzii"
              ref={reviewsRef}
              data-tab-key="recenzii"
              className={`${styles.section} sectionAnchorPad`}
            >
              <ReviewsSection
                rating={rating}
                reviews={revState.items}
                totalCount={revState.total}
                stats={revState.stats}
                canWrite={viewMode !== "vendor" && !!me}
                isVendorView={viewMode === "vendor"}
                me={me}
                onSubmit={onSubmitUserReview}
                onOptimisticAdd={onOptimisticAdd}
                onHelpful={onHelpful}
                onReport={onReport}
                onChangeQuery={changeQueryFromUI}
                onVendorReply={async (reviewId, text) => {
                  await api(
                    `/api/reviews/${reviewId}/reply`,
                    {
                      method: "POST",
                      body: { text },
                    }
                  );
                  fetchReviews(query).catch(() => {});
                }}
                onVendorDeleteReply={async (reviewId) => {
                  await api(
                    `/api/reviews/${reviewId}/reply`,
                    {
                      method: "DELETE",
                    }
                  );
                  fetchReviews(query).catch(() => {});
                }}
              />
            </section>
          </div>
        </div>
      )}

      {/* Gate & Modal produs — rămân neschimbate */}
      <VendorGateModal
        open={gateOpen}
        onClose={() => setGateOpen(false)}
        gateLoading={gateLoading}
        gateErr={gateErr}
        gateDocs={gateDocs}
        gateChecks={setGateChecks}
        setGateChecks={setGateChecks}
        onAccept={acceptVendorDocs}
      />

      <ProductModal
        open={prodModalOpen}
        onClose={closeProductModal}
        saving={savingProd}
        editingProduct={editingOverride || editingProduct}
        form={prodForm}
        setForm={setProdForm}
        categories={categories}
        onSave={handleSaveProduct}
        uploadFile={async (f) => {
          const fd = new FormData();
          fd.append("file", f);
          const res = await fetch("/api/upload", {
            method: "POST",
            body: fd,
          });
          const { url } = await res.json();
          return url;
        }}
      />
    </>
  );
}
