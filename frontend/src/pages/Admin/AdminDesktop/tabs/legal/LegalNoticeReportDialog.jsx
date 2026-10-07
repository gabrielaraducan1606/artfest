import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../../../../../lib/api.js";
import s from "./LegalDocumentsPanel.module.css";

function formatDateTime(value) {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("ro-RO");
}

/*
 * „Vezi raport” pentru un preaviz / o notificare de actualizare: cine a
 * inițiat, câți destinatari, livrate / eșuate (din EmailLog) și
 * „Retrimite eșuate” - care atinge DOAR adresele eșuate.
 */
export default function LegalNoticeReportDialog({ campaignId, onClose, onChanged }) {
  const [report, setReport] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      setReport(await api(`/api/admin/legal/notices/${encodeURIComponent(campaignId)}/report`));
      setError("");
    } catch (e) {
      setError(e?.data?.message || e?.message || "Nu am putut încărca raportul.");
    }
  }, [campaignId]);

  useEffect(() => {
    load();
  }, [load]);

  if (typeof document === "undefined") return null;

  async function resendFailed() {
    setBusy(true);
    setMessage("");

    try {
      const result = await api(`/api/admin/legal/notices/${encodeURIComponent(campaignId)}/resend-failed`, {
        method: "POST",
      });
      setMessage(`Retrimise: ${result.sent} livrate, ${result.failed} eșuate.`);
      await load();
      onChanged?.();
    } catch (e) {
      setError(e?.data?.message || e?.message || "Retrimiterea a eșuat.");
    } finally {
      setBusy(false);
    }
  }

  const isNotice = report?.kind === "notice";

  return createPortal(
    <div className={s.overlay} onClick={busy ? undefined : onClose}>
      <div
        className={s.dialog}
        role="dialog"
        aria-modal="true"
        aria-label="Raport trimitere"
        onClick={(e) => e.stopPropagation()}
      >
        <div className={s.dialogHeader}>
          <div>
            <h3>{isNotice ? "Raport preaviz" : "Raport notificare de actualizare"}</h3>
            {report?.subject && <p className={s.hint}>{report.subject}</p>}
          </div>
        </div>

        <div className={s.dialogBody}>
          {report && (
            <>
              <dl className={s.summaryGrid}>
                <dt>Trimis la</dt>
                <dd>{formatDateTime(report.createdAt)}</dd>
                <dt>Inițiat de</dt>
                <dd>{report.createdByEmail || "—"}</dd>
                <dt>Documente</dt>
                <dd>{report.documents.map((d) => `${d.key} v${d.version}`).join(", ")}</dd>
                <dt>Destinatari</dt>
                <dd>{report.recipients}</dd>
                <dt>Livrate</dt>
                <dd>{report.delivered}</dd>
                <dt>Eșuate</dt>
                <dd>{report.failed}</dd>
              </dl>

              {report.exception && <div className={s.callout}>{report.exception}</div>}

              {report.failedRecipients.length > 0 && (
                <div>
                  <strong>Eșuate</strong>
                  {report.failedRecipients.map((r) => (
                    <div key={r.email} className={s.campaignRow}>
                      <span>{r.email}</span>
                      <span className={s.key}>
                        {r.error} · {formatDateTime(r.at)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {message && <div className={s.notice}>{message}</div>}
          {error && <div className={s.error}>{error}</div>}
        </div>

        <div className={s.dialogFooter}>
          <button type="button" className={s.btn} onClick={onClose} disabled={busy}>
            Închide
          </button>
          {report?.failed > 0 && (
            <button type="button" className={`${s.btn} ${s.btnPrimary}`} onClick={resendFailed} disabled={busy}>
              {busy ? "Se retrimite…" : `Retrimite eșuate (${report.failed})`}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
