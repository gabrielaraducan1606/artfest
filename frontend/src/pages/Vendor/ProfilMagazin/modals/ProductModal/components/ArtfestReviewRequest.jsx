import { useEffect, useRef, useState } from "react";

import { api } from "../../../../../../lib/api";
import { openSavedProductHelpTicket, requestArtfestHelp } from "../../../../../../utils/productHelpRequest.js";
import { newHelpRequestKey, storeSlugFromPath } from "../../../../../../utils/gpsrAddressHelp.js";
import styles from "./ProductPublishCheck.module.css";

/*
 * „Trimite la verificare Artfest” - opțional, separat de publicare: vendorul
 * nu e sigur de configurare și cere ajutorul unui om. Serverul ține o
 * singură solicitare deschisă per produs (idempotent) - vezi
 * backend/src/services/productReviewRequest.js. Se verifică versiunea
 * SALVATĂ a produsului.
 */

const NOTE_MAX = 1000;

function formatDate(value) {
  if (!value) return "";
  try {
    return new Date(value).toLocaleString("ro-RO", { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return "";
  }
}

/*
 * Produs NOU (încă nesalvat): vânzătorul care nu reușește să-l adauge singur trimite
 * un mesaj prin suportul existent („Ajutor adăugare produs”), fără să salveze produsul
 * și fără să completeze nimic obligatoriu. Succes doar după confirmarea serverului;
 * la eroare textul rămâne; o cheie per mesaj = un singur tichet la dublu-click / reîncercare.
 */
function NewProductHelp({ form, api: apiFn = api }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [status, setStatus] = useState("idle"); // idle | sending | sent
  const [error, setError] = useState("");
  const lockRef = useRef(false);
  const keyRef = useRef(null);
  const ready = note.trim().length >= 3;

  const send = async () => {
    if (lockRef.current || !ready) return;
    lockRef.current = true;
    if (!keyRef.current) keyRef.current = newHelpRequestKey();
    setStatus("sending");
    setError("");
    try {
      await requestArtfestHelp({
        api: apiFn,
        note,
        form: form || {},
        photos: Array.isArray(form?.images) ? form.images : [],
        storeSlug: storeSlugFromPath(typeof window !== "undefined" ? window.location.pathname : ""),
        source: "product_modal",
        requestKey: keyRef.current,
      });
      keyRef.current = null;
      setStatus("sent");
    } catch (e) {
      setStatus("idle");
      setError(e?.data?.message || "Nu am putut trimite solicitarea. Mesajul tău a rămas aici, încearcă din nou.");
    } finally {
      lockRef.current = false;
    }
  };

  return (
    <section className={styles.review} data-review-request data-new-product-help>
      <h4 className={styles.reviewTitle}>Nu reușești să adaugi produsul?</h4>
      {status === "sent" ? (
        <p className={styles.reviewText} role="status">
          Solicitarea a fost trimisă. Echipa Artfest îți răspunde în secțiunea Suport. Produsul nu a fost salvat: ce ai completat
          rămâne în formular.
        </p>
      ) : !open ? (
        <>
          <p className={styles.reviewText}>
            Scrie-ne cu ce ai nevoie de ajutor. Nu trebuie să salvezi produsul sau să completezi toate câmpurile.
          </p>
          <div className={styles.reviewActions}>
            <button type="button" className={styles.reviewBtn} onClick={() => setOpen(true)}>
              Cere ajutor Artfest
            </button>
          </div>
        </>
      ) : (
        <>
          <label className={styles.reviewLabel} htmlFor="artfest-new-product-help">
            Cu ce ai nevoie de ajutor?
          </label>
          <textarea
            id="artfest-new-product-help"
            className={styles.reviewTextarea}
            value={note}
            maxLength={NOTE_MAX}
            onChange={(event) => {
              keyRef.current = null; // text nou = cerere nouă
              setNote(event.target.value);
            }}
            placeholder="Ex: Nu știu cum să configurez mărimile și prețurile diferite."
          />
          <p className={styles.reviewText}>
            {note.length}/{NOTE_MAX} caractere. Mesajul ajunge integral la echipa Artfest, împreună cu ce ai completat deja (titlu,
            categorie, preț, fotografii încărcate).
          </p>
          <div className={styles.reviewActions}>
            <button type="button" className={styles.reviewBtnPrimary} onClick={send} disabled={status === "sending" || !ready}>
              {status === "sending" ? "Se trimite…" : "Trimite solicitarea"}
            </button>
            <button type="button" className={styles.reviewBtn} onClick={() => setOpen(false)} disabled={status === "sending"}>
              Renunță
            </button>
          </div>
        </>
      )}
      {error ? (
        <p className={styles.reviewError} role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}

export default function ArtfestReviewRequest({ productId, form = null }) {
  const [state, setState] = useState({ loading: !!productId, data: null });
  const [formOpen, setFormOpen] = useState(false);
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [justSent, setJustSent] = useState(false);
  const sendingRef = useRef(false);

  useEffect(() => {
    if (!productId) return undefined;
    let alive = true;

    api(`/api/vendors/products/${encodeURIComponent(productId)}/review-request`)
      .then((data) => alive && setState({ loading: false, data }))
      .catch(() => alive && setState({ loading: false, data: null }));

    return () => {
      alive = false;
    };
  }, [productId]);

  if (!productId) return <NewProductHelp form={form} />;

  if (state.loading) return null;

  const request = state.data?.reviewRequest;
  const open = Boolean(request?.open);

  const send = async () => {
    if (sendingRef.current) return; // dublu-click
    sendingRef.current = true;
    setSending(true);
    setError("");

    try {
      const data = await api(`/api/vendors/products/${encodeURIComponent(productId)}/review-request`, {
        method: "POST",
        body: { note: note.trim() },
      });
      setState({ loading: false, data });
      setFormOpen(false);
      setJustSent(true);
      // aceeași cerere și ca tichet în Admin → Suport, ca adminul să poată răspunde;
      // solicitarea e deja salvată pe produs, deci un eșec aici nu o pierde
      if (!data?.alreadyRequested) {
        openSavedProductHelpTicket({
          api,
          note,
          productId,
          title: form?.title || "",
          storeSlug: storeSlugFromPath(typeof window !== "undefined" ? window.location.pathname : ""),
          reviewRequestId: data?.reviewRequest?.id || null,
        }).catch(() => {});
      }
    } catch (e) {
      setError(e?.message || "Nu am putut trimite solicitarea. Încearcă din nou.");
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  };

  return (
    <section className={styles.review} data-review-request>
      <h4 className={styles.reviewTitle}>Nu ești sigur(ă) de configurare?</h4>

      {open ? (
        <>
          <span className={styles.reviewPending} data-review-pending>
            ⏳ În așteptarea verificării Artfest
          </span>
          <p className={styles.reviewText}>
            {justSent
              ? "Am trimis solicitarea. Echipa Artfest verifică produsul și primești o notificare când e gata."
              : `Verificare solicitată${request.requestedAt ? ` pe ${formatDate(request.requestedAt)}` : ""}.`}
            {request.note ? (
              <>
                <br />
                Mesajul tău: „{request.note}”
              </>
            ) : null}
          </p>
        </>
      ) : state.data?.blocker ? (
        <p className={styles.reviewText}>{state.data.blocker}</p>
      ) : !formOpen ? (
        <>
          <p className={styles.reviewText}>
            Echipa Artfest se poate uita peste produs și te ajută cu variantele, prețurile sau personalizarea. Nu
            este obligatoriu pentru publicare.
          </p>
          <div className={styles.reviewActions}>
            <button
              type="button"
              className={styles.reviewBtn}
              onClick={() => setFormOpen(true)}
              disabled={!state.data}
            >
              Trimite la verificare Artfest
            </button>
          </div>
          {!state.data ? <p className={styles.reviewError}>Nu am putut verifica starea solicitării.</p> : null}
        </>
      ) : (
        <>
          <label className={styles.reviewLabel} htmlFor="artfest-review-note">
            Cu ce ai nevoie de ajutor? (opțional)
          </label>
          <textarea
            id="artfest-review-note"
            className={styles.reviewTextarea}
            value={note}
            maxLength={NOTE_MAX}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Ex: Nu știu dacă am configurat corect prețurile pentru combinații."
          />
          <p className={styles.reviewText}>
            Verificăm varianta salvată a produsului - salvează întâi modificările făcute acum.
          </p>
          <div className={styles.reviewActions}>
            <button type="button" className={styles.reviewBtnPrimary} onClick={send} disabled={sending}>
              {sending ? "Se trimite…" : "Trimite solicitarea"}
            </button>
            <button type="button" className={styles.reviewBtn} onClick={() => setFormOpen(false)} disabled={sending}>
              Renunță
            </button>
          </div>
        </>
      )}

      {error ? (
        <p className={styles.reviewError} role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
