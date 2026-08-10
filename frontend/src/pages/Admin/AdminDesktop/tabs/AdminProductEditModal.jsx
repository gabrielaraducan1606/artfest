import {
  useEffect,
  useMemo,
  useState,
} from "react";

import { api } from "../../../../lib/api";

/* =========================================================
   Helpers
========================================================= */

function asArray(value) {
  return Array.isArray(value)
    ? value
    : [];
}

function asText(value) {
  if (
    value === null ||
    value === undefined
  ) {
    return "";
  }

  return String(value);
}

function makeKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(
      /[\u0300-\u036f]/g,
      ""
    )
    .replace(
      /[^a-z0-9]+/g,
      "_"
    )
    .replace(
      /^_+|_+$/g,
      ""
    );
}

function normalizeSchema(
  value
) {
  return asArray(value)
    .map((field) => {
      if (
        !field ||
        typeof field !==
          "object"
      ) {
        return null;
      }

      return {
        ...field,

        key:
          field.key ||
          makeKey(
            field.label
          ),

        label:
          asText(
            field.label
          ),

        type:
          field.type ||
          "text",

        required:
          field.required ===
          true,
      };
    })
    .filter(Boolean);
}

function normalizeRepeatedGroups(
  value
) {
  return asArray(value)
    .map((group) => {
      if (
        !group ||
        typeof group !==
          "object"
      ) {
        return null;
      }

      const fieldKeys =
        asArray(
          group.fields
        )
          .map((field) => {
            /*
             * Format simplu:
             * "marime"
             */
            if (
              typeof field ===
              "string"
            ) {
              return field.trim();
            }

            /*
             * Format vendor:
             * {
             *   key: "marime",
             *   label: "Mărime"
             * }
             */
            if (
              field &&
              typeof field ===
                "object"
            ) {
              return String(
                field.key ||
                  field.value ||
                  ""
              ).trim();
            }

            return "";
          })
          .filter(Boolean);

      /*
       * Eliminăm automat
       * duplicatele.
       */
      const uniqueFieldKeys =
        [
          ...new Set(
            fieldKeys
          ),
        ];

      return {
        ...group,

        key:
          group.key ||
          makeKey(
            group.label ||
              group.name ||
              "grup"
          ),

        label:
          asText(
            group.label ||
              group.name ||
              "Grup"
          ),

        fields:
          uniqueFieldKeys,
      };
    })
    .filter(Boolean);
}

/* =========================================================
   Field editor
========================================================= */

function SchemaEditor({
  title,
  description,
  fields,
  onChange,
}) {
  function updateField(
    index,
    patch
  ) {
    const next =
      [...fields];

    next[index] = {
      ...next[index],
      ...patch,
    };

    onChange(next);
  }

  function addField() {
    onChange([
      ...fields,
      {
        key: "",
        label: "",
        type: "text",
        required: false,
      },
    ]);
  }

  function removeField(
    index
  ) {
    onChange(
      fields.filter(
        (_, i) =>
          i !== index
      )
    );
  }

  return (
    <div
      style={{
        padding: 16,
        border:
          "1px solid #e5e7eb",
        borderRadius: 12,
        background:
          "#fff",
      }}
    >
      <div
        style={{
          fontWeight: 700,
          marginBottom: 4,
        }}
      >
        {title}
      </div>

      {description && (
        <div
          style={{
            fontSize: 13,
            color: "#6b7280",
            marginBottom: 12,
          }}
        >
          {description}
        </div>
      )}

      {fields.length ===
        0 && (
        <div
          style={{
            fontSize: 13,
            color: "#6b7280",
            marginBottom: 10,
          }}
        >
          Nu există câmpuri.
        </div>
      )}

      {fields.map(
        (
          field,
          index
        ) => (
          <div
            key={
              field.key ||
              index
            }
            style={{
              display:
                "grid",
              gridTemplateColumns:
                "minmax(180px, 1fr) 150px auto auto",
              gap: 8,
              alignItems:
                "center",
              marginBottom: 8,
            }}
          >
            <input
              value={
                field.label ||
                ""
              }
              placeholder="Ex: Mărime"
              onChange={(
                e
              ) => {
                const label =
                  e.target
                    .value;

                updateField(
                  index,
                  {
                    label,

                    key:
                      field.key ||
                      makeKey(
                        label
                      ),
                  }
                );
              }}
              style={{
                width: "100%",
                padding:
                  "9px 10px",
                border:
                  "1px solid #d1d5db",
                borderRadius:
                  8,
              }}
            />

            <select
              value={
                field.type ||
                "text"
              }
              onChange={(
                e
              ) =>
                updateField(
                  index,
                  {
                    type:
                      e.target
                        .value,
                  }
                )
              }
              style={{
                padding:
                  "9px 10px",
                border:
                  "1px solid #d1d5db",
                borderRadius:
                  8,
              }}
            >
              <option value="text">
                Text
              </option>

              <option value="textarea">
                Text lung
              </option>

              <option value="select">
                Selectare
              </option>

              <option value="number">
                Număr
              </option>

              <option value="date">
                Dată
              </option>

              <option value="file">
                Fișier
              </option>
            </select>

            <label
              style={{
                display:
                  "flex",
                gap: 5,
                alignItems:
                  "center",
                fontSize: 13,
              }}
            >
              <input
                type="checkbox"
                checked={
                  field.required ===
                  true
                }
                onChange={(
                  e
                ) =>
                  updateField(
                    index,
                    {
                      required:
                        e.target
                          .checked,
                    }
                  )
                }
              />

              Obligatoriu
            </label>

            <button
              type="button"
              onClick={() =>
                removeField(
                  index
                )
              }
              style={{
                border:
                  "1px solid #fecaca",
                background:
                  "#fff",
                color:
                  "#b91c1c",
                borderRadius:
                  8,
                padding:
                  "8px 10px",
                cursor:
                  "pointer",
              }}
            >
              Șterge
            </button>
          </div>
        )
      )}

      <button
        type="button"
        onClick={addField}
        style={{
          marginTop: 4,
          border:
            "1px solid #d1d5db",
          background:
            "#fff",
          borderRadius: 8,
          padding:
            "8px 12px",
          cursor: "pointer",
        }}
      >
        + Adaugă câmp
      </button>
    </div>
  );
}

/* =========================================================
   Repeated groups editor
========================================================= */

function RepeatedGroupsEditor({
  groups,
  availableFields,
  onChange,
}) {
  const first =
    groups[0] || null;

  const enabled =
    Boolean(first);

  const selectedFields =
  [
    ...new Set(
      asArray(
        first?.fields
      )
        .map((field) => {
          if (
            typeof field ===
            "string"
          ) {
            return field.trim();
          }

          if (
            field &&
            typeof field ===
              "object"
          ) {
            return String(
              field.key ||
                field.value ||
                ""
            ).trim();
          }

          return "";
        })
        .filter(Boolean)
    ),
  ];

  function toggleEnabled(
    checked
  ) {
    if (!checked) {
      onChange([]);
      return;
    }

    onChange([
      {
        key:
          "personalizari_repetate",

        label:
          "Personalizări repetate",

        fields: [],
      },
    ]);
  }

 function toggleField(
  fieldKey
) {
  if (!first) {
    return;
  }

  const normalizedKey =
    String(
      fieldKey || ""
    ).trim();

  if (!normalizedKey) {
    return;
  }

  const exists =
    selectedFields.includes(
      normalizedKey
    );

  const nextFields =
    exists
      ? selectedFields.filter(
          (key) =>
            key !==
            normalizedKey
        )
      : [
          ...selectedFields,
          normalizedKey,
        ];

  onChange([
    {
      ...first,

      fields: [
        ...new Set(
          nextFields
        ),
      ],
    },
  ]);
}

  return (
    <div
      style={{
        padding: 16,
        border:
          "1px solid #e5e7eb",
        borderRadius: 12,
        background:
          "#fff",
      }}
    >
      <label
        style={{
          display: "flex",
          gap: 8,
          alignItems:
            "center",
          fontWeight: 700,
        }}
      >
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) =>
            toggleEnabled(
              e.target
                .checked
            )
          }
        />

        Este un set / grup cu
        personalizări diferite?
      </label>

      <div
        style={{
          marginTop: 6,
          fontSize: 13,
          color: "#6b7280",
        }}
      >
        Exemplu: tricouri
        pentru mai multe
        persoane, fiecare cu
        propria mărime sau
        culoare.
      </div>

      {enabled && (
        <div
          style={{
            marginTop: 14,
          }}
        >
          <div
            style={{
              fontWeight:
                600,
              marginBottom:
                8,
            }}
          >
            Ce câmpuri trebuie
            completate separat
            pentru fiecare?
          </div>

          {availableFields
            .length ===
            0 ? (
            <div
              style={{
                fontSize:
                  13,
                color:
                  "#6b7280",
              }}
            >
              Adaugă mai întâi
              câmpuri în
              „Opțiuni” sau
              „Personalizare”.
            </div>
          ) : (
            availableFields.map(
              (
                field
              ) => (
                <label
                  key={
                    field.key
                  }
                  style={{
                    display:
                      "flex",
                    gap: 8,
                    alignItems:
                      "center",
                    marginBottom:
                      7,
                    fontSize:
                      14,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={selectedFields.includes(
                      field.key
                    )}
                    onChange={() =>
                      toggleField(
                        field.key
                      )
                    }
                  />

                  {field.label ||
                    field.key}
                </label>
              )
            )
          )}
        </div>
      )}
    </div>
  );
}

/* =========================================================
   Main component
========================================================= */

export default function AdminProductEditForm({
  product,
  onSaved,
  onCancel,
}) {
  const [form, setForm] =
    useState(null);

  const [saving, setSaving] =
    useState(false);

  const [error, setError] =
    useState("");

  useEffect(() => {
    if (!product) {
      setForm(null);
      return;
    }

    setForm({
      title:
        product.title ||
        "",

      description:
        product.description ||
        "",

      price:
        product.price ??
        (
          Number(
            product.priceCents ||
              0
          ) / 100
        ),

      currency:
        product.currency ||
        "RON",

      category:
        product.category ||
        "",

      images:
        asArray(
          product.images
        ),

      color:
        product.color ||
        "",

      materialMain:
        product.materialMain ||
        "",

      technique:
        product.technique ||
        "",

      styleTags:
        Array.isArray(
          product.styleTags
        )
          ? product.styleTags.join(
              ", "
            )
          : asText(
              product.styleTags
            ),

      occasionTags:
        Array.isArray(
          product.occasionTags
        )
          ? product.occasionTags.join(
              ", "
            )
          : asText(
              product.occasionTags
            ),

      dimensions:
        product.dimensions ||
        "",

      careInstructions:
        product.careInstructions ||
        "",

      specialNotes:
        product.specialNotes ||
        "",

      isActive:
        product.isActive !==
        false,

      isHidden:
        product.isHidden ===
        true,

      acceptsCustom:
        product.acceptsCustom ===
        true,

      orderMode:
        product.orderMode ||
        "DIRECT",

      optionsSchema:
        normalizeSchema(
          product.optionsSchema
        ),

      customSchema:
        normalizeSchema(
          product.customSchema
        ),

      repeatedGroups:
        normalizeRepeatedGroups(
          product.repeatedGroups
        ),

      quoteSchema:
        normalizeSchema(
          product.quoteSchema
        ),

      availability:
        product.availability ||
        "READY",

      readyQty:
        product.readyQty ??
        "",

      leadTimeDays:
        product.leadTimeDays ??
        "",

      nextShipDate:
        product.nextShipDate
          ? String(
              product.nextShipDate
            ).slice(
              0,
              10
            )
          : "",
    });

    setError("");
  }, [product]);

  const availableRepeatedFields =
    useMemo(() => {
      if (!form) {
        return [];
      }

      const all = [
        ...form.optionsSchema,
        ...form.customSchema,
      ];

      const seen =
        new Set();

      return all.filter(
        (field) => {
          const key =
            field.key ||
            makeKey(
              field.label
            );

          if (
            !key ||
            seen.has(key)
          ) {
            return false;
          }

          seen.add(key);

          return true;
        }
      );
    }, [form]);

  if (!form) {
    return null;
  }

  function patch(
    values
  ) {
    setForm(
      (current) => ({
        ...current,
        ...values,
      })
    );
  }

  function changeMode(
    nextMode
  ) {
    if (
      nextMode ===
      "DIRECT"
    ) {
      patch({
        orderMode:
          nextMode,

        acceptsCustom:
          false,

        optionsSchema:
          [],

        customSchema:
          [],

        repeatedGroups:
          [],

        quoteSchema:
          [],
      });

      return;
    }

    if (
      nextMode ===
      "OPTIONS"
    ) {
      patch({
        orderMode:
          nextMode,

        acceptsCustom:
          true,

        quoteSchema:
          [],

        availability:
          form.availability ===
          "READY"
            ? "MADE_TO_ORDER"
            : form.availability,
      });

      return;
    }

    patch({
      orderMode:
        "QUOTE_ONLY",

      acceptsCustom:
        true,

      optionsSchema:
        [],

      customSchema:
        [],

      repeatedGroups:
        [],

      price: 0,

      availability:
        "MADE_TO_ORDER",
    });
  }

  async function save() {
    const title =
      form.title.trim();

    if (!title) {
      setError(
        "Titlul este obligatoriu."
      );

      return;
    }

    if (
      form.orderMode !==
      "QUOTE_ONLY"
    ) {
      const price =
        Number(
          form.price
        );

      if (
        !Number.isFinite(
          price
        ) ||
        price < 0
      ) {
        setError(
          "Prețul nu este valid."
        );

        return;
      }
    }

    try {
      setSaving(true);
      setError("");

      const payload = {
        ...form,

        title,

        description:
          form.description ||
          "",

        price:
          form.orderMode ===
          "QUOTE_ONLY"
            ? 0
            : Number(
                form.price
              ),

        images:
          asArray(
            form.images
          ).filter(Boolean),

        optionsSchema:
          normalizeSchema(
            form.optionsSchema
          ),

        customSchema:
          normalizeSchema(
            form.customSchema
          ),

        repeatedGroups:
          normalizeRepeatedGroups(
            form.repeatedGroups
          ),

        quoteSchema:
          normalizeSchema(
            form.quoteSchema
          ),

        readyQty:
          form.readyQty ===
          ""
            ? null
            : Number(
                form.readyQty
              ),

        leadTimeDays:
          form.leadTimeDays ===
          ""
            ? null
            : Number(
                form.leadTimeDays
              ),

        nextShipDate:
          form.nextShipDate ||
          null,
      };

      const data =
        await api(
          `/api/admin/products/${product.id}`,
          {
            method:
              "PATCH",

            body:
              payload,
          }
        );

      onSaved?.(
        data?.product ||
          {
            ...product,
            ...payload,
          }
      );
    } catch (e) {
      setError(
        e?.data?.message ||
          e?.message ||
          "Produsul nu a putut fi salvat."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      style={{
        display: "grid",
        gap: 16,
      }}
    >
      {error && (
        <div
          style={{
            padding:
              "10px 12px",
            border:
              "1px solid #fecaca",
            background:
              "#fef2f2",
            color:
              "#991b1b",
            borderRadius:
              10,
          }}
        >
          {error}
        </div>
      )}

      {/* =====================
          INFORMAȚII
      ====================== */}

      <section
        style={{
          display:
            "grid",
          gap: 12,
        }}
      >
        <h4
          style={{
            margin: 0,
          }}
        >
          Informații produs
        </h4>

        <label>
          <div>
            Titlu
          </div>

          <input
            value={
              form.title
            }
            onChange={(e) =>
              patch({
                title:
                  e.target
                    .value,
              })
            }
            style={inputStyle}
          />
        </label>

        <label>
          <div>
            Descriere
          </div>

          <textarea
            value={
              form.description
            }
            onChange={(e) =>
              patch({
                description:
                  e.target
                    .value,
              })
            }
            rows={5}
            style={{
              ...inputStyle,
              resize:
                "vertical",
            }}
          />
        </label>

        <div
          style={
            twoColumns
          }
        >
          <label>
            <div>
              Preț
            </div>

            <input
              type="number"
              min="0"
              step="0.01"
              disabled={
                form.orderMode ===
                "QUOTE_ONLY"
              }
              value={
                form.price
              }
              onChange={(e) =>
                patch({
                  price:
                    e.target
                      .value,
                })
              }
              style={
                inputStyle
              }
            />
          </label>

          <label>
            <div>
              Categorie
            </div>

            <input
              value={
                form.category
              }
              onChange={(e) =>
                patch({
                  category:
                    e.target
                      .value,
                })
              }
              style={
                inputStyle
              }
            />
          </label>
        </div>

        <div
          style={
            twoColumns
          }
        >
          <label>
            <div>
              Culoare
            </div>

            <input
              value={
                form.color
              }
              onChange={(e) =>
                patch({
                  color:
                    e.target
                      .value,
                })
              }
              style={
                inputStyle
              }
            />
          </label>

          <label>
            <div>
              Material
            </div>

            <input
              value={
                form.materialMain
              }
              onChange={(e) =>
                patch({
                  materialMain:
                    e.target
                      .value,
                })
              }
              style={
                inputStyle
              }
            />
          </label>
        </div>
      </section>

      {/* =====================
          ORDER MODE
      ====================== */}

      <section
        style={{
          padding: 16,
          border:
            "1px solid #e5e7eb",
          borderRadius:
            12,
        }}
      >
        <h4
          style={{
            margin:
              "0 0 10px",
          }}
        >
          Cum poate fi
          comandat?
        </h4>

        {[
          [
            "DIRECT",
            "Cumpărare directă",
          ],

          [
            "OPTIONS",
            "Cu opțiuni / personalizare",
          ],

          [
            "QUOTE_ONLY",
            "Doar cerere de ofertă",
          ],
        ].map(
          ([
            value,
            label,
          ]) => (
            <label
              key={
                value
              }
              style={{
                display:
                  "flex",
                alignItems:
                  "center",
                gap: 8,
                marginBottom:
                  8,
              }}
            >
              <input
                type="radio"
                name="admin-order-mode"
                checked={
                  form.orderMode ===
                  value
                }
                onChange={() =>
                  changeMode(
                    value
                  )
                }
              />

              {label}
            </label>
          )
        )}
      </section>

      {/* =====================
          OPTIONS
      ====================== */}

      {form.orderMode ===
        "OPTIONS" && (
        <>
          <SchemaEditor
            title="Opțiuni"
            description="Ex: mărime, culoare, model."
            fields={
              form.optionsSchema
            }
            onChange={(
              value
            ) =>
              patch({
                optionsSchema:
                  value,
              })
            }
          />

          <SchemaEditor
            title="Personalizare"
            description="Ex: nume, text, dată."
            fields={
              form.customSchema
            }
            onChange={(
              value
            ) =>
              patch({
                customSchema:
                  value,
              })
            }
          />

          <RepeatedGroupsEditor
            groups={
              form.repeatedGroups
            }
            availableFields={
              availableRepeatedFields
            }
            onChange={(
              value
            ) =>
              patch({
                repeatedGroups:
                  value,
              })
            }
          />
        </>
      )}

      {/* =====================
          QUOTE
      ====================== */}

      {form.orderMode ===
        "QUOTE_ONLY" && (
        <SchemaEditor
          title="Câmpuri cerere ofertă"
          description="Ce informații trebuie să ofere clientul?"
          fields={
            form.quoteSchema
          }
          onChange={(
            value
          ) =>
            patch({
              quoteSchema:
                value,
            })
          }
        />
      )}

      {/* =====================
          DISPONIBILITATE
      ====================== */}

      <section
        style={{
          display:
            "grid",
          gap: 12,
        }}
      >
        <h4
          style={{
            margin: 0,
          }}
        >
          Disponibilitate
        </h4>

        <select
          value={
            form.availability
          }
          onChange={(e) =>
            patch({
              availability:
                e.target
                  .value,
            })
          }
          style={
            inputStyle
          }
        >
          <option value="READY">
            Disponibil
          </option>

          <option value="MADE_TO_ORDER">
            La comandă
          </option>

          <option value="PREORDER">
            Precomandă
          </option>

          <option value="SOLD_OUT">
            Epuizat
          </option>
        </select>

        {form.availability ===
          "READY" && (
          <label>
            <div>
              Cantitate
              disponibilă
            </div>

            <input
              type="number"
              min="0"
              value={
                form.readyQty
              }
              onChange={(e) =>
                patch({
                  readyQty:
                    e.target
                      .value,
                })
              }
              style={
                inputStyle
              }
            />
          </label>
        )}

        {form.availability ===
          "MADE_TO_ORDER" && (
          <label>
            <div>
              Timp execuție
              (zile)
            </div>

            <input
              type="number"
              min="1"
              value={
                form.leadTimeDays
              }
              onChange={(e) =>
                patch({
                  leadTimeDays:
                    e.target
                      .value,
                })
              }
              style={
                inputStyle
              }
            />
          </label>
        )}

        {form.availability ===
          "PREORDER" && (
          <label>
            <div>
              Data estimată
            </div>

            <input
              type="date"
              value={
                form.nextShipDate
              }
              onChange={(e) =>
                patch({
                  nextShipDate:
                    e.target
                      .value,
                })
              }
              style={
                inputStyle
              }
            />
          </label>
        )}
      </section>

      {/* =====================
          ALTE DETALII
      ====================== */}

      <section
        style={{
          display:
            "grid",
          gap: 12,
        }}
      >
        <h4
          style={{
            margin: 0,
          }}
        >
          Alte detalii
        </h4>

        <div
          style={
            twoColumns
          }
        >
          <label>
            <div>
              Tehnică
            </div>

            <input
              value={
                form.technique
              }
              onChange={(e) =>
                patch({
                  technique:
                    e.target
                      .value,
                })
              }
              style={
                inputStyle
              }
            />
          </label>

          <label>
            <div>
              Dimensiuni
            </div>

            <input
              value={
                form.dimensions
              }
              onChange={(e) =>
                patch({
                  dimensions:
                    e.target
                      .value,
                })
              }
              style={
                inputStyle
              }
            />
          </label>
        </div>

        <label>
          <div>
            Instrucțiuni
            îngrijire
          </div>

          <textarea
            value={
              form.careInstructions
            }
            onChange={(e) =>
              patch({
                careInstructions:
                  e.target
                    .value,
              })
            }
            rows={3}
            style={{
              ...inputStyle,
              resize:
                "vertical",
            }}
          />
        </label>

        <label>
          <div>
            Note speciale
          </div>

          <textarea
            value={
              form.specialNotes
            }
            onChange={(e) =>
              patch({
                specialNotes:
                  e.target
                    .value,
              })
            }
            rows={3}
            style={{
              ...inputStyle,
              resize:
                "vertical",
            }}
          />
        </label>
      </section>

      {/* =====================
          STATUS
      ====================== */}

      <section
        style={{
          display: "flex",
          gap: 20,
          flexWrap:
            "wrap",
        }}
      >
        <label
          style={{
            display:
              "flex",
            gap: 7,
            alignItems:
              "center",
          }}
        >
          <input
            type="checkbox"
            checked={
              form.isActive
            }
            onChange={(e) =>
              patch({
                isActive:
                  e.target
                    .checked,
              })
            }
          />

          Produs activ
        </label>

        <label
          style={{
            display:
              "flex",
            gap: 7,
            alignItems:
              "center",
          }}
        >
          <input
            type="checkbox"
            checked={
              form.isHidden
            }
            onChange={(e) =>
              patch({
                isHidden:
                  e.target
                    .checked,
              })
            }
          />

          Produs ascuns
        </label>
      </section>

      {/* =====================
          ACTIONS
      ====================== */}

      <div
        style={{
          display: "flex",
          justifyContent:
            "flex-end",
          gap: 10,
          paddingTop:
            10,
          borderTop:
            "1px solid #e5e7eb",
        }}
      >
        {onCancel && (
          <button
            type="button"
            onClick={
              onCancel
            }
            disabled={
              saving
            }
            style={{
              padding:
                "10px 14px",
              border:
                "1px solid #d1d5db",
              background:
                "#fff",
              borderRadius:
                9,
              cursor:
                "pointer",
            }}
          >
            Anulează
          </button>
        )}

        <button
          type="button"
          onClick={save}
          disabled={
            saving
          }
          style={{
            padding:
              "10px 16px",
            border: 0,
            background:
              "#111827",
            color:
              "#fff",
            borderRadius:
              9,
            cursor:
              saving
                ? "default"
                : "pointer",
            fontWeight:
              700,
          }}
        >
          {saving
            ? "Se salvează..."
            : "Salvează modificările"}
        </button>
      </div>
    </div>
  );
}

const inputStyle = {
  width: "100%",
  marginTop: 5,
  padding: "10px 11px",
  border:
    "1px solid #d1d5db",
  borderRadius: 9,
  boxSizing:
    "border-box",
};

const twoColumns = {
  display: "grid",
  gridTemplateColumns:
    "repeat(2, minmax(0, 1fr))",
  gap: 12,
};