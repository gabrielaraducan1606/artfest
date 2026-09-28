// backend/src/scripts/auditContactInfo.js
//
// Audit conținut EXISTENT (descrieri magazine + texte produse) pentru date
// de contact externe - vezi services/contactInfoAudit.js.
//
//   node src/scripts/auditContactInfo.js          -> DOAR raport (dry-run)
//   node src/scripts/auditContactInfo.js --apply  -> + o notificare
//                                                    agregată per vendor
//
// Nu șterge și nu modifică niciun produs / profil. Rularea repetată nu
// dublează notificările pentru același set de probleme (dedupeKey).

import { prisma } from "../db.js";
import { auditContactInfo } from "../services/contactInfoAudit.js";

const apply = process.argv.includes("--apply");

try {
  const result = await auditContactInfo({ apply });

  console.log(
    JSON.stringify(
      {
        mode: apply ? "APPLY (notificări create)" : "DRY-RUN (nicio notificare)",
        vendors: result.vendors,
        affectedEntities: result.affectedEntities,
        notificationsCreated: result.notificationsCreated,
        report: result.report,
      },
      null,
      2
    )
  );
} catch (error) {
  console.error("[auditContactInfo] eșuat:", error);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
