import React from "react";
import styles from "./SupportTicketList.module.css";

function formatDate(value) {
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

export default function SupportTicketList({
  tickets = [],
  onSelect,
  onCreate,
}) {
  if (!tickets.length) {
    return (
      <div className={styles.empty}>
        <strong>Nu ai solicitări de suport</strong>

        <p>
          Atunci când ai nevoie de ajutor, poți începe o
          conversație direct din asistent.
        </p>

        <button type="button" onClick={onCreate}>
          Creează o solicitare
        </button>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      {tickets.map((ticket) => (
        <button
          key={ticket.id}
          type="button"
          className={styles.ticket}
          onClick={() => onSelect(ticket)}
        >
          <div className={styles.header}>
            <strong>{ticket.subject}</strong>

            <span
              className={`${styles.status} ${
                styles[ticket.status] || ""
              }`}
            >
              {ticket.statusLabel}
            </span>
          </div>

          <div className={styles.footer}>
            <span>{ticket.priorityLabel}</span>
            <time>{formatDate(ticket.updatedAt)}</time>
          </div>
        </button>
      ))}
    </div>
  );
}