// backend/src/services/shipping/artfestSamedayConfig.js
//
// „Sameday prin Artfest” - tariful simplu Artfest pe metodă de livrare (SamedayMethodConfig),
// setat EXCLUSIV din Admin. Se folosește DOAR când lipsește greutatea unui produs din coletul
// unui magazin (fără greutate nu există estimare Sameday și nu inventăm una). Coșurile cu
// greutăți complete păstrează estimarea Sameday. Fără valori implicite: metodă fără tarif =>
// nu se oferă coșurilor fără greutate.

export const ARTFEST_METHODS = Object.freeze(["HOME", "LOCKER", "PUDO"]);
export const ARTFEST_RULE_SOURCE = "ARTFEST_RULE";
export const WEIGHT_UNKNOWN_REASON = "parcel_weight_unknown";
const MAX_AMOUNT_CENTS = 100_000; // 1.000 lei: peste e aproape sigur o greșeală de tastare

export class ArtfestConfigError extends Error {
  constructor(status, code, message, field = null) {
    super(message);
    this.name = "ArtfestConfigError";
    this.status = status;
    this.code = code;
    this.field = field;
  }
}

/** { HOME, LOCKER, PUDO } -> { method, amountCents|null, configured, updatedAt } */
export function configsFromRows(rows = []) {
  const byMethod = new Map((rows || []).map((r) => [String(r.method), r]));
  return Object.fromEntries(
    ARTFEST_METHODS.map((m) => {
      const n = Number(byMethod.get(m)?.amountCents);
      const amountCents = Number.isInteger(n) && n > 0 ? n : null;
      const updatedAt = byMethod.get(m)?.updatedAt;
      return [m, { method: m, amountCents, configured: amountCents != null, updatedAt: updatedAt ? new Date(updatedAt).toISOString() : null }];
    })
  );
}

export async function loadArtfestSamedayConfig(db) {
  return configsFromRows(await db.samedayMethodConfig.findMany({ where: { method: { in: [...ARTFEST_METHODS] } } }));
}

/** „24,90” / „24.9” lei -> 2490 bani; gol -> null (neconfigurat). Aruncă la valori invalide. */
export function parseAmountLei(value) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const text = String(value).trim().replace(/\s/g, "").replace(",", ".");
  const cents = /^\d{1,6}(\.\d{1,2})?$/.test(text) ? Math.round(Number(text) * 100) : NaN;
  if (!Number.isInteger(cents) || cents <= 0 || cents > MAX_AMOUNT_CENTS) {
    throw new ArtfestConfigError(400, "invalid_amount", "Scrie tariful în lei, mai mare de 0 (de exemplu 18,90), sau lasă gol.", "amountLei");
  }
  return cents;
}

/** Admin: salvează tariful unei metode (gol = neconfigurat). */
export async function saveArtfestMethodAmount({ db, method, amountLei, adminId = null }) {
  const key = String(method || "").toUpperCase();
  if (!ARTFEST_METHODS.includes(key)) throw new ArtfestConfigError(404, "unknown_method", "Metodă de livrare necunoscută.");
  const amountCents = parseAmountLei(amountLei);
  const updatedById = adminId ? String(adminId) : null;
  await db.samedayMethodConfig.upsert({
    where: { method: key },
    create: { method: key, amountCents, updatedById },
    update: { amountCents, updatedById },
  });
  return (await loadArtfestSamedayConfig(db))[key];
}
