import { createContext, useContext } from "react";

// definim contextul care ține datele utilizatorului
export const AuthCtx = createContext({
  me: null,
  loading: true,
  refresh: () => {},
});

// hook custom care returnează valorile din context
export function useAuth() {
  return useContext(AuthCtx);
}
