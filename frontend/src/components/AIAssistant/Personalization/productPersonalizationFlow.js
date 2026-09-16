// src/components/AiAssistant/Personalization/productPersonalizationFlow.js

import { humanizeAssistantErrorMessage } from "../assistantErrorMessages.js";
import {
  normalizeOptionChoice,
  resolveOptionDisplayLabel,
} from "../../../utils/optionLabels.js";

const PERSONALIZATION_FLOW =
  "product-personalization";

/*
 * Prag pentru afișarea variantelor ca butoane (choices) în loc de
 * text liber - peste acest număr de valori, o listă de butoane ar
 * deveni un perete de opțiuni, nu o îmbunătățire.
 */
const CHOICE_BUTTON_MAX_VALUES = 6;

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

/*
 * Normalizarea unei opțiuni (string sau { value, label }) e acum
 * centralizată în utils/optionLabels.js (normalizeOptionChoice),
 * refolosită și de ProductDetails.jsx și de
 * productConfigurationValidator.js - evităm o a doua implementare
 * aici, care putea diverge de restul aplicației.
 */
const normalizeChoice = normalizeOptionChoice;

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

/*
 * Rezolvă eticheta de afișat pentru o valoare deja salvată (ex. la
 * sumarul final, la istoricul de "Modifică un răspuns" sau la
 * confirmarea "✓ Câmp: valoare") - dacă valoarea provine dintr-o
 * opțiune, arătăm mereu eticheta umană, niciodată slug-ul brut.
 */
function getDisplayValueForField(
  field,
  value
) {
  if (
    value === undefined ||
    value === null ||
    value === ""
  ) {
    return null;
  }

  /*
   * resolveOptionDisplayLabel acoperă deja: label explicit pe opțiune
   * -> label din schema câmpului -> constante canonice (culori,
   * materiale) -> fallback determinist pentru text liber/slug
   * necunoscut.
   */
  return resolveOptionDisplayLabel(
    value,
    field
  );
}

/*
 * Un câmp cu o listă finită și rezonabilă de valori predefinite se
 * afișează ca butoane (choices), nu text liber - câmpurile de
 * fotografie rămân mereu pe calea de upload.
 */
function shouldUseChoiceButtons(
  field
) {
  if (isImageField(field)) {
    return false;
  }

  const values =
    getFieldValues(field);

  return (
    values.length > 0 &&
    values.length <=
      CHOICE_BUTTON_MAX_VALUES
  );
}

function buildFieldChoices(
  field,
  {
    memberIndex = null,
  } = {}
) {
  const suffix =
    memberIndex !== null
      ? `-m${memberIndex}`
      : "";

  const values =
    getFieldValues(field)
      .map(normalizeChoice)
      .filter(
        (item) =>
          item.value ||
          item.label
      );

  const choices = values.map(
    (item, index) => ({
      id: `personalization-field-${field.key}-${index}${suffix}`,

      action:
        "personalization-field-answer",

      title:
        item.label ||
        item.value,

      value: item.value,
    })
  );

  if (
    field.required === false
  ) {
    choices.push({
      id: `personalization-skip-${field.key}${suffix}`,

      action:
        "personalization-skip-field",

      title: "Sari peste",
    });
  }

  return choices;
}

/*
 * "Culoare" -> "Ce culoare dorești?" - transformare determinstă,
 * sigură gramatical în română pentru orice substantiv (verbul nu se
 * acordă cu genul obiectului) - folosită DOAR pentru câmpuri cu
 * valori predefinite (variante), nu pentru text liber (nume, mesaj,
 * dedicație etc.), unde eticheta originală a vendorului rămâne
 * neschimbată - vezi `createFieldQuestionMessage`.
 */
function buildNaturalQuestionLine(
  label,
  memberPrefix
) {
  const trimmed = String(
    label || ""
  ).trim();

  const alreadyPhrased =
    /[?!]\s*$/.test(trimmed);

  const question =
    alreadyPhrased || !trimmed
      ? trimmed ||
        "Ce alegi?"
      : `Ce ${trimmed
          .charAt(0)
          .toLowerCase()}${trimmed.slice(
          1
        )} dorești?`;

  return `${memberPrefix}${question}`;
}

function getQuestionForField(
  field,
  {
    memberIndex = null,
    progress = null,
    includeValuesList = true,
    includeSkipHint = true,
  } = {}
) {
  if (!field) {
    return "";
  }

  const label =
    field.label ||
    "Completează această informație";

  const memberPrefix =
    memberIndex !== null
      ? `Pentru membrul ${
          memberIndex + 1
        }: `
      : "";

  const headerLine =
    progress &&
    Number(progress.total) > 1
      ? `Pasul ${
          progress.current
        } din ${
          progress.total
        } · ${label}`
      : null;

  /*
   * Pentru fotografie nu vrem
   * să cerem text.
   */
  if (isImageField(field)) {
    return [
      headerLine,

      `${memberPrefix}Apasă pe agrafa 📎 sau pe butonul de mai jos și încarcă fotografia. După ce ai ales poza, eu o preiau automat și continuăm.`,
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  const values =
    getFieldValues(field)
      .map(normalizeChoice)
      .filter(
        (item) =>
          item.label ||
          item.value
      );

  const questionLine =
    values.length
      ? buildNaturalQuestionLine(
          label,
          memberPrefix
        )
      : `${memberPrefix}${label}`;

  const lines = [
    headerLine,
    questionLine,
  ];

  if (field.description) {
    lines.push(
      String(
        field.description
      )
    );
  }

  if (
    includeValuesList &&
    values.length
  ) {
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
    includeSkipHint &&
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

/*
 * ANTI-ABANDON (mecanism comun cu productConfigurationValidator.js) -
 * un câmp obligatoriu care declară `options`/`values` dar e rezolvat
 * la 0 valori nu poate fi niciodată completat corect de client -
 * exact regula EMPTY_REQUIRED_CHOICE din validator. Nu blocăm - oferim
 * imediat calea de ieșire (cerere de ofertă) în loc să punem o
 * întrebare la care nu există niciun răspuns valid.
 */
function isUnresolvableRequiredChoice(
  field
) {
  if (!field) {
    return false;
  }

  if (isImageField(field)) {
    return false;
  }

  if (field.required === false) {
    return false;
  }

  const declaresOptions =
    Array.isArray(field.options) ||
    Array.isArray(field.values);

  if (!declaresOptions) {
    return false;
  }

  return (
    getFieldValues(field).length === 0
  );
}

/*
 * Mesajul + CTA-ul de fallback, identic peste tot unde flow-ul
 * întâlnește o configurare pe care clientul n-o poate rezolva
 * (câmp obligatoriu fără opțiuni, repeatedGroup fără identificator
 * valid) - NU un dead-end tehnic, ci o cale de ieșire reală, prin
 * flow-ul deja existent "quote-from-product" (handoff-ul efectiv se
 * face în AiAssistant.jsx, la click pe choice).
 */
function buildConfigurationFallbackMessage(
  createMessage
) {
  return createMessage(
    "assistant",
    "Creatorul nu a configurat complet această opțiune. Poți continua totuși cu o cerere de ofertă.",
    {
      type: "choices",

      choiceStep:
        "personalization-fallback",

      choices: [
        {
          id: "personalization-fallback-quote",

          action:
            "personalization-fallback-quote",

          title:
            "Continuă cu cerere de ofertă",
        },
      ],
    }
  );
}

/*
 * Construiește mesajul de întrebare pentru un câmp - text simplu,
 * butoane (choices) sau CTA de upload, în funcție de tipul câmpului.
 * Punct unic folosit peste tot unde se cere un câmp, ca formatul,
 * pragul de "câte valori" și butonul "Sari peste" să rămână identice
 * indiferent de unde e apelat (prima întrebare, întrebarea următoare,
 * revenire, răspuns la o întrebare de clarificare) - inclusiv
 * fallback-ul anti-abandon de mai sus, verificat aici o singură dată
 * pentru toți apelanții.
 */
export function createFieldQuestionMessage({
  field,
  memberIndex = null,
  progress = null,
  introText = null,

  createMessage,
}) {
  if (
    isUnresolvableRequiredChoice(
      field
    )
  ) {
    return buildConfigurationFallbackMessage(
      createMessage
    );
  }

  const useButtons =
    shouldUseChoiceButtons(
      field
    );

  const isImage =
    isImageField(field);

  const questionText =
    getQuestionForField(
      field,
      {
        memberIndex,
        progress,

        includeValuesList:
          !useButtons,

        /*
         * Hint-ul text de "sari" e redundant dacă oricum arătăm
         * un buton dedicat "Sari peste" (choices sau CTA foto).
         */
        includeSkipHint:
          !useButtons &&
          !isImage,
      }
    );

  const bodyText =
    introText
      ? `${introText}\n\n${questionText}`
      : questionText;

  if (isImage) {
    const choices =
      field.required ===
      false
        ? [
            {
              id: `personalization-skip-${field.key}${
                memberIndex !==
                null
                  ? `-m${memberIndex}`
                  : ""
              }`,

              action:
                "personalization-skip-field",

              title:
                "Sari peste",
            },
          ]
        : null;

    return createMessage(
      "assistant",
      bodyText,
      {
        type: "image-upload",

        ...(choices
          ? { choices }
          : {}),
      }
    );
  }

  if (useButtons) {
    return createMessage(
      "assistant",
      bodyText,
      {
        type: "choices",

        choiceStep:
          "personalization-field",

        choices:
          buildFieldChoices(
            field,
            {
              memberIndex,
            }
          ),
      }
    );
  }

  return createMessage(
    "assistant",
    bodyText
  );
}

/*
 * "✓ Culoare: Alb" - confirmare scurtă, imediat după un răspuns
 * valid, înainte de următoarea întrebare - nu repetă explicații.
 */
function buildConfirmationMessage({
  field,
  value,
  memberIndex = null,

  createMessage,
}) {
  const prefix =
    memberIndex !== null
      ? `Membru ${
          memberIndex + 1
        } – `
      : "";

  const display = isImageField(
    field
  )
    ? "fotografie încărcată"
    : getDisplayValueForField(
        field,
        value
      ) || "sărit";

  return createMessage(
    "assistant",
    `✓ ${prefix}${
      field.label ||
      field.key
    }: ${display}`
  );
}

/* =========================================================
   Întrebări de clarificare ("ce culori?", "ce opțiuni sunt?"...)

   Detectare determinstă, FĂRĂ LLM - dacă mesajul utilizatorului e o
   întrebare despre variantele disponibile, nu îl tratăm ca răspuns
   la câmpul curent (nu incrementăm indexul, nu modificăm draftul) -
   doar reafișăm opțiunile/explicația.
========================================================= */

const CLARIFICATION_QUESTION_RE =
  /\b(ce|care)\b[\s\S]{0,20}\b(optiun\w*|variant\w*|culor\w*|marim\w*|dimensiun\w*|valor\w*)\w*\b|\bce\b[\s\S]{0,15}\bpot\b[\s\S]{0,10}\balege\w*\b|\barata[\s-]{0,3}mi\b[\s\S]{0,20}\b(optiun\w*|variant\w*)\w*\b/;

function isOptionsClarificationQuestion(
  text
) {
  const normalized =
    normalizeText(text);

  if (!normalized) {
    return false;
  }

  return CLARIFICATION_QUESTION_RE.test(
    normalized
  );
}

function buildClarificationTextResponse(
  field,
  {
    memberIndex = null,
  } = {}
) {
  const prefix =
    memberIndex !== null
      ? `Pentru membrul ${
          memberIndex + 1
        }: `
      : "";

  const label =
    field.label ||
    field.key ||
    "acest câmp";

  const values =
    getFieldValues(field)
      .map(normalizeChoice)
      .filter(
        (item) =>
          item.label ||
          item.value
      );

  if (values.length) {
    return `${prefix}Sigur! Pentru „${label}” poți alege dintre: ${values
      .map(
        (item) =>
          item.label ||
          item.value
      )
      .join(", ")}.`;
  }

  if (field.description) {
    return `${prefix}${field.description}`;
  }

  return `${prefix}„${label}” este un câmp liber - scrie ce dorești, nu are variante predefinite.`;
}

/*
 * Returnează `true` dacă mesajul a fost tratat ca întrebare de
 * clarificare (apelantul trebuie să oprească procesarea imediat,
 * FĂRĂ să atingă draftul) - `false` dacă trebuie procesat normal ca
 * răspuns.
 */
function handleClarificationIfNeeded({
  field,
  answer,
  memberIndex = null,
  progress = null,

  addMessage,
  createMessage,
}) {
  if (
    !isOptionsClarificationQuestion(
      answer
    )
  ) {
    return false;
  }

  if (
    shouldUseChoiceButtons(
      field
    )
  ) {
    addMessage(
      createFieldQuestionMessage(
        {
          field,
          memberIndex,
          progress,

          introText:
            "Sigur! Iată variantele disponibile:",

          createMessage,
        }
      )
    );

    return true;
  }

  addMessage(
    createMessage(
      "assistant",
      buildClarificationTextResponse(
        field,
        {
          memberIndex,
        }
      )
    )
  );

  return true;
}

export function getTopLevelFields(
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
   Istoric pași (pentru "Înapoi" / "Modifică un răspuns")

   Fiecare pas de răspuns salvează o "poză" completă a draftului DE
   DINAINTE de a fi aplicat răspunsul respectiv - revenirea înseamnă
   pur și simplu restaurarea acelei poze, nu inversarea manuală a unei
   mutații. Evită complet coruperea la înainte -> înapoi -> înainte,
   pentru că fiecare pas înainte creează mereu o poză nouă, completă.
   Funcționează identic indiferent dacă răspunsul a venit din text
   liber sau dintr-un buton (choices) - ambele trec prin exact același
   `submitProductPersonalizationMessage`.
========================================================= */

function cloneDraftState(draft) {
  return {
    step: draft.step,

    currentFieldIndex:
      draft.currentFieldIndex,

    selectedOptions: {
      ...(
        draft.selectedOptions ||
        {}
      ),
    },

    customAnswers: {
      ...(
        draft.customAnswers ||
        {}
      ),
    },

    repeatedGroupAnswers:
      Object.fromEntries(
        Object.entries(
          draft.repeatedGroupAnswers ||
            {}
        ).map(
          ([
            key,
            items,
          ]) => [
            key,
            Array.isArray(
              items
            )
              ? items.map(
                  (item) => ({
                    ...item,
                  })
                )
              : items,
          ]
        )
      ),

    currentGroupIndex:
      draft.currentGroupIndex,

    currentMemberIndex:
      draft.currentMemberIndex,

    currentRepeatedFieldIndex:
      draft.currentRepeatedFieldIndex,
  };
}

/*
 * Salvează, ÎNAINTE de a scrie noul răspuns în draft, o poză a
 * stării curente + o etichetă lizibilă (label uman, ex. "Culoare:
 * Alb"), folosită atât la picker-ul "Modifică un răspuns", cât și ca
 * destinație de revenire.
 */
function pushHistoryEntry(
  draft,
  label
) {
  const history =
    Array.isArray(draft.history)
      ? draft.history
      : [];

  draft.history = [
    ...history,

    {
      label,
      snapshot:
        cloneDraftState(draft),
    },
  ];
}

function historyLabelFor(
  field,
  value,
  {
    memberIndex = null,
  } = {}
) {
  const prefix =
    memberIndex !== null
      ? `Membru ${
          memberIndex + 1
        } – `
      : "";

  const display = isImageField(
    field
  )
    ? "fotografie"
    : getDisplayValueForField(
        field,
        value
      ) || "(sărit)";

  return `${prefix}${
    field.label || field.key
  }: ${display}`;
}

/* =========================================================
   Sumar final + confirmare
========================================================= */

function buildSummaryLines({
  personalizationContext,
  personalizationDraft,
}) {
  const topFields =
    getTopLevelFields(
      personalizationContext
    );

  const repeatedGroups =
    getRepeatedGroups(
      personalizationContext
    );

  const lines = [];

  for (
    const field of topFields
  ) {
    const rawValue =
      field.__source ===
      "selectedOptions"
        ? personalizationDraft
            ?.selectedOptions?.[
            field.key
          ]
        : personalizationDraft
            ?.customAnswers?.[
            field.key
          ];

    if (
      !rawValue &&
      rawValue !== 0
    ) {
      continue;
    }

    const display =
      isImageField(field)
        ? "încărcată"
        : getDisplayValueForField(
            field,
            rawValue
          );

    if (!display) {
      continue;
    }

    lines.push(
      `• ${
        field.label ||
        field.key
      }: ${display}`
    );
  }

  for (
    const group of repeatedGroups
  ) {
    const groupKey =
      getGroupKey(group);

    const fields =
      getGroupFields(group);

    const items =
      Array.isArray(
        personalizationDraft
          ?.repeatedGroupAnswers?.[
          groupKey
        ]
      )
        ? personalizationDraft
            .repeatedGroupAnswers[
            groupKey
          ]
        : [];

    items.forEach(
      (item, index) => {
        const parts = fields
          .map((field) => {
            const rawValue =
              item?.[
                field.key
              ];

            if (
              !rawValue &&
              rawValue !== 0
            ) {
              return null;
            }

            const display =
              isImageField(
                field
              )
                ? "încărcată"
                : getDisplayValueForField(
                    field,
                    rawValue
                  );

            return display
              ? `${
                  field.label ||
                  field.key
                }: ${display}`
              : null;
          })
          .filter(Boolean)
          .join(", ");

        if (parts) {
          lines.push(
            `• Membru ${
              index + 1
            } (${getGroupLabel(
              group
            )}): ${parts}`
          );
        }
      }
    );
  }

  return lines;
}

function showSummary({
  personalizationContext,
  personalizationDraft: draft,

  addMessage,
  createMessage,

  setPersonalizationDraft,
}) {
  const lines =
    buildSummaryLines({
      personalizationContext,
      personalizationDraft:
        draft,
    });

  draft.step = "summary";

  setPersonalizationDraft(
    draft
  );

  addMessage(
    createMessage(
      "assistant",

      lines.length
        ? `Iată cum am configurat produsul:

${lines.join("\n")}

Este totul corect?`
        : `Nu ai completat niciun câmp de personalizare.

Este totul corect?`,

      {
        type: "choices",

        choiceStep:
          "personalization-summary",

        choices: [
          {
            id:
              "personalization-confirm",

            action:
              "personalization-confirm",

            title:
              "Da, continuă",
          },

          {
            id:
              "personalization-edit",

            action:
              "personalization-edit",

            title:
              "Modifică un răspuns",
          },
        ],
      }
    )
  );

  return true;
}

function showEditPicker({
  personalizationContext,
  personalizationDraft: draft,

  addMessage,
  createMessage,

  setPersonalizationDraft,
}) {
  const history =
    Array.isArray(draft.history)
      ? draft.history
      : [];

  if (!history.length) {
    addMessage(
      createMessage(
        "assistant",
        "Nu există încă niciun răspuns de modificat."
      )
    );

    return showSummary({
      personalizationContext,
      personalizationDraft:
        draft,

      addMessage,
      createMessage,

      setPersonalizationDraft,
    });
  }

  draft.step =
    "summary-edit-pick";

  setPersonalizationDraft(
    draft
  );

  addMessage(
    createMessage(
      "assistant",
      "Ce răspuns vrei să modifici?",
      {
        type: "choices",

        choiceStep:
          "personalization-edit-pick",

        choices: history.map(
          (entry, index) => ({
            id: `personalization-edit-${index}`,

            action:
              "personalization-edit-pick",

            title: entry.label,

            historyIndex: index,
          })
        ),
      }
    )
  );

  return true;
}

function reAskCurrentQuestion({
  personalizationContext,
  personalizationDraft: draft,

  addMessage,
  createMessage,

  setPersonalizationDraft,
}) {
  const topFields =
    getTopLevelFields(
      personalizationContext
    );

  const repeatedGroups =
    getRepeatedGroups(
      personalizationContext
    );

  if (draft.step === "fields") {
    const field =
      topFields[
        draft.currentFieldIndex
      ];

    if (field) {
      addMessage(
        createFieldQuestionMessage(
          {
            field,

            progress: {
              current:
                draft.currentFieldIndex +
                1,

              total:
                topFields.length,
            },

            createMessage,
          }
        )
      );

      return true;
    }
  }

  if (
    draft.step ===
    "group-count"
  ) {
    const group =
      repeatedGroups[
        draft.currentGroupIndex
      ];

    if (group) {
      return askRepeatedGroupCount(
        {
          group,

          groupIndex:
            draft.currentGroupIndex,

          addMessage,
          createMessage,

          setPersonalizationDraft,
        }
      );
    }
  }

  if (
    draft.step ===
    "repeated-fields"
  ) {
    const group =
      repeatedGroups[
        draft.currentGroupIndex
      ];

    const fields = group
      ? getGroupFields(group)
      : [];

    const field =
      fields[
        draft.currentRepeatedFieldIndex
      ];

    if (field) {
      addMessage(
        createFieldQuestionMessage(
          {
            field,

            memberIndex:
              draft.currentMemberIndex,

            progress: {
              current:
                draft.currentRepeatedFieldIndex +
                1,

              total:
                fields.length,
            },

            createMessage,
          }
        )
      );

      return true;
    }
  }

  return showSummary({
    personalizationContext,
    personalizationDraft:
      draft,

    addMessage,
    createMessage,

    setPersonalizationDraft,
  });
}

function rewindToHistoryIndex({
  personalizationContext,
  personalizationDraft: draft,
  historyIndex,

  addMessage,
  createMessage,

  setPersonalizationDraft,
}) {
  const history =
    Array.isArray(draft.history)
      ? draft.history
      : [];

  const entry =
    history[historyIndex];

  if (!entry) {
    return showSummary({
      personalizationContext,
      personalizationDraft:
        draft,

      addMessage,
      createMessage,

      setPersonalizationDraft,
    });
  }

  const restored = {
    ...entry.snapshot,

    /*
     * Renunțăm la pasul ales și la tot ce a urmat după el - o
     * revenire liniară, deterministă, care nu poate lăsa draftul
     * într-o stare amestecată la înainte -> înapoi -> înainte.
     */
    history: history.slice(
      0,
      historyIndex
    ),
  };

  setPersonalizationDraft(
    restored
  );

  addMessage(
    createMessage(
      "assistant",
      "Sigur, hai să modificăm acest răspuns."
    )
  );

  return reAskCurrentQuestion({
    personalizationContext,

    personalizationDraft:
      restored,

    addMessage,
    createMessage,

    setPersonalizationDraft,
  });
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

  /*
   * BUGFIX (audit) - mesajul final ținea cont mereu de flow-ul de
   * "adaugă în coș", chiar și pentru produse QUOTE_ONLY, unde nu
   * există coș. `orderMode` vine din payload-ul evenimentului
   * `artfest:personalization-start` (ProductDetails.jsx), păstrat
   * neschimbat în `personalizationContext` - folosit STRICT pentru
   * textul de aici, nu schimbă mecanismul QUOTE_ONLY din backend.
   */
  const continuationLine =
    personalizationContext
      ?.orderMode ===
    "QUOTE_ONLY"
      ? "Personalizarea este pregătită. Verifică alegerile și poți continua cu cererea de ofertă."
      : "Personalizarea este pregătită. Verifică alegerile și poți continua cu produsul.";

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

${continuationLine}`
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
      const errorBody =
        await response.json();

      message = humanizeAssistantErrorMessage(
        { data: errorBody, status: response.status },
        message
      );
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
      createFieldQuestionMessage(
        {
          field: nextField,

          progress: {
            current:
              nextIndex + 1,

            total:
              topFields.length,
          },

          createMessage,
        }
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

  return showSummary({
    personalizationContext,

    personalizationDraft:
      draft,

    addMessage,
    createMessage,

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

    history:
      Array.isArray(
        personalizationDraft
          ?.history
      )
        ? personalizationDraft.history
        : [],
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
        return showSummary({
          personalizationContext,

          personalizationDraft:
            draft,

          addMessage,
          createMessage,

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

        return showSummary({
          personalizationContext,

          personalizationDraft:
            draft,

          addMessage,
          createMessage,

          setPersonalizationDraft,
        });
      }

      /* =====================================================
         ÎNTREBARE DE CLARIFICARE ("ce culori?" etc.) - NU consumă
         răspunsul, NU avansează.
      ===================================================== */

      if (
        !hasUploadedImage &&
        handleClarificationIfNeeded(
          {
            field,
            answer,

            progress: {
              current:
                draft.currentFieldIndex +
                1,

              total:
                topFields.length,
            },

            addMessage,
            createMessage,
          }
        )
      ) {
        return true;
      }

      /* =====================================================
         FOTOGRAFIE
      ===================================================== */

      if (
        isImageField(field)
      ) {
        /*
         * Câmp opțional + userul a scris "sari" (sau echivalent) -
         * sărim peste fotografie fără să o cerem la nesfârșit.
         */
        if (
          !uploadedImage?.file &&
          field.required ===
            false &&
          isSkipAnswer(answer)
        ) {
          pushHistoryEntry(
            draft,
            historyLabelFor(
              field,
              "",
              {}
            )
          );

          draft.customAnswers[
            field.key
          ] = "";

          addMessage(
            buildConfirmationMessage(
              {
                field,
                value: "",
                createMessage,
              }
            )
          );

          return continueAfterTopField({
            draft,
            topFields,
            repeatedGroups,

            personalizationContext,

            addMessage,
            createMessage,

            setPersonalizationDraft,
          });
        }

        /*
         * Dacă nu avem încă poză,
         * o cerem.
         */
        if (
          !uploadedImage?.file
        ) {
          addMessage(
            createFieldQuestionMessage(
              {
                field,

                progress: {
                  current:
                    draft.currentFieldIndex +
                    1,

                  total:
                    topFields.length,
                },

                createMessage,
              }
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

          pushHistoryEntry(
            draft,
            historyLabelFor(
              field,
              imageUrl,
              {}
            )
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

          addMessage(
            buildConfirmationMessage(
              {
                field,
                value: imageUrl,
                createMessage,
              }
            )
          );

          return continueAfterTopField({
            draft,
            topFields,
            repeatedGroups,

            personalizationContext,

            addMessage,
            createMessage,

            setPersonalizationDraft,
          });
        } catch (error) {
          addMessage(
            createMessage(
              "assistant",
              humanizeAssistantErrorMessage(
                error,
                "Nu am putut atașa fotografia. Te rog să încerci din nou."
              )
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
            createFieldQuestionMessage(
              {
                field,

                progress: {
                  current:
                    draft.currentFieldIndex +
                    1,

                  total:
                    topFields.length,
                },

                introText: `Nu am găsit opțiunea asta pentru ${
                  field.label ||
                  field.key
                }. Poți alege una dintre variantele de mai jos.`,

                createMessage,
              }
            )
          );

          return true;
        }

        finalValue =
          choiceResult.value;
      }

      pushHistoryEntry(
        draft,
        historyLabelFor(
          field,
          finalValue,
          {}
        )
      );

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

      addMessage(
        buildConfirmationMessage(
          {
            field,
            value: finalValue,
            createMessage,
          }
        )
      );

      return continueAfterTopField({
        draft,
        topFields,
        repeatedGroups,

        personalizationContext,

        addMessage,
        createMessage,

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
      return showSummary({
        personalizationContext,

        personalizationDraft:
          draft,

        addMessage,
        createMessage,

        setPersonalizationDraft,
      });
    }

    if (
      isOptionsClarificationQuestion(
        answer
      )
    ) {
      addMessage(
        createMessage(
          "assistant",
          `Te întreb pentru câte persoane sau elemente vrei să completezi personalizarea pentru „${getGroupLabel(
            group
          )}” - scrie un număr între 1 și 10.`
        )
      );

      return true;
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
      /*
       * ANTI-ABANDON - grup fără identificator valid: dead-end
       * confirmat înainte de acest fix (mesaj tehnic, fără nicio
       * cale de ieșire). Acum oferă explicit fallback-ul spre
       * cerere de ofertă, nu doar un mesaj fără urmare.
       */
      addMessage(
        buildConfigurationFallbackMessage(
          createMessage
        )
      );

      return true;
    }

    pushHistoryEntry(
      draft,
      `${getGroupLabel(
        group
      )}: ${count} ${
        count === 1
          ? "persoană"
          : "persoane"
      }`
    );

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

      return showSummary({
        personalizationContext,

        personalizationDraft:
          draft,

        addMessage,
        createMessage,

        setPersonalizationDraft,
      });
    }

    addMessage(
      createFieldQuestionMessage(
        {
          field: fields[0],

          memberIndex: 0,

          progress: {
            current: 1,

            total:
              fields.length,
          },

          introText: `Perfect. Vom completa ${
            count === 1
              ? "un membru"
              : `${count} membri`
          }.`,

          createMessage,
        }
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
      return showSummary({
        personalizationContext,

        personalizationDraft:
          draft,

        addMessage,
        createMessage,

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
       ÎNTREBARE DE CLARIFICARE
    ===================================================== */

    if (
      !hasUploadedImage &&
      handleClarificationIfNeeded(
        {
          field,
          answer,
          memberIndex,

          progress: {
            current:
              fieldIndex + 1,

            total:
              fields.length,
          },

          addMessage,
          createMessage,
        }
      )
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
        !uploadedImage?.file &&
        field.required ===
          false &&
        isSkipAnswer(answer)
      ) {
        pushHistoryEntry(
          draft,
          historyLabelFor(
            field,
            "",
            {
              memberIndex,
            }
          )
        );

        const skippedItems =
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
                      "",
                  }
                : currentItem
          );

        draft
          .repeatedGroupAnswers[
            groupKey
          ] =
          skippedItems;

        addMessage(
          buildConfirmationMessage(
            {
              field,
              value: "",
              memberIndex,
              createMessage,
            }
          )
        );
      } else if (
        !uploadedImage?.file
      ) {
        addMessage(
          createFieldQuestionMessage(
            {
              field,

              memberIndex,

              progress: {
                current:
                  fieldIndex +
                  1,

                total:
                  fields.length,
              },

              createMessage,
            }
          )
        );

        return true;
      } else {
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

          pushHistoryEntry(
            draft,
            historyLabelFor(
              field,
              imageUrl,
              {
                memberIndex,
              }
            )
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

          addMessage(
            buildConfirmationMessage(
              {
                field,
                value: imageUrl,
                memberIndex,
                createMessage,
              }
            )
          );
        } catch (error) {
          addMessage(
            createMessage(
              "assistant",
              humanizeAssistantErrorMessage(
                error,
                "Nu am putut atașa fotografia. Te rog să încerci din nou."
              )
            )
          );

          return true;
        }
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
            createFieldQuestionMessage(
              {
                field,

                memberIndex,

                progress: {
                  current:
                    fieldIndex +
                    1,

                  total:
                    fields.length,
                },

                introText: `Nu am găsit opțiunea asta pentru ${
                  field.label ||
                  field.key
                }. Poți alege una dintre variantele de mai jos.`,

                createMessage,
              }
            )
          );

          return true;
        }

        finalValue =
          choiceResult.value;
      }

      pushHistoryEntry(
        draft,
        historyLabelFor(
          field,
          finalValue,
          {
            memberIndex,
          }
        )
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
                    finalValue,
                }
              : currentItem
        );

      draft
        .repeatedGroupAnswers[
          groupKey
        ] =
        nextItems;

      addMessage(
        buildConfirmationMessage(
          {
            field,
            value: finalValue,
            memberIndex,
            createMessage,
          }
        )
      );
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
        createFieldQuestionMessage(
          {
            field:
              fields[
                nextFieldIndex
              ],

            memberIndex,

            progress: {
              current:
                nextFieldIndex +
                1,

              total:
                fields.length,
            },

            createMessage,
          }
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
        createFieldQuestionMessage(
          {
            field: fields[0],

            memberIndex:
              nextMemberIndex,

            progress: {
              current: 1,

              total:
                fields.length,
            },

            introText: `Perfect. Acum continuăm cu membrul ${
              nextMemberIndex +
              1
            }.`,

            createMessage,
          }
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

    return showSummary({
      personalizationContext,

      personalizationDraft:
        draft,

      addMessage,
      createMessage,

      setPersonalizationDraft,
    });
  }

  return true;
}

/* =========================================================
   Handler alegeri (choices) - sumar final, "Modifică un
   răspuns", butoanele de variante ale unui câmp și "Sari
   peste".
========================================================= */

export async function handlePersonalizationChoice({
  activeFlow,
  choice,

  personalizationContext,
  personalizationDraft,

  addMessage,
  createMessage,

  setActiveFlow,
  setPersonalizationDraft,
}) {
  if (
    activeFlow !==
    PERSONALIZATION_FLOW
  ) {
    return false;
  }

  if (
    !choice ||
    typeof choice !==
      "object"
  ) {
    return false;
  }

  if (
    choice.action ===
      "personalization-field-answer" ||
    choice.action ===
      "personalization-skip-field"
  ) {
    await submitProductPersonalizationMessage(
      {
        activeFlow,

        value:
          choice.action ===
          "personalization-skip-field"
            ? "sari"
            : choice.value ||
              "",

        personalizationContext,
        personalizationDraft,

        addMessage,
        createMessage,

        setPersonalizationDraft,
      }
    );

    return true;
  }

  if (
    choice.action ===
    "personalization-confirm"
  ) {
    completePersonalization({
      personalizationContext,
      personalizationDraft,

      addMessage,
      createMessage,

      setActiveFlow,
      setPersonalizationDraft,
    });

    return true;
  }

  if (
    choice.action ===
    "personalization-edit"
  ) {
    showEditPicker({
      personalizationContext,

      personalizationDraft,

      addMessage,
      createMessage,

      setPersonalizationDraft,
    });

    return true;
  }

  if (
    choice.action ===
    "personalization-edit-pick"
  ) {
    rewindToHistoryIndex({
      personalizationContext,

      personalizationDraft,

      historyIndex:
        choice.historyIndex,

      addMessage,
      createMessage,

      setPersonalizationDraft,
    });

    return true;
  }

  return true;
}
