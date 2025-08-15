import React, { useEffect, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import Navbar from "../../../components/HomePage/Navbar/Navbar";
import Footer from "../../../components/HomePage/Footer/Footer";
import api from "../../../components/services/api";

// NOTE: ajustează aceste căi/denumiri după proiectul tău
import Step1 from "./Step1/Step1";
import Step2 from "./Step2/Step2";
import Step3 from "./Step3/Step3";

import styles from "./OnboardingTabs.module.css";

/**
 * Wizard pe tab-uri (3 pași) cu salvare incrementală:
 *  - citește progresul:   GET /api/seller/onboarding/status  -> { step, completed }
 *  - salvează un pas:     POST /api/seller/onboarding/save?step=N, body: data | FormData
 *  - finalizează:         POST /api/seller/onboarding/complete
 *
 * Fiecare Step *întoarce payloadul* propriu în onStepComplete / onPublish,
 * iar Tabs se ocupă să trimită la backend și să actualizeze progresul UI.
 */
export default function SellerOnboardingTabs() {
  const [params] = useSearchParams();
  const navigate = useNavigate();

  const [active, setActive] = useState(1);
  const [maxReached, setMaxReached] = useState(1);
  const [loading, setLoading] = useState(true);

  // ===== helpers =====
  const setURLStep = (n) => {
    const url = new URL(window.location.href);
    url.searchParams.set("step", String(n));
    window.history.replaceState({}, "", url.toString());
  };

  const toFormDataIfNeeded = (data) => {
    if (data instanceof FormData) return data;

    // dacă payload-ul conține File/Blob, creăm FormData
    let hasFile = false;
    if (data && typeof data === "object") {
      for (const v of Object.values(data)) {
        if (v instanceof File || v instanceof Blob) { hasFile = true; break; }
      }
    }
    if (!hasFile) return data; // îl lăsăm JSON

    const fd = new FormData();
    Object.entries(data).forEach(([k, v]) => {
      if (Array.isArray(v)) {
        v.forEach((item, idx) => fd.append(`${k}[${idx}]`, item));
      } else if (v !== undefined && v !== null) {
        fd.append(k, v);
      }
    });
    return fd;
  };

  const saveStep = async (step, payload) => {
    // payload poate fi JSON sau FormData
    const body = toFormDataIfNeeded(payload);
    const isFormData = body instanceof FormData;

    const config = {
      params: { step },
      headers: isFormData ? { "Content-Type": "multipart/form-data" } : undefined,
    };

    // POST /api/seller/onboarding/save?step=N
    const { data } = await api.post("/seller/onboarding/save", body, config);
    // { ok, nextStep, shopId? } – folosim nextStep dacă există
    return Number(data?.nextStep || step + 1);
  };

  // ===== load current status =====
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const qpStep = Number(params.get("step")) || null;

        const { data } = await api.get("/seller/onboarding/status");
        const stepFromApi = Math.min(Math.max(Number(data?.step || 1), 1), 3);

        const step = qpStep ? Math.min(Math.max(qpStep, 1), 3) : stepFromApi;

        if (!mounted) return;
        setActive(step);
        setMaxReached(step);
        setURLStep(step);
      } catch {
        // dacă nu există progres, pornește de la 1
        if (!mounted) return;
        setActive(1);
        setMaxReached(1);
        setURLStep(1);
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, [params]);

  const goTab = (tab) => {
    if (tab <= maxReached) {
      setActive(tab);
      setURLStep(tab);
    }
  };

  // ===== callbacks de pas =====
  const onCompleteStep1 = async (payloadFromStep1) => {
    try {
      const next = await saveStep(1, payloadFromStep1);
      setActive(next);
      setMaxReached((m) => Math.max(m, next));
      setURLStep(next);
    } catch (e) {
      console.error("Eroare salvare pas 1:", e);
      alert(e?.response?.data?.msg || "Eroare la salvarea pasului 1.");
    }
  };

  const onCompleteStep2 = async (payloadFromStep2) => {
    try {
      const next = await saveStep(2, payloadFromStep2);
      setActive(next);
      setMaxReached((m) => Math.max(m, next));
      setURLStep(next);
    } catch (e) {
      console.error("Eroare salvare pas 2:", e);
      alert(e?.response?.data?.msg || "Eroare la salvarea pasului 2.");
    }
  };

  const onPublishStep3 = async (payloadFromStep3) => {
    try {
      // salvează ultimele modificări ale pasului 3 (politici etc.)
      await saveStep(3, payloadFromStep3);

      // finalizează onboardingul -> publică magazinul
      const { data } = await api.post("/seller/onboarding/complete");
      // dacă backend-ul returnează slug, mergi direct la pagina publică
      if (data?.slug) {
        navigate(`/magazin/${data.slug}`, { replace: true });
      } else {
        navigate("/vanzator/dashboard", { replace: true });
      }
    } catch (e) {
      console.error("Publicare eșuată:", e);
      alert(e?.response?.data?.msg || "Eroare la publicare. Verifică datele.");
    }
  };

  return (
    <>
      <Navbar />
      <main className={styles.page}>
        <section className={styles.wrap}>
          <div className={styles.card}>
            <header className={styles.header}>
              <h1 className={styles.title}>Configurare magazin</h1>
              <p className={styles.subtitle}>Finalizează cei 3 pași ca să-ți publici magazinul.</p>

              <div className={styles.progress}>
                <div
                  className={styles.progressBar}
                  style={{ width: `${(active / 3) * 100}%` }}
                />
              </div>

              <div className={styles.tabs}>
                <button
                  className={`${styles.tab} ${active === 1 ? styles.tabActive : ""}`}
                  onClick={() => goTab(1)}
                  aria-current={active === 1 ? "page" : undefined}
                >
                  Pasul 1: Detalii magazin
                </button>
                <button
                  className={`${styles.tab} ${active === 2 ? styles.tabActive : ""}`}
                  onClick={() => goTab(2)}
                  disabled={maxReached < 2}
                >
                  Pasul 2: Plăți & Abonament
                </button>
                <button
                  className={`${styles.tab} ${active === 3 ? styles.tabActive : ""}`}
                  onClick={() => goTab(3)}
                  disabled={maxReached < 3}
                >
                  Pasul 3: Contract & Publicare
                </button>
              </div>
            </header>

            {loading ? (
              <div className={styles.skeleton} />
            ) : (
              <div className={styles.tabPanel}>
                {active === 1 && (
                  <Step1
                    // apelează onStepComplete(payload) când utilizatorul apasă "Salvează și continuă"
                    onStepComplete={onCompleteStep1}
                  />
                )}

                {active === 2 && (
                  <Step2
                    // pentru Step2 poți trimite FormData dacă ai fișiere (kycDoc/addressProof)
                    onStepComplete={onCompleteStep2}
                    onBack={() => goTab(1)}
                  />
                )}

                {active === 3 && (
                  <Step3
                    // apelează onPublish(payloadPas3) -> salvăm & publicăm
                    onPublish={onPublishStep3}
                    onBack={() => goTab(2)}
                  />
                )}
              </div>
            )}
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
