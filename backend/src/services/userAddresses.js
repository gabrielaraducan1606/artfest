// backend/src/services/userAddresses.js
//
// Agenda de adrese a clientului (model UserAddress) - checkout autentificat.
//
// Reguli:
//  - fiecare operație e limitată la userId-ul din sesiune (adresa altui user
//    = 404, nu 403 - nu confirmăm existența ei);
//  - cel mult o adresă implicită per user (index unic parțial în DB +
//    tranzacție aici); prima adresă devine automat implicită;
//  - la ștergerea adresei implicite, implicită devine cea mai VECHE adresă
//    rămasă (createdAt, apoi id) - determinist;
//  - ID-urile Sameday de județ / localitate se salvează DOAR după validare în
//    nomenclatorul Sameday (catalog.findCounty / findCity); fără catalog
//    disponibil nu se păstrează ID-uri nevalidate.

import { prisma as defaultDb } from "../db.js";
import { normalizeRoPhone, isValidRoPhone } from "../lib/phoneRo.js";
import { resolveSamedayPlace, SamedayPlaceError } from "./shipping/samedayPlace.js";

export const MAX_ADDRESSES_PER_USER = 20;
export const ADDRESS_LABELS = Object.freeze(["HOME", "WORK", "OTHER"]);

export class UserAddressError extends Error {
  constructor(code, message, { status = 400, fields = null } = {}) {
    super(message);
    this.name = "UserAddressError";
    this.code = code;
    this.status = status;
    this.fields = fields;
  }
}

const clean = (value, max) => {
  const s = String(value ?? "").replace(/\s+/g, " ").trim();
  return s ? s.slice(0, max) : "";
};

const toPositiveInt = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : NaN;
};

/**
 * Validează și normalizează datele trimise de client (fără ID-uri Sameday -
 * acelea se tratează separat, în revalidateSamedayPlace).
 * @returns {{ data: Object, samedayCountyId: number|null, samedayCityId: number|null }}
 */
export function normalizeAddressInput(raw = {}) {
  const fields = {};
  const label = ADDRESS_LABELS.includes(raw.label) ? raw.label : "HOME";
  const firstName = clean(raw.firstName, 80);
  const lastName = clean(raw.lastName, 80);
  const phone = normalizeRoPhone(raw.phone || "");
  const county = clean(raw.county, 120);
  const city = clean(raw.city, 160);
  const street = clean(raw.street, 500);
  const postalCode = clean(raw.postalCode, 16);
  const notes = clean(raw.notes, 500);

  if (!firstName) fields.firstName = "Completează prenumele.";
  if (!lastName) fields.lastName = "Completează numele.";
  if (!isValidRoPhone(phone)) fields.phone = "Telefonul nu este valid.";
  if (!county) fields.county = "Alege județul.";
  if (!city) fields.city = "Completează localitatea.";
  if (!street) fields.street = "Completează strada și numărul.";
  if (postalCode && !/^\d{6}$/.test(postalCode)) fields.postalCode = "Codul poștal trebuie să aibă exact 6 cifre.";

  const samedayCountyId = toPositiveInt(raw.samedayCountyId);
  const samedayCityId = toPositiveInt(raw.samedayCityId);
  if (Number.isNaN(samedayCountyId) || Number.isNaN(samedayCityId)) fields.city = "Alege din nou localitatea din listă.";

  if (Object.keys(fields).length) {
    throw new UserAddressError("address_invalid", "Verifică datele adresei.", { fields });
  }

  return {
    data: { label, firstName, lastName, phone, county, city, street, postalCode: postalCode || null, notes: notes || null },
    samedayCountyId: samedayCountyId ?? null,
    samedayCityId: samedayCityId ?? null,
  };
}

/**
 * Revalidează județul / localitatea în nomenclatorul Sameday (samedayPlace.js):
 *  - ID-uri trimise -> verificate (inclusiv localitate din alt județ);
 *  - fără ID-uri -> potrivire exactă și unică după nume, dacă se poate;
 *  - nomenclator indisponibil -> ID-urile NU se păstrează (adresă nevalidată,
 *    se revalidează la plasarea comenzii);
 *  - loc inexistent / ambiguu -> eroare (clientul alege din listă);
 *  - valid -> ID-urile + denumirea oficială a localității.
 */
export async function revalidateSamedayPlace({ county, city, samedayCountyId, samedayCityId, catalog, now = new Date() }) {
  const none = { samedayCountyId: null, samedayCityId: null, samedayValidatedAt: null, cityName: null };
  if (samedayCountyId == null && samedayCityId == null && !catalog) return none;
  try {
    const place = await resolveSamedayPlace({ county, city, countyId: samedayCountyId, cityId: samedayCityId, catalog });
    if (place.status !== "validated") return none;
    return { samedayCountyId: place.countyId, samedayCityId: place.cityId, samedayValidatedAt: now, cityName: place.cityName || null };
  } catch (error) {
    if (error instanceof SamedayPlaceError) {
      const field = error.field === "county" ? "county" : "city";
      throw new UserAddressError("shipping_place_invalid", error.message, { fields: { [field]: error.message } });
    }
    throw error;
  }
}

/** Forma publică (fără userId). */
export function publicAddress(row) {
  if (!row) return null;
  return {
    id: row.id,
    label: row.label,
    firstName: row.firstName,
    lastName: row.lastName,
    phone: row.phone,
    county: row.county,
    city: row.city,
    street: row.street,
    postalCode: row.postalCode,
    notes: row.notes,
    samedayCountyId: row.samedayCountyId,
    samedayCityId: row.samedayCityId,
    samedayValidated: Boolean(row.samedayValidatedAt),
    isDefault: Boolean(row.isDefault),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

const ORDER = [{ isDefault: "desc" }, { createdAt: "asc" }, { id: "asc" }];

const isUniqueViolation = (e) => e?.code === "P2002";

export function createUserAddressService({ db = defaultDb, catalog = null, now = () => new Date() } = {}) {
  async function list(userId) {
    const rows = await db.userAddress.findMany({ where: { userId }, orderBy: ORDER });
    return rows.map(publicAddress);
  }

  async function findOwned(tx, userId, id) {
    const row = await tx.userAddress.findFirst({ where: { id: String(id || ""), userId } });
    if (!row) throw new UserAddressError("address_not_found", "Adresa nu a fost găsită.", { status: 404 });
    return row;
  }

  async function placeFields(input) {
    const place = await revalidateSamedayPlace({
      county: input.data.county,
      city: input.data.city,
      samedayCountyId: input.samedayCountyId,
      samedayCityId: input.samedayCityId,
      catalog,
      now: now(),
    });
    return {
      ...input.data,
      // localitatea validată în Sameday -> denumirea oficială (coerentă cu ID-ul)
      city: place.cityName || input.data.city,
      samedayCountyId: place.samedayCountyId,
      samedayCityId: place.samedayCityId,
      samedayValidatedAt: place.samedayValidatedAt,
    };
  }

  async function create(userId, raw) {
    const input = normalizeAddressInput(raw);
    const fields = await placeFields(input);
    try {
      const row = await db.$transaction(async (tx) => {
        const count = await tx.userAddress.count({ where: { userId } });
        if (count >= MAX_ADDRESSES_PER_USER) {
          throw new UserAddressError("address_limit_reached", `Poți salva cel mult ${MAX_ADDRESSES_PER_USER} adrese.`, { status: 409 });
        }
        const makeDefault = count === 0 || raw?.isDefault === true;
        if (makeDefault) await tx.userAddress.updateMany({ where: { userId, isDefault: true }, data: { isDefault: false } });
        return tx.userAddress.create({ data: { ...fields, userId, isDefault: makeDefault } });
      });
      return publicAddress(row);
    } catch (e) {
      if (isUniqueViolation(e)) throw new UserAddressError("address_conflict", "Adresele au fost modificate între timp. Reîncearcă.", { status: 409 });
      throw e;
    }
  }

  async function update(userId, id, raw) {
    const input = normalizeAddressInput(raw);
    const fields = await placeFields(input);
    try {
      const row = await db.$transaction(async (tx) => {
        const current = await findOwned(tx, userId, id);
        if (raw?.isDefault === true && !current.isDefault) {
          await tx.userAddress.updateMany({ where: { userId, isDefault: true }, data: { isDefault: false } });
          return tx.userAddress.update({ where: { id: current.id }, data: { ...fields, isDefault: true } });
        }
        return tx.userAddress.update({ where: { id: current.id }, data: fields });
      });
      return publicAddress(row);
    } catch (e) {
      if (isUniqueViolation(e)) throw new UserAddressError("address_conflict", "Adresele au fost modificate între timp. Reîncearcă.", { status: 409 });
      throw e;
    }
  }

  async function setDefault(userId, id) {
    try {
      const row = await db.$transaction(async (tx) => {
        const current = await findOwned(tx, userId, id);
        if (current.isDefault) return current;
        await tx.userAddress.updateMany({ where: { userId, isDefault: true }, data: { isDefault: false } });
        return tx.userAddress.update({ where: { id: current.id }, data: { isDefault: true } });
      });
      return publicAddress(row);
    } catch (e) {
      if (isUniqueViolation(e)) throw new UserAddressError("address_conflict", "Adresele au fost modificate între timp. Reîncearcă.", { status: 409 });
      throw e;
    }
  }

  /** Șterge; dacă era implicită, cea mai veche adresă rămasă devine implicită. */
  async function remove(userId, id) {
    return db.$transaction(async (tx) => {
      const current = await findOwned(tx, userId, id);
      await tx.userAddress.delete({ where: { id: current.id } });
      let newDefaultId = null;
      if (current.isDefault) {
        const next = await tx.userAddress.findFirst({ where: { userId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
        if (next) {
          await tx.userAddress.update({ where: { id: next.id }, data: { isDefault: true } });
          newDefaultId = next.id;
        }
      }
      return { deletedId: current.id, newDefaultId };
    });
  }

  return { list, create, update, setDefault, remove };
}
