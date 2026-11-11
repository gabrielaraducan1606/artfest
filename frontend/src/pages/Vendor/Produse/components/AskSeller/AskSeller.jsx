// „Ai întrebări? Întreabă vânzătorul” - buton secundar sub acțiunea principală
// a paginii de produs + fereastră cu formularul. Mesajul ajunge în mesageria
// Artfest (POST /api/product-contact/threads); nu afișează și nu cere date de
// contact ale vânzătorului. Informațiile GPSR rămân în secțiunea lor.
import React, { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { FaCheckCircle, FaRegCommentDots, FaShieldAlt, FaTimes } from "react-icons/fa";
import { api } from "../../../../../lib/api.js";
import { withMissingQueryParams } from "../../../../Auth/Login/loginRedirect.js";
import { buildCheckoutReferralQuery } from "../../../../../utils/referralMemory.js";
import {
  ASK_SELLER_MAX,
  ASK_SELLER_REASONS,
  buildAskSellerReturnPath,
  clearAskSellerDraft,
  describeAskSellerError,
  hasAskSellerParam,
  loadAskSellerDraft,
  newClientMessageId,
  saveAskSellerDraft,
  stripAskSellerParam,
  validateAskSeller,
} from "./askSellerDraft.js";
import styles from "./AskSeller.module.css";

export default function AskSeller({ productId, productTitle, storeName, isAuthenticated, authLoading = false }) {
  const navigate = useNavigate();
  const location = useLocation();
  const titleId = useId();

  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null); // { text, canSendToArtfest }
  const [result, setResult] = useState(null); // răspunsul API la succes
  const clientMessageIdRef = useRef(null);
  const textareaRef = useRef(null);
  const triggerRef = useRef(null);

  const openWith = useCallback((draft) => {
    setReason(draft?.reason || "");
    setMessage(draft?.message || "");
    setError(null);
    setResult(null);
    clientMessageIdRef.current = null;
    setOpen(true);
  }, []);

  // întoarcere după autentificare: redeschide fereastra cu textul păstrat
  useEffect(() => {
    if (!productId || !hasAskSellerParam(location.search)) return;
    openWith(loadAskSellerDraft(productId));
    navigate(stripAskSellerParam(location.pathname, location.search) + (location.hash || ""), { replace: true });
  }, [productId, location.pathname, location.search, location.hash, navigate, openWith]);

  const close = useCallback(() => {
    if (sending) return;
    if (!result && (reason || message.trim())) saveAskSellerDraft(productId, { reason, message });
    setOpen(false);
    setTimeout(() => triggerRef.current?.focus?.(), 0);
  }, [sending, result, reason, message, productId]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const t = setTimeout(() => textareaRef.current?.focus?.(), 30);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      clearTimeout(t);
    };
  }, [open, close]);

  const goToLogin = useCallback(() => {
    saveAskSellerDraft(productId, { reason, message });
    const back = buildAskSellerReturnPath(location.pathname, location.search);
    const redir = encodeURIComponent(withMissingQueryParams(back, buildCheckoutReferralQuery()));
    navigate(`/autentificare?redirect=${redir}`);
  }, [productId, reason, message, location.pathname, location.search, navigate]);

  const send = useCallback(
    async ({ artfestOnly = false } = {}) => {
      const invalid = validateAskSeller({ reason, message });
      if (invalid) {
        setError({ text: invalid, canSendToArtfest: false });
        return;
      }
      if (!isAuthenticated) {
        goToLogin();
        return;
      }
      if (!clientMessageIdRef.current) clientMessageIdRef.current = newClientMessageId();

      setSending(true);
      setError(null);
      try {
        const data = await api("/api/product-contact/threads", {
          method: "POST",
          body: {
            productId,
            reason,
            message: message.trim(),
            ...(artfestOnly ? { artfestOnly: true } : { clientMessageId: clientMessageIdRef.current }),
          },
        });
        clearAskSellerDraft(productId);
        setResult(data || { ok: true });
      } catch (err) {
        const info = describeAskSellerError(err);
        if (info.needsLogin) {
          goToLogin();
          return;
        }
        // mesaj modificat după o respingere -> încercare nouă, cu id nou
        clientMessageIdRef.current = null;
        setError(info);
      } finally {
        setSending(false);
      }
    },
    [reason, message, isAuthenticated, goToLogin, productId]
  );

  const onSubmit = (e) => {
    e.preventDefault();
    send();
  };

  const isSafety = reason === "SAFETY";
  const remaining = ASK_SELLER_MAX - message.length;

  const modal = open
    ? createPortal(
        <div
          className={styles.backdrop}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) close();
          }}
          data-testid="ask-seller-backdrop"
        >
          <div className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby={titleId}>
            <div className={styles.header}>
              <div>
                <h2 id={titleId} className={styles.title}>
                  Întreabă vânzătorul
                </h2>
                <p className={styles.subtitle}>
                  {productTitle ? <>Despre „{productTitle}”</> : "Despre acest produs"}
                  {storeName ? <> · {storeName}</> : null}
                </p>
              </div>
              <button type="button" className={styles.closeBtn} onClick={close} aria-label="Închide" disabled={sending}>
                <FaTimes />
              </button>
            </div>

            {result ? (
              <div className={styles.success} role="status">
                <FaCheckCircle className={styles.successIcon} aria-hidden="true" />
                {result.deliveredToVendor === false ? (
                  <>
                    <p className={styles.successTitle}>Sesizarea a fost trimisă echipei Artfest.</p>
                    <p className={styles.successText}>
                      {result.message || "Echipa Artfest o va analiza și te va contacta prin cont, dacă este nevoie."}
                    </p>
                  </>
                ) : (
                  <>
                    <p className={styles.successTitle}>Mesajul a fost trimis vânzătorului.</p>
                    <p className={styles.successText}>
                      Primești răspunsul în Mesaje.
                      {result.escalated ? " Sesizarea de siguranță a fost transmisă și echipei Artfest." : ""}
                    </p>
                  </>
                )}
                <div className={styles.actions}>
                  {result.threadId ? (
                    <Link
                      className={styles.primaryAction}
                      to={`/cont/mesaje?threadId=${encodeURIComponent(result.threadId)}`}
                    >
                      Vezi conversația
                    </Link>
                  ) : null}
                  <button type="button" className={styles.ghostAction} onClick={() => setOpen(false)}>
                    Închide
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={onSubmit} noValidate>
                <fieldset className={styles.reasons}>
                  <legend className={styles.label}>Despre ce vrei să întrebi?</legend>
                  <div className={styles.reasonList} role="radiogroup">
                    {ASK_SELLER_REASONS.map((r) => (
                      <label
                        key={r.value}
                        className={`${styles.reasonChip} ${reason === r.value ? styles.reasonChipActive : ""}`}
                      >
                        <input
                          type="radio"
                          name="ask-seller-reason"
                          value={r.value}
                          checked={reason === r.value}
                          onChange={() => {
                            setReason(r.value);
                            setError(null);
                          }}
                        />
                        {r.value === "SAFETY" ? <FaShieldAlt aria-hidden="true" /> : null}
                        {r.label}
                      </label>
                    ))}
                  </div>
                </fieldset>

                {isSafety ? (
                  <p className={styles.safetyNote}>
                    Sesizările privind siguranța produsului ajung la vânzător și, automat, la echipa Artfest.
                  </p>
                ) : null}

                <label className={styles.label} htmlFor={`${titleId}-msg`}>
                  Mesajul tău
                </label>
                <textarea
                  id={`${titleId}-msg`}
                  ref={textareaRef}
                  className={styles.textarea}
                  rows={5}
                  maxLength={ASK_SELLER_MAX}
                  value={message}
                  placeholder="De exemplu: Din ce material este? Cum se întreține?"
                  onChange={(e) => {
                    setMessage(e.target.value);
                    if (error) setError(null);
                  }}
                />
                <div className={styles.metaRow}>
                  <span className={styles.privacy}>
                    Conversația rămâne în Artfest. Nu include telefon, email sau linkuri.
                  </span>
                  <span className={styles.counter} aria-live="polite">
                    {remaining}
                  </span>
                </div>

                {error ? (
                  <div className={styles.error} role="alert">
                    <p>{error.text}</p>
                    {error.canSendToArtfest ? (
                      <button
                        type="button"
                        className={styles.ghostAction}
                        onClick={() => send({ artfestOnly: true })}
                        disabled={sending}
                      >
                        Trimite doar echipei Artfest
                      </button>
                    ) : null}
                  </div>
                ) : null}

                <div className={styles.actions}>
                  <button type="submit" className={styles.primaryAction} disabled={sending || authLoading}>
                    {sending
                      ? "Se trimite…"
                      : isAuthenticated
                        ? "Trimite mesajul"
                        : "Autentifică-te și trimite"}
                  </button>
                  <button type="button" className={styles.ghostAction} onClick={close} disabled={sending}>
                    Renunță
                  </button>
                </div>
                {!isAuthenticated && !authLoading ? (
                  <p className={styles.loginHint}>Textul tău se păstrează după autentificare.</p>
                ) : null}
              </form>
            )}
          </div>
        </div>,
        document.body
      )
    : null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={styles.trigger}
        onClick={() => openWith(loadAskSellerDraft(productId))}
        aria-haspopup="dialog"
        data-testid="ask-seller-trigger"
      >
        <FaRegCommentDots aria-hidden="true" />
        Ai întrebări? Întreabă vânzătorul
      </button>
      {modal}
    </>
  );
}
