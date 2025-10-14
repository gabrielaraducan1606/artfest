import { useCallback, useEffect, useState } from "react";
import { api } from "../../../lib/api.js";
import { AuthCtx } from "./context.js";

export default function AuthProvider({ children }) {
  const [me, setMe] = useState(undefined);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const d = await api("/api/auth/me");
   if (d?.__unauth) {
     // wrapperul api() întoarce { __unauth: true } la 401
     setMe(null);
    } else {
      setMe(d.user);
    }
    } catch {
      setMe(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return (
    <AuthCtx.Provider value={{ me, loading, refresh }}>
      {children}
    </AuthCtx.Provider>
  );
}
