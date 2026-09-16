// src/components/AiAssistant/AiAssistant.jsx
import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import styles from "./AiAssistant.module.css";

import AssistantMessage from "./components/AssistantMessage.jsx";
import ActionMenu from "./components/ActionMenu.jsx";
import {
  askVendorPlatform,
} from "./VendorAIAssistant/vendorPlatformApi.js";

import {
  sendCopilotAsk,
  sendAssistantChat,
} from "./copilotApi.js";
/* =========================================================
   Produse
========================================================= */

import {
  SHOPPING_ACTIONS,
  startProductFlow,
  handleProductChoice,
  submitProductMessage,
  getProductTemporaryResponse,
  getProductImageUploadResponse,
  getProductInputPlaceholder,
  runImageSearchFlow,
  detectMaxPriceCentsFromText,
  runProductSearchRefinement,
} from "./Products/assistantProducts.js";

import {
  ShoppingBagIcon,
} from "./Products/ProductsIcons.jsx";

/* =========================================================
   Comenzi
========================================================= */

import {
  ORDER_ACTIONS,
  startOrderFlow,
  handleOrderChoice,
  getOrderTemporaryResponse,
  getOrderImageUploadResponse,
  getOrderInputPlaceholder,
} from "./Orders/AssistantOrders.js";

import {
  OrdersIcon,
} from "./Orders/OrderIcons.jsx";

/* =========================================================
   Personalizare
========================================================= */

import {
  PERSONALIZATION_ACTIONS,
  startPersonalizationFlow,
  getPersonalizationTemporaryResponse,
  getPersonalizationImageUploadResponse,
  getPersonalizationInputPlaceholder,
} from "./Personalization/assistantPersonalization.js";

import {
  PersonalizationIcon,
} from "./Personalization/PersonalizationIcons.jsx";

/* =========================================================
   Suport
========================================================= */
import {
  submitProductPersonalizationMessage,
  handlePersonalizationChoice,
  getTopLevelFields,
  createFieldQuestionMessage,
} from "./Personalization/productPersonalizationFlow.js";
import {
  HELP_ACTIONS,
  SUPPORT_FLOWS,
  SUPPORT_ACTIONS,
  startSupportFlow,
  handleSupportChoice,
  submitSupportMessage,
  openSupportTicket,
  getTicketIdFromFlow,
  getSupportTemporaryResponse,
  getSupportImageUploadResponse,
  getSupportInputPlaceholder,
} from "./Support/assistantSupport.js";
import {
  fetchSupportMessages,
  fetchSupportUnreadCount,
  markSupportTicketRead,
  createSupportTicket,
} from "./Support/supportApi.js";
import { api } from "../../lib/api.js";
import {
  SupportIcon,
} from "./Support/SupportIcons.jsx";

/* =========================================================
   Iconițe generale
========================================================= */

import {
  AttachmentIcon,
  BackIcon,
  ChevronRightIcon,
  CloseIcon,
  HomeIcon,
  RefreshIcon,
  SendIcon,
  SparkleIcon,
} from "./icons/AssistantIcons.jsx";

import {
  QUOTE_FLOWS,
  openMyQuotes,
  openVendorQuotes,
  openUserQuote,
  openVendorQuote,
  handleQuoteChoice,
  refreshQuoteThread,
  submitQuoteMessage,
  detectQuoteRequestIntent,
} from "./quotes/assistantQuotes.js";
import {
  sendQuoteAttachment,
  sendVendorQuoteAttachment,
} from "./quotes/quoteApi.js";

import {
  useLocation,
  useNavigate,
} from "react-router-dom";

import { derivePageContext } from "./derivePageContext.js";

/*
 * Taxonomie generală de intenții GUEST (7 bucket-uri stabile,
 * reguli determinste + mapare a categoriilor LLM din backend) -
 * vezi header-ul guestIntentTaxonomy.js pentru arhitectura completă.
 */
import {
  GUEST_INTENTS,
  CHAT_SMALLTALK,
  classifyGuestIntentDeterministic,
  mapBackendCategoryToGuestIntent,
  isQuestionLike,
  isVendorSignupInterest,
} from "./guestIntentTaxonomy.js";

import {
  ASSISTANT_ROLES,
  ASSISTANT_ACTION_TYPES,
  resolveAssistantAction,
  buildAssistantActionUrl,
  buildDynamicAssistantRoute,
} from "./assistantActionRegistry.js";

import { prefetchChunk } from "../../lib/smartPrefetch.js";
import { humanizeAssistantErrorMessage } from "./assistantErrorMessages.js";
/* =========================================================
   Configurare
========================================================= */

const STORAGE_KEYS = {
  position:
    "artfest-assistant-position",
};

const SUPPORT_POLL_INTERVAL =
  15 * 1000;

const QUOTE_POLL_INTERVAL =
  8 * 1000;
  
/*
 * FAZA 7 (polish vizual, mesaj introductiv) - NU mai e un mesaj
 * seedat în `messages` (nu mai apare în istoricul real trimis către
 * backend ca "assistant" - vezi `history` din askCopilot, construit
 * din messagesRef.current) - text static, randat separat, DUPĂ
 * quick actions (vezi JSX, gated pe `showMenu`, ca și ActionMenu).
 */
function getAssistantIntroText({
  isInfluencer,
  isVendor,
  isAuthenticated,
}) {
  if (isInfluencer) {
    return "Întreabă-mă despre promovare, resurse, comenzi sau câștiguri. Te pot duce direct unde ai nevoie.";
  }

  if (isVendor) {
    return "Întreabă-mă despre produse, comenzi, prețuri, promovare sau magazin. Te pot duce direct la pagina potrivită.";
  }

  if (isAuthenticated) {
    return "Întreabă-mă despre produse, comenzi, personalizare sau cum funcționează Artfest. Te ajut să găsești ce cauți.";
  }

  return "Întreabă-mă orice despre Artfest, produse, comenzi sau cum funcționează platforma.";
}

/* =========================================================
   Meniuri
========================================================= */

const USER_ROOT_ACTIONS = [
  {
    id: "shopping-menu",
    title: "Cumpărături",
    description:
      "Caută produse, recomandări și idei de cadouri.",
    icon: ShoppingBagIcon,
  },
  {
    id: "personalization-menu",
    title: "Cerere ofertă",
    description:
      "Solicită o ofertă pentru un produs sau urmărește cererile existente.",
    icon: PersonalizationIcon,
  },
  {
    id: "orders-menu",
    title: "Comenzile mele",
    description:
      "Urmărire, livrare, facturi și retururi.",
    icon: OrdersIcon,
  },
  {
    id: "help-menu",
    title: "Ajutor",
    description:
      "Primește ajutor sau discută cu echipa Artfest.",
    icon: SupportIcon,
  },
];

/*
 * FAZA 3 (INFLUENCER) - listă EXACTĂ cerută (9 quick actions), nu
 * meniuri vendor, nu amestecată cu USER_ROOT_ACTIONS - același
 * pattern ca VENDOR_ROOT_ACTIONS (propriul set, nu o extindere a
 * celui de USER). Fiecare are un `prompt` - clickul trimite acel
 * text prin ACELAȘI pipeline ca și cum influencerul l-ar fi tastat
 * (askCopilot), nu un flow local nou - vezi handleAction.
 */
const INFLUENCER_ROOT_ACTIONS = [
  {
    id: "influencer-today",
    title: "Ce să postez azi?",
    description: "Recomandările tale pentru azi.",
    icon: SparkleIcon,
    prompt: "Ce să postez azi?",
    group: "Promovare",
  },
  {
    id: "influencer-repost",
    title: "De repostat",
    description: "Resurse promovate de mult timp.",
    icon: RefreshIcon,
    prompt: "Arată-mi ce am de repostat.",
    group: "Promovare",
  },
  {
    id: "influencer-product-of-day",
    title: "Produsul zilei",
    description: "Materialul pregătit pentru azi.",
    icon: SparkleIcon,
    prompt: "Care este produsul zilei?",
    group: "Promovare",
  },
  {
    id: "influencer-new-products",
    title: "Produse noi azi",
    description: "Produse publicate azi pe Artfest.",
    icon: ShoppingBagIcon,
    prompt: "Ce produse noi au apărut azi?",
    group: "Promovare",
  },
  {
    id: "influencer-new-vendors",
    title: "Vânzători noi",
    description: "Magazine noi pe Artfest.",
    icon: HomeIcon,
    prompt: "Ce vânzători noi sunt?",
    group: "Promovare",
  },
  {
    id: "influencer-orders",
    title: "Comenzile mele",
    description: "Comenzi atribuite promovării tale.",
    icon: OrdersIcon,
    prompt: "Arată-mi comenzile mele.",
    group: "Contul meu",
  },
  {
    id: "influencer-earnings",
    title: "Câștigurile mele",
    description: "Câștig confirmat și estimat.",
    icon: PersonalizationIcon,
    prompt: "Cât am câștigat?",
    group: "Contul meu",
  },
  {
    id: "influencer-code",
    title: "Codul meu",
    description: "Codul tău de reducere și linkul personal.",
    icon: SupportIcon,
    prompt: "Care este codul meu?",
    group: "Contul meu",
  },
  {
    id: "influencer-collections",
    title: "Colecțiile mele",
    description: "Selecțiile tale de produse.",
    icon: ShoppingBagIcon,
    prompt: "Arată-mi colecțiile mele.",
    group: "Contul meu",
  },
];

const VENDOR_ROOT_ACTIONS = [
  {
    id: "shopping-menu",
    title: "Cumpărături",
    description:
      "Caută produse, recomandări și idei de cadouri.",
    icon: ShoppingBagIcon,
  },

  {
    id: QUOTE_FLOWS.MY_QUOTES,
    title: "Cererile mele",
    description:
      "Vezi cererile de ofertă trimise de tine și răspunsurile primite.",
    icon: PersonalizationIcon,
  },

  {
    id: QUOTE_FLOWS.VENDOR_QUOTES,
    title: "Cereri primite",
    description:
      "Vezi cererile primite pentru magazinul tău și discută cu clienții.",
    icon: PersonalizationIcon,
  },

  {
    id: "help-menu",
    title: "Ajutor",
    description:
      "Primește ajutor sau discută cu echipa Artfest.",
    icon: SupportIcon,
  },
];

/*
 * Derivat din INFLUENCER_ROOT_ACTIONS - un singur loc de adevăr
 * pentru maparea id -> prompt trimis prin askCopilot (vezi
 * handleAction).
 */
const INFLUENCER_ACTION_PROMPTS = Object.fromEntries(
  INFLUENCER_ROOT_ACTIONS.map((action) => [
    action.id,
    action.prompt,
  ])
);

function getMenus(
  isVendor,
  isInfluencer = false
) {
  return {
    root: {
      title: isVendor
        ? "Administrare magazin"
        : isInfluencer
        ? "Panoul tău de influencer"
        : "Cu ce te putem ajuta?",

      actions: isVendor
        ? VENDOR_ROOT_ACTIONS
        : isInfluencer
        ? INFLUENCER_ROOT_ACTIONS
        : USER_ROOT_ACTIONS,

      parent: null,
    },

    shopping: {
      title: "Cumpărături",
      actions:
        SHOPPING_ACTIONS,
      parent: "root",
    },

   help: {
  title:
    "Ajutor și suport",

  actions:
    HELP_ACTIONS.filter(
      (action) =>
        action.id !== "return" &&
        action.id !== SUPPORT_FLOWS.FAQ
    ),

  parent: "root",
},

    personalization: {
      title:
        "Cerere ofertă",
      actions:
        PERSONALIZATION_ACTIONS,
      parent: "root",
    },

    orders: {
      title: isVendor
        ? "Comenzi"
        : "Comenzile mele",

      actions:
        ORDER_ACTIONS,

      parent: "root",
    },
  };
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

/*
 * FAZA 3 (INFLUENCER) - construiește lista de CTA-uri (choices) din
 * răspunsul handleInfluencerLiveQuery/handleInfluencerOrdersLiveQuery
 * (copilotRouter.js, FAZA 2) - NU inventează text, doar transformă
 * `target`-urile deja calculate de backend în butoane clicabile.
 *
 * Trei forme posibile în `result`, vezi FAZA 2:
 * - influencerScope === "TODAY": result.data e un ARRAY de
 *   recomandări, fiecare cu propriul `target` - un buton per
 *   recomandare (cerința #7: "fiecare recomandare... trebuie să
 *   poată deveni CTA").
 * - result.orders (array) + result.target: un singur buton, spre
 *   comenzile complete.
 * - result.data.target (celelalte scopuri - resources/collections/
 *   discountCodes/earnings/summary): un singur buton.
 */
function buildInfluencerActionChoices(result) {
  if (
    result?.influencerScope === "TODAY" &&
    Array.isArray(result?.data)
  ) {
    return result.data
      .filter((item) => item?.target)
      .map((item, index) => ({
        id: `today-${item.type || index}`,
        label: item.title || "Deschide",
        target: item.target,
      }));
  }

  if (Array.isArray(result?.orders) && result?.target) {
    return [
      {
        id: "orders-target",
        label: result.target.label
          ? `Vezi ${result.target.label}`
          : "Vezi comenzile",
        target: result.target,
      },
    ];
  }

  if (result?.data?.target) {
    return [
      {
        id: "scope-target",
        label: result.data.target.label
          ? `Vezi ${result.data.target.label}`
          : "Deschide",
        target: result.data.target,
      },
    ];
  }

  return [];
}

function normalizeIntentText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/*
 * BUGFIX (audit) - follow-up scurt \u00eentr-o c\u0103utare de produse activ\u0103
 * ("mai ieftine", "ro\u0219ii", "sub 50 lei", "de la alt creator") tastat
 * LIBER (nu prin click pe butonul de sugestie) pornea o c\u0103utare NOU\u0102,
 * literal\u0103, pierz\u00e2nd contextul c\u0103ut\u0103rii anterioare - butoanele de
 * sugestie (handleProductChoice, runProductSearchRefinement) foloseau
 * deja corect searchId-ul, dar text liber nu ajungea niciodat\u0103 acolo.
 *
 * MAX_FOLLOWUP_WORDS - acoper\u0103 exact exemplele cerute ("de la alt
 * creator" = 4 cuvinte, cel mai lung) - un mesaj mai lung e, cel mai
 * probabil, o cerere nou\u0103 \u0219i complet\u0103, nu o rafinare.
 */
const MAX_FOLLOWUP_WORDS = 4;

function countWords(text) {
  return String(text || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

/*
 * Caut\u0103 \u00eenapoi, \u00een istoricul conversa\u021biei, ultimul mesaj care are un
 * searchId de c\u0103utare de produse ata\u0219at (setat de addSearchResultMessage
 * din assistantProducts.js, pe orice rezultat de c\u0103utare textual\u0103 -
 * ACELA\u0218I searchId pe care handleProductChoice \u00eel cite\u0219te deja din
 * sourceMessage.searchId la click pe buton). Text liber nu vine cu un
 * sourceMessage, deci avem nevoie de propriul "cel mai recent" lookup.
 */
function findActiveProductSearchId(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const candidate = messages[i]?.searchId;

    if (candidate) {
      return candidate;
    }
  }

  return null;
}

/*
 * O inten\u021bie deja RECUNOSCUT\u0102 determinist ca fiind altceva dec\u00e2t
 * "produs"/"nimic clar" (suport, cont/login, cerere de ofert\u0103,
 * navigare, clarificare) NU trebuie tratat\u0103 ca rafinare de c\u0103utare,
 * chiar dac\u0103 e scurt\u0103 - protejeaz\u0103 exact flow-urile cerute explicit
 * ("nu strica PLATFORM_KNOWLEDGE, cereri ofert\u0103, login").
 * PLATFORM_KNOWLEDGE/PRODUCT_DISCOVERY/null r\u0103m\u00e2n eligibile pentru
 * rafinare - sunt exact "zona slab\u0103" \u00een care cade un follow-up scurt,
 * f\u0103r\u0103 cuv\u00e2nt-cheie puternic (vezi \u0219i isQuestionLike mai jos, care
 * exclude separat o \u00eentrebare real\u0103 ca "Cum func\u021bioneaz\u0103
 * personalizarea?").
 */
const NON_REFINEMENT_INTENTS = new Set([
  GUEST_INTENTS.SUPPORT,
  GUEST_INTENTS.ACCOUNT_ACTION,
  GUEST_INTENTS.QUOTE_DISCOVERY,
  GUEST_INTENTS.NAVIGATION,
  GUEST_INTENTS.CLARIFY,
]);

function isEligibleActiveSearchFollowUp(value) {
  if (countWords(value) > MAX_FOLLOWUP_WORDS) {
    return false;
  }

  if (isQuestionLike(value)) {
    return false;
  }

  const classification = classifyGuestIntentDeterministic(value);

  return !NON_REFINEMENT_INTENTS.has(classification.intent);
}

/*
 * BUGFIX (audit) - generalizare sistemică: acest fișier avea propriul
 * lanț de regexuri ad-hoc, extins cu câte un patch per bug raportat
 * (vezi istoricul git). Înlocuit cu delegarea la
 * guestIntentTaxonomy.js - un tabel MIC de reguli determinste
 * (7 intenții stabile: PLATFORM_KNOWLEDGE/PRODUCT_DISCOVERY/
 * QUOTE_DISCOVERY/NAVIGATION/ACCOUNT_ACTION/SUPPORT/CLARIFY), testat
 * automat (frontend/scripts/testGuestIntentRouter.mjs, 280+ formulări
 * generate din teme x stiluri de parafrazare). Funcția asta rămâne
 * doar un ADAPTOR subțire, care traduce rezultatul taxonomiei în
 * forma așteptată de dispatch-ul existent din handleSubmit - nu mai
 * conține nicio logică de clasificare proprie.
 */
function detectAssistantIntent(
  value,
  isVendor = false
) {
  const text =
    normalizeIntentText(value);

  if (!text) {
    return null;
  }

/* =========================
   VENDOR - AJUTOR PLATFORMĂ
   (specific widget-ului de VÂNZĂTOR, în afara taxonomiei GUEST -
   verificat ÎNAINTEA delegării, exact ca înainte)
========================= */

if (
  isVendor &&
  /(catalog|import|importa|importare|excel|xlsx|xls|csv|mapping|mapare|coloana|coloane|easysales|easy sales|shopify|woocommerce|export|exporta|descarca model|model excel|imagine in excel|imagini in excel|poza in excel|poze in excel|raport erori|retry|reincerc|sincronizare)/.test(
    text
  )
) {
  return {
    type: "vendor-platform",
  };
}

  const classification =
    classifyGuestIntentDeterministic(value);

  if (!classification.intent) {
    /*
     * Nici regulile determinste, nici small-talk-ul nu au decis -
     * apelantul continuă la copilotul backend (PASUL 2, LLM), exact
     * ca înainte.
     */
    return null;
  }

  const extracted = classification.extracted || {};

  switch (classification.intent) {
    case CHAT_SMALLTALK:
      /*
       * Small talk gol ("salut", "mulțumesc") - nu deschide niciun
       * flow determinist, dar nici nu merită un apel LLM. Lăsăm
       * copilotul general să răspundă scurt (categoria lui
       * GENERAL_CONVERSATION acoperă exact asta).
       */
      return null;

    case GUEST_INTENTS.PRODUCT_DISCOVERY:
      if (extracted.subtype === "image") {
        return { type: "action", actionId: "image-search" };
      }

      return {
        type: "product-search",
        maxPriceCents: extracted.maxPriceCents ?? null,
      };

    case GUEST_INTENTS.QUOTE_DISCOVERY:
      return { type: "menu", menuId: "personalization" };

    case GUEST_INTENTS.NAVIGATION:
      return {
        type: "navigate",
        target: extracted.target || null,
      };

    case GUEST_INTENTS.ACCOUNT_ACTION:
      /*
       * "comanda mea"/"comenzile mele"/"coletul meu" rămân pe
       * flow-ul EXISTENT de tracking (funcționează și pentru guest,
       * prin număr de comandă - vezi GuestOrder.jsx), nu forțează
       * login degeaba. Restul (login/cont/favorite/cererile mele/
       * mesaje/profil) trece prin registrul central de acțiuni.
       */
      if (extracted.orderActionId) {
        return {
          type: "action",
          actionId: extracted.orderActionId,
        };
      }

      return {
        type: "navigate",
        target: extracted.target || null,
      };

    case GUEST_INTENTS.SUPPORT:
      return { type: "support" };

    case GUEST_INTENTS.CLARIFY:
      /*
       * Pasul 3 (clarify, nu ghici) - determinist, pentru cazurile
       * unde regula de mai jos deja ȘTIE că mesajul e prea scurt/
       * ambiguu (ex. "personalizare" fără alt context), fără să mai
       * fie nevoie de un apel LLM doar ca să afle asta.
       */
      return { type: "clarify" };

    case GUEST_INTENTS.PLATFORM_KNOWLEDGE:
    default:
      /*
       * PLATFORM_KNOWLEDGE (și orice altceva neacoperit determinist)
       * - deferă la copilotul backend, exact ca înainte pentru
       * EXPLAIN-guard.
       */
      return null;
  }
}

function getChoiceLabel(choice) {
  if (
    typeof choice === "string"
  ) {
    return choice;
  }

  if (
    choice &&
    typeof choice === "object"
  ) {
    return (
      choice.subject ||
      choice.label ||
      choice.title ||
      choice.name ||
      "Deschide conversația"
    );
  }

  return "Continuă";
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
   Componentă
========================================================= */

export default function AiAssistant({
  isVendor = false,
  isAuthenticated = false,
  role = null,
  embedded = false,

  /*
   * BUGFIX (audit - race event/mount) - payload-ul deep-link-urilor
   * "artfest:personalization-start"/"artfest:quote-request" vine ca
   * PROP de la FloatingHub, nu ca `window.addEventListener` propriu
   * (vezi FloatingHub.jsx) - elimină race-ul în care evenimentul era
   * dispatch-uit înainte ca acest component să fi apucat să se
   * monteze și să-și înregistreze listenerul.
   */
  pendingAssistantEvent = null,
  onPendingAssistantEventHandled = null,
}) {
  /*
   * Widget-ul ăsta nu e montat deloc pentru VENDOR (vezi AppLayout.jsx
   * - VendorAssistant separat, isVendor mereu false aici) - rolul
   * pentru rezolvarea de acțiuni (assistantActionRegistry.js) e deci
   * GUEST/USER (derivat din starea reală de autentificare primită de
   * la AppLayout - useAuth().me, NU dintr-un apel API nou) SAU
   * INFLUENCER, dacă AppLayout.jsx a trimis explicit `role="INFLUENCER"`
   * (FAZA 3) - singurul caz în care rolul REAL, nu doar boolean-ul
   * isAuthenticated, contează pentru acest widget.
   */
  const isInfluencer =
    role === ASSISTANT_ROLES.INFLUENCER;

  const currentRole = isInfluencer
    ? ASSISTANT_ROLES.INFLUENCER
    : isAuthenticated
    ? ASSISTANT_ROLES.USER
    : ASSISTANT_ROLES.GUEST;

  /*
   * FAZA 6 (polish vizual, header) - text/badge DOAR pe baza
   * rolurilor deja rezolvate mai sus (isInfluencer/isVendor/
   * isAuthenticated) - nicio rezolvare de rol nouă. isVendor e mereu
   * false aici (VendorAssistant.jsx tratează VENDOR separat, vezi
   * AppLayout.jsx), dar ramura rămâne corectă/completă dacă asta se
   * schimbă vreodată.
   */
  const headerSubtitle = isInfluencer
    ? "Promovare, resurse și activitatea ta"
    : isVendor
    ? "Produse, comenzi și magazinul tău"
    : isAuthenticated
    ? "Te ajut să găsești și să comanzi"
    : "Îți răspund la întrebări despre Artfest";

  const panelRoleHint = isInfluencer
    ? "Panoul tău de influencer"
    : isVendor
    ? "Panoul tău de vânzător"
    : null;

  const assistantIntroText =
    getAssistantIntroText({
      isInfluencer,
      isVendor,
      isAuthenticated,
    });

  const location =
  useLocation();

  const navigate =
  useNavigate();

  /*
   * PAGE-AWARE: doar pentru boost de knowledge retrieval (vezi
   * knowledgeRetrieval.js) - widget-ul de client nu execută
   * PLATFORM_ACTION, deci nu are nevoie de rezolvare de entitate
   * pentru scriere, doar de pageType pentru "Ce înseamnă asta?"
   * pe o pagină cunoscută (ex. /cereri/:id).
   */
  const { currentPage: derivedCurrentPage, entityFromUrl } = useMemo(
    () => derivePageContext(location.pathname),
    [location.pathname]
  );

  const fileInputRef =
    useRef(null);

  const messagesEndRef =
    useRef(null);

  const supportRefreshRef =
    useRef(false);

    const quoteRefreshRef =
  useRef(false);

/*
 * SELF-RECOVERY (audit) - gardă anti-buclă explicită: cel mult O
 * reîncercare prin routerul general per mesaj trimis. Resetat la
 * începutul fiecărui handleSubmit, setat pe true chiar înainte de
 * reîncercare - dacă din orice motiv codul ar ajunge a doua oară în
 * același punct pentru ACELAȘI mesaj, garda blochează o a doua
 * reîncercare (nu doar structura de control, care oricum nu
 * bucla - dublă protecție, cerută explicit).
 */
const selfRecoveryAttemptedRef =
  useRef(false);

const messagesRef =
  useRef([]);
 const quoteDeepLinkHandledRef =
  useRef(null);

/*
 * Referință, nu ID - `pendingAssistantEvent` e un obiect nou de
 * fiecare dată la un eveniment real (vezi FloatingHub.jsx), deci
 * compararea prin `===` e suficientă pentru "o singură dată".
 */
const processedPendingAssistantEventRef =
  useRef(null);

  useEffect(() => {
    // eslint-disable-next-line no-console
    console.log(
      "[PERSONALIZATION DEBUG] AiAssistant MOUNTED",
      {
        embedded,
        isVendor,
        pendingAssistantEventAtMount:
          pendingAssistantEvent,
      }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dragRef = useRef({
    active: false,
    moved: false,
    pointerId: null,
    startPointerX: 0,
    startPointerY: 0,
    startElementX: 0,
    startElementY: 0,
  });

  const [isOpen, setIsOpen] =
    useState(false);

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
useEffect(() => {
  messagesRef.current =
    messages;
}, [messages]);

  const [
    inputValue,
    setInputValue,
  ] = useState("");

const [
  activeFlow,
  setActiveFlow,
] = useState(null);

const [
  quoteContext,
  setQuoteContext,
] = useState(null);

const [
  quoteDraft,
  setQuoteDraft,
] = useState({
  step: null,
  quantity: null,
  currentFieldIndex: 0,
  answers: {},
});

const [
  personalizationContext,
  setPersonalizationContext,
] = useState(null);

const [
  personalizationDraft,
  setPersonalizationDraft,
] = useState({
  step: null,
  currentFieldIndex: 0,

  selectedOptions: {},
  customAnswers: {},
  repeatedGroupAnswers: {},

  currentGroupIndex: 0,
  currentMemberIndex: 0,
  currentRepeatedFieldIndex: 0,
});

const [
  currentMenu,
  setCurrentMenu,
] = useState("root");

const [
  showMenu,
  setShowMenu,
] = useState(true);

/*
 * FAZA 8-10: triaj de suport activ (clarificare sau confirmare de
 * ticket în curs) - { activeIntent, currentFlow, collectedParams }
 * sau null. Widget-ul de client nu are conversationContext generic
 * ca VendorAssistant.jsx, deci ținem doar acest piece de stare
 * dedicat, populat/golit din result.supportContext întors de
 * copilotRouter.js.
 */
const [
  supportTroubleshootContext,
  setSupportTroubleshootContext,
] = useState(null);

/*
 * Urmărire ieftină a schimbărilor de subiect (vezi
 * computeTopicSuggestion în assistantCopilotRoutes.js) - doar
 * lastCategory + un contor, primite/retrimise la fiecare tură ca să
 * backend-ul poată sugera discret "Vrei să începem un subiect nou?"
 * după mai multe schimbări consecutive, fără niciun apel LLM
 * suplimentar aici.
 */
const [
  topicTracking,
  setTopicTracking,
] = useState({
  lastCategory: null,
  topicChangeStreak: 0,
});

  const [
    uploadedImage,
    setUploadedImage,
  ] = useState(null);

 const [
  visualSearchId,
  setVisualSearchId,
] = useState(null);

  const [
    isSubmitting,
    setIsSubmitting,
  ] = useState(false);

  const [
    supportUnreadCount,
    setSupportUnreadCount,
  ] = useState(0);

  const panelSize =
  getPanelSize();

const menus =
  getMenus(
    isVendor,
    isInfluencer
  );

const menu =
  menus[currentMenu] ||
  menus.root;

  const activeSupportTicketId =
    getTicketIdFromFlow(
      activeFlow
    );

  /* =======================================================
     Persistență poziție
  ======================================================= */
function handleQuoteRequest(detail) {
    // IMPORTANT:
    // poziția curentă este posibil să fie calculată pentru
    // butonul mic de 64px, nu pentru panoul deschis.
    const currentPanelSize = getPanelSize();

    setPosition((current) =>
      clampPosition(
        current,
        currentPanelSize.width,
        currentPanelSize.height
      )
    );

   const normalizedQuoteSchema =
  Array.isArray(
    detail.quoteSchema
  )
    ? detail.quoteSchema
    : [];

setQuoteContext({
  ...detail,
  quoteSchema:
    normalizedQuoteSchema,
});

setCurrentMenu("personalization");

setShowMenu(false);

if (detail.fromStore) {
  setQuoteDraft({
    step: "photo",
    quantity: null,
    currentFieldIndex: 0,
    answers: {},
  });

  setActiveFlow("quote-from-store");

  setMessages([
    createMessage(
      "assistant",
      `Te voi ajuta să pregătești cererea de ofertă pentru ${detail.vendorName || "acest magazin"}.

Înainte să începem, te rog să încarci o fotografie cu produsul sau modelul pe care îl dorești.

Dacă nu ai o fotografie, poți continua și fără ea.`
    ),
  ]);
} else {
  setQuoteDraft({
    step: "quantity",
    quantity: null,
    currentFieldIndex: 0,
    answers: {},
  });

  setActiveFlow("quote-from-product");

  setMessages([
    createMessage(
      "assistant",
      detail.productTitle
        ? `Te ajut să pregătești cererea de ofertă pentru „${detail.productTitle}”.

Pentru început, de câte bucăți ai nevoie?`
        : `Te ajut să pregătești cererea de ofertă.

Pentru început, de câte bucăți ai nevoie?`
    ),
  ]);
}

    // Deschidem după ce am corectat poziția.
    setIsOpen(true);
  }

  function handlePersonalizationStart(
    detail
  ) {
    // eslint-disable-next-line no-console
    console.log(
      "[PERSONALIZATION DEBUG] handlePersonalizationStart fired",
      detail
    );

    if (!detail.productId) {
      // eslint-disable-next-line no-console
      console.log(
        "[PERSONALIZATION DEBUG] handlePersonalizationStart bailed - no detail.productId"
      );

      return;
    }

    /*
     * Panoul poate avea încă poziția
     * calculată pentru bula mică.
     */
    const currentPanelSize =
      getPanelSize();

    setPosition((current) =>
      clampPosition(
        current,
        currentPanelSize.width,
        currentPanelSize.height
      )
    );

    const optionsSchema =
      Array.isArray(
        detail.optionsSchema
      )
        ? detail.optionsSchema
        : [];

    const customSchema =
      Array.isArray(
        detail.customSchema
      )
        ? detail.customSchema
        : [];

    const repeatedGroups =
      Array.isArray(
        detail.repeatedGroups
      )
        ? detail.repeatedGroups
        : [];

    const currentAnswers =
      detail.currentAnswers &&
      typeof detail.currentAnswers ===
        "object"
        ? detail.currentAnswers
        : {};

    const selectedOptions =
      currentAnswers
        .selectedOptions &&
      typeof currentAnswers
        .selectedOptions ===
        "object"
        ? currentAnswers
            .selectedOptions
        : {};

    const customAnswers =
      currentAnswers
        .customAnswers &&
      typeof currentAnswers
        .customAnswers ===
        "object"
        ? currentAnswers
            .customAnswers
        : {};

    const repeatedGroupAnswers =
      currentAnswers
        .repeatedGroupAnswers &&
      typeof currentAnswers
        .repeatedGroupAnswers ===
        "object"
        ? currentAnswers
            .repeatedGroupAnswers
        : {};

    setPersonalizationContext({
      ...detail,

      optionsSchema,
      customSchema,
      repeatedGroups,
    });

    setPersonalizationDraft({
      step: "fields",

      currentFieldIndex: 0,

      selectedOptions,
      customAnswers,
      repeatedGroupAnswers,

      currentGroupIndex: 0,
      currentMemberIndex: 0,
      currentRepeatedFieldIndex: 0,
    });

    /*
     * Este un flow separat de
     * cererea de ofertă.
     */
    setActiveFlow(
      "product-personalization"
    );

    setCurrentMenu(
      "personalization"
    );

    setShowMenu(false);

    /*
     * Identificăm prima întrebare - reutilizăm exact aceleași
     * helpere ca restul flow-ului de personalizare
     * (getTopLevelFields/createFieldQuestionMessage), ca prima
     * întrebare să arate identic cu următoarele (progres, butoane
     * pentru variante cu puține valori).
     */
    const topFields =
      getTopLevelFields({
        optionsSchema,
        customSchema,
      });

    const firstField =
      topFields[0] || null;

    const firstGroup =
      repeatedGroups[0] || null;

    const productLabel =
      detail.productTitle
        ? `«${detail.productTitle}»`
        : "produsul";

    if (!firstField && !firstGroup) {
      setMessages([
        createMessage(
          "assistant",
          `Te ajut să personalizezi ${productLabel} 🤍

Produsul nu are momentan informații de personalizare de completat.`
        ),
      ]);

      setIsOpen(true);
      return;
    }

    /*
     * BUGFIX (audit UX) - mesajul introductiv NU mai include prima
     * întrebare în aceeași bulă - două mesaje separate, ca restul
     * conversației (introducere + pași, apoi întrebarea propriu-zisă
     * cu progres "Pasul X din Y · Câmp").
     */
    const hasRepeatedGroups =
      repeatedGroups.length > 0;

    const stepsLine =
      topFields.length > 0
        ? `Sunt ${
            topFields.length
          } ${
            topFields.length ===
            1
              ? "pas"
              : "pași"
          }${
            hasRepeatedGroups
              ? ", plus câteva detalii suplimentare"
              : ""
          } și îți voi pune întrebările pe rând.`
        : "Îți voi pune întrebările pe rând.";

    const introMessage =
      createMessage(
        "assistant",
        `Te ajut să personalizezi ${productLabel} 🤍

${stepsLine}

Poți reveni oricând la pasul anterior.`
      );

    const firstQuestionMessage =
      firstField
        ? createFieldQuestionMessage(
            {
              field: firstField,

              progress: {
                current: 1,
                total:
                  topFields.length,
              },

              createMessage,
            }
          )
        : createMessage(
            "assistant",
            `Pentru câte persoane dorești ${
              firstGroup.label ||
              firstGroup.title ||
              "acest set"
            }?`
          );

    setMessages([
      introMessage,
      firstQuestionMessage,
    ]);

    setIsOpen(true);
  }

  /*
   * BUGFIX (audit - race event/mount) - payload-ul primit ca prop de
   * la FloatingHub (vezi comentariul de la props, sus) - NU mai
   * ascultăm `window.addEventListener` direct aici, ca să eliminăm
   * fereastra în care evenimentul era dispatch-uit înainte ca acest
   * efect să apuce să se înregistreze (posibil doar la primul
   * montare a componentei, exact cazul care se pierdea). Guard pe
   * REFERINȚA obiectului (nu pe conținut) - `pendingAssistantEvent`
   * e mereu un obiect nou la fiecare eveniment real, deci livrarea e
   * garantat o singură dată per eveniment, inclusiv sub dublul-invoke
   * al efectelor din React StrictMode (dev) - a doua rulare vede
   * aceeași referință deja procesată și iese fără efect.
   */
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.log(
      "[PERSONALIZATION DEBUG] AiAssistant received pending event",
      pendingAssistantEvent
    );

    if (!pendingAssistantEvent) {
      return;
    }

    if (
      processedPendingAssistantEventRef.current ===
      pendingAssistantEvent
    ) {
      // eslint-disable-next-line no-console
      console.log(
        "[PERSONALIZATION DEBUG] pending event already processed (ref guard) - skipping"
      );

      return;
    }

    processedPendingAssistantEventRef.current =
      pendingAssistantEvent;

    if (
      pendingAssistantEvent.type ===
      "artfest:personalization-start"
    ) {
      // eslint-disable-next-line no-console
      console.log(
        "[PERSONALIZATION DEBUG] calling handlePersonalizationStart"
      );

      handlePersonalizationStart(
        pendingAssistantEvent.detail ||
          {}
      );
    } else if (
      pendingAssistantEvent.type ===
      "artfest:quote-request"
    ) {
      // eslint-disable-next-line no-console
      console.log(
        "[PERSONALIZATION DEBUG] calling handleQuoteRequest"
      );

      handleQuoteRequest(
        pendingAssistantEvent.detail ||
          {}
      );
    }

    onPendingAssistantEventHandled?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingAssistantEvent]);

/* =======================================================
   Deschidere automată cerere ofertă din notificare
======================================================= */

useEffect(() => {
  if (
    typeof window ===
    "undefined"
  ) {
    return;
  }


  const params =
  new URLSearchParams(
    location.search
  );

  const assistantTarget =
    String(
      params.get(
        "assistant"
      ) || ""
    ).trim();

  const quoteId =
    String(
      params.get(
        "quoteId"
      ) || ""
    ).trim();

  if (
    !assistantTarget ||
    !quoteId
  ) {
    return;
  }
const deepLinkKey =
  `${assistantTarget}:${quoteId}`;

if (
  quoteDeepLinkHandledRef.current ===
  deepLinkKey
) {
  return;
}
const shouldOpenUserQuote =
  assistantTarget ===
  "quote";

const shouldOpenVendorQuote =
  assistantTarget ===
    "vendor-quote" &&
  isVendor;

  if (
    !shouldOpenUserQuote &&
    !shouldOpenVendorQuote
  ) {
    return;
  }

  /*
   * BUGFIX (audit) - `quoteDeepLinkHandledRef` NU se mai marchează
   * aici, înainte de `await openUserQuote/openVendorQuote` - dacă
   * deschiderea eșuează, link-ul rămânea "handled" definitiv, fără
   * nicio șansă de retry legitim. Acum se marchează abia după ce
   * deschiderea a reușit (vezi mai jos, după `await`).
   */

  let cancelled =
    false;

  async function openQuoteFromUrl() {
    /*
     * Deschidem panoul AI.
     */
    const currentPanelSize =
      getPanelSize();

    setPosition(
      (
        current
      ) =>
        clampPosition(
          current,
          currentPanelSize.width,
          currentPanelSize.height
        )
    );

    setIsOpen(
      true
    );

    setShowMenu(
      false
    );

    setCurrentMenu(
      "root"
    );

    /*
     * Curățăm conversația anterioară.
     */
    setMessages(
      []
    );

    try {
      if (
        shouldOpenVendorQuote
      ) {
        await openVendorQuote({
          quoteId,

          addMessage,
          createMessage,

          setActiveFlow,
          setQuoteContext,
        });
      } else {
        await openUserQuote({
          quoteId,

          addMessage,
          createMessage,

          setActiveFlow,
          setQuoteContext,
        });
        window.dispatchEvent(
  new Event(
    "messages:changed"
  )
);
      }

      /*
       * Deschiderea a reușit - abia acum marcăm deep link-ul ca
       * "handled", ca un eșec (mai jos, în catch) să lase link-ul
       * neatins pentru un retry legitim.
       */
      quoteDeepLinkHandledRef.current =
        deepLinkKey;

      if (
        cancelled
      ) {
        return;
      }

      /*
       * Eliminăm parametrii din URL
       * după deschiderea conversației,
       * fără refresh de pagină.
       */
      const nextUrl =
        new URL(
          window.location.href
        );

      nextUrl.searchParams.delete(
        "assistant"
      );

      nextUrl.searchParams.delete(
        "quoteId"
      );

      window.history.replaceState(
        {},
        "",
        `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`
      );
    } catch (
      error
    ) {
      if (
        cancelled
      ) {
        return;
      }

      addMessage(
        createMessage(
          "assistant",
          humanizeAssistantErrorMessage(
            error,
            "Nu am putut deschide conversația cererii de ofertă."
          )
        )
      );
    }
  }

  openQuoteFromUrl();

  return () => {
    cancelled =
      true;
  };
}, [
  isVendor,
  location.search,
]);

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
     Scroll automat
  ======================================================= */

  useEffect(() => {
    if (!isOpen) {
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

    return () =>
      window.removeEventListener(
        "resize",
        handleResize
      );
  }, [isOpen, embedded]);

  /* =======================================================
     Eliberare URL preview
  ======================================================= */

  useEffect(() => {
    return () => {
      if (
        uploadedImage?.previewUrl
      ) {
        URL.revokeObjectURL(
          uploadedImage.previewUrl
        );
      }
    };
  }, [uploadedImage]);

  /* =======================================================
     Număr conversații suport necitite
  ======================================================= */

  async function refreshSupportUnreadCount() {
    try {
      const count =
        await fetchSupportUnreadCount();

      setSupportUnreadCount(
        count
      );
    } catch {
      setSupportUnreadCount(0);
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function checkUnreadSupport() {
      try {
        const count =
          await fetchSupportUnreadCount();

        if (!cancelled) {
          setSupportUnreadCount(
            count
          );
        }
      } catch {
        if (!cancelled) {
          setSupportUnreadCount(0);
        }
      }
    }

    checkUnreadSupport();

    const intervalId =
      window.setInterval(
        checkUnreadSupport,
        SUPPORT_POLL_INTERVAL
      );

    return () => {
      cancelled = true;

      window.clearInterval(
        intervalId
      );
    };
  }, []);

  /* =======================================================
     Actualizare automată conversație suport
  ======================================================= */

  useEffect(() => {
    if (
      !isOpen ||
      !activeSupportTicketId
    ) {
      return undefined;
    }

    let cancelled = false;

    async function refreshSupportThread() {
      if (
        supportRefreshRef.current
      ) {
        return;
      }

      supportRefreshRef.current =
        true;

      try {
        const result =
          await fetchSupportMessages(
            activeSupportTicketId,
            {
              offset: 0,
              limit: 100,
            }
          );

        if (cancelled) {
          return;
        }

        setMessages(
          (
            currentMessages
          ) =>
            currentMessages.map(
              (message) => {
                if (
                  message?.type !==
                    "support-thread" ||
                  String(
                    message?.ticket
                      ?.id || ""
                  ) !==
                    String(
                      activeSupportTicketId
                    )
                ) {
                  return message;
                }

                return {
                  ...message,
                  supportMessages:
                    result.items,
                  total:
                    result.total,
                };
              }
            )
        );

        await markSupportTicketRead(
          activeSupportTicketId
        ).catch(() => null);

        if (!cancelled) {
          await refreshSupportUnreadCount();
        }
      } catch {
        /*
         * Nu afișăm o eroare la fiecare verificare automată.
         * Utilizatorul poate redeschide conversația manual.
         */
      } finally {
        supportRefreshRef.current =
          false;
      }
    }

    refreshSupportThread();

    const intervalId =
      window.setInterval(
        refreshSupportThread,
        SUPPORT_POLL_INTERVAL
      );

    return () => {
      cancelled = true;

      window.clearInterval(
        intervalId
      );

      supportRefreshRef.current =
        false;
    };
  }, [
    isOpen,
    activeSupportTicketId,
  ]);

  /* =======================================================
   Actualizare automată conversație cerere ofertă
======================================================= */

useEffect(() => {
  const quoteId =
    quoteContext
      ?.quoteRequestId;

  const isQuoteThread =
    activeFlow ===
      QUOTE_FLOWS
        .USER_QUOTE_THREAD ||
    activeFlow ===
      QUOTE_FLOWS
        .VENDOR_QUOTE_THREAD;

  if (
    !isOpen ||
    !isQuoteThread ||
    !quoteId
  ) {
    return undefined;
  }

  let cancelled =
    false;

  async function refreshActiveQuoteThread() {
    if (
      cancelled ||
      quoteRefreshRef.current
    ) {
      return;
    }

    quoteRefreshRef.current =
      true;

    try {
      await refreshQuoteThread({
        activeFlow,

        quoteId,

        /*
         * Folosim întotdeauna
         * ultima versiune a mesajelor.
         */
        currentMessages:
          messagesRef.current,

        addMessage,

        createMessage,
      });
    } catch (
      error
    ) {
      /*
       * Nu afișăm erori automate
       * în conversație.
       */
      console.error(
        "Quote polling failed:",
        error
      );
    } finally {
      quoteRefreshRef.current =
        false;
    }
  }

  /*
   * Verificăm imediat când
   * conversația este deschisă.
   */
  refreshActiveQuoteThread();

  /*
   * Apoi verificăm periodic.
   */
  const intervalId =
    window.setInterval(
      refreshActiveQuoteThread,
      QUOTE_POLL_INTERVAL
    );

  return () => {
    cancelled =
      true;

    window.clearInterval(
      intervalId
    );

    quoteRefreshRef.current =
      false;
  };
}, [
  isOpen,
  activeFlow,
  quoteContext
    ?.quoteRequestId,
]);

  /* =======================================================
     Helpers stare
  ======================================================= */

 function addMessage(
  message
) {
  if (!message) {
    return;
  }

  setMessages(
    (
      current
    ) => {
      /*
       * Evităm adăugarea aceluiași
       * mesaj React de două ori.
       */
      if (
        message?.id &&
        current.some(
          (
            existing
          ) =>
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

      /*
       * Evităm duplicatele venite
       * din istoricul serverului și polling.
       */
      if (
        message?.persistedId &&
        current.some(
          (
            existing
          ) =>
            String(
              existing
                ?.persistedId ||
                ""
            ) ===
            String(
              message
                .persistedId
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

  function removeMessage(
    messageId
  ) {
    setMessages(
      (current) =>
        current.filter(
          (message) =>
            message.id !==
            messageId
        )
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

  function clearUploadedImage() {
    if (
      uploadedImage?.previewUrl
    ) {
      URL.revokeObjectURL(
        uploadedImage.previewUrl
      );
    }

    setUploadedImage(null);
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

  /*
   * Închiderea asistentului NU mai șterge conversația.
   * Utilizatorul poate reveni și continua de unde a rămas.
   * Resetarea completă rămâne disponibilă prin butonul
   * „Conversație nouă”, care apelează resetConversation().
   */
  setIsOpen(false);
}

function resetConversation() {
  clearUploadedImage();

  setMessages([]);

  setInputValue("");
  setActiveFlow(null);
setQuoteContext(null);

setPersonalizationContext(null);

setPersonalizationDraft({
  step: null,
  currentFieldIndex: 0,

  selectedOptions: {},
  customAnswers: {},
  repeatedGroupAnswers: {},

  currentGroupIndex: 0,
  currentMemberIndex: 0,
  currentRepeatedFieldIndex: 0,
});
  setCurrentMenu("root");
  setQuoteDraft({
  step: null,
  quantity: null,
  currentFieldIndex: 0,
  answers: {},
});
  setShowMenu(true);
  setVisualSearchId(null);
  setIsSubmitting(false);
  setSupportTroubleshootContext(null);

  setTopicTracking({
    lastCategory: null,
    topicChangeStreak: 0,
  });

  supportRefreshRef.current = false;
  quoteRefreshRef.current = false;
}

/*
 * "Subiect nou" != "Șterge conversația" (resetConversation, mai sus).
 * Reseteaza EXACT aceleași stări operaționale (flow-ul activ, draft-uri
 * de ofertă/personalizare, contextul de suport) - ca AI-ul să nu mai
 * fie influențat de conversația veche - dar PĂSTREAZĂ istoricul vizual,
 * doar cu un separator clar în listă.
 */
function startNewTopic() {
  clearUploadedImage();

  addMessage(
    createMessage(
      "separator",
      "Subiect nou"
    )
  );

  setInputValue("");
  setActiveFlow(null);
  setQuoteContext(null);

  setPersonalizationContext(null);

  setPersonalizationDraft({
    step: null,
    currentFieldIndex: 0,

    selectedOptions: {},
    customAnswers: {},
    repeatedGroupAnswers: {},

    currentGroupIndex: 0,
    currentMemberIndex: 0,
    currentRepeatedFieldIndex: 0,
  });

  setCurrentMenu("root");
  setQuoteDraft({
    step: null,
    quantity: null,
    currentFieldIndex: 0,
    answers: {},
  });

  setShowMenu(true);
  setVisualSearchId(null);
  setIsSubmitting(false);
  setSupportTroubleshootContext(null);

  setTopicTracking({
    lastCategory: null,
    topicChangeStreak: 0,
  });

  supportRefreshRef.current = false;
  quoteRefreshRef.current = false;
}

  // eslint-disable-next-line no-unused-vars -- butonul din header a fost scos (simplificare header), rămâne apelabilă din alte puncte de intrare ale meniului
  function returnToMainMenu() {
    setCurrentMenu("root");
    setActiveFlow(null);
    setShowMenu(true);
    setVisualSearchId(null);
    setInputValue("");

    clearUploadedImage();

    addMessage(
      createMessage(
        "assistant",
        "Sigur. Alege secțiunea în care dorești să continui."
      )
    );
  }

  function openSubmenu(
    menuId
  ) {
    setCurrentMenu(menuId);
    setShowMenu(true);
  }

  function handleMenuBack() {
    setCurrentMenu(
      menu.parent || "root"
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
  isVendor &&
  actionId ===
    "personalization-menu"
) {
  return;
}

/*
 * FAZA 3 (INFLUENCER) - quick actions care trimit un prompt canonic
 * prin ACELAȘI pipeline ca text liber (askCopilot), nu un flow local
 * nou - identic cu ce ar obține influencerul dacă ar fi tastat
 * exact acel text.
 */
if (INFLUENCER_ACTION_PROMPTS[actionId]) {
  setShowMenu(false);

  const prompt =
    INFLUENCER_ACTION_PROMPTS[actionId];

  addMessage(
    createMessage(
      "user",
      prompt
    )
  );

  await askCopilot(prompt);

  return;
}

    switch (actionId) {
      case "shopping-menu":
        openSubmenu(
          "shopping"
        );
        return;

      case "help-menu":
        openSubmenu("help");
        return;

      case "personalization-menu":
        openSubmenu(
          "personalization"
        );
        return;

      case "orders-menu":
        openSubmenu("orders");
        return;

      default:
        break;
    }

    if (
  actionId ===
  QUOTE_FLOWS.MY_QUOTES
) {
  setShowMenu(false);

  addMessage(
    createMessage(
      "assistant",
      "Aici vezi cererile de ofertă pe care le-ai trimis, conversațiile cu vânzătorii și ofertele primite."
    )
  );

  /*
   * BUGFIX (audit) - pentru GUEST NU mai apelăm fetchMyQuotes() deloc
   * (endpoint-ul e authRequired - vezi backend/src/api/auth.js -
   * întorcea codul tehnic brut "unauthenticated", afișat ca atare de
   * openMyQuotes). Verificăm autentificarea ÎNAINTE de orice apel API
   * și cerem login cu redirect păstrat spre ruta reală (USER_REQUESTS
   * din assistantActionRegistry.js - un singur punct de adevăr pentru
   * rută, nu inventăm alta aici).
   */
  if (!isAuthenticated) {
    addMessage(
      createMessage(
        "assistant",
        "Pentru a vedea cererile tale trebuie să fii autentificat.",
        {
          type: "choices",
          choiceStep: "my-quotes-login-cta",
          choices: ["Autentifică-te"],
        }
      )
    );

    return;
  }

  await openMyQuotes({
    addMessage,
    createMessage,
    setActiveFlow,
  });

  removeLoadingMessages();

  return;
}

if (
  actionId ===
  QUOTE_FLOWS.VENDOR_QUOTES
) {
  setShowMenu(false);

  await openVendorQuotes({
    addMessage,
    createMessage,
    setActiveFlow,
  });

  removeLoadingMessages();

  return;
}

    if (
      actionId !==
      "image-search"
    ) {
      setVisualSearchId(null);
    }

    setActiveFlow(actionId);
    setShowMenu(false);

    const flowContext = {
      actionId,
      addConversation,
      addMessage,
      removeMessage,
      createMessage,
      setActiveFlow,
    };

    try {
      if (
        await startProductFlow(
          flowContext
        )
      ) {
        return;
      }

      if (
        await startSupportFlow(
          flowContext
        )
      ) {
        return;
      }

      if (
        await startPersonalizationFlow(
          flowContext
        )
      ) {
        return;
      }

      if (
        await startOrderFlow(
          flowContext
        )
      ) {
        return;
      }

      addMessage(
        createMessage(
          "assistant",
          "Această funcție va fi conectată în etapa următoare."
        )
      );
    } catch (error) {
      removeLoadingMessages();

      addMessage(
        createMessage(
          "assistant",
          error instanceof Error
            ? error.message
            : "A apărut o problemă la deschiderea acestei secțiuni."
        )
      );
    }
  }

  /*
   * BUGFIX (audit) - "cere ofertă pentru produsul acesta" / "vreau
   * ofertă de la vânzătorul acesta" pornite din TEXT LIBER, nu doar
   * din butonul dedicat de pe pagina de produs/magazin (care
   * declanșează "artfest:quote-request", vezi useEffect mai sus).
   * Reutilizează ACELAȘI flow real (activeFlow "quote-from-product"/
   * "quote-from-store" + createQuoteRequest, în submitQuoteMessage),
   * NU un flow nou - doar un al doilea punct de pornire, cu
   * addMessage (nu setMessages, ca să nu șteargă conversația
   * existentă) și fără să deschidă/repoziționeze widget-ul (e deja
   * deschis, userul tocmai a scris în el).
   *
   * quoteSchema rămâne [] aici (spre deosebire de butonul dedicat,
   * care are acces la produsul complet încărcat) - flow-ul
   * funcționează oricum cu schema goală (doar cantitate), doar fără
   * întrebările custom ale vendorului pentru acel produs.
   */
  async function startDirectVendorQuoteFlow({
    productId = null,
    productTitle = null,
    vendorId = null,
    vendorName = null,
    fromStore = false,
  }) {
    setQuoteContext({
      productId,
      productTitle,
      vendorId,
      vendorName,
      fromStore,
      quoteSchema: [],
    });

    setCurrentMenu("personalization");
    setShowMenu(false);

    if (fromStore) {
      setQuoteDraft({
        step: "photo",
        quantity: null,
        currentFieldIndex: 0,
        answers: {},
      });

      setActiveFlow("quote-from-store");

      addMessage(
        createMessage(
          "assistant",
          `Te ajut să pregătești cererea de ofertă pentru ${vendorName || "acest magazin"}.

Înainte să începem, te rog să încarci o fotografie cu produsul sau modelul pe care îl dorești.

Dacă nu ai o fotografie, poți continua și fără ea.`
        )
      );

      return;
    }

    setQuoteDraft({
      step: "quantity",
      quantity: null,
      currentFieldIndex: 0,
      answers: {},
    });

    setActiveFlow("quote-from-product");

    addMessage(
      createMessage(
        "assistant",
        productTitle
          ? `Te ajut să pregătești cererea de ofertă pentru „${productTitle}”.

Pentru început, de câte bucăți ai nevoie?`
          : `Te ajut să pregătești cererea de ofertă direct către vânzător.

Pentru început, de câte bucăți ai nevoie?`
      )
    );
  }

  /* =======================================================
     Alegeri din mesaje
  ======================================================= */

  /*
   * FAZA 3 (INFLUENCER) - execută un `target` structurat, întors de
   * copilotRouter.js (vezi influencerAssistantCommands.js, FAZA 2) -
   * SINGURUL loc din widget care traduce un target într-o navigare
   * reală, ca să nu apară URL-uri hardcodate în mai multe locuri.
   *
   * Forme suportate (vezi comentariul din assistantActionRegistry.js):
   * - { type: "NAVIGATE", navigateTarget, params } - target STATIC
   *   din registru (INFLUENCER_DASHBOARD/RESOURCES/ORDERS/...),
   *   params (category/activity) adăugate ca query string.
   * - { type: "OPEN_PRODUCT", params: { productId } } - rută
   *   dinamică, rezolvată prin buildDynamicAssistantRoute.
   * - { type: "OPEN_COLLECTION", params: { slug } } - idem, spre
   *   /selectii/:slug.
   */
  function executeAssistantActionTarget(target) {
    if (!target?.type) {
      return;
    }

    if (target.type === ASSISTANT_ACTION_TYPES.NAVIGATE) {
      const resolution = resolveAssistantAction(
        target.navigateTarget,
        {
          role: currentRole,
          isAuthenticated,
        }
      );

      if (resolution.status !== "ok") {
        addMessage(
          createMessage(
            "assistant",
            "Nu am putut deschide asta chiar acum."
          )
        );

        return;
      }

      const route = buildAssistantActionUrl(
        resolution.entry,
        target.params
      );

      navigate(route);
      closeAssistant();

      return;
    }

    /*
     * OPEN_PRODUCT poate veni și cu un `url` deja rezolvat de backend
     * (nu doar `productId`) - ex. targetUrl-ul unei resurse de
     * influencer, setat liber de admin (poate fi intern sau extern),
     * spre deosebire de un id de produs Artfest cunoscut. Verificat
     * ÎNAINTEA rutelor dinamice statice (buildDynamicAssistantRoute),
     * care presupun doar productId/slug interne.
     */
    if (
      target.type === ASSISTANT_ACTION_TYPES.OPEN_PRODUCT &&
      !target.params?.productId &&
      target.params?.url
    ) {
      const url = String(target.params.url);

      if (url.startsWith("/")) {
        navigate(url);
      } else {
        window.open(url, "_blank", "noopener,noreferrer");
      }

      closeAssistant();

      return;
    }

    const dynamicRoute = buildDynamicAssistantRoute(
      target.type,
      target.params
    );

    if (!dynamicRoute) {
      addMessage(
        createMessage(
          "assistant",
          "Nu am putut deschide asta chiar acum."
        )
      );

      return;
    }

    navigate(dynamicRoute);
    closeAssistant();
  }

  async function handleChoice(
    choice,
    sourceMessage = null
  ) {
    /*
     * ANTI-ABANDON - "Continuă cu cerere de ofertă", oferit de
     * productPersonalizationFlow.js când o schemă de personalizare
     * e imposibil de rezolvat (câmp obligatoriu fără opțiuni,
     * repeatedGroup fără identificator). Interceptat AICI, înaintea
     * lui handlePersonalizationChoice (care oricum n-ar ști ce să
     * facă cu acest choice) - face handoff-ul direct către flow-ul
     * deja existent "quote-from-product" (assistantQuotes.js),
     * păstrând produsul curent din personalizationContext. Nu
     * duplică nimic din logica de quote - doar pornește flow-ul
     * exact cum o face handleQuoteRequest mai sus, pentru ramura
     * fără magazin.
     */
    if (
      choice?.action ===
      "personalization-fallback-quote"
    ) {
      addMessage(
        createMessage(
          "user",
          getChoiceLabel(choice)
        )
      );

      const currentPanelSize =
        getPanelSize();

      setPosition((current) =>
        clampPosition(
          current,
          currentPanelSize.width,
          currentPanelSize.height
        )
      );

      setQuoteContext({
        productId:
          personalizationContext
            ?.productId ||
          null,

        productTitle:
          personalizationContext
            ?.productTitle ||
          null,

        image:
          personalizationContext
            ?.image ||
          null,

        quoteSchema: [],
      });

      setQuoteDraft({
        step: "quantity",
        quantity: null,
        currentFieldIndex: 0,
        answers: {},
      });

      setActiveFlow(
        "quote-from-product"
      );

      setCurrentMenu(
        "personalization"
      );

      setShowMenu(false);

      addMessage(
        createMessage(
          "assistant",
          personalizationContext
            ?.productTitle
            ? `Te ajut să pregătești cererea de ofertă pentru „${personalizationContext.productTitle}”.

Pentru început, de câte bucăți ai nevoie?`
            : `Te ajut să pregătești cererea de ofertă.

Pentru început, de câte bucăți ai nevoie?`
        )
      );

      setPersonalizationContext(
        null
      );

      setPersonalizationDraft({
        step: "fields",
        currentFieldIndex: 0,
        selectedOptions: {},
        customAnswers: {},
        repeatedGroupAnswers: {},
        currentGroupIndex: 0,
        currentMemberIndex: 0,
        currentRepeatedFieldIndex: 0,
      });

      return;
    }

    /*
     * FAZA 3 (INFLUENCER) - click pe un CTA atașat unei recomandări/
     * unui răspuns de la copilotRouter.js (vezi askCopilot, blocul
     * "influencer-action" de mai jos) - `choice` e obiectul
     * {id, label, target} construit acolo, NU un string.
     */
    if (
      sourceMessage?.type === "choices" &&
      sourceMessage?.choiceStep === "influencer-action"
    ) {
      addMessage(
        createMessage(
          "user",
          typeof choice === "object"
            ? choice.label || "Deschide"
            : choice
        )
      );

      if (typeof choice === "object") {
        executeAssistantActionTarget(choice.target);
      }

      return;
    }

    /*
     * FAZA 8-10: click pe Confirmă/Renunță al ofertei de ticket
     * propuse de copilot (vezi askCopilot).
     */
    if (
      sourceMessage?.type === "choices" &&
      sourceMessage?.choiceStep ===
        "copilot-ticket-offer"
    ) {
      addMessage(
        createMessage("user", choice)
      );

      if (choice === "Confirmă") {
        await submitCopilotSupportTicket(
          sourceMessage.ticketDraft
        );
      } else {
        addMessage(
          createMessage(
            "assistant",

            "Am înțeles, nu trimit solicitarea către suport. Dacă te răzgândești, scrie-mi din nou."
          )
        );

        setSupportTroubleshootContext(null);
      }

      return;
    }

    /*
     * FAZA 2 (attachments pe calea chat liber): răspuns la eșecul de
     * upload al imaginii atașate, oferit de submitCopilotSupportTicket.
     * "Reîncearcă" reia upload-ul; "Trimite fără imagine" sare direct
     * la creare (finalizeCopilotSupportTicket cu attachment=null, fără
     * un nou upload); "Renunță" oprește fluxul - imaginea locală NU e
     * ștearsă în niciunul din cele 3 cazuri (userul poate încerca din
     * nou manual).
     */
    if (
      sourceMessage?.type === "choices" &&
      sourceMessage?.choiceStep ===
        "copilot-ticket-upload-error"
    ) {
      addMessage(
        createMessage("user", choice)
      );

      if (choice === "Reîncearcă") {
        await submitCopilotSupportTicket(
          sourceMessage.ticketDraft
        );
      } else if (choice === "Trimite fără imagine") {
        await finalizeCopilotSupportTicket(
          sourceMessage.ticketDraft,
          null
        );
      } else {
        addMessage(
          createMessage(
            "assistant",

            "Am înțeles, nu trimit solicitarea către suport. Dacă te răzgândești, scrie-mi din nou."
          )
        );

        setSupportTroubleshootContext(null);
      }

      return;
    }

    /*
     * FAZA 4 (Support × AiAssistant - navigare): CTA-uri "Deschide
     * tichetul"/"Vezi toate în pagina de suport" - amestecate în
     * `choices` alături de OPEN_TICKET/ARCHIVE_TICKET (obiecte
     * `{action, ticketId?, label}`, construite în assistantSupport.js).
     * Interceptate AICI, înaintea lui handleSupportChoice (acel modul
     * e JS pur, fără acces la useNavigate) - navigarea reală se face
     * prin exact același mecanism ca restul asistentului
     * (executeAssistantActionTarget/assistantActionRegistry.js), nu un
     * URL construit manual.
     */
    if (
      choice &&
      typeof choice === "object" &&
      (choice.action === SUPPORT_ACTIONS.OPEN_SUPPORT_PAGE ||
        choice.action === SUPPORT_ACTIONS.OPEN_SUPPORT_TICKET_PAGE)
    ) {
      addMessage(
        createMessage("user", choice.label || "Deschide")
      );

      if (choice.action === SUPPORT_ACTIONS.OPEN_SUPPORT_PAGE) {
        executeAssistantActionTarget({
          type: ASSISTANT_ACTION_TYPES.NAVIGATE,
          navigateTarget: "USER_SUPPORT_TICKETS",
        });
      } else {
        executeAssistantActionTarget({
          type: ASSISTANT_ACTION_TYPES.OPEN_SUPPORT_TICKET,
          params: { ticketId: choice.ticketId },
        });
      }

      return;
    }

    /*
     * Sugestie discretă de schimbare de subiect (vezi askCopilot ->
     * result.suggestTopicReset). "Subiect nou" reutilizează EXACT
     * startNewTopic() - același reset ca la butonul din header,
     * păstrează istoricul, adaugă separatorul vizual.
     */
    /*
     * Răspuns la clarificarea determinstă pentru "personalizare"
     * (mesaj gol, ambiguu - vezi guestIntentTaxonomy.js,
     * clarify-bare-personalization).
     */
    if (
      sourceMessage?.type === "choices" &&
      sourceMessage?.choiceStep === "clarify-personalization"
    ) {
      addMessage(createMessage("user", choice));

      if (choice === "Caut un produs personalizat") {
        setCurrentMenu("shopping");
        setActiveFlow("product-search");
        setShowMenu(false);

        await submitProductMessage({
          activeFlow: "product-search",
          value: "produs personalizat",
          visualSearchId: null,
          addMessage,
          removeMessage,
          createMessage,
        });

        return;
      }

      const wasHandled = await askCopilot(
        "Cum funcționează personalizarea pe Artfest?"
      );

      if (!wasHandled) {
        addMessage(
          createMessage(
            "assistant",
            "Nu am putut verifica informațiile despre platformă."
          )
        );
      }

      return;
    }

    /*
     * CTA "Autentifică-te" din "Cererile mele de ofertă" pentru GUEST
     * (vezi handleAction, QUOTE_FLOWS.MY_QUOTES) - redirect păstrat
     * spre ruta reală (USER_REQUESTS din assistantActionRegistry.js),
     * ca după login userul să ajungă direct acolo, nu înapoi la
     * punctul de plecare.
     */
    if (
      sourceMessage?.type === "choices" &&
      sourceMessage?.choiceStep === "my-quotes-login-cta"
    ) {
      addMessage(createMessage("user", choice));

      const resolution = resolveAssistantAction("USER_REQUESTS", {
        role: currentRole,
        isAuthenticated,
      });

      const url = new URL(window.location.href);

      url.searchParams.set("auth", "login");

      url.searchParams.set(
        "redirect",
        resolution?.entry?.route ||
          window.location.pathname + window.location.search
      );

      navigate(url.pathname + url.search, { replace: false });

      return;
    }

    /*
     * CTA "Creează cont de vânzător" (vezi askCopilot -
     * isVendorSignupInterest) - aceeași rezolvare/navigare OPEN_MODAL
     * ca la target-ul VENDOR_SIGNUP prin comandă directă de navigare
     * ("du-mă la crearea unui cont de vânzător"), un singur punct de
     * adevăr pentru ruta reală (assistantActionRegistry.js).
     */
    if (
      sourceMessage?.type === "choices" &&
      sourceMessage?.choiceStep === "vendor-signup-cta"
    ) {
      addMessage(createMessage("user", choice));

      const resolution = resolveAssistantAction("VENDOR_SIGNUP", {
        role: currentRole,
        isAuthenticated,
      });

      if (
        resolution.status !== "ok" ||
        resolution.entry.action !== ASSISTANT_ACTION_TYPES.OPEN_MODAL
      ) {
        addMessage(
          createMessage(
            "assistant",
            "Nu am putut deschide crearea contului de vânzător chiar acum. Poți încerca din nou în câteva momente."
          )
        );

        return;
      }

      const url = new URL(window.location.href);

      for (const [key, val] of Object.entries(
        resolution.entry.modalParams || {}
      )) {
        url.searchParams.set(key, val);
      }

      navigate(url.pathname + url.search, { replace: false });

      return;
    }

    /*
     * SELF-RECOVERY (audit) - click pe una dintre sugestiile din
     * clarify-ul activ afișat după reîncercarea eșuată prin routerul
     * general (vezi handleSubmit, blocul "SELF-RECOVERY").
     */
    if (
      sourceMessage?.type === "choices" &&
      sourceMessage?.choiceStep === "self-recovery-clarify"
    ) {
      addMessage(createMessage("user", choice));

      if (choice === "Caut un produs") {
        setCurrentMenu("shopping");
        setActiveFlow(null);
        setShowMenu(true);

        addMessage(
          createMessage(
            "assistant",
            "Sigur. Descrie-mi ce cauți (ocazie, buget, tip de produs) sau alege o opțiune din meniu."
          )
        );

        return;
      }

      if (choice === "Vreau să cer o ofertă") {
        setCurrentMenu("personalization");
        setActiveFlow(null);
        setShowMenu(true);

        addMessage(
          createMessage(
            "assistant",
            "Sigur. Te ajut cu cererea de ofertă. Alege cum dorești să continuăm."
          )
        );

        return;
      }

      if (choice === "Vreau ajutor") {
        setCurrentMenu("help");

        await startSupportFlow({
          actionId: SUPPORT_FLOWS.NEW_REQUEST,

          addConversation: (
            _userText,
            assistantText,
            extra = {}
          ) => {
            addMessage(
              createMessage("assistant", assistantText, extra)
            );
          },

          addMessage,
          removeMessage,
          createMessage,
          setActiveFlow,
        });

        return;
      }

      return;
    }

    if (
      sourceMessage?.type === "choices" &&
      sourceMessage?.choiceStep === "topic-suggestion"
    ) {
      addMessage(
        createMessage("user", choice)
      );

      if (choice === "Subiect nou") {
        startNewTopic();
      }

      return;
    }

    /*
     * BUGFIX (audit) - click pe cardul de dezambiguizare "Publică o
     * cerere" vs "Cere ofertă unui vânzător" (vezi
     * detectQuoteRequestIntent -> type "quote-disambiguation").
     */
    if (
      sourceMessage?.type === "choices" &&
      sourceMessage?.choiceStep === "quote-type"
    ) {
      addMessage(
        createMessage("user", choice)
      );

      if (choice === "Publică o cerere") {
        addMessage(
          createMessage(
            "assistant",
            `O cerere publică e vizibilă tuturor vânzătorilor, care pot trimite oferte - se creează din pagina „Cereri” (buton „Publică o cerere”), nu de aici, din conversație.

Poți ajunge acolo din meniul principal, secțiunea Cereri, sau direct la /cereri.`
          )
        );

        return;
      }

      if (choice === "Cere ofertă unui vânzător") {
        if (!entityFromUrl) {
          addMessage(
            createMessage(
              "assistant",
              "Sigur - pentru care produs sau vânzător vrei să ceri ofertă? Deschide pagina produsului/magazinului respectiv, sau spune-mi numele lui."
            )
          );

          return;
        }

        const isStoreEntity =
          entityFromUrl.type === "STORE";

        await startDirectVendorQuoteFlow({
          productId:
            entityFromUrl.type === "PRODUCT"
              ? entityFromUrl.id
              : null,

          productTitle:
            entityFromUrl.type === "PRODUCT"
              ? entityFromUrl.name || null
              : null,

          vendorId: isStoreEntity ? entityFromUrl.id : null,
          vendorName: isStoreEntity ? entityFromUrl.name || null : null,
          fromStore: isStoreEntity,
        });

        return;
      }

      return;
    }

    /*
     * Acțiuni speciale pentru căutarea vizuală.
     */
    if (
      activeFlow ===
        "image-search" &&
      choice ===
        "Încarcă o fotografie"
    ) {
      fileInputRef.current?.click();
      return;
    }

    if (
      activeFlow ===
        "image-search" &&
      choice ===
        "Încarcă altă fotografie"
    ) {
      fileInputRef.current?.click();
      return;
    }

    if (
      activeFlow ===
        "image-search" &&
      choice ===
        "Încearcă din nou"
    ) {
      if (
        uploadedImage?.file
      ) {
        await runVisualSearch(
          uploadedImage.file
        );
      } else {
        fileInputRef.current?.click();
      }

      return;
    }

    /*
     * Deschidere conversație imediat după crearea tichetului.
     */
    if (
      sourceMessage?.type ===
        "support-ticket-created" &&
      choice &&
      typeof choice ===
        "object" &&
      choice.id
    ) {
      addMessage(
        createMessage(
          "user",
          "Deschide conversația"
        )
      );

      await openSupportTicket({
  ticket: choice,
  addMessage,
  removeMessage,
  createMessage,
  setActiveFlow,
});

      removeLoadingMessages();
      return;
    }

    /*
     * Variante FAQ.
     */
    if (
      choice ===
        "Am nevoie de suport" ||
      choice ===
        "Creează o solicitare"
    ) {
      addMessage(
        createMessage(
          "user",
          "Am nevoie de suport."
        )
      );

    await startSupportFlow({
  actionId:
    SUPPORT_FLOWS.NEW_REQUEST,

  addConversation: (
    userText,
    assistantText,
    extra
  ) => {
    addMessage(
      createMessage(
        "assistant",
        assistantText,
        extra
      )
    );
  },

  addMessage,
  removeMessage,
  createMessage,
  setActiveFlow,
});

      removeLoadingMessages();
      return;
    }

    if (
      choice === "Mai caută"
    ) {
      addMessage(
        createMessage(
          "user",
          choice
        )
      );

      setActiveFlow(
        SUPPORT_FLOWS.FAQ
      );

      addMessage(
        createMessage(
          "assistant",
          "Sigur. Scrie o altă întrebare sau reformulează problema."
        )
      );

      return;
    }

    if (
      choice ===
        "Am rezolvat problema"
    ) {
      addMessage(
        createMessage(
          "user",
          choice
        )
      );

      setActiveFlow(null);
      setCurrentMenu("help");
      setShowMenu(true);

      addMessage(
        createMessage(
          "assistant",
          "Mă bucur că am putut ajuta. Poți alege o altă opțiune din meniul de suport."
        )
      );

      return;
    }

    if (
  choice ===
  "Mergi la produse"
) {
  closeAssistant();

  window.location.href =
    "/produse";

  return;
}

    const choiceLabel =
      getChoiceLabel(choice);

    addMessage(
      createMessage(
        "user",
        choiceLabel
      )
    );

    const context = {
      activeFlow,
      choice,
      sourceMessage,
      addMessage,
      removeMessage,
      createMessage,
      setActiveFlow,
      setQuoteContext,
    };

    try {
      const personalizationHandled =
        await handlePersonalizationChoice(
          {
            activeFlow,
            choice,

            personalizationContext,
            personalizationDraft,

            addMessage,
            createMessage,

            setActiveFlow,
            setPersonalizationDraft,
          }
        );

      if (
        personalizationHandled
      ) {
        removeLoadingMessages();
        return;
      }

      const quoteHandled =
  await handleQuoteChoice(
    context
  );

if (
  quoteHandled
) {
  removeLoadingMessages();
  return;
}
      const productHandled =
        await handleProductChoice(
          {
            ...context,
            visualSearchId,
          }
        );

      if (
        productHandled
      ) {
        return;
      }

      const supportHandled =
        await handleSupportChoice(
          context
        );

      if (
        supportHandled
      ) {
        removeLoadingMessages();
        return;
      }

      const orderHandled =
        await handleOrderChoice(
          context
        );

      if (
        orderHandled
      ) {
        return;
      }
    } catch (error) {
      removeLoadingMessages();

      addMessage(
        createMessage(
          "assistant",
          error instanceof Error
            ? error.message
            : "Nu am putut procesa selecția. Te rog să încerci din nou."
        )
      );
    }
  }

  /* =======================================================
     Căutare vizuală
  ======================================================= */

  /*
   * BUGFIX (audit): logica a fost extrasă în assistantProducts.js
   * (runImageSearchFlow) ca să poată fi refolosită IDENTIC de
   * VendorAssistant.jsx - un singur loc care caută produse după
   * fotografie, nu două sisteme paralele.
   */
  async function runVisualSearch(
    file
  ) {
    return runImageSearchFlow({
      file,
      addMessage,
      removeMessage,
      createMessage,
      setVisualSearchId,
    });
  }

  /* =======================================================
     Încărcare imagine
  ======================================================= */

 async function handleImageChange(event) {
  const file =
    event.target.files?.[0];

  if (!file) {
    return;
  }

  /*
   * =====================================================
   * VALIDARE FIȘIER
   * =====================================================
   */

  if (
    !file.type.startsWith(
      "image/"
    )
  ) {
    addMessage(
      createMessage(
        "assistant",
        "Fișierul selectat nu este o imagine validă."
      )
    );

    event.target.value = "";
    return;
  }

  if (
    file.size >
    10 * 1024 * 1024
  ) {
    addMessage(
      createMessage(
        "assistant",
        "Imaginea este prea mare. Te rog să alegi un fișier de maximum 10 MB."
      )
    );

    event.target.value = "";
    return;
  }

  /*
   * Curățăm imaginea veche.
   */
  clearUploadedImage();

  const previewUrl =
    URL.createObjectURL(file);

  const nextUploadedImage = {
    file,
    previewUrl,
  };

  setUploadedImage(
    nextUploadedImage
  );

  /*
   * =====================================================
   * AFIȘARE POZĂ ÎN CHAT
   * =====================================================
   */

  const isQuoteConversation =
    activeFlow ===
      QUOTE_FLOWS
        .USER_QUOTE_THREAD ||
    activeFlow ===
      QUOTE_FLOWS
        .VENDOR_QUOTE_THREAD;

  /*
   * Pentru quote thread fotografia
   * va veni din server/polling.
   *
   * Pentru celelalte flow-uri o
   * afișăm imediat.
   */
  if (!isQuoteConversation) {
    addMessage({
      id:
        `${Date.now()}-image`,

      role: "user",

      type: "image",

      content:
        "Fotografie încărcată",

      imageUrl:
        previewUrl,

      filename:
        file.name,
    });
  }

  /*
   * =====================================================
   * PERSONALIZARE PRODUS
   * =====================================================
   *
   * Dacă utilizatorul se află în
   * configurarea unui produs, fotografia
   * este răspunsul pentru câmpul curent.
   *
   * Nu mai trebuie să scrie
   * „gata” sau „mai departe”.
   */

  if (
    activeFlow ===
    "product-personalization"
  ) {
    try {
      setIsSubmitting(true);

      const handled =
        await submitProductPersonalizationMessage({
          activeFlow,

          /*
           * Nu avem mesaj text.
           * Fișierul este răspunsul.
           */
          value: "",

          personalizationContext,
          personalizationDraft,

          uploadedImage:
            nextUploadedImage,

          addMessage,
          createMessage,

          setActiveFlow,
          setPersonalizationDraft,

          clearUploadedImage,
        });

      event.target.value = "";

      if (handled) {
        return;
      }
    } catch (error) {
      event.target.value = "";

      addMessage(
        createMessage(
          "assistant",
          humanizeAssistantErrorMessage(
            error,
            "Nu am putut prelua fotografia pentru personalizare."
          )
        )
      );

      return;
    } finally {
      setIsSubmitting(false);
    }
  }

  /*
   * Resetăm input-ul pentru ca aceeași
   * fotografie să poată fi selectată
   * din nou ulterior.
   */
  event.target.value = "";

  /*
   * =====================================================
   * CĂUTARE VIZUALĂ ACTIVĂ
   * =====================================================
   */

  if (
    activeFlow ===
    "image-search"
  ) {
    setVisualSearchId(null);

    await runVisualSearch(
      file
    );

    return;
  }

  /*
   * =====================================================
   * FOTOGRAFIE ÎNCĂRCATĂ DIRECT
   * =====================================================
   *
   * Dacă utilizatorul încarcă o fotografie
   * fără să fi pornit explicit un flow,
   * pornim căutarea vizuală.
   */

  const canStartVisualSearch =
    !activeFlow ||
    [
      "product-search",
      "gift",
      "budget",
    ].includes(
      activeFlow
    );

  if (canStartVisualSearch) {
    setCurrentMenu(
      "shopping"
    );

    setShowMenu(false);

    setActiveFlow(
      "image-search"
    );

    setVisualSearchId(null);

    await runVisualSearch(
      file
    );

    return;
  }

  /*
   * =====================================================
   * ATAȘAMENT ÎN CONVERSAȚIE CERERE OFERTĂ
   * =====================================================
   */

  const isUserQuoteThread =
    activeFlow ===
    QUOTE_FLOWS
      .USER_QUOTE_THREAD;

  const isVendorQuoteThread =
    activeFlow ===
    QUOTE_FLOWS
      .VENDOR_QUOTE_THREAD;

  if (
    (
      isUserQuoteThread ||
      isVendorQuoteThread
    ) &&
    quoteContext?.threadId
  ) {
    try {
      setIsSubmitting(
        true
      );

      /*
       * Vendorul și clientul folosesc
       * endpoint-uri diferite.
       */
      if (
        isVendorQuoteThread
      ) {
        await sendVendorQuoteAttachment(
          quoteContext.threadId,
          file
        );
      } else {
        await sendQuoteAttachment(
          quoteContext.threadId,
          file
        );
      }

      addMessage(
        createMessage(
          "assistant",
          "Fotografia a fost verificată și trimisă în conversație."
        )
      );

      clearUploadedImage();

      /*
       * Mesajul real cu fotografia
       * va apărea prin polling.
       */
      return;
    } catch (error) {
      addMessage(
        createMessage(
          "assistant",
          humanizeAssistantErrorMessage(
            error,
            "Fotografia nu a putut fi trimisă."
          )
        )
      );

      clearUploadedImage();

      return;
    } finally {
      setIsSubmitting(
        false
      );
    }
  }

  /*
   * =====================================================
   * CERERE OFERTĂ DIN MAGAZIN
   * =====================================================
   *
   * Păstrăm comportamentul existent
   * pentru fotografia inițială din
   * quote-from-store.
   */

  if (
    activeFlow ===
    "quote-from-store"
  ) {
    const response =
      getPersonalizationImageUploadResponse?.(
        {
          activeFlow,
          uploadedImage:
            nextUploadedImage,
        }
      );

    if (response) {
      if (
        typeof response ===
        "string"
      ) {
        addMessage(
          createMessage(
            "assistant",
            response
          )
        );
      } else {
        addMessage(
          createMessage(
            "assistant",
            response.content ||
              "Fotografia a fost adăugată.",
            response.extra || {}
          )
        );
      }
    }

    return;
  }

  /*
   * =====================================================
   * RĂSPUNSURI GENERICE PENTRU CELELALTE FLOW-URI
   * =====================================================
   */

  const productResponse =
    getProductImageUploadResponse?.(
      {
        activeFlow,
        uploadedImage:
          nextUploadedImage,
      }
    );

  if (productResponse) {
    if (
      typeof productResponse ===
      "string"
    ) {
      addMessage(
        createMessage(
          "assistant",
          productResponse
        )
      );
    } else {
      addMessage(
        createMessage(
          "assistant",
          productResponse.content ||
            "Fotografia a fost încărcată.",
          productResponse.extra || {}
        )
      );
    }

    return;
  }

  const supportResponse =
    getSupportImageUploadResponse?.(
      {
        activeFlow,
        uploadedImage:
          nextUploadedImage,
      }
    );

  if (supportResponse) {
    if (
      typeof supportResponse ===
      "string"
    ) {
      addMessage(
        createMessage(
          "assistant",
          supportResponse
        )
      );
    } else {
      addMessage(
        createMessage(
          "assistant",
          supportResponse.content ||
            "Fotografia a fost încărcată.",
          supportResponse.extra || {}
        )
      );
    }

    return;
  }

  const orderResponse =
    getOrderImageUploadResponse?.(
      {
        activeFlow,
        uploadedImage:
          nextUploadedImage,
      }
    );

  if (orderResponse) {
    if (
      typeof orderResponse ===
      "string"
    ) {
      addMessage(
        createMessage(
          "assistant",
          orderResponse
        )
      );
    } else {
      addMessage(
        createMessage(
          "assistant",
          orderResponse.content ||
            "Fotografia a fost încărcată.",
          orderResponse.extra || {}
        )
      );
    }

    return;
  }
}

    /* =======================================================
     Copilot general (FAZA 5) - orice mesaj liber care nu se
     potrivește cu niciun flow local (product/order/support/quote/
     personalizare - vezi detectAssistantIntent) trece prin
     routerul general înainte de fallback-ul generic vechi.
     Înlocuiește vechiul askVendorPlatform (care trimitea TOATE
     manifestele, doar pentru vendor) cu noul copilot, disponibil
     pentru orice audiență (USER/VENDOR/GUEST), cu retrieval
     selectiv - nu mai trimitem tot knowledge-ul la fiecare mesaj.
  ======================================================= */

  /*
   * FAZA 2 (attachments pe calea chat liber): upload-ul se face O
   * SINGURĂ dată, la confirmare - nu la atașare. Reutilizează EXACT
   * endpoint-ul deja existent și deja guest-safe (nu cere
   * autentificare) folosit de fluxul de personalizare produs -
   * `POST /api/upload/customization` - nu un bucket/model nou. Shape-ul
   * întors ({url, name, size, mimeType}) se mapează 1:1 pe ce așteaptă
   * deja createAttachmentRows() pe backend (neatins).
   */
  async function uploadCopilotSupportAttachment(file) {
    const formData = new FormData();
    formData.append("file", file);

    const data = await api("/api/upload/customization", {
      method: "POST",
      body: formData,
    });

    return {
      url: data?.url,
      name: data?.name,
      size: data?.size,
      mimeType: data?.mimeType,
    };
  }

  /*
   * FAZA 8-10: execută crearea tichetului de suport propus de
   * copilot - reutilizează EXACT createSupportTicket() deja
   * existent (POST /api/assistant/support/tickets), nu duplicăm
   * logica de creare. ticketDraft vine gata construit
   * (subject/category/priority/message) din
   * supportEscalationService.js pe backend.
   *
   * `attachment` (obiectul deja uploadat, sau null) e primit gata
   * construit - această funcție NU face upload, doar creează tichetul.
   * Separarea asta e ce permite "Trimite fără imagine" (după un upload
   * eșuat) să reintre direct aici, fără să reîncerce upload-ul.
   */
  async function finalizeCopilotSupportTicket(
    ticketDraft,
    attachment
  ) {
    let requestPayload = {
      subject: ticketDraft.subject,
      category: ticketDraft.category,
      priority: String(
        ticketDraft.priority || "medium"
      ).toLowerCase(),
      message: ticketDraft.message,
      attachments: attachment ? [attachment] : [],
    };

    try {
      let result;

      try {
        result = await createSupportTicket(requestPayload);
      } catch (error) {
        /*
         * FAZA 1 (fix guest pe calea chat liber) - același pattern ca
         * submitSupportMessage() din Support/assistantSupport.js:
         * backendul cere email doar pentru utilizatorii neautentificați
         * (POST /api/assistant/support/tickets întoarce
         * `guest_email_required` - vezi supportApi.js, care mapează
         * `data.error` pe `error.code`). Orice altă eroare urcă
         * neschimbată la catch-ul exterior. `attachments` rămâne în
         * requestPayload la retry (spread mai jos) - imaginea deja
         * uploadată NU se re-uploadează a doua oară.
         */
        if (error?.code !== "guest_email_required") {
          throw error;
        }

        const guestName = (
          window.prompt("Introdu numele tău:") || ""
        ).trim();

        const guestEmail = (
          window.prompt("Introdu adresa ta de email:") || ""
        )
          .trim()
          .toLowerCase();

        if (!guestEmail) {
          throw new Error(
            "Adresa de email este obligatorie pentru trimiterea solicitării."
          );
        }

        requestPayload = {
          ...requestPayload,
          name: guestName,
          email: guestEmail,
        };

        result = await createSupportTicket(requestPayload);
      }

      addMessage(
        createMessage(
          "assistant",

          result.mode === "guest"
            ? "Am trimis solicitarea către echipa de suport. Vei primi răspunsul pe email."
            : "Am trimis solicitarea către echipa de suport. Vei fi contactat cât mai curând."
        )
      );

      /*
       * Ticket creat cu succes (cu sau fără imagine) - imaginea locală
       * nu mai are rost în composer.
       */
      clearUploadedImage();
    } catch (error) {
      addMessage(
        createMessage(
          "assistant",

          error instanceof Error
            ? error.message
            : "Nu am putut trimite solicitarea către suport."
        )
      );
    } finally {
      setSupportTroubleshootContext(null);
    }
  }

  async function submitCopilotSupportTicket(
    ticketDraft
  ) {
    const imageFile = uploadedImage?.file || null;

    if (!imageFile) {
      await finalizeCopilotSupportTicket(ticketDraft, null);
      return;
    }

    let attachment;

    try {
      attachment = await uploadCopilotSupportAttachment(imageFile);
    } catch {
      /*
       * Upload eșuat - NU trimitem tichetul silențios fără imagine.
       * Imaginea rămâne atașată local (nu chemăm clearUploadedImage
       * aici) - userul poate reîncerca, trimite fără ea, sau renunța.
       */
      addMessage(
        createMessage(
          "assistant",

          "Nu am putut încărca imaginea atașată.",
          {
            type: "choices",
            choiceStep: "copilot-ticket-upload-error",
            ticketDraft,
            choices: [
              "Reîncearcă",
              "Trimite fără imagine",
              "Renunță",
            ],
          }
        )
      );

      return;
    }

    await finalizeCopilotSupportTicket(ticketDraft, attachment);
  }

  async function askCopilot(value) {
    const loadingMessageId = `${Date.now()}-copilot-loading`;

    addMessage({
      id: loadingMessageId,
      role: "assistant",
      type: "loading",

      content: isInfluencer
        ? "Mă uit în contul tău…"
        : "Verific informațiile despre platformă...",
    });

    try {
      const history = messagesRef.current
        .filter(
          (message) =>
            message?.type === "text" &&
            (message?.role === "user" ||
              message?.role === "assistant")
        )
        .slice(-10)
        .map((message) => ({
          role: message.role,
          content: String(message.content || ""),
        }));

      const result = await sendCopilotAsk({
        message: value,
        history,

        currentPage: derivedCurrentPage,
        currentEntity: entityFromUrl,

        conversationContext: {
          ...(supportTroubleshootContext || {}),
          lastCategory: topicTracking.lastCategory,
          topicChangeStreak:
            topicTracking.topicChangeStreak,
        },
      });

      removeMessage(loadingMessageId);

      setTopicTracking({
        lastCategory: result?.lastCategory ?? null,
        topicChangeStreak:
          result?.topicChangeStreak ?? 0,
      });

      if (result?.handled) {
        /*
         * FAZA 8-10: sincronizează triajul de suport - prezent
         * DOAR pe rezultate din SUPPORT_TROUBLESHOOT (obiect sau
         * explicit null pentru resetare); pe orice alt rezultat
         * cheia lipsește complet, nu atingem starea de suport.
         */
        if (result && "supportContext" in result) {
          setSupportTroubleshootContext(
            result.supportContext || null
          );
        }

        /*
         * Userul a TASTAT "da" la întrebarea de trimitere a
         * ticketului - executăm direct.
         */
        if (
          result.autoConfirm &&
          result.pendingAction?.kind ===
            "CREATE_SUPPORT_TICKET"
        ) {
          await submitCopilotSupportTicket(
            result.pendingAction
          );

          return true;
        }

        /*
         * Ofertă de ticket (prima tură) - mesaj + card cu
         * Confirmă/Renunță, reutilizând pattern-ul deja existent
         * de mesaje "choices" (vezi handleChoice).
         */
        if (
          result.resultType === "pending_action" &&
          result.pendingAction?.kind ===
            "CREATE_SUPPORT_TICKET"
        ) {
          addMessage(
            createMessage(
              "assistant",

              result.message ||
                "Vrei să trimit solicitarea către suport?",

              {
                type: "choices",
                choiceStep: "copilot-ticket-offer",
                ticketDraft: result.pendingAction,
                choices: ["Confirmă", "Renunță"],
              }
            )
          );

          return true;
        }

        /*
         * BUGFIX (audit) - "semantic fallback" formalizat (cerința
         * #2/#6 din audit): mapBackendCategoryToGuestIntent traduce
         * ORICE categorie întoarsă de copilotRouter.js înapoi în
         * taxonomia fixă de 7 intenții - un guard de compilare, nu
         * doar convenție (funcția are un switch STRICT, cu default
         * CLARIFY - nu poate "inventa" o intenție liberă).
         *
         * Țintă "nu știu" < 5%: dacă e PLATFORM_KNOWLEDGE dar
         * retrieval-ul n-a găsit NICIUN manifest relevant
         * (manifestIds gol - semnal determinist, din backend, nu o
         * presupunere), afișăm o clarificare ACTIVĂ (cere o
         * reformulare concretă) în loc de răspunsul pasiv "Nu am
         * suficiente informații" - un dead-end nu mai e ultima
         * opțiune, e doar fallback-ul final dacă userul tot nu
         * poate reformula (vezi mai jos, mesajul rămâne disponibil).
         */
        const mappedIntent = mapBackendCategoryToGuestIntent(
          result.category,
          result.intentMode
        );

        const hasNoKnowledgeMatch =
          mappedIntent === GUEST_INTENTS.PLATFORM_KNOWLEDGE &&
          Array.isArray(result.manifestIds) &&
          result.manifestIds.length === 0;

        if (hasNoKnowledgeMatch) {
          addMessage(
            createMessage(
              "assistant",

              "Nu sunt sigur ce anume vrei să știi despre asta. Poți reformula mai concret? De exemplu: „cum funcționează livrarea”, „pot cumpăra fără cont” sau „cum caut un produs”."
            )
          );

          return true;
        }

        const suggestionLines =
          Array.isArray(result.suggestions) &&
          result.suggestions.length
            ? `\n\n${result.suggestions
                .slice(0, 3)
                .map((s) => `• ${s}`)
                .join("\n")}`
            : "";

        /*
         * FAZA 5 (polish vizual, INFLUENCER) - un răspuns de date live
         * (influencerScope setat de handleInfluencerLiveQuery SAU
         * `orders` prezent de la handleInfluencerOrdersLiveQuery,
         * copilotRouter.js) primește randare dedicată (mini-carduri
         * pentru "Ce fac azi?", card cu date evidențiate pentru
         * restul) - vezi AssistantMessage.jsx, ramura
         * `choiceStep === "influencer-action"`. type RĂMÂNE "choices"
         * (nu ating handleChoice - gate-ul lui existent, pe
         * type==="choices" + choiceStep, rămâne singura sursă de
         * adevăr pentru rutare). Interpretarea câmpurilor din `result`
         * (message/data/influencerScope/orders/target) e neschimbată -
         * doar ÎN CE mesaj/componentă ajung.
         *
         * Orice alt răspuns (inclusiv o întrebare generală de la un
         * influencer, ex. PLATFORM_KNOWLEDGE) cade pe else - fluxul
         * vechi, identic, neschimbat.
         */
        const isInfluencerLiveData =
          isInfluencer &&
          Boolean(
            result.influencerScope ||
              Array.isArray(result.orders)
          );

        if (isInfluencerLiveData) {
          const influencerChoices =
            buildInfluencerActionChoices(result);

          const hasTodayCards =
            result.influencerScope === "TODAY" &&
            Array.isArray(result.data) &&
            result.data.length > 0;

          if (!hasTodayCards) {
            addMessage(
              createMessage(
                "assistant",

                result.message ||
                  "Nu am suficiente informații pentru a răspunde."
              )
            );
          }

          if (hasTodayCards || influencerChoices.length) {
            addMessage(
              createMessage(
                "assistant",

                "",

                {
                  type: "choices",
                  choiceStep: "influencer-action",
                  choices: influencerChoices,

                  influencerScope:
                    result.influencerScope || null,

                  liveData:
                    result.data === undefined
                      ? null
                      : result.data,

                  orders:
                    result.orders === undefined
                      ? null
                      : result.orders,
                }
              )
            );
          }
        } else {
          addMessage(
            createMessage(
              "assistant",

              (result.message ||
                "Nu am suficiente informații pentru a răspunde.") +
                suggestionLines
            )
          );
        }

        /*
         * CTA "Creează cont de vânzător" (Problema 1, cerința A+B) -
         * mesajul de explicație de mai sus a răspuns deja la "cum
         * devin vânzător?"; dacă mesajul userului a semnalat clar
         * interes de a deveni vânzător, adăugăm și butonul de
         * navigare directă, ca userul să nu mai trebuiască să
         * reformuleze ca să ajungă la înregistrare. resolveAssistantAction
         * e sursa de adevăr (nu presupunem GUEST - un USER autentificat
         * n-ar avea acces la acest target, vezi allowedRoles din
         * assistantActionRegistry.js).
         */
        if (
          isVendorSignupInterest(value) &&
          resolveAssistantAction("VENDOR_SIGNUP", {
            role: currentRole,
            isAuthenticated,
          }).status === "ok"
        ) {
          addMessage(
            createMessage(
              "assistant",

              "",

              {
                type: "choices",
                choiceStep: "vendor-signup-cta",
                choices: ["Creează cont de vânzător"],
              }
            )
          );
        }

        /*
         * Sugestie discretă, separată de răspunsul propriu-zis -
         * doar dacă backend-ul a confirmat (schimbări reale
         * repetate, nimic în așteptare de confirmare).
         */
        if (result.suggestTopicReset) {
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

        return true;
      }

      /*
       * handled:false - mesajul nu e o categorie tratată de
       * copilot (flow existent) - apelantul trebuie să continue
       * EXACT cu comportamentul vechi, neschimbat.
       */
      return false;
    } catch (error) {
      removeMessage(loadingMessageId);

      console.error(
        "[AiAssistant] copilot:",
        error
      );

      /*
       * Copilotul e un strat ADIȚIONAL - dacă eșuează (rețea/
       * server), nu blocăm conversația, lăsăm apelantul să
       * continue cu fallback-ul vechi.
       */
      return false;
    }
  }

    /* =======================================================
     Trimitere mesaj
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

   const protectedFlows = [
  SUPPORT_FLOWS.CONVERSATIONS,
  QUOTE_FLOWS.USER_QUOTE_THREAD,
  QUOTE_FLOWS.VENDOR_QUOTE_THREAD,
  "quote-from-store",
  "quote-from-product",
  "product-personalization",
];

const canSwitchIntent =
  !activeFlow ||
  !protectedFlows.includes(
    activeFlow
  );

/*
 * BUGFIX (audit) - detectQuoteRequestIntent verificat ÎNAINTEA
 * detectorului general: e mai specific pentru mesaje despre cereri
 * de ofertă (distinge public vs direct-la-vendor vs listare), ceea
 * ce detectAssistantIntent nu face - vezi assistantQuotes.js.
 */
const directIntent =
  canSwitchIntent
    ? detectQuoteRequestIntent(value, {
        hasCurrentEntity: Boolean(entityFromUrl),
      }) ||
      detectAssistantIntent(
        value,
        isVendor
      )
    : null;

    const shouldDelayUserMessage =
  activeFlow ===
    QUOTE_FLOWS.USER_QUOTE_THREAD ||
  activeFlow ===
    QUOTE_FLOWS.VENDOR_QUOTE_THREAD;

if (
  !shouldDelayUserMessage
) {
  addMessage(
    createMessage(
      "user",
      value
    )
  );
}

setInputValue("");
setIsSubmitting(true);
selfRecoveryAttemptedRef.current = false;

    try {
      /*
       * ===================================================
       * FOLLOW-UP SCURT ÎNTR-O CĂUTARE DE PRODUSE ACTIVĂ
       * (text liber, nu click pe buton - vezi
       * isEligibleActiveSearchFollowUp/findActiveProductSearchId
       * mai sus) - verificat ÎNAINTEA oricărui alt dispatch, exact
       * cum cere regula: "dacă există context activ ȘI mesajul e o
       * rafinare scurtă, folosește căutarea anterioară ca bază;
       * altfel, mesajul normal prin router".
       * ===================================================
       */
      if (
        activeFlow === "product-search" &&
        isEligibleActiveSearchFollowUp(value)
      ) {
        const activeSearchId = findActiveProductSearchId(
          messagesRef.current
        );

        if (activeSearchId) {
          await runProductSearchRefinement({
            searchId: activeSearchId,
            instruction: value,
            addMessage,
            removeMessage,
            createMessage,
          });

          return;
        }
      }

      /*
       * ===================================================
       * PRODUSE
       * ===================================================
       */
/*
 * ===================================================
 * TEXT LIBER DIN MENIUL PRINCIPAL
 * ===================================================
 */

if (directIntent) {
  const isSwitchingFlow =
  activeFlow &&
  (
    activeFlow !==
      directIntent.actionId &&
    activeFlow !==
      directIntent.type
  );

if (isSwitchingFlow) {
  setActiveFlow(null);
  setVisualSearchId(null);

  if (
    activeFlow ===
    "image-search"
  ) {
    clearUploadedImage();
  }
}
  setShowMenu(false);

  if (
  directIntent.type ===
    "vendor-platform"
) {
  const wasHandled = await askCopilot(value);

  if (wasHandled) {
    return;
  }

  /*
   * Fallback determinist: dacă noul copilot nu a putut răspunde
   * (handled:false sau eroare de rețea), păstrăm EXACT
   * comportamentul vechi pentru vendor (askVendorPlatform, care
   * cunoaște doar manifestele vechi, dar tot răspunde ceva util).
   */
  if (isVendor) {
    const loadingMessageId =
      `${Date.now()}-vendor-platform-loading`;

    addMessage({
      id: loadingMessageId,
      role: "assistant",
      type: "loading",
      content:
        "Verific informațiile despre platformă...",
    });

    try {
      const history =
        messagesRef.current
          .filter(
            (message) =>
              message?.type ===
                "text" &&
              (
                message?.role ===
                  "user" ||
                message?.role ===
                  "assistant"
              )
          )
          .slice(-10)
          .map(
            (message) => ({
              role:
                message.role,

              content:
                String(
                  message.content ||
                    ""
                ),
            })
          );

      const result =
        await askVendorPlatform({
          message: value,

          history,

          pageContext: {
            page:
              location.pathname,

            route:
              location.pathname,

            tab:
              new URLSearchParams(
                location.search
              ).get("tab") || "",
          },
        });

      removeMessage(
        loadingMessageId
      );

      addMessage(
        createMessage(
          "assistant",
          result?.message ||
            "Nu am suficiente informații pentru a răspunde."
        )
      );

      return;
    } catch (error) {
      removeMessage(
        loadingMessageId
      );

      addMessage(
        createMessage(
          "assistant",
          humanizeAssistantErrorMessage(
            error,
            "Nu am putut verifica informațiile despre platformă."
          )
        )
      );

      return;
    }
  }
}

  /* ======================================
     ACȚIUNI DIRECTE
     fotografie / comenzi
  ====================================== */

  if (
    directIntent.type ===
    "action"
  ) {
    const actionId =
      directIntent.actionId;

    /*
     * Căutare după fotografie
     */
    if (
      actionId === "image-search"
    ) {
      setCurrentMenu("shopping");
      setActiveFlow(
        "image-search"
      );

      await startProductFlow({
        actionId:
          "image-search",

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
     * Comenzi
     */
    if (
  actionId ===
    "track-order" ||
  actionId ===
    "order-delivery"
) {
  closeAssistant();

  const handled =
    await startOrderFlow({
      actionId,
    });

  if (handled) {
    return;
  }
}
  }

  /* ======================================
     SUPORT DIRECT
  ====================================== */

  if (
    directIntent.type ===
    "support"
  ) {
    setCurrentMenu("help");

    await startSupportFlow({
      actionId:
        SUPPORT_FLOWS.NEW_REQUEST,

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

      addMessage,
      removeMessage,
      createMessage,
      setActiveFlow,
    });

    return;
  }

  /* ======================================
     CERERE OFERTĂ - PUBLICĂ vs DIRECTĂ LA VENDOR
     (vezi detectQuoteRequestIntent, assistantQuotes.js)
  ====================================== */

  if (directIntent.type === "my-quotes") {
    setShowMenu(false);

    await handleAction(
      QUOTE_FLOWS.MY_QUOTES
    );

    return;
  }

  if (directIntent.type === "direct-vendor-quote") {
    /*
     * BUGFIX: fără un produs/magazin cunoscut din pagina curentă,
     * NU pornim flow-ul (ar cere cantitatea înainte să știm pentru
     * CE) - cerem întâi să identifice produsul/vânzătorul.
     */
    if (!entityFromUrl) {
      addMessage(
        createMessage(
          "assistant",
          "Sigur - pentru care produs sau vânzător vrei să ceri ofertă? Deschide pagina produsului/magazinului respectiv, sau spune-mi numele lui."
        )
      );

      return;
    }

    const isStoreEntity =
      entityFromUrl.type === "STORE";

    await startDirectVendorQuoteFlow({
      productId:
        entityFromUrl.type === "PRODUCT"
          ? entityFromUrl.id
          : null,

      productTitle:
        entityFromUrl.type === "PRODUCT"
          ? entityFromUrl.name || null
          : null,

      vendorId: isStoreEntity ? entityFromUrl.id : null,
      vendorName: isStoreEntity ? entityFromUrl.name || null : null,
      fromStore: isStoreEntity,
    });

    return;
  }

  /*
   * BUGFIX (audit): cerere PUBLICĂ (homepage/pagina /cereri, la care
   * pot răspunde mai mulți vânzători) NU are un flow conversațional
   * de creare aici - doar pagina reală, cu butonul "Publică o
   * cerere" (CreateCustomerRequestModal.jsx). Ghidăm către ea, nu
   * inventăm un flow nou.
   */
  if (directIntent.type === "public-request") {
    addMessage(
      createMessage(
        "assistant",
        `O cerere publică e vizibilă tuturor vânzătorilor, care pot trimite oferte - se creează din pagina „Cereri” (buton „Publică o cerere”), nu de aici, din conversație.

Poți ajunge acolo din meniul principal, secțiunea Cereri, sau direct la /cereri.`
      )
    );

    return;
  }

  if (directIntent.type === "quote-disambiguation") {
    addMessage(
      createMessage(
        "assistant",
        "Vrei:\n1. să publici o cerere la care pot răspunde mai mulți vânzători\nsau\n2. să ceri ofertă direct unui anumit vânzător?",
        {
          type: "choices",
          choiceStep: "quote-type",

          choices: [
            "Publică o cerere",
            "Cere ofertă unui vânzător",
          ],
        }
      )
    );

    return;
  }

  if (
    directIntent.type ===
      "menu" &&
    directIntent.menuId ===
      "personalization"
  ) {
    setCurrentMenu(
      "personalization"
    );

    setShowMenu(true);

    addMessage(
      createMessage(
        "assistant",
        "Sigur. Te ajut cu cererea de ofertă. Alege cum dorești să continuăm."
      )
    );

    return;
  }

  /* ======================================
     CLARIFY (taxonomie GUEST) - determinist, Pasul 3 fără LLM
  ====================================== */

  if (directIntent.type === "clarify") {
    addMessage(
      createMessage(
        "assistant",

        "Vrei să cauți un produs personalizat, sau întrebi cum funcționează personalizarea pe Artfest?",

        {
          type: "choices",
          choiceStep: "clarify-personalization",

          choices: [
            "Caut un produs personalizat",
            "Cum funcționează personalizarea",
          ],
        }
      )
    );

    return;
  }

  /* ======================================
     NAVIGATION (taxonomie GUEST)
  ====================================== */

  if (directIntent.type === "navigate") {
    const target = directIntent.target;

    /*
     * Verb de navigare recunoscut, dar fără target cunoscut - nu
     * inventăm un URL, cerem copilotul general să explice unde se
     * găsește (PLATFORM_KNOWLEDGE) - neschimbat față de înainte.
     */
    if (!target) {
      const wasHandled = await askCopilot(value);

      if (!wasHandled) {
        addMessage(
          createMessage(
            "assistant",
            "Nu știu exact la ce pagină te referi. Poți reformula?"
          )
        );
      }

      return;
    }

    const resolution = resolveAssistantAction(target, {
      role: currentRole,
      isAuthenticated,
    });

    /*
     * "not_found"/"unavailable" - target cunoscut de taxonomie, dar
     * fără o rută reală în registru (ex. COLLECTIONS, care nu are
     * pagină-listă) - nu navigăm orb, lăsăm copilotul să explice din
     * knowledge (manifeste), consecvent cu politica "nu inventa URL".
     */
    if (
      resolution.status === "not_found" ||
      resolution.status === "unavailable"
    ) {
      const wasHandled = await askCopilot(value);

      if (!wasHandled) {
        addMessage(
          createMessage(
            "assistant",
            "Nu știu exact la ce pagină te referi. Poți reformula?"
          )
        );
      }

      return;
    }

    /*
     * Cerința #6/#9 - login PĂSTRÂND target-ul exact (redirect la
     * ruta cerută, nu la pagina curentă), ca după autentificare
     * userul să ajungă direct unde a cerut, nu înapoi la punctul de
     * plecare. Același tipar de modal global (?auth=login) folosit
     * deja de restul aplicației (Products.jsx, Navbar.jsx).
     */
    if (resolution.status === "needs_auth") {
      addMessage(
        createMessage(
          "assistant",
          `Pentru asta trebuie să fii autentificat. Te ajut să te autentifici — după login te duc direct la ${resolution.entry.label}.`
        )
      );

      const url = new URL(window.location.href);

      url.searchParams.set("auth", "login");

      url.searchParams.set(
        "redirect",
        resolution.entry.route ||
          window.location.pathname + window.location.search
      );

      navigate(url.pathname + url.search, { replace: false });

      return;
    }

    /*
     * Cerința #6 - rol autentificat, dar fără acces (singurul caz
     * real posibil din ACEST widget: un USER cerând un target
     * VENDOR - widget-ul de VENDOR e complet separat, vezi
     * AppLayout.jsx). Explicăm scurt, nu blocăm conversația.
     */
    if (resolution.status === "role_forbidden") {
      const forVendorOnly =
        resolution.entry.allowedRoles.includes(
          ASSISTANT_ROLES.VENDOR
        ) &&
        !resolution.entry.allowedRoles.includes(ASSISTANT_ROLES.USER);

      addMessage(
        createMessage(
          "assistant",
          forVendorOnly
            ? `${resolution.entry.label} ține de contul de vânzător, nu de cel de cumpărător. Dacă ai și un magazin pe Artfest, accesează-l din contul tău de vânzător.`
            : `Nu ai acces la ${resolution.entry.label} din contul curent.`
        )
      );

      return;
    }

    /*
     * status === "ok" - LOGIN/SIGNUP cerute EXPLICIT ("vreau să mă
     * autentific") sunt OPEN_MODAL, nu NAVIGATE - același modal
     * global, dar fără mesajul de "ai nevoie de cont" (aici userul
     * chiar a cerut asta).
     */
    if (resolution.entry.action === ASSISTANT_ACTION_TYPES.OPEN_MODAL) {
      addMessage(
        createMessage(
          "assistant",
          `Sigur — te ajut cu ${resolution.entry.label}.`
        )
      );

      const url = new URL(window.location.href);

      for (const [key, val] of Object.entries(
        resolution.entry.modalParams || {}
      )) {
        url.searchParams.set(key, val);
      }

      navigate(url.pathname + url.search, { replace: false });

      return;
    }

    /*
     * Navigare directă, sigură (cerința #6) - fără răspuns lung
     * (cerința #12). Prefetch scurt, opțional, ÎNAINTE de navigate -
     * nu blochează (prefetchChunk e fire-and-forget), doar pornește
     * chunk-ul rutei mai devreme (cerința #13).
     */
    addMessage(
      createMessage(
        "assistant",
        `Sigur — te duc la ${resolution.entry.label}.`
      )
    );

    if (resolution.entry.prefetch) {
      prefetchChunk(target, resolution.entry.prefetch, {
        mode: "intent",
      });
    }

    closeAssistant();
    navigate(resolution.entry.route);

    return;
  }

  /* ======================================
     CĂUTARE PRODUS DIRECTĂ
  ====================================== */

  if (
    directIntent.type ===
    "product-search"
  ) {
    setCurrentMenu(
      "shopping"
    );

    setActiveFlow(
      "product-search"
    );

    setShowMenu(false);

    const handled =
      await submitProductMessage({
        activeFlow:
          "product-search",

        value,

        visualSearchId:
          null,

        /*
         * BUGFIX (audit) - un preț menționat în text liber ("caută-mi
         * ceva sub 100 lei") nu ajungea niciodată la un filtru real
         * de preț. directIntent.maxPriceCents vine deja extras de
         * guestIntentTaxonomy.js - detectMaxPriceCentsFromText rămâne
         * doar fallback, pentru orice cale care ar ajunge aici fără
         * să treacă prin taxonomie.
         */
        maxPriceCents:
          directIntent.maxPriceCents ??
          detectMaxPriceCentsFromText(value),

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

    return;
  }
}
if (
  !activeFlow &&
  !directIntent
) {
  setShowMenu(false);

  /*
   * FAZA 5: orice mesaj liber care nu se potrivește cu niciun
   * flow local trece ÎNTÂI prin copilotul general, pentru orice
   * audiență (nu doar vendor).
   */
  const wasHandled = await askCopilot(value);

  if (wasHandled) {
    return;
  }

  /*
   * handled:false sau eroare - dacă e vendor, păstrăm EXACT
   * fallback-ul vechi (askVendorPlatform, manifestele vechi).
   */
  if (isVendor) {
    const loadingMessageId =
      `${Date.now()}-vendor-platform-loading`;

    addMessage({
      id: loadingMessageId,
      role: "assistant",
      type: "loading",
      content:
        "Verific informațiile despre platformă...",
    });

    try {
      const history =
        messagesRef.current
          .filter(
            (message) =>
              message?.type ===
                "text" &&
              (
                message?.role ===
                  "user" ||
                message?.role ===
                  "assistant"
              )
          )
          .slice(-10)
          .map(
            (message) => ({
              role:
                message.role,

              content:
                String(
                  message.content ||
                    ""
                ),
            })
          );

      const result =
        await askVendorPlatform({
          message: value,

          history,

          pageContext: {
            page:
              location.pathname,

            route:
              location.pathname,

            tab:
              new URLSearchParams(
                location.search
              ).get("tab") || "",
          },
        });

      removeMessage(
        loadingMessageId
      );

      addMessage(
        createMessage(
          "assistant",
          result?.message ||
            "Nu am suficiente informații pentru a răspunde."
        )
      );

      return;
    } catch (error) {
      removeMessage(
        loadingMessageId
      );

      console.error(
        "[AiAssistant] vendor platform:",
        error
      );

      addMessage(
        createMessage(
          "assistant",
          humanizeAssistantErrorMessage(
            error,
            "Nu am putut verifica informațiile despre platformă."
          )
        )
      );

      return;
    }
  }

  /*
   * BUGFIX (audit) - bridge documentat, dar niciodată legat: pentru
   * category EXISTING_FLOW/GENERAL_CONVERSATION, copilotRouter.js
   * întoarce explicit { handled:false, delegateTo:
   * "assistantChatRoutes" } - clasificatorul mai vechi din
   * assistantChatRoutes.js (POST /api/assistant/chat) știe să
   * extragă maxPrice/culoare/ocazie din text liber ("Mă ajuți să
   * găsesc ceva sub 100 lei?", care nu se potrivește cu niciun regex
   * local determinist) - dar niciun client nu-l apela efectiv, deci
   * userul primea direct mesajul generic de mai jos chiar și pentru
   * căutări valide de produs. Aceleași 4 tipuri simple pe care le
   * tratează deja detectAssistantIntent (product-search/action/
   * support/menu-personalization), plus chat/clarify - un răspuns
   * simplu, afișat ca atare.
   */
  try {
    const chatHistory = messagesRef.current
      .filter(
        (message) =>
          message?.type === "text" &&
          (message?.role === "user" ||
            message?.role === "assistant")
      )
      .slice(-10)
      .map((message) => ({
        role: message.role,
        content: String(message.content || ""),
      }));

    const chatResult = await sendAssistantChat({
      message: value,
      conversation: chatHistory,
      currentPage: location.pathname,
      isVendor,
    });

    if (chatResult?.type === "product-search") {
      setCurrentMenu("shopping");
      setActiveFlow("product-search");
      setShowMenu(false);

      /*
       * BUGFIX (audit) - preferăm maxPrice-ul STRUCTURAT deja extras
       * de assistantChatRoutes.js (câmp dedicat în JSON, per mesaj
       * complet, nu doar un regex de cue-word) - regexul local
       * (detectMaxPriceCentsFromText) rămâne fallback pentru cazul
       * în care clasificatorul nu l-a completat.
       */
      const maxPriceCents = Number.isFinite(
        Number(chatResult.maxPrice)
      )
        ? Math.round(Number(chatResult.maxPrice) * 100)
        : detectMaxPriceCentsFromText(value);

      const handled = await submitProductMessage({
        activeFlow: "product-search",
        value: chatResult.query || value,
        visualSearchId: null,
        maxPriceCents,
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

      return;
    }

    if (chatResult?.type === "action") {
      const actionId = chatResult.actionId;

      if (actionId === "image-search") {
        setCurrentMenu("shopping");
        setActiveFlow("image-search");

        await startProductFlow({
          actionId: "image-search",

          addConversation: (
            _userText,
            assistantText,
            extra = {}
          ) => {
            addMessage(
              createMessage("assistant", assistantText, extra)
            );
          },
        });

        return;
      }

      if (
        actionId === "track-order" ||
        actionId === "order-delivery"
      ) {
        closeAssistant();

        const handled = await startOrderFlow({ actionId });

        if (handled) {
          return;
        }
      }
    }

    if (chatResult?.type === "support") {
      setCurrentMenu("help");

      await startSupportFlow({
        actionId: SUPPORT_FLOWS.NEW_REQUEST,

        addConversation: (
          _userText,
          assistantText,
          extra = {}
        ) => {
          addMessage(
            createMessage("assistant", assistantText, extra)
          );
        },

        addMessage,
        removeMessage,
        createMessage,
        setActiveFlow,
      });

      return;
    }

    if (
      chatResult?.type === "menu" &&
      chatResult.menuId === "personalization"
    ) {
      setCurrentMenu("personalization");
      setShowMenu(true);

      addMessage(
        createMessage(
          "assistant",
          chatResult.message ||
            "Sigur. Te ajut cu cererea de ofertă. Alege cum dorești să continuăm."
        )
      );

      return;
    }

    if (chatResult?.message) {
      addMessage(
        createMessage("assistant", chatResult.message)
      );

      return;
    }
  } catch (error) {
    console.error(
      "[AiAssistant] chat fallback:",
      error
    );
  }

  /*
   * Fallback final - dacă nici assistantChatRoutes n-a putut oferi
   * un răspuns util (eroare de rețea sau clasificare "clarify" fără
   * mesaj).
   */
  addMessage(
    createMessage(
      "assistant",
      "Nu sunt sigur ce ai vrut să spui. Poți reformula, de exemplu: „caut un cadou sub 100 lei”, „unde este comanda mea?” sau „vreau să caut după o fotografie”."
    )
  );

  return;
}
      const productHandled =
        await submitProductMessage({
          activeFlow,
          value,
          visualSearchId,
          addMessage,
          removeMessage,
          createMessage,
        });

      if (
        productHandled
      ) {
        return;
      }

      /*
       * ===================================================
       * SUPORT
       * ===================================================
       */

      const supportHandled =
        await submitSupportMessage({
          activeFlow,
          value,
          addMessage,
          removeMessage,
          createMessage,
          setActiveFlow,

          /*
           * Atașamentele permanente
           * vor fi conectate ulterior.
           *
           * TODO: paritate attachments pe calea menu Support - FAZA 2
           * a adăugat upload-la-confirmare DOAR pe calea chat liber
           * (submitCopilotSupportTicket/finalizeCopilotSupportTicket,
           * mai sus în acest fișier). Fluxul de meniu ("Am nevoie de
           * ajutor" -> categorie -> descriere, din
           * Support/assistantSupport.js) rămâne neatins deliberat -
           * nu modifica aici fără o cerere explicită separată.
           */
          attachments: [],
        });

      if (
        supportHandled
      ) {
        removeLoadingMessages();
        clearUploadedImage();

        return;
      }

      /*
 * ===================================================
 * PERSONALIZARE PRODUS
 * ===================================================
 */

const personalizationHandled =
  await submitProductPersonalizationMessage({
    activeFlow,
    value,

    personalizationContext,
    personalizationDraft,

    addMessage,
    createMessage,

    setActiveFlow,
    setPersonalizationDraft,
  });

if (personalizationHandled) {
  removeLoadingMessages();
  return;
}

      /*
       * ===================================================
       * CERERI DE OFERTĂ
       * ===================================================
       */

    const quoteHandled =
  await submitQuoteMessage({
    activeFlow,
    value,

    quoteContext,
    quoteDraft,
    uploadedImage,

    addMessage,
    removeMessage,
    createMessage,

    setActiveFlow,
    setQuoteContext,
    setQuoteDraft,

    clearUploadedImage,
  });

      if (
        quoteHandled
      ) {
        removeLoadingMessages();

        return;
      }

      /*
       * ===================================================
       * RĂSPUNS TEMPORAR PENTRU FLOW-URI
       * NECONECTATE ÎNCĂ
       * ===================================================
       */

     const namedTemporaryResponse =
  getProductTemporaryResponse(
    activeFlow
  ) ||
  getSupportTemporaryResponse(
    activeFlow
  ) ||
  getPersonalizationTemporaryResponse(
    activeFlow
  ) ||
  getOrderTemporaryResponse(
    activeFlow
  );

      /*
       * ===================================================
       * SELF-RECOVERY (auto-reset) - niciun handler specific
       * (produse/suport/personalizare/ofertă) și niciun răspuns
       * temporar DEDICAT unui flow cunoscut nu s-a putut potrivi -
       * exact cazul "blocat într-un activeFlow/intenție care nu mai
       * poate continua". NU rămânem blocați: resetăm DOAR starea
       * internă a conversației (flow-ul activ + draft-urile lui),
       * la fel cum face deja schimbarea de flow mai sus (a se vedea
       * "isSwitchingFlow"), și reprocesăm mesajul O SINGURĂ DATĂ prin
       * routerul general (askCopilot). Istoricul mesajelor, coșul și
       * datele userului NU sunt atinse - fără reload de pagină.
       * Gardă anti-buclă: selfRecoveryAttemptedRef (max o reîncercare
       * per mesaj trimis, resetat la începutul lui handleSubmit).
       */
      if (
        !namedTemporaryResponse &&
        !selfRecoveryAttemptedRef.current
      ) {
        selfRecoveryAttemptedRef.current = true;

        const hadActiveFlow = Boolean(activeFlow);

        setActiveFlow(null);
        setVisualSearchId(null);
        setQuoteContext(null);
        setPersonalizationContext(null);
        setSupportTroubleshootContext(null);

        if (activeFlow === "image-search") {
          clearUploadedImage();
        }

        const recovered = await askCopilot(value);

        if (recovered) {
          return;
        }

        /*
         * Tot nu știm ce vrea - CLARIFY activ (nu mesajul pasiv "Nu
         * am suficiente informații"), cu 2-3 sugestii concrete de
         * continuare, ca userul să nu rămână într-un dead-end.
         */
        addMessage(
          createMessage(
            "assistant",

            hadActiveFlow
              ? "Nu sunt sigur ce vrei să faci acum. Poți să-mi spui puțin mai concret, sau alegi mai jos:"
              : "Nu sunt sigur ce vrei să faci. Poți să-mi spui puțin mai concret, sau alegi mai jos:",

            {
              type: "choices",
              choiceStep: "self-recovery-clarify",
              choices: [
                "Caut un produs",
                "Vreau să cer o ofertă",
                "Vreau ajutor",
              ],
            }
          )
        );

        return;
      }

      /*
       * Plasă de siguranță - în structura actuală de cod acest punct
       * nu e atins niciodată (blocul de mai sus fie reîncearcă și
       * întoarce, fie afișează clarify-ul activ și întoarce); rămâne
       * doar ca ultim fallback, netăcut, dacă vreo modificare
       * viitoare ar ajunge totuși aici cu garda deja consumată.
       */
      const response =
        namedTemporaryResponse ||
        (!activeFlow
          ? "Nu sunt sigur ce ai vrut să spui. Poți reformula sau poți alege una dintre opțiunile de mai jos."
          : "Nu am înțeles exact mesajul. Poți încerca să îl reformulezi?");

      if (response) {
        window.setTimeout(
          () => {
            addMessage(
              createMessage(
                "assistant",
                response
              )
            );
          },
          250
        );
      }
    } catch (error) {
      removeLoadingMessages();

      addMessage(
        createMessage(
          "assistant",
          humanizeAssistantErrorMessage(
            error,
            "Mesajul nu a putut fi trimis. Te rog să încerci din nou."
          )
        )
      );
    } finally {
      setIsSubmitting(
        false
      );
    }
  }

  /* =======================================================
     Drag
  ======================================================= */

  function handlePointerDown(
    event
  ) {
    if (event.button !== 0) {
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
      Math.abs(deltaX) > 4 ||
      Math.abs(deltaY) > 4
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
     Placeholder și blocare input
  ======================================================= */

  const inputPlaceholder =
    getProductInputPlaceholder(
      activeFlow
    ) ||
    getSupportInputPlaceholder(
      activeFlow
    ) ||
    getPersonalizationInputPlaceholder(
      activeFlow
    ) ||
    getOrderInputPlaceholder(
      activeFlow
    ) ||
    "Scrie un mesaj...";

  const inputDisabled =
    isSubmitting ||
    activeFlow ===
      SUPPORT_FLOWS.CONVERSATIONS;

  /* =======================================================
     Render
  ======================================================= */

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
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
                left: position.x,
                top: position.y,
                width: isOpen
                  ? panelSize.width
                  : 64,
                height: isOpen
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
                    onClick={resetConversation}
                    aria-label="Subiect nou"
                    title="Subiect nou"
                  >
                    <RefreshIcon />
                  </button>

                  <button
                    type="button"
                    className={
                      styles.assistantHeaderButton
                    }
                    onClick={closeAssistant}
                    aria-label="Închide"
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
                {headerSubtitle}
              </p>
            </header>

            <div
  className={
    styles[
      "artfest-assistant-conversation"
    ]
  }
  onClickCapture={(event) => {
  const target =
    event.target.closest?.(
      "a[href], button"
    );

  if (!target) {
    return;
  }

  /*
   * Linkurile care navighează închid
   * întotdeauna asistentul.
   */
  if (
    target.matches("a[href]")
  ) {
    window.setTimeout(() => {
      closeAssistant();
    }, 0);

    return;
  }

  /*
   * Unele acțiuni din AssistantMessage
   * sunt randate ca <button>, nu ca link.
   */
  const label = String(
    target.textContent || ""
  )
    .trim()
    .toLowerCase();

  const navigationButtons = [
    "vezi produse similare",
    "vezi produsul",
    "vezi toate produsele",
    "mergi la produse",
    "descoperă produsul",
  ];

  const shouldClose =
    navigationButtons.some(
      (text) =>
        label.includes(text)
    );

  if (shouldClose) {
    /*
     * Îl lăsăm întâi pe buton să execute
     * propria navigare, apoi închidem AI-ul.
     */
    window.setTimeout(() => {
      closeAssistant();
    }, 0);
  }
}}
>
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
                    compact={
                      isInfluencer &&
                      currentMenu ===
                        "root"
                    }
                    roleHint={
                      panelRoleHint
                    }
                  />
                )}

                {showMenu && (
                  <>
                    <p
                      className={
                        styles.assistantIntroText
                      }
                    >
                      {assistantIntroText}
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
            </div>

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
              {uploadedImage && (
                <div
                  className={
                    styles.uploadPreview
                  }
                >
                  <img
                    src={
                      uploadedImage.previewUrl
                    }
                    alt="Imagine încărcată"
                  />

                  <span>
                    {
                      uploadedImage
                        .file.name
                    }
                  </span>

                  <button
                    type="button"
                    onClick={
                      clearUploadedImage
                    }
                    aria-label="Elimină fotografia"
                    title="Elimină fotografia"
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
                  aria-label="Încarcă o fotografie"
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
                     * ca orice alt panou/overlay.
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
                  aria-label="Mesaj către asistent"
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
                Asistentul verifică
                informațiile disponibile
                în platformă. Cazurile
                speciale sunt trimise
                echipei Artfest.
              </p>
            </form>
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
            aria-label="Deschide asistentul Artfest"
          >
            <SparkleIcon
              size={28}
            />

            {supportUnreadCount > 0 && (
              <span
                className={
                  styles[
                    "artfest-assistant-unread"
                  ]
                }
              >
                {supportUnreadCount > 99
                  ? "99+"
                  : supportUnreadCount}
              </span>
            )}

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