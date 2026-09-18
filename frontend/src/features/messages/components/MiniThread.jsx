// frontend/src/features/messages/components/MiniThread.jsx
//
// FloatingHub - conversație compactă (deschisă din MiniMessages). Reutilizează
// exact useThreadMessages + useMessageSend + MessageBubble - aceleași hook-uri
// și componentă ca paginile complete de Mesaje, doar cu un CSS module propriu
// (dimensiuni compacte) și fără "load older"/pagination (scop redus deliberat,
// vezi raportul FloatingHub).
import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, Send, Loader2 } from "lucide-react";
import { useThreadMessages } from "../hooks/useThreadMessages";
import { useMessageSend } from "../hooks/useMessageSend";
import MessageBubble from "./MessageBubble";
import QuoteRequestPanel from "../../quotes/components/QuoteRequestPanel.jsx";
import QuoteOfferFormFields from "../../quotes/components/QuoteOfferFormFields.jsx";
import { useVendorQuoteOfferSubmit } from "../../quotes/hooks/useVendorQuoteOfferSubmit.js";
import styles from "./MiniMessages.module.css";

// scrollTop per thread, la nivel de modul (nu React state) - supraviețuiește
// unui unmount/remount al MiniThread în aceeași sesiune (ex. utilizatorul se
// întoarce la listă și redeschide aceeași conversație). Comutarea către tab-ul
// Asistent și înapoi NU trece pe-aici deloc - MiniThread rămâne montat, doar
// ascuns (`hidden`) în FloatingHub, deci scrollTop-ul DOM-ului e păstrat gratis.
const scrollPositions = new Map();

export default function MiniThread({ threadId, isVendor, onBack, onOpenFull }) {
  const apiBase = isVendor ? "/api/inbox" : "/api/user-inbox";

  const buildEndpoint = useCallback((id) => `${apiBase}/threads/${id}`, [apiBase]);

  const {
    loading,
    msgs,
    setMsgs,
    reload,
    threadMeta,
    quoteRequest,
  } = useThreadMessages(threadId, {
    buildEndpoint,
    // QuoteRequest există doar pe conversațiile client -> vendor
    // (/api/inbox/threads/:id, exact ce citește și Messages.jsx în
    // modul "customer") - la fel ca acolo, nu are sens pe threads
    // vendor-to-vendor (/api/inbox/vendor-threads/...).
    includeQuoteRequest: isVendor,
  });

  const [text, setText] = useState("");

  const [offerOpen, setOfferOpen] = useState(false);

  /*
   * Regulă de eligibilitate IDENTICĂ cu canSendQuoteOffer din
   * Messages.jsx (Vendor) - nicio regulă de business nouă, doar
   * copiată 1:1, ca butonul "Trimite ofertă" să apară exact în
   * aceleași condiții ca pe pagina completă.
   */
  const latestOffer = Array.isArray(quoteRequest?.offers)
    ? quoteRequest.offers[0] || null
    : null;

  const canSendOffer =
    isVendor &&
    Boolean(quoteRequest?.id) &&
    !quoteRequest?.orderId &&
    !["ACCEPTED", "CANCELLED", "EXPIRED"].includes(
      String(quoteRequest?.status || "").trim().toUpperCase()
    );

  const {
    form: offerForm,
    setForm: setOfferForm,
    sending: offerSending,
    error: offerError,
    setError: setOfferError,
    submit: submitOffer,
  } = useVendorQuoteOfferSubmit({
    quoteId: quoteRequest?.id,
    quantity: quoteRequest?.quantity,
  });

  async function handleSubmitOffer(event) {
    const ok = await submitOffer(event);

    if (ok) {
      setOfferOpen(false);
      // Sursa adevărului rămâne backend-ul - reîncărcăm thread-ul
      // (același cache/URL ca pagina completă Messages), ca
      // quoteRequest.offers să reflecte imediat oferta nou trimisă,
      // peste tot unde e deschis acest thread.
      await reload();
    }
  }

  const { sending, send, retryMessage } = useMessageSend({
    threadId,
    buildEndpoint,
    setMsgs,
    onBeforeSend: () => setText(""),
    onSuccess: async () => {
      await reload();
    },
  });

  const listRef = useRef(null);
  const restoredRef = useRef(false);

  // conversație nouă (sau primul mesaj al acesteia) - poate restaura încă
  // o dată poziția salvată, dacă există.
  useEffect(() => {
    restoredRef.current = false;
  }, [threadId]);

  // la prima randare cu mesaje pt. acest thread: restaurează scrollTop-ul
  // salvat (dacă userul a mai fost aici în această sesiune), altfel scroll
  // la ultimul mesaj ca înainte. La actualizări ulterioare (mesaj nou
  // trimis/primit) - mereu la ultimul mesaj, simplu, fără gardă de
  // "aproape de bottom" (conversație scurtă, fereastră compactă; "load
  // older" e explicit în afara scopului mini-view-ului).
  useEffect(() => {
    const el = listRef.current;
    if (!el || !msgs.length) return;

    if (!restoredRef.current) {
      const saved = scrollPositions.get(threadId);
      el.scrollTop = saved != null ? saved : el.scrollHeight;
      restoredRef.current = true;
    } else {
      el.scrollTop = el.scrollHeight;
    }
  }, [msgs, threadId]);

  // salvează scrollTop-ul curent înainte de a părăsi acest thread (schimbare
  // de threadId sau unmount la "Înapoi") - o singură sursă (Map la nivel de
  // modul), cheie = threadId.
  useEffect(() => {
    const el = listRef.current;
    return () => {
      if (el && threadId) scrollPositions.set(threadId, el.scrollTop);
    };
  }, [threadId]);

  async function handleSend() {
    await send(text);
  }

  function handleKey(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  const title = threadMeta?.storeName || threadMeta?.name || "Conversație";

  return (
    <div className={styles.miniThread}>
      <div className={styles.threadHeader}>
        <button type="button" className={styles.backBtn} onClick={onBack} aria-label="Înapoi">
          <ChevronLeft size={18} />
        </button>
        <span className={styles.threadHeaderName}>{title}</span>
      </div>

      <div className={styles.threadBody} ref={listRef}>
        {quoteRequest && (
          <QuoteRequestPanel
            quoteRequest={quoteRequest}
            latestOffer={latestOffer}
            canSendOffer={canSendOffer && !offerOpen}
            onOpenOffer={() => {
              setOfferError("");
              setOfferOpen(true);
            }}
          />
        )}

        {quoteRequest && offerOpen && (
          <QuoteOfferFormFields
            quoteRequest={quoteRequest}
            form={offerForm}
            setForm={setOfferForm}
            sending={offerSending}
            error={offerError}
            onSubmit={handleSubmitOffer}
            onCancel={() => {
              setOfferError("");
              setOfferOpen(false);
            }}
          />
        )}

        {loading && !msgs.length && <div className={styles.empty}>Se încarcă…</div>}

        {msgs.map((m) => (
          <MessageBubble
            key={m.id}
            mine={m.from === "me"}
            msg={m}
            styles={styles}
            actionIconSize={14}
            onRetry={(msg) => retryMessage(msg)}
          />
        ))}
      </div>

      <div className={styles.composer}>
        <textarea
          className={styles.composerInput}
          rows={1}
          value={text}
          placeholder="Scrie un mesaj…"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKey}
        />
        <button
          type="button"
          className={styles.composerSendBtn}
          onClick={handleSend}
          disabled={!text.trim() || sending}
        >
          {sending ? <Loader2 size={16} className={styles.spin} /> : <Send size={16} />}
        </button>
      </div>

      <button type="button" className={styles.openFullBtn} onClick={onOpenFull}>
        Deschide toate mesajele
      </button>
    </div>
  );
}
