import { useEffect, useMemo, useState } from "react";
import { api } from "../../../../lib/api";
import { humanizeActivateError } from "../utils/activationErrors";

export default function useStoreOwnerData({
  isOwner,
  sellerData,
  slug,
  needsOnboarding,
  navigate,
  setProfilePatch,
  setLocalCacheT,
  broadcastProfileUpdated,
}) {
  const [ownerStores, setOwnerStores] = useState([]);
  const [ownerStoresLoading, setOwnerStoresLoading] = useState(false);
  const [ownerChecks, setOwnerChecks] = useState({
    hasActiveSub: null,
    missingBilling: [],
    loading: false,
  });
  const [prodLimits, setProdLimits] = useState(null);
  const [activationBusy, setActivationBusy] = useState(false);
  const [activationError, setActivationError] = useState("");

  const storeSlug = sellerData?.slug || sellerData?.profile?.slug || slug;

  const serviceId =
    sellerData?.serviceId ||
    sellerData?.service?.id ||
    sellerData?.profile?.serviceId ||
    sellerData?.id ||
    sellerData?._id ||
    null;

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

    if (!String(hasName || "").trim()) m.push("Nume brand");
    if (!String(hasSlug || "").trim()) m.push("Slug");
    if (!hasImage) m.push("Logo/Copertă");

    return m;
  }, [sellerData]);

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

  useEffect(() => {
    if (!isOwner || !storeSlug) return;

    let alive = true;

    (async () => {
      try {
        const data = await api(
          `/api/vendors/store/${encodeURIComponent(storeSlug)}/products/limits`,
          { method: "GET" }
        );

        if (alive) setProdLimits(data);
      } catch {
        if (alive) setProdLimits(null);
      }
    })();

    return () => {
      alive = false;
    };
  }, [isOwner, storeSlug]);

  useEffect(() => {
    if (!isOwner) return;

    let alive = true;

    (async () => {
      try {
        setOwnerStoresLoading(true);

        const res = await api("/api/vendors/me/services?includeProfile=1", {
          method: "GET",
        });

        if (!alive) return;

        const items = Array.isArray(res?.items) ? res.items : [];

        const stores = items
          .filter((s) => (s?.type?.code || s?.typeCode) === "products")
          .map((s) => ({
            id: s.id,
            slug: s?.profile?.slug || "",
            label:
              s?.profile?.displayName ||
              s?.title ||
              s?.type?.name ||
              s?.typeName ||
              "Magazin fără nume",
            isActive: !!(s?.isActive && s?.status === "ACTIVE"),
            status: s?.status || "DRAFT",
          }))
          .filter((s) => !!s.slug || !!s.id);

        setOwnerStores(stores);
      } catch {
        if (alive) setOwnerStores([]);
      } finally {
        if (alive) setOwnerStoresLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [isOwner]);

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

          hasActiveSub = !!sub?.ok || sub?.kind === "free_basic";
        } catch {
          hasActiveSub = false;
        }

const missingBilling = [];

        if (!alive) return;

        setOwnerChecks({
          hasActiveSub,
          missingBilling,
          loading: false,
        });
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

  async function handleToggleActive(onJumpToInfo) {
  if (!isOwner || !serviceId || activationBusy) return;

  if (!serviceIsActive) {
    const blocking = [];

    if (missingProfile.length) {
      blocking.push("Profil magazin: " + missingProfile.join(", "));
    }

    if (blocking.length) {
      alert(
        `Pentru a activa magazinul, trebuie să completezi:\n- ${blocking.join(
          "\n- "
        )}\n\nPoți completa din onboarding, tab-ul Profil.`
      );

      onJumpToInfo?.();
      return;
    }
  }

  try {
    setActivationBusy(true);
    setActivationError("");

    const endpoint = serviceIsActive ? "deactivate" : "activate";

    await api(
      `/api/vendors/me/services/${encodeURIComponent(serviceId)}/${endpoint}`,
      { method: "POST" }
    );

    const nextActive = !serviceIsActive;

    setProfilePatch((p) => ({
      ...p,
      isActive: nextActive,
      status: nextActive ? "ACTIVE" : "INACTIVE",
      profile: {
        ...(sellerData?.profile || {}),
        ...(p.profile || {}),
        serviceIsActive: nextActive,
        status: nextActive ? "ACTIVE" : "INACTIVE",
      },
    }));

    setLocalCacheT(Date.now());
    broadcastProfileUpdated(storeSlug || slug);
  } catch (e) {
    const msg = humanizeActivateError(e);

    alert(msg);
    setActivationError(msg);
  } finally {
    setActivationBusy(false);
  }
}

  async function handleCreateNewStoreFromProfile() {
    try {
      const r = await api("/api/vendors/me/services/products/new", {
        method: "POST",
      });

      const newId = r?.item?.id || null;

      if (!newId) {
        throw new Error("Serviciul nou nu a fost creat corect.");
      }

      setLocalCacheT(Date.now());

      navigate(
        `/onboarding/details?serviceId=${encodeURIComponent(
          newId
        )}&tab=profil&solo=1`
      );
    } catch (e) {
      console.error("create new store error", e);
      alert(e?.message || "Nu am putut crea un magazin nou.");
    }
  }

  function handleGoToOwnerStore(store) {
    if (!store?.slug) return;

    navigate(`/magazin/${encodeURIComponent(store.slug)}`);
  }

  const hasData = !!(
  sellerData?.slug ||
  sellerData?.profile?.slug ||
  sellerData?.serviceId ||
  sellerData?.vendorId
);
  const hasAnyStoreOrService =
    Array.isArray(ownerStores) && ownerStores.length > 0;

  const shouldShowOnboardingGate =
    isOwner &&
    needsOnboarding &&
    !hasData &&
    !ownerStoresLoading &&
    !hasAnyStoreOrService;

  return {
    ownerStores,
    ownerStoresLoading,
    ownerChecks,
    prodLimits,
    canAddProduct: prodLimits?.canAdd ?? true,
    missingProfile,
    activationBusy,
    activationError,
    serviceIsActive,
    shouldShowOnboardingGate,
    handleToggleActive,
    handleCreateNewStoreFromProfile,
    handleGoToOwnerStore,
  };
}