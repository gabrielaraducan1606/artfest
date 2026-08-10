// src/components/AIAssistant/Vendor/components/VendorProductBatchWizard.jsx

import React, {
  useMemo,
} from "react";

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

function createInitialGroup(
  images = []
) {
  return {
    id:
      `group-${Date.now()}`,

    title:
      "Produs identificat",

    confidence:
      null,

    images,

    status:
      "NEEDS_REVIEW",

    productDraft: {
      images,
      title: "",
      description: "",
      category: "",
      price: "",
      currency: "RON",

      availability: "",
      readyQty: "",
      leadTimeDays: "",

      orderMode:
        "READY_TO_BUY",

      optionsSchema: [],
      customSchema: [],
      repeatedGroups: [],
      quoteSchema: [],

      orderInstructions:
        "",
    },

    missingFields: [],
    questions: [],
  };
}

export default function VendorProductBatchWizard({
  images = [],
  groups = [],
  setGroups,

  step = "images",
  setStep,

  onUpload,
  onAnalyzeGroups,
  onBack,
  onClose,

  analyzing = false,
}) {
  const safeImages =
    useMemo(
      () =>
        Array.isArray(
          images
        )
          ? images
          : [],
      [images]
    );

  const safeGroups =
    useMemo(
      () =>
        Array.isArray(
          groups
        )
          ? groups
          : [],
      [groups]
    );

  function goToStep(
    nextStep
  ) {
    setStep?.(
      nextStep
    );
  }

  function ensureTemporaryGroup() {
    if (
      safeGroups.length ||
      !safeImages.length
    ) {
      return;
    }

    setGroups?.([
      createInitialGroup(
        safeImages
      ),
    ]);
  }

  function updateGroup(
    groupId,
    patch
  ) {
    setGroups?.(
      (current) =>
        (
          Array.isArray(
            current
          )
            ? current
            : []
        ).map(
          (group) =>
            group.id ===
            groupId
              ? {
                  ...group,
                  ...patch,
                }
              : group
        )
    );
  }

  function removeGroup(
    groupId
  ) {
    setGroups?.(
      (current) =>
        (
          Array.isArray(
            current
          )
            ? current
            : []
        ).filter(
          (group) =>
            group.id !==
            groupId
        )
    );
  }

  const wrapperStyle = {
    display: "flex",
    flexDirection:
      "column",
    minHeight: 0,
    height: "100%",
    background:
      "#ffffff",
  };

  const headerStyle = {
    display: "flex",
    alignItems:
      "center",
    justifyContent:
      "space-between",
    gap: 12,
    padding:
      "14px 16px",
    borderBottom:
      "1px solid rgba(60, 40, 30, 0.1)",
  };

  const headerButtonStyle = {
    border: 0,
    background:
      "transparent",
    cursor:
      "pointer",
    fontSize: 14,
    color:
      "#5f4a40",
    padding: 6,
  };

  const contentStyle = {
    flex: 1,
    minHeight: 0,
    overflowY:
      "auto",
    padding: 16,
  };

  const progressStyle = {
    fontSize: 12,
    fontWeight: 700,
    color:
      "#8a6f62",
    marginBottom: 6,
    textTransform:
      "uppercase",
    letterSpacing:
      "0.04em",
  };

  const titleStyle = {
    margin:
      "0 0 8px",
    fontSize: 21,
    lineHeight: 1.25,
    color:
      "#2e2521",
  };

  const textStyle = {
    margin:
      "0 0 16px",
    fontSize: 14,
    lineHeight: 1.55,
    color:
      "#64544c",
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

  const primaryButtonStyle = {
    width: "100%",
    border: 0,
    borderRadius: 12,
    padding:
      "12px 14px",
    cursor:
      "pointer",
    fontWeight: 700,
    fontSize: 14,
    background:
      "#6f4e43",
    color:
      "#ffffff",
  };

  const secondaryButtonStyle = {
    width: "100%",
    border:
      "1px solid rgba(70, 45, 35, 0.18)",
    borderRadius: 12,
    padding:
      "11px 14px",
    cursor:
      "pointer",
    fontWeight: 700,
    fontSize: 14,
    background:
      "#ffffff",
    color:
      "#4f3b33",
  };

  const buttonGroupStyle = {
    display:
      "grid",
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
          Adaugă mai multe produse
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
              Pasul 1 din 4
            </div>

            <h3
              style={
                titleStyle
              }
            >
              Încarcă toate fotografiile
            </h3>

            <p
              style={
                textStyle
              }
            >
              Poți încărca fotografii pentru mai multe produse. AI-ul le va analiza și va încerca să identifice ce imagini aparțin aceluiași produs.
            </p>

            {safeImages.length >
              0 && (
              <div
                style={{
                  display:
                    "grid",

                  gridTemplateColumns:
                    "repeat(3, minmax(0, 1fr))",

                  gap: 8,
                  marginBottom:
                    14,
                }}
              >
                {safeImages.map(
                  (
                    image,
                    index
                  ) => {
                    const url =
                      getImageUrl(
                        image
                      );

                    if (!url) {
                      return null;
                    }

                    return (
                      <div
                        key={
                          image?.id ||
                          `${url}-${index}`
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
                            url
                          }
                          alt={`Fotografie ${
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

              {safeImages.length >
                0 && (
                <button
                  type="button"
                  style={
                    secondaryButtonStyle
                  }
                  disabled={
                    analyzing
                  }
                  onClick={
                    onAnalyzeGroups
                  }
                >
                  {analyzing
                    ? "AI-ul grupează fotografiile..."
                    : "Identifică produsele cu AI"}
                </button>
              )}
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
              Pasul 2 din 4
            </div>

            <h3
              style={
                titleStyle
              }
            >
              AI-ul identifică produsele
            </h3>

            <p
              style={
                textStyle
              }
            >
              Comparăm fotografiile și pregătim câte un grup pentru fiecare produs posibil.
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

                  lineHeight:
                    1.7,

                  color:
                    "#64544c",
                }}
              >
                <li>
                  obiectul principal din fotografie;
                </li>

                <li>
                  forma, culoarea și materialele;
                </li>

                <li>
                  unghiurile diferite ale aceluiași produs;
                </li>

                <li>
                  diferențele dintre produse asemănătoare.
                </li>
              </ul>
            </div>
          </>
        )}

        {step ===
          "groups" && (
          <>
            <div
              style={
                progressStyle
              }
            >
              Pasul 3 din 4
            </div>

            <h3
              style={
                titleStyle
              }
            >
              Verifică produsele identificate
            </h3>

            <p
              style={
                textStyle
              }
            >
              Confirmă dacă fotografiile au fost grupate corect. Mai târziu adăugăm mutarea fotografiilor între grupuri.
            </p>

            {!safeGroups.length && (
              <div
                style={
                  cardStyle
                }
              >
                <p
                  style={{
                    margin: 0,
                    color:
                      "#64544c",
                  }}
                >
                  Nu există încă grupuri.
                </p>

                <button
                  type="button"
                  style={{
                    ...secondaryButtonStyle,
                    marginTop:
                      12,
                  }}
                  onClick={
                    ensureTemporaryGroup
                  }
                >
                  Creează un grup temporar
                </button>
              </div>
            )}

            {safeGroups.map(
              (
                group,
                groupIndex
              ) => (
                <div
                  key={
                    group.id
                  }
                  style={
                    cardStyle
                  }
                >
                  <div
                    style={{
                      display:
                        "flex",

                      justifyContent:
                        "space-between",

                      alignItems:
                        "flex-start",

                      gap: 10,
                    }}
                  >
                    <div>
                      <strong>
                        {group.title ||
                          `Produs ${
                            groupIndex +
                            1
                          }`}
                      </strong>

                      <small
                        style={{
                          display:
                            "block",

                          marginTop:
                            4,

                          color:
                            "#75635a",
                        }}
                      >
                        {
                          (
                            group.images ||
                            []
                          ).length
                        }{" "}
                        fotografii
                      </small>
                    </div>

                    <button
                      type="button"
                      style={
                        headerButtonStyle
                      }
                      onClick={() =>
                        removeGroup(
                          group.id
                        )
                      }
                    >
                      Elimină
                    </button>
                  </div>

                  <div
                    style={{
                      display:
                        "grid",

                      gridTemplateColumns:
                        "repeat(4, minmax(0, 1fr))",

                      gap: 6,
                      marginTop:
                        10,
                    }}
                  >
                    {(
                      group.images ||
                      []
                    ).map(
                      (
                        image,
                        index
                      ) => {
                        const url =
                          getImageUrl(
                            image
                          );

                        if (
                          !url
                        ) {
                          return null;
                        }

                        return (
                          <div
                            key={
                              image?.id ||
                              `${group.id}-${index}`
                            }
                            style={{
                              aspectRatio:
                                "1 / 1",

                              overflow:
                                "hidden",

                              borderRadius:
                                8,

                              background:
                                "#f2ece8",
                            }}
                          >
                            <img
                              src={
                                url
                              }
                              alt=""
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

                  <input
                    value={
                      group.title ||
                      ""
                    }
                    onChange={(
                      event
                    ) =>
                      updateGroup(
                        group.id,
                        {
                          title:
                            event
                              .target
                              .value,
                        }
                      )
                    }
                    placeholder="Titlul provizoriu al produsului"
                    style={{
                      width:
                        "100%",

                      boxSizing:
                        "border-box",

                      marginTop:
                        10,

                      border:
                        "1px solid rgba(70, 45, 35, 0.18)",

                      borderRadius:
                        10,

                      padding:
                        "10px 11px",

                      fontSize:
                        14,
                    }}
                  />
                </div>
              )
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
                disabled={
                  !safeGroups.length
                }
                onClick={() =>
                  goToStep(
                    "review"
                  )
                }
              >
                Continuă cu produsele identificate
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
                Înapoi la fotografii
              </button>
            </div>
          </>
        )}

        {step ===
          "review" && (
          <>
            <div
              style={
                progressStyle
              }
            >
              Pasul 4 din 4
            </div>

            <h3
              style={
                titleStyle
              }
            >
              Produse pregătite
            </h3>

            <p
              style={
                textStyle
              }
            >
              În etapa următoare, fiecare grup va fi analizat și transformat automat într-un draft complet de produs.
            </p>

            {safeGroups.map(
              (
                group,
                index
              ) => (
                <div
                  key={
                    group.id
                  }
                  style={
                    cardStyle
                  }
                >
                  <strong>
                    {group.title ||
                      `Produs ${
                        index +
                        1
                      }`}
                  </strong>

                  <p
                    style={{
                      margin:
                        "7px 0 0",

                      color:
                        "#64544c",

                      fontSize:
                        13,
                    }}
                  >
                    {
                      (
                        group.images ||
                        []
                      ).length
                    }{" "}
                    fotografii pregătite pentru analiză.
                  </p>
                </div>
              )
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
                onClick={() => {
                  window.alert(
                    "Analiza fiecărui produs va fi conectată în pasul următor."
                  );
                }}
              >
                Pregătește toate produsele cu AI
              </button>

              <button
                type="button"
                style={
                  secondaryButtonStyle
                }
                onClick={() =>
                  goToStep(
                    "groups"
                  )
                }
              >
                Modifică grupurile
              </button>
            </div>
          </>
        )}
      </div>
    </section>
  );
}