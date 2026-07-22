// src/components/AiAssistant/AiAssistant.jsx
import React, {
  useEffect,
  useRef,
  useState,
} from "react";

import styles from "./AiAssistant.module.css";

import AssistantMessage from "./components/AssistantMessage.jsx";
import ActionMenu from "./components/ActionMenu.jsx";

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
  searchProductsByImage,
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
  handlePersonalizationChoice,
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
  HELP_ACTIONS,
  SUPPORT_FLOWS,
  startSupportFlow,
  handleSupportChoice,
  submitSupportMessage,
  openSupportTicket,
  getTicketIdFromFlow,
  getSupportTemporaryResponse,
  getSupportImageUploadResponse,
  getSupportInputPlaceholder,
} from "./support/assistantSupport.js";
import {
  fetchSupportMessages,
  fetchSupportUnreadCount,
  markSupportTicketRead,
} from "./support/supportApi.js";
import {
  SupportIcon,
} from "./support/SupportIcons.jsx";

/* =========================================================
   Iconițe generale
========================================================= */

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
} from "./quotes/assistantQuotes.js";
import {
  sendQuoteAttachment,
  sendVendorQuoteAttachment,
} from "./quotes/quoteApi.js";

import {
  useLocation,
} from "react-router-dom";
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
  
const INITIAL_MESSAGES = [
  {
    id: "welcome",
    role: "assistant",
    type: "text",
    content:
      "Bună! Sunt asistentul Artfest. Te pot ajuta cu produse, comenzi, personalizări și suport.",
  },
];

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

const VENDOR_ROOT_ACTIONS = [
  {
    id: "shopping-menu",
    title: "Cumpărături",
    description:
      "Caută produse, recomandări și idei de cadouri.",
    icon: ShoppingBagIcon,
  },

  {
    id: QUOTE_FLOWS.VENDOR_QUOTES,
    title: "Cereri de ofertă",
    description:
      "Vezi cererile primite și discută cu clienții.",
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

function getMenus(
  isVendor
) {
  return {
    root: {
      title: isVendor
        ? "Administrare magazin"
        : "Cu ce te putem ajuta?",

      actions: isVendor
        ? VENDOR_ROOT_ACTIONS
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
}) {
  const location =
  useLocation();
  const fileInputRef =
    useRef(null);

  const messagesEndRef =
    useRef(null);

  const supportRefreshRef =
    useRef(false);

    const quoteRefreshRef =
  useRef(false);
const messagesRef =
  useRef(
    INITIAL_MESSAGES
  );
  const quoteDeepLinkHandledRef =
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
] = useState(
  INITIAL_MESSAGES
);
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
  currentMenu,
  setCurrentMenu,
] = useState("root");

const [
  showMenu,
  setShowMenu,
] = useState(true);

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
    isVendor
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
useEffect(() => {
  function handleQuoteRequest(event) {
    const detail = event?.detail || {};

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

  window.addEventListener(
    "artfest:quote-request",
    handleQuoteRequest
  );

  return () => {
    window.removeEventListener(
      "artfest:quote-request",
      handleQuoteRequest
    );
  };
}, []);

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

  if (
    quoteDeepLinkHandledRef.current
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

  const shouldOpenUserQuote =
    assistantTarget ===
      "quote" &&
    !isVendor;

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

  quoteDeepLinkHandledRef.current =
    true;

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
          error?.data
            ?.message ||
            error?.message ||
            "Nu am putut deschide conversația cererii de ofertă."
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
  }, [isOpen]);

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

  setIsOpen(false);
  resetConversation();
}

function resetConversation() {
  clearUploadedImage();

  setMessages([
    ...INITIAL_MESSAGES,
  ]);

  setInputValue("");
  setActiveFlow(null);
  setQuoteContext(null);
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

  supportRefreshRef.current = false;
  quoteRefreshRef.current = false;
}

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

  /* =======================================================
     Alegeri din mesaje
  ======================================================= */

  async function handleChoice(
    choice,
    sourceMessage = null
  ) {
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

      const personalizationHandled =
        await handlePersonalizationChoice(
          context
        );

      if (
        personalizationHandled
      ) {
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

  async function runVisualSearch(
    file
  ) {
    const loadingMessageId =
      `${Date.now()}-visual-search-loading`;

    addMessage({
      id: loadingMessageId,
      role: "assistant",
      type: "loading",
      content:
        "Analizez fotografia și caut produse similare...",
    });

    try {
      const result =
        await searchProductsByImage(
          file
        );

      setVisualSearchId(
        result?.searchId ||
          null
      );

      removeMessage(
        loadingMessageId
      );

      if (
        !result?.products
          ?.length
      ) {
        addMessage(
          createMessage(
            "assistant",
            "Nu am găsit produse suficient de asemănătoare. Poți încerca o altă fotografie sau poți descrie elementele pe care dorești să le păstrăm.",
            {
              type: "choices",
              choiceStep:
                "visual-search-empty",
              choices: [
                "Păstrează culorile",
                "Păstrează stilul",
                "Păstrează categoria",
                "Încarcă altă fotografie",
              ],
            }
          )
        );

        return;
      }

      const total =
        Number.isFinite(
          result.total
        )
          ? result.total
          : result.products
              .length;

      addMessage(
        createMessage(
          "assistant",
          `Am găsit ${total} ${
            total === 1
              ? "produs asemănător"
              : "produse asemănătoare"
          }.`,
          {
            type:
              "product-results",
            searchId:
              result.searchId ||
              null,
            total,
            products:
              result.products.slice(
                0,
                3
              ),
            analysis:
              result.analysis ||
              null,
            filters:
              result.filters ||
              null,
          }
        )
      );
    } catch (error) {
      removeMessage(
        loadingMessageId
      );

      addMessage(
        createMessage(
          "assistant",
          error instanceof Error
            ? error.message
            : "A apărut o problemă la analizarea fotografiei.",
          {
            type: "choices",
            choiceStep:
              "visual-search-error",
            choices: [
              "Încearcă din nou",
              "Încarcă altă fotografie",
            ],
          }
        )
      );
    }
  }

  /* =======================================================
     Încărcare imagine
  ======================================================= */

  async function handleImageChange(
    event
  ) {
    const file =
      event.target.files?.[0];

    if (!file) {
      return;
    }

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

    clearUploadedImage();

    const previewUrl =
      URL.createObjectURL(file);

    setUploadedImage({
      file,
      previewUrl,
    });

   const isQuoteConversation =
  activeFlow ===
    QUOTE_FLOWS
      .USER_QUOTE_THREAD ||
  activeFlow ===
    QUOTE_FLOWS
      .VENDOR_QUOTE_THREAD;

if (
  !isQuoteConversation
) {
  addMessage({
    id:
      `${Date.now()}-image`,

    role:
      "user",

    type:
      "image",

    content:
      "Fotografie încărcată",

    imageUrl:
      previewUrl,

    filename:
      file.name,
  });
}

    event.target.value = "";

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
     * Trimitem efectiv fotografia
     * către backend.
     *
     * Backend-ul o va trece prin
     * moderateMarketplaceImage()
     * înainte să fie salvată.
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

    /*
     * Ajungem aici numai dacă
     * backend-ul a acceptat fotografia.
     */
    addMessage(
      createMessage(
        "assistant",
        "Fotografia a fost verificată și trimisă în conversație."
      )
    );

    clearUploadedImage();

    /*
     * Mesajul cu atașamentul va apărea
     * în conversație prin actualizarea
     * thread-ului / polling.
     */
    return;
  } catch (
    error
  ) {
    /*
     * Aici ajung:
     *
     * 422 -> fotografia a fost blocată
     * 503 -> moderarea AI nu este disponibilă
     * alte erori -> upload/server etc.
     */
    addMessage(
      createMessage(
        "assistant",
        error?.data?.message ||
          error?.message ||
          "Fotografia nu a putut fi trimisă."
      )
    );

    /*
     * Fotografia respinsă nu trebuie
     * să rămână în preview.
     */
    clearUploadedImage();

    return;
  } finally {
    setIsSubmitting(
      false
    );
  }
} 

    const uploadResponse =
      getSupportImageUploadResponse(
        activeFlow
      ) ||
      getPersonalizationImageUploadResponse(
        activeFlow
      ) ||
      getOrderImageUploadResponse(
        activeFlow
      ) ||
      getProductImageUploadResponse(
        activeFlow
      ) ||
      "Am primit fotografia.";

    addMessage(
      createMessage(
        "assistant",
        uploadResponse
      )
    );
    if (
  activeFlow === "quote-from-store"
) {
  addMessage(
    createMessage(
      "assistant",
      "Perfect! Acum spune-mi de câte bucăți ai nevoie."
    )
  );

  setQuoteDraft((current) => ({
    ...current,
    step: "quantity",
  }));

  return;
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

    try {
      /*
       * ===================================================
       * PRODUSE
       * ===================================================
       */

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

      const response =
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
        ) ||
        "Am primit mesajul.";

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
          error?.data?.message ||
            error?.message ||
            "Mesajul nu a putut fi trimis. Te rog să încerci din nou."
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
        style={{
          left: position.x,
          top: position.y,
          width: isOpen
            ? panelSize.width
            : 64,
          height: isOpen
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
                    Asistent Artfest
                  </h2>

                  <p>
                    Cumpărături,
                    comenzi și suport
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