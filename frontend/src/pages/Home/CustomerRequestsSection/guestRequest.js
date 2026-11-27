// src/pages/Home/CustomerRequestsSection/guestRequest.js
//
// Cereri de ofertă fără cont - apeluri API + hook-uri. Funcțiile pure sunt
// în guestRequestUtils.js (re-exportate aici).

import { useEffect, useState } from "react";

import { api } from "../../../lib/api";
import { LINK_ACCOUNT_STORAGE_KEY } from "./guestRequestUtils.js";

export * from "./guestRequestUtils.js";

function storage() {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/* =========================================================
   API
========================================================= */

export const guestApi = {
  config: () => api("/customer-requests/guest/config"),
  submit: (body) => api("/customer-requests/guest/submit", { method: "POST", body }),
  confirm: (token) => api("/customer-requests/guest/confirm", { method: "POST", body: { token } }),
  access: (token) => api("/customer-requests/guest/access", { method: "POST", body: { token } }),
  accessLink: (email) => api("/customer-requests/guest/access-link", { method: "POST", body: { email } }),
  me: () => api("/customer-requests/guest/me"),
  logout: () => api("/customer-requests/guest/logout", { method: "POST" }),
  linkAccount: () => api("/customer-requests/guest/link-account", { method: "POST" }),
  uploadImage: (requestId, file) => {
    const form = new FormData();
    form.append("file", file);
    return api(`/customer-requests/guest/requests/${encodeURIComponent(requestId)}/images`, { method: "POST", body: form });
  },
  deleteImage: (requestId, url) =>
    api(`/customer-requests/guest/requests/${encodeURIComponent(requestId)}/images`, { method: "DELETE", body: { url } }),
};

let configPromise = null;

/* Fluxul fără cont e activ? (o singură cerere pe sesiunea paginii) */
export function useGuestRequestsEnabled() {
  const [enabled, setEnabled] = useState(null);

  useEffect(() => {
    let active = true;
    configPromise ||= guestApi.config().catch(() => ({ enabled: false }));
    configPromise.then((result) => {
      if (active) setEnabled(Boolean(result?.enabled));
    });
    return () => {
      active = false;
    };
  }, []);

  return enabled;
}

/*
 * Utilizator autentificat: cererile trimise fără cont cu ACELAȘI email,
 * verificat, trec în cont (serverul verifică tot). O dată pe tab.
 */
export async function linkGuestRequestsOnce(userId, { store = storage() } = {}) {
  if (!userId) return { linked: 0, skipped: true };
  const key = `${LINK_ACCOUNT_STORAGE_KEY}:${userId}`;
  try {
    if (store?.getItem(key)) return { linked: 0, skipped: true };
    const result = await guestApi.linkAccount();
    store?.setItem(key, "1");
    return { linked: Number(result?.linked) || 0 };
  } catch {
    return { linked: 0, failed: true };
  }
}
