import React from "react";

import HeroSection from "../pages/Home/HeroSection/HeroSection";
import CustomerRequestsSection from "../pages/Home/CustomerRequestsSection/CustomerRequestsSection";
import OccasionCarousel from "../pages/Home/OccasionCarousel/OccasionCarousel";
import PopularProducts from "../pages/Home/PopularProducts/PopularProducts";
import HomeCollectionsSection from "../pages/Home/HomeCollectionsSection/HomeCollectionsSection";
import WhyArtfest from "../pages/Home/WhyArtfest/WhyArtfest";

/*
 * Ordinea homepage (redesign marketing/conversie, 2026):
 *   1. Produsul zilei / Artizanul săptămânii (HeroSection, neatins)
 *   2. Cererile clienților (CustomerRequestsSection, neatins - rămâne
 *      sus, funcționalitatea și backend-ul nu s-au schimbat)
 *   3. Cumpără după ocazie (nou - fiecare card deschide Asistentul
 *      Artfest existent, cu mesaj precompletat editabil)
 *   4. Produse noi (PopularProducts, aceeași sursă de date)
 *   5. Colecții Artfest (nou pe homepage, sub Produse noi - reutilizează
 *      usePublicCollections/CollectionCards, la fel ca /colectii)
 *   6. De ce Artfest (nou, conținut static)
 *
 * "Ce cauți? + Asistent" NU mai e o secțiune separată - promovarea
 * Asistentului se face acum prin bula existentă (FloatingHub), cu un
 * mesaj scurt care apare automat lângă ea - vezi FloatingHub.jsx.
 */
export default function HomePage() {
  return (
    <div className="bg-white text-darkText font-sans min-h-screen">
      <HeroSection />

      <CustomerRequestsSection />

      <OccasionCarousel />

      <PopularProducts />

      <HomeCollectionsSection />

      <WhyArtfest />
    </div>
  );
}