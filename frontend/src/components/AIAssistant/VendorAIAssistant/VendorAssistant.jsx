// src/components/AIAssistant/Vendor/VendorAssistant.jsx

import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { useLocation } from "react-router-dom";

import styles from "../AiAssistant.module.css";

import { derivePageContext } from "../derivePageContext.js";
import { useCurrentEntityContext } from "../CurrentEntityContext.jsx";

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
  uploadVendorProductImages,
} from "./services/vendorProductAi.js";

import { sendPriceCalculatorTurn } from "./services/vendorPriceCalculatorApi.js";

import { api } from "../../../lib/api.js";

import VendorProductPicker from "../../../pages/Vendor/CostsProfit/components/VendorProductPicker.jsx";
import PricingBreakdownCard from "../../../pages/Vendor/CostsProfit/components/PricingBreakdownCard.jsx";
import PhotoCostingDraftEditor from "../../../pages/Vendor/CostsProfit/components/PhotoCostingDraftEditor.jsx";
import PendingActionCard from "../../../pages/Vendor/CostsProfit/components/PendingActionCard.jsx";
import { searchVendorProducts } from "../../../pages/Vendor/CostsProfit/productSearchApi.js";
import { formatRonFromCents } from "../../../pages/Vendor/CostsProfit/formatMoney.js";
import {
  updateCostItem,
  createCostItem,
} from "../../../pages/Vendor/CostsProfit/costLibraryApi.js";

import { detectCostItemsFromMaterials } from "../../../pages/Vendor/CostsProfit/costingImageAnalysisApi.js";

import {
  sendAssistantCommand,
  resolveAssistantCommand,
} from "../../../pages/Vendor/CostsProfit/assistantCommandApi.js";

import {
  sendCopilotAsk,
  fetchVendorInsights,
} from "../copilotApi.js";

import { createSupportTicket } from "../Support/supportApi.js";

/*
 * BUGFIX (audit): moștenire capabilități USER -> VENDOR - vendorul
 * rămâne și cumpărător. Reutilizează EXACT clasificatorul/flow-ul
 * de marketplace search (text + imagine) folosit de AiAssistant.jsx
 * (widget-ul de client), nu un search separat pentru vendor.
 */
import {
  detectMarketplaceIntent,
  submitProductMessage,
  runImageSearchFlow,
  handleProductChoice,
  startProductFlow,
} from "../Products/assistantProducts.js";

const MARKETPLACE_FLOW_TYPES = new Set([
  "product-search",
  "image-search",
  "gift",
  "budget",
]);

import {
  fetchProductCosting as fetchPersistedProductCosting,
  saveProductCosting as savePersistedProductCosting,
  costingToCostDraftShape,
  applyRecommendedPrice as applyPersistedRecommendedPrice,
  recalculateProductsBatch,
} from "../../../pages/Vendor/CostsProfit/productCostingApi.js";

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

/*
 * Tipuri de comandă considerate "globale" de business - dacă
 * orchestratorul (POST /api/ai/assistant/command) clasifică
 * astfel un mesaj scris CÂT conversația e în modul
 * PRICE_CALCULATOR, mesajul nu trebuie tratat ca modificare a
 * draftului curent, ci interceptat și rezolvat prin fluxul
 * normal de pendingAction (bibliotecă de costuri, citiri,
 * recalculări, aplicare preț). Vezi tryHandleGlobalCommandFromCalculator.
 */
const GLOBAL_COSTING_COMMAND_TYPES = new Set([
  "UPDATE_COST_ITEM",
  "READ_PROFITABILITY",
  "READ_PRODUCT_COST",
  "READ_LIBRARY",
  "RECALCULATE_BATCH",
  "UPDATE_PRODUCT_COSTING",
  "APPLY_RECOMMENDED_PRICE",
]);

/*
 * Gate determinist, NU AI - decide dacă un mesaj scris în
 * modul PRICE_CALCULATOR merită măcar întrebat orchestratorului
 * dacă e o comandă globală. Fără acest gate, FIECARE răspuns
 * normal la calculator (ex. "3 ore, 20 lei ora") ar fi trimis
 * inutil la orchestrator, cu riscul unei clasificări greșite
 * care întrerupe conversația (exact bug-ul raportat). Cuvintele
 * de mai jos apar aproape exclusiv în comenzi de business reale,
 * niciodată în răspunsuri normale despre materiale/manoperă/profit.
 */
const GLOBAL_COMMAND_HINT_PATTERN =
  /(bibliotec|produsele\b|produsul\s|produse\s+(sub|peste|cu)|profit(ul)?\s+(sub|peste)|sub\s+cost|recalculeaz|pre[țt]ul?\s+recomandat|aplic[aă]\s+pre[țt]ul)/i;

/*
 * Fraze de ieșire explicită din modul PRICE_CALCULATOR /
 * PHOTO_COSTING - verificate determinist, ÎNAINTEA gate-ului de
 * mai sus, ca să nu depindă deloc de AI (nu există un commandType
 * "EXIT" în orchestrator).
 */
const EXIT_SUBFLOW_PHRASES = [
  "ieși din calculator",
  "iesi din calculator",
  "ieși din calcul",
  "iesi din calcul",
  "renunță la calculator",
  "renunta la calculator",
  "renunță la calcul",
  "renunta la calcul",
  "închide calculatorul",
  "inchide calculatorul",
  "ieși din analiza foto",
  "iesi din analiza foto",
];

function isExitSubflowMessage(text) {
  const normalized = String(text || "")
    .trim()
    .toLowerCase();

  return EXIT_SUBFLOW_PHRASES.some(
    (phrase) =>
      normalized === phrase ||
      normalized.startsWith(`${phrase} `)
  );
}

const EMPTY_CONVERSATION_CONTEXT = {
  mode: "NORMAL",
  productId: null,
  costDraft: null,
  photoDraft: null,
  awaitingField: null,
  history: [],
  sourceImageUrl: null,

  /*
   * UPDATE_PRODUCT: câmpul cerut + patch-ul deja extras, ținute
   * aici CÂT TIMP awaitingField === "product" (produsul încă nu
   * e identificat) - odată ce produsul e rezolvat (productId
   * cunoscut), acest draft nu mai e necesar (vezi
   * processCostingCommandResult).
   */
  productUpdateDraft: null,

  /*
   * FAZA 8-10: triaj de suport activ (clarificare sau confirmare
   * de ticket în curs) - populat/golit din result.supportContext
   * întors de copilotRouter.js. NU se combină cu mode/productId de
   * mai sus (sunt fluxuri paralele, niciodată active simultan).
   */
  activeIntent: null,
  currentFlow: null,
  collectedParams: null,

  /*
   * PROACTIVE COPILOT: insight-ul cel mai sever afișat ultima dată
   * (vezi handleInsightFollowUp din copilotRouter.js) - permite
   * "Da, recalculează-le" / "arată-mi produsele" fără să mai
   * numească insight-ul. La fel ca activeIntent, NU se combină cu
   * mode/productId (fluxuri paralele).
   */
  activeInsight: null,
};

/*
 * Opțiunile arătate imediat după ce vendorul încarcă o
 * fotografie fără alt context (mode "PHOTO_PENDING") - un card
 * inline (message.choices), NU un meniu/activeVendorView separat.
 */
const PHOTO_PENDING_CHOICES = [
  "Calculează prețul",
  "Analizează produsul",
  "Caută produse asemănătoare",
  "Folosește pentru un produs existent",
  "Adaugă produs nou",
  "Renunță",
];

/*
 * Determinist (NU AI) - dacă vendorul scrie liber în loc să
 * apese un buton cât suntem în PHOTO_PENDING, interpretăm mesajul
 * folosind fotografia deja încărcată ca context, fără alt apel.
 * Dacă nimic nu se potrivește clar, întoarcem null - apelantul
 * cere o alegere explicită în loc să ghicească.
 */
function detectPhotoPendingChoice(text) {
  const normalized = String(text || "")
    .trim()
    .toLowerCase();

  if (!normalized) return null;

  if (/renun[țt][aă]|anuleaz/i.test(normalized)) {
    return "Renunță";
  }

  /*
   * BUGFIX (audit): poza încărcată poate fi și un instrument de
   * cumpărare, nu doar de gestiune magazin - "caut produse
   * asemănătoare"/"unde găsesc ceva ca asta" trebuie verificat
   * ÎNAINTEA "produs nou"/"produs existent" (altfel "găsește-mi
   * ceva asemănător ca produs nou" ar risca ambiguitate, deși
   * puțin probabil în practică).
   */
  if (
    /(asemanator|similar|gasesc|cauta?\s+produs)/i.test(
      normalized
    )
  ) {
    return "Caută produse asemănătoare";
  }

  if (
    /produs\s+nou/i.test(normalized) ||
    /adaug(a|ă)?\s*(-l|-i)?\s*(ca\s+)?produs/i.test(
      normalized
    ) ||
    /(vreau|il|îl)\s.*adaug/i.test(normalized)
  ) {
    return "Adaugă produs nou";
  }

  if (
    /produs\s+existent/i.test(normalized) ||
    /produsul\s+existent/i.test(normalized)
  ) {
    return "Folosește pentru un produs existent";
  }

  if (
    /analizeaz|identific[aă]|ce\s+(e|este)\s+(în|in)\s+poz|ce\s+produs\s+e/i.test(
      normalized
    )
  ) {
    return "Analizează produsul";
  }

  if (
    /calculeaz|pre[țt]|cost|material/i.test(
      normalized
    )
  ) {
    return "Calculează prețul";
  }

  return null;
}

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
  const location = useLocation();

  const {
    currentEntity: announcedEntity,
    pageTypeOverride,
  } = useCurrentEntityContext();

  /*
   * PAGE-AWARE / ENTITY-AWARE: {pathname, pageType} vine STRICT din
   * ruta reală curentă (derivePageContext - vezi App.jsx pentru
   * rutele reale, nu inventăm pathname-uri). Entitatea rezolvată
   * prioritizează ce a "anunțat" explicit pagina curentă
   * (announcedEntity - ex. produsul deschis într-un modal de
   * editare, care nu are id în URL) față de entitatea derivată
   * STRICT din URL (ex. /vendor/orders/:id) - o pagină care anunță
   * activ ceva e un semnal mai proaspăt decât un id "ghicit" din
   * URL. Când pagina nu anunță nimic, cade pe entityFromUrl.
   */
  const { currentPage, entityFromUrl } = useMemo(
    () => derivePageContext(location.pathname),
    [location.pathname]
  );

  const effectivePage = useMemo(
    () =>
      pageTypeOverride
        ? { ...currentPage, pageType: pageTypeOverride }
        : currentPage,
    [currentPage, pageTypeOverride]
  );

  const resolvedCurrentEntity =
    announcedEntity || entityFromUrl || null;

  /*
   * PROACTIVE COPILOT: insight-urile se afișează O SINGURĂ DATĂ,
   * la PRIMA deschidere a widget-ului per încărcare de pagină - nu
   * la fiecare open/close (asta ar deveni spam, exact ce cerința
   * interzice explicit: "nu transforma widget-ul într-un dashboard
   * aglomerat").
   */
  const insightsShownRef = useRef(false);

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

  /*
   * BUGFIX (audit): id-ul căutării vizuale de marketplace (căutare
   * produse asemănătoare) - separat de fluxul de photo costing, nu
   * afectează productDraft/conversationContext existente.
   */
  const [
    visualSearchId,
    setVisualSearchId,
  ] = useState(null);

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

/*
 * Stare pentru butonul "Salvează produsul" din pasul final al
 * wizard-ului - înlocuiește vechiul window.alert stub. Publicarea
 * reală (POST /vendors/store/:slug/products, EXACT endpoint-ul
 * folosit de AddProductContainer.jsx) rulează în
 * handlePublishProductFromWizard.
 */
const [
  wizardPublishing,
  setWizardPublishing,
] = useState(false);

const [
  wizardPublishError,
  setWizardPublishError,
] = useState("");

const [
  wizardPublishSuccess,
  setWizardPublishSuccess,
] = useState(null);

/*
 * { costDraft, pricing } - setat EXPLICIT doar de
 * handleCreateProductFromCalculator, la momentul exact al
 * handoff-ului calculator -> wizard. NU citim direct
 * conversationContext.costDraft/calculatorPricing în
 * handlePublishProductFromWizard, ca să evităm legarea unui
 * costing VECHI (dintr-o sesiune de calculator abandonată) de
 * un produs complet nelegat, deschis ulterior prin "Adaugă
 * produs" normal. openAddProductWizard resetează asta la null
 * de fiecare dată CÂND NU vine explicit din calculator.
 */
const [
  pendingCostingLink,
  setPendingCostingLink,
] = useState(null);

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

/* =========================================================
   Calculator de preț + analiză foto - INLINE în conversație,
   fără activeVendorView separat.

   conversationContext e singura sursă de adevăr pentru "unde
   suntem" într-un subflow Costuri & Profit:
   - mode: "NORMAL" | "PRICE_CALCULATOR" | "PHOTO_COSTING"
   - productId: produsul asociat calculatorului curent (sau null
     pentru calcul temporar);
   - costDraft: draftul curent de costuri (materiale, manoperă,
     ambalaj, profit dorit) - aceeași formă folosită de
     costProfitService.js pe backend;
   - photoDraft: { file, materials } - fișierul în analiză și,
     după confirmare, lista de materiale rezultată;
   - awaitingField: următorul mesaj text are un rol special
     (ex. "photo-associate-product-name" - vendorul răspunde la
     "cărui produs îi asociez acest calcul?"), NU trece prin
     detecția de intenție normală;
   - history: perechile {role, text} relevante pentru LLM-ul
     calculatorului (vezi sendPriceCalculatorTurn) - separat de
     `messages`, ca să nu poluăm promptul cu mesaje de meniu.
========================================================= */

const [
  conversationContext,
  setConversationContext,
] = useState(
  EMPTY_CONVERSATION_CONTEXT
);

/*
 * Urmărire ieftină a schimbărilor de subiect (vezi
 * computeTopicSuggestion în assistantCopilotRoutes.js) - separat de
 * conversationContext de mai sus (care are propria formă, specifică
 * fiecărui mod), ca să nu interferăm cu logica lui existentă.
 */
const [
  topicTracking,
  setTopicTracking,
] = useState({
  lastCategory: null,
  topicChangeStreak: 0,
});

/*
 * Rezultatul ultimei ture de calculator - randat inline, sub
 * ultimul mesaj asistent, exact ca pendingCostingAction mai jos.
 */
const [
  calculatorPricing,
  setCalculatorPricing,
] = useState(null);

const [
  calculatorBusy,
  setCalculatorBusy,
] = useState(false);

const [
  calculatorSaving,
  setCalculatorSaving,
] = useState(false);

const [
  calculatorSaveError,
  setCalculatorSaveError,
] = useState("");

const [
  calculatorCostingStatus,
  setCalculatorCostingStatus,
] = useState(null);

/*
 * Picker inline pentru "cărui produs îi asociez materialele
 * confirmate din fotografie?" - singura utilizare rămasă a
 * unui picker de căutare (dezambiguizarea de produse din
 * orchestrator are propriul mecanism, costingDisambiguation).
 */
const [
  photoAssociatePicker,
  setPhotoAssociatePicker,
] = useState(null);

const [
  photoAssociateSaving,
  setPhotoAssociateSaving,
] = useState(false);

const [
  photoAssociateError,
  setPhotoAssociateError,
] = useState("");

/* =========================================================
   Comenzi AI pentru Costuri & Profit (analiză, bibliotecă,
   recalculare, editare costing, apply price) - toate merg
   prin POST /api/ai/assistant/command.
========================================================= */

const [
  costingCommandBusy,
  setCostingCommandBusy,
] = useState(false);

const [
  costingCommandResults,
  setCostingCommandResults,
] = useState(null);

const [
  costingCommandResultsTotal,
  setCostingCommandResultsTotal,
] = useState(0);

const [
  costingDisambiguation,
  setCostingDisambiguation,
] = useState(null);

const [
  pendingCostingAction,
  setPendingCostingAction,
] = useState(null);

const [
  pendingCostingActionBusy,
  setPendingCostingActionBusy,
] = useState(false);

const [
  pendingCostingActionError,
  setPendingCostingActionError,
] = useState("");

const [
  lastCostingActionLink,
  setLastCostingActionLink,
] = useState(null);

/*
 * Preview mic (imagine/titlu/preț) al produsului identificat
 * într-un flow UPDATE_PRODUCT, arătat CÂT TIMP asistentul
 * așteaptă valoarea unui câmp (resultType "needs_field") - se
 * golește imediat ce apare pendingCostingAction (cardul de
 * confirmare arată deja titlul) sau când conversația iese din
 * modul PRODUCT_UPDATE.
 */
const [
  resolvedProductPreview,
  setResolvedProductPreview,
] = useState(null);

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
    conversationContext.mode ===
    "PRICE_CALCULATOR"
      ? "Descrie costurile sau răspunde la întrebare..."
      : conversationContext.mode ===
          "PHOTO_COSTING"
        ? conversationContext
            .awaitingField ===
          "photo-associate-product-name"
          ? "Numele produsului..."
          : "Scrie un mesaj..."
        : conversationContext.mode ===
            "PHOTO_PENDING"
          ? "Spune ce vrei să fac cu fotografia..."
          : conversationContext.mode ===
              "PRODUCT_UPDATE"
            ? conversationContext.awaitingField ===
              "product"
              ? "Numele produsului..."
              : "Scrie noua valoare..."
            : getVendorInputPlaceholder(
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
    pendingCostingAction,
    costingDisambiguation,
    costingCommandResults,
    conversationContext,
    calculatorPricing,
    photoAssociatePicker,
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

  /*
   * BUGFIX (audit): assistantProducts.js (folosit și de
   * AiAssistant.jsx) așteaptă un removeMessage(id) - șterge DOAR
   * mesajul cu id-ul dat, nu orice mesaj de tip loading aflat în
   * conversație (removeLoadingMessages e prea larg pentru asta,
   * ar putea șterge un loading concurent nelegat de search).
   */
  function removeMessage(id) {
    if (!id) return;

    setMessages(
      (current) =>
        current.filter(
          (message) =>
            String(message?.id || "") !== String(id)
        )
    );
  }

  /*
   * Golește DOAR uploadedImages (fișierele brute + preview-uri
   * locale, cu revocarea corectă a URL-urilor blob:), fără să
   * atingă productDraft.images - util după ce fotografia a fost
   * deja "consumată" într-o formă finală (ex. URL-uri reale
   * întoarse de analyzeVendorProduct), care nu mai trebuie golită.
   */
  function clearUploadedImagesOnly() {
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
  }

  function clearUploadedImages() {
    clearUploadedImagesOnly();

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

  /*
   * draftOverrides: câmpuri parțiale de precompletat peste
   * draftul curent (ex. venind din calculatorul de preț - preț
   * recomandat, materiale, imaginea folosită). VendorProductWizard
   * rămâne complet neatins - e deja controlat integral din afară
   * (draft/setDraft), deci "seed data" înseamnă pur și simplu
   * setProductDraft ÎNAINTE de a deschide wizard-ul. Dacă
   * draftOverrides lipsește, comportamentul e identic cu înainte.
   */
  function openAddProductWizard({
    resetDraft = false,
    draftOverrides = null,

    /*
     * Setat DOAR de handleCreateProductFromCalculator - orice
     * altă cale de deschidere a wizard-ului (meniu, "adaugă
     * produs" scris liber) trebuie să înceapă fără niciun
     * costing "de legat", chiar dacă a mai existat unul dintr-o
     * sesiune de calculator anterioară, abandonată.
     */
    costingLink = null,
  } = {}) {
    setActiveFlow(
      VENDOR_PRODUCT_FLOWS.ADD_PRODUCT
    );

    setShowMenu(false);
    setWizardPublishing(false);
    setWizardPublishError("");
    setWizardPublishSuccess(null);
    setPendingCostingLink(costingLink);

    if (draftOverrides) {
      setProductDraft(
        (current) => ({
          ...normalizeProductDraft(
            current
          ),

          ...draftOverrides,

          activeFlow:
            VENDOR_PRODUCT_FLOWS.ADD_PRODUCT,
        })
      );
    } else if (resetDraft) {
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
     Calculator de preț - INLINE în conversație

     Nu mai există un activeVendorView separat pentru calculator:
     intrarea în modul PRICE_CALCULATOR pornește o "tură sămânță"
     (mesaj gol, cu productId/costDraft deja cunoscute - exact ce
     făcea vechiul efect de mount din VendorPriceCalculator.jsx),
     doar că rezultatul se adaugă direct în `messages`-ul
     principal, nu într-un state local separat al unui component
     montat/demontat.
  ======================================================= */

  function applyPriceCalculatorTurnResult(
    result,
    fallbackProductId = null
  ) {
    addMessage(
      createMessage(
        "assistant",

        result?.message ||
          "Am notat informațiile despre costuri."
      )
    );

    const nextProductId =
      result?.productId ??
      fallbackProductId ??
      null;

    setConversationContext((current) => ({
      ...current,
      mode: "PRICE_CALCULATOR",
      productId: nextProductId,
      costDraft: result?.costDraft || null,
    }));

    setCalculatorPricing(
      result?.pricing || null
    );

    setCalculatorSaveError("");

    setLastCostingActionLink(
      nextProductId
        ? { productId: nextProductId }
        : null
    );

    /*
     * Sugestie de bibliotecă pentru materialul/costul nou sau
     * schimbat în această tură - reutilizează EXACT mecanismul
     * de pendingAction deja existent (nu mai există un state
     * separat "costItemSuggestion" ca în vechiul component
     * montat separat).
     */
    if (result?.costItemSuggestion) {
      processCostingCommandResult(
        result.costItemSuggestion
      );
    }
  }

  /*
   * sourceImageUrl: URL-ul (deja încărcat) al fotografiei din
   * care a pornit acest calcul, dacă există - vine din
   * PhotoCostingDraftEditor (vezi handlePhotoConfirmMaterials).
   * Se păstrează pe conversationContext peste toate turele
   * următoare (applyPriceCalculatorTurnResult face doar spread
   * pe `current`), ca butonul "Creează produsul în magazin" să
   * poată pre-completa imaginea, fără să reîncarce nimic.
   */
  function enterPriceCalculatorMode(
    targetProductId = null,
    seedCostDraft = null,
    sourceImageUrl = null
  ) {
    setActiveFlow(
      VENDOR_ACTION_IDS.PRICE_CALCULATOR
    );

    setShowMenu(false);
    setCalculatorPricing(null);
    setCalculatorSaveError("");
    setCalculatorCostingStatus(null);

    setConversationContext({
      mode: "PRICE_CALCULATOR",
      productId: targetProductId,
      costDraft: seedCostDraft,
      photoDraft: null,
      awaitingField: null,
      history: [],
      sourceImageUrl,
    });

    runPriceCalculatorSeedTurn(
      targetProductId,
      seedCostDraft
    );
  }

  async function runPriceCalculatorSeedTurn(
    targetProductId,
    seedCostDraft
  ) {
    setCalculatorBusy(true);

    try {
      const result = await sendPriceCalculatorTurn({
        message: "",
        history: [],
        costDraft: seedCostDraft,
        productId: targetProductId,
      });

      applyPriceCalculatorTurnResult(
        result,
        targetProductId
      );
    } catch (err) {
      addMessage(
        createMessage(
          "assistant",

          err instanceof Error
            ? err.message
            : "Nu am putut încărca calculatorul de preț."
        )
      );
    } finally {
      setCalculatorBusy(false);
    }
  }

  async function runPriceCalculatorTurn(text) {
    setCalculatorBusy(true);

    try {
      const result = await sendPriceCalculatorTurn({
        message: text,
        history: conversationContext.history,
        costDraft: conversationContext.costDraft,
        productId: conversationContext.productId,
      });

      setConversationContext((current) => ({
        ...current,

        history: [
          ...current.history,
          { role: "user", text },

          {
            role: "assistant",
            text: result?.message || "",
          },
        ].slice(-10),
      }));

      applyPriceCalculatorTurnResult(result);
    } catch (err) {
      addMessage(
        createMessage(
          "assistant",

          err instanceof Error
            ? err.message
            : "A apărut o eroare la calculul prețului."
        )
      );
    } finally {
      setCalculatorBusy(false);
    }
  }

  /*
   * Interceptare comenzi globale de business scrise CÂT
   * conversația e în modul PRICE_CALCULATOR (vezi
   * GLOBAL_COMMAND_HINT_PATTERN - apelată doar dacă textul
   * conține deja un indiciu clar de comandă globală, nu la
   * fiecare mesaj).
   *
   * Spre deosebire de varianta anterioară, NU mai resetăm modul/
   * draftul după ce o comandă globală e rezolvată -
   * conversationContext.mode rămâne PRICE_CALCULATOR,
   * pendingAction-ul/rezultatul apare ca o paranteză inline, iar
   * vendorul poate continua exact de unde a rămas cu calculul.
   * Ieșirea din calculator e ÎNTOTDEAUNA explicită (vezi
   * isExitSubflowMessage).
   */
  async function tryHandleGlobalCommandFromCalculator(
    text
  ) {
    try {
      const result = await sendAssistantCommand({
        message: text,
        history: conversationContext.history,
      });

      if (
        !GLOBAL_COSTING_COMMAND_TYPES.has(
          result?.commandType
        )
      ) {
        return false;
      }

      /*
       * Caz special: UPDATE_PRODUCT_COSTING fără nume de produs
       * (ex. "lucrez 2 ore, tariful meu e 40 lei" - regulă deja
       * existentă în promptul orchestratorului pentru tarif orar
       * fără produs asociat) nu produce nimic de preluat, doar
       * întrebarea "pentru ce produs?" - aproape sigur vendorul
       * tocmai răspundea la întrebarea calculatorului însuși
       * despre manoperă/tarif. NU interceptăm în acest caz.
       */
      if (
        result?.commandType ===
          "UPDATE_PRODUCT_COSTING" &&
        result?.resultType === "answer"
      ) {
        return false;
      }

      processCostingCommandResult(result);

      return true;
    } catch {
      return false;
    }
  }

  /*
   * Ieșire explicită dintr-un subflow (PRICE_CALCULATOR sau
   * PHOTO_COSTING) - readuce conversația în modul NORMAL, fără
   * să reseteze `messages` (mesajele anterioare rămân vizibile).
   */
  function exitToNormalMode(message = null) {
    setConversationContext(
      EMPTY_CONVERSATION_CONTEXT
    );

    setCalculatorPricing(null);
    setCalculatorBusy(false);
    setCalculatorSaveError("");
    setCalculatorCostingStatus(null);
    setLastCostingActionLink(null);
    setPhotoAssociatePicker(null);
    setPhotoAssociateSaving(false);
    setPhotoAssociateError("");

    if (message) {
      addMessage(
        createMessage("assistant", message)
      );
    }
  }

  /*
   * BUGFIX (raportat manual): "Cum funcționează produsul zilei?"
   * cât timp calculatorul era activ ajungea la orchestratorul VECHI
   * (Costuri & Profit) doar pentru că textul conține "produsul " -
   * GLOBAL_COMMAND_HINT_PATTERN e un gate determinist, NU știe
   * diferența dintre o comandă de business și o întrebare generală
   * despre platformă. Orchestratorul vechi n-are NICIO cunoștință
   * despre produsul zilei/artizanul săptămânii/alte funcționalități
   * ale platformei (doar Costuri & Profit) - forța mesajul într-un
   * commandType de-al lui (READ_PROFITABILITY), afișând o listă de
   * produse fără nicio legătură cu întrebarea.
   *
   * Fix-ul NU e o regulă nouă hardcodată pe "produsul zilei" - e
   * exact ce cerea raportul: reutilizăm copilotul general
   * (routeCopilotMessage/classifyCopilotMessage), care ȘTIE DEJA
   * să distingă PLATFORM_KNOWLEDGE ("cum funcționează X") de
   * EXISTING_FLOW (interogări de date proprii) pentru ORICE
   * funcționalitate a platformei, nu doar homepage-features -
   * verificat cu teste directe pe endpoint-ul HTTP real. Verificăm
   * ÎNTÂI dacă e o întrebare de cunoștințe generale; DOAR dacă nu e,
   * cădem pe orchestratorul vechi, exact ca înainte.
   */
  async function tryHandlePlatformKnowledgeFromCalculator(
    text
  ) {
    try {
      const copilotResult = await sendCopilotAsk({
        message: text,
        history,

        currentPage: effectivePage,
        currentEntity: resolvedCurrentEntity,

        /*
         * NU trimitem conversationContext-ul calculatorului - ăsta
         * e un flow paralel (vezi comentariul de la
         * GLOBAL_COSTING_COMMAND_TYPES: modul PRICE_CALCULATOR
         * rămâne activ, întrebarea e doar o paranteză).
         */
        conversationContext: null,
      });

      if (
        copilotResult?.handled &&
        copilotResult?.category === "PLATFORM_KNOWLEDGE"
      ) {
        processCostingCommandResult(copilotResult);
        return true;
      }
    } catch {
      /*
       * Copilotul e un strat ADIȚIONAL - dacă eșuează, cădem pe
       * fluxul vechi, neschimbat.
       */
    }

    return false;
  }

  /*
   * Rutare pentru un mesaj text scris CÂT conversația e în
   * modul PRICE_CALCULATOR - apelată din handleSubmit.
   */
  async function handlePriceCalculatorTurn(text) {
    if (isExitSubflowMessage(text)) {
      exitToNormalMode(
        "Am ieșit din calculator. Cu ce altceva te pot ajuta?"
      );

      return;
    }

    if (GLOBAL_COMMAND_HINT_PATTERN.test(text)) {
      const isKnowledgeQuestion =
        await tryHandlePlatformKnowledgeFromCalculator(
          text
        );

      if (isKnowledgeQuestion) {
        return;
      }

      const handled =
        await tryHandleGlobalCommandFromCalculator(
          text
        );

      if (handled) {
        return;
      }
    }

    await runPriceCalculatorTurn(text);
  }

  async function handleSaveCalculatorCosting() {
    const { productId, costDraft } =
      conversationContext;

    if (
      !productId ||
      !costDraft ||
      calculatorSaving
    ) {
      return;
    }

    setCalculatorSaving(true);
    setCalculatorSaveError("");

    try {
      const saved = await savePersistedProductCosting(
        productId,
        costDraft
      );

      setCalculatorCostingStatus(
        saved?.status || "DRAFT"
      );

      addMessage(
        createMessage(
          "assistant",

          "Am salvat costing-ul produsului ca ciornă. Îl poți confirma din pagina produsului când ești sigur pe cifre."
        )
      );
    } catch (err) {
      setCalculatorSaveError(
        err instanceof Error
          ? err.message
          : "Nu am putut salva costing-ul."
      );
    } finally {
      setCalculatorSaving(false);
    }
  }

  /*
   * "Creează produsul în magazin" - deschide wizard-ul EXISTENT
   * de adăugare (VendorProductWizard, nemodificat), precompletat
   * cu tot ce știm deja din calculator: imaginea folosită,
   * materialele confirmate (ca materialMain) și prețul recomandat
   * ca preț propus. NU creează nimic în DB și NU publică - doar
   * pregătește draftul; vendorul confirmă/modifică/salvează prin
   * flow-ul normal, neschimbat, al wizard-ului (inclusiv pasul
   * "Analizează" din wizard, dacă vrea titlu/categorie/descriere
   * sugerate de AI - nu inventăm noi aceste câmpuri aici, fiindcă
   * analiza de costing nu le produce).
   */
  function handleCreateProductFromCalculator() {
    const { costDraft, sourceImageUrl } =
      conversationContext;

    if (!costDraft || !calculatorPricing) {
      return;
    }

    const materialNames = Array.isArray(
      costDraft.materials
    )
      ? costDraft.materials
          .map((material) => material?.name)
          .filter(Boolean)
      : [];

    const recommendedPriceLei = Number(
      calculatorPricing.recommendedPrice
    );

    const existingImages = Array.isArray(
      productDraft?.images
    )
      ? productDraft.images
      : [];

    /*
     * Normalizăm imaginea seed-uită în EXACT aceeași structură
     * pe care VendorProductWizard o folosește după un upload
     * normal urmat de "Analizează cu AI" - {id, url, previewUrl,
     * filename} (URL deja public, nu un string simplu). Setăm
     * ambele state-uri, uploadedImages ȘI productDraft.images,
     * exact cum face handleImageChange la un upload normal - nu
     * doar unul din ele, ca "Analizează cu AI" din wizard să
     * găsească fotografia (vezi handleAnalyzeProduct, care
     * citește din productDraft.images) și ca numărătoarea de
     * "locuri rămase" pentru poze noi să rămână corectă.
     */
    const seededImages =
      existingImages.length > 0
        ? existingImages
        : sourceImageUrl
          ? [
              {
                id: `costing-${Date.now()}`,
                url: sourceImageUrl,
                previewUrl: sourceImageUrl,
                filename: "Fotografie produs",
              },
            ]
          : existingImages;

    addMessage(
      createMessage(
        "assistant",

        "Am pregătit wizard-ul de adăugare cu prețul recomandat, materialele și fotografia folosite la calcul. Poți modifica orice înainte să salvezi - nimic nu se publică automat."
      )
    );

    setUploadedImages(seededImages);

    openAddProductWizard({
      draftOverrides: {
        images: seededImages,

        price: Number.isFinite(
          recommendedPriceLei
        )
          ? String(
              Math.round(
                recommendedPriceLei * 100
              ) / 100
            )
          : productDraft?.price || "",

        materialMain:
          productDraft?.materialMain ||
          materialNames.join(", "),
      },

      /*
       * Capturăm costDraft/pricing ACUM, la momentul exact al
       * handoff-ului - nu mai depindem de conversationContext
       * rămânând neschimbat până la "Salvează produsul".
       */
      costingLink: {
        costDraft,
        pricing: calculatorPricing,
      },
    });
  }

  /* =======================================================
     Analiză foto - INLINE în conversație

     User încarcă poză -> mesaj "Analizez fotografia" -> card
     editabil de componente (PhotoCostingDraftEditor, reutilizat
     ca atare, fără nicio duplicare de logică de analiză/matching)
     -> Confirmă -> alegere inline "calcul temporar" / "asociază
     cu un produs existent" -> conversația continuă normal, în
     același `messages`.
  ======================================================= */

  /*
   * Imediat DUPĂ upload, fără alt context - conversationContext
   * trece în PHOTO_PENDING (nu un activeVendorView separat) și
   * arătăm un card de alegere INLINE, ca mesaj cu `choices`
   * (mecanismul deja existent din AssistantMessage.jsx, reutilizat
   * ca atare - vezi handleChoice mai jos, unde interceptăm click-ul
   * pe baza marker-ului photoPendingChoice de pe mesaj).
   *
   * uploadedImages NU se golește aici - rămâne populat până la
   * Renunță, până la o alegere care consumă poza explicit, sau
   * până la un upload nou (care oricum re-declanșează exact acest
   * flux, înlocuind implicit contextul).
   */
  function enterPhotoPendingMode(totalImages) {
    setShowMenu(false);

    setConversationContext((current) => ({
      ...current,
      mode: "PHOTO_PENDING",
      photoDraft: null,
      awaitingField: null,
    }));

    addMessage(
      createMessage(
        "assistant",

        totalImages === 1
          ? "Am primit fotografia. Ce vrei să fac cu ea?"
          : `Am primit ${totalImages} fotografii. Ce vrei să fac cu ele?`,

        {
          photoPendingChoice: true,
          choices: PHOTO_PENDING_CHOICES,
        }
      )
    );
  }

  function handleCancelPhotoPending() {
    clearUploadedImages();

    setConversationContext(
      EMPTY_CONVERSATION_CONTEXT
    );

    addMessage(
      createMessage(
        "assistant",

        "Am renunțat la fotografie. Cu ce altceva te pot ajuta?"
      )
    );
  }

  /*
   * "Analizează produsul" - reutilizează STRICT serviciul AI
   * existent (analyzeVendorProduct, folosit și de wizard-ul de
   * adăugare produs), dar NU schimbă activeVendorView - rezultatul
   * apare direct ca mesaj în conversație. Actualizăm și
   * productDraft cu subsetul relevant (titlu/descriere/categorie/
   * material/tehnică/culoare), ca "Adaugă produs nou" să pornească
   * deja pre-completat dacă vendorul alege asta după.
   */
  async function handleAnalyzeUploadedPhotoInline() {
    if (!uploadedImages.length) {
      addMessage(
        createMessage(
          "assistant",
          "Nu mai am nicio fotografie de analizat."
        )
      );

      return;
    }

    addMessage(
      createMessage(
        "assistant",
        "Analizez fotografia..."
      )
    );

    setIsSubmitting(true);

    try {
      const { analysis, imageUrls } =
        await analyzeVendorProduct({
          images: uploadedImages,
        });

      const summaryLines = [
        analysis?.title &&
          `Titlu sugerat: ${analysis.title}`,

        analysis?.category &&
          `Categorie: ${analysis.category}`,

        analysis?.materialMain &&
          `Material principal: ${analysis.materialMain}`,

        analysis?.technique &&
          `Tehnică: ${analysis.technique}`,

        analysis?.color &&
          `Culoare: ${analysis.color}`,

        Array.isArray(analysis?.styleTags) &&
          analysis.styleTags.length > 0 &&
          `Stil: ${analysis.styleTags.join(", ")}`,

        analysis?.description &&
          `Descriere: ${analysis.description}`,
      ].filter(Boolean);

      addMessage(
        createMessage(
          "assistant",

          summaryLines.length
            ? summaryLines.join("\n")
            : "Nu am reușit să identific detalii clare din fotografie.",

          {
            photoPendingChoice: true,

            choices: [
              "Adaugă produs nou",
              "Renunță",
            ],
          }
        )
      );

      setProductDraft((current) => ({
        ...normalizeProductDraft(current),

        images:
          Array.isArray(imageUrls) &&
          imageUrls.length
            ? imageUrls
            : current.images,

        title:
          analysis?.title || current.title,

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
          analysis?.color || current.color,

        aiAnalysis: analysis,

        aiQuestions: Array.isArray(
          analysis?.questions
        )
          ? analysis.questions
          : [],

        aiConfidence:
          analysis?.confidence ?? null,
      }));

      /*
       * Analiza s-a încheiat (flow finalizat) - golim
       * uploadedImages (blob-urile locale nu mai sunt necesare,
       * productDraft.images are deja URL-urile reale întoarse de
       * analiză), ca un mesaj ulterior nelegat de fotografie să
       * nu mai fie interceptat de ramura "poză încărcată" din
       * handleSubmit.
       */
      clearUploadedImagesOnly();

      setConversationContext(
        EMPTY_CONVERSATION_CONTEXT
      );
    } catch (err) {
      addMessage(
        createMessage(
          "assistant",

          err instanceof Error
            ? err.message
            : "Nu am putut analiza fotografia."
        )
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  /*
   * Dispecerul central pentru PHOTO_PENDING - apelat identic
   * dintr-un click pe card (handleChoice) SAU dintr-un mesaj
   * liber interpretat determinist (detectPhotoPendingChoice, vezi
   * handleSubmit) - același rezultat indiferent de cale.
   */
  async function handlePhotoPendingChoice(
    choiceLabel
  ) {
    switch (choiceLabel) {
      case "Calculează prețul":
        enterPhotoCostingMode();
        return;

      case "Analizează produsul":
        await handleAnalyzeUploadedPhotoInline();
        return;

      /*
       * BUGFIX (audit): "poză + caută produse asemănătoare" trebuie
       * să folosească marketplace image search-ul USER-ului (secț.
       * 2/5 din audit), NU să pornească implicit vendor costing.
       * Aceeași funcție runImageSearchFlow ca AiAssistant.jsx.
       */
      case "Caută produse asemănătoare": {
        const stagedFile =
          uploadedImages[0]?.file || null;

        clearUploadedImages();

        setConversationContext(
          EMPTY_CONVERSATION_CONTEXT
        );

        setActiveFlow("image-search");

        if (!stagedFile) {
          addMessage(
            createMessage(
              "assistant",
              "Nu mai am fotografia - încarcă-o din nou, te rog."
            )
          );

          return;
        }

        await runImageSearchFlow({
          file: stagedFile,
          addMessage,
          removeMessage,
          createMessage,
          setVisualSearchId,
        });

        return;
      }

      case "Folosește pentru un produs existent":
        enterPhotoCostingMode({
          intent: "associate",
        });
        return;

      case "Adaugă produs nou":
        addMessage(
          createMessage(
            "assistant",
            "Sigur. Te ajut să adaugi produsul pas cu pas."
          )
        );

        openAddProductWizard();
        return;

      case "Renunță":
        handleCancelPhotoPending();
        return;

      default:
        return;
    }
  }

  /*
   * intent: "associate" - vendorul a spus deja explicit că vrea
   * să folosească fotografia pentru un produs existent (vezi
   * "Folosește pentru un produs existent" din PHOTO_PENDING) -
   * sărim peste întrebarea "calcul temporar sau asociere?" și
   * cerem direct numele produsului, imediat ce componentele sunt
   * confirmate (vezi handlePhotoConfirmMaterials).
   */
  function enterPhotoCostingMode({
    intent = null,
  } = {}) {
    const stagedFile =
      uploadedImages[0]?.file || null;

    /*
     * Preluăm fișierul înainte de a curăța starea de upload -
     * clearUploadedImages() doar revocă previewUrl-urile
     * (blob:), fișierul brut rămâne valid și poate fi folosit
     * mai departe de editor.
     */
    clearUploadedImages();

    setActiveFlow(
      VENDOR_ACTION_IDS.PRICE_CALCULATOR
    );

    setShowMenu(false);
    setPhotoAssociateError("");
    setPhotoAssociatePicker(null);

    setConversationContext({
      mode: "PHOTO_COSTING",
      productId: null,
      costDraft: null,

      photoDraft: {
        file: stagedFile,
        materials: null,
        intent,
      },

      awaitingField: null,
      history: [],
    });

    addMessage(
      createMessage(
        "assistant",
        "Analizez fotografia..."
      )
    );
  }

  /*
   * Materialele confirmate din editorul foto pot conține
   * denumiri noi (fără costItemId, deci nepotrivite încă din
   * analiza vizuală cu biblioteca) - le verificăm determinist
   * față de bibliotecă (vezi detectCostItemsFromMaterials) și,
   * dacă apare o sugestie, o afișăm ca pendingAction chiar aici,
   * înainte de asociere/calcul temporar.
   *
   * imageUrl (al doilea argument, opțional) - URL-ul deja
   * încărcat al fotografiei analizate, întors de
   * PhotoCostingDraftEditor (vezi acolo). Îl păstrăm pe
   * conversationContext.sourceImageUrl, ca "Creează produsul în
   * magazin" din calculator să poată pre-completa imaginea fără
   * să reîncarce nimic.
   */
  async function handlePhotoConfirmMaterials(
    materials,
    imageUrl = null
  ) {
    const intent =
      conversationContext.photoDraft?.intent ||
      null;

    setConversationContext((current) => ({
      ...current,

      photoDraft: {
        ...(current.photoDraft || {}),
        materials,
      },

      sourceImageUrl:
        imageUrl || current.sourceImageUrl,
    }));

    if (intent === "associate") {
      /*
       * Vendorul a ales deja "Folosește pentru un produs
       * existent" - nu mai întrebăm încă o dată, cerem direct
       * numele produsului.
       */
      handleAskAssociateProduct();
    } else {
      addMessage(
        createMessage(
          "assistant",

          "Vrei calcul temporar sau să asociez acest calcul cu un produs existent?"
        )
      );
    }

    try {
      const suggestion =
        await detectCostItemsFromMaterials(
          materials
        );

      if (suggestion) {
        processCostingCommandResult(suggestion);
      }
    } catch {
      // Detectarea e un bonus, nu blocăm fluxul foto dacă eșuează.
    }
  }

  function handleTemporaryPhotoCalc() {
    const materials =
      conversationContext.photoDraft
        ?.materials || [];

    const sourceImageUrl =
      conversationContext.sourceImageUrl ||
      null;

    addMessage(
      createMessage(
        "assistant",

        "Calculez temporar, fără să salvez nimic."
      )
    );

    enterPriceCalculatorMode(
      null,
      {
        materials,
        packagingCost: 0,
        packagingCostItemId: null,
        otherCosts: [],
        laborHours: null,
        hourlyRate: null,
        desiredProfit: null,
      },
      sourceImageUrl
    );
  }

  function handleAskAssociateProduct() {
    setConversationContext((current) => ({
      ...current,

      awaitingField:
        "photo-associate-product-name",
    }));

    addMessage(
      createMessage(
        "assistant",

        "Scrie numele produsului căruia vrei să-i asociez acest calcul."
      )
    );
  }

  /*
   * NU setează photoAssociatePicker pentru cazul de succes -
   * apelantul decide (0 rezultate -> mesaj; 1 rezultat -> asociere
   * directă, fără picker; mai multe -> abia atunci arată picker-ul),
   * ca să nu apară un fulger de picker cu 1 rezultat chiar înainte
   * să fie curățat.
   */
  async function runPhotoAssociateProductSearch(
    query
  ) {
    setPhotoAssociatePicker({
      results: [],
      loading: true,
      error: "",
    });

    try {
      const results = await searchVendorProducts(
        query
      );

      return results;
    } catch (err) {
      setPhotoAssociatePicker({
        results: [],
        loading: false,

        error:
          err instanceof Error
            ? err.message
            : "Căutarea produselor a eșuat.",
      });

      return [];
    }
  }

  function handlePhotoAssociatePickerSelect(
    product
  ) {
    associatePhotoMaterialsWithProduct(
      product.productId,
      product.title
    );
  }

  async function associatePhotoMaterialsWithProduct(
    targetProductId,
    title
  ) {
    setPhotoAssociatePicker(null);
    setPhotoAssociateSaving(true);
    setPhotoAssociateError("");

    try {
      const existingCosting =
        await fetchPersistedProductCosting(
          targetProductId
        );

      const baseDraft =
        costingToCostDraftShape(
          existingCosting
        );

      const finalDraft = {
        ...baseDraft,

        materials:
          conversationContext.photoDraft
            ?.materials || [],
      };

      await savePersistedProductCosting(
        targetProductId,
        finalDraft
      );

      addMessage(
        createMessage(
          "assistant",

          `Am salvat materialele identificate din fotografie la produsul „${title}”.`
        )
      );

      enterPriceCalculatorMode(
        targetProductId
      );
    } catch (err) {
      setPhotoAssociateError(
        err instanceof Error
          ? err.message
          : "Nu am putut salva componentele pe acest produs."
      );
    } finally {
      setPhotoAssociateSaving(false);
    }
  }

  /* =======================================================
     Comenzi AI pentru Costuri & Profit

     LLM-ul din /api/ai/assistant/command doar clasifică și
     extrage - niciodată nu scrie în DB. Rezultatul e fie un
     răspuns direct (read-only), fie o dezambiguizare, fie un
     pendingAction care așteaptă confirmare explicită aici,
     în chat, înainte să apelăm endpoint-urile determinist
     existente (PATCH cost-items, PUT costing, recalculate,
     apply-recommended-price).
  ======================================================= */

  function clearCostingCommandUiState() {
    setCostingCommandResults(null);
    setCostingCommandResultsTotal(0);
    setCostingDisambiguation(null);
  }

  function processCostingCommandResult(result) {
    clearCostingCommandUiState();

    addMessage(
      createMessage(
        "assistant",

        result?.message ||
          "Am procesat cererea."
      )
    );

    /*
     * Prezent DOAR pe rezultate venite din copilot (/copilot/ask) -
     * orchestratorul vechi de costing nu are aceste câmpuri, deci
     * pur și simplu nu intră pe ramurile de mai jos pentru el.
     */
    if (
      "lastCategory" in result ||
      "topicChangeStreak" in result
    ) {
      setTopicTracking({
        lastCategory:
          result.lastCategory ?? null,
        topicChangeStreak:
          result.topicChangeStreak ?? 0,
      });
    }

    if (result?.suggestTopicReset) {
      addMessage(
        createMessage(
          "assistant",

          "Vrei să începem un subiect nou?",

          {
            type: "choices",
            choiceStep: "topic-suggestion",
            choices: [
              "Subiect nou",
              "Nu, continuă",
            ],
          }
        )
      );
    }

    /*
     * FAZA 8-10: sincronizează triajul de suport (clarificare sau
     * confirmare de ticket în curs) - prezent DOAR pe rezultate
     * din SUPPORT_TROUBLESHOOT (obiect sau explicit null pentru
     * resetare); pe orice alt rezultat (PLATFORM_KNOWLEDGE/
     * PLATFORM_ACTION/needs_product/etc.) cheia lipsește complet,
     * deci nu atingem starea de suport.
     */
    if ("supportContext" in result) {
      setConversationContext((current) => ({
        ...current,

        activeIntent:
          result.supportContext?.activeIntent ||
          null,

        currentFlow:
          result.supportContext?.currentFlow ||
          null,

        collectedParams:
          result.supportContext?.collectedParams ||
          null,
      }));
    }

    /*
     * PROACTIVE COPILOT: la fel, sincronizează insight-ul activ
     * (dacă vânzătorul a primit un rezumat/insight și răspunsul
     * curent tot mai are unul relevant de urmărit) - prezent DOAR
     * pe rezultate din VENDOR_INSIGHTS, obiect sau explicit null.
     */
    if ("insightContext" in result) {
      setConversationContext((current) => ({
        ...current,
        activeInsight: result.insightContext || null,
      }));
    }

    /*
     * HARDENING: vendorul a ieșit determinist dintr-un flow de
     * colectare de câmp ("de fapt lasă, anulează") - resetăm EXACT
     * ca la un UPDATE_PRODUCT reușit, ca să nu rămână "blocat" pe
     * flow-ul vechi (vezi copilotRouter.js: detectCancelIntent).
     */
    if (result?.cancelled) {
      setConversationContext((current) => ({
        ...current,
        mode: "NORMAL",
        productId: null,
        awaitingField: null,
        productUpdateDraft: null,
      }));

      setResolvedProductPreview(null);
    }

    /*
     * Userul a TASTAT "da" (nu a apăsat butonul Confirmă) la
     * întrebarea de trimitere a ticketului - executăm direct,
     * fără să mai afișăm cardul și să așteptăm alt click.
     */
    if (
      result?.autoConfirm &&
      result?.pendingAction?.kind ===
        "CREATE_SUPPORT_TICKET"
    ) {
      handleConfirmPendingCostingAction(
        {},
        result.pendingAction
      );

      return;
    }

    /*
     * Lipsește chiar PRODUSUL (ex: "Vreau să modific prețul unui
     * produs" fără nume, sau numele dat n-a găsit niciun match) -
     * păstrăm awaitingField:"product" + patch-ul deja extras
     * (productUpdateDraft) în conversationContext, ca mesajul
     * URMĂTOR (numele produsului) să fie interpretat DETERMINIST
     * ca nume de căutare, NU trimis ca mesaj independent la LLM
     * (asta cauza bug-ul cu liste de produse nerelevante).
     */
    if (result?.resultType === "needs_product") {
      setResolvedProductPreview(null);

      setConversationContext((current) => ({
        ...current,
        mode: "PRODUCT_UPDATE",
        productId: null,
        awaitingField: "product",

        productUpdateDraft: {
          patch: result.productUpdate || null,

          missingField:
            result.missingUpdateField || null,
        },
      }));

      return;
    }

    /*
     * Produsul e deja identificat, dar lipsește o valoare pentru
     * câmpul cerut (ex: "care e noul preț?") - păstrăm productId +
     * awaitingField în conversationContext, ca mesajul URMĂTOR
     * să fie trimis cu pendingContext, fără să reluăm căutarea
     * produsului sau clasificarea de la zero.
     */
    if (result?.resultType === "needs_field") {
      setResolvedProductPreview(
        result.productPreview || null
      );

      setConversationContext((current) => ({
        ...current,
        mode: "PRODUCT_UPDATE",
        productId: result.productId || null,
        awaitingField: result.field || null,
        productUpdateDraft: null,
      }));

      return;
    }

    if (
      conversationContext.mode === "PRODUCT_UPDATE"
    ) {
      setResolvedProductPreview(null);

      setConversationContext((current) => ({
        ...current,
        mode: "NORMAL",
        productId: null,
        awaitingField: null,
        productUpdateDraft: null,
      }));
    }

    if (result?.resultType === "results_list") {
      setCostingCommandResults(
        result.results || []
      );

      setCostingCommandResultsTotal(
        result.totalResults || 0
      );

      return;
    }

    if (result?.resultType === "disambiguation") {
      setCostingDisambiguation(
        result.disambiguation
      );

      return;
    }

    if (result?.resultType === "pending_action") {
      setPendingCostingAction(
        result.pendingAction
      );

      setPendingCostingActionError("");

      return;
    }

    if (result?.resultType === "open_calculator") {
      enterPriceCalculatorMode(
        result.productId || null
      );
    }
  }

  async function handleCostingAssistantCommand(
    text
  ) {
    setCostingCommandBusy(true);
    clearCostingCommandUiState();

    try {
      /*
       * Două variante de clarificare UPDATE_PRODUCT active - fie
       * lipsește chiar produsul (awaitingField === "product",
       * mesajul curent e chiar numele de căutat), fie produsul e
       * deja identificat și lipsește doar valoarea unui câmp.
       * Ambele ocolesc reclasificarea completă de la zero pe
       * server (vezi ruta /assistant/command).
       */
      const pendingContext =
        conversationContext.mode ===
          "PRODUCT_UPDATE" &&
        conversationContext.awaitingField ===
          "product"
          ? {
              commandType: "UPDATE_PRODUCT",
              awaitingField: "product",

              missingUpdateField:
                conversationContext
                  .productUpdateDraft
                  ?.missingField || null,

              productUpdate:
                conversationContext
                  .productUpdateDraft?.patch ||
                null,
            }
          : conversationContext.mode ===
                "PRODUCT_UPDATE" &&
              conversationContext.productId &&
              conversationContext.awaitingField
            ? {
                commandType: "UPDATE_PRODUCT",
                productId:
                  conversationContext.productId,
                missingField:
                  conversationContext.awaitingField,
              }
            : null;

      const result = await sendAssistantCommand({
        message: text,
        history,
        pendingContext,
      });

      processCostingCommandResult(result);
    } catch (err) {
      addMessage(
        createMessage(
          "assistant",

          err instanceof Error
            ? err.message
            : "Nu am putut procesa cererea."
        )
      );
    } finally {
      setCostingCommandBusy(false);
    }
  }

  /*
   * Proiecție PURĂ (nu stare nouă duplicată) a conversationContext
   * existent în forma generică cerută de copilotRouter.js (FAZA
   * 6-10): { activeAction, entityType, entityId, awaitingField,
   * collectedParams } PENTRU acțiuni înregistrate (UPDATE_PRODUCT
   * etc.), SAU { activeIntent: "SUPPORT_TROUBLESHOOT", currentFlow,
   * collectedParams } pentru un triaj de suport în curs - cele
   * două sunt fluxuri paralele, niciodată active simultan. Derivată
   * din starea deja existentă, ca să nu ținem două surse de adevăr.
   */
  function toGenericConversationContext() {
    if (conversationContext.mode === "PRODUCT_UPDATE") {
      return {
        activeAction: "UPDATE_PRODUCT",
        entityType: "product",
        entityId: conversationContext.productId || null,
        awaitingField: conversationContext.awaitingField || null,

        collectedParams: {
          missingUpdateField:
            conversationContext.productUpdateDraft
              ?.missingField || null,

          productUpdate:
            conversationContext.productUpdateDraft
              ?.patch || null,
        },
      };
    }

    if (
      conversationContext.activeIntent ===
      "SUPPORT_TROUBLESHOOT"
    ) {
      return {
        activeIntent: "SUPPORT_TROUBLESHOOT",
        currentFlow: conversationContext.currentFlow,

        collectedParams:
          conversationContext.collectedParams || {},
      };
    }

    if (conversationContext.activeInsight) {
      return {
        activeInsight: conversationContext.activeInsight,
      };
    }

    return null;
  }

  /*
   * FAZA 5: orice mesaj liber trece ÎNTÂI prin copilot router,
   * CU EXCEPȚIA unui subflow activ (verificat ÎNAINTE de acest
   * apel, în handleSubmit - PRICE_CALCULATOR/PHOTO_* nici nu ajung
   * aici). Dacă suntem deja în mijlocul unei clarificări
   * PRODUCT_UPDATE (FAZA 7 - contextul activ are prioritate),
   * SĂRIM peste copilot și continuăm direct cu mecanismul existent
   * de clarificare (handleCostingAssistantCommand îl are deja).
   *
   * Dacă copilotul răspunde handled:true, rezultatul e deja în
   * ACEEAȘI formă (resultType/pendingAction/etc.) pe care
   * processCostingCommandResult știe s-o proceseze - reutilizăm
   * acel cod, nu inventăm o cale de afișare separată.
   *
   * Dacă handled:false SAU copilotul eșuează (rețea/server), ne
   * întoarcem EXACT la fluxul vechi, neschimbat - nicio regresie.
   */
  async function handleCopilotThenCostingCommand(text) {
    if (conversationContext.mode === "PRODUCT_UPDATE") {
      return handleCostingAssistantCommand(text);
    }

    try {
      const copilotResult = await sendCopilotAsk({
        message: text,
        history,

        currentPage: effectivePage,
        currentEntity: resolvedCurrentEntity,

        conversationContext: {
          ...(toGenericConversationContext() ||
            {}),
          lastCategory:
            topicTracking.lastCategory,
          topicChangeStreak:
            topicTracking.topicChangeStreak,
        },
      });

      if (copilotResult?.handled) {
        processCostingCommandResult(copilotResult);
        return;
      }
    } catch {
      /*
       * Copilotul e un strat ADIȚIONAL - dacă eșuează, nu blocăm
       * conversația, continuăm cu fluxul existent, neschimbat.
       */
    }

    return handleCostingAssistantCommand(text);
  }

  async function handleCostingDisambiguationSelect(
    kind,
    id
  ) {
    if (!costingDisambiguation) return;

    const disambig = costingDisambiguation;

    setCostingCommandBusy(true);
    setCostingDisambiguation(null);

    try {
      const result = await resolveAssistantCommand(
        {
          commandType: disambig.commandType,
          productId:
            kind === "product" ? id : undefined,
          costItemId:
            kind === "cost_item"
              ? id
              : undefined,
          params: disambig.params,
        }
      );

      processCostingCommandResult(result);
    } catch (err) {
      addMessage(
        createMessage(
          "assistant",

          err instanceof Error
            ? err.message
            : "Nu am putut continua."
        )
      );
    } finally {
      setCostingCommandBusy(false);
    }
  }

  async function handleConfirmPendingCostingAction(
    extra = {},
    overrideAction = null
  ) {
    /*
     * overrideAction: FAZA 8-10 - dacă userul a TASTAT "da" în loc
     * să apese butonul Confirmă (vezi result.autoConfirm în
     * processCostingCommandResult), acțiunea încă nu e în state
     * (setPendingCostingAction e async) - o primim direct.
     */
    const action = overrideAction || pendingCostingAction;

    if (!action) return;

    setPendingCostingActionBusy(true);
    setPendingCostingActionError("");
    setLastCostingActionLink(null);

    try {
      if (
        action.kind ===
        "START_CALCULATOR_FOR_PRODUCT"
      ) {
        setPendingCostingAction(null);

        enterPriceCalculatorMode(
          action.productId
        );

        return;
      }

      if (action.kind === "UPDATE_COST_ITEM") {
        await updateCostItem(
          action.costItemId,
          {
            unitCostCents:
              action.after.unitCostCents,
          }
        );

        addMessage(
          createMessage(
            "assistant",

            `Am actualizat costul: ${action.summary}.`
          )
        );
      } else if (
        action.kind === "CREATE_COST_ITEM"
      ) {
        if (extra.scope === "library") {
          await createCostItem({
            type: action.type,
            name: action.name,
            unit: action.unit || "",
            unitCostCents: action.unitCostCents,
          });

          addMessage(
            createMessage(
              "assistant",

              `Am adăugat „${action.name}” în biblioteca ta de costuri.`
            )
          );
        } else {
          addMessage(
            createMessage(
              "assistant",

              `Am notat, dar nu l-am salvat în bibliotecă - „${action.name}” rămâne valabil doar pentru acest calcul.`
            )
          );
        }
      } else if (
        action.kind === "RECALCULATE_BATCH"
      ) {
        const results =
          await recalculateProductsBatch(
            action.productIds
          );

        const okCount = results.filter(
          (r) => r.ok
        ).length;

        addMessage(
          createMessage(
            "assistant",

            `Am recalculat ${okCount} din ${results.length} produse.`
          )
        );
      } else if (
        action.kind ===
        "UPDATE_PRODUCT_COSTING"
      ) {
        await savePersistedProductCosting(
          action.productId,
          action.costDraft
        );

        addMessage(
          createMessage(
            "assistant",

            `Am salvat modificările la „${action.productTitle}” ca ciornă.`
          )
        );

        setLastCostingActionLink({
          productId: action.productId,
        });
      } else if (
        action.kind ===
        "APPLY_RECOMMENDED_PRICE"
      ) {
        const applied =
          await applyPersistedRecommendedPrice(
            action.productId,

            Boolean(
              extra.acknowledgeStaleData
            )
          );

        addMessage(
          createMessage(
            "assistant",

            `Am actualizat prețul produsului „${action.productTitle}” la ${formatRonFromCents(
              applied.newPriceCents
            )}.`
          )
        );

        setLastCostingActionLink({
          productId: action.productId,
        });
      } else if (
        action.kind === "UPDATE_PRODUCT"
      ) {
        /*
         * Reutilizăm EXACT endpoint-ul/logica existente de
         * editare produs (aceeași cale ca ProductEditModal),
         * nu duplicăm business logic - action.patch e deja
         * filtrat pe whitelist de backend (dispatchCommand /
         * command/resolve), aici doar îl trimitem mai departe.
         */
        const updated = await api(
          `/api/vendors/products/${encodeURIComponent(
            action.productId
          )}`,
          {
            method: "PUT",
            body: action.patch,
          }
        );

        try {
          window.dispatchEvent(
            new CustomEvent(
              "vendor:productUpdated",
              {
                detail: {
                  id: action.productId,
                  ...updated,
                },
              }
            )
          );
        } catch {
          // Evenimentul e doar pentru refresh UI - nu blocăm fluxul.
        }

        addMessage(
          createMessage(
            "assistant",

            `Am actualizat „${action.productTitle}”: ${action.summary}.`
          )
        );

        setConversationContext((current) => ({
          ...current,
          mode: "NORMAL",
          productId: null,
          awaitingField: null,
          productUpdateDraft: null,
        }));

        setResolvedProductPreview(null);
      } else if (
        action.kind === "CREATE_SUPPORT_TICKET"
      ) {
        /*
         * Reutilizează EXACT createSupportTicket() deja existent
         * (POST /api/assistant/support/tickets, folosit și de
         * widget-ul de client) - nu duplicăm logica de creare
         * tichet aici, doar trimitem draftul construit de
         * supportEscalationService.js.
         */
        await createSupportTicket({
          subject: action.subject,
          category: action.category,
          priority: action.priority,
          message: action.message,
        });

        addMessage(
          createMessage(
            "assistant",

            "Am trimis solicitarea către echipa de suport. Vei fi contactat cât mai curând."
          )
        );

        setConversationContext((current) => ({
          ...current,
          activeIntent: null,
          currentFlow: null,
          collectedParams: null,
        }));
      } else if (
        action.kind === "UPDATE_STORE_PROFILE"
      ) {
        /*
         * Reutilizează EXACT endpoint-ul/logica existente de
         * editare magazin (PUT /api/vendors/store/:slug) - la fel
         * ca la UPDATE_PRODUCT, action.patch e deja filtrat pe
         * whitelist de backend, aici doar îl trimitem mai departe.
         */
        await api(
          `/api/vendors/store/${encodeURIComponent(
            action.storeSlug
          )}`,
          {
            method: "PUT",
            body: action.patch,
          }
        );

        addMessage(
          createMessage(
            "assistant",

            `Am actualizat magazinul „${action.storeName}”: ${action.summary}.`
          )
        );
      } else if (
        action.kind === "UPDATE_ORDER_STATUS"
      ) {
        /*
         * Reutilizează EXACT endpoint-ul existent de schimbare
         * status comandă (PATCH /api/vendor/orders/:id/status) -
         * ACELAȘI shape de body ca din pagina Comenzi. Validarea
         * reală (inclusiv blocarea pe plată card neconfirmată)
         * rulează din nou acolo, nu e duplicată aici.
         */
        await api(
          `/api/vendor/orders/${encodeURIComponent(
            action.orderId
          )}/status`,
          {
            method: "PATCH",
            body: { status: action.statusTarget },
          }
        );

        addMessage(
          createMessage(
            "assistant",

            `Am actualizat comanda „${action.orderNumber}”: ${action.summary}.`
          )
        );
      }

      setPendingCostingAction(null);
    } catch (err) {
      setPendingCostingActionError(
        err instanceof Error
          ? err.message
          : "Nu am putut aplica modificarea."
      );
    } finally {
      setPendingCostingActionBusy(false);
    }
  }

  /* =======================================================
     PROACTIVE COPILOT - insight-uri la deschidere
  ======================================================= */

  /*
   * Maximum 2-3 insight-uri IMPORTANTE, o singură dată - vezi
   * insightsShownRef mai sus. Doar IMPORTANT/WARNING (nu INFO,
   * acelea rămân disponibile la cerere prin "Ce ar trebui să
   * verific azi?", nu se bagă singure în față). Dacă nu e nimic
   * relevant, NU afișăm niciun mesaj - widget-ul rămâne exact cum
   * era înainte de FAZA asta.
   */
  async function maybeShowInsightsOnOpen() {
    if (insightsShownRef.current) return;
    insightsShownRef.current = true;

    try {
      const insights = await fetchVendorInsights();

      const important = insights
        .filter(
          (insight) =>
            insight.severity === "IMPORTANT" ||
            insight.severity === "WARNING"
        )
        .slice(0, 3);

      if (!important.length) return;

      const lines = important.map(
        (insight, index) =>
          `${index + 1}. ${insight.title} - ${insight.message}`
      );

      addMessage(
        createMessage(
          "assistant",
          lines.join("\n")
        )
      );

      setConversationContext((current) => ({
        ...current,

        activeInsight: {
          type: important[0].type,
          domain: important[0].domain,
          title: important[0].title,
          suggestedAction: important[0].suggestedAction,
          actionParams: important[0].actionParams,

          /*
           * "all", nu un scope îngust - dacă vânzătorul zice "arată-
           * mi toate" după rezumatul de la deschidere, vrea toate
           * insight-urile reale (inclusiv INFO), nu doar cele 2-3
           * arătate automat aici.
           */
          scope: "all",
        },
      }));
    } catch {
      /*
       * Insight-urile sunt un bonus proactiv, nu un flow critic -
       * dacă eșuează (rețea/server), widget-ul se deschide normal,
       * fără alt mesaj de eroare care ar distrage atenția.
       */
    }
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
    maybeShowInsightsOnOpen();
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
setWizardPublishing(false);
setWizardPublishError("");
setWizardPublishSuccess(null);
setPendingCostingLink(null);
setResolvedProductPreview(null);
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

setConversationContext(
  EMPTY_CONVERSATION_CONTEXT
);
setCalculatorPricing(null);
setCalculatorBusy(false);
setCalculatorSaving(false);
setCalculatorSaveError("");
setCalculatorCostingStatus(null);
setPhotoAssociatePicker(null);
setPhotoAssociateSaving(false);
setPhotoAssociateError("");

setCostingCommandBusy(false);
setCostingCommandResults(null);
setCostingCommandResultsTotal(0);
setCostingDisambiguation(null);
setPendingCostingAction(null);
setPendingCostingActionBusy(false);
setPendingCostingActionError("");
setLastCostingActionLink(null);

setTopicTracking({
  lastCategory: null,
  topicChangeStreak: 0,
});

    removeLoadingMessages();

    try {
      window.localStorage.removeItem(
        STORAGE_KEYS.draft
      );
    } catch {
      // Ignore.
    }
  }

  /*
   * "Subiect nou" != "Șterge conversația" (resetConversation, mai
   * sus). Resetează EXACT aceleași stări operaționale (flow activ,
   * wizard de produs/import în bulk, calculator de costuri,
   * conversationContext) - ca AI-ul să nu mai fie influențat de
   * discuția veche - dar PĂSTREAZĂ istoricul vizual, doar cu un
   * separator clar în listă.
   */
  function startNewTopic() {
    clearUploadedImages();

    addMessage(
      createMessage(
        "separator",
        "Subiect nou"
      )
    );

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
    setWizardPublishing(false);
    setWizardPublishError("");
    setWizardPublishSuccess(null);
    setPendingCostingLink(null);
    setResolvedProductPreview(null);
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

    setConversationContext(
      EMPTY_CONVERSATION_CONTEXT
    );
    setCalculatorPricing(null);
    setCalculatorBusy(false);
    setCalculatorSaving(false);
    setCalculatorSaveError("");
    setCalculatorCostingStatus(null);
    setPhotoAssociatePicker(null);
    setPhotoAssociateSaving(false);
    setPhotoAssociateError("");

    setCostingCommandBusy(false);
    setCostingCommandResults(null);
    setCostingCommandResultsTotal(0);
    setCostingDisambiguation(null);
    setPendingCostingAction(null);
    setPendingCostingActionBusy(false);
    setPendingCostingActionError("");
    setLastCostingActionLink(null);

    setTopicTracking({
      lastCategory: null,
      topicChangeStreak: 0,
    });

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

    /*
     * "Meniu principal" e o acțiune explicită de revenire -
     * iese din orice subflow Costuri & Profit activ (calculator/
     * analiză foto), fără să șteargă mesajele anterioare.
     */
    setConversationContext(
      EMPTY_CONVERSATION_CONTEXT
    );

    setCalculatorPricing(null);
    setCalculatorSaveError("");
    setCalculatorCostingStatus(null);
    setLastCostingActionLink(null);
    setPhotoAssociatePicker(null);
    setPhotoAssociateError("");

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
    VENDOR_ACTION_IDS.PRICE_CALCULATOR
  ) {
    enterPriceCalculatorMode();

    return;
  }

  /*
   * BUGFIX (audit): butonul "Cumpărături" exista în meniu
   * (vendorMenus.js) dar nu era conectat la nimic - vendorul
   * rămâne și cumpărător, folosește exact flow-ul de marketplace
   * search al USER-ului (startProductFlow, același din
   * assistantProducts.js/AiAssistant.jsx).
   */
  if (
    actionId ===
    VENDOR_ACTION_IDS.SHOPPING
  ) {
    setShowMenu(false);
    setActiveFlow("product-search");

    startProductFlow({
      actionId: "product-search",
      addConversation: (
        _userText,
        assistantText,
        extra = {}
      ) => {
        addMessage(
          createMessage(
            "assistant",
            assistantText,
            extra
          )
        );
      },
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

    /*
     * Cardul "ce vrei să fac cu ea?" de după upload - marcat cu
     * photoPendingChoice pe mesaj (vezi enterPhotoPendingMode),
     * NU face parte din state machine-ul VENDOR_PRODUCT_FLOWS.
     */
    if (sourceMessage?.photoPendingChoice) {
      await handlePhotoPendingChoice(label);
      return;
    }

    /*
     * Sugestie discretă de schimbare de subiect (vezi
     * processCostingCommandResult -> result.suggestTopicReset).
     * "Subiect nou" reutilizează EXACT startNewTopic() - același
     * reset ca la butonul din header, păstrează istoricul, adaugă
     * separatorul vizual.
     */
    if (
      sourceMessage?.type === "choices" &&
      sourceMessage?.choiceStep === "topic-suggestion"
    ) {
      if (choice === "Subiect nou") {
        startNewTopic();
      }

      return;
    }

    /*
     * BUGFIX (audit): alegeri din flow-ul de marketplace (search
     * text/imagine/cadou/buget) - identic cu AiAssistant.jsx,
     * același handleProductChoice, niciun cod nou de căutare.
     */
    if (MARKETPLACE_FLOW_TYPES.has(activeFlow)) {
      try {
        await handleProductChoice({
          activeFlow,
          choice,
          sourceMessage,
          visualSearchId,

          addMessage,
          removeMessage,
          createMessage,
        });
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

      return;
    }

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

    /*
     * Orice imagine încărcată înseamnă conversație activă -
     * meniul mare nu trebuie să rămână/reapară sub mesajul de
     * confirmare (același principiu ca în handleSubmit).
     */
    setShowMenu(false);

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

    enterPhotoPendingMode(total);
  }

  /* =======================================================
     Analiză temporară

     În etapa următoare înlocuim simularea cu:
     POST /api/ai/product-analyze
  ======================================================= */

  /*
   * Sursa de adevăr pentru imaginile produsului e
   * productDraft.images (ce vede vendorul afișat în wizard), NU
   * uploadedImages - cele două sunt IDENTICE după un upload
   * normal (handleImageChange le populează pe amândouă din
   * aceleași fișiere), dar productDraft.images poate fi populat
   * și direct, fără să treacă prin uploadedImages (ex. seed din
   * calculatorul de preț / analiza foto Costuri & Profit - vezi
   * handleCreateProductFromCalculator). Citirea din
   * uploadedImages era exact cauza pentru care "Analizează cu
   * AI" nu vedea o fotografie deja seed-uită.
   *
   * analyzeVendorProduct (prin uploadVendorProductImages)
   * acceptă tolerant orice amestec de string URL, {url/src/
   * imageUrl} sau {file: File} - nu reîncarcă imaginile deja
   * publice, doar le urcă pe cele care sunt încă fișiere locale.
   */
  async function handleAnalyzeProduct() {
  const imagesToAnalyze = Array.isArray(
    productDraft?.images
  )
    ? productDraft.images
    : [];

  if (
    !imagesToAnalyze.length
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
          imagesToAnalyze,
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

/*
 * "Salvează produsul" din pasul final al wizard-ului - înlocuiește
 * vechiul window.alert stub cu flow-ul REAL de creare produs.
 *
 * Reutilizează STRICT ce există deja, fără endpoint paralel:
 * - GET /api/vendor/catalog/products, EXACT ce folosește deja
 *   CatalogProduse.jsx, doar ca să aflăm slug-ul magazinului de
 *   produse al vendorului curent (defaultStoreSlug / stores[0]);
 * - uploadVendorProductImages (deja folosit de PhotoCostingDraftEditor
 *   și de handleAnalyzeProduct) - urcă DOAR imaginile care sunt
 *   încă fișiere locale, nu reîncarcă URL-uri deja publice;
 * - POST /api/vendors/store/:slug/products (createProduct pe
 *   backend) - EXACT endpoint-ul + shape-ul de body folosit de
 *   AddProductContainer.jsx (fluxul normal, non-chat, de adăugare
 *   produs) - aceleași validări, același moderationStatus
 *   "PENDING" implicit (nu public automat), NU un formular nou;
 * - același eveniment global "vendor:productUpdated", ca listele
 *   de produse din restul aplicației să se actualizeze la fel ca
 *   la adăugarea normală;
 * - savePersistedProductCosting (deja folosit de
 *   handleSaveCalculatorCosting) pentru legarea costing-ului
 *   calculat de noul produs, DOAR după ce produsul chiar a fost
 *   creat - nicio formulă de calcul duplicată.
 */
async function handlePublishProductFromWizard() {
  if (wizardPublishing) return;

  const draft = normalizeProductDraft(
    productDraft
  );

  if (!draft.title.trim()) {
    setWizardPublishError(
      "Adaugă un titlu pentru produs înainte de a salva."
    );

    return;
  }

  if (
    !Array.isArray(draft.images) ||
    !draft.images.length
  ) {
    setWizardPublishError(
      "Adaugă cel puțin o fotografie înainte de a salva."
    );

    return;
  }

  setWizardPublishing(true);
  setWizardPublishError("");
  setWizardPublishSuccess(null);

  try {
    /*
     * Slug-ul magazinului de produse al vendorului curent -
     * reutilizăm exact endpoint-ul deja folosit de pagina de
     * catalog (nu creăm un endpoint dedicat "care e slug-ul meu").
     */
    const catalogData = await api(
      "/api/vendor/catalog/products"
    );

    const storeSlug =
      catalogData?.defaultStoreSlug ||
      catalogData?.stores?.[0]?.slug ||
      null;

    if (!storeSlug) {
      throw new Error(
        "Nu am găsit magazinul tău de produse. Verifică din Catalog înainte de a salva."
      );
    }

    /*
     * Normalizează imaginile la URL-uri publice - nu reîncarcă
     * ce e deja urcat (string/{url}), doar fișierele locale
     * rămase ({file}).
     */
    const imageUrls =
      await uploadVendorProductImages(
        draft.images
      );

    const availability =
      draft.availability || "READY";

    const body = {
      title: draft.title.trim(),
      description: draft.description || "",

      price:
        draft.orderMode === "QUOTE_ONLY"
          ? 0
          : Number(draft.price || 0),

      images: imageUrls,
      currency: draft.currency || "RON",
      category: draft.category || null,
      color: draft.color || null,
      availability,

      orderMode:
        draft.orderMode ||
        "READY_TO_BUY",

      optionsSchema:
        draft.optionsSchema || [],

      customSchema:
        draft.customSchema || [],

      repeatedGroups:
        draft.repeatedGroups || [],

      quoteSchema:
        draft.quoteSchema || [],

      materialMain:
        draft.materialMain || null,

      technique:
        draft.technique || null,

      styleTags: draft.styleTags || "",

      occasionTags:
        draft.occasionTags || "",

      dimensions: draft.dimensions || "",

      careInstructions:
        draft.careInstructions || "",

      specialNotes:
        draft.specialNotes || "",
    };

    if (availability === "MADE_TO_ORDER") {
      body.leadTimeDays = Math.max(
        1,
        Number(draft.leadTimeDays || 1)
      );
    } else if (availability === "READY") {
      body.readyQty =
        draft.readyQty === "" ||
        draft.readyQty == null
          ? null
          : Math.max(
              0,
              Number(draft.readyQty)
            );
    } else if (
      availability === "PREORDER"
    ) {
      body.nextShipDate =
        draft.nextShipDate
          ? new Date(
              draft.nextShipDate
            ).toISOString()
          : null;
    }

    const created = await api(
      `/api/vendors/store/${encodeURIComponent(
        storeSlug
      )}/products`,

      {
        method: "POST",
        body,
      }
    );

    try {
      window.dispatchEvent(
        new CustomEvent(
          "vendor:productUpdated",

          {
            detail: {
              product: created,
            },
          }
        )
      );
    } catch {
      // Evenimentul e doar pentru refresh UI - nu blocăm fluxul.
    }

    /*
     * Legăm costing-ul calculat DOAR dacă avem unul complet,
     * capturat explicit la momentul "Creează produsul în magazin"
     * (pendingCostingLink) - NU citim direct din
     * conversationContext, ca să nu legăm un costing vechi/
     * abandonat de un produs nelegat. Doar după ce produsul chiar
     * a fost creat; un eșec aici NU anulează produsul deja creat,
     * doar arătăm un warning separat.
     */
    const hasCostingToLink = Boolean(
      pendingCostingLink?.costDraft &&
        pendingCostingLink?.pricing
    );

    let costingWarning = null;

    if (hasCostingToLink) {
      try {
        await savePersistedProductCosting(
          created.id,
          pendingCostingLink.costDraft
        );
      } catch (err) {
        costingWarning =
          err instanceof Error
            ? err.message
            : "Nu am putut salva costingul calculat pentru acest produs.";
      }
    }

    setWizardPublishSuccess({
      productId: created.id,
      title: created.title || draft.title,
      costingWarning,
    });

    addMessage(
      createMessage(
        "assistant",

        `Am creat produsul „${
          created.title || draft.title
        }” (în așteptarea moderării).${
          costingWarning
            ? ` Nu am putut salva și costingul calculat: ${costingWarning}`
            : hasCostingToLink
              ? " Am salvat și costingul calculat pentru el."
              : ""
        }`
      )
    );
  } catch (err) {
    setWizardPublishError(
      err instanceof Error
        ? err.message
        : "Nu am putut salva produsul."
    );
  } finally {
    setWizardPublishing(false);
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

    /*
     * Orice mesaj liber înseamnă că vendorul e activ în
     * conversație - meniul mare nu trebuie să rămână/reapară
     * sub răspunsuri. Rămâne ascuns până la o acțiune EXPLICITĂ
     * (butoanele Meniu principal / Înapoi, sau închiderea unui
     * subflow care chiar cere revenire la meniu).
     */
    setShowMenu(false);

    /*
     * Vendorul răspunde la întrebarea "cărui produs vrei
     * să-i asociez calculul din fotografie?" - tot mesajul
     * e tratat direct ca nume de căutare, fără detecție de
     * intenție. Singurul caz în care awaitingField NU e despre
     * calculator - e o sub-fază distinctă a PHOTO_COSTING.
     */
    if (
      conversationContext.awaitingField ===
      "photo-associate-product-name"
    ) {
      addMessage(
        createMessage(
          "user",
          value
        )
      );

      setInputValue("");

      setConversationContext(
        (current) => ({
          ...current,
          awaitingField: null,
        })
      );

      addMessage(
        createMessage(
          "assistant",

          `Caut „${value}”...`
        )
      );

      const results =
        await runPhotoAssociateProductSearch(
          value
        );

      if (!results.length) {
        setPhotoAssociatePicker(null);

        addMessage(
          createMessage(
            "assistant",

            `Nu am găsit niciun produs cu numele „${value}”.`
          )
        );

        return;
      }

      if (results.length === 1) {
        setPhotoAssociatePicker(null);

        await associatePhotoMaterialsWithProduct(
          results[0].productId,
          results[0].title
        );

        return;
      }

      /*
       * Mai multe rezultate - abia acum arătăm picker-ul inline.
       */
      setPhotoAssociatePicker({
        results,
        loading: false,
        error: "",
      });

      return;
    }

    const detectedIntent =
      detectVendorIntent(
        value
      );

    /*
     * "vreau să adaug un produs" -> rămâne un flux client-side
     * dedicat (wizard-ul de adăugare), separat de Costuri &
     * Profit - orchestratorul nu știe nimic despre asta.
     * Verificat ÎNAINTEA cazului cu poză/calculator, ca "adaugă
     * produs" să câștige mereu, indiferent de subflow-ul activ.
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

    /*
     * O poză e deja încărcată în chat -> interpretăm textul
     * folosind fotografia ca context, determinist (aceeași
     * clasificare ca alegerea unui buton din cardul PHOTO_PENDING -
     * vezi detectPhotoPendingChoice), fără să mai deschidem
     * separat un activeVendorView.
     *
     * BUGFIX (audit): dacă textul NU se potrivește clar cu nicio
     * opțiune, NU mai presupunem "Calculează prețul" - aceeași
     * fotografie poate fi folosită și ca unealtă de cumpărare
     * (căutare vizuală), nu doar de vânzare. Ghicitul greșit ar fi
     * pornit costingul pentru un vendor care voia doar să caute
     * produse asemănătoare. Reafișăm întrebarea, cu alegerile
     * disponibile.
     */
    if (uploadedImages.length > 0) {
      addMessage(
        createMessage(
          "user",
          value
        )
      );

      setInputValue("");

      const matchedChoice =
        detectPhotoPendingChoice(value);

      if (!matchedChoice) {
        addMessage(
          createMessage(
            "assistant",
            "Am primit fotografia. Ce vrei să fac cu ea?",
            {
              photoPendingChoice: true,
              choices: PHOTO_PENDING_CHOICES,
            }
          )
        );

        return;
      }

      await handlePhotoPendingChoice(
        matchedChoice
      );

      return;
    }

    /*
     * Modul PRICE_CALCULATOR are prioritate pe rutare: mesajul
     * merge ÎNTÂI la flow-ul calculatorului, NU la orchestrator.
     * handlePriceCalculatorTurn decide intern (determinist, apoi
     * eventual orchestrator) dacă e chiar o comandă globală clară
     * (bibliotecă/produse/recalculare/aplicare preț) sau o ieșire
     * explicită - altfel continuă direct draftul curent.
     */
    if (
      conversationContext.mode ===
      "PRICE_CALCULATOR"
    ) {
      addMessage(
        createMessage(
          "user",
          value
        )
      );

      setInputValue("");
      setIsSubmitting(true);

      try {
        await handlePriceCalculatorTurn(
          value
        );
      } finally {
        setIsSubmitting(false);
      }

      return;
    }

    /*
     * BUGFIX (audit): moștenire capabilități USER -> VENDOR -
     * "caut un cadou pentru mama"/"idei cadou mama" etc. trebuie să
     * folosească EXACT flow-ul de marketplace search al USER-ului,
     * nu clasificatorul de platformă (care putea răspunde greșit
     * "nu am informații" sau chiar declanșa o acțiune de magazin).
     * Verificat DOAR când nu e niciun context activ mai specific
     * (PRICE_CALCULATOR e deja tratat mai sus; PHOTO_COSTING/
     * PRODUCT_UPDATE au prioritate - principiul "context activ" -
     * și nu trebuie întrerupte de o potrivire întâmplătoare de
     * cuvinte ca "vreau"/"caut").
     */
    const isMarketplaceFlowActive =
      MARKETPLACE_FLOW_TYPES.has(activeFlow);

    const noOtherActiveContext =
      !conversationContext.mode ||
      conversationContext.mode === "NORMAL";

    if (
      isMarketplaceFlowActive ||
      noOtherActiveContext
    ) {
      const marketplaceIntent =
        isMarketplaceFlowActive
          ? { type: activeFlow }
          : detectMarketplaceIntent(value, {
              includeGenericProductWords: false,
            });

      if (marketplaceIntent) {
        addMessage(
          createMessage("user", value)
        );

        setInputValue("");

        if (!isMarketplaceFlowActive) {
          setShowMenu(false);
          setActiveFlow(marketplaceIntent.type);
        }

        setIsSubmitting(true);

        try {
          const handled = await submitProductMessage({
            activeFlow: marketplaceIntent.type,
            value,
            visualSearchId,

            addMessage,
            removeMessage,
            createMessage,
          });

          if (!handled) {
            addMessage(
              createMessage(
                "assistant",
                "Nu am putut porni căutarea. Încearcă să descrii produsul puțin diferit."
              )
            );
          }
        } finally {
          setIsSubmitting(false);
        }

        return;
      }
    }

    /*
     * Implicit (NORMAL, sau PHOTO_COSTING fără un awaitingField
     * activ) - mesajul trece ÎNTÂI prin copilot router (FAZA 5),
     * care deleagă la orchestratorul existent
     * POST /api/ai/assistant/command dacă nu e o categorie
     * tratată de el (handled:false). handleCostingAssistantCommand
     * deschide calculatorul DOAR dacă rezultatul e
     * CALCULATE_PRICE_GENERIC (vezi processCostingCommandResult).
     */
    addMessage(
      createMessage(
        "user",
        value
      )
    );

    setInputValue("");
    setIsSubmitting(true);

    try {
      await handleCopilotThenCostingCommand(
        value
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
                    startNewTopic
                  }
                  aria-label="Subiect nou - păstrează istoricul, dar nu mai ține cont de discuția anterioară"
                  title="Subiect nou"
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    whiteSpace: "nowrap",
                    padding: "0 8px",
                  }}
                >
                  Subiect nou
                </button>

                <button
                  type="button"
                  onClick={
                    resetConversation
                  }
                  aria-label="Șterge toată conversația"
                  title="Șterge conversația"
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
    onPublish={
      handlePublishProductFromWizard
    }
    publishing={
      wizardPublishing
    }
    publishError={
      wizardPublishError
    }
    publishSuccess={
      wizardPublishSuccess
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

    {costingCommandBusy && (
      <div
        style={{
          fontSize: 12.5,
          color: "#8a6f62",
          marginBottom: 8,
        }}
      >
        Caut...
      </div>
    )}

    {calculatorBusy && (
      <div
        style={{
          fontSize: 12.5,
          color: "#8a6f62",
          marginBottom: 8,
        }}
      >
        Calculez...
      </div>
    )}

    {costingCommandResults && (
      <div style={{ marginBottom: 10 }}>
        <VendorProductPicker
          title=""
          products={
            costingCommandResults
          }
          onSelect={(product) =>
            window.open(
              `/vendor/costs-profit/${product.productId}`,
              "_blank",
              "noopener,noreferrer"
            )
          }
        />

        {costingCommandResultsTotal >
          costingCommandResults.length && (
          <a
            href="/vendor/costs-profit"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: "block",
              marginTop: 6,
              fontSize: 12.5,
              color: "#6f4e43",
              fontWeight: 700,
            }}
          >
            Vezi toate în Costuri & Profit →
          </a>
        )}
      </div>
    )}

    {costingDisambiguation &&
      (costingDisambiguation.products ? (
        <div style={{ marginBottom: 10 }}>
          <VendorProductPicker
            title="Alege produsul"
            products={
              costingDisambiguation.products
            }
            onSelect={(product) =>
              handleCostingDisambiguationSelect(
                "product",
                product.productId
              )
            }
            onBack={() =>
              setCostingDisambiguation(null)
            }
          />
        </div>
      ) : (
        <div
          style={{
            marginBottom: 10,
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}
        >
          <strong
            style={{ fontSize: 13 }}
          >
            Care cost anume?
          </strong>

          {costingDisambiguation.costItems?.map(
            (item) => (
              <button
                key={item.id}
                type="button"
                onClick={() =>
                  handleCostingDisambiguationSelect(
                    "cost_item",
                    item.id
                  )
                }
                style={{
                  textAlign: "left",
                  border:
                    "1px solid rgba(70, 45, 35, 0.16)",
                  borderRadius: 10,
                  padding: "8px 10px",
                  background: "#fcfaf8",
                  cursor: "pointer",
                  fontSize: 13,
                }}
              >
                {item.name} — {item.unitCost}{" "}
                lei
                {item.unit
                  ? `/${item.unit}`
                  : ""}
              </button>
            )
          )}

          <button
            type="button"
            onClick={() =>
              setCostingDisambiguation(null)
            }
            style={{
              alignSelf: "flex-start",
              border: 0,
              background: "transparent",
              color: "#8a6f62",
              fontSize: 12,
              cursor: "pointer",
              padding: 0,
            }}
          >
            Renunță
          </button>
        </div>
      ))}

    {photoAssociatePicker && (
      <div style={{ marginBottom: 10 }}>
        <VendorProductPicker
          title="Alege produsul"
          hint="Maxim 5 rezultate afișate."
          products={
            photoAssociatePicker.results
          }
          loading={
            photoAssociatePicker.loading
          }
          error={
            photoAssociatePicker.error
          }
          onSelect={
            handlePhotoAssociatePickerSelect
          }
          onBack={() =>
            setPhotoAssociatePicker(null)
          }
        />
      </div>
    )}

    {conversationContext.mode ===
      "PHOTO_COSTING" && (
      <div style={{ marginBottom: 10 }}>
        {!conversationContext.photoDraft
          ?.materials ? (
          <PhotoCostingDraftEditor
            initialFile={
              conversationContext
                .photoDraft?.file
            }
            onConfirm={
              handlePhotoConfirmMaterials
            }
            onCancel={() =>
              exitToNormalMode()
            }
            confirmLabel="Confirmă componentele"
          />
        ) : (
          <div>
            {photoAssociateError && (
              <div
                style={{
                  color: "#b3261e",
                  fontSize: 12.5,
                  marginBottom: 8,
                }}
              >
                {photoAssociateError}
              </div>
            )}

            {!photoAssociatePicker &&
              !conversationContext.awaitingField && (
                <div
                  style={{
                    display: "flex",
                    flexDirection:
                      "column",
                    gap: 8,
                  }}
                >
                  <button
                    type="button"
                    onClick={
                      handleAskAssociateProduct
                    }
                    disabled={
                      photoAssociateSaving
                    }
                    style={{
                      border: 0,
                      borderRadius: 10,
                      padding:
                        "10px 14px",
                      cursor: "pointer",
                      fontWeight: 700,
                      fontSize: 13.5,
                      background:
                        "#6f4e43",
                      color: "#ffffff",
                    }}
                  >
                    Alege un produs
                    existent
                  </button>

                  <button
                    type="button"
                    onClick={
                      handleTemporaryPhotoCalc
                    }
                    disabled={
                      photoAssociateSaving
                    }
                    style={{
                      border:
                        "1px solid rgba(70, 45, 35, 0.2)",
                      borderRadius: 10,
                      padding:
                        "10px 14px",
                      cursor: "pointer",
                      fontWeight: 700,
                      fontSize: 13.5,
                      background:
                        "#ffffff",
                      color: "#4f3b33",
                    }}
                  >
                    Calcul temporar (nu
                    se salvează)
                  </button>
                </div>
              )}
          </div>
        )}
      </div>
    )}

    {conversationContext.mode ===
      "PRICE_CALCULATOR" &&
      calculatorPricing && (
        <div style={{ marginBottom: 10 }}>
          <PricingBreakdownCard
            pricing={calculatorPricing}
          />

          {conversationContext.productId ? (
            <div
              style={{
                border:
                  "1px solid rgba(70, 45, 35, 0.16)",
                borderRadius: 14,
                padding: 14,
                background: "#fcfaf8",
                marginTop: -6,
              }}
            >
              <button
                type="button"
                onClick={
                  handleSaveCalculatorCosting
                }
                disabled={
                  calculatorSaving ||
                  !conversationContext.costDraft
                }
                style={{
                  width: "100%",
                  border: 0,
                  borderRadius: 10,
                  padding: "10px 14px",
                  cursor: calculatorSaving
                    ? "not-allowed"
                    : "pointer",
                  fontWeight: 700,
                  fontSize: 13.5,
                  background: "#3c6e4f",
                  color: "#ffffff",
                  opacity: calculatorSaving
                    ? 0.7
                    : 1,
                }}
              >
                {calculatorSaving
                  ? "Se salvează..."
                  : "Salvează costingul produsului"}
              </button>

              {calculatorCostingStatus && (
                <small
                  style={{
                    display: "block",
                    marginTop: 6,
                    color: "#8a6f62",
                  }}
                >
                  Stare salvată:{" "}
                  {calculatorCostingStatus ===
                  "CONFIRMED"
                    ? "confirmat"
                    : "ciornă"}
                </small>
              )}

              {calculatorSaveError && (
                <small
                  style={{
                    display: "block",
                    marginTop: 6,
                    color: "#b3261e",
                  }}
                >
                  {calculatorSaveError}
                </small>
              )}
            </div>
          ) : (
            <div
              style={{
                border:
                  "1px solid rgba(70, 45, 35, 0.16)",
                borderRadius: 14,
                padding: 14,
                background: "#fcfaf8",
                marginTop: -6,
              }}
            >
              <p
                style={{
                  margin: "0 0 8px",
                  fontSize: 13,
                  color: "#493932",
                }}
              >
                Vrei să creezi produsul
                în magazin folosind
                aceste date?
              </p>

              <button
                type="button"
                onClick={
                  handleCreateProductFromCalculator
                }
                style={{
                  width: "100%",
                  border:
                    "1px solid rgba(70, 45, 35, 0.2)",
                  borderRadius: 10,
                  padding: "10px 14px",
                  cursor: "pointer",
                  fontWeight: 700,
                  fontSize: 13.5,
                  background: "#ffffff",
                  color: "#4f3b33",
                }}
              >
                Creează produsul în
                magazin
              </button>
            </div>
          )}
        </div>
      )}

    {resolvedProductPreview &&
      !pendingCostingAction && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            border:
              "1px solid var(--color-border, #e5e5e5)",
            borderRadius: 12,
            padding: "8px 12px",
            marginTop: 6,
            marginBottom: 10,
            background:
              "var(--surface, #ffffff)",
          }}
        >
          {resolvedProductPreview.image ? (
            <img
              src={
                resolvedProductPreview.image
              }
              alt=""
              style={{
                width: 40,
                height: 40,
                borderRadius: 8,
                objectFit: "cover",
                flexShrink: 0,
              }}
            />
          ) : (
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: 8,
                flexShrink: 0,
                background:
                  "color-mix(in srgb, var(--color-muted, #6b7280) 16%, transparent)",
              }}
            />
          )}

          <div
            style={{
              minWidth: 0,
              display: "flex",
              flexDirection: "column",
              gap: 2,
            }}
          >
            <strong
              style={{
                fontSize: 13,
                color:
                  "var(--color-text, #2d2d2d)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {resolvedProductPreview.title}
            </strong>

            {resolvedProductPreview.priceCents !=
              null && (
              <span
                style={{
                  fontSize: 12,
                  color:
                    "var(--color-muted, #6b7280)",
                }}
              >
                {formatRonFromCents(
                  resolvedProductPreview.priceCents
                )}
              </span>
            )}
          </div>
        </div>
      )}

    {pendingCostingAction && (
      <PendingActionCard
        action={
          pendingCostingAction
        }
        busy={
          pendingCostingActionBusy
        }
        error={
          pendingCostingActionError
        }
        onConfirm={(extra) =>
          handleConfirmPendingCostingAction(
            extra
          )
        }
        onCancel={() => {
          setPendingCostingAction(null);
          setPendingCostingActionError("");

          /*
           * FAZA 8-10: dacă era un ticket de suport propus,
           * Renunță trebuie să oprească triajul, nu doar cardul.
           */
          if (
            pendingCostingAction?.kind ===
            "CREATE_SUPPORT_TICKET"
          ) {
            setConversationContext((current) => ({
              ...current,
              activeIntent: null,
              currentFlow: null,
              collectedParams: null,
            }));
          }
        }}
      />
    )}

    {lastCostingActionLink && (
      <a
        href={`/vendor/costs-profit/${lastCostingActionLink.productId}`}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          display: "block",
          marginBottom: 10,
          fontSize: 12.5,
          color: "#6f4e43",
          fontWeight: 700,
        }}
      >
        Vezi în Costuri & Profit ↗
      </a>
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

                        return;
                      }

                      /*
                       * HARDENING: Escape închide widget-ul, la fel
                       * ca orice alt panou/overlay - fără asta,
                       * singura cale de închidere era click pe X.
                       */
                      if (event.key === "Escape") {
                        event.preventDefault();
                        closeAssistant();
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