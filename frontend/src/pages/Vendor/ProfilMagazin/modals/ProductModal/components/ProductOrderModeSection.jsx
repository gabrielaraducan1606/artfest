import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import styles from "../../../components/css/ProductModal.module.css";

const ORDER_MODES = [
  {
    value: "READY_TO_BUY",
    icon: "🛒",
    title: "Se cumpără direct",
    description:
      "Produs cu preț fix și stoc disponibil.",
  },
  {
    value: "OPTIONS",
    icon: "⚙️",
    title: "Se personalizează înainte de comandă",
    description:
      "Clientul alege variante și completează detaliile necesare.",
  },
  {
    value: "QUOTE_ONLY",
    icon: "💬",
    title: "Se cere ofertă",
    description:
      "Clientul trimite cererea, iar tu stabilești prețul ulterior.",
  },
];

const OPTION_FIELDS = [
  {
    key: "culoare",
    label: "Culoare",
    type: "select",
    preset: "colors",
  },
  {
    key: "aroma",
    label: "Aromă / parfum",
    type: "select",
    preset: "scents",
  },
  {
    key: "marime",
    label: "Mărime",
    type: "select",
    options: ["S", "M", "L"],
  },
  {
    key: "material",
    label: "Material",
    type: "select",
    preset: "materials",
  },
];

const CUSTOM_FIELDS = [
  {
    key: "nume",
    label: "Nume",
    type: "text",
  },
  {
    key: "mesaj",
    label: "Mesaj",
    type: "textarea",
  },
  {
    key: "data_eveniment",
    label: "Dată eveniment",
    type: "date",
  },
  {
    key: "text_produs",
    label: "Text pe produs",
    type: "text",
  },
  {
    key: "poza",
    label: "Poză",
    type: "file",
  },
  {
    key: "instructiuni",
    label: "Instrucțiuni speciale",
    type: "textarea",
  },
];

const QUOTE_FIELDS = [
  {
    key: "budget",
    label: "Buget estimativ",
    type: "text",
  },
  {
    key: "deadline",
    label: "Deadline",
    type: "date",
  },
  {
    key: "description",
    label: "Descriere cerere",
    type: "textarea",
  },
  {
    key: "inspirationImages",
    label: "Poze inspirație",
    type: "file",
  },
];

function getSchemaFields(schema) {
  if (Array.isArray(schema)) {
    return schema;
  }

  if (Array.isArray(schema?.fields)) {
    return schema.fields;
  }

  return [];
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

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function normalizeMode(value) {
  if (value === "DIRECT") {
    return "READY_TO_BUY";
  }

  if (value === "CUSTOMIZABLE") {
    return "OPTIONS";
  }

  return value || "READY_TO_BUY";
}

function isStockMode(value) {
  return normalizeMode(value) === "READY_TO_BUY";
}

function formatMode(value) {
  const normalizedValue =
    normalizeMode(value);

  return (
    ORDER_MODES.find(
      (mode) =>
        mode.value === normalizedValue
    )?.title || "Nesetat"
  );
}

function hasSchemaField(schema, key) {
  return getSchemaFields(schema).some(
    (field) => field.key === key
  );
}

function normalizeOptionField(field) {
  return {
    key:
      field.key ||
      makeKey(field.label),

    label:
      String(field.label || "").trim(),

    type:
      field.type || "select",

    required:
      field.required ?? true,

    options:
      Array.isArray(field.options)
        ? field.options
        : [],

    preset:
      field.preset || null,

    sellerCanAddValues:
      field.sellerCanAddValues ??
      true,
  };
}

function normalizeCustomField(field) {
  return {
    key:
      field.key ||
      makeKey(field.label),

    label:
      String(field.label || "").trim(),

    type:
      field.type || "text",

    required:
      field.required ?? false,
  };
}

function normalizeQuoteField(field) {
  return {
    key:
      field.key ||
      makeKey(field.label),

    label:
      String(field.label || "").trim(),

    type:
      field.type || "text",

    required:
      field.required ??
      field.key === "description",
  };
}

function defaultQuoteSchema() {
  return [
    {
      key: "description",
      label: "Descriere cerere",
      type: "textarea",
      required: true,
    },
    {
      key: "inspirationImages",
      label: "Poze inspirație",
      type: "file",
      required: false,
    },
  ];
}

/**
 * Aplică regulile specifice fiecărui mod de comandă.
 */
function applyOrderModeRules(
  currentForm,
  requestedMode
) {
  const orderMode =
    normalizeMode(requestedMode);

  const next = {
    ...currentForm,
    orderMode,
  };

  if (orderMode === "READY_TO_BUY") {
    return {
      ...next,

      acceptsCustom: false,
      availability: "READY",

      leadTimeDays: "",
      nextShipDate: "",

      optionsSchema: [],
      customSchema: [],
      quoteSchema: [],
    };
  }

  if (orderMode === "OPTIONS") {
    return {
      ...next,

      acceptsCustom: true,

      availability:
        !next.availability ||
        next.availability === "READY"
          ? "MADE_TO_ORDER"
          : next.availability,

      readyQty: 0,
      nextShipDate: "",
      quoteSchema: [],
    };
  }

  const currentQuoteFields =
    getSchemaFields(
      currentForm.quoteSchema
    );

  return {
    ...next,

    acceptsCustom: true,
    availability: "MADE_TO_ORDER",

    price: "",
    readyQty: 0,
    nextShipDate: "",

    optionsSchema: [],
    customSchema: [],

    quoteSchema:
      currentQuoteFields.length > 0
        ? currentQuoteFields
        : defaultQuoteSchema(),
  };
}

function markManualChange(
  current,
  patch
) {
  return {
    ...current,
    ...patch,
    aiManuallyEdited: true,
  };
}

function OptionTagComboField({
  id,
  label,
  values = [],
  options = [],
  placeholder = "Alege sau scrie o valoare...",
  note,
  onChange,
}) {
  const [inputValue, setInputValue] =
    useState("");

  const [openList, setOpenList] =
    useState(false);

  const wrapRef = useRef(null);
  const inputRef = useRef(null);

  const selectedValues = useMemo(
    () =>
      Array.isArray(values)
        ? values
            .map((value) =>
              String(value || "").trim()
            )
            .filter(Boolean)
        : [],
    [values]
  );

  useEffect(() => {
    if (!openList) {
      return undefined;
    }

    const handleClickOutside = (
      event
    ) => {
      if (
        !wrapRef.current?.contains(
          event.target
        )
      ) {
        setOpenList(false);
      }
    };

    document.addEventListener(
      "mousedown",
      handleClickOutside
    );

    return () => {
      document.removeEventListener(
        "mousedown",
        handleClickOutside
      );
    };
  }, [openList]);

  const suggestions = useMemo(() => {
    const query =
      normalizeText(inputValue);

    const existingValues = new Set(
      selectedValues.map(normalizeText)
    );

    return options
      .map((item) =>
        String(item || "").trim()
      )
      .filter(Boolean)
      .filter(
        (item, index, array) =>
          array.indexOf(item) === index
      )
      .filter(
        (item) =>
          !existingValues.has(
            normalizeText(item)
          )
      )
      .filter(
        (item) =>
          !query ||
          normalizeText(item).includes(
            query
          )
      )
      .slice(0, 80);
  }, [
    inputValue,
    options,
    selectedValues,
  ]);

  const addValue = (rawValue) => {
    const value = String(
      rawValue || ""
    ).trim();

    if (!value) {
      return;
    }

    const alreadyExists =
      selectedValues.some(
        (item) =>
          normalizeText(item) ===
          normalizeText(value)
      );

    if (!alreadyExists) {
      onChange([
        ...selectedValues,
        value,
      ]);
    }

    setInputValue("");
    setOpenList(false);
  };

  const removeValue = (
    valueToRemove
  ) => {
    onChange(
      selectedValues.filter(
        (item) =>
          item !== valueToRemove
      )
    );
  };

  const handleKeyDown = (
    event
  ) => {
    if (
      event.key === "Enter" ||
      event.key === ","
    ) {
      event.preventDefault();
      addValue(inputValue);
      return;
    }

    if (
      event.key === "Backspace" &&
      !inputValue &&
      selectedValues.length
    ) {
      event.preventDefault();

      removeValue(
        selectedValues[
          selectedValues.length - 1
        ]
      );

      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      setOpenList(false);
    }
  };

  return (
   <div
  ref={wrapRef}
  style={{
    display: "grid",
    gap: 6,
    position: "relative",
    zIndex: openList ? 200 : 1,
  }}
>
      {label && (
        <label
          className={styles.label}
          htmlFor={id}
        >
          {label}
        </label>
      )}

      <div
        className={styles.input}
        style={{
          minHeight: 42,
          display: "flex",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 6,
          paddingTop: 6,
          paddingBottom: 6,
          cursor: "text",
        }}
        onClick={() => {
          setOpenList(true);
          inputRef.current?.focus();
        }}
      >
        {selectedValues.map(
          (item) => (
            <span
              key={item}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                padding: "3px 8px",
                borderRadius: 999,
                fontSize: "0.78rem",
                background:
                  "rgba(0,0,0,0.06)",
              }}
            >
              {item}

              <button
                type="button"
                aria-label={`Șterge ${item}`}
                onClick={(event) => {
                  event.stopPropagation();
                  removeValue(item);
                }}
                style={{
                  border: 0,
                  background:
                    "transparent",
                  cursor: "pointer",
                  padding: 0,
                  lineHeight: 1,
                  color: "inherit",
                }}
              >
                ×
              </button>
            </span>
          )
        )}

        <input
          ref={inputRef}
          id={id}
          value={inputValue}
          autoComplete="off"
          placeholder={
            selectedValues.length
              ? ""
              : placeholder
          }
          onFocus={() =>
            setOpenList(true)
          }
          onChange={(event) => {
            setInputValue(
              event.target.value
            );

            setOpenList(true);
          }}
          onKeyDown={handleKeyDown}
          style={{
            flex: 1,
            minWidth: 120,
            border: 0,
            outline: 0,
            background: "transparent",
            color: "var(--color-text)",
            fontSize: "0.86rem",
          }}
        />
      </div>

      {note && (
        <div
          style={{
            fontSize: "0.75rem",
            opacity: 0.7,
            lineHeight: 1.4,
          }}
        >
          {note}
        </div>
      )}

      {openList && (
        <div
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            right: 0,
            marginTop: 4,
            borderRadius: 10,
            border:
              "1px solid var(--color-border)",
            background: "var(--surface)",
            maxHeight: 220,
            overflowY: "auto",
            boxShadow:
              "var(--shadow-md)",
            zIndex: 30,
          }}
        >
          {suggestions.length ? (
            suggestions.map((item) => (
              <button
                key={item}
                type="button"
                onMouseDown={(event) =>
                  event.preventDefault()
                }
                onClick={() =>
                  addValue(item)
                }
                style={{
                  width: "100%",
                  border: 0,
                  background:
                    "transparent",
                  color:
                    "var(--color-text)",
                  textAlign: "left",
                  padding: "8px 10px",
                  cursor: "pointer",
                  fontSize: "0.86rem",
                }}
              >
                {item}
              </button>
            ))
          ) : (
            <div
              style={{
                padding: "9px 10px",
                fontSize: "0.82rem",
                color:
                  "var(--color-muted)",
              }}
            >
              Nicio sugestie. Scrie o
              valoare și apasă Enter.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SummaryRow({
  title,
  value,
  onEdit,
  muted = false,
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns:
          "minmax(0, 1fr) auto",
        alignItems: "center",
        gap: 12,
        padding: "11px 0",
        borderBottom:
          "1px solid var(--color-border)",
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            marginBottom: 2,
            fontSize: "0.74rem",
            color:
              "var(--color-muted)",
          }}
        >
          {title}
        </div>

        <div
          style={{
            fontSize: "0.88rem",
            fontWeight: 700,
            opacity: muted ? 0.55 : 1,
            overflowWrap: "anywhere",
          }}
        >
          {value}
        </div>
      </div>

      <button
        type="button"
        className={styles.linkBtn}
        onClick={onEdit}
      >
        Modifică
      </button>
    </div>
  );
}

export default function ProductOrderModeSection({
  form,
  setForm,

  quoteSchema,
  addQuoteField,
  updateQuoteField,
  removeQuoteField,
  addQuoteFieldOption,
  updateQuoteFieldOption,
  removeQuoteFieldOption,
}) {
  const [orderHelpOpen, setOrderHelpOpen] =
  useState(false);
  const [
  mobileSummaryOpen,
  setMobileSummaryOpen,
] = useState(false);

  const [
    newOptionLabel,
    setNewOptionLabel,
  ] = useState("");

  const [
    newCustomLabel,
    setNewCustomLabel,
  ] = useState("");

  const [
    openOptionsPanel,
    setOpenOptionsPanel,
  ] = useState(true);

  const [
    openCustomPanel,
    setOpenCustomPanel,
  ] = useState(false);

  const [
    optionPresets,
    setOptionPresets,
  ] = useState({
    colors: [],
    materials: [],
    scents: [],
  });

  const value =
    normalizeMode(form.orderMode);

  const optionFields =
    getSchemaFields(
      form.optionsSchema
    );

  const customFields =
    getSchemaFields(
      form.customSchema
    );

 const quoteFields =
  Array.isArray(quoteSchema)
    ? quoteSchema
    : getSchemaFields(
        form.quoteSchema
      );

  useEffect(() => {
    let active = true;

    fetch(
      "/api/products/option-presets"
    )
      .then((response) =>
        response.ok
          ? response.json()
          : null
      )
      .then((data) => {
        if (!active || !data) {
          return;
        }

        setOptionPresets({
          colors:
            Array.isArray(
              data.colors
            )
              ? data.colors
              : [],

          materials:
            Array.isArray(
              data.materials
            )
              ? data.materials
              : [],

          scents:
            Array.isArray(
              data.scents
            )
              ? data.scents
              : [],
        });
      })
      .catch(() => {
        // Preseturile sunt opționale.
      });

    return () => {
      active = false;
    };
  }, []);

  const getOptionChoices = (
    field
  ) => {
    const definition =
      OPTION_FIELDS.find(
        (item) =>
          item.key === field.key
      );

    const preset =
      field.preset ||
      definition?.preset;

    if (
      preset &&
      Array.isArray(
        optionPresets[preset]
      )
    ) {
      return optionPresets[preset];
    }

    if (
      Array.isArray(
        definition?.options
      )
    ) {
      return definition.options;
    }

    return [];
  };

  const openSection = (
    section
  ) => {
   setMobileSummaryOpen(false);

    if (section === "options") {
      setOpenOptionsPanel(true);
      setOpenCustomPanel(false);
    }

    if (section === "custom") {
      setOpenOptionsPanel(false);
      setOpenCustomPanel(true);
    }

    window.setTimeout(() => {
      document
        .getElementById(
          `manual-section-${section}`
        )
        ?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
    }, 50);
  };

  const selectMode = (
    modeValue
  ) => {
    setForm((current) => ({
      ...applyOrderModeRules(
        current,
        modeValue
      ),

      aiManuallyEdited: true,
    }));
  };

  const setPrice = (
    rawValue
  ) => {
    setForm((current) =>
      markManualChange(current, {
        price:
          rawValue === ""
            ? ""
            : Math.max(
                0,
                Number(rawValue)
              ),
      })
    );
  };

  const setReadyQuantity = (
    rawValue
  ) => {
    setForm((current) =>
      markManualChange(current, {
        availability: "READY",

        readyQty:
          rawValue === ""
            ? ""
            : Math.max(
                0,
                Number(rawValue)
              ),

        leadTimeDays: "",
        nextShipDate: "",
      })
    );
  };

  const setLeadTime = (
    rawValue
  ) => {
    setForm((current) =>
      markManualChange(current, {
        availability:
          "MADE_TO_ORDER",

        leadTimeDays:
          rawValue === ""
            ? ""
            : Math.max(
                1,
                Number(rawValue)
              ),

        readyQty: 0,
        nextShipDate: "",
      })
    );
  };

  const toggleOptionField = (
    field
  ) => {
    setForm((current) => {
      const currentFields =
        getSchemaFields(
          current.optionsSchema
        );

      const normalizedField =
        normalizeOptionField(field);

      const alreadyExists =
        currentFields.some(
          (item) =>
            item.key ===
            normalizedField.key
        );

      const nextFields =
        alreadyExists
          ? currentFields.filter(
              (item) =>
                item.key !==
                normalizedField.key
            )
          : [
              ...currentFields,
              normalizedField,
            ];

      return {
        ...applyOrderModeRules(
          {
            ...current,
            optionsSchema:
              nextFields,
          },
          "OPTIONS"
        ),

        optionsSchema: nextFields,
        aiManuallyEdited: true,
      };
    });
  };

  const addCustomOptionField =
    () => {
      const label =
        newOptionLabel.trim();

      const key =
        makeKey(label);

      if (!key) {
        return;
      }

      setForm((current) => {
        const currentFields =
          getSchemaFields(
            current.optionsSchema
          );

        const alreadyExists =
          currentFields.some(
            (field) =>
              field.key === key
          );

        if (alreadyExists) {
          return current;
        }

        const nextFields = [
          ...currentFields,

          normalizeOptionField({
            key,
            label,
            type: "select",
          }),
        ];

        return {
          ...applyOrderModeRules(
            {
              ...current,
              optionsSchema:
                nextFields,
            },
            "OPTIONS"
          ),

          optionsSchema: nextFields,
          aiManuallyEdited: true,
        };
      });

      setNewOptionLabel("");
    };

  const updateOptionField = (
    fieldKey,
    patch
  ) => {
    setForm((current) =>
      markManualChange(current, {
        optionsSchema:
          getSchemaFields(
            current.optionsSchema
          ).map((field) =>
            field.key === fieldKey
              ? {
                  ...field,
                  ...patch,
                }
              : field
          ),
      })
    );
  };

  const removeOptionField = (
    fieldKey
  ) => {
    setForm((current) =>
      markManualChange(current, {
        optionsSchema:
          getSchemaFields(
            current.optionsSchema
          ).filter(
            (field) =>
              field.key !== fieldKey
          ),
      })
    );
  };

  const toggleCustomField = (
    field
  ) => {
    setForm((current) => {
      const currentFields =
        getSchemaFields(
          current.customSchema
        );

      const normalizedField =
        normalizeCustomField(field);

      const alreadyExists =
        currentFields.some(
          (item) =>
            item.key ===
            normalizedField.key
        );

      const nextFields =
        alreadyExists
          ? currentFields.filter(
              (item) =>
                item.key !==
                normalizedField.key
            )
          : [
              ...currentFields,
              normalizedField,
            ];

      return {
        ...applyOrderModeRules(
          {
            ...current,
            customSchema:
              nextFields,
          },
          "OPTIONS"
        ),

        customSchema: nextFields,
        aiManuallyEdited: true,
      };
    });
  };

  const addCustomInputField =
    () => {
      const label =
        newCustomLabel.trim();

      const key =
        makeKey(label);

      if (!key) {
        return;
      }

      setForm((current) => {
        const currentFields =
          getSchemaFields(
            current.customSchema
          );

        const alreadyExists =
          currentFields.some(
            (field) =>
              field.key === key
          );

        if (alreadyExists) {
          return current;
        }

        const nextFields = [
          ...currentFields,

          normalizeCustomField({
            key,
            label,
            type: "text",
          }),
        ];

        return {
          ...applyOrderModeRules(
            {
              ...current,
              customSchema:
                nextFields,
            },
            "OPTIONS"
          ),

          customSchema: nextFields,
          aiManuallyEdited: true,
        };
      });

      setNewCustomLabel("");
    };

  const updateCustomField = (
    fieldKey,
    patch
  ) => {
    setForm((current) =>
      markManualChange(current, {
        customSchema:
          getSchemaFields(
            current.customSchema
          ).map((field) =>
            field.key === fieldKey
              ? {
                  ...field,
                  ...patch,
                }
              : field
          ),
      })
    );
  };

  const removeCustomField = (
    fieldKey
  ) => {
    setForm((current) =>
      markManualChange(current, {
        customSchema:
          getSchemaFields(
            current.customSchema
          ).filter(
            (field) =>
              field.key !== fieldKey
          ),
      })
    );
  };

  const toggleQuoteField = (
    field
  ) => {
    setForm((current) => {
      const currentFields =
        getSchemaFields(
          current.quoteSchema
        );

      const alreadyExists =
        currentFields.some(
          (item) =>
            item.key === field.key
        );

      const nextFields =
        alreadyExists
          ? currentFields.filter(
              (item) =>
                item.key !==
                field.key
            )
          : [
              ...currentFields,
              normalizeQuoteField(
                field
              ),
            ];

      return {
        ...applyOrderModeRules(
          {
            ...current,
            quoteSchema:
              nextFields,
          },
          "QUOTE_ONLY"
        ),

        quoteSchema: nextFields,
        aiManuallyEdited: true,
      };
    });
  };

  const optionSummary =
    optionFields.length
      ? optionFields
          .map((field) => {
            const fieldValues =
              Array.isArray(
                field.options
              )
                ? field.options
                : [];

            return fieldValues.length
              ? `${field.label}: ${fieldValues.join(
                  ", "
                )}`
              : field.label;
          })
          .join(" • ")
      : "Nicio variantă";

  const customSummary =
    customFields.length
      ? customFields
          .map(
            (field) => field.label
          )
          .join(", ")
      : "Niciun câmp";

  const quoteSummary =
    quoteFields.length
      ? quoteFields
          .map(
            (field) => field.label
          )
          .join(", ")
      : "Formular standard";

return (
  <div className={styles.productSection}>
    {orderHelpOpen && (
  <div className={styles.helpOverlay}>
    <div className={styles.helpModal}>
      <button
        type="button"
        className={styles.helpModalClose}
        onClick={() =>
          setOrderHelpOpen(false)
        }
        aria-label="Închide ajutorul"
      >
        ×
      </button>

      <h3>
        Cum configurezi comenzile?
      </h3>

      <p>
        Alege modul care descrie cel
        mai bine felul în care vinzi
        acest produs.
      </p>

      <div className={styles.helpSteps}>
        <div>
          <strong>
            🛒 Se cumpără direct
          </strong>

          <p>
            Folosește această opțiune
            dacă produsul are un preț
            fix și este disponibil în
            stoc.
          </p>
        </div>

        <div>
          <strong>
            ⚙️ Se personalizează înainte
            de comandă
          </strong>

          <p>
            Folosește această opțiune
            dacă clientul trebuie să
            aleagă variante precum
            culoare, mărime, material
            sau alte opțiuni.
          </p>

          <p>
            Poți adăuga și câmpuri de
            personalizare, precum nume,
            mesaj, text pe produs sau
            fotografie.
          </p>
        </div>

        <div>
          <strong>
            💬 Se cere ofertă
          </strong>

          <p>
            Folosește această opțiune
            atunci când prețul depinde
            de cerințele clientului.
          </p>

          <p>
            Poți configura întrebările
            la care clientul trebuie să
            răspundă înainte să îți
            trimită cererea.
          </p>
        </div>
      </div>

      <div className={styles.helpModalActions}>
        <button
          type="button"
          className={styles.primaryBtn}
          onClick={() =>
            setOrderHelpOpen(false)
          }
        >
          Am înțeles
        </button>
      </div>
    </div>
  </div>
)}
    <div className={styles.sectionHeader}>
  <div
    style={{
      display: "flex",
      alignItems: "center",
      gap: 8,
    }}
  >
    <h4 className={styles.sectionTitle}>
      Configurarea comenzilor
    </h4>

    <button
      type="button"
      className={styles.helpButton}
      onClick={() =>
        setOrderHelpOpen(true)
      }
      aria-label="Ajutor configurare comenzi"
      title="Cum configurez comenzile?"
    >
      ?
    </button>
  </div>

  <p className={styles.sectionDescription}>
    Alege cum poate fi comandat produsul și configurează
    prețul, stocul, variantele și personalizarea.
  </p>
</div>

    <div className={styles.orderLayout}>
       <section
  aria-label="Configurarea produsului"
  className={styles.orderEditor}
>
          <div
            id="manual-section-mode"
            className={
              styles.orderModeCard
            }
          >
            <strong
              className={
                styles.orderConfigTitle
              }
            >
              Cum se comandă produsul?
            </strong>
<div className={styles.orderModeGrid}>
 
</div>
            {ORDER_MODES.map(
              
              (mode) => {
                const selected =
                  value === mode.value;

                return (
                  <button
                    key={mode.value}
                    type="button"
                    className={`${
                      styles.orderModeButton
                    } ${
                      selected
                        ? styles.orderModeButtonActive
                        : ""
                    }`}
                    onClick={() =>
                      selectMode(
                        mode.value
                      )
                    }
                  >
                    <span
                      className={
                        styles.orderModeTitle
                      }
                    >
                      {mode.icon}{" "}
                      {mode.title}
                    </span>

                    <span
                      className={
                        styles.orderModeDescription
                      }
                    >
                      {mode.description}
                    </span>
                  </button>
                );
              }
            )}
          </div>

          <div
  id="manual-section-price"
  className={styles.fieldGroup}
>
            <strong
              className={
                styles.orderConfigTitle
              }
            >
              Preț
            </strong>

            {value ===
            "QUOTE_ONLY" ? (
              <div
                className={styles.tip}
              >
                Prețul va fi stabilit
                după ce clientul trimite
                cererea.
              </div>
            ) : (
              <>
                <label
                  className={
                    styles.label
                  }
                  htmlFor="product-order-price"
                >
                  Preț produs (RON)
                </label>

                <input
                  id="product-order-price"
                  type="number"
                  min={0}
                  step="0.01"
                  className={
                    styles.input
                  }
                  value={
                    form.price ?? ""
                  }
                  onChange={(event) =>
                    setPrice(
                      event.target.value
                    )
                  }
                  placeholder="Ex: 89"
                />
              </>
            )}
          </div>

          <div
  id="manual-section-delivery"
  className={styles.fieldGroup}
>
            <strong
              className={
                styles.orderConfigTitle
              }
            >
              Disponibilitate
            </strong>

            {isStockMode(value) ? (
              <>
                <label
                  className={
                    styles.label
                  }
                  htmlFor="product-ready-quantity"
                >
                  Stoc disponibil
                </label>

                <input
                  id="product-ready-quantity"
                  type="number"
                  min={0}
                  step={1}
                  className={
                    styles.input
                  }
                  value={
                    form.readyQty ?? ""
                  }
                  onChange={(event) =>
                    setReadyQuantity(
                      event.target.value
                    )
                  }
                  placeholder="Ex: 10"
                />

                <div
                  className={styles.tip}
                >
                  Introdu numărul de
                  produse disponibile
                  pentru livrare.
                </div>
              </>
            ) : (
              <>
                <label
                  className={
                    styles.label
                  }
                  htmlFor="product-lead-time"
                >
                  Timp estimat de
                  realizare
                </label>

                <input
                  id="product-lead-time"
                  type="number"
                  min={1}
                  step={1}
                  className={
                    styles.input
                  }
                  value={
                    form.leadTimeDays ??
                    ""
                  }
                  onChange={(event) =>
                    setLeadTime(
                      event.target.value
                    )
                  }
                  placeholder="Număr de zile"
                />

                <div
                  className={styles.tip}
                >
                  Spune clientului în
                  câte zile poate fi
                  realizată comanda.
                </div>
              </>
            )}
          </div>

          {value === "OPTIONS" && (
            <div
              className={
                styles.orderAccordionWrap
              }
            >
              <div
                id="manual-section-options"
                className={
                  styles.orderAccordionItem
                }
              >
                <button
                  type="button"
                  className={
                    styles.orderAccordionHeader
                  }
                  onClick={() =>
                    setOpenOptionsPanel(
                      (open) => !open
                    )
                  }
                >
                  <span>
                    <strong>
                      Variante disponibile
                    </strong>

                    <small>
                      {optionFields.length
                        ? `${optionFields.length} variante configurate`
                        : "Culoare, aromă, mărime, material sau model"}
                    </small>
                  </span>

                  <span
                    className={
                      styles.orderAccordionIcon
                    }
                  >
                    {openOptionsPanel
                      ? "−"
                      : "+"}
                  </span>
                </button>

                {openOptionsPanel && (
                  <div
                    className={
                      styles.orderAccordionBody
                    }
                  >
                    <div
                      className={
                        styles.orderCheckboxGrid
                      }
                    >
                      {OPTION_FIELDS.map(
                        (field) => (
                          <label
                            key={
                              field.key
                            }
                            className={
                              styles.checkbox
                            }
                          >
                            <input
                              type="checkbox"
                              checked={hasSchemaField(
                                optionFields,
                                field.key
                              )}
                              onChange={() =>
                                toggleOptionField(
                                  field
                                )
                              }
                            />

                            {field.label}
                          </label>
                        )
                      )}
                    </div>

                    <div
                      className={
                        styles.orderInlineRow
                      }
                    >
                      <input
                        className={
                          styles.input
                        }
                        value={
                          newOptionLabel
                        }
                        onChange={(
                          event
                        ) =>
                          setNewOptionLabel(
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
                            addCustomOptionField();
                          }
                        }}
                        placeholder="Creează atribut nou, ex: Model"
                      />

                      <button
                        type="button"
                        className={
                          styles.smallBtn
                        }
                        onClick={
                          addCustomOptionField
                        }
                        disabled={
                          !newOptionLabel.trim()
                        }
                      >
                        Adaugă
                      </button>
                    </div>

                    {!!optionFields.length && (
                      <div
                        className={
                          styles.orderFieldsList
                        }
                      >
                        {optionFields.map(
                          (field) => (
                            <div
                              key={
                                field.key
                              }
                              className={
                                styles.orderFieldCard
                              }
                            >
                              <div
                                className={
                                  styles.orderFieldHeader
                                }
                              >
                                <strong>
                                  {field.label}
                                </strong>

                                <button
                                  type="button"
                                  className={
                                    styles.linkBtn
                                  }
                                  onClick={() =>
                                    removeOptionField(
                                      field.key
                                    )
                                  }
                                >
                                  Șterge
                                </button>
                              </div>

                              <label
                                className={
                                  styles.label
                                }
                                htmlFor={`option-label-${field.key}`}
                              >
                                Nume variantă
                              </label>

                              <input
                                id={`option-label-${field.key}`}
                                className={
                                  styles.input
                                }
                                value={
                                  field.label ||
                                  ""
                                }
                                onChange={(
                                  event
                                ) =>
                                  updateOptionField(
                                    field.key,
                                    {
                                      label:
                                        event
                                          .target
                                          .value,
                                    }
                                  )
                                }
                              />

                              <OptionTagComboField
                                id={`option-values-${field.key}`}
                                label="Opțiuni disponibile pentru client"
                                values={
                                  Array.isArray(
                                    field.options
                                  )
                                    ? field.options
                                    : []
                                }
                                options={getOptionChoices(
                                  field
                                )}
                                note="Poți selecta o sugestie sau poți scrie o valoare proprie."
                                onChange={(
                                  options
                                ) =>
                                  updateOptionField(
                                    field.key,
                                    {
                                      options,
                                    }
                                  )
                                }
                              />

                              <label
                                className={
                                  styles.checkbox
                                }
                              >
                                <input
                                  type="checkbox"
                                  checked={
                                    field.required !==
                                    false
                                  }
                                  onChange={(
                                    event
                                  ) =>
                                    updateOptionField(
                                      field.key,
                                      {
                                        required:
                                          event
                                            .target
                                            .checked,
                                      }
                                    )
                                  }
                                />

                                Alegerea este
                                obligatorie
                              </label>
                            </div>
                          )
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div
                id="manual-section-custom"
                className={
                  styles.orderAccordionItem
                }
              >
                <button
                  type="button"
                  className={
                    styles.orderAccordionHeader
                  }
                  onClick={() =>
                    setOpenCustomPanel(
                      (open) => !open
                    )
                  }
                >
                  <span>
                    <strong>
                      Personalizare
                    </strong>

                    <small>
                      {customFields.length
                        ? `${customFields.length} câmpuri configurate`
                        : "Nume, mesaj, poză sau instrucțiuni speciale"}
                    </small>
                  </span>

                  <span
                    className={
                      styles.orderAccordionIcon
                    }
                  >
                    {openCustomPanel
                      ? "−"
                      : "+"}
                  </span>
                </button>

                {openCustomPanel && (
                  <div
                    className={
                      styles.orderAccordionBody
                    }
                  >
                    <div
                      className={
                        styles.orderCheckboxGrid
                      }
                    >
                      {CUSTOM_FIELDS.map(
                        (field) => (
                          <label
                            key={
                              field.key
                            }
                            className={
                              styles.checkbox
                            }
                          >
                            <input
                              type="checkbox"
                              checked={hasSchemaField(
                                customFields,
                                field.key
                              )}
                              onChange={() =>
                                toggleCustomField(
                                  field
                                )
                              }
                            />

                            {field.label}
                          </label>
                        )
                      )}
                    </div>

                    <div
                      className={
                        styles.orderInlineRow
                      }
                    >
                      <input
                        className={
                          styles.input
                        }
                        value={
                          newCustomLabel
                        }
                        onChange={(
                          event
                        ) =>
                          setNewCustomLabel(
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
                            addCustomInputField();
                          }
                        }}
                        placeholder="Adaugă câmp nou, ex: Inițiale"
                      />

                      <button
                        type="button"
                        className={
                          styles.smallBtn
                        }
                        onClick={
                          addCustomInputField
                        }
                        disabled={
                          !newCustomLabel.trim()
                        }
                      >
                        Adaugă
                      </button>
                    </div>

                    {!!customFields.length && (
                      <div
                        className={
                          styles.orderFieldsList
                        }
                      >
                        {customFields.map(
                          (field) => (
                            <div
                              key={
                                field.key
                              }
                              className={
                                styles.orderFieldCard
                              }
                            >
                              <div
                                className={
                                  styles.orderFieldHeader
                                }
                              >
                                <strong>
                                  {field.label}
                                </strong>

                                <button
                                  type="button"
                                  className={
                                    styles.linkBtn
                                  }
                                  onClick={() =>
                                    removeCustomField(
                                      field.key
                                    )
                                  }
                                >
                                  Șterge
                                </button>
                              </div>

                              <label
                                className={
                                  styles.label
                                }
                                htmlFor={`custom-label-${field.key}`}
                              >
                                Nume câmp
                              </label>

                              <input
                                id={`custom-label-${field.key}`}
                                className={
                                  styles.input
                                }
                                value={
                                  field.label ||
                                  ""
                                }
                                onChange={(
                                  event
                                ) =>
                                  updateCustomField(
                                    field.key,
                                    {
                                      label:
                                        event
                                          .target
                                          .value,
                                    }
                                  )
                                }
                              />

                              <label
                                className={
                                  styles.label
                                }
                                htmlFor={`custom-type-${field.key}`}
                              >
                                Tip câmp
                              </label>

                              <select
                                id={`custom-type-${field.key}`}
                                className={
                                  styles.input
                                }
                                value={
                                  field.type ||
                                  "text"
                                }
                                onChange={(
                                  event
                                ) =>
                                  updateCustomField(
                                    field.key,
                                    {
                                      type:
                                        event
                                          .target
                                          .value,
                                    }
                                  )
                                }
                              >
                                <option value="text">
                                  Text scurt
                                </option>

                                <option value="textarea">
                                  Text lung
                                </option>

                                <option value="date">
                                  Dată
                                </option>

                                <option value="file">
                                  Fișier / poză
                                </option>
                              </select>

                              <label
                                className={
                                  styles.checkbox
                                }
                              >
                                <input
                                  type="checkbox"
                                  checked={
                                    field.required ===
                                    true
                                  }
                                  onChange={(
                                    event
                                  ) =>
                                    updateCustomField(
                                      field.key,
                                      {
                                        required:
                                          event
                                            .target
                                            .checked,
                                      }
                                    )
                                  }
                                />

                                Câmp obligatoriu
                              </label>
                            </div>
                          )
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

         {value === "QUOTE_ONLY" && (
  <div
    id="manual-section-quote"
    className={styles.fieldGroup}
  >
    <strong
      className={
        styles.orderConfigTitle
      }
    >
      Formular pentru cererea de ofertă
    </strong>

    <p
      style={{
        margin: "0 0 12px",
        fontSize: "0.82rem",
        color: "var(--color-muted)",
      }}
    >
      Alege informațiile pe care clientul
      trebuie să le trimită sau adaugă
      întrebări proprii.
    </p>

    <div
      className={
        styles.orderCheckboxGrid
      }
    >
      {QUOTE_FIELDS.map(
        (field) => (
          <label
            key={field.key}
            className={
              styles.checkbox
            }
          >
            <input
              type="checkbox"
              checked={hasSchemaField(
                quoteFields,
                field.key
              )}
              onChange={() =>
                toggleQuoteField(
                  field
                )
              }
            />

            {field.label}
          </label>
        )
      )}
    </div>

    <div
      style={{
        marginTop: 18,
        display: "grid",
        gap: 12,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent:
            "space-between",
          gap: 12,
        }}
      >
        <div>
          <strong>
            Câmpuri personalizate
          </strong>

          <div
            style={{
              marginTop: 4,
              fontSize: "0.78rem",
              color:
                "var(--color-muted)",
            }}
          >
            Adaugă întrebări proprii
            pentru client.
          </div>
        </div>

        <button
          type="button"
          className={
            styles.smallBtn
          }
          onClick={
            addQuoteField
          }
        >
          + Adaugă câmp
        </button>
      </div>

   {Array.isArray(
  quoteFields
) &&
  quoteFields.some(
    (field) => field.id
  ) && (
          <div
            className={
              styles.orderFieldsList
            }
          >
           {quoteFields
  .filter(
    (field) => field.id
  )
  .map(
    (field) => (
                <div
                  key={
                    field.id ||
                    field.key
                  }
                  className={
                    styles.orderFieldCard
                  }
                >
                  <div
                    className={
                      styles.orderFieldHeader
                    }
                  >
                    <strong>
                      {field.label ||
                        "Câmp nou"}
                    </strong>

                    {field.id && (
                      <button
                        type="button"
                        className={
                          styles.linkBtn
                        }
                        onClick={() =>
                          removeQuoteField(
                            field.id
                          )
                        }
                      >
                        Șterge
                      </button>
                    )}
                  </div>

                  {field.id && (
                    <>
                      <label
                        className={
                          styles.label
                        }
                      >
                        Întrebare pentru client
                      </label>

                      <input
                        className={
                          styles.input
                        }
                        value={
                          field.label ||
                          ""
                        }
                        placeholder="Ex: Ce text dorești pe produs?"
                        onChange={(
                          event
                        ) =>
                          updateQuoteField(
                            field.id,
                            {
                              label:
                                event
                                  .target
                                  .value,
                            }
                          )
                        }
                      />

                      <label
                        className={
                          styles.label
                        }
                      >
                        Tip răspuns
                      </label>

                      <select
                        className={
                          styles.input
                        }
                        value={
                          field.type ||
                          "text"
                        }
                        onChange={(
                          event
                        ) =>
                          updateQuoteField(
                            field.id,
                            {
                              type:
                                event
                                  .target
                                  .value,

                              options:
                                event
                                  .target
                                  .value ===
                                "select"
                                  ? field.options ||
                                    []
                                  : [],
                            }
                          )
                        }
                      >
                        <option value="text">
                          Text scurt
                        </option>

                        <option value="textarea">
                          Text lung
                        </option>

                        <option value="number">
                          Număr
                        </option>

                        <option value="date">
                          Dată
                        </option>

                        <option value="select">
                          Alegere din listă
                        </option>
                      </select>

                      <label
                        className={
                          styles.checkbox
                        }
                      >
                        <input
                          type="checkbox"
                          checked={
                            field.required ===
                            true
                          }
                          onChange={(
                            event
                          ) =>
                            updateQuoteField(
                              field.id,
                              {
                                required:
                                  event
                                    .target
                                    .checked,
                              }
                            )
                          }
                        />

                        Câmp obligatoriu
                      </label>

                      {field.type ===
                        "select" && (
                        <div
                          style={{
                            display:
                              "grid",
                            gap: 8,
                          }}
                        >
                          <label
                            className={
                              styles.label
                            }
                          >
                            Opțiuni disponibile
                          </label>

                          {(
                            Array.isArray(
                              field.options
                            )
                              ? field.options
                              : []
                          ).map(
                            (
                              option,
                              optionIndex
                            ) => (
                              <div
                                key={
                                  optionIndex
                                }
                                className={
                                  styles.orderInlineRow
                                }
                              >
                                <input
                                  className={
                                    styles.input
                                  }
                                  value={
                                    option
                                  }
                                  placeholder="Ex: Alb"
                                  onChange={(
                                    event
                                  ) =>
                                    updateQuoteFieldOption(
                                      field.id,
                                      optionIndex,
                                      event
                                        .target
                                        .value
                                    )
                                  }
                                />

                                <button
                                  type="button"
                                  className={
                                    styles.linkBtn
                                  }
                                  onClick={() =>
                                    removeQuoteFieldOption(
                                      field.id,
                                      optionIndex
                                    )
                                  }
                                >
                                  Șterge
                                </button>
                              </div>
                            )
                          )}

                          <button
                            type="button"
                            className={
                              styles.smallBtn
                            }
                            onClick={() =>
                              addQuoteFieldOption(
                                field.id
                              )
                            }
                          >
                            + Adaugă opțiune
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )
            )}
          </div>
        )}
    </div>
  </div>
)}
        </section>

        <aside
  aria-label="Rezumat configurație"
  className={`${styles.orderSummary} ${
    mobileSummaryOpen
      ? styles.orderSummaryOpen
      : ""
  }`}
>
  <button
    type="button"
    className={
      styles.orderSummaryMobileHeader
    }
    onClick={() =>
      setMobileSummaryOpen(
        (open) => !open
      )
    }
    aria-expanded={
      mobileSummaryOpen
    }
    aria-controls="mobile-order-summary"
  >
    <span
      className={
        styles.orderSummaryMobileHeading
      }
    >
      <strong>
        📦 Rezumat comandă
      </strong>

      <small>
        {formatMode(value)}
      </small>
    </span>

    <span
      className={
        styles.orderSummaryMobileIcon
      }
      aria-hidden="true"
    >
      {mobileSummaryOpen
        ? "−"
        : "+"}
    </span>
  </button>

  <div
    id="mobile-order-summary"
    className={
      styles.orderSummaryContent
    }
  >
    <div
      className={
        styles.orderSummaryDesktopTitle
      }
    >
      <strong>
        📦 Rezumat comandă
      </strong>
    </div>

    <SummaryRow
      title="Mod de comandă"
      value={formatMode(value)}
      onEdit={() =>
        openSection("mode")
      }
    />

    <SummaryRow
      title="Preț"
      value={
        value === "QUOTE_ONLY"
          ? "Se stabilește prin ofertă"
          : form.price !== "" &&
            form.price != null
          ? `${form.price} RON`
          : "Nesetat"
      }
      muted={
        value !== "QUOTE_ONLY" &&
        (form.price === "" ||
          form.price == null)
      }
      onEdit={() =>
        openSection("price")
      }
    />

    <SummaryRow
      title={
        isStockMode(value)
          ? "Stoc"
          : "Timp de realizare"
      }
      value={
        isStockMode(value)
          ? form.readyQty !== "" &&
            form.readyQty != null
            ? `${Number(
                form.readyQty
              )} buc.`
            : "Nesetat"
          : form.leadTimeDays
          ? `${form.leadTimeDays} zile`
          : "Nesetat"
      }
      muted={
        isStockMode(value)
          ? form.readyQty === "" ||
            form.readyQty == null
          : !form.leadTimeDays
      }
      onEdit={() =>
        openSection("delivery")
      }
    />

    {value === "OPTIONS" && (
      <>
        <SummaryRow
          title="Variante"
          value={optionSummary}
          muted={!optionFields.length}
          onEdit={() =>
            openSection("options")
          }
        />

        <SummaryRow
          title="Personalizare"
          value={customSummary}
          muted={!customFields.length}
          onEdit={() =>
            openSection("custom")
          }
        />
      </>
    )}

    {value === "QUOTE_ONLY" && (
      <SummaryRow
        title="Formular ofertă"
        value={quoteSummary}
        muted={!quoteFields.length}
        onEdit={() =>
          openSection("quote")
        }
      />
    )}
  </div>
</aside>
      </div>
    </div>
  );
}