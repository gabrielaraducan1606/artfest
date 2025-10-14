import { createContext } from "react";

export const AuthCtx = createContext({
  me: undefined,        // undefined = neinițializat, null = guest, object = user
  loading: true,
  refresh: async () => {},
});
