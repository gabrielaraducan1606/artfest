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
  } = useThreadMessages(threadId, {
    buildEndpoint,
    includeQuoteRequest: false,
  });

  const [text, setText] = useState("");

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
