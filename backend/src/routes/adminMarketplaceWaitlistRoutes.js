// backend/src/routes/adminWaitlists.js
import { Router } from "express";
import crypto from "crypto";
import { prisma } from "../db.js";
import { authRequired } from "../api/auth.js";
import { makeTransport } from "../lib/mailer.js";

const router = Router();

/* ============================================================
   Helpers (admin)
============================================================ */
function requireAdmin(req, res, next) {
  const role = req.user?.role || req.user?.type || req.user?.isAdmin;
  const ok = role === "ADMIN" || role === "admin" || role === true;
  if (!ok) return res.status(403).json({ ok: false, error: "forbidden" });
  return next();
}

function normalizeEmail(email = "") {
  return String(email || "").trim().toLowerCase();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function stripHtml(html = "") {
  return String(html).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

/* ============================================================
   Shared email settings
============================================================ */
const BRAND_NAME = process.env.BRAND_NAME || "Artfest";
const APP_URL = (process.env.APP_URL || process.env.FRONTEND_URL || "").replace(/\/+$/, "");

const EMAIL_REPLY_TO = process.env.EMAIL_REPLY_TO_CONTACT || "contact@artfest.ro";

// Sender key folosit pentru waitlist (recomandat: noreply)
const WAITLIST_SENDER = process.env.WAITLIST_SENDER || "noreply";

// FROM separat pe waitlist (opțional)
const WAITLIST_FROM =
  process.env.EMAIL_FROM_WAITLIST ||
  process.env.EMAIL_FROM_NOREPLY ||
  process.env.EMAIL_FROM ||
  `Artfest <no-reply@artfest.ro>`;

/* ============================================================
   Unsubscribe (HMAC) — păstrăm fix stilul tău existent
   IMPORTANT: URL-ul e la frontend (APP_URL), ex: /dezabonare-waitlist
============================================================ */
function makeUnsubscribeToken(email) {
  const secret = process.env.WAITLIST_UNSUBSCRIBE_SECRET || process.env.JWT_SECRET;
  if (!secret) throw new Error("missing_unsubscribe_secret");
  const h = crypto.createHmac("sha256", secret);
  h.update(normalizeEmail(email));
  return h.digest("hex");
}

function makeUnsubscribeUrl(email) {
  if (!APP_URL) return "";
  const token = makeUnsubscribeToken(email);
  return `${APP_URL}/dezabonare-waitlist?email=${encodeURIComponent(email)}&token=${encodeURIComponent(token)}`;
}

/* ============================================================
   Email wrappers (separate, ca să NU se amestece Digital vs Marketplace)
============================================================ */
function wrapWaitlistHtml({ html, preheader, unsubscribeUrl, footerText }) {
  return `
  <div style="font-family:Inter,system-ui,Segoe UI,Roboto,Arial,sans-serif;max-width:640px;margin:auto;padding:20px;background:#f9fafb;border-radius:12px">
    ${
      preheader
        ? `<span style="display:none !important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;overflow:hidden;">
            ${String(preheader)}
          </span>`
        : ""
    }

    <div style="text-align:center;margin-bottom:18px;">
      <img src="https://media.artfest.ro/branding/LogoArtfest.png" alt="${BRAND_NAME} logo" width="96" height="96"
           style="display:block;margin:0 auto;border:0;outline:none;text-decoration:none;max-width:96px;height:auto;">
    </div>

    <div style="background:#ffffff;border-radius:12px;padding:18px 16px;border:1px solid #e5e7eb;">
      ${String(html || "")}
    </div>

    <p style="font-size:11px;color:#9ca3af;text-align:center;margin:16px 0 0;line-height:1.35;">
      ${footerText || ""}
      ${
        unsubscribeUrl
          ? `<br/>Dacă nu mai vrei notificări, te poți <a href="${unsubscribeUrl}" style="color:#6b7280;">dezabona aici</a>.`
          : ""
      }
    </p>
  </div>
  `;
}

async function sendWaitlistEmail({ to, subject, html, preheader, senderKey = WAITLIST_SENDER, footerText }) {
  if (!WAITLIST_FROM) throw new Error("missing_EMAIL_FROM");

  const transporter = makeTransport(senderKey);

  const unsubscribeUrl = makeUnsubscribeUrl(to);
  const finalHtml = wrapWaitlistHtml({ html, preheader, unsubscribeUrl, footerText });
  const text = stripHtml(html);

  const headers = {
    "Auto-Submitted": "auto-generated",
    "X-Auto-Response-Suppress": "All",
    Precedence: "bulk",
  };
  if (unsubscribeUrl) headers["List-Unsubscribe"] = `<${unsubscribeUrl}>`;

  return transporter.sendMail({
    from: WAITLIST_FROM,
    replyTo: EMAIL_REPLY_TO,
    to,
    subject,
    html: finalHtml,
    text,
    headers,
  });
}

/* ============================================================
   DIGITAL WAITLIST (existing behavior, but normalize enum casing)
   Prisma enum: NEW, CONTACTED, CONVERTED, SPAM
============================================================ */

/**
 * GET /api/admin/digital-waitlist?status=NEW&search=gmail&page=1&limit=50
 */
router.get("/digital-waitlist", authRequired, requireAdmin, async (req, res) => {
  try {
    const status = req.query.status ? String(req.query.status).toUpperCase() : null;
    const search = req.query.search ? String(req.query.search).trim().toLowerCase() : null;

    const page = Math.max(1, Number(req.query.page || 1));
    const limit = Math.min(200, Math.max(1, Number(req.query.limit || 50)));
    const skip = (page - 1) * limit;

    const where = {
      ...(status ? { status } : {}),
      ...(search
        ? {
            OR: [
              { email: { contains: search, mode: "insensitive" } },
              { name: { contains: search, mode: "insensitive" } },
              { source: { contains: search, mode: "insensitive" } },
            ],
          }
        : {}),
    };

    const [total, items] = await Promise.all([
      prisma.digitalWaitlistSubscriber.count({ where }),
      prisma.digitalWaitlistSubscriber.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
        select: {
          id: true,
          email: true,
          name: true,
          source: true,
          status: true,
          createdAt: true,
          contactedAt: true,
          notes: true,
        },
      }),
    ]);

    return res.json({ ok: true, page, limit, total, items });
  } catch (err) {
    console.error("admin digital-waitlist list error:", err);
    return res.status(500).json({ ok: false, error: "server_error" });
  }
});

/**
 * PATCH /api/admin/digital-waitlist/:id
 * body: { status?, notes? }
 */
router.patch("/digital-waitlist/:id", authRequired, requireAdmin, async (req, res) => {
  try {
    const id = String(req.params.id);
    const status = req.body?.status ? String(req.body.status).toUpperCase() : null;
    const notes = req.body?.notes != null ? String(req.body.notes) : undefined;

    const data = {};
    if (status) {
      data.status = status;
      data.contactedAt = status === "CONTACTED" ? new Date() : null;
    }
    if (notes !== undefined) data.notes = notes;

    const row = await prisma.digitalWaitlistSubscriber.update({
      where: { id },
      data,
      select: { id: true, email: true, status: true, notes: true, contactedAt: true },
    });

    return res.json({ ok: true, item: row });
  } catch (err) {
    console.error("admin digital-waitlist patch error:", err);
    return res.status(500).json({ ok: false, error: "server_error" });
  }
});

/**
 * DELETE /api/admin/digital-waitlist/:id
 */
router.delete("/digital-waitlist/:id", authRequired, requireAdmin, async (req, res) => {
  try {
    const id = String(req.params.id);
    await prisma.digitalWaitlistSubscriber.delete({ where: { id } });
    return res.json({ ok: true });
  } catch (err) {
    console.error("admin digital-waitlist delete error:", err);
    return res.status(500).json({ ok: false, error: "server_error" });
  }
});

/**
 * POST /api/admin/digital-waitlist/test
 * body: { to, subject, bodyHtml, preheader?, senderKey? }
 */
router.post("/digital-waitlist/test", authRequired, requireAdmin, async (req, res) => {
  try {
    const to = normalizeEmail(req.body?.to || "");
    const subject = String(req.body?.subject || "").trim();
    const bodyHtml = String(req.body?.bodyHtml || "").trim();
    const preheader = req.body?.preheader != null ? String(req.body.preheader).trim() : undefined;
    const senderKey = req.body?.senderKey ? String(req.body.senderKey) : WAITLIST_SENDER;

    if (!isValidEmail(to)) return res.status(400).json({ ok: false, error: "invalid_to" });
    if (!subject) return res.status(400).json({ ok: false, error: "missing_subject" });
    if (!bodyHtml) return res.status(400).json({ ok: false, error: "missing_body" });

    await sendWaitlistEmail({
      to,
      subject,
      html: bodyHtml,
      preheader,
      senderKey,
      footerText: `Primești acest email pentru că te-ai înscris pe lista de așteptare Servicii Digitale ${BRAND_NAME}.`,
    });

    return res.json({ ok: true, sentCount: 1, test: true, senderKey });
  } catch (err) {
    console.error("admin digital-waitlist test error:", err);
    return res.status(500).json({ ok: false, error: err?.message || "server_error" });
  }
});

/**
 * POST /api/admin/digital-waitlist/send
 * body: { subject, bodyHtml, preheader?, onlyNew?, senderKey? }
 */
router.post("/digital-waitlist/send", authRequired, requireAdmin, async (req, res) => {
  try {
    const subject = String(req.body?.subject || "").trim();
    const bodyHtml = String(req.body?.bodyHtml || "").trim();
    const preheader = req.body?.preheader != null ? String(req.body.preheader).trim() : undefined;
    const onlyNew = Boolean(req.body?.onlyNew);
    const senderKey = req.body?.senderKey ? String(req.body.senderKey) : WAITLIST_SENDER;

    if (!subject) return res.status(400).json({ ok: false, error: "missing_subject" });
    if (!bodyHtml) return res.status(400).json({ ok: false, error: "missing_body" });

    const where = onlyNew ? { status: "NEW" } : {};

    const recipients = await prisma.digitalWaitlistSubscriber.findMany({
      where,
      select: { email: true },
      orderBy: { createdAt: "desc" },
      take: 5000,
    });

    const BATCH = 30;
    const failed = [];
    let sentCount = 0;

    for (let i = 0; i < recipients.length; i += BATCH) {
      const batch = recipients.slice(i, i + BATCH);

      const results = await Promise.allSettled(
        batch.map((r) =>
          sendWaitlistEmail({
            to: normalizeEmail(r.email),
            subject,
            html: bodyHtml,
            preheader,
            senderKey,
            footerText: `Primești acest email pentru că te-ai înscris pe lista de așteptare Servicii Digitale ${BRAND_NAME}.`,
          })
        )
      );

      results.forEach((r, idx) => {
        const email = batch[idx].email;
        if (r.status === "fulfilled") sentCount++;
        else {
          failed.push(email);
          console.error("send fail:", email, r.reason?.message || r.reason);
        }
      });
    }

    if (sentCount > 0) {
      const okEmails = recipients.map((r) => r.email).filter((e) => !failed.includes(e));

      await prisma.digitalWaitlistSubscriber.updateMany({
        where: { email: { in: okEmails } },
        data: { status: "CONTACTED", contactedAt: new Date() },
      });
    }

    return res.json({
      ok: true,
      senderKey,
      sentCount,
      failedCount: failed.length,
      failedPreview: failed.slice(0, 10),
    });
  } catch (err) {
    console.error("admin digital-waitlist send error:", err);
    let msg = err?.message || "server_error";
    if (err?.message === "missing_EMAIL_FROM") msg = "EMAIL_FROM_* lipsește în env";
    if (err?.message === "missing_unsubscribe_secret") msg = "WAITLIST_UNSUBSCRIBE_SECRET / JWT_SECRET lipsește în env";
    return res.status(500).json({ ok: false, error: msg });
  }
});

/* ============================================================
   MARKETPLACE WAITLIST (separat de digital)
============================================================ */

/**
 * GET /api/admin/marketplace-waitlist?status=NEW&search=gmail&page=1&limit=50
 */
router.get("/marketplace-waitlist", authRequired, requireAdmin, async (req, res) => {
  try {
    const status = req.query.status ? String(req.query.status).toUpperCase() : null;
    const search = req.query.search ? String(req.query.search).trim().toLowerCase() : null;

    const page = Math.max(1, Number(req.query.page || 1));
    const limit = Math.min(200, Math.max(1, Number(req.query.limit || 50)));
    const skip = (page - 1) * limit;

    const where = {
      ...(status ? { status } : {}),
      ...(search
        ? {
            OR: [
              { email: { contains: search, mode: "insensitive" } },
              { name: { contains: search, mode: "insensitive" } },
              { source: { contains: search, mode: "insensitive" } },
            ],
          }
        : {}),
    };

    const [total, items] = await Promise.all([
      prisma.marketplaceWaitlistSubscriber.count({ where }),
      prisma.marketplaceWaitlistSubscriber.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
        select: {
          id: true,
          email: true,
          name: true,
          source: true,
          status: true,
          createdAt: true,
          contactedAt: true,
          notes: true,
        },
      }),
    ]);

    return res.json({ ok: true, page, limit, total, items });
  } catch (err) {
    console.error("admin marketplace-waitlist list error:", err);
    return res.status(500).json({ ok: false, error: "server_error" });
  }
});

/**
 * PATCH /api/admin/marketplace-waitlist/:id
 * body: { status?, notes? }
 */
router.patch("/marketplace-waitlist/:id", authRequired, requireAdmin, async (req, res) => {
  try {
    const id = String(req.params.id);
    const status = req.body?.status ? String(req.body.status).toUpperCase() : null;
    const notes = req.body?.notes != null ? String(req.body.notes) : undefined;

    const data = {};
    if (status) {
      data.status = status;
      data.contactedAt = status === "CONTACTED" ? new Date() : null;
    }
    if (notes !== undefined) data.notes = notes;

    const row = await prisma.marketplaceWaitlistSubscriber.update({
      where: { id },
      data,
      select: { id: true, email: true, status: true, notes: true, contactedAt: true },
    });

    return res.json({ ok: true, item: row });
  } catch (err) {
    console.error("admin marketplace-waitlist patch error:", err);
    return res.status(500).json({ ok: false, error: "server_error" });
  }
});

/**
 * POST /api/admin/marketplace-waitlist/test
 * body: { to, subject, bodyHtml, preheader?, senderKey? }
 */
router.post("/marketplace-waitlist/test", authRequired, requireAdmin, async (req, res) => {
  try {
    const to = normalizeEmail(req.body?.to || "");
    const subject = String(req.body?.subject || "").trim();
    const bodyHtml = String(req.body?.bodyHtml || "").trim();
    const preheader = req.body?.preheader != null ? String(req.body.preheader).trim() : undefined;
    const senderKey = req.body?.senderKey ? String(req.body.senderKey) : WAITLIST_SENDER;

    if (!isValidEmail(to)) return res.status(400).json({ ok: false, error: "invalid_to" });
    if (!subject) return res.status(400).json({ ok: false, error: "missing_subject" });
    if (!bodyHtml) return res.status(400).json({ ok: false, error: "missing_body" });

    await sendWaitlistEmail({
      to,
      subject,
      html: bodyHtml,
      preheader,
      senderKey,
      footerText: `Primești acest email pentru că te-ai înscris pe lista de așteptare Marketplace ${BRAND_NAME}.`,
    });

    return res.json({ ok: true, sentCount: 1, test: true, senderKey });
  } catch (err) {
    console.error("admin marketplace-waitlist test error:", err);
    return res.status(500).json({ ok: false, error: err?.message || "server_error" });
  }
});

/**
 * POST /api/admin/marketplace-waitlist/send
 * body: { subject, bodyHtml, preheader?, onlyNew?, senderKey? }
 */
router.post("/marketplace-waitlist/send", authRequired, requireAdmin, async (req, res) => {
  try {
    const subject = String(req.body?.subject || "").trim();
    const bodyHtml = String(req.body?.bodyHtml || "").trim();
    const preheader = req.body?.preheader != null ? String(req.body.preheader).trim() : undefined;
    const onlyNew = Boolean(req.body?.onlyNew);
    const senderKey = req.body?.senderKey ? String(req.body.senderKey) : WAITLIST_SENDER;

    if (!subject) return res.status(400).json({ ok: false, error: "missing_subject" });
    if (!bodyHtml) return res.status(400).json({ ok: false, error: "missing_body" });

    const where = onlyNew ? { status: "NEW" } : {};

    const recipients = await prisma.marketplaceWaitlistSubscriber.findMany({
      where,
      select: { email: true },
      orderBy: { createdAt: "desc" },
      take: 5000,
    });

    const BATCH = 30;
    const failed = [];
    let sentCount = 0;

    for (let i = 0; i < recipients.length; i += BATCH) {
      const batch = recipients.slice(i, i + BATCH);

      const results = await Promise.allSettled(
        batch.map((r) =>
          sendWaitlistEmail({
            to: normalizeEmail(r.email),
            subject,
            html: bodyHtml,
            preheader,
            senderKey,
            footerText: `Primești acest email pentru că te-ai înscris pe lista de așteptare Marketplace ${BRAND_NAME}.`,
          })
        )
      );

      results.forEach((r, idx) => {
        const email = batch[idx].email;
        if (r.status === "fulfilled") sentCount++;
        else {
          failed.push(email);
          console.error("send fail:", email, r.reason?.message || r.reason);
        }
      });
    }

    if (sentCount > 0) {
      const okEmails = recipients.map((r) => r.email).filter((e) => !failed.includes(e));

      await prisma.marketplaceWaitlistSubscriber.updateMany({
        where: { email: { in: okEmails } },
        data: { status: "CONTACTED", contactedAt: new Date() },
      });
    }

    return res.json({
      ok: true,
      senderKey,
      sentCount,
      failedCount: failed.length,
      failedPreview: failed.slice(0, 10),
    });
  } catch (err) {
    console.error("admin marketplace-waitlist send error:", err);
    let msg = err?.message || "server_error";
    if (err?.message === "missing_EMAIL_FROM") msg = "EMAIL_FROM_* lipsește în env";
    if (err?.message === "missing_unsubscribe_secret") msg = "WAITLIST_UNSUBSCRIBE_SECRET / JWT_SECRET lipsește în env";
    return res.status(500).json({ ok: false, error: msg });
  }
});

export default router;
