import React from "react";

import HeroSection from "../pages/Home/HeroSection/HeroSection";
import CustomerRequestsSection from "../pages/Home/CustomerRequestsSection/CustomerRequestsSection";
import PopularProducts from "../pages/Home/PopularProducts/PopularProducts";

export default function HomePage() {
  return (
    <div className="bg-white text-darkText font-sans min-h-screen">
      <HeroSection />

      <CustomerRequestsSection />

      <PopularProducts />
    </div>
  );
}