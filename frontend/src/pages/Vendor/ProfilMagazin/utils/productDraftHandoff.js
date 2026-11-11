// src/pages/Vendor/ProfilMagazin/utils/productDraftHandoff.js
//
// Ciorna unui produs NOU nu păstrează intenționat disponibilitatea, stocul și
// termenul (useProductEditorController). La trecerea din Smart Listing în
// Editorul avansat, vânzătorul tocmai le-a completat, așa că se transferă separat,
// pentru scurt timp. Fără această cheie, editorul se comportă exact ca înainte.
// Editarea produselor existente nu citește niciodată această cheie.

const HANDOFF_TTL_MS = 2 * 60 * 1000;

const EMPTY_AVAILABILITY = Object.freeze({
  availability: "",
  readyQty: "",
  leadTimeDays: "",
  nextShipDate: "",
});

export function availabilityHandoffKey(draftKey) {
  return `${draftKey}:availability`;
}

export function writeAvailabilityHandoff(storage, draftKey, form = {}, now = Date.now()) {
  storage.setItem(
    availabilityHandoffKey(draftKey),
    JSON.stringify({
      savedAt: now,
      availability: form.availability ?? "",
      readyQty: form.readyQty ?? "",
      leadTimeDays: form.leadTimeDays ?? "",
      nextShipDate: form.nextShipDate ?? "",
    })
  );
}

/*
 * Legătura cu ciorna Smart Listing din care a pornit editorul: ciorna rămâne cât
 * timp produsul nu există și se șterge DOAR ea, după crearea reușită în editor.
 * `sourceDraft`: { key, indexKey, id } - fără legătură, editorul nu atinge nimic.
 */
function sourceDraftLinkKey(draftKey) {
  return `${draftKey}:source`;
}

export function writeSourceDraftLink(storage, draftKey, sourceDraft) {
  if (sourceDraft?.key) storage.setItem(sourceDraftLinkKey(draftKey), JSON.stringify(sourceDraft));
  else storage.removeItem(sourceDraftLinkKey(draftKey));
}

export function clearLinkedSourceDraft(storage, draftKey) {
  try {
    const link = JSON.parse(storage.getItem(sourceDraftLinkKey(draftKey)) || "null");
    storage.removeItem(sourceDraftLinkKey(draftKey));
    storage.removeItem(availabilityHandoffKey(draftKey));
    if (!link?.key) return;
    storage.removeItem(link.key);
    if (link.indexKey && link.id) {
      const ids = JSON.parse(storage.getItem(link.indexKey) || "[]");
      if (Array.isArray(ids)) storage.setItem(link.indexKey, JSON.stringify(ids.filter((id) => id !== link.id)));
    }
  } catch {
    // stocare indisponibilă: ciorna rămâne și poate fi ștearsă manual
  }
}

/** Datele transferate recent sau câmpuri goale (comportamentul normal al ciornei). */
export function readAvailabilityHandoff(storage, draftKey, now = Date.now()) {
  try {
    const parsed = JSON.parse(storage.getItem(availabilityHandoffKey(draftKey)) || "null");
    if (!parsed || !(now - Number(parsed.savedAt) <= HANDOFF_TTL_MS)) return { ...EMPTY_AVAILABILITY };
    return {
      availability: parsed.availability ?? "",
      readyQty: parsed.readyQty ?? "",
      leadTimeDays: parsed.leadTimeDays ?? "",
      nextShipDate: parsed.nextShipDate ?? "",
    };
  } catch {
    return { ...EMPTY_AVAILABILITY };
  }
}
