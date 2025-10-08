// components/onboarding/OnBoardingDetails.jsx
import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { api } from "../../../../lib/api";
import styles from "./OnBoardingDetails.module.css";

import { useDebouncedValue } from "./hooks/useDebouncedValue";
import { useAvailability } from "./hooks/useAvailability";
import { useAutoSave } from "./hooks/useAutoSave";

import ProfileTab from "./tabs/ProfileTabBoarding";
import BillingTab from "./tabs/BillingTab";
import PaymentTab from "./tabs/PaymentTab";

const VANITY_BASE = "www.artfest.ro/"; // ajustează domeniul
const OB_TICKET_PARAM = "obpf";                     // param. de URL pentru prefill
const OB_TICKET_PREFIX = "onboarding.ticket.";      // cheie în sessionStorage
const PREFILL_TTL_MS = 15 * 60 * 1000;              // 15 min – doar imediat după register
const OB_SESSION_KEY = "onboarding.sessionId";      // ID de sesiune per TAB (pt. drafts/alegeri)

function slugify(s = "") {
  return String(s)
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export default function OnBoardingDetails() {
  const [services, setServices] = useState([]);
  const [err, setErr] = useState("");

  const [linkAvailability, setLinkAvailability] = useState({});
  const [activeTab, setActiveTab] = useState("profil");

  const [saveState, setSaveState] = useState({});
  const [saveError, setSaveError] = useState({});
  const [billingStatus, setBillingStatus] = useState("idle");

  // ===== ID de sesiune de onboarding per TAB (pt. Billing/Payment drafts) =====
  const [obSessionId, setObSessionId] = useState("");
  useEffect(() => {
    try {
      let sid = sessionStorage.getItem(OB_SESSION_KEY);
      if (!sid) {
        sid = (crypto?.randomUUID?.() || Math.random().toString(36).slice(2));
        sessionStorage.setItem(OB_SESSION_KEY, sid);
      }
      setObSessionId(sid);
    } catch {
      setObSessionId(Math.random().toString(36).slice(2));
    }
  }, []);

  // ===== Încarcă serviciile + profilele =====
  useEffect(() => {
    (async () => {
      try {
        const d = await api("/api/vendors/me/services?includeProfile=1");
        const items = (d.items || []).map((s) => ({
          ...s,
          attributes: s.attributes || {},
          profile: {
            displayName: s.profile?.displayName || "",
            slug:        s.profile?.slug || "",
            logoUrl:     s.profile?.logoUrl || "",
            coverUrl:    s.profile?.coverUrl || "",
            phone:       s.profile?.phone || "",
            email:       s.profile?.email || "",
            address:     s.profile?.address || "",
            delivery:    Array.isArray(s.profile?.delivery) ? s.profile.delivery : [],
            tagline:     s.profile?.tagline || "",
            about:       s.profile?.about || "",
            city:        s.profile?.city || "",
          },
        }));
        setServices(items);
      } catch {
        setServices([]);
      }
    })();
  }, []);

  // ===== Debounce colecția de servicii pt. verificări =====
  const debouncedServices = useDebouncedValue(services, 350);

  // ===== Disponibilitate nume brand (și slug) =====
  const availability = useAvailability(debouncedServices);

  // ===== Autosave (profile + service) =====
  const autoSave = useAutoSave({ services, availability, setSaveState, setSaveError });

  // ===== One-time PREFILL din Register (ticket în URL + sessionStorage) =====
  const prefillAppliedRef = useRef(false);
  useEffect(() => {
    if (prefillAppliedRef.current) return;
    if (!services?.length) return;

    const params = new URLSearchParams(window.location.search);
    const ticket = params.get(OB_TICKET_PARAM);
    if (!ticket) { prefillAppliedRef.current = true; return; }

    let prefill = null;
    try {
      const raw = sessionStorage.getItem(OB_TICKET_PREFIX + ticket);
      if (raw) prefill = JSON.parse(raw);
    } catch {""}

    // invalid / expirat → curățăm ticketul și URL-ul
    if (!prefill || (prefill.ts && Date.now() - prefill.ts > PREFILL_TTL_MS)) {
      try { sessionStorage.removeItem(OB_TICKET_PREFIX + ticket); } catch {""}
      const u = new URL(window.location.href);
      u.searchParams.delete(OB_TICKET_PARAM);
      window.history.replaceState({}, "", u.pathname + u.search + u.hash);
      prefillAppliedRef.current = true;
      return;
    }

    // aplică prefill doar pe câmpuri goale
    setServices((arr) => {
      const next = arr.map((s, idx) => {
        const p = s.profile || {};
        const patchProfile = {};
        const patchService = {};

        if (!p.displayName?.trim() && prefill.displayName?.trim()) {
          patchProfile.displayName = prefill.displayName.trim();
          if (!p.slug?.trim()) patchProfile.slug = slugify(prefill.displayName.trim());
        }
        if (!s.city?.trim() && prefill.city?.trim()) {
          patchService.city = prefill.city.trim();
        }

        const merged = {
          ...s,
          ...(Object.keys(patchService).length ? patchService : {}),
          profile: { ...p, ...(Object.keys(patchProfile).length ? patchProfile : {}) },
        };

        // declanșează autosave pentru ce s-a completat
        const serviceId = s.id;
        if (serviceId) {
          if (Object.keys(patchProfile).length) autoSave.saveProfile(serviceId, idx);
          if (Object.keys(patchService).length) autoSave.saveService(serviceId, idx);
        }
        return merged;
      });
      return next;
    });

    // consumă ticketul și curăță URL-ul
    try { sessionStorage.removeItem(OB_TICKET_PREFIX + ticket); } catch {""}
    const u = new URL(window.location.href);
    u.searchParams.delete(OB_TICKET_PARAM);
    window.history.replaceState({}, "", u.pathname + u.search + u.hash);

    prefillAppliedRef.current = true;
  }, [services, autoSave]);

  // ===== Verificare disponibilitate LINK (slug) =====
  useEffect(() => {
    let cancelled = false;
    async function run() {
      const checks = await Promise.all(
        debouncedServices.map(async (s) => {
          const id = s.id;
          const candidate = (s.profile?.slug || "").trim() || slugify(s.profile?.displayName || "");
          if (!candidate) return [id, { state: "idle", available: null, slug: "" }];
          try {
            const q = new URLSearchParams({
              name: candidate,
              excludeServiceId: String(id),
            }).toString();
            const d = await api(`/api/vendors/vendor-services/brand/check?${q}`);
            return [id, { state: "done", available: !!d.available, slug: d.slug, suggestion: d.suggestion || null }];
          } catch {
            return [id, { state: "error", available: null, slug: candidate }];
          }
        })
      );

      if (!cancelled) {
        const map = {};
        for (const [id, value] of checks) map[id] = value;
        setLinkAvailability(map);
      }
    }
    run();
    return () => { cancelled = true; };
  }, [debouncedServices]);

  // ===== Derived pentru butonul „Continuă” =====
  const isSavingAny = useMemo(
    () => Object.values(saveState || {}).some((s) => s === "saving"),
    [saveState]
  );
  const hasNameConflict = useMemo(
    () => Object.values(availability || {}).some((av) => av?.state === "done" && av?.available === false),
    [availability]
  );
  const hasLinkConflict = useMemo(
    () => Object.values(linkAvailability || {}).some((av) => av?.state === "done" && av?.available === false),
    [linkAvailability]
  );

  // ===== Upload helper pentru imagini =====
  async function uploadFile(file) {
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch("/api/upload", { method: "POST", body: fd, credentials: "include" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data?.message || "Upload eșuat");
    }
    const { url } = await res.json();
    return url;
  }

  // ====== FIX: definește hooks useCallback la nivelul componentei (nu în JSX) ======
  const updateProfile = useCallback(
    (idx, patch) => {
      setServices((arr) => {
        const next = [...arr];
        next[idx] = { ...next[idx], profile: { ...(next[idx].profile || {}), ...patch } };
        const serviceId = next[idx]?.id;
        if (serviceId) autoSave.saveProfile(serviceId, idx);
        return next;
      });
    },
    [autoSave]
  );

  const updateServiceBasics = useCallback(
    (idx, patch) => {
      setServices((arr) => {
        const next = [...arr];
        next[idx] = { ...next[idx], ...patch };
        const serviceId = next[idx]?.id;
        if (serviceId) autoSave.saveService(serviceId, idx);
        return next;
      });
    },
    [autoSave]
  );

  return (
    <section className={styles.wrap}>
      <nav className={styles.tabsBar} role="tablist" aria-label="Onboarding tabs">
        <button
          role="tab"
          aria-selected={activeTab==="profil"}
          className={`${styles.tab} ${activeTab==="profil" ? styles.tabActive : ""}`}
          onClick={() => setActiveTab("profil")}
          type="button"
        >Profil servicii</button>

        <button
          role="tab"
          aria-selected={activeTab==="facturare"}
          className={`${styles.tab} ${activeTab==="facturare" ? styles.tabActive : ""}`}
          onClick={() => setActiveTab("facturare")}
          type="button"
        >Date facturare</button>

        <button
          role="tab"
          aria-selected={activeTab==="plata"}
          className={`${styles.tab} ${activeTab==="plata" ? styles.tabActive : ""}`}
          onClick={() => setActiveTab("plata")}
          type="button"
        >Plată abonament</button>
      </nav>

      {activeTab === "profil" && (
        <ProfileTab
          services={services}
          availability={availability}
          linkAvailability={linkAvailability}
          vanityBase={VANITY_BASE}
          saveState={saveState}
          saveError={saveError}
          updateProfile={updateProfile}
          updateServiceBasics={updateServiceBasics}
          uploadFile={uploadFile}
          isSavingAny={isSavingAny}
          hasNameConflict={hasNameConflict || hasLinkConflict}
          onContinue={() => setActiveTab("facturare")}
          err={err}
          setErr={setErr}
        />
      )}

      {activeTab === "facturare" && (
        <BillingTab
          obSessionId={obSessionId}
          onSaved={() => setActiveTab("plata")}
          onStatusChange={setBillingStatus}
          canContinue={billingStatus === "saved"}
          onContinue={() => setActiveTab("plata")}
        />
      )}

      {activeTab === "plata" && <PaymentTab obSessionId={obSessionId} />}
    </section>
  );
}
