// backend/src/routes/supportUserRoutes.js
import { Router } from "express";
import { z } from "zod";
import jwt from "jsonwebtoken";
import { prisma } from "../db.js";

/**
 * Autentificare:
 *  1) middleware anterior -> req.user
 *  2) cookie: auth | token | access_token
 *  3) header: Authorization: Bearer <jwt>
 */
export async function getSessionUser(req) {
  if (process.env.AUTH_DEV_USER_ID) {
    return { id: String(process.env.AUTH_DEV_USER_ID), role: "USER" };
  }
  if (req.user?.id) {
    return { id: String(req.user.id), role: req.user.role || "USER" };
  }
  const cookieToken =
    req.cookies?.auth ||
    req.cookies?.token ||
    req.cookies?.access_token ||
    null;

  const authHeader = req.headers.authorization || "";
  const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

  const token = cookieToken || bearerToken;
  if (!token) return null;

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const userId = String(payload.sub || payload.id || "");
    if (!userId) return null;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true },
    });

    return user ? { id: user.id, role: user.role } : null;
  } catch {
    return null;
  }
}

/* ===== Helpers ===== */
const lc = (x) => (x ?? "").toLowerCase();
const mapTicketToUI = (t) => ({
  id: t.id,
  subject: t.subject,
  status: lc(t.status),
  priority: lc(t.priority),
  updatedAt: t.updatedAt,
});

function requireAuth() {
  return async (req, res, next) => {
    try {
      const user = await getSessionUser(req);
      if (!user) return res.status(401).json({ error: "unauthorized" });
      req.sessionUser = user;
      next();
    } catch (e) {
      next(e);
    }
  };
}

async function ensureOwnTicketOrAdmin(user, ticketId) {
  if (user?.role === "ADMIN") return true;
  const t = await prisma.supportTicket.findFirst({
    where: {
      id: ticketId,
      requesterId: user.id,
      audience: "USER", // ⬅️ doar tichete de tip USER
    },
    select: { id: true },
  });
  return !!t;
}

async function ensureOwnMessageOrAdmin(user, messageId) {
  if (user?.role === "ADMIN") return true;
  const m = await prisma.supportMessage.findUnique({
    where: { id: messageId },
    select: { authorId: true },
  });
  return !!m && m.authorId === user.id;
}

/* ========================= Zod Schemas ========================= */
const qMeTickets = z.object({
  status: z.enum(["all", "open", "pending", "closed"]).default("all"),
  q: z.string().optional().default(""),
  offset: z.coerce.number().min(0).default(0),
  limit: z.coerce.number().min(1).max(100).default(20),
});

const qMessages = z.object({
  offset: z.coerce.number().min(0).default(0),
  limit: z.coerce.number().min(1).max(100).default(30),
});

const bodyCreateTicket = z.object({
  subject: z.string().min(3),
  category: z.string().default("general"),
  priority: z.enum(["low", "medium", "high"]).default("medium"),
  message: z.string().min(1),
});

const paramsTicketId = z.object({ id: z.string().min(1) });
const paramsMessageId = z.object({ mid: z.string().min(1) });

const bodyMessage = z.object({
  body: z.string().optional().default(""),
  attachments: z
    .array(
      z.object({
        url: z.string().url(),
        name: z.string().optional(),
        filename: z.string().optional(),
        mimeType: z.string().optional(),
        mime: z.string().optional(),
        size: z.number().int().optional(),
      })
    )
    .optional()
    .default([]),
});

const bodyEditMessage = z.object({
  body: z.string().min(1),
});

/* ========================= Router ========================= */
export const UserSupportRoutes = Router();

/** GET /api/support/me/tickets  (cu paginare) */
UserSupportRoutes.get("/me/tickets", requireAuth(), async (req, res) => {
  const user = req.sessionUser;

  const parsed = qMeTickets.safeParse({
    status: req.query.status ?? "all",
    q: req.query.q ?? "",
    offset: req.query.offset ?? 0,
    limit: req.query.limit ?? 20,
  });
  if (!parsed.success) {
    return res.status(400).json({ error: "bad_request", details: parsed.error.flatten() });
  }
  const { status, q, offset, limit } = parsed.data;

  const where = {
    requesterId: user.id,
    audience: "USER", // ⬅️ doar tichete de tip USER
    ...(status !== "all" && {
      status: status === "open" ? "OPEN" : status === "pending" ? "PENDING" : "CLOSED",
    }),
    ...(q && { subject: { contains: q, mode: "insensitive" } }),
  };

  try {
    const [total, rows] = await Promise.all([
      prisma.supportTicket.count({ where }),
      prisma.supportTicket.findMany({
        where,
        orderBy: [{ status: "asc" }, { lastMessageAt: "desc" }],
        skip: offset,
        take: limit,
        select: { id: true, subject: true, status: true, priority: true, updatedAt: true },
      }),
    ]);

    const items = rows.map(mapTicketToUI);
    const nextOffset = offset + items.length;
    res.json({ items, total, hasMore: nextOffset < total, nextOffset });
  } catch (e) {
    console.error("user/me/tickets error:", e);
    res.status(500).json({ error: "server_error" });
  }
});

/** POST /api/support/tickets */
UserSupportRoutes.post("/tickets", requireAuth(), async (req, res) => {
  const user = req.sessionUser;

  const parsed = bodyCreateTicket.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "bad_request", details: parsed.error.flatten() });
  }
  const { subject, category, priority, message } = parsed.data;

  try {
    const ticket = await prisma.supportTicket.create({
      data: {
        requesterId: user.id,
        vendorId: null, // ⬅️ user normal, nu vendor
        audience: "USER",
        subject,
        category,
        priority: priority.toUpperCase(),
        status: "OPEN",
        lastMessageAt: new Date(),
        messages: { create: { authorId: user.id, body: message } },
        reads: { create: { userId: user.id, lastReadAt: new Date() } },
      },
      select: { id: true, subject: true, status: true, priority: true, updatedAt: true },
    });

    res.status(201).json({ ticket: mapTicketToUI(ticket) });
  } catch (e) {
    console.error("user create ticket error:", e);
    res.status(500).json({ error: "server_error" });
  }
});

/** DELETE /api/support/tickets/:id  (owner/admin) */
UserSupportRoutes.delete("/tickets/:id", requireAuth(), async (req, res) => {
  const user = req.sessionUser;
  const parsedParams = paramsTicketId.safeParse(req.params);
  if (!parsedParams.success) return res.status(400).json({ error: "bad_request" });
  const { id } = parsedParams.data;

  const allowed = await ensureOwnTicketOrAdmin(user, id);
  if (!allowed) return res.status(404).json({ error: "not_found" });

  try {
    await prisma.$transaction(async (tx) => {
      await tx.supportAttachment.deleteMany({ where: { ticketId: id } });
      await tx.supportRead.deleteMany({ where: { ticketId: id } });
      await tx.supportMessage.deleteMany({ where: { ticketId: id } });
      await tx.supportTicket.delete({ where: { id } });
    });
    res.json({ ok: true });
  } catch (e) {
    console.error("user delete ticket error:", e);
    res.status(500).json({ error: "server_error" });
  }
});

/** GET /api/support/tickets/:id/messages  (cu paginare) */
UserSupportRoutes.get("/tickets/:id/messages", requireAuth(), async (req, res) => {
  const user = req.sessionUser;

  const parsedParams = paramsTicketId.safeParse(req.params);
  const parsedQuery = qMessages.safeParse(req.query);
  if (!parsedParams.success || !parsedQuery.success) return res.status(400).json({ error: "bad_request" });
  const { id } = parsedParams.data;
  const { offset, limit } = parsedQuery.data;

  const allowed = await ensureOwnTicketOrAdmin(user, id);
  if (!allowed) return res.status(404).json({ error: "not_found" });

  try {
    const where = { ticketId: id };
    const [total, rows] = await Promise.all([
      prisma.supportMessage.count({ where }),
      prisma.supportMessage.findMany({
        where,
        orderBy: { createdAt: "asc" },
        skip: offset,
        take: limit,
        select: {
          id: true,
          body: true,
          createdAt: true,
          authorId: true,
          system: true,
          attachments: { select: { url: true, filename: true, mime: true } },
        },
      }),
    ]);

    const items = rows.map((m) => ({
      id: m.id,
      ticketId: id,
      from: m.system ? "them" : m.authorId === user.id ? "me" : "them",
      body: m.body,
      createdAt: m.createdAt,
      attachments: (m.attachments || []).map((a) => ({
        url: a.url,
        name: a.filename || null,
        mimeType: a.mime || null,
        size: null,
      })),
    }));

    const nextOffset = offset + items.length;
    res.json({ items, total, hasMore: nextOffset < total, nextOffset });
  } catch (e) {
    console.error("user get messages error:", e);
    res.status(500).json({ error: "server_error" });
  }
});

/** POST /api/support/tickets/:id/messages */
UserSupportRoutes.post("/tickets/:id/messages", requireAuth(), async (req, res) => {
  const user = req.sessionUser;

  const parsedParams = paramsTicketId.safeParse(req.params);
  const parsedBody = bodyMessage.safeParse(req.body);
  if (!parsedParams.success || !parsedBody.success) {
    return res.status(400).json({ error: "bad_request" });
  }
  const { id } = parsedParams.data;
  const { body, attachments } = parsedBody.data;

  const allowed = await ensureOwnTicketOrAdmin(user, id);
  if (!allowed) return res.status(404).json({ error: "not_found" });

  try {
    await prisma.$transaction(async (tx) => {
      const msg = await tx.supportMessage.create({
        data: { ticketId: id, authorId: user.id, body: (body || "").trim() || "(fișier)" },
        select: { id: true },
      });

      if (attachments?.length) {
        await tx.supportAttachment.createMany({
          data: attachments.map((a) => ({
            ticketId: id,
            messageId: msg.id,
            url: a.url,
            filename: a.name ?? a.filename ?? null,
            mime: a.mimeType ?? a.mime ?? null,
          })),
        });
      }

      await tx.supportTicket.update({
        where: { id },
        data: { lastMessageAt: new Date(), updatedAt: new Date(), status: "PENDING" },
      });

      await tx.supportRead.upsert({
        where: { ticketId_userId: { ticketId: id, userId: user.id } },
        update: { lastReadAt: new Date() },
        create: { ticketId: id, userId: user.id, lastReadAt: new Date() },
      });
    });

    res.status(201).json({ ok: true });
  } catch (e) {
    console.error("user post message error:", e);
    res.status(500).json({ error: "server_error" });
  }
});

/** PATCH /api/support/messages/:mid (edit) */
UserSupportRoutes.patch("/messages/:mid", requireAuth(), async (req, res) => {
  const user = req.sessionUser;

  const parsedParams = paramsMessageId.safeParse(req.params);
  const parsedBody = bodyEditMessage.safeParse(req.body);
  if (!parsedParams.success || !parsedBody.success) {
    return res.status(400).json({ error: "bad_request" });
  }
  const { mid } = parsedParams.data;
  const { body } = parsedBody.data;

  const allowed = await ensureOwnMessageOrAdmin(user, mid);
  if (!allowed) return res.status(404).json({ error: "not_found" });

  try {
    const updated = await prisma.supportMessage.update({
      where: { id: mid },
      data: { body: body.trim() },
      select: { id: true, ticketId: true, createdAt: true },
    });

    const last = await prisma.supportMessage.findFirst({
      where: { ticketId: updated.ticketId },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });
    await prisma.supportTicket.update({
      where: { id: updated.ticketId },
      data: { lastMessageAt: last?.createdAt ?? new Date(), updatedAt: new Date() },
    });

    res.json({ ok: true });
  } catch (e) {
    console.error("user edit message error:", e);
    res.status(500).json({ error: "server_error" });
  }
});

/** DELETE /api/support/messages/:mid */
UserSupportRoutes.delete("/messages/:mid", requireAuth(), async (req, res) => {
  const user = req.sessionUser;

  const parsedParams = paramsMessageId.safeParse(req.params);
  if (!parsedParams.success) return res.status(400).json({ error: "bad_request" });
  const { mid } = parsedParams.data;

  const allowed = await ensureOwnMessageOrAdmin(user, mid);
  if (!allowed) return res.status(404).json({ error: "not_found" });

  try {
    const msg = await prisma.supportMessage.findUnique({
      where: { id: mid },
      select: { ticketId: true },
    });
    if (!msg) return res.status(404).json({ error: "not_found" });

    await prisma.$transaction(async (tx) => {
      await tx.supportAttachment.deleteMany({ where: { messageId: mid } });
      await tx.supportMessage.delete({ where: { id: mid } });

      const last = await tx.supportMessage.findFirst({
        where: { ticketId: msg.ticketId },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      });

      await tx.supportTicket.update({
        where: { id: msg.ticketId },
        data: { lastMessageAt: last?.createdAt ?? new Date(), updatedAt: new Date() },
      });
    });

    res.json({ ok: true });
  } catch (e) {
    console.error("user delete message error:", e);
    res.status(500).json({ error: "server_error" });
  }
});

/** PATCH /api/support/tickets/:id/read */
UserSupportRoutes.patch("/tickets/:id/read", requireAuth(), async (req, res) => {
  const user = req.sessionUser;

  const parsedParams = paramsTicketId.safeParse(req.params);
  if (!parsedParams.success) return res.status(400).json({ error: "bad_request" });
  const { id } = parsedParams.data;

  const allowed = await ensureOwnTicketOrAdmin(user, id);
  if (!allowed) return res.status(404).json({ error: "not_found" });

  try {
    await prisma.supportRead.upsert({
      where: { ticketId_userId: { ticketId: id, userId: user.id } },
      update: { lastReadAt: new Date() },
      create: { ticketId: id, userId: user.id, lastReadAt: new Date() },
    });

    res.json({ ok: true });
  } catch (e) {
    console.error("user mark read error:", e);
    res.status(500).json({ error: "server_error" });
  }
});

/** GET /api/support/faqs  (poți reutiliza exact ce ai la vendor) */
UserSupportRoutes.get("/unread-count", requireAuth(), async (req, res) => {
  const user = req.sessionUser; // <-- userul autenticat (id, role)

  try {
    const tickets = await prisma.supportTicket.findMany({
      where: {
        audience: "USER",
        requesterId: user.id, // tichete deținute de acest user
      },
      select: {
        id: true,
        lastMessageAt: true,
        reads: {
          where: { userId: user.id },
          select: { lastReadAt: true },
          take: 1,
        },
      },
    });

    const count = tickets.reduce((acc, t) => {
      const lastReadAt = t.reads[0]?.lastReadAt || null;
      if (!lastReadAt) return acc + 1;
      if (t.lastMessageAt && t.lastMessageAt > lastReadAt) return acc + 1;
      return acc;
    }, 0);

    res.json({ count });
  } catch (e) {
    console.error("user/support unread-count error:", e);
    res.status(500).json({ error: "server_error" });
  }
});


export default UserSupportRoutes;
