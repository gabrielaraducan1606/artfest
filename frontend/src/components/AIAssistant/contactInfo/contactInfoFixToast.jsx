// src/components/AIAssistant/contactInfo/contactInfoFixToast.jsx

/*
 * Mesajul afișat când o salvare e blocată de contact info guard: textul
 * primit de la server + UN SINGUR CTA, „Corectează cu ajutorul
 * asistentului”, care deschide Asistentul EXISTENT (VendorAssistant, prin
 * FloatingHub) cu contextul exact al erorii.
 *
 * Folosește ToastContainer-ul deja montat global (App.jsx).
 */

import { toast } from "react-toastify";

import {
  CONTACT_FIX_CTA_LABEL,
  buildTaskFromError,
  isContactInfoError,
  openVendorAssistantTask,
} from "./contactInfoFixFlow.js";

/*
 * Întoarce true dacă eroarea era una de date de contact (și a fost
 * afișată), false altfel - apelantul își păstrează tratarea obișnuită.
 */
export function showContactInfoFix(error) {
  if (!isContactInfoError(error)) return false;

  const task = buildTaskFromError(error);

  const toastId = toast.warn(
    <div style={{ display: "grid", gap: 8 }}>
      <span>{error.data.message}</span>
      <button
        type="button"
        onClick={() => {
          toast.dismiss(toastId);
          openVendorAssistantTask(task);
        }}
        style={{
          justifySelf: "start",
          border: 0,
          borderRadius: 8,
          padding: "6px 10px",
          background: "#111827",
          color: "#fff",
          cursor: "pointer",
          fontWeight: 600,
        }}
      >
        {CONTACT_FIX_CTA_LABEL}
      </button>
    </div>,
    { autoClose: false, closeOnClick: false }
  );

  return true;
}
