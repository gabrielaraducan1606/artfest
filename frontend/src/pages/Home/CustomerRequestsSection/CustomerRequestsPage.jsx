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
  api,
} from "../../../lib/api.js";

import {
  useAuth,
} from "../../Auth/Context/context.js";

import CreateCustomerRequestModal
  from "./CreateCustomerRequestModal.jsx";

import CustomerRequestOfferModal
  from "./CustomerRequestOfferModal.jsx";

import styles from "./CustomerRequestsPage.module.css";

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
      `max. ${max}`;
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

function getFirstImage(request) {
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

export default function CustomerRequestsPage() {
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

  const isVendor =
    me?.role ===
    "VENDOR";

  /* =======================================================
     REQUESTS
  ======================================================= */

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
    loadingMore,
    setLoadingMore,
  ] =
    useState(false);

  const [
    error,
    setError,
  ] =
    useState("");

  const [
    page,
    setPage,
  ] =
    useState(1);

  const [
    hasMore,
    setHasMore,
  ] =
    useState(false);

  const [
    total,
    setTotal,
  ] =
    useState(0);

  /* =======================================================
     FILTERS
  ======================================================= */

  const [
    category,
    setCategory,
  ] =
    useState("");

  const [
    city,
    setCity,
  ] =
    useState("");

  const [
    appliedCategory,
    setAppliedCategory,
  ] =
    useState("");

  const [
    appliedCity,
    setAppliedCity,
  ] =
    useState("");

  /* =======================================================
     CREATE / EDIT MODAL
  ======================================================= */

  const [
    modalOpen,
    setModalOpen,
  ] =
    useState(false);

  const [
    editingRequest,
    setEditingRequest,
  ] =
    useState(null);

  const [
    modalMode,
    setModalMode,
  ] =
    useState(
      "manual"
    );

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
     MENU
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
     LOAD REQUESTS
  ======================================================= */

  const loadRequests =
    useCallback(
      async ({
        nextPage = 1,
        append = false,
        showLoading = true,
      } = {}) => {
        try {
          if (
            showLoading
          ) {
            if (append) {
              setLoadingMore(
                true
              );
            } else {
              setLoading(
                true
              );
            }
          }

          setError("");

          const params =
            new URLSearchParams();

          params.set(
            "page",
            String(
              nextPage
            )
          );

          params.set(
            "limit",
            "12"
          );

          params.set(
            "status",
            "OPEN"
          );

          if (
            appliedCategory
          ) {
            params.set(
              "category",
              appliedCategory
            );
          }

          if (
            appliedCity
          ) {
            params.set(
              "city",
              appliedCity
            );
          }

          const result =
            await api(
              `/customer-requests?${params.toString()}`,
              {
                method:
                  "GET",
              }
            );

          const items =
            Array.isArray(
              result?.items
            )
              ? result.items
              : [];

          setRequests(
            (current) => {
              if (!append) {
                return items;
              }

              const existingIds =
                new Set(
                  current.map(
                    (item) =>
                      item.id
                  )
                );

              return [
                ...current,
                ...items.filter(
                  (item) =>
                    !existingIds.has(
                      item.id
                    )
                ),
              ];
            }
          );

          setPage(
            nextPage
          );

          setHasMore(
            Boolean(
              result
                ?.pagination
                ?.hasMore
            )
          );

          setTotal(
            Number(
              result
                ?.pagination
                ?.total ||
                0
            )
          );
        } catch (err) {
          console.error(
            "[CustomerRequestsPage] load failed:",
            err
          );

          setError(
            err?.message ||
              "Cererile nu au putut fi încărcate."
          );
        } finally {
          setLoading(
            false
          );

          setLoadingMore(
            false
          );
        }
      },
      [
        appliedCategory,
        appliedCity,
      ]
    );

  useEffect(() => {
    loadRequests({
      nextPage:
        1,

      append:
        false,
    });
  }, [
    loadRequests,
  ]);

  /* =======================================================
     CLOSE MENU ON OUTSIDE CLICK
  ======================================================= */

  useEffect(() => {
    if (
      !openMenuId
    ) {
      return;
    }

    function closeMenu() {
      setOpenMenuId(
        null
      );
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
   * Scoatem parametrii înainte,
   * ca modalul să nu se redeschidă
   * la fiecare rerender.
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

  const nextSearch =
    params.toString();

  navigate(
    {
      pathname:
        "/cereri",

      search:
        nextSearch
          ? `?${nextSearch}`
          : "",
    },
    {
      replace: true,
    }
  );

  setEditingRequest(
    null
  );

  setModalMode(
    mode
  );

  setModalKey(
    (current) =>
      current + 1
  );

  setModalOpen(
    true
  );
}, [
  me,
  navigate,
]);
  /* =======================================================
     NORMALIZED REQUESTS
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
                request
                  .createdAt
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
              getFirstImage(
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
     FILTERS
  ======================================================= */

  function handleApplyFilters(
    event
  ) {
    event.preventDefault();

    setAppliedCategory(
      category.trim()
    );

    setAppliedCity(
      city.trim()
    );
  }

  function handleClearFilters() {
    setCategory("");
    setCity("");

    setAppliedCategory(
      ""
    );

    setAppliedCity(
      ""
    );
  }

  /* =======================================================
     CREATE
  ======================================================= */

  function openCreateModal(
  mode = "manual"
) {
  /*
   * Guest:
   * nu deschidem formularul,
   * îl trimitem la autentificare.
   */
if (!me) {
  const params =
    new URLSearchParams();

  params.set(
    "auth",
    "login"
  );

  params.set(
    "action",
    "create-customer-request"
  );

  params.set(
    "mode",
    mode
  );

  navigate(
    `/cereri?${params.toString()}`
  );

  return;
}

  /*
   * User autentificat:
   * deschidem formularul normal.
   */
  setEditingRequest(
    null
  );

  setModalMode(
    mode
  );

  setModalKey(
    (current) =>
      current + 1
  );

  setModalOpen(
    true
  );
}

  function closeModal() {
    setModalOpen(
      false
    );

    setEditingRequest(
      null
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

    setModalMode(
      "manual"
    );

    setModalKey(
      (current) =>
        current + 1
    );

    setModalOpen(
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
        "Sigur vrei să ștergi această cerere?\n\nCererea nu va mai fi vizibilă pentru ceilalți utilizatori."
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

      setTotal(
        (current) =>
          Math.max(
            0,
            current - 1
          )
      );
    } catch (err) {
      console.error(
        "[CustomerRequestsPage] delete failed:",
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
     CREATE / EDIT SAVED
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
          ];
        }
      );
    }

    await loadRequests({
      nextPage:
        1,

      append:
        false,

      showLoading:
        false,
    });
  }

  /* =======================================================
     VIEW REQUEST
  ======================================================= */

  function handleViewRequest(
    requestId
  ) {
    navigate(
      `/cereri/${requestId}`
    );
  }

  /* =======================================================
     SEND OFFER

     IMPORTANT:
     Frontend-ul permite deschiderea modalului
     doar pentru VENDOR.

     Backend-ul verifică separat vendorul,
     deci aceasta nu este singura protecție.
  ======================================================= */

  function handleSendOffer(
    request
  ) {
    if (
      !isVendor
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

  /* =======================================================
     OFFER SENT
  ======================================================= */

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

                /*
                 * Marcăm local faptul că vendorul
                 * tocmai a trimis oferta.
                 *
                 * Mai târziu putem primi acest câmp
                 * direct din API.
                 */
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

  /* =======================================================
     LOAD MORE
  ======================================================= */

  function handleLoadMore() {
    if (
      loadingMore ||
      !hasMore
    ) {
      return;
    }

    loadRequests({
      nextPage:
        page + 1,

      append:
        true,
    });
  }

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
              HERO
          ================================================== */}

          <section
            className={
              styles.hero
            }
          >
            <div
              className={
                styles.heroContent
              }
            >
              <span
                className={
                  styles.eyebrow
                }
              >
                CERERI ARTFEST
              </span>

              <h1
                className={
                  styles.heroTitle
                }
              >
                Ce caută oamenii
              </h1>

              <p
                className={
                  styles.heroDescription
                }
              >
                Descoperă cererile publicate de clienți și, dacă ești creator, trimite o ofertă pentru ceea ce poți realiza.
              </p>
            </div>

            <button
              type="button"
              className={
                styles.createButton
              }
              onClick={() =>
                openCreateModal(
                  "manual"
                )
              }
            >
              <span>
                +
              </span>

              <span>
                Publică o cerere
              </span>
            </button>
          </section>

          {/* ==================================================
              COMPOSER
          ================================================== */}

          <section
            className={
              styles.composer
            }
          >
            <button
              type="button"
              className={
                styles.composerMain
              }
              onClick={() =>
                openCreateModal(
                  "manual"
                )
              }
            >
              <span
                className={
                  styles.composerSpark
                }
              >
                ✨
              </span>

              <span
                className={
                  styles.composerText
                }
              >
                <strong>
                  Ce cauți?
                </strong>

                <small>
                  Publică și primește oferte de la creatori.
                </small>
              </span>
            </button>

            <button
              type="button"
              className={
                styles.aiComposerButton
              }
              onClick={() =>
                openCreateModal(
                  "ai"
                )
              }
            >
              ✨ Ajută-mă cu AI
            </button>
          </section>

          {/* ==================================================
              FILTERS
          ================================================== */}

          <section
            className={
              styles.filtersCard
            }
          >
            <form
              className={
                styles.filtersForm
              }
              onSubmit={
                handleApplyFilters
              }
            >
              <div
                className={
                  styles.filterField
                }
              >
                <label>
                  Categorie
                </label>

                <input
                  type="text"
                  value={
                    category
                  }
                  onChange={(
                    event
                  ) =>
                    setCategory(
                      event.target
                        .value
                    )
                  }
                  placeholder="Ex: Mărturii"
                />
              </div>

              <div
                className={
                  styles.filterField
                }
              >
                <label>
                  Localitate
                </label>

                <input
                  type="text"
                  value={
                    city
                  }
                  onChange={(
                    event
                  ) =>
                    setCity(
                      event.target
                        .value
                    )
                  }
                  placeholder="Ex: București"
                />
              </div>

              <div
                className={
                  styles.filterActions
                }
              >
                <button
                  type="submit"
                  className={
                    styles.filterButton
                  }
                >
                  Filtrează
                </button>

                {(appliedCategory ||
                  appliedCity) && (
                  <button
                    type="button"
                    className={
                      styles.clearButton
                    }
                    onClick={
                      handleClearFilters
                    }
                  >
                    Resetează
                  </button>
                )}
              </div>
            </form>
          </section>

          {/* ==================================================
              LIST HEADER
          ================================================== */}

          <div
            className={
              styles.listHeader
            }
          >
            <div>
              <h2>
                Cereri deschise
              </h2>

              <p>
                {total === 1
                  ? "1 cerere disponibilă"
                  : `${total} cereri disponibile`}
              </p>
            </div>
          </div>

          {/* ==================================================
              LOADING
          ================================================== */}

          {loading && (
            <div
              className={
                styles.stateCard
              }
            >
              <div
                className={
                  styles.stateIcon
                }
              >
                ✨
              </div>

              <p>
                Se încarcă cererile...
              </p>
            </div>
          )}

          {/* ==================================================
              ERROR
          ================================================== */}

          {!loading &&
            error && (
              <div
                className={
                  styles.stateCard
                }
              >
                <div
                  className={
                    styles.stateIcon
                  }
                >
                  🤍
                </div>

                <strong>
                  Nu am putut încărca cererile
                </strong>

                <p>
                  {error}
                </p>

                <button
                  type="button"
                  className={
                    styles.filterButton
                  }
                  onClick={() =>
                    loadRequests({
                      nextPage:
                        1,

                      append:
                        false,
                    })
                  }
                >
                  Încearcă din nou
                </button>
              </div>
            )}

          {/* ==================================================
              EMPTY
          ================================================== */}

          {!loading &&
            !error &&
            visibleRequests.length ===
              0 && (
              <div
                className={
                  styles.stateCard
                }
              >
                <div
                  className={
                    styles.stateIcon
                  }
                >
                  ✨
                </div>

                <strong>
                  Nu am găsit cereri
                </strong>

                <p>
                  Poți modifica filtrele sau publica o cerere nouă.
                </p>

                <button
                  type="button"
                  className={
                    styles.createButton
                  }
                  onClick={() =>
                    openCreateModal(
                      "manual"
                    )
                  }
                >
                  Publică o cerere
                </button>
              </div>
            )}

          {/* ==================================================
              FEED
          ================================================== */}

          {!loading &&
            !error &&
            visibleRequests.length >
              0 && (
              <section
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

                    const canOffer =
                      Boolean(
                        isVendor &&
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
                          styles.card
                        }
                      >
                        {/* ================================
                            HEADER
                        ================================ */}

                        <div
                          className={
                            styles.cardHeader
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
                                <strong>
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
                                  />
                                )}
                              </div>

                              <div
                                className={
                                  styles.time
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

                          {ownRequest && (
                            <div
                              className={
                                styles.moreWrap
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
                                    onClick={() =>
                                      handleEditRequest(
                                        request
                                      )
                                    }
                                  >
                                    ✏️ Editează cererea
                                  </button>

                                  <button
                                    type="button"
                                    className={
                                      styles.deleteMenuItem
                                    }
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
                                    🗑️{" "}
                                    {deletingId ===
                                    request.id
                                      ? "Se șterge..."
                                      : "Șterge cererea"}
                                  </button>
                                </div>
                              )}
                            </div>
                          )}
                        </div>

                        {/* ================================
                            CONTENT
                        ================================ */}

                        <button
                          type="button"
                          className={
                            styles.contentButton
                          }
                          onClick={() =>
                            handleViewRequest(
                              request.id
                            )
                          }
                        >
                          <div
                            className={
                              styles.content
                            }
                          >
                            <h3>
                              {
                                request.title
                              }
                            </h3>

                            <p>
                              {
                                request.description
                              }
                            </p>
                          </div>

                          {request.image && (
                            <div
                              className={
                                styles.imageWrap
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
                              />
                            </div>
                          )}
                        </button>

                        {/* ================================
                            DETAILS
                        ================================ */}

                        <div
                          className={
                            styles.details
                          }
                        >
                          {request.quantity !=
                            null && (
                            <span>
                              📦{" "}
                              {
                                request.quantity
                              }{" "}
                              buc.
                            </span>
                          )}

                          <span>
                            💰{" "}
                            {
                              request.budget
                            }
                          </span>

                          <span>
                            📅{" "}
                            {
                              request.deadline
                            }
                          </span>

                          {request.city && (
                            <span>
                              📍{" "}
                              {
                                request.city
                              }
                            </span>
                          )}
                        </div>

                        {/* ================================
                            STATS
                        ================================ */}

                        <div
                          className={
                            styles.stats
                          }
                        >
                          <span>
                            💜{" "}
                            {
                              request.offersCount ||
                              0
                            }{" "}
                            {(request.offersCount ||
                              0) ===
                            1
                              ? "ofertă"
                              : "oferte"}
                          </span>

                          <button
                            type="button"
                            onClick={() =>
                              handleViewRequest(
                                request.id
                              )
                            }
                          >
                            Vezi detalii
                          </button>
                        </div>

                        {/* ================================
                            ACTIONS
                        ================================ */}

                        <div
                          className={
                            styles.actions
                          }
                        >
                          {ownRequest ? (
                            <button
                              type="button"
                              onClick={() =>
                                handleEditRequest(
                                  request
                                )
                              }
                            >
                              ✏️ Editează
                            </button>
                          ) : canOffer ? (
                            <button
                              type="button"
                              onClick={() =>
                                handleSendOffer(
                                  request
                                )
                              }
                            >
                              💜 Trimite ofertă
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() =>
                                handleViewRequest(
                                  request.id
                                )
                              }
                            >
                              👀 Vezi detalii
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() =>
                              handleViewRequest(
                                request.id
                              )
                            }
                          >
                            💬 Vezi cererea
                          </button>
                        </div>
                      </article>
                    );
                  }
                )}
              </section>
            )}

          {/* ==================================================
              LOAD MORE
          ================================================== */}

          {!loading &&
            !error &&
            visibleRequests.length >
              0 &&
            hasMore && (
              <div
                className={
                  styles.loadMoreWrap
                }
              >
                <button
                  type="button"
                  className={
                    styles.loadMoreButton
                  }
                  disabled={
                    loadingMore
                  }
                  onClick={
                    handleLoadMore
                  }
                >
                  {loadingMore
                    ? "Se încarcă..."
                    : "Vezi mai multe cereri"}
                </button>
              </div>
            )}
        </div>
      </main>

      {/* ====================================================
          CREATE / EDIT MODAL
      ==================================================== */}

      <CreateCustomerRequestModal
        key={
          modalKey
        }
        open={
          modalOpen
        }
        initialMode={
          modalMode
        }
        editingRequest={
          editingRequest
        }
        onClose={
          closeModal
        }
        onCreated={
          handleRequestSaved
        }
        onUpdated={
          handleRequestSaved
        }
      />

      {/* ====================================================
          OFFER MODAL

          Se montează doar când avem o cerere selectată.
      ==================================================== */}

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