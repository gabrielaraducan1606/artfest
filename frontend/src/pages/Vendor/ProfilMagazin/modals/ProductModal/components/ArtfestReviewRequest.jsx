import { useEffect, useRef, useState } from "react";

import { api } from "../../../../../../lib/api";
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

export default function ArtfestReviewRequest({ productId }) {
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

  if (!productId) {
    return (
      <section className={styles.review} data-review-request>
        <h4 className={styles.reviewTitle}>Nu ești sigur(ă) de configurare?</h4>
        <p className={styles.reviewText}>
          După ce salvezi produsul, poți cere ajutorul echipei Artfest din editarea lui („Trimite la verificare
          Artfest”).
        </p>
      </section>
    );
  }

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
