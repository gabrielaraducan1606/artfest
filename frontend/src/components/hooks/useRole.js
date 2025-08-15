import { useEffect, useState } from "react";
import { getMe } from "../services/users";

export default function useRole(isAuthed) {
  const [role, setRole] = useState(null);
  useEffect(() => {
    let mounted = true;
    if (!isAuthed) { setRole(null); return; }
    getMe()
      .then((me) => mounted && setRole(me.role))
      .catch((err) => console.error("❌ Eroare rol:", err));
    return () => { mounted = false; };
  }, [isAuthed]);
  return role;
}
