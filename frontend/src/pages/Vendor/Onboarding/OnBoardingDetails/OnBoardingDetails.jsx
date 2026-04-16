import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { api } from "../../../../lib/api";
import styles from "./OnBoardingDetails.module.css";

import ProfileTab from "./tabs/ProfileTabBoarding.jsx";
import BillingTab from "./tabs/BillingTab.jsx";
import PaymentTab from "./tabs/PaymentTab.jsx";
import ConnectPayoutsTab from "./tabs/ConnectPayoutsTab.jsx";

const VANITY_BASE = "www.artfest.ro";
const ALLOWED_TABS = ["profil", "facturare", "incasari", "plata"];

const slugify = (s = "") =>
  String(s)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

export default function OnBoardingDetails() {
  const navigate = useNavigate();
  const location = useLocation();

  const params = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const qpTab = (params.get("tab") || "").toLowerCase();
  const qpServiceId = (params.get("serviceId") || "").trim();
  const solo = params.get("solo") === "1";

  const profileOnlyMode = solo && !!qpServiceId;
  const initialTab = profileOnlyMode
    ? "profil"
    : ALLOWED_TABS.includes(qpTab)
    ? qpTab
    : "profil";

  const [services, setServices] = useState([]);
  const [activeTab, setActiveTab] = useState(initialTab);
  const [err, setErr] = useState("");

  const [saveState, setSaveState] = useState({});
  const [saveError, setSaveError] = useState({});
  const [billingStatus, setBillingStatus] = useState("idle");

  // URL -> state
  useEffect(() => {
    if (profileOnlyMode) {
      setActiveTab("profil");
      return;
    }

    if (ALLOWED_TABS.includes(qpTab)) setActiveTab(qpTab);
    else setActiveTab("profil");
  }, [qpTab, profileOnlyMode]);

  // state -> URL
  useEffect(() => {
    const curr = new URLSearchParams(location.search);
    const currTab = (curr.get("tab") || "").toLowerCase();
    const currSolo = curr.get("solo") === "1";
    const currServiceId = (curr.get("serviceId") || "").trim();

    const forcedTab = profileOnlyMode ? "profil" : activeTab;

    if (
      currTab === forcedTab &&
      currSolo === solo &&
      currServiceId === qpServiceId
    ) {
      return;
    }

    curr.set("tab", forcedTab);

    if (solo) curr.set("solo", "1");
    else curr.delete("solo");

    if (qpServiceId) curr.set("serviceId", qpServiceId);
    else curr.delete("serviceId");

    navigate({ search: `?${curr.toString()}` }, { replace: true });
  }, [activeTab, solo, qpServiceId, profileOnlyMode, location.search, navigate]);

  useEffect(() => {
    if (profileOnlyMode) {
      navigate(
        {
          search: `?serviceId=${encodeURIComponent(qpServiceId)}&tab=profil&solo=1`,
        },
        { replace: true }
      );
      return;
    }

    if (solo && !ALLOWED_TABS.includes(qpTab)) {
      navigate({ search: "?tab=profil&solo=1" }, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    () => Object.values(saveState).some((s) => s === "saving"),
    [saveState]
  );

  const hasNameConflict = false;

  // PROFILE-ONLY MODE: magazin nou creat din dashboard/profil
  if (profileOnlyMode) {
    return (
      <section className={styles.wrap}>
        <ProfileTab
          services={visibleServices}
          vanityBase={VANITY_BASE}
          saveState={saveState}
          saveError={saveError}
          updateProfile={updateProfile}
          updateServiceBasics={updateServiceBasics}
          uploadFile={uploadFile}
          isSavingAny={isSavingAny}
          hasNameConflict={hasNameConflict}
          onContinue={() => {}}
          err={err}
          setErr={setErr}
        />
      </section>
    );
  }

  // SOLO MODE generic
  if (solo) {
    return (
      <section className={styles.wrap}>
        {activeTab === "profil" && (
          <ProfileTab
            services={services}
            vanityBase={VANITY_BASE}
            saveState={saveState}
            saveError={saveError}
            updateProfile={updateProfile}
            updateServiceBasics={updateServiceBasics}
            uploadFile={uploadFile}
            isSavingAny={isSavingAny}
            hasNameConflict={hasNameConflict}
            onContinue={() => {}}
            err={err}
            setErr={setErr}
          />
        )}

        {activeTab === "facturare" && (
          <BillingTab
            onSaved={() => {}}
            onStatusChange={() => {}}
            canContinue={false}
            onContinue={() => {}}
          />
        )}

        {activeTab === "incasari" && <ConnectPayoutsTab />}
        {activeTab === "plata" && <PaymentTab />}
      </section>
    );
  }

  // NORMAL MODE
  return (
    <section className={styles.wrap}>
      <nav className={styles.tabsBar} role="tablist" aria-label="Onboarding tabs">
        <button
          role="tab"
          aria-selected={activeTab === "profil"}
          className={`${styles.tab} ${activeTab === "profil" ? styles.tabActive : ""}`}
          onClick={() => setActiveTab("profil")}
          type="button"
        >
          Profil servicii
        </button>

        <button
          role="tab"
          aria-selected={activeTab === "facturare"}
          className={`${styles.tab} ${activeTab === "facturare" ? styles.tabActive : ""}`}
          onClick={() => setActiveTab("facturare")}
          type="button"
        >
          Date facturare
        </button>

        <button
          role="tab"
          aria-selected={activeTab === "incasari"}
          className={`${styles.tab} ${activeTab === "incasari" ? styles.tabActive : ""}`}
          onClick={() => setActiveTab("incasari")}
          type="button"
        >
          Activează încasări
        </button>

        <button
          role="tab"
          aria-selected={activeTab === "plata"}
          className={`${styles.tab} ${activeTab === "plata" ? styles.tabActive : ""}`}
          onClick={() => setActiveTab("plata")}
          type="button"
        >
          Plată abonament
        </button>
      </nav>

      {activeTab === "profil" && (
        <ProfileTab
          services={services}
          vanityBase={VANITY_BASE}
          saveState={saveState}
          saveError={saveError}
          updateProfile={updateProfile}
          updateServiceBasics={updateServiceBasics}
          uploadFile={uploadFile}
          isSavingAny={isSavingAny}
          hasNameConflict={hasNameConflict}
          onContinue={() => setActiveTab("facturare")}
          err={err}
          setErr={setErr}
        />
      )}

      {activeTab === "facturare" && (
        <BillingTab
          onSaved={() => setActiveTab("incasari")}
          onStatusChange={setBillingStatus}
          canContinue={billingStatus === "saved"}
          onContinue={() => setActiveTab("incasari")}
        />
      )}

      {activeTab === "incasari" && <ConnectPayoutsTab />}
      {activeTab === "plata" && <PaymentTab />}
    </section>
  );
}