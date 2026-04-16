import { useCallback, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

const MAX_DIMENSION = 1024;
const JPEG_QUALITY = 0.82;

async function compressImageForSearch(file) {
  if (!file?.type?.startsWith("image/")) return file;

  try {
    const bitmap = await createImageBitmap(file);

    const longestSide = Math.max(bitmap.width, bitmap.height);
    const scale = longestSide > MAX_DIMENSION ? MAX_DIMENSION / longestSide : 1;

    const targetWidth = Math.max(1, Math.round(bitmap.width * scale));
    const targetHeight = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = targetWidth;
    canvas.height = targetHeight;

    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return file;

    ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight);

    const blob = await new Promise((resolve) => {
      canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY);
    });

    if (!blob) return file;

    return new File([blob], "image-search.jpg", {
      type: "image/jpeg",
      lastModified: Date.now(),
    });
  } catch (err) {
    console.warn("compressImageForSearch fallback:", err);
    return file;
  }
}

export function useImageSearch() {
  const navigate = useNavigate();
  const fileInputRef = useRef(null);
  const [searching, setSearching] = useState(false);

  const openPicker = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const searchByFile = useCallback(
  async (file) => {
    if (!file) return;
    if (!file.type?.startsWith("image/")) return;

    try {
      // ✅ 1. Navighezi instant
      navigate("/produse?by=image&page=1", {
        state: { imageSearchPending: true },
      });

      setSearching(true);

      // ✅ 2. Procesezi în background
      const optimizedFile = await compressImageForSearch(file);

      const fd = new FormData();
      fd.append("image", optimizedFile);

      const res = await fetch("/api/public/products/search-by-image", {
        method: "POST",
        body: fd,
      });

      const data = await res.json().catch(() => null);

      if (!res.ok) {
        navigate("/produse?by=image&error=1&page=1", { replace: true });
        return;
      }

      const ids = Array.isArray(data?.ids) ? data.ids.filter(Boolean) : [];

      if (ids.length > 0) {
        try {
          sessionStorage.setItem("imgsearch:last", JSON.stringify(data));
        } catch {""}

        navigate(
          `/produse?by=image&ids=${encodeURIComponent(ids.join(","))}&page=1`,
          { replace: true }
        );
        return;
      }

      navigate("/produse?by=image&page=1", { replace: true });
    } catch (err) {
      console.error("Image search failed:", err);
      navigate("/produse?by=image&error=1&page=1", { replace: true });
    } finally {
      setSearching(false);
    }
  },
  [navigate]
);

  const handleFileChange = useCallback(
    async (e) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      await searchByFile(file);
    },
    [searchByFile]
  );

  return {
    searching,
    fileInputRef,
    openPicker,
    handleFileChange,
    searchByFile,
  };
}