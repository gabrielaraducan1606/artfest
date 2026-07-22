// src/components/AiAssistant/support/supportApi.js

const SUPPORT_API =
  "/api/assistant/support";

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

function requireTicketId(
  ticketId
) {
  const normalizedId =
    normalizeText(
      String(
        ticketId || ""
      )
    );

  if (!normalizedId) {
    throw new Error(
      "Conversația nu a putut fi identificată."
    );
  }

  return normalizedId;
}

function toSafeNumber(
  value,
  fallback = 0
) {
  const parsed =
    Number(value);

  return Number.isFinite(
    parsed
  )
    ? parsed
    : fallback;
}

function normalizeAttachments(
  attachments
) {
  if (
    !Array.isArray(
      attachments
    )
  ) {
    return [];
  }

  return attachments
    .filter(
      (attachment) =>
        attachment &&
        typeof attachment ===
          "object" &&
        normalizeText(
          attachment.url
        )
    )
    .map(
      (
        attachment
      ) => ({
        url:
          normalizeText(
            attachment.url
          ),

        name:
          normalizeText(
            attachment.name
          ) ||
          normalizeText(
            attachment.filename
          ) ||
          undefined,

        filename:
          normalizeText(
            attachment.filename
          ) ||
          normalizeText(
            attachment.name
          ) ||
          undefined,

        mimeType:
          normalizeText(
            attachment.mimeType
          ) ||
          normalizeText(
            attachment.mime
          ) ||
          undefined,

        mime:
          normalizeText(
            attachment.mime
          ) ||
          normalizeText(
            attachment.mimeType
          ) ||
          undefined,

        size:
          Number.isFinite(
            Number(
              attachment.size
            )
          )
            ? Number(
                attachment.size
              )
            : undefined,
      })
    );
}

/* =========================================================
   Erori API
========================================================= */

function getErrorMessage(
  response,
  data
) {
  if (
    response.status ===
    400
  ) {
    return (
      data?.message ||
      "Datele trimise nu sunt valide."
    );
  }

  if (
    response.status ===
    401
  ) {
    return (
      data?.message ||
      "Pentru a folosi suportul, autentifică-te sau creează un cont."
    );
  }

  if (
    response.status ===
    403
  ) {
    return (
      data?.message ||
      "Nu ai permisiunea să accesezi această conversație."
    );
  }

  if (
    response.status ===
    404
  ) {
    return (
      data?.message ||
      "Conversația solicitată nu mai este disponibilă."
    );
  }

  if (
    response.status ===
    409
  ) {
    return (
      data?.message ||
      "Această conversație nu mai poate fi actualizată."
    );
  }

  if (
    response.status ===
    413
  ) {
    return (
      data?.message ||
      "Fișierele trimise sunt prea mari."
    );
  }

  if (
    response.status ===
    429
  ) {
    return (
      data?.message ||
      "Ai trimis prea multe solicitări. Încearcă din nou puțin mai târziu."
    );
  }

  if (
    response.status >=
    500
  ) {
    return (
      data?.message ||
      "Serviciul de suport nu este disponibil momentan."
    );
  }

  return (
    data?.message ||
    data?.error ||
    "Solicitarea nu a putut fi procesată."
  );
}

/* =========================================================
   Request helper
========================================================= */

async function requestJson(
  path,
  options = {}
) {
  const {
    headers:
      customHeaders = {},
    body,
    ...requestOptions
  } = options;

  let response;

  try {
    response =
      await fetch(
        `${SUPPORT_API}${path}`,
        {
          credentials:
            "include",

          ...requestOptions,

          body,

          headers: {
            Accept:
              "application/json",

            /*
             * Adăugăm Content-Type doar pentru body JSON.
             * Nu îl setăm automat pentru FormData.
             */
            ...(body &&
            typeof body ===
              "string"
              ? {
                  "Content-Type":
                    "application/json",
                }
              : {}),

            ...customHeaders,
          },
        }
      );
  } catch (
    error
  ) {
    console.error(
      "Support API network error:",
      error
    );

    throw new Error(
      "Nu s-a putut realiza conexiunea cu serviciul de suport."
    );
  }

  /*
   * Unele rute pot întoarce 204 No Content.
   */
  if (
    response.status ===
    204
  ) {
    return null;
  }

  const contentType =
    response.headers.get(
      "content-type"
    ) || "";

  let data = null;

  if (
    contentType.includes(
      "application/json"
    )
  ) {
    data =
      await response
        .json()
        .catch(
          () => null
        );
  } else {
    const text =
      await response
        .text()
        .catch(
          () => ""
        );

    data =
      text
        ? {
            message:
              text,
          }
        : null;
  }

  if (!response.ok) {
  const error = new Error(
    getErrorMessage(
      response,
      data
    )
  );

  error.code =
    data?.error ||
    null;

  error.details =
    data?.details ||
    null;

  error.requiresGuestDetails =
    Boolean(
      data?.requiresGuestDetails
    );

  error.status =
    response.status;

  throw error;
}

  return data;
}

/* =========================================================
   Normalizare status
========================================================= */

function normalizeStatus(
  status
) {
  const value =
    normalizeText(
      String(
        status || ""
      )
    ).toLowerCase();

  switch (
    value
  ) {
    case "open":
      return {
        value:
          "open",

        label:
          "Deschis",
      };

    case "pending":
      return {
        value:
          "pending",

        label:
          "În așteptare",
      };

    case "closed":
      return {
        value:
          "closed",

        label:
          "Închis",
      };

    default:
      return {
        value:
          "open",

        label:
          "Deschis",
      };
  }
}

/* =========================================================
   Normalizare prioritate
========================================================= */

function normalizePriority(
  priority
) {
  const value =
    normalizeText(
      String(
        priority || ""
      )
    ).toLowerCase();

  switch (
    value
  ) {
    case "high":
      return {
        value:
          "high",

        label:
          "Prioritate ridicată",
      };

    case "low":
      return {
        value:
          "low",

        label:
          "Prioritate redusă",
      };

    case "medium":
    default:
      return {
        value:
          "medium",

        label:
          "Prioritate normală",
      };
  }
}

/* =========================================================
   Normalizare tichet
========================================================= */

export function normalizeTicket(
  ticket
) {
  if (
    !ticket ||
    typeof ticket !==
      "object"
  ) {
    return null;
  }

  const status =
    normalizeStatus(
      ticket.status
    );

  const priority =
    normalizePriority(
      ticket.priority
    );

  return {
    id:
      String(
        ticket.id || ""
      ),

    subject:
      normalizeText(
        ticket.subject
      ) ||
      "Solicitare de suport",

    category:
      normalizeText(
        ticket.category
      ) ||
      "general",

    status:
      status.value,

    statusLabel:
      status.label,

    priority:
      priority.value,

    priorityLabel:
      priority.label,

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

/* =========================================================
   Normalizare atașament
========================================================= */

export function normalizeSupportAttachment(
  attachment
) {
  if (
    !attachment ||
    typeof attachment !==
      "object"
  ) {
    return null;
  }

  return {
    url:
      normalizeText(
        attachment.url
      ),

    name:
      normalizeText(
        attachment.name
      ) ||
      normalizeText(
        attachment.filename
      ) ||
      null,

    filename:
      normalizeText(
        attachment.filename
      ) ||
      normalizeText(
        attachment.name
      ) ||
      null,

    mimeType:
      normalizeText(
        attachment.mimeType
      ) ||
      normalizeText(
        attachment.mime
      ) ||
      null,

    mime:
      normalizeText(
        attachment.mime
      ) ||
      normalizeText(
        attachment.mimeType
      ) ||
      null,

    size:
      Number.isFinite(
        Number(
          attachment.size
        )
      )
        ? Number(
            attachment.size
          )
        : null,
  };
}

/* =========================================================
   Normalizare mesaj
========================================================= */

export function normalizeSupportMessage(
  message
) {
  if (
    !message ||
    typeof message !==
      "object"
  ) {
    return null;
  }

  const from =
    message.from ===
    "me"
      ? "me"
      : "them";

  const source =
    normalizeText(
      message.senderType
    ) ||
    (from === "me"
      ? "user"
      : message.system
      ? "system"
      : "support");

  return {
    id:
      String(
        message.id || ""
      ),

    ticketId:
      String(
        message.ticketId ||
          ""
      ),

    role:
      from === "me"
        ? "user"
        : "assistant",

    from,

    source,

    senderType:
      source,

    system:
      Boolean(
        message.system
      ),

    /*
     * Păstrăm ambele câmpuri.
     * Unele componente pot folosi content,
     * iar altele body.
     */
    content:
      message.body ||
      message.content ||
      "",

    body:
      message.body ||
      message.content ||
      "",

    createdAt:
      message.createdAt ||
      null,

    attachments:
      Array.isArray(
        message.attachments
      )
        ? message.attachments
            .map(
              normalizeSupportAttachment
            )
            .filter(
              Boolean
            )
        : [],
  };
}

/* =========================================================
   Listare tichete
========================================================= */

export async function fetchSupportTickets({
  status = "all",
  query = "",
  offset = 0,
  limit = 20,
} = {}) {
  const safeOffset =
    Math.max(
      0,
      toSafeNumber(
        offset,
        0
      )
    );

  const safeLimit =
    Math.min(
      100,
      Math.max(
        1,
        toSafeNumber(
          limit,
          20
        )
      )
    );

  const params =
    new URLSearchParams({
      status:
        normalizeText(
          status
        ) ||
        "all",

      q:
        normalizeText(
          query
        ),

      offset:
        String(
          safeOffset
        ),

      limit:
        String(
          safeLimit
        ),
    });

  const data =
    await requestJson(
      `/me/tickets?${params.toString()}`
    );

  const items =
    Array.isArray(
      data?.items
    )
      ? data.items
          .map(
            normalizeTicket
          )
          .filter(
            (
              ticket
            ) =>
              ticket?.id
          )
      : [];

  return {
    items,

    total:
      toSafeNumber(
        data?.total,
        items.length
      ),

    hasMore:
      Boolean(
        data?.hasMore
      ),

    nextOffset:
      toSafeNumber(
        data?.nextOffset,
        safeOffset +
          items.length
      ),
  };
}

/* =========================================================
   Mesaje tichet
========================================================= */

export async function fetchSupportMessages(
  ticketId,
  {
    offset = 0,
    limit = 50,
  } = {}
) {
  const id =
    requireTicketId(
      ticketId
    );

  const safeOffset =
    Math.max(
      0,
      toSafeNumber(
        offset,
        0
      )
    );

  const safeLimit =
    Math.min(
      100,
      Math.max(
        1,
        toSafeNumber(
          limit,
          50
        )
      )
    );

  const params =
    new URLSearchParams({
      offset:
        String(
          safeOffset
        ),

      limit:
        String(
          safeLimit
        ),
    });

  const data =
    await requestJson(
      `/tickets/${encodeURIComponent(
        id
      )}/messages?${params.toString()}`
    );

  const items =
    Array.isArray(
      data?.items
    )
      ? data.items
          .map(
            normalizeSupportMessage
          )
          .filter(
            (
              message
            ) =>
              message?.id
          )
      : [];

  return {
    ticket:
      data?.ticket
        ? normalizeTicket(
            data.ticket
          )
        : null,

    items,

    total:
      toSafeNumber(
        data?.total,
        items.length
      ),

    hasMore:
      Boolean(
        data?.hasMore
      ),

    nextOffset:
      toSafeNumber(
        data?.nextOffset,
        safeOffset +
          items.length
      ),
  };
}

/* =========================================================
   Creare tichet
========================================================= */

export async function createSupportTicket({
  subject,
  category = "general",
  priority = "medium",
  message,
  attachments = [],
  name = "",
  email = "",
}) {
  const normalizedSubject =
    normalizeText(
      subject
    );

  const normalizedMessage =
    normalizeText(
      message
    );

  if (
    normalizedSubject.length <
    3
  ) {
    throw new Error(
      "Subiectul solicitării trebuie să conțină cel puțin 3 caractere."
    );
  }

  if (
    !normalizedMessage
  ) {
    throw new Error(
      "Descrierea problemei este obligatorie."
    );
  }

  const data =
    await requestJson(
      "/tickets",
      {
        method:
          "POST",

        body:
  JSON.stringify({
    subject:
      normalizedSubject,

    category:
      normalizeText(category) ||
      "general",

    priority:
      normalizeText(priority).toLowerCase() ||
      "medium",

    message:
      normalizedMessage,

   ...(normalizeText(name)
  ? {
      name:
        normalizeText(name),
    }
  : {}),

...(normalizeText(email)
  ? {
      email:
        normalizeText(email),
    }
  : {}),

    attachments:
      normalizeAttachments(
        attachments
      ),
  }),
      }
    );

 const ticket =
  normalizeTicket(
    data?.ticket
  );

if (!ticket?.id) {
  throw new Error(
    "Solicitarea a fost trimisă, dar tichetul nu a putut fi identificat."
  );
}

return {
  ...data,
  ticket,
};
}

/* =========================================================
   Trimitere mesaj
========================================================= */

export async function sendSupportTicketMessage({
  ticketId,
  body = "",
  attachments = [],
}) {
  const id =
    requireTicketId(
      ticketId
    );

  const normalizedBody =
    normalizeText(
      body
    );

  const normalizedAttachments =
    normalizeAttachments(
      attachments
    );

  if (
    !normalizedBody &&
    normalizedAttachments.length ===
      0
  ) {
    throw new Error(
      "Scrie un mesaj sau adaugă un atașament."
    );
  }

  const data =
    await requestJson(
      `/tickets/${encodeURIComponent(
        id
      )}/messages`,
      {
        method:
          "POST",

        body:
          JSON.stringify(
            {
              body:
                normalizedBody,

              attachments:
                normalizedAttachments,
            }
          ),
      }
    );

  const message =
    data?.message
      ? normalizeSupportMessage(
          data.message
        )
      : null;

  return {
    ok:
      Boolean(
        data?.ok
      ),

    message,
  };
}

/* =========================================================
   Marcare conversație drept citită
========================================================= */

export async function markSupportTicketRead(
  ticketId
) {
  const id =
    requireTicketId(
      ticketId
    );

  const data =
    await requestJson(
      `/tickets/${encodeURIComponent(
        id
      )}/read`,
      {
        method:
          "PATCH",
      }
    );

  return {
    ok:
      Boolean(
        data?.ok
      ),

    readAt:
      data?.readAt ||
      null,
  };
}

/* =========================================================
   Arhivare conversație
========================================================= */

export async function archiveSupportTicket(
  ticketId
) {
  const id =
    requireTicketId(
      ticketId
    );

  const data =
    await requestJson(
      `/tickets/${encodeURIComponent(
        id
      )}`,
      {
        method:
          "DELETE",
      }
    );

  return {
    ok:
      Boolean(
        data?.ok
      ),

    archivedAt:
      data?.archivedAt ||
      null,
  };
}

/* =========================================================
   Număr conversații necitite
========================================================= */

export async function fetchSupportUnreadCount() {
  const data =
    await requestJson(
      "/unread-count"
    );

  return Math.max(
    0,
    toSafeNumber(
      data?.count,
      0
    )
  );
}

/* =========================================================
   FAQ
========================================================= */

export async function searchSupportFaq(
  query,
  {
    limit = 10,
  } = {}
) {
  const normalizedQuery =
    normalizeText(
      query
    );

  const safeLimit =
    Math.min(
      25,
      Math.max(
        1,
        toSafeNumber(
          limit,
          10
        )
      )
    );

  const params =
    new URLSearchParams({
      q:
        normalizedQuery,

      limit:
        String(
          safeLimit
        ),
    });

  const data =
    await requestJson(
      `/faqs?${params.toString()}`
    );

  return Array.isArray(
    data?.items
  )
    ? data.items
    : [];
}