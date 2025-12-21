// backend/src/routes/adminMarketingRoutes.js
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

      req.adminUser = user;
      next();
    })
    .catch((e) => {
      console.error("adminOnly error:", e);
      return res.status(500).json({ error: "admin_check_failed" });
    });
}

// ========= Zod schema pentru payload (campanie manuală) =========

const AudienceEnum = z.enum(["ALL", "USERS", "VENDORS"]);

const SendCampaignSchema = z.object({
  subject: z.string().min(1),
  preheader: z.string().optional(),
  bodyHtml: z.string().min(1),
  audience: AudienceEnum.default("ALL"),
  testEmail: z.string().email().optional(),
});

// ========= GET /api/admin/marketing/stats =========
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

// ========= helper simplu pentru templating (campanie manuală) =========

const APP_URL = process.env.APP_URL || "https://artfest.ro";
const R2_PUBLIC_BASE_URL =
  process.env.R2_PUBLIC_BASE_URL || "https://media.artfest.ro";

function renderBodyTemplate(bodyHtml, user) {
  let out = bodyHtml;

  const name =
    user.name || user.firstName || user.email?.split("@")[0] || "acolo";

  out = out.replace(/{{\s*name\s*}}/gi, name);

  const unsubscribeUrl = `${APP_URL}/unsubscribe?email=${encodeURIComponent(
    user.email
  )}`;

  out = out.replace(/{{\s*unsubscribeUrl\s*}}/gi, unsubscribeUrl);
  return out;
}

// ========= helper pentru trimis emailuri =========
// adaptează la sistemul tău (SendGrid, Nodemailer etc.)
async function sendMarketingEmail({ to, subject, html, preheader }) {
  console.log("TRIMIT EMAIL marketing către", to, { subject, preheader });
  // TODO: înlocuiește cu implementarea reală (nodemailer / sendgrid etc.)
}

/* ===========================
   DIGEST: FOLLOWED STORES
=========================== */

function toAbsoluteMediaUrl(u) {
  if (!u) return null;
  const s = String(u);
  if (s.startsWith("http://") || s.startsWith("https://")) return s;
  if (s.startsWith("/")) return `${R2_PUBLIC_BASE_URL}${s}`;
  return `${R2_PUBLIC_BASE_URL}/${s}`;
}

/**
 * ⚠️ Ajustează aici dacă ruta reală e altfel.
 * Exemplu: /product/:id sau /produs/:id etc.
 */
function productUrl(productId) {
  return `${APP_URL}/products/${encodeURIComponent(productId)}`;
}

function storeUrl(storeSlug) {
  if (!storeSlug) return `${APP_URL}/stores`;
  // conform rutei tale publice: GET /api/public/store/:slug
  return `${APP_URL}/store/${encodeURIComponent(storeSlug)}`;
}

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatPrice(priceCents, currency = "RON") {
  const amount = (Number(priceCents || 0) / 100).toFixed(2);
  if ((currency || "RON").toUpperCase() === "RON") return `${amount} lei`;
  return `${amount} ${currency}`;
}

function renderFollowedStoresDigestHtml({ user, grouped, days }) {
  const name =
    user.name || user.firstName || user.email?.split("@")[0] || "acolo";

  const unsubscribeUrl = `${APP_URL}/unsubscribe?email=${encodeURIComponent(
    user.email
  )}`;

  const sections = grouped
    .map((g) => {
      const storeName = g.storeName || "Magazin";
      const storeLink = storeUrl(g.storeSlug);

      const itemsHtml = g.products
        .map((p) => {
          const img = toAbsoluteMediaUrl(
            Array.isArray(p.images) ? p.images[0] : null
          );
          const href = productUrl(p.id);
          const price = formatPrice(p.priceCents, p.currency);

          return `
            <tr>
              <td style="padding:10px;border-bottom:1px solid #eee;">
                <a href="${href}" style="text-decoration:none;color:#111;">
                  <div style="display:flex;gap:12px;align-items:center;">
                    ${
                      img
                        ? `<img src="${img}" alt="" width="72" height="72" style="object-fit:cover;border-radius:10px;border:1px solid #eee;"/>`
                        : ""
                    }
                    <div>
                      <div style="font-size:14px;font-weight:700;line-height:1.2;">
                        ${escapeHtml(p.title)}
                      </div>
                      <div style="font-size:13px;color:#555;margin-top:4px;">
                        ${escapeHtml(price)}
                      </div>
                    </div>
                  </div>
                </a>
              </td>
            </tr>
          `;
        })
        .join("");

      return `
        <div style="margin-top:18px;">
          <div style="font-size:16px;font-weight:800;margin:0 0 8px 0;">
            <a href="${storeLink}" style="color:#111;text-decoration:none;">
              ${escapeHtml(storeName)}
            </a>
          </div>
          <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
            <tbody>${itemsHtml}</tbody>
          </table>
        </div>
      `;
    })
    .join("");

  return `
  <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#111;background:#fff;max-width:640px;margin:0 auto;padding:20px;">
    <h2 style="margin:0 0 10px 0;">Salut ${escapeHtml(name)} 👋</h2>
    <p style="margin:0 0 14px 0;color:#333;line-height:1.5;">
      Uite noutățile din ultimele ${days} zile de la magazinele pe care le urmărești:
    </p>

    ${sections}

    <p style="margin:22px 0 0 0;font-size:12px;color:#777;line-height:1.4;">
      Dacă nu mai vrei să primești astfel de emailuri, te poți
      <a href="${unsubscribeUrl}">dezabona aici</a>.
    </p>
  </div>
  `;
}

// ========= GET /api/admin/marketing/preview-followed-stores =========
// Exemplu: /preview-followed-stores?userId=...&days=7&maxPerStore=4&maxStores=6
router.get(
  "/preview-followed-stores",
  authRequired,
  adminOnly,
  async (req, res) => {
    try {
      const userId = String(req.query.userId || "");
      const days = Math.min(
        Math.max(parseInt(req.query.days || "7", 10) || 7, 1),
        60
      );
      const maxPerStore = Math.min(
        Math.max(parseInt(req.query.maxPerStore || "4", 10) || 4, 1),
        20
      );
      const maxStores = Math.min(
        Math.max(parseInt(req.query.maxStores || "6", 10) || 6, 1),
        50
      );

      if (!userId) {
        return res
          .status(400)
          .json({ ok: false, error: "userId_required" });
      }

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, email: true, name: true, firstName: true },
      });

      if (!user?.email) {
        return res
          .status(404)
          .json({ ok: false, error: "user_not_found" });
      }

      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

      const follows = await prisma.serviceFollow.findMany({
        where: { userId },
        select: { serviceId: true },
        take: 500,
      });

      const serviceIds = follows.map((f) => f.serviceId);

      if (!serviceIds.length) {
        return res.json({
          ok: true,
          grouped: [],
          html: "<p>Acest user nu urmărește niciun magazin.</p>",
        });
      }

      const prods = await prisma.product.findMany({
        where: {
          serviceId: { in: serviceIds },
          isActive: true,
          isHidden: false,
          createdAt: { gte: since },
        },
        orderBy: { createdAt: "desc" },
        take: 500,
        select: {
          id: true,
          title: true,
          images: true,
          priceCents: true,
          currency: true,
          createdAt: true,
          serviceId: true,
          service: {
            select: {
              profile: { select: { displayName: true, slug: true } },
              vendor: { select: { displayName: true } },
            },
          },
        },
      });

      if (!prods.length) {
        return res.json({
          ok: true,
          grouped: [],
          html: `<p>Nu există produse noi în ultimele ${days} zile pentru acest user.</p>`,
        });
      }

      const byService = new Map();
      for (const p of prods) {
        if (!byService.has(p.serviceId)) byService.set(p.serviceId, []);
        byService.get(p.serviceId).push(p);
      }

      const grouped = [];
      for (const [sid, arr] of byService.entries()) {
        const first = arr[0];
        const storeName =
          first?.service?.profile?.displayName ||
          first?.service?.vendor?.displayName ||
          "Magazin";

        grouped.push({
          serviceId: sid,
          storeName,
          storeSlug: first?.service?.profile?.slug || null,
          products: arr.slice(0, maxPerStore).map((p) => ({
            id: p.id,
            title: p.title,
            images: p.images,
            priceCents: p.priceCents,
            currency: p.currency,
          })),
        });
      }

      grouped.sort(
        (a, b) => (b.products?.length || 0) - (a.products?.length || 0)
      );

      const finalGrouped = grouped.slice(0, maxStores);
      const html = renderFollowedStoresDigestHtml({
        user,
        grouped: finalGrouped,
        days,
      });

      return res.json({ ok: true, grouped: finalGrouped, html });
    } catch (e) {
      console.error("GET preview-followed-stores error:", e);
      return res.status(500).json({ ok: false, error: "preview_failed" });
    }
  }
);

// ========= POST /api/admin/marketing/send ========= (campanie manuală)
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

// ========= DIGEST SEND =========

const SendFollowedDigestSchema = z.object({
  subject: z.string().min(1).default("Noutăți de la magazinele urmărite"),
  preheader: z.string().optional(),
  days: z.number().int().min(1).max(60).default(7),
  maxPerStore: z.number().int().min(1).max(20).default(4),
  maxStores: z.number().int().min(1).max(50).default(6),

  // test mode
  testEmail: z.string().email().optional(),
  testUserId: z.string().optional(),
});

router.post(
  "/send-followed-stores-digest",
  authRequired,
  adminOnly,
  async (req, res) => {
    try {
      const parsed = SendFollowedDigestSchema.safeParse(req.body || {});
      if (!parsed.success) {
        return res.status(400).json({
          ok: false,
          error: "invalid_payload",
          details: parsed.error.flatten(),
        });
      }

      const { subject, preheader, days, maxPerStore, maxStores, testEmail, testUserId } =
        parsed.data;

      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

      async function buildHtmlForUser(user) {
        const follows = await prisma.serviceFollow.findMany({
          where: { userId: user.id },
          select: { serviceId: true },
          take: 500,
        });

        const serviceIds = follows.map((f) => f.serviceId);
        if (!serviceIds.length) return null;

        const prods = await prisma.product.findMany({
          where: {
            serviceId: { in: serviceIds },
            isActive: true,
            isHidden: false,
            createdAt: { gte: since },
          },
          orderBy: { createdAt: "desc" },
          take: 500,
          select: {
            id: true,
            title: true,
            images: true,
            priceCents: true,
            currency: true,
            createdAt: true,
            serviceId: true,
            service: {
              select: {
                profile: { select: { displayName: true, slug: true } },
                vendor: { select: { displayName: true } },
              },
            },
          },
        });

        if (!prods.length) return null;

        const byService = new Map();
        for (const p of prods) {
          if (!byService.has(p.serviceId)) byService.set(p.serviceId, []);
          byService.get(p.serviceId).push(p);
        }

        const grouped = [];
        for (const [sid, arr] of byService.entries()) {
          const first = arr[0];
          const storeName =
            first?.service?.profile?.displayName ||
            first?.service?.vendor?.displayName ||
            "Magazin";

          grouped.push({
            serviceId: sid,
            storeName,
            storeSlug: first?.service?.profile?.slug || null,
            products: arr.slice(0, maxPerStore).map((p) => ({
              id: p.id,
              title: p.title,
              images: p.images,
              priceCents: p.priceCents,
              currency: p.currency,
            })),
          });
        }

        grouped.sort(
          (a, b) => (b.products?.length || 0) - (a.products?.length || 0)
        );

        const finalGrouped = grouped.slice(0, maxStores);
        if (!finalGrouped.length) return null;

        return renderFollowedStoresDigestHtml({
          user,
          grouped: finalGrouped,
          days,
        });
      }

      // ========== TEST MODE ==========
      if (testEmail) {
        let user = null;

        if (testUserId) {
          user = await prisma.user.findUnique({
            where: { id: testUserId },
            select: { id: true, email: true, name: true, firstName: true },
          });
        }

        if (!user) {
          user = await prisma.user.findFirst({
            where: {
              marketingOptIn: true,
              email: { not: null },
              status: "ACTIVE",
            },
            select: { id: true, email: true, name: true, firstName: true },
            orderBy: { createdAt: "desc" },
          });
        }

        if (!user?.email) {
          return res.json({ ok: false, error: "no_users_for_test" });
        }

        const html =
          (await buildHtmlForUser(user)) ||
          `<p>Nu există produse noi în ultimele ${days} zile pentru acest user.</p>`;

        await sendMarketingEmail({ to: testEmail, subject, html, preheader });

        await prisma.marketingCampaign.create({
          data: {
            subject,
            preheader,
            bodyHtml: html,
            audience: "ALL",
            status: "SENT",
            targetCount: 1,
            sentCount: 1,
            testEmail,
            sentAt: new Date(),
            createdById: req.adminUser?.id ?? null,
          },
        });

        return res.json({ ok: true, testMode: true, sentCount: 1 });
      }

      // ========== REAL SEND ==========
      // eligibili: marketingOptIn true + email + ACTIVE + emailEnabled (sau prefs inexistente)
      const recipients = await prisma.user.findMany({
        where: {
          marketingOptIn: true,
          email: { not: null },
          status: "ACTIVE",
          OR: [
            { marketingPrefs: { is: null } },
            { marketingPrefs: { is: { emailEnabled: true } } },
          ],
        },
        select: { id: true, email: true, name: true, firstName: true },
        take: 5000, // limit inițial (safe). crești când ai queue.
        orderBy: { createdAt: "desc" },
      });

      if (!recipients.length) {
        return res.json({ ok: false, error: "no_recipients" });
      }

      const campaign = await prisma.marketingCampaign.create({
        data: {
          subject,
          preheader,
          bodyHtml: "<!-- followed-stores-digest: generated per-user -->",
          audience: "ALL",
          status: "SENDING",
          targetCount: recipients.length,
          createdById: req.adminUser?.id ?? null,
        },
      });

      let sentCount = 0;

      for (const u of recipients) {
        try {
          const html = await buildHtmlForUser(u);
          if (!html) continue; // nu trimitem dacă nu are noutăți

          await sendMarketingEmail({
            to: u.email,
            subject,
            html,
            preheader,
          });
          sentCount += 1;
        } catch (e) {
          console.error(
            `digest send error către ${u.email} (campaign ${campaign.id})`,
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

      return res.json({ ok: true, sentCount });
    } catch (e) {
      console.error("POST /send-followed-stores-digest error:", e);
      return res.status(500).json({ ok: false, error: "send_failed" });
    }
  }
);

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
