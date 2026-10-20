import React from "react";

import HeroSection, { CreatorsBand } from "../pages/Home/HeroSection/HeroSection";
import RequestsExplainer from "../pages/Home/RequestsExplainer/RequestsExplainer";
import CustomerRequestsSection from "../pages/Home/CustomerRequestsSection/CustomerRequestsSection";
import PopularProducts from "../pages/Home/PopularProducts/PopularProducts";
import HomeCollectionsSection from "../pages/Home/HomeCollectionsSection/HomeCollectionsSection";
import WhyArtfest from "../pages/Home/WhyArtfest/WhyArtfest";

/*
 * Ordinea homepage (redesign claritate/conversie, 2026-10):
 *   1. Hero - ce e Artfest, ce găsești, ce faci acum (HeroSection)
 *   2. Două direcții - cumpără handmade / pregătesc un eveniment, cu
 *      scurtături verificate spre produse (HomeDirections, în HeroSection).
 *      Înlocuiește „Cumpără după ocazie” (OccasionCarousel), care deschidea
 *      Asistentul AI; Asistentul rămâne în bula FloatingHub.
 *   3. Alese de Artfest - Produsul zilei + Artizanul săptămânii, două
 *      carduri fixe, fără rotire (HeroSection)
 *   4. Noutăți pe Artfest (PopularProducts, neschimbat)
 *   5. Cereri gratuite: explicația în 3 pași (RequestsExplainer), apoi
 *      formularul + „Ce caută oamenii acum” (CustomerRequestsSection) -
 *      după produse, nu înaintea lor
 *   6. Colecții Artfest (HomeCollectionsSection, neschimbat)
 *   7. De ce să cumperi de pe Artfest (WhyArtfest)
 *   8. Pentru creatori (CreatorsBand) - mutat din primul ecran
 */
export default function HomePage() {
  return (
    <div className="bg-white text-darkText font-sans min-h-screen">
      <HeroSection />

      <PopularProducts />

      <RequestsExplainer />

      <CustomerRequestsSection />

      <HomeCollectionsSection />

      <WhyArtfest />

      <CreatorsBand />
    </div>
  );
}
