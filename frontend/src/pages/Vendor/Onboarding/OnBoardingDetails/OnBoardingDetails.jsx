import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { api } from "../../../../lib/api";
import styles from "./OnBoardingDetails.module.css";

import ProfileTab from "./tabs/ProfileTabBoarding.jsx";

const VANITY_BASE = "www.artfest.ro";
const SELLER_TYPES = ["independent_creator", "verified_business"];

const slugify = (s = "") =>
  String(s)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

function getStorePath(service) {
  const slug = service?.profile?.slug?.trim();
  if (!slug) return "/dashboard";
  return `/magazin/${encodeURIComponent(slug)}?onboarding=products`;
}

export default function OnBoardingDetails() {
  const navigate = useNavigate();
  const location = useLocation();

  const params = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const qpServiceId = (params.get("serviceId") || "").trim();
  const solo = params.get("solo") === "1";
  const profileOnlyMode = solo && !!qpServiceId;

  const [services, setServices] = useState([]);
  const [err, setErr] = useState("");
  const [saveState, setSaveState] = useState({});
  const [saveError, setSaveError] = useState({});

  const [sellerType, setSellerType] = useState("");
  const [sellerTypeErr, setSellerTypeErr] = useState("");
  const [savingSellerType, setSavingSellerType] = useState(false);

  useEffect(() => {
    const legacyTab = params.get("tab");
    if (!legacyTab) return;

    const next = new URLSearchParams(location.search);
    next.delete("tab");

    navigate(
      {
        pathname: location.pathname,
        search: next.toString() ? `?${next.toString()}` : "",
      },
      { replace: true }
    );
  }, [location.pathname, location.search, navigate, params]);

  const fetchSellerType = useCallback(async () => {
    try {
      const d = await api("/api/vendors/me", { method: "GET" });
      const fromBilling = d?.billing?.sellerType;

      if (SELLER_TYPES.includes(fromBilling)) {
        setSellerType(fromBilling);
        return;
      }

      if (d?.billing?.legalType || d?.billing?.companyName || d?.billing?.cui) {
        setSellerType("verified_business");
      }
    } catch {
      // seller type rămâne gol pentru conturile noi
    }
  }, []);

  useEffect(() => {
    fetchSellerType();
  }, [fetchSellerType]);

  const fetchMyServices = useCallback(async () => {
    const d = await api("/api/vendors/me/services?includeProfile=1", { method: "GET" });

    if (d?.__unauth) {
      navigate("/autentificare?redirect=/onboarding/details", { replace: true });
      return [];
    }

    return (d.items || []).map((s) => ({
      ...s,
      attributes: s.attributes || {},
      profile: {
        displayName: s.profile?.displayName || "",
        slug: s.profile?.slug || "",
        logoUrl: s.profile?.logoUrl || "",
        coverUrl: s.profile?.coverUrl || "",
        phone: s.profile?.phone || "",
        email: s.profile?.email || "",
        address: s.profile?.address || "",
        delivery: Array.isArray(s.profile?.delivery) ? s.profile.delivery : [],
        tagline: s.profile?.tagline || "",
        about: s.profile?.about || "",
        city: s.profile?.city || "",
        website: s.profile?.website || "",
        shortDescription: s.profile?.shortDescription || "",
      },
    }));
  }, [navigate]);

  useEffect(() => {
    (async () => {
      try {
        setServices(await fetchMyServices());
        setErr("");
      } catch (e) {
        setErr(e?.message || "Nu am putut încărca serviciile.");
      }
    })();
  }, [fetchMyServices]);

  const visibleServices = useMemo(() => {
    if (!profileOnlyMode) return services;
    return services.filter((s) => s.id === qpServiceId);
  }, [services, profileOnlyMode, qpServiceId]);

  const timers = useRef({});

  function schedule(serviceId, fn, delay = 600) {
    if (timers.current[serviceId]) clearTimeout(timers.current[serviceId]);
    timers.current[serviceId] = setTimeout(fn, delay);
  }

  useEffect(() => {
    return () => {
      Object.values(timers.current || {}).forEach((t) => clearTimeout(t));
      timers.current = {};
    };
  }, []);

  const updateProfile = useCallback((idx, patch) => {
    setServices((prev) => {
      const next = [...prev];
      const s = { ...next[idx] };
      const p = { ...(s.profile || {}) };

      if (patch.displayName && !p.slug) p.slug = slugify(patch.displayName);

      Object.assign(p, patch);
      s.profile = p;
      next[idx] = s;

      const serviceId = s.id;
      if (serviceId) {
        setSaveState((m) => ({ ...m, [serviceId]: "saving" }));

        schedule(serviceId, async () => {
          try {
            await api(`/api/vendors/vendor-services/${encodeURIComponent(serviceId)}/profile`, {
              method: "PUT",
              body: { ...p, mirrorVendor: true },
            });

            setSaveState((m) => ({ ...m, [serviceId]: "saved" }));
            setSaveError((m) => ({ ...m, [serviceId]: "" }));
          } catch (e) {
            setSaveState((m) => ({ ...m, [serviceId]: "error" }));
            setSaveError((m) => ({
              ...m,
              [serviceId]: e?.message || "Eroare la salvarea profilului",
            }));
          }
        });
      }

      return next;
    });
  }, []);

  const updateServiceBasics = useCallback((idx, patch) => {
    setServices((prev) => {
      const next = [...prev];
      const s = { ...next[idx] };

      next[idx] = {
        ...s,
        ...patch,
        attributes: { ...(s.attributes || {}), ...(patch.attributes || {}) },
      };

      const serviceId = s.id;
      if (serviceId) {
        setSaveState((m) => ({ ...m, [serviceId]: "saving" }));

        schedule(serviceId, async () => {
          try {
            const current = next[idx];

            await api(`/api/vendors/me/services/${encodeURIComponent(serviceId)}`, {
              method: "PATCH",
              body: {
                title: current?.title || "",
                description: current?.description || "",
                basePriceCents: current?.basePriceCents ?? null,
                currency: current?.currency || "RON",
                city: current?.city || "",
                coverageAreas: Array.isArray(current?.coverageAreas)
                  ? current.coverageAreas
                  : [],
                mediaUrls: Array.isArray(current?.mediaUrls)
                  ? current.mediaUrls
                  : [],
                attributes: current?.attributes || {},
                estimatedShippingFeeCents:
                  current?.estimatedShippingFeeCents ?? null,
                freeShippingThresholdCents:
                  current?.freeShippingThresholdCents ?? null,
                shippingNotes: current?.shippingNotes ?? null,
              },
            });

            setSaveState((m) => ({ ...m, [serviceId]: "saved" }));
            setSaveError((m) => ({ ...m, [serviceId]: "" }));
          } catch (e) {
            setSaveState((m) => ({ ...m, [serviceId]: "error" }));
            setSaveError((m) => ({
              ...m,
              [serviceId]: e?.message || "Eroare la salvare",
            }));
          }
        });
      }

      return next;
    });
  }, []);

  const uploadFile = useCallback(async (file) => {
    const fd = new FormData();
    fd.append("file", file);

    const d = await api("/api/upload", { method: "POST", body: fd });
    if (!d?.url) throw new Error("Upload eșuat");

    return d.url;
  }, []);

  const isSavingAny = useMemo(
    () =>
      savingSellerType ||
      Object.values(saveState).some((s) => s === "saving"),
    [saveState, savingSellerType]
  );

const saveSellerType = useCallback(async () => {
  if (!SELLER_TYPES.includes(sellerType)) {
    setSellerTypeErr("Alege cum vinzi pe Artfest.");
    return false;
  }

  try {
    setSavingSellerType(true);
    setSellerTypeErr("");

    await api("/api/vendors/me/seller-type", {
      method: "PUT",
      body: { sellerType },
    });

    return true;
  } catch (e) {
    setSellerTypeErr(e?.message || "Nu am putut salva tipul de vânzător.");
    return false;
  } finally {
    setSavingSellerType(false);
  }
}, [sellerType]);

  const handlePublished = useCallback(async () => {
    const sellerTypeOk = await saveSellerType();
    if (!sellerTypeOk) return;

    let fresh = [];

    try {
      fresh = await fetchMyServices();
      setServices(fresh);
    } catch {
      fresh = visibleServices;
    }

    const target =
      (profileOnlyMode
        ? fresh.find((s) => s.id === qpServiceId)
        : fresh.find((s) => s.status === "ACTIVE" && s.isActive) || fresh[0]) ||
      visibleServices[0];

    navigate(getStorePath(target), { replace: false });
  }, [
    fetchMyServices,
    navigate,
    profileOnlyMode,
    qpServiceId,
    visibleServices,
    saveSellerType
  ]);

  return (
    <section className={styles.wrap}>
      <header className={styles.onboardingHero}>
        <span className={styles.stepBadge}>Start magazin</span>
        <h1 className={styles.title}>Creează-ți magazinul Artfest</h1>
        <p className={styles.subtitle}>
          Completează profilul public al magazinului. După activare vei putea adăuga primele produse.
        </p>

        <div className={styles.commissionNote}>
          <strong>Publicarea magazinului este gratuită.</strong>
          <span>
            Comisionul se aplică doar comenzilor finalizate prin Artfest. Detaliile
            despre planuri și limite le poți vedea ulterior în dashboard.
          </span>
        </div>
      </header>

      <div className={styles.sellerTypeBox}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}>Cum vinzi pe Artfest?</h2>
          <p className={styles.sectionSubtitle}>
            Alegerea apare pe profilul magazinului. Datele fiscale complete le poți
            completa mai târziu, când vrei să accepți comenzi.
          </p>
        </div>

        <div className={styles.sellerTypeCards}>
          <button
            type="button"
            className={`${styles.sellerTypeCard} ${
              sellerType === "independent_creator"
                ? styles.sellerTypeCardActive
                : ""
            }`}
            onClick={() => {
              setSellerType("independent_creator");
              setSellerTypeErr("");
            }}
          >
            <strong>🌱 Creator Independent</strong>
            <span>Nu am încă PFA/SRL și vreau să testez vânzarea pe platformă.</span>
          </button>

          <button
            type="button"
            className={`${styles.sellerTypeCard} ${
              sellerType === "verified_business"
                ? styles.sellerTypeCardActive
                : ""
            }`}
            onClick={() => {
              setSellerType("verified_business");
              setSellerTypeErr("");
            }}
          >
            <strong>✓ Business Verificat</strong>
            <span>Am PFA, SRL, II sau IF.</span>
          </button>
        </div>

        {sellerTypeErr && (
          <div className={styles.error} role="alert">
            {sellerTypeErr}
          </div>
        )}
      </div>

      <ProfileTab
        services={visibleServices}
        vanityBase={VANITY_BASE}
        saveState={saveState}
        saveError={saveError}
        updateProfile={updateProfile}
        updateServiceBasics={updateServiceBasics}
        uploadFile={uploadFile}
        isSavingAny={isSavingAny}
        hasNameConflict={false}
        onContinue={handlePublished}
        continueLabel="Creează magazinul"
        err={err}
        setErr={setErr}
      />
    </section>
  );
}