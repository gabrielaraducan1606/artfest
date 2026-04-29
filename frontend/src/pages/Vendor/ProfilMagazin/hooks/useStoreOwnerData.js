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
          if (need("companyName")) missingBilling.push("Denumire entitate");
          if (need("cui")) missingBilling.push("CUI");
          if (need("regCom")) missingBilling.push("Nr. Reg. Com.");
          if (need("address")) missingBilling.push("Adresă facturare");
          if (need("email")) missingBilling.push("Email facturare");
          if (need("contactPerson")) missingBilling.push("Persoană contact");
          if (need("phone")) missingBilling.push("Telefon");
          if (need("vatStatus")) missingBilling.push("Status TVA");

          if (v?.vatStatus === "payer" && need("vatRate")) {
            missingBilling.push("Cotă TVA");
          }

          if (!v?.vatResponsibilityConfirmed) {
            missingBilling.push("Confirmarea responsabilității TVA");
          }
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

  async function handleToggleActive(onJumpToInfo) {
    if (!isOwner || !serviceId || activationBusy) return;

    if (!serviceIsActive) {
      if (ownerChecks.hasActiveSub === false) {
        alert(
          "Pentru a activa magazinul, ai nevoie de un abonament activ. Vei fi dus la pagina de abonament."
        );
        navigate("/onboarding/details?tab=plata&solo=1");
        return;
      }

      const blocking = [];

      if (missingProfile.length) {
        blocking.push("Profil magazin: " + missingProfile.join(", "));
      }

      if (ownerChecks.missingBilling?.length) {
        blocking.push("Date facturare: " + ownerChecks.missingBilling.join(", "));
      }

      if (blocking.length) {
        alert(
          `Pentru a activa magazinul, trebuie să completezi:\n- ${blocking.join(
            "\n- "
          )}\n\nPoți completa din secțiunea „Informații” și din onboarding (tab-urile Profil / Facturare).`
        );
        onJumpToInfo?.();
        return;
      }
    }

    try {
      setActivationBusy(true);
      setActivationError("");

      if (serviceIsActive) {
        await api(
          `/api/vendors/me/services/${encodeURIComponent(serviceId)}/deactivate`,
          { method: "POST" }
        );

        setProfilePatch((p) => ({
          ...p,
          isActive: false,
          status: "INACTIVE",
          profile: {
            ...(sellerData?.profile || {}),
            ...(p.profile || {}),
            serviceIsActive: false,
            status: "INACTIVE",
          },
        }));
      } else {
        await api(
          `/api/vendors/me/services/${encodeURIComponent(serviceId)}/activate`,
          { method: "POST" }
        );

        setProfilePatch((p) => ({
          ...p,
          isActive: true,
          status: "ACTIVE",
          profile: {
            ...(sellerData?.profile || {}),
            ...(p.profile || {}),
            serviceIsActive: true,
            status: "ACTIVE",
          },
        }));
      }

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

  const hasData = !!(sellerData?.slug || sellerData?.profile?.slug || slug);
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