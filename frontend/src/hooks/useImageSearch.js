// src/hooks/useImageSearch.js
import { useCallback, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

/**
 * Hook generic pentru căutare după imagine.
 *
 * Face POST către /api/public/products/search-by-image
 * și pune parametru ?ids=... în URL.
 */

// constante la nivel de modul => nu intră în deps de hooks
const IMAGE_SEARCH_ENDPOINT = "/api/public/products/search-by-image";
const IMAGE_SEARCH_TARGET_PATH = "/produse";
const IMAGE_SEARCH_PARAM_NAME = "ids";
// dacă vrei să cureți și alte chei, le adaugi aici
const IMAGE_SEARCH_CLEAR_KEYS = ["q"];

export function useImageSearch() {
  const [searching, setSearching] = useState(false);
  const fileInputRef = useRef(null);

  const navigate = useNavigate();
  const [params] = useSearchParams();

  const openPicker = useCallback(() => {
    if (searching) return;
    fileInputRef.current?.click();
  }, [searching]);

  const handleFileChange = useCallback(
    async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;

      // permite alegerea aceleiași imagini din nou
      e.target.value = "";

      try {
        setSearching(true);

        const formData = new FormData();
        formData.append("image", file);

        const res = await fetch(IMAGE_SEARCH_ENDPOINT, {
          method: "POST",
          body: formData,
          credentials: "include",
        });

        console.log(
          "image search fetch URL:",
          IMAGE_SEARCH_ENDPOINT,
          "status:",
          res.status
        );

        if (!res.ok) {
          throw new Error("image-search-failed");
        }

        const data = await res.json();
        const idsArray = Array.isArray(data.ids) ? data.ids : data;

        if (!idsArray || !idsArray.length) {
          alert(
            "Nu am găsit produse similare cu imaginea aleasă. Încearcă o altă fotografie 🙂"
          );
          return;
        }

        const idsParam = idsArray.join(",");

        const p = new URLSearchParams(params);
        p.set(IMAGE_SEARCH_PARAM_NAME, idsParam);
        p.delete("page");

        // ⚠️ AICI era warning-ul tău:
        // clearTextQueryKeys era un array în deps.
        // Acum folosim o constantă de modul, stabilă.
        IMAGE_SEARCH_CLEAR_KEYS.forEach((k) => p.delete(k));

        navigate(`${IMAGE_SEARCH_TARGET_PATH}?${p.toString()}`);
      } catch (err) {
        console.error("image search error", err);
        alert(
          "Nu am reușit să caut după imagine. Te rugăm să încerci din nou."
        );
      } finally {
        setSearching(false);
      }
    },
    [navigate, params] // doar astea se schimbă între rendere
  );

  return {
    searching,
    fileInputRef,
    openPicker,
    handleFileChange,
  };
}
