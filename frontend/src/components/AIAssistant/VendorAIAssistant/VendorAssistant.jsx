// src/components/AIAssistant/Vendor/VendorAssistant.jsx

import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { useLocation, useNavigate } from "react-router-dom";

import styles from "../AiAssistant.module.css";

import { derivePageContext } from "../derivePageContext.js";
import { useCurrentEntityContext } from "../CurrentEntityContext.jsx";
import { humanizeAssistantErrorMessage } from "../assistantErrorMessages.js";

import AssistantMessage from "../components/AssistantMessage.jsx";
import ActionMenu from "../components/ActionMenu.jsx";

import {
  AttachmentIcon,
  BackIcon,
  ChevronRightIcon,
  CloseIcon,
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

import VendorProductWizard, {
  getMissingFields,
} from "./components/VendorProductWizard.jsx";
import VendorProductBatchWizard from "./components/VendorProductBatchWizard.jsx";
import {
  detectVendorIntent,
  VENDOR_INTENTS,
  detectVendorNavigationTarget,
  extractProductNameFromMessage,
} from "./vendorIntent.js";

import {
  fetchLeanProductList,
  fetchProductEditDraft,
  fetchProductCategories,
  buildProductSavePayload,
} from "./services/productEditMapping.js";

import {
  ASSISTANT_ROLES,
  resolveAssistantAction,
} from "../assistantActionRegistry.js";

import { prefetchChunk } from "../../../lib/smartPrefetch.js";

import {
  analyzeVendorProduct,
  analyzeVendorProductOrder,
  uploadVendorProductImages,
  clusterVendorProductImages,
  MAX_BATCH_CLUSTER_IMAGES,
} from "./services/vendorProductAi.js";

import { sendPriceCalculatorTurn } from "./services/vendorPriceCalculatorApi.js";

import { api } from "../../../lib/api.js";

import VendorProductPicker from "../../../pages/Vendor/CostsProfit/components/VendorProductPicker.jsx";
import PricingBreakdownCard from "../../../pages/Vendor/CostsProfit/components/PricingBreakdownCard.jsx";
import PhotoCostingDraftEditor from "../../../pages/Vendor/CostsProfit/components/PhotoCostingDraftEditor.jsx";
import PendingActionCard from "../../../pages/Vendor/CostsProfit/components/PendingActionCard.jsx";
import { searchVendorProducts } from "../../../pages/Vendor/CostsProfit/productSearchApi.js";
import { formatRonFromCents } from "../../../pages/Vendor/CostsProfit/formatMoney.js";
import { describeAvailability } from "./vendorPriceStockHelpers.js";
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
import { getCanonicalLabel } from "../../../utils/optionLabels.js";

/*
 * "Cereri primite" (audit 2026-09-23) - conectare la infrastructura
 * REALĂ, deja existentă și folosită de AiAssistant.jsx (client/user):
 * fetchVendorQuotes (GET /api/vendor/quotes), openVendorQuote +
 * handleQuoteChoice (deschidere cerere/conversație + mark-as-read,
 * QUOTE_FLOWS pentru activeFlow). Niciun duplicat - aceleași funcții,
 * reutilizate ca atare. vendorQuoteLeadCards.js e STRICT sortare/
 * formatare pură (fără rețea), specifică vizualizării compacte cerute
 * aici.
 */
import { fetchVendorQuotes } from "../quotes/quoteApi.js";
import {
  handleQuoteChoice,
  QUOTE_FLOWS,
} from "../quotes/assistantQuotes.js";
import {
  normalizeVendorQuoteList,
  buildVendorQuoteLeadCards,
} from "../quotes/vendorQuoteLeadCards.js";

/*
 * "Comenzile magazinului" (audit 2026-09-23) - conectare la
 * GET /api/vendor/orders + GET /api/vendor/orders/thread-meta
 * (DEJA existente, folosite de pagina reală Orders.jsx). Read-only
 * strict: niciun apel de scriere (fără schimbare de status) în acest
 * prim pas. vendorOrderLeadCards.js e STRICT sortare/formatare pură.
 */
import {
  normalizeVendorOrderList,
  buildVendorOrderLeadCards,
  mergeVendorOrderThreadMeta,
  RETRY_VENDOR_ORDER_LEADS_ACTION,
} from "./vendorOrderLeadCards.js";

/*
 * "Magazinul meu" (audit 2026-09-23) - conectare la
 * GET /api/vendors/me/dashboard + GET /api/vendors/me/billing +
 * GET /api/vendor/store/:slug/products (DEJA existente). Reguli
 * 100% deterministe, fără scor numeric, fără AI - vezi
 * vendorStoreLeadRules.js. "Îmbunătățește magazinul" încarcă date
 * suplimentare DOAR la click (nu la simpla deschidere a meniului).
 */
import {
  buildVendorStoreSuggestions,
  isVendorStoreComplete,
  buildVendorStoreSnapshot,
} from "./vendorStoreLeadRules.js";

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
  HELP_SUPPORT_INTENT_RE,
  OWN_ENTITY_ACTION_RE,
  OWN_VENDOR_DATA_RE,
} from "../Products/assistantProducts.js";

import {
  normalizeForIntentDetection,
  isExplainIntentMessage,
} from "../explainIntent.js";

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
   * PRICE_STOCK (audit 2026-09-23) - true cât timp vendorul e în
   * fluxul restrâns "Preț și stoc" (nu în EDIT_PRODUCT general) -
   * controlează ce meniu se arată (PRICE_STOCK_QUICK_ACTIONS vs
   * PRODUCT_QUICK_ACTIONS), ce mesaj de succes/follow-up apare și
   * spre ce selector duce "Alege alt produs".
   */
  priceStockNarrow: false,

  /*
   * PRICE_STOCK "Ambele" - pas curent al colectării secvențiale
   * (preț ÎNTÂI, apoi stoc), NU un nou mecanism de extragere - fiecare
   * pas folosește EXACT orchestratorul deja existent (awaitingField
   * "price" / compus pentru stoc); doar rezultatul primului pas e
   * ținut aici ca să fie combinat cu al doilea într-un SINGUR
   * PendingActionCard (vezi comboPriceResult, mai jos, și
   * handleCostingAssistantCommand).
   */
  comboStep: null,

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

/*
 * FAZA 8 (polish vizual, consistență roluri) - NU mai e un mesaj
 * seedat în `messages` (bulă mare de chat) - text static, randat
 * separat, DUPĂ quick actions (vezi JSX, gated pe `showMenu`), ca
 * la INFLUENCER/USER/GUEST (AiAssistant.jsx). Nu intră în niciun
 * history trimis către backend.
 */
const VENDOR_ASSISTANT_INTRO_TEXT =
  "Întreabă-mă despre produse, comenzi, prețuri, promovare sau magazin. Te pot duce direct la pagina potrivită.";

const EMPTY_PRODUCT_DRAFT = {
  images: [],
  videoUrl: null,
  videoMuted: false,

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
   EDIT_PRODUCT conversațional - quick actions afișate după
   selectarea unui produs din listă (vezi presentProductQuickActions).
   Câmpurile text/numerice simple sunt EXACT cele deja suportate de
   orchestratorul PRODUCT_UPDATE (PRODUCT_FIELD_LABELS din
   vendorAssistantCommandService.js) - nu inventăm capabilități noi
   de editare conversațională. Imagini/variante/personalizare rămân
   STRICT în wizard-ul complet (VendorProductWizard mode="edit"),
   pentru că nu sunt structuri potrivite pentru text liber.
========================================================= */

const PRODUCT_QUICK_ACTIONS = [
  { id: "title", label: "Titlul" },
  { id: "description", label: "Descrierea" },
  { id: "price", label: "Prețul" },
  { id: "stock", label: "Stocul / disponibilitatea" },
  { id: "category", label: "Categoria" },
  { id: "variants", label: "Variante / opțiuni" },
  { id: "personalization", label: "Personalizarea" },
  { id: "images", label: "Imaginile" },
  { id: "full-editor", label: "Deschide editorul complet" },
  { id: "other", label: "Altceva" },
];

/*
 * DOAR pentru id-urile de mai jos awaitingField devine numele exact
 * al câmpului din PRODUCT_FIELD_LABELS (backend) - restul (stock/
 * other) rămân cu awaitingField null, dar productId tot ajunge la
 * orchestrator (vezi relaxarea din handleCostingAssistantCommand),
 * ca AI-ul să știe în continuare despre ce produs e vorba.
 */
const PRODUCT_QUICK_ACTION_FIELD_MAP = {
  title: "title",
  description: "description",
  price: "price",
  category: "category",
};

const PRODUCT_QUICK_ACTION_PROMPTS = {
  title: "Care este noul titlu?",
  description:
    "Ce descriere vrei să folosesc? Scrie liber, iar eu pregătesc un draft pe care îl confirmi înainte să-l salvez.",
  price: "Care este noul preț, în lei?",
  category: "Care este noua categorie?",
  stock:
    "Spune-mi noul stoc sau disponibilitatea - ex. „mai am 5 bucăți” sau „e disponibil doar la comandă”.",
  other: "Spune-mi liber ce vrei să modific la acest produs.",
};

const PRODUCT_FULL_EDITOR_ACTIONS = new Set([
  "variants",
  "personalization",
  "images",
  "full-editor",
]);

const PRODUCT_UPDATE_FOLLOWUP_CHOICES = [
  "Mai modific ceva la acest produs",
  "Alege alt produs",
  "Deschide editorul complet",
  "Înapoi la Produse",
];

/* =========================================================
   PRICE_STOCK (audit 2026-09-23) - meniu RESTRÂNS, specific
   fluxului "Preț și stoc" (Produsele mele -> Preț și stoc -> Alege
   un produs). Reutilizează STRICT aceeași infrastructură ca
   EDIT_PRODUCT (awaitingField "price", mecanismul compus pentru
   stoc, PendingActionCard, handleConfirmPendingCostingAction,
   PUT /api/vendors/products/:id) - doar meniul afișat e mai mic
   (4 opțiuni, nu 10) și textele sunt adaptate contextului.
========================================================= */

const PRICE_STOCK_QUICK_ACTIONS = [
  { id: "price", label: "Preț" },
  { id: "stock", label: "Stoc / disponibilitate" },
  { id: "both", label: "Ambele" },
  { id: "change-product", label: "Alege alt produs" },
];

/*
 * Identic PRODUCT_UPDATE_FOLLOWUP_CHOICES, dar FĂRĂ "Deschide
 * editorul complet" - fluxul restrâns nu propune wizard-ul greu ca
 * pas următor implicit (rămâne accesibil prin "Alege alt produs" ->
 * meniul general, dacă vendorul chiar are nevoie de el).
 */
const PRICE_STOCK_UPDATE_FOLLOWUP_CHOICES = [
  "Mai modific ceva la acest produs",
  "Alege alt produs",
  "Înapoi la Produse",
];

/*
 * Preț/imagine - sursele diferă după origine: un item din lista
 * lean (fetchLeanProductList) are `.price` în LEI + `.image`, un
 * produs complet (fetchProductEditDraft / răspunsul PUT de update)
 * are `.priceCents` + `.images[]`. Ambele acoperite aici, o
 * singură dată, ca resolvedProductPreview să rămână corect
 * indiferent de unde vine produsul.
 */
function toPriceCentsFromProduct(product) {
  if (!product) return null;

  const priceCents = Number(product.priceCents);

  if (Number.isFinite(priceCents)) {
    return priceCents;
  }

  const price = Number(product.price);

  if (Number.isFinite(price)) {
    return Math.round(price * 100);
  }

  return null;
}

function toProductPreviewImage(product) {
  if (!product) return null;

  if (product.image) return product.image;

  if (
    Array.isArray(product.images) &&
    product.images.length
  ) {
    return product.images[0];
  }

  return null;
}

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

/*
 * ACTIONABLE RECOMMENDATIONS - construiește butoanele "CTA" dintr-un
 * array de insight-uri (insightsService.js), folosind STRICT
 * `insight.navAction` (deja calculat/validat pe backend - niciun
 * routing nou aici). Insight-urile fără navAction (ex. lipsă
 * colecții - nu există încă un flow real de creare) sunt filtrate,
 * deci rămân doar text în mesaj, exact cum cere cerința.
 */
function buildVendorInsightChoices(insights) {
  if (!Array.isArray(insights)) {
    return [];
  }

  return insights
    .filter((insight) => insight?.navAction?.label)
    .map((insight) => ({
      id: insight.id,
      label: insight.navAction.label,
      navAction: insight.navAction,
      insightType: insight.type,
      insightDomain: insight.domain || null,
    }));
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

/*
 * BUGFIX (audit mobil) - `window.innerHeight` NU se micșorează pe
 * toate browserele mobile când se deschide tastatura (ex. Safari iOS
 * păstrează viewport-ul de layout neschimbat și doar acoperă vizual
 * partea de jos) - `window.visualViewport`, acolo unde e disponibil,
 * reflectă corect zona vizibilă efectiv. Fără asta, panoul (și
 * implicit zona de input, aflată jos) putea rămâne dimensionat/
 * poziționat pentru toată înălțimea ecranului și ajunge acoperit de
 * tastatură. Cădere înapoi pe innerWidth/innerHeight peste tot unde
 * visualViewport nu există (desktop, browsere vechi) - comportament
 * identic cu înainte în acele cazuri.
 */
function getViewportSize() {
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
    width:
      window.visualViewport?.width ||
      window.innerWidth,

    height:
      window.visualViewport?.height ||
      window.innerHeight,
  };
}

function getPanelSize() {
  const viewport =
    getViewportSize();

  return {
    width: Math.min(
      380,
      viewport.width - 24
    ),

    height: Math.min(
      580,
      viewport.height - 24
    ),
  };
}

function getDefaultPosition() {
  const viewport =
    getViewportSize();

  return {
    x: Math.max(
      12,
      viewport.width - 84
    ),

    y: Math.max(
      12,
      viewport.height - 84
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

  const viewport =
    getViewportSize();

  const padding = 12;

  const maxX =
    Math.max(
      padding,
      viewport.width -
        elementWidth -
        padding
    );

  const maxY =
    Math.max(
      padding,
      viewport.height -
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

export default function VendorAssistant({
  embedded = false,

  /*
   * BUGFIX (buton X nu închide panoul) - identic cu AiAssistant.jsx:
   * în modul `embedded` (singurul folosit azi, din FloatingHub.jsx),
   * vizibilitatea reală vine din state-ul `open` din FloatingHub, nu
   * din `isOpen`-ul intern - `closeAssistant()` seta doar `isOpen`,
   * fără efect vizibil. `onClose` anunță explicit părintele.
   */
  onClose = null,
} = {}) {
  const location = useLocation();
  const navigate = useNavigate();

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

  /*
   * Input ascuns separat, DOAR pentru "Fă poze" din wizard-ul de
   * import în bulk (capture="environment" deschide direct camera pe
   * mobil, spre deosebire de fileInputRef, care deschide galeria).
   * Folosește EXACT același handleImageChange - nicio logică
   * duplicată, doar o a doua poartă de intrare pentru fișiere.
   */
  const cameraInputRef =
    useRef(null);

  const messagesEndRef =
    useRef(null);

  const uploadedImagesRef =
    useRef([]);

  /*
   * Protecție reală anti-dublu-submit (cerința #13) - `useRef`, NU
   * state: un state guard citit la începutul unui handler poate fi
   * încă "vechi" pentru al doilea click, dacă ambele click-uri
   * pornesc înainte ca React să re-randeze (batching). Un ref se
   * actualizează sincron, în aceeași tură de execuție.
   */
  const inFlightGroupPublishRef =
    useRef(new Set());

  const bulkPublishingRef =
    useRef(false);

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
  ] = useState([]);

  const [
    inputValue,
    setInputValue,
  ] = useState("");

  const [
    activeFlow,
    setActiveFlow,
  ] = useState(null);

  /*
   * "Cereri primite" (audit 2026-09-23) - setter minim necesar de
   * openVendorQuote()/handleQuoteChoice() (quotes/assistantQuotes.js),
   * reutilizate ca atare. NU e "o a doua sursă de adevăr" - e exact
   * ce AiAssistant.jsx pasează deja acelorași funcții. Valoarea
   * (quoteContext) nu e citită nicăieri în acest wiring minim (doar
   * "Vezi cererea" -> deschidere/citire, fără continuare de
   * ofertă/checkout aici) - nu o destructurăm ca să nu rămână
   * nefolosită.
   */
  const [
    ,
    setQuoteContext,
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
 * EDIT_PRODUCT din chat (intent-ul din vendorIntent.js, conectat mai
 * jos în handleSend) - complet SEPARAT de productDraft (folosit de
 * flow-ul de CREARE, activeVendorView "product-wizard"), ca cele
 * două flow-uri să nu se poată suprascrie una pe alta din greșeală.
 * Reutilizează STRICT VendorProductWizard mode="edit" (aceeași
 * componentă ca CatalogProduse.jsx).
 */
const [
  chatEditDraft,
  setChatEditDraft,
] = useState(null);

const [
  chatEditingProduct,
  setChatEditingProduct,
] = useState(null);

const [
  chatEditCategories,
  setChatEditCategories,
] = useState([]);

const [
  chatEditSaving,
  setChatEditSaving,
] = useState(false);

const [
  chatEditSaveError,
  setChatEditSaveError,
] = useState("");

const [
  chatEditSaveSuccess,
  setChatEditSaveSuccess,
] = useState(null);

const chatEditSavingRef = useRef(false);

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

/*
 * { phase: "clustering" | "analyzing", done, total } - progres
 * incremental afișat în VendorProductBatchWizard cât timp
 * analyzingBatch e true. null = nimic în curs.
 */
const [
  batchProgress,
  setBatchProgress,
] = useState(null);

/*
 * Eroare persistentă (nu window.alert) afișată în pasul "images"
 * al wizard-ului de bulk - ex. gruparea AI a eșuat complet pentru
 * un lot. Fotografiile rămân intacte, vendorul poate reîncerca.
 */
const [
  batchGroupingError,
  setBatchGroupingError,
] = useState("");

/*
 * id-ul grupului editat integral prin VendorProductWizard (faza 2 -
 * editare per produs) - null cât timp vendorul e pe lista de
 * carduri. Un singur editor montat o dată (performanță, cerința
 * #18) - niciodată mai multe simultan.
 */
const [
  editingGroupId,
  setEditingGroupId,
] = useState(null);

const [
  editorAnalyzing,
  setEditorAnalyzing,
] = useState(false);

const [
  editorAnalyzingOrder,
  setEditorAnalyzingOrder,
] = useState(false);

/*
 * Publicare în masă ("Publică produsele pregătite") - separată de
 * saveStatus-ul per grup, doar ca să dezactivăm butonul global cât
 * timp rulează un lot de publicări (protecție dublu-click, cerința
 * #13).
 */
const [
  bulkPublishing,
  setBulkPublishing,
] = useState(false);

/*
 * Rezumat afișat DUPĂ un "Publică produsele pregătite" - cerința
 * #14 ("4 produse publicate / 1 mai are nevoie de modificări").
 * null = niciun rezumat de arătat.
 */
const [
  bulkPublishSummary,
  setBulkPublishSummary,
] = useState(null);

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

/*
 * PRICE_STOCK "Ambele" (audit 2026-09-23) - patch/changes din
 * primul pas (prețul), ținute STRICT cât timp așteptăm și
 * răspunsul pentru stoc (conversationContext.comboStep ===
 * "awaiting-stock"), ca să construim un SINGUR PendingActionCard
 * combinat. Golit imediat ce cardul combinat e arătat sau dacă
 * vendorul renunță/schimbă produsul.
 */
const [
  comboPriceResult,
  setComboPriceResult,
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
    // Embedded (FloatingHub): poziția e deținută/persistată de hub, nu
    // de widget - nimic de scris aici.
    if (embedded) {
      return;
    }

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
  }, [position, embedded]);

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
    // Embedded (FloatingHub): poziția/dimensiunea sunt deținute de hub -
    // widget-ul nu mai are propriul listener de resize.
    if (embedded) {
      return undefined;
    }

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

    /*
     * Tastatura pe mobil (vezi getViewportSize) - pe unele browsere
     * doar visualViewport emite "resize" la deschiderea/închiderea
     * tastaturii, nu window.
     */
    window.visualViewport?.addEventListener(
      "resize",
      handleResize
    );

    return () => {
      window.removeEventListener(
        "resize",
        handleResize
      );

      window.visualViewport?.removeEventListener(
        "resize",
        handleResize
      );
    };
  }, [isOpen, embedded]);

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

  /* =======================================================
     EDIT_PRODUCT din chat - selector lean + editor real.

     Reutilizează STRICT VendorProductWizard mode="edit" (aceeași
     componentă montată de CatalogProduse.jsx / "Produsele mele") -
     niciun editor separat, nicio duplicare de logică de salvare
     (buildProductSavePayload e din services/productEditMapping.js,
     folosit și de CatalogProduse.jsx).

     Selector LEAN: fetchLeanProductList() e exact endpoint-ul din
     "Produsele mele" - fetch full (fetchProductEditDraft) rulează
     DOAR după ce vendorul alege un produs, niciodată pentru toată
     lista.
  ======================================================= */

  /*
   * Carduri compacte (imagine/preț/stoc/status), NU doar butoane
   * text - randate de ProductEditChoiceCard din AssistantMessage.jsx
   * (discriminator: productEdit === true). Câmpurile vin STRICT din
   * fetchLeanProductList (GET /api/vendor/catalog/products), același
   * endpoint ca "Produsele mele" - niciun fetch suplimentar per
   * card.
   */
  function buildEditProductChoices(products) {
    return products.map((product) => ({
      id: product.id || product._id,
      label: product.title || "Produs fără titlu",

      productEdit: true,

      image: toProductPreviewImage(product),
      priceCents: toPriceCentsFromProduct(product),
      currency: product.currency || "RON",

      stock: product.stock ?? null,
      availability: product.availability || null,

      active: product.active !== false,
      hidden: !!product.hidden,
    }));
  }

  async function openEditProductSelector(
    productNameHint = null,
    { narrow = false } = {}
  ) {
    setShowMenu(false);

    try {
      const products =
        await fetchLeanProductList();

      if (!products.length) {
        addMessage(
          createMessage(
            "assistant",
            "Nu am găsit niciun produs în catalogul tău. Poți începe prin a adăuga unul."
          )
        );

        return;
      }

      const hint = String(
        productNameHint || ""
      )
        .trim()
        .toLowerCase();

      const matches = hint
        ? products.filter((product) =>
            String(product.title || "")
              .toLowerCase()
              .includes(hint)
          )
        : [];

      /*
       * Nume clar, un singur produs potrivit -> intrăm direct în
       * quick actions conversaționale pentru el, fără să mai cerem
       * confirmarea din listă.
       */
      if (hint && matches.length === 1) {
        if (narrow) {
          presentPriceStockQuickActions(matches[0]);
        } else {
          presentProductQuickActions(matches[0]);
        }

        return;
      }

      const candidates =
        hint && matches.length > 0
          ? matches
          : products;

      addMessage(
        createMessage(
          "assistant",

          hint && !matches.length
            ? `Nu am găsit un produs numit „${productNameHint}”. Alege din lista ta:`
            : hint
              ? `Am găsit mai multe produse care se potrivesc cu „${productNameHint}”. Care dintre ele?`
              : "Ce produs vrei să editezi?",

          {
            type: "choices",

            choiceStep: narrow
              ? "price-stock-product-select"
              : "edit-product-select",

            choices:
              buildEditProductChoices(
                candidates
              ),
          }
        )
      );
    } catch (error) {
      addMessage(
        createMessage(
          "assistant",

          error?.message ||
            "Nu am putut încărca produsele tale."
        )
      );
    }
  }

  async function openEditProductForId(
    productId
  ) {
    try {
      const [
        { full, draft },
        categories,
      ] = await Promise.all([
        fetchProductEditDraft(
          productId
        ),
        fetchProductCategories(),
      ]);

      setChatEditingProduct(full);
      setChatEditDraft(draft);
      setChatEditCategories(categories);
      setChatEditSaveError("");
      setChatEditSaveSuccess(null);

      setActiveVendorView(
        "product-edit-wizard"
      );

      addMessage(
        createMessage(
          "assistant",
          `Am deschis „${full.title || "produsul"}” pentru editare.`
        )
      );
    } catch (error) {
      addMessage(
        createMessage(
          "assistant",

          error?.message ||
            "Nu am putut încărca produsul pentru editare."
        )
      );
    }
  }

  /* =======================================================
     EDIT_PRODUCT din chat - quick actions conversaționale.

     Unifică cele două mecanisme deja existente:
     - selectorul lean de produse de mai sus (imagine/preț/stoc);
     - modul conversațional PRODUCT_UPDATE (conversationContext,
       resolvedProductPreview, handleCostingAssistantCommand,
       PendingActionCard din processCostingCommandResult) - folosit
       până acum DOAR din text liber ("schimbă prețul la 85 lei").

     Selectarea unui produs din listă intră ACUM direct în același
     mod PRODUCT_UPDATE, cu productId deja cunoscut - text liber sau
     un quick action pornesc de aici mai departe fără nicio logică
     nouă de salvare (rămâne PendingActionCard -> Confirmă/Renunță
     -> PUT /api/vendors/products/:id, neschimbat).
  ======================================================= */

  function presentProductQuickActions(
    product,
    { intro } = {}
  ) {
    const productId =
      product?.id ||
      product?._id ||
      conversationContext.productId;

    if (!productId) {
      return;
    }

    const title =
      product?.title ||
      product?.label ||
      resolvedProductPreview?.title ||
      "produsul selectat";

    setResolvedProductPreview({
      title,

      image:
        toProductPreviewImage(product) ??
        resolvedProductPreview?.image ??
        null,

      priceCents:
        toPriceCentsFromProduct(product) ??
        resolvedProductPreview?.priceCents ??
        null,
    });

    setConversationContext((current) => ({
      ...current,
      mode: "PRODUCT_UPDATE",
      productId,
      awaitingField: null,
      productUpdateDraft: null,
      priceStockNarrow: false,
      comboStep: null,
    }));

    addMessage(
      createMessage(
        "assistant",

        intro ||
          `Am selectat „${title}”. Ce dorești să modifici?`,

        {
          type: "choices",
          choiceStep: "product-quick-action",
          choices: PRODUCT_QUICK_ACTIONS,
        }
      )
    );
  }

  /* =======================================================
     PRICE_STOCK din chat (audit 2026-09-23) - mirror ÎNGUST al
     presentProductQuickActions() de mai sus: ACEEAȘI stare
     (resolvedProductPreview, conversationContext.mode/productId),
     dar meniul arătat e PRICE_STOCK_QUICK_ACTIONS (4 opțiuni), nu
     PRODUCT_QUICK_ACTIONS (10). Păstrează și availability/stock din
     produsul lean, pentru textul "Disponibilitate actuală: ...".
  ======================================================= */

  function presentPriceStockQuickActions(
    product,
    { intro } = {}
  ) {
    const productId =
      product?.id ||
      product?._id ||
      conversationContext.productId;

    if (!productId) {
      return;
    }

    const title =
      product?.title ||
      product?.label ||
      resolvedProductPreview?.title ||
      "produsul selectat";

    setResolvedProductPreview({
      title,

      image:
        toProductPreviewImage(product) ??
        resolvedProductPreview?.image ??
        null,

      priceCents:
        toPriceCentsFromProduct(product) ??
        resolvedProductPreview?.priceCents ??
        null,

      availability:
        product?.availability ??
        resolvedProductPreview?.availability ??
        null,

      stock:
        product?.stock ??
        resolvedProductPreview?.stock ??
        null,
    });

    setConversationContext((current) => ({
      ...current,
      mode: "PRODUCT_UPDATE",
      productId,
      awaitingField: null,
      productUpdateDraft: null,
      priceStockNarrow: true,
      comboStep: null,
    }));

    setComboPriceResult(null);

    addMessage(
      createMessage(
        "assistant",

        intro || `Ai ales: „${title}”. Ce vrei să modifici?`,

        {
          type: "choices",
          choiceStep: "price-stock-quick-action",
          choices: PRICE_STOCK_QUICK_ACTIONS,
        }
      )
    );
  }

  /*
   * Click pe un quick action - câmpurile simple (title/description/
   * price/category) intră STRICT în mecanismul deja existent
   * "needs_field" (awaitingField cunoscut, productId cunoscut) -
   * răspunsul următor al vendorului merge la orchestrator cu
   * pendingContext, EXACT ca înainte. Stoc/Altceva rămân cu
   * awaitingField null (composite/liber), dar productId tot ajunge
   * la orchestrator - vezi relaxarea din handleCostingAssistantCommand.
   * Imagini/variante/personalizare/editor complet deschid STRICT
   * wizard-ul complet, cu produsul deja încărcat.
   */
  async function handleProductQuickAction(
    choiceId
  ) {
    const productId =
      conversationContext.productId;

    if (!productId) {
      addMessage(
        createMessage(
          "assistant",
          "Nu mai știu despre ce produs vorbeam. Alege din nou produsul."
        )
      );

      await openEditProductSelector();

      return;
    }

    if (
      PRODUCT_FULL_EDITOR_ACTIONS.has(
        choiceId
      )
    ) {
      await openEditProductForId(productId);

      return;
    }

    const field =
      PRODUCT_QUICK_ACTION_FIELD_MAP[
        choiceId
      ] || null;

    const prompt =
      PRODUCT_QUICK_ACTION_PROMPTS[
        choiceId
      ] ||
      "Spune-mi ce vrei să modific.";

    setConversationContext((current) => ({
      ...current,
      mode: "PRODUCT_UPDATE",
      productId,
      awaitingField: field,
      productUpdateDraft: null,
    }));

    addMessage(
      createMessage(
        "assistant",
        prompt
      )
    );
  }

  /*
   * PRICE_STOCK din chat (audit 2026-09-23) - click pe una din cele
   * 4 opțiuni ale meniului restrâns (PRICE_STOCK_QUICK_ACTIONS).
   * "Preț" și "Stoc" refolosesc STRICT același mecanism ca la
   * EDIT_PRODUCT (awaitingField "price" / compus pentru stoc) - doar
   * textul întrebării arată explicit valoarea ACTUALĂ înainte de a
   * cere valoarea nouă. "Ambele" pornește o colectare secvențială
   * (preț, apoi stoc) - vezi interceptarea din
   * handleCostingAssistantCommand pentru cum se combină cele două
   * răspunsuri într-un SINGUR PendingActionCard.
   */
  async function handlePriceStockQuickAction(
    choiceId
  ) {
    const productId =
      conversationContext.productId;

    if (!productId) {
      addMessage(
        createMessage(
          "assistant",
          "Nu mai știu despre ce produs vorbeam. Alege din nou produsul."
        )
      );

      await openEditProductSelector(null, {
        narrow: true,
      });

      return;
    }

    if (choiceId === "change-product") {
      setResolvedProductPreview(null);
      setComboPriceResult(null);

      setConversationContext(
        EMPTY_CONVERSATION_CONTEXT
      );

      await openEditProductSelector(null, {
        narrow: true,
      });

      return;
    }

    const currentPriceLabel =
      resolvedProductPreview?.priceCents != null
        ? formatRonFromCents(
            resolvedProductPreview.priceCents
          )
        : "necunoscut";

    const availabilityLabel = describeAvailability(
      resolvedProductPreview
    );

    if (choiceId === "price") {
      setConversationContext((current) => ({
        ...current,
        mode: "PRODUCT_UPDATE",
        productId,
        awaitingField: "price",
        productUpdateDraft: null,
        comboStep: null,
      }));

      addMessage(
        createMessage(
          "assistant",
          `Prețul actual este ${currentPriceLabel}. Care este noul preț?`
        )
      );

      return;
    }

    if (choiceId === "stock") {
      setConversationContext((current) => ({
        ...current,
        mode: "PRODUCT_UPDATE",
        productId,
        awaitingField: null,
        productUpdateDraft: null,
        comboStep: null,
      }));

      addMessage(
        createMessage(
          "assistant",

          `Disponibilitate actuală: ${availabilityLabel}. Ce vrei să modific? ` +
            `(ex: „mai am 5 bucăți”, „disponibil doar la comandă, termen 5 zile”, ` +
            `„precomandă, livrare din 12 martie” sau „stoc epuizat”)`
        )
      );

      return;
    }

    if (choiceId === "both") {
      setComboPriceResult(null);

      setConversationContext((current) => ({
        ...current,
        mode: "PRODUCT_UPDATE",
        productId,
        awaitingField: "price",
        productUpdateDraft: null,
        comboStep: "awaiting-price",
      }));

      addMessage(
        createMessage(
          "assistant",

          `Prețul actual este ${currentPriceLabel}. Care este noul preț? ` +
            `(după preț, te întreb și despre stoc/disponibilitate)`
        )
      );

      return;
    }
  }

  /*
   * Quick actions arătate DUPĂ o modificare salvată cu succes (vezi
   * handleConfirmPendingCostingAction, action.kind === "UPDATE_PRODUCT") -
   * vendorul rămâne pe același produs în loc să fie resetat la
   * modul NORMAL.
   */
  async function handleProductFollowUpChoice(
    choiceLabel
  ) {
    /*
     * PRICE_STOCK (audit 2026-09-23) - dacă venim din fluxul
     * restrâns, "Mai modific ceva"/"Alege alt produs" trebuie să
     * ducă tot la meniul restrâns, nu la cel general (10 opțiuni).
     * Citit ÎNAINTE de orice reset de context (EMPTY_CONVERSATION_CONTEXT
     * ar șterge flag-ul).
     */
    const wasPriceStockNarrow =
      conversationContext.priceStockNarrow;

    if (
      choiceLabel ===
      "Mai modific ceva la acest produs"
    ) {
      const presenter = wasPriceStockNarrow
        ? presentPriceStockQuickActions
        : presentProductQuickActions;

      presenter(
        {
          id: conversationContext.productId,
          title: resolvedProductPreview?.title,
          image: resolvedProductPreview?.image,
          priceCents:
            resolvedProductPreview?.priceCents,
          availability:
            resolvedProductPreview?.availability,
          stock: resolvedProductPreview?.stock,
        },
        {
          intro: wasPriceStockNarrow
            ? `Ce altceva vrei să modific la „${
                resolvedProductPreview?.title ||
                "produs"
              }”?`
            : `Ce altceva dorești să modific la „${
                resolvedProductPreview?.title ||
                "produs"
              }”?`,
        }
      );

      return;
    }

    if (choiceLabel === "Alege alt produs") {
      setResolvedProductPreview(null);
      setComboPriceResult(null);

      setConversationContext(
        EMPTY_CONVERSATION_CONTEXT
      );

      await openEditProductSelector(null, {
        narrow: wasPriceStockNarrow,
      });

      return;
    }

    if (
      choiceLabel ===
      "Deschide editorul complet"
    ) {
      if (conversationContext.productId) {
        await openEditProductForId(
          conversationContext.productId
        );
      }

      return;
    }

    if (choiceLabel === "Înapoi la Produse") {
      setResolvedProductPreview(null);

      setConversationContext(
        EMPTY_CONVERSATION_CONTEXT
      );

      setActiveFlow(null);
      setActiveVendorView("conversation");
      setCurrentMenu(
        VENDOR_MENU_IDS.PRODUCTS
      );
      setShowMenu(true);
    }
  }

  function closeChatEditProduct() {
    if (chatEditSaving) {
      return;
    }

    setActiveVendorView(
      "conversation"
    );

    setChatEditingProduct(null);
    setChatEditDraft(null);
  }

  async function handleSaveChatEditProduct(
    event
  ) {
    event?.preventDefault?.();

    if (chatEditSavingRef.current) {
      return false;
    }

    const id =
      chatEditingProduct?.id ||
      chatEditingProduct?._id ||
      chatEditDraft?.id;

    if (!id) {
      setChatEditSaveError(
        "Produsul nu a fost identificat."
      );

      return false;
    }

    const title = String(
      chatEditDraft?.title || ""
    ).trim();

    const description =
      chatEditDraft?.description || "";

    const numericPrice = Number(
      String(
        chatEditDraft?.price ?? ""
      ).replace(",", ".")
    );

    if (!title) {
      setChatEditSaveError(
        "Titlul produsului este obligatoriu."
      );

      return false;
    }

    if (
      chatEditDraft?.orderMode !==
        "QUOTE_ONLY" &&
      (
        !Number.isFinite(
          numericPrice
        ) ||
        numericPrice < 0
      )
    ) {
      setChatEditSaveError(
        "Introdu un preț valid."
      );

      return false;
    }

    chatEditSavingRef.current = true;
    setChatEditSaving(true);
    setChatEditSaveError("");

    try {
      const payload =
        buildProductSavePayload(
          chatEditDraft,
          {
            title,
            description,
            numericPrice,
          }
        );

      const response =
        await fetch(
          `/api/vendors/products/${encodeURIComponent(id)}`,
          {
            method: "PUT",

            credentials: "include",

            headers: {
              "Content-Type":
                "application/json",
              Accept:
                "application/json",
            },

            body: JSON.stringify(
              payload
            ),
          }
        );

      let saved = null;

      try {
        saved =
          await response.json();
      } catch {
        saved = null;
      }

      if (!response.ok) {
        throw new Error(
          saved?.message ||
            saved?.error ||
            "Nu am putut salva produsul."
        );
      }

      try {
        window.dispatchEvent(
          new CustomEvent(
            "vendor:productUpdated",
            {
              detail: {
                product: saved,
              },
            }
          )
        );
      } catch {
        // noop
      }

      setChatEditingProduct(saved);

      setChatEditSaveSuccess({
        productId: id,
        title: saved?.title || title,
      });

      return true;
    } catch (error) {
      setChatEditSaveError(
        error?.message ||
          "Nu am putut salva produsul."
      );

      return false;
    } finally {
      setChatEditSaving(false);
      chatEditSavingRef.current = false;
    }
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
  setBatchProgress(null);
  setBatchGroupingError("");
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
          `Categorie: ${getCanonicalLabel("category", analysis.category)}`,

        analysis?.materialMain &&
          `Material principal: ${getCanonicalLabel("materialMain", analysis.materialMain)}`,

        analysis?.technique &&
          `Tehnică: ${getCanonicalLabel("technique", analysis.technique)}`,

        analysis?.color &&
          `Culoare: ${getCanonicalLabel("color", analysis.color)}`,

        Array.isArray(analysis?.styleTags) &&
          analysis.styleTags.length > 0 &&
          `Stil: ${analysis.styleTags
            .map((tag) => getCanonicalLabel("styleTags", tag))
            .join(", ")}`,

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

    /*
     * ACTIONABLE RECOMMENDATIONS (VENDOR_INSIGHTS) - prezent DOAR
     * pe rezultate cu `insights` (handleVendorInsightsQuery/
     * handleInsightFollowUp din copilotRouter.js) - orice alt tip
     * de rezultat nu are acest câmp, deci insightChoices rămâne gol
     * și mesajul se creează exact ca înainte (text simplu).
     */
    const insightChoices = buildVendorInsightChoices(
      result?.insights
    );

    addMessage(
      createMessage(
        "assistant",

        result?.message ||
          "Am procesat cererea.",

        insightChoices.length
          ? {
              type: "choices",
              choiceStep: "vendor-insight-action",
              choices: insightChoices,
            }
          : {}
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

    /*
     * BUGFIX (verificare finală EDIT_PRODUCT conversațional): NU
     * resetăm contextul produsului chiar înainte să afișăm cardul
     * de confirmare pentru UPDATE_PRODUCT - altfel "Renunță" (care
     * nu mai are ce restaura) pierde produsul selectat din quick
     * actions. Pentru orice alt rezultat (inclusiv alte kind-uri de
     * pending_action, dacă ar apărea vreodată cât timp mode e
     * PRODUCT_UPDATE), comportamentul rămâne EXACT cel de dinainte.
     */
    const isPendingUpdateProductAction =
      result?.resultType === "pending_action" &&
      result?.pendingAction?.kind ===
        "UPDATE_PRODUCT";

    if (
      conversationContext.mode === "PRODUCT_UPDATE" &&
      !isPendingUpdateProductAction
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
              conversationContext.productId
            ? {
                /*
                 * BUGFIX: productId trimis ca hint chiar și fără un
                 * awaitingField specific (ex. quick action "Stocul /
                 * disponibilitatea" sau "Altceva", sau o continuare
                 * liberă după o salvare - "schimbă și descrierea")
                 * - ruta /assistant/command tolerează deja
                 * missingField gol (vezi rawPendingContext.productId
                 * ca singură condiție), așa că orchestratorul știe
                 * despre ce produs e vorba fără să mai ceară numele
                 * din nou. Cazul EXISTENT (awaitingField cunoscut,
                 * ex. "care e noul preț?") rămâne identic.
                 */
                commandType: "UPDATE_PRODUCT",
                productId:
                  conversationContext.productId,
                missingField:
                  conversationContext.awaitingField ||
                  "",
              }
            : null;

      const result = await sendAssistantCommand({
        message: text,
        history,
        pendingContext,
      });

      /*
       * PRICE_STOCK "Ambele" (audit 2026-09-23) - colectare
       * secvențială preț -> stoc, combinate într-un SINGUR
       * PendingActionCard. NU inventăm extragere/parsare nouă -
       * fiecare pas trece prin EXACT același orchestrator ca un
       * quick-action simplu (awaitingField "price", apoi compus
       * pentru stoc); doar rezultatul primului pas e ținut aici și
       * combinat cu al doilea (action.patch/action.changes au deja
       * shape-ul potrivit, vezi PendingActionCard.jsx -
       * UpdateProductBody, care randează action.changes ca listă,
       * indiferent de câte elemente are).
       *
       * Dacă orchestratorul NU întoarce pending_action pentru acest
       * pas (ex. preț invalid -> needs_field/eroare), cade la
       * processCostingCommandResult normal mai jos - vendorul e
       * re-întrebat, comboStep rămâne neschimbat (păstrat prin
       * spread în toate ramurile din processCostingCommandResult),
       * deci colectarea continuă corect la următorul răspuns.
       */
      if (
        conversationContext.comboStep ===
          "awaiting-price" &&
        result?.resultType === "pending_action" &&
        result?.pendingAction?.kind ===
          "UPDATE_PRODUCT"
      ) {
        setComboPriceResult({
          patch: result.pendingAction.patch || {},
          changes:
            result.pendingAction.changes || [],
        });

        const availabilityLabel =
          describeAvailability(
            resolvedProductPreview
          );

        setConversationContext((current) => ({
          ...current,
          mode: "PRODUCT_UPDATE",
          productId:
            result.pendingAction.productId ||
            current.productId,
          awaitingField: null,
          productUpdateDraft: null,
          comboStep: "awaiting-stock",
        }));

        addMessage(
          createMessage(
            "assistant",

            `Am notat noul preț. Disponibilitate actuală: ${availabilityLabel}. ` +
              `Ce vrei să modific la stoc/disponibilitate? ` +
              `(ex: „mai am 5 bucăți”, „disponibil doar la comandă, termen 5 zile”, ` +
              `„precomandă, livrare din 12 martie” sau „stoc epuizat”)`
          )
        );

        return;
      }

      if (
        conversationContext.comboStep ===
          "awaiting-stock" &&
        result?.resultType === "pending_action" &&
        result?.pendingAction?.kind ===
          "UPDATE_PRODUCT"
      ) {
        const mergedAction = {
          ...result.pendingAction,

          patch: {
            ...(comboPriceResult?.patch || {}),
            ...(result.pendingAction.patch || {}),
          },

          changes: [
            ...(comboPriceResult?.changes || []),
            ...(result.pendingAction.changes || []),
          ],
        };

        setPendingCostingAction(mergedAction);
        setPendingCostingActionError("");
        setComboPriceResult(null);

        setConversationContext((current) => ({
          ...current,
          comboStep: null,
        }));

        return;
      }

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

        /*
         * BUGFIX: rămânem pe ACELAȘI produs după o salvare reușită
         * (nu resetăm la modul NORMAL) - vendorul poate continua
         * natural ("acum pune și stocul 4") sau alege una din
         * quick actions de mai jos, fără să reselecteze produsul.
         */
        setResolvedProductPreview({
          title:
            updated?.title ||
            action.productTitle,

          image:
            toProductPreviewImage(updated) ??
            resolvedProductPreview?.image ??
            null,

          priceCents:
            toPriceCentsFromProduct(updated) ??
            resolvedProductPreview?.priceCents ??
            null,

          availability:
            updated?.availability ??
            resolvedProductPreview?.availability ??
            null,

          stock:
            updated?.stock ??
            updated?.readyQty ??
            resolvedProductPreview?.stock ??
            null,
        });

        setConversationContext((current) => ({
          ...current,
          mode: "PRODUCT_UPDATE",
          productId: action.productId,
          awaitingField: null,
          productUpdateDraft: null,
        }));

        /*
         * PRICE_STOCK (audit 2026-09-23) - mesaj + meniu de
         * follow-up DIFERITE pentru fluxul restrâns, EXACT cum a
         * cerut vendorul ("Produsul a fost actualizat.", fără
         * "Deschide editorul complet" ca opțiune implicită). Fluxul
         * EDIT_PRODUCT general rămâne NESCHIMBAT.
         */
        addMessage(
          createMessage(
            "assistant",

            conversationContext.priceStockNarrow
              ? "Produsul a fost actualizat."
              : `Am actualizat „${action.productTitle}”: ${action.summary}.`,

            {
              type: "choices",
              choiceStep: "product-update-followup",

              choices:
                conversationContext.priceStockNarrow
                  ? PRICE_STOCK_UPDATE_FOLLOWUP_CHOICES
                  : PRODUCT_UPDATE_FOLLOWUP_CHOICES,
            }
          )
        );
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

    /*
     * În modul embedded, `isOpen` de mai sus nu controlează nimic
     * vizual (vezi `(embedded || isOpen)` mai jos) - fără acest apel,
     * X-ul rămânea fără efect. FloatingHub ține state-ul real.
     */
    if (embedded) {
      onClose?.();
    }
  }

  function resetConversation() {
    clearUploadedImages();

    setMessages([]);

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

setBatchProgress(null);
setBatchGroupingError("");
setEditingGroupId(null);
setEditorAnalyzing(false);
setEditorAnalyzingOrder(false);
setBulkPublishing(false);
setBulkPublishSummary(null);

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

  // eslint-disable-next-line no-unused-vars -- butonul din header a fost scos (simplificare header), rămâne apelabilă din alte puncte de intrare ale meniului
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
     "Cereri primite" (audit 2026-09-23)

     Conectare reală: fetchVendorQuotes() (GET /api/vendor/quotes,
     DEJA existent, reutilizat ca atare) -> sortare/limitare pură
     (vendorQuoteLeadCards.js) -> primele 3-5 cereri ca "choices" cu
     `quote` atașat, randate de QuoteChoiceCard din
     AssistantMessage.jsx (DEJA existent, neatins). Click pe card ->
     handleChoice mai jos -> handleQuoteChoice() -> openVendorQuote()
     (DEJA existent) -> detaliu + conversație + mark-as-read prin
     PATCH /api/vendor/quotes/:id/read (logica existentă, neschimbată).
  ======================================================= */

  async function openVendorQuoteLeads() {
    const loadingId =
      `${Date.now()}-vendor-quote-leads-loading`;

    addMessage({
      id: loadingId,
      role: "assistant",
      type: "loading",
      content:
        "Încarc cererile primite...",
    });

    try {
      const result =
        await fetchVendorQuotes();

      const quotes =
        normalizeVendorQuoteList(
          result
        );

      removeLoadingMessages();

      setActiveFlow(
        QUOTE_FLOWS.VENDOR_QUOTES
      );

      if (!quotes.length) {
        addMessage(
          createMessage(
            "assistant",
            "Nu ai cereri noi momentan."
          )
        );

        return;
      }

      const cards =
        buildVendorQuoteLeadCards(
          quotes,
          5
        );

      addMessage(
        createMessage(
          "assistant",
          "Cererile tale recente:",
          {
            type:
              "choices",

            choiceStep:
              "vendor-quote-leads",

            choices:
              cards,
          }
        )
      );
    } catch (error) {
      removeLoadingMessages();

      addMessage(
        createMessage(
          "assistant",

          humanizeAssistantErrorMessage(
            error,
            "Nu am putut încărca cererile primite."
          ),
          {
            type:
              "choices",

            choiceStep:
              "vendor-quote-leads-error",

            choices: [
              {
                id:
                  "retry-vendor-quote-leads",

                action:
                  "retry-vendor-quote-leads",

                title:
                  "Reîncearcă",

                label:
                  "Reîncearcă",
              },
            ],
          }
        )
      );
    }
  }

  /* =======================================================
     "Comenzile magazinului" (audit 2026-09-23)

     Read-only strict: GET /api/vendor/orders (pageSize=20, ca
     prioritatea pe status să aibă din ce alege, nu doar ultimele 5
     create) + GET /api/vendor/orders/thread-meta pentru unread
     (identic Orders.jsx). Sortare/limitare pură
     (vendorOrderLeadCards.js) -> primele 5, randate ca "choices" cu
     `vendorOrder: true`, randate de VendorOrderChoiceCard din
     AssistantMessage.jsx (nou, dar reutilizează clasele CSS
     quoteChoice* existente). Click pe card -> handleChoice mai jos ->
     navigare directă la /vendor/orders/:id (OrdersDetailsPage,
     existentă) - NICIO acțiune de scriere (fără schimbare de status)
     în acest prim pas.
  ======================================================= */

  async function openVendorOrderLeads() {
    const loadingId =
      `${Date.now()}-vendor-order-leads-loading`;

    addMessage({
      id: loadingId,
      role: "assistant",
      type: "loading",
      content:
        "Încarc comenzile...",
    });

    try {
      const result =
        await api(
          "/api/vendor/orders?pageSize=20"
        );

      const orders =
        normalizeVendorOrderList(
          result
        );

      let ordersWithMeta =
        orders;

      if (orders.length) {
        try {
          const orderIds =
            orders
              .map(
                (o) => o.id
              )
              .filter(
                Boolean
              )
              .join(
                ","
              );

          const meta =
            await api(
              `/api/vendor/orders/thread-meta?orderIds=${orderIds}`
            );

          ordersWithMeta =
            mergeVendorOrderThreadMeta(
              orders,
              meta || {}
            );
        } catch {
          /*
           * Non-blocant, la fel ca în Orders.jsx: badge-ul de
           * necitite rămâne 0 dacă acest apel eșuează, restul
           * cardului funcționează normal.
           */
        }
      }

      removeLoadingMessages();

      setActiveFlow(
        VENDOR_ACTION_IDS.ORDERS
      );

      /*
       * Gate de facturare (DEJA existent în răspunsul rutei reale) -
       * dacă vendorul nu poate vedea comenzile fără să completeze
       * datele de facturare, arătăm EXACT mesajul/CTA-ul venit din
       * backend, nu "Nu ai comenzi momentan." (ar fi înșelător -
       * vendorul chiar are comenzi, doar nu le poate vedea încă).
       */
      if (result?.billingRequired) {
        const gate =
          result.billingGate ||
          {};

        addMessage(
          createMessage(
            "assistant",

            gate.message ||
              "Completează datele de facturare pentru a vedea comenzile.",

            gate.cta
              ? {
                  type:
                    "choices",

                  choiceStep:
                    "vendor-order-leads-billing",

                  choices: [
                    {
                      id:
                        "vendor-order-leads-billing-cta",

                      action:
                        "navigate-vendor-billing-settings",

                      title:
                        gate.cta
                          .label ||
                        "Completează datele de facturare",

                      label:
                        gate.cta
                          .label ||
                        "Completează datele de facturare",

                      url:
                        gate.cta
                          .url ||
                        "/setari?tab=billing",
                    },
                  ],
                }
              : undefined
          )
        );

        return;
      }

      if (!ordersWithMeta.length) {
        addMessage(
          createMessage(
            "assistant",
            "Nu ai comenzi momentan."
          )
        );

        return;
      }

      const cards =
        buildVendorOrderLeadCards(
          ordersWithMeta,
          5
        );

      addMessage(
        createMessage(
          "assistant",
          "Comenzile tale recente:",
          {
            type:
              "choices",

            choiceStep:
              "vendor-order-leads",

            choices:
              cards,
          }
        )
      );
    } catch (error) {
      removeLoadingMessages();

      addMessage(
        createMessage(
          "assistant",

          humanizeAssistantErrorMessage(
            error,
            "Nu am putut încărca comenzile."
          ),
          {
            type:
              "choices",

            choiceStep:
              "vendor-order-leads-error",

            choices: [
              {
                id:
                  "retry-vendor-order-leads",

                action:
                  RETRY_VENDOR_ORDER_LEADS_ACTION,

                title:
                  "Reîncearcă",

                label:
                  "Reîncearcă",
              },
            ],
          }
        )
      );
    }
  }

  /* =======================================================
     "Magazinul meu" (audit 2026-09-23)

     Click simplu -> UN SINGUR apel, minim necesar (slug/serviceId/
     status activ pentru cele 4 opțiuni) - GET /api/vendors/me/
     dashboard, DEJA existent. Fără produse/cereri/comenzi aici.

     "Îmbunătățește magazinul" -> abia atunci (openVendorStoreImprove)
     se încarcă datele suplimentare (billing, produse, cereri,
     comenzi noi) - vezi mai jos.
  ======================================================= */

  async function openVendorStoreMenu() {
    const loadingId =
      `${Date.now()}-vendor-store-menu-loading`;

    addMessage({
      id: loadingId,
      role: "assistant",
      type: "loading",
      content:
        "Verific magazinul tău...",
    });

    try {
      const dashboard =
        await api(
          "/api/vendors/me/dashboard"
        );

      removeLoadingMessages();

      const service =
        Array.isArray(
          dashboard?.services
        ) &&
        dashboard.services
          .length
          ? dashboard
              .services[0]
          : null;

      const slug =
        service?.profile
          ?.slug ||
        null;

      const serviceId =
        service?.id ||
        null;

      const isActive =
        Boolean(
          service?.isActive
        );

      const greeting =
        isActive
          ? "Magazinul tău este activ. Ce vrei să faci?"
          : "Magazinul tău este inactiv momentan. Ce vrei să faci?";

      addMessage(
        createMessage(
          "assistant",
          greeting,
          {
            type:
              "choices",

            choiceStep:
              "vendor-store-menu",

            choices: [
              {
                id:
                  "vendor-store-view",

                action:
                  "view-store",

                title:
                  "Vezi magazinul",

                label:
                  "Vezi magazinul",

                slug,
              },

              {
                id:
                  "vendor-store-improve",

                action:
                  "improve-store",

                title:
                  "Îmbunătățește magazinul",

                label:
                  "Îmbunătățește magazinul",

                dashboard,
                slug,
                serviceId,
              },

              {
                id:
                  "vendor-store-edit",

                action:
                  "edit-store",

                title:
                  "Editează magazinul",

                label:
                  "Editează magazinul",

                serviceId,
              },

              {
                id:
                  "vendor-store-products",

                action:
                  "edit-products",

                title:
                  "Produsele mele",

                label:
                  "Produsele mele",
              },
            ],
          }
        )
      );
    } catch (error) {
      removeLoadingMessages();

      addMessage(
        createMessage(
          "assistant",

          humanizeAssistantErrorMessage(
            error,
            "Nu am putut încărca datele magazinului."
          ),
          {
            type:
              "choices",

            choiceStep:
              "vendor-store-menu-error",

            choices: [
              {
                id:
                  "retry-vendor-store-menu",

                action:
                  "retry-vendor-store-menu",

                title:
                  "Reîncearcă",

                label:
                  "Reîncearcă",
              },
            ],
          }
        )
      );
    }
  }

  /*
   * Mapare prioritate internă (HIGH/MEDIUM/LOW, vezi
   * vendorStoreLeadRules.js) -> tipul vizual deja existent pe
   * cardurile quoteChoice* (fără culoare nouă): HIGH pe accentul
   * "new" (cel mai vizibil), MEDIUM pe "discussion", LOW pe
   * "pending" (neutru).
   */
  function vendorStorePriorityType(
    priority
  ) {
    if (priority === "HIGH")
      return "new";

    if (
      priority === "MEDIUM"
    )
      return "discussion";

    return "pending";
  }

  function buildVendorStoreSuggestionChoice(
    suggestion,
    { serviceId }
  ) {
    return {
      id: suggestion.id,
      vendorStoreSuggestion: true,

      label:
        suggestion.title,

      title:
        suggestion.title,

      description: `${suggestion.reason} · ${suggestion.cta.label}`,

      priorityType:
        vendorStorePriorityType(
          suggestion.priority
        ),

      cta: suggestion.cta,
      serviceId,
    };
  }

  async function openVendorStoreImprove(
    dashboard,
    slug,
    serviceId
  ) {
    const loadingId =
      `${Date.now()}-vendor-store-improve-loading`;

    addMessage({
      id: loadingId,
      role: "assistant",
      type: "loading",
      content:
        "Analizez magazinul tău...",
    });

    try {
      const [
        billingResult,
        productsResult,
        quotesResult,
        ordersResult,
      ] =
        await Promise.allSettled(
          [
            api(
              "/api/vendors/me/billing"
            ),

            slug
              ? api(
                  `/api/vendor/store/${encodeURIComponent(
                    slug
                  )}/products?take=200`
                )
              : Promise.resolve(
                  {
                    items: [],
                  }
                ),

            fetchVendorQuotes(),

            api(
              "/api/vendor/orders?status=new&pageSize=1"
            ),
          ]
        );

      const billing =
        billingResult.status ===
        "fulfilled"
          ? billingResult
              .value
              ?.billing ||
            null
          : null;

      const products =
        productsResult.status ===
        "fulfilled"
          ? Array.isArray(
              productsResult
                .value
                ?.items
            )
            ? productsResult
                .value
                .items
            : []
          : [];

      const quotes =
        quotesResult.status ===
        "fulfilled"
          ? normalizeVendorQuoteList(
              quotesResult.value
            )
          : [];

      const unansweredQuotesCount =
        quotes.filter(
          (q) =>
            String(
              q?.status ||
                ""
            ).toUpperCase() ===
              "SUBMITTED" &&
            (!Array.isArray(
              q?.offers
            ) ||
              q.offers
                .length ===
                0)
        ).length;

      const newOrdersCount =
        ordersResult.status ===
        "fulfilled"
          ? Number(
              ordersResult
                .value
                ?.total
            ) || 0
          : 0;

      const snapshot =
        buildVendorStoreSnapshot(
          {
            dashboard,
            billing,
            products,
            unansweredQuotesCount,
            newOrdersCount,
          }
        );

      removeLoadingMessages();

      if (
        isVendorStoreComplete(
          snapshot
        )
      ) {
        const perfectChoices = [
          {
            id:
              "vendor-store-add-product-perfect",

            action:
              "add-product",

            title:
              "Adaugă produs",

            label:
              "Adaugă produs",
          },
        ];

        /*
         * "Promovează produse" - inclus DOAR pentru că am confirmat
         * în audit o destinație reală: /vendor/catalog?tab=campaigns
         * (tab-ul Campanii din Catalog produse, existent).
         */
        perfectChoices.push(
          {
            id:
              "vendor-store-promote-perfect",

            action:
              "promote-products",

            title:
              "Promovează produse",

            label:
              "Promovează produse",
          }
        );

        perfectChoices.push(
          {
            id:
              "vendor-store-view-perfect",

            action:
              "view-store",

            title:
              "Vezi magazinul",

            label:
              "Vezi magazinul",

            slug,
          }
        );

        addMessage(
          createMessage(
            "assistant",
            "Magazinul tău este bine configurat. Poți continua cu adăugarea sau promovarea produselor.",
            {
              type:
                "choices",

              choiceStep:
                "vendor-store-perfect",

              choices:
                perfectChoices,
            }
          )
        );

        return;
      }

      const suggestions =
        buildVendorStoreSuggestions(
          snapshot
        );

      const choices =
        suggestions.map(
          (suggestion) =>
            buildVendorStoreSuggestionChoice(
              suggestion,
              {
                serviceId,
              }
            )
        );

      addMessage(
        createMessage(
          "assistant",
          "Câteva lucruri pe care le poți îmbunătăți acum:",
          {
            type:
              "choices",

            choiceStep:
              "vendor-store-suggestions",

            choices,
          }
        )
      );
    } catch (error) {
      removeLoadingMessages();

      addMessage(
        createMessage(
          "assistant",

          humanizeAssistantErrorMessage(
            error,
            "Nu am putut analiza magazinul tău."
          ),
          {
            type:
              "choices",

            choiceStep:
              "vendor-store-improve-error",

            choices: [
              {
                id:
                  "retry-vendor-store-improve",

                action:
                  "retry-vendor-store-improve",

                title:
                  "Reîncearcă",

                label:
                  "Reîncearcă",

                dashboard,
                slug,
                serviceId,
              },
            ],
          }
        )
      );
    }
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
    /*
     * BUGFIX (audit) - click direct pe cardul de meniu "Adaugă produs
     * cu AI" pornea wizard-ul FĂRĂ niciun mesaj de conversație (flow-ul
     * era real, doar tăcut) - calea prin text liber ("vreau să adaug
     * un produs", vezi VENDOR_INTENTS.ADD_PRODUCT mai jos) arăta deja
     * mesajul corect; aici lipsea complet. Același text, un singur
     * loc de adevăr pentru formulare.
     */
    addMessage(
      createMessage(
        "assistant",
        "Sigur. Te ajut să adaugi produsul pas cu pas. Poți începe direct cu fotografiile - AI-ul propune singur titlul și descrierea - sau, dacă nu ai poze acum, poți completa totul manual."
      )
    );

    openAddProductWizard();

    return;
  }

  if (
    actionId ===
    VENDOR_ACTION_IDS.ADD_PRODUCTS_BATCH
  ) {
    /*
     * Reia un import în curs dacă există (persistență, cerința
     * #15/#20) - reset doar dacă nu e nimic de reluat. Ștergerea
     * explicită se face DOAR din "Șterge tot și începe din nou"
     * (handleResetBatch), niciodată implicit la reintrare în meniu.
     */
    const hasInProgressBatch =
      batchImages.length > 0 ||
      batchGroups.length > 0;

    openBatchProductWizard({
      resetBatch: !hasInProgressBatch,
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
   * "Cereri primite" (audit 2026-09-23) - conectare reală, vezi
   * openVendorQuoteLeads() mai sus. Interceptat aici, la fel ca
   * STORE/SHOPPING mai jos, ÎNAINTE de fallback-ul generic
   * startVendorFlow (care nu mai are niciun caz pentru acest id).
   */
  if (
    actionId ===
    VENDOR_ACTION_IDS.RECEIVED_QUOTES
  ) {
    setShowMenu(false);

    await openVendorQuoteLeads();

    return;
  }

  /*
   * "Comenzile magazinului" (audit 2026-09-23) - conectare reală,
   * vezi openVendorOrderLeads() mai sus. Interceptat aici, la fel
   * ca RECEIVED_QUOTES mai sus, ÎNAINTE de fallback-ul generic
   * startVendorFlow (care nu mai are niciun caz pentru acest id).
   */
  if (
    actionId ===
    VENDOR_ACTION_IDS.ORDERS
  ) {
    setShowMenu(false);

    await openVendorOrderLeads();

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

  /*
   * "Magazinul meu" (audit 2026-09-23) - conectare reală, vezi
   * openVendorStoreMenu() mai jos. Interceptat aici, la fel ca
   * RECEIVED_QUOTES/ORDERS mai sus.
   */
  if (
    actionId ===
    VENDOR_ACTION_IDS.STORE
  ) {
    setShowMenu(false);

    await openVendorStoreMenu();

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
     ACTIONABLE RECOMMENDATIONS - navigare sigură pe o recomandare
     (insightsService.js -> navAction). DOAR 3 tipuri, toate deja
     existente în platformă:
     - "route": navighează la o pagină REALĂ (assistantActionRegistry.js);
     - "add-product": deschide wizardul de adăugare produs DEJA
       existent în chat (openAddProductWizard) - vendorul completează
       el însuși, nimic generat/publicat automat;
     - "items": reia EXACT fluxul "arată-mi produsele" deja existent
       (SHOW_DETAIL_RE -> getInsightItemsList în copilotRouter.js),
       fără niciun endpoint/mecanism nou - trimitem activeInsight
       direct (nu depindem de starea din React, care ar fi veche în
       aceeași tură) ca să fim siguri că se cere lista PENTRU insight-ul
       pe care s-a apăsat butonul, nu pentru cel mai sever din ecran.
  ======================================================= */

  async function handleVendorInsightNavAction(choice) {
    const navAction = choice?.navAction;

    if (!navAction) {
      return;
    }

    if (navAction.kind === "route" && navAction.route) {
      navigate(navAction.route);
      return;
    }

    if (navAction.kind === "add-product") {
      openAddProductWizard();
      return;
    }

    if (navAction.kind === "items") {
      setIsSubmitting(true);

      try {
        const result = await sendCopilotAsk({
          message: "arată-mi produsele",
          history: [],

          currentPage: effectivePage,
          currentEntity: resolvedCurrentEntity,

          conversationContext: {
            ...(toGenericConversationContext() || {}),

            activeInsight: {
              type: choice.insightType,
              domain: choice.insightDomain,
              title: choice.label,
              scope: "all",
              suggestedAction: null,
              actionParams: null,
            },
          },
        });

        if (result?.handled) {
          processCostingCommandResult(result);
          return;
        }
      } catch {
        // cade pe mesajul generic de mai jos
      } finally {
        setIsSubmitting(false);
      }

      addMessage(
        createMessage(
          "assistant",
          "Nu am putut încărca lista chiar acum. Încearcă din nou."
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
     * ACTIONABLE RECOMMENDATIONS - CTA de pe o recomandare
     * (vendor-insight-action) - STRICT navigare/reluare a fluxului
     * existent "arată-mi produsele", NICIODATĂ o modificare de
     * produs. Interceptat înaintea oricărei alte ramuri.
     */
    if (
      sourceMessage?.type === "choices" &&
      sourceMessage?.choiceStep === "vendor-insight-action"
    ) {
      await handleVendorInsightNavAction(choice);
      return;
    }

    /*
     * "Cereri primite" (audit 2026-09-23) - "Reîncearcă" de pe cardul
     * de eroare al fetch-ului.
     */
    if (
      choice?.action ===
      "retry-vendor-quote-leads"
    ) {
      await openVendorQuoteLeads();
      return;
    }

    /*
     * "Cereri primite" (audit 2026-09-23) - click pe un card din
     * lista compactă -> handleQuoteChoice() (quotes/assistantQuotes.js,
     * DEJA existent) recunoaște generic choice.quote/activeFlow ===
     * QUOTE_FLOWS.VENDOR_QUOTES și deschide EXACT openVendorQuote()
     * (detaliu + conversație + mark-as-read prin PATCH
     * /api/vendor/quotes/:id/read) - nimic reimplementat aici.
     */
    if (
      sourceMessage?.type === "choices" &&
      sourceMessage?.choiceStep === "vendor-quote-leads"
    ) {
      const quoteHandled =
        await handleQuoteChoice({
          activeFlow,
          choice,
          sourceMessage,

          addMessage,
          createMessage,

          setActiveFlow,
          setQuoteContext,
        });

      if (quoteHandled) {
        return;
      }
    }

    /*
     * "Comenzile magazinului" (audit 2026-09-23) - "Reîncearcă" de pe
     * cardul de eroare al fetch-ului.
     */
    if (
      choice?.action ===
      RETRY_VENDOR_ORDER_LEADS_ACTION
    ) {
      await openVendorOrderLeads();
      return;
    }

    /*
     * "Comenzile magazinului" (audit 2026-09-23) - CTA "Completează
     * datele de facturare" de pe gate-ul de billing (venit STRICT din
     * răspunsul GET /api/vendor/orders, nimic inventat) - navigare
     * directă, nicio logică nouă.
     */
    if (
      choice?.action ===
      "navigate-vendor-billing-settings"
    ) {
      if (choice?.url) {
        window.location.href =
          choice.url;
      }

      return;
    }

    /*
     * "Comenzile magazinului" (audit 2026-09-23) - click pe un card
     * din lista compactă -> navigare DIRECTĂ la pagina reală
     * /vendor/orders/:id (OrdersDetailsPage, existentă) - read-only
     * strict, nicio acțiune de scriere/schimbare de status aici.
     */
    if (
      choice?.vendorOrder ===
      true
    ) {
      const orderId =
        choice.order?.id ||
        choice.id ||
        null;

      if (orderId) {
        window.location.href =
          `/vendor/orders/${orderId}`;
      }

      return;
    }

    /*
     * "Magazinul meu" (audit 2026-09-23) - toate acțiunile din
     * meniul principal + din cardurile de sugestii. Fiecare acțiune
     * de navigare merge STRICT la o rută reală, deja confirmată în
     * audit; fiecare acțiune de flow reutilizează handleAction cu
     * exact același actionId pe care l-ar folosi un click direct pe
     * meniu (zero logică duplicată).
     */

    if (
      choice?.action ===
      "view-store"
    ) {
      if (choice?.slug) {
        window.location.href =
          `/magazin/${choice.slug}`;
      }

      return;
    }

    if (
      choice?.action ===
      "edit-store"
    ) {
      if (
        choice?.serviceId
      ) {
        window.location.href =
          `/onboarding/details?serviceId=${encodeURIComponent(
            choice.serviceId
          )}&tab=profil`;
      }

      return;
    }

    if (
      choice?.action ===
      "edit-products"
    ) {
      await handleAction(
        VENDOR_ACTION_IDS.EDIT_PRODUCT
      );

      return;
    }

    if (
      choice?.action ===
      "add-product"
    ) {
      await handleAction(
        VENDOR_ACTION_IDS.ADD_PRODUCT
      );

      return;
    }

    if (
      choice?.action ===
      "received-quotes"
    ) {
      await handleAction(
        VENDOR_ACTION_IDS.RECEIVED_QUOTES
      );

      return;
    }

    if (
      choice?.action ===
      "vendor-orders"
    ) {
      await handleAction(
        VENDOR_ACTION_IDS.ORDERS
      );

      return;
    }

    if (
      choice?.action ===
      "vendor-billing"
    ) {
      window.location.href =
        "/setari?tab=billing";

      return;
    }

    if (
      choice?.action ===
      "vendor-payouts"
    ) {
      window.location.href =
        "/setari?tab=payouts";

      return;
    }

    if (
      choice?.action ===
      "promote-products"
    ) {
      window.location.href =
        "/vendor/catalog?tab=campaigns";

      return;
    }

    if (
      choice?.action ===
      "improve-store"
    ) {
      await openVendorStoreImprove(
        choice.dashboard,
        choice.slug,
        choice.serviceId
      );

      return;
    }

    if (
      choice?.action ===
      "retry-vendor-store-menu"
    ) {
      await openVendorStoreMenu();
      return;
    }

    if (
      choice?.action ===
      "retry-vendor-store-improve"
    ) {
      await openVendorStoreImprove(
        choice.dashboard,
        choice.slug,
        choice.serviceId
      );

      return;
    }

    /*
     * Click pe un card de sugestie ("Magazinul meu" ->
     * "Îmbunătățește magazinul") - `cta.action` e UNA dintre
     * acțiunile de mai sus (edit-store/add-product/edit-products/
     * vendor-payouts/vendor-billing/received-quotes/vendor-orders),
     * cu `serviceId` deja atașat pe choice pentru "edit-store".
     */
    if (
      choice?.vendorStoreSuggestion ===
      true
    ) {
      const ctaAction =
        choice?.cta?.action;

      if (
        ctaAction ===
        "edit-store"
      ) {
        if (
          choice?.serviceId
        ) {
          window.location.href =
            `/onboarding/details?serviceId=${encodeURIComponent(
              choice.serviceId
            )}&tab=profil`;
        }

        return;
      }

      if (
        ctaAction ===
        "add-product"
      ) {
        await handleAction(
          VENDOR_ACTION_IDS.ADD_PRODUCT
        );

        return;
      }

      if (
        ctaAction ===
        "edit-products"
      ) {
        await handleAction(
          VENDOR_ACTION_IDS.EDIT_PRODUCT
        );

        return;
      }

      if (
        ctaAction ===
        "received-quotes"
      ) {
        await handleAction(
          VENDOR_ACTION_IDS.RECEIVED_QUOTES
        );

        return;
      }

      if (
        ctaAction ===
        "vendor-orders"
      ) {
        await handleAction(
          VENDOR_ACTION_IDS.ORDERS
        );

        return;
      }

      if (
        ctaAction ===
        "vendor-payouts"
      ) {
        window.location.href =
          "/setari?tab=payouts";

        return;
      }

      if (
        ctaAction ===
        "vendor-billing"
      ) {
        window.location.href =
          "/setari?tab=billing";

        return;
      }

      return;
    }

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
     * Selectorul de produse pentru EDIT_PRODUCT (vezi
     * openEditProductSelector) - "choice" e obiectul construit de
     * buildEditProductChoices (imagine/preț/stoc/status incluse).
     * NU mai deschide direct wizard-ul complet - intră în modul
     * conversațional PRODUCT_UPDATE (quick actions), unificat cu
     * fluxul care exista deja pentru text liber.
     */
    if (
      sourceMessage?.type === "choices" &&
      sourceMessage?.choiceStep ===
        "edit-product-select"
    ) {
      presentProductQuickActions(choice);

      return;
    }

    /*
     * PRICE_STOCK (audit 2026-09-23) - mirror ÎNGUST al celor două
     * cazuri de mai sus, pentru selectorul/meniul restrâns.
     */
    if (
      sourceMessage?.type === "choices" &&
      sourceMessage?.choiceStep ===
        "price-stock-product-select"
    ) {
      presentPriceStockQuickActions(choice);

      return;
    }

    if (
      sourceMessage?.type === "choices" &&
      sourceMessage?.choiceStep ===
        "price-stock-quick-action"
    ) {
      await handlePriceStockQuickAction(
        choice?.id
      );

      return;
    }

    /*
     * Quick actions afișate după selectarea produsului (Titlul/
     * Descrierea/Prețul/Stocul/.../Deschide editorul complet).
     */
    if (
      sourceMessage?.type === "choices" &&
      sourceMessage?.choiceStep ===
        "product-quick-action"
    ) {
      await handleProductQuickAction(
        choice?.id
      );

      return;
    }

    /*
     * Quick actions afișate DUPĂ o modificare salvată cu succes
     * (Mai modific ceva / Alege alt produs / Deschide editorul
     * complet / Înapoi la Produse) - inclusiv varianta restrânsă
     * PRICE_STOCK_UPDATE_FOLLOWUP_CHOICES (fără "Deschide editorul
     * complet"), tot prin handleProductFollowUpChoice.
     */
    if (
      sourceMessage?.type === "choices" &&
      sourceMessage?.choiceStep ===
        "product-update-followup"
    ) {
      await handleProductFollowUpChoice(
        choice
      );

      return;
    }

    /*
     * BUGFIX: "Vezi produsele mele" din startVendorFlow (EDIT_PRODUCT)
     * trebuie să deschidă selectorul REAL de produse - interceptat
     * ÎNAINTE de handleVendorChoice (care nu mai are un placeholder
     * pentru asta, vezi vendorFlows.js).
     */
    if (
      activeFlow ===
        VENDOR_PRODUCT_FLOWS.EDIT_PRODUCT &&
      choice === "Vezi produsele mele"
    ) {
      await openEditProductSelector();

      return;
    }

    /*
     * FIX (audit 2026-09-23): "Alege un produs" din startVendorFlow
     * (PRICE_STOCK) - identic ca principiu cu "Vezi produsele mele"
     * de mai sus, dar deschide selectorul în mod restrâns (narrow),
     * care duce la presentPriceStockQuickActions, nu la meniul
     * complet de 10 opțiuni.
     */
    if (
      activeFlow ===
        VENDOR_PRODUCT_FLOWS.PRICE_STOCK &&
      choice === "Alege un produs"
    ) {
      await openEditProductSelector(null, {
        narrow: true,
      });

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

    const editingGroupForUpload =
      activeVendorView ===
      "product-batch-wizard-edit"
        ? batchGroups.find(
            (group) =>
              group.id === editingGroupId
          )
        : null;

    const currentImagesCount =
  activeVendorView ===
  "product-batch-wizard"
    ? batchImages.length
    : editingGroupForUpload
      ? (
          editingGroupForUpload
            .productDraft?.images ||
          []
        ).length
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
  "product-batch-wizard-edit" &&
  editingGroupId
) {
  setBatchGroups((current) =>
    current.map((group) =>
      group.id === editingGroupId
        ? {
            ...group,
            productDraft: {
              ...(group.productDraft ||
                {}),

              images: [
                ...(Array.isArray(
                  group.productDraft
                    ?.images
                )
                  ? group.productDraft
                      .images
                  : []),

                ...nextImages,
              ],
            },
          }
        : group
    )
  );

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
  /*
   * Extras din setProductDraft-ul de mai jos, cuvânt cu cuvânt -
   * NU o rescriere - ca să poată fi reutilizat IDENTIC de editorul
   * per-produs din importul în bulk (handleAnalyzeGroupEditorProduct)
   * fără o a doua implementare a acelorași reguli de mapare AI.
   */
  function applyPhotoAnalysisToDraft(
    current,
    analysis,
    imageUrls
  ) {
    const canApplyOrderMode =
      Number(
        analysis
          ?.orderModeConfidence
      ) >= 0.75;

    return {
      ...normalizeProductDraft(
        current
      ),

      images: imageUrls,

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
    };
  }

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

    setProductDraft(
      (current) =>
        applyPhotoAnalysisToDraft(
          current,
          analysis,
          imageUrls
        )
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
      humanizeAssistantErrorMessage(
        error,
        "Nu am putut analiza produsul."
      )
    );
  } finally {
    setAnalyzingProduct(
      false
    );
  }
}
/*
 * Extras din setProductDraft-ul de mai jos, cuvânt cu cuvânt - vezi
 * comentariul de la applyPhotoAnalysisToDraft. Reutilizat identic de
 * handleAnalyzeGroupEditorOrder (import în bulk).
 */
function applyOrderAnalysisToDraft(
  current,
  result,
  imageUrls
) {
  const currentDraft =
    normalizeProductDraft(current);

  const patch =
    result?.patch &&
    typeof result.patch === "object"
      ? result.patch
      : {};

  const nextOrderMode = [
    "READY_TO_BUY",
    "OPTIONS",
    "QUOTE_ONLY",
  ].includes(patch?.orderMode)
    ? patch.orderMode
    : currentDraft.orderMode;

  return {
    ...currentDraft,

    images:
      Array.isArray(imageUrls) &&
      imageUrls.length
        ? imageUrls
        : currentDraft.images,

    price:
      patch.price !== null &&
      patch.price !== undefined
        ? patch.price
        : currentDraft.price,

    availability:
      patch.availability ||
      currentDraft.availability,

    readyQty:
      patch.readyQty !== null &&
      patch.readyQty !== undefined
        ? patch.readyQty
        : currentDraft.readyQty,

    leadTimeDays:
      patch.leadTimeDays !== null &&
      patch.leadTimeDays !== undefined
        ? patch.leadTimeDays
        : currentDraft.leadTimeDays,

    orderMode: nextOrderMode,

    optionsSchema:
      nextOrderMode === "OPTIONS"
        ? Array.isArray(
            patch.optionsSchema
          )
          ? patch.optionsSchema
          : currentDraft.optionsSchema
        : [],

    customSchema:
      nextOrderMode === "OPTIONS"
        ? Array.isArray(
            patch.customSchema
          )
          ? patch.customSchema
          : currentDraft.customSchema
        : [],

    repeatedGroups:
      nextOrderMode === "OPTIONS"
        ? currentDraft.repeatedGroups
        : [],

    quoteSchema:
      nextOrderMode === "QUOTE_ONLY"
        ? Array.isArray(
            patch.quoteSchema
          )
          ? patch.quoteSchema
          : currentDraft.quoteSchema
        : [],

    aiOrderMessage: String(
      result?.message || ""
    ).trim(),

    aiOrderReason: String(
      result?.orderModeReason || ""
    ).trim(),

    aiOrderConfidence:
      result?.confidence ?? null,

    aiQuestions: Array.isArray(
      result?.questions
    )
      ? result.questions
      : [],
  };
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

    setProductDraft(
      (current) =>
        applyOrderAnalysisToDraft(
          current,
          result,
          imageUrls
        )
    );
  } catch (error) {
    console.error(
      "Vendor product order analysis error:",
      error
    );

    window.alert(
      humanizeAssistantErrorMessage(
        error,
        "Nu am putut pregăti formularul de comandă."
      )
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
/*
 * Extras din handlePublishProductFromWizard, cuvânt cu cuvânt - NU o
 * rescriere - ca să existe UN SINGUR loc care știe cum aflăm slug-ul
 * magazinului de produse. Reutilizat identic de publicarea per-grup
 * din importul în bulk (handlePublishGroupProduct).
 */
async function resolveVendorStoreSlug() {
  const catalogData = await api(
    "/api/vendor/catalog/products"
  );

  return (
    catalogData?.defaultStoreSlug ||
    catalogData?.stores?.[0]?.slug ||
    null
  );
}

/*
 * Extras din handlePublishProductFromWizard, cuvânt cu cuvânt - vezi
 * comentariul de la resolveVendorStoreSlug. Reutilizat identic de
 * handlePublishGroupProduct, ca ambele fluxuri (single-product și
 * import în bulk) să trimită EXACT același shape de body către
 * POST /vendors/store/:slug/products - nicio a doua implementare a
 * acelorași reguli de business.
 */
function buildCreateProductBody(
  draft,
  imageUrls
) {
  const availability =
    draft.availability || "READY";

  const body = {
    title: draft.title.trim(),
    description: draft.description || "",

    /*
     * BUGFIX (audit) - QUOTE_ONLY trimite acum prețul orientativ real,
     * la fel ca celelalte moduri. Backend-ul (createProduct din
     * vendorProductRoutes.js) cere deja price > 0 pentru toate
     * modurile, inclusiv QUOTE_ONLY - nu mai inventăm 0 aici.
     */
    price: Number(draft.price || 0),

    images: imageUrls,
    videoUrl: draft.videoUrl || null,
    videoMuted: draft.videoUrl
      ? !!draft.videoMuted
      : false,
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

  return body;
}

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
    const storeSlug =
      await resolveVendorStoreSlug();

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

    const body = buildCreateProductBody(
      draft,
      imageUrls
    );

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
          humanizeAssistantErrorMessage(
            err,
            "Nu am putut salva costingul calculat pentru acest produs."
          );
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
      humanizeAssistantErrorMessage(
        err,
        "Nu am putut salva produsul."
      )
    );
  } finally {
    setWizardPublishing(false);
  }
}

/*
 * Împarte un array în bucăți succesive de dimensiune `size` -
 * folosit ca să respectăm MAX_BATCH_CLUSTER_IMAGES per apel de
 * grupare AI (vezi comentariul din aiLimits.js pe backend).
 */
function chunkArray(list, size) {
  const chunks = [];

  for (
    let index = 0;
    index < list.length;
    index += size
  ) {
    chunks.push(
      list.slice(index, index + size)
    );
  }

  return chunks;
}

function fallbackSingletonGroups(images) {
  return images.map((image) => ({
    imageIds: [image.id],
    confidence: null,
    label: "",
  }));
}

function makeGroupId() {
  return `group-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2)}`;
}

/*
 * Câmpurile de stare pentru salvare/publicare (faza 2 - editare per
 * produs) - UN SINGUR loc care le inițializează, ca orice grup nou
 * (din grupare, separare sau mutare) să pornească identic, indiferent
 * pe unde a fost creat.
 */
function makeGroupSaveState() {
  return {
    saveStatus: "pending",
    saveError: "",
    publishedProduct: null,
    wizardStep: "details",
  };
}

/*
 * Prag sub care o grupare (sau o imagine rămasă singură, cu
 * confidence null) e marcată "de verificat" - vendorul trebuie să
 * confirme explicit, nu presupunem că AI-ul a grupat corect.
 */
const LOW_GROUP_CONFIDENCE = 0.55;

function groupStatusFor(confidence) {
  if (
    confidence == null ||
    confidence < LOW_GROUP_CONFIDENCE
  ) {
    return "NEEDS_REVIEW";
  }

  return "GROUPED";
}

/*
 * Pasul 1 (clustering strict) - împarte batch-ul în loturi de
 * MAX_BATCH_CLUSTER_IMAGES, apelează /product-batch-group pentru
 * fiecare lot (secvențial - e un pas rapid, doar grupare, nu
 * analiză completă), apoi rulează o verificare ușoară "ar putea fi
 * același produs?" ÎNTRE loturi adiacente (fără să le combine
 * automat - doar marchează, vendorul decide). NU pornește automat
 * analiza AI completă per grup - asta se întâmplă abia la
 * handleAnalyzeGroupProducts, după ce vendorul confirmă gruparea.
 */
async function handleAnalyzeBatchGroups() {
  if (!batchImages.length) {
    setBatchGroupingError(
      "Încarcă mai întâi fotografiile produselor."
    );

    return;
  }

  setBatchGroupingError("");
  setAnalyzingBatch(true);
  setBatchWizardStep("analysis");

  try {
    /*
     * Upload o singură dată, pentru TOATE imaginile batch-ului
     * (maxImages: 50, nu 10 - vezi comentariul din
     * uploadVendorProductImages) - grupurile rezultate refolosesc
     * aceste URL-uri, fără reîncărcare ulterioară la analiza per
     * grup (analyzeVendorProduct scurtcircuitează uploadul dacă
     * imaginea are deja `url`).
     */
    const uploadedUrls =
      await uploadVendorProductImages(
        batchImages,
        { maxImages: 50 }
      );

    const imagesWithUrl =
      batchImages.map(
        (image, index) => ({
          ...image,
          url:
            uploadedUrls[index] ||
            image.url ||
            null,
        })
      );

    setBatchImages(imagesWithUrl);

    const chunks = chunkArray(
      imagesWithUrl,
      MAX_BATCH_CLUSTER_IMAGES
    );

    let hadClusterError = false;

    /*
     * groupsByChunk: păstrăm gruparea PE LOT separat (nu le
     * combinăm încă într-un singur array plat) - avem nevoie de
     * ultimul grup al lotului K și primul grup al lotului K+1 ca
     * să rulăm verificarea de graniță de mai jos.
     */
    const groupsByChunk = [];

    for (
      let chunkIndex = 0;
      chunkIndex < chunks.length;
      chunkIndex++
    ) {
      const chunk = chunks[chunkIndex];

      setBatchProgress({
        phase: "clustering",
        done: chunkIndex,
        total: chunks.length,
      });

      let rawGroups;

      try {
        rawGroups =
          await clusterVendorProductImages({
            images: chunk.map(
              (image) => ({
                id: image.id,
                url: image.url,
              })
            ),
          });
      } catch (error) {
        console.error(
          "Batch clustering failed for chunk:",
          error
        );

        hadClusterError = true;

        /*
         * Un lot eșuat NU oprește restul - fotografiile lui devin
         * grupuri individuale, marcate "de verificat", iar
         * vendorul le poate regrupa manual. Nicio fotografie nu
         * se pierde.
         */
        rawGroups =
          fallbackSingletonGroups(
            chunk
          );
      }

      const byId = new Map(
        chunk.map((image) => [
          image.id,
          image,
        ])
      );

      const chunkGroups = rawGroups
        .map((rawGroup) => {
          const groupImages = (
            rawGroup.imageIds || []
          )
            .map((id) => byId.get(id))
            .filter(Boolean);

          if (!groupImages.length) {
            return null;
          }

          return {
            id: makeGroupId(),

            title:
              rawGroup.label ||
              "",

            confidence:
              rawGroup.confidence ??
              null,

            images: groupImages,

            status: groupStatusFor(
              rawGroup.confidence
            ),

            boundaryHint: null,

            productDraft: null,
            analysisError: "",

            ...makeGroupSaveState(),
          };
        })
        .filter(Boolean);

      groupsByChunk.push(
        chunkGroups
      );
    }

    setBatchProgress({
      phase: "clustering",
      done: chunks.length,
      total: chunks.length,
    });

    /*
     * Verificare de graniță ÎNTRE loturi adiacente - NU combinăm
     * automat, doar marcăm ambele grupuri cu un indiciu, ca
     * vendorul să decidă. Eșecul acestei verificări e ignorat
     * silențios (e un semnal secundar, cosmetic - nu blochează
     * fluxul principal).
     */
    for (
      let chunkIndex = 0;
      chunkIndex < groupsByChunk.length - 1;
      chunkIndex++
    ) {
      const previousGroups =
        groupsByChunk[chunkIndex];

      const nextGroups =
        groupsByChunk[chunkIndex + 1];

      const lastGroup =
        previousGroups[
          previousGroups.length - 1
        ];

      const firstGroup =
        nextGroups[0];

      if (!lastGroup || !firstGroup) {
        continue;
      }

      try {
        const boundaryImages = [
          ...lastGroup.images.slice(-3),
          ...firstGroup.images.slice(0, 3),
        ];

        const boundaryResult =
          await clusterVendorProductImages({
            images: boundaryImages.map(
              (image) => ({
                id: image.id,
                url: image.url,
              })
            ),
          });

        if (
          boundaryResult.length === 1
        ) {
          lastGroup.boundaryHint = {
            groupId: firstGroup.id,
            title:
              firstGroup.title ||
              "grupul următor",
          };

          firstGroup.boundaryHint = {
            groupId: lastGroup.id,
            title:
              lastGroup.title ||
              "grupul anterior",
          };
        }
      } catch (error) {
        console.error(
          "Batch boundary check failed:",
          error
        );
      }
    }

    const finalGroups =
      groupsByChunk.flat();

    setBatchGroups(finalGroups);
    setBatchWizardStep("groups");

    const boundaryHintsCount =
      finalGroups.filter(
        (group) => group.boundaryHint
      ).length / 2;

    const summaryParts = [
      finalGroups.length === 1
        ? "AI-ul a detectat 1 produs."
        : `AI-ul a detectat ${finalGroups.length} produse.`,
    ];

    if (hadClusterError) {
      summaryParts.push(
        "Câteva fotografii nu au putut fi grupate automat - le-am pus separat, ca să le regrupezi manual."
      );
    }

    if (boundaryHintsCount > 0) {
      summaryParts.push(
        boundaryHintsCount === 1
          ? "Am marcat 2 grupuri care ar putea fi de fapt același produs - verifică-le."
          : `Am marcat ${Math.round(
              boundaryHintsCount
            ) * 2} grupuri care ar putea fi de fapt același produs - verifică-le.`
      );
    }

    addMessage(
      createMessage(
        "assistant",
        summaryParts.join(" ")
      )
    );
  } catch (error) {
    console.error(
      "Batch product grouping failed:",
      error
    );

    setBatchWizardStep("images");

    setBatchGroupingError(
      humanizeAssistantErrorMessage(
        error,
        "Nu am putut grupa fotografiile. Fotografiile încărcate rămân disponibile - poți încerca din nou."
      )
    );
  } finally {
    setAnalyzingBatch(false);
    setBatchProgress(null);
  }
}

/*
 * Pasul 2 - analiza AI COMPLETĂ per grup (reutilizează
 * analyzeVendorProduct, EXACT serviciul folosit de fluxul
 * single-product), apelată DOAR după ce vendorul a confirmat/
 * corectat gruparea. Concurență limitată (max 3 simultan) - nu
 * bombardăm backend-ul/OpenAI cu N cereri deodată. Eșecul unui
 * grup NU oprește restul - grupul respectiv rămâne marcat cu
 * eroare, vendorul poate reîncerca doar pe acela.
 */
const BATCH_ANALYSIS_CONCURRENCY = 3;

async function handleAnalyzeGroupProducts(
  groupIds = null
) {
  const targetGroups = batchGroups.filter(
    (group) =>
      !groupIds ||
      groupIds.includes(group.id)
  );

  if (!targetGroups.length) {
    return;
  }

  setAnalyzingBatch(true);

  setBatchProgress({
    phase: "analyzing",
    done: 0,
    total: targetGroups.length,
  });

  const results = new Map();
  let completed = 0;
  let cursor = 0;

  async function worker() {
    while (cursor < targetGroups.length) {
      const index = cursor;
      cursor += 1;

      const group = targetGroups[index];

      try {
        const { analysis, imageUrls } =
          await analyzeVendorProduct({
            images: group.images,
          });

        results.set(group.id, {
          analysis,
          imageUrls,
          error: null,
        });
      } catch (error) {
        results.set(group.id, {
          analysis: null,
          imageUrls: null,

          error:
            error instanceof Error
              ? error.message
              : "Nu am putut analiza acest produs.",
        });
      } finally {
        completed += 1;

        setBatchProgress({
          phase: "analyzing",
          done: completed,
          total: targetGroups.length,
        });
      }
    }
  }

  await Promise.all(
    Array.from(
      {
        length: Math.min(
          BATCH_ANALYSIS_CONCURRENCY,
          targetGroups.length
        ),
      },
      worker
    )
  );

  setBatchGroups((current) =>
    current.map((group) => {
      const result = results.get(
        group.id
      );

      if (!result) {
        return group;
      }

      if (result.error) {
        return {
          ...group,
          status: "ANALYSIS_FAILED",
          analysisError: result.error,
        };
      }

      return {
        ...group,
        status: "ANALYZED",
        analysisError: "",

        /*
         * applyPhotoAnalysisToDraft - EXACT funcția de mapare
         * folosită de single-product (handleAnalyzeProduct), pornind
         * de la un draft gol - orderMode/optionsSchema/customSchema/
         * quoteSchema/styleTags/occasionTags rezultă identic, nu o
         * mapare separată, mai săracă, pentru import în bulk.
         */
        productDraft:
          applyPhotoAnalysisToDraft(
            {},
            result.analysis,
            result.imageUrls
          ),
      };
    })
  );

  setBatchWizardStep("review");
  setAnalyzingBatch(false);
  setBatchProgress(null);

  const failedCount = Array.from(
    results.values()
  ).filter(
    (result) => result.error
  ).length;

  if (failedCount > 0) {
    addMessage(
      createMessage(
        "assistant",

        failedCount === 1
          ? "Am pregătit produsele. Un produs nu a putut fi analizat - poți reîncerca doar pentru el."
          : `Am pregătit produsele. ${failedCount} produse nu au putut fi analizate - poți reîncerca doar pentru ele.`
      )
    );
  } else {
    addMessage(
      createMessage(
        "assistant",
        "Am pregătit toate produsele. Verifică fiecare înainte să salvezi sau să publici."
      )
    );
  }
}

/* =======================================================
   Corectare grupare (mutare/separare/combinare/eliminare)
======================================================= */

function findGroupOfImage(groups, imageId) {
  return groups.find((group) =>
    group.images.some(
      (image) => image.id === imageId
    )
  );
}

function handleMoveImageToGroup(
  imageId,
  targetGroupId
) {
  setBatchGroups((current) => {
    const sourceGroup = findGroupOfImage(
      current,
      imageId
    );

    if (!sourceGroup) {
      return current;
    }

    /*
     * Un grup deja publicat e "blocat" pentru corectări de grupare -
     * produsul respectiv există deja pe backend cu compoziția
     * curentă de imagini, mutarea unei poze acum ar dezacorda
     * lista din wizard de produsul chiar creat.
     */
    if (sourceGroup.saveStatus === "published") {
      return current;
    }

    if (
      targetGroupId !== "__new__" &&
      current.find(
        (group) => group.id === targetGroupId
      )?.saveStatus === "published"
    ) {
      return current;
    }

    const movedImage =
      sourceGroup.images.find(
        (image) => image.id === imageId
      );

    if (!movedImage) {
      return current;
    }

    const withoutImage = current
      .map((group) =>
        group.id === sourceGroup.id
          ? {
              ...group,
              images: group.images.filter(
                (image) =>
                  image.id !== imageId
              ),
            }
          : group
      )
      .filter(
        (group) => group.images.length > 0
      );

    if (targetGroupId === "__new__") {
      return [
        ...withoutImage,
        {
          id: makeGroupId(),
          title: "",
          confidence: null,
          images: [movedImage],
          status: "NEEDS_REVIEW",
          boundaryHint: null,
          productDraft: null,
          analysisError: "",
          ...makeGroupSaveState(),
        },
      ];
    }

    return withoutImage.map((group) =>
      group.id === targetGroupId
        ? {
            ...group,
            images: [
              ...group.images,
              movedImage,
            ],
            status: "NEEDS_REVIEW",
            productDraft: null,
            analysisError: "",
          }
        : group
    );
  });
}

function handleRemoveImageFromBatch(
  imageId
) {
  setBatchGroups((current) =>
    current
      .map((group) => {
        if (
          group.saveStatus ===
          "published"
        ) {
          return group;
        }

        return {
          ...group,

          images: group.images.filter(
            (image) => {
              if (image.id !== imageId) {
                return true;
              }

              if (
                image?.previewUrl?.startsWith(
                  "blob:"
                )
              ) {
                URL.revokeObjectURL(
                  image.previewUrl
                );
              }

              return false;
            }
          ),
        };
      })
      .filter(
        (group) => group.images.length > 0
      )
  );

  setBatchImages((current) =>
    current.filter(
      (image) => image.id !== imageId
    )
  );
}

function handleSplitGroupImages(
  groupId,
  imageIdsToExtract
) {
  if (!imageIdsToExtract?.length) {
    return;
  }

  setBatchGroups((current) => {
    const group = current.find(
      (item) => item.id === groupId
    );

    if (
      !group ||
      group.saveStatus === "published"
    ) {
      return current;
    }

    const extractSet = new Set(
      imageIdsToExtract
    );

    const remaining =
      group.images.filter(
        (image) => !extractSet.has(image.id)
      );

    const extracted = group.images.filter(
      (image) => extractSet.has(image.id)
    );

    if (!extracted.length) {
      return current;
    }

    /*
     * Dacă vendorul selectează TOATE fotografiile grupului pentru
     * mutare într-un grup nou, grupul original rămâne fără
     * imagini - îl eliminăm în loc să blocăm acțiunea (echivalent
     * cu "redenumește/golește" grupul, nu o eroare).
     */
    return current
      .filter(
        (item) =>
          item.id !== groupId ||
          remaining.length > 0
      )
      .map((item) =>
        item.id === groupId
          ? {
              ...item,
              images: remaining,
              status: "NEEDS_REVIEW",
              productDraft: null,
              analysisError: "",
            }
          : item
      )
      .concat({
        id: makeGroupId(),
        title: "",
        confidence: null,
        images: extracted,
        status: "NEEDS_REVIEW",
        boundaryHint: null,
        productDraft: null,
        analysisError: "",
        ...makeGroupSaveState(),
      });
  });
}

function handleMergeGroups(
  groupIdA,
  groupIdB
) {
  if (groupIdA === groupIdB) {
    return;
  }

  setBatchGroups((current) => {
    const groupA = current.find(
      (item) => item.id === groupIdA
    );

    const groupB = current.find(
      (item) => item.id === groupIdB
    );

    if (
      !groupA ||
      !groupB ||
      groupA.saveStatus === "published" ||
      groupB.saveStatus === "published"
    ) {
      return current;
    }

    return current
      .filter(
        (item) => item.id !== groupIdB
      )
      .map((item) =>
        item.id === groupIdA
          ? {
              ...item,
              images: [
                ...item.images,
                ...groupB.images,
              ],
              title:
                item.title ||
                groupB.title,
              status: "NEEDS_REVIEW",
              boundaryHint: null,
              productDraft: null,
              analysisError: "",
            }
          : item
      );
  });
}

function handleSetGroupTitle(
  groupId,
  title
) {
  setBatchGroups((current) =>
    current.map((group) =>
      group.id === groupId
        ? { ...group, title }
        : group
    )
  );
}

function handleSetPrimaryImage(
  groupId,
  imageId
) {
  setBatchGroups((current) =>
    current.map((group) => {
      if (group.id !== groupId) {
        return group;
      }

      const target = group.images.find(
        (image) => image.id === imageId
      );

      if (!target) {
        return group;
      }

      return {
        ...group,

        images: [
          target,
          ...group.images.filter(
            (image) => image.id !== imageId
          ),
        ],
      };
    })
  );
}

function handleRemoveGroupFromImport(
  groupId
) {
  setBatchGroups((current) => {
    const group = current.find(
      (item) => item.id === groupId
    );

    if (group) {
      for (const image of group.images) {
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

      setBatchImages((currentImages) =>
        currentImages.filter(
          (image) =>
            !group.images.some(
              (groupImage) =>
                groupImage.id === image.id
            )
        )
      );
    }

    return current.filter(
      (item) => item.id !== groupId
    );
  });

  setEditingGroupId((current) =>
    current === groupId ? null : current
  );
}

/* =======================================================
   Editor per produs (faza 2 - editare/validare/preview/
   salvare) - reutilizează STRICT VendorProductWizard, montat
   O SINGURĂ dată, pentru grupul aflat în editingGroupId.
======================================================= */

function handleOpenGroupEditor(groupId) {
  setBatchGroups((current) =>
    current.map((group) => {
      if (group.id !== groupId) {
        return group;
      }

      /*
       * Dacă analiza AI nu a rulat încă sau a eșuat, deschidem
       * editorul oricum, cu un draft gol pornit din fotografiile
       * grupului - vendorul poate completa totul manual (aceeași
       * filozofie ca "Nu am poze acum, continui fără AI" din
       * fluxul single-product, secțiunea 16 - self-recovery).
       */
      if (group.productDraft) {
        return group;
      }

      return {
        ...group,

        productDraft: {
          images: group.images,
          title: group.title || "",
        },
      };
    })
  );

  setEditingGroupId(groupId);
  setActiveVendorView(
    "product-batch-wizard-edit"
  );
}

function handleCloseGroupEditor() {
  setEditingGroupId(null);

  setActiveVendorView(
    "product-batch-wizard"
  );

  setBatchWizardStep("review");
}

function handleSetGroupDraft(
  groupId,
  updater
) {
  setBatchGroups((current) =>
    current.map((group) => {
      if (group.id !== groupId) {
        return group;
      }

      const nextDraft =
        typeof updater === "function"
          ? updater(group.productDraft)
          : updater;

      return {
        ...group,
        productDraft: nextDraft,
      };
    })
  );
}

function handleSetGroupWizardStep(
  groupId,
  step
) {
  setBatchGroups((current) =>
    current.map((group) =>
      group.id === groupId
        ? { ...group, wizardStep: step }
        : group
    )
  );
}

/*
 * "Analizează cu AI" din editorul unui produs din import - EXACT
 * analyzeVendorProduct + applyPhotoAnalysisToDraft folosite de
 * handleAnalyzeProduct (single-product), doar că patch-ul se aplică
 * pe draftul grupului curent, nu pe productDraft global. Modificarea
 * produsului A NU afectează produsul B (fiecare grup are propriul
 * productDraft, complet separat).
 */
async function handleAnalyzeGroupEditorProduct() {
  if (!editingGroupId) {
    return;
  }

  const group = batchGroups.find(
    (item) => item.id === editingGroupId
  );

  const imagesToAnalyze = Array.isArray(
    group?.productDraft?.images
  )
    ? group.productDraft.images
    : [];

  if (!imagesToAnalyze.length) {
    addMessage(
      createMessage(
        "assistant",
        "Încarcă mai întâi cel puțin o fotografie."
      )
    );

    return;
  }

  const groupId = editingGroupId;

  try {
    setEditorAnalyzing(true);
    handleSetGroupWizardStep(
      groupId,
      "analysis"
    );

    const { analysis, imageUrls } =
      await analyzeVendorProduct({
        images: imagesToAnalyze,
      });

    handleSetGroupDraft(
      groupId,
      (current) =>
        applyPhotoAnalysisToDraft(
          current,
          analysis,
          imageUrls
        )
    );

    handleSetGroupWizardStep(
      groupId,
      "details"
    );
  } catch (error) {
    console.error(
      "Batch group product analysis error:",
      error
    );

    handleSetGroupWizardStep(
      groupId,
      "images"
    );

    addMessage(
      createMessage(
        "assistant",

        humanizeAssistantErrorMessage(
          error,
          "Nu am putut analiza acest produs."
        )
      )
    );
  } finally {
    setEditorAnalyzing(false);
  }
}

/*
 * "Pregătește formularul cu AI" (modul de comandă) din editorul
 * unui produs din import - EXACT analyzeVendorProductOrder +
 * applyOrderAnalysisToDraft folosite de handleAnalyzeProductOrder
 * (single-product).
 */
async function handleAnalyzeGroupEditorOrder() {
  if (!editingGroupId) {
    return;
  }

  const groupId = editingGroupId;

  const group = batchGroups.find(
    (item) => item.id === groupId
  );

  const safeDraft = normalizeProductDraft(
    group?.productDraft
  );

  const message = String(
    safeDraft.orderInstructions || ""
  ).trim();

  const hasAiContext =
    Boolean(safeDraft.aiAnalysis) ||
    safeDraft.aiQuestions.length > 0 ||
    safeDraft.optionsSchema.length >
      0 ||
    safeDraft.customSchema.length >
      0 ||
    safeDraft.quoteSchema.length > 0;

  if (!message && !hasAiContext) {
    addMessage(
      createMessage(
        "assistant",
        "Explică pe scurt cum trebuie comandat produsul."
      )
    );

    return;
  }

  try {
    setEditorAnalyzingOrder(true);

    const { result, imageUrls } =
      await analyzeVendorProductOrder({
        product: safeDraft,
        message,
        images: safeDraft.images,
        visionAnalysis:
          safeDraft.aiAnalysis,
        history: [],
      });

    handleSetGroupDraft(
      groupId,
      (current) =>
        applyOrderAnalysisToDraft(
          current,
          result,
          imageUrls
        )
    );
  } catch (error) {
    console.error(
      "Batch group order analysis error:",
      error
    );

    addMessage(
      createMessage(
        "assistant",

        humanizeAssistantErrorMessage(
          error,
          "Nu am putut pregăti formularul de comandă."
        )
      )
    );
  } finally {
    setEditorAnalyzingOrder(false);
  }
}

/*
 * Publicare per produs (faza 2, cerințele #11-13) - reutilizează
 * STRICT resolveVendorStoreSlug + buildCreateProductBody + endpoint-ul
 * de creare produs, EXACT ca handlePublishProductFromWizard, dar cu
 * stare independentă per grup (saveStatus/saveError/publishedProduct)
 * - un produs eșuat NU blochează sau afectează celelalte.
 *
 * Protecție dublu-submit: dacă grupul e deja "saving" sau
 * "published", ieșim imediat.
 */
async function handlePublishGroupProduct(
  groupId
) {
  /*
   * Verificare + marcare SINCRONĂ (ref, nu state) - vezi
   * comentariul de la inFlightGroupPublishRef. Dacă e deja în curs,
   * al doilea click iese imediat, înainte de orice alt cod.
   */
  if (
    inFlightGroupPublishRef.current.has(
      groupId
    )
  ) {
    return;
  }

  const group = batchGroups.find(
    (item) => item.id === groupId
  );

  if (
    !group ||
    group.saveStatus === "saving" ||
    group.saveStatus === "published"
  ) {
    return;
  }

  inFlightGroupPublishRef.current.add(
    groupId
  );

  const draft = normalizeProductDraft(
    group.productDraft
  );

  if (!draft.title.trim()) {
    setBatchGroups((current) =>
      current.map((item) =>
        item.id === groupId
          ? {
              ...item,
              saveStatus: "failed",
              saveError:
                "Adaugă un titlu pentru produs înainte de a salva.",
            }
          : item
      )
    );

    inFlightGroupPublishRef.current.delete(
      groupId
    );

    return;
  }

  if (
    !Array.isArray(draft.images) ||
    !draft.images.length
  ) {
    setBatchGroups((current) =>
      current.map((item) =>
        item.id === groupId
          ? {
              ...item,
              saveStatus: "failed",
              saveError:
                "Adaugă cel puțin o fotografie înainte de a salva.",
            }
          : item
      )
    );

    inFlightGroupPublishRef.current.delete(
      groupId
    );

    return;
  }

  setBatchGroups((current) =>
    current.map((item) =>
      item.id === groupId
        ? {
            ...item,
            saveStatus: "saving",
            saveError: "",
          }
        : item
    )
  );

  try {
    const storeSlug =
      await resolveVendorStoreSlug();

    if (!storeSlug) {
      throw new Error(
        "Nu am găsit magazinul tău de produse. Verifică din Catalog înainte de a salva."
      );
    }

    const imageUrls =
      await uploadVendorProductImages(
        draft.images
      );

    const body = buildCreateProductBody(
      draft,
      imageUrls
    );

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

    setBatchGroups((current) =>
      current.map((item) =>
        item.id === groupId
          ? {
              ...item,
              saveStatus: "published",
              saveError: "",

              publishedProduct: {
                productId: created.id,

                title:
                  created.title ||
                  draft.title,
              },
            }
          : item
      )
    );
  } catch (err) {
    setBatchGroups((current) =>
      current.map((item) =>
        item.id === groupId
          ? {
              ...item,
              saveStatus: "failed",

              saveError:
                humanizeAssistantErrorMessage(
                  err,

                  `Produsul „${
                    draft.title ||
                    "fără titlu"
                  }” nu a putut fi salvat.`
                ),
            }
          : item
      )
    );
  } finally {
    inFlightGroupPublishRef.current.delete(
      groupId
    );
  }
}

/*
 * "Publică produsele pregătite" - publică în paralel (concurență
 * limitată la 3) toate grupurile fără câmpuri lipsă
 * (getMissingFields) și care nu sunt deja "saving"/"published".
 * Un eșec NU oprește restul (handlePublishGroupProduct e deja
 * izolat per grup). Protecție dublu-click: bulkPublishing.
 */
const BATCH_PUBLISH_CONCURRENCY = 3;

async function handlePublishReadyGroups() {
  if (bulkPublishingRef.current) {
    return;
  }

  const readyGroups = batchGroups.filter(
    (group) =>
      group.saveStatus !== "saving" &&
      group.saveStatus !== "published" &&
      getMissingFields(
        normalizeProductDraft(
          group.productDraft
        ),

        Array.isArray(
          group.productDraft?.images
        )
          ? group.productDraft.images
          : group.images
      ).length === 0
  );

  if (!readyGroups.length) {
    return;
  }

  bulkPublishingRef.current = true;
  setBulkPublishing(true);
  setBulkPublishSummary(null);

  let cursor = 0;

  async function worker() {
    while (cursor < readyGroups.length) {
      const index = cursor;
      cursor += 1;

      await handlePublishGroupProduct(
        readyGroups[index].id
      );
    }
  }

  await Promise.all(
    Array.from(
      {
        length: Math.min(
          BATCH_PUBLISH_CONCURRENCY,
          readyGroups.length
        ),
      },
      worker
    )
  );

  bulkPublishingRef.current = false;
  setBulkPublishing(false);

  const publishedIds = new Set(
    readyGroups.map((group) => group.id)
  );

  setBatchGroups((current) => {
    const publishedCount = current.filter(
      (group) =>
        publishedIds.has(group.id) &&
        group.saveStatus === "published"
    ).length;

    const pendingCount =
      current.length - publishedCount;

    setBulkPublishSummary({
      publishedCount,
      pendingCount,
    });

    return current;
  });
}

/*
 * "Șterge tot și începe din nou" - explicit, din pasul "images" al
 * wizard-ului de bulk. Singura cale de a reseta un import în curs -
 * intrarea normală din meniu (ADD_PRODUCTS_BATCH) REIA batch-ul
 * existent, nu îl șterge (vezi handleAction / persistență, cerința
 * #15).
 */
function handleResetBatch() {
  openBatchProductWizard({
    resetBatch: true,
  });
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

    /*
     * ===================================================
     * NAVIGARE (audit - acțiuni/navigare pentru toate rolurile)
     * ===================================================
     * Determinist, verificat ÎNAINTEA orchestratorului server-side -
     * "du-mă la comenzi"/"deschide calculatorul de preț" nu trebuie
     * să facă un round-trip la LLM doar ca să afle că userul vrea
     * să navigheze. VENDOR e mereu autentificat aici (widget-ul nu
     * se montează altfel - vezi AppLayout.jsx), deci singurele
     * rezultate posibile din resolveAssistantAction sunt "ok" sau
     * "unavailable"/"not_found" (niciodată needs_auth/role_forbidden).
     */
    const vendorNavigation =
      detectVendorNavigationTarget(value);

    if (vendorNavigation?.target) {
      const resolution = resolveAssistantAction(
        vendorNavigation.target,
        {
          role: ASSISTANT_ROLES.VENDOR,
          isAuthenticated: true,
        }
      );

      if (resolution.status === "ok") {
        addMessage(
          createMessage("user", value)
        );

        setInputValue("");

        addMessage(
          createMessage(
            "assistant",
            `Sigur — te duc la ${resolution.entry.label}.`
          )
        );

        if (resolution.entry.prefetch) {
          prefetchChunk(
            vendorNavigation.target,
            resolution.entry.prefetch,
            { mode: "intent" }
          );
        }

        closeAssistant();
        navigate(resolution.entry.route);

        return;
      }
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
          "Sigur. Te ajut să adaugi produsul pas cu pas. Poți începe direct cu fotografiile - AI-ul propune singur titlul și descrierea - sau, dacă nu ai poze acum, poți completa totul manual."
        )
      );

      openAddProductWizard();

      return;
    }

    /*
     * "editează produs" / "modifică produsul X" - flow separat de
     * ADD_PRODUCT: nu deschide wizard-ul de creare, ci selectorul
     * lean de produse (sau direct editorul, dacă numele e clar și
     * unic). Verificat imediat după ADD_PRODUCT, cu aceeași
     * prioritate (câștigă indiferent de subflow-ul activ).
     */
    if (
      detectedIntent?.type ===
      VENDOR_INTENTS.EDIT_PRODUCT
    ) {
      addMessage(
        createMessage(
          "user",
          value
        )
      );

      setInputValue("");

      const productNameHint =
        extractProductNameFromMessage(
          value
        );

      addMessage(
        createMessage(
          "assistant",

          productNameHint
            ? `Sigur, caut produsul „${productNameHint}”...`
            : "Sigur, care produs vrei să-l editezi?"
        )
      );

      await openEditProductSelector(
        productNameHint
      );

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

    /*
     * BUGFIX (audit, regresie "vreau ajutor" -> shopping flow) - un
     * flow marketplace ACTIV continua ORB orice mesaj nou (`{ type:
     * activeFlow }`, fără să se mai uite la text deloc), inclusiv
     * unul evident NELEGAT ("vreau ajutor", "câte comenzi am?").
     * Verificăm ÎNAINTE dacă mesajul nou arată clar ca ieșire din
     * flow - reutilizăm detectoarele deterministe deja existente
     * (aceleași folosite de detectMarketplaceIntent), nu o listă nouă.
     * Dacă da: golim activeFlow și lăsăm mesajul să cadă pe calea
     * normală de mai jos (askCopilot), exact ca pe stare curată.
     */
    const normalizedForExitCheck =
      isMarketplaceFlowActive
        ? normalizeForIntentDetection(value)
        : "";

    const looksLikeMarketplaceExit =
      isMarketplaceFlowActive &&
      (
        HELP_SUPPORT_INTENT_RE.test(normalizedForExitCheck) ||
        OWN_ENTITY_ACTION_RE.test(normalizedForExitCheck) ||
        OWN_VENDOR_DATA_RE.test(normalizedForExitCheck) ||
        isExplainIntentMessage(normalizedForExitCheck)
      );

    if (looksLikeMarketplaceExit) {
      setActiveFlow(null);
    }

    const effectiveMarketplaceFlowActive =
      isMarketplaceFlowActive && !looksLikeMarketplaceExit;

    const noOtherActiveContext =
      !conversationContext.mode ||
      conversationContext.mode === "NORMAL";

    if (
      effectiveMarketplaceFlowActive ||
      noOtherActiveContext
    ) {
      const marketplaceIntent =
        effectiveMarketplaceFlowActive
          ? { type: activeFlow }
          : detectMarketplaceIntent(value, {
              includeGenericProductWords: false,
            });

      if (marketplaceIntent) {
        addMessage(
          createMessage("user", value)
        );

        setInputValue("");

        if (!effectiveMarketplaceFlowActive) {
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
            /*
             * BUGFIX (audit): căutarea nu a putut fi PORNITĂ deloc -
             * stare terminală clară, fără rezultate/opțiuni de
             * rafinare afișate (spre deosebire de "zero rezultate",
             * care oferă "Încearcă altă căutare" ca alegere) - golim
             * activeFlow, altfel rămâne blocat pe un flow care n-a
             * apucat nici măcar să înceapă.
             */
            setActiveFlow(null);

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

      <input
        ref={
          cameraInputRef
        }
        type="file"
        multiple
        accept="image/png,image/jpeg,image/webp"
        capture="environment"
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
        style={
          embedded
            ? {
                position: "static",
                inset: "auto",
                left: "auto",
                top: "auto",
                zIndex: "auto",
                width: "100%",
                height: "100%",
              }
            : {
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
              }
        }
      >
        {(embedded || isOpen) ? (
          <section
            className={
              styles[
                "artfest-assistant-panel"
              ]
            }
          >
            <header
              className={
                styles.assistantHeader
              }
              onPointerDown={
                embedded ? undefined : handlePointerDown
              }
              onPointerMove={
                embedded ? undefined : handlePointerMove
              }
              onPointerUp={
                embedded ? undefined : handlePointerUp
              }
              onPointerCancel={
                embedded ? undefined : handlePointerUp
              }
            >
              <div
                className={
                  styles.assistantHeaderTop
                }
              >
                <div
                  className={
                    styles.assistantIdentity
                  }
                >
                  <div
                    className={
                      styles.assistantIcon
                    }
                  >
                    <SparkleIcon />
                  </div>

                  <h2
                    className={
                      styles.assistantTitle
                    }
                  >
                    Asistent Artfest
                  </h2>
                </div>

                <div
                  className={
                    styles.assistantHeaderActions
                  }
                  onPointerDown={(
                    event
                  ) =>
                    event.stopPropagation()
                  }
                >
                  <button
                    type="button"
                    className={`${styles.assistantHeaderButton} ${styles.assistantRefreshButton}`}
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
                    className={
                      styles.assistantHeaderButton
                    }
                    onClick={
                      closeAssistant
                    }
                    aria-label="Închide asistentul"
                    title="Închide"
                  >
                    <CloseIcon />
                  </button>
                </div>
              </div>

              <p
                className={
                  styles.assistantSubtitle
                }
              >
                Produse, comenzi și magazinul tău
              </p>
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
  "product-edit-wizard" ? (
  <VendorProductWizard
    mode="edit"
    editingProduct={
      chatEditingProduct
    }
    draft={
      chatEditDraft
    }
    setDraft={
      setChatEditDraft
    }
    categories={
      chatEditCategories
    }
    storeSlug={
      chatEditingProduct
        ?.service
        ?.profile
        ?.slug ||
      chatEditingProduct
        ?.store
        ?.slug ||
      ""
    }
    onSave={
      handleSaveChatEditProduct
    }
    saving={
      chatEditSaving
    }
    saveError={
      chatEditSaveError
    }
    saveSuccess={
      chatEditSaveSuccess
    }
    onClose={
      closeChatEditProduct
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
    step={
      batchWizardStep
    }
    setStep={
      setBatchWizardStep
    }
    analyzing={
      analyzingBatch
    }
    progress={
      batchProgress
    }
    groupingError={
      batchGroupingError
    }
    onUpload={() =>
      fileInputRef.current?.click()
    }
    onCapturePhoto={() =>
      cameraInputRef.current?.click()
    }
    onAnalyzeGroups={
      handleAnalyzeBatchGroups
    }
    onAnalyzeGroupProducts={
      handleAnalyzeGroupProducts
    }
    onMoveImage={
      handleMoveImageToGroup
    }
    onRemoveImage={
      handleRemoveImageFromBatch
    }
    onSplitGroup={
      handleSplitGroupImages
    }
    onMergeGroups={
      handleMergeGroups
    }
    onSetGroupTitle={
      handleSetGroupTitle
    }
    onSetPrimaryImage={
      handleSetPrimaryImage
    }
    onRemoveGroup={
      handleRemoveGroupFromImport
    }
    onEditGroup={
      handleOpenGroupEditor
    }
    onPublishGroup={
      handlePublishGroupProduct
    }
    onPublishReadyGroups={
      handlePublishReadyGroups
    }
    bulkPublishing={
      bulkPublishing
    }
    bulkPublishSummary={
      bulkPublishSummary
    }
    onDismissBulkSummary={() =>
      setBulkPublishSummary(null)
    }
    onResetBatch={
      handleResetBatch
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
) : activeVendorView ===
  "product-batch-wizard-edit" ? (
  (() => {
    const editingGroup =
      batchGroups.find(
        (group) =>
          group.id === editingGroupId
      );

    if (!editingGroup) {
      return null;
    }

    return (
      <VendorProductWizard
        draft={
          editingGroup.productDraft
        }
        setDraft={(updater) =>
          handleSetGroupDraft(
            editingGroup.id,
            updater
          )
        }
        step={
          editingGroup.wizardStep ||
          "details"
        }
        setStep={(nextStep) =>
          handleSetGroupWizardStep(
            editingGroup.id,
            nextStep
          )
        }
        analyzing={editorAnalyzing}
        analyzingOrder={
          editorAnalyzingOrder
        }
        onUpload={() =>
          fileInputRef.current?.click()
        }
        onAnalyze={
          handleAnalyzeGroupEditorProduct
        }
        onAnalyzeOrder={
          handleAnalyzeGroupEditorOrder
        }
        onBack={handleCloseGroupEditor}
        onClose={closeAssistant}
        onRemoveImage={(imageId) =>
          handleSetGroupDraft(
            editingGroup.id,
            (current) => ({
              ...(current || {}),

              images: (
                current?.images || []
              ).filter(
                (image) =>
                  image.id !== imageId
              ),
            })
          )
        }
        onPublish={() =>
          handlePublishGroupProduct(
            editingGroup.id
          )
        }
        publishing={
          editingGroup.saveStatus ===
          "saving"
        }
        publishError={
          editingGroup.saveStatus ===
          "failed"
            ? editingGroup.saveError
            : ""
        }
        publishSuccess={
          editingGroup.publishedProduct
        }
      />
    );
  })()
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

          /*
           * BUGFIX (verificare finală EDIT_PRODUCT conversațional):
           * Renunță la o modificare de produs păstrează produsul
           * selectat (mode/productId rămân neatinse - vezi fix-ul
           * din processCostingCommandResult) și golește DOAR
           * awaitingField, ca vendorul să revină la "produs
           * selectat, fără un câmp anume în așteptare" - poate
           * folosi din nou orice quick action sau text liber, fără
           * să reselecteze produsul.
           */
          if (
            pendingCostingAction?.kind ===
            "UPDATE_PRODUCT"
          ) {
            /*
             * PRICE_STOCK "Ambele" (audit 2026-09-23) - Renunță la
             * un card (combinat sau nu) curăță și draftul
             * intermediar de colectare secvențială, ca să nu rămână
             * un patch de preț "stale" agățat pentru o eventuală
             * colectare viitoare.
             */
            setComboPriceResult(null);

            setConversationContext((current) => ({
              ...current,
              awaitingField: null,
              comboStep: null,
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
        compact={
          currentMenu ===
          VENDOR_MENU_IDS.ROOT
        }
        roleHint="Panoul tău de vânzător"
      />
    )}

    {showMenu && (
      <>
        <p
          className={
            styles.assistantIntroText
          }
        >
          {
            VENDOR_ASSISTANT_INTRO_TEXT
          }
        </p>

        <p
          className={
            styles.assistantIntroHint
          }
        >
          Poți și să scrii liber orice întrebare.
        </p>
      </>
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