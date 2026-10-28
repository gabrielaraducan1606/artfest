import { useEffect, useMemo, useRef, useState } from "react";

import { api as apiCall } from "../../../../../lib/api";
import { checkProductForPublish } from "../../../../../utils/productPublishCheck.js";
import {
  useVendorGpsrManufacturer,
  vendorGpsrForCheck,
} from "../../utils/vendorGpsrManufacturer.js";
import { normalizeOptionChoice } from "../../../../../utils/optionLabels.js";

import styles from "../../components/css/ProductModal.module.css";

import ProductImagesSection from "./components/ProductImagesSection";
import ProductDetailsSection from "./components/ProductDetailsSection";
import ProductGpsrSection from "./components/ProductGpsrSection";
import ProductOrderModeSection from "./components/ProductOrderModeSection";
import ProductWizardNav from "./components/ProductWizardNav";
import ProductClientPreviewModal from "./components/ProductClientPreviewModal";
import ProductPublishCheck from "./components/ProductPublishCheck";
import ArtfestReviewRequest from "./components/ArtfestReviewRequest";

const PRODUCT_STEPS = [
  { key: "images", label: "Poze" },
  { key: "details", label: "Detalii" },
  { key: "customization", label: "Comandă" },
  { key: "review", label: "Publicare" },
];

// câmpurile trimise verificării AI (doar text / configurare, fără poze)
function aiDraftOf(form) {
  return {
    title: form.title || "",
    description: form.description || "",
    category: form.category || "",
    orderMode: form.orderMode || "",
    materialMain: form.materialMain || "",
    technique: form.technique || "",
    dimensions: form.dimensions || "",
    leadTimeDays: form.leadTimeDays || "",
    optionsSchema: form.optionsSchema || [],
    customSchema: form.customSchema || [],
    repeatedGroups: form.repeatedGroups || [],
    quoteSchema: form.quoteSchema || [],
  };
}

// recomandările AI țintesc zone, nu câmpuri exacte
const AI_TARGETS = {
  title: { step: "details", anchors: ["product-title"] },
  description: { step: "details", anchors: ["product-description"] },
  category: { step: "details", anchors: ["category-combobox-input"] },
  details: { step: "details", anchors: ["product-material", "product-dimensions"] },
  options: { step: "customization", section: "options", anchors: ["manual-section-options"] },
  custom: { step: "customization", section: "custom", anchors: ["manual-section-custom"] },
};

const FOCUSABLE = new Set(["INPUT", "TEXTAREA", "SELECT", "BUTTON"]);

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
  aiImageTargetIndex,
  aiLoading,
  uploadInfo,
  allImagesReadyForAi,
  mainImageReadyForAi,
  isUploadedImage,
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
  discardAiImagePreview,

  updateField,
  materialOptions,
  techniqueOptions,
  styleOptions,
  occasionOptions,
  careOptions,
  colorOptions,

  uploadingImages,
  hasPriceWarning,
  priceSuggestion,
  priceWarningConfirmed,
  onGoToCostsProfit,

  setAiImagePreview,
  setPriceSuggestion,
  setPriceWarningConfirmed,

}) {
  const [
    clientPreviewOpen,
    setClientPreviewOpen,
  ] = useState(false);

  // „Rezolvă” / „Vezi”: pasul + secțiunea + câmpul exact
  const [
    focusRequest,
    setFocusRequest,
  ] = useState(null);

  // verificarea AI (doar recomandări subiective, opțională)
  const [aiCheck, setAiCheck] =
    useState({ status: "idle", key: "", recommendations: [] });
  const aiRequestRef = useRef(0);

  const normalizedOrderMode =
    normalizeOrderMode(
      form.orderMode
    );

  const hasImages =
    Array.isArray(form.images) &&
    form.images.length > 0;

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

  /*
   * Verificarea de dinainte de publicare (utils/productPublishCheck.js):
   * ERORI (blochează) + RECOMANDĂRI, fiecare cu pasul/câmpul exact.
   * Include validatorul anti-abandon existent (productConfigurationValidator.js),
   * regulile de preț ale serverului (variantPricing.js) și GPSR.
   */
  const knownCategories = useMemo(
    () => new Set((options || []).map((option) => option.key).filter(Boolean)),
    [options]
  );

  // produs deja publicat (salvat ca APPROVED): GPSR incomplet nu blochează
  // salvarea, rămâne recomandare; pentru produsele noi / nepublicate blochează
  const existingPublished =
    !!(editingProduct?.id || editingProduct?._id) &&
    String(editingProduct?.moderationStatus || "").toUpperCase() === "APPROVED";

  // GPSR „Eu sunt producătorul”: datele publice centrale ale vendorului
  // (ciorna din editor sau cele salvate) - vezi utils/vendorGpsrManufacturer.js
  const vendorGpsrState = useVendorGpsrManufacturer();
  const vendorGpsr = useMemo(() => vendorGpsrForCheck(vendorGpsrState), [vendorGpsrState]);

  const publishCheck = useMemo(
    () => checkProductForPublish(form, { knownCategories, existingPublished, vendorGpsr }),
    [form, knownCategories, existingPublished, vendorGpsr]
  );

  const errorsByStep =
    publishCheck.errorsByStep;

  const sectionStatus = {
    images:
      !errorsByStep.images?.length,

    details:
      !errorsByStep.details?.length,

    customization:
      !errorsByStep.customization?.length,

    review:
      publishCheck.ready,
  };

  /*
   * Ce anume lipsește, în cuvinte simple, pentru fiecare pas - aceleași
   * erori ca verificarea de publicare, cu „Rezolvă” spre câmpul exact.
   */
  const missingItemsByStep = {
    images: errorsByStep.images || [],
    details: errorsByStep.details || [],
    customization: errorsByStep.customization || [],
  };

  const resolveIssue = (target) => {
    if (!target?.step) return;
    setActiveStep(target.step);
    setFocusRequest({ ...target, nonce: Date.now() });
  };

  // după schimbarea pasului: secțiunea se deschide (ProductOrderModeSection),
  // apoi ducem vendorul la câmp
  useEffect(() => {
    if (!focusRequest || activeStep !== focusRequest.step) return undefined;

    const timer = window.setTimeout(() => {
      const element = (focusRequest.anchors || [])
        .map((id) => document.getElementById(id))
        .find(Boolean);
      if (!element) return;

      element.scrollIntoView({ behavior: "smooth", block: "center" });
      if (FOCUSABLE.has(element.tagName)) {
        element.focus({ preventScroll: true });
      }
    }, 160);

    return () => window.clearTimeout(timer);
  }, [focusRequest, activeStep]);

  /*
   * Verificarea AI rulează doar pe pasul „Publicare”, o dată per conținut
   * (serverul are și cache). Eșecul nu blochează nimic: rămân verificările
   * deterministe.
   */
  const aiDraft = useMemo(() => aiDraftOf(form), [form]);
  const aiKey = useMemo(() => JSON.stringify(aiDraft), [aiDraft]);

  const runAiCheck = (key, draft) => {
    const requestId = ++aiRequestRef.current;
    setAiCheck({ status: "loading", key, recommendations: [] });

    apiCall("/api/vendors/products/publish-check/ai", {
      method: "POST",
      body: { draft },
    })
      .then((data) => {
        if (requestId !== aiRequestRef.current) return;
        const ai = data?.ai || {};
        setAiCheck(
          ai.available
            ? { status: "done", key, recommendations: Array.isArray(ai.recommendations) ? ai.recommendations : [] }
            : { status: "unavailable", key, reason: ai.reason || "", recommendations: [] }
        );
      })
      .catch(() => {
        if (requestId !== aiRequestRef.current) return;
        setAiCheck({ status: "unavailable", key, reason: "network", recommendations: [] });
      });
  };

  useEffect(() => {
    if (activeStep !== "review" || aiCheck.key === aiKey) return undefined;
    if (!aiDraft.title.trim() || !aiDraft.description.trim()) return undefined;

    const timer = window.setTimeout(() => runAiCheck(aiKey, aiDraft), 400);
    return () => window.clearTimeout(timer);
  }, [activeStep, aiKey, aiDraft, aiCheck.key]);

  const aiForPanel =
    aiCheck.key === aiKey
      ? {
          ...aiCheck,
          recommendations: aiCheck.recommendations.map((item) => ({
            ...item,
            target: AI_TARGETS[item.target] || AI_TARGETS.description,
          })),
        }
      : { status: "idle", recommendations: [] };

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
      additionalCategories: [],
      aiSuggestedCategory: "",
      aiSuggestedAdditionalCategories: [],
      color: "",

      materialMain: "",
      technique: "",
      styleTags: "",
      occasionTags: "",
      dimensions: "",
      careInstructions: "",
      specialNotes: "",

      isOwnManufacturer: null,
      manufacturerName: "",
      manufacturerAddress: "",
      manufacturerEmail: "",
      manufacturerInEU: null,
      responsiblePersonName: "",
      responsiblePersonAddress: "",
      responsiblePersonEmail: "",
      safetyWarnings: null,
      isForChildren: null,

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
repeatedGroups: [],
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
    <>
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
        <div id="product-step-images">
        <ProductImagesSection
          form={
            form
          }
          setForm={
            setForm
          }
          aiImagePreview={
            aiImagePreview
          }
          aiImageLoading={
            aiImageLoading
          }
          aiImageTargetIndex={
            aiImageTargetIndex
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
          isUploadedImage={
            isUploadedImage
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
          discardAiImagePreview={
            discardAiImagePreview
          }
        />
        </div>
      )}

      {activeStep ===
        "details" && (
        <>
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
          isExistingProduct={
            !!editingProduct
          }
        />

        <ProductGpsrSection
          form={form}
          setForm={setForm}
        />
        </>
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

          focusRequest={
            focusRequest?.step === "customization"
              ? focusRequest
              : null
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

          <ProductPublishCheck
            check={publishCheck}
            ai={aiForPanel}
            onResolve={resolveIssue}
            onRetryAi={() => runAiCheck(aiKey, aiDraft)}
          />

          <ArtfestReviewRequest
            productId={
              editingProduct?.id ||
              editingProduct?._id ||
              null
            }
          />

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

            {Array.isArray(
              form.additionalCategories
            ) &&
              form.additionalCategories
                .length > 0 && (
                <>
                  <br />
                  Categorii suplimentare:{" "}
                  {form.additionalCategories
                    .map(
                      (key) =>
                        getLabelFor(key) ||
                        key
                    )
                    .join(", ")}
                </>
              )}

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
                        ? field.options
                            .map(
                              (option) =>
                                normalizeOptionChoice(
                                  option
                                ).label
                            )
                            .join(
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
  Completat cu AI:
</strong>

              <br />

              {form
                .aiVisionAnalysis
                .visualProductType
                ? `Produs detectat: ${form.aiVisionAnalysis.visualProductType}`
                : "Produs completat automat din imagini"}

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
          onClick={() =>
            setClientPreviewOpen(
              true
            )
          }
          disabled={
            !hasImages &&
            !form.title?.trim()
          }
        >
          👀 Vezi cum va arăta pentru client
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
              !sectionStatus.review
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

      {!isLastStep &&
        !!missingItemsByStep[
          activeStep
        ]?.length && (
          <div
            className={
              styles.tip
            }
            style={{
              margin: "0 20px 16px",
            }}
          >
            <strong>
              Mai ai de completat:
            </strong>

            <ul
              style={{
                margin: "6px 0 0",
                paddingLeft: 18,
              }}
            >
              {missingItemsByStep[
                activeStep
              ].map((item) => (
                <li key={`${item.code}|${item.message}`}>
                  {item.message}{" "}
                  <button
                    type="button"
                    className={
                      styles.linkBtn
                    }
                    onClick={() =>
                      resolveIssue(
                        item.target
                      )
                    }
                  >
                    Rezolvă
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

      {isLastStep &&
        hasPriceWarning &&
        !priceWarningConfirmed && (
          <div
            className={
              styles.tip
            }
            style={{
              display: "flex",
              alignItems: "center",
              flexWrap: "wrap",
              gap: 10,
              margin: "0 20px 16px",
              padding: "10px 14px",
              borderRadius: 10,
              background:
                "rgba(217, 119, 6, 0.1)",
              color: "#92400e",
            }}
          >
            <span
              style={{
                flex: "1 1 260px",
              }}
            >
              Prețul actual (
              {form.price || 0} lei) e
              sub minimul recomandat
              din Costuri &amp; Profit
              {priceSuggestion?.minPrice
                ? ` (${priceSuggestion.minPrice} lei)`
                : ""}
              . Poți salva oricum -
              e doar o informare, nu
              o blocare.
            </span>

            <button
              type="button"
              className={
                styles.linkBtn
              }
              onClick={
                onGoToCostsProfit
              }
            >
              Verifică în Costuri &amp; Profit
            </button>

            <button
              type="button"
              className={
                styles.linkBtn
              }
              onClick={() =>
                setPriceWarningConfirmed(
                  true
                )
              }
            >
              Am înțeles
            </button>
          </div>
        )}

    </form>

    <ProductClientPreviewModal
      open={clientPreviewOpen}
      onClose={() =>
        setClientPreviewOpen(false)
      }
      form={form}
      resolveProductImageUrl={
        resolveProductImageUrl
      }
    />
    </>
  );
}