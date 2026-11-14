// Rulare: node --test src/pages/Vendor/Produse/hooks/customizationPhotos.test.js
//
// Valoarea unui câmp foto de personalizare cu mai multe fotografii:
// 1 fotografie rămâne URL (string, ca în comenzile existente), mai multe
// devin listă, fără duplicate; eliminarea individuală; limita de 50.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CUSTOMIZATION_MAX_PHOTOS,
  addCustomizationPhoto,
  removeCustomizationPhoto,
  toPhotoList,
} from "./customizationUpload.js";

const A = "https://cdn.example.test/customizations/a.jpg";
const B = "https://cdn.example.test/customizations/b.jpg";
const C = "https://cdn.example.test/customizations/c.jpg";

test("prima fotografie se salvează ca string (compatibil cu valorile vechi)", () => {
  assert.equal(addCustomizationPhoto(undefined, A), A);
  assert.equal(addCustomizationPhoto("", A), A);
});

test("fotografiile următoare se adaugă la cele existente, fără duplicate", () => {
  const two = addCustomizationPhoto(A, B);
  assert.deepEqual(two, [A, B]);
  assert.deepEqual(addCustomizationPhoto(two, C), [A, B, C]);
  assert.deepEqual(addCustomizationPhoto(two, A), [A, B]);
});

test("eliminare individuală: listă -> string -> undefined", () => {
  assert.deepEqual(removeCustomizationPhoto([A, B, C], B), [A, C]);
  assert.equal(removeCustomizationPhoto([A, B], A), B);
  assert.equal(removeCustomizationPhoto(A, A), undefined);
  assert.equal(removeCustomizationPhoto(A, B), A);
});

test("toPhotoList ignoră valorile goale sau ne-text", () => {
  assert.deepEqual(toPhotoList(A), [A]);
  assert.deepEqual(toPhotoList([A, "", null, 3, B]), [A, B]);
  assert.deepEqual(toPhotoList(undefined), []);
});

test("50 de fotografii rămân toate în valoare, în ordine", () => {
  assert.equal(CUSTOMIZATION_MAX_PHOTOS, 50);

  let value;
  const urls = Array.from({ length: CUSTOMIZATION_MAX_PHOTOS }, (_, i) =>
    `https://cdn.example.test/customizations/${i}.jpg`
  );
  for (const url of urls) value = addCustomizationPhoto(value, url);

  assert.deepEqual(value, urls);
});
