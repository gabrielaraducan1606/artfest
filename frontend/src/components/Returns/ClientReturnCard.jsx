// src/components/Returns/ClientReturnCard.jsx
//
// O cerere de retur, văzută de CLIENT (cont sau guest). Mesajul de status
// vine de la backend (RETURN_STATUS_INFO): înainte de APPROVED clientul este
// rugat explicit să NU expedieze produsul; instrucțiunile și adresa de retur
// apar doar după acceptare (în mesajul vânzătorului).
//
// - client cu cont: link spre conversația comenzii (conversationLink);
// - guest: conversația de retur afișată aici + răspuns (onReply).

import { useState } from "react";
import { Link } from "react-router-dom";
import { ReturnBadge, ReturnItems } from "./ReturnParts.jsx";
import {
  CLIENT_STATUS_TONE,
  REASON_KIND_LABELS,
  formatReturnDate,
  returnStyles as styles,
} from "./returnUtils.js";

const VENDOR_MESSAGE_LABEL = {
  IN_REVIEW: "Întrebarea vânzătorului",
  APPROVED: "Instrucțiuni de retur",
  PICKUP_REQUESTED: "Instrucțiuni de retur",
  REJECTED: "Motivul respingerii",
};

function GuestReply({ onReply }) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  async function send() {
    if (!text.trim()) return;

    setSending(true);
    setError("");

    try {
      await onReply(text.trim());
      setText("");
    } catch (e) {
      setError(e?.data?.message || e?.message || "Mesajul nu a putut fi trimis.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className={styles.composer}>
      <textarea
        className={styles.textarea}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Scrie un răspuns pentru vânzător…"
        maxLength={4000}
      />
      <div className={styles.actions}>
        <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={send} disabled={sending || !text.trim()}>
          {sending ? "Se trimite…" : "Trimite răspunsul"}
        </button>
      </div>
      {error && <div className={styles.error}>{error}</div>}
    </div>
  );
}

export default function ClientReturnCard({ rr, conversationLink = null, onReply = null }) {
  const tone = CLIENT_STATUS_TONE[rr.status] || "info";
  const messages = Array.isArray(rr.messages) ? rr.messages : null;

  return (
    <article className={styles.card}>
      <div className={styles.cardHead}>
        <div>
          <div className={styles.cardTitle}>Cerere de retur #{rr.shortId}</div>
          <div className={styles.meta}>Trimisă {formatReturnDate(rr.createdAt)}</div>
        </div>
        <ReturnBadge status={rr.status} />
      </div>

      <div className={`${styles.notice} ${styles[`notice_${tone}`]}`}>{rr.statusLabel}</div>

      <ReturnItems items={rr.items} />

      <div className={styles.meta}>
        Motiv: {rr.reasonKind ? `${REASON_KIND_LABELS[rr.reasonKind]} · ` : ""}
        {rr.reasonLabel || rr.reasonCode}
      </div>

      {messages ? (
        messages.length > 0 && (
          <div className={styles.thread}>
            {messages.map((m, index) => (
              <div
                key={`${m.createdAt}-${index}`}
                className={`${styles.message} ${m.from === "CLIENT" ? styles.messageClient : ""}`}
              >
                <span className={styles.messageLabel}>
                  {m.from === "CLIENT" ? "Tu" : "Vânzătorul"} · {formatReturnDate(m.createdAt)}
                </span>
                {m.body}
              </div>
            ))}
          </div>
        )
      ) : (
        rr.lastVendorMessage && (
          <div className={styles.message}>
            <span className={styles.messageLabel}>{VENDOR_MESSAGE_LABEL[rr.status] || "Răspunsul vânzătorului"}</span>
            {rr.lastVendorMessage.body}
          </div>
        )
      )}

      {onReply && rr.status !== "CLOSED" && <GuestReply onReply={onReply} />}

      {conversationLink && (
        <div className={styles.actions}>
          <Link className={`${styles.btn}`} to={conversationLink}>
            Deschide conversația comenzii
          </Link>
        </div>
      )}
    </article>
  );
}
