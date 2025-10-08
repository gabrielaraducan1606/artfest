import React from "react";
import HeroSection from "../pages/Home/HeroSection/HeroSection";
import CategoryGrid from "../pages/Home/CategoryGrid/CategoryGrid";
import DigitalServices from "../pages/Home/DigitalServices/DigitalServices";
import PopularProducts from "../pages/Home/PopularProducts/PopularProducts";

export default function HomePage() {
  return (
    <div className="bg-white text-darkText font-sans min-h-screen">
      <HeroSection />
      <CategoryGrid />
      <DigitalServices />
      <PopularProducts />
    </div>
  );
}
