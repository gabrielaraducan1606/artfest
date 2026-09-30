// backend/src/couriers/credentials/crypto.js

import crypto from "node:crypto";
import { CourierConfigError, CourierCredentialsUnreadableError } from "../errors.js";

/*
 * Criptarea credentialelor conturilor de curier: AES-256-GCM.
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

const FORMAT_V1 = 1;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

function configError(reason) {
  // motivul e doar pentru loguri; NU conține niciodată cheia
  console.error(`[couriers/crypto] configurare cheie invalidă: ${reason}`);
  return new CourierConfigError();
}

function decodeKey(value, label) {
  let buf;
  try {
    buf = Buffer.from(String(value || "").trim(), "base64");
  } catch {
    throw configError(`${label}: base64 invalid`);
  }
  if (buf.length !== KEY_BYTES) {
    throw configError(`${label}: cheia trebuie să aibă ${KEY_BYTES} bytes`);
  }
  return buf;
}

/**
 * Citește cheile la fiecare apel (fără cache în module), ca rotația/lipsa
 * cheii să fie tratate imediat și testabil.
 * @returns {{ keys: Map<number, Buffer>, currentVersion: number }}
 */
export function loadKeyring(env = process.env) {
  const keys = new Map();

  const multi = String(env.COURIER_CREDENTIALS_KEYS || "").trim();
  if (multi) {
    for (const part of multi.split(",")) {
      const [v, k] = part.split(":");
      const version = Number.parseInt(v, 10);
      if (!Number.isInteger(version) || version < 1 || !k) {
        throw configError("COURIER_CREDENTIALS_KEYS: format așteptat <versiune>:<base64>");
      }
      keys.set(version, decodeKey(k, `versiunea ${version}`));
    }
  } else if (String(env.COURIER_CREDENTIALS_KEY || "").trim()) {
    keys.set(1, decodeKey(env.COURIER_CREDENTIALS_KEY, "COURIER_CREDENTIALS_KEY"));
  }

  if (!keys.size) throw configError("nicio cheie configurată");

  const requested = env.COURIER_CREDENTIALS_KEY_VERSION
    ? Number.parseInt(env.COURIER_CREDENTIALS_KEY_VERSION, 10)
    : Math.max(...keys.keys());

  if (!keys.has(requested)) {
    throw configError("COURIER_CREDENTIALS_KEY_VERSION nu corespunde niciunei chei");
  }

  return { keys, currentVersion: requested };
}

// true dacă serverul poate cripta credentiale (fără să arunce)
export function isEncryptionConfigured(env = process.env) {
  try {
    loadKeyring(env);
    return true;
  } catch {
    return false;
  }
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
  const { keys, currentVersion } = loadKeyring(env);
  const key = keys.get(currentVersion);

  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(aadFor(context));

  const plaintext = Buffer.from(JSON.stringify(plainObject ?? {}), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  plaintext.fill(0);

  return {
    cipher: Buffer.concat([Buffer.from([FORMAT_V1]), iv, tag, ciphertext]),
    keyVersion: currentVersion,
  };
}

/**
 * @param {Buffer|Uint8Array} blob
 * @param {number} keyVersion
 * @param {{accountId:string, vendorId:string|null, provider:string}} context
 * @returns {Object}
 */
export function decryptJson(blob, keyVersion, context, env = process.env) {
  const { keys } = loadKeyring(env);
  const key = keys.get(Number(keyVersion));
  if (!key) {
    console.error(
      `[couriers/crypto] lipsește cheia versiunea ${Number(keyVersion)} pentru decriptare`
    );
    throw new CourierCredentialsUnreadableError();
  }

  const buf = Buffer.from(blob || []);
  if (buf.length < 1 + IV_BYTES + TAG_BYTES + 1 || buf[0] !== FORMAT_V1) {
    throw new CourierCredentialsUnreadableError();
  }

  const iv = buf.subarray(1, 1 + IV_BYTES);
  const tag = buf.subarray(1 + IV_BYTES, 1 + IV_BYTES + TAG_BYTES);
  const ciphertext = buf.subarray(1 + IV_BYTES + TAG_BYTES);

  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAAD(aadFor(context));
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    const parsed = JSON.parse(plaintext.toString("utf8"));
    plaintext.fill(0);
    return parsed;
  } catch {
    // tag invalid (cheie greșită / blob modificat / alt context) - fără detalii
    throw new CourierCredentialsUnreadableError();
  }
}
