import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../../../api";
import Navbar from "../../../components/Navbar/Navbar";
import styles from "./ProduseleMele.module.css";

export default function ProduseleMele() {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  const fetchProducts = async () => {
    try {
      const { data } = await api.get("/products/my", {
        headers: { Authorization: `Bearer ${localStorage.getItem("authToken")}` },
      });
      setProducts(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("❌ Eroare la încărcarea produselor:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProducts();
  }, []);

  const handleDelete = async (id) => {
    if (!window.confirm("Sigur vrei să ștergi acest produs?")) return;
    try {
      await api.delete(`/products/${id}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("authToken")}` },
      });
      setProducts((prev) => prev.filter((p) => p._id !== id));
    } catch (err) {
      console.error("❌ Eroare la ștergere:", err);
      alert("Nu am putut șterge produsul");
    }
  };

  if (loading) return <div className={styles.loading}>Se încarcă...</div>;

  return (
    <>
      <Navbar />
      <div className={styles.container}>
        <div className={styles.header}>
          <h2 className={styles.title}>Produsele mele</h2>
          {products.length > 0 && (
            <button
              className={styles.addBtn}
              onClick={() => navigate("/vanzator/adauga-produs")}
            >
              ➕ Adaugă produs
            </button>
          )}
        </div>

        {products.length === 0 ? (
          <div className={styles.emptyState}>
            <h3>Nu ai adăugat încă niciun produs</h3>
            <p>Începe să vinzi adăugând primul tău produs în platformă.</p>
            <button
              className={styles.bigAddBtn}
              onClick={() => navigate("/vanzator/adauga-produs")}
            >
              ➕ Adaugă primul produs
            </button>
          </div>
        ) : (
          <div className={styles.grid}>
            {products.map((prod) => (
              <div key={prod._id} className={styles.card}>
                {prod.image ? (
                  <img src={prod.image} alt={prod.title} className={styles.image} />
                ) : (
                  <div className={styles.noImage}>Fără imagine</div>
                )}
                <div className={styles.cardBody}>
                  <h4 className={styles.cardTitle}>{prod.title}</h4>
                  <p className={styles.price}>{prod.price} lei</p>
                  <p className={styles.desc}>
                    {prod.description
                      ? prod.description.substring(0, 80) + "..."
                      : "Fără descriere"}
                  </p>
                  <div className={styles.actions}>
                    <button
                      className={styles.editBtn}
                      onClick={() =>
                        navigate(`/vanzator/editeaza-produs/${prod._id}`)
                      }
                    >
                      ✏️ Editează
                    </button>
                    <button
                      className={styles.deleteBtn}
                      onClick={() => handleDelete(prod._id)}
                    >
                      🗑️ Șterge
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
