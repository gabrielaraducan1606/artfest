import { useCallback, useEffect, useState } from "react";
import { api } from "../../lib/api";

import VendorDesktop from "../Vendor/Desktop/Desktop";
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
  return <UserDesktop me={me} />;
}
