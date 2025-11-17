import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { api } from "../../../../lib/api";
import styles from "./OnBoardingDetails.module.css";

import ProfileTab from "./tabs/ProfileTabBoarding.jsx";
import BillingTab from "./tabs/BillingTab.jsx";
import PaymentTab from "./tabs/PaymentTab.jsx";

const VANITY_BASE = "www.artfest.ro";

// taburi valide
const ALLOWED_TABS = ["profil", "facturare", "plata"];

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

  // parse query params din URL (stabil via useMemo)
  const params = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const qpTab = (params.get("tab") || "").toLowerCase();
  const solo = params.get("solo") === "1";

  const initialTab = ALLOWED_TABS.includes(qpTab) ? qpTab : "profil";

  const [services, setServices] = useState([]);
  const [activeTab, setActiveTab] = useState(initialTab);
  const [err, setErr] = useState("");

  const [saveState, setSaveState] = useState({}); // by serviceId
  const [saveError, setSaveError] = useState({}); // by serviceId

  const [billingStatus, setBillingStatus] = useState("idle");

  // ===== sincronizare tab <-> URL =====

  // când se schimbă URL-ul (back/forward), sincronizează state-ul
  useEffect(() => {
    if (ALLOWED_TABS.includes(qpTab)) setActiveTab(qpTab);
    else setActiveTab("profil");
  }, [qpTab]);

  // când se schimbă tab-ul în UI, rescrie query-ul (fără reload)
  useEffect(() => {
    const curr = new URLSearchParams(location.search);
    const currTab = (curr.get("tab") || "").toLowerCase();
    const currSolo = curr.get("solo") === "1";

    if (currTab === activeTab && currSolo === solo) return;

    curr.set("tab", activeTab);
    if (solo) curr.set("solo", "1");
    else curr.delete("solo");

    navigate({ search: `?${curr.toString()}` }, { replace: true });
  }, [activeTab, solo, location.search, navigate]);

  // dacă intri în solo mode fără tab valid, forțează URL corect
  useEffect(() => {
    if (solo && !ALLOWED_TABS.includes(qpTab)) {
      navigate({ search: "?tab=profil&solo=1" }, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ===== initial fetch =====
  const fetchMyServices = useCallback(async () => {
    const d = await api("/api/vendors/me/services?includeProfile=1", { method: "GET" });
    if (d?.__unauth) {
      // ajustează ruta de login dacă în aplicație folosiți /autentificare
      navigate("/autentificare?redirect=/onboarding/details", { replace: true });
      return [];
    }
    const items = (d.items || []).map((s) => ({
      ...s,
      attributes: s.attributes || {},
      profile: {
        displayName:    s.profile?.displayName || "",
        slug:           s.profile?.slug || "",
        logoUrl:        s.profile?.logoUrl || "",
        coverUrl:       s.profile?.coverUrl || "",
        phone:          s.profile?.phone || "",
        email:          s.profile?.email || "",
        address:        s.profile?.address || "",
        delivery:       Array.isArray(s.profile?.delivery) ? s.profile.delivery : [],
        tagline:        s.profile?.tagline || "",
        about:          s.profile?.about || "",
        city:           s.profile?.city || "",
        website:        s.profile?.website || "",
        // 🔹 ADĂUGAT: descrierea scurtă, ca să fie citită & resalvată corect
        shortDescription: s.profile?.shortDescription || "",
      },
    }));
    return items;
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

  /* ======= AUTOSAVE INFRA (debounce per serviceId) ======= */
  const timers = useRef({}); // { [serviceId]: timeoutId }

  function schedule(serviceId, fn, delay = 600) {
    if (timers.current[serviceId]) clearTimeout(timers.current[serviceId]);
    timers.current[serviceId] = setTimeout(fn, delay);
  }

  // cleanup timere la unmount
  useEffect(() => {
    return () => {
      Object.values(timers.current || {}).forEach((t) => clearTimeout(t));
      timers.current = {};
    };
  }, []);

  /* ===== Update PROFIL (PUT /vendor-services/:id/profile) ===== */
  const updateProfile = useCallback((idx, patch) => {
    setServices((prev) => {
      const next = [...prev];
      const s = { ...next[idx] };
      const p = { ...(s.profile || {}) };

      // auto-slug la schimbarea numelui dacă nu s-a atins slug-ul manual
      if (patch.displayName && !p.slug) p.slug = slugify(patch.displayName);

      Object.assign(p, patch);
      s.profile = p;
      next[idx] = s;

      const serviceId = s.id;
      if (serviceId) {
        setSaveState((m) => ({ ...m, [serviceId]: "saving" }));
        schedule(serviceId, async () => {
          try {
            await api(
              `/api/vendors/vendor-services/${encodeURIComponent(serviceId)}/profile`,
              {
                method: "PUT",
                body: { ...p, mirrorVendor: true },
              }
            );
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

  /* ===== Update SERVICE BASICS (PATCH /me/services/:id) ===== */
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
                city: current?.city || "",
                attributes: current?.attributes || {},
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

  /* ===== Upload helper (POST /api/upload) ===== */
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
  const hasNameConflict = false; // dacă vrei, poți calcula pe baza verificărilor de disponibilitate

  /* ============================================================
     SOLO MODE
     - Dacă ?solo=1 -> NU mai afișăm bara de taburi;
     - Randăm DOAR componenta corespunzătoare lui activeTab.
     ============================================================ */
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
            onContinue={() => {
              /* în solo nu navigăm nicăieri */
            }}
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

        {activeTab === "plata" && <PaymentTab />}
      </section>
    );
  }

  // ===== MOD NORMAL: taburi complete =====
  return (
    <section className={styles.wrap}>
      <nav className={styles.tabsBar} role="tablist" aria-label="Onboarding tabs">
        <button
          role="tab"
          aria-selected={activeTab === "profil"}
          className={`${styles.tab} ${
            activeTab === "profil" ? styles.tabActive : ""
          }`}
          onClick={() => setActiveTab("profil")}
          type="button"
        >
          Profil servicii
        </button>

        <button
          role="tab"
          aria-selected={activeTab === "facturare"}
          className={`${styles.tab} ${
            activeTab === "facturare" ? styles.tabActive : ""
          }`}
          onClick={() => setActiveTab("facturare")}
          type="button"
        >
          Date facturare
        </button>

        <button
          role="tab"
          aria-selected={activeTab === "plata"}
          className={`${styles.tab} ${
            activeTab === "plata" ? styles.tabActive : ""
          }`}
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
          onSaved={() => setActiveTab("plata")}
          onStatusChange={setBillingStatus}
          canContinue={billingStatus === "saved"}
          onContinue={() => setActiveTab("plata")}
        />
      )}

      {activeTab === "plata" && <PaymentTab />}
    </section>
  );
}
