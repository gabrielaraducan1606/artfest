// src/pages/Admin/AdminDesktop/tabs/adminFairCancellation.js
//
// Admin -> Târg Artfest: anularea participării și returul către vendor.
// Etichete și logică fără React (testabilă cu node --test).

export const FAIR_ADMIN_API = "/api/admin/artfest-fair";

export const CAUSE_OPTIONS = [
  { value: "ARTFEST_DECISION", label: "Decizia Artfest (motive neimputabile vendorului)" },
  { value: "VENDOR_REQUEST", label: "La cererea vendorului" },
  { value: "VENDOR_BREACH", label: "Încălcarea regulamentului / neeligibil" },
];

export const CAUSE_LABEL = Object.fromEntries(CAUSE_OPTIONS.map((o) => [o.value, o.label]));

export const EVENT_LABEL = {
  SUBMITTED: "Înscriere trimisă",
  APPROVED: "Aprobată",
  REJECTED: "Respinsă",
  REAPPROVED: "Reaprobată",
  WITHDRAWN: "Retrasă de vendor",
  CANCELLED: "Participare anulată",
};

export const RETURN_REASON_LABEL = {
  PARTICIPATION_CANCELLED: "Participare anulată",
  FAIR_ENDED_UNSOLD: "Nevândute după târg",
  RECEPTION_REJECTED: "Refuzate la recepție",
};

export const RETURN_METHOD_OPTIONS = [
  { value: "COURIER_BY_ARTFEST", label: "Curier comandat de Artfest" },
  { value: "COURIER_BY_VENDOR", label: "Curier comandat de vendor" },
  { value: "PICKUP", label: "Ridicare personală" },
];

export const RETURN_METHOD_LABEL = Object.fromEntries(RETURN_METHOD_OPTIONS.map((o) => [o.value, o.label]));

export const RETURN_STATUS_LABEL = {
  PREPARING: "În pregătire",
  SHIPPED: "Expediat / predat",
  CONFIRMED: "Confirmat",
  CONFIRMED_WITH_DIFFERENCES: "De clarificat (diferențe)",
  CANCELLED: "Anulat",
};

export const COST_PAYER_LABEL = { VENDOR: "Vendor", ARTFEST: "Artfest" };

// ce se întâmplă cu inventarul, după bifa „Produsele au fost deja expediate”
export function cancellationImpact(preview, goodsAlreadyShipped) {
  const s = (goodsAlreadyShipped ? preview?.ifShipped : preview?.ifNotShipped) || {};
  return [
    { label: "Linii care vor fi anulate", value: s.linesToCancel || 0 },
    { label: "Linii în tranzit (rezervarea online rămâne)", value: s.inTransit || 0 },
    { label: "Linii deja la Artfest (blocate de la vânzare)", value: s.atArtfest || 0 },
    { label: "Linii cu produse refuzate încă la Artfest", value: s.rejectedAtArtfest || 0 },
  ];
}

export function validateCancellation(form) {
  const errors = {};
  if (!CAUSE_LABEL[form.cause]) errors.cause = "Alege cauza anulării.";
  if (String(form.reason || "").trim().length < 3) errors.reason = "Motivul intern este obligatoriu.";
  if (typeof form.goodsAlreadyShipped !== "boolean") errors.goodsAlreadyShipped = "Spune dacă produsele au fost expediate.";
  return errors;
}

// formularul de retur pornește cu toate cantitățile disponibile (vandabil / refuzat / deteriorat)
export function initialReturnDraft(candidates) {
  return Object.fromEntries(
    (candidates || []).map((c) => [
      c.inventoryItemId,
      { qtyFromStock: String(c.maxFromStock), qtyRejected: String(c.maxRejected), qtyDamaged: String(c.maxDamaged || 0) },
    ])
  );
}

export function buildReturnLines(candidates, draft) {
  const errors = {};
  const lines = [];
  for (const c of candidates || []) {
    const entry = draft[c.inventoryItemId] || {};
    const fromStock = Number(entry.qtyFromStock || 0);
    const rejected = Number(entry.qtyRejected || 0);
    const damaged = Number(entry.qtyDamaged || 0);
    if (!Number.isInteger(fromStock) || fromStock < 0 || fromStock > c.maxFromStock) {
      errors[c.inventoryItemId] = `Vandabil: între 0 și ${c.maxFromStock}.`;
      continue;
    }
    if (!Number.isInteger(rejected) || rejected < 0 || rejected > c.maxRejected) {
      errors[c.inventoryItemId] = `Refuzat: între 0 și ${c.maxRejected}.`;
      continue;
    }
    if (!Number.isInteger(damaged) || damaged < 0 || damaged > (c.maxDamaged || 0)) {
      errors[c.inventoryItemId] = `Deteriorat: între 0 și ${c.maxDamaged || 0}.`;
      continue;
    }
    if (fromStock + rejected + damaged > 0) {
      lines.push({ inventoryItemId: c.inventoryItemId, qtyFromStock: fromStock, qtyRejected: rejected, qtyDamaged: damaged });
    }
  }
  if (!lines.length && !Object.keys(errors).length) errors._ = "Alege cel puțin o bucată pentru retur.";
  return { errors, lines };
}

// confirmarea în numele vendorului: doar la SHIPPED, după termenul de la server
export function canConfirmOnBehalf(ret, now = new Date()) {
  if (ret?.status !== "SHIPPED" || !ret?.actions?.confirmOnBehalfFrom) return false;
  return new Date(now) >= new Date(ret.actions.confirmOnBehalfFrom);
}

// deterioratele se confirmă separat și nu revin niciodată online
export function fullConfirmationLines(ret) {
  return (ret?.lines || []).map((l) => ({
    returnLineId: l.id,
    receivedQty: l.sentQty,
    ...(l.qtyDamaged > 0 ? { receivedDamagedQty: l.qtyDamaged } : {}),
  }));
}

export function newIdempotencyKey() {
  try {
    return crypto.randomUUID();
  } catch {
    return `k-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
}
