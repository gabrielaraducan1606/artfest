// src/components/AiAssistant/quotes/assistantQuotes.js

import {
  normalizeForIntentDetection,
  isExplainIntentMessage,
} from "../explainIntent.js";

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
   Distincție semantică: cerere PUBLICĂ vs cerere DIRECTĂ la vendor

   BUGFIX (audit) - în Artfest există DOUĂ concepte diferite de
   "cerere de ofertă", pe care asistentul le confunda:

   1. CREATE_PUBLIC_REQUEST - o cerere publică (pagina /cereri,
      vizibilă și pe homepage), la care pot răspunde MAI MULȚI
      vânzători cu oferte. Endpoint real: POST /api/customer-
      requests. NU are (încă) un flow conversațional de CREARE în
      acest widget - doar pagina dedicată (buton real: "Publică o
      cerere") - ghidăm către ea, nu inventăm un flow nou.

   2. REQUEST_VENDOR_QUOTE - o cerere DIRECTĂ către UN vânzător
      anume (de obicei din pagina unui produs/magazin). Flow
      conversațional care EXISTĂ deja și funcționează (activeFlow
      "quote-from-product"/"quote-from-store", vezi mai jos în acest
      fișier + createQuoteRequest -> POST /api/assistant/quotes) -
      momentan pornit doar de un eveniment DOM dedicat
      ("artfest:quote-request", declanșat de un buton pe pagina de
      produs/magazin), nu și din text liber.

   Regulă GENERALĂ (nu fraze hardcodate) - distincția e semantică,
   pe formă: "public"/"mai mulți vânzători"/"caut vânzători" =
   PUBLIC; "acest(a)/de la [vânzător/magazin/produs]" sau "cer
   ofertă pentru [produs/magazin]" = DIRECT; orice altă formulare
   generică de "vreau o ofertă" fără niciun semnal clar = AMBIGUU,
   caz în care contextul paginii curente decide (vezi
   hasCurrentEntity) - dacă nu există context, întrebăm.
========================================================= */

const MY_QUOTES_RE =
  /\bcereril?e? mele\b|\bofertele mele\b|\bcereri(le)? trimise\b/;

const PUBLIC_REQUEST_RE =
  /\bpublic\w*.{0,15}\bcerer|\bmai mult\w*.{0,15}\bv[aâ]nz[aă]tor|\bcaut\w*.{0,15}\bv[aâ]nz[aă]tor/i;

const DIRECT_VENDOR_QUOTE_RE =
  /\bofert\w*.{0,20}\b(acest\w*|de la)\b|\bcer\w*.{0,15}\bofert\w*.{0,15}\b(produs\w*|magazin\w*|v[aâ]nz[aă]tor\w*)|\b[iî]ntreb\w*.{0,15}\bv[aâ]nz[aă]tor\w*.{0,15}\bc[aâ]t\s+cost/i;

const GENERIC_QUOTE_INTENT_RE =
  /\bcerer\w*.{0,10}\bofert|\bofert\w*.{0,10}\bpersonalizat|\bvreau\w*.{0,10}\bofert|\bcer\b.{0,10}\bpre[tț]\b/i;

export function detectQuoteRequestIntent(
  text = "",
  { hasCurrentEntity = false } = {}
) {
  const normalized = normalizeForIntentDetection(text);

  if (!normalized) return null;

  if (MY_QUOTES_RE.test(normalized)) {
    return { type: "my-quotes" };
  }

  /*
   * "Cum funcționează cererile de ofertă?" trebuie să rămână
   * PLATFORM_KNOWLEDGE (explică AMBELE flow-uri) - nu o cerere de
   * pornire a vreunui flow.
   */
  if (isExplainIntentMessage(normalized)) {
    return null;
  }

  if (PUBLIC_REQUEST_RE.test(normalized)) {
    return { type: "public-request" };
  }

  if (DIRECT_VENDOR_QUOTE_RE.test(normalized)) {
    return { type: "direct-vendor-quote" };
  }

  if (GENERIC_QUOTE_INTENT_RE.test(normalized)) {
    /*
     * Context contextual (audit, punctul 7): dacă userul e deja pe
     * pagina unui produs/magazin, o formulare generică ("vreau o
     * ofertă") înseamnă aproape sigur cerere DIRECTĂ pentru acea
     * entitate - nu mai întrebăm inutil.
     */
    return hasCurrentEntity
      ? { type: "direct-vendor-quote" }
      : { type: "quote-disambiguation" };
  }

  return null;
}

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

  if (
    from ===
    "ME"
  ) {
    return true;
  }

  if (
    isVendorThread
  ) {
    return (
      senderRole ===
      "VENDOR"
    );
  }

  return (
    senderRole ===
      "USER" ||
    senderRole ===
      "CUSTOMER"
  );
}

function getQuoteFieldQuestion(
  field
) {
  if (
    !field
  ) {
    return "";
  }

  const label =
    String(
      field.label || ""
    ).trim();

  const optionalText =
    field.required ===
    false
      ? "\n\nAcest câmp este opțional. Poți scrie „sari” dacă nu dorești să răspunzi."
      : "";

  if (
    !label
  ) {
    return (
      "Completează următoarea informație:" +
      optionalText
    );
  }

  if (
    field.type ===
      "select" &&
    Array.isArray(
      field.options
    ) &&
    field.options.length >
      0
  ) {
    return `${label}\n\nPoți alege: ${field.options.join(
      ", "
    )}.${optionalText}`;
  }

  if (
    field.type ===
    "date"
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

  if (
    !raw
  ) {
    return null;
  }

  /*
   * YYYY-MM-DD
   */
  const isoMatch =
    raw.match(
      /^(\d{4})-(\d{2})-(\d{2})$/
    );

  if (
    isoMatch
  ) {
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
        Number(
          year
        ) &&
      date.getMonth() +
        1 ===
        Number(
          month
        ) &&
      date.getDate() ===
        Number(
          day
        )
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
      Number(
        year
      ) ||
    date.getMonth() +
      1 !==
      Number(
        month
      ) ||
    date.getDate() !==
      Number(
        day
      )
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

  if (
    !content
  ) {
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

  if (
    !content
  ) {
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

  if (
    !id
  ) {
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
      quantity >
        0
        ? `${quantity} ${
            quantity ===
            1
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

  if (
    !id
  ) {
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
      quantity >
        0
        ? `${quantity} ${
            quantity ===
            1
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
        QUOTE_FLOWS
          .MY_QUOTES
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
      QUOTE_FLOWS
        .MY_QUOTES
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
        QUOTE_FLOWS
          .VENDOR_QUOTES
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
      QUOTE_FLOWS
        .VENDOR_QUOTES
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
          quantity >
            0
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
          return;
        }

        const offerId =
          offer?.id ||
          null;

        if (
          !offerId
        ) {
          return;
        }

        const offerMessage =
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

              offerId,

              offer,
            }
          );

        offerMessage.id =
          `quote-offer-${offerId}`;

        addMessage(
          offerMessage
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
            items: [],
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
          quantity >
            0
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
========================================================= */

export async function refreshQuoteThread({
  activeFlow,
  quoteId,
  currentMessages,
  addMessage,
  createMessage,
}) {
  if (
    !quoteId
  ) {
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

      if (
        !serverId
      ) {
        continue;
      }

      if (
        isOwnQuoteMessage({
          message:
            serverMessage,

          isVendorThread,
        })
      ) {
        existingMessageIds.add(
          String(
            serverId
          )
        );

        continue;
      }

      if (
        existingMessageIds.has(
          String(
            serverId
          )
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

      if (
        !uiMessage
      ) {
        continue;
      }

      addMessage(
        uiMessage
      );

      existingMessageIds.add(
        String(
          serverId
        )
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

        if (
          !offerId
        ) {
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

        const offerMessage =
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
          );

        offerMessage.id =
          `quote-offer-${offerId}`;

        addMessage(
          offerMessage
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

  if (
    choice.action ===
    "accept-quote-offer"
  ) {
    const quoteId =
      choice.quoteId ||
      choice?.offer
        ?.quoteRequestId ||
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

        checkoutDraft:
          null,
      })
    );

    setActiveFlow(
      QUOTE_FLOWS
        .USER_ACCEPT_OFFER
    );

    addMessage(
      createMessage(
        "assistant",
        "Cum dorești să continui cu această comandă?",
        {
          type:
            "choices",

          choiceStep:
            "quote-accept-method",

          choices: [
            {
              id:
                "continue-in-assistant",

              action:
                "continue-quote-checkout-assistant",

              title:
                "Continuă în asistent",

              description:
                "Completezi aici datele necesare pentru înregistrarea comenzii.",

              quoteId,
              offerId,
            },

            {
              id:
                "continue-in-checkout",

              action:
                "continue-quote-checkout-page",

              title:
                "Completează în checkout",

              description:
                "Deschizi formularul complet și completezi manual datele comenzii.",

              quoteId,
              offerId,
            },
          ],
        }
      )
    );

    return true;
  }

  /*
   * ============================================
   * CLIENT — continuă în asistent
   * ============================================
   */

  if (
    choice.action ===
    "continue-quote-checkout-assistant"
  ) {
    const quoteId =
      choice.quoteId ||
      null;

    const offerId =
      choice.offerId ||
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
          quoteId,
          offerId,

          step:
            "customerType",

          customerType:
            "",

          paymentMethod:
            "",

          recipientName:
            "",

          email:
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

          companyName:
            "",

          companyCui:
            "",

          companyRegCom:
            "",

          companyCounty:
            "",

          companyCity:
            "",

          companyStreet:
            "",

          companyPostalCode:
            "",

          contactName:
            "",

          contactEmail:
            "",

          contactPhone:
            "",

          shipToDifferentAddress:
            false,
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
        "Perfect. Pentru început, comanda este pentru o persoană fizică sau pentru o firmă?",
        {
          type:
            "choices",

          choiceStep:
            "quote-customer-type",

          choices: [
            {
              id:
                "quote-customer-pf",

              action:
                "quote-customer-pf",

              title:
                "Persoană fizică",

              description:
                "Comanda va fi înregistrată pe persoană fizică.",

              quoteId,
              offerId,
            },

            {
              id:
                "quote-customer-pj",

              action:
                "quote-customer-pj",

              title:
                "Persoană juridică",

              description:
                "Comanda va conține datele firmei.",

              quoteId,
              offerId,
            },
          ],
        }
      )
    );

    return true;
  }

  /*
   * ============================================
   * CLIENT — tip client PF
   * ============================================
   */

  if (
    choice.action ===
    "quote-customer-pf"
  ) {
    setQuoteContext(
      (
        current
      ) => ({
        ...current,

        checkoutDraft: {
          ...current.checkoutDraft,

          customerType:
            "PF",

          shipToDifferentAddress:
            false,

          step:
            "recipientName",
        },
      })
    );

    addMessage(
      createMessage(
        "assistant",
        "Perfect. Care este numele complet al persoanei care va primi coletul?"
      )
    );

    return true;
  }

  /*
   * ============================================
   * CLIENT — tip client PJ
   * ============================================
   */

  if (
    choice.action ===
    "quote-customer-pj"
  ) {
    setQuoteContext(
      (
        current
      ) => ({
        ...current,

        checkoutDraft: {
          ...current.checkoutDraft,

          customerType:
            "PJ",

          step:
            "companyName",
        },
      })
    );

    addMessage(
      createMessage(
        "assistant",
        "Perfect. Care este denumirea firmei?"
      )
    );

    return true;
  }

  /*
   * ============================================
   * CLIENT PJ — livrare la sediul firmei
   * ============================================
   */

  if (
    choice.action ===
    "quote-company-shipping-same"
  ) {
    const draft =
      choice.checkoutDraft ||
      {};

    const nextDraft = {
      ...draft,

      shipToDifferentAddress:
        false,

      recipientName:
        draft.contactName ||
        "",

      email:
        draft.contactEmail ||
        "",

      phone:
        draft.contactPhone ||
        "",

      addressLine1:
        draft.companyStreet ||
        "",

      city:
        draft.companyCity ||
        "",

      county:
        draft.companyCounty ||
        "",

      postalCode:
        draft.companyPostalCode ||
        "",

      step:
        "paymentMethod",
    };

    setQuoteContext(
      (
        current
      ) => ({
        ...current,

        checkoutDraft:
          nextDraft,
      })
    );

    addMessage(
      createMessage(
        "assistant",
        "Cum dorești să achiți comanda?",
        {
          type:
            "choices",

          choiceStep:
            "quote-payment-method",

          choices: [
            {
              id:
                "quote-payment-cod",

              action:
                "quote-payment-cod",

              title:
                "Ramburs",

              description:
                "Plătești la livrare.",

              checkoutDraft:
                nextDraft,
            },

            {
              id:
                "quote-payment-card",

              action:
                "quote-payment-card",

              title:
                "Card online",

              description:
                "Vei fi redirecționat către plata securizată.",

              checkoutDraft:
                nextDraft,
            },
          ],
        }
      )
    );

    return true;
  }

  /*
   * ============================================
   * CLIENT PJ — livrare la altă adresă
   * ============================================
   */

  if (
    choice.action ===
    "quote-company-shipping-different"
  ) {
    const draft =
      choice.checkoutDraft ||
      {};

    setQuoteContext(
      (
        current
      ) => ({
        ...current,

        checkoutDraft: {
          ...draft,

          shipToDifferentAddress:
            true,

          recipientName:
            "",

          email:
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

          step:
            "recipientName",
        },
      })
    );

    addMessage(
      createMessage(
        "assistant",
        "Sigur. Care este numele complet al persoanei care va primi coletul?"
      )
    );

    return true;
  }

  /*
   * ============================================
   * CLIENT — metodă plată
   * ============================================
   */

  if (
    choice.action ===
      "quote-payment-cod" ||
    choice.action ===
      "quote-payment-card"
  ) {
    const paymentMethod =
      choice.action ===
      "quote-payment-card"
        ? "CARD"
        : "COD";

    const draft = {
      ...(
        choice.checkoutDraft ||
        {}
      ),

      paymentMethod,

      step:
        "confirmOrder",
    };

    setQuoteContext(
      (
        current
      ) => ({
        ...current,

        checkoutDraft:
          draft,
      })
    );

    const customerLabel =
      draft.customerType ===
      "PJ"
        ? "Persoană juridică"
        : "Persoană fizică";

    const paymentLabel =
      paymentMethod ===
      "CARD"
        ? "Card online"
        : "Ramburs";

    const summaryLines = [
      "Verifică datele înainte să înregistrez comanda:",
      "",

      `Tip client: ${customerLabel}`,

      draft.customerType ===
      "PJ"
        ? `Firmă: ${draft.companyName || "-"}`
        : `Destinatar: ${draft.recipientName || "-"}`,

      draft.customerType ===
      "PJ"
        ? `CUI: ${draft.companyCui || "-"}`
        : null,

      draft.customerType ===
      "PJ"
        ? `Persoană de contact: ${draft.contactName || "-"}`
        : null,

      `Livrare: ${[
        draft.addressLine1,
        draft.city,
        draft.county,
      ]
        .filter(
          Boolean
        )
        .join(
          ", "
        )}`,

      `Plată: ${paymentLabel}`,
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
      );

    addMessage(
      createMessage(
        "assistant",
        summaryLines,
        {
          type:
            "choices",

          choiceStep:
            "quote-order-confirm",

          choices: [
            {
              id:
                "quote-confirm-order",

              action:
                "quote-confirm-order",

              title:
                "Confirmă comanda",

              description:
                "Înregistrează comanda cu aceste date.",

              checkoutDraft:
                draft,
            },

            {
              id:
                "quote-restart-order",

              action:
                "quote-restart-order",

              title:
                "Modifică datele",

              description:
                "Reiau completarea datelor comenzii.",
            },
          ],
        }
      )
    );

    return true;
  }

  /*
   * ============================================
   * CLIENT — reia datele
   * ============================================
   */

  if (
    choice.action ===
    "quote-restart-order"
  ) {
    setQuoteContext(
      (
        current
      ) => ({
        ...current,

        checkoutDraft: {
          quoteId:
            current.quoteRequestId ||
            null,

          offerId:
            current.acceptedOfferId ||
            null,

          step:
            "customerType",

          customerType:
            "",

          paymentMethod:
            "",

          recipientName:
            "",

          email:
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

          companyName:
            "",

          companyCui:
            "",

          companyRegCom:
            "",

          companyCounty:
            "",

          companyCity:
            "",

          companyStreet:
            "",

          companyPostalCode:
            "",

          contactName:
            "",

          contactEmail:
            "",

          contactPhone:
            "",

          shipToDifferentAddress:
            false,
        },
      })
    );

    addMessage(
      createMessage(
        "assistant",
        "Sigur. Comanda este pentru o persoană fizică sau pentru o firmă?",
        {
          type:
            "choices",

          choices: [
            {
              id:
                "quote-customer-pf-restart",

              action:
                "quote-customer-pf",

              title:
                "Persoană fizică",
            },

            {
              id:
                "quote-customer-pj-restart",

              action:
                "quote-customer-pj",

              title:
                "Persoană juridică",
            },
          ],
        }
      )
    );

    return true;
  }

  /*
   * ============================================
   * CLIENT — confirmă și creează comanda
   * ============================================
   */

  if (
    choice.action ===
    "quote-confirm-order"
  ) {
    const draft =
      choice.checkoutDraft ||
      {};

    const customerType =
      draft.customerType ===
      "PJ"
        ? "PJ"
        : "PF";

    const paymentMethod =
      draft.paymentMethod ===
      "CARD"
        ? "CARD"
        : "COD";

    const shippingAddress = {
      recipientName:
        draft.recipientName ||
        draft.contactName ||
        "",

      name:
        draft.recipientName ||
        draft.contactName ||
        "",

      email:
        draft.email ||
        draft.contactEmail ||
        "",

      phone:
        draft.phone ||
        draft.contactPhone ||
        "",

      addressLine1:
        draft.addressLine1 ||
        "",

      street:
        draft.addressLine1 ||
        "",

      city:
        draft.city ||
        "",

      county:
        draft.county ||
        "",

      postalCode:
        draft.postalCode ||
        "",
    };

    const billingAddress =
      customerType ===
      "PJ"
        ? {
            companyName:
              draft.companyName ||
              "",

            companyCui:
              draft.companyCui ||
              "",

            companyRegCom:
              draft.companyRegCom ||
              "",

            county:
              draft.companyCounty ||
              "",

            city:
              draft.companyCity ||
              "",

            street:
              draft.companyStreet ||
              "",

            postalCode:
              draft.companyPostalCode ||
              "",
          }
        : null;

    const contactPerson =
      customerType ===
      "PJ"
        ? {
            name:
              draft.contactName ||
              "",

            email:
              draft.contactEmail ||
              "",

            phone:
              draft.contactPhone ||
              "",
          }
        : null;
addMessage({
  id:
    `${Date.now()}-quote-order-creating`,

  role:
    "assistant",

  type:
    "loading",

  content:
    paymentMethod ===
    "CARD"
      ? "Creez comanda și pregătesc plata securizată..."
      : "Creez comanda și verific datele...",
});
    try {
      const result =
        await acceptQuoteOffer(
          draft.quoteId ||
            null,

          draft.offerId ||
            null,

          {
            shippingAddress,
            billingAddress,
            contactPerson,
            customerType,
            paymentMethod,

            shipToDifferentAddress:
              customerType ===
              "PJ"
                ? Boolean(
                    draft.shipToDifferentAddress
                  )
                : false,
          }
        );

      if (
        paymentMethod ===
          "CARD" &&
        result?.payment
          ?.redirectUrl
      ) {
        window.location.href =
          result.payment
            .redirectUrl;

        return true;
      }

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

  /*
   * ============================================
   * CLIENT — continuă în checkout
   * ============================================
   */

  if (
    choice.action ===
    "continue-quote-checkout-page"
  ) {
    const quoteId =
      choice.quoteId ||
      null;

    const offerId =
      choice.offerId ||
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

    window.location.href =
      `/checkout?quoteId=${encodeURIComponent(
        quoteId
      )}&offerId=${encodeURIComponent(
        offerId
      )}`;

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
      choice?.offer
        ?.quoteRequestId ||
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
   * CLIENT — solicită ofertă nouă
   * ============================================
   */

  if (
    choice.action ===
    "request-new-quote-offer"
  ) {
    const quoteId =
      choice.quoteId ||
      choice?.offer
        ?.quoteRequestId ||
      null;

    if (
      !quoteId
    ) {
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
      choice?.offer
        ?.quoteRequestId ||
      null;

    if (
      !quoteId
    ) {
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

  /*
   * ============================================
   * VENDOR — începe flow ofertă
   * ============================================
   */

  if (
    choice.action ===
    "start-quote-offer"
  ) {
    const quoteId =
      choice.quoteId ||
      choice.id ||
      choice?.quote?.id ||
      null;

    if (
      !quoteId
    ) {
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

        ...(
          choice.quote ||
          {}
        ),

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

  if (
    !quoteId
  ) {
    return false;
  }

  if (
    activeFlow ===
    QUOTE_FLOWS
      .MY_QUOTES
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
    QUOTE_FLOWS
      .VENDOR_QUOTES
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
    } catch (
      error
    ) {
      addMessage(
        createMessage(
          "assistant",
          error?.data
            ?.message ||
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
   * CLIENT — DATE COMANDĂ PENTRU ACCEPTAREA OFERTEI
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
        quoteId:
          quoteContext
            ?.quoteRequestId ||
          null,

        offerId:
          quoteContext
            ?.acceptedOfferId ||
          null,

        step:
          "customerType",
      };

    const normalizedValue =
      String(
        value || ""
      ).trim();

    if (
      !normalizedValue
    ) {
      addMessage(
        createMessage(
          "assistant",
          "Te rog să completezi informația solicitată."
        )
      );

      return true;
    }

    /*
     * ============================================
     * PJ — DENUMIRE FIRMĂ
     * ============================================
     */

    if (
      checkoutDraft.step ===
      "companyName"
    ) {
      setQuoteContext(
        (
          current
        ) => ({
          ...current,

          checkoutDraft: {
            ...current.checkoutDraft,

            companyName:
              normalizedValue,

            step:
              "companyCui",
          },
        })
      );

      addMessage(
        createMessage(
          "assistant",
          "Care este CUI-ul firmei?"
        )
      );

      return true;
    }

    /*
     * ============================================
     * PJ — CUI
     * ============================================
     */

    if (
      checkoutDraft.step ===
      "companyCui"
    ) {
      const companyCui =
        normalizedValue
          .toUpperCase()
          .replace(
            /\s+/g,
            ""
          );

      setQuoteContext(
        (
          current
        ) => ({
          ...current,

          checkoutDraft: {
            ...current.checkoutDraft,

            companyCui,

            step:
              "companyRegCom",
          },
        })
      );

      addMessage(
        createMessage(
          "assistant",
          "Care este numărul de la Registrul Comerțului? Dacă nu vrei să îl completezi acum, scrie „sari”."
        )
      );

      return true;
    }

    /*
     * ============================================
     * PJ — REGISTRUL COMERȚULUI
     * ============================================
     */

    if (
      checkoutDraft.step ===
      "companyRegCom"
    ) {
      const companyRegCom =
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

      setQuoteContext(
        (
          current
        ) => ({
          ...current,

          checkoutDraft: {
            ...current.checkoutDraft,

            companyRegCom,

            step:
              "companyCounty",
          },
        })
      );

      addMessage(
        createMessage(
          "assistant",
          "În ce județ este sediul firmei?"
        )
      );

      return true;
    }

    /*
     * ============================================
     * PJ — JUDEȚ FIRMĂ
     * ============================================
     */

    if (
      checkoutDraft.step ===
      "companyCounty"
    ) {
      setQuoteContext(
        (
          current
        ) => ({
          ...current,

          checkoutDraft: {
            ...current.checkoutDraft,

            companyCounty:
              normalizedValue,

            step:
              "companyCity",
          },
        })
      );

      addMessage(
        createMessage(
          "assistant",
          "În ce localitate este sediul firmei?"
        )
      );

      return true;
    }

    /*
     * ============================================
     * PJ — LOCALITATE FIRMĂ
     * ============================================
     */

    if (
      checkoutDraft.step ===
      "companyCity"
    ) {
      setQuoteContext(
        (
          current
        ) => ({
          ...current,

          checkoutDraft: {
            ...current.checkoutDraft,

            companyCity:
              normalizedValue,

            step:
              "companyStreet",
          },
        })
      );

      addMessage(
        createMessage(
          "assistant",
          "Care este adresa sediului firmei? Include strada și numărul."
        )
      );

      return true;
    }

    /*
     * ============================================
     * PJ — STRADĂ FIRMĂ
     * ============================================
     */

    if (
      checkoutDraft.step ===
      "companyStreet"
    ) {
      setQuoteContext(
        (
          current
        ) => ({
          ...current,

          checkoutDraft: {
            ...current.checkoutDraft,

            companyStreet:
              normalizedValue,

            step:
              "companyPostalCode",
          },
        })
      );

      addMessage(
        createMessage(
          "assistant",
          "Care este codul poștal al sediului? Dacă nu îl cunoști, scrie „sari”."
        )
      );

      return true;
    }

    /*
     * ============================================
     * PJ — COD POȘTAL FIRMĂ
     * ============================================
     */

    if (
      checkoutDraft.step ===
      "companyPostalCode"
    ) {
      const companyPostalCode =
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

      setQuoteContext(
        (
          current
        ) => ({
          ...current,

          checkoutDraft: {
            ...current.checkoutDraft,

            companyPostalCode,

            step:
              "contactName",
          },
        })
      );

      addMessage(
        createMessage(
          "assistant",
          "Care este numele complet al persoanei de contact?"
        )
      );

      return true;
    }

    /*
     * ============================================
     * PJ — PERSOANĂ CONTACT
     * ============================================
     */

    if (
      checkoutDraft.step ===
      "contactName"
    ) {
      setQuoteContext(
        (
          current
        ) => ({
          ...current,

          checkoutDraft: {
            ...current.checkoutDraft,

            contactName:
              normalizedValue,

            step:
              "contactEmail",
          },
        })
      );

      addMessage(
        createMessage(
          "assistant",
          "Care este adresa de email a persoanei de contact?"
        )
      );

      return true;
    }

    /*
     * ============================================
     * PJ — EMAIL CONTACT
     * ============================================
     */

    if (
      checkoutDraft.step ===
      "contactEmail"
    ) {
      if (
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
          normalizedValue
        )
      ) {
        addMessage(
          createMessage(
            "assistant",
            "Adresa de email nu pare validă. Te rog să o introduci din nou."
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

            contactEmail:
              normalizedValue,

            step:
              "contactPhone",
          },
        })
      );

      addMessage(
        createMessage(
          "assistant",
          "Care este numărul de telefon al persoanei de contact?"
        )
      );

      return true;
    }

    /*
     * ============================================
     * PJ — TELEFON CONTACT
     * ============================================
     */

    if (
      checkoutDraft.step ===
      "contactPhone"
    ) {
      const contactPhone =
        normalizedValue.replace(
          /[^\d+]/g,
          ""
        );

      if (
        contactPhone.length <
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

      const nextDraft = {
        ...checkoutDraft,

        contactPhone,

        step:
          "companyShippingChoice",
      };

      setQuoteContext(
        (
          current
        ) => ({
          ...current,

          checkoutDraft:
            nextDraft,
        })
      );

      addMessage(
        createMessage(
          "assistant",
          "Livrarea se face la sediul firmei?",
          {
            type:
              "choices",

            choiceStep:
              "quote-company-shipping",

            choices: [
              {
                id:
                  "quote-company-shipping-same",

                action:
                  "quote-company-shipping-same",

                title:
                  "Da, la sediul firmei",

                checkoutDraft:
                  nextDraft,
              },

              {
                id:
                  "quote-company-shipping-different",

                action:
                  "quote-company-shipping-different",

                title:
                  "Nu, la altă adresă",

                checkoutDraft:
                  nextDraft,
              },
            ],
          }
        )
      );

      return true;
    }

    /*
     * ============================================
     * NUME DESTINATAR
     * ============================================
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
          "Care este numărul de telefon pentru livrare?"
        )
      );

      return true;
    }

    /*
     * ============================================
     * TELEFON LIVRARE
     * ============================================
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
              "email",
          },
        })
      );

      addMessage(
        createMessage(
          "assistant",
          "Care este adresa de email?"
        )
      );

      return true;
    }

    /*
     * ============================================
     * EMAIL LIVRARE
     * ============================================
     */

    if (
      checkoutDraft.step ===
      "email"
    ) {
      if (
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
          normalizedValue
        )
      ) {
        addMessage(
          createMessage(
            "assistant",
            "Adresa de email nu pare validă. Te rog să o introduci din nou."
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

            email:
              normalizedValue,

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
     * ============================================
     * ADRESĂ
     * ============================================
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
     * ============================================
     * LOCALITATE
     * ============================================
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
     * ============================================
     * JUDEȚ
     * ============================================
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
     * ============================================
     * COD POȘTAL
     * ============================================
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

      const nextDraft = {
        ...checkoutDraft,

        postalCode,

        step:
          "paymentMethod",
      };

      setQuoteContext(
        (
          current
        ) => ({
          ...current,

          checkoutDraft:
            nextDraft,
        })
      );

      addMessage(
        createMessage(
          "assistant",
          "Cum dorești să achiți comanda?",
          {
            type:
              "choices",

            choiceStep:
              "quote-payment-method",

            choices: [
              {
                id:
                  "quote-payment-cod",

                action:
                  "quote-payment-cod",

                title:
                  "Ramburs",

                description:
                  "Plătești la livrare.",

                checkoutDraft:
                  nextDraft,
              },

              {
                id:
                  "quote-payment-card",

                action:
                  "quote-payment-card",

                title:
                  "Card online",

                description:
                  "Vei fi redirecționat către plata securizată.",

                checkoutDraft:
                  nextDraft,
              },
            ],
          }
        )
      );

      return true;
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
        unitPrice <
          0
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
        shippingPrice <
          0
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
        productionDays <=
          0
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
              result?.offer
                ?.total
                ? `\n\nTotal ofertă: ${result.offer.total} ${
                    result.offer.currency ||
                    "RON"
                  }`
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
    !quoteContext
      ?.productId
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
      quantity <=
        0
    ) {
      addMessage(
        createMessage(
          "assistant",
          "Te rog să-mi spui numărul de bucăți dorit. De exemplu: „30”."
        )
      );

      return true;
    }

    if (
      quoteFields.length >
      0
    ) {
      const firstField =
        quoteFields[
          0
        ];

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
            quantity ===
            1
              ? "bucată"
              : "bucăți"
          }.\n\n${getQuoteFieldQuestion(
            firstField
          )}`
        )
      );

      return true;
    }

    try {
      const result =
        await createQuoteRequest({
          productId:
            quoteContext
              .productId,

          vendorId:
            isStoreQuote
              ? quoteContext
                  ?.vendorId
              : null,

          quantity,

          requestData: {
            message:
              `Cerere de ofertă pentru ${quantity} ${
                quantity ===
                1
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
        (
          current
        ) => ({
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
            quantity ===
            1
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
      ) ||
      0;

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

    const nextAnswers = {
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
              ? quoteContext
                  ?.vendorId
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
        (
          current
        ) => ({
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