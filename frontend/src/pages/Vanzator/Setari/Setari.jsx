import React, { useEffect, useState, useMemo } from "react";
import Navbar from "../../../components/HomePage/Navbar/Navbar";
import Footer from "../../../components/HomePage/Footer/Footer";
import styles from "./Setari.module.css";
import api from "../../../components/services/api";

const ABOUT_MAX = 1200;

export default function Setari() {
  const [activeTab, setActiveTab] = useState("profil");
  const [formData, setFormData] = useState({});
  const [tagsInput, setTagsInput] = useState("");
  const [loading, setLoading] = useState(true);

  const tabs = [
    { key: "profil", label: "Profil magazin" },
    { key: "contact", label: "Contact" },
    { key: "politici", label: "Politici" },
    { key: "fiscal", label: "Date fiscale" },
    { key: "securitate", label: "Securitate" },
  ];

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const { data } = await api.get("/seller/settings", {
          headers: { Authorization: `Bearer ${localStorage.getItem("authToken")}` },
        });
        setFormData(data || {});
      } catch (err) {
        console.error("❌ Eroare la încărcarea setărilor:", err);
      } finally {
        setLoading(false);
      }
    };
    fetchSettings();
  }, []);

  const handleChange = (e) => {
    const { name, value } = e.target;
    if (name === "about") {
      const limited = value.slice(0, ABOUT_MAX);
      setFormData((prev) => ({ ...prev, about: limited }));
      return;
    }
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleFileChange = (e) => {
    setFormData((prev) => ({ ...prev, [e.target.name]: e.target.files[0] }));
  };

  const handleSave = async (e) => {
    e.preventDefault();
    try {
      const fd = new FormData();

      Object.entries(formData).forEach(([key, val]) => {
        if (val !== undefined && val !== null) {
          if (Array.isArray(val)) {
            fd.append(key, JSON.stringify(val));
          } else {
            fd.append(key, val);
          }
        }
      });

      await api.patch("/seller/settings", fd, {
        headers: {
          Authorization: `Bearer ${localStorage.getItem("authToken")}`,
          "Content-Type": "multipart/form-data",
        },
      });

      alert("✅ Setările au fost salvate!");
    } catch (err) {
      console.error("❌ Eroare la salvarea setărilor:", err);
      alert("Eroare la salvarea datelor");
    }
  };

  const aboutCount = useMemo(() => (formData.about?.length || 0), [formData.about]);

  const handleTagKeyDown = (e) => {
    if ((e.key === "Enter" || e.key === ",") && tagsInput.trim()) {
      e.preventDefault();
      const newTag = tagsInput.trim().replace(",", "");
      if (newTag && !formData.tags?.includes(newTag)) {
        setFormData((prev) => ({
          ...prev,
          tags: [...(prev.tags || []), newTag],
        }));
      }
      setTagsInput("");
    }
  };

  const removeTag = (indexToRemove) => {
    setFormData((prev) => ({
      ...prev,
      tags: prev.tags.filter((_, i) => i !== indexToRemove),
    }));
  };

  if (loading) return <p className={styles.loading}>Se încarcă...</p>;

  return (
    <>
      <Navbar />
      <div className={styles.container}>
        <h1>Setări</h1>

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
          {activeTab === "profil" && (
            <form className={styles.form} onSubmit={handleSave}>
              <label>
                Logo magazin
                <input type="file" name="profileImage" accept="image/*" onChange={handleFileChange} />
              </label>

              <label>
                Imagine cover
                <input type="file" name="coverImage" accept="image/*" onChange={handleFileChange} />
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

              <button type="submit" className={styles.saveBtn}>💾 Salvează</button>
            </form>
          )}

          {activeTab === "contact" && (
            <form className={styles.form} onSubmit={handleSave}>
              <label>
                Email public
                <input type="email" name="email" value={formData.email || ""} onChange={handleChange} />
              </label>
              <label>
                Telefon
                <input type="tel" name="phone" value={formData.phone || ""} onChange={handleChange} />
              </label>
              <button type="submit" className={styles.saveBtn}>💾 Salvează</button>
            </form>
          )}

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
    <button type="submit" className={styles.saveBtn}>💾 Salvează</button>
  </form>
)}

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
        value={formData.registrationNumber || ""}
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
    <button type="submit" className={styles.saveBtn}>💾 Salvează</button>
  </form>
)}

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
          {
            headers: {
              Authorization: `Bearer ${localStorage.getItem("authToken")}`,
            },
          }
        );
        alert("✅ Parola a fost schimbată cu succes.");
        e.target.reset();
      } catch (err) {
        console.error("❌ Eroare la schimbarea parolei:", err);
        alert(
          err.response?.data?.msg ||
            "A apărut o eroare. Încearcă din nou mai târziu."
        );
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
