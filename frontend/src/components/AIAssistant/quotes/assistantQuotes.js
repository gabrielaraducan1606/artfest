// src/components/AiAssistant/quotes/assistantQuotes.js

import {
  createQuoteRequest,
  createVendorQuoteOffer,
  acceptQuoteOffer,
  rejectQuoteOffer,
  sendQuoteMessage,
  sendVendorQuoteMessage,
  sendQuoteAttachment,
  fetchMyQuotes,
  fetchQuote,
  fetchQuoteMessages,
  fetchVendorQuotes,
  fetchVendorQuote,
  fetchVendorQuoteMessages,
  markQuoteRead,
  markVendorQuoteRead,
} from "./quoteApi.js";
/* =========================================================
   Flow IDs
========================================================= */

export const QUOTE_FLOWS = {
  MY_QUOTES:
    "my-quotes",

  USER_QUOTE_THREAD:
    "quote-thread",

  VENDOR_QUOTES:
    "vendor-quotes",

  VENDOR_QUOTE_THREAD:
    "vendor-quote-thread",

  VENDOR_CREATE_OFFER:
    "vendor-create-offer",

  USER_ACCEPT_OFFER:
    "user-accept-offer",
};

/* =========================================================
   Statusuri afișate în asistent
========================================================= */

const ACTIVE_QUOTE_STATUSES =
  new Set([
    "NEW",
    "SUBMITTED",
    "IN_DISCUSSION",
    "IN_DISCUSSIONS",
    "OFFER_SENT",
  ]);

function isActiveQuote(
  quote
) {
  const status =
    String(
      quote?.status || ""
    )
      .trim()
      .toUpperCase();

  return ACTIVE_QUOTE_STATUSES.has(
    status
  );
}

/* =========================================================
   Helpers
========================================================= */

function getQuoteId(
  quote
) {
  return (
    quote?.quoteRequestId ||
    quote?.id ||
    null
  );
}

function getQuoteProductTitle(
  quote
) {
  return (
    quote?.productTitle ||
    quote?.product?.title ||
    quote?.product?.name ||
    "Cerere de ofertă"
  );
}

function getQuoteStoreName(
  quote
) {
  return (
    quote?.storeName ||
    quote?.store?.displayName ||
    quote?.store?.title ||
    quote?.service?.name ||
    quote?.vendor?.storeName ||
    null
  );
}

function getQuoteCustomerName(
  quote
) {
  return (
    quote?.customerName ||
    quote?.user?.name ||
    quote?.userName ||
    "Client"
  );
}

function getQuoteStatusLabel(
  status
) {
  switch (
    String(
      status || ""
    )
      .trim()
      .toUpperCase()
  ) {
    case "SUBMITTED":
    case "NEW":
      return "Cerere nouă";

    case "IN_DISCUSSION":
    case "IN_DISCUSSIONS":
      return "În discuție";

    case "OFFER_SENT":
      return "Ofertă trimisă";

    case "ACCEPTED":
      return "Acceptată";

    case "REJECTED":
      return "Refuzată";

    case "CANCELLED":
      return "Anulată";

    case "EXPIRED":
      return "Expirată";

    default:
      return (
        status ||
        "În așteptare"
      );
  }
}

function normalizeQuoteList(
  result
) {
  if (
    Array.isArray(
      result
    )
  ) {
    return result;
  }

  if (
    Array.isArray(
      result?.items
    )
  ) {
    return result.items;
  }

  if (
    Array.isArray(
      result?.quotes
    )
  ) {
    return result.quotes;
  }

  return [];
}

function normalizeMessageList(
  result
) {
  if (
    Array.isArray(
      result
    )
  ) {
    return result;
  }

  if (
    Array.isArray(
      result?.items
    )
  ) {
    return result.items;
  }

  if (
    Array.isArray(
      result?.messages
    )
  ) {
    return result.messages;
  }

  return [];
}

function normalizeOfferList(
  quote
) {
  if (
    !Array.isArray(
      quote?.offers
    )
  ) {
    return [];
  }

  return quote.offers;
}

function getPersistedOfferId(
  message
) {
  return (
    message?.offerId ||
    message?.offer?.id ||
    null
  );
}

function getMessageContent(
  message
) {
  return String(
    message?.body ||
      message?.content ||
      message?.text ||
      ""
  ).trim();
}

function getPersistedMessageId(
  message
) {
  return (
    message?.persistedId ||
    message?.id ||
    null
  );
}

function isOwnQuoteMessage({
  message,
  isVendorThread,
}) {
  const from =
    String(
      message?.from || ""
    )
      .trim()
      .toUpperCase();

  const senderRole =
    String(
      message?.senderRole ||
      message?.senderType ||
      ""
    )
      .trim()
      .toUpperCase();

  if (from === "ME") {
    return true;
  }

  if (isVendorThread) {
    return senderRole === "VENDOR";
  }

  return (
    senderRole === "USER" ||
    senderRole === "CUSTOMER"
  );
}

function getQuoteFieldQuestion(
  field
) {
  if (!field) {
    return "";
  }

  const label =
    String(
      field.label || ""
    ).trim();

  const optionalText =
    field.required === false
      ? "\n\nAcest câmp este opțional. Poți scrie „sari” dacă nu dorești să răspunzi."
      : "";

  if (!label) {
    return (
      "Completează următoarea informație:" +
      optionalText
    );
  }

  if (
    field.type === "select" &&
    Array.isArray(
      field.options
    ) &&
    field.options.length > 0
  ) {
    return `${label}\n\nPoți alege: ${field.options.join(
      ", "
    )}.${optionalText}`;
  }

  if (
    field.type === "date"
  ) {
    return `${label}\n\nPoți scrie data în formatul 15.08.2026.${optionalText}`;
  }

  return (
    label +
    optionalText
  );
}

function getQuoteFields(
  schema
) {
  if (
    !Array.isArray(
      schema
    )
  ) {
    return [];
  }

  return schema.filter(
    (field) =>
      field &&
      field.key &&
      field.type !==
        "file"
  );
}

function normalizeQuoteDate(
  value
) {
  const raw =
    String(
      value || ""
    ).trim();

  if (!raw) {
    return null;
  }

  /*
   * YYYY-MM-DD
   */
  const isoMatch =
    raw.match(
      /^(\d{4})-(\d{2})-(\d{2})$/
    );

  if (isoMatch) {
    const [
      ,
      year,
      month,
      day,
    ] =
      isoMatch;

    const date =
      new Date(
        `${year}-${month}-${day}T00:00:00`
      );

    if (
      !Number.isNaN(
        date.getTime()
      ) &&
      date.getFullYear() ===
        Number(year) &&
      date.getMonth() + 1 ===
        Number(month) &&
      date.getDate() ===
        Number(day)
    ) {
      return `${year}-${month}-${day}`;
    }

    return null;
  }

  /*
   * DD.MM.YYYY
   * DD/MM/YYYY
   * DD-MM-YYYY
   */
  const europeanMatch =
    raw.match(
      /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/
    );

  if (
    !europeanMatch
  ) {
    return null;
  }

  const [
    ,
    rawDay,
    rawMonth,
    rawYear,
  ] =
    europeanMatch;

  const day =
    String(
      Number(
        rawDay
      )
    ).padStart(
      2,
      "0"
    );

  const month =
    String(
      Number(
        rawMonth
      )
    ).padStart(
      2,
      "0"
    );

  const year =
    String(
      rawYear
    );

  const date =
    new Date(
      `${year}-${month}-${day}T00:00:00`
    );

  if (
    Number.isNaN(
      date.getTime()
    ) ||
    date.getFullYear() !==
      Number(year) ||
    date.getMonth() + 1 !==
      Number(month) ||
    date.getDate() !==
      Number(day)
  ) {
    return null;
  }

  return `${year}-${month}-${day}`;
}

/* =========================================================
   Transformare mesaj USER
========================================================= */

function createUserQuoteMessage({
  message,
  createMessage,
}) {
  const content =
    getMessageContent(
      message
    );

  if (!content) {
    return null;
  }

  const isMine =
    message?.from ===
      "me" ||
    message?.senderRole ===
      "USER" ||
    message?.senderType ===
      "USER" ||
    message?.senderRole ===
      "CUSTOMER" ||
    message?.senderType ===
      "CUSTOMER";

  return createMessage(
    isMine
      ? "user"
      : "assistant",

    content,

    {
      type:
        "quote-message",

      persistedId:
        message?.id ||
        null,

      createdAt:
        message?.createdAt ||
        null,

      quoteMessage:
        message,
    }
  );
}

/* =========================================================
   Transformare mesaj VENDOR
========================================================= */

function createVendorQuoteMessage({
  message,
  createMessage,
}) {
  const content =
    getMessageContent(
      message
    );

  if (!content) {
    return null;
  }

  const isMine =
    message?.from ===
      "me" ||
    message?.senderRole ===
      "VENDOR" ||
    message?.senderType ===
      "VENDOR";

  return createMessage(
    isMine
      ? "user"
      : "assistant",

    content,

    {
      type:
        "quote-message",

      persistedId:
        message?.id ||
        null,

      createdAt:
        message?.createdAt ||
        null,

      quoteMessage:
        message,
    }
  );
}

/* =========================================================
   Choices USER
========================================================= */

function buildUserQuoteChoice(
  quote
) {
  const id =
    getQuoteId(
      quote
    );

  if (!id) {
    return null;
  }

  const productTitle =
    getQuoteProductTitle(
      quote
    );

  const storeName =
    getQuoteStoreName(
      quote
    );

  const quantity =
    Number(
      quote?.quantity
    );

  const status =
    getQuoteStatusLabel(
      quote?.status
    );

  return {
    id,

    title:
      productTitle,

    label:
      productTitle,

    subject:
      productTitle,

    description: [
      Number.isFinite(
        quantity
      ) &&
      quantity > 0
        ? `${quantity} ${
            quantity === 1
              ? "bucată"
              : "bucăți"
          }`
        : null,

      storeName,

      status,
    ]
      .filter(
        Boolean
      )
      .join(
        " · "
      ),

    quote,
  };
}

/* =========================================================
   Choices VENDOR
========================================================= */

function buildVendorQuoteChoice(
  quote
) {
  const id =
    getQuoteId(
      quote
    );

  if (!id) {
    return null;
  }

  const productTitle =
    getQuoteProductTitle(
      quote
    );

  const customerName =
    getQuoteCustomerName(
      quote
    );

  const quantity =
    Number(
      quote?.quantity
    );

  const status =
    getQuoteStatusLabel(
      quote?.status
    );

  return {
    id,

    title:
      productTitle,

    label:
      productTitle,

    subject:
      productTitle,

    description: [
      customerName,

      Number.isFinite(
        quantity
      ) &&
      quantity > 0
        ? `${quantity} ${
            quantity === 1
              ? "bucată"
              : "bucăți"
          }`
        : null,

      status,
    ]
      .filter(
        Boolean
      )
      .join(
        " · "
      ),

    quote,
  };
}

/* =========================================================
   Adaugă istoricul conversației USER
========================================================= */

function addUserThreadMessages({
  messages,
  addMessage,
  createMessage,
}) {
  messages.forEach(
    (
      message
    ) => {
      const uiMessage =
        createUserQuoteMessage({
          message,
          createMessage,
        });

      if (
        !uiMessage
      ) {
        return;
      }

      addMessage(
        uiMessage
      );
    }
  );
}

/* =========================================================
   Adaugă istoricul conversației VENDOR
========================================================= */

function addVendorThreadMessages({
  messages,
  addMessage,
  createMessage,
}) {
  messages.forEach(
    (
      message
    ) => {
      const uiMessage =
        createVendorQuoteMessage({
          message,
          createMessage,
        });

      if (
        !uiMessage
      ) {
        return;
      }

      addMessage(
        uiMessage
      );
    }
  );
}

/* =========================================================
   Deschidere listă cereri USER
========================================================= */

export async function openMyQuotes({
  addMessage,
  createMessage,
  setActiveFlow,
}) {
  addMessage({
    id:
      `${Date.now()}-quotes-loading`,

    role:
      "assistant",

    type:
      "loading",

    content:
      "Încarc cererile tale de ofertă...",
  });

  try {
    const result =
      await fetchMyQuotes();

   const quotes =
  normalizeQuoteList(
    result
  ).filter(
    isActiveQuote
  );

    if (
      !quotes.length
    ) {
      addMessage(
        createMessage(
          "assistant",
          "Nu ai încă nicio cerere de ofertă."
        )
      );

      setActiveFlow(
        QUOTE_FLOWS.MY_QUOTES
      );

      return true;
    }

    const choices =
      quotes
        .map(
          buildUserQuoteChoice
        )
        .filter(
          Boolean
        );

    addMessage(
      createMessage(
        "assistant",
        "Alege cererea pe care vrei să o deschizi.",
        {
          type:
            "choices",

          choiceStep:
            "my-quotes",

          choices,
        }
      )
    );

    setActiveFlow(
      QUOTE_FLOWS.MY_QUOTES
    );

    return true;
  } catch (
    error
  ) {
    addMessage(
      createMessage(
        "assistant",
        error?.data
          ?.message ||
          error?.message ||
          "Nu am putut încărca cererile tale de ofertă."
      )
    );

    return true;
  }
}

/* =========================================================
   Deschidere listă cereri VENDOR
========================================================= */

export async function openVendorQuotes({
  addMessage,
  createMessage,
  setActiveFlow,
}) {
  addMessage({
    id:
      `${Date.now()}-vendor-quotes-loading`,

    role:
      "assistant",

    type:
      "loading",

    content:
      "Încarc cererile de ofertă primite...",
  });

  try {
    const result =
      await fetchVendorQuotes();

    const quotes =
  normalizeQuoteList(
    result
  ).filter(
    isActiveQuote
  );

    if (
      !quotes.length
    ) {
      addMessage(
        createMessage(
          "assistant",
          "Nu ai momentan cereri de ofertă."
        )
      );

      setActiveFlow(
        QUOTE_FLOWS.VENDOR_QUOTES
      );

      return true;
    }

    const choices =
      quotes
        .map(
          buildVendorQuoteChoice
        )
        .filter(
          Boolean
        );

    addMessage(
      createMessage(
        "assistant",
        "Alege cererea de ofertă pe care vrei să o deschizi.",
        {
          type:
            "choices",

          choiceStep:
            "vendor-quotes",

          choices,
        }
      )
    );

    setActiveFlow(
      QUOTE_FLOWS.VENDOR_QUOTES
    );

    return true;
  } catch (
    error
  ) {
    addMessage(
      createMessage(
        "assistant",
        error?.data
          ?.message ||
          error?.message ||
          "Nu am putut încărca cererile de ofertă."
      )
    );

    return true;
  }
}

/* =========================================================
   Deschidere cerere USER
========================================================= */

export async function openUserQuote({
  quoteId,

  addMessage,
  createMessage,

  setActiveFlow,
  setQuoteContext,
}) {
  if (
    !quoteId
  ) {
    return false;
  }

  try {
    const [
      quoteResult,
      messagesResult,
    ] =
      await Promise.all([
        fetchQuote(
          quoteId
        ),

        fetchQuoteMessages(
          quoteId
        ).catch(
          () => ({
            items:
              [],
          })
        ),
      ]);

    const quote =
      quoteResult?.quote ||
      quoteResult;

    const threadMessages =
      normalizeMessageList(
        messagesResult
      );

    const productTitle =
      getQuoteProductTitle(
        quote
      );

    const storeName =
      getQuoteStoreName(
        quote
      );

    const quantity =
      Number(
        quote?.quantity
      );

    const status =
      getQuoteStatusLabel(
        quote?.status
      );

    setQuoteContext({
      ...quote,

      quoteRequestId:
        getQuoteId(
          quote
        ) ||
        quoteId,

      threadId:
        quote?.threadId ||
        null,

      role:
        "user",
    });

    setActiveFlow(
      QUOTE_FLOWS
        .USER_QUOTE_THREAD
    );

    /*
     * Marcăm conversația citită.
     */
    await markQuoteRead(
      quoteId
    ).catch(
      () => null
    );

    addMessage(
      createMessage(
        "assistant",
        [
          `Cerere de ofertă: „${productTitle}”`,

          storeName
            ? `Magazin: ${storeName}`
            : null,

          Number.isFinite(
            quantity
          ) &&
          quantity > 0
            ? `Cantitate: ${quantity}`
            : null,

          `Status: ${status}`,

          "",

          threadMessages.length
            ? "Conversația:"
            : "Poți continua conversația aici.",
        ]
          .filter(
            (
              line
            ) =>
              line !==
              null
          )
          .join(
            "\n"
          ),
        {
          type:
            "quote-user-summary",

          quote,
        }
      )
    );

    addUserThreadMessages({
      messages:
        threadMessages,

      addMessage,
      createMessage,
    });
const offers =
  normalizeOfferList(
    quote
  );

offers.forEach(
  (
    offer
  ) => {
    const status =
      String(
        offer?.status ||
          ""
      )
        .trim()
        .toUpperCase();

    if (
      status ===
      "SUPERSEDED"
    ) {
      return;
    }

    addMessage(
      createMessage(
        "assistant",
        "",
        {
          type:
            "quote-offer-card",

          quoteId:
            getQuoteId(
              quote
            ) ||
            quoteId,

          offerId:
            offer?.id ||
            null,

          offer,
        }
      )
    );
  }
);
    return true;
  } catch (
    error
  ) {
    addMessage(
      createMessage(
        "assistant",
        error?.data
          ?.message ||
          error?.message ||
          "Nu am putut deschide cererea de ofertă."
      )
    );

    return true;
  }
}

/* =========================================================
   Deschidere cerere VENDOR
========================================================= */

export async function openVendorQuote({
  quoteId,

  addMessage,
  createMessage,

  setActiveFlow,
  setQuoteContext,
}) {
  if (
    !quoteId
  ) {
    return false;
  }

  try {
    const [
      quoteResult,
      messagesResult,
    ] =
      await Promise.all([
        fetchVendorQuote(
          quoteId
        ),

        fetchVendorQuoteMessages(
          quoteId
        ).catch(
          () => ({
            items:
              [],
          })
        ),
      ]);

    const quote =
      quoteResult?.quote ||
      quoteResult;

    const threadMessages =
      normalizeMessageList(
        messagesResult
      );

    const productTitle =
      getQuoteProductTitle(
        quote
      );

    const customerName =
      getQuoteCustomerName(
        quote
      );

    const quantity =
      Number(
        quote?.quantity
      );

    const status =
      getQuoteStatusLabel(
        quote?.status
      );

    const answers =
      quote
        ?.quoteSchemaAnswers &&
      typeof quote
        .quoteSchemaAnswers ===
        "object"
        ? quote
            .quoteSchemaAnswers
        : {};

    const schema =
      Array.isArray(
        quote
          ?.requestData
          ?.quoteSchemaSnapshot
      )
        ? quote
            .requestData
            .quoteSchemaSnapshot
        : Array.isArray(
              quote
                ?.quoteSchemaSnapshot
            )
          ? quote
              .quoteSchemaSnapshot
          : [];

    const answerLines =
      schema
        .map(
          (
            field
          ) => {
            const answer =
              answers[
                field.key
              ];

            if (
              answer ===
                undefined ||
              answer ===
                null ||
              answer ===
                ""
            ) {
              return null;
            }

            return `${field.label}: ${answer}`;
          }
        )
        .filter(
          Boolean
        );

    setQuoteContext({
      ...quote,

      quoteRequestId:
        getQuoteId(
          quote
        ) ||
        quoteId,

      threadId:
        quote?.threadId ||
        null,

      role:
        "vendor",
    });

    setActiveFlow(
      QUOTE_FLOWS
        .VENDOR_QUOTE_THREAD
    );

    /*
     * Marcăm conversația citită
     * de vendor.
     */
    await markVendorQuoteRead(
      quoteId
    ).catch(
      () => null
    );

    addMessage(
      createMessage(
        "assistant",
        [
          `Cerere de ofertă pentru „${productTitle}”`,

          `Client: ${customerName}`,

          Number.isFinite(
            quantity
          ) &&
          quantity > 0
            ? `Cantitate: ${quantity}`
            : null,

          `Status: ${status}`,

          answerLines.length
            ? ""
            : null,

          ...answerLines,

          "",

          threadMessages.length
            ? "Conversația cu clientul:"
            : "Poți începe conversația cu clientul aici.",
        ]
          .filter(
            (
              line
            ) =>
              line !==
              null
          )
          .join(
            "\n"
          ),
        {
          type:
            "quote-vendor-summary",

          quote,
        }
      )
    );

    addVendorThreadMessages({
      messages:
        threadMessages,

      addMessage,
      createMessage,
    });

    return true;
  } catch (
    error
  ) {
    addMessage(
      createMessage(
        "assistant",
        error?.data
          ?.message ||
          error?.message ||
          "Nu am putut deschide cererea de ofertă."
      )
    );

    return true;
  }
}

/* =========================================================
   Refresh conversație activă

   Folosit de polling-ul din AiAssistant.

   IMPORTANT:
   - adaugă doar mesaje noi venite
     de la cealaltă parte;
   - nu readaugă propriile mesaje;
   - verifică persistedId pentru
     a evita duplicatele.
========================================================= */

export async function refreshQuoteThread({
  activeFlow,
  quoteId,
  currentMessages,
  addMessage,
  createMessage,
}) {
  if (!quoteId) {
    return false;
  }

  const isUserThread =
    activeFlow ===
    QUOTE_FLOWS
      .USER_QUOTE_THREAD;

  const isVendorThread =
    activeFlow ===
    QUOTE_FLOWS
      .VENDOR_QUOTE_THREAD;

  if (
    !isUserThread &&
    !isVendorThread
  ) {
    return false;
  }

  try {
    const [
      messagesResult,
      quoteResult,
    ] =
      await Promise.all([
        isVendorThread
          ? fetchVendorQuoteMessages(
              quoteId
            )
          : fetchQuoteMessages(
              quoteId
            ),

        isUserThread
          ? fetchQuote(
              quoteId
            ).catch(
              () => null
            )
          : Promise.resolve(
              null
            ),
      ]);

    const serverMessages =
      normalizeMessageList(
        messagesResult
      );

    const safeCurrentMessages =
      Array.isArray(
        currentMessages
      )
        ? currentMessages
        : [];

    const existingMessageIds =
      new Set(
        safeCurrentMessages
          .map(
            getPersistedMessageId
          )
          .filter(
            Boolean
          )
          .map(
            String
          )
      );
for (
  const serverMessage
  of serverMessages
) {
  const serverId =
    serverMessage?.id;

  if (!serverId) {
    continue;
  }

  /*
   * Nu readăugăm mesajele
   * trimise chiar de utilizatorul
   * curent.
   */
  if (
    isOwnQuoteMessage({
      message:
        serverMessage,
      isVendorThread,
    })
  ) {
    existingMessageIds.add(
      String(serverId)
    );

    continue;
  }

  if (
    existingMessageIds.has(
      String(serverId)
    )
  ) {
    continue;
  }

  const uiMessage =
    isVendorThread
      ? createVendorQuoteMessage({
          message:
            serverMessage,
          createMessage,
        })
      : createUserQuoteMessage({
          message:
            serverMessage,
          createMessage,
        });

  if (!uiMessage) {
    continue;
  }

  addMessage(uiMessage);

  existingMessageIds.add(
    String(serverId)
  );
}

    if (
      isUserThread &&
      quoteResult
    ) {
      const quote =
        quoteResult?.quote ||
        quoteResult;

      const offers =
        normalizeOfferList(
          quote
        );

      const existingOfferIds =
        new Set(
          safeCurrentMessages
            .filter(
              (
                message
              ) =>
                message?.type ===
                "quote-offer-card"
            )
            .map(
              getPersistedOfferId
            )
            .filter(
              Boolean
            )
            .map(
              String
            )
        );

      for (
        const offer
        of offers
      ) {
        const offerId =
          offer?.id;

        if (!offerId) {
          continue;
        }

        const offerStatus =
          String(
            offer?.status ||
              ""
          )
            .trim()
            .toUpperCase();

        if (
          offerStatus ===
          "SUPERSEDED"
        ) {
          continue;
        }

        if (
          existingOfferIds.has(
            String(
              offerId
            )
          )
        ) {
          continue;
        }

        addMessage(
          createMessage(
            "assistant",
            "",
            {
              type:
                "quote-offer-card",

              quoteId,

              offerId,

              offer,
            }
          )
        );

        existingOfferIds.add(
          String(
            offerId
          )
        );
      }
    }

    if (
      isVendorThread
    ) {
      await markVendorQuoteRead(
        quoteId
      ).catch(
        () => null
      );
    } else {
      await markQuoteRead(
        quoteId
      ).catch(
        () => null
      );
    }

    return true;
  } catch (
    error
  ) {
    console.error(
      "refreshQuoteThread failed:",
      error
    );

    return false;
  }
}

/* =========================================================
   Handle choices
========================================================= */

export async function handleQuoteChoice({
  activeFlow,
  choice,

  addMessage,
  createMessage,

  setActiveFlow,
  setQuoteContext,
}) {
  if (
    !choice ||
    typeof choice !==
      "object"
  ) {
    return false;
  }

  /*
 * ============================================
 * CLIENT — acceptă oferta
 * ============================================
 */
/*
 * ============================================
 * CLIENT — începe acceptarea ofertei
 * ============================================
 */

if (
  choice.action ===
  "accept-quote-offer"
) {
  const quoteId =
    choice.quoteId ||
    choice?.offer?.quoteRequestId ||
    null;

  const offerId =
    choice.offerId ||
    choice?.offer?.id ||
    null;

  if (
    !quoteId ||
    !offerId
  ) {
    addMessage(
      createMessage(
        "assistant",
        "Nu am putut identifica oferta."
      )
    );

    return true;
  }

  setQuoteContext(
    (
      current
    ) => ({
      ...current,

      quoteRequestId:
        quoteId,

      acceptedOfferId:
        offerId,

      checkoutDraft: {
        step:
          "recipientName",

        recipientName:
          "",

        phone:
          "",

        addressLine1:
          "",

        city:
          "",

        county:
          "",

        postalCode:
          "",
      },
    })
  );

  setActiveFlow(
    QUOTE_FLOWS
      .USER_ACCEPT_OFFER
  );

  addMessage(
    createMessage(
      "assistant",
      "Perfect. Pentru a înregistra comanda, am nevoie de datele de livrare.\n\nCare este numele complet al persoanei care va primi coletul?"
    )
  );

  return true;
}
/*
 * ============================================
 * CLIENT — refuză definitiv oferta
 * ============================================
 */

if (
  choice.action ===
  "reject-quote-offer"
) {
  const quoteId =
    choice.quoteId ||
    choice?.offer?.quoteRequestId ||
    null;

  const offerId =
    choice.offerId ||
    choice?.offer?.id ||
    null;

  if (
    !quoteId ||
    !offerId
  ) {
    addMessage(
      createMessage(
        "assistant",
        "Nu am putut identifica oferta."
      )
    );

    return true;
  }

  try {
    await rejectQuoteOffer(
      quoteId,
      offerId
    );

    setQuoteContext(
      (
        current
      ) => ({
        ...current,

        status:
          "REJECTED",
      })
    );

    setActiveFlow(
      QUOTE_FLOWS
        .USER_QUOTE_THREAD
    );

    addMessage(
      createMessage(
        "assistant",
        "Oferta a fost refuzată definitiv."
      )
    );

    return true;
  } catch (
    error
  ) {
    addMessage(
      createMessage(
        "assistant",
        error?.data
          ?.message ||
          error?.message ||
          "Oferta nu a putut fi refuzată."
      )
    );

    return true;
  }
}

  /*
   * ============================================
   * VENDOR — începe flow-ul de creare ofertă
   * ============================================
   */
if (
  choice.action ===
  "request-new-quote-offer"
) {
  const quoteId =
    choice.quoteId ||
    choice?.offer?.quoteRequestId ||
    null;

  if (!quoteId) {
    addMessage(
      createMessage(
        "assistant",
        "Nu am putut identifica cererea de ofertă."
      )
    );

    return true;
  }

  setQuoteContext(
    (
      current
    ) => ({
      ...current,

      quoteRequestId:
        quoteId,
    })
  );

  setActiveFlow(
    QUOTE_FLOWS
      .USER_QUOTE_THREAD
  );

  addMessage(
    createMessage(
      "assistant",
      "Sigur. Scrie ce ai dori să fie modificat în ofertă — de exemplu prețul, cantitatea, termenul de producție sau costul transportului. Mesajul va ajunge direct la vânzător."
    )
  );

  return true;
}

if (
  choice.action ===
  "continue-quote-discussion"
) {
  const quoteId =
    choice.quoteId ||
    choice?.offer?.quoteRequestId ||
    null;

  if (!quoteId) {
    return true;
  }

  setQuoteContext(
    (
      current
    ) => ({
      ...current,

      quoteRequestId:
        quoteId,
    })
  );

  setActiveFlow(
    QUOTE_FLOWS
      .USER_QUOTE_THREAD
  );

  addMessage(
    createMessage(
      "assistant",
      "Poți continua conversația aici. Scrie mesajul tău pentru vânzător."
    )
  );

  return true;
}
  if (
    choice.action ===
    "start-quote-offer"
  ) {

    const quoteId =
      choice.quoteId ||
      choice.id ||
      choice?.quote?.id ||
      null;

    if (!quoteId) {
      addMessage(
        createMessage(
          "assistant",
          "Nu am putut identifica cererea de ofertă."
        )
      );

      return true;
    }

    setQuoteContext(
      (
        current
      ) => ({
        ...current,

        ...(choice.quote ||
          {}),

        quoteRequestId:
          quoteId,

        offerDraft: {
          step:
            "unitPrice",

          quantity:
            Number(
              choice
                ?.quote
                ?.quantity
            ) ||
            null,

          unitPrice:
            null,

          shippingPrice:
            0,

          productionDays:
            null,

          validUntil:
            null,

          notes:
            null,
        },
      })
    );

    setActiveFlow(
      QUOTE_FLOWS
        .VENDOR_CREATE_OFFER
    );

    addMessage(
      createMessage(
        "assistant",
        "Perfect. Hai să pregătim oferta.\n\nCare este prețul unitar în RON?"
      )
    );

    return true;
  }

  /*
   * ============================================
   * Deschidere cereri din liste
   * ============================================
   */

  const quoteId =
    choice.id ||
    choice.quoteRequestId ||
    choice?.quote?.id ||
    null;

  if (!quoteId) {
    return false;
  }

  if (
    activeFlow ===
    QUOTE_FLOWS.MY_QUOTES
  ) {
    return openUserQuote({
      quoteId,

      addMessage,
      createMessage,

      setActiveFlow,
      setQuoteContext,
    });
  }

  if (
    activeFlow ===
    QUOTE_FLOWS.VENDOR_QUOTES
  ) {
    return openVendorQuote({
      quoteId,

      addMessage,
      createMessage,

      setActiveFlow,
      setQuoteContext,
    });
  }

  return false;
}

/* =========================================================
   Submit mesaj / flow cerere ofertă

   Gestionează:
   - mesaj client -> vendor
   - mesaj vendor -> client
   - crearea unei cereri noi din produs
========================================================= */

export async function submitQuoteMessage({
  activeFlow,
  value,

  quoteContext,
  quoteDraft,
  uploadedImage,

  addMessage,
  createMessage,

  setActiveFlow,
  setQuoteContext,
  setQuoteDraft,

  clearUploadedImage,
}) {
  async function sendInspirationImage(
  threadId
) {
  if (
    !threadId ||
    !uploadedImage?.file
  ) {
    return false;
  }

  try {
    await sendQuoteAttachment(
      threadId,
      uploadedImage.file
    );

    return true;
  } catch (error) {
    addMessage(
      createMessage(
        "assistant",
        error?.data?.message ||
          error?.message ||
          "Cererea a fost creată, dar fotografia de inspirație nu a putut fi trimisă."
      )
    );

    return false;
  }
}
  /*
   * =====================================================
   * MESAJ CLIENT -> VENDOR
   * =====================================================
   */

  if (
    activeFlow ===
      QUOTE_FLOWS
        .USER_QUOTE_THREAD &&
    quoteContext
      ?.quoteRequestId
  ) {
    try {
  const result =
    await sendQuoteMessage(
      quoteContext
        .quoteRequestId,
      value
    );

  addMessage(
    createMessage(
      "user",
      value,
      {
        type:
          "quote-message",

        persistedId:
          result?.id ||
          null,

        createdAt:
          result?.createdAt ||
          new Date()
            .toISOString(),
      }
    )
  );

  clearUploadedImage?.();

  return true;
} catch (
  error
) {
      addMessage(
        createMessage(
          "assistant",

          error?.data
            ?.message ||
            error?.message ||
            "Mesajul nu a putut fi trimis."
        )
      );

      return true;
    }
  }
/*
 * =====================================================
 * CLIENT — DATE LIVRARE PENTRU ACCEPTAREA OFERTEI
 * =====================================================
 */

if (
  activeFlow ===
    QUOTE_FLOWS
      .USER_ACCEPT_OFFER &&
  quoteContext
    ?.quoteRequestId &&
  quoteContext
    ?.acceptedOfferId
) {
  const checkoutDraft =
    quoteContext
      ?.checkoutDraft ||
    {
      step:
        "recipientName",
    };

  const normalizedValue =
    String(
      value || ""
    ).trim();

  if (!normalizedValue) {
    addMessage(
      createMessage(
        "assistant",
        "Te rog să completezi informația solicitată."
      )
    );

    return true;
  }

  /*
   * PASUL 1 — NUME
   */

  if (
    checkoutDraft.step ===
    "recipientName"
  ) {
    setQuoteContext(
      (
        current
      ) => ({
        ...current,

        checkoutDraft: {
          ...current.checkoutDraft,

          recipientName:
            normalizedValue,

          step:
            "phone",
        },
      })
    );

    addMessage(
      createMessage(
        "assistant",
        "Care este numărul de telefon pentru livrare? Acesta va fi folosit doar pentru procesarea comenzii și livrare."
      )
    );

    return true;
  }

  /*
   * PASUL 2 — TELEFON
   */

  if (
    checkoutDraft.step ===
    "phone"
  ) {
    const normalizedPhone =
      normalizedValue.replace(
        /[^\d+]/g,
        ""
      );

    if (
      normalizedPhone.length <
      8
    ) {
      addMessage(
        createMessage(
          "assistant",
          "Numărul de telefon nu pare valid. Te rog să îl introduci din nou."
        )
      );

      return true;
    }

    setQuoteContext(
      (
        current
      ) => ({
        ...current,

        checkoutDraft: {
          ...current.checkoutDraft,

          phone:
            normalizedPhone,

          step:
            "addressLine1",
        },
      })
    );

    addMessage(
      createMessage(
        "assistant",
        "Care este adresa completă de livrare? Include strada, numărul și, dacă este cazul, blocul și apartamentul."
      )
    );

    return true;
  }

  /*
   * PASUL 3 — ADRESĂ
   */

  if (
    checkoutDraft.step ===
    "addressLine1"
  ) {
    setQuoteContext(
      (
        current
      ) => ({
        ...current,

        checkoutDraft: {
          ...current.checkoutDraft,

          addressLine1:
            normalizedValue,

          step:
            "city",
        },
      })
    );

    addMessage(
      createMessage(
        "assistant",
        "În ce localitate trebuie livrată comanda?"
      )
    );

    return true;
  }

  /*
   * PASUL 4 — LOCALITATE
   */

  if (
    checkoutDraft.step ===
    "city"
  ) {
    setQuoteContext(
      (
        current
      ) => ({
        ...current,

        checkoutDraft: {
          ...current.checkoutDraft,

          city:
            normalizedValue,

          step:
            "county",
        },
      })
    );

    addMessage(
      createMessage(
        "assistant",
        "În ce județ?"
      )
    );

    return true;
  }

  /*
   * PASUL 5 — JUDEȚ
   */

  if (
    checkoutDraft.step ===
    "county"
  ) {
    setQuoteContext(
      (
        current
      ) => ({
        ...current,

        checkoutDraft: {
          ...current.checkoutDraft,

          county:
            normalizedValue,

          step:
            "postalCode",
        },
      })
    );

    addMessage(
      createMessage(
        "assistant",
        "Care este codul poștal? Dacă nu îl cunoști, scrie „sari”."
      )
    );

    return true;
  }

  /*
   * PASUL 6 — COD POȘTAL ȘI CREARE COMANDĂ
   */

  if (
    checkoutDraft.step ===
    "postalCode"
  ) {
    const postalCode =
      [
        "sari",
        "skip",
        "-",
      ].includes(
        normalizedValue
          .toLowerCase()
      )
        ? ""
        : normalizedValue;

    const shippingAddress = {
      recipientName:
        checkoutDraft
          .recipientName,

      phone:
        checkoutDraft
          .phone,

      addressLine1:
        checkoutDraft
          .addressLine1,

      city:
        checkoutDraft
          .city,

      county:
        checkoutDraft
          .county,

      postalCode,
    };

    try {
      const result =
        await acceptQuoteOffer(
          quoteContext
            .quoteRequestId,

          quoteContext
            .acceptedOfferId,

          {
            shippingAddress,
          }
        );

      setQuoteContext(
        (
          current
        ) => ({
          ...current,

          status:
            "ACCEPTED",

          orderId:
            result?.orderId ||
            result?.order?.id ||
            null,

          acceptedOfferId:
            null,

          checkoutDraft:
            null,
        })
      );

      setActiveFlow(
        QUOTE_FLOWS
          .USER_QUOTE_THREAD
      );

      addMessage(
        createMessage(
          "assistant",
          "Comanda a fost înregistrată cu succes în platformă, iar oferta a fost acceptată."
        )
      );

      return true;
    } catch (
      error
    ) {
      addMessage(
        createMessage(
          "assistant",
          error?.data
            ?.message ||
          error?.message ||
          "Comanda nu a putut fi înregistrată. Oferta nu a fost acceptată."
        )
      );

      return true;
    }
  }

  return true;
}
  /*
   * =====================================================
   * MESAJ VENDOR -> CLIENT
   * =====================================================
   */

  if (
    activeFlow ===
      QUOTE_FLOWS
        .VENDOR_QUOTE_THREAD &&
    quoteContext
      ?.quoteRequestId
  ) {
    try {
      await sendVendorQuoteMessage(
        quoteContext
          .quoteRequestId,
        value
      );

      clearUploadedImage?.();

      return true;
    } catch (
      error
    ) {
      addMessage(
        createMessage(
          "assistant",

          error?.data
            ?.message ||
            error?.message ||
            "Mesajul nu a putut fi trimis clientului."
        )
      );

      return true;
    }
  }

  /*
   * Dacă nu suntem în flow-ul
   * de creare cerere din produs,
   * acest handler nu procesează mesajul.
   */

    /*
   * =====================================================
   * VENDOR — CREARE OFERTĂ
   * =====================================================
   */

  if (
    activeFlow ===
      QUOTE_FLOWS
        .VENDOR_CREATE_OFFER &&
    quoteContext
      ?.quoteRequestId
  ) {
    const offerDraft =
      quoteContext
        ?.offerDraft ||
      {
        step:
          "unitPrice",
      };

    /*
     * PASUL 1 — PREȚ UNITAR
     */

    if (
      offerDraft.step ===
      "unitPrice"
    ) {
      const unitPrice =
        Number(
          String(
            value
          )
            .replace(
              ",",
              "."
            )
            .replace(
              /[^0-9.]/g,
              ""
            )
        );

      if (
        !Number.isFinite(
          unitPrice
        ) ||
        unitPrice < 0
      ) {
        addMessage(
          createMessage(
            "assistant",
            "Te rog să introduci un preț unitar valid. De exemplu: 25.50"
          )
        );

        return true;
      }

      setQuoteContext(
        (
          current
        ) => ({
          ...current,

          offerDraft: {
            ...current
              .offerDraft,

            unitPrice,

            step:
              "shippingPrice",
          },
        })
      );

      addMessage(
        createMessage(
          "assistant",
          "Care este costul transportului în RON? Scrie 0 dacă transportul este gratuit."
        )
      );

      return true;
    }

    /*
     * PASUL 2 — TRANSPORT
     */

    if (
      offerDraft.step ===
      "shippingPrice"
    ) {
      const shippingPrice =
        Number(
          String(
            value
          )
            .replace(
              ",",
              "."
            )
            .replace(
              /[^0-9.]/g,
              ""
            )
        );

      if (
        !Number.isFinite(
          shippingPrice
        ) ||
        shippingPrice < 0
      ) {
        addMessage(
          createMessage(
            "assistant",
            "Te rog să introduci un cost de transport valid. Scrie 0 dacă este gratuit."
          )
        );

        return true;
      }

      setQuoteContext(
        (
          current
        ) => ({
          ...current,

          offerDraft: {
            ...current
              .offerDraft,

            shippingPrice,

            step:
              "productionDays",
          },
        })
      );

      addMessage(
        createMessage(
          "assistant",
          "În câte zile estimezi că poți pregăti comanda?"
        )
      );

      return true;
    }

    /*
     * PASUL 3 — TERMEN PRODUCȚIE
     */

    if (
      offerDraft.step ===
      "productionDays"
    ) {
      const productionDays =
        Number.parseInt(
          value,
          10
        );

      if (
        !Number.isFinite(
          productionDays
        ) ||
        productionDays <= 0
      ) {
        addMessage(
          createMessage(
            "assistant",
            "Te rog să introduci numărul estimat de zile. De exemplu: 7"
          )
        );

        return true;
      }

      setQuoteContext(
        (
          current
        ) => ({
          ...current,

          offerDraft: {
            ...current
              .offerDraft,

            productionDays,

            step:
              "notes",
          },
        })
      );

      addMessage(
        createMessage(
          "assistant",
          "Poți adăuga observații pentru client. Dacă nu ai observații, scrie „fără”."
        )
      );

      return true;
    }

    /*
     * PASUL 4 — OBSERVAȚII + TRIMITERE
     */

    if (
      offerDraft.step ===
      "notes"
    ) {
      const normalizedValue =
        String(
          value ||
            ""
        ).trim();

      const notes =
        [
          "fara",
          "fără",
          "nu",
          "-",
        ].includes(
          normalizedValue
            .toLowerCase()
        )
          ? null
          : normalizedValue;

      try {
        const result =
          await createVendorQuoteOffer(
            quoteContext
              .quoteRequestId,
            {
              quantity:
                Number(
                  offerDraft
                    .quantity ||
                    quoteContext
                      .quantity
                ),

              unitPrice:
                Number(
                  offerDraft
                    .unitPrice
                ),

              shippingPrice:
                Number(
                  offerDraft
                    .shippingPrice ||
                    0
                ),

              currency:
                "RON",

              productionDays:
                Number(
                  offerDraft
                    .productionDays
                ),

              notes,
            }
          );

        setQuoteContext(
          (
            current
          ) => ({
            ...current,

            status:
              "OFFER_SENT",

            offerDraft:
              null,
          })
        );

        setActiveFlow(
          QUOTE_FLOWS
            .VENDOR_QUOTE_THREAD
        );

        addMessage(
          createMessage(
            "assistant",
            `Oferta a fost trimisă clientului cu succes.${
              result
                ?.offer
                ?.total
                ? `\n\nTotal ofertă: ${result.offer.total} ${result.offer.currency || "RON"}`
                : ""
            }`
          )
        );

        return true;
      } catch (
        error
      ) {
        addMessage(
          createMessage(
            "assistant",
            error?.data
              ?.message ||
              error?.message ||
              "Oferta nu a putut fi trimisă."
          )
        );

        return true;
      }
    }

    return true;
  }

 const isProductQuote =
  activeFlow ===
  "quote-from-product";

const isStoreQuote =
  activeFlow ===
  "quote-from-store";

if (
  !isProductQuote &&
  !isStoreQuote
) {
  return false;
}

  /*
   * =====================================================
   * VALIDARE CONTEXT PRODUS
   * =====================================================
   */
if (
  isProductQuote &&
  !quoteContext?.productId
) {
  addMessage(
    createMessage(
      "assistant",
      "Nu am putut identifica produsul pentru această cerere de ofertă."
    )
  );

  return true;
}

  const quoteFields =
    getQuoteFields(
      quoteContext
        .quoteSchema
    );

  /*
   * =====================================================
   * PASUL 1 — CANTITATE
   * =====================================================
   */

  if (
    quoteDraft
      ?.step ===
      "quantity" ||
    !quoteDraft
      ?.step
  ) {
    const quantityMatch =
      String(
        value || ""
      ).match(
        /\d+/
      );

    const quantity =
      quantityMatch
        ? Number(
            quantityMatch[
              0
            ]
          )
        : null;

    if (
      !Number.isFinite(
        quantity
      ) ||
      quantity <= 0
    ) {
      addMessage(
        createMessage(
          "assistant",

          "Te rog să-mi spui numărul de bucăți dorit. De exemplu: „30”."
        )
      );

      return true;
    }

    /*
     * Dacă există întrebări
     * configurate pentru produs.
     */

    if (
      quoteFields.length >
      0
    ) {
      const firstField =
        quoteFields[0];

      setQuoteDraft({
        step:
          "fields",

        quantity,

        currentFieldIndex:
          0,

        answers: {},
      });

      addMessage(
        createMessage(
          "assistant",

          `Perfect, am notat ${quantity} ${
            quantity === 1
              ? "bucată"
              : "bucăți"
          }.\n\n${getQuoteFieldQuestion(
            firstField
          )}`
        )
      );

      return true;
    }

    /*
     * Produsul nu are întrebări.
     * Creăm cererea direct.
     */

    try {
      const result =
        await createQuoteRequest({
          productId:
            quoteContext
              .productId,
vendorId:
    isStoreQuote
      ? quoteContext?.vendorId
      : null,
          quantity,

          requestData: {
            message:
              `Cerere de ofertă pentru ${quantity} ${
                quantity === 1
                  ? "bucată"
                  : "bucăți"
              }.`,

            quoteSchemaSnapshot:
              Array.isArray(
                quoteContext
                  .quoteSchema
              )
                ? quoteContext
                    .quoteSchema
                : [],
          },

          quoteSchemaAnswers:
            {},
        });

      const quoteRequestId =
        result
          ?.quoteRequestId ||
        result?.id;
const createdThreadId =
  result?.threadId ||
  null;

await sendInspirationImage(
  createdThreadId
);
      setQuoteContext(
  (current) => ({
    ...current,

    quoteRequestId,

    threadId:
      createdThreadId,
  })
);

      setQuoteDraft({
        step:
          "submitted",

        quantity,

        currentFieldIndex:
          0,

        answers: {},
      });

      setActiveFlow(
        QUOTE_FLOWS
          .USER_QUOTE_THREAD
      );

      addMessage(
        createMessage(
          "assistant",

          `Cererea ta pentru ${quantity} ${
            quantity === 1
              ? "bucată"
              : "bucăți"
          } a fost înregistrată și trimisă vânzătorului.\n\nDe acum puteți continua discuția aici. Când vânzătorul trimite oferta finală, o vei putea verifica și accepta direct în platformă.`
        )
      );

      clearUploadedImage?.();

      return true;
    } catch (
      error
    ) {
      addMessage(
        createMessage(
          "assistant",

          error?.data
            ?.message ||
            error?.message ||
            "Nu am putut trimite cererea de ofertă."
        )
      );

      return true;
    }
  }

  /*
   * =====================================================
   * PASUL 2 — ÎNTREBĂRILE CONFIGURATE
   * =====================================================
   */

  if (
    quoteDraft
      ?.step ===
    "fields"
  ) {
    const currentIndex =
      Number(
        quoteDraft
          .currentFieldIndex
      ) || 0;

    const currentField =
      quoteFields[
        currentIndex
      ];

    if (
      !currentField
    ) {
      addMessage(
        createMessage(
          "assistant",

          "Nu am putut identifica următoarea informație necesară. Te rog să reîncepi cererea."
        )
      );

      return true;
    }

    let answer =
      String(
        value || ""
      ).trim();

    const normalizedAnswer =
      answer
        .toLowerCase()
        .trim();

    const wantsToSkip =
      [
        "sari",
        "skip",
        "nu stiu",
        "nu știu",
        "nu",
        "-",
      ].includes(
        normalizedAnswer
      );

    /*
     * Câmp opțional.
     */

    if (
      wantsToSkip &&
      currentField
        .required ===
        true
    ) {
      addMessage(
        createMessage(
          "assistant",

          `„${currentField.label}” este un câmp obligatoriu. Te rog să completezi această informație.`
        )
      );

      return true;
    }

    /*
     * Validare NUMBER
     */

    if (
      !wantsToSkip &&
      currentField
        .type ===
        "number"
    ) {
      const numericValue =
        Number(
          answer.replace(
            ",",
            "."
          )
        );

      if (
        !Number.isFinite(
          numericValue
        )
      ) {
        addMessage(
          createMessage(
            "assistant",

            `Pentru „${currentField.label}” am nevoie de o valoare numerică.`
          )
        );

        return true;
      }

      answer =
        numericValue;
    }

    /*
     * Validare DATE
     */

    if (
      !wantsToSkip &&
      currentField
        .type ===
        "date"
    ) {
      const normalizedDate =
        normalizeQuoteDate(
          answer
        );

      if (
        !normalizedDate
      ) {
        addMessage(
          createMessage(
            "assistant",

            `Data pentru „${currentField.label}” nu este validă. Te rog să folosești formatul 15.08.2026.`
          )
        );

        return true;
      }

      answer =
        normalizedDate;
    }

    /*
     * Validare SELECT
     */

    if (
      !wantsToSkip &&
      currentField
        .type ===
        "select" &&
      Array.isArray(
        currentField
          .options
      ) &&
      currentField
        .options
        .length >
        0
    ) {
      const selectedOption =
        currentField
          .options
          .find(
            (
              option
            ) =>
              String(
                option
              )
                .trim()
                .toLowerCase() ===
              String(
                answer
              )
                .trim()
                .toLowerCase()
          );

      if (
        !selectedOption
      ) {
        addMessage(
          createMessage(
            "assistant",

            `Te rog să alegi una dintre variantele disponibile: ${currentField.options.join(
              ", "
            )}.`
          )
        );

        return true;
      }

      answer =
        selectedOption;
    }

    /*
     * Salvăm răspunsul.
     */

    const nextAnswers =
      {
        ...quoteDraft
          .answers,

        [currentField
          .key]:
          wantsToSkip
            ? null
            : answer,
      };

    const nextIndex =
      currentIndex +
      1;

    /*
     * Mai avem întrebări.
     */

    if (
      nextIndex <
      quoteFields.length
    ) {
      const nextField =
        quoteFields[
          nextIndex
        ];

      setQuoteDraft({
        ...quoteDraft,

        step:
          "fields",

        currentFieldIndex:
          nextIndex,

        answers:
          nextAnswers,
      });

      addMessage(
        createMessage(
          "assistant",

          getQuoteFieldQuestion(
            nextField
          )
        )
      );

      return true;
    }

    /*
     * =====================================================
     * TOATE RĂSPUNSURILE SUNT COMPLETE
     * =====================================================
     */

    try {
      const summaryLines =
        quoteFields
          .map(
            (
              field
            ) => {
              const fieldAnswer =
                nextAnswers[
                  field
                    .key
                ];

              if (
                fieldAnswer ===
                  undefined ||
                fieldAnswer ===
                  null ||
                fieldAnswer ===
                  ""
              ) {
                return null;
              }

              return `${field.label}: ${fieldAnswer}`;
            }
          )
          .filter(
            Boolean
          );

      const quantity =
        Number(
          quoteDraft
            .quantity
        );

      const requestMessage =
        [
          `Cantitate: ${quantity}`,
          ...summaryLines,
        ].join(
          "\n"
        );

      const result =
        await createQuoteRequest({
          productId:
            quoteContext
              .productId,
vendorId:
    isStoreQuote
      ? quoteContext?.vendorId
      : null,
          quantity,

          requestData: {
            message:
              requestMessage,

            quoteSchemaSnapshot:
              Array.isArray(
                quoteContext
                  .quoteSchema
              )
                ? quoteContext
                    .quoteSchema
                : [],
          },

          quoteSchemaAnswers:
            nextAnswers,
        });

      const quoteRequestId =
        result
          ?.quoteRequestId ||
        result?.id;
const createdThreadId =
  result?.threadId ||
  null;

await sendInspirationImage(
  createdThreadId
);
      setQuoteContext(
  (current) => ({
    ...current,

    quoteRequestId,

    threadId:
      createdThreadId,
  })
);
      setQuoteDraft({
        step:
          "submitted",

        quantity,

        currentFieldIndex:
          quoteFields
            .length,

        answers:
          nextAnswers,
      });

      setActiveFlow(
        QUOTE_FLOWS
          .USER_QUOTE_THREAD
      );

      addMessage(
        createMessage(
          "assistant",

          `Perfect. Cererea ta de ofertă pentru „${
            quoteContext
              .productTitle ||
            "produs"
          }” a fost înregistrată și trimisă vânzătorului.\n\nDe acum puteți continua conversația aici. Când vânzătorul trimite oferta finală, o vei putea verifica și accepta direct în platformă.`
        )
      );

      clearUploadedImage?.();

      return true;
    } catch (
      error
    ) {
      addMessage(
        createMessage(
          "assistant",

          error?.data
            ?.message ||
            error?.message ||
            "Nu am putut trimite cererea de ofertă."
        )
      );

      return true;
    }
  }

  return true;
}