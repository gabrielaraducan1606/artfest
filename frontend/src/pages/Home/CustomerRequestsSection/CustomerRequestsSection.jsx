import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  useNavigate,
} from "react-router-dom";

import {
  useAuth,
} from "../../Auth/Context/context.js";

import {
  api,
} from "../../../lib/api";

import CreateCustomerRequestModal
  from "./CreateCustomerRequestModal";

import CustomerRequestOfferModal
  from "./CustomerRequestOfferModal.jsx";

import styles from "./CustomerRequestsSection.module.css";

/* =========================================================
   HELPERS
========================================================= */

function getInitials(name = "") {
  const parts = String(name)
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
      month: "short",
    }
  ).format(date);
}

function formatDeadline(value) {
  if (!value) {
    return "Fără termen";
  }

  const date =
    new Date(value);

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return "Fără termen";
  }

  return new Intl.DateTimeFormat(
    "ro-RO",
    {
      day: "numeric",
      month: "long",
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
        currency || "RON",
      maximumFractionDigits: 2,
    }
  ).format(
    numeric / 100
  );
}

function formatBudget(request) {
  const {
    budgetMinCents,
    budgetMaxCents,
    budgetType,
    currency,
  } = request;

  const min =
    formatMoney(
      budgetMinCents,
      currency
    );

  const max =
    formatMoney(
      budgetMaxCents,
      currency
    );

  let text =
    "Buget flexibil";

  if (min && max) {
    if (
      budgetMinCents ===
      budgetMaxCents
    ) {
      text = max;
    } else {
      text =
        `${min} – ${max}`;
    }
  } else if (max) {
    text =
      `max. ${max}`;
  } else if (min) {
    text =
      `de la ${min}`;
  }

  if (
    text !==
      "Buget flexibil" &&
    budgetType ===
      "PER_ITEM"
  ) {
    text += " / buc.";
  }

  return text;
}

function getRequestImage(request) {
  if (
    !Array.isArray(
      request?.images
    )
  ) {
    return "";
  }

  return (
    request.images[0] ||
    ""
  );
}

/* =========================================================
   COMPONENT
========================================================= */

export default function CustomerRequestsSection() {
  const navigate =
    useNavigate();

  const {
    me,
  } =
    useAuth();

  const currentUserId =
    me?.id ||
    me?.sub ||
    null;

  const [
    requests,
    setRequests,
  ] =
    useState([]);

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

  /* =======================================================
     CREATE / EDIT MODAL
  ======================================================= */

  const [
    createModalOpen,
    setCreateModalOpen,
  ] =
    useState(false);

  const [
    createMode,
    setCreateMode,
  ] =
    useState("manual");

  const [
    editingRequest,
    setEditingRequest,
  ] =
    useState(null);

  const [
    modalKey,
    setModalKey,
  ] =
    useState(0);

  /* =======================================================
     OFFER MODAL
  ======================================================= */

  const [
    offerRequest,
    setOfferRequest,
  ] =
    useState(null);

  const [
    offerModalKey,
    setOfferModalKey,
  ] =
    useState(0);

  /* =======================================================
     MENU •••
  ======================================================= */

  const [
    openMenuId,
    setOpenMenuId,
  ] =
    useState(null);

  const [
    deletingId,
    setDeletingId,
  ] =
    useState(null);

  /* =======================================================
     LOAD
  ======================================================= */

  const loadRequests =
    useCallback(
      async ({
        showLoading = true,
      } = {}) => {
        try {
          if (showLoading) {
            setLoading(true);
          }

          setError("");

          const response =
            await fetch(
              "/api/customer-requests?limit=3",
              {
                method:
                  "GET",

                credentials:
                  "include",

                headers: {
                  Accept:
                    "application/json",
                },
              }
            );

          const data =
            await response
              .json()
              .catch(
                () => null
              );

          if (!response.ok) {
            throw new Error(
              data?.message ||
                "Cererile nu au putut fi încărcate."
            );
          }

          setRequests(
            Array.isArray(
              data?.items
            )
              ? data.items
              : []
          );
        } catch (err) {
          console.error(
            "[CustomerRequestsSection] load failed:",
            err
          );

          setError(
            err?.message ||
              "Cererile nu au putut fi încărcate."
          );
        } finally {
          if (showLoading) {
            setLoading(false);
          }
        }
      },
      []
    );

  useEffect(() => {
    loadRequests();
  }, [
    loadRequests,
  ]);
/* =========================================================
   DESCHIDE CEREREA DUPĂ AUTENTIFICARE
========================================================= */

useEffect(() => {
  if (!me) {
    return;
  }

  const params =
    new URLSearchParams(
      window.location.search
    );

  const action =
    params.get(
      "action"
    );

  if (
    action !==
    "create-customer-request"
  ) {
    return;
  }

  const mode =
    params.get(
      "mode"
    ) === "ai"
      ? "ai"
      : "manual";

  /*
   * Curățăm parametrii din URL ca modalul
   * să nu se redeschidă ulterior.
   */
  params.delete(
    "action"
  );

  params.delete(
    "mode"
  );

  params.delete(
    "auth"
  );

  params.delete(
    "redirect"
  );

  const nextSearch =
    params.toString();

  /*
   * Rămânem pe homepage și revenim
   * la secțiunea cererilor.
   */
  navigate(
    {
      pathname:
        window.location.pathname,

      search:
        nextSearch
          ? `?${nextSearch}`
          : "",

      hash:
        "#cereri-clienti",
    },
    {
      replace: true,
    }
  );

  /*
   * Deschidem formularul pe care
   * utilizatorul voia să îl folosească
   * înainte de autentificare.
   */
  setEditingRequest(
    null
  );

  setCreateMode(
    mode
  );

  setModalKey(
    (current) =>
      current + 1
  );

  setCreateModalOpen(
    true
  );
}, [
  me,
  navigate,
]);
  /* =======================================================
     CLOSE MENU ON OUTSIDE CLICK
  ======================================================= */

  useEffect(() => {
    if (!openMenuId) {
      return;
    }

    function closeMenu() {
      setOpenMenuId(null);
    }

    document.addEventListener(
      "click",
      closeMenu
    );

    return () => {
      document.removeEventListener(
        "click",
        closeMenu
      );
    };
  }, [
    openMenuId,
  ]);

  /* =======================================================
     UI REQUESTS
  ======================================================= */

  const visibleRequests =
    useMemo(
      () =>
        requests.map(
          (request) => ({
            ...request,

            authorName:
              request.user
                ?.name ||
              "Client Artfest",

            authorAvatar:
              request.user
                ?.avatarUrl ||
              "",

            createdLabel:
              formatRelativeDate(
                request.createdAt
              ),

            budget:
              formatBudget(
                request
              ),

            deadline:
              formatDeadline(
                request
                  .deliveryDeadline
              ),

            image:
              getRequestImage(
                request
              ),
          })
        ),
      [
        requests,
      ]
    );

  /* =======================================================
     OWNERSHIP
  ======================================================= */

  function isOwnRequest(
    request
  ) {
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
  }

  /* =======================================================
     OPEN CREATE
  ======================================================= */

 function openCreateModal(
  mode = "manual"
) {
  if (!me) {
    /*
     * Unde vrem să ajungă DUPĂ login.
     *
     * Rămâne pe pagina curentă și păstrăm
     * intenția de a crea cererea.
     */
    const afterLoginParams =
      new URLSearchParams();

    afterLoginParams.set(
      "action",
      "create-customer-request"
    );

    afterLoginParams.set(
      "mode",
      mode
    );

    const redirectTo =
      `${window.location.pathname}?${afterLoginParams.toString()}#cereri-clienti`;

    /*
     * Query-ul folosit ACUM ca Navbar-ul
     * să deschidă modalul de autentificare.
     */
    const params =
      new URLSearchParams(
        window.location.search
      );

    params.set(
      "auth",
      "login"
    );

    params.set(
      "redirect",
      redirectTo
    );

    navigate(
      {
        pathname:
          window.location.pathname,

        search:
          `?${params.toString()}`,

        hash:
          "#cereri-clienti",
      }
    );

    return;
  }

  setEditingRequest(
    null
  );

  setCreateMode(
    mode
  );

  setModalKey(
    (current) =>
      current + 1
  );

  setCreateModalOpen(
    true
  );
}

  function closeCreateModal() {
    setCreateModalOpen(
      false
    );

    setEditingRequest(
      null
    );
  }

  function handleCreateRequest() {
    openCreateModal(
      "manual"
    );
  }

  function handleCreateWithPhoto(
    event
  ) {
    event?.stopPropagation?.();

    openCreateModal(
      "manual"
    );
  }

  function handleCreateWithAi(
    event
  ) {
    event?.stopPropagation?.();

    openCreateModal(
      "ai"
    );
  }

  /* =======================================================
     EDIT
  ======================================================= */

  function handleEditRequest(
    request
  ) {
    if (
      !isOwnRequest(
        request
      )
    ) {
      return;
    }

    setOpenMenuId(
      null
    );

    setEditingRequest(
      request
    );

    setCreateMode(
      "manual"
    );

    setModalKey(
      (current) =>
        current + 1
    );

    setCreateModalOpen(
      true
    );
  }

  /* =======================================================
     DELETE
  ======================================================= */

  async function handleDeleteRequest(
    request
  ) {
    if (
      !isOwnRequest(
        request
      )
    ) {
      return;
    }

    setOpenMenuId(
      null
    );

    const confirmed =
      window.confirm(
        "Sigur vrei să ștergi această cerere?\n\nCererea nu va mai apărea pentru ceilalți utilizatori."
      );

    if (!confirmed) {
      return;
    }

    try {
      setDeletingId(
        request.id
      );

      await api(
        `/customer-requests/${request.id}`,
        {
          method:
            "DELETE",
        }
      );

      setRequests(
        (current) =>
          current.filter(
            (item) =>
              item.id !==
              request.id
          )
      );
    } catch (err) {
      console.error(
        "[CustomerRequestsSection] delete failed:",
        err
      );

      window.alert(
        err?.message ||
          "Cererea nu a putut fi ștearsă."
      );
    } finally {
      setDeletingId(
        null
      );
    }
  }

  /* =======================================================
     CREATED / UPDATED
  ======================================================= */

  async function handleRequestSaved(
    savedRequest
  ) {
    if (
      savedRequest?.id
    ) {
      setRequests(
        (current) => {
          const exists =
            current.some(
              (item) =>
                item.id ===
                savedRequest.id
            );

          if (exists) {
            return current.map(
              (item) =>
                item.id ===
                savedRequest.id
                  ? savedRequest
                  : item
            );
          }

          return [
            savedRequest,
            ...current,
          ].slice(
            0,
            3
          );
        }
      );
    }

    await loadRequests({
      showLoading:
        false,
    });
  }

  /* =======================================================
     NAVIGATION
  ======================================================= */

  function handleViewRequest(
    requestId
  ) {
    navigate(
      `/cereri/${requestId}`
    );
  }

  function handleSendOffer(
    request
  ) {
    if (
      me?.role !==
      "VENDOR"
    ) {
      return;
    }

    if (
      !request?.id
    ) {
      return;
    }

    if (
      isOwnRequest(
        request
      )
    ) {
      return;
    }

    if (
      request.status !==
      "OPEN"
    ) {
      return;
    }

    setOfferRequest(
      request
    );

    setOfferModalKey(
      (current) =>
        current + 1
    );
  }

  function closeOfferModal() {
    setOfferRequest(
      null
    );
  }

  function handleOfferSent(
    offer
  ) {
    const requestId =
      offer?.requestId ||
      offerRequest?.id;

    if (requestId) {
      setRequests(
        (current) =>
          current.map(
            (item) => {
              if (
                item.id !==
                requestId
              ) {
                return item;
              }

              return {
                ...item,

                offersCount:
                  Number(
                    item.offersCount ||
                      0
                  ) + 1,

                myOffer:
                  offer ||
                  true,
              };
            }
          )
      );
    }

    setOfferRequest(
      null
    );
  }

  function handleViewAllRequests() {
    navigate(
      "/cereri"
    );
  }

  /* =======================================================
     RENDER
  ======================================================= */

  return (
    <>
     <section
  id="cereri-clienti"
  className={
    styles.section
  }
>
        <div
          className={
            styles.container
          }
        >
          {/* COMPOSER */}

          <div
            className={
              styles.composerCard
            }
          >
            <div
              className={
                styles.composerTop
              }
            >
              <div
                className={
                  styles.composerAvatar
                }
              >
                ✨
              </div>

              <button
                type="button"
                className={
                  styles.composerInput
                }
                onClick={
                  handleCreateRequest
                }
              >
                <span
                  className={
                    styles.composerInputMain
                  }
                >
                  Ce cauți?
                </span>

                <span
                  className={
                    styles.composerInputSub
                  }
                >
                  Spune ce ai nevoie și primește oferte de la creatori.
                </span>
              </button>

              <button
                type="button"
                className={
                  styles.composerPhotoIcon
                }
                onClick={
                  handleCreateWithPhoto
                }
                aria-label="Adaugă fotografie"
              >
                📷
              </button>
            </div>

            <div
              className={
                styles.composerDivider
              }
            />

            <div
              className={
                styles.composerActions
              }
            >
              <button
                type="button"
                className={
                  styles.composerAction
                }
                onClick={
                  handleCreateWithPhoto
                }
              >
                <span
                  className={
                    styles.actionIcon
                  }
                >
                  📷
                </span>

                <span>
                  Fotografie
                </span>
              </button>

              <div
                className={
                  styles.actionSeparator
                }
              />

              <button
                type="button"
                className={
                  styles.composerAction
                }
                onClick={
                  handleCreateWithAi
                }
              >
                <span
                  className={
                    styles.actionIcon
                  }
                >
                  ✨
                </span>

                <span>
                  Ajută-mă cu AI
                </span>
              </button>
            </div>
          </div>

          {/* HEADER */}

          <div
            className={
              styles.feedHeader
            }
          >
            <div>
              <span
                className={
                  styles.feedEyebrow
                }
              >
                CERERI DE LA CLIENȚI
              </span>

              <h2
                className={
                  styles.feedTitle
                }
              >
                Ce caută oamenii acum
              </h2>

              <p
                className={
                  styles.feedSubtitle
                }
              >
                Creatorii Artfest pot trimite oferte direct pentru aceste cereri.
              </p>
            </div>

            <button
              type="button"
              className={
                styles.viewAllButton
              }
              onClick={
                handleViewAllRequests
              }
            >
              Vezi toate cererile
              <span>
                →
              </span>
            </button>
          </div>

          {/* LOADING */}

          {loading && (
            <div
              style={{
                padding:
                  "24px 0",
                textAlign:
                  "center",
                color:
                  "var(--color-muted)",
              }}
            >
              Se încarcă cererile...
            </div>
          )}

          {/* ERROR */}

          {!loading &&
            error && (
              <div
                style={{
                  padding:
                    "20px",
                  textAlign:
                    "center",
                  color:
                    "var(--color-muted)",
                }}
              >
                {error}
              </div>
            )}

          {/* EMPTY */}

          {!loading &&
            !error &&
            visibleRequests.length ===
              0 && (
              <div
                style={{
                  padding:
                    "30px 20px",
                  textAlign:
                    "center",
                }}
              >
                <div
                  style={{
                    fontSize:
                      "28px",
                  }}
                >
                  ✨
                </div>

                <strong>
                  Fii primul care publică o cerere
                </strong>

                <p>
                  Spune ce cauți și creatorii Artfest îți pot trimite oferte.
                </p>

                <button
                  type="button"
                  onClick={
                    handleCreateRequest
                  }
                >
                  Publică prima cerere
                </button>
              </div>
            )}

          {/* FEED */}

          {!loading &&
            !error &&
            visibleRequests.length >
              0 && (
              <div
                className={
                  styles.feed
                }
              >
                {visibleRequests.map(
                  (request) => {
                    const ownRequest =
                      isOwnRequest(
                        request
                      );

                    const menuOpen =
                      openMenuId ===
                      request.id;

                    const canSendOffer =
                      Boolean(
                        me?.role ===
                          "VENDOR" &&
                        !ownRequest &&
                        request.status ===
                          "OPEN"
                      );

                    return (
                      <article
                        key={
                          request.id
                        }
                        className={
                          styles.postCard
                        }
                      >
                        {/* HEADER */}

                        <div
                          className={
                            styles.postHeader
                          }
                        >
                          <div
                            className={
                              styles.authorArea
                            }
                          >
                            {request.authorAvatar ? (
                              <img
                                src={
                                  request.authorAvatar
                                }
                                alt=""
                                className={
                                  styles.authorAvatar
                                }
                              />
                            ) : (
                              <div
                                className={
                                  styles.authorFallback
                                }
                              >
                                {getInitials(
                                  request.authorName
                                )}
                              </div>
                            )}

                            <div
                              className={
                                styles.authorMeta
                              }
                            >
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
                                  {
                                    request.authorName
                                  }
                                </strong>

                                {request.status ===
                                  "OPEN" && (
                                  <span
                                    className={
                                      styles.openDot
                                    }
                                    title="Cerere deschisă"
                                  />
                                )}
                              </div>

                              <div
                                className={
                                  styles.postTime
                                }
                              >
                                {
                                  request.createdLabel
                                }

                                <span>
                                  ·
                                </span>

                                <span>
                                  🌐
                                </span>
                              </div>
                            </div>
                          </div>

                          {/* OWN MENU */}

                          {ownRequest && (
                            <div
                              className={
                                styles.moreMenuWrap
                              }
                              onClick={(
                                event
                              ) =>
                                event.stopPropagation()
                              }
                            >
                              <button
                                type="button"
                                className={
                                  styles.moreButton
                                }
                                onClick={(
                                  event
                                ) => {
                                  event.stopPropagation();

                                  setOpenMenuId(
                                    (
                                      current
                                    ) =>
                                      current ===
                                      request.id
                                        ? null
                                        : request.id
                                  );
                                }}
                                aria-label="Mai multe opțiuni"
                                aria-expanded={
                                  menuOpen
                                }
                              >
                                •••
                              </button>

                              {menuOpen && (
                                <div
                                  className={
                                    styles.moreMenu
                                  }
                                >
                                  <button
                                    type="button"
                                    className={
                                      styles.moreMenuItem
                                    }
                                    onClick={() =>
                                      handleEditRequest(
                                        request
                                      )
                                    }
                                  >
                                    <span>
                                      ✏️
                                    </span>

                                    <span>
                                      Editează cererea
                                    </span>
                                  </button>

                                  <button
                                    type="button"
                                    className={`${styles.moreMenuItem} ${styles.moreMenuDanger}`}
                                    disabled={
                                      deletingId ===
                                      request.id
                                    }
                                    onClick={() =>
                                      handleDeleteRequest(
                                        request
                                      )
                                    }
                                  >
                                    <span>
                                      🗑️
                                    </span>

                                    <span>
                                      {deletingId ===
                                      request.id
                                        ? "Se șterge..."
                                        : "Șterge cererea"}
                                    </span>
                                  </button>
                                </div>
                              )}
                            </div>
                          )}
                        </div>

                        {/* CONTENT */}

                        <div
                          className={
                            styles.postContent
                          }
                        >
                          <h3
                            className={
                              styles.postTitle
                            }
                          >
                            {
                              request.title
                            }
                          </h3>

                          <p
                            className={
                              styles.postDescription
                            }
                          >
                            {
                              request.description
                            }
                          </p>
                        </div>

                        {/* IMAGE */}

                        {request.image && (
                          <button
                            type="button"
                            className={
                              styles.postImageButton
                            }
                            onClick={() =>
                              handleViewRequest(
                                request.id
                              )
                            }
                          >
                            <img
                              src={
                                request.image
                              }
                              alt={
                                request.title ||
                                ""
                              }
                              className={
                                styles.postImage
                              }
                            />
                          </button>
                        )}

                        {/* DETAILS */}

                        <div
                          className={
                            styles.requestDetails
                          }
                        >
                          {request.quantity !=
                            null && (
                            <div
                              className={
                                styles.detailChip
                              }
                            >
                              📦{" "}
                              {
                                request.quantity
                              }{" "}
                              buc.
                            </div>
                          )}

                          <div
                            className={
                              styles.detailChip
                            }
                          >
                            💰{" "}
                            {
                              request.budget
                            }
                          </div>

                          <div
                            className={
                              styles.detailChip
                            }
                          >
                            📅{" "}
                            {
                              request.deadline
                            }
                          </div>

                          {request.city && (
                            <div
                              className={
                                styles.detailChip
                              }
                            >
                              📍{" "}
                              {
                                request.city
                              }
                            </div>
                          )}
                        </div>

                        {/* STATS */}

                        <div
                          className={
                            styles.postStats
                          }
                        >
                          <div
                            className={
                              styles.offerCount
                            }
                          >
                            <span
                              className={
                                styles.offerBubble
                              }
                            >
                              💜
                            </span>

                            <span>
                              {
                                request.offersCount ||
                                0
                              }{" "}
                              {(request.offersCount ||
                                0) ===
                              1
                                ? "ofertă primită"
                                : "oferte primite"}
                            </span>
                          </div>

                          <button
                            type="button"
                            className={
                              styles.commentsLike
                            }
                            onClick={() =>
                              handleViewRequest(
                                request.id
                              )
                            }
                          >
                            Vezi cererea
                          </button>
                        </div>

                        <div
                          className={
                            styles.postDivider
                          }
                        />

                        {/* ACTIONS */}

                        <div
                          className={
                            styles.postActions
                          }
                        >
                          {ownRequest ? (
                            <button
                              type="button"
                              className={
                                styles.postActionButton
                              }
                              onClick={() =>
                                handleEditRequest(
                                  request
                                )
                              }
                            >
                              <span>
                                ✏️
                              </span>

                              <span>
                                Editează
                              </span>
                            </button>
                          ) : canSendOffer ? (
                            <button
                              type="button"
                              className={
                                styles.postActionButton
                              }
                              onClick={() =>
                                handleSendOffer(
                                  request
                                )
                              }
                            >
                              <span>
                                💜
                              </span>

                              <span>
                                Trimite ofertă
                              </span>
                            </button>
                          ) : (
                            <button
                              type="button"
                              className={
                                styles.postActionButton
                              }
                              onClick={() =>
                                handleViewRequest(
                                  request.id
                                )
                              }
                            >
                              <span>
                                👀
                              </span>

                              <span>
                                Vezi cererea
                              </span>
                            </button>
                          )}

                          <button
                            type="button"
                            className={
                              styles.postActionButton
                            }
                            onClick={() =>
                              handleViewRequest(
                                request.id
                              )
                            }
                          >
                            <span>
                              💬
                            </span>

                            <span>
                              Vezi detalii
                            </span>
                          </button>
                        </div>
                      </article>
                    );
                  }
                )}
              </div>
            )}

          {!loading &&
            visibleRequests.length >
              0 && (
              <div
                className={
                  styles.moreRequestsWrap
                }
              >
                <button
                  type="button"
                  className={
                    styles.moreRequestsButton
                  }
                  onClick={
                    handleViewAllRequests
                  }
                >
                  Vezi mai multe cereri
                  <span>
                    →
                  </span>
                </button>
              </div>
            )}
        </div>
      </section>

      <CreateCustomerRequestModal
        key={
          modalKey
        }
        open={
          createModalOpen
        }
        initialMode={
          createMode
        }
        editingRequest={
          editingRequest
        }
        onClose={
          closeCreateModal
        }
        onCreated={
          handleRequestSaved
        }
        onUpdated={
          handleRequestSaved
        }
      />

      {offerRequest && (
        <CustomerRequestOfferModal
          key={
            offerModalKey
          }
          open={
            true
          }
          request={
            offerRequest
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