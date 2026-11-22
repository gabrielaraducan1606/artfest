// src/services/productCreateIdempotency.js
//
// Idempotența creării de produs (header `Idempotency-Key`, trimis de
// ProductModal și Smart Listing). Cheia e unică per vânzător; rândul
// ProductCreateRequest se scrie în ACEEAȘI tranzacție cu produsul, deci:
//   - retrimiterea aceleiași operațiuni (timeout, răspuns pierdut, 502/504)
//     întoarce produsul deja creat (200, `idempotentReplay: true`);
//   - aceeași cheie cu alte date -> 409 `idempotency_key_reused`;
//   - două cereri simultane: indexul unic (vendorId, idempotencyKey) o oprește
//     pe a doua (P2002) -> tranzacția ei se anulează (fără al doilea produs) și
//     primește produsul primei cereri;
//   - produse legitime asemănătoare au chei diferite -> se creează normal.
// Fără header (clienți vechi) sau fără tabel/flag: comportamentul de dinainte.
//
// Activare: PRODUCT_CREATE_IDEMPOTENCY=on (+ tabelele migrației 20261122120000).

import crypto from "node:crypto";
import { refreshProductQueueReadiness } from "./productModerationQueue.js";

const KEY_RE = /^[A-Za-z0-9_-]{16,100}$/;

export function isCreateIdempotencyRequested(env = process.env) {
  return ["1", "true", "on", "yes"].includes(String(env.PRODUCT_CREATE_IDEMPOTENCY ?? "").trim().toLowerCase());
}

/** Cheia din header, validată. null = fără idempotență; { invalid: true } = header greșit. */
export function readIdempotencyKey(req) {
  const raw = req?.get?.("Idempotency-Key") ?? req?.headers?.["idempotency-key"];
  if (raw === undefined || raw === null || raw === "") return null;
  const key = String(raw).trim();
  return KEY_RE.test(key) ? { key } : { invalid: true };
}

function stableStringify(value) {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .filter((key) => value[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
    .join(",")}}`;
}

/** Amprenta cererii (corpul, normalizat). Aceleași date -> aceeași amprentă. */
export function hashCreateRequest(body) {
  return crypto.createHash("sha256").update(stableStringify(body || {})).digest("hex");
}

/** Idempotența e activă pentru această cerere? */
export async function createIdempotencyActive(db, env = process.env) {
  if (!isCreateIdempotencyRequested(env)) return false;
  return refreshProductQueueReadiness(db);
}

export async function findCreateRequest(db, { vendorId, key }) {
  return db.productCreateRequest.findUnique({
    where: { vendorId_idempotencyKey: { vendorId, idempotencyKey: key } },
    select: { id: true, productId: true, requestHash: true, createdAt: true },
  });
}

/** În tranzacția creării, după produs. P2002 = altă cerere cu aceeași cheie a câștigat. */
export async function recordCreateRequest(tx, { vendorId, key, requestHash, productId }) {
  return tx.productCreateRequest.create({
    data: { vendorId, idempotencyKey: key, requestHash, productId },
    select: { id: true },
  });
}

export function isCreateRequestConflict(error) {
  if (error?.code !== "P2002") return false;
  const target = error?.meta?.target;
  const text = Array.isArray(target) ? target.join(",") : String(target || "");
  // fără meta (unele drivere): nu putem ști sigur -> tratăm doar ținta noastră
  return /idempotencyKey|ProductCreateRequest_vendorId_idempotencyKey/i.test(text);
}

export const IDEMPOTENCY_MESSAGES = Object.freeze({
  reused:
    "Această operațiune a fost deja folosită pentru un alt produs. Produsul salvat anterior există deja; pentru un produs nou, începe un formular nou.",
  invalid: "Cererea nu a putut fi identificată. Reîncarcă pagina și încearcă din nou.",
  deleted: "Produsul creat anterior cu această operațiune a fost șters. Începe un produs nou.",
});
