// backend/src/couriers/accounts.js

import { prisma as defaultDb } from "../db.js";
import { getCourierProvider, invalidateCourierSession } from "./registry.js";
import { sanitizeCredentialsInput, sanitizePublicConfig } from "./contract.js";
import {
  CourierAuthError,
  CourierConfigError,
  CourierError,
  CourierValidationError,
  isCourierError,
} from "./errors.js";
import { isEncryptionConfigured } from "./credentials/crypto.js";
import {
  newCourierAccountId,
  openCredentials,
  sealCredentials,
  toPublicCourierAccount,
} from "./credentials/store.js";

/*
 * Conturile de curier ale VENDORILOR (ownerType = VENDOR). Toate operațiile
 * primesc vendorId din sesiune și filtrează după el - un vendor nu poate
 * vedea / testa / edita / șterge contul altui vendor (404, fără să
 * dezvăluie existența contului).
 *
 * Conturile PLATFORM (contract Artfest) vor avea flux separat de admin.
 */

class NotFoundError extends CourierError {
  constructor(code = "courier_account_not_found", message = "Contul de curier nu a fost găsit.") {
    super(code, message, { httpStatus: 404 });
  }
}

function sanitizeLabel(raw, fallback) {
  const label = String(raw ?? "").replace(/\s+/g, " ").trim().slice(0, 160);
  return label || fallback;
}

// un singur default per vendor: serializăm operațiile pe vendor (advisory lock)
async function lockVendorScope(tx, scope, vendorId) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`${scope}:${vendorId}`}))`;
}

async function findOwnedAccount(db, vendorId, id, { includeDisabled = false } = {}) {
  const account = await db.courierAccount.findFirst({
    where: {
      id: String(id || ""),
      vendorId,
      ownerType: "VENDOR",
      ...(includeDisabled ? {} : { disabledAt: null }),
    },
  });
  if (!account) throw new NotFoundError();
  return account;
}

async function assertOwnedPickupAddress(db, vendorId, pickupAddressId) {
  if (pickupAddressId == null || pickupAddressId === "") return null;
  const addr = await db.vendorPickupAddress.findFirst({
    where: { id: String(pickupAddressId), vendorId },
    select: { id: true },
  });
  if (!addr) {
    throw new CourierValidationError("Adresa de ridicare nu a fost găsită.", ["pickupAddressId"]);
  }
  return addr.id;
}

function assertEncryptionReady() {
  // verificat ÎNAINTE de a contacta curierul: fără cheie nu salvăm nimic
  if (!isEncryptionConfigured()) throw new CourierConfigError();
}

// eroare sigură pentru lastError (mesajul fix al erorii, niciodată răspunsul brut)
function safeErrorMessage(e) {
  return isCourierError(e) ? e.message : "Eroare neașteptată la testarea conexiunii.";
}

export async function listVendorCourierAccounts(vendorId, db = defaultDb) {
  const rows = await db.courierAccount.findMany({
    where: { vendorId, ownerType: "VENDOR", disabledAt: null },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
  });
  return rows.map(toPublicCourierAccount);
}

/**
 * Testează conexiunea ÎNAINTE de salvare; dacă testul eșuează, contul NU
 * se creează. Dacă reușește, credentialele se criptează și contul e ACTIVE.
 */
export async function createVendorCourierAccount(vendorId, body = {}, db = defaultDb) {
  const def = getCourierProvider(body.provider);
  const credentials = sanitizeCredentialsInput(def, body.credentials);
  const publicConfig = sanitizePublicConfig(def, body.publicConfig);
  const label = sanitizeLabel(body.label, def.name);
  const pickupAddressId = await assertOwnedPickupAddress(db, vendorId, body.pickupAddressId);

  assertEncryptionReady();

  const test = await def.testConnection({ accountId: null, credentials, publicConfig });

  const id = newCourierAccountId();
  const sealed = sealCredentials({ accountId: id, vendorId, provider: def.id, credentials });
  const now = new Date();

  const account = await db.$transaction(async (tx) => {
    await lockVendorScope(tx, "courier-default", vendorId);

    const activeCount = await tx.courierAccount.count({
      where: { vendorId, ownerType: "VENDOR", disabledAt: null },
    });
    const makeDefault = activeCount === 0 || body.isDefault === true;

    if (makeDefault) {
      await tx.courierAccount.updateMany({
        where: { vendorId, ownerType: "VENDOR", isDefault: true },
        data: { isDefault: false },
      });
    }

    return tx.courierAccount.create({
      data: {
        id,
        ownerType: "VENDOR",
        vendorId,
        provider: def.id,
        label,
        status: "ACTIVE",
        isDefault: makeDefault,
        ...sealed,
        credentialsHint: def.credentialsHint(credentials) || null,
        publicConfig,
        pickupAddressId,
        lastTestedAt: now,
        lastTestOk: true,
        lastError: null,
      },
    });
  });

  return { account: toPublicCourierAccount(account), details: test?.details || null };
}

/**
 * Testează un cont salvat. Rezultatul (inclusiv eșecul) se persistă în
 * lastTestedAt / lastTestOk / lastError / status; răspunsul e mereu 200
 * cu { ok, error? } ca UI-ul să afișeze starea.
 */
export async function testVendorCourierAccount(vendorId, id, db = defaultDb) {
  const account = await findOwnedAccount(db, vendorId, id);
  const def = getCourierProvider(account.provider);

  let result;
  let error = null;

  try {
    const credentials = openCredentials(account);
    result = await def.testConnection({
      accountId: account.id,
      credentials,
      publicConfig: account.publicConfig || {},
    });
  } catch (e) {
    if (!isCourierError(e)) {
      console.error("[couriers] test connection unexpected error:", e?.name || "Error");
    }
    error = e;
  }

  const data = {
    lastTestedAt: new Date(),
    lastTestOk: !error,
    lastError: error ? safeErrorMessage(error) : null,
  };
  if (!error) data.status = "ACTIVE";
  else if (error instanceof CourierAuthError) data.status = "INVALID_CREDENTIALS";

  const updated = await db.courierAccount.update({ where: { id: account.id }, data });

  return {
    ok: !error,
    account: toPublicCourierAccount(updated),
    ...(error
      ? { error: { code: error.code || "courier_test_failed", message: safeErrorMessage(error) } }
      : { details: result?.details || null }),
  };
}

/**
 * PATCH: label, publicConfig, pickupAddressId; credentialele pot fi doar
 * ÎNLOCUITE (set complet), niciodată citite. Dacă se schimbă credentialele
 * sau mediul, se testează conexiunea înainte de salvare.
 */
export async function updateVendorCourierAccount(vendorId, id, body = {}, db = defaultDb) {
  const account = await findOwnedAccount(db, vendorId, id);
  const def = getCourierProvider(account.provider);
  const data = {};

  if (body.label !== undefined) data.label = sanitizeLabel(body.label, account.label);

  if (body.pickupAddressId !== undefined) {
    data.pickupAddressId = await assertOwnedPickupAddress(db, vendorId, body.pickupAddressId);
  }

  const configChanged = body.publicConfig !== undefined;
  const publicConfig = configChanged
    ? sanitizePublicConfig(def, body.publicConfig, { current: account.publicConfig || {} })
    : account.publicConfig || {};
  if (configChanged) data.publicConfig = publicConfig;

  const replacingCredentials = body.credentials !== undefined;

  if (replacingCredentials || configChanged) {
    assertEncryptionReady();

    const credentials = replacingCredentials
      ? sanitizeCredentialsInput(def, body.credentials)
      : openCredentials(account);

    // aruncă la eșec -> nimic nu se salvează
    await def.testConnection({ accountId: null, credentials, publicConfig });

    if (replacingCredentials) {
      Object.assign(
        data,
        sealCredentials({
          accountId: account.id,
          vendorId: account.vendorId,
          provider: account.provider,
          credentials,
        })
      );
      data.credentialsHint = def.credentialsHint(credentials) || null;
    }

    Object.assign(data, {
      status: "ACTIVE",
      lastTestedAt: new Date(),
      lastTestOk: true,
      lastError: null,
    });
  }

  if (!Object.keys(data).length) return toPublicCourierAccount(account);

  const updated = await db.courierAccount.update({ where: { id: account.id }, data });

  if (replacingCredentials || configChanged) {
    invalidateCourierSession(account.provider, account.id);
  }

  return toPublicCourierAccount(updated);
}

/**
 * DELETE = dezactivare (soft): status DISABLED, disabledAt, iar
 * credentialele criptate sunt ȘTERSE (blob gol) - nu mai păstrăm secrete
 * pentru un cont deconectat. Rândul rămâne pentru istoricul viitoarelor
 * AWB-uri. Dacă era default, alt cont activ devine default.
 */
export async function deleteVendorCourierAccount(vendorId, id, db = defaultDb) {
  const account = await findOwnedAccount(db, vendorId, id);
  const wasDefault = !!account.isDefault;

  await db.$transaction(async (tx) => {
    await lockVendorScope(tx, "courier-default", vendorId);

    await tx.courierAccount.update({
      where: { id: account.id },
      data: {
        status: "DISABLED",
        disabledAt: new Date(),
        isDefault: false,
        credentialsCipher: Buffer.alloc(0),
        credentialsHint: null,
      },
    });

    if (wasDefault) {
      const next = await tx.courierAccount.findFirst({
        where: { vendorId, ownerType: "VENDOR", disabledAt: null },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });
      if (next) {
        await tx.courierAccount.update({ where: { id: next.id }, data: { isDefault: true } });
      }
    }
  });

  invalidateCourierSession(account.provider, account.id);
  return { ok: true };
}

export async function setDefaultVendorCourierAccount(vendorId, id, db = defaultDb) {
  const account = await findOwnedAccount(db, vendorId, id);

  const updated = await db.$transaction(async (tx) => {
    await lockVendorScope(tx, "courier-default", vendorId);

    await tx.courierAccount.updateMany({
      where: { vendorId, ownerType: "VENDOR", isDefault: true, NOT: { id: account.id } },
      data: { isDefault: false },
    });

    return tx.courierAccount.update({ where: { id: account.id }, data: { isDefault: true } });
  });

  return toPublicCourierAccount(updated);
}
