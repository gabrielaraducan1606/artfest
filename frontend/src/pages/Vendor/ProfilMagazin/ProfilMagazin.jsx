import React, {
  useRef,
  useState,
  useEffect,
  useMemo,
  lazy,
  Suspense,
} from "react";
import { useParams, useNavigate } from "react-router-dom";
import styles from "./ProfilMagazin.module.css";
import { SEO } from "../../../components/Seo/SeoProvider.jsx";
import { onImgError } from "../../../components/utils/imageFallback";
import { FaCopy, FaPlus, FaCamera } from "react-icons/fa";
import { MessageSquare } from "lucide-react";
import { api } from "../../../lib/api";

// hook + helpers
import useProfilMagazin, {
  withCache,
  resolveFileUrl,
} from "./hooks/useProfilMagazin";

// ✅ user curent
import { useAuth } from "../../Auth/Context/context.js";

// secțiuni
import AboutSection from "./components/AboutSection";
import InfoSection from "./components/InfoSection";
import ProductList from "./components/ProductList";
import TabsNav from "./components/TabsNav.jsx";

// lazy
const ReviewsSection = lazy(() => import("./components/ReviewsSection.jsx"));
const VendorGateModal = lazy(() => import("./modals/VendorGateModal"));
const ProductModal = lazy(() => import("./modals/ProductModal"));

/* ========================= Helpers pentru erori activate ========================= */
function extractMissing(e) {
  try {
    return (
      e?.missing ||
      e?.data?.missing ||
      e?.response?.data?.missing ||
      e?.body?.missing ||
      null
    );
  } catch {
    return null;
  }
}
function extractCode(e) {
  try {
    return (
      e?.error ||
      e?.code ||
      e?.data?.error ||
      e?.response?.data?.error ||
      null
    );
  } catch {
    return null;
  }
}
function humanizeActivateError(e) {
  const code = extractCode(e);
  const missing = extractMissing(e);

  if (code === "vendor_entity_not_confirmed") {
    return "Pentru a activa serviciile, trebuie să confirmi că reprezinți o entitate juridică (PFA / SRL / II / IF). Poți face asta din bannerul de deasupra listei de servicii din Dashboard.";
  }

  if (Array.isArray(missing) && missing.length) {
    return `Completează câmpurile obligatorii: ${missing.join(", ")}`;
  }
  if (code === "missing_required_fields_core") {
    return "Completează câmpurile esențiale ale serviciului și profilului, apoi încearcă din nou.";
  }
  if (code === "missing_required_fields_profile") {
    return "Completează profilul magazinului (brand, adresă, zonă acoperire, imagine și acord Master), apoi încearcă din nou.";
  }
  return e?.message || "Nu am putut activa serviciul.";
}

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
      /* noop */
    }
    fetch("/api/visitors/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).catch(() => {});
  };

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

    send({
      vendorId,
      type: "PAGEVIEW",
      pageUrl: url,
      referrer: ref,
      sessionId: sid,
    });
    send({
      vendorId,
      type: "VIEW_START",
      pageUrl: url,
      referrer: ref,
      sessionId: sid,
      viewId: newView,
    });

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
          Din <b>Date facturare</b> lipsesc: {missingBilling.join(", ")}.{" "}
          <a href="/onboarding/details?tab=facturare">
            Completează acum
          </a>
          .
        </div>
      )}
    </div>
  );
}

// ⛔️ ActivationHintBanner A FOST SCOS – nu mai trimitem userul în Desktop pentru activare

function broadcastProfileUpdated(serviceIdOrSlug) {
  try {
    window.dispatchEvent(
      new CustomEvent("vendor:profileUpdated", {
        detail: { idOrSlug: serviceIdOrSlug },
      })
    );
  } catch {
    /* noop */
  }
  try {
    localStorage.setItem("vendorProfileUpdatedAt", String(Date.now()));
  } catch {
    /* noop */
  }
}

function dateOnlyToISO(yyyyMmDd) {
  if (!yyyyMmDd) return null;
  const [y, m, d] = String(yyyyMmDd).split("-").map(Number);
  if (!y || !m || !d) return null;
  const dt = new Date(y, m - 1, d, 12, 0, 0);
  return dt.toISOString();
}

export default function ProfilMagazin() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const { me } = useAuth();
  const isUser = me?.role === "USER";

  const {
    sellerData: _sellerData,
    products,
    rating,
    isOwner,
    viewMode,
    categories,
    favorites,
    loading,
    err,
    needsOnboarding,
    cacheT,
    productsCacheT,

    // Info inline edit din hook
    editInfo,
    setEditInfo,
    savingInfo,
    infoErr,
    infoDraft,
    onChangeInfoDraft,
    saveInfoNow,

    countySuggestions,
    countiesLoading,
    countiesErr,
    onCountiesChange,

    prodModalOpen,
    setProdModalOpen,
    savingProd,
    editingProduct,
    prodForm,
    setProdForm,

    // poarta veche din hook nu o mai folosim aici, ne facem stare locală
    openNewProduct,
  } = useProfilMagazin(slug, { me });

  const [editingOverride, setEditingOverride] = useState(null);
  const [copied, setCopied] = useState(false);

  // stare locală pentru poarta de acorduri
  const [gateState, setGateState] = useState({
  open: false,
  loading: false,
  error: "",
  docs: null,
  checks: {
    declaration: false,      // ✅ folosit de VendorGateModal
    vendorTermsRead: false,  // opțional
  },
});

  const [profilePatch, setProfilePatch] = useState({});
  const [localCacheT, setLocalCacheT] = useState(Date.now());

  const avatarInputRef = useRef(null);
  const coverInputRef = useRef(null);

  const sellerData = useMemo(
    () => ({ ...(_sellerData || {}), ...profilePatch }),
    [_sellerData, profilePatch]
  );

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

        let hasActiveSub = false;
        try {
          const sub = await api("/api/vendors/me/subscription/status", {
            method: "GET",
          });
          hasActiveSub = !!sub?.ok;
        } catch {
          hasActiveSub = false;
        }

        let missingBilling = [];
        try {
          const b = await api("/api/vendors/me/billing", {
            method: "GET",
          });
          const v = b?.billing || {};
          const need = (k) => !String(v[k] ?? "").trim();
          if (need("legalType")) missingBilling.push("Tip entitate");
          if (need("vendorName")) missingBilling.push("Nume vendor");
          if (need("companyName")) missingBilling.push("Denumire entitate");
          if (need("cui")) missingBilling.push("CUI");
          if (need("regCom")) missingBilling.push("Nr. Reg. Com.");
          if (need("address")) missingBilling.push("Adresă facturare");
          if (need("iban")) missingBilling.push("IBAN");
          if (need("bank")) missingBilling.push("Banca");
          if (need("email")) missingBilling.push("Email facturare");
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

  const serviceIsActive = useMemo(() => {
    const s = sellerData || {};
    const statusRaw = s.status || s.profile?.status || "";
    const activeByStatus = String(statusRaw).toUpperCase() === "ACTIVE";
    const flag =
      s.isActive ??
      s.serviceIsActive ??
      s.profile?.serviceIsActive ??
      activeByStatus;
    return Boolean(flag);
  }, [sellerData]);

  // ========= City labels din CityDictionary (public) =========
  const [cityLabelMap, setCityLabelMap] = useState(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/public/stores/cities");
        if (!res.ok) return;
        const data = await res.json();
        const map = {};
        if (Array.isArray(data?.cities)) {
          for (const c of data.cities) {
            if (c.slug && c.label) {
              map[c.slug] = c.label;
            }
          }
        }
        if (!alive) return;
        setCityLabelMap(map);
      } catch {
        // noop – fallback la city brut
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // ========= Date bază din sellerData (inclusiv slug) =========
  const {
    shopName,
    brandStory,
    city,
    citySlug: rawCitySlug,
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
    profile,
  } = sellerData;

  // slug-ul de oraș preferat (service/profile/vendor)
  const citySlug =
    profile?.citySlug ||
    rawCitySlug ||
    sellerData?.service?.citySlug ||
    sellerData?.vendor?.citySlug ||
    null;

  // ✅ Oraș afișat – iau label din dicționar dacă există, altfel fallback pe city din profil
  const niceCity =
    (citySlug && cityLabelMap && cityLabelMap[citySlug]) ||
    profile?.city ||
    sellerData?.service?.city ||
    sellerData?.vendor?.city ||
    city ||
    "";

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

  const aboutText = (brandStory ?? sellerData?.about ?? "").trim();

  // 👇 AICI: logica pentru afișarea secțiunii "Despre"
  const showAboutSection = isOwner || !!aboutText;

  /* ====== Editare inline "Despre" ====== */
  const [editAbout, setEditAbout] = useState(false);
  const [aboutDraft, setAboutDraft] = useState(aboutText);
  const [savingAbout, setSavingAbout] = useState(false);

  useEffect(() => {
    setAboutDraft(aboutText);
  }, [aboutText]);

  function handleToggleEditAbout() {
    if (!isOwner) return;
    setEditAbout((x) => !x);
  }

  function handleChangeAbout(val) {
    setAboutDraft(val);
  }

  async function handleSaveAbout() {
    if (!isOwner) return;
    const val = (aboutDraft || "").trim();

    try {
      setSavingAbout(true);
      const profileResp = await saveStorePatch({
        about: val,
        brandStory: val,
      });

      setProfilePatch((p) => ({
        ...p,
        about: profileResp.about ?? val,
        brandStory: profileResp.brandStory ?? val,
      }));

      setEditAbout(false);
      broadcastProfileUpdated(sdSlug || slug);
    } catch (er) {
      alert(er?.message || "Nu am putut salva descrierea magazinului.");
    } finally {
      setSavingAbout(false);
    }
  }

  const coverUrl = useMemo(
    () =>
      coverRaw
        ? withCache(resolveFileUrl(coverRaw), localCacheT || cacheT)
        : "",
    [coverRaw, localCacheT, cacheT]
  );
  const avatarUrl = useMemo(
    () =>
      avatarRaw
        ? withCache(resolveFileUrl(avatarRaw), localCacheT || cacheT)
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
      ? (delivery[0] === "counties" ? delivery.slice(1) : delivery).join(", ")
      : "";
  const seoPreloads = coverUrl
    ? [{ href: coverUrl, as: "image", useInDom: true }]
    : [];

  // pentru tracking rămânem pe vendorId
  const vendorId =
    _sellerData?.vendorId ||
    _sellerData?.profile?.vendorId ||
    _sellerData?.vendor?.id ||
    sellerData?.vendorId ||
    sellerData?.profile?.vendorId ||
    sellerData?.vendor?.id ||
    null;

  const { trackCTA, trackMESSAGE } = useVendorTracking(vendorId, pageUrl);

  // ID-ul magazinului (VendorService)
  const serviceId =
    _sellerData?.serviceId ||
    sellerData?.serviceId ||
    _sellerData?.id ||
    sellerData?.id ||
    _sellerData?._id ||
    sellerData?._id ||
    null;

  // ========= Reviews de magazin (StoreReview) =========
  const baseReviewsData = useMemo(
    () => ({
      items: [],
      total: 0,
      stats: {
        avg: rating || 0,
        c1: 0,
        c2: 0,
        c3: 0,
        c4: 0,
        c5: 0,
      },
    }),
    [rating]
  );

  const [revState, setRevState] = useState({
    items: baseReviewsData.items,
    total: baseReviewsData.total,
    stats: baseReviewsData.stats,
  });
  const [reviewsLoaded, setReviewsLoaded] = useState(
    () => baseReviewsData.items.length > 0
  );

  useEffect(() => {
    setRevState({
      items: baseReviewsData.items,
      total: baseReviewsData.total,
      stats: baseReviewsData.stats,
    });
  }, [baseReviewsData.items, baseReviewsData.total, baseReviewsData.stats]);

  const [query, setQuery] = useState({
    sort: "relevant",
    filter: {
      verified: false,
      star: 0,
      noReply: false,
      lowRatingOnly: false,
    },
    skip: 0,
    take: 20,
  });

  async function fetchReviews(q) {
    const storeSlug = sdSlug || slug;
    if (!storeSlug) return;

    const params = new URLSearchParams();
    params.set("sort", q.sort);
    params.set("skip", String(q.skip));
    params.set("take", String(q.take));

    if (q.filter?.verified) params.set("verified", "1");
    if (q.filter?.star >= 1 && q.filter?.star <= 5) {
      params.set("star", String(q.filter.star));
    }

    if (q.filter?.noReply) params.set("noReply", "1");
    if (q.filter?.lowRatingOnly) params.set("lowRatingOnly", "1");

    const url = `/api/public/store/${encodeURIComponent(
      storeSlug
    )}/reviews?${params.toString()}`;

    const res = await fetch(url);
    const data = await res.json();

    let items = [];
    let total = 0;
    let stats = {
      avg: 0,
      c1: 0,
      c2: 0,
      c3: 0,
      c4: 0,
      c5: 0,
    };

    // 🔹 cazul 1: backend-ul trimite ARRAY simplu: []
    if (Array.isArray(data)) {
      items = data;
      total = data.length;

      // calculăm un mic histogram + medie pe loc
      if (data.length) {
        const counts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
        let sum = 0;

        for (const r of data) {
          const s = Number(r.rating || 0);
          if (s >= 1 && s <= 5) {
            counts[s] = (counts[s] || 0) + 1;
            sum += s;
          }
        }

        stats = {
          c1: counts[1] || 0,
          c2: counts[2] || 0,
          c3: counts[3] || 0,
          c4: counts[4] || 0,
          c5: counts[5] || 0,
          avg: total ? Number((sum / total).toFixed(2)) : 0,
        };
      }
    } else if (data && typeof data === "object") {
      // 🔹 cazul 2: backend-ul trimite { items, total, stats }
      items = data.items || [];
      total = data.total ?? items.length;
      stats = data.stats || stats;
    }

    setRevState({
      items,
      total,
      stats,
    });

    setReviewsLoaded(true);
  }

  async function ensureReviewsLoaded() {
    if (reviewsLoaded) return;
    try {
      await fetchReviews(query);
    } catch {
      /* noop */
    }
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

  const onHelpful = async (reviewId) => {
    try {
      await api(`/api/store-reviews/${reviewId}/helpful`, {
        method: "POST",
      });
      fetchReviews(query).catch(() => {});
    } catch {
      alert("Nu am putut marca recenzia ca utilă.");
    }
  };

  const onReport = async (reviewId, reasonText) => {
    const reason = (reasonText || "").trim();
    if (!reason) return;

    try {
      await api(`/api/store-reviews/${reviewId}/report`, {
        method: "POST",
        body: { reason },
      });
      alert("Mulțumim! Am înregistrat raportarea.");
    } catch {
      alert("Nu am putut raporta recenzia.");
    }
  };
  const onDeleteUserReview = async (reviewId) => {
    if (!reviewId) return;
    const ok = window.confirm("Sigur vrei să ștergi această recenzie?");
    if (!ok) return;

    try {
      await api(`/api/store-reviews/${reviewId}`, {
        method: "DELETE",
      });
      // reîncarcăm lista de recenzii din backend
      fetchReviews(query).catch(() => {});
    } catch (e) {
      alert(e?.message || "Nu am putut șterge recenzia.");
    }
  };

  const onSubmitUserReview = async ({ rating: r, comment: c }) => {
    // recenzie de PROFIL magazin -> avem nevoie de vendorId (nu de productId / serviceId)
    if (!vendorId) {
      alert(
        "Nu am putut identifica magazinul pentru recenzie. Reîncarcă pagina și încearcă din nou."
      );
      return;
    }

    const ratingVal = Number(r);
    const comment = (c || "").trim();

    if (!Number.isFinite(ratingVal) || ratingVal < 1 || ratingVal > 5) {
      alert("Te rog alege un rating între 1 și 5 stele.");
      return;
    }

    try {
      await api("/api/store-reviews", {
        method: "POST",
        body: {
          vendorId,
          rating: ratingVal,
          comment,
        },
      });

      // după ce API-ul a salvat recenzia, re-încărcăm lista din backend
      fetchReviews(query).catch(() => {});
    } catch (er) {
      console.error("onSubmitUserReview error", er);
      alert(er?.message || "Nu am putut trimite recenzia.");
    }
  };

  // ========= Patch profil magazin (avatar / cover) =========
  async function saveStorePatch(patch) {
    const sd = sellerData?.slug || sellerData?.profile?.slug || slug;
    if (!sd) throw new Error("Slug lipsă la salvare.");
    const data = await api(`/api/vendors/store/${encodeURIComponent(sd)}`, {
      method: "PUT",
      body: { ...patch, mirrorVendor: true },
    });
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
    } catch (er) {
      alert(er?.message || "Nu am putut salva coperta");
    } finally {
      e.target.value = "";
    }
  }

  // FOLLOW magazin
  const [following, setFollowing] = useState(false);
  const [followersCount, setFollowersCount] = useState(0);
  const [followLoading, setFollowLoading] = useState(false);

  // status follow + număr urmăritori
  useEffect(() => {
    if (!serviceId) return;

    let alive = true;

    (async () => {
      try {
        // count public
        const resCount = await api(
          `/api/stores/${encodeURIComponent(serviceId)}/followers-count`,
          { method: "GET" }
        );

        if (!alive || !resCount?.ok) return;

        let initialCount =
          typeof resCount.followersCount === "number"
            ? resCount.followersCount
            : 0;
        setFollowersCount(initialCount);

        // dacă e logat, luăm și status personal
        if (me) {
          try {
            const resStatus = await api(
              `/api/stores/${encodeURIComponent(serviceId)}/follow`,
              { method: "GET" }
            );
            if (!alive || !resStatus?.ok) return;
            setFollowing(!!resStatus.following);
            if (typeof resStatus.followersCount === "number") {
              setFollowersCount(resStatus.followersCount);
            }
          } catch {
            setFollowing(false);
          }
        } else {
          setFollowing(false);
        }
      } catch {
        /* noop */
      }
    })();

    return () => {
      alive = false;
    };
  }, [serviceId, me]);

  async function toggleFollow() {
    // urmărim magazinul (VendorService), deci folosim serviceId
    if (!serviceId) {
      console.warn("Nu am serviceId, nu pot urmări magazinul.");
      return;
    }

    // dacă nu e logat, îl ducem la login cu redirect înapoi
    if (!me) {
      trackCTA("Follow (unauthenticated)");
      navigate(
        "/autentificare?redirect=" +
          encodeURIComponent(window.location.pathname)
      );
      return;
    }

    try {
      setFollowLoading(true);

      const method = following ? "DELETE" : "POST";
      trackCTA(following ? "Unfollow" : "Follow");

      const res = await api(
        `/api/stores/${encodeURIComponent(serviceId)}/follow`,
        { method }
      );

      if (!res?.ok) {
        alert("Nu am putut actualiza urmărirea magazinului.");
        return;
      }

      setFollowing(res.following);

      setFollowersCount((prev) => {
        if (typeof res.followersCount === "number") {
          return res.followersCount;
        }
        // fallback optimist
        return prev + (following ? -1 : 1);
      });
    } catch (e) {
      console.error("toggleFollow error", e);
      alert(e?.message || "Eroare la actualizarea urmăririi.");
    } finally {
      setFollowLoading(false);
    }
  }

  // ✅ Contact vendor – user -> vendor
  async function handleContactVendor() {
    // Dacă nu avem NICI vendorId, NICI serviceId, nu are cu ce lucra backend-ul
    if (!vendorId && !serviceId) {
      console.warn("Nu am vendorId/serviceId pentru acest magazin:", {
        vendorId,
        serviceId,
        slug,
        sdSlug,
      });
      alert("Nu am găsit datele necesare pentru acest magazin.");
      return;
    }

    if (!me) {
      // redirect la login, apoi înapoi la acest profil
      navigate(
        "/autentificare?redirect=" +
          encodeURIComponent(
            window.location.pathname + window.location.search
          )
      );
      return;
    }

    // opțional: nu lăsăm VENDOR/ADMIN să folosească API-ul de user-inbox
    if (me.role === "VENDOR" || me.role === "ADMIN") {
      alert("Doar clienții (utilizatorii) pot trimite mesaje către vendor.");
      return;
    }

    try {
      // trimitem tot ce avem: vendorId (dacă există), serviceId, slug
      const res = await api("/api/user-inbox/ensure-thread", {
        method: "POST",
        body: {
          vendorId: vendorId || null,
          serviceId: serviceId || null,
          storeSlug: sdSlug || slug || null,
        },
      });

      if (!res?.threadId) {
        alert("Nu am putut deschide conversația cu vendorul.");
        return;
      }

      trackMESSAGE("Contact vendor");
      // ducem userul în inbox-ul lui, pe thread-ul corect
      navigate(`/cont/mesaje?thread=${encodeURIComponent(res.threadId)}`);
    } catch (e) {
      console.error("Nu am putut deschide conversația", e);
      alert("Nu am putut deschide conversația cu vendorul. Încearcă din nou.");
    }
  }

  const handleAddProduct = async () => {
  if (!isOwner) return;

  // 🟢 dacă există deja produse, nu mai afișăm poarta – direct ProductModal
  const hasProducts = Array.isArray(products) && products.length > 0;
  if (hasProducts) {
    openNewProduct();
    return;
  }

  // 🔴 dacă este primul produs -> verificăm declarația de produse
  try {
    setGateState((s) => ({
      ...s,
      loading: true,
      error: "",
    }));

    const resp = await api("/api/vendor/product-declaration/status", {
      method: "GET",
    });

    // dacă declarația este deja acceptată -> nu mai arătăm poarta
    if (resp?.accepted) {
      setGateState((s) => ({
        ...s,
        loading: false,
        open: false,
        docs: {
          vendor_terms: {
            doc_key: "VENDOR_TERMS",
            url: resp.docUrl || "/legal/vendor/terms",
            version: resp.version || null,
          },
        },
      }));
      openNewProduct();
      return;
    }

    // nu e acceptată -> deschidem poarta cu link la acord
    setGateState({
      open: true,
      loading: false,
      error: "",
      docs: {
        vendor_terms: {
          doc_key: "VENDOR_TERMS",
          url: resp?.docUrl || "/legal/vendor/terms",
          version: resp?.version || null,
        },
      },
      checks: {
        declaration: false,
        vendorTermsRead: false,
      },
    });
  } catch (e) {
    console.error("product-declaration/status error", e);
    // în caz de eroare, nu blocăm complet: deschidem direct modalul
    setGateState((s) => ({
      ...s,
      loading: false,
      error:
        e?.message ||
        "Nu am putut verifica declarația produselor. Poți continua să adaugi produsul.",
    }));
    openNewProduct();
  }
};

  const handleAcceptGate = async () => {
  const { docs, checks } = gateState;
  const vendorTerms = docs?.vendor_terms;

  if (!vendorTerms) return;

  if (!checks.declaration) {
    setGateState((s) => ({
      ...s,
      error:
        "Trebuie să confirmi declarația de conformitate pentru a continua.",
    }));
    return;
  }

  setGateState((s) => ({
    ...s,
    loading: true,
    error: "",
  }));

  try {
    await api("/api/vendor/product-declaration/accept", {
      method: "POST",
      body: {
        version: vendorTerms.version || "v1.0",
      },
    });

    // după acceptare, poarta nu se mai arată la următoarele click-uri
    setGateState((s) => ({
      ...s,
      open: false,
      loading: false,
      error: "",
    }));

    openNewProduct();
  } catch (e) {
    console.error("product-declaration/accept error", e);
    setGateState((s) => ({
      ...s,
      loading: false,
      error:
        e?.message ||
        "Nu am putut salva acceptarea declarației. Încearcă din nou.",
    }));
  }
};

  const openEditProduct = async (p) => {
    if (!p) return;
    const id = p.id || p._id;
    if (!id) return;

    try {
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

        color: full.color || "",

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
      const title = (prodForm.title || "").trim();
      const description = prodForm.description || "";
      const price = Number(prodForm.price);
      const images = Array.isArray(prodForm.images) ? prodForm.images : [];
      const category = (prodForm.category || "").trim();

      const color = (prodForm.color || "").trim() || null;
      const materialMain = (prodForm.materialMain || "").trim() || null;
      const technique = (prodForm.technique || "").trim() || null;
      const styleTags = (prodForm.styleTags || "").trim();
      const occasionTags = (prodForm.occasionTags || "").trim();
      const dimensions = (prodForm.dimensions || "").trim() || null;
      const careInstructions =
        (prodForm.careInstructions || "").trim() || null;
      const specialNotes = (prodForm.specialNotes || "").trim() || null;

      if (!title) {
        alert("Te rog adaugă un titlu.");
        return;
      }
      if (!Number.isFinite(price) || price < 0) {
        alert("Preț invalid.");
        return;
      }
      if (!category) {
        alert("Selectează categoria produsului.");
        return;
      }

      const basePayload = {
        title,
        description,
        price,
        images,
        category,
        currency: prodForm.currency || "RON",
        isActive: prodForm.isActive !== false,
        isHidden: !!prodForm.isHidden,
        acceptsCustom: !!prodForm.acceptsCustom,
        color,
        materialMain,
        technique,
        styleTags,
        occasionTags,
        dimensions,
        careInstructions,
        specialNotes,
      };

      const av = String(prodForm.availability || "READY").toUpperCase();

      const payload = {
        ...basePayload,
        availability: av,
        leadTimeDays: null,
        readyQty: null,
        nextShipDate: null,
      };

      if (av === "MADE_TO_ORDER") {
        const lt = Number(prodForm.leadTimeDays || 0);
        payload.leadTimeDays = Number.isFinite(lt) && lt > 0 ? lt : 1;
      }

      if (av === "READY") {
        if (prodForm.readyQty !== "" && prodForm.readyQty != null) {
          const rq = Number(prodForm.readyQty);
          payload.readyQty = Number.isFinite(rq) && rq >= 0 ? rq : 0;
        } else {
          payload.readyQty = null;
        }
      }

      if (av === "PREORDER") {
        payload.nextShipDate = prodForm.nextShipDate
          ? dateOnlyToISO(prodForm.nextShipDate)
          : null;
      }

      if (av === "SOLD_OUT") {
        payload.readyQty = 0;
      }

      let saved;
      const isEdit =
        !!editingOverride && (editingOverride.id || editingOverride._id);

      if (isEdit) {
        // 👉 UPDATE produs existent
        const id = editingOverride.id || editingOverride._id;

        saved = await api(
          `/api/vendors/products/${encodeURIComponent(id)}`,
          {
            method: "PUT",
            body: payload,
          }
        );
      } else {
        // 👉 CREATE produs nou
        const sd = sellerData?.slug || sellerData?.profile?.slug || slug;

        if (!sd) throw new Error("Slug lipsă la creare produs.");

        saved = await api(
          `/api/vendors/store/${encodeURIComponent(sd)}/products`,
          {
            method: "POST",
            body: payload,
          }
        );
      }

      // 🔔 Broadcast către listă:
      try {
        window.dispatchEvent(
          new CustomEvent(
            isEdit ? "vendor:productUpdated" : "vendor:productCreated",
            {
              detail: { product: saved },
            }
          )
        );
      } catch {
        /* noop */
      }

      closeProductModal();
    } catch (er) {
      alert(er?.message || "Nu am putut salva produsul.");
    }
  };

  const isLoading = loading;
  const errorText = err;

  const aboutRef = useRef(null);
  const infoRef = useRef(null);
  const productsRef = useRef(null);
  const reviewsRef = useRef(null);

  const [activeTab, setActiveTab] = useState("produse");
  const clickScrollRef = useRef(false);

  const HEADER_OFFSET = useMemo(() => {
    if (typeof window === "undefined") return 96;
    const rs = getComputedStyle(document.documentElement);
    const app = parseInt(rs.getPropertyValue("--appbar-h")) || 64;
    const tabs = parseInt(rs.getPropertyValue("--tabs-h")) || 44;
    return app + tabs + 12;
  }, []);

  // 👇 Tabs: includem "Despre" doar dacă showAboutSection e true
  const tabs = [
    ...(showAboutSection
      ? [{ key: "despre", label: "Despre", ref: aboutRef, hash: "#despre" }]
      : []),
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

    clickScrollRef.current = true;

    window.scrollTo({
      top: absoluteY - HEADER_OFFSET,
      behavior: "smooth",
    });

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
    if (key === "recenzii") {
      ensureReviewsLoaded();
    }
  }

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
      if (target.key === "recenzii") {
        ensureReviewsLoaded();
      }
    }

    const onHash = () => {
      const hh = window.location.hash;
      const tt = byHash[hh];
      if (tt?.ref?.current) {
        smoothScrollTo(tt.ref);
        setActiveTab(tt.key);
        if (tt.key === "recenzii") {
          ensureReviewsLoaded();
        }
      }
    };

    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [HEADER_OFFSET]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const io = new IntersectionObserver(
      (entries) => {
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
          if (best.key === "recenzii") {
            ensureReviewsLoaded();
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

  /* ========== Stare & handler pentru activare/dezactivare magazin ========== */
  const [activationBusy, setActivationBusy] = useState(false);
  const [activationError, setActivationError] = useState("");

  async function handleToggleActive() {
    if (!isOwner || !serviceId || activationBusy) return;

    // dacă vrem să ACTIVĂM
    if (!serviceIsActive) {
      // 1) abonament
      if (ownerChecks.hasActiveSub === false) {
        alert(
          "Pentru a activa magazinul, ai nevoie de un abonament activ. Vei fi dus la pagina de abonament."
        );
        navigate("/onboarding/details?tab=plata&solo=1");
        return;
      }

      // 2) profil + facturare
      const blocking = [];

      if (missingProfile.length) {
        blocking.push("Profil magazin: " + missingProfile.join(", "));
      }

      if (ownerChecks.missingBilling?.length) {
        blocking.push(
          "Date facturare: " + ownerChecks.missingBilling.join(", ")
        );
      }

      if (blocking.length) {
        alert(
          `Pentru a activa magazinul, trebuie să completezi:\n- ${blocking.join(
            "\n- "
          )}\n\nPoți completa din secțiunea „Informații” și din onboarding (tab-urile Profil / Facturare).`
        );
        // îl ducem vizual în tab-ul de informații
        onJump("informatii");
        return;
      }
    }

    try {
      setActivationBusy(true);
      setActivationError("");

      if (serviceIsActive) {
        // 👉 DEZACTIVARE
        await api(
          `/api/vendors/me/services/${encodeURIComponent(
            serviceId
          )}/deactivate`,
          { method: "POST" }
        );

        setProfilePatch((p) => ({
          ...p,
          isActive: false,
          status: "INACTIVE",
          profile: {
            ...(sellerData.profile || {}),
            ...(p.profile || {}),
            serviceIsActive: false,
            status: "INACTIVE",
          },
        }));
      } else {
        // 👉 ACTIVARE
        await api(
          `/api/vendors/me/services/${encodeURIComponent(
            serviceId
          )}/activate`,
          { method: "POST" }
        );

        setProfilePatch((p) => ({
          ...p,
          isActive: true,
          status: "ACTIVE",
          profile: {
            ...(sellerData.profile || {}),
            ...(p.profile || {}),
            serviceIsActive: true,
            status: "ACTIVE",
          },
        }));
      }

      broadcastProfileUpdated(sdSlug || slug);
    } catch (e) {
      const msg = humanizeActivateError(e);
      alert(msg);
      setActivationError(msg);
    } finally {
      setActivationBusy(false);
    }
  }

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
            Pentru a-ți publica magazinul, completează pașii de onboarding.
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
          {isOwner && !ownerChecks.loading && (
            <OwnerWarningBanner
              missingProfile={missingProfile}
              missingBilling={ownerChecks.missingBilling}
              noSub={ownerChecks.hasActiveSub === false}
            />
          )}

          {/* ActivationHintBanner a fost scos */}

          <div className={styles.cover}>
            {coverUrl ? (
              <img
                src={coverUrl}
                className={styles.coverImg}
                alt="Copertă"
                loading="lazy"
                decoding="async"
                onError={(e) => onImgError(e, 1200, 360, "Cover")}
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
            <div className={styles.headerRow}>
              <div className={styles.avatarWrap}>
                {avatarUrl ? (
                  <img
                    src={avatarUrl}
                    className={styles.avatar}
                    alt="Profil"
                    loading="lazy"
                    decoding="async"
                    onError={(e) => onImgError(e, 160, 160, "Profil")}
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
                      onClick={() => avatarInputRef.current?.click()}
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
                          trackCTA("Copy profile link");
                          setCopied(true);
                          setTimeout(() => setCopied(false), 1500);
                        } catch {
                          const ta = document.createElement("textarea");
                          ta.value = url;
                          document.body.appendChild(ta);
                          ta.select();
                          try {
                            document.execCommand("copy");
                            trackCTA("Copy profile link");
                            setCopied(true);
                            setTimeout(() => setCopied(false), 1500);
                          } catch {
                            /* noop */
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

              <div
                className={styles.actions}
                style={{ display: "flex", flexDirection: "column", gap: 4 }}
              >
                <div
                  style={{
                    display: "flex",
                    gap: 8,
                    alignItems: "center",
                    justifyContent: "flex-end",
                  }}
                >
                  <div className={styles.followersBadge}>
                    {followersCount} urmăritor
                    {followersCount === 1 ? "" : "i"}
                  </div>

                  {isOwner ? (
                    <>
                      <button
                        className={styles.followBtn}
                        onClick={handleAddProduct}
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

                      <button
                        className={styles.followBtn}
                        type="button"
                        onClick={handleToggleActive}
                        disabled={
                          activationBusy || ownerChecks.loading || !serviceId
                        }
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 6,
                        }}
                        title={
                          serviceIsActive
                            ? "Dezactivează magazinul (nu mai apare în căutări)"
                            : "Activează magazinul (va apărea în căutări)"
                        }
                      >
                        {activationBusy
                          ? serviceIsActive
                            ? "Se dezactivează…"
                            : "Se activează…"
                          : serviceIsActive
                          ? "Dezactivează magazin"
                          : "Activează magazin"}
                      </button>
                    </>
                  ) : (
                    <>
                      {isUser && (
                        <button
                          className={styles.followBtn}
                          type="button"
                          onClick={handleContactVendor}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 6,
                            marginRight: 8,
                          }}
                        >
                          <MessageSquare size={16} />
                          Trimite mesaj
                        </button>
                      )}

                      <button
                        className={`${styles.followBtn} ${
                          following ? styles.followBtnActive : ""
                        }`}
                        onClick={toggleFollow}
                        type="button"
                        disabled={followLoading}
                      >
                        {followLoading
                          ? "Se actualizează..."
                          : following
                          ? "Nu mai urmări"
                          : "Urmărește"}
                      </button>
                    </>
                  )}
                </div>

                {isOwner && activationError && (
                  <div
                    style={{
                      fontSize: 12,
                      color: "#b91c1c",
                      textAlign: "right",
                      maxWidth: 360,
                      marginLeft: "auto",
                    }}
                  >
                    {activationError}
                  </div>
                )}
              </div>
            </div>

            <hr className={styles.hr} />

            <TabsNav
              items={tabs}
              activeKey={activeTab}
              onJump={onJump}
            />

            {/* Despre – doar dacă showAboutSection e true */}
            {showAboutSection && (
              <section
                id="despre"
                ref={aboutRef}
                data-tab-key="despre"
                className={`${styles.section} sectionAnchorPad`}
              >
                <AboutSection
                  aboutText={aboutText}
                  canEdit={isOwner}
                  editAbout={editAbout}
                  aboutDraft={aboutDraft}
                  onToggleEditAbout={handleToggleEditAbout}
                  onChangeAbout={handleChangeAbout}
                  onSaveAbout={handleSaveAbout}
                  savingAbout={savingAbout}
                />
              </section>
            )}

            <section
              id="informatii"
              ref={infoRef}
              data-tab-key="informatii"
              className={`${styles.section} sectionAnchorPad`}
            >
              <InfoSection
                tags={tags}
                city={niceCity}
                country={country}
                address={address}
                publicEmail={publicEmail}
                phone={phone}
                website={website}
                leadTimes={leadTimes}
                prettyDelivery={prettyDelivery}
                editInfo={editInfo}
                savingInfo={savingInfo}
                infoErr={infoErr}
                infoDraft={infoDraft}
                onChangeInfoDraft={onChangeInfoDraft}
                countySuggestions={countySuggestions}
                countiesLoading={countiesLoading}
                countiesErr={countiesErr}
                onCountiesChange={onCountiesChange}
                canEdit={isOwner}
                onToggleEditInfo={() => setEditInfo((x) => !x)}
                onSaveInfo={saveInfoNow}
                onTrackCTA={trackCTA}
              />
            </section>

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
                onAddFirstProduct={handleAddProduct}
                productsCacheT={productsCacheT}
                onEditProduct={openEditProduct}
                categories={categories}
              />
            </section>

            <section
              id="recenzii"
              ref={reviewsRef}
              data-tab-key="recenzii"
              className={`${styles.section} sectionAnchorPad`}
            >
              <Suspense fallback={<div>Se încarcă recenziile…</div>}>
                <ReviewsSection
                  rating={revState.stats?.avg ?? rating}
                  reviews={revState.items}
                  totalCount={revState.total}
                  stats={revState.stats}
                  canWrite={viewMode !== "vendor" && !!me}
                  isVendorView={viewMode === "vendor"}
                  me={me}
                  onSubmit={onSubmitUserReview}
                  onHelpful={onHelpful}
                  onReport={onReport}
                  onChangeQuery={changeQueryFromUI}
                  onVendorReply={async (reviewId, text) => {
                    await api(
                      `/api/vendor/store-reviews/${reviewId}/reply`,
                      {
                        method: "POST",
                        body: { text },
                      }
                    );
                    fetchReviews(query).catch(() => {});
                  }}
                  onUserDeleteReview={onDeleteUserReview}
                  onVendorDeleteReply={async (reviewId) => {
                    await api(
                      `/api/vendor/store-reviews/${reviewId}/reply`,
                      {
                        method: "DELETE",
                      }
                    );
                    fetchReviews(query).catch(() => {});
                  }}
                />
              </Suspense>
            </section>
          </div>
        </div>
      )}

      <Suspense fallback={null}>
        <VendorGateModal
          open={gateState.open}
          onClose={() =>
            setGateState((s) => ({
              ...s,
              open: false,
            }))
          }
          gateLoading={gateState.loading}
          gateErr={gateState.error}
          gateDocs={gateState.docs}
          gateChecks={gateState.checks}
          setGateChecks={(updater) =>
            setGateState((s) => ({
              ...s,
              checks:
                typeof updater === "function"
                  ? updater(s.checks)
                  : updater,
            }))
          }
          onAccept={handleAcceptGate}
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
      </Suspense>
    </>
  );
}
