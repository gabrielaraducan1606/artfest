import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { useEffect, useMemo, useRef, useState } from "react";
import styles from "./ProfilMagazin.module.css";
import { SEO } from "../../../components/Seo/SeoProvider.jsx";
import { useAuth } from "../../Auth/Context/context.js";

import useProfilMagazin from "./hooks/useProfilMagazin";
import useStoreTracking from "./hooks/useStoreTracking";
import useStoreOwnerData from "./hooks/useStoreOwnerData";
import useStoreReviews from "./hooks/useStoreReviews";
import useStoreFollow from "./hooks/useStoreFollow";
import useStoreMediaUpload from "./hooks/useStoreMediaUpload";
import useStoreTabs from "./hooks/useStoreTabs";

import ProfilMagazinSkeleton from "./components/ProfilMagazinSkeleton";
import StoreHero from "./components/StoreHero";
import StoreSections from "./components/StoreSections";
import StoreModals from "./modals/StoreModals";

import { api } from "../../../lib/api";
import { buildProductPayload } from "./utils/productPayload";
import { extractCode, extractHttpStatus } from "./utils/activationErrors";

export default function ProfilMagazinPage() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const onboardingProducts = searchParams.get("onboarding") === "products";
  const [showAddProductHint, setShowAddProductHint] = useState(false);
const heroActionsRef = useRef(null);
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

    editInfo,
    setEditInfo,
    savingInfo,
    infoErr,
    infoDraft,
    onChangeInfoDraft,
    saveInfoNow,
    prodModalOpen,
    setProdModalOpen,
    savingProd,
    editingProduct,
    prodForm,
    setProdForm,
    openNewProduct,
  } = useProfilMagazin(slug, { me });

  useEffect(() => {
    if (!onboardingProducts) return;
    if (!isOwner) return;
    if (loading) return;

    const hasProducts = Array.isArray(products) && products.length > 0;
    if (hasProducts) return;

    setShowAddProductHint(true);
  }, [onboardingProducts, isOwner, loading, products]);

  useEffect(() => {
  if (!showAddProductHint) return;

  const t = setTimeout(() => {
    heroActionsRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  }, 350);

  return () => clearTimeout(t);
}, [showAddProductHint]);

  function dismissAddProductHint() {
    setShowAddProductHint(false);

    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("onboarding");
        return next;
      },
      { replace: true }
    );
  }

  const [profilePatch, setProfilePatch] = useState({});
  const [editingOverride, setEditingOverride] = useState(null);
  const saveProductLockRef = useRef(false);

  const sellerData = useMemo(
    () => ({ ...(_sellerData || {}), ...profilePatch }),
    [_sellerData, profilePatch]
  );

  const {
    coverUrl,
    avatarUrl,
    setLocalCacheT,
    avatarInputRef,
    coverInputRef,
    saveStorePatch,
    onAvatarChange,
    onCoverChange,
    broadcastProfileUpdated,
  } = useStoreMediaUpload({
    sellerData,
    slug,
    cacheT,
    setProfilePatch,
  });

  const {
    shopName,
    brandStory,
    city,
    citySlug: rawCitySlug,
    country,
    tags = [],
    website,
    slug: sdSlug,
    profile,
  } = sellerData || {};

  const storeSlug = sellerData?.slug || sellerData?.profile?.slug || slug;

  const vendorId =
    sellerData?.vendorId ||
    sellerData?.profile?.vendorId ||
    sellerData?.vendor?.id ||
    sellerData?.vendor?._id ||
    sellerData?.service?.vendorId ||
    sellerData?.service?.vendor?.id ||
    sellerData?.service?.vendor?._id ||
    _sellerData?.vendorId ||
    _sellerData?.profile?.vendorId ||
    _sellerData?.vendor?.id ||
    _sellerData?.vendor?._id ||
    _sellerData?.service?.vendorId ||
    _sellerData?.service?.vendor?.id ||
    _sellerData?.service?.vendor?._id ||
    null;

  const serviceId =
    sellerData?.serviceId ||
    sellerData?.service?.id ||
    sellerData?.service?._id ||
    sellerData?.id ||
    sellerData?._id ||
    _sellerData?.serviceId ||
    _sellerData?.service?.id ||
    _sellerData?.service?._id ||
    _sellerData?.id ||
    _sellerData?._id ||
    null;

  const currentShopId = serviceId || storeSlug || sdSlug || slug;

  const { trackCTA, trackMESSAGE } = useStoreTracking({
    vendorId,
    serviceId,
  });

  const [ambassador, setAmbassador] = useState(null);

  useEffect(() => {
    if (!isOwner) return;

    api("/api/ambassadors/me")
      .then(setAmbassador)
      .catch(() => setAmbassador(null));
  }, [isOwner]);

  const owner = useStoreOwnerData({
    isOwner,
    sellerData,
    slug,
    needsOnboarding,
    navigate,
    setProfilePatch,
    setLocalCacheT,
    broadcastProfileUpdated,
  });

  const reviews = useStoreReviews({
    slug,
    storeSlug: sdSlug || slug,
    rating,
    serviceId,
    vendorId,
  });

  const follow = useStoreFollow({
    serviceId,
    vendorId,
    slug,
    sdSlug,
    me,
    navigate,
    trackCTA,
    trackMESSAGE,
  });

  const aboutText = (brandStory ?? sellerData?.about ?? "").trim();
  const showAboutSection = isOwner || !!aboutText;

  const [editAbout, setEditAbout] = useState(false);
  const [aboutDraft, setAboutDraft] = useState(aboutText);
  const [savingAbout, setSavingAbout] = useState(false);

  useEffect(() => {
    setAboutDraft(aboutText);
  }, [aboutText]);

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
      setLocalCacheT(Date.now());
      broadcastProfileUpdated(sdSlug || slug);
    } catch (er) {
      alert(er?.message || "Nu am putut salva descrierea magazinului.");
    } finally {
      setSavingAbout(false);
    }
  }

 function handleVendorMessage() {
  if (isOwner) {
    return;
  }

  if (!vendorId) {
    alert("Nu am găsit vendorul pentru acest magazin.");
    return;
  }

  if (!me) {
    const redir = encodeURIComponent(
      window.location.pathname +
        window.location.search
    );

    navigate(
      `/autentificare?redirect=${redir}`
    );

    return;
  }

  trackCTA?.("Request quote from store");

  window.dispatchEvent(
    new CustomEvent(
      "artfest:quote-request",
      {
        detail: {
          productId: null,
          productTitle: null,

          vendorId,
          vendorName:
            shopName ||
            sellerData?.profile?.displayName ||
            sellerData?.displayName ||
            "Magazin Artfest",

          image:
            avatarUrl ||
            coverUrl ||
            null,

          quoteSchema: [],

          fromStore: true,
          storeSlug:
            sdSlug ||
            slug ||
            null,

          storeName:
            shopName ||
            null,
        },
      }
    )
  );
}
  const tabs = useStoreTabs({
    showAboutSection,
    ensureReviewsLoaded: reviews.ensureReviewsLoaded,
  });

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
            if (c.slug && c.label) map[c.slug] = c.label;
          }
        }

        if (alive) setCityLabelMap(map);
      } catch {
        // noop
      }
    })();

    return () => {
      alive = false;
    };
  }, []);

  const citySlug =
    profile?.citySlug ||
    rawCitySlug ||
    sellerData?.service?.citySlug ||
    sellerData?.vendor?.citySlug ||
    null;

  const niceCity =
    (citySlug && cityLabelMap && cityLabelMap[citySlug]) ||
    profile?.city ||
    sellerData?.service?.city ||
    sellerData?.vendor?.city ||
    city ||
    "";

  const shortText = (
    sellerData?.shortDescription ??
    profile?.shortDescription ??
    profile?.tagline ??
    ""
  ).trim();

  const origin =
    typeof window !== "undefined" && window.location?.origin
      ? window.location.origin
      : "https://artfest.ro";

  const pageUrl = `${origin}/magazin/${sdSlug || ""}`;
  const shareImage =
    coverUrl || avatarUrl || `${origin}/img/share-fallback.jpg`;


  const seoPreloads = coverUrl
    ? [{ href: coverUrl, as: "image", useInDom: true }]
    : [];
const gateServiceId =
  serviceId ||
  sellerData?.service?.id ||
  sellerData?.serviceId ||
  sellerData?.id ||
  _sellerData?.service?.id ||
  _sellerData?.serviceId ||
  _sellerData?.id ||
  null;
const [gateState, setGateState] = useState({
  open: false,
  loading: false,
  error: "",
  docs: null,
  serviceId: null,
  profile: null,
  sellerData: null,
});

  async function handleAddProduct() {
    dismissAddProductHint();

    if (!isOwner) return;

    if (owner.prodLimits?.canAdd === false) {
      alert(
        `Ai atins limita de produse (${owner.prodLimits.currentProducts}/${owner.prodLimits.maxProducts}). Upgradează planul ca să adaugi mai multe.`
      );
      navigate("/setari?tab=subscription");
      return;
    }

    const hasProducts = Array.isArray(products) && products.length > 0;

    if (hasProducts) {
      openNewProduct();
      return;
    }

    try {
      setGateState((s) => ({ ...s, loading: true, error: "" }));

      const resp = await api("/api/vendor/product-declaration/status", {
        method: "GET",
      });

      if (resp?.accepted) {
  setGateState((s) => ({
    ...s,
    loading: false,
    open: false,
  }));

  openNewProduct();
  return;
}

      setGateState({
  open: true,
  loading: false,
  error: "",
  docs: {
    products_addendum: {
      doc_key: "PRODUCTS_ADDENDUM",
      url: resp?.productsAddendumUrl || "/anexa-produse",
      version: resp?.productsAddendumVersion || null,
    },
    returns_policy_ack: {
      doc_key: "RETURNS_POLICY_ACK",
      url: resp?.returnsPolicyUrl || "/politica-retur",
      version: resp?.returnsPolicyVersion || null,
    },
    shipping_addendum: {
      doc_key: "SHIPPING_ADDENDUM",
      url: resp?.shippingAddendumUrl || "/anexa-expediere",
      version: resp?.shippingAddendumVersion || null,
    },
    product_declaration: {
      doc_key: "PRODUCT_DECLARATION",
      version: resp?.version || "1.0.0",
    },
  },
 serviceId: gateServiceId,
  profile,
  sellerData,
});
    } catch (e) {
      console.error("product-declaration/status error", e);

      setGateState((s) => ({
        ...s,
        loading: false,
        error:
          e?.message ||
          "Nu am putut verifica declarația produselor. Poți continua să adaugi produsul.",
      }));

      openNewProduct();
    }
  }
async function handleAcceptGate() {
  setGateState((s) => ({
    ...s,
    open: false,
    loading: false,
    error: "",
  }));

  openNewProduct();
}

  async function openEditProduct(p) {
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
        orderMode: full.orderMode || "READY_TO_BUY",

optionsSchema: Array.isArray(full.optionsSchema)
  ? full.optionsSchema
  : [],

customSchema: Array.isArray(full.customSchema)
  ? full.customSchema
  : [],

quoteSchema: Array.isArray(full.quoteSchema)
  ? full.quoteSchema
  : [],
      });

      setEditingOverride(full);
      setProdModalOpen(true);
    } catch (er) {
      console.error("Nu am putut încărca produsul pentru editare:", er);
      alert("Nu am putut încărca produsul pentru editare.");
    }
  }

  function closeProductModal() {
    saveProductLockRef.current = false;
    setProdModalOpen(false);
    setEditingOverride(null);
  }

  async function handleSaveProduct(e) {
    e?.preventDefault?.();

    if (saveProductLockRef.current) return;
    saveProductLockRef.current = true;

    try {
      const payload = buildProductPayload(prodForm);

      let saved;
      const isEdit =
        !!editingOverride && (editingOverride.id || editingOverride._id);

      if (isEdit) {
        const id = editingOverride.id || editingOverride._id;

        saved = await api(`/api/vendors/products/${encodeURIComponent(id)}`, {
          method: "PUT",
          body: payload,
        });
      } else {
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

      try {
        window.dispatchEvent(
          new CustomEvent(
            isEdit ? "vendor:productUpdated" : "vendor:productCreated",
            {
              detail: {
                product: saved,
                shopId: currentShopId,
                storeId: currentShopId,
                vendorStoreId: currentShopId,
              },
            }
          )
        );
      } catch {
        // noop
      }

      closeProductModal();
    } catch (er) {
      const status = extractHttpStatus(er);
      const code = extractCode(er);

      if (status === 402 || code === "upgrade_required") {
        alert(
          "Ai atins limita de produse pentru abonamentul curent. Upgradează planul ca să adaugi mai multe produse."
        );
       navigate("/setari?tab=subscription");
        return;
      }

      alert(er?.message || "Nu am putut salva produsul.");
    } finally {
      saveProductLockRef.current = false;
    }
  }

  const hasData = !!(
    _sellerData?.slug ||
    _sellerData?.profile?.slug ||
    _sellerData?.serviceId ||
    _sellerData?.vendorId
  );

  if (loading && !hasData) {
    return <ProfilMagazinSkeleton />;
  }

  if (owner.shouldShowOnboardingGate) {
    return (
      <div style={{ padding: "2rem" }}>
        <h2 style={{ marginBottom: 8 }}>Încă nu ai configurat magazinul</h2>

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
    );
  }

  if (!loading && !hasData && err) {
    return (
      <div style={{ padding: "2rem" }}>
        {err}

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
    );
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

      <div className={styles.wrapper}>
        <StoreHero
          isOwner={isOwner}
          isUser={isUser}
          shopName={shopName}
          shortText={shortText}
          origin={origin}
          sdSlug={sdSlug || slug}
          coverUrl={coverUrl}
          avatarUrl={avatarUrl}
          coverInputRef={coverInputRef}
          avatarInputRef={avatarInputRef}
          onCoverChange={onCoverChange}
          onAvatarChange={onAvatarChange}
          ownerStores={owner.ownerStores}
          ownerStoresLoading={owner.ownerStoresLoading}
          handleGoToOwnerStore={owner.handleGoToOwnerStore}
          handleCreateNewStoreFromProfile={owner.handleCreateNewStoreFromProfile}
          sellerType={sellerData?.sellerType}
          sellerTypeLabel={sellerData?.sellerTypeLabel}
          serviceIsActive={owner.serviceIsActive}
          activationBusy={owner.activationBusy}
          ownerChecksLoading={owner.ownerChecksLoading}
          handleToggleActive={owner.handleToggleActive}
          activationError={owner.activationError}
          serviceId={serviceId}
          followersCount={follow.followersCount}
          canAddProduct={owner.canAddProduct}
          prodLimits={owner.prodLimits}
          handleAddProduct={handleAddProduct}
          showAddProductHint={showAddProductHint}
heroActionsRef={heroActionsRef}
onDismissAddProductHint={dismissAddProductHint}
          handleContactVendor={
  handleVendorMessage
}
          ambassador={ambassador}
          following={follow.following}
          followLoading={follow.followLoading}
          toggleFollow={follow.toggleFollow}
          trackCTA={trackCTA}
        />

        <div className={styles.card}>
          <StoreSections
            tabs={tabs.tabs}
            activeTab={tabs.activeTab}
            onJump={tabs.onJump}
            showAboutSection={showAboutSection}
            aboutRef={tabs.aboutRef}
            infoRef={tabs.infoRef}
            productsRef={tabs.productsRef}
            reviewsRef={tabs.reviewsRef}
            aboutText={aboutText}
            isOwner={isOwner}
            editAbout={editAbout}
            aboutDraft={aboutDraft}
            onToggleEditAbout={() => setEditAbout((x) => !x)}
            onChangeAbout={setAboutDraft}
            onSaveAbout={handleSaveAbout}
            savingAbout={savingAbout}
            tags={tags}
            niceCity={niceCity}
            country={country}
            website={website}
            editInfo={editInfo}
            savingInfo={savingInfo}
            infoErr={infoErr}
            infoDraft={infoDraft}
            onChangeInfoDraft={onChangeInfoDraft}
            setEditInfo={setEditInfo}
            saveInfoNow={saveInfoNow}
            trackCTA={trackCTA}
            products={products}
            productsLoading={loading}
            shopId={currentShopId}
            serviceId={serviceId}
            viewMode={viewMode}
            favorites={favorites}
            navigate={navigate}
            handleAddProduct={handleAddProduct}
            productsCacheT={productsCacheT}
            openEditProduct={openEditProduct}
            categories={categories}
            rating={rating}
            revState={reviews.revState}
            me={me}
            changeQueryFromUI={reviews.changeQueryFromUI}
            onSubmitUserReview={reviews.onSubmitUserReview}
            onHelpful={reviews.onHelpful}
            onReport={reviews.onReport}
            onVendorReply={reviews.onVendorReply}
            onDeleteUserReview={reviews.onDeleteUserReview}
            onVendorDeleteReply={reviews.onVendorDeleteReply}
          />
        </div>
      </div>

      <StoreModals
        gateState={gateState}
        setGateState={setGateState}
        handleAcceptGate={handleAcceptGate}
        prodModalOpen={prodModalOpen}
        closeProductModal={closeProductModal}
        savingProd={savingProd}
        editingProduct={editingProduct}
        editingOverride={editingOverride}
        prodForm={prodForm}
        setProdForm={setProdForm}
        categories={categories}
        handleSaveProduct={handleSaveProduct}
        storeSlug={storeSlug}
      />
    </>
  );
}