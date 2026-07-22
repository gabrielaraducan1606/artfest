import {
  useEffect,
  useMemo,
  useState,
  useCallback,
} from "react";

import Modal from "../ui/Modal";
import styles from "../components/css/ProductModal.module.css";
import { resolveFileUrl } from "../hooks/useProfilMagazin";
import { uploadFile as uploadFileHelper } from "../../../../lib/uploadFile";
import { api } from "../../../../lib/api";

import ProductModalWizard from "./ProductModal/ProductModalWizard";

import { COLORS_DETAILED } from "../../../../../../backend/src/constants/colors.js";
import { MATERIALS_DETAILED } from "../../../../../../backend/src/constants/materials.js";
import { TECHNIQUES_DETAILED } from "../../../../../../backend/src/constants/tehniques.js";
import { STYLE_TAGS_DETAILED } from "../../../../../../backend/src/constants/stylesTags.js";
import { OCCASION_TAGS_DETAILED } from "../../../../../../backend/src/constants/occasinsTags.js";
import { CARE_TAGS_DETAILED } from "../../../../../../backend/src/constants/careInstructions.js";

export default function ProductModal({
  open,
  onClose,
  saving,
  editingProduct,
  form,
  setForm,
  categories = [],
  onSave,
  uploadFile,
  storeSlug,
}) {
  const doUpload = useMemo(() => {
    return (
      uploadFile ||
      ((file) =>
        uploadFileHelper(
          file,
          "/api/upload"
        ))
    );
  }, [uploadFile]);

  const [activeStep, setActiveStep] =
    useState("images");

  const [aiLoading, setAiLoading] =
    useState(false);

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

  const [, setPriceSuggestion] =
    useState(null);

  const [
    priceWarningConfirmed,
    setPriceWarningConfirmed,
  ] = useState(false);

  const [
    uploadingImages,
    setUploadingImages,
  ] = useState(0);

  const [uploadInfo] = useState(
    "Niciun fișier ales"
  );

  const hasPriceWarning = false;

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

  const updateField = useCallback(
    (field) => (eventOrValue) => {
      const value =
        eventOrValue?.target?.value ??
        eventOrValue;

      setForm((current) => ({
        ...current,
        [field]: value,

        /*
         * Dacă produsul a fost analizat deja,
         * marcăm intervenția utilizatorului.
         */
        aiManuallyEdited:
          current.aiAnalyzedAt
            ? true
            : current.aiManuallyEdited,
      }));
    },
    [setForm]
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

  /* =====================================================
     ÎMBUNĂTĂȚIRE IMAGINE
  ===================================================== */

  const handleAiEnhanceImage =
    useCallback(async () => {
      const imageUrl =
        form.images?.[0];

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

        setForm((current) => ({
          ...current,

          images: [
            url,
            ...(current.images || []),
          ],

          /*
           * Imaginea principală s-a schimbat după analiză.
           */
          aiManuallyEdited:
            current.aiAnalyzedAt
              ? true
              : current.aiManuallyEdited,
        }));

        setAiImagePreview("");
      } catch (error) {
        console.error(error);

        alert(
          error?.message ||
            "Nu am putut salva imaginea AI."
        );
      }
    }, [
      aiImagePreview,
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

    setActiveStep("images");

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
             * restaurate automat din draft.
             */
            availability: "",
            readyQty: "",
            leadTimeDays: "",
            nextShipDate: "",
          }));
        } else {
          setForm((current) => ({
            ...current,

            orderMode:
              "READY_TO_BUY",

            optionsSchema: [],
            customSchema: [],
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
  ]);

  /* =====================================================
     OPȚIUNI ȘI CONSTANTE
  ===================================================== */

  const isDetailed =
    Array.isArray(categories) &&
    categories.length > 0 &&
    typeof categories[0] ===
      "object" &&
    categories[0] !== null &&
    "key" in categories[0];

  const options = useMemo(() => {
    if (isDetailed) {
      return categories.map(
        (category) => ({
          key: category.key,

          label:
            category.label ||
            category.key,

          group:
            category.group ||
            "alte",

          groupLabel:
            category.groupLabel ||
            "Altele",
        })
      );
    }

    return categories.map(
      (key) => ({
        key,
        label: key,
        group: "alte",
        groupLabel: "Altele",
      })
    );
  }, [
    categories,
    isDetailed,
  ]);

  const getLabelFor = useCallback(
    (key) =>
      options.find(
        (option) =>
          option.key === key
      )?.label ||
      key ||
      "",
    [options]
  );

  const materialOptions =
    useMemo(
      () =>
        MATERIALS_DETAILED.map(
          (material) => ({
            key: material.key,
            label: material.label,
          })
        ),
      []
    );

  const techniqueOptions =
    useMemo(
      () =>
        TECHNIQUES_DETAILED.map(
          (technique) => ({
            key: technique.key,
            label: technique.label,
          })
        ),
      []
    );

  const colorOptions =
    useMemo(
      () =>
        COLORS_DETAILED.map(
          (color) => ({
            key: color.key,
            label: color.label,
          })
        ),
      []
    );

  const styleOptions =
    useMemo(
      () =>
        STYLE_TAGS_DETAILED.map(
          (tag) => tag.label
        ),
      []
    );

  const occasionOptions =
    useMemo(
      () =>
        OCCASION_TAGS_DETAILED.map(
          (tag) => tag.label
        ),
      []
    );

  const careOptions =
    useMemo(
      () =>
        CARE_TAGS_DETAILED.map(
          (tag) => tag.label
        ),
      []
    );

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

  async function compressImageBeforeUpload(
    file
  ) {
    try {
      const fileType = String(
        file.type || ""
      ).toLowerCase();

      const fileName = String(
        file.name || ""
      ).toLowerCase();

      if (
        !/^image\//i.test(fileType)
      ) {
        return file;
      }

      if (
        /image\/gif/i.test(
          fileType
        ) ||
        /heic|heif|avif|tiff|bmp/i.test(
          fileType
        ) ||
        /\.(heic|heif|avif|tiff?|bmp|gif)$/i.test(
          fileName
        )
      ) {
        return file;
      }

      const imageUrl =
        URL.createObjectURL(file);

      try {
        const image =
          await Promise.race([
            new Promise(
              (
                resolve,
                reject
              ) => {
                const element =
                  new Image();

                element.onload =
                  () =>
                    resolve(
                      element
                    );

                element.onerror =
                  reject;

                element.src =
                  imageUrl;
              }
            ),

            new Promise(
              (_, reject) =>
                setTimeout(
                  () =>
                    reject(
                      new Error(
                        "IMAGE_COMPRESSION_TIMEOUT"
                      )
                    ),
                  4000
                )
            ),
          ]);

        const maxSize = 1800;

        const ratio = Math.min(
          1,
          maxSize /
            Math.max(
              image.width,
              image.height
            )
        );

        const canvas =
          document.createElement(
            "canvas"
          );

        canvas.width = Math.round(
          image.width * ratio
        );

        canvas.height = Math.round(
          image.height * ratio
        );

        const context =
          canvas.getContext("2d");

        if (!context) {
          return file;
        }

        context.drawImage(
          image,
          0,
          0,
          canvas.width,
          canvas.height
        );

        const blob =
          await Promise.race([
            new Promise(
              (resolve) => {
                canvas.toBlob(
                  resolve,
                  "image/jpeg",
                  0.82
                );
              }
            ),

            new Promise(
              (_, reject) =>
                setTimeout(
                  () =>
                    reject(
                      new Error(
                        "CANVAS_COMPRESSION_TIMEOUT"
                      )
                    ),
                  4000
                )
            ),
          ]);

        if (!blob) {
          return file;
        }

        if (
          blob.size >=
          file.size * 0.95
        ) {
          return file;
        }

        return new File(
          [blob],

          `${
            file.name.replace(
              /\.[^.]+$/,
              ""
            ) || "imagine"
          }.jpg`,

          {
            type: "image/jpeg",
          }
        );
      } finally {
        URL.revokeObjectURL(
          imageUrl
        );
      }
    } catch (error) {
      console.warn(
        "Compresia imaginii a fost ignorată:",
        error
      );

      return file;
    }
  }

  const onFilesPicked =
    useCallback(
      async (files) => {
        if (!files?.length) {
          return;
        }

        for (const file of files) {
          const fileName =
            file.name || "imagine";

          const fileType =
            String(
              file.type || ""
            ).toLowerCase();

          const isImage =
            /^image\//i.test(
              fileType
            ) ||
            fileType ===
              "application/octet-stream" ||
            /\.(jpe?g|jfif|png|webp|gif|heic|heif|bmp|tiff?|avif)$/i.test(
              fileName
            );

          if (!isImage) {
            alert(
              `Fișier ignorat: ${fileName}. Acceptăm JPG, PNG, WEBP, GIF, HEIC, HEIF, BMP, TIFF sau AVIF.`
            );

            continue;
          }

          if (
            file.size >
            100 * 1024 * 1024
          ) {
            alert(
              `Fișierul ${fileName} este prea mare. Maxim 100MB.`
            );

            continue;
          }

          const previewUrl =
            URL.createObjectURL(
              file
            );

          setForm((current) => ({
            ...current,

            images: [
              ...(current.images ||
                []),
              previewUrl,
            ],
          }));

          try {
            setUploadingImages(
              (count) =>
                count + 1
            );

            let finalUrl = "";

            try {
              const fileToUpload =
                await compressImageBeforeUpload(
                  file
                );

              finalUrl =
                await doUpload(
                  fileToUpload
                );
            } catch (firstError) {
              console.warn(
                "Upload cu imagine procesată a eșuat, încerc originalul:",
                firstError
              );

              finalUrl =
                await doUpload(
                  file
                );
            }

            setForm((current) => ({
              ...current,

              images: (
                current.images || []
              ).map((image) =>
                image ===
                previewUrl
                  ? finalUrl
                  : image
              ),

              aiManuallyEdited:
                current.aiAnalyzedAt
                  ? true
                  : current.aiManuallyEdited,
            }));

            URL.revokeObjectURL(
              previewUrl
            );
          } catch (error) {
            console.error(error);

            setForm((current) => ({
              ...current,

              images: (
                current.images || []
              ).filter(
                (image) =>
                  image !==
                  previewUrl
              ),
            }));

            URL.revokeObjectURL(
              previewUrl
            );

            alert(
              error?.message ||
                "Nu am putut încărca poza. Încearcă din nou sau fă screenshot la imagine și încarcă screenshot-ul."
            );
          } finally {
            setUploadingImages(
              (count) =>
                Math.max(
                  0,
                  count - 1
                )
            );
          }
        }
      },
      [
        doUpload,
        setForm,
      ]
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

        if (
          uploadingImages > 0
        ) {
          alert(
            "Te rog așteaptă să se termine încărcarea pozelor."
          );
          return;
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
          return;
        }

        try {
          await onSave(event);

          if (!editingProduct) {
            localStorage.removeItem(
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

              optionsSchema: [],
              customSchema: [],
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
              "images"
            );
          }
        } catch (error) {
          console.error(error);
        }
      },
      [
        uploadingImages,
        form.images,
        onSave,
        editingProduct,
        draftKey,
        setForm,
      ]
    );
const addQuoteField = useCallback(() => {
  setForm((current) => {
    const existingFields = Array.isArray(
      current.quoteSchema
    )
      ? current.quoteSchema
      : [];

    const id = `quote_${Date.now()}_${Math.random()
      .toString(36)
      .slice(2, 8)}`;

    return {
      ...current,
      quoteSchema: [
        ...existingFields,
        {
          id,
          key: id,
          label: "",
          type: "text",
          required: true,
          options: [],
        },
      ],
    };
  });
}, [setForm]);

const updateQuoteField = useCallback(
  (fieldId, patch) => {
    setForm((current) => ({
      ...current,

      quoteSchema: (
        Array.isArray(
          current.quoteSchema
        )
          ? current.quoteSchema
          : []
      ).map((field) =>
        field.id === fieldId
          ? {
              ...field,
              ...patch,
            }
          : field
      ),
    }));
  },
  [setForm]
);

const removeQuoteField = useCallback(
  (fieldId) => {
    setForm((current) => ({
      ...current,

      quoteSchema: (
        Array.isArray(
          current.quoteSchema
        )
          ? current.quoteSchema
          : []
      ).filter(
        (field) =>
          field.id !== fieldId
      ),
    }));
  },
  [setForm]
);

const addQuoteFieldOption =
  useCallback(
    (fieldId) => {
      setForm((current) => ({
        ...current,

        quoteSchema: (
          Array.isArray(
            current.quoteSchema
          )
            ? current.quoteSchema
            : []
        ).map((field) =>
          field.id === fieldId
            ? {
                ...field,
                options: [
                  ...(Array.isArray(
                    field.options
                  )
                    ? field.options
                    : []),
                  "",
                ],
              }
            : field
        ),
      }));
    },
    [setForm]
  );

const updateQuoteFieldOption =
  useCallback(
    (
      fieldId,
      optionIndex,
      value
    ) => {
      setForm((current) => ({
        ...current,

        quoteSchema: (
          Array.isArray(
            current.quoteSchema
          )
            ? current.quoteSchema
            : []
        ).map((field) => {
          if (
            field.id !== fieldId
          ) {
            return field;
          }

          const options = [
            ...(Array.isArray(
              field.options
            )
              ? field.options
              : []),
          ];

          options[
            optionIndex
          ] = value;

          return {
            ...field,
            options,
          };
        }),
      }));
    },
    [setForm]
  );

const removeQuoteFieldOption =
  useCallback(
    (
      fieldId,
      optionIndex
    ) => {
      setForm((current) => ({
        ...current,

        quoteSchema: (
          Array.isArray(
            current.quoteSchema
          )
            ? current.quoteSchema
            : []
        ).map((field) => {
          if (
            field.id !== fieldId
          ) {
            return field;
          }

          return {
            ...field,

            options: (
              Array.isArray(
                field.options
              )
                ? field.options
                : []
            ).filter(
              (
                _,
                index
              ) =>
                index !==
                optionIndex
            ),
          };
        }),
      }));
    },
    [setForm]
  );
  return (
    <Modal
      open={open}
      onClose={() =>
        !saving
          ? onClose()
          : null
      }
      maxWidth={760}
    >
      <div
        className={
          styles.modalHeader
        }
      >
        <h3
          className={
            styles.modalTitle
          }
        >
          {editingProduct
            ? "Editează produs"
            : "Adaugă produs"}
        </h3>

        <button
          className={
            styles.modalClose
          }
          onClick={() =>
            !saving
              ? onClose()
              : null
          }
          disabled={saving}
          type="button"
          aria-label="Închide"
        >
          ×
        </button>
      </div>

      <div
        className={
          styles.modalBody
        }
      >
        <ProductModalWizard
          form={form}
          setForm={setForm}
          quoteSchema={
  Array.isArray(
    form.quoteSchema
  )
    ? form.quoteSchema
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
          saving={saving}
          editingProduct={
            editingProduct
          }
          activeStep={activeStep}
          setActiveStep={
            setActiveStep
          }
          handleSubmit={
            handleSubmit
          }
          onClose={onClose}
          draftKey={draftKey}
          getLabelFor={
            getLabelFor
          }
          options={options}
          aiImagePreview={
            aiImagePreview
          }
          aiImageLoading={
            aiImageLoading
          }
          aiLoading={aiLoading}
          uploadInfo={uploadInfo}
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
          onDrop={onDrop}
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
          uploadingImages={
            uploadingImages
          }
          hasPriceWarning={
            hasPriceWarning
          }
          priceWarningConfirmed={
            priceWarningConfirmed
          }
          setAiImagePreview={
            setAiImagePreview
          }
          setPriceSuggestion={
            setPriceSuggestion
          }
          setPriceWarningConfirmed={
            setPriceWarningConfirmed
          }
        />
      </div>
    </Modal>
  );
}