import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import api from "../../../api";
import Navbar from "../../../components/Navbar/Navbar";
import styles from "./EditeazaProdus.module.css";

export default function EditeazaProdus() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    title: "",
    price: "",
    description: "",
    image: null,
  });
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);

  // 📥 Încarcă produsul existent
  useEffect(() => {
    const fetchProduct = async () => {
      try {
        const { data } = await api.get(`/products/${id}`, {
          headers: { Authorization: `Bearer ${localStorage.getItem("authToken")}` },
        });
        setForm({
          title: data.title || "",
          price: data.price || "",
          description: data.description || "",
          image: null,
        });

        if (data.image) {
          const absoluteUrl = data.image.startsWith("http")
            ? data.image
            : `${api.defaults.baseURL.replace("/api", "")}${data.image}`;
          setPreview(absoluteUrl);
        } else {
          setPreview(null);
        }
      } catch (err) {
        console.error("❌ Eroare la încărcarea produsului:", err);
        alert("Produsul nu a putut fi încărcat.");
        navigate("/vanzator/produse");
      }
    };
    fetchProduct();
  }, [id, navigate]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleImageChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      setForm((prev) => ({ ...prev, image: file }));
      setPreview(URL.createObjectURL(file));
    }
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

      await api.put(`/products/${id}`, formData, {
        headers: {
          Authorization: `Bearer ${localStorage.getItem("authToken")}`,
          "Content-Type": "multipart/form-data",
        },
      });

      navigate("/vanzator/produse");
    } catch (err) {
      console.error("❌ Eroare la editare produs:", err);
      alert("Nu s-a putut salva modificarea produsului.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Navbar />
      <div className={styles.container}>
        <div className={styles.card}>
          <h2 className={styles.title}>Editează produsul</h2>
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
              Imagine produs (opțional)
              <input type="file" accept="image/*" onChange={handleImageChange} />
            </label>

            {preview && (
              <div className={styles.preview}>
                <img src={preview} alt="Preview produs" />
              </div>
            )}

            <button type="submit" className={styles.submitBtn} disabled={loading}>
              {loading ? "Se salvează..." : "Salvează modificările"}
            </button>
          </form>
        </div>
      </div>
    </>
  );
}
