// PolicyGate.jsx
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import styles from "./PolicyGate.module.css";

export default function PolicyGate({
  scope,
  isOpen,
  onClose,
  onStatusChange,
  closeOnOverlay = false,
  closeOnEsc = false,
}) {
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState("");
  const [payload, setPayload] = useState(null);

  const blocked = useMemo(() => {
    if (!payload?.requiresAction) return false;

    return (payload.documents || []).some(
      (d) => d.required && !d.alreadyAccepted
    );
  }, [payload]);


const shouldRender = isOpen;

  useEffect(() => {
    onStatusChange?.(blocked);
  }, [blocked, onStatusChange]);

  const fetchGate = async () => {
    if (!scope) return;

    setLoading(true);
    setErr("");

    try {
      const res = await fetch(
        `/api/policy-gate?scope=${encodeURIComponent(scope)}`,
        { credentials: "include" }
      );

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        console.log("POLICY GATE ERROR DATA:", data);
        throw new Error(data?.error || "gate_fetch_failed");
      }

      if (data?.notification) {
  setPayload({
    ...data,
    documents: Array.isArray(data.documents) ? data.documents : [],
  });
} else {
  setPayload(null);
}
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
  }, [scope, isOpen]);

  useEffect(() => {
    if (!shouldRender || !closeOnEsc) return;

    const onKeyDown = (e) => {
      if (e.key === "Escape" && !blocked) {
        onClose?.();
      }
    };

    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [shouldRender, closeOnEsc, blocked, onClose]);

  const handleAcceptAll = async () => {
    if (submitting || loading) return;

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
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({
          scope,
          notificationId: payload?.notification?.id || null,
          documents: pendingRequired.map((d) => d.key),
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        console.log("POLICY GATE ACCEPT ERROR DATA:", data);
        throw new Error(data?.error || "accept_failed");
      }

      await fetchGate();
      onClose?.();
    } catch (e) {
      console.error("PolicyGate accept error:", e);
      setErr("Eroare la acceptare. Încearcă din nou.");
    } finally {
      setSubmitting(false);
    }
  };

  if (!shouldRender) return null;
  if (typeof document === "undefined") return null;

  const modal = (
    <div
      className={styles.overlay}
      onMouseDown={(e) => {
        if (!closeOnOverlay || blocked) return;
        if (e.target === e.currentTarget) onClose?.();
      }}
      role="presentation"
    >
      <section
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-label="Actualizare documente legale"
      >
        <header className={styles.header}>
          <div className={styles.headerText}>
            <div className={styles.title}>
              {loading
                ? "Se încarcă…"
                : payload?.notification?.title || "Actualizare documente"}
            </div>

            {!loading ? (
              <div className={styles.message}>
                {payload?.notification?.message ||
                  "A apărut o problemă la încărcarea informării."}
              </div>
            ) : (
              <div className={styles.skeletonLine} />
            )}
          </div>

          <div className={styles.headerRight}>
            {blocked ? (
              <span className={styles.badge}>Necesită acceptare</span>
            ) : null}

            {onClose && !blocked ? (
              <button
                type="button"
                className={styles.closeBtn}
                onClick={onClose}
                aria-label="Închide"
              >
                ×
              </button>
            ) : null}
          </div>
        </header>

        <div className={styles.body}>
          {err ? <div className={styles.error}>{err}</div> : null}

          <div className={styles.sectionLabel}>Documente vizate</div>

          <div className={styles.docs}>
            {(payload?.documents || []).length ? (
              (payload?.documents || []).map((d) => (
                <div key={`${d.key}-${d.version}`} className={styles.docRow}>
                  <div className={styles.docMain}>
                    <div className={styles.docTop}>
                      <span className={styles.docTitle}>
                        {d.title || d.key}
                      </span>
                      <span className={styles.docMeta}>
                        v{d.version || "?"}
                      </span>

                      {d.required ? (
                        <span className={styles.req}>Obligatoriu</span>
                      ) : null}

                      {d.alreadyAccepted ? (
                        <span className={styles.ok}>✓ Acceptat</span>
                      ) : (
                        <span className={styles.pending}>
                          □ Necesită acceptare
                        </span>
                      )}
                    </div>

                    {d.url ? (
                      <a
                        className={styles.link}
                        href={d.url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Deschide documentul
                      </a>
                    ) : (
                      <div className={styles.muted}>Link lipsă</div>
                    )}
                  </div>
                </div>
              ))
            ) : (
              <div className={styles.muted}>
                {loading
                  ? "Se încarcă documentele…"
                  : "Nu există documente încărcate pentru această informare."}
              </div>
            )}
          </div>

          {blocked ? (
            <div className={styles.hint}>
              Unele acțiuni sunt blocate până accepți documentele obligatorii.
            </div>
          ) : (
            <div className={styles.hint}>
              Documentele obligatorii sunt acceptate sau informarea nu necesită
              acțiune.
            </div>
          )}
        </div>

        <footer className={styles.footer}>
          <button
            type="button"
            className={styles.primaryBtn}
            onClick={handleAcceptAll}
            disabled={!blocked || submitting || loading || !!err}
          >
            {submitting ? "Se acceptă…" : "Acceptă și continuă"}
          </button>

          <button
            type="button"
            className={styles.secondaryBtn}
            onClick={fetchGate}
            disabled={submitting || loading}
          >
            Reîncarcă
          </button>
        </footer>
      </section>
    </div>
  );

  return createPortal(modal, document.body);
}