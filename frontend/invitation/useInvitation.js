import { useContext } from "react";
import { InvitationContext } from "./InvitationContext";

export const useInvitation = () => {
  const ctx = useContext(InvitationContext);
  if (!ctx) {
    throw new Error("useInvitation must be used inside <InvitationProvider>");
  }
  return ctx;
};
