import React from "react";
import Navbar from "../components/Navbar/Navbar";
import HeroSection from "../components/HeroSection/HeroSection";
import CategoryGrid from "../components/CategoryGrid/CategoryGrid";
import DigitalServices from "../components/DigitalServices/DigitalServices";
import PopularProducts from "../components/PopularProducts/PopularProducts";
import Footer from "../components/Footer/Footer";

export default function HomePage() {
  return (
    <div className="bg-white text-darkText font-sans min-h-screen">
      <Navbar />
      <HeroSection />
      <CategoryGrid />
      <DigitalServices />
      <PopularProducts />
      <Footer />
    </div>
  );
}
