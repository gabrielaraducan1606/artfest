import React, { createContext, useContext } from "react";

/** Valori implicite SEO (site-wide) */
export const DEFAULTS = {
  siteName: "Artfest",
  baseUrl: "https://artfest.ro",
  titleTemplate: "%s • Artfest",
  defaultTitle: "Artfest — cadouri și produse artizanale",
  defaultDescription: "Descoperă produse unicat create de artizani români pe Artfest.",
  defaultImage: "/img/share-fallback.jpg",
  twitterSite: "@artfest_ro",
};

export const SEOContext = createContext(null);

/** Hook de consum al contextului SEO */
export function useSEO() {
  const ctx = useContext(SEOContext);
  if (!ctx) throw new Error("useSEO must be used within <SEOProvider>");
  return ctx;
}
