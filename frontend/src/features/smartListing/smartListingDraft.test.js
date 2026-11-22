// node --test src/features/smartListing/smartListingDraft.test.js
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildDraftSnapshot,
  draftKey,
  draftRevision,
  listDrafts,
  loadDraft,
  resolveDraftWrite,
  saveDraftEntry,
} from "./smartListingDraft.js";

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
  };
}

const scope = { userId: "u1", storeSlug: "magazin" };
const state = (title, photos = []) => ({ details: { title }, photos });

test("fotografiile în upload nu intră în ciornă, doar numărul lor", () => {
  const snapshot = buildDraftSnapshot(
    state("Cană", [
      { uploadedUrl: "https://cdn/x.jpg", name: "x" },
      { uploadedUrl: "", previewUrl: "blob:abc" },
    ])
  );
  assert.deepEqual(snapshot.photos, [{ uploadedUrl: "https://cdn/x.jpg", name: "x" }]);
  assert.equal(snapshot.pendingPhotos, 1);
});

test("salvare + recuperare: fiecare scriere are o revizie nouă", () => {
  const storage = memoryStorage();
  const first = saveDraftEntry(storage, scope, "d1", state("Cană"));
  const second = saveDraftEntry(storage, scope, "d1", state("Cană mare"));
  assert.ok(first.rev && second.rev && first.rev !== second.rev);
  const loaded = loadDraft(storage, draftKey({ ...scope, draftId: "d1" }));
  assert.equal(loaded.details.title, "Cană mare");
  assert.equal(draftRevision(loaded), second.rev);
  assert.equal(listDrafts(storage, scope).length, 1);
});

test("două taburi pe aceeași ciornă: al doilea nu o suprascrie", () => {
  const storage = memoryStorage();
  const base = saveDraftEntry(storage, scope, "d1", state("Cană"));
  // ambele taburi au deschis ciorna la revizia `base.rev`
  assert.equal(resolveDraftWrite(storage, scope, "d1", base.rev, state("Cană A")).action, "write");
  const a = saveDraftEntry(storage, scope, "d1", state("Cană A"));
  // tabul B are încă revizia veche și alt conținut -> ciornă nouă
  assert.equal(resolveDraftWrite(storage, scope, "d1", base.rev, state("Cană B")).action, "fork");
  // tabul A continuă normal pe revizia lui
  assert.equal(resolveDraftWrite(storage, scope, "d1", a.rev, state("Cană A2")).action, "write");
});

test("două taburi care doar au deschis ciorna nu creează duplicate", () => {
  const storage = memoryStorage();
  const base = saveDraftEntry(storage, scope, "d1", state("Cană"));
  const a = saveDraftEntry(storage, scope, "d1", state("Cană"));
  const result = resolveDraftWrite(storage, scope, "d1", base.rev, state("Cană"));
  assert.deepEqual(result, { action: "same", rev: a.rev });
});

test("ciorna veche fără rev: revizia e data salvării", () => {
  const storage = memoryStorage();
  const legacy = { version: 2, savedAt: "2026-11-01T10:00:00.000Z", details: { title: "Veche" }, photos: [] };
  storage.setItem(draftKey({ ...scope, draftId: "old" }), JSON.stringify(legacy));
  assert.equal(draftRevision(legacy), legacy.savedAt);
  assert.equal(resolveDraftWrite(storage, scope, "old", legacy.savedAt, state("Veche 2")).action, "write");
  // ciornă nouă, încă nescrisă: nimic de comparat
  assert.equal(resolveDraftWrite(storage, scope, "nou", "", state("X")).action, "write");
});
