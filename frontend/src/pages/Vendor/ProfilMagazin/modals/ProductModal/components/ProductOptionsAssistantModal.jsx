import {
  useEffect,
  useMemo,
  useState,
} from "react";

import Modal from "../../../ui/Modal";
import modalStyles from "./ProductOptionsAssistantModal.module.css";

/* =====================================================
   OPȚIUNI PREDEFINITE
===================================================== */

const FIELD_CHOICES = [
  {
    key: "culoare",
    label: "Culoare",
    icon: "🎨",
    kind: "option",
    preset: "colors",
    suggestions: [],
  },
  {
    key: "marime",
    label: "Mărime",
    icon: "📏",
    kind: "option",
    suggestions: [
      "XS",
      "S",
      "M",
      "L",
      "XL",
      "XXL",
    ],
  },
  {
    key: "model",
    label: "Model",
    icon: "🖼️",
    kind: "option",
    suggestions: [],
  },
  {
    key: "material",
    label: "Material",
    icon: "🧵",
    kind: "option",
    preset: "materials",
    suggestions: [],
  },
  {
    key: "aroma",
    label: "Aromă / parfum",
    icon: "🌸",
    kind: "option",
    preset: "scents",
    suggestions: [],
  },

  {
    key: "nume",
    label: "Nume",
    icon: "👤",
    kind: "custom",
    type: "text",
  },
  {
    key: "text_produs",
    label: "Text personalizat",
    icon: "✏️",
    kind: "custom",
    type: "text",
  },
  {
    key: "mesaj",
    label: "Mesaj",
    icon: "💌",
    kind: "custom",
    type: "textarea",
  },
  {
    key: "data_eveniment",
    label: "Dată eveniment",
    icon: "📅",
    kind: "custom",
    type: "date",
  },
  {
    key: "poza",
    label: "Poză",
    icon: "📷",
    kind: "custom",
    type: "file",
  },
];

/* =====================================================
   HELPERS
===================================================== */

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function makeKey(label) {
  return String(label || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
}

function uniqueValues(values = []) {
  const result = [];

  for (const rawValue of values) {
    const value =
      String(rawValue || "").trim();

    if (!value) {
      continue;
    }

    const exists =
      result.some(
        (item) =>
          normalizeText(item) ===
          normalizeText(value)
      );

    if (!exists) {
      result.push(value);
    }
  }

  return result;
}

/* =====================================================
   COMPONENTĂ
===================================================== */

export default function ProductOptionsAssistantModal({
  open,
  onClose,
  form,
  setForm,
  optionPresets = {},
}) {
  const [step, setStep] =
    useState("fields");

  const [
    selectedKeys,
    setSelectedKeys,
  ] = useState([]);

  const [
    fieldValues,
    setFieldValues,
  ] = useState({});

  const [
    requiredMap,
    setRequiredMap,
  ] = useState({});

  const [
    currentOptionIndex,
    setCurrentOptionIndex,
  ] = useState(0);

  const [
    customOptionLabel,
    setCustomOptionLabel,
  ] = useState("");

  const [
    customFieldLabel,
    setCustomFieldLabel,
  ] = useState("");

  const [
    customFields,
    setCustomFields,
  ] = useState([]);

  const [
    valueInput,
    setValueInput,
  ] = useState("");

  const [
    repeatedEnabled,
    setRepeatedEnabled,
  ] = useState(false);

  const [
    repeatedFieldKeys,
    setRepeatedFieldKeys,
  ] = useState([]);

  /* =====================================================
     RESET / ÎNCĂRCARE DATE EXISTENTE
  ===================================================== */

  useEffect(() => {
    if (!open) {
      return;
    }

    const existingOptions =
      Array.isArray(form?.optionsSchema)
        ? form.optionsSchema
        : [];

    const existingCustom =
      Array.isArray(form?.customSchema)
        ? form.customSchema
        : [];

    const existingRepeated =
      Array.isArray(form?.repeatedGroups)
        ? form.repeatedGroups
        : [];

    const keys = [
      ...existingOptions.map(
        (field) => field.key
      ),
      ...existingCustom.map(
        (field) => field.key
      ),
    ].filter(Boolean);

    setSelectedKeys(keys);

    const nextValues = {};

    for (const field of existingOptions) {
      nextValues[field.key] =
        Array.isArray(field.options)
          ? field.options
          : [];
    }

    setFieldValues(nextValues);

    const nextRequired = {};

    for (const field of [
      ...existingOptions,
      ...existingCustom,
    ]) {
      nextRequired[field.key] =
        field.required !== false;
    }

    setRequiredMap(nextRequired);

    const nonPresetCustom =
      existingCustom.filter(
        (field) =>
          !FIELD_CHOICES.some(
            (item) =>
              item.key === field.key
          )
      );

    setCustomFields(nonPresetCustom);

    setRepeatedEnabled(
      existingRepeated.length > 0
    );

    setRepeatedFieldKeys(
      existingRepeated?.[0]?.fields
        ?.map((field) => field.key)
        .filter(Boolean) || []
    );

    setCurrentOptionIndex(0);
    setCustomOptionLabel("");
    setCustomFieldLabel("");
    setValueInput("");
    setStep("fields");
  }, [
    open,
    form?.optionsSchema,
    form?.customSchema,
    form?.repeatedGroups,
  ]);

  /* =====================================================
     CÂMPURI SELECTATE
  ===================================================== */

  const selectedDefinitions =
    useMemo(() => {
      const standard =
        FIELD_CHOICES.filter(
          (field) =>
            selectedKeys.includes(
              field.key
            )
        );

      return [
        ...standard,
        ...customFields,
      ];
    }, [
      selectedKeys,
      customFields,
    ]);

  const selectedOptionFields =
    useMemo(
      () =>
        selectedDefinitions.filter(
          (field) =>
            field.kind === "option"
        ),
      [selectedDefinitions]
    );

  const selectedCustomFields =
    useMemo(
      () =>
        selectedDefinitions.filter(
          (field) =>
            field.kind === "custom"
        ),
      [selectedDefinitions]
    );

  const currentOptionField =
    selectedOptionFields[
      currentOptionIndex
    ] || null;

  /* =====================================================
     SUGESTII PENTRU VARIANTA CURENTĂ
  ===================================================== */

  const currentSuggestions =
    useMemo(() => {
      if (!currentOptionField) {
        return [];
      }

      if (
        currentOptionField.preset &&
        Array.isArray(
          optionPresets[
            currentOptionField.preset
          ]
        )
      ) {
        return uniqueValues(
          optionPresets[
            currentOptionField.preset
          ]
        );
      }

      return uniqueValues(
        currentOptionField.suggestions ||
          []
      );
    }, [
      currentOptionField,
      optionPresets,
    ]);

  /* =====================================================
     SELECTARE CÂMPURI
  ===================================================== */

  const toggleField = (field) => {
    setSelectedKeys((current) => {
      if (
        current.includes(field.key)
      ) {
        return current.filter(
          (key) =>
            key !== field.key
        );
      }

      return [
        ...current,
        field.key,
      ];
    });

    setRequiredMap((current) => ({
      ...current,

      [field.key]:
        current[field.key] ??
        true,
    }));
  };

  /* =====================================================
     CÂMP NOU DE TIP VARIANTĂ
  ===================================================== */

  const addCustomOption = () => {
    const label =
      customOptionLabel.trim();

    if (!label) {
      return;
    }

    const key =
      makeKey(label);

    if (!key) {
      return;
    }

    const exists =
      selectedDefinitions.some(
        (field) =>
          field.key === key
      );

    if (exists) {
      setCustomOptionLabel("");
      return;
    }

    const newField = {
      key,
      label,
      icon: "➕",
      kind: "option",
      type: "select",
      suggestions: [],
    };

    setCustomFields(
      (current) => [
        ...current,
        newField,
      ]
    );

    setSelectedKeys(
      (current) => [
        ...current,
        key,
      ]
    );

    setRequiredMap(
      (current) => ({
        ...current,
        [key]: true,
      })
    );

    setCustomOptionLabel("");
  };

  /* =====================================================
     CÂMP NOU DE TIP TEXT
  ===================================================== */

  const addCustomInput = () => {
    const label =
      customFieldLabel.trim();

    if (!label) {
      return;
    }

    const key =
      makeKey(label);

    if (!key) {
      return;
    }

    const exists =
      selectedDefinitions.some(
        (field) =>
          field.key === key
      );

    if (exists) {
      setCustomFieldLabel("");
      return;
    }

    const newField = {
      key,
      label,
      icon: "✏️",
      kind: "custom",
      type: "text",
    };

    setCustomFields(
      (current) => [
        ...current,
        newField,
      ]
    );

    setSelectedKeys(
      (current) => [
        ...current,
        key,
      ]
    );

    setRequiredMap(
      (current) => ({
        ...current,
        [key]: true,
      })
    );

    setCustomFieldLabel("");
  };

  /* =====================================================
     VALORI PENTRU OPȚIUNI
  ===================================================== */

  const valuesForCurrentField =
    currentOptionField
      ? fieldValues[
          currentOptionField.key
        ] || []
      : [];

  const toggleSuggestedValue = (
    value
  ) => {
    if (!currentOptionField) {
      return;
    }

    const key =
      currentOptionField.key;

    const currentValues =
      fieldValues[key] || [];

    const exists =
      currentValues.some(
        (item) =>
          normalizeText(item) ===
          normalizeText(value)
      );

    setFieldValues(
      (current) => ({
        ...current,

        [key]: exists
          ? currentValues.filter(
              (item) =>
                normalizeText(item) !==
                normalizeText(value)
            )
          : uniqueValues([
              ...currentValues,
              value,
            ]),
      })
    );
  };

  const addWrittenValue = () => {
    if (!currentOptionField) {
      return;
    }

    const value =
      valueInput.trim();

    if (!value) {
      return;
    }

    const key =
      currentOptionField.key;

    setFieldValues(
      (current) => ({
        ...current,

        [key]: uniqueValues([
          ...(current[key] || []),
          value,
        ]),
      })
    );

    setValueInput("");
  };

  const removeCurrentValue = (
    value
  ) => {
    if (!currentOptionField) {
      return;
    }

    const key =
      currentOptionField.key;

    setFieldValues(
      (current) => ({
        ...current,

        [key]: (
          current[key] || []
        ).filter(
          (item) =>
            item !== value
        ),
      })
    );
  };

  /* =====================================================
     NAVIGARE
  ===================================================== */

  const startConfiguration = () => {
    if (
      !selectedDefinitions.length
    ) {
      return;
    }

    if (
      selectedOptionFields.length
    ) {
      setCurrentOptionIndex(0);
      setStep("values");
      return;
    }

    setStep("required");
  };

  const nextOption = () => {
    if (!currentOptionField) {
      return;
    }

    /*
     * Nu permitem trecerea mai departe
     * fără cel puțin o variantă.
     */
    if (
      !valuesForCurrentField.length
    ) {
      return;
    }

    const nextIndex =
      currentOptionIndex + 1;

    if (
      nextIndex <
      selectedOptionFields.length
    ) {
      setCurrentOptionIndex(
        nextIndex
      );

      setValueInput("");
      return;
    }

    setStep("required");
  };

  const goBackFromValues = () => {
    if (currentOptionIndex > 0) {
      setCurrentOptionIndex(
        (current) =>
          current - 1
      );

      setValueInput("");
      return;
    }

    setStep("fields");
  };

  /* =====================================================
     SET / GRUP
  ===================================================== */

  const toggleRepeatedField = (
    key
  ) => {
    setRepeatedFieldKeys(
      (current) =>
        current.includes(key)
          ? current.filter(
              (item) =>
                item !== key
            )
          : [
              ...current,
              key,
            ]
    );
  };

  /* =====================================================
     GENERARE SCHEME
  ===================================================== */

  const generatedOptions =
    useMemo(
      () =>
        selectedOptionFields.map(
          (field) => ({
            key: field.key,
            label: field.label,
            type: "select",

            required:
              requiredMap[
                field.key
              ] !== false,

            options:
              uniqueValues(
                fieldValues[
                  field.key
                ] || []
              ),

            preset:
              field.preset || null,

            sellerCanAddValues:
              true,
          })
        ),
      [
        selectedOptionFields,
        requiredMap,
        fieldValues,
      ]
    );

  const generatedCustom =
    useMemo(
      () =>
        selectedCustomFields.map(
          (field) => ({
            key: field.key,
            label: field.label,

            type:
              field.type ||
              "text",

            required:
              requiredMap[
                field.key
              ] !== false,
          })
        ),
      [
        selectedCustomFields,
        requiredMap,
      ]
    );

  const allGeneratedFields =
    useMemo(
      () => [
        ...generatedOptions.map(
          (field) => ({
            ...field,
            source: "option",
          })
        ),

        ...generatedCustom.map(
          (field) => ({
            ...field,
            source: "custom",
          })
        ),
      ],
      [
        generatedOptions,
        generatedCustom,
      ]
    );

  const generatedRepeated =
    useMemo(() => {
      if (!repeatedEnabled) {
        return [];
      }

      const fields =
        allGeneratedFields.filter(
          (field) =>
            repeatedFieldKeys.includes(
              field.key
            )
        );

      if (!fields.length) {
        return [];
      }

      return [
        {
          id: "main_repeated_group",
          key: "items",
          label: "Membri / elemente",
          itemLabel: "Membru",
          minItems: 1,
          maxItems: 10,
          required: true,
          fields,
        },
      ];
    }, [
      repeatedEnabled,
      repeatedFieldKeys,
      allGeneratedFields,
    ]);

  /* =====================================================
     VALIDARE FINALĂ
  ===================================================== */

  const invalidOption =
    generatedOptions.find(
      (field) =>
        !Array.isArray(
          field.options
        ) ||
        field.options.length === 0
    );

  const canSave =
    selectedDefinitions.length >
      0 &&
    !invalidOption &&
    (
      !repeatedEnabled ||
      repeatedFieldKeys.length > 0
    );

  /* =====================================================
     SALVARE
  ===================================================== */

  const saveConfiguration = () => {
    if (!canSave) {
      return;
    }

    setForm((current) => ({
      ...current,

      orderMode: "OPTIONS",
      acceptsCustom: true,

      availability:
        !current.availability ||
        current.availability ===
          "READY"
          ? "MADE_TO_ORDER"
          : current.availability,

      readyQty: 0,
      nextShipDate: "",

      quoteSchema: [],

      optionsSchema:
        generatedOptions,

      customSchema:
        generatedCustom,

      repeatedGroups:
        generatedRepeated,

      aiManuallyEdited: true,
    }));

    onClose();
  };

  /* =====================================================
     STILURI MICI
  ===================================================== */

  const choiceStyle = (
    selected
  ) => ({
    border: selected
      ? "2px solid var(--color-primary)"
      : "1px solid var(--color-border)",

    background: selected
      ? "color-mix(in srgb, var(--color-primary) 10%, var(--surface))"
      : "var(--surface)",

    color: "var(--color-text)",

    borderRadius:
      "var(--radius)",

    padding: "11px 12px",

    cursor: "pointer",

    textAlign: "left",

    fontFamily:
      "var(--font-body)",
  });

  /* =====================================================
     RENDER
  ===================================================== */

  return (
    <Modal
      open={open}
      onClose={onClose}
      maxWidth={620}
    >
      <div
        className={modalStyles.modalContent}
        style={{
          padding: 24,
          color:
            "var(--color-text)",
        }}
      >
        {/* =====================
            PAS 1
        ====================== */}

        {step === "fields" && (
          <>
            <div
              style={{
                fontSize: 30,
                marginBottom: 8,
              }}
            >
              ✨
            </div>

            <h3
              style={{
                margin:
                  "0 0 8px",
                fontFamily:
                  "var(--font-title)",
              }}
            >
              Hai să configurăm
              produsul
            </h3>

            <p
              style={{
                margin:
                  "0 0 20px",
                color:
                  "var(--color-muted)",
              }}
            >
              Ce trebuie să aleagă
              sau să completeze
              clientul înainte de
              comandă?
            </p>

            <div
              className={modalStyles.choicesGrid}
              style={{
                display: "grid",
                gridTemplateColumns:
                  "repeat(auto-fit, minmax(145px, 1fr))",
                gap: 8,
              }}
            >
              {FIELD_CHOICES.map(
                (field) => {
                  const selected =
                    selectedKeys.includes(
                      field.key
                    );

                  return (
                    <button
                      key={field.key}
                      type="button"
                      onClick={() =>
                        toggleField(
                          field
                        )
                      }
                      className={
                        selected
                          ? `${modalStyles.choiceCard} ${modalStyles.choiceCardSelected}`
                          : modalStyles.choiceCard
                      }
                      style={choiceStyle(
                        selected
                      )}
                    >
                      <div
                        style={{
                          fontSize:
                            20,
                        }}
                      >
                        {field.icon}
                      </div>

                      <strong>
                        {field.label}
                      </strong>

                      {selected && (
                        <div
                          style={{
                            marginTop:
                              4,
                            color:
                              "var(--color-primary)",
                            fontSize:
                              12,
                          }}
                        >
                          ✓ Selectat
                        </div>
                      )}
                    </button>
                  );
                }
              )}
            </div>

            <div
              className={modalStyles.section}
              style={{
                marginTop: 20,
                paddingTop: 16,
                borderTop:
                  "1px solid var(--color-border)",
              }}
            >
              <strong>
                Nu găsești opțiunea?
              </strong>

              <p
                style={{
                  margin:
                    "5px 0 10px",
                  color:
                    "var(--color-muted)",
                  fontSize: 13,
                }}
              >
                Poți crea o alegere
                nouă pentru client.
              </p>

              <div
                className={modalStyles.inlineRow}
                style={{
                  display: "flex",
                  gap: 8,
                }}
              >
                <input
                  value={
                    customOptionLabel
                  }
                  onChange={(event) =>
                    setCustomOptionLabel(
                      event.target
                        .value
                    )
                  }
                  onKeyDown={(
                    event
                  ) => {
                    if (
                      event.key ===
                      "Enter"
                    ) {
                      event.preventDefault();
                      addCustomOption();
                    }
                  }}
                  placeholder="Ex: Model, finisaj, tip fundiță"
                  style={{
                    flex: 1,
                    minWidth: 0,
                    padding:
                      "10px 12px",
                    border:
                      "1px solid var(--color-border)",
                    borderRadius:
                      "var(--radius)",
                    background:
                      "var(--surface)",
                    color:
                      "var(--color-text)",
                  }}
                />

                <button
                  type="button"
                  onClick={
                    addCustomOption
                  }
                  disabled={
                    !customOptionLabel.trim()
                  }
                  style={{
                    border: 0,
                    padding:
                      "10px 14px",
                    borderRadius:
                      "var(--radius)",
                    background:
                      "var(--color-primary)",
                    color: "#fff",
                    cursor:
                      "pointer",
                  }}
                >
                  Adaugă
                </button>
              </div>
            </div>

            <div
              style={{
                marginTop: 16,
              }}
            >
              <strong>
                Clientul trebuie să
                scrie altceva?
              </strong>

              <div
                style={{
                  display: "flex",
                  gap: 8,
                  marginTop: 8,
                }}
              >
                <input
                  value={
                    customFieldLabel
                  }
                  onChange={(event) =>
                    setCustomFieldLabel(
                      event.target
                        .value
                    )
                  }
                  onKeyDown={(
                    event
                  ) => {
                    if (
                      event.key ===
                      "Enter"
                    ) {
                      event.preventDefault();
                      addCustomInput();
                    }
                  }}
                  placeholder="Ex: Inițiale, dedicație"
                  style={{
                    flex: 1,
                    minWidth: 0,
                    padding:
                      "10px 12px",
                    border:
                      "1px solid var(--color-border)",
                    borderRadius:
                      "var(--radius)",
                    background:
                      "var(--surface)",
                    color:
                      "var(--color-text)",
                  }}
                />

                <button
                  type="button"
                  onClick={
                    addCustomInput
                  }
                  disabled={
                    !customFieldLabel.trim()
                  }
                  style={{
                    border: 0,
                    padding:
                      "10px 14px",
                    borderRadius:
                      "var(--radius)",
                    background:
                      "var(--color-primary)",
                    color: "#fff",
                    cursor:
                      "pointer",
                  }}
                >
                  Adaugă
                </button>
              </div>
            </div>

            <div
              className={modalStyles.actions}
              style={{
                display: "flex",
                justifyContent:
                  "space-between",
                gap: 10,
                marginTop: 24,
              }}
            >
              <button
                type="button"
                onClick={onClose}
                style={{
                  padding:
                    "11px 15px",
                  border:
                    "1px solid var(--color-border)",
                  borderRadius:
                    "var(--radius)",
                  background:
                    "var(--surface)",
                  color:
                    "var(--color-text)",
                }}
              >
                Închide
              </button>

              <button
                type="button"
                onClick={
                  startConfiguration
                }
                disabled={
                  !selectedDefinitions.length
                }
                style={{
                  padding:
                    "11px 18px",
                  border: 0,
                  borderRadius:
                    "var(--radius)",
                  background:
                    "var(--color-primary)",
                  color: "#fff",
                  fontWeight: 700,
                  opacity:
                    selectedDefinitions.length
                      ? 1
                      : 0.5,
                }}
              >
                Continuă →
              </button>
            </div>
          </>
        )}

        {/* =====================
            PAS 2 - VALORI
        ====================== */}

        {step === "values" &&
          currentOptionField && (
            <>
              <div
                style={{
                  fontSize: 30,
                  marginBottom: 8,
                }}
              >
                {currentOptionField.icon ||
                  "✨"}
              </div>

              <h3
                style={{
                  margin:
                    "0 0 8px",
                }}
              >
                Ce{" "}
                {currentOptionField.label.toLowerCase()}
                {" "}sunt disponibile?
              </h3>

              <p
                style={{
                  color:
                    "var(--color-muted)",
                  margin:
                    "0 0 18px",
                }}
              >
                Alege cel puțin o
                variantă pe care
                clientul o poate
                selecta.
              </p>

              {!!currentSuggestions.length && (
                <div
                  style={{
                    display: "flex",
                    flexWrap:
                      "wrap",
                    gap: 8,
                    marginBottom:
                      16,
                  }}
                >
                  {currentSuggestions.map(
                    (item) => {
                      const selected =
                        valuesForCurrentField.some(
                          (value) =>
                            normalizeText(
                              value
                            ) ===
                            normalizeText(
                              item
                            )
                        );

                      return (
                        <button
                          key={item}
                          type="button"
                          onClick={() =>
                            toggleSuggestedValue(
                              item
                            )
                          }
                          style={{
                            padding:
                              "8px 11px",
                            borderRadius:
                              999,

                            border:
                              selected
                                ? "2px solid var(--color-primary)"
                                : "1px solid var(--color-border)",

                            background:
                              selected
                                ? "var(--color-primary)"
                                : "var(--surface)",

                            color:
                              selected
                                ? "#fff"
                                : "var(--color-text)",

                            cursor:
                              "pointer",
                          }}
                        >
                          {selected
                            ? "✓ "
                            : ""}
                          {item}
                        </button>
                      );
                    }
                  )}
                </div>
              )}

              <div
                className={modalStyles.inlineRow}
                style={{
                  display: "flex",
                  gap: 8,
                }}
              >
                <input
                  value={
                    valueInput
                  }
                  onChange={(event) =>
                    setValueInput(
                      event.target
                        .value
                    )
                  }
                  onKeyDown={(
                    event
                  ) => {
                    if (
                      event.key ===
                      "Enter"
                    ) {
                      event.preventDefault();
                      addWrittenValue();
                    }
                  }}
                  placeholder={`Adaugă ${currentOptionField.label.toLowerCase()}...`}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    padding:
                      "10px 12px",
                    border:
                      "1px solid var(--color-border)",
                    borderRadius:
                      "var(--radius)",
                    background:
                      "var(--surface)",
                    color:
                      "var(--color-text)",
                  }}
                />

                <button
                  type="button"
                  onClick={
                    addWrittenValue
                  }
                  disabled={
                    !valueInput.trim()
                  }
                  style={{
                    border: 0,
                    padding:
                      "10px 14px",
                    borderRadius:
                      "var(--radius)",
                    background:
                      "var(--color-primary)",
                    color: "#fff",
                  }}
                >
                  Adaugă
                </button>
              </div>

              {!!valuesForCurrentField.length && (
                <div
                  style={{
                    marginTop: 16,
                  }}
                >
                  <strong>
                    Variante alese:
                  </strong>

                  <div
                    style={{
                      display:
                        "flex",
                      flexWrap:
                        "wrap",
                      gap: 7,
                      marginTop: 8,
                    }}
                  >
                    {valuesForCurrentField.map(
                      (item) => (
                        <span
                          key={item}
                          style={{
                            display:
                              "inline-flex",
                            alignItems:
                              "center",
                            gap: 6,
                            padding:
                              "6px 9px",
                            borderRadius:
                              999,
                            background:
                              "var(--color-border)",
                          }}
                        >
                          {item}

                          <button
                            type="button"
                            onClick={() =>
                              removeCurrentValue(
                                item
                              )
                            }
                            style={{
                              border: 0,
                              background:
                                "transparent",
                              color:
                                "inherit",
                              cursor:
                                "pointer",
                            }}
                          >
                            ×
                          </button>
                        </span>
                      )
                    )}
                  </div>
                </div>
              )}

              {!valuesForCurrentField.length && (
                <div
                  style={{
                    marginTop: 14,
                    padding: 10,
                    borderRadius:
                      "var(--radius)",
                    background:
                      "color-mix(in srgb, var(--color-warning) 12%, var(--surface))",
                    fontSize: 13,
                  }}
                >
                  Adaugă cel puțin o
                  variantă pentru a
                  continua.
                </div>
              )}

              <div
                className={modalStyles.actions}
                style={{
                  display: "flex",
                  justifyContent:
                    "space-between",
                  gap: 10,
                  marginTop: 24,
                }}
              >
                <button
                  type="button"
                  onClick={
                    goBackFromValues
                  }
                  style={{
                    padding:
                      "11px 15px",
                    border:
                      "1px solid var(--color-border)",
                    borderRadius:
                      "var(--radius)",
                    background:
                      "var(--surface)",
                    color:
                      "var(--color-text)",
                  }}
                >
                  ← Înapoi
                </button>

                <button
                  type="button"
                  onClick={
                    nextOption
                  }
                  disabled={
                    !valuesForCurrentField.length
                  }
                  style={{
                    padding:
                      "11px 18px",
                    border: 0,
                    borderRadius:
                      "var(--radius)",
                    background:
                      "var(--color-primary)",
                    color: "#fff",
                    fontWeight: 700,
                    opacity:
                      valuesForCurrentField.length
                        ? 1
                        : 0.5,
                  }}
                >
                  Continuă →
                </button>
              </div>
            </>
          )}

        {/* =====================
            PAS 3 - OBLIGATORII
        ====================== */}

        {step === "required" && (
          <>
            <h3
              style={{
                margin:
                  "0 0 8px",
              }}
            >
              Ce este obligatoriu?
            </h3>

            <p
              style={{
                margin:
                  "0 0 18px",
                color:
                  "var(--color-muted)",
              }}
            >
              Spune-ne ce trebuie
              completat neapărat
              înainte ca produsul să
              poată fi adăugat în coș.
            </p>

            <div
              style={{
                display: "grid",
                gap: 8,
              }}
            >
              {selectedDefinitions.map(
                (field) => (
                  <label
                    key={field.key}
                    style={{
                      display:
                        "flex",
                      alignItems:
                        "center",
                      gap: 10,
                      padding:
                        "11px 12px",
                      border:
                        "1px solid var(--color-border)",
                      borderRadius:
                        "var(--radius)",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={
                        requiredMap[
                          field.key
                        ] !== false
                      }
                      onChange={(
                        event
                      ) =>
                        setRequiredMap(
                          (current) => ({
                            ...current,

                            [field.key]:
                              event
                                .target
                                .checked,
                          })
                        )
                      }
                    />

                    <span>
                      {field.icon}{" "}
                      {field.label}
                    </span>
                  </label>
                )
              )}
            </div>

            <div
              className={modalStyles.actions}
              style={{
                display: "flex",
                justifyContent:
                  "space-between",
                gap: 10,
                marginTop: 24,
              }}
            >
              <button
                type="button"
                onClick={() => {
                  if (
                    selectedOptionFields.length
                  ) {
                    setCurrentOptionIndex(
                      Math.max(
                        0,
                        selectedOptionFields.length -
                          1
                      )
                    );

                    setStep(
                      "values"
                    );
                  } else {
                    setStep(
                      "fields"
                    );
                  }
                }}
                style={{
                  padding:
                    "11px 15px",
                  border:
                    "1px solid var(--color-border)",
                  borderRadius:
                    "var(--radius)",
                  background:
                    "var(--surface)",
                  color:
                    "var(--color-text)",
                }}
              >
                ← Înapoi
              </button>

              <button
                type="button"
                onClick={() =>
                  setStep(
                    "repeated"
                  )
                }
                style={{
                  padding:
                    "11px 18px",
                  border: 0,
                  borderRadius:
                    "var(--radius)",
                  background:
                    "var(--color-primary)",
                  color: "#fff",
                  fontWeight: 700,
                }}
              >
                Continuă →
              </button>
            </div>
          </>
        )}

        {/* =====================
            PAS 4 - SET
        ====================== */}

        {step === "repeated" && (
          <>
            <div
              style={{
                fontSize: 30,
                marginBottom: 8,
              }}
            >
              👨‍👩‍👧
            </div>

            <h3
              style={{
                margin:
                  "0 0 8px",
              }}
            >
              Este un set sau un grup?
            </h3>

            <p
              style={{
                margin:
                  "0 0 18px",
                color:
                  "var(--color-muted)",
              }}
            >
              De exemplu, pentru un
              set de tricouri de
              familie, clientul poate
              completa mărimea și
              numele separat pentru
              fiecare membru.
            </p>

            <div
              style={{
                display: "flex",
                gap: 8,
              }}
            >
              <button
                type="button"
                onClick={() => {
                  setRepeatedEnabled(
                    false
                  );

                  setRepeatedFieldKeys(
                    []
                  );
                }}
                style={choiceStyle(
                  !repeatedEnabled
                )}
              >
                Nu
              </button>

              <button
                type="button"
                onClick={() =>
                  setRepeatedEnabled(
                    true
                  )
                }
                style={choiceStyle(
                  repeatedEnabled
                )}
              >
                Da
              </button>
            </div>

            {repeatedEnabled && (
              <div
                style={{
                  marginTop: 18,
                }}
              >
                <strong>
                  Ce trebuie completat
                  pentru fiecare?
                </strong>

                <div
                  style={{
                    display:
                      "grid",
                    gap: 8,
                    marginTop: 10,
                  }}
                >
                  {allGeneratedFields.map(
                    (field) => (
                      <label
                        key={
                          field.key
                        }
                        style={{
                          display:
                            "flex",
                          gap: 10,
                          alignItems:
                            "center",
                          padding:
                            "10px 12px",
                          border:
                            "1px solid var(--color-border)",
                          borderRadius:
                            "var(--radius)",
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={repeatedFieldKeys.includes(
                            field.key
                          )}
                          onChange={() =>
                            toggleRepeatedField(
                              field.key
                            )
                          }
                        />

                        {field.label}
                      </label>
                    )
                  )}
                </div>

                {!repeatedFieldKeys.length && (
                  <p
                    style={{
                      color:
                        "var(--color-warning)",
                      fontSize: 13,
                    }}
                  >
                    Alege cel puțin un
                    câmp care se repetă
                    pentru fiecare
                    membru.
                  </p>
                )}
              </div>
            )}

            <div
              className={modalStyles.actions}
              style={{
                display: "flex",
                justifyContent:
                  "space-between",
                marginTop: 24,
                gap: 10,
              }}
            >
              <button
                type="button"
                onClick={() =>
                  setStep(
                    "required"
                  )
                }
                style={{
                  padding:
                    "11px 15px",
                  border:
                    "1px solid var(--color-border)",
                  borderRadius:
                    "var(--radius)",
                  background:
                    "var(--surface)",
                  color:
                    "var(--color-text)",
                }}
              >
                ← Înapoi
              </button>

              <button
                type="button"
                disabled={
                  repeatedEnabled &&
                  !repeatedFieldKeys.length
                }
                onClick={() =>
                  setStep(
                    "review"
                  )
                }
                style={{
                  padding:
                    "11px 18px",
                  border: 0,
                  borderRadius:
                    "var(--radius)",
                  background:
                    "var(--color-primary)",
                  color: "#fff",
                  fontWeight: 700,
                  opacity:
                    repeatedEnabled &&
                    !repeatedFieldKeys.length
                      ? 0.5
                      : 1,
                }}
              >
                Verifică →
              </button>
            </div>
          </>
        )}

        {/* =====================
            PAS 5 - PREVIEW
        ====================== */}

        {step === "review" && (
          <>
            <div
              style={{
                fontSize: 30,
                marginBottom: 8,
              }}
            >
              ✅
            </div>

            <h3
              style={{
                margin:
                  "0 0 8px",
              }}
            >
              Așa va completa
              clientul
            </h3>

            <p
              style={{
                margin:
                  "0 0 18px",
                color:
                  "var(--color-muted)",
              }}
            >
              Verifică formularul
              înainte să îl aplicăm
              produsului.
            </p>

            <div
              style={{
                display: "grid",
                gap: 12,
              }}
            >
              {generatedOptions.map(
                (field) => (
                  <div
                    key={field.key}
                  >
                    <label>
                      <strong>
                        {field.label}
                        {field.required
                          ? " *"
                          : ""}
                      </strong>
                    </label>

                    <select
                      disabled
                      style={{
                        width:
                          "100%",
                        marginTop:
                          5,
                        padding:
                          "10px 12px",
                        border:
                          "1px solid var(--color-border)",
                        borderRadius:
                          "var(--radius)",
                        background:
                          "var(--surface)",
                        color:
                          "var(--color-text)",
                      }}
                    >
                      <option>
                        Alege{" "}
                        {field.label.toLowerCase()}
                      </option>

                      {field.options.map(
                        (option) => (
                          <option
                            key={
                              option
                            }
                          >
                            {option}
                          </option>
                        )
                      )}
                    </select>
                  </div>
                )
              )}

              {generatedCustom.map(
                (field) => (
                  <div
                    key={field.key}
                  >
                    <label>
                      <strong>
                        {field.label}
                        {field.required
                          ? " *"
                          : ""}
                      </strong>
                    </label>

                    <input
                      disabled
                      placeholder={`Clientul completează ${field.label.toLowerCase()}`}
                      style={{
                        width:
                          "100%",
                        marginTop:
                          5,
                        boxSizing:
                          "border-box",
                        padding:
                          "10px 12px",
                        border:
                          "1px solid var(--color-border)",
                        borderRadius:
                          "var(--radius)",
                        background:
                          "var(--surface)",
                        color:
                          "var(--color-text)",
                      }}
                    />
                  </div>
                )
              )}
            </div>

            {repeatedEnabled && (
              <div
                style={{
                  marginTop: 18,
                  padding: 12,
                  borderRadius:
                    "var(--radius)",
                  background:
                    "color-mix(in srgb, var(--color-primary) 8%, var(--surface))",
                }}
              >
                <strong>
                  👨‍👩‍👧 Set / grup
                </strong>

                <p
                  style={{
                    margin:
                      "5px 0 0",
                    fontSize: 13,
                  }}
                >
                  Clientul va putea
                  adăuga mai mulți
                  membri și va completa
                  pentru fiecare:{" "}
                  {allGeneratedFields
                    .filter(
                      (field) =>
                        repeatedFieldKeys.includes(
                          field.key
                        )
                    )
                    .map(
                      (field) =>
                        field.label
                    )
                    .join(", ")}
                  .
                </p>
              </div>
            )}

            {invalidOption && (
              <div
                style={{
                  marginTop: 15,
                  color:
                    "var(--color-danger)",
                }}
              >
                Completează variantele
                pentru „
                {invalidOption.label}
                ”.
              </div>
            )}

            <div
              className={modalStyles.actions}
              style={{
                display: "flex",
                justifyContent:
                  "space-between",
                gap: 10,
                marginTop: 24,
              }}
            >
              <button
                type="button"
                onClick={() =>
                  setStep(
                    "fields"
                  )
                }
                style={{
                  padding:
                    "11px 15px",
                  border:
                    "1px solid var(--color-border)",
                  borderRadius:
                    "var(--radius)",
                  background:
                    "var(--surface)",
                  color:
                    "var(--color-text)",
                }}
              >
                ← Modifică
              </button>

              <button
                type="button"
                disabled={
                  !canSave
                }
                onClick={
                  saveConfiguration
                }
                style={{
                  padding:
                    "11px 18px",
                  border: 0,
                  borderRadius:
                    "var(--radius)",
                  background:
                    "var(--color-primary)",
                  color: "#fff",
                  fontWeight: 700,
                  opacity:
                    canSave
                      ? 1
                      : 0.5,
                }}
              >
                ✓ Folosește acest
                formular
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}