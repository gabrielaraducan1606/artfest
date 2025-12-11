// src/pages/Account/UserSettingsPage.jsx
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  User as UserIcon,
  Shield,
  Trash2,
  Bell,
  RefreshCcw,
  Loader2,
  Megaphone,
} from "lucide-react";

import { api } from "../../../lib/api";
import settingsStyles from "./UserSettingsPage.module.css";
import MarketingPreferences from "../MarketingPreferences/MarketingPreferences.jsx";

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
            {subtitle && (
              <div className={settingsStyles.subtitle}>{subtitle}</div>
            )}
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

  const tabs = [
    { key: "profile", label: "Profil", icon: <UserIcon size={16} /> },
    { key: "notifications", label: "Notificări", icon: <Bell size={16} /> },
    { key: "marketing", label: "Marketing", icon: <Megaphone size={16} /> },
    { key: "security", label: "Securitate", icon: <Shield size={16} /> },
    { key: "danger", label: "Ștergere cont", icon: <Trash2 size={16} /> },
  ];

  const [active, setActive] = useState("profile");

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
      };
      setProfile(next);
      setProfileInitial(next);
      setProfileErr("");
      setProfileOk(false);
    } catch (e) {
      setProfileErr(
        e?.message || "Nu am putut încărca datele de profil. Încearcă din nou."
      );
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

  /* ================== NOTIFICĂRI (in-app) ================== */
  const [notifications, setNotifications] = useState({
    inAppMessageNew: true,
    inAppBookingUpdates: true,
    inAppEventReminders: true,
  });
  const [notifInitial, setNotifInitial] = useState(null);
  const [notifSaving, setNotifSaving] = useState(false);
  const [notifErr, setNotifErr] = useState("");
  const [notifOk, setNotifOk] = useState(false);

  const canSaveNotifications =
    !notifSaving &&
    notifInitial &&
    JSON.stringify(notifications) !== JSON.stringify(notifInitial);

  const loadNotifications = useCallback(async () => {
    try {
      const d = await api("/api/account/me/notifications", { method: "GET" });
      const n = d.notifications || {};
      const next = {
        inAppMessageNew:
          typeof n.inAppMessageNew === "boolean" ? n.inAppMessageNew : true,
        inAppBookingUpdates:
          typeof n.inAppBookingUpdates === "boolean"
            ? n.inAppBookingUpdates
            : true,
        inAppEventReminders:
          typeof n.inAppEventReminders === "boolean"
            ? n.inAppEventReminders
            : true,
      };
      setNotifications(next);
      setNotifInitial(next);
      setNotifErr("");
      setNotifOk(false);
    } catch (e) {
      setNotifErr(
        e?.message ||
          "Nu am putut încărca preferințele de notificare. Încearcă din nou."
      );
    }
  }, []);

  const saveNotifications = useCallback(async () => {
    setNotifErr("");
    setNotifOk(false);
    setNotifSaving(true);
    try {
      const d = await api("/api/account/me/notifications", {
        method: "PATCH",
        body: { notifications },
      });
      const next = d.notifications || notifications;
      setNotifications(next);
      setNotifInitial(next);
      setNotifOk(true);
    } catch (e) {
      setNotifErr(
        e?.data?.message ||
          e?.message ||
          "Nu am putut salva notificările. Te rugăm să încerci din nou."
      );
      setNotifOk(false);
    } finally {
      setNotifSaving(false);
    }
  }, [notifications]);

  /* ================== LOAD PROFILE + NOTIFICATIONS DUPĂ AUTH ================== */

  useEffect(() => {
    if (!loading) {
      loadProfile();
      loadNotifications();
    }
  }, [loading, loadProfile, loadNotifications]);

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
      setPassErr(
        "Parola este prea slabă. Folosește o combinație de litere mari/mici, cifre și simboluri."
      );
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
        (code === "invalid_current_password" &&
          "Parola curentă nu este corectă.") ||
        (code === "same_as_current" &&
          "Parola nouă nu poate fi identică cu parola curentă.") ||
        (code === "password_reused" &&
          "Nu poți reutiliza una dintre ultimele parole.") ||
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

      if (emailTrimmed === profile.email.toLowerCase()) {
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
          (e?.data?.error === "invalid_current_password" &&
            "Parola curentă nu este corectă.") ||
          (e?.data?.error === "email_taken" &&
            "Există deja un cont cu acest email.") ||
          (e?.data?.error === "same_email" &&
            "Emailul nou este identic cu cel curent.") ||
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
              loadNotifications();
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
              className={cls(
                settingsStyles.tab,
                active === t.key && settingsStyles.active
              )}
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
            title="Profil"
            subtitle="Datele tale de bază"
            right={
              <button
                className={settingsStyles.primary}
                onClick={saveProfile}
                disabled={!canSaveProfile}
              >
                {profileSaving ? "Se salvează…" : "Salvează profilul"}
              </button>
            }
          >
            <div className={settingsStyles.grid1}>
              <label className={settingsStyles.field}>
                <span>Email (nu se poate modifica aici)</span>
                <input
                  className={settingsStyles.input}
                  type="email"
                  value={profile.email}
                  disabled
                />

                <p className={settingsStyles.helperText}>
                  Adresa de email folosită la conectare se poate schimba din
                  tabul{" "}
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
                    onChange={(e) =>
                      setProfile((p) => ({
                        ...p,
                        firstName: e.target.value,
                      }))
                    }
                    placeholder="Ex: Andreea"
                  />
                </label>

                <label className={settingsStyles.field}>
                  <span>Nume</span>
                  <input
                    className={settingsStyles.input}
                    type="text"
                    value={profile.lastName}
                    onChange={(e) =>
                      setProfile((p) => ({
                        ...p,
                        lastName: e.target.value,
                      }))
                    }
                    placeholder="Ex: Popescu"
                  />
                </label>
              </div>

              <label className={settingsStyles.field}>
                <span>Poză profil</span>
                <div className={settingsStyles.avatarRow}>
                  {profile.avatarUrl && (
                    <img
                      src={profile.avatarUrl}
                      alt="Avatar"
                      className={settingsStyles.avatar}
                    />
                  )}
                  <input
                    className={settingsStyles.input}
                    type="url"
                    value={profile.avatarUrl}
                    onChange={(e) =>
                      setProfile((p) => ({
                        ...p,
                        avatarUrl: e.target.value,
                      }))
                    }
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
                          setProfileErr(
                            err?.message || "Nu am putut încărca imaginea."
                          );
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
              {profileOk && (
                <div className={settingsStyles.success}>
                  ✅ Profilul a fost actualizat.
                </div>
              )}
            </div>
          </Section>
        )}

        {/* NOTIFICĂRI (in-app) */}
        {!loading && active === "notifications" && (
          <Section
            icon={<Bell size={18} />}
            title="Notificări în aplicație"
            subtitle="Controlează notificările pe care le vezi în contul tău Artfest. Emailurile esențiale legate de comenzi și securitate vor fi trimise în continuare, indiferent de aceste setări. momentan sunt pentru comenzi, suport implementate. "
            right={
              <button
                className={settingsStyles.primary}
                onClick={saveNotifications}
                disabled={!canSaveNotifications}
              >
                {notifSaving ? "Se salvează…" : "Salvează notificările"}
              </button>
            }
          >
            <div className={settingsStyles.grid1}>
              <label className={settingsStyles.checkboxRow}>
                <input
                  type="checkbox"
                  checked={notifications.inAppMessageNew}
                  onChange={(e) =>
                    setNotifications((n) => ({
                      ...n,
                      inAppMessageNew: e.target.checked,
                    }))
                  }
                />
                <span>
                  Afișează notificări când primesc mesaje noi de la magazine.
                </span>
              </label>

              <label className={settingsStyles.checkboxRow}>
                <input
                  type="checkbox"
                  checked={notifications.inAppBookingUpdates}
                  onChange={(e) =>
                    setNotifications((n) => ({
                      ...n,
                      inAppBookingUpdates: e.target.checked,
                    }))
                  }
                />
                <span>
                  Afișează notificări pentru comenzi și rezervări (creare,
                  confirmare, modificări, anulare).
                </span>
              </label>

              <label className={settingsStyles.checkboxRow}>
                <input
                  type="checkbox"
                  checked={notifications.inAppEventReminders}
                  onChange={(e) =>
                    setNotifications((n) => ({
                      ...n,
                      inAppEventReminders: e.target.checked,
                    }))
                  }
                />
                <span>
                  Afișează remindere în aplicație înainte de evenimentele mele.
                </span>
              </label>

              {notifErr && (
                <div className={settingsStyles.error} role="alert">
                  {notifErr}
                </div>
              )}
              {notifOk && (
                <div className={settingsStyles.success}>
                  ✅ Preferințele de notificare au fost salvate.
                </div>
              )}
            </div>
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
                <button
                  className={settingsStyles.primary}
                  onClick={changePassword}
                  disabled={!canSavePass}
                >
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
                  <div className={settingsStyles.warn}>
                    Parola trebuie să aibă cel puțin {MIN_LEN} caractere.
                  </div>
                )}

                {newPass2 && newPass && newPass !== newPass2 && (
                  <div className={settingsStyles.warn}>
                    Parolele nu se potrivesc.
                  </div>
                )}

                {newPass && (
                  <div
                    style={{ marginTop: 4, fontSize: 12, color: "#6b7280" }}
                  >
                    Complexitate parolă:{" "}
                    {passScore <= 2
                      ? "slabă"
                      : passScore === 3
                      ? "medie"
                      : "puternică"}
                    . Recomandat: litere mari/mici, cifre și simboluri.
                  </div>
                )}

                {capsOnPass && passFocused && (
                  <div className={settingsStyles.warn}>
                    CapsLock este activ – ai grijă la literele mari.
                  </div>
                )}

                {passErr && (
                  <div className={settingsStyles.error} role="alert">
                    {passErr}
                  </div>
                )}

                {passErrCode === "invalid_current_password" && (
                  <div className={settingsStyles.helperText}>
                    Dacă nu îți amintești parola curentă, poți folosi opțiunea{" "}
                    <a
                      href={FORGOT_PASSWORD_URL}
                      className={settingsStyles.link}
                    >
                      „Am uitat parola”
                    </a>
                    .
                  </div>
                )}

                {passOk && (
                  <div className={settingsStyles.success}>
                    ✅ Parola a fost schimbată cu succes.
                  </div>
                )}

                <div style={{ marginTop: 12 }}>
                  <a
                    href={FORGOT_PASSWORD_URL}
                    className={settingsStyles.link}
                  >
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
                <button
                  className={settingsStyles.primary}
                  onClick={changeEmail}
                  disabled={!canSaveEmail}
                >
                  {emailSaving ? "Se salvează…" : "Salvează emailul"}
                </button>
              }
            >
              <div className={settingsStyles.grid1}>
                <label className={settingsStyles.field}>
                  <span>Email curent</span>
                  <input
                    className={settingsStyles.input}
                    type="email"
                    value={profile.email}
                    disabled
                  />
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
                    ✅ Ți-am trimis un email de confirmare la{" "}
                    <strong>{pendingEmailInfo}</strong>. Te rugăm să accesezi
                    linkul din acel email pentru a finaliza schimbarea
                    adresei de email.
                  </div>
                )}
              </div>
            </Section>
          </>
        )}

        {/* ȘTERGERE CONT */}
        {!loading && active === "danger" && (
          <Section
            icon={<Trash2 size={18} />}
            title="Zonă periculoasă"
            subtitle="Acțiuni ireversibile"
          >
            <div className={settingsStyles.danger}>
              <div>
                <div className={settingsStyles.title}>Ștergere cont</div>
                <div className={settingsStyles.subtitle}>
                  Această acțiune nu poate fi anulată. Toate datele tale vor fi
                  eliminate și nu vei mai putea accesa contul.
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
              <div
                className={settingsStyles.error}
                role="alert"
                style={{ marginTop: 12 }}
              >
                {deleteErr}
              </div>
            )}
          </Section>
        )}
      </main>
    </div>
  );
}
