// src/pages/Vendor/Fair/fairInventoryQuantity.js
//
// „Modifică inventarul” - reguli de afișare și validare pentru corectarea
// cantității unei linii trimise (POST /api/vendor/fair/inventory/:id/quantity).
// Serverul decide (actions.qtyChange, quantities); aici doar textele și
// verificarea locală, ca vendorul să vadă imediat ce e permis.
// Fără importuri din browser: testabil cu node --test.

// motivele pentru care vendorul nu poate modifica singur cantitatea
export const QTY_CHANGE_REASON_TEXT = {
  deadline:
    "Termenul pentru inventar a trecut. Cantitatea se poate modifica doar cu acordul Artfest: trimite o solicitare din Asistență.",
  received:
    "Produsul a fost recepționat de Artfest. Cantitatea recepționată nu se mai modifică; pentru bucăți suplimentare, trimite o solicitare din Asistență.",
  reservation_closed: "Rezervarea online a acestei linii a fost închisă. Pentru modificări, trimite o solicitare din Asistență.",
  unique: "Produs unicat: cantitatea este întotdeauna 1.",
};

export function qtyChangeText(qtyChange) {
  return (qtyChange?.reason && QTY_CHANGE_REASON_TEXT[qtyChange.reason]) || "";
}

/** Cantitățile afișate (cu valori sigure pentru răspunsurile vechi, fără `quantities`). */
export function itemQuantities(item) {
  const q = item?.quantities || {};
  const declaredQty = Number.isInteger(q.declaredQty) ? q.declaredQty : Number(item?.declaredQty) || 0;
  const issuedQty = Number(q.issuedQty) || 0;
  return {
    declaredQty,
    issuedQty,
    receivedQty: Number(q.receivedQty) || 0,
    availableForNoteQty: Number.isInteger(q.availableForNoteQty) ? q.availableForNoteQty : 0,
    minAdjustQty: Math.max(1, Number(q.minAdjustQty) || issuedQty || 1),
    maxQty: Number(q.maxQty) || 1000,
  };
}

/**
 * Validează cantitatea nouă. @returns {{ ok: true, qty: number } | { ok: false, message: string }}
 */
export function validateAdjustQty(raw, item) {
  const text = String(raw ?? "").trim();
  const qty = Number(text);
  const { declaredQty, issuedQty, minAdjustQty, maxQty } = itemQuantities(item);
  if (!text || !Number.isInteger(qty)) return { ok: false, message: "Introdu un număr întreg de bucăți." };
  if (qty < 1 || qty > maxQty) return { ok: false, message: `Cantitatea trebuie să fie între 1 și ${maxQty}.` };
  if (qty < minAdjustQty) {
    return {
      ok: false,
      message: `Ai deja ${issuedQty} buc. pe avize emise. Cantitatea nu poate fi mai mică de ${minAdjustQty}; pentru mai puțin, anulează întâi avizul.`,
    };
  }
  if (qty === declaredQty) return { ok: false, message: "Cantitatea este aceeași. Introdu cantitatea nouă." };
  return { ok: true, qty };
}

/**
 * Ce se întâmplă cu stocul online la noua cantitate (estimare pentru vendor;
 * serverul aplică regula exactă în aceeași tranzacție).
 */
export function onlineEffectText(item, qty) {
  if (!Number.isInteger(qty) || item?.isManual) return "";
  const delta = qty - itemQuantities(item).declaredQty;
  const online = item?.online || {};
  if (delta > 0) {
    if (online.productAvailability === "READY" && online.onlineAvailableQty !== null && online.onlineAvailableQty !== undefined) {
      return online.onlineAvailableQty >= delta
        ? `Se rezervă încă ${delta} buc. din stocul online (disponibil acum: ${online.onlineAvailableQty}).`
        : `Stocul online are doar ${online.onlineAvailableQty} buc., iar majorarea cere ${delta}. Mărește întâi stocul produsului sau alege o cantitate mai mică.`;
    }
    return "Stocul online nu se modifică (produsul nu are stoc disponibil online sau se face la comandă).";
  }
  if (delta < 0) {
    const reserved = online.mode === "TRANSFERRED" ? Number(online.reservedQty) || 0 : 0;
    const back = Math.max(0, reserved - qty);
    return back > 0 ? `${back} buc. rezervate revin în stocul tău online.` : "Stocul online nu se modifică.";
  }
  return "";
}

/** Corpul cererii: cantitatea nouă + cantitatea văzută (protecție la modificări concurente). */
export function buildAdjustBody(item, qty) {
  return { declaredQty: qty, expectedDeclaredQty: itemQuantities(item).declaredQty };
}
