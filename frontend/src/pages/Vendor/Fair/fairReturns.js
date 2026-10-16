// src/pages/Vendor/Fair/fairReturns.js
//
// Situația produselor după anularea participării și retururile Artfest ->
// vendor: etichete și logica de confirmare (fără React, testabilă cu node --test).

export const RETURNS_API = "/api/vendor/artfest-fair/returns";

export const SITUATION_LABEL = {
  IN_TRANSIT: "În tranzit",
  AT_ARTFEST: "La Artfest",
  RETURN_IN_PROGRESS: "În retur către tine",
  RETURNED: "Returnat",
  CANCELLED: "Anulat",
};

export const SITUATION_TONE = {
  IN_TRANSIT: "info",
  AT_ARTFEST: "info",
  RETURN_IN_PROGRESS: "info",
  RETURNED: "success",
  CANCELLED: "muted",
};

export const RETURN_STATUS_LABEL = {
  PREPARING: "În pregătire",
  SHIPPED: "Expediat / predat",
  CONFIRMED: "Primire confirmată",
  CONFIRMED_WITH_DIFFERENCES: "Confirmat cu diferențe",
  CANCELLED: "Anulat",
};

export const RETURN_METHOD_LABEL = {
  PICKUP: "Ridicare personală",
  COURIER_BY_ARTFEST: "Curier comandat de Artfest",
  COURIER_BY_VENDOR: "Curier comandat de vendor",
};

export const COST_PAYER_LABEL = {
  VENDOR: "vendor",
  ARTFEST: "Artfest",
};

// textul rezervării online pentru o linie (după anulare / retur)
export function onlineStateText(online) {
  if (!online || online.state === "none") return "Stocul online nu a fost modificat pentru târg.";
  if (online.state === "restored") {
    return online.restoredQty > 0
      ? `Readăugat online: ${online.restoredQty} ${online.restoredQty === 1 ? "bucată" : "bucăți"}.`
      : "Rezervarea pentru târg s-a încheiat.";
  }
  if (online.state === "released") {
    return online.mode === "FORCED_UNAVAILABLE"
      ? "Rezervarea a fost eliberată: produsul a redevenit disponibil online."
      : `Rezervarea a fost eliberată: ${online.releasedQty} ${online.releasedQty === 1 ? "bucată a revenit" : "bucăți au revenit"} în stocul online.`;
  }
  if (online.mode === "FORCED_UNAVAILABLE") return "Rezervat pentru târg: unicatul nu poate fi cumpărat online până revine la tine.";
  return `Rezervat pentru târg: ${online.reservedQty} ${online.reservedQty === 1 ? "bucată" : "bucăți"}.`;
}

function clampInt(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

// implicit: tot ce s-a primit și e eligibil pentru stocul online
export function defaultRestoreQty(receivedQty, restoreCap) {
  return Math.max(0, Math.min(clampInt(receivedQty, 0, Number.MAX_SAFE_INTEGER), restoreCap || 0));
}

export const DAMAGED_NOTICE = "Deteriorat – nu va fi readăugat în stocul online.";

// starea inițială a formularului de confirmare: primit = trimis, readăugat = implicit
// (sentQty = bucăți nedeteriorate; deterioratele, qtyDamaged, se confirmă separat)
export function initialConfirmState(ret) {
  return Object.fromEntries(
    (ret?.lines || []).map((line) => [
      line.id,
      {
        receivedQty: String(line.sentQty),
        receivedDamagedQty: String(line.qtyDamaged || 0),
        restoreOnlineQty: String(defaultRestoreQty(line.sentQty, line.restoreCap)),
        restoreTouched: false,
        note: "",
      },
    ])
  );
}

export function updateReceivedDamaged(state, line, value) {
  return { ...state, [line.id]: { ...state[line.id], receivedDamagedQty: value } };
}

/*
 * Schimbarea cantității primite: dacă vendorul nu a modificat manual
 * readăugarea online, aceasta urmează valoarea implicită; altfel e doar
 * limitată la noul plafon.
 */
export function updateReceived(state, line, value) {
  const current = state[line.id];
  const received = clampInt(value, 0, line.sentQty);
  const cap = defaultRestoreQty(received, line.restoreCap);
  const restore = current.restoreTouched ? Math.min(clampInt(current.restoreOnlineQty, 0, cap), cap) : cap;
  return { ...state, [line.id]: { ...current, receivedQty: value, restoreOnlineQty: String(restore) } };
}

export function updateRestore(state, line, value) {
  return { ...state, [line.id]: { ...state[line.id], restoreOnlineQty: value, restoreTouched: true } };
}

// validare + corpul cererii; întoarce { errors, body }
export function buildConfirmPayload(ret, state, note = "") {
  const errors = {};
  const lines = [];
  for (const line of ret?.lines || []) {
    const entry = state[line.id] || {};
    const received = Number(entry.receivedQty);
    const restore = Number(entry.restoreOnlineQty);
    const damagedSent = line.qtyDamaged || 0;
    const receivedDamaged = Number(entry.receivedDamagedQty ?? 0);
    if (!Number.isInteger(received) || received < 0 || received > line.sentQty) {
      errors[line.id] = `Cantitatea primită trebuie să fie între 0 și ${line.sentQty}.`;
      continue;
    }
    if (!Number.isInteger(receivedDamaged) || receivedDamaged < 0 || receivedDamaged > damagedSent) {
      errors[line.id] = `Bucățile deteriorate primite trebuie să fie între 0 și ${damagedSent}.`;
      continue;
    }
    // plafonul de readăugare ține cont DOAR de bucățile nedeteriorate
    const cap = defaultRestoreQty(received, line.restoreCap);
    if (!Number.isInteger(restore) || restore < 0 || restore > cap) {
      errors[line.id] = cap > 0 ? `Poți readăuga online între 0 și ${cap}.` : "Pentru acest produs nu se readaugă nimic online.";
      continue;
    }
    lines.push({
      returnLineId: line.id,
      receivedQty: received,
      ...(damagedSent > 0 ? { receivedDamagedQty: receivedDamaged } : {}),
      restoreOnlineQty: restore,
      ...(entry.note ? { note: entry.note } : {}),
    });
  }
  return { errors, body: { lines, ...(note ? { note } : {}) } };
}

export function hasDifferences(ret, state) {
  return (ret?.lines || []).some(
    (line) =>
      Number(state[line.id]?.receivedQty) !== line.sentQty ||
      Number(state[line.id]?.receivedDamagedQty ?? 0) !== (line.qtyDamaged || 0)
  );
}

export function newIdempotencyKey() {
  try {
    return crypto.randomUUID();
  } catch {
    return `k-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
}
