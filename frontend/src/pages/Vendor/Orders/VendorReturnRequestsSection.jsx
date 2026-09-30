// src/pages/Vendor/Orders/VendorReturnRequestsSection.jsx

/*
 * „Cereri de retur” în pagina comenzii vânzătorului. Datele vin din
 * GET /api/vendor/orders/:id (returnRequests, cu allowedActions calculate
 * server-side pe statusurile existente); acțiunile folosesc
 * POST /api/vendor/orders/:id/returns/:returnId/:action. Butoanele afișate
 * sunt EXCLUSIV cele din allowedActions - nicio regulă nouă în frontend.
 * Conversația cu clientul rămâne cea a comenzii (Mesaje). Nicio acțiune de
 * aici nu face refund - rambursarea se procesează separat (admin / COD).
 */

import { useState } from "react";
import { Link } from "react-router-dom";

import { api } from "../../../lib/api";
import { ReturnBadge, ReturnItems, ReturnPhotos } from "../../../components/Returns/ReturnParts.jsx";
import {
  REASON_KIND_LABELS,
  formatReturnDate,
  returnStyles as styles,
} from "../../../components/Returns/returnUtils.js";

const ACTIONS = {
  accept: {
    label: "Acceptă returul",
    tone: "btnSuccess",
    needsText: false,
    placeholder: "Instrucțiuni pentru client (opțional) - adresa de retur din profil se adaugă automat",
    hint: "Clientul primește acum instrucțiunile și adresa de retur, în conversație și pe email.",
  },
  request_info: {
    label: "Cere informații",
    tone: "",
    needsText: true,
    placeholder: "Ce informații ai nevoie de la client?",
    hint: "Clientul este rugat să răspundă și să nu expedieze încă produsul.",
  },
  reject: {
    label: "Respinge",
    tone: "btnDanger",
    needsText: true,
    placeholder: "Motivul respingerii (îl vede clientul)",
    hint: "Motivul este trimis clientului. Neconformitatea unui produs personalizat nu poate fi respinsă doar pentru că este personalizat.",
  },
  received: {
    label: "Am primit produsul",
    tone: "btnPrimary",
    needsText: false,
    placeholder: "Observații (opțional)",
    hint: "Cererea se închide; rambursarea se procesează separat.",
  },
};

function ReturnCard({ orderId, rr, onChanged }) {
  const [pending, setPending] = useState(null); // acțiunea deschisă
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const allowed = Array.isArray(rr.allowedActions) ? rr.allowedActions : [];

  async function submit() {
    const action = ACTIONS[pending];
    if (!action) return;

    if (action.needsText && !text.trim()) {
      setError("Completează mesajul pentru client.");
      return;
    }

    setSaving(true);
    setError("");

    try {
      await api(`/api/vendor/orders/${encodeURIComponent(orderId)}/returns/${encodeURIComponent(rr.id)}/${pending}`, {
        method: "POST",
        body: { message: text.trim() },
      });

      setPending(null);
      setText("");
      await onChanged?.();
    } catch (e) {
      setError(e?.data?.message || e?.message || "Acțiunea nu a putut fi salvată.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <article className={styles.card}>
      <div className={styles.cardHead}>
        <div>
          <div className={styles.cardTitle}>Cerere de retur #{rr.shortId}</div>
          <div className={styles.meta}>
            Solicitată {formatReturnDate(rr.createdAt)}
            {rr.guest ? " · client fără cont" : ""}
          </div>
        </div>
        <ReturnBadge status={rr.status} />
      </div>

      <div className={styles.facts}>
        <div className={styles.fact}>
          <span className={styles.factLabel}>Motiv</span>
          {rr.reasonKind ? `${REASON_KIND_LABELS[rr.reasonKind]} · ` : ""}
          {rr.reasonLabel || rr.reasonCode}
          {rr.reasonText ? ` - ${rr.reasonText}` : ""}
        </div>
        <div className={styles.fact}>
          <span className={styles.factLabel}>Status</span>
          {rr.statusLabel}
        </div>
      </div>

      <ReturnItems items={rr.items} />

      {rr.notesUser && (
        <div className={`${styles.message} ${styles.messageClient}`}>
          <span className={styles.messageLabel}>Mesajul clientului</span>
          {rr.notesUser}
        </div>
      )}

      <ReturnPhotos photos={rr.photos || []} />

      {rr.lastVendorMessage && (
        <div className={styles.message}>
          <span className={styles.messageLabel}>
            Ultimul tău mesaj despre retur · {formatReturnDate(rr.lastVendorMessage.createdAt)}
          </span>
          {rr.lastVendorMessage.body}
        </div>
      )}

      {rr.status === "CLOSED" && (
        <div className={`${styles.notice} ${styles.notice_warning}`}>
          Rambursarea nu se face din această pagină: la plata cu cardul o procesează echipa Artfest; la ramburs (COD),
          rambursarea către client o faci tu, în afara platformei.
        </div>
      )}

      <div className={styles.actions}>
        {allowed.map((key) => (
          <button
            key={key}
            type="button"
            disabled={saving}
            className={`${styles.btn} ${ACTIONS[key]?.tone ? styles[ACTIONS[key].tone] : ""} ${
              pending === key ? styles.btnActive : ""
            }`}
            onClick={() => {
              setPending(pending === key ? null : key);
              setText("");
              setError("");
            }}
          >
            {ACTIONS[key]?.label || key}
          </button>
        ))}

        <Link
          className={`${styles.btn} ${styles.btnGhost}`}
          to={rr.threadId ? `/mesaje?threadId=${encodeURIComponent(rr.threadId)}` : "/mesaje"}
        >
          Conversația cu clientul →
        </Link>
      </div>

      {pending && ACTIONS[pending] && (
        <div className={styles.composer}>
          <div className={styles.hint}>{ACTIONS[pending].hint}</div>
          <textarea
            className={styles.textarea}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={ACTIONS[pending].placeholder}
            maxLength={2000}
          />
          <div className={styles.actions}>
            <button
              type="button"
              className={`${styles.btn} ${styles[ACTIONS[pending].tone] || styles.btnPrimary}`}
              disabled={saving || (ACTIONS[pending].needsText && !text.trim())}
              onClick={submit}
            >
              {saving ? "Se salvează…" : `Confirmă: ${ACTIONS[pending].label}`}
            </button>
            <button type="button" className={styles.btn} disabled={saving} onClick={() => setPending(null)}>
              Renunță
            </button>
          </div>
        </div>
      )}

      {error && <div className={styles.error}>{error}</div>}
    </article>
  );
}

export default function VendorReturnRequestsSection({ order, onChanged }) {
  const list = Array.isArray(order?.returnRequests) ? order.returnRequests : [];

  if (!list.length) return null;

  return (
    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <h3 className={styles.sectionTitle}>Cereri de retur</h3>
        <span className={styles.count}>{list.length}</span>
      </div>

      {list.map((rr) => (
        <ReturnCard key={rr.id} orderId={order.id} rr={rr} onChanged={onChanged} />
      ))}
    </section>
  );
}
