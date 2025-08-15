import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../../../components/services/api";
import Navbar from "../../../components/HomePage/Navbar/Navbar";
import styles from "./AdaugaProdus.module.css";

const CATEGORY_OPTIONS = [
  "Invitații Nuntă",
  "Invitații Botez",
  "Mărturii Nuntă",
  "Mărturii Botez",
  "Trusou Botez",
  "Set băiță a doua zi",
  "Cutii cadou",
  "Lumânări personalizate",
  "Altele",
];

export default function AdaugaProdus() {
  const [form, setForm] = useState({
    title: "",
    price: "",
    description: "",
    category: "",
    stock: "",
  });
  const [images, setImages] = useState([]); // File[]
  const [previews, setPreviews] = useState([]); // string[]
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleImagesChange = (e) => {
    const files = Array.from(e.target.files || []);
    // limitează la max 5 imagini
    const picked = files.slice(0, 5);
    setImages(picked);
    setPreviews(picked.map((f) => URL.createObjectURL(f)));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.category) {
      alert("Te rugăm să alegi o categorie.");
      return;
    }
    if (!form.title || !form.price) {
      alert("Titlul și prețul sunt obligatorii.");
      return;
    }

    setLoading(true);
    try {
      const formData = new FormData();
      formData.append("title", form.title.trim());
      formData.append("price", Number(form.price)); // conversie numerică
      formData.append("description", form.description || "");
      formData.append("category", form.category);
      if (form.stock) formData.append("stock", Number(form.stock));

      // IMPORTANT: backend-ul tău așteaptă "images" (array), nu "image"
      images.forEach((file) => formData.append("images", file));

      await api.post("/products", formData, {
        headers: {
          Authorization: `Bearer ${localStorage.getItem("authToken")}`,
          "Content-Type": "multipart/form-data",
        },
      });

      navigate("/vanzator/produse");
    } catch (err) {
      console.error("❌ Eroare la adăugare produs:", err);
      alert(err?.response?.data?.msg || "Nu s-a putut adăuga produsul.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Navbar />
      <div className={styles.container}>
        <div className={styles.card}>
          <h2 className={styles.title}>Adaugă un produs nou</h2>

          <form onSubmit={handleSubmit} className={styles.form}>
            <label>
              Titlu produs
              <input
                type="text"
                name="title"
                value={form.title}
                onChange={handleChange}
                required
                placeholder="Ex: Invitație nuntă Floral"
              />
            </label>

            <div className={styles.row}>
              <label>
                Preț (lei)
                <input
                  type="number"
                  name="price"
                  value={form.price}
                  onChange={handleChange}
                  required
                  min="0"
                  step="0.01"
                />
              </label>

              <label>
                Stoc (opțional)
                <input
                  type="number"
                  name="stock"
                  value={form.stock}
                  onChange={handleChange}
                  min="0"
                />
              </label>
            </div>

            <label>
              Categorie
              <select
                name="category"
                value={form.category}
                onChange={handleChange}
                required
              >
                <option value="">Selectează o categorie</option>
                {CATEGORY_OPTIONS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Descriere
              <textarea
                name="description"
                value={form.description}
                onChange={handleChange}
                placeholder="Detalii despre material, dimensiuni, personalizare etc."
              ></textarea>
            </label>

            <label>
              Imagini produs (max 5)
              <input
                type="file"
                accept="image/*"
                onChange={handleImagesChange}
                multiple
              />
            </label>

            {previews.length > 0 && (
              <div className={styles.previewGrid}>
                {previews.map((src, idx) => (
                  <div key={idx} className={styles.previewItem}>
                    <img src={src} alt={`Preview ${idx + 1}`} />
                  </div>
                ))}
              </div>
            )}

            <button type="submit" className={styles.submitBtn} disabled={loading}>
              {loading ? "Se salvează..." : "Salvează produs"}
            </button>
          </form>
        </div>
      </div>
    </>
  );
}
