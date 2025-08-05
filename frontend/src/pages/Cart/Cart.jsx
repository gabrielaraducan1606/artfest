// src/pages/Cart.jsx
import React, { useEffect, useState } from "react";
import Navbar from "../../components/Navbar/Navbar";
import Footer from "../../components/Footer/Footer";
import api from "../../api";

export default function Cart() {
  const [cart, setCart] = useState([]);
  const isAuthed = !!localStorage.getItem("authToken");

  // 📌 Încărcare coș
  useEffect(() => {
    const loadCart = async () => {
      if (isAuthed) {
        try {
          const { data } = await api.get("/cart", {
            headers: { Authorization: `Bearer ${localStorage.getItem("authToken")}` },
          });
          setCart(data);
          localStorage.setItem("cart", JSON.stringify(data)); // sincronizare
        } catch (err) {
          console.error("❌ Eroare încărcare coș:", err);
        }
      } else {
        const localCart = JSON.parse(localStorage.getItem("cart") || "[]");
        setCart(localCart);
      }
    };
    loadCart();
  }, [isAuthed]);

  // 📌 Eliminare produs
  const removeFromCart = (id) => {
    const updated = cart.filter((item) => item._id !== id);
    setCart(updated);
    localStorage.setItem("cart", JSON.stringify(updated));
    if (isAuthed) {
      api.delete(`/cart/${id}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("authToken")}` },
      });
    }
  };

  return (
    <>
      <Navbar />
      <div style={{ padding: "1rem" }}>
        <h1>Coșul tău</h1>
        {cart.length === 0 ? (
          <p>Coșul este gol.</p>
        ) : (
          cart.map((item, index) => (
            <div
              key={`${item._id}-${index}`} // ✅ key unic pentru fiecare rând
              style={{ borderBottom: "1px solid #ccc", padding: "10px 0" }}
            >
              <h3>{item.title}</h3>
              <p>Cantitate: {item.quantity}</p>
              <p>Preț: {item.price} lei</p>
              <button onClick={() => removeFromCart(item._id)}>🗑️ Șterge</button>
            </div>
          ))
        )}
      </div>
      <Footer />
    </>
  );
}
