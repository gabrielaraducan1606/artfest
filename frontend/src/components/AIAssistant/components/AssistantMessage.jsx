// src/components/AiAssistant/components/AssistantMessage.jsx

import React from "react";
import { useNavigate } from "react-router-dom";

import styles from "../AiAssistant.module.css";

import {
  CameraIcon,
} from "../Products/ProductsIcons.jsx";

import SupportTicketList from "../support/SupportTicketList.jsx";
import SupportThread from "../support/SupportThread.jsx";

/* =========================================================
   Configurare rute
========================================================= */

const PRODUCTS_ROUTE = "/produse";
const PRODUCT_DETAILS_ROUTE = "/produs";

/* =========================================================
   Helpers generale
========================================================= */

function formatPrice(
  priceCents,
  currency = "RON"
) {
  const numericPrice =
    Number(priceCents);

  const safePrice =
    Number.isFinite(
      numericPrice
    )
      ? numericPrice
      : 0;

  const safeCurrency =
    typeof currency ===
      "string" &&
    currency.trim()
      ? currency
          .trim()
          .toUpperCase()
      : "RON";

  try {
    return new Intl.NumberFormat(
      "ro-RO",
      {
        style:
          "currency",
        currency:
          safeCurrency,
      }
    ).format(
      safePrice / 100
    );
  } catch {
    return `${(
      safePrice / 100
    ).toFixed(
      2
    )} ${safeCurrency}`;
  }
}

function getSimilarityPercent(
  similarity
) {
  const value =
    Number(
      similarity
    );

  if (
    !Number.isFinite(
      value
    )
  ) {
    return null;
  }

  const percentage =
    value <= 1
      ? value * 100
      : value;

  return Math.min(
    100,
    Math.max(
      0,
      Math.round(
        percentage
      )
    )
  );
}

function getProductImage(
  product
) {
  if (
    product?.imageUrl
  ) {
    return product.imageUrl;
  }

  const firstImage =
    product
      ?.images?.[0];

  if (
    typeof firstImage ===
    "string"
  ) {
    return firstImage;
  }

  if (
    firstImage &&
    typeof firstImage ===
      "object"
  ) {
    return (
      firstImage.url ||
      firstImage.src ||
      firstImage.imageUrl ||
      "/placeholder-product.png"
    );
  }

  return "/placeholder-product.png";
}

function buildProductsUrl(
  message
) {
  const searchId =
    String(
      message?.searchId ||
        ""
    ).trim();

  if (!searchId) {
    return PRODUCTS_ROUTE;
  }

  const params =
    new URLSearchParams({
      visualSearchId:
        searchId,
    });

  return `${PRODUCTS_ROUTE}?${params.toString()}`;
}

function getChoiceKey(
  choice,
  index
) {
  if (
    typeof choice ===
    "string"
  ) {
    return `${choice}-${index}`;
  }

  if (
    choice &&
    typeof choice ===
      "object"
  ) {
    return (
      choice.id ||
      choice.value ||
      choice.action ||
      choice.label ||
      choice.subject ||
      `choice-${index}`
    );
  }

  return `choice-${index}`;
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
      choice.subject ||
      choice.name ||
      "Selectează"
    );
  }

  return "Selectează";
}

function getFaqQuestion(
  item
) {
  return (
    item?.q ||
    item?.question ||
    item?.title ||
    "Întrebare frecventă"
  );
}

function getFaqAnswer(
  item
) {
  return (
    item?.a ||
    item?.answer ||
    item?.content ||
    "Răspunsul nu este disponibil."
  );
}

function formatMessageDate(
  value
) {
  if (!value) {
    return null;
  }

  const date =
    new Date(
      value
    );

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return null;
  }

  return date.toLocaleString(
    "ro-RO",
    {
      dateStyle:
        "short",
      timeStyle:
        "short",
    }
  );
}

function getQuoteId(
  quote
) {
  return (
    quote?.quoteRequestId ||
    quote?.id ||
    null
  );
}

/* =========================================================
   Card rezultat produs
========================================================= */

function ProductResultCard({
  product,
  onOpen,
}) {
  const similarityPercent =
    getSimilarityPercent(
      product?.similarity
    );

  const imageUrl =
    getProductImage(
      product
    );

  const title =
    product?.title ||
    "Produs Artfest";

  return (
    <button
      type="button"
      className={
        styles.productResultCard
      }
      onClick={() =>
        onOpen(
          product
        )
      }
      aria-label={`Deschide produsul ${title}`}
    >
      <img
        src={
          imageUrl
        }
        alt={
          title
        }
        loading="lazy"
        onError={(
          event
        ) => {
          event.currentTarget.onerror =
            null;

          event.currentTarget.src =
            "/placeholder-product.png";
        }}
      />

      <span
        className={
          styles.productResultInfo
        }
      >
        <strong>
          {title}
        </strong>

        <small>
          {formatPrice(
            product
              ?.priceCents,
            product
              ?.currency
          )}
        </small>

        {similarityPercent !==
          null && (
          <small>
            Potrivire{" "}
            {
              similarityPercent
            }
            %
          </small>
        )}

        {product
          ?.acceptsCustom && (
          <small>
            Personalizabil
          </small>
        )}
      </span>
    </button>
  );
}

/* =========================================================
   Helpers cereri de ofertă
========================================================= */

function isQuoteChoice(
  choice
) {
  return Boolean(
    choice &&
      typeof choice ===
        "object" &&
      choice.quote &&
      getQuoteId(
        choice.quote
      )
  );
}

function getQuoteChoiceDetails(
  choice
) {
  const description =
    typeof choice?.description ===
      "string"
      ? choice.description.trim()
      : "";

  const parts =
    description
      .split("·")
      .map((part) =>
        part.trim()
      )
      .filter(Boolean);

  const statusLabel =
    parts.length > 0
      ? parts[
          parts.length - 1
        ]
      : "În așteptare";

  const details =
    parts.length > 1
      ? parts
          .slice(0, -1)
          .join(" · ")
      : "";

  return {
    details,
    statusLabel,
  };
}

function getQuoteStatusType(
  status
) {
  const normalized =
    String(
      status || ""
    )
      .trim()
      .toUpperCase();

  if (
    [
      "NEW",
      "SUBMITTED",
      "NOUĂ",
      "NOU",
      "CERERE NOUĂ",
    ].includes(
      normalized
    )
  ) {
    return "new";
  }

  if (
    [
      "IN_DISCUSSION",
      "IN_DISCUSSIONS",
      "ÎN DISCUȚIE",
      "ÎN DISCUȚII",
    ].includes(
      normalized
    )
  ) {
    return "discussion";
  }

  if (
    [
      "OFFER_SENT",
      "OFERTĂ TRIMISĂ",
    ].includes(
      normalized
    )
  ) {
    return "offer";
  }

  if (
    [
      "ACCEPTED",
      "ACCEPTATĂ",
      "ACCEPTAT",
    ].includes(
      normalized
    )
  ) {
    return "accepted";
  }

  return "pending";
}

/* =========================================================
   Card cerere de ofertă
========================================================= */

function QuoteChoiceCard({
  choice,
  onChoice,
}) {
  const quote =
    choice?.quote ||
    {};

  const title =
    getChoiceLabel(
      choice
    );

  const imageUrl =
    getProductImage(
      quote?.product
    );

  const {
    details,
    statusLabel,
  } =
    getQuoteChoiceDetails(
      choice
    );

  const statusType =
    getQuoteStatusType(
      quote?.status ||
        statusLabel
    );

  return (
    <button
      type="button"
      className={
        styles.quoteChoiceCard
      }
      onClick={() =>
        onChoice(
          choice
        )
      }
      aria-label={`Deschide cererea ${title}`}
    >
      <span
        className={
          styles.quoteChoiceImage
        }
      >
        <img
          src={
            imageUrl
          }
          alt=""
          loading="lazy"
          onError={(
            event
          ) => {
            event.currentTarget.onerror =
              null;

            event.currentTarget.src =
              "/placeholder-product.png";
          }}
        />
      </span>

      <span
        className={
          styles.quoteChoiceContent
        }
      >
        <strong
          className={
            styles.quoteChoiceTitle
          }
        >
          {title}
        </strong>

        {details && (
          <span
            className={
              styles.quoteChoiceDescription
            }
          >
            {details}
          </span>
        )}

        <span
          className={`${styles.quoteChoiceStatus} ${
            statusType ===
            "new"
              ? styles.quoteChoiceStatusNew
              : statusType ===
                "discussion"
              ? styles.quoteChoiceStatusDiscussion
              : statusType ===
                "offer"
              ? styles.quoteChoiceStatusOffer
              : statusType ===
                "accepted"
              ? styles.quoteChoiceStatusAccepted
              : styles.quoteChoiceStatusPending
          }`}
        >
          <span
            aria-hidden="true"
          />

          {statusLabel}
        </span>
      </span>

      <span
        className={
          styles.quoteChoiceArrow
        }
        aria-hidden="true"
      >
        ›
      </span>
    </button>
  );
}

/* =========================================================
   Listă choices
========================================================= */

function ChoiceList({
  choices,
  onChoice,
}) {
  if (
    !Array.isArray(
      choices
    ) ||
    choices.length === 0
  ) {
    return null;
  }

  const containsQuoteChoices =
    choices.some(
      isQuoteChoice
    );

  return (
    <div
      className={`${styles.choiceList} ${
        containsQuoteChoices
          ? styles.quoteChoiceList
          : ""
      }`}
    >
      {choices.map(
        (
          choice,
          index
        ) => {
          if (
            isQuoteChoice(
              choice
            )
          ) {
            return (
              <QuoteChoiceCard
                key={getChoiceKey(
                  choice,
                  index
                )}
                choice={
                  choice
                }
                onChoice={
                  onChoice
                }
              />
            );
          }

          return (
            <button
              key={getChoiceKey(
                choice,
                index
              )}
              type="button"
              onClick={() =>
                onChoice(
                  choice
                )
              }
            >
              {getChoiceLabel(
                choice
              )}
            </button>
          );
        }
      )}
    </div>
  );
}

/* =========================================================
   Rezultate FAQ
========================================================= */

function SupportFaqResults({
  message,
  onChoice,
}) {
  const items =
    Array.isArray(
      message?.items
    )
      ? message.items
      : [];

  const choices =
    Array.isArray(
      message?.choices
    )
      ? message.choices
      : [];

  return (
    <div
      className={`${styles["artfest-assistant-message"]} ${styles["artfest-assistant-message-bot"]}`}
    >
      <div>
        {message?.content && (
          <div>
            {
              message.content
            }
          </div>
        )}

        {items.length >
          0 && (
          <div
            className={
              styles.supportFaqList
            }
          >
            {items.map(
              (
                item,
                index
              ) => (
                <details
                  key={
                    item?.id ||
                    item?.q ||
                    `faq-${index}`
                  }
                  className={
                    styles.supportFaqItem
                  }
                >
                  <summary>
                    {getFaqQuestion(
                      item
                    )}
                  </summary>

                  <div
                    className={
                      styles.supportFaqAnswer
                    }
                  >
                    {getFaqAnswer(
                      item
                    )}
                  </div>
                </details>
              )
            )}
          </div>
        )}

        <ChoiceList
          choices={
            choices
          }
          onChoice={
            onChoice
          }
        />
      </div>
    </div>
  );
}

/* =========================================================
   Tichet suport creat
========================================================= */

function SupportTicketCreated({
  message,
  onChoice,
}) {
  const ticket =
    message?.ticket ||
    null;

  const choices =
    Array.isArray(
      message?.choices
    )
      ? message.choices
      : [];

  return (
    <div
      className={`${styles["artfest-assistant-message"]} ${styles["artfest-assistant-message-bot"]}`}
    >
      <div>
        {message?.content && (
          <div>
            {
              message.content
            }
          </div>
        )}

        {ticket && (
          <div
            className={
              styles.supportTicketConfirmation
            }
          >
            <strong>
              {ticket
                .subject ||
                "Solicitare de suport"}
            </strong>

            <div>
              <span>
                {ticket
                  .statusLabel ||
                  "Deschis"}
              </span>

              {ticket
                .priorityLabel && (
                <span>
                  {
                    ticket
                      .priorityLabel
                  }
                </span>
              )}
            </div>
          </div>
        )}

        <ChoiceList
          choices={
            choices
          }
          onChoice={(
            choice
          ) => {
            if (
              choice ===
                "Deschide conversația" &&
              ticket
            ) {
              onChoice(
                ticket
              );

              return;
            }

            onChoice(
              choice
            );
          }}
        />
      </div>
    </div>
  );
}

/* =========================================================
   Componentă principală
========================================================= */

export default function AssistantMessage({
  message,
  onChoice,
  onUpload,
}) {
  const navigate =
    useNavigate();

  const isUser =
    message?.role ===
    "user";

  function openProduct(
    product
  ) {
    const productId =
      String(
        product?.id ||
          ""
      ).trim();

    if (!productId) {
      return;
    }

    navigate(
      `${PRODUCT_DETAILS_ROUTE}/${encodeURIComponent(
        productId
      )}`
    );
  }

  function viewAllProducts() {
    navigate(
      buildProductsUrl(
        message
      )
    );
  }

  function handleChoice(
    choice
  ) {
    if (
      typeof onChoice !==
      "function"
    ) {
      return;
    }

    onChoice(
      choice,
      message
    );
  }

  /* =======================================================
     Imagine încărcată
  ======================================================= */

  if (
    message?.type ===
    "image"
  ) {
    return (
      <div
        className={`${styles["artfest-assistant-message"]} ${styles["artfest-assistant-message-user"]}`}
      >
        <div>
          <div>
            <img
              src={
                message.imageUrl
              }
              alt={
                message.filename ||
                "Imagine încărcată"
              }
            />

            {message
              .filename && (
              <p>
                {
                  message
                    .filename
                }
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }

  /* =======================================================
     Loading
  ======================================================= */

  if (
    message?.type ===
    "loading"
  ) {
    return (
      <div
        className={`${styles["artfest-assistant-message"]} ${styles["artfest-assistant-message-bot"]}`}
        aria-live="polite"
        aria-busy="true"
      >
        <div>
          <div
            className={
              styles.loadingMessage
            }
          >
            <span
              className={
                styles.loadingDots
              }
              aria-hidden="true"
            >
              <span />
              <span />
              <span />
            </span>

            <span>
              {
                message.content
              }
            </span>
          </div>
        </div>
      </div>
    );
  }

  /* =======================================================
     Rezultate produse
  ======================================================= */

  if (
    message?.type ===
    "product-results"
  ) {
    const products =
      Array.isArray(
        message.products
      )
        ? message.products
        : [];

    const choices =
      Array.isArray(
        message.choices
      )
        ? message.choices
        : [];

    return (
      <div
        className={`${styles["artfest-assistant-message"]} ${styles["artfest-assistant-message-bot"]}`}
      >
        <div
          className={
            styles.productResultsMessage
          }
        >
          {message
            .content && (
            <div>
              {
                message
                  .content
              }
            </div>
          )}

          {products.length >
            0 && (
            <div
              className={
                styles.productResultsList
              }
            >
              {products.map(
                (
                  product
                ) => (
                  <ProductResultCard
                    key={
                      product.id
                    }
                    product={
                      product
                    }
                    onOpen={
                      openProduct
                    }
                  />
                )
              )}
            </div>
          )}

          {products.length >
            0 && (
            <button
              type="button"
              className={
                styles.viewAllProductsButton
              }
              onClick={
                viewAllProducts
              }
            >
              {message
                .searchId
                ? "Vezi toate produsele similare"
                : "Vezi toate produsele"}
            </button>
          )}

          <ChoiceList
            choices={
              choices
            }
            onChoice={
              handleChoice
            }
          />
        </div>
      </div>
    );
  }

  /* =======================================================
     Lista tichetelor suport
  ======================================================= */

  if (
    message?.type ===
    "support-ticket-list"
  ) {
    const tickets =
      Array.isArray(
        message.tickets
      )
        ? message.tickets
        : [];

    return (
      <div
        className={`${styles["artfest-assistant-message"]} ${styles["artfest-assistant-message-bot"]}`}
      >
        <div>
          {message
            ?.content && (
            <div>
              {
                message
                  .content
              }
            </div>
          )}

          <SupportTicketList
            tickets={
              tickets
            }
            onSelect={(
              ticket
            ) =>
              handleChoice(
                ticket
              )
            }
            onCreate={() =>
              handleChoice(
                "Creează o solicitare"
              )
            }
          />
        </div>
      </div>
    );
  }

  /* =======================================================
     Conversație suport
  ======================================================= */

  if (
    message?.type ===
    "support-thread"
  ) {
    return (
      <div
        className={`${styles["artfest-assistant-message"]} ${styles["artfest-assistant-message-bot"]}`}
      >
        <div
          className={
            styles.supportThreadMessage
          }
        >
          <SupportThread
            ticket={
              message.ticket
            }
            messages={
              Array.isArray(
                message
                  .supportMessages
              )
                ? message
                    .supportMessages
                : []
            }
          />
        </div>
      </div>
    );
  }

  /* =======================================================
     FAQ
  ======================================================= */

  if (
    message?.type ===
    "support-faq-results"
  ) {
    return (
      <SupportFaqResults
        message={
          message
        }
        onChoice={
          handleChoice
        }
      />
    );
  }

  /* =======================================================
     Tichet creat
  ======================================================= */

  if (
    message?.type ===
    "support-ticket-created"
  ) {
    return (
      <SupportTicketCreated
        message={
          message
        }
        onChoice={
          handleChoice
        }
      />
    );
  }

  /* =======================================================
     Mesaj suport trimis
  ======================================================= */

  if (
    message?.type ===
    "support-message-sent"
  ) {
    return (
      <div
        className={`${styles["artfest-assistant-message"]} ${styles["artfest-assistant-message-bot"]}`}
      >
        <div>
          <div>
            {
              message.content
            }
          </div>

          <div
            className={
              styles.supportMessageNotice
            }
          >
            Răspunsul echipei va apărea în această conversație.
          </div>
        </div>
      </div>
    );
  }

  /* =======================================================
     Info suport
  ======================================================= */

  if (
    message?.type ===
    "support-request-info"
  ) {
    return (
      <div
        className={`${styles["artfest-assistant-message"]} ${styles["artfest-assistant-message-bot"]}`}
      >
        <div>
          <div>
            {
              message.content
            }
          </div>

          {message
            .categoryLabel && (
            <div
              className={
                styles.supportCategoryBadge
              }
            >
              Categoria selectată:{" "}
              <strong>
                {
                  message
                    .categoryLabel
                }
              </strong>
            </div>
          )}
        </div>
      </div>
    );
  }

  /* =======================================================
     Rezumat cerere ofertă USER / VENDOR
  ======================================================= */

  if (
    message?.type ===
      "quote-user-summary" ||
    message?.type ===
      "quote-vendor-summary"
  ) {
    const quote =
      message?.quote ||
      {};

    const quoteId =
      getQuoteId(
        quote
      );

    const isVendorSummary =
      message?.type ===
      "quote-vendor-summary";

    const productTitle =
      quote
        ?.product
        ?.title ||
      "Cerere de ofertă";

    const quantity =
      Number(
        quote?.quantity
      );

    const status =
      quote?.status ||
      "În așteptare";

    const normalizedStatus =
      String(
        status
      ).toUpperCase();

    const imageUrl =
      getProductImage(
        quote?.product
      );

    const canSendOffer =
      isVendorSummary &&
      quoteId &&
      ![
        "ACCEPTED",
        "CANCELLED",
        "REJECTED",
        "EXPIRED",
      ].includes(
        normalizedStatus
      );

    return (
      <div
        className={`${styles["artfest-assistant-message"]} ${styles["artfest-assistant-message-bot"]}`}
      >
        <div>
          <div
            className={
              styles.quoteSummaryCard
            }
          >
            <div
              className={
                styles.quoteSummaryHeader
              }
            >
              {quote
                ?.product && (
                <img
                  src={
                    imageUrl
                  }
                  alt={
                    productTitle
                  }
                  onError={(
                    event
                  ) => {
                    event.currentTarget.onerror =
                      null;

                    event.currentTarget.src =
                      "/placeholder-product.png";
                  }}
                />
              )}

              <div>
                <strong>
                  {
                    productTitle
                  }
                </strong>

                {Number.isFinite(
                  quantity
                ) &&
                  quantity >
                    0 && (
                    <span>
                      Cantitate:{" "}
                      {
                        quantity
                      }
                    </span>
                  )}

                <span>
                  Status:{" "}
                  {
                    status
                  }
                </span>
              </div>
            </div>

            {message
              ?.content && (
              <div
                className={
                  styles.quoteSummaryContent
                }
              >
                {
                  message
                    .content
                }
              </div>
            )}

            {canSendOffer && (
              <button
                type="button"
                className={
                  styles.quotePrimaryButton
                }
                onClick={() =>
                  handleChoice({
                    action:
                      "start-quote-offer",

                    quoteId,

                    label:
                      "Trimite ofertă",

                    quote,
                  })
                }
              >
                Trimite ofertă
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  /* =======================================================
     Composer ofertă vendor

     Acest tip va fi adăugat de AiAssistant.jsx
     când vendorul apasă "Trimite ofertă".
  ======================================================= */

  if (
    message?.type ===
    "quote-offer-composer"
  ) {
    const quote =
      message?.quote ||
      {};

    const quoteId =
      message?.quoteId ||
      getQuoteId(
        quote
      );

    return (
      <div
        className={`${styles["artfest-assistant-message"]} ${styles["artfest-assistant-message-bot"]}`}
      >
        <div>
          <div
            className={
              styles.quoteOfferComposer
            }
          >
            <strong>
              Pregătește oferta
            </strong>

            <p>
              Completează detaliile ofertei pentru client.
            </p>

            <button
              type="button"
              className={
                styles.quotePrimaryButton
              }
              onClick={() =>
                handleChoice({
                  action:
                    "begin-quote-offer-form",

                  quoteId,

                  label:
                    "Completează oferta",

                  quote,
                })
              }
            >
              Completează oferta
            </button>

            <button
              type="button"
              className={
                styles.quoteSecondaryButton
              }
              onClick={() =>
                handleChoice({
                  action:
                    "cancel-quote-offer",

                  quoteId,

                  label:
                    "Renunță",
                })
              }
            >
              Renunță
            </button>
          </div>
        </div>
      </div>
    );
  }

    /* =======================================================
     Card ofertă trimisă clientului
  ======================================================= */

  if (
    message?.type ===
    "quote-offer-card"
  ) {
    const offer =
      message?.offer ||
      {};

    const quoteId =
      message?.quoteId ||
      offer?.quoteRequestId ||
      null;

    const offerId =
      offer?.id ||
      null;

    const items =
      Array.isArray(
        offer?.items
      )
        ? offer.items
        : [];

    const subtotal =
      Number(
        offer?.subtotal
      );

    const shippingTotal =
      Number(
        offer?.shippingTotal ??
          0
      );

    const total =
      Number(
        offer?.total
      );

    const currency =
      String(
        offer?.currency ||
          "RON"
      )
        .trim()
        .toUpperCase();

    const productionDays =
      Number(
        offer?.productionDays
      );

    const status =
      String(
        offer?.status ||
          "SENT"
      )
        .trim()
        .toUpperCase();

    const canRespond =
      status ===
        "SENT" &&
      Boolean(
        quoteId
      ) &&
      Boolean(
        offerId
      );

    /*
     * Backend-ul nostru lucrează
     * cu valori monetare normale
     * (ex: 125.50 RON),
     * nu cu priceCents.
     */
    function formatOfferPrice(
      value
    ) {
      const numericValue =
        Number(
          value
        );

      if (
        !Number.isFinite(
          numericValue
        )
      ) {
        return null;
      }

      try {
        return new Intl.NumberFormat(
          "ro-RO",
          {
            style:
              "currency",

            currency,
          }
        ).format(
          numericValue
        );
      } catch {
        return `${numericValue.toFixed(
          2
        )} ${currency}`;
      }
    }

    return (
      <div
        className={`${styles["artfest-assistant-message"]} ${styles["artfest-assistant-message-bot"]}`}
      >
        <div>
          <div
            className={
              styles.quoteOfferCard
            }
          >
            <strong>
              Ofertă primită
            </strong>

            {items.length >
              0 && (
              <div>
                {items.map(
                  (
                    item,
                    index
                  ) => {
                    const quantity =
                      Number(
                        item?.quantity
                      );

                    const unitPrice =
                      Number(
                        item?.unitPrice
                      );

                    const lineTotal =
                      Number(
                        item?.lineTotal
                      );

                    return (
                      <div
                        key={
                          item?.productId ||
                          `offer-item-${index}`
                        }
                        className={
                          styles.quoteOfferItem
                        }
                      >
                        <div>
                          <strong>
                            {item?.title ||
                              "Produs"}
                          </strong>
                        </div>

                        {Number.isFinite(
                          quantity
                        ) && (
                          <div>
                            Cantitate:{" "}
                            {
                              quantity
                            }
                          </div>
                        )}

                        {Number.isFinite(
                          unitPrice
                        ) && (
                          <div>
                            Preț unitar:{" "}
                            {formatOfferPrice(
                              unitPrice
                            )}
                          </div>
                        )}

                        {Number.isFinite(
                          lineTotal
                        ) && (
                          <div>
                            Total produs:{" "}
                            {formatOfferPrice(
                              lineTotal
                            )}
                          </div>
                        )}
                      </div>
                    );
                  }
                )}
              </div>
            )}

            {Number.isFinite(
              subtotal
            ) && (
              <div>
                Subtotal:{" "}
                {formatOfferPrice(
                  subtotal
                )}
              </div>
            )}

            {Number.isFinite(
              shippingTotal
            ) && (
              <div>
                Livrare:{" "}
                {formatOfferPrice(
                  shippingTotal
                )}
              </div>
            )}

            {Number.isFinite(
              total
            ) && (
              <div
                className={
                  styles.quoteOfferTotal
                }
              >
                Total:{" "}
                <strong>
                  {formatOfferPrice(
                    total
                  )}
                </strong>
              </div>
            )}

            {Number.isFinite(
              productionDays
            ) &&
              productionDays >
                0 && (
                <div>
                  Termen de producție:{" "}
                  {
                    productionDays
                  }{" "}
                  {productionDays ===
                  1
                    ? "zi"
                    : "zile"}
                </div>
              )}

            {offer?.estimatedDelivery && (
              <div>
                Livrare estimată:{" "}
                {new Date(
                  offer.estimatedDelivery
                ).toLocaleDateString(
                  "ro-RO"
                )}
              </div>
            )}

            {offer?.validUntil && (
              <div>
                Oferta este valabilă până la:{" "}
                {new Date(
                  offer.validUntil
                ).toLocaleDateString(
                  "ro-RO"
                )}
              </div>
            )}

            {offer?.notes && (
              <p>
                {
                  offer.notes
                }
              </p>
            )}

           {canRespond && (
  <div
    className={
      styles.quoteOfferActions
    }
  >
    <button
      type="button"
      className={
        styles.quotePrimaryButton
      }
      onClick={() =>
        handleChoice({
          action:
            "accept-quote-offer",

          quoteId,

          offerId,

          label:
            "Acceptă oferta",

          offer,
        })
      }
    >
      Acceptă oferta
    </button>

    <button
      type="button"
      className={
        styles.quoteSecondaryButton
      }
      onClick={() =>
        handleChoice({
          action:
            "request-new-quote-offer",

          quoteId,

          offerId,

          label:
            "Solicită o ofertă nouă",

          offer,
        })
      }
    >
      Solicită o ofertă nouă
    </button>

    <button
      type="button"
      className={
        styles.quoteSecondaryButton
      }
      onClick={() =>
        handleChoice({
          action:
            "continue-quote-discussion",

          quoteId,

          offerId,

          label:
            "Continuă discuția",

          offer,
        })
      }
    >
      Continuă discuția
    </button>

    <button
      type="button"
      className={
        styles.quoteSecondaryButton
      }
      onClick={() =>
        handleChoice({
          action:
            "reject-quote-offer",

          quoteId,

          offerId,

          label:
            "Refuză definitiv",

          offer,
        })
      }
    >
      Refuză definitiv
    </button>
  </div>
)}

            {status ===
              "ACCEPTED" && (
              <div>
                Oferta a fost acceptată.
              </div>
            )}

            {status ===
              "REJECTED" && (
              <div>
                Oferta a fost refuzată.
              </div>
            )}

            {status ===
              "EXPIRED" && (
              <div>
                Oferta a expirat.
              </div>
            )}

            {status ===
              "SUPERSEDED" && (
              <div>
                Această ofertă a fost înlocuită cu una mai nouă.
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }
  /* =======================================================
     Mesaj conversație cerere ofertă
  ======================================================= */

  if (
    message?.type ===
    "quote-message"
  ) {
    const formattedDate =
      formatMessageDate(
        message
          ?.createdAt
      );

    return (
      <div
        className={`${styles["artfest-assistant-message"]} ${
          isUser
            ? styles[
                "artfest-assistant-message-user"
              ]
            : styles[
                "artfest-assistant-message-bot"
              ]
        }`}
      >
        <div>
          <div>
            {
              message
                ?.content
            }
          </div>

          {formattedDate && (
            <small
              className={
                styles.quoteMessageDate
              }
            >
              {
                formattedDate
              }
            </small>
          )}
        </div>
      </div>
    );
  }

  /* =======================================================
     Mesaje generice
  ======================================================= */

  const genericChoices =
    Array.isArray(
      message?.choices
    )
      ? message.choices
      : [];

  return (
    <div
      className={`${styles["artfest-assistant-message"]} ${
        isUser
          ? styles[
              "artfest-assistant-message-user"
            ]
          : styles[
              "artfest-assistant-message-bot"
            ]
      }`}
    >
      <div>
        <div>
          {
            message
              ?.content
          }
        </div>

        {genericChoices.length >
          0 && (
          <ChoiceList
            choices={
              genericChoices
            }
            onChoice={
              handleChoice
            }
          />
        )}

        {message?.type ===
          "image-upload" && (
          <button
            type="button"
            onClick={
              onUpload
            }
            className={
              styles.uploadButton
            }
          >
            <CameraIcon />

            <span>
              Încarcă fotografia
            </span>
          </button>
        )}
      </div>
    </div>
  );
}