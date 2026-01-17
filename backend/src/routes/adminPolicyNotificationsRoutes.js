import { Router } from "express";
import { prisma } from "../db.js";
import { authRequired, enforceTokenVersion } from "../api/auth.js";

const router = Router();

const CONSENT_MAP = {
  TOS: "TOS",
  PRIVACY: "PRIVACY_ACK",
  MARKETING: "MARKETING_EMAIL_OPTIN",
};

const VENDOR_SPECIAL = {
  PRODUCT_DECLARATION: true,
};

function uniq(arr) {
  return Array.from(new Set(arr));
}

async function getLatestVendorPoliciesByDocs(docs) {
  // docs: array of VendorDoc keys (no PRODUCT_DECLARATION)
  const active = await prisma.vendorPolicy.findMany({
    where: { isActive: true, document: { in: docs } },
    orderBy: [{ document: "asc" }, { publishedAt: "desc" }],
  });
  const latest = new Map();
  for (const p of active) if (!latest.has(p.document)) latest.set(p.document, p);
  return latest; // Map<VendorDoc, VendorPolicy>
}

async function getLatestUserPoliciesByDocs(consentDocs) {
  // requires UserPolicy table
  const active = await prisma.userPolicy.findMany({
    where: { isActive: true, document: { in: consentDocs } },
    orderBy: [{ document: "asc" }, { publishedAt: "desc" }],
  });
  const latest = new Map();
  for (const p of active) if (!latest.has(p.document)) latest.set(p.document, p);
  return latest; // Map<ConsentDoc, UserPolicy>
}

async function findOutdatedVendors(selectedDocs) {
  const normalDocs = selectedDocs.filter((d) => !VENDOR_SPECIAL[d]);
  const latestByDoc = await getLatestVendorPoliciesByDocs(normalDocs);

  // luăm vendorii + acceptări + declarație
  const vendors = await prisma.vendor.findMany({
    select: {
      id: true,
      email: true,
      VendorAcceptance: { select: { document: true, version: true, acceptedAt: true } },
      productDeclaration: { select: { version: true, acceptedAt: true } },
    },
    take: 20000, // ajustează după volum
  });

  const targets = [];
  for (const v of vendors) {
    const acceptedSet = new Set(
      v.VendorAcceptance.map((a) => `${a.document}::${a.version}`)
    );

    let needs = false;

    // docs din VendorPolicy
    for (const [doc, pol] of latestByDoc.entries()) {
      if (!pol) continue;
      const ok = acceptedSet.has(`${doc}::${pol.version}`);
      if (!ok && pol.isRequired) {
        needs = true;
        break;
      }
    }

    // pseudo-doc: PRODUCT_DECLARATION
    if (!needs && selectedDocs.includes("PRODUCT_DECLARATION")) {
      // aici poți decide: target doar dacă NU există
      if (!v.productDeclaration) needs = true;
    }

    if (needs) targets.push({ id: v.id, email: v.email || null });
  }

  // versions snapshot (pt meta)
  const versions = {};
  for (const [doc, pol] of latestByDoc.entries()) versions[doc] = pol?.version ?? null;
  if (selectedDocs.includes("PRODUCT_DECLARATION")) versions["PRODUCT_DECLARATION"] = "1.0.0"; // sau altă logică

  return { targets, versions };
}

async function findOutdatedUsers(selectedDocs) {
  const consentDocs = selectedDocs
    .map((k) => CONSENT_MAP[k])
    .filter(Boolean);

  const latestByDoc = await getLatestUserPoliciesByDocs(consentDocs);

  const users = await prisma.user.findMany({
    select: {
      id: true,
      email: true,
      UserConsent: { select: { document: true, version: true, givenAt: true } },
    },
    take: 50000,
  });

  const targets = [];
  for (const u of users) {
    const acceptedSet = new Set(
      u.UserConsent.map((c) => `${c.document}::${c.version}`)
    );

    let needs = false;
    for (const [doc, pol] of latestByDoc.entries()) {
      if (!pol) continue;
      const ok = acceptedSet.has(`${doc}::${pol.version}`);
      if (!ok && pol.isRequired) {
        needs = true;
        break;
      }
    }
    if (needs) targets.push({ id: u.id, email: u.email || null });
  }

  const versions = {};
  for (const [doc, pol] of latestByDoc.entries()) versions[doc] = pol?.version ?? null;

  // pt UI, păstrezi și cheile originale în meta dacă vrei
  return { targets, versions };
}

/**
 * POST /api/admin/policy-notifications/send
 */
router.post(
  "/policy-notifications/send",
  authRequired,
  enforceTokenVersion,
  async (req, res) => {
    try {
      if (req.user.role !== "ADMIN") {
        return res.status(403).json({ error: "forbidden" });
      }

      const { scope, documents, requiresAction, inApp, email } = req.body || {};

      const selectedDocs = uniq(Array.isArray(documents) ? documents : []).slice(0, 10);

      if (!["USERS", "VENDORS"].includes(scope)) {
        return res.status(400).json({ error: "invalid_scope" });
      }
      if (!selectedDocs.length) {
        return res.status(400).json({ error: "no_documents" });
      }
      if (!inApp?.title?.trim() || !inApp?.message?.trim()) {
        return res.status(400).json({ error: "invalid_inapp" });
      }
      if (email && (!email.subject?.trim() || !email.body?.trim())) {
        return res.status(400).json({ error: "invalid_email" });
      }

      // 1) targets
      const { targets, versions } =
        scope === "VENDORS"
          ? await findOutdatedVendors(selectedDocs)
          : await findOutdatedUsers(selectedDocs);

      if (!targets.length) {
        return res.json({ targetCount: 0, createdCount: 0, emailQueued: 0, emailFailed: 0 });
      }

      const campaignId = `pol_${Date.now()}`; // suficient; poți folosi cuid/uuid dacă vrei

      // 2) in-app notifications (bulk)
      // Idempotency light: evităm duplicarea aceleiași campanii pt același target:
      // - căutăm existing by meta.campaignId (nu poți filtra JSON ușor în Prisma fără raw).
      // Recomandare: acceptăm că admin nu apasă de 2 ori;
      // dacă vrei strict, îți arăt cum facem tabel separat cu unique.

      const notifRows = targets.map((t) => ({
        title: String(inApp.title),
        body: String(inApp.message),
        type: "system",
        userId: scope === "USERS" ? t.id : null,
        vendorId: scope === "VENDORS" ? t.id : null,
        meta: {
          kind: "POLICY_UPDATE",
          scope,
          campaignId,
          documents: selectedDocs,
          requiresAction: !!requiresAction,
          versions,
        },
      }));

      // prisma.notification.createMany nu suportă JSON? suportă (Postgres) -> da, ca meta Json.
      const created = await prisma.notification.createMany({
        data: notifRows,
      });

      // 3) email queue (EmailLog)
      let emailQueued = 0;
      let emailFailed = 0;

      if (email) {
        const emailJobs = targets
          .filter((t) => t.email)
          .map((t) => ({
            userId: scope === "USERS" ? t.id : null,
            toEmail: t.email,
            toName: null,
            senderKey: "admin",
            fromEmail: null,
            replyTo: null,
            template: "policy_update",
            subject: String(email.subject),
            status: "QUEUED",
            provider: null,
            messageId: null,
            error: null,
            createdAt: new Date(),
          }));

        if (emailJobs.length) {
          await prisma.emailLog.createMany({ data: emailJobs });
          emailQueued = emailJobs.length;
        }
      }

      return res.json({
        targetCount: targets.length,
        createdCount: created.count ?? created,
        emailQueued,
        emailFailed,
      });
    } catch (e) {
      console.error("admin policy-notifications/send error:", e);
      return res.status(500).json({ error: "internal_error" });
    }
  }
);

export default router;
