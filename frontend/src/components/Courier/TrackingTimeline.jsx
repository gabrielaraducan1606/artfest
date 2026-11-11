// src/components/Courier/TrackingTimeline.jsx
//
// Istoricul tracking-ului unei expedieri (vendor: AwbPanel; Admin: Curieri).
// Afișează TOATE evenimentele primite, inclusiv cele care nu au schimbat
// statusul comenzii. Datele vin filtrate de server.

import {
  TRACKING_EMPTY_MESSAGE,
  hasMultipleParcels,
  newestFirst,
  trackingEventDate,
  trackingEventDetails,
  trackingEventTags,
} from "./trackingTimelineView.js";
import styles from "./TrackingTimeline.module.css";

export default function TrackingTimeline({ events, admin = false, emptyMessage = TRACKING_EMPTY_MESSAGE }) {
  const list = newestFirst(events);
  if (!list.length) return <p className={styles.empty}>{emptyMessage}</p>;
  const showParcel = admin || hasMultipleParcels(list);

  return (
    <ol className={styles.list} data-tracking-timeline>
      {list.map((ev) => {
        const details = trackingEventDetails(ev, { showParcel });
        return (
          <li key={ev.id} className={styles.item}>
            <span className={`${styles.dot} ${ev.applied ? styles.dotApplied : ""}`} aria-hidden="true" />
            <div className={styles.body}>
              <div className={styles.head}>
                <strong className={styles.label}>{ev.label || "Eveniment curier"}</strong>
                <time className={styles.date} dateTime={ev.occurredAt || undefined}>
                  {trackingEventDate(ev)}
                </time>
              </div>
              {details ? <div className={styles.details}>{details}</div> : null}
              {trackingEventTags(ev).length || admin ? (
                <div className={styles.tags}>
                  {trackingEventTags(ev).map((t) => (
                    <span key={t.key} className={`${styles.tag} ${styles[`tag_${t.tone}`]}`}>
                      {t.label}
                    </span>
                  ))}
                  {admin ? (
                    <span className={styles.meta}>
                      statusId {ev.statusId ?? "—"}
                      {ev.reasonId != null ? ` · reasonId ${ev.reasonId}` : ""}
                      {` · mapat: ${ev.mappedStatus || "nemapat"}`}
                      {ev.oohId != null ? ` · OOH ${ev.oohId}` : ""}
                      {ev.awbNumber ? ` · AWB ${ev.awbNumber}` : ""}
                    </span>
                  ) : null}
                </div>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
