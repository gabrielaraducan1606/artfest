// src/features/smartListing/smartListingDraft.js
//
// Ciornele LOCALE ale formularului Smart Listing (pe acest dispozitiv). Nu creează
// produse în baza de date și nu încarcă nimic: autosalvarea scrie doar în localStorage.
//
// Izolare: fiecare ciornă e legată de utilizator + magazin + id propriu, iar lista
// e ținută per utilizator + magazin. Pot exista mai multe ciorne: „Începe produs
// nou” nu o șterge pe cea veche, ștergerea e mereu explicită.
//
// Se salvează doar datele produsului, dintr-o listă închisă de chei. Fișierele
// neîncărcate nu pot fi păstrate: `blob:` nu supraviețuiește reîncărcării, așa că se
// reține doar câte erau, ca vânzătorul să știe că trebuie să le aleagă din nou.
// Datele centrale de producător (profilul vânzătorului) nu se salvează aici.

export const DRAFT_VERSION = 2;
const SUPPORTED_VERSIONS = new Set([1, DRAFT_VERSION]);
const PREFIX = "artfest-smart-listing-draft";

export function draftKey({ userId, storeSlug, draftId = "" }) {
  const base = `${PREFIX}:${String(userId || "anon")}:${String(storeSlug || "default")}`;
  return draftId ? `${base}:${draftId}` : base;
}

function indexKey({ userId, storeSlug }) {
  return `${PREFIX}-index:${String(userId || "anon")}:${String(storeSlug || "default")}`;
}

export function newDraftId(now = Date.now(), random = Math.random()) {
  return `${now.toString(36)}-${Math.floor(random * 1e9).toString(36)}`;
}

const SAVED_KEYS = [
  "details",
  "commerce",
  "variants",
  "customFields",
  "wantsOptions",
  "wantsPersonalization",
  "helpProductId",
  "safety",
  "otherProducer",
  "producerChoice",
  "variantAnswers",
  "customAnswers",
  "fieldStatus",
  "conflicts",
  "hints",
  "touched",
  "step",
  "collectionIds",
];

/** Doar fotografiile încărcate pe server. */
function serializablePhotos(photos) {
  return (Array.isArray(photos) ? photos : [])
    .filter((photo) => photo?.uploadedUrl && !String(photo.uploadedUrl).startsWith("blob:"))
    .map((photo) => ({ uploadedUrl: photo.uploadedUrl, name: photo.name || "" }));
}

export function buildDraftSnapshot(state = {}, now = new Date()) {
  const photos = serializablePhotos(state.photos);
  const snapshot = {
    version: DRAFT_VERSION,
    savedAt: now.toISOString(),
    photos,
    // selectate, dar neîncărcate încă: fișierele nu supraviețuiesc reîncărcării
    pendingPhotos: Math.max(0, (Array.isArray(state.photos) ? state.photos.length : 0) - photos.length),
  };
  for (const key of SAVED_KEYS) if (state[key] !== undefined) snapshot[key] = state[key];
  if (state.video?.url && !String(state.video.url).startsWith("blob:")) {
    snapshot.video = { url: state.video.url, muted: Boolean(state.video.muted) };
  }
  // propunerea AI rămâne, ca o valoare nevalidată să nu pară confirmată după reluare
  if (state.ai) {
    snapshot.ai = { status: state.ai.status === "done" ? "done" : "manual", proposal: state.ai.proposal || null, dropped: state.ai.dropped || [] };
  }
  return snapshot;
}

export function saveDraft(storage, key, state, now = new Date()) {
  try {
    const snapshot = buildDraftSnapshot(state, now);
    storage.setItem(key, JSON.stringify(snapshot));
    return snapshot;
  } catch {
    return null;
  }
}

/** @returns {Object|null} ciorna validă sau null (lipsă / coruptă / altă versiune) */
export function loadDraft(storage, key) {
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !SUPPORTED_VERSIONS.has(parsed.version)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearDraft(storage, key) {
  try {
    storage.removeItem(key);
  } catch {
    // stocare indisponibilă - nimic de șters
  }
}

/** Ciorna are ceva ce merită păstrat? */
export function hasMeaningfulDraft(snapshot) {
  if (!snapshot) return false;
  return Boolean(
    snapshot.photos?.length ||
      snapshot.video?.url ||
      String(snapshot.details?.title || "").trim() ||
      String(snapshot.details?.description || "").trim() ||
      String(snapshot.details?.category || "").trim() ||
      String(snapshot.commerce?.price || "").trim() ||
      String(snapshot.commerce?.stock || "").trim() ||
      String(snapshot.commerce?.leadTimeDays || "").trim() ||
      snapshot.variants?.length ||
      snapshot.customFields?.length
  );
}

/* ---------------- mai multe ciorne per utilizator + magazin ---------------- */

function readIndex(storage, scope) {
  try {
    const parsed = JSON.parse(storage.getItem(indexKey(scope)) || "[]");
    return Array.isArray(parsed) ? parsed.filter((id) => typeof id === "string" && id) : [];
  } catch {
    return [];
  }
}

function writeIndex(storage, scope, ids) {
  storage.setItem(indexKey(scope), JSON.stringify(ids));
}

/** Salvează ciorna și o trece în lista magazinului. @returns snapshot sau null */
export function saveDraftEntry(storage, scope, draftId, state, now = new Date()) {
  const snapshot = saveDraft(storage, draftKey({ ...scope, draftId }), state, now);
  if (!snapshot) return null;
  try {
    const ids = readIndex(storage, scope);
    if (!ids.includes(draftId)) writeIndex(storage, scope, [...ids, draftId]);
    return snapshot;
  } catch {
    return null;
  }
}

/** Șterge DOAR ciorna cerută. Id gol = ciorna veche, salvată înainte de a exista mai multe ciorne. */
export function deleteDraftEntry(storage, scope, draftId) {
  clearDraft(storage, draftKey({ ...scope, draftId }));
  if (!draftId) return;
  try {
    writeIndex(storage, scope, readIndex(storage, scope).filter((id) => id !== draftId));
  } catch {
    // stocare indisponibilă - lista se curăță la următoarea citire
  }
}

/** Ciornele utilizatorului pentru magazin, cea mai recentă prima. */
export function listDrafts(storage, scope) {
  const entries = [];
  // ciorna veche (o singură cheie per magazin) rămâne recuperabilă
  for (const id of ["", ...readIndex(storage, scope)]) {
    const snapshot = loadDraft(storage, draftKey({ ...scope, draftId: id }));
    if (hasMeaningfulDraft(snapshot)) entries.push({ id, snapshot });
  }
  return entries.sort((a, b) => String(b.snapshot.savedAt).localeCompare(String(a.snapshot.savedAt)));
}
