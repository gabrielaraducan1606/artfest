// src/pages/Vendor/Settings/SettingsPage.jsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../../lib/api";
import {
  User as UserIcon,
  Shield,
  Trash2,
  RefreshCcw,
  Loader2,
  Bell,
  Megaphone,
} from "lucide-react";
import settingsStyles from "./Settings.module.css";

import onboardingStyles from "../Onboarding/OnBoardingDetails/OnBoardingDetails.module.css";
import ProfileTab from "../Onboarding/OnBoardingDetails/tabs/ProfileTabBoarding.jsx";
import BillingTab from "../Onboarding/OnBoardingDetails/tabs/BillingTab.jsx";
import PaymentTab from "../Onboarding/OnBoardingDetails/tabs/PaymentTab.jsx";

import MarketingPreferences from "../../User/MarketingPreferences/MarketingPreferences.jsx";

const VANITY_BASE = "www.artfest.ro";
const FORGOT_PASSWORD_URL = "/reset-parola";

function cls(...xs) {
  return xs.filter(Boolean).join(" ");
}

function Section({ icon, title, subtitle, children, right }) {
  return (
    <section className={settingsStyles.card}>
      <header className={settingsStyles.cardHead}>
        <div className={settingsStyles.cardTitle}>
          {icon}
          <div>
            <div className={settingsStyles.title}>{title}</div>
            {subtitle && <div className={settingsStyles.subtitle}>{subtitle}</div>}
          </div>
        </div>
        <div>{right}</div>
      </header>
      <div className={settingsStyles.cardBody}>{children}</div>
    </section>
  );
}

/* ===========================================================
   EmbeddedOnboarding
   =========================================================== */
const slugify = (s = "") =>
  String(s)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

function EmbeddedOnboarding({ tab }) {
  const activeTab = ["profil", "facturare", "plata"].includes(tab) ? tab : "profil";

  const [services, setServices] = useState([]);
  const [err, setErr] = useState("");
  const [saveState, setSaveState] = useState({});
  const [saveError, setSaveError] = useState({});
  const [billingStatus, setBillingStatus] = useState("idle");
  const timers = useRef({});

  const fetchMyServices = useCallback(async () => {
    const d = await api("/api/vendors/me/services?includeProfile=1", { method: "GET" });

    const items = (d.items || []).map((s) => ({
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

    return items;
  }, []);

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

  return (
    <section className={onboardingStyles.wrap}>
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
          onStatusChange={setBillingStatus}
          canContinue={billingStatus === "saved"}
          onContinue={() => {}}
        />
      )}

      {activeTab === "plata" && <PaymentTab />}
    </section>
  );
}

/* ===========================================================
   SettingsPage (vendor)
   =========================================================== */
export default function SettingsPage() {
  const [loading, setLoading] = useState(true);
  const [meEmail, setMeEmail] = useState("");

  const tabs = [
    { key: "profile", label: "Profil magazin", icon: <UserIcon size={16} /> },
    { key: "notifications", label: "Notificări", icon: <Bell size={16} /> },
    { key: "marketing", label: "Marketing", icon: <Megaphone size={16} /> },
    { key: "security", label: "Securitate", icon: <Shield size={16} /> },
    { key: "billing", label: "Date facturare", icon: <UserIcon size={16} /> },
    { key: "subscription", label: "Abonament", icon: <UserIcon size={16} /> },
    { key: "danger", label: "Ștergere cont", icon: <Trash2 size={16} /> },
  ];

  const [active, setActive] = useState(() => {
    const t = new URLSearchParams(window.location.search).get("tab");
    if (t === "facturare") return "billing";
    if (t && ["profile", "notifications", "marketing", "security", "billing", "subscription", "danger"].includes(t))
      return t;
    return "profile";
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await api("/api/auth/me").catch(() => null);
      const email = d?.user?.email || d?.email || "";
      setMeEmail(email || "");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  /* ================== SECURITATE: SCHIMBĂ PAROLA ================== */
  const [oldPass, setOldPass] = useState("");
  const [newPass, setNewPass] = useState("");
  const [newPass2, setNewPass2] = useState("");
  const [savingPass, setSavingPass] = useState(false);
  const [passOk, setPassOk] = useState(false);
  const [passErr, setPassErr] = useState("");

  const MIN_LEN = 6;

  const canSavePass =
    oldPass.length > 0 &&
    newPass.length >= MIN_LEN &&
    newPass2.length >= MIN_LEN &&
    newPass === newPass2 &&
    !savingPass;

  const changePassword = useCallback(async () => {
    setPassErr("");
    setPassOk(false);

    if (newPass.length < MIN_LEN) {
      setPassErr(`Parola trebuie să aibă cel puțin ${MIN_LEN} caractere.`);
      return;
    }
    if (newPass !== newPass2) {
      setPassErr("Parolele nu se potrivesc.");
      return;
    }

    setSavingPass(true);
    try {
      await api("/api/account/change-password", {
        method: "POST",
        body: { currentPassword: oldPass, newPassword: newPass },
      });

      setPassOk(true);
      setOldPass("");
      setNewPass("");
      setNewPass2("");
    } catch (e) {
      const serverMsg =
        e?.data?.message ||
        (e?.data?.error === "invalid_current_password" && "Parola curentă nu este corectă.") ||
        (e?.data?.error === "same_as_current" && "Parola nouă nu poate fi identică cu parola curentă.") ||
        (e?.data?.error === "password_reused" && "Nu poți reutiliza una dintre ultimele parole.") ||
        e?.message ||
        "Nu am putut schimba parola.";
      setPassErr(serverMsg);
      setPassOk(false);
    } finally {
      setSavingPass(false);
    }
  }, [oldPass, newPass, newPass2]);

  /* ================== RESET PAROLĂ (trimite link pe email) ================== */
  const [fpSending, setFpSending] = useState(false);
  const [fpOk, setFpOk] = useState(false);
  const [fpErr, setFpErr] = useState("");

  const requestPasswordReset = useCallback(async () => {
    setFpErr("");
    setFpOk(false);
    setFpSending(true);
    try {
      await api("/api/vendor/settings/security/password-reset/request", {
        method: "POST",
        body: {},
      });
      setFpOk(true);
    } catch (e) {
      setFpErr(e?.data?.message || e?.message || "Nu am putut trimite linkul de resetare. Încearcă din nou.");
      setFpOk(false);
    } finally {
      setFpSending(false);
    }
  }, []);

  /* ================== SCHIMBARE EMAIL (vendor) ================== */
  const [newEmail, setNewEmail] = useState("");
  const [emailCurrentPass, setEmailCurrentPass] = useState("");
  const [emailSaving, setEmailSaving] = useState(false);
  const [emailOk, setEmailOk] = useState(false);
  const [emailErr, setEmailErr] = useState("");
  const [pendingEmailInfo, setPendingEmailInfo] = useState("");

  const canSaveEmail = newEmail.trim().length > 0 && emailCurrentPass.trim().length > 0 && !emailSaving;

  const changeEmail = useCallback(async () => {
    setEmailErr("");
    setEmailOk(false);
    setPendingEmailInfo("");

    const emailTrimmed = newEmail.trim().toLowerCase();

    if (!emailTrimmed.includes("@") || !emailTrimmed.includes(".")) {
      setEmailErr("Te rugăm să introduci un email valid.");
      return;
    }

    if (meEmail && emailTrimmed === meEmail.toLowerCase()) {
      setEmailErr("Emailul nou este identic cu cel curent.");
      return;
    }

    setEmailSaving(true);
    try {
      const d = await api("/api/vendor/settings/account/change-email", {
        method: "POST",
        body: {
          currentPassword: emailCurrentPass,
          newEmail: emailTrimmed,
        },
      });

      const pending = d?.pendingEmail || emailTrimmed;
      setPendingEmailInfo(pending);
      setNewEmail("");
      setEmailCurrentPass("");
      setEmailOk(true);
    } catch (e) {
      const msg =
        e?.data?.message ||
        (e?.data?.error === "invalid_current_password" && "Parola curentă nu este corectă.") ||
        (e?.data?.error === "email_taken" && "Există deja un cont cu acest email.") ||
        (e?.data?.error === "same_email" && "Emailul nou este identic cu cel curent.") ||
        e?.message ||
        "Nu am putut schimba emailul.";
      setEmailErr(msg);
      setEmailOk(false);
    } finally {
      setEmailSaving(false);
    }
  }, [newEmail, emailCurrentPass, meEmail]);

  /* ================== DEZACTIVARE CONT VENDOR (SAFE) ================== */
  const [deactivateSending, setDeactivateSending] = useState(false);
  const [deactivateOk, setDeactivateOk] = useState(false);
  const [deactivateErr, setDeactivateErr] = useState("");

  const onRequestDeactivateVendor = useCallback(async () => {
    setDeactivateErr("");
    setDeactivateOk(false);

    const confirmed = window.confirm(
      "Vrei să dezactivezi contul de vendor? Magazinul și produsele vor fi ascunse. Confirmarea se face prin email."
    );
    if (!confirmed) return;

    setDeactivateSending(true);
    try {
      await api("/api/vendor/settings/account/deactivate/request", {
        method: "POST",
        body: { reason: "" },
      });
      setDeactivateOk(true);
    } catch (e) {
      setDeactivateErr(e?.data?.message || e?.message || "Nu am putut trimite emailul de confirmare. Încearcă din nou.");
    } finally {
      setDeactivateSending(false);
    }
  }, []);

  return (
    <div className={settingsStyles.wrap}>
      <aside className={settingsStyles.sidebar}>
        <div className={settingsStyles.sideHead}>
          <div className={settingsStyles.sideTitle}>Setări cont</div>
          <button
            className={settingsStyles.iconBtn}
            onClick={() => {
              load();
            }}
            title="Reîncarcă"
          >
            <RefreshCcw size={16} />
          </button>
        </div>

        <nav className={settingsStyles.tabs}>
          {tabs.map((t) => (
            <button
              key={t.key}
              className={cls(settingsStyles.tab, active === t.key && settingsStyles.active)}
              onClick={() => setActive(t.key)}
            >
              {t.icon} {t.label}
            </button>
          ))}
        </nav>
      </aside>

      <main className={settingsStyles.content}>
        {loading && (
          <div className={settingsStyles.loading}>
            <Loader2 className={settingsStyles.spin} size={18} /> Se încarcă…
          </div>
        )}

        {!loading && active === "profile" && <EmbeddedOnboarding tab="profil" />}

        {/* ================== NOTIFICĂRI (informativ) ================== */}
        {!loading && active === "notifications" && (
          <Section
            icon={<Bell size={18} />}
            title="Notificări panou vendor"
            subtitle="Notificările sunt informative: îți arătăm ce evenimente importante generează alerte în Artfest. Nu e nevoie să le configurezi. Emailurile esențiale (comenzi, plăți, securitate) vor fi trimise în continuare."
          >
            <div className={settingsStyles.grid1}>
              <div className={settingsStyles.card} style={{ padding: 12 }}>
                <div className={settingsStyles.title}>Primești notificări când:</div>
                <ul style={{ margin: "10px 0 0 18px" }}>
                  <li>Ai activitate pe comenzi / rezervări (creare, confirmare, modificări, anulare, livrare).</li>
                  <li>Primești recenzii noi (magazin sau produse) și când există răspunsuri la recenzii.</li>
                  <li>Primești comentarii noi la produse și răspunsuri la comentarii.</li>
                  <li>Primești mesaje / lead-uri din conversațiile cu clienții.</li>
                  <li>Primești urmăritori noi (când e activ event-ul în sistem).</li>
                </ul>

                <div className={settingsStyles.subtitle} style={{ marginTop: 10 }}>
                  Unele notificări sunt destinate clientului (ex: facturi, livrare, suport). Pentru vendor afișăm cele
                  relevante activității magazinului.
                </div>
              </div>

              <div className={settingsStyles.card} style={{ padding: 12 }}>
                <div className={settingsStyles.title}>Detalii (mapare după backend)</div>
                <ul style={{ margin: "10px 0 0 18px" }}>
                  <li>
                    <strong>Recenzii magazin:</strong> recenzie nouă (vendor) + reply la recenzie (user) —{" "}
                    <code>/magazin/:slug#review-:id</code>
                  </li>
                  <li>
                    <strong>Recenzii produs:</strong> recenzie nouă (vendor) + reply la recenzie (user) —{" "}
                    <code>/produs/:id#review-:id</code>
                  </li>
                  <li>
                    <strong>Comentarii produs:</strong> comentariu nou (vendor) + reply la comentariu (user) —{" "}
                    <code>/produs/:id#comment-:id</code>
                  </li>
                  <li>
                    <strong>Mesaje:</strong> mesaj nou în conversație (user) — <code>/cont/mesaje?threadId=:id</code>
                  </li>
                  <li>
                    <strong>Comenzi:</strong> status actualizat (user) — <code>/comanda/:id</code>
                  </li>
                  <li>
                    <strong>Facturi / livrare:</strong> factură emisă, AWB/curier (user) — <code>/comanda/:id</code>
                  </li>
                  <li>
                    <strong>Suport:</strong> reply/status ticket (user) — <code>/account/support/tickets/:id</code>
                  </li>
                </ul>
              </div>
            </div>
          </Section>
        )}

        {!loading && active === "marketing" && <MarketingPreferences />}

        {!loading && active === "billing" && <EmbeddedOnboarding tab="facturare" />}

        {!loading && active === "subscription" && <EmbeddedOnboarding tab="plata" />}

        {/* SECURITATE */}
        {!loading && active === "security" && (
          <>
            <Section
              icon={<Shield size={18} />}
              title="Securitate – Parolă"
              subtitle="Schimbă parola sau trimite un link de resetare pe email."
              right={
                <button className={settingsStyles.primary} onClick={changePassword} disabled={!canSavePass}>
                  {savingPass ? "Se salvează…" : "Salvează parola"}
                </button>
              }
            >
              <div className={settingsStyles.grid1}>
                <label className={settingsStyles.field}>
                  <span>Parola curentă</span>
                  <input
                    className={settingsStyles.input}
                    type="password"
                    value={oldPass}
                    onChange={(e) => setOldPass(e.target.value)}
                    placeholder="Parola actuală"
                  />
                </label>

                <div className={settingsStyles.grid2}>
                  <label className={settingsStyles.field}>
                    <span>Parolă nouă</span>
                    <input
                      className={settingsStyles.input}
                      type="password"
                      value={newPass}
                      onChange={(e) => setNewPass(e.target.value)}
                      placeholder={`Cel puțin ${MIN_LEN} caractere`}
                    />
                  </label>

                  <label className={settingsStyles.field}>
                    <span>Confirmă parola nouă</span>
                    <input
                      className={settingsStyles.input}
                      type="password"
                      value={newPass2}
                      onChange={(e) => setNewPass2(e.target.value)}
                      placeholder="Repetă parola nouă"
                    />
                  </label>
                </div>

                {newPass && newPass.length < MIN_LEN && (
                  <div className={settingsStyles.warn}>Parola trebuie să aibă cel puțin {MIN_LEN} caractere.</div>
                )}

                {newPass2 && newPass && newPass !== newPass2 && (
                  <div className={settingsStyles.warn}>Parolele nu se potrivesc.</div>
                )}

                {passErr && (
                  <div className={settingsStyles.error} role="alert">
                    {passErr}
                  </div>
                )}
                {passOk && <div className={settingsStyles.success}>✅ Parola a fost schimbată cu succes.</div>}

                {/* reset password row */}
                <div className={settingsStyles.fpBox}>
                  <div>
                    <div className={settingsStyles.fpTitle}>Ai uitat parola?</div>
                    <div className={settingsStyles.subtitle}>Trimitem un link de resetare pe emailul contului tău.</div>
                  </div>

                  <button
                    type="button"
                    className={settingsStyles.fpBtn}
                    onClick={requestPasswordReset}
                    disabled={fpSending}
                  >
                    {fpSending ? "Se trimite…" : "Trimite link de resetare"}
                  </button>
                </div>

                {fpOk && (
                  <div className={settingsStyles.success}>
                    ✅ Ți-am trimis un email cu linkul de resetare. Verifică Inbox / Spam.
                  </div>
                )}

                {fpErr && (
                  <div className={settingsStyles.error} role="alert">
                    {fpErr}
                  </div>
                )}

                <a href={FORGOT_PASSWORD_URL} className={settingsStyles.fpLink}>
                  Am uitat parola
                </a>
              </div>
            </Section>

            <Section
              icon={<UserIcon size={18} />}
              title="Email de conectare"
              subtitle="Schimbă adresa de email folosită pentru login. Confirmarea se face prin email."
              right={
                <button className={settingsStyles.primary} onClick={changeEmail} disabled={!canSaveEmail}>
                  {emailSaving ? "Se salvează…" : "Salvează emailul"}
                </button>
              }
            >
              <div className={settingsStyles.grid1}>
                <label className={settingsStyles.field}>
                  <span>Email curent</span>
                  <input className={settingsStyles.input} type="email" value={meEmail || ""} disabled />
                </label>

                <label className={settingsStyles.field}>
                  <span>Email nou</span>
                  <input
                    className={settingsStyles.input}
                    type="email"
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                    placeholder="exemplu@domeniu.ro"
                  />
                </label>

                <label className={settingsStyles.field}>
                  <span>Parola curentă</span>
                  <input
                    className={settingsStyles.input}
                    type="password"
                    value={emailCurrentPass}
                    onChange={(e) => setEmailCurrentPass(e.target.value)}
                    placeholder="Introdu parola pentru confirmare"
                  />
                </label>

                {emailErr && (
                  <div className={settingsStyles.error} role="alert">
                    {emailErr}
                  </div>
                )}

                {emailOk && (
                  <div className={settingsStyles.success}>
                    ✅ Ți-am trimis un email de confirmare la <strong>{pendingEmailInfo}</strong>. Accesează linkul din
                    email pentru a finaliza schimbarea.
                  </div>
                )}
              </div>
            </Section>
          </>
        )}

        {/* ZONĂ PERICULOASĂ */}
        {!loading && active === "danger" && (
          <Section icon={<Trash2 size={18} />} title="Zonă periculoasă" subtitle="Acțiuni ireversibile (safe)">
            <div className={settingsStyles.danger}>
              <div>
                <div className={settingsStyles.title}>Dezactivează cont vendor (safe)</div>
                <div className={settingsStyles.subtitle}>
                  Magazinul și produsele vor fi ascunse. Datele sensibile (facturi, comenzi, billing) rămân în sistem
                  pentru conformitate/audit. Confirmarea se face prin email.
                </div>
              </div>

              <button
                type="button"
                className={settingsStyles.dangerBtn}
                onClick={onRequestDeactivateVendor}
                disabled={deactivateSending}
              >
                {deactivateSending ? "Se trimite…" : "Trimite email de confirmare"}
              </button>
            </div>

            {deactivateOk && (
              <div className={settingsStyles.success} style={{ marginTop: 12 }}>
                ✅ Ți-am trimis un email cu linkul de confirmare. Verifică Inbox / Spam.
              </div>
            )}

            {deactivateErr && (
              <div className={settingsStyles.error} role="alert" style={{ marginTop: 12 }}>
                {deactivateErr}
              </div>
            )}
          </Section>
        )}
      </main>
    </div>
  );
}
