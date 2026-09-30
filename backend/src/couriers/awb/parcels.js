// backend/src/couriers/awb/parcels.js

/*
 * Colete / greutate / dimensiuni pentru AWB. NU inventăm greutatea: dacă
 * nici Shipment.weightKg, nici input-ul vendorului nu o conțin, e blocker.
 * Numărul de colete implicit e 1 (nu e o valoare fizică inventată).
 *
 * Greutatea e TOTALĂ, împărțită egal pe colete; dimensiunile (opționale)
 * se aplică fiecărui colet.
 */

export const PARCEL_LIMITS = Object.freeze({
  maxParcels: 20,
  minWeightKg: 0.01,
  maxWeightKg: 500,
  maxDimensionCm: 300,
});

function blocker(code, message, field) {
  return { code, message, field };
}

function toNumber(v) {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

/**
 * @param {Object} shipment - valorile salvate (parcels, weightKg, lengthCm, widthCm, heightCm)
 * @param {Object} input    - valorile trimise de vendor (au prioritate)
 */
export function resolveParcels(shipment = {}, input = {}) {
  const pick = (key) => (input?.[key] !== undefined && input?.[key] !== "" ? input[key] : shipment?.[key]);

  const blockers = [];
  const parcelsRaw = toNumber(pick("parcels"));
  const weightRaw = toNumber(pick("weightKg"));
  const dims = {
    lengthCm: toNumber(pick("lengthCm")),
    widthCm: toNumber(pick("widthCm")),
    heightCm: toNumber(pick("heightCm")),
  };

  let parcels = parcelsRaw == null ? 1 : parcelsRaw;
  if (!Number.isInteger(parcels) || parcels < 1 || parcels > PARCEL_LIMITS.maxParcels) {
    blockers.push(
      blocker("parcels_invalid", `Numărul de colete trebuie să fie între 1 și ${PARCEL_LIMITS.maxParcels}.`, "parcels")
    );
    parcels = null;
  }

  let weightKg = null;
  if (weightRaw == null) {
    blockers.push(blocker("weight_required", "Completează greutatea totală a coletului (kg).", "weightKg"));
  } else if (
    Number.isNaN(weightRaw) ||
    weightRaw < PARCEL_LIMITS.minWeightKg ||
    weightRaw > PARCEL_LIMITS.maxWeightKg
  ) {
    blockers.push(
      blocker("weight_invalid", `Greutatea trebuie să fie între 0,01 și ${PARCEL_LIMITS.maxWeightKg} kg.`, "weightKg")
    );
  } else {
    weightKg = Math.round(weightRaw * 100) / 100;
  }

  const cleanDims = {};
  for (const [key, value] of Object.entries(dims)) {
    if (value == null || value === 0) {
      cleanDims[key] = null;
      continue;
    }
    if (Number.isNaN(value) || !Number.isInteger(value) || value < 1 || value > PARCEL_LIMITS.maxDimensionCm) {
      blockers.push(
        blocker("dimension_invalid", `Dimensiunile trebuie să fie numere întregi între 1 și ${PARCEL_LIMITS.maxDimensionCm} cm.`, key)
      );
      cleanDims[key] = null;
    } else {
      cleanDims[key] = value;
    }
  }

  const list =
    parcels && weightKg != null
      ? Array.from({ length: parcels }, () => ({
          weightKg: Math.max(PARCEL_LIMITS.minWeightKg, Math.round((weightKg / parcels) * 100) / 100),
          ...cleanDims,
        }))
      : [];

  return { parcels, weightKg, ...cleanDims, list, blockers };
}
