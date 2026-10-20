// src/pages/Vendor/CatalogProduse/VendorCollections/useInView.js
//
// true cât timp elementul e (măcar parțial) pe ecran. Folosit ca bara de
// selecție fixă să apară doar lângă secțiunea ei.
import { useEffect, useState } from "react";

export default function useInView(ref) {
  const [inView, setInView] = useState(true);

  useEffect(() => {
    const element = ref.current;
    if (!element || typeof IntersectionObserver === "undefined") return undefined;

    const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), {
      threshold: 0,
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);

  return inView;
}
