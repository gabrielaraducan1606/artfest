import { useMemo, useRef, useState } from "react";
import { api } from "../../../../lib/api";
import { withCache, resolveFileUrl } from "./useProfilMagazin";

function broadcastProfileUpdated(serviceIdOrSlug) {
  try {
    window.dispatchEvent(
      new CustomEvent("vendor:profileUpdated", {
        detail: { idOrSlug: serviceIdOrSlug },
      })
    );
  } catch {
    // noop
  }

  try {
    localStorage.setItem("vendorProfileUpdatedAt", String(Date.now()));
  } catch {
    // noop
  }
}

export default function useStoreMediaUpload({
  sellerData,
  slug,
  cacheT,
  setProfilePatch,
}) {
  const [localCacheT, setLocalCacheT] = useState(Date.now());
  const avatarInputRef = useRef(null);
  const coverInputRef = useRef(null);

  const storeSlug = sellerData?.slug || sellerData?.profile?.slug || slug;

  const serviceId =
    sellerData?.serviceId ||
    sellerData?.service?.id ||
    sellerData?.profile?.serviceId ||
    sellerData?.id ||
    sellerData?._id ||
    null;

  const coverRaw =
    sellerData?.coverImageUrl ||
    sellerData?.coverUrl ||
    sellerData?.profile?.coverUrl;

  const avatarRaw =
    sellerData?.profileImageUrl ||
    sellerData?.logoUrl ||
    sellerData?.profile?.logoUrl;

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

  async function saveStorePatch(patch) {
    if (!serviceId) {
      throw new Error("ServiceId lipsă la salvare.");
    }

    const data = await api(
      `/api/vendors/vendor-services/${encodeURIComponent(serviceId)}/profile`,
      {
        method: "PUT",
        body: { ...patch, mirrorVendor: true },
      }
    );

    return data?.profile || {};
  }

  async function uploadImage(file) {
    const fd = new FormData();
    fd.append("file", file);

    const up = await fetch("/api/upload", {
      method: "POST",
      body: fd,
    });

    if (!up.ok) {
      throw new Error("Upload eșuat");
    }

    const data = await up.json();

    if (!data?.url) {
      throw new Error("Upload eșuat: lipsește URL-ul imaginii.");
    }

    return data.url;
  }

  async function onAvatarChange(e) {
    const f = e.target.files?.[0];
    if (!f) return;

    try {
      const url = await uploadImage(f);

      await saveStorePatch({ logoUrl: url });

      setProfilePatch((p) => ({
        ...p,
        profileImageUrl: url,
        logoUrl: url,
        profile: {
          ...(sellerData?.profile || {}),
          ...(p.profile || {}),
          logoUrl: url,
        },
      }));

      setLocalCacheT(Date.now());
      broadcastProfileUpdated(serviceId || storeSlug);
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
      const url = await uploadImage(f);

      await saveStorePatch({ coverUrl: url });

      setProfilePatch((p) => ({
        ...p,
        coverImageUrl: url,
        coverUrl: url,
        profile: {
          ...(sellerData?.profile || {}),
          ...(p.profile || {}),
          coverUrl: url,
        },
      }));

      setLocalCacheT(Date.now());
      broadcastProfileUpdated(serviceId || storeSlug);
    } catch (er) {
      alert(er?.message || "Nu am putut salva coperta");
    } finally {
      e.target.value = "";
    }
  }

  return {
    coverUrl,
    avatarUrl,
    localCacheT,
    setLocalCacheT,
    avatarInputRef,
    coverInputRef,
    saveStorePatch,
    onAvatarChange,
    onCoverChange,
    broadcastProfileUpdated,
  };
}