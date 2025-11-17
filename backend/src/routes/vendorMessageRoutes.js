// backend/routes/vendorMessagesRoutes.js
import express from "express";
import { prisma } from "../db.js"; // folosește prisma global, ca în restul proiectului
import { authRequired, enforceTokenVersion, requireRole } from "../api/auth.js";

const router = express.Router();

/**
 * Toate rutele de aici:
 * - necesită user logat
 * - verifică tokenVersion
 * - necesită rol VENDOR
 */
router.use(authRequired, enforceTokenVersion, requireRole("VENDOR"));

// helper: obține vendorId pentru userul logat (la fel ca în vendorNotificationsRoutes)
async function getVendorIdForUser(req) {
  // dacă pe viitor pui vendorId direct în JWT, îl poți folosi:
  if (req.user.vendorId) return req.user.vendorId;

  const vendor = await prisma.vendor.findUnique({
    where: { userId: req.user.sub },
    select: { id: true },
  });
  return vendor?.id || null;
}

/**
 * GET /api/unread-count
 * -> numărul total de mesaje necitite pentru vendor (pentru badge în Navbar)
 */
router.get("/unread-count", async (req, res) => {
  const vendorId = await getVendorIdForUser(req);
  if (!vendorId) return res.json({ count: 0 });

  // luăm toate thread-urile active ale vendorului
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

  // folosim aceeași logică de unread ca în GET /threads
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
 * GET /api/threads?scope=all|unread|archived&q=...
 */
router.get("/threads", async (req, res) => {
  const vendorId = await getVendorIdForUser(req);
  if (!vendorId) return res.status(403).json({ error: "no_vendor_for_user" });

  const { scope = "all", q = "" } = req.query;

  const where = {
    vendorId,
    archived: scope === "archived" ? true : scope === "all" ? false : undefined,
    OR: q
      ? [
          { contactName: { contains: String(q), mode: "insensitive" } },
          { contactEmail: { contains: String(q), mode: "insensitive" } },
          { contactPhone: { contains: String(q), mode: "insensitive" } },
          { lastMsg: { contains: String(q), mode: "insensitive" } },
          {
            user: {
              OR: [
                { firstName: { contains: String(q), mode: "insensitive" } },
                { lastName: { contains: String(q), mode: "insensitive" } },
                { email: { contains: String(q), mode: "insensitive" } },
              ],
            },
          },
        ]
      : undefined,
  };

  const threads = await prisma.messageThread.findMany({
    where,
    orderBy: [{ lastAt: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      contactName: true,
      contactPhone: true,
      lastMsg: true,
      lastAt: true,
      vendorLastReadAt: true,
      archived: true,
      user: { select: { firstName: true, lastName: true } },
    },
  });

  const items = await Promise.all(
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

      const userName = t.user
        ? [t.user.firstName, t.user.lastName].filter(Boolean).join(" ")
        : null;

      return {
        id: t.id,
        name: userName || t.contactName || "Vizitator",
        phone: t.contactPhone || null,
        lastMsg: t.lastMsg || null,
        lastAt: t.lastAt,
        unreadCount,
        archived: t.archived,
      };
    })
  );

  res.json({ items });
});

/**
 * GET /api/threads/:id/messages
 */
router.get("/threads/:id/messages", async (req, res) => {
  const vendorId = await getVendorIdForUser(req);
  if (!vendorId) return res.status(403).json({ error: "no_vendor_for_user" });

  const { id } = req.params;

  const thread = await prisma.messageThread.findFirst({
    where: { id, vendorId },
  });
  if (!thread) return res.status(404).json({ error: "Thread not found" });

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
    },
  });

  const items = msgs.map((m) => {
    const authorName =
      m.authorType === "VISITOR"
        ? m.authorName || "Vizitator"
        : [m.authorUser?.firstName, m.authorUser?.lastName]
            .filter(Boolean)
            .join(" ") ||
          m.authorName ||
          "Utilizator";

    return {
      id: m.id,
      threadId: id,
      from: m.authorType === "VENDOR" ? "me" : "them",
      authorName: m.authorType === "VENDOR" ? undefined : authorName,
      body: m.body,
      createdAt: m.createdAt,
    };
  });

  res.json({ items });
});

/**
 * PATCH /api/threads/:id/read
 */
router.patch("/threads/:id/read", async (req, res) => {
  const vendorId = await getVendorIdForUser(req);
  if (!vendorId) return res.status(403).json({ error: "no_vendor_for_user" });

  const { id } = req.params;

  const thread = await prisma.messageThread.findFirst({
    where: { id, vendorId },
  });
  if (!thread) return res.status(404).json({ error: "Thread not found" });

  await prisma.messageThread.update({
    where: { id },
    data: { vendorLastReadAt: new Date() },
  });

  res.json({ ok: true });
});

/**
 * POST /api/threads/:id/messages  -> vendor trimite răspuns
 */
router.post("/threads/:id/messages", async (req, res) => {
  const vendorId = await getVendorIdForUser(req);
  if (!vendorId) return res.status(403).json({ error: "no_vendor_for_user" });

  const { id } = req.params;
  const { body } = req.body || {};

  if (!body || !String(body).trim()) {
    return res.status(400).json({ error: "Mesajul nu poate fi gol" });
  }

  const thread = await prisma.messageThread.findFirst({
    where: { id, vendorId },
  });
  if (!thread) return res.status(404).json({ error: "Thread not found" });

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

  res
    .status(201)
    .json({ ok: true, id: msg.id, createdAt: msg.createdAt });
});

/**
 * PATCH /api/threads/:id/archive
 */
router.patch("/threads/:id/archive", async (req, res) => {
  const vendorId = await getVendorIdForUser(req);
  if (!vendorId) return res.status(403).json({ error: "no_vendor_for_user" });

  const { id } = req.params;
  const { archived = true } = req.body || {};

  const thread = await prisma.messageThread.findFirst({
    where: { id, vendorId },
  });
  if (!thread) return res.status(404).json({ error: "Thread not found" });

  await prisma.messageThread.update({
    where: { id },
    data: { archived: !!archived },
  });

  res.json({ ok: true });
});

export default router;
