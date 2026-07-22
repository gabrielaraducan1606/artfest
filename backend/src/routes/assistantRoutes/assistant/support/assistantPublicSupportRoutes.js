// src/routes/assistantRoutes/support/assistantPublicSupportRoutes.js

import {
  Router,
} from "express";

import {
  prisma,
} from "../../../../db.js";

import {
  sendGuestSupportConfirmationEmail,
} from "../../../../lib/mailer.js";

import {
  createAdminNotifications,
  createAttachmentRows,
  createTicketBodySchema,
  faqQuerySchema,
  getRequesterName,
  getSessionUser,
  mapTicketToClient,
  normalizeText,
  supportErrorHandler,
  ticketClientSelect,
} from "./supporedShared.js";

const router =
  Router();

/* =========================================================
   GET /faqs
========================================================= */

router.get(
  "/faqs",
  async (
    req,
    res
  ) => {
    const parsed =
      faqQuerySchema.safeParse(
        {
          q:
            req.query.q ??
            "",

          limit:
            req.query.limit ??
            10,
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
            "Căutarea nu este validă.",

          details:
            parsed.error.flatten(),
        });
    }

    const {
      q,
      limit,
    } =
      parsed.data;

    const searchTerms =
      q
        .toLowerCase()
        .split(/\s+/)
        .map(
          (
            term
          ) =>
            term.trim()
        )
        .filter(
          (
            term
          ) =>
            term.length >=
            2
        )
        .slice(
          0,
          10
        );

    try {
      const items =
        await prisma
          .supportFaq
          .findMany({
            where: {
              isActive:
                true,

              ...(q
                ? {
                    OR: [
                      {
                        q: {
                          contains:
                            q,

                          mode:
                            "insensitive",
                        },
                      },

                      {
                        a: {
                          contains:
                            q,

                          mode:
                            "insensitive",
                        },
                      },

                      ...(searchTerms.length >
                      0
                        ? [
                            {
                              tags: {
                                hasSome:
                                  searchTerms,
                              },
                            },
                          ]
                        : []),
                    ],
                  }
                : {}),
            },

            orderBy: {
              createdAt:
                "desc",
            },

            take:
              limit,

            select: {
              id:
                true,

              q:
                true,

              a:
                true,

              tags:
                true,

              createdAt:
                true,
            },
          });

      return res.json({
        items,
      });
    } catch (
      error
    ) {
      console.error(
        "assistant support FAQ error:",
        error
      );

      return res
        .status(500)
        .json({
          error:
            "server_error",

          message:
            "Centrul de ajutor nu este disponibil momentan.",
        });
    }
  }
);

/* =========================================================
   POST /tickets

   VENDOR autentificat => VENDOR
   USER autentificat   => USER
   Neautentificat      => GUEST
========================================================= */

router.post(
  "/tickets",
  async (
    req,
    res
  ) => {
    const parsed =
      createTicketBodySchema.safeParse(
        req.body
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
            "Datele solicitării nu sunt valide.",

          details:
            parsed.error.flatten(),
        });
    }

    const {
      subject,
      category,
      priority,
      message,
      name,
      email,
      attachments,
    } =
      parsed.data;

    try {
      const sessionUser =
        await getSessionUser(
          req
        );

      let requester =
        null;

      if (
        sessionUser?.id
      ) {
        requester =
          await prisma.user.findUnique(
            {
              where: {
                id:
                  sessionUser.id,
              },

              select: {
                id:
                  true,

                name:
                  true,

                firstName:
                  true,

                lastName:
                  true,

                email:
                  true,

                status:
                  true,
              },
            }
          );

        if (
          requester?.status !==
          "ACTIVE"
        ) {
          requester =
            null;
        }
      }

      const isAuthenticated =
        Boolean(
          requester?.id
        );

      /*
       * Dacă utilizatorul autentificat are profil Vendor,
       * tichetul trebuie creat ca VENDOR pentru ca acesta
       * să apară și în pagina clasică de suport vendor.
       */
      let vendor =
        null;

      if (
        isAuthenticated
      ) {
        vendor =
          await prisma.vendor.findUnique(
            {
              where: {
                userId:
                  requester.id,
              },

              select: {
                id:
                  true,
              },
            }
          );
      }

      const isVendor =
        Boolean(
          vendor?.id
        );

      const guestName =
        normalizeText(
          name
        );

      const guestEmail =
        normalizeText(
          email
        ).toLowerCase();

      if (
        !isAuthenticated &&
        !guestEmail
      ) {
        return res
          .status(400)
          .json({
            error:
              "guest_email_required",

            message:
              "Introdu adresa de email pentru a trimite solicitarea.",

            requiresGuestDetails:
              true,
          });
      }

      /*
       * Dacă guestul folosește emailul unui cont existent,
       * asociem tichetul contului respectiv.
       */
      let linkedUser =
        null;

      if (
        !isAuthenticated &&
        guestEmail
      ) {
        linkedUser =
          await prisma.user.findUnique(
            {
              where: {
                email:
                  guestEmail,
              },

              select: {
                id:
                  true,
              },
            }
          );
      }

      const requesterId =
        isAuthenticated
          ? requester.id
          : linkedUser?.id ??
            null;

      const requesterName =
        isAuthenticated
          ? getRequesterName(
              requester
            )
          : guestName ||
            null;

      const requesterEmail =
        isAuthenticated
          ? requester.email ||
            null
          : guestEmail;

      /*
       * IMPORTANT:
       *
       * - guest => GUEST
       * - autentificat cu profil vendor => VENDOR
       * - autentificat fără profil vendor => USER
       */
      const audience =
        !isAuthenticated
          ? "GUEST"
          : isVendor
          ? "VENDOR"
          : "USER";

      const createdTicket =
        await prisma.$transaction(
          async (
            tx
          ) => {
            const now =
              new Date();

            const ticket =
              await tx.supportTicket.create(
                {
                  data: {
                    requesterId,

                    /*
                     * Pentru vendor salvăm și vendorId.
                     * Pentru USER/GUEST rămâne null.
                     */
                    vendorId:
                      isVendor
                        ? vendor.id
                        : null,

                    audience,

                    requesterName,

                    requesterEmail,

                    subject,

                    category,

                    priority:
                      priority
                        .toUpperCase(),

                    status:
                      "OPEN",

                    lastMessageAt:
                      now,

                    lastRequesterMessageAt:
                      isAuthenticated
                        ? now
                        : null,

                    notifyEmailOnAdminReply:
                      isAuthenticated,

                    archivedByRequesterAt:
                      null,

                    deletedAt:
                      null,
                  },

                  select:
                    ticketClientSelect,
                }
              );

            const initialMessage =
              await tx.supportMessage.create(
                {
                  data: {
                    ticketId:
                      ticket.id,

                    authorId:
                      requesterId,

                    system:
                      false,

                    body:
                      normalizeText(
                        message
                      ) ||
                      "(atașament)",
                  },

                  select: {
                    id:
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
                          ticket.id,

                        messageId:
                          initialMessage.id,
                      }
                    ),
                }
              );
            }

            if (
              isAuthenticated
            ) {
              await tx.supportRead.upsert(
                {
                  where: {
                    ticketId_userId: {
                      ticketId:
                        ticket.id,

                      userId:
                        requester.id,
                    },
                  },

                  update: {
                    lastReadAt:
                      now,
                  },

                  create: {
                    ticketId:
                      ticket.id,

                    userId:
                      requester.id,

                    lastReadAt:
                      now,
                  },
                }
              );
            }

            await createAdminNotifications(
              tx,
              {
                ticketId:
                  ticket.id,

                requesterId,

                subject:
                  ticket.subject,

                category:
                  ticket.category,

                priority,

                notificationType:
                  "ticket_created",

                messageId:
                  initialMessage.id,

                audience,
              }
            );

            return ticket;
          }
        );

      let confirmationEmailQueued =
        false;

      if (
        !isAuthenticated
      ) {
        confirmationEmailQueued =
          true;

        /*
         * Nu blocăm răspunsul HTTP așteptând SMTP-ul.
         */
        void sendGuestSupportConfirmationEmail(
          {
            to:
              guestEmail,

            name:
              guestName,

            subject,

            message,
          }
        ).catch(
          (
            emailError
          ) => {
            console.error(
              "guest support confirmation email error:",
              emailError
            );
          }
        );
      }

      return res
        .status(201)
        .json({
          ok:
            true,

          mode:
            isAuthenticated
              ? isVendor
                ? "vendor"
                : "authenticated"
              : "guest",

          ticket:
            mapTicketToClient(
              createdTicket
            ),

          ticketId:
            createdTicket.id,

          canOpenConversation:
            isAuthenticated,

          confirmationEmailQueued,

          message:
            isAuthenticated
              ? "Solicitarea a fost creată."
              : "Solicitarea a fost trimisă. Am inițiat expedierea emailului de confirmare.",
        });
    } catch (
      error
    ) {
      console.error(
        "assistant support create ticket error:",
        error
      );

      return res
        .status(500)
        .json({
          error:
            "server_error",

          message:
            "Solicitarea nu a putut fi creată.",
        });
    }
  }
);

router.use(
  supportErrorHandler
);

export default router;

