// backend/src/routes/vendorInboxRoutes.js
import express from "express";
import { prisma } from "../db.js";
import { authRequired, enforceTokenVersion, requireRole } from "../api/auth.js";
import { createUserNotification } from "../services/notifications.js";
import {
  moderateMarketplaceMessage,
  moderateMarketplaceImage,
} from "../services/marketplaceMessageModeration.js";
import multer from "multer";
import crypto from "crypto";
import path from "path";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { Readable } from "stream";
import {
  attachSubscription,
  requireActiveSubscriptionForChat,
  requireChatEntitlement,
  assertChatQuotaOrThrow,
  bumpChatUsage,
} from "../middleware/chatGuards.js";

const router = express.Router();

/**
 * Toate rutele:
 * - necesită user logat
 * - verifică tokenVersion
 * - necesită rol VENDOR
 */
router.use(authRequired, enforceTokenVersion, requireRole("VENDOR"));
router.use(attachSubscription());

// helper: obține vendorId pentru userul logat (cache per request)
async function getVendorIdForUser(req) {
  if ("_vendorIdResolved" in req) return req._vendorIdResolved;

  const userId = req.user?.sub;
  if (!userId) {
    req._vendorIdResolved = null;
    return null;
  }

  const vendor = await prisma.vendor.findUnique({
    where: { userId },
    select: { id: true },
  });

  req._vendorIdResolved = vendor?.id || null;
  return req._vendorIdResolved;
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 10 }, // 25MB, max 10
});

const r2 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});
function getMonthlyLimit(subscription, key) {
  const value = subscription?.plan?.meta?.limits?.[key];

  if (value === -1) return null; // nelimitat
  if (typeof value === "number") return value;

  return null;
}

function startOfCurrentMonth() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

async function assertAttachmentQuotaOrThrow({ vendorId, subscription, filesCount }) {
  const limit = getMonthlyLimit(subscription, "attachmentsPerMonth");

  if (limit == null) return null;

  const used = await prisma.messageAttachment.count({
    where: {
      message: {
        vendorId,
        authorType: "VENDOR",
        createdAt: {
          gte: startOfCurrentMonth(),
        },
      },
    },
  });

  if (used + filesCount > limit) {
    return {
  status: 402,
  payload: {
    error: "attachments_limit_reached",
    reason: "attachments_limit_reached",
    limit,
    used,
    remaining: Math.max(0, limit - used),

    title: "Ai atins limita de atașamente",
    message:
      "Planul tău nu mai permite trimiterea altor atașamente în această lună.",
    cta: {
      label: "Modifică abonamentul",
      url: "/setari?tab=subscription",
    },
  },
};
  }

  return null;
}
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
    t?.service?.profile?.displayName ||
    t?.service?.title ||
    t?.vendor?.displayName ||
    "Magazin"
  );
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

// helper status enum -> string UI
function leadEnumToUi(leadStatus) {
  switch (leadStatus) {
    case "IN_DISCUSSION":
      return "in_discutii";
    case "OFFER_SENT":
      return "oferta_trimisa";
    case "RESERVED":
      return "rezervat";
    case "LOST":
      return "pierdut";
    case "NEW":
    default:
      return "nou";
  }
}

function otherVendorFromThread(thread, myVendorId) {
  if (!thread) return null;

  return String(thread.vendorId) === String(myVendorId)
    ? thread.recipientVendor
    : thread.vendor;
}

function vendorThreadAccessWhere(threadId, vendorId) {
  return {
    id: threadId,
    type: "VENDOR_TO_VENDOR",
    OR: [
      {
        vendorId,
        deletedByVendorAt: null,
      },
      {
        recipientVendorId: vendorId,
        deletedByRecipientVendorAt: null,
      },
    ],
  };
}

function currentVendorReadUpdate(thread, vendorId) {
  return String(thread.vendorId) === String(vendorId)
    ? { vendorLastReadAt: new Date() }
    : { recipientVendorLastReadAt: new Date() };
}

/**
 * Helper: verifică thread-ul vendorului și mesajul din thread
 * (doar dacă nu e șters pt vendor)
 */
async function getVendorThreadAndMessageOr404({ vendorId, threadId, messageId }) {
  const thread = await prisma.messageThread.findFirst({
    where: {
      id: threadId,
      type: "CUSTOMER",
      vendorId,
      deletedByVendorAt: null,
    },
    select: { id: true, followUpAt: true },
  });

  if (!thread) return { thread: null, message: null };

  const message = await prisma.message.findFirst({
    where: {
      id: messageId,
      threadId,
      deletedByVendorAt: null,
    },
    select: { id: true, authorType: true, createdAt: true },
  });

  return { thread, message: message || null };
}

/* =========================
   GET /api/inbox/unread-count
   ✅ ignoră mesajele șterse de vendor + thread-uri șterse de vendor
========================= */
router.get("/unread-count", async (req, res) => {
  const vendorId = await getVendorIdForUser(req);
  if (!vendorId) return res.json({ count: 0 });

  const rows = await prisma.$queryRaw`
    SELECT COUNT(m.*)::int as "count"
    FROM "MessageThread" t
    JOIN "Message" m ON m."threadId" = t.id
    WHERE t."type" = 'CUSTOMER'
      AND t."vendorId" = ${vendorId}
      AND t.archived = false
      AND t."deletedByVendorAt" IS NULL
      AND m."deletedByVendorAt" IS NULL
      AND m."authorType" <> 'VENDOR'
      AND m."createdAt" > COALESCE(t."vendorLastReadAt", to_timestamp(0))
  `;

  const count = rows?.[0]?.count ?? 0;
  return res.json({ count });
});

/* =========================
   GET /api/inbox/threads?scope=all|unread|archived&q=&status=&eventType=&period=&groupBy=
========================= */
router.get("/threads", async (req, res) => {
  const vendorId = await getVendorIdForUser(req);
  if (!vendorId) return res.status(403).json({ error: "no_vendor_for_user" });

  const {
    scope = "all",
    q = "",
    status = "all",
    eventType,
    period = "all",
    groupBy = "order",
  } = req.query;

 const where = {
  type: "CUSTOMER",
  vendorId,
  deletedByVendorAt: null,
  archived: scope === "archived" ? true : false,
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

  const statusEnum = mapStatusFilterToEnum(status);
  if (statusEnum) where.leadStatus = statusEnum;

  if (eventType && eventType !== "all") where.eventType = String(eventType);

  const now = new Date();
  if (period === "next_30") {
    const in30 = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    where.eventDate = { gte: now, lte: in30 };
  } else if (period === "past") {
    where.eventDate = { lt: now };
  }

  const threads = await prisma.messageThread.findMany({
    where,
    orderBy: [{ lastAt: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      userId: true,
      serviceId: true,
      contactName: true,
      contactPhone: true,
      contactEmail: true,
      lastMsg: true,
      lastAt: true,
      vendorLastReadAt: true,
      archived: true,

      user: { select: { firstName: true, lastName: true } },

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

  const threadIds = threads.map((t) => t.id);
  const unreadByThreadId = new Map();

  if (threadIds.length) {
    const unreadRows = await prisma.$queryRaw`
      SELECT
        t.id as "threadId",
        COUNT(m.*)::int as "unreadCount"
      FROM "MessageThread" t
      LEFT JOIN "Message" m
        ON m."threadId" = t.id
       AND m."authorType" <> 'VENDOR'
       AND m."deletedByVendorAt" IS NULL
       AND m."createdAt" > COALESCE(t."vendorLastReadAt", to_timestamp(0))
      WHERE t.id = ANY(${threadIds})
        AND t."deletedByVendorAt" IS NULL
      GROUP BY t.id
    `;

    for (const r of unreadRows || []) {
      unreadByThreadId.set(r.threadId, r.unreadCount);
    }
  }

  const threadsWithUnread = threads.map((t) => ({
    ...t,
    unreadCount: unreadByThreadId.get(t.id) ?? 0,
  }));

  const filteredByScope =
    scope === "unread"
      ? threadsWithUnread.filter((t) => (t.unreadCount || 0) > 0)
      : threadsWithUnread;

  if (groupBy !== "user") {
    const items = filteredByScope.map((t) => {
      const userName = t.user
        ? [t.user.firstName, t.user.lastName].filter(Boolean).join(" ")
        : null;

      return {
        id: t.id,
        threadId: t.id,
        userId: t.userId,

        name: userName || t.contactName || "Vizitator",
        phone: t.contactPhone || null,

        storeId: t.serviceId || null,
        storeName: storeNameFromThread(t),
        storeSlug: t.service?.profile?.slug || null,
        storeLogoUrl: t.service?.profile?.logoUrl || null,

        lastMsg: t.lastMsg || null,
        lastAt: t.lastAt,
        unreadCount: t.unreadCount,
        archived: t.archived,

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
      };
    });

    return res.json({ items });
  }

  const grouped = new Map();

  for (const t of filteredByScope) {
    const hasUser = !!t.userId;
    const key = hasUser ? `user:${t.userId}` : `thread:${t.id}`;

    if (!grouped.has(key)) {
      grouped.set(key, { key, userId: t.userId || null, threads: [] });
    }

    grouped.get(key).threads.push(t);
  }

  const items = [];

  for (const [, group] of grouped) {
    const { key, userId, threads: ts } = group;

    if (userId && key.startsWith("user:")) {
      const sorted = ts.slice().sort((a, b) => (+b.lastAt || 0) - (+a.lastAt || 0));
      const primary = sorted[0];

      const userName = primary.user
        ? [primary.user.firstName, primary.user.lastName].filter(Boolean).join(" ")
        : null;

      const totalUnread = sorted.reduce((sum, t) => sum + (t.unreadCount || 0), 0);

      const threadsForUser = sorted.map((t) => ({
        threadId: t.id,
        archived: t.archived,
        unreadCount: t.unreadCount || 0,

        storeId: t.serviceId || null,
        storeName: storeNameFromThread(t),
        storeSlug: t.service?.profile?.slug || null,
        storeLogoUrl: t.service?.profile?.logoUrl || null,

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
        id: key,
        userId,
        name: userName || primary.contactName || "Vizitator",
        phone: primary.contactPhone || null,

        storeId: primary.serviceId || null,
        storeName: storeNameFromThread(primary),
        storeSlug: primary.service?.profile?.slug || null,
        storeLogoUrl: primary.service?.profile?.logoUrl || null,

        lastMsg: primary.lastMsg || null,
        lastAt: primary.lastAt,
        unreadCount: totalUnread,
        archived: primary.archived,

        eventDate: primary.eventDate,
        eventType: primary.eventType,
        eventLocation: primary.eventLocation,
        budgetMin: primary.budgetMin,
        budgetMax: primary.budgetMax,
        status: leadEnumToUi(primary.leadStatus),
        tags: primary.tags || [],
        followUpAt: primary.followUpAt,
        internalNote: primary.internalNote || "",

        orderSummary: primary.order
          ? {
              id: primary.order.id,
              status: primary.order.status,
              createdAt: primary.order.createdAt,
              shipments: primary.order.shipments,
            }
          : null,

        orderCount: threadsForUser.length,
        threads: threadsForUser,
      });
    } else {
      const t = ts[0];
      const userName = t.user
        ? [t.user.firstName, t.user.lastName].filter(Boolean).join(" ")
        : null;

      items.push({
        id: t.id,
        threadId: t.id,
        userId: t.userId,
        name: userName || t.contactName || "Vizitator",
        phone: t.contactPhone || null,

        storeId: t.serviceId || null,
        storeName: storeNameFromThread(t),
        storeSlug: t.service?.profile?.slug || null,
        storeLogoUrl: t.service?.profile?.logoUrl || null,

        lastMsg: t.lastMsg || null,
        lastAt: t.lastAt,
        unreadCount: t.unreadCount,
        archived: t.archived,

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

        orderCount: 1,
        threads: [
          {
            threadId: t.id,
            archived: t.archived,
            unreadCount: t.unreadCount || 0,

            storeId: t.serviceId || null,
            storeName: storeNameFromThread(t),
            storeSlug: t.service?.profile?.slug || null,
            storeLogoUrl: t.service?.profile?.logoUrl || null,

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
          },
        ],
      });
    }
  }

  items.sort((a, b) => (+b.lastAt || 0) - (+a.lastAt || 0));
  return res.json({ items });
});
/**
 * GET /api/inbox/threads/:id/messages
 * ✅ include attachments
 * ✅ include placeholder pentru mesaje șterse de user
 */
router.get("/threads/:id/messages", async (req, res) => {
  const vendorId = await getVendorIdForUser(req);
  if (!vendorId) return res.status(403).json({ error: "no_vendor_for_user" });

  const { id } = req.params;

 const thread = await prisma.messageThread.findFirst({
  where: {
    id,
    type: "CUSTOMER",
    vendorId,
    deletedByVendorAt: null,
  },

  select: {
    id: true,
    userLastReadAt: true,
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

  if (!thread) return res.status(404).json({ error: "Thread not found" });
const quoteRequest =
  await prisma.quoteRequest.findFirst({
    where: {
      threadId: id,
      vendorId,
    },

    select: {
      id: true,
      status: true,
      source: true,

      quantity: true,

      requestData: true,
      quoteSchemaAnswers: true,

      eventDate: true,
      deliveryDeadline: true,

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
          createdAt: "desc",
        },

        select: {
          id: true,
          status: true,

          items: true,

          subtotal: true,
          shippingTotal: true,
          total: true,

          currency: true,

          productionDays: true,
          estimatedDelivery: true,
          validUntil: true,

          notes: true,

          createdAt: true,
          updatedAt: true,
        },
      },
    },
  });
  const msgs = await prisma.message.findMany({
    where: { threadId: id, deletedByVendorAt: null },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      body: true,
      createdAt: true,
      authorType: true,
      authorName: true,
      deletedByUserAt: true,
      authorUser: { select: { firstName: true, lastName: true } },
      attachments: {
        select: { id: true, filename: true, url: true, size: true, mime: true },
      },
    },
  });

  const items = msgs.map((m) => {
    const isVendor = m.authorType === "VENDOR";
    const from = isVendor ? "me" : "them";

    const authorName =
      m.authorType === "VISITOR"
        ? m.authorName || "Vizitator"
        : [m.authorUser?.firstName, m.authorUser?.lastName].filter(Boolean).join(" ") ||
          m.authorName ||
          "Utilizator";

    const readByPeer =
      from === "me" && thread.userLastReadAt && m.createdAt <= thread.userLastReadAt;

    const isDeletedByUser = !!m.deletedByUserAt;

    return {
      id: m.id,
      threadId: id,
      from,
      authorName: isVendor ? undefined : authorName,
      body: isDeletedByUser ? "🚫 Mesaj șters de utilizator" : m.body,
      createdAt: m.createdAt,
      readByPeer,
      attachments: isDeletedByUser
        ? []
        : (m.attachments || []).map((a) => ({
            id: a.id,
            name: a.filename,
            url: a.url,
            size: a.size,
            mime: a.mime,
          })),
      deletedByUserAt: m.deletedByUserAt,
    };
  });

 return res.json({
  items,

  threadMeta: {
    id: thread.id,

    storeId:
      thread.serviceId ||
      null,

    storeName:
      storeNameFromThread(thread),

    storeSlug:
      thread.service?.profile
        ?.slug ||
      null,

    storeLogoUrl:
      thread.service?.profile
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
                      .product.id,

                  title:
                    quoteRequest
                      .product.title,

                  images:
                    quoteRequest
                      .product.images ||
                    [],

                  orderMode:
                    quoteRequest
                      .product.orderMode,
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
});

/**
 * GET /api/inbox/user-conversations/:userId/messages
 * ✅ include placeholder pentru mesaje șterse de user
 */
router.get("/user-conversations/:userId/messages", async (req, res) => {
  const vendorId = await getVendorIdForUser(req);
  if (!vendorId) return res.status(403).json({ error: "no_vendor_for_user" });

  const userId = String(req.params.userId || "");
  if (!userId) return res.status(400).json({ error: "missing_user_id" });

  const threads = await prisma.messageThread.findMany({
  where: {
    type: "CUSTOMER",
    vendorId,
    userId,
    deletedByVendorAt: null,
  },
  select: {
    id: true,
    userLastReadAt: true,
    order: { select: { id: true, shipments: { select: { id: true } } } },
  },
});

  if (!threads.length) return res.json({ items: [] });

  const threadIds = threads.map((t) => t.id);

  const msgs = await prisma.message.findMany({
    where: { threadId: { in: threadIds }, deletedByVendorAt: null },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      threadId: true,
      body: true,
      createdAt: true,
      authorType: true,
      authorName: true,
      deletedByUserAt: true,
      authorUser: { select: { firstName: true, lastName: true } },
      attachments: {
        select: { id: true, filename: true, url: true, size: true, mime: true },
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
        : [m.authorUser?.firstName, m.authorUser?.lastName].filter(Boolean).join(" ") ||
          m.authorName ||
          "Utilizator";

    const readByPeer =
      from === "me" && meta?.userLastReadAt && m.createdAt <= meta.userLastReadAt;

    const order = meta?.order;
    const shipment = order?.shipments?.[0];
    const baseId = shipment?.id || order?.id || null;
    const orderShortId = baseId ? baseId.slice(-6).toUpperCase() : null;

    const isDeletedByUser = !!m.deletedByUserAt;

    return {
      id: m.id,
      threadId: m.threadId,
      from,
      authorName: isVendor ? undefined : authorName,
      body: isDeletedByUser ? "🚫 Mesaj șters de utilizator" : m.body,
      createdAt: m.createdAt,
      readByPeer,
      orderId: order?.id || null,
      orderShortId,
      attachments: isDeletedByUser
        ? []
        : (m.attachments || []).map((a) => ({
            id: a.id,
            name: a.filename,
            url: a.url,
            size: a.size,
            mime: a.mime,
          })),
      deletedByUserAt: m.deletedByUserAt,
    };
  });

  return res.json({ items });
});

/**
 * PATCH /api/inbox/threads/:id/read
 */
router.patch("/threads/:id/read", async (req, res) => {
  const vendorId = await getVendorIdForUser(req);
  if (!vendorId) return res.status(403).json({ error: "no_vendor_for_user" });

  const { id } = req.params;

  const thread = await prisma.messageThread.findFirst({
  where: {
    id,
    type: "CUSTOMER",
    vendorId,
    deletedByVendorAt: null,
  },
  select: { id: true },
});
  if (!thread) return res.status(404).json({ error: "Thread not found" });

  await prisma.messageThread.update({
    where: { id },
    data: { vendorLastReadAt: new Date() },
  });

  return res.json({ ok: true });
});

/**
 * POST /api/inbox/threads/:id/messages
 */
router.post(
  "/threads/:id/messages",
  requireActiveSubscriptionForChat(),
  requireChatEntitlement(),
  async (req, res) => {
    const vendorId = await getVendorIdForUser(req);
    if (!vendorId) return res.status(403).json({ error: "no_vendor_for_user" });

    const { id } = req.params;
    const { body } = req.body || {};

    if (!body || !String(body).trim()) {
      return res.status(400).json({ error: "Mesajul nu poate fi gol" });
    }

    const moderation =
  await moderateMarketplaceMessage({
    text: body,
    senderType: "VENDOR",
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

    const quotaErr = await assertChatQuotaOrThrow({
      vendorId,
      subscription: req.subscription,
    });

    if (quotaErr) return res.status(quotaErr.status).json(quotaErr.payload);

    try {
      const out = await prisma.$transaction(async (tx) => {
       const thread = await tx.messageThread.findFirst({
  where: {
    id,
    type: "CUSTOMER",
    vendorId,
    deletedByVendorAt: null,
  },
  select: {
    id: true,
    userId: true,
    serviceId: true,
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

        if (!thread) {
          return { error: { status: 404, payload: { error: "Thread not found" } } };
        }

        const msg = await tx.message.create({
          data: {
            threadId: id,
            vendorId,
            body: String(body).trim(),
            authorType: "VENDOR",
          },
          select: { id: true, body: true, createdAt: true },
        });

        await tx.messageThread.update({
          where: { id },
          data: {
            lastMsg: msg.body,
            lastAt: msg.createdAt,
            vendorLastReadAt: new Date(),
          },
        });

        await bumpChatUsage({ tx, vendorId, incSent: 1 });

        return { thread, msg };
      });

      if (out?.error) return res.status(out.error.status).json(out.error.payload);

      try {
        if (out.thread.userId) {
          const storeName = storeNameFromThread(out.thread);

          await createUserNotification(out.thread.userId, {
            type: "message",
            title: `Mesaj nou de la ${storeName}`,
            body: out.msg.body.slice(0, 140),
            link: `/cont/mesaje?threadId=${out.thread.id}`,
          });
        }
      } catch (e) {
        console.error("Nu am putut crea notificarea pentru user (mesaj nou):", e);
      }

      return res.status(201).json({
        ok: true,
        id: out.msg.id,
        createdAt: out.msg.createdAt,
      });
    } catch (e) {
      console.error("vendor send message error:", e);
      return res.status(500).json({
        error: "server_error",
        message:
          "Ups… a apărut o problemă tehnică. Te rog încearcă din nou în câteva secunde.",
      });
    }
  }
);

/**
 * PATCH /api/inbox/threads/:id/messages/:mid (edit)
 */
router.patch("/threads/:id/messages/:mid", async (req, res) => {
  const vendorId = await getVendorIdForUser(req);
  if (!vendorId) return res.status(403).json({ error: "no_vendor_for_user" });

  const { id: threadId, mid: messageId } = req.params;
  const newBody = (req.body?.body || "").toString().trim();

  if (!newBody) {
    return res.status(400).json({ error: "bad_request", details: "body_required" });
  }
const moderation =
  await moderateMarketplaceMessage({
    text: newBody,
    senderType: "VENDOR",
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
  const { thread, message } = await getVendorThreadAndMessageOr404({
    vendorId,
    threadId,
    messageId,
  });

  if (!thread || !message) return res.status(404).json({ error: "not_found" });
  if (message.authorType !== "VENDOR") return res.status(403).json({ error: "forbidden" });

  try {
    await prisma.$transaction(async (tx) => {
      await tx.message.update({ where: { id: messageId }, data: { body: newBody } });

      const last = await tx.message.findFirst({
        where: { threadId, deletedByVendorAt: null },
        orderBy: { createdAt: "desc" },
        select: { id: true, createdAt: true },
      });

      if (last?.id === messageId) {
        await tx.messageThread.update({
          where: { id: threadId },
          data: { lastMsg: newBody, lastAt: last.createdAt },
        });
      }
    });

    return res.json({ ok: true });
  } catch (e) {
    console.error("vendor edit message error:", e);
    return res.status(500).json({ error: "server_error" });
  }
});

/**
 * DELETE /api/inbox/threads/:id/messages/:mid
 * ✅ soft-delete message pentru vendor
 * ✅ recompute last GLOBAL (cu placeholder dacă ultimul e șters de user)
 */
router.delete("/threads/:id/messages/:mid", async (req, res) => {
  const vendorId = await getVendorIdForUser(req);
  if (!vendorId) return res.status(403).json({ error: "no_vendor_for_user" });

  const { id: threadId, mid: messageId } = req.params;

  const { thread, message } = await getVendorThreadAndMessageOr404({
    vendorId,
    threadId,
    messageId,
  });

  if (!thread || !message) return res.status(404).json({ error: "not_found" });
  if (message.authorType !== "VENDOR") return res.status(403).json({ error: "forbidden" });

  try {
    await prisma.$transaction(async (tx) => {
      const now = new Date();

      await tx.message.update({
        where: { id: messageId },
        data: { deletedByVendorAt: now },
      });

      const lastGlobal = await tx.message.findFirst({
        where: { threadId },
        orderBy: { createdAt: "desc" },
        select: { body: true, createdAt: true, deletedByUserAt: true, deletedByVendorAt: true },
      });

      let lastMsgLabel = lastGlobal?.body || null;
      if (lastGlobal?.deletedByVendorAt) lastMsgLabel = null;
      if (lastGlobal?.deletedByUserAt) lastMsgLabel = "🚫 Mesaj șters de utilizator";

      await tx.messageThread.update({
        where: { id: threadId },
        data: {
          lastMsg: lastMsgLabel,
          lastAt: lastGlobal?.createdAt || null,
        },
      });
    });

    return res.json({ ok: true });
  } catch (e) {
    console.error("vendor delete message error:", e);
    return res.status(500).json({ error: "server_error" });
  }
});

/**
 * PATCH /api/inbox/threads/:id/archive
 */
router.patch("/threads/:id/archive", async (req, res) => {
  const vendorId = await getVendorIdForUser(req);
  if (!vendorId) return res.status(403).json({ error: "no_vendor_for_user" });

  const { id } = req.params;
  const { archived = true } = req.body || {};

 const thread = await prisma.messageThread.findFirst({
  where: {
    id,
    type: "CUSTOMER",
    vendorId,
    deletedByVendorAt: null,
  },
  select: { id: true },
});
  if (!thread) return res.status(404).json({ error: "Thread not found" });

  await prisma.messageThread.update({
    where: { id },
    data: { archived: !!archived },
  });

  return res.json({ ok: true });
});

/**
 * GET /api/inbox/planning/leads?from=YYYY-MM-DD&to=YYYY-MM-DD
 */
router.get(
  "/planning/leads",
  requireActiveSubscriptionForChat(),
  requireChatEntitlement(),
  async (req, res) => {
    const vendorId = await getVendorIdForUser(req);
    if (!vendorId) return res.status(403).json({ error: "no_vendor_for_user" });

    const raw = req.subscription?.plan?.entitlements || {};
    const hasAdvanced = !!(raw.advancedChat ?? raw.advanced ?? false);

    if (!hasAdvanced) {
      return res.json({ items: [], locked: true });
    }

    const { from, to } = req.query;
    const now = new Date();
    const defaultFrom = now;
    const defaultTo = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);

    const fromDate = from ? new Date(from) : defaultFrom;
    const toDate = to ? new Date(to) : defaultTo;

    const threads = await prisma.messageThread.findMany({
     where: {
  type: "CUSTOMER",
  vendorId,
  deletedByVendorAt: null,
  eventDate: { gte: fromDate, lte: toDate },
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
        user: { select: { firstName: true, lastName: true } },
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

      return {
        id: t.id,
        name: userName || t.contactName || "Vizitator",
        phone: t.contactPhone || null,
        eventDate: t.eventDate,
        eventType: t.eventType,
        eventLocation: t.eventLocation,
        budgetMin: t.budgetMin,
        budgetMax: t.budgetMax,
        status: leadEnumToUi(t.leadStatus),
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

    return res.json({ items });
  }
);

/**
 * POST /api/inbox/ensure-thread-from-order/:orderId
 */
router.post("/ensure-thread-from-order/:orderId", async (req, res) => {
  const vendorId = await getVendorIdForUser(req);
  if (!vendorId) return res.status(403).json({ error: "no_vendor_for_user" });

  const orderId = String(req.params.orderId || "");
  if (!orderId) return res.status(400).json({ error: "missing_order_id" });

  const shipment = await prisma.shipment.findFirst({
    where: { orderId, vendorId },
    include: { order: true },
  });

  if (!shipment || !shipment.order) {
    return res.status(404).json({ error: "order_not_found_for_vendor" });
  }

  const order = shipment.order;
  const shipping = order.shippingAddress || {};
  const userId = order.userId || null;

  let thread = await prisma.messageThread.findFirst({
  where: {
    type: "CUSTOMER",
    vendorId,
    orderId: order.id,
    userId,
    deletedByVendorAt: null,
  },
});

  if (!thread) {
    const deletedThread = await prisma.messageThread.findFirst({
  where: {
    type: "CUSTOMER",
    vendorId,
    orderId: order.id,
    userId,
    deletedByVendorAt: { not: null },
  },
  select: { id: true },
});

    if (deletedThread) {
      await prisma.messageThread.update({
        where: { id: deletedThread.id },
        data: { deletedByVendorAt: null, archived: false },
      });

      return res.json({ ok: true, threadId: deletedThread.id });
    }
  }

  if (!thread) {
    thread = await prisma.messageThread.create({
  data: {
    type: "CUSTOMER",
    vendorId,
    userId,
    orderId: order.id,
    contactName: shipping.name || null,
    contactEmail: shipping.email || null,
    contactPhone: shipping.phone || null,
    deletedByVendorAt: null,
  },
});
  }

  return res.json({ ok: true, threadId: thread.id });
});

/**
 * POST /api/inbox/threads/:id/attachments
 */
router.post(
  "/threads/:id/attachments",
  requireActiveSubscriptionForChat(),
  requireChatEntitlement({ attachments: true }),
  upload.array("files", 10),
  async (req, res) => {
    const vendorId = await getVendorIdForUser(req);
    if (!vendorId) return res.status(403).json({ error: "no_vendor_for_user" });

    const quotaErr = await assertChatQuotaOrThrow({
      vendorId,
      subscription: req.subscription,
    });

    if (quotaErr) return res.status(quotaErr.status).json(quotaErr.payload);

    const threadId = String(req.params.id || "");
    if (!threadId) return res.status(400).json({ error: "missing_thread_id" });

    const thread = await prisma.messageThread.findFirst({
  where: {
    id: threadId,
    type: "CUSTOMER",
    vendorId,
    deletedByVendorAt: null,
  },
  select: {
    id: true,
    userId: true,
    serviceId: true,
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

    const files = Array.isArray(req.files) ? req.files : [];
    if (!files.length) return res.status(400).json({ error: "no_files" });
    for (const file of files) {
  const moderation =
    await moderateMarketplaceImage({
      buffer: file.buffer,
      mimeType: file.mimetype,
      filename: file.originalname,
      senderType: "VENDOR",
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
const attachmentQuotaErr = await assertAttachmentQuotaOrThrow({
  vendorId,
  subscription: req.subscription,
  filesCount: files.length,
});

if (attachmentQuotaErr) {
  return res.status(attachmentQuotaErr.status).json(attachmentQuotaErr.payload);
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
            vendorId,
            authorType: "VENDOR",
            body: "📎 Atașament",
          },
          select: { id: true, createdAt: true },
        });

        const createdAttachments = [];

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

          createdAttachments.push(att);
        }

        const lastMsgLabel =
          createdAttachments.length === 1
            ? `📎 ${createdAttachments[0].filename}`
            : `📎 ${createdAttachments.length} atașamente`;

        await tx.messageThread.update({
          where: { id: threadId },
          data: {
            lastMsg: lastMsgLabel,
            lastAt: msg.createdAt,
            vendorLastReadAt: new Date(),
          },
        });

        await bumpChatUsage({ tx, vendorId, incSent: 1 });

        return { msg, createdAttachments };
      });

      try {
        if (thread.userId) {
          const storeName = storeNameFromThread(thread);

          await createUserNotification(thread.userId, {
            type: "message",
            title: `Atașament nou de la ${storeName}`,
            body:
              result.createdAttachments.length === 1
                ? `📎 ${result.createdAttachments[0].filename}`
                : `📎 ${result.createdAttachments.length} fișiere atașate`,
            link: `/cont/mesaje?threadId=${threadId}`,
          });
        }
      } catch (e) {
        console.error("Nu am putut crea notificarea pentru user (atașament):", e);
      }

      return res.status(201).json({
        ok: true,
        messageId: result.msg.id,
        createdAt: result.msg.createdAt,
        attachments: result.createdAttachments.map((a) => ({
          id: a.id,
          name: a.filename,
          url: a.url,
          size: a.size,
          mime: a.mime,
        })),
      });
    } catch (e) {
      console.error("upload attachments error:", e);
      return res.status(500).json({ error: "server_error" });
    }
  }
);

/**
 * GET /api/inbox/attachments/:attId/download
 */
router.get("/attachments/:attId/download", async (req, res) => {
  try {
    const vendorId = await getVendorIdForUser(req);
    if (!vendorId) return res.status(403).json({ error: "no_vendor_for_user" });

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
            deletedByVendorAt: true,
            deletedByUserAt: true,
           thread: {
  select: {
    vendorId: true,
    recipientVendorId: true,
    type: true,
  },
},
          },
        },
      },
    });

    if (!att || !att.url) return res.status(404).json({ error: "not_found" });

    const thread = att.message?.thread;

const canAccess =
  thread?.type === "CUSTOMER"
    ? String(thread.vendorId || "") === String(vendorId)
    : thread?.type === "VENDOR_TO_VENDOR" &&
      (String(thread.vendorId || "") === String(vendorId) ||
        String(thread.recipientVendorId || "") === String(vendorId));

if (!canAccess) {
  return res.status(403).json({ error: "forbidden" });
}

    if (att.message?.deletedByVendorAt || att.message?.deletedByUserAt) {
      return res.status(404).json({ error: "not_found" });
    }

    const upstream = await fetch(att.url);
    if (!upstream.ok || !upstream.body) return res.status(502).json({ error: "upstream_failed" });

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
    console.error("download attachment error:", e);
    return res.status(500).json({ error: "server_error" });
  }
});

router.patch(
  "/threads/:id/meta-basic",
  requireActiveSubscriptionForChat(),
  requireChatEntitlement(),
  async (req, res) => {
    const vendorId = await getVendorIdForUser(req);
    if (!vendorId) return res.status(403).json({ error: "no_vendor_for_user" });

    const { id } = req.params;
    const { tags, eventDate, eventType, eventLocation, budgetMin, budgetMax } = req.body || {};

    const thread = await prisma.messageThread.findFirst({
  where: {
    id,
    type: "CUSTOMER",
    vendorId,
    deletedByVendorAt: null,
  },
  select: { id: true },
});

    if (!thread) return res.status(404).json({ error: "Thread not found" });

    const data = {};
    if (Array.isArray(tags)) data.tags = tags.map((t) => String(t).trim()).filter(Boolean);

    if (eventDate === null) data.eventDate = null;
    else if (eventDate) {
      const d = new Date(eventDate);
      if (!isNaN(d)) data.eventDate = d;
    }

    if (typeof eventType === "string") data.eventType = eventType || null;
    if (typeof eventLocation === "string") data.eventLocation = eventLocation || null;

    if (budgetMin !== undefined) {
      const v = Number(budgetMin);
      data.budgetMin = Number.isFinite(v) ? v : null;
    }
    if (budgetMax !== undefined) {
      const v = Number(budgetMax);
      data.budgetMax = Number.isFinite(v) ? v : null;
    }

    await prisma.messageThread.update({ where: { id }, data });
    return res.json({ ok: true });
  }
);

router.patch(
  "/threads/:id/meta-advanced",
  requireActiveSubscriptionForChat(),
  requireChatEntitlement({ advanced: true }),
  async (req, res) => {
    const vendorId = await getVendorIdForUser(req);
    if (!vendorId) return res.status(403).json({ error: "no_vendor_for_user" });

    const { id } = req.params;
    const { status, followUpAt, internalNote } = req.body || {};

    const thread = await prisma.messageThread.findFirst({
  where: {
    id,
    type: "CUSTOMER",
    vendorId,
    deletedByVendorAt: null,
  },
  select: { id: true, followUpAt: true },
});
    if (!thread) return res.status(404).json({ error: "Thread not found" });

    const data = {};

    if (typeof status === "string") {
      const enumVal = mapStatusFilterToEnum(status);
      if (enumVal) data.leadStatus = enumVal;
    }

    if (followUpAt === null) {
      const oldTs = thread.followUpAt ? new Date(thread.followUpAt).getTime() : null;
      data.followUpAt = null;
      if (oldTs !== null) data.followUpNotifiedAt = null;
    } else if (followUpAt) {
      const d = new Date(followUpAt);
      if (!isNaN(d)) {
        const oldTs = thread.followUpAt ? new Date(thread.followUpAt).getTime() : null;
        const newTs = d.getTime();
        data.followUpAt = d;
        if (oldTs !== newTs) data.followUpNotifiedAt = null;
      }
    }

    if (typeof internalNote === "string") data.internalNote = internalNote;

    await prisma.messageThread.update({ where: { id }, data });
    return res.json({ ok: true });
  }
);

/* =========================
   Vendor ↔ Vendor threads
========================= */

router.post("/ensure-vendor-thread", async (req, res) => {
  const vendorId = await getVendorIdForUser(req);
  if (!vendorId) return res.status(403).json({ error: "no_vendor_for_user" });

  const recipientVendorId = String(req.body?.recipientVendorId || "");

  if (!recipientVendorId) {
    return res.status(400).json({ error: "missing_recipient_vendor_id" });
  }

  if (recipientVendorId === vendorId) {
    return res.status(400).json({ error: "cannot_message_self" });
  }

  const recipient = await prisma.vendor.findFirst({
    where: { id: recipientVendorId, isActive: true },
    select: { id: true },
  });

  if (!recipient) {
    return res.status(404).json({ error: "recipient_vendor_not_found" });
  }

  let thread = await prisma.messageThread.findFirst({
    where: {
      type: "VENDOR_TO_VENDOR",
      userId: null,
      OR: [
        { vendorId, recipientVendorId },
        { vendorId: recipientVendorId, recipientVendorId: vendorId },
      ],
    },
    select: {
      id: true,
      vendorId: true,
      recipientVendorId: true,
    },
  });

  if (!thread) {
    thread = await prisma.messageThread.create({
      data: {
        type: "VENDOR_TO_VENDOR",
        vendorId,
        recipientVendorId,
        userId: null,
        archived: false,
      },
      select: { id: true },
    });
  } else {
    await prisma.messageThread.update({
      where: { id: thread.id },
      data:
        String(thread.vendorId) === String(vendorId)
          ? { deletedByVendorAt: null }
          : { deletedByRecipientVendorAt: null },
    });
  }

  return res.json({ ok: true, threadId: thread.id });
});

router.get("/vendor-threads", async (req, res) => {
  const vendorId = await getVendorIdForUser(req);
  if (!vendorId) return res.status(403).json({ error: "no_vendor_for_user" });

  const { scope = "all", q = "" } = req.query;

  const threads = await prisma.messageThread.findMany({
    where: {
      type: "VENDOR_TO_VENDOR",
      OR: [
        { vendorId, deletedByVendorAt: null },
        { recipientVendorId: vendorId, deletedByRecipientVendorAt: null },
      ],
      ...(q
        ? {
            AND: [
              {
                OR: [
                  { lastMsg: { contains: String(q), mode: "insensitive" } },
                  {
                    vendor: {
                      displayName: { contains: String(q), mode: "insensitive" },
                    },
                  },
                  {
                    recipientVendor: {
                      displayName: { contains: String(q), mode: "insensitive" },
                    },
                  },
                ],
              },
            ],
          }
        : {}),
    },
    orderBy: [{ lastAt: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      vendorId: true,
      recipientVendorId: true,
      lastMsg: true,
      lastAt: true,
      vendorLastReadAt: true,
      recipientVendorLastReadAt: true,
      vendor: {
        select: { id: true, displayName: true, logoUrl: true },
      },
      recipientVendor: {
        select: { id: true, displayName: true, logoUrl: true },
      },
    },
  });

  const threadIds = threads.map((t) => t.id);
  const unreadByThreadId = new Map();

  if (threadIds.length) {
    const unreadRows = await prisma.$queryRaw`
      SELECT
        t.id as "threadId",
        COUNT(m.*)::int as "unreadCount"
      FROM "MessageThread" t
      LEFT JOIN "Message" m
        ON m."threadId" = t.id
       AND m."deletedByVendorAt" IS NULL
       AND m."authorType" = 'VENDOR'
       AND m."senderVendorId" IS NOT NULL
       AND m."senderVendorId" <> ${vendorId}
       AND m."createdAt" > CASE
          WHEN t."vendorId" = ${vendorId}
            THEN COALESCE(t."vendorLastReadAt", to_timestamp(0))
          ELSE COALESCE(t."recipientVendorLastReadAt", to_timestamp(0))
       END
      WHERE t.id = ANY(${threadIds})
      GROUP BY t.id
    `;

    for (const r of unreadRows || []) {
      unreadByThreadId.set(r.threadId, r.unreadCount);
    }
  }

  let items = threads.map((t) => {
    const other = otherVendorFromThread(t, vendorId);

    return {
      id: t.id,
      threadId: t.id,
      type: "vendor_vendor",
      vendorId: other?.id || null,
      name: other?.displayName || "Vendor",
      logoUrl: other?.logoUrl || null,
      lastMsg: t.lastMsg || null,
      lastAt: t.lastAt,
      unreadCount: unreadByThreadId.get(t.id) || 0,
    };
  });

  if (scope === "unread") {
    items = items.filter((item) => item.unreadCount > 0);
  }

  return res.json({ items });
});

router.get("/vendor-threads/:id/messages", async (req, res) => {
  const vendorId = await getVendorIdForUser(req);
  if (!vendorId) return res.status(403).json({ error: "no_vendor_for_user" });

  const threadId = String(req.params.id || "");

  const thread = await prisma.messageThread.findFirst({
    where: vendorThreadAccessWhere(threadId, vendorId),
    select: {
      id: true,
      vendorId: true,
      recipientVendorId: true,
      vendorLastReadAt: true,
      recipientVendorLastReadAt: true,
      vendor: {
        select: { id: true, displayName: true, logoUrl: true },
      },
      recipientVendor: {
        select: { id: true, displayName: true, logoUrl: true },
      },
    },
  });

  if (!thread) return res.status(404).json({ error: "Thread not found" });

  const msgs = await prisma.message.findMany({
    where: {
      threadId,
      deletedByVendorAt: null,
    },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      body: true,
      createdAt: true,
      authorType: true,
      vendorId: true,
      senderVendorId: true,
      attachments: {
        select: { id: true, filename: true, url: true, size: true, mime: true },
      },
    },
  });

  const peerReadAt =
    String(thread.vendorId) === String(vendorId)
      ? thread.recipientVendorLastReadAt
      : thread.vendorLastReadAt;

  const items = msgs.map((m) => {
    const fromMe = String(m.senderVendorId || m.vendorId) === String(vendorId);

    return {
      id: m.id,
      threadId,
      from: fromMe ? "me" : "them",
      body: m.body,
      createdAt: m.createdAt,
      readByPeer: fromMe && peerReadAt && m.createdAt <= peerReadAt,
      attachments: (m.attachments || []).map((a) => ({
        id: a.id,
        name: a.filename,
        url: a.url,
        size: a.size,
        mime: a.mime,
      })),
    };
  });

  const other = otherVendorFromThread(thread, vendorId);

  return res.json({
    items,
    threadMeta: {
      id: thread.id,
      type: "vendor_vendor",
      vendorId: other?.id || null,
      name: other?.displayName || "Vendor",
      logoUrl: other?.logoUrl || null,
    },
  });
});

router.patch("/vendor-threads/:id/read", async (req, res) => {
  const vendorId = await getVendorIdForUser(req);
  if (!vendorId) return res.status(403).json({ error: "no_vendor_for_user" });

  const threadId = String(req.params.id || "");

  const thread = await prisma.messageThread.findFirst({
    where: vendorThreadAccessWhere(threadId, vendorId),
    select: {
      id: true,
      vendorId: true,
      recipientVendorId: true,
    },
  });

  if (!thread) return res.status(404).json({ error: "Thread not found" });

  await prisma.messageThread.update({
    where: { id: thread.id },
    data: currentVendorReadUpdate(thread, vendorId),
  });

  return res.json({ ok: true });
});

router.post(
  "/vendor-threads/:id/messages",
  requireActiveSubscriptionForChat(),
  requireChatEntitlement(),
  async (req, res) => {
    const vendorId = await getVendorIdForUser(req);
    if (!vendorId) return res.status(403).json({ error: "no_vendor_for_user" });

    const threadId = String(req.params.id || "");
    const body = String(req.body?.body || "").trim();

    if (!body) {
      return res.status(400).json({ error: "Mesajul nu poate fi gol" });
    }
const moderation =
  await moderateMarketplaceMessage({
    text:
      body,

    senderType:
      "VENDOR",
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
    const quotaErr = await assertChatQuotaOrThrow({
      vendorId,
      subscription: req.subscription,
    });

    if (quotaErr) return res.status(quotaErr.status).json(quotaErr.payload);

    try {
      const out = await prisma.$transaction(async (tx) => {
        const thread = await tx.messageThread.findFirst({
          where: vendorThreadAccessWhere(threadId, vendorId),
          select: {
            id: true,
            vendorId: true,
            recipientVendorId: true,
            vendor: { select: { id: true, displayName: true } },
            recipientVendor: { select: { id: true, displayName: true } },
          },
        });

        if (!thread) {
          return {
            error: {
              status: 404,
              payload: { error: "Thread not found" },
            },
          };
        }

        const recipientVendorId =
          String(thread.vendorId) === String(vendorId)
            ? thread.recipientVendorId
            : thread.vendorId;

        const msg = await tx.message.create({
          data: {
            threadId,
            vendorId: recipientVendorId,
            senderVendorId: vendorId,
            authorType: "VENDOR",
            body,
          },
          select: {
            id: true,
            body: true,
            createdAt: true,
          },
        });

        await tx.messageThread.update({
          where: { id: threadId },
          data: {
            lastMsg: msg.body,
            lastAt: msg.createdAt,
            ...currentVendorReadUpdate(thread, vendorId),
          },
        });

        await bumpChatUsage({ tx, vendorId, incSent: 1 });

        return { thread, msg, recipientVendorId };
      });

      if (out?.error) {
        return res.status(out.error.status).json(out.error.payload);
      }

      try {
        const senderName =
          String(out.thread.vendorId) === String(vendorId)
            ? out.thread.vendor?.displayName
            : out.thread.recipientVendor?.displayName;

        await prisma.notification.create({
  data: {
    vendorId: out.recipientVendorId,
    threadId,
    type: "message",
    title: `Mesaj nou de la ${senderName || "vendor"}`,
    body: out.msg.body.slice(0, 140),
    link: `/mesaje?vendorThreadId=${threadId}`,
  },
});
      } catch (e) {
        console.error("Nu am putut crea notificarea pentru vendor:", e);
      }

      return res.status(201).json({
        ok: true,
        id: out.msg.id,
        createdAt: out.msg.createdAt,
      });
    } catch (e) {
      console.error("vendor-to-vendor send message error:", e);
      return res.status(500).json({
        error: "server_error",
        message:
          "Ups… a apărut o problemă tehnică. Te rog încearcă din nou în câteva secunde.",
      });
    }
  }
);

router.patch("/vendor-threads/:id/archive", async (req, res) => {
  const vendorId = await getVendorIdForUser(req);
  if (!vendorId) return res.status(403).json({ error: "no_vendor_for_user" });

  const threadId = String(req.params.id || "");
  const { archived = true } = req.body || {};

  const thread = await prisma.messageThread.findFirst({
    where: vendorThreadAccessWhere(threadId, vendorId),
    select: {
      id: true,
      vendorId: true,
      recipientVendorId: true,
    },
  });

  if (!thread) return res.status(404).json({ error: "Thread not found" });

  const data =
    String(thread.vendorId) === String(vendorId)
      ? { deletedByVendorAt: archived ? new Date() : null }
      : { deletedByRecipientVendorAt: archived ? new Date() : null };

  await prisma.messageThread.update({
    where: { id: thread.id },
    data,
  });

  return res.json({ ok: true });
});

export default router;