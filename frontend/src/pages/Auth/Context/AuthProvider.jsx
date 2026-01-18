// AuthProvider.jsx (sau: pages/Auth/Context/context provider file)

import { useCallback, useEffect, useState } from "react";
import { api } from "../../../lib/api.js";
import { AuthCtx } from "./context.js";

export default function AuthProvider({ children }) {
  const [me, setMe] = useState(undefined); // undefined = încărcare inițială
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const d = await api("/api/auth/me");
      // dacă e ok, backend întoarce { user: ... }
      setMe(d?.user ?? null);
    } catch (e) {
      // doar aici interpretăm 401 ca “neautentificat”
      if (e?.status === 401) {
        setMe(null);
      } else {
        // dacă vrei să NU deloghezi userul pe erori temporare (500/network),
        // poți păstra me-ul existent:
        // setMe((prev) => (prev === undefined ? null : prev));
        setMe(null);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <AuthCtx.Provider value={{ me, loading, refresh }}>
      {children}
    </AuthCtx.Provider>
  );
}
