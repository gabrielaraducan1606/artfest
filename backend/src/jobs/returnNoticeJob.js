// backend/src/jobs/returnNoticeJob.js
//
// Notificările persistente ale returului Sameday STANDARD (services/returnNotices.js):
// reia pașii întrerupți (restart, eroare SMTP / DB) - tranziții după AWB confirmat
// sau anulat, notificări scadente (RETRY), trimiteri abandonate (RETRY cu Resend +
// cheie de idempotență < 23h, altfel UNCERTAIN, fără retrimitere automată) și
// notificările in-app nefinalizate. Fără apeluri la Sameday.
// Pornește DOAR cu RETURN_NOTICE_JOB_ENABLED=true (implicit OPRIT); se activează
// odată cu AWB-ul de retur live. O singură rulare odată per proces.

import { reconcileReturnNotices } from "../services/returnShipmentService.js";

let running = false;

export function isReturnNoticeJobEnabled(env = process.env) {
  return String(env.RETURN_NOTICE_JOB_ENABLED ?? "").trim().toLowerCase() === "true";
}

export async function runReturnNoticeJob({ db, now = new Date() } = {}) {
  if (!isReturnNoticeJobEnabled() || running) return { skipped: true };
  running = true;
  try {
    const summary = await reconcileReturnNotices({ ...(db ? { db } : {}), now });
    if (summary.confirmed || summary.cancelled || summary.stale || summary.inApp || summary.dispatched) {
      console.info("[returnNoticeJob]", JSON.stringify(summary));
    }
    return summary;
  } finally {
    running = false;
  }
}
