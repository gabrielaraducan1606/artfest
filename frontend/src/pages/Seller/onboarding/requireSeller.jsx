import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../../components/services/api";
import { useAppContext } from "../../components/Context/useAppContext";

/**
 * Protejează rutele doar pentru SELLER și poate redirecționa
 * - către login dacă nu e autentificat
 * - către /vanzator/dashboard dacă onboarding-ul e complet
 */
export default function RequireSeller({ children }) {
  const { token } = useAppContext();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    const checkSeller = async () => {
      if (!token) {
        navigate("/login?redirect=" + encodeURIComponent(window.location.pathname), { replace: true });
        return;
      }
      try {
        const { data } = await api.get("/users/me"); // trebuie să returneze { role, onboardingCompleted? }
        if (data.role !== "seller") {
          navigate("/", { replace: true });
          return;
        }
        // dacă ai câmp în backend gen "onboardingCompleted"
        if (data.onboardingCompleted) {
          navigate("/vanzator/dashboard", { replace: true });
          return;
        }
      } catch (err) {
        console.error("RequireSeller:", err);
        navigate("/login", { replace: true });
        return;
      } finally {
        if (mounted) setLoading(false);
      }
    };

    checkSeller();
    return () => { mounted = false; };
  }, [token, navigate]);

  if (loading) {
    return <div style={{ padding: "2rem", textAlign: "center" }}>Se verifică accesul...</div>;
  }

  return <>{children}</>;
}
