// src/components/AIAssistant/Vendor/vendorFlows.js

import {
  VENDOR_ACTION_IDS,
} from "./vendorMenus.js";

/* =========================================================
   Flow-uri pentru produse
========================================================= */

export const VENDOR_PRODUCT_FLOWS = {
  ADD_PRODUCT:
    VENDOR_ACTION_IDS.ADD_PRODUCT,

  EDIT_PRODUCT:
    VENDOR_ACTION_IDS.EDIT_PRODUCT,

  PRICE_STOCK:
    VENDOR_ACTION_IDS.PRICE_STOCK,

  PRODUCT_HELP:
    VENDOR_ACTION_IDS.PRODUCT_HELP,
};

/* =========================================================
   Pornirea acțiunilor
========================================================= */

export async function startVendorFlow({
  actionId,
  addConversation,
  addMessage,
  createMessage,
  setActiveFlow,
}) {
  switch (actionId) {
    case VENDOR_PRODUCT_FLOWS.ADD_PRODUCT:
      setActiveFlow(
        VENDOR_PRODUCT_FLOWS.ADD_PRODUCT
      );

      addConversation(
        "Vreau să adaug un produs.",
        `Perfect. Încarcă una sau mai multe fotografii ale produsului.

După ce le încarci, asistentul te va ajuta să pregătești titlul, descrierea, prețul, disponibilitatea și modul de comandă.`,
        {
          type:
            "vendor-product-upload",

          choices: [
            "Încarcă fotografii",
          ],
        }
      );

      return true;

    case VENDOR_PRODUCT_FLOWS.EDIT_PRODUCT:
      setActiveFlow(
        VENDOR_PRODUCT_FLOWS.EDIT_PRODUCT
      );

      addConversation(
        "Vreau să editez un produs.",
        `Alege produsul pe care dorești să îl modifici.

În etapa următoare vom încărca aici lista produselor tale.`,
        {
          type:
            "choices",

          choices: [
            "Vezi produsele mele",
          ],
        }
      );

      return true;

    case VENDOR_PRODUCT_FLOWS.PRICE_STOCK:
      setActiveFlow(
        VENDOR_PRODUCT_FLOWS.PRICE_STOCK
      );

      addConversation(
        "Vreau să actualizez prețul sau stocul.",
        `Alege produsul, apoi spune ce dorești să modifici.

Vei putea schimba rapid prețul, stocul sau disponibilitatea.`,
        {
          type:
            "choices",

          choices: [
            "Alege un produs",
          ],
        }
      );

      return true;

    case VENDOR_PRODUCT_FLOWS.PRODUCT_HELP:
      setActiveFlow(
        VENDOR_PRODUCT_FLOWS.PRODUCT_HELP
      );

      addConversation(
        "Am nevoie de ajutor pentru un produs.",
        `Nicio problemă. Încarcă fotografiile produsului și spune-ne pe scurt ce vinzi.

AI-ul va pregăti un draft, iar echipa Artfest te poate ajuta să îl finalizezi.`,
        {
          type:
            "vendor-product-help-upload",

          choices: [
            "Încarcă fotografii",
          ],
        }
      );

      return true;

    default:
      break;
  }

  /*
   * RECEIVED_QUOTES (audit "Cereri primite", 2026-09-23): stub-ul
   * ELIMINAT de aici - conectat acum DIRECT în VendorAssistant.jsx
   * (handleAction), la fel ca STORE/SHOPPING mai jos, reutilizând
   * infrastructura reală (fetchVendorQuotes/openVendorQuote din
   * quotes/quoteApi.js + quotes/assistantQuotes.js) - nu mai există
   * niciun mesaj static aici pentru acest id.
   */

  /*
   * ORDERS (audit "Comenzile magazinului", 2026-09-23): stub-ul
   * ELIMINAT de aici, la fel ca RECEIVED_QUOTES mai sus - conectat
   * acum DIRECT în VendorAssistant.jsx (handleAction), reutilizând
   * GET /api/vendor/orders + GET /api/vendor/orders/thread-meta
   * (DEJA existente, folosite de pagina reală Orders.jsx) - niciun
   * mesaj static aici pentru acest id.
   */

  if (
    actionId ===
    VENDOR_ACTION_IDS.STORE
  ) {
    setActiveFlow(
      VENDOR_ACTION_IDS.STORE
    );

    addMessage(
      createMessage(
        "assistant",
        "Administrarea profilului și a setărilor magazinului va fi conectată ulterior."
      )
    );

    return true;
  }

  if (
    actionId ===
    VENDOR_ACTION_IDS.SHOPPING
  ) {
    setActiveFlow(
      VENDOR_ACTION_IDS.SHOPPING
    );

    addMessage(
      createMessage(
        "assistant",
        "Căutarea produselor din marketplace va fi conectată la asistentul existent."
      )
    );

    return true;
  }

  /*
   * FIX regresie (bug pre-existent, nu introdus de fazele Support) -
   * acest placeholder era scris ÎNAINTE ca sistemul real de suport
   * AI-first (supportEscalationService.js/handleSupportIntelligence,
   * FAZA 8-10) să existe și nu fusese niciodată reconectat. "Ajutor"
   * intră acum DIRECT în pipeline-ul normal de chat liber - NU
   * pornește un flow separat de clasificare (nu există aici, în
   * vendorFlows.js, niciun cod de clasificare nou) - doar arată un
   * mesaj scurt, invitațional, și lasă următorul mesaj tastat de
   * vendor să treacă prin askCopilot -> routeCopilotMessage
   * (INCIDENT_OR_BUG/HUMAN_SUPPORT -> handleSupportIntelligence),
   * EXACT calea deja folosită și verificată pentru orice mesaj liber.
   *
   * setActiveFlow(null) - explicit, ca să nu rămână niciun state
   * "blocat" pe un flow special: activeFlow-ul vechi ("vendor-support")
   * nu era consumat nicăieri, dar golirea lui aici garantează că
   * următorul mesaj (chiar și unul NELEGAT de suport, ex. "Câte
   * produse am?") ajunge la dispatch-ul general normal, nu la vreun
   * cod mort care ar putea fi adăugat ulterior pentru acest flow.
   */
  if (
    actionId ===
    VENDOR_ACTION_IDS.SUPPORT
  ) {
    setActiveFlow(
      null
    );

    addMessage(
      createMessage(
        "assistant",
        "Spune-mi cu ce problemă te confrunți și încerc să te ajut. Dacă e nevoie, putem trimite cazul către suport."
      )
    );

    return true;
  }

  return false;
}

/* =========================================================
   Alegeri din conversație
========================================================= */

export async function handleVendorChoice({
  activeFlow,
  choice,
  addMessage,
  createMessage,
}) {
  if (
    activeFlow ===
      VENDOR_PRODUCT_FLOWS.ADD_PRODUCT &&
    choice ===
      "Încarcă fotografii"
  ) {
    addMessage(
      createMessage(
        "assistant",
        "Folosește butonul cu agrafă pentru a încărca fotografiile produsului."
      )
    );

    return {
      handled: true,
      shouldOpenUpload: true,
    };
  }

  if (
    activeFlow ===
      VENDOR_PRODUCT_FLOWS.PRODUCT_HELP &&
    choice ===
      "Încarcă fotografii"
  ) {
    addMessage(
      createMessage(
        "assistant",
        "Folosește butonul cu agrafă și încarcă fotografiile pe care vrei să le trimiți echipei Artfest."
      )
    );

    return {
      handled: true,
      shouldOpenUpload: true,
    };
  }

  /*
   * BUGFIX (audit 2026-09-23): "Vezi produsele mele" (EDIT_PRODUCT)
   * ȘI "Alege un produs" (PRICE_STOCK) sunt interceptate ÎNAINTE de
   * acest handler, direct în VendorAssistant.jsx (vezi
   * openEditProductSelector) - niciun placeholder aici pentru ele,
   * ca să nu mai existe două căi divergente pentru aceeași alegere.
   * PRICE_STOCK deschide selectorul în mod "narrow" (meniu restrâns
   * Preț/Stoc/Ambele, nu cele 10 acțiuni de la EDIT_PRODUCT).
   */

  return {
    handled: false,
    shouldOpenUpload: false,
  };
}

/* =========================================================
   Mesaje text
========================================================= */

export async function submitVendorMessage({
  activeFlow,
  value,
  addMessage,
  createMessage,
}) {
  const text =
    String(value || "").trim();

  if (!text) {
    return false;
  }

  if (
    activeFlow ===
    VENDOR_PRODUCT_FLOWS.ADD_PRODUCT
  ) {
    addMessage(
      createMessage(
        "assistant",
        `Am notat explicația ta:

„${text}”

După conectarea analizei AI, voi folosi acest text împreună cu fotografiile pentru a pregăti produsul.`
      )
    );

    return true;
  }

  if (
    activeFlow ===
    VENDOR_PRODUCT_FLOWS.EDIT_PRODUCT
  ) {
    addMessage(
      createMessage(
        "assistant",
        `Am notat modificarea dorită:

„${text}”

După conectarea produselor tale, vei putea aplica această modificare direct produsului selectat.`
      )
    );

    return true;
  }

  if (
    activeFlow ===
    VENDOR_PRODUCT_FLOWS.PRICE_STOCK
  ) {
    addMessage(
      createMessage(
        "assistant",
        `Am notat:

„${text}”

După alegerea produsului, vom putea actualiza rapid prețul sau stocul.`
      )
    );

    return true;
  }

  if (
    activeFlow ===
    VENDOR_PRODUCT_FLOWS.PRODUCT_HELP
  ) {
    addMessage(
      createMessage(
        "assistant",
        `Am notat informațiile pentru echipa Artfest:

„${text}”

După conectarea solicitărilor de ajutor, acestea vor fi trimise împreună cu fotografiile produsului.`
      )
    );

    return true;
  }

  return false;
}

/* =========================================================
   Placeholder
========================================================= */

export function getVendorInputPlaceholder(
  activeFlow
) {
  switch (activeFlow) {
    case VENDOR_PRODUCT_FLOWS.ADD_PRODUCT:
      return "Descrie pe scurt produsul și cum se comandă...";

    case VENDOR_PRODUCT_FLOWS.EDIT_PRODUCT:
      return "Spune ce dorești să modifici...";

    case VENDOR_PRODUCT_FLOWS.PRICE_STOCK:
      return "Ex: schimbă prețul la 120 lei...";

    case VENDOR_PRODUCT_FLOWS.PRODUCT_HELP:
      return "Spune-ne ce produs vinzi și unde ai nevoie de ajutor...";

    default:
      return "Scrie un mesaj...";
  }
}