import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../../lib/api";

/*
 * Redirect inteligent pentru VENDOR (audit navigare 2026-09-14):
 *
 * - 0 magazine ("products")  -> /onboarding (flow de creare/configurare)
 * - 1 magazin                -> direct în profilul acelui magazin
 * - 2+ magazine               -> "Magazinele mele" (/vendor/stores)
 *
 * NU alegem arbitrar primul magazin când sunt mai multe - nu există
 * (încă) un concept de magazin principal/default în date, deci lăsăm
 * vendorul să aleagă explicit din listă în acel caz.
 *
 * Reutilizează STRICT endpoint-ul deja existent
 * (/api/vendors/me/services?includeProfile=1) - același folosit și
 * de VendorStoresPage.jsx - fără cod/rută nouă pe backend.
 */
export default function StoreRedirect() {
  const navigate = useNavigate();

  useEffect(() => {
    (async () => {
      try {
        const d = await api("/api/vendors/me/services?includeProfile=1");

        const productStores = (d.items || []).filter(
          (s) => (s?.type?.code || s?.typeCode) === "products"
        );

        if (productStores.length === 0) {
          navigate("/onboarding", { replace: true });
          return;
        }

        if (productStores.length === 1) {
          const slug = productStores[0]?.profile?.slug;

          if (slug) {
            navigate(`/magazin/${slug}`, { replace: true });
          } else {
            // Magazin creat, dar profil incomplet - același fallback
            // ca înainte.
            navigate("/onboarding", { replace: true });
          }

          return;
        }

        navigate("/vendor/stores", { replace: true });
      } catch {
        navigate("/onboarding", { replace: true });
      }
    })();
  }, [navigate]);

  return null;
}
