import { createContext, useContext } from "react";

export const InvitationContext = createContext(null);

export function useInvitation() {
  const ctx = useContext(InvitationContext);
  if (!ctx) throw new Error("useInvitation trebuie folosit în interiorul <InvitationProvider>");
  return ctx;
}

// alias pentru compatibilitate cu cod existent (dacă ai folosit useInvitations)
export function useInvitations() {
  return useInvitation();
}
