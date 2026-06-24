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
  } catch {""}

  try {
    localStorage.setItem("vendorProfileUpdatedAt", String(Date.now()));
  } catch {""}
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
  const sd = storeSlug;
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
  profile: {
    ...(sellerData?.profile || {}),
    ...(p.profile || {}),
    logoUrl: url,
  },
}));

      setLocalCacheT(Date.now());
      broadcastProfileUpdated(storeSlug);
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
  profile: {
    ...(sellerData?.profile || {}),
    ...(p.profile || {}),
    coverUrl: url,
  },
}));

      setLocalCacheT(Date.now());
      broadcastProfileUpdated(storeSlug);
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