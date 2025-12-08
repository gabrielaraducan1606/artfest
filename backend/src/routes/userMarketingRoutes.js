// src/routes/userMarketingRoutes.js
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { authRequired } from "../api/auth.js";

const router = Router();

const SourcePrefEnum = z.enum([
  "NONE",
  "PLATFORM_ONLY",
  "FOLLOWED_VENDORS",
  "FOLLOWED_AND_PAST_PURCHASES",
  "ALL_VENDORS",
]);

const TopicEnum = z.enum([
  "RECOMMENDATIONS",
  "PROMOTIONS",
  "EVENTS",
  "REMINDERS",
  "FEEDBACK",
]);

const UpdatePrefsSchema = z.object({
  sourcePreference: SourcePrefEnum,
  topics: z.array(TopicEnum).max(10),
  emailEnabled: z.boolean().optional().default(true),
  smsEnabled: z.boolean().optional().default(false),
  pushEnabled: z.boolean().optional().default(false),
});

// helper: preferințe implicite dacă nu există în DB
function getDefaultPrefs() {
  return {
    sourcePreference: "PLATFORM_ONLY",
    topics: ["RECOMMENDATIONS", "PROMOTIONS"],
    emailEnabled: true,
    smsEnabled: false,
    pushEnabled: false,
  };
}

function getUserId(req) {
  // authRequired de obicei pune req.user.sub
  return req.user?.sub || req.user?.id;
}

/**
 * GET /api/me/marketing-preferences
 */
router.get("/me/marketing-preferences", authRequired, async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      return res.status(401).json({ error: "unauthorized" });
    }

    const prefs = await prisma.userMarketingPrefs.findUnique({
      where: { userId },
    });

    if (!prefs) {
      return res.json({
        ...getDefaultPrefs(),
        from: "default",
      });
    }

    return res.json({
      sourcePreference: prefs.sourcePreference,
      topics: prefs.topics,
      emailEnabled: prefs.emailEnabled,
      smsEnabled: prefs.smsEnabled,
      pushEnabled: prefs.pushEnabled,
      from: "db",
    });
  } catch (e) {
    console.error("GET /me/marketing-preferences error:", e);
    return res.status(500).json({ error: "prefs_fetch_failed" });
  }
});

/**
 * PUT /api/me/marketing-preferences
 */
router.put("/me/marketing-preferences", authRequired, async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      return res.status(401).json({ error: "unauthorized" });
    }

    const parsed = UpdatePrefsSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        error: "invalid_payload",
        details: parsed.error.flatten(),
      });
    }

    const data = parsed.data;

    const prefs = await prisma.userMarketingPrefs.upsert({
      where: { userId },
      create: {
        userId,
        ...data,
      },
      update: {
        ...data,
      },
    });

    const marketingOptIn =
      data.sourcePreference !== "NONE" &&
      data.emailEnabled &&
      data.topics.length > 0;

    await prisma.user.update({
      where: { id: userId },
      data: { marketingOptIn },
    });

    return res.json({
      ok: true,
      prefs: {
        sourcePreference: prefs.sourcePreference,
        topics: prefs.topics,
        emailEnabled: prefs.emailEnabled,
        smsEnabled: prefs.smsEnabled,
        pushEnabled: prefs.pushEnabled,
      },
    });
  } catch (e) {
    console.error("PUT /me/marketing-preferences error:", e);
    return res.status(500).json({ error: "prefs_update_failed" });
  }
});

export default router;
