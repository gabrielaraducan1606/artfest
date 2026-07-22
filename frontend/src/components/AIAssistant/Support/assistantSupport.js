// src/components/AiAssistant/support/assistantSupport.js

import {
  ConversationIcon,
  FaqIcon,
  SupportIcon,
} from "./SupportIcons.jsx";

import {
  ReturnIcon,
} from "../Orders/OrderIcons.jsx";

import {
  fetchSupportTickets,
  fetchSupportMessages,
  createSupportTicket,
  sendSupportTicketMessage,
  markSupportTicketRead,
  archiveSupportTicket,
  searchSupportFaq,
} from "./supportApi.js";

/* =========================================================
   Fluxuri
========================================================= */

export const SUPPORT_FLOWS = {
  NEW_REQUEST:
    "support-new-request",

  CATEGORY:
    "support-category",

  DESCRIPTION:
    "support-description",

  CONVERSATIONS:
    "support-conversations",

  FAQ:
    "support-faq",

  TICKET_PREFIX:
    "support-ticket:",
};

/* =========================================================
   Acțiuni suport
========================================================= */

export const SUPPORT_ACTIONS = {
  RETRY:
    "support-retry",

  OPEN_TICKET:
    "support-open-ticket",

  ARCHIVE_TICKET:
    "support-archive-ticket",

  LOAD_MORE_TICKETS:
    "support-load-more-tickets",

  LOAD_MORE_MESSAGES:
    "support-load-more-messages",

  CREATE_REQUEST:
    "support-create-request",

  SHOW_CONVERSATIONS:
    "support-show-conversations",

  SEARCH_AGAIN:
    "support-search-again",

  SUPPORT_FROM_FAQ:
    "support-from-faq",

  FAQ_RESOLVED:
    "support-faq-resolved",
};

/* =========================================================
   Categorii
========================================================= */

export const SUPPORT_CATEGORIES = [
  {
    id:
      "order",

    label:
      "Comandă",

    subject:
      "Problemă legată de o comandă",
  },

  {
    id:
      "store",

    label:
      "Magazin",

    subject:
      "Problemă legată de magazin",
  },

  {
    id:
      "account",

    label:
      "Cont",

    subject:
      "Problemă legată de cont",
  },

  {
    id:
      "payment",

    label:
      "Plată",

    subject:
      "Problemă legată de plată",
  },

  {
    id:
      "delivery",

    label:
      "Livrare",

    subject:
      "Problemă legată de livrare",
  },

  {
    id:
      "technical",

    label:
      "Problemă tehnică",

    subject:
      "Problemă tehnică în platformă",
  },

  {
    id:
      "other",

    label:
      "Altceva",

    subject:
      "Solicitare de asistență",
  },
];

/* =========================================================
   Acțiuni meniu
========================================================= */

export const HELP_ACTIONS = [
  {
    id:
      SUPPORT_FLOWS.NEW_REQUEST,

    title:
      "Am nevoie de ajutor",

    description:
      "Descrie problema, iar asistentul o trimite echipei Artfest.",

    icon:
      SupportIcon,
  },

  {
    id:
      SUPPORT_FLOWS.CONVERSATIONS,

    title:
      "Conversațiile mele",

    description:
      "Vezi solicitările și răspunsurile primite.",

    icon:
      ConversationIcon,
  },

  /*
   * DEZACTIVAT TEMPORAR
   * Va fi reactivat după implementarea retururilor.
   *
  {
    id:
      "return",

    title:
      "Creează un retur",

    description:
      "Selectează comanda și produsul pe care dorești să-l returnezi.",

    icon:
      ReturnIcon,
  },
  */

  /*
   * DEZACTIVAT TEMPORAR
   * Va fi reactivat după completarea centrului FAQ.
   *
  {
    id:
      SUPPORT_FLOWS.FAQ,

    title:
      "Întrebări frecvente",

    description:
      "Primește rapid informații despre platformă.",

    icon:
      FaqIcon,
  },
  */
];

/* =========================================================
   Helpers generale
========================================================= */

function normalizeText(
  value
) {
  return typeof value ===
    "string"
    ? value.trim()
    : "";
}

function getErrorMessage(
  error
) {
  if (
    error instanceof Error &&
    error.message
  ) {
    return error.message;
  }

  return "A apărut o problemă. Te rog să încerci din nou.";
}

function getChoiceLabel(
  choice
) {
  if (
    typeof choice ===
    "string"
  ) {
    return choice;
  }

  if (
    choice &&
    typeof choice ===
      "object"
  ) {
    return (
      choice.label ||
      choice.title ||
      ""
    );
  }

  return "";
}

function getChoiceAction(
  choice
) {
  if (
    !choice ||
    typeof choice !==
      "object"
  ) {
    return null;
  }

  return (
    choice.action ||
    choice.type ||
    null
  );
}

function getChoiceTicketId(
  choice
) {
  if (
    !choice ||
    typeof choice !==
      "object"
  ) {
    return null;
  }

  return (
    choice.ticketId ||
    choice.id ||
    null
  );
}

function getDescriptionCategory(
  activeFlow
) {
  if (
    typeof activeFlow !==
      "string" ||
    !activeFlow.startsWith(
      `${SUPPORT_FLOWS.DESCRIPTION}:`
    )
  ) {
    return null;
  }

  const categoryId =
    activeFlow.slice(
      `${SUPPORT_FLOWS.DESCRIPTION}:`
        .length
    );

  return (
    SUPPORT_CATEGORIES.find(
      (category) =>
        category.id ===
        categoryId
    ) || null
  );
}

function createCategoryChoices() {
  return SUPPORT_CATEGORIES.map(
    (category) =>
      category.label
  );
}

function createOpenTicketChoice(
  ticket
) {
  return {
    id:
      ticket.id,

    ticketId:
      ticket.id,

    action:
      SUPPORT_ACTIONS.OPEN_TICKET,

    label:
      "Deschide conversația",
  };
}

function createArchiveTicketChoice(
  ticket
) {
  return {
    id:
      ticket.id,

    ticketId:
      ticket.id,

    action:
      SUPPORT_ACTIONS.ARCHIVE_TICKET,

    label:
      "Arhivează conversația",
  };
}

/* =========================================================
   Helpers flow
========================================================= */

export function getTicketIdFromFlow(
  activeFlow
) {
  if (
    typeof activeFlow !==
      "string" ||
    !activeFlow.startsWith(
      SUPPORT_FLOWS.TICKET_PREFIX
    )
  ) {
    return null;
  }

  return (
    activeFlow.slice(
      SUPPORT_FLOWS
        .TICKET_PREFIX.length
    ) || null
  );
}

export function isSupportTicketFlow(
  activeFlow
) {
  return Boolean(
    getTicketIdFromFlow(
      activeFlow
    )
  );
}

export function getSupportCategoryByLabel(
  label
) {
  const normalizedLabel =
    normalizeText(
      label
    ).toLowerCase();

  return (
    SUPPORT_CATEGORIES.find(
      (category) =>
        category.label
          .toLowerCase() ===
        normalizedLabel
    ) || null
  );
}

/* =========================================================
   Afișare selector categorie
========================================================= */

function showSupportCategories({
  addMessage,
  createMessage,
  setActiveFlow,
  text =
    "Selectează categoria problemei.",
}) {
  setActiveFlow?.(
    SUPPORT_FLOWS.CATEGORY
  );

  addMessage(
    createMessage(
      "assistant",
      text,
      {
        type:
          "choices",

        choiceStep:
          "support-category",

        choices:
          createCategoryChoices(),
      }
    )
  );
}

/* =========================================================
   Încărcare listă tichete
========================================================= */

export async function loadSupportTickets({
  addMessage,
  removeMessage,
  createMessage,
  offset = 0,
  limit = 20,
  append = false,
}) {
  const loadingMessage =
    createMessage(
      "assistant",
      append
        ? "Încarc mai multe conversații..."
        : "Încarc conversațiile...",
      {
        type:
          "loading",
      }
    );

  addMessage(
    loadingMessage
  );

  try {
    const result =
      await fetchSupportTickets({
        offset,
        limit,
      });

    removeMessage?.(
      loadingMessage.id
    );

    addMessage(
      createMessage(
        "assistant",
        result.items.length
          ? append
            ? `Am încărcat încă ${result.items.length} ${
                result.items.length ===
                1
                  ? "conversație"
                  : "conversații"
              }.`
            : `Ai ${result.total} ${
                result.total === 1
                  ? "conversație de suport"
                  : "conversații de suport"
              }.`
          : append
          ? "Nu mai există alte conversații."
          : "Nu ai încă nicio conversație cu echipa Artfest.",
        {
          type:
            "support-ticket-list",

          tickets:
            result.items,

          total:
            result.total,

          hasMore:
            result.hasMore,

          nextOffset:
            result.nextOffset,

          append,

          emptyActionLabel:
            "Creează o solicitare",

          choices:
            result.hasMore
              ? [
                  {
                    action:
                      SUPPORT_ACTIONS.LOAD_MORE_TICKETS,

                    label:
                      "Încarcă mai multe",

                    offset:
                      result.nextOffset,
                  },
                ]
              : [],
        }
      )
    );

    return true;
  } catch (
    error
  ) {
    removeMessage?.(
      loadingMessage.id
    );

    addMessage(
      createMessage(
        "assistant",
        getErrorMessage(
          error
        ),
        {
          type:
            "choices",

          choiceStep:
            "support-load-error",

          choices: [
            "Încearcă din nou",
          ],

          retryPayload: {
            action:
              "load-tickets",

            offset,
            limit,
            append,
          },
        }
      )
    );

    return true;
  }
}

/* =========================================================
   Deschidere tichet
========================================================= */

export async function openSupportTicket({
  ticket,
  ticketId,
  addMessage,
  removeMessage,
  createMessage,
  setActiveFlow,
  offset = 0,
  limit = 50,
  append = false,
}) {
  const id =
    ticketId ||
    ticket?.id;

  if (!id) {
    addMessage(
      createMessage(
        "assistant",
        "Conversația nu a putut fi deschisă."
      )
    );

    return true;
  }

  setActiveFlow?.(
    `${SUPPORT_FLOWS.TICKET_PREFIX}${id}`
  );

  const loadingMessage =
    createMessage(
      "assistant",
      append
        ? "Încarc mesajele mai vechi..."
        : `Deschid conversația „${
            ticket?.subject ||
            "Solicitare de suport"
          }”...`,
      {
        type:
          "loading",
      }
    );

  addMessage(
    loadingMessage
  );

  try {
    const result =
      await fetchSupportMessages(
        id,
        {
          offset,
          limit,
        }
      );

    if (
      !append
    ) {
      await markSupportTicketRead(
        id
      ).catch(
        () => null
      );
    }

    removeMessage?.(
      loadingMessage.id
    );

    const normalizedTicket =
      result.ticket ||
      ticket || {
        id,

        subject:
          "Solicitare de suport",

        status:
          "open",

        statusLabel:
          "Deschis",
      };

    const isClosed =
      normalizedTicket.status ===
      "closed";

    addMessage(
      createMessage(
        "assistant",
        append
          ? "Am încărcat mesajele mai vechi."
          : normalizedTicket.subject ||
              "Conversație cu suportul",
        {
          type:
            "support-thread",

          ticket:
            normalizedTicket,

          supportMessages:
            result.items,

          total:
            result.total,

          hasMore:
            result.hasMore,

          nextOffset:
            result.nextOffset,

          append,

          canReply:
            !isClosed,

          choices: [
            ...(result.hasMore
              ? [
                  {
                    action:
                      SUPPORT_ACTIONS.LOAD_MORE_MESSAGES,

                    label:
                      "Încarcă mesajele mai vechi",

                    ticketId:
                      id,

                    offset:
                      result.nextOffset,
                  },
                ]
              : []),

            ...(!isClosed
              ? [
                  createArchiveTicketChoice(
                    normalizedTicket
                  ),
                ]
              : []),
          ],
        }
      )
    );

    return true;
  } catch (
    error
  ) {
    removeMessage?.(
      loadingMessage.id
    );

    addMessage(
      createMessage(
        "assistant",
        getErrorMessage(
          error
        ),
        {
          type:
            "choices",

          choiceStep:
            "support-ticket-error",

          choices: [
            "Încearcă din nou",
            "Conversațiile mele",
          ],

          retryPayload: {
            action:
              "open-ticket",

            ticketId:
              id,

            offset,
            limit,
            append,
          },
        }
      )
    );

    return true;
  }
}

/* =========================================================
   Arhivare tichet
========================================================= */

export async function archiveSupportConversation({
  ticketId,
  addMessage,
  removeMessage,
  createMessage,
  setActiveFlow,
}) {
  if (
    !ticketId
  ) {
    return false;
  }

  const loadingMessage =
    createMessage(
      "assistant",
      "Arhivez conversația...",
      {
        type:
          "loading",
      }
    );

  addMessage(
    loadingMessage
  );

  try {
    await archiveSupportTicket(
      ticketId
    );

    removeMessage?.(
      loadingMessage.id
    );

    setActiveFlow?.(
      SUPPORT_FLOWS.CONVERSATIONS
    );

    addMessage(
      createMessage(
        "assistant",
        "Conversația a fost arhivată.",
        {
          type:
            "choices",

          choices: [
            "Conversațiile mele",
            "Creează o solicitare",
          ],
        }
      )
    );

    return true;
  } catch (
    error
  ) {
    removeMessage?.(
      loadingMessage.id
    );

    addMessage(
      createMessage(
        "assistant",
        getErrorMessage(
          error
        ),
        {
          type:
            "choices",

          choiceStep:
            "support-archive-error",

          choices: [
            "Încearcă din nou",
          ],

          retryPayload: {
            action:
              "archive-ticket",

            ticketId,
          },
        }
      )
    );

    return true;
  }
}

/* =========================================================
   Pornire flux suport
========================================================= */

export async function startSupportFlow({
  actionId,
  addConversation,
  addMessage,
  removeMessage,
  createMessage,
  setActiveFlow,
}) {
  switch (
    actionId
  ) {
    case SUPPORT_FLOWS.NEW_REQUEST: {
      setActiveFlow?.(
        SUPPORT_FLOWS.CATEGORY
      );

      addConversation(
        "Am nevoie de ajutor.",
        "Desigur. Selectează categoria care descrie cel mai bine problema ta.",
        {
          type:
            "choices",

          choiceStep:
            "support-category",

          choices:
            createCategoryChoices(),
        }
      );

      return true;
    }

    case SUPPORT_FLOWS.CONVERSATIONS: {
      setActiveFlow?.(
        SUPPORT_FLOWS.CONVERSATIONS
      );

      addConversation(
        "Vreau să văd conversațiile mele.",
        "Încarc solicitările tale de suport..."
      );

      await loadSupportTickets({
        addMessage,
        removeMessage,
        createMessage,
      });

      return true;
    }

    case SUPPORT_FLOWS.FAQ: {
      setActiveFlow?.(
        SUPPORT_FLOWS.FAQ
      );

      addConversation(
        "Am o întrebare despre platformă.",
        "Scrie întrebarea cât mai clar. Voi căuta răspunsul în centrul de ajutor Artfest."
      );

      return true;
    }

    default:
      return false;
  }
}

/* =========================================================
   Retry operație
========================================================= */

async function retrySupportOperation({
  retryPayload,
  addMessage,
  removeMessage,
  createMessage,
  setActiveFlow,
}) {
  if (
    !retryPayload?.action
  ) {
    return false;
  }

  switch (
    retryPayload.action
  ) {
    case "load-tickets":
      return loadSupportTickets({
        addMessage,
        removeMessage,
        createMessage,

        offset:
          retryPayload.offset ||
          0,

        limit:
          retryPayload.limit ||
          20,

        append:
          Boolean(
            retryPayload.append
          ),
      });

    case "open-ticket":
      return openSupportTicket({
        ticketId:
          retryPayload.ticketId,

        addMessage,
        removeMessage,
        createMessage,
        setActiveFlow,

        offset:
          retryPayload.offset ||
          0,

        limit:
          retryPayload.limit ||
          50,

        append:
          Boolean(
            retryPayload.append
          ),
      });

    case "archive-ticket":
      return archiveSupportConversation({
        ticketId:
          retryPayload.ticketId,

        addMessage,
        removeMessage,
        createMessage,
        setActiveFlow,
      });

    case "create-ticket": {
    const {
  subject,
  category,
  priority,
  message,
  attachments = [],
  name = "",
  email = "",
} = retryPayload;

      const loadingMessage =
        createMessage(
          "assistant",
          "Retrimit solicitarea către echipa Artfest...",
          {
            type:
              "loading",
          }
        );

      addMessage(
        loadingMessage
      );

      try {
      const result =
  await createSupportTicket({
    subject,
    category,
    priority,
    message,
    attachments,
    name,
    email,
  });
removeMessage?.(
  loadingMessage.id
);

const ticket =
  result.ticket;

if (result.canOpenConversation) {
  setActiveFlow?.(
    `${SUPPORT_FLOWS.TICKET_PREFIX}${ticket.id}`
  );
} else {
  setActiveFlow?.(null);
}

addMessage(
  createMessage(
    "assistant",
    result.mode === "guest"
      ? "Solicitarea a fost trimisă cu succes. Vei primi răspunsul pe email."
      : "Solicitarea a fost trimisă cu succes.",
    {
      type:
        "support-ticket-created",

      ticket,

      choices:
        result.canOpenConversation
          ? [
              createOpenTicketChoice(ticket),
            ]
          : [],
    }
  )
);

        return true;
      } catch (
        error
      ) {
        removeMessage?.(
          loadingMessage.id
        );

        addMessage(
          createMessage(
            "assistant",
            getErrorMessage(
              error
            ),
            {
              type:
                "choices",

              choiceStep:
                "support-create-error",

              choices: [
                "Încearcă din nou",
              ],

              retryPayload,
            }
          )
        );

        return true;
      }
    }

    case "send-message": {
      const {
        ticketId,
        body,
        attachments = [],
      } =
        retryPayload;

      const loadingMessage =
        createMessage(
          "assistant",
          "Retrimit mesajul...",
          {
            type:
              "loading",
          }
        );

      addMessage(
        loadingMessage
      );

      try {
        await sendSupportTicketMessage({
          ticketId,
          body,
          attachments,
        });

        removeMessage?.(
          loadingMessage.id
        );

        await openSupportTicket({
          ticketId,
          addMessage,
          removeMessage,
          createMessage,
          setActiveFlow,
        });

        return true;
      } catch (
        error
      ) {
        removeMessage?.(
          loadingMessage.id
        );

        addMessage(
          createMessage(
            "assistant",
            getErrorMessage(
              error
            ),
            {
              type:
                "choices",

              choiceStep:
                "support-message-error",

              choices: [
                "Încearcă din nou",
              ],

              retryPayload,
            }
          )
        );

        return true;
      }
    }

    case "search-faq": {
      const query =
        retryPayload.query ||
        "";

      setActiveFlow?.(
        SUPPORT_FLOWS.FAQ
      );

      return submitSupportMessage({
        activeFlow:
          SUPPORT_FLOWS.FAQ,

        value:
          query,

        addMessage,
        removeMessage,
        createMessage,
        setActiveFlow,
      });
    }

    default:
      return false;
  }
}

/* =========================================================
   Alegeri utilizator
========================================================= */

export async function handleSupportChoice({
  activeFlow,
  choice,
  sourceMessage,
  addMessage,
  removeMessage,
  createMessage,
  setActiveFlow,
}) {
  const choiceLabel =
    getChoiceLabel(
      choice
    );

  const choiceAction =
    getChoiceAction(
      choice
    );

  /*
   * Retry bazat pe datele salvate în mesaj.
   */
  if (
    choiceLabel ===
      "Încearcă din nou" &&
    sourceMessage
      ?.retryPayload
  ) {
    return retrySupportOperation({
      retryPayload:
        sourceMessage.retryPayload,

      addMessage,
      removeMessage,
      createMessage,
      setActiveFlow,
    });
  }

  /*
   * Choice structurat: deschidere tichet.
   */
  if (
    choiceAction ===
    SUPPORT_ACTIONS.OPEN_TICKET
  ) {
    const ticketId =
      getChoiceTicketId(
        choice
      );

    await openSupportTicket({
      ticketId,
      ticket:
        sourceMessage?.ticket,

      addMessage,
      removeMessage,
      createMessage,
      setActiveFlow,
    });

    return true;
  }

  /*
   * Choice structurat: arhivare.
   */
  if (
    choiceAction ===
    SUPPORT_ACTIONS.ARCHIVE_TICKET
  ) {
    const ticketId =
      getChoiceTicketId(
        choice
      );

    return archiveSupportConversation({
      ticketId,
      addMessage,
      removeMessage,
      createMessage,
      setActiveFlow,
    });
  }

  /*
   * Choice structurat: paginare tichete.
   */
  if (
    choiceAction ===
    SUPPORT_ACTIONS.LOAD_MORE_TICKETS
  ) {
    return loadSupportTickets({
      addMessage,
      removeMessage,
      createMessage,

      offset:
        choice.offset ||
        sourceMessage
          ?.nextOffset ||
        0,

      append:
        true,
    });
  }

  /*
   * Choice structurat: paginare mesaje.
   */
  if (
    choiceAction ===
    SUPPORT_ACTIONS.LOAD_MORE_MESSAGES
  ) {
    const ticketId =
      choice.ticketId ||
      sourceMessage
        ?.ticket?.id ||
      getTicketIdFromFlow(
        activeFlow
      );

    return openSupportTicket({
      ticketId,
      addMessage,
      removeMessage,
      createMessage,
      setActiveFlow,

      offset:
        choice.offset ||
        sourceMessage
          ?.nextOffset ||
        0,

      append:
        true,
    });
  }

  /*
   * Compatibilitate pentru lista de tichete care trimite
   * direct obiectul tichetului drept choice.
   */
  if (
    sourceMessage?.type ===
      "support-ticket-list" &&
    choice?.id
  ) {
    await openSupportTicket({
      ticket:
        choice,

      addMessage,
      removeMessage,
      createMessage,
      setActiveFlow,
    });

    return true;
  }

  /*
   * Compatibilitate cu vechiul choice string:
   * "Deschide conversația".
   */
  if (
    sourceMessage?.type ===
      "support-ticket-created" &&
    choiceLabel ===
      "Deschide conversația" &&
    sourceMessage
      ?.ticket?.id
  ) {
    await openSupportTicket({
      ticket:
        sourceMessage.ticket,

      addMessage,
      removeMessage,
      createMessage,
      setActiveFlow,
    });

    return true;
  }

  /*
   * Reîncărcare listă.
   */
  if (
    activeFlow ===
      SUPPORT_FLOWS.CONVERSATIONS &&
    choiceLabel ===
      "Încearcă din nou"
  ) {
    await loadSupportTickets({
      addMessage,
      removeMessage,
      createMessage,
    });

    return true;
  }

  /*
   * Creare solicitare.
   */
  if (
    choiceLabel ===
      "Creează o solicitare" ||
    choiceLabel ===
      "Am nevoie de suport"
  ) {
    showSupportCategories({
      addMessage,
      createMessage,
      setActiveFlow,
    });

    return true;
  }

  /*
   * Lista conversațiilor.
   */
  if (
    choiceLabel ===
    "Conversațiile mele"
  ) {
    setActiveFlow?.(
      SUPPORT_FLOWS.CONVERSATIONS
    );

    await loadSupportTickets({
      addMessage,
      removeMessage,
      createMessage,
    });

    return true;
  }

  /*
   * Retry simplu pentru deschiderea tichetului.
   */
  if (
    choiceLabel ===
      "Încearcă din nou" &&
    isSupportTicketFlow(
      activeFlow
    )
  ) {
    const ticketId =
      getTicketIdFromFlow(
        activeFlow
      );

    await openSupportTicket({
      ticketId,
      addMessage,
      removeMessage,
      createMessage,
      setActiveFlow,
    });

    return true;
  }

  /*
   * Selectarea categoriei.
   */
  if (
    activeFlow ===
    SUPPORT_FLOWS.CATEGORY
  ) {
    const category =
      getSupportCategoryByLabel(
        choiceLabel
      );

    if (
      !category
    ) {
      return false;
    }

    setActiveFlow?.(
      `${SUPPORT_FLOWS.DESCRIPTION}:${category.id}`
    );

    addMessage(
      createMessage(
        "assistant",
        `Ai selectat categoria „${category.label}”. Descrie problema cât mai clar și include, dacă este cazul, numărul comenzii, mesajul de eroare sau pașii efectuați.`,
        {
          type:
            "support-request-info",

          category:
            category.id,

          categoryLabel:
            category.label,

          subject:
            category.subject,
        }
      )
    );

    return true;
  }

  /*
   * FAQ fără rezultat.
   */
  if (
    sourceMessage?.choiceStep ===
      "support-faq-empty" &&
    choiceLabel ===
      "Mai caută"
  ) {
    setActiveFlow?.(
      SUPPORT_FLOWS.FAQ
    );

    addMessage(
      createMessage(
        "assistant",
        "Scrie întrebarea folosind alte cuvinte sau adaugă mai multe detalii."
      )
    );

    return true;
  }

  /*
   * FAQ rezolvat.
   */
  if (
    choiceLabel ===
    "Am rezolvat problema"
  ) {
    setActiveFlow?.(
      null
    );

    addMessage(
      createMessage(
        "assistant",
        "Mă bucur că ai găsit răspunsul de care aveai nevoie."
      )
    );

    return true;
  }

  return false;
}

/* =========================================================
   Trimitere mesaj suport
========================================================= */

export async function submitSupportMessage({
  activeFlow,
  value,
  addMessage,
  removeMessage,
  createMessage,
  setActiveFlow,
  attachments = [],
}) {
  const normalizedValue =
    normalizeText(
      value
    );

  const normalizedAttachments =
    Array.isArray(
      attachments
    )
      ? attachments
      : [];

  const descriptionCategory =
    getDescriptionCategory(
      activeFlow
    );

  /*
   * Creare tichet nou.
   */
  if (
    descriptionCategory
  ) {
    if (
      !normalizedValue
    ) {
      addMessage(
        createMessage(
          "assistant",
          "Descrie problema înainte de a trimite solicitarea."
        )
      );

      return true;
    }

    let requestPayload = {
  subject:
    descriptionCategory.subject,

  category:
    descriptionCategory.id,

  priority:
    descriptionCategory.id ===
    "payment"
      ? "high"
      : "medium",

  message:
    normalizedValue,

  attachments:
    normalizedAttachments,

  name:
    "",

  email:
    "",
};

    const loadingMessage =
      createMessage(
        "assistant",
        "Trimit solicitarea către echipa Artfest...",
        {
          type:
            "loading",
        }
      );

    addMessage(
      loadingMessage
    );

    try {
    let result;

try {
  result =
    await createSupportTicket(
      requestPayload
    );
} catch (error) {
  /*
   * Backendul cere email doar pentru utilizatorii
   * neautentificați.
   */
  if (
    error?.code !==
    "guest_email_required"
  ) {
    throw error;
  }

  const guestName =
    normalizeText(
      window.prompt(
        "Introdu numele tău:"
      ) || ""
    );

  const guestEmail =
    normalizeText(
      window.prompt(
        "Introdu adresa ta de email:"
      ) || ""
    ).toLowerCase();

  if (!guestEmail) {
    throw new Error(
      "Adresa de email este obligatorie pentru trimiterea solicitării."
    );
  }

  requestPayload = {
    ...requestPayload,

    name:
      guestName,

    email:
      guestEmail,
  };

  result =
    await createSupportTicket(
      requestPayload
    );
}

removeMessage?.(
  loadingMessage.id
);

const ticket =
  result.ticket;

if (result.canOpenConversation) {
  setActiveFlow?.(
    `${SUPPORT_FLOWS.TICKET_PREFIX}${ticket.id}`
  );
} else {
  setActiveFlow?.(null);
}

addMessage(
  createMessage(
    "assistant",
    result.mode === "guest"
      ? "Solicitarea a fost trimisă cu succes. Vei primi răspunsul pe email."
      : "Solicitarea a fost trimisă cu succes. Echipa Artfest îți va răspunde în această conversație.",
    {
      type:
        "support-ticket-created",

      ticket,

      choices:
        result.canOpenConversation
          ? [
              createOpenTicketChoice(
                ticket
              ),
            ]
          : [],
    }
  )
);

      return true;
    } catch (
      error
    ) {
      removeMessage?.(
        loadingMessage.id
      );

      addMessage(
        createMessage(
          "assistant",
          getErrorMessage(
            error
          ),
          {
            type:
              "choices",

            choiceStep:
              "support-create-error",

            choices: [
              "Încearcă din nou",
            ],

            retryPayload: {
              action:
                "create-ticket",

              ...requestPayload,
            },
          }
        )
      );

      return true;
    }
  }

  /*
   * Căutare FAQ.
   */
  if (
    activeFlow ===
    SUPPORT_FLOWS.FAQ
  ) {
    if (
      !normalizedValue
    ) {
      addMessage(
        createMessage(
          "assistant",
          "Scrie întrebarea pe care dorești să o cauți."
        )
      );

      return true;
    }

    const loadingMessage =
      createMessage(
        "assistant",
        "Caut informația în centrul de ajutor...",
        {
          type:
            "loading",
        }
      );

    addMessage(
      loadingMessage
    );

    try {
      const faqItems =
        await searchSupportFaq(
          normalizedValue
        );

      removeMessage?.(
        loadingMessage.id
      );

      if (
        faqItems.length ===
        0
      ) {
        addMessage(
          createMessage(
            "assistant",
            "Nu am găsit un răspuns suficient de relevant. Pot trimite întrebarea către echipa Artfest.",
            {
              type:
                "choices",

              choiceStep:
                "support-faq-empty",

              query:
                normalizedValue,

              choices: [
                "Creează o solicitare",
                "Mai caută",
              ],
            }
          )
        );

        return true;
      }

      addMessage(
        createMessage(
          "assistant",
          faqItems.length ===
          1
            ? "Am găsit un răspuns relevant."
            : `Am găsit ${faqItems.length} răspunsuri relevante.`,
          {
            type:
              "support-faq-results",

            query:
              normalizedValue,

            items:
              faqItems.slice(
                0,
                5
              ),

            choices: [
              "Am rezolvat problema",
              "Am nevoie de suport",
            ],
          }
        )
      );

      return true;
    } catch (
      error
    ) {
      removeMessage?.(
        loadingMessage.id
      );

      addMessage(
        createMessage(
          "assistant",
          getErrorMessage(
            error
          ),
          {
            type:
              "choices",

            choiceStep:
              "support-faq-error",

            choices: [
              "Încearcă din nou",
              "Creează o solicitare",
            ],

            retryPayload: {
              action:
                "search-faq",

              query:
                normalizedValue,
            },
          }
        )
      );

      return true;
    }
  }

  /*
   * Răspuns într-un tichet existent.
   */
  const ticketId =
    getTicketIdFromFlow(
      activeFlow
    );

  if (
    ticketId
  ) {
    if (
      !normalizedValue &&
      normalizedAttachments.length ===
        0
    ) {
      addMessage(
        createMessage(
          "assistant",
          "Scrie un mesaj sau adaugă un atașament."
        )
      );

      return true;
    }

    const requestPayload = {
      ticketId,

      body:
        normalizedValue,

      attachments:
        normalizedAttachments,
    };

    const loadingMessage =
      createMessage(
        "assistant",
        "Trimit mesajul...",
        {
          type:
            "loading",
        }
      );

    addMessage(
      loadingMessage
    );

    try {
      await sendSupportTicketMessage(
        requestPayload
      );

      removeMessage?.(
        loadingMessage.id
      );

      /*
       * Reîncărcăm conversația pentru a afișa atât mesajul
       * nou, cât și eventualele actualizări de status.
       */
      await openSupportTicket({
        ticketId,
        addMessage,
        removeMessage,
        createMessage,
        setActiveFlow,
      });

      return true;
    } catch (
      error
    ) {
      removeMessage?.(
        loadingMessage.id
      );

      addMessage(
        createMessage(
          "assistant",
          getErrorMessage(
            error
          ),
          {
            type:
              "choices",

            choiceStep:
              "support-message-error",

            choices: [
              "Încearcă din nou",
            ],

            retryPayload: {
              action:
                "send-message",

              ...requestPayload,
            },
          }
        )
      );

      return true;
    }
  }

  return false;
}

/* =========================================================
   Răspunsuri temporare
========================================================= */

export function getSupportTemporaryResponse() {
  return null;
}

export function getSupportImageUploadResponse(
  activeFlow
) {
  if (
    getDescriptionCategory(
      activeFlow
    ) ||
    isSupportTicketFlow(
      activeFlow
    )
  ) {
    return "Fotografia a fost pregătită pentru solicitarea de suport.";
  }

  return null;
}

export function getSupportInputPlaceholder(
  activeFlow
) {
  if (
    getDescriptionCategory(
      activeFlow
    )
  ) {
    return "Descrie problema cât mai clar...";
  }

  if (
    activeFlow ===
    SUPPORT_FLOWS.FAQ
  ) {
    return "Scrie întrebarea ta...";
  }

  if (
    isSupportTicketFlow(
      activeFlow
    )
  ) {
    return "Scrie un răspuns echipei Artfest...";
  }

  if (
    activeFlow ===
    SUPPORT_FLOWS.CONVERSATIONS
  ) {
    return "Selectează o conversație...";
  }

  return null;
}

export {
  SupportIcon,
};