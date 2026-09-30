// backend/src/couriers/pickupAddresses.js

import { prisma as defaultDb } from "../db.js";
import { CourierError, CourierValidationError } from "./errors.js";

/*
 * Adrese de ridicare STRUCTURATE ale vendorului (VendorPickupAddress),
 * folosite de curieri. Un vendor poate avea mai multe; exact una implicită
 * (prima adăugată devine automat implicită).
 *
 * providerRefs (id-uri de nomenclator per curier) NU se primesc de la
 * client - vor fi completate de backend în etapele următoare.
 */

class NotFoundError extends CourierError {
  constructor() {
    super("pickup_address_not_found", "Adresa de ridicare nu a fost găsită.", { httpStatus: 404 });
  }
}

const FIELDS = {
  contactName: { label: "Persoană de contact", max: 160, required: true },
  phone: { label: "Telefon", max: 40, required: true },
  email: { label: "Email", max: 320, required: false },
  county: { label: "Județ", max: 120, required: true },
  city: { label: "Localitate", max: 160, required: true },
  postalCode: { label: "Cod poștal", max: 20, required: false },
  street: { label: "Stradă", max: 255, required: true },
  streetNo: { label: "Număr", max: 40, required: true },
  details: { label: "Detalii", max: 500, required: false },
};

const PUBLIC_SELECT = {
  id: true,
  serviceId: true,
  contactName: true,
  phone: true,
  email: true,
  county: true,
  city: true,
  postalCode: true,
  street: true,
  streetNo: true,
  details: true,
  isDefault: true,
  createdAt: true,
  updatedAt: true,
};

function clean(value) {
  return value == null ? "" : String(value).replace(/\s+/g, " ").trim();
}

/**
 * @param {Object} body
 * @param {{partial:boolean}} opts - partial=true la PATCH (doar câmpurile trimise)
 */
function sanitizeAddress(body = {}, { partial = false } = {}) {
  const data = {};
  const invalid = [];

  for (const [key, rule] of Object.entries(FIELDS)) {
    if (partial && body[key] === undefined) continue;

    const value = clean(body[key]);
    if (!value) {
      if (rule.required) invalid.push(key);
      else data[key] = null;
      continue;
    }
    if (value.length > rule.max) {
      invalid.push(key);
      continue;
    }
    data[key] = value;
  }

  if (data.phone) {
    const digits = data.phone.replace(/[^\d+]/g, "");
    if (!/^\+?\d{9,15}$/.test(digits)) invalid.push("phone");
    else data.phone = digits;
  }
  if (data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) invalid.push("email");
  if (data.postalCode && !/^\d{4,10}$/.test(data.postalCode)) invalid.push("postalCode");

  if (invalid.length) {
    throw new CourierValidationError(
      "Adresa de ridicare nu este completă sau conține date invalide.",
      [...new Set(invalid)]
    );
  }

  return data;
}

async function lockVendorScope(tx, vendorId) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`pickup-default:${vendorId}`}))`;
}

async function assertOwnedService(db, vendorId, serviceId) {
  if (serviceId == null || serviceId === "") return null;
  const service = await db.vendorService.findFirst({
    where: { id: String(serviceId), vendorId },
    select: { id: true },
  });
  if (!service) throw new CourierValidationError("Magazinul selectat nu este valid.", ["serviceId"]);
  return service.id;
}

async function findOwned(db, vendorId, id) {
  const addr = await db.vendorPickupAddress.findFirst({
    where: { id: String(id || ""), vendorId },
    select: PUBLIC_SELECT,
  });
  if (!addr) throw new NotFoundError();
  return addr;
}

export async function listPickupAddresses(vendorId, db = defaultDb) {
  return db.vendorPickupAddress.findMany({
    where: { vendorId },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    select: PUBLIC_SELECT,
  });
}

export async function createPickupAddress(vendorId, body = {}, db = defaultDb) {
  const data = sanitizeAddress(body);
  const serviceId = await assertOwnedService(db, vendorId, body.serviceId);

  return db.$transaction(async (tx) => {
    await lockVendorScope(tx, vendorId);

    const count = await tx.vendorPickupAddress.count({ where: { vendorId } });
    const makeDefault = count === 0 || body.isDefault === true;

    if (makeDefault) {
      await tx.vendorPickupAddress.updateMany({
        where: { vendorId, isDefault: true },
        data: { isDefault: false },
      });
    }

    return tx.vendorPickupAddress.create({
      data: { ...data, vendorId, serviceId, isDefault: makeDefault },
      select: PUBLIC_SELECT,
    });
  });
}

export async function updatePickupAddress(vendorId, id, body = {}, db = defaultDb) {
  const existing = await findOwned(db, vendorId, id);
  const data = sanitizeAddress(body, { partial: true });

  if (body.serviceId !== undefined) {
    data.serviceId = await assertOwnedService(db, vendorId, body.serviceId);
  }

  if (!Object.keys(data).length) return existing;

  return db.vendorPickupAddress.update({
    where: { id: existing.id },
    data,
    select: PUBLIC_SELECT,
  });
}

// conturile de curier care o foloseau rămân cu pickupAddressId = null (onDelete: SetNull)
export async function deletePickupAddress(vendorId, id, db = defaultDb) {
  const existing = await findOwned(db, vendorId, id);
  const wasDefault = !!existing.isDefault;

  await db.$transaction(async (tx) => {
    await lockVendorScope(tx, vendorId);
    await tx.vendorPickupAddress.delete({ where: { id: existing.id } });

    if (wasDefault) {
      const next = await tx.vendorPickupAddress.findFirst({
        where: { vendorId },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });
      if (next) {
        await tx.vendorPickupAddress.update({ where: { id: next.id }, data: { isDefault: true } });
      }
    }
  });

  return { ok: true };
}

export async function setDefaultPickupAddress(vendorId, id, db = defaultDb) {
  const existing = await findOwned(db, vendorId, id);

  return db.$transaction(async (tx) => {
    await lockVendorScope(tx, vendorId);
    await tx.vendorPickupAddress.updateMany({
      where: { vendorId, isDefault: true, NOT: { id: existing.id } },
      data: { isDefault: false },
    });
    return tx.vendorPickupAddress.update({
      where: { id: existing.id },
      data: { isDefault: true },
      select: PUBLIC_SELECT,
    });
  });
}
