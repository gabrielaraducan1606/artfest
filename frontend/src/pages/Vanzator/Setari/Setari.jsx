// src/pages/Vanzator/Setari/Setari.jsx
import React, { useEffect, useState, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import Navbar from "../../../components/HomePage/Navbar/Navbar";
import Footer from "../../../components/HomePage/Footer/Footer";
import styles from "./Setari.module.css";
import api from "../../../components/services/api";

const ABOUT_MAX = 1200;

export default function Setari() {
  const navigate = useNavigate();

  const [activeTab, setActiveTab] = useState("profil");
  const [formData, setFormData] = useState({});
  const [tagsInput, setTagsInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // acțiuni documente (evită dublu-click)
  const [docBusy, setDocBusy] = useState({ regenerate: false, annex: false, amendment: false });

  // preview-uri locale imagini
  const [profilePreview, setProfilePreview] = useState(null);
  const [coverPreview, setCoverPreview] = useState(null);

  // contract summary
  const [contractSummary, setContractSummary] = useState(null);

  // banner „ai schimbat câmpuri relevante contractului”
  const [showContractBanner, setShowContractBanner] = useState(false);

  // ghid / checklist
  const [showGuide, setShowGuide] = useState(() => localStorage.getItem("seller:hideGuide") !== "1");

  const tabs = [
    { key: "profil", label: "Profil magazin" },
    { key: "contact", label: "Contact" },
    { key: "politici", label: "Politici" },
    { key: "fiscal", label: "Date fiscale" },
    { key: "plati", label: "Plăți" },
    { key: "contract", label: "Contract" },
    { key: "securitate", label: "Securitate" },
  ];

  // ========= helpers =========
  const aboutCount = useMemo(() => {
    const txt = formData.about ?? formData.brandStory ?? "";
    return (txt || "").length;
  }, [formData.about, formData.brandStory]);

  const token = () => localStorage.getItem("authToken");

  const openInNewTab = (url) => {
    try {
      if (!url) return;
      window.open(url, "_blank", "noopener,noreferrer");
    } catch { /* noop */ }
  };

  const errMsg = (err) => {
    const d = err?.response?.data;
    const m = d?.message || d?.msg || d?.error || d?.detail;
    const s = err?.response?.status;
    return m ? `${s ? `[${s}] ` : ""}${m}` : (err?.message || "Eroare neprevăzută");
  };

  const compactObject = (obj = {}) => {
    const out = {};
    Object.entries(obj).forEach(([k, v]) => {
      if (v === undefined || v === null || v === "") return;
      out[k] = v;
    });
    return out;
  };

  const fetchContractSummary = useCallback(async () => {
    try {
      const { data } = await api.get("/contracts/me/summary", {
        headers: { Authorization: `Bearer ${token()}` },
      });
      setContractSummary(data);
    } catch (err) {
      console.error("❌ Eroare la /contracts/me/summary:", err);
      setContractSummary(null);
    }
  }, []);

  // Ușor helper pentru ghid: schimbă tab-ul și derulează la câmp
  const goTo = useCallback((tabKey, selector) => {
    setActiveTab(tabKey);
    if (!selector) return;
    setTimeout(() => {
      const el = document.querySelector(selector);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 60);
  }, []);

  const hideGuide = useCallback(() => {
    setShowGuide(false);
    localStorage.setItem("seller:hideGuide", "1");
  }, []);
  const resetGuide = useCallback(() => {
    setShowGuide(true);
    localStorage.removeItem("seller:hideGuide");
  }, []);

  // ========= load settings + contract summary =========
  useEffect(() => {
    const fetchSettings = async () => {
      setLoading(true);
      try {
        const { data } = await api.get("/seller/settings", {
          headers: { Authorization: `Bearer ${token()}` },
        });

        // mapăm brandStory -> about pentru UI
        setFormData({
          ...data,
          about: data.brandStory || "",
        });
      } catch (err) {
        console.error("❌ Eroare la încărcarea setărilor:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchSettings();
    fetchContractSummary();
  }, [fetchContractSummary]);

  // ========= handlers =========
  const handleChange = (e) => {
    const { name, value, checked, type } = e.target;

    if (name === "about") {
      const limited = (value || "").slice(0, ABOUT_MAX);
      setFormData((prev) => ({ ...prev, about: limited, brandStory: limited }));
      return;
    }

    if (name === "publicPhone" && type === "checkbox") {
      setFormData((prev) => ({ ...prev, publicPhone: !!checked }));
      return;
    }

    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleFileChange = (e) => {
    const { name, files } = e.target;
    if (!files || !files[0]) return;

    const file = files[0];
    setFormData((prev) => ({ ...prev, [name]: file }));

    // previews
    const url = URL.createObjectURL(file);
    if (name === "profileImage") setProfilePreview(url);
    if (name === "coverImage") setCoverPreview(url);
  };

  const handleTagKeyDown = (e) => {
    if ((e.key === "Enter" || e.key === ",") && tagsInput.trim()) {
      e.preventDefault();
      const newTag = tagsInput.trim().replace(",", "");
      const curr = Array.isArray(formData.tags) ? formData.tags : [];
      if (newTag && !curr.includes(newTag)) {
        setFormData((prev) => ({
          ...prev,
          tags: [...curr, newTag],
        }));
      }
      setTagsInput("");
    }
  };

  const removeTag = (indexToRemove) => {
    const curr = Array.isArray(formData.tags) ? formData.tags : [];
    setFormData((prev) => ({
      ...prev,
      tags: curr.filter((_, i) => i !== indexToRemove),
    }));
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const fd = new FormData();

      // map UI -> backend, sincronizăm brandStory cu about
      const payload = {
        ...formData,
        brandStory: formData.about ?? formData.brandStory ?? "",
      };

      Object.entries(payload).forEach(([key, val]) => {
        if (val === undefined || val === null) return;

        // arrays (ex: tags)
        if (Array.isArray(val)) {
          fd.append(key, JSON.stringify(val));
          return;
        }

        // fișiere
        if (key === "profileImage" || key === "coverImage") {
          if (val instanceof File) fd.append(key, val);
          return;
        }

        // booleans & strings & numbers
        fd.append(key, val);
      });

      const { data } = await api.patch("/seller/settings", fd, {
        headers: {
          Authorization: `Bearer ${token()}`,
          "Content-Type": "multipart/form-data",
        },
      });

      // reflectăm în UI noile URL-uri + reset previews locale
      if (data?.seller) {
        setFormData((prev) => ({
          ...prev,
          ...data.seller,
          about: data.seller.brandStory ?? prev.about,
          profileImage: undefined,
          coverImage: undefined,
        }));
      }
      setProfilePreview(null);
      setCoverPreview(null);

      // dacă back-ul zice că s-au modificat câmpuri relevante contractului, afișăm banner
      setShowContractBanner(!!data?.contractRelevant);

      alert("✅ Setările au fost salvate!");
    } catch (err) {
      console.error("❌ Eroare la salvarea setărilor:", err);
      alert(errMsg(err));
    } finally {
      setSaving(false);
    }
  };

  // ======= contract actions (tab "Contract") =======
  async function handleRegenerateDraft() {
    if (docBusy.regenerate) return;
    setDocBusy((s) => ({ ...s, regenerate: true }));
    try {
      const { data } = await api.post(
        "/contracts/me/regenerate",
        {},
        {
          headers: {
            Authorization: `Bearer ${token()}`,
            "Content-Type": "application/json",
          },
          timeout: 20000,
        }
      );
      await fetchContractSummary();
      setShowContractBanner(false);
      alert("✅ Draft regenerat.");
      if (data?.url) openInNewTab(data.url);
    } catch (err) {
      console.error("❌ Eroare la regenerare draft:", err);
      alert(errMsg(err));
    } finally {
      setDocBusy((s) => ({ ...s, regenerate: false }));
    }
  }

  async function handleAnnexIBAN() {
    if (docBusy.annex) return;
    if (!formData.bank || !formData.iban) {
      alert("Te rog completează banca și IBAN înainte de generarea anexei.");
      return;
    }

    setDocBusy((s) => ({ ...s, annex: true }));
    try {
      // sincronizează și în profil (dacă ai acel endpoint)
      const fd = new FormData();
      fd.append("step", "2");
      fd.append("bank", formData.bank);
      fd.append("iban", formData.iban);
      await api.post("/seller/profile?step=2", fd, {
        headers: { Authorization: `Bearer ${token()}`, "Content-Type": "multipart/form-data" },
        timeout: 20000,
      });

      // generează Anexa IBAN
      const { data } = await api.post(
        "/contracts/me/annex/bank",
        { bank: formData.bank, iban: formData.iban },
        { headers: { Authorization: `Bearer ${token()}` } }
      );

      if (data?.pdfUrl || data?.url) window.open(data.pdfUrl || data.url, "_blank", "noopener,noreferrer");
      else alert("Anexa a fost generată, dar nu am primit URL.");
    } catch (err) {
      console.error("❌ Eroare generare anexă IBAN:", err);
      const m = err?.response?.data?.msg || err?.response?.data?.message || err.message;
      alert(`Eroare: ${m}`);
    } finally {
      setDocBusy((s) => ({ ...s, annex: false }));
    }
  }

  async function handleAmendmentProfile() {
    if (docBusy.amendment) return;
    setDocBusy((s) => ({ ...s, amendment: true }));
    try {
      // DOAR câmpuri relevante contractului
      const profile = compactObject({
        shopName: formData.shopName,
        bank: formData.bank,
        iban: formData.iban,
        address: formData.address,
        city: formData.city,
        country: formData.country,
        cui: formData.cui,
        regCom: formData.registrationNumber || formData.regCom,
      });

      if (Object.keys(profile).length === 0) {
        alert("Nu există modificări de trimis pentru amendament.");
        return;
      }

      const { data } = await api.post(
        "/contracts/me/amendment/profile",
        { fields: profile },
        {
          headers: {
            Authorization: `Bearer ${token()}`,
            "Content-Type": "application/json",
          },
          timeout: 20000,
        }
      );
      if (data?.pdfUrl || data?.url) openInNewTab(data.pdfUrl || data.url);
      else alert("Amendamentul a fost generat, dar nu am primit URL.");
    } catch (err) {
      console.error("❌ Eroare generare amendament:", err);
      alert(errMsg(err));
    } finally {
      setDocBusy((s) => ({ ...s, amendment: false }));
    }
  }

  if (loading) return <p className={styles.loading}>Se încarcă...</p>;

  const profileImageUrl = profilePreview || formData.profileImageUrl || "";
  const coverImageUrl = coverPreview || formData.coverImageUrl || "";

  // ====== GHID / CHECKLIST dinamic ======
  const hasLogo = !!(formData.profileImageUrl || profilePreview);
  const hasCover = !!(formData.coverImageUrl || coverPreview);
  const hasShopName = !!(formData.shopName?.trim());
  const hasAbout = (formData.about || "").trim().length >= 80;
  const hasTags = (Array.isArray(formData.tags) ? formData.tags : []).length >= 3;
  const hasLocation = !!(formData.address && formData.city && formData.country);
  const hasFiscal = !!(formData.entityType && (
    String(formData.entityType).toUpperCase() !== "SRL"
      ? true
      : (formData.companyName && formData.cui && (formData.registrationNumber || formData.regCom))
  ));
  const hasBank = !!(formData.bank && formData.iban);
  const hasPolicies = !!(formData.deliveryNotes && formData.returnNotes);
  const hasSignedContract = !!contractSummary?.master;

  const checklist = [
    { key: "logo",       label: "Încarcă logo-ul magazinului",                done: hasLogo,       action: () => goTo("profil", 'input[name="profileImage"]') },
    { key: "cover",      label: "Adaugă o imagine de cover",                  done: hasCover,      action: () => goTo("profil", 'input[name="coverImage"]') },
    { key: "shopName",   label: "Completează numele magazinului",             done: hasShopName,   action: () => goTo("profil", 'input[name="shopName"]') },
    { key: "about",      label: "Scrie o descriere (min. 80 caractere)",      done: hasAbout,      action: () => goTo("profil", 'textarea[name="about"]') },
    { key: "tags",       label: "Adaugă cel puțin 3 tag-uri",                 done: hasTags,       action: () => goTo("profil", 'input[name="tags"]') },
    { key: "location",   label: "Completează oraș, țară și adresă",           done: hasLocation,   action: () => goTo("profil", 'input[name="address"]') },
    { key: "fiscal",     label: "Completează datele fiscale",                 done: hasFiscal,     action: () => setActiveTab("fiscal") },
    { key: "bank",       label: "Completează banca și IBAN",                  done: hasBank,       action: () => setActiveTab("plati") },
    { key: "policies",   label: "Completează politicile de livrare și retur", done: hasPolicies,   action: () => setActiveTab("politici") },
    {
      key: "contract",
      label: hasSignedContract ? "Contract semnat" : "Semnează contractul",
      done: hasSignedContract,
      action: () =>
        hasSignedContract
          ? (contractSummary?.master?.url && window.open(contractSummary.master.url, "_blank", "noopener,noreferrer"))
          : navigate("/vanzator/onboarding"),
    },
    {
      key: "courier",
      label: "Definește politica de curierat (ai contract propriu)",
      done: !!String(formData.deliveryNotes || "").match(/curier|awb|livrare|ridicare/i),
      action: () => setActiveTab("politici"),
    },
  ];

  const totalTasks = checklist.length;
  const doneTasks = checklist.filter((i) => i.done).length;
  const progressPct = Math.round((doneTasks / totalTasks) * 100);

  return (
    <>
      <Navbar />
      <div className={styles.container}>
        <h1>Setări</h1>

        {/* GHID / NU UITA SĂ… */}
        {showGuide && (
          <div className={styles.guideBox}>
            <div className={styles.guideHeader}>
              <strong>Nu uita să…</strong>
              <div className={styles.guideActions}>
                <button className={styles.linkBtn} onClick={resetGuide}>Resetează</button>
                <button className={styles.linkBtn} onClick={hideGuide}>Ascunde</button>
              </div>
            </div>
            <div className={styles.progressWrap} aria-label={`Progres ${progressPct}%`}>
              <div className={styles.progressBar}>
                <span style={{ width: `${progressPct}%` }} />
              </div>
              <small className={styles.progressText}>{doneTasks}/{totalTasks} finalizate</small>
            </div>
            <ul className={styles.checklist}>
              {checklist.map((item) => (
                <li key={item.key} className={`${styles.checkItem} ${item.done ? styles.done : ""}`}>
                  <span className={styles.checkIcon} aria-hidden>{item.done ? "✅" : "⬜"}</span>
                  <span className={styles.checkLabel}>{item.label}</span>
                  <button type="button" className={styles.miniBtn} onClick={item.action}>
                    {item.done ? "Deschide" : "Rezolvă"}
                  </button>
                </li>
              ))}
            </ul>
            {hasSignedContract && (
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <button className={styles.miniBtn} onClick={handleRegenerateDraft}>🔁 Draft</button>
                <button className={styles.miniBtn} onClick={handleAnnexIBAN}>🏦 Anexă IBAN</button>
                <button className={styles.miniBtn} onClick={handleAmendmentProfile}>✏️ Amendament</button>
              </div>
            )}
          </div>
        )}

        {/* Banner: ai modificat câmpuri relevante contractului */}
        {showContractBanner && (
          <div className={styles.noticeBox}>
            <div>
              Ai modificat date care apar și în contract (ex: nume magazin, adresă, bancă/IBAN).
              Poți <strong>regenera draftul</strong> sau să <strong>generezi un amendament</strong>.
            </div>
            <div className={styles.noticeActions}>
              <button className={styles.secondaryBtn} onClick={handleRegenerateDraft} disabled={docBusy.regenerate}>
                {docBusy.regenerate ? "Se regenerează…" : "🔁 Regenerează draft"}
              </button>
              <button className={styles.secondaryBtn} onClick={handleAmendmentProfile} disabled={docBusy.amendment}>
                {docBusy.amendment ? "Se generează…" : "✏️ Amendament"}
              </button>
              <button className={styles.linkBtn} onClick={() => setShowContractBanner(false)}>Ascunde</button>
            </div>
          </div>
        )}

        <div className={styles.tabMenu}>
          {tabs.map((tab) => (
            <button
              key={tab.key}
              className={`${styles.tabBtn} ${activeTab === tab.key ? styles.active : ""}`}
              onClick={() => setActiveTab(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className={styles.tabContent}>
          {/* ===== PROFIL ===== */}
          {activeTab === "profil" && (
            <form className={styles.form} onSubmit={handleSave}>
              <label>
                Logo magazin
                <input type="file" name="profileImage" accept="image/*" onChange={handleFileChange} />
                {!!profileImageUrl && (
                  <div className={styles.previewBox}>
                    <img src={profileImageUrl} alt="Logo preview" className={styles.previewImg} />
                  </div>
                )}
              </label>

              <label>
                Imagine cover
                <input type="file" name="coverImage" accept="image/*" onChange={handleFileChange} />
                {!!coverImageUrl && (
                  <div className={styles.previewBox}>
                    <img src={coverImageUrl} alt="Cover preview" className={styles.previewWide} />
                  </div>
                )}
              </label>

              <label>
                Nume magazin
                <input type="text" name="shopName" value={formData.shopName || ""} onChange={handleChange} />
              </label>

              <label>
                Descriere scurtă
                <textarea
                  name="shortDescription"
                  rows={3}
                  value={formData.shortDescription || ""}
                  onChange={handleChange}
                />
              </label>

              <label>
                Despre magazin
                <textarea
                  name="about"
                  rows={8}
                  placeholder="Povestea ta, materialele folosite, procesul de lucru, inspirația..."
                  value={formData.about || ""}
                  onChange={handleChange}
                />
                <div className={styles.helperRow}>
                  <small className={styles.helperText}>
                    Scrie într-un ton personal și specific (ex: materiale, tehnici, valori).
                  </small>
                  <small className={styles.counter}>{aboutCount}/{ABOUT_MAX}</small>
                </div>
              </label>

              <label>
                Tag-uri (apasă Enter sau virgulă)
                <input
                  type="text"
                  name="tags"
                  placeholder="ex: bijuterii, handmade, broderie"
                  value={tagsInput}
                  onChange={(e) => setTagsInput(e.target.value)}
                  onKeyDown={handleTagKeyDown}
                />
                <div className={styles.tagList}>
                  {(formData.tags || []).map((tag, index) => (
                    <span key={index} className={styles.tag}>
                      {tag}
                      <button type="button" onClick={() => removeTag(index)}>×</button>
                    </span>
                  ))}
                </div>
              </label>

              <div className={styles.grid2}>
                <label>
                  Oraș
                  <input type="text" name="city" value={formData.city || ""} onChange={handleChange} />
                </label>
                <label>
                  Țară
                  <input type="text" name="country" value={formData.country || ""} onChange={handleChange} />
                </label>
              </div>

              <label>
                Adresă completă
                <input
                  type="text"
                  name="address"
                  placeholder="Ex: Str. Exemplu 12, Bl. A5, Sc. 2, Ap. 7, Cluj-Napoca, Cluj"
                  value={formData.address || ""}
                  onChange={handleChange}
                />
              </label>

              <button type="submit" className={styles.saveBtn} disabled={saving}>
                {saving ? "Se salvează…" : "💾 Salvează"}
              </button>
            </form>
          )}

          {/* ===== CONTACT ===== */}
          {activeTab === "contact" && (
            <form className={styles.form} onSubmit={handleSave}>
              <label>
                Email public
                <input type="email" name="publicEmail" value={formData.publicEmail || ""} onChange={handleChange} />
              </label>
              <div className={styles.grid2}>
                <label>
                  Telefon
                  <input type="tel" name="phone" value={formData.phone || ""} onChange={handleChange} />
                </label>
                <label className={styles.checkboxRow}>
                  <span>Arată telefon pe profil</span>
                  <input
                    type="checkbox"
                    name="publicPhone"
                    checked={!!formData.publicPhone}
                    onChange={handleChange}
                  />
                </label>
              </div>
              <label>
                Website
                <input type="url" name="website" value={formData.website || ""} onChange={handleChange} />
              </label>
              <button type="submit" className={styles.saveBtn} disabled={saving}>
                {saving ? "Se salvează…" : "💾 Salvează"}
              </button>
            </form>
          )}

          {/* ===== POLITICI ===== */}
          {activeTab === "politici" && (
            <form className={styles.form} onSubmit={handleSave}>
              <label>
                Politică de livrare
                <textarea
                  name="deliveryNotes"
                  rows={5}
                  value={formData.deliveryNotes || ""}
                  onChange={handleChange}
                />
              </label>
              <label>
                Politică de retur
                <textarea
                  name="returnNotes"
                  rows={5}
                  value={formData.returnNotes || ""}
                  onChange={handleChange}
                />
              </label>
              <button type="submit" className={styles.saveBtn} disabled={saving}>
                {saving ? "Se salvează…" : "💾 Salvează"}
              </button>
            </form>
          )}

          {/* ===== DATE FISCALE ===== */}
          {activeTab === "fiscal" && (
            <form className={styles.form} onSubmit={handleSave}>
              <label>
                Tip entitate (PFA / SRL)
                <input
                  type="text"
                  name="entityType"
                  value={formData.entityType || ""}
                  onChange={handleChange}
                />
              </label>
              <label>
                Denumire firmă
                <input
                  type="text"
                  name="companyName"
                  value={formData.companyName || ""}
                  onChange={handleChange}
                />
              </label>
              <div className={styles.grid2}>
                <label>
                  CUI
                  <input
                    type="text"
                    name="cui"
                    value={formData.cui || ""}
                    onChange={handleChange}
                  />
                </label>
                <label>
                  Nr. Registrul Comerțului
                  <input
                    type="text"
                    name="registrationNumber"
                    value={formData.registrationNumber || formData.regCom || ""}
                    onChange={handleChange}
                  />
                </label>
              </div>
              <button type="submit" className={styles.saveBtn} disabled={saving}>
                {saving ? "Se salvează…" : "💾 Salvează"}
              </button>
            </form>
          )}

          {/* ===== PLĂȚI ===== */}
          {activeTab === "plati" && (
            <form className={styles.form} onSubmit={handleSave}>
              <label>
                Bancă
                <input
                  type="text"
                  name="bank"
                  value={formData.bank || ""}
                  onChange={handleChange}
                />
              </label>
              <label>
                IBAN
                <input
                  type="text"
                  name="iban"
                  value={formData.iban || ""}
                  onChange={handleChange}
                />
              </label>
              <label>
                Email financiar (facturi/plăți)
                <input
                  type="email"
                  name="emailFinance"
                  value={formData.emailFinance || ""}
                  onChange={handleChange}
                />
              </label>
              <div className={styles.actionsRow}>
                <button
                  type="button"
                  className={styles.secondaryBtn}
                  onClick={handleAnnexIBAN}
                  disabled={docBusy.annex || !contractSummary?.master}
                  title={!contractSummary?.master ? "Necesită contract semnat" : ""}
                >
                  {docBusy.annex ? "Se generează…" : "🏦 Generează anexă IBAN"}
                </button>
              </div>
              <button type="submit" className={styles.saveBtn} disabled={saving}>
                {saving ? "Se salvează…" : "💾 Salvează"}
              </button>
            </form>
          )}

          {/* ===== CONTRACT ===== */}
          {activeTab === "contract" && (
            <div className={styles.form}>
              <h3>Contract de colaborare</h3>

              {!contractSummary ? (
                <p>Se încarcă…</p>
              ) : (
                <>
                  <div className={styles.contractBox}>
                    <div>
                      <strong>Contract semnat:</strong>{" "}
                      {contractSummary.master ? (
                        <>
                          <a href={contractSummary.master.url} target="_blank" rel="noreferrer">Deschide PDF</a>{" "}
                          <small>
                            (semnat la {new Date((contractSummary.master.signedAt || contractSummary.master.updatedAt)).toLocaleString()})
                          </small>
                        </>
                      ) : (
                        <span>—</span>
                      )}
                    </div>
                    <div>
                      <strong>Draft curent:</strong>{" "}
                      {contractSummary.draft ? (
                        <>
                          <a href={contractSummary.draft.url} target="_blank" rel="noreferrer">Deschide PDF</a>{" "}
                          <small>
                            (actualizat la {new Date(contractSummary.draft.updatedAt).toLocaleString()})
                          </small>
                        </>
                      ) : (
                        <span>—</span>
                      )}
                    </div>
                  </div>

                  <div className={styles.actionsRow}>
                    <button type="button" className={styles.secondaryBtn} onClick={handleRegenerateDraft} disabled={docBusy.regenerate}>
                      {docBusy.regenerate ? "Se regenerează…" : "🔁 Regenerează draft"}
                    </button>

                    <button
                      type="button"
                      className={styles.secondaryBtn}
                      onClick={handleAnnexIBAN}
                      disabled={docBusy.annex || !contractSummary.master}
                      title={!contractSummary.master ? "Necesită contract semnat" : ""}
                    >
                      {docBusy.annex ? "Se generează…" : "🏦 Generează anexă IBAN"}
                    </button>

                    <button
                      type="button"
                      className={styles.secondaryBtn}
                      onClick={handleAmendmentProfile}
                      disabled={docBusy.amendment || !contractSummary.master}
                      title={!contractSummary.master ? "Necesită contract semnat" : ""}
                    >
                      {docBusy.amendment ? "Se generează…" : "✏️ Generează amendament (profil)"}
                    </button>
                  </div>

                  {!contractSummary.master && (
                    <p className={styles.hint}>
                      Nu există încă un contract semnat. Poți semna din onboarding sau, după ce regenerezi draftul, din pagina „Contract”.
                    </p>
                  )}
                </>
              )}
            </div>
          )}

          {/* ===== SECURITATE ===== */}
          {activeTab === "securitate" && (
            <form
              className={styles.form}
              onSubmit={async (e) => {
                e.preventDefault();
                const currentPassword = e.target.currentPassword.value;
                const newPassword = e.target.newPassword.value;
                const confirmPassword = e.target.confirmPassword.value;

                if (!currentPassword || !newPassword || !confirmPassword) {
                  return alert("Toate câmpurile sunt obligatorii.");
                }
                if (newPassword !== confirmPassword) {
                  return alert("Parola nouă nu coincide cu confirmarea.");
                }

                try {
                  await api.patch(
                    "/seller/password",
                    { currentPassword, newPassword },
                    { headers: { Authorization: `Bearer ${token()}` } }
                  );
                  alert("✅ Parola a fost schimbată cu succes.");
                  e.target.reset();
                } catch (err) {
                  console.error("❌ Eroare la schimbarea parolei:", err);
                  alert(errMsg(err));
                }
              }}
            >
              <label>
                Parola actuală
                <input type="password" name="currentPassword" required />
              </label>
              <label>
                Parola nouă
                <input type="password" name="newPassword" required minLength={6} />
              </label>
              <label>
                Confirmare parolă nouă
                <input type="password" name="confirmPassword" required />
              </label>
              <button type="submit" className={styles.saveBtn}>
                🔒 Schimbă parola
              </button>
            </form>
          )}
        </div>
      </div>
      <Footer />
    </>
  );
}
