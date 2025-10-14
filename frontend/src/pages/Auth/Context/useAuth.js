import { useContext } from "react";
import { AuthCtx } from "./context";

export function useAuth() {
  return useContext(AuthCtx);
}
