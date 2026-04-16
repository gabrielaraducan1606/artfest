import React, { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
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
import OwnerWarningBanner from "./components/OwnerWarningBanner";
import StoreHero from "./components/StoreHero";
import StoreSections from "./components/StoreSections";
import StoreModals from "./modals/StoreModals";

import { api } from "../../../lib/api";
import { buildProductPayload } from "./utils/productPayload";
import { extractCode, extractHttpStatus } from "./utils/activationErrors";

export default function ProfilMagazinPage() {
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
    openNewProduct,
  } = useProfilMagazin(slug, { me });

  const [profilePatch, setProfilePatch] = useState({});
  const [editingOverride, setEditingOverride] = useState(null);

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
    address,
    tags = [],
    publicEmail,
    phone,
    delivery = [],
    website,
    leadTimes,
    slug: sdSlug,
    profile,
  } = sellerData || {};

  // IMPORTANT: calcul mai complet pentru ID-uri
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

  const { trackCTA, trackMESSAGE } = useStoreTracking(vendorId);

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
            if (c.slug && c.label) {
              map[c.slug] = c.label;
            }
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

  const prettyDelivery =
    Array.isArray(delivery) && delivery.length
      ? (delivery[0] === "counties" ? delivery.slice(1) : delivery).join(", ")
      : "";

  const seoPreloads = coverUrl
    ? [{ href: coverUrl, as: "image", useInDom: true }]
    : [];

  const [gateState, setGateState] = useState({
    open: false,
    loading: false,
    error: "",
    docs: null,
    checks: {
      declaration: false,
      vendorTermsRead: false,
    },
  });

  const storeSlug = sellerData?.slug || sellerData?.profile?.slug || slug;

  async function handleAddProduct() {
    if (!isOwner) return;

    if (owner.prodLimits?.canAdd === false) {
      alert(
        `Ai atins limita de produse (${owner.prodLimits.currentProducts}/${owner.prodLimits.maxProducts}). Upgradează planul ca să adaugi mai multe.`
      );
      navigate("/onboarding/details?tab=plata&solo=1");
      return;
    }

    const hasProducts = Array.isArray(products) && products.length > 0;
    if (hasProducts) {
      openNewProduct();
      return;
    }

    try {
      setGateState((s) => ({
        ...s,
        loading: true,
        error: "",
      }));

      const resp = await api("/api/vendor/product-declaration/status", {
        method: "GET",
      });

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
      });

      setEditingOverride(full);
      setProdModalOpen(true);
    } catch (er) {
      console.error("Nu am putut încărca produsul pentru editare:", er);
      alert("Nu am putut încărca produsul pentru editare.");
    }
  }

  function closeProductModal() {
    setProdModalOpen(false);
    setEditingOverride(null);
  }

  async function handleSaveProduct(e) {
    e?.preventDefault?.();

    try {
      const payload = buildProductPayload(prodForm);

      let saved;
      const isEdit =
        !!editingOverride && (editingOverride.id || editingOverride._id);

      if (isEdit) {
        const id = editingOverride.id || editingOverride._id;

        saved = await api(
          `/api/vendors/products/${encodeURIComponent(id)}`,
          {
            method: "PUT",
            body: payload,
          }
        );
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
              detail: { product: saved },
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
        navigate("/onboarding/details?tab=plata&solo=1");
        return;
      }

      alert(er?.message || "Nu am putut salva produsul.");
    }
  }

  const hasData = !!(sellerData?.slug || sellerData?.profile?.slug || slug);

  if (!hasData && loading) {
    return <ProfilMagazinSkeleton />;
  }

  if (owner.shouldShowOnboardingGate) {
    return (
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
    );
  }

  if (err || !_sellerData) {
    return (
      <div style={{ padding: "2rem" }}>
        {err || "Magazinul nu a fost găsit."}
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

      <div className={styles.wrapper}>
        {isOwner && !owner.ownerChecks.loading && (
          <OwnerWarningBanner
            missingProfile={owner.missingProfile}
            missingBilling={owner.ownerChecks.missingBilling}
            noSub={owner.ownerChecks.hasActiveSub === false}
          />
        )}

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
          serviceIsActive={owner.serviceIsActive}
          activationBusy={owner.activationBusy}
          ownerChecksLoading={owner.ownerChecks.loading}
          serviceId={serviceId}
          handleToggleActive={() =>
            owner.handleToggleActive(() => tabs.onJump("informatii"))
          }
          followersCount={follow.followersCount}
          canAddProduct={owner.canAddProduct}
          prodLimits={owner.prodLimits}
          handleAddProduct={handleAddProduct}
          handleContactVendor={follow.handleContactVendor}
          following={follow.following}
          followLoading={follow.followLoading}
          toggleFollow={follow.toggleFollow}
          activationError={owner.activationError}
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
            setEditInfo={setEditInfo}
            saveInfoNow={saveInfoNow}
            trackCTA={trackCTA}
            products={products}
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