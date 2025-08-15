import React from "react";
import Navbar from "../components/HomePage/Navbar/Navbar";
import HeroSection from "../components/HomePage/HeroSection/HeroSection";
import CategoryGrid from "../components/HomePage/CategoryGrid/CategoryGrid";
import DigitalServices from "../components/HomePage/DigitalServices/DigitalServices";
import PopularProducts from "../components/HomePage/PopularProducts/PopularProducts";
import Footer from "../components/HomePage/Footer/Footer";

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
