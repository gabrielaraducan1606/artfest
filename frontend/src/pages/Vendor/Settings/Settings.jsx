import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { api } from "../../../lib/api";
import {
  User as UserIcon,
  Shield,
  Trash2,
  RefreshCcw,
  Loader2,
} from "lucide-react";
import settingsStyles from "./Settings.module.css";

// 🔹 importă tab-urile de onboarding (AJUSTEAZĂ path-urile după proiectul tău)
import onboardingStyles from "../OnBoarding/OnBoardingDetails/OnBoardingDetails.module.css";
import ProfileTab from "../Onboarding/OnBoardingDetails/tabs/ProfileTabBoarding.jsx";
import BillingTab from "../Onboarding/OnBoardingDetails/tabs/BillingTab.jsx";
import PaymentTab from "../Onboarding/OnBoardingDetails/tabs/PaymentTab.jsx";

const VANITY_BASE = "www.artfest.ro";
const FORGOT_PASSWORD_URL = "/reset-parola"; // pagina ta ForgotPassword

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

/* ===========================================================
   Sub-componentă internă: SOLO mode din OnBoardingDetails
   și îl randăm direct în chenarul din dreapta.
   tab poate fi: "profil" | "facturare" | "plata"
   =========================================================== */

const slugify = (s = "") =>
  String(s)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

function EmbeddedOnboarding({ tab }) {
  const activeTab = ["profil", "facturare", "plata"].includes(tab)
    ? tab
    : "profil";

  const [services, setServices] = useState([]);
  const [err, setErr] = useState("");
  const [saveState, setSaveState] = useState({});
  const [saveError, setSaveError] = useState({});
  const [billingStatus, setBillingStatus] = useState("idle");

  const timers = useRef({}); // { [serviceId]: timeoutId }

  const fetchMyServices = useCallback(async () => {
    const d = await api("/api/vendors/me/services?includeProfile=1", {
      method: "GET",
    });

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
        delivery: Array.isArray(s.profile?.delivery)
          ? s.profile.delivery
          : [],
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

  // autosave infra
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

      // auto-slug
      if (patch.displayName && !p.slug) {
        p.slug = slugify(patch.displayName);
      }

      Object.assign(p, patch);
      s.profile = p;
      next[idx] = s;

      const serviceId = s.id;
      if (serviceId) {
        setSaveState((m) => ({ ...m, [serviceId]: "saving" }));
        schedule(serviceId, async () => {
          try {
            await api(
              `/api/vendors/vendor-services/${encodeURIComponent(
                serviceId
              )}/profile`,
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
            await api(
              `/api/vendors/me/services/${encodeURIComponent(serviceId)}`,
              {
                method: "PATCH",
                body: {
                  city: current?.city || "",
                  attributes: current?.attributes || {},
                },
              }
            );
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
   Pagina principală: SettingsPage
   =========================================================== */

export default function SettingsPage() {
  const [loading, setLoading] = useState(true);

  const tabs = [
    {
      key: "profile",
      label: "Profil magazin",
      icon: <UserIcon size={16} />,
    },
    {
      key: "security",
      label: "Securitate",
      icon: <Shield size={16} />,
    },
    {
      key: "billing",
      label: "Date facturare",
      icon: <UserIcon size={16} />,
    },
    {
      key: "subscription",
      label: "Abonament",
      icon: <UserIcon size={16} />,
    },
    {
      key: "danger",
      label: "Ștergere cont",
      icon: <Trash2 size={16} />,
    },
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

  // ====== SECURITATE: schimbare parolă în cont ======
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
        (e?.data?.error === "invalid_current_password" &&
          "Parola curentă nu este corectă.") ||
        (e?.data?.error === "same_as_current" &&
          "Parola nouă nu poate fi identică cu parola curentă.") ||
        (e?.data?.error === "password_reused" &&
          "Nu poți reutiliza una dintre ultimele parole.") ||
        e?.message ||
        "Nu am putut schimba parola.";
      setPassErr(serverMsg);
      setPassOk(false);
    } finally {
      setSavingPass(false);
    }
  }, [oldPass, newPass, newPass2]);

  // ====== ȘTERGERE CONT ======
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

      // opțional: poți apela și un endpoint de logout aici, dacă ai
      // await api("/api/auth/logout", { method: "POST" }).catch(() => {});

      // redirect după ștergere (ajustează după cum vrei)
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
            onClick={load}
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
            <Loader2 className={settingsStyles.spin} size={18} /> Se
            încarcă…
          </div>
        )}

        {/* PROFIL MAGAZIN – folosește ProfileTab din onboarding */}
        {!loading && active === "profile" && (
          <EmbeddedOnboarding tab="profil" />
        )}

        {/* DATE FACTURARE – BillingTab din onboarding */}
        {!loading && active === "billing" && (
          <EmbeddedOnboarding tab="facturare" />
        )}

        {/* ABONAMENT – PaymentTab din onboarding */}
        {!loading && active === "subscription" && (
          <EmbeddedOnboarding tab="plata" />
        )}

        {/* SECURITATE – schimbare parolă în cont */}
        {!loading && active === "security" && (
          <Section
            icon={<Shield size={18} />}
            title="Securitate"
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

              {passErr && (
                <div className={settingsStyles.error} role="alert">
                  {passErr}
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
                  Această acțiune nu poate fi anulată. Toate datele tale
                  vor fi eliminate și nu vei mai putea accesa contul.
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
