// src/components/AiAssistant/Personalization/productPersonalizationFlow.js

const PERSONALIZATION_FLOW =
  "product-personalization";

/* =========================================================
   Helpers
========================================================= */

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function isSkipAnswer(value) {
  const normalized =
    normalizeText(value);

  return [
    "sari",
    "skip",
    "nu",
    "nu doresc",
    "nu vreau",
    "fara",
    "fără",
    "-",
  ].includes(normalized);
}

function isImageField(field) {
  const type =
    String(
      field?.type || ""
    ).toLowerCase();

  return [
    "image",
    "photo",
    "file",
  ].includes(type);
}

function getFieldValues(field) {
  if (
    Array.isArray(field?.options)
  ) {
    return field.options;
  }

  if (
    Array.isArray(field?.values)
  ) {
    return field.values;
  }

  return [];
}

function normalizeChoice(option) {
  if (
    typeof option === "string"
  ) {
    return {
      value: option,
      label: option,
    };
  }

  if (
    option &&
    typeof option === "object"
  ) {
    const value =
      option.value ??
      option.key ??
      option.label ??
      "";

    const label =
      option.label ??
      option.value ??
      option.key ??
      "";

    return {
      value: String(value),
      label: String(label),
    };
  }

  return {
    value: "",
    label: "",
  };
}

function findMatchingChoice(
  field,
  answer
) {
  const values =
    getFieldValues(field);

  if (!values.length) {
    return {
      matched: true,
      value:
        String(
          answer || ""
        ).trim(),
    };
  }

  const normalizedAnswer =
    normalizeText(answer);

  const choices =
    values
      .map(normalizeChoice)
      .filter(
        (item) =>
          item.value ||
          item.label
      );

  const match =
    choices.find(
      (item) =>
        normalizeText(
          item.value
        ) ===
          normalizedAnswer ||
        normalizeText(
          item.label
        ) ===
          normalizedAnswer
    );

  if (!match) {
    return {
      matched: false,
      value: null,
    };
  }

  return {
    matched: true,
    value: match.value,
  };
}

function getQuestionForField(
  field,
  {
    memberIndex = null,
  } = {}
) {
  if (!field) {
    return "";
  }

  const label =
    field.label ||
    "Completează această informație";

  const prefix =
    memberIndex !== null
      ? `Pentru membrul ${
          memberIndex + 1
        }: `
      : "";

  /*
   * Pentru fotografie nu vrem
   * să cerem text.
   */
  if (isImageField(field)) {
    return `${prefix}${label}

Apasă pe agrafa 📎 și încarcă fotografia. După ce ai ales poza, eu o preiau automat și continuăm.`;
  }

  const values =
    getFieldValues(field)
      .map(normalizeChoice)
      .filter(
        (item) =>
          item.label ||
          item.value
      );

  const lines = [
    `${prefix}${label}`,
  ];

  if (field.description) {
    lines.push(
      String(
        field.description
      )
    );
  }

  if (values.length) {
    lines.push(
      `Poți alege: ${values
        .map(
          (item) =>
            item.label ||
            item.value
        )
        .join(", ")}.`
    );
  }

  if (
    field.required === false
  ) {
    lines.push(
      "Dacă nu dorești să completezi acest câmp, poți scrie „sari”."
    );
  }

  return lines
    .filter(Boolean)
    .join("\n\n");
}

function getTopLevelFields(
  personalizationContext
) {
  const optionsSchema =
    Array.isArray(
      personalizationContext
        ?.optionsSchema
    )
      ? personalizationContext
          .optionsSchema
      : [];

  const customSchema =
    Array.isArray(
      personalizationContext
        ?.customSchema
    )
      ? personalizationContext
          .customSchema
      : [];

  return [
    ...optionsSchema.map(
      (field) => ({
        ...field,

        __source:
          "selectedOptions",
      })
    ),

    ...customSchema.map(
      (field) => ({
        ...field,

        __source:
          "customAnswers",
      })
    ),
  ];
}

function getRepeatedGroups(
  personalizationContext
) {
  return Array.isArray(
    personalizationContext
      ?.repeatedGroups
  )
    ? personalizationContext
        .repeatedGroups
    : [];
}

function getGroupKey(group) {
  return (
    group?.key ||
    group?.id ||
    null
  );
}

function getGroupFields(group) {
  return Array.isArray(
    group?.fields
  )
    ? group.fields
    : [];
}

function getGroupLabel(group) {
  return (
    group?.label ||
    group?.title ||
    "acest set"
  );
}

function createRepeatedItems(
  group,
  count
) {
  const fields =
    getGroupFields(group);

  return Array.from(
    {
      length: count,
    },
    () => {
      const item = {};

      for (
        const field of fields
      ) {
        if (field?.key) {
          item[field.key] =
            "";
        }
      }

      return item;
    }
  );
}

/* =========================================================
   Upload fotografie personalizare
========================================================= */

async function uploadCustomizationImage(
  file
) {
  if (!file) {
    return null;
  }

  const formData =
    new FormData();

  formData.append(
    "file",
    file
  );

  const response =
    await fetch(
      "/api/upload/customization",
      {
        method: "POST",
        body: formData,
        credentials: "include",
      }
    );

  if (!response.ok) {
    let message =
      "Nu am putut încărca fotografia.";

    try {
      const error =
        await response.json();

      message =
        error?.message ||
        message;
    } catch {
      // ignore
    }

    throw new Error(
      message
    );
  }

  const data =
    await response.json();

  if (!data?.url) {
    throw new Error(
      "Upload-ul nu a returnat fotografia."
    );
  }

  return data.url;
}

/* =========================================================
   Finalizare
========================================================= */

function completePersonalization({
  personalizationContext,
  personalizationDraft,

  addMessage,
  createMessage,

  setActiveFlow,
  setPersonalizationDraft,
}) {
  const productId =
    personalizationContext
      ?.productId;

  if (!productId) {
    addMessage(
      createMessage(
        "assistant",
        "Nu am putut identifica produsul. Te rog să reiei personalizarea din pagina produsului."
      )
    );

    return true;
  }

  /*
   * Trimitem toate valorile
   * către ProductDetails.
   */
  window.dispatchEvent(
    new CustomEvent(
      "artfest:personalization-complete",
      {
        detail: {
          productId,

          selectedOptions:
            personalizationDraft
              ?.selectedOptions ||
            {},

          customAnswers:
            personalizationDraft
              ?.customAnswers ||
            {},

          repeatedGroupAnswers:
            personalizationDraft
              ?.repeatedGroupAnswers ||
            {},
        },
      }
    )
  );

  addMessage(
    createMessage(
      "assistant",
      `Gata! 💛 Am completat personalizarea pentru ${
        personalizationContext
          ?.productTitle
          ? `„${personalizationContext.productTitle}”`
          : "produs"
      }.

Am transferat și fotografiile încărcate, acolo unde produsul le solicită.

Poți verifica toate alegerile în pagina produsului și apoi îl poți adăuga în coș.`
    )
  );

  setPersonalizationDraft(
    (current) => ({
      ...current,

      step: "complete",
    })
  );

  setActiveFlow(null);

  return true;
}

/* =========================================================
   Repeated groups
========================================================= */

function askRepeatedGroupCount({
  group,
  groupIndex,

  addMessage,
  createMessage,

  setPersonalizationDraft,
}) {
  if (!group) {
    return false;
  }

  setPersonalizationDraft(
    (current) => ({
      ...current,

      step:
        "group-count",

      currentGroupIndex:
        groupIndex,

      currentMemberIndex:
        0,

      currentRepeatedFieldIndex:
        0,
    })
  );

  addMessage(
    createMessage(
      "assistant",
      `Acum completăm informațiile pentru ${
        getGroupLabel(group)
      }.

Pentru câte persoane sau elemente dorești să completezi personalizarea?

Poți introduce un număr între 1 și 10.`
    )
  );

  return true;
}

/* =========================================================
   Continuare după câmp top-level
========================================================= */

function continueAfterTopField({
  draft,
  topFields,
  repeatedGroups,

  personalizationContext,

  addMessage,
  createMessage,

  setActiveFlow,
  setPersonalizationDraft,
}) {
  const nextIndex =
    draft.currentFieldIndex +
    1;

  draft.currentFieldIndex =
    nextIndex;

  setPersonalizationDraft(
    draft
  );

  const nextField =
    topFields[
      nextIndex
    ];

  if (nextField) {
    addMessage(
      createMessage(
        "assistant",
        getQuestionForField(
          nextField
        )
      )
    );

    return true;
  }

  if (
    repeatedGroups.length
  ) {
    return askRepeatedGroupCount({
      group:
        repeatedGroups[0],

      groupIndex:
        0,

      addMessage,
      createMessage,

      setPersonalizationDraft,
    });
  }

  return completePersonalization({
    personalizationContext,

    personalizationDraft:
      draft,

    addMessage,
    createMessage,

    setActiveFlow,
    setPersonalizationDraft,
  });
}

/* =========================================================
   Handler principal
========================================================= */

export async function submitProductPersonalizationMessage({
  activeFlow,
  value,

  personalizationContext,
  personalizationDraft,

  uploadedImage,

  addMessage,
  createMessage,

  setActiveFlow,
  setPersonalizationDraft,

  clearUploadedImage,
}) {
  if (
    activeFlow !==
    PERSONALIZATION_FLOW
  ) {
    return false;
  }

  const answer =
    String(
      value || ""
    ).trim();

  /*
   * Important:
   * când utilizatorul încarcă poza
   * apelăm funcția fără text.
   */
  const hasUploadedImage =
    !!uploadedImage?.file;

  if (
    !answer &&
    !hasUploadedImage
  ) {
    return true;
  }

  const draft = {
    step:
      personalizationDraft
        ?.step ||
      "fields",

    currentFieldIndex:
      Number(
        personalizationDraft
          ?.currentFieldIndex
      ) || 0,

    selectedOptions: {
      ...(
        personalizationDraft
          ?.selectedOptions ||
        {}
      ),
    },

    customAnswers: {
      ...(
        personalizationDraft
          ?.customAnswers ||
        {}
      ),
    },

    repeatedGroupAnswers: {
      ...(
        personalizationDraft
          ?.repeatedGroupAnswers ||
        {}
      ),
    },

    currentGroupIndex:
      Number(
        personalizationDraft
          ?.currentGroupIndex
      ) || 0,

    currentMemberIndex:
      Number(
        personalizationDraft
          ?.currentMemberIndex
      ) || 0,

    currentRepeatedFieldIndex:
      Number(
        personalizationDraft
          ?.currentRepeatedFieldIndex
      ) || 0,
  };

  const topFields =
    getTopLevelFields(
      personalizationContext
    );

  const repeatedGroups =
    getRepeatedGroups(
      personalizationContext
    );

  /* =======================================================
     1. CÂMPURI NORMALE
  ======================================================= */

  if (
    draft.step ===
    "fields"
  ) {
    if (
      !topFields.length
    ) {
      if (
        repeatedGroups.length
      ) {
        draft.step =
          "group-count";

        draft.currentGroupIndex =
          0;
      } else {
        return completePersonalization({
          personalizationContext,

          personalizationDraft:
            draft,

          addMessage,
          createMessage,

          setActiveFlow,
          setPersonalizationDraft,
        });
      }
    } else {
      const field =
        topFields[
          draft.currentFieldIndex
        ];

      if (!field) {
        if (
          repeatedGroups.length
        ) {
          return askRepeatedGroupCount({
            group:
              repeatedGroups[0],

            groupIndex:
              0,

            addMessage,
            createMessage,

            setPersonalizationDraft,
          });
        }

        return completePersonalization({
          personalizationContext,

          personalizationDraft:
            draft,

          addMessage,
          createMessage,

          setActiveFlow,
          setPersonalizationDraft,
        });
      }

      /* =====================================================
         FOTOGRAFIE
      ===================================================== */

      if (
        isImageField(field)
      ) {
        /*
         * Dacă nu avem încă poză,
         * o cerem.
         */
        if (
          !uploadedImage?.file
        ) {
          addMessage(
            createMessage(
              "assistant",
              getQuestionForField(
                field
              )
            )
          );

          return true;
        }

        /*
         * Avem fotografia.
         * O urcăm automat.
         */
        try {
          addMessage(
            createMessage(
              "assistant",
              "Perfect, am primit fotografia. O atașez acum personalizării. 💛"
            )
          );

          const imageUrl =
            await uploadCustomizationImage(
              uploadedImage.file
            );

          /*
           * Câmpurile image sunt în
           * customAnswers în formularul
           * produsului.
           */
          draft.customAnswers[
            field.key
          ] = imageUrl;

          clearUploadedImage?.();

          return continueAfterTopField({
            draft,
            topFields,
            repeatedGroups,

            personalizationContext,

            addMessage,
            createMessage,

            setActiveFlow,
            setPersonalizationDraft,
          });
        } catch (error) {
          addMessage(
            createMessage(
              "assistant",
              error?.message ||
                "Nu am putut atașa fotografia. Te rog să încerci din nou."
            )
          );

          return true;
        }
      }

      /* =====================================================
         TEXT / SELECT / DATE
      ===================================================== */

      let finalValue =
        answer;

      if (
        field.required ===
          false &&
        isSkipAnswer(answer)
      ) {
        finalValue = "";
      } else {
        const choiceResult =
          findMatchingChoice(
            field,
            answer
          );

        if (
          !choiceResult
            .matched
        ) {
          addMessage(
            createMessage(
              "assistant",
              `Nu am găsit această variantă.

${getQuestionForField(
  field
)}`
            )
          );

          return true;
        }

        finalValue =
          choiceResult.value;
      }

      if (
        field.__source ===
        "selectedOptions"
      ) {
        draft.selectedOptions[
          field.key
        ] = finalValue;
      } else {
        draft.customAnswers[
          field.key
        ] = finalValue;
      }

      return continueAfterTopField({
        draft,
        topFields,
        repeatedGroups,

        personalizationContext,

        addMessage,
        createMessage,

        setActiveFlow,
        setPersonalizationDraft,
      });
    }
  }

  /* =======================================================
     2. NUMĂR MEMBRI
  ======================================================= */

  if (
    draft.step ===
    "group-count"
  ) {
    const group =
      repeatedGroups[
        draft.currentGroupIndex
      ];

    if (!group) {
      return completePersonalization({
        personalizationContext,

        personalizationDraft:
          draft,

        addMessage,
        createMessage,

        setActiveFlow,
        setPersonalizationDraft,
      });
    }

    const count =
      Number.parseInt(
        answer,
        10
      );

    if (
      !Number.isFinite(
        count
      ) ||
      count < 1 ||
      count > 10
    ) {
      addMessage(
        createMessage(
          "assistant",
          "Te rog să introduci un număr între 1 și 10."
        )
      );

      return true;
    }

    const groupKey =
      getGroupKey(group);

    if (!groupKey) {
      addMessage(
        createMessage(
          "assistant",
          "Nu am putut identifica acest grup de personalizare."
        )
      );

      return true;
    }

    draft
      .repeatedGroupAnswers[
        groupKey
      ] =
      createRepeatedItems(
        group,
        count
      );

    draft.step =
      "repeated-fields";

    draft.currentMemberIndex =
      0;

    draft.currentRepeatedFieldIndex =
      0;

    setPersonalizationDraft(
      draft
    );

    const fields =
      getGroupFields(group);

    if (!fields.length) {
      const nextGroupIndex =
        draft.currentGroupIndex +
        1;

      if (
        repeatedGroups[
          nextGroupIndex
        ]
      ) {
        return askRepeatedGroupCount({
          group:
            repeatedGroups[
              nextGroupIndex
            ],

          groupIndex:
            nextGroupIndex,

          addMessage,
          createMessage,

          setPersonalizationDraft,
        });
      }

      return completePersonalization({
        personalizationContext,

        personalizationDraft:
          draft,

        addMessage,
        createMessage,

        setActiveFlow,
        setPersonalizationDraft,
      });
    }

    addMessage(
      createMessage(
        "assistant",
        `Perfect. Vom completa ${
          count === 1
            ? "un membru"
            : `${count} membri`
        }.

${getQuestionForField(
  fields[0],
  {
    memberIndex: 0,
  }
)}`
      )
    );

    return true;
  }

  /* =======================================================
     3. CÂMPURI REPEATED GROUP
  ======================================================= */

  if (
    draft.step ===
    "repeated-fields"
  ) {
    const group =
      repeatedGroups[
        draft.currentGroupIndex
      ];

    if (!group) {
      return completePersonalization({
        personalizationContext,

        personalizationDraft:
          draft,

        addMessage,
        createMessage,

        setActiveFlow,
        setPersonalizationDraft,
      });
    }

    const groupKey =
      getGroupKey(group);

    const fields =
      getGroupFields(group);

    const items =
      Array.isArray(
        draft
          .repeatedGroupAnswers[
          groupKey
        ]
      )
        ? draft
            .repeatedGroupAnswers[
            groupKey
          ]
        : [];

    const memberIndex =
      draft.currentMemberIndex;

    const fieldIndex =
      draft
        .currentRepeatedFieldIndex;

    const field =
      fields[
        fieldIndex
      ];

    const item =
      items[
        memberIndex
      ];

    if (
      !field ||
      !item
    ) {
      return true;
    }

    /* =====================================================
       POZĂ PENTRU MEMBRU
    ===================================================== */

    if (
      isImageField(field)
    ) {
      if (
        !uploadedImage?.file
      ) {
        addMessage(
          createMessage(
            "assistant",
            getQuestionForField(
              field,
              {
                memberIndex,
              }
            )
          )
        );

        return true;
      }

      try {
        addMessage(
          createMessage(
            "assistant",
            `Perfect, am primit fotografia pentru membrul ${
              memberIndex + 1
            }. O atașez acum. 💛`
          )
        );

        const imageUrl =
          await uploadCustomizationImage(
            uploadedImage.file
          );

        const nextItems =
          items.map(
            (
              currentItem,
              index
            ) =>
              index ===
              memberIndex
                ? {
                    ...currentItem,

                    [field.key]:
                      imageUrl,
                  }
                : currentItem
          );

        draft
          .repeatedGroupAnswers[
            groupKey
          ] =
          nextItems;

        clearUploadedImage?.();
      } catch (error) {
        addMessage(
          createMessage(
            "assistant",
            error?.message ||
              "Nu am putut atașa fotografia. Te rog să încerci din nou."
          )
        );

        return true;
      }
    } else {
      /* ===================================================
         TEXT / SELECT PENTRU MEMBRU
      =================================================== */

      let finalValue =
        answer;

      if (
        field.required ===
          false &&
        isSkipAnswer(answer)
      ) {
        finalValue = "";
      } else {
        const choiceResult =
          findMatchingChoice(
            field,
            answer
          );

        if (
          !choiceResult
            .matched
        ) {
          addMessage(
            createMessage(
              "assistant",
              `Nu am găsit această variantă.

${getQuestionForField(
  field,
  {
    memberIndex,
  }
)}`
            )
          );

          return true;
        }

        finalValue =
          choiceResult.value;
      }

      const nextItems =
        items.map(
          (
            currentItem,
            index
          ) =>
            index ===
            memberIndex
              ? {
                  ...currentItem,

                  [field.key]:
                    finalValue,
                }
              : currentItem
        );

      draft
        .repeatedGroupAnswers[
          groupKey
        ] =
        nextItems;
    }

    /* =====================================================
       URMĂTORUL CÂMP
    ===================================================== */

    const nextFieldIndex =
      fieldIndex + 1;

    if (
      fields[
        nextFieldIndex
      ]
    ) {
      draft
        .currentRepeatedFieldIndex =
        nextFieldIndex;

      setPersonalizationDraft(
        draft
      );

      addMessage(
        createMessage(
          "assistant",
          getQuestionForField(
            fields[
              nextFieldIndex
            ],
            {
              memberIndex,
            }
          )
        )
      );

      return true;
    }

    /* =====================================================
       URMĂTORUL MEMBRU
    ===================================================== */

    const nextMemberIndex =
      memberIndex + 1;

    if (
      draft
        .repeatedGroupAnswers[
          groupKey
        ]?.[
          nextMemberIndex
        ]
    ) {
      draft.currentMemberIndex =
        nextMemberIndex;

      draft
        .currentRepeatedFieldIndex =
        0;

      setPersonalizationDraft(
        draft
      );

      addMessage(
        createMessage(
          "assistant",
          `Perfect. Acum continuăm cu membrul ${
            nextMemberIndex +
            1
          }.

${getQuestionForField(
  fields[0],
  {
    memberIndex:
      nextMemberIndex,
  }
)}`
        )
      );

      return true;
    }

    /* =====================================================
       URMĂTORUL GRUP
    ===================================================== */

    const nextGroupIndex =
      draft.currentGroupIndex +
      1;

    const nextGroup =
      repeatedGroups[
        nextGroupIndex
      ];

    if (nextGroup) {
      return askRepeatedGroupCount({
        group:
          nextGroup,

        groupIndex:
          nextGroupIndex,

        addMessage,
        createMessage,

        setPersonalizationDraft,
      });
    }

    return completePersonalization({
      personalizationContext,

      personalizationDraft:
        draft,

      addMessage,
      createMessage,

      setActiveFlow,
      setPersonalizationDraft,
    });
  }

  return true;
}