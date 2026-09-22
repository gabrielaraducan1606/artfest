import { useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../../../../../lib/api.js";
import s from "./LegalDocumentsPanel.module.css";
import {
  audienceLabel,
  buildReacceptancePayload,
  defaultReacceptanceForm,
  describeRequestResult,
  pendingOnPublished,
  validateReacceptanceForm,
} from "./legalDocumentsView.js";

/*
 * "Cere reacceptarea": document + versiune PUBLICATĂ + audiență (rândul
 * curent). Doar această acțiune poate deschide gate-ul pentru utilizatorii
 * existenți. Emailul e tranzacțional/legal, nu marketing.
 */
export default function ReacceptanceDialog({ row, onClose, onDone }) {
  const [form, setForm] = useState(() => defaultReacceptanceForm(row));
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState([]);

  if (typeof document === "undefined") return null;

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const pending = pendingOnPublished(row);

  async function submit() {
    const found = validateReacceptanceForm(form);

    setErrors(found);

    if (found.length) return;

    setBusy(true);

    try {
      const result = await api("/api/admin/legal/documents/request-reacceptance", {
        method: "POST",
        body: buildReacceptancePayload(row, form),
      });

      onDone?.(describeRequestResult(result));
    } catch (e) {
      setErrors([e?.data?.message || e?.message || "Cererea a eșuat."]);
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
        aria-label="Cere reacceptarea"
        onClick={(e) => e.stopPropagation()}
      >
        <div className={s.dialogHeader}>
          <div>
            <h3>Cere reacceptarea</h3>
            <p className={s.hint}>Doar aceasta deschide gate-ul pentru utilizatorii existenți.</p>
          </div>
        </div>

        <div className={s.dialogBody}>
          <dl className={s.summaryGrid}>
            <dt>Document</dt>
            <dd>{row.label}</dd>
            <dt>Versiune cerută</dt>
            <dd>
              <strong>{row.published?.version || "—"}</strong> (versiunea publicată)
            </dd>
            <dt>Audiență</dt>
            <dd>{audienceLabel(row.audience)}</dd>
            <dt>Vor primi cererea</dt>
            <dd>
              {pending} din {row.targetCount ?? 0} conturi (cele care nu au acceptat această versiune)
            </dd>
          </dl>

          <label className={s.check}>
            <input
              type="checkbox"
              checked={form.requiresAction}
              onChange={(e) => set({ requiresAction: e.target.checked })}
              disabled={busy}
            />
            <span>
              <strong>Acțiune obligatorie</strong> — utilizatorul vede fereastra de acceptare până
              acceptă. Dacă nu e bifat, cererea este doar informativă.
            </span>
          </label>

          <label className={s.field}>
            <span>Termen-limită (opțional)</span>
            <input
              type="date"
              value={form.deadlineAt}
              onChange={(e) => set({ deadlineAt: e.target.value })}
              disabled={busy}
            />
            <span className={s.hint}>
              Înainte de termen, acțiunile nu sunt blocate; după termen, rutele care aplică gate-ul
              pot bloca până la acceptare.
            </span>
          </label>

          <label className={s.field}>
            <span>Titlu notificare in-app</span>
            <input
              type="text"
              value={form.title}
              onChange={(e) => set({ title: e.target.value })}
              disabled={busy}
            />
          </label>

          <label className={s.field}>
            <span>Mesaj notificare in-app</span>
            <textarea
              value={form.message}
              onChange={(e) => set({ message: e.target.value })}
              disabled={busy}
            />
          </label>

          <label className={s.check}>
            <input
              type="checkbox"
              checked={form.emailEnabled}
              onChange={(e) => set({ emailEnabled: e.target.checked })}
              disabled={busy}
            />
            <span>
              Trimite și <strong>email tranzacțional</strong> (informare legală, nu marketing; se
              trimite indiferent de preferințele de marketing)
            </span>
          </label>

          {form.emailEnabled && (
            <>
              <label className={s.field}>
                <span>Subiect email</span>
                <input
                  type="text"
                  value={form.emailSubject}
                  onChange={(e) => set({ emailSubject: e.target.value })}
                  disabled={busy}
                />
              </label>

              <label className={s.field}>
                <span>Text email</span>
                <textarea
                  value={form.emailBody}
                  onChange={(e) => set({ emailBody: e.target.value })}
                  disabled={busy}
                />
                <span className={s.hint}>
                  Text simplu. Emailul include automat documentul, versiunea, termenul și un link
                  către contul utilizatorului.
                </span>
              </label>
            </>
          )}

          {errors.length > 0 && (
            <div className={s.error}>
              {errors.map((message) => (
                <div key={message}>{message}</div>
              ))}
            </div>
          )}
        </div>

        <div className={s.dialogFooter}>
          <button type="button" className={s.btn} onClick={onClose} disabled={busy}>
            Anulează
          </button>
          <button
            type="button"
            className={`${s.btn} ${s.btnPrimary}`}
            onClick={submit}
            disabled={busy}
          >
            {busy ? "Se trimite…" : "Cere reacceptarea"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
