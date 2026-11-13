// Rulare: node --test src/pages/Vendor/CatalogProduse/VendorCollections/collectionSettings.test.js
//
// Cauza reparată: formularul „Colecție nouă” trimitea allOwnProducts=true
// implicit, deci TOATE produsele magazinului intrau automat în colecție, iar
// în selector apăreau gri („Inclus automat”). Acum selecția e MANUALĂ implicit.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  NEW_COLLECTION_SETTINGS,
  isSwitchingToAuto,
  isSwitchingToManual,
  pendingModeChange,
  settingsFromCollection,
  settingsPayload,
} from "./collectionSettings.js";
import { isSelectable } from "./collectionPicker.js";

const filled = (extra = {}) => ({ ...NEW_COLLECTION_SETTINGS, title: "  Cadouri de Crăciun ", ...extra });

test("colecție nouă: selecția e MANUALĂ implicit (allOwnProducts=false în payload)", () => {
  assert.equal(NEW_COLLECTION_SETTINGS.allOwnProducts, false);
  assert.equal(settingsFromCollection(null).allOwnProducts, false);

  const payload = settingsPayload(filled());
  assert.equal(payload.allOwnProducts, false);
  assert.equal(payload.title, "Cadouri de Crăciun");
  assert.ok(!("keepOwnProductsAsSelection" in payload), "nimic de păstrat la creare");
});

test("colecție nouă manuală: produsele proprii se pot bifa individual (nu sunt gri)", () => {
  const { allOwnProducts } = NEW_COLLECTION_SETTINGS;
  assert.equal(isSelectable({ id: "a1", isOwn: true }, { allOwnActive: allOwnProducts }), true);
  assert.equal(isSelectable({ id: "b1", isOwn: false }, { allOwnActive: allOwnProducts }), true);
});

test("includerea automată doar la alegere explicită", () => {
  assert.equal(settingsPayload(filled({ allOwnProducts: true })).allOwnProducts, true);
  // valori „truthy” care nu sunt true nu activează modul automat
  assert.equal(settingsPayload(filled({ allOwnProducts: "da" })).allOwnProducts, false);
  assert.equal(settingsFromCollection({ title: "x", allOwnProducts: "true" }).allOwnProducts, false);
});

test("editare: colecțiile existente își păstrează modul salvat", () => {
  assert.equal(settingsFromCollection({ title: "x", allOwnProducts: true }).allOwnProducts, true);
  assert.equal(settingsFromCollection({ title: "x", allOwnProducts: false }).allOwnProducts, false);

  // salvarea unei colecții automate fără schimbarea modului (ex. titlu nou) nu cere conversie
  const previous = { allOwnProducts: true };
  const payload = settingsPayload(filled({ allOwnProducts: true }), { previous });
  assert.equal(payload.allOwnProducts, true);
  assert.ok(!("keepOwnProductsAsSelection" in payload));
  assert.equal(pendingModeChange(previous, filled({ allOwnProducts: true })), null, "nimic de salvat");

  // colecție manuală salvată fără schimbarea modului: nici conversie, nici mesaj
  const manualPrev = { allOwnProducts: false };
  assert.ok(!("keepOwnProductsAsSelection" in settingsPayload(filled(), { previous: manualPrev })));
  assert.equal(pendingModeChange(manualPrev, filled()), null);
});

test("automat -> manual: produsele incluse acum rămân ÎNTOTDEAUNA bifate (fără opțiune separată)", () => {
  const previous = { allOwnProducts: true };
  const manual = filled({ allOwnProducts: false });

  assert.equal(isSwitchingToManual(previous, manual), true);
  assert.equal(isSwitchingToManual({ allOwnProducts: false }, manual), false);
  assert.equal(isSwitchingToManual(null, manual), false, "creare");

  const payload = settingsPayload(manual, { previous });
  assert.equal(payload.allOwnProducts, false);
  assert.equal(payload.keepOwnProductsAsSelection, true, "conversia păstrează produsele");
  // la creare nu există nimic de păstrat
  assert.ok(!("keepOwnProductsAsSelection" in settingsPayload(manual, { previous: null })));
});

test("schimbarea NESALVATĂ a modului e explicată clar; aplicarea doar la „Salvează”", () => {
  const toManual = pendingModeChange({ allOwnProducts: true }, filled({ allOwnProducts: false }));
  assert.equal(toManual.to, "manual");
  assert.match(toManual.title, /Salvează/);
  assert.match(toManual.text, /rămân în colecție, bifate/);
  assert.match(toManual.text, /debifa/);
  assert.match(toManual.saveLabel, /aleg eu produsele/);

  const toAuto = pendingModeChange({ allOwnProducts: false }, filled({ allOwnProducts: true }));
  assert.equal(toAuto.to, "auto");
  assert.match(toAuto.text, /toate produsele tale publice eligibile/i);
  assert.match(toAuto.text, /inclusiv cele pe care le publici de acum înainte/);
  assert.match(toAuto.text, /Produsele altor magazine .* rămân/);
  assert.equal(isSwitchingToAuto({ allOwnProducts: false }, filled({ allOwnProducts: true })), true);
  // trecerea pe automat NU trimite conversie
  assert.ok(!("keepOwnProductsAsSelection" in settingsPayload(filled({ allOwnProducts: true }), { previous: { allOwnProducts: false } })));

  assert.equal(pendingModeChange(null, filled({ allOwnProducts: true })), null, "la creare nu e o schimbare");
});
