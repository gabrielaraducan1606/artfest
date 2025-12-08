// src/routes/admin/userConsentsRoutes.js
import { Router } from "express";
import { prisma } from "../db.js";
import { authRequired, enforceTokenVersion } from "../api/auth.js";

const router = Router();

/**
 * GET /api/admin/user-consents
 *
 * Returnează, per user:
 * - dacă are UserConsent pentru TOS
 * - dacă are UserConsent pentru PRIVACY_ACK
 * - dacă are MARKETING_EMAIL_OPTIN
 *
 * ⚠️ Protejat: doar ADMIN.
 */
router.get("/user-consents", authRequired, enforceTokenVersion, async (req, res) => {
  try {
    // aici presupun că în token ai role; dacă nu, adaptezi la middleware-ul tău
    if (req.user.role !== "ADMIN") {
      return res.status(403).json({ error: "forbidden" });
    }

    const users = await prisma.user.findMany({
      select: {
        id: true,
        email: true,
        createdAt: true,
        UserConsent: {
          select: {
            document: true, // TOS / PRIVACY_ACK / MARKETING_EMAIL_OPTIN
            version: true,
            givenAt: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 500, // poți crește / pagina dacă vrei
    });

    const rows = users.map((u) => {
      const tos = u.UserConsent
        .filter((c) => c.document === "TOS")
        .sort((a, b) => b.givenAt.getTime() - a.givenAt.getTime())[0] || null;

      const privacy = u.UserConsent
        .filter((c) => c.document === "PRIVACY_ACK")
        .sort((a, b) => b.givenAt.getTime() - a.givenAt.getTime())[0] || null;

      const marketing = u.UserConsent
        .filter((c) => c.document === "MARKETING_EMAIL_OPTIN")
        .sort((a, b) => b.givenAt.getTime() - a.givenAt.getTime())[0] || null;

      return {
        userId: u.id,
        email: u.email,
        createdAt: u.createdAt,

        tosAccepted: !!tos,
        tosVersion: tos?.version ?? null,
        tosGivenAt: tos?.givenAt ?? null,

        privacyAccepted: !!privacy,
        privacyVersion: privacy?.version ?? null,
        privacyGivenAt: privacy?.givenAt ?? null,

        marketingOptIn: !!marketing,
        marketingVersion: marketing?.version ?? null,
        marketingGivenAt: marketing?.givenAt ?? null,
      };
    });

    return res.json({ consents: rows });
  } catch (e) {
    console.error("admin user-consents error:", e);
    return res.status(500).json({ error: "internal_error" });
  }
});

export default router;
