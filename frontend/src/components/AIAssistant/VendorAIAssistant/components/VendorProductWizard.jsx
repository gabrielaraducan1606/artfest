// src/components/AIAssistant/Vendor/components/VendorProductWizard.jsx

import React, {
  useMemo,
} from "react";

import ProductVideoField from "../../../../components/ProductVideoField";

const EMPTY_DRAFT = {
  images: [],
  videoUrl: null,

  title: "",
  description: "",
  category: "",

  price: "",
  currency: "RON",

  materialMain: "",
  technique: "",
  color: "",

  availability: "",
  readyQty: "",
  leadTimeDays: "",
  nextShipDate: "",

  orderMode:
    "READY_TO_BUY",

  optionsSchema: [],
  customSchema: [],
  repeatedGroups: [],
  quoteSchema: [],

  orderInstructions: "",

  aiAnalysis: null,
  aiQuestions: [],
  aiOrderMessage: "",
  aiOrderReason: "",
  aiOrderConfidence: null,
};

function mergeDraft(
  draft
) {
  return {
    ...EMPTY_DRAFT,
    ...(draft || {}),

    images:
      Array.isArray(
        draft?.images
      )
        ? draft.images
        : [],

    optionsSchema:
      Array.isArray(
        draft?.optionsSchema
      )
        ? draft.optionsSchema
        : [],

    customSchema:
      Array.isArray(
        draft?.customSchema
      )
        ? draft.customSchema
        : [],

    repeatedGroups:
      Array.isArray(
        draft?.repeatedGroups
      )
        ? draft.repeatedGroups
        : [],

    quoteSchema:
      Array.isArray(
        draft?.quoteSchema
      )
        ? draft.quoteSchema
        : [],

    aiQuestions:
      Array.isArray(
        draft?.aiQuestions
      )
        ? draft.aiQuestions
        : [],
  };
}

function getImageUrl(
  image
) {
  if (
    typeof image ===
    "string"
  ) {
    return image;
  }

  return (
    image?.previewUrl ||
    image?.url ||
    image?.src ||
    image?.imageUrl ||
    ""
  );
}

function getOrderModeLabel(
  orderMode
) {
  switch (
    orderMode
  ) {
    case "OPTIONS":
      return "Clientul alege opțiuni sau completează personalizarea";

    case "QUOTE_ONLY":
      return "Clientul trimite o cerere de ofertă";

    default:
      return "Clientul cumpără produsul direct";
  }
}

function getOrderModeDescription(
  orderMode
) {
  switch (
    orderMode
  ) {
    case "OPTIONS":
      return "Produsul poate avea mărimi, culori, materiale, texte personalizate sau alte alegeri.";

    case "QUOTE_ONLY":
      return "Prețul și configurația finală sunt stabilite după discutarea cerințelor cu clientul.";

    default:
      return "Produsul nu necesită alegeri suplimentare înainte de adăugarea în coș.";
  }
}

function getAvailabilityLabel(
  availability
) {
  switch (
    availability
  ) {
    case "READY":
      return "Gata de livrare";

    case "MADE_TO_ORDER":
      return "Realizat la comandă";

    case "PREORDER":
      return "Precomandă";

    case "SOLD_OUT":
      return "Indisponibil";

    default:
      return "Nu a fost stabilită";
  }
}

function getFieldTypeLabel(
  type
) {
  switch (
    type
  ) {
    case "select":
      return "Alegere";

    case "textarea":
      return "Text mai lung";

    case "date":
      return "Dată";

    case "file":
      return "Fotografie sau fișier";

    default:
      return "Text";
  }
}

function SchemaFields({
  title,
  fields,
}) {
  if (
    !Array.isArray(
      fields
    ) ||
    !fields.length
  ) {
    return null;
  }

  return (
    <div
      style={{
        marginTop: 14,
      }}
    >
      <strong
        style={{
          display: "block",
          marginBottom: 8,
          fontSize: 13,
          color: "#493932",
        }}
      >
        {title}
      </strong>

      <div
        style={{
          display: "grid",
          gap: 8,
        }}
      >
        {fields.map(
          (
            field,
            index
          ) => (
            <div
              key={
                field?.key ||
                field?.id ||
                `field-${index}`
              }
              style={{
                border:
                  "1px solid rgba(70, 45, 35, 0.1)",

                borderRadius:
                  10,

                padding:
                  "10px 11px",

                background:
                  "#ffffff",
              }}
            >
              <div
                style={{
                  display:
                    "flex",

                  justifyContent:
                    "space-between",

                  alignItems:
                    "center",

                  gap: 10,
                }}
              >
                <strong
                  style={{
                    fontSize:
                      13,
                  }}
                >
                  {field?.label ||
                    "Câmp"}
                </strong>

                <small
                  style={{
                    color:
                      "#8a6f62",
                  }}
                >
                  {getFieldTypeLabel(
                    field?.type
                  )}
                </small>
              </div>

              <small
                style={{
                  display:
                    "block",

                  marginTop: 4,

                  color:
                    "#75635a",
                }}
              >
                {field?.required
                  ? "Obligatoriu"
                  : "Opțional"}
              </small>

              {Array.isArray(
                field?.options
              ) &&
                field.options.length >
                  0 && (
                  <small
                    style={{
                      display:
                        "block",

                      marginTop:
                        5,

                      color:
                        "#75635a",
                    }}
                  >
                    Variante:{" "}
                    {field.options.join(
                      ", "
                    )}
                  </small>
                )}
            </div>
          )
        )}
      </div>
    </div>
  );
}

export default function VendorProductWizard({
  draft,
  setDraft,

  step = "images",
  setStep,

  onUpload,
  onAnalyze,
  onAnalyzeOrder,

  onBack,
  onClose,

  analyzing = false,
  analyzingOrder = false,

  /*
   * Publicare reală a produsului - opțional. Dacă lipsește,
   * comportamentul vechi (fără publicare) rămâne identic, doar
   * fără buton funcțional (evită o eroare dacă vreodată acest
   * wizard e montat fără apelantul care știe să publice).
   */
  onPublish,
  publishing = false,
  publishError = "",
  publishSuccess = null,
}) {
  const safeDraft =
    useMemo(
      () =>
        mergeDraft(
          draft
        ),
      [draft]
    );

  const images =
    safeDraft.images;

  const canAnalyze =
    images.length > 0 &&
    !analyzing;

  const canAnalyzeOrder =
    String(
      safeDraft
        .orderInstructions ||
        ""
    ).trim().length >
      2 &&
    !analyzingOrder;

  function updateDraft(
    patch
  ) {
    setDraft?.(
      (current) => ({
        ...mergeDraft(
          current
        ),

        ...patch,
      })
    );
  }

  function goToStep(
    nextStep
  ) {
    setStep?.(
      nextStep
    );
  }

  const wrapperStyle = {
    display: "flex",
    flexDirection: "column",
    minHeight: 0,
    height: "100%",
    background: "#ffffff",
  };

  const headerStyle = {
    display: "flex",
    alignItems: "center",
    justifyContent:
      "space-between",
    gap: 12,
    padding: "14px 16px",
    borderBottom:
      "1px solid rgba(60, 40, 30, 0.1)",
  };

  const headerButtonStyle = {
    border: 0,
    background:
      "transparent",
    cursor: "pointer",
    fontSize: 14,
    color: "#5f4a40",
    padding: 6,
  };

  const contentStyle = {
    flex: 1,
    minHeight: 0,
    overflowY: "auto",
    padding: 16,
  };

  const progressStyle = {
    fontSize: 12,
    fontWeight: 700,
    color: "#8a6f62",
    marginBottom: 6,
    textTransform:
      "uppercase",
    letterSpacing:
      "0.04em",
  };

  const titleStyle = {
    margin: "0 0 8px",
    fontSize: 21,
    lineHeight: 1.25,
    color: "#2e2521",
  };

  const textStyle = {
    margin: "0 0 16px",
    fontSize: 14,
    lineHeight: 1.55,
    color: "#64544c",
  };

  const primaryButtonStyle = {
    width: "100%",
    border: 0,
    borderRadius: 12,
    padding:
      "12px 14px",
    cursor: "pointer",
    fontWeight: 700,
    fontSize: 14,
    background:
      "#6f4e43",
    color: "#ffffff",
  };

  const disabledButtonStyle = {
    opacity: 0.55,
    cursor:
      "not-allowed",
  };

  const secondaryButtonStyle = {
    width: "100%",
    border:
      "1px solid rgba(70, 45, 35, 0.18)",
    borderRadius: 12,
    padding:
      "11px 14px",
    cursor: "pointer",
    fontWeight: 700,
    fontSize: 14,
    background:
      "#ffffff",
    color: "#4f3b33",
  };

  const cardStyle = {
    border:
      "1px solid rgba(70, 45, 35, 0.12)",
    borderRadius: 14,
    padding: 14,
    background:
      "#fcfaf8",
    marginBottom: 12,
  };

  /*
   * Feedback pentru "Salvează produsul" (loading/succes/eroare) -
   * folosesc STRICT variabilele globale Artfest, nu paleta maro
   * folosită în restul acestui fișier (pre-existentă, neatinsă
   * aici - vezi raportul final).
   */
  const successCardStyle = {
    border:
      "1px solid var(--color-success, #16a34a)",
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,

    background:
      "color-mix(in srgb, var(--color-success, #16a34a) 10%, transparent)",

    color: "var(--color-text, #2d2d2d)",
  };

  const errorTextStyle = {
    color: "var(--color-danger, #dc2626)",
    fontSize: 12.5,
    margin: "8px 0 0",
  };

  const warningTextStyle = {
    color: "var(--color-warning, #f59e0b)",
    fontSize: 12.5,
    margin: "6px 0 0",
  };

  const labelStyle = {
    display: "block",
    fontWeight: 700,
    fontSize: 13,
    marginBottom: 6,
    color: "#493932",
  };

  const inputStyle = {
    width: "100%",
    boxSizing:
      "border-box",
    border:
      "1px solid rgba(70, 45, 35, 0.18)",
    borderRadius: 10,
    padding:
      "10px 11px",
    fontSize: 14,
    outline: "none",
    background:
      "#ffffff",
  };

  const buttonGroupStyle = {
    display: "grid",
    gap: 9,
    marginTop: 16,
  };

  return (
    <section
      style={
        wrapperStyle
      }
    >
      <header
        style={
          headerStyle
        }
      >
        <button
          type="button"
          style={
            headerButtonStyle
          }
          onClick={
            onBack
          }
        >
          ← Înapoi
        </button>

        <strong>
          Adaugă produs
        </strong>

        <button
          type="button"
          style={
            headerButtonStyle
          }
          onClick={
            onClose
          }
          aria-label="Închide"
        >
          ✕
        </button>
      </header>

      <div
        style={
          contentStyle
        }
      >
        {step ===
          "images" && (
          <>
            <div
              style={
                progressStyle
              }
            >
              Pasul 1 din 6
            </div>

            <h3
              style={
                titleStyle
              }
            >
              Încarcă fotografiile produsului
            </h3>

            <p
              style={
                textStyle
              }
            >
              Adaugă una sau mai multe fotografii clare. AI-ul va pregăti informațiile de bază ale produsului.
            </p>

            {images.length >
              0 && (
              <div
                style={{
                  display:
                    "grid",

                  gridTemplateColumns:
                    "repeat(3, minmax(0, 1fr))",

                  gap: 8,
                  marginBottom: 14,
                }}
              >
                {images.map(
                  (
                    image,
                    index
                  ) => {
                    const imageUrl =
                      getImageUrl(
                        image
                      );

                    if (
                      !imageUrl
                    ) {
                      return null;
                    }

                    return (
                      <div
                        key={
                          image?.id ||
                          `${imageUrl}-${index}`
                        }
                        style={{
                          aspectRatio:
                            "1 / 1",

                          overflow:
                            "hidden",

                          borderRadius:
                            10,

                          background:
                            "#f2ece8",
                        }}
                      >
                        <img
                          src={
                            imageUrl
                          }
                          alt={`Fotografie produs ${
                            index +
                            1
                          }`}
                          style={{
                            width:
                              "100%",

                            height:
                              "100%",

                            objectFit:
                              "cover",
                          }}
                        />
                      </div>
                    );
                  }
                )}
              </div>
            )}

            <div
              style={
                buttonGroupStyle
              }
            >
              <button
                type="button"
                style={
                  primaryButtonStyle
                }
                onClick={
                  onUpload
                }
              >
                + Adaugă fotografii
              </button>

              {images.length >
                0 && (
                <button
                  type="button"
                  style={{
                    ...secondaryButtonStyle,

                    ...(!canAnalyze
                      ? disabledButtonStyle
                      : {}),
                  }}
                  disabled={
                    !canAnalyze
                  }
                  onClick={
                    onAnalyze
                  }
                >
                  {analyzing
                    ? "Analizez produsul..."
                    : "Analizează cu AI"}
                </button>
              )}
            </div>

            <button
              type="button"
              style={{
                ...secondaryButtonStyle,
                marginTop: 8,
              }}
              onClick={() =>
                goToStep(
                  "details"
                )
              }
            >
              Nu am poze acum, continui fără AI
            </button>

            <small
              style={{
                display: "block",
                marginTop: 6,
                color: "#8a6f62",
                lineHeight: 1.4,
              }}
            >
              Poți completa titlul,
              descrierea și restul
              informațiilor manual, la
              pasul următor.
            </small>

            <div style={{ marginTop: 16 }}>
              <ProductVideoField
                videoUrl={
                  safeDraft.videoUrl ||
                  null
                }
                posterUrl={
                  images[0]
                    ? getImageUrl(
                        images[0]
                      )
                    : null
                }
                onChange={(url) =>
                  updateDraft({
                    videoUrl: url,
                  })
                }
              />
            </div>
          </>
        )}

        {step ===
          "analysis" && (
          <>
            <div
              style={
                progressStyle
              }
            >
              Pasul 2 din 6
            </div>

            <h3
              style={
                titleStyle
              }
            >
              AI-ul pregătește produsul
            </h3>

            <p
              style={
                textStyle
              }
            >
              Analizăm fotografiile și identificăm informațiile care pot fi completate automat.
            </p>

            <div
              style={
                cardStyle
              }
            >
              <strong>
                Se analizează:
              </strong>

              <ul
                style={{
                  margin:
                    "10px 0 0",

                  paddingLeft:
                    20,

                  color:
                    "#64544c",

                  lineHeight:
                    1.7,
                }}
              >
                <li>
                  tipul produsului;
                </li>

                <li>
                  titlul și descrierea;
                </li>

                <li>
                  categoria și materialele;
                </li>

                <li>
                  culorile și stilul;
                </li>

                <li>
                  modul probabil de comandă.
                </li>
              </ul>
            </div>
          </>
        )}

        {step ===
          "details" && (
          <>
            <div
              style={
                progressStyle
              }
            >
              Pasul 3 din 6
            </div>

            <h3
              style={
                titleStyle
              }
            >
              Verifică informațiile propuse
            </h3>

            <p
              style={
                textStyle
              }
            >
              AI-ul a completat informațiile pe care le-a putut identifica. Poți modifica orice câmp.
            </p>

            <div
              style={
                cardStyle
              }
            >
              <label
                style={
                  labelStyle
                }
              >
                Titlu
              </label>

              <input
                value={
                  safeDraft.title
                }
                onChange={(
                  event
                ) =>
                  updateDraft({
                    title:
                      event
                        .target
                        .value,
                  })
                }
                style={
                  inputStyle
                }
                placeholder="Titlul produsului"
              />
            </div>

            <div
              style={
                cardStyle
              }
            >
              <label
                style={
                  labelStyle
                }
              >
                Descriere
              </label>

              <textarea
                value={
                  safeDraft.description
                }
                onChange={(
                  event
                ) =>
                  updateDraft({
                    description:
                      event
                        .target
                        .value,
                  })
                }
                rows={6}
                style={{
                  ...inputStyle,
                  resize:
                    "vertical",
                }}
                placeholder="Descrierea produsului"
              />
            </div>

            <div
              style={
                cardStyle
              }
            >
              <label
                style={
                  labelStyle
                }
              >
                Categorie
              </label>

              <input
                value={
                  safeDraft.category
                }
                onChange={(
                  event
                ) =>
                  updateDraft({
                    category:
                      event
                        .target
                        .value,
                  })
                }
                style={
                  inputStyle
                }
                placeholder="Categoria"
              />
            </div>

            {safeDraft
              .materialMain && (
              <div
                style={
                  cardStyle
                }
              >
                <label
                  style={
                    labelStyle
                  }
                >
                  Material identificat
                </label>

                <input
                  value={
                    safeDraft
                      .materialMain
                  }
                  onChange={(
                    event
                  ) =>
                    updateDraft({
                      materialMain:
                        event
                          .target
                          .value,
                    })
                  }
                  style={
                    inputStyle
                  }
                />
              </div>
            )}

            {safeDraft
              .color && (
              <div
                style={
                  cardStyle
                }
              >
                <label
                  style={
                    labelStyle
                  }
                >
                  Culoare identificată
                </label>

                <input
                  value={
                    safeDraft.color
                  }
                  onChange={(
                    event
                  ) =>
                    updateDraft({
                      color:
                        event
                          .target
                          .value,
                    })
                  }
                  style={
                    inputStyle
                  }
                />
              </div>
            )}

            <div
              style={
                buttonGroupStyle
              }
            >
              <button
                type="button"
                style={
                  primaryButtonStyle
                }
                onClick={() =>
                  goToStep(
                    "order"
                  )
                }
              >
                Continuă la modul de comandă
              </button>

              <button
                type="button"
                style={
                  secondaryButtonStyle
                }
                onClick={() =>
                  goToStep(
                    "images"
                  )
                }
              >
                Schimbă fotografiile
              </button>
            </div>
          </>
        )}

        {step ===
          "order" && (
          <>
            <div
              style={
                progressStyle
              }
            >
              Pasul 4 din 6
            </div>

            <h3
              style={
                titleStyle
              }
            >
              Cum se comandă produsul?
            </h3>

            <p
              style={
                textStyle
              }
            >
              Explică simplu ce trebuie să aleagă sau să completeze clientul. AI-ul va transforma explicația într-un formular de comandă.
            </p>

            <div
              style={{
                ...cardStyle,
                background: "#eef2ff",
                borderColor:
                  "rgba(67, 56, 202, 0.18)",
              }}
            >
              <strong
                style={{
                  display: "block",
                  marginBottom: 6,
                }}
              >
                Variantă vs. personalizare
              </strong>

              <p
                style={{
                  margin: "0 0 6px",
                  color: "#3730a3",
                  fontSize: 13,
                  lineHeight: 1.5,
                }}
              >
                <strong>Variantă</strong> =
                clientul alege dintre opțiuni
                deja definite de tine. Ex:
                Culoare → Alb / Roz / Verde.
              </p>

              <p
                style={{
                  margin: 0,
                  color: "#3730a3",
                  fontSize: 13,
                  lineHeight: 1.5,
                }}
              >
                <strong>
                  Personalizare
                </strong>{" "}
                = clientul introduce
                propria informație. Ex:
                Nume, text, dată eveniment
                sau o fotografie.
              </p>
            </div>

            <div
              style={{
                ...cardStyle,

                background:
                  "#f8f4f1",
              }}
            >
              <small
                style={{
                  display:
                    "block",

                  marginBottom:
                    5,

                  color:
                    "#8a6f62",

                  fontWeight:
                    700,
                }}
              >
                AI-ul sugerează:
              </small>

              <strong>
                {getOrderModeLabel(
                  safeDraft.orderMode
                )}
              </strong>

              <p
                style={{
                  margin:
                    "7px 0 0",

                  color:
                    "#64544c",

                  fontSize:
                    13,

                  lineHeight:
                    1.5,
                }}
              >
                {getOrderModeDescription(
                  safeDraft.orderMode
                )}
              </p>
            </div>

            <div
              style={
                cardStyle
              }
            >
              <label
                style={
                  labelStyle
                }
              >
                Cum trebuie să comande clientul?
              </label>

              <textarea
                value={
                  safeDraft
                    .orderInstructions
                }
                onChange={(
                  event
                ) =>
                  updateDraft({
                    orderInstructions:
                      event
                        .target
                        .value,
                  })
                }
                rows={6}
                style={{
                  ...inputStyle,

                  resize:
                    "vertical",
                }}
                placeholder="Exemplu: Clientul alege membrii familiei, iar pentru fiecare selectează mărimea și textul. Materialul se alege o singură dată pentru întregul set."
              />

              <small
                style={{
                  display:
                    "block",

                  marginTop:
                    7,

                  color:
                    "#75635a",

                  lineHeight:
                    1.4,
                }}
              >
                Poți scrie normal. Nu trebuie să creezi singur câmpurile sau variantele.
              </small>
            </div>

            {safeDraft
              .aiOrderMessage && (
              <div
                style={{
                  ...cardStyle,

                  background:
                    "#f5f8f3",

                  borderColor:
                    "rgba(70, 110, 65, 0.2)",
                }}
              >
                <strong>
                  Ce a pregătit AI-ul
                </strong>

                <p
                  style={{
                    margin:
                      "7px 0 0",

                    color:
                      "#52604f",

                    lineHeight:
                      1.5,

                    whiteSpace:
                      "pre-wrap",
                  }}
                >
                  {
                    safeDraft
                      .aiOrderMessage
                  }
                </p>
              </div>
            )}

            {safeDraft
              .aiOrderReason && (
              <div
                style={
                  cardStyle
                }
              >
                <strong>
                  De ce a ales acest mod?
                </strong>

                <p
                  style={{
                    margin:
                      "7px 0 0",

                    color:
                      "#64544c",

                    fontSize:
                      13,

                    lineHeight:
                      1.5,
                  }}
                >
                  {
                    safeDraft
                      .aiOrderReason
                  }
                </p>
              </div>
            )}

            <SchemaFields
              title="Opțiuni pe care clientul le alege"
              fields={
                safeDraft
                  .optionsSchema
              }
            />

            <SchemaFields
              title="Informații de personalizare"
              fields={
                safeDraft
                  .customSchema
              }
            />

            <SchemaFields
              title="Informații pentru cererea de ofertă"
              fields={
                safeDraft
                  .quoteSchema
              }
            />

            {safeDraft
              .repeatedGroups
              .length >
              0 && (
              <div
                style={{
                  ...cardStyle,

                  marginTop:
                    14,
                }}
              >
                <strong>
                  Detalii completate separat pentru fiecare element
                </strong>

                <p
                  style={{
                    margin:
                      "7px 0 0",

                    color:
                      "#64544c",

                    fontSize:
                      13,

                    lineHeight:
                      1.5,
                  }}
                >
                  AI-ul a detectat că produsul conține mai multe elemente sau persoane care trebuie configurate separat. Clientul va putea adăuga mai mulți membri și, pentru fiecare, va completa:
                </p>

                <p
                  style={{
                    margin:
                      "6px 0 0",
                    color:
                      "#493932",
                    fontSize:
                      13,
                    fontWeight: 700,
                  }}
                >
                  {(
                    safeDraft
                      .repeatedGroups[0]
                      ?.fields || []
                  )
                    .map(
                      (field) =>
                        field.label
                    )
                    .filter(Boolean)
                    .join(", ") ||
                    "(niciun câmp identificat încă)"}
                </p>
              </div>
            )}

            {safeDraft
              .aiQuestions
              .length >
              0 && (
              <div
                style={{
                  ...cardStyle,

                  background:
                    "#fffaf0",

                  borderColor:
                    "rgba(175, 130, 35, 0.2)",

                  marginTop:
                    14,
                }}
              >
                <strong>
                  AI-ul mai are nevoie de câteva informații
                </strong>

                <ul
                  style={{
                    margin:
                      "9px 0 0",

                    paddingLeft:
                      20,

                    color:
                      "#6f5c32",

                    lineHeight:
                      1.6,
                  }}
                >
                  {safeDraft
                    .aiQuestions
                    .map(
                      (
                        question,
                        index
                      ) => (
                        <li
                          key={`${question}-${index}`}
                        >
                          {
                            question
                          }
                        </li>
                      )
                    )}
                </ul>

                <small
                  style={{
                    display:
                      "block",

                    marginTop:
                      8,

                    color:
                      "#756943",
                  }}
                >
                  Poți include răspunsurile direct în explicația de mai sus și apoi să apeși din nou butonul AI.
                </small>
              </div>
            )}

            <div
              style={
                buttonGroupStyle
              }
            >
              <button
                type="button"
                disabled={
                  !canAnalyzeOrder
                }
                style={{
                  ...primaryButtonStyle,

                  ...(!canAnalyzeOrder
                    ? disabledButtonStyle
                    : {}),
                }}
                onClick={
                  onAnalyzeOrder
                }
              >
                {analyzingOrder
                  ? "Pregătesc formularul..."
                  : "Pregătește formularul cu AI"}
              </button>

              <button
                type="button"
                style={
                  secondaryButtonStyle
                }
                onClick={() =>
                  goToStep(
                    "commercial"
                  )
                }
              >
                Continuă la preț și disponibilitate
              </button>

              <button
                type="button"
                style={
                  secondaryButtonStyle
                }
                onClick={() =>
                  goToStep(
                    "details"
                  )
                }
              >
                Înapoi la detalii
              </button>
            </div>
          </>
        )}

        {step ===
          "commercial" && (
          <>
            <div
              style={
                progressStyle
              }
            >
              Pasul 5 din 6
            </div>

            <h3
              style={
                titleStyle
              }
            >
              Preț și disponibilitate
            </h3>

            {safeDraft.orderMode !==
              "QUOTE_ONLY" && (
              <div
                style={
                  cardStyle
                }
              >
                <label
                  style={
                    labelStyle
                  }
                >
                  Preț
                </label>

                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={
                    safeDraft.price
                  }
                  onChange={(
                    event
                  ) =>
                    updateDraft({
                      price:
                        event
                          .target
                          .value,
                    })
                  }
                  style={
                    inputStyle
                  }
                  placeholder="Ex: 120"
                />
              </div>
            )}

            {safeDraft.orderMode ===
              "QUOTE_ONLY" && (
              <div
                style={{
                  ...cardStyle,

                  background:
                    "#fffaf0",
                }}
              >
                <strong>
                  Produs cu cerere de ofertă
                </strong>

                <p
                  style={{
                    margin:
                      "7px 0 0",

                    color:
                      "#64544c",

                    fontSize:
                      13,

                    lineHeight:
                      1.5,
                  }}
                >
                  Prețul nu este afișat deoarece va fi stabilit după ce clientul trimite cerințele.
                </p>
              </div>
            )}

            <div
              style={
                cardStyle
              }
            >
              <label
                style={
                  labelStyle
                }
              >
                Disponibilitate
              </label>

              <select
                value={
                  safeDraft
                    .availability
                }
                onChange={(
                  event
                ) =>
                  updateDraft({
                    availability:
                      event
                        .target
                        .value,
                  })
                }
                style={
                  inputStyle
                }
              >
                <option value="">
                  Alege disponibilitatea
                </option>

                <option value="READY">
                  Gata de livrare
                </option>

                <option value="MADE_TO_ORDER">
                  Realizat la comandă
                </option>

                <option value="PREORDER">
                  Precomandă
                </option>

                <option value="SOLD_OUT">
                  Indisponibil
                </option>
              </select>
            </div>

            {safeDraft
              .availability ===
              "READY" && (
              <div
                style={
                  cardStyle
                }
              >
                <label
                  style={
                    labelStyle
                  }
                >
                  Cantitate disponibilă
                </label>

                <input
                  type="number"
                  min="0"
                  step="1"
                  value={
                    safeDraft
                      .readyQty
                  }
                  onChange={(
                    event
                  ) =>
                    updateDraft({
                      readyQty:
                        event
                          .target
                          .value,
                    })
                  }
                  style={
                    inputStyle
                  }
                />
              </div>
            )}

            {safeDraft
              .availability ===
              "MADE_TO_ORDER" && (
              <div
                style={
                  cardStyle
                }
              >
                <label
                  style={
                    labelStyle
                  }
                >
                  Timp de realizare în zile
                </label>

                <input
                  type="number"
                  min="1"
                  step="1"
                  value={
                    safeDraft
                      .leadTimeDays
                  }
                  onChange={(
                    event
                  ) =>
                    updateDraft({
                      leadTimeDays:
                        event
                          .target
                          .value,
                    })
                  }
                  style={
                    inputStyle
                  }
                />
              </div>
            )}

            <div
              style={
                buttonGroupStyle
              }
            >
              <button
                type="button"
                style={
                  primaryButtonStyle
                }
                onClick={() =>
                  goToStep(
                    "summary"
                  )
                }
              >
                Vezi rezumatul
              </button>

              <button
                type="button"
                style={
                  secondaryButtonStyle
                }
                onClick={() =>
                  goToStep(
                    "order"
                  )
                }
              >
                Înapoi la modul de comandă
              </button>
            </div>
          </>
        )}

        {step ===
          "summary" && (
          <>
            <div
              style={
                progressStyle
              }
            >
              Pasul 6 din 6
            </div>

            <h3
              style={
                titleStyle
              }
            >
              Verifică produsul
            </h3>

            {images[0] && (
              <div
                style={{
                  width:
                    "100%",

                  aspectRatio:
                    "16 / 10",

                  overflow:
                    "hidden",

                  borderRadius:
                    14,

                  marginBottom:
                    12,

                  background:
                    "#f2ece8",
                }}
              >
                <img
                  src={
                    getImageUrl(
                      images[0]
                    )
                  }
                  alt={
                    safeDraft.title ||
                    "Produs"
                  }
                  style={{
                    width:
                      "100%",

                    height:
                      "100%",

                    objectFit:
                      "cover",
                  }}
                />
              </div>
            )}

            <div
              style={
                cardStyle
              }
            >
              <strong>
                {safeDraft.title ||
                  "Produs fără titlu"}
              </strong>

              <p
                style={{
                  margin:
                    "8px 0",

                  color:
                    "#64544c",

                  whiteSpace:
                    "pre-wrap",

                  lineHeight:
                    1.5,
                }}
              >
                {safeDraft.description ||
                  "Descrierea nu este completată."}
              </p>

              <div
                style={{
                  display:
                    "grid",

                  gap: 6,

                  fontSize:
                    13,

                  color:
                    "#64544c",
                }}
              >
                <span>
                  Categorie:{" "}
                  <strong>
                    {safeDraft.category ||
                      "Neselectată"}
                  </strong>
                </span>

                <span>
                  Preț:{" "}
                  <strong>
                    {safeDraft.orderMode ===
                    "QUOTE_ONLY"
                      ? "Se stabilește prin ofertă"
                      : safeDraft.price
                        ? `${safeDraft.price} ${safeDraft.currency}`
                        : "Necompletat"}
                  </strong>
                </span>

                <span>
                  Disponibilitate:{" "}
                  <strong>
                    {getAvailabilityLabel(
                      safeDraft
                        .availability
                    )}
                  </strong>
                </span>

                <span>
                  Comandă:{" "}
                  <strong>
                    {getOrderModeLabel(
                      safeDraft
                        .orderMode
                    )}
                  </strong>
                </span>

                {safeDraft
                  .optionsSchema
                  .length >
                  0 && (
                  <span>
                    Opțiuni:{" "}
                    <strong>
                      {
                        safeDraft
                          .optionsSchema
                          .length
                      }
                    </strong>
                  </span>
                )}

                {safeDraft
                  .customSchema
                  .length >
                  0 && (
                  <span>
                    Câmpuri de personalizare:{" "}
                    <strong>
                      {
                        safeDraft
                          .customSchema
                          .length
                      }
                    </strong>
                  </span>
                )}

                {safeDraft.videoUrl && (
                  <span>
                    Video: <strong>Da</strong>
                  </span>
                )}
              </div>
            </div>

            {publishSuccess ? (
              <div style={successCardStyle}>
                <strong>
                  Produsul „
                  {publishSuccess.title}
                  ” a fost salvat.
                </strong>

                <p
                  style={{
                    margin: "6px 0 0",
                    fontSize: 13,
                  }}
                >
                  E în așteptarea
                  moderării Artfest
                  înainte să apară
                  public.
                  {publishSuccess.costingWarning
                    ? ""
                    : " Am salvat și costingul calculat pentru el."}
                </p>

                {publishSuccess.costingWarning && (
                  <p
                    style={
                      warningTextStyle
                    }
                  >
                    Nu am putut salva
                    costingul calculat:{" "}
                    {
                      publishSuccess.costingWarning
                    }
                  </p>
                )}

                <div
                  style={
                    buttonGroupStyle
                  }
                >
                  <a
                    href={`/produs/${publishSuccess.productId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={
                      secondaryButtonStyle
                    }
                  >
                    Vezi produsul
                  </a>

                  <a
                    href="/vendor/catalog"
                    target="_blank"
                    rel="noopener noreferrer"
                    style={
                      secondaryButtonStyle
                    }
                  >
                    Vezi în catalog
                  </a>
                </div>
              </div>
            ) : (
              <div
                style={
                  buttonGroupStyle
                }
              >
                <button
                  type="button"
                  style={{
                    ...primaryButtonStyle,

                    ...(publishing
                      ? disabledButtonStyle
                      : {}),
                  }}
                  disabled={
                    publishing
                  }
                  onClick={() =>
                    onPublish?.()
                  }
                >
                  {publishing
                    ? "Se salvează..."
                    : "Salvează produsul"}
                </button>

                {publishError && (
                  <p
                    style={
                      errorTextStyle
                    }
                  >
                    {publishError}
                  </p>
                )}

                <button
                  type="button"
                  style={{
                    ...secondaryButtonStyle,

                    ...(publishing
                      ? disabledButtonStyle
                      : {}),
                  }}
                  disabled={
                    publishing
                  }
                  onClick={() =>
                    goToStep(
                      "details"
                    )
                  }
                >
                  Modifică informațiile
                </button>

                <button
                  type="button"
                  style={{
                    ...secondaryButtonStyle,

                    ...(publishing
                      ? disabledButtonStyle
                      : {}),
                  }}
                  disabled={
                    publishing
                  }
                  onClick={() =>
                    goToStep(
                      "order"
                    )
                  }
                >
                  Modifică modul de comandă
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}