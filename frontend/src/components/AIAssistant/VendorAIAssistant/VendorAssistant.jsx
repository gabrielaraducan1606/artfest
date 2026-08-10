// src/components/AIAssistant/Vendor/VendorAssistant.jsx

import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import styles from "../AiAssistant.module.css";

import AssistantMessage from "../components/AssistantMessage.jsx";
import ActionMenu from "../components/ActionMenu.jsx";

import {
  AttachmentIcon,
  BackIcon,
  ChevronRightIcon,
  CloseIcon,
  DragIcon,
  HomeIcon,
  RefreshIcon,
  SendIcon,
  SparkleIcon,
} from "../icons/AssistantIcons.jsx";

import {
  VENDOR_ACTION_IDS,
  VENDOR_MENU_IDS,
  getVendorMenu,
} from "./vendorMenus.js";

import {
  VENDOR_PRODUCT_FLOWS,
  startVendorFlow,
  handleVendorChoice,
  submitVendorMessage,
  getVendorInputPlaceholder,
} from "./vendorFlows.js";

import VendorProductWizard from "./components/VendorProductWizard.jsx";
import VendorProductBatchWizard from "./components/VendorProductBatchWizard.jsx";
import {
  detectVendorIntent,
  VENDOR_INTENTS,
} from "./vendorIntent.js";

import {
  analyzeVendorProduct,
  analyzeVendorProductOrder,
} from "./services/vendorProductAI.js";

/* =========================================================
   Configurare
========================================================= */

const STORAGE_KEYS = {
  position:
    "artfest-vendor-assistant-position",

  draft:
    "artfest-vendor-product-draft-v1",
};

const MAX_IMAGE_SIZE =
  10 * 1024 * 1024;

const MAX_IMAGES = 10;

const INITIAL_MESSAGES = [
  {
    id: "vendor-welcome",

    role: "assistant",

    type: "text",

    content:
      "Bună! Sunt asistentul magazinului tău. Te pot ajuta să adaugi și să editezi produse, să actualizezi prețul și stocul sau să ceri ajutor echipei Artfest.",
  },
];

const EMPTY_PRODUCT_DRAFT = {
  images: [],

  title: "",
  description: "",
  category: "",

  price: "",
  currency: "RON",

  materialMain: "",
  technique: "",
  color: "",
  styleTags: "",
  occasionTags: "",
  dimensions: "",
  careInstructions: "",
  specialNotes: "",

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
  aiConfidence: null,
aiOrderMessage: "",
aiOrderReason: "",
aiOrderConfidence: null,
  activeFlow: null,
};

/* =========================================================
   Helpers mesaje
========================================================= */

function createMessage(
  role,
  content,
  extra = {}
) {
  return {
    id: `${Date.now()}-${Math.random()
      .toString(36)
      .slice(2)}`,

    role,
    type: "text",
    content,

    ...extra,
  };
}

function getChoiceLabel(
  choice
) {
  if (
    typeof choice ===
    "string"
  ) {
    return choice;
  }

  if (
    choice &&
    typeof choice ===
      "object"
  ) {
    return (
      choice.label ||
      choice.title ||
      choice.name ||
      choice.subject ||
      "Continuă"
    );
  }

  return "Continuă";
}

function normalizeProductDraft(
  value
) {
  const source =
    value &&
    typeof value ===
      "object" &&
    !Array.isArray(value)
      ? value
      : {};

  return {
    ...EMPTY_PRODUCT_DRAFT,
    ...source,

    images:
      Array.isArray(
        source.images
      )
        ? source.images
        : [],

    optionsSchema:
      Array.isArray(
        source.optionsSchema
      )
        ? source.optionsSchema
        : [],

    customSchema:
      Array.isArray(
        source.customSchema
      )
        ? source.customSchema
        : [],

    repeatedGroups:
      Array.isArray(
        source.repeatedGroups
      )
        ? source.repeatedGroups
        : [],

    quoteSchema:
      Array.isArray(
        source.quoteSchema
      )
        ? source.quoteSchema
        : [],

    aiQuestions:
      Array.isArray(
        source.aiQuestions
      )
        ? source.aiQuestions
        : [],
  };
}

/* =========================================================
   Dimensiune și poziție
========================================================= */

function getPanelSize() {
  if (
    typeof window ===
    "undefined"
  ) {
    return {
      width: 380,
      height: 580,
    };
  }

  return {
    width: Math.min(
      380,
      window.innerWidth - 24
    ),

    height: Math.min(
      580,
      window.innerHeight - 24
    ),
  };
}

function getDefaultPosition() {
  if (
    typeof window ===
    "undefined"
  ) {
    return {
      x: 24,
      y: 24,
    };
  }

  return {
    x: Math.max(
      12,
      window.innerWidth - 84
    ),

    y: Math.max(
      12,
      window.innerHeight - 84
    ),
  };
}

function getSavedPosition() {
  if (
    typeof window ===
    "undefined"
  ) {
    return getDefaultPosition();
  }

  try {
    const saved =
      window.localStorage.getItem(
        STORAGE_KEYS.position
      );

    if (!saved) {
      return getDefaultPosition();
    }

    const parsed =
      JSON.parse(saved);

    if (
      typeof parsed?.x !==
        "number" ||
      typeof parsed?.y !==
        "number"
    ) {
      return getDefaultPosition();
    }

    return parsed;
  } catch {
    return getDefaultPosition();
  }
}

function clampPosition(
  position,
  elementWidth,
  elementHeight
) {
  if (
    typeof window ===
    "undefined"
  ) {
    return position;
  }

  const padding = 12;

  const maxX =
    Math.max(
      padding,
      window.innerWidth -
        elementWidth -
        padding
    );

  const maxY =
    Math.max(
      padding,
      window.innerHeight -
        elementHeight -
        padding
    );

  return {
    x: Math.min(
      Math.max(
        position.x,
        padding
      ),
      maxX
    ),

    y: Math.min(
      Math.max(
        position.y,
        padding
      ),
      maxY
    ),
  };
}

/* =========================================================
   Draft local
========================================================= */

function getSavedDraft() {
  if (
    typeof window ===
    "undefined"
  ) {
    return {
      ...EMPTY_PRODUCT_DRAFT,
    };
  }

  try {
    const raw =
      window.localStorage.getItem(
        STORAGE_KEYS.draft
      );

    if (!raw) {
      return {
        ...EMPTY_PRODUCT_DRAFT,
      };
    }

    const parsed =
      JSON.parse(raw);

    return normalizeProductDraft({
      ...parsed,

      /*
       * URL-urile blob nu mai sunt valide
       * după refresh.
       */
      images: [],
    });
  } catch {
    return {
      ...EMPTY_PRODUCT_DRAFT,
    };
  }
}

/* =========================================================
   Componentă
========================================================= */

export default function VendorAssistant() {
  const fileInputRef =
    useRef(null);

  const messagesEndRef =
    useRef(null);

  const uploadedImagesRef =
    useRef([]);

  const dragRef = useRef({
    active: false,
    moved: false,
    pointerId: null,

    startPointerX: 0,
    startPointerY: 0,

    startElementX: 0,
    startElementY: 0,
  });

  const [
    isOpen,
    setIsOpen,
  ] = useState(false);

  const [
    position,
    setPosition,
  ] = useState(
    getSavedPosition
  );

  const [
    messages,
    setMessages,
  ] = useState(
    INITIAL_MESSAGES
  );

  const [
    inputValue,
    setInputValue,
  ] = useState("");

  const [
    activeFlow,
    setActiveFlow,
  ] = useState(null);

  const [
    currentMenu,
    setCurrentMenu,
  ] = useState(
    VENDOR_MENU_IDS.ROOT
  );

  const [
    showMenu,
    setShowMenu,
  ] = useState(true);

  const [
    uploadedImages,
    setUploadedImages,
  ] = useState([]);

  const [
    productDraft,
    setProductDraft,
  ] = useState(
    getSavedDraft
  );

  const [
    isSubmitting,
    setIsSubmitting,
  ] = useState(false);

  const [
    activeVendorView,
    setActiveVendorView,
  ] = useState(
    "conversation"
  );

  const [
    productWizardStep,
    setProductWizardStep,
  ] = useState(
    "images"
  );

  const [
    analyzingProduct,
    setAnalyzingProduct,
  ] = useState(false);
const [
  analyzingOrder,
  setAnalyzingOrder,
] = useState(false);
const [
  batchWizardStep,
  setBatchWizardStep,
] = useState(
  "images"
);

const [
  batchImages,
  setBatchImages,
] = useState([]);

const [
  batchGroups,
  setBatchGroups,
] = useState([]);

const [
  analyzingBatch,
  setAnalyzingBatch,
] = useState(false);

  const panelSize =
    getPanelSize();

  const menu =
    useMemo(
      () =>
        getVendorMenu(
          currentMenu
        ),
      [currentMenu]
    );

  const inputPlaceholder =
    getVendorInputPlaceholder(
      activeFlow
    );

  const inputDisabled =
    isSubmitting;

  /* =======================================================
     Referință imagini curente
  ======================================================= */

  useEffect(() => {
    uploadedImagesRef.current =
      uploadedImages;
  }, [uploadedImages]);

  /* =======================================================
     Salvare poziție
  ======================================================= */

  useEffect(() => {
    if (
      typeof window ===
      "undefined"
    ) {
      return;
    }

    window.localStorage.setItem(
      STORAGE_KEYS.position,
      JSON.stringify(position)
    );
  }, [position]);

  /* =======================================================
     Salvare draft
  ======================================================= */

  useEffect(() => {
    if (
      typeof window ===
      "undefined"
    ) {
      return;
    }

    try {
      const safeDraft = {
        ...normalizeProductDraft(
          productDraft
        ),

        /*
         * File și blob URL nu pot fi
         * restaurate din localStorage.
         */
        images: [],
      };

      window.localStorage.setItem(
        STORAGE_KEYS.draft,
        JSON.stringify(
          safeDraft
        )
      );
    } catch {
      // Ignorăm erorile localStorage.
    }
  }, [productDraft]);

  /* =======================================================
     Scroll automat
  ======================================================= */

  useEffect(() => {
    if (
      !isOpen ||
      activeVendorView !==
        "conversation"
    ) {
      return;
    }

    messagesEndRef.current?.scrollIntoView(
      {
        behavior: "smooth",
        block: "end",
      }
    );
  }, [
    messages,
    isOpen,
    currentMenu,
    showMenu,
    activeVendorView,
  ]);

  /* =======================================================
     Redimensionare fereastră
  ======================================================= */

  useEffect(() => {
    function handleResize() {
      const currentPanelSize =
        getPanelSize();

      setPosition(
        (
          currentPosition
        ) =>
          clampPosition(
            currentPosition,

            isOpen
              ? currentPanelSize.width
              : 64,

            isOpen
              ? currentPanelSize.height
              : 64
          )
      );
    }

    window.addEventListener(
      "resize",
      handleResize
    );

    return () => {
      window.removeEventListener(
        "resize",
        handleResize
      );
    };
  }, [isOpen]);

  /* =======================================================
     Eliberare URL-uri la demontare
  ======================================================= */

  useEffect(() => {
    return () => {
      for (
        const image of
        uploadedImagesRef.current
      ) {
        if (
          image?.previewUrl
        ) {
          URL.revokeObjectURL(
            image.previewUrl
          );
        }
      }
    };
  }, []);

  /* =======================================================
     Helpers mesaje
  ======================================================= */

  function addMessage(
    message
  ) {
    if (!message) {
      return;
    }

    setMessages(
      (current) => {
        if (
          message?.id &&
          current.some(
            (existing) =>
              String(
                existing?.id ||
                  ""
              ) ===
              String(
                message.id
              )
          )
        ) {
          return current;
        }

        return [
          ...current,
          message,
        ];
      }
    );
  }

  function addConversation(
    userText,
    assistantText,
    extra = {}
  ) {
    setMessages(
      (current) => [
        ...current,

        createMessage(
          "user",
          userText
        ),

        createMessage(
          "assistant",
          assistantText,
          extra
        ),
      ]
    );
  }

  function removeLoadingMessages() {
    setMessages(
      (current) =>
        current.filter(
          (message) =>
            message?.type !==
            "loading"
        )
    );
  }

  function clearUploadedImages() {
    setUploadedImages(
      (current) => {
        for (
          const image of
          current
        ) {
          if (
            image?.previewUrl
          ) {
            URL.revokeObjectURL(
              image.previewUrl
            );
          }
        }

        return [];
      }
    );

    setProductDraft(
      (current) => ({
        ...normalizeProductDraft(
          current
        ),

        images: [],
      })
    );
  }

  function removeUploadedImage(
    imageId
  ) {
    setUploadedImages(
      (current) => {
        const selected =
          current.find(
            (image) =>
              image.id ===
              imageId
          );

        if (
          selected?.previewUrl
        ) {
          URL.revokeObjectURL(
            selected.previewUrl
          );
        }

        return current.filter(
          (image) =>
            image.id !==
            imageId
        );
      }
    );

    setProductDraft(
      (current) => ({
        ...normalizeProductDraft(
          current
        ),

        images: (
          current?.images ||
          []
        ).filter(
          (image) =>
            image?.id !==
            imageId
        ),
      })
    );
  }

  /* =======================================================
     Deschidere wizard adăugare
  ======================================================= */

  function openAddProductWizard({
    resetDraft = false,
  } = {}) {
    setActiveFlow(
      VENDOR_PRODUCT_FLOWS.ADD_PRODUCT
    );

    setShowMenu(false);

    if (resetDraft) {
      clearUploadedImages();

      setProductDraft({
        ...EMPTY_PRODUCT_DRAFT,

        activeFlow:
          VENDOR_PRODUCT_FLOWS.ADD_PRODUCT,
      });
    } else {
      setProductDraft(
        (current) => ({
          ...normalizeProductDraft(
            current
          ),

          activeFlow:
            VENDOR_PRODUCT_FLOWS.ADD_PRODUCT,
        })
      );
    }

    setProductWizardStep(
      "images"
    );

    setActiveVendorView(
      "product-wizard"
    );
  }

  function openBatchProductWizard({
  resetBatch = false,
} = {}) {
  setActiveFlow(
    VENDOR_ACTION_IDS.ADD_PRODUCTS_BATCH
  );

  setShowMenu(false);

if (resetBatch) {
  setBatchImages(
    (current) => {
      for (
        const image of
        current
      ) {
        if (
          image?.previewUrl?.startsWith(
            "blob:"
          )
        ) {
          URL.revokeObjectURL(
            image.previewUrl
          );
        }
      }

      return [];
    }
  );

  setBatchGroups([]);
}

  setBatchWizardStep(
    "images"
  );

  setActiveVendorView(
    "product-batch-wizard"
  );
}

  /* =======================================================
     Deschidere / închidere
  ======================================================= */

  function openAssistant() {
    const currentPanelSize =
      getPanelSize();

    setPosition(
      (current) =>
        clampPosition(
          current,
          currentPanelSize.width,
          currentPanelSize.height
        )
    );

    setIsOpen(true);
  }

  function closeAssistant() {
    setPosition(
      (current) =>
        clampPosition(
          current,
          64,
          64
        )
    );

    setIsOpen(false);
  }

  function resetConversation() {
    clearUploadedImages();

    setMessages([
      ...INITIAL_MESSAGES,
    ]);

    setInputValue("");

    setActiveFlow(null);

    setCurrentMenu(
      VENDOR_MENU_IDS.ROOT
    );

    setShowMenu(true);

    setProductDraft({
      ...EMPTY_PRODUCT_DRAFT,
    });

    setIsSubmitting(false);

    setActiveVendorView(
      "conversation"
    );

    setProductWizardStep(
      "images"
    );

    setAnalyzingProduct(
      false
    );
setAnalyzingOrder(
  false
);
setBatchWizardStep(
  "images"
);

setBatchImages(
  (current) => {
    for (
      const image of
      current
    ) {
      if (
        image?.previewUrl?.startsWith(
          "blob:"
        )
      ) {
        URL.revokeObjectURL(
          image.previewUrl
        );
      }
    }

    return [];
  }
);

setBatchGroups([]);

setAnalyzingBatch(
  false
);

    removeLoadingMessages();

    try {
      window.localStorage.removeItem(
        STORAGE_KEYS.draft
      );
    } catch {
      // Ignore.
    }
  }

  function returnToMainMenu() {
    setActiveFlow(null);

    setCurrentMenu(
      VENDOR_MENU_IDS.ROOT
    );

    setShowMenu(true);

    setInputValue("");

    setActiveVendorView(
      "conversation"
    );

    addMessage(
      createMessage(
        "assistant",
        "Sigur. Alege ce dorești să administrezi."
      )
    );
  }

  function handleMenuBack() {
    setCurrentMenu(
      menu.parent ||
        VENDOR_MENU_IDS.ROOT
    );

    setShowMenu(true);
  }

  /* =======================================================
     Acțiuni meniu
  ======================================================= */
async function handleAction(
  actionId
) {
  if (
    actionId ===
    VENDOR_ACTION_IDS.PRODUCTS_MENU
  ) {
    setCurrentMenu(
      VENDOR_MENU_IDS.PRODUCTS
    );

    setShowMenu(true);

    return;
  }

  if (
    actionId ===
    VENDOR_ACTION_IDS.ADD_PRODUCT
  ) {
    openAddProductWizard();

    return;
  }

  if (
    actionId ===
    VENDOR_ACTION_IDS.ADD_PRODUCTS_BATCH
  ) {
    openBatchProductWizard({
      resetBatch: true,
    });

    return;
  }

  if (
    actionId ===
    VENDOR_ACTION_IDS.STORE
  ) {
    setCurrentMenu(
      VENDOR_MENU_IDS.STORE
    );

    setShowMenu(true);

    addMessage(
      createMessage(
        "assistant",
        "Secțiunea magazinului va fi conectată într-o etapă ulterioară."
      )
    );

    return;
  }

  setShowMenu(false);

  try {
    const handled =
      await startVendorFlow({
        actionId,

        addConversation,
        addMessage,
        createMessage,

        setActiveFlow,
      });

    if (!handled) {
      addMessage(
        createMessage(
          "assistant",
          "Această funcționalitate va fi conectată în etapa următoare."
        )
      );
    }
  } catch (error) {
    addMessage(
      createMessage(
        "assistant",

        error instanceof Error
          ? error.message
          : "Nu am putut deschide această secțiune."
      )
    );
  }
}

  /* =======================================================
     Alegeri din mesaje
  ======================================================= */

  async function handleChoice(
    choice,
    sourceMessage = null
  ) {
    const label =
      getChoiceLabel(
        choice
      );

    addMessage(
      createMessage(
        "user",
        label
      )
    );

    try {
      const result =
        await handleVendorChoice({
          activeFlow,
          choice,
          sourceMessage,

          addMessage,
          createMessage,
        });

      if (
        result?.shouldOpenUpload
      ) {
        fileInputRef.current?.click();
      }
    } catch (error) {
      addMessage(
        createMessage(
          "assistant",

          error instanceof Error
            ? error.message
            : "Nu am putut procesa selecția."
        )
      );
    }
  }

  /* =======================================================
     Încărcare fotografii
  ======================================================= */

  async function handleImageChange(
    event
  ) {
    const files =
      Array.from(
        event.target.files ||
          []
      );

    event.target.value = "";

    if (!files.length) {
      return;
    }

    const currentImagesCount =
  activeVendorView ===
  "product-batch-wizard"
    ? batchImages.length
    : uploadedImages.length;

const maxAllowedImages =
  activeVendorView ===
  "product-batch-wizard"
    ? 50
    : MAX_IMAGES;

const remainingSlots =
  Math.max(
    0,
    maxAllowedImages -
      currentImagesCount
  );

    if (
      remainingSlots === 0
    ) {
      addMessage(
        createMessage(
          "assistant",
          `Poți încărca maximum ${maxAllowedImages} fotografii.`
        )
      );

      return;
    }

    const selectedFiles =
      files.slice(
        0,
        remainingSlots
      );

    const nextImages = [];

    for (
      const file of
      selectedFiles
    ) {
      const fileType =
        String(
          file?.type ||
            ""
        ).toLowerCase();

      if (
        !fileType.startsWith(
          "image/"
        )
      ) {
        addMessage(
          createMessage(
            "assistant",
            `Fișierul „${file.name}” nu este o imagine validă.`
          )
        );

        continue;
      }

      if (
        file.size >
        MAX_IMAGE_SIZE
      ) {
        addMessage(
          createMessage(
            "assistant",
            `Imaginea „${file.name}” este prea mare. Dimensiunea maximă este de 10 MB.`
          )
        );

        continue;
      }

      const image = {
        id: `${Date.now()}-${Math.random()
          .toString(36)
          .slice(2)}`,

        file,

        filename:
          file.name,

        previewUrl:
          URL.createObjectURL(
            file
          ),
      };

      nextImages.push(
        image
      );
    }

    if (
      !nextImages.length
    ) {
      return;
    }
if (
  activeVendorView ===
  "product-batch-wizard"
) {
  setBatchImages(
    (current) => [
      ...current,
      ...nextImages,
    ]
  );

  return;
}
    setUploadedImages(
      (current) => [
        ...current,
        ...nextImages,
      ]
    );

    setProductDraft(
      (current) => ({
        ...normalizeProductDraft(
          current
        ),

        images: [
          ...(Array.isArray(
            current?.images
          )
            ? current.images
            : []),

          ...nextImages,
        ],

        activeFlow,
      })
    );

    /*
     * În wizard fotografiile sunt deja
     * afișate în grilă. Nu mai adăugăm
     * câte un mesaj pentru fiecare poză.
     */
    if (
      activeVendorView ===
      "product-wizard"
    ) {
      return;
    }

    for (
      const image of
      nextImages
    ) {
      addMessage({
        id:
          `${image.id}-message`,

        role: "user",
        type: "image",

        content:
          "Fotografie produs",

        imageUrl:
          image.previewUrl,

        filename:
          image.filename,
      });
    }

    const total =
      uploadedImages.length +
      nextImages.length;

    if (
      activeFlow ===
      VENDOR_PRODUCT_FLOWS.ADD_PRODUCT
    ) {
      addMessage(
        createMessage(
          "assistant",

          total === 1
            ? "Am primit fotografia produsului. Poți adăuga și alte poze sau îmi poți descrie produsul."
            : `Am primit ${total} fotografii. Poți adăuga alte poze sau îmi poți descrie produsul.`
        )
      );

      return;
    }

    if (
      activeFlow ===
      VENDOR_PRODUCT_FLOWS.PRODUCT_HELP
    ) {
      addMessage(
        createMessage(
          "assistant",

          total === 1
            ? "Am primit fotografia. Spune-ne acum pe scurt ce produs vinzi și unde ai nevoie de ajutor."
            : `Am primit ${total} fotografii. Spune-ne acum pe scurt ce produs vinzi și unde ai nevoie de ajutor.`
        )
      );

      return;
    }

    addMessage(
      createMessage(
        "assistant",
        "Am primit fotografiile."
      )
    );
  }

  /* =======================================================
     Analiză temporară

     În etapa următoare înlocuim simularea cu:
     POST /api/ai/product-analyze
  ======================================================= */

  async function handleAnalyzeProduct() {
  if (
    !uploadedImages.length
  ) {
    window.alert(
      "Încarcă mai întâi cel puțin o fotografie."
    );

    return;
  }

  try {
    setAnalyzingProduct(
      true
    );

    setProductWizardStep(
      "analysis"
    );

    const {
      analysis,
      imageUrls,
    } =
      await analyzeVendorProduct({
        images:
          uploadedImages,
      });

    const canApplyOrderMode =
      Number(
        analysis
          ?.orderModeConfidence
      ) >= 0.75;

    setProductDraft(
      (current) => ({
        ...normalizeProductDraft(
          current
        ),

        images:
          imageUrls,

        title:
          analysis?.title ||
          current.title,

        description:
          analysis?.description ||
          current.description,

        category:
          analysis?.category ||
          current.category,

        materialMain:
          analysis?.materialMain ||
          current.materialMain,

        technique:
          analysis?.technique ||
          current.technique,

        color:
          analysis?.color ||
          current.color,

        styleTags:
          Array.isArray(
            analysis?.styleTags
          )
            ? analysis.styleTags.join(
                ", "
              )
            : current.styleTags,

        occasionTags:
          Array.isArray(
            analysis?.occasionTags
          )
            ? analysis.occasionTags.join(
                ", "
              )
            : current.occasionTags,

        careInstructions:
          analysis?.careInstructions ||
          current.careInstructions,

        specialNotes:
          analysis?.specialNotes ||
          current.specialNotes,

        orderMode:
          canApplyOrderMode
            ? analysis
                ?.likelyOrderMode ||
              current.orderMode
            : current.orderMode,

        optionsSchema:
          canApplyOrderMode &&
          analysis
            ?.likelyOrderMode ===
            "OPTIONS" &&
          Array.isArray(
            analysis
              ?.likelyOptions
          )
            ? analysis
                .likelyOptions
            : current
                .optionsSchema,

        customSchema:
          canApplyOrderMode &&
          analysis
            ?.likelyOrderMode ===
            "OPTIONS" &&
          Array.isArray(
            analysis
              ?.likelyCustomFields
          )
            ? analysis
                .likelyCustomFields
            : current
                .customSchema,

        quoteSchema:
          analysis
            ?.likelyOrderMode ===
            "QUOTE_ONLY"
            ? current
                .quoteSchema
            : [],

        aiAnalysis:
          analysis,

        aiQuestions:
          Array.isArray(
            analysis?.questions
          )
            ? analysis
                .questions
            : [],

        aiConfidence:
          analysis?.confidence ??
          null,
      })
    );

    setUploadedImages(
      imageUrls.map(
        (
          url,
          index
        ) => ({
          id:
            `uploaded-${index}-${Date.now()}`,

          url,

          previewUrl:
            url,

          filename:
            `Imagine ${
              index + 1
            }`,
        })
      )
    );

    setProductWizardStep(
      "details"
    );
  } catch (error) {
    console.error(
      "Vendor product analysis error:",
      error
    );

    setProductWizardStep(
      "images"
    );

    window.alert(
      error?.message ||
        "Nu am putut analiza produsul."
    );
  } finally {
    setAnalyzingProduct(
      false
    );
  }
}
async function handleAnalyzeProductOrder() {
  const safeDraft =
    normalizeProductDraft(
      productDraft
    );

  const message =
    String(
      safeDraft.orderInstructions ||
        ""
    ).trim();

 const hasAiContext =
  Boolean(
    safeDraft.aiAnalysis
  ) ||
  safeDraft.aiQuestions.length > 0 ||
  safeDraft.optionsSchema.length > 0 ||
  safeDraft.customSchema.length > 0 ||
  safeDraft.quoteSchema.length > 0;

if (
  !message &&
  !hasAiContext
) {
  window.alert(
    "Explică pe scurt cum trebuie comandat produsul."
  );

  return;
}

  try {
    setAnalyzingOrder(
      true
    );

    const {
      result,
      imageUrls,
    } =
      await analyzeVendorProductOrder({
        product:
          safeDraft,

        message,

        images:
          safeDraft.images,

        visionAnalysis:
          safeDraft.aiAnalysis,

        history: [],
      });

    const patch =
      result?.patch &&
      typeof result.patch ===
        "object"
        ? result.patch
        : {};

    const nextOrderMode =
      [
        "READY_TO_BUY",
        "OPTIONS",
        "QUOTE_ONLY",
      ].includes(
        patch?.orderMode
      )
        ? patch.orderMode
        : safeDraft.orderMode;

    setProductDraft(
      (current) => {
        const currentDraft =
          normalizeProductDraft(
            current
          );

        return {
          ...currentDraft,

          images:
            Array.isArray(
              imageUrls
            ) &&
            imageUrls.length
              ? imageUrls
              : currentDraft.images,

          price:
            patch.price !==
              null &&
            patch.price !==
              undefined
              ? patch.price
              : currentDraft.price,

          availability:
            patch.availability ||
            currentDraft.availability,

          readyQty:
            patch.readyQty !==
              null &&
            patch.readyQty !==
              undefined
              ? patch.readyQty
              : currentDraft.readyQty,

          leadTimeDays:
            patch.leadTimeDays !==
              null &&
            patch.leadTimeDays !==
              undefined
              ? patch.leadTimeDays
              : currentDraft.leadTimeDays,

          orderMode:
            nextOrderMode,

          optionsSchema:
            nextOrderMode ===
              "OPTIONS"
              ? Array.isArray(
                  patch.optionsSchema
                )
                ? patch.optionsSchema
                : currentDraft.optionsSchema
              : [],

          customSchema:
            nextOrderMode ===
              "OPTIONS"
              ? Array.isArray(
                  patch.customSchema
                )
                ? patch.customSchema
                : currentDraft.customSchema
              : [],

          repeatedGroups:
            nextOrderMode ===
              "OPTIONS"
              ? currentDraft.repeatedGroups
              : [],

          quoteSchema:
            nextOrderMode ===
              "QUOTE_ONLY"
              ? Array.isArray(
                  patch.quoteSchema
                )
                ? patch.quoteSchema
                : currentDraft.quoteSchema
              : [],

          aiOrderMessage:
            String(
              result?.message ||
                ""
            ).trim(),

          aiOrderReason:
            String(
              result?.orderModeReason ||
                ""
            ).trim(),

          aiOrderConfidence:
            result?.confidence ??
            null,

          aiQuestions:
            Array.isArray(
              result?.questions
            )
              ? result.questions
              : [],
        };
      }
    );
  } catch (error) {
    console.error(
      "Vendor product order analysis error:",
      error
    );

    window.alert(
      error?.message ||
        "Nu am putut pregăti formularul de comandă."
    );
  } finally {
    setAnalyzingOrder(
      false
    );
  }
}

async function handleAnalyzeBatchGroups() {
  if (
    !batchImages.length
  ) {
    window.alert(
      "Încarcă mai întâi fotografiile produselor."
    );

    return;
  }

  try {
    setAnalyzingBatch(
      true
    );

    setBatchWizardStep(
      "analysis"
    );

    /*
     * Temporar, până conectăm endpointul AI:
     * punem toate imaginile într-un singur grup.
     */
    await new Promise(
      (resolve) =>
        window.setTimeout(
          resolve,
          700
        )
    );

    setBatchGroups([
      {
        id:
          `group-${Date.now()}`,

        title:
          "Produs identificat",

        images:
          batchImages,

        confidence:
          null,

        status:
          "NEEDS_REVIEW",

        productDraft: {
          images:
            batchImages,

          title: "",
          description: "",
          category: "",

          price: "",
          currency:
            "RON",

          availability:
            "",

          readyQty:
            "",

          leadTimeDays:
            "",

          orderMode:
            "READY_TO_BUY",

          optionsSchema:
            [],

          customSchema:
            [],

          repeatedGroups:
            [],

          quoteSchema:
            [],

          orderInstructions:
            "",
        },

        missingFields:
          [],

        questions:
          [],
      },
    ]);

    setBatchWizardStep(
      "groups"
    );
  } catch (error) {
    console.error(
      "Batch product grouping failed:",
      error
    );

    setBatchWizardStep(
      "images"
    );

    window.alert(
      error?.message ||
        "Nu am putut grupa fotografiile."
    );
  } finally {
    setAnalyzingBatch(
      false
    );
  }
}

  /* =======================================================
     Trimitere mesaj text
  ======================================================= */

  async function handleSubmit(
    event
  ) {
    event.preventDefault();

    if (isSubmitting) {
      return;
    }

    const value =
      inputValue.trim();

    if (!value) {
      return;
    }

    const detectedIntent =
      detectVendorIntent(
        value
      );

    /*
     * Orice formulare clară de tip:
     *
     * „vreau să adaug un produs”
     *
     * deschide același wizard.
     */
    if (
      detectedIntent?.type ===
      VENDOR_INTENTS.ADD_PRODUCT
    ) {
      addMessage(
        createMessage(
          "user",
          value
        )
      );

      setInputValue("");

      addMessage(
        createMessage(
          "assistant",
          "Sigur. Te ajut să adaugi produsul pas cu pas."
        )
      );

      openAddProductWizard();

      return;
    }

    addMessage(
      createMessage(
        "user",
        value
      )
    );

    setInputValue("");

    setIsSubmitting(true);

    setProductDraft(
      (current) => ({
        ...normalizeProductDraft(
          current
        ),

        description:
          activeFlow ===
          VENDOR_PRODUCT_FLOWS.ADD_PRODUCT
            ? value
            : current.description,

        orderInstructions:
          activeFlow ===
          VENDOR_PRODUCT_FLOWS.ADD_PRODUCT
            ? value
            : current.orderInstructions,

        activeFlow,
      })
    );

    try {
      const handled =
        await submitVendorMessage({
          activeFlow,
          value,
          productDraft,

          addMessage,
          createMessage,

          setProductDraft,
        });

      if (!handled) {
        addMessage(
          createMessage(
            "assistant",
            "Am primit mesajul. Alege o acțiune din meniul asistentului pentru a continua."
          )
        );
      }
    } catch (error) {
      addMessage(
        createMessage(
          "assistant",

          error instanceof Error
            ? error.message
            : "Mesajul nu a putut fi procesat."
        )
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  /* =======================================================
     Drag
  ======================================================= */

  function handlePointerDown(
    event
  ) {
    if (
      event.button !== 0
    ) {
      return;
    }

    dragRef.current = {
      active: true,
      moved: false,

      pointerId:
        event.pointerId,

      startPointerX:
        event.clientX,

      startPointerY:
        event.clientY,

      startElementX:
        position.x,

      startElementY:
        position.y,
    };

    event.currentTarget.setPointerCapture(
      event.pointerId
    );
  }

  function handlePointerMove(
    event
  ) {
    const dragState =
      dragRef.current;

    if (
      !dragState.active ||
      dragState.pointerId !==
        event.pointerId
    ) {
      return;
    }

    const deltaX =
      event.clientX -
      dragState.startPointerX;

    const deltaY =
      event.clientY -
      dragState.startPointerY;

    if (
      Math.abs(deltaX) >
        4 ||
      Math.abs(deltaY) >
        4
    ) {
      dragRef.current.moved =
        true;
    }

    const currentPanelSize =
      getPanelSize();

    setPosition(
      clampPosition(
        {
          x:
            dragState.startElementX +
            deltaX,

          y:
            dragState.startElementY +
            deltaY,
        },

        isOpen
          ? currentPanelSize.width
          : 64,

        isOpen
          ? currentPanelSize.height
          : 64
      )
    );
  }

  function handlePointerUp(
    event
  ) {
    const dragState =
      dragRef.current;

    if (
      dragState.pointerId !==
      event.pointerId
    ) {
      return;
    }

    const wasMoved =
      dragState.moved;

    dragRef.current.active =
      false;

    dragRef.current.pointerId =
      null;

    if (
      !isOpen &&
      !wasMoved
    ) {
      openAssistant();
    }
  }

  /* =======================================================
     Render
  ======================================================= */

  return (
    <>
      <input
        ref={
          fileInputRef
        }
        type="file"
        multiple
        accept="image/png,image/jpeg,image/webp"
        className={
          styles.fileInput
        }
        onChange={
          handleImageChange
        }
      />

      <div
        className={
          styles[
            "artfest-assistant"
          ]
        }
        style={{
          left:
            position.x,

          top:
            position.y,

          width:
            isOpen
              ? panelSize.width
              : 64,

          height:
            isOpen
              ? panelSize.height
              : 64,
        }}
      >
        {isOpen ? (
          <section
            className={
              styles[
                "artfest-assistant-panel"
              ]
            }
          >
            <header
              className={
                styles[
                  "artfest-assistant-header"
                ]
              }
              onPointerDown={
                handlePointerDown
              }
              onPointerMove={
                handlePointerMove
              }
              onPointerUp={
                handlePointerUp
              }
              onPointerCancel={
                handlePointerUp
              }
            >
              <div>
                <span>
                  <DragIcon />
                </span>

                <div>
                  <SparkleIcon />
                </div>

                <div>
                  <h2>
                    Asistent magazin
                  </h2>

                  <p>
                    Produse și administrare
                  </p>
                </div>
              </div>

              <div
                onPointerDown={(
                  event
                ) =>
                  event.stopPropagation()
                }
              >
                <button
                  type="button"
                  onClick={
                    returnToMainMenu
                  }
                  aria-label="Meniu principal"
                  title="Meniu principal"
                >
                  <HomeIcon />
                </button>

                <button
                  type="button"
                  onClick={
                    resetConversation
                  }
                  aria-label="Resetează conversația"
                  title="Conversație nouă"
                >
                  <RefreshIcon />
                </button>

                <button
                  type="button"
                  onClick={
                    closeAssistant
                  }
                  aria-label="Închide asistentul"
                  title="Închide"
                >
                  <CloseIcon />
                </button>
              </div>
            </header>

            <div
              className={
                styles[
                  "artfest-assistant-conversation"
                ]
              }
            >
             {activeVendorView ===
"product-wizard" ? (
  <VendorProductWizard
    draft={
      productDraft
    }
    setDraft={
      setProductDraft
    }
    step={
      productWizardStep
    }
    setStep={
      setProductWizardStep
    }
    analyzing={
      analyzingProduct
    }
    analyzingOrder={
      analyzingOrder
    }
    onUpload={() =>
      fileInputRef.current?.click()
    }
    onAnalyze={
      handleAnalyzeProduct
    }
    onAnalyzeOrder={
      handleAnalyzeProductOrder
    }
    onBack={() => {
      setActiveVendorView(
        "conversation"
      );

      setCurrentMenu(
        VENDOR_MENU_IDS.PRODUCTS
      );

      setShowMenu(
        true
      );
    }}
    onClose={
      closeAssistant
    }
    onRemoveImage={
      removeUploadedImage
    }
  />
) : activeVendorView ===
  "product-batch-wizard" ? (
  <VendorProductBatchWizard
    images={
      batchImages
    }
    groups={
      batchGroups
    }
    setGroups={
      setBatchGroups
    }
    step={
      batchWizardStep
    }
    setStep={
      setBatchWizardStep
    }
    analyzing={
      analyzingBatch
    }
    onUpload={() =>
      fileInputRef.current?.click()
    }
    onAnalyzeGroups={
      handleAnalyzeBatchGroups
    }
    onBack={() => {
      setActiveVendorView(
        "conversation"
      );

      setCurrentMenu(
        VENDOR_MENU_IDS.PRODUCTS
      );

      setShowMenu(
        true
      );
    }}
    onClose={
      closeAssistant
    }
  />
) : (
  <div>
    {messages.map(
      (message) => (
        <AssistantMessage
          key={
            message.id
          }
          message={
            message
          }
          onChoice={
            handleChoice
          }
          onUpload={() =>
            fileInputRef.current?.click()
          }
        />
      )
    )}

    {showMenu && (
      <ActionMenu
        title={
          menu.title
        }
        actions={
          menu.actions
        }
        canGoBack={Boolean(
          menu.parent
        )}
        onBack={
          handleMenuBack
        }
        onSelect={
          handleAction
        }
        BackIcon={
          BackIcon
        }
        ChevronRightIcon={
          ChevronRightIcon
        }
      />
    )}

    <div
      ref={
        messagesEndRef
      }
    />
  </div>
)}
            </div>

            {activeVendorView ===
              "conversation" && (
              <form
                onSubmit={
                  handleSubmit
                }
                className={
                  styles[
                    "artfest-assistant-form"
                  ]
                }
              >
                {uploadedImages.length >
                  0 && (
                  <div
                    className={
                      styles.uploadPreview
                    }
                  >
                    <img
                      src={
                        uploadedImages[0]
                          .previewUrl
                      }
                      alt="Imagine produs"
                    />

                    <span>
                      {uploadedImages.length ===
                      1
                        ? uploadedImages[0]
                            .filename
                        : `${uploadedImages.length} fotografii selectate`}
                    </span>

                    <button
                      type="button"
                      onClick={
                        clearUploadedImages
                      }
                      aria-label="Elimină fotografiile"
                      title="Elimină toate fotografiile"
                    >
                      <CloseIcon />
                    </button>
                  </div>
                )}

                <div>
                  <button
                    type="button"
                    onClick={() =>
                      fileInputRef.current?.click()
                    }
                    aria-label="Încarcă fotografii"
                    title="Încarcă fotografii"
                    disabled={
                      isSubmitting
                    }
                  >
                    <AttachmentIcon />
                  </button>

                  <textarea
                    value={
                      inputValue
                    }
                    onChange={(
                      event
                    ) =>
                      setInputValue(
                        event.target
                          .value
                      )
                    }
                    onKeyDown={(
                      event
                    ) => {
                      if (
                        event.key ===
                          "Enter" &&
                        !event.shiftKey
                      ) {
                        event.preventDefault();

                        if (
                          !inputDisabled
                        ) {
                          handleSubmit(
                            event
                          );
                        }
                      }
                    }}
                    rows={1}
                    placeholder={
                      inputPlaceholder
                    }
                    className={
                      styles[
                        "artfest-assistant-input"
                      ]
                    }
                    disabled={
                      inputDisabled
                    }
                    aria-label="Mesaj către asistentul magazinului"
                  />

                  <button
                    type="submit"
                    disabled={
                      inputDisabled ||
                      !inputValue.trim()
                    }
                    aria-label="Trimite mesajul"
                  >
                    <SendIcon />
                  </button>
                </div>

                <p>
                  Asistentul te ajută să
                  pregătești și să
                  administrezi produsele
                  magazinului.
                </p>
              </form>
            )}
          </section>
        ) : (
          <button
            type="button"
            className={
              styles[
                "artfest-assistant-button"
              ]
            }
            onPointerDown={
              handlePointerDown
            }
            onPointerMove={
              handlePointerMove
            }
            onPointerUp={
              handlePointerUp
            }
            onPointerCancel={
              handlePointerUp
            }
            aria-label="Deschide asistentul magazinului"
            title="Asistent magazin"
          >
            <SparkleIcon
              size={28}
            />

            <span
              className={
                styles[
                  "artfest-assistant-online"
                ]
              }
            />
          </button>
        )}
      </div>
    </>
  );
}