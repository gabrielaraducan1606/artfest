// frontend/src/features/messages/components/MessageBubble.jsx
//
// ETAPA 3 (refactor comun Mesaje) - consolideaza MessageBubble din
// UserMessages.jsx si Vendor/Mesaje/Messages.jsx, care erau aproape
// identice (bulă mine/theirs, long-press pe mobil, edit inline, ticks de
// citire, meniu de acțiuni download/edit/delete).
//
// Diferențele reale, pastrate explicit ca props (nu hardcodate):
//  - User nu arată avatar pentru mesajele "theirs"; Vendor da.
//    -> `showAvatar` (default false = comportamentul User).
//  - Iconițele din meniul de acțiuni erau 14px la User, 16px la Vendor.
//    -> `actionIconSize` (default 16, Vendor trece explicit ce avea).
//  - Vendor avea deja un backdrop tap-to-close pe mobil
//    (`.msgActionsBackdrop`) pe care User nu-l cablase, deși clasa CSS
//    exista neutilizată în UserMessages.module.css. Adus la ambele -
//    strict o îmbunătățire, nu schimbă nimic pentru Vendor.
//  - Starea de "șters" (User: `msg.deleted`/`msg._deletedLocal` + text
//    placeholder client-side; Vendor: backend trimite deja body-ul
//    înlocuit) e gestionată uniform aici verificând `msg.deleted`/
//    `msg._deletedLocal` - la Vendor aceste câmpuri pur și simplu nu
//    există niciodată, deci comportamentul rămâne identic.
//
// Business logic specifică Vendorului (CRM, quote flows) NU intră aici -
// pagina Vendor randează acele blocuri separat, în jurul bulei.
//
// ETAPA 6 (retry manual pe mesaj failed) - `onRetry` e afișat DOAR pentru
// mesaje proprii (mine) cu failed===true (niciodată pentru primite,
// trimise cu succes, pending sau șterse - acele stări nu ajung pe ramura
// `mine && isFailed`). Fără alert() - starea de eroare/retrimitere e
// mereu inline, în rândul de meta (lângă oră/tick).

import { useEffect, useRef, useState } from "react";
import { Download, Pencil, Trash2, X } from "lucide-react";
import { forceDownload } from "../../../lib/forceDownload";
import { fmtTime, initialsOf } from "../utils/messageFormatters";
import MessageAttachment from "./MessageAttachment";

function isDeletedPlaceholder(m) {
  if (m?.deleted) return true;
  if (m?._deletedLocal) return true;
  return false;
}

function shouldRenderBody(msg) {
  const b = (msg?.body || "").trim();
  if (!b) return false;
  if (msg?.attachments?.length) {
    if (b === "📎 Atașament") return false;
    if (/^📎\s+\d+\s+atașamente$/i.test(b)) return false;
    if (/^📎\s+.+/.test(b) && msg.attachments.length === 1) return false;
  }
  return true;
}

export default function MessageBubble({
  mine,
  msg,
  styles,
  onEdit,
  onDelete,
  onRetry,
  showAvatar = false,
  actionIconSize = 16,
}) {
  const isPending = msg.pending;
  const isFailed = msg.failed;
  const readByPeer = !!msg.readByPeer;
  const isDeleted = isDeletedPlaceholder(msg);
  const deletedText = mine ? "Mesaj șters de tine" : "Mesaj șters";

  const atts = Array.isArray(msg?.attachments) ? msg.attachments : [];
  const hasAttachments = atts.length > 0;
  const hasBody = !isDeleted && shouldRenderBody(msg);
  const bubbleKind = hasAttachments && !hasBody ? "att" : "msg";

  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(msg.body || "");

  const [showActions, setShowActions] = useState(false);
  const pressTimerRef = useRef(null);

  const isTouchDevice =
    typeof window !== "undefined" &&
    window.matchMedia &&
    window.matchMedia("(pointer: coarse)").matches;

  const LONG_PRESS_MS = 320;

  const startPress = () => {
    if (!isTouchDevice) return;
    if (isPending) return;
    if (isEditing) return;
    if (navigator?.vibrate) navigator.vibrate(10);
    clearTimeout(pressTimerRef.current);
    pressTimerRef.current = setTimeout(() => {
      setShowActions(true);
    }, LONG_PRESS_MS);
  };

  const cancelPress = () => {
    clearTimeout(pressTimerRef.current);
    pressTimerRef.current = null;
  };

  useEffect(() => {
    setShowActions(false);
  }, [msg.id, isEditing]);

  useEffect(() => {
    setEditText(msg.body || "");
  }, [msg.body]);

  const handleDownload = async () => {
    try {
      const att = atts[0];
      if (!att) return;
      await forceDownload(att?.downloadUrl, att?.name || "atasament");
    } catch (e) {
      console.error(e);
      alert("Nu am putut descărca atașamentul.");
    }
  };

  async function saveEdit() {
    const v = (editText || "").trim();
    if (!v) return;
    await onEdit?.(v);
    setIsEditing(false);
  }

  // nu arăta edit/delete pentru mesaje locale (optimiste) sau șterse
  const canMutate =
    mine && !isPending && !isDeleted && !String(msg.id || "").startsWith("local_");
  const canShowActions =
    !isPending && (hasAttachments || (canMutate && !!onEdit && !!onDelete));

  let tickLabel = "";
  let tickClass = "";
  if (isFailed) {
    tickLabel = "!";
    tickClass = styles.readTickFailed;
  } else if (isPending) {
    tickLabel = "…";
    tickClass = styles.readTickPending;
  } else if (mine) {
    tickLabel = readByPeer ? "✓✓" : "✓";
    tickClass = readByPeer
      ? `${styles.readTick} ${styles.readTickRead}`
      : styles.readTick;
  }

  return (
    <>
      {showActions && isTouchDevice && (
        <button
          type="button"
          className={styles.msgActionsBackdrop}
          onClick={() => setShowActions(false)}
          aria-label="Închide acțiuni mesaj"
        />
      )}

      <div className={`${styles.bubbleRow} ${mine ? styles.right : styles.left}`}>
        {!mine && showAvatar && (
          <div className={styles.avatarSm}>{initialsOf(msg.authorName || "U")}</div>
        )}

        <div
          className={`${styles.bubbleWrap} ${showActions ? styles.bubbleWrapActive : ""}`}
          onTouchStart={startPress}
          onTouchEnd={cancelPress}
          onTouchMove={cancelPress}
          onTouchCancel={cancelPress}
          onContextMenu={(e) => {
            if (isTouchDevice) {
              e.preventDefault();
              if (canShowActions) setShowActions(true);
            }
          }}
        >
          <div
            className={`${styles.bubble} ${mine ? styles.mine : styles.theirs}`}
            data-state={isFailed ? "failed" : isPending ? "pending" : "ok"}
            data-kind={bubbleKind}
          >
            {isEditing ? (
              <textarea
                className={styles.editInput}
                rows={2}
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    saveEdit();
                  }
                  if (e.key === "Escape") {
                    e.preventDefault();
                    setIsEditing(false);
                    setEditText(msg.body || "");
                  }
                }}
              />
            ) : isDeleted ? (
              <div className={styles.bodyText} style={{ opacity: 0.65, fontStyle: "italic" }}>
                {deletedText}
              </div>
            ) : (
              <>
                {hasBody && <div className={styles.bodyText}>{msg.body}</div>}
                {hasAttachments && <MessageAttachment attachments={atts} styles={styles} />}
              </>
            )}

            <div className={styles.meta}>
              <span>{fmtTime(msg.createdAt)}</span>
              {mine && tickLabel && (
                <span className={tickClass} title={readByPeer ? "Citit" : "Trimis"}>
                  {tickLabel}
                </span>
              )}
              {isPending && (
                <span>{msg.retrying ? "· se retrimite…" : "· în curs…"}</span>
              )}
              {mine && isFailed && (
                <button
                  type="button"
                  className={styles.msgRetryBtn}
                  onClick={() => onRetry?.(msg)}
                >
                  ⚠ Nu s-a trimis · Reîncearcă
                </button>
              )}
            </div>
          </div>

          {canShowActions && (
            <div className={`${styles.msgActions} ${showActions ? styles.msgActionsOpen : ""}`}>
              {!isEditing ? (
                <>
                  {hasAttachments && (
                    <button
                      type="button"
                      className={styles.msgIconBtn}
                      title="Descarcă atașamentul"
                      onClick={() => {
                        setShowActions(false);
                        handleDownload();
                      }}
                    >
                      <Download size={actionIconSize} />
                    </button>
                  )}

                  {canMutate && onEdit && onDelete && (
                    <>
                      <button
                        type="button"
                        className={styles.msgIconBtn}
                        title="Editează"
                        onClick={() => {
                          setShowActions(false);
                          setIsEditing(true);
                        }}
                      >
                        <Pencil size={actionIconSize} />
                      </button>

                      <button
                        type="button"
                        className={`${styles.msgIconBtn} ${styles.msgIconBtnDanger}`}
                        title="Șterge"
                        onClick={() => {
                          setShowActions(false);
                          onDelete?.();
                        }}
                      >
                        <Trash2 size={actionIconSize} />
                      </button>
                    </>
                  )}
                </>
              ) : (
                canMutate && (
                  <>
                    <button type="button" className={styles.msgSaveBtn} onClick={saveEdit}>
                      Salvează
                    </button>
                    <button
                      type="button"
                      className={styles.msgIconBtn}
                      title="Renunță"
                      onClick={() => {
                        setIsEditing(false);
                        setEditText(msg.body || "");
                      }}
                    >
                      <X size={actionIconSize} />
                    </button>
                  </>
                )
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
