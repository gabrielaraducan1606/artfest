import React from "react";
import styles from "./SupportThread.module.css";

function formatMessageDate(value) {
  if (!value) {
    return "";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return new Intl.DateTimeFormat("ro-RO", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export default function SupportThread({
  ticket,
  messages = [],
}) {
  return (
    <section className={styles.thread}>
      <header className={styles.header}>
        <div>
          <span>Conversație cu suportul</span>
          <strong>
            {ticket?.subject || "Solicitare de suport"}
          </strong>
        </div>

        {ticket?.statusLabel && (
          <span
            className={`${styles.status} ${
              styles[ticket.status] || ""
            }`}
          >
            {ticket.statusLabel}
          </span>
        )}
      </header>

      <div className={styles.messages}>
        {!messages.length && (
          <p className={styles.empty}>
            Conversația nu conține încă mesaje.
          </p>
        )}

        {messages.map((message) => {
          const isUser = message.role === "user";

          return (
            <article
              key={message.id}
              className={`${styles.message} ${
                isUser ? styles.user : styles.support
              }`}
            >
              <div className={styles.author}>
                {isUser ? "Tu" : "Suport Artfest"}
              </div>

              <p>{message.content}</p>

              {message.attachments?.length > 0 && (
                <div className={styles.attachments}>
                  {message.attachments.map(
                    (attachment, index) => (
                      <a
                        key={`${attachment.url}-${index}`}
                        href={attachment.url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {attachment.name ||
                          `Fișier ${index + 1}`}
                      </a>
                    )
                  )}
                </div>
              )}

              <time>
                {formatMessageDate(message.createdAt)}
              </time>
            </article>
          );
        })}
      </div>
    </section>
  );
}