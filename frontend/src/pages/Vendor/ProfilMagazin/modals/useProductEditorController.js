// src/pages/Vendor/ProfilMagazin/modals/useProductEditorController.js

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
} from "react";
import { useNavigate } from "react-router-dom";

import { resolveFileUrl } from "../hooks/useProfilMagazin";
import {
  uploadProductImage,
  uploadProductImageWithRetry,
} from "../../../../lib/productImages/uploadProductImage.js";
import { useProductImageQueue, useQueueFormImagesSync } from "../../../../lib/productImages/useProductImageQueue.js";
import { isPersistentImageUrl } from "../../../../lib/productImages/productImageRules.js";
import { api } from "../../../../lib/api";
import { AI_IMAGE_EDITING_ENABLED } from "../../../../config/features.js";
import { saveVendorGpsrDraftIfNeeded } from "../utils/vendorGpsrManufacturer.js";
import { clearLinkedSourceDraft, readAvailabilityHandoff } from "../utils/productDraftHandoff.js";

import {
  useProductFieldOptions,
  useQuoteSchemaEditor,
} from "./productEditorShared.js";

/*
 * useProductEditorController - TOATĂ plumbing-ul din spatele
 * editorului de produs (poze/reorder/AI, quote schema CRUD, opțiuni
 * material/tehnică/culoare/stil/ocazie/îngrijire, avertizare preț,
 * submit) - extras din ProductModal ca să poată fi reutilizat STRICT
 * (nu duplicat) de VendorProductWizard în mode="edit". ProductModal
 * de mai jos este acum doar un consumator subțire al acestui hook -
 * comportamentul lui NU s-a schimbat.
 */
export function useProductEditorController({
  open,
  editingProduct,
  form,
  setForm,
  categories = [],
  onSave,
  onClose,
  uploadFile,
  storeSlug,
  initialStep = "images",
}) {
  const doUpload = useMemo(() => {
    return (
      uploadFile ||
      // ruta de PRODUSE (40 MB după optimizare, conversie HEIC), cu reîncercări automate
      ((file) => uploadProductImageWithRetry(file))
    );
  }, [uploadFile]);

  const [activeStep, setActiveStep] =
    useState(initialStep);

  const [aiLoading, setAiLoading] =
    useState(false);
const [
  manualPromptOpen,
  setManualPromptOpen,
] = useState(false);

const [
  pendingManualEdit,
  setPendingManualEdit,
] = useState(null);

const [
  manualModeConfirmed,
  setManualModeConfirmed,
] = useState(false);
  const [
    aiImageLoading,
    setAiImageLoading,
  ] = useState(false);

  const [
    aiImagePreview,
    setAiImagePreview,
  ] = useState("");

  const [
    aiImageVariant,
    setAiImageVariant,
  ] = useState(1);

  /*
   * Indexul din form.images care e ținta previzualizării AI curente -
   * NU mai presupunem mereu imaginea principală (index 0). Fiecare
   * fotografie se editează separat, vendorul alege exact care.
   */
  const [
    aiImageTargetIndex,
    setAiImageTargetIndex,
  ] = useState(null);

  const navigate = useNavigate();

  const [
    priceSuggestion,
    setPriceSuggestion,
  ] = useState(null);

  const [
    priceWarningConfirmed,
    setPriceWarningConfirmed,
  ] = useState(false);

  /*
   * Avertizare de preț vs Costuri & Profit - STRICT informativă,
   * nu blochează salvarea/publicarea (vezi disabled-ul butonului
   * Salvează din ProductModalWizard.jsx, care NU mai include
   * această condiție).
   *
   * Reutilizează EXACT costingul deja calculat pentru acest produs
   * (GET /api/vendor/products/:id/costing, aceeași sursă ca pagina
   * Costuri & Profit) - nu recalculează nimic aici. Disponibilă
   * doar la EDITARE (un produs nou nu are încă un costing asociat).
   */
  useEffect(() => {
    let alive = true;

    if (!open || !editingProduct?.id) {
      setPriceSuggestion(null);
      return;
    }

    api(
      `/api/vendor/products/${encodeURIComponent(
        editingProduct.id
      )}/costing`
    )
      .then((data) => {
        if (!alive) return;

        const pricing = data?.costing?.pricing;

        setPriceSuggestion(
          pricing?.minPrice > 0
            ? {
                minPrice: pricing.minPrice,
                recommendedPrice:
                  pricing.recommendedPrice || null,
              }
            : null
        );
      })
      .catch(() => {
        if (alive) setPriceSuggestion(null);
      });

    return () => {
      alive = false;
    };
  }, [open, editingProduct?.id]);

  const hasPriceWarning = Boolean(
    priceSuggestion?.minPrice > 0 &&
      Number.isFinite(Number(form.price)) &&
      Number(form.price) > 0 &&
      Number(form.price) < priceSuggestion.minPrice
  );

  const goToCostsProfit = useCallback(() => {
    if (!editingProduct?.id) return;

    onClose?.();

    navigate(
      `/vendor/costs-profit/${encodeURIComponent(
        editingProduct.id
      )}`
    );
  }, [editingProduct?.id, navigate, onClose]);

  /*
   * Fotografiile noi trec prin coada COMUNĂ (lib/productImages, aceeași ca în
   * Smart Listing): pregătire / optimizare / HEIC, 2 upload-uri simultan,
   * reîncercări doar la erori temporare, „Reîncearcă” per fotografie,
   * fără duplicate. În form.images ajung DOAR URL-uri definitive.
   */
  const uploadFileRef = useRef(uploadFile);
  uploadFileRef.current = uploadFile;
  const { queue: photoQueue, state: photoState } = useProductImageQueue({
    upload: async (file, ctx) => {
      const custom = uploadFileRef.current;
      if (!custom) return uploadProductImage(file, { onProgress: ctx?.onProgress, signal: ctx?.signal });
      const result = await custom(file);
      const url = typeof result === "string" ? result : result?.url || "";
      return { url: isPersistentImageUrl(url) ? url : "" };
    },
  });
  const uploadingImages = photoState.pendingCount;

  // coada <-> form.images (deschidere / ciornă / AI / URL lipit <-> încărcări noi)
  useQueueFormImagesSync({
    queue: photoQueue,
    state: photoState,
    images: form?.images,
    onQueueUrls: (urls) =>
      setForm((current) => ({
        ...current,
        images: urls,
        aiManuallyEdited: current.aiAnalyzedAt ? true : current.aiManuallyEdited,
      })),
  });

  // blocaj sincron contra salvării duble (handleSubmit)
  const submitLockRef = useRef(false);

  const [uploadInfo] = useState(
    "Poți alege până la 12 poze deodată (maximum 100 MB fiecare); pozele mari sunt micșorate automat înainte de încărcare."
  );

  const draftKey = useMemo(() => {
    return `artfest-product-draft-${
      storeSlug || "default"
    }`;
  }, [storeSlug]);

  const mainImageUrl =
    form.images?.[0] || "";

  const isUploadedImage = useCallback(
    (img) => {
      const value = String(
        img || ""
      ).trim();

      return (
        /^https?:\/\//i.test(value) ||
        value.startsWith("/")
      );
    },
    []
  );

  const mainImageReadyForAi =
    isUploadedImage(mainImageUrl);

  const allImagesReadyForAi =
    (form.images || []).length > 0 &&
    (form.images || []).every((img) =>
      isUploadedImage(img)
    );

  const resolveProductImageUrl =
    useCallback((img) => {
      const value = String(
        img || ""
      ).trim();

      if (
        value.startsWith("blob:") ||
        value.startsWith("data:") ||
        /^https?:\/\//i.test(value)
      ) {
        return value;
      }

      return resolveFileUrl(value);
    }, []);

  const getReadyImagesForAi =
    useCallback(
      (images = []) => {
        return images
          .filter(isUploadedImage)
          .slice(0, 4)
          .map(resolveProductImageUrl)
          .filter(Boolean);
      },
      [
        isUploadedImage,
        resolveProductImageUrl,
      ]
    );

 const applyFieldValue = useCallback(
  (field, value) => {
    setForm((current) => ({
      ...current,

      [field]: value,

      aiManuallyEdited:
        current.aiAnalyzedAt
          ? true
          : current.aiManuallyEdited,
    }));
  },
  [setForm]
);

const updateField = useCallback(
  (field) => (eventOrValue) => {
    const value =
      eventOrValue?.target?.value ??
      eventOrValue;

    /*
     * La prima încercare de completare manuală
     * pentru un produs nou, recomandăm AI-ul.
     */
    if (
  !editingProduct &&
  !form.aiAnalyzedAt &&
  !manualModeConfirmed &&
  (form.images || []).length > 0
) {
      setPendingManualEdit({
        field,
        value,
      });

      setManualPromptOpen(true);

      return;
    }

    applyFieldValue(
      field,
      value
    );
  },
  [
    editingProduct,
    form.aiAnalyzedAt,
    manualModeConfirmed,
    applyFieldValue,
    form.images
  ]
);

  /* =====================================================
     ANALIZĂ GENERALĂ DUPĂ IMAGINI
  ===================================================== */

  const handleAiAnalyze =
    useCallback(async () => {
      if (uploadingImages > 0) {
        alert(
          "Așteaptă finalizarea încărcării imaginilor."
        );
        return;
      }

      const sourceImages =
        getReadyImagesForAi(
          form.images || []
        );

      if (!sourceImages.length) {
        alert(
          "Încarcă mai întâi cel puțin o imagine."
        );
        return;
      }

      try {
        setAiLoading(true);

        const result = await api(
          "/ai/product-analyze",
          {
            method: "POST",

            body: {
              images: sourceImages,
            },
          }
        );

        setForm((previous) => {
          const confidence =
            typeof result.confidence ===
            "number"
              ? result.confidence
              : null;

          const orderModeConfidence =
            typeof result.orderModeConfidence ===
            "number"
              ? result.orderModeConfidence
              : 0;

          const canApplyOrderMode =
            orderModeConfidence >= 0.75 &&
            [
              "READY_TO_BUY",
              "OPTIONS",
              "QUOTE_ONLY",
            ].includes(
              result.likelyOrderMode
            );

          const nextOrderMode =
            canApplyOrderMode
              ? result.likelyOrderMode
              : previous.orderMode ||
                "READY_TO_BUY";

          const nextOptionsSchema =
            canApplyOrderMode &&
            nextOrderMode === "OPTIONS" &&
            Array.isArray(
              result.likelyOptions
            )
              ? result.likelyOptions
              : previous.optionsSchema ||
                [];

          const nextCustomSchema =
            canApplyOrderMode &&
            nextOrderMode === "OPTIONS" &&
            Array.isArray(
              result.likelyCustomFields
            )
              ? result.likelyCustomFields
              : previous.customSchema ||
                [];

          return {
            ...previous,

            title:
              result.title ||
              previous.title,

            description:
              result.description ||
              previous.description,

            category:
              result.category &&
              !previous.category
                ? result.category
                : previous.category,

            /*
             * Categorii suplimentare propuse de AI: DOAR
             * sugestii afișate în formular (butoane „+”),
             * nu se adaugă în additionalCategories fără
             * click-ul vendorului.
             */
            // categoria PRINCIPALĂ propusă de AI - afișată separat;
            // înlocuiește alegerea vendorului doar la click „Folosește”
            aiSuggestedCategory:
              result.category &&
              result.category !== "alte"
                ? result.category
                : "",

            aiSuggestedAdditionalCategories:
              Array.isArray(
                result.suggestedAdditionalCategories
              )
                ? result.suggestedAdditionalCategories
                : [],

            materialMain:
              result.materialMain ||
              previous.materialMain,

            technique:
              result.technique ||
              previous.technique,

            color:
              result.color ||
              previous.color,

            styleTags:
              Array.isArray(
                result.styleTags
              )
                ? result.styleTags.join(
                    ", "
                  )
                : previous.styleTags,

            occasionTags:
              Array.isArray(
                result.occasionTags
              )
                ? result.occasionTags.join(
                    ", "
                  )
                : previous.occasionTags,

            careInstructions:
              result.careInstructions ||
              previous.careInstructions,

            specialNotes:
              result.specialNotes ||
              previous.specialNotes,

            orderMode:
              nextOrderMode,

            acceptsCustom:
              nextOrderMode ===
                "OPTIONS" ||
              nextOrderMode ===
                "QUOTE_ONLY",

            optionsSchema:
              nextOrderMode === "OPTIONS"
                ? nextOptionsSchema
                : [],

           customSchema:
  nextOrderMode === "OPTIONS"
    ? nextCustomSchema
    : [],

repeatedGroups:
  nextOrderMode === "OPTIONS"
    ? Array.isArray(
        previous.repeatedGroups
      )
      ? previous.repeatedGroups
      : []
    : [],

quoteSchema:
  nextOrderMode ===
  "QUOTE_ONLY"
    ? previous.quoteSchema ||
      []
    : [],
            /*
             * Salvăm analiza completă.
             */
            aiVisionAnalysis: result,

            aiSourceImages:
              sourceImages,

            aiGeneratedFields: Array.from(
              new Set([
                ...(Array.isArray(
                  previous.aiGeneratedFields
                )
                  ? previous.aiGeneratedFields
                  : []),

                ...(result.title
                  ? ["title"]
                  : []),

                ...(result.description
                  ? ["description"]
                  : []),

                ...(result.category
                  ? ["category"]
                  : []),

                ...(result.materialMain
                  ? ["materialMain"]
                  : []),

                ...(result.technique
                  ? ["technique"]
                  : []),

                ...(result.color
                  ? ["color"]
                  : []),

                ...(canApplyOrderMode
                  ? ["orderMode"]
                  : []),
              ])
            ),

            aiAnalysisVersion:
              result.analysisVersion ||
              "product-vision-v1",

            aiConfidence:
              confidence,

            aiAnalyzedAt:
              new Date().toISOString(),

            aiManuallyEdited: false,
          };
        });

        /*
         * După analiza vizuală mergem la detalii.
         * Utilizatorul poate continua apoi către Order.
         */
        setActiveStep("details");
      } catch (error) {
        console.error(error);

        alert(
          error?.message ||
            "Nu am putut analiza imaginile."
        );
      } finally {
        setAiLoading(false);
      }
    }, [
      uploadingImages,
      form.images,
      setForm,
      getReadyImagesForAi,
    ]);

    const continueManualEditing =
  useCallback(() => {
    const pending =
      pendingManualEdit;

    /*
     * De aici înainte, pentru produsul acesta,
     * nu mai afișăm întrebarea.
     */
    setManualModeConfirmed(true);
    setManualPromptOpen(false);
    setPendingManualEdit(null);

    /*
     * Aplicăm și valoarea pe care utilizatorul
     * încercase deja să o introducă.
     */
    if (
      pending?.field
    ) {
      applyFieldValue(
        pending.field,
        pending.value
      );
    }
  }, [
    pendingManualEdit,
    applyFieldValue,
  ]);

const chooseAiCompletion =
  useCallback(async () => {
    setPendingManualEdit(null);

    await handleAiAnalyze();

    setManualPromptOpen(false);
  }, [
    handleAiAnalyze,
  ]);

const closeManualPrompt =
  useCallback(() => {
    setManualPromptOpen(false);
    setPendingManualEdit(null);
  }, []);

  /* =====================================================
     ÎMBUNĂTĂȚIRE IMAGINE
  ===================================================== */

  const handleAiEnhanceImage =
    useCallback(async (index = 0) => {
      // oprit temporar (gpt-image-1 retras) - niciun request, vezi config/features.js
      if (!AI_IMAGE_EDITING_ENABLED) {
        return;
      }

      const imageUrl =
        form.images?.[index];

      if (!imageUrl) {
        alert(
          "Încarcă mai întâi o imagine."
        );
        return;
      }

      if (
        !isUploadedImage(imageUrl)
      ) {
        alert(
          "Imaginea încă se încarcă. Te rog așteaptă câteva secunde."
        );
        return;
      }

      try {
        setAiImageLoading(true);
        setAiImageTargetIndex(index);

        const result = await api(
          "/ai/product-image-enhance",
          {
            method: "POST",

            body: {
              imageUrl:
                resolveProductImageUrl(
                  imageUrl
                ),

              variant:
                aiImageVariant,
            },
          }
        );

        setAiImagePreview(
          result.dataUrl
        );

        setAiImageVariant(
          (current) =>
            current + 1
        );
      } catch (error) {
        console.error(error);

        /*
         * Eșec API -> originalul rămâne neatins. Nu setăm
         * aiImagePreview, deci form.images nu se schimbă deloc.
         */
        alert(
          error?.message ||
            "Nu am putut edita imaginea cu AI."
        );
      } finally {
        setAiImageLoading(false);
      }
    }, [
      form.images,
      aiImageVariant,
      resolveProductImageUrl,
      isUploadedImage,
    ]);

  /*
   * Renunță la previzualizarea AI fără nicio schimbare asupra
   * produsului - "Păstrează originalul".
   */
  const discardAiImagePreview =
    useCallback(() => {
      setAiImagePreview("");
      setAiImageTargetIndex(null);
    }, []);

  const useAiImage =
    useCallback(async () => {
      if (!aiImagePreview) {
        return;
      }

      try {
        const response = await fetch(
          aiImagePreview
        );

        const blob =
          await response.blob();

        const file = new File(
          [blob],
          `produs-ai-${Date.now()}.png`,
          {
            type: "image/png",
          }
        );

        const url =
          await doUpload(file);

        setForm((current) => {
          const images =
            current.images || [];

          /*
           * Înlocuim STRICT poza-sursă (același index), nu o
           * adăugăm ca poză nouă - altfel originalul rămânea
           * permanent în galerie, duplicat, iar ordinea pozelor
           * se strica. Dacă între timp indexul nu mai există
           * (ex. poza a fost ștearsă cât timp preview-ul era
           * deschis), adăugăm defensiv la final, fără să pierdem
           * nimic.
           */
          const targetIndex =
            aiImageTargetIndex ??
            0;

          const nextImages =
            targetIndex >= 0 &&
            targetIndex <
              images.length
              ? images.map(
                  (img, i) =>
                    i ===
                    targetIndex
                      ? url
                      : img
                )
              : [
                  ...images,
                  url,
                ];

          return {
            ...current,

            images: nextImages,

            /*
             * Imaginea a fost schimbată de utilizator (prin
             * confirmarea manuală a variantei AI) după analiză.
             */
            aiManuallyEdited:
              current.aiAnalyzedAt
                ? true
                : current.aiManuallyEdited,
          };
        });

        setAiImagePreview("");
        setAiImageTargetIndex(null);
      } catch (error) {
        console.error(error);

        /*
         * Eșec la upload/salvare -> NU atingem form.images,
         * previzualizarea rămâne deschisă ca utilizatorul să poată
         * încerca din nou sau să renunțe explicit.
         */
        alert(
          error?.message ||
            "Nu am putut salva imaginea AI."
        );
      }
    }, [
      aiImagePreview,
      aiImageTargetIndex,
      doUpload,
      setForm,
    ]);

  /* =====================================================
     INIȚIALIZARE MODAL / DRAFT
  ===================================================== */

useEffect(() => {
  if (!open) {
    return;
  }

  setActiveStep(initialStep);

  // fiecare deschidere a editorului cere o confirmare GPSR nouă (dacă e necesară)
  setForm((current) => ({ ...current, gpsrConfirmed: false }));

  setManualPromptOpen(false);
  setPendingManualEdit(null);
  setManualModeConfirmed(false);

  if (!editingProduct) {
      try {
        const saved =
          localStorage.getItem(
            draftKey
          );

        if (saved) {
          const parsed =
            JSON.parse(saved);

          setForm((current) => ({
            ...current,
            ...parsed,

            images:
              parsed.images || [],

            orderMode:
              parsed.orderMode ||
              "READY_TO_BUY",

            optionsSchema:
              Array.isArray(
                parsed.optionsSchema
              )
                ? parsed.optionsSchema
                : [],

            customSchema:
  Array.isArray(
    parsed.customSchema
  )
    ? parsed.customSchema
    : [],

repeatedGroups:
  Array.isArray(
    parsed.repeatedGroups
  )
    ? parsed.repeatedGroups
    : [],

quoteSchema:
  Array.isArray(
    parsed.quoteSchema
  )
    ? parsed.quoteSchema
    : [],

            aiGeneratedFields:
              Array.isArray(
                parsed.aiGeneratedFields
              )
                ? parsed.aiGeneratedFields
                : [],

            aiSourceImages:
              Array.isArray(
                parsed.aiSourceImages
              )
                ? parsed.aiSourceImages
                : [],

            aiVisionAnalysis:
              parsed.aiVisionAnalysis &&
              typeof parsed.aiVisionAnalysis ===
                "object"
                ? parsed.aiVisionAnalysis
                : null,

            aiOrderAnalysis:
              parsed.aiOrderAnalysis &&
              typeof parsed.aiOrderAnalysis ===
                "object"
                ? parsed.aiOrderAnalysis
                : null,

            aiAnalysisVersion:
              parsed.aiAnalysisVersion ||
              null,

            aiConfidence:
              parsed.aiConfidence ??
              null,

            aiAnalyzedAt:
              parsed.aiAnalyzedAt ||
              null,

            aiManuallyEdited:
              parsed.aiManuallyEdited ===
              true,

            /*
             * Datele de disponibilitate nu sunt
             * restaurate automat din draft
             * (excepție: transferul din Smart Listing).
             */
            ...readAvailabilityHandoff(
              localStorage,
              draftKey
            ),
          }));
        } else {
          setForm((current) => ({
            ...current,

            orderMode:
              "READY_TO_BUY",

          optionsSchema: [],
customSchema: [],
repeatedGroups: [],
quoteSchema: [],

            acceptsCustom: null,

            availability: "",
            readyQty: "",
            leadTimeDays: "",
            nextShipDate: "",

            aiVisionAnalysis: null,
            aiOrderAnalysis: null,
            aiGeneratedFields: [],
            aiSourceImages: [],
            aiAnalysisVersion: null,
            aiConfidence: null,
            aiAnalyzedAt: null,
            aiManuallyEdited: false,
          }));
        }
      } catch {
        setForm((current) => ({
          ...current,

          orderMode:
            "READY_TO_BUY",

          optionsSchema: [],
customSchema: [],
repeatedGroups: [],
quoteSchema: [],

          acceptsCustom: null,

          availability: "",
          readyQty: "",
          leadTimeDays: "",
          nextShipDate: "",

          aiVisionAnalysis: null,
          aiOrderAnalysis: null,
          aiGeneratedFields: [],
          aiSourceImages: [],
          aiAnalysisVersion: null,
          aiConfidence: null,
          aiAnalyzedAt: null,
          aiManuallyEdited: false,
        }));
      }
    }
  }, [
    open,
    editingProduct,
    setForm,
    draftKey,
    initialStep,
  ]);

  /* =====================================================
     OPȚIUNI ȘI CONSTANTE (comune cu editorul Admin - productEditorShared.js)
  ===================================================== */

  const {
    options,
    getLabelFor,
    materialOptions,
    techniqueOptions,
    colorOptions,
    styleOptions,
    occasionOptions,
    careOptions,
  } = useProductFieldOptions(categories);

  /* =====================================================
     GESTIONARE IMAGINI
  ===================================================== */

  const dragIndexRef = useMemo(
    () => ({
      current: -1,
    }),
    []
  );

  const setMainImage =
    useCallback(
      (index) => {
        setForm((current) => {
          if (
            !Array.isArray(
              current.images
            ) ||
            index < 0 ||
            index >=
              current.images.length
          ) {
            return current;
          }

          if (index === 0) {
            return current;
          }

          const images = [
            ...current.images,
          ];

          const [selected] =
            images.splice(index, 1);

          images.unshift(selected);

          return {
            ...current,
            images,

            aiManuallyEdited:
              current.aiAnalyzedAt
                ? true
                : current.aiManuallyEdited,
          };
        });
      },
      [setForm]
    );

  const removeImage =
    useCallback(
      (index) => {
        setForm((current) => ({
          ...current,

          images: (
            current.images || []
          ).filter(
            (_, imageIndex) =>
              imageIndex !== index
          ),

          aiManuallyEdited:
            current.aiAnalyzedAt
              ? true
              : current.aiManuallyEdited,
        }));

        /*
         * Dacă tocmai a fost ștearsă poza pentru care era deschis
         * un preview AI, previzualizarea nu mai are sens - o
         * închidem, ca să nu ajungă confirmată peste altă poză.
         * Dacă a fost ștearsă o poză DINAINTEA țintei, indexul se
         * ajustează ca preview-ul să rămână legat de aceeași poză.
         */
        setAiImageTargetIndex(
          (currentTarget) => {
            if (
              currentTarget ===
              null
            ) {
              return currentTarget;
            }

            if (
              index ===
              currentTarget
            ) {
              setAiImagePreview(
                ""
              );
              return null;
            }

            if (
              index <
              currentTarget
            ) {
              return (
                currentTarget -
                1
              );
            }

            return currentTarget;
          }
        );
      },
      [setForm]
    );

  const moveImage = useCallback(
    (from, to) => {
      setForm((current) => {
        const images = [
          ...(current.images || []),
        ];

        if (
          from === to ||
          to < 0 ||
          to >= images.length
        ) {
          return current;
        }

        const [selected] =
          images.splice(from, 1);

        images.splice(
          to,
          0,
          selected
        );

        return {
          ...current,
          images,

          aiManuallyEdited:
            current.aiAnalyzedAt
              ? true
              : current.aiManuallyEdited,
        };
      });
    },
    [setForm]
  );

  const onDragStart =
    useCallback(
      (index) => (event) => {
        dragIndexRef.current =
          index;

        event.dataTransfer.effectAllowed =
          "move";

        try {
          event.dataTransfer.setData(
            "text/plain",
            String(index)
          );
        } catch {
          // Ignore.
        }
      },
      [dragIndexRef]
    );

  const onDragOver =
    useCallback((event) => {
      event.preventDefault();

      event.dataTransfer.dropEffect =
        "move";
    }, []);

  const onDrop = useCallback(
    (index) => (event) => {
      event.preventDefault();

      const from =
        dragIndexRef.current >= 0
          ? dragIndexRef.current
          : Number(
              event.dataTransfer.getData(
                "text/plain"
              )
            );

      dragIndexRef.current = -1;

      if (
        !Number.isFinite(from)
      ) {
        return;
      }

      moveImage(from, index);
    },
    [
      dragIndexRef,
      moveImage,
    ]
  );

  /*
   * Fotografii alese (galerie, cameră, lipite, trase): COADA COMUNĂ - adăugate
   * la cele existente (nu le înlocuiesc), validate după conținut, fără duplicate,
   * limită 12. Eșecul uneia nu le oprește pe celelalte („Reîncearcă” per fotografie).
   * Întoarce rezultatul cozii; mesajele de refuz sunt arătate de apelant.
   */
  const onFilesPicked = useCallback(
    async (files, { silent = false } = {}) => {
      if (!files?.length) return { added: 0, rejected: [] };
      const result = await photoQueue.addFiles(Array.from(files));
      if (!silent && result.rejected.length) {
        alert(result.rejected.map((entry) => entry.message).join("\n"));
      }
      return result;
    },
    [photoQueue]
  );

  const onPasteImages =
    useCallback(
      async (event) => {
        const text =
          event.clipboardData
            ?.getData("text")
            ?.trim();

        if (
          text &&
          /^(https?:\/\/|\/)/i.test(
            text
          )
        ) {
          setForm((current) => ({
            ...current,

            images: [
              ...(current.images ||
                []),
              text,
            ],

            aiManuallyEdited:
              current.aiAnalyzedAt
                ? true
                : current.aiManuallyEdited,
          }));

          return;
        }

        const files = Array.from(
          event.clipboardData
            ?.files || []
        ).filter((file) => {
          const fileType =
            String(
              file.type || ""
            ).toLowerCase();

          const fileName =
            file.name || "";

          return (
            /^image\//i.test(
              fileType
            ) ||
            fileType ===
              "application/octet-stream" ||
            /\.(jpe?g|jfif|png|webp|gif|heic|heif|bmp|tiff?|avif)$/i.test(
              fileName
            )
          );
        });

        if (!files.length) {
          return;
        }

        event.preventDefault();

        await onFilesPicked(
          files
        );
      },
      [
        onFilesPicked,
        setForm,
      ]
    );

  /* =====================================================
     SINCRONIZARE DISPONIBILITATE
  ===================================================== */

  useEffect(() => {
    setForm((current) => {
      const availability =
        current.availability;

      if (!availability) {
        return current;
      }

      const next = {
        ...current,
      };

      if (
        availability === "READY"
      ) {
        next.leadTimeDays = "";
        next.nextShipDate = "";

        next.readyQty =
          next.readyQty === "" ||
          !Number.isFinite(
            Number(
              next.readyQty
            )
          )
            ? null
            : Math.max(
                0,
                Number(
                  next.readyQty
                )
              );
      } else if (
        availability ===
        "MADE_TO_ORDER"
      ) {
        next.readyQty = 0;
        next.nextShipDate = "";

        if (
          !Number.isFinite(
            Number(
              next.leadTimeDays
            )
          ) ||
          Number(
            next.leadTimeDays
          ) < 1
        ) {
          next.leadTimeDays =
            "";
        }
      } else if (
        availability ===
        "PREORDER"
      ) {
        next.readyQty = 0;
        next.leadTimeDays = "";
      } else if (
        availability ===
        "SOLD_OUT"
      ) {
        next.readyQty = 0;
        next.leadTimeDays = "";
        next.nextShipDate = "";
      }

      return next;
    });
  }, [
    setForm,
    form.availability,
  ]);

  /* =====================================================
     SALVARE DRAFT LOCAL
  ===================================================== */

  useEffect(() => {
    if (
      !open ||
      editingProduct
    ) {
      return;
    }

    try {
      const safeForm = {
        ...form,

        // declarația GPSR nu se păstrează în ciornă: se bifează la publicare
        gpsrConfirmed: false,

        availability: "",
        readyQty: "",
        leadTimeDays: "",
        nextShipDate: "",
      };

      localStorage.setItem(
        draftKey,
        JSON.stringify(safeForm)
      );
    } catch (error) {
      console.warn(
        "Nu am putut salva draftul produsului.",
        error
      );
    }
  }, [
    open,
    editingProduct,
    draftKey,
    form,
  ]);

  /* =====================================================
     SUBMIT
  ===================================================== */

  const handleSubmit =
    useCallback(
      async (event) => {
        event.preventDefault();

        /*
         * Dublu-click / Enter repetat: starea React ajunge prea târziu, deci
         * blocajul e sincron (ref). Fără el, două cereri POST puteau crea
         * același produs de două ori.
         */
        if (submitLockRef.current) {
          return false;
        }

        if (
          uploadingImages > 0
        ) {
          alert(
            "Te rog așteaptă să se termine încărcarea pozelor."
          );
          return false;
        }

        // o fotografie eșuată NU se pierde în tăcere: vânzătorul alege „Reîncearcă” sau o elimină
        if (photoState.failedCount > 0) {
          alert(
            photoState.failedCount === 1
              ? "O fotografie nu s-a încărcat. Apasă „Reîncearcă” sau elimin-o; celelalte fotografii sunt păstrate."
              : `${photoState.failedCount} fotografii nu s-au încărcat. Apasă „Reîncearcă” sau elimină-le; celelalte fotografii sunt păstrate.`
          );
          return false;
        }

        if (
          (form.images || []).some(
            (image) =>
              String(
                image
              ).startsWith(
                "blob:"
              )
          )
        ) {
          alert(
            "Mai există imagini care nu s-au încărcat complet."
          );
          return false;
        }

        /*
         * GPSR „Eu sunt producătorul”: datele publice centrale completate /
         * modificate acum se salvează ÎNAINTE de produs (o singură dată,
         * pentru toate produsele). Dacă eșuează, produsul nu se salvează.
         */
        submitLockRef.current = true;

        if (form.isOwnManufacturer === true) {
          try {
            await saveVendorGpsrDraftIfNeeded();
          } catch (gpsrError) {
            submitLockRef.current = false;
            alert(gpsrError?.message || "Nu am putut salva datele producătorului.");
            return false;
          }
        }

        try {
          await onSave(event);

          if (!editingProduct) {
            localStorage.removeItem(
              draftKey
            );
            clearLinkedSourceDraft(
              localStorage,
              draftKey
            );

            setAiImagePreview("");
            setAiImageVariant(1);
            setPriceSuggestion(null);

            setPriceWarningConfirmed(
              false
            );

            setForm((current) => ({
              ...current,

              gpsrConfirmed: false,

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

           optionsSchema: [],
customSchema: [],
repeatedGroups: [],
quoteSchema: [],

              acceptsCustom: null,
              availability: "",
              readyQty: "",
              leadTimeDays: "",
              nextShipDate: "",

              aiVisionAnalysis: null,
              aiOrderAnalysis: null,
              aiGeneratedFields: [],
              aiSourceImages: [],
              aiAnalysisVersion: null,
              aiConfidence: null,
              aiAnalyzedAt: null,
              aiManuallyEdited: false,
            }));

            setActiveStep(
              initialStep
            );
          }

          return true;
        } catch (error) {
          console.error(error);

          return false;
        } finally {
          submitLockRef.current = false;
        }
      },
      [
        uploadingImages,
        photoState.failedCount,
        form.images,
        form.isOwnManufacturer,
        onSave,
        editingProduct,
        draftKey,
        setForm,
        initialStep,
      ]
    );
  // CRUD câmpuri cerere ofertă - comun cu editorul Admin (productEditorShared.js)
  const {
    addQuoteField,
    updateQuoteField,
    removeQuoteField,
    addQuoteFieldOption,
    updateQuoteFieldOption,
    removeQuoteFieldOption,
  } = useQuoteSchemaEditor(setForm);

  return {
    activeStep,
    setActiveStep,

    aiLoading,
    manualPromptOpen,
    pendingManualEdit,
    closeManualPrompt,
    continueManualEditing,
    chooseAiCompletion,

    aiImageLoading,
    aiImagePreview,
    setAiImagePreview,
    aiImageTargetIndex,
    discardAiImagePreview,
    handleAiEnhanceImage,
    useAiImage,
    isUploadedImage,

    priceSuggestion,
    setPriceSuggestion,
    priceWarningConfirmed,
    setPriceWarningConfirmed,
    hasPriceWarning,
    goToCostsProfit,

    uploadingImages,
    // coada comună de fotografii (ProductPhotoUploader în ProductImagesSection)
    photos: { queue: photoQueue, state: photoState },
    uploadInfo,
    draftKey,
    mainImageReadyForAi,
    allImagesReadyForAi,
    resolveProductImageUrl,

    setMainImage,
    removeImage,
    onDragStart,
    onDragOver,
    onDrop,
    onFilesPicked,
    onPasteImages,

    updateField,
    handleAiAnalyze,

    options,
    getLabelFor,
    materialOptions,
    techniqueOptions,
    colorOptions,
    styleOptions,
    occasionOptions,
    careOptions,

    handleSubmit,

    addQuoteField,
    updateQuoteField,
    removeQuoteField,
    addQuoteFieldOption,
    updateQuoteFieldOption,
    removeQuoteFieldOption,
  };
}
