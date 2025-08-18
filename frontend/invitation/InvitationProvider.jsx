import React, { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { InvitationContext } from "./InvitationContext";
import { defaultInvitation } from "./schema";
// IMPORTANT: importă din serviciul de front-end, nu dintr-un „/api/*.js” de pe backend
import { InvitationsApi } from "@/components/services/invitationsApi";

export function InvitationProvider({ children }) {
  const { draftId: draftIdFromRoute } = useParams(); // folosit când ruta e /.../editor/:draftId

  const [data, setData] = useState(defaultInvitation);
  const [draftId, setDraftId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const saveTimer = useRef(null);

  // util: set pe path "a.b.c" => value
  const update = (path, value) => {
    setData((prev) => {
      const next = structuredClone(prev);
      const keys = path.split(".");
      let ref = next;
      for (let i = 0; i < keys.length - 1; i++) {
        const k = keys[i];
        if (ref[k] == null || typeof ref[k] !== "object") ref[k] = {};
        ref = ref[k];
      }
      ref[keys.at(-1)] = value;
      return next;
    });
  };

  // autosave debounced când se schimbă data
  useEffect(() => {
    if (!draftId) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      setSaving(true);
      try {
        await InvitationsApi.updateDraft(draftId, data);
      } catch (e) {
        // poți afișa un toast aici dacă vrei
        console.error("Autosave invitație a eșuat:", e);
      } finally {
        setSaving(false);
      }
    }, 700);
    return () => clearTimeout(saveTimer.current);
  }, [data, draftId]);

  // încărcare draft când intri pe ruta cu :draftId
  useEffect(() => {
    if (!draftIdFromRoute) return;
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const res = await InvitationsApi.getDraft(draftIdFromRoute);
        if (!alive) return;
        setDraftId(res.id || draftIdFromRoute);
        setData(res.payload || defaultInvitation);
      } catch (e) {
        console.error("Load draft failed:", e);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [draftIdFromRoute]);

  // creare draft nou (dacă ai o rută care pornește fără :draftId)
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
        publish: () => draftId ? InvitationsApi.publish(draftId) : Promise.reject(new Error("Fără draftId")),
        checkout: (plan) => draftId ? InvitationsApi.checkout(draftId, plan) : Promise.reject(new Error("Fără draftId")),
      }}
    >
      {children}
    </InvitationContext.Provider>
  );
}
