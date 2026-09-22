import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../../../../../lib/api.js";
import s from "./LegalDocumentsPanel.module.css";
import {
  audienceLabel,
  buildPublishOptions,
  buildPublishPayload,
  defaultPublishVersion,
} from "./legalDocumentsView.js";

/*
 * "Publică versiunea": face o versiune din manifest ACTIVĂ (pagina publică
 * + conturi noi). NU cere reacceptare de la utilizatorii existenți - asta
 * se face separat, prin "Cere reacceptarea".
 */
export default function PublishDialog({ row, onClose, onDone }) {
  const options = useMemo(() => buildPublishOptions(row), [row]);
  const [version, setVersion] = useState(() => defaultPublishVersion(row));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (typeof document === "undefined") return null;

  const selected = options.find((o) => o.value === version) || null;
  const alreadyPublished = Boolean(selected?.isPublished);

  async function submit() {
    setBusy(true);
    setError("");

    try {
      const result = await api("/api/admin/legal/documents/publish", {
        method: "POST",
        body: buildPublishPayload(row, version),
      });

      onDone?.(
        `Versiunea ${result.version} a fost publicată pentru „${row.label}”. Utilizatorii existenți NU au fost notificați și nu li s-a cerut nimic.`
      );
    } catch (e) {
      setError(e?.data?.message || e?.message || "Publicarea a eșuat.");
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
        aria-label="Publică versiunea"
        onClick={(e) => e.stopPropagation()}
      >
        <div className={s.dialogHeader}>
          <div>
            <h3>Publică versiunea</h3>
            <p className={s.hint}>
              {row.label} · {audienceLabel(row.audience)}
            </p>
          </div>
        </div>

        <div className={s.dialogBody}>
          <label className={s.field}>
            <span>Versiune (din manifest)</span>
            <select value={version} onChange={(e) => setVersion(e.target.value)} disabled={busy}>
              {options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>

          <div className={s.callout}>
            Publicarea <strong>nu cere reacceptare</strong>: versiunea devine cea afișată pe pagina
            publică și cea acceptată de conturile noi. Utilizatorii existenți nu sunt blocați și nu
            primesc notificări. Pentru a le cere să accepte, folosește apoi „Cere reacceptarea”.
          </div>

          {row.sharedPublication && (
            <p className={s.hint}>
              Atenție: publicarea este comună pentru toate audiențele acestui document (Clienți,
              Vânzători, Influenceri); cererile de reacceptare rămân separate pe audiență.
            </p>
          )}

          {alreadyPublished && (
            <p className={s.hint}>Această versiune este deja publicată (republicarea nu schimbă nimic).</p>
          )}

          {error && <div className={s.error}>{error}</div>}
        </div>

        <div className={s.dialogFooter}>
          <button type="button" className={s.btn} onClick={onClose} disabled={busy}>
            Anulează
          </button>
          <button
            type="button"
            className={`${s.btn} ${s.btnPrimary}`}
            onClick={submit}
            disabled={busy || !version}
          >
            {busy ? "Se publică…" : "Publică"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
