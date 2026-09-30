// backend/src/couriers/credentials/store.js

import crypto from "node:crypto";
import { encryptJson, decryptJson } from "./crypto.js";

/*
 * SINGURUL loc prin care credentialele unui CourierAccount sunt
 * criptate/decriptate. Credentialele decriptate trăiesc doar în memorie,
 * pe durata unui apel către curier - nu se returnează în API, nu se
 * loghează, nu se salvează în clar.
 */

// id generat aici (nu de Prisma) - e necesar ÎNAINTE de insert, pentru AAD
export function newCourierAccountId() {
  return `ca_${crypto.randomBytes(12).toString("hex")}`;
}

function contextOf(account) {
  return {
    accountId: account.id,
    vendorId: account.vendorId ?? null,
    provider: account.provider,
  };
}

/**
 * @returns {{ credentialsCipher: Buffer, credentialsKeyVersion: number }}
 */
export function sealCredentials({ accountId, vendorId, provider, credentials }) {
  const { cipher, keyVersion } = encryptJson(credentials, {
    accountId,
    vendorId,
    provider,
  });
  return { credentialsCipher: cipher, credentialsKeyVersion: keyVersion };
}

/**
 * @param {{id:string, vendorId:string|null, provider:string,
 *          credentialsCipher: Buffer|Uint8Array, credentialsKeyVersion:number}} account
 */
export function openCredentials(account) {
  return decryptJson(
    account.credentialsCipher,
    account.credentialsKeyVersion,
    contextOf(account)
  );
}

/*
 * Forma publică a unui CourierAccount (API). Lista câmpurilor e
 * EXPLICITĂ (allow-list), ca un câmp nou/secret adăugat ulterior în
 * schema să nu ajungă accidental în răspunsuri.
 */
export function toPublicCourierAccount(account) {
  if (!account) return null;
  return {
    id: account.id,
    ownerType: account.ownerType,
    provider: account.provider,
    label: account.label,
    status: account.status,
    isDefault: !!account.isDefault,
    hasCredentials: !!account.credentialsCipher,
    credentialsHint: account.credentialsHint || null,
    publicConfig: account.publicConfig || {},
    pickupAddressId: account.pickupAddressId || null,
    lastTestedAt: account.lastTestedAt || null,
    lastTestOk: account.lastTestOk ?? null,
    lastError: account.lastError || null,
    disabledAt: account.disabledAt || null,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
  };
}

// hint sigur pentru UI: primele 3 caractere + "***" (ex. "gab***")
export function maskIdentifier(value) {
  const s = String(value || "").trim();
  if (!s) return null;
  if (s.length <= 3) return `${s[0]}***`;
  return `${s.slice(0, 3)}***`;
}
