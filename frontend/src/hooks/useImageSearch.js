import { useCallback, useRef, useState } from "react";

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

/*
 * Butonul cu cameră din search bar NU mai caută singur (vechea rută
 * CLIP /api/public/products/search-by-image nu mai e folosită aici):
 * poza e trimisă Asistentului (FloatingHub -> AiAssistant), care o
 * afișează în conversație și pornește căutarea vizuală AI existentă.
 */
export const IMAGE_SEARCH_EVENT = "artfest:image-search";

export function useImageSearch() {
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
      setSearching(true);

      // JPEG ≤1024px: upload mai mic + format acceptat de Asistent
      const optimizedFile = await compressImageForSearch(file);

      window.dispatchEvent(
        new CustomEvent(IMAGE_SEARCH_EVENT, {
          detail: { file: optimizedFile },
        })
      );
    } catch (err) {
      console.error("Image search failed:", err);
    } finally {
      setSearching(false);
    }
  },
  []
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