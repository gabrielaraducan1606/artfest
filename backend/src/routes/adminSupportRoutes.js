// src/api/admin-support.js
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { authRequired } from "../api/auth.js";
import { sendGuestSupportReplyEmail } from "../lib/mailer.js";
import {
  notifyUserOnSupportReply,
  notifyUserOnSupportStatusChange,
} from "../services/notifications.js";

const lc = (x) => (x ?? "").toLowerCase();

const isAdminReq = (req) =>
  req.user && (req.user.role === "ADMIN" || req.user.role === "SUPERADMIN");

// pentru UI (compatibil cu Vendor/User)
const mapTicketToUI = (t) => ({
  id: t.id,
  subject: t.subject,
  status: lc(t.status),
  priority: lc(t.priority),
  updatedAt: t.updatedAt,

  audience: lc(t.audience),

  requester: t.requester
    ? {
        id: t.requester.id,
        email: t.requester.email,
        firstName: t.requester.firstName,
        lastName: t.requester.lastName,
        role: t.requester.role || null,
      }
    : null,
  vendor: t.vendor
    ? {
        id: t.vendor.id,
        displayName: t.vendor.displayName,
      }
    : null,

  // guest / fallback info
  requesterName: t.requesterName || null,
  requesterEmail: t.requesterEmail || null,
});

// ======================= Zod Schemas =======================

const qTickets = z.object({
  status: z.enum(["all", "open", "pending", "closed"]).default("all"),
  audience: z.enum(["all", "user", "vendor", "guest"]).default("all"),
  role: z.enum(["all", "user", "vendor", "admin"]).default("all"),
  q: z.string().optional().default(""),
  requesterId: z.string().optional(),
  vendorId: z.string().optional(),
  offset: z.coerce.number().min(0).default(0),
  limit: z.coerce.number().min(1).max(100).default(20),
  priority: z.enum(["all", "low", "medium", "high"]).default("all"),
});

const qMessages = z.object({
  offset: z.coerce.number().min(0).default(0),
  limit: z.coerce.number().min(1).max(100).default(100),
});

const paramsTicketId = z.object({ id: z.string().min(1) });
const paramsMessageId = z.object({ mid: z.string().min(1) });

const attachmentSchema = z.object({
  url: z.string().url(),
  name: z.string().optional(),
  filename: z.string().optional(),
  mimeType: z.string().optional(),
  mime: z.string().optional(),
  size: z.number().int().optional(),
});

const bodyMessage = z.object({
  body: z.string().optional().default(""),
  attachments: z.array(attachmentSchema).optional().default([]),
});

const bodyEditMessage = z.object({
  body: z.string().min(1),
});

// update status / priority tichet
const bodyUpdateTicket = z.object({
  status: z.enum(["open", "pending", "closed"]).optional(),
  priority: z.enum(["low", "medium", "high"]).optional(),
});

export const AdminSupportRoutes = Router();

// toate rutele de aici → user logat
AdminSupportRoutes.use(authRequired);

// mic middleware ca să ne asigurăm că e ADMIN
AdminSupportRoutes.use((req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ error: "unauthorized" });
  }
  if (!isAdminReq(req)) {
    return res.status(403).json({ error: "forbidden" });
  }
  next();
});

/**
 * GET /api/admin/support/tickets
 */
AdminSupportRoutes.get("/tickets", async (req, res) => {
  const parsed = qTickets.safeParse({
    status: req.query.status ?? "all",
    audience: req.query.audience ?? "all",
    role: req.query.role ?? "all",
    q: req.query.q ?? "",
    requesterId: req.query.requesterId,
    vendorId: req.query.vendorId,
    offset: req.query.offset ?? 0,
    limit: req.query.limit ?? 20,
    priority: req.query.priority ?? "all",
  });

  if (!parsed.success) {
    return res.status(400).json({
      error: "bad_request",
      details: parsed.error.flatten(),
    });
  }

  const {
    status,
    audience,
    role,
    q,
    requesterId,
    vendorId,
    offset,
    limit,
    priority,
  } = parsed.data;

  const where = {
    ...(status !== "all" && {
      status:
        status === "open"
          ? "OPEN"
          : status === "pending"
          ? "PENDING"
          : "CLOSED",
    }),

    // audience: USER / VENDOR / GUEST
    ...(audience !== "all" && {
      audience:
        audience === "user"
          ? "USER"
          : audience === "vendor"
          ? "VENDOR"
          : "GUEST",
    }),

    ...(q && { subject: { contains: q, mode: "insensitive" } }),
    ...(requesterId && { requesterId }),
    ...(vendorId && { vendorId }),

    ...(priority !== "all" && {
      priority:
        priority === "high"
          ? "HIGH"
          : priority === "medium"
          ? "MEDIUM"
          : "LOW",
    }),

    // filtrare după rolul userului (USER / VENDOR / ADMIN)
    ...(role !== "all" && {
      requester: {
        is: {
          role:
            role === "user"
              ? "USER"
              : role === "vendor"
              ? "VENDOR"
              : "ADMIN",
        },
      },
    }),
  };

  try {
    const [total, rows] = await Promise.all([
      prisma.supportTicket.count({ where }),
      prisma.supportTicket.findMany({
        where,
        orderBy: [{ lastMessageAt: "desc" }, { updatedAt: "desc" }],
        skip: offset,
        take: limit,
        select: {
          id: true,
          subject: true,
          status: true,
          priority: true,
          updatedAt: true,
          audience: true,
          requesterName: true,
          requesterEmail: true,
          requester: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
              role: true,
            },
          },
          vendor: {
            select: {
              id: true,
              displayName: true,
            },
          },
        },
      }),
    ]);

    const items = rows.map(mapTicketToUI);
    const nextOffset = offset + items.length;
    res.json({ items, total, hasMore: nextOffset < total, nextOffset });
  } catch (e) {
    console.error("admin/support tickets error:", e);
    res.status(500).json({ error: "server_error" });
  }
});

/**
 * PATCH /api/admin/support/tickets/:id
 * - schimbă status / priority (sau ambele)
 * 🔔 notifică userul dacă este tichet de tip USER și se schimbă statusul
 */
AdminSupportRoutes.patch("/tickets/:id", async (req, res) => {
  const parsedParams = paramsTicketId.safeParse(req.params);
  const parsedBody = bodyUpdateTicket.safeParse(req.body);

  if (!parsedParams.success || !parsedBody.success) {
    return res.status(400).json({ error: "bad_request" });
  }

  const { id } = parsedParams.data;
  const { status, priority } = parsedBody.data;

  if (!status && !priority) {
    return res.status(400).json({ error: "nothing_to_update" });
  }

  try {
    const ticket = await prisma.supportTicket.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!ticket) return res.status(404).json({ error: "not_found" });

    const data = {
      updatedAt: new Date(),
      ...(status && {
        status:
          status === "open"
            ? "OPEN"
            : status === "pending"
            ? "PENDING"
            : "CLOSED",
      }),
      ...(priority && {
        priority:
          priority === "high"
            ? "HIGH"
            : priority === "medium"
            ? "MEDIUM"
            : "LOW",
      }),
    };

    const updated = await prisma.supportTicket.update({
      where: { id },
      data,
      select: {
        id: true,
        subject: true,
        status: true,
        priority: true,
        updatedAt: true,
        audience: true,
        requesterName: true,
        requesterEmail: true,
        requester: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            role: true,
          },
        },
        vendor: {
          select: {
            id: true,
            displayName: true,
          },
        },
      },
    });

    // 🔔 notificăm doar userii finali (audience=USER)
    if (updated.audience === "USER") {
      try {
        await notifyUserOnSupportStatusChange(updated.id, updated.status);
      } catch (err) {
        console.error(
          "admin/support notify user on status change error:",
          err
        );
      }
    }

    res.json(mapTicketToUI(updated));
  } catch (e) {
    console.error("admin/support patch ticket error:", e);
    res.status(500).json({ error: "server_error" });
  }
});

/**
 * DELETE /api/admin/support/tickets/:id
 */
AdminSupportRoutes.delete("/tickets/:id", async (req, res) => {
  const parsedParams = paramsTicketId.safeParse(req.params);
  if (!parsedParams.success)
    return res.status(400).json({ error: "bad_request" });
  const { id } = parsedParams.data;

  try {
    const exists = await prisma.supportTicket.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!exists) return res.status(404).json({ error: "not_found" });

    await prisma.$transaction(async (tx) => {
      await tx.supportAttachment.deleteMany({ where: { ticketId: id } });
      await tx.supportRead.deleteMany({ where: { ticketId: id } });
      await tx.supportMessage.deleteMany({ where: { ticketId: id } });
      await tx.supportTicket.delete({ where: { id } });
    });

    res.json({ ok: true });
  } catch (e) {
    console.error("admin/support delete ticket error:", e);
    res.status(500).json({ error: "server_error" });
  }
});

/**
 * GET /api/admin/support/tickets/:id/messages
 */
AdminSupportRoutes.get("/tickets/:id/messages", async (req, res) => {
  const adminId = req.user?.sub ?? null;

  const parsedParams = paramsTicketId.safeParse(req.params);
  const parsedQuery = qMessages.safeParse(req.query);
  if (!parsedParams.success || !parsedQuery.success) {
    return res.status(400).json({ error: "bad_request" });
  }
  const { id } = parsedParams.data;
  const { offset, limit } = parsedQuery.data;

  try {
    const ticket = await prisma.supportTicket.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!ticket) return res.status(404).json({ error: "not_found" });

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
          attachments: {
            select: { url: true, filename: true, mime: true },
          },
        },
      }),
    ]);

    const items = rows.map((m) => ({
      id: m.id,
      ticketId: id,
      from: m.system ? "them" : m.authorId === adminId ? "me" : "them",
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
    console.error("admin/support get messages error:", e);
    res.status(500).json({ error: "server_error" });
  }
});

/**
 * POST /api/admin/support/tickets/:id/messages
 * 🔔 trimite notificări user + email la guest
 */
AdminSupportRoutes.post("/tickets/:id/messages", async (req, res) => {
  const admin = req.user;
  const adminId = req.user?.sub;

  if (!admin || !adminId || !isAdminReq(req)) {
    return res.status(403).json({ error: "forbidden" });
  }

  const parsedParams = paramsTicketId.safeParse(req.params);
  const parsedBody = bodyMessage.safeParse(req.body);
  if (!parsedParams.success || !parsedBody.success) {
    return res.status(400).json({ error: "bad_request" });
  }
  const { id } = parsedParams.data;
  const { body, attachments } = parsedBody.data;

  const cleanBody = (body || "").trim() || "(fișier)";

  try {
    const ticket = await prisma.supportTicket.findUnique({
      where: { id },
      select: {
        id: true,
        audience: true,
        requesterId: true,
        requesterEmail: true,
        requesterName: true,
        subject: true,
      },
    });
    if (!ticket) return res.status(404).json({ error: "not_found" });

    await prisma.$transaction(async (tx) => {
      const msg = await tx.supportMessage.create({
        data: {
          ticketId: id,
          authorId: adminId,
          body: cleanBody,
        },
        select: { id: true },
      });

      if (attachments?.length) {
        await tx.supportAttachment.createMany({
          data: attachments.map((a, idx) => ({
            ticketId: id,
            messageId: msg.id,
            url: a.url,
            filename:
              a.name ??
              a.filename ??
              `attachment-${idx + 1}`,
            mime: a.mimeType ?? a.mime ?? null,
            size: a.size ?? null,
          })),
        });
      }

      await tx.supportTicket.update({
        where: { id },
        data: {
          lastMessageAt: new Date(),
          updatedAt: new Date(),
          status: "OPEN",
        },
      });

      try {
        await tx.supportRead.upsert({
          where: {
            ticketId_userId: {
              ticketId: id,
              userId: adminId,
            },
          },
          update: { lastReadAt: new Date() },
          create: {
            ticketId: id,
            userId: adminId,
            lastReadAt: new Date(),
          },
        });
      } catch (err) {
        console.error("admin/support upsert read failed:", err);
      }
    });

    // ✉️ dacă e GUEST → trimitem email cu răspunsul
    if (ticket.audience === "GUEST" && ticket.requesterEmail) {
      try {
        await sendGuestSupportReplyEmail({
          to: ticket.requesterEmail,
          name: ticket.requesterName || "",
          subject: ticket.subject || "Tichet suport",
          reply: cleanBody,
        });
      } catch (err) {
        console.error("admin/support guest reply email failed:", err);
      }
    }

    // 🔔 dacă e USER logat → notificări în app
    if (ticket.audience === "USER" && ticket.requesterId) {
      try {
        await notifyUserOnSupportReply(ticket.id, {
          messagePreview: cleanBody,
        });
        await notifyUserOnSupportStatusChange(ticket.id, "OPEN");
      } catch (err) {
        console.error("admin/support notify user on reply error:", err);
      }
    }

    res.status(201).json({ ok: true });
  } catch (e) {
    console.error("admin/support post message error:", e);
    res.status(500).json({ error: "server_error" });
  }
});

/**
 * PATCH /api/admin/support/messages/:mid
 */
AdminSupportRoutes.patch("/messages/:mid", async (req, res) => {
  if (!isAdminReq(req)) {
    return res.status(403).json({ error: "forbidden" });
  }

  const parsedParams = paramsMessageId.safeParse(req.params);
  const parsedBody = bodyEditMessage.safeParse(req.body);
  if (!parsedParams.success || !parsedBody.success) {
    return res.status(400).json({ error: "bad_request" });
  }
  const { mid } = parsedParams.data;
  const { body } = parsedBody.data;

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
      data: {
        lastMessageAt: last?.createdAt ?? new Date(),
        updatedAt: new Date(),
      },
    });

    res.json({ ok: true });
  } catch (e) {
    console.error("admin/support edit message error:", e);
    res.status(500).json({ error: "server_error" });
  }
});

/**
 * DELETE /api/admin/support/messages/:mid
 */
AdminSupportRoutes.delete("/messages/:mid", async (req, res) => {
  if (!isAdminReq(req)) {
    return res.status(403).json({ error: "forbidden" });
  }

  const parsedParams = paramsMessageId.safeParse(req.params);
  if (!parsedParams.success) {
    return res.status(400).json({ error: "bad_request" });
  }
  const { mid } = parsedParams.data;

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
        data: {
          lastMessageAt: last?.createdAt ?? new Date(),
          updatedAt: new Date(),
        },
      });
    });

    res.json({ ok: true });
  } catch (e) {
    console.error("admin/support delete message error:", e);
    res.status(500).json({ error: "server_error" });
  }
});

/**
 * PATCH /api/admin/support/tickets/:id/read
 */
AdminSupportRoutes.patch("/tickets/:id/read", async (req, res) => {
  const admin = req.user;
  const adminId = req.user?.sub;

  if (!admin || !adminId || !isAdminReq(req)) {
    return res.status(403).json({ error: "forbidden" });
  }

  const parsedParams = paramsTicketId.safeParse(req.params);
  if (!parsedParams.success) {
    return res.status(400).json({ error: "bad_request" });
  }
  const { id } = parsedParams.data;

  try {
    const ticket = await prisma.supportTicket.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!ticket) return res.status(404).json({ error: "not_found" });

    try {
      await prisma.supportRead.upsert({
        where: {
          ticketId_userId: { ticketId: id, userId: adminId },
        },
        update: { lastReadAt: new Date() },
        create: {
          ticketId: id,
          userId: adminId,
          lastReadAt: new Date(),
        },
      });
    } catch (err) {
      console.error("admin/support mark read upsert failed:", err);
    }

    res.json({ ok: true });
  } catch (e) {
    console.error("admin/support mark read error:", e);
    res.status(500).json({ error: "server_error" });
  }
});

/**
 * GET /api/admin/support/faqs
 */
AdminSupportRoutes.get("/faqs", async (req, res) => {
  const q = (req.query.q ?? "").toString();

  try {
    const items = await prisma.supportFaq.findMany({
      where: {
        isActive: true,
        ...(q
          ? {
              OR: [
                { q: { contains: q, mode: "insensitive" } },
                { a: { contains: q, mode: "insensitive" } },
                {
                  tags: {
                    hasSome: q
                      .toLowerCase()
                      .split(/\s+/)
                      .filter(Boolean),
                  },
                },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    res.json({ items });
  } catch (e) {
    console.error("admin/support faqs error:", e);
    res.status(500).json({ error: "server_error" });
  }
});

/**
 * GET /api/admin/support/unread-count
 */
AdminSupportRoutes.get("/unread-count", async (req, res) => {
  const admin = req.user;
  const adminId = req.user?.sub;

  if (!admin || !adminId || !isAdminReq(req)) {
    return res.status(403).json({ error: "forbidden" });
  }

  try {
    const tickets = await prisma.supportTicket.findMany({
      select: {
        id: true,
        lastMessageAt: true,
        reads: {
          where: { userId: adminId },
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
    console.error("admin/support unread-count error:", e);
    res.status(500).json({ error: "server_error" });
  }
});

export default AdminSupportRoutes;
