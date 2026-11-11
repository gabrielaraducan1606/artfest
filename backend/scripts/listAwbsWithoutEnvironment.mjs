// backend/scripts/listAwbsWithoutEnvironment.mjs
//
// STRICT READ-ONLY: listează AWB-urile Sameday (CourierAwb) fără mediu salvat
// (providerMeta.environment lipsă) - create înainte de separarea DEMO /
// production. Aceste AWB-uri sunt BLOCATE la reverificare, etichetă și
// anulare (awb_environment_unknown) și ignorate de status-sync; NU sunt
// presupuse production. Scriptul nu scrie nimic și nu contactează Sameday.
//
// Rulare (din backend/), după aprobare, doar cu hostul bazei confirmat:
//   node --env-file=.env scripts/listAwbsWithoutEnvironment.mjs --confirm-host <host>
//
// Ieșire: pentru fiecare AWB - id, status, are/nu număr AWB, data, contul și
// mediul DECLARAT acum pe cont (doar informativ: contul poate fi fost mutat
// între medii; decizia rămâne manuală, după verificarea în contul Sameday).
// Fără date personale (nume, adrese, telefoane).

import { prisma } from "../src/db.js";

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const host = (() => {
  try {
    return new URL(process.env.DATABASE_URL).hostname;
  } catch {
    return null;
  }
})();

try {
  if (!host || arg("confirm-host") !== host) {
    throw new Error(`--confirm-host trebuie să fie exact hostul bazei (${host || "necunoscut"}). Nimic nu a fost citit.`);
  }
  // doar SELECT, într-o tranzacție READ ONLY (Postgres refuză orice scriere)
  const rows = await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
    return tx.$queryRaw`
      SELECT a.id, a.status::text AS status, (a."awbNumber" IS NOT NULL) AS "hasAwbNumber",
             a."createdAt", a."courierAccountId",
             (c."publicConfig"->>'environment') AS "accountEnvironment",
             c."ownerType"::text AS "ownerType", (c."disabledAt" IS NOT NULL) AS "accountDisabled",
             s.direction::text AS direction
        FROM "CourierAwb" a
        LEFT JOIN "CourierAccount" c ON c.id = a."courierAccountId"
        LEFT JOIN "Shipment" s ON s.id = a."shipmentId"
       WHERE a.provider = 'SAMEDAY'
         AND COALESCE(a."providerMeta"->>'environment', '') NOT IN ('demo', 'production')
       ORDER BY a."createdAt" ASC`;
  });

  const byStatus = {};
  for (const r of rows) byStatus[r.status] = (byStatus[r.status] || 0) + 1;
  console.log("Baza de date:", host);
  console.log("AWB-uri Sameday fără mediu:", rows.length, JSON.stringify(byStatus));
  for (const r of rows) {
    console.log(
      JSON.stringify({
        id: r.id,
        status: r.status,
        direction: r.direction,
        hasAwbNumber: r.hasAwbNumber,
        createdAt: r.createdAt,
        courierAccountId: r.courierAccountId,
        ownerType: r.ownerType,
        accountEnvironmentNow: r.accountEnvironment || null,
        accountDisabled: r.accountDisabled,
      })
    );
  }
  console.log("Nimic nu a fost modificat. Active (CREATED / UNKNOWN / REQUESTED) = de verificat manual în contul Sameday.");
} catch (error) {
  console.error("Oprit:", error?.message || error?.code || "eroare");
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
