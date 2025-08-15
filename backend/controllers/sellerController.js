// src/pages/Seller/SellerOnboarding.jsx
import React, { useState } from "react";
import Navbar from "../../components/HomePage/Navbar/Navbar";
import Footer from "../../components/HomePage/Footer/Footer";
import Step1 from "./Steps/Step1";
import Step2 from "./Steps/Step2";
import Step3 from "./Steps/Step3";
import styles from "./SellerOnboarding.module.css";

export default function SellerOnboarding() {
  const [activeStep, setActiveStep] = useState(1);

  const goNext = () => setActiveStep((prev) => Math.min(prev + 1, 3));
  const goPrev = () => setActiveStep((prev) => Math.max(prev - 1, 1));

  return (
    <>
      <Navbar />
      <div className={styles.page}>
        <div className={styles.tabs}>
          {[1, 2, 3].map((step) => (
            <button
              key={step}
              className={`${styles.tab} ${activeStep === step ? styles.active : ""}`}
              onClick={() => setActiveStep(step)}
            >
              Pasul {step}
            </button>
          ))}
        </div>

        <div className={styles.content}>
          {activeStep === 1 && <Step1 onNext={goNext} />}
          {activeStep === 2 && <Step2 onNext={goNext} onPrev={goPrev} />}
          {activeStep === 3 && <Step3 onPrev={goPrev} />}
        </div>
      </div>
      <Footer />
    </>
  );
}
