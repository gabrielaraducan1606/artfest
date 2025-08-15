import React, { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import api from "../services/api";

export default function ProtectedSellerRoute({ children }) {
  const [loading, setLoading] = useState(true);
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [redirectPath, setRedirectPath] = useState("/login");

  useEffect(() => {
    const checkAuth = async () => {
      const token = localStorage.getItem("authToken");
      if (!token) {
        setRedirectPath("/login");
        setLoading(false);
        return;
      }
      try {
        const res = await api.get("/users/me", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.data?.role === "seller") {
          setIsAuthorized(true);
        } else {
          setRedirectPath("/acces-interzis");
        }
      } catch (err) {
        console.error("Eroare verificare seller:", err);
        setRedirectPath("/login");
      } finally {
        setLoading(false);
      }
    };
    checkAuth();
  }, []);

  if (loading) {
    return <p>🔄 Se verifică autentificarea...</p>;
  }

  if (!isAuthorized) {
    return <Navigate to={redirectPath} replace />;
  }

  return children;
}
