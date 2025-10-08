import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../../lib/api";

export default function StoreRedirect() {
  const navigate = useNavigate();

  useEffect(() => {
    (async () => {
      try {
        const d = await api("/api/vendors/me/services?includeProfile=1");
        const svc = (d.items || []).find(s => (s?.type?.code || s?.typeCode) === "products");
        const slug = svc?.profile?.slug;
        if (slug) navigate(`/magazin/${slug}`, { replace: true });
        else navigate("/onboarding", { replace: true });
      } catch {
        navigate("/onboarding", { replace: true });
      }
    })();
  }, [navigate]);

  return null;
}
