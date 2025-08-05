// src/pages/Wishlist.jsx
import React, { useEffect, useState } from "react";
import Navbar from "../../components/Navbar/Navbar";
import Footer from "../../components/Footer/Footer";
import api from "../../../api/api";

export default function Wishlist() {
  const [wishlist, setWishlist] = useState([]);
  const isAuthed = !!localStorage.getItem("authToken");

  useEffect(() => {
  const loadWishlist = async () => {
    let list = [];
    if (isAuthed) {
      try {
        const { data } = await api.get("/wishlist", {
          headers: { Authorization: `Bearer ${localStorage.getItem("authToken")}` },
        });
        list = data;
      } catch (err) {
        console.error("❌ Eroare încărcare wishlist:", err);
      }
    } else {
      list = JSON.parse(localStorage.getItem("wishlist") || "[]");
    }

    // eliminăm duplicatele după _id
    const uniqueList = list.filter(
      (item, index, self) => index === self.findIndex((p) => p._id === item._id)
    );

    setWishlist(uniqueList);
    localStorage.setItem("wishlist", JSON.stringify(uniqueList));
  };
  loadWishlist();
}, [isAuthed]);

  const removeFromWishlist = (id) => {
    const updated = wishlist.filter((item) => item._id !== id);
    setWishlist(updated);
    localStorage.setItem("wishlist", JSON.stringify(updated));
    if (isAuthed) {
      api.delete(`/wishlist/${id}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("authToken")}` },
      });
    }
  };

  return (
    <>
      <Navbar />
      <div style={{ padding: "1rem" }}>
        <h1>Lista de dorințe</h1>
        {wishlist.length === 0 ? (
          <p>Lista este goală.</p>
        ) : (
          wishlist.map((item) => (
            <div key={item._id} style={{ borderBottom: "1px solid #ccc", padding: "10px 0" }}>
              <h3>{item.title}</h3>
              <p>Preț: {item.price} lei</p>
              <button onClick={() => removeFromWishlist(item._id)}>🗑️ Șterge</button>
            </div>
          ))
        )}
      </div>
      <Footer />
    </>
  );
}
