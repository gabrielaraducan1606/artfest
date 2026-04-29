// backend/src/routes/userInboxRoutes.js
import express from "express";
import { prisma } from "../db.js";
import { authRequired, enforceTokenVersion } from "../api/auth.js";
import { createVendorNotification } from "../services/notifications.js";
import multer from "multer";
import crypto from "crypto";
import path from "path";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { Readable } from "stream";

const router = express.Router();

router.use(authRequired, enforceTokenVersion);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 10 },
});

const r2 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

/* =========================
   Helpers
========================= */

function safeFilename(original = "file") {
  const base = path.basename(original).replace(/[^\w.\-() ]+/g, "_");
  return base.slice(0, 160) || "file";
}

function extOf(name = "") {
  const ext = path.extname(name || "").toLowerCase();
  return ext && ext.length <= 10 ? ext : "";
}

function getR2Bucket() {
  return process.env.R2_BUCKET_NAME || process.env.R2_BUCKET || "";
}

function getPublicBase() {
  return (
    (process.env.R2_PUBLIC_BASE_URL || process.env.R2_PUBLIC_BASE || "").replace(
      /\/+$/,
      ""
    ) || ""
  );
}

function publicUrlForKey(key) {
  const base = getPublicBase();
  if (!base) return null;
  return `${base}/${key}`;
}

async function uploadToR2({ key, buffer, contentType }) {
  const bucket = getR2Bucket();
  if (!bucket) throw new Error("Missing R2_BUCKET_NAME (or R2_BUCKET) env");

  await r2.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType || "application/octet-stream",
    })
  );
}

function storeNameFromThread(t) {
  return (
    t.service?.profile?.displayName ||
    t.service?.title ||
    t.vendor?.displayName ||
    t.contactName ||
    "Magazin"
  );
}

/* =========================
   GET /api/user-inbox/unread-count
========================= */

router.get("/unread-count", async (req, res) => {
  const userId = req.user.sub;

  const threads = await prisma.messageThread.findMany({
    where: {
      userId,
      archivedByUser: false,
      deletedByUserAt: null,
    },
    select: { id: true, userLastReadAt: true },
  });

  let totalUnread = 0;

  for (const t of threads) {
    const unreadCount = await prisma.message.count({
      where: {
        threadId: t.id,
        deletedByUserAt: null,
        NOT: { authorType: "USER" },
        ...(t.userLastReadAt ? { createdAt: { gt: t.userLastReadAt } } : {}),
      },
    });

    totalUnread += unreadCount;
  }

  res.json({ count: totalUnread });
});

/* =========================
   GET /api/user-inbox/threads
========================= */

router.get("/threads", async (req, res) => {
  const userId = req.user.sub;
  const { scope = "all", q = "", groupBy } = req.query;

  const where = {
    userId,
    deletedByUserAt: null,
    archivedByUser:
      scope === "archived" ? true : scope === "all" ? false : undefined,
    OR: q
      ? [
          { contactName: { contains: String(q), mode: "insensitive" } },
          { contactEmail: { contains: String(q), mode: "insensitive" } },
          { contactPhone: { contains: String(q), mode: "insensitive" } },
          { lastMsg: { contains: String(q), mode: "insensitive" } },
          {
            service: {
              OR: [
                { title: { contains: String(q), mode: "insensitive" } },
                {
                  profile: {
                    displayName: {
                      contains: String(q),
                      mode: "insensitive",
                    },
                  },
                },
              ],
            },
          },
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
      serviceId: true,

      vendor: {
        select: {
          displayName: true,
        },
      },

      service: {
        select: {
          id: true,
          title: true,
          profile: {
            select: {
              displayName: true,
              slug: true,
              logoUrl: true,
            },
          },
        },
      },
    },
  });

  const threadsWithUnread = await Promise.all(
    threadsRaw.map(async (t) => {
      const unreadCount = await prisma.message.count({
        where: {
          threadId: t.id,
          deletedByUserAt: null,
          NOT: { authorType: "USER" },
          ...(t.userLastReadAt ? { createdAt: { gt: t.userLastReadAt } } : {}),
        },
      });

      return { ...t, unreadCount };
    })
  );

  let threads = threadsWithUnread;

  if (scope === "unread") {
    threads = threadsWithUnread.filter((t) => t.unreadCount > 0);
  }

  if (groupBy === "store") {
    const groupsMap = new Map();

    for (const t of threads) {
      const storeKey = String(t.serviceId || t.vendorId || `no-store-${t.id}`);
      const displayName = storeNameFromThread(t);

      if (!groupsMap.has(storeKey)) {
        groupsMap.set(storeKey, {
          id: storeKey,
          storeId: t.serviceId || null,
          vendorId: t.vendorId || null,
          name: displayName,
          storeName: displayName,
          storeSlug: t.service?.profile?.slug || null,
          storeLogoUrl: t.service?.profile?.logoUrl || null,
          phone: null,
          lastMsg: t.lastMsg || null,
          lastAt: t.lastAt,
          unreadCount: 0,
          archived: t.archivedByUser,
          orderCount: 0,
          threads: [],
        });
      }

      const group = groupsMap.get(storeKey);

      group.threads.push({
        threadId: t.id,
        storeId: t.serviceId || null,
        vendorId: t.vendorId || null,
        storeName: displayName,
        storeSlug: t.service?.profile?.slug || null,
        storeLogoUrl: t.service?.profile?.logoUrl || null,
        lastMsg: t.lastMsg || null,
        lastAt: t.lastAt,
        unreadCount: t.unreadCount,
        archived: t.archivedByUser,
        orderSummary: { id: t.id },
      });

      group.orderCount += 1;
      group.unreadCount += t.unreadCount;

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

  const items = threads.map((t) => {
    const storeName = storeNameFromThread(t);

    return {
      id: t.id,
      name: storeName,
      storeName,
      storeId: t.serviceId || null,
      storeSlug: t.service?.profile?.slug || null,
      storeLogoUrl: t.service?.profile?.logoUrl || null,
      vendorId: t.vendorId || null,
      phone: t.contactPhone || null,
      lastMsg: t.lastMsg || null,
      lastAt: t.lastAt,
      unreadCount: t.unreadCount,
      archived: t.archivedByUser,
      orderSummary: { id: t.id },
    };
  });

  res.json({ items });
});

/* =========================
   GET /api/user-inbox/threads/:id/messages
========================= */

router.get("/threads/:id/messages", async (req, res) => {
  const userId = req.user.sub;
  const threadId = String(req.params.id || "");

  try {
    const thread = await prisma.messageThread.findFirst({
      where: { id: threadId, userId, deletedByUserAt: null },
      select: {
        id: true,
        vendorLastReadAt: true,
        contactName: true,
        vendor: {
          select: {
            displayName: true,
          },
        },
        service: {
          select: {
            title: true,
            profile: {
              select: {
                displayName: true,
              },
            },
          },
        },
      },
    });

    if (!thread) return res.status(404).json({ error: "Thread not found" });

    const storeName = storeNameFromThread(thread);

    const msgs = await prisma.message.findMany({
      where: { threadId },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        body: true,
        createdAt: true,
        authorType: true,
        authorName: true,
        deletedByUserAt: true,
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
      const from = m.authorType === "USER" ? "me" : "them";

      const readByPeer =
        from === "me" &&
        thread.vendorLastReadAt &&
        m.createdAt <= thread.vendorLastReadAt;

      const isDeletedForUser = !!m.deletedByUserAt;

      return {
        id: m.id,
        threadId,
        from,
        authorName: m.authorType === "USER" ? undefined : m.authorName || storeName,
        body: isDeletedForUser ? "" : m.body,
        createdAt: m.createdAt,
        readByPeer,
        deleted: isDeletedForUser,
        attachments: isDeletedForUser
          ? []
          : (m.attachments || []).map((a) => ({
              id: a.id,
              name: a.filename,
              url: a.url,
              size: a.size,
              mime: a.mime,
            })),
      };
    });

    res.json({ items });
  } catch (e) {
    console.error("GET /api/user-inbox/threads/:id/messages error:", e);
    res.status(500).json({
      error: "server_error",
      details: String(e?.message || e),
    });
  }
});

/* =========================
   PATCH /api/user-inbox/threads/:id/read
========================= */

router.patch("/threads/:id/read", async (req, res) => {
  const userId = req.user.sub;
  const threadId = String(req.params.id || "");

  const thread = await prisma.messageThread.findFirst({
    where: { id: threadId, userId, deletedByUserAt: null },
    select: { id: true },
  });

  if (!thread) return res.status(404).json({ error: "Thread not found" });

  await prisma.messageThread.update({
    where: { id: threadId },
    data: { userLastReadAt: new Date() },
  });

  res.json({ ok: true });
});

/* =========================
   POST /api/user-inbox/threads/:id/messages
========================= */

router.post("/threads/:id/messages", async (req, res) => {
  const userId = req.user.sub;
  const threadId = String(req.params.id || "");
  const { body } = req.body || {};

  if (!body || !String(body).trim()) {
    return res.status(400).json({ error: "Mesajul nu poate fi gol" });
  }

  const thread = await prisma.messageThread.findFirst({
    where: { id: threadId, userId, deletedByUserAt: null },
    select: {
      id: true,
      vendorId: true,
      serviceId: true,
    },
  });

  if (!thread) return res.status(404).json({ error: "Thread not found" });

  const msg = await prisma.message.create({
    data: {
      threadId,
      vendorId: thread.vendorId,
      body: String(body).trim(),
      authorType: "USER",
    },
    select: { id: true, createdAt: true, body: true },
  });

  await prisma.messageThread.update({
    where: { id: threadId },
    data: {
      lastMsg: msg.body,
      lastAt: msg.createdAt,
      userLastReadAt: new Date(),
    },
  });

  try {
    if (thread.vendorId) {
      await createVendorNotification(thread.vendorId, {
        type: "message",
        title: "Mesaj nou de la client",
        body: msg.body.slice(0, 140),
        link: `/mesaje?threadId=${threadId}`,
      });
    }
  } catch (e) {
    console.error("Nu am putut crea notificarea pentru vendor (mesaj nou):", e);
  }

  res.status(201).json({ ok: true, id: msg.id, createdAt: msg.createdAt });
});

/* =========================
   POST /api/user-inbox/threads/:id/attachments
========================= */

router.post("/threads/:id/attachments", upload.array("files", 10), async (req, res) => {
  const userId = req.user.sub;
  const threadId = String(req.params.id || "");

  const files = Array.isArray(req.files) ? req.files : [];
  if (!files.length) {
    return res.status(400).json({ error: "no_files" });
  }

  const thread = await prisma.messageThread.findFirst({
    where: { id: threadId, userId, deletedByUserAt: null },
    select: {
      id: true,
      vendorId: true,
      serviceId: true,
    },
  });

  if (!thread) return res.status(404).json({ error: "Thread not found" });

  const publicBase = getPublicBase();
  if (!publicBase) {
    return res.status(500).json({
      error: "r2_public_base_missing",
      message: "Setează R2_PUBLIC_BASE_URL (sau R2_PUBLIC_BASE).",
    });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const msg = await tx.message.create({
        data: {
          threadId,
          vendorId: thread.vendorId,
          authorType: "USER",
          body: "📎 Atașament",
        },
        select: { id: true, createdAt: true },
      });

      const created = [];

      for (const f of files) {
        const originalName = safeFilename(f.originalname || "file");
        const ext = extOf(originalName);
        const rnd = crypto.randomBytes(10).toString("hex");

        const key = `inbox/${threadId}/${msg.id}/${Date.now()}_${rnd}${ext}`;

        await uploadToR2({
          key,
          buffer: f.buffer,
          contentType: f.mimetype,
        });

        const url = publicUrlForKey(key);

        const att = await tx.messageAttachment.create({
          data: {
            messageId: msg.id,
            filename: originalName,
            url,
            size: typeof f.size === "number" ? f.size : null,
            mime: f.mimetype || null,
          },
          select: {
            id: true,
            filename: true,
            url: true,
            size: true,
            mime: true,
          },
        });

        created.push(att);
      }

      const lastMsgLabel =
        created.length === 1
          ? `📎 ${created[0].filename}`
          : `📎 ${created.length} atașamente`;

      await tx.messageThread.update({
        where: { id: threadId },
        data: {
          lastMsg: lastMsgLabel,
          lastAt: msg.createdAt,
          userLastReadAt: new Date(),
        },
      });

      return { msg, created };
    });

    try {
      if (thread.vendorId) {
        await createVendorNotification(thread.vendorId, {
          type: "message",
          title: "Atașament nou de la client",
          body:
            result.created.length === 1
              ? `📎 ${result.created[0].filename}`
              : `📎 ${result.created.length} fișiere atașate`,
          link: `/mesaje?threadId=${threadId}`,
        });
      }
    } catch (e) {
      console.error("Nu am putut crea notificarea pentru vendor (atașament):", e);
    }

    return res.status(201).json({
      ok: true,
      messageId: result.msg.id,
      createdAt: result.msg.createdAt,
      attachments: result.created.map((a) => ({
        id: a.id,
        name: a.filename,
        url: a.url,
        size: a.size,
        mime: a.mime,
      })),
    });
  } catch (e) {
    console.error("POST /threads/:id/attachments error:", e);
    return res.status(500).json({
      error: "server_error",
      details: String(e?.message || e),
    });
  }
});

/* =========================
   PATCH /api/user-inbox/threads/:id/archive
========================= */

router.patch("/threads/:id/archive", async (req, res) => {
  const userId = req.user.sub;
  const threadId = String(req.params.id || "");
  const { archived = true } = req.body || {};

  const thread = await prisma.messageThread.findFirst({
    where: { id: threadId, userId, deletedByUserAt: null },
    select: { id: true },
  });

  if (!thread) return res.status(404).json({ error: "Thread not found" });

  await prisma.messageThread.update({
    where: { id: threadId },
    data: { archivedByUser: !!archived },
  });

  res.json({ ok: true });
});

/* =========================
   DELETE /api/user-inbox/threads/:id
========================= */

router.delete("/threads/:id", async (req, res) => {
  const userId = req.user.sub;
  const threadId = String(req.params.id || "");

  const thread = await prisma.messageThread.findFirst({
    where: { id: threadId, userId, deletedByUserAt: null },
    select: { id: true },
  });

  if (!thread) {
    return res.status(404).json({ error: "Thread not found" });
  }

  await prisma.messageThread.update({
    where: { id: threadId },
    data: {
      deletedByUserAt: new Date(),
      archivedByUser: true,
    },
  });

  res.json({ ok: true });
});

/* =========================
   POST /api/user-inbox/ensure-thread
========================= */

router.post("/ensure-thread", async (req, res) => {
  try {
    const userId = req.user.sub;
    let { vendorId, serviceId, storeSlug } = req.body || {};

    let resolvedServiceId = serviceId ? String(serviceId) : null;

    if (!resolvedServiceId && storeSlug) {
      const profile = await prisma.serviceProfile.findUnique({
        where: { slug: String(storeSlug) },
        select: {
          serviceId: true,
          service: {
            select: {
              vendorId: true,
            },
          },
        },
      });

      resolvedServiceId = profile?.serviceId || null;
      vendorId = profile?.service?.vendorId || vendorId || null;
    }

    if (resolvedServiceId) {
      const service = await prisma.vendorService.findUnique({
        where: { id: resolvedServiceId },
        select: {
          id: true,
          vendorId: true,
        },
      });

      resolvedServiceId = service?.id || resolvedServiceId;
      vendorId = service?.vendorId || vendorId || null;
    }

    if (!vendorId || !resolvedServiceId) {
      return res.status(400).json({
        error: "store_not_resolved",
        message: "Trimite serviceId sau storeSlug pentru a identifica magazinul.",
      });
    }

    let thread = await prisma.messageThread.findFirst({
      where: {
        userId,
        vendorId: String(vendorId),
        serviceId: resolvedServiceId,
        deletedByUserAt: null,
      },
      select: { id: true },
    });

    if (!thread) {
      const deletedThread = await prisma.messageThread.findFirst({
        where: {
          userId,
          vendorId: String(vendorId),
          serviceId: resolvedServiceId,
          deletedByUserAt: { not: null },
        },
        select: { id: true },
      });

      if (deletedThread) {
        await prisma.messageThread.update({
          where: { id: deletedThread.id },
          data: {
            deletedByUserAt: null,
            archivedByUser: false,
          },
        });

        return res.json({ ok: true, threadId: deletedThread.id });
      }
    }

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
          vendorId: String(vendorId),
          serviceId: resolvedServiceId,
          contactName: contactName || null,
          contactEmail: user?.email || null,
          contactPhone: user?.phone || null,
          archivedByUser: false,
          archived: false,
          deletedByUserAt: null,
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

/* =========================
   GET /api/user-inbox/attachments/:attId/download
========================= */

router.get("/attachments/:attId/download", async (req, res) => {
  try {
    const userId = req.user.sub;
    const attId = String(req.params.attId || "");

    if (!attId) return res.status(400).json({ error: "bad_request" });

    const att = await prisma.messageAttachment.findUnique({
      where: { id: attId },
      select: {
        id: true,
        url: true,
        filename: true,
        mime: true,
        message: {
          select: {
            deletedByUserAt: true,
            thread: {
              select: {
                userId: true,
              },
            },
          },
        },
      },
    });

    if (!att || !att.url) return res.status(404).json({ error: "not_found" });

    if (String(att.message?.thread?.userId || "") !== String(userId)) {
      return res.status(403).json({ error: "forbidden" });
    }

    if (att.message?.deletedByUserAt) {
      return res.status(404).json({ error: "not_found" });
    }

    const upstream = await fetch(att.url);

    if (!upstream.ok || !upstream.body) {
      return res.status(502).json({ error: "upstream_failed" });
    }

    const filename = att.filename || "atasament";
    const contentType =
      att.mime || upstream.headers.get("content-type") || "application/octet-stream";

    res.setHeader("Content-Type", contentType);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`
    );

    const len = upstream.headers.get("content-length");
    if (len) res.setHeader("Content-Length", len);

    const nodeStream = Readable.fromWeb(upstream.body);

    nodeStream.on("error", () => {
      try {
        res.end();
      } catch {}
    });

    nodeStream.pipe(res);
  } catch (e) {
    console.error("user download attachment error:", e);
    return res.status(500).json({ error: "server_error" });
  }
});

/* =========================
   DELETE /api/user-inbox/threads/:id/messages/:mid
========================= */

router.delete("/threads/:id/messages/:mid", async (req, res) => {
  const userId = req.user.sub;
  const { id: threadId, mid: messageId } = req.params;

  const thread = await prisma.messageThread.findFirst({
    where: {
      id: threadId,
      userId,
      deletedByUserAt: null,
    },
    select: {
      id: true,
      vendorId: true,
    },
  });

  if (!thread) return res.status(404).json({ error: "not_found" });

  const message = await prisma.message.findFirst({
    where: {
      id: messageId,
      threadId,
      deletedByUserAt: null,
    },
    select: {
      id: true,
      authorType: true,
    },
  });

  if (!message) return res.status(404).json({ error: "not_found" });

  if (message.authorType !== "USER") {
    return res.status(403).json({ error: "forbidden" });
  }

  try {
    await prisma.$transaction(async (tx) => {
      const now = new Date();

      await tx.message.update({
        where: { id: messageId },
        data: {
          deletedByUserAt: now,
        },
      });

      const lastGlobal = await tx.message.findFirst({
        where: { threadId },
        orderBy: { createdAt: "desc" },
        select: {
          body: true,
          createdAt: true,
          deletedByUserAt: true,
        },
      });

      const lastMsgGlobalLabel = lastGlobal?.deletedByUserAt
        ? "🚫 Mesaj șters de utilizator"
        : lastGlobal?.body || null;

      await tx.messageThread.update({
        where: { id: threadId },
        data: {
          lastMsg: lastMsgGlobalLabel,
          lastAt: lastGlobal?.createdAt || null,
        },
      });
    });

    try {
      if (thread.vendorId) {
        await createVendorNotification(thread.vendorId, {
          type: "message",
          title: "Mesaj șters de client",
          body: "Clientul a șters un mesaj din conversație.",
          link: `/mesaje?threadId=${threadId}`,
        });
      }
    } catch (e) {
      console.error("Nu am putut crea notificarea pentru vendor (mesaj șters):", e);
    }

    return res.json({ ok: true });
  } catch (e) {
    console.error("user delete message error:", e);
    return res.status(500).json({ error: "server_error" });
  }
});

/* =========================
   PATCH /api/user-inbox/threads/:id/messages/:mid
========================= */

router.patch("/threads/:id/messages/:mid", async (req, res) => {
  const userId = req.user.sub;
  const { id: threadId, mid: messageId } = req.params;
  const { body } = req.body || {};

  if (!body || !String(body).trim()) {
    return res.status(400).json({ error: "Mesajul nu poate fi gol" });
  }

  const thread = await prisma.messageThread.findFirst({
    where: {
      id: String(threadId),
      userId,
      deletedByUserAt: null,
    },
    select: { id: true },
  });

  if (!thread) {
    return res.status(404).json({ error: "Thread not found" });
  }

  const message = await prisma.message.findFirst({
    where: {
      id: String(messageId),
      threadId: String(threadId),
      authorType: "USER",
      deletedByUserAt: null,
    },
    select: {
      id: true,
      createdAt: true,
    },
  });

  if (!message) {
    return res.status(404).json({ error: "Message not found" });
  }

  try {
    const updated = await prisma.message.update({
      where: { id: String(messageId) },
      data: {
        body: String(body).trim(),
      },
      select: {
        id: true,
        body: true,
        createdAt: true,
      },
    });

    const lastMessage = await prisma.message.findFirst({
      where: { threadId: String(threadId) },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        body: true,
        createdAt: true,
        deletedByUserAt: true,
      },
    });

    const lastMsgLabel = lastMessage?.deletedByUserAt
      ? "🚫 Mesaj șters de utilizator"
      : lastMessage?.body || null;

    await prisma.messageThread.update({
      where: { id: String(threadId) },
      data: {
        lastMsg: lastMsgLabel,
        lastAt: lastMessage?.createdAt || null,
      },
    });

    return res.json({
      ok: true,
      item: updated,
    });
  } catch (e) {
    console.error("user edit message error:", e);
    return res.status(500).json({ error: "server_error" });
  }
});

export default router;