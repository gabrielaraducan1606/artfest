import express from "express";
import { prisma } from "../db.js";
import { authRequired, enforceTokenVersion } from "../api/auth.js";
import { createVendorNotification } from "../services/notifications.js"; // 🔔

const router = express.Router();

// DOAR user logat
router.use(authRequired, enforceTokenVersion);

/**
 * GET /api/user-inbox/unread-count
 */
router.get("/unread-count", async (req, res) => {
  const userId = req.user.sub;

  const threads = await prisma.messageThread.findMany({
    where: {
      userId,
      archivedByUser: false,
    },
    select: { id: true, userLastReadAt: true },
  });

  let totalUnread = 0;

  for (const t of threads) {
    const unreadCount = await prisma.message.count({
      where: {
        threadId: t.id,
        NOT: { authorType: "USER" },
        ...(t.userLastReadAt ? { createdAt: { gt: t.userLastReadAt } } : {}),
      },
    });
    totalUnread += unreadCount;
  }

  res.json({ count: totalUnread });
});

/**
 * GET /api/user-inbox/threads
 * Suportă:
 *   - scope = all | unread | archived
 *   - q = text de căutare
 *   - groupBy = store  → grupare conversații pe vendor (magazin)
 */
router.get("/threads", async (req, res) => {
  const userId = req.user.sub;
  const { scope = "all", q = "", groupBy } = req.query;

  const where = {
    userId,
    archivedByUser:
      scope === "archived"
        ? true
        : scope === "all"
        ? false
        : undefined, // la "unread" filtrăm în memorie
    OR: q
      ? [
          { contactName: { contains: String(q), mode: "insensitive" } },
          { contactEmail: { contains: String(q), mode: "insensitive" } },
          { contactPhone: { contains: String(q), mode: "insensitive" } },
          { lastMsg: { contains: String(q), mode: "insensitive" } },
        ]
      : undefined,
  };

  const threadsRaw = await prisma.messageThread.findMany({
    where,
    orderBy: [{ lastAt: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      contactName: true,
      contactPhone: true,
      lastMsg: true,
      lastAt: true,
      userLastReadAt: true,
      archivedByUser: true,
      vendorId: true,
      vendor: {
        select: {
          displayName: true,
          // dacă ai un slug sau alt câmp pentru link magazin,
          // îl poți adăuga aici și returna mai jos ca storeSlug
        },
      },
    },
  });

  // calculăm unreadCount pentru fiecare thread
  const threadsWithUnread = await Promise.all(
    threadsRaw.map(async (t) => {
      const unreadCount = await prisma.message.count({
        where: {
          threadId: t.id,
          NOT: { authorType: "USER" },
          ...(t.userLastReadAt ? { createdAt: { gt: t.userLastReadAt } } : {}),
        },
      });

      return {
        ...t,
        unreadCount,
      };
    })
  );

  // dacă scope === "unread" -> filtrăm la nivel de memorie
  let threads = threadsWithUnread;
  if (scope === "unread") {
    threads = threadsWithUnread.filter((t) => t.unreadCount > 0);
  }

  // 🔹 Vedere grupată pe magazin
  if (groupBy === "store") {
    const groupsMap = new Map();

    for (const t of threads) {
      const vendorId = t.vendorId || `no-vendor-${t.id}`;
      const key = String(vendorId);

      const displayName =
        t.vendor?.displayName || t.contactName || "Magazin";

      if (!groupsMap.has(key)) {
        groupsMap.set(key, {
          id: key,
          name: displayName,
          phone: null,
          lastMsg: t.lastMsg || null,
          lastAt: t.lastAt,
          unreadCount: 0,
          archived: t.archivedByUser,
          orderCount: 0,
          // dacă vrei, aici poți pune și storeSlug
          threads: [],
        });
      }

      const group = groupsMap.get(key);

      // thread individual pentru tab-uri
      group.threads.push({
        threadId: t.id,
        lastMsg: t.lastMsg || null,
        lastAt: t.lastAt,
        unreadCount: t.unreadCount,
        archived: t.archivedByUser,
        // 🔹 orderSummary: momentan folosim id-ul thread-ului
        // Dacă ai un field orderId pe messageThread, pune aici { id: t.orderId }
        orderSummary: {
          id: t.id,
        },
      });

      group.orderCount += 1;
      group.unreadCount += t.unreadCount;

      // actualizăm lastAt / lastMsg dacă thread-ul e mai recent
      if (t.lastAt && (!group.lastAt || t.lastAt > group.lastAt)) {
        group.lastAt = t.lastAt;
        group.lastMsg = t.lastMsg || group.lastMsg;
      }
    }

    const items = Array.from(groupsMap.values()).sort(
      (a, b) =>
        (b.lastAt ? new Date(b.lastAt).getTime() : 0) -
        (a.lastAt ? new Date(a.lastAt).getTime() : 0)
    );

    return res.json({ items });
  }

  // 🔹 Vedere normală (fiecare thread = o conversație)
  const items = threads.map((t) => ({
    id: t.id,
    name: t.vendor?.displayName || t.contactName || "Vendor",
    phone: t.contactPhone || null,
    lastMsg: t.lastMsg || null,
    lastAt: t.lastAt,
    unreadCount: t.unreadCount,
    archived: t.archivedByUser,
    // pentru afișarea "Comanda XYZ" în frontend
    orderSummary: {
      id: t.id,
    },
  }));

  res.json({ items });
});

/**
 * GET /api/user-inbox/threads/:id/messages
 */
router.get("/threads/:id/messages", async (req, res) => {
  const userId = req.user.sub;
  const { id } = req.params;

  const thread = await prisma.messageThread.findFirst({
    where: { id, userId },
    select: {
      id: true,
      vendorLastReadAt: true, // folosit pentru read receipts ✓✓
    },
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
    },
  });

  const items = msgs.map((m) => {
    const from = m.authorType === "USER" ? "me" : "them";

    // dacă eu sunt USER și vendor a deschis thread-ul după mesaj -> citit
    const readByPeer =
      from === "me" &&
      thread.vendorLastReadAt &&
      m.createdAt <= thread.vendorLastReadAt;

    return {
      id: m.id,
      threadId: id,
      from,
      authorName:
        m.authorType === "USER" ? undefined : m.authorName || "Vendor",
      body: m.body,
      createdAt: m.createdAt,
      readByPeer,
    };
  });

  res.json({ items });
});

/**
 * PATCH /api/user-inbox/threads/:id/read
 */
router.patch("/threads/:id/read", async (req, res) => {
  const userId = req.user.sub;
  const { id } = req.params;

  const thread = await prisma.messageThread.findFirst({
    where: { id, userId },
  });
  if (!thread) return res.status(404).json({ error: "Thread not found" });

  await prisma.messageThread.update({
    where: { id },
    data: { userLastReadAt: new Date() },
  });

  res.json({ ok: true });
});

/**
 * POST /api/user-inbox/threads/:id/messages
 */
router.post("/threads/:id/messages", async (req, res) => {
  const userId = req.user.sub;
  const { id } = req.params;
  const { body } = req.body || {};

  if (!body || !String(body).trim()) {
    return res.status(400).json({ error: "Mesajul nu poate fi gol" });
  }

  const thread = await prisma.messageThread.findFirst({
    where: { id, userId },
    select: {
      id: true,
      vendorId: true,
    },
  });
  if (!thread) return res.status(404).json({ error: "Thread not found" });

  const msg = await prisma.message.create({
    data: {
      threadId: id,
      body: String(body).trim(),
      authorType: "USER",
    },
  });

  await prisma.messageThread.update({
    where: { id },
    data: {
      lastMsg: msg.body,
      lastAt: msg.createdAt,
      userLastReadAt: new Date(),
    },
  });

  // 🔔 notificare pentru VENDOR
  try {
    if (thread.vendorId) {
      await createVendorNotification(thread.vendorId, {
        type: "message",
        title: "Mesaj nou de la client",
        body: msg.body.slice(0, 140),
        link: "/mesaje", // inbox-ul vendorului
      });
    }
  } catch (e) {
    console.error(
      "Nu am putut crea notificarea pentru vendor (mesaj nou):",
      e
    );
  }

  res.status(201).json({ ok: true, id: msg.id, createdAt: msg.createdAt });
});

/**
 * PATCH /api/user-inbox/threads/:id/archive
 */
router.patch("/threads/:id/archive", async (req, res) => {
  const userId = req.user.sub;
  const { id } = req.params;
  const { archived = true } = req.body || {};

  const thread = await prisma.messageThread.findFirst({
    where: { id, userId },
  });
  if (!thread) return res.status(404).json({ error: "Thread not found" });

  await prisma.messageThread.update({
    where: { id },
    data: { archivedByUser: !!archived },
  });

  res.json({ ok: true });
});

/**
 * DELETE /api/user-inbox/threads/:id
 * (pentru butonul de ștergere din UI-ul userului)
 */
router.delete("/threads/:id", async (req, res) => {
  const userId = req.user.sub;
  const { id } = req.params;

  const thread = await prisma.messageThread.findFirst({
    where: { id, userId },
    select: { id: true },
  });

  if (!thread) {
    return res.status(404).json({ error: "Thread not found" });
  }

  // dacă vrei doar "soft delete", înlocuiește cu update({ archivedByUser: true })
  await prisma.message.deleteMany({
    where: { threadId: id },
  });

  await prisma.messageThread.delete({
    where: { id },
  });

  res.json({ ok: true });
});

/**
 * POST /api/user-inbox/ensure-thread
 * Body: { vendorId?: string, serviceId?: string, storeSlug?: string }
 */
router.post("/ensure-thread", async (req, res) => {
  try {
    const userId = req.user.sub;
    let { vendorId, serviceId, storeSlug } = req.body || {};

    console.log("ensure-thread body:", { userId, vendorId, serviceId, storeSlug });

    // 1) dacă avem vendorId, nu mai căutăm nimic
    // 2) altfel încercăm să-l deducem din serviceId
    if (!vendorId && serviceId) {
      try {
        const service = await prisma.vendorService.findUnique({
          where: { id: serviceId },
          select: { vendorId: true },
        });
        vendorId = service?.vendorId || null;
      } catch (e) {
        console.error(
          "ensure-thread: eroare la vendorService.findUnique(id)",
          e
        );
      }
    }

    // 3) altfel încercăm din storeSlug via ServiceProfile.slug
    if (!vendorId && storeSlug) {
      try {
        const profile = await prisma.serviceProfile.findUnique({
          where: { slug: storeSlug },
          select: {
            service: { select: { vendorId: true } },
          },
        });
        vendorId = profile?.service?.vendorId || null;
      } catch (e) {
        console.error(
          "ensure-thread: eroare la serviceProfile.findUnique(slug)",
          e
        );
      }
    }

    // 4) dacă tot nu avem vendorId -> 400
    if (!vendorId) {
      return res.status(400).json({ error: "vendor_not_resolved" });
    }

    // 5) căutăm thread existent user + vendor
    let thread = await prisma.messageThread.findFirst({
      where: {
        userId,
        vendorId,
      },
      select: { id: true },
    });

    // 6) dacă nu există, îl creăm
    if (!thread) {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          firstName: true,
          lastName: true,
          email: true,
          phone: true,
        },
      });

      const contactName = [user?.firstName, user?.lastName]
        .filter(Boolean)
        .join(" ");

      thread = await prisma.messageThread.create({
        data: {
          userId,
          vendorId,
          contactName: contactName || null,
          contactEmail: user?.email || null,
          contactPhone: user?.phone || null,
          archivedByUser: false,
          archived: false,
        },
        select: { id: true },
      });
    }

    return res.json({ ok: true, threadId: thread.id });
  } catch (e) {
    console.error("ensure-thread error", e);
    return res.status(500).json({ error: "server_error" });
  }
});

export default router;
