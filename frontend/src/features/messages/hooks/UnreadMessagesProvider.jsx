// frontend/src/features/messages/hooks/UnreadMessagesProvider.jsx
//
// FloatingHub - unread count comun pentru Navbar și FloatingHub. Extras
// din logica deja existentă în Navbar.jsx (fetchUnreadMessages + poll de
// 8s + listener pe "messages:changed" + refetch la visibilitychange) -
// aceleași endpointuri, exact aceeași logică per rol, doar mutată aici.
//
// De ce Context și nu un hook "plat": dacă atât Navbar cât și FloatingHub
// ar chema un hook care pornește propriul interval, ar exista DOUĂ
// poll-uri separate pentru același unread count. Provider-ul (montat o
// singură dată, în AppLayout) rulează fetch-ul și poll-ul o singură
// dată; `useUnreadMessagesCount()` (din fișierul sibling) doar citește
// din acel context, oriunde e chemat.
import { useCallback, useEffect, useState } from "react";
import { api } from "../../../lib/api";
import { useAuth } from "../../../pages/Auth/Context/context.js";
import { UnreadMessagesContext } from "./useUnreadMessagesCount";

export function UnreadMessagesProvider({ children }) {
  const { me } = useAuth();
  const [count, setCount] = useState(0);

  const fetchUnread = useCallback(async () => {
    if (!me) {
      setCount(0);
      return;
    }

    try {
      if (me.role === "USER") {
        const data = await api("/api/user-inbox/unread-count").catch(() => ({ count: 0 }));
        setCount(data?.count || 0);
        return;
      }

      if (me.role === "VENDOR") {
        const [customerMsgs, vendorThreads] = await Promise.all([
          api("/api/inbox/unread-count").catch(() => ({ count: 0 })),
          api("/api/inbox/vendor-threads?scope=unread").catch(() => ({ items: [] })),
        ]);

        const vendorUnreadCount = Array.isArray(vendorThreads?.items)
          ? vendorThreads.items.reduce((sum, t) => sum + Number(t?.unreadCount || 0), 0)
          : 0;

        setCount(Number(customerMsgs?.count || 0) + vendorUnreadCount);
        return;
      }

      // INFLUENCER/ADMIN/alte roluri: fără inbox real - vezi FloatingHub.
      setCount(0);
    } catch {
      setCount(0);
    }
  }, [me]);

  useEffect(() => {
    if (!me) {
      setCount(0);
      return undefined;
    }

    fetchUnread();

    const intervalId = window.setInterval(() => {
      if (document.visibilityState === "visible") fetchUnread();
    }, 8000);

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") fetchUnread();
    }

    function handleMessagesChanged() {
      fetchUnread();
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("messages:changed", handleMessagesChanged);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("messages:changed", handleMessagesChanged);
    };
  }, [me, fetchUnread]);

  return (
    <UnreadMessagesContext.Provider value={{ count, refresh: fetchUnread }}>
      {children}
    </UnreadMessagesContext.Provider>
  );
}
