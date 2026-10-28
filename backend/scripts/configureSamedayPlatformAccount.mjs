// backend/scripts/configureSamedayPlatformAccount.mjs
//
// Configurează contul Sameday al ARTFEST (CourierAccount ownerType PLATFORM)
// folosit la „Generează AWB”. Credentialele API se criptează (COURIER_CREDENTIALS_KEY)
// și nu se afișează niciodată.
//
// Variabile (doar pentru rularea scriptului):
//   SAMEDAY_API_USERNAME / SAMEDAY_API_PASSWORD - credentialele API (POST /api/authenticate),
//       NU cele ale portalului / Swagger (SAMEDAY_USERNAME / SAMEDAY_PASSWORD nu sunt folosite)
//   SAMEDAY_API_ENVIRONMENT   production (implicit) | demo
//   SAMEDAY_PICKUP_POINT_ID   punctul de ridicare CONTRACTUAL Artfest (obligatoriu la --apply)
//   SAMEDAY_CONTACT_PERSON_ID opțional (persoana de contact a punctului)
//   SAMEDAY_SERVICE_ID        opțional (implicit: 24H, ID 7 în documentația v3.6)
//
// Implicit: doar afișează ce s-ar scrie (fără apeluri externe, fără scriere).
//   node --env-file=.env scripts/configureSamedayPlatformAccount.mjs
// --check: autentificare REALĂ + lista punctelor de ridicare / serviciilor active
//   (ID-urile de pus în SAMEDAY_PICKUP_POINT_ID / SAMEDAY_SERVICE_ID). Nu scrie nimic.
// --apply --confirm-host <host>: scrie contul PLATFORM în baza de date.

import { prisma } from "../src/db.js";
import { getCourierProvider } from "../src/couriers/registry.js";
import { isEncryptionConfigured } from "../src/couriers/credentials/crypto.js";
import { maskIdentifier, newCourierAccountId, sealCredentials } from "../src/couriers/credentials/store.js";

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const env = (key) => String(process.env[key] ?? "").trim();
const apply = process.argv.includes("--apply");
const check = process.argv.includes("--check");
const confirmHost = arg("confirm-host");
const host = (() => {
  try {
    return new URL(process.env.DATABASE_URL).hostname;
  } catch {
    return null;
  }
})();

const credentials = { username: env("SAMEDAY_API_USERNAME"), password: env("SAMEDAY_API_PASSWORD") };
const environment = env("SAMEDAY_API_ENVIRONMENT") || "production";
const publicConfig = {
  environment,
  pickupPointId: env("SAMEDAY_PICKUP_POINT_ID") || null,
  contactPersonId: env("SAMEDAY_CONTACT_PERSON_ID") || null,
  serviceId: env("SAMEDAY_SERVICE_ID") || null,
};

try {
  if (!credentials.username || !credentials.password) {
    throw new Error("Lipsesc SAMEDAY_API_USERNAME / SAMEDAY_API_PASSWORD (credentialele API, nu cele ale portalului).");
  }
  if (!["production", "demo"].includes(environment)) {
    throw new Error("SAMEDAY_API_ENVIRONMENT trebuie să fie production sau demo.");
  }

  const def = getCourierProvider("SAMEDAY");
  console.log("Baza de date:", host || "(necunoscută)");
  console.log("Utilizator API:", maskIdentifier(credentials.username), "| parolă:", `${credentials.password.length} caractere`);
  console.log("Configurație:", JSON.stringify(publicConfig));

  if (check) {
    const ctx = { accountId: null, credentials, publicConfig };
    const { details } = await def.testConnection(ctx);
    const services = await def.listServices(ctx);
    console.log("Autentificare OK.");
    console.log("Puncte de ridicare:", JSON.stringify(details.pickupPoints.map((p) => ({ id: p.id, alias: p.alias, county: p.county, city: p.city, isDefault: p.isDefault, contactPersonIds: p.contactPersonIds }))));
    console.log("Servicii active:", JSON.stringify(services));
  }

  if (!apply) {
    console.log("Nimic nu a fost scris (adaugă --apply --confirm-host <host>).");
  } else {
    if (!host || confirmHost !== host) {
      throw new Error(`--confirm-host trebuie să fie exact hostul bazei (${host}). Nimic nu a fost scris.`);
    }
    if (!publicConfig.pickupPointId) {
      throw new Error("Lipsește SAMEDAY_PICKUP_POINT_ID (punctul de ridicare contractual). Nimic nu a fost scris.");
    }
    if (!isEncryptionConfigured()) {
      throw new Error("COURIER_CREDENTIALS_KEY nu este configurată. Nimic nu a fost scris.");
    }

    const existing = await prisma.courierAccount.findFirst({
      where: { ownerType: "PLATFORM", vendorId: null, provider: "SAMEDAY", disabledAt: null },
      orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    });
    const id = existing?.id || newCourierAccountId();
    const sealed = sealCredentials({ accountId: id, vendorId: null, provider: "SAMEDAY", credentials });
    const data = {
      ...sealed,
      credentialsHint: def.credentialsHint(credentials),
      publicConfig,
      status: "ACTIVE",
      lastError: null,
    };

    if (existing) {
      await prisma.courierAccount.update({ where: { id }, data });
      console.log("Actualizat contul PLATFORM:", id);
    } else {
      await prisma.courierAccount.create({
        data: { id, ownerType: "PLATFORM", vendorId: null, provider: "SAMEDAY", label: "Sameday - contract Artfest", isDefault: true, ...data },
      });
      console.log("Creat contul PLATFORM:", id);
    }
  }
} catch (error) {
  console.error("Oprit:", error?.message || error?.code || "eroare");
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
