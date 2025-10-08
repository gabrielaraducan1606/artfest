import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../../../lib/api";
import {
  User as UserIcon,
  Shield,
  Bell,
  Paintbrush,
  Trash2,
  Save,
  RefreshCcw,
  Globe,
  Phone,
  Building2,
  Loader2,
} from "lucide-react";
import styles from "./Settings.module.css";

/* ============ Utils ============ */
function cls(...xs) { return xs.filter(Boolean).join(" "); }
const initialNotif = { emailMessages: true, emailOrders: true, pushInApp: true, weeklyDigest: false };
const THEME_KEY = "theme"; // folosit de Navbar-ul tău

function applyTheme(value) {
  const root = document.documentElement;
  if (value === "system") {
    localStorage.removeItem(THEME_KEY);
    root.removeAttribute("data-theme");
    return;
  }
  localStorage.setItem(THEME_KEY, value);
  root.setAttribute("data-theme", value);
}

/* ============ Sub-componente ============ */
function Switch({ checked, onChange, label, id }) {
  return (
    <label htmlFor={id} className={styles.switchWrap}>
      <input id={id} type="checkbox" checked={checked} onChange={(e)=>onChange(e.target.checked)} />
      <span className={styles.switchKnob} />
      <span className={styles.switchLabel}>{label}</span>
    </label>
  );
}

function Section({ icon, title, subtitle, children, right }) {
  return (
    <section className={styles.card}>
      <header className={styles.cardHead}>
        <div className={styles.cardTitle}>
          {icon}
          <div>
            <div className={styles.title}>{title}</div>
            {subtitle && <div className={styles.subtitle}>{subtitle}</div>}
          </div>
        </div>
        <div>{right}</div>
      </header>
      <div className={styles.cardBody}>{children}</div>
    </section>
  );
}

/* ============ Pagina ============ */
export default function SettingsPage() {
  const [loading, setLoading] = useState(true);
  const [me, setMe] = useState(null);
  const [vendor, setVendor] = useState(null);

  // Profile form
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName]   = useState("");
  const [email, setEmail]         = useState("");
  const [phoneVal, setPhoneVal]   = useState("");
  const [displayName, setDisplayName] = useState("");
  const [city, setCity]           = useState("");
  const [savingProfile, setSavingProfile] = useState(false);
  const profileDirty = useMemo(() => {
    if (!me) return false;
    return (
      firstName !== (me.firstName || "") ||
      lastName  !== (me.lastName || "") ||
      phoneVal  !== (me.phone || "") ||
      (vendor ? (displayName !== (vendor.displayName || "") || city !== (vendor.city || "")) : false)
    );
  }, [me, vendor, firstName, lastName, phoneVal, displayName, city]);

  // Security
  const [oldPass, setOldPass] = useState("");
  const [newPass, setNewPass] = useState("");
  const [newPass2, setNewPass2] = useState("");
  const [savingPass, setSavingPass] = useState(false);

  // Notifications
  const [notif, setNotif] = useState(initialNotif);
  const [savingNotif, setSavingNotif] = useState(false);

  // Appearance
  const initialTheme = useMemo(() => {
    const saved = typeof window !== "undefined" ? localStorage.getItem(THEME_KEY) : null;
    return saved === "light" || saved === "dark" ? saved : "system";
  }, []);
  const [theme, setTheme] = useState(initialTheme);

  // Tab-uri
  const tabs = [
    { key: "profile", label: "Profil", icon: <UserIcon size={16} /> },
    { key: "security", label: "Securitate", icon: <Shield size={16} /> },
    { key: "notifications", label: "Notificări", icon: <Bell size={16} /> },
    { key: "appearance", label: "Aspect", icon: <Paintbrush size={16} /> },
    { key: "danger", label: "Zonă periculoasă", icon: <Trash2 size={16} /> },
  ];
  const [active, setActive] = useState("profile");

  /* ===== Load data ===== */
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const meResp = await api("/api/auth/me").catch(() => null);
      const user = meResp?.user || null;
      setMe(user);

      const vendorResp = await api("/api/vendors/me").catch(() => null);
      setVendor(vendorResp?.vendor || null);

      setFirstName(user?.firstName || "");
      setLastName(user?.lastName || "");
      setEmail(user?.email || "");
      setPhoneVal(user?.phone || "");

      setDisplayName(vendorResp?.vendor?.displayName || "");
      setCity(vendorResp?.vendor?.city || "");

      const n = await api("/api/notifications/preferences").catch(() => null);
      setNotif(n?.data || initialNotif);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  /* ===== Save handlers ===== */
  const saveProfile = useCallback(async () => {
    if (!profileDirty) return;
    setSavingProfile(true);
    try {
      // 1) profil utilizator
      await api("/api/account/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName, lastName, phone: phoneVal,
        })
      }).catch(() => null);

      // 2) profil vendor (dacă este vendor)
      if (vendor) {
        await api("/api/vendors/me/profile", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ displayName, city })
        }).catch(() => null);
      }

      await load();
    } finally {
      setSavingProfile(false);
    }
  }, [profileDirty, firstName, lastName, phoneVal, vendor, displayName, city, load]);

  const savePassword = useCallback(async () => {
    if (!newPass || newPass !== newPass2) return;
    setSavingPass(true);
    try {
      await api("/api/account/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ oldPassword: oldPass, newPassword: newPass })
      }).catch(() => null);

      setOldPass(""); setNewPass(""); setNewPass2("");
    } finally {
      setSavingPass(false);
    }
  }, [oldPass, newPass, newPass2]);

  const saveNotifications = useCallback(async () => {
    setSavingNotif(true);
    try {
      await api("/api/notifications/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(notif)
      }).catch(() => null);
    } finally {
      setSavingNotif(false);
    }
  }, [notif]);

  const saveTheme = useCallback(() => {
    applyTheme(theme);
  }, [theme]);

  /* ===== Render ===== */
  return (
    <div className={styles.wrap}>
      <aside className={styles.sidebar}>
        <div className={styles.sideHead}>
          <div className={styles.sideTitle}>Setări cont</div>
          <button className={styles.iconBtn} onClick={load} title="Reîncarcă">
            <RefreshCcw size={16} />
          </button>
        </div>
        <nav className={styles.tabs}>
          {tabs.map(t => (
            <button
              key={t.key}
              className={cls(styles.tab, active === t.key && styles.active)}
              onClick={() => setActive(t.key)}
            >
              {t.icon} {t.label}
            </button>
          ))}
        </nav>
      </aside>

      <main className={styles.content}>
        {loading && (
          <div className={styles.loading}><Loader2 className={styles.spin} size={18}/> Se încarcă…</div>
        )}

        {!loading && active === "profile" && (
          <Section
            icon={<UserIcon size={18} />}
            title="Profil"
            subtitle="Actualizează-ți datele de contact și profilul public"
            right={
              <button
                className={styles.primary}
                onClick={saveProfile}
                disabled={!profileDirty || savingProfile}
              >
                <Save size={16}/> Salvează
              </button>
            }
          >
            <div className={styles.grid2}>
              <label className={styles.field}>
                <span>Prenume</span>
                <input className={styles.input} value={firstName} onChange={(e)=>setFirstName(e.target.value)} />
              </label>
              <label className={styles.field}>
                <span>Nume</span>
                <input className={styles.input} value={lastName} onChange={(e)=>setLastName(e.target.value)} />
              </label>
            </div>

            <div className={styles.grid2}>
              <label className={styles.field}>
                <span>Email</span>
                <div className={styles.inputReadonly}>{email || "—"}</div>
              </label>
              <label className={styles.field}>
                <span>Telefon</span>
                <div className={styles.inputIcon}>
                  <Phone size={14}/>
                  <input className={styles.input} value={phoneVal} onChange={(e)=>setPhoneVal(e.target.value)} placeholder="+40…" />
                </div>
              </label>
            </div>

            {vendor && (
              <>
                <div className={styles.grid2}>
                  <label className={styles.field}>
                    <span>Nume afișat (public)</span>
                    <div className={styles.inputIcon}>
                      <Building2 size={14}/>
                      <input className={styles.input} value={displayName} onChange={(e)=>setDisplayName(e.target.value)} />
                    </div>
                  </label>
                  <label className={styles.field}>
                    <span>Oraș</span>
                    <div className={styles.inputIcon}>
                      <Globe size={14}/>
                      <input className={styles.input} value={city} onChange={(e)=>setCity(e.target.value)} placeholder="ex: București" />
                    </div>
                  </label>
                </div>
              </>
            )}
          </Section>
        )}

        {!loading && active === "security" && (
          <Section
            icon={<Shield size={18} />}
            title="Securitate"
            subtitle="Schimbă parola și verifică setările de securitate"
            right={
              <button
                className={styles.primary}
                onClick={savePassword}
                disabled={!newPass || newPass !== newPass2 || savingPass}
              >
                <Save size={16}/> Salvează
              </button>
            }
          >
            <div className={styles.grid1}>
              <label className={styles.field}>
                <span>Parola veche</span>
                <input className={styles.input} type="password" value={oldPass} onChange={(e)=>setOldPass(e.target.value)} />
              </label>
              <div className={styles.grid2}>
                <label className={styles.field}>
                  <span>Parola nouă</span>
                  <input className={styles.input} type="password" value={newPass} onChange={(e)=>setNewPass(e.target.value)} />
                </label>
                <label className={styles.field}>
                  <span>Confirmă parola</span>
                  <input className={styles.input} type="password" value={newPass2} onChange={(e)=>setNewPass2(e.target.value)} />
                </label>
              </div>
              {newPass && newPass2 && newPass !== newPass2 && (
                <div className={styles.warn}>Parolele nu coincid.</div>
              )}
            </div>
          </Section>
        )}

        {!loading && active === "notifications" && (
          <Section
            icon={<Bell size={18} />}
            title="Notificări"
            subtitle="Alege cum vrei să fii anunțat"
            right={
              <button className={styles.primary} onClick={saveNotifications} disabled={savingNotif}>
                <Save size={16}/> Salvează
              </button>
            }
          >
            <div className={styles.stack}>
              <Switch id="n1" label="Email pentru mesaje noi" checked={notif.emailMessages} onChange={(v)=>setNotif(n=>({ ...n, emailMessages: v }))} />
              <Switch id="n2" label="Email pentru comenzi/plăți" checked={notif.emailOrders} onChange={(v)=>setNotif(n=>({ ...n, emailOrders: v }))} />
              <Switch id="n3" label="Notificări în aplicație" checked={notif.pushInApp} onChange={(v)=>setNotif(n=>({ ...n, pushInApp: v }))} />
              <Switch id="n4" label="Rezumat săptămânal pe email" checked={notif.weeklyDigest} onChange={(v)=>setNotif(n=>({ ...n, weeklyDigest: v }))} />
            </div>
          </Section>
        )}

        {!loading && active === "appearance" && (
          <Section
            icon={<Paintbrush size={18} />}
            title="Aspect"
            subtitle="Temă și densitatea interfeței"
            right={
              <button className={styles.primary} onClick={saveTheme}>
                <Save size={16}/> Aplică
              </button>
            }
          >
            <div className={styles.grid3}>
              <label className={styles.radio}>
                <input
                  type="radio"
                  name="theme"
                  checked={theme === "system"}
                  onChange={()=>setTheme("system")}
                />
                <span>System</span>
              </label>
              <label className={styles.radio}>
                <input
                  type="radio"
                  name="theme"
                  checked={theme === "light"}
                  onChange={()=>setTheme("light")}
                />
                <span>Light</span>
              </label>
              <label className={styles.radio}>
                <input
                  type="radio"
                  name="theme"
                  checked={theme === "dark"}
                  onChange={()=>setTheme("dark")}
                />
                <span>Dark</span>
              </label>
            </div>
            <div className={styles.help}>
              „System” folosește preferința sistemului tău de operare. Navbar-ul tău citește `localStorage.theme`: am păstrat compatibilitatea.
            </div>
          </Section>
        )}

        {!loading && active === "danger" && (
          <Section
            icon={<Trash2 size={18} />}
            title="Zonă periculoasă"
            subtitle="Acțiuni ireversibile"
          >
            <div className={styles.danger}>
              <div>
                <div className={styles.title}>Ștergere cont</div>
                <div className={styles.subtitle}>Această acțiune nu poate fi anulată. Toate datele tale vor fi eliminate.</div>
              </div>
              <a className={styles.dangerBtn} href="/cont/sterge">Șterge contul</a>
            </div>
          </Section>
        )}
      </main>
    </div>
  );
}
