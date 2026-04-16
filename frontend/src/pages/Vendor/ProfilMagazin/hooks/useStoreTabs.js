import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export default function useStoreTabs({
  showAboutSection,
  ensureReviewsLoaded,
}) {
  const aboutRef = useRef(null);
  const infoRef = useRef(null);
  const productsRef = useRef(null);
  const reviewsRef = useRef(null);

  const isProgrammaticScrollRef = useRef(false);
  const scrollUnlockTimerRef = useRef(null);

  const [activeTab, setActiveTab] = useState("produse");

  const headerOffset = useMemo(() => {
    if (typeof window === "undefined") return 96;

    const rs = getComputedStyle(document.documentElement);
    const app = parseInt(rs.getPropertyValue("--appbar-h"), 10) || 64;
    const tabs = parseInt(rs.getPropertyValue("--tabs-h"), 10) || 44;

    return app + tabs + 12;
  }, []);

  const tabs = useMemo(() => {
    return [
      ...(showAboutSection
        ? [{ key: "despre", label: "Despre", ref: aboutRef, hash: "#despre" }]
        : []),
      {
        key: "informatii",
        label: "Informații",
        ref: infoRef,
        hash: "#informatii",
      },
      {
        key: "produse",
        label: "Produse",
        ref: productsRef,
        hash: "#produse",
      },
      {
        key: "recenzii",
        label: "Recenzii",
        ref: reviewsRef,
        hash: "#recenzii",
      },
    ];
  }, [showAboutSection]);

  const lockProgrammaticScroll = useCallback(() => {
    isProgrammaticScrollRef.current = true;

    if (scrollUnlockTimerRef.current) {
      window.clearTimeout(scrollUnlockTimerRef.current);
    }

    scrollUnlockTimerRef.current = window.setTimeout(() => {
      isProgrammaticScrollRef.current = false;
    }, 700);
  }, []);

  const scrollToRef = useCallback(
    (ref, smooth = true) => {
      const el = ref?.current;
      if (!el || typeof window === "undefined") return;

      const rect = el.getBoundingClientRect();
      const absoluteY = window.scrollY + rect.top;

      lockProgrammaticScroll();

      window.scrollTo({
        top: absoluteY - headerOffset,
        behavior: smooth ? "smooth" : "auto",
      });
    },
    [headerOffset, lockProgrammaticScroll]
  );

  const onJump = useCallback(
    (key) => {
      const tab = tabs.find((item) => item.key === key);
      if (!tab) return;

      setActiveTab(key);

      if (typeof history !== "undefined") {
        history.replaceState(null, "", tab.hash);
      }

      scrollToRef(tab.ref, true);

      if (key === "recenzii") {
        ensureReviewsLoaded?.();
      }
    },
    [tabs, scrollToRef, ensureReviewsLoaded]
  );

  // doar la mount: dacă intri direct pe /magazin/x#recenzii
  

  useEffect(() => {
    const id = window.setTimeout(() => {
      import("../components/ProductList");
      import("../components/ReviewsSection.jsx");
      import("../modals/ProductModal");
      import("../modals/VendorGateModal");
    }, 50);

    return () => window.clearTimeout(id);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (isProgrammaticScrollRef.current) return;

        let bestKey = null;
        let bestTop = Number.POSITIVE_INFINITY;

        for (const entry of entries) {
          if (!entry.isIntersecting) continue;

          const key = entry.target.getAttribute("data-tab-key");
          const topDistance = Math.abs(entry.boundingClientRect.top - headerOffset);

          if (topDistance < bestTop) {
            bestTop = topDistance;
            bestKey = key;
          }
        }

        if (!bestKey || bestKey === activeTab) return;

        setActiveTab(bestKey);

        const tab = tabs.find((item) => item.key === bestKey);
        if (tab && typeof history !== "undefined") {
          history.replaceState(null, "", tab.hash);
        }

        if (bestKey === "recenzii") {
          ensureReviewsLoaded?.();
        }
      },
      {
        root: null,
        rootMargin: `-${headerOffset + 8}px 0px -60% 0px`,
        threshold: [0, 0.1, 0.25, 0.5, 0.75, 1],
      }
    );

    for (const tab of tabs) {
      if (tab.ref.current) observer.observe(tab.ref.current);
    }

    return () => observer.disconnect();
  }, [tabs, activeTab, headerOffset, ensureReviewsLoaded]);

  useEffect(() => {
    return () => {
      if (scrollUnlockTimerRef.current) {
        window.clearTimeout(scrollUnlockTimerRef.current);
      }
    };
  }, []);

  return {
    aboutRef,
    infoRef,
    productsRef,
    reviewsRef,
    tabs,
    activeTab,
    setActiveTab,
    onJump,
  };
}