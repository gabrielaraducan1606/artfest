// backend/src/routes/vendorInboxRoutes.js
import express from "express";
import { prisma } from "../db.js";
import {
  authRequired,
  enforceTokenVersion,
  requireRole,
} from "../api/auth.js";
import { createUserNotification } from "../services/notifications.js"; // 🔔

const router = express.Router();

/**
 * Toate rutele de aici:
 * - necesită user logat
 * - verifică tokenVersion
 * - necesită rol VENDOR
 */
router.use(authRequired, enforceTokenVersion, requireRole("VENDOR"));

// helper: obține vendorId pentru userul logat
async function getVendorIdForUser(req) {
  if (req.user.vendorId) return req.user.vendorId;

  const vendor = await prisma.vendor.findUnique({
    where: { userId: req.user.sub },
    select: { id: true },
  });
  return vendor?.id || null;
}

// helper: mapare string UI -> LeadStatus enum
function mapStatusFilterToEnum(status) {
  if (!status || status === "all") return undefined;
  switch (status) {
    case "nou":
      return "NEW";
    case "in_discutii":
      return "IN_DISCUSSION";
    case "oferta_trimisa":
      return "OFFER_SENT";
    case "rezervat":
      return "RESERVED";
    case "pierdut":
      return "LOST";
    default:
      return undefined;
  }
}

/**
 * GET /api/inbox/unread-count
 */
router.get("/unread-count", async (req, res) => {
  const vendorId = await getVendorIdForUser(req);
  if (!vendorId) return res.json({ count: 0 });

  const threads = await prisma.messageThread.findMany({
    where: {
      vendorId,
      archived: false,
    },
    select: {
      id: true,
      vendorLastReadAt: true,
    },
  });

  let totalUnread = 0;

  // simplu, dar nu foarte eficient; dacă devine problemă, îl optimizezi cu aggregation
  for (const t of threads) {
    const unreadCount = await prisma.message.count({
      where: {
        threadId: t.id,
        NOT: { authorType: "VENDOR" },
        ...(t.vendorLastReadAt
          ? { createdAt: { gt: t.vendorLastReadAt } }
          : {}),
      },
    });
    totalUnread += unreadCount;
  }

  res.json({ count: totalUnread });
});

/**
 * GET /api/inbox/threads?scope=all|unread|archived&q=&status=&eventType=&period=&groupBy=
 *
 * period:
 *  - all (default)
 *  - next_30 (eventDate in următoarele 30 zile)
 *  - past (eventDate < azi)
 *
 * groupBy:
 *  - order (default, 1 thread = 1 comandă/lead)
 *  - user  (agregăm toate thread-urile cu același userId și expunem threads:[])
 */
router.get("/threads", async (req, res) => {
  const vendorId = await getVendorIdForUser(req);
  if (!vendorId)
    return res.status(403).json({ error: "no_vendor_for_user" });

  const {
    scope = "all",
    q = "",
    status = "all",
    eventType,
    period = "all",
    groupBy = "order",
  } = req.query;

  const where = {
    vendorId,
    archived:
      scope === "archived"
        ? true
        : scope === "all"
        ? false
        : undefined,
    OR: q
      ? [
          {
            contactName: {
              contains: String(q),
              mode: "insensitive",
            },
          },
          {
            contactEmail: {
              contains: String(q),
              mode: "insensitive",
            },
          },
          {
            contactPhone: {
              contains: String(q),
              mode: "insensitive",
            },
          },
          {
            lastMsg: {
              contains: String(q),
              mode: "insensitive",
            },
          },
          {
            user: {
              OR: [
                {
                  firstName: {
                    contains: String(q),
                    mode: "insensitive",
                  },
                },
                {
                  lastName: {
                    contains: String(q),
                    mode: "insensitive",
                  },
                },
                {
                  email: {
                    contains: String(q),
                    mode: "insensitive",
                  },
                },
              ],
            },
          },
        ]
      : undefined,
  };

  // filtru status lead
  const statusEnum = mapStatusFilterToEnum(status);
  if (statusEnum) {
    where.leadStatus = statusEnum;
  }

  // filtru tip eveniment
  if (eventType && eventType !== "all") {
    where.eventType = String(eventType);
  }

  // filtru perioadă (după data evenimentului)
  const now = new Date();
  if (period === "next_30") {
    const in30 = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    where.eventDate = {
      gte: now,
      lte: in30,
    };
  } else if (period === "past") {
    where.eventDate = {
      lt: now,
    };
  }

  const threads = await prisma.messageThread.findMany({
    where,
    orderBy: [{ lastAt: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      userId: true,
      contactName: true,
      contactPhone: true,
      contactEmail: true,
      lastMsg: true,
      lastAt: true,
      vendorLastReadAt: true,
      archived: true,
      user: { select: { firstName: true, lastName: true } },

      // pentru UI
      eventDate: true,
      eventType: true,
      eventLocation: true,
      budgetMin: true,
      budgetMax: true,
      leadStatus: true,
      tags: true,
      followUpAt: true,
      internalNote: true,
      order: {
        select: {
          id: true,
          status: true,
          createdAt: true,
          shipments: {
            select: {
              id: true,
              status: true,
              pickupDate: true,
              pickupSlotStart: true,
              pickupSlotEnd: true,
            },
          },
        },
      },
    },
  });

  // calculăm unreadCount pentru fiecare thread
  const threadsWithUnread = await Promise.all(
    threads.map(async (t) => {
      const unreadCount = await prisma.message.count({
        where: {
          threadId: t.id,
          NOT: { authorType: "VENDOR" },
          ...(t.vendorLastReadAt
            ? { createdAt: { gt: t.vendorLastReadAt } }
            : {}),
        },
      });
      return { ...t, unreadCount };
    })
  );

  // helper status enum -> string UI
  const leadEnumToUi = (leadStatus) => {
    let statusUi = "nou";
    switch (leadStatus) {
      case "IN_DISCUSSION":
        statusUi = "in_discutii";
        break;
      case "OFFER_SENT":
        statusUi = "oferta_trimisa";
        break;
      case "RESERVED":
        statusUi = "rezervat";
        break;
      case "LOST":
        statusUi = "pierdut";
        break;
      case "NEW":
      default:
        statusUi = "nou";
    }
    return statusUi;
  };

  // ==============================
  // 🔵 MOD NORMAL (per comandă / thread)
  // ==============================
  if (groupBy !== "user") {
    const items = threadsWithUnread.map((t) => {
      const userName = t.user
        ? [t.user.firstName, t.user.lastName]
            .filter(Boolean)
            .join(" ")
        : null;

      const statusUi = leadEnumToUi(t.leadStatus);

      return {
        id: t.id,
        threadId: t.id,
        userId: t.userId,
        name: userName || t.contactName || "Vizitator",
        phone: t.contactPhone || null,
        lastMsg: t.lastMsg || null,
        lastAt: t.lastAt,
        unreadCount: t.unreadCount,
        archived: t.archived,

        eventDate: t.eventDate,
        eventType: t.eventType,
        eventLocation: t.eventLocation,
        budgetMin: t.budgetMin,
        budgetMax: t.budgetMax,
        status: statusUi,
        tags: t.tags || [],
        followUpAt: t.followUpAt,
        orderSummary: t.order
          ? {
              id: t.order.id,
              status: t.order.status,
              createdAt: t.order.createdAt,
              shipments: t.order.shipments,
            }
          : null,
        internalNote: t.internalNote || "",
      };
    });

    return res.json({ items });
  }

  // ==============================
  // 🟢 MOD GRUPARE PE USER (userId)
  // ==============================
  const grouped = new Map();

  for (const t of threadsWithUnread) {
    const hasUser = !!t.userId;
    const key = hasUser ? `user:${t.userId}` : `thread:${t.id}`;

    if (!grouped.has(key)) {
      grouped.set(key, {
        key,
        userId: t.userId || null,
        threads: [],
      });
    }
    grouped.get(key).threads.push(t);
  }

  const items = [];

  for (const [, group] of grouped) {
    const { key, userId, threads: ts } = group;

    // ========================
    // grupare reală pe userId
    // ========================
    if (userId && key.startsWith("user:")) {
      // sortăm thread-urile userului după lastAt desc
      const sorted = ts.slice().sort((a, b) => {
        const da = a.lastAt ? +a.lastAt : 0;
        const db = b.lastAt ? +b.lastAt : 0;
        return db - da;
      });
      const primary = sorted[0];

      const userName = primary.user
        ? [primary.user.firstName, primary.user.lastName]
            .filter(Boolean)
            .join(" ")
        : null;

      const statusUi = leadEnumToUi(primary.leadStatus);

      const totalUnread = ts.reduce(
        (sum, t) => sum + (t.unreadCount || 0),
        0
      );

      const threadsForUser = sorted.map((t) => ({
        threadId: t.id,
        archived: t.archived,
        unreadCount: t.unreadCount || 0,

        eventDate: t.eventDate,
        eventType: t.eventType,
        eventLocation: t.eventLocation,
        budgetMin: t.budgetMin,
        budgetMax: t.budgetMax,
        status: leadEnumToUi(t.leadStatus),
        tags: t.tags || [],
        followUpAt: t.followUpAt,
        internalNote: t.internalNote || "",
        orderSummary: t.order
          ? {
              id: t.order.id,
              status: t.order.status,
              createdAt: t.order.createdAt,
              shipments: t.order.shipments,
            }
          : null,
      }));

      items.push({
        id: key, // ex: "user:<userId>" -> folosit în frontend ca "conversație"
        userId,
        name: userName || primary.contactName || "Vizitator",
        phone: primary.contactPhone || null,
        lastMsg: primary.lastMsg || null,
        lastAt: primary.lastAt,
        unreadCount: totalUnread,
        archived: primary.archived,

        // info agregată / reprezentativă (din primary)
        eventDate: primary.eventDate,
        eventType: primary.eventType,
        eventLocation: primary.eventLocation,
        budgetMin: primary.budgetMin,
        budgetMax: primary.budgetMax,
        status: statusUi,
        tags: primary.tags || [],
        followUpAt: primary.followUpAt,
        orderSummary: primary.order
          ? {
              id: primary.order.id,
              status: primary.order.status,
              createdAt: primary.order.createdAt,
              shipments: primary.order.shipments,
            }
          : null,
        internalNote: primary.internalNote || "",

        // 🧩 nou: lista de thread-uri (comenzi) pentru UI (tab-uri)
        orderCount: threadsForUser.length,
        threads: threadsForUser,
      });
    } else {
      // ========================
      // fallback - fără userId, păstrăm thread-ul individual
      // ========================
      const t = ts[0];
      const userName = t.user
        ? [t.user.firstName, t.user.lastName]
            .filter(Boolean)
            .join(" ")
        : null;

      const statusUi = leadEnumToUi(t.leadStatus);

      items.push({
        id: t.id,
        threadId: t.id,
        userId: t.userId,
        name: userName || t.contactName || "Vizitator",
        phone: t.contactPhone || null,
        lastMsg: t.lastMsg || null,
        lastAt: t.lastAt,
        unreadCount: t.unreadCount,
        archived: t.archived,

        eventDate: t.eventDate,
        eventType: t.eventType,
        eventLocation: t.eventLocation,
        budgetMin: t.budgetMin,
        budgetMax: t.budgetMax,
        status: statusUi,
        tags: t.tags || [],
        followUpAt: t.followUpAt,
        orderSummary: t.order
          ? {
              id: t.order.id,
              status: t.order.status,
              createdAt: t.order.createdAt,
              shipments: t.order.shipments,
            }
          : null,
        internalNote: t.internalNote || "",

        // pentru consistență, un singur "thread" în listă
        orderCount: 1,
        threads: [
          {
            threadId: t.id,
            archived: t.archived,
            unreadCount: t.unreadCount || 0,
            eventDate: t.eventDate,
            eventType: t.eventType,
            eventLocation: t.eventLocation,
            budgetMin: t.budgetMin,
            budgetMax: t.budgetMax,
            status: statusUi,
            tags: t.tags || [],
            followUpAt: t.followUpAt,
            internalNote: t.internalNote || "",
            orderSummary: t.order
              ? {
                  id: t.order.id,
                  status: t.order.status,
                  createdAt: t.order.createdAt,
                  shipments: t.order.shipments,
                }
              : null,
          },
        ],
      });
    }
  }

  // sortăm UI după lastAt desc
  items.sort((a, b) => {
    const da = a.lastAt ? +a.lastAt : 0;
    const db = b.lastAt ? +b.lastAt : 0;
    return db - da;
  });

  return res.json({ items });
});

/**
 * GET /api/inbox/threads/:id/messages
 */
router.get("/threads/:id/messages", async (req, res) => {
  const vendorId = await getVendorIdForUser(req);
  if (!vendorId)
    return res.status(403).json({ error: "no_vendor_for_user" });

  const { id } = req.params;

  const thread = await prisma.messageThread.findFirst({
    where: { id, vendorId },
    select: {
      id: true,
      userLastReadAt: true, // folosit pentru read receipts din perspectiva vendorului
    },
  });
  if (!thread)
    return res.status(404).json({ error: "Thread not found" });

  const msgs = await prisma.message.findMany({
    where: { threadId: id },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      body: true,
      createdAt: true,
      authorType: true,
      authorName: true,
      authorUser: { select: { firstName: true, lastName: true } },
      attachments: {
        select: {
          id: true,
          filename: true,
          url: true,
          size: true,
          mime: true,
        },
      },
    },
  });

  const items = msgs.map((m) => {
    const isVendor = m.authorType === "VENDOR";
    const from = isVendor ? "me" : "them";

    const authorName =
      m.authorType === "VISITOR"
        ? m.authorName || "Vizitator"
        : [m.authorUser?.firstName, m.authorUser?.lastName]
            .filter(Boolean)
            .join(" ") ||
          m.authorName ||
          "Utilizator";

    const readByPeer =
      from === "me" &&
      thread.userLastReadAt &&
      m.createdAt <= thread.userLastReadAt;

    return {
      id: m.id,
      threadId: id,
      from,
      authorName: isVendor ? undefined : authorName,
      body: m.body,
      createdAt: m.createdAt,
      readByPeer,
      attachments: m.attachments?.map((a) => ({
        id: a.id,
        name: a.filename,
        url: a.url,
        size: a.size,
        mime: a.mime,
      })),
    };
  });

  res.json({ items });
});

/**
 * GET /api/inbox/user-conversations/:userId/messages
 * - (rămâne disponibil, dar nu mai e necesar dacă folosești taburi per comandă)
 */
router.get("/user-conversations/:userId/messages", async (req, res) => {
  const vendorId = await getVendorIdForUser(req);
  if (!vendorId)
    return res.status(403).json({ error: "no_vendor_for_user" });

  const userId = String(req.params.userId || "");
  if (!userId) {
    return res.status(400).json({ error: "missing_user_id" });
  }

  const threads = await prisma.messageThread.findMany({
    where: {
      vendorId,
      userId,
    },
    select: {
      id: true,
      userLastReadAt: true,
      order: {
        select: {
          id: true,
          shipments: {
            select: {
              id: true,
            },
          },
        },
      },
    },
  });

  if (!threads.length) {
    return res.json({ items: [] });
  }

  const threadIds = threads.map((t) => t.id);

  const msgs = await prisma.message.findMany({
    where: { threadId: { in: threadIds } },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      threadId: true,
      body: true,
      createdAt: true,
      authorType: true,
      authorName: true,
      authorUser: { select: { firstName: true, lastName: true } },
      attachments: {
        select: {
          id: true,
          filename: true,
          url: true,
          size: true,
          mime: true,
        },
      },
    },
  });

  const threadMetaById = new Map(threads.map((t) => [t.id, t]));

  const items = msgs.map((m) => {
    const isVendor = m.authorType === "VENDOR";
    const from = isVendor ? "me" : "them";
    const meta = threadMetaById.get(m.threadId);

    const authorName =
      m.authorType === "VISITOR"
        ? m.authorName || "Vizitator"
        : [m.authorUser?.firstName, m.authorUser?.lastName]
            .filter(Boolean)
            .join(" ") ||
          m.authorName ||
          "Utilizator";

    const readByPeer =
      from === "me" &&
      meta?.userLastReadAt &&
      m.createdAt <= meta.userLastReadAt;

    const order = meta?.order;
    const shipment = order?.shipments?.[0];
    const baseId = shipment?.id || order?.id || null;
    const orderShortId = baseId
      ? baseId.slice(-6).toUpperCase()
      : null;

    return {
      id: m.id,
      threadId: m.threadId,
      from,
      authorName: isVendor ? undefined : authorName,
      body: m.body,
      createdAt: m.createdAt,
      readByPeer,
      orderId: order?.id || null,
      orderShortId,
      attachments: m.attachments?.map((a) => ({
        id: a.id,
        name: a.filename,
        url: a.url,
        size: a.size,
        mime: a.mime,
      })),
    };
  });

  res.json({ items });
});

/**
 * PATCH /api/inbox/threads/:id/read
 */
router.patch("/threads/:id/read", async (req, res) => {
  const vendorId = await getVendorIdForUser(req);
  if (!vendorId)
    return res.status(403).json({ error: "no_vendor_for_user" });

  const { id } = req.params;

  const thread = await prisma.messageThread.findFirst({
    where: { id, vendorId },
  });
  if (!thread)
    return res.status(404).json({ error: "Thread not found" });

  await prisma.messageThread.update({
    where: { id },
    data: { vendorLastReadAt: new Date() },
  });

  res.json({ ok: true });
});

/**
 * POST /api/inbox/threads/:id/messages  -> vendor trimite răspuns
 */
router.post("/threads/:id/messages", async (req, res) => {
  const vendorId = await getVendorIdForUser(req);
  if (!vendorId)
    return res.status(403).json({ error: "no_vendor_for_user" });

  const { id } = req.params;
  const { body } = req.body || {};

  if (!body || !String(body).trim()) {
    return res.status(400).json({ error: "Mesajul nu poate fi gol" });
  }

  const thread = await prisma.messageThread.findFirst({
    where: { id, vendorId },
    select: {
      id: true,
      userId: true,
      vendor: {
        select: { displayName: true },
      },
    },
  });
  if (!thread)
    return res.status(404).json({ error: "Thread not found" });

  const msg = await prisma.message.create({
    data: {
      threadId: id,
      body: String(body).trim(),
      authorType: "VENDOR",
    },
  });

  await prisma.messageThread.update({
    where: { id },
    data: {
      lastMsg: msg.body,
      lastAt: msg.createdAt,
      vendorLastReadAt: new Date(),
    },
  });

  // 🔔 notificare pentru USER
  // 🔔 notificare pentru USER
try {
  if (thread.userId) {
    await createUserNotification(thread.userId, {
      type: "message",
      title: `Mesaj nou de la ${thread.vendor?.displayName || "vendor"}`,
      body: msg.body.slice(0, 140),
      // ducem userul în pagina de mesaje + thread selectat
      link: `/cont/mesaje?threadId=${thread.id}`,
    });
  }
} catch (e) {
  console.error("Nu am putut crea notificarea pentru user (mesaj nou):", e);
}

  res.status(201).json({ ok: true, id: msg.id, createdAt: msg.createdAt });
});

/**
 * PATCH /api/inbox/threads/:id/archive
 */
router.patch("/threads/:id/archive", async (req, res) => {
  const vendorId = await getVendorIdForUser(req);
  if (!vendorId)
    return res.status(403).json({ error: "no_vendor_for_user" });

  const { id } = req.params;
  const { archived = true } = req.body || {};

  const thread = await prisma.messageThread.findFirst({
    where: { id, vendorId },
  });
  if (!thread)
    return res.status(404).json({ error: "Thread not found" });

  await prisma.messageThread.update({
    where: { id },
    data: { archived: !!archived },
  });

  res.json({ ok: true });
});

/**
 * PATCH /api/inbox/threads/:id/meta
 * - update lead status, tags, follow-up, notă internă, info eveniment
 */
router.patch("/threads/:id/meta", async (req, res) => {
  const vendorId = await getVendorIdForUser(req);
  if (!vendorId)
    return res.status(403).json({ error: "no_vendor_for_user" });

  const { id } = req.params;
  const {
    status,
    tags,
    followUpAt,
    internalNote,
    eventDate,
    eventType,
    eventLocation,
    budgetMin,
    budgetMax,
  } = req.body || {};

  const thread = await prisma.messageThread.findFirst({
    where: { id, vendorId },
  });
  if (!thread)
    return res.status(404).json({ error: "Thread not found" });

  const data = {};

  // status lead
  if (typeof status === "string") {
    const enumVal = mapStatusFilterToEnum(status);
    if (enumVal) {
      data.leadStatus = enumVal;
    }
  }

  // tags
  if (Array.isArray(tags)) {
    data.tags = tags
      .map((t) => String(t).trim())
      .filter(Boolean);
  }

  // follow-up
  if (followUpAt === null) {
    data.followUpAt = null;
  } else if (followUpAt) {
    const d = new Date(followUpAt);
    if (!isNaN(d)) data.followUpAt = d;
  }

  // notă internă
  if (typeof internalNote === "string") {
    data.internalNote = internalNote;
  }

  // info eveniment
  if (eventDate === null) {
    data.eventDate = null;
  } else if (eventDate) {
    const d = new Date(eventDate);
    if (!isNaN(d)) data.eventDate = d;
  }
  if (typeof eventType === "string") {
    data.eventType = eventType || null;
  }
  if (typeof eventLocation === "string") {
    data.eventLocation = eventLocation || null;
  }
  if (budgetMin !== undefined) {
    const v = Number(budgetMin);
    data.budgetMin = Number.isFinite(v) ? v : null;
  }
  if (budgetMax !== undefined) {
    const v = Number(budgetMax);
    data.budgetMax = Number.isFinite(v) ? v : null;
  }

  await prisma.messageThread.update({
    where: { id },
    data,
  });

  res.json({ ok: true });
});

/**
 * GET /api/inbox/planning/leads?from=2025-01-01&to=2025-12-31
 */
router.get("/planning/leads", async (req, res) => {
  const vendorId = await getVendorIdForUser(req);
  if (!vendorId)
    return res.status(403).json({ error: "no_vendor_for_user" });

  const { from, to } = req.query;
  const now = new Date();
  const defaultFrom = now;
  const defaultTo = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);

  const fromDate = from ? new Date(from) : defaultFrom;
  const toDate = to ? new Date(to) : defaultTo;

  const threads = await prisma.messageThread.findMany({
    where: {
      vendorId,
      eventDate: {
        gte: fromDate,
        lte: toDate,
      },
      archived: false,
    },
    orderBy: [{ eventDate: "asc" }, { lastAt: "desc" }],
    select: {
      id: true,
      eventDate: true,
      eventType: true,
      eventLocation: true,
      budgetMin: true,
      budgetMax: true,
      leadStatus: true,
      contactName: true,
      contactPhone: true,
      user: {
        select: { firstName: true, lastName: true },
      },
      order: {
        select: {
          id: true,
          status: true,
          createdAt: true,
          shipments: {
            select: {
              id: true,
              status: true,
              pickupDate: true,
              pickupSlotStart: true,
              pickupSlotEnd: true,
            },
          },
        },
      },
    },
  });

  const items = threads.map((t) => {
    const userName = t.user
      ? [t.user.firstName, t.user.lastName].filter(Boolean).join(" ")
      : null;

    let statusUi = "nou";
    switch (t.leadStatus) {
      case "IN_DISCUSSION":
        statusUi = "in_discutii";
        break;
      case "OFFER_SENT":
        statusUi = "oferta_trimisa";
        break;
      case "RESERVED":
        statusUi = "rezervat";
        break;
      case "LOST":
        statusUi = "pierdut";
        break;
      case "NEW":
      default:
        statusUi = "nou";
    }

    return {
      id: t.id,
      name: userName || t.contactName || "Vizitator",
      phone: t.contactPhone || null,
      eventDate: t.eventDate,
      eventType: t.eventType,
      eventLocation: t.eventLocation,
      budgetMin: t.budgetMin,
      budgetMax: t.budgetMax,
      status: statusUi,
      order: t.order
        ? {
            id: t.order.id,
            status: t.order.status,
            createdAt: t.order.createdAt,
            shipments: t.order.shipments,
          }
        : null,
    };
  });

  res.json({ items });
});

/**
 * POST /api/inbox/ensure-thread-from-order/:orderId
 * - pornește sau recuperează conversația legată de o comandă
 */
router.post("/ensure-thread-from-order/:orderId", async (req, res) => {
  const vendorId = await getVendorIdForUser(req);
  if (!vendorId) {
    return res.status(403).json({ error: "no_vendor_for_user" });
  }

  const orderId = String(req.params.orderId || "");

  if (!orderId) {
    return res.status(400).json({ error: "missing_order_id" });
  }

  // găsim shipment-ul pentru vendorul curent + comanda respectivă
  const shipment = await prisma.shipment.findFirst({
    where: {
      orderId,
      vendorId,
    },
    include: {
      order: true,
    },
  });

  if (!shipment || !shipment.order) {
    return res
      .status(404)
      .json({ error: "order_not_found_for_vendor" });
  }

  const order = shipment.order;
  const shipping = order.shippingAddress || {};
  const userId = order.userId || null;

  // căutăm un thread existent pentru vendor + comandă + user
  let thread = await prisma.messageThread.findFirst({
    where: {
      vendorId,
      orderId: order.id,
      userId,
    },
  });

  // dacă nu există, îl creăm
  if (!thread) {
    thread = await prisma.messageThread.create({
      data: {
        vendorId,
        userId,
        orderId: order.id,
        contactName: shipping.name || null,
        contactEmail: shipping.email || null,
        contactPhone: shipping.phone || null,
      },
    });
  }

  return res.json({
    ok: true,
    threadId: thread.id,
  });
});

export default router;
