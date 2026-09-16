// src/services/vendorCollectionAttributionToken.test.js
//
// Teste deterministe pentru semnarea/verificarea tokenului de
// atribuire VendorCollection (audit 2026-09-15). Funcții PURE (JWT
// local, fără DB) - import direct.

process.env.DATABASE_URL =
  "postgresql://test:test@127.0.0.1:5";

import { test } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";

import {
  signVendorCollectionAttributionToken,
  verifyVendorCollectionAttributionToken,
  VENDOR_COLLECTION_ATTRIBUTION_WINDOW_HOURS,
} from "./vendorCollectionAttributionToken.js";

test("TTL este 168h (7 zile), identic cu vendor referral", () => {
  assert.equal(VENDOR_COLLECTION_ATTRIBUTION_WINDOW_HOURS, 168);
});

test("sign + verify: roundtrip valid, issuedAt prezent", () => {
  const token = signVendorCollectionAttributionToken({
    collectionId: "coll-1",
    ownerVendorId: "vendor-1",
  });

  const payload = verifyVendorCollectionAttributionToken(token);

  assert.equal(payload.collectionId, "coll-1");
  assert.equal(payload.ownerVendorId, "vendor-1");
  assert.equal(typeof payload.issuedAt, "number");
  assert.ok(payload.issuedAt <= Date.now());
  assert.ok(payload.issuedAt > Date.now() - 5000);
});

test("token invalid/corupt -> null, fail-open, fara throw", () => {
  assert.equal(verifyVendorCollectionAttributionToken("not-a-real-token"), null);
  assert.equal(verifyVendorCollectionAttributionToken(""), null);
  assert.equal(verifyVendorCollectionAttributionToken(null), null);
  assert.equal(verifyVendorCollectionAttributionToken(undefined), null);
});

test("token expirat -> null (H. expired token)", () => {
  const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";

  const expiredToken = jwt.sign(
    {
      purpose: "vendor_collection_attribution",
      collectionId: "coll-1",
      ownerVendorId: "vendor-1",
    },
    JWT_SECRET,
    { expiresIn: "-1h" } // deja expirat
  );

  assert.equal(
    verifyVendorCollectionAttributionToken(expiredToken),
    null
  );
});

test("token cu purpose gresit (ex. semnat pentru alt scop) -> null", () => {
  const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";

  const wrongPurposeToken = jwt.sign(
    {
      purpose: "something_else",
      collectionId: "coll-1",
      ownerVendorId: "vendor-1",
    },
    JWT_SECRET,
    { expiresIn: "1h" }
  );

  assert.equal(
    verifyVendorCollectionAttributionToken(wrongPurposeToken),
    null
  );
});

test("token fara collectionId sau ownerVendorId -> null", () => {
  const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";

  const incompleteToken = jwt.sign(
    { purpose: "vendor_collection_attribution", collectionId: "coll-1" },
    JWT_SECRET,
    { expiresIn: "1h" }
  );

  assert.equal(
    verifyVendorCollectionAttributionToken(incompleteToken),
    null
  );
});
