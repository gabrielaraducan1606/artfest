// backend/src/routes/userInboxRoutes.js
import express from "express";
import { prisma } from "../db.js";
import { authRequired, enforceTokenVersion } from "../api/auth.js";
import { createVendorNotification } from "../services/notifications.js";
import {
  moderateMarketplaceMessage,
  moderateMarketplaceImage,
} from "../services/marketplaceMessageModeration.js";
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

const MAX_MESSAGE_LENGTH = 5000;

/*
 * ETAPA 5 (idempotency clientMessageId) - opțional, dar dacă e prezent
 * trebuie să fie exact acest format: 1-100 caractere, doar
 * [A-Za-z0-9_-]. Regexul respinge deja whitespace și string gol (min 1
 * caracter din charset-ul permis).
 */
const CLIENT_MESSAGE_ID_REGEX = /^[A-Za-z0-9_-]{1,100}$/;

function validateClientMessageId(raw) {
  if (raw === undefined || raw === null) return { ok: true, value: null };
  if (typeof raw !== "string") return { ok: false };
  if (!CLIENT_MESSAGE_ID_REGEX.test(raw)) return { ok: false };
  return { ok: true, value: raw };
}

/*
 * Verifică defensiv că un P2002 aparține EXACT constrângerii
 * (threadId, clientMessageId) - nu tratăm orice P2002 ca duplicate
 * de mesaj. `meta.target` poate fi array sau string, în funcție de
 * driver/versiune Prisma.
 */
function isClientMessageIdConflict(err) {
  if (!err || err.code !== "P2002") return false;
  const target = err.meta?.target;
  const fields = Array.isArray(target) ? target : typeof target === "string" ? [target] : [];
  const hasThreadId = fields.some((f) => String(f).toLowerCase().includes("threadid"));
  const hasClientMessageId = fields.some((f) => String(f).toLowerCase().includes("clientmessageid"));
  return hasThreadId && hasClientMessageId;
}

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

/*
 * ETAPA 2 (audit Mesaje, privacy attachment-uri) - nu mai expunem
 * niciodată url-ul R2 brut către client. Doar id/filename/mime/size
 * + rutele interne autenticate de preview/download (proxy pe
 * /attachments/:id/download, care citește url-ul din DB server-side).
 */
function attachmentPublicShape(a) {
  return {
    id: a.id,
    name: a.filename,
    size: a.size,
    mime: a.mime,
    previewUrl: `/api/user-inbox/attachments/${a.id}/download`,
    downloadUrl: `/api/user-inbox/attachments/${a.id}/download?download=1`,
  };
}

/*
 * ETAPA 4 (paginare thread + load older) - paginare cursor pe mesaje.
 * Cursor = id-ul unui mesaj deja cunoscut de client (nu un token opac
 * codat) - server-ul rezolvă createdAt-ul lui și paginează prin
 * createdAt, cu id ca tiebreak pentru mesaje create în aceeași
 * milisecundă. Nu atinge schema/migrations - doar interogări noi peste
 * modelul Message existent.
 */
const DEFAULT_MESSAGE_PAGE_SIZE = 50;
const MAX_MESSAGE_PAGE_SIZE = 200;

const MESSAGE_SELECT = {
  id: true,
  body: true,
  createdAt: true,
  authorType: true,
  authorName: true,
  deletedByUserAt: true,
  attachments: {
    select: { id: true, filename: true, url: true, size: true, mime: true },
  },
};

function parsePageLimit(raw) {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_MESSAGE_PAGE_SIZE;
  return Math.min(n, MAX_MESSAGE_PAGE_SIZE);
}

/*
 * Rezolvă cursorul (id de mesaj) la { id, createdAt } în cadrul
 * thread-ului dat. Returnează null dacă id-ul nu există sau aparține
 * altui thread - apelantul trebuie să trateze asta ca 400, nu să
 * ignore silențios (cursor "robust" cerut explicit).
 */
async function resolveMessageCursor(threadId, cursorId) {
  if (!cursorId) return null;
  return prisma.message.findFirst({
    where: { id: String(cursorId), threadId },
    select: { id: true, createdAt: true },
  });
}

/*
 * Încarcă o pagină de mesaje pentru un thread, în funcție de query-ul
 * cerut de client:
 *  - ?before=<id>  -> pagină mai veche decât cursor (load older)
 *  - ?after=<id>   -> doar mesaje mai noi decât cursor (poll latest-only)
 *  - fără cursor   -> ultimele `limit` mesaje (load inițial)
 *
 * Returnează { items, hasMoreOlder } sau { error: "invalid_cursor" }.
 */
async function loadMessagePage(threadId, query) {
  const limit = parsePageLimit(query.limit);
  const beforeId = query.before ? String(query.before) : null;
  const afterId = query.after ? String(query.after) : null;

  if (beforeId) {
    const cursor = await resolveMessageCursor(threadId, beforeId);
    if (!cursor) return { error: "invalid_cursor" };

    const page = await prisma.message.findMany({
      where: {
        threadId,
        OR: [
          { createdAt: { lt: cursor.createdAt } },
          { createdAt: cursor.createdAt, id: { lt: cursor.id } },
        ],
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      select: MESSAGE_SELECT,
    });

    return {
      items: page.slice(0, limit).reverse(),
      hasMoreOlder: page.length > limit,
    };
  }

  if (afterId) {
    const cursor = await resolveMessageCursor(threadId, afterId);
    if (!cursor) return { error: "invalid_cursor" };

    const items = await prisma.message.findMany({
      where: {
        threadId,
        OR: [
          { createdAt: { gt: cursor.createdAt } },
          { createdAt: cursor.createdAt, id: { gt: cursor.id } },
        ],
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: limit,
      select: MESSAGE_SELECT,
    });

    return { items, hasMoreOlder: false };
  }

  const page = await prisma.message.findMany({
    where: { threadId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    select: MESSAGE_SELECT,
  });

  return {
    items: page.slice(0, limit).reverse(),
    hasMoreOlder: page.length > limit,
  };
}

/* =========================
   GET /api/user-inbox/unread-count
========================= */

router.get("/unread-count", async (req, res) => {
  const userId = req.user.sub;

  const rows = await prisma.$queryRaw`
    SELECT COUNT(m.*)::int as "count"
    FROM "MessageThread" t
    JOIN "Message" m ON m."threadId" = t.id
    WHERE t."userId" = ${userId}
      AND t."archivedByUser" = false
      AND t."deletedByUserAt" IS NULL
      AND m."deletedByUserAt" IS NULL
      AND m."authorType" <> 'USER'
      AND m."createdAt" > COALESCE(t."userLastReadAt", to_timestamp(0))
  `;

  const count = rows?.[0]?.count ?? 0;
  res.json({ count });
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

  const threadIds = threadsRaw.map((t) => t.id);
  const unreadByThreadId = new Map();

  if (threadIds.length) {
    const unreadRows = await prisma.$queryRaw`
      SELECT
        t.id as "threadId",
        COUNT(m.*)::int as "unreadCount"
      FROM "MessageThread" t
      LEFT JOIN "Message" m
        ON m."threadId" = t.id
       AND m."authorType" <> 'USER'
       AND m."deletedByUserAt" IS NULL
       AND m."createdAt" > COALESCE(t."userLastReadAt", to_timestamp(0))
      WHERE t.id = ANY(${threadIds})
        AND t."deletedByUserAt" IS NULL
      GROUP BY t.id
    `;

    for (const r of unreadRows || []) {
      unreadByThreadId.set(r.threadId, r.unreadCount);
    }
  }

  const threadsWithUnread = threadsRaw.map((t) => ({
    ...t,
    unreadCount: unreadByThreadId.get(t.id) ?? 0,
  }));

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

router.get(
  "/threads/:id/messages",
  async (req, res) => {
    const userId =
      req.user.sub;

    const threadId =
      String(
        req.params.id ||
          ""
      );

    try {
      const thread =
        await prisma.messageThread.findFirst({
          where: {
            id: threadId,
            userId,
            deletedByUserAt:
              null,
          },

          select: {
            id: true,
            serviceId: true,
            vendorLastReadAt:
              true,
            contactName: true,

            vendor: {
              select: {
                displayName:
                  true,
              },
            },

            service: {
              select: {
                id: true,
                title: true,

                profile: {
                  select: {
                    displayName:
                      true,
                    slug: true,
                    logoUrl: true,
                  },
                },
              },
            },
          },
        });

      if (!thread) {
        return res
          .status(404)
          .json({
            error:
              "Thread not found",
          });
      }

      const storeName =
        storeNameFromThread(
          thread
        );

      /*
       * Cererea de ofertă asociată
       * acestei conversații.
       */
      const quoteRequest =
        await prisma.quoteRequest.findFirst({
          where: {
            threadId,
            userId,
          },

          select: {
            id: true,
            status: true,
            source: true,

            quantity: true,

            requestData: true,
            quoteSchemaAnswers:
              true,

            eventDate: true,
            deliveryDeadline:
              true,

            budgetMin: true,
            budgetMax: true,

            createdAt: true,
            updatedAt: true,

            orderId: true,

            product: {
              select: {
                id: true,
                title: true,
                images: true,
                orderMode: true,
              },
            },

            offers: {
              where: {
                status: {
                  in: [
                    "SENT",
                    "ACCEPTED",
                    "REJECTED",
                  ],
                },
              },

              orderBy: {
                createdAt:
                  "desc",
              },

              select: {
                id: true,
                status: true,

                items: true,

                subtotal: true,
                shippingTotal:
                  true,
                total: true,

                currency: true,

                productionDays:
                  true,
                estimatedDelivery:
                  true,
                validUntil: true,

                notes: true,

                createdAt: true,
                updatedAt: true,
              },
            },
          },
        });

      const page = await loadMessagePage(threadId, req.query);

      if (page.error) {
        return res.status(400).json({ error: page.error });
      }

      const msgs = page.items;

      const items =
        msgs.map((message) => {
          const from =
            message.authorType ===
            "USER"
              ? "me"
              : "them";

          const readByPeer =
            from === "me" &&
            thread.vendorLastReadAt &&
            message.createdAt <=
              thread.vendorLastReadAt;

          const isDeletedForUser =
            Boolean(
              message.deletedByUserAt
            );

          return {
            id: message.id,
            threadId,

            from,

            authorName:
              message.authorType ===
              "USER"
                ? undefined
                : message.authorName ||
                  storeName,

            body:
              isDeletedForUser
                ? ""
                : message.body,

            createdAt:
              message.createdAt,

            readByPeer,

            deleted:
              isDeletedForUser,

            attachments:
              isDeletedForUser
                ? []
                : (
                    message.attachments ||
                    []
                  ).map(
                    attachmentPublicShape
                  ),
          };
        });

      return res.json({
        items,

        hasMoreOlder: page.hasMoreOlder,

        peerLastReadAt: thread.vendorLastReadAt,

        threadMeta: {
          id: thread.id,

          storeId:
            thread.serviceId ||
            null,

          storeName,

          storeSlug:
            thread.service
              ?.profile
              ?.slug ||
            null,

          storeLogoUrl:
            thread.service
              ?.profile
              ?.logoUrl ||
            null,
        },

        quoteRequest:
          quoteRequest
            ? {
                id:
                  quoteRequest.id,

                quoteRequestId:
                  quoteRequest.id,

                status:
                  quoteRequest.status,

                source:
                  quoteRequest.source,

                quantity:
                  quoteRequest.quantity,

                requestData:
                  quoteRequest.requestData ||
                  {},

                quoteSchemaAnswers:
                  quoteRequest.quoteSchemaAnswers ||
                  {},

                eventDate:
                  quoteRequest.eventDate,

                deliveryDeadline:
                  quoteRequest.deliveryDeadline,

                budgetMin:
                  quoteRequest.budgetMin,

                budgetMax:
                  quoteRequest.budgetMax,

                orderId:
                  quoteRequest.orderId ||
                  null,

                createdAt:
                  quoteRequest.createdAt,

                updatedAt:
                  quoteRequest.updatedAt,

                product:
                  quoteRequest.product
                    ? {
                        id:
                          quoteRequest
                            .product
                            .id,

                        title:
                          quoteRequest
                            .product
                            .title,

                        images:
                          quoteRequest
                            .product
                            .images ||
                          [],

                        orderMode:
                          quoteRequest
                            .product
                            .orderMode,
                      }
                    : null,

                offers:
                  Array.isArray(
                    quoteRequest.offers
                  )
                    ? quoteRequest.offers
                    : [],
              }
            : null,
      });
    } catch (error) {
      console.error(
        "GET /api/user-inbox/threads/:id/messages error:",
        error
      );

      return res
        .status(500)
        .json({
          error:
            "server_error",

          details:
            "Nu am putut procesa solicitarea.",
        });
    }
  }
);

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
  const { body, clientMessageId: rawClientMessageId } = req.body || {};

  if (!body || !String(body).trim()) {
    return res.status(400).json({ error: "Mesajul nu poate fi gol" });
  }

  if (String(body).length > MAX_MESSAGE_LENGTH) {
    return res.status(400).json({
      error: "Mesajul este prea lung. Maxim 5000 de caractere.",
    });
  }

  const clientMessageIdCheck = validateClientMessageId(rawClientMessageId);
  if (!clientMessageIdCheck.ok) {
    return res.status(400).json({ error: "invalid_client_message_id" });
  }
  const clientMessageId = clientMessageIdCheck.value;

  /*
   * ETAPA 5 - fast path de idempotency: ÎNAINTE de moderare (nu re-moderăm
   * un mesaj deja acceptat) și înainte de orice alt side-effect. Dacă
   * există deja un Message cu (threadId, clientMessageId), e un retry -
   * întoarcem exact același răspuns ca la create, fără să mai creăm nimic.
   */
  if (clientMessageId) {
    const existing = await prisma.message.findFirst({
      where: { threadId, clientMessageId },
      select: { id: true, createdAt: true },
    });
    if (existing) {
      return res.status(201).json({ ok: true, id: existing.id, createdAt: existing.createdAt });
    }
  }

  const moderation =
  await moderateMarketplaceMessage({
    text: body,
    senderType: "USER",
  });

if (
  !moderation.allowed
) {
  const technicalReasons =
    new Set([
      "text_moderation_failed",
      "text_moderation_invalid_response",
      "text_moderation_ambiguous_response",
    ]);

  const isTechnicalError =
    technicalReasons.has(
      moderation.reason
    );

  return res
    .status(
      isTechnicalError
        ? 503
        : 422
    )
    .json({
      error:
        isTechnicalError
          ? "moderation_unavailable"
          : "message_blocked",

      reason:
        moderation.reason ||
        "not_allowed",

      detections:
        moderation.detections ||
        [],

      message:
        isTechnicalError
          ? "Mesajul nu a putut fi verificat momentan și nu a fost trimis. Încearcă din nou peste câteva secunde."
          : "Mesajul nu poate fi trimis deoarece conține sau sugerează date de contact, comunicare, comandă ori plată în afara platformei.",
    });
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

  let msg;
  try {
    msg = await prisma.message.create({
      data: {
        threadId,
        vendorId: thread.vendorId,
        body: String(body).trim(),
        authorType: "USER",
        clientMessageId,
      },
      select: { id: true, createdAt: true, body: true },
    });
  } catch (err) {
    /*
     * ETAPA 5 - cursă reală: alt request cu același (threadId,
     * clientMessageId) a câștigat între fast-path și acest create.
     * Constrângerea DB e sursa de adevăr - întoarcem mesajul câștigător,
     * fără să mai rulăm actualizarea de thread/notificarea de mai jos
     * (aparțin request-ului care a creat efectiv rândul).
     */
    if (clientMessageId && isClientMessageIdConflict(err)) {
      const existing = await prisma.message.findFirst({
        where: { threadId, clientMessageId },
        select: { id: true, createdAt: true },
      });
      if (existing) {
        return res.status(201).json({ ok: true, id: existing.id, createdAt: existing.createdAt });
      }
    }
    throw err;
  }

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
for (const file of files) {
  const moderation =
    await moderateMarketplaceImage({
      buffer: file.buffer,
      mimeType: file.mimetype,
      filename: file.originalname,
      senderType: "USER",
    });

  if (
  !moderation.allowed
) {
  const invalidFileReasons =
    new Set([
      "missing_image",
      "invalid_image_type",
      "unsupported_image_type",
    ]);

  const technicalReasons =
    new Set([
      "image_moderation_failed",
      "image_moderation_invalid_response",
      "image_moderation_ambiguous_response",
    ]);

  const isInvalidFile =
    invalidFileReasons.has(
      moderation.reason
    );

  const isTechnicalError =
    technicalReasons.has(
      moderation.reason
    );

  return res
    .status(
      isTechnicalError
        ? 503
        : 422
    )
    .json({
      error:
        isTechnicalError
          ? "moderation_unavailable"
          : "attachment_blocked",

      reason:
        moderation.reason ||
        "not_allowed",

      detections:
        moderation.detections ||
        [],

      message:
        isTechnicalError
          ? "Imaginea nu a putut fi verificată momentan și nu a fost trimisă. Încearcă din nou peste câteva secunde."
          : isInvalidFile
            ? "Fișierul nu este o imagine acceptată. Încarcă o imagine JPG, PNG, WEBP sau GIF."
            : "Imaginea nu poate fi trimisă deoarece conține date de contact, linkuri, coduri QR sau referințe către platforme externe.",
    });
}
}
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
      attachments: result.created.map(attachmentPublicShape),
    });
  } catch (e) {
    console.error("POST /threads/:id/attachments error:", e);
    return res.status(500).json({
      error: "server_error",
      details: "Nu am putut procesa solicitarea.",
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
          /*
 * Datele de contact nu sunt expuse
 * în conversația marketplace.
 */
contactEmail:
  null,

contactPhone:
  null,
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

    const forceDownload = req.query.download === "1" || req.query.download === "true";

    res.setHeader("Content-Type", contentType);
    res.setHeader(
      "Content-Disposition",
      `${forceDownload ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(filename)}`
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

  if (String(body).length > MAX_MESSAGE_LENGTH) {
    return res.status(400).json({
      error: "Mesajul este prea lung. Maxim 5000 de caractere.",
    });
  }

  const moderation =
  await moderateMarketplaceMessage({
    text: body,
    senderType: "USER",
  });

if (
  !moderation.allowed
) {
  const technicalReasons =
    new Set([
      "text_moderation_failed",
      "text_moderation_invalid_response",
      "text_moderation_ambiguous_response",
    ]);

  const isTechnicalError =
    technicalReasons.has(
      moderation.reason
    );

  return res
    .status(
      isTechnicalError
        ? 503
        : 422
    )
    .json({
      error:
        isTechnicalError
          ? "moderation_unavailable"
          : "message_blocked",

      reason:
        moderation.reason ||
        "not_allowed",

      detections:
        moderation.detections ||
        [],

      message:
        isTechnicalError
          ? "Mesajul nu a putut fi verificat momentan și modificarea nu a fost salvată. Încearcă din nou peste câteva secunde."
          : "Mesajul nu poate fi modificat deoarece conține sau sugerează date de contact, comunicare, comandă ori plată în afara platformei.",
    });
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