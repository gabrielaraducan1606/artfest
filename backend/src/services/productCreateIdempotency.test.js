// Idempotența creării de produs (services/productCreateIdempotency.js): cheia din
// header, amprenta cererii și recunoașterea conflictului pe indexul unic.
import test from "node:test";
import assert from "node:assert/strict";
import {
  hashCreateRequest,
  isCreateIdempotencyRequested,
  isCreateRequestConflict,
  readIdempotencyKey,
} from "./productCreateIdempotency.js";

const req = (value) => ({ headers: value === undefined ? {} : { "idempotency-key": value } });

test("fără header: idempotența nu se aplică (clienți vechi, comportamentul de dinainte)", () => {
  assert.equal(readIdempotencyKey(req()), null);
  assert.equal(readIdempotencyKey(req("")), null);
});

test("cheie validă / invalidă", () => {
  assert.deepEqual(readIdempotencyKey(req("op_0123456789abcdef0123")), { key: "op_0123456789abcdef0123" });
  assert.deepEqual(readIdempotencyKey(req("scurt")), { invalid: true });
  assert.deepEqual(readIdempotencyKey(req("op_<script>alert(1)</script>xx")), { invalid: true });
  assert.deepEqual(readIdempotencyKey(req("x".repeat(101))), { invalid: true });
});

test("amprenta: aceleași date (ordinea cheilor nu contează) -> aceeași amprentă; alte date -> alta", () => {
  const a = { title: "Cană", price: 45, images: ["a", "b"], gpsrConfirmation: { accepted: true, noticeVersion: "1" } };
  const b = { gpsrConfirmation: { noticeVersion: "1", accepted: true }, images: ["a", "b"], price: 45, title: "Cană" };
  assert.equal(hashCreateRequest(a), hashCreateRequest(b));
  assert.notEqual(hashCreateRequest(a), hashCreateRequest({ ...a, price: 46 }));
  assert.notEqual(hashCreateRequest(a), hashCreateRequest({ ...a, images: ["b", "a"] }));
  // un câmp `undefined` (necompletat) nu schimbă amprenta
  assert.equal(hashCreateRequest(a), hashCreateRequest({ ...a, color: undefined }));
});

test("conflict pe cheie (două cereri simultane): doar P2002 pe indexul cheii", () => {
  assert.equal(isCreateRequestConflict({ code: "P2002", meta: { target: ["vendorId", "idempotencyKey"] } }), true);
  assert.equal(isCreateRequestConflict({ code: "P2002", meta: { target: "ProductCreateRequest_vendorId_idempotencyKey_key" } }), true);
  assert.equal(isCreateRequestConflict({ code: "P2002", meta: { target: ["slug"] } }), false);
  assert.equal(isCreateRequestConflict({ code: "P2025" }), false);
});

test("activare explicită (implicit oprit)", () => {
  assert.equal(isCreateIdempotencyRequested({}), false);
  assert.equal(isCreateIdempotencyRequested({ PRODUCT_CREATE_IDEMPOTENCY: "on" }), true);
});
