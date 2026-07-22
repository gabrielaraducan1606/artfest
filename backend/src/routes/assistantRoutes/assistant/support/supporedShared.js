// src/routes/assistantRoutes/support/supportShared.js

import { z } from "zod";
import jwt from "jsonwebtoken";

import { prisma } from "../../../../db.js";

/* =========================================================
   Configurare
========================================================= */

export const SUPPORT_AUDIENCE =
  "USER";

export const DEFAULT_TICKET_LIMIT =
  20;

export const DEFAULT_MESSAGE_LIMIT =
  50;

export const MAX_TICKET_LIMIT =
  100;

export const MAX_MESSAGE_LIMIT =
  100;

export const MAX_SUBJECT_LENGTH =
  180;

export const MAX_MESSAGE_LENGTH =
  10_000;

export const MAX_ATTACHMENTS =
  10;

export const MAX_ATTACHMENT_SIZE =
  25 * 1024 * 1024;

/* =========================================================
   Helpers text
========================================================= */

export function normalizeText(
  value
) {
  return typeof value ===
    "string"
    ? value.trim()
    : "";
}

export function normalizeLowercase(
  value
) {
  return normalizeText(
    value
  ).toLowerCase();
}

export function getRequesterName(
  user
) {
  const explicitName =
    normalizeText(
      user?.name
    );

  if (explicitName) {
    return explicitName;
  }

  const composedName = [
    normalizeText(
      user?.firstName
    ),

    normalizeText(
      user?.lastName
    ),
  ]
    .filter(Boolean)
    .join(" ");

  return composedName || null;
}

/* =========================================================
   Mapări pentru frontend
========================================================= */

export function mapTicketToClient(
  ticket
) {
  return {
    id:
      String(
        ticket.id
      ),

    subject:
      ticket.subject ||
      "Solicitare de suport",

    category:
      ticket.category ||
      "general",

    status:
      normalizeLowercase(
        ticket.status
      ) ||
      "open",

    priority:
      normalizeLowercase(
        ticket.priority
      ) ||
      "medium",

    createdAt:
      ticket.createdAt ||
      null,

    updatedAt:
      ticket.updatedAt ||
      null,

    lastMessageAt:
      ticket.lastMessageAt ||
      null,
  };
}

export function mapAttachmentToClient(
  attachment
) {
  return {
    url:
      attachment.url,

    name:
      attachment.filename ||
      null,

    filename:
      attachment.filename ||
      null,

    mimeType:
      attachment.mime ||
      null,

    mime:
      attachment.mime ||
      null,

    size:
      attachment.size ??
      null,
  };
}

export function mapMessageToClient(
  message,
  currentUserId
) {
  let senderType =
    "support";

  if (
    message.system
  ) {
    senderType =
      "system";
  } else if (
    message.authorId ===
    currentUserId
  ) {
    senderType =
      "user";
  }

  return {
    id:
      String(
        message.id
      ),

    ticketId:
      String(
        message.ticketId
      ),

    from:
      senderType ===
      "user"
        ? "me"
        : "them",

    senderType,

    system:
      Boolean(
        message.system
      ),

    body:
      message.body ||
      "",

    createdAt:
      message.createdAt ||
      null,

    attachments:
      Array.isArray(
        message.attachments
      )
        ? message.attachments.map(
            mapAttachmentToClient
          )
        : [],
  };
}

export function createAttachmentRows({
  attachments,
  ticketId,
  messageId,
}) {
  return attachments.map(
    (
      attachment,
      index
    ) => ({
      ticketId,
      messageId,

      url:
        attachment.url,

      filename:
        attachment.name ||
        attachment.filename ||
        `attachment-${index + 1}`,

      mime:
        attachment.mimeType ||
        attachment.mime ||
        null,

      size:
        attachment.size ??
        null,
    })
  );
}

/* =========================================================
   Selectări Prisma
========================================================= */

export const ticketClientSelect = {
  id:
    true,

  requesterId:
    true,

  subject:
    true,

  category:
    true,

  status:
    true,

  priority:
    true,

  createdAt:
    true,

  updatedAt:
    true,

  lastMessageAt:
    true,
};

export const messageClientSelect = {
  id:
    true,

  ticketId:
    true,

  authorId:
    true,

  system:
    true,

  body:
    true,

  createdAt:
    true,

  attachments: {
    orderBy: {
      createdAt:
        "asc",
    },

    select: {
      url:
        true,

      filename:
        true,

      mime:
        true,

      size:
        true,
    },
  },
};

/* =========================================================
   Autentificare
========================================================= */

export async function getSessionUser(
  req
) {
  if (
    process.env
      .AUTH_DEV_USER_ID
  ) {
    const user =
      await prisma.user.findUnique(
        {
          where: {
            id:
              String(
                process.env
                  .AUTH_DEV_USER_ID
              ),
          },

          select: {
            id:
              true,

            role:
              true,

            status:
              true,
          },
        }
      );

    return user?.status ===
      "ACTIVE"
      ? user
      : null;
  }

  if (
    req.user?.id
  ) {
    const user =
      await prisma.user.findUnique(
        {
          where: {
            id:
              String(
                req.user.id
              ),
          },

          select: {
            id:
              true,

            role:
              true,

            status:
              true,
          },
        }
      );

    return user?.status ===
      "ACTIVE"
      ? user
      : null;
  }

  const cookieToken =
    req.cookies?.auth ||
    req.cookies?.token ||
    req.cookies
      ?.access_token ||
    null;

  const authHeader =
    String(
      req.headers
        .authorization ||
        ""
    );

  const bearerToken =
    authHeader.startsWith(
      "Bearer "
    )
      ? authHeader.slice(7)
      : null;

  const token =
    cookieToken ||
    bearerToken;

  if (
    !token ||
    !process.env.JWT_SECRET
  ) {
    return null;
  }

  try {
    const payload =
      jwt.verify(
        token,
        process.env.JWT_SECRET
      );

    const userId =
      String(
        payload?.sub ||
        payload?.id ||
        ""
      );

    if (
      !userId
    ) {
      return null;
    }

    const user =
      await prisma.user.findUnique(
        {
          where: {
            id:
              userId,
          },

          select: {
            id:
              true,

            role:
              true,

            status:
              true,
          },
        }
      );

    return user?.status ===
      "ACTIVE"
      ? user
      : null;
  } catch {
    return null;
  }
}

export function requireSupportAuth() {
  return async (
    req,
    res,
    next
  ) => {
    try {
      const user =
        await getSessionUser(
          req
        );

      if (
        !user
      ) {
        return res
          .status(401)
          .json({
            error:
              "unauthorized",

            message:
              "Pentru a vedea conversațiile trebuie să fii autentificat.",
          });
      }

      req.user =
        user;

      return next();
    } catch (
      error
    ) {
      return next(
        error
      );
    }
  };
}

/* =========================================================
   Verificare acces tichet
========================================================= */

export async function findAccessibleTicket(
  user,
  ticketId
) {
  if (
    !user?.id ||
    !ticketId
  ) {
    return null;
  }

  if (
    user.role ===
    "ADMIN"
  ) {
    return prisma
      .supportTicket
      .findFirst({
        where: {
          id:
            ticketId,

          audience:
            SUPPORT_AUDIENCE,

          deletedAt:
            null,
        },

        select:
          ticketClientSelect,
      });
  }

  return prisma
    .supportTicket
    .findFirst({
      where: {
        id:
          ticketId,

        requesterId:
          user.id,

        audience:
          SUPPORT_AUDIENCE,

        deletedAt:
          null,

        archivedByRequesterAt:
          null,
      },

      select:
        ticketClientSelect,
    });
}

/* =========================================================
   Notificări administratori
========================================================= */

export async function createAdminNotifications(
  tx,
  {
    ticketId,
    requesterId = null,
    subject,
    category,
    priority,
    notificationType,
    messageId = null,
    audience =
      SUPPORT_AUDIENCE,
  }
) {
  const admins =
    await tx.user.findMany({
      where: {
        role:
          "ADMIN",

        status:
          "ACTIVE",
      },

      select: {
        id:
          true,
      },

      take:
        100,
    });

  if (
    admins.length ===
    0
  ) {
    return;
  }

  const isNewTicket =
    notificationType ===
    "ticket_created";

  const dedupeEntity =
    messageId ||
    ticketId;

  await tx.notification.createMany(
    {
      data:
        admins.map(
          (
            admin
          ) => ({
            userId:
              admin.id,

            vendorId:
              null,

            type:
              "support",

            title:
              isNewTicket
                ? "Solicitare nouă de suport"
                : "Mesaj nou într-o solicitare",

            body:
              subject,

            link:
              `/admin/support/${ticketId}`,

            meta: {
              ticketId,
              messageId,
              requesterId,
              audience,
              category,
              priority,

              event:
                notificationType,
            },

            dedupeKey:
              `assistant-support:${notificationType}:${dedupeEntity}:${admin.id}`,
          })
        ),

      skipDuplicates:
        true,
    }
  );
}

/* =========================================================
   Scheme Zod
========================================================= */

export const ticketStatusSchema =
  z.enum([
    "all",
    "open",
    "pending",
    "closed",
  ]);

export const ticketPrioritySchema =
  z.enum([
    "low",
    "medium",
    "high",
  ]);

export const attachmentSchema =
  z.object({
    url:
      z
        .string()
        .trim()
        .url()
        .max(2_000),

    name:
      z
        .string()
        .trim()
        .min(1)
        .max(255)
        .optional(),

    filename:
      z
        .string()
        .trim()
        .min(1)
        .max(255)
        .optional(),

    mimeType:
      z
        .string()
        .trim()
        .max(150)
        .optional(),

    mime:
      z
        .string()
        .trim()
        .max(150)
        .optional(),

    size:
      z
        .coerce
        .number()
        .int()
        .min(0)
        .max(
          MAX_ATTACHMENT_SIZE
        )
        .optional(),
  });

export const listTicketsQuerySchema =
  z.object({
    status:
      ticketStatusSchema
        .default(
          "all"
        ),

    q:
      z
        .string()
        .trim()
        .max(150)
        .optional()
        .default(""),

    offset:
      z
        .coerce
        .number()
        .int()
        .min(0)
        .default(0),

    limit:
      z
        .coerce
        .number()
        .int()
        .min(1)
        .max(
          MAX_TICKET_LIMIT
        )
        .default(
          DEFAULT_TICKET_LIMIT
        ),
  });

export const listMessagesQuerySchema =
  z.object({
    offset:
      z
        .coerce
        .number()
        .int()
        .min(0)
        .default(0),

    limit:
      z
        .coerce
        .number()
        .int()
        .min(1)
        .max(
          MAX_MESSAGE_LIMIT
        )
        .default(
          DEFAULT_MESSAGE_LIMIT
        ),
  });

export const ticketIdParamsSchema =
  z.object({
    id:
      z
        .string()
        .trim()
        .min(1)
        .max(100),
  });

export const createTicketBodySchema =
  z.object({
    subject:
      z
        .string()
        .trim()
        .min(3)
        .max(
          MAX_SUBJECT_LENGTH
        ),

    category:
      z
        .string()
        .trim()
        .min(1)
        .max(80)
        .default(
          "general"
        ),

    priority:
      ticketPrioritySchema
        .default(
          "medium"
        ),

    message:
      z
        .string()
        .trim()
        .min(1)
        .max(
          MAX_MESSAGE_LENGTH
        ),

    name:
      z
        .string()
        .trim()
        .max(150)
        .optional()
        .default(""),

    email:
      z
        .string()
        .trim()
        .email(
          "Adresa de email nu este validă."
        )
        .max(320)
        .optional(),

    attachments:
      z
        .array(
          attachmentSchema
        )
        .max(
          MAX_ATTACHMENTS
        )
        .optional()
        .default([]),
  });

export const createMessageBodySchema =
  z
    .object({
      body:
        z
          .string()
          .trim()
          .max(
            MAX_MESSAGE_LENGTH
          )
          .optional()
          .default(""),

      attachments:
        z
          .array(
            attachmentSchema
          )
          .max(
            MAX_ATTACHMENTS
          )
          .optional()
          .default([]),
    })
    .superRefine(
      (
        value,
        context
      ) => {
        const hasText =
          value.body.length >
          0;

        const hasAttachments =
          value.attachments
            .length >
          0;

        if (
          !hasText &&
          !hasAttachments
        ) {
          context.addIssue({
            code:
              z.ZodIssueCode
                .custom,

            path: [
              "body",
            ],

            message:
              "Mesajul sau un atașament este obligatoriu.",
          });
        }
      }
    );

export const faqQuerySchema =
  z.object({
    q:
      z
        .string()
        .trim()
        .max(300)
        .optional()
        .default(""),

    limit:
      z
        .coerce
        .number()
        .int()
        .min(1)
        .max(25)
        .default(10),
  });

/* =========================================================
   Error handler reutilizabil
========================================================= */

export function supportErrorHandler(
  error,
  req,
  res,
  next
) {
  console.error(
    "assistant support unexpected error:",
    error
  );

  if (
    res.headersSent
  ) {
    return next(
      error
    );
  }

  return res
    .status(500)
    .json({
      error:
        "server_error",

      message:
        "A apărut o eroare neașteptată în serviciul de suport.",
    });
}