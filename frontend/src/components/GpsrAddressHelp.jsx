// src/components/GpsrAddressHelp.jsx
//
// „Nu știi ce adresă să completezi? Cere ajutor Artfest”: tichet de suport, fără să salveze
// adresa. Lângă câmpul de adresă din formularele vânzătorului (doar acolo, nu și la Admin).

import { useRef, useState } from "react";

import { api as defaultApi } from "../lib/api.js";
import {
  GPSR_HELP_NOTE_MAX,
  newHelpRequestKey,
  sendGpsrHelpRequest,
  storeSlugFromPath,
} from "../utils/gpsrAddressHelp.js";
import styles from "./GpsrAddressHelp.module.css";

// Nu cere adresa: vânzătorul poate cere ajutor fără să completeze nimic în GPSR.
// `productId` = produsul editat (inclusiv o ciornă privată salvată); `draftId` = ciorna locală.
export default function GpsrAddressHelp({ storeSlug = "", productId = null, draftId = null, disabled = false, api = defaultApi }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [state, setState] = useState({ status: "idle", error: "" });
  const lockRef = useRef(false);
  // aceeași cheie la reîncercarea aceluiași mesaj: serverul nu creează un al doilea tichet
  const requestKeyRef = useRef(null);
  const sending = state.status === "sending";
  const noteReady = note.trim().length >= 3;

  const send = async () => {
    // dublu click: starea `sending` ajunge prea târziu, iar un tichet nu trebuie trimis de două ori
    if (lockRef.current || !noteReady) return;
    lockRef.current = true;
    if (!requestKeyRef.current) requestKeyRef.current = newHelpRequestKey();
    setState({ status: "sending", error: "" });
    try {
      await sendGpsrHelpRequest({
        api,
        note,
        storeSlug: storeSlug || storeSlugFromPath(typeof window !== "undefined" ? window.location.pathname : ""),
        productId,
        draftId,
        requestKey: requestKeyRef.current,
      });
      // succes doar după confirmarea serverului
      requestKeyRef.current = null;
      setState({ status: "sent", error: "" });
    } catch (error) {
      // mesajul scris rămâne, ca vânzătorul să poată reîncerca (cu aceeași cheie)
      setState({ status: "idle", error: error?.data?.message || "Nu am putut trimite mesajul. Încearcă din nou." });
    } finally {
      lockRef.current = false;
    }
  };

  return (
    <div className={styles.wrap} data-testid="gpsr-address-help">
      {state.status === "sent" ? (
        <p className={styles.sent} role="status">
          Solicitarea a fost trimisă. Echipa Artfest îți răspunde în secțiunea Suport. Nu am salvat nicio adresă.
        </p>
      ) : (
        <button type="button" className={styles.link} aria-expanded={open} onClick={() => setOpen((value) => !value)}>
          Nu știi ce adresă să completezi? Cere ajutor Artfest
        </button>
      )}

      {open && state.status !== "sent" && (
        <div className={styles.form}>
          <label className={styles.label} htmlFor="gpsr-help-note">
            Spune-ne pe scurt ce nu este clar
          </label>
          <textarea
            id="gpsr-help-note"
            className={styles.textarea}
            rows={3}
            maxLength={GPSR_HELP_NOTE_MAX}
            value={note}
            placeholder="Ex: Lucrez de acasă și nu știu dacă pot folosi această adresă."
            onChange={(event) => {
              // text nou = cerere nouă (cheia veche rămâne doar pentru reîncercarea aceluiași text)
              requestKeyRef.current = null;
              setNote(event.target.value);
            }}
          />
          <p className={styles.hint}>
            {note.length}/{GPSR_HELP_NOTE_MAX} caractere. Nu trebuie să completezi adresa ca să ceri ajutor. Datele contului și ale
            magazinului ajung automat la echipa Artfest.
          </p>
          {state.error && (
            <p className={styles.error} role="alert">
              {state.error}
            </p>
          )}
          {disabled && <p className={styles.hint}>Previzualizare: mesajul nu se trimite.</p>}
          <button type="button" className={styles.send} onClick={send} disabled={disabled || sending || !noteReady}>
            {sending ? "Se trimite…" : "Trimite solicitarea"}
          </button>
        </div>
      )}
    </div>
  );
}
