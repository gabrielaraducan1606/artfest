import { useCallback, useEffect, useState } from "react";
import { api } from "../../lib/api";

// ajustează importul ăsta la calea ta reală (e desktop-ul actual de vendor)
import VendorDesktop from "../Vendor/Desktop/Desktop"; // <- dacă la tine e alt path, schimbă-l

import UserDesktop from "../User/UserDesktop/UserDesktop";

export default function Desktop() {
  const [me, setMe] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await api("/api/auth/me").catch(()=>null);
      setMe(d?.user || null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div style={{ padding: 16 }}>Se încarcă…</div>;
  if (!me) return (
    <div style={{ padding: 16 }}>
      Nu ești autentificat. <a href="/autentificare">Autentifică-te</a>.
    </div>
  );

  if (me.role === "VENDOR") return <VendorDesktop />;
  if (me.role === "ADMIN")  return <VendorDesktop />; // sau <AdminDesktop/> dacă ai unul separat
  return <UserDesktop me={me} />; // rol: USER
}
