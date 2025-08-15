// src/pages/Seller/onboarding/Steps/Step1.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../../../../components/services/api";
import styles from "./Step1.module.css";

const USERNAME_RGX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/; // slug-like
const PHONE_RGX = /^(\+?\d[\d\s-]{6,})$/;
const EMAIL_RGX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const MAX = {
  shopName: 60,
  shortDescription: 160,
  brandStory: 3000,
};

const CATEGORIES = [
  { value: "bijuterii-accesorii", label: "Bijuterii și accesorii" },
  { value: "articole-evenimente", label: "Articole pentru evenimente" },
  { value: "moda-handmade", label: "Modă handmade" },
  { value: "decoratiuni-interioare", label: "Decorațiuni interioare" },
  { value: "papetarie-cadouri", label: "Papetărie și cadouri" },
  { value: "produse-copii", label: "Produse pentru copii" },
  { value: "cosmetice-naturale", label: "Produse cosmetice naturale" },
  { value: "altele", label: "Altele" },
];

/** Descrieri + exemple pentru fiecare categorie (afișate în acordeon) */
const CATEGORY_HELP = {
  "bijuterii-accesorii": {
    title: "Bijuterii și accesorii",
    examples: ["inele, cercei, coliere", "brățări metal/lemn/rășină", "broșe, ace, accesorii păr"],
    include: "Produse mici, purtabile, lucrate manual sau personalizate.",
    exclude: "Bijuterii fine cu pietre prețioase certificate (nu suntem casă de bijuterii).",
  },
  "articole-evenimente": {
    title: "Articole pentru evenimente",
    examples: ["invitații nuntă/botez", "mărturii personalizate", "lumânări și decoruri tematice"],
    include: "Articole dedicate nunților, botezurilor, aniversărilor, corporate.",
    exclude: "Servicii de organizare full-service (doar produse handmade livrabile).",
  },
  "moda-handmade": {
    title: "Modă handmade",
    examples: ["tricouri pictate", "haine croșetate/tricotate", "genți și rucsacuri"],
    include: "Îmbrăcăminte și accesorii textile realizate manual.",
    exclude: "Revânzare de produse industriale (fast fashion).",
  },
  "decoratiuni-interioare": {
    title: "Decorațiuni interioare",
    examples: ["tablouri, picturi", "obiecte din lemn/ceramică", "lămpi handmade"],
    include: "Piese decorative pentru casă, realizate manual.",
    exclude: "Mobilier voluminos, montaj (logistică atipică).",
  },
  "papetarie-cadouri": {
    title: "Papetărie și cadouri",
    examples: ["agende handmade", "felicitări", "cutii cadou, albume foto"],
    include: "Articole din hârtie, carton, gravuri, personalizări.",
    exclude: "Tipar industrial în tiraje mari (ne focusăm pe artizanat).",
  },
  "produse-copii": {
    title: "Produse pentru copii",
    examples: ["jucării croșetate (amigurumi)", "păturici", "seturi botez handmade"],
    include: "Produse sigure, adaptate vârstei, fără componente periculoase.",
    exclude: "Jucării cu omologări lipsă pentru 0-3 ani (responsabilitatea vânzătorului).",
  },
  "cosmetice-naturale": {
    title: "Produse cosmetice naturale",
    examples: ["săpunuri artizanale", "balsamuri și creme", "săruri de baie"],
    include: "Produse făcute manual, etichetate corect, loturi mici.",
    exclude: "Produse fără conformitate legală (etichete, notificări, etc.).",
  },
  altele: {
    title: "Altele",
    examples: ["mix de produse", "seturi tematice", "articole de nișă"],
    include: "Dacă nu regăsești exact categoria, poți alege Altele temporar.",
    exclude: "Revânzare fără aport handmade sau personalizare reală.",
  },
};

function useDebouncedCallback(cb, delay) {
  const t = useRef(null);
  return (...args) => {
    window.clearTimeout(t.current);
    t.current = window.setTimeout(() => cb(...args), delay);
  };
}

const ImageField = ({ label, name, value, onChange, hint }) => {
  const [preview, setPreview] = useState(null);
  useEffect(() => {
    if (value instanceof File) {
      const url = URL.createObjectURL(value);
      setPreview(url);
      return () => URL.revokeObjectURL(url);
    }
    if (typeof value === "string" && value) setPreview(value);
  }, [value]);

  return (
    <div className={styles.fieldBlock}>
      <label className={styles.label} htmlFor={name}>
        {label} {hint && <span className={styles.hint}>({hint})</span>}
      </label>
      {preview && (
        <div className={styles.imagePreviewWrap}>
          <img src={preview} alt={`${label} preview`} className={styles.imagePreview} />
          <button
            type="button"
            className={styles.secondaryBtn}
            onClick={() => onChange({ target: { name, files: [null] } })}
          >
            Elimină
          </button>
        </div>
      )}
      <input id={name} name={name} type="file" accept="image/*" onChange={onChange} />
      <p className={styles.hint}>
        Formate: JPG/PNG. Recomandat:{" "}
        {name === "profileImage" ? "≥ 240×240, 1:1" : "≥ 1200×400, 16:9"}
      </p>
    </div>
  );
};

export default function Step1({ onStepComplete }) {
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);     // autosave vizual
  const [submitting, setSubmitting] = useState(false); // submit real (blocare buton)
  const [error, setError] = useState("");

  // disponibilitate
  const [usernameStatus, setUsernameStatus] = useState("idle"); // idle | checking | ok | taken
  const [shopNameStatus, setShopNameStatus] = useState("idle");

  const [clientErrors, setClientErrors] = useState({});
  const [showCategoryInfo, setShowCategoryInfo] = useState(false);
  const [showAllCategoryInfo, setShowAllCategoryInfo] = useState(false);

  const [formData, setFormData] = useState({
    shopName: "",
    username: "",
    phone: "",
    publicPhone: false,
    publicEmail: "",
    profileImage: null,
    coverImage: null,
    shortDescription: "",
    brandStory: "",
    category: "",
    city: "",
    country: "România",
    deliveryNotes: "",
    returnNotes: "",
  });

  const publicLink = useMemo(() => {
    const base = window?.location?.origin || "https://exemplu.ro";
    const u = (formData.username || "").trim();
    return u ? `${base}/shop/${u}` : `${base}/shop/username`;
  }, [formData.username]);

  // Load progres
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const res = await api.get("/seller/progress");
        if (!mounted) return;
        if (res.data?.formData) setFormData((p) => ({ ...p, ...res.data.formData }));
      } catch (err) {
        console.error("Eroare la încărcarea progresului:", err);
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, []);

  // Autosave (ușor “debounced”)
  const debouncedSave = useDebouncedCallback(async (data) => {
    try {
      setSaving(true);
      setError("");
      await api.patch("/seller/progress", { currentStep: 1, formData: data });
    } catch {
      setError("Nu s-a putut salva automat (verifică rețeaua).");
    } finally {
      setTimeout(() => setSaving(false), 150);
    }
  }, 600);

  // Username check
  const debouncedCheckUsername = useDebouncedCallback(async (u) => {
    const val = (u || "").trim();
    if (!val) return setUsernameStatus("idle");
    if (!USERNAME_RGX.test(val)) return setUsernameStatus("taken");
    try {
      setUsernameStatus("checking");
      const res = await api.get(`/seller/check-username`, { params: { u: val } });
      setUsernameStatus(res.data?.available ? "ok" : "taken");
    } catch {
      setUsernameStatus("idle");
    }
  }, 400);

  // Shop name check
  const debouncedCheckShopName = useDebouncedCallback(async (name) => {
    const val = (name || "").trim();
    if (!val) return setShopNameStatus("idle");
    try {
      setShopNameStatus("checking");
      const res = await api.get(`/seller/check-shopname`, { params: { q: val } });
      setShopNameStatus(res.data?.available ? "ok" : "taken");
    } catch {
      setShopNameStatus("idle");
    }
  }, 400);

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    const val = type === "checkbox" ? checked : value;
    setFormData((prev) => {
      const next = { ...prev, [name]: val };
      if (name === "username") debouncedCheckUsername(val);
      if (name === "shopName") debouncedCheckShopName(val);
      if (name === "publicEmail") next.publicEmail = val.trim();
      debouncedSave(next);
      return next;
    });
  };

  const handleFileChange = (e) => {
    const { name, files } = e.target;
    const file = files?.[0] || null;
    setFormData((prev) => {
      const next = { ...prev, [name]: file };
      debouncedSave(next);
      return next;
    });
  };

  // Validări minime
  const validate = () => {
    const err = {};
    if (!formData.shopName?.trim()) err.shopName = "Completează numele magazinului";
    else if (shopNameStatus === "taken") err.shopName = "Numele de magazin este deja folosit.";

    if (!formData.username?.trim()) err.username = "Alege un username (slug)";
    else if (!USERNAME_RGX.test(formData.username))
      err.username = "Doar litere mici, cifre și cratime (fără spații).";
    else if (usernameStatus === "taken") err.username = "Username indisponibil.";

    if (formData.phone && !PHONE_RGX.test(formData.phone)) err.phone = "Telefon invalid";
    if (formData.publicEmail && !EMAIL_RGX.test(formData.publicEmail))
      err.publicEmail = "Email public invalid";

    if (!formData.shortDescription?.trim()) err.shortDescription = "Adaugă o descriere scurtă";
    if (formData.shortDescription.length > MAX.shortDescription)
      err.shortDescription = `Maxim ${MAX.shortDescription} caractere`;

    if (!formData.category) err.category = "Selectează o categorie";
    if (!formData.city?.trim()) err.city = "Adaugă orașul";

    return err;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (submitting) return; // guard anti dublu-click
    const errs = validate();
    setClientErrors(errs);
    if (Object.keys(errs).length) return;

    try {
      setSubmitting(true);
      setError("");

      const fd = new FormData();
      Object.entries(formData).forEach(([k, v]) => {
        if (v !== undefined && v !== null && v !== "") fd.append(k, v);
      });

      await api.post("/seller/profile", fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });

      await api.patch("/seller/progress", { currentStep: 2, formData });

      onStepComplete?.(formData);
      navigate("/vanzator/onboarding?step=2");
    } catch (err) {
      console.error(err);
      setError("Eroare la salvare. Verifică datele.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleSkipToStep2 = async () => {
    try {
      await api.patch("/seller/progress", { currentStep: 2, formData });
      navigate("/vanzator/onboarding?step=2");
    } catch (e) {
      console.error(e);
      alert("Nu am putut avansa la pasul 2. Încearcă din nou.");
    }
  };

  if (loading) return <p>Se încarcă...</p>;

  const badgeStateClass = (status) =>
    status === "ok" ? styles.badgeOk : status === "taken" ? styles.badgeError : "";

  // Helpers pentru info categorii
  const selectedHelp = formData.category ? CATEGORY_HELP[formData.category] : null;
  const renderCategoryCard = (key) => {
    const h = CATEGORY_HELP[key];
    if (!h) return null;
    return (
      <li key={key} className={styles.categoryItem}>
        <div className={styles.categoryTitle}>{h.title}</div>
        <div className={styles.categoryMeta}>
          <span className={styles.pill}>Exemple:</span> {h.examples.join(", ")}
        </div>
        <div className={styles.categoryMeta}>
          <span className={styles.pill}>Potrivite:</span> {h.include}
        </div>
        <div className={styles.categoryMeta}>
          <span className={styles.pill}>Nu includ:</span> {h.exclude}
        </div>
      </li>
    );
  };

  return (
    <div className={styles.container}>
      <form className={styles.form} onSubmit={handleSubmit} noValidate>
        <h2 className={styles.title}>Completează profilul tău de vânzător</h2>

        {/* Identitate & link */}
        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>Identitate & link public</h3>
          <div className={styles.grid2}>
            <div className={styles.fieldBlock}>
              <label className={styles.label} htmlFor="shopName">Nume magazin / brand</label>
              <div className={styles.inlineField}>
                <input
                  id="shopName"
                  name="shopName"
                  value={formData.shopName}
                  onChange={handleChange}
                  maxLength={MAX.shopName}
                  placeholder="ex: Atelier Mara"
                  required
                  className={
                    clientErrors.shopName
                      ? styles.inputError
                      : (shopNameStatus === "ok" ? styles.inputOk : "")
                  }
                />
                <span className={`${styles.statusBadge} ${badgeStateClass(shopNameStatus)}`}>
                  {shopNameStatus === "checking" && "Verific..."}
                  {shopNameStatus === "ok" && "Disponibil"}
                  {shopNameStatus === "taken" && "Indisponibil"}
                </span>
              </div>
              <p className={styles.hint}>
                Numele afișat în listări și pe pagina publică (max {MAX.shopName} caractere).
              </p>
              {clientErrors.shopName && <p className={styles.error}>{clientErrors.shopName}</p>}
            </div>

            <div className={styles.fieldBlock}>
              <label className={styles.label} htmlFor="username">Username (slug)</label>
              <div className={styles.inlineField}>
                <input
                  id="username"
                  name="username"
                  value={formData.username}
                  onChange={handleChange}
                  placeholder="ex: atelier-mara"
                  required
                  className={
                    clientErrors.username
                      ? styles.inputError
                      : (usernameStatus === "ok" ? styles.inputOk : "")
                  }
                />
                <span className={`${styles.statusBadge} ${badgeStateClass(usernameStatus)}`}>
                  {usernameStatus === "checking" && "Verific..."}
                  {usernameStatus === "ok" && "Disponibil"}
                  {usernameStatus === "taken" && "Indisponibil"}
                </span>
              </div>
              <p className={styles.hint}>
                Doar litere mici, cifre și cratime. Poți folosi acest link pentru distribuire pe
                rețelele de socializare, în bio, sau în campanii. Linkul tău:{" "}
                <code>{publicLink}</code>{" "}
                <button
                  type="button"
                  className={styles.secondaryBtn}
                  onClick={() => navigator.clipboard?.writeText(publicLink)}
                >
                  Copiază
                </button>
              </p>
              {clientErrors.username && <p className={styles.error}>{clientErrors.username}</p>}
            </div>
          </div>
        </section>

        {/* Imagini */}
        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>Imagini</h3>
          <div className={styles.grid2}>
            <ImageField
              label="Logo / poză profil"
              name="profileImage"
              value={formData.profileImage}
              onChange={handleFileChange}
              hint="1:1 (ex: 240×240+)"
            />
            <ImageField
              label="Fotografie copertă"
              name="coverImage"
              value={formData.coverImage}
              onChange={handleFileChange}
              hint="16:9 (ex: 1200×400+)"
            />
          </div>
        </section>

        {/* Descriere */}
        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>Descriere</h3>
          <div className={styles.fieldBlock}>
            <label className={styles.label} htmlFor="shortDescription">Descriere scurtă</label>
            <textarea
              id="shortDescription"
              name="shortDescription"
              rows={3}
              value={formData.shortDescription}
              onChange={handleChange}
              maxLength={MAX.shortDescription}
              placeholder="Tagline memorabil (max 160 caractere)"
              required
            />
            <div className={styles.counter}>
              {formData.shortDescription.length}/{MAX.shortDescription}
            </div>
            {clientErrors.shortDescription && (
              <p className={styles.error}>{clientErrors.shortDescription}</p>
            )}
          </div>
          <div className={styles.fieldBlock}>
            <label className={styles.label} htmlFor="brandStory">Povestea brandului</label>
            <textarea
              id="brandStory"
              name="brandStory"
              rows={6}
              value={formData.brandStory}
              onChange={handleChange}
              maxLength={MAX.brandStory}
              placeholder="Spune despre inspirație, materiale, proces, valori, certificări, întreținere..."
            />
          </div>
        </section>

        {/* Categorii */}
        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>Categorie</h3>
          <div className={styles.fieldBlock}>
            <label className={styles.label} htmlFor="category">Categorie principală</label>
            <select
              id="category"
              name="category"
              value={formData.category}
              onChange={(e) => {
                handleChange(e);
                if (!showCategoryInfo) setShowCategoryInfo(true);
                setShowAllCategoryInfo(false);
              }}
              required
              className={clientErrors.category ? styles.inputError : ""}
              aria-invalid={!!clientErrors.category}
            >
              <option value="">Alege o categorie</option>
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
            {clientErrors.category && <p className={styles.error}>{clientErrors.category}</p>}

            {/* Toggle info categorii */}
            <button
              type="button"
              className={styles.infoToggle}
              aria-expanded={showCategoryInfo}
              onClick={() => setShowCategoryInfo((v) => !v)}
            >
              {showCategoryInfo ? "Ascunde detalii despre categorii" : "Vezi detalii despre categorii"}
            </button>

            {showCategoryInfo && (
              <div className={styles.categoryInfo} role="region" aria-live="polite">
                {selectedHelp && !showAllCategoryInfo && (
                  <div className={styles.categoryCallout}>
                    <strong>{selectedHelp.title}</strong>
                    <div className={styles.categoryMeta}>
                      <span className={styles.pill}>Exemple:</span> {selectedHelp.examples.join(", ")}
                    </div>
                    <div className={styles.categoryMeta}>
                      <span className={styles.pill}>Potrivite:</span> {selectedHelp.include}
                    </div>
                    <div className={styles.categoryMeta}>
                      <span className={styles.pill}>Nu includ:</span> {selectedHelp.exclude}
                    </div>
                    <button
                      type="button"
                      className={styles.secondaryBtn}
                      onClick={() => setShowAllCategoryInfo(true)}
                    >
                      Vezi toate categoriile
                    </button>
                  </div>
                )}

                {(!selectedHelp || showAllCategoryInfo) && (
                  <ul className={styles.categoryList}>
                    {Object.keys(CATEGORY_HELP).map((k) => renderCategoryCard(k))}
                  </ul>
                )}
              </div>
            )}
          </div>
        </section>

        {/* Locație & Contact public */}
        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>Locație & Contact public</h3>
          <div className={styles.grid2}>
            <div className={styles.fieldBlock}>
              <label className={styles.label} htmlFor="city">Oraș</label>
              <input
                id="city"
                name="city"
                value={formData.city}
                onChange={handleChange}
                placeholder="ex: Cluj-Napoca"
                required
                className={clientErrors.city ? styles.inputError : ""}
                aria-invalid={!!clientErrors.city}
              />
              {clientErrors.city && <p className={styles.error}>{clientErrors.city}</p>}
            </div>
            <div className={styles.fieldBlock}>
              <label className={styles.label} htmlFor="country">Țară</label>
              <input
                id="country"
                name="country"
                value={formData.country}
                onChange={handleChange}
                placeholder="România"
              />
            </div>
          </div>

          <div className={styles.grid2}>
            <div className={styles.fieldBlock}>
              <label className={styles.label} htmlFor="phone">Telefon</label>
              <input
                id="phone"
                name="phone"
                value={formData.phone}
                onChange={handleChange}
                placeholder="ex: +40 7xx xxx xxx"
                className={clientErrors.phone ? styles.inputError : ""}
                aria-invalid={!!clientErrors.phone}
              />
              {clientErrors.phone && <p className={styles.error}>{clientErrors.phone}</p>}
              <label className={styles.checkbox}>
                <div className={styles.align}>
                  <input
                    type="checkbox"
                    name="publicPhone"
                    checked={formData.publicPhone}
                    onChange={handleChange}
                  />{" "}
                  Afișează numărul pe pagina publică
                </div>
              </label>
            </div>
            <div className={styles.fieldBlock}>
              <label className={styles.label} htmlFor="publicEmail">E-mail public (opțional)</label>
              <input
                id="publicEmail"
                name="publicEmail"
                type="email"
                value={formData.publicEmail}
                onChange={handleChange}
                placeholder="contact@brand.ro"
                className={clientErrors.publicEmail ? styles.inputError : ""}
                aria-invalid={!!clientErrors.publicEmail}
              />
              {clientErrors.publicEmail && (
                <p className={styles.error}>{clientErrors.publicEmail}</p>
              )}
            </div>
          </div>
        </section>

        {/* Politici (opțional) */}
        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>Politici (opțional)</h3>
          <div className={styles.grid2}>
            <div className={styles.fieldBlock}>
              <label className={styles.label} htmlFor="deliveryNotes">Note livrare</label>
              <textarea
                id="deliveryNotes"
                name="deliveryNotes"
                rows={3}
                value={formData.deliveryNotes}
                onChange={handleChange}
                placeholder="Timpi de procesare, curieri, ambalare, personalizări..."
              />
            </div>
            <div className={styles.fieldBlock}>
              <label className={styles.label} htmlFor="returnNotes">Note retur</label>
              <textarea
                id="returnNotes"
                name="returnNotes"
                rows={3}
                value={formData.returnNotes}
                onChange={handleChange}
                placeholder="Condiții de retur, termene, excepții la produse personalizate..."
              />
            </div>
          </div>
        </section>

        {error && <div className={styles.errorBox}>{error}</div>}

        <div className={`${styles.footerBar} ${styles.footerStack}`}>
          <div className={`${styles.actions} ${styles.actionsStack}`}>
            <span className={styles.savingState}>{saving ? "Se salvează..." : ""}</span>
            <button
              type="button"
              formNoValidate
              className={`${styles.secondaryBtn} ${styles.btnBlock}`}
              onClick={handleSkipToStep2}
            >
              Sari la pasul 2
            </button>
            <button
              type="submit"
              className={`${styles.primaryBtn} ${styles.btnBlock}`}
              disabled={submitting}
            >
              {submitting ? "Se trimite…" : "Continuă la pasul 2"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
