// Rulare: node --test src/pages/Admin/AdminDesktop/tabs/posProducts.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  OWNER_ARTFEST,
  OWNER_PARTICIPANT,
  canAddStock,
  findSameTitle,
  inventoryClosedMessage,
  normalizeProductTitle,
  ownerSplitText,
  parseLabelCopies,
  parsePriceRon,
  parseReceivedQty,
  productSaleState,
  validateNewProduct,
} from "./posProducts.js";

const STORES = [{ serviceId: "s1", name: "Atelier Ana" }, { serviceId: "s2", name: "Ana Decor" }];
const base = { title: "Pungă de cadou", priceRon: "4,50", receivedQty: "20", confirmReceived: true };

test("formular: proprietar Artfest - stoc propriu => corp fără participant / magazin", () => {
  const r = validateNewProduct({ ...base, owner: OWNER_ARTFEST }, { clientRequestId: "req-12345678" });
  assert.equal(r.ok, true, JSON.stringify(r.fields));
  assert.deepEqual(r.body, { owner: "ARTFEST", clientRequestId: "req-12345678", title: "Pungă de cadou", priceRon: "4,50", receivedQty: 20, confirmReceived: true });
});

test("formular: participant => participantul și magazinul ales (obligatoriu când are magazine)", () => {
  const noStore = validateNewProduct({ ...base, owner: OWNER_PARTICIPANT, registrationId: "r1" }, { stores: STORES });
  assert.ok(noStore.fields.serviceId);
  const other = validateNewProduct({ ...base, owner: OWNER_PARTICIPANT, registrationId: "r1", serviceId: "altul" }, { stores: STORES });
  assert.ok(other.fields.serviceId);
  const ok = validateNewProduct({ ...base, owner: OWNER_PARTICIPANT, registrationId: "r1", serviceId: "s2" }, { clientRequestId: "req-12345678", stores: STORES });
  assert.equal(ok.ok, true);
  assert.equal(ok.body.registrationId, "r1");
  assert.equal(ok.body.serviceId, "s2");
  // participant fără magazin de produse: fără magazin
  const none = validateNewProduct({ ...base, owner: OWNER_PARTICIPANT, registrationId: "r1" }, { stores: [] });
  assert.equal(none.ok, true);
  assert.equal(none.body.serviceId, undefined);
  assert.ok(validateNewProduct({ ...base, owner: OWNER_PARTICIPANT }).fields.owner);
});

test("formular: stoc primit fizic + confirmare explicită obligatorie; validări", () => {
  const empty = validateNewProduct({});
  assert.deepEqual(Object.keys(empty.fields).sort(), ["owner", "priceRon", "receivedQty", "title"]);
  const noConfirm = validateNewProduct({ ...base, owner: OWNER_ARTFEST, confirmReceived: false });
  assert.match(noConfirm.fields.confirmReceived, /Confirmă că ai primit fizic 20 buc/);
  for (const receivedQty of ["0", "1001", "2.5", ""]) {
    assert.ok(validateNewProduct({ ...base, owner: OWNER_ARTFEST, receivedQty }).fields.receivedQty, receivedQty);
  }
  for (const priceRon of ["0", "-3", "abc", "4,505", ""]) {
    assert.ok(validateNewProduct({ ...base, owner: OWNER_ARTFEST, priceRon }).fields.priceRon, priceRon);
  }
  assert.ok(validateNewProduct({ ...base, owner: OWNER_ARTFEST, title: "x".repeat(201) }).fields.title);
  assert.equal(parsePriceRon("4.5"), 450);
  assert.equal(parseReceivedQty("12"), 12);
  assert.equal(parseReceivedQty("0"), null);
});

test("denumire dublată la același proprietar: fără diacritice / majuscule; anulatele și ciornele ignorate", () => {
  const lines = [
    { title: "Pungă de cadou mică", status: "RECEIVED", barcodeDisplay: "AF-2345-6789" },
    { title: "Ambalaj", status: "CANCELLED" },
    { title: "Funda", status: "DRAFT" },
  ];
  assert.equal(normalizeProductTitle("  PUNGĂ  de Cadou mică "), "punga de cadou mica");
  assert.equal(findSameTitle(lines, "punga de cadou MICA")?.barcodeDisplay, "AF-2345-6789");
  assert.equal(findSameTitle(lines, "Ambalaj"), null);
  assert.equal(findSameTitle(lines, "Funda"), null);
  assert.equal(findSameTitle(lines, ""), null);
});

test("starea explicată, împărțirea banilor, suplimentarea stocului", () => {
  assert.match(productSaleState({ status: "SUBMITTED", declaredQty: 10 }).text, /Așteaptă recepția \(10 buc\. declarate\)/);
  assert.deepEqual(productSaleState({ status: "RECEIVED", availableQty: 7 }), { sellable: true, tone: "ok", text: "De vânzare: 7 buc. disponibile." });
  assert.match(productSaleState({ status: "RECEIVED", availableQty: 0 }).text, /Fără stoc/);
  const noLabel = productSaleState({ status: "RECEIVED", availableQty: 4, label: { state: "none" } });
  assert.equal(noLabel.sellable, false);
  assert.match(noLabel.text, /Generează eticheta înainte de vânzare/);
  assert.match(productSaleState({ status: "RECEIVED", availableQty: 3, saleBlocked: { reason: "verificare" } }).text, /Blocat de la vânzare: verificare/);
  assert.match(productSaleState({ status: "RECEIVED", availableQty: 3, registrationStatus: "CANCELLED" }).text, /Participarea/);
  assert.match(ownerSplitText({ artfestOwned: true }), /integral Artfest/);
  assert.match(ownerSplitText({ artfestOwned: false }), /10% Artfest, 90% vânzătorul/);
  assert.equal(canAddStock({ isManual: true, status: "RECEIVED", artfestOwned: true }), true);
  assert.equal(canAddStock({ isManual: true, status: "RECEIVED", registrationStatus: "APPROVED" }), true);
  assert.equal(canAddStock({ isManual: true, status: "RECEIVED", registrationStatus: "CANCELLED" }), false);
  assert.equal(canAddStock({ isManual: false, status: "RECEIVED", registrationStatus: "APPROVED" }), false);
  assert.equal(canAddStock({ isManual: true, status: "SUBMITTED", artfestOwned: true }), false);
});

test("număr de etichete 1 … 240; termenul trecut: excepția Admin explicată", () => {
  assert.equal(parseLabelCopies("3"), 3);
  for (const bad of ["0", "241", "2.5", "", "abc"]) assert.equal(parseLabelCopies(bad), null, bad);
  assert.match(inventoryClosedMessage("2026-12-01T18:00:00Z"), /Termenul pentru inventarul vânzătorilor a trecut \(01\.12\.2026/);
  assert.match(inventoryClosedMessage(null), /Ca Admin poți adăuga produse și suplimenta stocul/);
});
