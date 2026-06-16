import React from "react";
import HeroSection from "../pages/Home/HeroSection/HeroSection";
import PopularProducts from "../pages/Home/PopularProducts/PopularProducts";

export default function HomePage() {
  return (
    <div className="bg-white text-darkText font-sans min-h-screen">
      <HeroSection />
      <PopularProducts />
    </div>
  );
}