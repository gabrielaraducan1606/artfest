// backend/src/lib/secretBox.js
//
// Criptare comună pentru credentiale stocate în DB (AES-256-GCM), cu chei
// DEDICATE fiecărui domeniu, citite din env / Secret Manager:
//
//   <PREFIX>_KEYS="1:<base64 32 bytes>,2:<base64 32 bytes>"
//   <PREFIX>_KEY_VERSION=2      (versiunea folosită la criptare; implicit cea mai mare)
// sau, pentru o singură cheie (versiunea 1):
//   <PREFIX>_KEY="<base64 32 bytes>"
//
// Domenii: COURIER_CREDENTIALS (curieri - couriers/credentials/crypto.js),
// INTEGRATION_CREDENTIALS (magazine externe - integrations/core/connectionStore.js).
// Cheile NU se partajează între domenii.
//
// Generare cheie: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
//
// Format blob: [1 byte format=1][12 bytes IV][16 bytes auth tag][ciphertext]
// AAD (additional authenticated data) = contextul înregistrării, dat de
// apelant: un blob copiat pe altă înregistrare nu se mai poate decripta.

import crypto from "node:crypto";

const FORMAT_V1 = 1;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

/**
 * @param {Object} options
 * @param {string} options.envPrefix          ex. "COURIER_CREDENTIALS"
 * @param {string} options.logTag             ex. "couriers/crypto"
 * @param {() => Error} options.configError   eroarea pentru cheie lipsă / invalidă
 * @param {() => Error} options.unreadableError eroarea pentru un blob care nu se poate decripta
 */
export function createSecretBox({ envPrefix, logTag, configError, unreadableError }) {
  const KEYS = `${envPrefix}_KEYS`;
  const KEY = `${envPrefix}_KEY`;
  const KEY_VERSION = `${envPrefix}_KEY_VERSION`;

  function fail(reason) {
    // motivul e doar pentru loguri; NU conține niciodată cheia
    console.error(`[${logTag}] configurare cheie invalidă: ${reason}`);
    return configError();
  }

  function decodeKey(value, label) {
    let buf;
    try {
      buf = Buffer.from(String(value || "").trim(), "base64");
    } catch {
      throw fail(`${label}: base64 invalid`);
    }
    if (buf.length !== KEY_BYTES) {
      throw fail(`${label}: cheia trebuie să aibă ${KEY_BYTES} bytes`);
    }
    return buf;
  }

  /**
   * Citește cheile la fiecare apel (fără cache în module), ca rotația/lipsa
   * cheii să fie tratate imediat și testabil.
   * @returns {{ keys: Map<number, Buffer>, currentVersion: number }}
   */
  function loadKeyring(env = process.env) {
    const keys = new Map();

    const multi = String(env[KEYS] || "").trim();
    if (multi) {
      for (const part of multi.split(",")) {
        const [v, k] = part.split(":");
        const version = Number.parseInt(v, 10);
        if (!Number.isInteger(version) || version < 1 || !k) {
          throw fail(`${KEYS}: format așteptat <versiune>:<base64>`);
        }
        keys.set(version, decodeKey(k, `versiunea ${version}`));
      }
    } else if (String(env[KEY] || "").trim()) {
      keys.set(1, decodeKey(env[KEY], KEY));
    }

    if (!keys.size) throw fail("nicio cheie configurată");

    const requested = env[KEY_VERSION] ? Number.parseInt(env[KEY_VERSION], 10) : Math.max(...keys.keys());

    if (!keys.has(requested)) {
      throw fail(`${KEY_VERSION} nu corespunde niciunei chei`);
    }

    return { keys, currentVersion: requested };
  }

  // true dacă serverul poate cripta credentiale (fără să arunce)
  function isEncryptionConfigured(env = process.env) {
    try {
      loadKeyring(env);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * @param {Object} plainObject - datele secrete (doar în memorie)
   * @param {Buffer} aad - contextul înregistrării
   * @returns {{ cipher: Buffer, keyVersion: number }}
   */
  function encryptJson(plainObject, aad, env = process.env) {
    const { keys, currentVersion } = loadKeyring(env);
    const key = keys.get(currentVersion);

    const iv = crypto.randomBytes(IV_BYTES);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(aad);

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
   * @param {Buffer} aad - același context ca la criptare
   * @returns {Object}
   */
  function decryptJson(blob, keyVersion, aad, env = process.env) {
    const { keys } = loadKeyring(env);
    const key = keys.get(Number(keyVersion));
    if (!key) {
      console.error(`[${logTag}] lipsește cheia versiunea ${Number(keyVersion)} pentru decriptare`);
      throw unreadableError();
    }

    const buf = Buffer.from(blob || []);
    if (buf.length < 1 + IV_BYTES + TAG_BYTES + 1 || buf[0] !== FORMAT_V1) {
      throw unreadableError();
    }

    const iv = buf.subarray(1, 1 + IV_BYTES);
    const tag = buf.subarray(1 + IV_BYTES, 1 + IV_BYTES + TAG_BYTES);
    const ciphertext = buf.subarray(1 + IV_BYTES + TAG_BYTES);

    try {
      const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
      decipher.setAAD(aad);
      decipher.setAuthTag(tag);
      const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      const parsed = JSON.parse(plaintext.toString("utf8"));
      plaintext.fill(0);
      return parsed;
    } catch {
      // tag invalid (cheie greșită / blob modificat / alt context) - fără detalii
      throw unreadableError();
    }
  }

  return { loadKeyring, isEncryptionConfigured, encryptJson, decryptJson };
}
