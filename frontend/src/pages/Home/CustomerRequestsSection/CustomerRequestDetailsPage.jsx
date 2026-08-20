import React, {
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  useNavigate,
  useParams,
} from "react-router-dom";

import {
  api,
} from "../../../lib/api.js";

import {
  useAuth,
} from "../../Auth/Context/context.js";

import CustomerRequestOfferModal
  from "./CustomerRequestOfferModal.jsx";

import styles from "./CustomerRequestDetailsPage.module.css";

/* =========================================================
   HELPERS
========================================================= */

function getInitials(name = "") {
  const parts =
    String(name)
      .trim()
      .split(/\s+/)
      .filter(Boolean);

  if (!parts.length) {
    return "A";
  }

  return parts
    .slice(0, 2)
    .map((part) =>
      part
        .charAt(0)
        .toUpperCase()
    )
    .join("");
}

function formatRelativeDate(value) {
  if (!value) {
    return "";
  }

  const date =
    new Date(value);

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return "";
  }

  const now =
    new Date();

  const diffMs =
    now.getTime() -
    date.getTime();

  const diffMinutes =
    Math.max(
      0,
      Math.floor(
        diffMs / 60000
      )
    );

  if (diffMinutes < 1) {
    return "acum";
  }

  if (diffMinutes < 60) {
    return `acum ${diffMinutes} min`;
  }

  const diffHours =
    Math.floor(
      diffMinutes / 60
    );

  if (diffHours < 24) {
    return `acum ${diffHours} h`;
  }

  const diffDays =
    Math.floor(
      diffHours / 24
    );

  if (diffDays === 1) {
    return "ieri";
  }

  if (diffDays < 7) {
    return `acum ${diffDays} zile`;
  }

  return new Intl.DateTimeFormat(
    "ro-RO",
    {
      day: "numeric",
      month: "long",
      year: "numeric",
    }
  ).format(date);
}

function formatDeadline(value) {
  if (!value) {
    return "Fără termen specificat";
  }

  const date =
    new Date(value);

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return "Fără termen specificat";
  }

  return new Intl.DateTimeFormat(
    "ro-RO",
    {
      day: "numeric",
      month: "long",
      year: "numeric",
    }
  ).format(date);
}

function formatMoney(
  cents,
  currency = "RON"
) {
  if (
    cents === null ||
    cents === undefined
  ) {
    return null;
  }

  const numeric =
    Number(cents);

  if (
    !Number.isFinite(
      numeric
    )
  ) {
    return null;
  }

  return new Intl.NumberFormat(
    "ro-RO",
    {
      style: "currency",
      currency:
        currency ||
        "RON",
      maximumFractionDigits:
        2,
    }
  ).format(
    numeric / 100
  );
}

function formatBudget(request) {
  const min =
    formatMoney(
      request
        ?.budgetMinCents,
      request?.currency
    );

  const max =
    formatMoney(
      request
        ?.budgetMaxCents,
      request?.currency
    );

  let text =
    "Buget flexibil";

  if (min && max) {
    if (
      request
        .budgetMinCents ===
      request
        .budgetMaxCents
    ) {
      text =
        max;
    } else {
      text =
        `${min} – ${max}`;
    }
  } else if (max) {
    text =
      `maximum ${max}`;
  } else if (min) {
    text =
      `de la ${min}`;
  }

  if (
    text !==
      "Buget flexibil" &&
    request?.budgetType ===
      "PER_ITEM"
  ) {
    text +=
      " / buc.";
  }

  return text;
}

function getStatusLabel(status) {
  switch (status) {
    case "OPEN":
      return "Cerere deschisă";

    case "ACCEPTED":
      return "Ofertă acceptată";

    case "CLOSED":
      return "Cerere închisă";

    case "EXPIRED":
      return "Cerere expirată";

    case "CANCELLED":
      return "Cerere ștearsă";

    default:
      return status || "";
  }
}


function getOfferStatusLabel(status) {
  switch (status) {
    case "SENT":
      return "Ofertă trimisă";

    case "ACCEPTED":
      return "Ofertă acceptată";

    case "REJECTED":
      return "Ofertă respinsă";

    case "WITHDRAWN":
      return "Ofertă retrasă";

    case "EXPIRED":
      return "Ofertă expirată";

    default:
      return status || "Ofertă";
  }
}

function formatOfferDate(value) {
  if (!value) {
    return "";
  }

  const date =
    new Date(value);

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return "";
  }

  return new Intl.DateTimeFormat(
    "ro-RO",
    {
      day: "numeric",
      month: "long",
      year: "numeric",
    }
  ).format(date);
}

/* =========================================================
   COMPONENT
========================================================= */

export default function CustomerRequestDetailsPage() {
  const {
    id,
  } =
    useParams();

  const navigate =
    useNavigate();

  const {
    me,
  } =
    useAuth();

  const [
    request,
    setRequest,
  ] =
    useState(null);

  const [
    loading,
    setLoading,
  ] =
    useState(true);

  const [
    error,
    setError,
  ] =
    useState("");

  const [
    activeImage,
    setActiveImage,
  ] =
    useState("");

  /* =======================================================
     OFFER MODAL
  ======================================================= */

  const [
    offerModalOpen,
    setOfferModalOpen,
  ] =
    useState(false);

  const [
    offerModalKey,
    setOfferModalKey,
  ] =
    useState(0);


    /* =======================================================
   CONTINUĂ CU OFERTA
======================================================= */

const [
  continuingOfferId,
  setContinuingOfferId,
] =
  useState(null);

const [
  continueOfferError,
  setContinueOfferError,
] =
  useState("");
  /* =======================================================
     LOAD
  ======================================================= */

  useEffect(() => {
    let active =
      true;

    async function loadRequest() {
      try {
        setLoading(true);

        setError("");

        const result =
          await api(
            `/customer-requests/${id}`,
            {
              method:
                "GET",
            }
          );

        if (!active) {
          return;
        }

        const loaded =
          result?.request ||
          null;

        setRequest(
          loaded
        );

        if (
          Array.isArray(
            loaded?.images
          ) &&
          loaded.images.length >
            0
        ) {
          setActiveImage(
            loaded.images[0]
          );
        }
      } catch (err) {
        if (!active) {
          return;
        }

        console.error(
          "[CustomerRequestDetailsPage] load failed:",
          err
        );

        setError(
          err?.message ||
            "Cererea nu a putut fi încărcată."
        );
      } finally {
        if (active) {
          setLoading(
            false
          );
        }
      }
    }

    if (id) {
      loadRequest();
    }

    return () => {
      active =
        false;
    };
  }, [
    id,
  ]);

  /* =======================================================
     OWNERSHIP / ROLE
  ======================================================= */

  const currentUserId =
    me?.id ||
    me?.sub ||
    null;

  const isOwner =
    useMemo(() => {
      if (
        !currentUserId ||
        !request?.user?.id
      ) {
        return false;
      }

      return (
        String(
          currentUserId
        ) ===
        String(
          request.user.id
        )
      );
    }, [
      currentUserId,
      request,
    ]);

  const isVendor =
    me?.role ===
    "VENDOR";

  const canSendOffer =
    Boolean(
      isVendor &&
      !isOwner &&
      request?.status ===
        "OPEN"
    );

  /* =======================================================
     ACTIONS
  ======================================================= */

  function handleBack() {
    navigate(
      "/cereri"
    );
  }

  function handleSendOffer() {
    if (
      !canSendOffer
    ) {
      return;
    }

    setOfferModalKey(
      (current) =>
        current + 1
    );

    setOfferModalOpen(
      true
    );
  }

  function closeOfferModal() {
    setOfferModalOpen(
      false
    );
  }

  function handleOfferSent(
    offer
  ) {
    setRequest(
      (current) => {
        if (!current) {
          return current;
        }

        return {
          ...current,

          offersCount:
            Number(
              current.offersCount ||
                0
            ) + 1,

          /*
           * Marcăm local faptul că vendorul
           * a trimis deja o ofertă.
           *
           * Mai târziu putem primi această
           * informație direct din API.
           */
          myOffer:
            offer ||
            true,
        };
      }
    );

    setOfferModalOpen(
      false
    );
  }
async function handleContinueWithOffer(
  offer
) {
  if (
    !isOwner ||
    !request?.id ||
    !offer?.id
  ) {
    return;
  }

  if (
    offer.status !==
    "SENT"
  ) {
    return;
  }

  if (
    continuingOfferId
  ) {
    return;
  }

  try {
    setContinuingOfferId(
      offer.id
    );

    setContinueOfferError(
      ""
    );

    const result =
      await api(
        `/customer-requests/${request.id}/offers/${offer.id}/continue`,
        {
          method:
            "POST",
        }
      );

    const quoteId =
      result?.quoteId;

    if (!quoteId) {
      throw new Error(
        "Nu am primit ID-ul conversației."
      );
    }

    /*
     * Mergem pe homepage și deschidem
     * direct oferta în asistentul AI.
     */
    navigate(
      `/?assistant=quote&quoteId=${encodeURIComponent(
        quoteId
      )}`
    );
  } catch (err) {
    console.error(
      "[CustomerRequestDetailsPage] continue offer failed:",
      err
    );

    setContinueOfferError(
      err?.data?.message ||
        err?.message ||
        "Nu am putut continua cu această ofertă."
    );
  } finally {
    setContinuingOfferId(
      null
    );
  }
}
  function handleEdit() {
    /*
     * Momentan pagina de editare/modalul
     * este gestionat din lista cererilor.
     *
     * Mai târziu putem deschide direct
     * CreateCustomerRequestModal și aici.
     */

    navigate(
      "/cereri"
    );
  }

  /* =======================================================
     LOADING
  ======================================================= */

  if (loading) {
    return (
      <main
        className={
          styles.page
        }
      >
        <div
          className={
            styles.container
          }
        >
          <div
            className={
              styles.loadingCard
            }
          >
            <div
              className={
                styles.loadingIcon
              }
            >
              ✨
            </div>

            <p>
              Se încarcă cererea...
            </p>
          </div>
        </div>
      </main>
    );
  }

  /* =======================================================
     ERROR
  ======================================================= */

  if (
    error ||
    !request
  ) {
    return (
      <main
        className={
          styles.page
        }
      >
        <div
          className={
            styles.container
          }
        >
          <div
            className={
              styles.errorCard
            }
          >
            <div
              className={
                styles.errorIcon
              }
            >
              🤍
            </div>

            <h1>
              Cererea nu este disponibilă
            </h1>

            <p>
              {error ||
                "Este posibil ca cererea să fi fost ștearsă sau să nu mai fie disponibilă."}
            </p>

            <button
              type="button"
              className={
                styles.primaryButton
              }
              onClick={
                handleBack
              }
            >
              Vezi toate cererile
            </button>
          </div>
        </div>
      </main>
    );
  }

  const authorName =
    request.user?.name ||
    "Client Artfest";

  const images =
    Array.isArray(
      request.images
    )
      ? request.images
      : [];

  const budget =
    formatBudget(
      request
    );

  const deadline =
    formatDeadline(
      request
        .deliveryDeadline
    );

  const hasSentOffer =
    Boolean(
      request?.myOffer
    );

  const offers =
    Array.isArray(
      request?.offers
    )
      ? request.offers
      : [];

  const myOffer =
    request?.myOffer &&
    typeof request.myOffer ===
      "object"
      ? request.myOffer
      : null;

  /* =======================================================
     RENDER
  ======================================================= */

  return (
    <>
      <main
        className={
          styles.page
        }
      >
        <div
          className={
            styles.container
          }
        >
          {/* ==================================================
              BACK
          ================================================== */}

          <button
            type="button"
            className={
              styles.backButton
            }
            onClick={
              handleBack
            }
          >
            <span>
              ←
            </span>

            <span>
              Înapoi la cereri
            </span>
          </button>

          {/* ==================================================
              LAYOUT
          ================================================== */}

          <div
            className={
              styles.layout
            }
          >
            {/* ==================================================
                MAIN
            ================================================== */}

            <section
              className={
                styles.mainCard
              }
            >
              {/* AUTHOR */}

              <div
                className={
                  styles.authorHeader
                }
              >
                <div
                  className={
                    styles.authorArea
                  }
                >
                  {request.user
                    ?.avatarUrl ? (
                    <img
                      src={
                        request
                          .user
                          .avatarUrl
                      }
                      alt=""
                      className={
                        styles.avatar
                      }
                    />
                  ) : (
                    <div
                      className={
                        styles.avatarFallback
                      }
                    >
                      {getInitials(
                        authorName
                      )}
                    </div>
                  )}

                  <div>
                    <div
                      className={
                        styles.authorNameRow
                      }
                    >
                      <strong
                        className={
                          styles.authorName
                        }
                      >
                        {authorName}
                      </strong>

                      {request.status ===
                        "OPEN" && (
                        <span
                          className={
                            styles.openDot
                          }
                        />
                      )}
                    </div>

                    <div
                      className={
                        styles.metaRow
                      }
                    >
                      <span>
                        {formatRelativeDate(
                          request.createdAt
                        )}
                      </span>

                      <span>
                        ·
                      </span>

                      <span>
                        🌐 Public
                      </span>
                    </div>
                  </div>
                </div>

                <span
                  className={
                    styles.statusBadge
                  }
                >
                  {getStatusLabel(
                    request.status
                  )}
                </span>
              </div>

              {/* TITLE */}

              <div
                className={
                  styles.content
                }
              >
                <h1
                  className={
                    styles.title
                  }
                >
                  {request.title}
                </h1>

                <p
                  className={
                    styles.description
                  }
                >
                  {
                    request.description
                  }
                </p>
              </div>

              {/* IMAGES */}

              {images.length >
                0 && (
                <div
                  className={
                    styles.gallery
                  }
                >
                  <div
                    className={
                      styles.mainImageWrap
                    }
                  >
                    <img
                      src={
                        activeImage ||
                        images[0]
                      }
                      alt={
                        request.title ||
                        ""
                      }
                      className={
                        styles.mainImage
                      }
                    />
                  </div>

                  {images.length >
                    1 && (
                    <div
                      className={
                        styles.thumbnailRow
                      }
                    >
                      {images.map(
                        (
                          image,
                          index
                        ) => (
                          <button
                            key={`${image}-${index}`}
                            type="button"
                            className={`${styles.thumbnailButton} ${
                              (
                                activeImage ||
                                images[0]
                              ) ===
                              image
                                ? styles.thumbnailButtonActive
                                : ""
                            }`}
                            onClick={() =>
                              setActiveImage(
                                image
                              )
                            }
                          >
                            <img
                              src={
                                image
                              }
                              alt=""
                            />
                          </button>
                        )
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* DETAILS */}

              <div
                className={
                  styles.detailsGrid
                }
              >
                {request.quantity !=
                  null && (
                  <div
                    className={
                      styles.detailCard
                    }
                  >
                    <div
                      className={
                        styles.detailIcon
                      }
                    >
                      📦
                    </div>

                    <div>
                      <span
                        className={
                          styles.detailLabel
                        }
                      >
                        Cantitate
                      </span>

                      <strong
                        className={
                          styles.detailValue
                        }
                      >
                        {
                          request.quantity
                        }{" "}
                        buc.
                      </strong>
                    </div>
                  </div>
                )}

                <div
                  className={
                    styles.detailCard
                  }
                >
                  <div
                    className={
                      styles.detailIcon
                    }
                  >
                    💰
                  </div>

                  <div>
                    <span
                      className={
                        styles.detailLabel
                      }
                    >
                      Buget
                    </span>

                    <strong
                      className={
                        styles.detailValue
                      }
                    >
                      {budget}
                    </strong>
                  </div>
                </div>

                <div
                  className={
                    styles.detailCard
                  }
                >
                  <div
                    className={
                      styles.detailIcon
                    }
                  >
                    📅
                  </div>

                  <div>
                    <span
                      className={
                        styles.detailLabel
                      }
                    >
                      Termen
                    </span>

                    <strong
                      className={
                        styles.detailValue
                      }
                    >
                      {deadline}
                    </strong>
                  </div>
                </div>

                {request.city && (
                  <div
                    className={
                      styles.detailCard
                    }
                  >
                    <div
                      className={
                        styles.detailIcon
                      }
                    >
                      📍
                    </div>

                    <div>
                      <span
                        className={
                          styles.detailLabel
                        }
                      >
                        Localitate
                      </span>

                      <strong
                        className={
                          styles.detailValue
                        }
                      >
                        {
                          request.city
                        }
                      </strong>
                    </div>
                  </div>
                )}

                {request.category && (
                  <div
                    className={
                      styles.detailCard
                    }
                  >
                    <div
                      className={
                        styles.detailIcon
                      }
                    >
                      ✨
                    </div>

                    <div>
                      <span
                        className={
                          styles.detailLabel
                        }
                      >
                        Categorie
                      </span>

                      <strong
                        className={
                          styles.detailValue
                        }
                      >
                        {
                          request.category
                        }
                      </strong>
                    </div>
                  </div>
                )}
              </div>

              {/* ==================================================
                  OFFERS RECEIVED - OWNER ONLY
              ================================================== */}

              {isOwner && (
                <section
                  aria-label="Oferte primite"
                  style={{
                    marginTop: 22,
                    paddingTop: 20,
                    borderTop:
                      "1px solid var(--color-border, #ece7ef)",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "flex-end",
                      justifyContent: "space-between",
                      gap: 12,
                      marginBottom: 14,
                    }}
                  >
                    <div>
                      <span
                        style={{
                          display: "block",
                          marginBottom: 4,
                          color:
                            "var(--color-primary, #8b5cf6)",
                          fontSize: 10,
                          fontWeight: 850,
                          letterSpacing: ".06em",
                          textTransform: "uppercase",
                        }}
                      >
                        Ofertele creatorilor
                      </span>

                      <h2
                        style={{
                          margin: 0,
                          fontSize: 20,
                          lineHeight: 1.25,
                        }}
                      >
                        {offers.length === 1
                          ? "1 ofertă primită"
                          : `${offers.length} oferte primite`}
                      </h2>
                      {continueOfferError && (
  <div
    style={{
      marginTop: 10,
      padding: "9px 11px",
      borderRadius: 10,
      background:
        "rgba(220, 38, 38, 0.06)",
      color:
        "#b91c1c",
      fontSize: 10,
      lineHeight: 1.45,
    }}
  >
    {continueOfferError}
  </div>
)}
                    </div>
                  </div>

                  {offers.length === 0 ? (
                    <div
                      style={{
                        padding: "18px 16px",
                        border:
                          "1px solid var(--color-border, #e7e2ea)",
                        borderRadius: 14,
                        background:
                          "var(--surface, #fff)",
                        color:
                          "var(--color-muted, #77717e)",
                        fontSize: 12,
                        lineHeight: 1.55,
                      }}
                    >
                      Nu ai primit încă nicio ofertă. Când un creator
                      trimite o ofertă, aceasta va apărea aici.
                    </div>
                  ) : (
                    <div
                      style={{
                        display: "grid",
                        gap: 12,
                      }}
                    >
                      {offers.map(
                        (offer) => {
                          const unitPrice =
                            formatMoney(
                              offer.unitPriceCents,
                              offer.currency
                            );

                          const shipping =
                            formatMoney(
                              offer.shippingCents,
                              offer.currency
                            );

                          const total =
                            formatMoney(
                              offer.totalPriceCents,
                              offer.currency
                            );

                          return (
                            <article
                              key={offer.id}
                              style={{
                                padding: 16,
                                border:
                                  "1px solid var(--color-border, #e6e1e9)",
                                borderRadius: 16,
                                background:
                                  "var(--surface, #fff)",
                                boxShadow:
                                  "0 8px 24px rgba(32, 24, 39, 0.05)",
                              }}
                            >
                              <div
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "space-between",
                                  gap: 12,
                                  marginBottom: 12,
                                }}
                              >
                                <div
                                  style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 10,
                                    minWidth: 0,
                                  }}
                                >
                                  {offer.vendor?.logoUrl ? (
                                    <img
                                      src={offer.vendor.logoUrl}
                                      alt=""
                                      style={{
                                        width: 42,
                                        height: 42,
                                        borderRadius: "50%",
                                        objectFit: "cover",
                                        flexShrink: 0,
                                      }}
                                    />
                                  ) : (
                                    <div
                                      style={{
                                        width: 42,
                                        height: 42,
                                        borderRadius: "50%",
                                        display: "grid",
                                        placeItems: "center",
                                        flexShrink: 0,
                                        background:
                                          "rgba(139,92,246,.08)",
                                        color:
                                          "var(--color-primary, #8b5cf6)",
                                        fontWeight: 900,
                                      }}
                                    >
                                      {getInitials(
                                        offer.vendor?.displayName ||
                                          "Creator"
                                      )}
                                    </div>
                                  )}

                                  <div
                                    style={{
                                      minWidth: 0,
                                    }}
                                  >
                                    <strong
                                      style={{
                                        display: "block",
                                        overflow: "hidden",
                                        textOverflow: "ellipsis",
                                        whiteSpace: "nowrap",
                                        fontSize: 13,
                                      }}
                                    >
                                      {offer.vendor?.displayName ||
                                        "Creator Artfest"}
                                    </strong>

                                    <small
                                      style={{
                                        color:
                                          "var(--color-muted, #827b88)",
                                      }}
                                    >
                                      {formatRelativeDate(
                                        offer.createdAt
                                      )}
                                    </small>
                                  </div>
                                </div>

                                <span
                                  style={{
                                    flexShrink: 0,
                                    padding: "5px 8px",
                                    borderRadius: 999,
                                    background:
                                      offer.status === "ACCEPTED"
                                        ? "rgba(34,197,94,.09)"
                                        : "rgba(139,92,246,.08)",
                                    color:
                                      offer.status === "ACCEPTED"
                                        ? "#15803d"
                                        : "var(--color-primary, #8b5cf6)",
                                    fontSize: 9,
                                    fontWeight: 800,
                                  }}
                                >
                                  {getOfferStatusLabel(
                                    offer.status
                                  )}
                                </span>
                              </div>

                              <div
                                style={{
                                  display: "grid",
                                  gridTemplateColumns:
                                    "repeat(auto-fit, minmax(120px, 1fr))",
                                  gap: 8,
                                  marginBottom:
                                    offer.message ? 12 : 0,
                                }}
                              >
                                {unitPrice && (
                                  <div
                                    style={{
                                      padding: "10px 11px",
                                      borderRadius: 11,
                                      background:
                                        "rgba(139,92,246,.045)",
                                    }}
                                  >
                                    <small
                                      style={{
                                        display: "block",
                                        marginBottom: 3,
                                        color:
                                          "var(--color-muted, #827b88)",
                                      }}
                                    >
                                      Preț / buc.
                                    </small>
                                    <strong>{unitPrice}</strong>
                                  </div>
                                )}

                                {shipping && (
                                  <div
                                    style={{
                                      padding: "10px 11px",
                                      borderRadius: 11,
                                      background:
                                        "rgba(139,92,246,.045)",
                                    }}
                                  >
                                    <small
                                      style={{
                                        display: "block",
                                        marginBottom: 3,
                                        color:
                                          "var(--color-muted, #827b88)",
                                      }}
                                    >
                                      Transport
                                    </small>
                                    <strong>{shipping}</strong>
                                  </div>
                                )}

                                {total && (
                                  <div
                                    style={{
                                      padding: "10px 11px",
                                      borderRadius: 11,
                                      background:
                                        "rgba(139,92,246,.075)",
                                    }}
                                  >
                                    <small
                                      style={{
                                        display: "block",
                                        marginBottom: 3,
                                        color:
                                          "var(--color-muted, #827b88)",
                                      }}
                                    >
                                      Total
                                    </small>
                                    <strong
                                      style={{
                                        color:
                                          "var(--color-primary, #8b5cf6)",
                                      }}
                                    >
                                      {total}
                                    </strong>
                                  </div>
                                )}

                                {offer.productionDays !=
                                  null && (
                                  <div
                                    style={{
                                      padding: "10px 11px",
                                      borderRadius: 11,
                                      background:
                                        "rgba(139,92,246,.045)",
                                    }}
                                  >
                                    <small
                                      style={{
                                        display: "block",
                                        marginBottom: 3,
                                        color:
                                          "var(--color-muted, #827b88)",
                                      }}
                                    >
                                      Producție
                                    </small>
                                    <strong>
                                      {offer.productionDays} zile
                                    </strong>
                                  </div>
                                )}
                              </div>

                              {offer.message && (
                                <p
                                  style={{
                                    margin: 0,
                                    padding: "11px 12px",
                                    borderRadius: 11,
                                    background:
                                      "var(--color-bg-soft, #faf8fb)",
                                    fontSize: 12,
                                    lineHeight: 1.55,
                                    whiteSpace: "pre-wrap",
                                  }}
                                >
                                  {offer.message}
                                </p>
                              )}

                              {(offer.estimatedDelivery ||
                                offer.validUntil) && (
                                <div
                                  style={{
                                    display: "flex",
                                    flexWrap: "wrap",
                                    gap: "6px 14px",
                                    marginTop: 10,
                                    color:
                                      "var(--color-muted, #827b88)",
                                    fontSize: 10,
                                  }}
                                >
                                  {offer.estimatedDelivery && (
                                    <span>
                                      📦 Livrare estimată:{" "}
                                      {formatOfferDate(
                                        offer.estimatedDelivery
                                      )}
                                    </span>
                                  )}

                                  {offer.validUntil && (
                                    <span>
                                      ⏳ Valabilă până la:{" "}
                                      {formatOfferDate(
                                        offer.validUntil
                                      )}
                                    </span>
                                  )}
                                </div>
                              )}

                              {offer.status ===
  "SENT" && (
  <div
    style={{
      marginTop: 14,
      paddingTop: 14,
      borderTop:
        "1px solid var(--color-border, #ece7ef)",
    }}
  >
    <button
      type="button"
      className={
        styles.primaryButton
      }
      disabled={
        continuingOfferId ===
        offer.id
      }
      onClick={() =>
        handleContinueWithOffer(
          offer
        )
      }
      style={{
        width: "100%",
      }}
    >
      {continuingOfferId ===
      offer.id
        ? "Se deschide oferta..."
        : "💜 Continuă cu această ofertă"}
    </button>

    <div
      style={{
        marginTop: 7,
        color:
          "var(--color-muted, #827b88)",
        fontSize: 9,
        lineHeight: 1.45,
      }}
    >
      Vei continua în asistentul Artfest,
      unde poți verifica oferta și completa
      datele necesare comenzii.
    </div>
  </div>
)}
                            </article>
                          );
                        }
                      )}
                    </div>
                  )}
                </section>
              )}
            </section>

            {/* ==================================================
                SIDEBAR
            ================================================== */}

            <aside
              className={
                styles.sidebar
              }
            >
              <div
                className={
                  styles.offerCard
                }
              >
                <div
                  className={
                    styles.offerCardIcon
                  }
                >
                  💜
                </div>

                <h2>
                  {request.offersCount ||
                    0}{" "}
                  {(request.offersCount ||
                    0) ===
                  1
                    ? "ofertă primită"
                    : "oferte primite"}
                </h2>

                {/* =============================
                    OWNER
                ============================= */}

                {isOwner ? (
                  <>
                    <p>
                      Creatorii interesați îți pot trimite oferte pentru această cerere.
                    </p>

                    <button
                      type="button"
                      className={
                        styles.secondaryButton
                      }
                      onClick={
                        handleEdit
                      }
                    >
                      ✏️ Editează cererea
                    </button>

                    <div
                      className={
                        styles.ownerHint
                      }
                    >
                      {offers.length > 0
                        ? "Ofertele primite sunt afișate mai jos în pagina cererii."
                        : "Când un creator trimite o ofertă, aceasta va apărea automat în pagina cererii."}
                    </div>
                  </>
                ) : canSendOffer ? (
                  /* =============================
                     VENDOR
                  ============================= */

                  <>
                    {hasSentOffer ? (
                      <>
                        <p>
                          Ai trimis deja o ofertă pentru această cerere.
                        </p>

                        {myOffer && (
                          <div
                            style={{
                              display: "grid",
                              gap: 8,
                              marginBottom: 12,
                              textAlign: "left",
                            }}
                          >
                            <div
                              style={{
                                display: "flex",
                                justifyContent: "space-between",
                                gap: 10,
                                padding: "9px 10px",
                                borderRadius: 10,
                                background:
                                  "rgba(139,92,246,.055)",
                              }}
                            >
                              <span
                                style={{
                                  color:
                                    "var(--color-muted, #817a87)",
                                  fontSize: 10,
                                }}
                              >
                                Preț / buc.
                              </span>

                              <strong
                                style={{
                                  fontSize: 11,
                                }}
                              >
                                {formatMoney(
                                  myOffer.unitPriceCents,
                                  myOffer.currency
                                ) || "—"}
                              </strong>
                            </div>

                            <div
                              style={{
                                display: "flex",
                                justifyContent: "space-between",
                                gap: 10,
                                padding: "9px 10px",
                                borderRadius: 10,
                                background:
                                  "rgba(139,92,246,.055)",
                              }}
                            >
                              <span
                                style={{
                                  color:
                                    "var(--color-muted, #817a87)",
                                  fontSize: 10,
                                }}
                              >
                                Total
                              </span>

                              <strong
                                style={{
                                  color:
                                    "var(--color-primary, #8b5cf6)",
                                  fontSize: 11,
                                }}
                              >
                                {formatMoney(
                                  myOffer.totalPriceCents,
                                  myOffer.currency
                                ) || "—"}
                              </strong>
                            </div>

                            {myOffer.productionDays !=
                              null && (
                              <div
                                style={{
                                  display: "flex",
                                  justifyContent: "space-between",
                                  gap: 10,
                                  padding: "9px 10px",
                                  borderRadius: 10,
                                  background:
                                    "rgba(139,92,246,.055)",
                                }}
                              >
                                <span
                                  style={{
                                    color:
                                      "var(--color-muted, #817a87)",
                                    fontSize: 10,
                                  }}
                                >
                                  Producție
                                </span>

                                <strong
                                  style={{
                                    fontSize: 11,
                                  }}
                                >
                                  {myOffer.productionDays} zile
                                </strong>
                              </div>
                            )}
                          </div>
                        )}

                        <button
                          type="button"
                          className={
                            styles.secondaryButton
                          }
                          disabled
                        >
                          ✓ {myOffer
                            ? getOfferStatusLabel(
                                myOffer.status
                              )
                            : "Ofertă trimisă"}
                        </button>

                        <div
                          className={
                            styles.safeHint
                          }
                        >
                          Oferta ta a fost trimisă clientului prin Artfest.
                        </div>
                      </>
                    ) : (
                      <>
                        <p>
                          Dacă poți realiza ceea ce caută acest client, îi poți trimite o ofertă direct prin Artfest.
                        </p>

                        <button
                          type="button"
                          className={
                            styles.primaryButton
                          }
                          onClick={
                            handleSendOffer
                          }
                        >
                          💜 Trimite ofertă
                        </button>

                        <div
                          className={
                            styles.safeHint
                          }
                        >
                          Comunicarea și ofertele rămân în Artfest.
                        </div>
                      </>
                    )}
                  </>
                ) : (
                  /* =============================
                     USER / CLOSED REQUEST
                  ============================= */

                  <>
                    <p>
                      Această cerere poate primi oferte de la creatorii Artfest.
                    </p>

                    {!isVendor &&
                      request.status ===
                        "OPEN" && (
                        <div
                          className={
                            styles.ownerHint
                          }
                        >
                          Doar vânzătorii Artfest pot trimite oferte.
                        </div>
                      )}

                    {request.status !==
                      "OPEN" && (
                      <div
                        className={
                          styles.closedHint
                        }
                      >
                        Cererea nu mai primește oferte noi.
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* ==================================================
                  INFO CARD
              ================================================== */}

              <div
                className={
                  styles.infoCard
                }
              >
                <strong>
                  Cum funcționează?
                </strong>

                <div
                  className={
                    styles.infoStep
                  }
                >
                  <span>
                    1
                  </span>

                  <p>
                    Clientul publică ce caută.
                  </p>
                </div>

                <div
                  className={
                    styles.infoStep
                  }
                >
                  <span>
                    2
                  </span>

                  <p>
                    Creatorii trimit oferte.
                  </p>
                </div>

                <div
                  className={
                    styles.infoStep
                  }
                >
                  <span>
                    3
                  </span>

                  <p>
                    Clientul alege oferta potrivită.
                  </p>
                </div>
              </div>
            </aside>
          </div>
        </div>
      </main>

      {/* ====================================================
          OFFER MODAL
      ==================================================== */}

      {offerModalOpen &&
        request && (
          <CustomerRequestOfferModal
            key={
              offerModalKey
            }
            open={
              true
            }
            request={
              request
            }
            onClose={
              closeOfferModal
            }
            onSent={
              handleOfferSent
            }
          />
        )}
    </>
  );
}