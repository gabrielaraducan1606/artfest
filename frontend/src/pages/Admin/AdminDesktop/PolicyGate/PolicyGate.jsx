// PolicyGate.jsx
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import styles from "./PolicyGate.module.css";

/**
 * Props:
 * - scope: "USERS" | "VENDORS"
 * - isOpen: boolean
 * - onClose?: () => void               // dacă vrei să permită închiderea (opțional)
 * - onStatusChange?: (blocked: boolean) => void
 * - closeOnOverlay?: boolean (default true)
 * - closeOnEsc?: boolean (default true)
 */
export default function PolicyGate({
  scope,
  isOpen,
  onClose,
  onStatusChange,
  closeOnOverlay = true,
  closeOnEsc = true,
}) {
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState("");
  const [payload, setPayload] = useState(null);

  const blocked = useMemo(() => {
    if (!payload) return false;
    if (!payload.requiresAction) return false;
    const docs = payload.documents || [];
    return docs.some((d) => d.required && !d.alreadyAccepted);
  }, [payload]);

  useEffect(() => {
    onStatusChange?.(blocked);
  }, [blocked, onStatusChange]);

  const fetchGate = async () => {
    setLoading(true);
    setErr("");
    try {
      const res = await fetch(
        `/api/policy-gate?scope=${encodeURIComponent(scope)}`,
        { method: "GET", credentials: "include" }
      );

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || "gate_fetch_failed");
      }

      const data = await res.json();
      setPayload(data);
    } catch (e) {
      console.error("PolicyGate fetch error:", e);
      setErr("Nu am putut încărca informarea de politici.");
      setPayload(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    fetchGate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, scope]);

  useEffect(() => {
    if (!isOpen || !closeOnEsc) return;

    const onKeyDown = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, closeOnEsc, onClose]);

  const handleAcceptAll = async () => {
    setSubmitting(true);
    setErr("");

    try {
      const pendingRequired = (payload?.documents || []).filter(
        (d) => d.required && !d.alreadyAccepted
      );

      if (!pendingRequired.length) {
        await fetchGate();
        return;
      }

      const res = await fetch("/api/policy-gate/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          scope,
          documents: pendingRequired.map((d) => ({
            key: d.key,
            version: d.version,
            checksum: d.checksum || null,
          })),
          notificationId: payload?.notification?.id || null,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || "accept_failed");
      }

      await fetchGate();
      // dacă nu mai e blocked, poți închide automat
      // (decomentază dacă vrei comportamentul ăsta)
      // if (!blocked) onClose?.();
    } catch (e) {
      console.error("PolicyGate accept error:", e);
      setErr("Eroare la acceptare. Încearcă din nou.");
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen) return null;
  if (typeof document === "undefined") return null;

  // Dacă nu există nimic de arătat, nu afișăm modalul
  if (!loading && (!payload || !payload.notification || !(payload.documents || []).length)) {
    return null;
  }

  const modal = (
    <div
      className={styles.overlay}
      onMouseDown={(e) => {
        if (!closeOnOverlay) return;
        if (e.target === e.currentTarget) onClose?.();
      }}
      role="presentation"
    >
      <section className={styles.modal} role="dialog" aria-modal="true" aria-label="Actualizare documente legale">
        <header className={styles.header}>
          <div className={styles.headerText}>
            <div className={styles.title}>
              {loading ? "Se încarcă…" : payload?.notification?.title || "Actualizare documente"}
            </div>
            {!loading ? (
              <div className={styles.message}>{payload?.notification?.message}</div>
            ) : (
              <div className={styles.skeletonLine} />
            )}
          </div>

          <div className={styles.headerRight}>
            {blocked ? <span className={styles.badge}>Necesită acceptare</span> : null}
            {onClose ? (
              <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="Închide">
                ×
              </button>
            ) : null}
          </div>
        </header>

        <div className={styles.body}>
          {err ? <div className={styles.error}>{err}</div> : null}

          <div className={styles.sectionLabel}>Documente vizate</div>

          <div className={styles.docs}>
            {(payload?.documents || []).map((d) => (
              <div key={d.key} className={styles.docRow}>
                <div className={styles.docMain}>
                  <div className={styles.docTop}>
                    <span className={styles.docTitle}>{d.title || d.key}</span>
                    <span className={styles.docMeta}>v{d.version || "?"}</span>
                    {d.required ? <span className={styles.req}>Obligatoriu</span> : null}
                    {d.alreadyAccepted ? <span className={styles.ok}>Acceptat</span> : null}
                  </div>

                  {d.url ? (
                    <a className={styles.link} href={d.url} target="_blank" rel="noreferrer">
                      Deschide documentul
                    </a>
                  ) : (
                    <div className={styles.muted}>Link lipsă</div>
                  )}
                </div>

                {!d.alreadyAccepted && d.required ? (
                  <span className={styles.pending}>În așteptare</span>
                ) : null}
              </div>
            ))}
          </div>

          {blocked ? (
            <div className={styles.hint}>
              Unele acțiuni sunt blocate până accepți documentele obligatorii.
            </div>
          ) : null}
        </div>

        <footer className={styles.footer}>
          <button
            type="button"
            className={styles.primaryBtn}
            onClick={handleAcceptAll}
            disabled={!blocked || submitting}
          >
            {submitting ? "Se acceptă…" : "Acceptă și continuă"}
          </button>

          <button
            type="button"
            className={styles.secondaryBtn}
            onClick={fetchGate}
            disabled={submitting}
          >
            Reîncarcă
          </button>
        </footer>
      </section>
    </div>
  );

  return createPortal(modal, document.body);
}
