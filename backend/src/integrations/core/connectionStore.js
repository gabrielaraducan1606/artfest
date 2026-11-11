// backend/src/integrations/core/connectionStore.js
//
// SINGURUL loc prin care se creează conexiunile la magazinele externe și
// prin care credentialele / secretul webhook-urilor sunt criptate sau
// decriptate. Cheie dedicată integrărilor (lib/secretBox.js):
//   INTEGRATION_CREDENTIALS_KEYS="1:<base64 32 bytes>" (sau INTEGRATION_CREDENTIALS_KEY)
// separată de cheile curierilor. Credentialele decriptate trăiesc doar în
// memorie, pe durata unui apel către magazin - nu se returnează în API, nu
// se loghează, nu se salvează în clar.

import crypto from "node:crypto";

import { createSecretBox } from "../../lib/secretBox.js";
import { IntegrationConfigError, IntegrationCredentialsUnreadableError, IntegrationError } from "./errors.js";

const box = createSecretBox({
  envPrefix: "INTEGRATION_CREDENTIALS",
  logTag: "integrations/crypto",
  configError: () => new IntegrationConfigError(),
  unreadableError: () => new IntegrationCredentialsUnreadableError(),
});

export const isIntegrationEncryptionConfigured = (env = process.env) => box.isEncryptionConfigured(env);

// id generat aici (nu de Prisma) - e necesar ÎNAINTE de insert, pentru AAD
export function newConnectionId() {
  return `xc_${crypto.randomBytes(12).toString("hex")}`;
}

// AAD: un blob copiat pe altă conexiune / alt vânzător / alt scop nu se mai decriptează
function aad(connection, purpose) {
  if (!connection?.id || !connection?.vendorId || !connection?.platform) {
    throw new Error("integrations/crypto: id, vendorId și platform sunt obligatorii pentru AAD");
  }
  return Buffer.from(`external-connection:${purpose}:${connection.id}:${connection.vendorId}:${connection.platform}`, "utf8");
}

/* ===================== adresa magazinului ===================== */

/**
 * Normalizează adresa magazinului: doar https (http doar pentru localhost
 * cu INTEGRATIONS_ALLOW_INSECURE_HTTP=true, în dezvoltare), fără query /
 * fragment / slash final. shopKey = cheia de unicitate (host + cale).
 */
export function normalizeShopUrl(raw, env = process.env) {
  let url;
  try {
    url = new URL(String(raw || "").trim());
  } catch {
    throw new IntegrationError("invalid_shop_url", "Adresa magazinului nu este validă.");
  }

  const insecureAllowed =
    env.INTEGRATIONS_ALLOW_INSECURE_HTTP === "true" && ["localhost", "127.0.0.1"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && insecureAllowed)) {
    throw new IntegrationError("insecure_shop_url", "Adresa magazinului trebuie să înceapă cu https://.");
  }
  if (url.username || url.password) {
    throw new IntegrationError("invalid_shop_url", "Adresa magazinului nu poate conține date de autentificare.");
  }

  const path = url.pathname.replace(/\/+$/, "");
  const shopUrl = `${url.protocol}//${url.host}${path}`;
  const shopKey = `${url.host}${path}`.toLowerCase();
  return { shopUrl, shopKey };
}

/* ===================== criptare ===================== */

export function sealCredentials(connection, credentials, env = process.env) {
  const { cipher, keyVersion } = box.encryptJson(credentials, aad(connection, "credentials"), env);
  return { credentialsCipher: cipher, credentialsKeyVersion: keyVersion };
}

export function openCredentials(connection, env = process.env) {
  return box.decryptJson(
    connection.credentialsCipher,
    connection.credentialsKeyVersion,
    aad(connection, "credentials"),
    env
  );
}

export function sealWebhookSecret(connection, secret, env = process.env) {
  const { cipher, keyVersion } = box.encryptJson({ secret }, aad(connection, "webhook"), env);
  return { webhookSecretCipher: cipher, webhookSecretKeyVersion: keyVersion };
}

export function openWebhookSecret(connection, env = process.env) {
  if (!connection?.webhookSecretCipher) return null;
  return box.decryptJson(connection.webhookSecretCipher, connection.webhookSecretKeyVersion, aad(connection, "webhook"), env).secret;
}

export function newWebhookSecret() {
  return crypto.randomBytes(32).toString("base64url");
}

// „ck_…a1b2” - doar ultimele caractere, ca vânzătorul să recunoască cheia
export function maskCredential(value) {
  const text = String(value || "");
  if (text.length <= 4) return "••••";
  return `${text.slice(0, 3)}…${text.slice(-4)}`;
}

/* ===================== conexiuni ===================== */

/**
 * Creează conexiunea (PENDING) cu credentialele criptate. Același magazin
 * nu poate fi conectat activ de două ori (unicitate platform + activeShopKey).
 */
export async function createConnection({
  db,
  vendorId,
  platform,
  shopUrl: rawShopUrl,
  credentials,
  credentialsHint = null,
  label = null,
  userId = null,
  env = process.env,
}) {
  const { shopUrl, shopKey } = normalizeShopUrl(rawShopUrl, env);
  const id = newConnectionId();
  const sealed = sealCredentials({ id, vendorId, platform }, credentials, env);

  try {
    return await db.externalStoreConnection.create({
      data: {
        id,
        vendorId,
        platform,
        label,
        shopUrl,
        activeShopKey: shopKey,
        status: "PENDING",
        credentialsHint,
        connectedByUserId: userId,
        ...sealed,
      },
    });
  } catch (error) {
    if (error?.code === "P2002") {
      throw new IntegrationError(
        "shop_already_connected",
        "Acest magazin este deja conectat la Artfest. Deconectează conexiunea existentă înainte de a crea una nouă.",
        { status: 409 }
      );
    }
    throw error;
  }
}

/**
 * Deconectare: conexiunea rămâne pentru istoric, dar fără credentiale,
 * fără secretul webhook-urilor și fără cheia de unicitate (magazinul poate
 * fi reconectat). Legăturile produselor rămân (produsele Artfest nu se
 * șterg); sincronizarea se oprește.
 */
export async function disconnectConnection({ db, connectionId, vendorId, now = new Date() }) {
  const result = await db.externalStoreConnection.updateMany({
    where: { id: connectionId, vendorId, status: { not: "DISCONNECTED" } },
    data: {
      status: "DISCONNECTED",
      activeShopKey: null,
      credentialsCipher: Buffer.alloc(0),
      credentialsHint: null,
      webhookSecretCipher: null,
      webhookSecretKeyVersion: null,
      disconnectedAt: now,
    },
  });
  if (result.count === 1) {
    // joburile în așteptare nu mai au ce face
    await db.externalSyncJob.updateMany({
      where: { connectionId, status: "QUEUED" },
      data: { status: "CANCELLED", dedupeKey: null, finishedAt: now },
    });
  }
  return result.count === 1;
}

/*
 * Forma publică a unei conexiuni (API). Allow-list EXPLICITĂ: un câmp
 * nou/secret adăugat în schemă nu ajunge accidental în răspunsuri.
 */
export function toPublicConnection(connection) {
  if (!connection) return null;
  return {
    id: connection.id,
    platform: connection.platform,
    label: connection.label || null,
    shopUrl: connection.shopUrl,
    status: connection.status,
    hasCredentials: Boolean(connection.credentialsCipher?.length),
    credentialsHint: connection.credentialsHint || null,
    stockMaster: connection.stockMaster,
    syncStock: connection.syncStock,
    syncPrice: connection.syncPrice,
    syncContent: connection.syncContent,
    safetyBufferQty: connection.safetyBufferQty,
    isPaused: connection.isPaused,
    lastTestedAt: connection.lastTestedAt || null,
    lastSyncAt: connection.lastSyncAt || null,
    lastSuccessAt: connection.lastSuccessAt || null,
    lastErrorAt: connection.lastErrorAt || null,
    lastErrorCode: connection.lastErrorCode || null,
    lastErrorMessage: connection.lastErrorMessage || null,
    createdAt: connection.createdAt,
  };
}
