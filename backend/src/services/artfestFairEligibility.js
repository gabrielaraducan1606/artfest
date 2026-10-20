// backend/src/services/artfestFairEligibility.js
//
// Cine se poate înscrie la Târgul Artfest (și cine poate fi aprobat), după starea
// magazinului. Regulile (decizie 2026-10-20):
//   - magazin ACTIV (cel puțin un serviciu ACTIVE)                       => eligibil;
//   - magazin pus pe PAUZĂ de vânzător (servicii INACTIVE, vendorul activ) => eligibil,
//     dacă profilul e valid (nume, slug, logo - aceleași cerințe ca la activare);
//   - magazin NICIODATĂ ACTIVAT (fără serviciu ACTIVE / INACTIVE)          => trebuie activat întâi;
//   - magazin DEZACTIVAT ADMINISTRATIV (Vendor.isActive = false după activare),
//     cont suspendat / șters / blocat, colaborare încetată sau în preaviz   => neeligibil.
//
// Din codul existent: pauza = POST /api/vendors/me/services/:id/deactivate (serviciul
// devine INACTIVE, Vendor.isActive rămâne true); dezactivarea administrativă =
// POST /api/admin/vendors/:id/deactivate (Vendor.isActive = false); suspendarea =
// User.status SUSPENDED. Nu modifică nimic - doar citește.

import { prisma } from "../db.js";

const ACTIVATED_SERVICE_STATUSES = ["ACTIVE", "INACTIVE"];

export const FAIR_ELIGIBILITY_MESSAGES = Object.freeze({
  store_not_activated:
    "Înscrierea la târg este disponibilă doar pentru magazinele activate. Finalizează mai întâi activarea magazinului.",
  profile_incomplete:
    "Profilul magazinului este incomplet (nume, adresă web sau logo). Completează-l pentru a te putea înscrie la târg.",
  store_deactivated: "Magazinul tău nu este activ pe Artfest. Pentru detalii, contactează Asistența.",
  account_restricted: "Contul tău nu permite înscrierea la târg. Pentru detalii, contactează Asistența.",
  collaboration_ended: "Colaborarea cu Artfest este încetată sau în curs de încetare, așa că înscrierea la târg nu este disponibilă.",
  vendor_missing: "Profilul de vânzător nu a fost găsit.",
});

// mesajele pentru Admin (aprobare / avertizare în listă)
export const FAIR_ELIGIBILITY_ADMIN_LABELS = Object.freeze({
  store_not_activated: "Magazin neactivat",
  profile_incomplete: "Profil de magazin incomplet",
  store_deactivated: "Magazin dezactivat administrativ",
  account_restricted: "Cont suspendat, șters sau blocat",
  collaboration_ended: "Colaborare încetată sau în preaviz",
  vendor_missing: "Profil de vânzător inexistent",
});

const profileValid = (p) => Boolean(p?.displayName?.trim() && p?.slug?.trim() && p?.logoUrl?.trim());

/*
 * Evaluarea pură (testabilă): vendor { isActive, anonymizedAt, termination*, user },
 * services [{ status, profile }].
 */
export function evaluateFairEligibility(vendor, services = []) {
  const result = (eligible, reason, storeState) => ({
    eligible,
    reason,
    storeState,
    message: reason ? FAIR_ELIGIBILITY_MESSAGES[reason] : null,
    adminLabel: reason ? FAIR_ELIGIBILITY_ADMIN_LABELS[reason] : null,
  });

  if (!vendor) return result(false, "vendor_missing", null);
  if (vendor.anonymizedAt || vendor.terminationNoticeAt || vendor.terminationFinalizedAt) {
    return result(false, "collaboration_ended", null);
  }
  const user = vendor.user;
  if (!user || user.status !== "ACTIVE" || user.locked) return result(false, "account_restricted", null);

  const activated = services.filter((s) => ACTIVATED_SERVICE_STATUSES.includes(s.status));
  if (!activated.length) return result(false, "store_not_activated", "not_activated");
  if (!vendor.isActive) return result(false, "store_deactivated", "deactivated");

  const storeState = activated.some((s) => s.status === "ACTIVE") ? "active" : "paused";
  if (!activated.some((s) => profileValid(s.profile))) return result(false, "profile_incomplete", storeState);
  return result(true, null, storeState);
}

const VENDOR_SELECT = {
  id: true,
  isActive: true,
  anonymizedAt: true,
  terminationNoticeAt: true,
  terminationFinalizedAt: true,
  user: { select: { status: true, locked: true } },
};

const SERVICE_SELECT = {
  vendorId: true,
  status: true,
  profile: { select: { displayName: true, slug: true, logoUrl: true } },
};

export async function loadFairEligibility(vendorId, db = prisma) {
  const map = await loadFairEligibilityMap([vendorId], db);
  return map.get(vendorId) || evaluateFairEligibility(null);
}

// pentru listele din Admin: o singură interogare pe vendori + una pe servicii
export async function loadFairEligibilityMap(vendorIds, db = prisma) {
  const ids = [...new Set((vendorIds || []).filter(Boolean))];
  const map = new Map();
  if (!ids.length) return map;

  const [vendors, services] = await Promise.all([
    db.vendor.findMany({ where: { id: { in: ids } }, select: VENDOR_SELECT }),
    db.vendorService.findMany({ where: { vendorId: { in: ids } }, select: SERVICE_SELECT }),
  ]);
  const servicesByVendor = new Map();
  for (const s of services) {
    if (!servicesByVendor.has(s.vendorId)) servicesByVendor.set(s.vendorId, []);
    servicesByVendor.get(s.vendorId).push(s);
  }
  const vendorById = new Map(vendors.map((v) => [v.id, v]));
  for (const id of ids) map.set(id, evaluateFairEligibility(vendorById.get(id) || null, servicesByVendor.get(id) || []));
  return map;
}
