// frontend/src/features/messages/components/MiniMessages.jsx
//
// FloatingHub - vedere compactă de mesaje pentru tab-ul "Mesaje" din hub.
// Reutilizează useMessageThreads (același hook ca paginile complete),
// nu duplică logica de fetch/poll/search.
//
// Scop deliberat redus (cerut explicit - "nu complica"): arată DOAR
// thread-urile de tip client (customer) - fără CRM, fără toggle
// customer/vendor-to-vendor, fără grupare pe magazin, fără filtre.
// Pentru orice altceva -> "Deschide toate mesajele" (pagina completă).
import { useCallback, useEffect, useState } from "react";
import { MessageSquare } from "lucide-react";
import { useMessageThreads } from "../hooks/useMessageThreads";
import { prefetchThreadMessages } from "../hooks/threadMessagesCache";
import { fmtTime, initialsOf } from "../utils/messageFormatters";
import MiniThread from "./MiniThread";
import styles from "./MiniMessages.module.css";

export default function MiniMessages({ me, onOpenFull }) {
  const isVendor = me?.role === "VENDOR";
  const apiBase = isVendor ? "/api/inbox" : "/api/user-inbox";

  const buildUrl = useCallback(
    () => `${apiBase}/threads?scope=all`,
    [apiBase]
  );

  // Aceeași bază ca MiniThread (`${apiBase}/threads/${id}`) - cheia
  // cache-ului de mesaje per thread, ca prefetch-ul de-aici să fie exact
  // ce citește MiniThread la deschidere.
  const buildThreadEndpoint = useCallback((id) => `${apiBase}/threads/${id}`, [apiBase]);

  const { loading, items, reload } = useMessageThreads({ q: "", buildUrl });

  // Prefetch automat DOAR pentru un singur thread - primul cu unread, sau
  // (dacă nu există unread) cel mai recent (primul din listă). Nu
  // preîncărcăm toate conversațiile. `prefetchThreadMessages` respectă
  // deja TTL intern - re-rularea la fiecare actualizare a listei (poll)
  // e ieftină (no-op dacă threadul țintă e deja fresh).
  useEffect(() => {
    if (!items.length) return;
    const target = items.find((t) => Number(t.unreadCount || 0) > 0) || items[0];
    const targetId = target?.id || target?.threadId;
    if (!targetId) return;
    prefetchThreadMessages(buildThreadEndpoint(targetId));
  }, [items, buildThreadEndpoint]);

  // Prefetch la intenție, per rând - pointerenter (hover desktop), focus
  // (tastatură) și pointerdown (acoperă touchstart pe mobil, ca la bula
  // FloatingHub). Nu blochează scroll-ul/click-ul - doar pornește (sau se
  // leagă de) un fetch în paralel.
  const handleRowIntentPrefetch = useCallback(
    (id) => {
      if (!id) return;
      prefetchThreadMessages(buildThreadEndpoint(id));
    },
    [buildThreadEndpoint]
  );

  const [selectedThreadId, setSelectedThreadId] = useState(null);

  if (selectedThreadId) {
    return (
      <MiniThread
        threadId={selectedThreadId}
        isVendor={isVendor}
        onBack={() => {
          setSelectedThreadId(null);
          reload();
        }}
        onOpenFull={onOpenFull}
      />
    );
  }

  return (
    <div className={styles.miniMessages}>
      <div className={styles.header}>
        <span className={styles.headerTitle}>Mesaje</span>
        <span className={styles.headerSubtitle}>Conversațiile tale</span>
      </div>

      <div className={styles.threadList}>
        {loading && items.length === 0 && (
          <div className={styles.empty}>Se încarcă…</div>
        )}

        {!loading && items.length === 0 && (
          <div className={styles.empty}>Nu ai conversații încă.</div>
        )}

        {items.map((t) => {
          const name = t.name || t.storeName || "Conversație";
          const unread = Number(t.unreadCount || 0);
          const rowThreadId = t.id || t.threadId;

          return (
            <button
              key={rowThreadId}
              type="button"
              className={styles.threadRow}
              onClick={() => setSelectedThreadId(rowThreadId)}
              onPointerEnter={() => handleRowIntentPrefetch(rowThreadId)}
              onFocus={() => handleRowIntentPrefetch(rowThreadId)}
              onPointerDown={() => handleRowIntentPrefetch(rowThreadId)}
            >
              <div className={styles.avatar}>
                {/* Pentru User, `name` e magazinul -> logo-ul se potrivește.
                    Pentru Vendor, `name` e clientul -> nu există poză, doar
                    inițiale (logo-ul de serviciu ar fi înșelător aici). */}
                {!isVendor && t.storeLogoUrl ? (
                  <img src={t.storeLogoUrl} alt="" />
                ) : (
                  initialsOf(name)
                )}
              </div>

              <div className={styles.threadInfo}>
                <div className={styles.threadTop}>
                  <span className={styles.threadName}>{name}</span>
                  <span className={styles.threadTime}>{fmtTime(t.lastAt)}</span>
                </div>

                <div className={styles.threadBottom}>
                  <span className={styles.threadPreview}>{t.lastMsg || "—"}</span>
                  {unread > 0 && (
                    <span className={styles.threadBadge}>{Math.min(unread, 99)}</span>
                  )}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      <button type="button" className={styles.openFullBtn} onClick={onOpenFull}>
        <MessageSquare size={14} />
        Deschide toate mesajele
      </button>
    </div>
  );
}
