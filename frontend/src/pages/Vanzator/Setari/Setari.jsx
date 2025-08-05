// src/pages/vanzator/Setari.jsx
import React, { useEffect, useState } from "react";
import Navbar from "../../../components/Navbar/Navbar";
import Footer from "../../../components/Footer/Footer";
import styles from "./Setari.module.css";
import api from "../../../api";

export default function Setari() {
  const [activeTab, setActiveTab] = useState("profil");
  const [formData, setFormData] = useState({});
  const [loading, setLoading] = useState(true);

  const tabs = [
    { key: "profil", label: "Profil magazin" },
    { key: "contact", label: "Contact" },
    { key: "politici", label: "Politici" },
    { key: "fiscal", label: "Date fiscale" },
    { key: "securitate", label: "Securitate" },
  ];

  // 📌 Încarcă setările existente
  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const { data } = await api.get("/seller/settings", {
          headers: { Authorization: `Bearer ${localStorage.getItem("authToken")}` },
        });
        setFormData(data);
      } catch (err) {
        console.error("❌ Eroare la încărcarea setărilor:", err);
      } finally {
        setLoading(false);
      }
    };
    fetchSettings();
  }, []);

  // 📌 Când utilizatorul modifică un câmp text
  const handleChange = (e) => {
    setFormData((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  // 📌 Când utilizatorul selectează o imagine
  const handleFileChange = (e) => {
    setFormData((prev) => ({ ...prev, [e.target.name]: e.target.files[0] }));
  };

  // 📌 Salvare setări
  const handleSave = async (e) => {
    e.preventDefault();
    try {
      const fd = new FormData();
      Object.keys(formData).forEach((key) => {
        if (formData[key] !== undefined && formData[key] !== null) {
          fd.append(key, formData[key]);
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

  if (loading) return <p className={styles.loading}>Se încarcă...</p>;

  return (
    <>
      <Navbar />
      <div className={styles.container}>
        <h1>Setări</h1>

        {/* TAB MENU */}
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

        {/* TAB CONTENT */}
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
                <textarea name="shortDescription" value={formData.shortDescription || ""} onChange={handleChange}></textarea>
              </label>
              <label>
                Oraș
                <input type="text" name="city" value={formData.city || ""} onChange={handleChange} />
              </label>
              <label>
                Țară
                <input type="text" name="country" value={formData.country || ""} onChange={handleChange} />
              </label>
              <button type="submit">💾 Salvează</button>
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
              <label>
                Adresă fizică
                <input type="text" name="address" value={formData.address || ""} onChange={handleChange} />
              </label>
              <button type="submit">💾 Salvează</button>
            </form>
          )}

          {activeTab === "politici" && (
            <form className={styles.form} onSubmit={handleSave}>
              <label>
                Politică de livrare
                <textarea name="deliveryNotes" value={formData.deliveryNotes || ""} onChange={handleChange}></textarea>
              </label>
              <label>
                Politică de retur
                <textarea name="returnNotes" value={formData.returnNotes || ""} onChange={handleChange}></textarea>
              </label>
              <button type="submit">💾 Salvează</button>
            </form>
          )}

          {activeTab === "fiscal" && (
            <form className={styles.form} onSubmit={handleSave}>
              <label>
                Tip entitate (PFA/SRL)
                <input type="text" name="entityType" value={formData.entityType || ""} onChange={handleChange} />
              </label>
              <label>
                CUI
                <input type="text" name="cui" value={formData.cui || ""} onChange={handleChange} />
              </label>
              <label>
                Nr. Registrul Comerțului
                <input type="text" name="registrationNumber" value={formData.registrationNumber || ""} onChange={handleChange} />
              </label>
              <label>
                IBAN
                <input type="text" name="iban" value={formData.iban || ""} onChange={handleChange} />
              </label>
              <button type="submit">💾 Salvează</button>
            </form>
          )}

          {activeTab === "securitate" && (
            <form
              className={styles.form}
              onSubmit={async (e) => {
                e.preventDefault();
                // poți crea un endpoint separat pentru schimbare parolă
              }}
            >
              <label>
                Parola actuală
                <input type="password" name="currentPassword" />
              </label>
              <label>
                Parola nouă
                <input type="password" name="newPassword" />
              </label>
              <label>
                Confirmare parolă nouă
                <input type="password" name="confirmPassword" />
              </label>
              <button type="submit">🔒 Schimbă parola</button>
            </form>
          )}
        </div>
      </div>
      <Footer />
    </>
  );
}
