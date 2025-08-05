import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useInvitation } from "./InvitationContext";
import { defaultInvitation } from "./schema";

export function useDraftLoader(draftIdFromRoute) {
  const { createDraft, loadDraft, setLoading } = useInvitation();
  const navigate = useNavigate();

  useEffect(() => {
    let ignore = false;
    (async () => {
      if (!draftIdFromRoute) return;

      if (draftIdFromRoute === "new") {
        const id = await createDraft(defaultInvitation);
        if (!ignore) navigate(`../${id}?tab=about`, { replace: true });
      } else {
        setLoading(true);
        await loadDraft(draftIdFromRoute);
        setLoading(false);
      }
    })();
    return () => { ignore = true; };
  }, [draftIdFromRoute, createDraft, loadDraft, navigate, setLoading]);
}
