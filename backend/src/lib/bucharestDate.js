// backend/src/lib/bucharestDate.js
//
// Sursă UNICĂ pentru "ce zi/săptămână calendaristică este ACUM în
// România", ancorată explicit în Europe/Bucharest - independent de
// timezone-ul implicit al procesului Node (serverul de producție
// poate rula în UTC, unde "azi" ar însemna greșit ziua UTC, nu ziua
// din România - diferență de 2-3 ore, în funcție de ora de vară).
//
// Fără nicio librărie nouă - doar Intl, nativ Node. Gestionează
// automat tranziția oră de vară/iarnă (EEST/EET) prin Intl, fără
// tabel de date întreținut manual.
//
// Înlocuiește 3 implementări separate care existau înainte
// (homepageFeatureScheduler.js - timp local server, greșit;
// adminHomepageFeatureRoutes.js - duplicat identic, greșit;
// influencerGeneratedContent.js - corect, dar izolat) cu un singur
// loc de adevăr, reutilizat de toate.

export const BUCHAREST_TZ = "Europe/Bucharest";

function cloneDate(value) {
  const date =
    value instanceof Date
      ? new Date(value.getTime())
      : new Date(value);

  return Number.isNaN(date.getTime()) ? null : date;
}

/*
 * Offset-ul (în minute, est de UTC) al fusului orar dat, LA
 * momentul `reference` - Intl rezolvă automat EEST (+180) vs EET
 * (+120) în funcție de dată, fără să întreținem noi regulile DST.
 */
function getOffsetMinutes(reference, timeZone = BUCHAREST_TZ) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "shortOffset",
  }).formatToParts(reference);

  const offsetLabel =
    parts.find((part) => part.type === "timeZoneName")?.value ||
    "GMT+2";

  const match = offsetLabel.match(/GMT([+-])(\d+)(?::(\d+))?/);

  if (!match) {
    return 120;
  }

  const sign = match[1] === "-" ? -1 : 1;
  const hours = Number(match[2] || 0);
  const minutes = Number(match[3] || 0);

  return sign * (hours * 60 + minutes);
}

/*
 * Anul/luna/ziua calendaristice, așa cum apar în fusul orar dat -
 * NU citiri locale (.getFullYear() etc.) ale procesului Node.
 */
function getDateParts(reference, timeZone = BUCHAREST_TZ) {
  const raw = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(reference)
      .map((part) => [part.type, part.value])
  );

  return {
    year: Number(raw.year),
    month: Number(raw.month),
    day: Number(raw.day),
  };
}

/*
 * Instantul UTC pentru miezul nopții (00:00) din fusul orar dat,
 * pentru anul/luna/ziua date.
 *
 * Offset-ul se calculează la o "ghicire" de miezul nopții UTC
 * pentru acea zi, nu la ora originală de referință - tranzițiile
 * DST din România au loc la 03:00/04:00 local, deci ghicirea
 * (mereu foarte aproape de miezul nopții real) e pe aceeași parte
 * a tranziției ca miezul nopții însuși.
 */
function midnightForParts(
  { year, month, day },
  timeZone = BUCHAREST_TZ
) {
  const utcGuess = Date.UTC(
    year,
    month - 1,
    day,
    0,
    0,
    0
  );

  const offsetMinutes = getOffsetMinutes(
    new Date(utcGuess),
    timeZone
  );

  return new Date(utcGuess - offsetMinutes * 60000);
}

function addCalendarDays(
  { year, month, day },
  amount
) {
  const rolled = new Date(
    Date.UTC(year, month - 1, day + amount)
  );

  return {
    year: rolled.getUTCFullYear(),
    month: rolled.getUTCMonth() + 1,
    day: rolled.getUTCDate(),
  };
}

/*
 * Intervalul [00:00, 00:00 ziua următoare) al zilei calendaristice
 * din `timeZone` în care cade `value`.
 */
export function getZonedDayRange(
  value = new Date(),
  timeZone = BUCHAREST_TZ
) {
  const reference = cloneDate(value);

  if (!reference) {
    return null;
  }

  const todayParts = getDateParts(reference, timeZone);
  const tomorrowParts = addCalendarDays(todayParts, 1);

  return {
    startsAt: midnightForParts(todayParts, timeZone),
    endsAt: midnightForParts(tomorrowParts, timeZone),
  };
}

/*
 * Intervalul [Luni 00:00, Luni următor 00:00) al săptămânii
 * calendaristice din `timeZone` în care cade `value`.
 */
export function getZonedWeekRange(
  value = new Date(),
  timeZone = BUCHAREST_TZ
) {
  const reference = cloneDate(value);

  if (!reference) {
    return null;
  }

  const todayParts = getDateParts(reference, timeZone);

  const weekday = new Date(
    Date.UTC(
      todayParts.year,
      todayParts.month - 1,
      todayParts.day
    )
  ).getUTCDay();

  const diffToMonday =
    weekday === 0 ? -6 : 1 - weekday;

  const mondayParts = addCalendarDays(
    todayParts,
    diffToMonday
  );

  const nextMondayParts = addCalendarDays(
    mondayParts,
    7
  );

  return {
    startsAt: midnightForParts(mondayParts, timeZone),
    endsAt: midnightForParts(nextMondayParts, timeZone),
  };
}

/*
 * "YYYY-MM-DD" pentru ziua calendaristică din `timeZone`.
 */
export function getZonedDayKey(
  value = new Date(),
  timeZone = BUCHAREST_TZ
) {
  const range = getZonedDayRange(value, timeZone);

  if (!range) {
    return null;
  }

  const { year, month, day } = getDateParts(
    range.startsAt,
    timeZone
  );

  return `${year}-${String(month).padStart(2, "0")}-${String(
    day
  ).padStart(2, "0")}`;
}

/*
 * "YYYY-Www" (săptămâna ISO) pentru săptămâna calendaristică din
 * `timeZone` (Luni-Duminică) în care cade `value`. Numărul
 * săptămânii ISO se calculează pe componentele calendaristice ale
 * zilei de Luni, nu pe citiri locale ale procesului.
 */
export function getZonedWeekKey(
  value = new Date(),
  timeZone = BUCHAREST_TZ
) {
  const range = getZonedWeekRange(value, timeZone);

  if (!range) {
    return null;
  }

  const { year, month, day } = getDateParts(
    range.startsAt,
    timeZone
  );

  const isoAnchor = new Date(
    Date.UTC(year, month - 1, day)
  );

  const isoWeekday = isoAnchor.getUTCDay() || 7;

  isoAnchor.setUTCDate(
    isoAnchor.getUTCDate() + 4 - isoWeekday
  );

  const yearStart = new Date(
    Date.UTC(isoAnchor.getUTCFullYear(), 0, 1)
  );

  const weekNumber = Math.ceil(
    ((isoAnchor - yearStart) / 86400000 + 1) / 7
  );

  return `${isoAnchor.getUTCFullYear()}-W${String(
    weekNumber
  ).padStart(2, "0")}`;
}
