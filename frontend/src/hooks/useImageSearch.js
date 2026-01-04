// client/hooks/useImageSearch.js
import { useCallback, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

export function useImageSearch() {
  const navigate = useNavigate();
  const fileInputRef = useRef(null);
  const [searching, setSearching] = useState(false);

  const openPicker = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(
    async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;

      // allow same file reselect
      e.target.value = "";

      try {
        setSearching(true);

        const fd = new FormData();
        fd.append("image", file);

        const res = await fetch("/api/search/image", {
          method: "POST",
          body: fd,
        });

        const data = await res.json().catch(() => null);

        if (!res.ok) {
          const msg = data?.message || "Nu am putut procesa imaginea.";
          alert(msg);
          navigate("/produse?by=image&error=1&page=1");
          return;
        }

        const ids = Array.isArray(data?.ids) ? data.ids.filter(Boolean) : [];

        if (ids.length > 0) {
          // opțional: păstrează răspunsul pt debug
          try {
            sessionStorage.setItem("imgsearch:last", JSON.stringify(data));
          } catch {
            /* ignore */
          }
          navigate(`/produse?ids=${encodeURIComponent(ids.join(","))}&page=1`);
          return;
        }

        navigate("/produse?by=image&page=1");
      } catch {
        alert("Nu am putut procesa imaginea. Încearcă din nou.");
        navigate("/produse?by=image&error=1&page=1");
      } finally {
        setSearching(false);
      }
    },
    [navigate]
  );

  return {
    searching,
    fileInputRef,
    openPicker,
    handleFileChange,
  };
}
