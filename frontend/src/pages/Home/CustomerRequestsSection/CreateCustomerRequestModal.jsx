import React, {
  useMemo,
  useState,
} from "react";

import {
  api,
} from "../../../lib/api";

import {
  CATEGORIES_DETAILED,
  CATEGORY_LABELS,
  CATEGORY_SET,
} from "../../../constants/productscategories.js";

import styles from "./CreateCustomerRequestModal.module.css";

/* =========================================================
   HELPERS
========================================================= */

function centsToLei(value) {
  if (
    value === null ||
    value === undefined
  ) {
    return "";
  }

  const number =
    Number(value);

  if (
    !Number.isFinite(number)
  ) {
    return "";
  }

  return String(
    number / 100
  );
}

function dateToInput(value) {
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

  return date
    .toISOString()
    .slice(0, 10);
}

function createInitialForm(
  editingRequest
) {
  if (!editingRequest) {
    return {
      title: "",
      description: "",
      category: "",
      quantity: "",
      budgetType:
        "PER_ITEM",
      budgetMin: "",
      budgetMax: "",
      deliveryDeadline:
        "",
      city: "",
      images: [],
    };
  }

  return {
    title:
      editingRequest.title ||
      "",

    description:
      editingRequest.description ||
      "",

    category:
      editingRequest.category ||
      "",

    quantity:
      editingRequest.quantity !=
      null
        ? String(
            editingRequest.quantity
          )
        : "",

    budgetType:
      editingRequest.budgetType ||
      "PER_ITEM",

    budgetMin:
      centsToLei(
        editingRequest
          .budgetMinCents
      ),

    budgetMax:
      centsToLei(
        editingRequest
          .budgetMaxCents
      ),

    deliveryDeadline:
      dateToInput(
        editingRequest
          .deliveryDeadline
      ),

    city:
      editingRequest.city ||
      "",

    images:
      Array.isArray(
        editingRequest.images
      )
        ? editingRequest.images.map(
            (url, index) => ({
              id:
                `existing-${index}-${url}`,

              url,

              preview:
                url,

              existing:
                true,

              file:
                null,

              moderated:
                true,
            })
          )
        : [],
  };
}

function toCents(value) {
  if (
    value === "" ||
    value === null ||
    value === undefined
  ) {
    return null;
  }

  const number =
    Number(
      String(value)
        .replace(
          ",",
          "."
        )
    );

  if (
    !Number.isFinite(number) ||
    number < 0
  ) {
    return null;
  }

  return Math.round(
    number * 100
  );
}

function fileToDataUrl(file) {
  return new Promise(
    (
      resolve,
      reject
    ) => {
      const reader =
        new FileReader();

      reader.onload = () => {
        resolve(
          String(
            reader.result ||
              ""
          )
        );
      };

      reader.onerror = () => {
        reject(
          new Error(
            "Imaginea nu a putut fi citită."
          )
        );
      };

      reader.readAsDataURL(
        file
      );
    }
  );
}

/* =========================================================
   UPLOAD REAL IMAGINE
========================================================= */

async function uploadCustomerRequestImage(
  file
) {
  const formData =
    new FormData();

  formData.append(
    "file",
    file
  );

  const result =
    await api(
      "/api/upload",
      {
        method:
          "POST",

        body:
          formData,
      }
    );

  const url =
    result?.url;

  if (!url) {
    throw new Error(
      "Serverul nu a returnat URL-ul imaginii."
    );
  }

  return url;
}

function normalizeCategorySearch(
  value
) {
  return String(
    value || ""
  )
    .normalize("NFD")
    .replace(
      /[\u0300-\u036f]/g,
      ""
    )
    .toLowerCase()
    .trim();
}

function getCategoryDisplayValue(
  category
) {
  const key =
    String(
      category || ""
    ).trim();

  if (!key) {
    return "";
  }

  return (
    CATEGORY_LABELS[key] ||
    key
  );
}

function resolveCategoryValue({
  storedValue,
  typedValue,
}) {
  const stored =
    String(
      storedValue || ""
    ).trim();

  const typed =
    String(
      typedValue || ""
    ).trim();

  /*
   * Dacă avem deja un slug valid selectat
   * din sugestii sau venit de la AI, îl păstrăm.
   */
  if (
    stored &&
    CATEGORY_SET.has(
      stored
    )
  ) {
    return stored;
  }

  /*
   * Dacă utilizatorul a scris exact denumirea
   * unei categorii, o transformăm în slug.
   */
  const normalizedTyped =
    normalizeCategorySearch(
      typed
    );

  const exactMatch =
    CATEGORIES_DETAILED.find(
      (item) =>
        normalizeCategorySearch(
          item.label
        ) ===
        normalizedTyped ||
        normalizeCategorySearch(
          item.key
        ) ===
        normalizedTyped
    );

  if (exactMatch) {
    return exactMatch.key;
  }

  /*
   * Dacă nu există potrivire exactă,
   * permitem text liber, așa cum ai cerut.
   */
  return (
    typed ||
    stored ||
    ""
  );
}

/* =========================================================
   COMPONENT
========================================================= */

export default function CreateCustomerRequestModal({
  open,
  onClose,
  onCreated,
  onUpdated,
  initialMode = "manual",
  editingRequest = null,
}) {
  const isEditing =
    Boolean(
      editingRequest?.id
    );

  const [
    form,
    setForm,
  ] =
    useState(() =>
      createInitialForm(
        editingRequest
      )
    );

  const [
    categoryQuery,
    setCategoryQuery,
  ] =
    useState(() =>
      getCategoryDisplayValue(
        editingRequest?.category
      )
    );

  const [
    categoryOpen,
    setCategoryOpen,
  ] =
    useState(false);

  const [
    submitting,
    setSubmitting,
  ] =
    useState(false);

  const [
    error,
    setError,
  ] =
    useState("");

  const [
    aiMode,
    setAiMode,
  ] =
    useState(
      !isEditing &&
      initialMode ===
        "ai"
    );

  const [
    aiText,
    setAiText,
  ] =
    useState("");

  const [
    aiLoading,
    setAiLoading,
  ] =
    useState(false);

  const [
    imageChecking,
    setImageChecking,
  ] =
    useState(false);

  const [
    aiQuestions,
    setAiQuestions,
  ] =
    useState([]);

  const canSubmit =
    useMemo(() => {
      return (
        form.title
          .trim()
          .length >= 5 &&
        form.description
          .trim()
          .length >= 10 &&
        !submitting &&
        !aiLoading &&
        !imageChecking
      );
    }, [
      form.title,
      form.description,
      submitting,
      aiLoading,
      imageChecking,
    ]);

  const categorySuggestions =
    useMemo(() => {
      const query =
        normalizeCategorySearch(
          categoryQuery
        );

      const items =
        Array.isArray(
          CATEGORIES_DETAILED
        )
          ? CATEGORIES_DETAILED
          : [];

      if (!query) {
        return items.slice(
          0,
          10
        );
      }

      return items
        .filter(
          (item) => {
            const label =
              normalizeCategorySearch(
                item?.label
              );

            const key =
              normalizeCategorySearch(
                item?.key
              );

            const group =
              normalizeCategorySearch(
                item?.groupLabel
              );

            return (
              label.includes(
                query
              ) ||
              key.includes(
                query
              ) ||
              group.includes(
                query
              )
            );
          }
        )
        .slice(
          0,
          10
        );
    }, [
      categoryQuery,
    ]);

  if (!open) {
    return null;
  }

  /* =========================================================
     FORM
  ========================================================= */

  function updateField(
    field,
    value
  ) {
    setForm(
      (current) => ({
        ...current,

        [field]: value,
      })
    );
  }

  /* =========================================================
     CLOSE
  ========================================================= */

  function handleBackdrop(
    event
  ) {
    if (
      event.target ===
        event.currentTarget &&
      !submitting &&
      !aiLoading &&
      !imageChecking
    ) {
      onClose?.();
    }
  }

  function handleClose() {
    if (
      submitting ||
      aiLoading ||
      imageChecking
    ) {
      return;
    }

    onClose?.();
  }

  /* =========================================================
     IMAGES
  ========================================================= */

  async function handleImageFiles(
    event
  ) {
    const input =
      event.target;

    const files =
      Array.from(
        input.files || []
      );

    input.value = "";

    if (!files.length) {
      return;
    }

    if (imageChecking) {
      return;
    }

    const remaining =
      Math.max(
        0,
        10 -
          form.images.length
      );

    if (!remaining) {
      setError(
        "Poți adăuga maximum 10 fotografii."
      );

      return;
    }

    const selectedFiles =
      files.slice(
        0,
        remaining
      );

    try {
      setImageChecking(
        true
      );

      setError("");

      const acceptedImages =
        [];

      let blockedCount =
        0;

      let technicalError =
        false;

      for (
        const file of
        selectedFiles
      ) {
        /* =========================
           TIP FIȘIER
        ========================= */

        if (
          !String(
            file.type ||
              ""
          ).startsWith(
            "image/"
          )
        ) {
          continue;
        }

        /* =========================
           DIMENSIUNE
        ========================= */

        const MAX_IMAGE_SIZE =
          10 *
          1024 *
          1024;

        if (
          file.size >
          MAX_IMAGE_SIZE
        ) {
          setError(
            `Imaginea "${file.name}" este prea mare. Dimensiunea maximă este 10 MB.`
          );

          continue;
        }

        /* =========================
           DATA URL
        ========================= */

        let dataUrl;

        try {
          dataUrl =
            await fileToDataUrl(
              file
            );
        } catch (readError) {
          console.error(
            "[CreateCustomerRequestModal] image read failed:",
            readError
          );

          technicalError =
            true;

          continue;
        }

        /* =========================
           MODERARE
        ========================= */

        try {
          const moderation =
            await api(
              "/customer-requests/moderate-image",
              {
                method:
                  "POST",

                body: {
                  image:
                    dataUrl,
                },
              }
            );

          if (
            moderation?.allowed ===
            false
          ) {
            blockedCount +=
              1;

            continue;
          }

          /* =========================
             UPLOAD REAL
          ========================= */

          const uploadedUrl =
            await uploadCustomerRequestImage(
              file
            );

          acceptedImages.push({
            id:
              `${file.name}-${file.lastModified}-${Math.random()}`,

            name:
              file.name,

            file:
              null,

            url:
              uploadedUrl,

            preview:
              uploadedUrl,

            existing:
              true,

            moderated:
              true,
          });
        } catch (
          processingError
        ) {
          console.error(
            "[CreateCustomerRequestModal] image processing failed:",
            processingError
          );

          const moderationCode =
            processingError?.code ||
            processingError?.error ||
            processingError
              ?.data?.error ||
            processingError
              ?.body?.error ||
            "";

          const moderationStatus =
            processingError?.status ||
            processingError
              ?.statusCode ||
            processingError
              ?.response
              ?.status ||
            null;

          const errorMessage =
            String(
              processingError
                ?.message ||
                ""
            )
              .toLowerCase();

          if (
            moderationStatus ===
              422 ||
            moderationCode ===
              "phone_number_in_image" ||
            errorMessage.includes(
              "număr de telefon"
            )
          ) {
            blockedCount +=
              1;

            continue;
          }

          technicalError =
            true;
        }
      }

      /* =========================
         ACCEPTATE
      ========================= */

      if (
        acceptedImages.length
      ) {
        setForm(
          (current) => ({
            ...current,

            images: [
              ...current.images,
              ...acceptedImages,
            ].slice(
              0,
              10
            ),
          })
        );
      }

      /* =========================
         TELEFON
      ========================= */

      if (
        blockedCount > 0
      ) {
        setError(
          blockedCount ===
            1
            ? "O imagine nu a fost adăugată deoarece pare să conțină un număr de telefon. Încarcă o variantă fără date de contact."
            : `${blockedCount} imagini nu au fost adăugate deoarece par să conțină numere de telefon. Încarcă variante fără date de contact.`
        );

        return;
      }

      /* =========================
         EROARE TEHNICĂ
      ========================= */

      if (
        technicalError
      ) {
        setError(
          "Una dintre imagini nu a putut fi verificată sau încărcată. Încearcă din nou."
        );
      }
    } finally {
      setImageChecking(
        false
      );
    }
  }

  /* =========================================================
     REMOVE IMAGE
  ========================================================= */

  function removeImage(
    imageId
  ) {
    setForm(
      (current) => ({
        ...current,

        images:
          current.images.filter(
            (item) =>
              item.id !==
              imageId
          ),
      })
    );
  }

  /* =========================================================
     AI
  ========================================================= */

  async function handleAiAssist() {
    const text =
      aiText.trim();

    if (!text) {
      setError(
        "Scrie pe scurt ce cauți."
      );

      return;
    }

    if (aiLoading) {
      return;
    }

    try {
      setAiLoading(
        true
      );

      setError("");

      setAiQuestions(
        []
      );

      const result =
        await api(
          "/customer-requests/analyze",
          {
            method:
              "POST",

            body: {
              message:
                text,
            },
          }
        );

      const aiCategory =
        result?.category ||
        "";

      if (aiCategory) {
        setCategoryQuery(
          getCategoryDisplayValue(
            aiCategory
          )
        );
      }

      setForm(
        (current) => ({
          ...current,

          title:
            result?.title ||
            current.title,

          description:
            result?.description ||
            current.description,

          category:
            result?.category ||
            current.category,

          quantity:
            result?.quantity !=
            null
              ? String(
                  result.quantity
                )
              : current.quantity,

          budgetMin:
            result?.budgetMin !=
            null
              ? String(
                  result.budgetMin
                )
              : current.budgetMin,

          budgetMax:
            result?.budgetMax !=
            null
              ? String(
                  result.budgetMax
                )
              : current.budgetMax,

          budgetType:
            result?.budgetType ===
              "TOTAL" ||
            result?.budgetType ===
              "PER_ITEM"
              ? result.budgetType
              : current.budgetType,

          deliveryDeadline:
            result?.deliveryDeadline ||
            current
              .deliveryDeadline,

          city:
            result?.city ||
            current.city,
        })
      );

      setAiQuestions(
        Array.isArray(
          result?.questions
        )
          ? result.questions
          : []
      );

      setAiMode(
        false
      );
    } catch (err) {
      console.error(
        "[CreateCustomerRequestModal] AI failed:",
        err
      );

      setError(
        err?.message ||
          "Nu am putut pregăti cererea cu AI."
      );
    } finally {
      setAiLoading(
        false
      );
    }
  }

  /* =========================================================
     SUBMIT
  ========================================================= */

  async function handleSubmit(
    event
  ) {
    event.preventDefault();

    if (
      submitting ||
      aiLoading ||
      imageChecking
    ) {
      return;
    }

    const title =
      form.title.trim();

    const description =
      form.description.trim();

    /* =========================
       TITLE
    ========================= */

    if (
      title.length <
      5
    ) {
      setError(
        "Spune pe scurt ce cauți."
      );

      return;
    }

    /* =========================
       DESCRIPTION
    ========================= */

    if (
      description.length <
      10
    ) {
      setError(
        "Adaugă câteva detalii despre ce cauți."
      );

      return;
    }

    /* =========================
       QUANTITY
    ========================= */

    const quantity =
      form.quantity ===
      ""
        ? null
        : Number(
            form.quantity
          );

    if (
      quantity !== null &&
      (
        !Number.isInteger(
          quantity
        ) ||
        quantity < 1
      )
    ) {
      setError(
        "Cantitatea trebuie să fie mai mare decât 0."
      );

      return;
    }

    /* =========================
       BUDGET
    ========================= */

    const budgetMinCents =
      toCents(
        form.budgetMin
      );

    const budgetMaxCents =
      toCents(
        form.budgetMax
      );

    if (
      budgetMinCents !==
        null &&
      budgetMaxCents !==
        null &&
      budgetMinCents >
        budgetMaxCents
    ) {
      setError(
        "Bugetul minim nu poate fi mai mare decât bugetul maxim."
      );

      return;
    }

    /* =========================
       CONFIRMARE FĂRĂ POZĂ
    ========================= */

    if (
      form.images.length ===
      0
    ) {
      const confirmed =
        window.confirm(
          isEditing
            ? "Cererea nu mai are nicio fotografie.\n\nO fotografie îi poate ajuta pe creatori să înțeleagă mai bine ce cauți.\n\nVrei să salvezi totuși cererea fără fotografie?"
            : "Nu ai adăugat nicio fotografie.\n\nO fotografie îi poate ajuta pe creatori să înțeleagă mai bine ce cauți.\n\nVrei să publici totuși cererea fără fotografie?"
        );

      if (!confirmed) {
        return;
      }
    }

    /* =========================
       IMAGES
    ========================= */

    const imageUrls =
      form.images
        .map(
          (image) =>
            image.url
        )
        .filter(Boolean)
        .slice(
          0,
          10
        );

    /* =========================
       CATEGORY
    ========================= */

    const category =
      resolveCategoryValue({
        storedValue:
          form.category,

        typedValue:
          categoryQuery,
      });

    /* =========================
       PAYLOAD
    ========================= */

    const payload = {
      title,

      description,

      category:
        category ||
        null,

      quantity,

      budgetMinCents,

      budgetMaxCents,

      budgetType:
        budgetMinCents !==
          null ||
        budgetMaxCents !==
          null
          ? form.budgetType
          : null,

      currency:
        "RON",

      deliveryDeadline:
        form.deliveryDeadline ||
        null,

      city:
        form.city
          .trim() ||
        null,

      images:
        imageUrls,
    };

    try {
      setSubmitting(
        true
      );

      setError("");

      let saved;

      /* =========================
         EDIT
      ========================= */

      if (isEditing) {
        const result =
          await api(
            `/customer-requests/${editingRequest.id}`,
            {
              method:
                "PATCH",

              body:
                payload,
            }
          );

        saved =
          result?.request ||
          null;

        onUpdated?.(
          saved
        );
      }

      /* =========================
         CREATE
      ========================= */

      else {
        const result =
          await api(
            "/customer-requests",
            {
              method:
                "POST",

              body:
                payload,
            }
          );

        saved =
          result?.request ||
          null;

        onCreated?.(
          saved
        );
      }

      onClose?.();
    } catch (err) {
      console.error(
        isEditing
          ? "[CreateCustomerRequestModal] update failed:"
          : "[CreateCustomerRequestModal] create failed:",
        err
      );

      setError(
        err?.message ||
          (
            isEditing
              ? "Modificările nu au putut fi salvate."
              : "Cererea nu a putut fi publicată."
          )
      );
    } finally {
      setSubmitting(
        false
      );
    }
  }

  /* =========================================================
     RENDER
  ========================================================= */

  return (
    <div
      className={
        styles.backdrop
      }
      onMouseDown={
        handleBackdrop
      }
    >
      <div
        className={
          styles.modal
        }
        role="dialog"
        aria-modal="true"
        aria-label={
          isEditing
            ? "Editează cererea"
            : "Publică o cerere"
        }
      >
        {/* ==================================================
            HEADER
        ================================================== */}

        <div
          className={
            styles.header
          }
        >
          <div>
            <span
              className={
                styles.eyebrow
              }
            >
              ARTFEST
            </span>

            <h2
              className={
                styles.title
              }
            >
              {isEditing
                ? "Editează cererea"
                : "Publică ce cauți"}
            </h2>

            <p
              className={
                styles.subtitle
              }
            >
              {isEditing
                ? "Actualizează informațiile cererii tale."
                : "Creatorii îți pot trimite oferte direct în Artfest."}
            </p>
          </div>

          <button
            type="button"
            className={
              styles.closeButton
            }
            onClick={
              handleClose
            }
            disabled={
              submitting ||
              aiLoading ||
              imageChecking
            }
            aria-label="Închide"
          >
            ×
          </button>
        </div>

        {/* ==================================================
            MODE
        ================================================== */}

        {!isEditing && (
          <div
            className={
              styles.modeTabs
            }
          >
            <button
              type="button"
              className={`${styles.modeButton} ${
                !aiMode
                  ? styles.modeButtonActive
                  : ""
              }`}
              disabled={
                aiLoading ||
                imageChecking
              }
              onClick={() => {
                setAiMode(
                  false
                );

                setError("");
              }}
            >
              ✍️ Completez eu
            </button>

            <button
              type="button"
              className={`${styles.modeButton} ${
                aiMode
                  ? styles.modeButtonActive
                  : ""
              }`}
              disabled={
                aiLoading ||
                imageChecking
              }
              onClick={() => {
                setAiMode(
                  true
                );

                setError("");
              }}
            >
              ✨ Ajută-mă cu AI
            </button>
          </div>
        )}

        {/* ==================================================
            AI
        ================================================== */}

        {!isEditing &&
        aiMode ? (
          <div
            className={
              styles.aiPanel
            }
          >
            <div
              className={
                styles.aiIcon
              }
            >
              ✨
            </div>

            <h3
              className={
                styles.aiTitle
              }
            >
              Spune-mi ce cauți
            </h3>

            <p
              className={
                styles.aiDescription
              }
            >
              Scrie exact cum ai scrie într-un grup de Facebook. Eu pregătesc cererea pentru tine.
            </p>

            <textarea
              className={
                styles.aiTextarea
              }
              value={
                aiText
              }
              disabled={
                aiLoading
              }
              onChange={(
                event
              ) =>
                setAiText(
                  event.target
                    .value
                )
              }
              rows={6}
              placeholder="Ex: Caut 80 de mărturii pentru botez, alb cu auriu, maxim 8 lei bucata și am nevoie de ele până pe 10 septembrie."
            />

            {error && (
              <div
                className={
                  styles.error
                }
                style={{
                  marginTop:
                    "12px",
                }}
              >
                {error}
              </div>
            )}

            <button
              type="button"
              className={
                styles.aiButton
              }
              disabled={
                aiLoading ||
                !aiText.trim()
              }
              onClick={
                handleAiAssist
              }
            >
              {aiLoading
                ? "✨ Pregătesc cererea..."
                : "✨ Pregătește cererea"}
            </button>
          </div>
        ) : (
          /* ==================================================
             FORM
          ================================================== */

          <form
            className={
              styles.form
            }
            onSubmit={
              handleSubmit
            }
          >
            {/* AI QUESTIONS */}

            {aiQuestions.length >
              0 && (
              <div
                className={
                  styles.aiQuestionsBox
                }
              >
                <strong>
                  ✨ Mai poți completa câteva detalii
                </strong>

                {aiQuestions.map(
                  (
                    question,
                    index
                  ) => (
                    <div
                      key={`${question}-${index}`}
                    >
                      • {question}
                    </div>
                  )
                )}
              </div>
            )}

            {/* TITLE */}

            <div
              className={
                styles.field
              }
            >
              <label
                className={
                  styles.label
                }
              >
                Ce cauți? *
              </label>

              <input
                type="text"
                className={
                  styles.input
                }
                value={
                  form.title
                }
                maxLength={180}
                onChange={(
                  event
                ) =>
                  updateField(
                    "title",
                    event.target
                      .value
                  )
                }
                placeholder="Ex: Caut mărturii pentru botez"
              />
            </div>

            {/* DESCRIPTION */}

            <div
              className={
                styles.field
              }
            >
              <label
                className={
                  styles.label
                }
              >
                Povestește puțin mai mult *
              </label>

              <textarea
                className={
                  styles.textarea
                }
                value={
                  form.description
                }
                rows={5}
                onChange={(
                  event
                ) =>
                  updateField(
                    "description",
                    event.target
                      .value
                  )
                }
                placeholder="Culori, stil, personalizare, preferințe sau orice altceva este important pentru tine..."
              />
            </div>

            {/* CATEGORY / QUANTITY */}

            <div
              className={
                styles.twoColumns
              }
            >
              <div
                className={
                  styles.field
                }
              >
                <label
                  className={
                    styles.label
                  }
                >
                  Categorie
                </label>

                <div
                  className={
                    styles.categoryAutocomplete
                  }
                >
                  <input
                    type="text"
                    className={
                      styles.input
                    }
                    value={
                      categoryQuery
                    }
                    autoComplete="off"
                    onFocus={() =>
                      setCategoryOpen(
                        true
                      )
                    }
                    onChange={(
                      event
                    ) => {
                      const value =
                        event.target
                          .value;

                      setCategoryQuery(
                        value
                      );

                      setCategoryOpen(
                        true
                      );

                      /*
                       * Păstrăm textul liber temporar.
                       * Dacă utilizatorul alege o sugestie,
                       * aici va fi înlocuit cu slug-ul real.
                       */
                      updateField(
                        "category",
                        value
                      );
                    }}
                    onBlur={() => {
                      window.setTimeout(
                        () =>
                          setCategoryOpen(
                            false
                          ),
                        150
                      );
                    }}
                    placeholder="Ex: Mărturii botez"
                  />

                  {categoryOpen &&
                    categorySuggestions.length >
                      0 && (
                      <div
                        className={
                          styles.categorySuggestions
                        }
                      >
                        {categorySuggestions.map(
                          (
                            item
                          ) => (
                            <button
                              key={
                                item.key
                              }
                              type="button"
                              className={
                                styles.categorySuggestion
                              }
                              onMouseDown={(
                                event
                              ) =>
                                event.preventDefault()
                              }
                              onClick={() => {
                                updateField(
                                  "category",
                                  item.key
                                );

                                setCategoryQuery(
                                  item.label
                                );

                                setCategoryOpen(
                                  false
                                );
                              }}
                            >
                              <span
                                className={
                                  styles.categorySuggestionText
                                }
                              >
                                <strong>
                                  {
                                    item.label
                                  }
                                </strong>

                                <small>
                                  {
                                    item.groupLabel
                                  }
                                </small>
                              </span>

                              <span
                                className={
                                  styles.categorySuggestionArrow
                                }
                                aria-hidden="true"
                              >
                                →
                              </span>
                            </button>
                          )
                        )}
                      </div>
                    )}
                </div>

                {form.category &&
                  CATEGORY_SET.has(
                    form.category
                  ) && (
                    <div
                      className={
                        styles.categorySelected
                      }
                    >
                      ✓{" "}
                      {CATEGORY_LABELS[
                        form.category
                      ] ||
                        form.category}
                    </div>
                  )}
              </div>

              <div
                className={
                  styles.field
                }
              >
                <label
                  className={
                    styles.label
                  }
                >
                  Cantitate
                </label>

                <input
                  type="number"
                  min="1"
                  step="1"
                  className={
                    styles.input
                  }
                  value={
                    form.quantity
                  }
                  onChange={(
                    event
                  ) =>
                    updateField(
                      "quantity",
                      event.target
                        .value
                    )
                  }
                  placeholder="Ex: 80"
                />
              </div>
            </div>

            {/* BUDGET */}

            <div
              className={
                styles.budgetBox
              }
            >
              <div
                className={
                  styles.budgetHeader
                }
              >
                <div>
                  <strong>
                    Buget
                  </strong>

                  <span>
                    Opțional
                  </span>
                </div>

                <select
                  className={
                    styles.smallSelect
                  }
                  value={
                    form.budgetType
                  }
                  onChange={(
                    event
                  ) =>
                    updateField(
                      "budgetType",
                      event.target
                        .value
                    )
                  }
                >
                  <option
                    value="PER_ITEM"
                  >
                    per bucată
                  </option>

                  <option
                    value="TOTAL"
                  >
                    total
                  </option>
                </select>
              </div>

              <div
                className={
                  styles.twoColumns
                }
              >
                <div
                  className={
                    styles.field
                  }
                >
                  <label
                    className={
                      styles.label
                    }
                  >
                    De la
                  </label>

                  <div
                    className={
                      styles.moneyInput
                    }
                  >
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={
                        form.budgetMin
                      }
                      onChange={(
                        event
                      ) =>
                        updateField(
                          "budgetMin",
                          event.target
                            .value
                        )
                      }
                      placeholder="0"
                    />

                    <span>
                      lei
                    </span>
                  </div>
                </div>

                <div
                  className={
                    styles.field
                  }
                >
                  <label
                    className={
                      styles.label
                    }
                  >
                    Până la
                  </label>

                  <div
                    className={
                      styles.moneyInput
                    }
                  >
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={
                        form.budgetMax
                      }
                      onChange={(
                        event
                      ) =>
                        updateField(
                          "budgetMax",
                          event.target
                            .value
                        )
                      }
                      placeholder="0"
                    />

                    <span>
                      lei
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* DATE / CITY */}

            <div
              className={
                styles.twoColumns
              }
            >
              <div
                className={
                  styles.field
                }
              >
                <label
                  className={
                    styles.label
                  }
                >
                  Până când ai nevoie?
                </label>

                <input
                  type="date"
                  className={
                    styles.input
                  }
                  value={
                    form.deliveryDeadline
                  }
                  onChange={(
                    event
                  ) =>
                    updateField(
                      "deliveryDeadline",
                      event.target
                        .value
                    )
                  }
                />
              </div>

              <div
                className={
                  styles.field
                }
              >
                <label
                  className={
                    styles.label
                  }
                >
                  Localitate
                </label>

                <input
                  type="text"
                  className={
                    styles.input
                  }
                  value={
                    form.city
                  }
                  onChange={(
                    event
                  ) =>
                    updateField(
                      "city",
                      event.target
                        .value
                    )
                  }
                  placeholder="Ex: București"
                />
              </div>
            </div>

           {/* PHOTOS */}

<div
  className={
    styles.field
  }
>
  <div
    className={
      styles.photoHeader
    }
  >
    <div>
      <label
        className={
          styles.label
        }
      >
        Fotografii de inspirație
      </label>

      <p
        className={
          styles.fieldHelp
        }
      >
        Poți adăuga până la 10 fotografii.
        Imaginile sunt verificate automat
        pentru numere de telefon.
      </p>
    </div>
  </div>

  <div
    className={
      styles.photoActions
    }
  >
    <label
      className={
        styles.photoButton
      }
    >
      <span>
        📷
      </span>

      <span>
        {imageChecking
          ? "Se verifică..."
          : form.images.length > 0
            ? "Adaugă alte fotografii"
            : "Adaugă fotografii"}
      </span>

      <input
        type="file"
        accept="image/*"
        multiple
        hidden
        disabled={
          imageChecking
        }
        onChange={
          handleImageFiles
        }
      />
    </label>

    {form.images.length > 0 && (
      <span
        className={
          styles.photoCount
        }
      >
        {form.images.length}/10
      </span>
    )}
  </div>

  {imageChecking && (
    <div
      className={
        styles.photoLoading
      }
    >
      ✨ Verificăm și încărcăm imaginile…
    </div>
  )}

  {form.images.length > 0 && (
    <div
      className={
        styles.imageGrid
      }
    >
      {form.images.map(
        (image) => (
          <div
            key={
              image.id
            }
            className={
              styles.imageItem
            }
          >
            <img
              src={
                image.preview
              }
              alt=""
            />

            <button
              type="button"
              disabled={
                imageChecking
              }
              onClick={() =>
                removeImage(
                  image.id
                )
              }
              aria-label="Șterge fotografia"
            >
              ×
            </button>
          </div>
        )
      )}
    </div>
  )}
</div>

            {/* ERROR */}

            {error && (
              <div
                className={
                  styles.error
                }
              >
                {error}
              </div>
            )}

            {/* FOOTER */}

            <div
              className={
                styles.footer
              }
            >
              <button
                type="button"
                className={
                  styles.secondaryButton
                }
                disabled={
                  submitting ||
                  aiLoading ||
                  imageChecking
                }
                onClick={
                  handleClose
                }
              >
                Renunță
              </button>

              <button
                type="submit"
                className={
                  styles.primaryButton
                }
                disabled={
                  !canSubmit
                }
              >
                {imageChecking
                  ? "Se încarcă imaginile..."
                  : submitting
                    ? (
                        isEditing
                          ? "Se salvează..."
                          : "Se publică..."
                      )
                    : (
                        isEditing
                          ? "Salvează modificările"
                          : "Publică cererea"
                      )}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}