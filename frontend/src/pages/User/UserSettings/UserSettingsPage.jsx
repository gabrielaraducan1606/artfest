// src/pages/Account/UserSettingsPage.jsx
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  User as UserIcon,
  Shield,
  Trash2,
  Bell,
  RefreshCcw,
  Loader2,
  Megaphone,
  Landmark,
} from "lucide-react";

import { api } from "../../../lib/api";
import { useAuth } from "../../Auth/Context/context.js";
import settingsStyles from "./UserSettingsPage.module.css";
import MarketingPreferences from "../MarketingPreferences/MarketingPreferences.jsx";
import InfluencerPayoutProfileSettings from "./InfluencerPayoutProfileSettings.jsx";

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

export default function UserSettingsPage() {
  const [loading, setLoading] = useState(true);

  /*
   * Rol curent - DOAR pentru a decide dacă tab-ul „Fiscalizare &
   * plăți” e vizibil (influencer). Reutilizăm useAuth() (același
   * context global, alimentat de GET /api/auth/me) în loc să facem
   * un fetch separat - nu atingem `load()`/`loading` de mai jos,
   * care rămân exact cum erau pentru restul paginii (profil/
   * parolă/email/ștergere cont, neschimbate pentru USER).
   */
  const { me } = useAuth();
  const isInfluencer = me?.role === "INFLUENCER";

  /*
   * Ordinea cerută explicit: Profil, Notificări, Marketing,
   * Securitate, [Fiscalizare & plăți - doar influencer], Ștergere
   * cont (mereu ultimul).
   */
  const tabs = useMemo(() => {
    const list = [
      { key: "profile", label: "Profil", icon: <UserIcon size={16} /> },
      { key: "notifications", label: "Notificări", icon: <Bell size={16} /> },
      { key: "marketing", label: "Marketing", icon: <Megaphone size={16} /> },
      { key: "security", label: "Securitate", icon: <Shield size={16} /> },
    ];

    if (isInfluencer) {
      list.push({
        key: "fiscalizare",
        label: "Fiscalizare & plăți",
        icon: <Landmark size={16} />,
      });
    }

    list.push({ key: "danger", label: "Ștergere cont", icon: <Trash2 size={16} /> });

    return list;
  }, [isInfluencer]);

  const [active, setActive] = useState("profile");

  /*
   * Deep-link: /cont/setari?tab=fiscalizare (folosit de CTA-ul din
   * reminder-ul dashboard-ului de influencer). Validăm STRICT
   * împotriva `tabs` (care deja exclude "fiscalizare" pentru
   * non-influenceri) - un USER care ar accesa direct acest URL
   * rămâne pe tab-ul implicit "profile" (fallback sigur), nu
   * primește niciodată formularul fiscal.
   */
  const [searchParams] = useSearchParams();

  useEffect(() => {
    const tab = searchParams.get("tab");

    if (tab && tabs.some((t) => t.key === tab)) {
      setActive(tab);
    }
  }, [searchParams, tabs]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      await api("/api/auth/me").catch(() => null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  /* ================== PROFIL USER ================== */
  const [profile, setProfile] = useState({
    email: "",
    firstName: "",
    lastName: "",
    avatarUrl: "",
    phone: "",
    city: "",
  });
  const [profileInitial, setProfileInitial] = useState(null);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileErr, setProfileErr] = useState("");
  const [profileOk, setProfileOk] = useState(false);

  const canSaveProfile =
    !profileSaving &&
    profileInitial &&
    JSON.stringify(profile) !== JSON.stringify(profileInitial);

  const loadProfile = useCallback(async () => {
    try {
      const d = await api("/api/account/me/profile", { method: "GET" });
      const u = d.user || {};
      const next = {
        email: u.email || "",
        firstName: u.firstName || "",
        lastName: u.lastName || "",
        avatarUrl: u.avatarUrl || "",
        phone: u.phone || "",
        city: u.city || "",
      };
      setProfile(next);
      setProfileInitial(next);
      setProfileErr("");
      setProfileOk(false);
    } catch (e) {
      setProfileErr(e?.message || "Nu am putut încărca datele de profil. Încearcă din nou.");
    }
  }, []);

  const saveProfile = useCallback(async () => {
    setProfileErr("");
    setProfileOk(false);
    setProfileSaving(true);
    try {
      const payload = {
        firstName: profile.firstName,
        lastName: profile.lastName,
        avatarUrl: profile.avatarUrl,
        phone: profile.phone,
        city: profile.city,
      };
      const d = await api("/api/account/me/profile", {
        method: "PATCH",
        body: payload,
      });
      const u = d.user || {};
      const next = {
        email: u.email || profile.email,
        firstName: u.firstName || "",
        lastName: u.lastName || "",
        avatarUrl: u.avatarUrl || "",
        phone: u.phone || "",
        city: u.city || "",
      };
      setProfile(next);
      setProfileInitial(next);
      setProfileOk(true);
    } catch (e) {
      setProfileErr(
        e?.data?.message ||
          e?.message ||
          "Nu am putut salva profilul. Te rugăm să încerci din nou."
      );
      setProfileOk(false);
    } finally {
      setProfileSaving(false);
    }
  }, [profile]);

  const uploadAvatar = useCallback(async (file) => {
    const fd = new FormData();
    fd.append("file", file);
    const d = await api("/api/upload", { method: "POST", body: fd });
    if (!d?.url) throw new Error("Upload eșuat");
    setProfile((p) => ({ ...p, avatarUrl: d.url }));
  }, []);

  /* ================== LOAD PROFILE DUPĂ AUTH ================== */
  useEffect(() => {
    if (!loading) {
      loadProfile();
    }
  }, [loading, loadProfile]);

  /* ================== PROFIL PUBLIC INFLUENCER ==================
     SEPARAT de profilul de mai sus: `displayName`/linkurile social
     vin din InfluencerProfile (GET /api/influencer/me, PATCH
     /api/influencer/profile), nu din User - nu se amestecă cu
     firstName/lastName/phone/city de mai sus. Doar pentru influencer.
  ================================================================== */
  const [influencerProfile, setInfluencerProfile] = useState({
    displayName: "",
    instagramUrl: "",
    tiktokUrl: "",
    facebookUrl: "",
    websiteUrl: "",
  });
  const [influencerProfileInitial, setInfluencerProfileInitial] = useState(null);
  const [influencerProfileLoading, setInfluencerProfileLoading] = useState(false);
  const [influencerProfileSaving, setInfluencerProfileSaving] = useState(false);
  const [influencerProfileErr, setInfluencerProfileErr] = useState("");
  const [influencerProfileOk, setInfluencerProfileOk] = useState(false);

  const canSaveInfluencerProfile =
    !influencerProfileSaving &&
    influencerProfileInitial &&
    JSON.stringify(influencerProfile) !== JSON.stringify(influencerProfileInitial);

  const loadInfluencerProfile = useCallback(async () => {
    setInfluencerProfileLoading(true);
    setInfluencerProfileErr("");
    try {
      const d = await api("/api/influencer/me", { method: "GET" });
      const p = d?.profile || {};
      const next = {
        displayName: p.displayName || "",
        instagramUrl: p.instagramUrl || "",
        tiktokUrl: p.tiktokUrl || "",
        facebookUrl: p.facebookUrl || "",
        websiteUrl: p.websiteUrl || "",
      };
      setInfluencerProfile(next);
      setInfluencerProfileInitial(next);
    } catch (e) {
      setInfluencerProfileErr(
        e?.data?.message ||
          e?.message ||
          "Nu am putut încărca profilul public de influencer."
      );
    } finally {
      setInfluencerProfileLoading(false);
    }
  }, []);

  const saveInfluencerProfile = useCallback(async () => {
    setInfluencerProfileErr("");
    setInfluencerProfileOk(false);
    setInfluencerProfileSaving(true);
    try {
      const payload = {
        displayName: influencerProfile.displayName.trim(),
        instagramUrl: influencerProfile.instagramUrl.trim(),
        tiktokUrl: influencerProfile.tiktokUrl.trim(),
        facebookUrl: influencerProfile.facebookUrl.trim(),
        websiteUrl: influencerProfile.websiteUrl.trim(),
      };
      const d = await api("/api/influencer/profile", {
        method: "PATCH",
        body: payload,
      });
      const p = d?.profile || {};
      const next = {
        displayName: p.displayName || "",
        instagramUrl: p.instagramUrl || "",
        tiktokUrl: p.tiktokUrl || "",
        facebookUrl: p.facebookUrl || "",
        websiteUrl: p.websiteUrl || "",
      };
      setInfluencerProfile(next);
      setInfluencerProfileInitial(next);
      setInfluencerProfileOk(true);
    } catch (e) {
      setInfluencerProfileErr(
        e?.data?.message ||
          e?.message ||
          "Nu am putut salva profilul public de influencer."
      );
    } finally {
      setInfluencerProfileSaving(false);
    }
  }, [influencerProfile]);

  useEffect(() => {
    if (!loading && isInfluencer) {
      loadInfluencerProfile();
    }
  }, [loading, isInfluencer, loadInfluencerProfile]);

  /* ================== NOTIFICĂRI ==================
     GET/PATCH /api/account/me/notifications - EXACT cele 3
     preferințe suportate de model (User.preferences.notifications),
     fără categorii inventate.
  ================================================== */
  const [notifPrefs, setNotifPrefs] = useState({
    inAppMessageNew: true,
    inAppBookingUpdates: true,
    inAppEventReminders: true,
  });
  const [notifInitial, setNotifInitial] = useState(null);
  const [notifLoading, setNotifLoading] = useState(true);
  const [notifSaving, setNotifSaving] = useState(false);
  const [notifErr, setNotifErr] = useState("");
  const [notifOk, setNotifOk] = useState(false);

  const canSaveNotif =
    !notifSaving &&
    notifInitial &&
    JSON.stringify(notifPrefs) !== JSON.stringify(notifInitial);

  const loadNotifPrefs = useCallback(async () => {
    setNotifLoading(true);
    setNotifErr("");
    try {
      const d = await api("/api/account/me/notifications", { method: "GET" });
      const n = d?.notifications || {};
      const next = {
        inAppMessageNew: n.inAppMessageNew ?? true,
        inAppBookingUpdates: n.inAppBookingUpdates ?? true,
        inAppEventReminders: n.inAppEventReminders ?? true,
      };
      setNotifPrefs(next);
      setNotifInitial(next);
    } catch (e) {
      setNotifErr(
        e?.data?.message ||
          e?.message ||
          "Nu am putut încărca preferințele de notificări."
      );
    } finally {
      setNotifLoading(false);
    }
  }, []);

  const saveNotifPrefs = useCallback(async () => {
    setNotifErr("");
    setNotifOk(false);
    setNotifSaving(true);
    try {
      const d = await api("/api/account/me/notifications", {
        method: "PATCH",
        body: { notifications: notifPrefs },
      });
      const next = d?.notifications || notifPrefs;
      setNotifPrefs(next);
      setNotifInitial(next);
      setNotifOk(true);
    } catch (e) {
      setNotifErr(
        e?.data?.message ||
          e?.message ||
          "Nu am putut salva preferințele de notificări."
      );
    } finally {
      setNotifSaving(false);
    }
  }, [notifPrefs]);

  useEffect(() => {
    if (!loading) {
      loadNotifPrefs();
    }
  }, [loading, loadNotifPrefs]);

  /* ================== SECURITATE: PAROLĂ ================== */
  const [oldPass, setOldPass] = useState("");
  const [newPass, setNewPass] = useState("");
  const [newPass2, setNewPass2] = useState("");
  const [savingPass, setSavingPass] = useState(false);
  const [passOk, setPassOk] = useState(false);
  const [passErr, setPassErr] = useState("");
  const [passErrCode, setPassErrCode] = useState("");

  const MIN_LEN = 8;

  // scor de complexitate 0..5
  const passScore = useMemo(() => {
    const len = newPass.length >= MIN_LEN ? 1 : 0;
    const lower = /[a-z]/.test(newPass) ? 1 : 0;
    const upper = /[A-Z]/.test(newPass) ? 1 : 0;
    const digit = /\d/.test(newPass) ? 1 : 0;
    const symbol = /[^A-Za-z0-9]/.test(newPass) ? 1 : 0;
    return len + lower + upper + digit + symbol;
  }, [newPass]);

  const [capsOnPass, setCapsOnPass] = useState(false);
  const [passFocused, setPassFocused] = useState(false);

  const canSavePass =
    oldPass.length > 0 &&
    newPass.length >= MIN_LEN &&
    newPass2.length >= MIN_LEN &&
    newPass === newPass2 &&
    passScore >= 3 &&
    !savingPass;

  function handleNewPassKey(ev) {
    try {
      setCapsOnPass(!!ev.getModifierState?.("CapsLock"));
    } catch {
      // ignorăm
    }
  }

  const changePassword = useCallback(async () => {
    setPassErr("");
    setPassOk(false);
    setPassErrCode("");

    if (newPass.length < MIN_LEN) {
      setPassErr(`Parola trebuie să aibă cel puțin ${MIN_LEN} caractere.`);
      return;
    }
    if (newPass !== newPass2) {
      setPassErr("Parolele nu se potrivesc.");
      return;
    }
    if (passScore < 3) {
      setPassErr("Parola este prea slabă. Folosește o combinație de litere mari/mici, cifre și simboluri.");
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
      const code = e?.data?.error || "";
      setPassErrCode(code);

      const serverMsg =
        e?.data?.message ||
        (code === "invalid_current_password" && "Parola curentă nu este corectă.") ||
        (code === "same_as_current" && "Parola nouă nu poate fi identică cu parola curentă.") ||
        (code === "password_reused" && "Nu poți reutiliza una dintre ultimele parole.") ||
        (code === "weak_password" &&
          "Parola este prea slabă. Te rugăm să folosești o combinație de litere mari/mici, cifre și simboluri.") ||
        e?.message ||
        "Nu am putut schimba parola.";
      setPassErr(serverMsg);
      setPassOk(false);
    } finally {
      setSavingPass(false);
    }
  }, [oldPass, newPass, newPass2, passScore]);

  /* ================== SECURITATE: EMAIL ================== */
  const [newEmail, setNewEmail] = useState("");
  const [emailCurrentPass, setEmailCurrentPass] = useState("");
  const [emailSaving, setEmailSaving] = useState(false);
  const [emailOk, setEmailOk] = useState(false);
  const [emailErr, setEmailErr] = useState("");
  const [pendingEmailInfo, setPendingEmailInfo] = useState("");

  const canSaveEmail =
    newEmail.trim().length > 0 &&
    emailCurrentPass.trim().length > 0 &&
    !emailSaving;

  const changeEmail = useCallback(() => {
    (async () => {
      setEmailErr("");
      setEmailOk(false);
      setPendingEmailInfo("");

      const emailTrimmed = newEmail.trim().toLowerCase();

      if (!emailTrimmed.includes("@") || !emailTrimmed.includes(".")) {
        setEmailErr("Te rugăm să introduci un email valid.");
        return;
      }

      if (emailTrimmed === (profile.email || "").toLowerCase()) {
        setEmailErr("Emailul nou este identic cu cel curent.");
        return;
      }

      setEmailSaving(true);
      try {
        const d = await api("/api/account/change-email", {
          method: "POST",
          body: {
            currentPassword: emailCurrentPass,
            newEmail: emailTrimmed,
          },
        });

        const pending = d.pendingEmail || emailTrimmed;

        // nu schimbăm încă email-ul în profil; așteptăm confirmarea din email
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
    })();
  }, [newEmail, emailCurrentPass, profile.email]);

  /* ================== ȘTERGERE CONT ================== */
  const [deleting, setDeleting] = useState(false);
  const [deleteErr, setDeleteErr] = useState("");

  const onDeleteAccount = useCallback(async () => {
    setDeleteErr("");

    const confirmed = window.confirm(
      "Ești sigur(ă) că vrei să ștergi contul? Această acțiune este ireversibilă."
    );
    if (!confirmed) return;

    setDeleting(true);
    try {
      await api("/api/account/me", {
        method: "DELETE",
      });

      window.location.href = "/";
    } catch (e) {
      const msg =
        e?.data?.message ||
        e?.message ||
        "Nu am putut șterge contul. Te rugăm să încerci din nou.";
      setDeleteErr(msg);
      setDeleting(false);
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
              loadProfile();
              loadNotifPrefs();
              if (isInfluencer) loadInfluencerProfile();
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

        {/* PROFIL */}
        {!loading && active === "profile" && (
          <Section
            icon={<UserIcon size={18} />}
            title="Date personale"
            subtitle="Datele tale de bază"
            right={
              <button className={settingsStyles.primary} onClick={saveProfile} disabled={!canSaveProfile}>
                {profileSaving ? "Se salvează…" : "Salvează profilul"}
              </button>
            }
          >
            <div className={settingsStyles.grid1}>
              <label className={settingsStyles.field}>
                <span>Email (nu se poate modifica aici)</span>
                <input className={settingsStyles.input} type="email" value={profile.email} disabled />

                <p className={settingsStyles.helperText}>
                  Adresa de email folosită la conectare se poate schimba din tabul{" "}
                  <button
                    type="button"
                    className={settingsStyles.linkButton}
                    onClick={() => setActive("security")}
                  >
                    „Securitate”
                  </button>
                  .
                </p>
              </label>

              <div className={settingsStyles.grid2}>
                <label className={settingsStyles.field}>
                  <span>Prenume</span>
                  <input
                    className={settingsStyles.input}
                    type="text"
                    value={profile.firstName}
                    onChange={(e) => setProfile((p) => ({ ...p, firstName: e.target.value }))}
                    placeholder="Ex: Andreea"
                  />
                </label>

                <label className={settingsStyles.field}>
                  <span>Nume</span>
                  <input
                    className={settingsStyles.input}
                    type="text"
                    value={profile.lastName}
                    onChange={(e) => setProfile((p) => ({ ...p, lastName: e.target.value }))}
                    placeholder="Ex: Popescu"
                  />
                </label>
              </div>

              <div className={settingsStyles.grid2}>
                <label className={settingsStyles.field}>
                  <span>Telefon</span>
                  <input
                    className={settingsStyles.input}
                    type="tel"
                    value={profile.phone}
                    onChange={(e) => setProfile((p) => ({ ...p, phone: e.target.value }))}
                    placeholder="Ex: 07xx xxx xxx"
                  />
                </label>

                <label className={settingsStyles.field}>
                  <span>Oraș</span>
                  <input
                    className={settingsStyles.input}
                    type="text"
                    value={profile.city}
                    onChange={(e) => setProfile((p) => ({ ...p, city: e.target.value }))}
                    placeholder="Ex: București"
                  />
                </label>
              </div>

              <label className={settingsStyles.field}>
                <span>Poză profil</span>
                <div className={settingsStyles.avatarRow}>
                  {profile.avatarUrl && (
                    <img src={profile.avatarUrl} alt="Avatar" className={settingsStyles.avatar} />
                  )}
                  <input
                    className={settingsStyles.input}
                    type="url"
                    value={profile.avatarUrl}
                    onChange={(e) => setProfile((p) => ({ ...p, avatarUrl: e.target.value }))}
                    placeholder="https://..."
                  />
                  <input
                    type="file"
                    accept="image/*"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        try {
                          await uploadAvatar(file);
                        } catch (err) {
                          setProfileErr(err?.message || "Nu am putut încărca imaginea.");
                        }
                      }
                    }}
                  />
                </div>
              </label>

              {profileErr && (
                <div className={settingsStyles.error} role="alert">
                  {profileErr}
                </div>
              )}
              {profileOk && <div className={settingsStyles.success}>✅ Profilul a fost actualizat.</div>}
            </div>
          </Section>
        )}

        {/* ================== PROFIL PUBLIC INFLUENCER (doar influencer) ================== */}
        {!loading && active === "profile" && isInfluencer && (
          <Section
            icon={<UserIcon size={18} />}
            title="Profil public influencer"
            subtitle="Numele afișat și linkurile social folosite în Programul de Influenceri. Separat de datele fiscale/de plată, care rămân în tabul „Fiscalizare & plăți”."
            right={
              <button
                className={settingsStyles.primary}
                onClick={saveInfluencerProfile}
                disabled={!canSaveInfluencerProfile}
              >
                {influencerProfileSaving ? "Se salvează…" : "Salvează profilul de influencer"}
              </button>
            }
          >
            {influencerProfileLoading ? (
              <div className={settingsStyles.loading}>
                <Loader2 className={settingsStyles.spin} size={18} /> Se încarcă…
              </div>
            ) : (
              <div className={settingsStyles.grid1}>
                <label className={settingsStyles.field}>
                  <span>Nume afișat</span>
                  <input
                    className={settingsStyles.input}
                    type="text"
                    value={influencerProfile.displayName}
                    onChange={(e) =>
                      setInfluencerProfile((p) => ({ ...p, displayName: e.target.value }))
                    }
                    placeholder="Numele afișat public ca influencer"
                  />
                </label>

                <div className={settingsStyles.grid2}>
                  <label className={settingsStyles.field}>
                    <span>Instagram</span>
                    <input
                      className={settingsStyles.input}
                      type="url"
                      value={influencerProfile.instagramUrl}
                      onChange={(e) =>
                        setInfluencerProfile((p) => ({ ...p, instagramUrl: e.target.value }))
                      }
                      placeholder="https://instagram.com/..."
                    />
                  </label>

                  <label className={settingsStyles.field}>
                    <span>TikTok</span>
                    <input
                      className={settingsStyles.input}
                      type="url"
                      value={influencerProfile.tiktokUrl}
                      onChange={(e) =>
                        setInfluencerProfile((p) => ({ ...p, tiktokUrl: e.target.value }))
                      }
                      placeholder="https://tiktok.com/@..."
                    />
                  </label>
                </div>

                <div className={settingsStyles.grid2}>
                  <label className={settingsStyles.field}>
                    <span>Facebook</span>
                    <input
                      className={settingsStyles.input}
                      type="url"
                      value={influencerProfile.facebookUrl}
                      onChange={(e) =>
                        setInfluencerProfile((p) => ({ ...p, facebookUrl: e.target.value }))
                      }
                      placeholder="https://facebook.com/..."
                    />
                  </label>

                  <label className={settingsStyles.field}>
                    <span>Website</span>
                    <input
                      className={settingsStyles.input}
                      type="url"
                      value={influencerProfile.websiteUrl}
                      onChange={(e) =>
                        setInfluencerProfile((p) => ({ ...p, websiteUrl: e.target.value }))
                      }
                      placeholder="https://..."
                    />
                  </label>
                </div>

                {influencerProfileErr && (
                  <div className={settingsStyles.error} role="alert">
                    {influencerProfileErr}
                  </div>
                )}
                {influencerProfileOk && (
                  <div className={settingsStyles.success}>
                    ✅ Profilul de influencer a fost actualizat.
                  </div>
                )}
              </div>
            )}
          </Section>
        )}

        {/* ================== NOTIFICĂRI ================== */}
        {!loading && active === "notifications" && (
          <Section
            icon={<Bell size={18} />}
            title="Notificări în aplicație"
            subtitle="Alege ce notificări în aplicație vrei să primești. Emailurile esențiale (comenzi, plăți, securitate) sunt trimise în continuare, indiferent de aceste preferințe."
            right={
              <button
                className={settingsStyles.primary}
                onClick={saveNotifPrefs}
                disabled={!canSaveNotif}
              >
                {notifSaving ? "Se salvează…" : "Salvează preferințele"}
              </button>
            }
          >
            {notifLoading ? (
              <div className={settingsStyles.loading}>
                <Loader2 className={settingsStyles.spin} size={18} /> Se încarcă…
              </div>
            ) : (
              <div className={settingsStyles.grid1}>
                <label className={settingsStyles.checkboxRow}>
                  <input
                    type="checkbox"
                    checked={notifPrefs.inAppMessageNew}
                    onChange={(e) =>
                      setNotifPrefs((p) => ({ ...p, inAppMessageNew: e.target.checked }))
                    }
                  />
                  <span>Mesaje noi de la magazine (conversații)</span>
                </label>

                <label className={settingsStyles.checkboxRow}>
                  <input
                    type="checkbox"
                    checked={notifPrefs.inAppBookingUpdates}
                    onChange={(e) =>
                      setNotifPrefs((p) => ({ ...p, inAppBookingUpdates: e.target.checked }))
                    }
                  />
                  <span>Actualizări comandă (confirmare, pregătire, livrare, anulare)</span>
                </label>

                <label
                  className={settingsStyles.checkboxRow}
                  style={{ opacity: 0.6 }}
                  title="Această funcționalitate nu este încă disponibilă - preferința nu are niciun efect momentan."
                >
                  <input
                    type="checkbox"
                    checked={notifPrefs.inAppEventReminders}
                    disabled
                    readOnly
                  />
                  <span>Mementouri evenimente (în curând)</span>
                </label>

                <div className={settingsStyles.subtitle} style={{ marginTop: 4 }}>
                  Preferințele de marketing (promoții, recomandări) se gestionează separat în tab-ul „Marketing”.
                </div>

                {notifErr && (
                  <div className={settingsStyles.error} role="alert">
                    {notifErr}
                  </div>
                )}
                {notifOk && (
                  <div className={settingsStyles.success}>
                    ✅ Preferințele de notificări au fost salvate.
                  </div>
                )}
              </div>
            )}
          </Section>
        )}

        {/* MARKETING */}
        {!loading && active === "marketing" && <MarketingPreferences />}

        {/* SECURITATE: PAROLĂ + EMAIL */}
        {!loading && active === "security" && (
          <>
            <Section
              icon={<Shield size={18} />}
              title="Securitate – parolă"
              subtitle="Schimbă parola contului tău"
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
                      onKeyUp={handleNewPassKey}
                      onKeyDown={handleNewPassKey}
                      onFocus={() => setPassFocused(true)}
                      onBlur={() => setPassFocused(false)}
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

                {newPass && (
                  <div style={{ marginTop: 4, fontSize: 12, color: "#6b7280" }}>
                    Complexitate parolă:{" "}
                    {passScore <= 2 ? "slabă" : passScore === 3 ? "medie" : "puternică"}. Recomandat: litere mari/mici,
                    cifre și simboluri.
                  </div>
                )}

                {capsOnPass && passFocused && (
                  <div className={settingsStyles.warn}>CapsLock este activ – ai grijă la literele mari.</div>
                )}

                {passErr && (
                  <div className={settingsStyles.error} role="alert">
                    {passErr}
                  </div>
                )}

                {passErrCode === "invalid_current_password" && (
                  <div className={settingsStyles.helperText}>
                    Dacă nu îți amintești parola curentă, poți folosi opțiunea{" "}
                    <a href={FORGOT_PASSWORD_URL} className={settingsStyles.link}>
                      „Am uitat parola”
                    </a>
                    .
                  </div>
                )}

                {passOk && <div className={settingsStyles.success}>✅ Parola a fost schimbată cu succes.</div>}

                <div style={{ marginTop: 12 }}>
                  <a href={FORGOT_PASSWORD_URL} className={settingsStyles.link}>
                    Am uitat parola veche
                  </a>
                </div>
              </div>
            </Section>

            <Section
              icon={<UserIcon size={18} />}
              title="Email de conectare"
              subtitle="Schimbă adresa de email folosită pentru login. Pentru siguranță, este nevoie de parola curentă."
              right={
                <button className={settingsStyles.primary} onClick={changeEmail} disabled={!canSaveEmail}>
                  {emailSaving ? "Se salvează…" : "Salvează emailul"}
                </button>
              }
            >
              <div className={settingsStyles.grid1}>
                <label className={settingsStyles.field}>
                  <span>Email curent</span>
                  <input className={settingsStyles.input} type="email" value={profile.email} disabled />
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
                    ✅ Ți-am trimis un email de confirmare la <strong>{pendingEmailInfo}</strong>. Te rugăm să accesezi
                    linkul din acel email pentru a finaliza schimbarea adresei de email.
                  </div>
                )}
              </div>
            </Section>
          </>
        )}

        {/* ================== FISCALIZARE & PLĂȚI (doar influencer) ================== */}
        {!loading && active === "fiscalizare" && isInfluencer && (
          <InfluencerPayoutProfileSettings />
        )}

        {/* ȘTERGERE CONT */}
        {!loading && active === "danger" && (
          <Section icon={<Trash2 size={18} />} title="Zonă periculoasă" subtitle="Acțiuni ireversibile">
            <div className={settingsStyles.danger}>
              <div>
                <div className={settingsStyles.title}>Ștergere cont</div>
                <div className={settingsStyles.subtitle}>
                  Această acțiune nu poate fi anulată. Profilul, fișierele personale și datele de autentificare vor
                  fi șterse sau anonimizate. Datele financiar-contabile (facturi, plăți, câștiguri) și dovezile de
                  acceptare a documentelor legale pot fi păstrate pentru perioada impusă de lege.
                </div>
              </div>

              <button
                type="button"
                className={settingsStyles.dangerBtn}
                onClick={onDeleteAccount}
                disabled={deleting}
              >
                {deleting ? "Se șterge…" : "Șterge contul"}
              </button>
            </div>

            {deleteErr && (
              <div className={settingsStyles.error} role="alert" style={{ marginTop: 12 }}>
                {deleteErr}
              </div>
            )}
          </Section>
        )}
      </main>
    </div>
  );
}
