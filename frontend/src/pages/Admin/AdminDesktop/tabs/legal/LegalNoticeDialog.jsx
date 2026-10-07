import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../../../../../lib/api.js";
import s from "./LegalDocumentsPanel.module.css";
import {
  canSendNotice,
  describeNoticeResult,
  formatDaysLeft,
  roleLabel,
} from "./legalDocumentsView.js";

function formatDay(value) {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? String(value)
    : d.toLocaleDateString("ro-RO", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Bucharest" });
}

/*
 * „Trimite preaviz” (kind="notice") / „Trimite notificare de actualizare”
 * (kind="update"). Încarcă PREVIEW-ul (nimic nu se trimite) și trimite DOAR
 * după confirmarea explicită. Preavizul nu activează documentele și nu cere
 * acceptare. `previewOnly` = doar „Preview email”, fără buton de trimitere.
 */
export default function LegalNoticeDialog({ kind = "notice", previewOnly = false, onClose, onDone }) {
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [role, setRole] = useState("");
  const [exception, setException] = useState({ confirmed: false, reason: "" });

  const isNotice = kind === "notice";
  const title = isNotice ? "Trimite preaviz" : "Trimite notificare de actualizare";

  useEffect(() => {
    let alive = true;

    api(`/api/admin/legal/notices/preview?kind=${encodeURIComponent(kind)}`)
      .then((data) => {
        if (!alive) return;
        setPreview(data);
        setRole(data?.samples?.[0]?.role || "");
      })
      .catch((e) => alive && setError(e?.data?.message || e?.message || "Nu am putut încărca previzualizarea."))
      .finally(() => alive && setLoading(false));

    return () => {
      alive = false;
    };
  }, [kind]);

  if (typeof document === "undefined") return null;

  const sample = preview?.samples?.find((x) => x.role === role) || preview?.samples?.[0] || null;
  const tooShort = isNotice && preview && !preview.noticePeriodOk;
  const canSend = !previewOnly && canSendNotice(preview, exception);

  async function submit() {
    setBusy(true);
    setError("");

    try {
      const result = await api("/api/admin/legal/notices/send", {
        method: "POST",
        body: {
          kind,
          confirm: true,
          ...(tooShort ? { exception } : {}),
        },
      });

      onDone?.(describeNoticeResult(result));
    } catch (e) {
      setError(e?.data?.message || e?.message || "Trimiterea a eșuat.");
    } finally {
      setBusy(false);
    }
  }

  return createPortal(
    <div className={s.overlay} onClick={busy ? undefined : onClose}>
      <div
        className={s.dialog}
        role="dialog"
        aria-modal="true"
        aria-label={previewOnly ? "Preview email" : title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={s.dialogHeader}>
          <div>
            <h3>{previewOnly ? "Preview email" : title}</h3>
            <p className={s.hint}>
              {isNotice
                ? "Informare înainte de intrarea în vigoare. Nu activează documentele și nu cere acceptare."
                : "Informare după intrarea în vigoare. Acceptarea apare doar dacă ai cerut-o separat (Cere reacceptarea)."}
            </p>
          </div>
        </div>

        <div className={s.dialogBody}>
          {loading && <p className={s.hint}>Se încarcă previzualizarea…</p>}

          {preview && (
            <>
              <dl className={s.summaryGrid}>
                <dt>Documente</dt>
                <dd>
                  {preview.documents.length ? (
                    <ul className={s.noticeDocs}>
                      {preview.documents.map((doc) => (
                        <li key={doc.key}>
                          <strong>{doc.title}</strong> · v{doc.version}
                          {doc.currentVersion && <> (în vigoare: v{doc.currentVersion})</>}{" "}
                          <a href={doc.url} target="_blank" rel="noreferrer">
                            {isNotice ? "vezi v" + doc.version : "vezi documentul"}
                          </a>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    "—"
                  )}
                </dd>

                {isNotice && (
                  <>
                    <dt>Intră în vigoare</dt>
                    <dd>
                      <strong>{formatDay(preview.effectiveAt)}</strong> · {formatDaysLeft(preview.daysUntilEffective)}
                    </dd>
                  </>
                )}

                <dt>Audiență</dt>
                <dd>
                  {Object.entries(preview.recipients?.byRole || {})
                    .map(([r, n]) => `${roleLabel(r)}: ${n}`)
                    .join(" · ") || "—"}
                </dd>

                <dt>Destinatari estimați</dt>
                <dd>
                  <strong>{preview.recipients?.total ?? 0}</strong> (un singur email per persoană, cu toate
                  documentele relevante rolului)
                  {preview.recipients?.withoutEmail > 0 && <> · {preview.recipients.withoutEmail} conturi fără email</>}
                </dd>
              </dl>

              {preview.blockers?.length > 0 && (
                <div className={s.error}>
                  {preview.blockers.map((b) => (
                    <div key={b}>{b}</div>
                  ))}
                </div>
              )}

              {tooShort && preview.available && (
                <div className={s.callout}>
                  <strong>
                    Atenție: {formatDaysLeft(preview.daysUntilEffective)} până la intrarea în vigoare (minimum{" "}
                    {preview.minNoticeDays} zile).
                  </strong>{" "}
                  Trimiterea e blocată. Continuă doar dacă modificarea intră într-un caz exceptat de lege și
                  descrie motivul.
                  {!previewOnly && (
                    <>
                      <label className={s.check} style={{ marginTop: 8 }}>
                        <input
                          type="checkbox"
                          checked={exception.confirmed}
                          onChange={(e) => setException((x) => ({ ...x, confirmed: e.target.checked }))}
                          disabled={busy}
                        />
                        <span>Confirm că se aplică o excepție legală de la termenul de preaviz.</span>
                      </label>
                      <label className={s.field}>
                        <span>Motivul excepției (obligatoriu)</span>
                        <input
                          type="text"
                          value={exception.reason}
                          onChange={(e) => setException((x) => ({ ...x, reason: e.target.value }))}
                          disabled={busy}
                        />
                      </label>
                    </>
                  )}
                </div>
              )}

              {sample && (
                <div className={s.noticePreview}>
                  <div className={s.tabs} role="tablist" aria-label="Previzualizare pe audiență">
                    {preview.samples.map((x) => (
                      <button
                        key={x.role}
                        type="button"
                        role="tab"
                        aria-selected={x.role === sample.role}
                        className={`${s.btn} ${x.role === sample.role ? s.btnPrimary : ""}`}
                        onClick={() => setRole(x.role)}
                      >
                        {roleLabel(x.role)} · {x.recipients ?? 0} destinatari
                      </button>
                    ))}
                  </div>

                  <dl className={s.summaryGrid}>
                    <dt>Subiect</dt>
                    <dd>
                      <strong>{sample.subject}</strong>
                    </dd>
                    <dt>Documente incluse</dt>
                    <dd>
                      <ul className={s.noticeDocs}>
                        {(sample.documentDetails || []).map((d) => (
                          <li key={d.key}>
                            {d.title} · v{d.version}
                            {d.currentVersion && <> (în vigoare: v{d.currentVersion})</>}
                            {d.effectiveAt && <> · {isNotice ? "intră în vigoare la" : "în vigoare din"} {formatDay(d.effectiveAt)}</>}
                            {d.reacceptanceRequired && <> · necesită acceptare</>}
                          </li>
                        ))}
                      </ul>
                    </dd>
                    <dt>Rezumat</dt>
                    <dd>
                      {(sample.documentDetails || []).some((d) => d.changeSummary) ? (
                        (sample.documentDetails || [])
                          .filter((d) => d.changeSummary)
                          .map((d) => (
                            <div key={d.key}>
                              <strong>{d.title}:</strong> {d.changeSummary}
                            </div>
                          ))
                      ) : (
                        <span className={s.hint}>
                          Fără rezumat (changeSummary necompletat în manifest) — blocul „Principalele modificări” nu
                          apare.
                        </span>
                      )}
                    </dd>
                  </dl>
                  <iframe
                    title="Previzualizare email"
                    className={s.noticeFrame}
                    sandbox=""
                    srcDoc={sample.html}
                  />
                </div>
              )}
            </>
          )}

          {error && <div className={s.error}>{error}</div>}
        </div>

        <div className={s.dialogFooter}>
          <button type="button" className={s.btn} onClick={onClose} disabled={busy}>
            {previewOnly ? "Închide" : "Anulează"}
          </button>
          {!previewOnly && (
            <button
              type="button"
              className={`${s.btn} ${s.btnPrimary}`}
              onClick={submit}
              disabled={busy || !canSend}
            >
              {busy ? "Se trimite…" : `${title} (${preview?.recipients?.total ?? 0})`}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
