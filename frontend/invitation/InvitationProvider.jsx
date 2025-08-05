import React, { useEffect, useRef, useState } from "react";
import { InvitationContext } from "./InvitationContext";
import { defaultInvitation } from "./schema";
import { InvitationsApi } from "../api/invitationsApi";

export function InvitationProvider({ children }) {
  const [data, setData] = useState(defaultInvitation);
  const [draftId, setDraftId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const saveTimer = useRef(null);

  const update = (path, value) => {
    setData(prev => {
      const next = structuredClone(prev);
      const keys = path.split(".");
      let ref = next;
      for (let i = 0; i < keys.length - 1; i++) ref = ref[keys[i]];
      ref[keys.at(-1)] = value;
      return next;
    });
  };

  useEffect(() => {
    if (!draftId) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      setSaving(true);
      try {
        await InvitationsApi.updateDraft(draftId, data);
      } finally {
        setSaving(false);
      }
    }, 700);
  }, [data, draftId]);

  const createDraft = async (initial = defaultInvitation) => {
    const { id } = await InvitationsApi.createDraft(initial);
    setDraftId(id);
    setData(initial);
    return id;
  };

  const loadDraft = async (id) => {
    setLoading(true);
    try {
      const { payload } = await InvitationsApi.getDraft(id);
      setDraftId(id);
      setData(payload || defaultInvitation);
    } finally {
      setLoading(false);
    }
  };

  return (
    <InvitationContext.Provider
      value={{
        data, setData,
        draftId, setDraftId,
        saving, loading, setLoading,
        update,
        createDraft,
        loadDraft,
        publish: () => InvitationsApi.publish(draftId),
        checkout: (plan) => InvitationsApi.checkout(draftId, plan),
      }}
    >
      {children}
    </InvitationContext.Provider>
  );
}
