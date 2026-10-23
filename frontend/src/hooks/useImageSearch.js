import { useCallback, useRef, useState } from "react";

const MAX_DIMENSION = 1024;
const JPEG_QUALITY = 0.82;

// Pe mobil unele galerii (Android) dau fișierul cu `type` gol - inputul
// are deja accept="image/*", deci îl decodăm oricum; altfel poza era
// ignorată fără niciun mesaj. Dacă nu e imagine, Asistentul o respinge.
function looksLikeImage(file) {
  if (!file) return false;
  return !file.type || file.type.startsWith("image/");
}

async function compressImageForSearch(file) {
  if (!looksLikeImage(file)) return file;

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

  /*
   * Sincron, direct din click/tap - pe mobil selectorul de fișiere se
   * deschide doar în gestul utilizatorului (fără await/setTimeout înainte).
   * `input` opțional: componentele cu mai multe search bar-uri (Navbar
   * desktop + mobil) deschid inputul de lângă butonul apăsat.
   */
  const openPicker = useCallback((input) => {
    const target =
      typeof HTMLInputElement !== "undefined" && input instanceof HTMLInputElement
        ? input
        : fileInputRef.current;
    target?.click();
  }, []);

  const searchByFile = useCallback(
  async (file) => {
    if (!looksLikeImage(file)) return;

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