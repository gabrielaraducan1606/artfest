// backend/src/routes/adminPickupsFilters.js
//
// Filtrele listei Admin „Pickups” (GET /api/admin/pickups), ca funcție pură.
//  - implicit (source gol): expedierile cu ridicare programată (pickupScheduledAt),
//    comportamentul istoric, neschimbat;
//  - source=courier: expedierile cu cel puțin un AWB generat prin integrarea de
//    curier (CourierAwb), OUTBOUND și RETURN - generarea AWB-ului nu setează
//    pickupScheduledAt, deci fără acest filtru ele nu apar în listă.
//    awbStatus (REQUESTED | CREATED | FAILED | CANCELLED | UNKNOWN) filtrează
//    după starea AWB-ului; perioada se aplică pe data creării AWB-ului.

export const ADMIN_PICKUP_SOURCES = Object.freeze(["", "courier"]);
export const ADMIN_PICKUP_DIRECTIONS = Object.freeze(["OUTBOUND", "RETURN"]);
export const ADMIN_AWB_STATUSES = Object.freeze(["REQUESTED", "CREATED", "FAILED", "CANCELLED", "UNKNOWN"]);

function endOfDay(d) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

function validDate(v) {
  if (!v) return null;
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * @param {Object} query  req.query
 * @param {Object|null} qWhere  condiția de căutare text (deja construită)
 * @returns {{ where: Object, orderBy: Object, source: string }}
 */
export function buildAdminPickupsWhere(query = {}, qWhere = null) {
  const status = String(query.status || "").trim();
  const directionRaw = String(query.direction || "").trim().toUpperCase();
  const direction = ADMIN_PICKUP_DIRECTIONS.includes(directionRaw) ? directionRaw : "";
  const source = String(query.source || "").trim().toLowerCase() === "courier" ? "courier" : "";
  const awbStatusRaw = String(query.awbStatus || "").trim().toUpperCase();
  const awbStatus = ADMIN_AWB_STATUSES.includes(awbStatusRaw) ? awbStatusRaw : "";
  const from = validDate(query.from);
  const to = validDate(query.to);
  const range = from || to ? { ...(from ? { gte: from } : {}), ...(to ? { lte: endOfDay(to) } : {}) } : null;

  const common = {
    ...(status ? { status } : {}),
    ...(direction ? { direction } : {}),
    ...(qWhere || {}),
  };

  if (source === "courier") {
    return {
      source,
      where: {
        ...common,
        courierAwbs: {
          some: {
            ...(awbStatus ? { status: awbStatus } : {}),
            ...(range ? { createdAt: range } : {}),
          },
        },
      },
      orderBy: { updatedAt: "desc" },
    };
  }

  return {
    source,
    where: {
      ...common,
      pickupScheduledAt: { not: null, ...(range || {}) },
    },
    orderBy: { pickupScheduledAt: "desc" },
  };
}
