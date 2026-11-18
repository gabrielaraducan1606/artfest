// Rulare: node --test src/pages/Vendor/Settings/couriers/samedayStoreDeliveryView.test.js
// „Livrare Sameday prin Artfest” în dashboard: starea afișată și acțiunea disponibilă,
// din răspunsul serverului (serverul decide eligibilitatea).
import { test } from "node:test";
import assert from "node:assert/strict";
import { SAMEDAY_DELIVERY_RULES, samedayDeliveryView } from "./samedayStoreDeliveryView.js";

const base = { optedIn: false, active: false, canActivate: false, disabledByArtfest: false, messages: [] };

test("eligibil, neactivat -> butonul Activează", () => {
  const v = samedayDeliveryView({ ...base, canActivate: true });
  assert.equal(v.state, "available");
  assert.equal(v.action, "activate");
});

test("activat și disponibil -> activ, cu Dezactivează", () => {
  const v = samedayDeliveryView({ ...base, optedIn: true, active: true, canActivate: true });
  assert.equal(v.state, "active");
  assert.equal(v.action, "deactivate");
});

test("activat, dar Sameday indisponibil -> „indisponibilă momentan”, livrarea obișnuită continuă", () => {
  const v = samedayDeliveryView({ ...base, optedIn: true, messages: ["Livrarea Sameday prin Artfest nu este disponibilă momentan."] });
  assert.equal(v.state, "paused");
  assert.equal(v.action, "deactivate");
  assert.match(v.description, /livrarea ta obișnuită/);
});

test("fără Stripe -> neeligibil, fără buton, cu explicația serverului", () => {
  const msg = "Pentru Sameday prin Artfest trebuie să activezi încasările online (Stripe)…";
  const v = samedayDeliveryView({ ...base, messages: [msg] });
  assert.equal(v.state, "not_eligible");
  assert.equal(v.action, null);
  assert.deepEqual(v.notes, [msg]);
});

test("restricție Artfest -> dezactivată de Artfest; vânzătorul își poate retrage alegerea", () => {
  assert.equal(samedayDeliveryView({ ...base, disabledByArtfest: true }).action, null);
  const v = samedayDeliveryView({ ...base, disabledByArtfest: true, optedIn: true });
  assert.equal(v.state, "disabled_by_artfest");
  assert.equal(v.action, "deactivate");
});

test("fără răspuns -> stare necunoscută, fără acțiune; regulile menționează plata integrală cu cardul", () => {
  assert.equal(samedayDeliveryView(null).action, null);
  assert.ok(SAMEDAY_DELIVERY_RULES.some((r) => /integral online, cu cardul/.test(r)));
});
