// backend/src/couriers/credentials/crypto.js

import { createSecretBox } from "../../lib/secretBox.js";
import { CourierConfigError, CourierCredentialsUnreadableError } from "../errors.js";

/*
 * Criptarea credentialelor conturilor de curier: AES-256-GCM, prin
 * mecanismul comun lib/secretBox.js (cheile curierilor rămân separate).
 *
 * Cheia e DEDICATĂ (nu JWT_SECRET etc.), din env / Secret Manager:
 *
 *   COURIER_CREDENTIALS_KEYS="1:<base64 32 bytes>,2:<base64 32 bytes>"
 *   COURIER_CREDENTIALS_KEY_VERSION=2      (versiunea folosită la criptare;
 *                                          implicit cea mai mare)
 *
 * sau, pentru o singură cheie (versiunea 1):
 *
 *   COURIER_CREDENTIALS_KEY="<base64 32 bytes>"
 *
 * Generare cheie: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
 *
 * Rotație: se adaugă o versiune nouă în COURIER_CREDENTIALS_KEYS și se
 * mută COURIER_CREDENTIALS_KEY_VERSION pe ea; conturile vechi se decriptează
 * în continuare cu versiunea salvată în CourierAccount.credentialsKeyVersion
 * și sunt re-criptate cu cheia nouă la următoarea salvare.
 *
 * Format blob (CourierAccount.credentialsCipher):
 *   [1 byte format=1][12 bytes IV][16 bytes auth tag][ciphertext]
 *
 * AAD (additional authenticated data) = contextul contului
 * (accountId + vendorId + provider): un blob copiat pe alt cont / alt
 * vendor NU se mai poate decripta.
 */

const box = createSecretBox({
  envPrefix: "COURIER_CREDENTIALS",
  logTag: "couriers/crypto",
  configError: () => new CourierConfigError(),
  unreadableError: () => new CourierCredentialsUnreadableError(),
});

/**
 * Citește cheile la fiecare apel (fără cache în module), ca rotația/lipsa
 * cheii să fie tratate imediat și testabil.
 * @returns {{ keys: Map<number, Buffer>, currentVersion: number }}
 */
export function loadKeyring(env = process.env) {
  return box.loadKeyring(env);
}

// true dacă serverul poate cripta credentiale (fără să arunce)
export function isEncryptionConfigured(env = process.env) {
  return box.isEncryptionConfigured(env);
}

function aadFor(context) {
  const { accountId, vendorId, provider } = context || {};
  if (!accountId || !provider) {
    throw new Error("couriers/crypto: accountId și provider sunt obligatorii pentru AAD");
  }
  return Buffer.from(`courier-account:${accountId}:${vendorId || "platform"}:${provider}`, "utf8");
}

/**
 * @param {Object} plainObject - credentialele (doar în memorie)
 * @param {{accountId:string, vendorId:string|null, provider:string}} context
 * @returns {{ cipher: Buffer, keyVersion: number }}
 */
export function encryptJson(plainObject, context, env = process.env) {
  return box.encryptJson(plainObject, aadFor(context), env);
}

/**
 * @param {Buffer|Uint8Array} blob
 * @param {number} keyVersion
 * @param {{accountId:string, vendorId:string|null, provider:string}} context
 * @returns {Object}
 */
export function decryptJson(blob, keyVersion, context, env = process.env) {
  return box.decryptJson(blob, keyVersion, aadFor(context), env);
}
