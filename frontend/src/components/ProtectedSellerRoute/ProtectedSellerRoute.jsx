import React, { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import api from "../../../api/api";

export default function ProtectedSellerRoute({ children }) {
  const [loading, setLoading] = useState(true);
  const [isSeller, setIsSeller] = useState(false);

  useEffect(() => {
    const checkAuth = async () => {
      const token = localStorage.getItem("authToken");
      if (!token) {
        setLoading(false);
        return;
      }
      try {
        const res = await api.get("/users/me", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.data?.role === "seller") {
          setIsSeller(true);
        }
      } catch (err) {
        console.error("Eroare verificare seller:", err);
      } finally {
        setLoading(false);
      }
    };
    checkAuth();
  }, []);

  if (loading) return <p>Se verifică autentificarea...</p>;

  if (!isSeller) return <Navigate to="/login" replace />;

  return children;
}
