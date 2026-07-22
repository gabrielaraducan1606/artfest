import styles from "../../components/css/ProductModal.module.css";

import ProductImagesSection from "./components/ProductImagesSection";
import ProductDetailsSection from "./components/ProductDetailsSection";
import ProductOrderModeSection from "./components/ProductOrderModeSection";
import ProductWizardNav from "./components/ProductWizardNav";

const PRODUCT_STEPS = [
  { key: "images", label: "Poze" },
  { key: "details", label: "Detalii" },
  { key: "customization", label: "Comandă" },
  { key: "review", label: "Publicare" },
];

function normalizeOrderMode(value) {
  if (value === "DIRECT") {
    return "READY_TO_BUY";
  }

  if (value === "CUSTOMIZABLE") {
    return "OPTIONS";
  }

  return value || "READY_TO_BUY";
}

function getOrderModeLabel(value) {
  const mode = normalizeOrderMode(value);

  if (mode === "READY_TO_BUY") {
    return "Se cumpără direct";
  }

  if (mode === "OPTIONS") {
    return "Se personalizează înainte de comandă";
  }

  if (mode === "QUOTE_ONLY") {
    return "Se cere ofertă";
  }

  return "Necompletat";
}

export default function ProductModalWizard({
  form,
  setForm,

  quoteSchema,
  addQuoteField,
  updateQuoteField,
  removeQuoteField,
  addQuoteFieldOption,
  updateQuoteFieldOption,
  removeQuoteFieldOption,

  saving,
  editingProduct,
  activeStep,
  setActiveStep,
  handleSubmit,
  onClose,

  draftKey,
  getLabelFor,
  options,

  aiImagePreview,
  aiImageLoading,
  aiLoading,
  uploadInfo,
  allImagesReadyForAi,
  mainImageReadyForAi,
  resolveProductImageUrl,
  onPasteImages,
  onFilesPicked,
  onDragStart,
  onDragOver,
  onDrop,
  setMainImage,
  removeImage,
  handleAiAnalyze,
  handleAiEnhanceImage,
  useAiImage,

  updateField,
  materialOptions,
  techniqueOptions,
  styleOptions,
  occasionOptions,
  careOptions,
  colorOptions,

  uploadingImages,
  hasPriceWarning,
  priceWarningConfirmed,

  setAiImagePreview,
  setPriceSuggestion,
  setPriceWarningConfirmed,
}) {
  const normalizedOrderMode =
    normalizeOrderMode(
      form.orderMode
    );

  const hasImages =
    Array.isArray(form.images) &&
    form.images.length > 0;

  const hasValidPrice =
    normalizedOrderMode ===
      "QUOTE_ONLY" ||
    (
      form.price !== "" &&
      form.price !== null &&
      form.price !== undefined &&
      Number.isFinite(
        Number(form.price)
      ) &&
      Number(form.price) > 0
    );

  const hasValidStock =
    form.readyQty !== "" &&
    form.readyQty !== null &&
    form.readyQty !== undefined &&
    Number.isFinite(
      Number(form.readyQty)
    ) &&
    Number(form.readyQty) >= 0;

  const hasValidLeadTime =
    form.leadTimeDays !== "" &&
    form.leadTimeDays !== null &&
    form.leadTimeDays !== undefined &&
    Number.isFinite(
      Number(form.leadTimeDays)
    ) &&
    Number(form.leadTimeDays) > 0;

  const hasOrderFields =
    (
      Array.isArray(
        form.optionsSchema
      ) &&
      form.optionsSchema.length > 0
    ) ||
    (
      Array.isArray(
        form.customSchema
      ) &&
      form.customSchema.length > 0
    );

  const hasQuoteFields =
    Array.isArray(
      form.quoteSchema
    ) &&
    form.quoteSchema.length > 0;

  const isOrderConfigurationComplete =
    (() => {
      if (
        normalizedOrderMode ===
        "READY_TO_BUY"
      ) {
        return (
          hasValidPrice &&
          hasValidStock
        );
      }

      if (
        normalizedOrderMode ===
        "OPTIONS"
      ) {
        return (
          hasValidPrice &&
          hasValidLeadTime &&
          hasOrderFields
        );
      }

      if (
        normalizedOrderMode ===
        "QUOTE_ONLY"
      ) {
        return (
          hasValidLeadTime &&
          hasQuoteFields
        );
      }

      return false;
    })();

  const sectionStatus = {
    images:
      hasImages,

    details:
      !!form.title?.trim() &&
      !!form.description?.trim() &&
      !!form.category,

    customization:
      isOrderConfigurationComplete,

    review:
      hasImages &&
      !!form.title?.trim() &&
      !!form.description?.trim() &&
      !!form.category &&
      isOrderConfigurationComplete,
  };

  const activeStepIndex =
    PRODUCT_STEPS.findIndex(
      (step) =>
        step.key === activeStep
    );

  const safeActiveStepIndex =
    activeStepIndex >= 0
      ? activeStepIndex
      : 0;

  const isFirstStep =
    safeActiveStepIndex <= 0;

  const isLastStep =
    safeActiveStepIndex ===
    PRODUCT_STEPS.length - 1;

  const goToNextStep = () => {
    const next =
      PRODUCT_STEPS[
        safeActiveStepIndex + 1
      ];

    if (next) {
      setActiveStep(
        next.key
      );
    }
  };

  const goToPrevStep = () => {
    const previous =
      PRODUCT_STEPS[
        safeActiveStepIndex - 1
      ];

    if (previous) {
      setActiveStep(
        previous.key
      );
    }
  };

  const isStepComplete = (
    key
  ) =>
    !!sectionStatus[key];

  const resetForm = () => {
    const confirmed =
      window.confirm(
        "Sigur vrei să resetezi formularul? Draftul local va fi șters."
      );

    if (!confirmed) {
      return;
    }

    localStorage.removeItem(
      draftKey
    );

    setForm((current) => ({
      ...current,

      title: "",
      description: "",
      price: "",
      images: [],
      category: "",
      color: "",

      materialMain: "",
      technique: "",
      styleTags: "",
      occasionTags: "",
      dimensions: "",
      careInstructions: "",
      specialNotes: "",

      orderMode:
        "READY_TO_BUY",

      acceptsCustom:
        false,

      availability:
        "READY",

      readyQty: "",
      leadTimeDays: "",
      nextShipDate: "",

      optionsSchema: [],
      customSchema: [],
      quoteSchema: [],

      aiVisionAnalysis:
        null,

      aiOrderAnalysis:
        null,

      aiGeneratedFields:
        [],

      aiSourceImages:
        [],

      aiAnalysisVersion:
        null,

      aiConfidence:
        null,

      aiAnalyzedAt:
        null,

      aiManuallyEdited:
        false,

      isHidden: false,
      isActive: true,
    }));

    setAiImagePreview(
      ""
    );

    setPriceSuggestion(
      null
    );

    setPriceWarningConfirmed(
      false
    );

    setActiveStep(
      "images"
    );
  };

  return (
    <form
      onSubmit={
        handleSubmit
      }
      className={
        styles.formGrid
      }
    >
      <ProductWizardNav
        steps={
          PRODUCT_STEPS
        }
        activeStep={
          activeStep
        }
        onStepClick={
          setActiveStep
        }
        isStepComplete={
          isStepComplete
        }
      />

      {activeStep ===
        "images" && (
        <ProductImagesSection
          form={
            form
          }
          aiImagePreview={
            aiImagePreview
          }
          aiImageLoading={
            aiImageLoading
          }
          aiLoading={
            aiLoading
          }
          uploadInfo={
            uploadInfo
          }
          allImagesReadyForAi={
            allImagesReadyForAi
          }
          mainImageReadyForAi={
            mainImageReadyForAi
          }
          resolveProductImageUrl={
            resolveProductImageUrl
          }
          onPasteImages={
            onPasteImages
          }
          onFilesPicked={
            onFilesPicked
          }
          onDragStart={
            onDragStart
          }
          onDragOver={
            onDragOver
          }
          onDrop={
            onDrop
          }
          setMainImage={
            setMainImage
          }
          removeImage={
            removeImage
          }
          handleAiAnalyze={
            handleAiAnalyze
          }
          handleAiEnhanceImage={
            handleAiEnhanceImage
          }
          useAiImage={
            useAiImage
          }
        />
      )}

      {activeStep ===
        "details" && (
        <ProductDetailsSection
          form={
            form
          }
          setForm={
            setForm
          }
          updateField={
            updateField
          }
          materialOptions={
            materialOptions
          }
          techniqueOptions={
            techniqueOptions
          }
          styleOptions={
            styleOptions
          }
          occasionOptions={
            occasionOptions
          }
          careOptions={
            careOptions
          }
          colorOptions={
            colorOptions
          }
          categoryProps={{
            options,
          }}
        />
      )}

      {activeStep ===
        "customization" && (
        <ProductOrderModeSection
          form={
            form
          }
          setForm={
            setForm
          }

          quoteSchema={
            Array.isArray(
              quoteSchema
            )
              ? quoteSchema
              : []
          }

          addQuoteField={
            addQuoteField
          }

          updateQuoteField={
            updateQuoteField
          }

          removeQuoteField={
            removeQuoteField
          }

          addQuoteFieldOption={
            addQuoteFieldOption
          }

          updateQuoteFieldOption={
            updateQuoteFieldOption
          }

          removeQuoteFieldOption={
            removeQuoteFieldOption
          }
        />
      )}

      {activeStep ===
        "review" && (
        <div
          style={{
            display:
              "grid",
            gap: 10,
          }}
        >
          <h4
            style={{
              margin: 0,
            }}
          >
            Verifică produsul
          </h4>

          <p
            style={{
              margin: 0,
              opacity:
                0.75,
            }}
          >
            Verifică informațiile
            înainte de salvare.
          </p>

          <div
            className={
              styles.tip
            }
          >
            <strong>
              {form.title ||
                "Produs fără titlu"}
            </strong>

            <br />

            Preț:{" "}
            {normalizedOrderMode ===
            "QUOTE_ONLY"
              ? "cerere ofertă"
              : form.price
                ? `${form.price} RON`
                : "necompletat"}

            <br />

            Categorie:{" "}
            {getLabelFor(
              form.category
            ) ||
              "necompletată"}

            <br />

            Mod comandă:{" "}
            {getOrderModeLabel(
              normalizedOrderMode
            )}

            <br />

            Disponibilitate:{" "}
            {form.availability ||
              "necompletată"}

            {normalizedOrderMode ===
              "READY_TO_BUY" && (
              <>
                <br />

                Stoc:{" "}
                {hasValidStock
                  ? `${form.readyQty} buc.`
                  : "necompletat"}
              </>
            )}

            {normalizedOrderMode !==
              "READY_TO_BUY" && (
              <>
                <br />

                Timp realizare:{" "}
                {hasValidLeadTime
                  ? `${form.leadTimeDays} zile`
                  : "necompletat"}
              </>
            )}
          </div>

          {normalizedOrderMode ===
            "OPTIONS" &&
            Array.isArray(
              form.optionsSchema
            ) &&
            form.optionsSchema
              .length >
              0 && (
              <div
                className={
                  styles.tip
                }
              >
                <strong>
                  Opțiuni client:
                </strong>

                <br />

                {form.optionsSchema.map(
                  (field) => (
                    <div
                      key={
                        field.key ||
                        field.label
                      }
                      style={{
                        marginTop:
                          6,
                      }}
                    >
                      {field.label}
                      :{" "}

                      {Array.isArray(
                        field.options
                      ) &&
                      field.options
                        .length
                        ? field.options.join(
                            ", "
                          )
                        : "fără valori configurate"}
                    </div>
                  )
                )}
              </div>
            )}

          {normalizedOrderMode ===
            "OPTIONS" &&
            Array.isArray(
              form.customSchema
            ) &&
            form.customSchema
              .length >
              0 && (
              <div
                className={
                  styles.tip
                }
              >
                <strong>
                  Câmpuri personalizare:
                </strong>

                <br />

                {form.customSchema.map(
                  (field) => (
                    <div
                      key={
                        field.key ||
                        field.label
                      }
                      style={{
                        marginTop:
                          6,
                      }}
                    >
                      {
                        field.label
                      }

                      {field.required
                        ? " — obligatoriu"
                        : " — opțional"}
                    </div>
                  )
                )}
              </div>
            )}

          {normalizedOrderMode ===
            "QUOTE_ONLY" &&
            Array.isArray(
              form.quoteSchema
            ) &&
            form.quoteSchema
              .length >
              0 && (
              <div
                className={
                  styles.tip
                }
              >
                <strong>
                  Câmpuri cerere ofertă:
                </strong>

                <br />

                {form.quoteSchema.map(
                  (field) => (
                    <div
                      key={
                        field.id ||
                        field.key ||
                        field.label
                      }
                      style={{
                        marginTop:
                          6,
                      }}
                    >
                      {
                        field.label ||
                        "Câmp fără întrebare"
                      }

                      {" — "}

                      {
                        field.type ||
                        "text"
                      }

                      {field.required
                        ? " — obligatoriu"
                        : " — opțional"}

                      {field.type ===
                        "select" &&
                        Array.isArray(
                          field.options
                        ) &&
                        field.options
                          .length >
                          0 && (
                          <>
                            {" — "}
                            Opțiuni:{" "}
                            {field.options
                              .filter(
                                Boolean
                              )
                              .join(
                                ", "
                              )}
                          </>
                        )}
                    </div>
                  )
                )}
              </div>
            )}

          {form.aiVisionAnalysis && (
            <div
              className={
                styles.tip
              }
            >
              <strong>
                Analiză AI:
              </strong>

              <br />

              {form
                .aiVisionAnalysis
                .visualProductType
                ? `Produs detectat: ${form.aiVisionAnalysis.visualProductType}`
                : "Produs analizat din imagini"}

              {typeof form.aiConfidence ===
                "number" && (
                <>
                  <br />

                  Încredere:{" "}

                  {Math.round(
                    form.aiConfidence *
                      100
                  )}
                  %
                </>
              )}

              {form.aiManuallyEdited && (
                <>
                  <br />

                  Configurația a fost
                  modificată manual după
                  analiza AI.
                </>
              )}
            </div>
          )}
        </div>
      )}

      <div
        className={
          styles.modalFooter
        }
        style={{
          flexWrap:
            "wrap",
        }}
      >
        <button
          type="button"
          className={
            styles.linkBtn
          }
          style={{
            marginRight:
              "auto",
          }}
          onClick={
            resetForm
          }
          disabled={
            saving ||
            editingProduct
          }
        >
          Resetează formularul
        </button>

        <button
          type="button"
          className={
            styles.linkBtn
          }
          onClick={
            goToPrevStep
          }
          disabled={
            saving ||
            isFirstStep
          }
        >
          Înapoi
        </button>

        {!isLastStep && (
          <button
            type="button"
            className={
              styles.primaryBtn
            }
            onClick={
              goToNextStep
            }
            disabled={
              saving ||
              !isStepComplete(
                activeStep
              )
            }
          >
            Continuă
          </button>
        )}

        <button
          type="button"
          className={
            styles.linkBtn
          }
          onClick={() =>
            !saving
              ? onClose()
              : null
          }
          disabled={
            saving
          }
        >
          Anulează
        </button>

        {isLastStep && (
          <button
            className={
              styles.primaryBtn
            }
            type="submit"
            disabled={
              saving ||
              uploadingImages >
                0 ||
              !sectionStatus.review ||
              (
                hasPriceWarning &&
                !priceWarningConfirmed
              )
            }
          >
            {uploadingImages >
              0
              ? "Se încarcă pozele…"
              : saving
                ? "Se salvează…"
                : "Salvează"}
          </button>
        )}
      </div>
    </form>
  );
}