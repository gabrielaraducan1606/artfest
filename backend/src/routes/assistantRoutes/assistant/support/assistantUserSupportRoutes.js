// src/routes/assistantRoutes/support/assistantUserSupportRoutes.js

import {
  Router,
} from "express";

import {
  prisma,
} from "../../../../db.js";

import {
  createAdminNotifications,
  createAttachmentRows,
  createMessageBodySchema,
  DEFAULT_MESSAGE_LIMIT,
  DEFAULT_TICKET_LIMIT,
  findAccessibleTicket,
  listMessagesQuerySchema,
  listTicketsQuerySchema,
  mapMessageToClient,
  mapTicketToClient,
  messageClientSelect,
  normalizeLowercase,
  normalizeText,
  requireSupportAuth,
  SUPPORT_AUDIENCE,
  supportErrorHandler,
  ticketClientSelect,
  ticketIdParamsSchema,
} from "./supporedShared.js";

const router =
  Router();

/*
 * Toate rutele de mai jos necesită autentificare.
 */
router.use(
  requireSupportAuth()
);

/* =========================================================
   GET /me/tickets
========================================================= */

router.get(
  "/me/tickets",
  async (
    req,
    res
  ) => {
    const parsed =
      listTicketsQuerySchema.safeParse(
        {
          status:
            req.query.status ??
            "all",

          q:
            req.query.q ??
            "",

          offset:
            req.query.offset ??
            0,

          limit:
            req.query.limit ??
            DEFAULT_TICKET_LIMIT,
        }
      );

    if (
      !parsed.success
    ) {
      return res
        .status(400)
        .json({
          error:
            "bad_request",

          message:
            "Parametrii conversațiilor nu sunt valizi.",

          details:
            parsed.error.flatten(),
        });
    }

    const user =
      req.user;

    const {
      status,
      q,
      offset,
      limit,
    } =
      parsed.data;

    const statusMap = {
      open:
        "OPEN",

      pending:
        "PENDING",

      closed:
        "CLOSED",
    };

    const where = {
      requesterId:
        user.id,

      audience:
        SUPPORT_AUDIENCE,

      deletedAt:
        null,

      archivedByRequesterAt:
        null,

      ...(status !==
      "all"
        ? {
            status:
              statusMap[
                status
              ],
          }
        : {}),

      ...(q
        ? {
            OR: [
              {
                subject: {
                  contains:
                    q,

                  mode:
                    "insensitive",
                },
              },

              {
                category: {
                  contains:
                    q,

                  mode:
                    "insensitive",
                },
              },
            ],
          }
        : {}),
    };

    try {
      const [
        total,
        tickets,
      ] =
        await Promise.all(
          [
            prisma
              .supportTicket
              .count({
                where,
              }),

            prisma
              .supportTicket
              .findMany({
                where,

                orderBy: [
                  {
                    lastMessageAt:
                      "desc",
                  },

                  {
                    createdAt:
                      "desc",
                  },
                ],

                skip:
                  offset,

                take:
                  limit,

                select:
                  ticketClientSelect,
              }),
          ]
        );

      const items =
        tickets.map(
          mapTicketToClient
        );

      const nextOffset =
        offset +
        items.length;

      return res.json({
        items,
        total,

        hasMore:
          nextOffset <
          total,

        nextOffset,
      });
    } catch (
      error
    ) {
      console.error(
        "assistant support list tickets error:",
        error
      );

      return res
        .status(500)
        .json({
          error:
            "server_error",

          message:
            "Conversațiile nu au putut fi încărcate.",
        });
    }
  }
);

/* =========================================================
   GET /tickets/:id/messages
========================================================= */

router.get(
  "/tickets/:id/messages",
  async (
    req,
    res
  ) => {
    const parsedParams =
      ticketIdParamsSchema.safeParse(
        req.params
      );

    const parsedQuery =
      listMessagesQuerySchema.safeParse(
        {
          offset:
            req.query.offset ??
            0,

          limit:
            req.query.limit ??
            DEFAULT_MESSAGE_LIMIT,
        }
      );

    if (
      !parsedParams.success ||
      !parsedQuery.success
    ) {
      return res
        .status(400)
        .json({
          error:
            "bad_request",

          message:
            "Datele conversației nu sunt valide.",
        });
    }

    const user =
      req.user;

    const {
      id,
    } =
      parsedParams.data;

    const {
      offset,
      limit,
    } =
      parsedQuery.data;

    try {
      const ticket =
        await findAccessibleTicket(
          user,
          id
        );

      if (
        !ticket
      ) {
        return res
          .status(404)
          .json({
            error:
              "not_found",

            message:
              "Conversația nu a fost găsită.",
          });
      }

      const where = {
        ticketId:
          id,
      };

      const [
        total,
        descendingMessages,
      ] =
        await Promise.all(
          [
            prisma
              .supportMessage
              .count({
                where,
              }),

            prisma
              .supportMessage
              .findMany({
                where,

                orderBy: [
                  {
                    createdAt:
                      "desc",
                  },

                  {
                    id:
                      "desc",
                  },
                ],

                skip:
                  offset,

                take:
                  limit,

                select:
                  messageClientSelect,
              }),
          ]
        );

      /*
       * Query-ul ia cele mai recente mesaje.
       * Frontendul le primește cronologic.
       */
      const chronologicalMessages =
        [
          ...descendingMessages,
        ].reverse();

      const items =
        chronologicalMessages.map(
          (
            message
          ) =>
            mapMessageToClient(
              message,
              user.id
            )
        );

      const nextOffset =
        offset +
        descendingMessages.length;

      return res.json({
        ticket:
          mapTicketToClient(
            ticket
          ),

        items,
        total,

        hasMore:
          nextOffset <
          total,

        nextOffset,
      });
    } catch (
      error
    ) {
      console.error(
        "assistant support get messages error:",
        error
      );

      return res
        .status(500)
        .json({
          error:
            "server_error",

          message:
            "Mesajele conversației nu au putut fi încărcate.",
        });
    }
  }
);

/* =========================================================
   POST /tickets/:id/messages
========================================================= */

router.post(
  "/tickets/:id/messages",
  async (
    req,
    res
  ) => {
    const parsedParams =
      ticketIdParamsSchema.safeParse(
        req.params
      );

    const parsedBody =
      createMessageBodySchema.safeParse(
        req.body
      );

    if (
      !parsedParams.success ||
      !parsedBody.success
    ) {
      return res
        .status(400)
        .json({
          error:
            "bad_request",

          message:
            "Mesajul nu este valid.",

          details:
            parsedBody.success
              ? undefined
              : parsedBody
                  .error
                  .flatten(),
        });
    }

    const user =
      req.user;

    const {
      id,
    } =
      parsedParams.data;

    const {
      body,
      attachments,
    } =
      parsedBody.data;

    try {
      const ticket =
        await findAccessibleTicket(
          user,
          id
        );

      if (
        !ticket
      ) {
        return res
          .status(404)
          .json({
            error:
              "not_found",

            message:
              "Conversația nu a fost găsită.",
          });
      }

      if (
        ticket.status ===
        "CLOSED"
      ) {
        return res
          .status(409)
          .json({
            error:
              "ticket_closed",

            message:
              "Această conversație este închisă. Creează o solicitare nouă pentru a continua.",
          });
      }

      const createdMessage =
        await prisma.$transaction(
          async (
            tx
          ) => {
            const now =
              new Date();

            const message =
              await tx.supportMessage.create(
                {
                  data: {
                    ticketId:
                      id,

                    authorId:
                      user.id,

                    system:
                      false,

                    body:
                      normalizeText(
                        body
                      ) ||
                      "(atașament)",
                  },

                  select: {
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
                  },
                }
              );

            if (
              attachments.length >
              0
            ) {
              await tx.supportAttachment.createMany(
                {
                  data:
                    createAttachmentRows(
                      {
                        attachments,

                        ticketId:
                          id,

                        messageId:
                          message.id,
                      }
                    ),
                }
              );
            }

            await tx.supportTicket.update(
              {
                where: {
                  id,
                },

                data: {
                  status:
                    "PENDING",

                  lastMessageAt:
                    now,

                  lastRequesterMessageAt:
                    now,

                  notifyEmailOnAdminReply:
                    true,

                  archivedByRequesterAt:
                    null,
                },
              }
            );

            await tx.supportRead.upsert(
              {
                where: {
                  ticketId_userId: {
                    ticketId:
                      id,

                    userId:
                      user.id,
                  },
                },

                update: {
                  lastReadAt:
                    now,
                },

                create: {
                  ticketId:
                    id,

                  userId:
                    user.id,

                  lastReadAt:
                    now,
                },
              }
            );

            await createAdminNotifications(
              tx,
              {
                ticketId:
                  id,

                requesterId:
                  user.id,

                subject:
                  ticket.subject,

                category:
                  ticket.category,

                priority:
                  normalizeLowercase(
                    ticket.priority
                  ),

                notificationType:
                  "message_created",

                messageId:
                  message.id,

                audience:
                  SUPPORT_AUDIENCE,
              }
            );

            return tx.supportMessage.findUnique(
              {
                where: {
                  id:
                    message.id,
                },

                select:
                  messageClientSelect,
              }
            );
          }
        );

      if (
        !createdMessage
      ) {
        throw new Error(
          "Mesajul a fost creat, dar nu a putut fi recitit."
        );
      }

      return res
        .status(201)
        .json({
          ok:
            true,

          message:
            mapMessageToClient(
              createdMessage,
              user.id
            ),
        });
    } catch (
      error
    ) {
      console.error(
        "assistant support send message error:",
        error
      );

      return res
        .status(500)
        .json({
          error:
            "server_error",

          message:
            "Mesajul nu a putut fi trimis.",
        });
    }
  }
);

/* =========================================================
   PATCH /tickets/:id/read
========================================================= */

router.patch(
  "/tickets/:id/read",
  async (
    req,
    res
  ) => {
    const parsed =
      ticketIdParamsSchema.safeParse(
        req.params
      );

    if (
      !parsed.success
    ) {
      return res
        .status(400)
        .json({
          error:
            "bad_request",

          message:
            "Conversația nu este validă.",
        });
    }

    const user =
      req.user;

    const {
      id,
    } =
      parsed.data;

    try {
      const ticket =
        await findAccessibleTicket(
          user,
          id
        );

      if (
        !ticket
      ) {
        return res
          .status(404)
          .json({
            error:
              "not_found",

            message:
              "Conversația nu a fost găsită.",
          });
      }

      const now =
        new Date();

      await prisma.supportRead.upsert(
        {
          where: {
            ticketId_userId: {
              ticketId:
                id,

              userId:
                user.id,
            },
          },

          update: {
            lastReadAt:
              now,
          },

          create: {
            ticketId:
              id,

            userId:
              user.id,

            lastReadAt:
              now,
          },
        }
      );

      return res.json({
        ok:
          true,

        readAt:
          now,
      });
    } catch (
      error
    ) {
      console.error(
        "assistant support mark read error:",
        error
      );

      return res
        .status(500)
        .json({
          error:
            "server_error",

          message:
            "Conversația nu a putut fi marcată drept citită.",
        });
    }
  }
);

/* =========================================================
   DELETE /tickets/:id

   Ștergerea pentru user înseamnă arhivare.
========================================================= */

router.delete(
  "/tickets/:id",
  async (
    req,
    res
  ) => {
    const parsed =
      ticketIdParamsSchema.safeParse(
        req.params
      );

    if (
      !parsed.success
    ) {
      return res
        .status(400)
        .json({
          error:
            "bad_request",

          message:
            "Conversația nu este validă.",
        });
    }

    const user =
      req.user;

    const {
      id,
    } =
      parsed.data;

    try {
      const ticket =
        await findAccessibleTicket(
          user,
          id
        );

      if (
        !ticket
      ) {
        return res
          .status(404)
          .json({
            error:
              "not_found",

            message:
              "Conversația nu a fost găsită.",
          });
      }

      const now =
        new Date();

      await prisma.supportTicket.update(
        {
          where: {
            id,
          },

          data: {
            archivedByRequesterAt:
              now,

            status:
              "CLOSED",

            notifyEmailOnAdminReply:
              false,
          },
        }
      );

      return res.json({
        ok:
          true,

        archivedAt:
          now,
      });
    } catch (
      error
    ) {
      console.error(
        "assistant support archive ticket error:",
        error
      );

      return res
        .status(500)
        .json({
          error:
            "server_error",

          message:
            "Conversația nu a putut fi arhivată.",
        });
    }
  }
);

/* =========================================================
   GET /unread-count
========================================================= */

router.get(
  "/unread-count",
  async (
    req,
    res
  ) => {
    const user =
      req.user;

    try {
      const tickets =
        await prisma
          .supportTicket
          .findMany({
            where: {
              requesterId:
                user.id,

              audience:
                SUPPORT_AUDIENCE,

              deletedAt:
                null,

              archivedByRequesterAt:
                null,
            },

            select: {
              id:
                true,

              reads: {
                where: {
                  userId:
                    user.id,
                },

                select: {
                  lastReadAt:
                    true,
                },

                take:
                  1,
              },

              messages: {
                /*
                 * Luăm ultimul mesaj care nu aparține
                 * utilizatorului sau este mesaj de sistem.
                 */
                where: {
                  OR: [
                    {
                      authorId: {
                        not:
                          user.id,
                      },
                    },

                    {
                      system:
                        true,
                    },
                  ],
                },

                orderBy: [
                  {
                    createdAt:
                      "desc",
                  },

                  {
                    id:
                      "desc",
                  },
                ],

                take:
                  1,

                select: {
                  createdAt:
                    true,
                },
              },
            },
          });

      const count =
        tickets.reduce(
          (
            total,
            ticket
          ) => {
            const lastReadAt =
              ticket.reads[0]
                ?.lastReadAt ||
              null;

            const lastSupportMessageAt =
              ticket.messages[0]
                ?.createdAt ||
              null;

            if (
              !lastSupportMessageAt
            ) {
              return total;
            }

            if (
              !lastReadAt ||
              lastSupportMessageAt >
                lastReadAt
            ) {
              return total + 1;
            }

            return total;
          },
          0
        );

      return res.json({
        count,
      });
    } catch (
      error
    ) {
      console.error(
        "assistant support unread count error:",
        error
      );

      return res
        .status(500)
        .json({
          error:
            "server_error",

          message:
            "Numărul conversațiilor necitite nu a putut fi calculat.",
        });
    }
  }
);

router.use(
  supportErrorHandler
);

export default router;