// src/services/influencerCollaboration.js
//
// Perioada activă de colaborare a unui influencer, pentru dashboard (GET
// /api/influencer/me) și, ulterior, pentru Admin.
//
// AUDIT (înainte de implementare, cerut explicit de user):
//   Modelul InfluencerProfile (prisma/schema.prisma) NU are niciun câmp
//   dedicat de colaborare: nu există activatedAt, startDate, endDate,
//   expiresAt, collaborationStart/End. Singurele câmpuri relevante sunt:
//     - createdAt   : setat de Prisma (`@default(now())`) EXACT în
//                     momentul în care profilul de influencer este creat
//                     (routes/influencerRoutes.js, acceptarea invitației -
//                     ambele căi de creare, cont nou și cont existent
//                     promovat la influencer, creează profilul cu
//                     status: "ACTIVE" chiar atunci). Nu e o aproximare:
//                     este chiar momentul activării contului de
//                     influencer, deci e un câmp SIGUR pentru
//                     collaborationStart. Nu s-a inventat nicio dată.
//                     "individual override" al perioadei: InfluencerProfile.
//                     collaborationEndOverride (migrare
//                     20260922120000_add_influencer_collaboration_end_override).
//                     Setat prin Admin -> "Prelungește colaborarea"
//                     (routes/adminInfluencersRoutes.js, PATCH
//                     /api/admin/influencers/:id/collaboration). Nu modifică
//                     NICIODATĂ status sau commissionBps.
//     - status      : enum InfluencerStatus (ACTIVE | DISABLED) - starea
//                     REALĂ a contului (suspendare etc.), independentă de
//                     perioada de colaborare. NU se suprascrie niciodată
//                     cu "Activă"/"Expirată" calculat.
//     - commissionBps: procentul curent de remunerare (neschimbat aici -
//                     doar citit și convertit în procent, cu EXACT
//                     aceeași formulă bpsToPercent folosită deja de
//                     routes/influencerRoutes.js).
//
//   Regula contractuală (cerută de user): perioada implicită = 3 luni de
//   la activare (createdAt). Nicio migrare Prisma nu a fost necesară.

export const DEFAULT_COLLABORATION_PERIOD_MONTHS = 3;
export const EXPIRING_SOON_THRESHOLD_DAYS = 14;

export const COLLABORATION_REVIEW_NOTICE =
  "Condițiile comerciale pot fi revizuite la prelungirea perioadei de colaborare.";

export const COLLABORATION_EXPIRING_SOON_NOTICE =
  "Colaborarea ta expiră în curând.";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/*
 * Adaugă `months` la o dată, în UTC, cu ajustare la ultima zi a lunii
 * țintă dacă ziua originală nu există în ea (ex. 31 ianuarie + 1 lună =
 * 28/29 februarie). Nu depinde de fusul orar al mașinii care rulează
 * codul (spre deosebire de `setMonth` local sau date-fns `addMonths`),
 * deci e determinist în teste.
 */
export function addMonthsUtc(date, months) {
  const d = new Date(date);
  const day = d.getUTCDate();

  const target = new Date(
    Date.UTC(
      d.getUTCFullYear(),
      d.getUTCMonth() + months,
      1,
      d.getUTCHours(),
      d.getUTCMinutes(),
      d.getUTCSeconds(),
      d.getUTCMilliseconds()
    )
  );

  const daysInTargetMonth = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)
  ).getUTCDate();

  target.setUTCDate(Math.min(day, daysInTargetMonth));

  return target;
}

/*
 * Aceeași formulă folosită deja pentru "Remunerația ta" (routes/
 * influencerRoutes.js `bpsToPercent`) - NU o schimbă, doar o refolosește
 * ca sursă unică pentru cardul de colaborare.
 */
export function bpsToPercent(value) {
  return Number(value || 0) / 100;
}

/**
 * Calculează starea colaborării pentru un influencer.
 *
 * @param {object} input
 * @param {Date|string} input.activatedAt   InfluencerProfile.createdAt (obligatoriu)
 * @param {string} input.status             InfluencerProfile.status ("ACTIVE" | "DISABLED")
 * @param {number} input.commissionBps      InfluencerProfile.commissionBps
 * @param {Date} [input.now]
 * @param {number} [input.periodMonths]     implicit 3 luni; dacă apare un câmp de
 *                                          override individual, se pasează aici
 * @param {Date|string|null} [input.collaborationEndOverride] InfluencerProfile.
 *                                          collaborationEndOverride - prelungire
 *                                          individuală (Admin -> "Prelungește
 *                                          colaborarea"), are prioritate față de
 *                                          periodMonths/createdAt.
 */
export function computeCollaborationState({
  activatedAt,
  status,
  commissionBps,
  now = new Date(),
  periodMonths = DEFAULT_COLLABORATION_PERIOD_MONTHS,
  collaborationEndOverride = null,
}) {
  if (!activatedAt) {
    throw new Error(
      "computeCollaborationState: activatedAt este obligatoriu (nu inventăm o dată de activare)."
    );
  }

  const start = new Date(activatedAt);
  const end = collaborationEndOverride
    ? new Date(collaborationEndOverride)
    : addMonthsUtc(start, periodMonths);

  const currentAt = new Date(now);
  const accountStatus = String(status || "ACTIVE").toUpperCase();

  const daysUntilEnd = Math.ceil(
    (end.getTime() - currentAt.getTime()) / MS_PER_DAY
  );

  /*
   * Statusul REAL al contului (ex. DISABLED = suspendat) are prioritate
   * absolută: nu îl suprascriem niciodată cu "Activă"/"Expirată".
   */
  const collaborationStatus =
    accountStatus !== "ACTIVE"
      ? accountStatus
      : currentAt.getTime() <= end.getTime()
        ? "ACTIVE"
        : "EXPIRED";

  const expiringSoon =
    collaborationStatus === "ACTIVE" &&
    daysUntilEnd >= 0 &&
    daysUntilEnd <= EXPIRING_SOON_THRESHOLD_DAYS;

  return {
    collaborationStatus,
    collaborationStart: start,
    collaborationEnd: end,
    periodMonths,
    commissionPercent: bpsToPercent(commissionBps),
    daysUntilEnd,
    expiringSoon,
    notice: COLLABORATION_REVIEW_NOTICE,
    expiringSoonNotice: expiringSoon ? COLLABORATION_EXPIRING_SOON_NOTICE : null,
  };
}

/**
 * Validează o prelungire (PATCH /api/admin/influencers/:id/collaboration).
 * Sursă unică pentru regulile din secțiunea 10: dată validă, ulterioară
 * datei de start, și - fiindcă acțiunea este explicit o PRELUNGIRE, nu o
 * scurtare - ulterioară datei de expirare CURENTE (care poate veni deja
 * dintr-un override anterior; vezi secțiunea 5, "de la collaborationEnd
 * curent, NU de la createdAt").
 *
 * @param {object} input
 * @param {string|Date} input.collaborationEnd     valoarea trimisă de admin
 * @param {Date} input.collaborationStart           InfluencerProfile.createdAt
 * @param {Date} input.currentCollaborationEnd       collaboration.collaborationEnd
 *                                                    ÎNAINTE de această prelungire
 *                                                    (implicit sau dintr-un override anterior)
 */
export function validateCollaborationExtension({
  collaborationEnd,
  collaborationStart,
  currentCollaborationEnd,
}) {
  const parsed = new Date(collaborationEnd);

  if (!collaborationEnd || Number.isNaN(parsed.getTime())) {
    return { valid: false, code: "invalid_date" };
  }

  if (parsed.getTime() <= new Date(collaborationStart).getTime()) {
    return { valid: false, code: "collaboration_end_before_start" };
  }

  if (
    currentCollaborationEnd &&
    parsed.getTime() <= new Date(currentCollaborationEnd).getTime()
  ) {
    return { valid: false, code: "collaboration_end_not_after_current" };
  }

  return { valid: true, date: parsed };
}
