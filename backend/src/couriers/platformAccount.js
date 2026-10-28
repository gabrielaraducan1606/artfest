// backend/src/couriers/platformAccount.js

import { getCourierProvider } from "./registry.js";

/*
 * Curierat CENTRALIZAT: contractul de curier aparține Artfest -
 * CourierAccount { ownerType: PLATFORM, vendorId: null }. Vendorii NU își
 * conectează conturi; vendorul e verificat doar ca proprietar al
 * Shipment-ului (awbService.loadShipment), iar coletul e ridicat de la
 * adresa lui de ridicare (Sameday: thirdPartyPickup = 1).
 *
 * Configurația contului (publicConfig, nimic secret):
 *   environment      "production" | "demo"
 *   pickupPointId    punctul de ridicare CONTRACTUAL Sameday al Artfest
 *                    (obligatoriu la POST /api/awb, chiar și cu thirdPartyPickup);
 *                    NU se deduce și NU e adresa vendorului
 *   contactPersonId  opțional (altfel Sameday folosește persoana implicită)
 *   serviceId        opțional - serviciul de livrare la adresă; dacă lipsește,
 *                    serviciul 24H (ID 7 în doc v3.6) dintre serviciile ACTIVE
 * Credentialele API (nu cele ale portalului / Swagger) stau criptate în
 * credentialsCipher - vezi scripts/configureSamedayPlatformAccount.js.
 */

export const COURIER_SETUP_PENDING_MESSAGE =
  "Integrarea cu serviciul de curierat este în curs de configurare.";

export const PLATFORM_SETUP_MESSAGES = Object.freeze({
  platform_account_missing:
    "Contul Sameday al Artfest nu este configurat încă (lipsesc datele de acces API). AWB-ul nu poate fi generat momentan.",
  platform_credentials_invalid:
    "Autentificarea la Sameday cu contul Artfest a eșuat. Echipa Artfest trebuie să actualizeze datele de acces.",
  platform_pickup_point_missing:
    "Punctul de ridicare contractual Sameday al Artfest nu este configurat. AWB-ul nu poate fi generat momentan.",
  platform_pickup_point_invalid:
    "Punctul de ridicare Sameday configurat pentru Artfest nu există în contul Sameday. Echipa Artfest trebuie să îl corecteze.",
  platform_contact_person_invalid:
    "Persoana de contact Sameday configurată pentru Artfest nu aparține punctului de ridicare. Echipa Artfest trebuie să o corecteze.",
});

// toate înseamnă „configurare Artfest în curs” pentru vendor (nu le poate rezolva el)
export const PLATFORM_SETUP_CODES = Object.freeze(["courier_setup_pending", ...Object.keys(PLATFORM_SETUP_MESSAGES)]);

function configValue(publicConfig, key) {
  const raw = publicConfig && typeof publicConfig === "object" ? publicConfig[key] : null;
  const value = raw == null ? "" : String(raw).trim();
  return value || null;
}

export function platformConfig(account) {
  const cfg = account?.publicConfig || {};
  return {
    environment: configValue(cfg, "environment") || "production",
    pickupPointId: configValue(cfg, "pickupPointId"),
    contactPersonId: configValue(cfg, "contactPersonId"),
    serviceId: configValue(cfg, "serviceId"),
  };
}

/**
 * Problema de configurare a contului Artfest, înainte de orice apel extern.
 * @returns {{code:string, message:string}|null}
 */
export function platformSetupIssue(account) {
  const issue = (code) => ({ code, message: PLATFORM_SETUP_MESSAGES[code] });
  if (!account) return issue("platform_account_missing");
  if (account.status === "INVALID_CREDENTIALS") return issue("platform_credentials_invalid");
  if (account.status !== "ACTIVE") return issue("platform_account_missing");
  if (!platformConfig(account).pickupPointId) return issue("platform_pickup_point_missing");
  return null;
}

/**
 * Contul Artfest folosit pentru AWB: ownerType PLATFORM, nedezactivat, cu un
 * provider care poate crea AWB-uri. Preferă contul implicit ACTIVE.
 * @returns {Promise<Object|null>}
 */
export async function findPlatformCourierAccount(db) {
  const rows = await db.courierAccount.findMany({
    where: { ownerType: "PLATFORM", vendorId: null, disabledAt: null },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
  });

  const capable = rows.filter((a) => {
    try {
      return !!getCourierProvider(a.provider).capabilities?.createShipment;
    } catch {
      return false;
    }
  });

  return (
    capable.find((a) => a.isDefault && a.status === "ACTIVE") ||
    capable.find((a) => a.status === "ACTIVE") ||
    capable[0] ||
    null
  );
}
