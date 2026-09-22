// src/utils/traderStatus.test.js
//
// Rulare: node --test src/utils/traderStatus.test.js   (din frontend/)
//
// Folosește forma REALĂ a sumarului de checkout: itemii din
// summary.groups[].items NU au vendorBilling (mapCartItemForCheckout);
// doar summary.items îl are. Defectul original: statusul se căuta doar
// în group.items -> nu se afișa niciodată.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  getGroupTraderStatus,
  getTraderStatusLabel,
  normalizeTraderStatus,
} from "./traderStatus.js";

// forma de la backend (cart / guest): grup fără vendorBilling pe itemi
const serverGroup = (vendorId, serviceId) => ({
  serviceId,
  vendorId,
  serviceTitle: "Magazin",
  items: [{ productId: "p1", title: "Produs", qty: 1, price: 10 }],
});

// summary.items: au vendorId/serviceId/vendorBilling
const topItem = (vendorId, serviceId, traderStatus) => ({
  productId: "p1",
  vendorId,
  serviceId,
  vendorBilling: { tvaActive: false, vatRate: null, vatStatus: null, traderStatus },
});

test("PROFESSIONAL: găsit din summary.items când group.items nu are vendorBilling", () => {
  const status = getGroupTraderStatus(serverGroup("vA", "sA"), [topItem("vA", "sA", "PROFESSIONAL")]);
  assert.equal(status, "PROFESSIONAL");
  assert.equal(getTraderStatusLabel(status), "Profesionist/comerciant");
});

test("NON_PROFESSIONAL: găsit din summary.items", () => {
  const status = getGroupTraderStatus(serverGroup("vA", "sA"), [topItem("vA", "sA", "NON_PROFESSIONAL")]);
  assert.equal(status, "NON_PROFESSIONAL");
  assert.match(getTraderStatusLabel(status), /Neprofesionist/);
});

test("multi-vendor: fiecare grup primește statusul VÂNZĂTORULUI SĂU, fără contaminare", () => {
  const items = [topItem("vA", "sA", "PROFESSIONAL"), topItem("vB", "sB", "NON_PROFESSIONAL")];

  assert.equal(getGroupTraderStatus(serverGroup("vA", "sA"), items), "PROFESSIONAL");
  assert.equal(getGroupTraderStatus(serverGroup("vB", "sB"), items), "NON_PROFESSIONAL");
  assert.equal(getGroupTraderStatus(serverGroup("vC", "sC"), items), null);
});

test("checkout din ofertă: itemii grupului au deja vendorBilling -> folosit direct", () => {
  const group = { vendorId: "vA", serviceId: "sA", items: [topItem("vA", "sA", "NON_PROFESSIONAL")] };
  assert.equal(getGroupTraderStatus(group, []), "NON_PROFESSIONAL");
});

test("potrivire și după serviceId când vendorId lipsește pe grup", () => {
  const items = [topItem("vA", "sA", "PROFESSIONAL")];
  assert.equal(getGroupTraderStatus({ serviceId: "sA", items: [] }, items), "PROFESSIONAL");
});

test("NULL: status necunoscut -> null, fără crash (vânzători vechi)", () => {
  assert.equal(getGroupTraderStatus(serverGroup("vA", "sA"), [topItem("vA", "sA", null)]), null);
  assert.equal(getTraderStatusLabel(null), null);
});

test("date lipsă/invalide nu produc excepții", () => {
  assert.equal(getGroupTraderStatus(undefined, undefined), null);
  assert.equal(getGroupTraderStatus(null, null), null);
  assert.equal(getGroupTraderStatus({}, [{}]), null);
  assert.equal(getGroupTraderStatus({ vendorId: "vA", items: null }, "nu-e-array"), null);
  assert.equal(getGroupTraderStatus(serverGroup("vA", "sA"), [null, undefined, { vendorId: "vA" }]), null);
  assert.equal(getGroupTraderStatus(serverGroup("vA", "sA"), [{ vendorId: "vA", vendorBilling: null }]), null);
  assert.equal(normalizeTraderStatus("ALTCEVA"), null);
  assert.equal(normalizeTraderStatus(undefined), null);
});

test("ID-uri numerice vs string se potrivesc", () => {
  assert.equal(
    getGroupTraderStatus({ vendorId: 7, items: [] }, [{ vendorId: "7", vendorBilling: { traderStatus: "PROFESSIONAL" } }]),
    "PROFESSIONAL"
  );
});
