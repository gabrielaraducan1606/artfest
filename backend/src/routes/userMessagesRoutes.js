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

// DOAR user logat
router.use(authRequired, enforceTokenVersion);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 10 }, // 25MB / fișier, max 10
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
  // compat cu vendor și cu user (fallback)
  return process.env.R2_BUCKET_NAME || process.env.R2_BUCKET || "";
}

function getPublicBase() {
  // compat cu vendor și cu user (fallback)
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

/* =========================
   GET /api/user-inbox/unread-count
========================= */
router.get("/unread-count", async (req, res) => {
  const userId = req.user.sub;

  const threads = await prisma.messageThread.findMany({
    where: {
      userId,
      archivedByUser: false,
      deletedByUserAt: null, // ✅ thread vizibil userului
    },
    select: { id: true, userLastReadAt: true },
  });

  let totalUnread = 0;

  for (const t of threads) {
    const unreadCount = await prisma.message.count({
      where: {
        threadId: t.id,
        deletedByUserAt: null, // ✅ mesaj vizibil userului
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
   - scope = all | unread | archived
   - q = search
   - groupBy=store (optional)
========================= */
router.get("/threads", async (req, res) => {
  const userId = req.user.sub;
  const { scope = "all", q = "", groupBy } = req.query;

  const where = {
    userId,
    deletedByUserAt: null, // ✅ nu returna thread-uri șterse pentru user
    archivedByUser:
      scope === "archived" ? true : scope === "all" ? false : undefined,
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
      vendor: { select: { displayName: true } },
    },
  });

  const threadsWithUnread = await Promise.all(
    threadsRaw.map(async (t) => {
      const unreadCount = await prisma.message.count({
        where: {
          threadId: t.id,
          deletedByUserAt: null, // ✅ ignore mesaje șterse user
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

  // 🔹 grupare pe magazin
  if (groupBy === "store") {
    const groupsMap = new Map();

    for (const t of threads) {
      const vendorKey = String(t.vendorId || `no-vendor-${t.id}`);
      const displayName = t.vendor?.displayName || t.contactName || "Magazin";

      if (!groupsMap.has(vendorKey)) {
        groupsMap.set(vendorKey, {
          id: vendorKey,
          name: displayName,
          phone: null,
          lastMsg: t.lastMsg || null,
          lastAt: t.lastAt,
          unreadCount: 0,
          archived: t.archivedByUser,
          orderCount: 0,
          threads: [],
        });
      }

      const group = groupsMap.get(vendorKey);

      group.threads.push({
        threadId: t.id,
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

  // 🔹 vedere normală
  const items = threads.map((t) => ({
    id: t.id,
    name: t.vendor?.displayName || t.contactName || "Vendor",
    phone: t.contactPhone || null,
    lastMsg: t.lastMsg || null,
    lastAt: t.lastAt,
    unreadCount: t.unreadCount,
    archived: t.archivedByUser,
    orderSummary: { id: t.id },
  }));

  res.json({ items });
});

/* =========================
   GET /api/user-inbox/threads/:id/messages
   ✅ include attachments
========================= */
router.get("/threads/:id/messages", async (req, res) => {
  const userId = req.user.sub;
  const threadId = String(req.params.id || "");

  try {
    const thread = await prisma.messageThread.findFirst({
      where: { id: threadId, userId, deletedByUserAt: null }, // ✅ thread vizibil
      select: { id: true, vendorLastReadAt: true },
    });

    if (!thread) return res.status(404).json({ error: "Thread not found" });

    const msgs = await prisma.message.findMany({
  where: { threadId }, // ✅ include și șterse
  orderBy: { createdAt: "asc" },
  select: {
    id: true,
    body: true,
    createdAt: true,
    authorType: true,
    authorName: true,
    deletedByUserAt: true, // ✅ IMPORTANT
    attachments: {
      select: { id: true, filename: true, url: true, size: true, mime: true },
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
  authorName: m.authorType === "USER" ? undefined : m.authorName || "Vendor",
  body: isDeletedForUser ? "" : m.body,
  createdAt: m.createdAt,
  readByPeer,
  deleted: isDeletedForUser, // ✅ flag pt frontend
  attachments: isDeletedForUser
    ? [] // ✅ user nu mai vede atașamentele după delete
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
    where: { id: threadId, userId, deletedByUserAt: null }, // ✅
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
    where: { id: threadId, userId, deletedByUserAt: null }, // ✅ thread vizibil
    select: { id: true, vendorId: true },
  });
  if (!thread) return res.status(404).json({ error: "Thread not found" });

  const msg = await prisma.message.create({
    data: {
      threadId,
      vendorId: thread.vendorId, // ✅ important (ai vendorId obligatoriu în Message)
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

  // 🔔 notificare pentru VENDOR
  try {
    if (thread.vendorId) {
      await createVendorNotification(thread.vendorId, {
        type: "message",
        title: "Mesaj nou de la client",
        body: msg.body.slice(0, 140),
        link: "/mesaje",
      });
    }
  } catch (e) {
    console.error("Nu am putut crea notificarea pentru vendor (mesaj nou):", e);
  }

  res.status(201).json({ ok: true, id: msg.id, createdAt: msg.createdAt });
});

/* =========================
   ✅ POST /api/user-inbox/threads/:id/attachments
========================= */
router.post(
  "/threads/:id/attachments",
  upload.array("files", 10),
  async (req, res) => {
    const userId = req.user.sub;
    const threadId = String(req.params.id || "");

    const files = Array.isArray(req.files) ? req.files : [];
    if (!files.length) {
      return res.status(400).json({ error: "no_files" });
    }

    const thread = await prisma.messageThread.findFirst({
      where: { id: threadId, userId, deletedByUserAt: null }, // ✅ thread vizibil
      select: { id: true, vendorId: true },
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
            vendorId: thread.vendorId, // ✅
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

      // notificare vendor
      try {
        if (thread.vendorId) {
          await createVendorNotification(thread.vendorId, {
            type: "message",
            title: "Atașament nou de la client",
            body:
              result.created.length === 1
                ? `📎 ${result.created[0].filename}`
                : `📎 ${result.created.length} fișiere atașate`,
            link: "/mesaje",
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
  }
);

/* =========================
   PATCH /api/user-inbox/threads/:id/archive
========================= */
router.patch("/threads/:id/archive", async (req, res) => {
  const userId = req.user.sub;
  const threadId = String(req.params.id || "");
  const { archived = true } = req.body || {};

  const thread = await prisma.messageThread.findFirst({
    where: { id: threadId, userId, deletedByUserAt: null }, // ✅
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
   ✅ soft-delete thread pentru user
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

    if (!vendorId && serviceId) {
      try {
        const service = await prisma.vendorService.findUnique({
          where: { id: String(serviceId) },
          select: { vendorId: true },
        });
        vendorId = service?.vendorId || null;
      } catch (e) {
        console.error("ensure-thread: eroare la vendorService.findUnique(id)", e);
      }
    }

    if (!vendorId && storeSlug) {
      try {
        const profile = await prisma.serviceProfile.findUnique({
          where: { slug: String(storeSlug) },
          select: { service: { select: { vendorId: true } } },
        });
        vendorId = profile?.service?.vendorId || null;
      } catch (e) {
        console.error("ensure-thread: eroare la serviceProfile.findUnique(slug)", e);
      }
    }

    if (!vendorId) {
      return res.status(400).json({ error: "vendor_not_resolved" });
    }

    let thread = await prisma.messageThread.findFirst({
      where: { userId, vendorId: String(vendorId), deletedByUserAt: null },
      select: { id: true },
    });

    // dacă user a “șters conversația” (soft-delete), o “re-activăm”
    if (!thread) {
      const deletedThread = await prisma.messageThread.findFirst({
        where: {
          userId,
          vendorId: String(vendorId),
          deletedByUserAt: { not: null },
        },
        select: { id: true },
      });

      if (deletedThread) {
        await prisma.messageThread.update({
          where: { id: deletedThread.id },
          data: { deletedByUserAt: null, archivedByUser: false },
        });

        return res.json({ ok: true, threadId: deletedThread.id });
      }
    }

    if (!thread) {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { firstName: true, lastName: true, email: true, phone: true },
      });

      const contactName = [user?.firstName, user?.lastName]
        .filter(Boolean)
        .join(" ");

      thread = await prisma.messageThread.create({
        data: {
          userId,
          vendorId: String(vendorId),
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
   ✅ DOWNLOAD ATTACHMENT (User)
   - blocăm dacă mesajul e șters pentru user
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
            deletedByUserAt: true, // ✅
            thread: { select: { userId: true } },
          },
        },
      },
    });

    if (!att || !att.url) return res.status(404).json({ error: "not_found" });

    if (String(att.message?.thread?.userId || "") !== String(userId)) {
      return res.status(403).json({ error: "forbidden" });
    }

    // ✅ dacă mesajul e șters pentru user, nu mai permitem download
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
   ✅ soft-delete message pentru user
   ✅ UPDATE lastMsg/lastAt "global" (pt vendor thread list)
========================= */
router.delete("/threads/:id/messages/:mid", async (req, res) => {
  const userId = req.user.sub;
  const { id: threadId, mid: messageId } = req.params;

  const thread = await prisma.messageThread.findFirst({
    where: { id: threadId, userId, deletedByUserAt: null },
    select: { id: true, vendorId: true },
  });
  if (!thread) return res.status(404).json({ error: "not_found" });

  const message = await prisma.message.findFirst({
    where: { id: messageId, threadId, deletedByUserAt: null }, // ✅ nu “re-delete” mesaj deja șters
    select: { id: true, authorType: true },
  });
  if (!message) return res.status(404).json({ error: "not_found" });

  if (message.authorType !== "USER") {
    return res.status(403).json({ error: "forbidden" });
  }

  try {
    await prisma.$transaction(async (tx) => {
      const now = new Date();

      // ✅ soft delete pentru user
      await tx.message.update({
        where: { id: messageId },
        data: {
          deletedByUserAt: now,

          // OPTIONAL (dacă vrei să nu mai păstrezi conținutul original în DB):
          // body: "🚫 Mesaj șters de utilizator",
        },
      });

      // ✅ recompute last GLOBAL (nu doar "vizibil userului")
      const lastGlobal = await tx.message.findFirst({
        where: { threadId },
        orderBy: { createdAt: "desc" },
        select: { body: true, createdAt: true, deletedByUserAt: true },
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

    // (opțional) notificare vendor că user a șters un mesaj
    try {
      if (thread.vendorId) {
        await createVendorNotification(thread.vendorId, {
          type: "message",
          title: "Mesaj șters de client",
          body: "Clientul a șters un mesaj din conversație.",
          link: "/mesaje",
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
