// frontend/src/features/messages/hooks/useUnreadMessagesCount.js
//
// FloatingHub - context + hook de unread count comun pentru Navbar și
// FloatingHub (vezi UnreadMessagesProvider.jsx pentru componenta care
// deține fetch-ul/poll-ul). Fișier separat de Provider (componentă) ca
// să respecte regula react-refresh/only-export-components - un fișier nu
// trebuie să exporte deodată o componentă și alte funcții/constante.
import { createContext, useContext } from "react";

export const UnreadMessagesContext = createContext({ count: 0, refresh: () => {} });

export function useUnreadMessagesCount() {
  return useContext(UnreadMessagesContext);
}
