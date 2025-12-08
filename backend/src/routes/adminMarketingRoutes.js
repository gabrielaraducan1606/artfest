// src/routes/adminMarketingRoutes.js
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { authRequired } from "../api/auth.js";

const router = Router();

/**
 * middleware – permite acces doar userilor cu rol ADMIN
 * verifică user-ul direct din DB, după req.user.sub (setat de authRequired)
 */
function adminOnly(req, res, next) {
  if (!req.user?.sub) {
    return res.status(401).json({ error: "unauthorized" });
  }

  prisma.user
    .findUnique({
      where: { id: req.user.sub },
      select: { id: true, role: true, email: true },
    })
    .then((user) => {
      if (!user) {
        return res.status(401).json({ error: "user_not_found" });
      }

      if (user.role !== "ADMIN") {
        return res.status(403).json({ error: "forbidden" });
      }

      // păstrăm adminul pe req pentru a-l folosi ulterior (createdById etc.)
      req.adminUser = user;
      next();
    })
    .catch((e) => {
      console.error("adminOnly error:", e);
      return res.status(500).json({ error: "admin_check_failed" });
    });
}

// ========= Zod schema pentru payload =========

const AudienceEnum = z.enum(["ALL", "USERS", "VENDORS"]);

const SendCampaignSchema = z.object({
  subject: z.string().min(1),
  preheader: z.string().optional(),
  bodyHtml: z.string().min(1),
  audience: AudienceEnum.default("ALL"),
  testEmail: z.string().email().optional(),
});

// ========= GET /api/admin/marketing/stats =========
// returnează counts pentru marketingOptIn = true

router.get("/stats", authRequired, adminOnly, async (req, res) => {
  try {
    const [total, users, vendors] = await Promise.all([
      prisma.user.count({ where: { marketingOptIn: true } }),
      prisma.user.count({
        where: { marketingOptIn: true, role: "USER" },
      }),
      prisma.user.count({
        where: { marketingOptIn: true, role: "VENDOR" },
      }),
    ]);

    return res.json({
      subscribersTotal: total,
      subscribersUsers: users,
      subscribersVendors: vendors,
    });
  } catch (e) {
    console.error("GET /api/admin/marketing/stats error:", e);
    return res.status(500).json({ error: "stats_failed" });
  }
});

// ========= helper simplu pentru templating =========

const APP_URL = process.env.APP_URL || "https://artfest.ro";

function renderBodyTemplate(bodyHtml, user) {
  let out = bodyHtml;

  // {{name}} – fallback la email dacă nu avem nume
  const name =
    user.name || user.firstName || user.email?.split("@")[0] || "acolo";

  out = out.replace(/{{\s*name\s*}}/gi, name);

  // {{unsubscribeUrl}}
  const unsubscribeUrl = `${APP_URL}/unsubscribe?email=${encodeURIComponent(
    user.email
  )}`;

  out = out.replace(/{{\s*unsubscribeUrl\s*}}/gi, unsubscribeUrl);
  return out;
}

// ========= helper pentru trimis emailuri =========
// adaptează la sistemul tău (SendGrid, Nodemailer etc.)
async function sendMarketingEmail({ to, subject, html, preheader }) {
  console.log("TRIMIT EMAIL marketing către", to);
  // TODO: înlocuiește cu implementarea reală (nodemailer / sendgrid etc.)
}

// ========= POST /api/admin/marketing/send =========

router.post("/send", authRequired, adminOnly, async (req, res) => {
  try {
    const parsed = SendCampaignSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        error: "invalid_payload",
        details: parsed.error.flatten(),
      });
    }

    const { subject, preheader, bodyHtml, audience, testEmail } = parsed.data;

    // Dacă e mod test -> trimitem DOAR la adresa de test
    if (testEmail) {
      await sendMarketingEmail({
        to: testEmail,
        subject,
        html: bodyHtml,
        preheader,
      });

      await prisma.marketingCampaign.create({
        data: {
          subject,
          preheader,
          bodyHtml,
          audience,
          status: "SENT",
          targetCount: 1,
          sentCount: 1,
          testEmail,
          sentAt: new Date(),
          createdById: req.adminUser?.id ?? null,
        },
      });

      return res.json({ ok: true, sentCount: 1, testMode: true });
    }

    // -------- Campanie reală --------

    const baseWhere = { marketingOptIn: true, email: { not: null } };

    let where = baseWhere;
    if (audience === "USERS") {
      where = { ...baseWhere, role: "USER" };
    } else if (audience === "VENDORS") {
      where = { ...baseWhere, role: "VENDOR" };
    }

    const recipients = await prisma.user.findMany({
      where,
      select: { id: true, email: true, name: true, firstName: true },
    });

    if (!recipients.length) {
      return res.json({
        ok: false,
        error: "no_recipients",
      });
    }

    const campaign = await prisma.marketingCampaign.create({
      data: {
        subject,
        preheader,
        bodyHtml,
        audience,
        status: "SENDING",
        targetCount: recipients.length,
        createdById: req.adminUser?.id ?? null,
      },
    });

    let sentCount = 0;

    for (const user of recipients) {
      try {
        const html = renderBodyTemplate(bodyHtml, user);
        await sendMarketingEmail({
          to: user.email,
          subject,
          html,
          preheader,
        });
        sentCount += 1;
      } catch (e) {
        console.error(
          `Eroare trimitere email către ${user.email} în campania ${campaign.id}:`,
          e
        );
      }
    }

    await prisma.marketingCampaign.update({
      where: { id: campaign.id },
      data: {
        sentCount,
        status: sentCount > 0 ? "SENT" : "FAILED",
        sentAt: new Date(),
      },
    });

    return res.json({
      ok: true,
      sentCount,
    });
  } catch (e) {
    console.error("POST /api/admin/marketing/send error:", e);
    return res.status(500).json({ error: "send_failed" });
  }
});

/**
 * GET /api/admin/marketing/prefs
 * Listă paginată de preferințe de marketing + info user.
 */
router.get("/prefs", authRequired, adminOnly, async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page ?? "1", 10) || 1, 1);
    const pageSizeRaw = parseInt(req.query.pageSize ?? "50", 10) || 50;
    const pageSize = Math.min(Math.max(pageSizeRaw, 1), 200);

    const { q, source, topic } = req.query;

    const where = {
      user: {
        email: q
          ? {
              contains: String(q).trim(),
              mode: "insensitive",
            }
          : undefined,
      },
      sourcePreference: source ? String(source) : undefined,
      topics: topic
        ? {
            has: String(topic),
          }
        : undefined,
    };

    const [items, total] = await Promise.all([
      prisma.userMarketingPrefs.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          user: {
            select: {
              id: true,
              email: true,
              role: true,
              name: true,
              firstName: true,
              lastName: true,
              marketingOptIn: true,
              createdAt: true,
            },
          },
        },
        orderBy: {
          updatedAt: "desc",
        },
      }),
      prisma.userMarketingPrefs.count({ where }),
    ]);

    const rows = items.map((p) => ({
      id: p.userId,
      email: p.user.email,
      role: p.user.role,
      name:
        p.user.name ||
        `${p.user.firstName ?? ""} ${p.user.lastName ?? ""}`.trim() ||
        null,
      marketingOptIn: p.user.marketingOptIn,
      createdAt: p.user.createdAt,
      sourcePreference: p.sourcePreference,
      topics: p.topics,
      emailEnabled: p.emailEnabled,
      smsEnabled: p.smsEnabled,
      pushEnabled: p.pushEnabled,
      updatedAt: p.updatedAt,
    }));

    return res.json({
      ok: true,
      items: rows,
      total,
      page,
      pageSize,
    });
  } catch (e) {
    console.error("GET /api/admin/marketing/prefs error:", e);
    return res.status(500).json({ error: "prefs_list_failed" });
  }
});
/**
 * GET /api/admin/marketing/user/:userId
 * Preferințele de marketing pentru un user specific (view în admin).
 */
router.get("/user/:userId", authRequired, adminOnly, async (req, res) => {
  try {
    const userId = req.params.userId;

    const prefs = await prisma.userMarketingPrefs.findUnique({
      where: { userId },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            role: true,
            name: true,
            firstName: true,
            lastName: true,
            marketingOptIn: true,
            createdAt: true,
          },
        },
      },
    });

    if (!prefs) {
      // userul există, dar nu are preferințe salvate explicit
      // (poți folosi aceleași default-uri ca în userRoutes dacă vrei)
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          role: true,
          name: true,
          firstName: true,
          lastName: true,
          marketingOptIn: true,
          createdAt: true,
        },
      });

      return res.json({
        ok: true,
        user,
        prefs: null,
        message:
          "Userul nu are preferințe explicit salvate. Se aplică setările implicite.",
      });
    }

    return res.json({
      ok: true,
      user: prefs.user,
      prefs: {
        sourcePreference: prefs.sourcePreference,
        topics: prefs.topics,
        emailEnabled: prefs.emailEnabled,
        smsEnabled: prefs.smsEnabled,
        pushEnabled: prefs.pushEnabled,
        updatedAt: prefs.updatedAt,
      },
    });
  } catch (e) {
    console.error("GET /api/admin/marketing/user/:userId error:", e);
    return res.status(500).json({ error: "user_prefs_fetch_failed" });
  }
});

export default router;
