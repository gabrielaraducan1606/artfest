import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../../../api";
import Navbar from "../../../components/Navbar/Navbar";
import styles from "./AdaugaProdus.module.css";

export default function AdaugaProdus() {
  const [form, setForm] = useState({
    title: "",
    price: "",
    description: "",
    image: null,
  });
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleImageChange = (e) => {
    const file = e.target.files[0];
    setForm((prev) => ({ ...prev, image: file }));
    setPreview(file ? URL.createObjectURL(file) : null);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      const formData = new FormData();
      formData.append("title", form.title);
      formData.append("price", form.price);
      formData.append("description", form.description);
      if (form.image) formData.append("image", form.image);

      await api.post("/products", formData, {
        headers: {
          Authorization: `Bearer ${localStorage.getItem("authToken")}`,
          "Content-Type": "multipart/form-data",
        },
      });

      navigate("/vanzator/produse");
    } catch (err) {
      console.error("❌ Eroare la adăugare produs:", err);
      alert("Nu s-a putut adăuga produsul.");
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
              />
            </label>

            <label>
              Preț (lei)
              <input
                type="number"
                name="price"
                value={form.price}
                onChange={handleChange}
                required
              />
            </label>

            <label>
              Descriere
              <textarea
                name="description"
                value={form.description}
                onChange={handleChange}
              ></textarea>
            </label>

            <label>
              Imagine produs
              <input type="file" accept="image/*" onChange={handleImageChange} />
            </label>

            {preview && (
              <div className={styles.preview}>
                <img src={preview} alt="Preview produs" />
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
